-- 0014_user_password_hash
--
-- Fixes a Stage-5 miss: backend/src/auth/auth-session.service.ts
-- (lookupByEmail) SELECTs `password_hash` from students/teachers/parents,
-- but no prior migration adds the column. Unit tests pass because the
-- Prisma client is mocked; the real DB would error at the first login.
--
-- The column is intentionally NOT declared in schema.prisma so the
-- generated Prisma client cannot accidentally SELECT it. All access is
-- via raw SQL in the auth service.
--
-- NULLable for forward-compat (existing rows = 0; future rows MUST be
-- set by the create-user endpoint). A later migration can tighten to
-- NOT NULL once we have a backfill strategy.

ALTER TABLE public.students ADD COLUMN password_hash TEXT;
ALTER TABLE public.teachers ADD COLUMN password_hash TEXT;
ALTER TABLE public.parents  ADD COLUMN password_hash TEXT;

-- The runtime role (app_user_login) gets SELECT on the new column via
-- table-level grants that already exist; no extra GRANT needed.
-- The migration role (migration_user) owns the column post-ALTER.
