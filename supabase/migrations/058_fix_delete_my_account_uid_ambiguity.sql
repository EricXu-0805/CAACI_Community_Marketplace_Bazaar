-- ============================================
-- 058: fix delete_my_account — "column reference \"uid\" is ambiguous"
--
-- Migration 004 declared a plpgsql variable named `uid`. When a later
-- migration added the public-facing profiles.uid column (the copyable
-- short user ID shown on the profile hero), every statement in the
-- function that referenced `uid` became ambiguous and the WHOLE
-- account-deletion path started throwing at runtime — no user has been
-- able to delete their account since that column landed. Caught by the
-- 2026-06-13 dual-account E2E round.
--
-- Fix: rename the variable to v_uid. Behavior is otherwise identical
-- to 004 (soft-delete: anonymize the profile, drop conversations —
-- messages/offers/meetups follow by FK cascade — and favorites; items
-- flip to status 'deleted').
--
-- Idempotent: CREATE OR REPLACE + explicit re-grants (mirrors 057's
-- privilege discipline: authenticated only, no anon/public EXECUTE).
-- ============================================

CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.items SET status = 'deleted' WHERE user_id = v_uid;
  DELETE FROM public.favorites WHERE user_id = v_uid;
  DELETE FROM public.conversations WHERE buyer_id = v_uid OR seller_id = v_uid;

  UPDATE public.profiles
    SET nickname = '[deleted]',
        avatar_url = '',
        bio = '',
        phone = NULL,
        email = NULL,
        wechat_openid = NULL,
        is_illini_verified = FALSE
    WHERE id = v_uid;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_my_account() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_my_account() FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;
