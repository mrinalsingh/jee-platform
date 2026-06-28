/**
 * Test-session lifecycle service.
 *
 * Implements endpoints 3-13 of architecture §5.3.
 *
 * Why mostly raw SQL: this service runs against the runtime app role
 * `app_user_login` which has been REVOKEd from UPDATE/DELETE on `attempts` and
 * `test_session_audit`. The transaction at submit needs precise control over
 * row locking (`SELECT ... FOR UPDATE` on the test_sessions row) and over the
 * order of writes, so we bypass Prisma's high-level API and use parameterised
 * queries — never string concatenation with user input.
 */

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
} from "@nestjs/common";
import * as crypto from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import {
  AutoSubmitSource,
  LateSnapshotsDto,
  SnapshotPatchDto,
  SubmitDto,
  ViolationDto,
  ViolationType,
} from "./test-sessions.dto";
import {
  generateSessionSecret,
  signFigureToken,
  verifyFigureToken,
} from "../lib/hmac-token";
import { byteEqualNormalized, normalizeNumDec } from "../lib/numeric";

// ---------------------------------------------------------------------------
// Internal row types — typed at the SQL boundary so the service body can stay
// strongly typed without leaking the snake_case shape to controllers.
// ---------------------------------------------------------------------------

interface TestSessionRow {
  id: bigint;
  test_id: bigint;
  test_assignment_id: bigint;
  student_id: bigint;
  session_secret_current: Buffer;
  session_secret_previous: Buffer | null;
  secret_rotated_at: Date | null;
  started_at: Date | null;
  expires_at: Date | null;
  submitted_at: Date | null;
  status: "ACTIVE" | "SUBMITTED" | "EXPIRED";
  auto_submit_source: AutoSubmitSource | null;
  violations_count: number;
  frozen_question_codes: string[];
}

interface ProblemRow {
  question_code: string;
  statement: string;
  answer_type:
    | "MCQ_SC"
    | "MCQ_MC"
    | "NUM_INT"
    | "NUM_DEC"
    | "MAT_COL"
    | "MCQ_PASSAGE"
    | "NUM_DIGIT"
    | "MAT_LIST"
    | "MCQ_AR"
    | "FILL";
  answer: unknown;
  solution: string;
  wrong_paths: unknown;
  hints: Array<{ level: number; text: string; reveals_idea: boolean }>;
  hint_count: number;
}

const VIOLATION_THRESHOLD = 3;
const SECRET_GRACE_MS = 5 * 60 * 1000;

@Injectable()
export class TestSessionsService {
  private readonly log = new Logger("TestSessionsService");

  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // §5.3 endpoint 3 — POST /api/test-sessions
  // Idempotent: if an ACTIVE session for (student, test) already exists,
  // returns 409 with the existing session_id (partial unique index in 0010
  // guarantees there can only be one).
  // -------------------------------------------------------------------------
  async createSession(
    studentId: bigint,
    testAssignmentId: string,
  ): Promise<{
    session_id: string;
    started_at: string;
    expires_at: string;
    marking_scheme: unknown;
  }> {
    const taId = this.parseBigInt(testAssignmentId, "test_assignment_id");

    const assignment = await this.loadAssignment(taId, studentId);
    if (!assignment) {
      throw new ForbiddenException({
        error: "assignment_unavailable",
        message: "test assignment not found or not accessible to this student",
      });
    }
    if (new Date() > assignment.window_end_at) {
      throw new ForbiddenException({
        error: "window_closed",
        message: "test window has closed",
      });
    }

    // Check for an existing ACTIVE session — enforce idempotency at the SQL
    // level (partial unique index uniq_active_session in migration 0010).
    const existing = await this.prisma.$queryRawUnsafe<
      Array<{ id: bigint; started_at: Date | null; expires_at: Date | null }>
    >(
      `SELECT id, started_at, expires_at FROM test_sessions
       WHERE student_id = $1 AND test_id = $2 AND submitted_at IS NULL
       LIMIT 1`,
      studentId,
      assignment.test_id,
    );
    if (existing.length > 0) {
      const row = existing[0]!;
      throw new ConflictException({
        error: "session_exists",
        existing_session_id: row.id.toString(),
        started_at: row.started_at?.toISOString() ?? null,
        expires_at: row.expires_at?.toISOString() ?? null,
      });
    }

    const sessionSecret = generateSessionSecret();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + assignment.duration_seconds * 1000);

    // Insert the new session. `started_at` is NULL until the START action.
    const result = await this.prisma.$queryRawUnsafe<Array<{ id: bigint }>>(
      `INSERT INTO test_sessions
         (test_id, test_assignment_id, student_id, session_secret_current,
          started_at, expires_at, status, frozen_question_codes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', $7::jsonb, now())
       RETURNING id`,
      assignment.test_id,
      taId,
      studentId,
      sessionSecret,
      now,
      expiresAt,
      JSON.stringify(assignment.question_codes),
    );

    const sessionId = result[0]!.id;
    const markingScheme =
      assignment.assignment_marking_scheme ?? assignment.test_marking_scheme;

    this.log.log(`session created id=${sessionId} student=${studentId} test=${assignment.test_id}`);
    return {
      session_id: sessionId.toString(),
      started_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      marking_scheme: markingScheme,
    };
  }

  // -------------------------------------------------------------------------
  // §5.3 endpoint 4 — GET /api/test-sessions/:id
  // Returns the slot-indexed payload WITHOUT question_code / correct answer /
  // solution / wrong_paths. Figure tokens are signed lazily under the current
  // session secret.
  // -------------------------------------------------------------------------
  async getSession(
    sessionId: string,
    studentId: bigint,
  ): Promise<{
    session_id: string;
    test_id: string;
    started_at: string | null;
    expires_at: string | null;
    submitted_at: string | null;
    marking_scheme: unknown;
    sections: Array<{
      section_id: string;
      subject: string;
      slots: Array<{
        slot_index: number;
        statement: string;
        answer_type: string;
        figure_signed_tokens: string[];
        hint_count: number;
      }>;
    }>;
    snapshots: Array<{
      slot_index: number;
      answer_payload: unknown;
      marked_for_review: boolean;
      visit_count: number;
      time_seconds: number;
      hints_used: number;
    }>;
    violations_count: number;
  }> {
    const sid = this.parseBigInt(sessionId, "id");
    const session = await this.loadSessionOwned(sid, studentId);

    // For each slot, load the problem WITHOUT the answer/solution/wrong_paths.
    const codes = session.frozen_question_codes;
    const problems = codes.length === 0
      ? []
      : await this.prisma.$queryRawUnsafe<
          Array<{
            question_code: string;
            statement: string;
            answer_type: ProblemRow["answer_type"];
            hint_count: number;
          }>
        >(
          `SELECT question_code, statement, answer_type, hint_count
           FROM problems
           WHERE question_code = ANY($1::text[])`,
          codes,
        );

    // For each slot we also need the figure list, so we know how many tokens to issue.
    const figures = codes.length === 0
      ? []
      : await this.prisma.$queryRawUnsafe<
          Array<{ question_code: string; figure_index: number }>
        >(
          `SELECT question_code, figure_index FROM problem_figures
           WHERE question_code = ANY($1::text[])
           ORDER BY question_code, figure_index`,
          codes,
        );

    // Build a lookup by code.
    const byCode = new Map(problems.map((p) => [p.question_code, p]));
    const figByCode = new Map<string, number[]>();
    for (const f of figures) {
      const arr = figByCode.get(f.question_code) ?? [];
      arr.push(f.figure_index);
      figByCode.set(f.question_code, arr);
    }

    const slots = codes.map((code, slotIndex) => {
      const p = byCode.get(code);
      if (!p) {
        throw new NotFoundException({
          error: "frozen_code_missing",
          message: `problem ${code} (slot ${slotIndex}) not found`,
        });
      }
      const figIndexes = figByCode.get(code) ?? [];
      // Sign one token per figure under session_secret_current.
      const tokens = figIndexes.map((fi) =>
        signFigureToken(session.session_secret_current, slotIndex, fi),
      );
      return {
        slot_index: slotIndex,
        statement: p.statement,
        answer_type: p.answer_type,
        figure_signed_tokens: tokens,
        hint_count: p.hint_count,
      };
    });

    // Load snapshots — the per-question persisted state for resume.
    const snapshots = await this.prisma.$queryRawUnsafe<
      Array<{
        slot_index: number;
        answer_payload: unknown;
        marked_for_review: boolean;
        visit_count: number;
        time_seconds: number;
        hints_used: number;
      }>
    >(
      `SELECT slot_index, answer_payload, marked_for_review, visit_count,
              time_seconds, hints_used
       FROM test_session_snapshots
       WHERE session_id = $1
       ORDER BY slot_index ASC`,
      session.id,
    );

    const markingScheme = await this.resolveMarkingScheme(session);

    return {
      session_id: session.id.toString(),
      test_id: session.test_id.toString(),
      started_at: session.started_at?.toISOString() ?? null,
      expires_at: session.expires_at?.toISOString() ?? null,
      submitted_at: session.submitted_at?.toISOString() ?? null,
      marking_scheme: markingScheme,
      sections: [
        {
          section_id: "default",
          subject: "Mathematics", // v1 ships maths-only; sections layout is forward-compatible
          slots,
        },
      ],
      snapshots,
      violations_count: session.violations_count,
    };
  }

  // -------------------------------------------------------------------------
  // §5.3 endpoint 5 — PUT /api/test-sessions/:id/state
  // -------------------------------------------------------------------------
  async updateState(
    sessionId: string,
    studentId: bigint,
    action: "START" | "HEARTBEAT",
  ): Promise<{ server_now: string; expires_at: string | null }> {
    const sid = this.parseBigInt(sessionId, "id");
    const session = await this.loadSessionOwned(sid, studentId);

    if (action === "START") {
      if (session.started_at !== null) {
        // Idempotent on START; we don't re-set the started_at clock.
        return {
          server_now: new Date().toISOString(),
          expires_at: session.expires_at?.toISOString() ?? null,
        };
      }
      const now = new Date();
      const dur = session.expires_at
        ? Math.max(0, (session.expires_at.getTime() - now.getTime()) / 1000)
        : 0;
      await this.prisma.$executeRawUnsafe(
        `UPDATE test_sessions SET started_at = $1, expires_at = $2 WHERE id = $3 AND submitted_at IS NULL`,
        now,
        new Date(now.getTime() + dur * 1000),
        sid,
      );
      await this.audit(sid, studentId, "PUT /api/test-sessions/:id/state", {
        action: "START",
      });
      return {
        server_now: now.toISOString(),
        expires_at: new Date(now.getTime() + dur * 1000).toISOString(),
      };
    }

    // HEARTBEAT — no state change.
    return {
      server_now: new Date().toISOString(),
      expires_at: session.expires_at?.toISOString() ?? null,
    };
  }

  // -------------------------------------------------------------------------
  // §5.3 endpoint 6 — PATCH /api/test-sessions/:id/snapshots/:slot_index
  // Telemetry write. UPSERT on (session_id, slot_index); latest action_seq wins.
  // Architecture §6.1 + §6.2.
  // -------------------------------------------------------------------------
  async patchSnapshot(
    sessionId: string,
    slotIndex: number,
    studentId: bigint,
    patch: SnapshotPatchDto,
  ): Promise<{ persisted_action_seq: number; server_timestamp: string }> {
    const sid = this.parseBigInt(sessionId, "id");
    const session = await this.loadSessionOwned(sid, studentId);
    if (session.submitted_at !== null) {
      throw new ForbiddenException({
        error: "session_submitted",
        message: "session is already submitted; no further snapshots accepted",
      });
    }
    if (slotIndex < 0 || slotIndex >= session.frozen_question_codes.length) {
      throw new BadRequestException({ error: "slot_out_of_range" });
    }
    const questionCode = session.frozen_question_codes[slotIndex]!;
    // architecture §6.2: cap each delta at 60s to defeat clock-skew attacks.
    const cappedDelta = Math.max(0, Math.min(60, patch.time_seconds_delta));

    // UPSERT — INSERT ... ON CONFLICT updates only if request's action_seq is
    // higher (latest-wins). If request's action_seq is lower we keep the stored
    // state; we still return the persisted seq.
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ action_seq: bigint }>
    >(
      `INSERT INTO test_session_snapshots
         (session_id, slot_index, question_code, answer_payload,
          time_seconds, visit_count, marked_for_review,
          hints_used, hint_levels_revealed, action_seq, last_action_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, 0, ARRAY[]::int[], $8, now())
       ON CONFLICT (session_id, slot_index) DO UPDATE SET
         answer_payload = CASE
           WHEN EXCLUDED.action_seq > test_session_snapshots.action_seq
             THEN EXCLUDED.answer_payload
           ELSE test_session_snapshots.answer_payload
         END,
         time_seconds   = test_session_snapshots.time_seconds + $5,
         visit_count    = GREATEST(test_session_snapshots.visit_count, EXCLUDED.visit_count),
         marked_for_review = CASE
           WHEN EXCLUDED.action_seq > test_session_snapshots.action_seq
             THEN EXCLUDED.marked_for_review
           ELSE test_session_snapshots.marked_for_review
         END,
         action_seq     = GREATEST(test_session_snapshots.action_seq, EXCLUDED.action_seq),
         last_action_at = now()
       RETURNING action_seq`,
      sid,
      slotIndex,
      questionCode,
      JSON.stringify(patch.answer_payload ?? null),
      cappedDelta,
      patch.visit_count,
      patch.marked_for_review,
      patch.action_seq,
    );

    await this.audit(sid, studentId, "PATCH /api/test-sessions/:id/snapshots/:slot", patch);

    return {
      persisted_action_seq: Number(rows[0]!.action_seq),
      server_timestamp: new Date().toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // §5.3 endpoint 7 — GET /api/test-sessions/:id/questions/:slot/hints/:level
  // Server pads response time to constant (~250ms) — architecture §10.3 (Req L).
  // -------------------------------------------------------------------------
  async getHint(
    sessionId: string,
    slotIndex: number,
    level: number,
    studentId: bigint,
  ): Promise<{ level: number; text: string; pad: string }> {
    const start = Date.now();
    const sid = this.parseBigInt(sessionId, "id");
    const session = await this.loadSessionOwned(sid, studentId);
    if (session.submitted_at !== null) {
      await this.padToConstantTime(start);
      throw new ForbiddenException({ error: "session_submitted" });
    }
    if (slotIndex < 0 || slotIndex >= session.frozen_question_codes.length) {
      await this.padToConstantTime(start);
      throw new BadRequestException({ error: "slot_out_of_range" });
    }
    const code = session.frozen_question_codes[slotIndex]!;

    // Look up current hints_used to enforce sequential reveal.
    const snap = await this.prisma.$queryRawUnsafe<
      Array<{ hints_used: number }>
    >(
      `SELECT hints_used FROM test_session_snapshots WHERE session_id = $1 AND slot_index = $2`,
      sid,
      slotIndex,
    );
    const currentlyUsed = snap[0]?.hints_used ?? 0;
    if (level !== currentlyUsed + 1) {
      await this.padToConstantTime(start);
      throw new BadRequestException({
        error: "sequence_skipped",
        message: `next hint level must be ${currentlyUsed + 1}; got ${level}`,
      });
    }

    const problemRows = await this.prisma.$queryRawUnsafe<
      Array<{ hints: Array<{ level: number; text: string }> }>
    >(`SELECT hints FROM problems WHERE question_code = $1`, code);
    const hints = problemRows[0]?.hints ?? [];
    const hint = hints.find((h) => h.level === level);
    if (!hint) {
      await this.padToConstantTime(start);
      throw new NotFoundException({ error: "no_such_level" });
    }

    // UPSERT snapshot row to record the hint reveal.
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO test_session_snapshots
         (session_id, slot_index, question_code, time_seconds, visit_count,
          marked_for_review, hints_used, hint_levels_revealed, action_seq, last_action_at)
       VALUES ($1, $2, $3, 0, 0, false, 1, ARRAY[$4::int], 0, now())
       ON CONFLICT (session_id, slot_index) DO UPDATE SET
         hints_used = test_session_snapshots.hints_used + 1,
         hint_levels_revealed = array_append(test_session_snapshots.hint_levels_revealed, $4::int),
         last_action_at = now()`,
      sid,
      slotIndex,
      code,
      level,
    );

    await this.auditHint(sid, studentId, slotIndex, level);
    await this.padToConstantTime(start);

    // Architecture §10.3: response is padded to a fixed size (≥ 1 KB) via the
    // `pad` field. Final-byte zero-pad defeats length probes when the text is
    // short.
    const pad = "_".repeat(Math.max(0, 1024 - hint.text.length));
    return { level, text: hint.text, pad };
  }

  // -------------------------------------------------------------------------
  // §5.3 endpoint 8 — GET /api/test-sessions/:id/figures/:signed_token
  // Validates HMAC then returns the bytes. The controller will set the
  // Content-Type from `mime_type`.
  // -------------------------------------------------------------------------
  async getFigure(
    sessionId: string,
    signedToken: string,
    studentId: bigint,
  ): Promise<{ mime_type: string; bytes: Buffer }> {
    const sid = this.parseBigInt(sessionId, "id");
    const session = await this.loadSessionOwned(sid, studentId);

    // Determine which secret to validate under.
    const previousSecret = this.usablePreviousSecret(session);

    // Decode payload to learn (slot_index, figure_index). The token format is
    // base64url(payload)."base64url(mac)" — we have to peek without trusting.
    // verifyFigureToken expects expectedSlot/figure, so first parse the payload.
    const dot = signedToken.indexOf(".");
    if (dot <= 0) {
      throw new UnauthorizedException({ error: "invalid_token" });
    }
    const payloadStr = Buffer.from(
      signedToken.substring(0, dot).replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    const m = /^(\d+)\|(\d+)$/.exec(payloadStr);
    if (!m) throw new UnauthorizedException({ error: "invalid_token" });
    const slotIndex = parseInt(m[1]!, 10);
    const figureIndex = parseInt(m[2]!, 10);

    const verified = verifyFigureToken(
      signedToken,
      session.session_secret_current,
      previousSecret,
      slotIndex,
      figureIndex,
    );
    if (!verified.ok) {
      throw new UnauthorizedException({ error: "invalid_token", reason: verified.reason });
    }

    if (slotIndex < 0 || slotIndex >= session.frozen_question_codes.length) {
      throw new UnauthorizedException({ error: "invalid_token", reason: "slot_oob" });
    }
    const code = session.frozen_question_codes[slotIndex]!;
    const fig = await this.prisma.$queryRawUnsafe<
      Array<{ mime_type: string; bytes: Buffer }>
    >(
      `SELECT mime_type, bytes FROM problem_figures
       WHERE question_code = $1 AND figure_index = $2`,
      code,
      figureIndex,
    );
    if (fig.length === 0) {
      throw new NotFoundException({ error: "figure_not_found" });
    }
    return fig[0]!;
  }

  // -------------------------------------------------------------------------
  // §5.3 endpoint 9 — GET /api/test-sessions/:id/marking-scheme
  // -------------------------------------------------------------------------
  async getMarkingScheme(sessionId: string, studentId: bigint): Promise<unknown> {
    const sid = this.parseBigInt(sessionId, "id");
    const session = await this.loadSessionOwned(sid, studentId);
    return await this.resolveMarkingScheme(session);
  }

  // -------------------------------------------------------------------------
  // §5.3 endpoint 10 — POST /api/test-sessions/:id/violations
  //
  // [UPDATED v2 — M4] Server-side auto-submit when the violations counter
  // crosses VIOLATION_THRESHOLD. v1 reported `will_auto_submit: true` and then
  // relied on the client to issue POST /submit. If the client got killed (tab
  // close, browser crash, network drop) between the 3rd violation and the
  // client-initiated submit, the session stayed ACTIVE forever — the cron
  // expiry sweep would eventually fire but with auto_submit_source=TIMER_EXPIRY,
  // mis-attributing the cause.
  //
  // The fix: when the violation row brings the counter to >= threshold AND
  // the session is still ACTIVE, the server itself runs the submit pipeline
  // with auto_submit_source=VIOLATION_THRESHOLD inside the SAME transaction
  // that wrote the violation row. Idempotency on submit is preserved by the
  // FOR UPDATE inside `runSubmitInTransaction` — if the client manages to
  // race a manual submit in, exactly one wins.
  // -------------------------------------------------------------------------
  async logViolation(
    sessionId: string,
    studentId: bigint,
    dto: ViolationDto,
  ): Promise<{
    violations_count: number;
    will_auto_submit: boolean;
    auto_submitted: boolean;
    submit_result?: { submitted_at: string; auto_submit_source: AutoSubmitSource; attempt_ids: string[] };
  }> {
    const sid = this.parseBigInt(sessionId, "id");
    const session = await this.loadSessionOwned(sid, studentId);
    if (session.submitted_at !== null) {
      return {
        violations_count: session.violations_count,
        will_auto_submit: false,
        auto_submitted: false,
      };
    }

    // Whole flow runs in one transaction so the violation increment and
    // (if triggered) the auto-submit drain are atomic together.
    return this.prisma.$transaction(async (tx: any) => {
      const updated: Array<{ violations_count: number }> = await tx.$queryRawUnsafe(
        `UPDATE test_sessions SET violations_count = violations_count + 1
         WHERE id = $1 AND submitted_at IS NULL
         RETURNING violations_count`,
        sid,
      );
      const count = updated[0]?.violations_count ?? session.violations_count;
      await this.auditViolation(sid, studentId, dto, tx);

      const willAutoSubmit = count >= VIOLATION_THRESHOLD;
      if (!willAutoSubmit) {
        return {
          violations_count: count,
          will_auto_submit: false,
          auto_submitted: false,
        };
      }

      // [UPDATED v2 — M4] Run the inner submit pipeline in the same tx so the
      // client doesn't have to round-trip. The synthetic SubmitDto carries the
      // VIOLATION_THRESHOLD source and a server-generated state hash.
      const syntheticDto: SubmitDto = {
        auto_submit: true,
        auto_submit_source: "VIOLATION_THRESHOLD",
        client_final_state_hash: "server-violation-threshold",
      };
      const submitResult = await this.runSubmitInTransaction(
        tx,
        sid,
        studentId,
        syntheticDto,
      );
      return {
        violations_count: count,
        will_auto_submit: true,
        auto_submitted: true,
        submit_result: submitResult,
      };
    });
  }

  // -------------------------------------------------------------------------
  // §5.3 endpoint 11 — POST /api/test-sessions/:id/submit
  // Idempotent: first-write-wins on session_id. Locks the session row FOR
  // UPDATE, drains snapshots → one attempts row per visited slot, rotates the
  // session secret.
  //
  // [UPDATED v2 — M1/M4] The transactional body is extracted into
  // `runSubmitInTransaction` so it can be invoked from `logViolation` when
  // the violations counter crosses VIOLATION_THRESHOLD, sharing the same
  // FOR UPDATE row lock and the same idempotency guarantees.
  // -------------------------------------------------------------------------
  async submit(
    sessionId: string,
    studentId: bigint,
    dto: SubmitDto,
  ): Promise<{
    submitted_at: string;
    auto_submit_source: AutoSubmitSource;
    attempt_ids: string[];
  }> {
    const sid = this.parseBigInt(sessionId, "id");
    return this.prisma.$transaction(async (tx: any) =>
      this.runSubmitInTransaction(tx, sid, studentId, dto),
    );
  }

  /**
   * [UPDATED v2 — M1/M4] Inner submit pipeline. Runs INSIDE a Prisma
   * transaction client `tx` so callers can compose it with their own
   * transactional work (e.g. `logViolation` runs the violation-row INSERT
   * and the auto-submit drain in one tx).
   *
   * Behaviour identical to v1 plus M1 fixes:
   *   - Acquires FOR UPDATE on the test_sessions row first. Two concurrent
   *     callers therefore serialize; the second observes submitted_at != NULL
   *     and short-circuits to the idempotent return path.
   *   - Computes attempt_order via ONE batched query instead of N+1.
   *   - Computes round_at_time via ONE batched query instead of N+1.
   */
  private async runSubmitInTransaction(
    tx: any,
    sid: bigint,
    studentId: bigint,
    dto: SubmitDto,
  ): Promise<{
    submitted_at: string;
    auto_submit_source: AutoSubmitSource;
    attempt_ids: string[];
  }> {
      const rows: TestSessionRow[] = await tx.$queryRawUnsafe(
        `SELECT * FROM test_sessions WHERE id = $1 FOR UPDATE`,
        sid,
      );
      if (rows.length === 0) {
        throw new NotFoundException({ error: "session_not_found" });
      }
      const session = rows[0]!;
      if (session.student_id !== studentId) {
        throw new ForbiddenException({ error: "not_owner" });
      }

      // Idempotency: if already submitted, return existing.
      if (session.submitted_at !== null) {
        const attemptRows: Array<{ id: bigint }> = await tx.$queryRawUnsafe(
          `SELECT id FROM attempts WHERE test_session_id = $1 ORDER BY id ASC`,
          sid,
        );
        return {
          submitted_at: session.submitted_at.toISOString(),
          auto_submit_source: (session.auto_submit_source ?? dto.auto_submit_source),
          attempt_ids: attemptRows.map((r: { id: bigint }) => r.id.toString()),
        };
      }

      // Load snapshots.
      const snapshots: Array<{
        slot_index: number;
        question_code: string;
        answer_payload: unknown;
        time_seconds: number;
        visit_count: number;
        marked_for_review: boolean;
        hints_used: number;
        last_action_at: Date | null;
      }> = await tx.$queryRawUnsafe(
        `SELECT slot_index, question_code, answer_payload, time_seconds,
                visit_count, marked_for_review, hints_used, last_action_at
         FROM test_session_snapshots
         WHERE session_id = $1
         ORDER BY slot_index ASC`,
        sid,
      );

      // Compute visit_index_in_test by rank of last_action_at (NULLs last).
      const sortedByAction = [...snapshots].sort((a, b) => {
        if (a.last_action_at && b.last_action_at) {
          return a.last_action_at.getTime() - b.last_action_at.getTime();
        }
        if (a.last_action_at && !b.last_action_at) return -1;
        if (!a.last_action_at && b.last_action_at) return 1;
        return a.slot_index - b.slot_index;
      });
      const visitIndex = new Map<number, number>();
      sortedByAction.forEach((s, idx) => visitIndex.set(s.slot_index, idx + 1));

      // Look up each problem to do answer-compare AND learn its fingerprint
      // tuple in the same call. The fingerprint tuple is needed to look up
      // round_at_time without a per-slot subquery.
      const codes = snapshots.map((s) => s.question_code);
      type ProblemForGrading = {
        question_code: string;
        answer_type: ProblemRow["answer_type"];
        answer: { type?: string; correct_options?: string[]; value?: number | string; precision?: number };
        topic_code: string;
        subtopic_code: string;
        idea_code: string;
        sub_idea_code: string;
      };
      const problems: ProblemForGrading[] =
        codes.length === 0
          ? []
          : await tx.$queryRawUnsafe(
              `SELECT question_code, answer_type, answer,
                      topic_code, subtopic_code, idea_code, sub_idea_code
               FROM problems
               WHERE question_code = ANY($1::text[])`,
              codes,
            );
      const probByCode = new Map<string, ProblemForGrading>(
        problems.map((p) => [p.question_code, p]),
      );

      // [UPDATED v2 — M1a] Compute `attempt_order` for ALL relevant codes in
      // ONE call instead of N. Previously the submit transaction did
      // `SELECT COUNT(*) FROM attempts WHERE student_id=$1 AND question_code=$2`
      // once per slot — an N+1 inside a transaction.
      //
      // Behaviour: for every code in this submit, `attempt_order` becomes the
      // count of this student's CURRENT-COMMITTED attempts at that code, plus
      // 1 plus its zero-based position WITHIN this submit's same-code group
      // (lexical slot order). So if a student has 2 prior attempts at code X
      // AND this submit covers code X twice (e.g. a future re-test bundle),
      // the first new row gets attempt_order=3 and the second gets 4.
      //
      // We acquire the lock via FOR UPDATE on the test_sessions row at the
      // very top of the tx (already in v1 — see `SELECT * FROM test_sessions
      // WHERE id = $1 FOR UPDATE` above). Two concurrent submits of the SAME
      // session_id therefore serialize on that lock; the second one observes
      // submitted_at != NULL and short-circuits to the idempotent return. So
      // two simultaneous submits of the same session result in exactly one
      // attempts batch. (M1 acceptance.)
      const priorCounts: Array<{ question_code: string; c: bigint }> =
        codes.length === 0
          ? []
          : await tx.$queryRawUnsafe(
              `SELECT question_code, COUNT(*)::bigint AS c
               FROM attempts
               WHERE student_id = $1 AND question_code = ANY($2::text[])
               GROUP BY question_code`,
              studentId,
              codes,
            );
      const priorByCode = new Map<string, number>(
        priorCounts.map((r) => [r.question_code, Number(r.c)]),
      );

      // [UPDATED v2 — M1b] Look up round_at_time for ALL relevant fingerprint
      // tuples in ONE call. We collect the distinct fingerprint tuples from
      // the problems batch and query student_fingerprint_state once.
      const fingerprintTuples = Array.from(
        new Set(
          problems.map(
            (p) => `${p.topic_code}${p.subtopic_code}${p.idea_code}${p.sub_idea_code}`,
          ),
        ),
      ).map((s) => s.split(""));
      const fpRows: Array<{
        topic_code: string;
        subtopic_code: string;
        idea_code: string;
        sub_idea_code: string;
        round: string;
      }> =
        fingerprintTuples.length === 0
          ? []
          : await tx.$queryRawUnsafe(
              `SELECT topic_code, subtopic_code, idea_code, sub_idea_code, round
               FROM student_fingerprint_state
               WHERE student_id = $1
                 AND (topic_code, subtopic_code, idea_code, sub_idea_code) IN (
                   SELECT * FROM unnest(
                     $2::text[], $3::text[], $4::text[], $5::text[]
                   ) AS t(topic_code, subtopic_code, idea_code, sub_idea_code)
                 )`,
              studentId,
              fingerprintTuples.map((t) => t[0]!),
              fingerprintTuples.map((t) => t[1]!),
              fingerprintTuples.map((t) => t[2]!),
              fingerprintTuples.map((t) => t[3]!),
            );
      const roundByFingerprint = new Map<string, string>(
        fpRows.map((r) => [
          `${r.topic_code}${r.subtopic_code}${r.idea_code}${r.sub_idea_code}`,
          r.round,
        ]),
      );

      // Per-code running index inside this submit so duplicate codes get
      // consecutive attempt_order values.
      const inBatchSeqByCode = new Map<string, number>();

      const attemptIds: bigint[] = [];
      for (const snap of snapshots) {
        // Skip "untouched" slots — no row written.
        if (
          snap.visit_count === 0 &&
          snap.answer_payload === null &&
          snap.hints_used === 0
        ) {
          continue;
        }
        const p = probByCode.get(snap.question_code);
        if (!p) continue;

        const correct = this.gradeAnswer(p, snap.answer_payload);

        const prior = priorByCode.get(snap.question_code) ?? 0;
        const inBatchSeq = inBatchSeqByCode.get(snap.question_code) ?? 0;
        inBatchSeqByCode.set(snap.question_code, inBatchSeq + 1);
        const attemptOrder = prior + inBatchSeq + 1;

        const fpKey = `${p.topic_code}${p.subtopic_code}${p.idea_code}${p.sub_idea_code}`;
        const round = (roundByFingerprint.get(fpKey) ?? "R1") as
          | "R1"
          | "R2"
          | "R3"
          | "R4";

        const ins: Array<{ id: bigint }> = await tx.$queryRawUnsafe(
          `INSERT INTO attempts
             (student_id, question_code, test_id, test_session_id,
              correct, time_seconds, visit_count, marked_for_review,
              attempt_order, visit_index_in_test, round_at_time, hints_used,
              auto_submit_source, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::"Round", $12, $13::"AutoSubmitSource", now())
           RETURNING id`,
          studentId,
          snap.question_code,
          session.test_id,
          sid,
          correct,
          snap.time_seconds,
          snap.visit_count,
          snap.marked_for_review,
          attemptOrder,
          visitIndex.get(snap.slot_index) ?? null,
          round,
          snap.hints_used,
          dto.auto_submit_source,
        );
        attemptIds.push(ins[0]!.id);
      }

      // Rotate secrets, mark submitted.
      const newSecret = generateSessionSecret();
      const updated: Array<{ submitted_at: Date }> = await tx.$queryRawUnsafe(
        `UPDATE test_sessions SET
           submitted_at = now(),
           status = 'SUBMITTED',
           auto_submit_source = $2::"AutoSubmitSource",
           session_secret_previous = session_secret_current,
           session_secret_current = $3,
           secret_rotated_at = now()
         WHERE id = $1
         RETURNING submitted_at`,
        sid,
        dto.auto_submit_source,
        newSecret,
      );

      await this.auditSubmit(tx, sid, studentId, dto);

      this.log.log(
        `submit done session=${sid} attempts=${attemptIds.length} source=${dto.auto_submit_source}`,
      );
      return {
        submitted_at: updated[0]!.submitted_at.toISOString(),
        auto_submit_source: dto.auto_submit_source,
        attempt_ids: attemptIds.map((id) => id.toString()),
      };
  }

  // -------------------------------------------------------------------------
  // §5.3 endpoint 12 — POST /api/test-sessions/:id/late-snapshots
  // PRD §Q5: NO grace — late = late. Per architecture §5.3 endpoint 12,
  // scored only if pre-submit-commit; arrivals after submit are audit-only.
  //
  // [UPDATED v2 — M2] Close the TOCTOU between "is the session still live?"
  // and "write the snapshot row". v1 read `submitted_at` once at the top of
  // the loop and then wrote N rows without re-checking — a concurrent submit
  // could commit between those steps, leaving us scoring rows that should be
  // audit-only. The fix: gate the write itself on the live state.
  //
  // We add `WHERE (SELECT submitted_at IS NULL AND expires_at > NOW() FROM
  // test_sessions WHERE id = $1)` to the INSERT … ON CONFLICT … DO UPDATE so
  // the row only gets touched if the server clock still considers the session
  // live AT THE INSTANT of the write. The non-scored audit row is still
  // written every time so we have a complete forensic record.
  // -------------------------------------------------------------------------
  async lateSnapshots(
    sessionId: string,
    studentId: bigint,
    dto: LateSnapshotsDto,
  ): Promise<{ recorded_count: number; scored_count: number }> {
    const sid = this.parseBigInt(sessionId, "id");
    // loadSessionOwned does ownership check + 403/404 projection.
    const session = await this.loadSessionOwned(sid, studentId);

    let recorded = 0;
    let scored = 0;
    for (const entry of dto.snapshots) {
      // Always audit — even arrivals after submit get a forensic row.
      await this.audit(sid, studentId, "POST /api/test-sessions/:id/late-snapshots", entry);
      recorded += 1;

      if (entry.slot_index < 0 || entry.slot_index >= session.frozen_question_codes.length) {
        continue;
      }
      const code = session.frozen_question_codes[entry.slot_index]!;

      // [UPDATED v2 — M2] The INSERT only executes if the session is still
      // live AT INSERT TIME. We pre-filter with a CTE so the WHERE clause on
      // the INSERT can reference it. If the CTE returns zero rows (session
      // submitted OR expired since the load), the INSERT writes nothing.
      const writeResult = await this.prisma.$queryRawUnsafe<Array<{ id: bigint }>>(
        `WITH live AS (
           SELECT id FROM test_sessions
            WHERE id = $1
              AND submitted_at IS NULL
              AND (expires_at IS NULL OR expires_at > now())
         )
         INSERT INTO test_session_snapshots
           (session_id, slot_index, question_code, answer_payload,
            time_seconds, visit_count, marked_for_review, hints_used,
            hint_levels_revealed, action_seq, last_action_at)
         SELECT $1, $2, $3, $4::jsonb, 0, 1, false, 0, ARRAY[]::int[], $5, now()
         FROM live
         ON CONFLICT (session_id, slot_index) DO UPDATE SET
           answer_payload = CASE WHEN EXCLUDED.action_seq > test_session_snapshots.action_seq
             THEN EXCLUDED.answer_payload
             ELSE test_session_snapshots.answer_payload END,
           action_seq = GREATEST(test_session_snapshots.action_seq, EXCLUDED.action_seq),
           last_action_at = now()
         RETURNING session_id AS id`,
        sid,
        entry.slot_index,
        code,
        JSON.stringify(entry.answer_payload ?? null),
        entry.action_seq,
      );
      if (writeResult.length > 0) {
        scored += 1;
      }
    }
    return { recorded_count: recorded, scored_count: scored };
  }

  // -------------------------------------------------------------------------
  // §5.3 endpoint 13 — GET /api/test-sessions/:id/results
  // 425 Too Early if submitted_at is null. Returns per-question results
  // including the correct answer + solution + wrong-paths + diagnostic.
  // -------------------------------------------------------------------------
  async getResults(
    sessionId: string,
    studentId: bigint,
  ): Promise<{
    summary: { total_attempted: number; total_correct: number; auto_submit_source: AutoSubmitSource | null };
    per_question: Array<{
      slot_index: number;
      question_code: string;
      statement: string;
      answer: unknown;
      solution: string;
      wrong_paths: unknown;
      student_answer: unknown;
      correct: boolean;
      time_seconds: number;
      hints_used: number;
    }>;
    violations: Array<{ violation_type: ViolationType; timestamp: string; was_active: boolean | null }>;
    auto_submit_source: AutoSubmitSource | null;
  }> {
    const sid = this.parseBigInt(sessionId, "id");
    const session = await this.loadSessionOwned(sid, studentId);
    if (session.submitted_at === null) {
      // 425 Too Early
      throw new ForbiddenException({
        error: "session_not_submitted",
        message: "results available only after submit",
      });
    }

    // Pull attempts rows, joined with the problem row for the full reveal.
    const attempts = await this.prisma.$queryRawUnsafe<
      Array<{
        question_code: string;
        statement: string;
        answer: unknown;
        solution: string;
        wrong_paths: unknown;
        correct: boolean;
        time_seconds: number;
        hints_used: number;
        visit_index_in_test: number | null;
      }>
    >(
      `SELECT a.question_code, p.statement, p.answer, p.solution, p.wrong_paths,
              a.correct, a.time_seconds, a.hints_used, a.visit_index_in_test
       FROM attempts a JOIN problems p ON p.question_code = a.question_code
       WHERE a.test_session_id = $1
       ORDER BY a.visit_index_in_test NULLS LAST, a.id`,
      sid,
    );

    // We also want the student's actual answer payload — pull from snapshots.
    const snaps = await this.prisma.$queryRawUnsafe<
      Array<{ slot_index: number; question_code: string; answer_payload: unknown }>
    >(
      `SELECT slot_index, question_code, answer_payload FROM test_session_snapshots WHERE session_id = $1`,
      sid,
    );
    const snapByCode = new Map(snaps.map((s) => [s.question_code, s]));

    const perQuestion = attempts.map((a) => {
      const snap = snapByCode.get(a.question_code);
      const slotIndex = snap?.slot_index ?? -1;
      return {
        slot_index: slotIndex,
        question_code: a.question_code,
        statement: a.statement,
        answer: a.answer,
        solution: a.solution,
        wrong_paths: a.wrong_paths,
        student_answer: snap?.answer_payload ?? null,
        correct: a.correct,
        time_seconds: a.time_seconds,
        hints_used: a.hints_used,
      };
    });

    const violations = await this.prisma.$queryRawUnsafe<
      Array<{
        violation_type: ViolationType;
        server_timestamp: Date;
        was_active: boolean | null;
      }>
    >(
      `SELECT violation_type, server_timestamp, was_active
       FROM test_session_audit
       WHERE session_id = $1 AND violation_type IS NOT NULL
       ORDER BY server_timestamp ASC`,
      sid,
    );

    return {
      summary: {
        total_attempted: attempts.length,
        total_correct: attempts.filter((a) => a.correct).length,
        auto_submit_source: session.auto_submit_source,
      },
      per_question: perQuestion,
      violations: violations.map((v) => ({
        violation_type: v.violation_type,
        timestamp: v.server_timestamp.toISOString(),
        was_active: v.was_active,
      })),
      auto_submit_source: session.auto_submit_source,
    };
  }

  // ===========================================================================
  // Internal helpers
  // ===========================================================================

  /**
   * Load a session and verify the requesting student owns it. 404 when the
   * session id is unknown; 403 when it's owned by someone else.
   *
   * Architecture §10.4 A01 — broken-access-control mitigation.
   */
  private async loadSessionOwned(
    id: bigint,
    studentId: bigint,
  ): Promise<TestSessionRow> {
    const rows = await this.prisma.$queryRawUnsafe<TestSessionRow[]>(
      `SELECT id, test_id, test_assignment_id, student_id,
              session_secret_current, session_secret_previous, secret_rotated_at,
              started_at, expires_at, submitted_at, status, auto_submit_source,
              violations_count, frozen_question_codes
       FROM test_sessions WHERE id = $1`,
      id,
    );
    if (rows.length === 0) {
      throw new NotFoundException({ error: "session_not_found" });
    }
    const session = rows[0]!;
    if (session.student_id !== studentId) {
      // Per architecture §10.4 A01 we DO NOT reveal whether the session exists.
      throw new ForbiddenException({ error: "not_owner" });
    }
    // Coerce frozen_question_codes (Json from Prisma) to string[]
    if (!Array.isArray(session.frozen_question_codes)) {
      session.frozen_question_codes =
        (session.frozen_question_codes as any) ?? [];
    }
    return session;
  }

  private async loadAssignment(
    taId: bigint,
    studentId: bigint,
  ): Promise<{
    id: bigint;
    test_id: bigint;
    duration_seconds: number;
    window_start_at: Date;
    window_end_at: Date;
    question_codes: string[];
    assignment_marking_scheme: unknown;
    test_marking_scheme: unknown;
  } | null> {
    // The student qualifies via cohort membership OR direct assignment.
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        id: bigint;
        test_id: bigint;
        duration_seconds: number;
        window_start_at: Date;
        window_end_at: Date;
        question_codes: string[];
        assignment_marking_scheme: unknown;
        test_marking_scheme: unknown;
      }>
    >(
      `SELECT ta.id, ta.test_id,
              t.duration_seconds, ta.window_start_at, ta.window_end_at,
              t.question_codes,
              ta.marking_scheme AS assignment_marking_scheme,
              t.marking_scheme  AS test_marking_scheme
       FROM test_assignments ta
       JOIN tests t ON t.id = ta.test_id
       WHERE ta.id = $1
         AND (
           ta.student_id = $2
           OR ta.cohort_id IN (SELECT cohort_id FROM cohort_members WHERE student_id = $2)
         )
       LIMIT 1`,
      taId,
      studentId,
    );
    if (rows.length === 0) return null;
    return rows[0]!;
  }

  private async resolveMarkingScheme(session: TestSessionRow): Promise<unknown> {
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        assignment_marking_scheme: unknown;
        test_marking_scheme: unknown;
      }>
    >(
      `SELECT ta.marking_scheme AS assignment_marking_scheme,
              t.marking_scheme  AS test_marking_scheme
       FROM test_assignments ta JOIN tests t ON t.id = ta.test_id
       WHERE ta.id = $1`,
      session.test_assignment_id,
    );
    if (rows.length === 0) return null;
    return rows[0]!.assignment_marking_scheme ?? rows[0]!.test_marking_scheme;
  }

  /** Return previous secret only if rotation was within the 5-min grace. */
  private usablePreviousSecret(session: TestSessionRow): Buffer | null {
    if (session.session_secret_previous === null) return null;
    if (session.secret_rotated_at === null) return null;
    const sinceMs = Date.now() - session.secret_rotated_at.getTime();
    if (sinceMs > SECRET_GRACE_MS) return null;
    return session.session_secret_previous;
  }

  /**
   * Generic audit row insert. Append-only enforced at DB layer
   * (REVOKE UPDATE,DELETE on test_session_audit per migration 0011).
   */
  private async audit(
    sessionId: bigint,
    studentId: bigint,
    endpoint: string,
    payload: unknown,
  ): Promise<void> {
    const hash = crypto
      .createHash("sha256")
      .update(JSON.stringify(payload ?? null))
      .digest("hex");
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO test_session_audit
         (session_id, student_id, endpoint, action_payload_hash, server_timestamp)
       VALUES ($1, $2, $3, $4, now())`,
      sessionId,
      studentId,
      endpoint,
      hash,
    );
  }

  /**
   * [UPDATED v2 — M4] Accept an optional `tx` so callers running inside a
   * transaction (logViolation) can write the audit row in the same tx as the
   * violation counter increment and the optional auto-submit drain.
   */
  private async auditViolation(
    sessionId: bigint,
    studentId: bigint,
    dto: ViolationDto,
    tx?: any,
  ): Promise<void> {
    const hash = crypto
      .createHash("sha256")
      .update(JSON.stringify(dto))
      .digest("hex");
    const sql = `INSERT INTO test_session_audit
         (session_id, student_id, endpoint, action_payload_hash,
          server_timestamp, violation_type, violation_timestamp, was_active)
       VALUES ($1, $2, 'POST /api/test-sessions/:id/violations', $3,
               now(), $4::"ViolationType", to_timestamp($5 / 1000.0), $6)`;
    if (tx) {
      await tx.$executeRawUnsafe(
        sql,
        sessionId,
        studentId,
        hash,
        dto.violation_type,
        dto.client_timestamp_ms,
        dto.was_active,
      );
    } else {
      await this.prisma.$executeRawUnsafe(
        sql,
        sessionId,
        studentId,
        hash,
        dto.violation_type,
        dto.client_timestamp_ms,
        dto.was_active,
      );
    }
  }

  private async auditHint(
    sessionId: bigint,
    studentId: bigint,
    slotIndex: number,
    level: number,
  ): Promise<void> {
    const hash = crypto
      .createHash("sha256")
      .update(`hint:${slotIndex}:${level}`)
      .digest("hex");
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO test_session_audit
         (session_id, student_id, endpoint, action_payload_hash,
          server_timestamp, hint_level, slot_index)
       VALUES ($1, $2, 'GET /api/test-sessions/:id/questions/:slot/hints/:level', $3,
               now(), $4, $5)`,
      sessionId,
      studentId,
      hash,
      level,
      slotIndex,
    );
  }

  private async auditSubmit(
    tx: any,
    sessionId: bigint,
    studentId: bigint,
    dto: SubmitDto,
  ): Promise<void> {
    const hash = crypto
      .createHash("sha256")
      .update(JSON.stringify(dto))
      .digest("hex");
    await tx.$executeRawUnsafe(
      `INSERT INTO test_session_audit
         (session_id, student_id, endpoint, action_payload_hash, server_timestamp)
       VALUES ($1, $2, 'POST /api/test-sessions/:id/submit', $3, now())`,
      sessionId,
      studentId,
      hash,
    );
  }

  /** Pad to a constant 250ms response. Defeats timing probes per Req L. */
  private async padToConstantTime(startMs: number): Promise<void> {
    const elapsed = Date.now() - startMs;
    const targetMs = 250;
    if (elapsed < targetMs) {
      await new Promise<void>((r) => setTimeout(r, targetMs - elapsed));
    }
  }

  /**
   * Determine `correct` for one snapshot, by answer_type.
   *
   * For NUM_DEC: use the shared `byteEqualNormalized` so importer/runtime/matcher
   * produce byte-identical comparisons (architecture §2, Glossary).
   * For MCQ: set-equality of the chosen options vs correct_options.
   * For NUM_INT: integer equality after parseInt.
   *
   * Returns false on any garbage / missing answer rather than throwing —
   * graders should not crash the submit transaction.
   */
  private gradeAnswer(
    problem: {
      answer_type: ProblemRow["answer_type"];
      answer: { type?: string; correct_options?: string[]; value?: number | string; precision?: number };
    },
    studentAnswer: unknown,
  ): boolean {
    if (studentAnswer === null || studentAnswer === undefined) return false;
    try {
      switch (problem.answer_type) {
        case "MCQ_SC":
        case "MCQ_MC":
        case "MCQ_PASSAGE":
        case "MCQ_AR": {
          const correct = new Set(problem.answer.correct_options ?? []);
          const got = new Set(
            Array.isArray((studentAnswer as any)?.selected_options)
              ? ((studentAnswer as any).selected_options as string[])
              : [],
          );
          if (correct.size !== got.size) return false;
          for (const c of correct) if (!got.has(c)) return false;
          return true;
        }
        case "NUM_INT":
        case "NUM_DIGIT": {
          const want = parseInt(String(problem.answer.value ?? ""), 10);
          const got = parseInt(String((studentAnswer as any)?.value ?? ""), 10);
          if (Number.isNaN(want) || Number.isNaN(got)) return false;
          return want === got;
        }
        case "NUM_DEC": {
          const precision = problem.answer.precision ?? 2;
          const want = problem.answer.value ?? "";
          const got = (studentAnswer as any)?.value ?? "";
          // Both go through the SAME normaliser — byte equality is the contract.
          return byteEqualNormalized(want as any, got as any, precision);
        }
        case "MAT_COL":
        case "MAT_LIST":
        case "FILL":
        default:
          // Placeholder answer types ship the runtime with a hard error block;
          // for any current attempt we conservatively grade `false`.
          return false;
      }
    } catch (e) {
      this.log.error(`gradeAnswer threw on code=${(problem as any).question_code ?? "?"}: ${e}`);
      return false;
    }
  }

  private parseBigInt(value: string, field: string): bigint {
    if (!/^\d+$/.test(value)) {
      throw new BadRequestException({
        error: "invalid_id",
        message: `${field} must be a non-negative integer string`,
      });
    }
    return BigInt(value);
  }
}
