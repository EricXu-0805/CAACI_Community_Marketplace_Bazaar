-- Structural/ACL verification for recoverable banner uploads.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $verify$
DECLARE
  table_acl text;
  prepare_source text;
  complete_source text;
  gc_source text;
  validation_source text;
BEGIN
  IF pg_catalog.to_regclass('public.admin_banner_uploads') IS NULL THEN
    RAISE EXCEPTION 'verify_failed: admin_banner_uploads missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid = 'public.admin_banner_uploads'::pg_catalog.regclass
       AND relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'verify_failed: admin_banner_uploads RLS disabled';
  END IF;

  SELECT pg_catalog.array_to_string(relation.relacl, ',')
    INTO table_acl
    FROM pg_catalog.pg_class AS relation
   WHERE relation.oid = 'public.admin_banner_uploads'::pg_catalog.regclass;
  IF COALESCE(table_acl, '') ~ '(anon|authenticated|service_role)=' THEN
    RAISE EXCEPTION 'verify_failed: direct saga-table privileges granted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_row
     WHERE constraint_row.conrelid = 'public.admin_banner_uploads'::pg_catalog.regclass
       AND constraint_row.contype = 'u'
       AND pg_catalog.pg_get_constraintdef(constraint_row.oid)
         LIKE '%admin_token_id, idempotency_key%'
  ) THEN
    RAISE EXCEPTION 'verify_failed: token/idempotency uniqueness missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid = 'public.banners'::pg_catalog.regclass
       AND trigger_row.tgname = 'banners_reconcile_managed_upload'
       AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION 'verify_failed: banner attachment trigger missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid = 'public.banners'::pg_catalog.regclass
       AND trigger_row.tgname = 'banners_require_managed_upload'
       AND NOT trigger_row.tgisinternal
       AND pg_catalog.pg_get_triggerdef(trigger_row.oid) ILIKE
         '%BEFORE INSERT OR UPDATE OF image_url ON public.banners%'
  ) THEN
    RAISE EXCEPTION 'verify_failed: managed banner admission trigger missing';
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.admin_validate_banner_managed_upload()'
     ) IS NULL
     OR pg_catalog.has_function_privilege(
       'anon', 'public.admin_validate_banner_managed_upload()', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated',
       'public.admin_validate_banner_managed_upload()',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role',
       'public.admin_validate_banner_managed_upload()',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'verify_failed: managed banner validator ACL drifted';
  END IF;

  FOREACH prepare_source IN ARRAY ARRAY[
    'public.admin_prepare_banner_upload(text,uuid,text,text,integer)',
    'public.admin_complete_banner_upload(text,uuid,text)',
    'public.admin_claim_banner_upload_gc(uuid,integer)',
    'public.admin_complete_banner_upload_gc(uuid,text[])'
  ] LOOP
    IF pg_catalog.to_regprocedure(prepare_source) IS NULL THEN
      RAISE EXCEPTION 'verify_failed: function missing: %', prepare_source;
    END IF;
    IF pg_catalog.has_function_privilege('anon', prepare_source, 'EXECUTE')
       OR pg_catalog.has_function_privilege(
         'authenticated', prepare_source, 'EXECUTE'
       )
       OR NOT pg_catalog.has_function_privilege(
         'service_role', prepare_source, 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'verify_failed: function ACL drifted: %', prepare_source;
    END IF;
  END LOOP;

  SELECT pg_catalog.pg_get_functiondef(
    'public.admin_prepare_banner_upload(text,uuid,text,text,integer)'::pg_catalog.regprocedure
  ) INTO prepare_source;
  SELECT pg_catalog.pg_get_functiondef(
    'public.admin_complete_banner_upload(text,uuid,text)'::pg_catalog.regprocedure
  ) INTO complete_source;
  SELECT pg_catalog.pg_get_functiondef(
    'public.admin_claim_banner_upload_gc(uuid,integer)'::pg_catalog.regprocedure
  ) INTO gc_source;
  SELECT pg_catalog.pg_get_functiondef(
    'public.admin_validate_banner_managed_upload()'::pg_catalog.regprocedure
  ) INTO validation_source;

  IF pg_catalog.strpos(prepare_source, 'upload_banner') = 0
     OR pg_catalog.strpos(prepare_source, 'FOR UPDATE') = 0
     OR pg_catalog.strpos(prepare_source, 'idempotency_conflict') = 0 THEN
    RAISE EXCEPTION 'verify_failed: prepare authorization/idempotency drifted';
  END IF;
  IF pg_catalog.strpos(complete_source, 'admin.audit_required') = 0
     OR pg_catalog.strpos(complete_source, 'record_audit') = 0
     OR pg_catalog.strpos(complete_source, 'banner_changed') = 0 THEN
    RAISE EXCEPTION 'verify_failed: required completion audit missing';
  END IF;
  IF pg_catalog.strpos(gc_source, 'SKIP LOCKED') = 0
     OR pg_catalog.strpos(gc_source, 'gc_claim_expires_at') = 0
     OR pg_catalog.strpos(gc_source, 'NOT EXISTS') = 0 THEN
    RAISE EXCEPTION 'verify_failed: leased/reference-safe GC drifted';
  END IF;
  IF pg_catalog.strpos(
       validation_source,
       'NEW.image_url IS NOT DISTINCT FROM OLD.image_url'
     ) = 0
     OR pg_catalog.strpos(validation_source, 'upload.completed_at IS NOT NULL') = 0
     OR pg_catalog.strpos(validation_source, 'upload.status <> ''deleted''') = 0
     OR pg_catalog.strpos(validation_source, 'upload.public_path') = 0
     OR pg_catalog.strpos(validation_source, 'FOR UPDATE') = 0
     OR pg_catalog.strpos(validation_source, 'admin_upload_required') = 0
     OR pg_catalog.strpos(validation_source, 'admin_upload_gc_in_progress') = 0 THEN
    RAISE EXCEPTION 'verify_failed: managed banner admission boundary drifted';
  END IF;
END;
$verify$;

ROLLBACK;
