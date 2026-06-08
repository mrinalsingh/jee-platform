# Spec Critic Review — PRD v1 (Diagnostic Failure-Mode Axes)

**Stage:** 1 (Spec Loop) | **Iteration:** v1 | **Reviewer:** Spec Critic (discriminator)
**Artifact reviewed:** `scorecards/01-prd-draft-v1.md`
**Date:** 2026-06-05

---

## Score: 7/10

This PRD is solid, ambitious, and unusually well-grounded in primary evidence (the 18-question worksheet). It correctly identifies that per-`wrong_paths` tagging is the right granularity, defends Option A against a fully-specified Option B, and respects the §12 non-negotiables (additive, append-only, codes-not-copies, batch-not-live empirics). Most blocking issues are about precision and self-consistency, not about direction. With one tight revision it advances. The PM should NOT redesign — they should **tighten and reconcile**.

---

## Blocking Issues (must fix before advancing)

### 1. [SEVERITY: HIGH] §5.1 prose says "16 questions" but the table contains 18 rows, and Appendix A also has 18.
- **Where:** PRD §5.1 heading "Sample analysed (**16 questions** from JEE Advanced 2022 P1 + P2 — PCM)" vs the table immediately below it (rows numbered 1–18) and Appendix A (entries 1–18). The PRD itself self-flags this at the bottom of Appendix A: *"§5.1 used a count of 16; this appendix lists 18 — the table in §5.1 will be reconciled in v2"*.
- **Why it matters:** The PM caught the inconsistency but pushed the fix to v2 instead of resolving it now. This is exactly the kind of small inconsistency that destroys downstream trust in counts derived from this sample (e.g. the "33–72% spread per axis" in the table at the bottom of Appendix A is computed off 18, but §5.3 quotes ratios "out of 16" — see issue #2). Two engineers reading this PRD would build two different calibration sets.
- **Suggested fix:** Pick one number (18 is the correct one — count the rows). Change §5.1 heading to "Sample analysed (18 questions)". Recompute all per-axis activation fractions in §5.3 against denominator 18, not 16. State this explicitly: "Of 18 sampled questions, ERR-CASE activates in 10 ⇒ 56%."

### 2. [SEVERITY: HIGH] §5.3 axis-evidence math is inconsistent with §Appendix-A totals — the discriminating-power case is overstated.
- **Where:** PRD §5.3 column "Discriminating power evidence."
  - For ERR-READING it claims "3 + 2 = 5 of 16" (31%). Appendix A's footer table says ERR-READING activates 6 of 18 (33%).
  - For ERR-CASE: §5.3 says "3 + 2 = 5 of 16". Appendix A says ERR-CASE = 10 of 18 (56%). The two numbers differ by 2× and contradict each other.
  - For ERR-COMP: §5.3 says "3 + 4 = 7 of 16". Appendix A says 13 of 18 (72%). Again 2× off.
  - For ERR-STRATEGY: §5.3 says 7 of 16; Appendix A says 7 of 18. Different denominator.
  - For ERR-PARSING: §5.3 says 7 of 16; Appendix A says 6 of 18.
- **Why it matters:** §5.3 is the load-bearing argument for "each axis has discriminating power" — the entire justification for proposing 5 axes (and not 3, and not 8) rests on these counts. If two of the five axes don't pass the discriminating-power test under correct counting, the whole §6 Option A taxonomy is partially unsupported. **This is the empirical foundation; it cannot be wrong.**
- **Suggested fix:** Re-derive all five rows of §5.3 directly from the per-question failure-mode lists in §5.2's bucket table or in Appendix A, using a single fixed denominator (18). Show the denominator. If after recounting a candidate axis turns out to activate in <25% or >85% of the sample, explicitly defend why it still belongs (or drop it). Consider an explicit per-question × per-axis matrix in an appendix so the reader can audit the count without a calculator.

### 3. [SEVERITY: HIGH] The "diagnosis confidence" engine in US-1 is specified by its output but not by its mechanism — two engineers will build two different things.
- **Where:** US-1 Acceptance Criterion 1 ("the inferred dominant failure mode … with a one-sentence plain-English label"), AC 2 ("Given the system has < 70% confidence in any single failure mode"), and the §3 North Star ("≥70% posterior confidence").
- **Why it matters:** The PRD never defines what produces the confidence number. The Flow §3 step 2 says "matches the student's wrong answer to the wrong-path whose `landed_on_option` equals what the student picked" — that's a deterministic exact-match lookup, which yields 100% confidence on a single hit or 50%/50% on a tie. There is no probabilistic model producing a continuous 0–1 confidence. So the entire ≥70% / <70% branching is unimplementable as written. An engineer would either (a) hardcode 100/0/50 and the branches never fire, or (b) invent a confidence model — and two engineers would invent different ones.
  - This also affects Spec Critic Lens 5 (Business Logic): the §3 North Star "≥55% of attempts with single dominant ≥70% confidence" cannot be measured if "confidence" isn't defined.
- **Suggested fix:** Either (a) **drop "confidence"** and use deterministic logic: "If exactly one `wrong_paths.landed_on_option` matches the student's answer → display that path's diagnostic tags. If ≥2 match → show all matched paths as 'ambiguous'. If 0 match → E2 (uncatalogued)." The North Star becomes "% of wrong attempts where exactly one wrong-path matches"; or (b) **define confidence explicitly** as the share of historical attempts on this `(question_code, landed_on_option)` whose post-hoc reviewer-confirmed diagnosis matched this path's tags (requires a calibration dataset, which doesn't exist yet). Option (a) is the simplest-that-works and aligns with the project priority order. Pick one and rewrite both US-1 and §3.

### 4. [SEVERITY: HIGH] The "≥1,000 attempts over ≥50 students" North Star measurement plan is infeasible at current stage and the PRD doesn't acknowledge it.
- **Where:** §3 North Star: "in a representative pilot of ≥1,000 attempts over ≥50 students… Target at pilot end (T+60 days post-launch)."
- **Why it matters:** Per build sequence (§8), the testing website (Stage 7) and pilot (Stage 10) come after several other stages. The bank currently has 2 problems. There is no testing website, no students, no attempts. "T+60 days post-launch" is years away from current Stage-3 work. Yet the PRD's success criteria depend on it. This is a classic case of a North Star a delivery team cannot move in a useful timeframe.
  - Per Spec Critic Lens 1 (Completeness) and Lens 5 (Business Logic): success metrics must be measurable on artifacts this PRD actually delivers.
- **Suggested fix:** Split the success metrics by phase, explicitly. **Phase A (now, what this PRD delivers):** measurable from the taxonomy + the importer + the tagging exercise on the existing 2 problems plus the next ~10 problems Claude generates. Examples: (i) inter-rater κ ≥ 0.65 on a 30-problem calibration set; (ii) 100% diagnostic-coverage of `wrong_paths` for all newly imported problems; (iii) median tagging time ≤ 4 min. **Phase B (post-pilot, validation only):** the ≥55% Diagnosis Specificity Rate. Move the North Star to Phase B explicitly so we don't gate Stage-2 architecture work on a Stage-10 measurement.

### 5. [SEVERITY: HIGH] §6 (Option A) §A.3 violates §12 non-negotiable: the 5 per-problem summary columns are computed from `wrong_paths` JSON → there are now two sources of truth for the same data and they can diverge.
- **Where:** PRD §6 Option A subsection A.3 ("Per-problem summary axes (new columns on `problems` table)") and A.6 ("Populated by the importer at YAML→DB time. Never edited by hand.")
- **Why it matters:** `errReadingTags` (and the four sibling columns) duplicates information that already lives in `wrong_paths[i].diagnostic_tags`. The PRD says "never edited by hand", but the importer must also re-derive it on every update. If anyone ever updates the JSON without re-running the importer pipeline (e.g. a hotfix, a backfill script, a manual SQL edit), the two diverge silently and US-2's query returns wrong answers. **PROJECT CONTEXT §6** lists `wrong_paths` as a JSON column on `problems`; it is the source of truth. Mirroring it into 5 array columns creates a denormalization that needs invariant enforcement.
  - This is a "design for 1 lakh students NOW" issue (§12 rule 9): at scale, even rare divergences become hundreds of wrong drills assigned per day.
- **Suggested fix:** State the invariant explicitly and the mechanism. Pick one of: (i) **DB trigger** on `problems` UPDATE that re-derives the 5 array columns from `wrong_paths` JSON; (ii) **Generated columns** (Postgres `GENERATED ALWAYS AS` extracting JSONB array values) so the DB itself maintains the invariant; (iii) **No denormalized columns** — query `wrong_paths` JSON directly with a JSONB GIN index (Postgres supports `jsonb_path_ops`; will it hit the 800ms p95 NFR on a 10k-problem bank? Probably yes — verify). Option (ii) is most robust and removes all divergence risk. Option (i) makes the importer not the only writer. State which one and why.

### 6. [SEVERITY: HIGH] The 12-min-per-question tagging-time estimate is at odds with PROJECT CONTEXT §9's "honest human review is the bottleneck" and not stress-tested against the bank-fill goal.
- **Where:** §3 leading indicator ("≤ 4 minutes per problem after a reviewer has tagged ≥ 20 problems") and §6 Option A A.6 ("≤ 12 minutes of reviewer time total" for 2 existing problems).
- **Why it matters:** The 4-min target is *median*, *after warm-up*. The warm-up cost is undefined ("after ≥ 20 problems"). For the first 20 problems tagging will plausibly be 8–15 min each, i.e. another 2–4 hours of bottleneck human time before the metric even applies. Per PROJECT CONTEXT §9, "honest human review is the quality gate and the real bottleneck — protect it." The PRD doesn't quantify the warm-up cost, doesn't quantify per-axis worst-case, and offers no fall-back if real-world κ shows the taxonomy needs sharpening (which would require a re-tag pass on already-tagged problems).
  - Per Spec Critic Lens 4 (Adversarial): what if 5 axes × 4 minutes each is the realistic *median* (not aggregate), i.e. 20 minutes per problem? The PRD's 4-min total is suspiciously low.
- **Suggested fix:** Add a "tagging-cost budget" subsection with three numbers: (a) **First-20 warm-up:** expected median 8–10 min/problem × 20 = ~3 reviewer-hours one-time cost. (b) **Steady state (after warm-up):** ≤4 min/problem. (c) **Worst-case fall-back:** if median exceeds 6 min after problem 30, escalate to user — taxonomy may need pruning to 3 axes. Add an explicit "if κ < 0.65 we drop that axis" gating to §7 Inter-rater. This protects the bottleneck.

---

## Non-Blocking Issues (should fix, won't block)

### 7. [SEVERITY: MEDIUM] §6 Option A's dismissal of `idea_secondary` is too fast — PM said "fold it into Option A later" but never named the trigger.
- **Where:** §6 "Option A vs Option B" recommendation paragraph: *"Option B's two genuine wins (two-concept fusion as `idea_secondary`; explicit marking-scheme identity) can be folded into Option A as a small future enhancement later (just add an axis 4.5 `idea_secondary` when needed) without re-tagging the bank."*
- **Why it matters:** PROJECT CONTEXT §3 question-construction signature #4 explicitly says "Two-concept fusion is the norm; three-concept is rare." That's an asserted property of the entire question space, not an edge case. Five of the 18 sampled questions plausibly fuse two ideas (P1-M-Q14 = MAT + CAL; P1-M-Q3 = PRB language + conditional; etc.). The PM's "later" handwave is the right *direction* (don't bundle into this PRD) but lacks a trigger: when do we add it?
- **Suggested fix:** Add to §8 (Out of Scope) an explicit deferred-decision entry: "`idea_secondary` axis — out of scope for this PRD. Trigger to add: when ≥30% of the bank's authored problems are flagged by the reviewer as two-concept fusions in `review_notes`. This will be measurable once the bank crosses ~30 problems." That's honest punting with a concrete re-evaluation rule.

### 8. [SEVERITY: MEDIUM] §6 Option A axis-value count drift — recommendation paragraph says "4+4+4+3+4 = 19 axis values" but actual enumeration in §6 A.1 has 4+4+4+3+4 = 19.
- **Where:** §10 Open Question Q2 says "§6 (Option A) proposes 4+4+4+3+4 = 19 axis values". Checked against §A.1: ERR-READING (4 values including NONE), ERR-CASE (4), ERR-COMP (4), ERR-STRATEGY (3), ERR-PARSING (4) = 19. ✓ The arithmetic checks out.
- **Why it matters:** This one is actually consistent (I verified). I'm flagging it as a non-issue, not a problem — but the PM should add the per-axis-value count to §6 A.1 explicitly as a header to make this kind of audit trivial. Future axis additions will need this discipline.
- **Suggested fix:** Add `# 4 values` comment above each axis block in §A.1 YAML.

### 9. [SEVERITY: MEDIUM] US-1 numerical wrong-path matching is under-specified for `NUM-DEC`.
- **Where:** US-1 Edge Cases: *"Numerical (NUM-INT / NUM-DEC) case: wrong-path matching uses numeric equality (with the per-question precision spec); off-by-decimal-places is a distinct failure mode from off-by-sign."*
- **Why it matters:** The per-question precision spec lives in `problems.answer.precision` (per the Prisma schema and `_SCHEMA.md`). But the YAML `wrong_paths[i].landed_on_option` for NUM is described as "the value the wrong path produces" — at what precision? If the student enters 3.14 and the wrong-path value is 3.140 and the problem precision is 2 decimal places, do they match? PRD doesn't say.
- **Suggested fix:** Normalise both the student's input and the wrong-path value to `problems.answer.precision` decimal places before equality. Add this to the importer-validation: each `wrong_paths[i].landed_on_option` for NUM types must be a number with ≤ `answer.precision` decimals.

### 10. [SEVERITY: MEDIUM] §8 Out of Scope misses "no UI for the admin queue in US-1 E2 (uncatalogued wrong path)."
- **Where:** US-1 Error Path E2: "logs the (student_id, question_code, wrong_answer) triple to an admin queue". §8 Out of Scope.
- **Why it matters:** "Admin queue" implies a queue UI. There isn't one (Stage 7+ work). §10 Q6 raises this but defers it. Either commit to the CSV-export fallback in this PRD or push it explicitly to Out of Scope.
- **Suggested fix:** Add to §8: "The admin-queue UI for uncatalogued wrong paths (US-1 E2). For v1, the queue is an append-only `problems_diagnostic_misses` table (`student_id, question_code, wrong_answer, created_at`) exported on demand via a CLI script — see follow-up PRD."

### 11. [SEVERITY: LOW] US-2 §AC 2 "T1:T2:T3:T4 ≥ 2:3:3:2" — what does the inequality mean over a ratio?
- **Where:** US-2 AC 2c: "intrinsic difficulty spread satisfies T1:T2:T3:T4 ≥ 2:3:3:2."
- **Why it matters:** Ratios don't have a meaningful ≥. Does this mean at least 2/10, 3/10, 3/10, 2/10 of each tier? Or "the ratio of T1:T2:T3:T4 in the returned set is no flatter than 2:3:3:2 with no tier missing"? Two engineers would write two different constraint solvers.
- **Suggested fix:** Restate as "of the 10 returned questions, at least 2 are T1, at least 3 are T2, at least 3 are T3, at least 2 are T4 (sums to 10)." Or alternatively, "no tier has fewer than 1 question; the most-represented tier has no more than 4." Be explicit.

### 12. [SEVERITY: LOW] §10 Open Questions list is mostly real, but Q3 (70% threshold) becomes moot if the "confidence" mechanism is removed per blocker #3.
- **Where:** §10 Q3.
- **Why it matters:** Eliminating "confidence" simplifies the spec materially.
- **Suggested fix:** Re-evaluate Q3 once blocker #3 is resolved. The other 5 open questions (especially Q4 inter-rater protocol and Q5 free-text reviewer note) are legitimately user-decisions and should stay.

### 13. [SEVERITY: LOW] No mention of how diagnostic axes interact with `provisional` → `calibrated` transition logic.
- **Where:** US-4 AC 5 mentions κ ≥ 0.65 gating; §7 says calibrated immutability applies. But there's no statement of: when a problem goes provisional→calibrated, must all 5 axes pass κ first?
- **Suggested fix:** Add one sentence to US-4 acceptance: "A problem can only transition to `calibrated` if all 5 diagnostic axes on all wrong-paths are populated AND every diagnostic axis has passed the κ ≥ 0.65 gate on the calibration set."

### 14. [SEVERITY: LOW] PRD references files that exist but doesn't link them.
- **Where:** §6 cites `_SCHEMA.md` repeatedly; §3 cites "PROJECT CONTEXT §12 rule 6"; etc.
- **Why it matters:** A reviewer reading the PRD has to grep for these. Adding inline relative paths costs nothing and improves auditability.
- **Suggested fix:** First mention of each: `_SCHEMA.md` → `/content/maths/generated/_SCHEMA.md`; PROJECT CONTEXT → `/docs/PROJECT CONTEXT.md`. Standard PRD hygiene.

---

## What's Good (positive reinforcement)

1. **The §5 empirical-evidence section is genuinely unusual and excellent.** Most PRDs assert axes; this one walks 18 actual JEE Advanced 2022 questions and shows which failure modes activate where. The Appendix A worksheet is gold — a future content reviewer can audit and extend it. Per the binding doc's §2 "honesty of measurement is sacred," this is exactly the right altitude of evidence. Keep this discipline in v2.

2. **The per-`wrong_paths` tagging decision (§5.4) is the right call.** Tagging per-problem would have destroyed the diagnostic signal (the platform's whole point is *which* wrong path the student took). The PM correctly identifies that one problem has 2–3 distinct paths each tagging a different mode. This single design choice is what makes US-1 work at all.

3. **Both options A and B are fully specified.** Most PMs would have written 4 lines on the rejected option. This one writes 2 full sections, with migration cost, with diagnostic gains/losses, with a comparison table. That's how a real product manager respects a decision the user asked them to surface. Even if Option A wins (and the recommendation is sound), Option B's `idea_secondary` is now legibly available for a later PRD.

4. **The 12 non-negotiables in PROJECT CONTEXT §12 are mostly respected.** Additive design (Option A doesn't break Stage-3 importer tests). Codes not copies (no problem-copy duplication). Empirics in batch (§7 NFR explicitly defers histograms to nightly batch). Append-only attempts (US-3 E3 explicitly notes drill goes through normal capture layer). This is the discipline §12 demands.

5. **Failure-path coverage in US-1 (E1/E2/E3) is honest and complete.** Many PRDs hand-wave "what if no diagnosis matches"; this one specifies (a) admin-queue logging, (b) fall back to topic-only display, (c) never-throws behavior. Per Spec Critic Lens 3 (User Perspective): no trapped states, always feedback.

6. **The κ ≥ 0.65 gate (§7 Inter-rater reliability) is the right rigor for this kind of axis.** Diagnostic tags applied subjectively without inter-rater validation become noise. PM correctly makes this a *blocking* gate ("axis is held back from production diagnosis engine until re-defined") not a wishful KPI. This is rare maturity.

7. **§8 Out of Scope is unusually long and unusually specific.** Each item is a real thing someone might assume is in scope (Physics/Chem taxonomy, mastery formula, multilingual labels, anti-gaming). PM explicitly cuts each. Stage 1 scope discipline.

---

## Verdict

**Loop back to PM** with the 6 blocking issues above. Expected v2 score: 8.5–9.

The PRD has the right shape, the right evidence, and the right design choice (Option A with per-`wrong_paths` tagging). What it lacks is precision in three places: (i) the empirical counts in §5.3 vs Appendix A, (ii) the "confidence" mechanism in US-1, and (iii) the success-metric phasing. Fixing these is a focused 90-minute revision, not a redesign. Specifically:

- **Reconcile §5.1 / §5.3 / Appendix A on a single denominator (18) and recompute the activation fractions.** (Blocker 1, 2)
- **Replace "confidence" with deterministic wrong-path matching** OR define confidence with a measurable formula. (Blocker 3)
- **Split success metrics into Phase A (deliverable now) and Phase B (pilot-validation, later).** (Blocker 4)
- **Add the source-of-truth invariant for the per-problem summary array columns** (DB trigger or generated columns). (Blocker 5)
- **Quantify the warm-up tagging cost and the worst-case fall-back.** (Blocker 6)

If v2 lands those five fixes cleanly without regressing any of the seven good things above, advance to Stage 2 (Architecture). If v2 score stays at 7, escalate to user with the unresolved confidence-mechanism question (blocker 3) as the specific decision needed.

---

*End of Spec Critic review v1.*
