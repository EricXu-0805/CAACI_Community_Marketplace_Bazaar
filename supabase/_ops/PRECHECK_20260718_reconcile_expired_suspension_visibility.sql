-- Read-only precheck for
-- 20260718160000_reconcile_expired_suspension_visibility.sql.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $precheck$
DECLARE
  relation_name text;
  function_signature text;
  item_view_columns text[];
  item_view_dependents text[];
  rebuild_legacy_item_view boolean := false;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'public.profiles',
    'public.suspensions',
    'public.items',
    'public.posts',
    'public.post_items',
    'public.ratings',
    'public.reports',
    'public.device_fingerprints',
    'public.items_visible',
    'public.posts_visible'
  ]::text[] LOOP
    IF pg_catalog.to_regclass(relation_name) IS NULL THEN
      RAISE EXCEPTION 'precheck_failed: % missing', relation_name;
    END IF;
  END LOOP;

  FOREACH function_signature IN ARRAY ARRAY[
    'auth.uid()',
    'public.compute_trust_score(uuid)',
    'public.recompute_trust_score(uuid)',
    'public.get_my_profile()',
    'public.trg_enforce_actor()',
    'public.is_posting_allowed(uuid)',
    'public.admin_list_suspensions(integer,integer,boolean)',
    'public.admin_get_suspension_detail(uuid)',
    'public.admin_list_appeals(integer,integer)',
    'public.admin_list_warnings(integer,integer)',
    'public.admin_dashboard_stats()',
    'public.admin_search_users(text,integer)',
    'public.admin_get_linked_accounts(uuid)'
  ]::text[] LOOP
    IF pg_catalog.to_regprocedure(function_signature) IS NULL THEN
      RAISE EXCEPTION 'precheck_failed: % missing', function_signature;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('profiles', 'id', 'uuid'),
      ('profiles', 'trust_score', 'smallint'),
      ('profiles', 'shadow_banned', 'boolean'),
      ('profiles', 'suspension_level', 'smallint'),
      ('profiles', 'suspended_until', 'timestamp with time zone'),
      ('suspensions', 'id', 'uuid'),
      ('suspensions', 'profile_id', 'uuid'),
      ('suspensions', 'level', 'smallint'),
      ('suspensions', 'started_at', 'timestamp with time zone'),
      ('suspensions', 'ends_at', 'timestamp with time zone'),
      ('suspensions', 'lifted_at', 'timestamp with time zone'),
      ('items', 'user_id', 'uuid'),
      ('items', 'status', 'item_status'),
      ('items', 'listing_type', 'text'),
      ('posts', 'user_id', 'uuid'),
      ('posts', 'status', 'text'),
      ('post_items', 'post_id', 'uuid'),
      ('post_items', 'item_id', 'uuid'),
      ('post_items', 'display_order', 'integer')
    ) AS required(table_name, column_name, formatted_type)
    LEFT JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = pg_catalog.to_regclass(
        'public.' || required.table_name
      )
     AND attribute.attname = required.column_name
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
    WHERE attribute.attname IS NULL
       OR pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
          <> required.formatted_type
  ) THEN
    RAISE EXCEPTION 'precheck_failed: relation column contract mismatch';
  END IF;

  SELECT pg_catalog.array_agg(attribute.attname ORDER BY attribute.attnum)
  INTO STRICT item_view_columns
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = 'public.items_visible'::pg_catalog.regclass
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;

  rebuild_legacy_item_view := item_view_columns = ARRAY[
       'id', 'user_id', 'title', 'description', 'price', 'category',
       'condition', 'status', 'location', 'images', 'view_count',
       'created_at', 'updated_at', 'negotiable', 'favorite_count',
       'location_verified'
     ]::text[];

  IF NOT rebuild_legacy_item_view
     AND item_view_columns IS DISTINCT FROM ARRAY[
       'id', 'user_id', 'title', 'description', 'price', 'category',
       'condition', 'status', 'location', 'images', 'view_count',
       'created_at', 'updated_at', 'negotiable', 'image_dimensions',
       'title_i18n', 'description_i18n', 'source_lang', 'favorite_count',
       'location_verified'
     ]::text[]
     AND item_view_columns IS DISTINCT FROM ARRAY[
       'id', 'user_id', 'title', 'description', 'price', 'category',
       'condition', 'status', 'location', 'images', 'view_count',
       'created_at', 'updated_at', 'negotiable', 'image_dimensions',
       'title_i18n', 'description_i18n', 'source_lang', 'favorite_count',
       'location_verified', 'listing_type'
     ]::text[] THEN
    RAISE EXCEPTION
      'precheck_failed: items_visible unexpected projection %',
      item_view_columns;
  END IF;

  IF rebuild_legacy_item_view THEN
    SELECT pg_catalog.array_agg(
             pg_catalog.pg_describe_object(
               dependency.classid,
               dependency.objid,
               dependency.objsubid
             )
             ORDER BY dependency.classid, dependency.objid,
                      dependency.objsubid
           )
    INTO item_view_dependents
    FROM pg_catalog.pg_depend AS dependency
    WHERE dependency.refclassid = 'pg_catalog.pg_class'::pg_catalog.regclass
      AND dependency.refobjid = 'public.items_visible'::pg_catalog.regclass
      AND dependency.deptype <> 'i';

    IF pg_catalog.cardinality(item_view_dependents) > 0 THEN
      RAISE EXCEPTION
        'precheck_failed: legacy items_visible has dependents %',
        item_view_dependents
        USING ERRCODE = '2BP01';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
      AS required(role_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles AS role
      WHERE role.rolname = required.role_name
    )
  ) THEN
    RAISE EXCEPTION 'precheck_failed: API role missing';
  END IF;

  IF NOT (
    SELECT relation.relrowsecurity
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = 'public.items'::pg_catalog.regclass
  ) OR NOT (
    SELECT relation.relrowsecurity
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = 'public.posts'::pg_catalog.regclass
  ) OR NOT (
    SELECT relation.relrowsecurity
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = 'public.post_items'::pg_catalog.regclass
  ) THEN
    RAISE EXCEPTION 'precheck_failed: feed RLS not enabled';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS policy
    WHERE policy.polrelid = 'public.post_items'::pg_catalog.regclass
      AND policy.polpermissive
      AND policy.polname NOT IN (
        'Anyone can view post items',
        'Anyone can view visible post items',
        'Post owner can attach own items',
        'Post owner can detach items',
        'No updates to post_items'
      )
  ) THEN
    RAISE EXCEPTION
      'precheck_failed: unexpected post_items policy would bypass fix';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS policy
    WHERE policy.polrelid IN (
      'public.items'::pg_catalog.regclass,
      'public.posts'::pg_catalog.regclass
    )
      AND policy.polcmd IN ('r', '*')
      AND policy.polpermissive
      AND policy.polname NOT IN (
        'Anyone can view active items',
        'Anyone can view active posts'
      )
  ) THEN
    RAISE EXCEPTION
      'precheck_failed: unexpected permissive SELECT policy would bypass fix';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = function.pronamespace
    WHERE namespace.nspname = 'moderation_private'
      AND function.proname IN (
        'current_profile_state',
        'profile_content_visible'
      )
      AND function.oid NOT IN (
        COALESCE(
          pg_catalog.to_regprocedure(
            'moderation_private.current_profile_state(uuid)'
          ),
          0::oid
        ),
        COALESCE(
          pg_catalog.to_regprocedure(
            'moderation_private.profile_content_visible(uuid)'
          ),
          0::oid
        )
      )
  ) THEN
    RAISE EXCEPTION 'precheck_failed: unexpected helper overload';
  END IF;
END
$precheck$;

SELECT
  pg_catalog.to_regprocedure(
    'moderation_private.current_profile_state(uuid)'
  ) AS existing_state_helper,
  pg_catalog.to_regprocedure(
    'moderation_private.profile_content_visible(uuid)'
  ) AS existing_visibility_helper,
  (
    SELECT pg_catalog.count(*)
    FROM public.profiles AS profile
    WHERE profile.suspension_level <> 0
       OR profile.suspended_until IS NOT NULL
       OR profile.shadow_banned
       OR EXISTS (
         SELECT 1
         FROM public.suspensions AS suspension
         WHERE suspension.profile_id = profile.id
       )
  ) AS profiles_requiring_reconciliation;

ROLLBACK;
