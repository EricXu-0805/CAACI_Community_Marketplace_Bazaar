-- Structural/ACL verification for exact, durable meetup-email attribution.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $verify$
DECLARE
  function_signature text;
  function_source text;
  function_config text[];
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.notifications'::pg_catalog.regclass
      AND attribute.attname = 'source_event_key'
      AND NOT attribute.attisdropped
      AND attribute.atttypid = 'text'::pg_catalog.regtype
  ) THEN
    RAISE EXCEPTION 'verify_failed: notifications.source_event_key missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS index_entry
    JOIN pg_catalog.pg_class AS index_relation
      ON index_relation.oid = index_entry.indexrelid
    WHERE index_relation.oid = pg_catalog.to_regclass(
            'public.notifications_source_event_key_uidx'
          )
      AND index_entry.indrelid = 'public.notifications'::pg_catalog.regclass
      AND index_entry.indisunique
      AND index_entry.indisvalid
      AND pg_catalog.pg_get_expr(
            index_entry.indpred, index_entry.indrelid
          ) = '(source_event_key IS NOT NULL)'
  ) THEN
    RAISE EXCEPTION 'verify_failed: valid partial unique event-key index missing';
  END IF;

  FOREACH function_signature IN ARRAY ARRAY[
    'private.enqueue_meetup_event_notification(uuid,text,uuid,text,text,uuid,uuid)',
    'public.resolve_meetup_email_notification(uuid,text,uuid,uuid)',
    'public.mark_meetup_email_notification_emailed(uuid,text)'
  ] LOOP
    IF pg_catalog.to_regprocedure(function_signature) IS NULL THEN
      RAISE EXCEPTION 'verify_failed: function missing: %', function_signature;
    END IF;
    SELECT routine.proconfig
      INTO function_config
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = pg_catalog.to_regprocedure(function_signature);
    IF function_config IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN
      RAISE EXCEPTION 'verify_failed: unsafe search_path: %', function_signature;
    END IF;
  END LOOP;

  IF pg_catalog.has_function_privilege(
       'anon',
       'private.enqueue_meetup_event_notification(uuid,text,uuid,text,text,uuid,uuid)',
       'EXECUTE'
     ) OR pg_catalog.has_function_privilege(
       'authenticated',
       'private.enqueue_meetup_event_notification(uuid,text,uuid,text,text,uuid,uuid)',
       'EXECUTE'
     ) OR pg_catalog.has_function_privilege(
       'service_role',
       'private.enqueue_meetup_event_notification(uuid,text,uuid,text,text,uuid,uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'verify_failed: private event writer exposed to an API role';
  END IF;

  FOREACH function_signature IN ARRAY ARRAY[
    'public.resolve_meetup_email_notification(uuid,text,uuid,uuid)',
    'public.mark_meetup_email_notification_emailed(uuid,text)'
  ] LOOP
    IF pg_catalog.has_function_privilege('anon', function_signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege(
         'authenticated', function_signature, 'EXECUTE'
       ) OR NOT pg_catalog.has_function_privilege(
         'service_role', function_signature, 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'verify_failed: service-only ACL drifted: %', function_signature;
    END IF;
  END LOOP;

  FOREACH function_signature IN ARRAY ARRAY[
    'public.propose_meetup(uuid,text,timestamp with time zone,uuid,text)',
    'public.respond_to_meetup(uuid,text,uuid,text,timestamp with time zone,text)',
    'public.reschedule_accepted_meetup(uuid,text,timestamp with time zone,uuid,text)'
  ] LOOP
    IF pg_catalog.has_function_privilege('anon', function_signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', function_signature, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege(
         'authenticated', function_signature, 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'verify_failed: client meetup RPC ACL drifted: %', function_signature;
    END IF;
    SELECT pg_catalog.pg_get_functiondef(
      pg_catalog.to_regprocedure(function_signature)
    ) INTO function_source;
    IF pg_catalog.strpos(function_source, 'expected_user_id_in') = 0
       OR pg_catalog.strpos(
         function_source, 'private.current_user_can_access_conversation'
       ) = 0
       OR pg_catalog.strpos(function_source, 'item_unavailable_for_meetup') = 0
       OR pg_catalog.strpos(function_source, 'pg_advisory_xact_lock') = 0
       OR pg_catalog.strpos(
         function_source, 'private.enqueue_meetup_event_notification'
       ) = 0 THEN
      RAISE EXCEPTION 'verify_failed: meetup state/event guard drifted: %', function_signature;
    END IF;
  END LOOP;

  SELECT pg_catalog.pg_get_functiondef(
    'private.enqueue_meetup_event_notification(uuid,text,uuid,text,text,uuid,uuid)'::pg_catalog.regprocedure
  ) INTO function_source;
  IF pg_catalog.strpos(function_source, 'meetup_notification_event_mismatch') = 0
     OR pg_catalog.strpos(function_source, 'meetup_notification_recipient_mismatch') = 0
     OR pg_catalog.strpos(function_source, 'source_event_key') = 0
     OR pg_catalog.strpos(function_source, 'RETURNING id INTO notification_id') = 0 THEN
    RAISE EXCEPTION 'verify_failed: exact event writer integrity drifted';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.mark_meetup_email_notification_emailed(uuid,text)'::pg_catalog.regprocedure
  ) INTO function_source;
  IF pg_catalog.strpos(function_source, 'notification.id = notification_id_in') = 0
     OR pg_catalog.strpos(
       function_source, 'notification.source_event_key = source_event_key_in'
     ) = 0
     OR pg_catalog.strpos(function_source, 'notification.emailed_at IS NULL') = 0 THEN
    RAISE EXCEPTION 'verify_failed: exact acknowledgement CAS drifted';
  END IF;

  IF pg_catalog.has_table_privilege(
       'authenticated', 'public.notifications', 'INSERT'
     ) OR pg_catalog.has_table_privilege(
       'authenticated', 'public.notifications', 'UPDATE'
     ) OR pg_catalog.has_any_column_privilege(
       'authenticated', 'public.notifications', 'INSERT'
     ) OR pg_catalog.has_column_privilege(
       'authenticated', 'public.notifications', 'source_event_key', 'UPDATE'
     ) THEN
    RAISE EXCEPTION 'verify_failed: event identity is client-mutable';
  END IF;
END
$verify$;

ROLLBACK;
