DO $verify$
DECLARE
  v_project_ref constant text := lower(pg_catalog.current_setting(
    'caaci.activation_project_ref'
  ));
  v_lineage constant text := lower(pg_catalog.current_setting(
    'caaci.activation_dataset_lineage'
  ));
  v_manifest constant text := lower(pg_catalog.current_setting(
    'caaci.activation_fixture_manifest_sha256'
  ));
  v_sentinel constant uuid := pg_catalog.current_setting(
    'caaci.activation_sentinel_id'
  )::uuid;
  v_require_heartbeat constant boolean := pg_catalog.current_setting(
    'caaci.activation_verify_require_heartbeat'
  )::boolean;
  v_config private.hosted_realtime_canary_environment_config%ROWTYPE;
  v_actual text[];
  v_expected text[];
BEGIN
  IF CURRENT_USER <> 'caaci_hosted_realtime_executor'
     OR SESSION_USER <> 'postgres' THEN
    RAISE EXCEPTION 'verify_execution_role_failed'
      USING ERRCODE = '42501';
  END IF;

  SELECT config.* INTO STRICT v_config
  FROM private.hosted_realtime_canary_environment_config AS config
  WHERE config.singleton;

  IF v_config.project_ref <> v_project_ref
     OR v_config.dataset_lineage <> v_lineage
     OR v_config.fixture_manifest_sha256 <> v_manifest
     OR v_config.sentinel_id <> v_sentinel
     OR NOT v_config.synthetic_only
     OR NOT v_config.disposable
     OR NOT v_config.provider_side_effects_disabled
     OR NOT v_config.write_cleanup_supported
     OR v_config.expires_at <= pg_catalog.statement_timestamp()
     OR v_config.provider_proof_expires_at
          <= pg_catalog.statement_timestamp()
     OR v_config.ttl_job_id IS NULL
     OR (
       v_require_heartbeat
       AND (
         v_config.last_ttl_heartbeat_at IS NULL
         OR v_config.last_ttl_heartbeat_at <
           pg_catalog.statement_timestamp() - interval '10 minutes'
       )
     ) THEN
    RAISE EXCEPTION 'verify_environment_config_failed'
      USING ERRCODE = '55000';
  END IF;

  PERFORM pg_catalog.set_config(
    'caaci.activation_verified_fixture_manifest_payload',
    pg_catalog.concat_ws(
      E'\037',
      'caaci-hosted-fixture-v1',
      v_config.project_ref,
      v_config.dataset_lineage,
      v_config.sentinel_id::text,
      v_config.fixture_revision::text,
      'member-a',
      v_config.actor_a_id::text,
      'member-b',
      v_config.actor_b_id::text,
      'member-c',
      v_config.actor_c_id::text,
      'ab',
      v_config.conversation_ab_id::text,
      'ac',
      v_config.conversation_ac_id::text
    ),
    true
  );

  IF (
       SELECT pg_catalog.count(*)
       FROM private.hosted_realtime_canary_profile_baselines
     ) <> 3
     OR EXISTS (
       SELECT 1
       FROM private.hosted_realtime_canary_runs AS run
       WHERE run.status IN (
         'active', 'recovery_required', 'quarantined'
       )
     )
     OR private.hosted_realtime_canary_residue_count(false) <> 0 THEN
    RAISE EXCEPTION 'verify_live_residue_failed' USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles AS role
    WHERE role.rolname = 'caaci_hosted_realtime_executor'
      AND NOT role.rolcanlogin
      AND NOT role.rolsuper
      AND NOT role.rolinherit
      AND NOT role.rolcreaterole
      AND NOT role.rolcreatedb
      AND NOT role.rolreplication
      AND NOT role.rolbypassrls
  )
  OR (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_auth_members AS membership
    WHERE membership.roleid =
            pg_catalog.to_regrole('caaci_hosted_realtime_executor')
      AND membership.member = pg_catalog.to_regrole('postgres')
  ) <> 2
  OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members AS membership
    WHERE membership.roleid =
            pg_catalog.to_regrole('caaci_hosted_realtime_executor')
      AND membership.member = pg_catalog.to_regrole('postgres')
      AND membership.grantor IN (
        SELECT bootstrap.oid
        FROM pg_catalog.pg_roles AS bootstrap
        WHERE bootstrap.rolsuper
      )
      AND membership.admin_option
      AND NOT membership.inherit_option
      AND NOT membership.set_option
  )
  OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members AS membership
    WHERE membership.roleid =
            pg_catalog.to_regrole('caaci_hosted_realtime_executor')
      AND membership.member = pg_catalog.to_regrole('postgres')
      AND membership.grantor = pg_catalog.to_regrole('postgres')
      AND NOT membership.admin_option
      AND NOT membership.inherit_option
      AND membership.set_option
  )
  OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members AS membership
    WHERE (
      membership.roleid =
        pg_catalog.to_regrole('caaci_hosted_realtime_executor')
      OR membership.member =
        pg_catalog.to_regrole('caaci_hosted_realtime_executor')
    )
      AND NOT (
        membership.roleid =
          pg_catalog.to_regrole('caaci_hosted_realtime_executor')
        AND membership.member = pg_catalog.to_regrole('postgres')
        AND (
          (
            membership.grantor IN (
              SELECT bootstrap.oid
              FROM pg_catalog.pg_roles AS bootstrap
              WHERE bootstrap.rolsuper
            )
            AND membership.admin_option
            AND NOT membership.inherit_option
            AND NOT membership.set_option
          )
          OR (
            membership.grantor = pg_catalog.to_regrole('postgres')
            AND NOT membership.admin_option
            AND NOT membership.inherit_option
            AND membership.set_option
          )
        )
      )
  )
  OR NOT pg_catalog.pg_has_role(
    'postgres', 'caaci_hosted_realtime_executor', 'MEMBER'
  )
  OR pg_catalog.pg_has_role(
    'postgres', 'caaci_hosted_realtime_executor', 'USAGE'
  )
  OR NOT pg_catalog.pg_has_role(
    'postgres', 'caaci_hosted_realtime_executor', 'SET'
  ) THEN
    RAISE EXCEPTION 'verify_executor_role_failed' USING ERRCODE = '55000';
  END IF;

  IF NOT pg_catalog.has_schema_privilege(
       'caaci_hosted_realtime_executor', 'public', 'USAGE'
     )
     OR NOT pg_catalog.has_schema_privilege(
       'caaci_hosted_realtime_executor', 'private', 'USAGE'
     )
     OR pg_catalog.has_schema_privilege(
       'caaci_hosted_realtime_executor', 'auth', 'USAGE'
     )
     OR pg_catalog.has_schema_privilege(
       'caaci_hosted_realtime_executor', 'public', 'CREATE'
     )
     OR pg_catalog.has_schema_privilege(
       'caaci_hosted_realtime_executor', 'private', 'CREATE'
     ) THEN
    RAISE EXCEPTION 'verify_executor_schema_boundary_failed'
      USING ERRCODE = '55000';
  END IF;

  v_expected := ARRAY[
    'private.hosted_realtime_canary_actor_authorized(uuid,text)',
    'private.hosted_realtime_canary_auth_context(text,text)',
    'private.hosted_realtime_canary_cleanup_run(uuid,text)',
    'private.hosted_realtime_canary_fixture_session_count(uuid,uuid,uuid,text)',
    'private.hosted_realtime_canary_message_mutation_guard()',
    'private.hosted_realtime_canary_residue_count(boolean)',
    'private.hosted_realtime_canary_restore_profile_timestamp()',
    'private.hosted_realtime_canary_ttl_cleanup()',
    'public.hosted_realtime_canary_begin_run(uuid)',
    'public.hosted_realtime_canary_cleanup(uuid,uuid[])',
    'public.hosted_realtime_canary_environment()',
    'public.hosted_realtime_canary_insert_message(uuid,uuid,uuid,text)'
  ]::text[];
  SELECT pg_catalog.array_agg(
    procedure.oid::pg_catalog.regprocedure::text
    ORDER BY procedure.oid::pg_catalog.regprocedure::text
  ) INTO v_actual
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = procedure.pronamespace
  WHERE procedure.proname LIKE 'hosted_realtime_canary_%'
    AND namespace.nspname IN ('private', 'public');
  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'verify_function_surface_failed: %', v_actual
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    JOIN pg_catalog.pg_roles AS owner
      ON owner.oid = procedure.proowner
    WHERE procedure.proname LIKE 'hosted_realtime_canary_%'
      AND namespace.nspname IN ('private', 'public')
      AND (
        owner.rolname <> CASE
          WHEN procedure.oid IN (
            'private.hosted_realtime_canary_auth_context(text,text)'::pg_catalog.regprocedure,
            'private.hosted_realtime_canary_fixture_session_count(uuid,uuid,uuid,text)'::pg_catalog.regprocedure
          ) THEN 'postgres'
          ELSE 'caaci_hosted_realtime_executor'
        END
        OR NOT procedure.prosecdef
        OR procedure.proconfig IS DISTINCT FROM CASE
          WHEN procedure.oid =
            'private.hosted_realtime_canary_fixture_session_count(uuid,uuid,uuid,text)'::pg_catalog.regprocedure
          THEN ARRAY[
            'search_path=pg_catalog',
            'application_name=' ||
              v_config.fixture_session_binding_sha256_base64url
          ]::text[]
          ELSE ARRAY['search_path=pg_catalog']::text[]
        END
        OR (
          procedure.oid =
            'private.hosted_realtime_canary_auth_context(text,text)'::pg_catalog.regprocedure
          AND pg_catalog.pg_get_function_result(procedure.oid)
            IS DISTINCT FROM
              'TABLE(actor_id uuid, session_id uuid, canary_role text)'
        )
        OR (
          procedure.oid =
            'private.hosted_realtime_canary_fixture_session_count(uuid,uuid,uuid,text)'::pg_catalog.regprocedure
          AND pg_catalog.pg_get_function_result(procedure.oid)
            IS DISTINCT FROM 'integer'
        )
      )
  ) THEN
    RAISE EXCEPTION 'verify_function_security_failed'
      USING ERRCODE = '55000';
  END IF;

  -- The two postgres-owned adapters are the only bridge into managed Auth.
  -- Pin their executable body and complete ACL, not just their names/owners,
  -- so a later data-oracle expansion or extra role grant fails verification.
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      (
        'private.hosted_realtime_canary_auth_context(text,text)',
        true,
        'record',
        '3a8e23c85928f8e812f07cdfc7ff139f'
      ),
      (
        'private.hosted_realtime_canary_fixture_session_count(uuid,uuid,uuid,text)',
        false,
        'integer',
        '3c958f3b8871a873050e2d7fc3f31cbe'
      )
    ) AS expected(signature, returns_set, return_type, body_md5)
    LEFT JOIN pg_catalog.pg_proc AS procedure
      ON procedure.oid = pg_catalog.to_regprocedure(expected.signature)
    LEFT JOIN pg_catalog.pg_language AS language
      ON language.oid = procedure.prolang
    WHERE procedure.oid IS NULL
       OR language.lanname <> 'plpgsql'
       OR procedure.provolatile <> 's'
       OR procedure.prokind <> 'f'
       OR procedure.proretset IS DISTINCT FROM expected.returns_set
       OR procedure.prorettype IS DISTINCT FROM
            pg_catalog.to_regtype(expected.return_type)
       OR procedure.proleakproof
       OR procedure.proisstrict
       OR procedure.proparallel <> 'u'
       OR pg_catalog.md5(procedure.prosrc) <> expected.body_md5
       OR procedure.proacl IS NULL
       OR (
         SELECT pg_catalog.count(*)
         FROM pg_catalog.aclexplode(procedure.proacl)
       ) <> 2
       OR (
         SELECT pg_catalog.count(*)
         FROM pg_catalog.aclexplode(procedure.proacl) AS acl
         WHERE acl.grantee = pg_catalog.to_regrole('postgres')
       ) <> 1
       OR (
         SELECT pg_catalog.count(*)
         FROM pg_catalog.aclexplode(procedure.proacl) AS acl
         WHERE acl.grantee =
                 pg_catalog.to_regrole('caaci_hosted_realtime_executor')
       ) <> 1
       OR EXISTS (
         SELECT 1
         FROM pg_catalog.aclexplode(procedure.proacl) AS acl
         WHERE acl.grantee NOT IN (
                 pg_catalog.to_regrole('postgres'),
                 pg_catalog.to_regrole('caaci_hosted_realtime_executor')
               )
            OR acl.grantor <> pg_catalog.to_regrole('postgres')
            OR acl.privilege_type <> 'EXECUTE'
            OR acl.is_grantable
       )
  ) THEN
    RAISE EXCEPTION 'verify_auth_helper_definition_failed'
      USING ERRCODE = '55000';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
       'anon', 'public.hosted_realtime_canary_environment()', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated',
       'public.hosted_realtime_canary_environment()',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role',
       'public.hosted_realtime_canary_environment()',
       'EXECUTE'
     )
     OR EXISTS (
       SELECT 1
       FROM (VALUES
         ('public.hosted_realtime_canary_begin_run(uuid)'),
         ('public.hosted_realtime_canary_cleanup(uuid,uuid[])'),
         ('public.hosted_realtime_canary_insert_message(uuid,uuid,uuid,text)')
       ) AS rpc(signature)
       WHERE NOT pg_catalog.has_function_privilege(
         'authenticated', rpc.signature, 'EXECUTE'
       )
          OR pg_catalog.has_function_privilege(
            'anon', rpc.signature, 'EXECUTE'
          )
          OR pg_catalog.has_function_privilege(
            'service_role', rpc.signature, 'EXECUTE'
          )
     ) THEN
    RAISE EXCEPTION 'verify_rpc_acl_failed' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
       SELECT 1
       FROM (VALUES ('users'), ('identities'), ('sessions'))
         AS managed(relation_name)
       JOIN pg_catalog.pg_namespace AS namespace
         ON namespace.nspname = 'auth'
       JOIN pg_catalog.pg_class AS relation
         ON relation.relnamespace = namespace.oid
        AND relation.relname = managed.relation_name
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
     ) THEN
    RAISE EXCEPTION 'verify_managed_auth_acl_failed'
      USING ERRCODE = '55000';
  END IF;

  -- PRECHECK runs before the activation transaction. Repeat the public owner
  -- and RLS boundary here so an intervening or later catalog drift cannot
  -- leave executor grants effective on an unprotected public table.
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('profiles'),
      ('conversations'),
      ('messages'),
      ('conversation_archives'),
      ('notifications')
    ) AS expected(relation_name)
    LEFT JOIN pg_catalog.pg_class AS relation
      ON relation.relname = expected.relation_name
     AND relation.relnamespace =
       pg_catalog.to_regnamespace('public')
    LEFT JOIN pg_catalog.pg_roles AS owner
      ON owner.oid = relation.relowner
    WHERE relation.oid IS NULL
       OR owner.rolname <> 'postgres'
       OR NOT relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'verify_public_rls_boundary_failed'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    JOIN pg_catalog.pg_roles AS owner ON owner.oid = relation.relowner
    WHERE namespace.nspname = 'private'
      AND relation.relname LIKE 'hosted_realtime_canary_%'
      AND relation.relkind = 'r'
      AND (
        owner.rolname <> 'caaci_hosted_realtime_executor'
        OR NOT relation.relrowsecurity
        OR NOT relation.relforcerowsecurity
      )
  ) OR (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'private'
      AND relation.relname LIKE 'hosted_realtime_canary_%'
      AND relation.relkind = 'r'
  ) <> 4 THEN
    RAISE EXCEPTION 'verify_private_table_boundary_failed'
      USING ERRCODE = '55000';
  END IF;

  -- Hosted Supabase may give its trusted postgres operator inherited
  -- platform-wide read access (for example through pg_read_all_data). That is
  -- not a package grant and must not be confused with inherited executor
  -- privileges. Prove instead that every package table has exactly the
  -- owner's default ACL: no direct postgres/API/PUBLIC grant and no grant
  -- option added by this activation.
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('hosted_realtime_canary_environment_config'),
      ('hosted_realtime_canary_runs'),
      ('hosted_realtime_canary_writes'),
      ('hosted_realtime_canary_profile_baselines')
    ) AS expected(relation_name)
    LEFT JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.nspname = 'private'
    LEFT JOIN pg_catalog.pg_class AS relation
      ON relation.relnamespace = namespace.oid
     AND relation.relname = expected.relation_name
     AND relation.relkind = 'r'
    WHERE relation.oid IS NULL
       OR relation.relowner IS DISTINCT FROM
            pg_catalog.to_regrole('caaci_hosted_realtime_executor')
       OR EXISTS (
         SELECT 1
         FROM pg_catalog.pg_attribute AS attribute
         WHERE attribute.attrelid = relation.oid
           AND attribute.attnum > 0
           AND NOT attribute.attisdropped
           AND attribute.attacl IS NOT NULL
       )
       OR EXISTS (
         SELECT
           acl.grantor,
           acl.grantee,
           acl.privilege_type,
           acl.is_grantable
         FROM pg_catalog.aclexplode(
           COALESCE(
             relation.relacl,
             pg_catalog.acldefault('r', relation.relowner)
           )
         ) AS acl
         EXCEPT
         SELECT
           expected_acl.grantor,
           expected_acl.grantee,
           expected_acl.privilege_type,
           expected_acl.is_grantable
         FROM pg_catalog.aclexplode(
           pg_catalog.acldefault(
             'r',
             pg_catalog.to_regrole('caaci_hosted_realtime_executor')
           )
         ) AS expected_acl
       )
       OR EXISTS (
         SELECT
           expected_acl.grantor,
           expected_acl.grantee,
           expected_acl.privilege_type,
           expected_acl.is_grantable
         FROM pg_catalog.aclexplode(
           pg_catalog.acldefault(
             'r',
             pg_catalog.to_regrole('caaci_hosted_realtime_executor')
           )
         ) AS expected_acl
         EXCEPT
         SELECT
           acl.grantor,
           acl.grantee,
           acl.privilege_type,
           acl.is_grantable
         FROM pg_catalog.aclexplode(
           COALESCE(
             relation.relacl,
             pg_catalog.acldefault('r', relation.relowner)
           )
         ) AS acl
       )
  ) THEN
    RAISE EXCEPTION 'verify_private_table_acl_provenance_failed'
      USING ERRCODE = '55000';
  END IF;

  -- Effective privilege checks include PUBLIC and indirect memberships. This
  -- catches a permissive default ACL or a later role edge even when the
  -- explicit activation REVOKE statements are still present in source.
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('anon'),
      ('authenticated'),
      ('service_role')
    ) AS api(role_name)
    CROSS JOIN (VALUES
      ('hosted_realtime_canary_environment_config'),
      ('hosted_realtime_canary_runs'),
      ('hosted_realtime_canary_writes'),
      ('hosted_realtime_canary_profile_baselines')
    ) AS private_relation(relation_name)
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.nspname = 'private'
    JOIN pg_catalog.pg_class AS relation
      ON relation.relnamespace = namespace.oid
     AND relation.relname = private_relation.relation_name
    CROSS JOIN LATERAL (
      SELECT DISTINCT acl.privilege_type AS privilege_name
      FROM pg_catalog.aclexplode(
        pg_catalog.acldefault('r', relation.relowner)
      ) AS acl
    ) AS privilege
    WHERE pg_catalog.has_table_privilege(
      api.role_name,
      relation.oid,
      privilege.privilege_name
    )
  )
  OR EXISTS (
    SELECT 1
    FROM (VALUES
      ('anon'),
      ('authenticated'),
      ('service_role')
    ) AS api(role_name)
    CROSS JOIN (VALUES
      ('hosted_realtime_canary_environment_config'),
      ('hosted_realtime_canary_runs'),
      ('hosted_realtime_canary_writes'),
      ('hosted_realtime_canary_profile_baselines')
    ) AS private_relation(relation_name)
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.nspname = 'private'
    JOIN pg_catalog.pg_class AS relation
      ON relation.relnamespace = namespace.oid
     AND relation.relname = private_relation.relation_name
    WHERE pg_catalog.has_any_column_privilege(
      api.role_name,
      relation.oid,
      'SELECT, INSERT, UPDATE, REFERENCES'
    )
  )
  OR EXISTS (
    SELECT 1
    FROM (VALUES
      ('anon'),
      ('authenticated'),
      ('service_role')
    ) AS api(role_name)
    CROSS JOIN (VALUES
      ('private.hosted_realtime_canary_actor_authorized(uuid,text)'),
      ('private.hosted_realtime_canary_auth_context(text,text)'),
      ('private.hosted_realtime_canary_cleanup_run(uuid,text)'),
      ('private.hosted_realtime_canary_fixture_session_count(uuid,uuid,uuid,text)'),
      ('private.hosted_realtime_canary_message_mutation_guard()'),
      ('private.hosted_realtime_canary_residue_count(boolean)'),
      ('private.hosted_realtime_canary_restore_profile_timestamp()'),
      ('private.hosted_realtime_canary_ttl_cleanup()')
    ) AS private_function(signature)
    WHERE pg_catalog.has_function_privilege(
      api.role_name,
      private_function.signature,
      'EXECUTE'
    )
  ) THEN
    RAISE EXCEPTION 'verify_private_api_acl_failed'
      USING ERRCODE = '55000';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
       'caaci_hosted_realtime_executor',
       'private.hosted_realtime_canary_auth_context(text,text)',
       'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'caaci_hosted_realtime_executor',
       'private.hosted_realtime_canary_fixture_session_count(uuid,uuid,uuid,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'verify_auth_helper_acl_failed'
      USING ERRCODE = '55000';
  END IF;

  v_expected := ARRAY[
    'private.hosted_realtime_canary_environment_config.hosted_realtime_canary_executor_config',
    'private.hosted_realtime_canary_profile_baselines.hosted_realtime_canary_executor_profile_baselines',
    'private.hosted_realtime_canary_runs.hosted_realtime_canary_executor_runs',
    'private.hosted_realtime_canary_writes.hosted_realtime_canary_executor_writes',
    'public.conversation_archives.hosted_realtime_canary_executor_archive_observation',
    'public.conversations.hosted_realtime_canary_executor_conversation_observation',
    'public.conversations.hosted_realtime_canary_executor_conversation_restore',
    'public.messages.hosted_realtime_canary_executor_delete',
    'public.messages.hosted_realtime_canary_executor_insert',
    'public.messages.hosted_realtime_canary_executor_message_observation',
    'public.notifications.hosted_realtime_canary_executor_notification_observation',
    'public.profiles.hosted_realtime_canary_executor_profile_authorization'
  ]::text[];
  SELECT pg_catalog.array_agg(
    policy.schemaname || '.' || policy.tablename || '.' || policy.policyname
    ORDER BY policy.schemaname, policy.tablename, policy.policyname
  ) INTO v_actual
  FROM pg_catalog.pg_policies AS policy
  WHERE policy.policyname LIKE 'hosted_realtime_canary_%';
  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'verify_policy_surface_failed: %', v_actual
      USING ERRCODE = '55000';
  END IF;

  v_expected := ARRAY[
    'public.messages.aa_hosted_realtime_canary_message_guard',
    'public.profiles.zz_hosted_realtime_canary_restore_profile_timestamp'
  ]::text[];
  SELECT pg_catalog.array_agg(
    namespace.nspname || '.' || relation.relname || '.' || trigger.tgname
    ORDER BY namespace.nspname, relation.relname, trigger.tgname
  ) INTO v_actual
  FROM pg_catalog.pg_trigger AS trigger
  JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger.tgrelid
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  WHERE trigger.tgname LIKE '%hosted_realtime_canary%'
    AND NOT trigger.tgisinternal;
  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'verify_trigger_surface_failed: %', v_actual
      USING ERRCODE = '55000';
  END IF;

  v_expected := ARRAY[
    'aa_hosted_realtime_canary_message_guard',
    'authoritative_public_write_boundary',
    'enforce_actor_messages',
    'moderate_messages',
    'trg_chat_block_boundary',
    'trg_chat_block_boundary_update',
    'trg_clear_archives_message_insert',
    'trg_messages_response',
    'trg_rl_messages_before_insert'
  ]::text[];
  SELECT pg_catalog.array_agg(trigger.tgname ORDER BY trigger.tgname)
    INTO v_actual
  FROM pg_catalog.pg_trigger AS trigger
  WHERE trigger.tgrelid = 'public.messages'::pg_catalog.regclass
    AND NOT trigger.tgisinternal;
  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'verify_message_trigger_inventory_failed: %', v_actual
      USING ERRCODE = '55000';
  END IF;

  v_expected := ARRAY[
    'authoritative_public_write_boundary',
    'guard_illini_verify_columns',
    'moderate_profiles',
    'profiles_00_lock_admin_recovery_before_delete',
    'set_profiles_updated_at',
    'zz_hosted_realtime_canary_restore_profile_timestamp'
  ]::text[];
  SELECT pg_catalog.array_agg(trigger.tgname ORDER BY trigger.tgname)
    INTO v_actual
  FROM pg_catalog.pg_trigger AS trigger
  WHERE trigger.tgrelid = 'public.profiles'::pg_catalog.regclass
    AND NOT trigger.tgisinternal;
  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'verify_profile_trigger_inventory_failed: %', v_actual
      USING ERRCODE = '55000';
  END IF;

  PERFORM pg_catalog.set_config(
    'caaci.activation_verified_ttl_job_id',
    v_config.ttl_job_id::text,
    true
  );
END
$verify$;
