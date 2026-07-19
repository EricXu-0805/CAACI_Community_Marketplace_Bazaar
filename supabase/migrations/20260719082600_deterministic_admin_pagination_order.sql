-- Forward-only deterministic ordering for every admin offset-pagination RPC
-- that did not already end in a unique key. Without the final key, PostgreSQL
-- may return equal-ranked rows in a different order between requests, so a
-- page boundary can duplicate one row and omit another even when the data did
-- not change. Keep the current signatures, projections and product ordering;
-- only add unique tie-breakers and preserve service-role-only execution.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

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
      (array_agg(r.id ORDER BY r.created_at DESC, r.id DESC))[1]
                                                           AS last_report_id
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
  ORDER BY
    g.pending_count DESC,
    g.first_created_at ASC,
    g.target_type ASC,
    g.target_id ASC
  LIMIT GREATEST(1, LEAST(limit_in, 200))
  OFFSET GREATEST(0, offset_in);
$$;

REVOKE ALL ON FUNCTION public.admin_list_reports_grouped(integer, integer, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_reports_grouped(integer, integer, boolean)
  TO service_role;

CREATE OR REPLACE FUNCTION public.admin_list_suspensions(
  limit_in integer DEFAULT 50,
  offset_in integer DEFAULT 0,
  active_only_in boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  profile_id uuid,
  profile_nickname text,
  profile_avatar_url text,
  level smallint,
  reason text,
  category text,
  started_at timestamptz,
  ends_at timestamptz,
  lifted_at timestamptz,
  appeal_note text,
  has_appeal boolean,
  created_at timestamptz,
  issued_by uuid,
  issued_by_nickname text,
  lifted_by uuid,
  lifted_by_nickname text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT
    suspension.id,
    suspension.profile_id,
    profile.nickname,
    profile.avatar_url,
    suspension.level,
    suspension.reason,
    suspension.category,
    suspension.started_at,
    suspension.ends_at,
    suspension.lifted_at,
    suspension.appeal_note,
    suspension.appeal_note IS NOT NULL,
    suspension.created_at,
    suspension.issued_by,
    issuer.nickname,
    suspension.lifted_by,
    lifter.nickname
  FROM public.suspensions AS suspension
  JOIN public.profiles AS profile
    ON profile.id = suspension.profile_id
  LEFT JOIN public.profiles AS issuer
    ON issuer.id = suspension.issued_by
  LEFT JOIN public.profiles AS lifter
    ON lifter.id = suspension.lifted_by
  WHERE NOT active_only_in
     OR (
       suspension.started_at <= pg_catalog.statement_timestamp()
       AND suspension.lifted_at IS NULL
       AND (
         suspension.ends_at IS NULL
         OR suspension.ends_at > pg_catalog.statement_timestamp()
       )
     )
  ORDER BY suspension.created_at DESC, suspension.id DESC
  LIMIT GREATEST(1, LEAST(limit_in, 200))
  OFFSET GREATEST(0, offset_in)
$function$;

REVOKE ALL ON FUNCTION public.admin_list_suspensions(integer, integer, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_suspensions(integer, integer, boolean)
  TO service_role;

CREATE OR REPLACE FUNCTION public.admin_list_appeals(
  limit_in integer DEFAULT 50,
  offset_in integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  profile_id uuid,
  profile_nickname text,
  profile_avatar_url text,
  level smallint,
  reason text,
  ends_at timestamptz,
  appeal_note text,
  created_at timestamptz,
  issued_by uuid,
  issued_by_nickname text,
  lifted_by uuid,
  lifted_by_nickname text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  -- "Appeal" means pending human review, not that the underlying action is
  -- still active.  There is no separate appeal decision/status ledger yet;
  -- dropping expired rows here would silently remove unresolved cases from
  -- the only review queue.  The dashboard labels expiry and suppresses Lift.
  SELECT
    suspension.id,
    suspension.profile_id,
    profile.nickname,
    profile.avatar_url,
    suspension.level,
    suspension.reason,
    suspension.ends_at,
    suspension.appeal_note,
    suspension.created_at,
    suspension.issued_by,
    issuer.nickname,
    suspension.lifted_by,
    lifter.nickname
  FROM public.suspensions AS suspension
  JOIN public.profiles AS profile
    ON profile.id = suspension.profile_id
  LEFT JOIN public.profiles AS issuer
    ON issuer.id = suspension.issued_by
  LEFT JOIN public.profiles AS lifter
    ON lifter.id = suspension.lifted_by
  WHERE suspension.appeal_note IS NOT NULL
    AND suspension.lifted_at IS NULL
  ORDER BY suspension.created_at DESC, suspension.id DESC
  LIMIT GREATEST(1, LEAST(limit_in, 200))
  OFFSET GREATEST(0, offset_in)
$function$;

REVOKE ALL ON FUNCTION public.admin_list_appeals(integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_appeals(integer, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.admin_list_audit_log(
  limit_in     integer DEFAULT 100,
  offset_in    integer DEFAULT 0,
  kind_filter  text    DEFAULT NULL
)
RETURNS TABLE (
  id              bigint,
  event_kind      text,
  actor_id        uuid,
  actor_nickname  text,
  target_id       uuid,
  target_nickname text,
  details         jsonb,
  created_at      timestamptz
) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    l.id, l.event_kind,
    l.actor_id, ap.nickname,
    l.target_id, tp.nickname,
    l.details, l.created_at
    FROM public.admin_audit_log l
    LEFT JOIN public.profiles ap ON ap.id = l.actor_id
    LEFT JOIN public.profiles tp ON tp.id = l.target_id
   WHERE (kind_filter IS NULL OR l.event_kind = kind_filter)
   ORDER BY l.created_at DESC, l.id DESC
   LIMIT GREATEST(1, LEAST(limit_in, 500))
   OFFSET GREATEST(0, offset_in);
$$;

REVOKE ALL ON FUNCTION public.admin_list_audit_log(integer, integer, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_audit_log(integer, integer, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.admin_list_plaza_posts(
  limit_in  integer DEFAULT 50,
  offset_in integer DEFAULT 0
)
RETURNS TABLE (
  id              uuid,
  content         text,
  author_nickname text,
  author_id       uuid,
  is_pinned       boolean,
  is_official     boolean,
  like_count      integer,
  comment_count   integer,
  thumbnail       text,
  created_at      timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    p.id,
    left(p.content, 140),
    pr.nickname,
    p.user_id,
    p.is_pinned,
    p.is_official,
    p.like_count,
    p.comment_count,
    p.images[1],
    p.created_at
  FROM public.posts p
  JOIN public.profiles pr ON pr.id = p.user_id
  WHERE p.status = 'active'
  ORDER BY p.is_pinned DESC, p.created_at DESC, p.id DESC
  LIMIT GREATEST(1, LEAST(limit_in, 200))
  OFFSET GREATEST(0, offset_in);
$$;

REVOKE ALL ON FUNCTION public.admin_list_plaza_posts(integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_plaza_posts(integer, integer)
  TO service_role;

COMMIT;
