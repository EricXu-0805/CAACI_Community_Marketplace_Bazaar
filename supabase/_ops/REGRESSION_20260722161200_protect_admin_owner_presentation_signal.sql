-- Isolated rollback-only regression for 20260722161200.
-- NEVER run against production. Use disposable PostgreSQL 16/17 staging/local.

\set ON_ERROR_STOP on

BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

DO $require_local_superuser$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION
      'regression_refused: run only as local/staging postgres, got %',
      current_user;
  END IF;
END;
$require_local_superuser$;

SELECT pg_catalog.pg_advisory_xact_lock(20260718180000::bigint);
SELECT pg_catalog.pg_advisory_xact_lock(20260718190000::bigint);
LOCK TABLE public.admin_tokens IN SHARE ROW EXCLUSIVE MODE;

SET LOCAL session_replication_role = replica;
DELETE FROM public.admin_tokens AS token
 WHERE token.id IN (
   'f2231612-0000-4000-8000-000000000011'::uuid,
   'f2231612-0000-4000-8000-000000000012'::uuid
 )
    OR token.admin_id = 'f2231612-0000-4000-8000-000000000001'::uuid
    OR token.token_hash IN (
      pg_catalog.repeat('b', 64),
      pg_catalog.repeat('c', 64)
    );
UPDATE public.admin_tokens AS token
   SET revoked_at = COALESCE(token.revoked_at, pg_catalog.clock_timestamp())
 WHERE token.role = 'owner'
   AND token.revoked_at IS NULL;
SET LOCAL session_replication_role = origin;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (
  'f2231612-0000-4000-8000-000000000001',
  'owner-presentation-signal@example.test',
  '{}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, nickname, email, wechat_openid) VALUES (
  'f2231612-0000-4000-8000-000000000001',
  'Owner Presentation Signal',
  'owner-presentation-signal@example.test',
  NULL
)
ON CONFLICT (id) DO UPDATE SET
  nickname = EXCLUDED.nickname,
  email = EXCLUDED.email,
  wechat_openid = EXCLUDED.wechat_openid;

INSERT INTO public.admin_tokens (
  id,
  token_hash,
  admin_id,
  admin_name,
  admin_email,
  role,
  expires_at,
  last_used_at,
  revoked_at,
  created_by
) VALUES (
  'f2231612-0000-4000-8000-000000000011',
  pg_catalog.repeat('b', 64),
  'f2231612-0000-4000-8000-000000000001',
  'Owner Presentation Signal',
  'owner-presentation-signal@example.test',
  'owner',
  pg_catalog.clock_timestamp() + interval '30 days',
  pg_catalog.clock_timestamp(),
  NULL,
  'f2231612-0000-4000-8000-000000000001'
);

DO $last_recoverable_owner_presentation_clear_refused$
BEGIN
  BEGIN
    UPDATE public.admin_tokens AS token
       SET last_used_at = NULL
     WHERE token.id = 'f2231612-0000-4000-8000-000000000011';
    RAISE EXCEPTION
      'last recoverable owner presentation signal was cleared';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'last_active_owner_token' THEN
      RAISE;
    END IF;
  END;

  IF NOT EXISTS (
    SELECT 1
      FROM public.admin_tokens AS token
     WHERE token.id = 'f2231612-0000-4000-8000-000000000011'
       AND token.last_used_at IS NOT NULL
       AND public.admin_owner_token_recoverable(
         token.admin_id,
         token.role,
         token.revoked_at,
         token.expires_at,
         token.last_used_at,
         token.admin_name,
         token.admin_email
       )
  ) THEN
    RAISE EXCEPTION
      'refused presentation clear changed final recoverable owner state';
  END IF;
END;
$last_recoverable_owner_presentation_clear_refused$;

INSERT INTO public.admin_tokens (
  id,
  token_hash,
  admin_id,
  admin_name,
  admin_email,
  role,
  expires_at,
  last_used_at,
  revoked_at,
  created_by
) VALUES (
  'f2231612-0000-4000-8000-000000000012',
  pg_catalog.repeat('c', 64),
  'f2231612-0000-4000-8000-000000000001',
  'Owner Presentation Replacement',
  'owner-presentation-signal@example.test',
  'owner',
  pg_catalog.clock_timestamp() + interval '30 days',
  pg_catalog.clock_timestamp(),
  NULL,
  'f2231612-0000-4000-8000-000000000001'
);

UPDATE public.admin_tokens AS token
   SET last_used_at = NULL
 WHERE token.id = 'f2231612-0000-4000-8000-000000000011';

DO $recoverable_replacement_allows_presentation_clear$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.admin_tokens AS token
     WHERE token.id = 'f2231612-0000-4000-8000-000000000011'
       AND token.revoked_at IS NULL
       AND token.last_used_at IS NULL
  ) OR NOT EXISTS (
    SELECT 1
      FROM public.admin_tokens AS token
     WHERE token.id = 'f2231612-0000-4000-8000-000000000012'
       AND public.admin_owner_token_recoverable(
         token.admin_id,
         token.role,
         token.revoked_at,
         token.expires_at,
         token.last_used_at,
         token.admin_name,
         token.admin_email
       )
  ) THEN
    RAISE EXCEPTION
      'recoverable replacement did not allow presentation-signal clear';
  END IF;
END;
$recoverable_replacement_allows_presentation_clear$;

ROLLBACK;
