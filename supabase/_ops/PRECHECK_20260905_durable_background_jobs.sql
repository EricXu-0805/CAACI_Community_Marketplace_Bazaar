-- Read-only. A failure is a schema reconciliation task, not permission to
-- drop existing queues or replay historical migrations.
\set ON_ERROR_STOP on
BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
DO $$
BEGIN
  IF to_regclass('private.listing_notification_jobs') IS NOT NULL
    OR to_regclass('private.moderation_media_jobs') IS NOT NULL
    OR to_regclass('private.notification_digest_cursor') IS NOT NULL THEN
    RAISE EXCEPTION 'background_jobs_already_present_use_VERIFY';
  END IF;
  IF to_regprocedure('public.notify_followers_on_new_item()') IS NULL
    OR to_regprocedure('public.notify_saved_search_matches()') IS NULL
    OR to_regprocedure('moderation_private.current_profile_state(uuid)') IS NULL THEN
    RAISE EXCEPTION 'missing_notification_privacy_prerequisite';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.notifications'::regclass
    AND polname='Listing notifications require visible items' AND NOT polpermissive) THEN
    RAISE EXCEPTION 'apply_listing_privacy_boundary_first';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
    AND table_name='notifications' AND column_name='emailed_at') THEN
    RAISE EXCEPTION 'notification_delivery_schema_missing';
  END IF;
END $$;
SELECT (SELECT count(*) FROM public.items WHERE status='deleted' AND cardinality(images)>0) AS previously_hidden_items_with_media,
       (SELECT count(*) FROM public.posts WHERE status='hidden' AND cardinality(images)>0) AS previously_hidden_posts_with_media;
ROLLBACK;
