# Vision update — 2026-06-26

> **Captures the expanded product vision the user gave during the Stage-1 Spec Loop
> for the test-taking runtime.** This document supersedes any partial vision
> assumptions in earlier PRDs where they conflict. Future PRDs MUST treat this
> as the operative product scope.

---

## 1 — User roles (expanded from 2 to 3 + admin)

| Role | Primary surface | Notes |
|---|---|---|
| **Admin** | Test composer, bank manager, cohort manager, reports console | One human can hold admin + teacher hats |
| **Teacher** | Same surface as admin but limited to their own cohort / their own tests | |
| **Student** | Test runtime, assigned-tests dashboard, post-test review, personalised drill set | The primary product surface |
| **Parent** | Read-only view of *their child's* performance — recent tests, mastery trends, recommended drill set | NEW — was not in §3 of `PROJECT CONTEXT.md` |

PROJECT CONTEXT.md §3 mentions student / teacher / admin only — parent role is a Vision-Update addition and must be threaded through auth, RBAC, the data model (`students.parent_id`?), and at least one new dashboard PRD.

---

## 2 — Paper-setting workflow

- Teacher / admin composes tests by **topic + subtopic + reading-requirement filters** over a problem bank of **1,000 → 10,000+ questions, growing continuously**.
- Saved tests can be **reused / cloned / branched**.
- Each test is **assigned to a cohort** with a **start-time / end-time window** (cohort assignment model).
- Students inside the cohort see the assigned test on their dashboard within the window; outside the window it is hidden or shown as expired.
- After the window closes, **automatic per-test analysis runs** and produces a multi-sheet Excel workbook (see §6 below).

Data model implications (queue for Stage 2 Architect):

- `cohorts(id, name, batch_label, …)`, `cohort_members(cohort_id, student_id)`.
- `test_assignments(test_id, cohort_id, window_start, window_end, marking_scheme_id, …)`.
- `parents(id, …)`, `student_parents(student_id, parent_id, relationship)`.

---

## 3 — Anti-cheat (STRICT, hard-lock with limited warnings)

User-stated requirement: "no right-click, no browser switching, no cheating".

**Adopted policy (until overridden by user):** **HYBRID** —
- Right-click disabled on the test runtime page.
- Copy + paste + text-selection on the question pane disabled.
- Tab-switch / window-switch detected via Page Visibility API + focus events.
- Fullscreen requested on test start; exiting fullscreen counted as a violation.
- **3 violations → automatic submit + flag on the attempt record.** (Earlier-warnings policy — the user picked "STRICT" and said "no cheating", but truly unrecoverable on first violation creates massive false-positive risk on flaky touchpads / accidental window-shifts.)

Violations are logged with timestamp + type to `test_session_audit` so admin/teacher review can see the pattern.

**Honest limitation to surface to the user:** A web app **cannot** prevent all cheating — a second device, a printed slip, a person whispering, are out of scope. Anything beyond browser-resident is impossible without proctoring software (which is a separate project). The runtime's job is to make casual cheating costly, not to prevent determined cheating.

---

## 4 — Hint system (per problem, multi-level, subtle)

Per the user: every problem carries **1 to N hints**, **subtle** (NOT solution-like), each pushing the student toward the IDEA without giving it away. Claude is responsible for authoring these.

### Schema (queue for Stage 2 Architect)
- New top-level field on `Problem`: `hints: Json` — array of `{level: int, text: string, reveals_idea: bool}`.
- Acceptance criteria for an authored hint:
  - **L1**: nudges the student to re-read or restate the problem in their own words; flags a key word / quantifier the problem hinges on.
  - **L2**: names the relevant area of mathematics (e.g. "this is a counting problem under inclusion-exclusion") without naming the IDEA.
  - **L3**: names the IDEA explicitly but does not show the manoeuvre.
  - **L4+** (rare): nudges the manoeuvre but stops before the algebra.
  - **Never**: full setup, final answer, key intermediate quantity.
- The runtime exposes hints **during the test** (not just post-test). Each reveal increments `attempts.hints_used` (the field already exists in the schema for this reason).
- Each hint reveal is silently captured to the per-question telemetry — number-of-hints-used is a **strong predictor** of the IDEA-grasp signal and feeds the personalisation model.

### Authoring pipeline (separate future PRD)
A future Spec Loop will spec a `hints-authoring` agent: given a problem's statement + solution + 7-axis fingerprint + 5 failure-mode axes, produce the hint ladder. For now, all new problems carry hints when imported via the jee-mcq skill (the skill must be updated to emit them).

---

## 5 — Beyond-syllabus red flag

User-stated: "Some questions might be lot of further in the advance. That should not be the ideal framing. So we have to red flag that using a separate parameter."

**Adopted design (queue for Stage 2 Architect):**
- New top-level field on `Problem`: `is_beyond_syllabus: bool` (default `false`).
- Tri-state alternative: `syllabus_status: enum { WITHIN_SYLLABUS, BORDERLINE, BEYOND_SYLLABUS }`. Recommended over boolean because "borderline" is a real bucket.
- Default-hidden from student test-builders, default-visible to teacher / admin paper-composers.
- Red-flagged in any UI that lists problems; show with a clear visual marker.
- The `target_exam` axis already exists; `syllabus_status` is orthogonal because a problem may target JEE Advanced but be drawn from a topic outside the explicit syllabus (eg. eigenvalues for matrices).

---

## 6 — Post-test analysis output (Excel)

User expectation: after every test, an Excel workbook similar to the 6-sheet workbook we built for the 25-Q NTA paper tagging.

**Adopted structure** (queue for the test-results spec loop):
1. **Per-question summary** — accuracy %, median time-correct, time distribution, hints-used median, palette-status distribution at submit.
2. **Per-student summary** — score + section breakdown + per-IDEA mastery delta + recommended next drill set.
3. **Failure-mode heatmap** — `students × 5 ERR-* axes`, counts of how many times each axis fired per student.
4. **Cross-reference** — predicted T-rating vs cohort accuracy (per the 11/25 mismatch pattern we already saw on the NTA paper).
5. **Inter-rater agreement** — if both `jee_platform_critic` and `jee_mcq_critic` reviewed the question, show divergence.
6. **README** — explains every tab.

---

## 7 — Personalised paper recommender (API + flow)

User-stated: "It should auto-create a 25-question paper personalised for that student".

### Flow
1. Student dashboard surfaces "Drill your top weakness" CTA.
2. Click → backend computes the student's `failure_modes_seen × topic_mastery` heatmap from `attempts`.
3. Recommender picks 25 problems from the bank that target the top failure mode + weakest IDEA, adjacent difficulty, mostly NEW to the student.
4. Recommender writes a `tests` row + assigns it to the student (cohort of 1) with a 7-day window.
5. Student takes it like any other test.
6. Post-test analysis specifically tracks whether the targeted failure mode rate fell.

### Constraints
- Must complete in **≤ 2 s** end-to-end (this is a foreground click, not a batch).
- Must NOT recommend the same problem twice unless the student got it wrong AND ≥30 days have passed.
- Must respect `is_beyond_syllabus = true` exclusion for student-side recommendations.

### Data dependencies
- The empirical-difficulty calibration loop must have produced ≥30 attempts on each candidate problem, or the recommender falls back to authored T-rating + scaled difficulty.
- The student must have completed ≥1 prior test, or the recommender returns the standard "starter set" (mixed IDEAs, T2-T3 only).

---

## 8 — Predictive model (post-pilot)

User-stated goal: after ~100 tests per student, the model should *predict* the next test's outcome (per-question accuracy + per-question time).

### Honest scope assessment
- **This is a real research / ML problem**, not a trivial heuristic. ~100 tests per student × 1000 students × 50 questions per test ≈ 5M attempt rows. That's enough signal to train a per-student / per-IDEA accuracy model.
- The model is a separate, large-scope spec loop (Stage-1 Spec + Stage-2 Architecture + Stage-3 Implementation, probably 4-6 weeks).
- For now, the *infrastructure* (the `attempts` table, the failure-mode tagging, the empirical-difficulty batch job) is the right foundation — no model design needed yet.

### Calibration data
User offered: 1 month of past papers his current students have taken (PDFs of questions + Excels of student responses + timings).
- Drop folder: `docs/calibration-data-2026-06/`.
- Once available, a one-off agent run validates the existing per-round timing assumptions against real data, and surfaces calibration mismatches the way the NTA-25-Q cross-reference did.

---

## 9 — Multi-exam expansion

Supported target exams (the `target_exam` axis already covers most):
- **JEE Advanced** — primary
- **IOQM** — Indian Olympiad Qualifier in Mathematics
- **NEET** — medical entrance (user said "need" — likely meant NEET)
- **NDA** — National Defence Academy
- Plus the existing values: `JEE_MAIN`, `INMO`, `RMO`, `KVPY`, `COACHING`, `ORIGINAL`, `OTHER`.

NEET expansion implications:
- New TOPIC values for Biology (BIO) + Physics/Chemistry already covered.
- Different marking scheme (NEET = +4/-1 throughout; no partial-marking MCQ-MC).
- Different syllabus boundary (NCERT-only vs JEE Advanced's much broader scope).

NDA expansion implications:
- General-Ability / Mathematics + English (the English part is new — would need a TOPIC=`ENG` and a different fingerprint shape).
- Different bands (high-school vs 11th + 12th).

These expansions can be staged. JEE Advanced + IOQM are tractable first.

---

## 10 — Question-pattern catalogue

User-stated patterns (covered + future):

**Covered today (the `AnswerType` enum):**
- `MCQ-SC` — multiple choice, single correct.
- `MCQ-MC` — multiple choice, multi-correct with partial marking.
- `NUM-INT` — numerical, integer.
- `NUM-DEC` — numerical, decimal to specified precision.
- `MAT-COL` — match-the-column.

**To add (queue for Stage 2 Architect — extend the enum):**
- `MCQ-PASSAGE` — multi-part questions sharing a passage stem.
- `NUM-DIGIT` — single-digit integer (subset of NUM-INT but with a different input affordance — wheel picker vs free numeric).
- `MAT-LIST` — match List-I to List-II (JEE Advanced format; arguably already MAT-COL).
- `MCQ-AR` — assertion / reason (Both correct + R explains A / Both correct + R doesn't / A correct R wrong / A wrong R correct).
- `FILL` — fill in the blank with a short word / phrase (limited use; mostly NDA English).

That gives 5 + 5 = 10 supported patterns, with room for more in `OTHER`.

---

## 11 — What this update does NOT change

- The 7-axis problem-identity model is unchanged.
- The 5-axis failure-mode diagnostic model is unchanged (Stage 1 PRD-01 still locked at 8/10).
- The agent-factory pipeline + the existing scorecards still govern.
- The Stage 2 Architect's existing Requirements A-E (dual rating, target_exam, reviews array, DB invariant, schema gaps) all still stand; the Vision Update just adds more requirements (F-K below) to that backlog.

## 12 — New Stage 2 Architect requirements (F-K) added by this Vision Update

| Req | What | Notes |
|---|---|---|
| **F** | `cohorts` + `cohort_members` + `test_assignments` + `parents` + `student_parents` tables | Cohort assignment model + parent role |
| **G** | `hints` JSONB column on `problems` + `attempts.hints_used` already covered | Schema-level addition; back-fill all 179 with NULL hints until authored |
| **H** | `is_beyond_syllabus` boolean OR `syllabus_status` enum on `problems` | Recommend the enum |
| **I** | `test_session_audit.violation_type` + `violation_timestamp` columns + violation enum | For anti-cheat capture |
| **J** | Extend `AnswerType` enum with the 5 new patterns | `MCQ-PASSAGE`, `NUM-DIGIT`, `MAT-LIST`, `MCQ-AR`, `FILL` |
| **K** | A `student_drill_recommendations(student_id, generated_at, source_test_id, problem_codes[])` log | Audit trail for what was recommended, when, and to whom |

---

## 13 — Future Spec Loops queued (separate PRDs, in order of impact)

1. **Test-runtime PRD** — currently in flight, this Spec Loop. (Vision Update slots fold into PM v2 if runtime-relevant.)
2. **Teacher / admin paper-builder** — filter the bank, pick problems, set marking, assign to cohort with window.
3. **Student dashboard + post-test review** — list-of-tests + the Excel-style analytics page.
4. **Parent dashboard** — read-only view of own child's data.
5. **Personalised drill recommender API** — the 25-Q auto-generator.
6. **Hints authoring agent** — Claude generates the hint ladder for every problem in the bank.
7. **Predictive model** — research-style spec; deferred until ≥1 cohort × ≥30 tests of empirical data exists.
8. **Stage-9 deployment** — Neon migration + Vercel + monitoring.

Each future PRD will reference back to this document by name and section.

---

*End of vision update — 2026-06-26. Treat as binding for downstream PRDs unless overridden by the user in writing.*
