/**
 * Dashboard service — runs the UNION-DEDUPE query for Req M.
 *
 * Architecture §5.2 SQL. Two paths (cohort, individual) are UNION-ALL'd,
 * DISTINCT-ON'd by test_id with earlier `assigned_at` winning, then joined
 * to `tests` and LEFT JOIN'd to the student's active test_sessions row (if any).
 *
 * This is one of the few endpoints where Prisma's API would obscure intent —
 * the union + distinct-on + earlier-wins ordering is more readable as SQL.
 * Parameters bound via $1 / $2 — no string concatenation.
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface AssignedTest {
  test_assignment_id: string;
  test_id: string;
  title: string;
  duration_seconds: number;
  marking_scheme_summary: unknown;
  window_start_at: string;
  window_end_at: string;
  status: "UPCOMING" | "OPEN" | "IN_PROGRESS" | "SUBMITTED" | "EXPIRED";
  session_id: string | null;
  scope: "cohort" | "individual";
}

@Injectable()
export class DashboardService {
  private readonly log = new Logger("DashboardService");

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /api/dashboard/assigned-tests handler.
   *
   * Architecture §5.2 contract. Returns the tests a student can see:
   *   - via their cohort memberships (Path A)
   *   - via direct individual assignment (Path B)
   * deduped so a student in both buckets sees ONE entry, earlier assignment wins.
   *
   * The window filter is `window_end_at > now() - INTERVAL '24 hours'` so
   * just-expired tests still surface with status=EXPIRED for one day —
   * matches the architecture's display-status semantics.
   */
  async assignedTests(studentId: bigint): Promise<AssignedTest[]> {
    const sql = `
      WITH candidate AS (
        -- Path A: via cohort membership
        SELECT ta.id AS test_assignment_id, ta.test_id,
               ta.window_start_at, ta.window_end_at,
               ta.marking_scheme AS assignment_marking_scheme,
               ta.assigned_at,
               'cohort'::text AS scope
        FROM test_assignments ta
        JOIN cohort_members cm ON cm.cohort_id = ta.cohort_id
        WHERE cm.student_id = $1
          AND ta.cohort_id IS NOT NULL
        UNION ALL
        -- Path B: individual assignment
        SELECT ta.id, ta.test_id,
               ta.window_start_at, ta.window_end_at,
               ta.marking_scheme,
               ta.assigned_at,
               'individual'::text
        FROM test_assignments ta
        WHERE ta.student_id = $1
      ),
      dedup AS (
        -- Earlier-assigned wins per test_id
        SELECT DISTINCT ON (test_id) *
        FROM candidate
        ORDER BY test_id, assigned_at ASC
      )
      SELECT d.test_assignment_id, d.test_id, d.window_start_at, d.window_end_at,
             d.assignment_marking_scheme, d.scope,
             t.title, t.duration_seconds, t.marking_scheme AS test_marking_scheme,
             s.id AS session_id, s.status AS session_status, s.submitted_at
      FROM dedup d
      JOIN tests t ON t.id = d.test_id
      LEFT JOIN test_sessions s
        ON s.test_assignment_id = d.test_assignment_id
       AND s.student_id = $1
      WHERE d.window_end_at > now() - INTERVAL '24 hours'
      ORDER BY d.window_start_at ASC
    `;

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        test_assignment_id: bigint;
        test_id: bigint;
        window_start_at: Date;
        window_end_at: Date;
        assignment_marking_scheme: unknown;
        scope: "cohort" | "individual";
        title: string;
        duration_seconds: number;
        test_marking_scheme: unknown;
        session_id: bigint | null;
        session_status: "ACTIVE" | "SUBMITTED" | "EXPIRED" | null;
        submitted_at: Date | null;
      }>
    >(sql, studentId);

    const now = Date.now();
    return rows.map((r) => ({
      test_assignment_id: r.test_assignment_id.toString(),
      test_id: r.test_id.toString(),
      title: r.title,
      duration_seconds: r.duration_seconds,
      marking_scheme_summary:
        r.assignment_marking_scheme ?? r.test_marking_scheme,
      window_start_at: r.window_start_at.toISOString(),
      window_end_at: r.window_end_at.toISOString(),
      status: this.computeStatus(
        r.window_start_at,
        r.window_end_at,
        r.session_status,
        now,
      ),
      session_id: r.session_id !== null ? r.session_id.toString() : null,
      scope: r.scope,
    }));
  }

  private computeStatus(
    windowStart: Date,
    windowEnd: Date,
    sessionStatus: "ACTIVE" | "SUBMITTED" | "EXPIRED" | null,
    nowMs: number,
  ): AssignedTest["status"] {
    if (sessionStatus === "SUBMITTED") return "SUBMITTED";
    if (sessionStatus === "ACTIVE") return "IN_PROGRESS";
    if (sessionStatus === "EXPIRED") return "EXPIRED";
    if (nowMs < windowStart.getTime()) return "UPCOMING";
    if (nowMs > windowEnd.getTime()) return "EXPIRED";
    return "OPEN";
  }
}
