-- 076_notify_on_suspension_change.sql
--
-- gaps-5 from the 2026-06-29 admin review: bans/lifts were silent. A user got
-- suspended (or un-suspended) with no in-app explanation and no nudge toward the
-- appeal flow.
--
-- Rather than CREATE OR REPLACE the ~80-line apply_ban_level / lift_suspension
-- bodies (and risk a transcription error), this hangs an AFTER trigger on the
-- suspensions table — it has the full row context (profile_id, level, reason,
-- lifted_at) and fires atomically with the ban/lift, covering every path that
-- writes a suspension, not just today's two RPCs.
--
-- Reuses type='system' (no notifications_type_check change). The client renders
-- title + body literally and only localizes the type label, so the title is
-- bilingual-inline, matching the offer/meetup convention ('新报价 · New offer').
-- The insert cannot realistically fail (profile_id FK was just written by the
-- same ban, type is valid, strings are non-null), so the atomic coupling with
-- the ban transaction is safe.

CREATE OR REPLACE FUNCTION public.notify_suspension_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Level 0 is a no-op/clear; only notify on an actual warning or suspension.
    IF NEW.level >= 1 THEN
      INSERT INTO public.notifications (user_id, type, title, body)
      VALUES (
        NEW.profile_id,
        'system',
        CASE WHEN NEW.level = 1
             THEN '收到一次警告 · You received a warning'
             ELSE '账号已被限制 · Your account was restricted'
        END,
        COALESCE(NEW.reason, '')
      );
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Fire only on the lift transition (lifted_at goes NULL -> set), not on
    -- any other update to the row.
    IF OLD.lifted_at IS NULL AND NEW.lifted_at IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body)
      VALUES (
        NEW.profile_id,
        'system',
        '账号限制已解除 · Your restriction was lifted',
        ''
      );
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

-- Trigger functions are invoked by the trigger machinery, never called
-- directly; mirror 057's hardening and drop the default PUBLIC execute grant.
REVOKE ALL ON FUNCTION public.notify_suspension_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_suspension_change ON public.suspensions;
CREATE TRIGGER trg_notify_suspension_change
  AFTER INSERT OR UPDATE ON public.suspensions
  FOR EACH ROW EXECUTE FUNCTION public.notify_suspension_change();
