# Spec Critic Review — Student Test-Taking Runtime PRD v1

**Stage:** 1 (Spec Loop) | **Iteration under review:** v1 | **Reviewer:** Spec Critic (discriminator)
**Artifact reviewed:** `agent-factory/scorecards/16-test-runtime-prd-draft-v1.md`
**Date:** 2026-06-26

---

## Score: 8/10

This is a strong v1. The PM has clearly read PROJECT CONTEXT, PRD-01, and the schema, and has internalised the agent-factory rule set. The PRD is internally coherent, opinionated, and the 8 user stories cover the full runtime arc. Speed targets are quantified with a defined network/hardware profile (rare in v1s). Append-only `attempts` invariant is respected via the `test_session_snapshots` separation, which is a sound architectural call.

The score is held below 9 by **two correctness bugs** (rounding contradiction with the architect-input-notes; security gap on figure URLs) and **one missing data-model assumption** (no test-assignment table exists or is specified) that will land in the Architect's lap and re-open Stage 1 if not resolved here. None of the blockers are deep redesigns — all are surgical fixes — but they MUST be fixed before Stage 2, because shipping any of them as written would either (a) miscompute NUM-DEC equality, breaking the diagnostic pipeline, (b) leak the bank to the client during an active test, breaking PROJECT CONTEXT §12 rule 7, or (c) leave the Architect guessing at a foundational table.

I recommend looping back to PM for v2 with a tight, focused list (5 blockers, 6 non-blockers). v2 should land at 9/10 and clear Stage 1.

---

## Blocking Issues (must fix before advancing)

### 1. [SEVERITY: CRITICAL] NUM-DEC rounding rule directly contradicts the architect-input-notes — and is internally impossible

- **Where:** §4 US-3 AC for NUM-DEC: *"the value is normalised via `toFixed(precision)` using round-half-to-even (banker's rounding, per Stage 2 architect input notes Requirement E)"*.
- **Why it matters:**
  1. The architect-input-notes (`02-architecture-input-notes.md` §Requirement E lines 116–118) literally say: *"JS `toFixed` is NOT banker's rounding despite the PRD parenthetical; choose either 'round half away from zero' or 'round half to even' and document"*. The PM is citing the note as if it endorses `toFixed`-as-banker's-rounding, but the note says the exact opposite. **`Number.prototype.toFixed` is implementation-defined and in V8 it produces a mix of half-away-from-zero and half-to-even due to float representation** (e.g. `(1.005).toFixed(2) === "1.00"`, `(1.015).toFixed(2) === "1.02"`).
  2. PRD-01 (the diagnostic-axis PRD, §6 US-4) and PROJECT CONTEXT §12 rule 5 require that **the runtime's NUM-DEC equality predicate and the importer's `wrong_paths` validator are the same predicate**. If they diverge, the wrong-path matcher will mis-attribute or miss `landed_on_option` matches, silently corrupting diagnoses across the bank.
  3. This is the single highest-impact correctness rule in the PRD because it sits at the intersection of capture, scoring, and diagnosis.
- **Suggested fix:** Replace the AC with a concrete, implementation-agnostic rule. Recommended (matches PRD-01's reference to banker's): *"NUM-DEC normalisation: round to `answer.precision` decimal places using **round-half-to-even (banker's rounding)** implemented by a shared module `@jee/numeric-normalise` (NOT `Number.prototype.toFixed`). The implementation uses string-level rounding (e.g. `Decimal.js` with `ROUND_HALF_EVEN`) so the result is bit-identical across the Node importer and the browser runtime."* Add a hard AC: the importer and the runtime MUST import the same module; a unit test asserts byte-equality on a 20-row fixture. Close the Open Question (Architect input notes Requirement E) here, in the PRD.

### 2. [SEVERITY: CRITICAL] Figure URLs returned to client during an active session can leak the answer / solution

- **Where:** §8.2 `GET /api/test-sessions/{session_id}` returns `sections[].questions[].figure_url?`. Also §5.3 *"`correct_answer` and `solution` fields … are NEVER returned … during an active test session"*.
- **Why it matters:** The runtime warm-caches problem statements and figures to IndexedDB on START (US-2 AC). If a figure file's URL is predictable (e.g. `/static/problems/MAT.SPL.ORBSUM.CNJSP.001/fig-2.svg`), a student opening devtools can **enumerate adjacent problem codes, fetch their figures, and in many cases the figure annotation reveals the answer** (label on a geometric construction, key step of an integration). Worse, if figures are served from a path that maps directly to the problem code, the client now knows every `question_code` in the test — defeating the §5.3 rule that *"the client never knows which question_codes are in the test until the server has verified the session and STARTED it"*. The PRD says "never bare question_code from the client" but the figure URL leak is the same threat by a side door.
- **Suggested fix:** Add an AC to §5.3 and to the `GET /api/test-sessions/{session_id}` response shape: *"Figures are served only via `GET /api/test-sessions/{session_id}/figure/{opaque_figure_id}` where `opaque_figure_id` is a per-session, signed, time-limited (≤ session `expires_at`) token that maps server-side to the underlying figure file. The token does NOT contain the `question_code`. The endpoint enforces session ownership and active state. Solution figures (if `wrong_paths` or `solution` contains figures) are served via a separate path that returns 403 while `submitted_at IS NULL`."* Also: forbid the client payload from including raw filesystem paths or `question_code`-derived URLs.

### 3. [SEVERITY: HIGH] Test-assignment data model is assumed to exist but is not in the schema and is not specified

- **Where:** §4 US-1 AC *"the dashboard shows a list of tests assigned to them"*; §8.2 `GET /api/dashboard/tests`; §8.4 assumes nothing about assignment.
- **Why it matters:** `backend/prisma/schema.prisma` has no `student_id` on `tests`, no `test_assignments` junction table, and no field on `tests` for who can take it. PROJECT CONTEXT §8 stage 7 hand-waves "students see/take assigned tests" but doesn't specify the mechanism either. The PRD inherits the ambiguity. Without resolution:
  - The Architect cannot model `GET /api/dashboard/tests` without inventing a table — and "inventing the assignment model" is a substantive product decision (per-student? per-cohort? per-class? self-enrol from a published-tests pool?), not an architectural one.
  - The unique constraint in §8.3 — *"(student_id, test_id) WHERE submitted_at IS NULL"* — already assumes a student-test relationship; the PRD owes the model that produces it.
- **Suggested fix:** Either (a) add §8.3 a `test_assignments(test_id, student_id, available_from, available_until, assigned_at, assigned_by)` table and an AC that the dashboard query joins it, and explicitly cover the "many cohort students see the same test" case; OR (b) declare assignment OUT of scope and specify that v1 uses an "open enrolment" model where every test in `tests` is visible to every student until `available_until`, and call out that the per-cohort case is a future PRD. Either path is fine — but pick one. Tend toward (a) for pilot realism.

### 4. [SEVERITY: HIGH] Marking-scheme JSON shape is underspecified — and four-way partial-marking MCQ-MC math is not pinned

- **Where:** §8.4 says `marking_scheme = {correct_marks, wrong_marks, partial_rules?, blank_marks}` — but `partial_rules?` is left as a typeless placeholder. PM self-flagged this in Open Q2.
- **Why it matters:** PROJECT CONTEXT §3 question-construction signature 5 says *"Multi-correct questions are calibrated for partial-marking play"*, and PRD-01 §4 US-1 cites the **+4 / +3 / +2 / +1** four-way split (4 correct = +4; 3 of 4 correct, no wrong = +3; 2 of 4 correct, no wrong = +2; 1 of 4 correct, no wrong = +1; any wrong picked = −2). This is THE JEE Advanced 2018+ rule and it's the single most error-prone marking rule on the platform. Leaving `partial_rules?` as a `?` means the Architect ships a schema the server scoring engine cannot fill, and the dashboard's "+4/−1, partial on MCQ-MC" 1-line summary cannot be derived deterministically.
- **Suggested fix:** In §8.4 or a new §8.5, fully type the JSON:
  ```
  marking_scheme = {
    "MCQ_SC": { correct: number, wrong: number, blank: number },
    "MCQ_MC": {
      all_correct: number,           // e.g. +4
      three_of_four: number,         // e.g. +3 (only if 4-option problem and 0 wrong picked)
      two_of_four: number,           // e.g. +2 (only if 0 wrong picked)
      one_of_four: number,           // e.g. +1 (only if 0 wrong picked)
      any_wrong_picked: number,      // e.g. -2
      blank: number                  // typically 0
    },
    "NUM_INT": { correct: number, wrong: number, blank: number },
    "NUM_DEC": { correct: number, wrong: number, blank: number },
    "MAT_COL": { correct: number, wrong: number, partial?: { per_correct_row: number, any_wrong_row: number }, blank: number }
  }
  ```
  Add an AC: the `tests.marking_scheme` JSON is validated against this shape on test creation; runtime renders the 1-line dashboard summary from it deterministically. Close Open Q2 here.

### 5. [SEVERITY: HIGH] No anti-cheating baseline — fullscreen lock, copy-paste, devtools, multi-tab on same device — none addressed for an exam-integrity product

- **Where:** Implicitly absent across §4, §5, §6. §6 says "auth is OUT of scope" but anti-cheating is not even mentioned in Out-of-Scope.
- **Why it matters:** This is a JEE Advanced **mock test** runtime; teachers will run it as a graded mock. The current PRD specifies multi-device with last-write-wins (US-7), no fullscreen requirement, no copy/right-click suppression, no tab-blur logging, no clipboard monitoring. A student can copy the statement, paste into ChatGPT, and paste the answer back in under 30 s. Even if MS decides v1 is honour-based for the pilot, that decision needs to be explicit, not implicit. Per agent-factory constitution: *"ASK, DON'T ASSUME. On anything affecting … public-facing behavior, ask one focused question rather than guessing."*
- **Suggested fix:** Add §5.9 *Exam integrity baseline*. State the v1 stance explicitly. Recommended pilot-friendly baseline:
  - Runtime requests `requestFullscreen()` on test START; if the student exits fullscreen the timer keeps running and a `tab_blur_event` is logged (audit-trail only, not enforced).
  - Right-click context menu disabled inside the runtime route.
  - Copy on question statement disabled (CSS `user-select: none` + JS `copy` event suppression).
  - `visibilitychange` events logged to `test_session_audit` with timestamp + duration of blur.
  - Devtools / clipboard / screen-share detection: out of scope for v1; documented as a known limit.
  Then add Open Q12: *"Should v1 ship with fullscreen enforced (hard-lock) or advisory? Recommend advisory for pilot, hard-lock for production."* Tie back to US-7 multi-device: hard fullscreen enforcement is incompatible with laptop-to-phone resume, so if MS picks hard-lock, multi-device needs a different story.

---

## Non-Blocking Issues (should fix, won't block)

### 6. [SEVERITY: MEDIUM] Late-snapshots policy (US-5 E1 / US-6 E1) is genuinely ambiguous — and PM correctly self-flagged it

- **Where:** §4 US-5 E1, US-6 E1, Open Q8.
- **Why it matters:** The PRD says post-buzzer answers are recorded "audit-only" but not scored. This is a fairness call MS has to make. The fairness ambiguity is small but real: a student typing at T = −0.3 s gets penalised vs one at T = +0.3 s, even though both are inside one network RTT of the buzzer.
- **Suggested fix:** Decide in v2. Recommended: *"Late snapshots posted within 5 s of true T = 0 (server-anchored) are scored; later than 5 s are audit-only. The 5 s window absorbs one network RTT + queue drain."* Document why 5 s.

### 7. [SEVERITY: MEDIUM] Multi-device divergence UI is text-only, not drawn (PM self-flagged)

- **Where:** §4 US-7 AC "blocking modal" — modal copy and shape not pinned.
- **Why it matters:** This is the most adversarial UI in the PRD (it tells a student "you're already in another tab") and the v1 PRD leaves the wording to the Architect, where it doesn't belong.
- **Suggested fix:** Add modal wireframe in Appendix A. Suggested copy: *"This test is open on another window or device. You can keep both open, but if you answer on both, only the most recent answer is saved. Continue here? [Continue] [Close this tab]"*.

### 8. [SEVERITY: MEDIUM] §3.3 Guardrail 1 and §4 US-6 E1 30-second drain timer can produce double-submission

- **Where:** §3.3 G1: *"auto-confirms"* after queue drain. §4 US-6 E1: same. §5 US-5: server-side timer runs every 30 s.
- **Why it matters:** Concrete race: student clicks Confirm Submit at T = expires_at − 15 s; queue takes 35 s to drain; client auto-confirms at expires_at + 20 s; but the server-timer scheduler also fires at expires_at + ε with `auto_submit_source = 'server_timer'`. Both reach `POST /submit`; idempotency on `session_id` saves us *only if* the server's idempotency rule is "first write wins and subsequent calls return the original". The PRD says idempotent (§3.3 G3) but doesn't pin "first-write-wins" vs "merge". Pin it.
- **Suggested fix:** Add an AC to §3.3 G3: *"`POST /submit` is first-write-wins on `session_id`: the first successful call writes `submitted_at`, `auto_submit_source`, and the `attempts` rows; subsequent calls return `200 {submitted_at, auto_submit_source, attempt_ids}` with the original values, NEVER overwrite, NEVER append new attempts."*

### 9. [SEVERITY: MEDIUM] `attempt_order` definition (§5.4) vs §0 glossary conflict

- **Where:** §5.4 *"`attempt_order` reflects the order in which the student FIRST visited each question"*. PROJECT CONTEXT §6 `attempts` field: *"`attempt_order`: 1st, 2nd, 3rd attempt at this question by this student"*.
- **Why it matters:** These are different things. PROJECT CONTEXT's definition is per-(student, question_code) cumulative across all tests; the PRD's is per-(student, test) visit order. The runtime cannot satisfy both with one column.
- **Suggested fix:** Reconcile. Recommended: keep the PROJECT CONTEXT definition (this attempt = the N-th time this student has ever attempted this question_code) because it's the one the empirical-ratings batch needs. Add a SEPARATE field `visit_index_in_test` (1-indexed, contiguous within the test) for the runtime-defined order if it's actually used. Confirm with MS which is which — could be Open Q12.

### 10. [SEVERITY: LOW] Weasel words and unspecified quantities still present

- **Where:**
  - §4 US-7 AC: *"sync log shows the rejection; client surfaces … 'please re-enter Q_7'"* — surfaces it WHERE? Toast, banner, inline on the palette cell?
  - §4 US-3 AC E2 "MAT-COL pairing incomplete … inline hint … 3 s" — 3 s is fine, but "answer all 4 to count as answered" assumes 4 is always the row count. Not true if a future MAT-COL has 5 rows. Tweak copy to be content-dynamic.
  - §5.3 *"rate-limited to 30 per second per session (generous; protects against runaway client bugs)"* — why 30? Cite the math (4 input changes per second × 4 sections × buffer = 30) or state the chosen budget headroom.
  - §5.5 *"covers ≥ 95% of student devices per India browser-share data"* — cite source or remove "per India browser-share data".
- **Suggested fix:** Tighten each. None blocking; the Architect will pick reasonable defaults, but the Spec Critic exists to catch these before then.

### 11. [SEVERITY: LOW] Statelessness of backend — §5.4 capture invariant says local IndexedDB MUST succeed before UI advances; this is correct, but the PRD should call out the one exception

- **Where:** §5.4 *"A telemetry write MUST succeed (locally to IndexedDB) before the UI advances state"*. §4 US-3 E3 *"in-memory queue as a fallback"*.
- **Why it matters:** US-3 E3 already allows in-memory fallback when IndexedDB is unavailable. §5.4's blanket "MUST succeed" contradicts US-3 E3. Reconcile.
- **Suggested fix:** Reword §5.4 to *"A telemetry write MUST be durably queued — IndexedDB if available, in-memory fallback otherwise (with the §US-3 E3 banner) — before the UI advances state."*

---

## What's Good (positive reinforcement — specific things v1 nailed)

### A. The `test_session_snapshots` separation is the right architectural call and it correctly preserves §12 rule 3

The PRD invents a transient `test_session_snapshots` table for in-flight per-question state, and writes the canonical `attempts` row ONCE at submit time (or auto-submit). This preserves the PROJECT CONTEXT §12 rule 3 *"`attempts` is append-only"* invariant while still allowing the runtime to behave like a stateful test-taking app. This was the highest-risk design call in the PRD and the PM got it exactly right. v2 should not regress on this.

### B. The §0 Glossary and the Tier-2 city / mid-range laptop reference profiles are model PRD craft

Pinning *"Tier-2 city 4G = 8 Mbps / 80 ms RTT / 1.5% loss"* and *"mid-range laptop = Chrome DevTools CPU 6× slowdown"* turns "speed is non-negotiable" into a measurable, falsifiable, CI-enforceable target. This is the cleanest performance-spec block I've seen in the project so far. The §3.1 TTFP/TTI table reads like a production-grade SLO doc. v2 should keep this verbatim.

### C. The two-step submit confirm with default-focused Cancel (US-6 AC + edge case "Enter does NOT submit")

The detail that the default-focused button on the confirm modal is **Cancel**, and that the Enter key therefore does NOT submit, is the kind of detail only a PM who has actually watched a student panic-press Enter would think to write. The 30-second drain timer with the "do not close" message is the second half of the same thoughtfulness. Both should be preserved.

### D. The five answer-types are each spec'd with exact input affordances and physical-keyboard parity

§4 US-3 walks each of MCQ-SC / MCQ-MC / NUM-INT / NUM-DEC / MAT-COL with the exact affordance, the deselect rule (must use Clear Response for MCQ-SC — JEE-CBT-faithful), the virtual keypad + physical keyboard parity, and the precision-enforcement-on-paste rule. This is the section the Engineer will thank the PM for. Even with the rounding bug (Blocker 1), the structure of US-3 is right; only the normalisation rule needs swapping out.

### E. Hard cross-references to PRD-01 and PROJECT CONTEXT throughout — not by file name only, but by section

US-8 cites *"PRD-01 §4 US-1"*, §5.4 cites *"PROJECT CONTEXT §12 rule 5"*, US-3 NUM-DEC cites *"the diagnostic-axis PRD §6"*. The PRD does not float free of the binding spec; it threads itself through. This is how you avoid drift in a 9-document project.

### F. Open Questions are scoped per-decision and each one names what it blocks

§9 has 11 Open Questions, each tagged with *"Blocks: X"* (visual design lock / dashboard card text / nothing critical / Architect's call). That structure lets the orchestrator surface only the truly-blocking ones to MS rather than dumping all 11. v2 should add Open Q12 (anti-cheat stance) and Open Q13 (assignment model) using the same shape.

---

## Iteration Delta (iteration 1 — N/A)

This is v1; no prior iterations to track.

---

## Verdict

**loop back to PM for v2**

Score 8/10 is at the gate threshold (≥ 7 advances), but the PRD has **two CRITICAL blockers** (rounding contradiction; figure-URL leak) that automatically block per the agent-factory constitution: *"SECURITY IS A BLOCKING DIMENSION … no artifact passes a gate while any CRITICAL/HIGH security issue is open, even if the overall score is ≥ 7"* (CLAUDE.md line 48–51). The rounding bug is a correctness issue that also auto-blocks per *"Priorities: correct & error-free > secure > fast > looks"*.

v2 should be a tight, surgical pass: fix the 5 blockers, address 6 non-blockers, leave §7 visual design alone (it's already at v2 quality), and re-submit. Expected v2 score: 9/10.

---

## Items only the human (MS) can answer — surface these to the orchestrator

1. **Anti-cheat stance for pilot.** Advisory (fullscreen requested but not enforced, audit-log on blur) or hard-lock (fullscreen forced; tab-blur → auto-submit). Recommend advisory for pilot; tie to multi-device decision (Open Q9).
2. **Test-assignment model.** Per-student `test_assignments`, per-cohort, or open-enrolment-with-window? (Blocker 3.) Recommend per-student `test_assignments` for pilot realism.
3. **NUM-DEC rounding.** Confirm: round-half-to-even (banker's), implemented via shared module — NOT `toFixed`. (Closes architect-input-notes Requirement E.)
4. **Marking scheme — confirm 2023-paper conventions** as the platform default (+4/−1 SC, +4/+3/+2/+1/−2 MC, +4/0 NUM, +3/−1 MAT). (Open Q2 + Blocker 4.)
5. **Late-snapshots fairness window.** 0 s (audit only, ever) or 5 s grace (audit + scored if within 5 s of true zero)? (Open Q8 + non-blocker 6.)

---

*End of Spec Critic review v1.*
