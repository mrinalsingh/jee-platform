-- Rollback for 0007_problem_reviews.
DROP TRIGGER IF EXISTS trg_consensus_after_review ON public.problem_reviews;
DROP FUNCTION IF EXISTS public.fn_recompute_problem_consensus();
DROP VIEW IF EXISTS public.v_inter_rater;
REVOKE UPDATE (authored_difficulty, jee_authenticity_score) ON public.problems FROM trigger_owner;
REVOKE SELECT ON public.problem_reviews FROM trigger_owner;
DROP INDEX IF EXISTS public.problem_reviews_qcode_reviewer_idx;
DROP INDEX IF EXISTS public.problem_reviews_reviewer_role_idx;
DROP INDEX IF EXISTS public.problem_reviews_question_code_idx;
DROP TABLE IF EXISTS public.problem_reviews;
