\set ON_ERROR_STOP on

-- Fresh disposable local PostgreSQL cluster only. The runner applies
-- LOCAL_BOOTSTRAP.sql first, removes the temporary supabase_admin membership,
-- then invokes this lifecycle regression as the ordinary hosted operator.

\set project_ref abcdefghijklmnopqrst
\set dataset_lineage local-fixture-v1
\set sentinel_id 66666666-6666-4666-8666-666666666666
\set fixture_revision 1
\set actor_a_id aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1
\set actor_b_id bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2
\set actor_c_id cccccccc-cccc-4ccc-8ccc-ccccccccccc3
\set conversation_ab_id 44444444-4444-4444-8444-444444444444
\set conversation_ac_id 55555555-5555-4555-8555-555555555555
\set provider_disable_proof_sha256 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
\set max_access_token_lifetime_seconds 300
\set approval_reference local-regression-only

SELECT
  pg_catalog.set_config('caaci.local_actor_a_id', :'actor_a_id', false),
  pg_catalog.set_config('caaci.local_actor_b_id', :'actor_b_id', false),
  pg_catalog.set_config('caaci.local_actor_c_id', :'actor_c_id', false),
  pg_catalog.set_config(
    'caaci.local_conversation_ab_id', :'conversation_ab_id', false
  ),
  pg_catalog.set_config(
    'caaci.local_conversation_ac_id', :'conversation_ac_id', false
  );

SELECT (
  pg_catalog.statement_timestamp() + interval '2 hours'
)::text AS provider_proof_expires_at
\gset

SELECT pg_catalog.encode(
  extensions.digest(
    pg_catalog.convert_to(
      pg_catalog.concat_ws(
        E'\037',
        'caaci-hosted-fixture-v1',
        :'project_ref',
        :'dataset_lineage',
        :'sentinel_id',
        :'fixture_revision',
        'member-a',
        :'actor_a_id',
        'member-b',
        :'actor_b_id',
        'member-c',
        :'actor_c_id',
        'ab',
        :'conversation_ab_id',
        'ac',
        :'conversation_ac_id'
      ),
      'UTF8'
    ),
    'sha256'
  ),
  'hex'
) AS fixture_manifest_sha256
\gset

DO $assert_hosted_auth_owner_boundary$
BEGIN
  IF (
       SELECT owner.rolname
       FROM pg_catalog.pg_namespace AS namespace
       JOIN pg_catalog.pg_roles AS owner ON owner.oid = namespace.nspowner
       WHERE namespace.nspname = 'auth'
     ) <> 'supabase_admin'
     OR pg_catalog.pg_has_role('postgres', 'supabase_admin', 'MEMBER')
     OR pg_catalog.pg_has_role('postgres', 'supabase_admin', 'SET')
     OR NOT pg_catalog.has_schema_privilege('postgres', 'auth', 'USAGE')
     OR pg_catalog.has_schema_privilege(
       'postgres', 'auth', 'USAGE WITH GRANT OPTION'
     )
     OR pg_catalog.has_schema_privilege('postgres', 'auth', 'CREATE')
     OR EXISTS (
       SELECT 1
       FROM (VALUES ('users'), ('sessions'), ('identities'))
         AS managed(relation_name)
       JOIN pg_catalog.pg_namespace AS namespace
         ON namespace.nspname = 'auth'
       JOIN pg_catalog.pg_class AS relation
         ON relation.relnamespace = namespace.oid
        AND relation.relname = managed.relation_name
       WHERE NOT pg_catalog.has_table_privilege(
         'postgres', relation.oid, 'SELECT'
       )
          OR pg_catalog.has_table_privilege(
            'postgres', relation.oid, 'SELECT WITH GRANT OPTION'
          )
     ) THEN
    RAISE EXCEPTION 'local_hosted_auth_owner_boundary_failed';
  END IF;
END
$assert_hosted_auth_owner_boundary$;

-- Exercise the managed Broadcast/Presence policies behaviorally with the same
-- JSON claim shape consumed by this disposable fixture. A may join AB; C may
-- not use AB even though C is a valid fixture actor in AC. The disposable
-- bootstrap does not reproduce the application's full public policy catalog,
-- so add only the participant read dependency needed by the managed policy
-- and remove it again before activation.
CREATE POLICY local_managed_realtime_conversation_read
  ON public.conversations
  FOR SELECT
  TO authenticated
  USING (
    (SELECT auth.uid()) IN (buyer_id, seller_id)
  );

BEGIN;
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object('sub', :'actor_a_id')::text,
  true
);
SELECT pg_catalog.set_config(
  'realtime.topic',
  'conversation:' || :'conversation_ab_id',
  true
);
SET LOCAL ROLE authenticated;
INSERT INTO realtime.messages (topic, extension, event, private)
VALUES (
  'conversation:' || :'conversation_ab_id',
  'broadcast',
  'local-member-positive',
  true
);
DO $expect_member_realtime_visible$
BEGIN
  IF (
    SELECT pg_catalog.count(*)
    FROM realtime.messages AS message
    WHERE message.event = 'local-member-positive'
  ) <> 1 THEN
    RAISE EXCEPTION 'local_member_realtime_row_not_visible';
  END IF;
END
$expect_member_realtime_visible$;
ROLLBACK;

BEGIN;
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object('sub', :'actor_c_id')::text,
  true
);
SELECT pg_catalog.set_config(
  'realtime.topic',
  'conversation:' || :'conversation_ab_id',
  true
);
SET LOCAL ROLE authenticated;
DO $expect_nonmember_realtime_denied$
BEGIN
  BEGIN
    INSERT INTO realtime.messages (topic, extension, event, private)
    VALUES (
      pg_catalog.current_setting('realtime.topic'),
      'presence',
      'local-nonmember-negative',
      true
    );
    RAISE EXCEPTION 'local_nonmember_realtime_insert_was_not_denied';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$expect_nonmember_realtime_denied$;
ROLLBACK;

DROP POLICY local_managed_realtime_conversation_read
  ON public.conversations;

-- Exercise ACTIVATE with equivalent upper-case UUID text. The installed config
-- stores UUID values, while the helper binding must hash their canonical text.
\set actor_a_id AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAA1
\set actor_b_id BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBB2
\set actor_c_id CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCC3
\ir ACTIVATE.sql
\set actor_a_id aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1
\set actor_b_id bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2
\set actor_c_id cccccccc-cccc-4ccc-8ccc-ccccccccccc3
DO $assert_auth_helper_boundary$
BEGIN
  IF pg_catalog.has_schema_privilege(
       'caaci_hosted_realtime_executor', 'auth', 'USAGE'
     )
     OR EXISTS (
       SELECT 1
       FROM (VALUES ('auth.users'), ('auth.sessions'), ('auth.identities'))
         AS managed(relation_name)
       JOIN pg_catalog.pg_namespace namespace
         ON namespace.nspname = pg_catalog.split_part(managed.relation_name, '.', 1)
       JOIN pg_catalog.pg_class relation
         ON relation.relnamespace = namespace.oid
        AND relation.relname = pg_catalog.split_part(managed.relation_name, '.', 2)
       CROSS JOIN LATERAL (
         SELECT DISTINCT acl.privilege_type AS privilege_name
         FROM pg_catalog.aclexplode(
           pg_catalog.acldefault('r', relation.relowner)
         ) AS acl
       ) AS privilege
       WHERE pg_catalog.has_table_privilege(
         'caaci_hosted_realtime_executor',
         relation.oid,
         privilege.privilege_name
       )
     )
     OR EXISTS (
       SELECT 1
       FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
         AS api(role_name)
       CROSS JOIN (VALUES
         ('private.hosted_realtime_canary_auth_context(text,text)'),
         ('private.hosted_realtime_canary_fixture_session_count(uuid,uuid,uuid,text)')
       ) AS helper(signature)
       WHERE pg_catalog.has_function_privilege(
         api.role_name, helper.signature, 'EXECUTE'
       )
     )
     OR NOT pg_catalog.has_function_privilege(
       'caaci_hosted_realtime_executor',
       'private.hosted_realtime_canary_auth_context(text,text)',
       'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'caaci_hosted_realtime_executor',
       'private.hosted_realtime_canary_fixture_session_count(uuid,uuid,uuid,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'local_auth_helper_boundary_failed';
  END IF;
END
$assert_auth_helper_boundary$;
SET ROLE caaci_hosted_realtime_executor;
DO $expect_direct_auth_denied$
BEGIN
  BEGIN
    PERFORM auth.uid();
    RAISE EXCEPTION 'local_direct_auth_function_was_not_denied';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM auth.sessions LIMIT 1;
    RAISE EXCEPTION 'local_direct_auth_table_was_not_denied';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$expect_direct_auth_denied$;
DO $expect_invalid_fixture_set_denied$
BEGIN
  BEGIN
    PERFORM private.hosted_realtime_canary_fixture_session_count(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,
      'cccccccc-cccc-4ccc-8ccc-ccccccccccc3'::uuid,
      'local-fixture-v1'
    );
    RAISE EXCEPTION 'local_duplicate_fixture_set_was_not_denied';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'hosted_realtime_canary_fixture_actor_invalid' THEN
      RAISE;
    END IF;
  END;
  BEGIN
    PERFORM private.hosted_realtime_canary_fixture_session_count(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid,
      'local-fixture-v1'
    );
    RAISE EXCEPTION 'local_unbound_fixture_set_was_not_denied';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'hosted_realtime_canary_fixture_actor_invalid' THEN
      RAISE;
    END IF;
  END;
END
$expect_invalid_fixture_set_denied$;
RESET ROLE;
SELECT private.hosted_realtime_canary_ttl_cleanup();
\ir VERIFY.sql

-- The hosted operator already inherits pg_read_all_data in this regression.
-- An additional package ACL therefore does not change its effective SELECT
-- result, but it must still be rejected as package-owned privilege leakage.
DO $assert_trusted_operator_read_baseline$
BEGIN
  IF NOT pg_catalog.has_table_privilege(
    'postgres',
    'private.hosted_realtime_canary_environment_config',
    'SELECT'
  ) THEN
    RAISE EXCEPTION 'local_trusted_operator_read_baseline_missing';
  END IF;
END
$assert_trusted_operator_read_baseline$;

BEGIN;
SET LOCAL ROLE caaci_hosted_realtime_executor;
GRANT SELECT ON TABLE
  private.hosted_realtime_canary_environment_config
TO postgres;
RESET ROLE;
\set expected_verify_failure_message verify_private_table_acl_provenance_failed
\ir LOCAL_EXPECT_VERIFY_FAILURE.sql
\ir VERIFY.sql

BEGIN;
SET LOCAL ROLE caaci_hosted_realtime_executor;
GRANT SELECT (provider_disable_proof_sha256) ON TABLE
  private.hosted_realtime_canary_environment_config
TO postgres;
RESET ROLE;
\set expected_verify_failure_message verify_private_table_acl_provenance_failed
\ir LOCAL_EXPECT_VERIFY_FAILURE.sql
\ir VERIFY.sql

BEGIN;
SET LOCAL ROLE caaci_hosted_realtime_executor;
GRANT SELECT (provider_disable_proof_sha256) ON TABLE
  private.hosted_realtime_canary_environment_config
TO authenticated;
RESET ROLE;
\set expected_verify_failure_message verify_private_table_acl_provenance_failed
\ir LOCAL_EXPECT_VERIFY_FAILURE.sql
\ir VERIFY.sql

SELECT (
  pg_catalog.current_setting('server_version_num')::integer >= 170000
) AS local_pg17
\gset
\if :local_pg17
  BEGIN;
  GRANT pg_maintain TO authenticated
    WITH INHERIT TRUE, SET TRUE;
  \set expected_verify_failure_message verify_private_api_acl_failed
  \ir LOCAL_EXPECT_VERIFY_FAILURE.sql
  \ir VERIFY.sql
\endif

-- The V2 executor's public-table ACL is an exact allow-list. Prove that a
-- single extra column grant is detected, including the verifier's complete
-- drift payload, and that the surrounding transaction restores the catalog.
BEGIN;
GRANT UPDATE (title) ON TABLE public.notifications
  TO caaci_hosted_realtime_executor;
SELECT
  'verify_executor_public_acl_surface_failed: ' ||
  pg_catalog.array_agg(entry ORDER BY entry)::text
    AS expected_verify_failure_message
FROM (
  SELECT
    namespace.nspname || '.' || relation.relname || '.TABLE.' ||
    acl.privilege_type || '.' || acl.is_grantable::text AS entry
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl) AS acl
  WHERE namespace.nspname = 'public'
    AND acl.grantee =
      pg_catalog.to_regrole('caaci_hosted_realtime_executor')
  UNION ALL
  SELECT
    namespace.nspname || '.' || relation.relname || '.' ||
    attribute.attname || '.' || acl.privilege_type || '.' ||
    acl.is_grantable::text AS entry
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  JOIN pg_catalog.pg_attribute AS attribute
    ON attribute.attrelid = relation.oid
   AND attribute.attnum > 0
   AND NOT attribute.attisdropped
  CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
  WHERE namespace.nspname = 'public'
    AND acl.grantee =
      pg_catalog.to_regrole('caaci_hosted_realtime_executor')
) AS drifted_acl
\gset
\ir LOCAL_EXPECT_VERIFY_FAILURE.sql
\ir VERIFY.sql

-- A service-role grant on any authenticated-only V2 RPC must fail the exact
-- function ACL surface before it can become an alternate write path.
BEGIN;
SET LOCAL ROLE caaci_hosted_realtime_executor;
GRANT EXECUTE ON FUNCTION
  public.hosted_realtime_canary_cleanup_v2(uuid, uuid[], uuid[])
TO service_role;
RESET ROLE;
\set expected_verify_failure_message verify_function_acl_surface_failed
\ir LOCAL_EXPECT_VERIFY_FAILURE.sql
\ir VERIFY.sql

-- The policy inventory is exact as well: a permissive-looking extra policy is
-- still rejected even though this local fixture makes its predicate false.
BEGIN;
CREATE POLICY hosted_realtime_canary_local_extra
  ON public.blocks
  FOR SELECT
  TO caaci_hosted_realtime_executor
  USING (false);
SELECT
  'verify_policy_surface_failed: ' ||
  pg_catalog.array_agg(
    policy.schemaname || '.' || policy.tablename || '.' || policy.policyname
    ORDER BY policy.schemaname, policy.tablename, policy.policyname
  )::text AS expected_verify_failure_message
FROM pg_catalog.pg_policies AS policy
WHERE policy.policyname LIKE 'hosted_realtime_canary_%'
\gset
\ir LOCAL_EXPECT_VERIFY_FAILURE.sql
\ir VERIFY.sql

SELECT auth.local_canary_set_session(
  '77777777-7777-4777-8777-777777777777',
  :'actor_a_id'::uuid,
  true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', :'actor_a_id',
    'aud', 'authenticated',
    'iss', 'https://' || :'project_ref' || '.supabase.co/auth/v1',
    'exp', extract(
      epoch FROM pg_catalog.statement_timestamp() + interval '15 minutes'
    )::bigint,
    'session_id', '77777777-7777-4777-8777-777777777777',
    'app_metadata', pg_catalog.jsonb_build_object(
      'caaci_hosted_canary', true,
      'caaci_dataset_lineage', :'dataset_lineage',
      'caaci_canary_role', 'member-a'
    )
  )::text,
  false
);

SET ROLE authenticated;
SELECT * FROM public.hosted_realtime_canary_begin_run(
  '88888888-8888-4888-8888-888888888888'
);
DO $expect_second_begin_denied$
BEGIN
  BEGIN
    PERFORM *
    FROM public.hosted_realtime_canary_begin_run(
      '88888888-8888-4888-8888-888888888887'
    );
    RAISE EXCEPTION 'local_second_begin_was_not_denied';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF SQLERRM <> 'hosted_realtime_canary_begin_denied' THEN
      RAISE;
    END IF;
  END;
END
$expect_second_begin_denied$;
DO $expect_wrong_run_insert_denied$
BEGIN
  BEGIN
    PERFORM *
    FROM public.hosted_realtime_canary_insert_message(
      '88888888-8888-4888-8888-888888888887',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      '44444444-4444-4444-8444-444444444444',
      'caaci-hosted-canary-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    );
    RAISE EXCEPTION 'local_wrong_run_insert_was_not_denied';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF SQLERRM <> 'hosted_realtime_canary_insert_denied' THEN
      RAISE;
    END IF;
  END;
END
$expect_wrong_run_insert_denied$;
DO $expect_wrong_conversation_denied$
BEGIN
  BEGIN
    PERFORM *
    FROM public.hosted_realtime_canary_insert_message(
      '88888888-8888-4888-8888-888888888888',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      'caaci-hosted-canary-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    );
    RAISE EXCEPTION 'local_wrong_conversation_was_not_denied';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF SQLERRM <> 'hosted_realtime_canary_actor_conversation_denied' THEN
      RAISE;
    END IF;
  END;
END
$expect_wrong_conversation_denied$;
SELECT * FROM public.hosted_realtime_canary_insert_message(
  '88888888-8888-4888-8888-888888888888',
  '99999999-9999-4999-8999-999999999998',
  :'conversation_ab_id'::uuid,
  'caaci-hosted-canary-99999999-9999-4999-8999-999999999998'
);
SELECT * FROM public.hosted_realtime_canary_insert_message(
  '88888888-8888-4888-8888-888888888888',
  '99999999-9999-4999-8999-999999999999',
  :'conversation_ab_id'::uuid,
  'caaci-hosted-canary-99999999-9999-4999-8999-999999999999'
);
RESET ROLE;

SELECT auth.local_canary_set_session(
    '77777777-7777-4777-8777-777777777778',
    :'actor_b_id'::uuid,
    true
  );
SELECT auth.local_canary_set_session(
    '77777777-7777-4777-8777-777777777779',
    :'actor_c_id'::uuid,
    true
  );
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', :'actor_b_id',
    'aud', 'authenticated',
    'iss', 'https://' || :'project_ref' || '.supabase.co/auth/v1',
    'exp', extract(
      epoch FROM pg_catalog.statement_timestamp() + interval '15 minutes'
    )::bigint,
    'session_id', '77777777-7777-4777-8777-777777777778',
    'app_metadata', pg_catalog.jsonb_build_object(
      'caaci_hosted_canary', true,
      'caaci_dataset_lineage', :'dataset_lineage',
      'caaci_canary_role', 'member-b'
    )
  )::text,
  false
);
SET ROLE authenticated;
DO $expect_b_write_denied$
BEGIN
  BEGIN
    PERFORM *
    FROM public.hosted_realtime_canary_insert_message(
      '88888888-8888-4888-8888-888888888888',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      '44444444-4444-4444-8444-444444444444',
      'caaci-hosted-canary-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    );
    RAISE EXCEPTION 'local_b_write_was_not_denied';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF SQLERRM <> 'hosted_realtime_canary_actor_conversation_denied' THEN
      RAISE;
    END IF;
  END;
END
$expect_b_write_denied$;
RESET ROLE;

SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', :'actor_c_id',
    'aud', 'authenticated',
    'iss', 'https://' || :'project_ref' || '.supabase.co/auth/v1',
    'exp', extract(
      epoch FROM pg_catalog.statement_timestamp() + interval '15 minutes'
    )::bigint,
    'session_id', '77777777-7777-4777-8777-777777777779',
    'app_metadata', pg_catalog.jsonb_build_object(
      'caaci_hosted_canary', true,
      'caaci_dataset_lineage', :'dataset_lineage',
      'caaci_canary_role', 'member-c'
    )
  )::text,
  false
);
SET ROLE authenticated;
SELECT * FROM public.hosted_realtime_canary_insert_message(
  '88888888-8888-4888-8888-888888888888',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  :'conversation_ac_id'::uuid,
  'caaci-hosted-canary-dddddddd-dddd-4ddd-8ddd-dddddddddddd'
);
RESET ROLE;

SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', :'actor_a_id',
    'aud', 'authenticated',
    'iss', 'https://' || :'project_ref' || '.supabase.co/auth/v1',
    'exp', extract(
      epoch FROM pg_catalog.statement_timestamp() + interval '15 minutes'
    )::bigint,
    'session_id', '77777777-7777-4777-8777-777777777777',
    'app_metadata', pg_catalog.jsonb_build_object(
      'caaci_hosted_canary', true,
      'caaci_dataset_lineage', :'dataset_lineage',
      'caaci_canary_role', 'member-a'
    )
  )::text,
  false
);
SET ROLE authenticated;
DO $expect_subset_cleanup_denied$
BEGIN
  BEGIN
    PERFORM *
    FROM public.hosted_realtime_canary_cleanup(
      '88888888-8888-4888-8888-888888888888',
      ARRAY['99999999-9999-4999-8999-999999999998'::uuid]
    );
    RAISE EXCEPTION 'local_subset_cleanup_was_not_denied';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF SQLERRM <> 'hosted_realtime_canary_cleanup_denied' THEN
      RAISE;
    END IF;
  END;
END
$expect_subset_cleanup_denied$;
DO $expect_unsorted_cleanup_denied$
BEGIN
  BEGIN
    PERFORM *
    FROM public.hosted_realtime_canary_cleanup(
      '88888888-8888-4888-8888-888888888888',
      ARRAY[
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid,
        '99999999-9999-4999-8999-999999999998'::uuid,
        '99999999-9999-4999-8999-999999999999'::uuid
      ]
    );
    RAISE EXCEPTION 'local_unsorted_cleanup_was_not_denied';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF SQLERRM <> 'hosted_realtime_canary_cleanup_denied' THEN
      RAISE;
    END IF;
  END;
END
$expect_unsorted_cleanup_denied$;
DO $normal_cleanup$
DECLARE
  v_result record;
BEGIN
  SELECT * INTO STRICT v_result
  FROM public.hosted_realtime_canary_cleanup(
    '88888888-8888-4888-8888-888888888888',
    ARRAY[
      '99999999-9999-4999-8999-999999999998'::uuid,
      '99999999-9999-4999-8999-999999999999'::uuid,
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid
    ]
  );
  IF v_result.deleted_count <> 3 OR v_result.residue_count <> 0 THEN
    RAISE EXCEPTION 'local_normal_cleanup_assertion_failed';
  END IF;
END
$normal_cleanup$;
DO $expect_closed_admission_insert_denied$
BEGIN
  BEGIN
    PERFORM *
    FROM public.hosted_realtime_canary_insert_message(
      '88888888-8888-4888-8888-888888888888',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      '44444444-4444-4444-8444-444444444444',
      'caaci-hosted-canary-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    );
    RAISE EXCEPTION 'local_closed_admission_insert_was_not_denied';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF SQLERRM <> 'hosted_realtime_canary_insert_denied' THEN
      RAISE;
    END IF;
  END;
END
$expect_closed_admission_insert_denied$;
RESET ROLE;

-- These DELETEs represent the ordinary Auth API revokes performed by the
-- local harness. Activation/recovery SQL itself never writes managed Auth.
SELECT auth.local_canary_set_session(
  '77777777-7777-4777-8777-777777777777',
  :'actor_a_id'::uuid,
  false
);
SELECT auth.local_canary_set_session(
  '77777777-7777-4777-8777-777777777778',
  :'actor_b_id'::uuid,
  false
);
SELECT auth.local_canary_set_session(
  '77777777-7777-4777-8777-777777777779',
  :'actor_c_id'::uuid,
  false
);
\ir VERIFY.sql
\ir ROLLBACK.sql

-- Protocol revision 2: retain the exact base-eight route, then add one atomic
-- 51-row AB scale batch, one already-emailed system notification and exactly
-- one block->unblock transition in each direction before cleanup_v2.
SELECT (
  pg_catalog.statement_timestamp() + interval '2 hours'
)::text AS provider_proof_expires_at
\gset
\ir ACTIVATE.sql
SELECT private.hosted_realtime_canary_ttl_cleanup();

SELECT auth.local_canary_set_session(
  '70000000-0000-4000-8000-000000000001',
  :'actor_a_id'::uuid,
  true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', :'actor_a_id',
    'aud', 'authenticated',
    'iss', 'https://' || :'project_ref' || '.supabase.co/auth/v1',
    'exp', extract(
      epoch FROM pg_catalog.statement_timestamp() + interval '15 minutes'
    )::bigint,
    'session_id', '70000000-0000-4000-8000-000000000001',
    'app_metadata', pg_catalog.jsonb_build_object(
      'caaci_hosted_canary', true,
      'caaci_dataset_lineage', :'dataset_lineage',
      'caaci_canary_role', 'member-a'
    )
  )::text,
  false
);
SET ROLE authenticated;
SELECT * FROM public.hosted_realtime_canary_begin_run(
  '80000000-0000-4000-8000-000000000001'
);

-- A finally block can safely close a run even when failure happens before the
-- first write. Roll the proof back so the same run can continue to full V2.
BEGIN;
DO $cleanup_v2_before_first_write$
DECLARE
  v_result record;
BEGIN
  SELECT * INTO STRICT v_result
  FROM public.hosted_realtime_canary_cleanup_v2(
    '80000000-0000-4000-8000-000000000001',
    '{}'::uuid[],
    '{}'::uuid[]
  );
  IF v_result.deleted_messages <> 0
     OR v_result.deleted_notifications <> 0
     OR v_result.restored_blocks <> 0
     OR v_result.residue_count <> 0 THEN
    RAISE EXCEPTION 'local_cleanup_v2_empty_run_failed';
  END IF;
END
$cleanup_v2_before_first_write$;
ROLLBACK;

-- A->AB five and A->AC two remain independent calls and retain their strict
-- historical quota path.
SELECT pg_catalog.format(
  $sql$SELECT * FROM public.hosted_realtime_canary_insert_message(
    '80000000-0000-4000-8000-000000000001'::uuid,
    %L::uuid,
    %L::uuid,
    %L
  );$sql$,
  pg_catalog.format(
    '10000000-0000-4000-8000-%s',
    pg_catalog.lpad(ordinal::text, 12, '0')
  ),
  :'conversation_ab_id',
  'caaci-hosted-canary-' || pg_catalog.format(
    '10000000-0000-4000-8000-%s',
    pg_catalog.lpad(ordinal::text, 12, '0')
  )
)
FROM pg_catalog.generate_series(1, 5) AS ordinal
ORDER BY ordinal
\gexec
SELECT pg_catalog.format(
  $sql$SELECT * FROM public.hosted_realtime_canary_insert_message(
    '80000000-0000-4000-8000-000000000001'::uuid,
    %L::uuid,
    %L::uuid,
    %L
  );$sql$,
  pg_catalog.format(
    '10000000-0000-4000-8000-%s',
    pg_catalog.lpad(ordinal::text, 12, '0')
  ),
  :'conversation_ac_id',
  'caaci-hosted-canary-' || pg_catalog.format(
    '10000000-0000-4000-8000-%s',
    pg_catalog.lpad(ordinal::text, 12, '0')
  )
)
FROM pg_catalog.generate_series(6, 7) AS ordinal
ORDER BY ordinal
\gexec

-- Supplied IDs may be a bounded response-unknown superset, but every ledger
-- ID must be present and an unledgered ID must not exist in the source table.
BEGIN;
DO $cleanup_v2_mid_base$
DECLARE
  v_result record;
BEGIN
  SELECT * INTO STRICT v_result
  FROM public.hosted_realtime_canary_cleanup_v2(
    '80000000-0000-4000-8000-000000000001',
    ARRAY[
      '10000000-0000-4000-8000-000000000001'::uuid,
      '10000000-0000-4000-8000-000000000002'::uuid,
      '10000000-0000-4000-8000-000000000003'::uuid,
      '10000000-0000-4000-8000-000000000004'::uuid,
      '10000000-0000-4000-8000-000000000005'::uuid,
      '10000000-0000-4000-8000-000000000006'::uuid,
      '10000000-0000-4000-8000-000000000007'::uuid,
      '10000000-0000-4000-8000-000000000009'::uuid
    ],
    '{}'::uuid[]
  );
  IF v_result.deleted_messages <> 7
     OR v_result.deleted_notifications <> 0
     OR v_result.restored_blocks <> 0
     OR v_result.residue_count <> 0 THEN
    RAISE EXCEPTION 'local_cleanup_v2_mid_base_failed';
  END IF;
END
$cleanup_v2_mid_base$;
ROLLBACK;
RESET ROLE;

SELECT auth.local_canary_set_session(
  '70000000-0000-4000-8000-000000000003',
  :'actor_c_id'::uuid,
  true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', :'actor_c_id',
    'aud', 'authenticated',
    'iss', 'https://' || :'project_ref' || '.supabase.co/auth/v1',
    'exp', extract(
      epoch FROM pg_catalog.statement_timestamp() + interval '15 minutes'
    )::bigint,
    'session_id', '70000000-0000-4000-8000-000000000003',
    'app_metadata', pg_catalog.jsonb_build_object(
      'caaci_hosted_canary', true,
      'caaci_dataset_lineage', :'dataset_lineage',
      'caaci_canary_role', 'member-c'
    )
  )::text,
  false
);
SET ROLE authenticated;
SELECT * FROM public.hosted_realtime_canary_insert_message(
  '80000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000008',
  :'conversation_ac_id'::uuid,
  'caaci-hosted-canary-10000000-0000-4000-8000-000000000008'
);
RESET ROLE;

SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', :'actor_a_id',
    'aud', 'authenticated',
    'iss', 'https://' || :'project_ref' || '.supabase.co/auth/v1',
    'exp', extract(
      epoch FROM pg_catalog.statement_timestamp() + interval '15 minutes'
    )::bigint,
    'session_id', '70000000-0000-4000-8000-000000000001',
    'app_metadata', pg_catalog.jsonb_build_object(
      'caaci_hosted_canary', true,
      'caaci_dataset_lineage', :'dataset_lineage',
      'caaci_canary_role', 'member-a'
    )
  )::text,
  false
);
SELECT pg_catalog.array_agg(
  pg_catalog.format(
    '20000000-0000-4000-8000-%s',
    pg_catalog.lpad(ordinal::text, 12, '0')
  )::uuid
  ORDER BY ordinal
)::text AS scale_ids
FROM pg_catalog.generate_series(1, 51) AS ordinal
\gset
SELECT pg_catalog.array_agg(id ORDER BY id)::text AS all_v2_message_ids
FROM (
  SELECT pg_catalog.format(
    '10000000-0000-4000-8000-%s',
    pg_catalog.lpad(ordinal::text, 12, '0')
  )::uuid AS id
  FROM pg_catalog.generate_series(1, 8) AS ordinal
  UNION ALL
  SELECT pg_catalog.format(
    '20000000-0000-4000-8000-%s',
    pg_catalog.lpad(ordinal::text, 12, '0')
  )::uuid AS id
  FROM pg_catalog.generate_series(1, 51) AS ordinal
) AS ids
\gset
SELECT
  pg_catalog.set_config('caaci.local_scale_ids', :'scale_ids', false),
  pg_catalog.set_config(
    'caaci.local_all_v2_message_ids', :'all_v2_message_ids', false
  );
SET ROLE authenticated;

-- The client already knows all generated IDs before issuing the atomic scale
-- and notification calls. If neither call reached the server, their complete
-- unledgered ID set is still a safe cleanup superset because no source row
-- exists. Roll back this containment proof and then perform the real calls.
BEGIN;
DO $cleanup_v2_before_scale$
DECLARE
  v_result record;
BEGIN
  SELECT * INTO STRICT v_result
  FROM public.hosted_realtime_canary_cleanup_v2(
    '80000000-0000-4000-8000-000000000001',
    pg_catalog.current_setting(
      'caaci.local_all_v2_message_ids'
    )::uuid[],
    ARRAY['30000000-0000-4000-8000-000000000001'::uuid]
  );
  IF v_result.deleted_messages <> 8
     OR v_result.deleted_notifications <> 0
     OR v_result.restored_blocks <> 0
     OR v_result.residue_count <> 0 THEN
    RAISE EXCEPTION 'local_cleanup_v2_before_scale_failed';
  END IF;
END
$cleanup_v2_before_scale$;
ROLLBACK;

DO $expect_scale_input_denials$
DECLARE
  v_ids uuid[] := pg_catalog.current_setting(
    'caaci.local_scale_ids'
  )::uuid[];
  v_duplicate uuid[];
  v_unsorted uuid[];
BEGIN
  BEGIN
    PERFORM * FROM public.hosted_realtime_canary_insert_scale_batch(
      '80000000-0000-4000-8000-000000000001', v_ids[1:50]
    );
    RAISE EXCEPTION 'local_partial_scale_batch_was_not_denied';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF SQLERRM <> 'hosted_realtime_canary_scale_batch_denied' THEN RAISE; END IF;
  END;
  v_duplicate := v_ids;
  v_duplicate[51] := v_duplicate[50];
  BEGIN
    PERFORM * FROM public.hosted_realtime_canary_insert_scale_batch(
      '80000000-0000-4000-8000-000000000001', v_duplicate
    );
    RAISE EXCEPTION 'local_duplicate_scale_batch_was_not_denied';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF SQLERRM <> 'hosted_realtime_canary_scale_batch_denied' THEN RAISE; END IF;
  END;
  SELECT pg_catalog.array_agg(id ORDER BY ord DESC)
    INTO v_unsorted
  FROM pg_catalog.unnest(v_ids) WITH ORDINALITY AS input(id, ord);
  BEGIN
    PERFORM * FROM public.hosted_realtime_canary_insert_scale_batch(
      '80000000-0000-4000-8000-000000000001', v_unsorted
    );
    RAISE EXCEPTION 'local_unsorted_scale_batch_was_not_denied';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF SQLERRM <> 'hosted_realtime_canary_scale_batch_denied' THEN RAISE; END IF;
  END;
END
$expect_scale_input_denials$;
SELECT * FROM public.hosted_realtime_canary_insert_scale_batch(
  '80000000-0000-4000-8000-000000000001',
  :'scale_ids'::uuid[]
);
SELECT * FROM public.hosted_realtime_canary_insert_notification(
  '80000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001'
);
RESET ROLE;

SET ROLE caaci_hosted_realtime_executor;
DO $assert_v2_message_and_notification_shape$
DECLARE
  v_run constant uuid := '80000000-0000-4000-8000-000000000001';
BEGIN
  IF (SELECT pg_catalog.count(*) FROM private.hosted_realtime_canary_writes
      WHERE run_id = v_run AND write_class = 'base') <> 8
     OR (SELECT pg_catalog.count(*) FROM private.hosted_realtime_canary_writes
         WHERE run_id = v_run AND write_class = 'scale') <> 51
     OR (SELECT pg_catalog.count(*) FROM private.hosted_realtime_canary_writes
         WHERE run_id = v_run AND write_class = 'base'
           AND actor_id = pg_catalog.current_setting(
             'caaci.local_actor_a_id'
           )::uuid
           AND conversation_id = pg_catalog.current_setting(
             'caaci.local_conversation_ab_id'
           )::uuid) <> 5
     OR (SELECT pg_catalog.count(*) FROM private.hosted_realtime_canary_writes
         WHERE run_id = v_run AND write_class = 'base'
           AND actor_id = pg_catalog.current_setting(
             'caaci.local_actor_a_id'
           )::uuid
           AND conversation_id = pg_catalog.current_setting(
             'caaci.local_conversation_ac_id'
           )::uuid) <> 2
     OR (SELECT pg_catalog.count(*) FROM private.hosted_realtime_canary_writes
         WHERE run_id = v_run AND write_class = 'base'
           AND actor_id = pg_catalog.current_setting(
             'caaci.local_actor_c_id'
           )::uuid
           AND conversation_id = pg_catalog.current_setting(
             'caaci.local_conversation_ac_id'
           )::uuid) <> 1
     OR (SELECT pg_catalog.count(DISTINCT expected_created_at)
         FROM private.hosted_realtime_canary_writes
         WHERE run_id = v_run AND write_class = 'scale') <> 1
     OR (SELECT pg_catalog.count(*) FROM private.hosted_realtime_canary_writes
         WHERE run_id = v_run AND write_class = 'scale'
           AND batch_ordinal BETWEEN 1 AND 21
           AND actor_id = pg_catalog.current_setting(
             'caaci.local_actor_a_id'
           )::uuid) <> 21
     OR (SELECT pg_catalog.count(*) FROM private.hosted_realtime_canary_writes
         WHERE run_id = v_run AND write_class = 'scale'
           AND batch_ordinal BETWEEN 22 AND 51
           AND actor_id = pg_catalog.current_setting(
             'caaci.local_actor_b_id'
           )::uuid) <> 30
     OR (SELECT pg_catalog.count(*) FROM public.messages AS message
         JOIN private.hosted_realtime_canary_writes AS write
           ON write.message_id = message.id
         WHERE write.run_id = v_run
           AND message.created_at = write.expected_created_at) <> 59
     OR (SELECT pg_catalog.count(*) FROM public.notifications AS notification
         JOIN private.hosted_realtime_canary_notifications AS ledger
           ON ledger.notification_id = notification.id
         WHERE ledger.run_id = v_run
           AND notification.user_id = pg_catalog.current_setting(
             'caaci.local_actor_a_id'
           )::uuid
           AND notification.conversation_id = pg_catalog.current_setting(
             'caaci.local_conversation_ab_id'
           )::uuid
           AND notification.type = 'system'
           AND notification.title = 'CAACI hosted Realtime canary'
           AND notification.body =
             'caaci-hosted-notification-' || notification.id::text
           AND notification.emailed_at = ledger.expected_emailed_at) <> 1 THEN
    RAISE EXCEPTION 'local_v2_message_or_notification_shape_failed';
  END IF;
END
$assert_v2_message_and_notification_shape$;
RESET ROLE;

-- B and A can mutate only the opposite fixture actor, and only in the exact
-- blocked->unblocked order once per direction.
SELECT auth.local_canary_set_session(
  '70000000-0000-4000-8000-000000000002',
  :'actor_b_id'::uuid,
  true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', :'actor_b_id',
    'aud', 'authenticated',
    'iss', 'https://' || :'project_ref' || '.supabase.co/auth/v1',
    'exp', extract(
      epoch FROM pg_catalog.statement_timestamp() + interval '15 minutes'
    )::bigint,
    'session_id', '70000000-0000-4000-8000-000000000002',
    'app_metadata', pg_catalog.jsonb_build_object(
      'caaci_hosted_canary', true,
      'caaci_dataset_lineage', :'dataset_lineage',
      'caaci_canary_role', 'member-b'
    )
  )::text,
  false
);
SET ROLE authenticated;
DO $expect_direct_block_denied$
BEGIN
  BEGIN
    INSERT INTO public.blocks (blocker_id, blocked_id)
    VALUES (
      pg_catalog.current_setting('caaci.local_actor_b_id')::uuid,
      pg_catalog.current_setting('caaci.local_actor_a_id')::uuid
    );
    RAISE EXCEPTION 'local_direct_block_was_not_denied';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF SQLERRM <> 'hosted_realtime_canary_direct_block_mutation_denied' THEN
      RAISE;
    END IF;
  END;
END
$expect_direct_block_denied$;
SELECT * FROM public.hosted_realtime_canary_set_block(
  '80000000-0000-4000-8000-000000000001', :'actor_a_id'::uuid, true
);
SELECT * FROM public.hosted_realtime_canary_set_block(
  '80000000-0000-4000-8000-000000000001', :'actor_a_id'::uuid, false
);
RESET ROLE;

SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', :'actor_a_id',
    'aud', 'authenticated',
    'iss', 'https://' || :'project_ref' || '.supabase.co/auth/v1',
    'exp', extract(
      epoch FROM pg_catalog.statement_timestamp() + interval '15 minutes'
    )::bigint,
    'session_id', '70000000-0000-4000-8000-000000000001',
    'app_metadata', pg_catalog.jsonb_build_object(
      'caaci_hosted_canary', true,
      'caaci_dataset_lineage', :'dataset_lineage',
      'caaci_canary_role', 'member-a'
    )
  )::text,
  false
);
SET ROLE authenticated;
SELECT * FROM public.hosted_realtime_canary_set_block(
  '80000000-0000-4000-8000-000000000001', :'actor_b_id'::uuid, true
);
BEGIN;
DO $cleanup_v2_active_block$
DECLARE
  v_result record;
BEGIN
  SELECT * INTO STRICT v_result
  FROM public.hosted_realtime_canary_cleanup_v2(
    '80000000-0000-4000-8000-000000000001',
    pg_catalog.current_setting(
      'caaci.local_all_v2_message_ids'
    )::uuid[],
    ARRAY['30000000-0000-4000-8000-000000000001'::uuid]
  );
  IF v_result.deleted_messages <> 59
     OR v_result.deleted_notifications <> 1
     OR v_result.restored_blocks <> 1
     OR v_result.residue_count <> 0 THEN
    RAISE EXCEPTION 'local_cleanup_v2_active_block_failed';
  END IF;
END
$cleanup_v2_active_block$;
ROLLBACK;
SELECT * FROM public.hosted_realtime_canary_set_block(
  '80000000-0000-4000-8000-000000000001', :'actor_b_id'::uuid, false
);
DO $expect_repeat_block_denied$
BEGIN
  BEGIN
    PERFORM * FROM public.hosted_realtime_canary_set_block(
      '80000000-0000-4000-8000-000000000001',
      pg_catalog.current_setting('caaci.local_actor_b_id')::uuid,
      true
    );
    RAISE EXCEPTION 'local_repeated_block_was_not_denied';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF SQLERRM <> 'hosted_realtime_canary_block_transition_denied' THEN RAISE; END IF;
  END;
END
$expect_repeat_block_denied$;

SELECT pg_catalog.array_agg(id ORDER BY id)::text AS all_v2_message_ids
FROM (
  SELECT pg_catalog.format(
    '10000000-0000-4000-8000-%s',
    pg_catalog.lpad(ordinal::text, 12, '0')
  )::uuid AS id
  FROM pg_catalog.generate_series(1, 8) AS ordinal
  UNION ALL
  SELECT pg_catalog.format(
    '20000000-0000-4000-8000-%s',
    pg_catalog.lpad(ordinal::text, 12, '0')
  )::uuid AS id
  FROM pg_catalog.generate_series(1, 51) AS ordinal
) AS ids
\gset
DO $expect_legacy_cleanup_after_scale_denied$
BEGIN
  BEGIN
    PERFORM * FROM public.hosted_realtime_canary_cleanup(
      '80000000-0000-4000-8000-000000000001',
      pg_catalog.current_setting(
        'caaci.local_all_v2_message_ids'
      )::uuid[]
    );
    RAISE EXCEPTION 'local_legacy_cleanup_after_scale_was_not_denied';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF SQLERRM <> 'hosted_realtime_canary_cleanup_denied' THEN RAISE; END IF;
  END;
END
$expect_legacy_cleanup_after_scale_denied$;
RESET ROLE;

-- A ledger/public mismatch must quarantine with zero deletion. Roll back this
-- deliberately corrupted transaction, then exercise the real exact cleanup.
BEGIN;
SET LOCAL ROLE caaci_hosted_realtime_executor;
UPDATE private.hosted_realtime_canary_notifications
SET expected_emailed_at = expected_emailed_at + interval '1 second'
WHERE run_id = '80000000-0000-4000-8000-000000000001';
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT * FROM public.hosted_realtime_canary_cleanup_v2(
  '80000000-0000-4000-8000-000000000001',
  :'all_v2_message_ids'::uuid[],
  ARRAY['30000000-0000-4000-8000-000000000001'::uuid]
);
RESET ROLE;
SET LOCAL ROLE caaci_hosted_realtime_executor;
DO $assert_notification_drift_quarantined$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM private.hosted_realtime_canary_runs
    WHERE run_id = '80000000-0000-4000-8000-000000000001'
      AND status = 'quarantined'
      AND last_cleanup_sqlstate = 'row_shape_drift'
  ) OR (SELECT pg_catalog.count(*) FROM public.messages) <> 59
    OR (SELECT pg_catalog.count(*) FROM public.notifications) <> 1 THEN
    RAISE EXCEPTION 'local_notification_drift_quarantine_failed';
  END IF;
END
$assert_notification_drift_quarantined$;
ROLLBACK;

SET ROLE authenticated;
DO $cleanup_v2$
DECLARE
  v_result record;
BEGIN
  SELECT * INTO STRICT v_result
  FROM public.hosted_realtime_canary_cleanup_v2(
    '80000000-0000-4000-8000-000000000001',
    pg_catalog.current_setting(
      'caaci.local_all_v2_message_ids'
    )::uuid[],
    ARRAY['30000000-0000-4000-8000-000000000001'::uuid]
  );
  IF v_result.deleted_messages <> 59
     OR v_result.deleted_notifications <> 1
     OR v_result.restored_blocks <> 0
     OR v_result.residue_count <> 0 THEN
    RAISE EXCEPTION 'local_cleanup_v2_assertion_failed';
  END IF;
END
$cleanup_v2$;
RESET ROLE;

SELECT auth.local_canary_set_session(
  '70000000-0000-4000-8000-000000000001', :'actor_a_id'::uuid, false
);
SELECT auth.local_canary_set_session(
  '70000000-0000-4000-8000-000000000002', :'actor_b_id'::uuid, false
);
SELECT auth.local_canary_set_session(
  '70000000-0000-4000-8000-000000000003', :'actor_c_id'::uuid, false
);
\ir VERIFY.sql

-- Cleaned history is part of the residue proof, not inert bookkeeping. Each
-- timestamp tamper below must make VERIFY fail closed and is rolled back before
-- the next independent fixture.
BEGIN;
SET LOCAL ROLE caaci_hosted_realtime_executor;
UPDATE private.hosted_realtime_canary_writes
SET inserted_at = NULL
WHERE run_id = '80000000-0000-4000-8000-000000000001'
  AND message_id = '10000000-0000-4000-8000-000000000001';
RESET ROLE;
\set expected_verify_failure_message verify_live_residue_failed
\ir LOCAL_EXPECT_VERIFY_FAILURE.sql
\ir VERIFY.sql

BEGIN;
SET LOCAL ROLE caaci_hosted_realtime_executor;
UPDATE private.hosted_realtime_canary_notifications
SET expected_emailed_at = expected_emailed_at + interval '1 second'
WHERE run_id = '80000000-0000-4000-8000-000000000001';
RESET ROLE;
\set expected_verify_failure_message verify_live_residue_failed
\ir LOCAL_EXPECT_VERIFY_FAILURE.sql
\ir VERIFY.sql

BEGIN;
SET LOCAL ROLE caaci_hosted_realtime_executor;
UPDATE private.hosted_realtime_canary_block_transitions
SET applied_at = NULL
WHERE run_id = '80000000-0000-4000-8000-000000000001'
  AND blocker_id = :'actor_a_id'::uuid
  AND transition_ordinal = 1;
RESET ROLE;
\set expected_verify_failure_message verify_live_residue_failed
\ir LOCAL_EXPECT_VERIFY_FAILURE.sql
\ir VERIFY.sql

BEGIN;
SET LOCAL ROLE caaci_hosted_realtime_executor;
UPDATE private.hosted_realtime_canary_runs
SET attempted_count = attempted_count + 1
WHERE run_id = '80000000-0000-4000-8000-000000000001';
RESET ROLE;
\set expected_verify_failure_message verify_live_residue_failed
\ir LOCAL_EXPECT_VERIFY_FAILURE.sql
\ir VERIFY.sql

\ir ROLLBACK.sql

-- Abnormal lease expiry: TTL cleans exact database rows, closes admission and
-- leaves recovery_required until independently evidenced session recovery.
SELECT (
  pg_catalog.statement_timestamp() + interval '2 hours'
)::text AS provider_proof_expires_at
\gset
\ir ACTIVATE.sql
SELECT private.hosted_realtime_canary_ttl_cleanup();

SELECT auth.local_canary_set_session(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  :'actor_a_id'::uuid,
  true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', :'actor_a_id',
    'aud', 'authenticated',
    'iss', 'https://' || :'project_ref' || '.supabase.co/auth/v1',
    'exp', extract(
      epoch FROM pg_catalog.statement_timestamp() + interval '15 minutes'
    )::bigint,
    'session_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'app_metadata', pg_catalog.jsonb_build_object(
      'caaci_hosted_canary', true,
      'caaci_dataset_lineage', :'dataset_lineage',
      'caaci_canary_role', 'member-a'
    )
  )::text,
  false
);
SET ROLE authenticated;
SELECT * FROM public.hosted_realtime_canary_begin_run(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
);
SELECT * FROM public.hosted_realtime_canary_insert_message(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  :'conversation_ab_id'::uuid,
  'caaci-hosted-canary-cccccccc-cccc-4ccc-8ccc-cccccccccccc'
);
RESET ROLE;

SELECT auth.local_canary_set_session(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
  :'actor_b_id'::uuid,
  true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', :'actor_b_id',
    'aud', 'authenticated',
    'iss', 'https://' || :'project_ref' || '.supabase.co/auth/v1',
    'exp', extract(
      epoch FROM pg_catalog.statement_timestamp() + interval '15 minutes'
    )::bigint,
    'session_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
    'app_metadata', pg_catalog.jsonb_build_object(
      'caaci_hosted_canary', true,
      'caaci_dataset_lineage', :'dataset_lineage',
      'caaci_canary_role', 'member-b'
    )
  )::text,
  false
);
SET ROLE authenticated;
SELECT * FROM public.hosted_realtime_canary_set_block(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  :'actor_a_id'::uuid,
  true
);
RESET ROLE;

SET ROLE caaci_hosted_realtime_executor;
UPDATE private.hosted_realtime_canary_runs
SET started_at =
      pg_catalog.statement_timestamp() - interval '30 minutes',
    lease_expires_at =
  pg_catalog.statement_timestamp() - interval '1 minute'
WHERE run_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
RESET ROLE;
SELECT private.hosted_realtime_canary_ttl_cleanup();

SET ROLE caaci_hosted_realtime_executor;
DO $local_assert$
BEGIN
  IF NOT EXISTS (
       SELECT 1
       FROM private.hosted_realtime_canary_runs
       WHERE run_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
         AND status = 'recovery_required'
     )
     OR EXISTS (
       SELECT 1 FROM public.messages
       WHERE id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
     )
     OR EXISTS (
       SELECT 1 FROM public.blocks
       WHERE blocker_id = pg_catalog.current_setting(
               'caaci.local_actor_b_id'
             )::uuid
         AND blocked_id = pg_catalog.current_setting(
               'caaci.local_actor_a_id'
             )::uuid
     ) THEN
    RAISE EXCEPTION 'local_ttl_recovery_assertion_failed';
  END IF;
END
$local_assert$;
RESET ROLE;

SELECT auth.local_canary_set_session(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  :'actor_a_id'::uuid,
  false
);
SELECT auth.local_canary_set_session(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
  :'actor_b_id'::uuid,
  false
);
SET ROLE caaci_hosted_realtime_executor;
UPDATE private.hosted_realtime_canary_runs
SET cleanup_started_at =
      pg_catalog.statement_timestamp() - interval '9 minutes',
    cleaned_at = pg_catalog.statement_timestamp() - interval '8 minutes'
WHERE run_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
RESET ROLE;
\set recovery_run_id bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb
\set management_recovery_proof_sha256 bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
\set recovery_approval_reference local-recovery-proof
SELECT
  (
    pg_catalog.statement_timestamp() - interval '7 minutes'
  )::text AS management_recovery_completed_at,
  (
    pg_catalog.statement_timestamp() + interval '2 hours'
  )::text AS management_recovery_proof_expires_at
\gset
\ir RECOVER.sql
\ir ROLLBACK.sql
