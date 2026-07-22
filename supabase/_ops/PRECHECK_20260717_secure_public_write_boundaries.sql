-- Read-only pre-deploy snapshot for 20260717092804_secure_public_write_boundaries.
-- Run against staging/production before applying the migration and save output.

-- Fail early on schema drift before the forward migration reaches an ALTER,
-- column-level GRANT, or function body. This block is read-only.
\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $precheck$
DECLARE
  required_name text;
  required_column record;
BEGIN
  FOREACH required_name IN ARRAY ARRAY[
    'anon', 'authenticated', 'service_role'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = required_name
    ) THEN
      RAISE EXCEPTION 'precheck_failed: missing role %', required_name;
    END IF;
  END LOOP;

  FOREACH required_name IN ARRAY ARRAY[
    'auth.users',
    'public.profiles', 'public.items', 'public.conversations',
    'public.messages', 'public.posts', 'public.post_comments',
    'public.reports', 'public.ratings', 'public.notifications',
    'public.banners', 'public.banners_live', 'public.edge_rate_limits'
  ] LOOP
    IF pg_catalog.to_regclass(required_name) IS NULL THEN
      RAISE EXCEPTION 'precheck_failed: missing relation %', required_name;
    END IF;
  END LOOP;

  FOREACH required_name IN ARRAY ARRAY[
    'public.item_category', 'public.item_condition',
    'public.item_status', 'public.message_type'
  ] LOOP
    IF pg_catalog.to_regtype(required_name) IS NULL THEN
      RAISE EXCEPTION 'precheck_failed: missing type %', required_name;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pg_trgm'
  ) THEN
    RAISE EXCEPTION 'precheck_failed: pg_trgm extension missing';
  END IF;

  FOREACH required_name IN ARRAY ARRAY[
    'auth.uid()',
    'public.generate_uid()',
    'public.content_moderation_check(text)',
    'public.recompute_seller_response(uuid)',
    'public.record_consent(text)',
    'public.mark_onboarded(text,text,text)'
  ] LOOP
    IF pg_catalog.to_regprocedure(required_name) IS NULL THEN
      RAISE EXCEPTION 'precheck_failed: missing function %', required_name;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.edge_rate_limits'::pg_catalog.regclass
      AND conname = 'edge_rate_limits_pkey'
      AND contype = 'p'
  ) THEN
    RAISE EXCEPTION 'precheck_failed: edge_rate_limits_pkey missing';
  END IF;

  FOR required_column IN
    SELECT spec.schema_name, spec.table_name, column_name
    FROM (VALUES
      ('auth', 'users', ARRAY[
        'id', 'email', 'raw_user_meta_data'
      ]::text[]),
      ('public', 'profiles', ARRAY[
        'id', 'email', 'nickname', 'avatar_url', 'bio', 'location',
        'is_illini_verified', 'uid', 'status_text', 'status_emoji',
        'trust_score', 'shadow_banned', 'suspension_level', 'tos_version',
        'consented_at', 'onboarded_at', 'campus_area'
      ]::text[]),
      ('public', 'items', ARRAY[
        'id', 'user_id', 'title', 'description', 'price', 'category',
        'condition', 'status', 'location', 'images', 'image_dimensions',
        'title_i18n', 'description_i18n', 'source_lang', 'negotiable',
        'listing_type', 'location_verified', 'view_count', 'favorite_count',
        'created_at'
      ]::text[]),
      ('public', 'conversations', ARRAY[
        'id', 'item_id', 'buyer_id', 'seller_id', 'last_message_at',
        'created_at', 'is_pinned_buyer', 'is_pinned_seller',
        'is_muted_buyer', 'is_muted_seller'
      ]::text[]),
      ('public', 'messages', ARRAY[
        'conversation_id', 'sender_id', 'content', 'message_type',
        'is_read', 'created_at'
      ]::text[]),
      ('public', 'posts', ARRAY[
        'user_id', 'content', 'images', 'image_dimensions', 'content_i18n',
        'source_lang', 'is_pinned', 'like_count', 'comment_count', 'created_at'
      ]::text[]),
      ('public', 'post_comments', ARRAY[
        'post_id', 'user_id', 'content', 'parent_comment_id', 'created_at',
        'like_count', 'status'
      ]::text[]),
      ('public', 'reports', ARRAY[
        'reporter_id', 'target_type', 'target_id', 'reason', 'note',
        'status', 'created_at'
      ]::text[]),
      ('public', 'ratings', ARRAY[
        'rater_id', 'ratee_id', 'item_id', 'stars', 'comment', 'created_at'
      ]::text[]),
      ('public', 'notifications', ARRAY[
        'id', 'user_id', 'type', 'item_id', 'is_read', 'created_at'
      ]::text[]),
      ('public', 'banners', ARRAY[
        'active', 'is_default', 'start_at', 'end_at'
      ]::text[]),
      ('public', 'edge_rate_limits', ARRAY[
        'bucket', 'count', 'window_start'
      ]::text[])
    ) AS spec(schema_name, table_name, column_names)
    CROSS JOIN LATERAL pg_catalog.unnest(spec.column_names) AS column_name
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns AS existing_column
      WHERE existing_column.table_schema = required_column.schema_name
        AND existing_column.table_name = required_column.table_name
        AND existing_column.column_name = required_column.column_name
    ) THEN
      RAISE EXCEPTION 'precheck_failed: missing column %.%.%',
        required_column.schema_name,
        required_column.table_name,
        required_column.column_name;
    END IF;
  END LOOP;
END
$precheck$;

SELECT 'negative_item_prices' AS check_name, count(*)::bigint AS finding_count
FROM public.items
WHERE price < 0
UNION ALL
SELECT 'auth_users_missing_profiles', count(*)::bigint
FROM auth.users AS auth_user
LEFT JOIN public.profiles AS profile ON profile.id = auth_user.id
WHERE profile.id IS NULL
UNION ALL
SELECT 'legacy_client_verified_locations', count(*)::bigint
FROM public.items
WHERE location_verified = true
UNION ALL
SELECT 'untrusted_consent_versions', count(*)::bigint
FROM public.profiles
WHERE tos_version IS NULL
   OR tos_version NOT IN ('0', '2026-04-20', '2026-07-18');

SELECT
  grantee,
  table_name,
  column_name,
  privilege_type
FROM information_schema.column_privileges
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated')
  AND table_name IN (
    'items', 'posts', 'messages', 'post_comments', 'reports', 'profiles',
    'ratings', 'conversations', 'notifications'
  )
  AND privilege_type IN ('INSERT', 'UPDATE')
ORDER BY table_name, grantee, privilege_type, column_name;

SELECT
  grantee,
  table_name,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated')
  AND table_name IN (
    'items', 'posts', 'messages', 'post_comments', 'reports', 'profiles',
    'ratings', 'conversations', 'notifications'
  )
  AND privilege_type = 'DELETE'
ORDER BY table_name, grantee;

SELECT
  routine.proname AS procedure_name,
  pg_catalog.pg_get_function_identity_arguments(routine.oid) AS signature,
  routine.prosecdef,
  routine.proconfig,
  routine.proacl
FROM pg_catalog.pg_proc AS routine
WHERE routine.pronamespace = 'public'::pg_catalog.regnamespace
  AND routine.proname IN (
    'handle_new_user', 'get_last_messages', 'increment_view_count',
    'recompute_seller_response', 'edge_rate_hit', 'search_items_fuzzy',
    'attach_notification_conversation', 'record_consent', 'mark_onboarded'
  )
ORDER BY procedure_name, signature;

SELECT reloptions
FROM pg_catalog.pg_class
WHERE oid = 'public.banners_live'::pg_catalog.regclass;

ROLLBACK;
