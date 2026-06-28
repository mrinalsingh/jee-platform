# Stage 2 (Architecture Loop) — Input Notes

> **Read alongside `01-prd-final.md`.** This file collects requirements that
> emerged AFTER the Stage 1 PRD was locked but BEFORE Stage 2 Architect spins up.
> The Architect agent must satisfy all of these in addition to the PRD.

---

## Requirement A — Dual difficulty rating (added 2026-06-14)

**Context.** The jee_platform bank originally used a single 5-bucket categorical
difficulty rating (`authored_difficulty` enum, T1–T5) anchored to a top-10-rank-level
student. The sibling `jee-mcq` Claude Code skill uses a continuous 8.8–10.0 score
anchored to "JEE Advanced paper authenticity" (real paper average ~9.3). The two
scales are complementary but currently incompatible; the user asked that both be
captured per problem.

**Decision (user-approved 2026-06-14).** Keep both. The T-rating stays as the
broad bucket; a new `jee_authenticity_score` (float, 0.0–10.0) is added as
fine-grained calibration. The two are constrained to be self-consistent per the
cross-walk in `content/taxonomy/maths.yaml` → `difficulty_crosswalk`.

**Interim state.** Until Stage 2 lands, the score is parked in
`source_metadata.jee_authenticity_score` in YAML files and the
`problems.source_metadata` JSONB column.

**What the Stage 2 Architect must deliver:**

1. **Promote `jee_authenticity_score` to a first-class column on `problems`.**
   - Type: `Float` (double precision is fine; we don't need numeric precision guarantees).
   - Nullable initially so the 159 existing rows back-fill cleanly (compute from `authored_difficulty` via the cross-walk midpoint, OR leave NULL and tag forward only).
   - Index: B-tree on the column (not GIN — it's a scalar). Queries like "find me all problems with score ≥ 9.5" need a sorted index.
   - Constraint: `CHECK (jee_authenticity_score IS NULL OR (jee_authenticity_score >= 0.0 AND jee_authenticity_score <= 10.0))`.

2. **Cross-walk consistency constraint.** Add a CHECK constraint OR a database trigger that rejects an INSERT/UPDATE where the (`authored_difficulty`, `jee_authenticity_score`) pair violates the cross-walk:
   - T1 ⇒ score ∈ [8.5, 8.8)
   - T2 ⇒ score ∈ [8.8, 9.2)
   - T3 ⇒ score ∈ [9.2, 9.5)
   - T4 ⇒ score ∈ [9.5, 9.8)
   - T5 ⇒ score ∈ [9.8, 10.0]
   - NULL score ⇒ no constraint (legacy rows + un-rated by jee-mcq pipeline OK)

   **Architect's choice on mechanism** (CHECK constraint with a CASE expression vs deferred trigger vs invariant in app code with a CI test) — per the same delegation pattern used for the diagnostic summary columns in PRD §6 A.3.

3. **Backfill plan for the 159 existing rows.** Two options; pick one and document:
   - **(a)** Compute `jee_authenticity_score = midpoint(crosswalk[authored_difficulty])` for every existing row at migration time. Trade-off: introduces fake precision; mitigated by setting `provenance.score_source = "backfilled_from_T_midpoint"` so analytics can filter.
   - **(b)** Leave NULL on backfill; only tag forward. Trade-off: 159 rows have no score, queries on score-range exclude them.

4. **YAML schema update.** Promote `jee_authenticity_score` from
   `source_metadata.jee_authenticity_score` to a first-class top-level field on the
   YAML problem-file format. Update:
   - `content/maths/generated/_SCHEMA.md` (the contract doc)
   - `backend/scripts/import-yaml.ts` (the importer's `ProblemYaml` interface +
     validation + data mapping)
   - The skill copy at `~/.claude/skills/jee-tagging-toolkit/references/yaml-problem-schema.md`

5. **Importer migration of existing YAML files.** Any `.yaml` files in
   `/content/maths/generated/` whose `source_metadata.jee_authenticity_score` is set
   should be rewritten so the score sits at the top level. (One-time script;
   archive the originals first.)

---

---

## Requirement B — Target-exam column (added 2026-06-14)

**Context.** The bank holds problems designed for different exams (JEE Advanced, JEE Main / NTA, IOQM, INMO, RMO, KVPY, coaching, originals). The difficulty anchors (T-rating + jee_authenticity_score) are both JEE-Advanced-anchored, so for non-Advanced problems the ratings carry weaker calibration. We need a column to disambiguate.

**Decision (user-approved 2026-06-14).** Add `target_exam` as a required column on `problems`.

**What the Architect must deliver:**

1. **New column `problems.target_exam`** — Postgres enum with values `JEE_ADVANCED`, `JEE_MAIN`, `IOQM`, `INMO`, `RMO`, `KVPY`, `COACHING`, `ORIGINAL`, `OTHER`. Required (NOT NULL).
2. **B-tree index** on the column (queries like "find me all JEE Advanced T4 problems" must be cheap).
3. **Backfill for the 159 existing rows** — best evidence is the bank is jee_platform-focused, so default to `JEE_ADVANCED` with `provenance.target_exam_inferred: true` flag. The 25 NTA-paper problems we tagged (not yet imported) would be `JEE_MAIN` when they land.
4. **YAML schema update** — add `target_exam` as a required top-level field. Update `_SCHEMA.md`, `import-yaml.ts` (validation: reject missing `target_exam`), and the skill copies.
5. **Documentation update** — the cross-walk in `content/taxonomy/maths.yaml` only applies cleanly for `target_exam = JEE_ADVANCED`. For other targets, the 8.8 authenticity floor may legitimately be missed; the cross-walk check should be SKIPPED or RELAXED. Architect picks the mechanism.

---

## Requirement C — Reviews array + consensus derivation (added 2026-06-14)

**Context.** A single problem may receive multiple independent reviews — one from this project's tagger (`jee_platform_critic`), one from the sibling `jee_mcq_critic`, plus eventual human reviews. The canonical `authored_difficulty` + `jee_authenticity_score` on the problem row must be DERIVED from this array (mean / median / max / min / human_override; see `content/taxonomy/maths.yaml` → `rating_consensus_methods`).

**Decision (user-approved 2026-06-14).** Add a `reviews` field per problem (JSONB or sub-table — Architect picks) plus derivation of consensus into the existing primary columns.

**What the Architect must deliver:**

1. **`reviews` storage** — two options for the Architect to evaluate:
   - **(a) JSONB column** `problems.reviews` of shape `[{reviewer_role, T_rating, jee_authenticity_score, reviewed_at, notes}, ...]`. Simpler; harder to query (e.g. "show me all problems where the two critics disagree by ≥1 T-bucket" needs JSON lateral joins).
   - **(b) Separate table** `problem_reviews(id, question_code, reviewer_role, T_rating, jee_authenticity_score, reviewed_at, notes)` with FK to `problems`. Normalised; queries clean; one extra join. Recommended for analytics; pick this if scale is expected to grow.
2. **Reviewer-role enum** for `reviewer_role` matching the 5 values in `review_roles`: `jee_platform_critic`, `jee_mcq_critic`, `human_reviewer_primary`, `human_reviewer_secondary`, `automated_calibration`.
3. **Consensus derivation** for the canonical `problems.authored_difficulty` and (post-Requirement A) `problems.jee_authenticity_score` columns:
   - Computed from the reviews array per `source_metadata.rating_consensus_method`.
   - Architect picks mechanism (Postgres GENERATED column with a CASE expression; deferred trigger; application-layer compute with CI test). The constraint from PRD §6 A.3 still applies: drift between source and derived must be structurally impossible.
4. **Inter-rater agreement view** — a read-side view `v_inter_rater` that surfaces:
   - Per-problem absolute difference in T-rating between the two critics (jee_platform_critic vs jee_mcq_critic)
   - Per-problem absolute difference in jee_authenticity_score between the two critics
   - Cohen's kappa over the bank (a single roll-up number; recomputed nightly by the batch job)
5. **Backfill** — every existing problem gets one synthetic review of role `jee_platform_critic` with the row's existing `authored_difficulty` and an inferred `jee_authenticity_score = midpoint(crosswalk[authored_difficulty])`. Flagged with `provenance.review_backfilled: true`.

---

---

## Requirements F–P — from test-runtime PRD (Stage 1 #16) + Vision Update 2026-06-26

**Context.** Stage 1 closed the test-runtime PRD at 9/10 (`scorecards/16-test-runtime-prd-final.md`). The PRD spec'd 5 new backend tables + several cross-cutting concerns. The Spec Critic v2 review (`16-test-runtime-prd-review-v2.md`) added Requirements F–P. The Architect MUST satisfy these alongside A–E (above) in one Architecture Loop.

| Req | Source | What | Notes |
|---|---|---|---|
| **F** | Vision §2 + PRD §8 | New tables: `cohorts`, `cohort_members`, `test_assignments` (with `(cohort_id XOR student_id)` CHECK), `parents`, `student_parents` | Assignment model is cohort + per-student exclusive |
| **G** | Vision §4 | `hints` JSONB column on `problems` (`[{level, text, reveals_idea}]`); back-fill 179 existing rows with `[]` until hints are authored | `attempts.hints_used` column already exists |
| **H** | Vision §5 | `syllabus_status` enum on `problems` (`WITHIN_SYLLABUS / BORDERLINE / BEYOND_SYLLABUS`) — prefer enum over boolean to allow "borderline" | Server-side filter for student-role on assembly + figures + hints endpoints |
| **I** | PRD §8 / US-9 | New tables: `test_sessions`, `test_session_snapshots`, `test_session_audit(test_session_id, violation_type, violation_timestamp, was_active, was_active_before_violation)` | Snapshot table is transient per-question store; canonical `attempts` row written once on submit |
| **J** | Vision §10 | Extend `AnswerType` enum with: `MCQ-PASSAGE`, `NUM-DIGIT`, `MAT-LIST`, `MCQ-AR`, `FILL` (placeholders — v1 ships 5 existing types only) | The `AnswerControl<T>` interface in PRD US-3 is the slot-in contract |
| **K** | Vision §7 | `student_drill_recommendations(id, student_id, generated_at, source_test_id, problem_codes[], target_failure_mode, target_idea_code, status)` | Audit trail for the personalised drill recommender |
| **L** | Critic v2 | **HIGH** — Harden the hint endpoint against timing / URL-pattern probing | Server pads response time to constant; returns `{has_more: bool}` not `{total_count: int}` |
| **M** | Critic v2 | Dashboard query is `assignments UNION active_test_sessions DEDUPE BY test_id` | A student in both a cohort and an explicit per-student assignment sees ONE entry |
| **N** | Critic v2 | HMAC session_secret operational posture: rotation cadence, leak playbook, key custody (env vars + cloud KMS) | Document in `agent-factory/security-posture.md` (new file) |
| **O** | Critic v2 | Instrument `attempts.auto_submit_source` enum: `TIMER_EXPIRY / VIOLATION_THRESHOLD / NETWORK_FAILURE_FALLBACK / MANUAL` | Lets teacher distinguish a cheating-flagged submit from a true expiry |
| **P** | Critic v2 | Marking-scheme `MAT-COL` shape currently can't express JEE-Adv 2023+ "any-wrong-row gates all partial credit"; extend the JSONB with `gating_rule: enum { ROW_INDEPENDENT, ANY_WRONG_GATES_PARTIAL }` | Default `ROW_INDEPENDENT` (current v2 behaviour); future-proofs |

## Requirement Q — Calibration-mismatch columns (added 2026-06-26 post-architecture-lock)

**Context.** A problem is authored *for* one exam (`target_exam`), but in practice the author or a reviewer often realises the problem is either (i) harder than that exam's bar OR (ii) better-suited to a *different* exam (e.g., authored for JEE Advanced but actually plays best at JEE Main; or authored for IOQM but really feels JEE-Advanced-flavoured). We need explicit columns to capture this calibration mismatch — without forcing a re-tagging of `target_exam`.

The user explicitly asked for one column to flag "lot tougher than the target" + another to flag "better fit for NTA Main". The chosen design generalises the second flag to any `TargetExam` via a nullable enum.

**Two new columns on `problems`:**

| Column | Type | Notes |
|---|---|---|
| `is_above_target_difficulty` | `Boolean NOT NULL DEFAULT FALSE` | `TRUE` when the problem is tougher than what its `target_exam` bar would normally accept. Independent of `syllabus_status` — a problem can be *within syllabus* but still *above the target's difficulty bar*. Boolean is sufficient because the magnitude of "above" is already captured by `authored_difficulty` (T-rating) and `jee_authenticity_score`. |
| `better_fit_exam` | `TargetExam? (existing enum, nullable)` | When `NULL`, the problem fits its `target_exam` well. When set, names which exam the problem *actually* suits best — overrides nothing; just informs filtering / recommendations. Reuses the existing `TargetExam` enum so no schema-level changes to the enum. |

**What the Architect / Engineer must deliver:**

1. **Migration `0013_calibration_mismatch_columns`** (NEW; do not amend 0012 in place — Prisma hash check):
   - `ALTER TABLE "problems" ADD COLUMN "is_above_target_difficulty" BOOLEAN NOT NULL DEFAULT FALSE;`
   - `ALTER TABLE "problems" ADD COLUMN "better_fit_exam" "TargetExam";`
   - `CREATE INDEX "problems_better_fit_exam_idx" ON "problems"("better_fit_exam") WHERE "better_fit_exam" IS NOT NULL;` (partial index — most rows will be NULL)
   - `CREATE INDEX "problems_above_target_idx" ON "problems"("is_above_target_difficulty") WHERE "is_above_target_difficulty" = TRUE;` (partial index — most rows will be FALSE)
   - Both indexes are cheap because the partial WHERE clause keeps them small.
   - Reversible `down.sql` drops both columns + indexes.

2. **No backfill of the 179 existing rows.** Defaults (`FALSE`, `NULL`) are semantically correct for "we haven't audited these yet"; reviewers can flip them later as part of normal calibration work.

3. **YAML problem-file contract update** (`/content/maths/generated/_SCHEMA.md` + skill copy):
   - New optional top-level field `is_above_target_difficulty: bool` (default `false`).
   - New optional top-level field `better_fit_exam: <TargetExam>` (default `null`).
   - Update `import-yaml.ts` to validate the values (boolean for the first; member of the `TargetExam` enum or `null` for the second).
   - Both fields are OPTIONAL — existing YAML files remain valid; the importer treats missing values as the defaults.

4. **Server-side filters** (Engineer must wire up):
   - Student-side problem fetch (test assembly + recommender) MUST default-exclude `is_above_target_difficulty = TRUE` problems *unless* the calling test explicitly opts-in (`include_above_target: true` query param).
   - Teacher / admin UI MUST surface both columns as filter dimensions in the bank-browser.
   - The personalised drill recommender (future PRD) MUST consider `better_fit_exam` when picking problems: if a JEE Advanced student is drilling weak topics, problems whose `better_fit_exam = JEE_MAIN` get lower priority than `better_fit_exam = NULL` or `better_fit_exam = JEE_ADVANCED`.

5. **Tagging-spec PDF update** (`agent-factory/scorecards/tagging-spec.tex`) — append two rows to the field table covering Group I (Provenance & lifecycle) or a new sub-group "calibration-mismatch flags". Re-render the PDF when convenient (not blocking).

**Why Boolean + nullable enum, not 3 columns:**
The user originally floated three columns (JEE Advanced closeness + NTA closeness + target exam). The third is `target_exam` (already exists). The first two collapse cleanly into one boolean ("above target") + one nullable enum ("better fit"), because asking "is this closer to JEE Advanced?" and "is this closer to NTA Main?" of the same problem produces information already carried by `target_exam` + `better_fit_exam` + `is_above_target_difficulty`.

**Validation:** there is intentionally NO CHECK constraint coupling `is_above_target_difficulty` and `better_fit_exam` — they're independent dimensions. A problem can be "above target difficulty" without there being a "better fit exam" (e.g., its just very hard for JEE Advanced too). Similarly a problem can be "better fit for JEE Main" without being "above target difficulty" (it's just easier than its target_exam).

---

## Requirement R — Outstanding from Stage 1 PRD

For completeness, the Architect also inherits (from PRD §6 A.3 and the v3 Spec
Critic review):

- Pick the DB-invariant mechanism for the diagnostic summary columns
  (`failure_modes_seen[]` etc.). Five acceptance criteria are in PRD §6 A.3.
  Note: the Spec Critic's v3 review flagged that "scheduled rebuild" cannot
  satisfy AC #1 (same-transaction consistency) — drop that option.
- Add the missing `answer.precision` field to `_SCHEMA.md` (integer ≥ 0, required
  for `NUM-DEC` answer-type). The equality contract in §5/§6 assumes it exists.
- Pin a concrete rounding rule (JS `toFixed` is NOT banker's rounding despite
  the PRD parenthetical; choose either "round half away from zero" or
  "round half to even" and document in `_SCHEMA.md`).
- Remove the lingering weasel word "appropriate" at PRD line ~443.

---

## Open user questions still blocking Stage 2 launch

From the Q1/Q2 ask after Stage 1 close-out:

- **Q1**: are there failure-mode axes missing from the 5 that MS sees in tutoring?
  (Status: user pausing to think.)
- **Q2**: who are the 2 calibration reviewers + who absorbs the ~15 reviewer-hours?
  (Status: user paused — wants to sort the roster.)

Both of these block tagging Stage 2's _calibration phase_; they don't block the
Architect's _schema work_. The Architect can run while Q1/Q2 are still open, as
long as the schema is forward-compatible with whatever Q1's answer is (the 5 axes
become a lookup table or a fixed enum — see PRD §6).

---

*End of architecture input notes — last updated 2026-06-14.*
