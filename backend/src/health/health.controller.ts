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
// Read the version statically from package.json so the value is bundled at
// build time (nest build with tsconfig "resolveJsonModule": true). Falls back
// to "unknown" if the import path is rewritten by the bundler.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require("../../package.json") as { version?: string };

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
      version: pkg.version ?? "unknown",
      uptime: Math.floor((now - PROCESS_START_MS) / 1000),
      timestamp: new Date(now).toISOString(),
    };
  }
}
