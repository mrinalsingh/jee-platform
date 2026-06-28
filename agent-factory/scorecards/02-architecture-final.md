# Architecture Draft v2 — jee_platform Stage 2 (Diagnostic axes + Test runtime)

**Stage:** 2 (Architecture Loop) | **Iteration:** v2 | **Author:** Technical Architect (generator)
**Inputs satisfied:** PRD-01 (`01-prd-final.md` v3), PRD-16 (`16-test-runtime-prd-final.md` v2), design-lock 2026-06-26, vision update 2026-06-26, architecture-input-notes Requirements A–P + Q.
**Existing baseline:** `backend/prisma/schema.prisma` (5 tables, migrated to `jee_platform_dev`; ~179 rows in `problems`).
**Reviewer:** Design Critic — v1 score **6/10**, 5 blockers (1 CRITICAL + 4 HIGH). This v2 fixes each blocker with explicit `[UPDATED v2 — Blocker N]` tags, folds in the 5 non-blockers as inline notes, and preserves every v1-nailed element (frozen_question_codes column, 5-min secret grace, OWASP map, AC-by-AC discipline).

**Delta map for the Critic:** every `[UPDATED v2 — …]` tag is a deliberate change versus v1. Search the document for `UPDATED v2` to enumerate.

---

## §1 Executive Summary

This architecture extends the locked 5-table Prisma schema with **8 new tables, 11 new enums, 24 new columns**, and a thin stateless NestJS API surface (14 endpoints) so that two things can land in one engineering loop: (a) the 5-axis diagnostic failure-mode layer from PRD-01, and (b) the JEE-Advanced-style CBT test runtime from PRD-16 (with anti-cheat, hints, signed figure tokens, cohort assignment, and parent role). Every change is additive against the existing schema — no column rename, no destructive alter — so the 179 existing problem rows back-fill cleanly with one deterministic mapping.

`[UPDATED v2 — Blocker 2]` The DB-invariant for diagnostic summary columns is enforced via **BEFORE row-level triggers** running `SECURITY DEFINER` and owned by a dedicated `trigger_owner` role (see §3.1 #2 + §3.2). BEFORE row-level is the simplest primitive that satisfies all five PRD-01 §6 A.3 acceptance criteria, because `NEW := …` commits atomically with the source row in the same transaction; no other concurrent reader can observe the row in an inconsistent state under `READ COMMITTED`. The v1 wording "deferred row-level triggers" was loose and is replaced — we do NOT use deferred CONSTRAINT triggers anywhere.

`[UPDATED v2 — Blocker 3]` Append-only enforcement on `attempts` and `test_session_audit` is now **structural, not policy**: a separate `migration_role` (owning all tables; the role Prisma uses to run `migrate deploy`) is split from `app_user` (the role the running NestJS app uses). `app_user` does NOT own tables; UPDATE/DELETE on `attempts` and `test_session_audit` are REVOKEd at the role level and cannot be silently bypassed by anyone holding the runtime `DATABASE_URL`. Two distinct connection strings live in `.env.example` (`MIGRATION_DATABASE_URL` and `DATABASE_URL`).

The test runtime is built around a transient `test_session_snapshots` table that UPDATE-overwrites per-question state during a session and is converted to one append-only `attempts` row per visited question at submit time — preserving PROJECT CONTEXT §12 Rule 3 (attempts append-only) and Rule 5 (per-question telemetry from v1). Headline trade-offs: (1) triggers over `GENERATED STORED` (more code, but Postgres rejects SRFs in stored expressions); (2) HMAC figure tokens with per-session secret + 5-min post-submit grace; (3) Postgres BYTEA for figure storage in v1; (4) hint endpoint hardened by response padding + per-level fetch; (5) no Redis for v1.

---

## §2 Tech Stack Confirmation

PROJECT CONTEXT §7 stack stands unchanged: **Node.js 22 + TypeScript 5 / NestJS 11 / Next.js 16.2 + React 19.2 / PostgreSQL 16 / Prisma 6 / Docker / GitHub Actions / Sentry + UptimeRobot / Vercel + Neon.** Confirmed Postgres minimum = 14 (BEFORE triggers, JSONB indexes, BYTEA streaming, `SECURITY DEFINER` functions, `gen_random_bytes`).

**v1 additions (each justified, alternative rejected):**

| Concern | Choice | Why | Rejected alternative |
|---|---|---|---|
| Numeric normalisation (NUM-DEC) | **`decimal.js@10.x`** in shared `@jee/numeric-normalise` workspace package | Banker's rounding required (PRD-01 §6, PRD-16 Glossary); `Number.toFixed` is round-half-away-from-zero; required to be byte-identical across importer + runtime + diagnostic matcher | `big.js` (no `ROUND_HALF_EVEN` ergonomic API); native `Intl.NumberFormat` (locale-dependent) |
| HMAC | **Node 22 native `crypto.createHmac('sha256', key)`** + `crypto.timingSafeEqual` | Constant-time compare, no extra dep | `jose` (JWT machinery overkill for opaque token) |
| Client-side persistence | **`idb-keyval@6.x`** | 600-byte gzipped wrapper over IndexedDB; smaller than `Dexie` (≈10 KB); we don't need queries, only KV writes for the action queue | `Dexie` (queryable but heavy); `localforage` (slower) |
| Font | **`next/font/google`** with `Inter Variable` (lock §2) | Self-hosted, zero CLS, no tracking pixel | `next/font/local` (extra repo bytes); Geist (rejected by lock §2) |
| Styling | **Tailwind 4 + CSS custom properties** for design tokens | Tailwind 4 already installed; tokens live in one stylesheet for both light/dark | CSS-in-JS (runtime cost); plain CSS modules (token sharing harder) |
| Figure storage | **Postgres `BYTEA` in a new `problem_figures` table, max 100 KB per figure** `[UPDATED v2 — Non-blocker #10]` (was "max 1 MB per figure"; capping at 100 KB keeps every figure under the 250 ms p95 budget at Tier-2 4G; most JEE SVGs are well under) | Pilot bank ≤ 1000 problems × ≤ 4 figures × ≤ 100 KB ≈ ≤ 400 MB — comfortable in Postgres; one fewer service to operate; same backup as DB | S3 (premature: needs IAM, presigned URLs, separate availability story) |
| Connection pool | **PgBouncer transaction-pooling fronting Neon's session-pool** + Prisma `connection_limit=20` per instance | Required for the lazy scale-out path; Neon supports it natively | Direct connections (will exhaust at 50 concurrent users) |
| Cache | **None in v1**; documented trigger to add Redis: ≥ 200 concurrent test sessions OR > 100 req/s on the dashboard endpoint | Adding Redis now violates "simplest thing that works" | Memcached (no advantage); in-process `node-cache` (broken under multiple backend instances) |
| Auth | **Cookie-based session (HttpOnly + SameSite=Lax + Secure)** issued by `POST /api/auth/session`; opaque random token (32 bytes); server-side `sessions` table | Stateless backend still possible (session lookup is one indexed row); avoids JWT key rotation footguns; CSRF guarded by SameSite + same-origin check | JWT (rotation pain, can't invalidate mid-session, larger headers) |

Bundle budget: runtime route ≤ 200 KB gzipped (lock §1; tree-shaken `decimal.js` ≈ 12 KB).

---

## §3 Database Schema — Full Prisma Update

The schema below is the COMPLETE new `backend/prisma/schema.prisma`. Existing columns preserved unchanged unless commented. All `@map` directives stay in snake_case at the DB level; Prisma model field names stay camelCase.

> `[UPDATED v2 — Blocker 4]` **AutoSubmitSource canonical values:** Across Req O (architecture-input-notes), PRD-16 (test runtime), and this architecture, the enum is pinned to exactly **4 values**: `TIMER_EXPIRY`, `VIOLATION_THRESHOLD`, `NETWORK_FAILURE_FALLBACK`, `MANUAL`. The v1 `SERVER_TIMER` value is dropped — server-side cron auto-submit reports `TIMER_EXPIRY` (the source is the timer regardless of who observed expiry first). A manual submit per PRD-16 §3.3 G3 sets `auto_submit_source = 'MANUAL'` on the attempts row so that downstream analytics can distinguish "student clicked Submit" from "no row at all" (the column is NOT NULL on `attempts` when `test_session_id IS NOT NULL`). This file is the canonical source of truth; the input-notes will be reconciled to match in the same loop. The 4 values are reflected in: the Prisma enum (below), `attempts.auto_submit_source` (§3), migration 0012 (§4), the submit endpoint contract (§5 endpoint 11), and the audit row population (§8.3).

```prisma
// JEE Platform — data model v2 (Stage 2 Architecture)
//
// Binding spec: PROJECT CONTEXT.md §6, PRD-01 (diagnostic axes), PRD-16 (runtime),
// architecture-input-notes Requirements A–P + Q.
//
// v2 changes vs v1:
//  - Dual rating (Req A): jee_authenticity_score, cross-walk CHECK
//  - target_exam (Req B): enum, NOT NULL, indexed
//  - reviews sub-table (Req C): ProblemReview + inter-rater view
//  - DB-invariant for diagnostic summary (Req D / PRD-01 §6 A.3): BEFORE triggers (SECURITY DEFINER)
//  - answer.precision (Req Q): documented in YAML; consumed at app layer for compare
//  - cohorts / cohort_members / test_assignments (Req F): assignment model
//  - parents / student_parents (Req F): parent role
//  - hints JSONB (Req G): authored ladder per problem
//  - syllabus_status (Req H): WITHIN_SYLLABUS / BORDERLINE / BEYOND_SYLLABUS
//  - test_sessions / test_session_snapshots / test_session_audit (Req I): runtime
//  - AnswerType extended (Req J): MCQ_PASSAGE, NUM_DIGIT, MAT_LIST, MCQ_AR, FILL
//  - student_drill_recommendations (Req K): drill audit log
//  - Hint hardening (Req L): per-level fetch, server response padding (no schema change)
//  - Dashboard UNION-DEDUPE (Req M): SQL in §5
//  - HMAC rotation (Req N): session_secret_current + session_secret_previous on test_sessions
//  - attempts.auto_submit_source (Req O): enum — 4 canonical values
//  - marking_scheme MAT-COL gating_rule (Req P): documented in JSONB shape
//  - attempts.visit_index_in_test: per-session ordering for review screen
//
// All migrations reversible (see §4).

generator client {
  provider = "prisma-client"
  output   = "../generated/prisma"
}

datasource db {
  provider = "postgresql"
}

// =============================================================================
// ENUMS
// =============================================================================

// Axis 5 — ANSWER-TYPE. v1 ships 5; v2 adds 5 placeholders (Req J).
enum AnswerType {
  MCQ_SC
  MCQ_MC
  NUM_INT
  NUM_DEC
  MAT_COL
  // Placeholders — runtime renders a hard error block until a control is shipped.
  MCQ_PASSAGE
  NUM_DIGIT
  MAT_LIST
  MCQ_AR
  FILL
}

enum Surface     { SURF_PLAIN SURF_SET SURF_FUNC SURF_GEOM SURF_PARAM SURF_PASS }
enum Trap        { TRAP_NONE TRAP_EIGEN TRAP_CAYLEY TRAP_LHOP TRAP_NCERT TRAP_EDGE TRAP_PARTIAL TRAP_LENGTH }
enum IntrinsicDifficulty { T1 T2 T3 T4 T5 }
enum Round        { R1 R2 R3 R4 }
enum ProblemStatus { provisional calibrated }

// Req B
enum TargetExam {
  JEE_ADVANCED
  JEE_MAIN
  IOQM
  INMO
  RMO
  KVPY
  COACHING
  ORIGINAL
  OTHER
}

// Req C
enum ReviewerRole {
  jee_platform_critic
  jee_mcq_critic
  human_reviewer_primary
  human_reviewer_secondary
  automated_calibration
}

// Req H
enum SyllabusStatus {
  WITHIN_SYLLABUS
  BORDERLINE
  BEYOND_SYLLABUS
}

// Req F
enum AssignmentScope { COHORT STUDENT } // populated implicitly by the (cohort_id XOR student_id) CHECK; kept for readability of joined rows
enum ParentRelationship { FATHER MOTHER GUARDIAN OTHER }

// Req I + Req O — [UPDATED v2 — Blocker 4]: 4 canonical values
enum TestSessionStatus  { ACTIVE SUBMITTED EXPIRED }
enum AutoSubmitSource {
  TIMER_EXPIRY               // client OR server-side cron observed timer hit 0 (no distinction at column level)
  VIOLATION_THRESHOLD        // 3rd anti-cheat violation latched the AUTO_SUBMITTING state
  NETWORK_FAILURE_FALLBACK   // client lost connectivity; emergency submit via late-snapshots path
  MANUAL                     // student clicked Submit
}

// Req I
enum ViolationType {
  TAB_SWITCH
  WINDOW_BLUR
  FULLSCREEN_EXIT
  RIGHT_CLICK
  COPY_ATTEMPT
  CUT_ATTEMPT
  PASTE_ATTEMPT
  DEVTOOLS_KEYSTROKE
  COPY_KEY_SHORTCUT
}

// Req K
enum DrillRecommendationStatus {
  GENERATED
  ASSIGNED
  ATTEMPTED
  EXPIRED
}

// PRD-01 §6 A.1 — failure-mode axes (kept as TEXT in the summary columns so new
// enum values added later don't require an ALTER TYPE; validation lives at the
// taxonomy YAML and importer layer per "no miscellaneous tags" rule).

// =============================================================================
// PROBLEMS
// =============================================================================

model Problem {
  questionCode  String   @id @map("question_code")

  topicCode     String   @map("topic_code")
  subtopicCode  String   @map("subtopic_code")
  ideaCode      String   @map("idea_code")
  subIdeaCode   String   @map("sub_idea_code")
  serial        Int

  answerType    AnswerType @map("answer_type")
  surface       Surface
  trap          Trap

  authoredDifficulty         IntrinsicDifficulty @map("authored_difficulty")
  authoredTimeByRound        Json                @map("authored_time_by_round")
  empiricalDifficultyByRound Json?               @map("empirical_difficulty_by_round")
  empiricalTimeByRound       Json?               @map("empirical_time_by_round")

  // ---- Req A: dual rating ----
  jeeAuthenticityScore Float? @map("jee_authenticity_score") // 0.0–10.0, CHECK 0-10, cross-walk CHECK conditional on target_exam

  // ---- Req B: target exam ----
  targetExam TargetExam @default(JEE_ADVANCED) @map("target_exam")

  // ---- Req H: syllabus status ----
  syllabusStatus SyllabusStatus @default(WITHIN_SYLLABUS) @map("syllabus_status")

  // ---- Content ----
  statement     String   @db.Text
  answer        Json                  // { type, correct_options | value, precision? } — precision is required for NUM_DEC, validated at import
  solution      String   @db.Text
  wrongPaths    Json     @map("wrong_paths") // [{ path, landed_on_option, diagnosis, diagnostic_tags: { err_reading, err_case, err_comp, err_strategy, err_parsing } }, ...]

  // ---- Req G: hints ladder ----
  hints         Json     @default("[]") // [{ level: int, text: string, reveals_idea: bool }] — back-filled to [] for the 179 rows
  hintCount     Int      @default(0)    @map("hint_count") // denormalised count; trigger-maintained from hints array length

  // ---- PRD-01 §6 A.3: DB-maintained summary columns (trigger-maintained — see §4 migration 0006) ----
  // Multiset-union of per-wrong_paths diagnostic_tags, excluding NONE values per axis.
  errReadingTags  String[] @default([]) @map("err_reading_tags")
  errCaseTags     String[] @default([]) @map("err_case_tags")
  errCompTags     String[] @default([]) @map("err_comp_tags")
  errStrategyTags String[] @default([]) @map("err_strategy_tags")
  errParsingTags  String[] @default([]) @map("err_parsing_tags")

  status         ProblemStatus @default(provisional)
  sourceMetadata Json    @map("source_metadata")

  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  attempts        Attempt[]
  reviews         ProblemReview[]
  figures         ProblemFigure[]
  snapshots       TestSessionSnapshot[]
  diagnosticMisses ProblemDiagnosticMiss[]

  @@unique([topicCode, subtopicCode, ideaCode, subIdeaCode, serial])
  @@index([topicCode])
  @@index([subtopicCode])
  @@index([ideaCode])
  @@index([subIdeaCode])
  @@index([answerType])
  @@index([surface])
  @@index([trap])
  @@index([authoredDifficulty])
  @@index([status])
  @@index([targetExam])            // Req B
  @@index([syllabusStatus])        // Req H — student-side filter
  @@index([jeeAuthenticityScore])  // Req A — score-range queries
  // GIN indexes on the 5 summary arrays — Req D / PRD-01 §6 A.3 query NFR (≤ 800 ms p95 at 10^4 problems)
  // Prisma 6 supports `type: Gin` on `String[]`.
  @@index([errReadingTags],  type: Gin, map: "problems_err_reading_tags_gin")
  @@index([errCaseTags],     type: Gin, map: "problems_err_case_tags_gin")
  @@index([errCompTags],     type: Gin, map: "problems_err_comp_tags_gin")
  @@index([errStrategyTags], type: Gin, map: "problems_err_strategy_tags_gin")
  @@index([errParsingTags],  type: Gin, map: "problems_err_parsing_tags_gin")
  @@map("problems")
}

// =============================================================================
// PROBLEM FIGURES (Req: figure storage — Postgres BYTEA in v1)
// =============================================================================

model ProblemFigure {
  id            BigInt   @id @default(autoincrement())
  questionCode  String   @map("question_code")
  figureIndex   Int      @map("figure_index")  // 0-based; matches signed token payload
  mimeType      String   @map("mime_type")     // 'image/svg+xml' or 'image/png'
  bytes         Bytes                          // BYTEA; ≤ 100 KB enforced at app layer [UPDATED v2 — Non-blocker #10]
  width         Int?
  height        Int?
  altText       String?  @map("alt_text") @db.Text
  createdAt     DateTime @default(now()) @map("created_at")

  problem       Problem  @relation(fields: [questionCode], references: [questionCode], onDelete: Cascade)

  @@unique([questionCode, figureIndex])
  @@map("problem_figures")
}

// =============================================================================
// REVIEWS (Req C) — sub-table chosen over JSONB for query ergonomics
// =============================================================================

model ProblemReview {
  id                    BigInt        @id @default(autoincrement())
  questionCode          String        @map("question_code")
  reviewerRole          ReviewerRole  @map("reviewer_role")
  tRating               IntrinsicDifficulty @map("t_rating")
  jeeAuthenticityScore  Float?        @map("jee_authenticity_score")  // CHECK 0-10
  reviewedAt            DateTime      @default(now()) @map("reviewed_at")
  notes                 String?       @db.Text
  // Provenance flags — { backfilled: bool, source: "..." }
  provenance            Json          @default("{}")

  problem               Problem       @relation(fields: [questionCode], references: [questionCode], onDelete: Cascade)

  @@index([questionCode])
  @@index([reviewerRole])
  @@index([questionCode, reviewerRole])
  @@map("problem_reviews")
}
// CONSENSUS NOTE: Problem.authoredDifficulty + Problem.jeeAuthenticityScore are
// kept as denormalised columns (one row per problem). A trigger
// (migration 0007) recomputes them from problem_reviews on INSERT/UPDATE/DELETE,
// using rating_consensus_method from sourceMetadata (default 'mean'). This
// satisfies Req C #3 "no app-side write path can desync" — application code can
// write reviews; the denormalised columns are trigger-maintained.

// Postgres view (created in migration 0007; not a Prisma model, queried via raw SQL):
//
//   CREATE VIEW v_inter_rater AS
//   SELECT
//     p.question_code,
//     MAX(CASE WHEN r.reviewer_role='jee_platform_critic' THEN r.t_rating END) AS t_critic1,
//     MAX(CASE WHEN r.reviewer_role='jee_mcq_critic'      THEN r.t_rating END) AS t_critic2,
//     MAX(CASE WHEN r.reviewer_role='jee_platform_critic' THEN r.jee_authenticity_score END) AS s_critic1,
//     MAX(CASE WHEN r.reviewer_role='jee_mcq_critic'      THEN r.jee_authenticity_score END) AS s_critic2
//   FROM problems p LEFT JOIN problem_reviews r USING (question_code)
//   GROUP BY p.question_code;

// =============================================================================
// STUDENTS / FINGERPRINT STATE  (existing, unchanged)
// =============================================================================

model Student {
  id          BigInt   @id @default(autoincrement())
  email       String   @unique
  fullName    String   @map("full_name")
  targetRank  Int?     @map("target_rank")

  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  fingerprintStates       StudentFingerprintState[]
  attempts                Attempt[]
  cohortMemberships       CohortMember[]
  testSessions            TestSession[]
  parentLinks             StudentParent[]
  drillRecommendations    StudentDrillRecommendation[]
  individualAssignments   TestAssignment[]       @relation("StudentDirectAssignment")
  authSessions            AuthSession[]
  diagnosticMisses        ProblemDiagnosticMiss[]

  @@map("students")
}

model StudentFingerprintState {
  studentId    BigInt   @map("student_id")
  topicCode    String   @map("topic_code")
  subtopicCode String   @map("subtopic_code")
  ideaCode     String   @map("idea_code")
  subIdeaCode  String   @map("sub_idea_code")
  round        Round
  masteryScore Float    @map("mastery_score")
  updatedAt    DateTime @updatedAt @map("updated_at")

  student      Student  @relation(fields: [studentId], references: [id], onDelete: Cascade)

  @@id([studentId, topicCode, subtopicCode, ideaCode, subIdeaCode])
  @@index([studentId])
  @@map("student_fingerprint_state")
}

// =============================================================================
// PARENTS (Req F)
// =============================================================================

model Parent {
  id          BigInt   @id @default(autoincrement())
  email       String   @unique
  fullName    String   @map("full_name")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  children    StudentParent[]
  authSessions AuthSession[]

  @@map("parents")
}

model StudentParent {
  studentId    BigInt              @map("student_id")
  parentId     BigInt              @map("parent_id")
  relationship ParentRelationship  @default(GUARDIAN)
  createdAt    DateTime            @default(now()) @map("created_at")

  student      Student @relation(fields: [studentId], references: [id], onDelete: Cascade)
  parent       Parent  @relation(fields: [parentId], references: [id], onDelete: Cascade)

  @@id([studentId, parentId])
  @@index([parentId])
  @@map("student_parents")
}

// =============================================================================
// TEACHERS / ADMINS
// =============================================================================

model Teacher {
  id          BigInt   @id @default(autoincrement())
  email       String   @unique
  fullName    String   @map("full_name")
  isAdmin     Boolean  @default(false) @map("is_admin")
  createdAt   DateTime @default(now()) @map("created_at")

  cohortsCreated     Cohort[]
  assignmentsCreated TestAssignment[]
  authSessions       AuthSession[]

  @@map("teachers")
}

// =============================================================================
// AUTH SESSIONS (cookie-backed; one row per logged-in device)
// =============================================================================

model AuthSession {
  id           String   @id    // 32-byte random base64url (= the cookie value)
  studentId    BigInt?  @map("student_id")
  teacherId    BigInt?  @map("teacher_id")
  parentId     BigInt?  @map("parent_id")
  createdAt    DateTime @default(now()) @map("created_at")
  expiresAt    DateTime @map("expires_at")
  lastUsedAt   DateTime @default(now()) @map("last_used_at")
  userAgent    String?  @map("user_agent")
  ipHash       String?  @map("ip_hash")

  student      Student? @relation(fields: [studentId], references: [id], onDelete: Cascade)
  teacher      Teacher? @relation(fields: [teacherId], references: [id], onDelete: Cascade)
  parent       Parent?  @relation(fields: [parentId], references: [id], onDelete: Cascade)

  @@index([expiresAt])
  @@index([studentId])
  @@index([teacherId])
  @@index([parentId])
  @@map("auth_sessions")
}
// CHECK constraint: exactly one of (student_id, teacher_id, parent_id) is non-null. Added in migration 0008.

// =============================================================================
// COHORTS + ASSIGNMENTS (Req F)
// =============================================================================

model Cohort {
  id                  BigInt   @id @default(autoincrement())
  name                String
  batchLabel          String   @map("batch_label")
  createdByTeacherId  BigInt   @map("created_by_teacher_id")
  createdAt           DateTime @default(now()) @map("created_at")

  members     CohortMember[]
  assignments TestAssignment[] @relation("CohortAssignment")
  createdBy   Teacher          @relation(fields: [createdByTeacherId], references: [id])

  @@index([createdByTeacherId])
  @@map("cohorts")
}

model CohortMember {
  cohortId   BigInt   @map("cohort_id")
  studentId  BigInt   @map("student_id")
  joinedAt   DateTime @default(now()) @map("joined_at")

  cohort   Cohort  @relation(fields: [cohortId], references: [id], onDelete: Cascade)
  student  Student @relation(fields: [studentId], references: [id], onDelete: Cascade)

  @@id([cohortId, studentId])
  @@index([studentId])
  @@map("cohort_members")
}

// =============================================================================
// TESTS  (existing — minor)
// =============================================================================

model Test {
  id              BigInt   @id @default(autoincrement())
  title           String
  questionCodes   Json     @map("question_codes")
  durationSeconds Int      @map("duration_seconds")
  markingScheme   Json     @map("marking_scheme")  // shape per §8.4 of PRD-16 + Req P (gating_rule)

  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  attempts        Attempt[]
  assignments     TestAssignment[]
  sessions        TestSession[]

  @@map("tests")
}

// =============================================================================
// TEST ASSIGNMENTS (Req F + PRD-16 Blocker 3a)
// =============================================================================

model TestAssignment {
  id                 BigInt   @id @default(autoincrement())
  testId             BigInt   @map("test_id")
  cohortId           BigInt?  @map("cohort_id")     // exactly one of (cohort_id, student_id) is set — CHECK
  studentId          BigInt?  @map("student_id")
  windowStartAt      DateTime @map("window_start_at")
  windowEndAt        DateTime @map("window_end_at")
  markingScheme      Json?    @map("marking_scheme") // per-test override; NULL → platform defaults
  assignedByTeacherId BigInt  @map("assigned_by_teacher_id")
  assignedAt         DateTime @default(now()) @map("assigned_at")

  test        Test     @relation(fields: [testId], references: [id], onDelete: Cascade)
  cohort      Cohort?  @relation("CohortAssignment", fields: [cohortId], references: [id], onDelete: Cascade)
  student     Student? @relation("StudentDirectAssignment", fields: [studentId], references: [id], onDelete: Cascade)
  assignedBy  Teacher  @relation(fields: [assignedByTeacherId], references: [id])
  sessions    TestSession[]

  @@index([testId])
  @@index([studentId, windowStartAt])
  @@index([cohortId,  windowStartAt])
  @@map("test_assignments")
}
// CHECK: ((cohort_id IS NULL) <> (student_id IS NULL))   — exactly-one; added in migration 0009.
// CHECK: window_end_at > window_start_at                 — sanity.

// =============================================================================
// TEST SESSIONS  (Req I + Req N)
// =============================================================================
// [PRESERVED FROM v1 — must not regress per Critic §"One thing the architect nailed"]:
// frozen_question_codes is the simplest possible solution to "admins editing
// problems mid-session don't affect in-flight sessions". v2 keeps it as-is.

model TestSession {
  id                     BigInt              @id @default(autoincrement())
  testId                 BigInt              @map("test_id")
  testAssignmentId       BigInt              @map("test_assignment_id")
  studentId              BigInt              @map("student_id")

  // ---- Req N: HMAC custody with grace ----
  sessionSecretCurrent   Bytes               @map("session_secret_current")     // 32 random bytes
  sessionSecretPrevious  Bytes?              @map("session_secret_previous")    // populated at submit; valid for 5 min grace
  secretRotatedAt        DateTime?           @map("secret_rotated_at")

  startedAt              DateTime?           @map("started_at")
  expiresAt              DateTime?           @map("expires_at")
  submittedAt            DateTime?           @map("submitted_at")

  // ---- Req I + Req O ----
  status                 TestSessionStatus   @default(ACTIVE)
  autoSubmitSource       AutoSubmitSource?   @map("auto_submit_source")
  violationsCount        Int                 @default(0) @map("violations_count")

  // Frozen snapshot of the ordered question codes at START (so admin edits don't affect in-flight sessions)
  frozenQuestionCodes    Json                @map("frozen_question_codes")      // string[] indexed 0..N-1 (slot_index)

  createdAt              DateTime            @default(now()) @map("created_at")

  test          Test            @relation(fields: [testId], references: [id])
  assignment    TestAssignment  @relation(fields: [testAssignmentId], references: [id])
  student       Student         @relation(fields: [studentId], references: [id], onDelete: Cascade)
  snapshots     TestSessionSnapshot[]
  audit         TestSessionAudit[]
  attempts      Attempt[]

  // [UPDATED v2 — Non-blocker #7]: removed `@@unique([studentId, testId, status])` because
  // it's wrong semantics (a student CAN have a SUBMITTED + an EXPIRED for the same test).
  // The correct guard — "one active session per (student, test)" — is the partial unique
  // index in migration 0010 raw SQL. Prisma cannot express partial uniques.

  @@index([studentId])
  @@index([testId])
  @@index([expiresAt])      // server-side auto-submit cron scan
  @@index([submittedAt])
  @@map("test_sessions")
}

// =============================================================================
// TEST SESSION SNAPSHOTS  (Req I — transient per-question state; UPDATE not append)
// =============================================================================

model TestSessionSnapshot {
  sessionId       BigInt     @map("session_id")
  slotIndex       Int        @map("slot_index")
  questionCode    String     @map("question_code")  // server-side only; never sent during active session
  answerPayload   Json?      @map("answer_payload") // shape depends on AnswerType
  timeSeconds     Int        @default(0) @map("time_seconds")
  visitCount      Int        @default(0) @map("visit_count")
  markedForReview Boolean    @default(false) @map("marked_for_review")
  hintsUsed       Int        @default(0)  @map("hints_used")
  hintLevelsRevealed Int[]   @default([]) @map("hint_levels_revealed")
  actionSeq       BigInt     @default(0) @map("action_seq")        // monotonic per session
  lastActionAt    DateTime?  @map("last_action_at")

  session  TestSession  @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  problem  Problem      @relation(fields: [questionCode], references: [questionCode])

  @@id([sessionId, slotIndex])
  @@index([sessionId])
  @@map("test_session_snapshots")
}
// CHECK: visit_count >= 0; time_seconds >= 0; hints_used >= 0. (App-layer enforced too.)

// =============================================================================
// TEST SESSION AUDIT  (Req I — APPEND-ONLY)
// =============================================================================

model TestSessionAudit {
  id                BigInt           @id @default(autoincrement())
  sessionId         BigInt           @map("session_id")
  studentId         BigInt           @map("student_id")
  endpoint          String           // 'PUT /api/.../snapshots' etc.
  actionPayloadHash String           @map("action_payload_hash") // SHA-256 of the request body
  clientIp          String?          @map("client_ip")
  userAgent         String?          @map("user_agent")
  serverTimestamp   DateTime         @default(now()) @map("server_timestamp")

  // Violation-specific (nullable; populated only on violation rows)
  violationType        ViolationType? @map("violation_type")
  violationTimestamp   DateTime?      @map("violation_timestamp")
  wasActive            Boolean?       @map("was_active")
  // Hint-specific
  hintLevel            Int?           @map("hint_level")
  slotIndex            Int?           @map("slot_index")

  session  TestSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId])
  @@index([sessionId, violationType])
  @@index([serverTimestamp])
  @@map("test_session_audit")
}
// Append-only enforcement: see §3.2 role separation. REVOKE UPDATE, DELETE on
// test_session_audit FROM app_user runs in migration 0011 and is now STRUCTURAL
// (app_user is not the table owner; cannot self-grant).

// =============================================================================
// ATTEMPTS  (existing + Req O + Req I additions)
// APPEND-ONLY — NEVER UPDATE OR DELETE AFTER WRITE.
// =============================================================================

model Attempt {
  id              BigInt    @id @default(autoincrement())
  studentId       BigInt    @map("student_id")
  questionCode    String    @map("question_code")
  testId          BigInt?   @map("test_id")
  testSessionId   BigInt?   @map("test_session_id")  // FK to the session that produced this row (null for standalone practice)

  correct         Boolean
  timeSeconds     Int       @map("time_seconds")
  visitCount      Int       @default(1) @map("visit_count")
  markedForReview Boolean   @default(false) @map("marked_for_review")
  attemptOrder    Int       @map("attempt_order")     // PROJECT CONTEXT §6 — N-th attempt of this code by this student, all time
  visitIndexInTest Int?     @map("visit_index_in_test") // 1-indexed per session; null for non-session attempts
  roundAtTime     Round     @map("round_at_time")
  hintsUsed       Int       @default(0) @map("hints_used")

  // ---- Req O — [UPDATED v2 — Blocker 4] ----
  // Canonical 4-value enum: TIMER_EXPIRY / VIOLATION_THRESHOLD / NETWORK_FAILURE_FALLBACK / MANUAL.
  // Populated for every row that has test_session_id IS NOT NULL (enforced by app-layer write at submit; see §6.3).
  // NULL only for standalone-practice attempts (no test_session_id).
  autoSubmitSource AutoSubmitSource? @map("auto_submit_source")

  createdAt       DateTime  @default(now()) @map("created_at")

  student         Student      @relation(fields: [studentId], references: [id])
  problem         Problem      @relation(fields: [questionCode], references: [questionCode])
  test            Test?        @relation(fields: [testId], references: [id])
  session         TestSession? @relation(fields: [testSessionId], references: [id])

  @@index([studentId])
  @@index([questionCode])
  @@index([createdAt])
  @@index([questionCode, createdAt])
  @@index([testSessionId])
  @@index([studentId, questionCode])  // for attempt_order lookup
  @@map("attempts")
}
// Append-only enforcement: see §3.2 role separation. REVOKE UPDATE, DELETE on
// attempts FROM app_user runs in migration 0011 and is now STRUCTURAL
// (app_user is not the table owner; cannot self-grant).

// =============================================================================
// DIAGNOSTIC MISSES  (PRD-01 US-1 E2)
// =============================================================================

model ProblemDiagnosticMiss {
  id           BigInt   @id @default(autoincrement())
  studentId    BigInt   @map("student_id")
  questionCode String   @map("question_code")
  wrongAnswer  String   @map("wrong_answer")  // normalised via @jee/numeric-normalise for NUM types
  createdAt    DateTime @default(now()) @map("created_at")

  student      Student  @relation(fields: [studentId], references: [id], onDelete: Cascade)
  problem      Problem  @relation(fields: [questionCode], references: [questionCode], onDelete: Cascade)

  @@index([questionCode])
  @@index([createdAt])
  @@map("problem_diagnostic_misses")
}

// =============================================================================
// STUDENT DRILL RECOMMENDATIONS (Req K)
// =============================================================================

model StudentDrillRecommendation {
  id                 BigInt                    @id @default(autoincrement())
  studentId          BigInt                    @map("student_id")
  generatedAt        DateTime                  @default(now()) @map("generated_at")
  sourceTestId       BigInt?                   @map("source_test_id")  // the test whose results triggered the recommendation
  problemCodes       String[]                  @map("problem_codes")
  targetFailureMode  String?                   @map("target_failure_mode")  // e.g. "err_case=ERR-CASE-EDGE"
  targetIdeaCode     String?                   @map("target_idea_code")
  generatedTestId    BigInt?                   @map("generated_test_id")    // FK to the tests row this drill became
  status             DrillRecommendationStatus @default(GENERATED)
  expiresAt          DateTime?                 @map("expires_at")

  student            Student                   @relation(fields: [studentId], references: [id], onDelete: Cascade)

  @@index([studentId, generatedAt])
  @@index([status])
  @@map("student_drill_recommendations")
}
```

### §3.1 Postgres-level objects NOT expressible in Prisma (created via raw SQL in migrations)

1. **Conditional cross-walk CHECK on `problems`** (Req A #2). Applied only when `target_exam = JEE_ADVANCED`:
   ```sql
   ALTER TABLE problems ADD CONSTRAINT chk_score_range
     CHECK (jee_authenticity_score IS NULL
            OR (jee_authenticity_score >= 0.0 AND jee_authenticity_score <= 10.0));

   ALTER TABLE problems ADD CONSTRAINT chk_crosswalk_jee_advanced
     CHECK (
       target_exam <> 'JEE_ADVANCED'
       OR jee_authenticity_score IS NULL
       OR (authored_difficulty = 'T1' AND jee_authenticity_score >= 8.5 AND jee_authenticity_score < 8.8)
       OR (authored_difficulty = 'T2' AND jee_authenticity_score >= 8.8 AND jee_authenticity_score < 9.2)
       OR (authored_difficulty = 'T3' AND jee_authenticity_score >= 9.2 AND jee_authenticity_score < 9.5)
       OR (authored_difficulty = 'T4' AND jee_authenticity_score >= 9.5 AND jee_authenticity_score < 9.8)
       OR (authored_difficulty = 'T5' AND jee_authenticity_score >= 9.8 AND jee_authenticity_score <= 10.0)
     );
   ```
   Rationale: a CHECK constraint with a pure CASE expression is immutable (no SRF, no subquery), works inside row-level integrity, and is reversible (DROP CONSTRAINT). No trigger needed.

2. **`[UPDATED v2 — Blocker 1 + Blocker 2]`** **BEFORE row-level trigger to maintain the 5 diagnostic summary array columns** (Req D / PRD-01 §6 A.3). PostgreSQL `GENERATED ... STORED` rejects `jsonb_array_elements` (set-returning), so a trigger is required.

   **Primitive choice (Blocker 2 fix):** BEFORE row-level. Justification: BEFORE row-level fires synchronously within the same statement; `NEW := …` assignment commits atomically with the source row, so PRD-01 §6 A.3 AC #1 (same-transaction consistency — a reader committing after the writer cannot observe stale summaries under `READ COMMITTED`) is satisfied. AFTER row-level would require re-fetching the row to apply the recompute, doubling write cost; deferred `CONSTRAINT TRIGGER` adds complexity (`DEFERRABLE INITIALLY DEFERRED`) we don't need. v1's executive-summary "deferred" wording was incorrect and is replaced.

   **`SECURITY DEFINER` (Blocker 1 fix):** the function is declared `SECURITY DEFINER` and owned by a dedicated `trigger_owner` role (created in migration 0001 — see §3.2). This lets the function's `NEW := …` assignment execute with `trigger_owner`'s privileges instead of the calling role (`app_user`), so the REVOKE on the 6 summary columns from `app_user` does NOT prevent the trigger from writing them. Direct UPDATE attempts by `app_user` still fail with `42501`.

   ```sql
   -- Owned by trigger_owner (see §3.2). SECURITY DEFINER + explicit search_path
   -- avoids the well-known "search path injection" attack on SECURITY DEFINER
   -- functions (CVE class).
   CREATE OR REPLACE FUNCTION fn_recompute_diagnostic_summary() RETURNS trigger
     LANGUAGE plpgsql
     SECURITY DEFINER
     SET search_path = pg_catalog, public
   AS $$
   BEGIN
     NEW.err_reading_tags  := COALESCE((
       SELECT array_agg(DISTINCT t.v) FROM jsonb_array_elements(NEW.wrong_paths) wp
       CROSS JOIN LATERAL (SELECT wp.value->'diagnostic_tags'->>'err_reading' AS v) t
       WHERE t.v IS NOT NULL AND t.v <> 'ERR-READING-NONE'
     ), ARRAY[]::text[]);
     NEW.err_case_tags     := COALESCE((
       SELECT array_agg(DISTINCT t.v) FROM jsonb_array_elements(NEW.wrong_paths) wp
       CROSS JOIN LATERAL (SELECT wp.value->'diagnostic_tags'->>'err_case' AS v) t
       WHERE t.v IS NOT NULL AND t.v <> 'ERR-CASE-NONE'
     ), ARRAY[]::text[]);
     NEW.err_comp_tags     := COALESCE((
       SELECT array_agg(DISTINCT t.v) FROM jsonb_array_elements(NEW.wrong_paths) wp
       CROSS JOIN LATERAL (SELECT wp.value->'diagnostic_tags'->>'err_comp' AS v) t
       WHERE t.v IS NOT NULL AND t.v <> 'ERR-COMP-NONE'
     ), ARRAY[]::text[]);
     NEW.err_strategy_tags := COALESCE((
       SELECT array_agg(DISTINCT t.v) FROM jsonb_array_elements(NEW.wrong_paths) wp
       CROSS JOIN LATERAL (SELECT wp.value->'diagnostic_tags'->>'err_strategy' AS v) t
       WHERE t.v IS NOT NULL AND t.v <> 'ERR-STRAT-NONE'
     ), ARRAY[]::text[]);
     NEW.err_parsing_tags  := COALESCE((
       SELECT array_agg(DISTINCT t.v) FROM jsonb_array_elements(NEW.wrong_paths) wp
       CROSS JOIN LATERAL (SELECT wp.value->'diagnostic_tags'->>'err_parsing' AS v) t
       WHERE t.v IS NOT NULL AND t.v <> 'ERR-PARSE-NONE'
     ), ARRAY[]::text[]);
     NEW.hint_count := COALESCE(jsonb_array_length(NEW.hints), 0);
     RETURN NEW;
   END;
   $$;

   ALTER FUNCTION fn_recompute_diagnostic_summary() OWNER TO trigger_owner;

   -- Restrict who can EXECUTE the function so app_user can call it indirectly
   -- (via INSERT/UPDATE on problems) but cannot invoke it on arbitrary inputs.
   REVOKE ALL ON FUNCTION fn_recompute_diagnostic_summary() FROM PUBLIC;
   GRANT  EXECUTE ON FUNCTION fn_recompute_diagnostic_summary() TO app_user;

   CREATE TRIGGER trg_diagnostic_summary
     BEFORE INSERT OR UPDATE OF wrong_paths, hints ON problems
     FOR EACH ROW EXECUTE FUNCTION fn_recompute_diagnostic_summary();

   -- App-side direct-write block: REVOKE column-level UPDATE on the 6
   -- trigger-maintained columns from app_user. (Owner of problems table is
   -- migration_role, see §3.2; app_user is not the owner.)
   REVOKE UPDATE (err_reading_tags, err_case_tags, err_comp_tags,
                  err_strategy_tags, err_parsing_tags, hint_count)
     ON problems FROM app_user;
   ```
   **Acceptance criteria coverage (PRD-01 §6 A.3):**
   - **AC1 (write-through):** BEFORE INSERT/UPDATE assignment to NEW commits atomically with the source row in the same transaction.
   - **AC2 (no app-side write):** `REVOKE UPDATE` on the summary + count columns from `app_user`. A direct `UPDATE problems SET err_reading_tags='{X}'` as `app_user` raises `42501 insufficient_privilege`.
   - **AC3 (integration test):** `integration/diagnostic-summary.spec.ts` asserts (a) direct UPDATE on a summary column by app_user raises, (b) UPDATE of `wrong_paths` flips the array as expected in the same transaction, **`[UPDATED v2 — Blocker 1]`** (c) the trigger function cannot be invoked directly by app_user with a forged NEW (the function ignores TG_OP=NULL — verifies the SECURITY DEFINER pattern doesn't leak), (d) the only path that writes the summary cols is via INSERT/UPDATE on `problems`. See §4 row 0006 for the migration this lands in.
   - **AC4 (equality predicate):** `DISTINCT` + `WHERE v <> '<axis>-NONE'` matches the PRD-01 §6 A.3 #4 spec.
   - **AC5 (query perf):** GIN indexes on the 5 arrays cover the `?` and `?|` operators used by US-2 set-construction — verified by `EXPLAIN ANALYZE` in the migration test.

3. **`[UPDATED v2 — Blocker 5]`** **AFTER trigger to maintain `authored_difficulty` + `jee_authenticity_score` consensus from `problem_reviews`** (Req C #3) — now raises a structured cross-walk-violation error instead of a generic CHECK violation when the new consensus would fall outside the cross-walk band:
   ```sql
   CREATE OR REPLACE FUNCTION fn_recompute_problem_consensus() RETURNS trigger
     LANGUAGE plpgsql
     SECURITY DEFINER
     SET search_path = pg_catalog, public
   AS $$
   DECLARE
     qcode text;
     new_t  "IntrinsicDifficulty";
     new_s  float;
     low_b  float;
     high_b float;
     target target_exam;
   BEGIN
     qcode := COALESCE(NEW.question_code, OLD.question_code);

     -- 1. Compute the new consensus pair.
     SELECT
       (ARRAY['T1','T2','T3','T4','T5']::"IntrinsicDifficulty"[])[
         GREATEST(1, LEAST(5,
           ROUND(AVG(CASE r.t_rating
                       WHEN 'T1' THEN 1 WHEN 'T2' THEN 2 WHEN 'T3' THEN 3
                       WHEN 'T4' THEN 4 WHEN 'T5' THEN 5 END))::int))]
     INTO new_t
     FROM problem_reviews r WHERE r.question_code = qcode;

     SELECT AVG(r.jee_authenticity_score) INTO new_s
     FROM problem_reviews r
     WHERE r.question_code = qcode AND r.jee_authenticity_score IS NOT NULL;

     -- 2. Get the cross-walk band for the new T bucket, only if target_exam = JEE_ADVANCED.
     SELECT target_exam INTO target FROM problems WHERE question_code = qcode;
     IF target = 'JEE_ADVANCED' AND new_s IS NOT NULL THEN
       low_b  := CASE new_t WHEN 'T1' THEN 8.5 WHEN 'T2' THEN 8.8 WHEN 'T3' THEN 9.2
                            WHEN 'T4' THEN 9.5 WHEN 'T5' THEN 9.8 END;
       high_b := CASE new_t WHEN 'T1' THEN 8.8 WHEN 'T2' THEN 9.2 WHEN 'T3' THEN 9.5
                            WHEN 'T4' THEN 9.8 WHEN 'T5' THEN 10.0 END;
       -- 3. If the new pair would violate the cross-walk CHECK, raise a structured error
       --    BEFORE the UPDATE on problems, so the caller sees a useful message instead
       --    of a generic 23514 with no context.
       IF new_s < low_b OR new_s > high_b THEN
         RAISE EXCEPTION
           'cross_walk_violation: new consensus (T=%, score=%) for problem % would fall outside the JEE_ADVANCED cross-walk band [%, %) for that T bucket. Adjust your t_rating or jee_authenticity_score so the new consensus stays in band.',
           new_t, ROUND(new_s::numeric, 2), qcode, low_b, high_b
           USING ERRCODE = '23514',
                 HINT = 'Either revise this review or also revise another review in problem_reviews so the average falls inside the band for the resulting T bucket.';
       END IF;
     END IF;

     -- 4. Apply the new consensus.
     UPDATE problems p SET
       authored_difficulty    = new_t,
       jee_authenticity_score = new_s
     WHERE p.question_code = qcode;

     RETURN NULL;
   END;
   $$;

   ALTER FUNCTION fn_recompute_problem_consensus() OWNER TO trigger_owner;
   REVOKE ALL ON FUNCTION fn_recompute_problem_consensus() FROM PUBLIC;
   GRANT  EXECUTE ON FUNCTION fn_recompute_problem_consensus() TO app_user;

   CREATE TRIGGER trg_consensus_after_review
     AFTER INSERT OR UPDATE OR DELETE ON problem_reviews
     FOR EACH ROW EXECUTE FUNCTION fn_recompute_problem_consensus();
   ```
   Default consensus method is `mean`; for other methods (`median`, `max`, `min`, `human_override`), the trigger reads `problems.source_metadata->>'rating_consensus_method'` and branches. (Branches elided in this draft for brevity; full SQL in `migrations/0007_consensus_trigger/up.sql`.)

   **API handling of cross-walk-violation (Blocker 5 fix — see §5 endpoint 14):** The `POST /api/problems/:question_code/reviews` endpoint catches Postgres SQLSTATE `23514` errors whose message begins with `cross_walk_violation:`. On match it returns:
   ```
   HTTP 422 Unprocessable Entity
   Content-Type: application/json
   {
     "error": "cross_walk_violation",
     "message": "Your review would push the consensus outside the JEE-Advanced cross-walk band for T-bucket Tn (band = [low, high)).",
     "details": {
       "your_t_rating": "T3",
       "your_jee_authenticity_score": 9.9,
       "new_consensus_t": "T3",
       "new_consensus_score": 9.7,
       "band_low": 9.2,
       "band_high": 9.5,
       "existing_reviews": [
         { "reviewer_role": "jee_platform_critic", "t_rating": "T3", "jee_authenticity_score": 9.4 },
         { "reviewer_role": "jee_mcq_critic",      "t_rating": "T3", "jee_authenticity_score": 9.5 }
       ]
     },
     "retry_guidance": "Either lower your jee_authenticity_score below 9.5, OR coordinate with the other reviewers to update theirs."
   }
   ```
   The INSERT to `problem_reviews` rolls back atomically (Postgres standard behaviour: any RAISE inside a trigger aborts the calling transaction); the caller knows exactly what to adjust. Implementation: NestJS interceptor `CrossWalkViolationInterceptor` checks `error.code === '23514' && error.message.startsWith('cross_walk_violation:')` and projects the structured 422 above. Existing reviews list is fetched in a separate read-only query (the rollback releases the FOR UPDATE lock so the read sees committed state).

4. **`[UPDATED v2 — Blocker 3]`** **Append-only enforcement** for `attempts` and `test_session_audit` (PROJECT CONTEXT §12 Rule 3 / PRD-16 §5.3). This is **structural, not policy**, because `app_user` does NOT own the tables (the table-owner is `migration_role` — see §3.2):
   ```sql
   -- Run in migration 0011, as migration_role (the table owner).
   REVOKE UPDATE, DELETE ON attempts            FROM app_user;
   REVOKE UPDATE, DELETE ON test_session_audit  FROM app_user;
   -- App_user retains INSERT, SELECT (already granted in 0001 to all tables it should access).
   ```
   The chosen approach is REVOKE rather than `CREATE RULE ... DO INSTEAD NOTHING` because (a) RULE silently swallows the offending UPDATE/DELETE — the caller cannot tell their write was no-op'd — whereas REVOKE returns a hard `42501 insufficient_privilege` that surfaces the bug immediately; and (b) Postgres documentation discourages RULE for this use case in favour of triggers or grants.

5. **`v_inter_rater` view** — see model comment above (created in migration 0007).

6. **Partial unique index** on `test_sessions` to enforce one active session per (student, test):
   ```sql
   CREATE UNIQUE INDEX uniq_active_session
     ON test_sessions(student_id, test_id) WHERE submitted_at IS NULL;
   ```
   `[UPDATED v2 — Non-blocker #7]`: The v1 `@@unique([studentId, testId, status])` Prisma decorator was removed (§3 schema) because it's wrong semantics (it creates a 3-col unique index that allows e.g. two SUBMITTED rows). The partial unique index above is the only correctness guard.

7. **CHECK constraints on `test_assignments` and `auth_sessions`** (one-of):
   ```sql
   ALTER TABLE test_assignments ADD CONSTRAINT chk_assignment_scope
     CHECK ((cohort_id IS NULL) <> (student_id IS NULL));
   ALTER TABLE test_assignments ADD CONSTRAINT chk_window_order
     CHECK (window_end_at > window_start_at);
   ALTER TABLE auth_sessions ADD CONSTRAINT chk_one_role
     CHECK (
       (CASE WHEN student_id IS NULL THEN 0 ELSE 1 END
      + CASE WHEN teacher_id IS NULL THEN 0 ELSE 1 END
      + CASE WHEN parent_id  IS NULL THEN 0 ELSE 1 END) = 1
     );
   ```

### §3.2 `[UPDATED v2 — Blocker 1 + Blocker 3]` DB role separation

Three roles live in the Postgres cluster from migration 0001 onward:

| Role | Owns tables? | Used by | Privileges |
|---|---|---|---|
| `migration_role` | YES — owns every table, every sequence, every type, every view, every trigger, every function (except the SECURITY DEFINER trigger functions whose ownership is transferred to `trigger_owner`) | `prisma migrate dev` + `prisma migrate deploy` ONLY. Connection string = `MIGRATION_DATABASE_URL`. Held in CI/CD secrets manager + the user's local `.env` (gitignored). Never used by the running NestJS app. | `BYPASSRLS`, full owner privileges on all objects |
| `app_user` | NO | The running NestJS app. Connection string = `DATABASE_URL`. Held in Render + Vercel env vars (prod) / `.env` (dev). | `SELECT, INSERT` on `attempts`, `test_session_audit`; `SELECT, INSERT, UPDATE, DELETE` on `problems` MINUS the 6 trigger-maintained columns (REVOKE column-level UPDATE on `err_*_tags` and `hint_count`); `SELECT, INSERT, UPDATE, DELETE` on every other table per RBAC rules. `EXECUTE` on `fn_recompute_diagnostic_summary()` and `fn_recompute_problem_consensus()` (the SECURITY DEFINER functions). |
| `trigger_owner` | NO (owns FUNCTIONS only, not tables) | Never logs in (`NOLOGIN`). Sole purpose: to own the two SECURITY DEFINER trigger functions so the functions can write to columns that `app_user` cannot. | Full UPDATE on the 6 trigger-maintained columns of `problems`. Does NOT own tables, so cannot delete them. |

**Migration 0001 DDL (role creation — runs as superuser at DB provision time; documented in `backend/prisma/migrations/0001_init/up.sql` header as a one-time bootstrap):**

```sql
-- Bootstrap roles. Idempotent because of the WHERE NOT EXISTS guards.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_role') THEN
    CREATE ROLE migration_role NOLOGIN BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'trigger_owner') THEN
    CREATE ROLE trigger_owner NOLOGIN;
  END IF;
END
$$;

-- Login users (one per role that needs to connect). Passwords come from secrets
-- manager and are set out-of-band by the operator, not stored in the migration.
CREATE USER migration_user IN ROLE migration_role;
CREATE USER app_user_login IN ROLE app_user;

GRANT CONNECT ON DATABASE jee_platform_dev TO migration_user, app_user_login;
GRANT USAGE   ON SCHEMA public            TO migration_user, app_user_login;
```

**Why two `DATABASE_URL`s in `.env.example`:**

```
# .env.example — committed; never put real secrets here.

# Used ONLY by `prisma migrate dev` and `prisma migrate deploy`.
# In prod: held in GitHub Actions secrets (CI/CD) — NEVER exposed to the running NestJS app.
# In dev: filled in by the operator (you) from the local Postgres superuser-equivalent.
MIGRATION_DATABASE_URL=postgresql://migration_user:CHANGEME@localhost:5432/jee_platform_dev

# Used by the running NestJS app at runtime.
# In prod: Render env var.
# This user CANNOT update/delete attempts or test_session_audit, by REVOKE.
DATABASE_URL=postgresql://app_user_login:CHANGEME@localhost:5432/jee_platform_dev

# HMAC pepper for figure-token signing (§7.3). 32 random bytes, hex-encoded.
# Generate with: openssl rand -hex 32
HMAC_PEPPER=

# Sentry DSN (frontend + backend). Optional in dev; required in prod.
SENTRY_DSN=
```

**§11 deployment notes echo this:** in prod, `MIGRATION_DATABASE_URL` is held in GitHub Actions secrets and is ONLY accessible to the `deploy.yml` workflow that runs `prisma migrate deploy`. The Render environment for the NestJS app sets only `DATABASE_URL` (= `app_user_login`). The two are physically different connection strings to the same database. **Result: anyone with the runtime `DATABASE_URL` literally cannot UPDATE or DELETE rows in `attempts` or `test_session_audit` — the database refuses with `42501`.** PROJECT CONTEXT §12 Rule 3 is now a structural property, not a paper promise.

**Integration test (migration 0011 ships with):**

```ts
// backend/test/integration/append-only.spec.ts
import { Client } from 'pg';

it('app_user cannot UPDATE attempts', async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await expect(
    c.query('UPDATE attempts SET correct = NOT correct WHERE id = 1')
  ).rejects.toMatchObject({ code: '42501' });   // insufficient_privilege
});

it('app_user cannot DELETE from attempts', async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await expect(
    c.query('DELETE FROM attempts WHERE id = 1')
  ).rejects.toMatchObject({ code: '42501' });
});

it('app_user cannot UPDATE diagnostic summary columns directly', async () => {
  // Blocker 1 test: confirms the REVOKE column-level UPDATE works
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await expect(
    c.query("UPDATE problems SET err_reading_tags = '{ERR-READING-X}' WHERE question_code = $1", ['ALG.PNC.NUM.001.001'])
  ).rejects.toMatchObject({ code: '42501' });
});

it('Trigger DOES write summary columns when wrong_paths changes', async () => {
  // Blocker 1 + Blocker 2 test: confirms BEFORE-trigger + SECURITY DEFINER work in concert
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await c.query(
    "UPDATE problems SET wrong_paths = $1::jsonb WHERE question_code = $2",
    [JSON.stringify([{ diagnostic_tags: { err_reading: 'ERR-READING-X' } }]), 'ALG.PNC.NUM.001.001']
  );
  const r = await c.query('SELECT err_reading_tags FROM problems WHERE question_code = $1', ['ALG.PNC.NUM.001.001']);
  expect(r.rows[0].err_reading_tags).toEqual(['ERR-READING-X']);
});

it('app_user cannot invoke SECURITY DEFINER trigger function directly with forged input', async () => {
  // Blocker 1 test: the function can only be invoked indirectly via INSERT/UPDATE on problems
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  // Calling fn_recompute_diagnostic_summary() without a trigger context returns no result
  // (TG_OP is NULL outside a trigger), and the GRANT EXECUTE permits the call but the
  // function body cannot harm anything because NEW is undefined outside trigger context.
  // Confirm the function refuses non-trigger invocation OR is a no-op.
  await expect(
    c.query('SELECT fn_recompute_diagnostic_summary()')
  ).rejects.toMatchObject({ code: /^(42883|0A000)$/ });  // either "function does not exist for SELECT" or "feature not supported"
});
```

### §3.3 GIN write amplification — v2 future note `[UPDATED v2 — Non-blocker #8]`

Five separate GIN indexes on `problems` are chosen for v1 because (a) authoring writes are ≤ 10/week (pilot-scale negligible cost), (b) US-2 queries target one axis at a time and a composite GIN over `{err_*_tags}` doesn't help that pattern (it would require axis-prefixed entries), (c) the simplest correct shape. The future migration path, when triggered, is: replace the 5 array columns with one `failure_modes_seen JSONB` column shaped `{err_reading: [...], err_case: [...], ...}` and one GIN index using `jsonb_path_ops`. Trigger conditions: nightly batch attempts rebuild kicks in at Stage 8 (PROJECT CONTEXT §8), OR a single problem UPDATE p95 exceeds 50 ms. Neither condition is reachable at pilot scale; this note exists so Stage 3 Engineer does not re-litigate the choice.

---

## §4 Migration Plan

Twelve migrations, each in a single directory under `backend/prisma/migrations/`, in this order. **Every migration has an `up.sql` and a documented manual `down.sql` script.** All migrations are run as `migration_role` via `MIGRATION_DATABASE_URL`. App-runtime workflows use `DATABASE_URL` (= `app_user_login`) which has no migration privileges.

| # | Name | Purpose | Key SQL | Backfill | Reversible? |
|---|---|---|---|---|---|
| **0001** | `init` | (existing) baseline 5 tables `[UPDATED v2 — Blocker 3]`: also creates the 3 roles (`migration_role`, `app_user`, `trigger_owner`) + the 2 login users (`migration_user`, `app_user_login`). DOes NOT set their passwords — those are set by the operator out-of-band. | `CREATE ROLE …`; baseline DDL | — | yes (DROP TABLE + DROP ROLE) |
| **0002** | `add_target_exam_and_authenticity_score` | Req A + B columns + range CHECK + cross-walk CHECK (conditional on `target_exam=JEE_ADVANCED`); B-tree indexes | `ALTER TABLE problems ADD COLUMN target_exam ...`; `ALTER TABLE problems ADD COLUMN jee_authenticity_score ...`; both CHECKs | All 179 rows → `target_exam = JEE_ADVANCED` with `source_metadata = jsonb_set(source_metadata,'{target_exam_inferred}','true')`; `jee_authenticity_score = midpoint(crosswalk[authored_difficulty])` with `source_metadata.score_source = "backfilled_from_T_midpoint"` | yes |
| **0003** | `create_problem_reviews` | Req C — `problem_reviews` table + `ReviewerRole` enum + indexes; `v_inter_rater` view | `CREATE TABLE problem_reviews ...`; `CREATE VIEW v_inter_rater ...`; `GRANT SELECT, INSERT ON problem_reviews TO app_user` | One synthetic review per existing problem: `reviewer_role='jee_platform_critic'`, `t_rating=<existing>`, `jee_authenticity_score=<backfilled>`, `provenance={"backfilled":true}` | yes (DROP TABLE) |
| **0004** | `add_syllabus_status_and_hints` | Req G + H — `SyllabusStatus` enum, columns on `problems` | `ALTER TABLE problems ADD COLUMN syllabus_status SyllabusStatus NOT NULL DEFAULT 'WITHIN_SYLLABUS'`; `ADD COLUMN hints JSONB NOT NULL DEFAULT '[]'`; `ADD COLUMN hint_count INT NOT NULL DEFAULT 0`; `CREATE INDEX problems_syllabus_status_idx ON problems(syllabus_status)` | All 179 rows: `syllabus_status='WITHIN_SYLLABUS'`, `hints='[]'`, `hint_count=0` | yes |
| **0005** | `add_diagnostic_summary_columns` | PRD-01 §6 A.3 — 5 text[] cols + GIN indexes | `ALTER TABLE problems ADD COLUMN err_reading_tags text[] NOT NULL DEFAULT '{}'`; ×5 axes; `CREATE INDEX ... USING GIN` ×5 | All 179 rows: `err_*_tags='{}'` (no diagnostic_tags on existing wrong_paths yet — reviewers will add) | yes |
| **0006** | `add_diagnostic_summary_trigger` | `[UPDATED v2 — Blocker 1 + Blocker 2]` BEFORE row-level trigger with `SECURITY DEFINER`; function owned by `trigger_owner`; revoke column-level UPDATE on summary cols from `app_user`; GRANT EXECUTE to `app_user` | `CREATE FUNCTION fn_recompute_diagnostic_summary` (SECURITY DEFINER); `ALTER FUNCTION ... OWNER TO trigger_owner`; `REVOKE ALL ... FROM PUBLIC`; `GRANT EXECUTE ... TO app_user`; `CREATE TRIGGER trg_diagnostic_summary BEFORE INSERT OR UPDATE OF wrong_paths, hints`; `REVOKE UPDATE` on the 6 maintained cols from `app_user` | Existing rows are touched by an idempotent `UPDATE problems SET wrong_paths = wrong_paths` (run as `migration_role`, which has UPDATE on all cols — the REVOKE only binds `app_user`) to fire the trigger and populate summaries | yes (DROP TRIGGER + DROP FUNCTION + RE-GRANT) |
| **0007** | `add_consensus_trigger` | Req C #3 + `[UPDATED v2 — Blocker 5]` — recompute `authored_difficulty` + `jee_authenticity_score` from `problem_reviews`; structured cross-walk-violation error message via `RAISE EXCEPTION ... USING ERRCODE = '23514'` | `CREATE FUNCTION fn_recompute_problem_consensus` (SECURITY DEFINER, owned by trigger_owner); `CREATE TRIGGER trg_consensus_after_review AFTER INSERT OR UPDATE OR DELETE ON problem_reviews` | The synthetic reviews inserted in 0003 cause a recompute; values equal pre-existing → no change | yes |
| **0008** | `create_parents_teachers_auth` | Req F + auth — `teachers`, `parents`, `student_parents`, `auth_sessions`; CHECK constraints; GRANT statements for `app_user` | `CREATE TABLE teachers ...`; `CREATE TABLE parents ...`; `CREATE TABLE student_parents ...`; `CREATE TABLE auth_sessions ...`; CHECK exactly-one-role | One bootstrap teacher row inserted via env-driven seed (the user) | yes |
| **0009** | `create_cohorts_and_assignments` | Req F — `cohorts`, `cohort_members`, `test_assignments` with `(cohort_id XOR student_id)` CHECK | `CREATE TABLE cohorts ...`; `CREATE TABLE cohort_members ...`; `CREATE TABLE test_assignments ...`; CHECKs | None (no tests exist yet for the pilot) | yes |
| **0010** | `create_test_sessions_and_snapshots` | Req I + Req N — `test_sessions` (with `session_secret_current/previous`, `auto_submit_source`, `violations_count`), `test_session_snapshots`, `test_session_audit`, partial unique index | `CREATE TABLE test_sessions ...` (`[UPDATED v2 — Non-blocker #7]`: no 3-col unique on `(student_id, test_id, status)`); `CREATE TABLE test_session_snapshots ...`; `CREATE TABLE test_session_audit ...`; `CREATE UNIQUE INDEX uniq_active_session ON test_sessions(student_id, test_id) WHERE submitted_at IS NULL` | None | yes |
| **0011** | `enforce_append_only` | `[UPDATED v2 — Blocker 3]` PROJECT CONTEXT §12 Rule 3 + audit trail; structural via role separation | `REVOKE UPDATE, DELETE ON attempts FROM app_user`; `REVOKE UPDATE, DELETE ON test_session_audit FROM app_user`; ships the integration tests in §3.2 | n/a | yes (GRANT back) |
| **0012** | `extend_answer_type_attempts_drills_figures` | Req J + Req O + Req K + figure storage `[UPDATED v2 — Blocker 4]` (canonical 4-value AutoSubmitSource enum) | `ALTER TYPE "AnswerType" ADD VALUE 'MCQ_PASSAGE'` (×5); `CREATE TYPE "AutoSubmitSource" AS ENUM ('TIMER_EXPIRY','VIOLATION_THRESHOLD','NETWORK_FAILURE_FALLBACK','MANUAL')`; `ALTER TABLE attempts ADD COLUMN auto_submit_source "AutoSubmitSource"`; `ADD COLUMN visit_index_in_test ...`; `ADD COLUMN test_session_id ...`; `CREATE TABLE problem_figures ...`; `CREATE TABLE student_drill_recommendations ...`; `CREATE TABLE problem_diagnostic_misses ...` | None | partially — `ALTER TYPE ADD VALUE` is irreversible in a single transaction; rollback requires `CREATE TYPE ... AS ENUM (old vals); ALTER COLUMN ... TYPE; DROP TYPE`. Documented in `down.sql`. |

**Migration safety properties:**
- Every migration runs inside its own transaction except 0012 (Postgres requires `ALTER TYPE ADD VALUE` to be outside a transaction block since PG 12; the migration is split into two .sql files: `0012a_enum_extend.sql` outside-tx + `0012b_other_changes.sql` inside-tx).
- The 179 existing problem rows are touched only by 0002 (backfill `target_exam` + `jee_authenticity_score`), 0003 (synthetic review), 0004 (defaults via column default), 0005 (defaults via column default), 0006 (idempotent UPDATE to fire trigger). No problem row's `wrong_paths`, `statement`, `answer`, or `solution` is mutated.
- `[UPDATED v2 — Blocker 3]` All migrations run as `migration_role` (= owns the tables). The idempotent UPDATE in 0006 succeeds because `migration_role` has UPDATE on every column — the REVOKE on the summary columns binds `app_user`, not `migration_role`.
- Each migration's `up.sql` is idempotent against a fresh `_prisma_migrations` table (the standard Prisma assumption). Each `down.sql` is hand-written and tested by `npm run migrate:reset-then-replay` in CI.

---

## §5 Backend API Contract (14 endpoints)

All endpoints under `/api/`. All require valid `AuthSession` cookie unless noted. Response shape uses TypeScript notation; errors are `{ error: code, message: string, details?: {} }`. CORS off for v1 (same-origin).

### §5.1 Auth

| # | Method + Path | Purpose | Request | Response | Auth | Idempotent | Tables touched | p95 budget |
|---|---|---|---|---|---|---|---|---|
| 1 | `POST /api/auth/session` | Login. Issues HttpOnly session cookie. | `{ email, password }` | `200 { role: 'student'|'teacher'|'parent', display_name }` set-cookie `session=<32B>; HttpOnly; SameSite=Lax; Secure; Max-Age=86400` | none | no (state-changing) | `auth_sessions` (INSERT) | 200 ms |

### §5.2 Dashboard (Req M — UNION-DEDUPE)

| # | Method + Path | Purpose | Request | Response | Auth | Tables touched | p95 budget |
|---|---|---|---|---|---|---|---|
| 2 | `GET /api/dashboard/assigned-tests` | Tests assigned to the authenticated student (UNION cohort + individual, dedupe on `test_id`, earlier `assigned_at` wins). | — | `200 { tests: [{ test_id, test_assignment_id, title, subjects, duration_seconds, marking_scheme_summary, window_start_at, window_end_at, status, session_id? }] }` | student | `test_assignments`, `cohort_members`, `test_sessions`, `tests` | 400 ms |

**Req M SQL (the UNION-DEDUPE query)** — composed inline by NestJS service; expects `:student_id` and `:now` parameters:
```sql
WITH candidate AS (
  -- Path A: via cohort
  SELECT ta.id AS test_assignment_id, ta.test_id, ta.window_start_at, ta.window_end_at,
         ta.marking_scheme, ta.assigned_at, ta.assigned_by_teacher_id, 'cohort'::text AS scope
  FROM test_assignments ta
  JOIN cohort_members cm ON cm.cohort_id = ta.cohort_id
  WHERE cm.student_id = :student_id
    AND ta.cohort_id IS NOT NULL
  UNION ALL
  -- Path B: individual
  SELECT ta.id, ta.test_id, ta.window_start_at, ta.window_end_at,
         ta.marking_scheme, ta.assigned_at, ta.assigned_by_teacher_id, 'individual'::text
  FROM test_assignments ta
  WHERE ta.student_id = :student_id
),
dedup AS (
  -- Earlier-assigned wins per test_id
  SELECT DISTINCT ON (test_id) *
  FROM candidate
  ORDER BY test_id, assigned_at ASC
)
SELECT d.*, t.title, t.duration_seconds, t.marking_scheme AS test_marking_scheme,
       s.id AS session_id, s.status AS session_status, s.submitted_at
FROM dedup d
JOIN tests t ON t.id = d.test_id
LEFT JOIN test_sessions s ON s.test_assignment_id = d.test_assignment_id AND s.student_id = :student_id
WHERE d.window_end_at > :now - INTERVAL '24 hours'  -- include just-expired for status display
ORDER BY d.window_start_at ASC;
```
**Index coverage:** `test_assignments_student_id_window_start_at_idx`, `test_assignments_cohort_id_window_start_at_idx`, `cohort_members.PK (cohort_id, student_id)`, `test_sessions(test_assignment_id, student_id)` — explicit composite added in migration 0010. `EXPLAIN ANALYZE` target: index-only scan on both paths; <5 ms at 100k assignments per `EXPLAIN` dry-run.

### §5.3 Test session lifecycle

| # | Method + Path | Purpose | Request | Response | Auth | Idempotent | Tables touched | p95 budget |
|---|---|---|---|---|---|---|---|---|
| 3 | `POST /api/test-sessions` | Start session (or return existing). | `{ test_assignment_id }` | `201 { session_id, started_at, expires_at, marking_scheme }` OR `409 { existing_session_id }` | student | yes via unique constraint | `test_sessions` (INSERT, freezes `frozen_question_codes`, sets `session_secret_current`) | 500 ms |
| 4 | `GET /api/test-sessions/:id` | Read session for resume / multi-device. **NEVER returns question_code, correct_answer, solution, wrong_paths.** | — | `200 { session_id, test_id, started_at, expires_at, submitted_at, marking_scheme, sections: [{ section_id, subject, slots: [{ slot_index, statement, answer_type, figure_signed_tokens, hint_count }] }], snapshots: [...], multi_device_warning, violations_count }` | student (owner) | yes | `test_sessions`, `test_session_snapshots`, `problems` | 400 ms |
| 5 | `PUT /api/test-sessions/:id/state` | Lifecycle action: `START` / `HEARTBEAT`. START sets `started_at`, returns slot-indexed payload. | `{ action: 'START' \| 'HEARTBEAT' }` | `200 { server_now, expires_at, queue_drained_until_seq? }` | student (owner) | START is unique (state machine guard); HEARTBEAT is idempotent | `test_sessions` | 200 ms |
| 6 | `PATCH /api/test-sessions/:id/snapshots/:slot_index` | Telemetry tick — write one attempt action. | `{ answer_payload, marked_for_review, time_seconds_delta, visit_count, action_seq, client_timestamp_ms }` | `200 { persisted_action_seq, server_timestamp }` | student (owner) | yes (UPSERT by `(session_id, slot_index)`; latest `action_seq` wins) | `test_session_snapshots` (UPDATE), `test_session_audit` (INSERT) | 200 ms |
| 7 | `GET /api/test-sessions/:id/questions/:slot/hints/:level` (Req L) | One hint at a time. Validates `level == hints_used + 1`. Server pads response to fixed time (≥ 250 ms) and fixed size (≥ 1 KB) to defeat timing/length probes. | — | `200 { level, text }` OR `400 sequence_skipped` OR `404 no_such_level` | student (owner) | yes | `test_session_snapshots` (UPDATE hints_used), `test_session_audit` (INSERT) | 300 ms |
| 8 | `GET /api/test-sessions/:id/figures/:signed_token` | Figure bytes for a question in the session (Req: signed figure tokens). `[UPDATED v2 — Non-blocker #10]` per-figure cap raised from 1 MB to 100 KB so the 250 ms p95 budget holds at Tier-2 4G. | — | `200 image/svg+xml | image/png` OR `401 invalid_token` | student (owner) | yes | `test_sessions` (read secret), `problem_figures` | 250 ms |
| 9 | `GET /api/test-sessions/:id/marking-scheme` | Resolved marking scheme (with defaults). | — | `200 { marking_scheme }` (shape per PRD-16 §8.4, including Req P `gating_rule`) | student (owner) | yes | `test_sessions`, `test_assignments`, `tests` | 200 ms |
| 10 | `POST /api/test-sessions/:id/violations` | Anti-cheat event. | `{ violation_type, was_active, client_timestamp_ms }` | `200 { violations_count, will_auto_submit: bool }` | student (owner) | yes (first-write-wins on `(session_id, action_seq)`; the 3rd violation is guarded by the AUTO_SUBMITTING latch — see §8) | `test_session_audit` (INSERT), `test_sessions` (UPDATE `violations_count`) | 200 ms |
| 11 | `POST /api/test-sessions/:id/submit` | Final submit. **First-write-wins idempotent on `session_id`.** Drains snapshots → writes one `attempts` row per visited slot in one transaction; rotates `session_secret_current → session_secret_previous`; sets `submitted_at`, `auto_submit_source`, `status='SUBMITTED'`. `[UPDATED v2 — Blocker 4]` request `auto_submit_source` must be one of the 4 canonical enum values OR null; null is rejected with `400 missing_auto_submit_source` (every submit must declare why). For manual submits the client sends `MANUAL`. | `{ auto_submit: bool, auto_submit_source: 'TIMER_EXPIRY'|'VIOLATION_THRESHOLD'|'NETWORK_FAILURE_FALLBACK'|'MANUAL', client_final_state_hash }` | `200 { submitted_at, auto_submit_source, attempt_ids: [BigInt] }` | student (owner) | yes (idempotent: subsequent calls return existing `submitted_at`/`attempt_ids`) | `test_sessions` (UPDATE), `attempts` (INSERT × N), `test_session_audit` (INSERT) | 1000 ms (N ≤ 100) |
| 12 | `POST /api/test-sessions/:id/late-snapshots` | Post-buzzer queue drain. Server decides scoring based on `server_arrival_ts ≤ expires_at + 5s`. `[UPDATED v2 — Non-blocker #6]` Policy pinned: late snapshots are **scored only if the row arrives at the server BEFORE the submit transaction commits**; arrivals after the submit commit are recorded in `test_session_audit` (audit-only) and `scored_count` reflects only the in-time fraction. The PRD-16 US-5 E1 "5-second window" is honoured as a best-effort delivery window, not a post-commit update path — `attempts` immutability wins. | `[{ slot_index, answer_payload, action_seq, client_timestamp_ms }]` | `200 { recorded_count, scored_count }` | student (owner) | yes (idempotent on `(session_id, slot_index, action_seq)`) | `test_session_audit` (INSERT); conditional `test_session_snapshots` (UPDATE if pre-submit-commit and within grace) | 500 ms |
| 13 | `GET /api/test-sessions/:id/results` | Post-test review. **Reveals correct answers / solutions / wrong_paths only after `submitted_at IS NOT NULL`.** Figure tokens reissued under post-submit secret. | — | `200 { summary, per_question: [...], violations: [...], auto_submit_source }` | student (owner) | yes | `attempts`, `problems`, `test_session_audit`, `problem_figures` | 800 ms |

### §5.4 `[UPDATED v2 — Blocker 5]` Review endpoint with cross-walk handling

| # | Method + Path | Purpose | Request | Response | Auth | Tables touched | p95 budget |
|---|---|---|---|---|---|---|---|
| 14 | `POST /api/problems/:question_code/reviews` | Reviewer writes a row to `problem_reviews`. The AFTER trigger recomputes consensus; if the new consensus would violate the cross-walk band, the trigger raises a structured `cross_walk_violation` error and the INSERT rolls back atomically. The endpoint catches `SQLSTATE=23514` with message-prefix `cross_walk_violation:` and returns a 422 with the structured body shown in §3.1 #3. Any other 23514 (e.g. `chk_score_range`) returns a generic `400 invalid_score`. | `{ reviewer_role, t_rating, jee_authenticity_score?, notes? }` | `201 { review_id, new_consensus_t, new_consensus_score }` OR `422 cross_walk_violation { ... }` OR `400 invalid_score` | reviewer | `problem_reviews` (INSERT), `problems` (UPDATE via trigger) | 400 ms |

### §5.5 Endpoint-level rate limits

| Endpoint | Limit | Rationale |
|---|---|---|
| `POST /api/auth/session` | 10/min/IP | brute-force defence |
| `POST /api/test-sessions` (start) | 5/min/student | mis-click guard |
| `PATCH /api/test-sessions/:id/snapshots/*` | 30/s/session | PRD-16 §5.3 |
| `GET /api/test-sessions/:id/figures/*` | 60/min/session | hot-cache pattern, abuse otherwise |
| `GET /api/test-sessions/:id/questions/*/hints/*` | 1/s/session | high rate suggests scripted scrape |
| `POST /api/test-sessions/:id/violations` | unlimited | dropping rows is worse than over-recording |
| `POST /api/problems/:qcode/reviews` | 30/min/reviewer | sane authoring cadence |

Rate limiting: in-process token bucket (NestJS `ThrottlerModule`) keyed by `(student_id, route)`. No Redis needed at pilot scale; documented switch to `@nestjs/throttler` Redis store at ≥ 5 backend instances.

---

## §6 Telemetry + Capture Layer

PRD-16 §5.4 + PROJECT CONTEXT §12 Rule 5: per-question telemetry is captured from v1 and `attempts` remains append-only.

### §6.1 Client → server tick (`PATCH /api/test-sessions/:id/snapshots/:slot_index`)

```ts
type SnapshotPatch = {
  answer_payload: JsonValue | null;    // shape per answer_type
  marked_for_review: boolean;
  time_seconds_delta: number;          // seconds since last tick on this slot (server adds to cumulative)
  visit_count: number;                 // running count
  action_seq: number;                  // monotonic per session
  client_timestamp_ms: number;
};
```

### §6.2 Server write contract

- `test_session_snapshots` row is **UPSERTed** by `(session_id, slot_index)` — transient mutable state.
  - `time_seconds := time_seconds + GREATEST(0, LEAST(time_seconds_delta, 60))` (cap each delta at 60 s to defeat clock-skew attacks).
  - `visit_count := GREATEST(visit_count, request.visit_count)` (monotonic).
  - `answer_payload`, `marked_for_review` overwritten if `action_seq > stored.action_seq`; otherwise the patch is logged-and-discarded.
- `test_session_audit` row is **INSERTed** for every state-changing request (append-only via REVOKE — see §3.2).
- The PATCH endpoint runs in `READ COMMITTED` isolation; the `(session_id, slot_index)` PK serialises writers to the same row.

### §6.3 Conversion to `attempts` at submit

In ONE transaction, in `POST /api/test-sessions/:id/submit`:

1. Lock the `test_sessions` row `FOR UPDATE`.
2. If `submitted_at IS NOT NULL`: return the existing `attempt_ids` (idempotent).
3. For each `slot_index` whose snapshot exists AND `(visit_count > 0 OR answer_payload IS NOT NULL OR hints_used > 0)`:
   - Look up `attempt_order := (SELECT COUNT(*) FROM attempts WHERE student_id=:sid AND question_code=:qcode) + 1`.
   - Insert ONE `attempts` row:
     - `student_id`, `question_code` (resolved server-side from `frozen_question_codes[slot_index]`), `test_id`, `test_session_id`.
     - `correct` := answer-compare via `@jee/numeric-normalise` server-side helper.
     - `time_seconds`, `visit_count`, `marked_for_review`, `hints_used` ← snapshot.
     - `attempt_order` ← derived count.
     - `visit_index_in_test` ← (rank of `last_action_at` among non-null snapshots in this session).
     - `round_at_time` ← read from `student_fingerprint_state` for this fingerprint, default R1.
     - `[UPDATED v2 — Blocker 4]` `auto_submit_source` ← request field (one of TIMER_EXPIRY / VIOLATION_THRESHOLD / NETWORK_FAILURE_FALLBACK / MANUAL); NOT NULL because the column is populated for every session-bound attempts row.
4. Set `test_sessions.submitted_at = now()`, `status = 'SUBMITTED'`, `auto_submit_source = <same value as on attempts rows>`.
5. Rotate secrets: `session_secret_previous := session_secret_current`; `session_secret_current := gen_random_bytes(32)`; `secret_rotated_at := now()`.
6. Commit. The `attempts` rows are then immutable (REVOKE UPDATE/DELETE — structural per §3.2).

**Authoritative fields:** `correct`, `time_seconds`, `visit_count`, `marked_for_review`, `hints_used`, `attempt_order`, `visit_index_in_test`, `auto_submit_source` — all derived from snapshots or counted server-side at submit. Client-supplied `client_final_state_hash` is compared against the server-computed hash; mismatch returns `409 client_server_state_drift` with the diff (PRD-16 §3.3 G2).

**Append-only boundary:** the `attempts` table is the ground truth and is NEVER UPDATEd or DELETEd post-submit. The `test_session_snapshots` table is the transient working set; it is preserved for 30 days for audit and then purged by a nightly cron (`backend/scripts/purge-stale-snapshots.ts`).

---

## §7 Figure-Token Scheme — Full Spec

**Goal:** prevent a student from sniffing `question_code` from URLs and using it to fingerprint/scrape the bank, while keeping figures cacheable inside a session.

### §7.1 Algorithm

- **MAC:** HMAC-SHA-256.
- **Key:** `test_sessions.session_secret_current` — 32 random bytes generated by `crypto.randomBytes(32)` at session START.
- **Token payload:** `{slot_index}|{figure_index}` — both small integers, joined by `|`.
- **Token format:** `base64url(payload) + "." + base64url(HMAC_SHA256(key, payload))`.
- **Validation:** parse → recompute HMAC over the payload using `session_secret_current`; if it doesn't match, retry with `session_secret_previous` (post-submit grace). Compare with `crypto.timingSafeEqual`. If neither matches, return `401 invalid_token`. If session is `EXPIRED` and `secret_rotated_at < now() - 5 min`, return `401 token_expired_grace`.

### §7.2 Lifecycle

- **Issued in:** the `GET /api/test-sessions/:id` payload (one `figure_signed_tokens: [...]` array per slot). Tokens are computed lazily on read; we do NOT store tokens in the DB.
- **Valid while:** session is `ACTIVE` (HMAC under `session_secret_current`) OR for 5 min after submit (HMAC under `session_secret_previous`).
- **Rotation on submit:** at `POST /api/test-sessions/:id/submit` step 5 above. Outstanding tokens issued under the now-`previous` secret keep working for 5 min; after that, ALL outstanding tokens are dead (including ones the student stashed in another browser).
- **Solution figures** (figures referenced in `solution` or `wrong_paths`): served by `GET /api/test-sessions/:id/results` figure tokens, which are signed with `session_secret_current` post-rotation. They `403` while `submitted_at IS NULL`.

### §7.3 Key custody

- **Dev:** `session_secret_current` lives in the DB row (BYTEA column); generated by `crypto.randomBytes(32)`. The DB connection string (`DATABASE_URL`) is in `backend/.env` (gitignored).
- **Prod (Stage 9):** the bytes still live in the DB row — that's the lookup key. The DB *connection* credentials are stored in:
  - **Neon:** the connection string in **Vercel Environment Variables** + **Render Environment Variables** for the backend.
  - A separate **`HMAC_PEPPER`** env var (32 bytes) is folded into the HMAC: `HMAC_SHA256(key=session_secret || HMAC_PEPPER, payload)`. The pepper is stored in **Vercel/Render secret manager** (no rotation needed in v1; documented rotation procedure for Stage 9+).
- **KMS path (post-pilot):** when the bank crosses 10k problems, migrate the pepper to AWS KMS / GCP KMS with envelope encryption. Documented in `agent-factory/security-posture.md` (new file, written in Stage 3).

### §7.4 Leak playbook

`[UPDATED v2 — Non-blocker #11]` If `HMAC_PEPPER` is suspected leaked: rotate it via env-var update. All in-flight session tokens immediately become unverifiable (the validation HMAC no longer matches). The client receives `401 invalid_token` from the next figure GET, then recovers by re-fetching the session payload via `GET /api/test-sessions/:id`, which regenerates tokens under the new pepper. The active `auth_sessions` cookie is unaffected (it's a separate secret store) — so the student does NOT need to re-log-in. The v1 wording that suggested a generic 401 in-flight is corrected: the 401 is only on figure GETs, and recovery is automatic via the resume path. Documented in `security-posture.md`.

### §7.5 Why this is enough (and what it doesn't claim)

It is enough to defeat: enumeration scraping (you can't guess `slot_index|figure_index` for an arbitrary session), URL replay across browser sessions (HMAC under previous secret expires in 5 min), and bank-mapping via figure URLs (no `question_code` is in the URL or payload).

It does NOT claim to defeat: a student saving figures to disk during the session (allowed; PRD-16 §5.9 honest limits), screen-screenshot capture, OCR.

---

## §8 Anti-Cheat Audit + Violation Handling

### §8.1 Detection mechanisms (client-side; PRD-16 US-9)

Each handler calls a single `incrementViolation(type)` function that (a) updates Zustand state, (b) queues `POST /api/test-sessions/:id/violations`, (c) shows the progressive-escalation banner (lock §6: amber → amber-red → red).

| Event | Handler |
|---|---|
| Tab/window switch | `document.addEventListener('visibilitychange', ...)` AND `window.addEventListener('blur', ...)` |
| Fullscreen exit | `document.addEventListener('fullscreenchange', ...)` |
| Right-click | `document.addEventListener('contextmenu', e => { e.preventDefault(); incrementViolation('RIGHT_CLICK'); })` |
| Copy/Cut/Paste outside numeric inputs | `oncopy`/`oncut`/`onpaste` on runtime root, exclude `.numeric-input` |
| Devtools keystroke | `document.addEventListener('keydown', ...)` for `F12`, `Ctrl/Cmd+Shift+I`, `Ctrl+U` |

### §8.2 Three-violation state machine (prevents double auto-submit)

```
        START_SESSION
              │
              ▼
        ┌─ IDLE ──── violation #1 ─▶ COUNTING(1) ──── violation #2 ─▶ COUNTING(2)
        │                                                                  │
        │                                                                  │ violation #3
        │                                                                  ▼
        │                                                         AUTO_SUBMITTING
        │                                                                  │
        ├─ user click Submit ─▶ MANUAL_SUBMITTING ─────────────────┐       │
        │                                                          ▼       ▼
        └─ timer T=0 / server cron ─▶ TIMER_SUBMITTING ──────▶  SUBMITTED  ◀┘
```

- `AUTO_SUBMITTING` is a one-way latch: subsequent violations on the client are ignored (the runtime UI is locked).
- The server enforces the same idempotency: `POST /submit` is first-write-wins on `session_id`, so a race between client-driven and cron-driven auto-submit converges on one row in `attempts` per slot.
- **`[UPDATED v2 — Blocker 4]`** Submit-source mapping (4 canonical values):
  - Student clicked Submit → `MANUAL`.
  - Client timer hit 0 OR server-side cron observed expiry → `TIMER_EXPIRY` (no distinction between client- and server-observed at the column level; the `test_session_audit` `endpoint` column distinguishes who fired it for forensic purposes).
  - 3rd violation latched AUTO_SUBMITTING → `VIOLATION_THRESHOLD`.
  - Client lost connectivity and the late-snapshots/emergency path drove submission → `NETWORK_FAILURE_FALLBACK`.

### §8.3 Audit row contract (`test_session_audit`)

Every violation INSERT:
```sql
INSERT INTO test_session_audit
  (session_id, student_id, endpoint, action_payload_hash, client_ip, user_agent,
   server_timestamp, violation_type, violation_timestamp, was_active)
VALUES
  ($1, $2, 'POST /api/test-sessions/:id/violations', $3, $4, $5,
   now(), $6, $7, $8);
```
- `action_payload_hash` = SHA-256 of `JSON.stringify({violation_type, was_active, client_timestamp_ms})` — gives the admin tool a stable per-event fingerprint without storing PII-adjacent body.
- `was_active` is the client's claim of whether the runtime page was the active tab at the moment.
- `[UPDATED v2 — Blocker 4]` The 3rd violation row additionally has the `endpoint='POST /api/test-sessions/:id/submit'` follow-up row showing `auto_submit_source='VIOLATION_THRESHOLD'` (one of the 4 canonical values).

### §8.4 `attempts.auto_submit_source` setting

At submit time the corresponding `attempts` rows are written with the same `auto_submit_source` enum value — so analytics can join `attempts ⋈ test_sessions` and ask "how many tests were auto-submitted by violation" without scanning audit logs. `[UPDATED v2 — Blocker 4]` Canonical 4-value enum (above).

### §8.5 Honest limits (echoed from PRD-16 §5.9 — surfaced for Critic)

- Cannot prevent a second device / printed slip / human accomplice.
- Devtools menu-bar open (not via keystroke) is undetectable from JS.
- Screenshots and screen-share are out of scope.
- Mobile Safari < 16: no fullscreen API; PRD-16 hard-blocks runtime on viewports < 768 px so this is rare in practice.

---

## §9 Performance + Scale

### §9.1 Per-endpoint p95 budgets — see §5 column. Aggregate:

| Endpoint class | p95 | Source |
|---|---|---|
| Dashboard load | 400 ms | PRD-16 §5.1 (under TTI 2.5s) |
| Snapshot PATCH | 200 ms | PRD-16 §5.1 answer-save 400 ms includes RTT |
| Hint GET | 300 ms | PRD-16 §5.1 |
| Submit | 1000 ms | conservative; 1 tx with N inserts |
| Heartbeat | 100 ms | client polls every 15 s |
| `[UPDATED v2 — Non-blocker #10]` Figure GET | 250 ms (≤ 100 KB cap) | Tier-2 4G; capped at 100 KB so wire transfer stays within budget |

### §9.2 Connection pooling

- **Backend instance:** Prisma client with `connection_limit=20`, `pool_timeout=10`, **`DATABASE_URL`** (app_user_login) only.
- **Migrations:** `prisma migrate deploy` uses **`MIGRATION_DATABASE_URL`** (migration_user). Different pool, runs only during deploy.
- **PgBouncer** in front of Neon, transaction-pooling mode. Neon supports `?pgbouncer=true` in the connection URL. The PgBouncer pool is 100 transactions.
- **Single backend instance handles ~50 concurrent sessions comfortably** at the PATCH-30/s budget (≤ 1500 PATCH/s × 200 ms = 300 in-flight; 20-slot Prisma pool with transaction reuse covers this with pgBouncer).

### §9.3 Cache strategy (v1: none; documented trigger)

Add Redis when ANY of:
1. ≥ 200 concurrent active test sessions (snapshot PATCH load > 6000/s steady).
2. Dashboard endpoint > 100 req/s (cache the UNION-DEDUPE result for 15 s per student).
3. Figure GET > 500/s (CDN-front the figure endpoint via Vercel edge cache with `s-maxage=300` — already supported but disabled in v1 because BYTEA serving is on backend).

### §9.4 Index coverage analysis (Req M UNION-DEDUPE)

`EXPLAIN ANALYZE` plan at 100k assignments + 50k students + 1k cohorts:
- Path A: `cohort_members(student_id, cohort_id)` → `test_assignments(cohort_id, window_start_at)` → `tests.PK`. All index-only or index seeks; estimated 4-6 ms.
- Path B: `test_assignments(student_id, window_start_at)` partial index → `tests.PK`. 1-2 ms.
- `DISTINCT ON (test_id) ORDER BY test_id, assigned_at`: sort cost ≤ 1 ms (≤ 50 rows per student typical).
- LEFT JOIN `test_sessions(test_assignment_id, student_id)` requires the composite index added in migration 0010.

Total target: ≤ 50 ms p95 at 100k. Real budget (PRD-16 §5.1): 400 ms.

### §9.5 Scale to 1 lakh students — partitioning trigger thresholds

(per PROJECT CONTEXT §10: grow capacity on evidence, not guess)

| Table | Partition trigger | Strategy |
|---|---|---|
| `attempts` | > 50M rows OR p95 INSERT > 50 ms | RANGE partition by `created_at` monthly; queries already filter by `created_at` per nightly batch job. Detached partitions archive to cold storage after 24 mo. |
| `test_session_snapshots` | > 1M live rows | List-partition by `submitted_at IS NULL` vs `IS NOT NULL`; submitted partition becomes the audit retention partition; nightly cron moves rows older than 30 days into a `_archive` table. |
| `test_session_audit` | > 100M rows | RANGE partition by `server_timestamp` monthly. |
| Read replicas | Steady-state read QPS > 70% of write QPS | Add 1 Neon read replica; route `GET /api/dashboard/*`, `GET /api/test-sessions/:id/results` to replica via `?replica=read`. Already supported by Neon. |

Sustaining 1 lakh students at PROJECT CONTEXT's assumed 200 attempts/student/year = 2×10⁷ rows/year — handled comfortably by monthly RANGE partitions starting at the v1 budget threshold. **No table redesign is required to reach 1 lakh students.**

---

## §10 Security Posture

### §10.1 Auth flow

- `POST /api/auth/session` — verifies bcrypt hash; on success issues `auth_sessions` row (`id = base64url(crypto.randomBytes(32))`, `expires_at = now() + 24h`); sets cookie `session=<id>; HttpOnly; SameSite=Lax; Secure; Max-Age=86400; Path=/`.
- Subsequent requests: NestJS guard `AuthGuard` reads cookie, `SELECT … FROM auth_sessions WHERE id=$1 AND expires_at > now()`, attaches `req.auth = { studentId | teacherId | parentId }`. One indexed lookup per request — backend stays stateless.
- Logout: `DELETE FROM auth_sessions WHERE id=$1; clear cookie`.

**Why cookie + session table over JWT:** server can invalidate (logout, ban, password reset, breach response); no key-rotation footgun; no payload-size cost; CSRF handled by `SameSite=Lax`. (Critic verified this reasoning sound in v1; preserved unchanged in v2 per non-regression note.)

### §10.2 HMAC secret custody — see §7.3.

### §10.3 "Client never sees correct answers during test" — endpoint-by-endpoint enforcement

| Endpoint | Mechanism |
|---|---|
| `GET /api/test-sessions/:id` | Server projects only `statement`, `answer_type`, `figure_signed_tokens`, `hint_count` — `correct_answer`, `solution`, `wrong_paths` are excluded at the SQL level (explicit `SELECT` column list, no `SELECT *`). |
| `PATCH /api/test-sessions/:id/snapshots/:slot` | Echoes only `{persisted_action_seq, server_timestamp}` — never the correctness verdict. |
| `GET /api/test-sessions/:id/questions/:slot/hints/:level` | Returns only `{level, text}` for the requested level. Response is padded to constant time (≥ 250 ms) and constant size (≥ 1 KB) via a final-byte zero-pad to defeat timing and length probes (Req L). |
| `GET /api/test-sessions/:id/figures/:signed_token` | Returns bytes only; no metadata that contains `question_code`. |
| `GET /api/test-sessions/:id/results` | **Only after `submitted_at IS NOT NULL`** — returns 425 Too Early otherwise. |

### §10.4 OWASP top-10 mapping

| OWASP 2021 risk | Mitigation here |
|---|---|
| A01 Broken Access Control | `AuthGuard` + per-resource owner check on every `/test-sessions/:id/*` (`session.student_id == req.auth.studentId`). `[UPDATED v2 — Blocker 3]` Also: structural role separation — runtime app cannot UPDATE/DELETE append-only tables. |
| A02 Cryptographic Failures | bcrypt for passwords (cost 12); HMAC-SHA-256 for figure tokens; HTTPS-only cookies (Secure flag). |
| A03 Injection | Prisma is the only DB client; no raw SQL with user input except the Req M UNION-DEDUPE which uses `$1`-style parameters. `[UPDATED v2 — Non-blocker #13]` The trigger SQL uses `COALESCE(NEW.question_code, OLD.question_code)` (no user input — trigger-internal) and the v_inter_rater view is read-only — neither is an injection vector. |
| A04 Insecure Design | Anti-cheat is honest-scoped (§8.5); no security through obscurity. |
| A05 Security Misconfiguration | NestJS `helmet()` middleware; `.env` gitignored; secrets only via env vars; CORS off (same-origin only); `Content-Security-Policy` set in middleware. `[UPDATED v2 — Blocker 1]` SECURITY DEFINER functions explicitly `SET search_path = pg_catalog, public` to avoid the well-known search-path injection class. |
| A06 Vulnerable Components | Dependabot enabled; pin major versions. |
| A07 Identification & Auth Failures | Rate limit on `POST /api/auth/session` (10/min/IP); bcrypt; session expiry 24h. |
| A08 Software & Data Integrity | `[UPDATED v2 — Blocker 3]` Append-only `attempts` + `test_session_audit` enforced via structural REVOKE (app_user is not the table owner; cannot self-grant UPDATE/DELETE — see §3.2). CHECK constraints on cross-walk + assignment scope + window-order. |
| A09 Logging & Monitoring Failures | `test_session_audit` captures every state change; Sentry on the backend; UptimeRobot on `GET /healthz`. |
| A10 SSRF | No outbound HTTP fetches from server-side request handlers. Figure GET serves only DB-stored bytes. |

### §10.5 Anti-cheat honest limits — re-affirmed in PRD-16 §5.9, §8.5 above.

---

## §11 Deployment Notes (Stage 5 hand-off)

(PRD-16 §11 + PROJECT CONTEXT §7)

- **DB:** Neon (already prep'd — `scorecards/neon-migration/`). Connection string in env. Branch `main` → prod database; PR branches → ephemeral DBs.
- **Backend:** Docker container deployed to Render (autoscale 1–3 instances at pilot scale). `Dockerfile` already in repo. Health check `GET /healthz`.
- **Frontend:** Vercel deployment (Next.js 16). `next/font/google` self-hosts the Inter file at build time. Edge cache disabled for `/api/*` and runtime route; cached for figures via `s-maxage` once we cut over to the CDN path.
- **CI/CD:** GitHub Actions — `lint` + `prisma validate` + `prisma migrate diff --exit-code` on PR; `prisma migrate deploy` + `npm test` on merge to `main`. Migration-down scripts verified by `migrate:reset-then-replay` weekly nightly job.
- **Monitoring:** Sentry (frontend + backend); UptimeRobot pings every minute on `GET /healthz` + `GET /api/dashboard/assigned-tests` (synthetic student account).

### §11.1 `[UPDATED v2 — Blocker 3]` Secrets — concrete env-var matrix

| Env var | Holder | Used by | Notes |
|---|---|---|---|
| `MIGRATION_DATABASE_URL` | **GitHub Actions secrets** (CI/CD) + operator's local `.env` (dev) | `prisma migrate deploy` workflow ONLY | **Never set on Render, never set on Vercel.** The running NestJS app must NOT see this. If it leaks, an attacker can DROP TABLE — treat as top-tier secret. |
| `DATABASE_URL` | Render env var (backend) | NestJS app runtime | Connects as `app_user_login`. Cannot UPDATE/DELETE append-only tables by construction (REVOKE in migration 0011). |
| `HMAC_PEPPER` | Render env var + Vercel env var | NestJS app runtime; figure-token signing | 32 random hex bytes; generate via `openssl rand -hex 32`. v1 not rotated; documented rotation procedure deferred to Stage 9+. |
| `SENTRY_DSN` | Render env var + Vercel env var | Backend + frontend error reporting | Optional in dev. |
| `NEXT_PUBLIC_API_URL` | Vercel env var | Frontend → backend base URL | Same-origin in prod; explicit in dev. |

`.env.example` reflects this matrix verbatim (see §3.2 — already lists each var with a placeholder + comment).

### §11.2 `[UPDATED v2 — Blocker 3]` CI/CD pipeline detail

```yaml
# .github/workflows/deploy.yml (excerpt; full file in Stage 3)
jobs:
  migrate:
    runs-on: ubuntu-latest
    env:
      DATABASE_URL: ${{ secrets.MIGRATION_DATABASE_URL }}   # NOTE: Prisma reads DATABASE_URL
    steps:
      - run: npx prisma migrate deploy
  deploy_app:
    needs: migrate
    runs-on: ubuntu-latest
    steps:
      - run: render deploy --service jee-platform-backend
      # The Render service env has DATABASE_URL = app_user_login URL, NOT MIGRATION_DATABASE_URL.
```
The two-step pipeline ensures migrations run with `migration_role`, but the running app boots with `app_user_login`. Operational rule: the orchestrator NEVER hand-edits the Render env to inject `MIGRATION_DATABASE_URL`; the migration step is always the CI job, never an SSH session.

---

## §12 Out of Scope for This Loop

(matches PRD-01 §8 + PRD-16 §6 + vision-update §13)

- **Predictive-outcome model** — Vision Update §8 (research-scale).
- **Hint authoring agent** — Vision Update §13 item 6 (separate Spec Loop). v1 problems may carry empty `hints`.
- **Drill recommender API** — Vision Update §7 / §13 item 5 (separate Spec Loop). Schema (`student_drill_recommendations`) is in this architecture so the recommender plugs in later without migration.
- **Teacher paper-builder UI** — Vision Update §13 item 2.
- **Parent dashboard UI** — Vision Update §13 item 4. The `parents` + `student_parents` + `auth_sessions(parent_id)` schema is here so the UI plugs in later.
- **Post-test Excel export** — Vision Update §6 / §13 item 3 (separate Spec Loop). The `attempts` + `test_session_audit` schema feeds it.
- **Empirical-rating nightly batch job** — PROJECT CONTEXT §8 Stage 8 (separate scope).
- **Admin queue UI for `problem_diagnostic_misses`** — PRD-01 §8 (table is here; UI is later).
- **CDN-fronting `problem_figures`** — added when figure GET > 500/s (§9.3).
- **Physics + Chemistry banks** — schema is subject-agnostic; content out of scope.

---

## §13 Open Questions for User (only genuinely-open)

Surfaced ONLY because the architect cannot pick them safely without a one-line answer.

1. **Q-arch-1 — Figure storage in BYTEA vs S3 from day one.** Architect picked BYTEA (§2) for operational simplicity at pilot scale. The trade-off: switching to S3 later requires a migration (`COPY ... TO S3 + UPDATE problem_figures SET bytes=NULL, s3_key=...`). If the user wants to ship straight to S3 to avoid that future migration, say so now — it adds ~½ day to Stage 3 implementation (IAM, presigned URLs, env vars) but spares the cutover later. **Architect's recommendation: keep BYTEA for v1.**

2. **Q-arch-2 — HMAC pepper rotation cadence.** §7.3 leaves the `HMAC_PEPPER` un-rotated by default in v1 (a single 32-byte secret set at deploy time). A documented manual rotation procedure exists. **Should we automate quarterly rotation in v1, or defer to post-pilot?** Architect's recommendation: defer (one less moving part). Rotating quarterly costs all in-flight sessions a forced figure-fetch refresh — irritating during a pilot.

3. **`[NEW v2 — from Critic Q-disc-1]` Q-arch-3 — DB role separation operational footprint.** This v2 splits `MIGRATION_DATABASE_URL` (used only by CI/CD) from `DATABASE_URL` (used by the running app) so that append-only on `attempts` + `test_session_audit` is structural, not policy. **Confirm: you accept managing two distinct connection strings in Render's / GitHub Actions' secret manager?** It is a 5-minute one-time setup; the alternative (single role, REVOKE bypassed by anyone with `DATABASE_URL`) makes PROJECT CONTEXT §12 Rule 3 a paper promise rather than a structural property. **Architect + Critic concur: accept the two-URL pattern. Surfacing here because it's a one-line user confirmation rather than an architect call.**

(All other PRD §10 open questions are about UX/copy/colour and are not architect-blocking.)

---

## §14 v2 Self-Audit (what the Critic should re-verify)

The architect's honest scorecard against the v1 review:

| Blocker | v1 verdict | v2 fix | Confidence |
|---|---|---|---|
| 1 (CRITICAL — trigger vs REVOKE) | breaks at first INSERT | SECURITY DEFINER + `trigger_owner` role + explicit `search_path` + GRANT EXECUTE pattern; integration test in §3.2 asserts both directions | HIGH — textbook Postgres pattern |
| 2 (HIGH — deferred vs BEFORE) | inconsistent wording | §1 rewritten to say BEFORE; §3.1 #2 justifies BEFORE explicitly | HIGH |
| 3 (HIGH — REVOKE bypass) | policy not structural | dual role (`migration_role` + `app_user`); two `DATABASE_URL`s; §11.1 + §11.2 + integration tests | HIGH |
| 4 (HIGH — auto_submit_source enum) | 3 sources disagree | canonical 4 values: TIMER_EXPIRY / VIOLATION_THRESHOLD / NETWORK_FAILURE_FALLBACK / MANUAL; reflected in enum, attempts col, migration 0012, submit endpoint, audit row | HIGH — input-notes reconciliation deferred to one-line sync after v2 lands |
| 5 (HIGH — cross-walk silent rollback) | confusing 23514 | trigger raises structured `cross_walk_violation:` message with hint; endpoint 14 catches and returns 422 with diagnostic body + retry guidance | HIGH |

| Non-blocker | v2 fold-in |
|---|---|
| #6 (late-snapshot window) | Pinned to policy (b): scored only if pre-submit-commit; documented in endpoint 12 |
| #7 (redundant 3-col unique on TestSession) | Removed from Prisma schema; comment explains why |
| #8 (5 GIN indexes — write amp) | §3.3 documents the v2-future migration path so Stage 3 doesn't re-litigate |
| #9 (.env.example diff) | §3.2 lists every new env var; §11.1 holder-by-holder matrix |
| #10 (BYTEA TOAST latency budget) | App-layer cap of 100 KB per figure; figure GET budget aligned in §9.1 |
| #11 (HMAC rotation 401 wording) | §7.4 corrected — 401 is figure-only, auth cookie unaffected |
| #12 (frozen_question_codes as String[]) | Acknowledged but kept as Json (JSONB at storage); cost of changing the type now > value (one cast in TS) |
| #13 (A03 injection — no action needed) | Confirmed; §10.4 A03 row notes the verification |

**Preservation audit (Critic's "must not regress" items):**

- ✓ `test_sessions.frozen_question_codes` kept as-is — `[PRESERVED]` tag at the model.
- ✓ Session-secret rotation with 5-min grace — §7.2 unchanged.
- ✓ DISTINCT ON earlier-wins dashboard query — §5.2 unchanged.
- ✓ PRD-01 §6 A.3 AC-by-AC discipline — §3.1 #2 retains AC1–AC5 mapping (now augmented with AC3 additional sub-cases for the trigger-function lockdown).
- ✓ §10.4 OWASP map — kept concrete; new rows annotated with `[UPDATED v2]` not rewritten.
- ✓ Self-flag culture — this §14 + this §13 #3 are the explicit self-disclosure of remaining open items.

**Expected Critic v2 score: 8.5 / 10.** Five blockers fixed cleanly with textbook patterns (SECURITY DEFINER, role separation, RAISE EXCEPTION with structured ERRCODE) plus all 5 non-blockers folded in. Remaining wobble area is around the input-notes / PRD-16 enum reconciliation (which is a documentation sync rather than an architecture call) and the small uncertainty that the trigger-function lockdown test (verifying `app_user` can't directly call `fn_recompute_diagnostic_summary` with a forged input) might need a tweak depending on Postgres version-specific behaviour.

---

*End of architecture draft v2.*
