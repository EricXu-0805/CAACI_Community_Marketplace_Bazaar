\set ON_ERROR_STOP on

BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';
SET LOCAL search_path = pg_catalog;

SELECT
  pg_catalog.set_config(
    'caaci.activation_project_ref', :'project_ref', true
  ),
  pg_catalog.set_config(
    'caaci.activation_dataset_lineage', :'dataset_lineage', true
  ),
  pg_catalog.set_config(
    'caaci.activation_fixture_manifest_sha256',
    :'fixture_manifest_sha256',
    true
  ),
  pg_catalog.set_config(
    'caaci.activation_sentinel_id', :'sentinel_id', true
  ),
  pg_catalog.set_config(
    'caaci.activation_fixture_revision', :'fixture_revision', true
  ),
  pg_catalog.set_config(
    'caaci.activation_actor_a_id', :'actor_a_id', true
  ),
  pg_catalog.set_config(
    'caaci.activation_actor_b_id', :'actor_b_id', true
  ),
  pg_catalog.set_config(
    'caaci.activation_actor_c_id', :'actor_c_id', true
  ),
  pg_catalog.set_config(
    'caaci.activation_conversation_ab_id',
    :'conversation_ab_id',
    true
  ),
  pg_catalog.set_config(
    'caaci.activation_conversation_ac_id',
    :'conversation_ac_id',
    true
  ),
  pg_catalog.set_config(
    'caaci.activation_provider_disable_proof_sha256',
    :'provider_disable_proof_sha256',
    true
  ),
  pg_catalog.set_config(
    'caaci.activation_provider_proof_expires_at',
    :'provider_proof_expires_at',
    true
  ),
  pg_catalog.set_config(
    'caaci.activation_max_access_token_lifetime_seconds',
    :'max_access_token_lifetime_seconds',
    true
  ),
  pg_catalog.set_config(
    'caaci.activation_approval_reference', :'approval_reference', true
  );

DO $precheck$
DECLARE
  v_project_ref constant text := lower(pg_catalog.current_setting(
    'caaci.activation_project_ref'
  ));
  v_lineage constant text := lower(pg_catalog.current_setting(
    'caaci.activation_dataset_lineage'
  ));
  v_fixture_manifest_sha256 constant text :=
    lower(pg_catalog.current_setting(
      'caaci.activation_fixture_manifest_sha256'
    ));
  v_sentinel_id constant uuid := pg_catalog.current_setting(
    'caaci.activation_sentinel_id'
  )::uuid;
  v_fixture_revision constant integer := pg_catalog.current_setting(
    'caaci.activation_fixture_revision'
  )::integer;
  v_actor_a constant uuid := pg_catalog.current_setting(
    'caaci.activation_actor_a_id'
  )::uuid;
  v_actor_b constant uuid := pg_catalog.current_setting(
    'caaci.activation_actor_b_id'
  )::uuid;
  v_actor_c constant uuid := pg_catalog.current_setting(
    'caaci.activation_actor_c_id'
  )::uuid;
  v_conversation_ab constant uuid := pg_catalog.current_setting(
    'caaci.activation_conversation_ab_id'
  )::uuid;
  v_conversation_ac constant uuid := pg_catalog.current_setting(
    'caaci.activation_conversation_ac_id'
  )::uuid;
  v_provider_proof constant text :=
    lower(pg_catalog.current_setting(
      'caaci.activation_provider_disable_proof_sha256'
    ));
  v_provider_proof_expires_at constant timestamptz :=
    pg_catalog.current_setting(
      'caaci.activation_provider_proof_expires_at'
    )::timestamptz;
  v_max_access_token_lifetime constant integer :=
    pg_catalog.current_setting(
      'caaci.activation_max_access_token_lifetime_seconds'
    )::integer;
  v_approval_reference constant text := pg_catalog.current_setting(
    'caaci.activation_approval_reference'
  );
  v_actual_triggers text[];
  v_actual_profile_triggers text[];
  v_expected_triggers constant text[] := ARRAY[
    'authoritative_public_write_boundary',
    'enforce_actor_messages',
    'moderate_messages',
    'trg_chat_block_boundary',
    'trg_chat_block_boundary_update',
    'trg_clear_archives_message_insert',
    'trg_messages_response',
    'trg_rl_messages_before_insert'
  ]::text[];
  v_expected_profile_triggers constant text[] := ARRAY[
    'authoritative_public_write_boundary',
    'guard_illini_verify_columns',
    'moderate_profiles',
    'profiles_00_lock_admin_recovery_before_delete',
    'set_profiles_updated_at'
  ]::text[];
  v_role text;
  v_actor uuid;
  v_metadata jsonb;
  v_email text;
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
    RAISE EXCEPTION 'activation_operator_boundary_failed'
      USING ERRCODE = '42501';
  END IF;

  IF v_project_ref = 'lfhvgprfphyfvhidegum' THEN
    RAISE EXCEPTION 'activation_refused_known_production_project'
      USING ERRCODE = '42501';
  END IF;
  IF v_project_ref !~ '^[a-z0-9]{20}$'
     OR v_lineage !~ '^[a-z0-9][a-z0-9._-]{7,79}$'
     OR v_fixture_manifest_sha256 !~ '^[0-9a-f]{64}$'
     OR v_provider_proof !~ '^[0-9a-f]{64}$'
     OR v_fixture_revision < 1
     OR v_fixture_revision > 2147483647
     OR pg_catalog.length(v_approval_reference) NOT BETWEEN 8 AND 200
     OR v_approval_reference ~ '[[:cntrl:]]'
     OR v_max_access_token_lifetime NOT BETWEEN 300 AND 3600
     OR v_provider_proof_expires_at
          < pg_catalog.statement_timestamp() + interval '1 hour'
     OR v_provider_proof_expires_at
          > pg_catalog.statement_timestamp() + interval '24 hours' THEN
    RAISE EXCEPTION 'activation_input_invalid' USING ERRCODE = '22023';
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
    RAISE EXCEPTION 'activation_fixture_identity_collision'
      USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.to_regclass(
       'private.hosted_realtime_canary_environment_config'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.hosted_realtime_canary_environment()'
     ) IS NOT NULL
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc AS procedure
       JOIN pg_catalog.pg_namespace AS namespace
         ON namespace.oid = procedure.pronamespace
       WHERE procedure.proname LIKE 'hosted_realtime_canary_%'
         AND namespace.nspname IN ('private', 'public')
     )
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles
       WHERE rolname = 'caaci_hosted_realtime_executor'
     ) THEN
    RAISE EXCEPTION 'activation_package_already_present'
      USING ERRCODE = '55000';
  END IF;

  IF pg_catalog.to_regclass('auth.users') IS NULL
     OR pg_catalog.to_regclass('auth.sessions') IS NULL
     OR pg_catalog.to_regclass('auth.identities') IS NULL
     OR pg_catalog.to_regclass('public.profiles') IS NULL
     OR pg_catalog.to_regclass('public.conversations') IS NULL
     OR pg_catalog.to_regclass('public.messages') IS NULL
     OR pg_catalog.to_regclass('public.conversation_archives') IS NULL
     OR pg_catalog.to_regprocedure('auth.uid()') IS NULL
     OR pg_catalog.to_regprocedure('auth.jwt()') IS NULL
     OR pg_catalog.to_regprocedure(
       'public.recompute_seller_response(uuid)'
     ) IS NULL
     OR pg_catalog.to_regprocedure('extensions.digest(bytea,text)') IS NULL
     OR pg_catalog.to_regclass('cron.job') IS NULL
     OR pg_catalog.to_regprocedure(
       'cron.schedule(text,text,text)'
     ) IS NULL
     OR pg_catalog.to_regprocedure('cron.unschedule(bigint)') IS NULL THEN
    RAISE EXCEPTION 'activation_dependency_missing' USING ERRCODE = '55000';
  END IF;

  -- Every privilege used to install or later remove the package must be
  -- available to the real hosted operator. A superuser-only local pass is not
  -- accepted as evidence.
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
     )
     OR NOT pg_catalog.has_schema_privilege(
       'postgres', 'public', 'USAGE'
     )
     OR NOT pg_catalog.has_schema_privilege(
       'postgres', 'public', 'CREATE WITH GRANT OPTION'
     )
     OR NOT pg_catalog.has_schema_privilege(
       'postgres', 'private', 'USAGE'
     )
     OR NOT pg_catalog.has_schema_privilege(
       'postgres', 'private', 'CREATE WITH GRANT OPTION'
     )
     OR NOT pg_catalog.has_schema_privilege(
       'postgres', 'auth', 'USAGE'
     )
     OR NOT pg_catalog.has_schema_privilege(
       'postgres', 'extensions', 'USAGE'
     )
     OR EXISTS (
       SELECT 1
       FROM (VALUES
         ('auth.users'),
         ('auth.sessions'),
         ('auth.identities')
       ) AS managed(relation_name)
       WHERE NOT pg_catalog.has_table_privilege(
         'postgres',
         managed.relation_name,
         'SELECT'
       )
     )
     OR NOT pg_catalog.has_function_privilege(
       'postgres', 'auth.uid()', 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'postgres', 'auth.jwt()', 'EXECUTE'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc AS procedure
       JOIN pg_catalog.pg_roles AS owner
         ON owner.oid = procedure.proowner
       WHERE procedure.oid =
         'public.recompute_seller_response(uuid)'::pg_catalog.regprocedure
         AND owner.rolname = 'postgres'
     )
     OR NOT pg_catalog.has_function_privilege(
       'postgres',
       'extensions.digest(bytea,text)',
       'EXECUTE'
     )
     OR NOT pg_catalog.has_schema_privilege(
       'postgres', 'cron', 'USAGE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'postgres', 'cron.job', 'SELECT'
     )
     OR NOT pg_catalog.has_function_privilege(
       'postgres', 'cron.schedule(text,text,text)', 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'postgres', 'cron.unschedule(bigint)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'activation_operator_capability_failed'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('auth', 'users', 'id', 'uuid'),
      ('auth', 'users', 'email', NULL::text),
      ('auth', 'users', 'raw_app_meta_data', 'jsonb'),
      ('auth', 'users', 'banned_until', 'timestamp with time zone'),
      ('auth', 'sessions', 'id', 'uuid'),
      ('auth', 'sessions', 'user_id', 'uuid'),
      ('auth', 'identities', 'user_id', 'uuid'),
      ('auth', 'identities', 'provider', 'text'),
      ('public', 'profiles', 'id', 'uuid'),
      ('public', 'profiles', 'updated_at', 'timestamp with time zone'),
      ('public', 'profiles', 'response_rate', 'integer'),
      ('public', 'profiles', 'response_sample', 'integer'),
      ('public', 'profiles', 'shadow_banned', 'boolean'),
      ('public', 'profiles', 'suspension_level', 'smallint'),
      ('public', 'profiles', 'suspended_until', 'timestamp with time zone'),
      ('public', 'conversations', 'id', 'uuid'),
      ('public', 'conversations', 'buyer_id', 'uuid'),
      ('public', 'conversations', 'seller_id', 'uuid'),
      ('public', 'conversations', 'last_message_at',
        'timestamp with time zone'),
      ('public', 'messages', 'id', 'uuid'),
      ('public', 'messages', 'conversation_id', 'uuid'),
      ('public', 'messages', 'sender_id', 'uuid'),
      ('public', 'messages', 'content', 'text'),
      ('public', 'messages', 'message_type', 'public.message_type'),
      ('public', 'messages', 'is_read', 'boolean')
    ) AS expected(schema_name, table_name, column_name, formatted_type)
    LEFT JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.nspname = expected.schema_name
    LEFT JOIN pg_catalog.pg_class AS relation
      ON relation.relnamespace = namespace.oid
     AND relation.relname = expected.table_name
    LEFT JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = relation.oid
     AND attribute.attname = expected.column_name
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
    WHERE attribute.attname IS NULL
       OR (
         expected.formatted_type IS NOT NULL
         AND pg_catalog.format_type(
           attribute.atttypid,
           attribute.atttypmod
         ) <> expected.formatted_type
       )
  ) THEN
    RAISE EXCEPTION 'activation_schema_drift' USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.array_agg(trigger.tgname ORDER BY trigger.tgname)
    INTO v_actual_triggers
  FROM pg_catalog.pg_trigger AS trigger
  WHERE trigger.tgrelid = 'public.messages'::pg_catalog.regclass
    AND NOT trigger.tgisinternal;
  IF v_actual_triggers IS DISTINCT FROM v_expected_triggers THEN
    RAISE EXCEPTION 'activation_message_trigger_inventory_drift: %',
      v_actual_triggers USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.array_agg(trigger.tgname ORDER BY trigger.tgname)
    INTO v_actual_profile_triggers
  FROM pg_catalog.pg_trigger AS trigger
  WHERE trigger.tgrelid = 'public.profiles'::pg_catalog.regclass
    AND NOT trigger.tgisinternal;
  IF v_actual_profile_triggers
       IS DISTINCT FROM v_expected_profile_triggers THEN
    RAISE EXCEPTION 'activation_profile_trigger_inventory_drift: %',
      v_actual_profile_triggers USING ERRCODE = '55000';
  END IF;

  FOR v_actor, v_role IN
    SELECT actor_id, expected_role
    FROM (VALUES
      (v_actor_a, 'member-a'::text),
      (v_actor_b, 'member-b'::text),
      (v_actor_c, 'member-c'::text)
    ) AS expected(actor_id, expected_role)
  LOOP
    SELECT user_row.raw_app_meta_data, user_row.email
      INTO STRICT v_metadata, v_email
    FROM auth.users AS user_row
    WHERE user_row.id = v_actor
      AND (
        user_row.banned_until IS NULL
        OR user_row.banned_until <= pg_catalog.statement_timestamp()
      );
    IF v_metadata->'caaci_hosted_canary' IS DISTINCT FROM 'true'::jsonb
       OR v_metadata->>'caaci_dataset_lineage' <> v_lineage
       OR v_metadata->>'caaci_canary_role' <> v_role
       OR v_email IS NULL
       OR lower(v_email) !~ '^[^@[:space:]]+@[^@[:space:]]+\.invalid$'
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
         SELECT 1 FROM auth.sessions AS session
         WHERE session.user_id = v_actor
       ) THEN
      RAISE EXCEPTION 'activation_actor_boundary_failed'
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
      RAISE EXCEPTION 'activation_actor_profile_missing'
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  IF NOT EXISTS (
       SELECT 1 FROM public.conversations AS conversation
       WHERE conversation.id = v_conversation_ab
         AND ARRAY[conversation.buyer_id, conversation.seller_id]::uuid[]
             @> ARRAY[v_actor_a, v_actor_b]::uuid[]
         AND ARRAY[conversation.buyer_id, conversation.seller_id]::uuid[]
             <@ ARRAY[v_actor_a, v_actor_b]::uuid[]
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.conversations AS conversation
       WHERE conversation.id = v_conversation_ac
         AND ARRAY[conversation.buyer_id, conversation.seller_id]::uuid[]
             @> ARRAY[v_actor_a, v_actor_c]::uuid[]
         AND ARRAY[conversation.buyer_id, conversation.seller_id]::uuid[]
             <@ ARRAY[v_actor_a, v_actor_c]::uuid[]
     )
     OR EXISTS (
       SELECT 1 FROM public.conversations AS conversation
       WHERE (
         v_actor_a IN (conversation.buyer_id, conversation.seller_id)
         OR v_actor_b IN (conversation.buyer_id, conversation.seller_id)
         OR v_actor_c IN (conversation.buyer_id, conversation.seller_id)
       )
       AND conversation.id NOT IN (v_conversation_ab, v_conversation_ac)
     ) THEN
    RAISE EXCEPTION 'activation_fixture_relationship_drift'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
       SELECT 1 FROM public.conversation_archives AS archive
       WHERE archive.conversation_id IN (
         v_conversation_ab, v_conversation_ac
       )
     )
     OR EXISTS (
       SELECT 1 FROM public.messages AS message
       WHERE message.conversation_id IN (
         v_conversation_ab, v_conversation_ac
       )
         AND message.sender_id IN (v_actor_a, v_actor_b, v_actor_c)
         AND message.content ~
           '^caaci-hosted-canary-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     ) THEN
    RAISE EXCEPTION 'activation_fixture_residue_present'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'caaci-hosted-realtime-canary-ttl-v1'
  ) THEN
    RAISE EXCEPTION 'activation_cron_name_already_present'
      USING ERRCODE = '55000';
  END IF;
END
$precheck$;

SELECT
  trigger.tgname AS trigger_name,
  pg_catalog.pg_get_triggerdef(trigger.oid, true) AS trigger_definition,
  trigger.tgfoid::pg_catalog.regprocedure AS trigger_function
FROM pg_catalog.pg_trigger AS trigger
WHERE trigger.tgrelid = 'public.messages'::pg_catalog.regclass
  AND NOT trigger.tgisinternal
ORDER BY trigger.tgname;

SELECT
  trigger.tgname AS trigger_name,
  pg_catalog.pg_get_triggerdef(trigger.oid, true) AS trigger_definition,
  trigger.tgfoid::pg_catalog.regprocedure AS trigger_function
FROM pg_catalog.pg_trigger AS trigger
WHERE trigger.tgrelid = 'public.profiles'::pg_catalog.regclass
  AND NOT trigger.tgisinternal
ORDER BY trigger.tgname;

ROLLBACK;
