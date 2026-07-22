-- Read-only post-deploy verification for auth.uid() InitPlan policy caching.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = public, pg_catalog;

DO $verify$
DECLARE
  mismatch_count integer;
  mismatch_names text;
  target_count integer;
  target_table_count integer;
  public_policy_count integer;
  authenticated_policy_count integer;
  uid_call_count bigint;
  initplan_call_count bigint;
BEGIN
  IF pg_catalog.to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'verify_failed: auth.uid() is missing';
  END IF;

  WITH expected(
    table_name, policy_name, command, role_names,
    using_expression, check_expression,
    using_uid_calls, check_uid_calls
  ) AS (
    VALUES
      ('device_fingerprints', 'dfp_self_read', 'r',
       ARRAY['PUBLIC']::text[], $expr$(auth.uid()=profile_id)$expr$, NULL::text, 1, 0),
      ('favorites', 'Users can add favorites', 'a',
       ARRAY['PUBLIC']::text[], NULL::text, $expr$(auth.uid()=user_id)$expr$, 0, 1),
      ('favorites', 'Users can remove favorites', 'd',
       ARRAY['PUBLIC']::text[], $expr$(auth.uid()=user_id)$expr$, NULL::text, 1, 0),
      ('favorites', 'Users can view own favorites', 'r',
       ARRAY['PUBLIC']::text[], $expr$(auth.uid()=user_id)$expr$, NULL::text, 1, 0),
      ('follows', 'Users can follow', 'a',
       ARRAY['PUBLIC']::text[], NULL::text, $expr$(auth.uid()=follower_id)$expr$, 0, 1),
      ('follows', 'Users can unfollow', 'd',
       ARRAY['PUBLIC']::text[], $expr$(auth.uid()=follower_id)$expr$, NULL::text, 1, 0),
      ('items', 'Authenticated users can create items', 'a',
       ARRAY['PUBLIC']::text[], NULL::text, $expr$(auth.uid()=user_id)$expr$, 0, 1),
      ('items', 'Users can delete own items', 'd',
       ARRAY['PUBLIC']::text[], $expr$(auth.uid()=user_id)$expr$, NULL::text, 1, 0),
      ('items', 'Users can update own items', 'w',
       ARRAY['PUBLIC']::text[], $expr$(auth.uid()=user_id)$expr$,
       $expr$(auth.uid()=user_id)$expr$, 1, 1),
      ('notifications', 'Users delete own notifications', 'd',
       ARRAY['PUBLIC']::text[], $expr$(auth.uid()=user_id)$expr$, NULL::text, 1, 0),
      ('notifications', 'Users read own notifications', 'r',
       ARRAY['PUBLIC']::text[], $expr$(auth.uid()=user_id)$expr$, NULL::text, 1, 0),
      ('notifications', 'Users update own notifications', 'w',
       ARRAY['PUBLIC']::text[], $expr$(auth.uid()=user_id)$expr$,
       $expr$(auth.uid()=user_id)$expr$, 1, 1),
      ('post_comment_likes', 'Users can like comments', 'a',
       ARRAY['PUBLIC']::text[], NULL::text, $expr$(auth.uid()=user_id)$expr$, 0, 1),
      ('post_comment_likes', 'Users can unlike comments', 'd',
       ARRAY['PUBLIC']::text[], $expr$(auth.uid()=user_id)$expr$, NULL::text, 1, 0),
      ('post_comments', 'Authenticated users can comment', 'a',
       ARRAY['PUBLIC']::text[], NULL::text, $expr$(auth.uid()=user_id)$expr$, 0, 1),
      ('post_comments', 'Users can delete own comments', 'd',
       ARRAY['PUBLIC']::text[], $expr$(auth.uid()=user_id)$expr$, NULL::text, 1, 0),
      ('post_comments', 'Users can update own comments', 'w',
       ARRAY['PUBLIC']::text[], $expr$(auth.uid()=user_id)$expr$,
       $expr$(auth.uid()=user_id)$expr$, 1, 1),
      ('post_items', 'Post owner can attach own items', 'a',
       ARRAY['authenticated']::text[], NULL::text,
       $expr$((auth.uid()isnotnull)and(exists(select1frompostsparent_postwhere((parent_post.id=post_items.post_id)and(parent_post.user_id=auth.uid())and(parent_post.status='active'::text))))and(exists(select1fromitemsattached_itemwhere((attached_item.id=post_items.item_id)and(attached_item.user_id=auth.uid())and(attached_item.status='active'::item_status))))and(coalesce(((selectprofile.suspension_levelfromget_my_profile()profile))::integer,5)<2))$expr$,
       0, 3),
      ('post_items', 'Post owner can detach items', 'd',
       ARRAY['authenticated']::text[],
       $expr$((auth.uid()isnotnull)and(exists(select1frompostsparent_postwhere((parent_post.id=post_items.post_id)and(parent_post.user_id=auth.uid())))))$expr$,
       NULL::text, 2, 0),
      ('post_likes', 'Users can like', 'a',
       ARRAY['PUBLIC']::text[], NULL::text, $expr$(auth.uid()=user_id)$expr$, 0, 1),
      ('post_likes', 'Users can unlike', 'd',
       ARRAY['PUBLIC']::text[], $expr$(auth.uid()=user_id)$expr$, NULL::text, 1, 0),
      ('posts', 'Authenticated users can create posts', 'a',
       ARRAY['authenticated']::text[], NULL::text,
       $expr$((auth.uid()=user_id)and(notis_official))$expr$, 0, 1),
      ('posts', 'Users can delete own posts', 'd',
       ARRAY['authenticated']::text[], $expr$(auth.uid()=user_id)$expr$, NULL::text, 1, 0),
      ('posts', 'Users can update own posts', 'w',
       ARRAY['authenticated']::text[], $expr$(auth.uid()=user_id)$expr$,
       $expr$((auth.uid()=user_id)and(notis_official)and(notis_pinned))$expr$,
       1, 1),
      ('profiles', 'Users can update own profile', 'w',
       ARRAY['PUBLIC']::text[], $expr$(auth.uid()=id)$expr$,
       $expr$(auth.uid()=id)$expr$, 1, 1),
      ('reports', 'Users can create reports', 'a',
       ARRAY['PUBLIC']::text[], NULL::text, $expr$(auth.uid()=reporter_id)$expr$, 0, 1),
      ('reports', 'Users can view own reports', 'r',
       ARRAY['PUBLIC']::text[], $expr$(auth.uid()=reporter_id)$expr$, NULL::text, 1, 0),
      ('saved_searches', 'Users create own saved searches', 'a',
       ARRAY['PUBLIC']::text[], NULL::text, $expr$(auth.uid()=user_id)$expr$, 0, 1),
      ('saved_searches', 'Users delete own saved searches', 'd',
       ARRAY['PUBLIC']::text[], $expr$(auth.uid()=user_id)$expr$, NULL::text, 1, 0),
      ('saved_searches', 'Users read own saved searches', 'r',
       ARRAY['PUBLIC']::text[], $expr$(auth.uid()=user_id)$expr$, NULL::text, 1, 0),
      ('suspensions', 'suspensions_self_read', 'r',
       ARRAY['PUBLIC']::text[], $expr$(auth.uid()=profile_id)$expr$, NULL::text, 1, 0)
  ), deparsed AS (
    SELECT
      relation.relname AS table_name,
      policy.polname AS policy_name,
      policy.polpermissive,
      policy.polcmd AS command,
      policy_roles.role_names,
      relation.relrowsecurity,
      COALESCE(pg_catalog.lower(pg_catalog.regexp_replace(
        pg_catalog.pg_get_expr(policy.polqual, policy.polrelid),
        '[[:space:]]+', '', 'g'
      )), '') AS raw_using_expression,
      COALESCE(pg_catalog.lower(pg_catalog.regexp_replace(
        pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid),
        '[[:space:]]+', '', 'g'
      )), '') AS raw_check_expression
    FROM expected
    JOIN pg_catalog.pg_class AS relation
      ON relation.oid = pg_catalog.to_regclass(
        'public.' || expected.table_name
      )
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
     AND namespace.nspname = 'public'
    JOIN pg_catalog.pg_policy AS policy
      ON policy.polrelid = relation.oid
     AND policy.polname = expected.policy_name
    CROSS JOIN LATERAL (
      SELECT pg_catalog.array_agg(
        CASE WHEN policy_role.role_oid = 0
          THEN 'PUBLIC'::text ELSE role.rolname::text END
        ORDER BY CASE WHEN policy_role.role_oid = 0
          THEN 'PUBLIC'::text ELSE role.rolname::text END
      ) AS role_names
      FROM pg_catalog.unnest(policy.polroles) AS policy_role(role_oid)
      LEFT JOIN pg_catalog.pg_roles AS role
        ON role.oid = policy_role.role_oid
    ) AS policy_roles
  ), measured AS (
    SELECT
      deparsed.*,
      pg_catalog.regexp_replace(
        pg_catalog.replace(
          pg_catalog.replace(
            deparsed.raw_using_expression,
            '(selectauth.uid()asuid)', 'auth.uid()'
          ),
          '(selectauth.uid())', 'auth.uid()'
        ),
        'get_my_profile\(\)profile\([^)]*\)',
        'get_my_profile()profile', 'g'
      ) AS using_expression,
      pg_catalog.regexp_replace(
        pg_catalog.replace(
          pg_catalog.replace(
            deparsed.raw_check_expression,
            '(selectauth.uid()asuid)', 'auth.uid()'
          ),
          '(selectauth.uid())', 'auth.uid()'
        ),
        'get_my_profile\(\)profile\([^)]*\)',
        'get_my_profile()profile', 'g'
      ) AS check_expression,
      (
        pg_catalog.length(deparsed.raw_using_expression)
        - pg_catalog.length(pg_catalog.replace(
            deparsed.raw_using_expression, 'auth.uid()', ''
          ))
      ) / pg_catalog.length('auth.uid()') AS using_uid_calls,
      (
        pg_catalog.length(deparsed.raw_check_expression)
        - pg_catalog.length(pg_catalog.replace(
            deparsed.raw_check_expression, 'auth.uid()', ''
          ))
      ) / pg_catalog.length('auth.uid()') AS check_uid_calls,
      (
        pg_catalog.length(deparsed.raw_using_expression)
        - pg_catalog.length(pg_catalog.replace(
            deparsed.raw_using_expression, 'selectauth.uid()', ''
          ))
      ) / pg_catalog.length('selectauth.uid()') AS using_initplans,
      (
        pg_catalog.length(deparsed.raw_check_expression)
        - pg_catalog.length(pg_catalog.replace(
            deparsed.raw_check_expression, 'selectauth.uid()', ''
          ))
      ) / pg_catalog.length('selectauth.uid()') AS check_initplans
    FROM deparsed
  ), mismatches AS (
    SELECT expected.table_name, expected.policy_name
    FROM expected
    LEFT JOIN measured USING (table_name, policy_name)
    WHERE measured.policy_name IS NULL
       OR NOT measured.polpermissive
       OR NOT measured.relrowsecurity
       OR measured.command IS DISTINCT FROM expected.command
       OR measured.role_names IS DISTINCT FROM expected.role_names
       OR measured.using_expression IS DISTINCT FROM
          COALESCE(expected.using_expression, '')
       OR measured.check_expression IS DISTINCT FROM
          COALESCE(expected.check_expression, '')
       OR measured.using_uid_calls IS DISTINCT FROM expected.using_uid_calls
       OR measured.check_uid_calls IS DISTINCT FROM expected.check_uid_calls
       OR measured.using_initplans IS DISTINCT FROM expected.using_uid_calls
       OR measured.check_initplans IS DISTINCT FROM expected.check_uid_calls
  )
  SELECT
    pg_catalog.count(*)::integer,
    pg_catalog.string_agg(
      mismatches.table_name || '.' || mismatches.policy_name,
      ', ' ORDER BY mismatches.table_name, mismatches.policy_name
    )
  INTO mismatch_count, mismatch_names
  FROM mismatches;

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'verify_failed: target policy drift: %',
      mismatch_names;
  END IF;

  WITH targets(table_name, policy_name) AS (
    VALUES
      ('device_fingerprints', 'dfp_self_read'),
      ('favorites', 'Users can add favorites'),
      ('favorites', 'Users can remove favorites'),
      ('favorites', 'Users can view own favorites'),
      ('follows', 'Users can follow'),
      ('follows', 'Users can unfollow'),
      ('items', 'Authenticated users can create items'),
      ('items', 'Users can delete own items'),
      ('items', 'Users can update own items'),
      ('notifications', 'Users delete own notifications'),
      ('notifications', 'Users read own notifications'),
      ('notifications', 'Users update own notifications'),
      ('post_comment_likes', 'Users can like comments'),
      ('post_comment_likes', 'Users can unlike comments'),
      ('post_comments', 'Authenticated users can comment'),
      ('post_comments', 'Users can delete own comments'),
      ('post_comments', 'Users can update own comments'),
      ('post_items', 'Post owner can attach own items'),
      ('post_items', 'Post owner can detach items'),
      ('post_likes', 'Users can like'),
      ('post_likes', 'Users can unlike'),
      ('posts', 'Authenticated users can create posts'),
      ('posts', 'Users can delete own posts'),
      ('posts', 'Users can update own posts'),
      ('profiles', 'Users can update own profile'),
      ('reports', 'Users can create reports'),
      ('reports', 'Users can view own reports'),
      ('saved_searches', 'Users create own saved searches'),
      ('saved_searches', 'Users delete own saved searches'),
      ('saved_searches', 'Users read own saved searches'),
      ('suspensions', 'suspensions_self_read')
  ), actual AS (
    SELECT
      relation.relname AS table_name,
      policy_roles.role_names,
      COALESCE(pg_catalog.lower(pg_catalog.regexp_replace(
        pg_catalog.pg_get_expr(policy.polqual, policy.polrelid),
        '[[:space:]]+', '', 'g'
      )), '') AS using_expression,
      COALESCE(pg_catalog.lower(pg_catalog.regexp_replace(
        pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid),
        '[[:space:]]+', '', 'g'
      )), '') AS check_expression
    FROM targets
    JOIN pg_catalog.pg_class AS relation
      ON relation.oid = pg_catalog.to_regclass(
        'public.' || targets.table_name
      )
    JOIN pg_catalog.pg_policy AS policy
      ON policy.polrelid = relation.oid
     AND policy.polname = targets.policy_name
    CROSS JOIN LATERAL (
      SELECT pg_catalog.array_agg(
        CASE WHEN policy_role.role_oid = 0
          THEN 'PUBLIC'::text ELSE role.rolname::text END
        ORDER BY CASE WHEN policy_role.role_oid = 0
          THEN 'PUBLIC'::text ELSE role.rolname::text END
      ) AS role_names
      FROM pg_catalog.unnest(policy.polroles) AS policy_role(role_oid)
      LEFT JOIN pg_catalog.pg_roles AS role
        ON role.oid = policy_role.role_oid
    ) AS policy_roles
  )
  SELECT
    pg_catalog.count(*)::integer,
    pg_catalog.count(DISTINCT actual.table_name)::integer,
    pg_catalog.count(*) FILTER (
      WHERE actual.role_names = ARRAY['PUBLIC']::text[]
    )::integer,
    pg_catalog.count(*) FILTER (
      WHERE actual.role_names = ARRAY['authenticated']::text[]
    )::integer,
    pg_catalog.sum(
      (
        pg_catalog.length(actual.using_expression)
        - pg_catalog.length(pg_catalog.replace(
            actual.using_expression, 'auth.uid()', ''
          ))
      ) / pg_catalog.length('auth.uid()')
      + (
        pg_catalog.length(actual.check_expression)
        - pg_catalog.length(pg_catalog.replace(
            actual.check_expression, 'auth.uid()', ''
          ))
      ) / pg_catalog.length('auth.uid()')
    ),
    pg_catalog.sum(
      (
        pg_catalog.length(actual.using_expression)
        - pg_catalog.length(pg_catalog.replace(
            actual.using_expression, 'selectauth.uid()', ''
          ))
      ) / pg_catalog.length('selectauth.uid()')
      + (
        pg_catalog.length(actual.check_expression)
        - pg_catalog.length(pg_catalog.replace(
            actual.check_expression, 'selectauth.uid()', ''
          ))
      ) / pg_catalog.length('selectauth.uid()')
    )
  INTO
    target_count, target_table_count, public_policy_count,
    authenticated_policy_count, uid_call_count, initplan_call_count
  FROM actual;

  IF target_count <> 31
     OR target_table_count <> 14
     OR public_policy_count <> 26
     OR authenticated_policy_count <> 5
     OR uid_call_count <> 39
     OR initplan_call_count <> 39 THEN
    RAISE EXCEPTION
      'verify_failed: expected 31 policies/14 tables/26 PUBLIC/5 authenticated/39 uid/39 InitPlan, got %/%/%/%/%/%',
      target_count, target_table_count, public_policy_count,
      authenticated_policy_count, uid_call_count, initplan_call_count;
  END IF;
END
$verify$;

SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_catalog.pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'device_fingerprints', 'favorites', 'follows', 'items',
    'notifications', 'post_comment_likes', 'post_comments', 'post_items',
    'post_likes', 'posts', 'profiles', 'reports', 'saved_searches',
    'suspensions'
  )
ORDER BY tablename, policyname;

ROLLBACK;
