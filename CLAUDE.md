# JEE Practice Platform — Session Bootstrap

> **Every Claude Code session in this repo MUST start by reading [docs/PROJECT CONTEXT.md](docs/PROJECT%20CONTEXT.md).** That document is the binding single source of truth for what we are building and why. The summary below is a quick-reference; the full document overrides it on any conflict.

## What we're building (60-second version)

A JEE Advanced practice/testing platform with three connected parts:

1. **Question factory** — Claude generates original JEE-Advanced-level questions, each tagged with its full 7-axis identity and authored difficulty rating.
2. **Question database** (Postgres) — every problem stored together with its identity + rating. The DB cannot hold a bare problem.
3. **Testing website** (Next.js) — student / teacher / admin role logins; teachers describe a test "of a particular variety" and the system auto-assembles it from the bank; students take it; per-question timing is captured on every attempt and feeds the difficulty-rating feedback loop.

Maths first, then Physics, then Chemistry. Architect the data model for 1 lakh students from day one; grow infrastructure on evidence.

## The 7-axis question identity (memorise)

`TOPIC . SUBTOPIC . IDEA . SUB-IDEA . ANSWER-TYPE . SURFACE . TRAP` + serial → e.g. `CAL.DEF.SYMM.EVEN.001`. All seven are **separate, indexed columns** on `problems`. IDEA is the most important axis. SURFACE (presentation) and TRAP (bait) are deliberately kept separate from IDEA (math) so the diagnostic signal isn't blurred. No "miscellaneous" tags — extend the taxonomy instead.

## The difficulty model

- **Intrinsic T1–T5** — fixed forever, anchored to exam-day demand at top-10-rank benchmark.
- **R1–R4** (First Prep → First Revision → Second Revision → Final Round) — per-student, per-fingerprint state. NOT an 8th axis of problem identity.
- **Authored difficulty** at creation (intrinsic + expected time per round) vs **empirical difficulty** (computed in a batch job once ~30+ attempts exist). The gap is itself a useful signal.

## Non-negotiables (every session, no exceptions without explicit approval)

1. **Read `docs/PROJECT CONTEXT.md` first.** §12 lists 12 binding principles.
2. **7-axis identity + difficulty travel with every question from creation.** No bare problems in the DB.
3. **`attempts` is append-only.** Never UPDATE or DELETE rows in it.
4. **Tests store question codes, not problem copies.** One source of truth.
5. **Per-question timing capture is mandatory from v1 of the test runtime** — impossible to reconstruct later.
6. **Empirical ratings: batch job only, never computed live.** Reads stay instant.
7. **Secrets never in code or git.** `.env` locally (gitignored), host secret manager in production.
8. **Backend is stateless.** Scale by adding instances.
9. **Design the data model for 1 lakh students now; grow infra on evidence.**
10. **Explain as you build.** Human reviews and approves.
11. **One thing at a time.** No scope creep mid-session — note new ideas, keep building.
12. **Build for the median student; keep measurement honest.** No composite "readiness scores."

## Tech stack (agreed; do not substitute without discussion)

Node.js + TypeScript • NestJS (backend) • Next.js + React (frontend) • PostgreSQL • Prisma (ORM + migrations) • Docker • KaTeX/MathJax for LaTeX • Anthropic API for runtime AI features • GitHub + GitHub Actions • Sentry + UptimeRobot for monitoring • Vercel (frontend) + managed Postgres (Neon/Supabase/RDS) + container host (Render/Railway/AWS).

Python only for the data-science / feedback batch scripts.

## Division of labour (§11)

- **Only the human can:** create accounts, make payments, hold secrets, run/approve commands, install software, click cloud dashboards, make judgement calls (question quality, scope, taxonomy).
- **Claude does:** all code, all question generation with full identity + rating, all schema/API/taxonomy design, all tests/debugging, all deployment config, all explanation.

Pattern: **Claude produces the work; the human owns accounts, money, secrets, and the final yes.**

## Current build stage

Per §13 of PROJECT CONTEXT.md and the §8 build sequence:

- **Stage 1 — Scaffold the monorepo: DONE** (2026-05-23). NestJS backend on :4000, Next.js frontend on :3000, `.gitignore`, `.env.example`, initial commit pushed to `github.com/mrinalsingh/jee-platform`.
- **Stage 2 — The data model: NEXT.** Prisma schema for the 4–5 tables in §6 (problems / students / student_fingerprint_state / tests / attempts), with the 7 fingerprint axes as separate indexed columns on `problems`, and the `attempts` table indexed for tens of millions of rows.

When in doubt about anything: re-read `docs/PROJECT CONTEXT.md`. It governs.
