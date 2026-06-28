# Stage 5 — Integration & Sign-off Report

**Stage:** 5 (Integration / final ship-or-no-ship gate)
**Author:** Integrator
**Date:** 2026-06-28
**Method:** Build/test verification + smoke boot against local Postgres + security cross-check (file:line) + deployment-readiness audit.

---

## SHIP VERDICT — **NO-SHIP**

Three HIGH-severity deployment-blocking issues are open; one is structurally CRITICAL (the migration sequence does not succeed against a fresh database). Code quality on the application surface is genuinely solid — backend + frontend builds pass, all 200 tests pass, security posture inside the application code is strong — but the operational glue needed to ship to Neon + Render + Vercel is not in place. Without it, attempting deploy on a fresh Neon DB will fail at migration 0006, the running app will not be able to talk to its frontend across origins, and Render won't have a health endpoint to do zero-downtime deploys.

Time to NO-SHIP → SHIP: estimated 4-6 engineer hours to close the three HIGH gates.

---

## Workstream 1 — Build status

| Layer | Command | Result |
|---|---|---|
| Backend build | `cd backend && npm run build` | exit 0 — clean |
| Backend tests | `cd backend && npm test` | **106 / 106 pass** in 1.16 s |
| Frontend build | `cd frontend && npm run build` | exit 0 — Next.js 16.2.6 Turbopack OK, 6 pages compiled |
| Frontend tests | `cd frontend && npx vitest --run` | **94 / 94 pass** in 1.76 s |
| Frontend bundle | `cd frontend && npm run bundle-check` | **168.1 KB gz** vs 200 KB cap → 31.9 KB headroom |

**Verdict: PASS.** 200 tests pass total. (Tester report quoted 182; the frontend suite has grown by 18 since Stage 4. The hmac-token.spec.ts flake noted in Stage 4 did NOT reproduce in this run.)

---

## Workstream 2 — Bootability probe

Postgres is reachable locally (`psql -h localhost -U $USER -d postgres -c 'SELECT 1'` → returns `1`).

Attempted a fresh smoke boot:
1. `createdb jee_platform_integrator_smoke`
2. `DATABASE_URL=…/jee_platform_integrator_smoke MIGRATION_DATABASE_URL=… npx prisma migrate deploy`

**Result: FAILED.** Two distinct ordering bugs:

**Bug A — `_init` migration name sorts wrong.** Prisma applies migrations in alphabetical order. The on-disk layout has:
```
0002_roles_and_extensions
0003_taxonomy_enums
…
0013_calibration_mismatch_columns
20260524093545_init
```
`20260524093545_init` sorts AFTER `0002_…`, but `0002_…` references `public.problems` (created by `_init`). First-run output:
```
Applying migration `0002_roles_and_extensions`
Error: P3018 — relation "public.problems" does not exist
```

**Bug B — Even after renaming `_init` to `0001_init`, migration 0006 fails.** `0006_diagnostic_summaries/migration.sql:122` does `CREATE TRIGGER … BEFORE INSERT OR UPDATE OF wrong_paths, hints ON public.problems`, but the `hints` column is not added to `problems` until `0008_hints_calibration_mismatch/migration.sql:10` (`ALTER TABLE problems ADD COLUMN IF NOT EXISTS hints JSONB NOT NULL DEFAULT '[]'::jsonb`). Output:
```
Applying migration `0006_diagnostic_summaries`
Error: P3018 — column "hints" of relation "problems" does not exist
```

This is a CRITICAL ship-blocker for any fresh DB (Neon prod, any ephemeral CI DB, any new developer onboarding). The existing dev DB (`jee_platform_dev`) does not surface this because it only has `_init` applied — none of the 12 follow-on migrations have ever been run anywhere. So the bug has been latent since Stage 3.

**Cleanup:** `dropdb jee_platform_integrator_smoke` — done.

**Verdict: FAIL.** Migration sequence must be repaired before any deployment.

---

## Workstream 3 — Security cross-check

Audited against the BLOCKING-security rule from `agent-factory/CLAUDE.md` ("hardcoded secrets, unparameterized queries, missing auth checks, or a user able to read another user's data are automatic NO-SHIP conditions").

**Secrets — PASS.**
- `.gitignore` lines 19-26 cover `.env`, `.env.*.local`, `*.pem`, `*.key`, `secrets/`, `credentials.json`. Verified.
- Hardcoded-secret grep across `backend/src` + `frontend/src` (`password\s*=\s*['"]|secret\s*=\s*['"]|api[_-]?key\s*=\s*['"]|Bearer\s+[A-Za-z0-9]{20,}`) → **0 hits**.
- Every secret in code reads `process.env.X`. Inventory:
  - `backend/src/main.ts:33` — `PORT`
  - `backend/src/auth/auth.controller.ts:57` — `NODE_ENV`
  - `backend/src/prisma/prisma.service.ts:27` — `DATABASE_URL`
  - `backend/src/lib/hmac-token.ts:42` — `HMAC_PEPPER` (with fail-closed throw if missing; line 45-46)
  - `frontend/src/lib/session-fetch.ts:24` — `BACKEND_API_BASE`
- `MIGRATION_DATABASE_URL` is referenced in env templates but not directly read by runtime code (only by Prisma CLI during CI). Correct.

**Auth — PASS.**
- Cookie attributes (`backend/src/auth/auth.controller.ts:55-61`): `httpOnly: true`, `secure: process.env.NODE_ENV === 'production'`, `sameSite: 'lax'`, `maxAge: cookieMaxAgeSeconds()*1000`, `path: '/'`. Matches architecture §10.1.
- Login rate limit (`backend/src/auth/auth.controller.ts:41`): `@Throttle({ default: { limit: 10, ttl: 60_000 } })`. Matches architecture §5.5.
- AuthGuard global registration: `backend/src/auth/auth.module.ts:13` declares `{ provide: APP_GUARD, useClass: AuthGuard }`. NestJS applies all `APP_GUARD` providers globally; the ThrottlerGuard in `backend/src/app.module.ts:36` runs alongside. The `@Public()` decorator skips auth for the login endpoint only.
- Sessions stored in `auth_sessions` table (architecture §5.1; 0009 migration creates the table); the cookie value is a 32-byte base64url random string, looked up via parameterized `$queryRawUnsafe` in `backend/src/auth/auth-session.service.ts:173`. No JWT, no signing-key rotation footgun.

**Database — PASS** (modulo the Bug A/B ordering issues, which block migrations from ever running).
- `migration_role` / `app_user` / `trigger_owner` 3-role split: `backend/prisma/migrations/0002_roles_and_extensions/migration.sql` lines 14-44.
- `app_user` ownership withdrawal: `backend/prisma/migrations/0002_roles_and_extensions/migration.sql` lines 68-72 (ALTER TABLE … OWNER TO migration_role).
- REVOKE UPDATE/DELETE on append-only tables: confirmed in `backend/prisma/migrations/0012_attempts_extensions/migration.sql` (file present; reviewed during smoke probe).
- Triggers are SECURITY DEFINER + `SET search_path = pg_catalog, public` per `0006_diagnostic_summaries/migration.sql`. Owned by `trigger_owner`. Verified.
- No `$queryRawUnsafe` with user-input concatenation — all 82 occurrences use `$1`, `$2`, … positional parameters. Spot-checked `auth-session.service.ts:106-116`, `auth-session.service.ts:148-154`, `test-sessions.service.ts:125-149`. PASS.

**OWASP top-10 lens — PASS** (one MEDIUM note on A05).
- A01 Broken access control — `loadSessionOwned(sid, studentId)` is called at the entry of every `/api/test-sessions/:id/*` handler in `backend/src/test-sessions/test-sessions.service.ts` (24 hits). Cross-student probe: a student attempting to GET another student's session would fail the owner check at line 215 (`loadSessionOwned` throws 403). Verified by code path.
- A02 Cryptographic failures — bcrypt for passwords (PRD note); HMAC-SHA-256 with `crypto.timingSafeEqual` for figure tokens (`backend/src/lib/hmac-token.ts:188`); HTTPS cookies in production.
- A03 Injection — Prisma everywhere; no raw user input concatenated into SQL. Verified by grep.
- A05 Security misconfiguration — `helmet()` at `backend/src/main.ts:19`. CORS off (`backend/src/main.ts:31`). **MEDIUM NOTE:** with planned Vercel + Render split, CORS-off requires a Next.js rewrite proxy; see Workstream 4 finding 3.
- A07 Identification + auth failures — 10/min/IP throttle on login; 24-h session expiry; bcrypt hashing. No lockout policy on N failures; acceptable for v1.
- A08 Software + data integrity — append-only via REVOKE + role split (structural). Figure-token signing + 5-min grace verified in `hmac-token.ts:175-201` (fail-closed on missing pepper).
- A10 SSRF — grep for `fetch(req.body|fetch(req.query|http.get(req.params)` → 0 hits.

**Frontend security — PASS.**
- `frontend/src/lib/katex-render.ts:90` uses `DOMPurify.sanitize(fragment, PURIFY_CONFIG)` before any innerHTML; PURIFY_CONFIG (lines 29-36) allows only `b, i, em, strong, u, sub, sup, br, span` + `class` attr, no scripts/styles/event handlers.
- KaTeX itself escapes its TeX input; sanitization is applied only to non-math fragments.
- Telemetry queue (`frontend/src/lib/telemetry-queue.ts:18`) stores in IndexedDB via `idb-keyval`. Payload schema (lines 27-51) holds answer payload, slot index, time/visit deltas, hint count — no correct answers, no PII beyond what the student typed. Appropriate.

**Security verdict: 0 CRITICAL / 0 HIGH / 1 MEDIUM (A05 cross-origin gap) / 3 LOW (carry-overs from Stage-3).** No security gap blocks ship; the A05 gap is fold-in scope of Workstream 4 finding #3.

---

## Workstream 4 — Deployment readiness

Audited against the architecture's target: **Neon (Postgres) + Render (NestJS) + Vercel (Next.js) + GitHub Actions (CI)**.

**Ready:**
- Backend Express bootstrap (`backend/src/main.ts:33`) reads `PORT` env var → Render compatible.
- Frontend Next.js 16 standard build (`npm run build`) → Vercel compatible.
- `.env.example` (root + backend) documents `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `HMAC_PEPPER`, `BACKEND_API_BASE`, `NEXT_PUBLIC_*` with clear holder annotations.
- Same-origin cookie posture is internally consistent within `localhost` dev — no architectural drift.
- Frontend bundle 168 KB gz, well under 200 KB cap.
- Backend test suite runs without a live DB — services are unit-mocked.

**Needs config (HIGH):**
1. **Migration ordering broken (CRITICAL → must precede everything)** — see Workstream 2. `prisma migrate deploy` fails on a fresh DB. Required fix: rename `20260524093545_init` to `0001_init`; reorder so the `hints` column is added before any trigger references it (either move the trigger creation into 0008+ or add `hints` in an earlier-numbered migration). Verify by drop-and-replay against a fresh DB.
2. **No health endpoint** — `grep -rn '/healthz\|/api/health' backend/src` → 0 hits. Render needs a 200 OK URL for zero-downtime deploys; UptimeRobot is the standing assumption in `02-architecture-final.md` §11. Add `HealthController @Get('api/health')` + `@Public()` decorator.
3. **CORS / cross-origin posture** — `backend/src/main.ts:31` has `app.enableCors(false)`. Frontend client uses `credentials: 'same-origin'` (`frontend/src/lib/session-auth.ts:61`). On a Vercel + Render split (different domains), the auth cookie will NOT be sent. Two fixes (mutually exclusive):
   - **(preferred)** add `rewrites()` in `frontend/next.config.ts` so `/api/*` on the Vercel domain is transparently proxied to the Render backend. Same-origin posture preserved.
   - **(alt)** turn CORS on in backend with `origin: process.env.FRONTEND_ORIGIN, credentials: true`, and set the auth cookie with `SameSite=None` (requires HTTPS in dev too).
4. **No Node version pinning** — no `.nvmrc`, no `engines` field in `backend/package.json` or `frontend/package.json`. Add `"engines": { "node": ">=22 <23" }` per architecture §2 (which calls Node 22 LTS). Otherwise Render or Vercel may pick a different LTS and ship a Prisma client incompatibility.
5. **No `prisma generate` in backend build** — `backend/package.json` `build` is just `nest build`. `backend/.gitignore` line 4 excludes `generated/prisma`. Render's build will not have the Prisma client, leading to a runtime failure on the first DB call. Fix: `"postinstall": "prisma generate"` OR change `build` to `prisma generate && nest build`.
6. **No `.github/workflows/deploy.yml`** — the architecture §11.2 shows a two-step pipeline (migrate as `migration_user` via GitHub Actions, deploy backend via Render). Neither the workflow file nor the `.github/` directory exists. Without it, migrations have no path to run.
7. **No `backend/test/integration/` directory** — Tester report (`04-testing-report-v1.md` gap #1) flagged the missing `app_user_login` cannot-UPDATE-attempts spec as HIGH. Still missing.

**MEDIUM**:
- No application-layer cron pruning of expired `auth_sessions` rows. Table grows linearly until manually pruned.

**Verdict: NOT READY.** Six HIGH-severity gaps + Bug A/B in migrations. Closing them is the gating work for SHIP.

---

## Workstream 5 — Runbook

Runbook written to `/Users/ms/Documents/jee_platform/agent-factory/scorecards/05-deployment-runbook.md`. Sections:
1. Prerequisites (accounts + local tooling).
2. The seven blocking gates that must be fixed first.
3. Provisioning order (Neon → roles bootstrap → CI migrations → Render → Vercel → UptimeRobot).
4. Five-curl post-deploy smoke test.
5. Three-tier rollback (Render manual / DB down.sql / Neon point-in-time-restore).
6. Day-2 ops (monitoring signals, log destinations, on-call signals).
7. Eleven known limitations carried into prod, each labelled with its carry-over ID.

Runbook is complete and self-contained.

---

## Aggregate score

| Workstream | Verdict | Severity if open |
|---|---|---|
| 1 — Build status | PASS | — |
| 2 — Bootability | FAIL | **CRITICAL** (migration sequence) |
| 3 — Security cross-check | PASS (0 HIGH/CRITICAL) | MEDIUM (cross-origin) |
| 4 — Deployment readiness | FAIL | **HIGH** ×6 |
| 5 — Runbook | COMPLETE | — |

**Ship verdict: NO-SHIP.**

The application code is genuinely good — all 200 tests pass, security review clean, bundle under cap, UX audit at 7.79/10. The pipeline did what it's supposed to do: it produced shippable software. But the **operational glue between that software and a real cloud deployment is missing**: the migrations don't apply to a fresh database; there's no health endpoint; the cross-origin posture is broken; Node isn't pinned; Prisma client isn't generated at build; the CI workflow doesn't exist.

---

## Top 3 things Mrinal needs to know

1. **The migration sequence has a real bug** — if anyone runs `prisma migrate deploy` against a fresh database (which Neon prod absolutely IS), it will fail. The on-disk filenames sort wrong (`20260524093545_init` runs AFTER `0002_*`), and even after fixing that, migration 0006 references a column that's added in migration 0008. Estimated fix: 30 minutes (rename `_init` → `0001_init`, move `hints` column ADD earlier OR move the trigger creation later). Without this fix, deploy is impossible.

2. **The frontend on Vercel cannot talk to the backend on Render in the current code** — both sides assume same-origin (cookies use `same-origin` credentials, backend has CORS off). The cleanest fix is adding a Next.js rewrite in `frontend/next.config.ts` so `/api/*` requests on the Vercel domain transparently proxy to Render. Estimated fix: 1 hour including dev-env testing.

3. **Several deploy-table-stakes pieces don't exist yet**: no health endpoint, no Node version pinning, no `prisma generate` step in build, no `.github/workflows/deploy.yml`. These are 3-5 small atomic PRs; in aggregate maybe 2-3 engineer-hours. The runbook lists each gate at `agent-factory/scorecards/05-deployment-runbook.md` §1.

Once those land, the pipeline's verdict will flip to SHIP. The application work itself is already at production quality.

---

*End of Stage 5 integration report.*
