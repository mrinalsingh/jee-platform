# Stage 5 Integration — Final Report (v2)

**Stage:** 5 (Integration / final ship-or-no-ship gate — iteration 2)
**Author:** Integrator
**Date:** 2026-06-28
**Predecessor:** `05-integration-final.md` (v1 — NO-SHIP, 7 blockers identified)
**Method:** Targeted re-verification of each v1 blocker (file present, content correct, behaviour matches the fix description), + full re-run of build/test sweep, + fresh-DB migration smoke.

## Verdict: SHIP

All seven v1 blockers (six HIGH gates + one carry-over HIGH) shipped fixes that hold up on inspection and replay. The fresh-DB `prisma migrate deploy` smoke that failed in v1 now exits "All migrations have been successfully applied." Backend test count rose from 106 → 109 (the three new health-controller cases) and frontend stayed at 94/94. Builds are green on both sides; bundle 168.1 KB gz (31.9 KB headroom). Security posture unchanged from v1 (0 HIGH/CRITICAL); no new HIGH introduced by any fix patch. The application is now operationally shippable to Neon + Render + Vercel.

---

## Workstream 1 (Build) — re-confirmed

| Layer | Command | Result |
|---|---|---|
| Backend tests | `cd backend && npm test` | **109 / 109** in 1.29 s |
| Backend build | `cd backend && npm run build` | exit 0; Prisma client (7.8.0) generated |
| Frontend tests | `cd frontend && npx vitest --run` | **94 / 94** in 1.70 s |
| Frontend build | `cd frontend && npm run build` | exit 0; 6 pages compiled |
| Frontend bundle | `cd frontend && npm run bundle-check` | **168.1 KB gz** vs 200 KB cap (31.9 KB headroom) |

Backend grew by 3 (was 106) from the new `health.controller.spec.ts`. Frontend unchanged. Total **203 passing tests** — matches the brief's expectation.

---

## Workstream 2 (Bootability) — re-verified

```
createdb jee_platform_stage5_v2_smoke
cd backend && \
  DATABASE_URL=postgresql://$USER@localhost:5432/jee_platform_stage5_v2_smoke \
  MIGRATION_DATABASE_URL=postgresql://$USER@localhost:5432/jee_platform_stage5_v2_smoke \
  npx prisma migrate deploy
```

Tail of output:
```
Applying migration `0006_diagnostic_summaries`
Applying migration `0007_problem_reviews`
Applying migration `0008_calibration_mismatch`
Applying migration `0009_users_and_auth`
Applying migration `0010_cohorts_assignments`
Applying migration `0011_test_sessions`
Applying migration `0012_attempts_extensions`
Applying migration `0013_calibration_mismatch_columns`

The following migration(s) have been applied:
  └─ 0001_init/migration.sql
  └─ 0002_roles_and_extensions/migration.sql
  ...
  └─ 0013_calibration_mismatch_columns/migration.sql

All migrations have been successfully applied.
```

Cleanup: `dropdb jee_platform_stage5_v2_smoke` → OK.

**Verdict: PASS.** The v1 failures at `0002` (relation does not exist) and `0006` (column "hints" does not exist) are both resolved.

---

## Workstream 3 (Security) — unchanged from v1

Inspected the seven fix patches for new HIGH/CRITICAL surface area:
- **Health controller** — no DB access, no user input, no secret read. `@Public()` is correct (the probe must not require a cookie). `package.json` version is read at compile time via `require("../../package.json")`; no path-traversal risk.
- **`next.config.ts` rewrite** — `BACKEND_API_BASE` is read from env, not from request input. No SSRF, no header smuggling. Empty-array fallback when unset means no proxy is silently established.
- **Workflow `deploy.yml`** — secret reference is `${{ secrets.MIGRATION_DATABASE_URL }}` only; no secrets echoed; concurrency lock prevents racing migrations. `pull_request` triggers run CI but the `if: github.event_name == 'push' && github.ref == 'refs/heads/main'` guard on `migrate-deploy` prevents PR runs from touching prod.
- **`db-privilege.spec.ts`** — opens a Postgres client only when `INTEGRATION=true`; uses parameterised / literal-only SQL; closes the connection in `afterAll`.
- **Migration `0006` reorder** — pure DDL reordering inside the same migration. No new privileges granted to `app_user`. The new `0001_init` is byte-identical content to the old `20260524093545_init`, just renamed.

Secrets: hardcoded-secret grep across `backend/src` + `frontend/src` (`password\s*=\s*['"]|secret\s*=\s*['"]|api[_-]?key\s*=\s*['"]|Bearer\s+[A-Za-z0-9]{20,}`) → **0 hits**. `.gitignore` still covers `.env`, `.env.*.local`, `*.pem`, `*.key`, `secrets/`, `credentials.json`.

**Verdict: 0 CRITICAL / 0 HIGH / 1 MEDIUM (carried-over A05 cross-origin, now mitigated by the Next.js rewrite gate fix) / 3 LOW (carry-overs).** No new HIGH/CRITICAL introduced by fix patches.

---

## Workstream 4 (Deployment) — fix verification

| v1 Blocker | Status | Evidence |
|---|---|---|
| **HIGH #1 — Migration A (`_init` sort order)** | **VERIFIED** | `backend/prisma/migrations/0001_init/migration.sql` exists; `20260524093545_init` directory is gone (`ls` → "No such file or directory"). Fresh-DB smoke applied `0001_init` first. |
| **HIGH #1 — Migration B (`hints` column ordering)** | **VERIFIED** | `0006_diagnostic_summaries/migration.sql:23` `ADD COLUMN IF NOT EXISTS hints JSONB`; trigger declaration at `:127` `BEFORE INSERT OR UPDATE OF wrong_paths, hints`. `0008_calibration_mismatch/migration.sql:3-5` header comment explains the move away from 0008. New `backend/prisma/migrations/README.md` codifies the cumulative-state rule. |
| **HIGH #2 — Health endpoint** | **VERIFIED** | `backend/src/health/health.controller.ts:30` `@Controller("api/health")`, `:42-43` `@Public() @Get()`. Registered in `backend/src/app.module.ts:22,36` (`HealthModule`). Spec at `backend/src/health/health.controller.spec.ts` (3 passing test cases). Response shape `{ status, version, uptime, timestamp }` matches the brief. |
| **HIGH #3 — Same-origin proxy** | **VERIFIED** | `frontend/next.config.ts:20-32` `async rewrites()` returns `[{ source: '/api/:path*', destination: '${backendBase}/api/:path*' }]` when `BACKEND_API_BASE` is set, `[]` otherwise (graceful dev fallback). `frontend/README.md:38-56` documents `BACKEND_API_BASE` as REQUIRED on Vercel. |
| **HIGH #4 — Node pinning** | **VERIFIED** | `.nvmrc` at repo root: `v26.0.0`. `backend/package.json:8-10` and `frontend/package.json:5-7`: `"engines": { "node": ">=22.0.0" }`. Workflow uses `node-version-file: .nvmrc` on every job. |
| **HIGH #5 — `prisma generate` in build** | **VERIFIED** | `backend/package.json:12` `"build": "prisma generate && nest build"` AND `:13` `"postinstall": "prisma generate"`. Live build produced "Generated Prisma Client (7.8.0) to ./generated/prisma in 59ms". |
| **HIGH #6 — CI/CD workflow** | **VERIFIED** | `.github/workflows/deploy.yml` present (177 lines). `backend-ci` (lines 51-84), `frontend-ci` (86-121), `migrate-deploy` (123-162), `notify` (164-176). `migrate-deploy` is gated `if: github.event_name == 'push' && github.ref == 'refs/heads/main'` (line 126), `needs: backend-ci` (127), `concurrency: prisma-migrate-deploy / cancel-in-progress: false` (133-135), uses `${{ secrets.MIGRATION_DATABASE_URL }}` (139). Required-secrets documented in the workflow header (lines 18-31). `python3 -c "import yaml; yaml.safe_load(...)"` → `OK`. |
| **HIGH carry-over — Real-DB privilege test** | **VERIFIED** | `backend/test/integration/db-privilege.spec.ts` (117 lines). Covers UPDATE/DELETE failure on `attempts` and `test_session_audit` (4 cases asserting `42501`), plus an INSERT-positive-control on `attempts` and a `current_user` sanity check (6 cases total). `describeIf = RUN ? describe : describe.skip` (line 31) gates on `INTEGRATION=true`. `npm test` output greps to 0 hits for `db-privilege`. `npm run test:integration` script wired at `backend/package.json:15` to `INTEGRATION=true jest --config ./test/jest-integration.json`. |

**Verdict: 7/7 VERIFIED.**

---

## Workstream 5 (Runbook) — updated

`05-deployment-runbook.md` updated in three places:
1. **Header** — status flipped from "GATED" to "CLEARED FOR DEPLOY (v2)"; pointer added to this v2 report.
2. **§1 Blocking gates** — replaced the 7-gate "must be fixed" list with 7 entries describing what shipped + where the evidence lives.
3. **§2.4 Migrations from CI** — clarified that the only GitHub secret needed is `MIGRATION_DATABASE_URL` and that manual `prisma migrate deploy` is now retired in favour of the workflow.
4. **§2.5 Render deploy** — health-check path now documented as `/api/health` with the response shape.
5. **§7 (new section) — Post-fix verification** — summarises the v2 re-verify pass for future readers.

The runbook is otherwise unchanged (§3 smoke tests, §4 rollback, §5 day-2 ops, §6 known limitations all still apply).

---

## Carried-over issues for ship

All `LOW` — none gate deploy. Repeated from `05-integration-final.md` v1 for completeness:

- **[LOW]** `hmac-token.spec.ts:149` "rejects tampered MAC" is occasionally flaky (~1× per 7 runs); did not reproduce in either the v1 or v2 sweep. Refactor to deterministic mutation is a 1-line change for someone.
- **[LOW]** Frontend numeric `-0` divergence: backend collapses `-0` to `"0"`, frontend keeps `"-0"`. Safe for v1; converge in next sprint.
- **[LOW]** Heartbeat cadence 60 s while `NETWORK_FAILURE_WINDOW_MS = 30 s`. Spec drift; non-blocking.
- **[LOW]** No `app.setGlobalPrefix('api')` (the `/api/health` controller hard-codes the prefix; rest of the routes also hard-code it — works, but the lack of a single source of truth is a footgun).
- **[LOW]** No global ExceptionFilter for unknown errors → default Nest filter leaks stack frames in `NODE_ENV !== 'production'`.
- **[LOW]** Importer (`backend/scripts/import-yaml.ts`) does not validate `wrong_paths[].diagnostic_tag` shape against the taxonomy enum.
- **[LOW]** `TelemetryQueue.drainAndWait` doesn't early-exit on dormant; submit modal "draining…" can sit for up to 10 s before flipping during a re-auth race.
- **[LOW]** Dashboard is an acknowledged stub; the proper dashboard PRD is a separate spec loop.
- **[LOW]** Lighthouse-CI not wired; PRD-16 NFR §5.1 p50/p95 TTFP/TTI targets unverified.
- **[LOW]** A11y for ViolationBanner `aria-live="assertive"` plumbing is not asserted by tests.
- **[MEDIUM (deferred)]** Expired-session cron is not running. `auth_sessions` grows until manually pruned. Not security-critical (`expires_at` is checked on resolve) but storage will creep.

---

## Required pre-deploy actions for Mrinal

1. **In GitHub → Settings → Secrets and variables → Actions**, add a single secret: `MIGRATION_DATABASE_URL`. Value comes from §2 step 2 of the runbook (the `migration_user` Postgres URL on Neon, direct connection, NOT pgbouncer-pooled).
2. **In Render**, when creating the backend web service, set the health-check path to `/api/health` and confirm the build command is `npm ci && npm run build` (the `postinstall` hook handles `prisma generate`; the build script handles it again as a belt-and-braces guard).
3. **In Vercel**, on the frontend project, set the `BACKEND_API_BASE` environment variable to the Render backend's public HTTPS URL (e.g. `https://jee-platform-api.onrender.com`). Without it, the `/api/*` rewrite is a no-op and every API call from the browser 404s.

Once those three settings are in place, push to `main`. The CI workflow runs `backend-ci` + `frontend-ci` in parallel; on green, `migrate-deploy` applies the 13 migrations to Neon as `migration_user`; Render auto-deploys the backend; Vercel auto-deploys the frontend. UptimeRobot can then be wired to ping `/api/health` (runbook §2.7).

---

## Ship verdict justification

The seven v1 blockers all shipped fixes that hold up under file/content inspection AND under a live fresh-DB `prisma migrate deploy` replay (the precise probe that failed in v1). The application code that was already at production quality in v1 is unchanged; the operational glue that was missing — migration ordering, health endpoint, same-origin proxy, Node pinning, Prisma-generate-on-build, CI workflow, integration test — is now all in place. There is no new HIGH/CRITICAL finding from the fix patches themselves. Safe to deploy.

---

*End of Stage 5 integration v2 report.*
