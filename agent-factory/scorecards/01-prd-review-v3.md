# Spec Critic Review — PRD v3 (Diagnostic Failure-Mode Axes)

**Stage:** 1 (Spec Loop) | **Iteration:** v3 (final) | **Reviewer:** Spec Critic (discriminator)
**Artifact reviewed:** `/Users/ms/Documents/jee_platform/agent-factory/scorecards/01-prd-draft-v3.md`
**Prior reviews:** v1 7/10 (6 blockers); v2 7/10 (4 fixed, 2 partial, 1 NEW CRITICAL)
**Binding spec:** `/Users/ms/Documents/jee_platform/docs/PROJECT CONTEXT.md`
**Date:** 2026-06-05

---

## Score: 8/10

v3 is the right document. The meta-fix — converting §6 A.3 from a non-compiling SQL block into a contract with 5 acceptance criteria and explicit Architect delegation — is structurally sound, not relabeled. The same delegation pattern is correctly extended to two other implementation-leaning details (SPMR query mechanism, summary-column index type), which is exactly the right reading of the agent-factory layering rule. The single-counting-convention fix (matrix counts 7/12/14/7/7 everywhere) is clean and I verified the matrix totals programmatically. The shared-normaliser contract for SPMR ↔ US-1 is real and is enforced by a CI test that's been written into US-4 AC. The single-reviewer fallback is honestly dropped and the gating decision surfaced to the user as a feature flag.

What holds it at 8 rather than 9 is one genuine remaining gap that the PM did not see (the equality contract names a YAML field — `answer.precision` — that does not yet exist in `_SCHEMA.md` or in either of the two existing YAML files; this contract is undefined for current and future bank entries until the schema is amended), and two smaller internal-inconsistency issues in the contract prose itself (the delegation menu in A.3 lists a mechanism that AC #1's same-transaction requirement actually forbids; one stray "appropriate" weasel word survives in the delegation paragraph at line 443). None of these are blockers that prevent the Stage-2 Architect from starting; all are flagged for the Architect to inherit and resolve.

This is an honest advance, not a charitable advance. Per the constitution, "score 7-8 with non-blocking issues = advance to Stage 2 with the issues inherited by the Architect" is the explicitly allowed verdict and is what v3 has earned.

---

## Iteration Delta — Full

### v1 blocker status (final)

| # | v1 Blocker | v2 Status | **v3 FINAL** | Evidence |
|---|---|---|---|---|
| 1 | §5.1 "16 questions" vs 18-row table | FIXED | **FIXED** | §5.1 heading: "18 questions". Every derived count uses 18. No stray "of 16" anywhere in v3 (`grep` confirmed; the only `16`s are row indices). |
| 2 | §5.3 axis math inconsistent with Appendix A | PARTIAL (3rd convention added) | **FIXED** | §5.3 table now states 7/12/14/7/7 with 39%/67%/78%/39%/39% — sourced from the Appendix B matrix. I re-summed all 18 rows × 5 columns programmatically and got exactly the matrix totals. Conservative count appears only as a historical note in the change-log; no third convention exists in v3. |
| 3 | "Confidence ≥ 70%" mechanism unimplementable | FIXED | **FIXED** (retained) | Deterministic 1/≥2/0 matching is intact; v2 fix preserved. |
| 4 | North Star unmeasurable until Stage-10 pilot | FIXED | **FIXED** (retained, and strengthened) | Phase A/Phase B split intact; SPMR justification refined to acknowledge the E2 ceiling (`SPMR × (1 − E2_rate)`) per v2 Non-Blocking #5. |
| 5 | `errReadingTags` mirror columns can desync from JSON | PARTIAL (with new CRITICAL — non-compiling SQL) | **FIXED via delegation** | v3 §6 A.3 specifies the *invariant* + 5 acceptance criteria + delegates the *mechanism* to the Stage-2 Architect. The CRITICAL non-compiling SQL block is gone. This is the correct layering. (One small wrinkle — see new issue NB-1.) |
| 6 | 12-min tagging estimate ignores warm-up | FIXED | **FIXED** (retained, and strengthened) | §7.1 calibration/inter-rater/steady-state table preserved; v3 adds explicit "up to 15 reviewer-hours total" budget line. |

**Summary: all 6 v1 blockers FINAL FIXED.**

### v2 blocker / new-issue status (final)

| # | v2 Issue | **v3 FINAL** | Evidence |
|---|---|---|---|
| v2-B1 | §5.3 third "conservative" counting convention undocumented | **FIXED** | Conservative framing removed; matrix counts only. Appendix B is now a pure matrix appendix. |
| v2-B2 | `GENERATED ALWAYS AS … STORED` SQL block won't compile | **FIXED (META-FIX)** | The non-compiling SQL is gone. §6 A.3 specifies contract + acceptance criteria; mechanism delegated. §7 NFR ("Data integrity") and §9 Dependencies are both updated to match. Prisma schema sketch is explicitly marked "informative, NOT prescriptive." This is exactly the right layering. |
| v2-B3 | SPMR's NUM-DEC normalisation undefined | **PARTIALLY FIXED** | The contract is written: SPMR and US-1 share one normaliser, with a CI test (US-4 AC) asserting both call-sites import from the same module. BUT — the contract leans on `problems.answer.precision`, which does NOT exist in `_SCHEMA.md` or either existing YAML file (`MAT.SPL.ORBSUM.CNJSP.001.yaml`, `PNC.DGT.EXMUL.LZINC.001.yaml`). The contract is undefined for any NUM-DEC problem written under the current schema. See Blocking Issue #1 below — flagged HIGH but conditionally non-blocking because it surfaces a real PRD-vs-schema mismatch the Architect needs to resolve in week 1 of Stage 2 anyway. |
| v2-B4 | "Single-reviewer fallback" is a paper-over | **FIXED** | §9 + §10 Q4 explicitly drop the self-review check and gate US-1/US-2/US-3 behind a feature flag until 2 reviewers are present. The honest answer. |
| v2-NB5 | "SPMR is the upper bound on US-1 success rate" overstates SPMR | **FIXED** | §3 now writes "SPMR is the *bank-side* upper bound … the *student-side* ceiling additionally requires E2 to stay low (`SPMR × (1 − E2_rate)`)". One-sentence calibration is in. |
| v2-NB6 | 15-hour total reviewer budget not surfaced | **FIXED** | §7.1 explicit total line: "up to 15 reviewer-hours (5 calibration + 10 inter-rater)". Now visible to the user when answering §10 Q4 + Q7. |
| v2-NB7 | Ambiguous-match UX not stress-tested for the student | **FIXED (as Stage-4 dependency)** | US-1 names Stage-4 UX Audit explicitly; lists the 3 things the UX Auditor must test; pre-commits the fallback rendering ("most-common + subtler 'could also be …'"); added to §8 Out of Scope as a Stage-4 ticket. |
| v2-NB8 | §10 Q2 (missing axis values) has no deadline | **FIXED** | "Decision needed *before* the reviewer starts the calibration phase. If new axis values are added after the calibration set begins, the calibration must restart from problem 1." Concrete. |
| v2-NB9 | Appendix B "dual reporting" defense | **FIXED** | Resolved as part of v2-B1 fix. |
| v2-NB10 | Cross-reference between §9 and §10 Q4 | **FIXED** | Both now cite each other explicitly. |

**Summary: 9 of 10 v2 issues FIXED; 1 (v2-B3) PARTIALLY FIXED — contract is correct but rests on a YAML field that doesn't exist in the current schema.**

### NEW issues introduced in v3

1. **The equality contract refers to `problems.answer.precision`, which is not in `_SCHEMA.md` and is absent from both existing YAML files.** I checked: the schema's `answer` field is documented as `{type, value: <number>}` only. Neither YAML file carries a `precision` value. This is not an architecture issue — it is a PRD-level under-specification of where the precision field lives. Flagged as HIGH-but-non-blocking; the Architect can fix it in Stage 2 by extending `_SCHEMA.md`. See Non-Blocking #1.
2. **§6 A.3 prose lists a delegation menu that contradicts AC #1.** The menu names "scheduled rebuild + read-side derivation" as an allowed mechanism, but AC #1 requires write-through consistency *within the same transaction as the `wrong_paths` UPDATE*. A scheduled rebuild is by definition asynchronous and cannot satisfy AC #1. The Architect should not be told both that it's allowed AND that it isn't. See Non-Blocking #2.
3. **One stray "appropriate" weasel word in the delegation prose.** Line 443: *"The architect adds the indices appropriate to the chosen storage mechanism."* — the rest of the contract is precise (≤ 800 ms p95 at 10⁴ problems); this clause should mirror that precision. See Non-Blocking #3.

### Score trajectory: v1 7 → v2 7 → v3 **8/10**

Healthy convergence. The v1 → v2 step was structural-fix-with-a-new-critical (net flat); the v2 → v3 step is the meta-fix-plus-cleanup that resolves both the v1 blocker #5 cleanly and the v2 critical introduced by the over-eager SQL. 4 of 6 v1 blockers were FIXED in v2 and stay FIXED in v3; the remaining 2 (counting convention, source-of-truth mechanism) are now FIXED in v3; 9 of 10 v2 issues are FIXED. One partial (v2-B3) is honest under-specification of a downstream schema field, not a defect in v3's reasoning.

---

## Blocking Issues (still open in v3)

**None.**

The 8 score reflects two genuine non-blocking gaps the Architect inherits, not any unresolved blocker.

---

## Non-Blocking Issues (inherited by the Stage-2 Architect)

### NB-1. [HIGH] The equality contract refers to a YAML field (`problems.answer.precision`) that is not in `_SCHEMA.md` or any existing YAML.

- **Where:** §3 Phase-A SPMR definition (NUM-DEC bullet); §7 NFR "Equality / normalisation contract"; US-1 matching mechanism; US-4 AC `INVALID_LANDED_OPTION_PRECISION` rejection.
- **Why it matters:** Every NUM-DEC clause in the equality contract is keyed off `answer.precision`. The current schema (`/Users/ms/Documents/jee_platform/content/maths/generated/_SCHEMA.md` line 27) defines `answer` as `{type, value: <number>}` for NUM types — no precision sub-field. Neither of the two existing YAML files (`MAT.SPL.ORBSUM.CNJSP.001.yaml`, `PNC.DGT.EXMUL.LZINC.001.yaml`, both verified via grep) carries a `precision` value (one is MCQ-MC, the other is NUM-INT so does not yet hit the gap — but every future NUM-DEC problem would). Also: the contract is silent on edge cases — what if precision is missing (current default behaviour is undefined)? What if precision = 0 (does `toFixed(0)` round `3.5` to `"4"` or `"3"`? — banker's rounding is platform-dependent; JS `Number.toFixed` is NOT banker's rounding, it's deterministic round-half-to-even-ish but historically buggy)? What if the student types `3.5` and canonical is `3.50`? The contract should also state what `toFixed` implementation it expects.
- **Why this is not blocking:** The Architect must extend `_SCHEMA.md` anyway in Stage 2 to add the `diagnostics` block. Adding `answer.precision` as a required sub-field on NUM-DEC at the same time is a one-line schema bump. The PRD has flagged the contract; the field's home in the schema is a Stage-2 implementation detail.
- **Suggested fix for the Architect to inherit:** In Stage 2 §_SCHEMA.md update, mark `answer.precision` as required for `NUM-DEC` answer types (integer ≥ 0, default unspecified — file is rejected with `MISSING_FIELD: answer.precision`); also specify the `toFixed` implementation contract explicitly (Node `Number.prototype.toFixed` is acceptable but document the "3.5 → '3.5' but 2.5 → '2.5'" footgun, or pick a different rounding spec and write a tiny implementation).

### NB-2. [MEDIUM] §6 A.3 menu of allowed mechanisms includes one that contradicts AC #1.

- **Where:** §6 A.3 ("Per-problem summary axes — requirement and acceptance criteria") and §7 NFR "Data integrity (contract-only)". Both list "scheduled rebuild + read-side derivation" as an allowed mechanism.
- **Why it matters:** A scheduled rebuild is asynchronous by construction — there is a window between a `wrong_paths` UPDATE and the next scheduled rebuild during which the summary is stale. AC #1 says: "Any UPDATE to `wrong_paths` is reflected in the summary columns within the same transaction (so a reader committing after the writer cannot observe stale summaries)." These two are inconsistent; an Architect reading A.3 prose might think "scheduled rebuild" is on the menu and only realise on re-reading the AC list that it isn't.
- **Suggested fix:** Tighten the A.3 prose. Allowed mechanisms are: (a) `GENERATED ALWAYS AS … STORED` (if the JSONB shape can be reshaped to make the expression immutable, e.g. by storing tag-set arrays at the row level and computing the multiset union via plain array ops), (b) a row-level BEFORE INSERT/UPDATE trigger calling an IMMUTABLE PL/pgSQL function, (c) a materialised view with synchronous refresh on the same transaction. Drop "scheduled rebuild + read-side derivation" — it cannot satisfy AC #1.

### NB-3. [LOW] One stray weasel-word in the delegation prose.

- **Where:** Line 443: *"The architect adds the indices appropriate to the chosen storage mechanism."*
- **Why it matters:** The PRD elsewhere is sharp ("≤ 800 ms p95 at ≤ 10⁴ problems"); this one clause is weasely. A pedantic engineer would ask "appropriate by what test?"
- **Suggested fix:** Replace with: *"The Architect picks an index type that satisfies the §7 NFR performance budget (≤ 800 ms p95 for US-2 set-construction queries at ≤ 10⁴ problems) on the chosen storage mechanism."* — already implicit, just make it explicit.

### NB-4. [LOW] "Banker's rounding" claim about `toFixed` may be inaccurate.

- **Where:** §3 SPMR NUM-DEC bullet, §7 NFR equality contract, US-1 matcher description — all say `toFixed(precision)` (banker's rounding).
- **Why it matters:** Standard JavaScript `Number.prototype.toFixed` is NOT banker's rounding (it's IEEE-754-driven and historically slightly inconsistent across engines for tie cases like `1.005`). Calling it "banker's rounding" in the spec creates an expectation the standard library does not deliver. Pairs with NB-1: when the schema adds `precision`, the spec should pick a precise rounding rule and the shared normaliser should implement it (or pin to a vetted decimal library).
- **Suggested fix:** Either drop the "banker's rounding" parenthetical and just say `toFixed(precision)` (lets `Number.prototype.toFixed` semantics stand), or pick a rule explicitly ("round-half-away-from-zero", "round-half-to-even") and have the Architect implement it. Defer to NB-1's schema decision.

### NB-5. [LOW] The Stage-4 UX Auditor fallback ("most common path with subtler indicator") is named but the disambiguation rule for "most common" is not defined.

- **Where:** US-1 "Fallback decision recorded for Stage 4": *"display the most common path with a subtler 'this could also be …' indicator."*
- **Why it matters:** "Most common" by what measure? Most common across the bank? Most common for this student? Most common at the question-level (which would require attempt history)? Per Spec Critic Lens 2 (Ambiguity), two engineers would build two different things.
- **Why non-blocking:** This is explicitly a Stage-4 deferred decision; the UX Auditor would surface the ambiguity before implementation.
- **Suggested fix:** Add a parenthetical to US-1: "(if Stage-4 selects this fallback, 'most common' is defined as the wrong-path with the highest count of student matches in the last 1,000 attempts on this question; for new problems with <30 attempts, the platform falls back to the side-by-side card)."

### NB-6. [LOW] §6 A.3 AC #4 equality predicate excludes `NONE` values for indexing — but the contract doesn't say what the runtime matcher does when all 5 axes on a matched path are `NONE`.

- **Where:** §6 A.3 AC #4 explicitly excludes `NONE` from the summary union (correct — would make every problem's summary contain `NONE`); §6 A.1 says the all-`NONE` pattern means "didn't see the IDEA".
- **Why it matters:** When US-1's matcher hits the all-`NONE` path, the diagnosis card should show "didn't see the IDEA: [idea_label]" (per A.1). But the spec doesn't make this explicit in US-1's "Matching mechanism" — a literal reading is "display that path's `diagnostic_tags`" which would be 5 NONE values. The student-facing label needs to be different.
- **Suggested fix:** In US-1 acceptance criterion 1, add: "If the matched path's `diagnostic_tags` are all-`NONE`, the displayed diagnosis is 'didn't see the IDEA: [idea_label]' (per §6 A.1's conceptual-failure convention), NOT a list of 5 NONE chips."

### NB-7. [LOW] Q4 + Q7 are still listed as separate open questions but the PRD acknowledges they are the same decision.

- **Where:** §10 Q4 ("inter-rater protocol — who are the 2 reviewers?") and §10 Q7 ("calibration phase reviewer — same question").
- **Why it matters:** §10 Q7 ends with "Q4 + Q7 are related — both are about who the reviewers are; the orchestrator may merge them when surfacing to the user." If they are the same question, they should be one question, not two with a footnote saying "merge when surfacing."
- **Suggested fix:** Merge Q4 and Q7 into one open question, "Q4-7 — Who are the 2 reviewers, and how is their time budgeted across the 5-hour warm-up + 10-hour inter-rater check?" Reduces ambiguity in the user-decision surfacing.

---

## What's Good (positive reinforcement — what v3 nailed)

1. **The §6 A.3 meta-fix is structurally sound.** Converting a non-compiling SQL block into "contract + 5 testable acceptance criteria + Architect-picks-mechanism" is the correct application of the agent-factory layering rule. The PM didn't just relabel — they wrote 5 enforceable invariants (write-through, no-app-write, integration test, equality predicate, query performance) that any reasonable Architect can verify their mechanism against. **This is the single most important fix in v3 and it landed cleanly.** Keep this discipline: Stage-1 fences requirements; Stage-2 picks mechanisms.

2. **The delegation pattern was generalised, not point-fixed.** The PM extended the same layering reasoning to two other implementation-leaning details (SPMR query technique, summary-column index type) — neither of which the v2 reviewer flagged but both of which deserved the same treatment. This is the kind of cross-cutting cleanup that distinguishes "fixing what was called out" from "understanding the principle." Per the agent-factory constitution: simplest correct mechanism is the Architect's call.

3. **Single counting convention everywhere.** Verified by re-summing the Appendix B matrix programmatically: rows × axes = 7/12/14/7/7 exactly, percentages 39%/67%/78%/39%/39% derived correctly. No stray "/16" anywhere in v3. The conservative count appears only as a historical note in the change-log — properly retired.

4. **The shared-normaliser CI test is a real enforcement, not a wish.** US-4 AC says "a CI test asserts both call-sites import from the same module; any future divergence breaks the build." This is implementable as described (a one-file lint rule or a unit test that does `expect(spmrMatcher.normaliser).toBe(us1Matcher.normaliser)`) and gives the equality contract structural force. The honest measurement principle (binding doc §2) demands this; v3 delivers.

5. **The single-reviewer fallback was honestly dropped, not papered over.** §9 now states plainly: "if only one reviewer is available, calibration cannot start, and the diagnosis card is gated behind a feature flag." This is the binding doc §9 ("honest human review is the quality gate — protect it") applied without flinching. The user gets a real decision in §10 Q4 instead of a soft fallback that would have silently degraded the κ gate. This earns positive reinforcement because the PM resisted the temptation to invent a soft answer.

6. **Phase A / Phase B North Star split refined with the E2-rate correction.** The v2 reviewer's Non-Blocking #5 (SPMR is the bank-side ceiling, not the full student-side ceiling) is now in §3 as a one-sentence calibration: `SPMR × (1 − E2_rate)`. Reader expectations are calibrated honestly. The PM could have ignored this since it was non-blocking; they didn't.

7. **PROJECT CONTEXT §12 non-negotiables remain respected and the 7-axis identity invariant is preserved.** The 5 new failure-mode axes attach per-`wrong_paths`-entry (not per problem) and live in their own columns; they are *added* to the 7-axis identity, not blended into it. Per binding doc §12 rule 2 ("the 7-axis identity and the difficulty rating travel WITH every question — from creation"): the new axes are orthogonal and additive. Calibration-phase tagging requires the reviewer to read every problem (binding doc §9: "honest human review is the quality gate"). Both invariants confirmed.

8. **The 15-reviewer-hour total budget line in §7.1 is the right level of honesty.** "5 calibration + 10 inter-rater = up to 15 reviewer-hours before US-1 ships" is the kind of cost-surfacing that protects the bottleneck (binding doc §9) and gives the user real input on §10 Q4 + Q7. v2 had the components; v3 has the sum.

9. **The change-log discipline is excellent and worth replicating.** Every v3 change is marked inline with `[UPDATED v3 — <issue>]` pointing back to the v1 or v2 issue it resolves. This is the second iteration in a row of crisp PRD hygiene and should be added to `templates/prd-template.md` as standard.

---

## Verdict

**advance to Stage 2.**

### Brief for Stage 2 Architect

You are inheriting a Stage-1 spec at 8/10 quality. The contract you MUST fulfil:

1. **Per-problem summary columns (§6 A.3) — pick a mechanism that satisfies all 5 acceptance criteria.**
   - Write-through consistency *within the same transaction* (rules out scheduled-rebuild; see NB-2).
   - No application-side write path.
   - Integration test asserts both invariants.
   - Equality predicate = multiset union of per-`wrong_paths.diagnostic_tags` values per axis, excluding `NONE`.
   - US-2 set-construction queries ≤ 800 ms p95 at ≤ 10⁴ problems.
   - Recommended mechanisms (in order of simplicity): (a) row-level BEFORE INSERT/UPDATE trigger calling an IMMUTABLE PL/pgSQL function; (b) materialised view with synchronous refresh in the same transaction; (c) reshape the JSONB so `GENERATED ALWAYS AS STORED` becomes feasible.
   - Add an integration test in the importer suite that proves both write-through and the no-app-write invariants. Both must fail loudly on attempted violation.

2. **Schema gap to close week 1 of Stage 2: add `answer.precision` to `_SCHEMA.md` for NUM-DEC problems.** The PRD's equality contract assumes this field exists; the schema does not yet require it. Bump `schema_version: 1 → 2` (you have to do this anyway for the `diagnostics` block). Also pick and document a concrete rounding rule (the PRD says "banker's rounding" but JS `Number.prototype.toFixed` is not banker's rounding; resolve the mismatch).

3. **Implement the shared normaliser as a single module.** One source file, importable by both the runtime US-1 matcher and the importer's SPMR computation. Add the CI test that asserts both consumers import from the same module (US-4 AC).

4. **The `idea_secondary` deferred-decision trigger is at 30% of authored problems flagged as 2-concept fusions.** Don't anticipate it in the schema.

5. **Constraints to be aware of:**
   - The 7-axis identity is non-negotiable (binding doc §4); the 5 diagnostic axes are *orthogonal* to it, not part of it.
   - Histograms over `attempts` are batch-job only (binding doc §12 rule 6); diagnostic queries against `attempts` must NOT compute aggregates live.
   - `attempts` is append-only; drill-result tracking goes through the standard capture layer (binding doc §12 rule 3).
   - No quick-fix back door for taxonomy: new values land via `taxonomy/maths.yaml` edits + PR, not via importer flags (binding doc §4: "no miscellaneous tags").
   - Design for 1 lakh students NOW: the 5 summary columns live on `problems` (bank-bounded to ~10⁴), not on `attempts` (~2 × 10⁷ rows at scale).

6. **You may pick the simpler of: feature-flag-gating US-1/US-2/US-3 behind the 2-reviewer κ gate, vs surface-as-Stage-2-decision.** The PRD §9 commits to the feature flag; you should implement it as a single config key the engineer can flip.

### Brief for user — what only you can decide

The PRD §10 lists 7 open questions; **the orchestrator must surface at minimum these three before the Architect can start Stage 2 cleanly:**

1. **Q4 + Q7 (merged): who are the 2 reviewers, and how is their time budgeted?**
   - Budget: up to 15 reviewer-hours total (5 hours of warm-up calibration per reviewer + 10 hours of inter-rater check). If you (the project owner) are one reviewer, that's ~15 hours of your time before US-1 ships in production.
   - If only one reviewer is available: US-1's diagnosis card (plus US-2 and US-3, which depend on it) is gated behind a feature flag until a second reviewer arrives and the κ ≥ 0.65 gate is met. There is no "single-reviewer fallback" in v3.
   - **Decision needed:** (a) you commit ~15 hours and recruit one external SME, (b) you commit ~5–10 hours (inter-rater only) and recruit an SME for the warm-up, or (c) accept the feature-flag gate and defer US-1 indefinitely.

2. **Q2: are any axis values missing for failure modes you've seen in tutoring practice that the 2022-paper analysis did not surface?**
   - Examples to consider: calculator/silly mistakes, formula-recall mistakes, sign errors specific to physics units, NCERT-edge facts in chemistry.
   - **Decision needed before the reviewer starts calibration.** If new values are added mid-calibration, the calibration must restart from problem 1 (re-tagging cost is real).

3. **Q5: do you want a free-text "evidence" note alongside each `diagnostic_tags` entry?**
   - Pro: makes future disagreements auditable (a reviewer can see *why* a prior tag was applied), supports the binding doc §2 measurement-honesty principle, helps train the next reviewer.
   - Con: adds ~30–60 seconds of reviewer time per `wrong_path` entry (~3 paths × 3 axes that fire = ~5 minutes/problem extra at steady state, which would push the §3 ≤ 4-min target out of reach).
   - **Decision needed:** include for v1, defer to v2, or never.

Q1 (Option A vs B) is implicit-yes given v3's recommendation, but worth a one-line user confirmation. Q3 is resolved. Q6 (CSV-export vs admin queue) is a soft commitment in §8 that's safe to defer. The other questions can be inherited by the Architect.

The PRD is ready. The user has a focused decision menu. Stage 2 has clear contracts. This is what convergence looks like.

---

*End of Spec Critic review v3.*
