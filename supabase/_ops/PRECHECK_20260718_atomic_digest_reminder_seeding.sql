-- Read-only preflight for 20260718260000_atomic_digest_reminder_seeding.sql.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $precheck$
DECLARE
  required_relation text;
  required_column record;
  notification_type_definition text;
BEGIN
  FOREACH required_relation IN ARRAY ARRAY[
    'public.meetups',
    'public.messages',
    'public.conversations',
    'public.blocks',
    'public.notifications'
  ] LOOP
    IF pg_catalog.to_regclass(required_relation) IS NULL THEN
      RAISE EXCEPTION 'precheck_failed: missing relation %', required_relation;
    END IF;
  END LOOP;

  FOR required_column IN
    SELECT spec.table_name, spec.column_name
    FROM (VALUES
      ('meetups', 'reminded_at'),
      ('messages', 'reminded_at'),
      ('messages', 'is_read'),
      ('conversations', 'is_muted_buyer'),
      ('conversations', 'is_muted_seller'),
      ('notifications', 'conversation_id'),
      ('notifications', 'emailed_at'),
      ('notifications', 'source_event_key')
    ) AS spec(table_name, column_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid = pg_catalog.to_regclass(
              'public.' || required_column.table_name
            )
        AND attribute.attname = required_column.column_name
        AND NOT attribute.attisdropped
    ) THEN
      RAISE EXCEPTION 'precheck_failed: missing public.%.%',
        required_column.table_name, required_column.column_name;
    END IF;
  END LOOP;

  IF pg_catalog.to_regclass(
       'public.notifications_source_event_key_uidx'
     ) IS NULL OR pg_catalog.to_regprocedure(
       'public.resolve_meetup_email_notification(uuid,text,uuid,uuid)'
     ) IS NULL THEN
    RAISE EXCEPTION 'precheck_failed: durable meetup event dependency missing';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(type_constraint.oid)
    INTO notification_type_definition
  FROM pg_catalog.pg_constraint AS type_constraint
  WHERE type_constraint.conrelid = 'public.notifications'::pg_catalog.regclass
    AND type_constraint.conname = 'notifications_type_check'
    AND type_constraint.contype = 'c'
    AND type_constraint.convalidated;
  IF notification_type_definition IS NULL
     OR pg_catalog.strpos(notification_type_definition, '''meetup''') = 0
     OR pg_catalog.strpos(notification_type_definition, '''unread_message''') = 0 THEN
    RAISE EXCEPTION 'precheck_failed: reminder notification vocabulary drifted';
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.seed_digest_reminders(integer,integer,integer)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'precheck_failed: atomic reminder seed RPC already exists';
  END IF;

  IF pg_catalog.has_column_privilege(
       'authenticated', 'public.meetups', 'reminded_at', 'UPDATE'
     ) OR pg_catalog.has_column_privilege(
       'authenticated', 'public.messages', 'reminded_at', 'UPDATE'
     ) OR pg_catalog.has_column_privilege(
       'authenticated', 'public.notifications', 'source_event_key', 'UPDATE'
     ) THEN
    RAISE EXCEPTION 'precheck_failed: server-owned reminder state is client-mutable';
  END IF;
END
$precheck$;

ROLLBACK;
