-- Read-only prerequisites for
-- 20260719151729_reconcile_plaza_base_table_acl.sql.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL search_path = public, pg_catalog;

DO $precheck$
DECLARE
  relation_name text;
  policy_mismatch_count integer;
  profile_short_alias CONSTANT text :=
    'get_my_profile()profile(suspension_level)';
  profile_pg17_alias CONSTANT text :=
    'get_my_profile()profile(id,phone,email,wechat_openid,nickname,avatar_url,bio,location,created_at,updated_at,is_illini_verified,uid,avg_rating,rating_count,status_text,status_emoji,trust_score,shadow_banned,suspension_level,suspended_until,last_fp_hash,last_fp_seen_at,warning_count,tos_version,consented_at,onboarded_at,campus_area,wechat_unionid,response_rate,response_sample,email_digest_opt_out,unsubscribe_token,verified_illini_email)';
  profile_canonical_alias CONSTANT text := 'get_my_profile()profile';
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
      AS required(role_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles AS role
      WHERE role.rolname = required.role_name
    )
  ) THEN
    RAISE EXCEPTION 'precheck_failed: Plaza API role missing';
  END IF;

  FOREACH relation_name IN ARRAY ARRAY['posts', 'post_items']::text[] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class AS relation
      WHERE relation.oid = pg_catalog.to_regclass(
        'public.' || relation_name
      )
        AND relation.relkind = 'r'
        AND relation.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'precheck_failed: %.RLS prerequisite missing',
        relation_name;
    END IF;
  END LOOP;

  IF pg_catalog.to_regprocedure('auth.uid()') IS NULL
     OR pg_catalog.to_regprocedure(
       'moderation_private.profile_content_visible(uuid)'
     ) IS NULL THEN
    RAISE EXCEPTION 'precheck_failed: Plaza policy helper missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('posts', 'id'), ('posts', 'user_id'), ('posts', 'content'),
      ('posts', 'images'), ('posts', 'is_official'), ('posts', 'is_pinned'),
      ('posts', 'like_count'), ('posts', 'comment_count'),
      ('posts', 'status'), ('posts', 'created_at'), ('posts', 'updated_at'),
      ('posts', 'image_dimensions'), ('posts', 'content_i18n'),
      ('posts', 'source_lang'), ('post_items', 'post_id'),
      ('post_items', 'item_id'), ('post_items', 'display_order'),
      ('post_items', 'created_at')
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
    RAISE EXCEPTION 'precheck_failed: Plaza ACL column missing';
  END IF;

  WITH expected(table_name, policy_name) AS (
    VALUES
      ('posts', 'Anyone can view active posts'),
      ('posts', 'Authenticated users can create posts'),
      ('posts', 'Users can update own posts'),
      ('posts', 'Users can delete own posts'),
      ('post_items', 'Anyone can view visible post items'),
      ('post_items', 'Post owner can attach own items'),
      ('post_items', 'Post owner can detach items'),
      ('post_items', 'No updates to post_items')
  ), actual(table_name, policy_name) AS (
    SELECT relation.relname, policy.polname
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS relation ON relation.oid = policy.polrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname IN ('posts', 'post_items')
      AND policy.polpermissive
  ), differences AS (
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  )
  SELECT pg_catalog.count(*)::integer
  INTO policy_mismatch_count
  FROM differences;

  IF policy_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'precheck_failed: Plaza permissive policy drift %',
      policy_mismatch_count;
  END IF;

  WITH expected(
    table_name, policy_name, command, role_names, legacy_public_allowed,
    using_expression, check_expression
  ) AS (
    VALUES
      ('posts', 'Anyone can view active posts', 'r',
       ARRAY['anon','authenticated']::text[], false,
       $expr$((status='active'::text)andmoderation_private.profile_content_visible(user_id))$expr$,
       NULL::text),
      ('posts', 'Authenticated users can create posts', 'a',
       ARRAY['authenticated']::text[], true, NULL::text,
       $expr$((auth.uid()=user_id)and(notis_official))$expr$),
      ('posts', 'Users can update own posts', 'w',
       ARRAY['authenticated']::text[], true, $expr$(auth.uid()=user_id)$expr$,
       $expr$((auth.uid()=user_id)and(notis_official)and(notis_pinned))$expr$),
      ('posts', 'Users can delete own posts', 'd',
       ARRAY['authenticated']::text[], true, $expr$(auth.uid()=user_id)$expr$,
       NULL::text),
      ('post_items', 'Anyone can view visible post items', 'r',
       ARRAY['anon','authenticated']::text[], false,
       $expr$((exists(select1frompostsparent_postwhere((parent_post.id=post_items.post_id)and(parent_post.status='active'::text)andmoderation_private.profile_content_visible(parent_post.user_id))))and(exists(select1fromitemsattached_itemwhere((attached_item.id=post_items.item_id)and(attached_item.status<>'deleted'::item_status)andmoderation_private.profile_content_visible(attached_item.user_id)))))$expr$,
       NULL::text),
      ('post_items', 'Post owner can attach own items', 'a',
       ARRAY['authenticated']::text[], false, NULL::text,
       $expr$((auth.uid()isnotnull)and(exists(select1frompostsparent_postwhere((parent_post.id=post_items.post_id)and(parent_post.user_id=auth.uid())and(parent_post.status='active'::text))))and(exists(select1fromitemsattached_itemwhere((attached_item.id=post_items.item_id)and(attached_item.user_id=auth.uid())and(attached_item.status='active'::item_status))))and(coalesce(((selectprofile.suspension_levelfromget_my_profile()profile))::integer,5)<2))$expr$),
      ('post_items', 'Post owner can detach items', 'd',
       ARRAY['authenticated']::text[], false,
       $expr$((auth.uid()isnotnull)and(exists(select1frompostsparent_postwhere((parent_post.id=post_items.post_id)and(parent_post.user_id=auth.uid())))))$expr$,
       NULL::text),
      ('post_items', 'No updates to post_items', 'w',
       ARRAY['authenticated']::text[], false, 'false', 'false')
  ), actual AS (
    SELECT relation.relname AS table_name, policy.polname AS policy_name,
           policy.polcmd AS command, policy_roles.role_names,
      pg_catalog.lower(pg_catalog.regexp_replace(
        pg_catalog.pg_get_expr(policy.polqual, policy.polrelid),
        '[[:space:]]+', '', 'g'
      )) AS using_expression,
      pg_catalog.replace(
        pg_catalog.replace(
          pg_catalog.lower(pg_catalog.regexp_replace(
            pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid),
            '[[:space:]]+', '', 'g'
          )),
          profile_short_alias,
          profile_canonical_alias
        ),
        profile_pg17_alias,
        profile_canonical_alias
      ) AS check_expression
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS relation ON relation.oid = policy.polrelid
    CROSS JOIN LATERAL (
      SELECT pg_catalog.array_agg(
        CASE WHEN policy_role.role_oid = 0
          THEN 'PUBLIC'::text ELSE role.rolname::text END
        ORDER BY CASE WHEN policy_role.role_oid = 0
          THEN 'PUBLIC'::text ELSE role.rolname::text END
      ) AS role_names
      FROM pg_catalog.unnest(policy.polroles) AS policy_role(role_oid)
      LEFT JOIN pg_catalog.pg_roles AS role ON role.oid = policy_role.role_oid
    ) AS policy_roles
    WHERE policy.polpermissive
      AND policy.polrelid IN (
        'public.posts'::pg_catalog.regclass,
        'public.post_items'::pg_catalog.regclass
      )
  ), mismatches AS (
    SELECT expected.policy_name
    FROM expected
    LEFT JOIN actual USING (table_name, policy_name)
    WHERE actual.policy_name IS NULL
       OR actual.command IS DISTINCT FROM expected.command
       OR (
         actual.role_names IS DISTINCT FROM expected.role_names
         AND NOT (
           expected.legacy_public_allowed
           AND actual.role_names = ARRAY['PUBLIC']::text[]
         )
       )
       OR actual.using_expression IS DISTINCT FROM expected.using_expression
       OR actual.check_expression IS DISTINCT FROM expected.check_expression
  )
  SELECT pg_catalog.count(*)::integer
  INTO policy_mismatch_count
  FROM mismatches;

  IF policy_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'precheck_failed: exact Plaza policy contract mismatch %',
      policy_mismatch_count;
  END IF;

  -- Direct ACL drift is repairable below. Role inheritance is not: REVOKE
  -- from anon/authenticated/service_role cannot remove a parent role's grant.
  IF EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
      AS member_role(role_name)
    CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role'))
      AS inherited_role(role_name)
    WHERE member_role.role_name <> inherited_role.role_name
      AND pg_catalog.pg_has_role(
        pg_catalog.to_regrole(member_role.role_name),
        pg_catalog.to_regrole(inherited_role.role_name),
        'MEMBER'
      )
  ) OR EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
      AS member_role(role_name)
    CROSS JOIN pg_catalog.pg_class AS relation
    WHERE relation.oid IN (
      'public.posts'::pg_catalog.regclass,
      'public.post_items'::pg_catalog.regclass
    )
      AND pg_catalog.pg_has_role(
        pg_catalog.to_regrole(member_role.role_name),
        relation.relowner,
        'MEMBER'
      )
  ) THEN
    RAISE EXCEPTION 'precheck_failed: Plaza role membership grants owner/peer privileges'
      USING HINT = 'Remove the role membership before applying this migration.';
  END IF;

  -- aclexplode enumerates every privilege type supported by the connected
  -- server, including PG17 MAINTAIN. Direct API/PUBLIC drift remains repairable
  -- by the migration; only privileges inherited from another role fail here.
  WITH expected(role_name, relation_name, privilege_type) AS (
    VALUES
      ('authenticated', 'posts', 'DELETE'),
      ('authenticated', 'post_items', 'DELETE'),
      ('service_role', 'posts', 'SELECT'),
      ('service_role', 'posts', 'INSERT'),
      ('service_role', 'posts', 'UPDATE'),
      ('service_role', 'posts', 'DELETE'),
      ('service_role', 'post_items', 'SELECT'),
      ('service_role', 'post_items', 'INSERT'),
      ('service_role', 'post_items', 'UPDATE'),
      ('service_role', 'post_items', 'DELETE')
  ), inherited AS (
    SELECT
      member_role.role_name,
      relation.relname AS relation_name,
      acl.privilege_type,
      acl.is_grantable
    FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
      AS member_role(role_name)
    CROSS JOIN pg_catalog.pg_class AS relation
    CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl) AS acl
    WHERE relation.oid IN (
      'public.posts'::pg_catalog.regclass,
      'public.post_items'::pg_catalog.regclass
    )
      AND acl.grantee <> 0
      AND acl.grantee <> pg_catalog.to_regrole(member_role.role_name)::oid
      AND pg_catalog.pg_has_role(
        pg_catalog.to_regrole(member_role.role_name), acl.grantee, 'MEMBER'
      )
  )
  SELECT pg_catalog.count(*)::integer
  INTO policy_mismatch_count
  FROM inherited
  LEFT JOIN expected USING (role_name, relation_name, privilege_type)
  WHERE expected.role_name IS NULL OR inherited.is_grantable;

  IF policy_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'precheck_failed: inherited Plaza table ACL excess %',
      policy_mismatch_count
      USING HINT = 'Remove parent-role ACLs or membership before retrying.';
  END IF;

  WITH app_column_sets(
    role_names, relation_name, privilege_type, column_names
  ) AS (
    VALUES
      (ARRAY['anon','authenticated'], 'posts', 'SELECT', ARRAY[
        'id','user_id','content','images','is_official','is_pinned',
        'like_count','comment_count','status','created_at','updated_at',
        'image_dimensions','content_i18n','source_lang'
      ]),
      (ARRAY['anon','authenticated'], 'post_items', 'SELECT', ARRAY[
        'post_id','item_id','display_order','created_at'
      ]),
      (ARRAY['authenticated'], 'posts', 'INSERT', ARRAY[
        'user_id','content','images','image_dimensions','content_i18n',
        'source_lang'
      ]),
      (ARRAY['authenticated'], 'posts', 'UPDATE', ARRAY['content_i18n']),
      (ARRAY['authenticated'], 'post_items', 'INSERT', ARRAY[
        'post_id','item_id','display_order'
      ])
  ), expected(role_name, relation_name, privilege_type, column_name) AS (
    SELECT roles.role_name,
           app_column_sets.relation_name,
           app_column_sets.privilege_type,
           columns.column_name
    FROM app_column_sets
    CROSS JOIN LATERAL pg_catalog.unnest(role_names) AS roles(role_name)
    CROSS JOIN LATERAL pg_catalog.unnest(column_names) AS columns(column_name)
    UNION ALL
    SELECT 'service_role', relation.relname, privilege_type, attribute.attname
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = relation.oid
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
    CROSS JOIN pg_catalog.unnest(ARRAY['SELECT','INSERT','UPDATE'])
      AS privileges(privilege_type)
    WHERE relation.oid IN (
      'public.posts'::pg_catalog.regclass,
      'public.post_items'::pg_catalog.regclass
    )
  ), inherited AS (
    SELECT member_role.role_name, relation.relname AS relation_name,
           acl.privilege_type, attribute.attname AS column_name,
           acl.is_grantable
    FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
      AS member_role(role_name)
    CROSS JOIN pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = relation.oid
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
    WHERE relation.oid IN (
      'public.posts'::pg_catalog.regclass,
      'public.post_items'::pg_catalog.regclass
    )
      AND acl.grantee <> 0
      AND acl.grantee <> pg_catalog.to_regrole(member_role.role_name)::oid
      AND pg_catalog.pg_has_role(
        pg_catalog.to_regrole(member_role.role_name), acl.grantee, 'MEMBER'
      )
  )
  SELECT pg_catalog.count(*)::integer
  INTO policy_mismatch_count
  FROM inherited
  LEFT JOIN expected
    USING (role_name, relation_name, privilege_type, column_name)
  WHERE expected.role_name IS NULL OR inherited.is_grantable;

  IF policy_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'precheck_failed: inherited Plaza column ACL excess %',
      policy_mismatch_count
      USING HINT = 'Remove parent-role ACLs or membership before retrying.';
  END IF;
END;
$precheck$;

-- Evidence only.  Drift is expected here and is what the migration repairs.
SELECT
  pg_catalog.has_any_column_privilege(
    'anon', 'public.post_items', 'INSERT'
  ) AS anon_post_items_insert_before,
  pg_catalog.has_table_privilege(
    'anon', 'public.post_items', 'DELETE'
  ) AS anon_post_items_delete_before,
  pg_catalog.has_any_column_privilege(
    'authenticated', 'public.post_items', 'UPDATE'
  ) AS authenticated_post_items_update_before;

ROLLBACK;
