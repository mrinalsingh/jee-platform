# PRD: Student Test-Taking Runtime — JEE-Advanced-style CBT with NotebookLM polish

**Stage:** 1 (Spec Loop) | **Iteration:** v1 | **Author:** Product Manager (generator)
**Reviewed by:** Spec Critic (pending) | **Scope window:** the in-browser experience a student goes through from sign-in landing through pre-test instructions through actively taking a test through post-test response review.

---

## 0. Glossary (read once — used throughout)

- **Runtime** — the in-browser screens during an active test (instructions → questions → submit).
- **Section** — one subject's question set within a test (Physics / Chemistry / Mathematics). One test contains 1–3 sections; v1 supports 1 (Maths-only, the only populated subject in the bank today) but the layout treats sections as first-class so Phys + Chem drop in without redesign.
- **Question palette** — the right-rail numbered grid of all questions in the current section, colour-coded by per-question status.
- **Per-question status** — one of: `NOT_VISITED`, `VISITED_NOT_ANSWERED`, `ANSWERED`, `MARKED_FOR_REVIEW` (no answer yet), `ANSWERED_AND_MARKED` (answered AND flagged for re-check; counts as answered for marking).
- **Attempt action** — a discrete state-changing user action on a question: select option, deselect option, enter numeric value, clear, mark, save-and-next, etc. Every attempt action triggers a telemetry write.
- **Server attempt-snapshot** — the canonical record on the server for one (student × test × question) tuple, holding `selected_option(s) | numeric_value`, `time_seconds`, `visit_count`, `marked_for_review`, `last_action_seq`, `last_action_at`. Each Save action overwrites the previous snapshot for the same key. The **append-only** `attempts` row in the schema is written ONCE at submit (or at auto-submit), reading the final snapshot — the in-test snapshot table is a separate transient store. (See §8 dependency.)
- **Test session** — the active enrolment of one student in one scheduled test: `(session_id, student_id, test_id, started_at, expires_at, status)`. There is exactly one active test session per (student × test) tuple at any moment.
- **Telemetry write** — the network call that persists an attempt action. Two-tier: (1) optimistic local IndexedDB write (synchronous, always succeeds), (2) background fetch to the server with retry queue. UI state advances on tier 1; tier 2 reconciles asynchronously.
- **Tier-2 city 4G** — reference network profile for performance budgets: 8 Mbps down / 3 Mbps up, 80 ms RTT, 1.5% packet loss. (Indian Tier-2 city median per TRAI Q4-2025; the closest stable proxy is a throttled Chrome DevTools "Fast 3G" profile + 80 ms RTT.)
- **Mid-range laptop** — reference hardware: 4-core CPU at 6× slowdown vs an unthrottled 2024 MacBook Pro (Chrome DevTools CPU 6×), 8 GB RAM, integrated GPU. Approximates a ₹40–50k Windows laptop a typical student uses at home.

---

## 1. Problem Statement

### 1.1 The user-visible problem

**Students** preparing for JEE Advanced practise on a portal whose UI does not match the exam-day CBT they will sit. The current jee_platform portal (the 24-screenshot anti-pattern at `/ONLINE EXAM PORTAL SCREENSHOT Rahul/`) is Bootstrap-era: teal banner, dark sidebar, dense forms, no breathing room, sluggish on slow networks. Students who train on it carry the wrong muscle memory into the actual exam (JEE Advanced uses the NTA CBT pattern: question palette right-rail, save-and-next button family, numbered-grid status colour codes, two-step submit). They also burn cognitive load on a cluttered UI when the cognitive budget for a 3-hour paper is already maxed.

**Teachers** need the platform to capture per-question telemetry — `time_seconds`, `visit_count`, `marked_for_review`, `attempt_order` — so the diagnostic failure-mode pipeline (`scorecards/01-prd-final.md`) can pin a wrong attempt onto one of the 5 ERR-* axes. The diagnosis is impossible to reconstruct after the fact. **PROJECT CONTEXT §12 rule 5** marks this capture as NON-NEGOTIABLE from v1.

**Both students and teachers** lose patience with a UI that takes 4–6 seconds to become interactive. Speed is non-negotiable per the user's brief.

### 1.2 Why now

- Backend schema is locked (Stage 2 complete). `problems`, `tests`, `attempts` exist and the schema already requires every attempt to carry the four telemetry fields. The runtime must populate them.
- The bank now has ~159 Maths problems — enough to assemble a real 18-question Maths-only paper for pilot use.
- The diagnostic-axis Stage 1 PRD (scorecards/01-prd-final.md §4 US-1) depends on a post-test review screen that displays the diagnosis card. That screen lives in this PRD's §4 US-8.
- Pilot is the next operational milestone (PROJECT CONTEXT §8 Stage 10). Without a runtime, there is no pilot.

### 1.3 Who has this problem

- **The student** sitting at their desk at 10:00 on a Saturday, opening their assigned mock. They need to land in a UI that feels like the JEE Advanced CBT they have practised against on NTA mock-test portals — no learning curve, no surprise.
- **The teacher** (MS and his peers) — who built the test in the bank-driven test-builder — needs telemetry written reliably so the post-test review and the failure-mode dashboard work.
- **The admin** — light touch — needs the runtime to never lose data and never let a student submit a test where the test was clearly attempted but the submission record is empty (the classic "tab crashed and we lost the paper" support ticket).

---

## 2. Target Users

| Persona | Description | Primary goal in this runtime | Tech context |
|---|---|---|---|
| **S — Median JEE Aspirant** | 16–18 yr old in Class 11/12 or drop year. Scored 60–120 / 360 on a recent JEE Advanced mock. Uses platform 1–2 h/day. | Take an assigned mock in a UI that mirrors JEE Advanced CBT muscle memory, finish without UI friction, see per-question diagnosis after. | Mixed: ~60% take tests on a 13–15" Windows laptop on home WiFi or 4G hotspot; ~40% peek at the dashboard on phone. **Tests are taken on laptop / tablet ≥ 768 px wide only**; phone is dashboard-and-review-only (see §5 NFR). |
| **T — Subject Teacher / Mentor** | Maths/Phys/Chem teacher; assigns 5–30 students; reads telemetry to plan remedials. | Trust that every assigned test captures all four telemetry fields, on every question, every time. | Laptop; high tech comfort. Reads palette colour codes and submission counts in the admin view (out of scope for this PRD). |
| **A — Admin** | Operations role; resolves student complaints ("my test didn't submit"). | Be able to point at a server log proving the student's last action was captured, when there's a complaint. | Laptop; high tech comfort. Admin tooling is OUT of scope; this PRD only requires that the runtime emits audit-trail records the admin tool can read later. |

---

## 3. Success Metrics

### 3.1 North Star (measurable from day 1 of pilot)

**Time-to-interactive on the test runtime page on a Tier-2-city 4G connection on a mid-range laptop (definitions in §0).**

Two thresholds, both measured by the browser's Performance Timing API and aggregated server-side by a one-pixel beacon:

| Metric | Definition | Target (p50) | Target (p95) |
|---|---|---|---|
| **TTFP** (Time to First Paint) | `paintTiming` entry `first-contentful-paint` | ≤ 800 ms | ≤ 1500 ms |
| **TTI** (Time to Interactive) | First time the main thread is idle for ≥ 50 ms AND the question palette is fully clickable (verified by an integration test that clicks question #1 and asserts the question pane updated within 100 ms) | ≤ 1500 ms | ≤ 2500 ms |

Both measured on the route `/test/{session_id}/run`, cold cache, against the reference network + hardware profile defined in §0.

These targets are checked by a Lighthouse CI run on every commit to the runtime route (NFR §5.1).

### 3.2 Leading indicators (measurable during pilot)

1. **Telemetry completeness** — fraction of `attempts` rows submitted by the runtime where all four mandatory capture fields (`time_seconds`, `visit_count`, `marked_for_review`, `attempt_order`) are non-null and consistent (visit_count ≥ 1, time_seconds ≥ 0, attempt_order is unique within the (student × test) tuple and 1-indexed contiguous). **Target ≥ 99.5%.**
2. **Lossless-submit rate** — fraction of submitted tests where the count of `attempts` rows equals the count of distinct questions in the test's ordered question_codes list. **Target = 100%** (any deviation is a blocking bug).
3. **Disconnect-recovery rate** — among test sessions that experienced ≥ 1 network blip ≥ 5 s (detected by the client's heartbeat), fraction where all answers entered during the blip window were eventually persisted server-side by submission time. **Target ≥ 99.9%.**
4. **Submit-page bounce rate** — fraction of test sessions where the student reached the two-step submit confirm dialog but then closed the tab without completing. **Target ≤ 2%** (otherwise the confirm wording is scaring people).
5. **Section-switch ergonomics** — median time between a student clicking a section tab and the new section's question palette becoming clickable. **Target ≤ 200 ms** (in-memory section switch, no server round-trip).

### 3.3 Guardrails (must NOT degrade — applies in both phases)

1. **Zero data loss on network blip.** Offline-write IndexedDB queue MUST drain before the submit confirm dialog is allowed to close successfully. If the queue cannot drain within 30 s after Confirm Submit is pressed, the dialog blocks with a "still saving N answers — do not close this tab" message until the queue drains, then auto-confirms.
2. **Zero submitted-test-with-missing-answers due to client bug.** Server-side validation on POST /api/test-sessions/{id}/submit rejects any submission where the count of attempt-snapshots on the server is less than the count of questions the student marked as ANSWERED in their submitted payload. The endpoint returns 409 with the diff; the client displays "your browser thinks you answered N questions but the server only saw M — reloading to reconcile" and re-syncs.
3. **No double-submission.** POST /api/test-sessions/{id}/submit is idempotent on `session_id`; subsequent calls return the original submission result, NEVER overwrite.
4. **Auto-submit on timer = 0 within 1 s of true zero.** Even if the user's tab is throttled by the browser (background tab), the server-side timer expiry triggers an auto-submit independently (per US-5).

---

## 4. User Stories

### US-1 — Student signs in and starts an assigned test (S)

**As a** student, **I want to** sign in, see the tests assigned to me, and start the one whose start window is open, **so that** I'm sitting in front of the question palette within 30 seconds of opening the browser.

**Acceptance Criteria:**

- [ ] Given the student is unauthenticated, when they hit any route under `/test/*`, then they are redirected to `/login` and after successful login redirected back to the originally requested route.
- [ ] Given the student is authenticated, when they open `/dashboard`, then the dashboard shows a list of tests assigned to them with: title, subject(s), duration, marking-scheme summary (one line: e.g. "+4 / −1, partial on MCQ-MC"), `available_from`, `available_until`, and a status badge (`UPCOMING`, `OPEN`, `IN_PROGRESS`, `SUBMITTED`, `EXPIRED`).
- [ ] Given a test in `OPEN` status (current time ∈ [`available_from`, `available_until`] and no prior submission exists for this student × test), when the student clicks `Start`, then the client calls `POST /api/test-sessions` with `test_id`, the server returns `{session_id, expires_at}`, and the student is taken to the **Pre-Test Instructions** page (`/test/{session_id}/instructions`).
- [ ] Given a test in `IN_PROGRESS` status (a session exists for this student × test with `submitted_at IS NULL` and `expires_at > now()`), when the student clicks `Resume`, then they are taken directly to `/test/{session_id}/run` and the timer reflects the *server-side* `expires_at − now()`, not a fresh duration.
- [ ] Given a test in `UPCOMING` status, when the student clicks the card, then the Start button is disabled and a subtitle reads "opens in HH:MM:SS" (live countdown on the dashboard card).
- [ ] Given a test in `EXPIRED` or `SUBMITTED` status, when the student clicks the card, then they are taken to the post-test review page (US-8) — for `EXPIRED` only if an auto-submission record exists; otherwise the card reads "expired without submission, contact your teacher".

**Flow (happy path):**
1. Trigger: student opens browser, navigates to `https://app.jeeplatform.example/`.
2. Step: if unauthenticated → `/login` → enter email + password (auth is OUT of scope but the runtime assumes the existing `/api/auth/login` returns a session cookie).
3. Step: authenticated → `/dashboard`. Dashboard lists assigned tests. Student sees today's mock at the top.
4. Step: student clicks `Start` → `POST /api/test-sessions` → on 201 response, navigate to `/test/{session_id}/instructions`.
5. Outcome: instructions page renders within 1 s of click.

**Error paths:**
- **E1 — Another active session exists.** `POST /api/test-sessions` returns 409 with `existing_session_id`. The client navigates to `/test/{existing_session_id}/run` (resume, not start fresh). NEVER lose progress to a misclick.
- **E2 — Session creation fails (server 5xx).** Toast: "could not start test — try again in 10 s". Button re-enables after 10 s. NEVER auto-retry silently — the student must know.
- **E3 — Token expired.** API returns 401 → redirect to `/login` with `?next=/dashboard`. After re-auth, return to dashboard, NOT into the test (re-auth invalidates any progress claim).

**Edge cases:**
- Student opens the same dashboard in two tabs and clicks `Start` in both within 100 ms. → Both calls hit the server; the server uses a unique constraint on `(student_id, test_id) WHERE submitted_at IS NULL` so the second call returns 409 with the first call's `session_id`. Both tabs end up in the same session (see US-7 for the two-device case).
- Network is offline at click-time. → Button shows a brief "no network" toast; nothing else changes. The student retries when network returns.

---

### US-2 — Student reads instructions and enters the test (S)

**As a** student, **I want to** see clear pre-test instructions (duration, marking scheme, palette colour code legend, section structure, what each button does), **so that** I don't waste exam-clock seconds learning the UI mid-test.

**Acceptance Criteria:**

- [ ] Given the student is on `/test/{session_id}/instructions`, when the page renders, then it shows: test title, duration, total questions, per-section breakdown (subject + question count + marking scheme), the palette colour-code legend (5 statuses with exact colour samples), a labelled diagram of the test runtime UI (palette, question pane, action buttons), and an "I have read and understood — Start Test" checkbox + button.
- [ ] Given the student has not checked the "I have read" checkbox, when they click the Start Test button, then the button does nothing and the checkbox row briefly highlights (200 ms tinted background).
- [ ] Given the student checks the box and clicks Start Test, when the click is registered, then `PUT /api/test-sessions/{session_id}` sets `started_at = now()`, the server returns the test payload (ordered question_codes + each problem's content + marking_scheme + duration), the client warm-caches all problem statements in IndexedDB, navigates to `/test/{session_id}/run`, and the timer begins ticking from the *server-returned* `started_at + duration`. (The server is the clock authority; client display is a derived view.)
- [ ] Given the student opens the instructions page and idles for ≥ 10 minutes without starting, when they return, then the page is unchanged (instructions don't expire until the test's `available_until` does — that's checked at Start Test click time).
- [ ] Given the test has only 1 section in v1 (Maths-only is the only case the bank currently supports), when the instructions page renders, then the section-structure block reads "1 section: Mathematics" with no defensive copy about Physics / Chemistry coming later (don't over-promise).

**Flow (happy path):**
1. Trigger: student arrives at `/test/{session_id}/instructions` from US-1 step 5.
2. Step: page shows instructions. Student reads. ~30–60 s.
3. Step: student checks "I have read" → button enables → student clicks Start Test.
4. Step: client calls `PUT /api/test-sessions/{session_id}` with action=START, gets back the full test payload, warm-caches problem statements + figures (KaTeX-rendered HTML strings + SVG/PNG images) to IndexedDB.
5. Outcome: navigates to `/test/{session_id}/run`. Question 1 of section 1 is visible; timer is ticking; palette is fully rendered.

**Error paths:**
- **E1 — Server START call fails (5xx).** Modal: "couldn't start your test — please try again". Retry button. Student is NOT navigated forward until the call succeeds — otherwise the runtime has no `started_at`.
- **E2 — Test payload exceeds 5 MB (large bank with figures).** Client streams the payload; instructions page shows a progress bar with "preparing test … 47%". Page does NOT navigate until 100% (no partial-test attempts). Hard timeout 30 s → modal "test is unusually large — contact your teacher" + retry.
- **E3 — Session expired between instructions and click.** Server returns 410 Gone. Modal: "this test window has closed". Button to return to dashboard.

**Edge cases:**
- Student reloads the instructions page after starting the test. → On reload, the client checks server session status; if `started_at IS NOT NULL`, redirect to `/test/{session_id}/run` (don't re-show instructions; once started, no going back).
- Student presses browser back from instructions to dashboard. → Allowed; session has not been STARTed so `started_at IS NULL`; the dashboard shows the test still as `OPEN` (not `IN_PROGRESS`).

---

### US-3 — Student answers questions across all five answer-types (S)

**As a** student, **I want to** answer each of the five JEE Advanced answer-types — MCQ-SC, MCQ-MC, NUM-INT, NUM-DEC, MAT-COL — with the exact input affordance the official CBT uses, **so that** my muscle memory transfers directly to exam day.

**Acceptance Criteria — input affordances (one per answer-type):**

- [ ] **MCQ-SC**: 4 radio buttons (A, B, C, D), single-select. Click anywhere on the row (not just the radio circle) selects. Clicking the selected row again does NOT deselect — to deselect, the student must click "Clear Response". Selection is visible by: filled radio, row background tinted with the accent colour at 8% opacity, accent-coloured 2 px left border on the row.
- [ ] **MCQ-MC**: 4 checkboxes (A, B, C, D), multi-select. Click toggles. Selected rows tinted as above. Selection of ≥ 1 box puts the question in ANSWERED state. No upper limit on selections.
- [ ] **NUM-INT**: text input + on-screen virtual keypad (0–9, minus sign, backspace, clear) below the question. Physical keyboard works in parallel (input accepts `[0-9-]` only; other keys silently ignored). Range: −999 to 999 (per JEE Advanced convention). Negative sign accepted only at position 0. Input ≥ 4 characters in length triggers the existing JEE-Advanced "value too long, max 3 digits" inline warning; submission rejects values outside the range with the same inline warning.
- [ ] **NUM-DEC**: text input + virtual keypad (0–9, decimal point, minus sign, backspace, clear). Physical keyboard accepts `[0-9.\-]`. Precision is `problems.answer.precision` (the field defined in the diagnostic-axis PRD §6); the input enforces ≤ `precision` decimal places (typing a digit beyond precision is silently dropped + a "rounded to N decimals" hint appears for 2 s). On Save, the value is normalised via `toFixed(precision)` using round-half-to-even (banker's rounding, per Stage 2 architect input notes Requirement E) — the same shared normaliser the wrong-path matcher uses.
- [ ] **MAT-COL**: two-column layout. Left column lists List-I items (P, Q, R, S — 4 typical), right column lists List-II options (1, 2, 3, 4, 5 — JEE Advanced typically gives 5 options for 4 picks). Each List-I row has a dropdown OR a click-to-pair affordance (Architect chooses; both must satisfy the touch-target NFR). One List-II option may map to multiple List-I rows. ANSWERED = all 4 List-I rows have a List-II selection.

**Acceptance Criteria — common to all types:**

- [ ] Given the student selects/enters an answer, when the value changes, then the local state updates synchronously, an IndexedDB write is queued with `(session_id, question_code, answer_payload, action_seq=monotonic++, client_timestamp_ms)`, the question's palette cell switches to ANSWERED colour within 16 ms (next frame), and the server PUT call to `/api/test-sessions/{session_id}/snapshots/{question_code}` is fired in the background.
- [ ] Given the server PUT call fails (network blip), when 5 s elapses, then the action is retried with exponential backoff (5s, 10s, 20s, 40s, 60s; cap 60s). The palette cell shows a tiny grey "sync pending" dot in the corner until the call succeeds. All actions during the blip are queued in order and replayed in order.
- [ ] Given the question is MCQ-MC and the student selects exactly 0 options after previously having ≥ 1, when the state updates, then the cell drops out of ANSWERED back to VISITED_NOT_ANSWERED (or ANSWERED_AND_MARKED → MARKED_FOR_REVIEW if it had been Marked).
- [ ] Given the question's `answer_type` enum is unrecognised by the client (forward-compat — bank adds a new type), when the question pane attempts to render, then it shows a hard error block ("unsupported question type; please contact your teacher") rather than rendering a misleading input.

**Flow (happy path) — common shape:**
1. Trigger: question pane displays Q_n (the current question in the current section).
2. Step: student reads statement (KaTeX-rendered LaTeX + any figure SVG/PNG).
3. Step: student interacts with the input affordance matching `answer_type`.
4. Step: client writes the action locally + posts to server (background); palette cell repaints.
5. Step: student clicks `Save & Next` → next question loads from the warm cache (no network round-trip) within 100 ms.
6. Outcome: question is ANSWERED, cell is green, next question is in focus.

**Error paths:**
- **E1 — Invalid numeric input** (e.g. `--5`, `1.2.3`, `1.23456` when precision=2 — though the input already prevents most): inline 1-line error below the input field, in the accent-warning colour. NEVER blocks navigation — the student can still Save & Next, but the value won't be accepted as ANSWERED until valid (palette cell stays VISITED_NOT_ANSWERED with a tiny red "invalid" dot).
- **E2 — MAT-COL pairing incomplete** (2 of 4 List-I rows have selections, then Save & Next clicked): Save is allowed; palette cell becomes VISITED_NOT_ANSWERED (NOT answered); inline hint "answer all 4 to count as answered" appears below the pane for 3 s. NEVER blocks navigation.
- **E3 — IndexedDB write fails** (browser quota exceeded, private mode, etc.): top-bar persistent banner "your browser is blocking offline storage — answers may be lost on a network drop". The runtime keeps an in-memory queue as a fallback and immediately attempts the server PUT (no offline write); the banner stays until IndexedDB is available again.

**Edge cases:**
- Student types in NUM-INT while focus is on the question pane background (not the input). → Physical keypress is captured by a global key handler ONLY if the current question is NUM-INT or NUM-DEC AND no other input is focused; the value goes into the question's input field. Otherwise it's ignored.
- Student uses browser zoom 200%. → All input affordances and the palette must remain usable at 200% zoom (NFR §5.2 accessibility).
- Student copies/pastes a long string into NUM-INT. → Paste handler filters to `[0-9-]` and truncates to range; if anything was filtered, a 1-line "non-numeric characters removed" hint appears for 2 s.

---

### US-4 — Student marks a question for review and returns later (S)

**As a** student, **I want to** flag a question I'm unsure about, move on, and return to it before submitting, **so that** I don't waste time staring at one question when there's marks-per-minute available elsewhere.

**Acceptance Criteria:**

- [ ] Given the student is on a question, when they click `Mark for Review & Next`, then: if the question is currently ANSWERED, its status becomes ANSWERED_AND_MARKED (purple cell with green dot — counts as answered for marking but flagged for re-check); if currently VISITED_NOT_ANSWERED or NOT_VISITED, its status becomes MARKED_FOR_REVIEW (purple cell, no dot — does NOT count as answered). Then move to the next question.
- [ ] Given the student is on a question, when they click `Save & Mark for Review & Next`, then the current answer is saved first (if any), then the status is set per the above rule, then move to next.
- [ ] Given the student is on a question in MARKED_FOR_REVIEW or ANSWERED_AND_MARKED status, when they click on the same palette cell again from another question, then they return to that question; the action buttons show normally (i.e. they can re-answer or Clear Response).
- [ ] Given a question is ANSWERED_AND_MARKED, when the student submits the test, then the marking engine counts that answer as a real answer (per JEE Advanced rules: the "mark" flag is for the student's mental bookkeeping, not for scoring).
- [ ] Given the student looks at the section summary strip, when it renders, then it shows live counts per status: e.g. `Answered: 12 · Marked: 3 · Marked & Answered: 2 · Visited but not answered: 1 · Not visited: 0` for the current section.

**Flow (happy path):**
1. Trigger: student on Q_n is unsure.
2. Step: student types a partial NUM-INT value, then clicks `Save & Mark for Review & Next`.
3. Step: client persists answer + sets marked_for_review=true + advances to Q_{n+1}.
4. Step: student finishes the section, returns to Q_n via the palette.
5. Outcome: Q_n is editable; student updates the answer; cell colour updates accordingly.

**Error paths:**
- **E1 — Clear Response on a Marked question** does NOT clear the mark flag. Mark is independent of answer state. The cell goes from ANSWERED_AND_MARKED → MARKED_FOR_REVIEW (purple, no dot).
- **E2 — Mark action fires while a server PUT for the same question is in flight.** Local optimistic update wins; the new action is queued. Server reconciliation uses `action_seq` (monotonic per session) — the later `action_seq` is canonical.

**Edge cases:**
- Student marks every question in the section. → Behaves normally; the section summary shows the counts; submit confirm warns about unanswered count, not about Marked count (Marked is the student's bookkeeping, not the system's).

---

### US-5 — Auto-submit when timer hits zero (S, system)

**As a** student (and system on the student's behalf), **I want** the test to submit itself the moment the duration runs out, with no opportunity to add answers after time, **so that** the test integrity matches exam-day rules and the student doesn't sit there panicking past the buzzer.

**Acceptance Criteria:**

- [ ] Given the test session's `expires_at` is reached, when the client clock crosses it, then the runtime: (a) locks all input affordances (disabled state, greyed out, with a "time up" overlay over each input), (b) drains the IndexedDB queue with a max wait of 10 s, (c) calls `POST /api/test-sessions/{session_id}/submit` with `auto_submit=true`, (d) on 200 response navigates to the post-test review page (US-8).
- [ ] Given the client clock is wrong (skewed by ≥ 30 s vs the server clock at session START), when the runtime detects the skew, then the runtime uses `server_expires_at - (server_now - client_session_start)` as the displayed timer. (Skew is computed at session START from the server's `Date` header on the START response.) NEVER trust the client clock alone for the expiry.
- [ ] Given the client is offline at expiry, when the timer hits zero locally, then the runtime locks inputs, posts the auto-submit request to the queue, and shows "time up — submitting when network returns; do not close tab". When network returns, the submit fires; on success, navigate to review.
- [ ] Given the client tab is in the background and the browser throttles the timer, when the server's `expires_at` is passed, then the server SHOULD trigger an auto-submit independently of the client. **The server runs a scheduled job every 30 s that queries `test_sessions WHERE expires_at < now() AND submitted_at IS NULL` and auto-submits them with `auto_submit=true, auto_submit_source='server_timer'`.** The client, on next focus, sees the submission already happened and navigates to review. (Decision: a server-side timer guarantees the integrity guarantee — client throttling cannot extend the test.)
- [ ] Given the auto-submit happens, when the post-test review renders, then it shows a banner "this test was auto-submitted at HH:MM:SS — answers locked at the timer".

**Flow (happy path):**
1. Trigger: timer ticks down to 0.
2. Step: runtime locks inputs at T = 0.
3. Step: drains queue (≤ 10 s).
4. Step: posts submit → 200.
5. Outcome: review page.

**Error paths:**
- **E1 — Queue does not drain in 10 s.** Submit is fired anyway with the partial server-side state (what's already persisted). The client posts the un-drained queue as a separate `POST /api/test-sessions/{session_id}/late-snapshots` endpoint with a "post-buzzer" flag; the server records these but does NOT include them in marking (audit-trail only). Review page banner: "some answers may not have synced — they have been logged for review by your teacher".
- **E2 — Server submit returns 5xx.** Client retries with backoff. UI shows "submitting your test … " until success. NEVER navigate forward on a failed submit.
- **E3 — Server has already auto-submitted (server-timer beat the client).** Client submit returns 409 with the existing submission; client navigates to review. No data is lost — the server-side submission used the latest snapshots.

**Edge cases:**
- Timer hits zero while the student is mid-typing a NUM-INT value. → Input is frozen at whatever was typed; whatever was already in the queue is what gets saved. The student does NOT get to finish typing.
- Student has the tab open in two devices (see US-7). Server-side timer is canonical; both clients lock at the same true T=0; both navigate to the same review page.

---

### US-6 — Student submits the test manually (S)

**As a** student, **I want to** submit the test when I'm done before the timer expires, with a clear two-step confirm so I don't submit by accident, **so that** I can leave the screen with confidence.

**Acceptance Criteria:**

- [ ] Given the student is in the runtime, when they click `Submit Test` (top-right corner), then a modal opens showing: per-section summary (Answered / Marked / Marked & Answered / Visited not answered / Not visited counts) and time remaining. The modal has two buttons: `Continue Test` (default, focused) and `Submit Now`.
- [ ] Given the student clicks `Submit Now`, when the click registers, then a SECOND modal opens: "You are about to submit. After submitting you cannot return to the test. Please confirm." with `Cancel` (default, focused) and `Confirm Submit`.
- [ ] Given the student clicks `Confirm Submit`, when the click registers, then: drain queue (max 30 s with the "still saving — do not close" message; see §3.3 guardrail 1), call `POST /api/test-sessions/{session_id}/submit` with `auto_submit=false`, on 200 navigate to review.
- [ ] Given the student has any question in VISITED_NOT_ANSWERED state, when the first modal opens, then those questions are listed with a count and a per-question chip (Q3, Q7, Q11) and a yellow banner "you visited but didn't answer these — review before submitting?".
- [ ] Given the student has any question in MARKED_FOR_REVIEW state (not answered), when the first modal opens, then those questions are listed similarly with a purple banner "you marked these for review and didn't answer — review before submitting?".
- [ ] Given the student has every question ANSWERED, when the first modal opens, then a single green "all questions answered — ready to submit" line appears at the top.

**Flow (happy path):**
1. Trigger: student clicks `Submit Test` button.
2. Step: confirmation modal opens with section summary.
3. Step: student clicks `Submit Now`.
4. Step: second confirm modal opens.
5. Step: student clicks `Confirm Submit`.
6. Step: queue drains; POST submit; 200.
7. Outcome: navigates to post-test review (US-8).

**Error paths:**
- **E1 — Network drops during queue drain.** Confirm modal is replaced with "saving … (N answers remaining) — do not close tab". A countdown shows the 30 s patience window. After 30 s, the submit fires with the server's view; un-synced answers go to the audit-trail late-snapshots endpoint per US-5 E1.
- **E2 — Student closes the tab during drain.** Browser's `beforeunload` event fires a `navigator.sendBeacon` to a `POST /api/test-sessions/{session_id}/abandon-warning` endpoint (advisory only — does NOT submit the test). The server records that the tab was closed mid-drain; the next time the student loads any page, a modal "your last test session was interrupted — recovering …" reconciles the state.
- **E3 — Server submit returns 409 (already submitted, e.g. server-timer beat the user).** Client navigates to review; no error shown to the student — the test is submitted.

**Edge cases:**
- Student opens the submit modal and lets it sit. → Modal stays open; timer keeps ticking visibly in the modal title; if timer hits 0 while the modal is open, the modal closes itself, US-5 takes over.
- Keyboard: ESC closes any modal back to the test. Enter on the confirm-submit modal does NOT submit (default-focused button is Cancel) — prevents one accidental keystroke from submitting.

---

### US-7 — Network blip / tab crash / two-device session recovery (S, system)

**As a** student whose internet drops for 30 s in the middle of the test (or whose tab crashes, or who accidentally opened the test on a second device), **I want** the system to never lose answers I've already entered, and to reconcile cleanly when I'm back online or back in the right tab.

**Acceptance Criteria:**

- [ ] Given the client detects no network for ≥ 5 s (failed heartbeat to `GET /api/test-sessions/{session_id}/heartbeat` every 15 s), when the offline state is entered, then a non-blocking top banner appears: "you're offline — your answers are being saved locally and will sync when you're back". Timer keeps ticking (client-side); inputs keep working.
- [ ] Given the client is offline, when the student answers a question, then the action is queued in IndexedDB exactly as if online; the palette cell repaints; no error.
- [ ] Given the network returns, when the next heartbeat succeeds, then the offline banner clears and the queued actions drain to the server in `action_seq` order. A tiny "syncing N answers" pill briefly appears in the bottom-right (≤ 3 s).
- [ ] Given the tab crashes mid-test (browser closes unexpectedly), when the student reopens the browser and navigates to the dashboard, then the assigned test card shows status `IN_PROGRESS` with a `Resume` button. Clicking Resume reads the session from the server (whose state is at least as recent as the last successful PUT), warm-rehydrates from IndexedDB any unsynced actions, posts them, and renders the runtime with the merged state.
- [ ] Given the same session is opened in a second device (or second tab on the same browser), when the second client connects, then `GET /api/test-sessions/{session_id}` returns the session AND a `multi_device_warning: true` flag. The second client displays a blocking modal "this test is already open on another device — opening here will sync state but DO NOT answer questions from two places at once". Both clients then operate on the same session with last-write-wins per question via `action_seq`. (We do NOT lock the session to one device — students often switch from laptop to phone mid-test on flaky home WiFi.)
- [ ] Given the client clock is wrong (system clock skew ≥ 30 s at session start), when the session starts, then the displayed timer is computed from the server's `expires_at` and the server's `Date` header at START (see US-5 AC), not from the client's `Date.now()`. The timer's ticking interval can come from `setInterval` on the client, but the displayed value is derived from server-anchored math.

**Flow (happy path — network blip):**
1. Trigger: student is on Q_7, network drops mid-typing.
2. Step: 5 s pass with no successful heartbeat → offline banner appears.
3. Step: student finishes the question, clicks Save & Next; action queued locally.
4. Step: student answers Q_8.
5. Step: network returns at Q_9; banner clears; pending actions drain to server.
6. Outcome: server has Q_7 and Q_8 answers; palette shows green.

**Error paths:**
- **E1 — Client returns online but server rejects a sync due to schema mismatch.** Sync log shows the rejection; client surfaces "1 answer could not be saved — please re-enter Q_7" inline near Q_7 in the palette. NEVER silently drop.
- **E2 — IndexedDB is unavailable (private browsing / quota).** Per US-3 E3, in-memory fallback + persistent banner.
- **E3 — Server detects 3+ concurrent active devices on one session.** Logs a security event; no enforcement in v1 (we trust students); admin tool can flag for review later (out of scope).

**Edge cases:**
- 30 s offline + then student answers 3 questions + then submits before network returns. → Submit is queued with all 3 answers; the offline banner becomes "you're offline — please reconnect to submit your test"; submit fires on reconnect.
- Two-device race: student answers Q_5=A on device 1 at action_seq=42, then Q_5=B on device 2 at action_seq=43. → Server takes action_seq=43; final answer is B. Both devices' UIs eventually converge (next heartbeat refresh).

---

### US-8 — Student reviews the post-test response sheet (S)

**As a** student who has just submitted (or whose test was auto-submitted), **I want to** see what I answered vs what was correct, and for each wrong answer the diagnostic failure-mode card from the diagnostic-axis PRD §4 US-1, **so that** I know what to drill next.

**Acceptance Criteria:**

- [ ] Given the student has just submitted (or arrives at `/test/{session_id}/review` from the dashboard for an already-submitted test), when the page renders, then it shows: total score, per-section score, time used per section, and a question-by-question scrollable list.
- [ ] Given each question card on the review page, when it renders, then it shows: question statement (re-rendered KaTeX), student's answer, correct answer, time_seconds spent, visit_count, marked_for_review flag, the per-question score with marking-scheme breakdown (e.g. "+4 correct" / "−1 wrong" / "+2 partial"), and a "show solution" expand toggle.
- [ ] Given the question was answered incorrectly AND the question's `wrong_paths` has an entry matching the student's `landed_on_option` (per the diagnostic-axis PRD US-1 shared-normaliser rule), when the card expands, then the diagnostic failure-mode card from PRD-01 §4 US-1 is rendered with the failure mode chip and one-sentence label.
- [ ] Given the question is `provisional` status, when the diagnosis card renders, then it shows the "draft" badge per PRD-01 US-1 AC.
- [ ] Given the question was answered correctly but `time_seconds > authored_time_by_round[round_at_time] × 1.5`, when the card renders, then it shows a "right answer, slow path" badge per PRD-01 US-1.
- [ ] Given the question was left blank, when the card renders, then no diagnosis card is shown; instead a `Show solution` button reveals the model solution.
- [ ] Given the review page is opened, when the student is not the owner of the session, then `GET /api/test-sessions/{session_id}/review` returns 403; the page renders an "access denied" screen.
- [ ] Given the review page is read-only — the student cannot edit answers, cannot re-attempt from here. The "re-attempt" route is the dashboard's drill flow (US-3 in PRD-01), OUT of scope for this PRD.

**Flow (happy path):**
1. Trigger: submission completes; navigate to review.
2. Step: page renders summary at top + question list below.
3. Step: student scrolls; taps a wrong question to expand the diagnosis card.
4. Step: student reads the diagnosis; clicks "see similar drill" → US-3 flow in PRD-01 (out of scope here).
5. Outcome: student has a clear next-action.

**Error paths:**
- **E1 — `wrong_paths` is empty for the problem** (legacy problems before the diagnostic-axis PRD was implemented): card shows the correct answer + solution; no diagnosis card; small "diagnostics not yet available for this problem" line (per PRD-01 US-1 E3).
- **E2 — Server returns 5xx on review fetch.** Spinner with retry button; NEVER show a half-rendered review.
- **E3 — Submit succeeded but scoring is still being computed asynchronously** (rare — only if the scoring batch is slow): the review page shows the answer-by-answer detail but a top banner "your score is being calculated — refresh in a minute". Score is hidden until ready.

**Edge cases:**
- Student opens review on a phone (< 768 px). → Layout collapses to single-column: summary at top, then per-question cards stacked. KaTeX renders at responsive size. Diagnosis cards are tap-to-expand. (Review IS supported on phone; the runtime is not.)

---

## 5. Non-Functional Requirements

### 5.1 Performance

| Requirement | Target | Measurement |
|---|---|---|
| Time to First Paint (cold, runtime route) | p50 ≤ 800 ms · p95 ≤ 1500 ms | Lighthouse CI on every commit; production RUM beacon. Reference profile defined in §0. |
| Time to Interactive (cold, runtime route) | p50 ≤ 1500 ms · p95 ≤ 2500 ms | Same; "interactive" verified by an integration test that clicks Q1 and asserts pane update within 100 ms. |
| Section switch (in-memory, no server call) | p95 ≤ 200 ms | Performance.mark before tab click → after palette repaint. |
| Question switch via palette click (warm cache) | p95 ≤ 100 ms | Same instrumentation. |
| Answer-save round-trip (online, p95) | ≤ 400 ms | PUT /api/test-sessions/.../snapshots/... latency, server-RUM. |
| Lighthouse Performance score (runtime route) | ≥ 90 | Lighthouse CI. |
| Bundle size (initial JS for runtime route, gzipped) | ≤ 200 KB | Next.js build report; CI fails over budget. |
| Memory ceiling (runtime, 4-hour session, 90 questions) | ≤ 300 MB heap | Chrome DevTools Memory profiler; manually verified pre-pilot. |

### 5.2 Accessibility

- WCAG 2.2 Level AA on the runtime route AND the review route (US-8).
- All input affordances must have visible focus rings (accent colour, 2 px, with a 1 px white inner halo for dark-on-dark).
- Keyboard-only navigation: Tab cycles palette grid → question pane → action buttons. Arrow keys navigate the palette. Space/Enter activates focused button. Numeric digits work as virtual-keypad input on NUM-INT and NUM-DEC questions (per US-3).
- Colour contrast ≥ 4.5:1 for all text. Palette colour codes have a non-colour secondary signal (subtle shape/icon) so red-green colour-blind students can distinguish ANSWERED from VISITED_NOT_ANSWERED (a filled check vs an empty circle).
- `prefers-reduced-motion` honoured: transitions reduce to 0 ms; no scale animations; instant state changes.
- 200% zoom usable (no horizontal scroll required, no input affordance clipped).
- Screen-reader: question statement, options, and timer are read in logical order. Palette grid is `role="grid"` with cells as `role="gridcell"` and `aria-label` describing question number + current status.

### 5.3 Security

- Auth: every `/api/test-sessions/*` endpoint requires a valid student session cookie. Mismatch between session-cookie `student_id` and the test session's `student_id` returns 403 (US-8 AC enforces this on the review page; the runtime endpoints enforce it analogously).
- Tests are fetched by `session_id`, NEVER by bare `question_code` from the client. The client never knows which question_codes are in the test until the server has verified the session and STARTED it.
- The `correct_answer` and `solution` fields on each problem are NEVER returned to the client during an active test session (PUT /api/test-sessions/.../snapshots/... echoes only the snapshot, not the answer). They are returned only on the review endpoint AFTER `submitted_at IS NOT NULL`.
- Session cookie is HttpOnly + SameSite=Lax + Secure (prod).
- CSRF: all state-changing endpoints require either a CSRF token in a custom header OR enforce SameSite=Lax + a same-origin check.
- Rate limit: `POST /api/test-sessions` (start) is rate-limited to 5 per minute per student. Snapshot PUTs are rate-limited to 30 per second per session (generous; protects against runaway client bugs).
- Audit log: every state-changing endpoint writes a row to `test_session_audit` with `(session_id, student_id, endpoint, action_payload_hash, client_ip, user_agent, server_timestamp)`. This is the table the admin tool reads.

### 5.4 Data-capture invariant (NON-NEGOTIABLE, per PROJECT CONTEXT §12 rule 5)

- Every question that has been visited (state ≠ NOT_VISITED at submission time) MUST produce exactly one row in `attempts` at submit time, with all four mandatory fields (`time_seconds`, `visit_count`, `marked_for_review`, `attempt_order`) populated.
- `attempt_order` is unique within (student_id, test_id) and is 1-indexed, contiguous, and reflects the order in which the student FIRST visited each question (not the order they answered).
- `time_seconds` is cumulative across all visits to the question (the runtime accumulates a per-question stopwatch; the stopwatch is paused on section switch but only insofar as the active-question stopwatch is paused — the global session timer keeps running).
- `visit_count` increments every time the student lands on the question from another question or from a section switch (NOT on every keystroke).
- `marked_for_review` is the final value at submit time.
- A telemetry write MUST succeed (locally to IndexedDB) before the UI advances state. The server PUT may lag; the local write may not. If the local write fails, the action is rejected and an error toast is shown.

### 5.5 Browser support

- Latest 2 versions of Chrome, Edge, Firefox, Safari (covers ≥ 95% of student devices per India browser-share data).
- Mobile Safari and Chrome on Android — only for dashboard + review (see Mobile breakpoints below). The runtime route on mobile shows a "please open this test on a laptop or tablet ≥ 768 px wide" screen with a `Continue anyway` escape hatch (because some students only have a phone — but the layout collapses gracefully; see §7.1).
- IE / legacy Edge: not supported.

### 5.6 Mobile breakpoints

- Dashboard + review: full responsive support from 360 px (smallest reasonable Android screen).
- Runtime: ≥ 768 px (tablet portrait minimum) for the full palette experience. At < 768 px, the runtime shows a warning AND falls back to a slimmer layout: question pane fills the screen, palette is behind a slide-in drawer triggered by a `Questions` button.
- The slimmer mobile layout is supported in v1 but is NOT the recommended path; the warning makes that clear.

### 5.7 Offline behaviour & reconnect (summary; details in US-7)

- IndexedDB queue persists answers and state across reload, tab crash, and offline windows.
- Server PUTs are retried with exponential backoff (5s, 10s, 20s, 40s, 60s cap).
- Submit blocks (with a visible drain message) until the queue is empty or 30 s have elapsed (then late-snapshots endpoint absorbs the rest as audit-only).
- Heartbeat every 15 s detects offline state within 5 s of disconnection.

### 5.8 Availability

- 99.5% target for the test-runtime route during pilot windows (10 AM – 10 PM IST). 0.5% downtime = ~3 hours per month; mitigated by scheduling tests in advance + the queue-and-resume mechanism (a 30 s server blip during a test is invisible to the student).

---

## 6. Out of Scope (this PRD)

- **Auth** (login, password reset, session refresh). Assumed to exist via `/api/auth/login` returning an HttpOnly session cookie. The runtime simply requires the cookie; auth UI is a separate scope.
- **Teacher test-builder UI.** Tests are assumed to already exist in the `tests` table with their ordered `question_codes` JSON, `duration_seconds`, and `marking_scheme`. The teacher-facing builder is a separate later PRD.
- **Admin tools and dashboards.** The runtime emits audit-trail records the admin tool can read; the tool itself is out of scope.
- **The problem-bank browser** (student searches/practises individual problems outside an assigned test). Drill flow (PRD-01 US-3) is referenced but its UI is out of scope of THIS PRD; only the entry-point from US-8's review page is in scope.
- **Bank-import workflow + jee-mcq skill emit.** Tests assume the bank already has the problems and the diagnostic axes (PRD-01) populated.
- **Marking-scheme engine.** Assumed to live server-side; the runtime POSTs `submit` and the server computes the score. The runtime displays the score on the review page; how the score is computed is not specified here.
- **Per-question diagnostic-axis rendering details.** PRD-01 §4 US-1 fully specifies the diagnosis card; this PRD only requires that US-8's review page hosts it.
- **Empirical-rating writeback** (nightly Python job). Out of scope; uses the same `attempts` rows the runtime writes.
- **Physics + Chemistry banks.** Layout supports multi-section, v1 ships with Maths only (matches the bank).
- **Test scheduling / availability windows.** The runtime reads `available_from` / `available_until` from the test row but the UI for setting these is teacher-builder scope.
- **Hot-swap of question content during an active session.** Once a session is STARTED, the question content is fixed; even if an admin edits a problem mid-pilot, in-flight sessions use the snapshot taken at START.

---

## 7. Visual Design Language (NotebookLM-grade clean)

The visual language is the bridge between "JEE Advanced muscle memory" (functional layout) and "NotebookLM-grade polish" (visual). Every decision below is concrete enough that two implementers cannot produce different output.

### 7.1 Typography ramp

- **Font family**: `Geist Variable` (open-source, geometric grotesque, ships from Vercel — pairs with Next 16 default config). Fallback chain: `Geist, "Inter Variable", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`.
- **Math font**: KaTeX defaults (KaTeX_Main + KaTeX_Math). Configured at 1.05em relative to the surrounding text to fix the optical-size mismatch.
- **Size ramp (rem, base 16 px):**

  | Level | Size | Line-height | Weight | Used for |
  |---|---|---|---|---|
  | `display` | 2.25 rem (36 px) | 1.2 | 500 | Test title on instructions page |
  | `h1` | 1.5 rem (24 px) | 1.3 | 500 | Section headers, modal titles |
  | `h2` | 1.25 rem (20 px) | 1.4 | 500 | Question number ("Question 7 of 18") |
  | `body-lg` | 1.125 rem (18 px) | 1.55 | 400 | Question statement (KaTeX-friendly) |
  | `body` | 1 rem (16 px) | 1.5 | 400 | Options, button labels, instructions text |
  | `caption` | 0.875 rem (14 px) | 1.4 | 400 | Section summary strip, time-spent metadata |
  | `micro` | 0.75 rem (12 px) | 1.3 | 500 (uppercase) | Status labels in palette legend |

  Five primary steps + 2 utility (display, micro). No other sizes.

### 7.2 Spacing scale

- 4 px base unit. Allowed values: `4, 8, 12, 16, 24, 32, 48, 64` px. No other values.
- Default gap between sibling elements within a card: 12 px.
- Default gap between sections of the page: 32 px.
- Default outer padding of major containers: 24 px (desktop), 16 px (mobile).

### 7.3 Colour tokens (light + dark mode pair from v1)

Defined as CSS custom properties; both modes are equal-priority (NotebookLM ships both; we will too).

**Neutrals (5):**

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--surface-0` | `#FFFFFF` | `#0F0F11` | Page background |
| `--surface-1` | `#F7F7F5` | `#16171A` | Card background, palette grid background |
| `--surface-2` | `#EAEAE6` | `#202125` | Subtle hover state, divider zones |
| `--border-subtle` | `#DEDED9` | `#2A2B30` | 1 px borders between cards and sections |
| `--text-secondary` | `#6B6B6B` | `#A0A0A6` | Caption, metadata, time-spent |

**Text on neutrals:**

| Token | Light | Dark |
|---|---|---|
| `--text-primary` | `#1A1A1A` | `#F3F3F0` |
| `--text-tertiary` | `#9A9A9A` | `#75757C` |

**One accent (calm blue — default; the user can override via §9 Open Q3):**

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--accent` | `#3754C5` | `#7E97F0` | Primary buttons, selected radio, focus ring, "Answered" palette colour |
| `--accent-subtle-bg` | `#3754C50A` | `#7E97F00A` (~4% opacity) | Selected-option row tint |
| `--accent-strong` | `#2A41A0` | `#9CB1F5` | Hover on primary button |

**Status colours for the question palette (the JEE Advanced convention, but desaturated to NotebookLM's calmer palette — see §9 Open Q5 for the user to confirm whether to use saturated JEE-standard colours or these calmer ones):**

| Status | Light fill | Light text | Dark fill | Dark text | Secondary signal (for colour-blind safety) |
|---|---|---|---|---|---|
| `NOT_VISITED` | `#FFFFFF` (border `--border-subtle`) | `--text-primary` | `#16171A` (border `--border-subtle`) | `--text-primary` | empty cell |
| `VISITED_NOT_ANSWERED` | `#E16D5B` (terracotta — softer than JEE red) | `#FFFFFF` | `#C4513E` | `#FFFFFF` | empty cell, terracotta fill |
| `ANSWERED` | `#3F8A5C` (muted green) | `#FFFFFF` | `#5BAF7A` | `#0F0F11` | filled checkmark icon top-right of cell |
| `MARKED_FOR_REVIEW` | `#7C5BC4` (muted purple) | `#FFFFFF` | `#9C81DA` | `#0F0F11` | small flag icon top-right of cell |
| `ANSWERED_AND_MARKED` | `#7C5BC4` (purple fill) | `#FFFFFF` | `#9C81DA` | `#0F0F11` | filled checkmark + flag icon (both visible) |

These five status colours are the ONLY chromatic colours in the runtime besides `--accent`. Everything else is neutral or accent.

### 7.4 Motion

- Default ease: `cubic-bezier(0.2, 0, 0, 1)` (NotebookLM-style: fast out, slow in, never overshoots).
- Default duration: 150 ms.
- Max duration anywhere in the UI: 200 ms.
- NO bounce, NO spring. The UI feels precise.
- All motion respects `prefers-reduced-motion: reduce` — durations collapse to 0 ms.

### 7.5 Component conventions

- **Buttons**: 36 px height for primary, 32 px for secondary. 12 px horizontal padding. 8 px border-radius. Primary = `--accent` fill, white text. Secondary = transparent fill, `--border-subtle` 1 px border, `--text-primary` text. Tertiary = transparent fill, no border, `--accent` text (used for "Clear Response"). Hover: `--accent-strong` for primary; `--surface-2` background for secondary. Focus: 2 px `--accent` ring + 1 px white halo (for dark-on-dark). Disabled: 50% opacity + `cursor: not-allowed`.
- **Inputs**: 40 px height. 12 px horizontal padding. 1 px border `--border-subtle`. Focus: 2 px `--accent` ring (no halo since input is on `--surface-0`). Invalid: 2 px `--accent-warning` (warning colour TBD by user — placeholder `#C45151`).
- **Cards**: `--surface-1` background, 1 px `--border-subtle` border, 12 px border-radius, NO shadow by default. Hover (clickable cards): `--surface-2` background. Selected (active question card in palette): 2 px `--accent` border.
- **Question palette grid**: 8-column grid (desktop). Each cell is 40 × 40 px. 4 px gap. Section header label is `caption` size, uppercased, `--text-secondary` colour. Current question's cell has a 2 px `--accent` outer ring (outside the cell, not inside).
- **Top-bar (runtime)**: 64 px tall, `--surface-0` background, 1 px bottom border. Left: test title (`h2` size, truncated with ellipsis at 480 px width). Centre: section tabs (each tab is 36 px tall, 16 px horizontal padding; active tab has `--accent` bottom border 2 px). Right: timer (mono-spaced font: `JetBrains Mono` or system mono fallback, `h1` size, `--accent` colour when ≥ 5 min remaining, `--accent-warning` when < 5 min, pulsing 1 Hz when < 1 min — pulse respects reduced-motion).
- **Toasts**: bottom-right corner, max-width 320 px, 12 px padding, `--surface-1` background, 1 px `--border-subtle` border, 8 px border-radius, fade-in 150 ms. Auto-dismiss after 3 s for info, 6 s for warning, never for error (user-dismiss).
- **Modals**: centred, max-width 480 px, `--surface-0` background, 16 px border-radius, 32 px padding, backdrop is `#0008` (50% black). Open and close with the 150 ms ease.

### 7.6 What this is explicitly NOT (the anti-pattern guard)

- No gradient buttons.
- No teal/cyan banner (this is the current portal's tell; we are replacing it).
- No dark sidebar with sharp icons.
- No drop-shadow stack greater than a subtle 1 px border. No `box-shadow: 0 4px 20px rgba(0,0,0,0.2)` carpet-bombing.
- No Bootstrap form defaults (rounded-pill green/red buttons, etc.).
- No information density via coloured boxes. Density is achieved via typography weight and size.
- No more than ONE accent colour outside the palette status codes (which themselves are picked to feel cohesive, not loud).

---

## 8. Dependencies & Assumptions

### 8.1 Depends on (existing / scaffolded)

- **Next.js 16.2 + React 19.2 + Tailwind 4** — frontend is already scaffolded at `/Users/ms/Documents/jee_platform/frontend/`. App Router is the default.
- **NestJS backend** at `/Users/ms/Documents/jee_platform/backend/` with the Prisma schema in `prisma/schema.prisma` already covering `problems`, `students`, `tests`, `attempts`, `student_fingerprint_state`. No schema change is needed to ship the runtime — the `attempts` table already has all four mandatory capture fields.
- **PostgreSQL** as the DB; the in-test snapshot table (see §0 Glossary) is a NEW table introduced by this PRD — see §8.3.
- **KaTeX 0.16+** for math rendering (peer dependency — frontend currently doesn't have it; will be added).
- **Existing auth** — assumed `/api/auth/login` exists and returns an HttpOnly session cookie. The runtime trusts this cookie.

### 8.2 Backend API surface required (the Architect will design these; PM specifies the shape)

| Method + path | Purpose | Request | Response |
|---|---|---|---|
| `GET /api/dashboard/tests` | List tests assigned to the authenticated student. | — | `[{test_id, title, subjects, duration_seconds, marking_scheme_summary, available_from, available_until, status, session_id?}]` |
| `POST /api/test-sessions` | Start a new session for a test in `OPEN` status. | `{test_id}` | `201 {session_id, started_at, expires_at}` OR `409 {existing_session_id}` |
| `GET /api/test-sessions/{session_id}` | Read session state (resume / multi-device sync). | — | `{session_id, test_id, started_at, expires_at, submitted_at, sections:[{section_id, subject, questions:[{question_code, statement, answer_type, figure_url?, ...}], marking_scheme}], snapshots:[{question_code, answer_payload, marked_for_review, time_seconds, visit_count, action_seq, last_action_at}], multi_device_warning}` |
| `PUT /api/test-sessions/{session_id}` | Lifecycle action (action ∈ {START, EXTEND-HEARTBEAT}). START sets `started_at`. | `{action}` | `200 {session_state}` |
| `PUT /api/test-sessions/{session_id}/snapshots/{question_code}` | Persist an attempt snapshot for one question. | `{answer_payload, marked_for_review, time_seconds_delta, visit_count, action_seq, client_timestamp_ms}` | `200 {persisted_action_seq, server_timestamp}` |
| `GET /api/test-sessions/{session_id}/heartbeat` | Liveness ping (used to detect offline). | — | `200 {server_now}` |
| `POST /api/test-sessions/{session_id}/submit` | Final submit. Idempotent. | `{auto_submit, client_final_state_hash}` | `200 {submitted_at, attempt_ids:[...]}` OR `409 {already_submitted_at}` |
| `POST /api/test-sessions/{session_id}/late-snapshots` | Audit-only post-buzzer snapshots. | `[{question_code, answer_payload, action_seq, client_timestamp_ms}]` | `200 {recorded_count}` |
| `POST /api/test-sessions/{session_id}/abandon-warning` | Advisory: tab closed mid-drain. | — | `200 {}` |
| `GET /api/test-sessions/{session_id}/review` | Post-submit review payload. Returns 403 if not owner; returns 425 Too Early if not yet submitted. | — | `200 {summary, per_question:[{question_code, statement, your_answer, correct_answer, score_delta, time_seconds, visit_count, marked_for_review, wrong_paths?, solution, status}]}` |

### 8.3 New backend table (Architect will model precisely)

**`test_session_snapshots`** — transient per-question state during an active session.

| Column | Type | Notes |
|---|---|---|
| `session_id` | BigInt | FK to `test_sessions` |
| `question_code` | String | FK to `problems` |
| `answer_payload` | JSONB | shape depends on answer_type (see US-3) |
| `time_seconds` | Int | cumulative |
| `visit_count` | Int | ≥ 1 |
| `marked_for_review` | Boolean | |
| `action_seq` | BigInt | monotonic per session |
| `last_action_at` | DateTime | server clock |
| PK | (session_id, question_code) | one row per Q per session |

At submit time, the server reads from this table to produce one `attempts` row per visited question. After submit, the snapshots row is kept for audit / debug for 30 days, then purged.

**`test_sessions`** — the session header.

| Column | Type | Notes |
|---|---|---|
| `id` | BigInt PK | |
| `test_id` | BigInt FK | |
| `student_id` | BigInt FK | |
| `started_at` | DateTime nullable | NULL until START action |
| `expires_at` | DateTime nullable | `started_at + duration_seconds` |
| `submitted_at` | DateTime nullable | NULL until submit |
| `auto_submit_source` | Enum nullable | `null` / `client_timer` / `server_timer` |
| Unique constraint | (student_id, test_id) WHERE submitted_at IS NULL | prevents duplicate active sessions |

**`test_session_audit`** — append-only audit trail (per §5.3 audit log).

### 8.4 Assumes

- Existing `tests.question_codes` is a JSON array of question_code strings in the order the test should present them.
- Existing `tests.marking_scheme` is a JSON object whose shape is `{correct_marks, wrong_marks, partial_rules?, blank_marks}` — the runtime displays a 1-line summary on the dashboard card; the scoring engine on the server uses this object verbatim.
- All problems referenced by `tests.question_codes` exist in `problems` with `wrong_paths` and `solution` populated.
- Problems are immutable from the moment a session STARTs to the moment it submits (the server snapshots the problem content into the session payload at START; admins editing problems mid-session does NOT affect in-flight sessions).
- The diagnostic-axis fields (`err_reading`, `err_case`, `err_comp`, `err_strategy`, `err_parsing` on each `wrong_paths` entry) are populated for problems that have been through the diagnostic-axis tagging pipeline (PRD-01). For problems without them (legacy), the review page shows the no-diagnostics-available line per US-8 E1.
- The bank size at v1 ship is ≤ 1000 problems and a single test has ≤ 100 questions (so the in-memory warm-cache fits comfortably).
- The pilot will have ≤ 50 concurrent students (PROJECT CONTEXT §8 Stage 10). The runtime is built for this load; scaling to 100k students is a separate phase per PROJECT CONTEXT §10.

---

## 9. Open Questions

Numbered; each open question blocks Stage 2 only on the dimensions noted. Items not blocking Stage 2 are flagged "deferred".

1. **Subjects in v1.** The bank is Maths-only today (~159 problems). The runtime UI must accommodate Physics + Chem in future without redesign (section tabs are first-class). **Decision needed: does v1 ship with the section-tabs visible-but-with-only-Maths-active, OR with section tabs hidden until a multi-subject test exists?** Recommendation: SHOW the tabs even with one subject, so students learn the affordance from day 1. (Blocks: visual design final lock.)

2. **Marking scheme defaults.** JEE Advanced standard is +4/−1 for MCQ-SC, +4/+3/+2/+1 partial for MCQ-MC, +4/0 for NUM-INT/NUM-DEC, +3/−1 for MAT-COL. Recent papers vary. **Decision needed: confirm the exact `marking_scheme` JSON shape MS wants stored on `tests`** (the runtime only displays a 1-line summary, but the server-side scoring engine — separate scope — must be told). Recommendation: use the 2023-paper conventions above as the platform default; teacher can override per test. (Blocks: dashboard card text + review page score breakdown — minor.)

3. **Accent colour.** Default in §7 is `#3754C5` (calm blue, NotebookLM-ish). **Decision needed: does MS prefer the warm-orange option (`#D4732A`) instead?** Either works; tone is the call. (Blocks: design lock-in.)

4. **Font choice.** §7 specifies Geist Variable. Alternative: Inter Variable (mature, ubiquitous, no Vercel branding). **Decision needed: Geist or Inter?** Both are open-source. (Blocks: design lock-in.)

5. **Palette status colours: saturated JEE-standard or calmer NotebookLM-ish?** §7.3 ships the calmer version (terracotta / muted green / muted purple). The trade-off: saturated standard colours give stronger exam-day muscle-memory match; calmer colours match the NotebookLM visual language. **Recommendation: ship calmer; expose a one-flag preference in settings later if students complain.** (Blocks: nothing critical, but worth user confirmation.)

6. **Mobile runtime stance.** §5.6 says "≥ 768 px recommended; `< 768 px` shows a warning + slimmer fallback". **Decision needed: is the warning hard-block (no continue button) or soft-block (with escape hatch)?** Recommendation: soft, because some students only have a phone and a hard block is hostile. (Blocks: nothing critical.)

7. **Server-side auto-submit cadence (US-5).** §AC specifies a 30 s scheduled job. **Decision needed: confirm 30 s is acceptable, or tighten to 10 s.** Tighter = more accurate auto-submit on tab-throttle; looser = less DB load. Recommendation: 30 s for pilot; revisit on evidence. (Blocks: nothing critical; Architect picks if user doesn't weigh in.)

8. **Late-snapshots policy.** US-5 E1 and US-6 E1 specify that post-buzzer answers go to a separate `late-snapshots` endpoint that records them BUT does NOT score them. **Decision needed: is the "audit only, not scored" policy what MS wants?** Alternative: score them if they arrive within 30 s of buzzer, otherwise audit only. (Blocks: nothing critical; affects fairness perception.)

9. **Multi-device policy (US-7).** §AC currently ALLOWS multi-device with a warning modal and last-write-wins reconciliation. **Decision needed: is "allow + warn" right, OR should the runtime hard-block a second device from doing anything but read-only resume?** Recommendation: allow + warn for v1; tighten later if abuse is observed. (Blocks: nothing critical.)

10. **Pre-test instructions content.** §US-2 specifies the structure of the instructions page. **Decision needed: does MS have a standard set of instructions text he wants used (perhaps from his current portal), or do we draft them?** (Blocks: instructions page copy — but not engineering.)

11. **Telemetry beacon endpoint.** §3.1 mentions a "one-pixel beacon" for TTFP/TTI aggregation. **Decision needed: do we self-host the beacon (extra backend route), or pipe to an existing service (Vercel Analytics, Plausible, custom)?** Recommendation: self-host a minimal `POST /api/rum` endpoint for pilot; no third-party tracker. (Blocks: nothing critical; Architect's call if user doesn't weigh in.)

---

## Appendix A: Wireframe sketch (text description for the Architect / UX Auditor)

**`/dashboard` (assigned tests list):**

```
┌──────────────────────────────────────────────────────────────────────────┐
│  [logo]  jee_platform                       [student name] [▾ menu]       │  ← 64 px top-bar
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   Your tests                                                             │  ← display size
│                                                                          │
│   ┌────────────────────────────────────────────────────────────────────┐ │
│   │  PILOT MOCK MATHS — JUN 28                                         │ │
│   │  Mathematics · 1 hour · +4/−1, partial on MCQ-MC                    │ │  ← body size, --text-secondary
│   │                                                                    │ │
│   │  Opens in 02:14:35                          [Start  →]  (disabled) │ │
│   └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│   ┌────────────────────────────────────────────────────────────────────┐ │
│   │  WEEKLY DRILL — INTEGRAL CALCULUS                                  │ │
│   │  Mathematics · 45 min · +4/−1                                       │ │
│   │                                                                    │ │
│   │  OPEN until 22:00 today                              [Start  →]    │ │
│   └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

**`/test/{session_id}/run` (runtime — the heart of this PRD):**

```
┌──────────────────────────────────────────────────────────────────────────┐
│  [logo]  PILOT MOCK MATHS    [Mathematics ▼]              02:47:12   [Submit Test] │
│                              (only one tab in v1 — but the tab affordance is there) │
├──────────────────────────────────────────────────────────────────┬───────┤
│                                                                  │       │
│   Question 7 of 18                                               │  Q1 ✓ │
│   ──────────────                                                 │  Q2 ✓ │
│                                                                  │  Q3   │
│   Let z be a complex number satisfying  |z − 1| = |z − i|.       │  Q4 ✓ │
│   The minimum value of |z − 2 + 3i| is …                         │  Q5 ⚑ │
│                                                                  │  Q6 ✓ │
│   [LaTeX-rendered statement]                                     │  Q7 ◯ │  ← current question, 2 px accent ring
│                                                                  │  Q8   │
│   ┌────────────────────────────────────────────────────────────┐ │  Q9   │
│   │ Numerical answer                                           │ │  Q10  │
│   │ ┌──────────────────┐  [virtual keypad below]               │ │  ...  │
│   │ │ 2.83             │                                       │ │  Q18  │
│   │ └──────────────────┘                                       │ │       │
│   │ Decimal — up to 2 decimal places                           │ │  ───  │
│   └────────────────────────────────────────────────────────────┘ │  Legend:│
│                                                                  │  ✓ Answered (green)│
│   [Save & Next] [Save & Mark for Review & Next]                  │  ⚑ Marked (purple) │
│   [Mark for Review & Next] [Clear Response]                      │  ◯ Visited / not ans. (red) │
│                                                                  │  (blank) Not visited │
│   Answered: 4 · Marked: 1 · Visited not answered: 1 · Not vis.: 12│       │
│                                                                  │       │
└──────────────────────────────────────────────────────────────────┴───────┘
                  centre-left question pane              right-rail palette
```

**Submit confirm modal (first of two):**

```
                  ┌────────────────────────────────────────────┐
                  │  Submit your test?                          │
                  │                                             │
                  │  Mathematics                                │
                  │  ──────────                                 │
                  │  Answered                       11          │
                  │  Marked & Answered               2          │
                  │  Marked for Review               1   ⚠      │
                  │  Visited but not answered        3   ⚠      │
                  │  Not visited                     1   ⚠      │
                  │                                             │
                  │  Time remaining: 14:22                      │
                  │                                             │
                  │  ⚠ You have 5 questions you haven't answered│
                  │     yet. Review before submitting?          │
                  │                                             │
                  │       [ Continue test ]    [ Submit now ]   │
                  └────────────────────────────────────────────┘
```

---

*End of PRD draft v1.*
