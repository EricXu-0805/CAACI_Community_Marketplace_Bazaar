-- ============================================
-- 067 Moderate profile nickname (QA4 L1)
-- ============================================
-- 045 screened only `bio`. Nicknames (high-visibility: every card, post,
-- comment, chat, and plaza author search) bypassed moderation entirely at
-- both the signup and edit paths. Extend trg_moderate_profiles to also screen
-- `nickname`. Each field is screened independently and only when it actually
-- changes (or on INSERT), so an unrelated edit never blocks on a
-- grandfathered value — same "changed-only" posture 045 used for bio.
--
-- Signup note: handle_new_user() (042) wraps its INSERT in EXCEPTION WHEN
-- OTHERS -> RAISE WARNING, so a RAISE here during signup does NOT fail auth
-- signup — it skips profile creation (lazily backfilled later) and the
-- offensive nickname never reaches public.profiles. The client edit path is
-- where the user gets actionable feedback (the 'moderation_block:' sentinel
-- friendlyErrorMessage() already localizes).

CREATE OR REPLACE FUNCTION public.trg_moderate_profiles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result text;
BEGIN
  -- bio — screen on INSERT or when changed.
  IF TG_OP = 'INSERT' OR NEW.bio IS DISTINCT FROM OLD.bio THEN
    result := public.content_moderation_check(NEW.bio);
    IF result IS NOT NULL THEN
      RAISE EXCEPTION 'moderation_block:%', result;
    END IF;
  END IF;

  -- nickname — screen on INSERT or when changed.
  IF TG_OP = 'INSERT' OR NEW.nickname IS DISTINCT FROM OLD.nickname THEN
    result := public.content_moderation_check(NEW.nickname);
    IF result IS NOT NULL THEN
      RAISE EXCEPTION 'moderation_block:%', result;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
