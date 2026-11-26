-- Read-only preflight. Run as postgres after VERIFY_20261122035253.
\set ON_ERROR_STOP on
BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL search_path = pg_catalog;
DO $precheck$
DECLARE
  signature text;
  relation text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.claim_community_event_sync(text,interval)',
    'public.apply_caaci_event_snapshot(boolean,jsonb)',
    'public.finish_community_event_sync(text,text,text)'
  ] LOOP
    IF pg_catalog.to_regprocedure(signature) IS NOT NULL THEN
      RAISE EXCEPTION 'community_event_sync_precheck_function_exists:%', signature;
    END IF;
  END LOOP;
  FOREACH relation IN ARRAY ARRAY['public.community_events', 'public.community_event_sync_state'] LOOP
    IF pg_catalog.to_regclass(relation) IS NULL THEN
      RAISE EXCEPTION 'community_event_sync_precheck_table_missing:%', relation;
    END IF;
    IF pg_catalog.has_any_column_privilege('service_role', relation, 'INSERT')
       OR pg_catalog.has_any_column_privilege('service_role', relation, 'UPDATE') THEN
      RAISE EXCEPTION 'community_event_sync_precheck_direct_write:%', relation;
    END IF;
  END LOOP;
  IF (SELECT pg_catalog.md5(prosrc) FROM pg_catalog.pg_proc
       WHERE oid = pg_catalog.to_regprocedure('private.community_events_schedule_change()'))
       IS DISTINCT FROM 'e4a2e33f688e3f6d4e192a3426b0ea36'
     OR (SELECT pg_catalog.md5(prosrc) FROM pg_catalog.pg_proc
       WHERE oid = pg_catalog.to_regprocedure('private.community_events_moderate_text()'))
       IS DISTINCT FROM 'c3da68f508cbcee6724a6926892300ed'
     OR pg_catalog.to_regclass('private.community_member_event_config') IS NULL THEN
    RAISE EXCEPTION 'community_event_sync_precheck_predecessor';
  END IF;
END
$precheck$;
ROLLBACK;
