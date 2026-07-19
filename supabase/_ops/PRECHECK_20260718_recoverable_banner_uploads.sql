-- Read-only preflight for 20260718200000_recoverable_banner_uploads.sql.
-- Run with psql -X -v ON_ERROR_STOP=1 before staging/production migration.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $precheck$
BEGIN
  IF pg_catalog.to_regclass('public.admin_tokens') IS NULL
     OR pg_catalog.to_regclass('public.admin_audit_log') IS NULL
     OR pg_catalog.to_regclass('public.banners') IS NULL THEN
    RAISE EXCEPTION 'precheck_failed: admin token/audit/banner dependencies missing';
  END IF;

  IF pg_catalog.to_regprocedure(
    'public.admin_assert_mutation_capability(uuid,text)'
  ) IS NULL OR pg_catalog.to_regprocedure(
    'public.record_audit(text,uuid,uuid,jsonb)'
  ) IS NULL THEN
    RAISE EXCEPTION 'precheck_failed: 180000/190000 admin capability chain missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.admin_role_action_capabilities AS capability
     WHERE capability.admin_role = 'owner'
       AND capability.action = 'upload_banner'
  ) THEN
    RAISE EXCEPTION 'precheck_failed: owner upload_banner capability missing';
  END IF;

  IF pg_catalog.to_regclass('public.admin_banner_uploads') IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.admin_prepare_banner_upload(text,uuid,text,text,integer)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.admin_complete_banner_upload(text,uuid,text)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'precheck_failed: recoverable banner upload objects already exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM storage.buckets AS bucket
     WHERE bucket.id = 'banners'
       AND bucket.public IS TRUE
  ) THEN
    RAISE EXCEPTION 'precheck_failed: public banners storage bucket missing';
  END IF;

  IF pg_catalog.to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION 'precheck_failed: service_role missing';
  END IF;
END;
$precheck$;

ROLLBACK;
