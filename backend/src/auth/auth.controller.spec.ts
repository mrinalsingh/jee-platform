/**
 * Auth controller minimal unit tests.
 *
 * These cover the controller's contract handling, not the live DB — DB-backed
 * integration tests live in test/integration/auth.spec.ts (created when the
 * migrations are applied and a test DB is provisioned).
 */

import { Test } from "@nestjs/testing";
import { UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthController } from "./auth.controller";
import { AuthSessionService } from "./auth-session.service";

// [UPDATED v2 — B1] @nestjs/throttler v6 stores per-route limit/ttl under
// metadata keys formed as `THROTTLER:LIMIT${trackerName}` and
// `THROTTLER:TTL${trackerName}` — see
// node_modules/@nestjs/throttler/dist/throttler.decorator.js setThrottlerMetadata.
// Our ThrottlerModule.forRoot is configured with the single tracker "default",
// so the per-route metadata lives under these exact keys.
const THROTTLER_LIMIT_DEFAULT = "THROTTLER:LIMITdefault";
const THROTTLER_TTL_DEFAULT = "THROTTLER:TTLdefault";

const mockResponse = (): any => {
  const calls: any[] = [];
  return {
    calls,
    cookie: (...args: any[]) => calls.push({ kind: "cookie", args }),
    clearCookie: (...args: any[]) => calls.push({ kind: "clearCookie", args }),
  };
};

describe("AuthController", () => {
  let controller: AuthController;
  let sessions: jest.Mocked<AuthSessionService>;

  beforeEach(async () => {
    const sessionsMock: Partial<jest.Mocked<AuthSessionService>> = {
      login: jest.fn(),
      logout: jest.fn(),
      resolve: jest.fn(),
      cookieName: jest.fn().mockReturnValue("session"),
      cookieMaxAgeSeconds: jest.fn().mockReturnValue(86400),
    };
    const mod = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthSessionService, useValue: sessionsMock }],
    }).compile();
    controller = mod.get(AuthController);
    sessions = mod.get(AuthSessionService) as jest.Mocked<AuthSessionService>;
  });

  describe("POST /api/auth/session", () => {
    it("happy path: sets the cookie and returns role + display_name", async () => {
      sessions.login.mockResolvedValueOnce({
        sessionId: "abc.def",
        role: "student",
        displayName: "Test Student",
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });
      const req: any = { headers: { "user-agent": "jest" }, socket: { remoteAddress: "1.1.1.1" } };
      const res = mockResponse();
      const body = await controller.login(
        { email: "test@example.com", password: "x" } as any,
        req,
        res,
      );
      expect(body).toEqual({ role: "student", display_name: "Test Student" });
      const cookieCall = res.calls.find((c: any) => c.kind === "cookie");
      expect(cookieCall).toBeDefined();
      expect(cookieCall.args[0]).toBe("session");
      expect(cookieCall.args[1]).toBe("abc.def");
      // HttpOnly + sameSite=lax always on; secure flag depends on NODE_ENV
      expect(cookieCall.args[2]).toMatchObject({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      });
    });

    it("invalid credentials: throws 401 (no cookie set)", async () => {
      sessions.login.mockRejectedValueOnce(new Error("invalid_credentials"));
      const req: any = { headers: {}, socket: {} };
      const res = mockResponse();
      await expect(
        controller.login({ email: "x@y.z", password: "wrong" } as any, req, res),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(res.calls.find((c: any) => c.kind === "cookie")).toBeUndefined();
    });

    // [UPDATED v2 — B1] Architecture §5.5 requires 10 req/min/IP on the
    // login route, INDEPENDENT of the global 600/min/IP bucket. We assert the
    // @Throttle decorator metadata is wired onto the login handler with the
    // exact limit/ttl the architecture spec pins. ThrottlerGuard reads these
    // metadata keys at runtime to enforce the per-route cap; if either is
    // missing or wrong, brute-force protection silently regresses to the
    // global ceiling. Integration test (the actual 11th-request → 429) runs
    // against a live throttler in test/integration/auth.spec.ts; this unit
    // test guards against the decorator being lost in a future refactor.
    it("login has 10-per-60s @Throttle metadata (B1: architecture §5.5)", () => {
      const reflector = new Reflector();
      const handler = (AuthController.prototype as any).login;
      const limit = reflector.get<number>(THROTTLER_LIMIT_DEFAULT, handler);
      const ttl = reflector.get<number>(THROTTLER_TTL_DEFAULT, handler);
      expect(limit).toBe(10);
      expect(ttl).toBe(60_000);
    });
  });

  describe("DELETE /api/auth/session", () => {
    it("clears cookie when no session is present (idempotent)", async () => {
      const req: any = { cookies: {} };
      const res = mockResponse();
      await controller.logout(req, res);
      expect(sessions.logout).not.toHaveBeenCalled();
      expect(res.calls.find((c: any) => c.kind === "clearCookie")).toBeDefined();
    });

    it("invalidates session when cookie is present", async () => {
      const req: any = { cookies: { session: "abc.def" } };
      const res = mockResponse();
      await controller.logout(req, res);
      expect(sessions.logout).toHaveBeenCalledWith("abc.def");
      expect(res.calls.find((c: any) => c.kind === "clearCookie")).toBeDefined();
    });
  });
});
