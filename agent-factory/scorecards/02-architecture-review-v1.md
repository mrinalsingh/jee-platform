# Architecture Review v1 — Design Critic (Discriminator)

**Stage:** 2 (Architecture Loop) | **Iteration:** v1 | **Reviewer:** Design Critic
**Artifact reviewed:** `scorecards/02-architecture-draft-v1.md` (1,237 LOC, 13 sections)
**Cross-references:** `01-prd-final.md` v3, `16-test-runtime-prd-final.md` v2,
`02-architecture-input-notes.md` Req A–P + Q, `docs/PROJECT CONTEXT.md` §6 / §12,
`backend/prisma/schema.prisma` v1.

---

## Score: 6/10

The architecture is impressively complete in surface area (13 sections, 14
endpoints, 12 migrations, both PRDs touched, all 16 input-note requirements
A–P + Q addressed). It also lands several decisions correctly and on the right
altitude: the consensus trigger over `problem_reviews` is normalised correctly,
the `frozen_question_codes` snapshot resolves the immutability question, the
session-secret rotation with 5-min grace is well thought out, and the §10.4
OWASP mapping is real not theatrical.

But three issues stop it being shippable as v1 and force a v2 round:

1. **Trigger-vs-REVOKE collision** is a real correctness bug, not a worry —
   the architecture WILL fail at first INSERT.
2. **Internal inconsistency in trigger semantics** (executive summary promises
   deferred; SQL ships BEFORE) signals the architect did not stress-test the
   shipped trigger against PRD-01 §6 A.3 AC #1.
3. **Append-only role separation** is left implicit — REVOKE is necessary but
   not sufficient without a documented split between `app_user` and the
   `migration_user` Prisma uses, and the document does not specify either.

Score breakdown: PRD compliance ≈ 8/10 (every requirement addressed at least
nominally); Data model integrity ≈ 6/10 (trigger bug pulls it down);
API design ≈ 8/10 (14 endpoints map cleanly to PRD-16); Security ≈ 6/10
(figure tokens excellent, role separation missing); Failure modes ≈ 6/10
(partition triggers and Redis triggers documented; trigger-write cascade
unanalysed); Over/under engineering ≈ 8/10 (BYTEA + no-Redis are correct
"simplest thing" calls); Buildability ≈ 7/10 (mostly buildable; the trigger
fix is one focused change away).

---

## Blocking Issues (must fix before advancing to Stage 3)

### 1. [SEVERITY: CRITICAL] Diagnostic summary trigger will fail at first write — `REVOKE UPDATE` blocks the trigger's own NEW assignment

- **Where:** §3.1 #2 (the `fn_recompute_diagnostic_summary` trigger and the
  immediately following `REVOKE UPDATE (err_reading_tags, …, hint_count) ON
  problems FROM app_user;`).
- **Why it matters:** A `BEFORE … FOR EACH ROW` trigger function in Postgres
  runs with the privileges of the invoking role by default (i.e. `app_user`),
  not the function owner. The function body assigns
  `NEW.err_reading_tags := …`, which is column-level UPDATE. The REVOKE
  immediately above forbids `app_user` from updating those columns. Result:
  every `INSERT` or `UPDATE OF wrong_paths` on `problems` from the app will
  raise `42501 insufficient_privilege` inside the trigger and the whole
  transaction will abort. The importer's first idempotent `UPDATE problems
  SET wrong_paths = wrong_paths` in migration 0006 (used to back-fill the 179
  existing rows) will fail before a single row is touched.
- **Suggested fix:** Either (a) declare the trigger function `SECURITY
  DEFINER` and `ALTER FUNCTION fn_recompute_diagnostic_summary OWNER TO
  jee_platform_owner;` so the assignment runs as a privileged role, or
  (b) drop the column-level REVOKE on the summary columns and rely on the
  service-layer write-path guard (acceptable because the trigger is `BEFORE`
  and overwrites any user-supplied value). Option (a) is the cleaner answer
  and matches AC2 (no app-side write path) literally — Postgres' SECURITY
  DEFINER pattern is the textbook way to do this. Add a CI test that
  attempts a direct `UPDATE problems SET err_reading_tags='{X}'` as `app_user`
  and asserts it fails — that test will catch this class of bug forever.

### 2. [SEVERITY: HIGH] §1 (Executive Summary) promises "deferred row-level triggers"; §3.1 #2 ships an immediate BEFORE trigger — internal inconsistency, and the PRD-01 §6 A.3 AC #1 reasoning rests on the wrong primitive

- **Where:** §1 sentence "The DB-invariant for diagnostic summary columns and
  dual-rating cross-walk is enforced via **deferred row-level triggers**"
  vs §3.1 #2 `CREATE TRIGGER trg_diagnostic_summary BEFORE INSERT OR UPDATE
  OF wrong_paths, hints ON problems FOR EACH ROW EXECUTE FUNCTION …`.
- **Why it matters:** (1) The executive summary is wrong — `BEFORE` is not
  `DEFERRABLE INITIALLY DEFERRED`; only `CONSTRAINT TRIGGER` supports
  deferral. (2) Worse, the AC #1 satisfaction argument ("same-transaction
  consistency so a reader committing after the writer cannot observe stale
  summaries") is actually correctly satisfied by the BEFORE trigger
  (because the NEW values commit atomically with the source row) — but the
  document's own self-flag #1 says "consensus trigger uses AFTER … performance
  under heavy review writes (architect claims mitigated by O(reviews-per-
  problem))" which conflates the diagnostic-summary trigger and the consensus
  trigger. The Critic cannot tell whether the architect understands the
  primitive they chose.
- **Suggested fix:** Replace the "deferred" wording in §1 with "BEFORE row-
  level triggers" (correct) and add one sentence in §3.1 #2 explaining why
  BEFORE is sufficient for AC #1 (NEW values commit with the source row;
  no other concurrent transaction can read the row in an inconsistent state
  under READ COMMITTED because the source UPDATE has not yet committed).
  The current text invites the Engineer to look for a `CONSTRAINT TRIGGER`
  in the migration that isn't there.

### 3. [SEVERITY: HIGH] Append-only enforcement on `attempts` is incomplete — operational separation between `app_user` and the Prisma migration role is not specified

- **Where:** §3.1 #4 (`REVOKE UPDATE, DELETE ON attempts FROM app_user;
  REVOKE UPDATE, DELETE ON test_session_audit FROM app_user;`), §11
  (Deployment Notes), migration 0011.
- **Why it matters:** REVOKE only works if (a) `app_user` is NOT the table
  owner (table owners always have UPDATE/DELETE on their own tables), and
  (b) Prisma's `migrate deploy` runs as a SEPARATE, more-privileged role
  whose connection string is not the same as the application's runtime
  `DATABASE_URL`. The architecture says nothing about who owns the tables
  or which role Prisma authenticates as. By default Prisma runs migrations
  with the same connection string the app uses; if that user owns the
  tables (the common Neon default), every REVOKE in the architecture is
  silently bypassed by anyone holding `DATABASE_URL`. PROJECT CONTEXT §12
  Rule 3 ("`attempts` is append-only") is then a paper promise.
- **Suggested fix:** Add a §10.x sub-section "DB role separation" specifying:
  (a) the `jee_platform_owner` role owns all tables and is the role Prisma
  uses for `migrate deploy` only (separate connection string —
  `DATABASE_URL_MIGRATE`); (b) `app_user` is a non-owner role with INSERT/
  SELECT grants on `attempts` + `test_session_audit` and INSERT/SELECT/
  UPDATE (minus the 6 summary columns) on `problems`; (c) the runtime
  `DATABASE_URL` connects as `app_user`; (d) `.env.example` lists both
  variables. Also add a migration test that runs as `app_user` and asserts
  `UPDATE attempts SET correct = NOT correct` raises `42501`.

### 4. [SEVERITY: HIGH] `auto_submit_source` enum reconciliation — Req O vs PRD-16 vs the architecture all disagree

- **Where:** §3 schema (`AutoSubmitSource { TIMER_EXPIRY
  VIOLATION_THRESHOLD NETWORK_FAILURE_FALLBACK MANUAL SERVER_TIMER }`),
  vs Req O (`TIMER_EXPIRY / VIOLATION_THRESHOLD / NETWORK_FAILURE_FALLBACK /
  MANUAL`), vs PRD-16 §8.3 row (`null / client_timer / server_timer /
  violation_threshold`).
- **Why it matters:** Three sources of truth, three different enums. The
  `MANUAL` value is suspect — `auto_submit_source` is by definition only
  populated when `auto_submit = true`; a manual submit per PRD-16 §3.3 G3
  has `auto_submit = false` and `auto_submit_source = null`. So `MANUAL` is
  semantically a nonsense value. Conversely, the architecture introduces
  `SERVER_TIMER` (5th value) without aligning with Req O's 4 values, and
  conflates `TIMER_EXPIRY` (client-side timer fire) with what the PRD-16
  §3.3 G3 calls `client_timer`. Engineer will pick one and ship whichever.
- **Suggested fix:** Pin the enum to exactly 4 values:
  `CLIENT_TIMER`, `SERVER_TIMER`, `VIOLATION_THRESHOLD`,
  `NETWORK_FAILURE_FALLBACK`. Document explicitly that `MANUAL` is encoded
  as NULL (because the column is nullable). Update Req O and PRD-16 §3.3 G3
  alignment notes to match. This is a 10-line fix but the Engineer will
  pick wrong without it.

### 5. [SEVERITY: HIGH] Cross-walk CHECK + consensus trigger interaction is undocumented — an inserted review can silently make the parent `problems` row CHECK-fail and roll back

- **Where:** §3.1 #1 (`chk_crosswalk_jee_advanced` on `problems`) interacts
  with §3.1 #3 (`trg_consensus_after_review` writes to `problems.
  authored_difficulty` and `problems.jee_authenticity_score`).
- **Why it matters:** When a new `problem_reviews` row is INSERTed, the
  AFTER trigger updates `problems.authored_difficulty` and
  `jee_authenticity_score` to the new consensus. If the new consensus pair
  is outside the cross-walk band (e.g. average T = 3.5 + score = 9.9), the
  CHECK fires and the ENTIRE transaction — including the original
  `problem_reviews` INSERT — rolls back with no actionable error. The
  reviewer's API call returns `23514 check_violation` on a row they didn't
  write. This is a confusing failure for a Stage 3 backend and worse for
  the human reviewer.
- **Suggested fix:** Either (a) make the consensus trigger snap the new
  `jee_authenticity_score` to the cross-walk band of the consensus T-bucket
  (preferred — preserves invariant, transparent to caller), or (b) document
  that mid-band reviews are accepted but boundary-crossing reviews are
  rejected and the API returns a sane error mapping. Either way the
  Engineer needs the rule pinned.

---

## Non-Blocking Issues (inherited by Engineer or scheduled for v2)

### 6. [SEVERITY: MEDIUM] Late-snapshot scoring window vs `attempts` immutability

- **Where:** §5 endpoint 12 (`POST .../late-snapshots`) + §6.3 (submit
  writes immutable `attempts` rows).
- **Why it matters:** PRD-16 US-5 E1 says late snapshots within 5 s of true
  T=0 ARE scored. But §6.3 writes `attempts` immutably at submit. If a late
  snapshot arrives 4 s after T=0 and the server-cron already auto-submitted,
  there is no path to update the corresponding `attempts` row. The
  architecture needs an explicit policy: either (a) submit waits 5 s after
  T=0 before writing `attempts` (delays submit confirmation), or (b) the
  5-s scored window is documented as "best-effort: only scored if the late
  snapshot is queued at the server BEFORE the submit transaction commits";
  late-arrivals are recorded but audit-only.
- **Suggested fix:** Pin policy (b) and update PRD-16 + architecture
  together. Add the policy as a one-line note next to endpoint 12.

### 7. [SEVERITY: MEDIUM] `@@unique([studentId, testId, status])` on `TestSession` is a redundant index and weakens the partial unique guarantee

- **Where:** §3 `TestSession` model:
  `@@unique([studentId, testId, status], map: "uniq_active_session_per_student_test")`,
  plus migration 0010 raw SQL
  `CREATE UNIQUE INDEX uniq_active_session … WHERE submitted_at IS NULL`.
- **Why it matters:** The Prisma `@@unique` declares a 3-column unique index
  including `status`, which is wrong semantics (a student CAN have a session
  in SUBMITTED status AND another in EXPIRED for the same test). The
  comment acknowledges this and adds the correct partial unique index in
  raw SQL — but the redundant 3-column index is still created. Build error
  at runtime if two SUBMITTED sessions share `(student_id, test_id, status)`.
- **Suggested fix:** Remove `@@unique([studentId, testId, status])` from the
  Prisma model. Rely solely on the partial unique index. Document in a
  comment that Prisma cannot express partial uniques, hence the raw SQL.

### 8. [SEVERITY: MEDIUM] GIN write amplification (architect self-flag) — real but acceptable; document the v2 mitigation explicitly

- **Where:** §3 5× `@@index([err*Tags], type: Gin, …)` on `problems`.
- **Why it matters:** Five GIN indexes mean every `wrong_paths` UPDATE
  rebuilds 5 GIN postings. At pilot scale (≤ 10k problems, ≤ 10
  problems/week authored) the absolute cost is invisible — but the
  architect's self-flag invites the Engineer to second-guess. Pin the
  decision so it doesn't get re-litigated.
- **Suggested fix:** Add a §3.x note: "5 separate GIN indexes chosen for v1
  because (a) authoring writes are ≤ 10/week, (b) US-2 queries target one
  axis at a time and a composite GIN over `{err_*_tags}` doesn't help that
  pattern, (c) drops in to be replaced by a single normalised
  `failure_modes_seen jsonb` GIN at Stage 8 when nightly batch attempts
  rebuild kicks in." Removes the temptation to over-engineer in Stage 3.

### 9. [SEVERITY: MEDIUM] `.env.example` diff is not specified — new env vars (`HMAC_PEPPER`, `DATABASE_URL_MIGRATE` if §3 fix is taken, `SENTRY_DSN`) need to be listed concretely

- **Where:** §10.2, §11, but no explicit `.env.example` patch.
- **Why it matters:** Constitution requires that every new env var lands in
  `.env.example`. The Engineer will guess and the Code Reviewer will flag.
- **Suggested fix:** Add a §11.x "env vars" table listing every new
  variable, its purpose, and an example value of the right shape (32-byte
  hex for `HMAC_PEPPER`, postgres URL for `DATABASE_URL` and
  `DATABASE_URL_MIGRATE`).

### 10. [SEVERITY: MEDIUM] BYTEA TOAST latency budget not modelled

- **Where:** §2 figure-storage choice, §5 endpoint 8 `figures/:signed_token`
  p95 budget 250 ms.
- **Why it matters:** Every figure ≥ 2 KB lives in TOAST out-of-line.
  Streaming 1 MB SVG through Postgres → Node → wire on a Tier-2-city 4G
  connection (PRD-16 §0 reference profile, 3 Mbps up from the server side
  is irrelevant; downstream 8 Mbps) gives ~1 s wire transfer alone for a
  1 MB figure, blowing the 250 ms budget. The 250 ms budget is realistic
  only for ≤ 100 KB figures.
- **Suggested fix:** Either (a) add an app-layer cap of 100 KB per figure
  (most JEE figures are SVG anyway, well under), (b) split the budget into
  "≤ 100 KB ⇒ 250 ms" and "≤ 1 MB ⇒ 800 ms", or (c) document a CDN cutover
  trigger at figure GET p95 > 250 ms. Engineer should not be left to
  discover this in pilot.

### 11. [SEVERITY: LOW] §13 Open Q-arch-2 (HMAC pepper rotation) is correctly deferred but flagged it would 401 in-flight sessions on rotation — that's actually false. Section 7.4 says the client recovers by re-fetching session payload, which regenerates tokens. The two notes contradict mildly. Tighten the wording.

### 12. [SEVERITY: LOW] `frozen_question_codes` is declared `Json` (defaults to JSONB in Prisma 6, so fine), but the type would be more honest as `String[]` since it is fixed-shape.

### 13. [SEVERITY: LOW] §10.4 A03 Injection mapping says "Prisma is the only DB client; no raw SQL with user input except the Req M UNION-DEDUPE which uses `$1`-style parameters." But the consensus trigger SQL in §3.1 #3 uses `COALESCE(NEW.question_code, OLD.question_code)` which is fine, and the v_inter_rater view query in §5 is read-only — both are not injection vectors. The mapping is correct; no action.

---

## What's Good (positive reinforcement — specific things v1 nailed)

1. **Session-secret rotation with 5-min grace (§7.2) is genuinely elegant.**
   The `session_secret_current` / `session_secret_previous` pair lets the
   submit transaction rotate atomically while letting stragglers (the
   review fetch, the late-snapshots flush) resolve without a flapping
   `401 invalid_token` race. The 5-minute window matches the PRD-16
   guardrail. This is the kind of detail that gets retrofitted painfully
   in v2 if missed.

2. **Frozen `frozen_question_codes` at session START (§3 TestSession + §6.3)**
   resolves PRD-16's "admins editing problems mid-session don't affect
   in-flight sessions" assumption with one column. No `problems` snapshot
   table needed; no immutability guard needed. Simplest possible answer.

3. **`DISTINCT ON (test_id) ORDER BY test_id, assigned_at ASC` in the
   dashboard UNION-DEDUPE (§5.2)** correctly picks the EARLIEST assignment
   per test for tracking — matches PRD-16 US-1 AC verbatim ("the earlier-
   written assignment wins for tracking the assigned_at/by fields"). This
   is one of the easy ones to get wrong by reflex (`DESC` for "latest" is
   the muscle memory).

4. **PrD-01 §6 A.3 invariant: 5 specific acceptance criteria are each
   addressed inline in §3.1 #2.** AC1 / AC2 / AC3 / AC4 / AC5 all marked
   with the satisfying mechanism. This is the right discipline (the
   trigger-vs-REVOKE bug in Blocker 1 is a separate problem; the
   discipline of mapping AC by AC is right).

5. **§10.4 OWASP top-10 mapping is concrete, not theatrical** — every row
   says exactly which middleware / mechanism mitigates the risk, with
   pointers to code (`AuthGuard`, `helmet()`, bcrypt cost 12). Stage 3 Code
   Reviewer can check each one.

6. **Architect openly self-flagged 3 issues at the top** and gave honest
   mitigations. The self-flag culture is exactly what the constitution
   asks for. The discriminator's job is easier when the generator is honest
   about the soft spots.

---

## Verification of the architect's 3 self-flagged items

1. **Consensus trigger uses AFTER with row-level UPDATE on `problems` —
   performance under heavy review writes.** Not a real issue at any
   reachable scale. ≤ 10k problems × ≤ 5 reviewer roles = ≤ 50k reviews
   ever (orders of magnitude below any concern). The architect's mitigation
   ("O(reviews-per-problem)") is sound. **Verdict: not a real issue.**

2. **5 GIN indexes on `problems` — write amplification on every problem
   UPDATE.** Real in absolute terms but immaterial at pilot scale
   (authoring < 10 problems/week). Promoted to non-blocker #8 above with
   an explicit v2 mitigation note. **Verdict: real but adequately
   mitigated by scale; document the v2 path so it doesn't get re-
   litigated.**

3. **`auth_sessions` row lookup per request — fine at pilot but invites
   JWT pushback.** Architect's §10.1 rebuttal is correct: PROJECT CONTEXT
   §12 R8 "stateless backend" means no per-session memory ON the backend
   (none here — the row is in Postgres), and a single indexed PK lookup
   is constant time. JWT would buy nothing here and lose the ability to
   invalidate on logout/breach. **Verdict: not a real issue; the §10.1
   reasoning is sound and should not regress in v2.**

---

## Open user-only questions (for orchestrator to surface)

The architect listed 2 open questions in §13. Both are appropriately scoped
("only genuinely-open"). The Discriminator concurs and adds one more that
the user must answer before Stage 3:

- **Q-disc-1:** Do you accept DB role separation (Blocker 3 fix) — i.e. is
  it acceptable for the human (you) to manage two `DATABASE_URL`s in
  Render's secret manager (one for migrations, one for app runtime)? If
  no, we must move the append-only guard to app code only and Rule 3
  becomes a policy promise rather than a structural one. Recommendation:
  yes, accept the two-URL pattern — it's a 5-min one-time setup.

The architect's Q-arch-1 (BYTEA vs S3) and Q-arch-2 (HMAC pepper rotation)
both have sound architect recommendations to defer; both are non-blocking.

---

## One thing the architect nailed that must not regress in v2

**The frozen-question-codes snapshot column on `test_sessions`.** It is
the simplest possible solution to PRD-16's "admins editing problems
mid-session don't affect in-flight sessions" assumption, and it neatly
removes the need for any problem-content immutability machinery. v2
should not be tempted to swap this out for a `problems_snapshot` table,
event sourcing, or any other heavier mechanism.

---

## Verdict

**Loop back to Architect v2.**

Score 6/10 is below the gate threshold (7) and there are 5 blocking issues —
but each is a focused fix, not a redesign. The architecture has the right
shape; v2 should not rewrite anything, only patch the 5 blockers and
fold in the 5 non-blockers as inline notes. Expect v2 ≥ 8/10 if the
blockers are addressed cleanly.

---

*End of review v1.*
