-- Local/isolated adversarial regression for migration 20260719151729.
-- NEVER run against production. Every policy, ACL, and role change rolls back.

\set ON_ERROR_STOP on

BEGIN;
SET LOCAL search_path = public, pg_catalog;

DO $baseline_contract$
DECLARE
  privilege_type text;
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['posts', 'post_items']::text[] LOOP
    FOREACH privilege_type IN ARRAY ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE'
    ]::text[] LOOP
      IF NOT pg_catalog.has_table_privilege(
        'service_role',
        pg_catalog.format('public.%I', relation_name),
        privilege_type
      ) THEN
        RAISE EXCEPTION 'baseline service_role CRUD missing %.%',
          relation_name, privilege_type;
      END IF;
    END LOOP;
  END LOOP;

  IF pg_catalog.has_any_column_privilege(
       'anon', 'public.post_items', 'INSERT'
     )
     OR pg_catalog.has_table_privilege(
       'anon', 'public.post_items', 'DELETE'
     )
     OR pg_catalog.has_any_column_privilege(
       'authenticated', 'public.post_items', 'UPDATE'
     ) THEN
    RAISE EXCEPTION 'baseline Plaza client ACL is not closed';
  END IF;
END;
$baseline_contract$;

SAVEPOINT public_true_policy;
DROP POLICY "Anyone can view active posts" ON public.posts;
CREATE POLICY "Anyone can view active posts"
  ON public.posts FOR SELECT TO PUBLIC USING (true);
DO $public_true_detected$
DECLARE
  expression_text text;
  role_names text[];
BEGIN
  SELECT
    pg_catalog.lower(pg_catalog.regexp_replace(
      pg_catalog.pg_get_expr(policy.polqual, policy.polrelid),
      '[[:space:]]+', '', 'g'
    )),
    ARRAY(
      SELECT CASE WHEN role_oid = 0
        THEN 'PUBLIC' ELSE role.rolname::text END
      FROM pg_catalog.unnest(policy.polroles) AS policy_role(role_oid)
      LEFT JOIN pg_catalog.pg_roles AS role ON role.oid = role_oid
      ORDER BY 1
    )
  INTO STRICT expression_text, role_names
  FROM pg_catalog.pg_policy AS policy
  WHERE policy.polrelid = 'public.posts'::pg_catalog.regclass
    AND policy.polname = 'Anyone can view active posts';

  IF expression_text IS NOT DISTINCT FROM
       $expr$((status='active'::text)andmoderation_private.profile_content_visible(user_id))$expr$
     AND role_names IS NOT DISTINCT FROM
       ARRAY['anon','authenticated']::text[] THEN
    RAISE EXCEPTION 'PUBLIC/true policy escaped exact detection';
  END IF;
END;
$public_true_detected$;
ROLLBACK TO SAVEPOINT public_true_policy;

SAVEPOINT null_policy_predicate;
DROP POLICY "Authenticated users can create posts" ON public.posts;
CREATE POLICY "Authenticated users can create posts"
  ON public.posts FOR INSERT TO authenticated;
DO $null_predicate_detected$
DECLARE
  check_expression text;
BEGIN
  SELECT pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid)
  INTO STRICT check_expression
  FROM pg_catalog.pg_policy AS policy
  WHERE policy.polrelid = 'public.posts'::pg_catalog.regclass
    AND policy.polname = 'Authenticated users can create posts';

  IF check_expression IS NOT NULL THEN
    RAISE EXCEPTION 'NULL predicate adversarial fixture was not created';
  END IF;
  IF check_expression IS NOT DISTINCT FROM
       $expr$((auth.uid() = user_id) AND (NOT is_official))$expr$ THEN
    RAISE EXCEPTION 'NULL predicate escaped IS DISTINCT FROM detection';
  END IF;
END;
$null_predicate_detected$;
ROLLBACK TO SAVEPOINT null_policy_predicate;

-- PostgreSQL 16 may deparse the RETURNS TABLE fixture as profile(suspension_level),
-- while production PostgreSQL 17 expands the exact public.profiles composite
-- alias. Only those two reviewed signatures are canonicalized; a reordered or
-- otherwise mutated output list must remain different and fail closed.
DO $pg17_alias_signature_detected$
DECLARE
  profile_short_alias CONSTANT text :=
    'get_my_profile()profile(suspension_level)';
  profile_pg17_alias CONSTANT text :=
    'get_my_profile()profile(id,phone,email,wechat_openid,nickname,avatar_url,bio,location,created_at,updated_at,is_illini_verified,uid,avg_rating,rating_count,status_text,status_emoji,trust_score,shadow_banned,suspension_level,suspended_until,last_fp_hash,last_fp_seen_at,warning_count,tos_version,consented_at,onboarded_at,campus_area,wechat_unionid,response_rate,response_sample,email_digest_opt_out,unsubscribe_token,verified_illini_email)';
  profile_canonical_alias CONSTANT text := 'get_my_profile()profile';
  canonical_expression CONSTANT text :=
    $ALIAS_EXPR$((selectprofile.suspension_levelfromget_my_profile()profile))$ALIAS_EXPR$;
  short_expression text;
  pg17_expression text;
  mutated_expression text;
  normalized_expression text;
BEGIN
  short_expression := pg_catalog.replace(
    canonical_expression, profile_canonical_alias, profile_short_alias
  );
  pg17_expression := pg_catalog.replace(
    canonical_expression, profile_canonical_alias, profile_pg17_alias
  );

  FOREACH normalized_expression IN ARRAY ARRAY[
    short_expression, pg17_expression
  ]::text[] LOOP
    normalized_expression := pg_catalog.replace(
      pg_catalog.replace(
        normalized_expression,
        profile_short_alias,
        profile_canonical_alias
      ),
      profile_pg17_alias,
      profile_canonical_alias
    );
    IF normalized_expression IS DISTINCT FROM canonical_expression THEN
      RAISE EXCEPTION 'reviewed profile alias signature was not canonicalized';
    END IF;
  END LOOP;

  mutated_expression := pg_catalog.replace(
    pg17_expression,
    'profile(id,phone,email,',
    'profile(id,email,phone,'
  );
  normalized_expression := pg_catalog.replace(
    pg_catalog.replace(
      mutated_expression,
      profile_short_alias,
      profile_canonical_alias
    ),
    profile_pg17_alias,
    profile_canonical_alias
  );
  IF normalized_expression IS NOT DISTINCT FROM canonical_expression THEN
    RAISE EXCEPTION 'mutated profile alias signature escaped exact detection';
  END IF;
END;
$pg17_alias_signature_detected$;

SAVEPOINT inherited_privilege;
CREATE ROLE plaza_acl_regression_parent NOLOGIN;
GRANT INSERT ON public.post_items TO plaza_acl_regression_parent;
GRANT plaza_acl_regression_parent TO anon;
DO $inherited_privilege_detected$
BEGIN
  IF NOT pg_catalog.has_table_privilege(
    'anon', 'public.post_items', 'INSERT'
  ) THEN
    RAISE EXCEPTION 'inherited privilege adversarial fixture ineffective';
  END IF;
END;
$inherited_privilege_detected$;
ROLLBACK TO SAVEPOINT inherited_privilege;

SAVEPOINT inherited_grant_option;
CREATE ROLE plaza_acl_regression_grant_parent NOLOGIN;
GRANT SELECT (id) ON public.posts
  TO plaza_acl_regression_grant_parent WITH GRANT OPTION;
GRANT plaza_acl_regression_grant_parent TO anon;
DO $inherited_grant_option_detected$
DECLARE
  provenance_mismatch_count integer;
BEGIN
  IF NOT pg_catalog.has_column_privilege(
    'anon', 'public.posts', 'id', 'SELECT WITH GRANT OPTION'
  ) THEN
    RAISE EXCEPTION 'inherited grant-option adversarial fixture ineffective';
  END IF;

  WITH inherited AS (
    SELECT
      member_role.role_name,
      relation.relname AS relation_name,
      acl.privilege_type,
      attribute.attname AS column_name,
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
  INTO provenance_mismatch_count
  FROM inherited
  WHERE role_name = 'anon'
    AND relation_name = 'posts'
    AND privilege_type = 'SELECT'
    AND column_name = 'id'
    AND is_grantable;

  IF provenance_mismatch_count <> 1 THEN
    RAISE EXCEPTION 'inherited grant option escaped ACL provenance detection';
  END IF;
END;
$inherited_grant_option_detected$;
ROLLBACK TO SAVEPOINT inherited_grant_option;

SAVEPOINT inherited_maintain_privilege;
CREATE ROLE plaza_acl_regression_maintainer NOLOGIN;
GRANT plaza_acl_regression_maintainer TO anon;
DO $inherited_maintain_privilege_detected$
DECLARE
  maintain_mismatch_count integer;
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer >= 170000 THEN
    EXECUTE
      'GRANT MAINTAIN ON TABLE public.posts TO plaza_acl_regression_maintainer';
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

    IF maintain_mismatch_count = 0 THEN
      RAISE EXCEPTION 'inherited MAINTAIN adversarial fixture escaped detection';
    END IF;
  END IF;
END;
$inherited_maintain_privilege_detected$;
ROLLBACK TO SAVEPOINT inherited_maintain_privilege;

SAVEPOINT grant_option;
GRANT SELECT (id) ON public.posts TO anon WITH GRANT OPTION;
DO $grant_option_detected$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
    WHERE attribute.attrelid = 'public.posts'::pg_catalog.regclass
      AND attribute.attname = 'id'
      AND acl.grantee = pg_catalog.to_regrole('anon')::oid
      AND acl.privilege_type = 'SELECT'
      AND acl.is_grantable
  ) THEN
    RAISE EXCEPTION 'grant-option adversarial fixture was not detected';
  END IF;
END;
$grant_option_detected$;
ROLLBACK TO SAVEPOINT grant_option;

SAVEPOINT duplicate_grantor;
CREATE ROLE plaza_acl_regression_delegator NOLOGIN;
GRANT USAGE ON SCHEMA public TO plaza_acl_regression_delegator;
GRANT SELECT (id) ON public.posts
  TO plaza_acl_regression_delegator WITH GRANT OPTION;
SET LOCAL ROLE plaza_acl_regression_delegator;
GRANT SELECT (id) ON public.posts TO anon;
RESET ROLE;
DO $duplicate_grantor_detected$
DECLARE
  grantor_count integer;
BEGIN
  SELECT pg_catalog.count(DISTINCT acl.grantor)::integer
  INTO grantor_count
  FROM pg_catalog.pg_attribute AS attribute
  CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
  WHERE attribute.attrelid = 'public.posts'::pg_catalog.regclass
    AND attribute.attname = 'id'
    AND acl.grantee = pg_catalog.to_regrole('anon')::oid
    AND acl.privilege_type = 'SELECT';

  IF grantor_count < 2 THEN
    RAISE EXCEPTION 'duplicate-grantor adversarial fixture was not detected';
  END IF;
END;
$duplicate_grantor_detected$;
ROLLBACK TO SAVEPOINT duplicate_grantor;

ROLLBACK;
