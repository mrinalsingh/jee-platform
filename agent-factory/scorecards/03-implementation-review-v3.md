# Stage 3 (Implementation Loop) — Code Review v3 (FINAL)

**Reviewer:** Code Reviewer (discriminator)
**Iteration:** 3 of 3 (final allowed under constitution; iter 4 would require explicit user override)
**Track in scope:** Frontend only. Backend + Migrations advance unchanged from v2.
**Inputs:** Engineer-Frontend v3 (narrow scope: NEW-1 fix across 3 layers).
**Architecture under review:** `scorecards/02-architecture-final.md` (locked).
**Method:** Read every file the v3 brief named on disk; ran `npm run lint`, `npx tsc --noEmit`, `npx vitest --run`, `npm run bundle-check`; traced the 5 adversarial probes the v2 review pinned (race during submit, AuthError vs NETWORK_FAILURE_FALLBACK precedence, replay after re-login, return_to open-redirect, idempotency of `handleAuthFailure`).

---

## Composite Score: 9/10 (v1: 7 → v2: 8 → v3: 9)

## Per-Track Scores (final)
- Migrations: 8/10 (unchanged since v1)
- Backend: 8/10 (unchanged since v2 — NEW-3 carry-over MEDIUM, NEW-5/NEW-6 LOW, N16/N17/N18 LOW carry-overs; advance-ready)
- Frontend: **9/10** (v2 was 7; NEW-1 cleanly fixed across all 3 layers + the 4th/5th adjacent surfaces; one LOW callout below)

---

## NEW-1 verdict — clean fix across all 5 surfaces the brief required

### Layer 1 — `session-auth.ts` + `session-fetch.ts` typed sentinel: FIXED
- `frontend/src/lib/session-auth.ts:26-42` defines `SessionAuthError extends Error` with `status = 401`, `name = 'SessionAuthError'`, prototype-chain restored after `super()` (so `instanceof` works across realms), and the static `SessionAuthError.is(err)` predicate that dodges cross-realm `instanceof` traps (Vitest HMR module-graph re-imports + production code that throws-rethrows across module boundaries). This is the right pattern — the predicate, not the `instanceof`, is what every catch-block uses.
- `frontend/src/lib/session-auth.ts:56-70` `fetchWithCookies` wraps `fetch` and converts a `401` status into a thrown `SessionAuthError` while passing through every other status to the caller. `credentials: 'same-origin'` is hardcoded as the default (architecture §5.5).
- `frontend/src/lib/session-fetch.ts:22` re-exports `SessionAuthError` and `fetchWithCookies` so existing import paths keep working. The `next/headers` split into `./session-auth` is the correct Turbopack workaround documented inline.

### Layer 2 — `telemetry-queue.ts` dormant state + `onSyncAuthError`: FIXED
- `telemetry-queue.ts:23` imports `SessionAuthError` from the client-safe path.
- `telemetry-queue.ts:160-171` declares `onSyncAuthError?: (error: SessionAuthError) => void` with a doc-comment that nails the contract: pending items stay on disk; subsequent enqueues just persist; `onSyncFailure` is NOT called for the triggering 401 (distinct event class).
- `telemetry-queue.ts:187` adds `private dormant = false`. `:303-311` `scheduleDrain` bails out if dormant. `:313-322` `tryDrainOnce` also bails at entry AND re-checks dormant inside the per-action loop (so an action that 401s halts the rest of the batch too).
- `telemetry-queue.ts:342-350` is the critical catch-block: `if (SessionAuthError.is(e))` → set dormant, clear timer, fire `onSyncAuthError` exactly once, return WITHOUT consuming the head item (so the durable item is preserved for replay), WITHOUT bumping attempts (so it isn't surfaced as a network failure), WITHOUT firing `onSyncFailure` or `onSyncError`. Belt-and-braces — three side-effects suppressed.
- `telemetry-queue.ts:411-413, 429-431` — `defaultSender` `postSnapshot`/`postViolation` now check `res.status === 401` BEFORE the generic `!res.ok` branch and throw the typed sentinel. Without this the queue would treat 401 as a network failure.
- `telemetry-queue.ts:206-220` adds `resume()` for re-arm after re-auth and `isDormant()` for test/debug. `resume()` is idempotent (`if (!this.dormant) return;`).

### Layer 3 — `RuntimeProvider.tsx` state machine + AuthErrorBanner wiring: FIXED
- `RuntimeProvider.tsx:152-153` adds `authError: 'expired_session' | null` state + `authErrorRef` for non-React callback access. The pattern (state for render, ref for the heartbeat tick + autoSubmit guards) is correct.
- `RuntimeProvider.tsx:209-218` central `handleAuthFailure` is **idempotent** via the `if (authErrorRef.current) return;` guard — so multiple concurrent 401s (heartbeat + queue + in-flight submit POST) converge cleanly. Also resets `networkDegraded`, `lastSuccessfulHeartbeatRef`, and `consecutiveSyncFailuresRef` so the timer-expiry handler will not pick NETWORK_FAILURE_FALLBACK.
- `RuntimeProvider.tsx:245-247` wires `onSyncAuthError → handleAuthFailure`.
- `RuntimeProvider.tsx:293-310` heartbeat tick: special-cases `res.status === 401` → `handleAuthFailure()` and `return` BEFORE the `!res.ok throw new Error(...)` branch. Also adds an `if (authErrorRef.current) return;` early-exit at the top of the tick so subsequent polls don't generate more 401s.
- `RuntimeProvider.tsx:554-561` `autoSubmit` early-exit: `if (authErrorRef.current) return;` — defends against a stale `onViolationAck → autoSubmitRef.current?.('VIOLATION_THRESHOLD')` that could otherwise issue a 401-bound POST while in auth-error state. Belt-and-braces vs `handleTimerExpiry`.
- `RuntimeProvider.tsx:584-589` `autoSubmit` POST result branch: `if (res.status === 401) { handleAuthFailure(); setSubmitState('IDLE'); setSubmitOpen(false); return; }` placed BEFORE the `!res.ok && res.status !== 409` branch — so the false `localFallbackPosted = true` of v2 is impossible. Also handles the typed throw in the catch (`:611-616`).
- `RuntimeProvider.tsx:657-661, 672-676` `manualSubmit` mirrors the same 401-routing on both the response and the catch-block.
- `RuntimeProvider.tsx:702-711` `handleTimerExpiry` adds the auth-error trump card: `if (authErrorRef.current) return;` — so even if the heartbeat hasn't yet fired the 401 transition by the time the timer reaches 0, the auto-submit path is blocked. Combined with `autoSubmit`'s own guard, this is two-deep defense.
- `RuntimeProvider.tsx:784-787` `inputsDisabled` is now also `true` while `authError === 'expired_session'` — so the student can't keep enqueueing snapshots into a dormant queue. The existing on-disk pre-401 state is preserved for resume (or, more commonly in this codebase, for the post-re-auth re-mount that hydrates a fresh queue).

### Layer 4 — `AuthErrorBanner.tsx` component: FIXED
- `frontend/src/components/test-runtime/AuthErrorBanner.tsx:30-69` is a focused modal: `role="alertdialog"`, `aria-modal="true"`, labelled by `auth-error-title` ("Your session ended"), described by `auth-error-desc` (explains answers are saved locally and will sync after re-auth). Neutral colour palette (slate/border-subtle, not red — correct: this is NOT a violation event). Single "Sign in" CTA with `autoFocus` for keyboard users. Full-screen overlay + max-w-md card centres correctly on desktop and mobile alike.
- `RuntimeProvider.tsx:812-821` renders the banner conditionally on `authError === 'expired_session'` with the `onSignIn` callback that pushes `/login?return_to=${encodeURIComponent('/test/' + session.session_id)}`.

### Layer 5 — `/login?return_to=…` honour + strict allow-list: FIXED
- `frontend/src/app/login/page.tsx:22-25` allow-list: `typeof return_to === 'string' && return_to.startsWith('/test/')`. Anything else falls back to `next ?? '/dashboard'`. This is tight — the only allowed return targets are `/test/...` paths on the same origin. Probed for open-redirect: `/test//evil.com` does NOT trigger a protocol-relative URL when pushed via Next router because the leading slash + `/test/` prefix makes it a normal same-origin relative path. `?return_to=//evil.com` fails the prefix check. `?return_to=javascript:alert(1)` fails. ✓
- `frontend/src/app/login/LoginForm.tsx:25-46` POSTs to `/api/auth/session`, then on success `router.push(nextUrl)` where `nextUrl` is the safe-allow-listed `return_to`. The expired-session note (`:57-64`) is shown above the form so the student understands why they were redirected — UX win.

### Tests: 75/75 pass across 8 test files

- `telemetry-queue.test.ts:156-184` "on 401: fires `onSyncAuthError` exactly once and does NOT fire `onSyncFailure`" — asserts `onSyncFailure` and `onSyncError` were never called, `isDormant()` is true, `pendingCount()` is 1 (head item NOT consumed). This is the right shape.
- `telemetry-queue.test.ts:187-229` "after 401: subsequent enqueues do not fire `onSyncFailure` (queue dormant)" — covers idempotency of dormant + persistence-only-no-dispatch.
- `telemetry-queue.test.ts:232-267` "`resume()` after 401 re-arms the queue and drains pending items" — exact post-re-auth replay assertion.
- `RuntimeProvider.test.tsx:131-157` "renders AuthErrorBanner when the heartbeat returns 401" — full render + role/text assertions.
- `RuntimeProvider.test.tsx:159-194` "on heartbeat 401, NETWORK_FAILURE_FALLBACK does NOT fire at T=0" — fake-timer advance past the 2-s expiry, asserts ZERO `/submit` POSTs reached the fetch mock AND the AuthErrorBanner is still visible. This is the load-bearing test for the entire NEW-1 fix.
- Existing telemetry-queue, anti-cheat, katex-render, runtime-types, snapshot-store, palette tests all still pass — no regression.

### Build + bundle: GREEN

- `npm run lint` — 0 errors, 3 pre-existing warnings (`useRef(Date.now())` purity + two ref-during-render — all introduced by earlier iterations, not v3; all are React-Compiler-aware warnings that flag idioms which work but aren't strictly pure).
- `npx tsc --noEmit` — exit 0, no diagnostics.
- `npx vitest --run` — 75/75 pass; 8 files; 1.05 s. No skips, no flake.
- `npm run bundle-check` — `/test/[sessionId]` route is **167.6 KB gz** vs 200 KB cap → **32.4 KB headroom**. v3 added the AuthErrorBanner + the SessionAuthError class + the dormant-state machinery without breaking the budget.

---

## Adversarial probe results — all 5 scenarios HANDLED

1. **Race condition: 401 during submit** — HANDLED. Both `manualSubmit` and `autoSubmit` (a) check `res.status === 401` on the POST result and route to `handleAuthFailure` BEFORE the legacy `!res.ok` branch, (b) check `SessionAuthError.is(e)` in the catch-block for typed throws from inside the queue (`drainAndWait` may run sender code that throws SessionAuthError before the submit POST is even issued). No path sets `localFallbackPosted = true` after a 401 because the 401 branch returns early in both methods. Net: a mid-submit cookie revoke either short-circuits cleanly at the queue layer (queue goes dormant → `handleAuthFailure` fires → `autoSubmit`'s pre-POST guard at `:559-561` blocks the POST) or short-circuits at the response-status check (`:584-589`, `:657-661`). False-success impossible.

2. **AuthError vs NETWORK_FAILURE_FALLBACK precedence** — CORRECT. Three independent guards:
   - `handleTimerExpiry:702-705` — `if (authErrorRef.current) return;` BEFORE the silence-window check.
   - `autoSubmit:559-561` — `if (authErrorRef.current) return;` BEFORE the POST.
   - `handleAuthFailure:215-217` — resets `lastSuccessfulHeartbeatRef.current = Date.now()` and `consecutiveSyncFailuresRef.current = 0` so even if a stale path read those values past the guards, the silence window has been reset and would NOT pick NETWORK_FAILURE_FALLBACK.
   - The heartbeat tick (`:293-310`) routes 401 to `handleAuthFailure` and `return`s WITHOUT bumping the failure counter, so a 401-loop never trips the `>= 3` threshold that would otherwise show `networkDegraded`.

3. **Replay after re-login** — WORKS via dual mechanism. `queue.resume()` is implemented and tested in isolation (`telemetry-queue.test.ts:232-267`). However, the production path takes a different (also correct) route: the `/login` redirect → successful re-auth → `router.push('/test/{sessionId}')` re-mounts the RuntimeProvider, which constructs a fresh TelemetryQueue and calls `queue.hydrate()`, which reads the durable pending items from IndexedDB under the same `runtime-q::{session_id}` key. The fresh queue is NOT dormant by default, so it drains on the first scheduleDrain. The `resume()` method is unused in the current production flow but exists as a future-proofing affordance (e.g. an in-place re-auth modal that doesn't unmount the runtime). I'd accept either path; the engineer chose remount-style replay which is simpler. Test coverage hits resume() directly. ✓

4. **`return_to` safety** — TIGHT. The page-level allow-list (`page.tsx:22-25`) accepts only strings that `.startsWith('/test/')`. Probed: `//evil.com` rejected (no `/test/` prefix); `javascript:alert(1)` rejected; `/test/../../etc/passwd` accepted as a `/test/...` path but is just a same-origin Next route that would 404 — no open-redirect surface because Next router treats it as a relative same-origin path, and the URL encoding `encodeURIComponent` at the RuntimeProvider call site prevents the student from interfering with the query-string. ✓

5. **Idempotency of `handleAuthFailure`** — WORKS. The `if (authErrorRef.current) return;` guard at `:210` runs synchronously before any state-setter. Three independent 401s arriving in parallel (heartbeat, queue, in-flight submit) all converge to a single `setAuthError('expired_session')`, a single `setNetworkDegraded(false)`, a single `lastSuccessfulHeartbeatRef.current = Date.now()`. AuthErrorBanner renders exactly once because React batches the duplicate `setAuthError` calls and the value is unchanged. ✓

---

## Blocking Issues (still open after v3)

**NONE.** NEW-1 is closed at all 5 layers with test coverage and three independent guards. All pre-v2 blockers are also closed. No new HIGH/CRITICAL surfaced under the adversarial probes.

---

## Non-Blocking Issues (Stage 4 / future loops)

These carry over from v2 unchanged — v3 was a narrow-scope fix and was not asked to address any of them:

1. **[MEDIUM] NEW-2 (carry)** DOMPurify config should pin `ALLOWED_URI_REGEXP` defensively — defence-in-depth against a future `<a>` allow-list expansion. Frontend.
2. **[MEDIUM] NEW-3 (carry)** Violation-tx coupling rolls back violation when submit fails — split into two transactions so the audit row is durable. Backend.
3. **[MEDIUM] N7 (carry)** Application-level cap on per-request `action_seq` jump and `visit_count` jump in `patchSnapshot` UPSERT. Mitigated by the 60/min throttle, not closed. Backend.
4. **[LOW] NEW-4 (carry)** Heartbeat cadence mismatch with architecture (60 s vs 30 s). Frontend.
5. **[LOW] N16 (carry)** Add `app.setGlobalPrefix('api')`. Backend.
6. **[LOW] N17 (carry)** Add a NestJS `ExceptionFilter` to project unknown errors to `{ error: 'internal', request_id }`. Backend.
7. **[LOW] N18 (carry)** Importer should validate `wrong_paths[].diagnostic_tag` shape against the 5 ERR-* axes. Backend.
8. **[LOW] N20 (carry)** `session-fetch.ts` lacks `AbortController` timeout + 5xx retry. Frontend.
9. **[LOW] N10/N11/N12/N13/N22/N23/N24 (carry)** Migration cosmetics, hint pad jitter.

### NEW in v3 (LOW only)

10. **[LOW] NEW-7** `TelemetryQueue.drainAndWait(maxWaitMs)` does not early-exit when the queue goes dormant during a drain pass; it spins up to `maxWaitMs` (10 s in `autoSubmit`, 30 s in `manualSubmit`) before returning `false`. Functionally benign — `tryDrainOnce` returns immediately on each retry once dormant — but the user-visible submit modal sits in the "draining…" state for that window before flipping to the AuthErrorBanner. Fix: add `if (this.dormant) return false;` inside the `drainAndWait` loop. Estimated work: 1 line. Carry to Stage 4 polish.

---

## What's Good (v3 specific)

1. **Test-first NEW-1 closure.** The two RuntimeProvider integration tests (`RuntimeProvider.test.tsx`) AND the three TelemetryQueue 401-path tests (`telemetry-queue.test.ts:156-267`) directly assert the v2 review's specific failure mode: no `/submit` POST fires at T=0 while in auth-error state; `onSyncFailure` is NOT called for 401; pending items stay on disk for replay; `resume()` re-arms cleanly. This is the discipline the constitution rewards.

2. **Three-deep defense on the auto-submit path.** `handleTimerExpiry` checks `authErrorRef`, `autoSubmit` checks `authErrorRef`, `handleAuthFailure` resets the silence window so even unmodified network-fallback logic upstream would not fire NETWORK_FAILURE_FALLBACK. Any single one of these three would close NEW-1; the engineer wrote all three. That's the right disposition for a HIGH-severity bug — you don't trust one barrier when three independent ones cost nothing.

3. **Clean separation of `next/headers`-bound code from client-bundle code.** The new `session-auth.ts` file factors out the `SessionAuthError` class and the `fetchWithCookies` helper so the client bundle doesn't transitively pull `next/headers` (which Turbopack rejects in client-marked modules). This is the right architectural response to a Turbopack constraint — and it's documented inline at the top of both files so the next engineer doesn't undo it accidentally. The re-export from `session-fetch.ts` preserves backwards-compatible import paths.

4. **`SessionAuthError.is(err)` predicate, not raw `instanceof`.** The static method dodges cross-realm `instanceof` traps. This matters specifically in the Vitest module-graph re-import case AND in any future module-federation/SSR boundary where two copies of the class might exist. Prototype-chain restoration in the constructor (`Object.setPrototypeOf(this, SessionAuthError.prototype)`) covers the third path (subclasses of native `Error` are tricky pre-ES2022). Three independent failure modes covered with two lines of code. Staff-level engineering.

5. **`AuthErrorBanner` uses neutral palette, not violation-red.** The student did nothing wrong; a red banner would mis-signal cheating. Slate/border-subtle + a "Sign in" CTA is the right tone. Engineer thought about the UX implication of the colour, not just the wiring.

6. **`/login?return_to` allow-list is fail-closed, not fail-open.** `startsWith('/test/')` and nothing else. The single-line check (`page.tsx:22-25`) is the kind of code that survives reviews — a future maintainer wanting to extend the allow-list has to consciously broaden the prefix.

7. **`inputsDisabled` extended to include `authError === 'expired_session'`.** This blocks the student from typing answers into a UI that can't persist them server-side, while keeping the on-disk pre-401 state safe for replay after re-auth. This was not explicitly required by the brief but is the correct UX response — the alternative (allow input, queue silently) would either lose data or be confusing.

8. **`bundle-check` headroom preserved.** AuthErrorBanner + SessionAuthError class + dormant-state machinery added without breaking the 200 KB cap. 167.6 KB gz, 32.4 KB headroom. The narrow allow-list on DOMPurify, the small AuthErrorBanner JSX, and the absence of any new top-level dependency keep the budget intact.

---

## Composite Verdict

**advance to Stage 4 Testing.**

Reasoning: Composite 9/10 reflects (a) all 5 v1 blockers closed since v2, (b) NEW-1 closed at all 5 layers with three-deep defense and direct test coverage, (c) zero new HIGH/CRITICAL surfaced under five adversarial probes, (d) lint clean, tsc clean, 75/75 tests pass, bundle 32 KB under cap. The Frontend score moves 7 → 9. Backend (8) and Migrations (8) advance unchanged. The remaining open items are MEDIUM/LOW carry-overs that are appropriate to address as Stage 4 polish or as future-loop work — none of them block the runtime from passing the discriminator gate.

The constitution's binding rule (no advance past a gate while any HIGH/CRITICAL is open) is satisfied. The MEDIUM carry-overs (NEW-2 DOMPurify URI regex, NEW-3 violation-tx split, N7 action_seq cap) are tracked and assigned to the Stage-4-or-later loop with the user's prior awareness from v2.

---

## Brief for Stage 4 Tester + UX Auditor

**Top 4 things to focus their test plans on:**

1. **End-to-end re-auth round-trip (NEW-1 closure).** Build the flow: student midway through a test → admin runs `DELETE FROM auth_sessions WHERE user_id = ...` in psql → next heartbeat tick 401s → AuthErrorBanner renders → student clicks "Sign in" → /login renders the expired-session note → student re-auths → router.push back to `/test/{sessionId}` → RuntimeProvider re-mounts → fresh TelemetryQueue hydrates the durably-persisted snapshots from IndexedDB → drains them on first scheduleDrain → student picks up where they left off. UX Auditor: walk this end-to-end and confirm the student understands what happened at every step.

2. **3rd-violation auto-submit happy path AND failure path (M4 / NEW-3 carry).** Tester: write a Postgres-deadlock-injection test that forces `runSubmitInTransaction` to throw inside the `logViolation` tx; assert the violation counter does NOT get incremented (current v2 behavior — verifying the regression surface). If the NEW-3 split-tx fix lands as part of Stage 4 polish, re-assert: violation row durable, auto-submit retried separately, audit append-only invariant preserved.

3. **HEARTBEAT cadence + drift correction (B3, NEW-4 carry).** Tester: stub `Date.now()` and the server time to simulate a 3-h test where the client clock drifts +10 s per hour; assert the heartbeat re-anchors `serverClockOffsetRef` and the timer fires on server-time, not local-time. Probe the NEW-4 mismatch: 60-s heartbeat + 30-s NETWORK_FAILURE_WINDOW_MS — at the exact 30-s mark of silence (between two heartbeats), there is a transient state where networkDegraded=false but silenceMs > window. The timer-expiry handler reads silenceMs from `lastSuccessfulHeartbeatRef` directly so the race is non-existent at the decision point, but verify under fake timers.

4. **Cross-tab / cross-device coexistence.** UX Auditor: open the test in two tabs. Confirm that when one tab's heartbeat picks up `multi_device_warning: true` (architecture §5.3 endpoint 5), the runtime surfaces it. Then revoke the session — confirm BOTH tabs flip to AuthErrorBanner independently (idempotent `handleAuthFailure` should handle the duplicate firings cleanly).

---

## Iteration Delta (v2 → v3)

- **Issues from v2 that were FIXED:** NEW-1 (HIGH, 3-layer fix done at 5 layers — the engineer expanded scope to AuthErrorBanner + return_to allow-list as the brief required).
- **Issues from v2 still OPEN:** NEW-2, NEW-3, NEW-4, N7, N16, N17, N18, N20, N10/11/12/13/22/23/24 (all are MEDIUM/LOW carry-overs that v3 was not asked to fix and that are appropriate to land via Stage 4 or a future loop).
- **NEW issues found in v3:** NEW-7 (LOW — `drainAndWait` doesn't early-exit on dormant; 1-line fix; user-visible only as a delay before the AuthErrorBanner replaces the "draining" submit modal). One line, deferred to Stage 4 polish.

---

## Open user-only questions (if any) blocking advance

**None.** The cookie-revoke operational reality question raised in v2 is now moot — the codebase handles revoke-mid-test gracefully regardless of frequency. Advance is unconditional.
