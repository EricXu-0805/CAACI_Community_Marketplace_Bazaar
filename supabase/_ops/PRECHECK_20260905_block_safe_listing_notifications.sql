-- Read-only prerequisites for 20260905081748_block_safe_listing_notifications.sql.
\set ON_ERROR_STOP on
BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
DO $precheck$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'public.notify_followers_on_new_item()',
    'public.notify_saved_search_matches()',
    'moderation_private.current_profile_state(uuid)'
  ] LOOP
    IF to_regprocedure(target) IS NULL THEN
      RAISE EXCEPTION 'listing_notifications_precheck: missing function %', target;
    END IF;
  END LOOP;
  FOREACH target IN ARRAY ARRAY['items','notifications','blocks','follows','saved_searches'] LOOP
    IF to_regclass('public.' || target) IS NULL THEN
      RAISE EXCEPTION 'listing_notifications_precheck: missing table %', target;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_index
      WHERE indexrelid = to_regclass('public.notifications_saved_search_unique_per_item')
        AND indisunique AND indisvalid) THEN
    RAISE EXCEPTION 'listing_notifications_precheck: missing saved-search dedup index';
  END IF;
  IF (SELECT count(*) FROM pg_class WHERE oid IN ('public.items'::regclass,'public.notifications'::regclass)
      AND relrowsecurity) <> 2 THEN
    RAISE EXCEPTION 'listing_notifications_precheck: item/notification RLS disabled';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.notifications'::regclass
      AND polname='Users read own notifications' AND polcmd='r' AND polpermissive) THEN
    RAISE EXCEPTION 'listing_notifications_precheck: recipient policy missing';
  END IF;
  FOREACH target IN ARRAY ARRAY['public.notify_followers_on_new_item()','public.notify_saved_search_matches()'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.items'::regclass
        AND tgfoid=to_regprocedure(target) AND tgenabled IN ('O','A') AND NOT tgisinternal) THEN
      RAISE EXCEPTION 'listing_notifications_precheck: live item trigger missing for %', target;
    END IF;
  END LOOP;
END
$precheck$;
ROLLBACK;
