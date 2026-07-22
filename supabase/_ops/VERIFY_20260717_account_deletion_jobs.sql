-- Read-only post-deploy verification for
-- 20260717194646_account_deletion_jobs.sql.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $verify$
DECLARE
  browser_role name;
  column_count integer;
  check_count integer;
  constraint_definition text;
  helper_oid oid;
  insert_policy pg_catalog.pg_policy%ROWTYPE;
  update_policy pg_catalog.pg_policy%ROWTYPE;
  insert_check text;
  update_using text;
  update_check text;
  legacy_delete_rpc oid;
  atomic_prepare_rpc oid;
BEGIN
  legacy_delete_rpc := pg_catalog.to_regprocedure(
    'public.delete_my_account()'
  );
  atomic_prepare_rpc := pg_catalog.to_regprocedure(
    'public.admin_prepare_account_deletion(uuid)'
  );
  IF legacy_delete_rpc IS NOT NULL AND (
    pg_catalog.has_function_privilege(
      'anon', legacy_delete_rpc, 'EXECUTE'
    )
    OR pg_catalog.has_function_privilege(
      'authenticated', legacy_delete_rpc, 'EXECUTE'
    )
    OR pg_catalog.has_function_privilege(
      'service_role', legacy_delete_rpc, 'EXECUTE'
    )
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.aclexplode(
        COALESCE(
          (
            SELECT function.proacl
            FROM pg_catalog.pg_proc AS function
            WHERE function.oid = legacy_delete_rpc
          ),
          pg_catalog.acldefault(
            'f',
            (
              SELECT function.proowner
              FROM pg_catalog.pg_proc AS function
              WHERE function.oid = legacy_delete_rpc
            )
          )
        )
      ) AS acl
      WHERE acl.grantee = 0
        AND acl.privilege_type = 'EXECUTE'
    )
  ) THEN
    RAISE EXCEPTION
      'verify_failed: legacy delete_my_account RPC remains callable';
  END IF;

  IF pg_catalog.to_regclass('public.account_deletion_jobs') IS NULL THEN
    RAISE EXCEPTION 'verify_failed: account_deletion_jobs missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class
    WHERE oid = 'public.account_deletion_jobs'::pg_catalog.regclass
      AND relrowsecurity
      AND NOT relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'verify_failed: account_deletion_jobs RLS disabled';
  END IF;

  SELECT count(*) INTO column_count
  FROM pg_catalog.pg_attribute
  WHERE attrelid = 'public.account_deletion_jobs'::pg_catalog.regclass
    AND attnum > 0
    AND NOT attisdropped;
  IF column_count <> 7 THEN
    RAISE EXCEPTION 'verify_failed: expected 7 deletion job columns, found %', column_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.account_deletion_jobs'::pg_catalog.regclass
      AND attname = 'user_id'
      AND atttypid = 'uuid'::pg_catalog.regtype
      AND attnotnull
  )
  OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute AS column_info
    JOIN pg_catalog.pg_attrdef AS default_info
      ON default_info.adrelid = column_info.attrelid
     AND default_info.adnum = column_info.attnum
    WHERE column_info.attrelid = 'public.account_deletion_jobs'::pg_catalog.regclass
      AND column_info.attname = 'stage'
      AND column_info.atttypid = 'text'::pg_catalog.regtype
      AND column_info.attnotnull
      AND pg_catalog.pg_get_expr(default_info.adbin, default_info.adrelid) = '''requested''::text'
  )
  OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.account_deletion_jobs'::pg_catalog.regclass
      AND attname IN ('wechat_openid', 'last_error', 'completed_at')
      AND attnotnull
  )
  OR (SELECT count(*) FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.account_deletion_jobs'::pg_catalog.regclass
        AND attname IN ('wechat_openid', 'last_error')
        AND atttypid = 'text'::pg_catalog.regtype
        AND NOT attisdropped) <> 2
  OR (SELECT count(*) FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.account_deletion_jobs'::pg_catalog.regclass
        AND attname IN ('requested_at', 'updated_at', 'completed_at')
        AND atttypid = 'timestamp with time zone'::pg_catalog.regtype
        AND NOT attisdropped) <> 3
  OR (SELECT count(*) FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.account_deletion_jobs'::pg_catalog.regclass
        AND attname IN ('requested_at', 'updated_at')
        AND attnotnull
        AND NOT attisdropped) <> 2
  OR (SELECT count(*)
      FROM pg_catalog.pg_attribute AS column_info
      JOIN pg_catalog.pg_attrdef AS default_info
        ON default_info.adrelid = column_info.attrelid
       AND default_info.adnum = column_info.attnum
      WHERE column_info.attrelid = 'public.account_deletion_jobs'::pg_catalog.regclass
        AND column_info.attname IN ('requested_at', 'updated_at')
        AND pg_catalog.pg_get_expr(default_info.adbin, default_info.adrelid) = 'now()') <> 2 THEN
    RAISE EXCEPTION 'verify_failed: deletion job column type/null/default contract';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.account_deletion_jobs'::pg_catalog.regclass
      AND conname = 'account_deletion_jobs_pkey'
      AND contype = 'p'
      AND convalidated
      AND conkey = ARRAY[
        (
          SELECT attnum FROM pg_catalog.pg_attribute
          WHERE attrelid = 'public.account_deletion_jobs'::pg_catalog.regclass
            AND attname = 'user_id'
            AND NOT attisdropped
        )
      ]::smallint[]
  ) THEN
    RAISE EXCEPTION 'verify_failed: deletion job primary key';
  END IF;

  SELECT count(*) INTO check_count
  FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.account_deletion_jobs'::pg_catalog.regclass
    AND contype = 'c'
    AND convalidated
    AND conname IN (
      'account_deletion_jobs_stage_check',
      'account_deletion_jobs_wechat_openid_check',
      'account_deletion_jobs_last_error_check',
      'account_deletion_jobs_completion_shape',
      'account_deletion_jobs_completed_secret_scrubbed'
    );
  IF check_count <> 5
     OR (SELECT count(*) FROM pg_catalog.pg_constraint
         WHERE conrelid = 'public.account_deletion_jobs'::pg_catalog.regclass
           AND contype = 'c') <> 5 THEN
    RAISE EXCEPTION 'verify_failed: deletion job check constraint set';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(oid) INTO STRICT constraint_definition
  FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.account_deletion_jobs'::pg_catalog.regclass
    AND conname = 'account_deletion_jobs_stage_check';
  IF constraint_definition !~ '''requested'''
     OR constraint_definition !~ '''storage_deleted'''
     OR constraint_definition !~ '''auth_deleted'''
     OR constraint_definition !~ '''completed'''
     OR length(constraint_definition) - length(replace(constraint_definition, '''', '')) <> 8 THEN
    RAISE EXCEPTION 'verify_failed: deletion job stage domain';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(oid) INTO STRICT constraint_definition
  FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.account_deletion_jobs'::pg_catalog.regclass
    AND conname = 'account_deletion_jobs_wechat_openid_check';
  IF constraint_definition !~* 'wechat_openid.*length'
     OR regexp_replace(constraint_definition, '[^0-9]', '', 'g') <> '4128' THEN
    RAISE EXCEPTION 'verify_failed: WeChat cleanup key bounds';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(oid) INTO STRICT constraint_definition
  FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.account_deletion_jobs'::pg_catalog.regclass
    AND conname = 'account_deletion_jobs_last_error_check';
  IF constraint_definition !~* 'last_error.*length'
     OR regexp_replace(constraint_definition, '[^0-9]', '', 'g') <> '160' THEN
    RAISE EXCEPTION 'verify_failed: deletion error bound';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(oid) INTO STRICT constraint_definition
  FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.account_deletion_jobs'::pg_catalog.regclass
    AND conname = 'account_deletion_jobs_completion_shape';
  IF constraint_definition !~* 'stage.*completed'
     OR constraint_definition !~* 'completed_at.*IS NOT NULL'
     OR constraint_definition !~* 'completed_at.*IS NULL' THEN
    RAISE EXCEPTION 'verify_failed: deletion completion shape';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(oid) INTO STRICT constraint_definition
  FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.account_deletion_jobs'::pg_catalog.regclass
    AND conname = 'account_deletion_jobs_completed_secret_scrubbed';
  IF constraint_definition !~* 'stage.*completed'
     OR constraint_definition !~* 'wechat_openid.*IS NULL' THEN
    RAISE EXCEPTION 'verify_failed: completed WeChat key scrub';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.account_deletion_jobs'::pg_catalog.regclass
      AND contype = 'f'
  ) THEN
    RAISE EXCEPTION 'verify_failed: deletion job must survive Auth/profile cascades';
  END IF;

  IF (SELECT count(*) FROM pg_catalog.pg_policy
      WHERE polrelid = 'public.account_deletion_jobs'::pg_catalog.regclass) <> 0 THEN
    RAISE EXCEPTION 'verify_failed: account_deletion_jobs must have no browser RLS policies';
  END IF;

  FOREACH browser_role IN ARRAY ARRAY['anon'::name, 'authenticated'::name] LOOP
    IF pg_catalog.has_table_privilege(browser_role, 'public.account_deletion_jobs', 'SELECT')
       OR pg_catalog.has_table_privilege(browser_role, 'public.account_deletion_jobs', 'INSERT')
       OR pg_catalog.has_table_privilege(browser_role, 'public.account_deletion_jobs', 'UPDATE')
       OR pg_catalog.has_table_privilege(browser_role, 'public.account_deletion_jobs', 'DELETE')
       OR pg_catalog.has_table_privilege(browser_role, 'public.account_deletion_jobs', 'TRUNCATE')
       OR pg_catalog.has_table_privilege(browser_role, 'public.account_deletion_jobs', 'REFERENCES')
       OR pg_catalog.has_table_privilege(browser_role, 'public.account_deletion_jobs', 'TRIGGER') THEN
      RAISE EXCEPTION 'verify_failed: % can access account_deletion_jobs', browser_role;
    END IF;
  END LOOP;

  IF NOT pg_catalog.has_table_privilege('service_role', 'public.account_deletion_jobs', 'SELECT')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.account_deletion_jobs', 'UPDATE')
     OR (
       atomic_prepare_rpc IS NULL
       AND NOT pg_catalog.has_table_privilege(
         'service_role', 'public.account_deletion_jobs', 'INSERT'
       )
     )
     OR (
       atomic_prepare_rpc IS NOT NULL
       AND pg_catalog.has_table_privilege(
         'service_role', 'public.account_deletion_jobs', 'INSERT'
       )
     )
     OR pg_catalog.has_table_privilege('service_role', 'public.account_deletion_jobs', 'DELETE')
     OR pg_catalog.has_table_privilege('service_role', 'public.account_deletion_jobs', 'TRUNCATE')
     OR pg_catalog.has_table_privilege('service_role', 'public.account_deletion_jobs', 'REFERENCES')
     OR pg_catalog.has_table_privilege('service_role', 'public.account_deletion_jobs', 'TRIGGER') THEN
    RAISE EXCEPTION 'verify_failed: service_role deletion job grant set';
  END IF;

  helper_oid := pg_catalog.to_regprocedure(
    'private.current_account_storage_writes_allowed()'
  );
  IF helper_oid IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid = helper_oid
      AND function.prorettype = 'boolean'::pg_catalog.regtype
      AND function.pronargs = 0
      AND function.provolatile = 's'
      AND function.prosecdef
      AND function.proowner = (
        SELECT relation.relowner
        FROM pg_catalog.pg_class AS relation
        WHERE relation.oid = 'public.account_deletion_jobs'::pg_catalog.regclass
          AND NOT relation.relforcerowsecurity
      )
      AND COALESCE(function.proconfig, ARRAY[]::text[])
        = ARRAY['search_path=pg_catalog']::text[]
  ) THEN
    RAISE EXCEPTION 'verify_failed: Storage tombstone helper security shape';
  END IF;

  IF NOT pg_catalog.has_schema_privilege('authenticated', 'private', 'USAGE')
     OR pg_catalog.has_schema_privilege('anon', 'private', 'USAGE')
     OR NOT pg_catalog.has_function_privilege('authenticated', helper_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', helper_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', helper_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'verify_failed: Storage tombstone helper ACL';
  END IF;

  IF pg_catalog.to_regclass('storage.objects') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class
    WHERE oid = 'storage.objects'::pg_catalog.regclass
      AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'verify_failed: storage.objects missing or RLS disabled';
  END IF;

  SELECT * INTO insert_policy
  FROM pg_catalog.pg_policy
  WHERE polrelid = 'storage.objects'::pg_catalog.regclass
    AND polname = 'account_deletion_tombstone_blocks_item_image_insert';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'verify_failed: Storage tombstone INSERT policy missing';
  END IF;

  SELECT * INTO update_policy
  FROM pg_catalog.pg_policy
  WHERE polrelid = 'storage.objects'::pg_catalog.regclass
    AND polname = 'account_deletion_tombstone_blocks_item_image_update';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'verify_failed: Storage tombstone UPDATE policy missing';
  END IF;

  IF insert_policy.polpermissive
     OR insert_policy.polcmd <> 'a'
     OR insert_policy.polroles <> ARRAY['authenticated'::pg_catalog.regrole::oid]
     OR insert_policy.polqual IS NOT NULL
     OR insert_policy.polwithcheck IS NULL
     OR update_policy.polpermissive
     OR update_policy.polcmd <> 'w'
     OR update_policy.polroles <> ARRAY['authenticated'::pg_catalog.regrole::oid]
     OR update_policy.polqual IS NULL
     OR update_policy.polwithcheck IS NULL THEN
    RAISE EXCEPTION 'verify_failed: Storage tombstone restrictive policy shape';
  END IF;

  insert_check := pg_catalog.pg_get_expr(
    insert_policy.polwithcheck,
    insert_policy.polrelid
  );
  update_using := pg_catalog.pg_get_expr(
    update_policy.polqual,
    update_policy.polrelid
  );
  update_check := pg_catalog.pg_get_expr(
    update_policy.polwithcheck,
    update_policy.polrelid
  );
  IF insert_check <>
       '((bucket_id <> ''item-images''::text) OR private.current_account_storage_writes_allowed())'
     OR update_using <>
       '((bucket_id <> ''item-images''::text) OR private.current_account_storage_writes_allowed())'
     OR update_check <>
       '((bucket_id <> ''item-images''::text) OR private.current_account_storage_writes_allowed())' THEN
    RAISE EXCEPTION 'verify_failed: Storage tombstone policy predicate';
  END IF;

  IF NOT pg_catalog.has_table_privilege('service_role', 'public.wechat_password_map', 'DELETE')
     OR pg_catalog.has_table_privilege('anon', 'public.wechat_password_map', 'DELETE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.wechat_password_map', 'DELETE') THEN
    RAISE EXCEPTION 'verify_failed: WeChat map DELETE grants';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS deletion_index
    JOIN pg_catalog.pg_class AS index_class
      ON index_class.oid = deletion_index.indexrelid
    JOIN pg_catalog.pg_am AS access_method
      ON access_method.oid = index_class.relam
    WHERE deletion_index.indrelid = 'public.account_deletion_jobs'::pg_catalog.regclass
      AND index_class.relname = 'account_deletion_jobs_pending_updated_idx'
      AND access_method.amname = 'btree'
      AND NOT deletion_index.indisunique
      AND deletion_index.indnkeyatts = 1
      AND (deletion_index.indkey::smallint[])[0] = (
        (
          SELECT attnum FROM pg_catalog.pg_attribute
          WHERE attrelid = 'public.account_deletion_jobs'::pg_catalog.regclass
            AND attname = 'updated_at'
            AND NOT attisdropped
        )
      )
      AND deletion_index.indpred IS NOT NULL
      AND pg_catalog.pg_get_expr(
        deletion_index.indpred,
        deletion_index.indrelid
      ) ~* 'stage.*<>.*completed'
  ) THEN
    RAISE EXCEPTION 'verify_failed: pending deletion job index shape';
  END IF;
END
$verify$;

ROLLBACK;
