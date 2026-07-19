-- =========================================================
-- DEPRECATED OPERATOR BUNDLE — retained only as historical recovery evidence.
-- Do not execute this file. Its contracts predate the timestamped 2026-07
-- hardening chain and can overwrite current least-privilege functions.
-- Follow RUNBOOK.md and the matching PRECHECK/migration/VERIFY/REGRESSION files.
\set ON_ERROR_STOP on
DO $deprecated_operator_bundle$
BEGIN
  RAISE EXCEPTION
    'deprecated_operator_bundle: use the reviewed timestamped migration chain';
END
$deprecated_operator_bundle$;

-- =========================================================
-- RUN ADMIN MIGRATION (029 bundle + PostgREST reload)
-- =========================================================
-- Historical instructions below are retained for incident archaeology only.
--
-- Enables the /api/admin/* edge routes and the in-app moderation
-- dashboard at /pages/admin/index. Creates 9 admin_* RPCs that the
-- service_role key can call via PostgREST.
--
-- Dependencies (must already exist — set up by earlier migrations):
--   · public.suspensions (027)
--   · public.reports (004, 022)
--   · public.profiles + trust_score/warning_count columns (027)
--   · apply_ban_level / lift_suspension RPCs (027 + 028)
--
-- Re-running this is a safe no-op — every function uses OR REPLACE.
-- =========================================================

BEGIN;

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
    JOIN public.profiles   p ON p.id = s.profile_id
   WHERE (
     NOT active_only_in
     OR (s.lifted_at IS NULL AND (s.ends_at IS NULL OR s.ends_at > now()))
   )
   ORDER BY s.created_at DESC
   LIMIT GREATEST(1, LEAST(limit_in, 200))
   OFFSET GREATEST(0, offset_in);
$$;

REVOKE ALL ON FUNCTION public.admin_list_suspensions(integer, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_suspensions(integer, integer, boolean) TO service_role;


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
    JOIN public.profiles   p ON p.id = s.profile_id
   WHERE s.id = suspension_id_in;
$$;

REVOKE ALL ON FUNCTION public.admin_get_suspension_detail(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_suspension_detail(uuid) TO service_role;


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
    FROM public.reports  r
    JOIN public.profiles p ON p.id = r.reporter_id
   WHERE (status_filter IS NULL OR r.status = status_filter)
   ORDER BY r.created_at DESC
   LIMIT GREATEST(1, LEAST(limit_in, 200))
   OFFSET GREATEST(0, offset_in);
$$;

REVOKE ALL ON FUNCTION public.admin_list_reports(integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_reports(integer, integer, text) TO service_role;


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
        WHEN 'item'    THEN (SELECT i.user_id   FROM public.items         i  WHERE i.id  = r.target_id)
        WHEN 'post'    THEN (SELECT po.user_id  FROM public.posts         po WHERE po.id = r.target_id)
        WHEN 'message' THEN (SELECT m.sender_id FROM public.messages      m  WHERE m.id  = r.target_id)
        WHEN 'comment' THEN (SELECT c.user_id   FROM public.post_comments c  WHERE c.id  = r.target_id)
      END AS resolved_user_id,
      CASE r.target_type
        WHEN 'item'    THEN (SELECT left(i.title,    120) FROM public.items         i  WHERE i.id  = r.target_id)
        WHEN 'post'    THEN (SELECT left(po.content, 120) FROM public.posts         po WHERE po.id = r.target_id)
        WHEN 'message' THEN (SELECT left(m.content,  120) FROM public.messages      m  WHERE m.id  = r.target_id)
        WHEN 'comment' THEN (SELECT left(c.content,  120) FROM public.post_comments c  WHERE c.id  = r.target_id)
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
    JOIN public.profiles      rp ON rp.id = r.reporter_id
    LEFT JOIN public.profiles tp ON tp.id = r.resolved_user_id;
$$;

REVOKE ALL ON FUNCTION public.admin_get_report_detail(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_report_detail(uuid) TO service_role;


CREATE OR REPLACE FUNCTION public.admin_update_report_status(
  report_id_in uuid,
  status_in    text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF status_in NOT IN ('pending', 'reviewed', 'resolved', 'dismissed') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;
  UPDATE public.reports SET status = status_in WHERE id = report_id_in;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_report_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_report_status(uuid, text) TO service_role;


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
GRANT EXECUTE ON FUNCTION public.admin_get_profile_suspensions(uuid) TO service_role;


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
GRANT EXECUTE ON FUNCTION public.admin_list_appeals(integer, integer) TO service_role;


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
GRANT EXECUTE ON FUNCTION public.admin_list_warnings(integer, integer) TO service_role;


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
GRANT EXECUTE ON FUNCTION public.admin_dashboard_stats() TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =========================================================
-- Vercel env vars required for /api/admin/*:
--   ADMIN_API_KEY                (pick a long random string)
--   SUPABASE_URL                 (same as VITE_SUPABASE_URL)
--   SUPABASE_SECRET_KEY          (named key from Settings → API Keys)
--   SUPABASE_SERVICE_ROLE_KEY    (temporary legacy fallback only)
--
-- After setting those on Vercel, visit
--   https://<your-domain>/#/pages/admin/index
-- and paste ADMIN_API_KEY into the gate to unlock.
-- =========================================================
-- =========================================================
