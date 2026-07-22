-- 20260717143200_fix_moderation_status_enum_guard.sql
--
-- Production E2E found that every owner PATCH on public.items failed with:
--   invalid input value for enum item_status: "hidden"
--
-- Migration 088 compared OLD.status with both the items-only value `deleted`
-- and the posts-only value `hidden` in one IF / ELSIF chain. PostgreSQL can
-- type-check/evaluate the second enum comparison even while an items trigger is
-- running, so casting `hidden` to item_status aborts the whole update.
--
-- Branch on TG_TABLE_NAME first and compare the enum as text. This preserves
-- the original moderation invariant while keeping the two enum domains apart.

CREATE OR REPLACE FUNCTION public.guard_moderation_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'items' THEN
    IF OLD.status::text = 'deleted'
       AND NEW.status::text IS DISTINCT FROM OLD.status::text THEN
      RAISE EXCEPTION 'removed content is moderator-managed and cannot be restored by the client';
    END IF;
  ELSIF TG_TABLE_NAME = 'posts' THEN
    IF OLD.status::text = 'hidden'
       AND NEW.status::text IS DISTINCT FROM OLD.status::text THEN
      RAISE EXCEPTION 'removed content is moderator-managed and cannot be restored by the client';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_moderation_status()
  FROM PUBLIC, anon, authenticated, service_role;

-- Migration 089 replaced the normalize body after migration 050 had pinned
-- its search_path, which reset that function property.  The function uses
-- built-ins only, so pg_catalog is the narrow, stable runtime path.
ALTER FUNCTION public.content_moderation_normalize(text)
  SET search_path = pg_catalog;
