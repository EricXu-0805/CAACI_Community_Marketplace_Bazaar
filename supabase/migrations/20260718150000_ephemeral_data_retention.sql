-- Bounded cleanup for short-lived operational data only.
--
-- This intentionally does NOT define a retention schedule for moderation,
-- reports, suspensions, appeals, or admin audit evidence. Those records have
-- separate product/legal requirements. The three relations below are already
-- ephemeral by design:
--   * edge_rate_limits: fixed-window counters, whose server-enforced maximum
--     window is seven days;
--   * illini_verifications: pending email codes after their explicit expiry;
--   * wechat_media_checks: callback routing records older than seven days.
--
-- The no-argument RPC owns every cutoff and batch limit. Callers cannot widen
-- the deletion scope. It is SECURITY DEFINER only so the service role can
-- clean deny-all/RLS tables through one narrow capability.

BEGIN;

DO $guard$
DECLARE
  edge_rate_source text;
BEGIN
  IF pg_catalog.to_regclass('public.edge_rate_limits') IS NULL
     OR pg_catalog.to_regclass('public.illini_verifications') IS NULL
     OR pg_catalog.to_regclass('public.wechat_media_checks') IS NULL THEN
    RAISE EXCEPTION
      'ephemeral_retention_prerequisite_missing'
      USING ERRCODE = '55000';
  END IF;

  SELECT function.prosrc
  INTO edge_rate_source
  FROM pg_catalog.pg_proc AS function
  WHERE function.oid = pg_catalog.to_regprocedure(
    'public.edge_rate_hit(text,integer,integer)'
  );

  -- Deleting a seven-day-old bucket is safe only after edge_rate_hit rejects
  -- every longer window. Fail the migration rather than guessing from data.
  IF edge_rate_source IS NULL
     OR pg_catalog.strpos(
       pg_catalog.lower(edge_rate_source),
       'window_secs_in > 604800'
     ) = 0 THEN
    RAISE EXCEPTION
      'ephemeral_retention_requires_bounded_edge_rate_window'
      USING ERRCODE = '55000';
  END IF;
END
$guard$;

CREATE INDEX IF NOT EXISTS edge_rate_limits_window_start_idx
  ON public.edge_rate_limits (window_start, bucket);

CREATE INDEX IF NOT EXISTS illini_verifications_expires_at_idx
  ON public.illini_verifications (expires_at, user_id);

-- m087 already creates wechat_media_checks_created_at_idx. Add the primary
-- key as a deterministic tie-breaker while preserving the old index for
-- compatibility with already-deployed query plans.
CREATE INDEX IF NOT EXISTS wechat_media_checks_retention_idx
  ON public.wechat_media_checks (created_at, trace_id);

CREATE OR REPLACE FUNCTION public.run_ephemeral_data_retention()
RETURNS TABLE (
  edge_rate_limits_deleted integer,
  illini_verifications_deleted integer,
  wechat_media_checks_deleted integer,
  has_more boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_batch_limit constant integer := 1000;
BEGIN
  -- Fixed two-key transaction lock namespace for this sweep. A concurrent run
  -- fails immediately; it never waits behind a request whose client may have
  -- already timed out.
  IF NOT pg_catalog.pg_try_advisory_xact_lock(1128358729, 1) THEN
    RAISE EXCEPTION 'ephemeral_retention_busy' USING ERRCODE = '55P03';
  END IF;

  WITH candidates AS (
    SELECT rate.bucket
    FROM public.edge_rate_limits AS rate
    WHERE rate.window_start <= v_now - interval '7 days'
    ORDER BY rate.window_start, rate.bucket
    LIMIT v_batch_limit
    FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM public.edge_rate_limits AS rate
    USING candidates
    WHERE rate.bucket = candidates.bucket
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer
  INTO edge_rate_limits_deleted
  FROM deleted;

  WITH candidates AS (
    SELECT verification.user_id
    FROM public.illini_verifications AS verification
    WHERE verification.expires_at <= v_now
    ORDER BY verification.expires_at, verification.user_id
    LIMIT v_batch_limit
    FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM public.illini_verifications AS verification
    USING candidates
    WHERE verification.user_id = candidates.user_id
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer
  INTO illini_verifications_deleted
  FROM deleted;

  WITH candidates AS (
    SELECT media.trace_id
    FROM public.wechat_media_checks AS media
    WHERE media.created_at < v_now - interval '7 days'
    ORDER BY media.created_at, media.trace_id
    LIMIT v_batch_limit
    FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM public.wechat_media_checks AS media
    USING candidates
    WHERE media.trace_id = candidates.trace_id
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer
  INTO wechat_media_checks_deleted
  FROM deleted;

  has_more :=
    EXISTS (
      SELECT 1
      FROM public.edge_rate_limits AS rate
      WHERE rate.window_start <= v_now - interval '7 days'
    )
    OR EXISTS (
      SELECT 1
      FROM public.illini_verifications AS verification
      WHERE verification.expires_at <= v_now
    )
    OR EXISTS (
      SELECT 1
      FROM public.wechat_media_checks AS media
      WHERE media.created_at < v_now - interval '7 days'
    );

  RETURN NEXT;
END
$function$;

REVOKE ALL ON FUNCTION public.run_ephemeral_data_retention()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.run_ephemeral_data_retention()
  TO service_role;

COMMENT ON FUNCTION public.run_ephemeral_data_retention() IS
  'Service-role-only bounded cleanup of expired rate buckets, pending Illini codes, and >7-day WeChat media routing rows. Fixed cutoffs and 1000-row per-table caps; unrelated legal/audit records are out of scope.';

NOTIFY pgrst, 'reload schema';

COMMIT;
