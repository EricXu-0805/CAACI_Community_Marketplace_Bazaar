-- Read-only post-deploy verification for
-- 20260718160000_reconcile_expired_suspension_visibility.sql.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $verify$
DECLARE
  state_helper oid := pg_catalog.to_regprocedure(
    'moderation_private.current_profile_state(uuid)'
  );
  visibility_helper oid := pg_catalog.to_regprocedure(
    'moderation_private.profile_content_visible(uuid)'
  );
  posting_gate oid := pg_catalog.to_regprocedure(
    'public.is_posting_allowed(uuid)'
  );
  function_signature text;
  function_source text;
  view_definition text;
  policy_expression text;
  policy_check_expression text;
  actual_view_columns text[];
  item_view_dependents text[];
BEGIN
  IF state_helper IS NULL OR visibility_helper IS NULL THEN
    RAISE EXCEPTION 'verify_failed: canonical moderation helpers missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid = state_helper
      AND function.prokind = 'f'
      AND function.prosecdef
      AND function.provolatile = 's'
      AND function.prorettype = 'record'::pg_catalog.regtype
      AND COALESCE(function.proconfig, ARRAY[]::text[])
        @> ARRAY['search_path=pg_catalog']::text[]
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid = visibility_helper
      AND function.prokind = 'f'
      AND function.prosecdef
      AND function.provolatile = 's'
      AND function.prorettype = 'boolean'::pg_catalog.regtype
      AND COALESCE(function.proconfig, ARRAY[]::text[])
        @> ARRAY['search_path=pg_catalog']::text[]
  ) THEN
    RAISE EXCEPTION 'verify_failed: helper shape/security mismatch';
  END IF;

  IF pg_catalog.has_function_privilege('anon', state_helper, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
       'authenticated', state_helper, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', state_helper, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'anon', visibility_helper, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'authenticated', visibility_helper, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'service_role', visibility_helper, 'EXECUTE'
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc AS function
       CROSS JOIN LATERAL pg_catalog.aclexplode(
         COALESCE(
           function.proacl,
           pg_catalog.acldefault('f', function.proowner)
         )
       ) AS function_acl
       WHERE function.oid IN (state_helper, visibility_helper)
         AND function_acl.grantee = 0
         AND function_acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'verify_failed: helper ACL mismatch';
  END IF;

  -- is_posting_allowed accepts a profile UUID, so exposing it through the
  -- public Data API would let any caller enumerate another user's private L2+
  -- moderation state. Keep it available only to trusted service-side logic.
  IF posting_gate IS NULL
     OR pg_catalog.has_function_privilege('anon', posting_gate, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
       'authenticated', posting_gate, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'service_role', posting_gate, 'EXECUTE'
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc AS function
       CROSS JOIN LATERAL pg_catalog.aclexplode(
         COALESCE(
           function.proacl,
           pg_catalog.acldefault('f', function.proowner)
         )
       ) AS function_acl
       WHERE function.oid = posting_gate
         AND function_acl.grantee = 0
         AND function_acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'verify_failed: posting gate ACL exposes moderation state';
  END IF;

  IF NOT pg_catalog.has_schema_privilege(
       'anon', 'moderation_private', 'USAGE'
     )
     OR NOT pg_catalog.has_schema_privilege(
       'authenticated', 'moderation_private', 'USAGE'
     )
     OR pg_catalog.has_schema_privilege(
       'anon', 'moderation_private', 'CREATE'
     )
     OR pg_catalog.has_schema_privilege(
       'authenticated', 'moderation_private', 'CREATE'
     ) THEN
    RAISE EXCEPTION 'verify_failed: helper schema privilege mismatch';
  END IF;

  SELECT function.prosrc
  INTO STRICT function_source
  FROM pg_catalog.pg_proc AS function
  WHERE function.oid = state_helper;

  IF pg_catalog.strpos(function_source, 'suspension.started_at <=') = 0
     OR pg_catalog.strpos(function_source, 'suspension.lifted_at IS NULL') = 0
     OR pg_catalog.strpos(function_source, 'suspension.ends_at >') = 0
     OR pg_catalog.strpos(function_source, 'suspension.level >= 3') = 0 THEN
    RAISE EXCEPTION 'verify_failed: canonical active predicate incomplete';
  END IF;

  SELECT function.prosrc
  INTO STRICT function_source
  FROM pg_catalog.pg_proc AS function
  WHERE function.oid = visibility_helper;
  IF pg_catalog.strpos(function_source, 'suspension.level >= 3') = 0
     OR pg_catalog.strpos(function_source, 'suspension.started_at <=') = 0
     OR pg_catalog.strpos(function_source, 'suspension.lifted_at IS NULL') = 0
     OR pg_catalog.strpos(function_source, 'suspension.ends_at >') = 0 THEN
    RAISE EXCEPTION 'verify_failed: visibility helper active predicate incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS index_relation
    JOIN pg_catalog.pg_index AS index_definition
      ON index_definition.indexrelid = index_relation.oid
    WHERE index_relation.oid =
      'public.suspensions_active_shadow_profile_idx'::pg_catalog.regclass
      AND index_definition.indisvalid
      AND index_definition.indisready
      AND pg_catalog.pg_get_expr(
        index_definition.indpred,
        index_definition.indrelid
      ) ILIKE '%lifted_at IS NULL%level >= 3%'
  ) THEN
    RAISE EXCEPTION 'verify_failed: active-shadow partial index missing';
  END IF;

  SELECT pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
  INTO STRICT policy_expression
  FROM pg_catalog.pg_policy AS policy
  WHERE policy.polrelid = 'public.items'::pg_catalog.regclass
    AND policy.polname = 'Anyone can view active items';

  IF policy_expression NOT ILIKE '%status%deleted%'
     OR policy_expression NOT ILIKE
       '%moderation_private.profile_content_visible(user_id)%' THEN
    RAISE EXCEPTION 'verify_failed: item SELECT policy predicate mismatch';
  END IF;

  SELECT pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
  INTO STRICT policy_expression
  FROM pg_catalog.pg_policy AS policy
  WHERE policy.polrelid = 'public.posts'::pg_catalog.regclass
    AND policy.polname = 'Anyone can view active posts';

  IF policy_expression NOT ILIKE '%status%active%'
     OR policy_expression NOT ILIKE
       '%moderation_private.profile_content_visible(user_id)%' THEN
    RAISE EXCEPTION 'verify_failed: post SELECT policy predicate mismatch';
  END IF;

  -- The tail ACL reconciliation replaces broad table grants with explicit
  -- app projections. has_column_privilege also succeeds for the original
  -- table-level grant, so these assertions remain valid at both deployment
  -- stages without allowing a partial Plaza contract.
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
    RAISE EXCEPTION 'verify_failed: Plaza base-table ACL mismatch';
  END IF;

  IF NOT (
    SELECT relation.relrowsecurity
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = 'public.post_items'::pg_catalog.regclass
  ) THEN
    RAISE EXCEPTION 'verify_failed: post_items RLS not enabled';
  END IF;

  SELECT pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
  INTO STRICT policy_expression
  FROM pg_catalog.pg_policy AS policy
  WHERE policy.polrelid = 'public.post_items'::pg_catalog.regclass
    AND policy.polname = 'Anyone can view visible post items'
    AND policy.polcmd = 'r'
    AND policy.polpermissive
    AND pg_catalog.cardinality(policy.polroles) = 2
    AND policy.polroles @> ARRAY[
      pg_catalog.to_regrole('anon')::oid,
      pg_catalog.to_regrole('authenticated')::oid
    ];

  IF policy_expression NOT ILIKE '%parent_post.status%active%'
     OR policy_expression NOT ILIKE '%attached_item.status%deleted%'
     OR policy_expression NOT ILIKE
       '%moderation_private.profile_content_visible(parent_post.user_id)%'
     OR policy_expression NOT ILIKE
       '%moderation_private.profile_content_visible(attached_item.user_id)%' THEN
    RAISE EXCEPTION 'verify_failed: post_items SELECT boundary mismatch';
  END IF;

  SELECT pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid)
  INTO STRICT policy_check_expression
  FROM pg_catalog.pg_policy AS policy
  WHERE policy.polrelid = 'public.post_items'::pg_catalog.regclass
    AND policy.polname = 'Post owner can attach own items'
    AND policy.polcmd = 'a'
    AND policy.polpermissive
    AND policy.polroles = ARRAY[
      pg_catalog.to_regrole('authenticated')::oid
    ];

  IF policy_check_expression NOT ILIKE '%parent_post.user_id%auth.uid()%'
     OR policy_check_expression NOT ILIKE '%parent_post.status%active%'
     OR policy_check_expression NOT ILIKE '%attached_item.user_id%auth.uid()%'
     OR policy_check_expression NOT ILIKE '%attached_item.status%active%'
     OR policy_check_expression NOT ILIKE '%get_my_profile%'
     OR policy_check_expression NOT ILIKE '%suspension_level%' THEN
    RAISE EXCEPTION 'verify_failed: post_items INSERT boundary mismatch';
  END IF;

  SELECT pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
  INTO STRICT policy_expression
  FROM pg_catalog.pg_policy AS policy
  WHERE policy.polrelid = 'public.post_items'::pg_catalog.regclass
    AND policy.polname = 'Post owner can detach items'
    AND policy.polcmd = 'd'
    AND policy.polpermissive
    AND policy.polroles = ARRAY[
      pg_catalog.to_regrole('authenticated')::oid
    ];
  IF policy_expression NOT ILIKE '%parent_post.user_id%auth.uid()%' THEN
    RAISE EXCEPTION 'verify_failed: post_items DELETE owner boundary mismatch';
  END IF;

  SELECT pg_catalog.pg_get_expr(policy.polqual, policy.polrelid),
         pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid)
  INTO STRICT policy_expression, policy_check_expression
  FROM pg_catalog.pg_policy AS policy
  WHERE policy.polrelid = 'public.post_items'::pg_catalog.regclass
    AND policy.polname = 'No updates to post_items'
    AND policy.polcmd = 'w';
  IF policy_expression <> 'false' OR policy_check_expression <> 'false' THEN
    RAISE EXCEPTION 'verify_failed: post_items UPDATE boundary mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS policy
    WHERE policy.polrelid = 'public.post_items'::pg_catalog.regclass
      AND policy.polpermissive
      AND policy.polname NOT IN (
        'Anyone can view visible post items',
        'Post owner can attach own items',
        'Post owner can detach items',
        'No updates to post_items'
      )
  ) THEN
    RAISE EXCEPTION 'verify_failed: competing permissive post_items policy';
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
    RAISE EXCEPTION 'verify_failed: competing permissive SELECT policy';
  END IF;

  FOREACH function_signature IN ARRAY ARRAY[
    'public.items_visible',
    'public.posts_visible'
  ]::text[] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS view_relation
      WHERE view_relation.oid = function_signature::pg_catalog.regclass
        AND view_relation.relkind = 'v'
        AND COALESCE(view_relation.reloptions, ARRAY[]::text[])
          @> ARRAY[
            'security_invoker=true',
            'security_barrier=true'
          ]::text[]
    ) THEN
      RAISE EXCEPTION
        'verify_failed: % security options mismatch', function_signature;
    END IF;

    SELECT pg_catalog.pg_get_viewdef(
      function_signature::pg_catalog.regclass,
      true
    )
    INTO view_definition;
    IF view_definition NOT ILIKE
         '%moderation_private.profile_content_visible%'
       OR view_definition ILIKE '%profile.shadow_banned%'
       OR view_definition ILIKE '%profiles.shadow_banned%' THEN
      RAISE EXCEPTION
        'verify_failed: % still depends on cached shadow state',
        function_signature;
    END IF;
    IF function_signature = 'public.items_visible'
       AND view_definition NOT ILIKE '%status%deleted%' THEN
      RAISE EXCEPTION
        'verify_failed: items_visible does not reject deleted items';
    END IF;
    IF function_signature = 'public.posts_visible'
       AND view_definition NOT ILIKE '%status%active%' THEN
      RAISE EXCEPTION
        'verify_failed: posts_visible does not reject hidden/deleted posts';
    END IF;
  END LOOP;

  SELECT pg_catalog.array_agg(attribute.attname ORDER BY attribute.attnum)
  INTO STRICT actual_view_columns
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = 'public.items_visible'::pg_catalog.regclass
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;

  IF actual_view_columns IS DISTINCT FROM ARRAY[
    'id', 'user_id', 'title', 'description', 'price', 'category', 'condition',
    'status', 'location', 'images', 'view_count', 'created_at', 'updated_at',
    'negotiable', 'image_dimensions', 'title_i18n', 'description_i18n',
    'source_lang', 'favorite_count', 'location_verified', 'listing_type'
  ]::text[] THEN
    RAISE EXCEPTION
      'verify_failed: items_visible projection drifted: %', actual_view_columns;
  END IF;

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
      'verify_failed: unexpected items_visible dependents %',
      item_view_dependents;
  END IF;

  IF NOT pg_catalog.has_table_privilege(
       'anon', 'public.items_visible', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'authenticated', 'public.items_visible', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'service_role', 'public.items_visible', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'anon', 'public.posts_visible', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'authenticated', 'public.posts_visible', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'service_role', 'public.posts_visible', 'SELECT'
     ) THEN
    RAISE EXCEPTION 'verify_failed: visible-view SELECT grants mismatch';
  END IF;

  SELECT function.prosrc
  INTO STRICT function_source
  FROM pg_catalog.pg_proc AS function
  WHERE function.oid = pg_catalog.to_regprocedure(
    'public.compute_trust_score(uuid)'
  );
  IF pg_catalog.strpos(
       function_source,
       'moderation_private.current_profile_state'
     ) = 0
     OR function_source ILIKE '%profile.shadow_banned%'
     OR function_source ILIKE '%pr.shadow_banned%' THEN
    RAISE EXCEPTION 'verify_failed: trust score still reads cached shadow flag';
  END IF;

  FOREACH function_signature IN ARRAY ARRAY[
    'public.trg_enforce_actor()',
    'public.is_posting_allowed(uuid)',
    'public.get_my_profile()'
  ]::text[] LOOP
    SELECT function.prosrc
    INTO STRICT function_source
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid = pg_catalog.to_regprocedure(function_signature);
    IF pg_catalog.strpos(
         function_source,
         'moderation_private.current_profile_state'
       ) = 0 THEN
      RAISE EXCEPTION
        'verify_failed: % does not use canonical state', function_signature;
    END IF;
  END LOOP;

  FOREACH function_signature IN ARRAY ARRAY[
    'public.admin_get_suspension_detail(uuid)',
    'public.admin_list_warnings(integer,integer)',
    'public.admin_search_users(text,integer)',
    'public.admin_get_linked_accounts(uuid)'
  ]::text[] LOOP
    SELECT function.prosrc
    INTO STRICT function_source
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid = pg_catalog.to_regprocedure(function_signature);
    IF function_signature <> 'public.admin_get_suspension_detail(uuid)'
       AND pg_catalog.strpos(
         function_source,
         'moderation_private.current_profile_state'
       ) = 0 THEN
      RAISE EXCEPTION
        'verify_failed: % still exposes cached moderation state',
        function_signature;
    END IF;
    IF function_signature = 'public.admin_get_suspension_detail(uuid)'
       AND pg_catalog.strpos(
         function_source,
         'public.compute_trust_score'
       ) = 0 THEN
      RAISE EXCEPTION
        'verify_failed: suspension detail still exposes cached trust score';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    CROSS JOIN LATERAL moderation_private.current_profile_state(profile.id)
      AS state
    WHERE (
      profile.suspension_level <> 0
      OR profile.suspended_until IS NOT NULL
      OR profile.shadow_banned
      OR EXISTS (
        SELECT 1
        FROM public.suspensions AS suspension
        WHERE suspension.profile_id = profile.id
      )
    )
      AND (
        profile.suspension_level IS DISTINCT FROM state.suspension_level
        OR profile.suspended_until IS DISTINCT FROM state.suspended_until
        OR profile.shadow_banned IS DISTINCT FROM state.shadow_banned
        OR profile.trust_score IS DISTINCT FROM
          public.compute_trust_score(profile.id)
      )
  ) THEN
    RAISE EXCEPTION 'verify_failed: deployment cache reconciliation incomplete';
  END IF;

  FOREACH function_signature IN ARRAY ARRAY[
    'public.admin_list_suspensions(integer,integer,boolean)',
    'public.admin_get_suspension_detail(uuid)',
    'public.admin_list_appeals(integer,integer)',
    'public.admin_list_warnings(integer,integer)',
    'public.admin_dashboard_stats()',
    'public.admin_search_users(text,integer)',
    'public.admin_get_linked_accounts(uuid)'
  ]::text[] LOOP
    IF pg_catalog.has_function_privilege(
         'anon', function_signature, 'EXECUTE'
       )
       OR pg_catalog.has_function_privilege(
         'authenticated', function_signature, 'EXECUTE'
       )
       OR NOT pg_catalog.has_function_privilege(
         'service_role', function_signature, 'EXECUTE'
       ) THEN
      RAISE EXCEPTION
        'verify_failed: admin RPC ACL mismatch for %', function_signature;
    END IF;
  END LOOP;
END
$verify$;

SELECT
  relation.relname AS relation_name,
  relation.reloptions,
  pg_catalog.pg_get_viewdef(relation.oid, true) AS definition
FROM pg_catalog.pg_class AS relation
WHERE relation.oid IN (
  'public.items_visible'::pg_catalog.regclass,
  'public.posts_visible'::pg_catalog.regclass
)
ORDER BY relation.relname;

SELECT
  function.oid::pg_catalog.regprocedure AS function_name,
  function.prosecdef AS security_definer,
  function.provolatile AS volatility,
  function.proconfig,
  pg_catalog.has_function_privilege(
    'anon', function.oid, 'EXECUTE'
  ) AS anon_execute,
  pg_catalog.has_function_privilege(
    'authenticated', function.oid, 'EXECUTE'
  ) AS authenticated_execute,
  pg_catalog.has_function_privilege(
    'service_role', function.oid, 'EXECUTE'
  ) AS service_role_execute
FROM pg_catalog.pg_proc AS function
WHERE function.oid IN (
  pg_catalog.to_regprocedure(
    'moderation_private.current_profile_state(uuid)'
  ),
  pg_catalog.to_regprocedure(
    'moderation_private.profile_content_visible(uuid)'
  ),
  pg_catalog.to_regprocedure('public.compute_trust_score(uuid)'),
  pg_catalog.to_regprocedure('public.get_my_profile()'),
  pg_catalog.to_regprocedure('public.trg_enforce_actor()'),
  pg_catalog.to_regprocedure('public.is_posting_allowed(uuid)')
)
ORDER BY function.oid::pg_catalog.regprocedure::text;

ROLLBACK;
