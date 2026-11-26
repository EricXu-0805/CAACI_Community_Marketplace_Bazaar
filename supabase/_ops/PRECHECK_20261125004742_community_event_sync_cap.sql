-- Read-only preflight. Run as postgres after VERIFY_A and before the cap migration.
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
      ('public.apply_caaci_event_snapshot(boolean,jsonb)', 'a7cb04d8c754da448cd570ca6768964f'),
      ('public.finish_community_event_sync(text,text,text)', '1ea1588cb277079ab5911ba84924f450')
    ) AS known(signature, body_md5)
  LOOP
    SELECT pg_catalog.md5(prosrc) INTO stored
      FROM pg_catalog.pg_proc
     WHERE oid = pg_catalog.to_regprocedure(expected.signature);
    IF stored IS DISTINCT FROM expected.body_md5 THEN
      RAISE EXCEPTION 'community_event_sync_cap_precheck_function:%:%',
        expected.signature, coalesce(stored, 'missing');
    END IF;
  END LOOP;

  SELECT pg_catalog.format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text
         || ':' || coalesce(pg_catalog.pg_get_expr(d.adbin, d.adrelid), '')
    INTO stored
    FROM pg_catalog.pg_attribute AS a
    LEFT JOIN pg_catalog.pg_attrdef AS d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = pg_catalog.to_regclass('public.community_events')
     AND a.attname = 'missing_checks' AND NOT a.attisdropped;
  IF stored IS DISTINCT FROM 'smallint:true:0' THEN
    RAISE EXCEPTION 'community_event_sync_cap_precheck_column';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(oid) INTO stored
    FROM pg_catalog.pg_constraint
   WHERE conrelid = pg_catalog.to_regclass('public.community_events')
     AND conname = 'community_events_unavailable_check';
  IF stored IS DISTINCT FROM 'CHECK (((availability <> ''unavailable''::text) OR (missing_checks >= 2)))' THEN
    RAISE EXCEPTION 'community_event_sync_cap_precheck_reader:community_events_unavailable_check';
  END IF;
  SELECT pg_catalog.md5(prosrc) INTO stored
    FROM pg_catalog.pg_proc
   WHERE oid = pg_catalog.to_regprocedure('public.admin_execute_community_events(text,uuid,text,text,jsonb)');
  IF stored IS DISTINCT FROM 'f3095aaa03fcc202ae3b5e99e1eede08' THEN
    RAISE EXCEPTION 'community_event_sync_cap_precheck_reader:public.admin_execute_community_events(text,uuid,text,text,jsonb)';
  END IF;

  FOREACH relation IN ARRAY ARRAY['public.community_events', 'public.community_event_sync_state'] LOOP
    IF pg_catalog.has_any_column_privilege('service_role', relation, 'INSERT')
       OR pg_catalog.has_any_column_privilege('service_role', relation, 'UPDATE') THEN
      RAISE EXCEPTION 'community_event_sync_cap_precheck_direct_write:%', relation;
    END IF;
  END LOOP;
END
$precheck$;
ROLLBACK;
