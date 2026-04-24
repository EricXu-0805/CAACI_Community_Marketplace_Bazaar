-- ============================================
-- 033 Fix missing SECURITY DEFINER on BEFORE INSERT trigger functions
-- ============================================
--
-- BUG (caught in production 2025-04-24): publishing a new item fails
-- with 42501 "permission denied for table profiles".
--
-- Root cause: `public.trg_enforce_actor()` (migrations 027 + 028) is
-- a BEFORE INSERT trigger on items / posts / post_comments / messages
-- that reads `profiles.suspension_level` and `profiles.suspended_until`
-- to enforce shadow bans. Both functions were defined as LANGUAGE
-- plpgsql without SECURITY DEFINER, so they execute with the CALLER's
-- privileges.
--
-- Meanwhile migration 004 intentionally revokes full SELECT on
-- public.profiles from anon/authenticated and only grants column-level
-- SELECT on safe columns (id, nickname, avatar_url, etc). The
-- suspension_* columns are deliberately NOT in that list. So when an
-- authenticated user INSERTs into items, the trigger function fires
-- under the authenticated role, tries to read suspension_level, and
-- hits 42501 before moderation or rate-limit triggers get a chance.
--
-- Trigger fire order on items is alphabetical by trigger name:
--   enforce_actor_items  (broken, fires 1st)
--   moderate_items       (also broken, never reached)
--   trg_rl_items_before_insert  (fine, has SECURITY DEFINER since 012)
--
-- Fix: add SECURITY DEFINER + SET search_path = public to every
-- trigger function that reads privileged tables. This matches the
-- pattern already used by rl_items_before_insert / notify_* / etc.
--
-- This migration ONLY redefines functions; the existing CREATE
-- TRIGGER attachments from 024/027/028 don't need to change — they
-- reference the function by name, which now has the correct
-- security profile.

-- --------------------------------------------
-- 1. Suspension enforcement (items / posts / comments / messages)
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_enforce_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id     uuid;
  active_level smallint;
  ends_at      timestamptz;
BEGIN
  IF TG_TABLE_NAME = 'posts' THEN
    actor_id := NEW.user_id;
  ELSIF TG_TABLE_NAME = 'post_comments' THEN
    actor_id := NEW.user_id;
  ELSIF TG_TABLE_NAME = 'items' THEN
    actor_id := NEW.user_id;
  ELSIF TG_TABLE_NAME = 'messages' THEN
    actor_id := NEW.sender_id;
  END IF;

  IF actor_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL AND actor_id <> auth.uid() THEN
    RETURN NEW;
  END IF;

  active_level := (
    SELECT p.suspension_level FROM public.profiles p WHERE p.id = actor_id
  );
  ends_at := (
    SELECT p.suspended_until FROM public.profiles p WHERE p.id = actor_id
  );

  IF active_level IS NOT NULL
     AND active_level >= 2
     AND (ends_at IS NULL OR ends_at > now()) THEN
    RAISE EXCEPTION 'suspension_active:%:%',
      active_level,
      COALESCE(to_char(ends_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'permanent');
  END IF;

  RETURN NEW;
END;
$$;

-- --------------------------------------------
-- 2. Suspension helper used by RPCs
-- --------------------------------------------
DROP FUNCTION IF EXISTS public.is_posting_allowed(uuid);
CREATE OR REPLACE FUNCTION public.is_posting_allowed(profile_id_in uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS(
    SELECT 1 FROM public.profiles p
     WHERE p.id = profile_id_in
       AND p.suspension_level >= 2
       AND (p.suspended_until IS NULL OR p.suspended_until > now())
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_posting_allowed(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_posting_allowed(uuid) TO authenticated;

-- --------------------------------------------
-- 3. Content moderation keyword check
-- --------------------------------------------
-- moderation_keywords has RLS enabled with no authenticated-facing
-- policy (mk_service_only only), so the loop inside this function
-- must run under owner privileges.
CREATE OR REPLACE FUNCTION public.content_moderation_check(raw text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  norm text;
  kw   record;
BEGIN
  IF raw IS NULL OR length(raw) = 0 THEN
    RETURN NULL;
  END IF;

  norm := public.content_moderation_normalize(raw);

  IF norm ~ '(?<![0-9])1[3-9][0-9]{9}(?![0-9])' THEN
    RETURN 'contact_info';
  END IF;
  IF raw ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' THEN
    RETURN 'contact_info';
  END IF;
  IF norm ~ '(微信|wechat|weixin|加v|加微|v信|vx|v我)' THEN
    RETURN 'contact_info';
  END IF;

  FOR kw IN
    SELECT LOWER(keyword) AS k
    FROM public.moderation_keywords
    WHERE active = true
  LOOP
    IF norm LIKE '%' || replace(replace(kw.k, '_', ''), ' ', '') || '%' THEN
      RETURN 'sensitive_word';
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

-- --------------------------------------------
-- 4. Moderation BEFORE INSERT wrappers
-- --------------------------------------------
-- These call content_moderation_check (now SECURITY DEFINER above),
-- but they themselves also need to run under owner privileges so the
-- inner function is visible via search_path and the RAISE message is
-- produced in the correct context.

CREATE OR REPLACE FUNCTION public.trg_moderate_posts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE result text;
BEGIN
  result := public.content_moderation_check(NEW.content);
  IF result IS NOT NULL THEN
    RAISE EXCEPTION 'moderation_block:%', result;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_moderate_post_comments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE result text;
BEGIN
  result := public.content_moderation_check(NEW.content);
  IF result IS NOT NULL THEN
    RAISE EXCEPTION 'moderation_block:%', result;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_moderate_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE result text;
BEGIN
  result := public.content_moderation_check(NEW.title);
  IF result IS NOT NULL THEN
    RAISE EXCEPTION 'moderation_block:%', result;
  END IF;
  result := public.content_moderation_check(NEW.description);
  IF result IS NOT NULL THEN
    RAISE EXCEPTION 'moderation_block:%', result;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_moderate_messages()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE result text;
BEGIN
  IF NEW.message_type = 'image' THEN
    RETURN NEW;
  END IF;
  result := public.content_moderation_check(NEW.content);
  IF result IS NOT NULL THEN
    RAISE EXCEPTION 'moderation_block:%', result;
  END IF;
  RETURN NEW;
END;
$$;

-- --------------------------------------------
-- 5. Sanity notice
-- --------------------------------------------
DO $$
BEGIN
  RAISE NOTICE '033 complete: 7 trigger/helper functions now run with SECURITY DEFINER. Items / posts / comments / messages should be writable by authenticated users again.';
END $$;
