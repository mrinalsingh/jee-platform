/**
 * AuthGuard — architecture §10.1 / §10.4 A01.
 *
 * Reads the session cookie, resolves it via AuthSessionService, attaches an
 * AuthContext to req.auth, and 401s when no valid session exists. Per-resource
 * owner checks live on each controller (we only verify "you are some
 * authenticated user" here).
 */

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { AuthSessionService, AuthContext, AuthRole } from "./auth-session.service";

/** Decorate a controller (class) or handler (method) with `@Public()` to skip the AuthGuard. */
export const IS_PUBLIC_KEY = "auth:public";
export const Public = (): ClassDecorator & MethodDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true) as ClassDecorator & MethodDecorator;

/** Decorate a controller (class) or handler (method) with `@AllowRoles('teacher','parent')`. */
export const ALLOWED_ROLES_KEY = "auth:allowed-roles";
export const AllowRoles = (...roles: AuthRole[]): ClassDecorator & MethodDecorator =>
  SetMetadata(ALLOWED_ROLES_KEY, roles) as ClassDecorator & MethodDecorator;

export interface AuthedRequest extends Request {
  auth: AuthContext;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly sessions: AuthSessionService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    // cookie-parser populates `req.cookies`. Type as any so we don't need a hard
    // dependency on its types here.
    const cookies = (req as any).cookies as Record<string, string> | undefined;
    const sessionId = cookies?.[this.sessions.cookieName()];
    if (!sessionId) {
      throw new UnauthorizedException({
        error: "unauthorized",
        message: "no session cookie present",
      });
    }
    const auth = await this.sessions.resolve(sessionId);
    if (!auth) {
      throw new UnauthorizedException({
        error: "unauthorized",
        message: "session expired or unknown",
      });
    }

    const allowedRoles = this.reflector.getAllAndOverride<AuthRole[]>(
      ALLOWED_ROLES_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(auth.role)) {
      throw new UnauthorizedException({
        error: "forbidden_role",
        message: `role ${auth.role} not permitted on this endpoint`,
      });
    }

    (req as AuthedRequest).auth = auth;
    return true;
  }
}
