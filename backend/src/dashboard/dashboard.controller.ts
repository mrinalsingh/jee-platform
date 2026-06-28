/**
 * Dashboard controller — architecture §5.2 endpoint 2.
 *
 * GET /api/dashboard/assigned-tests
 *   Auth: student (parent + teacher roles return 403).
 *   Returns: list of tests assigned to the authenticated student (cohort UNION
 *   individual, dedupe by test_id, earlier assigned_at wins).
 */

import { Controller, Get, Logger, Req } from "@nestjs/common";
import { AllowRoles } from "../auth/auth.guard";
import type { AuthedRequest } from "../auth/auth.guard";
import { AssignedTest, DashboardService } from "./dashboard.service";

@Controller("api/dashboard")
export class DashboardController {
  private readonly log = new Logger("DashboardController");

  constructor(private readonly dashboard: DashboardService) {}

  @AllowRoles("student")
  @Get("assigned-tests")
  async assigned(@Req() req: AuthedRequest): Promise<{ tests: AssignedTest[] }> {
    const studentId = req.auth.studentId!;
    const tests = await this.dashboard.assignedTests(studentId);
    this.log.log(`assigned-tests student=${studentId} count=${tests.length}`);
    return { tests };
  }
}
