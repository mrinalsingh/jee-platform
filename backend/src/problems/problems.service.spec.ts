/**
 * Problems service unit tests.
 *
 * [UPDATED v2 — B5] Asserts the 422 cross-walk-violation body shape required
 * by architecture §5.4 endpoint 14:
 *   { error_code, message, band_bounds, your_pair, existing_reviews,
 *     retry_guidance }
 * v1's body only carried `details` and `retry_guidance` — the reviewer UI
 * cannot show the teacher which prior reviews they're conflicting with
 * without `existing_reviews`.
 *
 * [UPDATED v2 — N21] Asserts `raw_db_message` is NOT present (no leak of
 * Postgres trigger/column internals to the caller).
 */

import { Test } from "@nestjs/testing";
import { HttpException } from "@nestjs/common";
import { ProblemsService } from "./problems.service";
import { PrismaService } from "../prisma/prisma.service";

describe("ProblemsService", () => {
  let svc: ProblemsService;
  let prisma: { $queryRawUnsafe: jest.Mock };

  beforeEach(async () => {
    prisma = { $queryRawUnsafe: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        ProblemsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    svc = mod.get(ProblemsService);
  });

  it("happy path: returns review id + new consensus", async () => {
    prisma.$queryRawUnsafe
      // INSERT
      .mockResolvedValueOnce([{ id: 42n }])
      // SELECT consensus
      .mockResolvedValueOnce([
        { authored_difficulty: "T3", jee_authenticity_score: 9.2 },
      ]);
    const out = await svc.createReview("MAT.SPL.X.Y.001", {
      reviewer_role: "jee_platform_critic",
      t_rating: "T3",
      jee_authenticity_score: 9.2,
    } as any);
    expect(out.review_id).toBe("42");
    expect(out.new_consensus_t).toBe("T3");
    expect(out.new_consensus_score).toBe(9.2);
  });

  it("422 cross-walk: body carries existing_reviews + band_bounds + your_pair (B5)", async () => {
    // Simulate the trigger raising SQLSTATE 23514 with the structured prefix.
    const pgErr: any = new Error(
      "cross_walk_violation: band=[8.5, 9.4]; new_pair=(T3, 9.7); existing_count=2",
    );
    pgErr.code = "23514";

    prisma.$queryRawUnsafe
      // INSERT throws
      .mockRejectedValueOnce(pgErr)
      // Follow-up read of existing reviews after rollback
      .mockResolvedValueOnce([
        {
          reviewer_role: "expert_reviewer",
          t_rating: "T3",
          jee_authenticity_score: 8.9,
          reviewed_at: new Date("2026-06-01T00:00:00Z"),
        },
        {
          reviewer_role: "jee_platform_critic",
          t_rating: "T3",
          jee_authenticity_score: 9.1,
          reviewed_at: new Date("2026-06-02T00:00:00Z"),
        },
      ]);

    let captured: any;
    try {
      await svc.createReview("MAT.SPL.X.Y.001", {
        reviewer_role: "jee_platform_critic",
        t_rating: "T3",
        jee_authenticity_score: 9.7,
      } as any);
    } catch (e) {
      captured = e;
    }
    expect(captured).toBeInstanceOf(HttpException);
    expect((captured as HttpException).getStatus()).toBe(422);

    const body = (captured as HttpException).getResponse() as any;
    expect(body.error_code).toBe("cross_walk_violation");
    expect(body.message).toMatch(/cross-walk band/);
    // band_bounds parsed out of the trigger's structured message.
    expect(body.band_bounds).toEqual({ lower: 8.5, upper: 9.4 });
    // your_pair carries what the caller submitted.
    expect(body.your_pair).toEqual({
      t_rating: "T3",
      jee_authenticity_score: 9.7,
    });
    // existing_reviews carries the prior reviews so the UI can show them.
    expect(Array.isArray(body.existing_reviews)).toBe(true);
    expect(body.existing_reviews).toHaveLength(2);
    expect(body.existing_reviews[0]).toMatchObject({
      reviewer_role: "expert_reviewer",
      t_rating: "T3",
      jee_authenticity_score: 8.9,
    });
    // retry_guidance present + actionable.
    expect(typeof body.retry_guidance).toBe("string");
    expect(body.retry_guidance.length).toBeGreaterThan(20);

    // [UPDATED v2 — N21] Postgres internals never leak to the caller.
    expect(body.raw_db_message).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/band=\[/);
  });

  it("422 cross-walk: band_bounds=null when the trigger message format is unrecognised", async () => {
    const pgErr: any = new Error("cross_walk_violation: unparseable");
    pgErr.code = "23514";
    prisma.$queryRawUnsafe
      .mockRejectedValueOnce(pgErr)
      .mockResolvedValueOnce([]);

    let captured: any;
    try {
      await svc.createReview("MAT.SPL.X.Y.001", {
        reviewer_role: "jee_platform_critic",
        t_rating: "T3",
        jee_authenticity_score: 9.7,
      } as any);
    } catch (e) {
      captured = e;
    }
    expect(captured).toBeInstanceOf(HttpException);
    const body = (captured as HttpException).getResponse() as any;
    expect(body.band_bounds).toBeNull();
    expect(body.existing_reviews).toEqual([]);
  });

  it("400 invalid_score on other SQLSTATE 23514", async () => {
    const pgErr: any = new Error("chk_score_range");
    pgErr.code = "23514";
    prisma.$queryRawUnsafe.mockRejectedValueOnce(pgErr);

    let captured: any;
    try {
      await svc.createReview("MAT.SPL.X.Y.001", {
        reviewer_role: "jee_platform_critic",
        t_rating: "T3",
        jee_authenticity_score: 99,
      } as any);
    } catch (e) {
      captured = e;
    }
    expect(captured).toBeInstanceOf(HttpException);
    expect((captured as HttpException).getStatus()).toBe(400);
    expect((captured as HttpException).getResponse()).toMatchObject({
      error_code: "invalid_score",
    });
  });

  it("400 problem_not_found on SQLSTATE 23503", async () => {
    const pgErr: any = new Error("violates foreign key constraint");
    pgErr.code = "23503";
    prisma.$queryRawUnsafe.mockRejectedValueOnce(pgErr);

    let captured: any;
    try {
      await svc.createReview("MAT.SPL.X.Y.001", {
        reviewer_role: "jee_platform_critic",
        t_rating: "T3",
        jee_authenticity_score: 9.2,
      } as any);
    } catch (e) {
      captured = e;
    }
    expect(captured).toBeInstanceOf(HttpException);
    expect((captured as HttpException).getStatus()).toBe(400);
    expect((captured as HttpException).getResponse()).toMatchObject({
      error_code: "problem_not_found",
    });
  });
});
