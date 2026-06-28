# jee_platform — Deployment Runbook (Stage 5)

**Owner:** Integrator (Stage 5)
**Status:** CLEARED FOR DEPLOY (v2). All 7 v1 blockers verified fixed on 2026-06-28. See `05-integration-final-v2.md` for the re-verification report and `§7 Post-fix verification` below for the audit summary.
**Target stack:** Neon (Postgres 16) + Render (NestJS backend) + Vercel (Next.js 16 frontend) + GitHub Actions (CI/CD for migrations).

---

## 0. Prerequisites

Accounts required:
- **Neon** (Postgres host) — create project `jee_platform`. Two branches: `main` (prod) and `dev` (ephemeral PR DBs).
- **Render** — Web Service for the backend (Node runtime). Plan: Starter ($7/mo) or Pro for pilot.
- **Vercel** — Project linked to the same GitHub repo, root directory = `frontend/`.
- **GitHub** — Repo with Actions enabled. Hold `MIGRATION_DATABASE_URL` in repo secrets.
- **Sentry** (optional but recommended) — frontend + backend DSNs.
- **UptimeRobot** — once `/api/health` exists, ping every 60 s.

Locally installed:
- `node` 22.x (match prod — see "Pin Node version" gate below).
- `psql` for Neon CLI tasks.
- `npx prisma migrate diff` working locally.

---

## 1. Blocking gates before deploy — RESOLVED in v2

All 7 v1 gates have shipped fixes and were re-verified by the Integrator on 2026-06-28. Each item below summarizes the fix that landed; the audit is in `05-integration-final-v2.md`.

1. **Migration ordering — FIXED.**
   - `20260524093545_init` was renamed to `0001_init` so it sorts before the rest of the chain.
   - `0006_diagnostic_summaries/migration.sql` now `ADD COLUMN hints` at line 23, well before the `BEFORE INSERT OR UPDATE OF wrong_paths, hints` trigger at line 127.
   - `0008_calibration_mismatch/migration.sql` no longer touches `hints` (only the calibration-mismatch columns) — a header comment explains the move.
   - New `backend/prisma/migrations/README.md` documents the lexicographic-ordering and cumulative-state rules so future migrations don't reintroduce the bug.
   - Verified by `prisma migrate deploy` against a fresh DB (`jee_platform_stage5_v2_smoke`): "All migrations have been successfully applied."

2. **Health endpoint — FIXED.** `backend/src/health/health.controller.ts` exposes `GET /api/health` (`@Public()` so AuthGuard skips it) returning `{ status, version, uptime, timestamp }`. Wired via `HealthModule` in `backend/src/app.module.ts`. Render's health-check path is `/api/health` (see §2 step 5).

3. **Cross-origin posture — FIXED (Option A, the preferred Next.js rewrite).** `frontend/next.config.ts` exports `async rewrites()` that proxies `/api/:path*` → `${BACKEND_API_BASE}/api/:path*` when `BACKEND_API_BASE` is set, and falls back to an empty array otherwise (graceful dev default). `frontend/README.md` §"Required environment variables on Vercel" documents that `BACKEND_API_BASE` is REQUIRED on Vercel.

4. **Node version pinning — FIXED.** `.nvmrc` at repo root pins `v26.0.0`; `engines.node ">=22.0.0"` set in both `backend/package.json` and `frontend/package.json`. The CI workflow uses `node-version-file: .nvmrc` on every job.

5. **Backend build regenerates Prisma client — FIXED.** `backend/package.json` now has `"postinstall": "prisma generate"` AND `"build": "prisma generate && nest build"` (belt-and-braces). Verified by `npm run build` → "Generated Prisma Client (7.8.0) to ./generated/prisma".

6. **GitHub Actions workflow — FIXED.** `.github/workflows/deploy.yml` exists with three jobs:
   - `backend-ci` — lint + test + build (Node from `.nvmrc`).
   - `frontend-ci` — lint + test + build + bundle-check (in parallel with backend-ci).
   - `migrate-deploy` — gated on `push` to `main` + `needs: backend-ci`; runs `npx prisma migrate deploy` with `DATABASE_URL=${{ secrets.MIGRATION_DATABASE_URL }}`; concurrency-locked under `prisma-migrate-deploy` so two pushes cannot race a migration.
   The workflow's header documents that the ONLY GitHub secret needed is `MIGRATION_DATABASE_URL`. Render-only / Vercel-only secrets stay on those platforms.

7. **Real-DB privilege test (carry-over HIGH) — FIXED.** `backend/test/integration/db-privilege.spec.ts` covers the 5 negative cases (UPDATE/DELETE on `attempts`; UPDATE/DELETE on `test_session_audit`) plus a positive control (INSERT into `attempts` should be allowed at the privilege layer). Runs only when `INTEGRATION=true` so the default `npm test` runner never trips on it. Invoke with `npm run test:integration` from `backend/` against a DB seeded by migrations and a `TEST_DATABASE_URL` authenticating as `app_user_login`.

---

## 2. Provisioning order (one-time, after gates pass)

1. **Neon — create the prod database.**
   - Create branch `main`; copy the **connection string** (this becomes both `DATABASE_URL` and `MIGRATION_DATABASE_URL` at the **superuser** level for the first run, then split — see step 2).
   - Append `?sslmode=require&pgbouncer=true&connection_limit=20` to the URL (PgBouncer transaction-pooled connection per architecture §9.2).
   - For migrations specifically, you may need a direct (non-pgbouncer) URL: keep both — the migration job uses the direct URL, the runtime app uses the pgbouncer URL.

2. **Bootstrap roles + login users on Neon.**
   - Connect as the Neon superuser; run the role-bootstrap block from `backend/prisma/migrations/0002_roles_and_extensions/migration.sql` lines 1-58 (the role + login-user DO blocks). This is idempotent.
   - Set passwords for `migration_user` and `app_user_login`: `ALTER USER migration_user WITH PASSWORD '<random>'`; same for `app_user_login`. **Generate via `openssl rand -base64 32` each.**
   - Build the two URLs:
     - `MIGRATION_DATABASE_URL = postgresql://migration_user:<pwd>@<neon-host>/<db>?sslmode=require` (direct, no pgbouncer — `prisma migrate` needs a session).
     - `DATABASE_URL = postgresql://app_user_login:<pwd>@<neon-host>/<db>?sslmode=require&pgbouncer=true&connection_limit=20`.

3. **Generate HMAC pepper.**
   - `openssl rand -hex 32` → store as `HMAC_PEPPER` (Render + Vercel env vars; same value on both).

4. **Run migrations from CI (NOT from your laptop).**
   - In GitHub → Settings → Secrets and variables → Actions, set `MIGRATION_DATABASE_URL` to the `migration_user` connection string from step 2. This is the **only** GitHub Actions secret the project needs.
   - Push to `main`. The `deploy.yml` workflow's `migrate-deploy` job (gated on `backend-ci` passing, concurrency-locked under `prisma-migrate-deploy`) runs `npx prisma migrate deploy`.
   - Confirm the Actions log shows all 13 migrations applied: `0001_init` through `0013_calibration_mismatch_columns`.
   - No more manual `npx prisma migrate deploy` from a laptop — the workflow is now the only path that touches prod schema.

5. **Deploy Render backend.**
   - New Web Service → connect to GitHub repo → root directory `backend/`.
   - Build command: `npm ci && npx prisma generate && npm run build`.
   - Start command: `node dist/main`.
   - Environment vars (Render dashboard):
     - `NODE_ENV=production`
     - `PORT=4000` (Render binds whatever PORT it injects; the app reads `process.env.PORT`).
     - `DATABASE_URL` = the `app_user_login` URL.
     - `HMAC_PEPPER` = generated value.
     - `SENTRY_DSN` (optional).
     - **Do NOT set `MIGRATION_DATABASE_URL` here.** That secret stays in GitHub.
   - **Health check path: `/api/health`** — returns `{ status: "ok", version, uptime, timestamp }`. Marked `@Public()` so AuthGuard does not challenge Render's probe.

6. **Deploy Vercel frontend.**
   - New Project → import GitHub repo → root directory `frontend/`.
   - Framework preset: Next.js (auto-detected).
   - Build command: `npm run build`.
   - Environment vars:
     - `NEXT_PUBLIC_API_BASE_URL` = `https://<your-vercel-domain>` (so client-side calls go to the Vercel domain and hit the rewrite — assumes gate #3 option A).
     - `BACKEND_API_BASE` = `https://<your-render-backend>.onrender.com` (used by Next.js server components to forward cookies to the backend directly).
     - `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` (optional).
   - **Do NOT set `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `HMAC_PEPPER` here** — frontend has no DB access and does not sign tokens.

7. **Wire UptimeRobot** — ping `https://<your-vercel-domain>/api/health` every 60 s.

---

## 3. Post-deploy smoke tests

Run these manually after every deploy.

```bash
# 1. Backend reachable + healthy.
curl -i https://<vercel-domain>/api/health
#   expect: 200 OK, { ok: true, version: "<commit-sha>" }

# 2. Login fails on bad creds (no leakage).
curl -i -X POST https://<vercel-domain>/api/auth/session \
  -H 'content-type: application/json' \
  -d '{"email":"nobody@example.com","password":"x"}'
#   expect: 401 { error: "invalid_credentials" }, NO Set-Cookie

# 3. Login succeeds with seeded teacher creds (set during step 2 bootstrap).
curl -i -c cookies.txt -X POST https://<vercel-domain>/api/auth/session \
  -H 'content-type: application/json' \
  -d '{"email":"<teacher-email>","password":"<teacher-pwd>"}'
#   expect: 200 OK, Set-Cookie: session=...; HttpOnly; Secure; SameSite=Lax

# 4. Authed call works.
curl -i -b cookies.txt https://<vercel-domain>/api/dashboard/assigned-tests
#   expect: 200 OK, { tests: [...] }

# 5. Authed call without cookie → 401.
curl -i https://<vercel-domain>/api/dashboard/assigned-tests
#   expect: 401 { error: "unauthorized" }
```

UI smoke:
- Visit `/` → redirects to `/login`.
- Log in as the teacher → lands on `/dashboard` (the dashboard stub from UX-audit v2).
- Log in as a seeded student → can see assigned tests, can click "Begin" on one → `/test/{sessionId}/instructions` renders → "Start" → runtime renders question + palette + timer.
- Reduce 1 question to test mid-test save: pick an MCQ, click "Save & Next", verify network tab shows `/snapshots` PATCH succeeded.
- Submit the test → `/results` page shows the score breakdown.

---

## 4. Rollback procedure

Tier 0 (no DB schema change):
- **Render**: dashboard → service → "Manual Deploy" → pick the prior commit → deploy.
- **Vercel**: dashboard → project → Deployments → pick a prior production deployment → "Promote to Production".

Tier 1 (DB schema change in flight):
- Identify the bad migration `0NNN`.
- Run the migration's `down.sql` manually as `migration_user`:
  ```bash
  psql "$MIGRATION_DATABASE_URL" -f backend/prisma/migrations/0NNN_<name>/down.sql
  ```
- Mark the migration as rolled-back in `_prisma_migrations`:
  ```sql
  UPDATE _prisma_migrations SET rolled_back_at = now() WHERE migration_name = '0NNN_<name>';
  ```
- Re-deploy the prior commit via Render/Vercel rollback.

Tier 2 (data corruption):
- Neon supports point-in-time-restore via branching: dashboard → branch → "create branch from timestamp T".
- Point `DATABASE_URL` at the new branch; re-deploy backend.

---

## 5. Day-2 ops

**Monitoring signals:**
- Sentry — error rate alarm (>1% of requests in 5 min) routes to email.
- UptimeRobot — `/api/health` ping every 60 s; alarm after 2 missed pings.
- Render dashboard — CPU + memory baseline tracked weekly.
- Neon dashboard — slow query log + connection count.

**On-call signals & runbooks:**
- 5xx spike → check Sentry → check Render logs.
- DB connection exhausted (`too many clients`) → check pgbouncer transaction-pool limit; raise `connection_limit=` in `DATABASE_URL`.
- Auth-session table bloat → cron `DELETE FROM auth_sessions WHERE expires_at < now()` (currently NOT scheduled — see "Known limitations" #4).
- HMAC pepper rotation — quarterly procedure documented in architecture §7.3; deferred to post-pilot per arch §13 Q-arch-2.

**Log destinations:**
- Render — Render's built-in log viewer; optionally forward to Logtail/Datadog.
- Vercel — Vercel logs (browser console for client, function logs for server components).
- Sentry — both stacks.

---

## 6. Known limitations carried into pilot

These were accepted at gate-pass time. Surface them so on-call knows what's expected vs unexpected.

1. **MEDIUM (NEW-2 carry)** — DOMPurify config does not pin `ALLOWED_URI_REGEXP`. Defence-in-depth gap for the day someone widens `ALLOWED_TAGS` to include `<a>`.
2. **MEDIUM (NEW-3 carry)** — Violation-transaction coupling: a deadlock during the 3rd-violation auto-submit rolls back the violation audit row together with the submit. Visible to ops as "we know the student violated but the row is gone if submit threw."
3. **MEDIUM (N7 carry)** — No application-level cap on per-request `action_seq` jump or `visit_count` jump in `patchSnapshot` UPSERT. The 60/min throttle is the mitigation.
4. **MEDIUM** — Expired-session cron is not running. `auth_sessions` will grow until manually pruned (cheap fix; not security-critical because `expires_at` is checked on resolve).
5. **LOW (NEW-4 carry)** — Heartbeat cadence is 60 s while NETWORK_FAILURE_WINDOW_MS is 30 s. Spec drift; non-blocking.
6. **LOW (N16/N17/N18 carry)** — No `app.setGlobalPrefix('api')`; no global ExceptionFilter for unknown errors; importer does not validate `wrong_paths[].diagnostic_tag` shape.
7. **LOW (NEW-7)** — `TelemetryQueue.drainAndWait` doesn't early-exit on dormant; submit-modal "draining…" sits for up to 10 s before flipping to AuthErrorBanner during a re-auth race.
8. **LOW** — `hmac-token.spec.ts:149` "rejects tampered MAC" is occasionally flaky (~1× per 7 runs); harmless to runtime, requires deterministic-mutation refactor (1 line).
9. **LOW** — Frontend numeric `-0` divergence: backend collapses `-0` to `"0"`, frontend keeps `"-0"`. Backend is authority; safe for v1 but should converge.
10. **LOW** — Dashboard is an acknowledged stub. The proper dashboard PRD is a separate spec loop.
11. **LOW** — Lighthouse-CI not wired; PRD-16 NFR §5.1 p50/p95 TTFP/TTI targets are unverified.
12. **LOW** — A11y for ViolationBanner `aria-live="assertive"` plumbing is not asserted by tests.

---

## 7. Post-fix verification (Stage 5 v2)

On 2026-06-28 the Integrator re-verified each of the 7 v1 blockers and ran the
full build/test sweep. Summary:

- **Migration ordering** — re-ran `prisma migrate deploy` against a fresh DB
  (`jee_platform_stage5_v2_smoke`). Output: "All migrations have been
  successfully applied." Old `20260524093545_init` directory is gone; new
  `0001_init/migration.sql` is in place; `0006_diagnostic_summaries/migration.sql`
  ADDs the `hints` column at line 23, well before the trigger at line 127;
  `0008_calibration_mismatch/migration.sql` no longer references `hints`.
  `backend/prisma/migrations/README.md` documents the rules going forward.
- **Health endpoint** — `backend/src/health/health.controller.ts` + `health.module.ts`
  exist; `@Public()` decorator applied; registered in `app.module.ts`; one
  passing spec (`health.controller.spec.ts`, 3 cases).
- **Same-origin proxy** — `frontend/next.config.ts` rewrites `/api/:path*` to
  `${BACKEND_API_BASE}/api/:path*`; documented in `frontend/README.md`.
- **Node pinning** — `.nvmrc` (`v26.0.0`) + `engines.node ">=22.0.0"` in both
  package.json files.
- **Prisma generate in build** — `postinstall: prisma generate` AND
  `build: prisma generate && nest build`.
- **CI workflow** — `.github/workflows/deploy.yml` parses clean
  (`python3 -c "import yaml; yaml.safe_load(...)"` → OK); jobs `backend-ci` +
  `frontend-ci` + `migrate-deploy` + `notify` present; `migrate-deploy` is
  gated, needs `backend-ci`, and concurrency-locked.
- **Integration test** — `backend/test/integration/db-privilege.spec.ts` exists;
  `npm run test:integration` script wired; `npm test` (default) skips it
  (`describeIf` gated on `INTEGRATION=true`).

Suite counts re-confirmed:
- Backend tests: 109/109 (was 106 in v1 — +3 from the new health spec)
- Frontend tests: 94/94 (unchanged)
- Backend build: green
- Frontend build: green; bundle 168.1 KB gz (31.9 KB headroom under 200 KB cap)

Ship verdict in v2: **SHIP.**

---

*End of runbook.*
