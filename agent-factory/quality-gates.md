# Quality Gates

## Gate Thresholds

| Stage | Min Score | Max Iterations | Escalation |
|-------|-----------|----------------|------------|
| 1. PRD | 7/10 | 3 | Ask user to resolve open questions |
| 2. Architecture | 7/10 | 3 | Ask user about constraints/tradeoffs |
| 3. Code Review | 7/10 | 3 | Ask user if acceptable to ship with known issues |
| 4. UX Audit | 7/10 | 3 | Show user the failing flows, get acceptance |
| 5. Integration | All checks pass | 1 | NO-SHIP → loop back to relevant stage |

## Escalation Protocol

When a stage fails to converge after max iterations:

1. **Compile**: List all unresolved blocking issues
2. **Categorize**: Which issues are requirements ambiguity vs. technical difficulty?
3. **Present to user**: 
   - "Stage X did not converge after 3 iterations."
   - "Remaining blocking issues: [list]"
   - "Options: (a) Accept these as known limitations, (b) Clarify requirements for [specific points], (c) Simplify scope by removing [specific features]"
4. **User decides**: Never auto-accept a failed gate.

## Score Convergence Rules

### Healthy Convergence
```
v1: 4/10 → v2: 6/10 → v3: 8/10  ✓ PASS (advancing)
```

### Stalled Convergence
```
v1: 5/10 → v2: 5/10 → v3: 5/10  ⚠ ESCALATE (not improving)
```

### Regressing
```
v1: 6/10 → v2: 4/10               ⚠ ALERT — generator is over-correcting
```
Regression means the generator broke something that was working while fixing something else. The orchestrator should:
1. Show the discriminator's delta report (what regressed)
2. Tell the generator: "Fix [new issues] WITHOUT reverting [previously fixed issues]"
3. If it regresses again, escalate to user

## Cross-Stage Dependencies

```
Stage 1 (PRD) ──────────────────────┐
    │                                │
    ▼                                │
Stage 2 (Architecture) ─────────────┤
    │                                │
    ▼                                │ (all feed into)
Stage 3 (Implementation) ───────────┤
    │                                │
    ▼                                │
Stage 4 (Testing) ──────────────────┤
    │                                │
    ▼                                │
Stage 5 (Integration) ◀─────────────┘
```

If Stage 5 finds a problem traceable to Stage 1 (bad requirement), the loop goes back to Stage 1, not Stage 3. Fix the root cause, not the symptom.

## Emergency Skip Rules
The user (and ONLY the user) can override a gate with:
- "Skip this gate" → advance with a warning logged to the scorecard
- "Good enough" → advance, lower the threshold to current score for this project
- "Abandon stage" → skip this stage entirely (logged as SKIPPED in final scorecard)

The orchestrator CANNOT skip gates on its own. Ever.
