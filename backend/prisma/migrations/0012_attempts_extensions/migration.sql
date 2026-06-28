-- Purpose: Req I + Req O + Critic v2 catch #6. Add three new columns to
-- attempts; REVOKE UPDATE/DELETE on attempts + test_session_audit FROM
-- app_user (structural append-only — relies on migration_role owning both
-- tables); add the chk_auto_submit_source_when_session CHECK constraint
-- (Critic v2 catch #6 — makes the NOT-NULL-when-session-bound invariant
-- structural rather than app-layer-only).

-- ---------------------------------------------------------------------------
-- 1. New columns on attempts.
-- ---------------------------------------------------------------------------
ALTER TABLE public.attempts
  ADD COLUMN IF NOT EXISTS auto_submit_source   "AutoSubmitSource",
  ADD COLUMN IF NOT EXISTS visit_index_in_test  INTEGER,
  ADD COLUMN IF NOT EXISTS test_session_id      BIGINT;

-- ---------------------------------------------------------------------------
-- 2. FK to test_sessions (nullable for standalone-practice attempts).
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'attempts_test_session_id_fkey' AND conrelid = 'public.attempts'::regclass
  ) THEN
    ALTER TABLE public.attempts
      ADD CONSTRAINT attempts_test_session_id_fkey
      FOREIGN KEY (test_session_id) REFERENCES public.test_sessions(id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. CHECK constraint per Critic v2 catch #6.
--    Invariant: a session-bound attempt MUST declare why it submitted.
--    Standalone-practice attempts (test_session_id IS NULL) are exempt.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_auto_submit_source_when_session' AND conrelid = 'public.attempts'::regclass
  ) THEN
    ALTER TABLE public.attempts
      ADD CONSTRAINT chk_auto_submit_source_when_session
      CHECK (test_session_id IS NULL OR auto_submit_source IS NOT NULL);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. New indexes.
-- ---------------------------------------------------------------------------
-- Purpose: session-bound lookups for the results screen.
CREATE INDEX IF NOT EXISTS attempts_test_session_id_idx
  ON public.attempts(test_session_id);
-- Purpose: attempt_order resolution at submit ("how many attempts has this
-- student already taken at this question?").
CREATE INDEX IF NOT EXISTS attempts_student_id_question_code_idx
  ON public.attempts(student_id, question_code);

-- ---------------------------------------------------------------------------
-- 5. Append-only structural enforcement.
--    attempts already has GRANT SELECT, INSERT (from 0002) — UPDATE/DELETE
--    were never granted. We REVOKE explicitly to make the intent visible
--    and to defend against any future migration that might have GRANTed
--    them on this branch.
-- ---------------------------------------------------------------------------
REVOKE UPDATE, DELETE ON public.attempts           FROM app_user;
REVOKE UPDATE, DELETE ON public.test_session_audit FROM app_user;
