-- Rollback-only local/staging regression for auth.uid() InitPlan caching.
-- Never run this synthetic planner probe in production.

\set ON_ERROR_STOP on

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = public, pg_catalog;

DO $prerequisites$
BEGIN
  IF pg_catalog.to_regprocedure('auth.uid()') IS NULL
     OR pg_catalog.to_regrole('authenticated') IS NULL THEN
    RAISE EXCEPTION 'regression_failed: Supabase auth prerequisite missing';
  END IF;
END
$prerequisites$;

-- The scalar subquery must preserve auth.uid()'s three-valued behavior for
-- matching, non-matching, and unauthenticated request contexts.
DO $semantic_equivalence$
DECLARE
  claim_sub text;
  compared_id uuid;
  raw_equality boolean;
  cached_equality boolean;
  raw_presence boolean;
  cached_presence boolean;
BEGIN
  FOR claim_sub, compared_id IN
    SELECT *
    FROM (VALUES
      ('11111111-1111-4111-8111-111111111111',
       '11111111-1111-4111-8111-111111111111'::uuid),
      ('11111111-1111-4111-8111-111111111111',
       '22222222-2222-4222-8222-222222222222'::uuid),
      ('22222222-2222-4222-8222-222222222222',
       '11111111-1111-4111-8111-111111111111'::uuid)
    ) AS test_case(claim_sub, compared_id)
  LOOP
    PERFORM pg_catalog.set_config('request.jwt.claim.sub', claim_sub, true);

    SELECT
      auth.uid() = compared_id,
      (SELECT auth.uid()) = compared_id,
      auth.uid() IS NOT NULL,
      (SELECT auth.uid()) IS NOT NULL
    INTO
      raw_equality, cached_equality, raw_presence, cached_presence;

    IF raw_equality IS DISTINCT FROM cached_equality
       OR raw_presence IS DISTINCT FROM cached_presence THEN
      RAISE EXCEPTION
        'regression_failed: cached auth.uid() changed authenticated semantics';
    END IF;
  END LOOP;

  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '', true);
  SELECT
    auth.uid() = '11111111-1111-4111-8111-111111111111'::uuid,
    (SELECT auth.uid()) = '11111111-1111-4111-8111-111111111111'::uuid,
    auth.uid() IS NOT NULL,
    (SELECT auth.uid()) IS NOT NULL
  INTO
    raw_equality, cached_equality, raw_presence, cached_presence;

  IF raw_equality IS DISTINCT FROM cached_equality
     OR raw_presence IS DISTINCT FROM cached_presence
     OR raw_equality IS NOT NULL
     OR raw_presence THEN
    RAISE EXCEPTION
      'regression_failed: cached auth.uid() changed unauthenticated semantics';
  END IF;
END
$semantic_equivalence$;

-- An isolated policy proves that PostgreSQL emits an InitPlan for the exact
-- scalar-subquery shape used by the migration. The authenticated role avoids
-- owner/superuser RLS bypass during EXPLAIN.
CREATE TEMPORARY TABLE auth_rls_initplan_probe (
  owner_id uuid NOT NULL
) ON COMMIT DROP;

ALTER TABLE pg_temp.auth_rls_initplan_probe ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_rls_initplan_probe_select
  ON pg_temp.auth_rls_initplan_probe
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = owner_id);

GRANT SELECT ON TABLE pg_temp.auth_rls_initplan_probe TO authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);

SET LOCAL ROLE authenticated;
DO $planner_probe$
DECLARE
  plan json;
BEGIN
  EXECUTE
    'EXPLAIN (FORMAT JSON, COSTS OFF) '
    'SELECT owner_id FROM pg_temp.auth_rls_initplan_probe'
    INTO plan;

  IF pg_catalog.strpos(plan::text, 'InitPlan') = 0 THEN
    RAISE EXCEPTION
      'regression_failed: wrapped auth.uid() did not produce an InitPlan';
  END IF;
END
$planner_probe$;
RESET ROLE;

-- The deployed inventory must retain every role/command boundary and wrap all
-- 39 row-independent calls across the exact 31 policies.
DO $deployed_inventory$
DECLARE
  policy_count integer;
  table_count integer;
  public_policy_count integer;
  authenticated_policy_count integer;
  uid_call_count bigint;
  initplan_call_count bigint;
  mismatch_count integer;
BEGIN
  WITH expected(
    table_name, policy_name, command, role_names,
    using_uid_calls, check_uid_calls
  ) AS (
    VALUES
      ('device_fingerprints', 'dfp_self_read', 'r', ARRAY['PUBLIC']::text[], 1, 0),
      ('favorites', 'Users can add favorites', 'a', ARRAY['PUBLIC']::text[], 0, 1),
      ('favorites', 'Users can remove favorites', 'd', ARRAY['PUBLIC']::text[], 1, 0),
      ('favorites', 'Users can view own favorites', 'r', ARRAY['PUBLIC']::text[], 1, 0),
      ('follows', 'Users can follow', 'a', ARRAY['PUBLIC']::text[], 0, 1),
      ('follows', 'Users can unfollow', 'd', ARRAY['PUBLIC']::text[], 1, 0),
      ('items', 'Authenticated users can create items', 'a', ARRAY['PUBLIC']::text[], 0, 1),
      ('items', 'Users can delete own items', 'd', ARRAY['PUBLIC']::text[], 1, 0),
      ('items', 'Users can update own items', 'w', ARRAY['PUBLIC']::text[], 1, 1),
      ('notifications', 'Users delete own notifications', 'd', ARRAY['PUBLIC']::text[], 1, 0),
      ('notifications', 'Users read own notifications', 'r', ARRAY['PUBLIC']::text[], 1, 0),
      ('notifications', 'Users update own notifications', 'w', ARRAY['PUBLIC']::text[], 1, 1),
      ('post_comment_likes', 'Users can like comments', 'a', ARRAY['PUBLIC']::text[], 0, 1),
      ('post_comment_likes', 'Users can unlike comments', 'd', ARRAY['PUBLIC']::text[], 1, 0),
      ('post_comments', 'Authenticated users can comment', 'a', ARRAY['PUBLIC']::text[], 0, 1),
      ('post_comments', 'Users can delete own comments', 'd', ARRAY['PUBLIC']::text[], 1, 0),
      ('post_comments', 'Users can update own comments', 'w', ARRAY['PUBLIC']::text[], 1, 1),
      ('post_items', 'Post owner can attach own items', 'a', ARRAY['authenticated']::text[], 0, 3),
      ('post_items', 'Post owner can detach items', 'd', ARRAY['authenticated']::text[], 2, 0),
      ('post_likes', 'Users can like', 'a', ARRAY['PUBLIC']::text[], 0, 1),
      ('post_likes', 'Users can unlike', 'd', ARRAY['PUBLIC']::text[], 1, 0),
      ('posts', 'Authenticated users can create posts', 'a', ARRAY['authenticated']::text[], 0, 1),
      ('posts', 'Users can delete own posts', 'd', ARRAY['authenticated']::text[], 1, 0),
      ('posts', 'Users can update own posts', 'w', ARRAY['authenticated']::text[], 1, 1),
      ('profiles', 'Users can update own profile', 'w', ARRAY['PUBLIC']::text[], 1, 1),
      ('reports', 'Users can create reports', 'a', ARRAY['PUBLIC']::text[], 0, 1),
      ('reports', 'Users can view own reports', 'r', ARRAY['PUBLIC']::text[], 1, 0),
      ('saved_searches', 'Users create own saved searches', 'a', ARRAY['PUBLIC']::text[], 0, 1),
      ('saved_searches', 'Users delete own saved searches', 'd', ARRAY['PUBLIC']::text[], 1, 0),
      ('saved_searches', 'Users read own saved searches', 'r', ARRAY['PUBLIC']::text[], 1, 0),
      ('suspensions', 'suspensions_self_read', 'r', ARRAY['PUBLIC']::text[], 1, 0)
  ), actual AS (
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
      )), '') AS using_expression,
      COALESCE(pg_catalog.lower(pg_catalog.regexp_replace(
        pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid),
        '[[:space:]]+', '', 'g'
      )), '') AS check_expression
    FROM expected
    JOIN pg_catalog.pg_class AS relation
      ON relation.oid = pg_catalog.to_regclass(
        'public.' || expected.table_name
      )
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
      actual.*,
      (
        pg_catalog.length(actual.using_expression)
        - pg_catalog.length(pg_catalog.replace(
            actual.using_expression, 'auth.uid()', ''
          ))
      ) / pg_catalog.length('auth.uid()') AS using_uid_calls,
      (
        pg_catalog.length(actual.check_expression)
        - pg_catalog.length(pg_catalog.replace(
            actual.check_expression, 'auth.uid()', ''
          ))
      ) / pg_catalog.length('auth.uid()') AS check_uid_calls,
      (
        pg_catalog.length(actual.using_expression)
        - pg_catalog.length(pg_catalog.replace(
            actual.using_expression, 'selectauth.uid()', ''
          ))
      ) / pg_catalog.length('selectauth.uid()') AS using_initplans,
      (
        pg_catalog.length(actual.check_expression)
        - pg_catalog.length(pg_catalog.replace(
            actual.check_expression, 'selectauth.uid()', ''
          ))
      ) / pg_catalog.length('selectauth.uid()') AS check_initplans
    FROM actual
  )
  SELECT
    pg_catalog.count(*)::integer,
    pg_catalog.count(DISTINCT measured.table_name)::integer,
    pg_catalog.count(*) FILTER (
      WHERE measured.role_names = ARRAY['PUBLIC']::text[]
    )::integer,
    pg_catalog.count(*) FILTER (
      WHERE measured.role_names = ARRAY['authenticated']::text[]
    )::integer,
    pg_catalog.sum(measured.using_uid_calls + measured.check_uid_calls),
    pg_catalog.sum(measured.using_initplans + measured.check_initplans),
    pg_catalog.count(*) FILTER (
      WHERE NOT measured.polpermissive
         OR NOT measured.relrowsecurity
         OR measured.command IS DISTINCT FROM expected.command
         OR measured.role_names IS DISTINCT FROM expected.role_names
         OR measured.using_uid_calls IS DISTINCT FROM expected.using_uid_calls
         OR measured.check_uid_calls IS DISTINCT FROM expected.check_uid_calls
         OR measured.using_initplans IS DISTINCT FROM expected.using_uid_calls
         OR measured.check_initplans IS DISTINCT FROM expected.check_uid_calls
    )::integer
  INTO
    policy_count, table_count, public_policy_count,
    authenticated_policy_count, uid_call_count, initplan_call_count,
    mismatch_count
  FROM expected
  LEFT JOIN measured USING (table_name, policy_name);

  IF policy_count <> 31
     OR table_count <> 14
     OR public_policy_count <> 26
     OR authenticated_policy_count <> 5
     OR uid_call_count <> 39
     OR initplan_call_count <> 39
     OR mismatch_count <> 0 THEN
    RAISE EXCEPTION
      'regression_failed: deployed policy inventory or InitPlan shape drifted';
  END IF;
END
$deployed_inventory$;

ROLLBACK;
