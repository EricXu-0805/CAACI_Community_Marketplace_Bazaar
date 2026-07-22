-- Durable account deletion saga.
--
-- Storage, GoTrue Auth, and wechat_password_map cannot participate in one
-- database transaction. The edge route therefore records the target and a
-- monotonic checkpoint here BEFORE its first destructive external call. This
-- row intentionally has no FK to auth.users/profiles: it must survive the Auth
-- cascade long enough for cron to finish out-of-FK cleanup. Completed rows are
-- retained permanently as deletion tombstones because deleting an Auth user
-- does not revoke already-issued access JWTs before their expiry.

-- Retire the historical one-transaction browser RPC before exposing any part
-- of the durable saga. Migration 058 granted this SECURITY DEFINER function to
-- authenticated; it directly deleted conversations/profile rows and could
-- bypass both shared-evidence retention and every external cleanup checkpoint.
-- Keep the signature for old clients to resolve to a deterministic permission
-- error, but make it uncallable by every Data API role. This block is the first
-- executable statement intentionally: non-transactional runners fail closed.
DO $retire_legacy_delete_rpc$
DECLARE
  legacy_rpc oid := pg_catalog.to_regprocedure('public.delete_my_account()');
BEGIN
  IF legacy_rpc IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.delete_my_account()
      FROM PUBLIC, anon, authenticated, service_role;

    IF pg_catalog.has_function_privilege(
         'anon', legacy_rpc, 'EXECUTE'
       ) OR pg_catalog.has_function_privilege(
         'authenticated', legacy_rpc, 'EXECUTE'
       ) OR pg_catalog.has_function_privilege(
         'service_role', legacy_rpc, 'EXECUTE'
       ) THEN
      RAISE EXCEPTION
        'account deletion boundary drift: legacy delete RPC remains callable';
    END IF;
  END IF;
END
$retire_legacy_delete_rpc$;

CREATE TABLE IF NOT EXISTS public.account_deletion_jobs (
  user_id         uuid PRIMARY KEY,
  stage           text NOT NULL DEFAULT 'requested'
                  CONSTRAINT account_deletion_jobs_stage_check CHECK (stage IN (
                    'requested',
                    'storage_deleted',
                    'auth_deleted',
                    'completed'
                  )),
  wechat_openid   text
                  CONSTRAINT account_deletion_jobs_wechat_openid_check CHECK (
                    wechat_openid IS NULL
                    OR length(wechat_openid) BETWEEN 4 AND 128
                  ),
  last_error      text
                  CONSTRAINT account_deletion_jobs_last_error_check CHECK (
                    last_error IS NULL OR length(last_error) <= 160
                  ),
  requested_at    timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  CONSTRAINT account_deletion_jobs_completion_shape CHECK (
    (stage = 'completed' AND completed_at IS NOT NULL)
    OR (stage <> 'completed' AND completed_at IS NULL)
  ),
  CONSTRAINT account_deletion_jobs_completed_secret_scrubbed CHECK (
    stage <> 'completed' OR wechat_openid IS NULL
  )
);

-- CREATE ... IF NOT EXISTS makes deployment replay-safe, but it must never
-- turn an old/drifted table into a silent success. Assert the exact durable
-- state shape before granting access or creating the worker index.
DO $account_deletion_jobs_shape$
DECLARE
  column_count integer;
  check_count integer;
  constraint_definition text;
BEGIN
  SELECT count(*) INTO column_count
  FROM pg_catalog.pg_attribute
  WHERE attrelid = 'public.account_deletion_jobs'::pg_catalog.regclass
    AND attnum > 0
    AND NOT attisdropped;

  IF column_count <> 7 THEN
    RAISE EXCEPTION 'account_deletion_jobs schema drift: expected 7 columns, found %', column_count;
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
    RAISE EXCEPTION 'account_deletion_jobs schema drift: column type/null/default contract';
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
    RAISE EXCEPTION 'account_deletion_jobs schema drift: primary key';
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
    RAISE EXCEPTION 'account_deletion_jobs schema drift: check constraints';
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
    RAISE EXCEPTION 'account_deletion_jobs schema drift: stage domain';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(oid) INTO STRICT constraint_definition
  FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.account_deletion_jobs'::pg_catalog.regclass
    AND conname = 'account_deletion_jobs_wechat_openid_check';
  IF constraint_definition !~* 'wechat_openid.*length'
     OR regexp_replace(constraint_definition, '[^0-9]', '', 'g') <> '4128' THEN
    RAISE EXCEPTION 'account_deletion_jobs schema drift: WeChat key bounds';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(oid) INTO STRICT constraint_definition
  FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.account_deletion_jobs'::pg_catalog.regclass
    AND conname = 'account_deletion_jobs_last_error_check';
  IF constraint_definition !~* 'last_error.*length'
     OR regexp_replace(constraint_definition, '[^0-9]', '', 'g') <> '160' THEN
    RAISE EXCEPTION 'account_deletion_jobs schema drift: error bound';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(oid) INTO STRICT constraint_definition
  FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.account_deletion_jobs'::pg_catalog.regclass
    AND conname = 'account_deletion_jobs_completion_shape';
  IF constraint_definition !~* 'stage.*completed'
     OR constraint_definition !~* 'completed_at.*IS NOT NULL'
     OR constraint_definition !~* 'completed_at.*IS NULL' THEN
    RAISE EXCEPTION 'account_deletion_jobs schema drift: completion shape';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(oid) INTO STRICT constraint_definition
  FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.account_deletion_jobs'::pg_catalog.regclass
    AND conname = 'account_deletion_jobs_completed_secret_scrubbed';
  IF constraint_definition !~* 'stage.*completed'
     OR constraint_definition !~* 'wechat_openid.*IS NULL' THEN
    RAISE EXCEPTION 'account_deletion_jobs schema drift: completed secret scrub';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.account_deletion_jobs'::pg_catalog.regclass
      AND contype = 'f'
  ) THEN
    RAISE EXCEPTION 'account_deletion_jobs schema drift: job must not have a foreign key';
  END IF;
END
$account_deletion_jobs_shape$;

COMMENT ON TABLE public.account_deletion_jobs IS
  'Service-role-only durable checkpoints and permanent Storage-write tombstones for the account deletion saga.';
COMMENT ON COLUMN public.account_deletion_jobs.user_id IS
  'Caller uid derived from a validated JWT. Deliberately not an FK; the completed row remains as a deletion tombstone.';
COMMENT ON COLUMN public.account_deletion_jobs.wechat_openid IS
  'Cleanup key captured before the profile/Auth cascade, then nulled at completed; never exposed to browser roles.';

ALTER TABLE public.account_deletion_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_jobs NO FORCE ROW LEVEL SECURITY;

-- No policies: browser-facing roles cannot access deletion operations or
-- discover deletion user ids / WeChat identifiers. service_role bypasses RLS,
-- and explicit grants keep Data API privileges intentional. Its job-table
-- grant is deliberately delayed until the Storage tombstone boundary below
-- has been created and structurally verified. This also fails closed for a
-- non-transactional/manual runner that stops partway through the file.
REVOKE ALL ON TABLE public.account_deletion_jobs FROM PUBLIC;
REVOKE ALL ON TABLE public.account_deletion_jobs FROM anon, authenticated;
REVOKE ALL ON TABLE public.account_deletion_jobs FROM service_role;

CREATE INDEX IF NOT EXISTS account_deletion_jobs_pending_updated_idx
  ON public.account_deletion_jobs (updated_at)
  WHERE stage <> 'completed';

DO $account_deletion_jobs_index_shape$
BEGIN
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
    RAISE EXCEPTION 'account_deletion_jobs schema drift: pending index';
  END IF;
END
$account_deletion_jobs_index_shape$;

-- ---------------------------------------------------------------------------
-- Fail closed against access JWTs that outlive Auth deletion.
--
-- Storage derives ownership/auth.uid() from the JWT, not from a live
-- auth.users row. As soon as the saga inserts ANY job row (requested through
-- completed), that uid must therefore lose item-images INSERT/UPDATE access.
-- The zero-argument helper reveals no job data and can evaluate only the
-- current JWT subject. SECURITY DEFINER is required because the job table is
-- intentionally invisible to browser roles; its search_path is fully pinned.
-- ---------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.current_account_storage_writes_allowed()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT caller.user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.account_deletion_jobs AS deletion_tombstone
      WHERE deletion_tombstone.user_id = caller.user_id
    )
  FROM (SELECT auth.uid() AS user_id) AS caller
$function$;

REVOKE ALL ON FUNCTION private.current_account_storage_writes_allowed()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.current_account_storage_writes_allowed()
  TO authenticated;

-- Additive RESTRICTIVE policies are intentional. They are ANDed with every
-- current/future permissive Storage policy, so an older upload policy cannot
-- bypass the tombstone. Avoiding DROP POLICY also works with Supabase projects
-- where storage.objects is owned by supabase_storage_admin. If CREATE POLICY
-- is unavailable, deployment must fail: hard deletion is unsafe without this
-- boundary and must never silently degrade to a notice.
DO $account_deletion_storage_policies$
BEGIN
  IF pg_catalog.to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'account deletion boundary requires storage.objects';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class
    WHERE oid = 'storage.objects'::pg_catalog.regclass
      AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'account deletion boundary requires RLS on storage.objects';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy
    WHERE polrelid = 'storage.objects'::pg_catalog.regclass
      AND polname = 'account_deletion_tombstone_blocks_item_image_insert'
  ) THEN
    CREATE POLICY account_deletion_tombstone_blocks_item_image_insert
      ON storage.objects
      AS RESTRICTIVE
      FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id <> 'item-images'
        OR private.current_account_storage_writes_allowed()
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy
    WHERE polrelid = 'storage.objects'::pg_catalog.regclass
      AND polname = 'account_deletion_tombstone_blocks_item_image_update'
  ) THEN
    CREATE POLICY account_deletion_tombstone_blocks_item_image_update
      ON storage.objects
      AS RESTRICTIVE
      FOR UPDATE
      TO authenticated
      USING (
        bucket_id <> 'item-images'
        OR private.current_account_storage_writes_allowed()
      )
      WITH CHECK (
        bucket_id <> 'item-images'
        OR private.current_account_storage_writes_allowed()
      );
  END IF;
END
$account_deletion_storage_policies$;

-- Replay-time drift assertions. CREATE ... IF NOT EXISTS above may preserve a
-- pre-existing object, so success requires the exact helper and policy shape.
DO $account_deletion_storage_boundary_shape$
DECLARE
  helper_oid oid := pg_catalog.to_regprocedure(
    'private.current_account_storage_writes_allowed()'
  );
  insert_policy pg_catalog.pg_policy%ROWTYPE;
  update_policy pg_catalog.pg_policy%ROWTYPE;
  insert_check text;
  update_using text;
  update_check text;
BEGIN
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
    RAISE EXCEPTION 'account deletion boundary drift: private helper security shape';
  END IF;

  IF NOT pg_catalog.has_function_privilege('authenticated', helper_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', helper_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', helper_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'account deletion boundary drift: private helper ACL';
  END IF;

  SELECT * INTO insert_policy
  FROM pg_catalog.pg_policy
  WHERE polrelid = 'storage.objects'::pg_catalog.regclass
    AND polname = 'account_deletion_tombstone_blocks_item_image_insert';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account deletion boundary drift: INSERT policy missing';
  END IF;

  SELECT * INTO update_policy
  FROM pg_catalog.pg_policy
  WHERE polrelid = 'storage.objects'::pg_catalog.regclass
    AND polname = 'account_deletion_tombstone_blocks_item_image_update';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account deletion boundary drift: UPDATE policy missing';
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
    RAISE EXCEPTION 'account deletion boundary drift: restrictive policy shape';
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
    RAISE EXCEPTION 'account deletion boundary drift: policy predicate';
  END IF;
END
$account_deletion_storage_boundary_shape$;

-- The API capability probe can see/create a durable job only after the
-- old-JWT Storage write boundary is proven present.
GRANT SELECT, INSERT, UPDATE
  ON TABLE public.account_deletion_jobs
  TO service_role;

-- Migration 035 originally allowed service-role reads/upserts only. The saga
-- needs an idempotent DELETE after Auth is absent, and no browser role gains it.
REVOKE DELETE ON TABLE public.wechat_password_map FROM PUBLIC, anon, authenticated;
GRANT DELETE ON TABLE public.wechat_password_map TO service_role;

NOTIFY pgrst, 'reload schema';
