-- Forward-only repair for the Plaza base-table ACL contract introduced by
-- 20260718160000_reconcile_expired_suspension_visibility.sql.
--
-- PostgreSQL GRANT is additive.  Migration 18160000 granted the privileges the
-- shipped client needs, but only revoked UPDATE on post_items.  A project whose
-- historical default privileges had already granted INSERT or DELETE to anon
-- therefore retained those writes even though the RLS policies were repaired.
-- Clear both table- and column-level drift for the two Plaza relations, then
-- restore the exact current client projection and the service_role CRUD
-- contract later migration 18280000 will retain.  The transaction also
-- normalizes all eight Plaza policies and proves both direct and inherited
-- privileges before it can commit.

BEGIN;
SET LOCAL search_path = public, pg_catalog;

DO $guard$
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
      SELECT 1
      FROM pg_catalog.pg_roles AS role
      WHERE role.rolname = required.role_name
    )
  ) THEN
    RAISE EXCEPTION 'plaza_acl_api_role_missing' USING ERRCODE = '55000';
  END IF;

  FOREACH relation_name IN ARRAY ARRAY['posts', 'post_items']::text[] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS relation
      WHERE relation.oid = pg_catalog.to_regclass(
        'public.' || relation_name
      )
        AND relation.relkind = 'r'
        AND relation.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'plaza_acl_rls_prerequisite_missing: %', relation_name
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  IF pg_catalog.to_regprocedure('auth.uid()') IS NULL
     OR pg_catalog.to_regprocedure(
       'moderation_private.profile_content_visible(uuid)'
     ) IS NULL THEN
    RAISE EXCEPTION 'plaza_acl_policy_helper_missing'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('posts', 'id'),
      ('posts', 'user_id'),
      ('posts', 'content'),
      ('posts', 'images'),
      ('posts', 'is_official'),
      ('posts', 'is_pinned'),
      ('posts', 'like_count'),
      ('posts', 'comment_count'),
      ('posts', 'status'),
      ('posts', 'created_at'),
      ('posts', 'updated_at'),
      ('posts', 'image_dimensions'),
      ('posts', 'content_i18n'),
      ('posts', 'source_lang'),
      ('post_items', 'post_id'),
      ('post_items', 'item_id'),
      ('post_items', 'display_order'),
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
    RAISE EXCEPTION 'plaza_acl_column_prerequisite_missing'
      USING ERRCODE = '55000';
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
    RAISE EXCEPTION 'plaza_acl_permissive_policy_drift: %',
      policy_mismatch_count
      USING ERRCODE = '55000';
  END IF;

  -- Accept only the exact target policy contract or the three known legacy
  -- posts write policies whose predicate is exact but role list is PUBLIC.
  -- The migration rewrites that historical role shape below. NULL predicates,
  -- true predicates, wrong commands, and every other same-name mutation fail.
  WITH expected(
    table_name, policy_name, command, role_names, legacy_public_allowed,
    using_expression, check_expression
  ) AS (
    VALUES
      (
        'posts', 'Anyone can view active posts', 'r',
        ARRAY['anon','authenticated']::text[], false,
        $expr$((status='active'::text)andmoderation_private.profile_content_visible(user_id))$expr$,
        NULL::text
      ),
      (
        'posts', 'Authenticated users can create posts', 'a',
        ARRAY['authenticated']::text[], true,
        NULL::text,
        $expr$((auth.uid()=user_id)and(notis_official))$expr$
      ),
      (
        'posts', 'Users can update own posts', 'w',
        ARRAY['authenticated']::text[], true,
        $expr$(auth.uid()=user_id)$expr$,
        $expr$((auth.uid()=user_id)and(notis_official)and(notis_pinned))$expr$
      ),
      (
        'posts', 'Users can delete own posts', 'd',
        ARRAY['authenticated']::text[], true,
        $expr$(auth.uid()=user_id)$expr$,
        NULL::text
      ),
      (
        'post_items', 'Anyone can view visible post items', 'r',
        ARRAY['anon','authenticated']::text[], false,
        $expr$((exists(select1frompostsparent_postwhere((parent_post.id=post_items.post_id)and(parent_post.status='active'::text)andmoderation_private.profile_content_visible(parent_post.user_id))))and(exists(select1fromitemsattached_itemwhere((attached_item.id=post_items.item_id)and(attached_item.status<>'deleted'::item_status)andmoderation_private.profile_content_visible(attached_item.user_id)))))$expr$,
        NULL::text
      ),
      (
        'post_items', 'Post owner can attach own items', 'a',
        ARRAY['authenticated']::text[], false,
        NULL::text,
        $expr$((auth.uid()isnotnull)and(exists(select1frompostsparent_postwhere((parent_post.id=post_items.post_id)and(parent_post.user_id=auth.uid())and(parent_post.status='active'::text))))and(exists(select1fromitemsattached_itemwhere((attached_item.id=post_items.item_id)and(attached_item.user_id=auth.uid())and(attached_item.status='active'::item_status))))and(coalesce(((selectprofile.suspension_levelfromget_my_profile()profile))::integer,5)<2))$expr$
      ),
      (
        'post_items', 'Post owner can detach items', 'd',
        ARRAY['authenticated']::text[], false,
        $expr$((auth.uid()isnotnull)and(exists(select1frompostsparent_postwhere((parent_post.id=post_items.post_id)and(parent_post.user_id=auth.uid())))))$expr$,
        NULL::text
      ),
      (
        'post_items', 'No updates to post_items', 'w',
        ARRAY['authenticated']::text[], false,
        'false', 'false'
      )
  ), actual AS (
    SELECT
      relation.relname AS table_name,
      policy.polname AS policy_name,
      policy.polcmd AS command,
      policy_roles.role_names,
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
    RAISE EXCEPTION 'plaza_acl_policy_contract_mismatch: %',
      policy_mismatch_count
      USING ERRCODE = '55000';
  END IF;
END;
$guard$;

-- Normalize every permissive Plaza policy before reopening Data API ACLs.
DROP POLICY IF EXISTS "Anyone can view active posts" ON public.posts;
CREATE POLICY "Anyone can view active posts"
  ON public.posts FOR SELECT TO anon, authenticated
  USING (
    status = 'active'
    AND moderation_private.profile_content_visible(user_id)
  );

DROP POLICY IF EXISTS "Authenticated users can create posts" ON public.posts;
CREATE POLICY "Authenticated users can create posts"
  ON public.posts FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND NOT is_official);

DROP POLICY IF EXISTS "Users can update own posts" ON public.posts;
CREATE POLICY "Users can update own posts"
  ON public.posts FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND NOT is_official
    AND NOT is_pinned
  );

DROP POLICY IF EXISTS "Users can delete own posts" ON public.posts;
CREATE POLICY "Users can delete own posts"
  ON public.posts FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Anyone can view visible post items" ON public.post_items;
CREATE POLICY "Anyone can view visible post items"
  ON public.post_items FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.posts AS parent_post
      WHERE parent_post.id = post_id
        AND parent_post.status = 'active'
        AND moderation_private.profile_content_visible(parent_post.user_id)
    )
    AND EXISTS (
      SELECT 1
      FROM public.items AS attached_item
      WHERE attached_item.id = item_id
        AND attached_item.status <> 'deleted'::public.item_status
        AND moderation_private.profile_content_visible(attached_item.user_id)
    )
  );

DROP POLICY IF EXISTS "Post owner can attach own items" ON public.post_items;
CREATE POLICY "Post owner can attach own items"
  ON public.post_items FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.posts AS parent_post
      WHERE parent_post.id = post_id
        AND parent_post.user_id = auth.uid()
        AND parent_post.status = 'active'
    )
    AND EXISTS (
      SELECT 1
      FROM public.items AS attached_item
      WHERE attached_item.id = item_id
        AND attached_item.user_id = auth.uid()
        AND attached_item.status = 'active'::public.item_status
    )
    AND COALESCE((
      SELECT profile.suspension_level
      FROM public.get_my_profile() AS profile
    ), 5) < 2
  );

DROP POLICY IF EXISTS "Post owner can detach items" ON public.post_items;
CREATE POLICY "Post owner can detach items"
  ON public.post_items FOR DELETE TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.posts AS parent_post
      WHERE parent_post.id = post_id
        AND parent_post.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "No updates to post_items" ON public.post_items;
CREATE POLICY "No updates to post_items"
  ON public.post_items FOR UPDATE TO authenticated
  USING (false)
  WITH CHECK (false);

-- REVOKE ON TABLE does not clear attacl entries.  Reset both forms for only
-- the two public client roles, service_role, and PUBLIC.
DO $clear_app_acl$
DECLARE
  relation_name text;
  column_list text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['posts', 'post_items']::text[] LOOP
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
$clear_app_acl$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.posts,
  public.post_items
TO service_role;

GRANT SELECT (
  id, user_id, content, images, is_official, is_pinned, like_count,
  comment_count, status, created_at, updated_at, image_dimensions,
  content_i18n, source_lang
) ON TABLE public.posts TO anon, authenticated;

GRANT SELECT (post_id, item_id, display_order, created_at)
  ON TABLE public.post_items TO anon, authenticated;

GRANT INSERT (
  user_id, content, images, image_dimensions, content_i18n, source_lang
) ON TABLE public.posts TO authenticated;
GRANT UPDATE (content_i18n) ON TABLE public.posts TO authenticated;
GRANT DELETE ON TABLE public.posts TO authenticated;

GRANT INSERT (post_id, item_id, display_order)
  ON TABLE public.post_items TO authenticated;
GRANT DELETE ON TABLE public.post_items TO authenticated;

DO $postcondition$
DECLARE
  mismatch_count integer;
  maintain_mismatch_count integer;
  profile_short_alias CONSTANT text :=
    'get_my_profile()profile(suspension_level)';
  profile_pg17_alias CONSTANT text :=
    'get_my_profile()profile(id,phone,email,wechat_openid,nickname,avatar_url,bio,location,created_at,updated_at,is_illini_verified,uid,avg_rating,rating_count,status_text,status_emoji,trust_score,shadow_banned,suspension_level,suspended_until,last_fp_hash,last_fp_seen_at,warning_count,tos_version,consented_at,onboarded_at,campus_area,wechat_unionid,response_rate,response_sample,email_digest_opt_out,unsubscribe_token,verified_illini_email)';
  profile_canonical_alias CONSTANT text := 'get_my_profile()profile';
BEGIN
  -- Exact policy shape. IS DISTINCT FROM makes every unexpected NULL fail.
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
    SELECT
      relation.relname AS table_name,
      policy.polname AS policy_name,
      policy.polcmd AS command,
      policy_roles.role_names,
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
    RAISE EXCEPTION 'plaza_acl_postcondition_policy_mismatch: %',
      mismatch_count USING ERRCODE = '55000';
  END IF;

  -- Exact direct table ACL, including owner grantor and no grant option.
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
    RAISE EXCEPTION 'plaza_acl_postcondition_direct_table_acl_mismatch: %',
      mismatch_count USING ERRCODE = '55000';
  END IF;

  -- Exact direct column ACL; EXCEPT ALL catches duplicate grants from a second
  -- grantor, while grantor/is_grantable are first-class contract fields.
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
      (ARRAY['authenticated'], 'posts', 'UPDATE', ARRAY['content_i18n']),
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
    SELECT acl.grantee, relation.oid, acl.privilege_type, attribute.attnum,
           acl.grantor, acl.is_grantable
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
    RAISE EXCEPTION 'plaza_acl_postcondition_direct_column_acl_mismatch: %',
      mismatch_count USING ERRCODE = '55000';
  END IF;

  -- Effective table privileges include role membership. A mismatch after the
  -- direct ACL reset can only be inherited/owner drift, so abort everything.
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
    RAISE EXCEPTION 'plaza_acl_inherited_table_privilege_drift: %',
      mismatch_count
      USING ERRCODE = '55000',
            HINT = 'Remove role membership or inherited Plaza ACLs, then retry the migration.';
  END IF;

  -- Re-check the direct ACL source behind inherited effective privileges. The
  -- truth matrix above cannot distinguish an expected privilege from the same
  -- privilege inherited WITH GRANT OPTION. This closes the PRECHECK-to-COMMIT
  -- race and rejects unexpected parent-role privileges of every server version.
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
    RAISE EXCEPTION 'plaza_acl_inherited_table_acl_provenance_drift: %',
      mismatch_count
      USING ERRCODE = '55000',
            HINT = 'Remove parent-role ACLs or grant options, then retry the migration.';
  END IF;

  -- PostgreSQL 17 adds the table-level MAINTAIN privilege. Keep the migration
  -- parseable on PostgreSQL 16 by naming it only inside version-gated dynamic
  -- SQL. Direct MAINTAIN drift was removed by REVOKE ALL above; any effective
  -- privilege left here is inherited/owner drift and must abort the commit.
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
      RAISE EXCEPTION 'plaza_acl_inherited_maintain_privilege_drift: %',
        maintain_mismatch_count
        USING ERRCODE = '55000',
              HINT = 'Remove inherited Plaza MAINTAIN privileges, then retry the migration.';
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
    RAISE EXCEPTION 'plaza_acl_inherited_column_privilege_drift: %',
      mismatch_count
      USING ERRCODE = '55000',
            HINT = 'Remove role membership or inherited Plaza ACLs, then retry the migration.';
  END IF;

  -- Effective column privileges likewise hide whether the capability came
  -- from a parent ACL WITH GRANT OPTION. Inspect attacl provenance after the
  -- reset so a concurrent membership/grant change cannot survive COMMIT.
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
    RAISE EXCEPTION 'plaza_acl_inherited_column_acl_provenance_drift: %',
      mismatch_count
      USING ERRCODE = '55000',
            HINT = 'Remove parent-role column ACLs or grant options, then retry the migration.';
  END IF;
END;
$postcondition$;

COMMIT;
