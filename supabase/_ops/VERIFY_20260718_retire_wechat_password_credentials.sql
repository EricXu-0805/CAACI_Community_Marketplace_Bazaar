-- Read-only post-deploy verification. Never select the password column.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $verify$
DECLARE
  map_table regclass := pg_catalog.to_regclass('public.wechat_password_map');
  lookup_rpc regprocedure := pg_catalog.to_regprocedure('public.wechat_password_lookup(text)');
  store_rpc regprocedure := pg_catalog.to_regprocedure('public.wechat_password_store(text,text)');
  delete_rpc regprocedure := pg_catalog.to_regprocedure('public.delete_wechat_password_credential(text)');
  role_name text;
  forbidden_privilege text;
BEGIN
  IF map_table IS NULL OR lookup_rpc IS NULL OR store_rpc IS NULL
     OR delete_rpc IS NULL THEN
    RAISE EXCEPTION 'verify_failed: retired WeChat credential objects missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.wechat_password_map LIMIT 1) THEN
    RAISE EXCEPTION 'verify_failed: retired credential map is not empty';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = map_table
      AND relation.relrowsecurity
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS policy
    WHERE policy.polrelid = map_table
  ) THEN
    RAISE EXCEPTION 'verify_failed: retired credential map is not deny-all RLS';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
    ) AS relation_acl
    WHERE relation.oid = map_table
      AND relation_acl.grantee = 0
  ) THEN
    RAISE EXCEPTION 'verify_failed: PUBLIC retains a table privilege';
  END IF;

  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated']::text[] LOOP
    FOREACH forbidden_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']::text[] LOOP
      IF pg_catalog.has_table_privilege(role_name, map_table, forbidden_privilege) THEN
        RAISE EXCEPTION 'verify_failed: role % retains table privilege %', role_name, forbidden_privilege;
      END IF;
    END LOOP;
  END LOOP;

  FOREACH forbidden_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']::text[] LOOP
    IF pg_catalog.has_table_privilege('service_role', map_table, forbidden_privilege) THEN
      RAISE EXCEPTION 'verify_failed: service_role retains table privilege %', forbidden_privilege;
    END IF;
  END LOOP;
  IF NOT pg_catalog.has_table_privilege('service_role', map_table, 'DELETE') THEN
    RAISE EXCEPTION 'verify_failed: account-deletion compatibility DELETE missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
    ) AS relation_acl
    WHERE relation.oid = map_table
      AND relation_acl.grantee = 'service_role'::pg_catalog.regrole::oid
      AND relation_acl.privilege_type <> 'DELETE'
  ) THEN
    RAISE EXCEPTION 'verify_failed: service_role table ACL is not DELETE-only';
  END IF;

  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role']::text[] LOOP
    FOREACH forbidden_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']::text[] LOOP
      IF pg_catalog.has_any_column_privilege(
           role_name,
           map_table,
           forbidden_privilege
         ) THEN
        RAISE EXCEPTION
          'verify_failed: role % retains column privilege %',
          role_name,
          forbidden_privilege;
      END IF;
    END LOOP;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid = delete_rpc::oid
      AND function.prokind = 'f'
      AND function.prosecdef
      AND function.prorettype = 'boolean'::pg_catalog.regtype
      AND function.proargnames = ARRAY['openid_in']::text[]
      AND COALESCE(function.proconfig, ARRAY[]::text[])
        @> ARRAY['search_path=pg_catalog']::text[]
      AND function.prosrc LIKE '%DELETE FROM public.wechat_password_map%'
      AND function.prosrc LIKE '%WHERE openid = openid_in%'
      AND function.prosrc NOT LIKE '%EXECUTE%'
  ) THEN
    RAISE EXCEPTION 'verify_failed: exact credential-delete RPC shape/security';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(function.proacl, pg_catalog.acldefault('f', function.proowner))
    ) AS function_acl
    WHERE function.oid = delete_rpc::oid
      AND function_acl.grantee = 0
      AND function_acl.privilege_type = 'EXECUTE'
  )
     OR pg_catalog.has_function_privilege('anon', delete_rpc, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', delete_rpc, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', delete_rpc, 'EXECUTE') THEN
    RAISE EXCEPTION 'verify_failed: exact credential-delete RPC ACL';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(function.proacl, pg_catalog.acldefault('f', function.proowner))
    ) AS function_acl
    WHERE function.oid IN (lookup_rpc::oid, store_rpc::oid)
      AND function_acl.grantee = 0
      AND function_acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'verify_failed: PUBLIC can execute a retired credential RPC';
  END IF;

  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role']::text[] LOOP
    IF pg_catalog.has_function_privilege(role_name, lookup_rpc, 'EXECUTE')
       OR pg_catalog.has_function_privilege(role_name, store_rpc, 'EXECUTE') THEN
      RAISE EXCEPTION 'verify_failed: role % can execute a retired credential RPC', role_name;
    END IF;
  END LOOP;

  IF pg_catalog.obj_description(map_table, 'pg_class') NOT LIKE 'RETIRED credential map.%' THEN
    RAISE EXCEPTION 'verify_failed: retirement marker missing';
  END IF;
END
$verify$;

SELECT
  pg_catalog.count(*) AS legacy_map_rows,
  pg_catalog.has_table_privilege('service_role', 'public.wechat_password_map', 'SELECT') AS service_can_select,
  pg_catalog.has_table_privilege('service_role', 'public.wechat_password_map', 'DELETE') AS service_can_delete,
  pg_catalog.has_function_privilege(
    'service_role',
    'public.wechat_password_lookup(text)',
    'EXECUTE'
  ) AS service_can_lookup,
  pg_catalog.has_function_privilege(
    'service_role',
    'public.wechat_password_store(text,text)',
    'EXECUTE'
  ) AS service_can_store,
  pg_catalog.has_function_privilege(
    'service_role',
    'public.delete_wechat_password_credential(text)',
    'EXECUTE'
  ) AS service_can_delete_exact
FROM public.wechat_password_map;

ROLLBACK;
