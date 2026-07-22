-- Read-only verification for
-- 20260722081141_harden_authenticated_function_surface.sql.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '2min';

DO $verify$
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
    'public.propose_meetup(uuid,text,timestamptz,uuid,text)',
    'public.record_consent(text,uuid)',
    'public.record_fingerprint(text,text)',
    'public.reschedule_accepted_meetup(uuid,text,timestamptz,uuid,text)',
    'public.respond_to_meetup(uuid,text,uuid,text,timestamptz,text)',
    'public.respond_to_offer(uuid,text,uuid,numeric,text)',
    'public.submit_appeal(text,uuid,uuid)',
    'public.submit_transaction_rating(uuid,uuid,integer,text,uuid)',
    'public.verify_illini_email_code(uuid,text)'
  ];
  signature text;
BEGIN
  FOREACH signature IN ARRAY expected_signatures
  LOOP
    IF pg_catalog.to_regprocedure(signature) IS NULL THEN
      RAISE EXCEPTION
        'verify_failed: intentional authenticated RPC % is missing', signature;
    END IF;
  END LOOP;

  IF pg_catalog.to_regprocedure(
       'public.mark_onboarded(text,text,text)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.record_consent(text)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.submit_appeal(text)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'verify_failed: stale authenticated RPC overload remains';
  END IF;

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
      'verify_failed: intentional authenticated SECURITY DEFINER allowlist drift';
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
      'verify_failed: intentional RPC owner/path/ACL contract drift';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_default_acl AS default_acl
    WHERE default_acl.defaclrole = pg_catalog.to_regrole('postgres')::oid
      AND default_acl.defaclnamespace = 0
      AND default_acl.defaclobjtype = 'f'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(default_acl.defaclacl) AS acl
        WHERE acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
      )
  ) THEN
    RAISE EXCEPTION
      'verify_failed: global postgres function default still grants PUBLIC';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_default_acl AS default_acl
    CROSS JOIN LATERAL pg_catalog.aclexplode(default_acl.defaclacl) AS acl
    WHERE default_acl.defaclrole = pg_catalog.to_regrole('postgres')::oid
      AND default_acl.defaclobjtype = 'f'
      AND default_acl.defaclnamespace IN (
        0,
        pg_catalog.to_regnamespace('public')::oid
      )
      AND acl.privilege_type = 'EXECUTE'
      AND (
        acl.grantee = 0
        OR acl.grantee IN (
          pg_catalog.to_regrole('anon')::oid,
          pg_catalog.to_regrole('authenticated')::oid,
          pg_catalog.to_regrole('service_role')::oid
        )
      )
  ) THEN
    RAISE EXCEPTION
      'verify_failed: postgres function defaults expose an API role';
  END IF;
END;
$verify$;

SELECT
  routine.oid::pg_catalog.regprocedure AS function_signature,
  pg_catalog.pg_get_userbyid(routine.proowner) AS function_owner,
  routine.proconfig,
  routine.proacl
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
  CASE
    WHEN default_acl.defaclnamespace = 0 THEN '<global>'
    ELSE namespace.nspname
  END AS target_schema,
  default_acl.defaclobjtype,
  acl.grantee::pg_catalog.regrole AS grantee,
  acl.privilege_type,
  acl.is_grantable
FROM pg_catalog.pg_default_acl AS default_acl
LEFT JOIN pg_catalog.pg_namespace AS namespace
  ON namespace.oid = default_acl.defaclnamespace
CROSS JOIN LATERAL pg_catalog.aclexplode(default_acl.defaclacl) AS acl
WHERE default_acl.defaclrole = pg_catalog.to_regrole('postgres')::oid
  AND default_acl.defaclobjtype = 'f'
ORDER BY target_schema, acl.grantee;

ROLLBACK;
