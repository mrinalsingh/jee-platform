-- Purpose: Req C — problem_reviews table + the SECURITY DEFINER consensus
-- trigger that recomputes authored_difficulty + jee_authenticity_score on
-- review write. Pickup items folded in:
--   * Critic v2 catch #1 + #4 + #5: GRANT UPDATE to trigger_owner, advisory
--     lock for serialisation, lowercase enum quoted as "TargetExam".
--   * Critic v2 catch #7: no GRANT EXECUTE to app_user.
--   * Blocker 5: structured RAISE EXCEPTION ... USING ERRCODE = '23514' with
--     message-prefix 'cross_walk_violation:' so the API layer can return a
--     422 with a usable diagnostic body.
-- Creates the v_inter_rater view in the same migration.

-- ---------------------------------------------------------------------------
-- 1. Table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.problem_reviews (
  id                     BIGSERIAL                        PRIMARY KEY,
  question_code          TEXT                              NOT NULL,
  reviewer_role          "ReviewerRole"                    NOT NULL,
  t_rating               "IntrinsicDifficulty"             NOT NULL,
  jee_authenticity_score DOUBLE PRECISION,
  reviewed_at            TIMESTAMP(3)                      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes                  TEXT,
  provenance             JSONB                             NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT problem_reviews_question_code_fkey
    FOREIGN KEY (question_code) REFERENCES public.problems(question_code) ON DELETE CASCADE,
  CONSTRAINT chk_problem_reviews_score_range
    CHECK (jee_authenticity_score IS NULL
           OR (jee_authenticity_score >= 0.0 AND jee_authenticity_score <= 10.0))
);

ALTER TABLE public.problem_reviews OWNER TO migration_role;

CREATE INDEX IF NOT EXISTS problem_reviews_question_code_idx
  ON public.problem_reviews(question_code);
CREATE INDEX IF NOT EXISTS problem_reviews_reviewer_role_idx
  ON public.problem_reviews(reviewer_role);
CREATE INDEX IF NOT EXISTS problem_reviews_qcode_reviewer_idx
  ON public.problem_reviews(question_code, reviewer_role);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.problem_reviews TO app_user;
GRANT USAGE, SELECT ON SEQUENCE public.problem_reviews_id_seq TO app_user;

-- ---------------------------------------------------------------------------
-- 2. Inter-rater view (per architecture §3).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_inter_rater AS
SELECT
  p.question_code,
  MAX(CASE WHEN r.reviewer_role = 'jee_platform_critic' THEN r.t_rating END) AS t_critic1,
  MAX(CASE WHEN r.reviewer_role = 'jee_mcq_critic'      THEN r.t_rating END) AS t_critic2,
  MAX(CASE WHEN r.reviewer_role = 'jee_platform_critic' THEN r.jee_authenticity_score END) AS s_critic1,
  MAX(CASE WHEN r.reviewer_role = 'jee_mcq_critic'      THEN r.jee_authenticity_score END) AS s_critic2
FROM public.problems p
LEFT JOIN public.problem_reviews r USING (question_code)
GROUP BY p.question_code;

ALTER VIEW public.v_inter_rater OWNER TO migration_role;
GRANT SELECT ON public.v_inter_rater TO app_user;

-- ---------------------------------------------------------------------------
-- 3. Consensus trigger function. Implements:
--    * Critic v2 catch #4: pg_advisory_xact_lock(hashtext(qcode)) at the top
--      to serialise concurrent reviewer writes to the same problem.
--    * Critic v2 catch #5: lowercase target_exam fixed to "TargetExam"
--      (PascalCase, double-quoted) to match Prisma's generated type name.
--    * Blocker 5: structured cross-walk-violation error with HINT.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_recompute_problem_consensus()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  qcode      TEXT;
  new_t      "IntrinsicDifficulty";
  new_s      DOUBLE PRECISION;
  low_b      DOUBLE PRECISION;
  high_b     DOUBLE PRECISION;
  target     "TargetExam";  -- Critic v2 catch #5: PascalCase quoted
  t_int      INTEGER;
  method     TEXT;
BEGIN
  qcode := COALESCE(NEW.question_code, OLD.question_code);

  -- Critic v2 catch #4: serialise concurrent reviewer writes to the same
  -- question_code. The lock is transaction-scoped, released on commit/rollback.
  -- hashtext() narrows the qcode TEXT into a bigint suitable for advisory locks.
  PERFORM pg_advisory_xact_lock(hashtext(qcode));

  -- 1. Compute the new T-rating consensus. Method defaults to 'mean' (round
  --    half away from zero on the integer index 1..5). Other methods could
  --    branch on problems.source_metadata->>'rating_consensus_method'.
  SELECT COALESCE(p.source_metadata->>'rating_consensus_method', 'mean')
    INTO method
    FROM public.problems p
   WHERE p.question_code = qcode;

  IF method = 'mean' OR method IS NULL THEN
    SELECT ROUND(AVG(CASE r.t_rating
                       WHEN 'T1' THEN 1 WHEN 'T2' THEN 2 WHEN 'T3' THEN 3
                       WHEN 'T4' THEN 4 WHEN 'T5' THEN 5 END))::INT
      INTO t_int
      FROM public.problem_reviews r
     WHERE r.question_code = qcode;
  ELSE
    -- Conservative fallback: use the existing authored_difficulty.
    SELECT CASE p.authored_difficulty
             WHEN 'T1' THEN 1 WHEN 'T2' THEN 2 WHEN 'T3' THEN 3
             WHEN 'T4' THEN 4 WHEN 'T5' THEN 5 END
      INTO t_int
      FROM public.problems p
     WHERE p.question_code = qcode;
  END IF;

  IF t_int IS NULL THEN
    -- No reviews left after a DELETE: leave authored_difficulty as-is.
    RETURN NULL;
  END IF;

  t_int := GREATEST(1, LEAST(5, t_int));
  new_t := (ARRAY['T1','T2','T3','T4','T5']::"IntrinsicDifficulty"[])[t_int];

  -- 2. Score consensus (mean of non-null scores).
  SELECT AVG(r.jee_authenticity_score)
    INTO new_s
    FROM public.problem_reviews r
   WHERE r.question_code = qcode AND r.jee_authenticity_score IS NOT NULL;

  -- 3. Cross-walk band check, only when target_exam = JEE_ADVANCED and a
  --    score consensus exists.
  SELECT p.target_exam INTO target FROM public.problems p WHERE p.question_code = qcode;

  IF target = 'JEE_ADVANCED' AND new_s IS NOT NULL THEN
    low_b  := CASE new_t WHEN 'T1' THEN 8.5 WHEN 'T2' THEN 8.8 WHEN 'T3' THEN 9.2
                         WHEN 'T4' THEN 9.5 WHEN 'T5' THEN 9.8 END;
    high_b := CASE new_t WHEN 'T1' THEN 8.8 WHEN 'T2' THEN 9.2 WHEN 'T3' THEN 9.5
                         WHEN 'T4' THEN 9.8 WHEN 'T5' THEN 10.0 END;

    IF new_s < low_b OR new_s > high_b THEN
      RAISE EXCEPTION
        'cross_walk_violation: new consensus (T=%, score=%) for problem % would fall outside the JEE_ADVANCED cross-walk band [%, %) for that T bucket. Adjust your t_rating or jee_authenticity_score so the new consensus stays in band.',
        new_t, ROUND(new_s::numeric, 2), qcode, low_b, high_b
        USING ERRCODE = '23514',
              HINT    = 'Either revise this review or also revise another review in problem_reviews so the average falls inside the band for the resulting T bucket.';
    END IF;
  END IF;

  -- 4. Apply consensus. Updating two columns of problems requires UPDATE on
  --    authored_difficulty + jee_authenticity_score. trigger_owner holds
  --    full UPDATE on problems (granted below).
  UPDATE public.problems p
     SET authored_difficulty    = new_t,
         jee_authenticity_score = new_s
   WHERE p.question_code = qcode;

  RETURN NULL;
END;
$$;

ALTER FUNCTION public.fn_recompute_problem_consensus() OWNER TO trigger_owner;
REVOKE ALL ON FUNCTION public.fn_recompute_problem_consensus() FROM PUBLIC;

-- trigger_owner needs UPDATE on the two columns the function writes.
GRANT UPDATE (authored_difficulty, jee_authenticity_score) ON public.problems TO trigger_owner;
GRANT SELECT ON public.problem_reviews TO trigger_owner;

-- Install the trigger AFTER (so the inserted row is visible to the
-- self-SELECT inside the function).
DROP TRIGGER IF EXISTS trg_consensus_after_review ON public.problem_reviews;
CREATE TRIGGER trg_consensus_after_review
  AFTER INSERT OR UPDATE OR DELETE
  ON public.problem_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_recompute_problem_consensus();
