/**
 * Test-session controller — endpoints 3..13 of architecture §5.3.
 *
 * Every method here resolves the session under the authenticated student's
 * studentId (per-resource owner check) before delegating to the service.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Req,
  Res,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { AllowRoles } from "../auth/auth.guard";
import type { AuthedRequest } from "../auth/auth.guard";
import {
  CreateSessionDto,
  HeartbeatDto,
  LateSnapshotsDto,
  SnapshotPatchDto,
  SubmitDto,
  ViolationDto,
} from "./test-sessions.dto";
import { TestSessionsService } from "./test-sessions.service";

@Controller("api/test-sessions")
@AllowRoles("student")
export class TestSessionsController {
  private readonly log = new Logger("TestSessionsController");

  constructor(private readonly svc: TestSessionsService) {}

  /**
   * POST /api/test-sessions — endpoint 3.
   * Architecture §5.3: starts a session or returns 409 with existing session id.
   */
  @Post()
  @HttpCode(201)
  async create(@Req() req: AuthedRequest, @Body() dto: CreateSessionDto) {
    return this.svc.createSession(req.auth.studentId!, dto.test_assignment_id);
  }

  /**
   * GET /api/test-sessions/:id — endpoint 4.
   * Returns the slot-indexed payload WITHOUT question_code / answer / solution.
   */
  @Get(":id")
  async get(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.svc.getSession(id, req.auth.studentId!);
  }

  /**
   * PUT /api/test-sessions/:id/state — endpoint 5. START / HEARTBEAT.
   */
  @Put(":id/state")
  async putState(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Body() dto: HeartbeatDto,
  ) {
    return this.svc.updateState(id, req.auth.studentId!, dto.action);
  }

  /**
   * PATCH /api/test-sessions/:id/snapshots/:slot_index — endpoint 6.
   * Telemetry tick. UPSERT, latest action_seq wins.
   *
   * [UPDATED v2 — M3] Per-route throttle 60 req/min/IP. The runtime emits a
   * snapshot every ~5 s, so a well-behaved client comfortably stays under;
   * a buggy client in a tight retry loop is now caught at the edge instead
   * of DOS-ing the snapshot UPSERT. Defense-in-depth on top of the global
   * 600/min/IP bucket and the application-level action_seq monotonicity.
   */
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Patch(":id/snapshots/:slot_index")
  async patchSnapshot(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("slot_index", ParseIntPipe) slotIndex: number,
    @Body() dto: SnapshotPatchDto,
  ) {
    return this.svc.patchSnapshot(id, slotIndex, req.auth.studentId!, dto);
  }

  /**
   * GET /api/test-sessions/:id/questions/:slot/hints/:level — endpoint 7.
   * Response padded to constant ~250ms per Req L.
   */
  @Get(":id/questions/:slot/hints/:level")
  async getHint(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("slot", ParseIntPipe) slot: number,
    @Param("level", ParseIntPipe) level: number,
  ) {
    return this.svc.getHint(id, slot, level, req.auth.studentId!);
  }

  /**
   * GET /api/test-sessions/:id/figures/:signed_token — endpoint 8.
   * Verifies HMAC under current/previous secret, returns image bytes.
   */
  @Get(":id/figures/:signed_token")
  async getFigure(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("signed_token") token: string,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const fig = await this.svc.getFigure(id, token, req.auth.studentId!);
    res.setHeader("Content-Type", fig.mime_type);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.end(fig.bytes);
  }

  /**
   * GET /api/test-sessions/:id/marking-scheme — endpoint 9.
   */
  @Get(":id/marking-scheme")
  async getMarkingScheme(@Req() req: AuthedRequest, @Param("id") id: string) {
    const scheme = await this.svc.getMarkingScheme(id, req.auth.studentId!);
    return { marking_scheme: scheme };
  }

  /**
   * POST /api/test-sessions/:id/violations — endpoint 10.
   * Anti-cheat event. Increments counter; reports will_auto_submit=true on 3rd.
   */
  @Post(":id/violations")
  @HttpCode(200)
  async logViolation(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Body() dto: ViolationDto,
  ) {
    return this.svc.logViolation(id, req.auth.studentId!, dto);
  }

  /**
   * POST /api/test-sessions/:id/submit — endpoint 11.
   * Drains snapshots → attempts in one transaction. Idempotent on session_id.
   */
  @Post(":id/submit")
  @HttpCode(200)
  async submit(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Body() dto: SubmitDto,
  ) {
    return this.svc.submit(id, req.auth.studentId!, dto);
  }

  /**
   * POST /api/test-sessions/:id/late-snapshots — endpoint 12.
   * Server-side cron-callable too; scored only if pre-submit-commit.
   */
  @Post(":id/late-snapshots")
  @HttpCode(200)
  async lateSnapshots(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Body() dto: LateSnapshotsDto,
  ) {
    return this.svc.lateSnapshots(id, req.auth.studentId!, dto);
  }

  /**
   * GET /api/test-sessions/:id/results — endpoint 13.
   * Reveals correct answers + solutions only after submitted_at IS NOT NULL.
   */
  @Get(":id/results")
  async getResults(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.svc.getResults(id, req.auth.studentId!);
  }
}
