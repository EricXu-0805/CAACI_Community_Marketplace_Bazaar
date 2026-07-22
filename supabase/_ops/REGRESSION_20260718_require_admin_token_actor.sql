-- Isolated/local behavior regression for required admin-token actors.
-- NEVER run against production.

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('aa170000-0000-4000-8000-000000000001', 'admin-actor@example.test', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, nickname, email) VALUES
  ('aa170000-0000-4000-8000-000000000001', 'Attributed Admin', 'admin-actor@example.test')
ON CONFLICT (id) DO UPDATE SET nickname = EXCLUDED.nickname;

DO $constraints$
BEGIN
  BEGIN
    INSERT INTO public.admin_tokens (
      id, token_hash, admin_id, admin_name, admin_email, expires_at
    ) VALUES (
      'aa170000-0000-4000-8000-000000000010',
      pg_catalog.repeat('1', 64),
      NULL,
      'Unattributed Admin',
      'unattributed@example.test',
      pg_catalog.now() + interval '1 day'
    );
    RAISE EXCEPTION 'admin_tokens accepted a NULL actor';
  -- Before lifecycle evidence preservation this is rejected by NOT NULL. The
  -- later migration permits NULL only for an already-revoked detached row, so
  -- the same unsafe active row is rejected by the detached/revoked CHECK.
  EXCEPTION WHEN not_null_violation OR check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.admin_tokens (
      id, token_hash, admin_id, admin_name, admin_email, expires_at
    ) VALUES (
      'aa170000-0000-4000-8000-000000000011',
      pg_catalog.repeat('2', 64),
      'aa170000-0000-4000-8000-000000000002',
      'Orphan Admin',
      'orphan@example.test',
      pg_catalog.now() + interval '1 day'
    );
    RAISE EXCEPTION 'admin_tokens accepted an actor without a profile';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END
$constraints$;

INSERT INTO public.admin_tokens (
  id, token_hash, admin_id, admin_name, admin_email, expires_at
) VALUES (
  'aa170000-0000-4000-8000-000000000012',
  pg_catalog.repeat('3', 64),
  'aa170000-0000-4000-8000-000000000001',
  'Attributed Admin',
  'admin-actor@example.test',
  pg_catalog.now() + interval '1 day'
);

SET LOCAL ROLE service_role;

DO $validate_actor$
DECLARE
  resolved_actor uuid;
  resolved_name text;
  resolved_email text;
BEGIN
  SELECT validation.admin_id, validation.admin_name, validation.admin_email
    INTO resolved_actor, resolved_name, resolved_email
    FROM public.admin_token_validate(pg_catalog.repeat('3', 64)) AS validation;

  IF resolved_actor <> 'aa170000-0000-4000-8000-000000000001'::uuid
     OR resolved_name <> 'Attributed Admin'
     OR resolved_email <> 'admin-actor@example.test' THEN
    RAISE EXCEPTION 'active token did not resolve its exact actor identity';
  END IF;
END
$validate_actor$;

RESET ROLE;

DO $last_used$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.admin_tokens AS token
     WHERE token.id = 'aa170000-0000-4000-8000-000000000012'
       AND token.admin_id = 'aa170000-0000-4000-8000-000000000001'
       AND token.last_used_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'token validation did not preserve actor or update usage';
  END IF;
END
$last_used$;

ROLLBACK;

-- The filesystem-side mint contract is exercised by:
--   node --test scripts/admin-token-mint.test.mjs
