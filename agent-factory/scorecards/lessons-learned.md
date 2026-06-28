# Lessons Learned — Agent Factory

This file accumulates lessons from each project built with the Agent Factory pipeline.
The orchestrator reads this at the start of every new project and injects relevant lessons into agent prompts.

---

## Template Entry
```
### Project: [name] — [date]
**What worked:**
- [Pattern/approach that saved time or caught real issues]

**What didn't work:**
- [Approach that wasted iterations or missed real issues]

**Stage bottleneck:** [which stage took the most iterations and why]

**Surprise issue:** [something no agent caught until late, that should be caught earlier next time]
```

---

### Project: PRD-16 Student Test Runtime — 2026-06-28

**What worked:**
- Splitting Stage 3 into three parallel engineers (Migrations / Backend / Frontend) on disjoint file-sets. Same pattern at Stage 5 fix (3 parallel ops fixes) cut wall-clock by ~3×.
- Tester + UX Auditor in parallel at Stage 4 (independent evaluations per the master-orchestrator).
- "Carry-over" mechanic in scorecards — explicitly marking issues as "deferred to next stage with owner" prevented re-litigation. Stage 4 Tester correctly assigned the real-DB privilege test to Stage 5 Integrator instead of trying to write it in a unit-test environment.
- Design-lock doc (`16-test-runtime-design-lock-2026-06-26.md`) consolidated 7 UX micro-decisions out of the PRD into a single place — Engineer-Frontend could reference one short doc instead of mining the PRD.
- Composite scoring (lower-of-two-tracks rules) — Stage 4 looped back because UX 6.9 even though Tester 8/10. Single-axis gates would have shipped a broken UX.

**What didn't work:**
- v1 Engineer-Frontend silent data-loss bug (NEW-1) was found by Code Reviewer iter 2, not iter 1. Stages 3 reviewers should be told explicitly to probe "what happens when an external dependency (cookie, DB, network) is revoked mid-session?" as a first-class question. Added it to the engineer brief at v3.
- Migration ordering bug (Stage 5 NO-SHIP) wasn't caught until the Integrator ran `prisma migrate deploy` against a fresh DB. The Code Reviewer at Stage 3 read the migration SQL but didn't simulate the apply order. **Next project: require Migrations Engineer to run fresh-DB smoke as part of their own verify, not just the Integrator.**
- The `/dashboard` route 404 (UX HIGH-3) — three call sites referenced a route that was never built. A static link-graph check at Stage 3 review would have caught this. **Next project: Code Reviewer adds "every `router.push(X)` or `redirect(X)` target route exists" to its checklist.**

**Stage bottleneck:** Stage 3 took 3 iterations (the constitutional max), driven by Frontend complexity (telemetry queue + anti-cheat state machine + auth-error state machine). Frontend dominated wall-clock; Migrations and Backend were 1-2 iterations.

**Surprise issue:** Cross-side numeric divergence (`-0` collapse: backend `"0"` vs frontend `"-0"` for `-0.5 @ p=0`) was only caught when Tester wrote a shared cross-side fixture. A subtle answer-equality bug that would have caused legit student responses to be marked wrong. **Next project: any logic that runs on BOTH sides (validation, formatting, numeric) gets a shared fixture file at Stage 3, tested by both Backend and Frontend specs.**
