-- Exact ACL/RLS verification for migration 20260718280000.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $verify$
DECLARE
  mismatch_count integer;
BEGIN
  -- Exact table-level ACL: service_role receives CRUD on base relations and
  -- SELECT on the view; authenticated receives only operations which cannot
  -- be expressed as column grants (the current direct DELETE paths).
  WITH base_relations(relation_name) AS (
    SELECT * FROM pg_catalog.unnest(ARRAY[
      'banners', 'blocks', 'conversation_archives', 'conversations',
      'favorites', 'follows', 'items', 'meetups', 'messages', 'notifications',
      'offers', 'post_comment_likes', 'post_comments', 'post_items',
      'post_likes', 'posts', 'profiles', 'ratings', 'reports',
      'saved_searches', 'suspensions'
    ])
  ), service_privileges(privilege_type) AS (
    SELECT * FROM pg_catalog.unnest(ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE'
    ])
  ), expected(role_name, relation_name, privilege_type) AS (
    SELECT 'service_role', relation_name, privilege_type
      FROM base_relations CROSS JOIN service_privileges
    UNION ALL SELECT 'service_role', 'banners_live', 'SELECT'
    UNION ALL
    SELECT 'authenticated', relation_name, 'DELETE'
      FROM pg_catalog.unnest(ARRAY[
        'blocks', 'favorites', 'follows', 'items', 'notifications',
        'post_comment_likes', 'post_comments', 'post_items', 'post_likes',
        'posts', 'saved_searches'
      ]) AS deletable(relation_name)
  ), actual(role_name, relation_name, privilege_type) AS (
    SELECT
      CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE role.rolname END,
      relation.relname,
      acl.privilege_type
    FROM pg_catalog.pg_class AS relation
    CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl) AS acl
    LEFT JOIN pg_catalog.pg_roles AS role ON role.oid = acl.grantee
    WHERE relation.oid IN (
      SELECT pg_catalog.to_regclass('public.' || relation_name)
      FROM (
        SELECT relation_name FROM base_relations
        UNION ALL SELECT 'banners_live'
      ) AS audited
    )
      AND (
        acl.grantee = 0
        OR role.rolname IN ('anon', 'authenticated', 'service_role')
      )
  ), differences AS (
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  )
  SELECT pg_catalog.count(*)::integer INTO mismatch_count FROM differences;

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'verify_failed: table ACL mismatch count %', mismatch_count;
  END IF;

  -- Exact column ACL. role_names makes identical anon/auth public projections
  -- one source of truth; every tuple expands to one expected attacl entry.
  WITH column_sets(role_names, relation_name, privilege_type, column_names) AS (
    VALUES
      (ARRAY['anon','authenticated'], 'banners', 'SELECT', ARRAY[
        'id','image_url','target_url','title','title_en','title_zh','priority',
        'created_at','active','is_default','start_at','end_at'
      ]),
      (ARRAY['anon','authenticated'], 'banners_live', 'SELECT', ARRAY[
        'id','image_url','target_url','title','title_en','title_zh','priority'
      ]),
      (ARRAY['anon','authenticated'], 'items', 'SELECT', ARRAY[
        'id','user_id','title','description','price','category','condition',
        'status','location','images','view_count','created_at','updated_at',
        'negotiable','image_dimensions','title_i18n','description_i18n',
        'source_lang','favorite_count','location_verified','listing_type'
      ]),
      (ARRAY['anon','authenticated'], 'posts', 'SELECT', ARRAY[
        'id','user_id','content','images','is_official','is_pinned',
        'like_count','comment_count','status','created_at','updated_at',
        'image_dimensions','content_i18n','source_lang'
      ]),
      (ARRAY['anon','authenticated'], 'post_comments', 'SELECT', ARRAY[
        'id','post_id','user_id','content','parent_comment_id','created_at',
        'like_count','status'
      ]),
      (ARRAY['anon','authenticated'], 'post_items', 'SELECT', ARRAY[
        'post_id','item_id','display_order','created_at'
      ]),
      (ARRAY['anon','authenticated'], 'profiles', 'SELECT', ARRAY[
        'id','nickname','avatar_url','bio','location','created_at','updated_at',
        'is_illini_verified','uid','avg_rating','rating_count','status_text',
        'status_emoji','response_rate','response_sample'
      ]),
      (ARRAY['anon','authenticated'], 'ratings', 'SELECT', ARRAY[
        'id','rater_id','ratee_id','item_id','stars','comment','created_at'
      ]),

      (ARRAY['authenticated'], 'blocks', 'SELECT', ARRAY[
        'id','blocker_id','blocked_id','created_at'
      ]),
      (ARRAY['authenticated'], 'conversation_archives', 'SELECT', ARRAY[
        'user_id','conversation_id','archived_at'
      ]),
      (ARRAY['authenticated'], 'conversations', 'SELECT', ARRAY[
        'id','item_id','buyer_id','seller_id','last_message_at','created_at',
        'is_pinned_buyer','is_pinned_seller','is_muted_buyer','is_muted_seller'
      ]),
      (ARRAY['authenticated'], 'favorites', 'SELECT', ARRAY[
        'id','user_id','item_id','created_at'
      ]),
      (ARRAY['authenticated'], 'follows', 'SELECT', ARRAY[
        'follower_id','followee_id','created_at'
      ]),
      (ARRAY['authenticated'], 'meetups', 'SELECT', ARRAY[
        'id','conversation_id','item_id','from_user','to_user','spot','meet_at',
        'status','parent_meetup_id','note','expires_at','created_at','updated_at'
      ]),
      (ARRAY['authenticated'], 'messages', 'SELECT', ARRAY[
        'id','conversation_id','sender_id','content','message_type','is_read',
        'created_at'
      ]),
      (ARRAY['authenticated'], 'notifications', 'SELECT', ARRAY[
        'id','user_id','type','title','body','item_id','is_read','created_at',
        'conversation_id'
      ]),
      (ARRAY['authenticated'], 'offers', 'SELECT', ARRAY[
        'id','conversation_id','item_id','from_user','to_user','price','status',
        'parent_offer_id','note','expires_at','created_at','updated_at'
      ]),
      (ARRAY['authenticated'], 'post_comment_likes', 'SELECT', ARRAY[
        'comment_id','user_id','created_at'
      ]),
      (ARRAY['authenticated'], 'post_likes', 'SELECT', ARRAY[
        'post_id','user_id','created_at'
      ]),
      (ARRAY['authenticated'], 'saved_searches', 'SELECT', ARRAY[
        'id','user_id','keyword','category','price_min','price_max','created_at',
        'last_notified_at','listing_type'
      ]),
      (ARRAY['authenticated'], 'suspensions', 'SELECT', ARRAY[
        'id','profile_id','level','reason','category','started_at','ends_at',
        'lifted_at','appeal_note'
      ]),

      (ARRAY['authenticated'], 'blocks', 'INSERT', ARRAY[
        'blocker_id','blocked_id'
      ]),
      (ARRAY['authenticated'], 'conversations', 'INSERT', ARRAY[
        'item_id','buyer_id','seller_id'
      ]),
      (ARRAY['authenticated'], 'conversations', 'UPDATE', ARRAY[
        'is_pinned_buyer','is_pinned_seller','is_muted_buyer','is_muted_seller'
      ]),
      (ARRAY['authenticated'], 'favorites', 'INSERT', ARRAY[
        'user_id','item_id'
      ]),
      (ARRAY['authenticated'], 'follows', 'INSERT', ARRAY[
        'follower_id','followee_id'
      ]),
      (ARRAY['authenticated'], 'items', 'INSERT', ARRAY[
        'user_id','title','description','price','category','condition',
        'location','images','negotiable','image_dimensions','title_i18n',
        'description_i18n','source_lang','listing_type'
      ]),
      (ARRAY['authenticated'], 'items', 'UPDATE', ARRAY[
        'title','description','price','category','condition','status','location',
        'images','negotiable','image_dimensions','title_i18n',
        'description_i18n','source_lang'
      ]),
      (ARRAY['authenticated'], 'messages', 'INSERT', ARRAY[
        'id','conversation_id','sender_id','content','message_type'
      ]),
      (ARRAY['authenticated'], 'messages', 'UPDATE', ARRAY['is_read']),
      (ARRAY['authenticated'], 'notifications', 'UPDATE', ARRAY['is_read']),
      (ARRAY['authenticated'], 'post_comment_likes', 'INSERT', ARRAY[
        'comment_id','user_id'
      ]),
      (ARRAY['authenticated'], 'post_comments', 'INSERT', ARRAY[
        'post_id','user_id','content','parent_comment_id'
      ]),
      (ARRAY['authenticated'], 'post_comments', 'UPDATE', ARRAY['content']),
      (ARRAY['authenticated'], 'post_items', 'INSERT', ARRAY[
        'post_id','item_id','display_order'
      ]),
      (ARRAY['authenticated'], 'post_likes', 'INSERT', ARRAY[
        'post_id','user_id'
      ]),
      (ARRAY['authenticated'], 'posts', 'INSERT', ARRAY[
        'user_id','content','images','image_dimensions','content_i18n',
        'source_lang'
      ]),
      (ARRAY['authenticated'], 'posts', 'UPDATE', ARRAY['content_i18n']),
      (ARRAY['authenticated'], 'profiles', 'INSERT', ARRAY[
        'id','nickname','avatar_url','bio','location','status_text','status_emoji'
      ]),
      (ARRAY['authenticated'], 'profiles', 'UPDATE', ARRAY[
        'nickname','avatar_url','bio','location','status_text','status_emoji'
      ]),
      (ARRAY['authenticated'], 'reports', 'INSERT', ARRAY[
        'reporter_id','target_type','target_id','reason','note'
      ]),
      (ARRAY['authenticated'], 'saved_searches', 'INSERT', ARRAY[
        'user_id','keyword','category','price_min','price_max','listing_type'
      ])
  ), expected(role_name, relation_name, privilege_type, column_name) AS (
    SELECT role_name, relation_name, privilege_type, column_name
    FROM column_sets
    CROSS JOIN LATERAL pg_catalog.unnest(role_names) AS roles(role_name)
    CROSS JOIN LATERAL pg_catalog.unnest(column_names) AS columns(column_name)
  ), actual(role_name, relation_name, privilege_type, column_name) AS (
    SELECT
      CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE role.rolname END,
      relation.relname,
      acl.privilege_type,
      attribute.attname
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = relation.oid
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
    LEFT JOIN pg_catalog.pg_roles AS role ON role.oid = acl.grantee
    WHERE relation.oid IN (
      SELECT DISTINCT pg_catalog.to_regclass('public.' || relation_name)
      FROM column_sets
    )
      AND (
        acl.grantee = 0
        OR role.rolname IN ('anon', 'authenticated', 'service_role')
      )
  ), differences AS (
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  )
  SELECT pg_catalog.count(*)::integer INTO mismatch_count FROM differences;

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'verify_failed: column ACL mismatch count %', mismatch_count;
  END IF;

  IF pg_catalog.has_table_privilege('anon', 'public.profiles', 'SELECT')
     OR pg_catalog.has_table_privilege(
       'authenticated', 'public.profiles', 'SELECT'
     )
     OR pg_catalog.has_column_privilege(
       'anon', 'public.profiles', 'email', 'SELECT'
     )
     OR pg_catalog.has_column_privilege(
       'authenticated', 'public.profiles', 'trust_score', 'SELECT'
     )
     OR pg_catalog.has_column_privilege(
       'authenticated', 'public.profiles', 'verified_illini_email', 'SELECT'
     ) THEN
    RAISE EXCEPTION 'verify_failed: profile private-column ACL reopened';
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
    WHERE NOT relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'verify_failed: RLS disabled on app relation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = 'public.banners_live'::pg_catalog.regclass
      AND 'security_invoker=true' = ANY(COALESCE(relation.reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'verify_failed: banners_live not security_invoker';
  END IF;

  -- Competing permissive policies are ORed with the intended boundary. Keep
  -- an exact inventory so later policy additions receive an explicit review.
  WITH expected(tablename, policyname) AS (
    VALUES
      ('banners','banners_read_live'),
      ('blocks','Blockers can remove own blocks'),
      ('blocks','Blockers can create own blocks'),
      ('blocks','Blockers can view own blocks'),
      ('conversation_archives','Users can view own conversation archives'),
      ('conversations','Unblocked buyers can create conversations'),
      ('conversations','Unblocked participants can view conversations'),
      ('conversations','Unblocked participants can update conversations'),
      ('favorites','Users can remove favorites'),
      ('favorites','Users can add favorites'),
      ('favorites','Users can view own favorites'),
      ('follows','Users can unfollow'),
      ('follows','Users can follow'),
      ('follows','Anyone can view follows'),
      ('items','Users can delete own items'),
      ('items','Authenticated users can create items'),
      ('items','Anyone can view active items'),
      ('items','Users can update own items'),
      ('meetups','meetups_select'),
      ('messages','Unblocked participants can send messages'),
      ('messages','Unblocked participants can view messages'),
      ('messages','Unblocked recipients can mark messages read'),
      ('notifications','Users delete own notifications'),
      ('notifications','Block direct notification inserts'),
      ('notifications','Users read own notifications'),
      ('notifications','Users update own notifications'),
      ('offers','offers_select'),
      ('post_comment_likes','Users can unlike comments'),
      ('post_comment_likes','Users can like comments'),
      ('post_comment_likes','Anyone can view comment likes'),
      ('post_comment_likes','No updates to comment likes'),
      ('post_comments','Users can delete own comments'),
      ('post_comments','Authenticated users can comment'),
      ('post_comments','Anyone can view comments'),
      ('post_comments','Users can update own comments'),
      ('post_items','Post owner can detach items'),
      ('post_items','Post owner can attach own items'),
      ('post_items','Anyone can view visible post items'),
      ('post_items','No updates to post_items'),
      ('post_likes','Users can unlike'),
      ('post_likes','Users can like'),
      ('post_likes','Anyone can view likes'),
      ('post_likes','No updates to likes'),
      ('posts','Users can delete own posts'),
      ('posts','Authenticated users can create posts'),
      ('posts','Anyone can view active posts'),
      ('posts','Users can update own posts'),
      ('profiles','Users can create own profile'),
      ('profiles','Public profile rows readable'),
      ('profiles','Users can update own profile'),
      ('ratings','Anyone can view ratings'),
      ('reports','Users can create reports'),
      ('reports','Users can view own reports'),
      ('saved_searches','Users delete own saved searches'),
      ('saved_searches','Users create own saved searches'),
      ('saved_searches','Users read own saved searches'),
      ('suspensions','suspensions_self_read')
  ), actual(tablename, policyname) AS (
    SELECT policy.tablename, policy.policyname
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'public'
      AND policy.permissive = 'PERMISSIVE'
      AND policy.tablename IN (SELECT DISTINCT tablename FROM expected)
  ), differences AS (
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  )
  SELECT pg_catalog.count(*)::integer INTO mismatch_count FROM differences;

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'verify_failed: permissive RLS policy inventory drift %',
      mismatch_count;
  END IF;
END;
$verify$;

ROLLBACK;
