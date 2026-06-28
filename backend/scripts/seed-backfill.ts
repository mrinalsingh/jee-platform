#!/usr/bin/env node
// scripts/seed-backfill.ts
//
// One-off backfill that runs AFTER migrations 0002..0013 have been applied
// to populate jee_authenticity_score for the 179 existing problem rows,
// emit one synthetic jee_platform_critic review per row, and mark the
// backfill provenance flags in source_metadata.
//
// Idempotency contract:
//   * Every row gets a marker `source_metadata.backfill.score_v1 = true`.
//     If the marker is already set on a row, the script does NOT touch it
//     again. Safe to re-run as many times as you like.
//   * The synthetic review is inserted only if no
//     (question_code, reviewer_role = 'jee_platform_critic',
//      provenance.review_backfilled = true) row already exists.
//
// Usage:
//   npx tsx scripts/seed-backfill.ts            # against $DATABASE_URL
//
// Exit codes:
//   0  backfill complete (or no-op because all rows already marked)
//   1  one or more rows could not be backfilled (logged per row)
//
// Run as app_user OR migration_user. app_user is sufficient because:
//   * problems.jee_authenticity_score is NOT trigger-maintained, and
//     app_user holds UPDATE on that column.
//   * problem_reviews.INSERT is granted to app_user.
//   * source_metadata is JSONB and not trigger-maintained.
// However, the consensus AFTER-trigger fires on each review INSERT and
// recomputes problems.authored_difficulty + jee_authenticity_score. The
// values we precompute below land in the cross-walk band, so the trigger's
// cross-walk pre-check passes and the values are written through unchanged.

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

// -----------------------------------------------------------------------------
// Cross-walk midpoint table. Bands per architecture §3.1 #1.
// We pick the midpoint of each [low, high) interval so the synthetic score
// stays comfortably inside the band even after the consensus trigger averages
// it with the existing T-rating (round-tripping yields the same band).
// -----------------------------------------------------------------------------
const CROSSWALK_MIDPOINT: Record<string, number> = {
  T1: (8.5 + 8.8) / 2,    // 8.65
  T2: (8.8 + 9.2) / 2,    // 9.00
  T3: (9.2 + 9.5) / 2,    // 9.35
  T4: (9.5 + 9.8) / 2,    // 9.65
  T5: (9.8 + 10.0) / 2,   // 9.90
};

const BACKFILL_VERSION_KEY = "backfill" as const;
const BACKFILL_MARKER = { score_v1: true } as const;

interface BackfillRow {
  question_code: string;
  authored_difficulty: keyof typeof CROSSWALK_MIDPOINT;
  target_exam: string;
  source_metadata: Record<string, unknown> | null;
}

async function main(): Promise<number> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set. Aborting.");
    return 1;
  }

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  let updated = 0;
  let skipped = 0;
  let reviewsCreated = 0;
  let failed = 0;

  try {
    const rows = await prisma.$queryRawUnsafe<BackfillRow[]>(`
      SELECT question_code,
             authored_difficulty::text AS authored_difficulty,
             target_exam::text          AS target_exam,
             source_metadata
        FROM problems
       ORDER BY question_code
    `);

    if (rows.length === 0) {
      console.log("No problems to backfill. Done.");
      return 0;
    }

    console.log(`Found ${rows.length} problem rows. Beginning backfill...`);

    for (const row of rows) {
      const already = isMarked(row.source_metadata);
      if (already) {
        skipped++;
        continue;
      }

      const t = row.authored_difficulty as keyof typeof CROSSWALK_MIDPOINT;
      const score = CROSSWALK_MIDPOINT[t];
      if (score === undefined) {
        console.error(
          `[skip] ${row.question_code}: unrecognised authored_difficulty=${t}`,
        );
        failed++;
        continue;
      }

      const metadataPatch = buildPatchedMetadata(row.source_metadata, score);

      try {
        await prisma.$transaction(async (tx) => {
          // 1. Update problems with the backfilled score + provenance flags.
          //    The score must satisfy chk_score_range (0..10) and, for
          //    JEE_ADVANCED rows, the chk_crosswalk_jee_advanced CHECK.
          //    Both are satisfied by construction.
          await tx.$executeRawUnsafe(
            `
            UPDATE problems
               SET jee_authenticity_score = $1,
                   source_metadata        = $2::jsonb
             WHERE question_code = $3
            `,
            score,
            JSON.stringify(metadataPatch),
            row.question_code,
          );

          // 2. Insert the synthetic jee_platform_critic review. The AFTER
          //    trigger fn_recompute_problem_consensus fires; with one
          //    review at the same t_rating + same score, the consensus is
          //    unchanged and the cross-walk pre-check passes.
          //    Idempotent: ON CONFLICT DO NOTHING is not available without
          //    a unique constraint, so we pre-check.
          const existing = await tx.$queryRawUnsafe<Array<{ id: bigint }>>(
            `
            SELECT id FROM problem_reviews
             WHERE question_code = $1
               AND reviewer_role = 'jee_platform_critic'
               AND (provenance->>'review_backfilled')::boolean IS TRUE
             LIMIT 1
            `,
            row.question_code,
          );
          if (existing.length === 0) {
            await tx.$executeRawUnsafe(
              `
              INSERT INTO problem_reviews
                (question_code, reviewer_role, t_rating, jee_authenticity_score,
                 notes, provenance)
              VALUES ($1, 'jee_platform_critic', $2::"IntrinsicDifficulty", $3,
                      $4, $5::jsonb)
              `,
              row.question_code,
              t,
              score,
              "Synthetic backfilled review at migration boundary.",
              JSON.stringify({ review_backfilled: true, source: "seed-backfill.ts" }),
            );
            reviewsCreated++;
          }
        });

        updated++;
      } catch (err) {
        console.error(`[fail] ${row.question_code}:`, err);
        failed++;
      }
    }

    console.log("");
    console.log("=== Backfill summary ===");
    console.log(`  Rows updated         : ${updated}`);
    console.log(`  Rows skipped (marked): ${skipped}`);
    console.log(`  Synthetic reviews    : ${reviewsCreated}`);
    console.log(`  Failures             : ${failed}`);

    return failed > 0 ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

function isMarked(meta: Record<string, unknown> | null): boolean {
  if (!meta) return false;
  const node = meta[BACKFILL_VERSION_KEY];
  return (
    typeof node === "object" &&
    node !== null &&
    (node as Record<string, unknown>).score_v1 === true
  );
}

function buildPatchedMetadata(
  current: Record<string, unknown> | null,
  score: number,
): Record<string, unknown> {
  const base = current ? { ...current } : {};

  // target_exam_inferred: the architecture says rows that took the default
  // JEE_ADVANCED during 0005 should carry this flag. The migration sets it
  // already; we ensure it survives our merge.
  if (base["target_exam_inferred"] === undefined) {
    base["target_exam_inferred"] = true;
  }

  base["score_source"] = "backfilled_from_T_midpoint";
  base["score_backfilled_at_midpoint"] = Number(score.toFixed(2));
  base[BACKFILL_VERSION_KEY] = BACKFILL_MARKER;
  return base;
}

void main().then(
  (code) => process.exit(code),
  (err) => {
    console.error("Backfill aborted with unexpected error:", err);
    process.exit(1);
  },
);
