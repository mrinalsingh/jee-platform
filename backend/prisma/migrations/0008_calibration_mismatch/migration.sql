-- Purpose: Req Q. Add the two calibration-mismatch columns:
-- is_above_target_difficulty and better_fit_exam. Adds the two partial
-- indexes per Req Q. (hints + hint_count are added in 0006 because the
-- diagnostic-summary trigger declares UPDATE OF wrong_paths, hints and
-- so the hints column must exist before 0006 installs the trigger.)

-- ---------------------------------------------------------------------------
-- 1. Req Q: calibration-mismatch columns. Both are independent dimensions
--    (per architecture-input-notes Req Q final paragraph: NO CHECK coupling
--    these two columns).
-- ---------------------------------------------------------------------------
ALTER TABLE public.problems
  ADD COLUMN IF NOT EXISTS is_above_target_difficulty BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS better_fit_exam            "TargetExam";

-- ---------------------------------------------------------------------------
-- 2. Partial indexes per Req Q. Most rows will be FALSE / NULL, so partial
--    indexes keep the index size proportional to the relevant subset.
-- ---------------------------------------------------------------------------
-- Purpose: speed up "show me problems flagged as above target difficulty"
-- queries used by the teacher's calibration-mismatch dashboard.
CREATE INDEX IF NOT EXISTS problems_above_target_idx
  ON public.problems(is_above_target_difficulty)
  WHERE is_above_target_difficulty = TRUE;

-- Purpose: speed up "show me problems whose better_fit_exam = X" queries
-- used by the drill recommender to deprioritise wrong-fit problems.
CREATE INDEX IF NOT EXISTS problems_better_fit_exam_idx
  ON public.problems(better_fit_exam)
  WHERE better_fit_exam IS NOT NULL;
