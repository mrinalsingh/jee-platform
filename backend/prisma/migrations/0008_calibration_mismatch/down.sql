-- Rollback for 0008_calibration_mismatch.
-- (The hints column is now owned by 0006_diagnostic_summaries and is dropped
--  there; this down.sql only reverses the Req Q calibration-mismatch parts.)
DROP INDEX IF EXISTS public.problems_better_fit_exam_idx;
DROP INDEX IF EXISTS public.problems_above_target_idx;
ALTER TABLE public.problems DROP COLUMN IF EXISTS better_fit_exam;
ALTER TABLE public.problems DROP COLUMN IF EXISTS is_above_target_difficulty;
