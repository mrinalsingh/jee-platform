# Spec Critic Review — PRD v2 (Diagnostic Failure-Mode Axes)

**Stage:** 1 (Spec Loop) | **Iteration:** v2 | **Reviewer:** Spec Critic (discriminator)
**Artifact reviewed:** `scorecards/01-prd-draft-v2.md`
**Prior review:** `scorecards/01-prd-review-v1.md` (v1 score 7/10, 6 blockers)
**Date:** 2026-06-05

---

## Score: 7/10

v2 is a measurably better document than v1 in five out of six blocker areas, and the PM put real work into auditability (the new Appendix B, the explicit warm-up budget, the change-log discipline). The deterministic-matcher pivot is the right call and is now correctly threaded through US-1, §3, and §8. The Phase-A vs Phase-B success-metric split is genuinely useful. **However, two of the v2 structural changes have material problems that were not present in v1**, and one of them (the Postgres `GENERATED ALWAYS AS` SQL block in §6 A.3) **will not compile against Postgres** as written. That regression cancels out the gain on the other blockers, holding the overall score at 7/10 rather than the 8.5 we'd projected.

The pattern is *not* over-correction in the destructive sense — the v1 wins are intact. But v2 traded a known soft problem (importer-populated arrays) for a harder, more confidently-asserted *wrong* solution (a GENERATED expression that Postgres won't accept). And on §5.3 the PM introduced a third counting convention — "conservative dominant failure modes" — that is asserted but never shown, making the most-important table in the PRD less auditable than v1, not more.

This is a focused v3 — not a redesign. The PM needs to (a) switch the GENERATED columns to a TRIGGER + immutable function or to application-side derive-on-write with a CI invariant check, and (b) either show the conservative-count derivation explicitly OR switch §5.3 to use the matrix counts (7/12/14/7/7) directly and reframe the discriminating-power argument with them.

---

## Iteration Delta

### v1 blocking issues — status this round

| # | v1 Blocker | Status | Evidence |
|---|---|---|---|
| 1 | §5.1 "16 questions" vs 18-row table | **FIXED** | §5.1 heading now reads "18 questions"; all derived counts use denominator 18. Appendix A footer reconciled. Clean. |
| 2 | §5.3 axis math inconsistent with Appendix A | **PARTIALLY-FIXED** | Appendix B's matrix totals (7/12/14/7/7) are correct and auditable. BUT §5.3 narrative still uses 6/10/13/7/6 — labelled "conservative" — and the derivation of those conservative numbers is not shown anywhere. See Blocking Issue #1 below. |
| 3 | "Confidence ≥70%" mechanism unimplementable | **FIXED** | Confidence removed everywhere. US-1 matching mechanism is now a clean deterministic exact-match with explicit handling of 1/≥2/0 matches. §3, §8, §10 Q3 all updated. Excellent execution. |
| 4 | North Star unmeasurable until Stage-10 pilot | **FIXED** | Phase A / Phase B split is clean. SPMR is a real, computable Phase-A North Star with a one-line query. PM correctly added it to US-4 AC (importer reports SPMR per import). |
| 5 | `errReadingTags` mirror columns can desync from JSON | **PARTIALLY-FIXED (with new critical defect)** | The *intent* is correct — make the DB the source of truth. But the proposed `GENERATED ALWAYS AS` SQL in §6 A.3 uses a subquery + set-returning function, which Postgres does NOT allow in a generated column expression. See Blocking Issue #2. |
| 6 | 12-min tagging estimate ignores warm-up | **FIXED** | New §7.1 is excellent — quantifies calibration (8–12 min, problems 1–30, ~5 reviewer-hours), steady state (≤4 min, post-30), AND an escalation gate (median >6 min after Q30 → 3 user-options). This is one of the strongest sections in the PRD. |

**Summary: 4 cleanly fixed, 2 partial — and one of the partials introduced a new CRITICAL.**

### NEW issues introduced in v2

1. **The §6 A.3 SQL `GENERATED ALWAYS AS` expression will be rejected by Postgres at migration time.** Subqueries and set-returning functions (`jsonb_array_elements`) are not allowed in generated-column expressions; the expression must be IMMUTABLE in the strict Postgres sense. This is a Stage-2 architecture defect smuggled into a Stage-1 spec. (Blocking Issue #2.)
2. **§5.3 introduces a third counting convention ("conservative dominant failure modes") that is never shown.** v1 had two inconsistent numbers (§5.3 and Appendix A); v2 has three (§5.3 narrative, Appendix A footer 6/10/13/7/6, Appendix B matrix 7/12/14/7/7). The PM defends the conservative count by saying "if it discriminates at 6/18 it definitely discriminates at 7/18" — true, but the reader has no way to *verify* the 6/10/13/7/6 numbers because the conservative-count derivation is asserted, never computed. (Blocking Issue #1.)
3. **SPMR's behaviour under NUM-DEC precision normalisation is undefined.** §3 says SPMR is computed on `landed_on_option` equality but doesn't say whether NUM-DEC values are normalised to `answer.precision` FIRST. US-1's *student-side* match does normalise (per the v2 fix to non-blocker #9). The SPMR query in §3 ("`group by question_code, landed_on_option`") would not. Two paths with `landed_on_option = "3.14"` and `"3.140"` would be ranked unique by SPMR but would collide at student-match time. (Blocking Issue #3.)
4. **SPMR is asserted as "the upper bound on US-1's success rate," but it isn't.** SPMR only measures collision among cataloged paths; it ignores the E2 (uncatalogued / zero-match) rate. Both contribute to "US-1 produces a single-dominant-diagnosis" — if 20% of student wrong answers don't match any cataloged path, US-1's true ceiling is 80%, regardless of SPMR. The North Star framing needs a single sentence to acknowledge this. (Non-Blocking #5 below.)
5. **§9 Assumption: the κ ≥ 0.65 fallback to "self-review consistency check on a held-out subset" is asserted but not defined.** What does "self-review consistency" mean operationally? Same reviewer tags the same 30 problems twice, two weeks apart, and we compute intra-rater κ? Or sample 5 of the 30 problems for re-tag? This is a "paper-over" answer to a real shortage; it needs structure if it's the actual fallback. (Non-Blocking #6 below.)

### Score trajectory: v1 7/10 → v2 7/10 (flat)

v2 deserves an 8.5 for blockers 1, 3, 4, 6 — these are cleanly resolved with measurable improvement. v2 deserves a 6 for blocker 5 (right intent, wrong mechanism — won't compile) and a 6.5 for blocker 2 (partial reconciliation, new third counting convention). The fair weighted score is **7/10** — same as v1, but for different reasons. v1 was "good but with auditability gaps and an unimplementable confidence model"; v2 is "the right shape with a non-compiling SQL block and an unaudited third counting convention."

Per quality-gates.md, this counts as **stalled convergence** rather than regression. The orchestrator's escalation flag should fire if v3 doesn't reach ≥ 8.

---

## Blocking Issues (must fix before advancing)

### 1. [SEVERITY: HIGH] §5.3 uses a third, undocumented "conservative" counting convention that the reader cannot reproduce — and the PRD even admits the matrix and narrative numbers disagree.

- **Where:** PRD §5.3 table ("Activations / 18" column: 6, 10, 13, 7, 6) vs Appendix B's matrix totals (7, 12, 14, 7, 7) vs Appendix B's "Why §5.3 uses 6/10/13/7/6" justification.

- **Why it matters:** I parsed Appendix A's per-question dominant-failure-mode lists into a structural matrix programmatically (treating any non-`NONE` axis activation as a 1) and got exactly the matrix counts (7/12/14/7/7), not the "conservative" counts (6/10/13/7/6). The PRD's explanation that the conservative count comes from a "more conservative dominant failure modes list" is asserted but never operationalised — there is no per-question table showing which questions were *excluded* under the conservative rule and why. This is the load-bearing empirical evidence for the entire 5-axis taxonomy proposal; it has to be either fully auditable or replaced by a single auditable counting convention.

  v1's problem was "the numbers don't match"; v2's problem is "now there are three sets of numbers, and only one of them is auditable." That's a structural regression even though the direction (auditability via Appendix B) is right.

- **Suggested fix:** Pick one of:
  - **(a)** Drop the "conservative" framing entirely. Use the matrix counts (7/12/14/7/7) in §5.3. Recompute the percentages (39%/67%/78%/39%/39%). All still pass the [10%, 85%] retention rule — ERR-COMP at 78% is the only one close to the ceiling and Appendix B already flags it. No discrimination argument is lost; the PRD becomes shorter and fully auditable.
  - **(b)** If the conservative count is materially different, *show the derivation*. Add a column to Appendix A or Appendix B labelled "Conservative" with 0/1 per axis per question, summed at the bottom, with a footnote explaining the exclusion rule. The dual-reporting that v2 attempts is good in principle but requires the conservative column to actually exist.
  
  Option (a) is the simplest-that-works.

### 2. [SEVERITY: CRITICAL] The §6 A.3 `GENERATED ALWAYS AS … STORED` SQL block will be rejected by Postgres. This invalidates the v1 Blocker-5 fix.

- **Where:** §6 A.3 migration body:
  ```sql
  ADD COLUMN "errReadingTags" text[]
    GENERATED ALWAYS AS (
      ARRAY(
        SELECT DISTINCT jsonb_array_elements_text(
          coalesce(wp -> 'diagnostic_tags' -> 'err_reading', '[]'::jsonb)
        )
        FROM jsonb_array_elements("wrongPaths") wp
      )
    ) STORED;
  ```

- **Why it matters:** Per the Postgres 12+ docs on `CREATE TABLE … GENERATED`, the generation expression **must be IMMUTABLE**, **may not reference other tables or other rows of this table**, and **may not contain subqueries or set-returning functions**. The proposed expression violates *all three*: it uses a subquery (`ARRAY(SELECT …)`), and the subquery body invokes `jsonb_array_elements` (a set-returning function) and `jsonb_array_elements_text` (also a SRF). Postgres will reject the `ALTER TABLE` with an error along the lines of:
  
  > `ERROR: generation expression is not immutable` or `ERROR: set-returning functions are not allowed in column generation expressions`

  This means the v2 promise that "the DB itself maintains the invariant" cannot be delivered as specified, and the PM's argument against triggers ("a trigger is correct but mutable — someone with DBA access could turn it off") doesn't help — the GENERATED variant doesn't compile at all. The right mechanism for *this* derivation (multi-row JSONB aggregation across an array) is one of:
  - **A trigger** (BEFORE INSERT OR UPDATE) that calls a `STABLE` PL/pgSQL function — correct, but vulnerable to the mutability concern the PM raised.
  - **A materialised view** with a refresh trigger — adds complexity but auditable.
  - **Application-side derive-on-write** with a CI invariant check (a periodic job that recomputes the columns and `ASSERT`s equality, alerting if drift) — pragmatic, matches "simplest that works".
  - **No denormalised columns at all** — query `wrongPaths` JSONB directly with a `jsonb_path_ops` GIN index. The PRD itself flagged this as a candidate in v1 and dismissed it on p95 grounds, but at 10k problems with sparse GIN indices on flat JSONB arrays, 800 ms p95 is plausible. Worth re-validating.

  This is **CRITICAL** because it's not a "spec-tightening" miss — it's a confidently-stated SQL block that the engineering team would try to run and would fail at migration time. The Spec Critic's job is to catch exactly this kind of "looks-rigorous-but-wrong" assertion before it reaches Stage 2.

- **Suggested fix:** Pick the mechanism explicitly. My recommendation: **Trigger + STABLE function, plus an `ASSERT` test in the importer that confirms the trigger output matches a re-computation.** The PM's "trigger can be turned off" concern is real but small in a single-tenant Postgres; the assert-in-importer makes drift detectable on the very next import. Document in §7 NFR ("Data integrity") that the trigger is the source of the invariant and the importer is the cross-check.

  Alternatively, downgrade this from a v1 PRD requirement: explicitly mark "DB-enforced invariant" as a Stage-2 design decision to be resolved in the architecture loop, and have §6 A.3 specify only the *contract* ("the 5 summary columns must equal the union over `wrongPaths` of `diagnostic_tags`") without specifying the SQL mechanism. The architect then picks GENERATED vs trigger vs view vs derive-on-write with Postgres-feasibility evidence. This is the *honest* answer if v2 can't verify Postgres semantics here.

### 3. [SEVERITY: MEDIUM-HIGH] SPMR's NUM-DEC behaviour is unspecified. The bank-side SPMR query and the student-side US-1 match can disagree.

- **Where:** §3 Phase-A North Star (SPMR definition) vs US-1 "Edge cases / NUM-INT / NUM-DEC" (normalisation to `answer.precision` using `toFixed(precision)`).

- **Why it matters:** US-1's matcher normalises both sides before equality. SPMR's defining query is described as "one line: `group by question_code, landed_on_option having count(*) > 1`" — that's a raw string compare. So two NUM-DEC `wrong_paths` entries with `landed_on_option = "3.14"` and `"3.140"` (where `answer.precision = 2`) are: (a) **distinct** under SPMR (no collision), (b) **colliding** under US-1's matcher (both normalise to "3.14", both would match a student answer of 3.14). The bank-side metric says "no ambiguity" but the runtime would render the ambiguous side-by-side card.

  This is precisely the kind of measurement honesty the binding doc §2 calls "sacred." SPMR has to measure the same equality predicate the student-facing matcher uses, or it isn't measuring what it claims.

  Also affects US-4 AC: "Given the importer successfully imports a problem, when it logs the per-import summary, then it reports the bank-level SPMR" — without normalisation, this number is wrong-by-construction for any bank with NUM-DEC problems with trailing-zero variations.

- **Suggested fix:** Specify (in §3 and again in US-4 AC) that SPMR's collision predicate normalises `landed_on_option` exactly the way US-1's matcher does:
  - For MCQ-SC, MCQ-MC, MAT-COL: exact string equality.
  - For NUM-INT: integer equality after parsing.
  - For NUM-DEC: `toFixed(answer.precision)` byte-equality.
  
  Add one acceptance criterion to US-4: importer SPMR computation uses the same normaliser as US-1 — surfaced as a shared helper module. This is a one-paragraph fix.

### 4. [SEVERITY: MEDIUM] The "single-reviewer fallback" in §9 is a paper-over, not a real fallback.

- **Where:** §9 final assumption: *"If only one reviewer is available, κ cannot be computed; the κ gate is replaced with a self-review consistency check on a held-out subset and explicitly flagged as a v1 simplification."*

- **Why it matters:** Per binding doc §9, "honest human review is the quality gate and the real bottleneck — protect it." The κ ≥ 0.65 gate is the *only* mechanism v2 has to prove the 5 axes have real discriminating power; if it can be silently replaced with a vaguely-defined "self-review consistency check," the κ gate isn't actually enforced. v2 nowhere defines:
  - Sample size of the held-out subset.
  - Time gap between first tag and re-tag.
  - The metric used to decide pass/fail (intra-rater κ? exact-agreement rate?).
  - Whether axes that fail self-consistency are also held out of production (per the §7 NFR for inter-rater).

  The honest answer is probably: "single reviewer is not a real fallback; if the second reviewer isn't available we delay the production-engine release of the diagnosis card until they are." But that's a hard answer the PM is avoiding by inventing a soft one.

- **Suggested fix:** Either (a) specify the self-review check operationally (sample = 10 problems re-tagged after 14 days, pass = intra-rater κ ≥ 0.70 — *higher* than 0.65 because intra-rater agreement is structurally inflated), and apply the same axis-held-back consequence; or (b) drop the fallback and state explicitly: "If a second reviewer is not available by milestone X, US-1's diagnosis card is gated behind a feature flag and only renders for problems the single reviewer has tagged twice with consistent results — see §10 Q4 for the user decision." Option (b) is more honest.

---

## Non-Blocking Issues (should fix, won't block)

### 5. [SEVERITY: MEDIUM] §3 "SPMR is the upper bound on US-1's success rate" overstates SPMR's coverage.

- **Where:** §3 Phase-A North Star justification: *"It is the direct precondition for US-1 working: if two wrong paths on the same problem share `landed_on_option`, US-1 cannot deterministically pick one … So SPMR is the upper bound on US-1's success rate."*

- **Why it matters:** SPMR captures one of two failure modes that gate US-1 (ambiguous match). The other (E2 — zero match, "uncatalogued wrong path") is independent and the PRD already expects nonzero rates of it. So US-1's true single-dominant-diagnosis ceiling is `SPMR × (1 − E2_rate)`, not SPMR alone. The framing matters for setting expectations: a 90% SPMR with a 15% E2 rate gives a 76.5% true ceiling on US-1's Phase-B DSR target of 55% — comfortably above, but only because both inputs are healthy.

- **Suggested fix:** Add one sentence to §3 Phase-A: "SPMR is the *bank-side* upper bound on US-1's single-dominant-diagnosis rate. The *student-side* ceiling additionally requires E2 (uncatalogued-path) rate stays low; that is a Phase-B measurement against real attempts." This calibrates reader expectations without changing the metric.

### 6. [SEVERITY: MEDIUM] §10 Q7 ("Calibration phase reviewer") correctly flags a user decision but the PRD pre-commits to ~5 reviewer-hours without scope acceptance.

- **Where:** §7.1 row 1: "~5 reviewer-hours one-time per reviewer" + §10 Q7 asks the user who that reviewer is.

- **Why it matters:** This is *not* a defect — the PM correctly raised it. But the budget is non-trivial (a half-week of focused subject-matter expert time, on top of the inter-rater 10 hours in row 2). If the user is the only available reviewer, that's 15 hours of user time before the diagnosis engine ships. The PRD should make the *total* explicit (warm-up + inter-rater = up to 15 reviewer-hours), not just per-row totals, so the user can make an informed decision.

- **Suggested fix:** Add a summary line to §7.1: "**Total reviewer-hour budget before diagnosis engine ships in production: up to 15 reviewer-hours** (5 calibration + 10 inter-rater)." Then §10 Q7 becomes a sharper question.

### 7. [SEVERITY: MEDIUM] US-1 multi-match "ambiguous" UX is not stress-tested for the exam-prep student.

- **Where:** US-1 mechanism: *"Two or more matches → display each match's tags side-by-side, labelled 'multiple matched paths — review which one is yours'."*

- **Why it matters:** Per Spec Critic Lens 3 (User Perspective): a median JEE aspirant, post-mock, anxious about ranks, sees a diagnosis card that says "we matched 2 wrong paths to your answer — pick which one is yours." That asks the student to *self-diagnose* the exact thing the platform promised to diagnose for them. It's an honest UX but it may feel like the platform punting on its job. Two concerns:
  - **Cognitive load:** Each path has 5 axes of tags. Two paths = 10 tags side-by-side. That's a lot of acronyms for a stressed student.
  - **Possible inverse correlation with retention:** Students who see "we couldn't tell" once may discount the diagnosis card next time even when it's unambiguous.
  
  This isn't a v1 blocker because (a) the deterministic-match decision is correct and (b) SPMR ≥ 90% target means this UI fires on ≤10% of attempts. But it deserves a Stage-4 UX-audit ticket explicitly.

- **Suggested fix:** Add to §8 Out of Scope (or to US-1 explicit notes): "The ambiguous-match UI (≥2 path side-by-side card) is a Stage-4 UX item — the Stage-4 UX Auditor must specifically test whether stressed students find it useful or punting. If usability shows the side-by-side is hostile, fall back to 'showing the most common path with a "this could also be …" subtler indicator.'"

### 8. [SEVERITY: LOW] Open Question Q2 ("Are any axis values missing?") doesn't have a deadline.

- **Where:** §10 Q2: "Are any [axis values] missing for failure modes the user has seen in tutoring practice that the 2022-paper analysis did not surface?"

- **Why it matters:** This is the right question, but if the user defers an answer and engineering starts, then a missing value (e.g., "calculator/silly mistakes") surfaces during calibration, the κ measurement is corrupted because reviewers disagree about which axis-value to use. Per §7 Evolvability: "Adding a new value: extend taxonomy/maths.yaml, re-run importer. No problem re-tagging required" — but adding a *new value* mid-calibration means the calibration set must be re-tagged, which the §7.1 budget didn't include.

- **Suggested fix:** Add to §10 Q2: "If new values are added after the calibration set has begun, the calibration must restart from problem 1 — budget the user accordingly. Decision needed before reviewer starts the calibration phase."

### 9. [SEVERITY: LOW] The Appendix-B "dual reporting" justification is honest but undercut by the structural problem from Blocking Issue #1.

- **Where:** Appendix B "Why the §5.3 narrative uses 6/10/13/7/6 (the conservative count), not 7/12/14/7/7 (the matrix count)".

- **Why it matters:** The argument *"if it discriminates at 6/18 it definitely discriminates at 7/18"* is correct in direction but masks the underlying problem that 6/10/13/7/6 are not reproducible from the appendix. If Blocking #1 is resolved via option (a) — drop the conservative framing — this entire defense disappears and the section gets shorter.

- **Suggested fix:** Resolves with Blocker #1.

### 10. [SEVERITY: LOW] §9 cites a "single-reviewer fallback" without showing where in the §10 open-questions list it gets resolved.

- **Where:** §9 final paragraph + §10 Q4.

- **Why it matters:** Cross-reference hygiene. The reader has to infer that the "user should confirm this is acceptable" in §10 Q4 is the resolution path for the §9 fallback.

- **Suggested fix:** Add to §9: "(decision needed — see §10 Q4)". And to §10 Q4: "Resolves the fallback assumption in §9."

---

## What's Good (positive reinforcement — specific things v2 nailed)

1. **The §7.1 tagging-cost budget is one of the strongest sections in the entire PRD.** It quantifies what v1 hand-waved, names the bailout (median > 6 min after Q30 → escalate with 3 options), and ties the cost back to the binding doc's "protect the bottleneck" rule. This is exactly the discipline §12 demands. The 3-options escalation menu (prune to 3 axes / defer two axes / accept higher cost) is unusually mature spec-writing — it pre-commits the response shape so v3 of this PRD doesn't have to debate it under pressure later.

2. **The deterministic-matcher pivot is executed cleanly.** "Confidence" is removed from US-1, §3 (North Star), §10 (Q3 marked RESOLVED), §8 (Out of Scope) — all the places the v1 number leaked into. The replacement mechanism (1-match / ≥2-match / 0-match) is operationally crisp and verbatim-implementable. v1's Blocker #3 was the hardest of the six and v2 nailed it.

3. **The Phase A / Phase B success-metric split fixes a real measurability problem.** v1's North Star was years away from current Stage-3 work; v2's SPMR is computable against the existing 2 problems today. The leading-indicator additions (Tag coverage, Dominant-mode rate) are also useful, and the explicit baseline ("computed on import and reported in the importer's summary output") makes Stage 2 architecture trivially measurable. Even with my Blocking Issue #3 about NUM-DEC normalisation, the split itself is the right call.

4. **The new US-4 AC ("importer logs SPMR; SPMR_COLLISION is a warning, not a reject") is a Goldilocks design.** Reject would be too rigid (forces a reviewer to fix every collision on import); silent would be too soft (the PM rolls up a number nobody sees). Warning + reviewer-resolved is the right altitude. Plus it gives the bank-level rollup a free signal channel.

5. **Appendix B exists, even if I'm critical of how it's used.** The matrix itself is auditable; I verified all 5 totals programmatically against the cells, and the math is correct. v1 had no per-axis-per-question matrix at all. The auditability *direction* is right; my Blocker #1 is about applying the same auditability to §5.3, not about Appendix B itself.

6. **The change-log at the top is excellent PRD hygiene.** Every v2 change has an inline `[UPDATED v2 — Blocker N]` tag pointing back to the issue it resolves. A reviewer can scan the document linearly and verify each fix in place. This convention should be standard for all iteration-2+ PRDs in the agent-factory pipeline — recommend adding it to `templates/prd-template.md`.

7. **§10 Q3 is correctly marked RESOLVED (strikethrough)** rather than deleted. Future readers can see the question used to exist and was answered by removing the mechanism it asked about. This is the right way to retire an open question — kills the implicit "did we forget about confidence?" worry without losing institutional memory.

8. **The `idea_secondary` deferred-decision trigger is now concrete (Non-Blocker #7 from v1).** "≥ 30% of bank's problems flagged as two-concept fusions" is a real, measurable gate. The PM correctly resisted the urge to fold Option B's wins in now; the trigger gives them a way back in honestly when the bank justifies it.

9. **The 12 non-negotiables from PROJECT CONTEXT §12 remain respected.** Re-verified: identity-travels-with-every-question (the 5 new axes are added to the 7-axis identity, not separated; rule 2 ✓); append-only attempts (US-3 still routes drills through the standard capture; rule 3 ✓); design-for-1-lakh-now (GIN-indexed columns sized for 10⁴ problems, separate from 10⁷ attempts; rule 9 ✓); no-miscellaneous-tags (US-4 AC rejects unknown-value with `UNKNOWN_TAXONOMY_VALUE`; §4 ✓); empirical-batch-not-live (§7 NFR explicitly defers histograms to nightly; rule 6 ✓).

---

## Verdict

**Loop back to PM for v3.**

Per quality-gates.md, the score is at the 7 threshold — technically advanceable — but two of the v2 issues are *new* and one is **CRITICAL** (the GENERATED SQL won't compile). Advancing to Stage 2 would force the architect to re-decide the source-of-truth invariant mechanism without spec guidance, which is exactly what Stage 1's job is to prevent. The other three blocking issues are small (one paragraph each) so the v3 revision is tight, not a redesign:

1. **§5.3 counting convention:** pick option (a) — switch to matrix counts (7/12/14/7/7) and update the percentages. Drop Appendix B's "dual reporting" defense.
2. **§6 A.3 SQL mechanism:** drop the GENERATED ALWAYS AS block. Either specify a trigger + STABLE function with an importer ASSERT cross-check, OR (better) downgrade §6 A.3 to *contract-only* and let Stage-2 architecture pick the mechanism with Postgres-feasibility evidence.
3. **SPMR normalisation:** add one paragraph to §3 specifying that the SPMR collision predicate uses the same normaliser as US-1's matcher (NUM-DEC via `toFixed(precision)`, NUM-INT via parse-equality). Add one US-4 AC about the shared normaliser module.
4. **Single-reviewer fallback:** either define the self-review check operationally OR drop it and gate the diagnosis engine behind a feature flag until a second reviewer arrives.

If v3 lands these four, the score moves to 8.5–9 and advances to Stage 2 cleanly. If v3 score stays at 7, **escalate to user** with two specific questions:
- **Q-escalation-1:** Is the user comfortable advancing to Stage 2 with the source-of-truth-invariant mechanism (GENERATED vs trigger vs derive-on-write) explicitly delegated to the architect rather than spec-fixed?
- **Q-escalation-2:** Q4 + Q7 collapsed: who are the 2 reviewers for the inter-rater calibration set (the user + 1 external SME, vs the user alone with a real self-review check)?

The PRD is genuinely close. The PM did the harder half of the work; v3 is about precision and the GENERATED-column substitute, not about taxonomy or success-metric structure. We have one iteration left before mandatory escalation at iteration 3 cap.

---

*End of Spec Critic review v2.*
