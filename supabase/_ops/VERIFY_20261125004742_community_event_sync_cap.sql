-- Read-only verification of the three CAACI sync functions after the cap migration.
-- Run as postgres. Predecessor VERIFY files independently cover older objects.
\set ON_ERROR_STOP on
BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL search_path = pg_catalog;
DO $verify$
DECLARE
  expected record;
  routine record;
  listed text;
  overloads integer;
BEGIN
  FOR expected IN
    SELECT * FROM (VALUES
      ('public.claim_community_event_sync(text,interval)', 'boolean', 'source_in text, interval_in interval', 'a730ca4867b03e5379ee497571c7cae8'),
      ('public.apply_caaci_event_snapshot(boolean,jsonb)', 'jsonb', 'complete_in boolean, rows_in jsonb', '55227c4b42b7ac90e9b1ba34f274b057'),
      ('public.finish_community_event_sync(text,text,text)', 'boolean', 'source_in text, outcome_in text, error_code_in text', '1ea1588cb277079ab5911ba84924f450')
    ) AS known(signature, result_type, arguments, body_md5)
  LOOP
    IF pg_catalog.pg_get_function_result(pg_catalog.to_regprocedure(expected.signature))
       IS DISTINCT FROM expected.result_type THEN
      RAISE EXCEPTION 'community_event_sync_cap_function_result:%', expected.signature;
    END IF;
    IF pg_catalog.pg_get_function_arguments(pg_catalog.to_regprocedure(expected.signature))
       IS DISTINCT FROM expected.arguments THEN
      RAISE EXCEPTION 'community_event_sync_cap_function_arguments:%', expected.signature;
    END IF;
    SELECT pg_catalog.md5(p.prosrc) AS body_md5, p.prosecdef, p.provolatile, p.proisstrict,
           pg_catalog.pg_get_userbyid(p.proowner)::text AS owner, p.proconfig, p.proacl
      INTO routine FROM pg_catalog.pg_proc AS p
     WHERE p.oid = pg_catalog.to_regprocedure(expected.signature);
    IF routine.body_md5 IS DISTINCT FROM expected.body_md5 THEN
      RAISE EXCEPTION 'community_event_sync_cap_function_body:%:%', expected.signature, routine.body_md5;
    END IF;
    IF routine.owner IS DISTINCT FROM 'postgres' OR routine.prosecdef IS DISTINCT FROM true
       OR routine.provolatile IS DISTINCT FROM 'v' OR routine.proisstrict IS DISTINCT FROM false
       OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog'] THEN
      RAISE EXCEPTION 'community_event_sync_cap_function_attributes:%', expected.signature;
    END IF;
    SELECT pg_catalog.string_agg(
      CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(acl.grantee)::text END,
      ',' ORDER BY acl.grantee)
      INTO listed
      FROM pg_catalog.aclexplode(routine.proacl) AS acl
     WHERE acl.privilege_type = 'EXECUTE' AND acl.grantee <> 'postgres'::pg_catalog.regrole;
    IF listed IS DISTINCT FROM 'service_role'
       OR pg_catalog.has_function_privilege('anon', expected.signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', expected.signature, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role', expected.signature, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(routine.proacl) AS acl
                   WHERE acl.grantee <> 'postgres'::pg_catalog.regrole AND acl.is_grantable) THEN
      RAISE EXCEPTION 'community_event_sync_cap_function_grants:%:%', expected.signature, listed;
    END IF;
  END LOOP;
  SELECT count(*) INTO overloads
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('claim_community_event_sync', 'apply_caaci_event_snapshot', 'finish_community_event_sync');
  IF overloads <> 3 THEN
    RAISE EXCEPTION 'community_event_sync_cap_function_overloads:%', overloads;
  END IF;
  RAISE NOTICE 'community_event_sync_cap_verified';
END
$verify$;
ROLLBACK;
