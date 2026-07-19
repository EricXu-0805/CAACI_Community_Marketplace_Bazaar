-- Read-only prerequisites for 20260718280000_reconcile_app_table_acl_boundaries.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $precheck$
DECLARE
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'banners', 'banners_live', 'blocks', 'conversation_archives',
    'conversations', 'favorites', 'follows', 'items', 'meetups', 'messages',
    'notifications', 'offers', 'post_comment_likes', 'post_comments',
    'post_items', 'post_likes', 'posts', 'profiles', 'ratings', 'reports',
    'saved_searches', 'suspensions'
  ] LOOP
    IF pg_catalog.to_regclass('public.' || relation_name) IS NULL THEN
      RAISE EXCEPTION 'precheck_failed: relation missing: %', relation_name;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
      AS required(role_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles AS role
      WHERE role.rolname = required.role_name
    )
  ) THEN
    RAISE EXCEPTION 'precheck_failed: Data API role missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(ARRAY[
      'banners', 'blocks', 'conversation_archives', 'conversations',
      'favorites', 'follows', 'items', 'meetups', 'messages', 'notifications',
      'offers', 'post_comment_likes', 'post_comments', 'post_items',
      'post_likes', 'posts', 'profiles', 'ratings', 'reports',
      'saved_searches', 'suspensions'
    ]) AS required(relation_name)
    JOIN pg_catalog.pg_class AS relation
      ON relation.oid = pg_catalog.to_regclass(
        'public.' || required.relation_name
      )
    WHERE relation.relkind <> 'r' OR NOT relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'precheck_failed: base relation lacks RLS';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = 'public.banners_live'::pg_catalog.regclass
      AND relation.relkind = 'v'
      AND 'security_invoker=true' = ANY(COALESCE(relation.reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'precheck_failed: banners_live is not security_invoker';
  END IF;

  -- These are the privacy-critical and latest-schema columns. The migration
  -- contains the full projection; checking the drift-prone subset here keeps
  -- an older partial deployment from receiving an incomplete ACL contract.
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('profiles', 'phone'),
      ('profiles', 'email'),
      ('profiles', 'wechat_openid'),
      ('profiles', 'trust_score'),
      ('profiles', 'last_fp_hash'),
      ('profiles', 'verified_illini_email'),
      ('items', 'listing_type'),
      ('post_comments', 'status'),
      ('messages', 'reminded_at'),
      ('notifications', 'source_event_key'),
      ('saved_searches', 'listing_type')
    ) AS required(table_name, column_name)
    LEFT JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = pg_catalog.to_regclass(
        'public.' || required.table_name
      )
     AND attribute.attname = required.column_name
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
    WHERE attribute.attname IS NULL
  ) THEN
    RAISE EXCEPTION 'precheck_failed: required ACL column missing';
  END IF;
END;
$precheck$;

-- Evidence only: this intentionally does not fail on the drift the migration
-- is meant to repair.
SELECT
  pg_catalog.has_table_privilege('anon', 'public.profiles', 'SELECT')
    AS anon_profiles_full_select_before,
  pg_catalog.has_column_privilege('anon', 'public.profiles', 'email', 'SELECT')
    AS anon_profiles_email_before,
  pg_catalog.has_table_privilege('authenticated', 'public.blocks', 'SELECT')
    OR pg_catalog.has_column_privilege(
      'authenticated', 'public.blocks', 'blocked_id', 'SELECT'
    ) AS authenticated_blocks_read_before,
  pg_catalog.has_table_privilege('anon', 'public.banners', 'SELECT')
    OR pg_catalog.has_column_privilege(
      'anon', 'public.banners', 'image_url', 'SELECT'
    ) AS anon_banner_dependency_read_before;

ROLLBACK;
