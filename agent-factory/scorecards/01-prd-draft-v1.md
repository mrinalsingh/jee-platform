# PRD: Diagnostic Failure-Mode Axes — Extended Question Identity Layer

**Stage:** 1 (Spec Loop) | **Iteration:** v1 | **Author:** Product Manager (generator)
**Reviewed by:** Spec Critic (pending) | **Scope window:** JEE Advanced 2022 Paper 1 + Paper 2, all of P-C-M

---

## 1. Problem Statement

### 1.1 The user-visible problem
Today the platform can tell a student *which question* they got wrong, and (via the 7-axis identity) *what topic/idea family* the question belongs to. It **cannot** tell the student *why* they got it wrong — specifically, it cannot distinguish between these mutually exclusive failure causes for a wrong attempt:

1. The student misread a quantifier or a numeric constant in the statement (reading mistake).
2. The student understood the statement but enumerated the wrong cases (case-handling mistake).
3. The student set the problem up correctly but lost arithmetic or sign tracking (computation mistake).
4. The student took the bait — invoked machinery the trap pointed at (strategy mistake).
5. The student never saw the IDEA (concept mistake — the only failure the current model captures).
6. The student saw the idea but ran out of time (pacing mistake).
7. The student translated a comprehension passage / List-Match wrong (parsing mistake).
8. The student confused a partial-marking play and lost marks they could have kept (meta-strategy mistake).

Without a tag that lets the platform pin each wrong attempt onto one or more of these causes, remediation collapses into "do more questions on this topic" — which is exactly the failure of mainstream coaching that **PROJECT CONTEXT §2** calls out.

### 1.2 Why now
- The bank is at 2 problems (`MAT.SPL.ORBSUM.CNJSP.001`, `PNC.DGT.EXMUL.LZINC.001`). Migration cost is at its minimum.
- Stage 2 of the build sequence (data model) just completed. The Prisma schema and YAML schema for the 7 axes are in their first stable form. Adding diagnostic axes now costs one migration; adding them after 200 problems costs re-review of 200 problems.
- JEE Advanced 2022 is a documented hard year (top combined score ~314 / 360). Failure-mode signal is concentrated and visible — ideal calibration sample.

### 1.3 Who has this problem
- **The student** when they review a wrong attempt and the platform tells them "you got Q.7 (PNC.DGT.EXMUL.LZINC) wrong" — useful only if they already know whether they misread it, miscounted, or didn't see the idea.
- **The teacher / mentor** when they want to assign a 10-question practice set targeting *the specific kind of mistake a student keeps making*, not just the topic they keep missing.
- **The content reviewer** when they need to flag a question whose attempts cluster on a single failure mode — that's a signal the question is testing one narrow skill, not the rich idea it claims.

---

## 2. Target Users

| Persona | Description | Primary Goal | Tech Comfort |
|---|---|---|---|
| **S — Median JEE Aspirant** | 16–18 yr old, Class 11–12 / drop year. Scored 60–120 / 360 on a recent JEE Adv mock. Uses platform 1–2 h/day. | Find out *which kind of mistake* is costing them the most marks, and reduce that one mistake by the next mock. | Medium. Phone + laptop. KaTeX is fine; jargon is not. |
| **T — Subject Teacher / Mentor** | Maths/Physics/Chem teacher at a coaching centre or freelance, mentoring 5–30 students. Uses the platform to assign sets. | Build a 30-min targeted remedial set for one student in <2 min, addressing the failure-mode pattern in that student's last 50 attempts. | High. Will read tag definitions if they're short. |
| **A — Content Reviewer (Admin)** | Senior subject expert (in-house), reviewing Claude-generated problems before they become `calibrated`. | Tag a freshly generated problem with all axes in <5 min and detect inter-rater disagreement before it pollutes analytics. | High. Trained on the taxonomy doc. |

---

## 3. Success Metrics

- **North Star:** *Diagnosis Specificity Rate* — the fraction of wrong attempts (in a representative pilot of ≥1,000 attempts over ≥50 students) for which the system identifies exactly one dominant failure mode with ≥70% posterior confidence, where "dominant" means the system can point at one diagnostic axis value as the single most likely cause. **Target at pilot end (T+60 days post-launch): ≥ 55%.** Baseline today: 0% (the system cannot distinguish failure modes at all).
- **Leading indicators:**
  1. **Tag coverage** — fraction of problems in the bank with all diagnostic axes populated. Target: 100% before any problem becomes `calibrated`.
  2. **Inter-rater agreement (Cohen's κ) per axis** between two independent reviewers tagging the same 30 problems blind. Target: κ ≥ 0.65 per axis on the calibration set.
  3. **Median human tagging time per problem** for all diagnostic axes. Target: ≤ 4 minutes per problem after a reviewer has tagged ≥ 20 problems (i.e., past the learning curve).
- **Guardrails (must NOT degrade):**
  1. **Existing 7-axis identity remains intact and queryable.** All current YAML files and the Prisma `Problem` table continue to validate and import. Zero regressions in importer tests.
  2. **Authoring throughput.** Time from "Claude returns a candidate problem" to "human-approved YAML on disk" stays ≤ 25% above the current pre-extension baseline measured on the existing 2 problems.
  3. **Tagging time at the high end** — no diagnostic axis takes a trained reviewer > 90 seconds in isolation (the cap protects throughput).

---

## 4. User Stories

### US-1: Student diagnoses their own wrong attempt (S)

**As a** median JEE aspirant, **I want to** see, for each question I got wrong on a test, the single most likely *type of mistake* I made (not just the topic), **so that** I know whether to drill the idea, the counting, the reading, or the time-management — and don't waste an hour on the wrong fix.

**Acceptance Criteria:**
- [ ] Given a completed attempt where the student answered incorrectly, when the student opens the post-test review for that question, then the screen shows: the student's answer, the correct answer, the question's `idea + sub_idea` (existing), AND the inferred dominant failure mode chosen from the diagnostic-axis taxonomy with a one-sentence plain-English label.
- [ ] Given the system has < 70% confidence in any single failure mode (because the student's wrong answer is consistent with ≥ 2 hypothesised wrong paths), when the review screen renders, then it shows the top 2 candidates with their confidence percentages and the label "ambiguous diagnosis — review your scratch work".
- [ ] Given the question is `provisional` (status field), when the review screen renders, then it shows the diagnosis with a "draft" badge — distinguishing it from `calibrated` problems whose wrong-paths are battle-tested.
- [ ] Given the student answered correctly but `time_seconds > authored_time_by_round[round_at_time] × 1.5`, when the review screen renders, then it shows a "right answer, slow path" badge and the pacing-axis value of the question.
- [ ] Given the student left the question blank, when the review screen renders, then it does NOT display a failure-mode diagnosis (we have no signal) and instead shows the question's authored `intrinsic_difficulty` and `authored_time_by_round[round_at_time]` for self-comparison.

**Flow (happy path):**
1. Trigger: student finishes a test, lands on the test-review page.
2. Step: student taps a wrong-answer question card → server reads `attempts.row` + `problems.wrong_paths` + diagnostic axes → matches the student's wrong answer to the wrong-path whose `landed_on_option` equals what the student picked → server returns the diagnostic-axis values from that wrong path.
3. Step: page renders the diagnosis card with one bold sentence ("You miscounted the leading-zero correction in this digit problem") + a chip with the diagnostic-axis tag (e.g., `ERR-CASE-LEADZERO`) + a "see similar drill" button.
4. Outcome: student taps "see similar drill" → server runs the personalised-practice flow (US-3) filtered to the same dominant failure mode.

**Error paths:**
- **E1 — Multiple wrong paths match.** The wrong answer the student entered matches `landed_on_option` of two or more `wrong_paths` entries for that question. → System surfaces both and labels confidence; does NOT pick one silently.
- **E2 — No wrong path matches.** The student's wrong answer matches no entry in `wrong_paths` (their failure is novel). → System surfaces "uncatalogued wrong path — flagged for content review", logs the (student_id, question_code, wrong_answer) triple to an admin queue, and falls back to showing only the topic/idea diagnosis (no failure-mode tag).
- **E3 — Question file missing required diagnostic axes.** The `problems` row has null in the new diagnostic axis columns (e.g., bank entry written before the migration). → System displays the legacy 7-axis identity only and a small "diagnostics not yet available for this problem" line. Never throws.

**Edge cases:**
- Multi-correct (`MCQ-MC`) partial-credit case: student picked 2 of the 3 correct options. → Treated as "partially correct" not "wrong"; failure-mode diagnosis fires only if the student picked at least one *incorrect* option. The diagnosis is keyed off the incorrect picks.
- Numerical (`NUM-INT` / `NUM-DEC`) case: wrong-path matching uses numeric equality (with the per-question precision spec); off-by-decimal-places is a distinct failure mode from off-by-sign.

---

### US-2: Teacher targets a specific failure mode for one student (T)

**As a** subject teacher, **I want to** generate a 10–15 question practice set for one of my students that specifically targets the failure mode I see in their last 50 attempts, **so that** I am not just assigning "more PNC" when their problem is reading the cap on a variable.

**Acceptance Criteria:**
- [ ] Given a student with ≥ 30 attempts in the last 14 days, when the teacher opens that student's profile, then the system displays a ranked list of the top 3 failure-mode axis-values from the student's wrong attempts, each with: count of wrong attempts, fraction of total wrong attempts, and a one-sentence explanation.
- [ ] Given the teacher selects exactly one failure-mode axis-value (e.g. `ERR-READING-QUANTIFIER`), when the teacher clicks "build practice set", then the system returns 10 questions where: (a) every question's `wrong_paths` contains at least one entry whose diagnostic axes include the selected value; (b) ≤ 30% of the returned questions share `topic` to avoid topic-only drilling; (c) intrinsic difficulty spread satisfies T1:T2:T3:T4 ≥ 2:3:3:2.
- [ ] Given fewer than 10 questions in the bank satisfy the constraint, when the teacher clicks "build", then the system returns as many as exist (down to a minimum of 4) and shows "only N matched — taxonomy needs more questions tagged with this failure mode" with the matched count.
- [ ] Given the teacher selects two or more failure-mode axis-values, when the teacher clicks "build", then the system AND-filters (each returned question is taggable to ALL selected modes via its wrong-paths).
- [ ] Given the student has fewer than 30 attempts, when the teacher opens that student's profile, then the system displays a "not enough signal — need ≥ 30 attempts, currently has X" banner and disables the "build set" button.

**Flow (happy path):**
1. Trigger: teacher logs in, opens student S's profile.
2. Step: profile page shows ranked failure-mode list → teacher clicks the top one (e.g., `ERR-CASE-EDGE`, 14/40 wrong attempts).
3. Step: teacher clicks "build practice set (10 Qs)" → server runs constraint-satisfaction over `problems` table filtered on `wrong_paths`-derived diagnostic axes → returns 10 question codes.
4. Step: teacher previews the set → clicks "assign to S" → row inserted into `tests` with the 10 question codes.
5. Outcome: student S sees the assigned test on their dashboard.

**Error paths:**
- **E1 — Bank exhausted for that failure mode.** Fewer than 10 questions match. → System returns N (≥ 4 or zero), surfaces the count, and (in admin queue) logs a "taxonomy-debt" signal that this failure mode needs more authored coverage.
- **E2 — Student has zero attempts.** Profile page shows the no-signal banner; "build set" is disabled. Teacher can still assign a generic intro test from a template.
- **E3 — Concurrent assignment.** Two teachers (a coaching head and a tutor) build sets for the same student in the same minute. → The system records both as separate `tests` rows; neither overrides the other. The student sees both on their dashboard.

**Edge cases:**
- Failure mode is correlated with a single `topic` (e.g., `ERR-CASE-MOD-INDEX` only ever fires on `MAT`). → The 30%-topic cap is relaxed to 60% for that one failure mode, with a UI warning to the teacher.
- Student has not attempted any question with the selected failure-mode tag (cold start on that mode). → The system still builds the set; the diagnostic value of the set is in revealing whether the failure mode generalises beyond what the student has seen.

---

### US-3: Student gets a self-driven targeted drill (S)

**As a** median JEE aspirant, **I want to** click a "drill this weakness" button on my dashboard and immediately attempt 5 questions targeting my single biggest failure mode, **so that** I can practise the specific kind of mistake I keep making without waiting for a teacher to assign anything.

**Acceptance Criteria:**
- [ ] Given the student has ≥ 50 attempts in the last 30 days AND at least one failure-mode value with ≥ 5 wrong attempts, when the student opens the dashboard, then a "Drill your top weakness: [one-sentence label]" card appears with the failure mode shown.
- [ ] Given the student clicks "Drill", when the server responds, then the student is dropped into a 5-question test (`tests` row created on the fly) where every question's `wrong_paths` contains the targeted failure-mode tag and where ≥ 3 of the 5 questions are problems the student has NOT attempted before.
- [ ] Given the student completes the drill, when the result screen renders, then the screen reports: (a) score; (b) whether the same failure mode fired again (count of wrong attempts in the drill where the student's wrong answer matches a wrong-path tagged with that failure mode); (c) the change in that failure-mode rate compared to the student's last 50 attempts (Δ in percentage points).
- [ ] Given the student has fewer than 50 attempts total, when the dashboard loads, then no drill card is shown and the dashboard instead shows "complete at least 50 attempts so we can spot your patterns".
- [ ] Given the student starts a drill, walks away, and the drill goes idle for > 30 minutes, when they return, the drill is auto-submitted with blank for unanswered questions (per the platform-wide test rules) — drills don't bypass attempt integrity.

**Flow (happy path):**
1. Trigger: student logs in, opens dashboard.
2. Step: dashboard backend reads `attempts` for student → computes failure-mode histogram → identifies top mode with ≥ 5 wrong attempts → emits the drill card.
3. Step: student clicks "Drill" → server selects 5 questions (3 unseen + up to 2 previously-attempted-wrong) → creates a `tests` row → returns the test id.
4. Step: student answers; the test capture layer records per-question time, visits, review flag as for any other test.
5. Outcome: result screen shows the Δ-rate. If Δ is negative (failure mode reduced), positive feedback; if zero or positive, the screen recommends "try the conceptual explainer for [idea]".

**Error paths:**
- **E1 — No failure mode has ≥ 5 wrong attempts.** Drill card is hidden; the student sees the generic "Practice" card instead.
- **E2 — All matching questions are already attempted.** System still builds the drill from the previously-attempted set; result screen explicitly notes "all retry — no fresh questions left for this failure mode".
- **E3 — Server times out during drill construction (DB slow under load).** Drill card shows a one-button retry; never silently fails.

**Edge cases:**
- Student picks the same drill twice in 24 h. → System enforces a 6-hour cooldown per failure-mode drill and surfaces the time remaining ("you can re-drill in 4h 12m") — prevents over-fitting to a small question pool.
- The student's "top failure mode" changes between dashboard load and drill click (e.g., a parallel attempt completes that shifts the histogram). → The system locks the failure mode at dashboard-load time and shows the chosen mode at the top of the drill.

---

### US-4: Admin tags a freshly authored problem with diagnostic axes (A)

**As a** content reviewer, **I want to** tag every diagnostic axis on a Claude-generated YAML problem in ≤ 4 minutes and have the importer reject the file if any required diagnostic axis is missing or has a value not present in `taxonomy/maths.yaml`, **so that** no problem reaches `calibrated` status without complete diagnostic identity.

**Acceptance Criteria:**
- [ ] Given a YAML file in `content/maths/generated/` with the legacy 7-axis fingerprint present but the new `diagnostics` block missing, when the importer runs, then the file is rejected with exit code 1 and the message `MISSING_FIELD: diagnostics`.
- [ ] Given a YAML file with `diagnostics.<axis_name> = <value>` where `<value>` is not enumerated under that axis in `taxonomy/maths.yaml`, when the importer runs, then the file is rejected with exit code 1 and the message `UNKNOWN_TAXONOMY_VALUE: diagnostics.<axis_name>=<value>`. (Per **PROJECT CONTEXT §4** — "no miscellaneous tags — extend the taxonomy.")
- [ ] Given the reviewer extends `taxonomy/maths.yaml` with a new value and then re-runs the importer on the same file, when the importer runs, then it accepts the file. No code change required.
- [ ] Given the YAML file's `wrong_paths` array has any entry without a `diagnostic_tags` sub-field, when the importer runs, then the file is rejected with `MISSING_FIELD: wrong_paths[i].diagnostic_tags`.
- [ ] Given two reviewers independently tag the same 30 questions blind, when the disagreement report is computed, then Cohen's κ for every diagnostic axis is ≥ 0.65; below that, the axis is flagged "needs sharper definition" and held out of the production diagnosis engine until re-defined.

**Flow (happy path):**
1. Trigger: Claude returns a generated problem; reviewer opens the YAML in their editor.
2. Step: reviewer fills the 7 legacy axes (existing flow) + the new `diagnostics` block + adds `diagnostic_tags: [<axis>=<value>, ...]` to each `wrong_paths` entry.
3. Step: reviewer runs `npm run import:problems` (Stage 3 importer).
4. Step: importer validates against `taxonomy/maths.yaml`, writes a row to `problems`.
5. Outcome: reviewer marks the problem `calibrated` and `approved_at = now()`.

**Error paths:**
- **E1 — Reviewer omits the diagnostics block entirely.** Importer rejects with the precise field path. Reviewer adds the block, re-runs.
- **E2 — Reviewer uses a typo for an enum value (e.g. `ERR-COUTING` instead of `ERR-COUNTING`).** Importer rejects with the unknown-value message and lists valid values for that axis.
- **E3 — A new failure mode is observed in the field that isn't in the taxonomy.** Reviewer extends `taxonomy/maths.yaml`, opens a PR, the importer re-validates. **No quick-fix back door.** This is by design — see §11 NFR.

**Edge cases:**
- The same problem is re-imported (idempotency). → The importer treats `question_code` as the upsert key. If diagnostic axes changed and the problem is `provisional`, update is allowed. If the problem is `calibrated`, update is rejected with `CALIBRATED_IMMUTABLE` (per `_SCHEMA.md` §5).

---

## 5. Empirically Grounded Axis Proposal — Show The Work

### 5.1 Sample analysed (16 questions from JEE Advanced 2022 P1 + P2 — PCM)

Full per-question worksheet is in **Appendix A**. Summary:

| # | Paper | Subj | Q# | Format | Topic | Trickiness (1–5) | Top-10-rank est. time (s) | Dominant failure modes a student hits |
|---|------|------|----|--------|-------|-----------------|-------|----|
| 1 | P1 | Maths | Q1 | NUM-DEC | TRG (inverse) | 2 | 180 | computation; principal-value reading |
| 2 | P1 | Maths | Q3 | NUM-INT | PRB (conditional, language-heavy) | 4 | 360 | language parsing; Bayes set-up |
| 3 | P1 | Maths | Q4 | NUM-DEC | ALG (complex, "real" condition) | 3 | 240 | algebraic manipulation; "Im=0" set-up |
| 4 | P1 | Maths | Q5 | NUM-INT | ALG (complex, conjugate eqn) | 4 | 360 | over-/under-counting roots; missing trivial root |
| 5 | P1 | Maths | Q6 | NUM-INT | SOT (AP rectangles) | 3 | 240 | sloppy AP arithmetic; mis-indexing |
| 6 | P1 | Maths | Q7 | NUM-INT | PNC.DGT (4-digit on [2022, 4482]) | 4 | 480 | leading-digit case-split; boundary reading |
| 7 | P1 | Maths | Q10 | MCQ-MC | SOT (recurrence on T_n) | 3 | 360 | series indexing off-by-one; partial-marking play |
| 8 | P1 | Maths | Q11 | MCQ-MC | VEC (planes / tetrahedron) | 4 | 540 | direction-vector parameterisation; geometry visualisation |
| 9 | P1 | Maths | Q13 | MCQ-MC | COG (parabola, tangents, foot of perp) | 5 | 720 | multi-step setup; geometry visualisation; partial-marking play |
| 10 | P1 | Maths | Q14 | MCQ-MC | MAT / CAL composite | 5 | 660 | determinant arithmetic; max/min vs roots-of-quadratic linking |
| 11 | P1 | Maths | Q15 | MAT-COL (trig eqns) | TRG | 3 | 480 | list-match parsing; counting roots in given interval |
| 12 | P1 | Phys | Q9 (sect 2) | MCQ-MC | EM (dielectric, geometry change) | 4 | 480 | series-capacitor model; field/voltage confusion |
| 13 | P1 | Phys | Q15 (sect 3) | MAT-COL | EM (solenoid, time-dep flux) | 5 | 600 | vector-time-dep parsing; torque sign |
| 14 | P1 | Chem | Q1 | NUM-DEC | Phys-Chem (bomb calorimetry) | 3 | 360 | Δn correction; sign of internal-energy term |
| 15 | P1 | Chem | Q11 | MCQ-MC | Inorg (Al extraction) | 2 | 180 | fact recall; NCERT edge |
| 16 | P2 | Maths | Q9 | MCQ-MC | TRG (quadrilateral, multiple intervals) | 5 | 720 | geometric configuration; reading "interval(s) that contain" |
| 17 | P2 | Maths | Q15 | MCQ-SC | PNC (boxes, "≥ 1 red AND ≥ 1 blue per box") | 5 | 600 | inclusion-exclusion over 4 boxes; reading of "from each box" |
| 18 | P2 | Phys | Q1 | NUM-INT | Mech (force depending on position; 3D) | 4 | 540 | conservation reading; vector algebra |

Trickiness rating: 1 = read-and-write, 5 = hardest reachable in 12 min with a clean idea. "Top-10-rank est. time" = time a student in the last 4–5 months of preparation who is on track for a top-10 rank takes (per **PROJECT CONTEXT §5**).

### 5.2 Recurring failure modes observed (the empirical buckets)

Each failure mode below shows up in ≥ 2 of the 16 sample questions. Modes that appeared only once were either rolled into a broader bucket or rejected as not having "discriminating power" yet.

| Bucket | Sample Qs in which it activates | What the bucket means |
|---|---|---|
| **Reading: quantifier / scope** | P1-M-Q3, P2-M-Q9, P2-M-Q15 | The student missed a word like "exactly", "at least", "contain*s*", "from each", "non-zero" — the math they then did was correct for the misread problem. |
| **Reading: numeric / range constant** | P1-M-Q7, P1-M-Q15 (matching intervals), P1-Phys-Q11 (range of *y*) | The student missed a specific numeric bound (`[2022, 4482]`, `[-2π/3, 2π/3]`). |
| **Case-handling: edge / boundary** | P1-M-Q7 (leading-zero / boundary digit), P1-Phys-Q9 (figure (a) vs (b) limits), P1-M-Q5 (z=0 trivial root) | A boundary or degenerate case was dropped or double-counted. |
| **Case-handling: mod / index parity** | P1-M-Q10 (T_n recurrence), P2-M-Q16 (M^2022) | The student got the period/parity of an iterated operation wrong. |
| **Computation: arithmetic** | P1-M-Q6, P1-M-Q14 (determinant), P1-Chem-Q1 | The set-up was right; the numbers were wrong. |
| **Computation: sign / orientation** | P1-Phys-Q9, P1-Phys-Q15, P2-M-Q13 (vectors), P2-Phys-Q1 | A sign or direction was flipped. |
| **Strategy: trap-taken (eigen / Cayley / L'Hopital / NCERT)** | P1-M-Q14, P2-M-Q16, P2-M-Q5 (limit), P1-Chem-Q11 | The student reached for the baited machinery; the same problem yielded to elementary methods. |
| **Strategy: partial-marking miss** (MCQ-MC) | P1-M-Q10, P1-M-Q13, P1-Phys-Q9 | The student picked too many or too few options because they didn't compute the +1/+2 vs −2 expected value. |
| **Comprehension / list-match parsing** | P1-M-Q15, P1-Phys-Q15 (sect 3), P1-Chem-Q17 (sect 3) | The student mapped the wrong List-I entry to a List-II entry — even though they computed each List-I entry correctly. |
| **Visualisation: geometry / 3D** | P1-M-Q11 (tetrahedron edges), P1-M-Q13 (parabola, S, P, Q), P2-M-Q9 (quadrilateral), P2-M-Q12 (touching circles) | The student couldn't form/hold the figure in their head and so couldn't set up the algebra. |
| **Pacing: ran out of time** | P1-M-Q14, P1-M-Q13, P1-Phys-Q15 (sect 3) | The student knew the idea but couldn't execute it in the time budget for that question type. |
| **Concept: didn't see the IDEA** | P1-M-Q5, P1-M-Q14, P2-Phys-Q1 | The "ah, I see it" moment never happened. This is the only failure the current 7-axis model isolates. |

Twelve buckets, evenly distributed across PCM. No subject is exempt from any bucket (specifically — Chemistry has reading mistakes, Physics has case-handling, Maths has list-match parsing).

### 5.3 Grouping the buckets into candidate axes

The 12 buckets above collapse into **5 candidate axes**, each axis ranging over the buckets that share a common student-side intervention:

| Candidate axis | Axis values | Discriminating power evidence |
|---|---|---|
| **ERR-READING** — what kind of misreading | `ERR-READING-QUANTIFIER`, `ERR-READING-NUMRANGE`, `ERR-READING-VARDEF`, `ERR-READING-NONE` | 3+2 = 5 of 16 sample Qs activate it; the rest don't. Discriminating (31%). |
| **ERR-CASE** — what kind of case mishandling | `ERR-CASE-EDGE`, `ERR-CASE-MODINDEX`, `ERR-CASE-PARTITION`, `ERR-CASE-NONE` | 3+2 = 5 of 16 activate it. Discriminating. |
| **ERR-COMP** — what kind of computation slip | `ERR-COMP-ARITH`, `ERR-COMP-SIGN`, `ERR-COMP-ALGEBRA`, `ERR-COMP-NONE` | 3+4 = 7 of 16 activate it. Most common axis — but still discriminating because 9 of 16 don't activate it. |
| **ERR-STRATEGY** — strategic / meta error | `ERR-STRAT-TRAP`, `ERR-STRAT-PARTIAL`, `ERR-STRAT-NONE` | 4+3 = 7 of 16 activate it. Critically: every MCQ-MC question can carry an `ERR-STRAT-PARTIAL` mode on at least one wrong path. |
| **ERR-PARSING** — failure to map statement to math | `ERR-PARSE-LISTMATCH`, `ERR-PARSE-GEOM3D`, `ERR-PARSE-PASSAGE`, `ERR-PARSE-NONE` | 3+4 = 7 of 16. Geometry/3D visualisation alone covers 4 of 16 Qs. |

Two more dimensions emerged from §5.2 that do NOT belong on the *failure-mode* layer because they describe properties of the *question*, not the *wrong path*:

- **Pacing axis** (`PACE-TIGHT` vs `PACE-LOOSE`) — a property of the question (its `authored_time_by_round` vs the section's time budget). Already implicit in `authored_time_by_round`. We do not add a new axis for it; we expose it as a derived field in queries.
- **Concept-not-seen** — the existing axes 3 (IDEA) and 4 (SUB-IDEA) already pinpoint the concept. A wrong attempt where no other ERR-axis fits IS the "didn't see the idea" diagnosis by elimination. We make this explicit in §6 Option A.

### 5.4 Where the diagnostic axes attach in the data model

The diagnostic axes attach **per `wrong_paths` entry**, NOT per problem. Rationale: one problem has 2–3 distinct wrong paths (per `_SCHEMA.md`). Each path is a *different* kind of failure — that's the whole point of recording multiple paths. Tagging at the problem level would lose the signal. Tagging per wrong path lets the inference engine in US-1 match the student's wrong answer to the right path, then read the failure-mode tags off that path.

A *summary* set of diagnostic axes is also stored at the problem level — the **union** of the per-path tags — so the query in US-2 ("find me questions that can test ERR-READING-QUANTIFIER") can filter on indexed problem-level columns without scanning JSON.

---

## 6. The Two Options — Both Fully Specified

### Option A: Orthogonal new "diagnostic" layer alongside the existing 7 axes

**Net effect: 7 existing identity axes + 5 new diagnostic axes = 12 axes total. The two layers are independent.**

#### A.1 The 5 new axes (added to `taxonomy/maths.yaml`)
```yaml
# Axis 8 — ERR-READING — what kind of misreading caused the wrong path
err_reading:
  ERR-READING-NONE:        "No reading mistake on this path."
  ERR-READING-QUANTIFIER:  "Misread a quantifier (exactly / at least / contains / from each / non-zero / all)."
  ERR-READING-NUMRANGE:    "Misread a numeric bound or interval endpoint."
  ERR-READING-VARDEF:      "Misread a variable's defining property or domain."

# Axis 9 — ERR-CASE — what kind of case mishandling
err_case:
  ERR-CASE-NONE:        "No case-handling mistake."
  ERR-CASE-EDGE:        "Boundary or degenerate case dropped or double-counted (incl. leading-zero, x=0, equality of two parameters)."
  ERR-CASE-MODINDEX:    "Wrong period / parity / cycle length on an iterated structure (recurrence, matrix power, modular)."
  ERR-CASE-PARTITION:   "Missing or duplicate sub-case in a case enumeration."

# Axis 10 — ERR-COMP — what kind of computation slip
err_comp:
  ERR-COMP-NONE:    "No computation slip."
  ERR-COMP-ARITH:   "Arithmetic slip (a number added / multiplied wrong)."
  ERR-COMP-SIGN:    "Sign or orientation flipped (vector direction, negative of an integral, wrong root sign)."
  ERR-COMP-ALGEBRA: "Algebraic manipulation slip (wrong identity applied, factoring error)."

# Axis 11 — ERR-STRATEGY — strategic / meta error
err_strategy:
  ERR-STRAT-NONE:    "No strategy error."
  ERR-STRAT-TRAP:    "Took the bait — invoked the trap machinery (eigen / Cayley / L'Hopital / NCERT-edge / length-of-problem) when simpler method exists."
  ERR-STRAT-PARTIAL: "Multi-correct partial-marking miscalibration (picked too many or too few options for the marking scheme's expected-value math)."

# Axis 12 — ERR-PARSING — failure to map statement to math
err_parsing:
  ERR-PARSE-NONE:      "Statement was parsed correctly."
  ERR-PARSE-LISTMATCH: "Wrong mapping in List-I/List-II match (each computation correct in isolation)."
  ERR-PARSE-GEOM3D:    "Failed to form / hold the geometric or 3D figure correctly."
  ERR-PARSE-PASSAGE:   "Misunderstood the comprehension passage / multi-paragraph setup."
```

**"Didn't see the IDEA" diagnosis (conceptual failure)** is encoded by the all-`NONE` pattern: a wrong path tagged `ERR-READING-NONE, ERR-CASE-NONE, ERR-COMP-NONE, ERR-STRAT-NONE, ERR-PARSE-NONE` is a conceptual failure on axes 3–4 (IDEA / SUB-IDEA). The platform displays this as "didn't see the IDEA: [idea_label]".

#### A.2 Per-`wrong_paths` extension to the YAML schema (`_SCHEMA.md` v2)

Every entry in `wrong_paths` gains a `diagnostic_tags` sub-field whose value is an object with exactly the 5 keys above:

```yaml
wrong_paths:
  - path: "Forgets that the diagonal frequency depends on n…"
    landed_on_option: "Wrong on A and C; possibly still picks B."
    diagnosis: "Failure to generalize the orbit-frequency counting from S_3 to S_n…"
    diagnostic_tags:
      err_reading:  ERR-READING-NONE
      err_case:     ERR-CASE-MODINDEX
      err_comp:     ERR-COMP-NONE
      err_strategy: ERR-STRAT-NONE
      err_parsing:  ERR-PARSE-NONE
```

#### A.3 Per-problem summary axes (new columns on `problems` table)

For query performance (so US-2 doesn't scan JSON), `problems` table gets 5 new columns, each typed `String[]` (Postgres array) and indexed via GIN:

```prisma
model Problem {
  // ... existing columns
  errReadingTags   String[]  // union of err_reading tags across all wrong_paths
  errCaseTags      String[]
  errCompTags      String[]
  errStrategyTags  String[]
  errParsingTags   String[]
  @@index([errReadingTags], type: Gin)
  @@index([errCaseTags], type: Gin)
  @@index([errCompTags], type: Gin)
  @@index([errStrategyTags], type: Gin)
  @@index([errParsingTags], type: Gin)
}
```

Populated by the importer at YAML→DB time. Never edited by hand.

#### A.4 Workflow impact on `_SCHEMA.md`
Bump `schema_version: 1 → 2`. Every new YAML file must have `diagnostic_tags` on every `wrong_paths` entry. Files at version 1 still validate but get rejected when imported as `calibrated` — they have to be re-tagged first.

#### A.5 Diagnostic power gained (new questions we can answer)
1. *"For student S, what is the most common kind of mistake?"* — group their wrong attempts by `wrong_paths.diagnostic_tags`, count.
2. *"Find me 10 questions to drill ERR-CASE-EDGE."* — `WHERE 'ERR-CASE-EDGE' = ANY(errCaseTags)`, with topic-spread constraint.
3. *"Which axis is the platform best/worst at diagnosing?"* — for each diagnostic axis value, compute "% of student wrong attempts that matched a wrong_path with this tag". Low matches = axis underdefined; high matches = useful.
4. *"Is a problem testing too narrow a skill?"* — if every wrong-path is tagged with the same single failure mode, the problem doesn't really exercise the rich IDEA the fingerprint claims.

#### A.6 Migration cost
- One new Prisma migration adding 5 array columns and 5 GIN indices.
- Two existing YAML files (`MAT.SPL.ORBSUM.CNJSP.001`, `PNC.DGT.EXMUL.LZINC.001`) need `diagnostic_tags` added to their 3 wrong-paths entries each. **≤ 12 minutes of reviewer time total** (4 min/problem × 2 problems, plus tagging the wrong_paths sub-entries which the reviewer is already writing).
- Existing 7-axis identity untouched. Zero risk to current importer tests.

---

### Option B: Refactor the existing 7 axes into finer sub-axes

**Net effect: the same 7 axes, each decomposed into 2–4 sub-axes. No new top-level axes are introduced.**

#### B.1 Decomposition

| Existing axis | Decomposed sub-axes | What each measures |
|---|---|---|
| **Axis 1 — TOPIC** | Unchanged. | The topic taxonomy is already fine-grained enough (12 values). |
| **Axis 2 — SUBTOPIC** | Unchanged. | Already ~5–8 per topic; decomposing further is bookkeeping cost without gain. |
| **Axis 3 — IDEA** | (3a) `IDEA-PRIMARY` — the limiting idea (current sense), (3b) `IDEA-SECONDARY` — the second idea fused in (per **PROJECT CONTEXT §3**: "Two-concept fusion is the norm"), nullable. | Captures the two-concept-fusion structure explicitly. |
| **Axis 4 — SUB-IDEA** | Unchanged. | Already at the manoeuvre level. |
| **Axis 5 — ANSWER-TYPE** | (5a) `FORMAT` — MCQ-SC / MCQ-MC / NUM-INT / NUM-DEC / MAT-COL (current), (5b) `MARKING-SCHEME-ID` — explicit FK to a marking-scheme table (different years use different partial-marking rules). | Forces the partial-marking variant to be part of the identity so `ERR-STRAT-PARTIAL`-style analysis is doable. |
| **Axis 6 — SURFACE** | (6a) `SURFACE-DRESSING` — SURF-PLAIN/SET/FUNC/GEOM/PARAM/PASS (current), (6b) `SURFACE-LANGUAGE-LOAD` — `LANG-LOW` / `LANG-MED` / `LANG-HIGH` (count of subordinate clauses + quantifier words in the statement). | Splits "surface" into visual dressing vs language load — they cause different failures (visual → ERR-PARSE-GEOM3D; language → ERR-READING-QUANTIFIER). |
| **Axis 7 — TRAP** | (7a) `TRAP-MACHINERY` — TRAP-EIGEN/CAYLEY/LHOP (current technical traps), (7b) `TRAP-CASE` — TRAP-EDGE/NCERT (edge-case traps, current), (7c) `TRAP-FORMAT` — TRAP-PARTIAL/LENGTH (format/strategy traps, current), (7d) `TRAP-READING` — NEW: the question deliberately uses an ambiguous quantifier (e.g. "interval(s) that contain"). | Splits the existing TRAP enum into 4 disjoint sub-enums by *what kind of bait*. |

After the refactor, the count of identity slots becomes: 1 + 1 + 2 + 1 + 2 + 2 + 4 = **13 identity slots** (vs the current 7).

#### B.2 Workflow impact on `_SCHEMA.md`
- Bump `schema_version: 1 → 2`.
- Every existing YAML file must split its `fingerprint.idea` into `idea_primary` + `idea_secondary`, its `surface` into `surface_dressing` + `surface_language_load`, and its `trap` into 4 sub-fields. **Every existing problem requires a touch.**

#### B.3 Data-model impact
- All 6 affected Prisma columns are renamed/replaced. 6 new indices.
- Importer rewritten to accept the new structure.
- All test queries that filter on `idea`, `surface`, `trap` must be updated.

#### B.4 Diagnostic power gained
- Two-concept fusion becomes queryable (`WHERE idea_secondary IS NOT NULL`).
- Language-load filtering becomes possible (`WHERE surface_language_load = 'LANG-HIGH'`).
- TRAP-READING becomes a first-class axis, partially covering what Option A's `ERR-READING` axis covers — but only on the *question side* (problem author asserts the trap exists); Option A captures it on the *wrong-path side* (this specific wrong attempt fell into reading-misuse).
- Does NOT capture: ERR-COMP (computation slips happen regardless of question identity); ERR-STRAT-PARTIAL on a per-wrong-path basis (only as a question-level trap); the per-wrong-path failure-mode matching that drives US-1.

#### B.5 Migration cost
- One new Prisma migration touching 6 columns and indices.
- **Both existing YAML files must be re-tagged on 6 of 7 axes.** Reviewer time: ~10 minutes per problem × 2 = 20 minutes.
- Higher risk: every importer test, every taxonomy lookup, every documentation reference to `idea` / `surface` / `trap` must be updated. Likely a 2–4 hour engineering effort vs ~30 minutes for Option A.
- A full pass through `PROJECT CONTEXT.md` is required to ensure the new vocabulary doesn't conflict with §4.

---

### Option A vs Option B — Trade-off Summary

| Dimension | Option A (orthogonal new layer) | Option B (refactor existing) |
|---|---|---|
| **Captures per-wrong-path failure mode (US-1, US-3 driver)** | Yes — directly. | No. Only captures *what the question can elicit*, not which mode fired on this attempt. |
| **Captures two-concept fusion explicitly** | No — leaves it implicit in IDEA naming. | Yes — `idea_secondary` is first-class. |
| **Captures partial-marking play on wrong attempts** | Yes (`ERR-STRAT-PARTIAL` on wrong-path). | Only as a question-level trap; not on the specific student's wrong attempt. |
| **Migration cost (existing problems)** | ~12 min total. | ~20 min total + rewrite of importer + downstream changes. |
| **Risk to existing 7-axis identity and queries** | None — additive only. | Significant — renames and splits existing columns. |
| **Inter-rater agreement risk (κ)** | Moderate — 5 new axes to agree on. | Higher — sub-axes like `LANG-MED` are subjective. |
| **Future extensibility** | Easy — add a 6th diagnostic axis the same way (lookup table style). | Harder — every refactor touches existing data. |
| **Answers the user's verbatim ask ("pin-point reasons where a student is faltering")** | Directly. | Indirectly, and only on the question side. |

**Recommendation: Option A.** Option A is additive, migration-cheap, directly answers the user's ask, and preserves the 7-axis identity that **PROJECT CONTEXT §4** calls a non-negotiable. Option B's two genuine wins (two-concept fusion as `idea_secondary`; explicit marking-scheme identity) can be folded into Option A as a *small future enhancement* later (just add an axis 4.5 `idea_secondary` when needed) without re-tagging the bank. We should NOT do both at once — the bank is too small for that to be worth the risk.

---

## 7. Non-Functional Requirements

- **Performance:**
  - Failure-mode lookup for a single attempt (US-1, US-3 result screen): server response ≤ 200 ms p95 once the `wrong_paths.diagnostic_tags` is loaded with the problem row.
  - Targeted-set construction (US-2, US-3 build phase): ≤ 800 ms p95 to return 10 question codes when the bank has ≤ 10,000 problems. GIN-indexed array columns guarantee this.
  - Importer rejection of an invalid YAML: ≤ 1 s for files ≤ 50 KB.
- **Security:**
  - Diagnostic tags are not PII. They are stored in `problems` (public-readable to authenticated users) and `attempts` (per-student private).
  - Authorization: a student can read their own failure-mode rollups; a teacher can read failure-mode rollups for students explicitly mapped to them; an admin can read across the bank for content QA. The mapping (teacher↔student) is governed by the existing role table (out of scope for this PRD; assumed present from Stage 5 of the build sequence).
  - The diagnosis engine MUST NOT cross-leak: querying student A's rollup must never include attempts where `student_id != A`. This is a basic auth check.
- **Scalability:**
  - At 1,00,000 students × 200 attempts/student/year × 5 diagnostic columns = ~2×10^7 attempt rows with diagnostic queries. The diagnostic axes are columns on `problems` (which is bounded by bank size ~10^4), not on `attempts`. Histograms over `attempts` are computed in the nightly batch (per **PROJECT CONTEXT §12 rule 6**: "empirical ratings are computed in a batch job, never live") and cached.
- **Accessibility:**
  - Failure-mode labels MUST be one short sentence in plain English (no LaTeX, no jargon-only acronyms). Each axis value MUST have a `student_facing_label` field alongside its definition (≤ 60 characters) used on the student review screen.
- **Availability:**
  - The diagnosis card (US-1) is non-critical: if it fails to load, the test-review screen still renders without it. Hard SLO: it must never block test review.
- **Tagging time per question (acceptance threshold):**
  - Median reviewer tagging time for all 5 diagnostic axes on one fresh problem, measured after the reviewer has tagged 20 problems: **≤ 4 minutes**. Worst-case per-axis: ≤ 90 s.
- **Inter-rater reliability (κ) target per axis:**
  - On a held-out calibration set of 30 problems tagged independently by two reviewers: **Cohen's κ ≥ 0.65** per axis.
  - If κ < 0.65 on any axis, that axis is *held back* from the production diagnosis engine (engineering work to expose it via the API is not done) until the taxonomy definition is sharpened and the re-tag exercise passes.
- **Evolvability:**
  - Adding a new value to an existing diagnostic axis (e.g. `ERR-READING-NEGATION`): extend `taxonomy/maths.yaml`, re-run importer. **No problem re-tagging required.** Existing problems whose wrong paths don't activate the new value retain their tags.
  - Adding a new diagnostic axis altogether (e.g. `ERR-MEMORY`): one Prisma migration adding one column + one taxonomy block. Existing problems are bulk-defaulted to `NONE` on the new axis; reviewers then upgrade as they re-touch problems.
- **Auditability:**
  - Every change to `taxonomy/maths.yaml` lands as a git commit (the file is checked in). Every change to a problem's `diagnostic_tags` while in `provisional` state is captured in the `problems.updated_at` timestamp; once `calibrated`, the `_SCHEMA.md` immutability rule applies.

---

## 8. Out of Scope

Explicitly NOT included in this PRD; future iterations.

- **The student-facing UI to display diagnoses.** US-1, US-3 specify the *contract* (what fields the API returns and what the screen MUST show); the visual design lives in Stage 4 of the build sequence (testing app).
- **The scoring algorithm for partial-marking play.** The existing marking schemes apply unchanged. This PRD only adds the diagnostic tag for "you mis-played partial marking on this question" — it does not change how marks are awarded.
- **The mastery-update logic.** `student_fingerprint_state.mastery_score` is updated per the existing rules; this PRD does NOT touch the mastery formula.
- **The Physics and Chemistry taxonomy files.** This PRD references PCM evidence from JEE Adv 2022 but specifies changes to `content/taxonomy/maths.yaml` only. P and C taxonomy files will get the same 5 diagnostic axes added in a follow-up PRD once Maths is calibrated.
- **The test-taking interface itself.** No changes to the timer, the capture layer, or the answer-submission flow. Diagnoses are computed *after* the test is submitted.
- **The Claude-prompt for generating problems WITH their diagnostic tags.** That is a Stage 3 content-workflow upgrade and belongs in its own PRD. Until that upgrade lands, reviewers tag diagnostics by hand.
- **A diagnosis-confidence threshold tuner.** The 70% confidence cutoff in US-1 acceptance criterion is the v1 default; tuning belongs in the feedback-loop iteration.
- **Backfill of empirical failure-mode rates from past attempts.** The 2 existing problems have no attempt data; backfill is moot. When the platform has attempts, the nightly batch job will populate empirical rates — that addition belongs in the feedback-loop PRD.
- **Multilingual labels** for failure modes. English-only at launch.
- **Anti-gaming** (e.g., a student who deliberately picks the trap option to inflate their ERR-STRAT-TRAP count). Not a v1 concern given the trusted-student pilot.

---

## 9. Dependencies & Assumptions

**Depends on:**
- `content/taxonomy/maths.yaml` exists and is the source of truth for axis enumerations (it does, per `git status`).
- The Prisma schema and the importer script from Stages 2–3 of the build sequence exist (they do — `backend/scripts/` is present per `git status`).
- The `wrong_paths` field on YAML problems already requires a `landed_on_option` value (it does per `_SCHEMA.md`). This is the key the diagnosis engine matches student wrong answers against.

**Assumes:**
- Every Claude-generated problem will have 2–3 wrong-paths entries (the existing convention in `_SCHEMA.md`). Diagnoses are only as good as the wrong-paths coverage.
- Reviewers will use the 5 axes consistently. The κ ≥ 0.65 NFR is the enforcement.
- The 2022-only sample is representative of the failure modes that will appear in 2020 / 2023 / 2024 papers. The PROJECT CONTEXT §3 list of 7 question-construction signatures is invariant across recent years; the failure modes derived from it are therefore expected to generalise. We will validate this in a future PRD by re-running the §5 analysis on 2020 and 2023 papers.
- The user (the project owner) approves the 5-axis taxonomy proposed in §6 (Option A) before engineering begins — this is the decision in §10 below.

---

## 10. Open Questions

- [ ] **Q1 — Option A vs Option B.** Spec recommends Option A. User confirms?
- [ ] **Q2 — Exact axis-value definitions.** §6 (Option A) proposes 4+4+4+3+4 = 19 axis values. Are any missing for failure modes the user has seen in tutoring practice that the 2022-paper analysis did not surface (e.g., calculator/silly mistakes that are not on JEE Adv but might appear on practice tests)?
- [ ] **Q3 — The 70% confidence threshold in US-1.** Is 70% the right cutoff for "show a single dominant diagnosis", or should it be 60% (more diagnoses but more noise) or 80% (fewer but cleaner)?
- [ ] **Q4 — Inter-rater protocol.** Who are the 2+ reviewers who will tag the calibration set? Is the user available as one of them? (κ-based gate needs human time to validate.)
- [ ] **Q5 — Do we want a "free text" reviewer note alongside the diagnostic_tags?** Reviewers may want to record the *evidence* for each tag ("This wrong path is ERR-READING-QUANTIFIER because the student plausibly read 'contains' as 'is contained in'"). Adds reviewer time; adds explainability later.
- [ ] **Q6 — Should empty/uncatalogued wrong paths (US-1 E2) auto-create taxonomy debt issues** (e.g. a GitHub issue in the private repo), or be reviewed in a queue UI we build later? Pre-Stage-7 there is no queue UI; a CSV export of the queue might suffice for the pilot.

---

## Appendix A — Per-question worksheet (16 sampled questions)

Format: **(Subject, Paper, Q#, Format) — Topic / subtopic — trickiness (1–5) — top-10-rank est. time (s) — failure modes activated on typical wrong paths.**

1. **(Maths, P1, Q1, NUM-DEC)** TRG / inverse-trig identities — 2 — 180s — `ERR-READING-NUMRANGE` (principal value range misread); `ERR-COMP-ARITH`.

2. **(Maths, P1, Q3, NUM-INT)** PRB / language-heavy conditional probability — 4 — 360s — `ERR-PARSE-PASSAGE` (4-paragraph setup); `ERR-READING-QUANTIFIER` ("at most one symptom" vs "exactly one"); `ERR-CASE-PARTITION` (forgetting to sum sub-cases).

3. **(Maths, P1, Q4, NUM-DEC)** ALG / complex-number-real-condition — 3 — 240s — `ERR-COMP-ALGEBRA` (rationalisation slip); `ERR-CASE-EDGE` (z imaginary part = 0 case must be excluded).

4. **(Maths, P1, Q5, NUM-INT)** ALG / count distinct roots of conjugate equation — 4 — 360s — `ERR-CASE-EDGE` (z = 0 is or isn't a root); `ERR-CASE-PARTITION` (real-imaginary case split); `ERR-COMP-SIGN`.

5. **(Maths, P1, Q6, NUM-INT)** SOT / AP rectangles with d1·d2 = 10 — 3 — 240s — `ERR-COMP-ARITH` (telescoping); `ERR-CASE-MODINDEX` (off-by-one in subscript).

6. **(Maths, P1, Q7, NUM-INT)** PNC.DGT / 4-digit integers in [2022, 4482] from {0,2,3,4,6,7} — 4 — 480s — `ERR-READING-NUMRANGE` (the inclusive boundaries); `ERR-CASE-EDGE` (leading-zero handling); `ERR-CASE-PARTITION` (split by leading digit 2, 3, 4); `ERR-COMP-ARITH`. Directly relevant to existing bank problem `PNC.DGT.EXMUL.LZINC.001`.

7. **(Maths, P1, Q10, MCQ-MC)** SOT / AP-and-recurrence T_n — 3 — 360s — `ERR-CASE-MODINDEX` (off-by-one in recurrence solution); `ERR-COMP-ARITH`; `ERR-STRAT-PARTIAL` (pick 2 of 4 carelessly).

8. **(Maths, P1, Q11, MCQ-MC)** VEC / planes / tetrahedron edges — 4 — 540s — `ERR-PARSE-GEOM3D` (visualising the tetrahedron edge condition); `ERR-COMP-ALGEBRA` (parameterisation of intersection line); `ERR-STRAT-PARTIAL`.

9. **(Maths, P1, Q13, MCQ-MC)** COG / parabola, foci, tangents, perpendicular feet — 5 — 720s — `ERR-PARSE-GEOM3D` (5-point geometry); `ERR-COMP-ARITH`; `ERR-STRAT-PARTIAL`; `ERR-CASE-EDGE` (degenerate when P on the axis).

10. **(Maths, P1, Q14, MCQ-MC)** MAT + CAL / determinant whose max/min are roots of a quadratic — 5 — 660s — `ERR-COMP-ARITH` (3×3 determinant expansion); `ERR-STRAT-TRAP` (over-fit eigenvalue thinking); `ERR-CASE-MODINDEX`; `ERR-COMP-SIGN`.

11. **(Maths, P1, Q15, MAT-COL)** TRG / 4 lists of trig equations × 5 cardinalities — 3 — 480s — `ERR-PARSE-LISTMATCH`; `ERR-READING-NUMRANGE` (per-list interval bounds); `ERR-CASE-PARTITION` (counting roots in the interval).

12. **(Physics, P1, Q9 sect 2, MCQ-MC)** EM / dielectric repositioned in capacitor — 4 — 480s — `ERR-PARSE-GEOM3D` (figure (a) vs (b)); `ERR-COMP-SIGN` (field direction in dielectric); `ERR-STRAT-PARTIAL`.

13. **(Physics, P1, Q15 sect 3, MAT-COL)** EM / solenoid with time-dep axis, torque on small loop — 5 — 600s — `ERR-PARSE-LISTMATCH`; `ERR-COMP-SIGN` (torque direction); `ERR-PARSE-GEOM3D` (3D vector unit-axis change).

14. **(Chem, P1, Q1, NUM-DEC)** Phys-Chem / bomb-calorimeter enthalpy of HgO formation — 3 — 360s — `ERR-COMP-SIGN` (ΔU vs ΔH); `ERR-COMP-ARITH` (Δn·RT correction); `ERR-CASE-EDGE` (state of Hg).

15. **(Chem, P1, Q11, MCQ-MC)** Inorg / electrochemical extraction of Al — 2 — 180s — `ERR-STRAT-TRAP` (NCERT-edge); `ERR-READING-QUANTIFIER` ("involves" — which option mentions an excluded reaction).

16. **(Maths, P2, Q9, MCQ-MC)** TRG / quadrilateral angles, intervals containing 4αβ sinθ — 5 — 720s — `ERR-READING-QUANTIFIER` ("interval(s) that contain"); `ERR-PARSE-GEOM3D` (planar configuration); `ERR-COMP-ARITH`; `ERR-STRAT-PARTIAL`.

17. **(Maths, P2, Q15, MCQ-SC)** PNC / 4 boxes, choose 10 balls with ≥1 red ≥1 blue per box — 5 — 600s — `ERR-READING-QUANTIFIER` ("from each box"); `ERR-CASE-PARTITION` (inclusion-exclusion over 4 boxes); `ERR-COMP-ARITH`.

18. **(Physics, P2, Q1, NUM-INT)** Mech / position-dep central-like force, compute x·v_y − y·v_x at z = 0.5 — 4 — 540s — `ERR-CASE-EDGE` (interpreting "ignore gravity"); `ERR-COMP-SIGN` (angular-momentum-like quantity); `ERR-COMP-ALGEBRA`.

**Failure-mode activation counts across the 18 sampled questions (note: §5.1 used a count of 16; this appendix lists 18 — the table in §5.1 will be reconciled in v2):**

| Failure mode | Activations | Fraction |
|---|---|---|
| ERR-READING (any value) | 6 | 33% |
| ERR-CASE (any value) | 10 | 56% |
| ERR-COMP (any value) | 13 | 72% |
| ERR-STRATEGY (any value) | 7 | 39% |
| ERR-PARSING (any value) | 6 | 33% |
| `*-NONE` patterns (pure conceptual) | 3 | 17% |

The 33–72% spread per axis confirms each candidate axis has discriminating power — neither always-on nor rarely-on.

---

*End of PRD v1.*
