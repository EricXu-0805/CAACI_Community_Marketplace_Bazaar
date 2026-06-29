-- 074_report_dedup_and_grouping.sql
--
-- gaps-2 from the 2026-06-29 admin review: the report queue had no dedup or
-- aggregation. 15 people reporting the same scammer = 15 separate cards, each
-- resolved one at a time, and a single user could file unlimited pending
-- reports on the same target. This:
--   1. collapses pre-existing duplicate PENDING reports so the unique index
--      below can be created (prod almost certainly has some),
--   2. adds a unique partial index so one reporter can hold at most ONE pending
--      report per target (the client maps the resulting 23505 to "already
--      reported"),
--   3. adds admin_list_reports_grouped — one row per (target_type,target_id)
--      with counts, ordered most-reported + oldest-pending first,
--   4. adds admin_resolve_target_reports — close ALL pending sibling reports on
--      a target in one action.

-- 1. Collapse existing duplicate pending reports (keep earliest; the rest become
--    'reviewed' so the unique-pending index can be built).
WITH dupes AS (
  SELECT id, row_number() OVER (
           PARTITION BY reporter_id, target_type, target_id
           ORDER BY created_at
         ) AS rn
  FROM public.reports
  WHERE status = 'pending'
)
UPDATE public.reports r
   SET status = 'reviewed'
  FROM dupes d
 WHERE r.id = d.id AND d.rn > 1;

-- 2. One pending report per (reporter, target).
CREATE UNIQUE INDEX IF NOT EXISTS uq_reports_pending_per_reporter_target
  ON public.reports (reporter_id, target_type, target_id)
  WHERE status = 'pending';

-- 3. Aggregated queue: one row per reported target.
CREATE OR REPLACE FUNCTION public.admin_list_reports_grouped(
  limit_in     integer DEFAULT 50,
  offset_in    integer DEFAULT 0,
  pending_only boolean DEFAULT true
)
RETURNS TABLE (
  target_type            text,
  target_id              uuid,
  report_count           bigint,
  pending_count          bigint,
  reporter_count         bigint,
  last_reason            text,
  last_note              text,
  last_reporter_nickname text,
  last_status            text,
  first_created_at       timestamptz,
  last_created_at        timestamptz,
  last_report_id         uuid
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH grp AS (
    SELECT
      r.target_type,
      r.target_id,
      count(*)                                          AS report_count,
      count(*) FILTER (WHERE r.status = 'pending')      AS pending_count,
      count(DISTINCT r.reporter_id)                     AS reporter_count,
      min(r.created_at)                                 AS first_created_at,
      max(r.created_at)                                 AS last_created_at,
      (array_agg(r.id ORDER BY r.created_at DESC))[1]   AS last_report_id
    FROM public.reports r
    GROUP BY r.target_type, r.target_id
  )
  SELECT
    g.target_type, g.target_id, g.report_count, g.pending_count, g.reporter_count,
    lr.reason, lr.note, p.nickname, lr.status,
    g.first_created_at, g.last_created_at, g.last_report_id
  FROM grp g
  JOIN public.reports  lr ON lr.id = g.last_report_id
  JOIN public.profiles p  ON p.id  = lr.reporter_id
  WHERE (NOT pending_only OR g.pending_count > 0)
  ORDER BY g.pending_count DESC, g.first_created_at ASC
  LIMIT GREATEST(1, LEAST(limit_in, 200))
  OFFSET GREATEST(0, offset_in);
$$;

REVOKE ALL ON FUNCTION public.admin_list_reports_grouped(integer, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_reports_grouped(integer, integer, boolean) TO service_role;

-- 4. Close all pending sibling reports on a target in one action.
CREATE OR REPLACE FUNCTION public.admin_resolve_target_reports(
  target_type_in text,
  target_id_in   uuid,
  status_in      text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  affected int := 0;
BEGIN
  IF status_in NOT IN ('reviewed', 'resolved', 'dismissed') THEN
    RAISE EXCEPTION 'invalid_status: %', status_in USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.reports
     SET status = status_in
   WHERE target_type = target_type_in
     AND target_id   = target_id_in
     AND status      = 'pending';
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'affected', affected);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_resolve_target_reports(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_resolve_target_reports(text, uuid, text) TO service_role;
