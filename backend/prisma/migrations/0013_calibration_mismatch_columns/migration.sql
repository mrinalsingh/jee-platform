-- Purpose: Wrap-up migration. The Req Q calibration-mismatch columns
-- (is_above_target_difficulty, better_fit_exam) landed in 0008. This
-- migration creates the three remaining auxiliary tables that the orchestrator
-- brief calls out (drill_recommendations, problem_figures,
-- problem_diagnostic_misses) and verifies Req Q indexes are in place. All
-- DDL is idempotent so this migration is safe to re-run.

-- ---------------------------------------------------------------------------
-- problem_figures (Req: figure storage in Postgres BYTEA, ≤ 100 KB per row
-- enforced at app layer)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.problem_figures (
  id             BIGSERIAL    PRIMARY KEY,
  question_code  TEXT         NOT NULL,
  figure_index   INTEGER      NOT NULL,
  mime_type      TEXT         NOT NULL,
  bytes          BYTEA        NOT NULL,
  width          INTEGER,
  height         INTEGER,
  alt_text       TEXT,
  created_at     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT problem_figures_question_code_fkey
    FOREIGN KEY (question_code) REFERENCES public.problems(question_code) ON DELETE CASCADE,
  CONSTRAINT problem_figures_question_code_figure_index_key
    UNIQUE (question_code, figure_index)
);
ALTER TABLE public.problem_figures OWNER TO migration_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.problem_figures TO app_user;
GRANT USAGE, SELECT ON SEQUENCE public.problem_figures_id_seq TO app_user;

-- ---------------------------------------------------------------------------
-- problem_diagnostic_misses (PRD-01 US-1 E2)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.problem_diagnostic_misses (
  id             BIGSERIAL    PRIMARY KEY,
  student_id     BIGINT       NOT NULL,
  question_code  TEXT         NOT NULL,
  wrong_answer   TEXT         NOT NULL,
  created_at     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT problem_diagnostic_misses_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE,
  CONSTRAINT problem_diagnostic_misses_question_code_fkey
    FOREIGN KEY (question_code) REFERENCES public.problems(question_code) ON DELETE CASCADE
);
ALTER TABLE public.problem_diagnostic_misses OWNER TO migration_role;
-- Purpose: admin queue "which problems are tripping students into untagged
-- wrong answers" + nightly batch grouping.
CREATE INDEX IF NOT EXISTS problem_diagnostic_misses_question_code_idx
  ON public.problem_diagnostic_misses(question_code);
CREATE INDEX IF NOT EXISTS problem_diagnostic_misses_created_at_idx
  ON public.problem_diagnostic_misses(created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.problem_diagnostic_misses TO app_user;
GRANT USAGE, SELECT ON SEQUENCE public.problem_diagnostic_misses_id_seq TO app_user;

-- ---------------------------------------------------------------------------
-- student_drill_recommendations (Req K)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_drill_recommendations (
  id                   BIGSERIAL                   PRIMARY KEY,
  student_id           BIGINT                      NOT NULL,
  generated_at         TIMESTAMP(3)                NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_test_id       BIGINT,
  problem_codes        TEXT[]                      NOT NULL DEFAULT '{}',
  target_failure_mode  TEXT,
  target_idea_code     TEXT,
  generated_test_id    BIGINT,
  status               "DrillRecommendationStatus" NOT NULL DEFAULT 'GENERATED',
  expires_at           TIMESTAMP(3),

  CONSTRAINT student_drill_recommendations_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE,
  CONSTRAINT student_drill_recommendations_source_test_id_fkey
    FOREIGN KEY (source_test_id)    REFERENCES public.tests(id) ON DELETE SET NULL,
  CONSTRAINT student_drill_recommendations_generated_test_id_fkey
    FOREIGN KEY (generated_test_id) REFERENCES public.tests(id) ON DELETE SET NULL
);
ALTER TABLE public.student_drill_recommendations OWNER TO migration_role;
-- Purpose:
--   (student_id, generated_at): "show me my recent drills" (student dashboard).
--   status: admin "GENERATED but never ASSIGNED" queue scan.
CREATE INDEX IF NOT EXISTS student_drill_recommendations_student_id_generated_at_idx
  ON public.student_drill_recommendations(student_id, generated_at);
CREATE INDEX IF NOT EXISTS student_drill_recommendations_status_idx
  ON public.student_drill_recommendations(status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_drill_recommendations TO app_user;
GRANT USAGE, SELECT ON SEQUENCE public.student_drill_recommendations_id_seq TO app_user;

-- ---------------------------------------------------------------------------
-- Req Q safety net. The two columns + indexes landed in 0008; these
-- statements verify the indexes are present (idempotent).
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS problems_above_target_idx
  ON public.problems(is_above_target_difficulty)
  WHERE is_above_target_difficulty = TRUE;

CREATE INDEX IF NOT EXISTS problems_better_fit_exam_idx
  ON public.problems(better_fit_exam)
  WHERE better_fit_exam IS NOT NULL;
