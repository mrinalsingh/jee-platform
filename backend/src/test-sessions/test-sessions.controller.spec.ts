/**
 * Test-sessions controller — happy-path + auth-failure unit smoke.
 *
 * The DB-integration cases (UPSERT semantics, the FOR UPDATE row lock, the
 * cross-walk 422 path) live in test/integration/* spec files which spin up
 * a test DB. These spec files run with the lightweight controller mock so the
 * 14-endpoint surface is covered against a regression.
 */

import { Test } from "@nestjs/testing";
import { Reflector } from "@nestjs/core";
import { TestSessionsController } from "./test-sessions.controller";
import { TestSessionsService } from "./test-sessions.service";

// [UPDATED v2 — M3] @nestjs/throttler v6 metadata keys for per-route throttle.
// See node_modules/@nestjs/throttler/dist/throttler.decorator.js: the key is
// formed as `THROTTLER:LIMIT${tracker}`, single tracker = "default" here.
const THROTTLER_LIMIT_DEFAULT = "THROTTLER:LIMITdefault";
const THROTTLER_TTL_DEFAULT = "THROTTLER:TTLdefault";

const makeReq = (studentId: bigint | undefined): any => ({
  auth: { role: "student", studentId, sessionId: "cookie" },
});

const makeRes = (): any => {
  const calls: any[] = [];
  return {
    calls,
    setHeader: (k: string, v: string) => calls.push({ kind: "setHeader", k, v }),
    end: (buf: any) => calls.push({ kind: "end", buf }),
  };
};

describe("TestSessionsController", () => {
  let controller: TestSessionsController;
  let svc: jest.Mocked<TestSessionsService>;

  beforeEach(async () => {
    const svcMock: Partial<jest.Mocked<TestSessionsService>> = {
      createSession: jest.fn(),
      getSession: jest.fn(),
      updateState: jest.fn(),
      patchSnapshot: jest.fn(),
      getHint: jest.fn(),
      getFigure: jest.fn(),
      getMarkingScheme: jest.fn(),
      logViolation: jest.fn(),
      submit: jest.fn(),
      lateSnapshots: jest.fn(),
      getResults: jest.fn(),
    };
    const mod = await Test.createTestingModule({
      controllers: [TestSessionsController],
      providers: [{ provide: TestSessionsService, useValue: svcMock }],
    }).compile();
    controller = mod.get(TestSessionsController);
    svc = mod.get(TestSessionsService) as jest.Mocked<TestSessionsService>;
  });

  it("create — happy path", async () => {
    svc.createSession.mockResolvedValueOnce({
      session_id: "1",
      started_at: "2026-06-29T10:00:00Z",
      expires_at: "2026-06-29T13:00:00Z",
      marking_scheme: {},
    });
    const out = await controller.create(makeReq(42n), { test_assignment_id: "5" });
    expect(out.session_id).toBe("1");
    expect(svc.createSession).toHaveBeenCalledWith(42n, "5");
  });

  it("getSession — passes studentId to service", async () => {
    svc.getSession.mockResolvedValueOnce({
      session_id: "1",
      test_id: "10",
      started_at: null,
      expires_at: null,
      submitted_at: null,
      marking_scheme: {},
      sections: [],
      snapshots: [],
      violations_count: 0,
    });
    await controller.get(makeReq(7n), "1");
    expect(svc.getSession).toHaveBeenCalledWith("1", 7n);
  });

  it("putState — START forwards action", async () => {
    svc.updateState.mockResolvedValueOnce({
      server_now: "now",
      expires_at: null,
    });
    await controller.putState(makeReq(7n), "1", { action: "START" });
    expect(svc.updateState).toHaveBeenCalledWith("1", 7n, "START");
  });

  it("patchSnapshot — passes slot index + body", async () => {
    svc.patchSnapshot.mockResolvedValueOnce({
      persisted_action_seq: 99,
      server_timestamp: "t",
    });
    const body: any = {
      answer_payload: null,
      marked_for_review: false,
      time_seconds_delta: 5,
      visit_count: 1,
      action_seq: 99,
      client_timestamp_ms: 1,
    };
    await controller.patchSnapshot(makeReq(7n), "1", 3, body);
    expect(svc.patchSnapshot).toHaveBeenCalledWith("1", 3, 7n, body);
  });

  it("getHint — passes slot and level", async () => {
    svc.getHint.mockResolvedValueOnce({ level: 1, text: "hint", pad: "" });
    await controller.getHint(makeReq(7n), "1", 2, 1);
    expect(svc.getHint).toHaveBeenCalledWith("1", 2, 1, 7n);
  });

  it("getFigure — writes mime/bytes to the response", async () => {
    svc.getFigure.mockResolvedValueOnce({
      mime_type: "image/png",
      bytes: Buffer.from("PNGBYTES"),
    });
    const res = makeRes();
    await controller.getFigure(makeReq(7n), "1", "sometoken", res);
    expect(res.calls.some((c: any) => c.kind === "setHeader" && c.k === "Content-Type" && c.v === "image/png")).toBe(true);
    expect(res.calls.some((c: any) => c.kind === "end")).toBe(true);
  });

  it("getMarkingScheme — wraps response", async () => {
    svc.getMarkingScheme.mockResolvedValueOnce({ correct_marks: 4 });
    const out = await controller.getMarkingScheme(makeReq(7n), "1");
    expect(out.marking_scheme).toEqual({ correct_marks: 4 });
  });

  it("logViolation — forwards body", async () => {
    svc.logViolation.mockResolvedValueOnce({
      violations_count: 2,
      will_auto_submit: false,
      auto_submitted: false,
    });
    const body: any = {
      violation_type: "TAB_SWITCH",
      was_active: true,
      client_timestamp_ms: 1,
    };
    const out = await controller.logViolation(makeReq(7n), "1", body);
    expect(out.violations_count).toBe(2);
  });

  it("logViolation — on 3rd violation surfaces auto_submitted + submit_result (M4)", async () => {
    svc.logViolation.mockResolvedValueOnce({
      violations_count: 3,
      will_auto_submit: true,
      auto_submitted: true,
      submit_result: {
        submitted_at: "2026-06-29T12:34:56Z",
        auto_submit_source: "VIOLATION_THRESHOLD",
        attempt_ids: ["10", "11"],
      },
    });
    const body: any = {
      violation_type: "TAB_SWITCH",
      was_active: true,
      client_timestamp_ms: 1,
    };
    const out = await controller.logViolation(makeReq(7n), "1", body);
    expect(out.auto_submitted).toBe(true);
    expect(out.submit_result?.auto_submit_source).toBe("VIOLATION_THRESHOLD");
    expect(out.submit_result?.attempt_ids).toHaveLength(2);
  });

  it("submit — forwards source", async () => {
    svc.submit.mockResolvedValueOnce({
      submitted_at: "t",
      auto_submit_source: "MANUAL",
      attempt_ids: [],
    });
    const out = await controller.submit(makeReq(7n), "1", {
      auto_submit: false,
      auto_submit_source: "MANUAL",
      client_final_state_hash: "h",
    } as any);
    expect(out.auto_submit_source).toBe("MANUAL");
  });

  it("lateSnapshots — forwards entries", async () => {
    svc.lateSnapshots.mockResolvedValueOnce({ recorded_count: 1, scored_count: 0 });
    const out = await controller.lateSnapshots(makeReq(7n), "1", {
      snapshots: [{ slot_index: 0, action_seq: 1, client_timestamp_ms: 1 } as any],
    } as any);
    expect(out.recorded_count).toBe(1);
  });

  it("getResults — forwards id", async () => {
    svc.getResults.mockResolvedValueOnce({
      summary: { total_attempted: 0, total_correct: 0, auto_submit_source: "MANUAL" },
      per_question: [],
      violations: [],
      auto_submit_source: "MANUAL",
    });
    await controller.getResults(makeReq(7n), "1");
    expect(svc.getResults).toHaveBeenCalledWith("1", 7n);
  });

  // [UPDATED v2 — M3] PATCH /snapshots/:slot has a per-route throttle of
  // 60 req/min/IP/session to defend against a buggy client retrying in a
  // tight loop. The runtime emits a snapshot every ~5 s, so this is well
  // above the legitimate ceiling.
  it("patchSnapshot has 60-per-60s @Throttle metadata (M3)", () => {
    const reflector = new Reflector();
    const handler = (TestSessionsController.prototype as any).patchSnapshot;
    const limit = reflector.get<number>(THROTTLER_LIMIT_DEFAULT, handler);
    const ttl = reflector.get<number>(THROTTLER_TTL_DEFAULT, handler);
    expect(limit).toBe(60);
    expect(ttl).toBe(60_000);
  });
});
