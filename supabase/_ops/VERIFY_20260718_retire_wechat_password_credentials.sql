-- Read-only post-deploy verification. Never select the password column.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $verify$
DECLARE
  map_table regclass := pg_catalog.to_regclass('public.wechat_password_map');
  lookup_rpc regprocedure := pg_catalog.to_regprocedure('public.wechat_password_lookup(text)');
  store_rpc regprocedure := pg_catalog.to_regprocedure('public.wechat_password_store(text,text)');
  delete_rpc regprocedure := pg_catalog.to_regprocedure('public.delete_wechat_password_credential(text)');
  migration_ledger regclass := pg_catalog.to_regclass(
    'supabase_migrations.schema_migrations'
  );
  role_name text;
  forbidden_privilege text;
  migration_record_count bigint := 0;
  migration_collision_count bigint := 0;
  migration_statements text[];
  migration_sql text;
  migration_statement text;
  exact_column_count bigint := 0;
  live_column_count bigint := 0;
  legacy_rpc_shape_count bigint := 0;
  ledger_actual_count bigint := 0;
  ledger_unique_version_count bigint := 0;
  ledger_unique_identity_count bigint := 0;
  guard_identity_count bigint := 0;
  guard_unique_version_count bigint := 0;
  guard_unique_identity_count bigint := 0;
  guard_identity_mismatch_count bigint := 0;
  guard_identity_md5 text;
  ledger_predecessor_md5 text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION
      'verify_failed: WeChat credential retirement verification must run as postgres, got %',
      current_user;
  END IF;
  IF map_table IS NULL OR lookup_rpc IS NULL OR store_rpc IS NULL
     OR delete_rpc IS NULL THEN
    RAISE EXCEPTION 'verify_failed: retired WeChat credential objects missing';
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
  ) <> 2 OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_proc AS function
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = function.pronamespace
     WHERE namespace.nspname = 'public'
       AND function.proname = 'delete_wechat_password_credential'
  ) <> 1 THEN
    RAISE EXCEPTION 'verify_failed: retired RPC namespace shape drifted';
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
    RAISE EXCEPTION 'verify_failed: retired credential map is not deny-all RLS';
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
    RAISE EXCEPTION 'verify_failed: retired map columns/primary key drifted';
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
    RAISE EXCEPTION 'verify_failed: retired map dependency/hook drifted';
  END IF;

  -- Prove the named object is the expected postgres-owned persistent table
  -- before touching any row data. A same-name view/foreign table must fail
  -- before privileged verification could execute attacker-controlled logic.
  IF EXISTS (SELECT 1 FROM public.wechat_password_map LIMIT 1) THEN
    RAISE EXCEPTION 'verify_failed: retired credential map is not empty';
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
    FOREACH forbidden_privilege IN ARRAY ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES',
      'TRIGGER', 'MAINTAIN'
    ]::text[] LOOP
      IF pg_catalog.has_table_privilege(role_name, map_table, forbidden_privilege) THEN
        RAISE EXCEPTION 'verify_failed: role % retains table privilege %', role_name, forbidden_privilege;
      END IF;
    END LOOP;
  END LOOP;

  FOREACH forbidden_privilege IN ARRAY ARRAY[
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES',
    'TRIGGER', 'MAINTAIN'
  ]::text[] LOOP
    IF pg_catalog.has_table_privilege('service_role', map_table, forbidden_privilege) THEN
      RAISE EXCEPTION 'verify_failed: service_role retains table privilege %', forbidden_privilege;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
    ) AS relation_acl
    WHERE relation.oid = map_table
      AND relation_acl.grantee <> relation.relowner
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS column_acl
    WHERE attribute.attrelid = map_table
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND column_acl.grantee <> pg_catalog.to_regrole('postgres')::oid
  ) THEN
    RAISE EXCEPTION 'verify_failed: unexpected table/column grantee remains';
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
    RAISE EXCEPTION 'verify_failed: retired credential map has dependency/hook drift';
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
      AND function.proowner = pg_catalog.to_regrole('postgres')::oid
      AND function.prosecdef
      AND function.provolatile = 'v'
      AND function.prorettype = 'boolean'::pg_catalog.regtype
      AND function.pronargs = 1
      AND function.pronargdefaults = 0
      AND function.provariadic = 0
      AND function.proargmodes IS NULL
      AND function.proargnames = ARRAY['openid_in']::text[]
      AND function.proconfig = ARRAY['search_path=pg_catalog']::text[]
      AND function.prosrc LIKE '%DELETE FROM public.wechat_password_map%'
      AND function.prosrc LIKE '%WHERE openid = openid_in%'
      AND function.prosrc LIKE '%GET DIAGNOSTICS deleted_rows = ROW_COUNT%'
      AND function.prosrc !~* '\mEXECUTE\M'
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
     OR NOT pg_catalog.has_function_privilege('service_role', delete_rpc, 'EXECUTE')
     OR (
       SELECT pg_catalog.count(*)
       FROM pg_catalog.pg_proc AS function
       CROSS JOIN LATERAL pg_catalog.aclexplode(function.proacl)
         AS function_acl
       WHERE function.oid = delete_rpc::oid
         AND function_acl.grantee = pg_catalog.to_regrole('service_role')::oid
         AND function_acl.privilege_type = 'EXECUTE'
         AND NOT function_acl.is_grantable
     ) <> 1 THEN
    RAISE EXCEPTION 'verify_failed: exact credential-delete RPC ACL';
  END IF;

  SELECT pg_catalog.count(*)
    INTO legacy_rpc_shape_count
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid IN (lookup_rpc::oid, store_rpc::oid)
      AND function.prokind = 'f'
      AND function.proowner = pg_catalog.to_regrole('postgres')::oid
      AND function.prosecdef
      AND function.provolatile = 'v'
      AND function.proconfig = ARRAY['search_path=public']::text[]
      AND function.prosrc !~* '\mEXECUTE\M';
  IF legacy_rpc_shape_count <> 2 THEN
    RAISE EXCEPTION 'verify_failed: retired legacy RPC shape drifted';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(function.proacl, pg_catalog.acldefault('f', function.proowner))
    ) AS function_acl
    WHERE function.oid = delete_rpc::oid
      AND (
        function_acl.grantee NOT IN (
          function.proowner,
          pg_catalog.to_regrole('service_role')::oid
        )
        OR (
          function_acl.grantee = pg_catalog.to_regrole('service_role')::oid
          AND (
            function_acl.privilege_type <> 'EXECUTE'
            OR function_acl.is_grantable
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'verify_failed: unexpected exact-delete RPC grantee';
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

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(function.proacl, pg_catalog.acldefault('f', function.proowner))
    ) AS function_acl
    WHERE function.oid IN (lookup_rpc::oid, store_rpc::oid)
      AND function_acl.grantee <> function.proowner
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid IN (lookup_rpc::oid, store_rpc::oid)
      AND function.proowner <> pg_catalog.to_regrole('postgres')::oid
  ) THEN
    RAISE EXCEPTION 'verify_failed: retired legacy RPC owner/ACL drifted';
  END IF;

  IF COALESCE(
       pg_catalog.obj_description(map_table, 'pg_class'),
       ''
     ) NOT LIKE 'RETIRED credential map.%' THEN
    RAISE EXCEPTION 'verify_failed: retirement marker missing';
  END IF;

  IF migration_ledger IS NULL THEN
    RAISE EXCEPTION 'verify_failed: Supabase migration ledger missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = migration_ledger
      AND relation.relkind = 'r'
      AND relation.relpersistence = 'p'
      AND relation.relowner = pg_catalog.to_regrole('postgres')::oid
      AND NOT relation.relrowsecurity
      AND NOT relation.relforcerowsecurity
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = migration_ledger
      AND attribute.attname = 'version'
      AND attribute.atttypid = 'text'::pg_catalog.regtype
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = migration_ledger
      AND attribute.attname = 'name'
      AND attribute.atttypid = 'text'::pg_catalog.regtype
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = migration_ledger
      AND attribute.attname = 'statements'
      AND attribute.atttypid = 'text[]'::pg_catalog.regtype
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ) OR (
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
      COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
    ) AS relation_acl
    WHERE relation.oid = migration_ledger
      AND relation_acl.grantee <> relation.relowner
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS column_acl
    WHERE attribute.attrelid = migration_ledger
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND column_acl.grantee <> pg_catalog.to_regrole('postgres')::oid
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
    RAISE EXCEPTION 'verify_failed: Supabase migration ledger shape drifted';
  END IF;

  EXECUTE
    'SELECT count(*)
       FROM supabase_migrations.schema_migrations
      WHERE version = $1 AND name = $2'
    INTO migration_record_count
    USING
      '20260718140000',
      'retire_wechat_password_credentials';

  EXECUTE
    'SELECT count(*)
       FROM supabase_migrations.schema_migrations
      WHERE version = $1 OR name IN ($2, $3)'
    INTO migration_collision_count
    USING
      '20260718140000',
      'retire_wechat_password_credentials',
      '20260718140000_retire_wechat_password_credentials';

  IF migration_record_count <> 1 OR migration_collision_count <> 1 THEN
    RAISE EXCEPTION
      'verify_failed: expected one exact CLI retirement ledger row, exact %, collision %',
      migration_record_count,
      migration_collision_count;
  END IF;

  EXECUTE
    'SELECT statements
       FROM supabase_migrations.schema_migrations
      WHERE version = $1 AND name = $2'
    INTO migration_statements
    USING
      '20260718140000',
      'retire_wechat_password_credentials';

  IF migration_statements IS NULL
     OR COALESCE(pg_catalog.array_ndims(migration_statements), 0) <> 1
     OR COALESCE(pg_catalog.array_lower(migration_statements, 1), 0) <> 1
     OR COALESCE(pg_catalog.array_upper(migration_statements, 1), 0) <> 19
     OR pg_catalog.cardinality(migration_statements) <> 19 THEN
    RAISE EXCEPTION 'verify_failed: guarded migration statement receipt missing';
  END IF;
  FOREACH migration_statement IN ARRAY migration_statements LOOP
    IF migration_statement IS NULL
       OR pg_catalog.btrim(migration_statement) = '' THEN
      RAISE EXCEPTION
        'verify_failed: migration ledger contains a null/empty statement';
    END IF;
    IF pg_catalog.btrim(migration_statement) ~* '^(BEGIN|COMMIT)\s*;?$' THEN
      RAISE EXCEPTION
        'verify_failed: migration ledger contains an outer transaction statement';
    END IF;
  END LOOP;

  IF COALESCE(pg_catalog.strpos(migration_statements[1], 'SET LOCAL lock_timeout = ''5s'''), 0) = 0
     OR COALESCE(pg_catalog.strpos(migration_statements[2], 'SET LOCAL statement_timeout = ''2min'''), 0) = 0
     OR COALESCE(pg_catalog.strpos(migration_statements[3], 'SET LOCAL search_path = pg_catalog'), 0) = 0
     OR COALESCE(pg_catalog.strpos(migration_statements[4], 'LOCK TABLE supabase_migrations.schema_migrations'), 0) = 0
     OR COALESCE(pg_catalog.strpos(migration_statements[5], 'DO $caaci_production_ledger_guard$'), 0) = 0
     OR COALESCE(pg_catalog.strpos(migration_statements[6], 'LOCK TABLE public.wechat_password_map'), 0) = 0
     OR COALESCE(pg_catalog.strpos(migration_statements[7], 'DO $guard$'), 0) = 0
     OR COALESCE(pg_catalog.strpos(migration_statements[8], 'REVOKE ALL ON TABLE public.wechat_password_map'), 0) = 0
     OR COALESCE(pg_catalog.strpos(migration_statements[9], 'GRANT DELETE ON TABLE public.wechat_password_map'), 0) = 0
     OR COALESCE(pg_catalog.strpos(migration_statements[10], 'CREATE OR REPLACE FUNCTION public.delete_wechat_password_credential'), 0) = 0
     OR COALESCE(pg_catalog.strpos(migration_statements[11], 'REVOKE ALL ON FUNCTION public.delete_wechat_password_credential'), 0) = 0
     OR COALESCE(pg_catalog.strpos(migration_statements[12], 'GRANT EXECUTE ON FUNCTION public.delete_wechat_password_credential'), 0) = 0
     OR COALESCE(pg_catalog.strpos(migration_statements[13], 'REVOKE ALL ON FUNCTION public.wechat_password_lookup'), 0) = 0
     OR COALESCE(pg_catalog.strpos(migration_statements[14], 'REVOKE ALL ON FUNCTION public.wechat_password_store'), 0) = 0
     OR COALESCE(pg_catalog.strpos(migration_statements[15], 'COMMENT ON TABLE public.wechat_password_map'), 0) = 0
     OR COALESCE(pg_catalog.strpos(migration_statements[16], 'COMMENT ON FUNCTION public.wechat_password_lookup'), 0) = 0
     OR COALESCE(pg_catalog.strpos(migration_statements[17], 'COMMENT ON FUNCTION public.wechat_password_store'), 0) = 0
     OR COALESCE(pg_catalog.strpos(migration_statements[18], 'COMMENT ON FUNCTION public.delete_wechat_password_credential'), 0) = 0
     OR COALESCE(pg_catalog.strpos(migration_statements[19], 'NOTIFY pgrst'), 0) = 0 THEN
    RAISE EXCEPTION 'verify_failed: guarded migration statement order/shape drifted';
  END IF;

  migration_sql := pg_catalog.array_to_string(migration_statements, E'\n');
  IF pg_catalog.strpos(migration_sql, 'SET LOCAL lock_timeout') = 0
     OR pg_catalog.strpos(migration_sql, 'SET LOCAL statement_timeout') = 0
     OR pg_catalog.strpos(
          migration_sql,
          'LOCK TABLE supabase_migrations.schema_migrations'
        ) = 0
     OR pg_catalog.strpos(migration_sql, 'IN SHARE ROW EXCLUSIVE MODE') = 0
     OR pg_catalog.strpos(migration_sql, 'FULL OUTER JOIN supabase_migrations.schema_migrations') = 0
     OR pg_catalog.strpos(
          migration_sql,
          'production_ledger_identity_cardinality_mismatch'
        ) = 0
     OR pg_catalog.strpos(migration_sql, 'actual_count <> 108') = 0
     OR pg_catalog.strpos(migration_sql, 'unique_version_count <> 108') = 0
     OR pg_catalog.strpos(migration_sql, 'unique_identity_count <> 108') = 0
     OR pg_catalog.strpos(migration_sql, '(''001'', ''initial_schema'')') = 0
     OR pg_catalog.strpos(
          migration_sql,
          '(''20260722163545'', ''20260722161200_protect_admin_owner_presentation_signal'')'
        ) = 0
     OR pg_catalog.strpos(migration_sql, 'production_ledger_projection_mismatch') = 0
     OR pg_catalog.strpos(migration_sql, 'LOCK TABLE public.wechat_password_map') = 0
     OR pg_catalog.strpos(migration_sql, 'IN ACCESS EXCLUSIVE MODE') = 0
     OR pg_catalog.strpos(migration_sql, 'REVOKE ALL ON TABLE public.wechat_password_map') = 0
     OR pg_catalog.strpos(migration_sql, 'CREATE OR REPLACE FUNCTION public.delete_wechat_password_credential') = 0
     OR pg_catalog.strpos(migration_sql, 'SET LOCAL lock_timeout') >
        pg_catalog.strpos(migration_sql, 'LOCK TABLE supabase_migrations.schema_migrations')
     OR pg_catalog.strpos(migration_sql, 'LOCK TABLE supabase_migrations.schema_migrations') >
        pg_catalog.strpos(migration_sql, 'LOCK TABLE public.wechat_password_map') THEN
    RAISE EXCEPTION 'verify_failed: guarded migration statement receipt drifted';
  END IF;

  SELECT
    pg_catalog.count(*),
    pg_catalog.count(DISTINCT ledger_row.version),
    pg_catalog.count(DISTINCT (ledger_row.version, ledger_row.name))
    INTO
      ledger_actual_count,
      ledger_unique_version_count,
      ledger_unique_identity_count
    FROM supabase_migrations.schema_migrations AS ledger_row;
  IF ledger_actual_count <> 109
     OR ledger_unique_version_count <> 109
     OR ledger_unique_identity_count <> 109 THEN
    RAISE EXCEPTION
      'verify_failed: post-retirement migration ledger cardinality drifted';
  END IF;

  WITH guard_identities AS (
    SELECT
      guard_match.parts[1] AS version,
      guard_match.parts[2] AS name
    FROM pg_catalog.regexp_matches(
      migration_statements[5],
      E'\\(''([0-9]{3}|[0-9]{14})'', ''([A-Za-z0-9_.-]+)''\\)',
      'g'
    ) AS guard_match(parts)
  )
  SELECT
    pg_catalog.count(*),
    pg_catalog.count(DISTINCT guard_row.version),
    pg_catalog.count(DISTINCT (guard_row.version, guard_row.name))
    INTO
      guard_identity_count,
      guard_unique_version_count,
      guard_unique_identity_count
    FROM guard_identities AS guard_row;
  IF guard_identity_count <> 108
     OR guard_unique_version_count <> 108
     OR guard_unique_identity_count <> 108 THEN
    RAISE EXCEPTION
      'verify_failed: guarded receipt identity cardinality drifted';
  END IF;

  WITH guard_identities AS (
    SELECT
      guard_match.parts[1] AS version,
      guard_match.parts[2] AS name
    FROM pg_catalog.regexp_matches(
      migration_statements[5],
      E'\\(''([0-9]{3}|[0-9]{14})'', ''([A-Za-z0-9_.-]+)''\\)',
      'g'
    ) AS guard_match(parts)
  )
  SELECT pg_catalog.md5(
           pg_catalog.string_agg(
             guard_row.version || '|' || guard_row.name || E'\n',
             '' ORDER BY guard_row.version, guard_row.name
           )
         )
    INTO guard_identity_md5
    FROM guard_identities AS guard_row;
  SELECT pg_catalog.md5(
           pg_catalog.string_agg(
             ledger_row.version || '|' || ledger_row.name || E'\n',
             '' ORDER BY ledger_row.version, ledger_row.name
           )
         )
    INTO ledger_predecessor_md5
    FROM supabase_migrations.schema_migrations AS ledger_row
   WHERE NOT (
     ledger_row.version = '20260718140000'
     AND ledger_row.name = 'retire_wechat_password_credentials'
   );
  IF guard_identity_md5 IS DISTINCT FROM 'ec5c0180e406d6ee92bebfaf85e8b2f3'
     OR ledger_predecessor_md5 IS DISTINCT FROM 'ec5c0180e406d6ee92bebfaf85e8b2f3' THEN
    RAISE EXCEPTION
      'verify_failed: guarded receipt pinned identity checksum drifted';
  END IF;

  WITH guard_identities AS (
    SELECT
      guard_match.parts[1] AS version,
      guard_match.parts[2] AS name
    FROM pg_catalog.regexp_matches(
      migration_statements[5],
      E'\\(''([0-9]{3}|[0-9]{14})'', ''([A-Za-z0-9_.-]+)''\\)',
      'g'
    ) AS guard_match(parts)
  ),
  live_predecessors AS (
    SELECT ledger_row.version, ledger_row.name
    FROM supabase_migrations.schema_migrations AS ledger_row
    WHERE NOT (
      ledger_row.version = '20260718140000'
      AND ledger_row.name = 'retire_wechat_password_credentials'
    )
  )
  SELECT pg_catalog.count(*)
    INTO guard_identity_mismatch_count
    FROM guard_identities AS guard_row
    FULL OUTER JOIN live_predecessors AS ledger_row
      ON ledger_row.version = guard_row.version
     AND ledger_row.name = guard_row.name
   WHERE guard_row.version IS NULL
      OR ledger_row.version IS NULL;
  IF guard_identity_mismatch_count <> 0 THEN
    RAISE EXCEPTION
      'verify_failed: guarded receipt identity projection drifted';
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
