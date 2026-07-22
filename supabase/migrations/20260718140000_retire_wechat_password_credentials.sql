-- Retire the password-era WeChat credential surface after the Auth passwords
-- have been rotated by scripts/retire-wechat-passwords.mjs.
--
-- Deployment order is a security boundary:
--   1. deploy and verify the passwordless wechat-login edge route;
--   2. drain password-era route instances;
--   3. run the retirement script in dry-run, then explicit apply mode;
--   4. only then apply this migration.
--
-- The table/functions remain temporarily because the durable account-deletion
-- worker still issues a service-role DELETE for compatibility. No caller may
-- read or create a reusable credential after this migration.

BEGIN;

LOCK TABLE public.wechat_password_map IN ACCESS EXCLUSIVE MODE;

DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.wechat_password_map
    LIMIT 1
  ) THEN
    RAISE EXCEPTION
      'wechat_password_map_not_empty: run scripts/retire-wechat-passwords.mjs before this migration'
      USING ERRCODE = '55000';
  END IF;
END
$guard$;

REVOKE ALL ON TABLE public.wechat_password_map
  FROM PUBLIC, anon, authenticated, service_role;

-- Retained only for the account-deletion saga until its compatibility sweep
-- is removed in a later deployment.
GRANT DELETE ON TABLE public.wechat_password_map TO service_role;

-- DELETE ... WHERE openid = ... also requires SELECT on the filtered column.
-- Keep the retired table non-readable and expose one exact, non-enumerating
-- compatibility operation to the durable account-deletion worker instead.
CREATE OR REPLACE FUNCTION public.delete_wechat_password_credential(
  openid_in text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  deleted_rows integer;
BEGIN
  IF openid_in IS NULL
     OR pg_catalog.length(openid_in) < 4
     OR pg_catalog.length(openid_in) > 128 THEN
    RAISE EXCEPTION 'invalid_openid' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.wechat_password_map
  WHERE openid = openid_in;
  GET DIAGNOSTICS deleted_rows = ROW_COUNT;

  RETURN deleted_rows = 1;
END
$function$;

REVOKE ALL ON FUNCTION public.delete_wechat_password_credential(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_wechat_password_credential(text)
  TO service_role;

REVOKE ALL ON FUNCTION public.wechat_password_lookup(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.wechat_password_store(text, text)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.wechat_password_map IS
  'RETIRED credential map. Must remain empty. service_role DELETE only for account-deletion compatibility; drop after that worker no longer references it.';

COMMENT ON FUNCTION public.wechat_password_lookup(text) IS
  'RETIRED. No API role may execute this historical plaintext credential lookup.';
COMMENT ON FUNCTION public.wechat_password_store(text, text) IS
  'RETIRED. No API role may execute this historical plaintext credential writer.';
COMMENT ON FUNCTION public.delete_wechat_password_credential(text) IS
  'Service-role-only exact openid cleanup for the durable account-deletion saga. Returns only whether one retired row was removed.';

NOTIFY pgrst, 'reload schema';

COMMIT;
