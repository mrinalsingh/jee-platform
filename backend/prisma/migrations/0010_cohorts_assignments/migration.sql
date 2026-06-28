-- Purpose: Req F — Cohort, CohortMember, TestAssignment.
-- TestAssignment carries the XOR(cohort_id, student_id) CHECK and the
-- window-order sanity CHECK.

-- ---------------------------------------------------------------------------
-- cohorts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cohorts (
  id                     BIGSERIAL    PRIMARY KEY,
  name                   TEXT         NOT NULL,
  batch_label            TEXT         NOT NULL,
  created_by_teacher_id  BIGINT       NOT NULL,
  created_at             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT cohorts_created_by_teacher_id_fkey
    FOREIGN KEY (created_by_teacher_id) REFERENCES public.teachers(id)
);
ALTER TABLE public.cohorts OWNER TO migration_role;
CREATE INDEX IF NOT EXISTS cohorts_created_by_teacher_id_idx
  ON public.cohorts(created_by_teacher_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cohorts TO app_user;
GRANT USAGE, SELECT ON SEQUENCE public.cohorts_id_seq TO app_user;

-- ---------------------------------------------------------------------------
-- cohort_members
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cohort_members (
  cohort_id   BIGINT       NOT NULL,
  student_id  BIGINT       NOT NULL,
  joined_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (cohort_id, student_id),

  CONSTRAINT cohort_members_cohort_id_fkey
    FOREIGN KEY (cohort_id) REFERENCES public.cohorts(id) ON DELETE CASCADE,
  CONSTRAINT cohort_members_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE
);
ALTER TABLE public.cohort_members OWNER TO migration_role;
-- Purpose: efficient "list cohorts containing student" lookups (dashboard SQL).
CREATE INDEX IF NOT EXISTS cohort_members_student_id_idx
  ON public.cohort_members(student_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cohort_members TO app_user;

-- ---------------------------------------------------------------------------
-- test_assignments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.test_assignments (
  id                        BIGSERIAL    PRIMARY KEY,
  test_id                   BIGINT       NOT NULL,
  cohort_id                 BIGINT,
  student_id                BIGINT,
  window_start_at           TIMESTAMP(3) NOT NULL,
  window_end_at             TIMESTAMP(3) NOT NULL,
  marking_scheme            JSONB,
  assigned_by_teacher_id    BIGINT       NOT NULL,
  assigned_at               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT test_assignments_test_id_fkey
    FOREIGN KEY (test_id) REFERENCES public.tests(id) ON DELETE CASCADE,
  CONSTRAINT test_assignments_cohort_id_fkey
    FOREIGN KEY (cohort_id) REFERENCES public.cohorts(id) ON DELETE CASCADE,
  CONSTRAINT test_assignments_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE,
  CONSTRAINT test_assignments_assigned_by_teacher_id_fkey
    FOREIGN KEY (assigned_by_teacher_id) REFERENCES public.teachers(id),

  -- (cohort_id XOR student_id): exactly one populated.
  CONSTRAINT chk_assignment_scope
    CHECK ((cohort_id IS NULL) <> (student_id IS NULL)),

  CONSTRAINT chk_window_order
    CHECK (window_end_at > window_start_at)
);
ALTER TABLE public.test_assignments OWNER TO migration_role;
-- Purpose:
--   test_id: "list all assignments for this test" (teacher view).
--   (student_id, window_start_at): student dashboard SQL Path B.
--   (cohort_id, window_start_at): student dashboard SQL Path A.
CREATE INDEX IF NOT EXISTS test_assignments_test_id_idx
  ON public.test_assignments(test_id);
CREATE INDEX IF NOT EXISTS test_assignments_student_id_window_start_at_idx
  ON public.test_assignments(student_id, window_start_at);
CREATE INDEX IF NOT EXISTS test_assignments_cohort_id_window_start_at_idx
  ON public.test_assignments(cohort_id, window_start_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.test_assignments TO app_user;
GRANT USAGE, SELECT ON SEQUENCE public.test_assignments_id_seq TO app_user;
