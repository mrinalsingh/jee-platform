# Agent Factory

A multi-agent orchestration system for Claude Code that builds software through adversarial quality loops.

## How It Works

```
User Request → PM → Spec Critic → Architect → Design Critic → Engineer → Code Reviewer → Tester → UX Auditor → Integrator → Delivered Product
                ↑_______|            ↑_________|              ↑__________|           ↑_________|
              GAN Loop 1           GAN Loop 2               GAN Loop 3             GAN Loop 4
```

Every artifact passes through a **generator → discriminator** loop (like a GAN). The discriminator scores 1-10 and provides structured feedback. If score < 7, the generator revises. Max 3 iterations per stage before escalating to the user.

## Setup

1. Copy this entire `agent-factory/` folder to your machine
2. Open Claude Code in any project directory
3. Tell Claude:
   ```
   Read C:\Users\USER\agent-factory\CLAUDE.md and all files in agent-factory/. 
   Then build: [your request]
   ```

Or place the `agent-factory/` folder inside your project and Claude Code will auto-read the `CLAUDE.md`.

## Directory Structure

```
agent-factory/
├── CLAUDE.md                      # Auto-loaded entry point
├── master-orchestrator.md         # Full pipeline definition
├── quality-gates.md               # Score thresholds & escalation rules
├── feedback-protocol.md           # How discriminator feedback works
├── agents/
│   ├── product-manager.md         # Generator: requirements → PRD
│   ├── spec-critic.md             # Discriminator: find spec gaps
│   ├── architect.md               # Generator: technical design
│   ├── design-critic.md           # Discriminator: architecture audit
│   ├── engineer.md                # Generator: build code
│   ├── code-reviewer.md           # Discriminator: code review
│   ├── tester.md                  # Generator: write & run tests
│   ├── ux-auditor.md              # Discriminator: user experience audit
│   └── integrator.md              # Final gate: ship/no-ship verdict
├── templates/
│   ├── prd-template.md            # PRD output format
│   └── test-plan-template.md      # Test plan output format
└── scorecards/
    └── lessons-learned.md         # Accumulates insights across projects
```

## Agent Roles

| Agent | Type | Role | Checks |
|-------|------|------|--------|
| Product Manager | Generator | Write PRD from user request | Completeness, user flows, edge cases |
| Spec Critic | Discriminator | Review PRD adversarially | Ambiguity, gaps, user perspective, adversarial |
| Architect | Generator | Design tech architecture | Data model, APIs, security, deployment |
| Design Critic | Discriminator | Audit architecture | PRD compliance, failure modes, over-engineering |
| Engineer | Generator | Write production code | Follows architecture, no stubs, secure |
| Code Reviewer | Discriminator | Review code | Correctness, security (OWASP), architecture compliance |
| Tester | Generator | Write and run tests | Unit, integration, E2E, regression |
| UX Auditor | Discriminator | Walk all user flows | Usability, accessibility, emotional journey |
| Integrator | Final Gate | Ship/no-ship verdict | Build, tests, all scores, deployment readiness |

## Usage Modes

- **Full build**: "Build me X" → runs all 5 stages
- **Spec only**: "Spec only for X" → Stage 1 only (PM + Spec Critic loop)
- **Review existing code**: "Review this code" → Stages 4-5 (Tester + UX Auditor + Integrator)
- **Test only**: "Test this" → Stage 4 only (Tester + UX Auditor)

## Customization

- Adjust score thresholds in `quality-gates.md` (default: 7/10 to pass)
- Add domain-specific review lenses to discriminator agents
- Modify templates for your org's documentation standards
- Edit `CLAUDE.md` to change default behavior

---

## How to run this in Claude Code (merged version)

This package merges the original Agent Factory with a constitution layer (priority
order, security-as-blocking, secrets hygiene, and talk-only UX) baked into
`CLAUDE.md`, the Engineer agent, and the Code Reviewer agent. All original files
are unchanged except those three.

### Install
1. Put the whole `agent-factory/` folder at the root of your project (or anywhere
   Claude Code can read). Claude Code auto-loads a root `CLAUDE.md`; if the folder
   is nested, tell Claude to read `agent-factory/CLAUDE.md` first.
2. (Optional power-ups, run once inside Claude Code, then restart it)
       /plugin marketplace add obra/superpowers-marketplace
       /plugin install superpowers@superpowers-marketplace
       /plugin install frontend-design@claude-plugins-official

### Use
In a Claude Code session at your project root, say:
> Read agent-factory/CLAUDE.md and all files in agent-factory/. Then build: <your idea>.
> Follow the full pipeline and show me scores after each stage.

### Confirm it's working (what you should see)
- It writes a PRD to `scorecards/01-prd-draft-v1.md`, then a Spec Critic review to
  `scorecards/01-prd-review-v1.md` with a Score: X/10 block.
- It does NOT advance any stage on a score < 7 without asking you.
- It shows you a scorecard after each of the 5 stages.
- Stage 5 ends with a SHIP / NO-SHIP verdict in `scorecards/05-integration-final.md`.
- Any hardcoded secret or missing auth check shows up as a CRITICAL/HIGH blocker.
If those artifacts and score blocks appear, the orchestration is running correctly.

> Note: `export.ps1` is a Windows-only helper for re-zipping the folder; it is not
> needed to run the system and can be ignored on macOS/Linux.
