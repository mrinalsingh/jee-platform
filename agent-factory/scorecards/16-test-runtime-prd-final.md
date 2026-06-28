# PRD: Student Test-Taking Runtime — JEE-Advanced-style CBT with NotebookLM polish

**Stage:** 1 (Spec Loop) | **Iteration:** v2 | **Author:** Product Manager (generator)
**Reviewed by:** Spec Critic (v1 review consumed; v2 awaiting) | **Scope window:** the in-browser experience a student goes through from sign-in landing through pre-test instructions through actively taking a test through post-test response review.

**v1 → v2 changelog (summary; details in-line below as `[UPDATED v2 — …]` tags):**

- **Blocker 1 fixed** — NUM-DEC rounding moved off `toFixed` to a shared `@jee/numeric-normalise` module backed by `decimal.js`; *plus* a v2 product fix: the NUM-DEC input control caps decimal digits at `answer.precision` at keystroke time. See §0 Glossary, §4 US-3, §5.1, §5.4, §10.
- **Blocker 2 fixed** — Figure URLs replaced with opaque per-session signed tokens; new endpoint `GET /api/test-sessions/{id}/figures/{signed_token}`. See §5.3, §8.2.
- **Blocker 3a fixed** — Assignment model added: `cohorts`, `cohort_members`, `test_assignments` with `(cohort_id XOR student_id)` CHECK. See §4 US-1, §8.3.
- **Blocker 3b fixed** — `marking_scheme` JSONB shape canonically specified, JEE-Adv 2023+ defaults, configurable per-test. See §4 US-1, §8.2, §8.3, §8.4.
- **Blocker 3c fixed** — Anti-cheat: 3-violation hybrid auto-submit (Vision Update §3); new US-9. See §4 US-9, §5.3, §5.9.
- **Vision Update folded in:**
  - **NEW US-10 — Hints during the test** (Vision Update §4). See §4 US-10, §5.3, §8.2.
  - **`is_beyond_syllabus` server-side exclusion** for student role (Vision Update §5). See §5.4, §4 US-1, §4 US-3.
  - **Extended `AnswerType` enum** future-proofing (Vision Update §10). See §4 US-3, §8.4.
  - **Parent role** placeholder noted in §6 Out of Scope.
- Non-blockers 6–11 from critic addressed (late-snapshots window, multi-device modal copy, idempotency rule, `attempt_order` vs `visit_index_in_test` split, weasel-words tightened, §5.4 IndexedDB-or-fallback wording).

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
- **`@jee/numeric-normalise`** — `[UPDATED v2 — Blocker 1]` Shared internal package (path: `lib/numeric.ts` at the monorepo root, published to the workspace as `@jee/numeric-normalise`) exposing `roundHalfToEven(value: string | number, precision: int): string`. Implementation uses `decimal.js` with `Decimal.ROUND_HALF_EVEN`; returns a canonical string (no trailing zeros stripped — `"2.00"` not `"2"`). The same module is imported by (1) the YAML importer (`backend/scripts/import-yaml.ts`), (2) the runtime answer-compare on the server, and (3) the diagnostic-axis wrong-path matcher. A CI test asserts byte-identical output for a 20-row fixture across all three call sites.
- **Signed figure token** — `[UPDATED v2 — Blocker 2]` An opaque, per-session, HMAC-signed string of the form `base64url(HMAC_SHA256(session_secret, session_id || "|" || slot_index)) || "." || base64url(slot_index)`. Issued in the START response; valid only while the session is active; invalidated on submit (server rotates `session_secret`).
- **Slot index** — `[UPDATED v2 — Blocker 2]` An integer 0..N-1 identifying a question's position within the test as the server serves it. The client only ever knows `slot_index`, NEVER the underlying `question_code`, during the active session.
- **Violation** — `[UPDATED v2 — Blocker 3c]` A detected anti-cheat event: tab-switch / window-blur / fullscreen-exit / right-click-attempt / copy-attempt / paste-attempt / devtools-keystroke. Each violation increments the session violation counter; the 3rd violation triggers auto-submit.

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

1. **Telemetry completeness** — fraction of `attempts` rows submitted by the runtime where all four mandatory capture fields (`time_seconds`, `visit_count`, `marked_for_review`, `attempt_order`) are non-null and consistent (visit_count ≥ 1, time_seconds ≥ 0, `attempt_order` is unique within the (student × question_code) tuple per PROJECT CONTEXT §6 — see also the new `visit_index_in_test` field per §5.4 below). **Target ≥ 99.5%.**
2. **Lossless-submit rate** — fraction of submitted tests where the count of `attempts` rows equals the count of distinct questions in the test's ordered question_codes list. **Target = 100%** (any deviation is a blocking bug).
3. **Disconnect-recovery rate** — among test sessions that experienced ≥ 1 network blip ≥ 5 s (detected by the client's heartbeat), fraction where all answers entered during the blip window were eventually persisted server-side by submission time. **Target ≥ 99.9%.**
4. **Submit-page bounce rate** — fraction of test sessions where the student reached the two-step submit confirm dialog but then closed the tab without completing. **Target ≤ 2%** (otherwise the confirm wording is scaring people).
5. **Section-switch ergonomics** — median time between a student clicking a section tab and the new section's question palette becoming clickable. **Target ≤ 200 ms** (in-memory section switch, no server round-trip).
6. **`[UPDATED v2 — Blocker 3c]` Violation-driven auto-submit rate** — fraction of pilot test sessions that ended via 3-violation auto-submit. **Target ≤ 1%** in pilot; if higher, the violation detector has too many false positives and the threshold/detection list needs tightening. Surfaced to teacher in the post-test report.

### 3.3 Guardrails (must NOT degrade — applies in both phases)

1. **Zero data loss on network blip.** Offline-write IndexedDB queue MUST drain before the submit confirm dialog is allowed to close successfully. If the queue cannot drain within 30 s after Confirm Submit is pressed, the dialog blocks with a "still saving N answers — do not close this tab" message until the queue drains, then auto-confirms.
2. **Zero submitted-test-with-missing-answers due to client bug.** Server-side validation on POST /api/test-sessions/{id}/submit rejects any submission where the count of attempt-snapshots on the server is less than the count of questions the student marked as ANSWERED in their submitted payload. The endpoint returns 409 with the diff; the client displays "your browser thinks you answered N questions but the server only saw M — reloading to reconcile" and re-syncs.
3. **No double-submission.** `[UPDATED v2 — non-blocker 8]` POST /api/test-sessions/{id}/submit is **first-write-wins idempotent on `session_id`**: the first successful call writes `submitted_at`, `auto_submit_source`, and the `attempts` rows; subsequent calls return `200 {submitted_at, auto_submit_source, attempt_ids}` with the original values, NEVER overwrite, NEVER append new attempts.
4. **Auto-submit on timer = 0 within 1 s of true zero.** Even if the user's tab is throttled by the browser (background tab), the server-side timer expiry triggers an auto-submit independently (per US-5).
5. **`[UPDATED v2 — Blocker 3c]` Violations cannot lock a student out of an active test.** A non-3rd violation only adds a banner + audit row; inputs remain usable. Only the 3rd violation triggers the auto-submit flow.

---

## 4. User Stories

### US-1 — Student signs in and starts an assigned test (S) `[UPDATED v2 — Blocker 3a]`

**As a** student, **I want to** sign in, see the tests assigned to me, and start the one whose start window is open, **so that** I'm sitting in front of the question palette within 30 seconds of opening the browser.

**Acceptance Criteria:**

- [ ] Given the student is unauthenticated, when they hit any route under `/test/*`, then they are redirected to `/login` and after successful login redirected back to the originally requested route.
- [ ] Given the student is authenticated, when they open `/dashboard`, then the dashboard shows a list of tests assigned to them with: title, subject(s), duration, marking-scheme summary (one line: e.g. "+4 / −1, partial on MCQ-MC"), `window_start_at`, `window_end_at`, and a status badge (`UPCOMING`, `OPEN`, `IN_PROGRESS`, `SUBMITTED`, `EXPIRED`).
- [ ] `[UPDATED v2 — Blocker 3a]` Given the assignment model: the dashboard query reads from `test_assignments` and produces the union of two sources: (a) rows where `cohort_id IS NOT NULL` joined to `cohort_members ON cohort_id` where `cohort_members.student_id = me`, AND (b) rows where `student_id = me`. The two sets are UNIONed and DEDUPLICATED on `test_id` (if a student is in a cohort AND has an individual assignment for the same test, they see ONE row, not two; the earlier-written assignment wins for tracking the assigned_at/by fields). The filter applied is `window_start_at ≤ now() < window_end_at AND status NOT IN ('SUBMITTED', 'EXPIRED')`.
- [ ] `[UPDATED v2 — Vision Update §5]` Given the assembled test contains any problem with `is_beyond_syllabus = true` (or `syllabus_status = 'BEYOND_SYLLABUS'`), when the requesting role is `student`, the server rejects assembly with `422 {error: "beyond_syllabus_problem_in_assigned_test", offending_problem_count: N}` and the dashboard hides the test with an audit row "test rejected for student exposure: beyond-syllabus content". Teachers/admins composing the test see them normally; this exclusion is enforced at the assignment-fulfilment + figure-fetch layers, not at compose time.
- [ ] Given a test in `OPEN` status (current time ∈ [`window_start_at`, `window_end_at`] and no prior submission exists for this student × test), when the student clicks `Start`, then the client calls `POST /api/test-sessions` with `test_assignment_id`, the server returns `{session_id, expires_at, marking_scheme}`, and the student is taken to the **Pre-Test Instructions** page (`/test/{session_id}/instructions`).
- [ ] Given a test in `IN_PROGRESS` status (a session exists for this student × test with `submitted_at IS NULL` and `expires_at > now()`), when the student clicks `Resume`, then they are taken directly to `/test/{session_id}/run` and the timer reflects the *server-side* `expires_at − now()`, not a fresh duration.
- [ ] Given a test in `UPCOMING` status, when the student clicks the card, then the Start button is disabled and a subtitle reads "opens in HH:MM:SS" (live countdown on the dashboard card).
- [ ] Given a test in `EXPIRED` or `SUBMITTED` status, when the student clicks the card, then they are taken to the post-test review page (US-8) — for `EXPIRED` only if an auto-submission record exists; otherwise the card reads "expired without submission, contact your teacher".

**Flow (happy path):**
1. Trigger: student opens browser, navigates to `https://app.jeeplatform.example/`.
2. Step: if unauthenticated → `/login` → enter email + password (auth is OUT of scope but the runtime assumes the existing `/api/auth/login` returns a session cookie).
3. Step: authenticated → `/dashboard`. Dashboard lists assigned tests (per the cohort+individual UNION above). Student sees today's mock at the top.
4. Step: student clicks `Start` → `POST /api/test-sessions` → on 201 response, navigate to `/test/{session_id}/instructions`.
5. Outcome: instructions page renders within 1 s of click.

**Error paths:**
- **E1 — Another active session exists.** `POST /api/test-sessions` returns 409 with `existing_session_id`. The client navigates to `/test/{existing_session_id}/run` (resume, not start fresh). NEVER lose progress to a misclick.
- **E2 — Session creation fails (server 5xx).** Toast: "could not start test — try again in 10 s". Button re-enables after 10 s. NEVER auto-retry silently — the student must know.
- **E3 — Token expired.** API returns 401 → redirect to `/login` with `?next=/dashboard`. After re-auth, return to dashboard, NOT into the test (re-auth invalidates any progress claim).
- **E4 — `[UPDATED v2 — Vision Update §5]` Assignment contains beyond-syllabus content.** Server returns 422 as above; dashboard hides the offending card with a tooltip "this test is being reviewed by your teacher; ask them about it". Audit row is written so the teacher's dashboard surfaces a recompose-this-test alert.

**Edge cases:**
- Student opens the same dashboard in two tabs and clicks `Start` in both within 100 ms. → Both calls hit the server; the server uses a unique constraint on `(student_id, test_id) WHERE submitted_at IS NULL` so the second call returns 409 with the first call's `session_id`. Both tabs end up in the same session (see US-7 for the two-device case).
- Network is offline at click-time. → Button shows a brief "no network" toast; nothing else changes. The student retries when network returns.
- `[UPDATED v2 — Blocker 3a]` Student is in two cohorts that have been assigned the same test. → The UNION-DEDUPE on `test_id` shows ONE card. The `assigned_by_teacher_id` shown is the earlier of the two assignments.

---

### US-2 — Student reads instructions and enters the test (S)

**As a** student, **I want to** see clear pre-test instructions (duration, marking scheme, palette colour code legend, section structure, what each button does), **so that** I don't waste exam-clock seconds learning the UI mid-test.

**Acceptance Criteria:**

- [ ] Given the student is on `/test/{session_id}/instructions`, when the page renders, then it shows: test title, duration, total questions, per-section breakdown (subject + question count + marking scheme), the palette colour-code legend (5 statuses with exact colour samples), a labelled diagram of the test runtime UI (palette, question pane, action buttons), and an "I have read and understood — Start Test" checkbox + button.
- [ ] `[UPDATED v2 — Blocker 3c]` The instructions page additionally shows an **Anti-Cheat Notice** block: "This is a proctored test. Right-click, copy, paste, and tab-switching are disabled. Three violations will auto-submit your test. Please close all other tabs before starting." with a 1-line summary of the detected events.
- [ ] `[UPDATED v2 — US-10]` The instructions page additionally shows a **Hints Notice** block: "Each question has 1–4 hints. Using a hint is logged and shown to your teacher. Hints are not solutions — they nudge you toward the idea."
- [ ] Given the student has not checked the "I have read" checkbox, when they click the Start Test button, then the button does nothing and the checkbox row briefly highlights (200 ms tinted background).
- [ ] Given the student checks the box and clicks Start Test, when the click is registered, then `PUT /api/test-sessions/{session_id}` sets `started_at = now()`, the server returns the test payload (ordered `slot_index → {statement, answer_type, figure_signed_tokens[], hint_count}`, marking_scheme, duration), the client warm-caches all problem statements in IndexedDB, requests fullscreen via `document.documentElement.requestFullscreen()` (US-9), navigates to `/test/{session_id}/run`, and the timer begins ticking from the *server-returned* `started_at + duration`. (The server is the clock authority; client display is a derived view.)
- [ ] `[UPDATED v2 — Blocker 2]` The START response NEVER contains `question_code` for any question, NEVER contains the `correct_answer` / `solution` / `wrong_paths` fields, and figures are referenced only by signed token (see §5.3 + §8.2).
- [ ] Given the student opens the instructions page and idles for ≥ 10 minutes without starting, when they return, then the page is unchanged (instructions don't expire until the test's `window_end_at` does — that's checked at Start Test click time).
- [ ] Given the test has only 1 section in v1 (Maths-only is the only case the bank currently supports), when the instructions page renders, then the section-structure block reads "1 section: Mathematics" with no defensive copy about Physics / Chemistry coming later (don't over-promise).

**Flow (happy path):**
1. Trigger: student arrives at `/test/{session_id}/instructions` from US-1 step 5.
2. Step: page shows instructions. Student reads. ~30–60 s.
3. Step: student checks "I have read" → button enables → student clicks Start Test.
4. Step: client calls `PUT /api/test-sessions/{session_id}` with action=START, gets back the full test payload (slot-indexed, no question_codes), warm-caches problem statements + figures (KaTeX-rendered HTML strings + figure tokens) to IndexedDB.
5. Step: client requests fullscreen + installs anti-cheat handlers (US-9).
6. Outcome: navigates to `/test/{session_id}/run`. Question 1 of section 1 is visible; timer is ticking; palette is fully rendered.

**Error paths:**
- **E1 — Server START call fails (5xx).** Modal: "couldn't start your test — please try again". Retry button. Student is NOT navigated forward until the call succeeds — otherwise the runtime has no `started_at`.
- **E2 — Test payload exceeds 5 MB (large bank with figures).** Client streams the payload; instructions page shows a progress bar with "preparing test … 47%". Page does NOT navigate until 100% (no partial-test attempts). Hard timeout 30 s → modal "test is unusually large — contact your teacher" + retry.
- **E3 — Session expired between instructions and click.** Server returns 410 Gone. Modal: "this test window has closed". Button to return to dashboard.
- **E4 — `[UPDATED v2 — Blocker 3c]` Browser denies fullscreen request** (rare; some embedded contexts). Inline banner above the timer: "your browser denied fullscreen — please retry in fullscreen or contact your teacher". Test still starts; a fullscreen-denied audit row is written; the violation counter is NOT incremented for the denial itself (it's not a student action), but every subsequent focus-loss IS counted normally.

**Edge cases:**
- Student reloads the instructions page after starting the test. → On reload, the client checks server session status; if `started_at IS NOT NULL`, redirect to `/test/{session_id}/run` (don't re-show instructions; once started, no going back).
- Student presses browser back from instructions to dashboard. → Allowed; session has not been STARTed so `started_at IS NULL`; the dashboard shows the test still as `OPEN` (not `IN_PROGRESS`).

---

### US-3 — Student answers questions across all five answer-types (S) `[UPDATED v2 — Blocker 1, Vision Update §10]`

**As a** student, **I want to** answer each of the five JEE Advanced answer-types — MCQ-SC, MCQ-MC, NUM-INT, NUM-DEC, MAT-COL — with the exact input affordance the official CBT uses, **so that** my muscle memory transfers directly to exam day.

**Acceptance Criteria — input affordances (one per answer-type):**

- [ ] **MCQ-SC**: 4 radio buttons (A, B, C, D), single-select. Click anywhere on the row (not just the radio circle) selects. Clicking the selected row again does NOT deselect — to deselect, the student must click "Clear Response". Selection is visible by: filled radio, row background tinted with the accent colour at 8% opacity, accent-coloured 2 px left border on the row.
- [ ] **MCQ-MC**: 4 checkboxes (A, B, C, D), multi-select. Click toggles. Selected rows tinted as above. Selection of ≥ 1 box puts the question in ANSWERED state. No upper limit on selections.
- [ ] **NUM-INT**: text input + on-screen virtual keypad (0–9, minus sign, backspace, clear) below the question. Physical keyboard works in parallel (input accepts `[0-9-]` only; other keys silently ignored). Range: −999 to 999 (per JEE Advanced convention). Negative sign accepted only at position 0. Input ≥ 4 characters in length triggers the existing JEE-Advanced "value too long, max 3 digits" inline warning; submission rejects values outside the range with the same inline warning.
- [ ] **NUM-DEC** `[UPDATED v2 — Blocker 1]`: text input + virtual keypad (0–9, decimal point, minus sign, backspace, clear). Physical keyboard accepts `[0-9.\-]`. Precision is `problems.answer.precision` (the field defined in the diagnostic-axis PRD §6 and Architect-input-notes §Requirement E).
  - **Input-side cap:** the keypad and the keydown handler REFUSE any keystroke that would extend the current value past `precision` decimal places. Example: if `precision = 2` and the field currently reads `2.83`, the next digit keystroke (whether physical or virtual) is a no-op; a 200 ms tinted-row highlight + a 2 s ghost-hint *"This problem allows 2 decimal places"* appears. The student MUST clear+retype to change the integer part or the existing decimal digits. This applies symmetrically to the minus sign (allowed only at position 0) and the decimal point (allowed only once).
  - **Paste-time enforcement:** a paste event that would result in > `precision` decimal places is truncated at `precision`; the 2 s ghost-hint is shown; the audit row records `paste_truncated: true` (helps debug "I pasted 3.14159 and it became 3.14").
  - **Storage normalisation (server side, belt-and-suspenders):** on Save, the value is normalised via `@jee/numeric-normalise.roundHalfToEven(value, precision)` (NOT `Number.prototype.toFixed`) before equality compare. This produces a byte-stable canonical string (e.g. `"2.83"`, `"-0.50"`). The SAME module is imported by the YAML importer (`backend/scripts/import-yaml.ts`) and the diagnostic-axis wrong-path matcher.
  - **CI test (mandatory before merge):** a 20-row fixture covering edge cases (`1.005` at p=2 → `"1.00"`; `1.015` → `"1.02"`; `-0.5` at p=0 → `"0"`; `2.5` at p=0 → `"2"`; `3.5` at p=0 → `"4"`; trailing-zero preservation) is asserted byte-equal across all three call sites (importer, runtime compare, diagnostic matcher). The CI gate fails if any site diverges by one byte.
  - **Because the input control prevents over-precision at typing time, the round-half-to-even step on Save is a no-op for any v1-produced answer.** It exists only to handle (a) legacy `attempts` data, (b) values arriving via the late-snapshots endpoint after a buzzer, (c) defence-in-depth against any client bug.
- [ ] **MAT-COL**: two-column layout. Left column lists List-I items (P, Q, R, S — 4 typical), right column lists List-II options (1, 2, 3, 4, 5 — JEE Advanced typically gives 5 options for 4 picks). Each List-I row has a dropdown OR a click-to-pair affordance (Architect chooses; both must satisfy the touch-target NFR). One List-II option may map to multiple List-I rows. ANSWERED = all List-I rows have a List-II selection (where "all" is the actual List-I row count from the problem data, not hardcoded 4 — `[UPDATED v2 — non-blocker 10]`).

**`[UPDATED v2 — Vision Update §10]` Future-proof answer-type interface:**

The runtime's answer-pane is built around an `AnswerControl` interface that exposes:
```ts
interface AnswerControl<T> {
  readonly answerType: AnswerType;            // enum incl. future values
  readonly value: T;                          // shape per answer_type
  readonly isAnswered: boolean;               // computed
  onChange(next: T, action: AttemptAction): void;
  validate(): { valid: true } | { valid: false; reason: string };
  serialize(): JsonValue;                     // becomes answer_payload
}
```
This abstraction lets the 5 supported types (MCQ-SC, MCQ-MC, NUM-INT, NUM-DEC, MAT-COL) ship in v1 AND the 5 deferred types (MCQ-PASSAGE, NUM-DIGIT, MAT-LIST, MCQ-AR, FILL — Vision Update §10) slot in later without re-architecting US-3. The runtime's `AnswerType` enum and the `answer_payload` JSONB shape on the snapshot row are forward-compatible: an unknown enum value is rendered as a hard error block (per the existing AC below), not a misrendered control.

**Acceptance Criteria — common to all types:**

- [ ] Given the student selects/enters an answer, when the value changes, then the local state updates synchronously, an IndexedDB write is queued with `(session_id, slot_index, answer_payload, action_seq=monotonic++, client_timestamp_ms)`, the question's palette cell switches to ANSWERED colour within 16 ms (next frame), and the server PUT call to `/api/test-sessions/{session_id}/snapshots/{slot_index}` is fired in the background.
- [ ] `[UPDATED v2 — Blocker 2]` All client→server endpoints address questions by `slot_index`, NEVER by `question_code`. The server maps `slot_index → question_code` internally and writes the snapshot.
- [ ] Given the server PUT call fails (network blip), when 5 s elapses, then the action is retried with exponential backoff (5s, 10s, 20s, 40s, 60s; cap 60s). The palette cell shows a tiny grey "sync pending" dot in the corner until the call succeeds. All actions during the blip are queued in order and replayed in order.
- [ ] Given the question is MCQ-MC and the student selects exactly 0 options after previously having ≥ 1, when the state updates, then the cell drops out of ANSWERED back to VISITED_NOT_ANSWERED (or ANSWERED_AND_MARKED → MARKED_FOR_REVIEW if it had been Marked).
- [ ] Given the question's `answer_type` enum is unrecognised by the client (forward-compat — bank adds a new type), when the question pane attempts to render, then it shows a hard error block ("unsupported question type; please contact your teacher") rather than rendering a misleading input.
- [ ] `[UPDATED v2 — Vision Update §5]` Given an `is_beyond_syllabus=true` problem somehow reaches the runtime (defence-in-depth; should be blocked at assembly time per US-1 AC), then the runtime refuses to render it and shows the same hard error block. This is an invariant: a student session never displays a `BEYOND_SYLLABUS` problem.

**Flow (happy path) — common shape:**
1. Trigger: question pane displays slot_n (the current question in the current section).
2. Step: student reads statement (KaTeX-rendered LaTeX + any figure SVG/PNG fetched via signed token).
3. Step: student interacts with the input affordance matching `answer_type`.
4. Step: client writes the action locally + posts to server (background); palette cell repaints.
5. Step: student clicks `Save & Next` → next question loads from the warm cache (no network round-trip) within 100 ms.
6. Outcome: question is ANSWERED, cell is green, next question is in focus.

**Error paths:**
- **E1 — Invalid numeric input** (e.g. `--5`, `1.2.3`, range overflow on NUM-INT): inline 1-line error below the input field, in the accent-warning colour. NEVER blocks navigation — the student can still Save & Next, but the value won't be accepted as ANSWERED until valid (palette cell stays VISITED_NOT_ANSWERED with a tiny red "invalid" dot). NOTE: `[UPDATED v2 — Blocker 1]` over-precision on NUM-DEC is no longer an E1 case — it is prevented at the keypad layer.
- **E2 — MAT-COL pairing incomplete**: Save is allowed; palette cell becomes VISITED_NOT_ANSWERED (NOT answered); inline hint `"answer all <N> rows to count as answered"` (where N is the actual row count) appears below the pane for 3 s. NEVER blocks navigation.
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
1. Trigger: student on slot_n is unsure.
2. Step: student types a partial NUM-INT value, then clicks `Save & Mark for Review & Next`.
3. Step: client persists answer + sets marked_for_review=true + advances to slot_{n+1}.
4. Step: student finishes the section, returns to slot_n via the palette.
5. Outcome: slot_n is editable; student updates the answer; cell colour updates accordingly.

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
- **E1 — Queue does not drain in 10 s.** Submit is fired anyway with the partial server-side state (what's already persisted). The client posts the un-drained queue as a separate `POST /api/test-sessions/{session_id}/late-snapshots` endpoint with a "post-buzzer" flag. `[UPDATED v2 — non-blocker 6]` Late snapshots arriving at the server within **5 s of true T = 0 (server-anchored)** ARE scored (this absorbs one network RTT + queue drain). Arrivals > 5 s after T = 0 are recorded but audit-only. Review page banner if the late path fired: "some answers may not have synced — they have been logged for review by your teacher".
- **E2 — Server submit returns 5xx.** Client retries with backoff. UI shows "submitting your test … " until success. NEVER navigate forward on a failed submit.
- **E3 — Server has already auto-submitted (server-timer beat the client).** Client submit returns 200 (NOT 409 — see §3.3 G3 first-write-wins) with the existing submission body; client navigates to review. No data is lost — the server-side submission used the latest snapshots.

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
- [ ] Given the student has any question in VISITED_NOT_ANSWERED state, when the first modal opens, then those questions are listed with a count and a per-question chip (slot 3, slot 7, slot 11 — displayed as "Q3, Q7, Q11" using their visual numbering) and a yellow banner "you visited but didn't answer these — review before submitting?".
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
- **E1 — Network drops during queue drain.** Confirm modal is replaced with "saving … (N answers remaining) — do not close tab". A countdown shows the 30 s patience window. After 30 s, the submit fires with the server's view; un-synced answers go to the late-snapshots endpoint per US-5 E1 (and are scored if within 5 s of true T = 0 — n/a here because manual submit is before T = 0, so all late arrivals are scored on best-effort basis until the server's submit-write succeeds).
- **E2 — Student closes the tab during drain.** Browser's `beforeunload` event fires a `navigator.sendBeacon` to a `POST /api/test-sessions/{session_id}/abandon-warning` endpoint (advisory only — does NOT submit the test). The server records that the tab was closed mid-drain; the next time the student loads any page, a modal "your last test session was interrupted — recovering …" reconciles the state.
- **E3 — Server submit returns 200 with prior submitted_at (server-timer or other tab beat the user).** Client navigates to review; no error shown to the student — the test is submitted (per §3.3 G3 first-write-wins idempotency).

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
- [ ] Given the tab crashes mid-test (browser closes unexpectedly), when the student reopens the browser and navigates to the dashboard, then the assigned test card shows status `IN_PROGRESS` with a `Resume` button. Clicking Resume reads the session from the server (whose state is at least as recent as the last successful PUT), warm-rehydrates from IndexedDB any unsynced actions, posts them, and renders the runtime with the merged state. `[UPDATED v2 — Blocker 3c]` Resume after a crash does NOT increment the violation counter (a crash is not a deliberate violation).
- [ ] Given the same session is opened in a second device (or second tab on the same browser), when the second client connects, then `GET /api/test-sessions/{session_id}` returns the session AND a `multi_device_warning: true` flag. The second client displays a blocking modal `[UPDATED v2 — non-blocker 7]` with this exact copy: **"This test is open on another window or device. You can keep both open, but if you answer on both, only the most recent answer is saved. Continue here? [Continue] [Close this tab]"**. Both clients then operate on the same session with last-write-wins per question via `action_seq`. (We do NOT lock the session to one device — students often switch from laptop to phone mid-test on flaky home WiFi.)
- [ ] Given the client clock is wrong (system clock skew ≥ 30 s at session start), when the session starts, then the displayed timer is computed from the server's `expires_at` and the server's `Date` header at START (see US-5 AC), not from the client's `Date.now()`. The timer's ticking interval can come from `setInterval` on the client, but the displayed value is derived from server-anchored math.

**Flow (happy path — network blip):**
1. Trigger: student is on slot_7, network drops mid-typing.
2. Step: 5 s pass with no successful heartbeat → offline banner appears.
3. Step: student finishes the question, clicks Save & Next; action queued locally.
4. Step: student answers slot_8.
5. Step: network returns at slot_9; banner clears; pending actions drain to server.
6. Outcome: server has slot_7 and slot_8 answers; palette shows green.

**Error paths:**
- **E1 — Client returns online but server rejects a sync due to schema mismatch.** Sync log shows the rejection; client surfaces `[UPDATED v2 — non-blocker 10]` an inline red banner directly above the question pane: *"1 answer could not be saved — please re-enter Q<N>"*, AND tints the palette cell red with an exclamation icon. NEVER silently drop.
- **E2 — IndexedDB is unavailable (private browsing / quota).** Per US-3 E3, in-memory fallback + persistent banner.
- **E3 — Server detects 3+ concurrent active devices on one session.** Logs a security event; no enforcement in v1 (we trust students); admin tool can flag for review later (out of scope).

**Edge cases:**
- 30 s offline + then student answers 3 questions + then submits before network returns. → Submit is queued with all 3 answers; the offline banner becomes "you're offline — please reconnect to submit your test"; submit fires on reconnect.
- Two-device race: student answers slot_5=A on device 1 at action_seq=42, then slot_5=B on device 2 at action_seq=43. → Server takes action_seq=43; final answer is B. Both devices' UIs eventually converge (next heartbeat refresh).

---

### US-8 — Student reviews the post-test response sheet (S)

**As a** student who has just submitted (or whose test was auto-submitted), **I want to** see what I answered vs what was correct, and for each wrong answer the diagnostic failure-mode card from the diagnostic-axis PRD §4 US-1, **so that** I know what to drill next.

**Acceptance Criteria:**

- [ ] Given the student has just submitted (or arrives at `/test/{session_id}/review` from the dashboard for an already-submitted test), when the page renders, then it shows: total score, per-section score, time used per section, and a question-by-question scrollable list.
- [ ] Given each question card on the review page, when it renders, then it shows: question statement (re-rendered KaTeX), student's answer, correct answer, time_seconds spent, visit_count, marked_for_review flag, `[UPDATED v2 — US-10]` `hints_used` count + which hint levels were revealed, the per-question score with marking-scheme breakdown (e.g. "+4 correct" / "−1 wrong" / "+2 partial"), and a "show solution" expand toggle.
- [ ] `[UPDATED v2 — Blocker 3c]` Given the session ended in a violation auto-submit, when the page renders, then the top banner is RED and reads "This test was auto-submitted after 3 anti-cheat violations. Your teacher has been notified." with a per-violation timeline below (timestamp + violation type).
- [ ] Given the question was answered incorrectly AND the question's `wrong_paths` has an entry matching the student's `landed_on_option` (per the diagnostic-axis PRD US-1 shared-normaliser rule using `@jee/numeric-normalise` for NUM-DEC compares), when the card expands, then the diagnostic failure-mode card from PRD-01 §4 US-1 is rendered with the failure mode chip and one-sentence label.
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

### US-9 — `[NEW v2 — Blocker 3c]` Anti-cheat enforcement (S, system)

**As a** teacher running a graded mock, **I want** the runtime to detect casual cheating and to auto-submit after a small number of violations, **so that** the test is meaningful as an assessment without proctoring software.

**Honest scope statement (NFR-grade — surface to user in instructions):** A web app CANNOT prevent all cheating. A second device, a printed answer slip, a person whispering — these are out of scope and cannot be addressed without proctoring software (a separate future project). This story makes casual cheating costly, not impossible.

**Detection mechanisms (the runtime installs these on START):**

1. **Tab / window switch** — `document.visibilitychange` event when `document.hidden === true`, AND `window.blur` event firing while the runtime tab is in foreground (focus loss to another app within the OS).
2. **Fullscreen exit** — `fullscreenchange` event when `document.fullscreenElement === null` after START requested fullscreen.
3. **Right-click** — global `contextmenu` event listener with `preventDefault()` AND increment-violation.
4. **Copy / cut / paste** — `oncopy` / `oncut` / `onpaste` event listeners on the runtime root with `preventDefault()` AND increment-violation. Paste is allowed inside numeric input fields (the existing US-3 paste handler filters and truncates); a paste detected on the question-pane statement / option text triggers a violation.
5. **Text selection** — CSS `user-select: none` on the question statement and option rows. (A select attempt is not a violation by itself; only the copy/cut/paste that follows it.)
6. **Devtools-open heuristics** — keystroke handlers for `F12`, `Ctrl+Shift+I`, `Cmd+Opt+I`, `Ctrl+U` (view source); `preventDefault()` + increment-violation. (NOTE: this does NOT actually prevent devtools — a user can open devtools via the browser menu. We log the keystroke as a strong signal, not a hard block.)

**Acceptance Criteria:**

- [ ] Given the runtime is active, when any of the above detection mechanisms fires, then the client (a) increments a local violation counter, (b) writes a row to `test_session_audit` via `POST /api/test-sessions/{session_id}/violations` with `{violation_type, violation_timestamp, was_active}` (`was_active = true` if the runtime page was the active tab at the time), and (c) displays a non-dismissible top banner: `"Violation N of 3 — <human-readable type> detected. Your test will be auto-submitted on the 3rd violation."` for 6 s (banner persists across question switches; auto-dismisses after 6 s but stays in the runtime's "violations" pill in the top-bar).
- [ ] Given the violation count reaches 3, when the 3rd violation fires, then the runtime: (a) locks input affordances (as in US-5), (b) drains the IndexedDB queue with the max-30-s rule, (c) posts `POST /api/test-sessions/{session_id}/submit` with `auto_submit=true, auto_submit_source='violation_threshold'`, (d) navigates to the review page where the red banner per US-8 displays.
- [ ] Given the runtime is loaded, when the violation count is < 3, then inputs remain fully usable; the violation banner does NOT block interaction (it is non-modal, positioned at the top, accessible via Tab, dismissable to the violations-pill view).
- [ ] Given a violation fires while the network is down, when the offline state is active, then the violation is queued to IndexedDB (same queue as snapshot writes); the counter is incremented immediately client-side; the audit row drains to the server when network returns.
- [ ] Given a violation fires concurrently with a snapshot write, when both are queued, then the `action_seq` ordering is preserved (the violation has its own monotonic-counter slot and is replayed in order).
- [ ] Given the teacher's post-test view (out of scope; this PRD only commits to writing the rows), when it reads `test_session_audit`, then every violation is visible with timestamp + type so the teacher can judge whether the auto-submit was warranted.
- [ ] `[UPDATED v2 — Vision Update §3]` The violation counter is per-session and resets to 0 only on a fresh session START (a Resume after crash retains the prior count; a crash is not a violation but the violations that happened before the crash still count).

**Flow (happy path — student stays focused):**
1. Trigger: student takes the test in fullscreen, doesn't switch tabs.
2. Outcome: zero violations; no banner; no audit rows; normal submit.

**Flow (3-violation auto-submit):**
1. Trigger: student tab-switches to look up a formula at T = 12 min.
2. Step: violation 1 banner appears; audit row written; counter = 1.
3. Step: student right-clicks at T = 14 min.
4. Step: violation 2 banner appears; audit row; counter = 2.
5. Step: student tries `Ctrl+Shift+I` at T = 18 min.
6. Step: violation 3 fires; runtime locks inputs; drains queue; auto-submits.
7. Outcome: review page renders with red "auto-submitted after 3 violations" banner + per-violation timeline.

**Error paths:**
- **E1 — False-positive concern.** Some Windows touchpads trigger phantom right-clicks; some screen readers trigger focus-loss events. The 3-violation threshold gives a buffer. Pilot rate is tracked via §3.2 Leading Indicator 6.
- **E2 — Browser denies the fullscreen request entirely.** Handled at US-2 E4 — test starts, every focus-loss is still counted normally.
- **E3 — Audit POST fails repeatedly.** The violation counter MUST NOT advance to 3 due to a server outage alone — the counter is client-anchored on detected events, but if the audit endpoint has been down for > 60 s, a yellow banner notes "we can't reach the audit server right now; your test is continuing normally" and the violations are flushed when the server returns.

**Edge cases:**
- Student answers a question via the on-screen virtual keypad (US-3) — this does NOT trigger any violation; the keypad lives inside the runtime root and the focus stays on the input field.
- Student uses the platform's built-in chat-with-teacher widget (NOT in v1 scope, but for forward-compat) — embedded iframes count as part of the runtime; focus shift to the iframe is NOT a violation.
- Student opens a second runtime tab — this is captured separately by the multi-device flag (US-7), not by the violation counter on tab 1. The second tab itself doesn't trigger a violation on tab 1.

---

### US-10 — `[NEW v2 — Vision Update §4]` Hints during the test (S)

**As a** student stuck on a question, **I want to** reveal a subtle hint that nudges me toward the idea without giving away the manoeuvre, **so that** I don't lose 8 minutes staring at a question I could have unblocked with a nudge.

**Honest scope statement:** Hints are AUTHORED per problem (Vision Update §4 — a separate `hints-authoring` Spec Loop produces them). For v1 ship, problems may have 0 hints (legacy bank entries); the runtime handles both cases gracefully.

**Acceptance Criteria:**

- [ ] Given the question pane is rendered, when the underlying problem has `hint_count > 0`, then a subtle text link `"Show hint (0 / N used)"` appears below the action buttons (NOT a primary CTA — small, `--text-secondary`, underlined on hover only).
- [ ] Given the student clicks `Show hint`, when the click registers, then the client calls `GET /api/test-sessions/{session_id}/questions/{slot_index}/hints/{next_level}` (where `next_level = current_hints_used + 1`), the server returns ONLY the L-th hint text (never the full ladder), the runtime displays it inline below the question statement in a tinted box (`--surface-2` background, `--text-secondary` text), and the link updates to `"Show hint (L / N used)"` or `"All hints revealed"` if L == N.
- [ ] Given a hint is revealed, when the reveal happens, then: (a) the snapshot row for this question increments `hints_used` by 1, (b) an audit row is written to `test_session_audit` with `(session_id, slot_index, action='hint_revealed', hint_level=L, timestamp)`, (c) the local IndexedDB queue is updated optimistically (palette unaffected — revealing a hint is independent of answer state), (d) the action contributes to the `attempts.hints_used` total at submit.
- [ ] Given hints are one-way: a revealed hint cannot be un-revealed within the session. The displayed hints accumulate as the student reveals more (L1 on top, then L2 below it, etc.) — the student can see all previously-revealed hints simultaneously.
- [ ] Given the question is unanswered AND no hints are revealed, when the student clicks Save & Next, then the action behaves normally — there is no hint-related modal or prompt.
- [ ] `[UPDATED v2 — Vision Update §4]` The runtime NEVER displays the full solution during the test; only authored hints (L1..LN). Solutions are revealed only on the review page (US-8) after submit.
- [ ] Given the problem has `hint_count = 0`, when the question pane renders, then the `Show hint` link is omitted entirely (no greyed-out link, no "no hints available" text — just nothing).
- [ ] Given the network is offline when the student clicks `Show hint`, when the call fails, then a 1-line toast "couldn't fetch hint — try again when you're back online" appears; the audit row is NOT written client-side (because we don't want to award credit for a hint the student never saw); `hints_used` is NOT incremented.

**Flow (happy path):**
1. Trigger: student is stuck on slot_5; problem has hint_count = 3.
2. Step: student clicks `Show hint (0 / 3 used)`.
3. Step: client fetches L1; tinted hint box appears below the statement; link becomes `Show hint (1 / 3 used)`.
4. Step: student reads, tries again, still stuck; clicks again.
5. Step: L2 appears below L1; link becomes `(2 / 3 used)`.
6. Step: student gets unstuck, answers the question.
7. Outcome: snapshot row records `hints_used = 2`; review page shows this.

**Error paths:**
- **E1 — Server returns 404 for the requested level** (e.g. data drift — `hint_count` says 3 but only 2 are stored). Toast: "this hint isn't available — please report to your teacher". Audit row NOT written; counter NOT incremented.
- **E2 — Server returns 410 Gone (session already submitted, hint requested after submit)** — should be impossible since the runtime is locked at submit, but defence-in-depth. Client navigates to review.

**Edge cases:**
- Student reveals all N hints and still gets the answer wrong. → Review page shows `hints_used = N` and the full diagnosis card per US-8. The fact that all hints were revealed and the answer is still wrong is itself a strong telemetry signal (Vision Update §4: "number-of-hints-used is a strong predictor of the IDEA-grasp signal").
- Student reveals 1 hint, then closes the tab without submitting, then resumes via US-7. → On resume, the warm-cache rehydrates the revealed hints from the server snapshot (server is source of truth for `hints_used` per slot); the runtime renders the L1 box on first display of slot_5 in the resumed session.

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
| `[UPDATED v2 — US-10]` Hint-fetch round-trip (online, p95) | ≤ 300 ms | GET /api/test-sessions/.../hints/... latency. |
| Lighthouse Performance score (runtime route) | ≥ 90 | Lighthouse CI. |
| Bundle size (initial JS for runtime route, gzipped) | ≤ 200 KB | Next.js build report; CI fails over budget. `[UPDATED v2 — Blocker 1]` `decimal.js` is tree-shaken to the minimal `roundHalfToEven` path (~12 KB gzipped); the full library is not bundled. |
| Memory ceiling (runtime, 4-hour session, 90 questions) | ≤ 300 MB heap | Chrome DevTools Memory profiler; manually verified pre-pilot. |

### 5.2 Accessibility

- WCAG 2.2 Level AA on the runtime route AND the review route (US-8).
- All input affordances must have visible focus rings (accent colour, 2 px, with a 1 px white inner halo for dark-on-dark).
- Keyboard-only navigation: Tab cycles palette grid → question pane → action buttons. Arrow keys navigate the palette. Space/Enter activates focused button. Numeric digits work as virtual-keypad input on NUM-INT and NUM-DEC questions (per US-3).
- Colour contrast ≥ 4.5:1 for all text. Palette colour codes have a non-colour secondary signal (subtle shape/icon) so red-green colour-blind students can distinguish ANSWERED from VISITED_NOT_ANSWERED (a filled check vs an empty circle).
- `prefers-reduced-motion` honoured: transitions reduce to 0 ms; no scale animations; instant state changes.
- 200% zoom usable (no horizontal scroll required, no input affordance clipped).
- Screen-reader: question statement, options, and timer are read in logical order. Palette grid is `role="grid"` with cells as `role="gridcell"` and `aria-label` describing question number + current status.
- `[UPDATED v2 — Blocker 3c]` The anti-cheat violation banner has `role="status"` and `aria-live="assertive"` so screen reader users hear it announced.
- `[UPDATED v2 — US-10]` The `Show hint` link has `aria-label="Reveal hint <L+1> of <N>"` and the revealed hint box has `aria-live="polite"` so screen reader users hear the new hint when it appears.

### 5.3 Security

- Auth: every `/api/test-sessions/*` endpoint requires a valid student session cookie. Mismatch between session-cookie `student_id` and the test session's `student_id` returns 403 (US-8 AC enforces this on the review page; the runtime endpoints enforce it analogously).
- Tests are fetched by `session_id`, NEVER by bare `question_code` from the client. The client never knows which question_codes are in the test until the server has verified the session and STARTED it — and **then only via `slot_index`, never by question_code, until after submit**.
- `[UPDATED v2 — Blocker 2]` **Figure URLs do NOT leak `question_code`.** Figures are served only via `GET /api/test-sessions/{session_id}/figures/{signed_token}` (see §8.2). Token construction: `HMAC_SHA256(session_secret, session_id || "|" || slot_index || "|" || figure_index)`. Token validity: from session START through session expiry (`expires_at` + a 5-minute audit grace). On submit, the server rotates `session_secret`, invalidating all outstanding tokens — even if a student has stashed signed URLs, they 401 after submit (so the URLs cannot be replayed in another browser session to fingerprint the bank). The endpoint validates the token, looks up `(session_id, slot_index, figure_index) → file_path`, and returns the figure bytes with `Content-Type: image/svg+xml` or `image/png` and NO metadata headers that reveal the underlying `question_code`. Solution figures (if `wrong_paths` or `solution` contains figures) are served via `GET /api/test-sessions/{session_id}/review-figures/{signed_token}` which 403s while `submitted_at IS NULL`.
- `[UPDATED v2 — Blocker 2]` The client payload (START response) NEVER contains: raw filesystem paths, `question_code`-derived URLs, or `question_code` strings. Question identity is exposed by `slot_index` only.
- The `correct_answer` and `solution` fields on each problem are NEVER returned to the client during an active test session (PUT /api/test-sessions/.../snapshots/... echoes only the snapshot, not the answer). They are returned only on the review endpoint AFTER `submitted_at IS NOT NULL`.
- `[UPDATED v2 — US-10]` Hint text is fetched lazily one level at a time. The full hint ladder is NEVER sent to the client up-front. The server returns only the requested level (and only if the requested level ≤ `hint_count` for the underlying problem AND `next_level == current_hints_used + 1` for the snapshot — sequence-skipping is rejected as 400).
- Session cookie is HttpOnly + SameSite=Lax + Secure (prod).
- CSRF: all state-changing endpoints require either a CSRF token in a custom header OR enforce SameSite=Lax + a same-origin check.
- Rate limit: `POST /api/test-sessions` (start) is rate-limited to 5 per minute per student. Snapshot PUTs are rate-limited to 30 per second per session (budget rationale `[UPDATED v2 — non-blocker 10]`: 5 input changes / s × 3 simultaneous active inputs × 2× headroom ≈ 30). Hint GETs are rate-limited to 1 per second per session (a higher rate suggests automation). Violation POSTs are NOT rate-limited (no legitimate reason to throttle — the threat is too many, and dropping audit rows is worse than over-recording).
- Audit log: every state-changing endpoint writes a row to `test_session_audit` with `(session_id, student_id, endpoint, action_payload_hash, client_ip, user_agent, server_timestamp)`. Plus the new violation-specific columns `(violation_type, hint_level)` `[UPDATED v2 — Blocker 3c, US-10]`. This is the table the admin tool reads.

### 5.4 Data-capture invariant (NON-NEGOTIABLE, per PROJECT CONTEXT §12 rule 5)

- Every question that has been visited (state ≠ NOT_VISITED at submission time) MUST produce exactly one row in `attempts` at submit time, with all four mandatory fields (`time_seconds`, `visit_count`, `marked_for_review`, `attempt_order`) populated.
- `[UPDATED v2 — non-blocker 9]` **`attempt_order` reconciliation:** PROJECT CONTEXT §6 defines `attempt_order` as the **N-th time this student has ever attempted this question_code (across all tests, cumulative)**. The runtime computes this server-side at submit by counting prior `attempts` rows for `(student_id, question_code)` and assigning `attempt_order = count + 1` to the new row. The runtime ALSO writes a separate column `visit_index_in_test` (1-indexed, contiguous within the test, reflecting the order of first visit by the student during this session) for the runtime-defined order — added to the `attempts` table per Architect spec. Both fields are populated at submit; neither is null. The empirical-ratings batch reads `attempt_order`; the post-test review (US-8) reads `visit_index_in_test`.
- `time_seconds` is cumulative across all visits to the question (the runtime accumulates a per-question stopwatch; the stopwatch is paused on section switch but only insofar as the active-question stopwatch is paused — the global session timer keeps running).
- `visit_count` increments every time the student lands on the question from another question or from a section switch (NOT on every keystroke).
- `marked_for_review` is the final value at submit time.
- `[UPDATED v2 — US-10]` `hints_used` is the count of hints revealed across the session for this question (0 if none); included in the `attempts` row at submit.
- `[UPDATED v2 — non-blocker 11]` A telemetry write MUST be durably queued — IndexedDB if available, in-memory fallback otherwise (with the US-3 E3 banner) — before the UI advances state. The server PUT may lag. If even the in-memory fallback is unavailable (impossible in practice), the write is rejected and an error toast appears.
- `[UPDATED v2 — Vision Update §5]` **Beyond-syllabus invariant:** for every problem served to a student during an active session, the server has verified `syllabus_status != 'BEYOND_SYLLABUS'`. This check is at three layers: (a) test-assembly time (US-1 AC), (b) figure-fetch endpoint, (c) hint-fetch endpoint. Teachers and admins are NOT subject to this filter (they need to compose tests that include them).

### 5.5 Browser support

- Latest 2 versions of Chrome, Edge, Firefox, Safari (covers the great majority of Indian student devices per public StatCounter India data Q1 2026; `[UPDATED v2 — non-blocker 10]` source: StatCounter Global Stats / India desktop + mobile combined, accessed 2026-06).
- Mobile Safari and Chrome on Android — only for dashboard + review (see Mobile breakpoints below). The runtime route on mobile shows a "please open this test on a laptop or tablet ≥ 768 px wide" screen with a `Continue anyway` escape hatch (because some students only have a phone — but the layout collapses gracefully; see §7.1).
- IE / legacy Edge: not supported.

### 5.6 Mobile breakpoints

- Dashboard + review: full responsive support from 360 px (smallest reasonable Android screen).
- Runtime: ≥ 768 px (tablet portrait minimum) for the full palette experience. At < 768 px, the runtime shows a warning AND falls back to a slimmer layout: question pane fills the screen, palette is behind a slide-in drawer triggered by a `Questions` button.
- The slimmer mobile layout is supported in v1 but is NOT the recommended path; the warning makes that clear.

### 5.7 Offline behaviour & reconnect (summary; details in US-7)

- IndexedDB queue persists answers and state across reload, tab crash, and offline windows.
- Server PUTs are retried with exponential backoff (5s, 10s, 20s, 40s, 60s cap).
- Submit blocks (with a visible drain message) until the queue is empty or 30 s have elapsed (then late-snapshots endpoint absorbs the rest as audit-only beyond the 5-s scoring window per US-5 E1).
- Heartbeat every 15 s detects offline state within 5 s of disconnection.

### 5.8 Availability

- 99.5% target for the test-runtime route during pilot windows (10 AM – 10 PM IST). 0.5% downtime = ~3 hours per month; mitigated by scheduling tests in advance + the queue-and-resume mechanism (a 30 s server blip during a test is invisible to the student).

### 5.9 `[NEW v2 — Blocker 3c]` Anti-cheat baseline

- Detection mechanisms enumerated in US-9 AC.
- **Threshold:** 3 violations → auto-submit. This is hard-coded for v1; future PRDs may make it configurable per-test (deferred).
- **Honest limitations:**
  - Cannot prevent a second device, a printed answer slip, a person whispering, screen-sharing to another laptop.
  - Cannot reliably detect devtools (only the keystroke open-paths; the menu path is undetectable).
  - Cannot prevent screenshots of the question pane.
  - Proctoring software is out of scope; this is browser-resident enforcement only.
- **Telemetry contract:** every violation writes one row to `test_session_audit`. Auto-submit on 3rd violation writes the trigger row with `auto_submit_source = 'violation_threshold'`. The teacher's post-test view (out of scope; this PRD only commits to the writes) surfaces these.

---

## 6. Out of Scope (this PRD)

- **Auth** (login, password reset, session refresh). Assumed to exist via `/api/auth/login` returning an HttpOnly session cookie. The runtime simply requires the cookie; auth UI is a separate scope.
- **Teacher test-builder UI.** Tests are assumed to already exist in the `tests` table with their ordered `question_codes` JSON, `duration_seconds`, and the assignment rows (`test_assignments`) written by the teacher's UI. The teacher-facing builder is a separate later PRD.
- **Admin tools and dashboards.** The runtime emits audit-trail records the admin tool can read; the tool itself is out of scope.
- **The problem-bank browser** (student searches/practises individual problems outside an assigned test). Drill flow (PRD-01 US-3) is referenced but its UI is out of scope of THIS PRD; only the entry-point from US-8's review page is in scope.
- **Bank-import workflow + jee-mcq skill emit.** Tests assume the bank already has the problems and the diagnostic axes (PRD-01) populated. `[UPDATED v2 — Vision Update §4]` Hint authoring is a separate Future PRD (`hints-authoring` agent — Vision Update §13 item 6); for v1, problems with no hints simply omit the `Show hint` link.
- **Marking-scheme engine implementation.** Assumed to live server-side; the runtime POSTs `submit` and the server computes the score using the `test_assignments.marking_scheme` JSONB (shape canonically defined in §8.4). The runtime displays the score on the review page; the engine's internals are not specified here.
- **Per-question diagnostic-axis rendering details.** PRD-01 §4 US-1 fully specifies the diagnosis card; this PRD only requires that US-8's review page hosts it.
- **Empirical-rating writeback** (nightly Python job). Out of scope; uses the same `attempts` rows the runtime writes.
- **Physics + Chemistry banks.** Layout supports multi-section, v1 ships with Maths only (matches the bank).
- **Test scheduling / availability windows UI.** The runtime reads `window_start_at` / `window_end_at` from the `test_assignments` row but the UI for setting these is teacher-builder scope.
- **Hot-swap of question content during an active session.** Once a session is STARTED, the question content is fixed; even if an admin edits a problem mid-pilot, in-flight sessions use the snapshot taken at START.
- **`[UPDATED v2 — Vision Update §1]` Parent dashboard** (read-only view of own child's data) — separate Future PRD per Vision Update §1 / §13 item 4.
- **`[UPDATED v2 — Vision Update §3]` Proctoring software / camera / screen-share monitoring.** The §5.9 honest-limits section documents what we can't catch. A real proctoring solution is a separate project.
- **`[UPDATED v2 — Vision Update §10]` The 5 deferred answer-types** (`MCQ-PASSAGE`, `NUM-DIGIT`, `MAT-LIST`, `MCQ-AR`, `FILL`). The `AnswerControl` interface in US-3 is built to accommodate them; the actual controls are deferred to a later PRD that pairs with the question-bank importer extension.
- **`[UPDATED v2 — Vision Update §6]` Post-test Excel report.** Out of scope for the runtime PRD; deferred to the Test-Results Spec Loop. The runtime emits the rows the report reads.
- **`[UPDATED v2 — Vision Update §7]` Personalised drill recommender API.** Deferred per Vision Update §13 item 5.

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

`[UPDATED v2 — Blocker 3c]` **Violation banner colour:** `--accent-warning` (placeholder `#C45151` until user confirms in §9 Open Q12); fills the top banner across the full runtime width at 56 px tall; the `Violation N of 3` text is white at `h2` size.

### 7.4 Motion

- Default ease: `cubic-bezier(0.2, 0, 0, 1)` (NotebookLM-style: fast out, slow in, never overshoots).
- Default duration: 150 ms.
- Max duration anywhere in the UI: 200 ms.
- NO bounce, NO spring. The UI feels precise.
- All motion respects `prefers-reduced-motion: reduce` — durations collapse to 0 ms.

### 7.5 Component conventions

- **Buttons**: 36 px height for primary, 32 px for secondary. 12 px horizontal padding. 8 px border-radius. Primary = `--accent` fill, white text. Secondary = transparent fill, `--border-subtle` 1 px border, `--text-primary` text. Tertiary = transparent fill, no border, `--accent` text (used for "Clear Response" and the new `Show hint` link). Hover: `--accent-strong` for primary; `--surface-2` background for secondary. Focus: 2 px `--accent` ring + 1 px white halo (for dark-on-dark). Disabled: 50% opacity + `cursor: not-allowed`.
- **Inputs**: 40 px height. 12 px horizontal padding. 1 px border `--border-subtle`. Focus: 2 px `--accent` ring (no halo since input is on `--surface-0`). Invalid: 2 px `--accent-warning` (warning colour TBD by user — placeholder `#C45151`).
- **Cards**: `--surface-1` background, 1 px `--border-subtle` border, 12 px border-radius, NO shadow by default. Hover (clickable cards): `--surface-2` background. Selected (active question card in palette): 2 px `--accent` border.
- **Question palette grid**: 8-column grid (desktop). Each cell is 40 × 40 px. 4 px gap. Section header label is `caption` size, uppercased, `--text-secondary` colour. Current question's cell has a 2 px `--accent` outer ring (outside the cell, not inside).
- **Top-bar (runtime)**: 64 px tall, `--surface-0` background, 1 px bottom border. Left: test title (`h2` size, truncated with ellipsis at 480 px width). Centre: section tabs (each tab is 36 px tall, 16 px horizontal padding; active tab has `--accent` bottom border 2 px). Right: timer (mono-spaced font: `JetBrains Mono` or system mono fallback, `h1` size, `--accent` colour when ≥ 5 min remaining, `--accent-warning` when < 5 min, pulsing 1 Hz when < 1 min — pulse respects reduced-motion). `[UPDATED v2 — Blocker 3c]` Adjacent to the timer: a `Violations: N/3` pill (only shown when N > 0, in `--accent-warning` colour) that opens a small tooltip of violation history on hover.
- **Toasts**: bottom-right corner, max-width 320 px, 12 px padding, `--surface-1` background, 1 px `--border-subtle` border, 8 px border-radius, fade-in 150 ms. Auto-dismiss after 3 s for info, 6 s for warning, never for error (user-dismiss).
- **Modals**: centred, max-width 480 px, `--surface-0` background, 16 px border-radius, 32 px padding, backdrop is `#0008` (50% black). Open and close with the 150 ms ease.
- `[UPDATED v2 — US-10]` **Hint box (revealed hint inline):** below the question statement; `--surface-2` background; 1 px `--border-subtle` border; 12 px padding; 8 px border-radius; `--text-primary` text at `body` size; a small `caption`-sized label `Hint 1` at top-left in `--text-secondary`. Multiple revealed hints stack vertically with 8 px gap.

### 7.6 What this is explicitly NOT (the anti-pattern guard)

- No gradient buttons.
- No teal/cyan banner (this is the current portal's tell; we are replacing it).
- No dark sidebar with sharp icons.
- No drop-shadow stack greater than a subtle 1 px border. No `box-shadow: 0 4px 20px rgba(0,0,0,0.2)` carpet-bombing.
- No Bootstrap form defaults (rounded-pill green/red buttons, etc.).
- No information density via coloured boxes. Density is achieved via typography weight and size.
- No more than ONE accent colour outside the palette status codes (which themselves are picked to feel cohesive, not loud).
- `[UPDATED v2 — US-10]` Hints are NEVER styled as a primary CTA — they are subtle links in `--text-secondary`. The runtime should not nudge the student to use hints; it should only make them available.

---

## 8. Dependencies & Assumptions

### 8.1 Depends on (existing / scaffolded)

- **Next.js 16.2 + React 19.2 + Tailwind 4** — frontend is already scaffolded at `/Users/ms/Documents/jee_platform/frontend/`. App Router is the default.
- **NestJS backend** at `/Users/ms/Documents/jee_platform/backend/` with the Prisma schema in `prisma/schema.prisma` already covering `problems`, `students`, `tests`, `attempts`, `student_fingerprint_state`. **Additional tables required by this PRD** are listed in §8.3.
- **PostgreSQL** as the DB; the in-test snapshot table (see §0 Glossary) is a NEW table introduced by this PRD — see §8.3.
- **KaTeX 0.16+** for math rendering (peer dependency — frontend currently doesn't have it; will be added).
- **`[UPDATED v2 — Blocker 1]` `decimal.js` 10.x** — peer dependency for `lib/numeric.ts`. Importer and runtime both consume it via the `@jee/numeric-normalise` workspace package. Frontend bundle uses tree-shaken import of `Decimal` + `ROUND_HALF_EVEN` only (~12 KB gzipped).
- **Existing auth** — assumed `/api/auth/login` exists and returns an HttpOnly session cookie. The runtime trusts this cookie.

### 8.2 Backend API surface required (the Architect will design these; PM specifies the shape)

| Method + path | Purpose | Request | Response |
|---|---|---|---|
| `GET /api/dashboard/tests` | List tests assigned to the authenticated student. `[UPDATED v2 — Blocker 3a]` Reads from `test_assignments` UNION-DEDUPE per US-1 AC. | — | `[{test_id, test_assignment_id, title, subjects, duration_seconds, marking_scheme_summary, window_start_at, window_end_at, status, session_id?}]` |
| `POST /api/test-sessions` | Start a new session for a test in `OPEN` status. | `{test_assignment_id}` | `201 {session_id, started_at, expires_at, marking_scheme}` OR `409 {existing_session_id}` |
| `GET /api/test-sessions/{session_id}` | Read session state (resume / multi-device sync). `[UPDATED v2 — Blocker 2]` Returns slot-indexed payload only; NO question_codes; figures by signed token. | — | `{session_id, test_id, started_at, expires_at, submitted_at, marking_scheme, sections:[{section_id, subject, slots:[{slot_index, statement, answer_type, figure_signed_tokens:[...], hint_count}]}], snapshots:[{slot_index, answer_payload, marked_for_review, time_seconds, visit_count, hints_used, action_seq, last_action_at}], multi_device_warning, violations_count}` |
| `PUT /api/test-sessions/{session_id}` | Lifecycle action (action ∈ {START, EXTEND-HEARTBEAT}). START sets `started_at`. | `{action}` | `200 {session_state}` |
| `PUT /api/test-sessions/{session_id}/snapshots/{slot_index}` `[UPDATED v2 — Blocker 2]` | Persist an attempt snapshot for one question (addressed by slot, not question_code). | `{answer_payload, marked_for_review, time_seconds_delta, visit_count, action_seq, client_timestamp_ms}` | `200 {persisted_action_seq, server_timestamp}` |
| `GET /api/test-sessions/{session_id}/heartbeat` | Liveness ping (used to detect offline). | — | `200 {server_now}` |
| `POST /api/test-sessions/{session_id}/submit` | Final submit. First-write-wins idempotent (§3.3 G3). | `{auto_submit, auto_submit_source?, client_final_state_hash}` | `200 {submitted_at, auto_submit_source, attempt_ids:[...]}` |
| `POST /api/test-sessions/{session_id}/late-snapshots` | `[UPDATED v2 — non-blocker 6]` Audit-or-scored post-buzzer snapshots. Server decides scoring based on server-anchored arrival timestamp vs `expires_at + 5s`. | `[{slot_index, answer_payload, action_seq, client_timestamp_ms}]` | `200 {recorded_count, scored_count}` |
| `POST /api/test-sessions/{session_id}/abandon-warning` | Advisory: tab closed mid-drain. | — | `200 {}` |
| `GET /api/test-sessions/{session_id}/review` | Post-submit review payload. Returns 403 if not owner; returns 425 Too Early if not yet submitted. | — | `200 {summary, per_question:[{slot_index, question_code, statement, your_answer, correct_answer, score_delta, time_seconds, visit_count, marked_for_review, hints_used, hint_levels_revealed[], wrong_paths?, solution, status}], violations:[{violation_type, violation_timestamp}], auto_submit_source}` |
| `GET /api/test-sessions/{session_id}/marking-scheme` `[UPDATED v2 — Blocker 3b]` | Returns the resolved marking scheme JSONB for this session (with defaults applied). | — | `200 {marking_scheme}` (shape in §8.4) |
| `GET /api/test-sessions/{session_id}/figures/{signed_token}` `[NEW v2 — Blocker 2]` | Returns the figure bytes for a question in this session. Validates token; 401 on tampering / expiry / post-submit. | — | `200 image/svg+xml or image/png` |
| `GET /api/test-sessions/{session_id}/review-figures/{signed_token}` `[NEW v2 — Blocker 2]` | Returns figures referenced in `solution` / `wrong_paths`. 403 while `submitted_at IS NULL`. | — | `200 image/...` |
| `GET /api/test-sessions/{session_id}/questions/{slot_index}/hints/{level}` `[NEW v2 — US-10]` | Returns the L-th hint for the question at this slot. Validates `level == hints_used + 1`. | — | `200 {level, text}` OR `400 {error: 'sequence_skipped'}` OR `404 {error: 'no_such_level'}` |
| `POST /api/test-sessions/{session_id}/violations` `[NEW v2 — Blocker 3c]` | Records an anti-cheat violation. | `{violation_type, was_active, client_timestamp_ms}` | `200 {violations_count, will_auto_submit: bool}` |

### 8.3 New backend tables (Architect will model precisely)

**`test_session_snapshots`** — transient per-question state during an active session.

| Column | Type | Notes |
|---|---|---|
| `session_id` | BigInt | FK to `test_sessions` |
| `slot_index` | Int | `[UPDATED v2 — Blocker 2]` |
| `question_code` | String | FK to `problems` (server-side use only — never sent to client during active session) |
| `answer_payload` | JSONB | shape depends on answer_type (see US-3) |
| `time_seconds` | Int | cumulative |
| `visit_count` | Int | ≥ 1 |
| `marked_for_review` | Boolean | |
| `hints_used` | Int | `[UPDATED v2 — US-10]` default 0 |
| `action_seq` | BigInt | monotonic per session |
| `last_action_at` | DateTime | server clock |
| PK | (session_id, slot_index) | one row per slot per session |

At submit time, the server reads from this table to produce one `attempts` row per visited question. After submit, the snapshots row is kept for audit / debug for 30 days, then purged.

**`test_sessions`** — the session header.

| Column | Type | Notes |
|---|---|---|
| `id` | BigInt PK | |
| `test_id` | BigInt FK | |
| `test_assignment_id` | BigInt FK | `[UPDATED v2 — Blocker 3a]` the assignment row this session derives from |
| `student_id` | BigInt FK | |
| `session_secret` | Bytes | `[UPDATED v2 — Blocker 2]` 32-byte HMAC key for figure token signing; rotated on submit |
| `started_at` | DateTime nullable | NULL until START action |
| `expires_at` | DateTime nullable | `started_at + duration_seconds` |
| `submitted_at` | DateTime nullable | NULL until submit |
| `auto_submit_source` | Enum nullable | `null` / `client_timer` / `server_timer` / `violation_threshold` `[UPDATED v2 — Blocker 3c]` |
| `violations_count` | Int default 0 | `[UPDATED v2 — Blocker 3c]` |
| Unique constraint | (student_id, test_id) WHERE submitted_at IS NULL | prevents duplicate active sessions |

**`cohorts`** `[NEW v2 — Blocker 3a]`

| Column | Type | Notes |
|---|---|---|
| `id` | BigInt PK | |
| `name` | String | |
| `batch_label` | String | e.g. "2027 batch" |
| `created_by_teacher_id` | BigInt FK | |
| `created_at` | DateTime | |

**`cohort_members`** `[NEW v2 — Blocker 3a]`

| Column | Type | Notes |
|---|---|---|
| `cohort_id` | BigInt FK | |
| `student_id` | BigInt FK | |
| `joined_at` | DateTime | |
| PK | (cohort_id, student_id) | composite |

**`test_assignments`** `[NEW v2 — Blocker 3a]`

| Column | Type | Notes |
|---|---|---|
| `id` | BigInt PK | |
| `test_id` | BigInt FK | |
| `cohort_id` | BigInt FK nullable | exactly one of cohort_id / student_id is set |
| `student_id` | BigInt FK nullable | |
| `window_start_at` | DateTime | |
| `window_end_at` | DateTime | |
| `marking_scheme` | JSONB nullable | per-test override; NULL → platform defaults (§8.4) |
| `assigned_by_teacher_id` | BigInt FK | |
| `assigned_at` | DateTime | |
| CHECK | `((cohort_id IS NULL) <> (student_id IS NULL))` | exactly-one |
| Index | `(student_id, window_start_at) WHERE student_id IS NOT NULL` | dashboard query |
| Index | `(cohort_id, window_start_at) WHERE cohort_id IS NOT NULL` | cohort path |

**`test_session_audit`** — append-only audit trail (per §5.3 audit log). `[UPDATED v2 — Blocker 3c, US-10]` Extended with `violation_type ENUM nullable` and `hint_level INT nullable` columns.

**`attempts`** — already exists in schema, but `[UPDATED v2 — non-blocker 9]` ADD column `visit_index_in_test` Int and `[UPDATED v2 — US-10]` ADD column `hints_used` Int default 0.

### 8.4 `[UPDATED v2 — Blocker 3b]` Marking-scheme JSON shape (canonical)

The `test_assignments.marking_scheme` JSONB column has this shape. JEE Advanced 2023+ defaults applied when the column is NULL.

```jsonc
{
  "scheme_version": 1,
  "per_answer_type": {
    "MCQ-SC":  { "correct": 4, "wrong": -1, "unanswered": 0 },
    "MCQ-MC":  {
      "all_correct": 4,
      "three_of_four_correct": 3,
      "two_of_four_correct": 2,
      "one_of_four_correct": 1,
      "any_wrong_picked": -2,
      "unanswered": 0
    },
    "NUM-INT": { "correct": 4, "wrong": 0, "unanswered": 0 },
    "NUM-DEC": { "correct": 4, "wrong": 0, "unanswered": 0 },
    "MAT-COL": {
      "per_correct_row": 1,
      "per_wrong_row": 0,
      "all_rows_correct": 4
    }
  },
  "section_overrides": {
    // optional; keyed by section_name (e.g. "Mathematics"); same per_answer_type shape
  }
}
```

**Resolution rules:**
- If the assignment's column is NULL, the server applies the above defaults.
- If `section_overrides[<section_name>]` is set for a section, its per-answer-type block REPLACES the top-level block for that section (no partial-merge — full replacement for safety).
- Teachers compose this at assign-time via the paper-builder UI (out of scope; future PRD). The runtime simply fetches the resolved scheme via `GET /api/test-sessions/{id}/marking-scheme`.
- The runtime displays a 1-line dashboard summary derived from the per-answer-type block (e.g. `"+4 / −1, partial on MCQ-MC"`); the derivation rule is canonical and documented in the Architect's spec.

### 8.5 Assumes

- Existing `tests.question_codes` is a JSON array of question_code strings in the order the test should present them.
- `[UPDATED v2 — Blocker 3b]` The marking scheme used by the scoring engine is `test_assignments.marking_scheme` (with NULL fallback to platform defaults in §8.4), NOT the legacy field on `tests`. The legacy field, if any, is unused.
- All problems referenced by `tests.question_codes` exist in `problems` with `wrong_paths` and `solution` populated.
- Problems are immutable from the moment a session STARTs to the moment it submits (the server snapshots the problem content into the session payload at START; admins editing problems mid-session does NOT affect in-flight sessions).
- The diagnostic-axis fields (`err_reading`, `err_case`, `err_comp`, `err_strategy`, `err_parsing` on each `wrong_paths` entry) are populated for problems that have been through the diagnostic-axis tagging pipeline (PRD-01). For problems without them (legacy), the review page shows the no-diagnostics-available line per US-8 E1.
- `[UPDATED v2 — Vision Update §4]` The `problems.hints` JSONB column is populated (or NULL) per Vision Update §12 Req G. For v1 ship, problems without hints have `hint_count = 0`; the `Show hint` link is omitted.
- `[UPDATED v2 — Vision Update §5]` The `problems.syllabus_status` enum column is populated (default `WITHIN_SYLLABUS`) per Vision Update §12 Req H.
- The bank size at v1 ship is ≤ 1000 problems and a single test has ≤ 100 questions (so the in-memory warm-cache fits comfortably).
- The pilot will have ≤ 50 concurrent students (PROJECT CONTEXT §8 Stage 10). The runtime is built for this load; scaling to 100k students is a separate phase per PROJECT CONTEXT §10.

---

## 9. Open Questions

Numbered; each open question blocks Stage 2 only on the dimensions noted. Items not blocking Stage 2 are flagged "deferred". `[UPDATED v2]` Q2 (marking-scheme defaults) and Q9 (multi-device) are now CLOSED (decided in v2 — see Blocker 3b fix and US-7 modal copy). New Q12 added (anti-cheat warning colour).

1. **Subjects in v1.** The bank is Maths-only today (~159 problems). The runtime UI must accommodate Physics + Chem in future without redesign (section tabs are first-class). **Decision needed: does v1 ship with the section-tabs visible-but-with-only-Maths-active, OR with section tabs hidden until a multi-subject test exists?** Recommendation: SHOW the tabs even with one subject, so students learn the affordance from day 1. (Blocks: visual design final lock.)

2. ~~**Marking scheme defaults.**~~ `[CLOSED v2 — Blocker 3b fix]` JEE Advanced 2023+ defaults canonical in §8.4; configurable per-test by the teacher at assign-time.

3. **Accent colour.** Default in §7 is `#3754C5` (calm blue, NotebookLM-ish). **Decision needed: does MS prefer the warm-orange option (`#D4732A`) instead?** Either works; tone is the call. (Blocks: design lock-in.) Recommendation: keep calm blue for v1; revisit after pilot.

4. **Font choice.** §7 specifies Geist Variable. Alternative: Inter Variable (mature, ubiquitous, no Vercel branding). **Decision needed: Geist or Inter?** Both are open-source. (Blocks: design lock-in.) Recommendation: Geist — already in Next 16 default config; less integration work.

5. **Palette status colours: saturated JEE-standard or calmer NotebookLM-ish?** §7.3 ships the calmer version (terracotta / muted green / muted purple). **Recommendation: ship calmer; expose a one-flag preference in settings later if students complain.** (Blocks: nothing critical, but worth user confirmation.)

6. **Mobile runtime stance.** §5.6 says "≥ 768 px recommended; `< 768 px` shows a warning + slimmer fallback". **Decision needed: is the warning hard-block (no continue button) or soft-block (with escape hatch)?** Recommendation: soft. (Blocks: nothing critical.)

7. **Server-side auto-submit cadence (US-5).** §AC specifies a 30 s scheduled job. **Decision needed: confirm 30 s is acceptable, or tighten to 10 s.** Recommendation: 30 s for pilot; revisit on evidence. (Blocks: nothing critical; Architect picks if user doesn't weigh in.)

8. **Late-snapshots fairness window.** `[UPDATED v2 — non-blocker 6]` PM has DECIDED in v2: 5 s grace after server-anchored T = 0 → scored; later → audit-only. **Confirmation requested from user**, but no longer blocking. (Blocks: nothing.)

9. ~~**Multi-device policy.**~~ `[CLOSED v2 — non-blocker 7 fix]` Allow + warn with the exact modal copy specified in US-7 AC.

10. **Pre-test instructions content.** §US-2 specifies the structure of the instructions page. **Decision needed: does MS have a standard set of instructions text he wants used (perhaps from his current portal), or do we draft them?** (Blocks: instructions page copy — but not engineering.)

11. **Telemetry beacon endpoint.** §3.1 mentions a "one-pixel beacon" for TTFP/TTI aggregation. **Decision needed: self-host or third-party?** Recommendation: self-host a minimal `POST /api/rum` endpoint for pilot. (Blocks: nothing critical.)

12. **`[NEW v2 — Blocker 3c]` Anti-cheat warning colour.** §7.3 uses placeholder `#C45151`. **Decision needed: does MS want a stronger red (more alarming) or stick with the muted version (consistent with `VISITED_NOT_ANSWERED` terracotta)?** Recommendation: stick with placeholder for v1; the violation banner is non-modal so the alarm doesn't need to scream. (Blocks: design lock-in.)

13. **`[NEW v2 — Vision Update §3]` 3-violation threshold confirmation.** US-9 hard-codes the threshold at 3. Vision Update §3 confirmed this for v1. **Decision needed only if MS wants to revise** (e.g., 5 for very flaky-network classrooms). Recommendation: 3 for v1; configurable per-test in future PRD. (Blocks: nothing; ship as 3.)

14. **`[NEW v2 — US-10]` Hint display position when statement has figures.** When a question has a figure alongside the statement, where does the revealed hint box sit — below the figure, below the statement-and-figure block, or in a sidebar? **Decision needed: confirm "always below the statement+figure block, above the answer pane"** is acceptable to MS. Recommendation: yes. (Blocks: nothing critical.)

---

## 10. `[NEW v2]` Implementation notes for Architect / Engineer (binding)

These are NOT requirements re-stated; they are concrete implementation pointers that close the v1 review's open ends and ensure cross-component consistency.

### 10.1 Shared `@jee/numeric-normalise` package

- **Path:** `/lib/numeric.ts` at the monorepo root, exposed as workspace package `@jee/numeric-normalise`.
- **Public API:**
  ```ts
  export function roundHalfToEven(value: string | number, precision: number): string;
  ```
- **Implementation:**
  ```ts
  import Decimal from 'decimal.js';
  Decimal.set({ rounding: Decimal.ROUND_HALF_EVEN, precision: 50 });
  export function roundHalfToEven(value: string | number, precision: number): string {
    if (precision < 0 || !Number.isInteger(precision)) throw new RangeError('precision must be non-negative integer');
    return new Decimal(value).toFixed(precision);  // Decimal.toFixed uses Decimal's rounding mode, NOT JS toFixed
  }
  ```
- **Consumers (all three MUST import this module — verified by CI):**
  1. `backend/scripts/import-yaml.ts` — normalises NUM-DEC `correct_answer` + `wrong_paths.landed_on_option` at import time.
  2. `backend/src/test-sessions/answer-compare.ts` (server-side equality check during snapshot PUT + at submit-time scoring).
  3. `backend/src/diagnostics/wrong-path-matcher.ts` (the diagnostic-axis matcher).
- **CI test:** `lib/numeric.test.ts` runs a 20-row fixture; an additional `apps/integration/numeric-equality.test.ts` imports the SAME fixture and runs it through each of the three consumer code paths, asserting byte-equal output.

### 10.2 Signed figure token implementation pointer

- **Construction (server, at START):** `token = base64url(slot_index || "|" || figure_index) + "." + base64url(HMAC_SHA256(session_secret, slot_index || "|" || figure_index))`.
- **Verification (server, at GET /figures/...):** parse, recompute HMAC, constant-time compare. Look up `(session_id, slot_index, figure_index) → file_path` in a session-scoped map. Stream bytes.
- **Rotation:** on `POST /submit` first-write, the server overwrites `test_sessions.session_secret` with a fresh 32-byte value, so all outstanding tokens become invalid. The review endpoint uses a different signed-token path (`review-figures/...`) signed with a NEW post-submit secret that's only valid for the owning student.

### 10.3 Violation detector wiring pointer

- Install handlers at the runtime root component mount; tear down at unmount.
- All handlers share a single `incrementViolation(type: ViolationType)` function that (a) updates local state via Zustand/Redux, (b) queues the audit POST, (c) shows the banner.
- The 3rd violation flow is GUARDED: it can only fire ONCE per session. The state machine: `IDLE → COUNTING(1) → COUNTING(2) → AUTO_SUBMITTING → SUBMITTED`. Re-entering COUNTING(2) after AUTO_SUBMITTING is impossible.

### 10.4 NUM-DEC input cap implementation pointer

- The keypad and the keydown handler both consult a single source of truth: `getEffectivePrecision(currentValue, problemPrecision)` returns the remaining decimal digits allowed. The handler refuses the keystroke if the next character is a digit AND the value already has `>= precision` decimal places past the decimal point.
- Decimal point: allowed only if not already present. Minus sign: allowed only at position 0 and only if not already present.
- Paste handler: strip non-`[0-9.\-]`, truncate fractional part to `precision` digits, dispatch a synthetic input event.

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
│  [logo]  PILOT MOCK MATHS    [Mathematics ▼]    02:47:12 [V:0/3] [Submit Test] │
│                              (only one tab in v1 — but the tab affordance is there)│
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
│   │ Hint 1                                                    │ │  Q10  │
│   │ This is a locus problem. What does |z − 1| = |z − i| mean │ │  ...  │
│   │ geometrically?                                            │ │  Q18  │
│   └────────────────────────────────────────────────────────────┘ │       │
│                                                                  │  ───  │
│   ┌────────────────────────────────────────────────────────────┐ │  Legend:│
│   │ Numerical answer                                           │ │  ✓ Answered (green)│
│   │ ┌──────────────────┐  [virtual keypad below]               │ │  ⚑ Marked (purple) │
│   │ │ 2.83             │                                       │ │  ◯ Visited / not ans. (red) │
│   │ └──────────────────┘                                       │ │  (blank) Not visited │
│   │ Decimal — up to 2 decimal places                           │ │       │
│   └────────────────────────────────────────────────────────────┘ │       │
│                                                                  │       │
│   [Save & Next] [Save & Mark for Review & Next]                  │       │
│   [Mark for Review & Next] [Clear Response]                      │       │
│   Show hint (1 / 3 used)                                         │       │
│                                                                  │       │
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

**`[NEW v2 — US-7 non-blocker 7]` Multi-device warning modal:**

```
                  ┌────────────────────────────────────────────┐
                  │  Test open on another device                │
                  │                                             │
                  │  This test is open on another window or     │
                  │  device. You can keep both open, but if     │
                  │  you answer on both, only the most recent   │
                  │  answer is saved.                           │
                  │                                             │
                  │  Continue here?                             │
                  │                                             │
                  │      [ Close this tab ]     [ Continue ]    │
                  └────────────────────────────────────────────┘
```

**`[NEW v2 — Blocker 3c]` Violation banner (top of runtime, non-modal):**

```
┌──────────────────────────────────────────────────────────────────────────┐
│  ⚠ Violation 2 of 3 — tab switch detected.                                │
│  Your test will be auto-submitted on the 3rd violation.            [×]    │
└──────────────────────────────────────────────────────────────────────────┘
```

---

*End of PRD draft v2.*
