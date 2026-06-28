# PRD-17: Question Scope + Drill Difficulty — Round-Aware Problem Selection

**Stage:** 1 (Spec Loop) | **Iteration:** v1 | **Author:** Product Manager (generator)
**Reviewed by:** Spec Critic (pending) | **Scope window:** `problems` model, importer, tagging-agent prompt
**Sibling artifacts:** PRD-01 (diagnostic axes — `01-prd-final.md`), PRD-16 (test runtime — `16-test-runtime-prd-final.md`)
**Relative size:** smaller than PRD-16; comparable to PRD-01 modulo the empirical-evidence appendices.

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

Baseline today: not measurable (the columns don't exist). Today, every test is
effectively `MULTI_TOPIC` with no drill_difficulty signal, so a teacher building
an R1 drill set is doing it from memory.

### Leading indicators

1. **Scope-tag coverage** — fraction of `calibrated` problems with a non-default
   `question_scope` (i.e., explicitly tagged, not relying on the backfill
   default). Target: ≥ 95% by end-of-build for new problems imported after
   migration 0014; pre-existing 200+ problems re-tagged by the tagging-agent
   batch run (out-of-scope follow-up, see §7).
2. **drill_difficulty coverage** — fraction of `SINGLE_TOPIC` + `PAIRED_TOPICS`
   problems where `drill_difficulty IS NOT NULL`. Target: 100% for new problems
   (importer rejects otherwise — see US-2 AC).
3. **Tagging-agent auto-classification accuracy** — agreement between the
   auto-classified `question_scope` and the human reviewer's confirmation on the
   first 30-problem calibration set. Target: ≥ 85% exact-match.
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
  into the `problems` row (it does NOT overwrite explicit author choices).
- [ ] Given a v2 YAML file imports without `question_scope` set, when the
  importer runs, then it invokes the **tagging-agent auto-classifier** (see
  FR-C) which returns `(scope, drill_difficulty, confidence_pct)`, then:
  (a) if `confidence_pct ≥ 70`, the importer writes the classifier's values
  and marks the problem `provisional`; (b) if `confidence_pct < 70`, the
  importer rejects with `LOW_CONFIDENCE_CLASSIFICATION: question_code=<code>
  confidence=<n>%; please set question_scope explicitly`.
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
  intent wins) AND emits a `SCOPE_SANITY_WARNING: author tagged SINGLE_TOPIC
  but solution touches subtopics=[A, B] — verify` warning surfaced in the
  importer's summary output for the reviewer to confirm.

**Flow (happy path — fresh problem):**
1. Trigger: reviewer drops a Claude-generated YAML in
   `content/maths/generated/`, runs `npm run import:problems`.
2. Step: importer reads YAML; sees `question_scope` is missing.
3. Step: importer calls the tagging-agent auto-classifier with the YAML's
   `solution`, `wrong_paths`, `surface`, `trap`, and IDEA codes referenced.
4. Step: classifier returns `(SINGLE_TOPIC, T3, confidence=88%)`. Importer
   writes the row.
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
  `SCOPE_SANITY_WARNING: author tagged PAIRED_TOPICS but only IDEA=<x> seen
  in solution`.

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
  matrix below) before relaxation: `question_scope=SINGLE_TOPIC` AND
  `drill_difficulty IN (T2, T3)`. `authored_difficulty` is a secondary sort key
  for tie-breaking.
- [ ] Given the bank has < N matching problems for the preferred profile of a
  round, when the engine runs, then it applies the **fallback ladder**
  (see FR-B "relaxation rules") until either ≥ N problems are returned or all
  ladder steps are exhausted, and the response includes a
  `relaxation_steps_applied` array naming which ladder steps were used.
- [ ] Given a problem with `question_scope=SINGLE_TOPIC` and
  `drill_difficulty=T3`, when `assign_round(problem)` is called, then it
  returns `R1` or `R2` (both are valid primary rounds for that profile per
  the matrix below).
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
  problem-row CHECK constraint).
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

- **Backward compatibility (DB)**: migration `0014` adds two columns with
  DEFAULT values that match the v1 behaviour (`question_scope DEFAULT
  'MULTI_TOPIC'`, `drill_difficulty NULL`) so existing 200+ rows remain valid
  the moment the migration applies. The CHECK constraint is satisfied by
  every existing row (they all become `MULTI_TOPIC` / `NULL` which passes the
  constraint).

- **Security**: `question_scope` and `drill_difficulty` are not PII; same
  read-permission model as the rest of `problems`. No new authorization
  surface.

- **Auditability**: any change to `question_scope` or `drill_difficulty` on a
  `provisional` problem updates `problems.updated_at`. Once `calibrated`, the
  immutability rule from PRD-01 §6.A applies — these two columns cannot be
  edited.

- **Tagging cost**: human reviewer adds ≤ 30 s per problem confirming the
  auto-classifier in steady state. If `confidence_pct < 70`, the importer
  rejects upfront (US-2 AC), so the reviewer only sees confident
  auto-classifications.

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
sanity warning surfaced (US-2 AC).

**Drill-difficulty NULL-policy (resolved — Option 1):**

> `drill_difficulty` is meaningful for both `SINGLE_TOPIC` and `PAIRED_TOPICS`;
> NULL **only** for `MULTI_TOPIC`.

Rationale: `PAIRED_TOPICS` is the "bridge drill" — a perfectly valid place to
hand a student two interlocking ideas at a specific drill difficulty. Excluding
PAIRED from drill_difficulty would force teachers to drop down to single-IDEA
drills or jump up to full mock-test problems, which is exactly the gap the user
identified. The DB CHECK constraint enforces this (FR-E).

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

> Step 1: drop the `authored_difficulty` filter (keep only scope + drill_difficulty).
> Step 2: widen `drill_difficulty` by ±1 tier (T2–T3 → T1–T4).
> Step 3: widen `question_scope` by one rung (`SINGLE_TOPIC` → also `PAIRED_TOPICS`;
> `MULTI_TOPIC` → also `PAIRED_TOPICS`).
> Step 4: drop `drill_difficulty` filter entirely.
> Step 5: drop `question_scope` filter entirely (last-resort: any problem).

Every relaxation step is recorded in the response's `relaxation_steps_applied`
array so the teacher / UI knows the set is not a clean primary match.

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

**`drill_difficulty` assignment:** for SINGLE / PAIRED problems, the
classifier estimates how hard the problem is **after mentally stripping the
surface and trap layers** (i.e., "what T-tier would this be if it were a clean
drill?"). Anchor: same top-10-rank student as `authored_difficulty`. For
MULTI_TOPIC, `drill_difficulty=NULL`.

**Sanity-check rules (the importer emits warnings, doesn't reject):**

1. If author marks `SINGLE_TOPIC` but the `wrong_paths` reference two distinct
   SUBTOPICs → warn `SCOPE_SANITY_WARNING: author SINGLE_TOPIC vs wrong_paths
   subtopics=[A, B]`.
2. If author marks `PAIRED_TOPICS` but the solution touches ≥ 3 IDEAs → warn
   `SCOPE_SANITY_WARNING: author PAIRED_TOPICS vs solution IDEAs=[X, Y, Z]`.
3. If author marks `SINGLE_TOPIC` AND `drill_difficulty=T5` AND
   `authored_difficulty=T1` → warn `INCONSISTENT_RATING: drill=T5 authored=T1
   on SINGLE — verify`. (A SINGLE drill being harder than the same problem as
   a mock-test contradicts the definition.)

**Confidence threshold:** the importer rejects auto-classification with
`confidence_pct < 70`. The author must then set `question_scope` and
`drill_difficulty` explicitly in the YAML and re-import. The 70% threshold is
calibrated against the §3 leading indicator "≥ 85% exact-match agreement on
first 30 problems"; if the steady-state agreement drops, the threshold can be
raised in a follow-up.

### FR-D: YAML schema bump (v1 → v2)

- New **required** field on every problem YAML: `question_scope:
  SINGLE_TOPIC | PAIRED_TOPICS | MULTI_TOPIC`.
- New **conditionally required** field: `drill_difficulty: T1 | T2 | T3 | T4 |
  T5 | null`. Required (non-null) when `question_scope IN (SINGLE_TOPIC,
  PAIRED_TOPICS)`; required null when `question_scope = MULTI_TOPIC`.
- The `_SCHEMA.md` file bumps `schema_version: 1 → 2`. (Coordination note: if
  PRD-01's `diagnostic_tags` schema bump is also being applied in the same
  release cycle, the two bumps land in **the same `_SCHEMA.md` v2** — both PRDs
  point at the same `schema_version=2`. The importer must accept any YAML that
  conforms to v2 in either or both dimensions; v1 fallbacks default
  conservatively in both dimensions.)
- Backward compatibility: importer accepts v1 YAML AND v2 YAML. v1 defaults:
  `question_scope=MULTI_TOPIC`, `drill_difficulty=NULL`.

### FR-E: Importer + DB-level enforcement

**Migration 0014 — `0014_question_scope_drill_difficulty/`:**

- New Postgres enum `QuestionScope` with values `SINGLE_TOPIC`,
  `PAIRED_TOPICS`, `MULTI_TOPIC`.
- New column `problems.question_scope QuestionScope NOT NULL DEFAULT
  'MULTI_TOPIC'`.
- New column `problems.drill_difficulty TRating NULL` (reuses the existing
  `IntrinsicDifficulty` / `TRating` enum — same T1–T5 values).
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
- Same migration also adds `drill_difficulty` to `problem_reviews` (per FR-F),
  with the same nullability rule joined to the parent `problem.question_scope`
  via a CHECK or trigger (per Stage-2 Architect's choice — the requirement is
  enforcement, the mechanism is delegated).
- `migration.sql` AND `down.sql` per the migrations README — both reversible
  and replay-safe.
- Migration ordering: this slot is `0014_question_scope_drill_difficulty/`
  per the README's `0NNN_…` rule. The migration depends only on `0003`
  (enums) and `0006` (DB-trigger pattern reuse), both well-prior.

**Importer (`backend/scripts/import-yaml.ts`) changes:**

- Parse new `question_scope` and `drill_difficulty` fields from YAML.
- If missing, run auto-classification (FR-C); if `confidence_pct < 70`, reject.
- Validate the scope×drill_difficulty combination against the same predicate as
  the DB CHECK constraint (fail fast at the importer layer with a clear
  message before the DB rejects the INSERT).
- Emit summary including auto-classification details and any sanity warnings.

### FR-F: Reviews + cross-walk

Add `drill_difficulty TRating NULL` column to `problem_reviews`. Same
nullability semantics as on `problems`: NULL iff the parent problem's
`question_scope = MULTI_TOPIC`.

The cross-walk validator already runs on `(T_rating, jee_authenticity_score)`
for `JEE_ADVANCED`-target problems. Extend it with one new check (per US-4
AC): for `SINGLE_TOPIC` / `PAIRED_TOPICS` problems, flag when reviewer-side
`drill_difficulty` exceeds reviewer-side `t_rating` by ≥ 2 tiers, OR when
`drill_difficulty` is much higher than reviewer-side `t_rating` for a problem
the reviewer also rated low on `jee_authenticity_score` (the
"this-is-a-coaching-grind-not-a-JEE-problem" signature). Stage-2 Architect
chooses whether this is a CHECK trigger, an application-layer validation step,
or a nightly batch.

### FR-G: Backfill (cite as follow-up — out of scope for this PRD)

Existing 200+ problems default to `question_scope = MULTI_TOPIC`,
`drill_difficulty = NULL` the moment migration 0014 applies. A separate
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
  though the author tagged `SINGLE_TOPIC`.** The importer emits a
  `SCOPE_SANITY_WARNING` (FR-C) but accepts the file. Author intent wins. The
  warning lives in the importer's summary output so the reviewer can confirm
  or correct.
- **An author marks `MULTI_TOPIC` but the solution touches only one IDEA.**
  Symmetric: warning emitted, file accepted, author intent wins.
- **A problem is `PAIRED_TOPICS` but the bank has no problems for the partner
  IDEA yet.** This affects the *round-picker's set-construction*, not the
  individual problem tag — `assign_round` still returns the rounds whose
  preference the problem satisfies; the picker's relaxation ladder (FR-B)
  kicks in if the bank doesn't have enough problems.
- **Migration applied to a DB that already has rows with NULL
  `drill_difficulty` from some pre-existing migration drift.** Should not
  happen (the column doesn't exist before 0014), but the migration is
  defensive: the CHECK constraint is added AFTER the columns are populated
  with safe defaults, so existing rows trivially satisfy it.
- **An attempt to set `drill_difficulty='T3'` when `question_scope='MULTI_TOPIC'`
  via direct SQL.** Fails with the CHECK constraint violation
  `chk_scope_drill_difficulty_consistency`. The importer-layer check catches
  this before the DB write in the YAML path, but the DB is the structural
  guarantee.

---

## 9. Dependencies & Assumptions

**Depends on:**

- The Prisma schema and the importer script from Stages 2–3 (exist).
- The taxonomy file `content/taxonomy/maths.yaml` for IDEA / SUBTOPIC lookups
  used by the auto-classifier (exists; the `rounds` section at line 400 is
  also the reference for FR-B's matrix).
- The `IntrinsicDifficulty` Prisma enum (`T1`–`T5`) — `drill_difficulty` reuses
  this enum. No new tier values.
- **Coordination with PRD-01's `_SCHEMA.md` v1→v2 bump.** Both PRDs bump
  schema_version. The two changes must land in the same v2 schema doc so
  authors don't trip over a "v2 means PRD-01" vs "v2 means PRD-17" ambiguity.
  Resolution: whoever lands first writes v2 with their fields; whoever lands
  second appends to v2 without bumping further. The PRD that lands second
  must explicitly verify in its acceptance criteria that the v2 schema doc
  carries BOTH sets of fields.
- The Claude API (or whatever LLM the tagging-agent uses) for the
  auto-classifier in FR-C. If the API is unreachable, the importer falls back
  to "scope must be set explicitly in YAML" (US-2 E1).

**Assumes:**

- Authors will populate `question_scope` (explicitly or via the classifier)
  for every new problem from migration 0014 onwards. The backfill of the
  existing 200+ problems happens as a separate follow-up.
- The 3-value enum is sufficient for the round-assignment logic. A finer
  enum (single_subtopic vs single_idea vs single_sub_idea) is out of scope
  per §7.
- The round-assignment matrix (FR-B) is a strawman validated by the user's
  brief; the Spec Critic and the user may push back. The matrix is in scope
  for v1; refinement is open-question Q1 below.
- Tagging-agent auto-classifier has access to the YAML body at import time —
  which it does, via the existing import pipeline.

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
  agreement rate is measured. If steady-state agreement is < 85%, the cutoff
  should rise. Decision can be made after the first 30 problems (NOT a
  blocker for Stage 3).
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

*End of PRD-17 v1 draft.*
