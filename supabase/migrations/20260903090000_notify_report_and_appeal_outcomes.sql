-- ============================================
-- 20260903090000 — The reporter and the appellant are told what happened
-- ============================================
-- Measured against production on 2026-09-03:
--   · admin_update_report_status (20260718180000) and
--     admin_resolve_target_reports (074) only UPDATE reports.status and call
--     record_audit. Nothing on public.reports notifies anyone, so a student
--     who reports a listing hears nothing back, ever — not when it is acted
--     on, not when it is dismissed.
--   · admin_execute_appeal_decision (20260720035037) records the decision in
--     admin_audit_log. An ACCEPTED appeal lifts the suspension, and
--     notify_suspension_change turns that UPDATE into a notification. A
--     DENIED appeal changes no row a trigger watches, so the person who
--     appealed is left waiting for an answer that never arrives.
--
-- WHY TRIGGERS AND NOT THE RPCs
-- -----------------------------
-- Both report writers are already-deployed SECURITY DEFINER bodies (the
-- appeal one is ~250 lines with its own idempotency journal and audit
-- assertion). Re-issuing them to add an INSERT means copying that whole body
-- forward and hoping it still matches production. A trigger on the row
-- transition covers both report RPCs and any future writer, and needs no
-- claim about a function body it does not contain.
--
-- The copy is a sentinel key, not a sentence. Every earlier writer stores one
-- bilingual literal ('报价被接受 · Offer accepted'), which is why a Chinese
-- reader also reads the English half; the reader's language is not knowable
-- where a trigger fires. app/src/api/notifications.ts resolves both a sentinel
-- and a legacy literal to one i18n key, so these rows say one thing in one
-- language. No admin text rides along: the moderation reason stays internal.

CREATE OR REPLACE FUNCTION public.notify_report_outcome()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NEW.reporter_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Keyed on the report alone, not on the status it landed in: a report that
  -- is resolved, reopened and dismissed announces its outcome once.
  INSERT INTO public.notifications (
    user_id, type, title, body, source_event_key
  ) VALUES (
    NEW.reporter_id,
    'system',
    CASE WHEN NEW.status = 'resolved'
      THEN 'report_resolved'
      ELSE 'report_dismissed'
    END,
    CASE WHEN NEW.status = 'resolved'
      THEN 'report_outcome_resolved'
      ELSE 'report_outcome_dismissed'
    END,
    pg_catalog.format('report-outcome:%s', NEW.id::text)
  )
  ON CONFLICT (source_event_key) WHERE source_event_key IS NOT NULL
    DO NOTHING;
  RETURN NULL;
END
$function$;

REVOKE ALL ON FUNCTION public.notify_report_outcome()
  FROM PUBLIC, anon, authenticated, service_role;

-- 'reviewed' is a triage state, not an answer, so it stays silent.
DROP TRIGGER IF EXISTS trg_notify_report_outcome ON public.reports;
CREATE TRIGGER trg_notify_report_outcome
  AFTER UPDATE OF status ON public.reports
  FOR EACH ROW
  WHEN (
    OLD.status IS DISTINCT FROM NEW.status
    AND NEW.status IN ('resolved', 'dismissed')
  )
  EXECUTE FUNCTION public.notify_report_outcome();

-- The audit row is the only artefact a denied appeal produces. It carries the
-- suspension in target_id and the decision in details, and record_audit writes
-- it inside the same transaction as the decision, so the notification is as
-- atomic as the accepted branch's lift already is.
CREATE OR REPLACE FUNCTION public.notify_appeal_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  appellant_id uuid;
BEGIN
  -- An accepted appeal lifts the suspension, and notify_suspension_change
  -- already speaks for that transition. Only the denial is unannounced.
  IF NEW.target_id IS NULL
     OR (NEW.details ->> 'decision') IS DISTINCT FROM 'denied' THEN
    RETURN NULL;
  END IF;

  SELECT suspension.profile_id
    INTO appellant_id
    FROM public.suspensions AS suspension
   WHERE suspension.id = NEW.target_id;

  IF appellant_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.notifications (
    user_id, type, title, body, source_event_key
  ) VALUES (
    appellant_id,
    'system',
    'appeal_denied',
    'appeal_outcome_denied',
    pg_catalog.format('appeal-decision:%s', NEW.target_id::text)
  )
  ON CONFLICT (source_event_key) WHERE source_event_key IS NOT NULL
    DO NOTHING;
  RETURN NULL;
END
$function$;

REVOKE ALL ON FUNCTION public.notify_appeal_decision()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_notify_appeal_decision ON public.admin_audit_log;
CREATE TRIGGER trg_notify_appeal_decision
  AFTER INSERT ON public.admin_audit_log
  FOR EACH ROW
  WHEN (NEW.event_kind = 'appeal_decided')
  EXECUTE FUNCTION public.notify_appeal_decision();

NOTIFY pgrst, 'reload schema';
