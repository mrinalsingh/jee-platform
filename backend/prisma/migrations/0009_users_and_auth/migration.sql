-- Purpose: Req F + auth — Teachers, Parents, StudentParent, AuthSession.
-- All owned by migration_role; app_user gets the per-table grants needed for
-- the auth + dashboard flows.

-- ---------------------------------------------------------------------------
-- teachers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.teachers (
  id          BIGSERIAL    PRIMARY KEY,
  email       TEXT         NOT NULL,
  full_name   TEXT         NOT NULL,
  is_admin    BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT teachers_email_key UNIQUE (email)
);
ALTER TABLE public.teachers OWNER TO migration_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.teachers TO app_user;
GRANT USAGE, SELECT ON SEQUENCE public.teachers_id_seq TO app_user;

-- ---------------------------------------------------------------------------
-- parents
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.parents (
  id          BIGSERIAL    PRIMARY KEY,
  email       TEXT         NOT NULL,
  full_name   TEXT         NOT NULL,
  created_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP(3) NOT NULL,

  CONSTRAINT parents_email_key UNIQUE (email)
);
ALTER TABLE public.parents OWNER TO migration_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.parents TO app_user;
GRANT USAGE, SELECT ON SEQUENCE public.parents_id_seq TO app_user;

-- ---------------------------------------------------------------------------
-- student_parents (link table; relationship enum)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_parents (
  student_id    BIGINT       NOT NULL,
  parent_id     BIGINT       NOT NULL,
  relationship  "ParentRelationship" NOT NULL DEFAULT 'GUARDIAN',
  created_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (student_id, parent_id),

  CONSTRAINT student_parents_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE,
  CONSTRAINT student_parents_parent_id_fkey
    FOREIGN KEY (parent_id)  REFERENCES public.parents(id)  ON DELETE CASCADE
);
ALTER TABLE public.student_parents OWNER TO migration_role;
-- Purpose: efficient "list parents for student" lookups.
CREATE INDEX IF NOT EXISTS student_parents_parent_id_idx
  ON public.student_parents(parent_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_parents TO app_user;

-- ---------------------------------------------------------------------------
-- auth_sessions
--   id is a 32-byte base64url string set by the application (= cookie value).
--   Exactly one of (student_id, teacher_id, parent_id) must be non-null,
--   enforced by chk_one_role.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.auth_sessions (
  id            TEXT         PRIMARY KEY,
  student_id    BIGINT,
  teacher_id    BIGINT,
  parent_id     BIGINT,
  created_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at    TIMESTAMP(3) NOT NULL,
  last_used_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_agent    TEXT,
  ip_hash       TEXT,

  CONSTRAINT auth_sessions_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE,
  CONSTRAINT auth_sessions_teacher_id_fkey
    FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE CASCADE,
  CONSTRAINT auth_sessions_parent_id_fkey
    FOREIGN KEY (parent_id)  REFERENCES public.parents(id)  ON DELETE CASCADE,

  CONSTRAINT chk_one_role CHECK (
    (CASE WHEN student_id IS NULL THEN 0 ELSE 1 END
   + CASE WHEN teacher_id IS NULL THEN 0 ELSE 1 END
   + CASE WHEN parent_id  IS NULL THEN 0 ELSE 1 END) = 1
  )
);
ALTER TABLE public.auth_sessions OWNER TO migration_role;
-- Purpose indexes:
--   expires_at: nightly cron to purge expired sessions.
--   per-role: "list active sessions for this user" (logout-all flow).
CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx ON public.auth_sessions(expires_at);
CREATE INDEX IF NOT EXISTS auth_sessions_student_id_idx ON public.auth_sessions(student_id);
CREATE INDEX IF NOT EXISTS auth_sessions_teacher_id_idx ON public.auth_sessions(teacher_id);
CREATE INDEX IF NOT EXISTS auth_sessions_parent_id_idx  ON public.auth_sessions(parent_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_sessions TO app_user;
