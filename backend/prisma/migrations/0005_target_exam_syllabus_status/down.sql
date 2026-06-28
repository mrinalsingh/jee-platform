-- Rollback for 0005_target_exam_syllabus_status.
ALTER TABLE public.problems DROP CONSTRAINT IF EXISTS chk_crosswalk_jee_advanced;
DROP INDEX IF EXISTS public.problems_target_exam_syllabus_status_idx;
DROP INDEX IF EXISTS public.problems_syllabus_status_idx;
DROP INDEX IF EXISTS public.problems_target_exam_idx;
ALTER TABLE public.problems DROP COLUMN IF EXISTS syllabus_status;
ALTER TABLE public.problems DROP COLUMN IF EXISTS target_exam;
-- The source_metadata.target_exam_inferred markers stay; harmless if column gone.
