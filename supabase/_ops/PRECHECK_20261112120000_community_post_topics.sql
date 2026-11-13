-- Read-only deployment precheck for 20261112120000_community_post_topics.sql
-- (ENGINEERING §5.1). Run as postgres right before the migration.
--
-- The two md5(prosrc) values are what the local L-SQL replay
-- (docker.io/supabase/postgres:17.6.1.104, RUNBOOK §5.1) reads right after
-- 20261003175231_admin_support_email_ledger.sql. No migration sits between that
-- one and this file, and origin/main has no migration since 2026-10-26 (P2.5 ③),
-- so a different value means the hosted function was changed outside this
-- repository and the post branch this migration reissues must be re-reviewed.
\set ON_ERROR_STOP on
BEGIN;
SET TRANSACTION READ ONLY;
DO $precheck$
DECLARE
  legacy_view constant text[] := ARRAY[
    'id', 'user_id', 'content', 'images', 'is_official', 'is_pinned',
    'like_count', 'comment_count', 'status', 'created_at', 'updated_at'];
  view_columns text[];
  snapshot_md5 text;
  detail_md5 text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
              WHERE attrelid = 'public.posts'::regclass AND NOT attisdropped
                AND attname IN ('title', 'category', 'region')) THEN
    RAISE EXCEPTION 'community_topics_columns_already_exist';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS routine
               JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = routine.pronamespace
              WHERE namespace.nspname = 'public' AND routine.proname = 'search_community_posts') THEN
    RAISE EXCEPTION 'community_topics_search_rpc_already_exists';
  END IF;
  IF pg_catalog.to_regprocedure('public.search_posts_fuzzy(text[],text,integer,integer)') IS NULL THEN
    RAISE EXCEPTION 'community_topics_legacy_search_rpc_missing';
  END IF;

  -- CREATE OR REPLACE VIEW can only append: accept the repository's 11 columns,
  -- or those 11 plus source_lang (hosted may already carry it, ENGINEERING §13).
  SELECT pg_catalog.array_agg(attname::text ORDER BY attnum) INTO view_columns
    FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.posts_visible'::regclass AND attnum > 0 AND NOT attisdropped;
  IF view_columns IS DISTINCT FROM legacy_view
     AND view_columns IS DISTINCT FROM legacy_view || ARRAY['source_lang'] THEN
    RAISE EXCEPTION 'community_topics_posts_visible_drift:%',
      pg_catalog.array_to_string(view_columns, ',');
  END IF;

  SELECT pg_catalog.md5(prosrc) INTO snapshot_md5 FROM pg_catalog.pg_proc
   WHERE oid = pg_catalog.to_regprocedure('public.capture_report_target_snapshot()');
  SELECT pg_catalog.md5(prosrc) INTO detail_md5 FROM pg_catalog.pg_proc
   WHERE oid = pg_catalog.to_regprocedure('public.admin_get_report_detail(uuid)');
  IF snapshot_md5 IS DISTINCT FROM '07d707ba21ec0bb83efb52fe8fa1083a'
     OR detail_md5 IS DISTINCT FROM '6cad64c7ee3ff3a13fbbc8a0491a22e7' THEN
    RAISE EXCEPTION 'community_topics_rewritten_function_drift:%:%', snapshot_md5, detail_md5;
  END IF;
END;
$precheck$;
ROLLBACK;
