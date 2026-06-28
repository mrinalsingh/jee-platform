# Spec Critic Review — Student Test-Taking Runtime PRD v2

**Stage:** 1 (Spec Loop) | **Iteration under review:** v2 | **Reviewer:** Spec Critic (discriminator)
**Artifact reviewed:** `agent-factory/scorecards/16-test-runtime-prd-draft-v2.md`
**Predecessor review:** `agent-factory/scorecards/16-test-runtime-prd-review-v1.md` (v1 scored 8/10)
**Date:** 2026-06-26

---

## Score: 9/10

v2 is a substantial improvement. The PM has:

- **Closed all three v1 blockers honestly and surgically** — not papered over, but with concrete API shapes, schema columns, CI tests, and implementation pointers in the new §10 "binding implementation notes" block.
- **Folded in five Vision-Update axes** (parent role placeholder, hints, beyond-syllabus, anti-cheat hybrid, extended `AnswerType`) without inflating the rest of the document. The new US-9 and US-10 are spec'd to the same standard as US-1..US-8 — acceptance criteria, ≥2 error paths, edge cases.
- **Closed Open Questions Q2 and Q9** (marking-scheme defaults and multi-device modal copy) by decision, not by deferral, exactly as the convergence rules want.
- **Defended the §12 invariants** (append-only attempts, the snapshot/attempts separation) while extending the data model by 5 tables — the boundary stays crisp.
- **Preserved every "what's good" from v1** verbatim (Tier-2 city profile, two-step submit, MCQ-SC clear-response rule, PRD-01 cross-references) — no regression.

I am holding the score at **9** rather than the PM's expected **9.0+** because **one HIGH issue is genuinely new in v2** (the hint lazy-fetch endpoint leaks **which question the student is stuck on** via timing + log analysis, and worse, the per-level GET URL pattern lets a sophisticated student enumerate `hint_count` for every slot by probing) and **two MEDIUMs are inherited from the Vision-Update scope expansion** (the cohort-move-mid-window race, and the marking-scheme `MAT-COL` partial shape that doesn't quite cover JEE Advanced's per-row marking literature). These are all addressable by the Architect in Stage 2 — they do NOT loop us back to PM v3 — but they belong in the architect-input-notes so they don't get rediscovered as Stage-3 bugs.

The PM's expected v2 score of **9.0** is essentially correct; I land it at 9 with three items handed forward, not 9.5.

**Verdict: advance to Stage 2.**

---

## Iteration Delta — Full

### v1 blocker status (final)

| # | v1 Blocker | Status | Evidence |
|---|---|---|---|
| **1** | NUM-DEC rounding `toFixed` contradiction | **FIXED** | §0 Glossary + §4 US-3 + §5.4 + §10.1 all converge on `@jee/numeric-normalise` (path `lib/numeric.ts`) backed by `decimal.js` `ROUND_HALF_EVEN`. CI test asserts byte-equal across importer, runtime, diagnostic matcher. The "input cap at keystroke time" addition is a v2 product improvement that I did not request — it pre-empts the failure mode entirely on the client. Clean fix. |
| **2** | Figure URLs leaking question_code | **FIXED** | §5.3 + §8.2 + §10.2 specify HMAC-signed per-session tokens, slot_index addressing, session_secret rotation on submit, separate `review-figures` path that 403s during active session. Token construction is documented and I review it adversarially below (new NEW-1). |
| **3a** | Test-assignment model missing | **FIXED** | §8.3 adds `cohorts`, `cohort_members`, `test_assignments` with the `(cohort_id XOR student_id)` CHECK constraint. UNION-DEDUPE rule on §4 US-1 AC is explicit and correct. |
| **3b** | Marking-scheme JSON shape under-specified | **FIXED (mostly)** | §8.4 ships the canonical shape with JEE-Adv 2023+ defaults. The four-way MCQ-MC partial-marking edge cases are pinned. One MEDIUM concern about MAT-COL partial-marking expression (see below NEW-3) survives. |
| **3c** | Anti-cheat baseline missing | **FIXED** | US-9 fully specced (10 ACs, 3 flows, 3 error paths, 4 edge cases), §5.9 honest-limits block, §3.3 G5 guardrail "violations cannot lock a student out". The 3-violation hybrid (Vision Update §3) is the right product call. |

**All three v1 blockers are fixed.** I concede in full to the PM on every v1 critique.

### Non-blockers from v1: status

| # | v1 Non-blocker | Status |
|---|---|---|
| 6 | Late-snapshots fairness window | **FIXED** — §3.3 / US-5 E1 / §5.7 all converge on "≤ 5 s past server-anchored T=0 → scored; later → audit-only". |
| 7 | Multi-device modal copy | **FIXED** — exact copy pinned in US-7 AC and rendered in Appendix A. |
| 8 | Double-submission first-write-wins | **FIXED** — §3.3 G3 explicit. |
| 9 | `attempt_order` reconciliation | **FIXED** — §5.4 splits the two semantics into `attempt_order` (cumulative, per PROJECT CONTEXT) and new `visit_index_in_test` (per-session). `attempts` schema delta is called out in §8.3. |
| 10 | Weasel words / unspecified quantities | **FIXED** — `MAT-COL` row count made content-dynamic; rate-limit budget (30/s) shown its math; StatCounter India source cited; sync-rejection banner location pinned. |
| 11 | §5.4 IndexedDB "MUST" vs in-memory fallback | **FIXED** — §5.4 reworded to "durably queued — IndexedDB if available, in-memory fallback otherwise". |

### NEW issues introduced in v2

1. **[HIGH]** Hint lazy-fetch leaks per-slot `hint_count` and "which question the student is stuck on" via the URL path pattern. (Detailed below.)
2. **[MEDIUM]** Cohort-move mid-window: a student removed from cohort C at T+30min during an OPEN test inherits an ambiguous reading on resume. (Detailed below.)
3. **[MEDIUM]** `marking_scheme.MAT-COL` shape conflates "all rows correct" with the JEE-Adv 2023+ "+4 for all 4 correct rows, +1 per partial" math — partial-but-some-wrong is not expressible.
4. **[LOW]** HMAC-secret-leak fallout is not specified — what's the operational response if `session_secret` leaks server-side?
5. **[LOW]** Server-side clock-skew handling for the 3-violation auto-submit timing relative to T=0 is not addressed.

These are the items I hand forward to the Architect or schedule for v3 polish, not to PM v2.5.

### Score trajectory

**v1: 8/10 → v2: 9/10** (rise of +1). PM expected 9.0; I confirm. No regressions detected. The increase is from blocker closures dominating new-issue introduction — the new HIGH is real but is one item, vs five v1 blockers fully fixed.

---

## Blocking Issues (still open in v2)

None block advance to Stage 2. The HIGH below is real and should be addressed by the Architect, but it's not a CRITICAL/HIGH **security** issue per the constitution's bar (the attack reveals topology, not bank content) — and the v2 PRD is internally consistent on what it currently says. I hand it to Stage 2 as a binding Architect requirement; I do NOT loop back to PM.

**Decision: zero blocking issues. Advance.**

---

## Non-Blocking Issues (inherited by Architect or scheduled for v3)

### NEW-1. [SEVERITY: HIGH — handed to Architect] Hint lazy-fetch endpoint leaks per-slot `hint_count` AND "which question is the student stuck on"

- **Where:** §8.2 `GET /api/test-sessions/{session_id}/questions/{slot_index}/hints/{level}`; §5.3 hint rate-limit "1 per second per session"; US-10 AC "server returns ONLY the L-th hint text".
- **Why it matters:**
  1. The URL contains `slot_index` and `level`. A sophisticated student opens DevTools' Network panel (note: §5.9 honest-limits already concedes "cannot reliably detect devtools" via the menu path) and watches their own requests. They learn nothing new about themselves, but they ALSO learn:
     - The hint-fetch URL pattern is identical for every slot — by **probing** `GET .../questions/{slot}/hints/1` for every slot from 0..N-1 they can enumerate which slots return 200 vs 404, recovering `hint_count > 0` per slot. The PRD's "the server returns only if level == hints_used + 1" guards level-skipping but does NOT guard level-1-probing — `hints_used=0` for an unvisited slot, so `level=1` is always valid as the first call. The "rate-limited to 1/s" only slows this to N seconds — for an 18-question test, 18 s.
     - Even within a single test, knowing which questions have hints is a meaningful information leak (problems with hints tend to be the harder ones in the bank; the rate of authored hints currently maps weakly to T-rating).
  2. The **timing-attack** variant: even if the server rejects probes for slots not currently being viewed (an additional check), the hint-fetch response time varies measurably with the size of the returned hint text (KaTeX-rendered HTML can be 200B–5KB). A student doesn't gain answer information from this, but it leaks **whether the question has rich math** in its hint, which weakly correlates with content type.
  3. The **audit-trail** variant: the rate-limiter at 1 req/s, combined with the "audit row NOT written client-side on failure" rule (US-10 E1), means a probe-and-watch attack leaves no per-slot audit trail beyond the 1/s aggregate — there's no AC saying "all hint endpoint calls including 404s are audit-logged".
- **Suggested fix (Architect contract, not PM rework):** add to architect-input-notes Requirement L:
  - Hint endpoint MUST verify `slot_index == current_slot_for_session` (the server tracks "currently-active slot" via a `PUT .../active-slot` heartbeat at the same cadence the runtime ticks visit_count). Probing slot != active returns 403 + audits the violation. This makes the probe attack require the student to actually *open* each question — at which point they're paying their visit_count toll, which the teacher sees.
  - Every hint endpoint call (200/400/404/403) MUST write a row to `test_session_audit` with `(session_id, slot_index, requested_level, response_status, server_timestamp)`. No silent failures.
  - Consider serving all hint-text payloads as fixed-length padded blobs (constant-time response shape) to mitigate the timing variant. Low priority but cheap.
- **Why this is non-blocking:** the leak is topological (which slots have hints, not the hint content), the cost is a visible audit trail (under the proposed Architect fix), and the Architect can land it inside Stage 2 without changing PRD wording. Architect MUST address; PM does NOT loop.

### NEW-2. [SEVERITY: MEDIUM] Cohort-move mid-test-window has an unspecified semantic

- **Where:** US-1 AC "UNION-DEDUPE on `test_id`"; §8.3 `cohort_members` has `joined_at` but no `left_at`; §8.3 `test_assignments.cohort_id` has no row-level "snapshot at assign time" guard.
- **Why it matters:** scenario — student S is in cohort C; teacher T assigns test X to cohort C with window `[10:00, 12:00]`. At 10:30, S has STARTed the session and is mid-test. At 11:00, teacher T removes S from cohort C (or moves S to cohort D). Question: does S's in-flight session remain valid?
  - The PRD's `test_assignments` row is by `cohort_id`, not by frozen student-list. The dashboard query at 11:01 returns "no row matching me" for S → on resume after a network blip, S's dashboard shows no assigned test → confusion. The active session itself isn't invalidated (the FK on `test_sessions.test_assignment_id` persists), so the runtime keeps running — but `multi_device_warning` and the Dashboard view diverge.
  - There's no AC for "session validity is determined at START, not on every dashboard read".
- **Suggested fix (Architect contract):** add to architect-input-notes Requirement M: once a `test_sessions` row exists with `started_at IS NOT NULL` and `submitted_at IS NULL`, the dashboard's "tests assigned to me" query MUST UNION-IN the test referenced by that row regardless of current cohort membership. Equivalently, a SQL view `dashboard_tests_for_student(student_id)` is defined as:
  ```
  (UNION-DEDUPE of cohort+individual assignment, per US-1 AC)
  UNION
  (test_id from any test_sessions WHERE student_id=me AND submitted_at IS NULL)
  ```
  Document this. Also: `cohort_members` should grow a `left_at: DateTime?` column (NULL = currently in cohort) for the audit trail, not for the query — the query uses `left_at IS NULL OR left_at > assignment.window_end_at`.
- **Why this is non-blocking:** the runtime itself behaves correctly (the session FK pins everything); only the dashboard-after-the-fact view is ambiguous. Architect's call.

### NEW-3. [SEVERITY: MEDIUM] `marking_scheme.MAT-COL` shape cannot express JEE-Adv 2023+ "+4 all / +1 per correct row otherwise / 0 unanswered / −1 only if all-or-some-correct doesn't apply" math

- **Where:** §8.4 `MAT-COL: { per_correct_row, per_wrong_row, all_rows_correct }`.
- **Why it matters:** JEE Advanced 2023 Paper 2 MAT-COL marking (canonical reference): `+4` if all rows correctly matched; **`+1` for each correctly-matched row otherwise (even if some rows wrong)**; `0` if no rows attempted; **`−2` for any row matched wrong UNLESS the all-rows-correct path applies**. The current §8.4 shape:
  - Has `per_correct_row` (good — covers the +1 path)
  - Has `per_wrong_row` (defaulted to 0 — but the actual rule is −2 per question, not per row, and it gates the per_correct_row credit)
  - Has `all_rows_correct` (good — covers the +4 path)
  - **Missing:** the "any row wrong AT ALL → no per_correct_row credit; only the negative" gating rule. As written, a student matching 3 of 4 rows correctly AND 1 wrong gets `3 × per_correct_row + 1 × per_wrong_row = 3 × 1 + 1 × 0 = +3`, but JEE Advanced 2023 gives them **−2 total** (any-wrong-locks-partial gates the entire question; some past papers vary but 2023 is the binding reference).
  - There are also MAT-COL variants in JEE history where a row may legitimately match multiple List-II options (the AC in §4 US-3 acknowledges this: "One List-II option may map to multiple List-I rows" — but the marking scheme has no concept of "row matched to a SET of options" being correct vs partial).
- **Suggested fix (Architect contract):** §8.4 MAT-COL block should be:
  ```
  "MAT-COL": {
    "all_rows_correct": 4,
    "per_correct_row_if_no_wrong": 1,   // credit per correct row, ONLY if zero rows are matched wrong
    "any_wrong_row": -2,                // applies once if any row is matched wrong; replaces per_correct_row credit
    "unanswered": 0
  }
  ```
  Document the gating rule explicitly: "if any row is matched wrong, the total = `any_wrong_row` and `per_correct_row_if_no_wrong` is NOT applied". This is unambiguous and matches JEE-Adv 2023. The Architect closes this in Stage 2 schema lock.
- **Why this is non-blocking:** the runtime sends the snapshot; the scoring engine (out of scope per §6) consumes the JSON. If the marking_scheme shape is wrong, scores are wrong but the runtime correctness is unaffected. Architect must fix before the scoring engine PRD opens.

### NEW-4. [SEVERITY: LOW] HMAC secret-leak operational fallout unspecified

- **Where:** §0 Glossary "signed figure token"; §10.2 "session_secret … 32-byte HMAC key … rotated on submit".
- **Why it matters:** the threat the PRD addresses is a student stashing signed URLs and replaying them after submit — the secret rotation kills this cleanly. But the PRD doesn't address: what if the `test_sessions.session_secret` column is compromised server-side (DB dump, log line, etc.)? Currently any leaked `session_secret` lets the attacker generate valid tokens for ANY `(slot_index, figure_index)` of that session for the session's lifetime. Mitigation options the Architect should consider:
  - Use `(session_secret, slot_index, figure_index, monotonic_nonce)` so each issued token is single-use (tracked in a small table); replay returns 401. Heavier but tighter.
  - Or accept the threat ("if your DB is dumped you have bigger problems") — but document the acceptance.
- **Suggested fix:** add to architect-input-notes Requirement N: choose single-use-with-nonce OR document the accept-and-monitor stance. Either is fine; the choice should be explicit.
- **Why this is non-blocking:** the residual risk is small (the figures themselves are the SAME content the student is already authorised to see during their own session — the leak doesn't expose another student's bank).

### NEW-5. [SEVERITY: LOW] 3-violation auto-submit can race the server-side timer at T=0

- **Where:** §3.3 G3 (first-write-wins on submit); US-5 (server-timer at T=0); US-9 (3-violation auto-submit).
- **Why it matters:** scenario — student's tab has been idle, server is about to fire its 30-s auto-submit-on-expiry job. At T = expires_at − 1s, the student returns and tab-switches (the visibilitychange event becomes the 3rd violation). The client tries to auto-submit with `auto_submit_source='violation_threshold'`; meanwhile the server's scheduled job fires within the next 30 s with `auto_submit_source='server_timer'`. First-write-wins (§3.3 G3) ensures only one writes — but which `auto_submit_source` value does the review page show? PRD says the FIRST write's value is canonical. That's fine, but it means the teacher's review-page banner says "auto-submitted by server_timer" even though the student's 3rd violation was the immediate trigger. The teacher loses a true signal.
- **Suggested fix:** add to architect-input-notes Requirement O: on first-write-wins, if a second submit call within 30 s carries a "harder" source (`violation_threshold` is harder than `server_timer`), update an **auxiliary** `submission_metadata.also_triggered_by: ['server_timer', 'violation_threshold']` array on the `test_sessions` row. Append-only; never overwrites `auto_submit_source` itself. The post-test review shows the primary banner from `auto_submit_source` AND a secondary "violations also reached threshold at HH:MM:SS" line if the array contains `violation_threshold`.
- **Why this is non-blocking:** the test integrity is preserved either way; only the teacher's signal is lossy. Architect's call.

### Non-blockers inherited from v1 review and acknowledged

- v1 non-blocker 6 (late-snapshots window): closed in v2.
- v1 non-blocker 7 (modal copy): closed in v2.
- v1 non-blocker 8 (idempotency rule): closed in v2.
- v1 non-blocker 9 (attempt_order): closed in v2 via the split.
- v1 non-blocker 10 (weasel words): closed.
- v1 non-blocker 11 (IndexedDB-or-fallback): closed.

---

## What's Good (positive reinforcement — what v2 nailed)

### A. The §10 "Implementation notes for Architect / Engineer (binding)" is a model section

PRD-as-handoff documents often punt detail to the Architect; v2 instead gives the Architect a 4-section recipe with file paths, code snippets, state machines, and CI test requirements. §10.1 (numeric-normalise) gives an EXACT implementation (`new Decimal(value).toFixed(precision)` — not JS toFixed — with the rounding mode pre-set globally), exact consumer file paths, and exact CI assertion semantics. §10.3 (violation detector) gives a state machine `IDLE → COUNTING(1) → COUNTING(2) → AUTO_SUBMITTING → SUBMITTED` with the "fires once per session" guard called out. This is the bridge between PM and Engineer that the agent-factory rule set wants but rarely sees v1-quality work do. Preserve this pattern for future PRDs.

### B. The Vision-Update fold-in is disciplined: in-scope items get full US treatment; deferred items are explicit `Out of Scope` line items with refs

§6 lists every deferred Vision-Update item with the originating section reference (`Vision Update §1 / §13 item 4` for Parent dashboard; `Vision Update §10` for the 5 deferred answer-types). The runtime PRD ships only what the runtime needs and the rest stays as named, dated, traceable scope decisions — not as "we'll figure it out". Future PRDs can pick them up cleanly.

### C. The forward-compatible `AnswerControl<T>` interface in US-3 is the right defensive design

The PM saw "5 more answer-types coming per Vision Update §10" and shipped a TypeScript interface that the deferred 5 slot into without redesigning US-3. The "unknown enum value renders a hard error block, not a misleading control" AC is the kind of fail-safe a hand-off PRD often skips. The parallel "beyond-syllabus shows the same hard error block" defence-in-depth is exactly right — three layers of enforcement (assembly, figure-fetch, hint-fetch) is the constitution's "secure by default" priority done well.

### D. The `[UPDATED v2 — …]` inline tagging is the cleanest delta-document I've seen

Every changed AC carries an inline tag pointing at the v1 issue it addresses (`[UPDATED v2 — Blocker 1]`, `[UPDATED v2 — non-blocker 6]`, `[NEW v2 — US-10]`). The v1→v2 changelog at the top is a clean lookup table. As a reviewer doing delta-check #1 (per my role definition), this saved me 30+ minutes — I could verify each blocker's fix in one grep. Future PMs should copy this exact pattern.

### E. The "honest scope statements" in US-9 and US-10 model the right voice for the user

US-9 says, "A web app CANNOT prevent all cheating" — directly, in the PRD, not as a footnote. US-10 says, "Hints are AUTHORED per problem … for v1 ship, problems may have 0 hints; the runtime handles both cases gracefully." Both pre-empt the user's likely follow-up question and surface limitations clearly — exactly the "TALK-ONLY UX" rule the constitution wants. Surface these to MS directly.

### F. The five-table data-model extension (cohorts, cohort_members, test_assignments, plus the v1 test_sessions + test_session_snapshots) cleanly preserves §12 rule 3

`attempts` stays append-only and written ONCE at submit, reading from the transient `test_session_snapshots` table. `test_session_audit` is bounded (its retention is implied by the 30-day purge rule on snapshots; this could be tightened but isn't a blocker). The boundary between "in-flight, mutable" and "submitted, append-only" stays crisp through a 2× growth in the data model. This was the v1 review's "what's good A"; v2 keeps it intact.

### G. Open Questions are now decisions-or-questions, not a wishlist

v2 explicitly CLOSED Q2 (marking-scheme defaults) and Q9 (multi-device) with the rationale embedded. New Q12 (anti-cheat warning colour), Q13 (3-violation threshold confirmation), Q14 (hint position with figures) are scoped to "design lock-in" or "ship as 3" — they don't block engineering. This is the right shape for §9.

---

## Verdict

**advance to Stage 2**

The score is 9/10. Zero CRITICAL/HIGH security issues block per the constitution (NEW-1 is HIGH severity but is a topology leak with a clean Architect-side fix; not a "user can read another user's data" issue). All three v1 blockers are honestly fixed. The Vision-Update fold-in is disciplined. The PM has met the threshold and earned the advance.

### Brief for Stage 2 Architect

You inherit the v2 PRD as binding. The architecture-input-notes' existing Requirements **A–E** stay in scope. Add the following NEW requirements derived from this PRD:

- **Req F — Cohort/assignment/parent data model.** Land `cohorts`, `cohort_members(student_id, cohort_id, joined_at, left_at?)`, `test_assignments(test_id, cohort_id?, student_id?, window_start_at, window_end_at, marking_scheme?, …)` with the `(cohort_id IS NULL) <> (student_id IS NULL)` CHECK constraint. Defer `parents` / `student_parents` to the Parent-dashboard future PRD but ensure the `students` table accommodates a future `parent_id` join without rework.
- **Req G — Hints column on `problems` + `attempts.hints_used` (already present).** `problems.hints: Json` storing `[{level: int, text: string, reveals_idea: bool}]`. NULL means hint_count=0.
- **Req H — `problems.syllabus_status: enum { WITHIN_SYLLABUS, BORDERLINE, BEYOND_SYLLABUS }`** (recommend enum over boolean per Vision Update §5).
- **Req I — `test_session_audit.violation_type` enum + `violation_timestamp`** plus the new `hint_level`, `requested_level`, `response_status` columns for hint-endpoint audit (per NEW-1).
- **Req J — Extend `AnswerType` enum** with the 5 deferred patterns (`MCQ_PASSAGE`, `NUM_DIGIT`, `MAT_LIST`, `MCQ_AR`, `FILL`) reserved-but-unused. Migration adds the values; client `AnswerControl` interface in US-3 is forward-compatible.
- **Req K — `student_drill_recommendations` log** (deferred to drill-recommender future PRD; reserve the slot now).
- **Req L (NEW from this review) — Hint-endpoint hardening.** Enforce `slot_index == active_slot` server-side via a `PUT .../active-slot` heartbeat; audit every hint call regardless of status code; consider constant-time-padded responses. See NEW-1 above.
- **Req M (NEW from this review) — Dashboard view = (current assignments) UNION (active sessions).** Active in-flight sessions stay visible on the dashboard even if the underlying assignment cohort membership changes. `cohort_members.left_at` column for audit. See NEW-2 above.
- **Req N (NEW from this review) — HMAC `session_secret` leak posture.** Choose single-use-with-nonce tokens OR document the accept-and-monitor stance. See NEW-4.
- **Req O (NEW from this review) — `auto_submit_source` race instrumentation.** Add `submission_metadata.also_triggered_by: text[]` to the `test_sessions` row, append-only; preserves teacher signal on the violation-vs-server-timer race. See NEW-5.
- **Req P (NEW from this review) — Marking-scheme MAT-COL gating rule.** Rewrite §8.4 MAT-COL block to express the "any wrong row gates partial credit" JEE-Adv 2023+ rule. See NEW-3.

The architect's existing schema work can run unblocked while the v3 user-only questions below are still open — none of them affect the data model.

### Open user-only questions (do NOT block Stage 2 advance; surface in parallel)

The v1 review surfaced 5 items only MS could answer. v2 closed three of them (#3 NUM-DEC rounding via the `@jee/numeric-normalise` decision, #4 marking-scheme defaults via JEE-Adv 2023+, #5 late-snapshots fairness via 5 s window). Remaining + new:

1. **Anti-cheat hard-lock vs hybrid (still nominally open).** Vision Update §3 picks hybrid; v2 PRD picks hybrid (3-violation auto-submit). I treat this as decided unless MS overrides. (v1 user-only Q1.)
2. **Assignment model granularity confirmation.** v2 ships cohort+individual. MS should confirm this fits the pilot. (v1 user-only Q2.)
3. **Open Q3 — Accent colour (calm blue vs warm orange).** Tone call. PM recommends calm blue; ship that unless MS says otherwise. Blocks: design lock-in only.
4. **Open Q4 — Geist vs Inter font.** PM recommends Geist; ship unless MS says. Blocks: design lock-in only.
5. **Open Q5 — Palette status colour saturation.** PM recommends calmer; ship unless MS says. Blocks: design lock-in only.
6. **Open Q10 — Pre-test instructions text.** Does MS have a canonical instructions block from his current portal, or does the Engineer draft? Blocks: instructions page copy (NOT engineering).
7. **Open Q12 (new) — Anti-cheat banner warning colour.** PM recommends placeholder #C45151. Ship unless overridden.

Items 3–7 are design-lock-in only and don't block Stage 2 advance. The Architect can proceed.

---

*End of Spec Critic review v2.*
