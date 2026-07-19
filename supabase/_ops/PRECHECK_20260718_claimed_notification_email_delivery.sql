-- Read-only preflight for 20260718270000_claimed_notification_email_delivery.sql.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $precheck$
DECLARE
  required_column text;
BEGIN
  IF pg_catalog.to_regclass('public.notifications') IS NULL THEN
    RAISE EXCEPTION 'precheck_failed: public.notifications missing';
  END IF;

  FOREACH required_column IN ARRAY ARRAY[
    'id', 'user_id', 'type', 'created_at', 'emailed_at',
    'conversation_id', 'source_event_key'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid = 'public.notifications'::pg_catalog.regclass
        AND attribute.attname = required_column
        AND NOT attribute.attisdropped
    ) THEN
      RAISE EXCEPTION 'precheck_failed: notifications.% missing', required_column;
    END IF;
  END LOOP;

  IF pg_catalog.to_regprocedure(
       'public.resolve_meetup_email_notification(uuid,text,uuid,uuid)'
     ) IS NULL OR pg_catalog.to_regprocedure(
       'public.seed_digest_reminders(integer,integer,integer)'
     ) IS NULL THEN
    RAISE EXCEPTION 'precheck_failed: 250/260 delivery dependencies missing';
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.claim_notification_email_delivery(uuid[],text,integer)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'precheck_failed: shared delivery claim RPC already exists';
  END IF;

  IF pg_catalog.has_column_privilege(
       'authenticated', 'public.notifications', 'emailed_at', 'UPDATE'
     ) OR pg_catalog.has_column_privilege(
       'authenticated', 'public.notifications', 'source_event_key', 'UPDATE'
     ) THEN
    RAISE EXCEPTION 'precheck_failed: server delivery state is client-mutable';
  END IF;
END
$precheck$;

ROLLBACK;
