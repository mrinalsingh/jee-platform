-- Purpose: Req I + Req N — TestSession, TestSessionSnapshot, TestSessionAudit.
-- TestSession carries frozen_question_codes + session_secret_current/previous
-- + secret_rotated_at. Snapshot table is transient (UPDATE-overwrite is the
-- expected pattern). Audit table is append-only (REVOKE in 0012).

-- ---------------------------------------------------------------------------
-- test_sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.test_sessions (
  id                       BIGSERIAL    PRIMARY KEY,
  test_id                  BIGINT       NOT NULL,
  test_assignment_id       BIGINT       NOT NULL,
  student_id               BIGINT       NOT NULL,

  -- Req N: HMAC custody with grace.
  session_secret_current   BYTEA        NOT NULL,
  session_secret_previous  BYTEA,
  secret_rotated_at        TIMESTAMP(3),

  started_at               TIMESTAMP(3),
  expires_at               TIMESTAMP(3),
  submitted_at             TIMESTAMP(3),

  status                   "TestSessionStatus" NOT NULL DEFAULT 'ACTIVE',
  auto_submit_source       "AutoSubmitSource",
  violations_count         INTEGER      NOT NULL DEFAULT 0,

  -- Frozen snapshot of ordered question codes at START.
  frozen_question_codes    JSONB        NOT NULL,

  created_at               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT test_sessions_test_id_fkey
    FOREIGN KEY (test_id) REFERENCES public.tests(id),
  CONSTRAINT test_sessions_test_assignment_id_fkey
    FOREIGN KEY (test_assignment_id) REFERENCES public.test_assignments(id),
  CONSTRAINT test_sessions_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE
);
ALTER TABLE public.test_sessions OWNER TO migration_role;
-- Purpose:
--   student_id: list "my sessions".
--   test_id: admin "all sessions for this test".
--   expires_at: server-side auto-submit cron scan.
--   submitted_at: results-ready query.
CREATE INDEX IF NOT EXISTS test_sessions_student_id_idx   ON public.test_sessions(student_id);
CREATE INDEX IF NOT EXISTS test_sessions_test_id_idx      ON public.test_sessions(test_id);
CREATE INDEX IF NOT EXISTS test_sessions_expires_at_idx   ON public.test_sessions(expires_at);
CREATE INDEX IF NOT EXISTS test_sessions_submitted_at_idx ON public.test_sessions(submitted_at);

-- Composite for dashboard UNION-DEDUPE join.
CREATE INDEX IF NOT EXISTS test_sessions_assignment_student_idx
  ON public.test_sessions(test_assignment_id, student_id);

-- Partial unique index: at most one ACTIVE (= not submitted) session per
-- (student, test). Prisma cannot express partial uniques.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_session
  ON public.test_sessions(student_id, test_id)
  WHERE submitted_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.test_sessions TO app_user;
GRANT USAGE, SELECT ON SEQUENCE public.test_sessions_id_seq TO app_user;

-- ---------------------------------------------------------------------------
-- test_session_snapshots (transient; UPDATE expected)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.test_session_snapshots (
  session_id            BIGINT       NOT NULL,
  slot_index            INTEGER      NOT NULL,
  question_code         TEXT         NOT NULL,
  answer_payload        JSONB,
  time_seconds          INTEGER      NOT NULL DEFAULT 0,
  visit_count           INTEGER      NOT NULL DEFAULT 0,
  marked_for_review     BOOLEAN      NOT NULL DEFAULT FALSE,
  hints_used            INTEGER      NOT NULL DEFAULT 0,
  hint_levels_revealed  INTEGER[]    NOT NULL DEFAULT '{}',
  action_seq            BIGINT       NOT NULL DEFAULT 0,
  last_action_at        TIMESTAMP(3),

  PRIMARY KEY (session_id, slot_index),

  CONSTRAINT test_session_snapshots_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES public.test_sessions(id) ON DELETE CASCADE,
  CONSTRAINT test_session_snapshots_question_code_fkey
    FOREIGN KEY (question_code) REFERENCES public.problems(question_code),

  -- Per architecture §3 model comment: visit_count, time_seconds, hints_used
  -- must be non-negative.
  CONSTRAINT chk_snapshot_counts_nonneg
    CHECK (visit_count >= 0 AND time_seconds >= 0 AND hints_used >= 0)
);
ALTER TABLE public.test_session_snapshots OWNER TO migration_role;
CREATE INDEX IF NOT EXISTS test_session_snapshots_session_id_idx
  ON public.test_session_snapshots(session_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.test_session_snapshots TO app_user;

-- ---------------------------------------------------------------------------
-- test_session_audit (append-only — REVOKE in 0012)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.test_session_audit (
  id                    BIGSERIAL    PRIMARY KEY,
  session_id            BIGINT       NOT NULL,
  student_id            BIGINT       NOT NULL,
  endpoint              TEXT         NOT NULL,
  action_payload_hash   TEXT         NOT NULL,
  client_ip             TEXT,
  user_agent            TEXT,
  server_timestamp      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  violation_type        "ViolationType",
  violation_timestamp   TIMESTAMP(3),
  was_active            BOOLEAN,
  hint_level            INTEGER,
  slot_index            INTEGER,

  CONSTRAINT test_session_audit_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES public.test_sessions(id) ON DELETE CASCADE
);
ALTER TABLE public.test_session_audit OWNER TO migration_role;
-- Purpose:
--   session_id: per-session audit lookup.
--   (session_id, violation_type): forensic violation queries.
--   server_timestamp: time-window forensic queries.
CREATE INDEX IF NOT EXISTS test_session_audit_session_id_idx
  ON public.test_session_audit(session_id);
CREATE INDEX IF NOT EXISTS test_session_audit_session_id_violation_type_idx
  ON public.test_session_audit(session_id, violation_type);
CREATE INDEX IF NOT EXISTS test_session_audit_server_timestamp_idx
  ON public.test_session_audit(server_timestamp);
-- Append-only: SELECT + INSERT only. UPDATE/DELETE intentionally not granted.
GRANT SELECT, INSERT ON public.test_session_audit TO app_user;
GRANT USAGE, SELECT ON SEQUENCE public.test_session_audit_id_seq TO app_user;
