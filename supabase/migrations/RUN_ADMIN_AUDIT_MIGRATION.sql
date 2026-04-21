-- =========================================================
-- RUN ADMIN AUDIT MIGRATION (030 bundle + PostgREST reload)
-- =========================================================
-- Paste this ENTIRE file into Supabase SQL Editor and run ONCE.
--
-- Adds the audit-log columns (issued_by_nickname / lifted_by_nickname)
-- to three admin RPCs so the dashboard can show who applied / lifted
-- each suspension instead of opaque uuids.
--
-- Dependencies: 027 + 028 + 029 already applied.
-- Re-running is a safe no-op (OR REPLACE on every function).
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
  created_at          timestamptz,
  issued_by           uuid,
  issued_by_nickname  text,
  lifted_by           uuid,
  lifted_by_nickname  text
) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    s.id, s.profile_id, p.nickname, p.avatar_url,
    s.level, s.reason, s.category,
    s.started_at, s.ends_at, s.lifted_at,
    s.appeal_note, (s.appeal_note IS NOT NULL),
    s.created_at,
    s.issued_by, ip.nickname,
    s.lifted_by, lp.nickname
    FROM public.suspensions s
    JOIN public.profiles   p  ON p.id  = s.profile_id
    LEFT JOIN public.profiles ip ON ip.id = s.issued_by
    LEFT JOIN public.profiles lp ON lp.id = s.lifted_by
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
  lifted_by_nickname      text,
  lift_reason             text,
  appeal_note             text,
  issued_by               uuid,
  issued_by_nickname      text,
  created_at              timestamptz
) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    s.id, s.profile_id, p.nickname, p.avatar_url, p.email,
    p.trust_score, p.warning_count,
    s.level, s.reason, s.category,
    s.started_at, s.ends_at, s.lifted_at,
    s.lifted_by, lp.nickname, s.lift_reason,
    s.appeal_note,
    s.issued_by, ip.nickname,
    s.created_at
    FROM public.suspensions s
    JOIN public.profiles   p  ON p.id  = s.profile_id
    LEFT JOIN public.profiles ip ON ip.id = s.issued_by
    LEFT JOIN public.profiles lp ON lp.id = s.lifted_by
   WHERE s.id = suspension_id_in;
$$;

REVOKE ALL ON FUNCTION public.admin_get_suspension_detail(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_suspension_detail(uuid) TO service_role;


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
  created_at          timestamptz,
  issued_by           uuid,
  issued_by_nickname  text,
  lifted_by           uuid,
  lifted_by_nickname  text
) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    s.id, s.profile_id, p.nickname, p.avatar_url,
    s.level, s.reason, s.ends_at, s.appeal_note, s.created_at,
    s.issued_by, ip.nickname,
    s.lifted_by, lp.nickname
    FROM public.suspensions s
    JOIN public.profiles   p  ON p.id  = s.profile_id
    LEFT JOIN public.profiles ip ON ip.id = s.issued_by
    LEFT JOIN public.profiles lp ON lp.id = s.lifted_by
   WHERE s.appeal_note IS NOT NULL
     AND s.lifted_at   IS NULL
   ORDER BY s.created_at DESC
   LIMIT GREATEST(1, LEAST(limit_in, 200))
   OFFSET GREATEST(0, offset_in);
$$;

REVOKE ALL ON FUNCTION public.admin_list_appeals(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_appeals(integer, integer) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
