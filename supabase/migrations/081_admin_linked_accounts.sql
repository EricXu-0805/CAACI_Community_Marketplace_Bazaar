-- 081_admin_linked_accounts.sql
--
-- gaps-9 from the 2026-06-29 admin review: ban-evasion alt accounts were only
-- acted on automatically at L4+ (apply_ban_level shadow-bans device-fingerprint
-- siblings), and were otherwise invisible in the console — the admin couldn't
-- see "who else shares this person's device" before deciding how to act.
--
-- This exposes the same device-fingerprint join apply_ban_level uses, as a
-- read-only RPC: every other profile that shares at least one fp_hash with the
-- target, with a shared-device count and most-recent sighting. SECURITY
-- DEFINER, service_role only (the edge function is the sole caller).

CREATE OR REPLACE FUNCTION public.admin_get_linked_accounts(profile_id_in uuid)
RETURNS TABLE (
  id               uuid,
  nickname         text,
  email            text,
  avatar_url       text,
  suspension_level smallint,
  shadow_banned    boolean,
  shared_devices   bigint,
  last_seen        timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    p.id, p.nickname, p.email, p.avatar_url,
    p.suspension_level, p.shadow_banned,
    count(DISTINCT other.fp_hash) AS shared_devices,
    max(other.last_seen)          AS last_seen
  FROM public.device_fingerprints me
  JOIN public.device_fingerprints other
    ON other.fp_hash = me.fp_hash
   AND other.profile_id <> me.profile_id
  JOIN public.profiles p ON p.id = other.profile_id
  WHERE me.profile_id = profile_id_in
  GROUP BY p.id, p.nickname, p.email, p.avatar_url, p.suspension_level, p.shadow_banned
  ORDER BY count(DISTINCT other.fp_hash) DESC, max(other.last_seen) DESC NULLS LAST
  LIMIT 50;
$$;

REVOKE ALL ON FUNCTION public.admin_get_linked_accounts(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_get_linked_accounts(uuid) TO service_role;
