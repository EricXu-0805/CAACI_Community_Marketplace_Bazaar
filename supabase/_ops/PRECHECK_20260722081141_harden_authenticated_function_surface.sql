-- Read-only preflight for
-- 20260722081141_harden_authenticated_function_surface.sql.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '2min';

DO $precheck$
DECLARE
  expected_signatures text[] := ARRAY[
    'public.archive_conversation(uuid,uuid)',
    'public.get_item_sale_candidates(uuid,uuid)',
    'public.get_last_messages(uuid[])',
    'public.get_my_profile()',
    'public.get_transaction_rating_eligibility(uuid,uuid)',
    'public.increment_view_count(uuid)',
    'public.make_offer(uuid,numeric,uuid,text)',
    'public.mark_item_sold(uuid,uuid,uuid)',
    'public.mark_onboarded(text,text,uuid,text)',
    'public.mark_onboarded(text,text,text)',
    'public.propose_meetup(uuid,text,timestamptz,uuid,text)',
    'public.record_consent(text,uuid)',
    'public.record_consent(text)',
    'public.record_fingerprint(text,text)',
    'public.reschedule_accepted_meetup(uuid,text,timestamptz,uuid,text)',
    'public.respond_to_meetup(uuid,text,uuid,text,timestamptz,text)',
    'public.respond_to_offer(uuid,text,uuid,numeric,text)',
    'public.submit_appeal(text,uuid,uuid)',
    'public.submit_appeal(text)',
    'public.submit_transaction_rating(uuid,uuid,integer,text,uuid)',
    'public.verify_illini_email_code(uuid,text)'
  ];
  signature text;
  routine_oid oid;
  dependent_count bigint;
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer < 160000 THEN
    RAISE EXCEPTION 'precheck_failed: PostgreSQL 16 or newer is required';
  END IF;
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION
      'precheck_failed: migration must run as postgres, got %', current_user;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
      AS required(role_name)
    WHERE pg_catalog.to_regrole(required.role_name) IS NULL
  ) THEN
    RAISE EXCEPTION 'precheck_failed: required Supabase API role is missing';
  END IF;

  FOREACH signature IN ARRAY expected_signatures
  LOOP
    IF pg_catalog.to_regprocedure(signature) IS NULL THEN
      RAISE EXCEPTION
        'precheck_failed: authenticated RPC % is missing', signature;
    END IF;
  END LOOP;

  IF EXISTS (
    (SELECT routine.oid
     FROM pg_catalog.pg_proc AS routine
     JOIN pg_catalog.pg_namespace AS namespace
       ON namespace.oid = routine.pronamespace
     WHERE namespace.nspname = 'public'
       AND routine.prosecdef
       AND pg_catalog.has_function_privilege(
         'authenticated', routine.oid, 'EXECUTE'
       ))
    EXCEPT
    (SELECT pg_catalog.to_regprocedure(expected.signature)::oid
     FROM pg_catalog.unnest(expected_signatures) AS expected(signature))
  ) OR EXISTS (
    (SELECT pg_catalog.to_regprocedure(expected.signature)::oid
     FROM pg_catalog.unnest(expected_signatures) AS expected(signature))
    EXCEPT
    (SELECT routine.oid
     FROM pg_catalog.pg_proc AS routine
     JOIN pg_catalog.pg_namespace AS namespace
       ON namespace.oid = routine.pronamespace
     WHERE namespace.nspname = 'public'
       AND routine.prosecdef
       AND pg_catalog.has_function_privilege(
         'authenticated', routine.oid, 'EXECUTE'
       ))
  ) THEN
    RAISE EXCEPTION
      'precheck_failed: authenticated SECURITY DEFINER allowlist drift';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(expected_signatures) AS expected(signature)
    JOIN pg_catalog.pg_proc AS routine
      ON routine.oid = pg_catalog.to_regprocedure(expected.signature)
    WHERE routine.proowner <> pg_catalog.to_regrole('postgres')::oid
       OR routine.prokind <> 'f'
       OR NOT routine.prosecdef
       OR routine.proconfig IS DISTINCT FROM
          ARRAY['search_path=pg_catalog']::text[]
       OR NOT pg_catalog.has_function_privilege(
          'authenticated', routine.oid, 'EXECUTE'
       )
       OR pg_catalog.has_function_privilege('anon', routine.oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege(
          'service_role', routine.oid, 'EXECUTE'
       )
       OR (
         SELECT pg_catalog.count(*)
         FROM pg_catalog.aclexplode(routine.proacl) AS acl
         WHERE acl.privilege_type = 'EXECUTE'
       ) <> 2
       OR NOT EXISTS (
         SELECT 1
         FROM pg_catalog.aclexplode(routine.proacl) AS acl
         WHERE acl.grantee = routine.proowner
           AND acl.grantor = routine.proowner
           AND acl.privilege_type = 'EXECUTE'
           AND NOT acl.is_grantable
       )
       OR NOT EXISTS (
         SELECT 1
         FROM pg_catalog.aclexplode(routine.proacl) AS acl
         WHERE acl.grantee = pg_catalog.to_regrole('authenticated')::oid
           AND acl.grantor = routine.proowner
           AND acl.privilege_type = 'EXECUTE'
           AND NOT acl.is_grantable
       )
  ) THEN
    RAISE EXCEPTION
      'precheck_failed: authenticated SECURITY DEFINER owner/path/ACL drift';
  END IF;

  FOREACH signature IN ARRAY ARRAY[
    'public.mark_onboarded(text,text,text)',
    'public.record_consent(text)',
    'public.submit_appeal(text)'
  ]
  LOOP
    routine_oid := pg_catalog.to_regprocedure(signature);
    SELECT pg_catalog.count(*)
    INTO dependent_count
    FROM pg_catalog.pg_depend AS dependency
    WHERE dependency.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass
      AND dependency.refobjid = routine_oid
      AND dependency.deptype NOT IN ('i', 'e');

    IF dependent_count <> 0 THEN
      RAISE EXCEPTION
        'precheck_failed: legacy RPC % has % database dependents',
        signature,
        dependent_count;
    END IF;
  END LOOP;
END;
$precheck$;

SELECT
  routine.oid::pg_catalog.regprocedure AS function_signature,
  pg_catalog.pg_get_userbyid(routine.proowner) AS function_owner,
  routine.prosecdef AS security_definer,
  routine.proconfig,
  routine.proacl,
  pg_catalog.has_function_privilege(
    'authenticated', routine.oid, 'EXECUTE'
  ) AS authenticated_execute,
  pg_catalog.has_function_privilege('anon', routine.oid, 'EXECUTE')
    AS anon_execute,
  pg_catalog.has_function_privilege('service_role', routine.oid, 'EXECUTE')
    AS service_role_execute
FROM pg_catalog.pg_proc AS routine
JOIN pg_catalog.pg_namespace AS namespace
  ON namespace.oid = routine.pronamespace
WHERE namespace.nspname = 'public'
  AND routine.prosecdef
  AND pg_catalog.has_function_privilege(
    'authenticated', routine.oid, 'EXECUTE'
  )
ORDER BY routine.oid::pg_catalog.regprocedure::text;

SELECT
  pg_catalog.pg_get_userbyid(default_acl.defaclrole) AS owner_role,
  CASE
    WHEN default_acl.defaclnamespace = 0 THEN '<global>'
    ELSE namespace.nspname
  END AS target_schema,
  default_acl.defaclobjtype,
  default_acl.defaclacl
FROM pg_catalog.pg_default_acl AS default_acl
LEFT JOIN pg_catalog.pg_namespace AS namespace
  ON namespace.oid = default_acl.defaclnamespace
WHERE default_acl.defaclrole = pg_catalog.to_regrole('postgres')::oid
  AND default_acl.defaclobjtype = 'f'
ORDER BY target_schema;

ROLLBACK;
