/**
 * Auth controller — endpoints 1 of architecture §5.1 plus the corresponding
 * logout. Both use cookie-based sessions (HttpOnly + Secure + SameSite=Lax).
 */

import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Logger,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { LoginDto } from "./auth.dto";
import { AuthSessionService } from "./auth-session.service";
import { Public, AuthedRequest } from "./auth.guard";

@Controller("api/auth")
export class AuthController {
  private readonly log = new Logger("AuthController");

  constructor(private readonly sessions: AuthSessionService) {}

  /**
   * POST /api/auth/session — login.
   *
   * Architecture §5.1 endpoint 1 + §5.5. Issues an HttpOnly + Secure +
   * SameSite=Lax cookie. Responds 200 with role + display name on success;
   * 401 on credential mismatch.
   *
   * [UPDATED v2 — B1] Per-route throttle pinned to 10 req/min/IP (architecture
   * §5.5 brute-force defence). The global ThrottlerGuard bucket in AppModule is
   * a coarse ceiling at 600/min/IP; the credential-stuffing surface needs a
   * tighter cap independent of the global. NestJS Throttler picks the most
   * restrictive applicable @Throttle decorator, so this override binds here.
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("session")
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ role: string; display_name: string }> {
    const ip = (req.headers["x-forwarded-for"] as string) ?? req.socket.remoteAddress ?? null;
    const ua = (req.headers["user-agent"] as string) ?? null;
    try {
      const result = await this.sessions.login(dto.email, dto.password, ua, ip);
      res.cookie(this.sessions.cookieName(), result.sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: this.sessions.cookieMaxAgeSeconds() * 1000,
        path: "/",
      });
      return { role: result.role, display_name: result.displayName };
    } catch (e: any) {
      // [UPDATED v2 — N15] Log a SHA-256 prefix of the email instead of the
      // raw email so the log aggregator does not collect PII on failed login.
      const emailHashPrefix = require("crypto")
        .createHash("sha256")
        .update(dto.email ?? "")
        .digest("hex")
        .substring(0, 12);
      this.log.warn(`login failed email_hash=${emailHashPrefix}: ${e?.message ?? "unknown"}`);
      throw new UnauthorizedException({
        error: "invalid_credentials",
        message: "email or password is incorrect",
      });
    }
  }

  /**
   * DELETE /api/auth/session — logout.
   *
   * Invalidates the auth_sessions row. Idempotent (a no-op if no cookie).
   */
  @Public()
  @Delete("session")
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const cookies = (req as any).cookies as Record<string, string> | undefined;
    const sid = cookies?.[this.sessions.cookieName()];
    if (sid) {
      await this.sessions.logout(sid);
    }
    res.clearCookie(this.sessions.cookieName(), { path: "/" });
  }
}
