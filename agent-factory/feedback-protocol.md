# Feedback Protocol — Reinforcement Learning System

## Core Principle: GAN Dynamics
Generators create. Discriminators destroy (constructively). The orchestrator balances the tension. Quality emerges from the adversarial loop, not from any single agent being "smart enough."

---

## Feedback Format (All Discriminators)

Every discriminator output MUST follow this exact structure:

```markdown
## Score: X/10

## Blocking Issues (must fix)
1. [CRITICAL] **Title**
   - Location: `file:line` or section reference
   - Problem: What's wrong (observable behavior, not opinion)
   - Impact: What breaks for the user or system
   - Fix: Concrete suggestion (not "make it better")

## Non-Blocking Issues (should fix)
1. [MEDIUM] **Title**
   - Location: ...
   - Problem: ...
   - Fix: ...

## Positive Signals (must include ≥ 2)
1. **Title** — what was done well and WHY it's good
2. **Title** — ...

## Iteration Delta (v2+ only)
### Fixed since last review
- Issue #X: [status] ✓
### Still open
- Issue #Y: [status] — was it attempted? What's still wrong?
### New issues found this round
- Issue #Z: [new]
```

### Why positive signals are mandatory:
Without positive reinforcement, generators learn to be conservative and bland. "Don't break anything" produces mediocre output. "Keep doing X, stop doing Y" produces excellent output.

---

## Reinforcement Loops

### Short Loop: Within a Stage
```
Generator v1 → Discriminator review → Generator v2 → Discriminator review → ...
```
The discriminator's feedback IS the reward signal. Generators should:
- Maximize: fixing blocking issues, maintaining positive signals
- Minimize: introducing new issues, regressing previously-fixed issues

### Long Loop: Across Projects (Lessons Learned)
After each project completes, the Integrator appends to `scorecards/lessons-learned.md`:
- Patterns that worked → reinforce in future project prompts
- Patterns that failed → warn against in future project prompts
- Time sinks → identify stages that took the most iterations and why

The orchestrator reads `lessons-learned.md` at project start and injects relevant lessons into agent prompts.

### Meta Loop: System Improvement
After every 3-5 projects, the user should review `lessons-learned.md` and update:
- Agent role definitions (if an agent consistently misses something)
- Quality gate thresholds (if too strict or too lenient)
- Templates (if outputs are missing a section that keeps coming up)

---

## Discriminator Calibration

### The "Two Engineer" Test
An issue is BLOCKING if: two reasonable engineers, given the same spec, would agree it must be fixed before shipping.

An issue is NON-BLOCKING if: reasonable engineers might disagree on whether to fix it now.

### Score Anchoring
To prevent score inflation/deflation across iterations:
- v1 score should reflect the ABSOLUTE quality (not relative to expectations)
- v2+ scores should reflect improvement from v1, not from "what I expected after my feedback"
- A v1 score of 4/10 that improves to 7/10 in v2 is BETTER than a v1 score of 6/10 that stays 6/10 in v2

### Disagreement Protocol
When a generator disagrees with a discriminator:
1. Generator states disagreement with reasoning in output summary
2. Discriminator in next round MUST address the disagreement (concede or counter)
3. If deadlocked after 2 rounds, orchestrator presents both arguments to user
4. User decision is final and recorded in the scorecard

---

## Information Flow Between Stages

### Forward Flow (Generator → Next Stage)
Each stage produces artifacts that feed the next:
- Stage 1 → PRD document → feeds Stage 2, 3, 4, 5
- Stage 2 → Architecture doc → feeds Stage 3, 4, 5  
- Stage 3 → Source code → feeds Stage 4, 5
- Stage 4 → Test results + UX report → feeds Stage 5

### Backward Flow (Discriminator → Previous Stage)
When a later-stage discriminator finds a root cause in an earlier stage:
- Code Reviewer finds the architecture is wrong → loop to Stage 2 (not just fix the code)
- UX Auditor finds a missing requirement → loop to Stage 1 (not just add a screen)
- Integrator finds anything → loop to the earliest affected stage

### Cross-Pollination
The orchestrator may inject cross-stage context:
- "The Code Reviewer noted that endpoint X has no rate limiting — Architect, did you intend this?"
- "The UX Auditor found that Flow Y has no loading state — PM, was this in scope?"
