-- Rollback for 0008_hints_calibration_mismatch.
DROP INDEX IF EXISTS public.problems_better_fit_exam_idx;
DROP INDEX IF EXISTS public.problems_above_target_idx;
ALTER TABLE public.problems DROP COLUMN IF EXISTS better_fit_exam;
ALTER TABLE public.problems DROP COLUMN IF EXISTS is_above_target_difficulty;
ALTER TABLE public.problems DROP COLUMN IF EXISTS hints;
