-- Read-only pre-deploy gate for the forward-only 20260719020000 owner-token
-- concurrency reconciliation.
--
-- Unlike PRECHECK_20260719_admin_token_lifecycle_rpc.sql, this file is meant
-- to run after an earlier 20260719010000 has already been recorded. It accepts
-- the reviewed predecessor/final function bodies, but refuses missing base
-- objects, unsafe ACL/search_path drift, active lock owners, or malformed token
-- rows before the migration requests its table lock.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $precheck$
DECLARE
  required_relation text;
  required_signature text;
  conflicting_sessions text;
BEGIN
  FOREACH required_relation IN ARRAY ARRAY[
    'public.admin_tokens',
    'public.profiles',
    'public.account_deletion_jobs',
    'public.admin_mutation_requests',
    'public.admin_idempotency_reconciliation_fences'
  ] LOOP
    IF pg_catalog.to_regclass(required_relation) IS NULL THEN
      RAISE EXCEPTION 'precheck_failed: 19020000 prerequisite missing: %',
        required_relation;
    END IF;
  END LOOP;

  FOREACH required_signature IN ARRAY ARRAY[
    'public.admin_owner_token_recoverable(uuid,text,timestamptz,timestamptz,timestamptz)',
    'public.admin_assert_token_revoke_allowed(uuid,uuid)',
    'public.admin_protect_recovery_tokens()',
    'public.admin_lock_token_recovery_mutation()',
    'public.admin_token_authorization(text)',
    'public.admin_prepare_account_deletion(uuid)',
    'public.admin_execute_token_lifecycle(text,uuid,text,text,jsonb)'
  ] LOOP
    IF pg_catalog.to_regprocedure(required_signature) IS NULL THEN
      RAISE EXCEPTION 'precheck_failed: 19020000 function missing: %',
        required_signature;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid IN (
      pg_catalog.to_regprocedure(
        'public.admin_owner_token_recoverable(uuid,text,timestamptz,timestamptz,timestamptz)'
      ),
      pg_catalog.to_regprocedure(
        'public.admin_assert_token_revoke_allowed(uuid,uuid)'
      ),
      pg_catalog.to_regprocedure('public.admin_protect_recovery_tokens()'),
      pg_catalog.to_regprocedure('public.admin_lock_token_recovery_mutation()'),
      pg_catalog.to_regprocedure('public.admin_token_authorization(text)'),
      pg_catalog.to_regprocedure('public.admin_prepare_account_deletion(uuid)'),
      pg_catalog.to_regprocedure(
        'public.admin_execute_token_lifecycle(text,uuid,text,text,jsonb)'
      )
    )
      AND routine.proconfig IS DISTINCT FROM
          ARRAY['search_path=pg_catalog']::text[]
  ) THEN
    RAISE EXCEPTION 'precheck_failed: 19020000 function search_path drifted';
  END IF;

  IF NOT (
       SELECT routine.prosecdef
       FROM pg_catalog.pg_proc AS routine
       WHERE routine.oid = pg_catalog.to_regprocedure(
         'public.admin_token_authorization(text)'
       )
     )
     OR NOT (
       SELECT routine.prosecdef
       FROM pg_catalog.pg_proc AS routine
       WHERE routine.oid = pg_catalog.to_regprocedure(
         'public.admin_prepare_account_deletion(uuid)'
       )
     )
     OR NOT (
       SELECT routine.prosecdef
       FROM pg_catalog.pg_proc AS routine
       WHERE routine.oid = pg_catalog.to_regprocedure(
         'public.admin_execute_token_lifecycle(text,uuid,text,text,jsonb)'
       )
     ) THEN
    RAISE EXCEPTION 'precheck_failed: 19020000 SECURITY DEFINER boundary drifted';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
       'service_role', 'public.admin_token_authorization(text)', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon', 'public.admin_token_authorization(text)', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', 'public.admin_token_authorization(text)', 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'service_role', 'public.admin_prepare_account_deletion(uuid)', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon', 'public.admin_prepare_account_deletion(uuid)', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', 'public.admin_prepare_account_deletion(uuid)', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role',
       'public.admin_execute_token_lifecycle(text,uuid,text,text,jsonb)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon',
       'public.admin_execute_token_lifecycle(text,uuid,text,text,jsonb)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated',
       'public.admin_execute_token_lifecycle(text,uuid,text,text,jsonb)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'precheck_failed: 19020000 function ACL drifted';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.admin_tokens AS token
    WHERE token.role NOT IN ('operator', 'security_admin', 'owner')
       OR (token.admin_id IS NULL AND token.revoked_at IS NULL)
       OR (
         token.admin_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
           FROM public.profiles AS profile
           WHERE profile.id = token.admin_id
         )
       )
  ) THEN
    RAISE EXCEPTION
      'precheck_failed: 19020000 token identity/role invariant drifted';
  END IF;

  -- Test the same ordered advisory namespace without waiting. The locks are
  -- transaction-scoped and are released by the final ROLLBACK.
  IF NOT pg_catalog.pg_try_advisory_xact_lock(20260718180000::bigint)
     OR NOT pg_catalog.pg_try_advisory_xact_lock(20260718190000::bigint) THEN
    RAISE EXCEPTION
      'precheck_failed: 19020000 admin advisory lock namespace is busy';
  END IF;

  SELECT pg_catalog.string_agg(
           CASE
             WHEN lock_row.pid IS NULL THEN 'prepared-transaction:' || lock_row.mode
             ELSE pg_catalog.format('%s:%s', lock_row.pid, lock_row.mode)
           END,
           ', ' ORDER BY lock_row.pid NULLS FIRST, lock_row.mode
         )
    INTO conflicting_sessions
  FROM pg_catalog.pg_locks AS lock_row
  LEFT JOIN pg_catalog.pg_stat_activity AS activity
    ON activity.pid = lock_row.pid
  WHERE lock_row.relation = 'public.admin_tokens'::pg_catalog.regclass
    AND lock_row.granted
    AND lock_row.pid IS DISTINCT FROM pg_catalog.pg_backend_pid()
    AND lock_row.mode IN (
      'RowExclusiveLock', 'ShareUpdateExclusiveLock', 'ShareLock',
      'ShareRowExclusiveLock', 'ExclusiveLock', 'AccessExclusiveLock'
    )
    AND (
      lock_row.pid IS NULL
      OR (
        activity.xact_start IS NOT NULL
        AND pg_catalog.now() - activity.xact_start > interval '30 seconds'
      )
    );

  IF conflicting_sessions IS NOT NULL THEN
    RAISE EXCEPTION
      'precheck_failed: 19020000 admin_tokens writers must drain first: %',
      conflicting_sessions;
  END IF;
END
$precheck$;

SELECT
  pg_catalog.pg_total_relation_size('public.admin_tokens') AS admin_tokens_bytes,
  pg_catalog.count(*) AS token_rows,
  pg_catalog.count(*) FILTER (
    WHERE revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > pg_catalog.now())
  ) AS active_token_rows
FROM public.admin_tokens;

ROLLBACK;
