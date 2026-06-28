-- Purpose: bootstrap DB role separation (migration_role / app_user / trigger_owner)
-- + login users + extensions. Append-only enforcement on attempts + test_session_audit
-- becomes STRUCTURAL because app_user is not the table owner. Critic v2 Blocker 3
-- (non-amendment of 0001) and Engineer pickup #2 (IF NOT EXISTS on CREATE USER).

-- ---------------------------------------------------------------------------
-- 1. Extensions used by later migrations.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_bytes / gen_random_uuid

-- ---------------------------------------------------------------------------
-- 2. Roles + login users. All guarded with IF NOT EXISTS pattern so
--    `prisma migrate reset` + CI re-runs are idempotent (Critic v2 Blocker 2).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Group roles (NOLOGIN). Privileges are granted to these; login users
  -- inherit through membership.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_role') THEN
    CREATE ROLE migration_role NOLOGIN BYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'trigger_owner') THEN
    CREATE ROLE trigger_owner NOLOGIN;
  END IF;

  -- Login users. Passwords are set out-of-band by the operator from the
  -- secrets manager — never stored in this migration. The IF NOT EXISTS
  -- guard makes the migration safe to re-run.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_user') THEN
    CREATE ROLE migration_user LOGIN;
    GRANT migration_role TO migration_user;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user_login') THEN
    CREATE ROLE app_user_login LOGIN;
    GRANT app_user TO app_user_login;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Grant CONNECT + USAGE on schema. The DB name is parameterised at deploy
--    time via current_database() so this works for jee_platform_dev, the prod
--    Neon DB, and any PR-ephemeral DB.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  db_name text := current_database();
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO migration_user, app_user_login', db_name);
END
$$;

GRANT USAGE ON SCHEMA public TO migration_user, app_user_login;
GRANT USAGE ON SCHEMA public TO migration_role, app_user, trigger_owner;

-- ---------------------------------------------------------------------------
-- 4. Transfer ownership of the 5 baseline tables to migration_role. These
--    were created by migration 0001 owned by whichever superuser ran
--    `prisma migrate dev` at scaffold time. This is the structural foundation
--    for append-only enforcement: app_user is NOT the owner, so REVOKE in
--    migration 0012 cannot be silently bypassed.
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.problems                  OWNER TO migration_role;
ALTER TABLE IF EXISTS public.students                  OWNER TO migration_role;
ALTER TABLE IF EXISTS public.student_fingerprint_state OWNER TO migration_role;
ALTER TABLE IF EXISTS public.tests                     OWNER TO migration_role;
ALTER TABLE IF EXISTS public.attempts                  OWNER TO migration_role;

-- Transfer ownership of baseline enums + sequences (best-effort; IF EXISTS).
DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT t.typname AS name
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typtype = 'e'  -- enum
  LOOP
    EXECUTE format('ALTER TYPE public.%I OWNER TO migration_role', rec.name);
  END LOOP;

  FOR rec IN
    SELECT c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'S'  -- sequence
  LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO migration_role', rec.name);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 5. Base RBAC matrix for app_user on the 5 baseline tables. The append-only
--    REVOKE on attempts + test_session_audit lands in migration 0012 (after
--    test_session_audit exists). All future-created tables in migrations
--    0003..0011 explicitly GRANT inside that migration.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.problems                  TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.students                  TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_fingerprint_state TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tests                     TO app_user;
GRANT SELECT, INSERT ON                public.attempts                  TO app_user;
-- attempts UPDATE/DELETE intentionally not granted: append-only ground truth.

-- Grant sequence usage so app_user can INSERT into BIGSERIAL columns.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- Default privileges for tables/sequences created LATER by migration_role
-- (the 0003..0012 migrations). app_user gets SELECT by default; specific
-- writes are granted per-table in each migration.
ALTER DEFAULT PRIVILEGES FOR ROLE migration_role IN SCHEMA public
  GRANT SELECT ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE migration_role IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
