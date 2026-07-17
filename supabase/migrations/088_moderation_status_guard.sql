-- 088_moderation_status_guard.sql
--
-- Deep-audit P1: admin_takedown_content (073) removes reported content by
-- writing the SAME status column owners write for normal lifecycle
-- (items -> 'deleted', posts -> 'hidden'). But the owner UPDATE RLS on
-- items/posts checks only ownership (011:27-30 items; 010/011 posts), there is
-- NO column-level UPDATE lockdown (unlike profiles/084 and messages/064), and
-- the moderation triggers (024/033) fire only on title/description/content — a
-- status-only PATCH bypasses all of them. So a user whose scam listing was
-- taken down could PATCH status back to 'active' (shipped anon key + own JWT)
-- and resurface it, silently defeating the single most important per-item
-- moderation action, with no admin re-notification.
--
-- Fix: a SECURITY INVOKER BEFORE UPDATE trigger (same posture as
-- guard_illini_verify_columns in 072 — SECURITY INVOKER means current_user is
-- the REAL caller) that freezes the moderator-removed state against
-- authenticated/anon callers. A row already in the removed state (items
-- 'deleted', posts 'hidden') cannot be transitioned out of it by the client.
--
-- Why this is false-positive-free on real user flows:
--   · items  — updateItemStatus (useItems.ts) is only ever called with
--               active/reserved/sold; users hard-DELETE via deleteItem
--               (a real row DELETE), never soft-delete. So status='deleted' is
--               reached only by admin takedown, and a client never legitimately
--               transitions a row OUT of 'deleted'.
--   · posts  — users hard-DELETE via deletePost (a real row DELETE); 'hidden'
--               is set exclusively by admin takedown. No client sets or leaves
--               'hidden'.
-- admin_takedown_content is SECURITY DEFINER (runs as the function owner, not
-- authenticated/anon) and any future service-role restore path runs as
-- service_role, so both bypass the guard and legitimate takedown/restore still
-- work. Normal edits (title/price on an 'active' row) never hit the guard —
-- the OLD state isn't the removed one.

CREATE OR REPLACE FUNCTION public.guard_moderation_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_TABLE_NAME = 'items'
       AND OLD.status = 'deleted'
       AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'removed content is moderator-managed and cannot be restored by the client';
    ELSIF TG_TABLE_NAME = 'posts'
       AND OLD.status = 'hidden'
       AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'removed content is moderator-managed and cannot be restored by the client';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_moderation_status ON public.items;
CREATE TRIGGER guard_moderation_status
  BEFORE UPDATE ON public.items
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_moderation_status();

DROP TRIGGER IF EXISTS guard_moderation_status ON public.posts;
CREATE TRIGGER guard_moderation_status
  BEFORE UPDATE ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_moderation_status();

-- ---------------------------------------------------------------------------
-- Verification (run as an authenticated user, NOT service_role):
--   -- take down your own item via the admin RPC path (service_role), then:
--   UPDATE items SET status='active' WHERE id='<taken-down id>';  -- EXCEPTION
--   UPDATE items SET title='x'       WHERE id='<active id>';      -- OK (active row)
--   UPDATE posts SET status='active' WHERE id='<hidden id>';      -- EXCEPTION
-- As service_role (admin restore) the same UPDATE succeeds.
-- ---------------------------------------------------------------------------
