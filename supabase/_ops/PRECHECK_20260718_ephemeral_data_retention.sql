-- Read-only precheck for 20260718150000_ephemeral_data_retention.sql.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $precheck$
DECLARE
  relation_name text;
  edge_rate_source text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'edge_rate_limits',
    'illini_verifications',
    'wechat_media_checks'
  ]::text[] LOOP
    IF pg_catalog.to_regclass('public.' || relation_name) IS NULL THEN
      RAISE EXCEPTION 'precheck_failed: public.% missing', relation_name;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.edge_rate_limits'::pg_catalog.regclass
      AND attribute.attname = 'window_start'
      AND attribute.atttypid = 'timestamp with time zone'::pg_catalog.regtype
      AND attribute.attnotnull
      AND NOT attribute.attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.illini_verifications'::pg_catalog.regclass
      AND attribute.attname = 'expires_at'
      AND attribute.atttypid = 'timestamp with time zone'::pg_catalog.regtype
      AND attribute.attnotnull
      AND NOT attribute.attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.wechat_media_checks'::pg_catalog.regclass
      AND attribute.attname = 'created_at'
      AND attribute.atttypid = 'timestamp with time zone'::pg_catalog.regtype
      AND attribute.attnotnull
      AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION 'precheck_failed: retention timestamp contract mismatch';
  END IF;

  SELECT function.prosrc
  INTO edge_rate_source
  FROM pg_catalog.pg_proc AS function
  WHERE function.oid = pg_catalog.to_regprocedure(
    'public.edge_rate_hit(text,integer,integer)'
  );

  IF edge_rate_source IS NULL
     OR pg_catalog.strpos(
       pg_catalog.lower(edge_rate_source),
       'window_secs_in > 604800'
     ) = 0 THEN
    RAISE EXCEPTION
      'precheck_failed: edge_rate_hit must enforce a maximum seven-day window';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function
    WHERE function.pronamespace = 'public'::pg_catalog.regnamespace
      AND function.proname = 'run_ephemeral_data_retention'
      AND function.oid <> COALESCE(
        pg_catalog.to_regprocedure('public.run_ephemeral_data_retention()'),
        0::oid
      )
  ) THEN
    RAISE EXCEPTION 'precheck_failed: unexpected retention RPC overload';
  END IF;
END
$precheck$;

SELECT
  pg_catalog.to_regclass('public.edge_rate_limits') AS edge_rate_limits,
  pg_catalog.to_regclass('public.illini_verifications') AS illini_verifications,
  pg_catalog.to_regclass('public.wechat_media_checks') AS wechat_media_checks,
  pg_catalog.to_regprocedure(
    'public.run_ephemeral_data_retention()'
  ) AS existing_exact_rpc;

ROLLBACK;
