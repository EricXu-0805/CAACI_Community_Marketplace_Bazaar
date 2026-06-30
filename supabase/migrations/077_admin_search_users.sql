-- 077_admin_search_users.sql
--
-- gaps-4 from the 2026-06-29 admin review: there was no way to find a user.
-- Off-platform complaints (WeChat / email) name a person by nickname or email,
-- but the console could only reach a profile by drilling out from a report.
--
-- Adds a search RPC over profiles (nickname / email / exact id), surfacing
-- already-suspended or warned users first so the admin sees prior history at a
-- glance. Same authz posture as every other admin RPC: SECURITY DEFINER,
-- EXECUTE granted only to service_role (the edge function is the sole caller).
--
-- query_in is concatenated into a LIKE *value* (parameterized, not into SQL
-- text) so there is no injection surface; % / _ from the admin just act as
-- wildcards. The RETURNS TABLE types mirror the profiles columns exactly
-- (trust_score / suspension_level smallint, warning_count integer) and match
-- the shapes already returned by 029's admin_* list functions.

CREATE OR REPLACE FUNCTION public.admin_search_users(
  query_in text,
  limit_in integer DEFAULT 25
)
RETURNS TABLE (
  id               uuid,
  nickname         text,
  email            text,
  avatar_url       text,
  trust_score      smallint,
  warning_count    integer,
  suspension_level smallint,
  suspended_until  timestamptz,
  shadow_banned    boolean,
  created_at       timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    p.id, p.nickname, p.email, p.avatar_url,
    p.trust_score, p.warning_count, p.suspension_level,
    p.suspended_until, p.shadow_banned, p.created_at
  FROM public.profiles p
  WHERE btrim(coalesce(query_in, '')) <> ''
    AND (
      p.nickname ILIKE '%' || btrim(query_in) || '%'
      OR p.email  ILIKE '%' || btrim(query_in) || '%'
      OR p.id::text = btrim(query_in)
    )
  ORDER BY (p.suspension_level > 0) DESC, p.warning_count DESC, p.nickname
  LIMIT GREATEST(1, LEAST(coalesce(limit_in, 25), 50));
$$;

REVOKE ALL ON FUNCTION public.admin_search_users(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_search_users(text, integer) TO service_role;
