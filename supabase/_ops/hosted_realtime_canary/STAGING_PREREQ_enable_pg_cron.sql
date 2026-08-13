-- STAGING-ONLY prerequisite for the hosted Realtime canary.
--
-- Was `supabase/migrations/20260801082937_enable_pg_cron_for_hosted_realtime_
-- activation.sql`, auto-generated when pg_cron was enabled on the staging
-- project from the Supabase dashboard. Migration history deploys to
-- production, and production neither runs nor needs the canary's TTL job, so
-- this belongs with the rest of the staging-only package instead.
--
-- PostgreSQL does not expose a trusted Supabase project ref. This script
-- therefore binds the operator-supplied ref to the exact database-resident
-- A/B/C metadata, AB/AC relationships, lineage and fixture-manifest digest
-- before DDL. The provider/dashboard connection review remains a separate
-- Gate 0 requirement; this guard cannot replace it.

\set ON_ERROR_STOP on

-- The first database action remains read-only and pins the managed Realtime
-- surface before this prerequisite is allowed to mutate the database.
\ir ../VERIFY_20260719164126_reconcile_managed_realtime_authorization_contract.sql

SELECT (
  :'prerequisite_mode' = 'apply-approved-staging-pg-cron'
) AS prerequisite_apply
\gset

BEGIN;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';
SET LOCAL search_path = pg_catalog;

SELECT
  pg_catalog.set_config(
    'caaci.prerequisite_mode', :'prerequisite_mode', true
  ),
  pg_catalog.set_config(
    'caaci.prerequisite_project_ref', :'project_ref', true
  ),
  pg_catalog.set_config(
    'caaci.prerequisite_dataset_lineage', :'dataset_lineage', true
  ),
  pg_catalog.set_config(
    'caaci.prerequisite_fixture_manifest_sha256',
    :'fixture_manifest_sha256',
    true
  ),
  pg_catalog.set_config(
    'caaci.prerequisite_sentinel_id', :'sentinel_id', true
  ),
  pg_catalog.set_config(
    'caaci.prerequisite_fixture_revision', :'fixture_revision', true
  ),
  pg_catalog.set_config(
    'caaci.prerequisite_actor_a_id', :'actor_a_id', true
  ),
  pg_catalog.set_config(
    'caaci.prerequisite_actor_b_id', :'actor_b_id', true
  ),
  pg_catalog.set_config(
    'caaci.prerequisite_actor_c_id', :'actor_c_id', true
  ),
  pg_catalog.set_config(
    'caaci.prerequisite_conversation_ab_id',
    :'conversation_ab_id',
    true
  ),
  pg_catalog.set_config(
    'caaci.prerequisite_conversation_ac_id',
    :'conversation_ac_id',
    true
  ),
  pg_catalog.set_config(
    'caaci.prerequisite_approval_reference',
    :'approval_reference',
    true
  );

DO $prerequisite_guard$
DECLARE
  v_mode constant text := pg_catalog.current_setting(
    'caaci.prerequisite_mode'
  );
  v_project_ref constant text := lower(pg_catalog.current_setting(
    'caaci.prerequisite_project_ref'
  ));
  v_lineage constant text := lower(pg_catalog.current_setting(
    'caaci.prerequisite_dataset_lineage'
  ));
  v_fixture_manifest constant text := lower(pg_catalog.current_setting(
    'caaci.prerequisite_fixture_manifest_sha256'
  ));
  v_sentinel_id constant uuid := pg_catalog.current_setting(
    'caaci.prerequisite_sentinel_id'
  )::uuid;
  v_fixture_revision constant integer := pg_catalog.current_setting(
    'caaci.prerequisite_fixture_revision'
  )::integer;
  v_actor_a constant uuid := pg_catalog.current_setting(
    'caaci.prerequisite_actor_a_id'
  )::uuid;
  v_actor_b constant uuid := pg_catalog.current_setting(
    'caaci.prerequisite_actor_b_id'
  )::uuid;
  v_actor_c constant uuid := pg_catalog.current_setting(
    'caaci.prerequisite_actor_c_id'
  )::uuid;
  v_conversation_ab constant uuid := pg_catalog.current_setting(
    'caaci.prerequisite_conversation_ab_id'
  )::uuid;
  v_conversation_ac constant uuid := pg_catalog.current_setting(
    'caaci.prerequisite_conversation_ac_id'
  )::uuid;
  v_approval_reference constant text := pg_catalog.current_setting(
    'caaci.prerequisite_approval_reference'
  );
  v_actual_manifest text;
  v_actor uuid;
  v_role text;
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer < 160000
     OR CURRENT_USER <> 'postgres'
     OR SESSION_USER <> 'postgres'
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_roles AS operator
       WHERE operator.rolname = 'postgres'
         AND operator.rolcanlogin
         AND NOT operator.rolsuper
         AND operator.rolcreaterole
     ) THEN
    RAISE EXCEPTION 'staging_prerequisite_operator_boundary_failed'
      USING ERRCODE = '42501';
  END IF;

  IF v_mode = 'local-guard-only' THEN
    IF pg_catalog.current_database()
         <> 'caaci_hosted_realtime_regression'
       OR pg_catalog.inet_server_addr() IS NOT NULL THEN
      RAISE EXCEPTION 'staging_prerequisite_local_mode_refused'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_mode = 'apply-approved-staging-pg-cron' THEN
    IF pg_catalog.current_database() <> 'postgres' THEN
      RAISE EXCEPTION 'staging_prerequisite_target_database_failed'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'staging_prerequisite_mode_invalid'
      USING ERRCODE = '22023';
  END IF;

  IF v_project_ref = 'lfhvgprfphyfvhidegum' THEN
    RAISE EXCEPTION
      'staging_prerequisite_refused_known_production_project'
      USING ERRCODE = '42501';
  END IF;
  IF v_project_ref !~ '^[a-z0-9]{20}$'
     OR v_lineage !~ '^[a-z0-9][a-z0-9._-]{7,79}$'
     OR v_fixture_manifest !~ '^[0-9a-f]{64}$'
     OR v_fixture_revision < 1
     OR v_fixture_revision > 2147483647
     OR pg_catalog.length(v_approval_reference) NOT BETWEEN 8 AND 200
     OR v_approval_reference ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'staging_prerequisite_input_invalid'
      USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.cardinality(ARRAY[
       v_sentinel_id, v_actor_a, v_actor_b, v_actor_c,
       v_conversation_ab, v_conversation_ac
     ]::uuid[]) <> (
       SELECT pg_catalog.count(DISTINCT identity)
       FROM pg_catalog.unnest(ARRAY[
         v_sentinel_id, v_actor_a, v_actor_b, v_actor_c,
         v_conversation_ab, v_conversation_ac
       ]::uuid[]) AS identity
     ) THEN
    RAISE EXCEPTION 'staging_prerequisite_fixture_identity_collision'
      USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.to_regclass('auth.users') IS NULL
     OR pg_catalog.to_regclass('auth.sessions') IS NULL
     OR pg_catalog.to_regclass('auth.identities') IS NULL
     OR pg_catalog.to_regclass('public.profiles') IS NULL
     OR pg_catalog.to_regclass('public.conversations') IS NULL
     OR pg_catalog.to_regprocedure(
       'extensions.digest(bytea,text)'
     ) IS NULL
     OR NOT pg_catalog.has_schema_privilege(
       'postgres', 'auth', 'USAGE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'postgres', 'auth.users', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'postgres', 'auth.sessions', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'postgres', 'auth.identities', 'SELECT'
     )
     OR NOT pg_catalog.has_function_privilege(
       'postgres', 'extensions.digest(bytea,text)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'staging_prerequisite_dependency_missing'
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.concat_ws(
          E'\037',
          'caaci-hosted-fixture-v1',
          v_project_ref,
          v_lineage,
          v_sentinel_id::text,
          v_fixture_revision::text,
          'member-a',
          v_actor_a::text,
          'member-b',
          v_actor_b::text,
          'member-c',
          v_actor_c::text,
          'ab',
          v_conversation_ab::text,
          'ac',
          v_conversation_ac::text
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  INTO STRICT v_actual_manifest;
  IF v_actual_manifest IS DISTINCT FROM v_fixture_manifest THEN
    RAISE EXCEPTION 'staging_prerequisite_fixture_manifest_mismatch'
      USING ERRCODE = '22023';
  END IF;

  FOR v_actor, v_role IN
    SELECT actor_id, expected_role
    FROM (VALUES
      (v_actor_a, 'member-a'::text),
      (v_actor_b, 'member-b'::text),
      (v_actor_c, 'member-c'::text)
    ) AS expected(actor_id, expected_role)
  LOOP
    IF NOT EXISTS (
         SELECT 1
         FROM auth.users AS user_row
         WHERE user_row.id = v_actor
           AND (
             user_row.banned_until IS NULL
             OR user_row.banned_until
                  <= pg_catalog.statement_timestamp()
           )
           AND user_row.raw_app_meta_data->'caaci_hosted_canary'
                 IS NOT DISTINCT FROM 'true'::jsonb
           AND user_row.raw_app_meta_data->>'caaci_dataset_lineage'
                 = v_lineage
           AND user_row.raw_app_meta_data->>'caaci_canary_role'
                 = v_role
           AND lower(user_row.email) ~
             '^[^@[:space:]]+@[^@[:space:]]+\.invalid$'
       )
       OR (
         SELECT pg_catalog.count(*)
         FROM auth.identities AS identity
         WHERE identity.user_id = v_actor
           AND identity.provider = 'email'
       ) <> 1
       OR EXISTS (
         SELECT 1
         FROM auth.identities AS identity
         WHERE identity.user_id = v_actor
           AND identity.provider <> 'email'
       )
       OR EXISTS (
         SELECT 1
         FROM auth.sessions AS session
         WHERE session.user_id = v_actor
       ) THEN
      RAISE EXCEPTION 'staging_prerequisite_actor_boundary_failed'
        USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.profiles AS profile
      WHERE profile.id = v_actor
        AND NOT profile.shadow_banned
        AND profile.suspension_level = 0
        AND profile.suspended_until IS NULL
    ) THEN
      RAISE EXCEPTION 'staging_prerequisite_actor_profile_missing'
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  IF NOT EXISTS (
       SELECT 1
       FROM public.conversations AS conversation
       WHERE conversation.id = v_conversation_ab
         AND ARRAY[
           conversation.buyer_id, conversation.seller_id
         ]::uuid[] @> ARRAY[v_actor_a, v_actor_b]::uuid[]
         AND ARRAY[
           conversation.buyer_id, conversation.seller_id
         ]::uuid[] <@ ARRAY[v_actor_a, v_actor_b]::uuid[]
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.conversations AS conversation
       WHERE conversation.id = v_conversation_ac
         AND ARRAY[
           conversation.buyer_id, conversation.seller_id
         ]::uuid[] @> ARRAY[v_actor_a, v_actor_c]::uuid[]
         AND ARRAY[
           conversation.buyer_id, conversation.seller_id
         ]::uuid[] <@ ARRAY[v_actor_a, v_actor_c]::uuid[]
     )
     OR EXISTS (
       SELECT 1
       FROM public.conversations AS conversation
       WHERE (
         v_actor_a IN (conversation.buyer_id, conversation.seller_id)
         OR v_actor_b IN (conversation.buyer_id, conversation.seller_id)
         OR v_actor_c IN (conversation.buyer_id, conversation.seller_id)
       )
       AND conversation.id NOT IN (
         v_conversation_ab, v_conversation_ac
       )
     ) THEN
    RAISE EXCEPTION 'staging_prerequisite_fixture_relationship_drift'
      USING ERRCODE = '55000';
  END IF;

  IF v_mode = 'apply-approved-staging-pg-cron'
     AND (
       EXISTS (
         SELECT 1
         FROM pg_catalog.pg_extension AS extension
         WHERE extension.extname = 'pg_cron'
       )
       OR pg_catalog.to_regnamespace('cron') IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'staging_prerequisite_pg_cron_already_present'
      USING ERRCODE = '55000';
  END IF;
END
$prerequisite_guard$;

\if :prerequisite_apply
CREATE EXTENSION pg_cron WITH SCHEMA pg_catalog;
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

DO $prerequisite_postcondition$
BEGIN
  IF NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_extension AS extension
       WHERE extension.extname = 'pg_cron'
         AND extension.extnamespace =
           pg_catalog.to_regnamespace('pg_catalog')
     )
     OR pg_catalog.to_regnamespace('cron') IS NULL
     OR pg_catalog.to_regclass('cron.job') IS NULL
     OR pg_catalog.to_regprocedure(
       'cron.schedule(text,text,text)'
     ) IS NULL
     OR pg_catalog.to_regprocedure('cron.unschedule(bigint)') IS NULL
     OR NOT pg_catalog.has_schema_privilege(
       'postgres', 'cron', 'USAGE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'postgres', 'cron.job', 'SELECT'
     ) THEN
    RAISE EXCEPTION 'staging_prerequisite_pg_cron_postcondition_failed'
      USING ERRCODE = '55000';
  END IF;
END
$prerequisite_postcondition$;
COMMIT;
\else
-- This branch exists only for the isolated local regression database. The
-- guard above proves that fact, and rollback guarantees zero mutation.
ROLLBACK;
\endif
