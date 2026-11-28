-- Read-only preflight. Run as postgres after VERIFY_20261125004742 and before the campus checks migration.
\set ON_ERROR_STOP on
BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL search_path = pg_catalog;
DO $precheck$
DECLARE
  expected record;
  stored text;
  relation text;
BEGIN
  FOR expected IN
    SELECT * FROM (VALUES
    ('public.claim_community_event_sync(text,interval)', 'a730ca4867b03e5379ee497571c7cae8'),
    ('public.apply_caaci_event_snapshot(boolean,jsonb)', '55227c4b42b7ac90e9b1ba34f274b057'),
    ('public.finish_community_event_sync(text,text,text)', '1ea1588cb277079ab5911ba84924f450'),
    ('private.community_events_schedule_change()', 'e4a2e33f688e3f6d4e192a3426b0ea36'),
    ('private.community_events_member_guard()', '7eb7680e59995c1dc8e9d754603ed790'),
    ('private.community_events_moderate_text()', 'c3da68f508cbcee6724a6926892300ed'),
    ('public.update_updated_at()', 'da5ac28a58c8b4bb30209bf0d3d7082c')
  ) AS known(signature, body_md5)
  LOOP
    SELECT pg_catalog.md5(routine.prosrc) INTO stored
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid = pg_catalog.to_regprocedure(expected.signature);
    IF stored IS DISTINCT FROM expected.body_md5 THEN
      RAISE EXCEPTION 'community_campus_checks_precheck_function:%:%', expected.signature, coalesce(stored, 'missing');
    END IF;
  END LOOP;
  FOR expected IN
    SELECT * FROM (VALUES
    ('public.community_events', 'community_events_campus_shape', $d$CHECK (((source_type <> 'campus'::text) OR ((source_key ~ '^[0-9]{1,6}/[0-9]{1,12}$'::text) AND (page_url = ('https://calendars.illinois.edu/detail/'::text || source_key)) AND (register_url IS NULL) AND (registration_mode = 'calendar_page'::text) AND (organizer_name IS NOT NULL) AND (COALESCE(title_en, ''::text) <> ''::text) AND (partner_id IS NULL) AND (organizer_user_id IS NULL))))$d$),
    ('public.community_events', 'community_events_unavailable_check', $d$CHECK (((availability <> 'unavailable'::text) OR (missing_checks >= 2)))$d$),
    ('public.community_event_sync_state', 'community_event_sync_state_source_check', $d$CHECK ((source = ANY (ARRAY['caaci'::text, 'campus'::text])))$d$)
  ) AS known(relation, constraint_name, definition)
  LOOP
    SELECT pg_catalog.regexp_replace(pg_catalog.pg_get_constraintdef(c.oid), '\s+', ' ', 'g') INTO stored
      FROM pg_catalog.pg_constraint AS c
     WHERE c.conrelid = pg_catalog.to_regclass(expected.relation) AND c.conname = expected.constraint_name;
    IF stored IS DISTINCT FROM expected.definition THEN
      RAISE EXCEPTION 'community_campus_checks_precheck_constraint:%', expected.constraint_name;
    END IF;
  END LOOP;
  IF pg_catalog.to_regprocedure('public.claim_campus_event_checks(integer)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.apply_campus_event_check(uuid,text,jsonb)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.community_campus_event_checked_at(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'community_campus_checks_precheck_already_applied';
  END IF;
  FOREACH relation IN ARRAY ARRAY['public.community_events', 'public.community_event_sync_state'] LOOP
    IF pg_catalog.to_regclass(relation) IS NULL THEN
      RAISE EXCEPTION 'community_campus_checks_precheck_table_missing:%', relation;
    END IF;
    IF pg_catalog.has_any_column_privilege('service_role', relation, 'INSERT')
       OR pg_catalog.has_any_column_privilege('service_role', relation, 'UPDATE') THEN
      RAISE EXCEPTION 'community_campus_checks_precheck_direct_write:%', relation;
    END IF;
  END LOOP;
END
$precheck$;
ROLLBACK;
