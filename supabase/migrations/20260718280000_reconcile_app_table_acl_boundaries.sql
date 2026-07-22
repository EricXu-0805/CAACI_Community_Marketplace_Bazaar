-- Reconcile the exact Data API privileges used by the shipped app.
--
-- RLS never grants table privileges. Historical migrations created many RLS
-- policies but left their GRANTs dependent on Supabase environment defaults;
-- other migrations correctly used column grants for profiles, but a later or
-- platform-level full-table SELECT would silently expose PII because the row
-- policy intentionally makes public profile rows readable. This tail migration
-- removes both table- and column-level drift before granting only the current
-- app contract. Future columns remain private until explicitly reviewed.

BEGIN;

DO $guard$
DECLARE
  relation_name text;
  column_requirement record;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'public.banners',
    'public.banners_live',
    'public.blocks',
    'public.conversation_archives',
    'public.conversations',
    'public.favorites',
    'public.follows',
    'public.items',
    'public.meetups',
    'public.messages',
    'public.notifications',
    'public.offers',
    'public.post_comment_likes',
    'public.post_comments',
    'public.post_items',
    'public.post_likes',
    'public.posts',
    'public.profiles',
    'public.ratings',
    'public.reports',
    'public.saved_searches',
    'public.suspensions'
  ] LOOP
    IF pg_catalog.to_regclass(relation_name) IS NULL THEN
      RAISE EXCEPTION 'app_acl_prerequisite_missing: %', relation_name
        USING ERRCODE = '55000';
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
    RAISE EXCEPTION 'app_acl_api_role_missing' USING ERRCODE = '55000';
  END IF;

  -- Every base-table grant below relies on RLS. Refuse to grant first and
  -- discover a missing policy boundary later.
  FOREACH relation_name IN ARRAY ARRAY[
    'banners', 'blocks', 'conversation_archives', 'conversations',
    'favorites', 'follows', 'items', 'meetups', 'messages', 'notifications',
    'offers', 'post_comment_likes', 'post_comments', 'post_items',
    'post_likes', 'posts', 'profiles', 'ratings', 'reports',
    'saved_searches', 'suspensions'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class AS relation
      WHERE relation.oid = pg_catalog.to_regclass('public.' || relation_name)
        AND relation.relkind = 'r'
        AND relation.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'app_acl_rls_missing: %', relation_name
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = 'public.banners_live'::pg_catalog.regclass
      AND relation.relkind = 'v'
      AND 'security_invoker=true' = ANY(COALESCE(relation.reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'app_acl_banners_live_must_be_security_invoker'
      USING ERRCODE = '55000';
  END IF;

  FOR column_requirement IN
    SELECT * FROM (VALUES
      ('profiles', 'verified_illini_email'),
      ('profiles', 'response_sample'),
      ('items', 'listing_type'),
      ('items', 'favorite_count'),
      ('messages', 'reminded_at'),
      ('notifications', 'source_event_key'),
      ('posts', 'content_i18n'),
      ('post_items', 'display_order'),
      ('saved_searches', 'listing_type'),
      ('suspensions', 'appeal_note')
    ) AS required(table_name, column_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid = pg_catalog.to_regclass(
        'public.' || column_requirement.table_name
      )
        AND attribute.attname = column_requirement.column_name
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
    ) THEN
      RAISE EXCEPTION 'app_acl_column_missing: %.%',
        column_requirement.table_name, column_requirement.column_name
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END;
$guard$;

-- REVOKE ON TABLE does not clear column ACLs. Remove both shapes so a stale
-- column grant cannot survive the table-level reconciliation (or vice versa).
DO $clear_column_acl$
DECLARE
  relation_name text;
  column_list text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'banners', 'banners_live', 'blocks', 'conversation_archives',
    'conversations', 'favorites', 'follows', 'items', 'meetups', 'messages',
    'notifications', 'offers', 'post_comment_likes', 'post_comments',
    'post_items', 'post_likes', 'posts', 'profiles', 'ratings', 'reports',
    'saved_searches', 'suspensions'
  ] LOOP
    SELECT pg_catalog.string_agg(
      pg_catalog.quote_ident(attribute.attname),
      ',' ORDER BY attribute.attnum
    )
    INTO STRICT column_list
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = pg_catalog.to_regclass(
      'public.' || relation_name
    )
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped;

    EXECUTE pg_catalog.format(
      'REVOKE SELECT (%1$s), INSERT (%1$s), UPDATE (%1$s), REFERENCES (%1$s) ON TABLE public.%2$I FROM PUBLIC, anon, authenticated, service_role',
      column_list,
      relation_name
    );
    EXECUTE pg_catalog.format(
      'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role',
      relation_name
    );
  END LOOP;
END;
$clear_column_acl$;

-- service_role is the explicit server-side data plane. CRUD is sufficient for
-- the APIs in this repository; TRUNCATE/REFERENCES/TRIGGER remain ungranted.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.banners,
  public.blocks,
  public.conversation_archives,
  public.conversations,
  public.favorites,
  public.follows,
  public.items,
  public.meetups,
  public.messages,
  public.notifications,
  public.offers,
  public.post_comment_likes,
  public.post_comments,
  public.post_items,
  public.post_likes,
  public.posts,
  public.profiles,
  public.ratings,
  public.reports,
  public.saved_searches,
  public.suspensions
TO service_role;
GRANT SELECT ON TABLE public.banners_live TO service_role;

-- Public read surfaces. Column grants deliberately leave future columns
-- private. banners is needed by the security-invoker banners_live view.
GRANT SELECT (
  id, image_url, target_url, title, title_en, title_zh, priority,
  created_at, active, is_default, start_at, end_at
) ON TABLE public.banners TO anon, authenticated;
GRANT SELECT (
  id, image_url, target_url, title, title_en, title_zh, priority
) ON TABLE public.banners_live TO anon, authenticated;

GRANT SELECT (
  id, user_id, title, description, price, category, condition, status,
  location, images, view_count, created_at, updated_at, negotiable,
  image_dimensions, title_i18n, description_i18n, source_lang,
  favorite_count, location_verified, listing_type
) ON TABLE public.items TO anon, authenticated;

GRANT SELECT (
  id, user_id, content, images, is_official, is_pinned, like_count,
  comment_count, status, created_at, updated_at, image_dimensions,
  content_i18n, source_lang
) ON TABLE public.posts TO anon, authenticated;

GRANT SELECT (
  id, post_id, user_id, content, parent_comment_id, created_at, like_count,
  status
) ON TABLE public.post_comments TO anon, authenticated;

GRANT SELECT (post_id, item_id, display_order, created_at)
  ON TABLE public.post_items TO anon, authenticated;

GRANT SELECT (
  id, nickname, avatar_url, bio, location, created_at, updated_at,
  is_illini_verified, uid, avg_rating, rating_count, status_text,
  status_emoji, response_rate, response_sample
) ON TABLE public.profiles TO anon, authenticated;

GRANT SELECT (id, rater_id, ratee_id, item_id, stars, comment, created_at)
  ON TABLE public.ratings TO anon, authenticated;

-- Account-private reads.
GRANT SELECT (id, blocker_id, blocked_id, created_at)
  ON TABLE public.blocks TO authenticated;
GRANT SELECT (user_id, conversation_id, archived_at)
  ON TABLE public.conversation_archives TO authenticated;
GRANT SELECT (
  id, item_id, buyer_id, seller_id, last_message_at, created_at,
  is_pinned_buyer, is_pinned_seller, is_muted_buyer, is_muted_seller
) ON TABLE public.conversations TO authenticated;
GRANT SELECT (id, user_id, item_id, created_at)
  ON TABLE public.favorites TO authenticated;
GRANT SELECT (follower_id, followee_id, created_at)
  ON TABLE public.follows TO authenticated;
GRANT SELECT (
  id, conversation_id, item_id, from_user, to_user, spot, meet_at, status,
  parent_meetup_id, note, expires_at, created_at, updated_at
) ON TABLE public.meetups TO authenticated;
GRANT SELECT (
  id, conversation_id, sender_id, content, message_type, is_read, created_at
) ON TABLE public.messages TO authenticated;
GRANT SELECT (
  id, user_id, type, title, body, item_id, is_read, created_at,
  conversation_id
) ON TABLE public.notifications TO authenticated;
GRANT SELECT (
  id, conversation_id, item_id, from_user, to_user, price, status,
  parent_offer_id, note, expires_at, created_at, updated_at
) ON TABLE public.offers TO authenticated;
GRANT SELECT (comment_id, user_id, created_at)
  ON TABLE public.post_comment_likes TO authenticated;
GRANT SELECT (post_id, user_id, created_at)
  ON TABLE public.post_likes TO authenticated;
GRANT SELECT (
  id, user_id, keyword, category, price_min, price_max, created_at,
  last_notified_at, listing_type
) ON TABLE public.saved_searches TO authenticated;
-- profile_id/lifted_at are filter columns even though the page does not return
-- them. PostgreSQL also checks column privileges used by PostgREST filters.
GRANT SELECT (
  id, profile_id, level, reason, category, started_at, ends_at, lifted_at,
  appeal_note
)
  ON TABLE public.suspensions TO authenticated;

-- Direct authenticated writes. Generated/server-owned columns are omitted.
GRANT INSERT (blocker_id, blocked_id)
  ON TABLE public.blocks TO authenticated;
GRANT DELETE ON TABLE public.blocks TO authenticated;

GRANT INSERT (item_id, buyer_id, seller_id)
  ON TABLE public.conversations TO authenticated;
GRANT UPDATE (
  is_pinned_buyer, is_pinned_seller, is_muted_buyer, is_muted_seller
) ON TABLE public.conversations TO authenticated;

GRANT INSERT (user_id, item_id)
  ON TABLE public.favorites TO authenticated;
GRANT DELETE ON TABLE public.favorites TO authenticated;

GRANT INSERT (follower_id, followee_id)
  ON TABLE public.follows TO authenticated;
GRANT DELETE ON TABLE public.follows TO authenticated;

GRANT INSERT (
  user_id, title, description, price, category, condition, location, images,
  negotiable, image_dimensions, title_i18n, description_i18n, source_lang,
  listing_type
) ON TABLE public.items TO authenticated;
GRANT UPDATE (
  title, description, price, category, condition, status, location, images,
  negotiable, image_dimensions, title_i18n, description_i18n, source_lang
) ON TABLE public.items TO authenticated;
GRANT DELETE ON TABLE public.items TO authenticated;

GRANT INSERT (id, conversation_id, sender_id, content, message_type)
  ON TABLE public.messages TO authenticated;
GRANT UPDATE (is_read) ON TABLE public.messages TO authenticated;

GRANT UPDATE (is_read) ON TABLE public.notifications TO authenticated;
GRANT DELETE ON TABLE public.notifications TO authenticated;

GRANT INSERT (comment_id, user_id)
  ON TABLE public.post_comment_likes TO authenticated;
GRANT DELETE ON TABLE public.post_comment_likes TO authenticated;

GRANT INSERT (post_id, user_id, content, parent_comment_id)
  ON TABLE public.post_comments TO authenticated;
GRANT UPDATE (content) ON TABLE public.post_comments TO authenticated;
GRANT DELETE ON TABLE public.post_comments TO authenticated;

GRANT INSERT (post_id, item_id, display_order)
  ON TABLE public.post_items TO authenticated;
GRANT DELETE ON TABLE public.post_items TO authenticated;

GRANT INSERT (post_id, user_id)
  ON TABLE public.post_likes TO authenticated;
GRANT DELETE ON TABLE public.post_likes TO authenticated;

GRANT INSERT (
  user_id, content, images, image_dimensions, content_i18n, source_lang
) ON TABLE public.posts TO authenticated;
GRANT UPDATE (content_i18n) ON TABLE public.posts TO authenticated;
GRANT DELETE ON TABLE public.posts TO authenticated;

-- Preserve the recovery path established by 20260717092804 for the rare
-- historical Auth identity whose signup trigger did not create a profile.
-- RLS still restricts the row to auth.uid() = id; only user-owned display
-- fields are writable and every trust, moderation, contact, and metric column
-- remains server-owned.
GRANT INSERT (id, nickname, avatar_url, bio, location, status_text, status_emoji)
  ON TABLE public.profiles TO authenticated;
GRANT UPDATE (nickname, avatar_url, bio, location, status_text, status_emoji)
  ON TABLE public.profiles TO authenticated;

GRANT INSERT (reporter_id, target_type, target_id, reason, note)
  ON TABLE public.reports TO authenticated;

GRANT INSERT (
  user_id, keyword, category, price_min, price_max, listing_type
) ON TABLE public.saved_searches TO authenticated;
GRANT DELETE ON TABLE public.saved_searches TO authenticated;

COMMENT ON TABLE public.profiles IS
  'Private account row. Data API reads are restricted to the explicit public-profile column ACL reconciled by migration 20260718280000.';

COMMIT;
