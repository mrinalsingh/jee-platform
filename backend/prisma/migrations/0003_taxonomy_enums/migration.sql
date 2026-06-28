-- Purpose: create the new enums (TargetExam, SyllabusStatus, ReviewerRole,
-- AssignmentScope, ParentRelationship, TestSessionStatus, AutoSubmitSource,
-- ViolationType, DrillRecommendationStatus) and extend the existing AnswerType
-- with 5 placeholders per Req J. ALTER TYPE ... ADD VALUE must run OUTSIDE a
-- transaction; Prisma runs each migration in its own transaction by default.
-- We split the enum extension into the START of the migration (before any
-- DDL inside the implicit tx). All enum names match the PascalCase Prisma
-- generates (Critic v2 catch #5).

-- ---------------------------------------------------------------------------
-- 1. Extend AnswerType (Req J).
--    Must come BEFORE any other DDL in this migration if Prisma wraps in tx.
--    Prisma 6 detects ALTER TYPE ... ADD VALUE and emits the statements
--    outside the transaction block. We mark each with IF NOT EXISTS so the
--    migration is re-runnable.
-- ---------------------------------------------------------------------------
ALTER TYPE "AnswerType" ADD VALUE IF NOT EXISTS 'MCQ_PASSAGE';
ALTER TYPE "AnswerType" ADD VALUE IF NOT EXISTS 'NUM_DIGIT';
ALTER TYPE "AnswerType" ADD VALUE IF NOT EXISTS 'MAT_LIST';
ALTER TYPE "AnswerType" ADD VALUE IF NOT EXISTS 'MCQ_AR';
ALTER TYPE "AnswerType" ADD VALUE IF NOT EXISTS 'FILL';

-- ---------------------------------------------------------------------------
-- 2. Create new enums. All quoted PascalCase to match Prisma's generated
--    type names. DO blocks make CREATE TYPE idempotent (CREATE TYPE has no
--    IF NOT EXISTS until Postgres 17).
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TargetExam') THEN
    CREATE TYPE "TargetExam" AS ENUM (
      'JEE_ADVANCED', 'JEE_MAIN', 'IOQM', 'INMO', 'RMO',
      'KVPY', 'COACHING', 'ORIGINAL', 'OTHER'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SyllabusStatus') THEN
    CREATE TYPE "SyllabusStatus" AS ENUM (
      'WITHIN_SYLLABUS', 'BORDERLINE', 'BEYOND_SYLLABUS'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReviewerRole') THEN
    CREATE TYPE "ReviewerRole" AS ENUM (
      'jee_platform_critic', 'jee_mcq_critic',
      'human_reviewer_primary', 'human_reviewer_secondary',
      'automated_calibration'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AssignmentScope') THEN
    CREATE TYPE "AssignmentScope" AS ENUM ('COHORT', 'STUDENT');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ParentRelationship') THEN
    CREATE TYPE "ParentRelationship" AS ENUM ('FATHER', 'MOTHER', 'GUARDIAN', 'OTHER');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TestSessionStatus') THEN
    CREATE TYPE "TestSessionStatus" AS ENUM ('ACTIVE', 'SUBMITTED', 'EXPIRED');
  END IF;
END $$;

-- Blocker 4: canonical 4-value enum.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AutoSubmitSource') THEN
    CREATE TYPE "AutoSubmitSource" AS ENUM (
      'TIMER_EXPIRY', 'VIOLATION_THRESHOLD', 'NETWORK_FAILURE_FALLBACK', 'MANUAL'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ViolationType') THEN
    CREATE TYPE "ViolationType" AS ENUM (
      'TAB_SWITCH', 'WINDOW_BLUR', 'FULLSCREEN_EXIT', 'RIGHT_CLICK',
      'COPY_ATTEMPT', 'CUT_ATTEMPT', 'PASTE_ATTEMPT',
      'DEVTOOLS_KEYSTROKE', 'COPY_KEY_SHORTCUT'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DrillRecommendationStatus') THEN
    CREATE TYPE "DrillRecommendationStatus" AS ENUM (
      'GENERATED', 'ASSIGNED', 'ATTEMPTED', 'EXPIRED'
    );
  END IF;
END $$;

-- Transfer ownership of every newly-created enum to migration_role
-- (a future ALTER TABLE that ADDs a column of this type as app_user must
-- not require ownership). This is idempotent.
DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT t.typname AS name
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typtype = 'e'
      AND t.typname IN (
        'TargetExam','SyllabusStatus','ReviewerRole','AssignmentScope',
        'ParentRelationship','TestSessionStatus','AutoSubmitSource',
        'ViolationType','DrillRecommendationStatus'
      )
  LOOP
    EXECUTE format('ALTER TYPE public.%I OWNER TO migration_role', rec.name);
  END LOOP;
END
$$;
