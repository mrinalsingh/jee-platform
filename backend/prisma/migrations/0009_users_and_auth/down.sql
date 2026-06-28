-- Rollback for 0009_users_and_auth.
DROP TABLE IF EXISTS public.auth_sessions;
DROP TABLE IF EXISTS public.student_parents;
DROP TABLE IF EXISTS public.parents;
DROP TABLE IF EXISTS public.teachers;
