-- Teach record_consent the 2026-09-03 bundle, which the Community Guidelines
-- rewrite (contact details allowed for arranging a trade; soliciting
-- off-platform services and schemes still prohibited) makes the effective
-- consent version.
--
-- This is the expand phase of an expand -> deploy -> contract rollout, and it
-- must reach production BEFORE the frontend carrying GUIDELINES_VERSION =
-- '2026-09-03' merges. Without it every signed-in account is routed to the
-- re-consent screen and every acceptance raises invalid_version (22023), which
-- is exactly the 2026-08-06 outage. 2026-07-18 and 2026-08-01 stay accepted so
-- the currently served bundle keeps working during the rolling window; a later
-- forward migration may narrow the RPC once the old bundles are gone. This
-- migration changes no acceptance row by itself.
--
-- The function body below is the production definition read back with
-- pg_get_functiondef on 2026-09-03, with one CASE arm added and nothing else
-- touched.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog;

DO $precheck$
DECLARE
  constraint_definition text;
  constraint_values text[];
  consent_function_definition text;
  consent_function_owner text;
  consent_function_security_definer boolean;
  consent_function_config text[];
  constraint_is_old boolean;
  constraint_is_target boolean;
  function_is_old boolean;
  function_is_target boolean;
BEGIN
  IF current_user <> 'postgres' OR session_user <> 'postgres' THEN
    RAISE EXCEPTION 'consent_version_precheck_failed: operator drift';
  END IF;

  IF pg_catalog.to_regclass('public.profiles') IS NULL
     OR pg_catalog.to_regprocedure(
       'public.record_consent(text,uuid)'
     ) IS NULL THEN
    RAISE EXCEPTION 'consent_version_precheck_failed: dependency missing';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
    INTO STRICT constraint_definition
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.profiles'::pg_catalog.regclass
    AND constraint_row.conname = 'profiles_tos_version_release_allowlist'
    AND constraint_row.contype = 'c'
    AND constraint_row.convalidated;

  SELECT pg_catalog.array_agg(captured_value[1] ORDER BY captured_value[1])
    INTO constraint_values
  FROM pg_catalog.regexp_matches(
    constraint_definition,
    $allowed_value$'([^']+)'$allowed_value$,
    'g'
  ) AS captured_value;

  constraint_is_old := constraint_definition LIKE '%tos_version%'
    AND constraint_values = ARRAY[
      '0', '2026-04-20', '2026-07-18', '2026-08-01'
    ]::text[];
  constraint_is_target := constraint_definition LIKE '%tos_version%'
    AND constraint_values = ARRAY[
      '0', '2026-04-20', '2026-07-18', '2026-08-01', '2026-09-03'
    ]::text[];

  SELECT pg_catalog.pg_get_functiondef(
           'public.record_consent(text,uuid)'::pg_catalog.regprocedure
         ),
         owner_role.rolname,
         procedure.prosecdef,
         procedure.proconfig
    INTO STRICT
      consent_function_definition,
      consent_function_owner,
      consent_function_security_definer,
      consent_function_config
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_roles AS owner_role
    ON owner_role.oid = procedure.proowner
  WHERE procedure.oid =
        'public.record_consent(text,uuid)'::pg_catalog.regprocedure;

  function_is_old := consent_function_definition LIKE '%2026-07-18%'
    AND consent_function_definition LIKE '%2026-08-01%'
    AND consent_function_definition NOT LIKE '%2026-09-03%';
  function_is_target := consent_function_definition LIKE '%2026-07-18%'
    AND consent_function_definition LIKE '%2026-08-01%'
    AND consent_function_definition LIKE '%2026-09-03%'
    AND consent_function_definition LIKE '%target_version%'
    AND consent_function_definition LIKE '%tos_version < target_version%';

  IF NOT COALESCE(
       (constraint_is_old AND function_is_old)
       OR (constraint_is_target AND function_is_target),
       false
     )
     OR consent_function_owner <> 'postgres'
     OR NOT consent_function_security_definer
     OR consent_function_config IS DISTINCT FROM
        ARRAY['search_path=pg_catalog']::text[]
     OR NOT pg_catalog.has_function_privilege(
       'authenticated',
       'public.record_consent(text,uuid)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon',
       'public.record_consent(text,uuid)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role',
       'public.record_consent(text,uuid)',
       'EXECUTE'
     )
     OR (
       SELECT pg_catalog.count(*)
       FROM pg_catalog.pg_proc AS procedure
       CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
       WHERE procedure.oid =
             'public.record_consent(text,uuid)'::pg_catalog.regprocedure
         AND acl.privilege_type = 'EXECUTE'
     ) <> 2
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc AS procedure
       CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
       WHERE procedure.oid =
             'public.record_consent(text,uuid)'::pg_catalog.regprocedure
         AND acl.grantee = procedure.proowner
         AND acl.grantor = procedure.proowner
         AND acl.privilege_type = 'EXECUTE'
         AND NOT acl.is_grantable
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc AS procedure
       CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
       WHERE procedure.oid =
             'public.record_consent(text,uuid)'::pg_catalog.regprocedure
         AND acl.grantee = pg_catalog.to_regrole('authenticated')::oid
         AND acl.grantor = procedure.proowner
         AND acl.privilege_type = 'EXECUTE'
         AND NOT acl.is_grantable
     )
     OR EXISTS (
       SELECT 1
       FROM public.profiles
       WHERE tos_version NOT IN (
         '0', '2026-04-20', '2026-07-18', '2026-08-01', '2026-09-03'
       )
     ) THEN
    RAISE EXCEPTION 'consent_version_precheck_failed: function drift';
  END IF;
END
$precheck$;

ALTER TABLE public.profiles
  DROP CONSTRAINT profiles_tos_version_release_allowlist;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_tos_version_release_allowlist
  CHECK (
    tos_version IN (
      '0', '2026-04-20', '2026-07-18', '2026-08-01', '2026-09-03'
    )
  ) NOT VALID;

ALTER TABLE public.profiles
  VALIDATE CONSTRAINT profiles_tos_version_release_allowlist;

CREATE OR REPLACE FUNCTION public.record_consent(
  version_in text,
  expected_user_id_in uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  target_version text;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF expected_user_id_in IS NULL OR expected_user_id_in <> caller_id THEN
    RAISE EXCEPTION 'account_changed' USING ERRCODE = '42501';
  END IF;
  CASE version_in
    WHEN '2026-07-18' THEN target_version := '2026-07-18';
    WHEN '2026-08-01' THEN target_version := '2026-08-01';
    WHEN '2026-09-03' THEN target_version := '2026-09-03';
    ELSE
      RAISE EXCEPTION 'invalid_version' USING ERRCODE = '22023';
  END CASE;

  UPDATE public.profiles
  SET tos_version = target_version,
      consented_at = pg_catalog.statement_timestamp()
  WHERE id = expected_user_id_in
    AND (
      tos_version IS NULL
      OR tos_version = '0'
      OR tos_version < target_version
    );

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = expected_user_id_in
  ) THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION public.record_consent(text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_consent(text, uuid)
  TO authenticated;

COMMENT ON FUNCTION public.record_consent(text, uuid) IS
  'Rolling release-bound consent acceptance for bundle versions 2026-07-18, 2026-08-01 and 2026-09-03; never downgrades';

DO $verify$
DECLARE
  constraint_definition text;
  constraint_values text[];
  consent_function_definition text;
  consent_function_owner text;
  consent_function_security_definer boolean;
  consent_function_config text[];
BEGIN
  IF current_user <> 'postgres' OR session_user <> 'postgres' THEN
    RAISE EXCEPTION 'consent_version_verify_failed: operator drift';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
    INTO STRICT constraint_definition
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.profiles'::pg_catalog.regclass
    AND constraint_row.conname = 'profiles_tos_version_release_allowlist'
    AND constraint_row.contype = 'c'
    AND constraint_row.convalidated;

  SELECT pg_catalog.array_agg(captured_value[1] ORDER BY captured_value[1])
    INTO constraint_values
  FROM pg_catalog.regexp_matches(
    constraint_definition,
    $allowed_value$'([^']+)'$allowed_value$,
    'g'
  ) AS captured_value;

  SELECT pg_catalog.pg_get_functiondef(
           'public.record_consent(text,uuid)'::pg_catalog.regprocedure
         ),
         owner_role.rolname,
         procedure.prosecdef,
         procedure.proconfig
    INTO STRICT
      consent_function_definition,
      consent_function_owner,
      consent_function_security_definer,
      consent_function_config
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_roles AS owner_role
    ON owner_role.oid = procedure.proowner
  WHERE procedure.oid =
        'public.record_consent(text,uuid)'::pg_catalog.regprocedure;

  IF constraint_values IS DISTINCT FROM ARRAY[
       '0', '2026-04-20', '2026-07-18', '2026-08-01', '2026-09-03'
     ]::text[]
     OR constraint_definition NOT LIKE '%tos_version%'
     OR consent_function_definition NOT LIKE '%2026-07-18%'
     OR consent_function_definition NOT LIKE '%2026-08-01%'
     OR consent_function_definition NOT LIKE '%2026-09-03%'
     OR consent_function_definition NOT LIKE '%tos_version < target_version%'
     OR consent_function_owner <> 'postgres'
     OR NOT consent_function_security_definer
     OR consent_function_config IS DISTINCT FROM
        ARRAY['search_path=pg_catalog']::text[]
     OR NOT pg_catalog.has_function_privilege(
       'authenticated',
       'public.record_consent(text,uuid)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon',
       'public.record_consent(text,uuid)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role',
       'public.record_consent(text,uuid)',
       'EXECUTE'
     )
     OR (
       SELECT pg_catalog.count(*)
       FROM pg_catalog.pg_proc AS procedure
       CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
       WHERE procedure.oid =
             'public.record_consent(text,uuid)'::pg_catalog.regprocedure
         AND acl.privilege_type = 'EXECUTE'
     ) <> 2
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc AS procedure
       CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
       WHERE procedure.oid =
             'public.record_consent(text,uuid)'::pg_catalog.regprocedure
         AND acl.grantee = procedure.proowner
         AND acl.grantor = procedure.proowner
         AND acl.privilege_type = 'EXECUTE'
         AND NOT acl.is_grantable
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc AS procedure
       CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
       WHERE procedure.oid =
             'public.record_consent(text,uuid)'::pg_catalog.regprocedure
         AND acl.grantee = pg_catalog.to_regrole('authenticated')::oid
         AND acl.grantor = procedure.proowner
         AND acl.privilege_type = 'EXECUTE'
         AND NOT acl.is_grantable
     ) THEN
    RAISE EXCEPTION 'consent_version_verify_failed';
  END IF;
END
$verify$;

COMMIT;
