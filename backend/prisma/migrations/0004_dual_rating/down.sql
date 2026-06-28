-- Rollback for 0004_dual_rating.
DROP INDEX IF EXISTS public.problems_jee_authenticity_score_idx;
ALTER TABLE public.problems DROP CONSTRAINT IF EXISTS chk_score_range;
ALTER TABLE public.problems DROP COLUMN IF EXISTS jee_authenticity_score;
