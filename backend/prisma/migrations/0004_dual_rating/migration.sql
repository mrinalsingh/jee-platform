-- Purpose: Req A — dual rating. Add jee_authenticity_score to problems and
-- enforce both the absolute 0..10 range CHECK and the conditional cross-walk
-- CHECK against authored_difficulty (only when target_exam = JEE_ADVANCED).
-- The cross-walk band is the contract between T-rating and authenticity-score
-- defined in PRD-01 §6 and architecture-input-notes Req A.

-- ---------------------------------------------------------------------------
-- 1. Add the column.
-- ---------------------------------------------------------------------------
ALTER TABLE public.problems
  ADD COLUMN IF NOT EXISTS jee_authenticity_score DOUBLE PRECISION;

-- ---------------------------------------------------------------------------
-- 2. Absolute range CHECK (0..10 inclusive).
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_score_range' AND conrelid = 'public.problems'::regclass
  ) THEN
    ALTER TABLE public.problems
      ADD CONSTRAINT chk_score_range
      CHECK (jee_authenticity_score IS NULL
             OR (jee_authenticity_score >= 0.0 AND jee_authenticity_score <= 10.0));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Conditional cross-walk CHECK. The target_exam column is added in 0005;
--    target_exam = JEE_ADVANCED is the only branch with a non-trivial band.
--    The constraint references target_exam, which does not exist yet — so we
--    defer the cross-walk CHECK to migration 0005, where target_exam is
--    populated. This migration ONLY enforces 0..10.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 4. Index for score-range queries (PRD-01 § US-2: "give me top-N at T-bucket
--    Tn within score band [a, b]").
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS problems_jee_authenticity_score_idx
  ON public.problems(jee_authenticity_score);
