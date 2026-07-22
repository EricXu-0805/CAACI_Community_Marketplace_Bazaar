-- Isolated/local behavior regression for recoverable banner uploads.
-- NEVER run against production. All fixtures roll back.

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('c2000000-0000-4000-8000-000000000001', 'upload-owner@example.test', '{}'::jsonb),
  ('c2000000-0000-4000-8000-000000000002', 'upload-backup@example.test', '{}'::jsonb),
  ('c2000000-0000-4000-8000-000000000003', 'upload-operator@example.test', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, nickname, email) VALUES
  ('c2000000-0000-4000-8000-000000000001', 'Upload Owner', 'upload-owner@example.test'),
  ('c2000000-0000-4000-8000-000000000002', 'Upload Backup', 'upload-backup@example.test'),
  ('c2000000-0000-4000-8000-000000000003', 'Upload Operator', 'upload-operator@example.test')
ON CONFLICT (id) DO UPDATE SET
  nickname = EXCLUDED.nickname,
  email = EXCLUDED.email;

INSERT INTO public.admin_tokens (
  id, token_hash, admin_id, admin_name, admin_email, role, expires_at
) VALUES
  (
    'c2000000-0000-4000-8000-000000000011', pg_catalog.repeat('1', 64),
    'c2000000-0000-4000-8000-000000000001', 'Upload Owner',
    'upload-owner@example.test', 'owner', pg_catalog.now() + interval '1 day'
  ),
  (
    'c2000000-0000-4000-8000-000000000012', pg_catalog.repeat('2', 64),
    'c2000000-0000-4000-8000-000000000002', 'Upload Backup',
    'upload-backup@example.test', 'owner', pg_catalog.now() + interval '1 day'
  ),
  (
    'c2000000-0000-4000-8000-000000000013', pg_catalog.repeat('3', 64),
    'c2000000-0000-4000-8000-000000000003', 'Upload Operator',
    'upload-operator@example.test', 'operator', pg_catalog.now() + interval '1 day'
  );

SET LOCAL ROLE service_role;

DO $operator_denied$
BEGIN
  BEGIN
    PERFORM public.admin_prepare_banner_upload(
      pg_catalog.repeat('3', 64),
      'c2000000-0000-4000-8000-000000000101',
      pg_catalog.repeat('a', 64),
      'image/png',
      128
    );
    RAISE EXCEPTION 'operator banner upload prepare was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'admin_capability_denied' THEN RAISE; END IF;
  END;
END;
$operator_denied$;

RESET ROLE;

CREATE TEMP TABLE banner_upload_results (
  label text PRIMARY KEY,
  result jsonb NOT NULL
) ON COMMIT DROP;
GRANT SELECT, INSERT, UPDATE ON banner_upload_results TO service_role;

DO $denial_left_no_state$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.admin_banner_uploads AS upload
     WHERE upload.idempotency_key = 'c2000000-0000-4000-8000-000000000101'
  ) OR EXISTS (
    SELECT 1
      FROM public.admin_audit_log AS audit
     WHERE audit.idempotency_key = 'c2000000-0000-4000-8000-000000000101'
  ) THEN
    RAISE EXCEPTION 'capability denial left upload/audit state';
  END IF;
END;
$denial_left_no_state$;

SET LOCAL ROLE service_role;

INSERT INTO banner_upload_results VALUES (
  'prepare_primary',
  public.admin_prepare_banner_upload(
    pg_catalog.repeat('1', 64),
    'c2000000-0000-4000-8000-000000000102',
    pg_catalog.repeat('b', 64),
    'image/png',
    256
  )
);

INSERT INTO banner_upload_results VALUES (
  'prepare_replay',
  public.admin_prepare_banner_upload(
    pg_catalog.repeat('1', 64),
    'c2000000-0000-4000-8000-000000000102',
    pg_catalog.repeat('b', 64),
    'image/png',
    256
  )
);

DO $prepare_conflict$
BEGIN
  BEGIN
    PERFORM public.admin_prepare_banner_upload(
      pg_catalog.repeat('1', 64),
      'c2000000-0000-4000-8000-000000000102',
      pg_catalog.repeat('c', 64),
      'image/png',
      256
    );
    RAISE EXCEPTION 'same upload key accepted a different content hash';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'idempotency_conflict' THEN RAISE; END IF;
  END;
END;
$prepare_conflict$;

RESET ROLE;

DO $prepare_state$
DECLARE
  first_object text;
  replay_object text;
BEGIN
  SELECT result->>'object_name' INTO first_object
    FROM banner_upload_results WHERE label = 'prepare_primary';
  SELECT result->>'object_name' INTO replay_object
    FROM banner_upload_results WHERE label = 'prepare_replay';
  IF first_object IS NULL OR first_object <> replay_object
     OR first_object !~ '^managed/.+/[0-9a-f]{64}\.png$' THEN
    RAISE EXCEPTION 'prepare replay did not retain one deterministic object';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM public.admin_banner_uploads AS upload
       WHERE upload.idempotency_key = 'c2000000-0000-4000-8000-000000000102') <> 1 THEN
    RAISE EXCEPTION 'prepare replay duplicated saga rows';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.admin_audit_log AS audit
     WHERE audit.idempotency_key = 'c2000000-0000-4000-8000-000000000102'
  ) THEN
    RAISE EXCEPTION 'prepare emitted a false upload-complete audit';
  END IF;
END;
$prepare_state$;

SET LOCAL ROLE service_role;

INSERT INTO banner_upload_results VALUES (
  'complete_primary',
  public.admin_complete_banner_upload(
    pg_catalog.repeat('1', 64),
    'c2000000-0000-4000-8000-000000000102',
    pg_catalog.repeat('b', 64)
  )
);
INSERT INTO banner_upload_results VALUES (
  'complete_replay',
  public.admin_complete_banner_upload(
    pg_catalog.repeat('1', 64),
    'c2000000-0000-4000-8000-000000000102',
    pg_catalog.repeat('b', 64)
  )
);

RESET ROLE;

DO $required_audit_once$
BEGIN
  IF (SELECT upload.status FROM public.admin_banner_uploads AS upload
       WHERE upload.idempotency_key = 'c2000000-0000-4000-8000-000000000102') <> 'available' THEN
    RAISE EXCEPTION 'completion did not make the upload available';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM public.admin_audit_log AS audit
       WHERE audit.idempotency_key = 'c2000000-0000-4000-8000-000000000102'
         AND audit.event_kind = 'banner_changed'
         AND audit.details->>'op' = 'image_uploaded'
         AND audit.details->>'admin_role' = 'owner') <> 1 THEN
    RAISE EXCEPTION 'completion/replay did not emit exactly one required role audit';
  END IF;
END;
$required_audit_once$;

-- Rows created before this migration may retain their historical image while
-- unrelated fields are edited, but any actual image change must enter through
-- a completed managed upload.
ALTER TABLE public.banners DISABLE TRIGGER banners_require_managed_upload;
INSERT INTO public.banners (id, image_url, title, priority, active) VALUES (
  'c2000000-0000-4000-8000-000000000210',
  'https://legacy-cdn.example.test/banner.png',
  'legacy banner',
  0,
  false
);
ALTER TABLE public.banners ENABLE TRIGGER banners_require_managed_upload;

UPDATE public.banners
   SET image_url = image_url,
       title = 'legacy metadata edit'
 WHERE id = 'c2000000-0000-4000-8000-000000000210';

DO $legacy_change_and_unmanaged_insert_denied$
BEGIN
  IF (SELECT banner.title FROM public.banners AS banner
       WHERE banner.id = 'c2000000-0000-4000-8000-000000000210')
     <> 'legacy metadata edit' THEN
    RAISE EXCEPTION 'unchanged legacy banner metadata edit failed';
  END IF;

  BEGIN
    UPDATE public.banners
       SET image_url = 'https://tracker.example.test/pixel.png'
     WHERE id = 'c2000000-0000-4000-8000-000000000210';
    RAISE EXCEPTION 'legacy banner changed to external tracking image';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'admin_upload_required' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO public.banners (id, image_url, title, priority, active) VALUES (
      'c2000000-0000-4000-8000-000000000211',
      'https://supabase.example.test/storage/v1/object/public/banners/managed/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/'
        || pg_catalog.repeat('f', 64) || '.png',
      'untracked managed-looking path',
      0,
      false
    );
    RAISE EXCEPTION 'managed-looking path without ledger was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'admin_upload_required' THEN RAISE; END IF;
  END;
END;
$legacy_change_and_unmanaged_insert_denied$;

INSERT INTO public.banners (
  id, image_url, title, priority, active
)
SELECT
  'c2000000-0000-4000-8000-000000000201',
  'https://supabase.example.test' || upload.public_path,
  'managed upload regression',
  0,
  false
FROM public.admin_banner_uploads AS upload
WHERE upload.idempotency_key = 'c2000000-0000-4000-8000-000000000102';

DO $attachment_state$
BEGIN
  IF (SELECT upload.status FROM public.admin_banner_uploads AS upload
       WHERE upload.idempotency_key = 'c2000000-0000-4000-8000-000000000102') <> 'attached' THEN
    RAISE EXCEPTION 'banner trigger did not attach the managed upload';
  END IF;
END;
$attachment_state$;

DELETE FROM public.banners
 WHERE id = 'c2000000-0000-4000-8000-000000000201';
UPDATE public.admin_banner_uploads AS upload
   SET gc_after = pg_catalog.now() - interval '1 second'
 WHERE upload.idempotency_key = 'c2000000-0000-4000-8000-000000000102';

SET LOCAL ROLE service_role;

INSERT INTO banner_upload_results VALUES (
  'gc_claim',
  public.admin_claim_banner_upload_gc(
    'c2000000-0000-4000-8000-000000000301',
    25
  )
);

RESET ROLE;

DO $claim_blocks_reattach$
DECLARE
  managed_url text;
BEGIN
  SELECT 'https://supabase.example.test' || upload.public_path
    INTO managed_url
    FROM public.admin_banner_uploads AS upload
   WHERE upload.idempotency_key = 'c2000000-0000-4000-8000-000000000102';
  BEGIN
    INSERT INTO public.banners (id, image_url, title, priority, active) VALUES (
      'c2000000-0000-4000-8000-000000000202',
      managed_url,
      'must not attach during GC',
      0,
      false
    );
    RAISE EXCEPTION 'active GC claim allowed banner reattachment';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'admin_upload_gc_in_progress' THEN RAISE; END IF;
  END;
END;
$claim_blocks_reattach$;

SET LOCAL ROLE service_role;

DO $complete_gc$
DECLARE
  claimed text[];
  affected integer;
BEGIN
  SELECT ARRAY(
    SELECT pg_catalog.jsonb_array_elements_text(result->'object_names')
      FROM banner_upload_results
     WHERE label = 'gc_claim'
  ) INTO claimed;
  IF pg_catalog.cardinality(claimed) <> 1 THEN
    RAISE EXCEPTION 'GC did not claim exactly the detached upload';
  END IF;
  affected := public.admin_complete_banner_upload_gc(
    'c2000000-0000-4000-8000-000000000301',
    claimed
  );
  IF affected <> 1 THEN
    RAISE EXCEPTION 'GC completion count drifted';
  END IF;
END;
$complete_gc$;

DO $deleted_is_terminal$
BEGIN
  BEGIN
    PERFORM public.admin_prepare_banner_upload(
      pg_catalog.repeat('1', 64),
      'c2000000-0000-4000-8000-000000000102',
      pg_catalog.repeat('b', 64),
      'image/png',
      256
    );
    RAISE EXCEPTION 'deleted upload key was resurrected';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'admin_upload_expired' THEN RAISE; END IF;
  END;
END;
$deleted_is_terminal$;

-- Required-audit failure must roll the completion state back to prepared.
INSERT INTO banner_upload_results VALUES (
  'prepare_audit_failure',
  public.admin_prepare_banner_upload(
    pg_catalog.repeat('1', 64),
    'c2000000-0000-4000-8000-000000000103',
    pg_catalog.repeat('d', 64),
    'image/webp',
    512
  )
);

RESET ROLE;

DO $incomplete_upload_cannot_attach$
DECLARE
  incomplete_url text;
BEGIN
  SELECT 'https://supabase.example.test' || upload.public_path
    INTO STRICT incomplete_url
    FROM public.admin_banner_uploads AS upload
   WHERE upload.idempotency_key = 'c2000000-0000-4000-8000-000000000103';
  BEGIN
    INSERT INTO public.banners (id, image_url, title, priority, active) VALUES (
      'c2000000-0000-4000-8000-000000000212',
      incomplete_url,
      'prepared is not public',
      0,
      false
    );
    RAISE EXCEPTION 'prepared upload attached before completion';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'admin_upload_required' THEN RAISE; END IF;
  END;
END;
$incomplete_upload_cannot_attach$;

ALTER TABLE public.admin_audit_log
  ADD CONSTRAINT banner_upload_regression_reject_audit
  CHECK (
    idempotency_key IS DISTINCT FROM
      'c2000000-0000-4000-8000-000000000103'::uuid
  );
SET LOCAL ROLE service_role;

DO $audit_failure$
BEGIN
  BEGIN
    PERFORM public.admin_complete_banner_upload(
      pg_catalog.repeat('1', 64),
      'c2000000-0000-4000-8000-000000000103',
      pg_catalog.repeat('d', 64)
    );
    RAISE EXCEPTION 'completion survived required-audit failure';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'admin_audit_required_failed' THEN RAISE; END IF;
  END;
END;
$audit_failure$;

RESET ROLE;
ALTER TABLE public.admin_audit_log
  DROP CONSTRAINT banner_upload_regression_reject_audit;

DO $audit_failure_rollback$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.admin_banner_uploads AS upload
     WHERE upload.idempotency_key = 'c2000000-0000-4000-8000-000000000103'
       AND (upload.status <> 'prepared' OR upload.completed_at IS NOT NULL)
  ) OR EXISTS (
    SELECT 1
      FROM public.admin_audit_log AS audit
     WHERE audit.idempotency_key = 'c2000000-0000-4000-8000-000000000103'
  ) THEN
    RAISE EXCEPTION 'required-audit failure left completion/audit state';
  END IF;
END;
$audit_failure_rollback$;

-- A token revoked after prepare cannot complete; the prepared row remains GC-able.
SET LOCAL ROLE service_role;
INSERT INTO banner_upload_results VALUES (
  'prepare_then_revoke',
  public.admin_prepare_banner_upload(
    pg_catalog.repeat('1', 64),
    'c2000000-0000-4000-8000-000000000104',
    pg_catalog.repeat('e', 64),
    'image/webp',
    64
  )
);
RESET ROLE;
UPDATE public.admin_tokens AS token
   SET revoked_at = pg_catalog.now()
 WHERE token.id = 'c2000000-0000-4000-8000-000000000011';
SET LOCAL ROLE service_role;

DO $revoked_before_complete$
BEGIN
  BEGIN
    PERFORM public.admin_complete_banner_upload(
      pg_catalog.repeat('1', 64),
      'c2000000-0000-4000-8000-000000000104',
      pg_catalog.repeat('e', 64)
    );
    RAISE EXCEPTION 'revoked token completed a prepared upload';
  EXCEPTION WHEN invalid_authorization_specification THEN
    IF SQLERRM <> 'admin_token_inactive' THEN RAISE; END IF;
  END;
END;
$revoked_before_complete$;

RESET ROLE;

DO $deleted_upload_cannot_attach$
DECLARE
  deleted_url text;
BEGIN
  SELECT 'https://supabase.example.test' || upload.public_path
    INTO STRICT deleted_url
    FROM public.admin_banner_uploads AS upload
   WHERE upload.idempotency_key = 'c2000000-0000-4000-8000-000000000102';
  BEGIN
    INSERT INTO public.banners (id, image_url, title, priority, active) VALUES (
      'c2000000-0000-4000-8000-000000000213',
      deleted_url,
      'deleted is terminal',
      0,
      false
    );
    RAISE EXCEPTION 'deleted upload was reattached';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'admin_upload_required' THEN RAISE; END IF;
  END;
END;
$deleted_upload_cannot_attach$;

DO $final_state$
BEGIN
  IF (SELECT upload.status FROM public.admin_banner_uploads AS upload
       WHERE upload.idempotency_key = 'c2000000-0000-4000-8000-000000000102') <> 'deleted' THEN
    RAISE EXCEPTION 'GC did not leave a terminal deleted state';
  END IF;
  IF (SELECT upload.status FROM public.admin_banner_uploads AS upload
       WHERE upload.idempotency_key = 'c2000000-0000-4000-8000-000000000104') <> 'prepared' THEN
    RAISE EXCEPTION 'revoked completion changed prepared state';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.admin_audit_log AS audit
     WHERE audit.idempotency_key = 'c2000000-0000-4000-8000-000000000104'
  ) THEN
    RAISE EXCEPTION 'revoked completion emitted an audit';
  END IF;
END;
$final_state$;

ROLLBACK;
