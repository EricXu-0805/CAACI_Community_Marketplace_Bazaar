-- 080_dashboard_oldest_pending.sql
--
-- gaps-8 from the 2026-06-29 admin review: the KPIs were raw counts with no
-- aging signal, so a report could sit pending for days without standing out.
-- Add the age (in whole hours) of the OLDEST pending report to the dashboard
-- stats — a simple SLA gauge ("nothing has been waiting more than N hours").
--
-- Adding a column to the RETURNS TABLE changes the OUT row type, which
-- CREATE OR REPLACE can't do, so DROP first (only the edge fn calls it, via
-- PostgREST — no SQL dependency) and re-assert the service_role-only grant.

DROP FUNCTION IF EXISTS public.admin_dashboard_stats();

CREATE FUNCTION public.admin_dashboard_stats()
RETURNS TABLE (
  active_suspensions   integer,
  pending_reports      integer,
  pending_appeals      integer,
  shadow_banned        integer,
  oldest_pending_hours integer
) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    (SELECT COUNT(*) FROM public.suspensions
       WHERE lifted_at IS NULL
         AND (ends_at IS NULL OR ends_at > now())
         AND level >= 2)::integer,
    (SELECT COUNT(*) FROM public.reports   WHERE status = 'pending')::integer,
    (SELECT COUNT(*) FROM public.suspensions
       WHERE appeal_note IS NOT NULL AND lifted_at IS NULL)::integer,
    (SELECT COUNT(*) FROM public.profiles  WHERE shadow_banned = true)::integer,
    -- NULL when there are no pending reports (UI shows "—").
    (SELECT floor(EXTRACT(EPOCH FROM (now() - MIN(created_at))) / 3600)::integer
       FROM public.reports WHERE status = 'pending');
$$;

REVOKE ALL ON FUNCTION public.admin_dashboard_stats() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_dashboard_stats() TO service_role;
