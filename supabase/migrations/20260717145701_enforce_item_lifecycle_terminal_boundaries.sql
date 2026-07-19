-- 20260717145701_enforce_item_lifecycle_terminal_boundaries.sql
--
-- Keep item lifecycle state changes monotonic for direct client writes:
--   active <-> reserved
--   active/reserved -> sold
--   sold and moderator-managed deleted are terminal
--
-- A sold listing can own ratings through an ON DELETE CASCADE foreign key.
-- Letting its owner hard-delete that row would therefore erase transaction
-- history. Terminal rows must also be immutable: otherwise a stale/deep edit
-- link can still rewrite the title, images, or other listing evidence without
-- changing status. Direct authenticated/anon UPDATE or DELETE is rejected.
-- Service/admin/SECURITY DEFINER maintenance paths retain their existing
-- bypass because their PostgreSQL current_user is not a client role.

CREATE OR REPLACE FUNCTION public.guard_item_lifecycle_boundaries()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
DECLARE
  old_status text := OLD.status::text;
  new_status text;
BEGIN
  -- Supabase service roles, migration owners, and SECURITY DEFINER admin/account
  -- functions must remain able to moderate, restore, and cascade-delete rows.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF old_status IN ('sold', 'deleted') THEN
      RAISE EXCEPTION 'terminal_item_delete_forbidden:%', old_status
        USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    new_status := NEW.status::text;

    -- Terminal means the complete row is client-immutable, not merely that its
    -- status cannot transition. Privileged maintenance paths returned above.
    IF old_status IN ('sold', 'deleted') THEN
      RAISE EXCEPTION 'terminal_item_update_forbidden:%', old_status
        USING ERRCODE = '55000';
    END IF;

    -- Active/reserved content edits preserve their status and remain legal.
    IF new_status IS NOT DISTINCT FROM old_status THEN
      RETURN NEW;
    END IF;

    IF (old_status = 'active' AND new_status IN ('reserved', 'sold'))
       OR (old_status = 'reserved' AND new_status IN ('active', 'sold')) THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'invalid_item_status_transition:%->%', old_status, new_status
      USING ERRCODE = '55000';
  END IF;

  RAISE EXCEPTION 'unsupported_item_lifecycle_operation:%', TG_OP
    USING ERRCODE = '0A000';
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_item_lifecycle_boundaries()
  FROM PUBLIC, anon, authenticated;

-- PostgreSQL runs same-kind triggers alphabetically. Keep this name after the
-- existing guard_moderation_status trigger so its established deleted-item
-- error remains the first one clients receive when attempting a restore.
DROP TRIGGER IF EXISTS item_lifecycle_guard_update ON public.items;
CREATE TRIGGER item_lifecycle_guard_update
  BEFORE UPDATE ON public.items
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_item_lifecycle_boundaries();

DROP TRIGGER IF EXISTS item_lifecycle_guard_delete ON public.items;
CREATE TRIGGER item_lifecycle_guard_delete
  BEFORE DELETE ON public.items
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_item_lifecycle_boundaries();
