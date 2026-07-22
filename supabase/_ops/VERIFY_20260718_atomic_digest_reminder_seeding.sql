-- Structural/ACL verification for atomic digest reminder seeding.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $verify$
DECLARE
  function_signature text :=
    'public.seed_digest_reminders(integer,integer,integer)';
  function_source text;
  function_config text[];
  table_name text;
  insert_trigger_definition text;
  update_trigger_definition text;
BEGIN
  IF pg_catalog.to_regprocedure(function_signature) IS NULL THEN
    RAISE EXCEPTION 'verify_failed: seed_digest_reminders missing';
  END IF;

  SELECT routine.proconfig, pg_catalog.pg_get_functiondef(routine.oid)
    INTO function_config, function_source
  FROM pg_catalog.pg_proc AS routine
  WHERE routine.oid = pg_catalog.to_regprocedure(function_signature)
    AND routine.prosecdef;
  IF function_source IS NULL
     OR function_config IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN
    RAISE EXCEPTION 'verify_failed: SECURITY DEFINER/search_path drifted';
  END IF;

  IF pg_catalog.has_function_privilege('anon', function_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
       'authenticated', function_signature, 'EXECUTE'
     ) OR NOT pg_catalog.has_function_privilege(
       'service_role', function_signature, 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'verify_failed: service-only seed RPC ACL drifted';
  END IF;

  IF pg_catalog.strpos(function_source, 'FOR UPDATE OF meetup SKIP LOCKED') = 0
     OR pg_catalog.strpos(function_source, 'FOR UPDATE OF message SKIP LOCKED') = 0
     OR pg_catalog.strpos(function_source, 'ON CONFLICT (source_event_key)') = 0
     OR pg_catalog.strpos(function_source, 'public.blocks') = 0
     OR pg_catalog.strpos(function_source, 'is_muted_buyer') = 0
     OR pg_catalog.strpos(function_source, 'is_muted_seller') = 0
     OR pg_catalog.strpos(function_source, 'message.reminded_at IS NULL') = 0
     OR pg_catalog.strpos(function_source, 'meetup.reminded_at IS NULL') = 0
     OR pg_catalog.strpos(function_source, 'SET reminded_at = now_value') = 0 THEN
    RAISE EXCEPTION 'verify_failed: atomic lock/filter/idempotency source drifted';
  END IF;

  IF pg_catalog.has_column_privilege(
       'authenticated', 'public.meetups', 'reminded_at', 'UPDATE'
     ) OR pg_catalog.has_column_privilege(
       'authenticated', 'public.messages', 'reminded_at', 'UPDATE'
     ) OR pg_catalog.has_column_privilege(
       'authenticated', 'public.notifications', 'source_event_key', 'UPDATE'
     ) THEN
    RAISE EXCEPTION 'verify_failed: reminder identity/state is client-mutable';
  END IF;

  FOREACH table_name IN ARRAY ARRAY['messages', 'meetups'] LOOP
    SELECT pg_catalog.pg_get_triggerdef(trigger_entry.oid)
      INTO insert_trigger_definition
    FROM pg_catalog.pg_trigger AS trigger_entry
    WHERE trigger_entry.tgrelid = pg_catalog.to_regclass('public.' || table_name)
      AND trigger_entry.tgname = 'trg_chat_block_boundary'
      AND NOT trigger_entry.tgisinternal;
    SELECT pg_catalog.pg_get_triggerdef(trigger_entry.oid)
      INTO update_trigger_definition
    FROM pg_catalog.pg_trigger AS trigger_entry
    WHERE trigger_entry.tgrelid = pg_catalog.to_regclass('public.' || table_name)
      AND trigger_entry.tgname = 'trg_chat_block_boundary_update'
      AND NOT trigger_entry.tgisinternal;

    IF insert_trigger_definition IS NULL
       OR pg_catalog.strpos(insert_trigger_definition, 'BEFORE INSERT') = 0
       OR pg_catalog.strpos(insert_trigger_definition, ' OR UPDATE') > 0
       OR update_trigger_definition IS NULL
       OR pg_catalog.strpos(update_trigger_definition, 'BEFORE UPDATE') = 0
       OR pg_catalog.strpos(update_trigger_definition, 'to_jsonb(new.*)') = 0
       OR pg_catalog.strpos(
         update_trigger_definition, '- ''reminded_at''::text'
       ) = 0
       OR pg_catalog.strpos(
         update_trigger_definition, 'enforce_chat_block_boundary'
       ) = 0 THEN
      RAISE EXCEPTION
        'verify_failed: reminder-only chat trigger boundary drifted: %', table_name;
    END IF;
  END LOOP;
END
$verify$;

ROLLBACK;
