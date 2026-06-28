/**
 * Health controller — Render zero-downtime deploy probe.
 *
 * Returns `{ status, version, uptime, timestamp }` so Render (and UptimeRobot,
 * per architecture §11) can verify the backend is alive on every deploy.
 * Marked @Public() so the AuthGuard does NOT challenge the probe — health
 * checks must work without a session cookie.
 *
 * Stage 5 Integrator gap #2 (`05-integration-final.md` Workstream 4).
 */

import { Controller, Get } from "@nestjs/common";
import { Public } from "../auth/auth.guard";
// npm sets npm_package_version when running scripts ("npm run start", etc.),
// so the value is correct in both ts-node dev mode and the compiled dist.
// Avoids the require("../../package.json") path being wrong after compilation
// to dist/src/health/health.controller.js (one extra level deep).
const VERSION = process.env.npm_package_version ?? "unknown";

/** Process boot time — captured once at module load so uptime is monotonic. */
const PROCESS_START_MS = Date.now();

export interface HealthPayload {
  status: "ok";
  version: string;
  uptime: number;
  timestamp: string;
}

@Controller("api/health")
export class HealthController {
  /**
   * GET /api/health — liveness probe.
   *
   * - `status` is always "ok" when the process can reply. Deeper readiness
   *   probes (e.g. DB ping) belong on a separate `/api/ready` endpoint and
   *   are out of scope for v1.
   * - `version` comes from backend/package.json.
   * - `uptime` is seconds since this Node process booted.
   * - `timestamp` is the current server time in ISO-8601.
   */
  @Public()
  @Get()
  health(): HealthPayload {
    const now = Date.now();
    return {
      status: "ok",
      version: VERSION,
      uptime: Math.floor((now - PROCESS_START_MS) / 1000),
      timestamp: new Date(now).toISOString(),
    };
  }
}
