-- Rollback for 0006_diagnostic_summaries.
DROP TRIGGER IF EXISTS trg_diagnostic_summary ON public.problems;
DROP FUNCTION IF EXISTS public.fn_recompute_diagnostic_summary();

-- Re-grant column-level UPDATE so post-rollback app behaviour matches pre-0006.
GRANT UPDATE (
  err_reading_tags,
  err_case_tags,
  err_comp_tags,
  err_strategy_tags,
  err_parsing_tags,
  hint_count
) ON public.problems TO app_user;

DROP INDEX IF EXISTS public.problems_err_reading_tags_gin;
DROP INDEX IF EXISTS public.problems_err_case_tags_gin;
DROP INDEX IF EXISTS public.problems_err_comp_tags_gin;
DROP INDEX IF EXISTS public.problems_err_strategy_tags_gin;
DROP INDEX IF EXISTS public.problems_err_parsing_tags_gin;

ALTER TABLE public.problems
  DROP COLUMN IF EXISTS hint_count,
  DROP COLUMN IF EXISTS err_parsing_tags,
  DROP COLUMN IF EXISTS err_strategy_tags,
  DROP COLUMN IF EXISTS err_comp_tags,
  DROP COLUMN IF EXISTS err_case_tags,
  DROP COLUMN IF EXISTS err_reading_tags;
