-- Read-only post-apply verification. No fixture, task, or provider mutation.
\set ON_ERROR_STOP on
BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
DO $$
DECLARE name text; signature text; role_name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['listing_notification_jobs','moderation_media_jobs','notification_digest_cursor'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('private.'||name) AND relrowsecurity) THEN
      RAISE EXCEPTION 'missing_private_rls: %',name;
    END IF;
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF has_table_privilege(role_name,'private.'||name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
        RAISE EXCEPTION 'direct_job_table_grant: %, %',role_name,name;
      END IF;
    END LOOP;
  END LOOP;
  FOREACH signature IN ARRAY ARRAY[
    'process_listing_notification_job(integer)','get_notification_digest_cursor()',
    'advance_notification_digest_cursor(uuid,uuid)','claim_moderation_media_job()',
    'finish_moderation_media_job(uuid,uuid,text)','background_job_status()',
    'purge_completed_background_jobs(integer)'
  ] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.'||signature)
      AND prosecdef AND 'search_path=pg_catalog'=ANY(proconfig)) THEN
      RAISE EXCEPTION 'worker_function_boundary: %',signature;
    END IF;
    IF has_function_privilege('anon','public.'||signature,'EXECUTE')
      OR has_function_privilege('authenticated','public.'||signature,'EXECUTE')
      OR NOT has_function_privilege('service_role','public.'||signature,'EXECUTE') THEN
      RAISE EXCEPTION 'worker_function_grant: %',signature;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_trigger WHERE tgname='enqueue_moderation_media_cleanup'
    AND tgrelid IN ('public.items'::regclass,'public.posts'::regclass)
    AND tgenabled='O' AND tgfoid='private.enqueue_moderation_media_cleanup()'::regprocedure)<>2 THEN
    RAISE EXCEPTION 'media_triggers_missing';
  END IF;
  IF position('private.listing_notification_jobs' IN pg_get_functiondef('public.notify_followers_on_new_item()'::regprocedure))=0
    OR position('private.listing_notification_jobs' IN pg_get_functiondef('public.notify_saved_search_matches()'::regprocedure))=0 THEN
    RAISE EXCEPTION 'listing_enqueue_missing';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.notifications'::regclass
    AND polname='Listing notifications require visible items' AND NOT polpermissive) THEN
    RAISE EXCEPTION 'listing_privacy_policy_missing';
  END IF;
END $$;
SELECT public.background_job_status() AS background_jobs, public.get_notification_digest_cursor() AS digest_cursor;
ROLLBACK;
