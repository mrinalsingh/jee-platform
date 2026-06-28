-- Purpose: Req B + Req H. Add problems.target_exam (NOT NULL,
-- DEFAULT JEE_ADVANCED) and problems.syllabus_status (NOT NULL,
-- DEFAULT WITHIN_SYLLABUS). Back-fills all existing 179 rows in the same
-- transaction. Lands the conditional cross-walk CHECK now that target_exam
-- exists.

-- ---------------------------------------------------------------------------
-- 1. Add target_exam (Req B). DEFAULT covers existing rows. Mark backfill
--    intent via source_metadata.target_exam_inferred = true for the rows
--    that took the default.
-- ---------------------------------------------------------------------------
ALTER TABLE public.problems
  ADD COLUMN IF NOT EXISTS target_exam "TargetExam" NOT NULL DEFAULT 'JEE_ADVANCED';

-- Mark the backfilled rows. Idempotent: only sets the marker once.
UPDATE public.problems
   SET source_metadata = jsonb_set(
         COALESCE(source_metadata, '{}'::jsonb),
         '{target_exam_inferred}',
         'true'::jsonb,
         true
       )
 WHERE COALESCE(source_metadata->>'target_exam_inferred', '') = '';

-- ---------------------------------------------------------------------------
-- 2. Add syllabus_status (Req H).
-- ---------------------------------------------------------------------------
ALTER TABLE public.problems
  ADD COLUMN IF NOT EXISTS syllabus_status "SyllabusStatus"
    NOT NULL DEFAULT 'WITHIN_SYLLABUS';

-- ---------------------------------------------------------------------------
-- 3. Indexes for query patterns:
--    - target_exam: student-side filter ("show me only JEE_ADVANCED problems")
--    - syllabus_status: student-side filter (default-exclude BEYOND_SYLLABUS)
--    - composite (target_exam, syllabus_status): the typical conjunction
--      used by the dashboard "available bank" count.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS problems_target_exam_idx
  ON public.problems(target_exam);

CREATE INDEX IF NOT EXISTS problems_syllabus_status_idx
  ON public.problems(syllabus_status);

CREATE INDEX IF NOT EXISTS problems_target_exam_syllabus_status_idx
  ON public.problems(target_exam, syllabus_status);

-- ---------------------------------------------------------------------------
-- 4. Cross-walk CHECK (Req A #2). Defers here because it references
--    target_exam. The constraint passes vacuously for non-JEE_ADVANCED rows
--    and for rows whose jee_authenticity_score is NULL.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_crosswalk_jee_advanced' AND conrelid = 'public.problems'::regclass
  ) THEN
    ALTER TABLE public.problems
      ADD CONSTRAINT chk_crosswalk_jee_advanced
      CHECK (
        target_exam <> 'JEE_ADVANCED'
        OR jee_authenticity_score IS NULL
        OR (authored_difficulty = 'T1' AND jee_authenticity_score >= 8.5 AND jee_authenticity_score <  8.8)
        OR (authored_difficulty = 'T2' AND jee_authenticity_score >= 8.8 AND jee_authenticity_score <  9.2)
        OR (authored_difficulty = 'T3' AND jee_authenticity_score >= 9.2 AND jee_authenticity_score <  9.5)
        OR (authored_difficulty = 'T4' AND jee_authenticity_score >= 9.5 AND jee_authenticity_score <  9.8)
        OR (authored_difficulty = 'T5' AND jee_authenticity_score >= 9.8 AND jee_authenticity_score <= 10.0)
      );
  END IF;
END $$;

-- Note: backfilling jee_authenticity_score to the midpoint of each T-bucket
-- band happens in scripts/seed-backfill.ts (run once, after migrations).
