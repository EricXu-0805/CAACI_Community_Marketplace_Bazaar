-- Isolated/local behavioral regression for
-- 20260717194646_account_deletion_jobs.sql.
-- NEVER run against production. Every fixture mutation is rolled back.

BEGIN;

-- Migration 058 exposed a SECURITY DEFINER one-shot deletion RPC. The durable
-- saga must retire it before any endpoint switches over, and a stale browser
-- call must neither delete the caller nor erase shared conversation evidence.
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (
    '98000000-0000-4000-8000-000000000001',
    'legacy-delete-a@example.test',
    '{"nickname":"Legacy Delete A"}'::jsonb
  ),
  (
    '98000000-0000-4000-8000-000000000002',
    'legacy-delete-b@example.test',
    '{"nickname":"Legacy Delete B"}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, nickname) VALUES
  (
    '98000000-0000-4000-8000-000000000001',
    'legacy-delete-a@example.test',
    'Legacy Delete A'
  ),
  (
    '98000000-0000-4000-8000-000000000002',
    'legacy-delete-b@example.test',
    'Legacy Delete B'
  )
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  nickname = EXCLUDED.nickname;

INSERT INTO public.conversations (
  id, item_id, buyer_id, seller_id
) VALUES (
  '98000000-0000-4000-8000-000000000010',
  NULL,
  '98000000-0000-4000-8000-000000000001',
  '98000000-0000-4000-8000-000000000002'
);

INSERT INTO public.messages (
  id, conversation_id, sender_id, content, message_type
) VALUES (
  '98000000-0000-4000-8000-000000000011',
  '98000000-0000-4000-8000-000000000010',
  '98000000-0000-4000-8000-000000000002',
  'shared evidence must survive stale legacy delete calls',
  'text'
);

DO $test$
BEGIN
  IF pg_catalog.to_regprocedure('public.delete_my_account()') IS NOT NULL
     AND pg_catalog.has_function_privilege(
       'authenticated', 'public.delete_my_account()', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'regression_failed: authenticated still has legacy delete RPC execute';
  END IF;
END
$test$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '98000000-0000-4000-8000-000000000001',
  true
);

DO $test$
BEGIN
  BEGIN
    PERFORM public.delete_my_account();
    RAISE EXCEPTION 'legacy delete_my_account unexpectedly executed';
  EXCEPTION WHEN insufficient_privilege OR undefined_function THEN
    NULL;
  END;
END
$test$;

RESET ROLE;

DO $test$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = '98000000-0000-4000-8000-000000000001'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = '98000000-0000-4000-8000-000000000001'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.conversations
    WHERE id = '98000000-0000-4000-8000-000000000010'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.messages
    WHERE id = '98000000-0000-4000-8000-000000000011'
  ) THEN
    RAISE EXCEPTION
      'regression_failed: rejected legacy delete changed account/chat evidence';
  END IF;
END
$test$;

-- A uid with no auth.users/profile row proves the durable job has no cascade
-- dependency and can outlive the account it is finishing.
INSERT INTO public.account_deletion_jobs (
  user_id,
  stage,
  wechat_openid
) VALUES (
  '98000000-0000-4000-8000-000000000091',
  'requested',
  'wx-account-delete-test'
);

UPDATE public.account_deletion_jobs
SET stage = 'storage_deleted', updated_at = now()
WHERE user_id = '98000000-0000-4000-8000-000000000091'
  AND stage = 'requested';

UPDATE public.account_deletion_jobs
SET stage = 'auth_deleted', updated_at = now()
WHERE user_id = '98000000-0000-4000-8000-000000000091'
  AND stage = 'storage_deleted';

UPDATE public.account_deletion_jobs
SET stage = 'completed',
    wechat_openid = NULL,
    completed_at = now(),
    updated_at = now()
WHERE user_id = '98000000-0000-4000-8000-000000000091'
  AND stage = 'auth_deleted';

DO $test$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.account_deletion_jobs
    WHERE user_id = '98000000-0000-4000-8000-000000000091'
      AND stage = 'completed'
      AND completed_at IS NOT NULL
      AND wechat_openid IS NULL
  ) THEN
    RAISE EXCEPTION 'regression_failed: monotonic checkpoints did not persist';
  END IF;

  IF pg_catalog.has_function_privilege(
       'anon',
       'private.current_account_storage_writes_allowed()',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role',
       'private.current_account_storage_writes_allowed()',
       'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'authenticated',
       'private.current_account_storage_writes_allowed()',
       'EXECUTE'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc AS function
       WHERE function.oid =
         'private.current_account_storage_writes_allowed()'::pg_catalog.regprocedure
         AND function.prosecdef
         AND function.provolatile = 's'
         AND COALESCE(function.proconfig, ARRAY[]::text[])
           = ARRAY['search_path=pg_catalog']::text[]
     ) THEN
    RAISE EXCEPTION 'regression_failed: Storage tombstone helper security contract';
  END IF;

  BEGIN
    INSERT INTO public.account_deletion_jobs (user_id, stage)
    VALUES ('98000000-0000-4000-8000-000000000092', 'invalid');
    RAISE EXCEPTION 'expected invalid deletion stage to fail';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.account_deletion_jobs (user_id, stage)
    VALUES ('98000000-0000-4000-8000-000000000093', 'completed');
    RAISE EXCEPTION 'expected completed job without completed_at to fail';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$test$;

-- The service API can advance a checkpoint but cannot delete the completed
-- tombstone. Only an explicit database-owner intervention may erase it.
SET LOCAL ROLE service_role;

DO $test$
BEGIN
  BEGIN
    DELETE FROM public.account_deletion_jobs
    WHERE user_id = '98000000-0000-4000-8000-000000000091';
    RAISE EXCEPTION 'expected completed deletion tombstone DELETE to fail';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$test$;

RESET ROLE;

-- A completed row is deliberately retained as the permanent tombstone. Even
-- an access JWT that remains cryptographically valid after GoTrue deletion
-- must no longer be able to upload into that uid's item-images folder.
-- Clear the earlier authenticated fixture identity before this owner-level
-- setup write. The final release state also has the public-upload validation
-- trigger, which must not mistake maintenance setup for an end-user upload.
SELECT pg_catalog.set_config('request.jwt.claim.sub', '', true);

INSERT INTO storage.objects (bucket_id, name, metadata)
VALUES (
  'item-images',
  'items/98000000-0000-4000-8000-000000000091/existing-before-delete.jpg',
  '{"mimetype":"image/jpeg","size":10,"state":"before"}'::jsonb
);

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '98000000-0000-4000-8000-000000000091',
  true
);

DO $test$
BEGIN
  IF private.current_account_storage_writes_allowed() THEN
    RAISE EXCEPTION 'regression_failed: completed deletion tombstone allowed Storage writes';
  END IF;

  BEGIN
    INSERT INTO storage.objects (bucket_id, name, metadata)
    VALUES (
      'item-images',
      'items/98000000-0000-4000-8000-000000000091/blocked-after-delete.jpg',
      '{"mimetype":"image/jpeg","size":10}'::jsonb
    );
    RAISE EXCEPTION 'expected deletion-tombstoned upload to fail';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  UPDATE storage.objects
  SET metadata = '{"mimetype":"image/jpeg","size":10,"state":"after"}'::jsonb
  WHERE bucket_id = 'item-images'
    AND name = 'items/98000000-0000-4000-8000-000000000091/existing-before-delete.jpg';
  IF FOUND THEN
    RAISE EXCEPTION 'regression_failed: deletion-tombstoned UPDATE was allowed';
  END IF;
END
$test$;

RESET ROLE;

-- A different authenticated account with no deletion job keeps the ordinary
-- path-scoped upload behavior; the restrictive policy is not a global outage.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '98000000-0000-4000-8000-000000000099',
  true
);

DO $test$
BEGIN
  IF NOT private.current_account_storage_writes_allowed() THEN
    RAISE EXCEPTION 'regression_failed: unrelated account was blocked from Storage';
  END IF;
END
$test$;

INSERT INTO storage.objects (bucket_id, name, metadata)
VALUES (
  'item-images',
  'items/98000000-0000-4000-8000-000000000099/allowed.jpg',
  '{"mimetype":"image/jpeg","size":10}'::jsonb
);

UPDATE storage.objects
SET metadata = '{"mimetype":"image/jpeg","size":10,"state":"updated"}'::jsonb
WHERE bucket_id = 'item-images'
  AND name = 'items/98000000-0000-4000-8000-000000000099/allowed.jpg';

RESET ROLE;

DO $test$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM storage.objects
    WHERE bucket_id = 'item-images'
      AND name = 'items/98000000-0000-4000-8000-000000000091/blocked-after-delete.jpg'
  ) THEN
    RAISE EXCEPTION 'regression_failed: tombstoned upload reached storage.objects';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects
    WHERE bucket_id = 'item-images'
      AND name = 'items/98000000-0000-4000-8000-000000000099/allowed.jpg'
      AND metadata->>'state' = 'updated'
  ) THEN
    RAISE EXCEPTION 'regression_failed: unrelated Storage write was rejected';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects
    WHERE bucket_id = 'item-images'
      AND name = 'items/98000000-0000-4000-8000-000000000091/existing-before-delete.jpg'
      AND metadata->>'state' = 'before'
  ) THEN
    RAISE EXCEPTION 'regression_failed: tombstoned object UPDATE was not blocked';
  END IF;
END
$test$;

INSERT INTO public.wechat_password_map (openid, password)
VALUES ('wx-account-delete-test', repeat('a', 64))
ON CONFLICT (openid) DO UPDATE SET password = EXCLUDED.password;

SET LOCAL ROLE service_role;

DO $wechat_cleanup$
BEGIN
  IF pg_catalog.to_regprocedure(
       'public.delete_wechat_password_credential(text)'
     ) IS NOT NULL THEN
    IF public.delete_wechat_password_credential(
         'wx-account-delete-test'
       ) IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'regression_failed: retired-map exact cleanup failed';
    END IF;
  ELSE
    -- Pre-retirement compatibility for verifying migration 20260717194646 in
    -- isolation, while service_role still has the historical SELECT grant.
    DELETE FROM public.wechat_password_map
    WHERE openid = 'wx-account-delete-test';
  END IF;
END
$wechat_cleanup$;

RESET ROLE;

DO $test$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.wechat_password_map
    WHERE openid = 'wx-account-delete-test'
  ) THEN
    RAISE EXCEPTION 'regression_failed: service_role could not delete WeChat map';
  END IF;
END
$test$;

ROLLBACK;
