-- Rollback for 0011_test_sessions.
DROP TABLE IF EXISTS public.test_session_audit;
DROP TABLE IF EXISTS public.test_session_snapshots;
DROP INDEX IF EXISTS public.uniq_active_session;
DROP TABLE IF EXISTS public.test_sessions;
