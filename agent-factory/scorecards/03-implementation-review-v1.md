# Stage 3 (Implementation Loop) — Code Review v1

**Reviewer:** Code Reviewer (discriminator)
**Iteration:** 1 of 3
**Inputs:** Engineer-Migrations v1, Engineer-Backend v1, Engineer-Frontend v1 (three parallel tracks)
**Architecture under review:** `scorecards/02-architecture-final.md` (locked)
**Method:** deep read of high-risk files (schema.prisma, migrations 0006/0007/0011/0012, hmac-token.ts, test-sessions.service.ts, dashboard.service.ts, problems.service.ts, RuntimeProvider.tsx, anti-cheat.ts, telemetry-queue.ts, katex-render.ts, results/page.tsx); sample read of the rest; cross-verification of two flagged-CRITICAL items against actual server-side enforcement.

---

## Composite Score: 7/10

## Per-Track Scores
- Track 1 (Migrations): **8/10** — clean role separation, correct SECURITY DEFINER hygiene, every blocker from arch review v1 actually landed in SQL. Two operational paper-cuts; otherwise production-quality.
- Track 2 (Backend): **7/10** — solid OWASP posture, fully parameterized SQL, append-only structurally enforced; held back by 1 HIGH (missing login rate-limit) and 3 MEDIUM (N+1 + race in submit; missing `existing_reviews` in 422 body; late-snapshots TOCTOU).
- Track 3 (Frontend): **6/10** — state machine and telemetry queue correct; held back by 3 HIGH (no /state heartbeat poll → drift on long sessions; `NETWORK_FAILURE_FALLBACK` autosubmit path never emitted; statement text passed to `dangerouslySetInnerHTML` without escaping between math segments) and several MEDIUM gaps (Mac DevTools combo, unmark-for-review UX, option_count: 4 lock-in).

---

## Blocking Issues (must fix before advancing to Stage 4)

### B1. [SEVERITY: HIGH] No per-route rate limit on `POST /api/auth/session`
- **Track:** Backend
- **Where:** `/Users/ms/Documents/jee_platform/backend/src/app.module.ts:27-29` (single global bucket `{ ttl: 60_000, limit: 600 }`); no `@Throttle()` override on `/Users/ms/Documents/jee_platform/backend/src/auth/auth.controller.ts` POST handler.
- **Why it matters:** Architecture §5.5 specifies 10/min/IP for login (brute-force defence). With the current single-bucket 600/min/IP, credential stuffing is effectively unlimited at pilot scale. Constitution §1 priority order ranks security #2; this is a CLAUDE.md-binding gap.
- **Suggested fix:** Apply `@Throttle({ default: { ttl: 60_000, limit: 10 } })` to the login controller method, and key the throttler by request IP (the engineer's `app.module.ts` comment already anticipates per-route overrides).

### B2. [SEVERITY: HIGH] `NETWORK_FAILURE_FALLBACK` auto-submit source is never produced
- **Track:** Frontend
- **Where:** `/Users/ms/Documents/jee_platform/frontend/src/app/test/[sessionId]/RuntimeProvider.tsx` (search for `autoSubmit('NETWORK_FAILURE_FALLBACK')` — 0 hits). `telemetry-queue.ts:278-283` only surfaces `syncError` to UI; never escalates.
- **Why it matters:** PRD-16 US-7 E1 requires: if the queue cannot drain after N backoff attempts, the runtime must locally finalize and report `auto_submit_source = NETWORK_FAILURE_FALLBACK`. Without this, a student who loses connectivity past their timer either (a) submits late under the wrong source, or (b) the session sits ACTIVE and never lands attempts rows. Telemetry rule 5 + append-only rule 3 both depend on this code path firing.
- **Suggested fix:** In `telemetry-queue.ts` after the 5th consecutive backoff failure, call the late-bound `autoSubmit('NETWORK_FAILURE_FALLBACK')` (use the existing `autoSubmitRef` bridge wired at `RuntimeProvider.tsx:450-452`).

### B3. [SEVERITY: HIGH] No /state HEARTBEAT poll → server-clock drift on long sessions
- **Track:** Frontend
- **Where:** `/Users/ms/Documents/jee_platform/frontend/src/app/test/[sessionId]/RuntimeProvider.tsx:99-104` — `serverClockOffsetRef` is computed once at mount and never re-anchored.
- **Why it matters:** Architecture §5.3 endpoint 5 specifies HEARTBEAT every 30 s, and PRD-16 §5.3 names `server_now` as the authority. On a 3 h test on a sleeping laptop (or a tab where `setInterval` is throttled), the clock will drift relative to the server. Timer reads `Date.now() + serverClockOffsetMs` against a stale offset, so auto-submit fires late or — worse — submits after the server-side cron has already auto-submitted, then idempotent-collides.
- **Suggested fix:** Add a `useEffect` that calls `PUT /api/test-sessions/:id/state { action: 'HEARTBEAT' }` every 30 s, re-assigning `serverClockOffsetRef.current` from each response's `server_now`. Pause when `document.hidden`.

### B4. [SEVERITY: HIGH] Question statement HTML un-escaped between math segments → stored-XSS vector
- **Track:** Frontend
- **Where:** `/Users/ms/Documents/jee_platform/frontend/src/lib/katex-render.ts:19` — the `SEGMENT_RE.replace` callback emits non-math substrings verbatim, then the result is fed into `dangerouslySetInnerHTML` at `QuestionPane.tsx:37-41`, `MCQSingleChoice.tsx:46-51`, `MCQMultiChoice.tsx:52-58`, `results/page.tsx:86-90` and `:132-139`.
- **Why it matters:** Today the bank is reviewer-authored (small risk). PRD vision allows teacher-authored questions in future stages. A teacher (or a compromised reviewer account) can embed `<img src=x onerror=fetch('/api/auth/sessions/'+document.cookie)>` in a statement; server doesn't sanitize HTML in the YAML importer (`scripts/import-yaml.ts` only validates structure). Constitution §1 priority #2 (secure by default) demands HTML escape now, not later.
- **Suggested fix:** In `katex-render.ts`, wrap each non-math substring in the existing `escapeHtml` helper (already defined at L35-39 but only used in the catch branch). One-line change.

### B5. [SEVERITY: HIGH] `POST /api/problems/:question_code/reviews` 422 body missing `existing_reviews` array
- **Track:** Backend
- **Where:** `/Users/ms/Documents/jee_platform/backend/src/problems/problems.service.ts:103-115` — 422 body returns `{ error, message, details: { your_t_rating, your_jee_authenticity_score, raw_db_message }, retry_guidance }` only.
- **Why it matters:** Architecture §5.4 endpoint 14 and arch-review v1 Blocker 5 both pin the 422 body to MUST include `existing_reviews: [{reviewer_role, t_rating, jee_authenticity_score}, ...]`. Without it the API contract is silently broken; reviewer UI cannot show the teacher what they need to coordinate around. Engineer self-flagged this and punted.
- **Suggested fix:** Lift `projectPgError` to async and read `SELECT t_rating, jee_authenticity_score, reviewer_role FROM problem_reviews WHERE question_code = $1` after the rollback (the rollback releases the lock so the read sees committed state). Add the array into `details`. Also redact `raw_db_message` (LOW: it leaks trigger/column names).

---

## Non-Blocking Issues (can defer to Stage 4 / Engineer pickup)

### N1. [SEVERITY: MEDIUM] Submit transaction has per-slot N+1 `attempt_order` lookup + race
- **Track:** Backend
- **Where:** `test-sessions.service.ts:725-729` — one `SELECT COUNT(*) FROM attempts ... FOR each slot` inside the submit tx, no `FOR UPDATE` on (student, code) and no advisory lock. Two concurrent submits of the same problem (different sessions) would both read N → both insert N+1.
- **Suggested fix:** Replace with one window-function query computing `attempt_order` for all slots in one call, AND wrap in `pg_advisory_xact_lock(hashtext(student_id::text||question_code))` per slot — or move to a `SELECT ... FOR UPDATE` on the (student, code) attempt counter. Performance impact at pilot (≤ 30 slots) negligible; correctness impact bounded but real.

### N2. [SEVERITY: MEDIUM] Late-snapshots endpoint TOCTOU vs. submit
- **Track:** Backend
- **Where:** `test-sessions.service.ts:806-848` — `loadSessionOwned()` reads `submitted_at` at the top, no row lock; a concurrent submit can commit between then and the per-iteration INSERT.
- **Suggested fix:** Take `FOR UPDATE` lock on the session row at the top of `applyLateSnapshots()`; OR re-check `submitted_at` inside each iteration.

### N3. [SEVERITY: MEDIUM] AUTO_SUBMITTING latch is client-only
- **Track:** Backend
- **Where:** `test-sessions.service.ts:583-610` — `recordViolation` reports `will_auto_submit: count >= 3` but the server never actually submits. If the client kills the browser between 3rd violation and `POST /submit`, the session stays ACTIVE forever.
- **Suggested fix:** Two options — (a) Auto-submit synchronously inside `recordViolation` when threshold crossed, with `auto_submit_source = VIOLATION_THRESHOLD`; or (b) rely on the server-side cron auto-submit-on-expiry path (architecture §8) and accept the latency. (a) is the safer pilot pick.

### N4. [SEVERITY: MEDIUM] Importer reads `DATABASE_URL` not `MIGRATION_DATABASE_URL`
- **Track:** Backend
- **Where:** `backend/scripts/import-yaml.ts:455-459`.
- **Why it matters:** Importer inserts into `problem_reviews`, which fires the consensus trigger that UPDATEs `problems.{authored_difficulty, jee_authenticity_score}`. The architecture revokes `app_user`'s UPDATE on those columns. The trigger function runs as `trigger_owner` (SECURITY DEFINER) so it has UPDATE — meaning the importer trick works today even via `app_user_login`. But it's a brittle dependency: if the SECURITY DEFINER setup is ever changed, the importer silently breaks. The importer is a privileged authoring tool and should use `MIGRATION_DATABASE_URL`.
- **Suggested fix:** Change the conn-string read; document in script header.

### N5. [SEVERITY: MEDIUM] Mac DevTools combo `Cmd+Opt+I` not detected
- **Track:** Frontend
- **Where:** `anti-cheat.ts:24-29` — only `(ctrl|meta)+shift+i`. Safari's canonical DevTools shortcut is `Cmd+Opt+I` (altKey, not shiftKey).
- **Suggested fix:** Add `(e) => (e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'i'`. Same for `Cmd+Opt+C` (Inspect Element).

### N6. [SEVERITY: MEDIUM] No "unmark for review" UX
- **Track:** Frontend
- **Where:** `RuntimeProvider.tsx` (grep `marked_for_review: false` → 0 hits).
- **Why it matters:** PRD-16 §5.3 implies the student can toggle. Once marked, the only way out is "answer and unmark"-equivalent via the Save & Next path — which doesn't clear the flag either.
- **Suggested fix:** Add an `onUnmark` action mirroring `onMarkAndNext`.

### N7. [SEVERITY: MEDIUM] Snapshot PATCH has no rate-cap on `action_seq` jumps
- **Track:** Backend
- **Where:** `test-sessions.service.ts:399-423` — the UPSERT trusts client-supplied `action_seq` and `visit_count` (with GREATEST monotonicity) and `answer_payload`. A student can edit IndexedDB and forge a snapshot before submit. Frontend audit flagged this as CRITICAL; I downgrade to MEDIUM because (a) `hints_used` is server-authoritative (overwritten only by the hint endpoint at `:485-498`, NOT by snapshot PATCH), (b) `question_code` is server-resolved from `frozen_question_codes`, (c) the correctness check at submit re-runs `byteEqualNormalized` server-side. The realistic exploit is "submit a different answer than what the UI shows" — equivalent to the legitimate "Save & Next with different answer". But forged `visit_count`/`time_seconds_delta` corrupt analytics and forged `action_seq` (e.g. 2^31-1) breaks future legitimate increments.
- **Suggested fix:** Cap `action_seq` increment per-request to ≤ 100 above stored value; cap `visit_count` increment per-request to ≤ 1.

### N8. [SEVERITY: MEDIUM] `option_count: 4` literal-typed lock; LETTERS hardcoded
- **Track:** Frontend
- **Where:** `runtime-types.ts:60` (`option_count: 4`), `MCQSingleChoice.tsx:10`, `MCQMultiChoice.tsx:10` (`['A','B','C','D'] as const`).
- **Why it matters:** Architecture and PRD don't actually pin to 4. Future MAT-COL or PASSAGE problems may want different counts.
- **Suggested fix:** Change to `option_count: number`; derive `LETTERS` from `option_count`.

### N9. [SEVERITY: MEDIUM] No bundle-size CI gate
- **Track:** Frontend
- **Where:** `frontend/package.json` (no `bundlewatch`/`size-limit`/`next-bundle-analyzer` script).
- **Why it matters:** PRD-16 §5.1 says runtime route ≤ 200 KB gz. There is no programmatic check; future changes can blow the budget unnoticed.
- **Suggested fix:** Add `size-limit` with a 200 KB cap on the `/test/[sessionId]` route bundle; wire to CI.

### N10. [SEVERITY: LOW] schema.prisma datasource missing `url = env("DATABASE_URL")`
- **Track:** Migrations
- **Where:** `backend/prisma/schema.prisma:33-35`.
- **Suggested fix:** Add `url = env("DATABASE_URL")` (Prisma may infer at runtime but explicit is conventional).

### N11. [SEVERITY: LOW] `0002/down.sql` hardcodes `OWNER TO postgres`
- **Track:** Migrations
- **Where:** `backend/prisma/migrations/0002_roles_and_extensions/down.sql:30-34`.
- **Why it matters:** Neon's bootstrap superuser is `neon_superuser`, not `postgres`. Engineer self-flagged. Cosmetic in dev, fails in cloud rollback.
- **Suggested fix:** Use `current_user` or a parameterized owner.

### N12. [SEVERITY: LOW] pgcrypto extension created but never used in SQL/triggers
- **Track:** Migrations
- **Where:** `0002_roles_and_extensions/migration.sql:9`. Engineer self-flagged.
- **Suggested fix:** Either drop the extension creation (app code uses `crypto.randomBytes` not `gen_random_bytes`), or document its intended future use.

### N13. [SEVERITY: LOW] Hint endpoint `setTimeout` pad has ±5–15 ms drift; no upper-bound cap
- **Track:** Backend
- **Where:** `test-sessions.service.ts:1167-1173`. If elapsed > 250 ms (cold DB), no padding fires → leaks signal.
- **Suggested fix:** Add jitter (`targetMs + crypto.randomInt(0, 50)`) and raise floor to 500 ms.

### N14. [SEVERITY: LOW] Auth: dummy bcrypt hash on email-not-found path is malformed
- **Track:** Backend
- **Where:** `auth-session.service.ts:76` — `"$2b$12$abcdefghijklmnopqrstuv"` is 22 chars, not a real 60-char bcrypt hash. `bcrypt.compare` short-circuits an error, defeating timing equalisation.
- **Suggested fix:** Use a real bcrypt hash of a throwaway string (precomputed at module init).

### N15. [SEVERITY: LOW] Auth: email logged on login failure
- **Track:** Backend
- **Where:** `auth.controller.ts:57`. Mild PII leak to log aggregator.
- **Suggested fix:** Log a SHA-256 hash of the email, or just `email_hash=...`.

### N16. [SEVERITY: LOW] No global `setGlobalPrefix('api')`; each controller hard-codes `api/...`
- **Track:** Backend
- **Where:** `main.ts` (no call); controllers (e.g. `auth.controller.ts:22`).
- **Suggested fix:** Add `app.setGlobalPrefix('api')`; remove the prefix from each controller decorator.

### N17. [SEVERITY: LOW] No global ExceptionFilter
- **Track:** Backend
- **Where:** `main.ts`.
- **Why it matters:** Unhandled Postgres errors (other than the 23514/23503 patterns Problems handles) become 500s with stack traces in response.
- **Suggested fix:** Add a NestJS `ExceptionFilter` that projects unknown errors to `{ error: 'internal', request_id }` and logs the stack server-side only.

### N18. [SEVERITY: LOW] Importer doesn't validate `wrong_paths[].diagnostic_tag` inner shape
- **Track:** Backend
- **Where:** `import-yaml.ts:277-278`.
- **Suggested fix:** Add per-axis validation matching the 5 ERR-* enum slots.

### N19. [SEVERITY: LOW] First-slot landing not counted as visit_count++
- **Track:** Frontend
- **Where:** `RuntimeProvider.tsx:137`.
- **Suggested fix:** Initialize the first-slot snapshot with `visit_count: 1`.

### N20. [SEVERITY: LOW] session-fetch has no 5xx retry or timeout
- **Track:** Frontend
- **Where:** `session-fetch.ts:22-31, 67-77, 83-95`.
- **Suggested fix:** Add a 10 s `AbortController` timeout and 1 retry on 5xx.

### N21. [SEVERITY: LOW] `raw_db_message` leaked in 422 cross-walk body
- **Track:** Backend
- **Where:** `problems.service.ts:111` — exposes Postgres trigger / column internals to teacher-role caller.
- **Suggested fix:** Drop the field from the response body; log it server-side.

### N22. [SEVERITY: LOW] 0011 down.sql has redundant `DROP INDEX` before `DROP TABLE`
- **Track:** Migrations
- **Where:** `0011_test_sessions/down.sql:1-5`. Harmless.

### N23. [SEVERITY: LOW] 0013 misnamed (`calibration_mismatch_columns` but creates aux tables)
- **Track:** Migrations
- **Where:** `0013_calibration_mismatch_columns/`. Cosmetic.

### N24. [SEVERITY: LOW] `ERR-STRAT-NONE` sentinel vs. taxonomy YAMLs
- **Track:** Migrations
- **Where:** `0006/migration.sql:74` (and 4 sibling axes).
- **Why it matters:** Truncation `STRAT` vs `STRATEGY` — must match taxonomy YAMLs character-for-character or the WHERE filter never excludes the NONE sentinel.
- **Suggested fix:** `grep -r ERR-STRAT /Users/ms/Documents/jee_platform/content/taxonomy/` to verify.

### N25. [SEVERITY: LOW] No E2E tests on the runtime
- **Track:** Frontend
- Engineer self-flagged.
- Defer to Stage 4 Testing.

---

## What's Good (positive reinforcement — specific things v1 nailed)

1. **Role separation is structural, not paper.** Migration 0002 creates `migration_role` (BYPASSRLS), `app_user` (no DDL, no UPDATE/DELETE on attempts/audit), `trigger_owner` (owns SECURITY DEFINER functions only). REVOKEs in `0012:64-65` mean `app_user_login` literally cannot UPDATE/DELETE attempts via SQL — PROJECT CONTEXT Rule 3 is now a database-enforced invariant. This is exactly what the Architect specified and the engineer delivered it.

2. **SECURITY DEFINER hygiene is correct in both triggers.** Both `fn_recompute_diagnostic_summary` (0006) and `fn_recompute_problem_consensus` (0007) set `SECURITY DEFINER`, pin `SET search_path = pg_catalog, public` (the canonical CVE-class defence), transfer OWNER to `trigger_owner`, and `REVOKE ALL FROM PUBLIC`. The consensus trigger additionally takes `pg_advisory_xact_lock(hashtext(qcode))` (caught by Critic v2) and uses `RAISE EXCEPTION 'cross_walk_violation: …' USING ERRCODE = '23514'` for structured error projection. Textbook execution.

3. **hmac-token.ts is well thought through.** Pepper read fresh per-call (not cached), `crypto.timingSafeEqual` with length-equality guard, payload structure binds slot+figure+per-session secret, pepper-missing on verify fails closed (returns `false`) not throws, and the lazy issuance pattern in `getSession` correctly handles secret rotation via the `usablePreviousSecret` grace.

4. **Telemetry queue persistence + replay order is correct.** `idb-keyval` write per mutation, hydrate on reload restores monotonic `localCounter`, `tryDrainOnce` shifts from head (action_seq ascending), `collapseSnapshots` deduplicates contiguous patches to the same slot. Offline → online resumes cleanly. State-machine one-way latch (ACTIVE → AUTO_SUBMITTING → SUBMITTED) prevents double-fire when timer and 3rd violation coincide.

5. **No SQL injection anywhere in the surface I read.** Dashboard UNION-DEDUPE, snapshot UPSERT, hint UPSERT, submit transaction, auth lookup — every `$queryRawUnsafe` uses positional `$1`/`$2`/... placeholders. `studentId` always sourced from `req.auth.studentId` populated by AuthGuard, never from a query param. `frozen_question_codes` is server-trusted at session-create.

6. **Append-only is structurally honored.** Grep over the whole `test-sessions.service.ts` shows zero `UPDATE attempts` statements; the submit path only INSERTs. The schema's `test_session_snapshots` is the transient mutable state; `attempts` is final.

7. **Migration reversibility.** Every 0002–0013 migration ships a hand-written `down.sql` that reverses the up. The complex ones (0006, 0007, 0011, 0012) drop triggers/functions/indexes before tables; re-grant the REVOKEs; restore default privileges. Only `ALTER TYPE ADD VALUE` in 0003 is irreversible (documented; matches Postgres ≥ 12 reality).

8. **Frontend design tokens + theme switching landed cleanly.** `globals.css:14-78` defines tokens; `[data-palette="calm" | "exam_muscle_memory"]` swaps the palette per `target_exam`; Inter Variable via `next/font/google` with `display: 'swap'` matches design-lock #2.

9. **Anti-cheat detector covers all 9 `ViolationType` values.** TAB_SWITCH, WINDOW_BLUR, FULLSCREEN_EXIT, RIGHT_CLICK, COPY_ATTEMPT, CUT_ATTEMPT, PASTE_ATTEMPT, DEVTOOLS_KEYSTROKE, COPY_KEY_SHORTCUT — every enum slot has a listener. The `numericInputSelector` exemption is sensibly chosen.

10. **Server-side gating at the results endpoint is correct.** `test-sessions.service.ts:877` throws when `submitted_at IS NULL`. The frontend audit's HIGH on `results/page.tsx` was overstated — the server gate is in place. (Defense-in-depth client check is still nice-to-have; logged as a non-blocker.)

---

## Per-track verdict

- **Track 1 (Migrations): advance.** 8/10. The two operational paper-cuts (`OWNER TO postgres`, unused pgcrypto) are non-blocking. The locked architecture is implemented faithfully.

- **Track 2 (Backend): loop back to Engineer-Backend v2** — narrow scope, ≤ 0.5 day of work. Brief:
  - Fix B1: per-route 10/min/IP throttle on `POST /api/auth/session`.
  - Fix B5: include `existing_reviews` array in 422 body for `POST /api/problems/:qcode/reviews`; drop `raw_db_message`.
  - Address N2 (late-snapshots TOCTOU — add `FOR UPDATE` at top of `applyLateSnapshots`).
  - Address N7 (snapshot PATCH `action_seq` / `visit_count` rate caps).
  - Address N1 (submit attempt_order N+1 + race — replace with one window-function query + advisory lock).
  - Address N3 (3rd-violation should auto-submit server-side OR document the reliance on cron).
  - Address N4 (importer uses `MIGRATION_DATABASE_URL`).
  - Address N14 (real bcrypt dummy hash) and N16 (`setGlobalPrefix('api')`).

- **Track 3 (Frontend): loop back to Engineer-Frontend v2** — narrow scope, ≤ 0.5 day of work. Brief:
  - Fix B2: wire `NETWORK_FAILURE_FALLBACK` autosubmit from telemetry-queue after N consecutive backoff failures via `autoSubmitRef`.
  - Fix B3: add 30-second HEARTBEAT poll that re-anchors `serverClockOffsetRef`; pause when `document.hidden`.
  - Fix B4: in `katex-render.ts:19`, wrap non-math substrings with the existing `escapeHtml` helper.
  - Address N5 (Mac `Cmd+Opt+I` in `anti-cheat.ts`).
  - Address N6 ("unmark for review" UX).
  - Address N8 (`option_count: number` instead of literal 4).
  - Address N9 (add `size-limit` CI gate at 200 KB).
  - Address N19 (initial slot visit_count++).
  - Address N20 (session-fetch timeout + 5xx retry).

---

## Composite verdict

**Loop back to Engineer v2 (Backend + Frontend).** Migrations advances unconditionally.

Composite score 7/10 means we sit on the gate line. Per the constitution's binding rule, any HIGH security/correctness issue caps the score below 7 — and I have five HIGH issues open (B1–B5). Two HIGH issues are correctness/architecture-compliance (B2 missing telemetry path; B5 missing 422 field); three are security (B1 brute-force, B3 drift, B4 XSS). None are CRITICAL; all are fixable in v2 without major rework.

Iteration 1 of 3. v2 fixes should converge cleanly because the architecture is right and the engineering hygiene is high — these are gaps, not design flaws.

---

## Open user-only questions (if any) blocking advance

None. Every blocker has a concrete code-level fix the Engineer can implement without further user decisions. The architecture's locks (4-value AutoSubmitSource, append-only attempts, role separation, 5-minute secret grace, post-submit gating) are correctly translated by the engineers; what's left is execution polish, not requirements ambiguity.
