-- Read-only; safe after the matching migration in staging or production.
\set ON_ERROR_STOP on
BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
DO $verify$
DECLARE helper oid := 'moderation_private.hidden_content_profile_ids()'::regprocedure;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='public.items'::regclass)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid='public.items'::regclass
      AND polname='Anyone can view active items' AND polcmd='r'
      AND pg_catalog.pg_get_expr(polqual,polrelid) LIKE '%moderation_private.hidden_content_profile_ids()%')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid=helper
      AND prosecdef AND provolatile='s' AND proconfig=ARRAY['search_path=pg_catalog']
      AND proowner=(SELECT proowner FROM pg_catalog.pg_proc WHERE oid='moderation_private.profile_content_visible(uuid)'::regprocedure))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p,
      LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      WHERE p.oid=helper AND a.grantee=0)
    OR NOT has_function_privilege('anon',helper,'EXECUTE')
    OR NOT has_function_privilege('authenticated',helper,'EXECUTE')
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid IN
      ('public.search_items_fuzzy'::regproc,'public.search_items_fuzzy_v2'::regproc) AND prosecdef)
  THEN RAISE EXCEPTION 'statement_scoped_listing_visibility_verification_failed'; END IF;
END;
$verify$;
ROLLBACK;
