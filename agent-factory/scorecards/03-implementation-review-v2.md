# Stage 3 (Implementation Loop) — Code Review v2

**Reviewer:** Code Reviewer (discriminator)
**Iteration:** 2 of 3
**Inputs:** Engineer-Migrations v1 (carried over; unchanged), Engineer-Backend v2, Engineer-Frontend v2
**Architecture under review:** `scorecards/02-architecture-final.md` (locked)
**Method:** delta-track against `scorecards/03-implementation-review-v1.md` blocker-by-blocker and medium-by-medium; full read of every v2-modified file with v2 markers (`[UPDATED v2 — …]`); cross-checked the new tx flow in `runSubmitInTransaction` for serialization correctness; specifically scrutinised DOMPurify allow-list, 401-on-heartbeat handling, 401-on-fallback-submit handling, and the violation-tx rollback semantics that the orchestrator brief flagged.

---

## Composite Score: 8/10 (v1: 7 → v2: 8)

## Per-Track Scores (v1 → v2)
- Migrations: 8 → 8 (unchanged; advance-ready, no edits made)
- Backend: 7 → **8** (B1, B5 closed; M1, M2, M4, M5, M6 closed; N7/N16/N17 still open as MEDIUM/LOW; one NEW issue around violation-tx rollback)
- Frontend: 6 → **7** (B2, B3, B4 closed; M7..M11 closed; one NEW HIGH on 401-loop-trap in the heartbeat → fallback-submit path; one NEW MEDIUM around DOMPurify config; N20 still open)

---

## Iteration Delta — Full

### v1 blocker status (final)

- **B1 — Login throttle 10/min/IP: FIXED.** `auth.controller.ts:43` decorates `login()` with `@Throttle({ default: { limit: 10, ttl: 60_000 } })`; unit test `auth.controller.spec.ts:100-107` asserts the metadata on the prototype handler so a future refactor that drops the decorator surfaces in CI. NestJS Throttler picks the most restrictive applicable @Throttle which binds the 10-call cap below the global 600-call bucket as required by architecture §5.5.

- **B2 — `NETWORK_FAILURE_FALLBACK` autosubmit path emitted: FIXED.** `RuntimeProvider.tsx:603-609` `handleTimerExpiry` branches on `lastSuccessfulHeartbeatRef` silence > 30 s OR `consecutiveSyncFailuresRef ≥ 3` → fires `NETWORK_FAILURE_FALLBACK` instead of `TIMER_EXPIRY`. Telemetry queue's `onSyncSuccess` / `onSyncFailure` callbacks (`telemetry-queue.ts:288, 299`) keep these refs accurate; the heartbeat tick (`RuntimeProvider.tsx:266`) also updates them. The autoSubmitRef bridge wires the fallback through to the SubmitDto. (But see NEW-1 below for what this path does on 401.)

- **B3 — HEARTBEAT poll re-anchors `serverClockOffsetRef`: FIXED.** `RuntimeProvider.tsx:248-294` polls `GET /api/test-sessions/:id` every 60 s (60 s instead of 30 s per architecture §5.3 endpoint 5 — engineer documented the choice as a pilot-scale load consideration; acceptable but call-out in non-blockers), reassigns `serverClockOffsetRef.current = new Date(server_now).getTime() - Date.now()` on success, pauses on `document.hidden`, re-runs on `visibilitychange`. One immediate `tick()` before the interval ensures degraded networks are detected before the first 60-s window elapses.

- **B4 — Statement HTML escaped between math segments: FIXED.** `katex-render.ts:25-91` splits on `SEGMENT_RE`, runs `DOMPurify.sanitize(fragment, PURIFY_CONFIG)` on every non-math fragment, then concatenates with the KaTeX-rendered math fragments. `PURIFY_CONFIG` allow-list is narrow: `['b','i','em','strong','u','sub','sup','br','span']` tags + `['class']` attr. No `href`, `src`, `style`, `onerror`. Test coverage at `katex-render.test.ts:31-82` exercises `<script>`, `<img onerror>`, `<iframe>`, `javascript:` URLs and asserts all three paths produce sanitized output while preserving allowed inline formatting + KaTeX rendering. (See NEW-2 for one configuration paper-cut.)

- **B5 — 422 body carries `existing_reviews`: FIXED.** `problems.service.ts:122-144` 422 path now returns `{ error_code, message, band_bounds, your_pair, existing_reviews, retry_guidance }` exactly matching architecture §5.4 endpoint 14. `loadExistingReviews` (`:174-200`) re-reads the committed reviews after the failed-INSERT rollback. `parseBandBounds` (`:209-218`) parses the trigger's structured `band=[lo,hi]` message; falls back to `null` when the format is unrecognized. `raw_db_message` is no longer in the response body — logged server-side only (`:124`). N21 is closed by the same change. Test coverage `problems.service.spec.ts:54-118` asserts the full body shape AND asserts `raw_db_message` is absent.

### v1 medium / non-blocking status (final)

- **M1 (= v1 N1) — Submit attempt_order N+1 + race: FIXED.** `runSubmitInTransaction` (`test-sessions.service.ts:701-952`) now (a) acquires `FOR UPDATE` on the test_sessions row first (`:711-714`), (b) does ONE `SELECT question_code, COUNT(*) GROUP BY question_code` for prior counts (`:813-826`), (c) does ONE `SELECT ... FROM student_fingerprint_state WHERE (tup) IN (unnest...)` for round_at_time (`:838-867`). Per-code in-batch seq map handles duplicates. The FOR UPDATE row lock serializes concurrent submits of the same session — second one observes `submitted_at != NULL` and short-circuits to the idempotent path (`:724-734`). Test `test-sessions.service.spec.ts:266-329` asserts the batched lookup invariant.

- **M2 (= v1 N2) — late-snapshots TOCTOU: FIXED.** `lateSnapshots` (`:971-1027`) now gates each write with a CTE: `WITH live AS (SELECT id FROM test_sessions WHERE id=$1 AND submitted_at IS NULL AND (expires_at IS NULL OR expires_at > now()))` so the INSERT only fires if the session is still live AT INSERT TIME. The audit row still writes unconditionally for forensic completeness. `recorded_count` vs `scored_count` lets the caller see how many rows were dropped because the session committed concurrently. Test `test-sessions.service.spec.ts:48-138` covers both the live-write and the gated-no-write path.

- **M3 — Snapshot PATCH per-route throttle 60/min/IP: FIXED.** `test-sessions.controller.ts:84` decorates `patchSnapshot` with `@Throttle({ default: { limit: 60, ttl: 60_000 } })`. Unit test `test-sessions.controller.spec.ts:211` asserts the metadata. Sensible cap — runtime emits a snapshot every ~5 s, so a well-behaved client stays under.

- **M4 (= v1 N3) — Server-side auto-submit on 3rd violation: FIXED.** `logViolation` (`test-sessions.service.ts:598-660`) now wraps the violation INSERT + counter UPDATE + (if threshold crossed) `runSubmitInTransaction(VIOLATION_THRESHOLD)` in ONE `prisma.$transaction`. Client no longer has to round-trip on the 3rd violation; cron auto-submit-on-expiry is no longer the only fallback. (See NEW-3 for the rollback-coupling concern.)

- **M5 (= v1 N4) — Importer uses `MIGRATION_DATABASE_URL`: FIXED.** `import-yaml.ts:455-489` reads `MIGRATION_DATABASE_URL` first; falls back to `DATABASE_URL` only if `IMPORTER_ALLOW_RUNTIME_URL=1` is explicitly set (with a warning); errors out with a clear instruction otherwise. Documented inline.

- **M6 (= v1 N14) — Real bcrypt dummy hash on email-not-found: FIXED.** `auth-session.service.ts:43` `DUMMY_BCRYPT_HASH = bcrypt.hashSync("$dummy-timing-equaliser$", 12)` computed once at module init. Boot cost: ~150 ms (one-time). Login `:91` calls `bcrypt.compare(password, DUMMY_BCRYPT_HASH)` on the unknown-email branch, so wall-clock for unknown-vs-wrong-password is now indistinguishable.

- **M7 (= v1 N5) — Mac Cmd+Opt DevTools combos: FIXED.** `anti-cheat.ts:35-37` adds three Cmd/Ctrl+Opt key matchers (`I`, `J`, `C`) alongside the existing Ctrl+Shift+I/J and F12/Ctrl+U combos. Tests `anti-cheat.test.ts:65-80` cover all three Mac combos plus the negative cases (`Cmd+C` alone does NOT fire; plain `i` does NOT fire).

- **M8 (= v1 N6) — Unmark-for-review UX: FIXED.** `RuntimeProvider.tsx:442-447` `onToggleMarkForReview` flips the flag without advance. Button label flips between "Mark for Review" ↔ "Unmark Review" at `:834`. `Palette.tsx:54-122` accepts an `onToggleMark` callback; shift-click toggles per-slot, plain click jumps. Palette aria-label hints at the affordance. The `Tip:` line at `:117-119` discloses the shift-click affordance once.

- **M9 (= v1 N8) — `option_count: number` (not literal 4): FIXED.** `runtime-types.ts:58-85`: `option_count` is now `number`; `isValidOptionCount` guards `3..5`; `lettersForOptionCount(n)` derives the letter sequence. `MCQSingleChoice.tsx:21-32` and `MCQMultiChoice.tsx:18-29` render an error block on invalid option_count (matches PRD US-3 "unrecognised → hard error block") and use `lettersForOptionCount` for the displayed letters.

- **M10 (= v1 N9) — Bundle-size CI gate: FIXED.** `scripts/bundle-check.mjs` reads the per-route `build-manifest.json`, gzips each chunk, sums, fails CI on overrun of `BUNDLE_MAX_KB` (default 200 KB). `package.json` declares the script. Zero runtime deps. (Cannot evaluate gate value at review time without `npm run build` artifacts; logic is correct.)

- **M11 (= v1 N19) — First-slot landing visit_count semantics aligned with backend: FIXED.** `RuntimeProvider.tsx:174-177, 374-383` — first slot is NOT auto-counted at mount; visit_count is incremented on first user interaction OR first PATCH (whichever lands first). Comment explains the convergence with backend expectations. Avoids the v1 double-increment at slot 0.

### v1 LOW status (carry-over)

- **N15 — Email hash on failed-login log: FIXED.** `auth.controller.ts:66-71` logs `SHA-256` prefix of email (12 chars), not the raw email.
- **N16 — `setGlobalPrefix('api')`: NOT FIXED.** `main.ts` still doesn't set it; controllers continue to hardcode `api/...`. Cosmetic; carry to Stage 4 cleanup.
- **N17 — Global ExceptionFilter: NOT FIXED.** Still no top-level filter; un-handled errors continue to surface as 500s with stack via the Nest default. Carry to Stage 4.
- **N18 — Importer wrong_paths inner-shape validation: NOT FIXED.** Schema-level validation still loose. Carry to Stage 4.
- **N20 — session-fetch timeout + retry: NOT FIXED.** `session-fetch.ts:18-99` still has no `AbortController` timeout and no 5xx retry. Carry to Stage 4.
- **N7 — Snapshot PATCH `action_seq` / `visit_count` rate caps: NOT FIXED in service body** (the M3 throttle at the controller layer mitigates DoS but does NOT cap the per-request `action_seq` jump that an IndexedDB-editing student could forge). The N+1 risk is small (analytics corruption, not security), but it's an open MEDIUM. Carry to Stage 4 or to the next loop. See "Non-Blocking Issues" below.
- **N10, N11, N12, N13, N22, N23, N24** (LOW migration / hint-padding cosmetics) — unchanged, carry to Stage 4.

---

## NEW Issues Introduced in v2

### NEW-1 [HIGH] Heartbeat 401 + NETWORK_FAILURE_FALLBACK submit 401 = silent data loss
- **Track:** Frontend.
- **Where:** `RuntimeProvider.tsx:248-294` heartbeat tick + `:521-553` `autoSubmit('NETWORK_FAILURE_FALLBACK')` catch-error branch.
- **What:** The heartbeat throws on any non-200 response (`if (!res.ok) throw new Error(...)`). A 401 (server-side session invalidated — admin revoke, cookie expired past TTL, role flip) increments `consecutiveSyncFailuresRef` indefinitely. After 3 failures, `setNetworkDegraded(true)` shows "Offline — answers saved locally". When the timer fires, `handleTimerExpiry` (`:603-609`) sees `silenceMs > 30_000` and chooses `NETWORK_FAILURE_FALLBACK`. The submit POST also returns 401; the `if (!res.ok && res.status !== 409)` branch at `:521-535` triggers the `localFallbackPosted = true` path because `source === 'NETWORK_FAILURE_FALLBACK'`. The student sees "Submitted locally; will sync when you reconnect." but **the queue can never sync** — the session cookie is the problem, not the network. There is no exposed UX path to re-authenticate.
- **Same defect in `telemetry-queue.ts:346-365`** — `postSnapshot`/`postViolation` throw on any non-2xx, so a 401 cycles through the backoff schedule forever; `onSyncFailure` reports `attempts` monotonically increasing, never recovers.
- **Why it matters:** Architecture §10.4 A07 requires authentication failure to halt the runtime gracefully, not pretend success. PRD-16 US-7 E1 specifies `NETWORK_FAILURE_FALLBACK` for network failures, NOT for auth failures. Conflating the two means a revoked session looks "submitted" to the student and to the parent banner; no attempts are ever recorded; the cron sweep will eventually expire it but mis-attribute it (TIMER_EXPIRY, not VIOLATION/MANUAL).
- **Fix:** In the heartbeat tick: special-case `res.status === 401` — STOP the interval, set `setSubmitState('IDLE')`, route to `/login?return=…`. In `telemetry-queue.ts` `dispatch`: catch the 401 inside `postSnapshot`/`postViolation`, surface via a new `onSyncAuthError` callback that the RuntimeProvider handles by terminating the queue + redirecting to login. In `autoSubmit`: when the submit POST returns 401, NEVER set `localFallbackPosted = true` — always go to the auth-failure UX path.

### NEW-2 [MEDIUM] DOMPurify config does not pin USE_PROFILES/SAFE_FOR_TEMPLATES; relies on defaults
- **Track:** Frontend.
- **Where:** `katex-render.ts:29-36` `PURIFY_CONFIG`.
- **What:** The allow-list is correctly narrow (no `href`, no `src`, no `style`, no event handlers). DOMPurify's defaults block `data:` URLs in `href`/`src`, BUT because `ALLOWED_TAGS` excludes `<a>` and `<img>` (no link / image tags allowed at all), `data:` URLs cannot enter the output regardless of `ALLOWED_URI_REGEXP`. Net XSS posture: **safe today**. However the config does not set `SAFE_FOR_TEMPLATES: false`, `KEEP_CONTENT: true` is set but `WHOLE_DOCUMENT: false` is implicit (the default), and there is no `USE_PROFILES: { html: true }` lock. A future change that adds `<a>` to `ALLOWED_TAGS` without also adding `ALLOWED_URI_REGEXP` would silently re-introduce `data:` and `vbscript:` URL surface.
- **Fix:** Add explicit `ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel):)/` so a future tag-allow-list expansion fails closed on scheme.

### NEW-3 [MEDIUM] Violation-tx auto-submit failure rolls back the violation log too
- **Track:** Backend.
- **Where:** `test-sessions.service.ts:620-659` `prisma.$transaction(async (tx) => { …UPDATE violations_count…; await runSubmitInTransaction(…); … })`.
- **What:** Per orchestrator brief explicitly: "what if the in-tx submit fails (rollback the violation log too)?" — yes, that is exactly what happens. If `runSubmitInTransaction` throws inside the violation transaction (deadlock, problem not found mid-tx, INSERT into attempts fails CHECK, ENUM cast fails on `dto.auto_submit_source` — though the synthetic dto pins it to `VIOLATION_THRESHOLD` so the cast is safe, the deadlock case is the realistic one), Prisma rolls back the entire tx including the violation counter UPDATE and the audit row INSERT. The client gets a 500, the violation evaporates, and the student gets a free retry on the violation budget. The architecture treats violations as append-only (`test_session_audit` REVOKEd UPDATE/DELETE) for exactly this reason — the audit needs to be durable independent of downstream effects.
- **Why it matters:** Anti-cheat events should be the most durable rows in the system. Treating them as best-effort coupled to the submit outcome inverts that.
- **Fix:** Split into two transactions. Outer tx: violation UPDATE + audit INSERT, committed first. Inner tx (separate `prisma.$transaction` call): the auto-submit drain. If the inner tx throws, the outer tx is already committed — the client gets a 500, but the violation is durable; cron + retry can pick up the auto-submit. Document the trade-off (one extra round-trip per 3rd violation).

### NEW-4 [LOW] HEARTBEAT cadence is 60 s, architecture §5.3 says 30 s
- **Track:** Frontend.
- **Where:** `RuntimeProvider.tsx:40` `HEARTBEAT_INTERVAL_MS = 60_000`.
- **What:** Architecture pinned 30 s; engineer chose 60 s "to keep server load down at pilot scale" but the `NETWORK_FAILURE_WINDOW_MS` is still 30 s. So in the worst case — clean heartbeat fires at t=0, network dies at t=1, next tick is t=60 — the user spends ~30 s in degraded-but-undetected state (silenceMs reaches 30s at t=30, but no tick runs to actually detect it until t=60). The drift correction during that window is also 30 s stale.
- **Fix:** Either reduce to 30 s per architecture, OR raise `NETWORK_FAILURE_WINDOW_MS` to 90 s (≥ 1.5 × HEARTBEAT_INTERVAL). Easy call, but pick one.

### NEW-5 [LOW] `loadExistingReviews` ORDER BY uses Date column that may be null
- **Track:** Backend.
- **Where:** `problems.service.ts:184-200`.
- **What:** `ORDER BY reviewed_at ASC` — `reviewed_at` is the INSERT row's `now()`, never null, so this is fine in practice. Cosmetic.

### NEW-6 [LOW] `bcrypt.hashSync(..., 12)` at module init blocks event loop ~150 ms on boot
- **Track:** Backend.
- **Where:** `auth-session.service.ts:43`.
- **What:** One-time cost; acceptable. Could be `bcrypt.hash(...)` lazily on first login. Not worth a code change.

---

## Blocking Issues (still open after v2)

1. **[HIGH] NEW-1: 401-loop trap in heartbeat → NETWORK_FAILURE_FALLBACK submit.** Silent data loss on a revoked-or-expired session; "Submitted locally" lie.
   - Fix: special-case 401 across heartbeat tick, telemetry queue dispatch, and the autoSubmit fallback catch. Wire to a re-auth UX path.
   - Estimated work: < 0.5 day.

## Non-Blocking Issues (Stage 4 / future loops)

1. **[MEDIUM] NEW-2** DOMPurify config should pin `ALLOWED_URI_REGEXP` defensively.
2. **[MEDIUM] NEW-3** Violation-tx coupling rolls back violation when submit fails — split into two transactions so the audit row is durable.
3. **[MEDIUM] N7 carry** — application-level cap on per-request `action_seq` jump and `visit_count` jump in `patchSnapshot` UPSERT. Mitigated but not closed by the new 60/min throttle.
4. **[LOW] NEW-4** Heartbeat cadence mismatch with architecture (60 s vs 30 s).
5. **[LOW] N16 carry** Add `app.setGlobalPrefix('api')`.
6. **[LOW] N17 carry** Add a NestJS `ExceptionFilter` to project unknown errors to `{ error: 'internal', request_id }`.
7. **[LOW] N18 carry** Importer should validate `wrong_paths[].diagnostic_tag` shape against the 5 ERR-* axes.
8. **[LOW] N20 carry** `session-fetch.ts` lacks `AbortController` timeout + 5xx retry.
9. **[LOW] N10, N11, N12, N13, N22, N23, N24** carry — migration cosmetics, hint pad jitter.
10. **[LOW] NEW-5, NEW-6** — cosmetic.

---

## What's Good (v2 specific)

1. **Every v1 blocker has a code-level fix with test coverage**, not a verbal promise. `auth.controller.spec.ts:100-107` asserts the throttle metadata; `problems.service.spec.ts:54-118` asserts the 422 body shape including `raw_db_message` absence; `test-sessions.service.spec.ts:48-138, 141-260, 265-329` cover M1, M2, M4; `katex-render.test.ts:31-82` covers four XSS vectors; `anti-cheat.test.ts:65-80` covers the Mac combos. v1 had thin tests; v2 added the test layer that the architecture told the engineers to build.

2. **`runSubmitInTransaction` factoring is exactly right.** Extracting the inner pipeline so `submit` (endpoint 11) and `logViolation` (endpoint 10, threshold-crossed) both call it under one tx is the boring-correct pattern. FOR UPDATE row lock at the top serializes; idempotent return short-circuits on `submitted_at != NULL`. Batched `attempt_order` and `round_at_time` lookups collapse N+1 calls into 2 calls. This is staff-level engineering.

3. **DOMPurify allow-list is narrow on purpose.** No `<a>`, no `<img>`, no `href`, no `src`, no `style`. Future authors who want clickable links or inline images have to consciously expand the list and (if NEW-2 is taken) bring the URI regexp with them. The "fail closed by absence" pattern is right.

4. **B5's `parseBandBounds` is defensive.** Regex fail returns `null`, the API surfaces `band_bounds: null` and `retry_guidance` still tells the user what to do. A future trigger format change degrades gracefully instead of crashing the 422 projection.

5. **`bundle-check.mjs` is zero-dependency.** Reads the per-route manifest, gzips chunks via Node stdlib, sums. CI image stays small, gate behavior is deterministic. No more "the bundle blew the budget last Tuesday and nobody noticed."

6. **M2's CTE-gated INSERT.** `WITH live AS (...) INSERT ... SELECT ... FROM live ON CONFLICT ...` is the right SQL idiom — gate evaluated atomically with the write, no separate read-then-write race. The audit-row-always-writes split keeps forensic completeness.

7. **Backend test fixtures replay the right tx sequence.** The `$transaction.mockImplementation` in `test-sessions.service.spec.ts:166-199` and `:236-244` builds a fake `tx` that walks through the actual SQL call ordering — including the "first SELECT outside the tx is the load-session, the inner sequence is the violation-and-submit steps." This is the discipline that keeps the test suite honest as the service evolves.

---

## Composite Verdict

**Loop back to Engineer-Frontend v3 (narrow scope: NEW-1 only).** Backend and Migrations advance.

Reasoning: Composite 8/10 reflects substantial v1-blocker convergence (5/5 closed) and broad medium closure (11/11 closed for the in-scope items in the v1-review-engineer-brief). Test coverage went from "engineer self-flagged absence" to "asserts the contract." But NEW-1 is a HIGH security/correctness blocker that surfaces only at v2 because the new heartbeat + NETWORK_FAILURE_FALLBACK pieces interact with the existing 401-not-special-cased fetch code in a way v1 didn't expose (v1 had no fallback path at all). Per the constitution's binding rule, any open HIGH is a no-advance signal.

Estimated remaining work to converge: < 0.5 day on Frontend (special-case 401 in 3 places, add `onSyncAuthError` callback, route to login on auth failure). Backend can advance as-is to Stage 4 — NEW-3 (violation-tx coupling) is MEDIUM, not blocking, and acceptable to land via the Stage-4-or-later cleanup loop with the user's awareness.

If user instead prefers `advance to Stage 4 Testing` with NEW-1 as a known limitation (e.g., the pilot is on a tightly-controlled cohort with 24-h cookies and no admin-revoke flow), that's an acceptable user-override per quality-gates.md emergency-skip rules — but it must be the user's call, not the orchestrator's.

### If user overrides and we advance to Stage 4: brief for Tester + UX Auditor

**Top 3 things to focus their test plans on:**

1. **Re-auth UX hole (NEW-1).** Build a flow that revokes the session cookie mid-test (via direct `DELETE FROM auth_sessions WHERE id=…` in the DB) and verify the runtime shows a "session expired, please log in again" UI rather than silently flipping to `localFallbackPosted`. UX Auditor: this is the single highest-risk human-factors flow in v2.

2. **3rd-violation auto-submit happy path AND failure path (M4 / NEW-3).** Tester: write a Postgres-deadlock-injection test that forces `runSubmitInTransaction` to throw inside the `logViolation` tx; assert the violation counter does NOT get incremented (current v2 behavior — verifying the regression surface) AND assert the cron expiry-sweep will eventually pick up the session. If the v3 split-tx fix lands, re-assert: violation row durable, auto-submit retried separately.

3. **`/state` HEARTBEAT cadence + drift correction (B3, NEW-4).** Tester: stub `Date.now()` and the server time to simulate a 3-h test where the client clock drifts +10 s per hour; assert the heartbeat re-anchors `serverClockOffsetRef` and the timer fires on server-time, not local-time. UX Auditor: validate the "Offline — answers saved locally" banner is unambiguous to a student under stress.

---

## Open user-only questions (if any) blocking advance

None block engineering convergence. ONE judgment question for the user:

**Q:** Is the v1 architecture decision to use cookie-based sessions (vs token-bearing) compatible with the pilot operational reality (cohort size, admin-revoke frequency, cookie TTL = 24 h)? If revoke-mid-session is genuinely a rare-or-never event in the pilot, NEW-1 can be accepted as a known limitation and the loop closes at v2. If revoke-mid-session is a realistic operational event (e.g., a teacher catches a student cheating and revokes the session), v3 is required.

This is a constraint-clarification question, not an engineering question.
