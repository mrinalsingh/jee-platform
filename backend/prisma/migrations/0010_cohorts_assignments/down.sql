-- Rollback for 0010_cohorts_assignments.
DROP TABLE IF EXISTS public.test_assignments;
DROP TABLE IF EXISTS public.cohort_members;
DROP TABLE IF EXISTS public.cohorts;
