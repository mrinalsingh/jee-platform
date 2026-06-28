-- Rollback for 0013_calibration_mismatch_columns.
-- Drop the three auxiliary tables; the Req Q indexes are owned by 0008 and
-- stay in place.
DROP TABLE IF EXISTS public.student_drill_recommendations;
DROP TABLE IF EXISTS public.problem_diagnostic_misses;
DROP TABLE IF EXISTS public.problem_figures;
