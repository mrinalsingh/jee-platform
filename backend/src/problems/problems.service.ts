/**
 * Problems service — endpoint 14 (review write) of architecture §5.4.
 *
 * The cross-walk consensus trigger raises a structured `cross_walk_violation`
 * error (SQLSTATE 23514) when the new review would push the consensus outside
 * the JEE-Advanced band for the resulting T-bucket. We catch that here and
 * project a structured 422.
 *
 * [UPDATED v2 — B5] The 422 body now MUST carry the `existing_reviews` array
 * (architecture §5.4 endpoint 14). The reviewer UI uses this to render the
 * conflicting prior reviews so the teacher can coordinate. To compute it we
 * issue a follow-up read against `problem_reviews` after the failed INSERT —
 * the failed statement is auto-rolled-back so no lock is held when we read.
 *
 * [UPDATED v2 — N21] `raw_db_message` is no longer leaked to the API caller.
 * Postgres internals (trigger names, column names) stay server-side; we log
 * the underlying message to the structured logger instead.
 */

import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateReviewDto } from "./problems.dto";

interface PgError extends Error {
  code?: string;
  meta?: { code?: string; message?: string };
}

interface ExistingReviewRow {
  reviewer_role: string;
  t_rating: string;
  jee_authenticity_score: number | null;
  reviewed_at: Date | null;
}

@Injectable()
export class ProblemsService {
  private readonly log = new Logger("ProblemsService");

  constructor(private readonly prisma: PrismaService) {}

  /**
   * INSERT one row into `problem_reviews`. The AFTER trigger recomputes
   * consensus and may raise a structured cross-walk-violation error.
   *
   * Returns the new review's id plus the new consensus (looked up after the
   * trigger completes successfully).
   */
  async createReview(
    questionCode: string,
    dto: CreateReviewDto,
  ): Promise<{ review_id: string; new_consensus_t: string; new_consensus_score: number | null }> {
    try {
      // The trigger writes problems.{authored_difficulty, jee_authenticity_score}
      // before returning, so we read those after the INSERT in the same tx.
      const ins = await this.prisma.$queryRawUnsafe<Array<{ id: bigint }>>(
        `INSERT INTO problem_reviews
           (question_code, reviewer_role, t_rating, jee_authenticity_score, reviewed_at, notes)
         VALUES ($1, $2::"ReviewerRole", $3::"IntrinsicDifficulty", $4, now(), $5)
         RETURNING id`,
        questionCode,
        dto.reviewer_role,
        dto.t_rating,
        dto.jee_authenticity_score ?? null,
        dto.notes ?? null,
      );

      const consensus = await this.prisma.$queryRawUnsafe<
        Array<{ authored_difficulty: string; jee_authenticity_score: number | null }>
      >(
        `SELECT authored_difficulty, jee_authenticity_score FROM problems WHERE question_code = $1`,
        questionCode,
      );
      if (consensus.length === 0) {
        throw new BadRequestException({
          error: "problem_not_found",
          message: `problem ${questionCode} does not exist`,
        });
      }
      return {
        review_id: ins[0]!.id.toString(),
        new_consensus_t: consensus[0]!.authored_difficulty,
        new_consensus_score: consensus[0]!.jee_authenticity_score,
      };
    } catch (e) {
      // Project to the structured API contract. `projectPgError` is now async
      // so the cross-walk path can read existing reviews for the 422 body.
      await this.projectPgError(e as PgError, questionCode, dto);
      throw e;
    }
  }

  /**
   * Translate Postgres errors into the API contract from architecture §5.4:
   *   - SQLSTATE 23514 + message-prefix `cross_walk_violation:` → 422 with
   *     structured body (band_bounds, your_pair, existing_reviews,
   *     retry_guidance) per architecture §5.4 endpoint 14.
   *   - SQLSTATE 23514 otherwise (e.g. `chk_score_range`) → 400 invalid_score.
   *   - SQLSTATE 23503 (FK violation, problem unknown) → 400 problem_not_found.
   *
   * [UPDATED v2 — B5] The 422 path now fetches `existing_reviews` and parses
   * the trigger's structured `cross_walk_violation: band=[lo,hi]; …` payload
   * to surface `band_bounds`. The fetch happens after the rollback so the
   * FOR UPDATE lock acquired by the trigger is already released.
   */
  private async projectPgError(
    err: PgError,
    questionCode: string,
    dto: CreateReviewDto,
  ): Promise<never | void> {
    // The Prisma adapter wraps node-postgres errors; the SQLSTATE may be on
    // err.code OR err.meta.code depending on driver path.
    const code = err.code ?? err.meta?.code;
    const message = err.message ?? err.meta?.message ?? "";

    if (code === "23514" && message.includes("cross_walk_violation:")) {
      // Log raw DB message server-side only — never returned to the caller.
      this.log.warn(`cross_walk_violation qc=${questionCode}: ${message}`);

      const existingReviews = await this.loadExistingReviews(questionCode);
      const bandBounds = this.parseBandBounds(message);

      throw new HttpException(
        {
          error_code: "cross_walk_violation",
          message:
            "Your review would push the consensus outside the JEE-Advanced cross-walk band for the resulting T-bucket.",
          band_bounds: bandBounds,
          your_pair: {
            t_rating: dto.t_rating,
            jee_authenticity_score: dto.jee_authenticity_score ?? null,
          },
          existing_reviews: existingReviews,
          retry_guidance:
            "Either revise your jee_authenticity_score, OR coordinate with the other reviewers so the consensus falls back inside the band.",
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (code === "23514") {
      throw new HttpException(
        {
          error_code: "invalid_score",
          message: "jee_authenticity_score must be in [0, 10].",
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (code === "23503") {
      throw new HttpException(
        {
          error_code: "problem_not_found",
          message: `problem ${questionCode} does not exist`,
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    // Anything else: let the controller see the original error so it surfaces
    // as a 500. The interceptor in main.ts logs the stack.
  }

  /**
   * [UPDATED v2 — B5] Read the currently-committed reviews so the 422 body
   * tells the reviewer exactly which prior reviews they're conflicting with.
   * Projection is intentionally narrow (no `notes`, no raw IDs) to avoid
   * over-sharing inside reviewer-facing UI.
   */
  private async loadExistingReviews(
    questionCode: string,
  ): Promise<
    Array<{
      reviewer_role: string;
      t_rating: string;
      jee_authenticity_score: number | null;
      reviewed_at: string | null;
    }>
  > {
    const rows = await this.prisma.$queryRawUnsafe<ExistingReviewRow[]>(
      `SELECT reviewer_role::text AS reviewer_role,
              t_rating::text       AS t_rating,
              jee_authenticity_score,
              reviewed_at
       FROM problem_reviews
       WHERE question_code = $1
       ORDER BY reviewed_at ASC`,
      questionCode,
    );
    return rows.map((r) => ({
      reviewer_role: r.reviewer_role,
      t_rating: r.t_rating,
      jee_authenticity_score: r.jee_authenticity_score,
      reviewed_at: r.reviewed_at?.toISOString() ?? null,
    }));
  }

  /**
   * [UPDATED v2 — B5] Parse the trigger's structured message body. The
   * consensus trigger raises:
   *   RAISE EXCEPTION 'cross_walk_violation: band=[%, %]; new_pair=(%, %); …'
   * If the band cannot be parsed (older trigger format, future format change),
   * we return null and let the API caller fall back to retry_guidance.
   */
  private parseBandBounds(
    message: string,
  ): { lower: number; upper: number } | null {
    const m = /band=\[\s*([\d.]+)\s*,\s*([\d.]+)\s*\]/.exec(message);
    if (!m) return null;
    const lower = Number(m[1]);
    const upper = Number(m[2]);
    if (!Number.isFinite(lower) || !Number.isFinite(upper)) return null;
    return { lower, upper };
  }
}
