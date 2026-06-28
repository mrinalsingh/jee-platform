-- Reverse of 0014_user_password_hash

ALTER TABLE public.parents  DROP COLUMN IF EXISTS password_hash;
ALTER TABLE public.teachers DROP COLUMN IF EXISTS password_hash;
ALTER TABLE public.students DROP COLUMN IF EXISTS password_hash;
