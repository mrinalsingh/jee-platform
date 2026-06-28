# PRD-17 Spec-Critic Review v1 — `question_scope` + `drill_difficulty`

**Stage:** 1 (Spec Loop) | **Iteration:** v1 | **Reviewer:** Spec Critic (discriminator)
**Artifact reviewed:** `scorecards/17-question-scope-prd-draft-v1.md` (686 lines, dated v1 from PM)
**Cross-references consulted:** `01-prd-final.md`, `16-test-runtime-prd-final.md`, `backend/prisma/schema.prisma`,
`backend/prisma/migrations/README.md`, `content/maths/generated/_SCHEMA.md`, `content/taxonomy/maths.yaml` (rounds block).

---

## Score: 6 / 10

A solid first draft. The columns and CHECK constraint are well-defined, the round matrix is plausible, the
importer behaviour is mostly clear. But six issues prevent handing this to an Architect today: (1) an enum
name that does not exist in the live schema, (2) a coordination claim about migration 0014 that double-books
a slot already implicitly claimed by PRD-16, (3) two acceptance-criteria contradictions between FR-A and FR-C
that will cause an Engineer to silently pick one interpretation, (4) the auto-classifier human-review queue
is hand-waved into a `provisional` flag with no surface a reviewer can actually work, (5) silent-degradation
behaviour on a sparse-bank round-picker call is under-specified, and (6) the v1→v2 YAML coordination handshake
with PRD-01 is a textual instruction, not a structurally-enforced rule. None are conceptually fatal; all are
the kind of thing the Engineer would either ship wrong or escalate mid-build.

---

## Blocking Issues (must fix before advancing to Stage 2)

### 1. [SEVERITY: CRITICAL] FR-E line 484 references `TRating` enum — this enum does NOT exist in the schema.
- **Where:** PRD §6 FR-E line 484 ("New column `problems.drill_difficulty TRating NULL` (reuses the existing
  `IntrinsicDifficulty` / `TRating` enum — same T1–T5 values).") and §6 FR-F line 519 ("Add
  `drill_difficulty TRating NULL` column to `problem_reviews`.")
- **Why it matters:** The PRD reads as if `TRating` is an alternate spelling for `IntrinsicDifficulty`. It is
  not. `backend/prisma/schema.prisma` line 79 defines exactly one such enum: `IntrinsicDifficulty { T1 T2 T3
  T4 T5 }`. There is no Postgres type called `TRating` and no Prisma `enum TRating`. If the Architect literally
  follows the PRD text, migration 0014 will fail with `type "TRating" does not exist`. If the Engineer "fixes"
  it silently by aliasing in Prisma, we'll get drift (one column uses `IntrinsicDifficulty`, the alias only
  exists in the Prisma layer, raw SQL queries explode).
- **Suggested fix:** Replace every occurrence of `TRating` in the PRD with `IntrinsicDifficulty`. Drop the
  "TRating" parenthetical entirely — it is a confusing legacy name imported from `ProblemReview.t_rating` (a
  *column* name) and conflated with the *type* name. State precisely: "the column type is the existing
  `IntrinsicDifficulty` Postgres enum." Three sites need the edit: line 484, line 519, line 626 in §9
  Dependencies.

### 2. [SEVERITY: HIGH] Migration-slot collision risk with PRD-16 hint-authoring follow-up.
- **Where:** PRD §6 FR-E line 478 ("Migration 0014 — `0014_question_scope_drill_difficulty/`") and §6 line 504
  ("this slot is `0014_…` per the README's `0NNN_…` rule").
- **Why it matters:** The latest migration in `backend/prisma/migrations/` is `0013_calibration_mismatch_columns`,
  so `0014` IS the next available slot. But PRD-16 §0 mentions a "separate `hints-authoring` Spec Loop" (test
  runtime PRD-16 final, line 455). If hints-authoring also targets 0014 (which is the natural next-slot for
  *any* upcoming migration), one of these PRDs gets reslotted late, which silently fails replay-order tests
  on a Neon redeploy. PRD-16 was finalised before PRD-17, so PRD-17 should explicitly defer to whatever PRD-16
  spawns. The PRD claims the slot without a defensive clause.
- **Suggested fix:** §6 FR-E should add a sentence: "Migration slot number is asserted as `0014` at draft time
  but ANY higher unallocated `0NNN_…` slot is acceptable. The actual slot is finalised when the migration is
  written; the only structural requirement is that it sorts AFTER `0013_calibration_mismatch_columns` and
  before any migration that adds a foreign-key reference to `problems.question_scope`." Also add an acceptance
  criterion: "the migration directory name conforms to `0NNN_question_scope_drill_difficulty` and does NOT
  collide with any pre-existing or in-flight migration slot."

### 3. [SEVERITY: HIGH] §4 US-2 AC bullet 1 contradicts FR-C confidence-threshold logic for explicit YAML.
- **Where:** §4 US-2 lines 146–149 ("Given a v2 YAML file imports with `question_scope` AND ... explicitly set
  by the author ... the importer ... writes the file's values verbatim ... it does NOT overwrite explicit author
  choices") vs. §6 FR-C lines 442–451 (sanity-check rules that emit warnings) and US-2 AC bullets 6–7
  (`SCOPE_SANITY_WARNING` for the case where the author tagged `SINGLE_TOPIC` but solution touches two
  SUBTOPICs).
- **Why it matters:** The PRD says "author intent wins" but then defines four conditions that *do* something
  on disagreement. The "something" is currently "emit a warning" — which is fine, but US-2 AC bullet 6 calls it
  a warning while §6 FR-C lines 442–451 lists three sanity-check rules with no explicit statement of what they
  produce (warning? rejection? just a log line?). And the §6 FR-C line 451 rule — "SINGLE_TOPIC AND
  drill_difficulty=T5 AND authored_difficulty=T1" — sounds like it might be a hard reject, but the line says
  "warnings". An Engineer needs a single rule of what each contradiction produces: hard reject, soft warning
  in importer summary, or silent log line. Worse, US-2 AC bullet 4 says scope=MULTI_TOPIC with non-null
  drill_difficulty is a HARD REJECT (`INVALID_SCOPE_DRILL_COMBINATION`) — meaning author intent does NOT win
  when it violates the CHECK constraint. The "author intent wins" rule is not absolute; the PRD presents it as
  if it were.
- **Suggested fix:** Add a §6 FR-C subsection "Disposition table — what each contradiction produces":

  | Condition | Disposition | Error/warning code |
  |---|---|---|
  | Author `MULTI_TOPIC` + non-null `drill_difficulty` | HARD REJECT (DB CHECK violation) | `INVALID_SCOPE_DRILL_COMBINATION` |
  | Author `SINGLE_TOPIC` or `PAIRED_TOPICS` + null `drill_difficulty` | HARD REJECT | `MISSING_FIELD: drill_difficulty` |
  | Author `SINGLE_TOPIC` + solution touches ≥ 2 SUBTOPICs | WARN, accept | `SCOPE_SANITY_WARNING_SUBTOPIC` |
  | Author `PAIRED_TOPICS` + solution touches ≥ 3 IDEAs | WARN, accept | `SCOPE_SANITY_WARNING_TRIPLE_IDEA` |
  | Author `MULTI_TOPIC` + solution touches 1 IDEA | WARN, accept | `SCOPE_SANITY_WARNING_SINGLE_IDEA_MULTI_TAG` |
  | Author `SINGLE_TOPIC` + `drill_difficulty=T5` + `authored_difficulty=T1` | WARN, accept | `SCOPE_SANITY_WARNING_INVERTED_DRILL` |

  And restate the principle as: "Author intent wins on *interpretation* disputes (scope tag, drill_difficulty
  value); the DB CHECK constraint always wins on *structural* combinations. Warnings live in the importer
  summary stdout PLUS as a `provenance.scope_sanity_warnings: [<code>, ...]` array on the `problems` row, so
  they remain visible to a reviewer after import."

### 4. [SEVERITY: HIGH] §6 FR-C low-confidence handling has no human-review queue (Q3 from the prompt).
- **Where:** §4 US-2 lines 152–155 ("if `confidence_pct < 70`, the importer rejects with
  `LOW_CONFIDENCE_CLASSIFICATION`") and §6 FR-C lines 452–458.
- **Why it matters:** The PRD reaches a dead end: confidence < 70 → importer REJECTS → "author must set
  scope explicitly and re-import." That means a YAML written by a Claude-generated batch (e.g., the 200+
  backfill or a fresh 30-question batch from the `jee-mcq` skill) gets a hard reject if the classifier is
  uncertain, and there is no in-app queue where a reviewer can see the uncertain ones, decide, and re-import.
  The reviewer would have to: (a) read importer stderr, (b) find the YAML, (c) hand-edit it, (d) re-run.
  There's no `low_confidence_classifications` table, no admin view, no "queue this for manual review" path —
  just an error message. For a backfill of 200+ problems, this is a footgun: the reviewer will get N reject
  messages with no centralised place to triage. For a fresh batch from `jee-mcq`, the same problem at smaller
  scale.
- **Suggested fix:** Either (a) reframe low-confidence as `provisional` + `scope_classifier_confidence < 70`
  → write the row with the classifier's best guess, mark `status='provisional'` + a new column
  `scope_needs_review BOOL DEFAULT FALSE` flipped TRUE, and require a reviewer to confirm before `calibrated`
  flip; or (b) explicitly add a `low_confidence_imports` queue table to FR-E with columns
  `(question_code, attempted_at, classifier_output_jsonb, status ENUM(open, resolved, dismissed))` that the
  importer writes to instead of rejecting. The PRD picks neither; the Engineer will guess. Pick one and the
  AC follows.

### 5. [SEVERITY: HIGH] §6 FR-B relaxation ladder under-specifies "what if every step exhausts and N is not met."
- **Where:** §6 FR-B lines 381–392 (relaxation ladder) and §4 US-3 line 223 ("until either ≥ N problems are
  returned or all ladder steps are exhausted").
- **Why it matters:** Step 5 of the ladder is "drop `question_scope` filter entirely (last-resort: any
  problem)." Fine. But if even step 5 cannot deliver N problems (e.g., the bank has only 4 maths problems on
  `idea_code=EXMUL` and the round picker wants N=10), the PRD does not say what the response looks like. Does
  the engine return the 4 with `relaxation_steps_applied=[step1,step2,step3,step4,step5]` and a partial-N
  warning? Does it return `[]` with `BANK_UNDERPOPULATED`? Does it pad with problems from a sibling
  `subtopic`? This matters because in early days, the bank IS sparse (159 maths problems per PRD-16 line 54,
  spread thinly across the 7-axis fingerprint). The round picker WILL hit this path; the PRD doesn't say what
  happens.
- **Suggested fix:** Add a §6 FR-B AC: "Given the relaxation ladder is exhausted and < N problems were
  found, the engine returns whatever problems it did find AND a `relaxation_steps_applied` array AND a
  `bank_underpopulated: true` boolean AND `requested_n: N, returned_n: M`. The caller is responsible for
  deciding whether `M < N` is shippable for the use case (drill recommendation may accept N=3 instead of
  N=10; a paper-builder UI may refuse and surface to the teacher)." Also: the relaxation ladder should
  explicitly state that the `idea_code` / topic filter from the original request is NEVER relaxed — only
  scope and difficulty are. Otherwise the "give me 10 EXMUL problems" call could silently return 10 random
  problems, which is worse than returning 4 EXMUL problems with a flag.

### 6. [SEVERITY: HIGH] PRD-16 hint-endpoint × scope=MULTI_TOPIC interaction unaddressed.
- **Where:** §1–§10 (scope's relationship to hints is not mentioned at all). Cross-ref: PRD-16 line 459
  (`hint_count > 0` shows `Show hint` link).
- **Why it matters:** PRD-16's hint ladder is per-problem (`problems.hint_count`). A `MULTI_TOPIC` mock-test
  problem at R4 typically should NOT have hints (it's an exam-simulation, hints defeat the purpose). A
  `SINGLE_TOPIC` R1 drill problem typically SHOULD have hints. The PRD-17 schema change creates the natural
  point where this rule could be expressed (e.g., "MULTI_TOPIC problems may have `hint_count > 0` but the
  test-runtime UI suppresses the Show hint link when the test is round=R4"). PRD-17 says nothing about this.
  The Engineer will not surface a question; they'll just leave hints visible on all rounds. That's not
  catastrophic but it is a missed product opportunity and a likely "duh, of course we should suppress hints
  on R4 mocks" follow-up from the user.
- **Suggested fix:** Add a §8 Edge Cases bullet: "Interaction with PRD-16 hints. The `question_scope` and
  `drill_difficulty` columns do NOT change `problems.hint_count` semantics — hints remain a per-problem
  authored property. However, the test-runtime UI rule for hint visibility is OUT OF SCOPE for this PRD; it
  belongs to a separate hints-authoring or test-runtime-extension PRD. PRD-17 only commits to: the columns
  exist, they CAN be read by a future test-runtime filter, and they do NOT affect the existing hint endpoint
  contract." This explicitly punts but leaves no ambiguity.

---

## Non-Blocking Issues (should fix, won't block Stage 2)

### 7. [SEVERITY: MEDIUM] §3 north-star target "≥ 90% RFR" has no baseline measurement plan.
- **Where:** §3 lines 56–62.
- **Why it matters:** "Baseline today: not measurable (the columns don't exist)" — true. But the target
  "≥ 90%" needs a measurement protocol: at what cadence is RFR computed, by whom, against what cohort? An
  RFR of 90% on a test built by ONE teacher in week 1 means nothing; an RFR of 90% on 500 cohort assignments
  in month 3 is the real signal. No protocol = the metric is decorative.
- **Suggested fix:** Add to §3 north-star: "RFR is computed nightly by a batch job over all `tests` rows
  assigned and started in the trailing 14 days. The metric is reported by `(teacher_role, round, subject)`
  to spot per-round regressions. Initial measurement: 30 days after migration 0014 lands and the
  tagging-agent backfill (out-of-scope §7) has classified ≥ 80% of the bank."

### 8. [SEVERITY: MEDIUM] §6 FR-C confidence threshold of 70% is asserted with no calibration data.
- **Where:** §6 FR-C line 454.
- **Why it matters:** The Open Question Q2 explicitly says the 70% threshold is unvalidated, but the PRD
  still ships with it as a binding gate at importer-layer. If the classifier's actual confidence calibration
  is poorly tuned (e.g., it returns 80% for every problem regardless of true uncertainty), the threshold is
  either always-pass (no reviewer triage) or always-fail (every import rejects). The PRD should at least
  require the importer to LOG the confidence distribution for the first 30 imports so Q2 can be answered
  with data, not vibes.
- **Suggested fix:** Add to §6 FR-C: "The importer's summary output logs the classifier's
  `confidence_pct` for every classified problem to `import_classification_log.jsonl` (rotated weekly). After
  the first 30 imports a one-off review answers Q2 by reading the distribution." Lightweight and unblocking.

### 9. [SEVERITY: MEDIUM] §6 FR-A enum names — risk of confusion with PRD-01's existing semantics.
- **Where:** §6 FR-A lines 330–339.
- **Why it matters:** The PRD-01 axes use `_TAGS` suffixed columns (e.g., `err_reading_tags`). The PRD-17
  enum value `MULTI_TOPIC` could be misread as "multi-axis tagged" given the diagnostic-axis vocabulary
  already in flight. Not catastrophic but a careful reader will ask "is `MULTI_TOPIC` related to the 5
  err_*_tags arrays?" It is not. A one-line note: "Note: `question_scope` is orthogonal to PRD-01's
  per-`wrong_paths` diagnostic axes. A `SINGLE_TOPIC` problem may still have multiple distinct `err_*_tags`
  in its summary arrays — those describe HOW students fail it, not how many topics it touches."
- **Suggested fix:** Add the one-line clarification to §6 FR-A.

### 10. [SEVERITY: MEDIUM] §6 FR-E line 499–501 — review-row CHECK delegated to Architect without specifying
the invariant clearly.
- **Where:** §6 FR-E lines 499–501 ("Same migration also adds `drill_difficulty` to `problem_reviews`,
  with the same nullability rule joined to the parent `problem.question_scope` via a CHECK or trigger (per
  Stage-2 Architect's choice — the requirement is enforcement, the mechanism is delegated).")
- **Why it matters:** The cross-table constraint here is non-trivial — Postgres CHECK constraints cannot
  reference other tables, so the Architect is being asked to pick "CHECK or trigger" where "CHECK" isn't
  actually available. This is a category error in the PRD. Either say "a trigger or row-level invariant
  enforced by application code at write time, per Architect's choice" or just say "trigger". As written,
  the Architect will spot the contradiction and either escalate or silently rewrite the requirement.
- **Suggested fix:** Replace "via a CHECK or trigger" with "via a Postgres trigger or an
  application-layer invariant enforced by the importer + review UI write path."

### 11. [SEVERITY: MEDIUM] §6 FR-D YAML v2 coordination with PRD-01 is by instruction, not by structure.
- **Where:** §6 FR-D lines 468–472 ("Coordination note: if PRD-01's `diagnostic_tags` schema bump is also
  being applied in the same release cycle, the two bumps land in the same `_SCHEMA.md` v2... whoever lands
  first writes v2 with their fields; whoever lands second appends to v2 without bumping further.")
- **Why it matters:** This is fine as a coordination note, but the importer-layer test that asserts "this
  YAML is v2 and validates" has no structural way to know which fields v2 requires unless the schema
  definition itself is checked in. Today the schema is a markdown table in `_SCHEMA.md`, NOT a machine-
  readable JSON Schema / YAML Schema. The PRD does not require it to become machine-readable; the importer
  validates by hand-written code. So if PRD-01 and PRD-17 both bump schema_version=2 but only one of them
  actually updates the importer, a v2-tagged YAML can have either set of fields and the importer accepts
  whichever the most-recent commit happened to add. Result: silent partial-acceptance.
- **Suggested fix:** Add an acceptance criterion to §6 FR-D: "The importer's validation function defines
  a single list of v2-required fields. When PRD-17 lands, this list MUST be extended with
  `question_scope` (and conditionally `drill_difficulty`). When PRD-01 lands or has already landed, the
  list MUST also include `wrong_paths[i].diagnostic_tags`. CI asserts this invariant by running both
  PRDs' AC fixtures against the same importer build." This makes the coordination structural, not
  textual.

### 12. [SEVERITY: MEDIUM] §3 leading indicator 3 — "≥ 85% exact-match" — doesn't define ground truth.
- **Where:** §3 lines 73–76.
- **Why it matters:** Reviewer-confirmed = ground truth, sure. But on a 30-problem calibration set, which
  30 problems? Picked how? If the 30 are all `SURF-PLAIN, TRAP-NONE` problems (the easy classification
  end of the distribution), the 85% target is trivial; if they're `PARAM` surface with `EIGEN` traps, 85%
  is heroic. The PRD doesn't say.
- **Suggested fix:** "The 30-problem calibration set is sampled stratified across (`surface`, `trap`)
  combinations actually present in the bank, with ≥ 3 problems from each combination that has ≥ 3
  problems available. The sample is generated by a one-off script and frozen as a CSV fixture; the
  ≥ 85% target is measured against this exact fixture."

---

## What's Good (positive reinforcement)

### 1. The author-intent-wins rule is the right call, and the sanity-warning carve-out is sensible.
- **Where:** §6 FR-A lines 341–344 ("Author intent matters. Taxonomy structure is a sanity check, not the
  rule."), §6 FR-C lines 441–451.
- **Why it works:** The alternative — auto-classify and overwrite the author — would create a permanent
  trust problem with the human reviewers, who have the strongest intuition about the IDEA structure of a
  problem they wrote. Warning + accept is the right discriminator, AND the PRD correctly identifies the
  three cases where a warning is worth emitting (subtopic span, IDEA count, drill-vs-authored inversion).
  Even though issue 3 above asks for the warning/reject disposition to be tabulated, the underlying
  principle is correct.

### 2. The relaxation ladder concept is genuinely good product thinking.
- **Where:** §6 FR-B lines 381–392.
- **Why it works:** Rather than silently widening filters (which would surprise the teacher), the engine
  records each relaxation step in `relaxation_steps_applied` so the UI / caller can show "we couldn't fill
  this with strict R1 problems; we widened to PAIRED_TOPICS at T1–T4." This is the kind of legible
  degradation that turns "the bank felt empty" complaints into actionable feedback (more T2-T3 SINGLE
  EXMUL problems wanted). Even with the under-specification in issue 5 above, the ladder + observability
  combo is the right shape.

### 3. Backward-compatibility commitment + the DB-level CHECK constraint together.
- **Where:** §5 NFR lines 300–306 + §6 FR-E lines 486–493.
- **Why it works:** The PRD takes the rare-but-correct approach of (a) defaulting all 200+ existing rows
  to `MULTI_TOPIC` / NULL (so they trivially satisfy the constraint), AND (b) enforcing the constraint
  structurally at the DB layer, not at the application layer. This is exactly the "structural-impossible
  vs. policy-impossible" discipline that PRD-01 §6 A.3 also enforces for diagnostic summary columns —
  the consistency between the two PRDs on this point is genuinely reassuring.

---

## Verdict

**Score 6/10 — loop back to PM for v2.**

Six blocking issues, five non-blocking. None require a redesign; all are clarifications or specifications
the PM can add inside the existing structure. Specifically the PM MUST FIX before v2 advances:

1. **TRating → IntrinsicDifficulty.** Global find/replace + drop the parenthetical (3 sites).
2. **Migration slot defensive clause.** §6 FR-E acceptance criterion that the slot is finalised at
   write-time and must not collide with any in-flight migration.
3. **Disposition table for FR-C contradictions.** Replace "author intent wins" + scattered warnings with
   the explicit warning-vs-reject table; persist warnings to a `provenance.scope_sanity_warnings[]`
   array so they survive past the importer's stdout.
4. **Low-confidence handling.** Either flip from "REJECT" to "provisional + needs_review" OR add the
   `low_confidence_imports` queue table. Pick one; the AC follows.
5. **Ladder-exhausted behaviour.** Spell out the response shape when the relaxation ladder runs out of
   steps before N is met; assert that `idea_code` / topic filters are NEVER relaxed.
6. **PRD-16 hint interaction.** Either commit to "no change to hint endpoint" or explicitly defer.

SHOULD FIX in v2 (not blocking but cheap):
- RFR measurement cadence; confidence-distribution logging; PRD-01 axis-vocabulary clarification; cross-
  table review constraint mechanism wording; v2-YAML coordination as a CI test; calibration-set
  stratification.

When v2 lands with these addressed, expected score is **8/10** — confident-advance to Stage 2 Architect.

---

## Notes for the orchestrator on Open Questions §10

- **Q1 (round matrix).** Not blocking. The matrix is a strawman; Q1 explicitly defers refinement to
  Stage 3 implementation. ACCEPTABLE.
- **Q2 (70% threshold).** Reframed into NON-BLOCKING issue 8 above — log the distribution, decide after
  30 imports.
- **Q3 (`assign_round` shape: `Round[]` vs. single).** ACCEPTABLE as `Round[]` per the PRD's strawman.
  Shipping the wider shape is cheaper to narrow later than the reverse.
- **Q4 (non-`JEE_ADVANCED` `drill_difficulty` semantics).** ACCEPTABLE per §8 carve-out (skip
  cross-walk validation for non-Adv targets). User-visible nuance is small.

These are the four parked questions; only Q2 needs a v2 PRD edit. The other three can advance as-is.

---

*End of PRD-17 v1 spec-critic review.*
