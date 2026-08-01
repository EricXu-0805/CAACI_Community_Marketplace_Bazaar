\set ON_ERROR_STOP on

-- Fresh disposable local PostgreSQL cluster only. The runner applies
-- LOCAL_BOOTSTRAP.sql first, removes the temporary supabase_admin membership,
-- then invokes this lifecycle regression as the ordinary hosted operator.

\set project_ref abcdefghijklmnopqrst
\set dataset_lineage local-fixture-v1
\set sentinel_id 66666666-6666-4666-8666-666666666666
\set fixture_revision 1
\set actor_a_id 11111111-1111-4111-8111-111111111111
\set actor_b_id 22222222-2222-4222-8222-222222222222
\set actor_c_id 33333333-3333-4333-8333-333333333333
\set conversation_ab_id 44444444-4444-4444-8444-444444444444
\set conversation_ac_id 55555555-5555-4555-8555-555555555555
\set provider_disable_proof_sha256 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
\set max_access_token_lifetime_seconds 300
\set approval_reference local-regression-only

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

-- Normal one-shot run.
\ir ACTIVATE.sql
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
       CROSS JOIN (VALUES
         ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
         ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
       ) AS privilege(privilege_name)
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
         ('private.hosted_realtime_canary_fixture_session_count(uuid,uuid,uuid)')
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
       'private.hosted_realtime_canary_fixture_session_count(uuid,uuid,uuid)',
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
      '11111111-1111-4111-8111-111111111111'::uuid,
      '11111111-1111-4111-8111-111111111111'::uuid,
      '33333333-3333-4333-8333-333333333333'::uuid
    );
    RAISE EXCEPTION 'local_duplicate_fixture_set_was_not_denied';
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
SET ROLE caaci_hosted_realtime_executor;
UPDATE private.hosted_realtime_canary_runs
SET cleaned_at = pg_catalog.statement_timestamp() - interval '8 minutes'
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
