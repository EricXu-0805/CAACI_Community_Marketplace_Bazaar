-- Read-only precheck. Never select the password column.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $precheck$
DECLARE
  legacy_rows bigint;
BEGIN
  IF pg_catalog.to_regclass('public.wechat_password_map') IS NULL THEN
    RAISE EXCEPTION 'precheck_failed: public.wechat_password_map missing';
  END IF;
  IF pg_catalog.to_regprocedure('public.wechat_password_lookup(text)') IS NULL
     OR pg_catalog.to_regprocedure('public.wechat_password_store(text,text)') IS NULL THEN
    RAISE EXCEPTION 'precheck_failed: legacy WeChat password RPC missing';
  END IF;

  SELECT pg_catalog.count(*) INTO legacy_rows
  FROM public.wechat_password_map;
  IF legacy_rows <> 0 THEN
    RAISE EXCEPTION
      'precheck_failed: % legacy map row(s) remain; run the reviewed retirement script first',
      legacy_rows;
  END IF;
END
$precheck$;

SELECT
  pg_catalog.count(*) AS legacy_map_rows,
  pg_catalog.has_table_privilege('service_role', 'public.wechat_password_map', 'SELECT') AS service_can_select,
  pg_catalog.has_table_privilege('service_role', 'public.wechat_password_map', 'INSERT') AS service_can_insert,
  pg_catalog.has_table_privilege('service_role', 'public.wechat_password_map', 'UPDATE') AS service_can_update,
  pg_catalog.has_table_privilege('service_role', 'public.wechat_password_map', 'DELETE') AS service_can_delete
FROM public.wechat_password_map;

ROLLBACK;
