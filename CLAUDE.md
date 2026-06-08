# Project: jee_platform

This is the single source of truth for how to work on this project.

## How to work here (read this first, every session)
For ALL build, code, design, testing, or review work on this project:
1. First read `agent-factory/CLAUDE.md`.
2. Then read every file inside `agent-factory/` (agents/, master-orchestrator.md,
   quality-gates.md, feedback-protocol.md, templates/, scorecards/).
3. Follow that pipeline and its rules for everything from here on.

The agent-factory rules govern this entire repository, including `backend/`,
`frontend/`, `content/`, `docs/`, and `scripts/`.

## Project layout (quick map)
- `agent-factory/` — the build system + rulebook (start here)
- `backend/`  — NestJS + Prisma API
- `frontend/` — the web app
- `content/`  — content/data
- `docs/`     — documentation
- `scripts/`  — utility scripts

## Non-negotiables (also enforced inside agent-factory)
- Priority order when goals conflict: correct & error-free > secure > fast to
  ship > looks.
- Never hardcode secrets — read from env vars; keep `.env` gitignored.
- The user directs this project by chat and does not read code, so carry every
  good habit on their behalf and describe results in plain language.

If any other CLAUDE.md exists higher up the folder tree, the rules in
`agent-factory/` take precedence for this project.
