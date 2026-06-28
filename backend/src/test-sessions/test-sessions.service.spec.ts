/**
 * TestSessionsService — focused unit tests for v2 behaviours.
 *
 * Behaviour the DB unambiguously enforces (FOR UPDATE serialization, the
 * actual CTE gating against test_sessions.submitted_at, the consensus trigger
 * raising 23514) lives in test/integration/* spec files that require a live
 * Postgres. These unit tests narrow the assertions to the things we can
 * verify with mocks: the SQL the service emits, the call ordering, and the
 * response shape.
 *
 * v2 coverage:
 *   - M1: submit batches attempt_order + round_at_time lookups (no N+1).
 *   - M2: late-snapshots INSERT is gated by a CTE that filters on
 *         submitted_at IS NULL AND expires_at > NOW().
 *   - M4: 3rd violation triggers the in-tx auto-submit pipeline.
 */

import { Test } from "@nestjs/testing";
import { TestSessionsService } from "./test-sessions.service";
import { PrismaService } from "../prisma/prisma.service";

describe("TestSessionsService (v2)", () => {
  let svc: TestSessionsService;
  let prisma: {
    $queryRawUnsafe: jest.Mock;
    $executeRawUnsafe: jest.Mock;
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      $queryRawUnsafe: jest.fn(),
      $executeRawUnsafe: jest.fn(),
      $transaction: jest.fn(),
    };
    const mod = await Test.createTestingModule({
      providers: [
        TestSessionsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    svc = mod.get(TestSessionsService);
  });

  // -----------------------------------------------------------------------
  // M2: late-snapshots TOCTOU
  // -----------------------------------------------------------------------
  describe("lateSnapshots (M2 — TOCTOU close-down)", () => {
    it("INSERT is gated by a live-session CTE (submitted_at IS NULL AND expires_at > NOW())", async () => {
      // Stub loadSessionOwned — first call returns the session row, after
      // that lateSnapshots issues audit INSERTs and one gated INSERT per entry.
      prisma.$queryRawUnsafe
        // loadSessionOwned: SELECT * FROM test_sessions WHERE id = $1
        .mockResolvedValueOnce([
          {
            id: 1n,
            test_id: 10n,
            test_assignment_id: 5n,
            student_id: 7n,
            session_secret_current: Buffer.from("0".repeat(32)),
            session_secret_previous: null,
            secret_rotated_at: null,
            started_at: new Date(),
            expires_at: new Date(Date.now() + 60_000),
            submitted_at: null,
            status: "ACTIVE",
            auto_submit_source: null,
            violations_count: 0,
            frozen_question_codes: ["MAT.A.B.C.001"],
          },
        ])
        // Gated INSERT … RETURNING — assume the CTE saw a live session.
        .mockResolvedValueOnce([{ id: 1n }]);
      prisma.$executeRawUnsafe.mockResolvedValue(undefined);

      const out = await svc.lateSnapshots(
        "1",
        7n,
        {
          snapshots: [
            { slot_index: 0, answer_payload: { value: "1.50" }, action_seq: 1, client_timestamp_ms: 0 } as any,
          ],
        } as any,
      );
      expect(out.recorded_count).toBe(1);
      expect(out.scored_count).toBe(1);

      // The 2nd $queryRawUnsafe call is the gated INSERT — assert the CTE is
      // present and filters on both submitted_at and expires_at.
      const insertCall = prisma.$queryRawUnsafe.mock.calls[1]!;
      const sql = insertCall[0] as string;
      expect(sql).toMatch(/WITH\s+live\s+AS/);
      expect(sql).toMatch(/submitted_at\s+IS\s+NULL/);
      expect(sql).toMatch(/expires_at\s+IS\s+NULL\s+OR\s+expires_at\s*>\s*now\(\)/);
      // INSERT … SELECT … FROM live — no row materialises if `live` is empty.
      expect(sql).toMatch(/FROM\s+live/);
    });

    it("scored_count reflects the gated INSERT result (0 rows = session was submitted between load and write)", async () => {
      prisma.$queryRawUnsafe
        .mockResolvedValueOnce([
          {
            id: 1n,
            test_id: 10n,
            test_assignment_id: 5n,
            student_id: 7n,
            session_secret_current: Buffer.from("0".repeat(32)),
            session_secret_previous: null,
            secret_rotated_at: null,
            started_at: new Date(),
            expires_at: new Date(Date.now() + 60_000),
            submitted_at: null,
            status: "ACTIVE",
            auto_submit_source: null,
            violations_count: 0,
            frozen_question_codes: ["MAT.A.B.C.001"],
          },
        ])
        // CTE returned 0 rows → INSERT inserted nothing → RETURNING empty
        .mockResolvedValueOnce([]);
      prisma.$executeRawUnsafe.mockResolvedValue(undefined);

      const out = await svc.lateSnapshots(
        "1",
        7n,
        {
          snapshots: [
            { slot_index: 0, answer_payload: null, action_seq: 1, client_timestamp_ms: 0 } as any,
          ],
        } as any,
      );
      // Still recorded (audit row written) but NOT scored.
      expect(out.recorded_count).toBe(1);
      expect(out.scored_count).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // M4: 3rd violation → server-side auto-submit
  // -----------------------------------------------------------------------
  describe("logViolation (M4 — server-side auto-submit on threshold)", () => {
    it("3rd violation triggers in-tx auto-submit with source=VIOLATION_THRESHOLD", async () => {
      // First $queryRawUnsafe outside the tx: loadSessionOwned.
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        {
          id: 1n,
          test_id: 10n,
          test_assignment_id: 5n,
          student_id: 7n,
          session_secret_current: Buffer.from("0".repeat(32)),
          session_secret_previous: null,
          secret_rotated_at: null,
          started_at: new Date(),
          expires_at: new Date(Date.now() + 60_000),
          submitted_at: null,
          status: "ACTIVE",
          auto_submit_source: null,
          violations_count: 2, // about to become 3
          frozen_question_codes: [],
        },
      ]);

      // $transaction runs the callback with a fake tx. The fake tx replays
      // the inner sequence: increment counter, audit insert, then the inner
      // submit pipeline.
      prisma.$transaction.mockImplementation(async (cb: any) => {
        const tx: any = {
          $queryRawUnsafe: jest.fn(),
          $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
        };
        tx.$queryRawUnsafe
          // UPDATE test_sessions SET violations_count++ RETURNING
          .mockResolvedValueOnce([{ violations_count: 3 }])
          // runSubmitInTransaction: SELECT * FOR UPDATE
          .mockResolvedValueOnce([
            {
              id: 1n,
              test_id: 10n,
              test_assignment_id: 5n,
              student_id: 7n,
              session_secret_current: Buffer.from("0".repeat(32)),
              session_secret_previous: null,
              secret_rotated_at: null,
              started_at: new Date(),
              expires_at: new Date(Date.now() + 60_000),
              submitted_at: null,
              status: "ACTIVE",
              auto_submit_source: null,
              violations_count: 3,
              frozen_question_codes: [],
            },
          ])
          // SELECT snapshots — empty (no answered slots, normal for an
          // anti-cheat auto-submit on round 0).
          .mockResolvedValueOnce([])
          // UPDATE test_sessions SET submitted_at=now() ... RETURNING
          .mockResolvedValueOnce([{ submitted_at: new Date("2026-06-29T00:00:00Z") }]);
        return cb(tx);
      });

      const out = await svc.logViolation(
        "1",
        7n,
        {
          violation_type: "TAB_SWITCH",
          was_active: true,
          client_timestamp_ms: 1,
        } as any,
      );
      expect(out.violations_count).toBe(3);
      expect(out.will_auto_submit).toBe(true);
      expect(out.auto_submitted).toBe(true);
      expect(out.submit_result?.auto_submit_source).toBe("VIOLATION_THRESHOLD");
    });

    it("1st violation does NOT trigger auto-submit", async () => {
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        {
          id: 1n,
          test_id: 10n,
          test_assignment_id: 5n,
          student_id: 7n,
          session_secret_current: Buffer.from("0".repeat(32)),
          session_secret_previous: null,
          secret_rotated_at: null,
          started_at: new Date(),
          expires_at: new Date(Date.now() + 60_000),
          submitted_at: null,
          status: "ACTIVE",
          auto_submit_source: null,
          violations_count: 0,
          frozen_question_codes: [],
        },
      ]);

      prisma.$transaction.mockImplementation(async (cb: any) => {
        const tx: any = {
          $queryRawUnsafe: jest.fn(),
          $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
        };
        tx.$queryRawUnsafe
          .mockResolvedValueOnce([{ violations_count: 1 }]);
        return cb(tx);
      });

      const out = await svc.logViolation(
        "1",
        7n,
        {
          violation_type: "TAB_SWITCH",
          was_active: true,
          client_timestamp_ms: 1,
        } as any,
      );
      expect(out.violations_count).toBe(1);
      expect(out.will_auto_submit).toBe(false);
      expect(out.auto_submitted).toBe(false);
      expect(out.submit_result).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // M1: submit issues batched lookups instead of per-slot N+1
  // -----------------------------------------------------------------------
  describe("submit (M1 — batched attempt_order + round lookups)", () => {
    it("submit transaction issues ONE attempt_order lookup, not N", async () => {
      const sessionRow = {
        id: 1n,
        test_id: 10n,
        test_assignment_id: 5n,
        student_id: 7n,
        session_secret_current: Buffer.from("0".repeat(32)),
        session_secret_previous: null,
        secret_rotated_at: null,
        started_at: new Date(),
        expires_at: new Date(Date.now() + 60_000),
        submitted_at: null,
        status: "ACTIVE",
        auto_submit_source: null,
        violations_count: 0,
        frozen_question_codes: ["X1", "X2", "X3"],
      };

      let attemptOrderLookupCount = 0;
      let roundLookupCount = 0;

      prisma.$transaction.mockImplementation(async (cb: any) => {
        const tx: any = {
          $queryRawUnsafe: jest.fn(),
          $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
        };
        tx.$queryRawUnsafe.mockImplementation((sql: string) => {
          if (/SELECT \* FROM test_sessions WHERE id = \$1 FOR UPDATE/.test(sql)) {
            return Promise.resolve([sessionRow]);
          }
          if (/SELECT slot_index, question_code, answer_payload/.test(sql)) {
            return Promise.resolve([
              { slot_index: 0, question_code: "X1", answer_payload: { selected_options: ["A"] }, time_seconds: 30, visit_count: 1, marked_for_review: false, hints_used: 0, last_action_at: new Date() },
              { slot_index: 1, question_code: "X2", answer_payload: { selected_options: ["A"] }, time_seconds: 30, visit_count: 1, marked_for_review: false, hints_used: 0, last_action_at: new Date() },
              { slot_index: 2, question_code: "X3", answer_payload: { selected_options: ["A"] }, time_seconds: 30, visit_count: 1, marked_for_review: false, hints_used: 0, last_action_at: new Date() },
            ]);
          }
          if (/FROM problems\s+WHERE question_code = ANY/.test(sql)) {
            return Promise.resolve([
              { question_code: "X1", answer_type: "MCQ_SC", answer: { correct_options: ["A"] }, topic_code: "T", subtopic_code: "S", idea_code: "I", sub_idea_code: "U" },
              { question_code: "X2", answer_type: "MCQ_SC", answer: { correct_options: ["B"] }, topic_code: "T", subtopic_code: "S", idea_code: "I", sub_idea_code: "U" },
              { question_code: "X3", answer_type: "MCQ_SC", answer: { correct_options: ["C"] }, topic_code: "T", subtopic_code: "S", idea_code: "I", sub_idea_code: "U" },
            ]);
          }
          if (/FROM attempts\s+WHERE student_id = \$1 AND question_code = ANY/.test(sql)) {
            attemptOrderLookupCount += 1;
            return Promise.resolve([{ question_code: "X1", c: 2n }]);
          }
          if (/FROM student_fingerprint_state\s+WHERE student_id = \$1/.test(sql)) {
            roundLookupCount += 1;
            return Promise.resolve([{ topic_code: "T", subtopic_code: "S", idea_code: "I", sub_idea_code: "U", round: "R2" }]);
          }
          if (/INSERT INTO attempts/.test(sql)) {
            return Promise.resolve([{ id: 100n }]);
          }
          if (/UPDATE test_sessions SET\s+submitted_at = now\(\)/.test(sql)) {
            return Promise.resolve([{ submitted_at: new Date("2026-06-29T00:00:00Z") }]);
          }
          return Promise.resolve([]);
        });
        return cb(tx);
      });

      const out = await svc.submit("1", 7n, {
        auto_submit: false,
        auto_submit_source: "MANUAL",
        client_final_state_hash: "h",
      } as any);
      expect(out.attempt_ids).toHaveLength(3);

      // M1 acceptance: ONE batched call each, regardless of slot count.
      expect(attemptOrderLookupCount).toBe(1);
      expect(roundLookupCount).toBe(1);
    });
  });
});
