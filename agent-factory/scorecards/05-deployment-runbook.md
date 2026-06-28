# jee_platform — Deployment Runbook (Stage 5)

**Owner:** Integrator (Stage 5)
**Status:** GATED — see "Ship verdict" in `05-integration-final.md`. Do NOT execute the steps below until the three CRITICAL/HIGH blockers in that report are fixed.
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

## 1. Blocking gates before deploy

These MUST be resolved (full detail in `05-integration-final.md`):

1. **Migration ordering** — the on-disk migration sequence cannot succeed against a fresh database:
   - `20260524093545_init` sorts AFTER `0002_roles_and_extensions` alphabetically, but `0002` references tables created by `_init`.
   - Migration `0006_diagnostic_summaries` creates a trigger on `problems.hints`, but the `hints` column is not added until `0008_hints_calibration_mismatch`.
   - Fix: rename `20260524093545_init` to `0001_init`; reorder so `hints` column is added before the diagnostic-summary trigger references it (move trigger creation into 0008+ or move the hints column ADD into a pre-0006 migration). Verify with: drop a fresh DB, `prisma migrate deploy`, expect zero errors.

2. **Health endpoint** — Render needs `/api/health` (or any 200 OK) for zero-downtime deploys + UptimeRobot. Currently no health controller exists.
   - Fix: add `HealthController` (`@Get('api/health')`) returning `{ ok: true, version }`; mark `@Public()` so AuthGuard skips it.

3. **Cross-origin posture for separate Vercel + Render domains** — the architecture says "CORS off, same-origin"; the client uses `credentials: 'same-origin'`. With `app.example.com` (Vercel) + `api.example.com` (Render), cookies will NOT cross. Two valid options:
   - **(Preferred)** Next.js rewrite: in `frontend/next.config.ts`, add `rewrites()` so `/api/*` on the Vercel domain transparently proxies to the Render backend. Same-origin posture preserved end-to-end. Lowest-risk change.
   - **(Alternative)** Enable CORS in `backend/src/main.ts` with `origin: process.env.FRONTEND_ORIGIN`, `credentials: true`, set the auth cookie with `SameSite=None`. Requires HTTPS in dev too.

4. **Pin Node version** — no `engines` field or `.nvmrc`. Add `"engines": { "node": ">=22 <23" }` to both `backend/package.json` and `frontend/package.json`, plus `.nvmrc` at repo root with `22`.

5. **Backend build must regenerate Prisma client** — `generated/prisma/` is gitignored; current backend `build` script is just `nest build`. Add `"postinstall": "prisma generate"` (or change `build` to `prisma generate && nest build`) in `backend/package.json`. Without this, Render's deploy will boot with a stale or missing Prisma client and crash on first DB call.

6. **GitHub Actions workflow** — `.github/workflows/deploy.yml` does NOT exist. The architecture's two-step pipeline (migrate as `migration_user`, then deploy backend running as `app_user_login`) is required to honour the structural append-only invariant. Without it, migrations would either not run, or run with the runtime role (which lacks DDL privileges).

7. **Real-DB privilege test (Stage-4 carry-over HIGH)** — `backend/test/integration/db-privilege.spec.ts` is missing. Without it, a future migration that mistakenly grants UPDATE/DELETE on `attempts` or `test_session_audit` to `app_user` will not be caught. Add the spec described in architecture §3.2.

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
   - Push the fixed branch to GitHub.
   - GitHub Actions workflow `deploy.yml` runs `npx prisma migrate deploy` with `DATABASE_URL=${{ secrets.MIGRATION_DATABASE_URL }}`.
   - Confirm Actions log shows all 13 migrations applied (or the renumbered count after the ordering fix).

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
   - Health check path: `/api/health` (requires gate #2 fixed first).

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

*End of runbook.*
