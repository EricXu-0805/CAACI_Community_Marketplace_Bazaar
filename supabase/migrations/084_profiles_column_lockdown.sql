-- ============================================
-- 084 Profiles UPDATE lockdown (QA8 audit P0)
-- ============================================
-- Problem: `authenticated` holds table-wide UPDATE on public.profiles (granted
-- in 004), and the only UPDATE RLS policy (009: USING/WITH CHECK auth.uid()=id)
-- scopes the ROW, not columns. The moderation columns added in 027
-- (suspension_level, shadow_banned, suspended_until, trust_score, warning_count)
-- have no column privilege scope and no BEFORE-UPDATE guard — the only triggers
-- on profiles screen `bio` (045) and the illini columns (072). So a suspended or
-- shadow-banned user could `PATCH profiles?id=eq.<own-uid>` with the shipped anon
-- key + their own JWT to zero out their own suspension_level / suspended_until /
-- shadow_banned and forge trust_score / warning_count — fully self-unbanning.
-- Enforcement reads these cached columns directly (trg_enforce_actor gates
-- publishing on suspension_level/suspended_until; items_visible/posts_visible
-- hide content on shadow_banned), and nothing re-syncs from the immutable
-- suspensions table until an admin acts, so the ban is defeated end-to-end.
--
-- Fix mirrors 064 (messages): strip table-wide UPDATE and regrant only the
-- columns the client legitimately writes. The single direct client write path
-- (useAuth.updateProfile) sanitizes to exactly these six fields; consent /
-- onboarding write via SECURITY DEFINER RPCs (026, run as owner, unaffected by
-- this grant); ban/suspension/illini/verification writes are service_role-only
-- edge/RPC paths that bypass RLS + grants. So this is enforced BEFORE RLS: even
-- a crafted PATCH that SETs suspension_level is rejected at the privilege layer.
--
-- service_role/postgres keep full UPDATE (trusted server paths).

-- REVOKE FROM PUBLIC is not enough on this stack; anon + authenticated must be
-- revoked explicitly (same durable Supabase lesson as 064).
REVOKE UPDATE ON public.profiles FROM PUBLIC;
REVOKE UPDATE ON public.profiles FROM anon;
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT  UPDATE (nickname, avatar_url, bio, location, status_text, status_emoji)
  ON public.profiles TO authenticated;
