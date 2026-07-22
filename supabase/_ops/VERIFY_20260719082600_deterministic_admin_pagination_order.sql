-- Read-only post-deploy verification for deterministic admin pagination.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $verify$
DECLARE
  expected record;
  function_oid oid;
  normalized_definition text;
  service_role_oid oid;
  anon_role_oid oid;
  authenticated_role_oid oid;
  public_execute boolean;
  anon_execute boolean;
  authenticated_execute boolean;
  service_execute boolean;
BEGIN
  SELECT oid INTO service_role_oid
  FROM pg_catalog.pg_roles
  WHERE rolname = 'service_role';
  SELECT oid INTO anon_role_oid
  FROM pg_catalog.pg_roles
  WHERE rolname = 'anon';
  SELECT oid INTO authenticated_role_oid
  FROM pg_catalog.pg_roles
  WHERE rolname = 'authenticated';

  IF service_role_oid IS NULL OR anon_role_oid IS NULL
     OR authenticated_role_oid IS NULL THEN
    RAISE EXCEPTION 'verify_failed: expected Supabase roles are missing';
  END IF;

  FOR expected IN
    SELECT *
    FROM (VALUES
      (
        'public.admin_list_reports_grouped(integer,integer,boolean)',
        'array_agg(r.id order by r.created_at desc, r.id desc)',
        'order by g.pending_count desc, g.first_created_at asc, g.target_type asc, g.target_id asc'
      ),
      (
        'public.admin_list_suspensions(integer,integer,boolean)',
        'order by suspension.created_at desc, suspension.id desc',
        NULL
      ),
      (
        'public.admin_list_appeals(integer,integer)',
        'order by suspension.created_at desc, suspension.id desc',
        NULL
      ),
      (
        'public.admin_list_audit_log(integer,integer,text)',
        'order by l.created_at desc, l.id desc',
        NULL
      ),
      (
        'public.admin_list_plaza_posts(integer,integer)',
        'order by p.is_pinned desc, p.created_at desc, p.id desc',
        NULL
      )
    ) AS function_target(signature, required_fragment, second_required_fragment)
  LOOP
    function_oid := pg_catalog.to_regprocedure(expected.signature);
    IF function_oid IS NULL THEN
      RAISE EXCEPTION 'verify_failed: required function missing: %',
        expected.signature;
    END IF;

    SELECT pg_catalog.regexp_replace(
             pg_catalog.lower(pg_catalog.pg_get_functiondef(function_oid)),
             '[[:space:]]+',
             ' ',
             'g'
           )
      INTO normalized_definition;

    IF pg_catalog.strpos(normalized_definition, expected.required_fragment) = 0
       OR (
         expected.second_required_fragment IS NOT NULL
         AND pg_catalog.strpos(
               normalized_definition,
               expected.second_required_fragment
             ) = 0
       ) THEN
      RAISE EXCEPTION 'verify_failed: deterministic order missing: %',
        expected.signature;
    END IF;

    SELECT
      pg_catalog.bool_or(
        expanded_acl.grantee = 0
        AND expanded_acl.privilege_type = 'EXECUTE'
      ),
      pg_catalog.bool_or(
        expanded_acl.grantee = anon_role_oid
        AND expanded_acl.privilege_type = 'EXECUTE'
      ),
      pg_catalog.bool_or(
        expanded_acl.grantee = authenticated_role_oid
        AND expanded_acl.privilege_type = 'EXECUTE'
      ),
      pg_catalog.bool_or(
        expanded_acl.grantee = service_role_oid
        AND expanded_acl.privilege_type = 'EXECUTE'
      )
      INTO public_execute, anon_execute, authenticated_execute, service_execute
    FROM pg_catalog.pg_proc AS procedure
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )
    ) AS expanded_acl
    WHERE procedure.oid = function_oid;

    IF COALESCE(public_execute, false)
       OR COALESCE(anon_execute, false)
       OR COALESCE(authenticated_execute, false)
       OR NOT COALESCE(service_execute, false) THEN
      RAISE EXCEPTION 'verify_failed: function ACL drifted: %',
        expected.signature;
    END IF;
  END LOOP;
END
$verify$;

SELECT
  procedure.oid::pg_catalog.regprocedure AS function_name,
  pg_catalog.pg_get_userbyid(procedure.proowner) AS owner,
  procedure.prosecdef AS security_definer,
  procedure.proacl
FROM pg_catalog.pg_proc AS procedure
WHERE procedure.oid IN (
  'public.admin_list_reports_grouped(integer,integer,boolean)'::pg_catalog.regprocedure,
  'public.admin_list_suspensions(integer,integer,boolean)'::pg_catalog.regprocedure,
  'public.admin_list_appeals(integer,integer)'::pg_catalog.regprocedure,
  'public.admin_list_audit_log(integer,integer,text)'::pg_catalog.regprocedure,
  'public.admin_list_plaza_posts(integer,integer)'::pg_catalog.regprocedure
)
ORDER BY procedure.oid::pg_catalog.regprocedure::text;

ROLLBACK;
