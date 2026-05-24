# PROJECT CONTEXT — JEE Practice & Testing Platform

> **Purpose of this file.** This is the master context document for the project. Any Claude Code session working in this repository should read this file first. It captures the full vision, architecture, data model, design decisions, and build sequence agreed during planning. It is the single source of truth for *what* we are building and *why*. When in doubt, follow this document.

-----

## 1. THE VISION

We are building a company that helps students reach their potential across all of PCM (Physics, Chemistry, Maths) for the JEE Advanced exam. **We build for Maths first**, then replicate for Physics and Chemistry.

The product is a **JEE practice and testing platform** with three connected parts:

1. **A question factory** — original JEE-Advanced-level questions are generated (by Claude, from source materials). Every question is created together with its full 7-dimension identity and a difficulty rating.
1. **A question database** — the central store. Every question lives here *with* its identity and rating; the database cannot hold a question without them.
1. **A testing platform (website)** — role-based logins for students, teachers, and admins. Teachers/admins describe a test “of a particular variety”; the system automatically selects matching questions from the database and assembles the test. Students take tests; their responses and per-question timing are captured and flow back to make difficulty ratings empirically true over time.

**Scale ambition:** the platform should be architected from day one to eventually handle ~1,00,000 students. Build the *data model* for that scale immediately (it costs nothing extra and cannot be retrofitted); grow the *infrastructure* on evidence, not guesses.

-----

## 2. CORE PHILOSOPHY

- **Performance improvement is a measurement problem.** If we cannot measure a student’s true state on every relevant dimension, we cannot improve it. Most coaching measures one dimension (mock score); that is why it fails the non-top student.
- **Build for the median student, not just the top 1%.** The top 1% is self-motivated and needs depth; the median 99% needs structure, measurement, and accountability. The real scale and impact is in serving the median well — without ceiling-ing out the top.
- **The shiny AI piece is ~15% of the system.** The other 85% is taxonomy, measurement, honest feedback loops, and (eventually) the human mentor layer. Build the unglamorous 85% with discipline.
- **Honesty of measurement is sacred.** Every metric must be re-measurable. Composite “readiness scores” are lies — show real dimensions. Effort (hours studied) is not a parameter.

-----

## 3. WHAT JEE ADVANCED MATHS ACTUALLY TESTS

Weightage (use to balance content and tests): Calculus ~35%, Algebra ~30%, Coordinate Geometry ~20%, Vectors+3D ~15%, Trigonometry ~10%.

**The 7 question-construction signatures** (questions should reflect these; they inform the TRAP and SURFACE axes):

1. Set-notation dressing — heavy notation as a packaging device; the underlying problem is simpler than it looks.
1. Parameters as the real unknowns — letters make problems feel abstract; the task is finding specific values.
1. “Inspired by, not requiring” — problems look like they need advanced tools (Cayley-Hamilton, eigenvalues) but solve via standard methods. Reaching outside the syllabus = being baited.
1. Two-concept fusion is the norm; three-concept is rare.
1. Multi-correct questions are calibrated for partial-marking play.
1. Numerical-answer questions are “gifts” — no negative marking; a strange multiplier signals clean computation.
1. Pathological functions (sin(1/x), |x|, piecewise at 0) test precise theorem statements, not technique.

-----

## 4. THE 7-AXIS QUESTION IDENTITY SYSTEM

Every question gets a unique multi-axis fingerprint. Matching core axes ⇒ similar question; all axes match ⇒ replica. **The 7 axes are stored as separate, indexed columns on the problems table** — never as an afterthought.

- **Axis 1 — TOPIC** (~12 values): `ALG, PNC, PRB, MAT, TRG, CAL, COG, VEC, TDG, SET, SOT, LOG`.
- **Axis 2 — SUBTOPIC** (~5–8 per topic; the chapter section). E.g. for CAL: `FUN, LIM, CON, DIF, DER, IND, DEF, ARE, ODE`.
- **Axis 3 — IDEA** (the principle being tested; the MOST important axis). E.g. for CAL.DEF: `PROP, SYMM, KING, LEIB, GIF, SUMINT, INEQ, BETA`.
- **Axis 4 — SUB-IDEA** (the specific manoeuvre; ≤6 per idea). E.g. under SEQ.TEL: `TEL-PARTIAL, TEL-DIFF, TEL-TRIG, TEL-INVTRIG, TEL-LOG`.
- **Axis 5 — ANSWER-TYPE**: `MCQ-SC, MCQ-MC, NUM-INT, NUM-DEC, MAT-COL`.
- **Axis 6 — SURFACE** (cognitive-load dressing, NOT the math): `SURF-PLAIN, SURF-SET, SURF-FUNC, SURF-GEOM, SURF-PARAM, SURF-PASS`.
- **Axis 7 — TRAP** (the bait): `TRAP-NONE, TRAP-EIGEN, TRAP-CAYLEY, TRAP-LHOP, TRAP-NCERT, TRAP-EDGE, TRAP-PARTIAL, TRAP-LENGTH`.

**A full question code** looks like: `CAL.DEF.SYMM.EVEN.001` (fingerprint + serial).

**Matching tiers:**

- *Same essence* = match on axes 1–4 ⇒ usable as parallel forms (B, C) for mastery checks.
- *Similar* = match on axes 1–3 ⇒ variety practice (complement, not substitute).
- *Replica* = all 7 axes match + overlapping content ⇒ flag and remove as duplicate.

**Design rule:** SURFACE and TRAP are kept *separate* from IDEA. A student weak on SURF-SET has a language problem; one who falls for TRAP-CAYLEY has a strategy problem. Lumping them destroys the diagnostic signal. **No “miscellaneous” tags** — if a question doesn’t fit, extend the taxonomy.

### How to identify the IDEA of a problem

An idea is the smallest insight such that — with it, the problem is routine; without it, impossible regardless of computational skill. Process: (1) solve it and watch for the “ah, I see it” moment; (2) name the idea at the altitude where a different problem with the same idea is solved the same way; (3) stress-test against 3 related problems; (4) try to falsify the label. Avoid confusing topic-with-idea, technique-with-idea, or tagging the “elegant” idea instead of the *limiting* one.

-----

## 5. THE DIFFICULTY MODEL

### Intrinsic difficulty (T1–T5) — fixed forever

Anchored to exam-day demand. Used for comparison across time.

- T1 easy standard, T2 standard medium, T3 hard standard, T4 hard non-standard, T5 top-100 only.

**Authored difficulty benchmark:** every question is rated for difficulty as experienced by *a top-10-rank-level student in their last 4–5 months of preparation*. This is the agreed reference point for the authored rating.

### Perceived difficulty

`Perceived = Intrinsic − Student's mastery`. A problem feels easy when rising mastery closes the gap to its fixed demand.

### The R1–R4 round model

Difficulty depends on the *student’s stage of preparation*, not the problem alone. Rounds are a per-student, per-fingerprint attribute — NOT an 8th axis of problem identity.

- **R1 First Prep** — learning the idea; near-zero mastery.
- **R2 First Revision** — consolidation; “seen it” → “can do it reliably”.
- **R3 Second Revision** — integration; two-concept fusion, speed, surface variation.
- **R4 Final Round** — optimization; exam simulation, strategy, retention.

Four levers change per round (the problem itself stays the same): inclusion (which problems to show), time expectation (same problem, solved faster each round), expected role (teaches idea→speed→triage), pass/fail threshold (rises each round).

### Authored vs empirical ratings

- **Authored rating** = the hypothesis assigned at creation time (intrinsic T-rating + expected time per round).
- **Empirical rating** = computed from real student attempt data once a problem has ~30+ attempts. Empirical difficulty = success rate among students at/above the problem’s intended round; empirical time = *median* time among students who answered *correctly*.
- Difficulty is **round-conditional** — store it as a small per-round table, never a single number.
- The gap between authored and empirical ratings is itself useful — it measures and improves authoring intuition.

-----

## 6. THE DATA MODEL — FOUR (FIVE) CONNECTED TABLES

This is the foundation. The schema outlives every other decision. Design it carefully.

### `problems`

- `question_code` (unique) — fingerprint + serial.
- `statement` (LaTeX text), `answer`, `solution`, `wrong_paths`.
- The **7 fingerprint axes as separate, indexed columns**.
- `authored_difficulty` (T1–T5), `authored_time_by_round` (JSON: R1–R4 expected times).
- `empirical_difficulty_by_round` (JSON, nullable), `empirical_time_by_round` (JSON, nullable).
- `status` (`provisional` / `calibrated`), source metadata, timestamps.

### `students`

- Identity fields, `target_rank`, timestamps.

### `student_fingerprint_state`

- One row per student per fingerprint: `student_id`, `fingerprint`, `round` (R1–R4), `mastery_score`.

### `tests`

- `id`, `title`, **ordered list of question codes** (JSON array — codes, NEVER copies of problems), `duration_seconds`, `marking_scheme` (JSON), timestamps.

### `attempts` — APPEND-ONLY (the ground truth)

- One row per student-per-question-per-attempt: `student_id`, `question_code`, `test_id` (nullable), `correct` (boolean), `time_seconds`, `visit_count`, `marked_for_review`, `attempt_order`, `round_at_time`, `hints_used`, `created_at`.
- **Never edited.** This table is the bridge between problems and students and the fuel of the feedback loop.

### Indexing (decide at schema time)

- `attempts`: index on `student_id`, on `question_code`, on `created_at` (this table reaches tens of millions of rows at scale).
- `problems`: index on each of the 7 fingerprint axes (test-building queries filter on these).
- `student_fingerprint_state`: index on `student_id`.

-----

## 7. THE TECH STACK (agreed)

- **Language/runtime:** Node.js + TypeScript for backend and frontend. Python only for the data-science / feedback scripts.
- **Database:** PostgreSQL.
- **Backend framework:** NestJS.
- **Frontend framework:** Next.js (React). LaTeX rendered with KaTeX or MathJax.
- **ORM / migrations:** Prisma.
- **Version control:** Git + GitHub (private repo).
- **Containerisation:** Docker.
- **Claude integration:** Anthropic API for runtime smart features; Claude Code for development.
- **Hosting (deployment phase):** managed Postgres (Neon / Supabase / RDS); container host (Render / Railway / AWS); frontend on Vercel. CI/CD via GitHub Actions; monitoring via Sentry + UptimeRobot.

**Repository structure (monorepo):** `/backend`, `/frontend`, `/scripts`, `/content`, `/docs`.

-----

## 8. THE BUILD SEQUENCE (do not skip stages)

The platform is built in this order. Each stage has a Definition of Done; do not proceed until it is met.

1. **Scaffold the project** — monorepo structure, empty NestJS backend + Next.js frontend, `.gitignore`, `.env.example`, connected to GitHub. *(Kickstart Week 1.)*
1. **The data model** — the four/five tables above, indexed for scale, via Prisma. The most important stage. *(Week 2.)*
1. **The question-intake pathway** — the workflow: Claude generates each original question WITH its 7-axis identity and authored difficulty rating; an idempotent importer script loads `/content` files into the `problems` table.
1. **Fill the problem bank** — generate fingerprinted, rated questions in small batches (2–3 source problems at a time), starting with Calculus. Runs in parallel with later stages.
1. **The backend API** — thin, stateless, tested. Endpoint groups: Auth (student/teacher/admin roles, JWT), Problems (fetch by code, query by fingerprint), Tests (create/fetch), Attempts (the critical append-only write endpoint), Students (fingerprint-state).
1. **The automatic test-selection feature** — teacher/admin describes a test “of a particular variety”; system does constraint-satisfaction over the fingerprinted bank and assembles a balanced test. Reuse via saved test templates.
1. **The testing website** — Next.js app, three role-based logins. Students see/take assigned tests; teachers/admins use the test-builder. The test runtime has a timer and a **capture layer** that silently records per-question time, visit count, review flag, attempt order. Per-question timing capture is NON-NEGOTIABLE from v1.
1. **The feedback loop** — a scheduled (nightly) Python batch job reads `attempts`, computes empirical ratings per round, writes them back to `problems`, produces a discrepancy report. Never computed live.
1. **Deployment** — managed DB, containerised backend, frontend on Vercel, CI/CD, monitoring, backups.
1. **Pilot, then grow** — 20–50 real students; absorb lessons; expand bank across all Maths topics; then Physics, then Chemistry.

**Roughly 6 months to a live, self-improving v1** with one person coding alongside Claude. The bottleneck is human review, sequencing, the build-test-fix loop, and pilot lessons — not code generation.

-----

## 9. THE CONTENT-GENERATION WORKFLOW

How the problem bank is built (Claude’s core ongoing role):

- One **Claude Project per topic** (Calculus, Algebra, …). Each Project’s knowledge holds: source PDFs, the topic’s fingerprint taxonomy, a style guide (3–5 model problems), a running log of what is already generated.
- Work in **batches of 2–3 source problems**. For each batch, Claude: (1) fingerprints each source problem; (2) states the core idea in one sentence (“solvable iff the student sees that ___”); (3) generates a *fresh, original* JEE-Advanced-level problem preserving the idea; (4) returns the full record — statement, answer, solution, 2–3 wrong paths, authored T-rating, per-round times, full fingerprint; (5) flags same-essence / duplicate relationships.
- The human reviews every batch and approves. Approved problems become structured data files in `/content`.
- **Source PDFs are raw material, never inventory.** The bank holds only fresh, original problems with clean provenance. Keep source PDFs out of the database entirely.
- Small batches matter: bulk generation causes “idea drift.” Honest human review is the quality gate and the real bottleneck — protect it.

-----

## 10. SCALING TOWARD 1 LAKH STUDENTS

Nothing is rebuilt to scale. Capacity is added on monitoring evidence, in this order: read replicas for Postgres → more stateless backend instances behind a load balancer → a Redis caching layer → a job queue (BullMQ) → table partitioning for `attempts` → a CDN (Vercel provides this). The append-only / stateless / batch-computed / codes-not-copies design choices exist specifically to make this growth smooth.

-----

## 11. DIVISION OF LABOUR

**Only the human can:** create accounts; make payments; hold and place secrets (API keys, DB passwords) — store them in a password manager, never in code; run and approve commands; install software on the Mac; click through cloud-service dashboards; make all judgement calls (question quality, scope, taxonomy approval, pilot timing).

**Claude does as work product:** write all code (backend, frontend, schema, scripts); generate all questions with full identity + rating; design structures (tables, API, taxonomy); build all features; write and run automated tests; debug and fix; write deployment configuration; explain everything.

Pattern: **Claude produces the work; the human owns the accounts, money, secrets, and the final yes.**

-----

## 12. NON-NEGOTIABLE PRINCIPLES (for every Claude Code session)

1. **Never skip a Definition of Done.** A half-finished step compounds into a broken project.
1. **The 7-axis identity and the difficulty rating travel WITH every question** — from the moment it is created. The database must not hold a question without them.
1. **`attempts` is append-only.** Never edit or delete attempt rows.
1. **Tests store question codes, not problem copies.** One source of truth.
1. **Per-question timing capture is mandatory from v1** of the testing app — it is impossible to reconstruct later.
1. **Empirical ratings are computed in a batch job, never live.** Reading ratings stays instant.
1. **Secrets never go into code or into Git.** Use `.env` (git-ignored) locally and the host’s secret manager in production.
1. **Backend is stateless** — no per-session memory; scale by adding instances.
1. **Design the data model for 1 lakh students now; grow infrastructure on evidence.**
1. **Explain as you build.** The human reviews and approves; keep them informed.
1. **One thing at a time.** No scope creep mid-session — note new ideas, keep building.
1. **Build for the median student; keep measurement honest.**

-----

## 13. IMMEDIATE NEXT STEP

The project is at **Stage 1 / Kickstart Week 1**: scaffold the monorepo. After it: Stage 2 — the data model (the most important stage).

*End of project context. Read this file at the start of every Claude Code session.*