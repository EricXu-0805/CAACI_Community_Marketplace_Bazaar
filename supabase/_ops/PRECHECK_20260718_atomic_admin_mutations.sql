-- Read-only pre-deploy gate for 20260718180000_atomic_admin_mutations.sql.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $precheck$
DECLARE
  required_relation text;
  required_function text;
  audit_check text;
BEGIN
  FOREACH required_relation IN ARRAY ARRAY[
    'public.admin_tokens',
    'public.admin_audit_log',
    'public.profiles',
    'public.suspensions',
    'public.reports',
    'public.items',
    'public.posts',
    'public.post_comments',
    'public.banners'
  ] LOOP
    IF pg_catalog.to_regclass(required_relation) IS NULL THEN
      RAISE EXCEPTION 'precheck_failed: required relation % missing', required_relation;
    END IF;
  END LOOP;

  FOREACH required_function IN ARRAY ARRAY[
    'public.record_audit(text,uuid,uuid,jsonb)',
    'public.apply_ban_level(uuid,smallint,text,text,integer)',
    'public.lift_suspension(uuid,text)',
    'public.admin_update_report_status(uuid,text)',
    'public.admin_resolve_target_reports(text,uuid,text)',
    'public.admin_takedown_content(text,uuid,text)'
  ] LOOP
    IF pg_catalog.to_regprocedure(required_function) IS NULL THEN
      RAISE EXCEPTION 'precheck_failed: required function % missing', required_function;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS column_row
     WHERE column_row.attrelid = 'public.admin_tokens'::pg_catalog.regclass
       AND column_row.attname = 'admin_id'
       AND column_row.attnotnull
       AND column_row.atttypid = 'uuid'::pg_catalog.regtype
       AND NOT column_row.attisdropped
  ) OR EXISTS (
    SELECT 1 FROM public.admin_tokens AS token WHERE token.admin_id IS NULL
  ) THEN
    RAISE EXCEPTION 'precheck_failed: 170000 required token actor boundary is not applied';
  END IF;

  IF pg_catalog.to_regclass('public.admin_mutation_requests') IS NOT NULL THEN
    RAISE EXCEPTION 'precheck_failed: admin_mutation_requests already exists; reconcile migration ledger before retrying';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS column_row
     WHERE column_row.attrelid = 'public.admin_audit_log'::pg_catalog.regclass
       AND column_row.attname IN ('admin_token_id', 'idempotency_key')
       AND NOT column_row.attisdropped
  ) THEN
    RAISE EXCEPTION 'precheck_failed: partial admin audit idempotency columns already exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS column_row
     WHERE column_row.attrelid = 'public.banners'::pg_catalog.regclass
       AND column_row.attname = 'is_default'
       AND column_row.atttypid = 'boolean'::pg_catalog.regtype
       AND NOT column_row.attisdropped
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS column_row
     WHERE column_row.attrelid = 'public.banners'::pg_catalog.regclass
       AND column_row.attname = 'updated_at'
       AND column_row.atttypid = 'timestamp with time zone'::pg_catalog.regtype
       AND NOT column_row.attisdropped
  ) THEN
    RAISE EXCEPTION 'precheck_failed: banner mutation columns missing';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid)
    INTO audit_check
    FROM pg_catalog.pg_constraint AS constraint_row
   WHERE constraint_row.conrelid = 'public.admin_audit_log'::pg_catalog.regclass
     AND constraint_row.contype = 'c'
     AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%event_kind%'
   LIMIT 1;

  IF audit_check IS NULL
     OR pg_catalog.strpos(audit_check, 'ban_applied') = 0
     OR pg_catalog.strpos(audit_check, 'suspension_lifted') = 0
     OR pg_catalog.strpos(audit_check, 'report_status_changed') = 0
     OR pg_catalog.strpos(audit_check, 'content_takedown') = 0
     OR pg_catalog.strpos(audit_check, 'token_revoked') = 0
     OR pg_catalog.strpos(audit_check, 'post_pin_changed') = 0
     OR pg_catalog.strpos(audit_check, 'banner_changed') = 0 THEN
    RAISE EXCEPTION 'precheck_failed: admin audit event vocabulary is incomplete';
  END IF;
END
$precheck$;

SELECT
  pg_catalog.count(*) AS token_rows,
  pg_catalog.count(*) FILTER (
    WHERE token.revoked_at IS NULL
      AND (token.expires_at IS NULL OR token.expires_at > pg_catalog.now())
  ) AS active_token_rows,
  pg_catalog.count(DISTINCT token.admin_id) FILTER (
    WHERE token.revoked_at IS NULL
      AND (token.expires_at IS NULL OR token.expires_at > pg_catalog.now())
  ) AS active_admin_actors
FROM public.admin_tokens AS token;

SELECT
  relation.reltuples::bigint AS estimated_audit_rows,
  pg_catalog.pg_size_pretty(pg_catalog.pg_total_relation_size(relation.oid)) AS audit_size
FROM pg_catalog.pg_class AS relation
WHERE relation.oid = 'public.admin_audit_log'::pg_catalog.regclass;

ROLLBACK;
