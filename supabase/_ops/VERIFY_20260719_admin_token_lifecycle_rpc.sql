-- Read-only post-deploy verification for atomic administrator token lifecycle.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $verify$
DECLARE
  wrapper_oid oid := pg_catalog.to_regprocedure(
    'public.admin_execute_mutation(text,uuid,text,text,jsonb)'
  );
  lifecycle_oid oid := pg_catalog.to_regprocedure(
    'public.admin_execute_token_lifecycle(text,uuid,text,text,jsonb)'
  );
  legacy_oid oid := pg_catalog.to_regprocedure(
    'public.admin_execute_mutation_pre_token_lifecycle(text,uuid,text,text,jsonb)'
  );
  evidence_oid oid := pg_catalog.to_regprocedure(
    'public.admin_lifecycle_evidence_valid(text)'
  );
  prepare_oid oid := pg_catalog.to_regprocedure(
    'public.admin_prepare_account_deletion(uuid)'
  );
  profile_delete_lock_oid oid := pg_catalog.to_regprocedure(
    'public.admin_lock_profile_deletion_recovery()'
  );
  reconcile_oid oid := pg_catalog.to_regprocedure(
    'public.admin_reconcile_issued_token(text)'
  );
  outcome_reconcile_oid oid := pg_catalog.to_regprocedure(
    'public.admin_reconcile_idempotency_outcome(text,uuid)'
  );
  mutation_fence_lock_oid oid := pg_catalog.to_regprocedure(
    'public.admin_lock_mutation_idempotency_reconciliation()'
  );
  banner_fence_lock_oid oid := pg_catalog.to_regprocedure(
    'public.admin_lock_banner_idempotency_reconciliation()'
  );
  fence_reject_oid oid := pg_catalog.to_regprocedure(
    'public.admin_reject_fenced_idempotency_key()'
  );
  upload_prepare_oid oid := pg_catalog.to_regprocedure(
    'public.admin_prepare_banner_upload(text,uuid,text,text,integer)'
  );
  upload_prepare_legacy_oid oid := pg_catalog.to_regprocedure(
    'public.admin_prepare_banner_upload_pre_idempotency_fence(text,uuid,text,text,integer)'
  );
  upload_complete_oid oid := pg_catalog.to_regprocedure(
    'public.admin_complete_banner_upload(text,uuid,text)'
  );
  upload_complete_legacy_oid oid := pg_catalog.to_regprocedure(
    'public.admin_complete_banner_upload_pre_idempotency_fence(text,uuid,text)'
  );
  authorization_oid oid := pg_catalog.to_regprocedure(
    'public.admin_token_authorization(text)'
  );
  inventory_oid oid := pg_catalog.to_regprocedure(
    'public.admin_token_inventory()'
  );
  owner_recoverable_oid oid := pg_catalog.to_regprocedure(
    'public.admin_owner_token_recoverable(uuid,text,timestamptz,timestamptz,timestamptz)'
  );
  revoke_guard_oid oid := pg_catalog.to_regprocedure(
    'public.admin_assert_token_revoke_allowed(uuid,uuid)'
  );
  recovery_guard_oid oid := pg_catalog.to_regprocedure(
    'public.admin_protect_recovery_tokens()'
  );
  token_statement_lock_oid oid := pg_catalog.to_regprocedure(
    'public.admin_lock_token_recovery_mutation()'
  );
  wrapper_source text;
  lifecycle_source text;
  prepare_source text;
  detach_source text;
  profile_delete_lock_source text;
  reconcile_source text;
  outcome_reconcile_source text;
  mutation_fence_lock_source text;
  banner_fence_lock_source text;
  fence_reject_source text;
  upload_prepare_source text;
  upload_complete_source text;
  authorization_source text;
  owner_recoverable_source text;
  revoke_guard_source text;
  recovery_guard_source text;
  token_statement_lock_source text;
  authorization_result text;
  inventory_result text;
  reconcile_result text;
  audit_check text;
  actor_fk_delete_action "char";
  banner_actor_fk_delete_action "char";
  profile_insert_columns text[];
BEGIN
  IF wrapper_oid IS NULL OR lifecycle_oid IS NULL OR legacy_oid IS NULL
     OR evidence_oid IS NULL OR prepare_oid IS NULL
     OR profile_delete_lock_oid IS NULL
     OR reconcile_oid IS NULL
     OR outcome_reconcile_oid IS NULL
     OR mutation_fence_lock_oid IS NULL
     OR banner_fence_lock_oid IS NULL
     OR fence_reject_oid IS NULL
     OR upload_prepare_oid IS NULL OR upload_prepare_legacy_oid IS NULL
     OR upload_complete_oid IS NULL OR upload_complete_legacy_oid IS NULL
     OR authorization_oid IS NULL OR inventory_oid IS NULL
     OR owner_recoverable_oid IS NULL OR revoke_guard_oid IS NULL
     OR recovery_guard_oid IS NULL OR token_statement_lock_oid IS NULL THEN
    RAISE EXCEPTION 'verify_failed: lifecycle/prepare/non-secret access function missing';
  END IF;

  IF NOT pg_catalog.has_function_privilege('service_role', wrapper_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', wrapper_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', wrapper_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', lifecycle_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', lifecycle_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', lifecycle_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', legacy_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', legacy_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', legacy_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', prepare_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', prepare_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', prepare_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'verify_failed: public wrapper/internal helper ACL mismatch';
  END IF;
  IF pg_catalog.has_function_privilege('service_role', evidence_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', evidence_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', evidence_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
       'service_role', profile_delete_lock_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon', profile_delete_lock_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', profile_delete_lock_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', owner_recoverable_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon', owner_recoverable_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', owner_recoverable_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', revoke_guard_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon', revoke_guard_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', revoke_guard_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', recovery_guard_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon', recovery_guard_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', recovery_guard_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', token_statement_lock_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon', token_statement_lock_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', token_statement_lock_oid, 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'verify_failed: internal lifecycle evidence validator is exposed';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
       'service_role', outcome_reconcile_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon', outcome_reconcile_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', outcome_reconcile_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', mutation_fence_lock_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', banner_fence_lock_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', fence_reject_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon', mutation_fence_lock_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon', banner_fence_lock_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon', fence_reject_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', mutation_fence_lock_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', banner_fence_lock_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', fence_reject_oid, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'service_role', upload_prepare_oid, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'service_role', upload_complete_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon', upload_prepare_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', upload_prepare_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon', upload_complete_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', upload_complete_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', upload_prepare_legacy_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', upload_complete_legacy_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon', upload_prepare_legacy_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', upload_prepare_legacy_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon', upload_complete_legacy_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', upload_complete_legacy_oid, 'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'verify_failed: idempotency reconciliation RPC/internal trigger ACL drifted';
  END IF;

  IF pg_catalog.has_table_privilege('service_role', 'public.admin_tokens', 'SELECT')
     OR pg_catalog.has_table_privilege('service_role', 'public.admin_tokens', 'INSERT')
     OR pg_catalog.has_table_privilege('service_role', 'public.admin_tokens', 'UPDATE')
     OR pg_catalog.has_table_privilege('service_role', 'public.admin_tokens', 'DELETE')
     OR pg_catalog.has_table_privilege('service_role', 'public.admin_tokens', 'TRUNCATE')
     OR pg_catalog.has_table_privilege('service_role', 'public.admin_tokens', 'REFERENCES')
     OR pg_catalog.has_table_privilege('service_role', 'public.admin_tokens', 'TRIGGER')
     OR pg_catalog.has_any_column_privilege(
       'service_role', 'public.admin_tokens', 'SELECT,INSERT,UPDATE,REFERENCES'
     )
     OR pg_catalog.has_table_privilege(
       'anon', 'public.admin_tokens', 'SELECT,INSERT,UPDATE,DELETE'
     )
     OR pg_catalog.has_table_privilege(
       'authenticated', 'public.admin_tokens', 'SELECT,INSERT,UPDATE,DELETE'
     ) THEN
    RAISE EXCEPTION 'verify_failed: raw admin token table privilege remains';
  END IF;

  IF pg_catalog.has_table_privilege(
       'service_role', 'public.account_deletion_jobs', 'INSERT'
     ) THEN
    RAISE EXCEPTION 'verify_failed: raw account deletion job INSERT bypass remains';
  END IF;

  IF pg_catalog.has_table_privilege(
       'service_role',
       'public.admin_idempotency_reconciliation_fences',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     OR pg_catalog.has_any_column_privilege(
       'service_role',
       'public.admin_idempotency_reconciliation_fences',
       'SELECT,INSERT,UPDATE,REFERENCES'
     )
     OR pg_catalog.has_table_privilege(
       'anon',
       'public.admin_idempotency_reconciliation_fences',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     OR pg_catalog.has_table_privilege(
       'authenticated',
       'public.admin_idempotency_reconciliation_fences',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     OR pg_catalog.has_table_privilege(
       'service_role', 'public.admin_mutation_requests',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     OR pg_catalog.has_table_privilege(
       'service_role', 'public.admin_banner_uploads',
       'SELECT,INSERT,UPDATE,DELETE'
     ) THEN
    RAISE EXCEPTION
      'verify_failed: raw idempotency fence/ledger privilege remains';
  END IF;

  SELECT pg_catalog.array_agg(column_row.attname ORDER BY column_row.attname)
    INTO profile_insert_columns
    FROM pg_catalog.pg_attribute AS column_row
   WHERE column_row.attrelid = 'public.profiles'::pg_catalog.regclass
     AND column_row.attnum > 0
     AND NOT column_row.attisdropped
     AND pg_catalog.has_column_privilege(
       'authenticated',
       'public.profiles',
       column_row.attname,
       'INSERT'
     );
  IF pg_catalog.has_table_privilege(
       'authenticated', 'public.profiles', 'INSERT'
     )
     OR pg_catalog.has_any_column_privilege(
       'anon', 'public.profiles', 'INSERT'
     )
     OR profile_insert_columns IS DISTINCT FROM ARRAY[
       'avatar_url', 'bio', 'id', 'location', 'nickname',
       'status_emoji', 'status_text'
     ]::text[] THEN
    RAISE EXCEPTION
      'verify_failed: exact authenticated profile recovery INSERT ACL drifted: %',
      profile_insert_columns;
  END IF;

  IF NOT pg_catalog.has_function_privilege(
       'service_role', authorization_oid, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'service_role', inventory_oid, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'service_role', reconcile_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege('anon', authorization_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', authorization_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', inventory_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', inventory_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', reconcile_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
       'authenticated', reconcile_oid, 'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'verify_failed: non-secret admin authorization/inventory/reconciliation ACL drifted';
  END IF;

  authorization_result := pg_catalog.pg_get_function_result(authorization_oid);
  inventory_result := pg_catalog.pg_get_function_result(inventory_oid);
  reconcile_result := pg_catalog.pg_get_function_result(reconcile_oid);
  IF pg_catalog.strpos(authorization_result, 'token_hash') > 0
     OR pg_catalog.strpos(inventory_result, 'token_hash') > 0
     OR pg_catalog.strpos(inventory_result, 'last_used_at') = 0
     OR pg_catalog.strpos(reconcile_result, 'token_hash') > 0
     OR pg_catalog.strpos(reconcile_result, 'admin_name') > 0
     OR pg_catalog.strpos(reconcile_result, 'admin_email') > 0
     OR pg_catalog.strpos(reconcile_result, 'created_by') > 0 THEN
    RAISE EXCEPTION
      'verify_failed: non-secret admin access function exposes secret/PII';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS function_row
     WHERE function_row.oid = owner_recoverable_oid
       AND NOT function_row.prosecdef
       AND function_row.provolatile = 'v'
       AND NOT function_row.proretset
       AND function_row.prorettype = 'boolean'::pg_catalog.regtype
       AND function_row.pronargs = 5
       AND function_row.proargtypes = ARRAY[
         'uuid'::pg_catalog.regtype::oid,
         'text'::pg_catalog.regtype::oid,
         'timestamptz'::pg_catalog.regtype::oid,
         'timestamptz'::pg_catalog.regtype::oid,
         'timestamptz'::pg_catalog.regtype::oid
       ]::oidvector
       AND COALESCE(function_row.proconfig, ARRAY[]::text[])
           = ARRAY['search_path=pg_catalog']::text[]
  ) THEN
    RAISE EXCEPTION
      'verify_failed: verified owner recovery predicate signature/security shape';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS function_row
     WHERE function_row.oid = reconcile_oid
       AND function_row.prosecdef
       AND function_row.provolatile = 's'
       AND function_row.proretset
       AND function_row.prorettype = 'record'::pg_catalog.regtype
       AND function_row.pronargs = 1
       AND function_row.proargtypes[0] = 'text'::pg_catalog.regtype::oid
       AND function_row.proargnames = ARRAY[
         'p_token_hash', 'id', 'admin_id', 'role', 'expires_at', 'revoked_at'
       ]::text[]
       AND function_row.proargmodes = ARRAY[
         'i'::"char", 't'::"char", 't'::"char",
         't'::"char", 't'::"char", 't'::"char"
       ]::"char"[]
       AND function_row.proallargtypes = ARRAY[
         'text'::pg_catalog.regtype::oid,
         'uuid'::pg_catalog.regtype::oid,
         'uuid'::pg_catalog.regtype::oid,
         'text'::pg_catalog.regtype::oid,
         'timestamptz'::pg_catalog.regtype::oid,
         'timestamptz'::pg_catalog.regtype::oid
       ]::oid[]
       AND COALESCE(function_row.proconfig, ARRAY[]::text[])
           = ARRAY['search_path=pg_catalog']::text[]
  ) THEN
    RAISE EXCEPTION 'verify_failed: token reconciliation signature/projection shape';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS function_row
     WHERE function_row.oid = outcome_reconcile_oid
       AND function_row.prosecdef
       AND function_row.provolatile = 'v'
       AND NOT function_row.proretset
       AND function_row.prorettype = 'jsonb'::pg_catalog.regtype
       AND function_row.pronargs = 2
       AND function_row.proargtypes = ARRAY[
         'text'::pg_catalog.regtype::oid,
         'uuid'::pg_catalog.regtype::oid
       ]::oidvector
       AND function_row.proargnames = ARRAY[
         'p_token_hash', 'p_idempotency_key'
       ]::text[]
       AND COALESCE(function_row.proconfig, ARRAY[]::text[])
           = ARRAY['search_path=pg_catalog']::text[]
  ) THEN
    RAISE EXCEPTION
      'verify_failed: idempotency outcome reconciliation signature/security shape';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS function_row
     WHERE function_row.oid IN (
       mutation_fence_lock_oid, banner_fence_lock_oid, fence_reject_oid
     )
       AND (
         NOT function_row.prosecdef
         OR function_row.provolatile <> 'v'
         OR function_row.prorettype <> 'trigger'::pg_catalog.regtype
         OR function_row.pronargs <> 0
         OR COALESCE(function_row.proconfig, ARRAY[]::text[])
            <> ARRAY['search_path=pg_catalog']::text[]
       )
  ) THEN
    RAISE EXCEPTION
      'verify_failed: idempotency reconciliation trigger function shape';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS function_row
     WHERE function_row.oid IN (upload_prepare_oid, upload_complete_oid)
       AND (
         NOT function_row.prosecdef
         OR function_row.provolatile <> 'v'
         OR function_row.prorettype <> 'jsonb'::pg_catalog.regtype
         OR COALESCE(function_row.proconfig, ARRAY[]::text[])
            <> ARRAY['search_path=pg_catalog']::text[]
       )
  ) THEN
    RAISE EXCEPTION
      'verify_failed: banner upload lock wrapper security/return shape';
  END IF;

  IF NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_class AS table_row
        WHERE table_row.oid =
              'public.admin_idempotency_reconciliation_fences'::pg_catalog.regclass
          AND table_row.relkind = 'r'
          AND table_row.relrowsecurity
     )
     OR (
       SELECT pg_catalog.count(*)
         FROM pg_catalog.pg_attribute AS column_row
        WHERE column_row.attrelid =
              'public.admin_idempotency_reconciliation_fences'::pg_catalog.regclass
          AND column_row.attnum > 0
          AND NOT column_row.attisdropped
     ) <> 3
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_attribute AS column_row
        WHERE column_row.attrelid =
              'public.admin_idempotency_reconciliation_fences'::pg_catalog.regclass
          AND column_row.attnum = 1
          AND column_row.attname = 'idempotency_key'
          AND column_row.atttypid = 'uuid'::pg_catalog.regtype
          AND column_row.attnotnull
     )
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_attribute AS column_row
        WHERE column_row.attrelid =
              'public.admin_idempotency_reconciliation_fences'::pg_catalog.regclass
          AND column_row.attnum = 2
          AND column_row.attname = 'reconciled_by'
          AND column_row.atttypid = 'uuid'::pg_catalog.regtype
          AND column_row.attnotnull
     )
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_attribute AS column_row
         JOIN pg_catalog.pg_attrdef AS default_row
           ON default_row.adrelid = column_row.attrelid
          AND default_row.adnum = column_row.attnum
        WHERE column_row.attrelid =
              'public.admin_idempotency_reconciliation_fences'::pg_catalog.regclass
          AND column_row.attnum = 3
          AND column_row.attname = 'reconciled_at'
          AND column_row.atttypid = 'timestamptz'::pg_catalog.regtype
          AND column_row.attnotnull
          AND pg_catalog.pg_get_expr(
                default_row.adbin,
                default_row.adrelid
              ) = 'now()'
     ) THEN
    RAISE EXCEPTION
      'verify_failed: exact minimal idempotency reconciliation fence table shape';
  END IF;

  IF (
       SELECT pg_catalog.count(*)
         FROM pg_catalog.pg_constraint AS constraint_row
        WHERE constraint_row.conrelid =
              'public.admin_idempotency_reconciliation_fences'::pg_catalog.regclass
          AND constraint_row.contype = 'p'
          AND constraint_row.convalidated
          AND constraint_row.conkey = ARRAY[1]::smallint[]
     ) <> 1
     OR (
       SELECT pg_catalog.count(*)
         FROM pg_catalog.pg_constraint AS constraint_row
        WHERE constraint_row.conrelid =
              'public.admin_idempotency_reconciliation_fences'::pg_catalog.regclass
          AND constraint_row.contype = 'f'
          AND constraint_row.confrelid = 'public.admin_tokens'::pg_catalog.regclass
          AND constraint_row.convalidated
          AND constraint_row.confdeltype = 'r'
          AND constraint_row.conkey = ARRAY[2]::smallint[]
     ) <> 1
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_policy AS policy_row
        WHERE policy_row.polrelid =
              'public.admin_idempotency_reconciliation_fences'::pg_catalog.regclass
     ) THEN
    RAISE EXCEPTION
      'verify_failed: idempotency reconciliation fence key/FK/RLS boundary';
  END IF;

  IF NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_index AS index_row
         JOIN pg_catalog.pg_attribute AS column_row
           ON column_row.attrelid = index_row.indrelid
          AND column_row.attname = 'idempotency_key'
          AND NOT column_row.attisdropped
        WHERE index_row.indexrelid =
              'public.admin_mutation_requests_idempotency_key_idx'::pg_catalog.regclass
          AND index_row.indrelid =
              'public.admin_mutation_requests'::pg_catalog.regclass
          AND index_row.indisvalid
          AND index_row.indisready
          AND NOT index_row.indisunique
          AND index_row.indnkeyatts = 1
          AND index_row.indnatts = 1
          AND index_row.indkey[0] = column_row.attnum
          AND index_row.indpred IS NULL
          AND index_row.indexprs IS NULL
     )
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_index AS index_row
         JOIN pg_catalog.pg_attribute AS column_row
           ON column_row.attrelid = index_row.indrelid
          AND column_row.attname = 'idempotency_key'
          AND NOT column_row.attisdropped
        WHERE index_row.indexrelid =
              'public.admin_banner_uploads_idempotency_key_idx'::pg_catalog.regclass
          AND index_row.indrelid =
              'public.admin_banner_uploads'::pg_catalog.regclass
          AND index_row.indisvalid
          AND index_row.indisready
          AND NOT index_row.indisunique
          AND index_row.indnkeyatts = 1
          AND index_row.indnatts = 1
          AND index_row.indkey[0] = column_row.attnum
          AND index_row.indpred IS NULL
          AND index_row.indexprs IS NULL
     ) THEN
    RAISE EXCEPTION
      'verify_failed: cross-token idempotency lookup index shape';
  END IF;

  IF NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_trigger AS trigger_row
        WHERE trigger_row.tgrelid =
              'public.admin_mutation_requests'::pg_catalog.regclass
          AND trigger_row.tgname =
              'admin_mutation_requests_00_lock_idempotency_reconciliation'
          AND trigger_row.tgfoid = mutation_fence_lock_oid
          AND trigger_row.tgtype = 30
          AND trigger_row.tgenabled = 'O'
          AND NOT trigger_row.tgisinternal
     )
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_trigger AS trigger_row
        WHERE trigger_row.tgrelid =
              'public.admin_banner_uploads'::pg_catalog.regclass
          AND trigger_row.tgname =
              'admin_banner_uploads_00_lock_idempotency_reconciliation'
          AND trigger_row.tgfoid = banner_fence_lock_oid
          AND trigger_row.tgtype = 30
          AND trigger_row.tgenabled = 'O'
          AND NOT trigger_row.tgisinternal
     )
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_trigger AS trigger_row
        WHERE trigger_row.tgrelid =
              'public.admin_mutation_requests'::pg_catalog.regclass
          AND trigger_row.tgname =
              'admin_mutation_requests_01_reject_fenced_idempotency_key'
          AND trigger_row.tgfoid = fence_reject_oid
          AND trigger_row.tgtype = 23
          AND trigger_row.tgenabled = 'O'
          AND NOT trigger_row.tgisinternal
     )
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_trigger AS trigger_row
        WHERE trigger_row.tgrelid =
              'public.admin_banner_uploads'::pg_catalog.regclass
          AND trigger_row.tgname =
              'admin_banner_uploads_01_reject_fenced_idempotency_key'
          AND trigger_row.tgfoid = fence_reject_oid
          AND trigger_row.tgtype = 23
          AND trigger_row.tgenabled = 'O'
          AND NOT trigger_row.tgisinternal
     ) THEN
    RAISE EXCEPTION
      'verify_failed: authoritative idempotency fence trigger topology';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS function_row
     WHERE function_row.oid = prepare_oid
       AND function_row.prosecdef
       AND function_row.prorettype = 'jsonb'::pg_catalog.regtype
       AND function_row.pronargs = 1
       AND function_row.proargtypes[0] = 'uuid'::pg_catalog.regtype::oid
       AND COALESCE(function_row.proconfig, ARRAY[]::text[])
           = ARRAY['search_path=pg_catalog']::text[]
  ) THEN
    RAISE EXCEPTION 'verify_failed: account deletion prepare security/signature shape';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS function_row
     WHERE function_row.oid = profile_delete_lock_oid
       AND function_row.prosecdef
       AND function_row.prorettype = 'trigger'::pg_catalog.regtype
       AND function_row.pronargs = 0
       AND COALESCE(function_row.proconfig, ARRAY[]::text[])
           = ARRAY['search_path=pg_catalog']::text[]
  ) THEN
    RAISE EXCEPTION 'verify_failed: profile deletion lock trigger function shape';
  END IF;

  SELECT constraint_row.confdeltype
    INTO banner_actor_fk_delete_action
    FROM pg_catalog.pg_constraint AS constraint_row
   WHERE constraint_row.conrelid =
         'public.admin_banner_uploads'::pg_catalog.regclass
     AND constraint_row.conname =
         'admin_banner_uploads_actor_id_profiles_fkey_v2'
     AND constraint_row.contype = 'f'
     AND constraint_row.convalidated;
  IF banner_actor_fk_delete_action IS DISTINCT FROM 'n'
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_attribute AS column_row
        WHERE column_row.attrelid =
              'public.admin_banner_uploads'::pg_catalog.regclass
          AND column_row.attname = 'actor_id'
          AND column_row.attnotnull
          AND NOT column_row.attisdropped
     )
     OR (
       SELECT pg_catalog.count(*)
         FROM pg_catalog.pg_constraint AS constraint_row
        WHERE constraint_row.conrelid =
              'public.admin_banner_uploads'::pg_catalog.regclass
          AND constraint_row.contype = 'f'
          AND constraint_row.confrelid = 'public.profiles'::pg_catalog.regclass
          AND constraint_row.conkey = ARRAY[
            (
              SELECT column_row.attnum
                FROM pg_catalog.pg_attribute AS column_row
               WHERE column_row.attrelid =
                     'public.admin_banner_uploads'::pg_catalog.regclass
                 AND column_row.attname = 'actor_id'
                 AND NOT column_row.attisdropped
            )
          ]
     ) <> 1 THEN
    RAISE EXCEPTION 'verify_failed: retained banner upload actor FK boundary missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid = 'public.profiles'::pg_catalog.regclass
       AND trigger_row.tgname = 'profiles_00_lock_admin_recovery_before_delete'
       AND trigger_row.tgfoid = profile_delete_lock_oid
       AND trigger_row.tgtype = 10
       AND trigger_row.tgenabled = 'O'
       AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION 'verify_failed: profile deletion pre-row lock trigger missing';
  END IF;

  SELECT constraint_row.confdeltype
    INTO actor_fk_delete_action
    FROM pg_catalog.pg_constraint AS constraint_row
   WHERE constraint_row.conrelid = 'public.admin_tokens'::pg_catalog.regclass
     AND constraint_row.conname = 'admin_tokens_admin_id_profiles_fkey_v3'
     AND constraint_row.contype = 'f'
     AND constraint_row.convalidated;
  IF actor_fk_delete_action IS DISTINCT FROM 'n'
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_attribute AS column_row
        WHERE column_row.attrelid = 'public.admin_tokens'::pg_catalog.regclass
          AND column_row.attname = 'admin_id'
          AND column_row.attnotnull
          AND NOT column_row.attisdropped
     )
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_constraint AS constraint_row
        WHERE constraint_row.conrelid = 'public.admin_tokens'::pg_catalog.regclass
          AND constraint_row.conname = 'admin_tokens_detached_revoked_check'
          AND constraint_row.contype = 'c'
          AND constraint_row.convalidated
          AND pg_catalog.strpos(
            pg_catalog.pg_get_constraintdef(constraint_row.oid),
            'admin_id IS NOT NULL'
          ) > 0
          AND pg_catalog.strpos(
            pg_catalog.pg_get_constraintdef(constraint_row.oid),
            'revoked_at IS NOT NULL'
          ) > 0
     ) THEN
    RAISE EXCEPTION 'verify_failed: detached token evidence FK/check boundary missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid = 'public.admin_tokens'::pg_catalog.regclass
       AND trigger_row.tgname = 'admin_tokens_00_detach_profile'
       AND trigger_row.tgfoid = pg_catalog.to_regprocedure(
         'public.admin_detach_profile_token()'
       )
       AND trigger_row.tgenabled = 'O'
       AND NOT trigger_row.tgisinternal
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid = 'public.admin_tokens'::pg_catalog.regclass
       AND trigger_row.tgname = 'admin_tokens_protect_recovery'
       AND (trigger_row.tgattr::smallint[])
           @> ARRAY[
             (
               SELECT column_row.attnum::smallint
                 FROM pg_catalog.pg_attribute AS column_row
                WHERE column_row.attrelid =
                      'public.admin_tokens'::pg_catalog.regclass
                  AND column_row.attname = 'admin_id'
                  AND NOT column_row.attisdropped
             )
           ]::smallint[]
       AND trigger_row.tgenabled = 'O'
       AND NOT trigger_row.tgisinternal
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid = 'public.admin_tokens'::pg_catalog.regclass
       AND trigger_row.tgname = 'admin_tokens_00_lock_recovery_mutation'
       AND trigger_row.tgfoid = token_statement_lock_oid
       AND trigger_row.tgtype = 26
       AND trigger_row.tgenabled = 'O'
       AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION
      'verify_failed: detach/recovery/statement-level token lock-order fence boundary missing';
  END IF;

  IF EXISTS (
    WITH expected(admin_role, action) AS (
      VALUES
        ('operator', 'apply_ban'),
        ('operator', 'lift_suspension'),
        ('operator', 'update_report_status'),
        ('operator', 'resolve_target_reports'),
        ('operator', 'takedown_content'),
        ('security_admin', 'revoke_token'),
        ('security_admin', 'revoke_admin_tokens'),
        ('owner', 'apply_ban'),
        ('owner', 'lift_suspension'),
        ('owner', 'update_report_status'),
        ('owner', 'resolve_target_reports'),
        ('owner', 'takedown_content'),
        ('owner', 'set_post_pinned'),
        ('owner', 'upsert_banner'),
        ('owner', 'delete_banner'),
        ('owner', 'revoke_token'),
        ('owner', 'upload_banner'),
        ('owner', 'issue_token'),
        ('owner', 'revoke_admin_tokens')
    ), differences AS (
      (SELECT expected.admin_role, expected.action FROM expected
       EXCEPT
       SELECT capability.admin_role, capability.action
         FROM public.admin_role_action_capabilities AS capability)
      UNION ALL
      (SELECT capability.admin_role, capability.action
         FROM public.admin_role_action_capabilities AS capability
       EXCEPT
       SELECT expected.admin_role, expected.action FROM expected)
    )
    SELECT 1 FROM differences
  ) THEN
    RAISE EXCEPTION 'verify_failed: exact lifecycle role/action mapping drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.admin_role_action_capabilities AS capability
     WHERE capability.admin_role = 'security_admin'
       AND capability.action = 'issue_token'
  ) THEN
    RAISE EXCEPTION 'verify_failed: security_admin can issue persistent credentials';
  END IF;

  SELECT function_row.prosrc INTO wrapper_source
    FROM pg_catalog.pg_proc AS function_row
   WHERE function_row.oid = wrapper_oid;
  SELECT function_row.prosrc INTO lifecycle_source
    FROM pg_catalog.pg_proc AS function_row
   WHERE function_row.oid = lifecycle_oid;
  SELECT function_row.prosrc INTO prepare_source
    FROM pg_catalog.pg_proc AS function_row
   WHERE function_row.oid = prepare_oid;
  SELECT function_row.prosrc INTO detach_source
    FROM pg_catalog.pg_proc AS function_row
   WHERE function_row.oid = pg_catalog.to_regprocedure(
     'public.admin_detach_profile_token()'
   );
  SELECT function_row.prosrc INTO profile_delete_lock_source
    FROM pg_catalog.pg_proc AS function_row
   WHERE function_row.oid = profile_delete_lock_oid;
  SELECT function_row.prosrc INTO reconcile_source
    FROM pg_catalog.pg_proc AS function_row
   WHERE function_row.oid = reconcile_oid;
  SELECT function_row.prosrc INTO outcome_reconcile_source
    FROM pg_catalog.pg_proc AS function_row
   WHERE function_row.oid = outcome_reconcile_oid;
  SELECT function_row.prosrc INTO mutation_fence_lock_source
    FROM pg_catalog.pg_proc AS function_row
   WHERE function_row.oid = mutation_fence_lock_oid;
  SELECT function_row.prosrc INTO banner_fence_lock_source
    FROM pg_catalog.pg_proc AS function_row
   WHERE function_row.oid = banner_fence_lock_oid;
  SELECT function_row.prosrc INTO fence_reject_source
    FROM pg_catalog.pg_proc AS function_row
   WHERE function_row.oid = fence_reject_oid;
  SELECT function_row.prosrc INTO upload_prepare_source
    FROM pg_catalog.pg_proc AS function_row
   WHERE function_row.oid = upload_prepare_oid;
  SELECT function_row.prosrc INTO upload_complete_source
    FROM pg_catalog.pg_proc AS function_row
   WHERE function_row.oid = upload_complete_oid;
  SELECT function_row.prosrc INTO authorization_source
    FROM pg_catalog.pg_proc AS function_row
   WHERE function_row.oid = authorization_oid;
  SELECT function_row.prosrc INTO owner_recoverable_source
    FROM pg_catalog.pg_proc AS function_row
   WHERE function_row.oid = owner_recoverable_oid;
  SELECT function_row.prosrc INTO revoke_guard_source
    FROM pg_catalog.pg_proc AS function_row
   WHERE function_row.oid = revoke_guard_oid;
  SELECT function_row.prosrc INTO recovery_guard_source
    FROM pg_catalog.pg_proc AS function_row
   WHERE function_row.oid = recovery_guard_oid;
  SELECT function_row.prosrc INTO token_statement_lock_source
    FROM pg_catalog.pg_proc AS function_row
   WHERE function_row.oid = token_statement_lock_oid;

  IF pg_catalog.strpos(wrapper_source, 'admin_execute_token_lifecycle') = 0
     OR pg_catalog.strpos(wrapper_source, 'admin_execute_mutation_pre_token_lifecycle') = 0
     OR pg_catalog.strpos(lifecycle_source, 'pg_advisory_xact_lock(20260718180000') = 0
     OR pg_catalog.strpos(lifecycle_source, 'admin_assert_mutation_capability') = 0
     OR pg_catalog.strpos(lifecycle_source, 'admin_assert_token_revoke_allowed') = 0
     OR pg_catalog.strpos(lifecycle_source, 'token.revoked_at IS NULL') = 0
     OR pg_catalog.strpos(lifecycle_source, 'token.expires_at >') = 0
     OR pg_catalog.strpos(lifecycle_source, 'FOR UPDATE') = 0
     OR pg_catalog.strpos(
       lifecycle_source, 'actor_profile.id = token.admin_id'
     ) = 0
     OR pg_catalog.strpos(lifecycle_source, 'profile.nickname') = 0
     OR pg_catalog.strpos(lifecycle_source, 'profile.email') = 0
     OR pg_catalog.strpos(lifecycle_source, 'created_by') = 0
     OR pg_catalog.strpos(lifecycle_source, 'token_issued') = 0
     OR pg_catalog.strpos(lifecycle_source, 'case_id') = 0
     OR pg_catalog.strpos(lifecycle_source, 'approval_ref') = 0
     OR pg_catalog.strpos(lifecycle_source, 'admin_audit_required_missing') = 0
     OR pg_catalog.strpos(lifecycle_source, 'idempotency_conflict') = 0
     OR pg_catalog.strpos(lifecycle_source, 'account_deletion_jobs') = 0
     OR pg_catalog.strpos(lifecycle_source, 'admin_account_deletion_in_progress') = 0 THEN
    RAISE EXCEPTION 'verify_failed: lifecycle authorization/atomicity/evidence contract missing';
  END IF;

  IF pg_catalog.strpos(lifecycle_source, $$target_role = 'owner'$$) = 0
     OR pg_catalog.strpos(
       lifecycle_source, $$clock_timestamp() + interval '24 hours'$$
     ) = 0
     OR pg_catalog.strpos(lifecycle_source, 'target_owner.id = ANY(target_token_ids)') = 0
     OR pg_catalog.strpos(
       lifecycle_source, 'NOT (remaining_owner.id = ANY(target_token_ids))'
     ) = 0
     OR pg_catalog.strpos(lifecycle_source, 'remaining_owner.last_used_at') = 0
     OR pg_catalog.strpos(
       lifecycle_source, 'remaining_owner_profile.id = remaining_owner.admin_id'
     ) = 0 THEN
    RAISE EXCEPTION
      'verify_failed: owner 24-hour issue/set-wise batch recovery boundary drifted';
  END IF;

  IF pg_catalog.strpos(authorization_source, 'token.admin_id IS NOT NULL') = 0
     OR pg_catalog.strpos(
       authorization_source, 'profile.id = token.admin_id'
     ) = 0
     OR pg_catalog.strpos(
       authorization_source, 'pg_advisory_xact_lock(20260718180000'
     ) = 0
     OR pg_catalog.strpos(
       authorization_source, 'pg_advisory_xact_lock(20260718190000'
     ) = 0
     OR pg_catalog.strpos(
       authorization_source, 'pg_advisory_xact_lock(20260718180000'
     ) > pg_catalog.strpos(
       authorization_source, 'pg_advisory_xact_lock(20260718190000'
     )
     OR pg_catalog.strpos(
       authorization_source, 'pg_advisory_xact_lock(20260718190000'
     ) > pg_catalog.strpos(authorization_source, 'SET last_used_at') THEN
    RAISE EXCEPTION
      'verify_failed: authorization verification/profile/lock order drifted';
  END IF;

  IF pg_catalog.strpos(owner_recoverable_source, 'p_admin_id IS NOT NULL') = 0
     OR pg_catalog.strpos(owner_recoverable_source, $$p_role = 'owner'$$) = 0
     OR pg_catalog.strpos(owner_recoverable_source, 'p_revoked_at IS NULL') = 0
     OR pg_catalog.strpos(owner_recoverable_source, 'p_expires_at >=') = 0
     OR pg_catalog.strpos(owner_recoverable_source, 'clock_timestamp()') = 0
     OR pg_catalog.strpos(owner_recoverable_source, $$interval '24 hours'$$) = 0
     OR pg_catalog.strpos(owner_recoverable_source, 'p_last_used_at IS NOT NULL') = 0
     OR pg_catalog.strpos(revoke_guard_source, 'admin_owner_token_recoverable') = 0
     OR pg_catalog.strpos(revoke_guard_source, 'owner_profile.id = owner_token.admin_id') = 0
     OR pg_catalog.strpos(recovery_guard_source, 'admin_owner_token_recoverable') = 0
     OR pg_catalog.strpos(recovery_guard_source, 'owner_profile.id = other_owner.admin_id') = 0
     OR pg_catalog.strpos(recovery_guard_source, 'last_active_owner_token') = 0
     OR pg_catalog.strpos(
       token_statement_lock_source, 'pg_advisory_xact_lock(20260718180000'
     ) = 0
     OR pg_catalog.strpos(
       token_statement_lock_source, 'pg_advisory_xact_lock(20260718190000'
     ) = 0
     OR pg_catalog.strpos(
       token_statement_lock_source, 'pg_advisory_xact_lock(20260718180000'
     ) > pg_catalog.strpos(
       token_statement_lock_source, 'pg_advisory_xact_lock(20260718190000'
     ) THEN
    RAISE EXCEPTION
      'verify_failed: verified/live-profile owner recovery guards drifted';
  END IF;

  IF pg_catalog.strpos(prepare_source, 'pg_advisory_xact_lock(20260718180000') = 0
     OR pg_catalog.strpos(prepare_source, 'pg_advisory_xact_lock(20260718190000') = 0
     OR pg_catalog.strpos(prepare_source, 'FOR UPDATE') = 0
     OR pg_catalog.strpos(prepare_source, 'account_deletion_jobs') = 0
     OR pg_catalog.strpos(prepare_source, 'profile.wechat_openid') = 0
     OR pg_catalog.strpos(prepare_source, 'profile_exists := FOUND') = 0
     OR pg_catalog.strpos(prepare_source, 'FROM auth.users AS auth_user') = 0
     OR pg_catalog.strpos(prepare_source, 'account_auth_user_not_found') = 0
     OR pg_catalog.strpos(prepare_source, 'admin_active_token_profile_missing') = 0
     OR pg_catalog.strpos(prepare_source, 'account_profile_not_found') > 0
     OR pg_catalog.strpos(prepare_source, 'admin_recovery_transfer_required') = 0
     OR pg_catalog.strpos(prepare_source, 'admin_owner_token_recoverable') = 0
     OR pg_catalog.strpos(prepare_source, 'token.last_used_at') = 0
     OR pg_catalog.strpos(prepare_source, 'owner_profile.id = token.admin_id') = 0
     OR pg_catalog.strpos(
       prepare_source, 'remaining_recoverable_owner_token_count'
     ) = 0
     OR pg_catalog.strpos(prepare_source, 'UPDATE public.admin_tokens') = 0
     OR pg_catalog.strpos(prepare_source, $$'account_deletion_prepared'$$) = 0
     OR pg_catalog.strpos(prepare_source, 'INSERT INTO public.admin_audit_log') = 0
     OR pg_catalog.strpos(prepare_source, 'pg_catalog.to_jsonb(job_row)') = 0
     OR pg_catalog.strpos(prepare_source, 'pg_advisory_xact_lock(20260718180000')
        > pg_catalog.strpos(prepare_source, 'pg_advisory_xact_lock(20260718190000')
     OR pg_catalog.strpos(prepare_source, 'pg_advisory_xact_lock(20260718190000')
        > pg_catalog.strpos(prepare_source, 'FOR UPDATE')
     OR pg_catalog.strpos(prepare_source, 'FOR UPDATE')
        > pg_catalog.strpos(prepare_source, 'profile_exists := FOUND')
     OR pg_catalog.strpos(prepare_source, 'profile_exists := FOUND')
        > pg_catalog.strpos(prepare_source, 'admin_active_token_profile_missing')
     OR pg_catalog.strpos(prepare_source, 'admin_active_token_profile_missing')
        > pg_catalog.strpos(prepare_source, 'IF target_active_token_count > 0')
     OR pg_catalog.strpos(prepare_source, 'IF target_active_token_count > 0')
        > pg_catalog.strpos(prepare_source, 'FROM auth.users AS auth_user')
     OR pg_catalog.strpos(prepare_source, 'FROM auth.users AS auth_user')
        > pg_catalog.strpos(prepare_source, 'INSERT INTO public.account_deletion_jobs')
     OR pg_catalog.strpos(prepare_source, 'INSERT INTO public.account_deletion_jobs')
        > pg_catalog.strpos(prepare_source, 'WITH revoked AS')
     OR pg_catalog.strpos(prepare_source, 'WITH revoked AS')
        > pg_catalog.strpos(prepare_source, 'INSERT INTO public.admin_audit_log') THEN
    RAISE EXCEPTION 'verify_failed: atomic account deletion prepare/order/audit contract missing';
  END IF;

  IF pg_catalog.strpos(detach_source, $$NEW.admin_name := '[detached]'$$) = 0
     OR pg_catalog.strpos(detach_source, $$NEW.admin_email := 'detached@invalid.local'$$) = 0
     OR pg_catalog.strpos(detach_source, 'NEW.revoked_at') = 0
     OR pg_catalog.strpos(detach_source, 'IF OLD.revoked_at IS NULL') = 0
     OR pg_catalog.strpos(detach_source, 'INSERT INTO public.admin_audit_log') = 0
     OR pg_catalog.strpos(detach_source, $$'token_revoked'$$) = 0
     OR pg_catalog.strpos(detach_source, $$'profile_deleted'$$) = 0 THEN
    RAISE EXCEPTION 'verify_failed: profile-delete revocation/redaction/audit contract missing';
  END IF;

  IF pg_catalog.strpos(
       profile_delete_lock_source,
       'pg_advisory_xact_lock(20260718180000'
     ) = 0
     OR pg_catalog.strpos(
       profile_delete_lock_source,
       'pg_advisory_xact_lock(20260718190000'
     ) = 0
     OR pg_catalog.strpos(
       profile_delete_lock_source,
       'pg_advisory_xact_lock(20260718180000'
     ) > pg_catalog.strpos(
       profile_delete_lock_source,
       'pg_advisory_xact_lock(20260718190000'
     ) THEN
    RAISE EXCEPTION 'verify_failed: profile deletion advisory lock order drifted';
  END IF;

  IF pg_catalog.strpos(reconcile_source, $$p_token_hash !~ '^[0-9a-f]{64}$'$$) = 0
     OR pg_catalog.strpos(reconcile_source, 'admin_token_hash_invalid') = 0
     OR pg_catalog.strpos(reconcile_source, 'token.token_hash = p_token_hash') = 0
     OR pg_catalog.strpos(reconcile_source, 'token.id') = 0
     OR pg_catalog.strpos(reconcile_source, 'token.admin_id') = 0
     OR pg_catalog.strpos(reconcile_source, 'token.role') = 0
     OR pg_catalog.strpos(reconcile_source, 'token.expires_at') = 0
     OR pg_catalog.strpos(reconcile_source, 'token.revoked_at') = 0
     OR pg_catalog.strpos(reconcile_source, 'token.admin_name') > 0
     OR pg_catalog.strpos(reconcile_source, 'token.admin_email') > 0 THEN
    RAISE EXCEPTION 'verify_failed: exact non-secret token reconciliation contract';
  END IF;

  IF pg_catalog.strpos(
       mutation_fence_lock_source,
       'pg_advisory_xact_lock(20260718180000'
     ) = 0
     OR pg_catalog.strpos(
       mutation_fence_lock_source,
       'pg_advisory_xact_lock(20260718200000'
     ) = 0
     OR pg_catalog.strpos(
       mutation_fence_lock_source,
       'pg_advisory_xact_lock(20260718180000'
     ) > pg_catalog.strpos(
       mutation_fence_lock_source,
       'pg_advisory_xact_lock(20260718200000'
     )
     OR pg_catalog.strpos(
       banner_fence_lock_source,
       'pg_advisory_xact_lock(20260718200000'
     ) = 0
     OR pg_catalog.strpos(
       banner_fence_lock_source,
       'pg_advisory_xact_lock(20260718180000'
     ) > 0
     OR pg_catalog.strpos(
       fence_reject_source,
       'admin_idempotency_reconciliation_fences'
     ) = 0
     OR pg_catalog.strpos(
       fence_reject_source,
       'admin_idempotency_reconciled'
     ) = 0 THEN
    RAISE EXCEPTION
      'verify_failed: authoritative fence lock order/rejection contract';
  END IF;

  IF pg_catalog.strpos(
       upload_prepare_source,
       'pg_advisory_xact_lock(20260718180000'
     ) = 0
     OR pg_catalog.strpos(
       upload_prepare_source,
       'pg_advisory_xact_lock(20260718200000'
     ) = 0
     OR pg_catalog.strpos(
       upload_prepare_source,
       'admin_prepare_banner_upload_pre_idempotency_fence'
     ) = 0
     OR pg_catalog.strpos(
       upload_prepare_source,
       'pg_advisory_xact_lock(20260718180000'
     ) > pg_catalog.strpos(
       upload_prepare_source,
       'pg_advisory_xact_lock(20260718200000'
     )
     OR pg_catalog.strpos(
       upload_prepare_source,
       'pg_advisory_xact_lock(20260718200000'
     ) > pg_catalog.strpos(
       upload_prepare_source,
       'admin_prepare_banner_upload_pre_idempotency_fence'
     )
     OR pg_catalog.strpos(
       upload_complete_source,
       'pg_advisory_xact_lock(20260718180000'
     ) = 0
     OR pg_catalog.strpos(
       upload_complete_source,
       'pg_advisory_xact_lock(20260718200000'
     ) = 0
     OR pg_catalog.strpos(
       upload_complete_source,
       'admin_complete_banner_upload_pre_idempotency_fence'
     ) = 0
     OR pg_catalog.strpos(
       upload_complete_source,
       'pg_advisory_xact_lock(20260718180000'
     ) > pg_catalog.strpos(
       upload_complete_source,
       'pg_advisory_xact_lock(20260718200000'
     )
     OR pg_catalog.strpos(
       upload_complete_source,
       'pg_advisory_xact_lock(20260718200000'
     ) > pg_catalog.strpos(
       upload_complete_source,
       'admin_complete_banner_upload_pre_idempotency_fence'
     ) THEN
    RAISE EXCEPTION
      'verify_failed: banner upload token/fence deadlock order not repaired';
  END IF;

  IF pg_catalog.strpos(
       outcome_reconcile_source,
       'pg_advisory_xact_lock(20260718180000'
     ) = 0
     OR pg_catalog.strpos(
       outcome_reconcile_source,
       'pg_advisory_xact_lock(20260718200000'
     ) = 0
     OR pg_catalog.strpos(
       outcome_reconcile_source,
       'pg_advisory_xact_lock(20260718180000'
     ) > pg_catalog.strpos(
       outcome_reconcile_source,
       'pg_advisory_xact_lock(20260718200000'
     )
     OR pg_catalog.strpos(
       outcome_reconcile_source,
       'token.role = ''owner'''
     ) = 0
     OR pg_catalog.strpos(
       outcome_reconcile_source,
       'owner_profile.id = token.admin_id'
     ) = 0
     OR pg_catalog.strpos(
       outcome_reconcile_source,
       'FROM public.admin_mutation_requests'
     ) = 0
     OR pg_catalog.strpos(
       outcome_reconcile_source,
       'FROM public.admin_banner_uploads'
     ) = 0
     OR pg_catalog.strpos(
       outcome_reconcile_source,
       'INSERT INTO public.admin_idempotency_reconciliation_fences'
     ) = 0
     OR pg_catalog.strpos(
       outcome_reconcile_source,
       $$jsonb_build_object('status', 'not_dispatched')$$
     ) = 0
     OR pg_catalog.strpos(
       outcome_reconcile_source,
       $$jsonb_build_object('status', 'completed')$$
     ) = 0
     OR pg_catalog.strpos(
       outcome_reconcile_source,
       $$jsonb_build_object('status', 'running')$$
     ) = 0
     OR pg_catalog.strpos(
       outcome_reconcile_source,
       'admin_idempotency_reconcile_invalid'
     ) = 0
     OR pg_catalog.strpos(
       outcome_reconcile_source,
       'admin_owner_token_inactive'
     ) = 0
     OR pg_catalog.strpos(
       outcome_reconcile_source,
       'admin_idempotency_reconcile_collision'
     ) = 0
     OR pg_catalog.strpos(
       outcome_reconcile_source,
       'admin_idempotency_reconcile_uncertain'
     ) = 0
     OR pg_catalog.strpos(
       outcome_reconcile_source,
       'admin_idempotency_reconcile_fence_conflict'
     ) = 0
     OR pg_catalog.strpos(outcome_reconcile_source, 'FOR UPDATE') > 0
     OR pg_catalog.strpos(outcome_reconcile_source, 'token_hash') = 0
     OR pg_catalog.strpos(outcome_reconcile_source, 'admin_name') > 0
     OR pg_catalog.strpos(outcome_reconcile_source, 'admin_email') > 0 THEN
    RAISE EXCEPTION
      'verify_failed: opaque owner idempotency reconciliation/fence contract';
  END IF;

  IF NOT public.admin_lifecycle_evidence_valid('CASE-VALID-190')
     OR public.admin_lifecycle_evidence_valid(
       'CASE-' || U&'\202E' || 'VISUAL-SPOOF'
     )
     OR public.admin_lifecycle_evidence_valid(
       'APPROVAL-' || U&'\2067' || 'VISUAL-SPOOF'
     ) THEN
    RAISE EXCEPTION 'verify_failed: lifecycle evidence control-character boundary missing';
  END IF;

  IF pg_catalog.strpos(lifecycle_source, 'admin_assert_mutation_capability')
       > pg_catalog.strpos(lifecycle_source, 'INSERT INTO public.admin_mutation_requests') THEN
    RAISE EXCEPTION 'verify_failed: lifecycle capability check occurs after ledger write';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid)
    INTO audit_check
    FROM pg_catalog.pg_constraint AS constraint_row
   WHERE constraint_row.conrelid = 'public.admin_audit_log'::pg_catalog.regclass
     AND constraint_row.conname = 'admin_audit_log_event_kind_check'
     AND constraint_row.contype = 'c'
     AND constraint_row.convalidated;
  IF audit_check IS NULL
     OR pg_catalog.strpos(audit_check, 'token_issued') = 0
     OR pg_catalog.strpos(audit_check, 'token_revoked') = 0 THEN
    RAISE EXCEPTION 'verify_failed: lifecycle audit vocabulary missing';
  END IF;
END;
$verify$;

SELECT
  function_row.oid::pg_catalog.regprocedure AS function_name,
  function_row.prosecdef AS security_definer,
  function_row.proconfig AS fixed_config,
  pg_catalog.has_function_privilege(
    'service_role', function_row.oid, 'EXECUTE'
  ) AS service_role_execute
FROM pg_catalog.pg_proc AS function_row
WHERE function_row.oid IN (
  pg_catalog.to_regprocedure(
    'public.admin_execute_mutation(text,uuid,text,text,jsonb)'
  ),
  pg_catalog.to_regprocedure(
    'public.admin_execute_token_lifecycle(text,uuid,text,text,jsonb)'
  ),
  pg_catalog.to_regprocedure(
    'public.admin_execute_mutation_pre_token_lifecycle(text,uuid,text,text,jsonb)'
  ),
  pg_catalog.to_regprocedure(
    'public.admin_prepare_account_deletion(uuid)'
  ),
  pg_catalog.to_regprocedure(
    'public.admin_reconcile_issued_token(text)'
  ),
  pg_catalog.to_regprocedure(
    'public.admin_reconcile_idempotency_outcome(text,uuid)'
  ),
  pg_catalog.to_regprocedure(
    'public.admin_prepare_banner_upload(text,uuid,text,text,integer)'
  ),
  pg_catalog.to_regprocedure(
    'public.admin_complete_banner_upload(text,uuid,text)'
  ),
  pg_catalog.to_regprocedure(
    'public.admin_token_authorization(text)'
  ),
  pg_catalog.to_regprocedure(
    'public.admin_token_inventory()'
  ),
  pg_catalog.to_regprocedure(
    'public.admin_owner_token_recoverable(uuid,text,timestamptz,timestamptz,timestamptz)'
  ),
  pg_catalog.to_regprocedure(
    'public.admin_lock_token_recovery_mutation()'
  )
)
ORDER BY function_row.oid::pg_catalog.regprocedure::text;

SELECT admin_role, pg_catalog.array_agg(action ORDER BY action) AS actions
FROM public.admin_role_action_capabilities
GROUP BY admin_role
ORDER BY admin_role;

ROLLBACK;
