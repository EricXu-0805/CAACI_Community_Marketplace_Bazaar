-- Read-only production precheck for
-- 20260718140000_retire_wechat_password_credentials.sql.
-- Never select the password column. This proves database prerequisites only;
-- it cannot replace the reviewed passwordless-provider canary, traffic drain,
-- retirement-script receipt, or independent backup/restore evidence.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $precheck$
DECLARE
  map_table regclass := pg_catalog.to_regclass(
    'public.wechat_password_map'
  );
  lookup_rpc regprocedure := pg_catalog.to_regprocedure(
    'public.wechat_password_lookup(text)'
  );
  store_rpc regprocedure := pg_catalog.to_regprocedure(
    'public.wechat_password_store(text,text)'
  );
  migration_ledger regclass := pg_catalog.to_regclass(
    'supabase_migrations.schema_migrations'
  );
  legacy_rows bigint;
  legacy_rpc_shape_count bigint;
  exact_column_count bigint := 0;
  live_column_count bigint := 0;
  migration_record_count bigint := 0;
  role_name text;
  forbidden_privilege text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION
      'precheck_failed: WeChat credential retirement must run as postgres, got %',
      current_user;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
        AS required(role_name)
     WHERE pg_catalog.to_regrole(required.role_name) IS NULL
  ) THEN
    RAISE EXCEPTION 'precheck_failed: required Supabase API role missing';
  END IF;

  IF map_table IS NULL OR lookup_rpc IS NULL OR store_rpc IS NULL THEN
    RAISE EXCEPTION
      'precheck_failed: legacy WeChat password objects are incomplete';
  END IF;
  IF (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_proc AS function
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = function.pronamespace
     WHERE namespace.nspname = 'public'
       AND function.proname IN (
         'wechat_password_lookup', 'wechat_password_store'
       )
  ) <> 2 OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS function
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = function.pronamespace
     WHERE namespace.nspname = 'public'
       AND function.proname = 'delete_wechat_password_credential'
  ) THEN
    RAISE EXCEPTION
      'precheck_failed: legacy/delete RPC namespace shape drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid = map_table
       AND relation.relkind = 'r'
       AND relation.relpersistence = 'p'
       AND relation.relowner = pg_catalog.to_regrole('postgres')::oid
       AND relation.relrowsecurity
       AND NOT relation.relforcerowsecurity
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = map_table
  ) THEN
    RAISE EXCEPTION
      'precheck_failed: credential map ownership/RLS shape drifted';
  END IF;

  SELECT
    pg_catalog.count(*),
    pg_catalog.count(*) FILTER (
      WHERE
        (attribute.attname = 'openid'
         AND attribute.atttypid = 'text'::pg_catalog.regtype
         AND attribute.attnotnull)
        OR (attribute.attname = 'password'
         AND attribute.atttypid = 'text'::pg_catalog.regtype
         AND attribute.attnotnull)
        OR (attribute.attname = 'created_at'
         AND attribute.atttypid = 'timestamp with time zone'::pg_catalog.regtype
         AND attribute.attnotnull)
        OR (attribute.attname IN ('last_used_at', 'rotated_at')
         AND attribute.atttypid = 'timestamp with time zone'::pg_catalog.regtype
         AND NOT attribute.attnotnull)
    )
    INTO live_column_count, exact_column_count
    FROM pg_catalog.pg_attribute AS attribute
   WHERE attribute.attrelid = map_table
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped;
  IF live_column_count <> 5 OR exact_column_count <> 5 OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_index AS index_row
      JOIN pg_catalog.pg_attribute AS key_attribute
        ON key_attribute.attrelid = index_row.indrelid
       AND key_attribute.attnum = index_row.indkey[0]
     WHERE index_row.indrelid = map_table
       AND index_row.indisprimary
       AND index_row.indisunique
       AND index_row.indisvalid
       AND index_row.indisready
       AND index_row.indimmediate
       AND index_row.indnkeyatts = 1
       AND index_row.indnatts = 1
       AND key_attribute.attname = 'openid'
       AND key_attribute.atttypid = 'text'::pg_catalog.regtype
  ) <> 1 THEN
    RAISE EXCEPTION
      'precheck_failed: credential map columns/primary key drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_inherits AS inheritance
     WHERE inheritance.inhrelid = map_table
        OR inheritance.inhparent = map_table
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid = map_table
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_rewrite AS rewrite_rule
     WHERE rewrite_rule.ev_class = map_table
  ) THEN
    RAISE EXCEPTION
      'precheck_failed: credential map has inheritance/trigger/rule drift';
  END IF;

  -- The immutable migration revokes only the four known API principals. Stop
  -- if drift introduced another explicit grantee that it would leave behind.
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(
          relation.relacl,
          pg_catalog.acldefault('r', relation.relowner)
        )
      ) AS relation_acl
     WHERE relation.oid = map_table
       AND relation_acl.grantee NOT IN (
         relation.relowner,
         pg_catalog.to_regrole('service_role')::oid
       )
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl)
        AS column_acl
     WHERE attribute.attrelid = map_table
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
       AND column_acl.grantee <>
           pg_catalog.to_regrole('postgres')::oid
  ) OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_class AS relation
      CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl)
        AS relation_acl
     WHERE relation.oid = map_table
       AND relation_acl.grantee =
           pg_catalog.to_regrole('service_role')::oid
       AND relation_acl.privilege_type IN (
         'SELECT', 'INSERT', 'UPDATE', 'DELETE'
       )
       AND NOT relation_acl.is_grantable
  ) <> 4 OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
      CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl)
        AS relation_acl
     WHERE relation.oid = map_table
       AND relation_acl.grantee =
           pg_catalog.to_regrole('service_role')::oid
       AND (
         relation_acl.privilege_type NOT IN (
           'SELECT', 'INSERT', 'UPDATE', 'DELETE'
         )
         OR relation_acl.is_grantable
       )
  ) THEN
    RAISE EXCEPTION
      'precheck_failed: credential map has an unexpected table/column grantee';
  END IF;

  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated']::text[] LOOP
    FOREACH forbidden_privilege IN ARRAY ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES',
      'TRIGGER', 'MAINTAIN'
    ]::text[] LOOP
      IF pg_catalog.has_table_privilege(
           role_name,
           map_table,
           forbidden_privilege
         ) THEN
        RAISE EXCEPTION
          'precheck_failed: role % can % the credential map',
          role_name,
          forbidden_privilege;
      END IF;
    END LOOP;
  END LOOP;

  IF NOT pg_catalog.has_table_privilege(
       'service_role', map_table, 'SELECT'
     ) OR NOT pg_catalog.has_table_privilege(
       'service_role', map_table, 'DELETE'
     ) THEN
    RAISE EXCEPTION
      'precheck_failed: retirement inventory/delete capability missing';
  END IF;

  SELECT pg_catalog.count(*)
    INTO legacy_rpc_shape_count
    FROM pg_catalog.pg_proc AS function
   WHERE function.oid IN (lookup_rpc::oid, store_rpc::oid)
     AND function.prokind = 'f'
     AND function.proowner = pg_catalog.to_regrole('postgres')::oid
     AND function.prosecdef
     AND function.provolatile = 'v'
     AND function.proconfig = ARRAY['search_path=public']::text[];

  IF legacy_rpc_shape_count <> 2 THEN
    RAISE EXCEPTION
      'precheck_failed: legacy WeChat password RPC shape/security drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS function
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(
          function.proacl,
          pg_catalog.acldefault('f', function.proowner)
        )
      ) AS function_acl
     WHERE function.oid IN (lookup_rpc::oid, store_rpc::oid)
       AND function_acl.grantee NOT IN (
         function.proowner,
         pg_catalog.to_regrole('service_role')::oid
       )
  ) OR NOT pg_catalog.has_function_privilege(
    'service_role', lookup_rpc, 'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'service_role', store_rpc, 'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'anon', lookup_rpc, 'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'anon', store_rpc, 'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'authenticated', lookup_rpc, 'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'authenticated', store_rpc, 'EXECUTE'
  ) OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_proc AS function
      CROSS JOIN LATERAL pg_catalog.aclexplode(function.proacl)
        AS function_acl
     WHERE function.oid IN (lookup_rpc::oid, store_rpc::oid)
       AND function_acl.grantee =
           pg_catalog.to_regrole('service_role')::oid
       AND function_acl.privilege_type = 'EXECUTE'
       AND NOT function_acl.is_grantable
  ) <> 2
  THEN
    RAISE EXCEPTION
      'precheck_failed: legacy WeChat password RPC ACL drifted';
  END IF;

  IF migration_ledger IS NULL OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid = migration_ledger
       AND relation.relkind = 'r'
       AND relation.relpersistence = 'p'
       AND relation.relowner = pg_catalog.to_regrole('postgres')::oid
       AND NOT relation.relrowsecurity
       AND NOT relation.relforcerowsecurity
  ) OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = migration_ledger
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
       AND (
         (attribute.attname IN ('version', 'name')
          AND attribute.atttypid = 'text'::pg_catalog.regtype)
         OR (attribute.attname = 'statements'
          AND attribute.atttypid = 'text[]'::pg_catalog.regtype)
       )
  ) <> 3 OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = migration_ledger
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  ) <> 3 OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attrdef AS attribute_default
     WHERE attribute_default.adrelid = migration_ledger
  ) OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_index AS index_row
      JOIN pg_catalog.pg_attribute AS key_attribute
        ON key_attribute.attrelid = index_row.indrelid
       AND key_attribute.attnum = index_row.indkey[0]
     WHERE index_row.indrelid = migration_ledger
       AND index_row.indisprimary
       AND index_row.indisunique
       AND index_row.indisvalid
       AND index_row.indisready
       AND index_row.indimmediate
       AND index_row.indnkeyatts = 1
       AND index_row.indnatts = 1
       AND index_row.indexprs IS NULL
       AND index_row.indpred IS NULL
       AND key_attribute.attname = 'version'
       AND key_attribute.atttypid = 'text'::pg_catalog.regtype
  ) <> 1 OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_index AS index_row
     WHERE index_row.indrelid = migration_ledger
  ) <> 1 OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_constraint AS constraint_row
     WHERE constraint_row.conrelid = migration_ledger
  ) <> 1 OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = migration_ledger
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(
          relation.relacl,
          pg_catalog.acldefault('r', relation.relowner)
        )
      ) AS relation_acl
     WHERE relation.oid = migration_ledger
       AND relation_acl.grantee <> relation.relowner
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl)
        AS column_acl
     WHERE attribute.attrelid = migration_ledger
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
       AND column_acl.grantee <>
           pg_catalog.to_regrole('postgres')::oid
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid = migration_ledger
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_rewrite AS rewrite_rule
     WHERE rewrite_rule.ev_class = migration_ledger
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_inherits AS inheritance
     WHERE inheritance.inhrelid = migration_ledger
        OR inheritance.inhparent = migration_ledger
  ) THEN
    RAISE EXCEPTION 'precheck_failed: Supabase migration ledger shape drifted';
  END IF;

  EXECUTE
    'SELECT count(*)
       FROM supabase_migrations.schema_migrations
      WHERE version = $1 OR name IN ($2, $3)'
    INTO migration_record_count
    USING
      '20260718140000',
      'retire_wechat_password_credentials',
      '20260718140000_retire_wechat_password_credentials';

  IF migration_record_count <> 0 THEN
    RAISE EXCEPTION
      'precheck_failed: retirement migration already has % ledger row(s)',
      migration_record_count;
  END IF;

  SELECT pg_catalog.count(*)
    INTO legacy_rows
    FROM public.wechat_password_map;
  IF legacy_rows <> 0 THEN
    RAISE EXCEPTION
      'precheck_failed: % legacy map row(s) remain; run the reviewed retirement script first',
      legacy_rows;
  END IF;

  RAISE NOTICE
    'WeChat credential retirement precheck: empty map and exact predecessor shape';
END;
$precheck$;

SELECT
  pg_catalog.count(*) AS legacy_map_rows,
  pg_catalog.has_table_privilege(
    'service_role', 'public.wechat_password_map', 'SELECT'
  ) AS service_can_select,
  pg_catalog.has_table_privilege(
    'service_role', 'public.wechat_password_map', 'INSERT'
  ) AS service_can_insert,
  pg_catalog.has_table_privilege(
    'service_role', 'public.wechat_password_map', 'UPDATE'
  ) AS service_can_update,
  pg_catalog.has_table_privilege(
    'service_role', 'public.wechat_password_map', 'DELETE'
  ) AS service_can_delete
FROM public.wechat_password_map;

ROLLBACK;
