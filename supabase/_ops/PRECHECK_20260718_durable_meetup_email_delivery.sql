-- Read-only preflight for 20260718250000_durable_meetup_email_delivery.sql.
-- Run before staging/production migration with psql -X -v ON_ERROR_STOP=1.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $precheck$
DECLARE
  required_relation text;
  required_function text;
  function_source text;
BEGIN
  FOREACH required_relation IN ARRAY ARRAY[
    'public.profiles',
    'public.items',
    'public.conversations',
    'public.meetups',
    'public.notifications'
  ] LOOP
    IF pg_catalog.to_regclass(required_relation) IS NULL THEN
      RAISE EXCEPTION 'precheck_failed: missing relation %', required_relation;
    END IF;
  END LOOP;

  IF pg_catalog.to_regnamespace('private') IS NULL THEN
    RAISE EXCEPTION 'precheck_failed: private schema missing';
  END IF;

  FOREACH required_function IN ARRAY ARRAY[
    'auth.uid()',
    'private.current_user_can_access_conversation(uuid)',
    'public.propose_meetup(uuid,text,timestamp with time zone,uuid,text)',
    'public.respond_to_meetup(uuid,text,uuid,text,timestamp with time zone,text)',
    'public.reschedule_accepted_meetup(uuid,text,timestamp with time zone,uuid,text)'
  ] LOOP
    IF pg_catalog.to_regprocedure(required_function) IS NULL THEN
      RAISE EXCEPTION 'precheck_failed: missing function %', required_function;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.notifications'::pg_catalog.regclass
      AND attribute.attname = 'emailed_at'
      AND NOT attribute.attisdropped
      AND attribute.atttypid = 'timestamp with time zone'::pg_catalog.regtype
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.notifications'::pg_catalog.regclass
      AND attribute.attname = 'conversation_id'
      AND NOT attribute.attisdropped
      AND attribute.atttypid = 'uuid'::pg_catalog.regtype
  ) THEN
    RAISE EXCEPTION
      'precheck_failed: notifications emailed_at/conversation_id dependency missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.notifications'::pg_catalog.regclass
      AND attribute.attname = 'source_event_key'
      AND NOT attribute.attisdropped
  ) OR pg_catalog.to_regclass(
    'public.notifications_source_event_key_uidx'
  ) IS NOT NULL OR pg_catalog.to_regprocedure(
    'private.enqueue_meetup_event_notification(uuid,text,uuid,text,text,uuid,uuid)'
  ) IS NOT NULL OR pg_catalog.to_regprocedure(
    'public.resolve_meetup_email_notification(uuid,text,uuid,uuid)'
  ) IS NOT NULL OR pg_catalog.to_regprocedure(
    'public.mark_meetup_email_notification_emailed(uuid,text)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION
      'precheck_failed: durable meetup delivery objects already/partially exist';
  END IF;

  FOREACH required_function IN ARRAY ARRAY[
    'public.propose_meetup(uuid,text,timestamp with time zone,uuid,text)',
    'public.respond_to_meetup(uuid,text,uuid,text,timestamp with time zone,text)',
    'public.reschedule_accepted_meetup(uuid,text,timestamp with time zone,uuid,text)'
  ] LOOP
    SELECT pg_catalog.pg_get_functiondef(
      pg_catalog.to_regprocedure(required_function)
    ) INTO function_source;
    IF pg_catalog.strpos(function_source, 'expected_user_id_in') = 0
       OR pg_catalog.strpos(
         function_source, 'private.current_user_can_access_conversation'
       ) = 0
       OR pg_catalog.strpos(function_source, 'item_unavailable_for_meetup') = 0
       OR pg_catalog.strpos(function_source, 'pg_advisory_xact_lock') = 0 THEN
      RAISE EXCEPTION
        'precheck_failed: current meetup state-machine guard drifted: %',
        required_function;
    END IF;
  END LOOP;

  IF pg_catalog.has_table_privilege(
       'authenticated', 'public.notifications', 'INSERT'
     ) OR pg_catalog.has_table_privilege(
       'authenticated', 'public.notifications', 'UPDATE'
     ) OR pg_catalog.has_any_column_privilege(
       'authenticated', 'public.notifications', 'INSERT'
     ) THEN
    RAISE EXCEPTION
      'precheck_failed: client can mutate server-owned notification identity';
  END IF;
END
$precheck$;

ROLLBACK;
