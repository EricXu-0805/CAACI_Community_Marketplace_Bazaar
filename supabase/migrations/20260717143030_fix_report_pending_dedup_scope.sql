-- 20260717143030_fix_report_pending_dedup_scope.sql
--
-- Migration 011 added a table-level UNIQUE constraint across
-- (reporter_id, target_type, target_id). Migration 074 later introduced the
-- intended pending-only partial unique index, but did not remove the older
-- constraint. As a result, a resolved or dismissed report still prevented the
-- same reporter from filing a new report about a later incident on that target.
--
-- Keep only the pending-state invariant. Dropping the constraint also drops its
-- constraint-owned backing index. The explicit DROP INDEX handles an interrupted
-- or manually-repaired deployment where an orphan index with the old name remains.

ALTER TABLE public.reports
  DROP CONSTRAINT IF EXISTS reports_unique_reporter_target;

DROP INDEX IF EXISTS public.reports_unique_reporter_target;

CREATE UNIQUE INDEX IF NOT EXISTS uq_reports_pending_per_reporter_target
  ON public.reports (reporter_id, target_type, target_id)
  WHERE status = 'pending';
