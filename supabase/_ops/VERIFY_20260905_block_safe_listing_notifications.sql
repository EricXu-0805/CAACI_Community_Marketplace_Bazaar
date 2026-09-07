-- Read-only structure/ACL check; behavioral and concurrency checks are in the
-- matching local REGRESSION launcher. This does not claim hosted E2E coverage.
\set ON_ERROR_STOP on
BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
DO $verify$
DECLARE target text; function_id oid; body text; api_role text;
BEGIN
  FOREACH target IN ARRAY ARRAY['public.notify_followers_on_new_item()','public.notify_saved_search_matches()'] LOOP
    function_id := to_regprocedure(target);
    IF function_id IS NULL THEN RAISE EXCEPTION 'listing_notifications_verify: missing function %', target; END IF;
    SELECT lower(pg_get_functiondef(function_id)) INTO body;
    IF strpos(body,'public.blocks')=0 OR strpos(body,'moderation_private.current_profile_state')=0
        OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=function_id AND prosecdef
          AND 'search_path=pg_catalog'=ANY(proconfig)) THEN
      RAISE EXCEPTION 'listing_notifications_verify: visibility/function configuration drift %', target;
    END IF;
    FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF has_function_privilege(api_role,function_id,'EXECUTE') THEN
        RAISE EXCEPTION 'listing_notifications_verify: trigger is callable by %', api_role;
      END IF;
    END LOOP;
  END LOOP;
  IF strpos(body,'for update of ss')=0 OR strpos(body,'returning ss.user_id')=0 THEN
    RAISE EXCEPTION 'listing_notifications_verify: atomic search throttle missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy
      WHERE polrelid='public.notifications'::regclass
        AND polname='Listing notifications require visible items'
        AND NOT polpermissive AND polcmd='r'
        AND (SELECT oid FROM pg_roles WHERE rolname='authenticated')=ANY(polroles)
        AND strpos(pg_get_expr(polqual,polrelid),'item_id')>0
        AND strpos(pg_get_expr(polqual,polrelid),'deleted')>0) THEN
    RAISE EXCEPTION 'listing_notifications_verify: restrictive item policy missing';
  END IF;
END
$verify$;
ROLLBACK;
