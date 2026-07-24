-- Forward-only convergence for the immutable password-retirement migration.
--
-- Migration 20260718140000 has already run byte-for-byte in staging, while
-- Production must execute a separately reviewed hardened derivative. Those
-- two paths differ only in whether service_role briefly retains a direct
-- table DELETE grant and in the table comment. This canonical migration
-- accepts exactly those two reviewed predecessor receipts and converges both
-- paths on the same RPC-only, owner-only table boundary.
--
-- This file deliberately has no explicit BEGIN/COMMIT. It must be executed by
-- the pinned Supabase CLI, whose per-migration transaction also appends the
-- schema_migrations receipt. Running LOCK TABLE in autocommit mode fails
-- closed. Privileged DDL/ACL changes remain frozen through COMMIT and the
-- immediate read-only VERIFY because GRANT/REVOKE does not lock the target
-- relation.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';
SET LOCAL search_path = pg_catalog;

DO $caaci_wechat_convergence_prelock$
DECLARE
  map_table regclass := pg_catalog.to_regclass(
    'public.wechat_password_map'
  );
  migration_ledger regclass := pg_catalog.to_regclass(
    'supabase_migrations.schema_migrations'
  );
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'wechat_convergence_requires_postgres'
      USING ERRCODE = '42501';
  END IF;
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed'
     OR pg_catalog.current_setting('transaction_read_only') <> 'off' THEN
    RAISE EXCEPTION 'wechat_convergence_transaction_mode_mismatch'
      USING ERRCODE = '55000';
  END IF;
  IF map_table IS NULL OR migration_ledger IS NULL THEN
    RAISE EXCEPTION 'wechat_convergence_required_relation_missing'
      USING ERRCODE = '55000';
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
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid = migration_ledger
       AND relation.relkind = 'r'
       AND relation.relpersistence = 'p'
       AND relation.relowner = pg_catalog.to_regrole('postgres')::oid
       AND NOT relation.relrowsecurity
       AND NOT relation.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'wechat_convergence_relation_shape_mismatch'
      USING ERRCODE = '55000';
  END IF;
  IF (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = map_table
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  ) <> 5 OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = migration_ledger
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  ) <> 3 THEN
    RAISE EXCEPTION 'wechat_convergence_column_count_mismatch'
      USING ERRCODE = '55000';
  END IF;
END
$caaci_wechat_convergence_prelock$;

-- Keep the same global lock order as the guarded retirement migration.
LOCK TABLE ONLY public.wechat_password_map IN ACCESS EXCLUSIVE MODE;
LOCK TABLE ONLY supabase_migrations.schema_migrations
  IN SHARE ROW EXCLUSIVE MODE;

DO $caaci_wechat_convergence_predecessor$
DECLARE
  map_table regclass := 'public.wechat_password_map'::regclass;
  migration_ledger regclass :=
    'supabase_migrations.schema_migrations'::regclass;
  lookup_rpc regprocedure := pg_catalog.to_regprocedure(
    'public.wechat_password_lookup(text)'
  );
  store_rpc regprocedure := pg_catalog.to_regprocedure(
    'public.wechat_password_store(text,text)'
  );
  delete_rpc regprocedure := pg_catalog.to_regprocedure(
    'public.delete_wechat_password_credential(text)'
  );
  exact_column_count bigint := 0;
  live_column_count bigint := 0;
  identity_count bigint := 0;
  identity_digest text := '';
  non_owner_table_acl_count bigint := 0;
  service_delete_acl_count bigint := 0;
  retirement_receipt text[];
  retirement_receipt_count integer := 0;
  retirement_receipt_digest text := '';
  role_name text;
  forbidden_privilege text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'wechat_convergence_requires_postgres'
      USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
        AS required(role_name)
     WHERE pg_catalog.to_regrole(required.role_name) IS NULL
  ) OR lookup_rpc IS NULL OR store_rpc IS NULL OR delete_rpc IS NULL THEN
    RAISE EXCEPTION 'wechat_convergence_required_object_missing'
      USING ERRCODE = '55000';
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
    SELECT 1 FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = map_table
  ) THEN
    RAISE EXCEPTION 'wechat_convergence_map_shape_mismatch'
      USING ERRCODE = '55000';
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
         AND attribute.atttypid =
             'timestamp with time zone'::pg_catalog.regtype
         AND attribute.attnotnull)
        OR (attribute.attname IN ('last_used_at', 'rotated_at')
         AND attribute.atttypid =
             'timestamp with time zone'::pg_catalog.regtype
         AND NOT attribute.attnotnull)
    )
    INTO live_column_count, exact_column_count
    FROM pg_catalog.pg_attribute AS attribute
   WHERE attribute.attrelid = map_table
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped;
  IF live_column_count <> 5 OR exact_column_count <> 5 THEN
    RAISE EXCEPTION 'wechat_convergence_map_column_mismatch'
      USING ERRCODE = '55000';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_attrdef AS attribute_default
      JOIN pg_catalog.pg_attribute AS attribute
        ON attribute.attrelid = attribute_default.adrelid
       AND attribute.attnum = attribute_default.adnum
     WHERE attribute_default.adrelid = map_table
       AND attribute.attname = 'created_at'
       AND pg_catalog.pg_get_expr(
             attribute_default.adbin,
             attribute_default.adrelid
           ) = 'now()'
  ) <> 1 OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_attrdef AS attribute_default
     WHERE attribute_default.adrelid = map_table
  ) <> 1 THEN
    RAISE EXCEPTION 'wechat_convergence_map_default_mismatch'
      USING ERRCODE = '55000';
  END IF;

  IF (
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
       AND index_row.indexprs IS NULL
       AND index_row.indpred IS NULL
       AND key_attribute.attname = 'openid'
  ) <> 1 OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_index AS index_row
     WHERE index_row.indrelid = map_table
  ) <> 1 OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_constraint AS constraint_row
     WHERE constraint_row.conrelid = map_table
       AND constraint_row.contype = 'p'
       AND constraint_row.convalidated
       AND NOT constraint_row.condeferrable
  ) <> 1 OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_constraint AS constraint_row
     WHERE constraint_row.conrelid = map_table
       AND constraint_row.contype = 'c'
       AND constraint_row.convalidated
       AND constraint_row.conname IN (
         'wechat_password_map_openid_check',
         'wechat_password_map_password_check'
       )
  ) <> 2 OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_constraint AS constraint_row
     WHERE constraint_row.conrelid = map_table
  ) <> 3 THEN
    RAISE EXCEPTION 'wechat_convergence_map_constraint_mismatch'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_inherits AS inheritance
     WHERE inheritance.inhrelid = map_table
        OR inheritance.inhparent = map_table
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid = map_table
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_rewrite AS rewrite_rule
     WHERE rewrite_rule.ev_class = map_table
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
  ) OR EXISTS (
    SELECT 1 FROM public.wechat_password_map LIMIT 1
  ) THEN
    RAISE EXCEPTION 'wechat_convergence_map_dependency_or_data_mismatch'
      USING ERRCODE = '55000';
  END IF;

  SELECT
    pg_catalog.count(*) FILTER (
      WHERE relation_acl.grantee <> relation.relowner
    ),
    pg_catalog.count(*) FILTER (
      WHERE relation_acl.grantee =
              pg_catalog.to_regrole('service_role')::oid
        AND relation_acl.privilege_type = 'DELETE'
        AND NOT relation_acl.is_grantable
    )
    INTO non_owner_table_acl_count, service_delete_acl_count
    FROM pg_catalog.pg_class AS relation
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        relation.relacl,
        pg_catalog.acldefault('r', relation.relowner)
      )
    ) AS relation_acl
   WHERE relation.oid = map_table;
  IF non_owner_table_acl_count NOT IN (0, 1)
     OR service_delete_acl_count <> non_owner_table_acl_count THEN
    RAISE EXCEPTION 'wechat_convergence_map_acl_predecessor_mismatch'
      USING ERRCODE = '55000';
  END IF;

  FOREACH role_name IN ARRAY ARRAY[
    'anon', 'authenticated', 'service_role'
  ]::text[] LOOP
    FOREACH forbidden_privilege IN ARRAY ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'TRUNCATE', 'REFERENCES',
      'TRIGGER', 'MAINTAIN'
    ]::text[] LOOP
      IF pg_catalog.has_table_privilege(
           role_name,
           map_table,
           forbidden_privilege
         ) THEN
        RAISE EXCEPTION 'wechat_convergence_effective_table_acl_mismatch'
          USING ERRCODE = '55000';
      END IF;
    END LOOP;
  END LOOP;
  IF non_owner_table_acl_count = 0 AND pg_catalog.has_table_privilege(
       'service_role', map_table, 'DELETE'
     ) THEN
    RAISE EXCEPTION 'wechat_convergence_hardened_acl_mismatch'
      USING ERRCODE = '55000';
  END IF;
  IF non_owner_table_acl_count = 1 AND NOT pg_catalog.has_table_privilege(
       'service_role', map_table, 'DELETE'
     ) THEN
    RAISE EXCEPTION 'wechat_convergence_canonical_acl_mismatch'
      USING ERRCODE = '55000';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_proc AS function
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = function.pronamespace
     WHERE namespace.nspname = 'public'
       AND function.proname IN (
         'wechat_password_lookup',
         'wechat_password_store',
         'delete_wechat_password_credential'
       )
  ) <> 3 THEN
    RAISE EXCEPTION 'wechat_convergence_rpc_overload_mismatch'
      USING ERRCODE = '55000';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_proc AS function
     WHERE function.oid IN (lookup_rpc::oid, store_rpc::oid)
       AND function.prokind = 'f'
       AND function.proowner = pg_catalog.to_regrole('postgres')::oid
       AND function.prosecdef
       AND function.provolatile = 'v'
       AND function.pronargdefaults = 0
       AND function.provariadic = 0
       AND function.proargmodes IS NULL
       AND function.proconfig = ARRAY['search_path=public']::text[]
       AND function.prosrc !~* '\mEXECUTE\M'
  ) <> 2 OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS function
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(
          function.proacl,
          pg_catalog.acldefault('f', function.proowner)
        )
      ) AS function_acl
     WHERE function.oid IN (lookup_rpc::oid, store_rpc::oid)
       AND function_acl.grantee <> function.proowner
  ) THEN
    RAISE EXCEPTION 'wechat_convergence_legacy_rpc_mismatch'
      USING ERRCODE = '55000';
  END IF;

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
       AND function.prosrc LIKE
           '%DELETE FROM public.wechat_password_map%'
       AND function.prosrc LIKE '%WHERE openid = openid_in%'
       AND function.prosrc LIKE
           '%GET DIAGNOSTICS deleted_rows = ROW_COUNT%'
       AND function.prosrc !~* '\mEXECUTE\M'
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS function
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(
          function.proacl,
          pg_catalog.acldefault('f', function.proowner)
        )
      ) AS function_acl
     WHERE function.oid = delete_rpc::oid
       AND (
         function_acl.grantee NOT IN (
           function.proowner,
           pg_catalog.to_regrole('service_role')::oid
         ) OR (
           function_acl.grantee =
             pg_catalog.to_regrole('service_role')::oid
           AND (
             function_acl.privilege_type <> 'EXECUTE'
             OR function_acl.is_grantable
           )
         )
       )
  ) OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_proc AS function
      CROSS JOIN LATERAL pg_catalog.aclexplode(function.proacl)
        AS function_acl
     WHERE function.oid = delete_rpc::oid
       AND function_acl.grantee =
           pg_catalog.to_regrole('service_role')::oid
       AND function_acl.privilege_type = 'EXECUTE'
       AND NOT function_acl.is_grantable
  ) <> 1 THEN
    RAISE EXCEPTION 'wechat_convergence_delete_rpc_mismatch'
      USING ERRCODE = '55000';
  END IF;

  FOREACH role_name IN ARRAY ARRAY[
    'anon', 'authenticated', 'service_role'
  ]::text[] LOOP
    IF pg_catalog.has_function_privilege(role_name, lookup_rpc, 'EXECUTE')
       OR pg_catalog.has_function_privilege(role_name, store_rpc, 'EXECUTE')
       OR (
         role_name <> 'service_role'
         AND pg_catalog.has_function_privilege(
           role_name,
           delete_rpc,
           'EXECUTE'
         )
       ) THEN
      RAISE EXCEPTION 'wechat_convergence_effective_rpc_acl_mismatch'
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF NOT pg_catalog.has_function_privilege(
       'service_role', delete_rpc, 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'wechat_convergence_service_rpc_missing'
      USING ERRCODE = '55000';
  END IF;

  IF COALESCE(pg_catalog.obj_description(map_table, 'pg_class'), '') NOT IN (
    'RETIRED credential map. Must remain empty. service_role DELETE only for account-deletion compatibility; drop after that worker no longer references it.',
    'RETIRED credential map. Must remain empty. No API role has table access; account-deletion compatibility is RPC-only.'
  ) THEN
    RAISE EXCEPTION 'wechat_convergence_predecessor_comment_mismatch'
      USING ERRCODE = '55000';
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
    SELECT 1 FROM pg_catalog.pg_attrdef AS attribute_default
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
  ) <> 1 OR (
    SELECT pg_catalog.count(*) FROM pg_catalog.pg_index AS index_row
     WHERE index_row.indrelid = migration_ledger
  ) <> 1 OR (
    SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint AS constraint_row
     WHERE constraint_row.conrelid = migration_ledger
  ) <> 1 OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = migration_ledger
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid = migration_ledger
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_rewrite AS rewrite_rule
     WHERE rewrite_rule.ev_class = migration_ledger
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_inherits AS inheritance
     WHERE inheritance.inhrelid = migration_ledger
        OR inheritance.inhparent = migration_ledger
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
  ) THEN
    RAISE EXCEPTION 'wechat_convergence_ledger_shape_mismatch'
      USING ERRCODE = '55000';
  END IF;

  SELECT
    pg_catalog.count(*),
    pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(
          COALESCE(
            pg_catalog.string_agg(
              ledger_row.version || '|' || ledger_row.name || E'\n',
              '' ORDER BY ledger_row.version, ledger_row.name
            ),
            ''
          ),
          'UTF8'
        )
      ),
      'hex'
    )
    INTO identity_count, identity_digest
    FROM supabase_migrations.schema_migrations AS ledger_row;
  IF (identity_count, identity_digest) NOT IN (
    (109, 'f2cd89a03f18b57f7e27cca1eac479f62e2fba44419f315aca4f7770df7b536c'),
    (132, 'cf3c687a67347bba242b2ece33de52bef43ff50ec8a58333c50533bbc1b9e2fa')
  ) OR (
    SELECT pg_catalog.count(*)
      FROM supabase_migrations.schema_migrations AS ledger_row
     WHERE ledger_row.version = '20260718140000'
       AND ledger_row.name = 'retire_wechat_password_credentials'
  ) <> 1 OR EXISTS (
    SELECT 1
      FROM supabase_migrations.schema_migrations AS ledger_row
     WHERE ledger_row.version = '20260722194923'
        OR ledger_row.name = 'converge_wechat_retirement_rpc_only'
  ) THEN
    RAISE EXCEPTION 'wechat_convergence_ledger_identity_mismatch'
      USING ERRCODE = '55000';
  END IF;

  SELECT ledger_row.statements
    INTO retirement_receipt
    FROM supabase_migrations.schema_migrations AS ledger_row
   WHERE ledger_row.version = '20260718140000'
     AND ledger_row.name = 'retire_wechat_password_credentials';
  IF retirement_receipt IS NULL
     OR COALESCE(pg_catalog.array_ndims(retirement_receipt), 0) <> 1
     OR COALESCE(pg_catalog.array_lower(retirement_receipt, 1), 0) <> 1
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(retirement_receipt) AS receipt(statement)
        WHERE receipt.statement IS NULL
           OR pg_catalog.btrim(receipt.statement) = ''
     ) THEN
    RAISE EXCEPTION 'wechat_convergence_retirement_receipt_missing'
      USING ERRCODE = '55000';
  END IF;
  SELECT
    pg_catalog.cardinality(retirement_receipt),
    pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(
          pg_catalog.string_agg(
            pg_catalog.octet_length(receipt.statement)::text || ':' ||
              receipt.statement,
            '' ORDER BY receipt.ordinality
          ),
          'UTF8'
        )
      ),
      'hex'
    )
    INTO retirement_receipt_count, retirement_receipt_digest
    FROM pg_catalog.unnest(retirement_receipt)
      WITH ORDINALITY AS receipt(statement, ordinality);
  -- Filled from the pinned Supabase CLI 2.95.4 receipts and then proved again
  -- by the PostgreSQL 17 disposable rehearsal before Production apply.
  IF (retirement_receipt_count, retirement_receipt_digest) NOT IN (
    (0, 'PENDING_CANONICAL_RETIREMENT_RECEIPT'),
    (0, 'PENDING_HARDENED_RETIREMENT_RECEIPT')
  ) THEN
    RAISE EXCEPTION 'wechat_convergence_retirement_receipt_mismatch'
      USING ERRCODE = '55000';
  END IF;
END
$caaci_wechat_convergence_predecessor$;

REVOKE ALL ON TABLE public.wechat_password_map
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.wechat_password_map IS
  'RETIRED credential map. Must remain empty. No API role has table access; account-deletion compatibility is RPC-only.';

DO $caaci_wechat_convergence_terminal$
DECLARE
  map_table regclass := 'public.wechat_password_map'::regclass;
  migration_ledger regclass :=
    'supabase_migrations.schema_migrations'::regclass;
  lookup_rpc regprocedure :=
    'public.wechat_password_lookup(text)'::regprocedure;
  store_rpc regprocedure :=
    'public.wechat_password_store(text,text)'::regprocedure;
  delete_rpc regprocedure :=
    'public.delete_wechat_password_credential(text)'::regprocedure;
  role_name text;
  forbidden_privilege text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.wechat_password_map LIMIT 1
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(
          relation.relacl,
          pg_catalog.acldefault('r', relation.relowner)
        )
      ) AS relation_acl
     WHERE relation.oid = map_table
       AND relation_acl.grantee <> relation.relowner
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
  ) OR COALESCE(
    pg_catalog.obj_description(map_table, 'pg_class'),
    ''
  ) <> 'RETIRED credential map. Must remain empty. No API role has table access; account-deletion compatibility is RPC-only.' THEN
    RAISE EXCEPTION 'wechat_convergence_terminal_map_mismatch'
      USING ERRCODE = '55000';
  END IF;

  FOREACH role_name IN ARRAY ARRAY[
    'anon', 'authenticated', 'service_role'
  ]::text[] LOOP
    FOREACH forbidden_privilege IN ARRAY ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES',
      'TRIGGER', 'MAINTAIN'
    ]::text[] LOOP
      IF pg_catalog.has_table_privilege(
           role_name,
           map_table,
           forbidden_privilege
         ) THEN
        RAISE EXCEPTION 'wechat_convergence_terminal_table_acl_mismatch'
          USING ERRCODE = '55000';
      END IF;
    END LOOP;
    IF pg_catalog.has_any_column_privilege(
         role_name,
         map_table,
         'SELECT, INSERT, UPDATE, REFERENCES'
       ) THEN
      RAISE EXCEPTION 'wechat_convergence_terminal_column_acl_mismatch'
        USING ERRCODE = '55000';
    END IF;
    IF pg_catalog.has_function_privilege(role_name, lookup_rpc, 'EXECUTE')
       OR pg_catalog.has_function_privilege(role_name, store_rpc, 'EXECUTE')
       OR (
         role_name <> 'service_role'
         AND pg_catalog.has_function_privilege(
           role_name,
           delete_rpc,
           'EXECUTE'
         )
       ) THEN
      RAISE EXCEPTION 'wechat_convergence_terminal_rpc_acl_mismatch'
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF NOT pg_catalog.has_function_privilege(
       'service_role', delete_rpc, 'EXECUTE'
     ) OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_proc AS function
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = function.pronamespace
     WHERE namespace.nspname = 'public'
       AND function.proname IN (
         'wechat_password_lookup',
         'wechat_password_store',
         'delete_wechat_password_credential'
       )
  ) <> 3 THEN
    RAISE EXCEPTION 'wechat_convergence_terminal_rpc_shape_mismatch'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM supabase_migrations.schema_migrations AS ledger_row
     WHERE ledger_row.version = '20260722194923'
        OR ledger_row.name = 'converge_wechat_retirement_rpc_only'
  ) OR migration_ledger IS NULL THEN
    RAISE EXCEPTION 'wechat_convergence_terminal_ledger_mismatch'
      USING ERRCODE = '55000';
  END IF;
END
$caaci_wechat_convergence_terminal$;
