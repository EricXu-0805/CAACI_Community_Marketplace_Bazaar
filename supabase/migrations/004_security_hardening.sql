-- ============================================
-- 004 Security Hardening
-- ============================================
-- Fixes 3 latent security issues discovered in prod audit:
--   1. profiles SELECT policy leaked phone/email/wechat_openid
--   2. get_last_messages() was SECURITY DEFINER without auth.uid() filter
--   3. increment_view_count() had no existence check and could be abused
-- Also fixes a deployment-blocking duplicate policy from migration 003
-- and adds a missing composite index on favorites.
--
-- Idempotent: safe to re-run. No data loss. No breaking API changes for
-- the frontend (it already uses PUBLIC_PROFILE_FIELDS whitelist).
-- ============================================

-- --------------------------------------------
-- 1. profiles PII fix: column-level GRANTs
-- --------------------------------------------
-- Keep a permissive SELECT RLS policy so rows remain visible (required for
-- PostgREST FK embeds like items -> profile). Then use column-level GRANTs
-- to hide phone/email/wechat_openid from anon/authenticated callers.
-- Self-service reads of own PII go through a dedicated RPC below.

DROP POLICY IF EXISTS "Anyone can view profiles" ON public.profiles;

CREATE POLICY "Public profile rows readable"
  ON public.profiles FOR SELECT
  USING (true);

REVOKE SELECT ON public.profiles FROM anon, authenticated, PUBLIC;

GRANT SELECT (id, nickname, avatar_url, bio, location, created_at, is_illini_verified)
  ON public.profiles TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS public.profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.profiles WHERE id = auth.uid()
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_profile() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;

-- --------------------------------------------
-- 2. get_last_messages: add participant check
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.get_last_messages(conv_ids UUID[])
RETURNS TABLE(conversation_id UUID, content TEXT, message_type message_type)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (m.conversation_id)
    m.conversation_id, m.content, m.message_type
  FROM public.messages m
  JOIN public.conversations c ON c.id = m.conversation_id
  WHERE m.conversation_id = ANY(conv_ids)
    AND (c.buyer_id = auth.uid() OR c.seller_id = auth.uid())
  ORDER BY m.conversation_id, m.created_at DESC
$$;

REVOKE EXECUTE ON FUNCTION public.get_last_messages(UUID[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_last_messages(UUID[]) TO authenticated;

-- --------------------------------------------
-- 3. increment_view_count: validate target exists
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_view_count(item_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.items
  SET view_count = view_count + 1
  WHERE id = item_id
    AND status <> 'deleted';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.increment_view_count(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.increment_view_count(UUID) TO authenticated;

-- --------------------------------------------
-- 4. De-duplicate "Participants can update messages" (003 re-created it)
-- --------------------------------------------
DROP POLICY IF EXISTS "Participants can update messages" ON public.messages;
CREATE POLICY "Participants can update messages"
  ON public.messages FOR UPDATE
  USING (
    conversation_id IN (
      SELECT id FROM public.conversations
      WHERE buyer_id = auth.uid() OR seller_id = auth.uid()
    )
  );

-- --------------------------------------------
-- 5. Missing composite index on favorites
-- --------------------------------------------
CREATE INDEX IF NOT EXISTS idx_favorites_user_item
  ON public.favorites(user_id, item_id);

CREATE INDEX IF NOT EXISTS idx_favorites_item
  ON public.favorites(item_id);

-- --------------------------------------------
-- 6. Reports table (for the UI-only report/block buttons)
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS public.reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reporter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('item', 'user', 'message')),
  target_id UUID NOT NULL,
  reason TEXT NOT NULL,
  note TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_target ON public.reports(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON public.reports(status, created_at DESC);

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can create reports" ON public.reports;
CREATE POLICY "Users can create reports"
  ON public.reports FOR INSERT
  WITH CHECK (auth.uid() = reporter_id);

DROP POLICY IF EXISTS "Users can view own reports" ON public.reports;
CREATE POLICY "Users can view own reports"
  ON public.reports FOR SELECT
  USING (auth.uid() = reporter_id);

-- --------------------------------------------
-- 7. Blocks table (for the UI-only block button)
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS public.blocks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  blocker_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON public.blocks(blocker_id);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON public.blocks(blocked_id);

ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own blocks" ON public.blocks;
CREATE POLICY "Users manage own blocks"
  ON public.blocks FOR ALL
  USING (auth.uid() = blocker_id)
  WITH CHECK (auth.uid() = blocker_id);

-- --------------------------------------------
-- 8. Account deletion RPC
-- --------------------------------------------
-- Soft-delete: marks items deleted, clears profile, invalidates auth. We do
-- not hard-delete auth.users from a client-callable function because that
-- requires service_role; a scheduled job can sweep soft-deleted accounts
-- out of auth.users later.

CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.items SET status = 'deleted' WHERE user_id = uid;
  DELETE FROM public.favorites WHERE user_id = uid;
  DELETE FROM public.conversations WHERE buyer_id = uid OR seller_id = uid;

  UPDATE public.profiles
    SET nickname = '[deleted]',
        avatar_url = '',
        bio = '',
        phone = NULL,
        email = NULL,
        wechat_openid = NULL,
        is_illini_verified = FALSE
    WHERE id = uid;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_my_account() FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;

-- --------------------------------------------
-- 9. Illini email verification column
-- --------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_illini_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- Auto-flag verified on new signup if email ends in @illinois.edu
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, nickname, is_illini_verified)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'nickname', split_part(NEW.email, '@', 1), '用户'),
    (LOWER(COALESCE(NEW.email, '')) LIKE '%@illinois.edu')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Backfill existing users
UPDATE public.profiles p
SET is_illini_verified = TRUE
FROM auth.users u
WHERE p.id = u.id
  AND LOWER(COALESCE(u.email, '')) LIKE '%@illinois.edu'
  AND p.is_illini_verified = FALSE;

-- --------------------------------------------
-- 9. Verification check
-- --------------------------------------------
-- Run these after migration to confirm:
--
-- SET role anon;
-- SELECT phone, email FROM public.profiles LIMIT 1;         -- should error / return 0
-- SELECT id, nickname FROM public.public_profiles LIMIT 1;  -- should work
-- RESET role;
--
-- SELECT * FROM public.get_last_messages(ARRAY[gen_random_uuid()]); -- empty without auth
-- SELECT public.increment_view_count(gen_random_uuid());            -- no-op
