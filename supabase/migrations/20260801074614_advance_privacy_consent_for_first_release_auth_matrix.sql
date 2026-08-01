-- Expand the release-bound consent contract for the first-release auth matrix:
-- H5 email/password + Google, mini-program email/password, with the WeChat
-- identity entry point hidden.
--
-- This is the expand phase of an expand -> deploy -> contract rollout. During
-- the rolling window, the old 2026-07-18 bundle and the new 2026-08-01 bundle
-- may both call record_consent. The function accepts only those two exact
-- versions and never lets the old bundle downgrade or refresh an 08-01
-- acceptance. A later forward migration may narrow the RPC to 08-01 only
-- after the old bundle is no longer served/supported. This migration changes
-- no acceptance row by itself; older accepted versions remain subject to the
-- app's existing re-consent gate.

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
    RAISE EXCEPTION 'privacy_consent_precheck_failed: operator drift';
  END IF;

  IF pg_catalog.to_regclass('public.profiles') IS NULL
     OR pg_catalog.to_regprocedure(
       'public.record_consent(text,uuid)'
     ) IS NULL THEN
    RAISE EXCEPTION 'privacy_consent_precheck_failed: dependency missing';
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
    AND constraint_values = ARRAY['0', '2026-04-20', '2026-07-18']::text[];
  constraint_is_target := constraint_definition LIKE '%tos_version%'
    AND constraint_values = ARRAY[
      '0', '2026-04-20', '2026-07-18', '2026-08-01'
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
    AND consent_function_definition NOT LIKE '%2026-08-01%';
  function_is_target := consent_function_definition LIKE '%2026-07-18%'
    AND consent_function_definition LIKE '%2026-08-01%'
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
         '0', '2026-04-20', '2026-07-18', '2026-08-01'
       )
     ) THEN
    RAISE EXCEPTION 'privacy_consent_precheck_failed: function drift';
  END IF;
END
$precheck$;

ALTER TABLE public.profiles
  DROP CONSTRAINT profiles_tos_version_release_allowlist;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_tos_version_release_allowlist
  CHECK (
    tos_version IN ('0', '2026-04-20', '2026-07-18', '2026-08-01')
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
  'Rolling release-bound consent acceptance for privacy versions 2026-07-18 and 2026-08-01; never downgrades';

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
    RAISE EXCEPTION 'privacy_consent_verify_failed: operator drift';
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
       '0', '2026-04-20', '2026-07-18', '2026-08-01'
     ]::text[]
     OR constraint_definition NOT LIKE '%tos_version%'
     OR consent_function_definition NOT LIKE '%2026-07-18%'
     OR consent_function_definition NOT LIKE '%2026-08-01%'
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
    RAISE EXCEPTION 'privacy_consent_verify_failed';
  END IF;
END
$verify$;

COMMIT;
