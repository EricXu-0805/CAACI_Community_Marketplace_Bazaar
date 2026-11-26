-- Read-only preflight for 20261122035253_community_member_events.sql.
-- Run after VERIFY_20261120122054 succeeds and before the new migration.
\set ON_ERROR_STOP on
BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL search_path = pg_catalog, public;
DO $precheck$
DECLARE
  expected record;
  stored text;
BEGIN
  FOR expected IN
    SELECT * FROM (VALUES
    ('private.community_events_member_guard()', 'ec91e9bd0c1be76895d1adba1227af8c'),
    ('public.create_member_event(uuid,text,text,jsonb)', '9a22a3c4dc3326b90a29160466416887')
    ) AS known(signature, body_md5)
  LOOP
    SELECT pg_catalog.md5(routine.prosrc) INTO stored
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid = pg_catalog.to_regprocedure(expected.signature);
    IF stored IS DISTINCT FROM expected.body_md5 THEN
      RAISE EXCEPTION 'community_member_events_precheck_function:%:%', expected.signature, coalesce(stored, 'missing');
    END IF;
  END LOOP;

  IF pg_catalog.has_function_privilege('authenticated', 'public.create_member_event(uuid,text,text,jsonb)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.create_member_event(uuid,text,text,jsonb)', 'EXECUTE')
     OR pg_catalog.has_any_column_privilege('authenticated', 'public.community_events', 'INSERT')
     OR pg_catalog.has_any_column_privilege('authenticated', 'public.community_events', 'UPDATE')
     OR pg_catalog.has_any_column_privilege('anon', 'public.community_events', 'INSERT')
     OR pg_catalog.has_any_column_privilege('anon', 'public.community_events', 'UPDATE') THEN
    RAISE EXCEPTION 'community_member_events_precheck_channel_open';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM public.community_events WHERE source_type = 'member') <> 0 THEN
    RAISE EXCEPTION 'community_member_events_precheck_member_rows';
  END IF;
  IF pg_catalog.to_regclass('private.community_member_event_config') IS NOT NULL THEN
    RAISE EXCEPTION 'community_member_events_precheck_switch_exists';
  END IF;
  IF pg_catalog.to_regprocedure('public.community_member_events_open()') IS NOT NULL THEN
    RAISE EXCEPTION 'community_member_events_precheck_read_function_exists';
  END IF;
  IF (SELECT pg_catalog.pg_get_constraintdef(c.oid) FROM pg_catalog.pg_constraint AS c
       WHERE c.conrelid = 'public.community_events'::pg_catalog.regclass
         AND c.conname = 'community_events_member_shape' AND c.convalidated)
     IS DISTINCT FROM $shape$CHECK (((source_type <> 'member'::text) OR ((organizer_user_id IS NOT NULL) AND (source_key ~ '^[0-9a-f-]{36}$'::text) AND (page_url IS NULL) AND (register_url IS NULL) AND (registration_mode = 'discussion'::text) AND (title IS NULL) AND (title_en IS NULL) AND (occurrence_count = 1) AND (location IS NOT NULL) AND (location = btrim(location)) AND ((char_length(location) >= 1) AND (char_length(location) <= 80)))))$shape$ THEN
    RAISE EXCEPTION 'community_member_events_precheck_member_shape';
  END IF;
END
$precheck$;
ROLLBACK;
