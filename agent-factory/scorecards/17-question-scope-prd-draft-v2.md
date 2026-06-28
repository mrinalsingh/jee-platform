# PRD-17: Question Scope + Drill Difficulty — Round-Aware Problem Selection

**Stage:** 1 (Spec Loop) | **Iteration:** v2 | **Author:** Product Manager (generator)
**Reviewed by:** Spec Critic v1 (6/10 — six blocking, six non-blocking; see `17-question-scope-review-v1.md`)
**Scope window:** `problems` model, `problem_reviews` model, importer, tagging-agent prompt
**Sibling artifacts:** PRD-01 (diagnostic axes — `01-prd-final.md`), PRD-16 (test runtime — `16-test-runtime-prd-final.md`)
**Relative size:** smaller than PRD-16; comparable to PRD-01 modulo the empirical-evidence appendices.

## v2 changelog (what changed vs. v1)

1. **`TRating` → `IntrinsicDifficulty` everywhere.** The Postgres / Prisma enum is `IntrinsicDifficulty { T1..T5 }`
   (`backend/prisma/schema.prisma:79`). `TRating` was a v1 misnomer derived from the *column* `ProblemReview.t_rating`.
   Three sites corrected: FR-E migration column type; FR-F review-row column type; §9 Dependencies.
2. **Migration slot now `0015_…` with collision guard.** `0014` is already taken by `0014_user_password_hash`
   (verified against `backend/prisma/migrations/`). FR-E asserts the slot at draft time and adds a defensive
   guard for late re-slotting.
3. **New FR-C "Disposition Table"** — every contradiction's behaviour (HARD REJECT vs. WARN-accept) is tabulated.
   Warnings persist to `provenance.scope_sanity_warnings[]` on the `problems` row.
4. **Low-confidence handling reframed.** No new table; instead the existing `status='provisional'` flow plus a
   new column `scope_needs_review BOOL DEFAULT FALSE` is flipped TRUE. Reviewer triages via the existing
   `provisional` queue UI.
5. **Relaxation ladder fully specified.** Ladder steps 1–5 unchanged; new AC for the ladder-exhausted shape
   (`bank_underpopulated: true`, `requested_n`, `returned_n`); explicit "topic / `idea_code` filter is NEVER
   relaxed" clause.
6. **PRD-16 hint × scope interaction:** explicit "hints are scope-orthogonal" clause in §8 — `hint_count`
   semantics unchanged; both `SINGLE_TOPIC` and `MULTI_TOPIC` problems use the same hint endpoint.
7. **Six non-blocking items** from Critic v1 addressed: RFR measurement cadence (§3); confidence-distribution
   logging (FR-C); PRD-01 axis-vocabulary disambiguation (FR-A); cross-table review constraint mechanism wording
   (FR-E); v2-YAML coordination as a CI test (FR-D); calibration-set stratification (§3 leading indicator 3).

---

## 1. Problem Statement

The teacher (and the platform's round-assignment engine) cannot today filter the
bank for **"single-topic drill problems at this drill difficulty"** vs.
**"multi-topic mock-test-grade problems at this paper difficulty."** Current
`authored_difficulty` (T1–T5) conflates two distinct difficulty senses:

- **drill difficulty** — how hard a problem is *as a topic drill* with no surface or
  trap dressing (the natural "lower number" of a clean single-topic problem); and
- **mock-test difficulty** — how hard the same idea becomes when wrapped in
  surface / trap / multi-topic integration (the natural "higher number" of an
  integrated paper question).

User's verbatim motivation (Stage-1 brief):

> Sometimes teachers give students topic-wise drill material. In the current
> schema, a topic-wise question has a lower rating naturally (single topic = no
> surface/trap dressing), so I can't filter the bank for "single-topic problems
> at this drill difficulty" vs "multi-topic problems at this mock-test
> difficulty." To make questions relevant to a *round* (R1 First Prep → R4 Final
> Round), each problem needs an explicit scope tag + a separate drill rating.

Without these two new tags, the round-assignment engine collapses into
"sort by T-rating and hope," which is exactly the failure of mainstream coaching
that **PROJECT CONTEXT §2** calls out.

---

## 2. Target Users

| Persona | Description | Primary Goal | Tech Comfort |
|---|---|---|---|
| **T — Teacher / Mentor** | JEE Adv subject teacher building topic-wise drill sets for R1 students or full mock papers for R3 / R4 students. | Filter the bank by `(question_scope, drill_difficulty)` and assemble a round-appropriate set in <2 min. | High. |
| **A — Content Reviewer (Admin)** | In-house subject expert tagging fresh problems on import. | Spend ≤ 30 s per problem confirming or correcting the auto-classified `question_scope` and `drill_difficulty` before `calibrated` flip. | High. |
| **S — Student (indirect)** | Median JEE aspirant in R1–R4 receiving the auto-assembled set. | Get problems that match where they are in the prep cycle, not just topics they're weak on. | Medium. (Does not see scope/drill_difficulty fields directly — sees their *effect*.) |

---

## 3. Success Metrics

### North Star

**Round-Fit Rate (RFR).** The fraction of `tests` rows where ≥ 80% of the
problems in the test satisfy the round's preferred `(question_scope,
drill_difficulty, authored_difficulty)` profile defined in §4 US-3.
Target at end-of-build: **≥ 90%** for teacher-built sets and auto-assembled drill
recommendations.

**Measurement protocol (NEW in v2 — addresses Critic non-blocking #7):**

- **Cadence:** RFR is computed nightly by a batch job over all `tests` rows
  where `assigned_at ≥ now() − interval '14 days'`. (Trailing-14-day window; one
  data point per night.)
- **Cohort filter:** the batch job emits a row per `(teacher_role, round,
  subject)` triple so per-round regressions are visible (e.g., R1-maths drops
  to 60% while R4-maths holds at 92% — that's an R1-bank-sparseness signal).
- **First measurement:** 30 days after the PRD-17 migration lands AND the
  tagging-agent backfill (§7 out-of-scope follow-up) has classified ≥ 80% of
  existing 200+ problems. Before that, the metric is reported with a
  `pre_backfill: true` flag and is informational only.
- **Output table:** `round_fit_rate_daily(snapshot_date, teacher_role, round,
  subject, tests_n, rfr_pct)` — added by a separate analytics-PRD migration,
  not by 0015.

Baseline today: not measurable (the columns don't exist). Today, every test is
effectively `MULTI_TOPIC` with no drill_difficulty signal, so a teacher building
an R1 drill set is doing it from memory.

### Leading indicators

1. **Scope-tag coverage** — fraction of `calibrated` problems with a non-default
   `question_scope` (i.e., explicitly tagged, not relying on the backfill
   default). Target: ≥ 95% by end-of-build for new problems imported after the
   migration; pre-existing 200+ problems re-tagged by the tagging-agent
   batch run (out-of-scope follow-up, see §7).
2. **drill_difficulty coverage** — fraction of `SINGLE_TOPIC` + `PAIRED_TOPICS`
   problems where `drill_difficulty IS NOT NULL`. Target: 100% for new problems
   (importer rejects otherwise — see US-2 AC).
3. **Tagging-agent auto-classification accuracy** — agreement between the
   auto-classified `question_scope` and the human reviewer's confirmation on a
   30-problem calibration set. Target: ≥ 85% exact-match.

   **Calibration-set construction (NEW in v2 — addresses Critic non-blocking
   #12):** the 30 problems are sampled **stratified across `(surface, trap)`
   combinations actually present in the bank**, with ≥ 3 problems from each
   combination that has ≥ 3 problems available. The sample is generated by a
   one-off script `scripts/build-scope-calibration-set.ts` and **frozen as a
   CSV fixture at `content/calibration/scope-fixture-v1.csv`** (checked in).
   The ≥ 85% target is measured against this exact fixture so the bar isn't
   gameable by re-sampling. If the bank lacks enough strata for a 30-row
   stratified sample at PRD-write time, the fixture starts at whatever size
   stratification allows (≥ 18 rows) and grows as the bank does.
4. **Reviewer override rate** — fraction of imported problems where the human
   reviewer changes the auto-classified `question_scope` or `drill_difficulty`
   before `calibrated` flip. Target: ≤ 15% in steady state (after 30-problem
   calibration). High override rate means the tagging-agent prompt needs work,
   not that the column is wrong.

### Guardrails (must NOT degrade)

1. **Backward compatibility.** All currently-importing v1 YAML files continue
   to validate and import. Zero regressions in importer tests.
2. **`authored_difficulty` semantics unchanged.** This PRD does NOT change what
   `authored_difficulty` means today; it adds `drill_difficulty` as a sibling
   column, not a replacement.
3. **Query latency.** Round-assignment queries hitting the new
   `(question_scope, drill_difficulty)` composite index respond in ≤ 200 ms p95
   at ≤ 10⁴ problems (see §5 NFR).

---

## 4. User Stories

### US-1: Teacher filters the bank for an R1 single-topic drill (T)

**As a** subject teacher, **I want to** filter the bank for "single-topic
problems on `PNC.DGT.EXMUL` at drill difficulty T2 or T3," **so that** I can
hand my R1 students a clean drill on the IDEA they just learned, without
accidentally giving them a trap-wrapped mock-test problem.

**Acceptance Criteria:**
- [ ] Given a teacher navigates to the bank-filter screen and selects
  `question_scope=SINGLE_TOPIC` + `drill_difficulty IN (T2, T3)` +
  `idea_code=EXMUL`, when they hit "Search," then the system returns only
  problems whose `question_scope` column equals `SINGLE_TOPIC` AND whose
  `drill_difficulty` is in `{T2, T3}` AND whose `idea_code` matches, ordered
  by `(drill_difficulty, authored_difficulty, question_code)`.
- [ ] Given the teacher selects `question_scope=MULTI_TOPIC`, when they hit
  Search, then the `drill_difficulty` filter is auto-disabled in the UI (greyed
  out) AND the server ignores any `drill_difficulty` parameter sent (because
  `MULTI_TOPIC` problems have `drill_difficulty=NULL` — see FR-A).
- [ ] Given the bank has zero problems matching the filter, when the teacher
  hits Search, then the system returns an empty result with the message
  "no problems matched — try widening the `drill_difficulty` range or relaxing
  scope to `PAIRED_TOPICS`."

**Flow (happy path):**
1. Trigger: teacher opens bank-filter screen.
2. Step: teacher picks `idea_code=EXMUL`, `question_scope=SINGLE_TOPIC`,
   `drill_difficulty=T2..T3`.
3. Step: server runs `SELECT … WHERE question_scope='SINGLE_TOPIC' AND
   drill_difficulty=ANY('{T2,T3}') AND idea_code='EXMUL'` hitting the
   `(question_scope, drill_difficulty)` composite index.
4. Outcome: teacher sees a ranked list; clicks any subset; assembles a
   `tests` row.

**Error paths:**
- **E1 — Filter combination is invalid** (e.g.,
  `scope=MULTI_TOPIC & drill_difficulty=T3`). → Server returns `400
  INVALID_FILTER_COMBINATION` with the human-readable reason; the UI guards
  against this combination upstream.

---

### US-2: Tagger auto-classifies a new problem on import (A)

**As a** content reviewer, **I want to** have the tagging-agent auto-classify
`question_scope` and `drill_difficulty` on every newly imported YAML, **so that**
I review and confirm in ≤ 30 s instead of typing 5 fields by hand on every
problem.

**Acceptance Criteria:**
- [ ] Given a v2 YAML file imports with `question_scope` AND (when scope ∈
  {SINGLE_TOPIC, PAIRED_TOPICS}) `drill_difficulty` explicitly set by the
  author, when the importer runs, then it writes the file's values verbatim
  into the `problems` row (it does NOT overwrite explicit author choices),
  subject to the FR-C disposition table for structural / sanity contradictions.
- [ ] Given a v2 YAML file imports without `question_scope` set, when the
  importer runs, then it invokes the **tagging-agent auto-classifier** (see
  FR-C) which returns `(scope, drill_difficulty, confidence_pct, reasoning)`,
  then the FR-C disposition table determines what happens:
  - `confidence_pct ≥ 70`: write values + `status='provisional'`.
  - `confidence_pct < 70`: write values + `status='provisional'` +
    `scope_needs_review=TRUE` (NOT rejected — see Critic-v1 issue #4 fix).
- [ ] Given a v1 YAML file imports (no `question_scope` field anywhere; legacy
  format), when the importer runs, then it defaults `question_scope =
  MULTI_TOPIC`, `drill_difficulty = NULL`, and logs a warning
  `LEGACY_V1_DEFAULTED_TO_MULTI_TOPIC: question_code=<code>` for the
  tagging-agent batch run to revisit.
- [ ] Given a YAML file declares `question_scope=MULTI_TOPIC` AND a non-null
  `drill_difficulty`, when the importer runs, then it rejects with
  `INVALID_SCOPE_DRILL_COMBINATION: MULTI_TOPIC requires drill_difficulty=null`.
  (This matches the DB CHECK constraint in FR-E so the error catches the
  problem at the importer layer, not after the DB write fails.)
- [ ] Given a YAML file declares `question_scope=SINGLE_TOPIC` or `PAIRED_TOPICS`
  AND `drill_difficulty=null`, when the importer runs, then it rejects with
  `MISSING_FIELD: drill_difficulty required when question_scope=<scope>`.
- [ ] Given the importer auto-classifies but the author marked
  `question_scope=SINGLE_TOPIC` and the solution's IDEAs touched span two
  distinct SUBTOPICs, when the importer runs, then it accepts the file (author
  intent wins on *interpretation* — see FR-C principle) AND emits a
  `SCOPE_SANITY_WARNING_SUBTOPIC` warning surfaced in the importer summary AND
  persisted to `provenance.scope_sanity_warnings[]` on the `problems` row.

**Flow (happy path — fresh problem):**
1. Trigger: reviewer drops a Claude-generated YAML in
   `content/maths/generated/`, runs `npm run import:problems`.
2. Step: importer reads YAML; sees `question_scope` is missing.
3. Step: importer calls the tagging-agent auto-classifier with the YAML's
   `solution`, `wrong_paths`, `surface`, `trap`, and IDEA codes referenced.
4. Step: classifier returns `(SINGLE_TOPIC, T3, confidence=88%, reasoning='one
   IDEA touched; SURF_PLAIN; TRAP_NONE')`. Importer writes the row with
   `status='provisional'`, `scope_needs_review=FALSE`.
5. Outcome: reviewer's summary shows
   `IMPORTED: <code> scope=SINGLE_TOPIC drill_difficulty=T3 conf=88%`; the
   reviewer either confirms (no action) or edits the YAML and re-imports.

**Error paths:**
- **E1 — Auto-classifier crashes** (e.g., network blip on Claude API call). →
  Importer falls back to "scope and drill_difficulty must be set explicitly in
  the YAML" and rejects with `CLASSIFIER_UNAVAILABLE: please set
  question_scope and drill_difficulty manually`. Never silently writes
  defaults.
- **E2 — Author declares scope=PAIRED_TOPICS but tagging-agent sees only one
  IDEA touched.** → The importer accepts (author intent wins) AND emits a
  `SCOPE_SANITY_WARNING_PAIRED_BUT_SINGLE_IDEA` warning persisted to
  `provenance.scope_sanity_warnings[]`.

**Edge cases:**
- Same YAML re-imported (idempotency): `question_code` is the upsert key. If
  `question_scope` or `drill_difficulty` changed and the problem is
  `provisional`, update is allowed. If `calibrated`, the existing
  `CALIBRATED_IMMUTABLE` rule from PRD-01 §6.A applies — update is rejected.

---

### US-3: Round-assignment engine picks a question for round R (S — indirect)

**As a** student, **I want to** receive problems whose `(scope,
drill_difficulty, authored_difficulty)` profile matches the round I'm in,
**so that** R1 drills don't blast me with trap-wrapped multi-topic problems
and R4 mocks don't waste my time with one-trick T2 drills.

**Acceptance Criteria:**
- [ ] Given a round-assignment query for `round=R1` over the bank, when the
  engine runs, then it returns problems satisfying the R1 profile (see
  matrix in FR-B) before relaxation: `question_scope=SINGLE_TOPIC` AND
  `drill_difficulty IN (T2, T3)`. `authored_difficulty` is a secondary sort key
  for tie-breaking.
- [ ] Given the bank has < N matching problems for the preferred profile of a
  round, when the engine runs, then it applies the **fallback ladder**
  (see FR-B "relaxation rules") until either ≥ N problems are returned or all
  ladder steps are exhausted, and the response includes a
  `relaxation_steps_applied` array naming which ladder steps were used.
- [ ] **(NEW in v2 — addresses Critic-v1 issue #5)** Given the relaxation
  ladder is fully exhausted and the returned count `M < N`, when the engine
  returns, then the response shape carries:
  - `problems: [...]` (the M problems found, may be empty);
  - `relaxation_steps_applied: ['step1','step2','step3','step4','step5']`;
  - `bank_underpopulated: true`;
  - `requested_n: N`, `returned_n: M`;
  - `topic_filter_held: <idea_code or null>` (echoes that the topic / idea_code
    filter was held constant throughout — see FR-B).

  The caller decides whether `M < N` is shippable: a drill recommendation
  endpoint MAY accept N=3 instead of N=10; a paper-builder UI MUST surface
  the underpopulation to the teacher.
- [ ] **(NEW in v2)** Given the original request specified an `idea_code` or
  taxonomy filter, when the relaxation ladder runs, then the `idea_code` /
  topic filter is **NEVER** relaxed by any ladder step — only `scope`,
  `drill_difficulty`, and `authored_difficulty` are. Returning 10 random
  problems instead of 4 EXMUL problems is **never** the right answer.
- [ ] Given a problem with `question_scope=SINGLE_TOPIC` and
  `drill_difficulty=T3`, when `assign_round(problem)` is called, then it
  returns `R1` or `R2` (both are valid primary rounds for that profile per
  the matrix).
- [ ] Given a problem with `question_scope=MULTI_TOPIC`,
  `drill_difficulty=NULL`, `authored_difficulty=T4`, when
  `assign_round(problem)` is called, then it returns `R4` (R3 is also
  accepted; both are surfaced in the response array if multiple primary rounds
  fit).
- [ ] Given a problem whose `(scope, drill_difficulty, authored_difficulty)`
  fits no round cleanly under primary rules (e.g.,
  `MULTI_TOPIC` + `authored_difficulty=T1`), when `assign_round(problem)` is
  called, then it returns `NULL` — meaning "this problem is outside the
  intended round profile" — and the response carries a brief reason.

**Flow (happy path — drill recommendation):**
1. Trigger: student in `round_at_time=R1` opens dashboard; the drill
   recommendation flow (PRD-01 US-3) fires.
2. Step: engine queries `problems WHERE question_scope='SINGLE_TOPIC' AND
   drill_difficulty=ANY('{T2,T3}') AND <failure-mode-tag filter from PRD-01>`.
3. Step: engine returns 5 problems; creates the drill `tests` row.
4. Outcome: student attempts a clean R1-grade drill.

---

### US-4: Reviewer cross-walks reviewer-assigned drill_difficulty (A)

**As a** content reviewer, **I want to** record my own `drill_difficulty`
estimate per problem alongside my existing `t_rating` and
`jee_authenticity_score` on the `problem_reviews` row, **so that** the
cross-walk validation flags inconsistency the same way it does today for
`(T_rating, jee_authenticity_score)`.

**Acceptance Criteria:**
- [ ] Given a reviewer submits a review for a `SINGLE_TOPIC` or `PAIRED_TOPICS`
  problem, when they save, then the review row carries a non-null
  `drill_difficulty` value.
- [ ] Given a reviewer submits a review for a `MULTI_TOPIC` problem, when they
  save, then `drill_difficulty` is null on the review row (matches the
  problem-row CHECK constraint logic, enforced by trigger or app-layer per
  FR-E).
- [ ] Given the cross-walk validator runs on a `JEE_ADVANCED`-target
  `SINGLE_TOPIC` problem, when reviewer-side `drill_difficulty` exceeds
  reviewer-side `t_rating` by ≥ 2 tiers (e.g., `drill_difficulty=T5`,
  `t_rating=T2`), then the validator flags
  `INCONSISTENT_DRILL_VS_TRATING: drill=<x> trating=<y>` and the problem cannot
  transition to `calibrated` until either the reviewer revises or the
  discrepancy is explained in `notes`.

---

## 5. Non-Functional Requirements

- **Performance**:
  - Round-assignment query (US-3): server response ≤ 200 ms p95 at ≤ 10⁴
    problems. The new composite index `(question_scope, drill_difficulty)` MUST
    satisfy this.
  - Bank-filter query (US-1): ≤ 200 ms p95.
  - Tagging-agent auto-classifier call (US-2): ≤ 3 s p95 per problem; importer
    waits synchronously. (This is a Claude API round-trip; latency is
    network-dominated, not DB-dominated.)
  - Importer total runtime for a single YAML: ≤ 5 s p95 (3 s classifier + 2 s
    validation + write).

- **Data integrity (DB-level CHECK constraint)**: the constraint
  `chk_scope_drill_difficulty_consistency` MUST enforce, at the
  Postgres level: `drill_difficulty IS NULL` when `question_scope =
  MULTI_TOPIC`; `drill_difficulty IS NOT NULL` when `question_scope IN
  (SINGLE_TOPIC, PAIRED_TOPICS)`. Application-level checks do not substitute —
  the DB is the structural guarantee.

- **Backward compatibility (importer)**: the importer accepts both v1 YAML
  (no `question_scope` field) and v2 YAML (explicit `question_scope`).
  v1 imports default to `question_scope=MULTI_TOPIC`, `drill_difficulty=NULL`.
  Existing importer tests continue to pass; one new test asserts the v1-default
  behaviour and one asserts the v2-explicit path.

- **Backward compatibility (DB)**: the migration adds two columns with DEFAULT
  values that match the v1 behaviour (`question_scope DEFAULT 'MULTI_TOPIC'`,
  `drill_difficulty NULL`) so existing 200+ rows remain valid the moment the
  migration applies. The CHECK constraint is satisfied by every existing row
  (they all become `MULTI_TOPIC` / `NULL` which passes the constraint).

- **Security**: `question_scope` and `drill_difficulty` are not PII; same
  read-permission model as the rest of `problems`. No new authorization
  surface.

- **Auditability**: any change to `question_scope` or `drill_difficulty` on a
  `provisional` problem updates `problems.updated_at`. Once `calibrated`, the
  immutability rule from PRD-01 §6.A applies — these two columns cannot be
  edited.

- **Tagging cost**: human reviewer adds ≤ 30 s per problem confirming the
  auto-classifier in steady state. Low-confidence classifications surface
  with `scope_needs_review=TRUE` (NOT rejected) so the reviewer queues them
  for triage instead of hand-editing YAML.

---

## 6. Functional Requirements (the resolved decisions)

### FR-A: `question_scope` is a 3-value enum + `drill_difficulty` NULL-policy

**Enum values (locked):**

```yaml
question_scope:
  SINGLE_TOPIC:  "Stays within one IDEA (or, at author's discretion, one
                  tightly-bound concept). The natural shape of a clean drill."
  PAIRED_TOPICS: "At most two related ideas — typically within the same SUBTOPIC,
                  or two ideas a teacher would intentionally drill together as a
                  'bridge'."
  MULTI_TOPIC:   "Three+ ideas, or full mock-test integration style — the
                  natural shape of a paper question."
```

**Author intent matters.** Taxonomy structure (TOPIC.SUBTOPIC.IDEA.SUB-IDEA) is
a sanity check, not the rule. The tagging-agent uses taxonomy structure as a
signal; the human author's declared `question_scope` wins on conflict, with a
sanity warning surfaced (US-2 AC + FR-C disposition table).

**Drill-difficulty NULL-policy (resolved — Option 1):**

> `drill_difficulty` is meaningful for both `SINGLE_TOPIC` and `PAIRED_TOPICS`;
> NULL **only** for `MULTI_TOPIC`.

Rationale: `PAIRED_TOPICS` is the "bridge drill" — a perfectly valid place to
hand a student two interlocking ideas at a specific drill difficulty. Excluding
PAIRED from drill_difficulty would force teachers to drop down to single-IDEA
drills or jump up to full mock-test problems, which is exactly the gap the user
identified. The DB CHECK constraint enforces this (FR-E).

**Disambiguation vs. PRD-01 diagnostic axes (NEW in v2 — addresses Critic
non-blocking #9):**

> `question_scope` is **orthogonal** to PRD-01's per-`wrong_paths` diagnostic
> axes. A `SINGLE_TOPIC` problem may still have multiple distinct `err_*_tags`
> in its summary arrays — those describe **HOW** students fail it, not how many
> topics it touches. `MULTI_TOPIC` here means "the problem integrates 3+
> IDEAs," not "the problem has multi-axis diagnostic tagging." A reader who
> wants to know "how do students fail this problem" reads `err_*_tags`; a
> reader who wants to know "what kind of drill is this" reads `question_scope`.

### FR-B: Round-assignment logic

This is the product feature the columns enable. Define `assign_round(problem)`
and the round-picker query that drives US-3.

**Round profile matrix (primary preference):**

| Round | Preferred scope | Preferred drill_difficulty | Preferred authored_difficulty |
|-------|---|---|---|
| **R1** First Prep         | `SINGLE_TOPIC`               | T2–T3   | (any — secondary)    |
| **R2** First Revision     | `SINGLE_TOPIC` or `PAIRED`   | T3–T4   | T2–T3                |
| **R3** Second Revision    | `PAIRED_TOPICS` or `MULTI`   | (lower weight) | T3–T4         |
| **R4** Final Round        | `MULTI_TOPIC`                | (NULL OK)      | T4–T5         |

The matrix is the **primary** rule. Boundaries overlap by design — an R1 student
benefits from a T2 SINGLE drill; an R2 student benefits from the same problem
plus T4 SINGLE problems and T3 PAIRED bridges. The engine returns problems
satisfying any round's primary preference.

**`assign_round(problem)`** returns the set of rounds whose primary preference
the problem satisfies, or `NULL` if it satisfies none cleanly. A single problem
can fit ≥ 1 round (this is intentional — same problem may be drilled in R1 and
revisited in R2).

**Relaxation ladder for the round-picker** (used when the bank has < N matching
problems for the round-assignment engine call):

| Step | Action |
|------|--------|
| 1 | Drop `authored_difficulty` filter (keep scope + drill_difficulty + topic). |
| 2 | Widen `drill_difficulty` by ±1 tier (T2–T3 → T1–T4). |
| 3 | Widen `question_scope` by one rung (`SINGLE_TOPIC` → also `PAIRED_TOPICS`; `MULTI_TOPIC` → also `PAIRED_TOPICS`). |
| 4 | Drop `drill_difficulty` filter entirely. |
| 5 | Drop `question_scope` filter entirely (last-resort: any problem matching the held topic filter). |

**Topic / `idea_code` filter is NEVER relaxed by any step.** "Give me 10 EXMUL
problems" returns ≤ 10 EXMUL problems with `bank_underpopulated: true`;
it does NOT return EXMUL ∪ non-EXMUL.

Every relaxation step is recorded in the response's `relaxation_steps_applied`
array so the teacher / UI knows the set is not a clean primary match.

**Ladder-exhausted response shape (NEW in v2 — addresses Critic-v1 issue #5):**

```json
{
  "problems": [...],
  "relaxation_steps_applied": ["step1","step2","step3","step4","step5"],
  "bank_underpopulated": true,
  "requested_n": 10,
  "returned_n": 4,
  "topic_filter_held": "EXMUL"
}
```

`bank_underpopulated` is `false` when the response was satisfied without
exhausting the ladder (i.e., `returned_n >= requested_n` at any step
including step 0 / no relaxation).

The caller is responsible for deciding whether `M < N` is shippable for the
use case (drill recommendation may accept N=3 instead of N=10; a paper-builder
UI may refuse and surface to the teacher).

**Round-assignment user-facing surface (this PRD specifies the SQL/HTTP API
only; UI is out of scope):**

- `GET /api/problems?scope=SINGLE_TOPIC&drill_difficulty_in=T2,T3` (US-1 bank
  filter).
- `GET /api/problems/for-round?round=R1&limit=10` (US-3 round picker — server
  picks the matrix profile for `round=R1` and applies the ladder if needed).
- DB function `assign_round(problem_row)` returns `Round[]` (the set of rounds
  whose primary preference the problem satisfies) or `NULL`. Used in admin
  reporting (e.g., "how much of the bank is R3-ready?").

### FR-C: Tagging-agent auto-classification

When `question_scope` is missing from the imported YAML, the importer calls
the tagging-agent auto-classifier with the YAML body and receives
`(question_scope, drill_difficulty, confidence_pct, reasoning)`.

**Signals the classifier uses (prompt-level guidance):**

1. **Count of distinct IDEAs touched in `solution`** — derived by string-matching
   IDEA codes in the solution text, or — if Claude is used — by asking Claude to
   list them.
2. **Count of distinct SUBTOPICs** spanning those IDEAs — taxonomy structure
   gives the SUBTOPIC for each IDEA.
3. **Presence of a single-shot technique vs multi-step integration** — heuristic
   from `solution.length`, presence of section headers (e.g., "Step 1.. Step 2..
   Step 3.."), and the number of `wrong_paths` (≥ 3 wrong paths usually
   indicates a richer multi-topic problem).
4. **`surface` vs `SURF_PLAIN`** — a `SURF_PLAIN` problem is heuristically more
   likely `SINGLE_TOPIC`; a non-PLAIN surface biases toward `PAIRED` or `MULTI`.
5. **`trap` vs `TRAP_NONE`** — a non-NONE trap biases toward `MULTI_TOPIC` (the
   trap is a layer added on top of the IDEA, which fits mock-test difficulty).

**Decision rule:**

- 1 IDEA touched, `SURF_PLAIN`, `TRAP_NONE` → `SINGLE_TOPIC` high confidence.
- 2 IDEAs in same SUBTOPIC, any surface, `TRAP_NONE` or single trap →
  `PAIRED_TOPICS`.
- ≥ 3 IDEAs OR IDEAs spanning ≥ 2 SUBTOPICs OR (≥ 2 IDEAs AND non-NONE trap) →
  `MULTI_TOPIC`.

**`drill_difficulty` assignment:** for SINGLE / PAIRED problems, the classifier
estimates how hard the problem is **after mentally stripping the surface and
trap layers** (i.e., "what T-tier would this be if it were a clean drill?").
Anchor: same top-10-rank student as `authored_difficulty`. For MULTI_TOPIC,
`drill_difficulty=NULL`.

#### FR-C.1 — Disposition Table (NEW in v2 — addresses Critic-v1 issue #3)

**Principle.** Author intent wins on *interpretation* disputes (scope tag,
drill_difficulty value). The DB CHECK constraint always wins on *structural*
combinations (no `MULTI_TOPIC` + non-null drill_difficulty under any
circumstance). Warnings persist as a structured array on the row, never
just stdout.

| # | Condition | Disposition | Code | Persisted to |
|---|---|---|---|---|
| C1 | Author `MULTI_TOPIC` + non-null `drill_difficulty` | **HARD REJECT** (DB CHECK would violate anyway) | `INVALID_SCOPE_DRILL_COMBINATION` | importer stderr; no row written |
| C2 | Author `SINGLE_TOPIC` or `PAIRED_TOPICS` + null `drill_difficulty` | **HARD REJECT** | `MISSING_FIELD: drill_difficulty` | importer stderr; no row written |
| C3 | YAML has no `question_scope` AND classifier unavailable (network / API down) | **HARD REJECT** | `CLASSIFIER_UNAVAILABLE` | importer stderr; no row written |
| C4 | YAML has no `question_scope`, classifier returns `confidence_pct < 70` | **AUTO-ACCEPT as `provisional`** + `scope_needs_review=TRUE` | `LOW_CONFIDENCE_CLASSIFICATION` | importer stdout + DB column `scope_needs_review` |
| C5 | YAML has no `question_scope`, classifier returns `confidence_pct ≥ 70` | **AUTO-ACCEPT as `provisional`** + `scope_needs_review=FALSE` | (info only) | importer stdout |
| C6 | Author `SINGLE_TOPIC` + solution touches ≥ 2 distinct SUBTOPICs | **WARN, accept (author intent wins)** | `SCOPE_SANITY_WARNING_SUBTOPIC` | `provenance.scope_sanity_warnings[]` + importer stdout |
| C7 | Author `PAIRED_TOPICS` + solution touches ≥ 3 IDEAs | **WARN, accept** | `SCOPE_SANITY_WARNING_TRIPLE_IDEA` | `provenance.scope_sanity_warnings[]` + importer stdout |
| C8 | Author `PAIRED_TOPICS` + classifier sees only 1 IDEA touched | **WARN, accept** | `SCOPE_SANITY_WARNING_PAIRED_BUT_SINGLE_IDEA` | `provenance.scope_sanity_warnings[]` + importer stdout |
| C9 | Author `MULTI_TOPIC` + solution touches 1 IDEA only | **WARN, accept** | `SCOPE_SANITY_WARNING_SINGLE_IDEA_MULTI_TAG` | `provenance.scope_sanity_warnings[]` + importer stdout |
| C10 | Author `SINGLE_TOPIC` + `drill_difficulty=T5` + `authored_difficulty=T1` (drill is harder than mock — contradicts definition) | **WARN, accept** | `SCOPE_SANITY_WARNING_INVERTED_DRILL` | `provenance.scope_sanity_warnings[]` + importer stdout |
| C11 | Author `SINGLE_TOPIC` + `wrong_paths` reference IDEAs from 2 distinct SUBTOPICs | **WARN, accept** | `SCOPE_SANITY_WARNING_WRONG_PATH_SUBTOPIC` | `provenance.scope_sanity_warnings[]` + importer stdout |
| C12 | v1 YAML (no `question_scope` field anywhere) | **AUTO-ACCEPT** with defaults (`MULTI_TOPIC`, NULL) + log | `LEGACY_V1_DEFAULTED_TO_MULTI_TOPIC` | importer stdout |

**Schema for `provenance.scope_sanity_warnings[]`:** a JSONB array on the
existing `problems.provenance` JSONB column, with shape:

```json
"scope_sanity_warnings": [
  {
    "code": "SCOPE_SANITY_WARNING_SUBTOPIC",
    "detected_at": "2026-06-28T12:34:56Z",
    "detail": "author SINGLE_TOPIC; solution subtopics=[DGT, NUM]"
  }
]
```

The reviewer's confirmation UI (out of scope for this PRD) reads this array
to display "this problem has 2 warnings from the importer — review before
calibrating."

**Confidence threshold (70%).** The 70% cutoff is a SOFT gate — it controls
the `scope_needs_review` flag, **not** rejection. Rejection only happens for
structural violations (C1–C3) and missing-required-field cases (C2). The
threshold is calibrated against the §3 leading indicator "≥ 85% exact-match
agreement on first 30 problems"; if the steady-state agreement drops, the
threshold can be raised in a follow-up.

**Confidence-distribution logging (NEW in v2 — addresses Critic non-blocking
#8):** the importer's summary output additionally appends one line per
classified problem to `logs/import_classification_log.jsonl` (rotated weekly)
with shape `{ts, question_code, classifier_output: {scope, drill_difficulty,
confidence_pct, reasoning}, author_provided_scope: <bool>, disposition: <code>}`.
After the first 30 imports a one-off review reads the distribution to validate
Q2 (open question §10).

### FR-D: YAML schema bump (v1 → v2)

- New **required** field on every problem YAML: `question_scope:
  SINGLE_TOPIC | PAIRED_TOPICS | MULTI_TOPIC`.
- New **conditionally required** field: `drill_difficulty: T1 | T2 | T3 | T4 |
  T5 | null`. Required (non-null) when `question_scope IN (SINGLE_TOPIC,
  PAIRED_TOPICS)`; required null when `question_scope = MULTI_TOPIC`.
- The `_SCHEMA.md` file bumps `schema_version: 1 → 2`. Coordination note: if
  PRD-01's `diagnostic_tags` schema bump is also being applied in the same
  release cycle, the two bumps land in **the same `_SCHEMA.md` v2** — both PRDs
  point at the same `schema_version=2`. The importer must accept any YAML that
  conforms to v2 in either or both dimensions; v1 fallbacks default
  conservatively in both dimensions.
- Backward compatibility: importer accepts v1 YAML AND v2 YAML. v1 defaults:
  `question_scope=MULTI_TOPIC`, `drill_difficulty=NULL`.

**Structural CI invariant (NEW in v2 — addresses Critic non-blocking #11):**

The importer's validation function MUST define a single source-of-truth list
of v2-required fields, e.g.:

```ts
const V2_REQUIRED_FIELDS = [
  'question_scope',           // PRD-17
  // 'wrong_paths[i].diagnostic_tags',  // PRD-01 (when it lands)
];
```

CI MUST run both PRDs' AC fixtures against the same importer build (a single
`scripts/test-importer-v2-coordination.ts` runs the union of fixtures from
`tests/importer/prd-17/` and `tests/importer/prd-01/`). If only one PRD has
landed at CI time, only its fixtures run; the other's fixture directory is
empty and trivially passes. When the second PRD lands, the importer code MUST
extend `V2_REQUIRED_FIELDS` in the same commit, and the CI run extends
naturally. The schema bump is therefore enforced by code+CI, not by textual
coordination.

### FR-E: Importer + DB-level enforcement

**Migration slot — `0015_question_scope_drill_difficulty/` (corrected from v1):**

- v1 PRD assumed slot `0014`. **Slot 0014 is already taken** by
  `0014_user_password_hash` (verified against
  `backend/prisma/migrations/`). The next available slot at v2 draft time is
  **`0015`**.
- **Defensive guard against further collisions (NEW in v2 — addresses
  Critic-v1 issue #2):** the slot is asserted as `0015` at draft time. If at
  Stage-3 implementation time another in-flight migration (e.g., a
  `hints-authoring` migration spawned by PRD-16's Vision Update §4) has
  already claimed `0015`, this PRD's migration MUST move up to the next
  unallocated `0NNN_…` slot. The only structural requirements are:
  - the slot sorts AFTER `0014_user_password_hash`;
  - the slot sorts BEFORE any later migration that adds a FK reference to
    `problems.question_scope`;
  - the directory name conforms to `0NNN_question_scope_drill_difficulty` per
    `backend/prisma/migrations/README.md` §"Naming convention".
- **Acceptance criterion:** the migration directory name matches the
  `^0\d{3}_question_scope_drill_difficulty$` regex AND `ls` of
  `backend/prisma/migrations/` shows no two directories with the same
  4-digit prefix.

**Migration body:**

- New Postgres enum `QuestionScope` with values `SINGLE_TOPIC`,
  `PAIRED_TOPICS`, `MULTI_TOPIC`.
- New column `problems.question_scope QuestionScope NOT NULL DEFAULT
  'MULTI_TOPIC'`.
- **New column `problems.drill_difficulty IntrinsicDifficulty NULL`** (reuses
  the existing `IntrinsicDifficulty` Postgres enum defined in
  `backend/prisma/schema.prisma:79` — `T1`..`T5`). **No new enum; no new alias.**
  (v1 said `TRating`; that was a misnomer derived from the *column* name
  `ProblemReview.t_rating`. The *type* is `IntrinsicDifficulty`. Critic-v1
  issue #1 fix.)
- **New column `problems.scope_needs_review BOOLEAN NOT NULL DEFAULT FALSE`**
  (flipped TRUE by the importer when classifier confidence < 70; the existing
  `provisional` queue UI already filters by `status` and can additionally
  filter by this column). No new table; minimal schema change.
- New CHECK constraint `chk_scope_drill_difficulty_consistency`:
  ```sql
  CHECK (
    (question_scope = 'MULTI_TOPIC' AND drill_difficulty IS NULL)
    OR
    (question_scope IN ('SINGLE_TOPIC','PAIRED_TOPICS') AND drill_difficulty IS NOT NULL)
  )
  ```
- New B-tree composite index `idx_problems_scope_drill_difficulty` on
  `(question_scope, drill_difficulty)` for the round-assignment query.
- New B-tree index `idx_problems_question_scope` on `(question_scope)` alone for
  the US-1 scope-only filter case.
- New partial B-tree index `idx_problems_scope_needs_review` on
  `(scope_needs_review) WHERE scope_needs_review = TRUE` for the
  reviewer-triage queue lookup (typically << 200 rows).
- Same migration also adds `drill_difficulty` to `problem_reviews` (per FR-F),
  with the cross-table nullability rule enforced **by a Postgres trigger or an
  application-layer invariant in the importer + review UI write path** (per
  Stage-2 Architect's choice — the requirement is *enforcement of the
  invariant*; the mechanism is delegated). Postgres CHECK constraints cannot
  reference other tables, so "CHECK" was a mis-statement in v1 — corrected
  here per Critic non-blocking #10.
- `migration.sql` AND `down.sql` per the migrations README — both reversible
  and replay-safe.
- Migration ordering: depends only on `0003_taxonomy_enums` (for
  `IntrinsicDifficulty`) and `0006_diagnostic_summaries` (for the
  `problems.provenance` JSONB column reused in FR-C.1). Both are well-prior to
  0015.

**Importer (`backend/scripts/import-yaml.ts`) changes:**

- Parse new `question_scope` and `drill_difficulty` fields from YAML.
- If missing, run auto-classification (FR-C); apply FR-C.1 disposition table.
- Validate the scope×drill_difficulty combination against the same predicate as
  the DB CHECK constraint (fail fast at the importer layer with a clear
  message before the DB rejects the INSERT).
- Persist sanity warnings to `provenance.scope_sanity_warnings[]` as defined in
  FR-C.1.
- Emit summary including auto-classification details, sanity warnings, and the
  per-row `scope_needs_review` flag.
- Append a row per classified problem to
  `logs/import_classification_log.jsonl` (FR-C confidence-distribution log).

### FR-F: Reviews + cross-walk

Add **`drill_difficulty IntrinsicDifficulty NULL`** column to `problem_reviews`
(v1 said `TRating`; corrected to `IntrinsicDifficulty`). Same nullability
semantics as on `problems`: NULL iff the parent problem's `question_scope =
MULTI_TOPIC`.

Enforcement of the cross-table nullability rule is by **Postgres trigger or
application-layer invariant** at the importer + review-UI write path. (A
single-table CHECK constraint cannot reference another table; the Architect
picks the mechanism — trigger preferred for structural guarantee, app-layer
acceptable if the trigger is too heavy.)

The cross-walk validator already runs on `(t_rating, jee_authenticity_score)`
for `JEE_ADVANCED`-target problems. Extend it with one new check (per US-4
AC): for `SINGLE_TOPIC` / `PAIRED_TOPICS` problems, flag when reviewer-side
`drill_difficulty` exceeds reviewer-side `t_rating` by ≥ 2 tiers, OR when
`drill_difficulty` is much higher than reviewer-side `t_rating` for a problem
the reviewer also rated low on `jee_authenticity_score` (the
"this-is-a-coaching-grind-not-a-JEE-problem" signature). Stage-2 Architect
chooses whether this is a trigger, an application-layer validation step, or a
nightly batch.

### FR-G: Backfill (cite as follow-up — out of scope for this PRD)

Existing 200+ problems default to `question_scope = MULTI_TOPIC`,
`drill_difficulty = NULL` the moment the migration applies. A separate
follow-up task runs the tagging-agent batch-re-classifier across the bank,
producing a CSV `(question_code, current_scope, suggested_scope,
suggested_drill_difficulty, classifier_confidence, reviewer_disposition)` for
the reviewer to confirm. That batch run is outside this PRD; cited explicitly
in §7 Out of Scope.

---

## 7. Out of Scope

Explicitly NOT included in this PRD; future iterations.

- **Backfilling the existing 200+ problems.** The migration applies the
  conservative `MULTI_TOPIC` default; the tagging-agent batch re-classifier
  runs as a separate task. This PRD specifies the *importer-time* path only.
- **Teacher paper-builder UI.** This PRD describes the SQL/HTTP API surface
  for round-aware filtering (FR-B); the visual UI to drive it ships in a
  separate PRD when the teacher web-app is built.
- **Predictive model for round-fit.** No ML; the round-assignment engine is a
  deterministic SQL filter today. A future PRD may add an ML re-ranker on top.
- **Empirical drill_difficulty (computed from attempts).** This PRD only deals
  with **authored** `drill_difficulty` (the reviewer's a-priori estimate). When
  the platform has enough attempts to derive an empirical drill difficulty,
  the existing `empirical_difficulty_by_round` column or a sibling column gets
  populated by the nightly batch — separate PRD.
- **Physics and Chemistry taxonomy.** This PRD applies the schema change
  across all subjects (the DB columns are subject-agnostic), but the
  tagging-agent prompt is calibrated against maths first. A follow-up adjusts
  the prompt for P and C.
- **A `question_scope` value finer than 3 levels.** No `SINGLE_SUBTOPIC`,
  `WITHIN_SUBTOPIC`, `CROSS_TOPIC` etc. — the 3-value enum is the deliberate
  choice. Reopen the question only when ≥ 30% of `PAIRED_TOPICS` problems are
  flagged by the reviewer as needing a finer split.
- **Round-aware filtering of `problem_diagnostic_misses`** (PRD-01 E2 queue).
  The miss-queue UI is already deferred to Stage-7 admin tooling; round-scope
  filtering on it is part of that PRD.
- **Hint-visibility rules per round** (e.g., suppress hints on R4 mocks). See
  §8 "Interaction with PRD-16 hints" — out of scope here, deferred to a
  separate test-runtime-extension or hints-authoring PRD.

---

## 8. Edge Cases

- **`target_exam != JEE_ADVANCED`** (e.g., a `JEE_MAIN` or `COACHING` problem).
  The DB schema makes `question_scope` required for every row regardless of
  target_exam (a coaching problem is still single- or multi-topic). However,
  the cross-walk validator (FR-F) only enforces the `drill_difficulty` vs
  `t_rating` consistency check on `JEE_ADVANCED` problems — that's the only
  exam whose T-rating anchor is canonically defined in this bank.
  `JEE_MAIN`, `IOQM`, etc. carry `drill_difficulty` for filtering purposes
  but skip the cross-walk gate.
- **Reviewer disagrees with author's `question_scope`.** The review row carries
  its own `t_rating` and `drill_difficulty`; the problem row carries the
  author's. Per the existing PRD-01 §6 reviews model, reviewers do NOT
  overwrite author tags on the problem row. The disagreement surfaces in the
  inter-rater view (existing `problem_reviews` per-axis-disagreement query):
  if N reviewers disagree on `question_scope`, the problem is flagged for
  reviewer triage before `calibrated` flip.
- **A problem whose `wrong_paths` happen to span multiple SUBTOPICs even
  though the author tagged `SINGLE_TOPIC`.** The importer emits
  `SCOPE_SANITY_WARNING_WRONG_PATH_SUBTOPIC` (FR-C.1 row C11) and accepts the
  file. Author intent wins. The warning lives in
  `provenance.scope_sanity_warnings[]` so the reviewer sees it post-import.
- **An author marks `MULTI_TOPIC` but the solution touches only one IDEA.**
  Symmetric: `SCOPE_SANITY_WARNING_SINGLE_IDEA_MULTI_TAG` (C9), file accepted,
  author intent wins.
- **A problem is `PAIRED_TOPICS` but the bank has no problems for the partner
  IDEA yet.** This affects the *round-picker's set-construction*, not the
  individual problem tag — `assign_round` still returns the rounds whose
  preference the problem satisfies; the picker's relaxation ladder (FR-B)
  kicks in if the bank doesn't have enough problems, ultimately returning a
  `bank_underpopulated: true` shape (FR-B AC).
- **Migration applied to a DB that already has rows with NULL
  `drill_difficulty` from some pre-existing migration drift.** Should not
  happen (the column doesn't exist before this migration), but the migration
  is defensive: the CHECK constraint is added AFTER the columns are populated
  with safe defaults, so existing rows trivially satisfy it.
- **An attempt to set `drill_difficulty='T3'` when `question_scope='MULTI_TOPIC'`
  via direct SQL.** Fails with the CHECK constraint violation
  `chk_scope_drill_difficulty_consistency`. The importer-layer check catches
  this before the DB write in the YAML path, but the DB is the structural
  guarantee.
- **(NEW in v2 — addresses Critic-v1 issue #6) Interaction with PRD-16 hints
  (scope-orthogonal).** The `question_scope` and `drill_difficulty` columns
  **do NOT change `problems.hint_count` semantics**. Hints remain a
  per-problem authored property. **Both a `SINGLE_TOPIC` problem and a
  `MULTI_TOPIC` problem use the same hint endpoint identically** — the same
  `GET /api/test-sessions/{session_id}/questions/{slot_index}/hints/{next_level}`
  call from PRD-16 §US-7. The PRD-17 schema change does NOT add any
  scope-dependent branching to the hint endpoint contract; the endpoint
  returns hints if `hint_count > 0`, regardless of `question_scope`.

  Product judgment about *when* to suppress hints (e.g., "suppress hint link
  in R4 mock tests, show it in R1 drills") is a **separate product decision**
  that may be made by a future test-runtime-extension or hints-authoring PRD.
  PRD-17 commits only to: the columns exist, they CAN be read by a future
  test-runtime filter to make this decision, and they do NOT affect the
  existing hint endpoint contract for v1 ship. Engineers MUST NOT introduce
  scope-dependent hint-visibility logic in this PRD's implementation.

---

## 9. Dependencies & Assumptions

**Depends on:**

- The Prisma schema and the importer script from Stages 2–3 (exist).
- The taxonomy file `content/taxonomy/maths.yaml` for IDEA / SUBTOPIC lookups
  used by the auto-classifier (exists; the `rounds` section at line 400 is
  also the reference for FR-B's matrix).
- **The `IntrinsicDifficulty` Prisma / Postgres enum** (`T1`–`T5`) defined in
  `backend/prisma/schema.prisma:79`. `drill_difficulty` reuses this enum
  directly. **No new enum, no Prisma alias, no `TRating` type.** (Critic-v1
  issue #1 fix.)
- The `problems.provenance` JSONB column from `0006_diagnostic_summaries`
  (exists; reused for `scope_sanity_warnings[]`).
- **Coordination with PRD-01's `_SCHEMA.md` v1→v2 bump.** Both PRDs bump
  schema_version. The two changes must land in the same v2 schema doc so
  authors don't trip over a "v2 means PRD-01" vs "v2 means PRD-17" ambiguity.
  Resolution: whoever lands first writes v2 with their fields; whoever lands
  second appends to v2 without bumping further. The PRD that lands second
  must explicitly verify in its acceptance criteria that the v2 schema doc
  carries BOTH sets of fields. The structural CI invariant in FR-D enforces
  this end-to-end.
- The Claude API (or whatever LLM the tagging-agent uses) for the
  auto-classifier in FR-C. If the API is unreachable, the importer rejects
  with `CLASSIFIER_UNAVAILABLE` (FR-C.1 row C3); it never silently writes
  defaults.

**Assumes:**

- Authors will populate `question_scope` (explicitly or via the classifier)
  for every new problem from the migration onwards. The backfill of the
  existing 200+ problems happens as a separate follow-up.
- The 3-value enum is sufficient for the round-assignment logic. A finer
  enum (single_subtopic vs single_idea vs single_sub_idea) is out of scope
  per §7.
- The round-assignment matrix (FR-B) is a strawman validated by the user's
  brief; the Spec Critic and the user may push back. The matrix is in scope
  for v2; refinement is open-question Q1 below.
- Tagging-agent auto-classifier has access to the YAML body at import time —
  which it does, via the existing import pipeline.
- The `provisional` status flow already supports an additional flag column —
  it does; `scope_needs_review` is an additive boolean, no schema-shape
  change.

---

## 10. Open Questions

These are the questions the user (or the Spec Critic) needs to resolve before
or during Stage-2 Architecture.

- [ ] **Q1 — Round-assignment matrix details.** FR-B's matrix is a strawman.
  Specifically: should R2 prefer `T3–T4 drill_difficulty` with `T2–T3
  authored_difficulty`, or the reverse? The strawman picks the former. The
  user is the only one who knows from teaching practice which one fits the
  R2 cohort. Resolution affects only the `for-round?round=R2` query, not the
  schema. **Decision needed before Stage-3 implementation of the round
  picker.**
- [ ] **Q2 — Confidence threshold (70%).** The 70% cutoff in FR-C is
  unvalidated until the first 30 problems are auto-classified and the human
  agreement rate is measured. **v2 mitigates this** by logging
  `confidence_pct` to `logs/import_classification_log.jsonl` (FR-C
  confidence-distribution log). If steady-state agreement is < 85%, the
  cutoff should rise. Decision can be made after the first 30 problems (NOT
  a blocker for Stage 3).
- [ ] **Q3 — Should `assign_round` return `Round[]` (multi-fit) or one
  preferred round?** The strawman returns `Round[]` because the same problem
  can legitimately fit R1 and R2. The teacher paper-builder UI (out of scope)
  may want a single preferred round. Decision deferred to that PRD; this PRD
  ships the `Round[]` shape and the UI can collapse if needed.
- [ ] **Q4 — `drill_difficulty` for non-`JEE_ADVANCED` target_exam problems.**
  §8 says these problems carry `drill_difficulty` for filtering but skip the
  cross-walk validation. Confirm: is that the right call for COACHING-target
  problems specifically (where the coaching grind difficulty norm differs
  from JEE-Adv top-10 anchor)? Reasonable default per §9; flagged for user
  confirmation.

---

*End of PRD-17 v2 draft.*
