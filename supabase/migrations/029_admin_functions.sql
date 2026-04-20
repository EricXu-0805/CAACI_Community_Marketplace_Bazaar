-- ============================================
-- 029 Admin Functions for Moderation Dashboard
-- ============================================
-- All functions are SECURITY DEFINER with REVOKE ALL FROM PUBLIC.
-- They are intended to be called ONLY via the service_role key from
-- the admin-gated /api/admin/* edge routes. Do NOT grant EXECUTE to
-- authenticated — a compromised client token must not be able to read
-- the entire suspensions/reports history.
--
-- Schema notes (verified against the live DB):
--   · reports.status enum: 'pending' | 'reviewed' | 'resolved' | 'dismissed'
--   · reports.target_type enum: 'item' | 'user' | 'message' | 'post' | 'comment'
--   · profiles has nickname + avatar_url + email + trust_score + warning_count
--   · suspensions has the full audit trail (see 027)
-- ============================================

-- --------------------------------------------
-- 1. admin_list_suspensions(limit, offset, active_only)
--    active_only = true filters to currently-enforced suspensions
--    (not lifted, and either open-ended or not expired).
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_suspensions(
  limit_in       integer DEFAULT 50,
  offset_in      integer DEFAULT 0,
  active_only_in boolean DEFAULT false
)
RETURNS TABLE (
  id                  uuid,
  profile_id          uuid,
  profile_nickname    text,
  profile_avatar_url  text,
  level               smallint,
  reason              text,
  category            text,
  started_at          timestamptz,
  ends_at             timestamptz,
  lifted_at           timestamptz,
  appeal_note         text,
  has_appeal          boolean,
  created_at          timestamptz
) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    s.id, s.profile_id, p.nickname, p.avatar_url,
    s.level, s.reason, s.category,
    s.started_at, s.ends_at, s.lifted_at,
    s.appeal_note, (s.appeal_note IS NOT NULL),
    s.created_at
  FROM public.suspensions s
  JOIN public.profiles p ON p.id = s.profile_id
  WHERE (
    NOT active_only_in
    OR (s.lifted_at IS NULL AND (s.ends_at IS NULL OR s.ends_at > now()))
  )
  ORDER BY s.created_at DESC
  LIMIT GREATEST(1, LEAST(limit_in, 200))
  OFFSET GREATEST(0, offset_in);
$$;

REVOKE ALL ON FUNCTION public.admin_list_suspensions(integer, integer, boolean) FROM PUBLIC;

-- --------------------------------------------
-- 2. admin_get_suspension_detail(id)
--    Returns suspension row + basic profile context.
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_suspension_detail(
  suspension_id_in uuid
)
RETURNS TABLE (
  id                      uuid,
  profile_id              uuid,
  profile_nickname        text,
  profile_avatar_url      text,
  profile_email           text,
  profile_trust_score     smallint,
  profile_warning_count   integer,
  level                   smallint,
  reason                  text,
  category                text,
  started_at              timestamptz,
  ends_at                 timestamptz,
  lifted_at               timestamptz,
  lifted_by               uuid,
  lift_reason             text,
  appeal_note             text,
  issued_by               uuid,
  created_at              timestamptz
) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    s.id, s.profile_id, p.nickname, p.avatar_url, p.email,
    p.trust_score, p.warning_count,
    s.level, s.reason, s.category,
    s.started_at, s.ends_at, s.lifted_at, s.lifted_by, s.lift_reason,
    s.appeal_note, s.issued_by, s.created_at
  FROM public.suspensions s
  JOIN public.profiles p ON p.id = s.profile_id
  WHERE s.id = suspension_id_in;
$$;

REVOKE ALL ON FUNCTION public.admin_get_suspension_detail(uuid) FROM PUBLIC;

-- --------------------------------------------
-- 3. admin_list_reports(limit, offset, status_filter)
--    status_filter NULL = all statuses. Returns reporter nickname inline
--    to avoid per-row lookups from the dashboard.
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_reports(
  limit_in       integer DEFAULT 50,
  offset_in      integer DEFAULT 0,
  status_filter  text    DEFAULT NULL
)
RETURNS TABLE (
  id                uuid,
  reporter_id       uuid,
  reporter_nickname text,
  target_type       text,
  target_id         uuid,
  reason            text,
  note              text,
  status            text,
  created_at        timestamptz
) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    r.id, r.reporter_id, p.nickname,
    r.target_type, r.target_id, r.reason, r.note,
    r.status, r.created_at
  FROM public.reports r
  JOIN public.profiles p ON p.id = r.reporter_id
  WHERE (status_filter IS NULL OR r.status = status_filter)
  ORDER BY r.created_at DESC
  LIMIT GREATEST(1, LEAST(limit_in, 200))
  OFFSET GREATEST(0, offset_in);
$$;

REVOKE ALL ON FUNCTION public.admin_list_reports(integer, integer, text) FROM PUBLIC;

-- --------------------------------------------
-- 4. admin_get_report_detail(id)
--    Resolves the target to its author via the correct table so the
--    dashboard can render 'who gets the ban'. Uses a single CASE to
--    pick the author column across target types.
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_report_detail(
  report_id_in uuid
)
RETURNS TABLE (
  id                    uuid,
  reporter_id           uuid,
  reporter_nickname     text,
  reporter_email        text,
  target_type           text,
  target_id             uuid,
  target_user_id        uuid,
  target_user_nickname  text,
  target_preview        text,
  reason                text,
  note                  text,
  status                text,
  created_at            timestamptz
) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH resolved AS (
    SELECT
      r.id,
      r.reporter_id,
      r.target_type,
      r.target_id,
      r.reason,
      r.note,
      r.status,
      r.created_at,
      CASE r.target_type
        WHEN 'user'    THEN r.target_id
        WHEN 'item'    THEN (SELECT i.user_id   FROM public.items         i WHERE i.id = r.target_id)
        WHEN 'post'    THEN (SELECT po.user_id  FROM public.posts         po WHERE po.id = r.target_id)
        WHEN 'message' THEN (SELECT m.sender_id FROM public.messages      m WHERE m.id = r.target_id)
        WHEN 'comment' THEN (SELECT c.user_id   FROM public.post_comments c WHERE c.id = r.target_id)
      END AS resolved_user_id,
      CASE r.target_type
        WHEN 'item'    THEN (SELECT left(i.title,    120) FROM public.items         i WHERE i.id = r.target_id)
        WHEN 'post'    THEN (SELECT left(po.content, 120) FROM public.posts         po WHERE po.id = r.target_id)
        WHEN 'message' THEN (SELECT left(m.content,  120) FROM public.messages      m WHERE m.id = r.target_id)
        WHEN 'comment' THEN (SELECT left(c.content,  120) FROM public.post_comments c WHERE c.id = r.target_id)
        ELSE NULL
      END AS resolved_preview
    FROM public.reports r
    WHERE r.id = report_id_in
  )
  SELECT
    r.id,
    r.reporter_id, rp.nickname, rp.email,
    r.target_type, r.target_id,
    r.resolved_user_id,
    tp.nickname,
    r.resolved_preview,
    r.reason, r.note, r.status, r.created_at
  FROM resolved r
  JOIN public.profiles rp      ON rp.id = r.reporter_id
  LEFT JOIN public.profiles tp ON tp.id = r.resolved_user_id;
$$;

REVOKE ALL ON FUNCTION public.admin_get_report_detail(uuid) FROM PUBLIC;

-- --------------------------------------------
-- 5. admin_update_report_status(id, status)
--    Moves a report through its lifecycle.
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_report_status(
  report_id_in uuid,
  status_in    text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF status_in NOT IN ('pending', 'reviewed', 'resolved', 'dismissed') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  UPDATE public.reports
     SET status = status_in
   WHERE id = report_id_in;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_report_status(uuid, text) FROM PUBLIC;

-- --------------------------------------------
-- 6. admin_get_profile_suspensions(profile_id)
--    All suspensions (active + lifted) for one profile — used for
--    context when deciding how to act on a new report.
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_profile_suspensions(
  profile_id_in uuid
)
RETURNS TABLE (
  id           uuid,
  level        smallint,
  reason       text,
  category     text,
  started_at   timestamptz,
  ends_at      timestamptz,
  lifted_at    timestamptz,
  appeal_note  text,
  created_at   timestamptz
) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    s.id, s.level, s.reason, s.category,
    s.started_at, s.ends_at, s.lifted_at, s.appeal_note,
    s.created_at
    FROM public.suspensions s
   WHERE s.profile_id = profile_id_in
   ORDER BY s.created_at DESC
   LIMIT 100;
$$;

REVOKE ALL ON FUNCTION public.admin_get_profile_suspensions(uuid) FROM PUBLIC;

-- --------------------------------------------
-- 7. admin_list_appeals(limit, offset)
--    Shortcut: suspensions where the user has filed an appeal_note
--    and the suspension is still active. Ordered by most recent appeal.
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_appeals(
  limit_in  integer DEFAULT 50,
  offset_in integer DEFAULT 0
)
RETURNS TABLE (
  id                  uuid,
  profile_id          uuid,
  profile_nickname    text,
  profile_avatar_url  text,
  level               smallint,
  reason              text,
  ends_at             timestamptz,
  appeal_note         text,
  created_at          timestamptz
) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    s.id, s.profile_id, p.nickname, p.avatar_url,
    s.level, s.reason, s.ends_at, s.appeal_note, s.created_at
    FROM public.suspensions s
    JOIN public.profiles   p ON p.id = s.profile_id
   WHERE s.appeal_note IS NOT NULL
     AND s.lifted_at   IS NULL
   ORDER BY s.created_at DESC
   LIMIT GREATEST(1, LEAST(limit_in, 200))
   OFFSET GREATEST(0, offset_in);
$$;

REVOKE ALL ON FUNCTION public.admin_list_appeals(integer, integer) FROM PUBLIC;

-- --------------------------------------------
-- 8. admin_list_warnings(limit, offset)
--    Profiles with warning_count > 0 — helps admins spot repeat
--    offenders before they escalate.
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_warnings(
  limit_in  integer DEFAULT 50,
  offset_in integer DEFAULT 0
)
RETURNS TABLE (
  profile_id         uuid,
  nickname           text,
  avatar_url         text,
  trust_score        smallint,
  warning_count      integer,
  shadow_banned      boolean,
  suspension_level   smallint,
  suspended_until    timestamptz
) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    p.id, p.nickname, p.avatar_url,
    p.trust_score, p.warning_count, p.shadow_banned,
    p.suspension_level, p.suspended_until
    FROM public.profiles p
   WHERE p.warning_count > 0
      OR p.shadow_banned = true
      OR p.suspension_level >= 2
   ORDER BY p.warning_count DESC, p.trust_score ASC
   LIMIT GREATEST(1, LEAST(limit_in, 200))
   OFFSET GREATEST(0, offset_in);
$$;

REVOKE ALL ON FUNCTION public.admin_list_warnings(integer, integer) FROM PUBLIC;

-- --------------------------------------------
-- 9. admin_dashboard_stats()
--    Cheap aggregate for the dashboard header — one call, four counts.
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_dashboard_stats()
RETURNS TABLE (
  active_suspensions integer,
  pending_reports    integer,
  pending_appeals    integer,
  shadow_banned      integer
) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    (SELECT COUNT(*) FROM public.suspensions
       WHERE lifted_at IS NULL
         AND (ends_at IS NULL OR ends_at > now())
         AND level >= 2)::integer,
    (SELECT COUNT(*) FROM public.reports   WHERE status = 'pending')::integer,
    (SELECT COUNT(*) FROM public.suspensions
       WHERE appeal_note IS NOT NULL AND lifted_at IS NULL)::integer,
    (SELECT COUNT(*) FROM public.profiles  WHERE shadow_banned = true)::integer;
$$;

REVOKE ALL ON FUNCTION public.admin_dashboard_stats() FROM PUBLIC;

-- --------------------------------------------
-- 10. Grant service_role minimum surface
--     service_role already bypasses RLS, but explicit EXECUTE grants
--     make the intended surface legible in pg_proc.
-- --------------------------------------------
GRANT EXECUTE ON FUNCTION public.admin_list_suspensions(integer, integer, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_suspension_detail(uuid)                 TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_reports(integer, integer, text)        TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_report_detail(uuid)                     TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_report_status(uuid, text)            TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_profile_suspensions(uuid)               TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_appeals(integer, integer)              TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_warnings(integer, integer)             TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_stats()                           TO service_role;

NOTIFY pgrst, 'reload schema';
