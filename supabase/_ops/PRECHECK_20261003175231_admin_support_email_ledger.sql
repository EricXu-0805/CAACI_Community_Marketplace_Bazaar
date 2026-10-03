-- Read-only deployment precheck. Reconcile migration history separately.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $precheck$
BEGIN
  IF pg_catalog.to_regclass('public.admin_support_email_requests') IS NOT NULL THEN
    RAISE EXCEPTION 'support_email_ledger_already_exists';
  END IF;
  IF pg_catalog.to_regprocedure('public.admin_token_authorization_v2(text)') IS NULL
     OR pg_catalog.to_regprocedure('public.admin_token_identity_safe(text,text)') IS NULL
     OR pg_catalog.to_regclass('public.admin_role_action_capabilities') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                     WHERE conrelid = 'public.admin_audit_log'::regclass
                       AND conname = 'admin_audit_log_event_kind_check')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                     WHERE attrelid = 'public.admin_audit_log'::regclass
                       AND attname = 'idempotency_key' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'support_email_prerequisite_missing';
  END IF;
END;
$precheck$;
COMMIT;
