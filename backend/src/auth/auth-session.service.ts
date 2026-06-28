/**
 * Auth-session service — architecture §10.1.
 *
 * Issues a cookie-backed session by inserting one row into `auth_sessions`
 * keyed by a 32-byte random base64url id. Subsequent requests look the id up
 * via SELECT ... WHERE id = $1 AND expires_at > now() (one indexed lookup).
 *
 * Why cookies + a sessions table over JWT (architecture §2 + §10.1):
 *   - Server can invalidate (logout, ban, password reset, breach response).
 *   - No JWT key rotation footgun.
 *   - Smaller header.
 *   - CSRF handled by SameSite=Lax.
 */

import { Injectable, Logger } from "@nestjs/common";
import * as crypto from "crypto";
import * as bcrypt from "bcrypt";
import { PrismaService } from "../prisma/prisma.service";

/** Concrete role identifier carried on `req.auth` once an AuthGuard passes. */
export type AuthRole = "student" | "teacher" | "parent";

export interface AuthContext {
  role: AuthRole;
  studentId?: bigint;
  teacherId?: bigint;
  parentId?: bigint;
  sessionId: string;
}

const SESSION_TTL_SECONDS = 24 * 60 * 60; // 24h per architecture §10.1
const COOKIE_NAME = "session";

/**
 * [UPDATED v2 — M6] Real bcrypt hash of a throwaway string, computed once at
 * module init. Used as the timing-equaliser on the "email not found" branch so
 * `bcrypt.compare(password, DUMMY_HASH)` does the same ~100 ms of work as a
 * real login. v1 used the literal `"$2b$12$abcdefghijklmnopqrstuv"` which is
 * 22 chars (real bcrypt hashes are 60), so `bcrypt.compare` short-circuited on
 * the malformed-hash branch instead of running the cost-12 KDF — defeating the
 * timing equalisation and leaking which emails are registered.
 */
const DUMMY_BCRYPT_HASH = bcrypt.hashSync("$dummy-timing-equaliser$", 12);

@Injectable()
export class AuthSessionService {
  private readonly log = new Logger("AuthSessionService");

  constructor(private readonly prisma: PrismaService) {}

  /** Generate a 32-byte random base64url session id. */
  private newSessionId(): string {
    return crypto
      .randomBytes(32)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }

  /** SHA-256 of the client IP for `auth_sessions.ip_hash` (no PII at rest). */
  private hashIp(ip: string | null | undefined): string | null {
    if (!ip) return null;
    return crypto.createHash("sha256").update(ip).digest("hex");
  }

  /**
   * Verify (email, password) and create a new auth_sessions row.
   * Returns the session id (= cookie value) plus context.
   * Throws on credential mismatch — caller projects 401.
   */
  async login(
    email: string,
    password: string,
    userAgent: string | null,
    ip: string | null,
  ): Promise<{
    sessionId: string;
    role: AuthRole;
    displayName: string;
    expiresAt: Date;
  }> {
    const lookup = await this.lookupByEmail(email);
    if (!lookup) {
      // [UPDATED v2 — M6] Real bcrypt compare against a properly-formed
      // 60-char cost-12 hash so the wall-clock for the email-not-found branch
      // is indistinguishable from the email-found-wrong-password branch
      // (~100 ms on commodity hardware). v1 passed a 22-char malformed hash
      // which `bcrypt.compare` rejected in O(1), trivially leaking which
      // email addresses are registered.
      await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
      throw new Error("invalid_credentials");
    }

    const ok = await bcrypt.compare(password, lookup.passwordHash);
    if (!ok) {
      throw new Error("invalid_credentials");
    }

    const sessionId = this.newSessionId();
    const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

    // Use raw SQL because the AuthSession Prisma model has only one of
    // student_id/teacher_id/parent_id set (CHECK chk_one_role on the table).
    // The runtime-app role (`app_user_login`) has INSERT permission.
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO auth_sessions (id, student_id, teacher_id, parent_id, created_at, expires_at, last_used_at, user_agent, ip_hash)
       VALUES ($1, $2, $3, $4, now(), $5, now(), $6, $7)`,
      sessionId,
      lookup.role === "student" ? lookup.id : null,
      lookup.role === "teacher" ? lookup.id : null,
      lookup.role === "parent" ? lookup.id : null,
      expiresAt,
      userAgent,
      this.hashIp(ip),
    );

    this.log.log(`login ok role=${lookup.role} userId=${lookup.id}`);
    return {
      sessionId,
      role: lookup.role,
      displayName: lookup.displayName,
      expiresAt,
    };
  }

  /**
   * Look up the user across the three role tables. We do NOT expose to the
   * caller which table contained the row (a non-existent email and a wrong
   * password both project to 401).
   */
  private async lookupByEmail(email: string): Promise<{
    role: AuthRole;
    id: bigint;
    passwordHash: string;
    displayName: string;
  } | null> {
    // Architecture §2 + §10.1: bcrypt hash stored on the user row. The exact
    // column name is `password_hash` (set in migration 0008).
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        role: AuthRole;
        id: bigint;
        password_hash: string;
        full_name: string;
      }>
    >(
      `SELECT 'student' AS role, id, password_hash, full_name FROM students WHERE email = $1
       UNION ALL
       SELECT 'teacher' AS role, id, password_hash, full_name FROM teachers WHERE email = $1
       UNION ALL
       SELECT 'parent'  AS role, id, password_hash, full_name FROM parents  WHERE email = $1
       LIMIT 1`,
      email,
    );
    if (rows.length === 0) return null;
    const r = rows[0]!;
    return {
      role: r.role,
      id: r.id,
      passwordHash: r.password_hash,
      displayName: r.full_name,
    };
  }

  /**
   * Look up an active session by id. Returns null if expired or unknown.
   * Bumps `last_used_at` so we can build a "ban-after-N-days-idle" policy later
   * without ALTERing the schema.
   */
  async resolve(sessionId: string): Promise<AuthContext | null> {
    if (!sessionId || typeof sessionId !== "string") return null;
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        id: string;
        student_id: bigint | null;
        teacher_id: bigint | null;
        parent_id: bigint | null;
      }>
    >(
      `UPDATE auth_sessions SET last_used_at = now()
       WHERE id = $1 AND expires_at > now()
       RETURNING id, student_id, teacher_id, parent_id`,
      sessionId,
    );
    if (rows.length === 0) return null;
    const r = rows[0]!;
    if (r.student_id !== null) {
      return { role: "student", studentId: r.student_id, sessionId: r.id };
    }
    if (r.teacher_id !== null) {
      return { role: "teacher", teacherId: r.teacher_id, sessionId: r.id };
    }
    if (r.parent_id !== null) {
      return { role: "parent", parentId: r.parent_id, sessionId: r.id };
    }
    return null;
  }

  /** Invalidate a session row (logout). */
  async logout(sessionId: string): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM auth_sessions WHERE id = $1`,
      sessionId,
    );
  }

  cookieName(): string {
    return COOKIE_NAME;
  }

  cookieMaxAgeSeconds(): number {
    return SESSION_TTL_SECONDS;
  }
}
