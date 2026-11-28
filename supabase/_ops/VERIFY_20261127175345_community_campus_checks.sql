-- Read-only verification of the three campus check functions after the campus checks migration.
-- Run as postgres, then VERIFY_20261125004742 and the two switch VERIFY files.
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
      ('public.claim_campus_event_checks(integer)', 'jsonb', 'limit_in integer',
        'fcbfeb9588d7afb7bb322e69d9d70077', 'v', 'search_path=pg_catalog', 'plpgsql', 'service_role'),
      ('public.apply_campus_event_check(uuid,text,jsonb)', 'jsonb', 'event_id_in uuid, outcome_in text, row_in jsonb',
        '2364941fca7d19f0b17caad53d238671', 'v', 'search_path=pg_catalog', 'plpgsql', 'service_role'),
      ('public.community_campus_event_checked_at(uuid)', 'timestamp with time zone', 'event_id_in uuid',
        '35dfcb4e82b8b5bb0ebb44f27f6f6bb7', 's', 'search_path=pg_catalog|statement_timeout=3s', 'sql', 'anon,authenticated')
    ) AS known(signature, result_type, arguments, body_md5, volatility, settings, language_name, executors)
  LOOP
    IF pg_catalog.to_regprocedure(expected.signature) IS NULL THEN
      RAISE EXCEPTION 'community_campus_checks_function_missing:%', expected.signature;
    END IF;
    IF pg_catalog.pg_get_function_result(pg_catalog.to_regprocedure(expected.signature))
       IS DISTINCT FROM expected.result_type THEN
      RAISE EXCEPTION 'community_campus_checks_function_result:%', expected.signature;
    END IF;
    IF pg_catalog.pg_get_function_arguments(pg_catalog.to_regprocedure(expected.signature))
       IS DISTINCT FROM expected.arguments THEN
      RAISE EXCEPTION 'community_campus_checks_function_arguments:%', expected.signature;
    END IF;
    SELECT pg_catalog.md5(p.prosrc) AS body_md5, p.prosecdef, p.provolatile, p.proisstrict,
           pg_catalog.pg_get_userbyid(p.proowner)::text AS owner,
           coalesce(pg_catalog.array_to_string(p.proconfig, '|'), '') AS settings,
           l.lanname::text AS language_name, p.proparallel, p.procost, p.prokind, p.proacl
      INTO routine
      FROM pg_catalog.pg_proc AS p
      JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
     WHERE p.oid = pg_catalog.to_regprocedure(expected.signature);
    IF routine.body_md5 IS DISTINCT FROM expected.body_md5 THEN
      RAISE EXCEPTION 'community_campus_checks_function_body:%:%', expected.signature, routine.body_md5;
    END IF;
    IF routine.owner IS DISTINCT FROM 'postgres' OR routine.prosecdef IS DISTINCT FROM true
       OR routine.provolatile IS DISTINCT FROM expected.volatility OR routine.proisstrict IS DISTINCT FROM false
       OR routine.settings IS DISTINCT FROM expected.settings
       OR routine.language_name IS DISTINCT FROM expected.language_name
       OR routine.proparallel IS DISTINCT FROM 'u' OR routine.procost IS DISTINCT FROM 100
       OR routine.prokind IS DISTINCT FROM 'f' THEN
      RAISE EXCEPTION 'community_campus_checks_function_attributes:%', expected.signature;
    END IF;
    SELECT pg_catalog.string_agg(grantee_name, ',' ORDER BY grantee_name)
      INTO listed
      FROM (SELECT CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(acl.grantee)::text END AS grantee_name
              FROM pg_catalog.aclexplode(routine.proacl) AS acl
             WHERE acl.privilege_type = 'EXECUTE' AND acl.grantee <> 'postgres'::pg_catalog.regrole) AS executors;
    IF listed IS DISTINCT FROM expected.executors
       OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(routine.proacl) AS acl
                   WHERE acl.privilege_type = 'EXECUTE' AND acl.grantee <> 'postgres'::pg_catalog.regrole
                     AND acl.is_grantable) THEN
      RAISE EXCEPTION 'community_campus_checks_function_grants:%:%', expected.signature, coalesce(listed, 'none');
    END IF;
  END LOOP;
  SELECT count(*) INTO overloads
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('claim_campus_event_checks', 'apply_campus_event_check', 'community_campus_event_checked_at');
  IF overloads <> 3 THEN
    RAISE EXCEPTION 'community_campus_checks_function_overloads:%', overloads;
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_constraint
       WHERE conrelid = pg_catalog.to_regclass('public.community_events')) <> 37
     OR (SELECT count(*) FROM pg_catalog.pg_policy
          WHERE polrelid = pg_catalog.to_regclass('public.community_events')) <> 4
     OR (SELECT count(*) FROM pg_catalog.pg_trigger
          WHERE tgrelid = pg_catalog.to_regclass('public.community_events') AND NOT tgisinternal) <> 5
     OR (SELECT count(*) FROM pg_catalog.pg_constraint
          WHERE conrelid = pg_catalog.to_regclass('public.community_event_sync_state')) <> 4
     OR (SELECT count(*) FROM pg_catalog.pg_policy
          WHERE polrelid = pg_catalog.to_regclass('public.community_event_sync_state')) <> 1 THEN
    RAISE EXCEPTION 'community_campus_checks_table_shape';
  END IF;
  RAISE NOTICE 'community_campus_checks_verified';
END
$verify$;
ROLLBACK;
