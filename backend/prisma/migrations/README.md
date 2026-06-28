# Prisma migrations — house rules

This directory is replayed against every fresh database (Neon prod, ephemeral
CI DBs, any new developer's local Postgres) by `prisma migrate deploy`. The
rules below exist because Stage 5 Integrator caught two ordering bugs that
would have broken the first production deploy. Read this before adding,
renaming, or editing any migration in this directory.

## Lexicographic ordering (Prisma's rule)

Prisma applies migrations in **alphabetical order of the directory name**, not
by `started_at` or by file mtime. This is the only rule Prisma enforces about
order, and it is enforced silently — there is no warning if your filenames
sort differently than you intended.

Concretely, `20260524093545_init` sorts AFTER `0002_roles_and_extensions`,
which is why the original `_init` directory (auto-named by `prisma migrate
dev` at scaffold time) had to be renamed to `0001_init`. Do not let Prisma
auto-name a migration `YYYYMMDDHHMMSS_*` for this project — see the next
section.

## Naming convention: `0NNN_short_description`

- 4-digit zero-padded sequence, starting at `0001`.
- Lowercase, underscore-separated description (≤ ~5 words).
- Examples — good: `0014_assignment_due_dates`, `0015_audit_partitions`.
- Examples — bad: `20260524093545_init`, `0014-assignment-due-dates`,
  `0014_AssignmentDueDates`, `14_assignments` (will sort wrong once you
  pass `09`).

If you scaffold a migration with `prisma migrate dev --name X`, Prisma will
write a timestamped folder. **Rename it to the next `0NNN_X` slot before
committing.** The dev DB only records `migration_name` once it is applied; if
you rename before first apply, no surgery is needed. If you rename after,
update the `_prisma_migrations` table by hand.

## Cumulative-state rule (don't break the chain)

A migration's SQL runs against the cumulative state of ALL prior migrations
in sort order, not against `schema.prisma`. So:

- Do not reference a column, table, role, function, or enum that has not yet
  been created by an earlier-sorted migration. The Stage 5 second bug was
  exactly this: `0006_diagnostic_summaries` declared a trigger
  `BEFORE INSERT OR UPDATE OF wrong_paths, hints` on `problems`, but `hints`
  was added in `0008_hints_calibration_mismatch`. Fixed by moving the `hints`
  column ADD up into `0006_diagnostic_summaries` so it precedes its first
  use.
- When in doubt, run `npx prisma migrate deploy` against a throwaway DB and
  check that all migrations apply cleanly:
  ```
  createdb jee_platform_smoke
  DATABASE_URL=postgresql://postgres@localhost:5432/jee_platform_smoke \
    MIGRATION_DATABASE_URL=postgresql://postgres@localhost:5432/jee_platform_smoke \
    npx prisma migrate deploy --schema=backend/prisma/schema.prisma
  dropdb jee_platform_smoke
  ```
  Expected: "Database is now in sync with the schema." and exit 0.

## Down migrations: exact, reversible, replay-safe

Every directory carries a `down.sql` alongside `migration.sql`. The rules:

- `down.sql` is the **exact inverse** of `migration.sql`. If `migration.sql`
  adds a column, `down.sql` drops it. If `migration.sql` adds a GRANT,
  `down.sql` REVOKEs it (and re-GRANTs any privilege the migration revoked).
- Down migrations must be runnable in **reverse order**: applying `down.sql`
  from `0013` then `0012` then `0011` etc. must leave the DB in the same
  state as if those migrations had never been applied.
- `down.sql` is run by the deployment runbook's rollback path (see
  `agent-factory/scorecards/05-deployment-runbook.md` §5) — Prisma itself
  does not invoke it. It must be idempotent (`IF EXISTS`, `IF NOT EXISTS`)
  so a partial rollback can be retried.

## Structural invariants to preserve

Two structural invariants are enforced by migrations and must NOT be broken
by a future migration:

1. **Append-only tables.** `attempts` and `test_session_audit` REVOKE
   UPDATE/DELETE from `app_user` at the role level (see
   `0012_attempts_extensions`). Any migration that adds a column to these
   tables must NOT re-GRANT UPDATE or DELETE to `app_user` for any column;
   it must only GRANT INSERT/SELECT.
2. **Role split.** `migration_role` owns tables; `app_user` does not own
   anything and cannot bypass column-level REVOKEs. Any migration that
   creates a new table must `ALTER TABLE … OWNER TO migration_role` (the
   pattern used in `0002_roles_and_extensions` §5).

If your migration interacts with either of these invariants, add an explicit
comment naming the rule it preserves and reference architecture §3.2 + §11.1.

## When you must rename or reorder an applied migration

Don't, unless every environment is known to NOT have the affected migrations
applied. If a migration has been applied to ANY environment (including a
developer's laptop), renaming the directory will cause Prisma to re-apply
the renamed-as-new migration on next deploy and fail. The fix in that case
is one of:
- a fresh migration that ADDS what the broken one missed (preferred);
- a coordinated, hand-edited `UPDATE _prisma_migrations SET migration_name = 'NNNN_X' WHERE migration_name = 'old_X'` on every environment (rarely worth it).

Stage-5 Integrator's rename of `20260524093545_init` → `0001_init` was safe
only because the 12 follow-on migrations had never been applied anywhere.
That window is now closed; future renames are not safe.
