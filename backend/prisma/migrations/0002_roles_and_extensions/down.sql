-- Rollback for 0002_roles_and_extensions.
-- WARNING: this revokes the entire RBAC matrix and reverts ownership to the
-- bootstrap superuser (postgres). Run only with full operator awareness.

-- Reverse default privileges first.
ALTER DEFAULT PRIVILEGES FOR ROLE migration_role IN SCHEMA public
  REVOKE SELECT ON TABLES FROM app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE migration_role IN SCHEMA public
  REVOKE USAGE, SELECT ON SEQUENCES FROM app_user;

-- Revoke baseline grants.
REVOKE ALL ON public.problems                  FROM app_user;
REVOKE ALL ON public.students                  FROM app_user;
REVOKE ALL ON public.student_fingerprint_state FROM app_user;
REVOKE ALL ON public.tests                     FROM app_user;
REVOKE ALL ON public.attempts                  FROM app_user;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM app_user;
REVOKE USAGE ON SCHEMA public FROM migration_user, app_user_login,
                                    migration_role, app_user, trigger_owner;
DO $$
DECLARE
  db_name text := current_database();
BEGIN
  EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM migration_user, app_user_login', db_name);
END
$$;

-- Restore baseline ownership to postgres (the assumed superuser; adjust if your
-- bootstrap user differs).
ALTER TABLE IF EXISTS public.problems                  OWNER TO postgres;
ALTER TABLE IF EXISTS public.students                  OWNER TO postgres;
ALTER TABLE IF EXISTS public.student_fingerprint_state OWNER TO postgres;
ALTER TABLE IF EXISTS public.tests                     OWNER TO postgres;
ALTER TABLE IF EXISTS public.attempts                  OWNER TO postgres;

-- Drop login users (membership memberships drop with the user).
DROP ROLE IF EXISTS app_user_login;
DROP ROLE IF EXISTS migration_user;

-- Drop group roles last.
DROP ROLE IF EXISTS trigger_owner;
DROP ROLE IF EXISTS app_user;
DROP ROLE IF EXISTS migration_role;

-- Extensions left in place; pgcrypto is harmless and used by other tooling.
