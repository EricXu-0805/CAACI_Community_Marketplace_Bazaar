-- Transactional malicious/compatibility regression. Always rolls back.

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO public.wechat_password_map (openid, password)
VALUES
  ('retirement_regression_openid', pg_catalog.repeat('x', 64)),
  ('retirement_regression_other', pg_catalog.repeat('q', 64));

SET LOCAL ROLE service_role;

DO $service_boundary$
DECLARE
  blocked boolean;
  deleted_exact boolean;
BEGIN
  blocked := false;
  BEGIN
    PERFORM openid FROM public.wechat_password_map LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN
    blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'regression_failed: service_role SELECT allowed'; END IF;

  blocked := false;
  BEGIN
    INSERT INTO public.wechat_password_map (openid, password)
    VALUES ('retirement_regression_insert', pg_catalog.repeat('y', 64));
  EXCEPTION WHEN insufficient_privilege THEN
    blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'regression_failed: service_role INSERT allowed'; END IF;

  blocked := false;
  BEGIN
    PERFORM public.wechat_password_lookup('retirement_regression_openid');
  EXCEPTION WHEN insufficient_privilege THEN
    blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'regression_failed: retired lookup executable'; END IF;

  blocked := false;
  BEGIN
    PERFORM public.wechat_password_store(
      'retirement_regression_openid',
      pg_catalog.repeat('z', 64)
    );
  EXCEPTION WHEN insufficient_privilege THEN
    blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'regression_failed: retired store executable'; END IF;

  -- Table DELETE alone cannot read the WHERE column; the worker must use the
  -- exact RPC and never regain a credential-enumeration capability.
  blocked := false;
  BEGIN
    DELETE FROM public.wechat_password_map
    WHERE openid = 'retirement_regression_openid';
  EXCEPTION WHEN insufficient_privilege THEN
    blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'regression_failed: filtered table DELETE bypassed RPC'; END IF;

  deleted_exact := public.delete_wechat_password_credential(
    'retirement_regression_openid'
  );
  IF deleted_exact IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'regression_failed: exact service cleanup did not delete target';
  END IF;

  IF public.delete_wechat_password_credential(
       'retirement_regression_missing'
     ) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'regression_failed: missing exact cleanup reported a deletion';
  END IF;

  IF public.delete_wechat_password_credential(
       'retirement_%'
     ) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'regression_failed: wildcard input matched multiple rows';
  END IF;

  BEGIN
    PERFORM public.delete_wechat_password_credential(
      pg_catalog.repeat('x', 129)
    );
    RAISE EXCEPTION 'regression_failed: oversized openid accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'invalid_openid' THEN RAISE; END IF;
  END;
END
$service_boundary$;

RESET ROLE;
SET LOCAL ROLE anon;

DO $anon_boundary$
BEGIN
  BEGIN
    PERFORM public.delete_wechat_password_credential(
      'retirement_regression_other'
    );
    RAISE EXCEPTION 'regression_failed: anon exact cleanup executable';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$anon_boundary$;

RESET ROLE;
SET LOCAL ROLE authenticated;

DO $authenticated_boundary$
BEGIN
  BEGIN
    PERFORM public.delete_wechat_password_credential(
      'retirement_regression_other'
    );
    RAISE EXCEPTION 'regression_failed: authenticated exact cleanup executable';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$authenticated_boundary$;

RESET ROLE;

DO $exactness_verify$
BEGIN
  IF EXISTS (
       SELECT 1 FROM public.wechat_password_map
       WHERE openid = 'retirement_regression_openid'
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.wechat_password_map
       WHERE openid = 'retirement_regression_other'
     ) THEN
    RAISE EXCEPTION 'regression_failed: exact cleanup changed the wrong row';
  END IF;
END
$exactness_verify$;

ROLLBACK;
