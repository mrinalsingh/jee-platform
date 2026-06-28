-- Rollback for 0012_attempts_extensions.
-- Re-grant UPDATE/DELETE so post-rollback behaviour mirrors pre-0012.
GRANT UPDATE, DELETE ON public.attempts           TO app_user;
GRANT UPDATE, DELETE ON public.test_session_audit TO app_user;

DROP INDEX IF EXISTS public.attempts_student_id_question_code_idx;
DROP INDEX IF EXISTS public.attempts_test_session_id_idx;

ALTER TABLE public.attempts DROP CONSTRAINT IF EXISTS chk_auto_submit_source_when_session;
ALTER TABLE public.attempts DROP CONSTRAINT IF EXISTS attempts_test_session_id_fkey;
ALTER TABLE public.attempts
  DROP COLUMN IF EXISTS test_session_id,
  DROP COLUMN IF EXISTS visit_index_in_test,
  DROP COLUMN IF EXISTS auto_submit_source;
