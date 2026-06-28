-- Purpose: PRD-01 §6 A.3 (Req D) — 5 trigger-maintained TEXT[] summary
-- columns on problems + the SECURITY DEFINER BEFORE-trigger function that
-- recomputes them from wrong_paths, plus hint_count from hints. Pickup item:
-- Critic v2 catch #1 (GRANT UPDATE to trigger_owner) and catch #7
-- (no GRANT EXECUTE to app_user — trigger invocation is privileged).
-- Function explicitly SETs search_path = pg_catalog, public to defeat
-- search-path injection on SECURITY DEFINER.

-- ---------------------------------------------------------------------------
-- 1. Add the 5 summary columns + hint_count + the hints JSONB column that the
--    trigger below reads from. The `hints` column itself is functionally a
--    Req G column (relocated here from 0008 to satisfy migration ordering:
--    the trigger created in step 5 declares `UPDATE OF wrong_paths, hints`
--    and so the column must exist when this migration runs).
-- ---------------------------------------------------------------------------
ALTER TABLE public.problems
  ADD COLUMN IF NOT EXISTS err_reading_tags  TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS err_case_tags     TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS err_comp_tags     TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS err_strategy_tags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS err_parsing_tags  TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS hint_count        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hints             JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- 2. GIN indexes on the 5 summary arrays — covers ? and ?| operators used
--    by PRD-01 US-2 (axis-level set construction). Documented purpose:
--    keep summary-array queries ≤ 800 ms p95 at 10^4 problems.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS problems_err_reading_tags_gin
  ON public.problems USING GIN (err_reading_tags);
CREATE INDEX IF NOT EXISTS problems_err_case_tags_gin
  ON public.problems USING GIN (err_case_tags);
CREATE INDEX IF NOT EXISTS problems_err_comp_tags_gin
  ON public.problems USING GIN (err_comp_tags);
CREATE INDEX IF NOT EXISTS problems_err_strategy_tags_gin
  ON public.problems USING GIN (err_strategy_tags);
CREATE INDEX IF NOT EXISTS problems_err_parsing_tags_gin
  ON public.problems USING GIN (err_parsing_tags);

-- ---------------------------------------------------------------------------
-- 3. SECURITY DEFINER trigger function. Owned by trigger_owner (created in
--    0002). search_path explicitly pinned to defeat the search-path-injection
--    attack class on SECURITY DEFINER functions.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_recompute_diagnostic_summary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.err_reading_tags  := COALESCE((
    SELECT array_agg(DISTINCT t.v)
    FROM jsonb_array_elements(COALESCE(NEW.wrong_paths, '[]'::jsonb)) wp
    CROSS JOIN LATERAL (SELECT wp.value->'diagnostic_tags'->>'err_reading' AS v) t
    WHERE t.v IS NOT NULL AND t.v <> 'ERR-READING-NONE'
  ), ARRAY[]::text[]);

  NEW.err_case_tags     := COALESCE((
    SELECT array_agg(DISTINCT t.v)
    FROM jsonb_array_elements(COALESCE(NEW.wrong_paths, '[]'::jsonb)) wp
    CROSS JOIN LATERAL (SELECT wp.value->'diagnostic_tags'->>'err_case' AS v) t
    WHERE t.v IS NOT NULL AND t.v <> 'ERR-CASE-NONE'
  ), ARRAY[]::text[]);

  NEW.err_comp_tags     := COALESCE((
    SELECT array_agg(DISTINCT t.v)
    FROM jsonb_array_elements(COALESCE(NEW.wrong_paths, '[]'::jsonb)) wp
    CROSS JOIN LATERAL (SELECT wp.value->'diagnostic_tags'->>'err_comp' AS v) t
    WHERE t.v IS NOT NULL AND t.v <> 'ERR-COMP-NONE'
  ), ARRAY[]::text[]);

  NEW.err_strategy_tags := COALESCE((
    SELECT array_agg(DISTINCT t.v)
    FROM jsonb_array_elements(COALESCE(NEW.wrong_paths, '[]'::jsonb)) wp
    CROSS JOIN LATERAL (SELECT wp.value->'diagnostic_tags'->>'err_strategy' AS v) t
    WHERE t.v IS NOT NULL AND t.v <> 'ERR-STRAT-NONE'
  ), ARRAY[]::text[]);

  NEW.err_parsing_tags  := COALESCE((
    SELECT array_agg(DISTINCT t.v)
    FROM jsonb_array_elements(COALESCE(NEW.wrong_paths, '[]'::jsonb)) wp
    CROSS JOIN LATERAL (SELECT wp.value->'diagnostic_tags'->>'err_parsing' AS v) t
    WHERE t.v IS NOT NULL AND t.v <> 'ERR-PARSE-NONE'
  ), ARRAY[]::text[]);

  NEW.hint_count := COALESCE(jsonb_array_length(COALESCE(NEW.hints, '[]'::jsonb)), 0);

  RETURN NEW;
END;
$$;

-- Owner transfer (idempotent).
ALTER FUNCTION public.fn_recompute_diagnostic_summary() OWNER TO trigger_owner;

-- Defence-in-depth: deny PUBLIC any access to this function. Note: trigger
-- machinery invokes the function privilegedly, so no GRANT EXECUTE to
-- app_user is needed (Critic v2 catch #7).
REVOKE ALL ON FUNCTION public.fn_recompute_diagnostic_summary() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 4. CRITICAL: grant trigger_owner UPDATE on the columns the function writes
--    (Critic v2 catch #1 — the blocker that closes the SECURITY DEFINER loop).
--    Without this GRANT, the trigger fails 42501 on its own NEW := assignment.
-- ---------------------------------------------------------------------------
GRANT UPDATE (
  err_reading_tags,
  err_case_tags,
  err_comp_tags,
  err_strategy_tags,
  err_parsing_tags,
  hint_count
) ON public.problems TO trigger_owner;

-- trigger_owner also needs SELECT on the row (BEFORE triggers don't strictly
-- need this, but other diagnostic queries the function might run later do).
GRANT SELECT ON public.problems TO trigger_owner;

-- ---------------------------------------------------------------------------
-- 5. Install the trigger. BEFORE INSERT OR UPDATE so NEW commits atomically
--    with the source row in the same statement. PRD-01 §6 A.3 AC #1 holds
--    under READ COMMITTED (no separate visibility window).
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_diagnostic_summary ON public.problems;
CREATE TRIGGER trg_diagnostic_summary
  BEFORE INSERT OR UPDATE OF wrong_paths, hints
  ON public.problems
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_recompute_diagnostic_summary();

-- ---------------------------------------------------------------------------
-- 6. Block app_user from writing the trigger-maintained columns directly.
--    Combined with the trigger that writes them on behalf of legitimate
--    INSERT/UPDATE of wrong_paths or hints, this guarantees AC #2:
--    "no app-side write path can desync the summaries".
-- ---------------------------------------------------------------------------
REVOKE UPDATE (
  err_reading_tags,
  err_case_tags,
  err_comp_tags,
  err_strategy_tags,
  err_parsing_tags,
  hint_count
) ON public.problems FROM app_user;

-- ---------------------------------------------------------------------------
-- 7. Backfill existing rows by firing the trigger. This UPDATE runs as
--    migration_role (the table owner), so the column-level REVOKE on
--    app_user does NOT apply. Idempotent: re-running just recomputes the
--    same values.
-- ---------------------------------------------------------------------------
UPDATE public.problems SET wrong_paths = wrong_paths;
