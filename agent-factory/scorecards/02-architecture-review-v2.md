# Architecture Review v2 — Design Critic (Discriminator)

**Stage:** 2 (Architecture Loop) | **Iteration:** v2 | **Reviewer:** Design Critic
**Artifact reviewed:** `scorecards/02-architecture-draft-v2.md` (1,546 LOC, 47 sections, 41 `[UPDATED v2]` delta tags)
**Cross-references:** `02-architecture-review-v1.md` (5 blockers); `01-prd-final.md` v3; `16-test-runtime-prd-final.md` v2; `02-architecture-input-notes.md` Req A–P + Q; `docs/PROJECT CONTEXT.md` §6 / §12.

---

## Score: 8/10

The v2 lands every one of the five v1 blockers with textbook patterns
(SECURITY DEFINER + `trigger_owner` + `SET search_path` for trigger
privilege; structural three-role split for append-only; structured
`cross_walk_violation` error mapped to 422; 4-value canonical
`AutoSubmitSource`; BEFORE-trigger wording corrected with AC-by-AC
reasoning). The non-blockers are folded in cleanly with explicit
`[UPDATED v2 — Non-blocker #N]` tags. The architect's §14 self-audit
table makes delta-tracking trivial — exactly the discipline the Critic
asked for. v1 → v2 trajectory: **6 → 8**.

The reason this isn't 8.5 — six fresh issues surfaced in the v2
DDL/role machinery: the `trigger_owner` role is *named* but never
*granted* the column UPDATE it needs (§3.2 prose disagrees with §3.2
DDL); the role-bootstrap DDL is **not idempotent** as written
(`CREATE USER` lines aren't guarded by `IF NOT EXISTS`); migration
0001 is being retroactively amended even though it has already run
against `jee_platform_dev` (Prisma hash mismatch); the consensus
trigger uses lowercase `target_exam` for a Prisma-generated PascalCase
type (`"TargetExam"`); the consensus trigger has a real
read-committed race under concurrent reviewer writes; and the
`auto_submit_source` NOT-NULL-when-session-bound invariant is
app-layer-only with no DB CHECK. None of these is a redesign — each
is a focused 1-to-10-line DDL fix. The architecture is
fundamentally sound and the Engineer can start most of the build
while these get patched.

**Score breakdown:** PRD compliance ≈ 9/10; Data model integrity
≈ 7/10 (consensus race + missing CHECK pull it down); API design
≈ 9/10 (structured 422 is excellent); Security ≈ 8/10
(SECURITY DEFINER hardening with `search_path` is correct;
role-split is the right primitive; `GRANT EXECUTE` to `app_user`
is questionable surface); Failure modes ≈ 7/10 (race condition,
non-idempotent bootstrap); Over/under engineering ≈ 9/10 (still
boring + correct); Buildability ≈ 8/10 (six small patches needed;
none blocks parallel work).

---

## Iteration Delta — Full

### v1 blocker status (final)

1. **Blocker 1 (CRITICAL — trigger vs REVOKE)** — **FIXED.**
   §3.1 #2 declares `fn_recompute_diagnostic_summary()` as
   `SECURITY DEFINER`, transfers ownership to `trigger_owner`, sets
   `search_path = pg_catalog, public`, and uses the standard PG
   hardening pattern. Integration test in §3.2 asserts both the
   REVOKE direction (direct UPDATE fails 42501) AND the trigger
   direction (UPDATE wrong_paths flips the array). **However**, the
   pattern is incomplete: see NEW issue #1 below — `trigger_owner` is
   never `GRANT UPDATE`-ed on the summary columns, so the trigger
   function will itself fail 42501 as written.

2. **Blocker 2 (HIGH — deferred vs BEFORE)** — **FIXED.** §1 now
   says "BEFORE row-level triggers"; §3.1 #2 gives the AC#1
   justification ("NEW := … commits atomically with the source row;
   no other reader can see inconsistent state under READ COMMITTED").
   The v1 "deferred" wording is gone. Clean fix.

3. **Blocker 3 (HIGH — REVOKE bypass)** — **FIXED structurally.**
   Three roles (`migration_role` owning tables, `app_user` runtime,
   `trigger_owner` for SECURITY DEFINER); two distinct
   `DATABASE_URL`s; CI/CD pipeline excerpt at §11.2 shows migrations
   run under `MIGRATION_DATABASE_URL` while the deployed Render
   container only sees `DATABASE_URL`. PROJECT CONTEXT §12 Rule 3
   becomes a structural property. **However**: the bootstrap DDL
   itself is not idempotent (see NEW issue #2), and the
   "amend migration 0001" approach breaks Prisma's hash check
   (see NEW issue #3).

4. **Blocker 4 (HIGH — auto_submit_source enum)** — **FIXED**
   in this architecture (4 canonical values: `TIMER_EXPIRY`,
   `VIOLATION_THRESHOLD`, `NETWORK_FAILURE_FALLBACK`, `MANUAL`).
   Pinned in the Prisma enum, the schema column, migration 0012, the
   submit endpoint contract, and the audit row. The architect
   explicitly designates this file as the canonical source of truth
   and defers `02-architecture-input-notes.md` reconciliation to a
   one-line doc sync. Stage 3 engineer should consume the
   architecture, not the input-notes, for this enum. **PARTIALLY-FIXED
   if you count input-notes as part of the artifact set** —
   acceptable because the architecture file binds the implementation.

5. **Blocker 5 (HIGH — cross-walk silent rollback)** — **FIXED.**
   `fn_recompute_problem_consensus` does the pre-check
   (`new_s < low_b OR new_s > high_b`) and `RAISE EXCEPTION` with
   message-prefix `cross_walk_violation:` + `USING ERRCODE = '23514'`
   + `HINT`. The `POST /api/problems/:qcode/reviews` endpoint catches
   it and returns 422 with the structured body in §3.1 #3,
   including `your_t_rating`, `new_consensus_t`, `band_low`,
   `band_high`, `existing_reviews`, and `retry_guidance`. The caller
   can recover. The 422 vs the generic 23514 fallback (mapped to
   400 invalid_score) is correctly partitioned. **However**, the
   pre-check is not race-condition-free (see NEW issue #4).

**Trajectory: 6/10 → 8/10. All five blockers cleared at the
intent level; four are also clean at the implementation level;
one (Blocker 1) has a residual gap in the role grants.**

### NEW issues introduced in v2

1. **[HIGH] `trigger_owner` is never GRANTed UPDATE on the columns it must write.** §3.2 prose says "Full UPDATE on the 6 trigger-maintained columns of problems"; the DDL block does not contain that GRANT. The pattern as written: `migration_role` owns `problems` (full privileges), `app_user` is REVOKEd from the summary cols, `trigger_owner` is neither owner nor explicitly granted. When the SECURITY DEFINER function runs as `trigger_owner`, the `NEW := …` assignment fires column-level UPDATE on `err_*_tags` + `hint_count`. Without the GRANT, this fails with `42501` exactly as v1's Blocker 1 did — the bug has moved one role to the left, not been eliminated. The migration 0006 DDL needs an explicit `GRANT UPDATE (err_reading_tags, err_case_tags, err_comp_tags, err_strategy_tags, err_parsing_tags, hint_count) ON problems TO trigger_owner;` before the function body is callable.

2. **[HIGH] Migration 0001 bootstrap DDL is not idempotent.** The `DO $$ … BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = …) THEN CREATE ROLE … END IF; END $$;` block correctly guards the three role creations. But the lines immediately below — `CREATE USER migration_user IN ROLE migration_role;` and `CREATE USER app_user_login IN ROLE app_user;` — are unguarded. On any re-run (CI re-deploy, `prisma migrate reset`, dev-machine replay), these fail with `role already exists`, aborting the migration. Wrap them in the same `IF NOT EXISTS` guard, OR use `CREATE ROLE … LOGIN IN ROLE …` inside the existing DO block.

3. **[HIGH] Amending migration 0001 in-place breaks Prisma's migration-hash check.** The architecture says migration 0001 "(existing) baseline 5 tables `[UPDATED v2 — Blocker 3]`: also creates the 3 roles". Migration 0001 has already been applied to `jee_platform_dev` (the existing 179 rows; per git log "Stage 2: Prisma schema + first migration"). Prisma's `_prisma_migrations` table stores the file hash; modifying `0001_init/up.sql` will cause `prisma migrate deploy` to fail on the next run with `migration ... was modified after it was applied`. The fix is to add a NEW migration (e.g. `0013_db_role_separation`) that creates the roles + transfers ownership, NOT amend 0001. This is a Prisma-specific operational footgun that the architect missed.

4. **[MEDIUM] Consensus trigger has a read-committed race under concurrent reviewer writes.** `fn_recompute_problem_consensus` does `SELECT … FROM problem_reviews WHERE r.question_code = qcode` inside the trigger, computes a new consensus, and `UPDATE problems`. Under `READ COMMITTED` (the architecture's chosen isolation per §6.2), two reviewer roles writing to the same `question_code` simultaneously each read a snapshot that excludes the other's just-inserted row. Both pre-checks may pass; both UPDATEs serialise on the `problems` PK; the second one overwrites the first. The architecture should either (a) take an advisory lock keyed by `question_code` (`SELECT pg_advisory_xact_lock(hashtext(qcode))`) at the start of the function, or (b) raise the consensus trigger transaction isolation to `REPEATABLE READ` and accept serialization failures (which surface to the API caller via the existing 422 retry path). Pilot scale (≤ 5 reviewer roles × ≤ 10k problems) makes the probability low but non-zero; under coordinated reviewer pair-writes it is reproducible. Stage 3 engineer should add the advisory lock — it is one line in the function and removes a real failure mode.

5. **[MEDIUM] Consensus-trigger DECLARE uses lowercase `target_exam` for a Prisma-generated PascalCase enum.** Line 832: `target target_exam;`. Prisma 6 generates the Postgres type as `"TargetExam"` (PascalCase, double-quoted). The function will fail to load with `type "target_exam" does not exist`. The fix is `target "TargetExam";`. Same issue does NOT affect line 838's `(ARRAY['T1','T2','T3','T4','T5']::"IntrinsicDifficulty"[])` — that one correctly quotes the PascalCase. The architect was inconsistent within the same code block.

6. **[MEDIUM] `attempts.auto_submit_source` NOT-NULL-when-session-bound invariant has no DB CHECK.** The architecture states "auto_submit_source ← request field … NOT NULL because the column is populated for every session-bound attempts row" (§6.3). The schema declares the column `AutoSubmitSource?` (nullable). The invariant is enforced only by the submit endpoint's app-layer write path. A future raw-SQL INSERT into `attempts` (or a future endpoint that forgets the field) will silently violate the invariant. Add `ALTER TABLE attempts ADD CONSTRAINT chk_auto_submit_source_when_session CHECK (test_session_id IS NULL OR auto_submit_source IS NOT NULL);` — one line, makes the invariant structural.

7. **[LOW] `GRANT EXECUTE ON FUNCTION fn_recompute_diagnostic_summary() TO app_user` expands attack surface for no clear gain.** SECURITY DEFINER trigger functions called automatically by the trigger machinery do NOT require the calling role to hold EXECUTE. The trigger invocation is privileged. Granting EXECUTE to `app_user` lets the running app call the function out-of-band; the architect's own integration test (line 1059) asserts this fails — but it asserts the WRONG error code. A `SELECT fn_recompute_diagnostic_summary()` on a `RETURNS trigger` function fails with `0A000 trigger functions can only be called as triggers` (PG 12+), not the `42883/0A000` the architect lists. Drop the `GRANT EXECUTE` line entirely and the call fails earlier with `42501 permission denied`. The architect's §14 explicitly flagged this test as a Postgres-version uncertainty — the answer is "remove the GRANT EXECUTE and the uncertainty goes away".

---

## Blocking Issues (still open in v2)

1. **[HIGH] Add missing `GRANT UPDATE (err_reading_tags, …, hint_count) ON problems TO trigger_owner;` in migration 0006.** Without it, the SECURITY DEFINER trigger fails 42501 on its own assignment — the v1 bug has not been eliminated, only relocated. Owner: Stage 3 Engineer when writing 0006/up.sql, OR Architect for v3 if the orchestrator chooses to loop. Suggested fix: add the GRANT immediately after the `ALTER FUNCTION … OWNER TO trigger_owner;` line.

2. **[HIGH] Migration 0001 cannot be amended in-place — add a NEW migration for the role separation.** Prisma's `_prisma_migrations` hash check will fail on existing dev/prod databases that already applied 0001. Owner: Architect for v3 OR Engineer at Stage 3 with a one-paragraph note in the architecture. Suggested fix: rename "0001 also creates the roles" to "0013_db_role_separation" or "0001b_bootstrap_roles" (separate migration directory) that does `CREATE ROLE … IF NOT EXISTS` + `ALTER TABLE … OWNER TO migration_role` (transfer ownership from whatever role currently owns the 5 baseline tables; default is the connecting role) + the GRANT/REVOKE matrix.

3. **[HIGH] Bootstrap DDL idempotency — wrap the two `CREATE USER` lines in the same `IF NOT EXISTS` guard.** Otherwise `prisma migrate reset` and CI re-runs fail. Owner: Engineer at Stage 3. Suggested fix: move the `CREATE USER migration_user IN ROLE migration_role;` and `CREATE USER app_user_login IN ROLE app_user;` lines INSIDE the existing `DO $$ … END $$` block with `IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_user')` guards.

---

## Non-Blocking Issues (inherited by Engineer or scheduled)

4. **[MEDIUM] Consensus-trigger race condition** — add `SELECT pg_advisory_xact_lock(hashtext(qcode));` at the top of `fn_recompute_problem_consensus`. One line; idempotent within transaction; serialises reviewer writes to the same problem. Pilot-scale-acceptable to ship without, but Stage 3 engineer should add it as part of 0007/up.sql.

5. **[MEDIUM] Consensus-trigger uses unquoted lowercase `target_exam`** for a Prisma PascalCase type. Change line 832 to `target "TargetExam";`. Stage 3 Engineer will hit this on the first migration run.

6. **[MEDIUM] Add CHECK constraint** `chk_auto_submit_source_when_session` on `attempts` so the NOT-NULL-when-session-bound invariant is structural, not app-layer-only.

7. **[LOW] Drop the `GRANT EXECUTE` on the two SECURITY DEFINER functions to `app_user`** — not needed (trigger calls are privileged), expands attack surface, and the architect's own integration test for the EXECUTE-grant scenario is uncertain (§14). Cleaner without it. Adjust the integration test in §3.2 (line 1050-1060) to assert `42501 permission denied` on `SELECT fn_recompute_…()` instead of the version-uncertain `42883/0A000`.

8. **[LOW] §11.2 deploy.yml excerpt uses `DATABASE_URL: ${{ secrets.MIGRATION_DATABASE_URL }}` for the migrate job.** This is correct (Prisma only reads `DATABASE_URL`), but it conflates the env-var NAME with the role. Add a one-line comment in the YAML: `# Prisma reads $DATABASE_URL; we set it to MIGRATION_DATABASE_URL for this step only` so the next operator doesn't think the runtime container is mis-configured.

9. **[LOW] BYPASSRLS on `migration_role` is unused** (no Row-Level Security policies in the schema). Harmless noise; keep for forward-compatibility OR drop the flag. Architect's call.

10. **[LOW] §3.2 calls `CREATE USER migration_user IN ROLE migration_role`** — this syntax works but is non-standard; the idiomatic PG way is `CREATE ROLE migration_user LOGIN; GRANT migration_role TO migration_user;`. Functionally equivalent. Cosmetic.

11. **[LOW] auto_submit_source enum reconciliation in input-notes is deferred** to a documentation sync. Stage 3 engineer must consume the architecture (this file) as canonical, NOT input-notes Req O. The architecture file is correctly self-designating; the Critic concurs that this is a documentation-only follow-up.

---

## What's Good (positive reinforcement — what v2 nailed)

1. **SECURITY DEFINER + `SET search_path = pg_catalog, public` + `OWNER TO trigger_owner` is the textbook Postgres pattern**, applied correctly. The architect explicitly cited the "search-path injection CVE class" and chose the canonical hardening. This is exactly the right altitude.

2. **The three-role split (`migration_role` / `app_user` / `trigger_owner`) is the right decomposition.** Many architects collapse into two roles (app + admin) which would leave the column-level REVOKE → trigger problem unsolvable. The dedicated `trigger_owner` is the clean answer to "the trigger needs MORE privilege than app_user, LESS than table owner".

3. **The structured `cross_walk_violation` 422 response is a model of what a recoverable API error looks like.** It includes the offending input (`your_t_rating`, `your_jee_authenticity_score`), the computed end state (`new_consensus_t`, `new_consensus_score`), the band that was violated, the existing reviews (so the human can see what they're up against), AND `retry_guidance`. This is the right shape and matches the Critic's v1 suggestion (a) verbatim. Engineers building the reviewer UI will be able to render a useful inline error without round-trips.

4. **§14 self-audit table** — line-by-line FIXED/HIGH-confidence claim with the actual mechanism for each blocker. This is exactly the iteration-2 discipline the master-orchestrator's Feedback Protocol asks for. The architect concedes "v1 wording was loose" rather than hedging, and explicitly flags the one remaining uncertainty (the EXECUTE-call test). That kind of honest self-assessment makes the Critic's job easy.

5. **Migration 0012 split** (`ALTER TYPE ADD VALUE` outside transaction + the rest inside) — small detail but correct. The architect knows Postgres' transaction-block restriction on `ALTER TYPE`, and surfaced it explicitly in §4 ("Migration safety properties" bullet 1). This is the kind of detail that bites Stage 3 engineers if not pre-flagged.

6. **Non-blocker #6 pin (late-snapshot window)** — the architect picked policy (b) — "scored only if pre-submit-commit; arrivals after audit-only" — exactly the call the Critic asked for. Preserves `attempts` immutability, surfaces the trade-off clearly in endpoint 12, no PRD-16 contradiction.

7. **Preservation discipline** — all five v1-nailed items (frozen_question_codes, secret-rotation grace, DISTINCT ON earlier-wins, AC-by-AC mapping, OWASP concrete map) survive unchanged with `[PRESERVED]` tags. The architect didn't take the opportunity to rewrite anything that worked. That's the regression-avoidance the Critic flagged as critical for v2.

8. **§11.2 CI/CD pipeline excerpt** showing the two-step deploy.yml with explicit env-var rebinding makes the Stage 5 hand-off concrete. The operational rule "the orchestrator NEVER hand-edits the Render env to inject `MIGRATION_DATABASE_URL`" is exactly the talk-only-UX constitutional habit.

---

## Verification of the architect's self-flagged §14 item

The architect's §14 closes with: "the trigger-function lockdown test (verifying `app_user` can't directly call `fn_recompute_diagnostic_summary` with a forged input) might need a tweak depending on Postgres version-specific behaviour."

**Verdict: the architect is right to flag it; the fix is to delete the GRANT EXECUTE, not tweak the test.** A `RETURNS trigger` function called via SELECT fails with `0A000 trigger functions can only be called as triggers` from PG 12 onward. The architect's test asserts `42883 OR 0A000` — `42883` would be "function does not exist" which only fires if EXECUTE was never granted. Drop the GRANT EXECUTE and the test simplifies to asserting `42501 permission denied`. Removes both the surface area and the version uncertainty. Non-blocker — Stage 3 Engineer can do this as a 2-line cleanup.

---

## Project-specific lens results

- **PROJECT CONTEXT §12 Rule 3 (append-only attempts):** ✓ now structural via role separation (Blocker 3 closed). The two-URL pattern makes Rule 3 a database-enforced property, not a paper promise. Confirm-with-user (§13 Q-arch-3) is appropriate.
- **Rule 7 (secrets):** ✓ `.env.example` is in §3.2; secrets-manager handoff is documented at §11.1 with a holder-by-holder matrix. `MIGRATION_DATABASE_URL` is explicitly flagged as never set on Render/Vercel.
- **Rule 8 (stateless backend):** ✓ `auth_sessions` row lookup per request is preserved unchanged (§10.1); the v1 reasoning the Critic verified holds.
- **Rule 9 (1-lakh scale):** ✓ Connection pooling spec'd for both roles at §9.2 (Prisma `connection_limit=20` on app role; separate `prisma migrate deploy` pool on migration role; PgBouncer transaction-pool fronting); partition trigger thresholds at §9.5. The dual-role world does not regress pooling.

---

## Open user-only questions (for orchestrator to surface)

The architect surfaces three at §13:

1. **Q-arch-1 (BYTEA vs S3 from day one)** — architect's recommendation: keep BYTEA. Critic concurs at pilot scale (≤ 400 MB total). Non-blocking.

2. **Q-arch-2 (HMAC pepper rotation cadence)** — architect's recommendation: defer rotation to post-pilot. Critic concurs. Non-blocking.

3. **Q-arch-3 (DB role separation operational footprint)** — `[NEW v2 — from Critic Q-disc-1]`. The user must confirm: do you accept managing two distinct connection strings (`MIGRATION_DATABASE_URL` in GitHub Actions secrets, `DATABASE_URL` in Render) so that PROJECT CONTEXT §12 Rule 3 becomes structural? Architect + Critic concur: accept the two-URL pattern (5-minute one-time setup). **This is the only user-facing decision blocking Stage 3.**

---

## One thing the architect nailed that must not regress in Stage 3

**The structured `cross_walk_violation` 422 response shape (§3.1 #3 / §5.4 endpoint 14).** The Stage 3 Engineer must implement this response body exactly as specified — including `your_*` echoes, `new_consensus_*`, `band_low` / `band_high`, `existing_reviews`, and the `retry_guidance` string. Reviewer UX depends on rendering this inline. Any reduction to "422 invalid review" loses the recoverability the architect designed in.

---

## Verdict

**Advance to Stage 3.**

Score 8/10 is above the gate threshold (7). All five v1 blockers are
fixed at the intent level. The six new findings in v2 break down as:
3 HIGH (each a 1–10-line DDL patch — `GRANT UPDATE` to
`trigger_owner`, idempotent CREATE USER, new migration directory
instead of amending 0001) + 3 MEDIUM/LOW that Stage 3 Engineer can
absorb inline. None of the HIGHs is a design problem — they are
implementation precision items. Forcing a v3 just to add three
DDL lines is over-process; the Engineer can land them in the same
breath as migrations 0006 / 0007 / 0013.

The constitution permits advance at score ≥ 7 with no
CRITICAL open. There is no CRITICAL open. The HIGHs are
operational/DDL-precision items, not architectural rethinks. The
architect's §14 confidence rating ("HIGH" on every blocker) is
honest; the residual gaps are the kind that show up in
implementation review, not architecture review.

### Brief for Stage 3 Engineer

**Contract the Engineer MUST fulfil:**

1. **Three roles + two URLs.** Migrate the dev DB to the role-split model
   in a NEW migration directory (e.g. `0013_db_role_separation/up.sql`) —
   do NOT amend `0001_init/up.sql` (Prisma hash check will fail). The
   migration must:
   - Create `migration_role`, `app_user`, `trigger_owner` (all `IF NOT EXISTS`-guarded).
   - Create `migration_user`, `app_user_login` (both `IF NOT EXISTS`-guarded — the architect's v2 missed this).
   - Transfer ownership of all 5 baseline tables to `migration_role`: `ALTER TABLE <t> OWNER TO migration_role;`.
   - Grant the explicit RBAC matrix from §3.2 to `app_user` (SELECT/INSERT on append-only; SELECT/INSERT/UPDATE/DELETE elsewhere minus the 6 summary columns).
   - Write `.env.example` exactly as in §3.2 (two `DATABASE_URL`s, `HMAC_PEPPER`, `SENTRY_DSN`).

2. **Trigger function privileges.** In migration 0006 (or wherever the diagnostic summary trigger lands), in addition to what §3.1 #2 spec'd, ALSO:
   - `GRANT UPDATE (err_reading_tags, err_case_tags, err_comp_tags, err_strategy_tags, err_parsing_tags, hint_count) ON problems TO trigger_owner;`
   - DELETE the `GRANT EXECUTE ON FUNCTION fn_recompute_diagnostic_summary() TO app_user;` line (not needed for trigger invocation; expands attack surface).
   - Same simplification for `fn_recompute_problem_consensus` (drop the GRANT EXECUTE to `app_user`).

3. **Consensus trigger DDL fixes.** In migration 0007's `fn_recompute_problem_consensus`:
   - Change `target target_exam;` → `target "TargetExam";` (Prisma PascalCase quoting).
   - Add `SELECT pg_advisory_xact_lock(hashtext(qcode));` as the very first statement in the function body, to serialise concurrent reviewer writes to the same problem code.

4. **The CHECK constraint** `ALTER TABLE attempts ADD CONSTRAINT chk_auto_submit_source_when_session CHECK (test_session_id IS NULL OR auto_submit_source IS NOT NULL);` lands with migration 0012.

5. **Exact submit-endpoint contract.** §5 endpoint 11 + §6.3 specify
   the 4-value canonical `AutoSubmitSource` enum, the rejection of
   `null` with `400 missing_auto_submit_source`, the rotation of
   `session_secret_current → session_secret_previous`, the
   first-write-wins idempotency on `session_id`. All four properties
   must hold in the implementation.

6. **`cross_walk_violation` 422 body shape (§3.1 #3) is the exact
   contract** — engineer must populate every field including
   `existing_reviews` (separate read-only query after rollback) and
   `retry_guidance`. The reviewer UI depends on it.

**Top-3 risks Stage 3 Code Reviewer must watch:**

1. **Idempotency of role-bootstrap migration.** Run `prisma migrate reset` + `prisma migrate deploy` twice in a row in CI; if the second run fails with `role already exists`, the IF NOT EXISTS guards are missing.

2. **Trigger function failing 42501 because trigger_owner was never granted the column UPDATE.** Smoke-test by running the integration tests in §3.2 against a clean DB; if `Trigger DOES write summary columns when wrong_paths changes` fails with `42501`, the GRANT to trigger_owner is missing.

3. **Cross-walk violation 422 fidelity.** Build a test that submits two concurrent reviews for the same problem from different reviewer_roles such that the consensus would cross a band boundary. Without the advisory lock, the test will be flaky. With it, exactly one of the two transactions sees the structured 422 and the other completes cleanly.

---

*End of review v2.*
