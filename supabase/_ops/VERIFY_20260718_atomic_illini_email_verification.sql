-- Read-only structural verification for
-- 20260717194842_atomic_illini_email_verification.sql.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $verify$
DECLARE
  rpc_oid oid;
  rpc_source text;
  rpc_status text;
BEGIN
  SELECT function.oid, function.prosrc
  INTO rpc_oid, rpc_source
  FROM pg_catalog.pg_proc AS function
  WHERE function.oid = pg_catalog.to_regprocedure(
    'public.verify_illini_email_code(uuid,text)'
  );

  IF rpc_oid IS NULL THEN
    RAISE EXCEPTION 'verify_failed: missing verify_illini_email_code(uuid,text)';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_proc AS function
    WHERE function.pronamespace = 'public'::pg_catalog.regnamespace
      AND function.proname = 'verify_illini_email_code'
  ) <> 1 THEN
    RAISE EXCEPTION 'verify_failed: unexpected verification RPC overload';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid = rpc_oid
      AND function.prosecdef
      AND function.provolatile = 'v'
      AND function.prorettype = 'text'::pg_catalog.regtype
      AND COALESCE(function.proconfig, ARRAY[]::text[])
        @> ARRAY['search_path=pg_catalog']::text[]
  ) THEN
    RAISE EXCEPTION
      'verify_failed: verification RPC security/search_path/return contract';
  END IF;

  IF pg_catalog.has_function_privilege('anon', rpc_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege(
       'authenticated', rpc_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege('service_role', rpc_oid, 'EXECUTE')
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.aclexplode(
         COALESCE(
           (
             SELECT function.proacl
             FROM pg_catalog.pg_proc AS function
             WHERE function.oid = rpc_oid
           ),
           pg_catalog.acldefault(
             'f',
             (
               SELECT function.proowner
               FROM pg_catalog.pg_proc AS function
               WHERE function.oid = rpc_oid
             )
           )
         )
       ) AS acl
       WHERE acl.grantee = 0
         AND acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'verify_failed: verification RPC execute grants';
  END IF;

  -- These clauses are the static concurrency and account-binding contract.
  IF pg_catalog.strpos(pg_catalog.lower(rpc_source), 'caller_id uuid := auth.uid()') = 0
     OR pg_catalog.strpos(
       pg_catalog.lower(rpc_source),
       'expected_user_id_in <> caller_id'
     ) = 0
     OR pg_catalog.lower(rpc_source) !~
       'from[[:space:]]+public[.]illini_verifications[[:space:]]+as[[:space:]]+verification[[:space:][:print:]]*for update'
     OR pg_catalog.strpos(
       pg_catalog.lower(rpc_source),
       'set attempts = verification.attempts + 1'
     ) = 0
     OR pg_catalog.strpos(
       pg_catalog.lower(rpc_source),
       'update public.profiles as profile'
     ) = 0
     OR pg_catalog.strpos(
       pg_catalog.lower(rpc_source),
       'delete from public.illini_verifications as verification'
     ) = 0 THEN
    RAISE EXCEPTION
      'verify_failed: verification RPC caller/lock/atomic-write contract';
  END IF;

  FOREACH rpc_status IN ARRAY ARRAY[
    'no_pending',
    'expired',
    'profile_not_found',
    'already_verified',
    'too_many_attempts',
    'bad_code',
    'invalid_email',
    'email_taken',
    'verified'
  ] LOOP
    IF pg_catalog.strpos(
      pg_catalog.lower(rpc_source),
      'return ''' || rpc_status || ''''
    ) = 0 THEN
      RAISE EXCEPTION
        'verify_failed: verification RPC missing status %', rpc_status;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS index_relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = index_relation.relnamespace
    JOIN pg_catalog.pg_index AS index_definition
      ON index_definition.indexrelid = index_relation.oid
    JOIN pg_catalog.pg_am AS access_method
      ON access_method.oid = index_relation.relam
    WHERE namespace.nspname = 'public'
      AND index_relation.relname = 'uq_profiles_verified_illini_email'
      AND index_relation.relkind = 'i'
      AND index_definition.indrelid =
        'public.profiles'::pg_catalog.regclass
      AND index_definition.indisunique
      AND index_definition.indisvalid
      AND index_definition.indisready
      AND index_definition.indnkeyatts = 1
      AND index_definition.indnatts = 1
      AND index_definition.indkey::text = '0'
      AND access_method.amname = 'btree'
      AND pg_catalog.pg_get_expr(
        index_definition.indexprs,
        index_definition.indrelid
      ) = 'lower(verified_illini_email)'
      AND pg_catalog.pg_get_expr(
        index_definition.indpred,
        index_definition.indrelid
      ) = '(verified_illini_email IS NOT NULL)'
  ) THEN
    RAISE EXCEPTION 'verify_failed: campus-email unique index contract';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    JOIN pg_catalog.pg_attrdef AS default_value
      ON default_value.adrelid = attribute.attrelid
      AND default_value.adnum = attribute.attnum
    WHERE attribute.attrelid =
      'public.illini_verifications'::pg_catalog.regclass
      AND attribute.attname = 'attempts'
      AND attribute.atttypid = 'integer'::pg_catalog.regtype
      AND attribute.attnotnull
      AND pg_catalog.pg_get_expr(
        default_value.adbin,
        default_value.adrelid
      ) = '0'
  ) THEN
    RAISE EXCEPTION 'verify_failed: pending attempt counter contract';
  END IF;
END
$verify$;

SELECT
  function.oid::regprocedure AS function_signature,
  function.prosecdef AS is_security_definer,
  function.proconfig,
  pg_catalog.has_function_privilege(
    'anon', function.oid, 'EXECUTE'
  ) AS anon_execute,
  pg_catalog.has_function_privilege(
    'authenticated', function.oid, 'EXECUTE'
  ) AS authenticated_execute,
  pg_catalog.has_function_privilege(
    'service_role', function.oid, 'EXECUTE'
  ) AS service_role_execute,
  pg_catalog.pg_get_functiondef(function.oid) AS definition
FROM pg_catalog.pg_proc AS function
WHERE function.oid = pg_catalog.to_regprocedure(
  'public.verify_illini_email_code(uuid,text)'
);

SELECT
  index_relation.relname AS index_name,
  index_definition.indisunique,
  index_definition.indisvalid,
  pg_catalog.pg_get_indexdef(index_relation.oid) AS definition
FROM pg_catalog.pg_class AS index_relation
JOIN pg_catalog.pg_index AS index_definition
  ON index_definition.indexrelid = index_relation.oid
WHERE index_relation.oid =
  'public.uq_profiles_verified_illini_email'::pg_catalog.regclass;

ROLLBACK;
