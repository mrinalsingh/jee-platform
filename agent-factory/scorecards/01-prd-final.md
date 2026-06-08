# PRD: Diagnostic Failure-Mode Axes — Extended Question Identity Layer

**Stage:** 1 (Spec Loop) | **Iteration:** v3 | **Author:** Product Manager (generator)
**Reviewed by:** Spec Critic (pending) | **Scope window:** JEE Advanced 2022 Paper 1 + Paper 2, all of P-C-M
**Prior reviews:** v1 7/10 (6 blockers); v2 7/10 (stalled — 4 cleanly fixed, 2 partial, 1 NEW critical). This v3 addresses every v2 blocker additively — nothing good from v1+v2 has been removed.

---

## Change-Log (v2 → v3)

Every change in this document is marked inline with `[UPDATED v3]`. v1 and v2 markers are preserved. Summary of v3 deltas:

1. **[UPDATED v3 — META-FIX, v2 Blocker 2 (CRITICAL)]** §6 A.3 no longer specifies a Postgres `GENERATED ALWAYS AS` SQL block (which doesn't compile — subqueries and SRFs aren't allowed in generated expressions). v3 specifies the **invariant as a contract**, with acceptance criteria, and delegates the mechanism choice (`GENERATED ... STORED`, deferred trigger, materialised view, scheduled rebuild + read-side derivation) to the Stage-2 Architect. This is the right layering per the agent-factory constitution. §6 A.3 prose, §7 NFR "Data integrity", §9 Dependencies, and §6 A.6 migration cost are all updated to match.
2. **[UPDATED v3 — v2 Blocker 1 (HIGH)]** §5.3 now uses **exactly one counting convention everywhere**: the matrix counts from Appendix B (7/12/14/7/7 over 18). The "conservative" 6/10/13/7/6 framing is removed. Percentages re-derived to 39% / 67% / 78% / 39% / 39%. §5.3, §6 Option A vs B trade-off discussion, and Appendix B "dual reporting" defense all updated. Appendix B is now a pure matrix appendix — no third counting convention exists in v3.
3. **[UPDATED v3 — v2 Blocker 3 (MEDIUM-HIGH)]** Phase-A SPMR's collision predicate is now specified to use **the same equality rule as US-1's matcher** — including NUM-DEC normalisation to `answer.precision` via `toFixed(precision)` byte-equality. §3 (where SPMR is defined) cross-references §6 / US-1; US-1 (where wrong-path matching is specified) cross-references §3. A new US-4 AC requires the importer SPMR and the runtime matcher to share one normaliser module.
4. **[UPDATED v3 — v2 Blocker 4 (MEDIUM)]** The "single-reviewer fallback" handwave is removed. §9 and §10 Q4 now state honestly: if only one reviewer is available, calibration cannot start and the diagnosis card is gated behind a feature flag until a second reviewer arrives. This is the simpler, more honest answer.
5. **[UPDATED v3 — v2 Non-Blocking #5]** §3 Phase-A justification corrected: SPMR is the *bank-side* upper bound on US-1's single-dominant-diagnosis rate. The *student-side* ceiling is `SPMR × (1 − E2_rate)`. One-sentence calibration of reader expectations.
6. **[UPDATED v3 — v2 Non-Blocking #6]** §7.1 adds an explicit **total reviewer-hour budget line** (up to 15 reviewer-hours: 5 calibration + 10 inter-rater) so the user can make an informed scope decision in §10 Q4 + Q7.
7. **[UPDATED v3 — v2 Non-Blocking #7]** US-1's ambiguous-match (≥2 paths share `landed_on_option`) UX is explicitly flagged as a **Stage-4 UX Audit ticket**. The Stage-4 UX Auditor tests whether stressed students experience the side-by-side card as useful or as the platform punting; if hostile, fall back to "most common path with subtler 'could also be …' indicator." Added to US-1 notes and to §8 (Stage-4 dependency).
8. **[UPDATED v3 — v2 Non-Blocking #8]** §10 Q2 (missing axis values) is now scoped with a deadline: if new values are added after the calibration set begins, the calibration must restart from problem 1. Decision needed *before* the reviewer starts calibration.
9. **[UPDATED v3 — v2 Non-Blocking #10]** §9 single-reviewer text now explicitly cross-references §10 Q4 ("decision needed — see §10 Q4"); §10 Q4 cross-references §9 ("resolves the gating decision in §9"). (Resolved indirectly when the fallback was dropped per Blocker 4.)
10. **[UPDATED v3 — delegation principle applied beyond §6 A.3]** Per the same architect-vs-PM layering rule, two other implementation-leaning details are downgraded to contract-only:
    - **SPMR query mechanism.** v2 said "computed by a one-line query (`group by question_code, landed_on_option having count(*) > 1`)". v3 specifies SPMR's *definition* (the equality predicate, what counts as a collision) and leaves the *query technique* (raw SQL, Prisma aggregate, materialised view, importer-time compute) to the Architect.
    - **Generated-summary indexing mechanism.** v2 specified `GIN` indices on `text[]` columns. v3 specifies the *query requirement* ("US-2 set construction MUST meet 800 ms p95 at ≤10⁴ problems") and lets the Architect pick the index type once the storage mechanism is chosen.

v1+v2 wins kept intact: change-log discipline, the warm-up budget in §7.1, the deterministic matcher in US-1, Phase A / Phase B split, Appendix A 18-question worksheet, Appendix B matrix, the all-`NONE` "didn't see the idea" encoding, the calibrated-transition κ gate, the immutable-`calibrated` upsert rule, the `idea_secondary` deferred-decision trigger.

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

Without a tag that lets the platform pin each wrong attempt onto one or more of these causes, remediation collapses into "do more questions on this topic" — which is exactly the failure of mainstream coaching that **PROJECT CONTEXT §2** (`/docs/PROJECT CONTEXT.md`) calls out.

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

## 3. Success Metrics  **[UPDATED v2 — Blocker 4 / further refined v3]**

The success metrics are split into two phases, because the v1 single North Star was unmeasurable until Stage-10 pilot (months away). Phase A is what this PRD actually delivers and can be measured immediately. Phase B is the long-horizon proof that has to wait for real students.

### Phase A — Measurable during this build (Stages 2–9, weeks-to-months horizon)

**Phase-A North Star: *Single-Path Match Rate* (SPMR).**

> The fraction of `wrong_paths` entries across the bank that are *unambiguously matched* by their `landed_on_option`, where "unambiguously matched" means: for every other `wrong_paths` entry on the same problem, the **normalised** `landed_on_option` differs (i.e. no two wrong paths on the same problem share a normalised `landed_on_option`).

**[UPDATED v3 — v2 Blocker 3]** SPMR's collision predicate MUST use the **identical equality rule** that US-1's matcher uses (the student-side runtime matcher):

- For `MCQ-SC`, `MCQ-MC`, `MAT-COL`: exact string equality on `landed_on_option`.
- For `NUM-INT`: integer equality after parsing.
- For `NUM-DEC`: byte-equality after both sides are normalised to `problems.answer.precision` decimal places using `toFixed(precision)` (banker's rounding).

Two NUM-DEC `wrong_paths` entries with `landed_on_option = "3.14"` and `"3.140"` (where `answer.precision = 2`) **do** collide under SPMR in v3, because they collide under US-1's matcher. The bank-side metric and the student-side matcher MUST be the same predicate, or the metric is wrong-by-construction. A single shared normaliser module enforces this — see US-4 AC.

The *technique* for computing SPMR over the bank (raw SQL group-by, importer-time compute, materialised view, …) is **delegated to the Stage-2 Architect**. The Architect picks the simplest mechanism that satisfies: (a) per-import SPMR reported in the importer's summary output (US-4 AC), (b) bank-level SPMR queryable on demand without scanning JSON at runtime. **[UPDATED v3 — delegation principle]**

Why this is the right Phase-A North Star:
- It is **computable against the existing 2 problems today, and against every new problem the moment it imports.** No students, no attempts, no pilot needed.
- It is the **bank-side upper bound on US-1's single-dominant-diagnosis rate.** **[UPDATED v3 — v2 Non-Blocking #5]** The *student-side* ceiling additionally requires the E2 (uncatalogued / zero-match) rate to stay low: US-1's true single-dominant-diagnosis rate ≤ `SPMR × (1 − E2_rate)`. SPMR alone does not bound it; both inputs must be healthy. E2_rate is a Phase-B measurement (it needs real attempts to estimate).
- It is a single number per snapshot of the bank, recomputed cheaply by the mechanism the Architect picks.
- **Target: ≥ 90% by end-of-build (Stage 9).** Baseline today (2 problems × 3 wrong paths each = 6 entries): computed on import and reported in the importer's summary output. **If SPMR < 90% during authoring, the affected problems are flagged for the reviewer to split or merge wrong paths until SPMR ≥ 90%.**

**Phase-A Leading indicators:**
1. **Tag coverage** — fraction of problems in the bank with all 5 diagnostic axes populated on every `wrong_paths` entry. Target: 100% before any problem becomes `calibrated`.
2. **Inter-rater agreement (Cohen's κ) per axis** between two independent reviewers tagging the same 30 problems blind. Target: κ ≥ 0.65 per axis on the calibration set.
3. **Median human tagging time per problem** for all diagnostic axes. Target: ≤ 4 minutes per problem in **steady state** (after a reviewer has tagged ≥ 30 problems — see §7.1 for the warm-up budget).
4. **Dominant-mode rate on bank-level rollups** — fraction of problems for which the union of `wrong_paths.diagnostic_tags` across all paths shows a single non-`NONE` value dominating ≥ 60% of paths on one axis. A high number here means the bank's problems are not all "one-trick-pony" problems. Target: monitored, not gated. Reported per import batch.

### Phase B — Measurable only post-pilot (Stage 10+, multi-month horizon)

**Phase-B North Star: *Diagnosis Specificity Rate (DSR)*.**
> In a representative pilot of ≥ 1,000 attempts over ≥ 50 students, the fraction of wrong attempts that produce exactly one diagnostic-axis hit (i.e. exactly one wrong path on the problem matches the student's `landed_on_option` under the same shared normaliser used by SPMR).

Target at pilot end (T+60 days post-pilot-launch): **≥ 55%.** Baseline today: 0% (the system cannot distinguish failure modes at all). DSR is the count of exactly-one-match attempts divided by total wrong attempts; it is a deterministic ratio with no probabilistic model.

**Phase-B Leading indicators (pilot only):**
- **Student-perceived utility:** post-test survey "did the diagnosis card help you understand your mistake?" — yes/no/somewhat. Target: ≥ 60% yes.
- **Teacher-built drill click-through:** fraction of teacher-built US-2 sets that students actually start within 24 h. Target: ≥ 70%.
- **E2 (uncatalogued-path) rate:** fraction of wrong attempts that match zero cataloged wrong paths. **[UPDATED v3]** Target: ≤ 15%. This is the second input to US-1's single-dominant-diagnosis ceiling (see SPMR justification above); it cannot be measured pre-pilot.

### Guardrails (must NOT degrade — applies in both phases)

1. **Existing 7-axis identity remains intact and queryable.** All current YAML files and the Prisma `Problem` table continue to validate and import. Zero regressions in importer tests.
2. **Authoring throughput.** Time from "Claude returns a candidate problem" to "human-approved YAML on disk" stays ≤ 25% above the current pre-extension baseline, measured in *steady state* (after warm-up — see §7.1).
3. **Tagging time at the high end** — no diagnostic axis takes a trained reviewer (post-warm-up) > 90 seconds in isolation (the cap protects throughput).

---

## 4. User Stories

### US-1: Student diagnoses their own wrong attempt (S)  **[UPDATED v2 — Blocker 3 / v3 ambiguous-UX note]**

**As a** median JEE aspirant, **I want to** see, for each question I got wrong on a test, the single most likely *type of mistake* I made (not just the topic), **so that** I know whether to drill the idea, the counting, the reading, or the time-management — and don't waste an hour on the wrong fix.

**Matching mechanism (deterministic, no probability model):**

> The diagnosis engine looks up `wrong_paths` for the problem, filters to entries where `landed_on_option` equals the student's answer under the **shared normaliser** (see below), and:
> - **Exactly one match → display that path's `diagnostic_tags`.** This is the "single dominant diagnosis" case.
> - **Two or more matches → display each match's tags side-by-side, labelled "multiple matched paths — review which one is yours".** This is the ambiguous case. No silent pick.
> - **Zero matches → "uncatalogued wrong path"** (Error path E2 below).

**[UPDATED v3 — v2 Blocker 3]** The "shared normaliser" is a single helper module used by BOTH the runtime matcher here AND the bank-side SPMR computation (§3 Phase A):

- For MCQ-SC, MCQ-MC, MAT-COL: exact string equality.
- For NUM-INT: integer equality after parsing.
- For NUM-DEC: byte-equality after both sides normalise to `problems.answer.precision` decimal places using `toFixed(precision)` (banker's rounding).

This is a **deterministic exact-match** lookup. There is no posterior, no confidence number, no threshold. SPMR exists precisely so the engineering team can monitor and minimise the ambiguous-case rate at authoring time.

**[UPDATED v3 — v2 Non-Blocking #7 — Stage-4 UX dependency]** The ≥2-match side-by-side card asks a stressed, post-mock student to self-disambiguate exactly the thing the platform promised to diagnose. SPMR ≥ 90% means the card fires on ≤10% of attempts, but the UX still needs Stage-4 audit. **Stage-4 UX Auditor MUST specifically test:**
- Whether stressed students experience the side-by-side as useful or as the platform punting.
- Cognitive-load: ≥2 paths × 5 axis tags each = up to 10 acronyms simultaneously visible.
- Whether seeing "we couldn't tell" once causes students to discount the diagnosis card next time.

**Fallback decision recorded for Stage 4:** if usability shows the side-by-side is hostile, fall back to "display the most common path with a subtler 'this could also be …' indicator on the others." This fallback is reserved as a Stage-4 option; it does NOT silently pick, and the matched-path metadata is preserved on the wire either way.

**Acceptance Criteria:**
- [ ] Given a completed attempt where the student answered incorrectly, when the student opens the post-test review for that question, then the screen shows: the student's answer, the correct answer, the question's `idea + sub_idea` (existing), AND the inferred dominant failure mode (chosen from the diagnostic-axis taxonomy of the matched wrong path) with a one-sentence plain-English label.
- [ ] Given the student's `landed_on_option` matches two or more `wrong_paths` entries on the same problem under the shared normaliser, when the review screen renders, then it shows each matched path's `diagnostic_tags` side-by-side under the label *"multiple matched paths — review which one is yours"*, with no silent pick. (Stage-4 UX Auditor may approve a fallback "most-common + subtler indicator" rendering after testing — see notes above.)
- [ ] Given the question is `provisional` (status field), when the review screen renders, then it shows the diagnosis with a "draft" badge — distinguishing it from `calibrated` problems whose wrong-paths are battle-tested.
- [ ] Given the student answered correctly but `time_seconds > authored_time_by_round[round_at_time] × 1.5`, when the review screen renders, then it shows a "right answer, slow path" badge and the pacing-axis value of the question.
- [ ] Given the student left the question blank, when the review screen renders, then it does NOT display a failure-mode diagnosis (we have no signal) and instead shows the question's authored `intrinsic_difficulty` and `authored_time_by_round[round_at_time]` for self-comparison.

**Flow (happy path):**
1. Trigger: student finishes a test, lands on the test-review page.
2. Step: student taps a wrong-answer question card → server reads `attempts.row` + `problems.wrong_paths` + diagnostic axes → matches the student's wrong answer to the wrong-path whose `landed_on_option` equals what the student picked under the shared normaliser → server returns the diagnostic-axis values from that wrong path.
3. Step: page renders the diagnosis card with one bold sentence ("You miscounted the leading-zero correction in this digit problem") + a chip with the diagnostic-axis tag (e.g., `ERR-CASE-LEADZERO`) + a "see similar drill" button.
4. Outcome: student taps "see similar drill" → server runs the personalised-practice flow (US-3) filtered to the same dominant failure mode.

**Error paths:**
- **E1 — Multiple wrong paths match.** The wrong answer the student entered matches `landed_on_option` (under shared normaliser) of two or more `wrong_paths` entries for that question. → System surfaces all matched paths side-by-side as described in the matching mechanism. Logs the (student_id, question_code, match_count) triple for the SPMR rollup so authoring can fix the ambiguity at the source.
- **E2 — No wrong path matches.** The student's wrong answer matches no entry in `wrong_paths` (their failure is novel). → System surfaces "uncatalogued wrong path — flagged for content review", appends a row to the `problems_diagnostic_misses` table (`student_id, question_code, wrong_answer, created_at`), and falls back to showing only the topic/idea diagnosis (no failure-mode tag).
- **E3 — Question file missing required diagnostic axes.** The `problems` row has null in the new diagnostic axis columns (e.g., bank entry written before the migration). → System displays the legacy 7-axis identity only and a small "diagnostics not yet available for this problem" line. Never throws.

**Edge cases:**
- Multi-correct (`MCQ-MC`) partial-credit case: student picked 2 of the 3 correct options. → Treated as "partially correct" not "wrong"; failure-mode diagnosis fires only if the student picked at least one *incorrect* option. The diagnosis is keyed off the incorrect picks. For each incorrect pick, the matcher runs independently and the per-pick results are concatenated under the per-option diagnosis card.
- Numerical (`NUM-INT` / `NUM-DEC`) case: governed by the shared normaliser above. The importer (US-4) enforces that every `landed_on_option` for `NUM-INT` / `NUM-DEC` is a number with ≤ `answer.precision` decimal places — otherwise the file is rejected with `INVALID_LANDED_OPTION_PRECISION`. Off-by-decimal-places and off-by-sign remain distinct wrong paths.

---

### US-2: Teacher targets a specific failure mode for one student (T)

**As a** subject teacher, **I want to** generate a 10–15 question practice set for one of my students that specifically targets the failure mode I see in their last 50 attempts, **so that** I am not just assigning "more PNC" when their problem is reading the cap on a variable.

**Acceptance Criteria:**
- [ ] Given a student with ≥ 30 attempts in the last 14 days, when the teacher opens that student's profile, then the system displays a ranked list of the top 3 failure-mode axis-values from the student's wrong attempts, each with: count of wrong attempts, fraction of total wrong attempts, and a one-sentence explanation.
- [ ] Given the teacher selects exactly one failure-mode axis-value (e.g. `ERR-READING-QUANTIFIER`), when the teacher clicks "build practice set", then the system returns 10 questions where: (a) every question's `wrong_paths` contains at least one entry whose diagnostic axes include the selected value; (b) ≤ 30% of the returned questions share `topic` to avoid topic-only drilling; (c) intrinsic-difficulty spread satisfies: **at least 2 are T1, at least 3 are T2, at least 3 are T3, at least 2 are T4** (sums to 10; no tier missing).
- [ ] Given fewer than 10 questions in the bank satisfy the constraint, when the teacher clicks "build", then the system returns as many as exist (down to a minimum of 4) and shows "only N matched — taxonomy needs more questions tagged with this failure mode" with the matched count. When the difficulty-spread constraint cannot be met (e.g. only 1 T4 question matches), the system relaxes the spread requirement and surfaces a warning identifying the missing tier(s).
- [ ] Given the teacher selects two or more failure-mode axis-values, when the teacher clicks "build", then the system AND-filters (each returned question is taggable to ALL selected modes via its wrong-paths).
- [ ] Given the student has fewer than 30 attempts, when the teacher opens that student's profile, then the system displays a "not enough signal — need ≥ 30 attempts, currently has X" banner and disables the "build set" button.

**Flow (happy path):**
1. Trigger: teacher logs in, opens student S's profile.
2. Step: profile page shows ranked failure-mode list → teacher clicks the top one (e.g., `ERR-CASE-EDGE`, 14/40 wrong attempts).
3. Step: teacher clicks "build practice set (10 Qs)" → server runs constraint-satisfaction over the `problems` table filtered by the per-problem diagnostic summary (the **DB-derived summary** from §6 A.3, mechanism chosen by Architect) → returns 10 question codes.
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

**As a** content reviewer, **I want to** tag every diagnostic axis on a Claude-generated YAML problem in ≤ 4 minutes (steady state) and have the importer reject the file if any required diagnostic axis is missing or has a value not present in `taxonomy/maths.yaml`, **so that** no problem reaches `calibrated` status without complete diagnostic identity.

**Acceptance Criteria:**
- [ ] Given a YAML file in `content/maths/generated/` with the legacy 7-axis fingerprint present but the new `diagnostics` block missing, when the importer runs, then the file is rejected with exit code 1 and the message `MISSING_FIELD: diagnostics`.
- [ ] Given a YAML file with `diagnostics.<axis_name> = <value>` where `<value>` is not enumerated under that axis in `taxonomy/maths.yaml`, when the importer runs, then the file is rejected with exit code 1 and the message `UNKNOWN_TAXONOMY_VALUE: diagnostics.<axis_name>=<value>`. (Per **PROJECT CONTEXT §4** — "no miscellaneous tags — extend the taxonomy.")
- [ ] Given the reviewer extends `taxonomy/maths.yaml` with a new value and then re-runs the importer on the same file, when the importer runs, then it accepts the file. No code change required.
- [ ] Given the YAML file's `wrong_paths` array has any entry without a `diagnostic_tags` sub-field, when the importer runs, then the file is rejected with `MISSING_FIELD: wrong_paths[i].diagnostic_tags`.
- [ ] Given the YAML file's `wrong_paths` array has any entry whose `landed_on_option` (for `NUM-INT` / `NUM-DEC` answer types) carries more decimal places than `problems.answer.precision`, when the importer runs, then the file is rejected with `INVALID_LANDED_OPTION_PRECISION: wrong_paths[i].landed_on_option`.
- [ ] Given the importer successfully imports a problem, when it logs the per-import summary, then it reports the bank-level **Single-Path Match Rate (SPMR)** as defined in §3 Phase A. If the imported problem's wrong-paths contain a `landed_on_option` collision (two paths same `landed_on_option` *under the shared normaliser*), the importer prints a warning `SPMR_COLLISION: question_code=<code>, landed_on_option=<value>, paths=[i, j]` but does NOT reject — it is reviewer-resolved.
- [ ] **[UPDATED v3 — v2 Blocker 3]** The importer's SPMR collision check and US-1's runtime matcher MUST call the same shared normaliser module (one source file, one set of unit tests). A CI test asserts both call-sites import from the same module; any future divergence breaks the build.
- [ ] Given two reviewers independently tag the same 30 problems blind, when the disagreement report is computed, then Cohen's κ for every diagnostic axis is ≥ 0.65; below that, the axis is flagged "needs sharper definition" and held out of the production diagnosis engine until re-defined.
- [ ] Given a problem in `provisional` status, it can only transition to `calibrated` when **(a)** all 5 diagnostic axes on all wrong-paths are populated, **(b)** every diagnostic axis has passed the κ ≥ 0.65 gate on the most-recent calibration set, AND **(c)** SPMR for this problem is 100% under the shared normaliser (no `landed_on_option` collision among its own wrong paths). Otherwise the transition is rejected with `CALIBRATION_INCOMPLETE: <reason>`.

**Flow (happy path):**
1. Trigger: Claude returns a generated problem; reviewer opens the YAML in their editor.
2. Step: reviewer fills the 7 legacy axes (existing flow) + the new `diagnostics` block + adds `diagnostic_tags: [<axis>=<value>, ...]` to each `wrong_paths` entry.
3. Step: reviewer runs `npm run import:problems` (Stage 3 importer).
4. Step: importer validates against `taxonomy/maths.yaml`, writes a row to `problems`.
5. Outcome: reviewer marks the problem `calibrated` and `approved_at = now()` — subject to the calibration gate above.

**Error paths:**
- **E1 — Reviewer omits the diagnostics block entirely.** Importer rejects with the precise field path. Reviewer adds the block, re-runs.
- **E2 — Reviewer uses a typo for an enum value (e.g. `ERR-COUTING` instead of `ERR-COUNTING`).** Importer rejects with the unknown-value message and lists valid values for that axis.
- **E3 — A new failure mode is observed in the field that isn't in the taxonomy.** Reviewer extends `taxonomy/maths.yaml`, opens a PR, the importer re-validates. **No quick-fix back door.** This is by design — see §7 NFR.

**Edge cases:**
- The same problem is re-imported (idempotency). → The importer treats `question_code` as the upsert key. If diagnostic axes changed and the problem is `provisional`, update is allowed. If the problem is `calibrated`, update is rejected with `CALIBRATED_IMMUTABLE` (per `/content/maths/generated/_SCHEMA.md` §5).

---

## 5. Empirically Grounded Axis Proposal — Show The Work

### 5.1 Sample analysed — 18 questions from JEE Advanced 2022 P1 + P2 — PCM

Full per-question worksheet is in **Appendix A**. The per-axis activation matrix used for §5.3 is in **Appendix B**. Summary table below:

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

Each failure mode below shows up in ≥ 2 of the 18 sample questions. Modes that appeared only once were either rolled into a broader bucket or rejected as not having "discriminating power" yet.

| Bucket | Sample Qs in which it activates | What the bucket means |
|---|---|---|
| **Reading: quantifier / scope** | P1-M-Q3, P2-M-Q9, P2-M-Q15, P1-Chem-Q11 | The student missed a word like "exactly", "at least", "contain*s*", "from each", "non-zero" — the math they then did was correct for the misread problem. |
| **Reading: numeric / range constant** | P1-M-Q1, P1-M-Q7, P1-M-Q15 | The student missed a specific numeric bound (`[2022, 4482]`, `[-2π/3, 2π/3]`, principal-value range). |
| **Case-handling: edge / boundary** | P1-M-Q4, P1-M-Q5, P1-M-Q7, P1-Phys-Q9, P1-Chem-Q1, P2-Phys-Q1 | A boundary or degenerate case was dropped or double-counted. |
| **Case-handling: mod / index parity** | P1-M-Q6, P1-M-Q10, P1-M-Q14 | The student got the period/parity of an iterated operation wrong. |
| **Case-handling: partition** | P1-M-Q3, P1-M-Q5, P1-M-Q15, P2-M-Q15 | Missing or duplicate sub-case in a case enumeration. |
| **Computation: arithmetic** | P1-M-Q1, P1-M-Q6, P1-M-Q10, P1-M-Q13, P1-M-Q14, P1-Chem-Q1, P2-M-Q9, P2-M-Q15 | The set-up was right; the numbers were wrong. |
| **Computation: sign / orientation** | P1-M-Q5, P1-M-Q14, P1-Phys-Q9, P1-Phys-Q15, P1-Chem-Q1, P2-Phys-Q1 | A sign or direction was flipped. |
| **Computation: algebra slip** | P1-M-Q4, P1-M-Q11, P2-Phys-Q1 | Algebraic manipulation slip (wrong identity, factoring error). |
| **Strategy: trap-taken (eigen / Cayley / L'Hopital / NCERT)** | P1-M-Q14, P1-Chem-Q11 | The student reached for the baited machinery; the same problem yielded to elementary methods. |
| **Strategy: partial-marking miss** (MCQ-MC) | P1-M-Q10, P1-M-Q11, P1-M-Q13, P1-Phys-Q9, P2-M-Q9 | The student picked too many or too few options because they didn't compute the +1/+2 vs −2 expected value. |
| **Comprehension / list-match parsing** | P1-M-Q15, P1-Phys-Q15 | The student mapped the wrong List-I entry to a List-II entry — even though they computed each List-I entry correctly. Note: P1-M-Q3 (long-passage probability) is captured under ERR-PARSE-PASSAGE below. |
| **Parsing: passage** | P1-M-Q3 | Misunderstood the comprehension passage / multi-paragraph setup. (Only one sample Q; retained because it is a structurally distinct kind of parsing failure that the 7-paragraph Q3 was specifically engineered to test, and we expect it to recur on future passage problems. Flagged in §5.3 as "low-evidence — re-validate when bank reaches 30 problems".) |
| **Visualisation: geometry / 3D** | P1-M-Q11, P1-M-Q13, P1-Phys-Q9, P1-Phys-Q15, P2-M-Q9 | The student couldn't form/hold the figure in their head and so couldn't set up the algebra. |
| **Pacing: ran out of time** | P1-M-Q13, P1-M-Q14, P1-Phys-Q15 | The student knew the idea but couldn't execute it in the time budget for that question type. **Note: this becomes a derived per-question property, not a failure-mode axis — see §5.3.** |
| **Concept: didn't see the IDEA** | P1-M-Q5, P1-M-Q14, P2-Phys-Q1 | The "ah, I see it" moment never happened. This is the only failure the current 7-axis model isolates. Encoded by the all-`NONE` pattern across the 5 diagnostic axes — see §6 A.1. |

Fourteen buckets, distributed across PCM. No subject is exempt from any of the *failure-mode-axis* buckets (i.e. excluding pacing and pure concept).

### 5.3 Grouping the buckets into candidate axes  **[UPDATED v3 — v2 Blocker 1: matrix counts everywhere; conservative count removed]**

The 14 buckets above collapse into **5 candidate axes**, each axis ranging over the buckets that share a common student-side intervention. **Activation counts below are the matrix counts from Appendix B (every cell is 1 if the question's wrong-path list contains at least one non-`NONE` tag on that axis, else 0).** This is the only counting convention in v3.

| Candidate axis | Axis values | Activations / 18 | % | Discriminating power assessment |
|---|---|---|---|---|
| **ERR-READING** — what kind of misreading | `ERR-READING-QUANTIFIER`, `ERR-READING-NUMRANGE`, `ERR-READING-VARDEF`, `ERR-READING-NONE` | **7 / 18** | **39%** | Discriminating (within [10%, 85%] retention band). |
| **ERR-CASE** — what kind of case mishandling | `ERR-CASE-EDGE`, `ERR-CASE-MODINDEX`, `ERR-CASE-PARTITION`, `ERR-CASE-NONE` | **12 / 18** | **67%** | Discriminating. |
| **ERR-COMP** — what kind of computation slip | `ERR-COMP-ARITH`, `ERR-COMP-SIGN`, `ERR-COMP-ALGEBRA`, `ERR-COMP-NONE` | **14 / 18** | **78%** | Most common axis. Below the 85% rejection threshold (which would mean "always-on, so non-discriminating") but close — re-validation gated at 30-problem milestone. The sub-values split it further (arith vs sign vs algebra are independent failure modes), which restores discrimination within the axis. |
| **ERR-STRATEGY** — strategic / meta error | `ERR-STRAT-TRAP`, `ERR-STRAT-PARTIAL`, `ERR-STRAT-NONE` | **7 / 18** | **39%** | Discriminating. Critically: every MCQ-MC question can carry an `ERR-STRAT-PARTIAL` mode on at least one wrong path. |
| **ERR-PARSING** — failure to map statement to math | `ERR-PARSE-LISTMATCH`, `ERR-PARSE-GEOM3D`, `ERR-PARSE-PASSAGE`, `ERR-PARSE-NONE` | **7 / 18** | **39%** | Discriminating. `ERR-PARSE-PASSAGE` is low-evidence (1 sample Q); flagged for re-validation at 30-problem milestone but kept on the axis since it is a structurally distinct kind of parsing failure. |

**Decision rule used:** an axis is retained iff its activation rate is in [10%, 85%] of the sample. Outside this band, the axis is either too rare to be useful or so universal it doesn't discriminate. All 5 candidate axes pass this rule (ERR-COMP at 78% is the closest to the ceiling and is explicitly flagged for re-validation).

**Two more dimensions emerged from §5.2 that do NOT belong on the *failure-mode* layer because they describe properties of the *question*, not the *wrong path*:**

- **Pacing axis** (`PACE-TIGHT` vs `PACE-LOOSE`) — a property of the question (its `authored_time_by_round` vs the section's time budget). Already implicit in `authored_time_by_round`. We do not add a new axis for it; we expose it as a derived field in queries.
- **Concept-not-seen** — the existing axes 3 (IDEA) and 4 (SUB-IDEA) already pinpoint the concept. A wrong attempt where no other ERR-axis fits IS the "didn't see the idea" diagnosis by elimination. We make this explicit in §6 Option A by tagging that path as all-`NONE` across the 5 diagnostic axes.

### 5.4 Where the diagnostic axes attach in the data model

The diagnostic axes attach **per `wrong_paths` entry**, NOT per problem. Rationale: one problem has 2–3 distinct wrong paths (per `/content/maths/generated/_SCHEMA.md`). Each path is a *different* kind of failure — that's the whole point of recording multiple paths. Tagging at the problem level would lose the signal. Tagging per wrong path lets the inference engine in US-1 match the student's wrong answer to the right path, then read the failure-mode tags off that path.

A *summary* set of diagnostic axes is also stored at the problem level — the **union** of the per-path tags — so the query in US-2 ("find me questions that can test ERR-READING-QUANTIFIER") can filter on indexed problem-level columns without scanning JSON. **[UPDATED v3 — v2 Blocker 2 / meta-fix]** This summary is a DB-maintained invariant; the exact mechanism (`GENERATED ... STORED`, deferred trigger, materialised view, or scheduled rebuild + read-side derivation) is delegated to the Stage-2 Architect — see §6 A.3 for the requirement and acceptance criteria.

---

## 6. The Two Options — Both Fully Specified

### Option A: Orthogonal new "diagnostic" layer alongside the existing 7 axes

**Net effect: 7 existing identity axes + 5 new diagnostic axes = 12 axes total. The two layers are independent.**

#### A.1 The 5 new axes (added to `taxonomy/maths.yaml`)

```yaml
# Axis 8 — ERR-READING — what kind of misreading caused the wrong path — 4 values
err_reading:
  ERR-READING-NONE:        "No reading mistake on this path."
  ERR-READING-QUANTIFIER:  "Misread a quantifier (exactly / at least / contains / from each / non-zero / all)."
  ERR-READING-NUMRANGE:    "Misread a numeric bound or interval endpoint."
  ERR-READING-VARDEF:      "Misread a variable's defining property or domain."

# Axis 9 — ERR-CASE — what kind of case mishandling — 4 values
err_case:
  ERR-CASE-NONE:        "No case-handling mistake."
  ERR-CASE-EDGE:        "Boundary or degenerate case dropped or double-counted (incl. leading-zero, x=0, equality of two parameters)."
  ERR-CASE-MODINDEX:    "Wrong period / parity / cycle length on an iterated structure (recurrence, matrix power, modular)."
  ERR-CASE-PARTITION:   "Missing or duplicate sub-case in a case enumeration."

# Axis 10 — ERR-COMP — what kind of computation slip — 4 values
err_comp:
  ERR-COMP-NONE:    "No computation slip."
  ERR-COMP-ARITH:   "Arithmetic slip (a number added / multiplied wrong)."
  ERR-COMP-SIGN:    "Sign or orientation flipped (vector direction, negative of an integral, wrong root sign)."
  ERR-COMP-ALGEBRA: "Algebraic manipulation slip (wrong identity applied, factoring error)."

# Axis 11 — ERR-STRATEGY — strategic / meta error — 3 values
err_strategy:
  ERR-STRAT-NONE:    "No strategy error."
  ERR-STRAT-TRAP:    "Took the bait — invoked the trap machinery (eigen / Cayley / L'Hopital / NCERT-edge / length-of-problem) when simpler method exists."
  ERR-STRAT-PARTIAL: "Multi-correct partial-marking miscalibration (picked too many or too few options for the marking scheme's expected-value math)."

# Axis 12 — ERR-PARSING — failure to map statement to math — 4 values
err_parsing:
  ERR-PARSE-NONE:      "Statement was parsed correctly."
  ERR-PARSE-LISTMATCH: "Wrong mapping in List-I/List-II match (each computation correct in isolation)."
  ERR-PARSE-GEOM3D:    "Failed to form / hold the geometric or 3D figure correctly."
  ERR-PARSE-PASSAGE:   "Misunderstood the comprehension passage / multi-paragraph setup."

# Total axis values: 4 + 4 + 4 + 3 + 4 = 19
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

#### A.3 Per-problem summary axes — requirement and acceptance criteria  **[UPDATED v3 — META-FIX, v2 Blocker 2 (CRITICAL)]**

**Why this section was rewritten.** v1 specified that the importer populates mirror columns from JSON — that allowed silent desync if anything else wrote to the JSON. v2 attempted to fix the desync with a Postgres `GENERATED ALWAYS AS ... STORED` SQL expression — but Postgres does not allow subqueries or set-returning functions (`jsonb_array_elements`) inside generated-column expressions, so the migration would have failed at run time. v3 fixes the layering problem at root: the PRD specifies the **invariant** and **acceptance criteria**; the Stage-2 Architect picks the **mechanism**.

**The requirement (contract):**

> The summary array columns on `problems` (`err_reading_tags[]`, `err_case_tags[]`, `err_comp_tags[]`, `err_strategy_tags[]`, `err_parsing_tags[]`) MUST be guaranteed consistent with the `wrong_paths` JSONB source-of-truth. They MUST NOT be writable by application code, and any drift between summary and source MUST be structurally impossible — not policy-impossible. The exact mechanism (Postgres `GENERATED ALWAYS AS STORED`, deferred trigger, materialised view, or scheduled rebuild + read-side derivation) is delegated to the Stage 2 Architect, who picks the simplest mechanism Postgres supports for this expression shape.

**Acceptance criteria for the Architect (Stage 2 must satisfy all of these):**

1. **Write-through consistency.** Any UPDATE to `wrong_paths` is reflected in the summary columns within the same transaction (so a reader committing after the writer cannot observe stale summaries).
2. **No application-side write path.** No application-layer code path can write to the summary columns. An attempt to do so MUST fail (DB error, type error, or rejected migration) — not be silently ignored.
3. **Integration test.** A test in the importer suite asserts both invariants by attempting (and expecting failure on) a direct write to a summary column, and by mutating `wrong_paths` and asserting the summary updates inside the same transaction.
4. **Equality predicate.** The summary is the multiset union (deduplicated to a set, stored as text array) of the per-`wrong_paths` `diagnostic_tags` values on that axis, EXCLUDING the `NONE` value of that axis. (Including `NONE` would make every problem's summary contain `NONE` and the index useless.)
5. **Query performance.** US-2's set-construction query (filter problems by a single failure-mode tag in a summary column) MUST satisfy the §7 NFR (≤ 800 ms p95 at ≤ 10⁴ problems). The index type (GIN, expression index, …) is the Architect's call.

**Why the layering matters.** PRD-level requirements ("summary is consistent with source; application cannot write to summary") survive any future change of Postgres version, storage engine, or denormalisation strategy. SQL-level mechanism choices ("`GENERATED ALWAYS AS STORED`") do not, and locking the spec to a mechanism that may not compile (as v2 discovered) blocks Stage 2 instead of guiding it. The agent-factory constitution says the Architect picks the simplest correct mechanism; the PRD's job is to fence the requirement, not the technique.

**Prisma schema sketch (informative, NOT prescriptive):**

```prisma
model Problem {
  // ... existing columns
  wrongPaths       Json      // JSONB, source of truth for diagnostic tags

  // The 5 summary columns below are DB-maintained per §6 A.3.
  // The exact Prisma annotation (@db.Generated, @db.Computed, plain text[])
  // is determined by the mechanism the Architect chooses; not pre-committed here.
  errReadingTags   String[]
  errCaseTags      String[]
  errCompTags      String[]
  errStrategyTags  String[]
  errParsingTags   String[]
}
```

The architect adds the indices appropriate to the chosen storage mechanism.

#### A.4 Workflow impact on `_SCHEMA.md`
Bump `schema_version: 1 → 2`. Every new YAML file must have `diagnostic_tags` on every `wrong_paths` entry. Files at version 1 still validate but get rejected when imported as `calibrated` — they have to be re-tagged first.

#### A.5 Diagnostic power gained (new questions we can answer)
1. *"For student S, what is the most common kind of mistake?"* — group their wrong attempts by `wrong_paths.diagnostic_tags`, count.
2. *"Find me 10 questions to drill ERR-CASE-EDGE."* — filter on the per-problem summary column for ERR-CASE that includes `ERR-CASE-EDGE`, with topic-spread constraint.
3. *"Which axis is the platform best/worst at diagnosing?"* — for each diagnostic axis value, compute "% of student wrong attempts that matched a wrong_path with this tag". Low matches = axis underdefined; high matches = useful.
4. *"Is a problem testing too narrow a skill?"* — if every wrong-path is tagged with the same single failure mode, the problem doesn't really exercise the rich IDEA the fingerprint claims.

#### A.6 Migration cost  **[UPDATED v3 — meta-fix consequence]**
- One new Prisma migration adding the 5 summary columns and their indices. **The migration body depends on the Architect's mechanism choice**; the PRD does not pre-commit a specific SQL form. Both `GENERATED ... STORED` (if the Architect chooses a mechanism that doesn't require SRFs — e.g., normalising the JSONB shape so the expression becomes immutable) and trigger-based maintenance fit within Stage 2's day-1 effort budget.
- Two existing YAML files (`MAT.SPL.ORBSUM.CNJSP.001`, `PNC.DGT.EXMUL.LZINC.001`) need `diagnostic_tags` added to their 3 wrong-paths entries each. **At the calibration-phase rate of ~10 min/problem (per §7.1), this is ~20 minutes of reviewer time total** — the existing 2 problems being the first 2 of the 30-problem warm-up curve.
- Existing 7-axis identity untouched. Zero risk to current importer tests.

---

### Option B: Refactor the existing 7 axes into finer sub-axes

(Option B is unchanged from v1/v2 — the recommendation against it still holds. Reproduced below in full for completeness; not removed because v1 reviewer praised the "both options fully specified" discipline.)

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

### Option A vs Option B — Trade-off Summary  **[UPDATED v3 — counts re-derived from matrix]**

| Dimension | Option A (orthogonal new layer) | Option B (refactor existing) |
|---|---|---|
| **Captures per-wrong-path failure mode (US-1, US-3 driver)** | Yes — directly. | No. Only captures *what the question can elicit*, not which mode fired on this attempt. |
| **Captures two-concept fusion explicitly** | No — leaves it implicit in IDEA naming. | Yes — `idea_secondary` is first-class. |
| **Captures partial-marking play on wrong attempts** | Yes (`ERR-STRAT-PARTIAL` on wrong-path). | Only as a question-level trap; not on the specific student's wrong attempt. |
| **Empirical activation rate (axes that fire in the 2022 sample)** | 5 axes, activating in 7/12/14/7/7 of 18 sample Qs (Appendix B matrix counts). All within the [10%, 85%] retention band. | Sub-axes are not directly measurable against the 2022 sample without re-tagging — adds risk. |
| **Migration cost (existing problems)** | ~20 min total (2 problems × 10 min calibration-rate, per §7.1). | ~20 min total + rewrite of importer + downstream changes. |
| **Risk to existing 7-axis identity and queries** | None — additive only. | Significant — renames and splits existing columns. |
| **Inter-rater agreement risk (κ)** | Moderate — 5 new axes to agree on. | Higher — sub-axes like `LANG-MED` are subjective. |
| **Future extensibility** | Easy — add a 6th diagnostic axis the same way (lookup table style). | Harder — every refactor touches existing data. |
| **Answers the user's verbatim ask ("pin-point reasons where a student is faltering")** | Directly. | Indirectly, and only on the question side. |

**Recommendation: Option A.** Option A is additive, migration-cheap, directly answers the user's ask, and preserves the 7-axis identity that **PROJECT CONTEXT §4** calls a non-negotiable. Option B's two genuine wins (two-concept fusion as `idea_secondary`; explicit marking-scheme identity) can be folded into Option A as a *small future enhancement* later (just add an axis 4.5 `idea_secondary` when needed) without re-tagging the bank. We should NOT do both at once — the bank is too small for that to be worth the risk.

**[UPDATED v2 — Non-blocker #7: concrete trigger for the deferred `idea_secondary` decision]** The trigger to revisit `idea_secondary` is now stated explicitly in §8 Out of Scope: when ≥ 30% of the bank's authored problems are flagged by the reviewer as two-concept fusions in `review_notes` (measurable once the bank crosses ~30 problems), open a follow-up PRD for `idea_secondary`.

---

## 7. Non-Functional Requirements

- **Performance:**
  - Failure-mode lookup for a single attempt (US-1, US-3 result screen): server response ≤ 200 ms p95 once the `wrong_paths.diagnostic_tags` is loaded with the problem row.
  - Targeted-set construction (US-2, US-3 build phase): ≤ 800 ms p95 to return 10 question codes when the bank has ≤ 10,000 problems. The Architect's chosen indexing strategy on the per-problem summary columns (§6 A.3) must satisfy this. **[UPDATED v3]**
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
  - Median reviewer tagging time for all 5 diagnostic axes on one fresh problem, measured **in steady state** (after the reviewer has tagged ≥ 30 problems — see §7.1 budget): **≤ 4 minutes**. Worst-case per-axis post-warm-up: ≤ 90 s.
- **Inter-rater reliability (κ) target per axis:**
  - On a held-out calibration set of 30 problems tagged independently by two reviewers: **Cohen's κ ≥ 0.65** per axis.
  - If κ < 0.65 on any axis, that axis is *held back* from the production diagnosis engine (engineering work to expose it via the API is not done) until the taxonomy definition is sharpened and the re-tag exercise passes.
- **Data integrity (contract-only — mechanism delegated to Architect):** **[UPDATED v3 — meta-fix]** The 5 per-problem summary columns (`errReadingTags`, `errCaseTags`, `errCompTags`, `errStrategyTags`, `errParsingTags`) MUST be DB-maintained derivations of `wrongPaths` JSONB, satisfying the §6 A.3 acceptance criteria: write-through consistency within the source transaction, no application-side write path, integration test enforces both invariants. The Stage-2 Architect picks the simplest mechanism Postgres supports for this expression shape.
- **Equality / normalisation contract (US-1 + SPMR):** **[UPDATED v3 — v2 Blocker 3]** Both US-1's runtime matcher and the bank-side SPMR computation MUST use one shared normaliser module for `landed_on_option` equality: exact string for MCQ-SC / MCQ-MC / MAT-COL; integer-parse equality for NUM-INT; `toFixed(answer.precision)` byte-equality for NUM-DEC. A CI test asserts both call-sites import from the same module (US-4 AC). Any future divergence breaks the build.
- **Evolvability:**
  - Adding a new value to an existing diagnostic axis (e.g. `ERR-READING-NEGATION`): extend `taxonomy/maths.yaml`, re-run importer. **No problem re-tagging required.** Existing problems whose wrong paths don't activate the new value retain their tags.
  - Adding a new diagnostic axis altogether (e.g. `ERR-MEMORY`): one Prisma migration adding one DB-maintained column (mechanism per §6 A.3) + one taxonomy block. Existing problems are bulk-defaulted to `NONE` on the new axis; reviewers then upgrade as they re-touch problems.
- **Auditability:**
  - Every change to `taxonomy/maths.yaml` lands as a git commit (the file is checked in). Every change to a problem's `diagnostic_tags` while in `provisional` state is captured in the `problems.updated_at` timestamp; once `calibrated`, the `_SCHEMA.md` immutability rule applies.

### 7.1 Tagging-cost budget — Calibration vs Steady state vs Escalation

Per **PROJECT CONTEXT §9**: "honest human review is the quality gate and the real bottleneck — protect it." The v1 PRD's "≤ 4 min per problem" target was the *steady-state* median and silently elided the warm-up cost. This section quantifies the full budget.

| Phase | Problem range | Expected median time per problem (5 axes) | Total reviewer time at this rate |
|---|---|---|---|
| **Calibration (warm-up)** | Problems 1–30 (the first 30 problems any reviewer tags) | **8–12 min** (factor of 2–3× over steady state per the binding doc warning) | ~5 reviewer-hours one-time per reviewer |
| **Inter-rater calibration set (NFR §7)** | A held-out 30-problem subset, blind-tagged by 2 reviewers | ~10 min × 30 problems × 2 reviewers = ~10 reviewer-hours | Run once before transitioning *any* axis to production |
| **Steady state** | Problem 31 and beyond | **≤ 4 min** (median target; ≤ 90 s per-axis cap) | At 4 min × ~10 new problems/week = ~40 min/week ongoing |

**[UPDATED v3 — v2 Non-Blocking #6]** **Total reviewer-hour budget before diagnosis engine ships in production: up to 15 reviewer-hours** (5 calibration + 10 inter-rater). This is the user-visible scope decision that §10 Q4 + Q7 asks about. If the user is also the inter-rater reviewer, that's 15 hours of user time before US-1 ships.

**Why the warm-up factor is 2–3×, not nothing:** for the first 20–30 problems, the reviewer is internalising (a) the 19-value vocabulary across 5 axes, (b) the disambiguation between adjacent values (e.g. `ERR-CASE-EDGE` vs `ERR-CASE-PARTITION`), (c) the per-`wrong_paths`-entry application discipline (each path independently tagged), and (d) the all-`NONE` "didn't see the idea" convention. Until these are reflexes, every axis requires conscious lookup. The 2–3× factor is consistent with PM intuition on similar taxonomy roll-outs.

**Escalation gate (the bailout):**
> If the **median tagging time exceeds 6 min after problem 30** (i.e. the steady-state target is being missed structurally, not by individual problems), the orchestrator escalates to the user with three options:
> 1. **Prune to 3 axes** — drop the two lowest-discriminating axes (likely ERR-PARSING with its low-evidence sub-value, and one TBD). This sacrifices some signal for throughput.
> 2. **Defer two axes** — keep all 5 in `taxonomy/maths.yaml` but mark two as `provisional_axis: true` and only require `NONE`/skip on them at the importer; the diagnosis engine ignores them until volunteered later.
> 3. **Accept the higher cost** — formally increase the steady-state NFR to whatever the measured median is, with a documented impact on bank growth velocity.

**Effect on §3 Phase A success metrics:** the "≤ 4 min steady-state median" success metric does NOT apply during calibration. The "tagging time" leading indicator in §3 explicitly notes "steady state, after problem 30" — a calibration-phase tagger taking 10 min/problem is not a failure.

**Effect on §6 A.6 migration cost:** the 2 existing problems being re-tagged are the *first 2 of the calibration phase*, so the cost is ~10 min × 2 = ~20 min (revised from v1's incorrect "~12 min total").

---

## 8. Out of Scope

Explicitly NOT included in this PRD; future iterations.

- **The student-facing UI to display diagnoses.** US-1, US-3 specify the *contract* (what fields the API returns and what the screen MUST show); the visual design lives in Stage 4 of the build sequence (testing app).
- **[UPDATED v3 — v2 Non-Blocking #7]** **The final visual design of the US-1 ambiguous-match (≥2 paths) card.** US-1 specifies the contract (side-by-side, no silent pick); the Stage-4 UX Auditor explicitly tests whether stressed students find the side-by-side useful or hostile and may approve the documented fallback ("most common path + subtler 'this could also be …' indicator"). This is a Stage-4 ticket, not a v1 spec change.
- **The scoring algorithm for partial-marking play.** The existing marking schemes apply unchanged. This PRD only adds the diagnostic tag for "you mis-played partial marking on this question" — it does not change how marks are awarded.
- **The mastery-update logic.** `student_fingerprint_state.mastery_score` is updated per the existing rules; this PRD does NOT touch the mastery formula.
- **The Physics and Chemistry taxonomy files.** This PRD references PCM evidence from JEE Adv 2022 but specifies changes to `content/taxonomy/maths.yaml` only. P and C taxonomy files will get the same 5 diagnostic axes added in a follow-up PRD once Maths is calibrated.
- **The test-taking interface itself.** No changes to the timer, the capture layer, or the answer-submission flow. Diagnoses are computed *after* the test is submitted.
- **The Claude-prompt for generating problems WITH their diagnostic tags.** That is a Stage 3 content-workflow upgrade and belongs in its own PRD. Until that upgrade lands, reviewers tag diagnostics by hand.
- **A diagnosis-confidence threshold tuner.** Eliminated entirely in v2 — the matching is deterministic, no threshold exists to tune.
- **Backfill of empirical failure-mode rates from past attempts.** The 2 existing problems have no attempt data; backfill is moot. When the platform has attempts, the nightly batch job will populate empirical rates — that addition belongs in the feedback-loop PRD.
- **Multilingual labels** for failure modes. English-only at launch.
- **Anti-gaming** (e.g., a student who deliberately picks the trap option to inflate their ERR-STRAT-TRAP count). Not a v1 concern given the trusted-student pilot.
- **The `idea_secondary` axis** (Option B's two-concept-fusion win). Out of scope for this PRD. **Trigger to re-evaluate:** when ≥ 30% of the bank's authored problems are flagged by the reviewer as two-concept fusions in `review_notes`. Measurable once the bank crosses ~30 problems; until then this PRD's recommendation of Option A stands.
- **The admin-queue UI for uncatalogued wrong paths (US-1 E2).** For v1, the queue is an append-only `problems_diagnostic_misses` table (`student_id, question_code, wrong_answer, created_at`) populated by the diagnosis engine on every E2 hit, exported on demand via a CLI script (`npm run report:diagnostic-misses`). A queue UI belongs to the Stage-7+ admin-tools PRD.

---

## 9. Dependencies & Assumptions

**Depends on:**
- `content/taxonomy/maths.yaml` exists and is the source of truth for axis enumerations (it does, per `git status`).
- The Prisma schema and the importer script from Stages 2–3 of the build sequence exist (they do — `backend/scripts/` is present per `git status`).
- The `wrong_paths` field on YAML problems already requires a `landed_on_option` value (it does per `/content/maths/generated/_SCHEMA.md`). This is the key the diagnosis engine matches student wrong answers against.
- **[UPDATED v3 — meta-fix]** Postgres ≥ 12 (the minimum version supporting modern JSONB and generated columns). The Stage-2 Architect picks the per-problem-summary maintenance mechanism (per §6 A.3) compatible with the deployed Postgres version.

**Assumes:**
- Every Claude-generated problem will have 2–3 wrong-paths entries (the existing convention in `_SCHEMA.md`). Diagnoses are only as good as the wrong-paths coverage.
- Reviewers will use the 5 axes consistently. The κ ≥ 0.65 NFR is the enforcement.
- The 2022-only sample is representative of the failure modes that will appear in 2020 / 2023 / 2024 papers. The PROJECT CONTEXT §3 list of 7 question-construction signatures is invariant across recent years; the failure modes derived from it are therefore expected to generalise. We will validate this in a future PRD by re-running the §5 analysis on 2020 and 2023 papers.
- The user (the project owner) approves the 5-axis taxonomy proposed in §6 (Option A) before engineering begins — this is the decision in §10 below.
- **[UPDATED v3 — v2 Blocker 4]** **Two reviewers are available to run the inter-rater calibration set (§7.1 row 2).** If only one reviewer is available, **calibration cannot start, and the production diagnosis engine (US-1's failure-mode card on the test-review screen) is gated behind a feature flag and does NOT render until the second reviewer arrives and the κ ≥ 0.65 gate is met.** US-2 and US-3 are also gated by the same flag, since their value depends on US-1's tags being trustworthy. The "self-review consistency check" fallback from v2 is dropped — it was a paper-over of a real reviewer shortage; if the second reviewer is missing, the honest answer is to delay the engine, not to weaken the gate. (Decision needed — see §10 Q4.)

---

## 10. Open Questions

- [ ] **Q1 — Option A vs Option B.** Spec recommends Option A. User confirms?
- [ ] **Q2 — Exact axis-value definitions.** §6 (Option A) proposes 4+4+4+3+4 = 19 axis values. Are any missing for failure modes the user has seen in tutoring practice that the 2022-paper analysis did not surface (e.g., calculator/silly mistakes that are not on JEE Adv but might appear on practice tests)? **[UPDATED v3 — v2 Non-Blocking #8: deadline]** Decision needed *before* the reviewer starts the calibration phase. If new axis values are added after the calibration set begins, the calibration must restart from problem 1 — budget the user accordingly.
- [ ] ~~**Q3 — The 70% confidence threshold in US-1.**~~ **[RESOLVED in v2 — Blocker 3]** Confidence removed in favour of deterministic exact-match. There is no threshold to tune.
- [ ] **Q4 — Inter-rater protocol.** **[UPDATED v3 — v2 Blocker 4]** Who are the 2 reviewers who will tag the calibration set? Is the user available as one of them? **Resolves the gating decision in §9.** If only one reviewer is available, the diagnosis engine (US-1's failure-mode card, plus US-2 and US-3 which depend on it) is gated behind a feature flag until a second reviewer arrives. There is no "single-reviewer fallback" in v3; the user decides whether to accept the gate or recruit a second reviewer. The cost is up to 15 reviewer-hours total before US-1 ships (see §7.1 total budget).
- [ ] **Q5 — Do we want a "free text" reviewer note alongside the diagnostic_tags?** Reviewers may want to record the *evidence* for each tag ("This wrong path is ERR-READING-QUANTIFIER because the student plausibly read 'contains' as 'is contained in'"). Adds reviewer time; adds explainability later.
- [ ] **Q6 — CSV-export vs admin-queue.** §8 commits to the CSV-export fallback for v1 (no queue UI). User confirms this is sufficient until Stage 7?
- [ ] **Q7 — Calibration phase reviewer.** §7.1 budgets ~5 reviewer-hours one-time for the warm-up *per reviewer*. Is the user willing to be the first reviewer through the 30-problem calibration, or do we recruit an external subject-matter expert and budget the user's time only for the inter-rater check (~5–10 hours)? Total user-time scope: see §7.1 total budget. (Q4 + Q7 are related — both are about who the reviewers are; the orchestrator may merge them when surfacing to the user.)

---

## Appendix A — Per-question worksheet (18 sampled questions)

Format: **(Subject, Paper, Q#, Format) — Topic / subtopic — trickiness (1–5) — top-10-rank est. time (s) — failure modes activated on typical wrong paths.**

1. **(Maths, P1, Q1, NUM-DEC)** TRG / inverse-trig identities — 2 — 180s — `ERR-READING-NUMRANGE` (principal value range misread); `ERR-COMP-ARITH`.

2. **(Maths, P1, Q3, NUM-INT)** PRB / language-heavy conditional probability — 4 — 360s — `ERR-PARSE-PASSAGE` (4-paragraph setup); `ERR-READING-QUANTIFIER` ("at most one symptom" vs "exactly one"); `ERR-CASE-PARTITION` (forgetting to sum sub-cases).

3. **(Maths, P1, Q4, NUM-DEC)** ALG / complex-number-real-condition — 3 — 240s — `ERR-COMP-ALGEBRA` (rationalisation slip); `ERR-CASE-EDGE` (z imaginary part = 0 case must be excluded).

4. **(Maths, P1, Q5, NUM-INT)** ALG / count distinct roots of conjugate equation — 4 — 360s — `ERR-CASE-EDGE` (z = 0 is or isn't a root); `ERR-CASE-PARTITION` (real-imaginary case split); `ERR-COMP-SIGN`.

5. **(Maths, P1, Q6, NUM-INT)** SOT / AP rectangles with d1·d2 = 10 — 3 — 240s — `ERR-COMP-ARITH` (telescoping); `ERR-CASE-MODINDEX` (off-by-one in subscript).

6. **(Maths, P1, Q7, NUM-INT)** PNC.DGT / 4-digit integers in [2022, 4482] from {0,2,3,4,6,7} — 4 — 480s — `ERR-READING-NUMRANGE` (the inclusive boundaries); `ERR-CASE-EDGE` (leading-zero handling). Directly relevant to existing bank problem `PNC.DGT.EXMUL.LZINC.001`.

7. **(Maths, P1, Q10, MCQ-MC)** SOT / AP-and-recurrence T_n — 3 — 360s — `ERR-CASE-MODINDEX` (off-by-one in recurrence solution); `ERR-COMP-ARITH`; `ERR-STRAT-PARTIAL` (pick 2 of 4 carelessly).

8. **(Maths, P1, Q11, MCQ-MC)** VEC / planes / tetrahedron edges — 4 — 540s — `ERR-PARSE-GEOM3D` (visualising the tetrahedron edge condition); `ERR-COMP-ALGEBRA` (parameterisation of intersection line); `ERR-STRAT-PARTIAL`.

9. **(Maths, P1, Q13, MCQ-MC)** COG / parabola, foci, tangents, perpendicular feet — 5 — 720s — `ERR-PARSE-GEOM3D` (5-point geometry); `ERR-COMP-ARITH`; `ERR-STRAT-PARTIAL`.

10. **(Maths, P1, Q14, MCQ-MC)** MAT + CAL / determinant whose max/min are roots of a quadratic — 5 — 660s — `ERR-COMP-ARITH` (3×3 determinant expansion); `ERR-STRAT-TRAP` (over-fit eigenvalue thinking); `ERR-CASE-MODINDEX`; `ERR-COMP-SIGN`.

11. **(Maths, P1, Q15, MAT-COL)** TRG / 4 lists of trig equations × 5 cardinalities — 3 — 480s — `ERR-PARSE-LISTMATCH`; `ERR-READING-NUMRANGE` (per-list interval bounds); `ERR-CASE-PARTITION` (counting roots in the interval).

12. **(Physics, P1, Q9 sect 2, MCQ-MC)** EM / dielectric repositioned in capacitor — 4 — 480s — `ERR-PARSE-GEOM3D` (figure (a) vs (b)); `ERR-COMP-SIGN` (field direction in dielectric); `ERR-CASE-EDGE` (limit case in figure (a) vs (b)); `ERR-STRAT-PARTIAL`.

13. **(Physics, P1, Q15 sect 3, MAT-COL)** EM / solenoid with time-dep axis, torque on small loop — 5 — 600s — `ERR-PARSE-LISTMATCH`; `ERR-COMP-SIGN` (torque direction).

14. **(Chem, P1, Q1, NUM-DEC)** Phys-Chem / bomb-calorimeter enthalpy of HgO formation — 3 — 360s — `ERR-COMP-SIGN` (ΔU vs ΔH); `ERR-COMP-ARITH` (Δn·RT correction); `ERR-CASE-EDGE` (state of Hg).

15. **(Chem, P1, Q11, MCQ-MC)** Inorg / electrochemical extraction of Al — 2 — 180s — `ERR-STRAT-TRAP` (NCERT-edge); `ERR-READING-QUANTIFIER` ("involves" — which option mentions an excluded reaction).

16. **(Maths, P2, Q9, MCQ-MC)** TRG / quadrilateral angles, intervals containing 4αβ sinθ — 5 — 720s — `ERR-READING-QUANTIFIER` ("interval(s) that contain"); `ERR-PARSE-GEOM3D` (planar configuration); `ERR-COMP-ARITH`; `ERR-STRAT-PARTIAL`.

17. **(Maths, P2, Q15, MCQ-SC)** PNC / 4 boxes, choose 10 balls with ≥1 red ≥1 blue per box — 5 — 600s — `ERR-READING-QUANTIFIER` ("from each box"); `ERR-CASE-PARTITION` (inclusion-exclusion over 4 boxes); `ERR-COMP-ARITH`.

18. **(Physics, P2, Q1, NUM-INT)** Mech / position-dep central-like force, compute x·v_y − y·v_x at z = 0.5 — 4 — 540s — `ERR-CASE-EDGE` (interpreting "ignore gravity"); `ERR-COMP-SIGN` (angular-momentum-like quantity); `ERR-COMP-ALGEBRA`.

---

## Appendix B — Per-question × per-axis activation matrix  **[UPDATED v3 — sole counting convention]**

This appendix is the **single source of truth for §5.3 axis-activation counts.** Each cell is **1** if at least one wrong path on that question is plausibly tagged with a non-`NONE` value on that axis (per the failure modes listed in Appendix A), else **0**. The §5.3 narrative cites these matrix counts directly (7/12/14/7/7). **[UPDATED v3 — v2 Blocker 1]** v2's "conservative" alternative count (6/10/13/7/6) and the "dual reporting" justification are removed; one counting convention only.

| # | Question | ERR-READING | ERR-CASE | ERR-COMP | ERR-STRATEGY | ERR-PARSING |
|---|---|:---:|:---:|:---:|:---:|:---:|
| 1 | P1-M-Q1 | 1 | 0 | 1 | 0 | 0 |
| 2 | P1-M-Q3 | 1 | 1 | 0 | 0 | 1 |
| 3 | P1-M-Q4 | 0 | 1 | 1 | 0 | 0 |
| 4 | P1-M-Q5 | 0 | 1 | 1 | 0 | 0 |
| 5 | P1-M-Q6 | 0 | 1 | 1 | 0 | 0 |
| 6 | P1-M-Q7 | 1 | 1 | 0 | 0 | 0 |
| 7 | P1-M-Q10 | 0 | 1 | 1 | 1 | 0 |
| 8 | P1-M-Q11 | 0 | 0 | 1 | 1 | 1 |
| 9 | P1-M-Q13 | 0 | 0 | 1 | 1 | 1 |
| 10 | P1-M-Q14 | 0 | 1 | 1 | 1 | 0 |
| 11 | P1-M-Q15 | 1 | 1 | 0 | 0 | 1 |
| 12 | P1-Phys-Q9 | 0 | 1 | 1 | 1 | 1 |
| 13 | P1-Phys-Q15 | 0 | 0 | 1 | 0 | 1 |
| 14 | P1-Chem-Q1 | 0 | 1 | 1 | 0 | 0 |
| 15 | P1-Chem-Q11 | 1 | 0 | 0 | 1 | 0 |
| 16 | P2-M-Q9 | 1 | 0 | 1 | 1 | 1 |
| 17 | P2-M-Q15 | 1 | 1 | 1 | 0 | 0 |
| 18 | P2-Phys-Q1 | 0 | 1 | 1 | 0 | 0 |
| **Totals** | | **7** | **12** | **14** | **7** | **7** |

**Reader's check:** matrix totals are ERR-READING 7, ERR-CASE 12, ERR-COMP 14, ERR-STRATEGY 7, ERR-PARSING 7. Percentages over 18: 39% / 67% / 78% / 39% / 39%. All five axes pass the [10%, 85%] retention rule used in §5.3 (ERR-COMP at 78% is the closest to the ceiling and is flagged for re-validation at the 30-problem milestone).

---

*End of PRD v3.*
