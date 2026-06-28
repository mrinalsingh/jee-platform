#!/usr/bin/env node
// scripts/import-yaml.ts
//
// Imports .yaml problem files (per /content/maths/generated/_SCHEMA.md) into
// the problems table. Idempotent: upserts on question_code. Refuses to
// overwrite a problem already marked `calibrated` — those are immutable.
//
// v2 (Stage 3 — Engineer-Backend track): validates + accepts the new YAML fields
// introduced in Architecture v2 and the Requirements A–Q reconciliation:
//   - target_exam (REQUIRED) — TargetExam enum
//   - syllabus_status (optional, default WITHIN_SYLLABUS) — SyllabusStatus enum
//   - hints (optional, default []) — [{ level, text, reveals_idea? }]
//   - is_above_target_difficulty (optional, default false)
//   - better_fit_exam (optional, default null) — TargetExam | null
//   - reviews (array; minimum 1 entry) — each becomes a ProblemReview row
//
// The diagnostic-summary columns (err_*_tags, hint_count) are trigger-maintained
// per migration 0006 — the importer does NOT write them directly.
//
// Cross-walk handling: the AFTER trigger on problem_reviews may RAISE EXCEPTION
// with SQLSTATE 23514 + message-prefix `cross_walk_violation:`. The importer
// catches that and refuses the file (no partial commits — fail-stop per file).
//
// Usage:
//   npx tsx scripts/import-yaml.ts <file.yaml>
//   npx tsx scripts/import-yaml.ts <directory>
//
// Exit codes:
//   0  all files validated + persisted
//   1  one or more validation failures (no partial commits)

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { normalizeNumDec } from "../src/lib/numeric";

// =============================================================================
// Types — mirror the contract in /content/maths/generated/_SCHEMA.md
// =============================================================================

interface FingerprintYaml {
  topic: string;
  subtopic: string;
  idea: string;
  sub_idea: string;
  answer_type: string;
  surface: string;
  trap: string;
}

interface HintYaml {
  level: number;
  text: string;
  reveals_idea?: boolean;
}

interface ReviewYaml {
  reviewer_role: string;
  T_rating?: string; // YAML uses upper-case `T_rating`; we normalise to lower
  t_rating?: string;
  jee_authenticity_score?: number;
  reviewed_at?: string;
  notes?: string;
}

interface ProblemYaml {
  schema_version: number;
  question_code: string;
  fingerprint: FingerprintYaml;
  target_exam: string; // Req B — REQUIRED
  syllabus_status?: string; // Req H
  is_above_target_difficulty?: boolean; // Req Q
  better_fit_exam?: string | null; // Req Q
  hints?: HintYaml[]; // Req G
  authored_difficulty: string;
  authored_time_by_round: Record<string, number>;
  status: "provisional" | "calibrated";
  provenance: Record<string, unknown>;
  statement: string;
  answer: Record<string, unknown>;
  solution: string;
  wrong_paths: Array<Record<string, unknown>>;
  reviews?: ReviewYaml[]; // Req C
  review_notes?: string;
}

// =============================================================================
// Enum sets — match the Prisma schema (which uses underscores instead of dashes)
// =============================================================================

const TARGET_EXAMS = new Set([
  "JEE_ADVANCED",
  "JEE_MAIN",
  "IOQM",
  "INMO",
  "RMO",
  "KVPY",
  "COACHING",
  "ORIGINAL",
  "OTHER",
]);

const SYLLABUS_STATUSES = new Set([
  "WITHIN_SYLLABUS",
  "BORDERLINE",
  "BEYOND_SYLLABUS",
]);

const REVIEWER_ROLES = new Set([
  "jee_platform_critic",
  "jee_mcq_critic",
  "human_reviewer_primary",
  "human_reviewer_secondary",
  "automated_calibration",
]);

const T_RATINGS = new Set(["T1", "T2", "T3", "T4", "T5"]);

// =============================================================================
// Helpers
// =============================================================================

function toEnum(s: string): string {
  return s.replace(/-/g, "_");
}

function parseCode(code: string): {
  topic: string;
  subtopic: string;
  idea: string;
  sub_idea: string;
  serial: number;
} | null {
  const parts = code.split(".");
  if (parts.length !== 5) return null;
  const serial = parseInt(parts[4], 10);
  if (isNaN(serial)) return null;
  return {
    topic: parts[0],
    subtopic: parts[1],
    idea: parts[2],
    sub_idea: parts[3],
    serial,
  };
}

// =============================================================================
// Validation
// =============================================================================

function validate(yml: ProblemYaml, filepath: string): string[] {
  const errors: string[] = [];

  if (yml.schema_version !== 1) {
    errors.push(`schema_version must be 1, got ${JSON.stringify(yml.schema_version)}`);
  }

  const required: (keyof ProblemYaml)[] = [
    "question_code",
    "fingerprint",
    "target_exam",
    "authored_difficulty",
    "authored_time_by_round",
    "statement",
    "answer",
    "solution",
    "wrong_paths",
    "status",
    "provenance",
  ];
  for (const f of required) {
    if (yml[f] === undefined || yml[f] === null) errors.push(`missing required field: ${f}`);
  }

  if (yml.fingerprint) {
    const fpKeys: (keyof FingerprintYaml)[] = [
      "topic",
      "subtopic",
      "idea",
      "sub_idea",
      "answer_type",
      "surface",
      "trap",
    ];
    for (const k of fpKeys) {
      if (!yml.fingerprint[k]) errors.push(`missing fingerprint.${k}`);
    }
  }

  // Req B: target_exam must be a known enum value
  if (yml.target_exam && !TARGET_EXAMS.has(toEnum(yml.target_exam))) {
    errors.push(`target_exam "${yml.target_exam}" not in known set; see _SCHEMA.md`);
  }

  // Req H: syllabus_status, when present, must be a known enum value
  if (yml.syllabus_status && !SYLLABUS_STATUSES.has(toEnum(yml.syllabus_status))) {
    errors.push(`syllabus_status "${yml.syllabus_status}" not in known set`);
  }

  // Req Q: better_fit_exam, when set, must reuse the TargetExam enum
  if (yml.better_fit_exam && !TARGET_EXAMS.has(toEnum(yml.better_fit_exam))) {
    errors.push(`better_fit_exam "${yml.better_fit_exam}" not in known set`);
  }

  // Req Q: is_above_target_difficulty must be boolean if present
  if (
    yml.is_above_target_difficulty !== undefined &&
    typeof yml.is_above_target_difficulty !== "boolean"
  ) {
    errors.push("is_above_target_difficulty must be boolean");
  }

  // Req G: hints array shape
  if (yml.hints !== undefined) {
    if (!Array.isArray(yml.hints)) {
      errors.push("hints must be an array");
    } else {
      yml.hints.forEach((h, i) => {
        if (typeof h.level !== "number" || !Number.isInteger(h.level) || h.level < 1) {
          errors.push(`hints[${i}].level must be a positive integer`);
        }
        if (typeof h.text !== "string" || h.text.length === 0) {
          errors.push(`hints[${i}].text must be a non-empty string`);
        }
      });
    }
  }

  // Req C: reviews array — when present, each entry needs role + t_rating
  if (yml.reviews !== undefined) {
    if (!Array.isArray(yml.reviews) || yml.reviews.length === 0) {
      errors.push("reviews must be a non-empty array when present");
    } else {
      yml.reviews.forEach((r, i) => {
        if (!r.reviewer_role || !REVIEWER_ROLES.has(r.reviewer_role)) {
          errors.push(`reviews[${i}].reviewer_role missing or invalid`);
        }
        const t = (r.T_rating ?? r.t_rating ?? "").toString();
        if (!T_RATINGS.has(t)) {
          errors.push(`reviews[${i}].t_rating must be one of T1..T5 (got ${t})`);
        }
        if (
          r.jee_authenticity_score !== undefined &&
          (typeof r.jee_authenticity_score !== "number" ||
            r.jee_authenticity_score < 0 ||
            r.jee_authenticity_score > 10)
        ) {
          errors.push(`reviews[${i}].jee_authenticity_score must be in [0, 10]`);
        }
      });
    }
  }

  // answer.precision is required for NUM-DEC (architecture §2 + _SCHEMA.md §Req R)
  if (yml.fingerprint?.answer_type === "NUM-DEC" || yml.fingerprint?.answer_type === "NUM_DEC") {
    const ans = yml.answer as { precision?: number; value?: number | string };
    if (typeof ans?.precision !== "number" || !Number.isInteger(ans.precision) || ans.precision < 0) {
      errors.push(
        `answer.precision is required and must be a non-negative integer for NUM-DEC answers`,
      );
    }
    if (ans?.value === undefined || ans.value === null) {
      errors.push(`answer.value is required for NUM-DEC answers`);
    } else if (typeof ans.precision === "number") {
      // Pre-normalise to catch garbage NOW (rather than during runtime compare).
      try {
        normalizeNumDec(ans.value as any, ans.precision);
      } catch (e: any) {
        errors.push(`answer.value not normalisable at precision ${ans.precision}: ${e.message}`);
      }
    }
  }

  if (!Array.isArray(yml.wrong_paths)) errors.push("wrong_paths must be an array");
  else if (yml.wrong_paths.length < 1) errors.push("wrong_paths must contain at least 1 entry");

  // Filename must match question_code
  const expected = `${yml.question_code}.yaml`;
  if (path.basename(filepath) !== expected) {
    errors.push(
      `filename "${path.basename(filepath)}" doesn't match question_code "${yml.question_code}" (expected "${expected}")`,
    );
  }

  // question_code structure + fingerprint internal consistency
  const parsed = parseCode(yml.question_code);
  if (!parsed) {
    errors.push(`question_code "${yml.question_code}" doesn't parse as TOPIC.SUBTOPIC.IDEA.SUB_IDEA.NNN`);
  } else if (yml.fingerprint) {
    if (parsed.topic !== yml.fingerprint.topic)
      errors.push(`code topic "${parsed.topic}" ≠ fingerprint.topic "${yml.fingerprint.topic}"`);
    if (parsed.subtopic !== yml.fingerprint.subtopic)
      errors.push(`code subtopic "${parsed.subtopic}" ≠ fingerprint.subtopic "${yml.fingerprint.subtopic}"`);
    if (parsed.idea !== yml.fingerprint.idea)
      errors.push(`code idea "${parsed.idea}" ≠ fingerprint.idea "${yml.fingerprint.idea}"`);
    if (parsed.sub_idea !== yml.fingerprint.sub_idea)
      errors.push(`code sub_idea "${parsed.sub_idea}" ≠ fingerprint.sub_idea "${yml.fingerprint.sub_idea}"`);
  }

  return errors;
}

// =============================================================================
// Per-file import
// =============================================================================

type Outcome = "inserted" | "updated" | "skipped" | "failed";

async function importFile(prisma: PrismaClient, filepath: string): Promise<Outcome> {
  let yml: ProblemYaml;
  try {
    yml = yaml.load(fs.readFileSync(filepath, "utf-8")) as ProblemYaml;
  } catch (e: any) {
    console.error(`❌ ${path.basename(filepath)} — YAML parse error: ${e.message}`);
    return "failed";
  }

  const errors = validate(yml, filepath);
  if (errors.length > 0) {
    console.error(`❌ ${path.basename(filepath)} — validation failed:`);
    errors.forEach((e) => console.error(`   • ${e}`));
    return "failed";
  }

  const parsed = parseCode(yml.question_code)!;

  // Respect immutability of calibrated problems.
  const existing = await prisma.problem.findUnique({
    where: { questionCode: yml.question_code },
    select: { status: true },
  });
  if (existing?.status === "calibrated") {
    console.warn(`⚠️  ${yml.question_code} — already calibrated; skipping (create a new serial to revise)`);
    return "skipped";
  }

  const data: any = {
    questionCode: yml.question_code,
    topicCode: yml.fingerprint.topic,
    subtopicCode: yml.fingerprint.subtopic,
    ideaCode: yml.fingerprint.idea,
    subIdeaCode: yml.fingerprint.sub_idea,
    serial: parsed.serial,
    answerType: toEnum(yml.fingerprint.answer_type),
    surface: toEnum(yml.fingerprint.surface),
    trap: toEnum(yml.fingerprint.trap),
    authoredDifficulty: yml.authored_difficulty,
    authoredTimeByRound: yml.authored_time_by_round,
    targetExam: toEnum(yml.target_exam),
    syllabusStatus: toEnum(yml.syllabus_status ?? "WITHIN_SYLLABUS"),
    isAboveTargetDifficulty: yml.is_above_target_difficulty ?? false,
    betterFitExam: yml.better_fit_exam ? toEnum(yml.better_fit_exam) : null,
    hints: yml.hints ?? [],
    statement: yml.statement,
    answer: yml.answer,
    solution: yml.solution,
    wrongPaths: yml.wrong_paths,
    status: yml.status,
    sourceMetadata: yml.provenance,
  };

  // Trigger-maintained columns (err_*_tags, hint_count) are NEVER written here —
  // migration 0006 REVOKEs column UPDATE on them from app_user.

  try {
    await prisma.$transaction(async (tx) => {
      if (existing) {
        await (tx as any).problem.update({
          where: { questionCode: yml.question_code },
          data,
        });
      } else {
        await (tx as any).problem.create({ data });
      }

      // Reviews — one ProblemReview row per entry. The AFTER trigger
      // recomputes consensus and may raise cross_walk_violation.
      if (Array.isArray(yml.reviews) && yml.reviews.length > 0) {
        // Clear any prior backfilled review for this problem before re-writing
        // so the importer remains idempotent on the reviews set. The trigger
        // recomputes on each delete + insert.
        await tx.$executeRawUnsafe(
          `DELETE FROM problem_reviews WHERE question_code = $1`,
          yml.question_code,
        );
        for (const r of yml.reviews) {
          const tRating = (r.T_rating ?? r.t_rating)!;
          await tx.$executeRawUnsafe(
            `INSERT INTO problem_reviews
               (question_code, reviewer_role, t_rating, jee_authenticity_score,
                reviewed_at, notes, provenance)
             VALUES ($1, $2::"ReviewerRole", $3::"IntrinsicDifficulty", $4,
                     COALESCE($5::timestamptz, now()), $6, $7::jsonb)`,
            yml.question_code,
            r.reviewer_role,
            tRating,
            r.jee_authenticity_score ?? null,
            r.reviewed_at ?? null,
            r.notes ?? null,
            JSON.stringify({ backfilled: false, source: "import-yaml" }),
          );
        }
      }
    });
  } catch (e: any) {
    const code = e?.code ?? e?.meta?.code;
    const message = e?.message ?? e?.meta?.message ?? "";
    if (code === "23514" && message.includes("cross_walk_violation:")) {
      console.error(
        `❌ ${yml.question_code} — cross-walk violation: the supplied reviews would push the consensus outside the JEE-Advanced band. Revise the t_rating / jee_authenticity_score and re-import.`,
      );
      console.error(`   Postgres said: ${message}`);
      return "failed";
    }
    if (code === "23514") {
      console.error(`❌ ${yml.question_code} — CHECK constraint failed: ${message}`);
      return "failed";
    }
    throw e;
  }

  if (existing) {
    console.log(`✏️  ${yml.question_code} — updated`);
    return "updated";
  } else {
    console.log(`✅ ${yml.question_code} — inserted`);
    return "inserted";
  }
}

// =============================================================================
// CLI entry point
// =============================================================================

async function main(): Promise<void> {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: npx tsx scripts/import-yaml.ts <file.yaml | directory>");
    process.exit(2);
  }

  const stat = fs.statSync(target);
  const files = stat.isDirectory()
    ? fs.readdirSync(target).filter((f) => f.endsWith(".yaml")).map((f) => path.join(target, f))
    : [target];

  if (files.length === 0) {
    console.warn("No .yaml files found.");
    return;
  }

  // [UPDATED v2 — M5] The importer is a privileged authoring tool: it inserts
  // into `problem_reviews`, which fires the consensus AFTER trigger that
  // UPDATEs `problems.{authored_difficulty, jee_authenticity_score}` — columns
  // the runtime role `app_user_login` has been REVOKEd UPDATE on (migration
  // 0012). The trigger function runs SECURITY DEFINER as `trigger_owner`, so
  // today the importer accidentally works under `app_user_login`. That is a
  // brittle dependency: if the SECURITY DEFINER setup is ever changed (e.g.
  // future hardening pass) the importer silently breaks at runtime. Pin it
  // explicitly to `MIGRATION_DATABASE_URL` (== `app_user_migration` connection
  // string) so it always runs under the role that owns the relevant tables.
  //
  // Fallback to DATABASE_URL only if MIGRATION_DATABASE_URL is unset AND
  // explicitly allowed via IMPORTER_ALLOW_RUNTIME_URL=1, so CI/dev convenience
  // does not silently regress production runs.
  const migrationUrl = process.env.MIGRATION_DATABASE_URL;
  const fallbackAllowed = process.env.IMPORTER_ALLOW_RUNTIME_URL === "1";
  let connectionString: string | undefined;
  if (migrationUrl) {
    connectionString = migrationUrl;
  } else if (fallbackAllowed && process.env.DATABASE_URL) {
    console.warn(
      "WARNING: MIGRATION_DATABASE_URL not set; falling back to DATABASE_URL because IMPORTER_ALLOW_RUNTIME_URL=1.",
    );
    connectionString = process.env.DATABASE_URL;
  } else {
    console.error(
      "MIGRATION_DATABASE_URL not set. The importer writes to schema-owned\n" +
        "tables (problem_reviews → consensus trigger → problems UPDATE) which\n" +
        "require the migration role's privileges. Set MIGRATION_DATABASE_URL in\n" +
        "backend/.env (it should point to the `app_user_migration` connection).\n" +
        "If you genuinely want to import under the runtime role (not recommended),\n" +
        "re-run with IMPORTER_ALLOW_RUNTIME_URL=1.",
    );
    process.exit(2);
  }
  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter } as any);
  const totals: Record<Outcome, number> = { inserted: 0, updated: 0, skipped: 0, failed: 0 };

  try {
    console.log(`Importing ${files.length} file(s)…\n`);
    for (const f of files) {
      const outcome = await importFile(prisma, f);
      totals[outcome]++;
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log(`\n--- summary ---`);
  console.log(`inserted: ${totals.inserted}`);
  console.log(`updated:  ${totals.updated}`);
  console.log(`skipped:  ${totals.skipped}`);
  console.log(`failed:   ${totals.failed}`);

  process.exit(totals.failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
