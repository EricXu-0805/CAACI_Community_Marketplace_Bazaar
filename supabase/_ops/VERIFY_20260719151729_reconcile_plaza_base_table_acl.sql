-- Exact read-only verification for
-- 20260719151729_reconcile_plaza_base_table_acl.sql.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL search_path = public, pg_catalog;

DO $verify$
DECLARE
  mismatch_count integer;
  maintain_mismatch_count integer;
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
    RAISE EXCEPTION 'verify_failed: Plaza API role missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(ARRAY['posts', 'post_items'])
      AS required(relation_name)
    JOIN pg_catalog.pg_class AS relation
      ON relation.oid = pg_catalog.to_regclass(
        'public.' || required.relation_name
      )
    WHERE relation.relkind <> 'r' OR NOT relation.relrowsecurity
  ) OR pg_catalog.to_regclass('public.posts') IS NULL
     OR pg_catalog.to_regclass('public.post_items') IS NULL THEN
    RAISE EXCEPTION 'verify_failed: Plaza base relation/RLS mismatch';
  END IF;

  -- Exact direct table ACL including service_role, grantor, grant option, and
  -- duplicate rows from multiple grantors.
  WITH expected_input(role_name, relation_name, privilege_type) AS (
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
  ), expected AS (
    SELECT
      pg_catalog.to_regrole(expected_input.role_name)::oid AS grantee,
      relation.oid AS relation_oid,
      expected_input.privilege_type,
      relation.relowner AS grantor,
      false AS is_grantable
    FROM expected_input
    JOIN pg_catalog.pg_class AS relation
      ON relation.oid = pg_catalog.to_regclass(
        'public.' || expected_input.relation_name
      )
  ), actual AS (
    SELECT acl.grantee, relation.oid, acl.privilege_type,
           acl.grantor, acl.is_grantable
    FROM pg_catalog.pg_class AS relation
    CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl) AS acl
    WHERE relation.oid IN (
      'public.posts'::pg_catalog.regclass,
      'public.post_items'::pg_catalog.regclass
    )
      AND (
        acl.grantee = 0
        OR acl.grantee IN (
          pg_catalog.to_regrole('anon')::oid,
          pg_catalog.to_regrole('authenticated')::oid,
          pg_catalog.to_regrole('service_role')::oid
        )
      )
  ), differences AS (
    (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
  )
  SELECT pg_catalog.count(*)::integer INTO mismatch_count FROM differences;

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'verify_failed: Plaza table ACL mismatch count %',
      mismatch_count;
  END IF;

  WITH column_sets(role_names, relation_name, privilege_type, column_names) AS (
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
      (ARRAY['authenticated'], 'posts', 'UPDATE', ARRAY[
        'content_i18n'
      ]),
      (ARRAY['authenticated'], 'post_items', 'INSERT', ARRAY[
        'post_id','item_id','display_order'
      ])
  ), expected AS (
    SELECT
      pg_catalog.to_regrole(role_name)::oid AS grantee,
      relation.oid AS relation_oid,
      privilege_type,
      attribute.attnum,
      relation.relowner AS grantor,
      false AS is_grantable
    FROM column_sets
    CROSS JOIN LATERAL pg_catalog.unnest(role_names) AS roles(role_name)
    CROSS JOIN LATERAL pg_catalog.unnest(column_names) AS columns(column_name)
    JOIN pg_catalog.pg_class AS relation
      ON relation.oid = pg_catalog.to_regclass(
        'public.' || column_sets.relation_name
      )
    JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = relation.oid
     AND attribute.attname = column_name
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
  ), actual AS (
    SELECT
      acl.grantee,
      relation.oid,
      acl.privilege_type,
      attribute.attnum,
      acl.grantor,
      acl.is_grantable
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = relation.oid
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
    WHERE relation.oid IN (
      'public.posts'::pg_catalog.regclass,
      'public.post_items'::pg_catalog.regclass
    )
      AND (
        acl.grantee = 0
        OR acl.grantee IN (
          pg_catalog.to_regrole('anon')::oid,
          pg_catalog.to_regrole('authenticated')::oid,
          pg_catalog.to_regrole('service_role')::oid
        )
      )
  ), differences AS (
    (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
  )
  SELECT pg_catalog.count(*)::integer INTO mismatch_count FROM differences;

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'verify_failed: Plaza column ACL mismatch count %',
      mismatch_count;
  END IF;

  -- Keep the exact compatibility assertions which failed after 18160000.
  IF EXISTS (
       SELECT 1
       FROM (VALUES ('anon'), ('authenticated')) AS app_role(role_name)
       CROSS JOIN pg_catalog.unnest(ARRAY[
         'id', 'user_id', 'content', 'status', 'created_at'
       ]) AS required_column(column_name)
       WHERE NOT pg_catalog.has_column_privilege(
         app_role.role_name,
         'public.posts',
         required_column.column_name,
         'SELECT'
       )
     )
     OR EXISTS (
       SELECT 1
       FROM (VALUES ('anon'), ('authenticated')) AS app_role(role_name)
       CROSS JOIN pg_catalog.unnest(ARRAY[
         'post_id', 'item_id', 'display_order', 'created_at'
       ]) AS required_column(column_name)
       WHERE NOT pg_catalog.has_column_privilege(
         app_role.role_name,
         'public.post_items',
         required_column.column_name,
         'SELECT'
       )
     )
     OR pg_catalog.has_any_column_privilege(
       'anon', 'public.post_items', 'INSERT'
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.unnest(ARRAY[
         'post_id', 'item_id', 'display_order'
       ]) AS required_column(column_name)
       WHERE NOT pg_catalog.has_column_privilege(
         'authenticated',
         'public.post_items',
         required_column.column_name,
         'INSERT'
       )
     )
     OR pg_catalog.has_table_privilege(
       'anon', 'public.post_items', 'DELETE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'authenticated', 'public.post_items', 'DELETE'
     )
     OR pg_catalog.has_any_column_privilege(
       'anon', 'public.post_items', 'UPDATE'
     )
     OR pg_catalog.has_any_column_privilege(
       'authenticated', 'public.post_items', 'UPDATE'
     ) THEN
    RAISE EXCEPTION 'verify_failed: 18160000 Plaza ACL contract unsatisfied';
  END IF;

  -- Exact command, role, USING, and WITH CHECK for all eight permissive
  -- policies. IS DISTINCT FROM makes unexpected NULL predicates fail closed.
  WITH expected(
    table_name, policy_name, command, role_names,
    using_expression, check_expression
  ) AS (
    VALUES
      ('posts', 'Anyone can view active posts', 'r',
       ARRAY['anon','authenticated']::text[],
       $expr$((status='active'::text)andmoderation_private.profile_content_visible(user_id))$expr$,
       NULL::text),
      ('posts', 'Authenticated users can create posts', 'a',
       ARRAY['authenticated']::text[], NULL::text,
       $expr$((auth.uid()=user_id)and(notis_official))$expr$),
      ('posts', 'Users can update own posts', 'w',
       ARRAY['authenticated']::text[], $expr$(auth.uid()=user_id)$expr$,
       $expr$((auth.uid()=user_id)and(notis_official)and(notis_pinned))$expr$),
      ('posts', 'Users can delete own posts', 'd',
       ARRAY['authenticated']::text[], $expr$(auth.uid()=user_id)$expr$,
       NULL::text),
      ('post_items', 'Anyone can view visible post items', 'r',
       ARRAY['anon','authenticated']::text[],
       $expr$((exists(select1frompostsparent_postwhere((parent_post.id=post_items.post_id)and(parent_post.status='active'::text)andmoderation_private.profile_content_visible(parent_post.user_id))))and(exists(select1fromitemsattached_itemwhere((attached_item.id=post_items.item_id)and(attached_item.status<>'deleted'::item_status)andmoderation_private.profile_content_visible(attached_item.user_id)))))$expr$,
       NULL::text),
      ('post_items', 'Post owner can attach own items', 'a',
       ARRAY['authenticated']::text[], NULL::text,
       $expr$((auth.uid()isnotnull)and(exists(select1frompostsparent_postwhere((parent_post.id=post_items.post_id)and(parent_post.user_id=auth.uid())and(parent_post.status='active'::text))))and(exists(select1fromitemsattached_itemwhere((attached_item.id=post_items.item_id)and(attached_item.user_id=auth.uid())and(attached_item.status='active'::item_status))))and(coalesce(((selectprofile.suspension_levelfromget_my_profile()profile))::integer,5)<2))$expr$),
      ('post_items', 'Post owner can detach items', 'd',
       ARRAY['authenticated']::text[],
       $expr$((auth.uid()isnotnull)and(exists(select1frompostsparent_postwhere((parent_post.id=post_items.post_id)and(parent_post.user_id=auth.uid())))))$expr$,
       NULL::text),
      ('post_items', 'No updates to post_items', 'w',
       ARRAY['authenticated']::text[], 'false', 'false')
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
  ), differences AS (
    SELECT expected.policy_name
    FROM expected
    FULL JOIN actual USING (table_name, policy_name)
    WHERE expected.policy_name IS NULL
       OR actual.policy_name IS NULL
       OR actual.command IS DISTINCT FROM expected.command
       OR actual.role_names IS DISTINCT FROM expected.role_names
       OR actual.using_expression IS DISTINCT FROM expected.using_expression
       OR actual.check_expression IS DISTINCT FROM expected.check_expression
  )
  SELECT pg_catalog.count(*)::integer INTO mismatch_count FROM differences;

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'verify_failed: exact Plaza policy contract drift %',
      mismatch_count;
  END IF;

  -- Effective truth matrix catches privilege inherited from parent roles.
  WITH roles(role_name) AS (
    VALUES ('anon'), ('authenticated'), ('service_role')
  ), relations(relation_name) AS (
    VALUES ('posts'), ('post_items')
  ), privileges(privilege_type) AS (
    VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'),
           ('REFERENCES'), ('TRIGGER')
  ), expected(role_name, relation_name, privilege_type) AS (
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
  ), actual AS (
    SELECT role_name, relation_name, privilege_type
    FROM roles CROSS JOIN relations CROSS JOIN privileges
    WHERE pg_catalog.has_table_privilege(
      role_name,
      pg_catalog.format('public.%I', relation_name),
      privilege_type
    )
  ), differences AS (
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  )
  SELECT pg_catalog.count(*)::integer INTO mismatch_count FROM differences;

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'verify_failed: inherited/effective Plaza table ACL drift %',
      mismatch_count;
  END IF;

  -- The effective set does not reveal a parent ACL's grant option. Inspect
  -- direct ACL provenance for every inherited parent role so expected-looking
  -- privileges WITH GRANT OPTION and unexpected inherited privileges fail.
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
  INTO mismatch_count
  FROM inherited
  LEFT JOIN expected USING (role_name, relation_name, privilege_type)
  WHERE expected.role_name IS NULL OR inherited.is_grantable;

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'verify_failed: inherited Plaza table ACL provenance drift %',
      mismatch_count;
  END IF;

  -- PostgreSQL 17 adds MAINTAIN. Keep this verification parseable on PG16,
  -- while checking the effective privilege (including role inheritance) on
  -- PG17 rather than relying only on direct ACL rows.
  IF pg_catalog.current_setting('server_version_num')::integer >= 170000 THEN
    EXECUTE $maintain$
      SELECT pg_catalog.count(*)::integer
      FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
        AS api_role(role_name)
      CROSS JOIN (VALUES ('posts'), ('post_items'))
        AS plaza_relation(relation_name)
      WHERE pg_catalog.has_table_privilege(
        api_role.role_name,
        pg_catalog.format('public.%I', plaza_relation.relation_name),
        'MAINTAIN'
      )
    $maintain$
    INTO maintain_mismatch_count;

    IF maintain_mismatch_count <> 0 THEN
      RAISE EXCEPTION 'verify_failed: inherited/effective Plaza MAINTAIN drift %',
        maintain_mismatch_count;
    END IF;
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
    SELECT role_name, relation_name, privilege_type, column_name
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
  ), actual AS (
    SELECT role_name, relation.relname, privilege_type, attribute.attname
    FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
      AS roles(role_name)
    CROSS JOIN pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = relation.oid
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
    CROSS JOIN pg_catalog.unnest(ARRAY[
      'SELECT','INSERT','UPDATE','REFERENCES'
    ]) AS privileges(privilege_type)
    WHERE relation.oid IN (
      'public.posts'::pg_catalog.regclass,
      'public.post_items'::pg_catalog.regclass
    )
      AND pg_catalog.has_column_privilege(
        role_name, relation.oid, attribute.attnum, privilege_type
      )
  ), differences AS (
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  )
  SELECT pg_catalog.count(*)::integer INTO mismatch_count FROM differences;

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'verify_failed: inherited/effective Plaza column ACL drift %',
      mismatch_count;
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
  INTO mismatch_count
  FROM inherited
  LEFT JOIN expected
    USING (role_name, relation_name, privilege_type, column_name)
  WHERE expected.role_name IS NULL OR inherited.is_grantable;

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'verify_failed: inherited Plaza column ACL provenance drift %',
      mismatch_count;
  END IF;
END;
$verify$;

ROLLBACK;
