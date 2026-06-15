-- ============================================
-- 069 Email digest opt-out + unsubscribe token (QA4 L7)
-- ============================================
-- The notification digest emails every profile with a non-null email and has
-- no opt-out; the footer even points at a Settings -> Notifications screen
-- that doesn't exist. Add a per-user opt-out flag (default opted-IN, so
-- nothing changes for existing users) and an unguessable unsubscribe token
-- that the digest footer links to. The digest is inert by default
-- (DIGEST_LIVE!='true'), so there is no live blast today — but this MUST land
-- before DIGEST_LIVE is ever flipped.
--
-- RLS: profiles SELECT is USING(true) for PUBLIC, so a naively-added token
-- column would be world-readable via anon REST (anyone could harvest tokens
-- and unsubscribe everyone). REVOKE column SELECT on the token from anon +
-- authenticated — the digest + unsubscribe edge fn use the service-role key,
-- which bypasses RLS and column grants, so they still read/write it. (REVOKE
-- FROM PUBLIC alone is not enough on this stack — revoke the roles explicitly.)

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_digest_opt_out boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS unsubscribe_token uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS profiles_unsubscribe_token_idx
  ON public.profiles (unsubscribe_token);

REVOKE SELECT (unsubscribe_token) ON public.profiles FROM PUBLIC;
REVOKE SELECT (unsubscribe_token) ON public.profiles FROM anon;
REVOKE SELECT (unsubscribe_token) ON public.profiles FROM authenticated;

NOTIFY pgrst, 'reload schema';
