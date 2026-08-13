\set ON_ERROR_STOP on

-- Hosted canary protocol revision 2. The original strict base-eight RPC is
-- retained. V2 adds exactly one atomic 51-message AB batch (A=21, B=30), one
-- already-emailed system notification, one block->unblock transition per AB
-- direction, and cleanup_v2 over the complete 59-message transcript.

-- Both canonical read-only passes must succeed before any DDL.
\ir ../VERIFY_20260719164126_reconcile_managed_realtime_authorization_contract.sql
\ir PRECHECK.sql

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '30s';
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
    'caaci.activation_fixture_session_binding_sha256_base64url',
    pg_catalog.rtrim(
      pg_catalog.translate(
        pg_catalog.encode(
          extensions.digest(
            pg_catalog.convert_to(
              pg_catalog.concat_ws(
                E'\037',
                'caaci-hosted-session-fixture-v1',
                lower(:'dataset_lineage'),
                :'actor_a_id'::uuid::text,
                :'actor_b_id'::uuid::text,
                :'actor_c_id'::uuid::text
              ),
              'UTF8'
            ),
            'sha256'
          ),
          'base64'
        ),
        '+/',
        '-_'
      ),
      '='
    ),
    true
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
  );

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'caaci-hosted-realtime-canary-activation-v1',
    20260731
  )
);

DO $activation_gate$
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
  v_computed_manifest text;
  v_actor uuid;
  v_role text;
  v_metadata jsonb;
  v_email text;
  v_actual_notification_triggers text[];
  v_actual_block_triggers text[];
BEGIN
  IF v_project_ref = 'lfhvgprfphyfvhidegum' THEN
    RAISE EXCEPTION 'activation_refused_known_production_project'
      USING ERRCODE = '42501';
  END IF;
  IF v_provider_proof_expires_at
       < pg_catalog.statement_timestamp() + interval '1 hour'
     OR v_provider_proof_expires_at
       > pg_catalog.statement_timestamp() + interval '24 hours'
     OR v_max_access_token_lifetime NOT BETWEEN 300 AND 3600 THEN
    RAISE EXCEPTION 'activation_provider_proof_invalid'
      USING ERRCODE = '22023';
  END IF;

  v_computed_manifest := pg_catalog.encode(
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
  );
  IF v_computed_manifest <> v_fixture_manifest_sha256 THEN
    RAISE EXCEPTION 'activation_fixture_manifest_mismatch'
      USING ERRCODE = '22023';
  END IF;

  -- Managed Auth remains observational. Repeat its exact mutable fixture
  -- boundary inside this transaction, and let every runtime RPC revalidate it
  -- again. Public profile/conversation rows are locked until activation ends.
  LOCK TABLE
    public.conversations,
    public.notifications,
    public.blocks
  IN SHARE MODE;
  PERFORM 1
  FROM public.profiles AS profile
  WHERE profile.id IN (v_actor_a, v_actor_b, v_actor_c)
  ORDER BY profile.id
  FOR UPDATE;
  PERFORM 1
  FROM public.conversations AS conversation
  WHERE conversation.id IN (v_conversation_ab, v_conversation_ac)
  ORDER BY conversation.id
  FOR UPDATE;

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
    IF v_metadata->'caaci_hosted_canary'
         IS DISTINCT FROM 'true'::jsonb
       OR v_metadata->>'caaci_dataset_lineage' IS DISTINCT FROM v_lineage
       OR v_metadata->>'caaci_canary_role' IS DISTINCT FROM v_role
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
         SELECT 1
         FROM auth.sessions AS session
         WHERE session.user_id = v_actor
       )
       OR NOT EXISTS (
         SELECT 1
         FROM public.profiles AS profile
         WHERE profile.id = v_actor
           AND NOT profile.shadow_banned
           AND profile.suspension_level = 0
           AND profile.suspended_until IS NULL
       ) THEN
      RAISE EXCEPTION 'activation_actor_boundary_changed_after_precheck'
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  SELECT pg_catalog.array_agg(trigger.tgname ORDER BY trigger.tgname)
    INTO v_actual_notification_triggers
  FROM pg_catalog.pg_trigger AS trigger
  WHERE trigger.tgrelid = 'public.notifications'::pg_catalog.regclass
    AND NOT trigger.tgisinternal;
  IF v_actual_notification_triggers IS DISTINCT FROM
       ARRAY['attach_notification_conversation']::text[] THEN
    RAISE EXCEPTION 'activation_notification_trigger_inventory_drift: %',
      v_actual_notification_triggers USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.array_agg(trigger.tgname ORDER BY trigger.tgname)
    INTO v_actual_block_triggers
  FROM pg_catalog.pg_trigger AS trigger
  WHERE trigger.tgrelid = 'public.blocks'::pg_catalog.regclass
    AND NOT trigger.tgisinternal;
  IF v_actual_block_triggers IS DISTINCT FROM
       ARRAY['trg_serialize_block_pair_change']::text[] THEN
    RAISE EXCEPTION 'activation_block_trigger_inventory_drift: %',
      v_actual_block_triggers USING ERRCODE = '55000';
  END IF;

  IF (
       SELECT pg_catalog.count(*)
       FROM public.conversations AS conversation
       WHERE conversation.id IN (v_conversation_ab, v_conversation_ac)
     ) <> 2
     OR NOT EXISTS (
       SELECT 1
       FROM public.conversations AS conversation
       WHERE conversation.id = v_conversation_ab
         AND ARRAY[conversation.buyer_id, conversation.seller_id]::uuid[]
             @> ARRAY[v_actor_a, v_actor_b]::uuid[]
         AND ARRAY[conversation.buyer_id, conversation.seller_id]::uuid[]
             <@ ARRAY[v_actor_a, v_actor_b]::uuid[]
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.conversations AS conversation
       WHERE conversation.id = v_conversation_ac
         AND ARRAY[conversation.buyer_id, conversation.seller_id]::uuid[]
             @> ARRAY[v_actor_a, v_actor_c]::uuid[]
         AND ARRAY[conversation.buyer_id, conversation.seller_id]::uuid[]
             <@ ARRAY[v_actor_a, v_actor_c]::uuid[]
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
           v_conversation_ab,
           v_conversation_ac
         )
     )
     OR EXISTS (
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
     )
     OR EXISTS (
       SELECT 1 FROM public.notifications AS notification
       WHERE notification.user_id = v_actor_a
         AND notification.conversation_id = v_conversation_ab
         AND notification.type = 'system'
         AND notification.body ~
           '^caaci-hosted-notification-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     )
     OR EXISTS (
       SELECT 1 FROM public.blocks AS block_relation
       WHERE (block_relation.blocker_id = v_actor_a
              AND block_relation.blocked_id = v_actor_b)
          OR (block_relation.blocker_id = v_actor_b
              AND block_relation.blocked_id = v_actor_a)
     ) THEN
    RAISE EXCEPTION 'activation_fixture_changed_after_precheck'
      USING ERRCODE = '55000';
  END IF;
END
$activation_gate$;

DO $executor_role$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'caaci_hosted_realtime_executor'
  ) THEN
    RAISE EXCEPTION 'activation_executor_role_already_exists'
      USING ERRCODE = '55000';
  END IF;
  CREATE ROLE caaci_hosted_realtime_executor
    NOLOGIN
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE
    NOINHERIT
    NOREPLICATION
    NOBYPASSRLS;
END
$executor_role$;

-- PostgreSQL 16 gives a non-superuser CREATEROLE operator one automatic,
-- non-inherited ADMIN grant with SET disabled. Add a separate non-inherited
-- SET path; retain both paths until DROP ROLE removes them during rollback.
GRANT caaci_hosted_realtime_executor TO postgres
  WITH INHERIT FALSE, SET TRUE;

DO $executor_membership$
BEGIN
  IF (
       SELECT pg_catalog.count(*)
       FROM pg_catalog.pg_auth_members AS membership
       WHERE membership.roleid =
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
     ) <> 2
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
     OR pg_catalog.pg_has_role(
       'postgres', 'caaci_hosted_realtime_executor', 'USAGE'
     )
     OR NOT pg_catalog.pg_has_role(
       'postgres', 'caaci_hosted_realtime_executor', 'SET'
     ) THEN
    RAISE EXCEPTION 'activation_executor_membership_failed'
      USING ERRCODE = '42501';
  END IF;
END
$executor_membership$;

-- ALTER OWNER requires the target owner to have CREATE on the containing
-- schema. These grants are revoked after the final ownership transfer.
GRANT USAGE, CREATE ON SCHEMA public, private
  TO caaci_hosted_realtime_executor;

CREATE TABLE private.hosted_realtime_canary_environment_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  sentinel_id uuid NOT NULL UNIQUE,
  project_ref text NOT NULL UNIQUE
    CHECK (project_ref ~ '^[a-z0-9]{20}$'),
  dataset_lineage text NOT NULL UNIQUE
    CHECK (dataset_lineage ~ '^[a-z0-9][a-z0-9._-]{7,79}$'),
  fixture_manifest_sha256 text NOT NULL
    CHECK (fixture_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  fixture_session_binding_sha256_base64url text NOT NULL UNIQUE
    CHECK (
      fixture_session_binding_sha256_base64url ~
        '^[0-9A-Za-z_-]{43}$'
    ),
  fixture_revision integer NOT NULL CHECK (fixture_revision > 0),
  protocol_revision integer NOT NULL DEFAULT 2 CHECK (protocol_revision = 2),
  actor_a_id uuid NOT NULL,
  actor_b_id uuid NOT NULL,
  actor_c_id uuid NOT NULL,
  conversation_ab_id uuid NOT NULL,
  conversation_ac_id uuid NOT NULL,
  baseline_ab_last_message_at timestamptz,
  baseline_ac_last_message_at timestamptz,
  synthetic_only boolean NOT NULL DEFAULT true CHECK (synthetic_only),
  disposable boolean NOT NULL DEFAULT true CHECK (disposable),
  provider_side_effects_disabled boolean NOT NULL DEFAULT true
    CHECK (provider_side_effects_disabled),
  write_cleanup_supported boolean NOT NULL DEFAULT true
    CHECK (write_cleanup_supported),
  provider_disable_proof_sha256 text NOT NULL
    CHECK (provider_disable_proof_sha256 ~ '^[0-9a-f]{64}$'),
  provider_proof_expires_at timestamptz NOT NULL,
  max_access_token_lifetime_seconds integer NOT NULL
    CHECK (max_access_token_lifetime_seconds BETWEEN 300 AND 3600),
  approval_reference text NOT NULL
    CHECK (
      pg_catalog.length(approval_reference) BETWEEN 8 AND 200
      AND approval_reference !~ '[[:cntrl:]]'
    ),
  admission_open boolean NOT NULL DEFAULT true,
  session_quarantine_until timestamptz,
  ttl_job_id bigint UNIQUE,
  last_ttl_heartbeat_at timestamptz,
  activated_at timestamptz NOT NULL
    DEFAULT pg_catalog.statement_timestamp(),
  expires_at timestamptz NOT NULL,
  CHECK (actor_a_id <> actor_b_id),
  CHECK (actor_a_id <> actor_c_id),
  CHECK (actor_b_id <> actor_c_id),
  CHECK (conversation_ab_id <> conversation_ac_id),
  CHECK (expires_at > activated_at + interval '1 hour'),
  CHECK (expires_at <= activated_at + interval '7 days')
);

CREATE TABLE private.hosted_realtime_canary_runs (
  run_id uuid PRIMARY KEY,
  sentinel_id uuid NOT NULL REFERENCES
    private.hosted_realtime_canary_environment_config(sentinel_id)
    ON DELETE RESTRICT,
  coordinator_id uuid NOT NULL,
  coordinator_session_id uuid NOT NULL,
  status text NOT NULL CHECK (
    status IN ('active', 'cleaned', 'recovered', 'recovery_required',
      'quarantined')
  ),
  started_at timestamptz NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  cleanup_started_at timestamptz,
  cleaned_at timestamptz,
  cleanup_reason text CHECK (
    cleanup_reason IS NULL
    OR cleanup_reason IN ('normal', 'ttl', 'manual')
  ),
  attempted_count integer NOT NULL DEFAULT 0 CHECK (attempted_count >= 0),
  inserted_count integer NOT NULL DEFAULT 0 CHECK (inserted_count >= 0),
  deleted_count integer NOT NULL DEFAULT 0 CHECK (deleted_count >= 0),
  last_cleanup_sqlstate text,
  recovery_proof_sha256 text CHECK (
    recovery_proof_sha256 IS NULL
    OR recovery_proof_sha256 ~ '^[0-9a-f]{64}$'
  ),
  recovery_completed_at timestamptz,
  recovery_approval_reference text CHECK (
    recovery_approval_reference IS NULL
    OR (
      pg_catalog.length(recovery_approval_reference) BETWEEN 8 AND 200
      AND recovery_approval_reference !~ '[[:cntrl:]]'
    )
  ),
  CHECK (lease_expires_at > started_at),
  CHECK (lease_expires_at <= started_at + interval '1 hour')
);

CREATE UNIQUE INDEX hosted_realtime_canary_one_active_run
  ON private.hosted_realtime_canary_runs ((status))
  WHERE status = 'active';

CREATE INDEX hosted_realtime_canary_runs_lease_idx
  ON private.hosted_realtime_canary_runs (lease_expires_at, run_id)
  WHERE status = 'active';

CREATE TABLE private.hosted_realtime_canary_writes (
  message_id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES private.hosted_realtime_canary_runs(run_id)
    ON DELETE RESTRICT,
  actor_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  marker text NOT NULL,
  write_class text NOT NULL CHECK (write_class IN ('base', 'scale')),
  batch_ordinal integer,
  expected_created_at timestamptz NOT NULL,
  registered_at timestamptz NOT NULL
    DEFAULT pg_catalog.statement_timestamp(),
  inserted_at timestamptz,
  deleted_at timestamptz,
  CHECK (marker = 'caaci-hosted-canary-' || message_id::text),
  CHECK (
    (write_class = 'base' AND batch_ordinal IS NULL)
    OR (write_class = 'scale' AND batch_ordinal BETWEEN 1 AND 51)
  )
);

CREATE INDEX hosted_realtime_canary_writes_run_idx
  ON private.hosted_realtime_canary_writes (run_id, message_id);

CREATE UNIQUE INDEX hosted_realtime_canary_scale_ordinal_idx
  ON private.hosted_realtime_canary_writes (run_id, batch_ordinal)
  WHERE write_class = 'scale';

CREATE TABLE private.hosted_realtime_canary_notifications (
  notification_id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES private.hosted_realtime_canary_runs(run_id)
    ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  marker text NOT NULL,
  expected_created_at timestamptz NOT NULL,
  expected_emailed_at timestamptz NOT NULL,
  inserted_at timestamptz,
  deleted_at timestamptz,
  CHECK (
    marker = 'caaci-hosted-notification-' || notification_id::text
  )
);

CREATE UNIQUE INDEX hosted_realtime_canary_notifications_run_idx
  ON private.hosted_realtime_canary_notifications (run_id);

CREATE TABLE private.hosted_realtime_canary_block_transitions (
  run_id uuid NOT NULL REFERENCES private.hosted_realtime_canary_runs(run_id)
    ON DELETE RESTRICT,
  blocker_id uuid NOT NULL,
  blocked_id uuid NOT NULL,
  transition_ordinal integer NOT NULL CHECK (
    transition_ordinal IN (1, 2)
  ),
  blocked boolean NOT NULL,
  applied_at timestamptz,
  PRIMARY KEY (run_id, blocker_id, transition_ordinal),
  UNIQUE (run_id, blocker_id, blocked_id, blocked),
  CHECK (blocker_id <> blocked_id),
  CHECK (
    (transition_ordinal = 1 AND blocked)
    OR (transition_ordinal = 2 AND NOT blocked)
  )
);

CREATE TABLE private.hosted_realtime_canary_profile_baselines (
  profile_id uuid PRIMARY KEY,
  updated_at timestamptz NOT NULL,
  response_rate integer NOT NULL,
  response_sample integer NOT NULL
);

-- Seed the immutable baseline while the installation operator still owns both
-- the new private tables and the existing public fixture tables. Once private
-- FORCE RLS and fixture-scoped public policies are active, this bootstrap read
-- would intentionally no longer have a circular path through an empty config.
INSERT INTO private.hosted_realtime_canary_environment_config (
  sentinel_id,
  project_ref,
  dataset_lineage,
  fixture_manifest_sha256,
  fixture_session_binding_sha256_base64url,
  fixture_revision,
  actor_a_id,
  actor_b_id,
  actor_c_id,
  conversation_ab_id,
  conversation_ac_id,
  baseline_ab_last_message_at,
  baseline_ac_last_message_at,
  provider_disable_proof_sha256,
  provider_proof_expires_at,
  max_access_token_lifetime_seconds,
  approval_reference,
  expires_at
)
SELECT
  :'sentinel_id'::uuid,
  lower(:'project_ref'),
  lower(:'dataset_lineage'),
  lower(:'fixture_manifest_sha256'),
  pg_catalog.current_setting(
    'caaci.activation_fixture_session_binding_sha256_base64url'
  ),
  :'fixture_revision'::integer,
  :'actor_a_id'::uuid,
  :'actor_b_id'::uuid,
  :'actor_c_id'::uuid,
  :'conversation_ab_id'::uuid,
  :'conversation_ac_id'::uuid,
  ab.last_message_at,
  ac.last_message_at,
  lower(:'provider_disable_proof_sha256'),
  :'provider_proof_expires_at'::timestamptz,
  :'max_access_token_lifetime_seconds'::integer,
  :'approval_reference',
  pg_catalog.statement_timestamp() + interval '72 hours'
FROM public.conversations AS ab
CROSS JOIN public.conversations AS ac
WHERE ab.id = :'conversation_ab_id'::uuid
  AND ac.id = :'conversation_ac_id'::uuid;

INSERT INTO private.hosted_realtime_canary_profile_baselines (
  profile_id,
  updated_at,
  response_rate,
  response_sample
)
SELECT
  profile.id,
  profile.updated_at,
  profile.response_rate,
  profile.response_sample
FROM public.profiles AS profile
WHERE profile.id IN (
  :'actor_a_id'::uuid,
  :'actor_b_id'::uuid,
  :'actor_c_id'::uuid
)
ORDER BY profile.id;

ALTER TABLE private.hosted_realtime_canary_environment_config
  OWNER TO caaci_hosted_realtime_executor;
ALTER TABLE private.hosted_realtime_canary_runs
  OWNER TO caaci_hosted_realtime_executor;
ALTER TABLE private.hosted_realtime_canary_writes
  OWNER TO caaci_hosted_realtime_executor;
ALTER TABLE private.hosted_realtime_canary_notifications
  OWNER TO caaci_hosted_realtime_executor;
ALTER TABLE private.hosted_realtime_canary_block_transitions
  OWNER TO caaci_hosted_realtime_executor;
ALTER TABLE private.hosted_realtime_canary_profile_baselines
  OWNER TO caaci_hosted_realtime_executor;

SET LOCAL ROLE caaci_hosted_realtime_executor;

ALTER TABLE private.hosted_realtime_canary_environment_config
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.hosted_realtime_canary_environment_config
  FORCE ROW LEVEL SECURITY;
ALTER TABLE private.hosted_realtime_canary_runs
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.hosted_realtime_canary_runs
  FORCE ROW LEVEL SECURITY;
ALTER TABLE private.hosted_realtime_canary_writes
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.hosted_realtime_canary_writes
  FORCE ROW LEVEL SECURITY;
ALTER TABLE private.hosted_realtime_canary_notifications
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.hosted_realtime_canary_notifications
  FORCE ROW LEVEL SECURITY;
ALTER TABLE private.hosted_realtime_canary_block_transitions
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.hosted_realtime_canary_block_transitions
  FORCE ROW LEVEL SECURITY;
ALTER TABLE private.hosted_realtime_canary_profile_baselines
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.hosted_realtime_canary_profile_baselines
  FORCE ROW LEVEL SECURITY;

CREATE POLICY hosted_realtime_canary_executor_config
  ON private.hosted_realtime_canary_environment_config
  FOR ALL TO caaci_hosted_realtime_executor
  USING (true) WITH CHECK (true);
CREATE POLICY hosted_realtime_canary_executor_runs
  ON private.hosted_realtime_canary_runs
  FOR ALL TO caaci_hosted_realtime_executor
  USING (true) WITH CHECK (true);
CREATE POLICY hosted_realtime_canary_executor_writes
  ON private.hosted_realtime_canary_writes
  FOR ALL TO caaci_hosted_realtime_executor
  USING (true) WITH CHECK (true);
CREATE POLICY hosted_realtime_canary_executor_notifications
  ON private.hosted_realtime_canary_notifications
  FOR ALL TO caaci_hosted_realtime_executor
  USING (true) WITH CHECK (true);
CREATE POLICY hosted_realtime_canary_executor_block_transitions
  ON private.hosted_realtime_canary_block_transitions
  FOR ALL TO caaci_hosted_realtime_executor
  USING (true) WITH CHECK (true);
CREATE POLICY hosted_realtime_canary_executor_profile_baselines
  ON private.hosted_realtime_canary_profile_baselines
  FOR ALL TO caaci_hosted_realtime_executor
  USING (true) WITH CHECK (true);

RESET ROLE;

CREATE POLICY hosted_realtime_canary_executor_profile_authorization
  ON public.profiles
  FOR SELECT
  TO caaci_hosted_realtime_executor
  USING (
    id IN (
      SELECT config.actor_a_id
      FROM private.hosted_realtime_canary_environment_config AS config
      WHERE config.singleton
      UNION ALL
      SELECT config.actor_b_id
      FROM private.hosted_realtime_canary_environment_config AS config
      WHERE config.singleton
      UNION ALL
      SELECT config.actor_c_id
      FROM private.hosted_realtime_canary_environment_config AS config
      WHERE config.singleton
    )
  );
CREATE POLICY hosted_realtime_canary_executor_conversation_observation
  ON public.conversations
  FOR SELECT
  TO caaci_hosted_realtime_executor
  USING (
    id IN (
      SELECT config.conversation_ab_id
      FROM private.hosted_realtime_canary_environment_config AS config
      WHERE config.singleton
      UNION ALL
      SELECT config.conversation_ac_id
      FROM private.hosted_realtime_canary_environment_config AS config
      WHERE config.singleton
    )
  );
CREATE POLICY hosted_realtime_canary_executor_message_observation
  ON public.messages
  FOR SELECT
  TO caaci_hosted_realtime_executor
  USING (
    EXISTS (
      SELECT 1
      FROM private.hosted_realtime_canary_writes AS write
      WHERE write.message_id = messages.id
    )
    OR EXISTS (
      SELECT 1
      FROM private.hosted_realtime_canary_environment_config AS config
      WHERE config.singleton
        AND messages.conversation_id IN (
          config.conversation_ab_id,
          config.conversation_ac_id
        )
        AND messages.sender_id IN (
          config.actor_a_id,
          config.actor_b_id,
          config.actor_c_id
        )
        AND messages.content ~
          '^caaci-hosted-canary-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
  );
CREATE POLICY hosted_realtime_canary_executor_archive_observation
  ON public.conversation_archives
  FOR SELECT
  TO caaci_hosted_realtime_executor
  USING (
    conversation_id IN (
      SELECT config.conversation_ab_id
      FROM private.hosted_realtime_canary_environment_config AS config
      WHERE config.singleton
      UNION ALL
      SELECT config.conversation_ac_id
      FROM private.hosted_realtime_canary_environment_config AS config
      WHERE config.singleton
    )
  );
CREATE POLICY hosted_realtime_canary_executor_notification_observation
  ON public.notifications
  FOR SELECT
  TO caaci_hosted_realtime_executor
  USING (
    EXISTS (
      SELECT 1
      FROM private.hosted_realtime_canary_environment_config AS config
      WHERE config.singleton
        AND notifications.conversation_id IN (
          config.conversation_ab_id,
          config.conversation_ac_id
        )
        AND notifications.user_id IN (
          config.actor_a_id,
          config.actor_b_id,
          config.actor_c_id
        )
        AND notifications.created_at >= config.activated_at
    )
  );
CREATE POLICY hosted_realtime_canary_executor_notification_insert
  ON public.notifications
  FOR INSERT
  TO caaci_hosted_realtime_executor
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM private.hosted_realtime_canary_notifications AS ledger
      JOIN private.hosted_realtime_canary_runs AS run
        ON run.run_id = ledger.run_id
      WHERE ledger.notification_id = notifications.id
        AND ledger.user_id = notifications.user_id
        AND ledger.conversation_id = notifications.conversation_id
        AND ledger.marker = notifications.body
        AND ledger.expected_created_at = notifications.created_at
        AND ledger.expected_emailed_at = notifications.emailed_at
        AND run.status = 'active'
        AND ledger.run_id::text = pg_catalog.current_setting(
          'caaci.hosted_canary_notification_insert_run_id',
          true
        )
    )
  );
CREATE POLICY hosted_realtime_canary_executor_notification_delete
  ON public.notifications
  FOR DELETE
  TO caaci_hosted_realtime_executor
  USING (
    EXISTS (
      SELECT 1
      FROM private.hosted_realtime_canary_notifications AS ledger
      JOIN private.hosted_realtime_canary_runs AS run
        ON run.run_id = ledger.run_id
      WHERE ledger.notification_id = notifications.id
        AND ledger.user_id = notifications.user_id
        AND ledger.conversation_id = notifications.conversation_id
        AND ledger.marker = notifications.body
        AND run.status IN ('active', 'quarantined')
        AND ledger.run_id::text = pg_catalog.current_setting(
          'caaci.hosted_canary_cleanup_run_id',
          true
        )
    )
  );
CREATE POLICY hosted_realtime_canary_executor_block_observation
  ON public.blocks
  FOR SELECT
  TO caaci_hosted_realtime_executor
  USING (
    EXISTS (
      SELECT 1
      FROM private.hosted_realtime_canary_environment_config AS config
      WHERE config.singleton
        AND (
          (blocks.blocker_id = config.actor_a_id
           AND blocks.blocked_id = config.actor_b_id)
          OR (blocks.blocker_id = config.actor_b_id
              AND blocks.blocked_id = config.actor_a_id)
        )
    )
  );
CREATE POLICY hosted_realtime_canary_executor_block_insert
  ON public.blocks
  FOR INSERT
  TO caaci_hosted_realtime_executor
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM private.hosted_realtime_canary_block_transitions AS transition
      JOIN private.hosted_realtime_canary_runs AS run
        ON run.run_id = transition.run_id
      WHERE transition.blocker_id = blocks.blocker_id
        AND transition.blocked_id = blocks.blocked_id
        AND transition.blocked
        AND transition.applied_at IS NULL
        AND run.status = 'active'
        AND transition.run_id::text = pg_catalog.current_setting(
          'caaci.hosted_canary_block_run_id', true
        )
    )
  );
CREATE POLICY hosted_realtime_canary_executor_block_delete
  ON public.blocks
  FOR DELETE
  TO caaci_hosted_realtime_executor
  USING (
    EXISTS (
      SELECT 1
      FROM private.hosted_realtime_canary_block_transitions AS transition
      JOIN private.hosted_realtime_canary_runs AS run
        ON run.run_id = transition.run_id
      WHERE transition.blocker_id = blocks.blocker_id
        AND transition.blocked_id = blocks.blocked_id
        AND run.status IN ('active', 'quarantined')
        AND (
          (
            NOT transition.blocked
            AND transition.applied_at IS NULL
            AND transition.run_id::text = pg_catalog.current_setting(
              'caaci.hosted_canary_block_run_id', true
            )
          )
          OR transition.run_id::text = pg_catalog.current_setting(
            'caaci.hosted_canary_cleanup_run_id', true
          )
        )
    )
  );

SET LOCAL ROLE caaci_hosted_realtime_executor;

REVOKE ALL ON TABLE
  private.hosted_realtime_canary_environment_config,
  private.hosted_realtime_canary_runs,
  private.hosted_realtime_canary_writes,
  private.hosted_realtime_canary_notifications,
  private.hosted_realtime_canary_block_transitions,
  private.hosted_realtime_canary_profile_baselines
FROM PUBLIC, anon, authenticated, service_role;

RESET ROLE;

GRANT USAGE ON SCHEMA public, private
  TO caaci_hosted_realtime_executor;
GRANT SELECT ON TABLE
  public.profiles,
  public.conversations,
  public.messages,
  public.blocks,
  public.conversation_archives,
  public.notifications
TO caaci_hosted_realtime_executor;
GRANT INSERT (id, conversation_id, sender_id, content, message_type, created_at)
  ON TABLE public.messages TO caaci_hosted_realtime_executor;
GRANT DELETE ON TABLE public.messages
  TO caaci_hosted_realtime_executor;
GRANT UPDATE (last_message_at) ON TABLE public.conversations
  TO caaci_hosted_realtime_executor;
GRANT INSERT (blocker_id, blocked_id), DELETE
  ON TABLE public.blocks TO caaci_hosted_realtime_executor;
GRANT INSERT (
  id, user_id, type, title, body, conversation_id, is_read,
  created_at, emailed_at
), DELETE ON TABLE public.notifications
  TO caaci_hosted_realtime_executor;
GRANT EXECUTE ON FUNCTION public.recompute_seller_response(uuid)
  TO caaci_hosted_realtime_executor;

-- The hosted postgres operator can read managed Auth but cannot delegate
-- auth-schema USAGE. Keep that boundary permanent: the NOLOGIN executor sees
-- only a validated synthetic request context and an aggregate fixture-session
-- count, never managed Auth rows, email addresses, metadata, or tokens.
CREATE FUNCTION
  private.hosted_realtime_canary_auth_context(
    p_project_ref text,
    p_dataset_lineage text
  )
RETURNS TABLE(actor_id uuid, session_id uuid, canary_role text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_jwt jsonb;
  v_actor uuid;
  v_session uuid;
  v_role text;
BEGIN
  IF p_project_ref IS NULL
     OR p_project_ref !~ '^[a-z0-9]{20}$'
     OR p_project_ref = 'lfhvgprfphyfvhidegum'
     OR p_dataset_lineage IS NULL
     OR p_dataset_lineage !~ '^[a-z0-9][a-z0-9._-]{7,79}$' THEN
    RETURN;
  END IF;

  BEGIN
    v_jwt := auth.jwt();
    v_actor := auth.uid();
    v_session := nullif(v_jwt->>'session_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN;
  END;
  v_role := v_jwt->'app_metadata'->>'caaci_canary_role';

  IF v_actor IS NULL
     OR v_session IS NULL
     OR v_role NOT IN ('member-a', 'member-b', 'member-c')
     OR v_jwt->>'sub' IS DISTINCT FROM v_actor::text
     OR v_jwt->>'aud' IS DISTINCT FROM 'authenticated'
     OR v_jwt->>'iss' IS DISTINCT FROM
          'https://' || p_project_ref || '.supabase.co/auth/v1'
     OR (CASE
          WHEN v_jwt->>'exp' ~ '^[0-9]{10,12}$' THEN
            (v_jwt->>'exp')::bigint <=
              extract(epoch FROM pg_catalog.statement_timestamp())::bigint
          ELSE true
        END)
     OR v_jwt->'app_metadata'->'caaci_hosted_canary'
          IS DISTINCT FROM 'true'::jsonb
     OR v_jwt->'app_metadata'->>'caaci_dataset_lineage'
          IS DISTINCT FROM p_dataset_lineage
     OR NOT EXISTS (
       SELECT 1
       FROM auth.users AS user_row
       WHERE user_row.id = v_actor
         AND (
           user_row.banned_until IS NULL
           OR user_row.banned_until <= pg_catalog.statement_timestamp()
         )
         AND user_row.raw_app_meta_data->'caaci_hosted_canary'
           IS NOT DISTINCT FROM 'true'::jsonb
         AND user_row.raw_app_meta_data->>'caaci_dataset_lineage'
           IS NOT DISTINCT FROM p_dataset_lineage
         AND user_row.raw_app_meta_data->>'caaci_canary_role'
           IS NOT DISTINCT FROM v_role
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
     OR NOT EXISTS (
       SELECT 1
       FROM auth.sessions AS session
       WHERE session.id = v_session
         AND session.user_id = v_actor
     ) THEN
    RETURN;
  END IF;

  RETURN QUERY SELECT v_actor, v_session, v_role;
END
$function$;

REVOKE ALL ON FUNCTION
  private.hosted_realtime_canary_auth_context(text, text)
FROM PUBLIC, anon, authenticated, service_role,
  caaci_hosted_realtime_executor;
GRANT EXECUTE ON FUNCTION
  private.hosted_realtime_canary_auth_context(text, text)
TO caaci_hosted_realtime_executor;
ALTER FUNCTION private.hosted_realtime_canary_auth_context(text, text)
  OWNER TO postgres;

CREATE FUNCTION
  private.hosted_realtime_canary_fixture_session_count(
    p_actor_a uuid,
    p_actor_b uuid,
    p_actor_c uuid,
    p_dataset_lineage text
  )
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_fixture_binding constant text := pg_catalog.current_setting(
    'application_name'
  );
  v_count integer;
BEGIN
  IF p_actor_a IS NULL
     OR p_actor_b IS NULL
     OR p_actor_c IS NULL
     OR p_dataset_lineage IS NULL
     OR p_dataset_lineage !~ '^[a-z0-9][a-z0-9._-]{7,79}$'
     OR v_fixture_binding !~ '^[0-9A-Za-z_-]{43}$'
     OR v_fixture_binding IS DISTINCT FROM pg_catalog.rtrim(
       pg_catalog.translate(
         pg_catalog.encode(
           extensions.digest(
             pg_catalog.convert_to(
               pg_catalog.concat_ws(
                 E'\037',
                 'caaci-hosted-session-fixture-v1',
                 p_dataset_lineage,
                 p_actor_a::text,
                 p_actor_b::text,
                 p_actor_c::text
               ),
               'UTF8'
             ),
             'sha256'
           ),
           'base64'
         ),
         '+/',
         '-_'
       ),
       '='
     )
     OR pg_catalog.cardinality(ARRAY[
       p_actor_a, p_actor_b, p_actor_c
     ]::uuid[]) <> (
       SELECT pg_catalog.count(DISTINCT actor)
       FROM pg_catalog.unnest(ARRAY[
         p_actor_a, p_actor_b, p_actor_c
       ]::uuid[]) AS actor
     ) THEN
    RAISE EXCEPTION 'hosted_realtime_canary_fixture_actor_invalid'
      USING ERRCODE = '22023';
  END IF;

  IF (
       SELECT pg_catalog.count(*)
       FROM (VALUES
         (p_actor_a, 'member-a'),
         (p_actor_b, 'member-b'),
         (p_actor_c, 'member-c')
       ) AS expected(actor_id, canary_role)
       JOIN auth.users AS user_row ON user_row.id = expected.actor_id
       WHERE user_row.raw_app_meta_data->'caaci_hosted_canary'
               IS NOT DISTINCT FROM 'true'::jsonb
         AND user_row.raw_app_meta_data->>'caaci_dataset_lineage'
               IS NOT DISTINCT FROM p_dataset_lineage
         AND user_row.raw_app_meta_data->>'caaci_canary_role'
               IS NOT DISTINCT FROM expected.canary_role
         AND lower(user_row.email) ~
               '^[^@[:space:]]+@[^@[:space:]]+\.invalid$'
         AND (
           SELECT pg_catalog.count(*)
           FROM auth.identities AS identity
           WHERE identity.user_id = expected.actor_id
             AND identity.provider = 'email'
         ) = 1
         AND NOT EXISTS (
           SELECT 1
           FROM auth.identities AS identity
           WHERE identity.user_id = expected.actor_id
             AND identity.provider <> 'email'
         )
     ) <> 3 THEN
    RAISE EXCEPTION 'hosted_realtime_canary_fixture_contract_invalid'
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.count(*)::integer INTO v_count
  FROM auth.sessions AS session
  WHERE session.user_id IN (p_actor_a, p_actor_b, p_actor_c);
  RETURN v_count;
END
$function$;

REVOKE ALL ON FUNCTION
  private.hosted_realtime_canary_fixture_session_count(uuid, uuid, uuid, text)
FROM PUBLIC, anon, authenticated, service_role,
  caaci_hosted_realtime_executor;
GRANT EXECUTE ON FUNCTION
  private.hosted_realtime_canary_fixture_session_count(uuid, uuid, uuid, text)
TO caaci_hosted_realtime_executor;
ALTER FUNCTION
  private.hosted_realtime_canary_fixture_session_count(uuid, uuid, uuid, text)
  OWNER TO postgres;
SELECT pg_catalog.set_config(
  'caaci.activation_previous_application_name',
  pg_catalog.current_setting('application_name'),
  true
);
SELECT pg_catalog.set_config(
  'application_name',
  pg_catalog.current_setting(
    'caaci.activation_fixture_session_binding_sha256_base64url'
  ),
  true
);
ALTER FUNCTION
  private.hosted_realtime_canary_fixture_session_count(uuid, uuid, uuid, text)
  SET application_name FROM CURRENT;
SELECT pg_catalog.set_config(
  'application_name',
  pg_catalog.current_setting(
    'caaci.activation_previous_application_name'
  ),
  true
);

CREATE FUNCTION private.hosted_realtime_canary_residue_count(
  p_ignore_auth_sessions boolean
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_config private.hosted_realtime_canary_environment_config%ROWTYPE;
  v_count integer := 0;
  v_has_active boolean := false;
BEGIN
  SELECT config.* INTO STRICT v_config
  FROM private.hosted_realtime_canary_environment_config AS config
  WHERE config.singleton;

  SELECT EXISTS (
    SELECT 1
    FROM private.hosted_realtime_canary_runs AS run
    WHERE run.status = 'active'
  ) INTO v_has_active;

  SELECT v_count + pg_catalog.count(*)::integer INTO v_count
  FROM private.hosted_realtime_canary_runs AS run
  WHERE run.status IN ('active', 'recovery_required', 'quarantined');

  SELECT v_count + pg_catalog.count(*)::integer INTO v_count
  FROM private.hosted_realtime_canary_writes AS write
  LEFT JOIN public.messages AS message ON message.id = write.message_id
  WHERE write.deleted_at IS NULL
     OR (
       message.id IS NOT NULL
       AND (
         message.conversation_id <> write.conversation_id
         OR message.sender_id <> write.actor_id
         OR message.content <> write.marker
         OR message.message_type::text <> 'text'
         OR message.is_read IS DISTINCT FROM false
         OR message.created_at IS DISTINCT FROM write.expected_created_at
       )
     );

  SELECT v_count + pg_catalog.count(*)::integer INTO v_count
  FROM private.hosted_realtime_canary_notifications AS ledger
  LEFT JOIN public.notifications AS notification
    ON notification.id = ledger.notification_id
  WHERE ledger.deleted_at IS NULL
     OR (
       notification.id IS NOT NULL
       AND (
         notification.user_id <> ledger.user_id
         OR notification.conversation_id <> ledger.conversation_id
         OR notification.type <> 'system'
         OR notification.title <> 'CAACI hosted Realtime canary'
         OR notification.body <> ledger.marker
         OR notification.is_read IS DISTINCT FROM false
         OR notification.created_at IS DISTINCT FROM
              ledger.expected_created_at
         OR notification.emailed_at IS DISTINCT FROM
              ledger.expected_emailed_at
       )
     );

  SELECT v_count + pg_catalog.count(*)::integer INTO v_count
  FROM public.messages AS message
  WHERE message.conversation_id IN (
    v_config.conversation_ab_id,
    v_config.conversation_ac_id
  )
    AND message.sender_id IN (
      v_config.actor_a_id,
      v_config.actor_b_id,
      v_config.actor_c_id
    )
    AND message.content ~
      '^caaci-hosted-canary-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND NOT EXISTS (
      SELECT 1
      FROM private.hosted_realtime_canary_writes AS write
      WHERE write.message_id = message.id
        AND write.run_id IN (
          SELECT run.run_id
          FROM private.hosted_realtime_canary_runs AS run
          WHERE run.status = 'active'
        )
    );

  SELECT v_count + pg_catalog.count(*)::integer INTO v_count
  FROM public.notifications AS notification
  WHERE notification.user_id = v_config.actor_a_id
    AND notification.conversation_id = v_config.conversation_ab_id
    AND notification.type = 'system'
    AND notification.body ~
      '^caaci-hosted-notification-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND NOT EXISTS (
      SELECT 1
      FROM private.hosted_realtime_canary_notifications AS ledger
      WHERE ledger.notification_id = notification.id
        AND ledger.run_id IN (
          SELECT run.run_id
          FROM private.hosted_realtime_canary_runs AS run
          WHERE run.status = 'active'
        )
    );

  SELECT v_count + pg_catalog.count(*)::integer INTO v_count
  FROM public.blocks AS block_relation
  WHERE (
      (block_relation.blocker_id = v_config.actor_a_id
       AND block_relation.blocked_id = v_config.actor_b_id)
      OR (block_relation.blocker_id = v_config.actor_b_id
          AND block_relation.blocked_id = v_config.actor_a_id)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM private.hosted_realtime_canary_block_transitions AS transition
      JOIN private.hosted_realtime_canary_runs AS run
        ON run.run_id = transition.run_id
      WHERE run.status = 'active'
        AND transition.blocker_id = block_relation.blocker_id
        AND transition.blocked_id = block_relation.blocked_id
        AND transition.blocked
        AND transition.applied_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM private.hosted_realtime_canary_block_transitions AS later
          WHERE later.run_id = transition.run_id
            AND later.blocker_id = transition.blocker_id
            AND later.transition_ordinal > transition.transition_ordinal
            AND later.applied_at IS NOT NULL
        )
    );

  IF NOT p_ignore_auth_sessions THEN
    IF NOT v_has_active THEN
      v_count := v_count
        + private.hosted_realtime_canary_fixture_session_count(
            v_config.actor_a_id,
            v_config.actor_b_id,
            v_config.actor_c_id,
            v_config.dataset_lineage
          );
    END IF;
  END IF;

  IF v_config.session_quarantine_until IS NOT NULL
     AND v_config.session_quarantine_until
       > pg_catalog.statement_timestamp() THEN
    v_count := v_count + 1;
  END IF;

  IF NOT v_has_active THEN
    SELECT v_count + pg_catalog.count(*)::integer INTO v_count
    FROM public.conversation_archives AS archive
    WHERE archive.conversation_id IN (
      v_config.conversation_ab_id,
      v_config.conversation_ac_id
    );

    IF EXISTS (
      SELECT 1
      FROM public.conversations AS conversation
      WHERE (
        conversation.id = v_config.conversation_ab_id
        AND conversation.last_message_at IS DISTINCT FROM
          v_config.baseline_ab_last_message_at
      ) OR (
        conversation.id = v_config.conversation_ac_id
        AND conversation.last_message_at IS DISTINCT FROM
          v_config.baseline_ac_last_message_at
      )
    ) THEN
      v_count := v_count + 1;
    END IF;

    SELECT v_count + pg_catalog.count(*)::integer INTO v_count
    FROM private.hosted_realtime_canary_profile_baselines AS baseline
    JOIN public.profiles AS profile ON profile.id = baseline.profile_id
    WHERE profile.updated_at IS DISTINCT FROM baseline.updated_at
       OR profile.response_rate IS DISTINCT FROM baseline.response_rate
       OR profile.response_sample IS DISTINCT FROM baseline.response_sample;

    SELECT v_count + pg_catalog.count(*)::integer INTO v_count
    FROM public.notifications AS notification
    WHERE notification.conversation_id IN (
      v_config.conversation_ab_id,
      v_config.conversation_ac_id
    )
      AND notification.user_id IN (
        v_config.actor_a_id,
        v_config.actor_b_id,
        v_config.actor_c_id
      )
      AND notification.created_at >= v_config.activated_at;
  END IF;

  RETURN v_count;
END
$function$;

REVOKE ALL ON FUNCTION
  private.hosted_realtime_canary_residue_count(boolean)
  FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION private.hosted_realtime_canary_residue_count(boolean)
  OWNER TO caaci_hosted_realtime_executor;

CREATE FUNCTION
  private.hosted_realtime_canary_actor_authorized(
    p_actor uuid,
    p_expected_role text
  )
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT
    p_actor IS NOT NULL
    AND p_expected_role IN ('member-a', 'member-b', 'member-c')
    AND CASE p_expected_role
      WHEN 'member-a' THEN p_actor = config.actor_a_id
      WHEN 'member-b' THEN p_actor = config.actor_b_id
      WHEN 'member-c' THEN p_actor = config.actor_c_id
      ELSE false
    END
    AND EXISTS (
      SELECT 1
      FROM private.hosted_realtime_canary_auth_context(
        config.project_ref,
        config.dataset_lineage
      ) AS context
      WHERE context.actor_id = p_actor
        AND context.canary_role = p_expected_role
    )
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS profile
      WHERE profile.id = p_actor
        AND NOT profile.shadow_banned
        AND profile.suspension_level = 0
        AND profile.suspended_until IS NULL
    )
  FROM private.hosted_realtime_canary_environment_config AS config
  WHERE config.singleton
$function$;

REVOKE ALL ON FUNCTION
  private.hosted_realtime_canary_actor_authorized(uuid, text)
FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION
  private.hosted_realtime_canary_actor_authorized(uuid, text)
  OWNER TO caaci_hosted_realtime_executor;

CREATE FUNCTION
  private.hosted_realtime_canary_message_mutation_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_config private.hosted_realtime_canary_environment_config%ROWTYPE;
  v_run_id uuid;
  v_row_id uuid;
  v_actor_id uuid;
  v_conversation_id uuid;
  v_marker text;
BEGIN
  SELECT config.* INTO STRICT v_config
  FROM private.hosted_realtime_canary_environment_config AS config
  WHERE config.singleton;

  v_row_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  v_actor_id := CASE
    WHEN TG_OP = 'DELETE' THEN OLD.sender_id ELSE NEW.sender_id
  END;
  v_conversation_id := CASE
    WHEN TG_OP = 'DELETE' THEN OLD.conversation_id ELSE NEW.conversation_id
  END;
  v_marker := CASE
    WHEN TG_OP = 'DELETE' THEN OLD.content ELSE NEW.content
  END;

  IF v_actor_id NOT IN (
       v_config.actor_a_id, v_config.actor_b_id, v_config.actor_c_id
     )
     AND v_conversation_id NOT IN (
       v_config.conversation_ab_id, v_config.conversation_ac_id
     ) THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  BEGIN
    v_run_id := nullif(
      pg_catalog.current_setting(
        CASE
          WHEN TG_OP = 'INSERT'
            THEN 'caaci.hosted_canary_insert_run_id'
          ELSE 'caaci.hosted_canary_cleanup_run_id'
        END,
        true
      ),
      ''
    )::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_run_id := NULL;
  END;

  IF v_run_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM private.hosted_realtime_canary_writes AS write
    JOIN private.hosted_realtime_canary_runs AS run
      ON run.run_id = write.run_id
    WHERE write.run_id = v_run_id
      AND write.message_id = v_row_id
      AND write.actor_id = v_actor_id
      AND write.conversation_id = v_conversation_id
      AND write.marker = v_marker
      AND (TG_OP = 'DELETE' OR write.expected_created_at = NEW.created_at)
      AND (
        run.status = 'active'
        OR (TG_OP = 'DELETE' AND run.status = 'quarantined')
      )
  ) THEN
    RAISE EXCEPTION 'hosted_realtime_canary_direct_message_mutation_denied'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' AND (
    NEW.message_type::text <> 'text'
    OR NEW.is_read IS DISTINCT FROM false
    OR NEW.content <> 'caaci-hosted-canary-' || NEW.id::text
  ) THEN
    RAISE EXCEPTION 'hosted_realtime_canary_message_shape_invalid'
      USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'hosted_realtime_canary_message_update_denied'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION
  private.hosted_realtime_canary_message_mutation_guard()
FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER aa_hosted_realtime_canary_message_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION
    private.hosted_realtime_canary_message_mutation_guard();
ALTER FUNCTION private.hosted_realtime_canary_message_mutation_guard()
  OWNER TO caaci_hosted_realtime_executor;

CREATE FUNCTION
  private.hosted_realtime_canary_notification_mutation_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_config private.hosted_realtime_canary_environment_config%ROWTYPE;
  v_run_id uuid;
  v_row public.notifications%ROWTYPE;
BEGIN
  SELECT config.* INTO STRICT v_config
  FROM private.hosted_realtime_canary_environment_config AS config
  WHERE config.singleton;
  IF TG_OP = 'DELETE' THEN
    v_row := OLD;
  ELSE
    v_row := NEW;
  END IF;

  IF v_row.user_id IS DISTINCT FROM v_config.actor_a_id
     OR v_row.conversation_id IS DISTINCT FROM v_config.conversation_ab_id
     OR v_row.type IS DISTINCT FROM 'system'
     OR v_row.body !~
       '^caaci-hosted-notification-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'hosted_realtime_canary_notification_update_denied'
      USING ERRCODE = '42501';
  END IF;
  BEGIN
    v_run_id := nullif(
      pg_catalog.current_setting(
        CASE WHEN TG_OP = 'INSERT'
          THEN 'caaci.hosted_canary_notification_insert_run_id'
          ELSE 'caaci.hosted_canary_cleanup_run_id'
        END,
        true
      ),
      ''
    )::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_run_id := NULL;
  END;
  IF v_run_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM private.hosted_realtime_canary_notifications AS ledger
    JOIN private.hosted_realtime_canary_runs AS run
      ON run.run_id = ledger.run_id
    WHERE ledger.run_id = v_run_id
      AND ledger.notification_id = v_row.id
      AND ledger.user_id = v_row.user_id
      AND ledger.conversation_id = v_row.conversation_id
      AND ledger.marker = v_row.body
      AND ledger.expected_created_at = v_row.created_at
      AND ledger.expected_emailed_at = v_row.emailed_at
      AND run.status IN ('active', 'quarantined')
  ) THEN
    RAISE EXCEPTION 'hosted_realtime_canary_direct_notification_mutation_denied'
      USING ERRCODE = '42501';
  END IF;
  IF v_row.title IS DISTINCT FROM 'CAACI hosted Realtime canary'
     OR v_row.is_read IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'hosted_realtime_canary_notification_shape_invalid'
      USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION
  private.hosted_realtime_canary_notification_mutation_guard()
FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER aa_hosted_realtime_canary_notification_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION
    private.hosted_realtime_canary_notification_mutation_guard();
ALTER FUNCTION private.hosted_realtime_canary_notification_mutation_guard()
  OWNER TO caaci_hosted_realtime_executor;

CREATE FUNCTION private.hosted_realtime_canary_block_mutation_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_config private.hosted_realtime_canary_environment_config%ROWTYPE;
  v_run_id uuid;
  v_blocker uuid;
  v_blocked uuid;
BEGIN
  SELECT config.* INTO STRICT v_config
  FROM private.hosted_realtime_canary_environment_config AS config
  WHERE config.singleton;
  v_blocker := CASE WHEN TG_OP = 'DELETE' THEN OLD.blocker_id
                    ELSE NEW.blocker_id END;
  v_blocked := CASE WHEN TG_OP = 'DELETE' THEN OLD.blocked_id
                    ELSE NEW.blocked_id END;
  IF NOT (
    (v_blocker = v_config.actor_a_id AND v_blocked = v_config.actor_b_id)
    OR (v_blocker = v_config.actor_b_id AND v_blocked = v_config.actor_a_id)
  ) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'hosted_realtime_canary_block_update_denied'
      USING ERRCODE = '42501';
  END IF;
  BEGIN
    v_run_id := coalesce(
      nullif(
        pg_catalog.current_setting(
          'caaci.hosted_canary_cleanup_run_id', true
        ),
        ''
      ),
      nullif(
        pg_catalog.current_setting(
          'caaci.hosted_canary_block_run_id', true
        ),
        ''
      )
    )::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_run_id := NULL;
  END;
  IF v_run_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM private.hosted_realtime_canary_block_transitions AS transition
    JOIN private.hosted_realtime_canary_runs AS run
      ON run.run_id = transition.run_id
    WHERE transition.run_id = v_run_id
      AND transition.blocker_id = v_blocker
      AND transition.blocked_id = v_blocked
      AND run.status IN ('active', 'quarantined')
      AND (
        (TG_OP = 'INSERT' AND transition.blocked
         AND transition.applied_at IS NULL)
        OR (TG_OP = 'DELETE' AND (
          (NOT transition.blocked AND transition.applied_at IS NULL)
          OR pg_catalog.current_setting(
               'caaci.hosted_canary_cleanup_run_id', true
             ) = v_run_id::text
        ))
      )
  ) THEN
    RAISE EXCEPTION 'hosted_realtime_canary_direct_block_mutation_denied'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION
  private.hosted_realtime_canary_block_mutation_guard()
FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER aa_hosted_realtime_canary_block_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.blocks
  FOR EACH ROW EXECUTE FUNCTION
    private.hosted_realtime_canary_block_mutation_guard();
ALTER FUNCTION private.hosted_realtime_canary_block_mutation_guard()
  OWNER TO caaci_hosted_realtime_executor;

-- The existing seller-response trigger updates profiles and therefore also
-- fires set_profiles_updated_at. During an exact cleanup only, this final
-- alphabetic BEFORE UPDATE trigger restores the captured synthetic-fixture
-- timestamp after the ordinary trigger has run. It cannot bypass a response
-- metric mismatch; cleanup verifies those values independently.
CREATE FUNCTION
  private.hosted_realtime_canary_restore_profile_timestamp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_run_id uuid;
  v_baseline timestamptz;
BEGIN
  BEGIN
    v_run_id := nullif(
      pg_catalog.current_setting(
        'caaci.hosted_canary_cleanup_run_id',
        true
      ),
      ''
    )::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_run_id := NULL;
  END;

  IF v_run_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT baseline.updated_at
    INTO v_baseline
  FROM private.hosted_realtime_canary_profile_baselines AS baseline
  WHERE baseline.profile_id = NEW.id
    AND EXISTS (
      SELECT 1
      FROM private.hosted_realtime_canary_runs AS run
      WHERE run.run_id = v_run_id
        AND run.status IN ('active', 'quarantined')
    );
  IF FOUND THEN
    NEW.updated_at := v_baseline;
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION
  private.hosted_realtime_canary_restore_profile_timestamp()
FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER zz_hosted_realtime_canary_restore_profile_timestamp
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION
    private.hosted_realtime_canary_restore_profile_timestamp();
ALTER FUNCTION
  private.hosted_realtime_canary_restore_profile_timestamp()
  OWNER TO caaci_hosted_realtime_executor;

CREATE POLICY hosted_realtime_canary_executor_insert
  ON public.messages
  FOR INSERT
  TO caaci_hosted_realtime_executor
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM private.hosted_realtime_canary_writes AS write
      JOIN private.hosted_realtime_canary_runs AS run
        ON run.run_id = write.run_id
      WHERE write.message_id = messages.id
        AND write.actor_id = messages.sender_id
        AND write.conversation_id = messages.conversation_id
        AND write.marker = messages.content
        AND write.expected_created_at = messages.created_at
        AND run.status = 'active'
        AND write.run_id::text = pg_catalog.current_setting(
          'caaci.hosted_canary_insert_run_id',
          true
        )
    )
  );

CREATE POLICY hosted_realtime_canary_executor_delete
  ON public.messages
  FOR DELETE
  TO caaci_hosted_realtime_executor
  USING (
    EXISTS (
      SELECT 1
      FROM private.hosted_realtime_canary_writes AS write
      JOIN private.hosted_realtime_canary_runs AS run
        ON run.run_id = write.run_id
      WHERE write.message_id = messages.id
        AND write.actor_id = messages.sender_id
        AND write.conversation_id = messages.conversation_id
        AND write.marker = messages.content
        AND write.expected_created_at = messages.created_at
        AND run.status IN ('active', 'quarantined')
        AND write.run_id::text = pg_catalog.current_setting(
          'caaci.hosted_canary_cleanup_run_id',
          true
        )
    )
  );

CREATE POLICY hosted_realtime_canary_executor_conversation_restore
  ON public.conversations
  FOR UPDATE
  TO caaci_hosted_realtime_executor
  USING (
    id IN (
      SELECT config.conversation_ab_id
      FROM private.hosted_realtime_canary_environment_config AS config
      WHERE config.singleton
      UNION ALL
      SELECT config.conversation_ac_id
      FROM private.hosted_realtime_canary_environment_config AS config
      WHERE config.singleton
    )
    AND EXISTS (
      SELECT 1
      FROM private.hosted_realtime_canary_runs AS run
      WHERE run.status IN ('active', 'quarantined')
        AND run.run_id::text = pg_catalog.current_setting(
          'caaci.hosted_canary_cleanup_run_id',
          true
        )
    )
  )
  WITH CHECK (
    id IN (
      SELECT config.conversation_ab_id
      FROM private.hosted_realtime_canary_environment_config AS config
      WHERE config.singleton
      UNION ALL
      SELECT config.conversation_ac_id
      FROM private.hosted_realtime_canary_environment_config AS config
      WHERE config.singleton
    )
  );

CREATE FUNCTION
  private.hosted_realtime_canary_cleanup_run(
    p_run_id uuid,
    p_reason text
  )
RETURNS TABLE(deleted_count integer, residue_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_config private.hosted_realtime_canary_environment_config%ROWTYPE;
  v_run private.hosted_realtime_canary_runs%ROWTYPE;
  v_deleted integer := 0;
  v_deleted_notifications integer := 0;
  v_restored_blocks integer := 0;
  v_residue integer := 0;
  v_quarantine boolean := false;
  v_profile uuid;
BEGIN
  IF p_reason NOT IN ('normal', 'ttl', 'manual') THEN
    RAISE EXCEPTION 'hosted_realtime_canary_cleanup_reason_invalid'
      USING ERRCODE = '22023';
  END IF;
  SELECT config.* INTO STRICT v_config
  FROM private.hosted_realtime_canary_environment_config AS config
  WHERE config.singleton
  FOR UPDATE;
  SELECT run.* INTO STRICT v_run
  FROM private.hosted_realtime_canary_runs AS run
  WHERE run.run_id = p_run_id
  FOR UPDATE;

  IF v_run.status NOT IN ('active', 'quarantined') THEN
    RAISE EXCEPTION 'hosted_realtime_canary_run_not_recoverable'
      USING ERRCODE = '55000';
  END IF;
  UPDATE private.hosted_realtime_canary_environment_config AS config
  SET admission_open = false
  WHERE config.singleton;
  UPDATE private.hosted_realtime_canary_runs AS run
  SET cleanup_started_at = pg_catalog.statement_timestamp(),
      cleanup_reason = p_reason
  WHERE run.run_id = p_run_id;

  IF EXISTS (
    SELECT 1
    FROM private.hosted_realtime_canary_writes AS write
    LEFT JOIN public.messages AS message ON message.id = write.message_id
    WHERE write.run_id = p_run_id
      AND (
        write.inserted_at IS NULL
        OR message.id IS NULL
        OR message.conversation_id <> write.conversation_id
        OR message.sender_id <> write.actor_id
        OR message.content <> write.marker
        OR message.message_type::text <> 'text'
        OR message.is_read IS DISTINCT FROM false
        OR message.created_at IS DISTINCT FROM write.expected_created_at
        OR (
          write.write_class = 'base'
          AND NOT (
            (write.actor_id = v_config.actor_a_id
             AND write.conversation_id IN (
               v_config.conversation_ab_id,
               v_config.conversation_ac_id
             ))
            OR (write.actor_id = v_config.actor_c_id
                AND write.conversation_id = v_config.conversation_ac_id)
          )
        )
        OR (
          write.write_class = 'scale'
          AND (
            write.conversation_id <> v_config.conversation_ab_id
            OR write.actor_id <> CASE WHEN write.batch_ordinal <= 21
              THEN v_config.actor_a_id ELSE v_config.actor_b_id END
          )
        )
      )
  ) OR (
    SELECT pg_catalog.count(*)
    FROM private.hosted_realtime_canary_writes AS write
    WHERE write.run_id = p_run_id
      AND write.write_class = 'base'
  ) > 8 OR (
    SELECT pg_catalog.count(*)
    FROM private.hosted_realtime_canary_writes AS write
    WHERE write.run_id = p_run_id
      AND write.write_class = 'base'
      AND write.actor_id = v_config.actor_a_id
      AND write.conversation_id = v_config.conversation_ab_id
  ) > 5 OR (
    SELECT pg_catalog.count(*)
    FROM private.hosted_realtime_canary_writes AS write
    WHERE write.run_id = p_run_id
      AND write.write_class = 'base'
      AND write.actor_id = v_config.actor_a_id
      AND write.conversation_id = v_config.conversation_ac_id
  ) > 2 OR (
    SELECT pg_catalog.count(*)
    FROM private.hosted_realtime_canary_writes AS write
    WHERE write.run_id = p_run_id
      AND write.write_class = 'base'
      AND write.actor_id = v_config.actor_c_id
      AND write.conversation_id = v_config.conversation_ac_id
  ) > 1 OR (
    SELECT pg_catalog.count(*)
    FROM private.hosted_realtime_canary_writes AS write
    WHERE write.run_id = p_run_id
      AND write.write_class = 'scale'
  ) NOT IN (0, 51) OR EXISTS (
    SELECT 1
    FROM private.hosted_realtime_canary_writes AS write
    WHERE write.run_id = p_run_id
      AND write.write_class = 'scale'
    GROUP BY write.run_id
    HAVING pg_catalog.count(DISTINCT write.expected_created_at) <> 1
  ) OR EXISTS (
    SELECT 1
    FROM private.hosted_realtime_canary_notifications AS ledger
    LEFT JOIN public.notifications AS notification
      ON notification.id = ledger.notification_id
    WHERE ledger.run_id = p_run_id
      AND (
        ledger.inserted_at IS NULL
        OR notification.id IS NULL
        OR ledger.user_id <> v_config.actor_a_id
        OR ledger.conversation_id <> v_config.conversation_ab_id
        OR notification.user_id <> ledger.user_id
        OR notification.conversation_id <> ledger.conversation_id
        OR notification.type <> 'system'
        OR notification.title <> 'CAACI hosted Realtime canary'
        OR notification.body <> ledger.marker
        OR notification.is_read IS DISTINCT FROM false
        OR notification.created_at IS DISTINCT FROM
             ledger.expected_created_at
        OR notification.emailed_at IS DISTINCT FROM
             ledger.expected_emailed_at
      )
  ) OR EXISTS (
    SELECT 1
    FROM private.hosted_realtime_canary_block_transitions AS transition
    WHERE transition.run_id = p_run_id
      AND (
        transition.applied_at IS NULL
        OR NOT (
          (transition.blocker_id = v_config.actor_a_id
           AND transition.blocked_id = v_config.actor_b_id)
          OR (transition.blocker_id = v_config.actor_b_id
              AND transition.blocked_id = v_config.actor_a_id)
        )
        OR (
          transition.transition_ordinal = 2
          AND NOT EXISTS (
            SELECT 1
            FROM private.hosted_realtime_canary_block_transitions AS first
            WHERE first.run_id = transition.run_id
              AND first.blocker_id = transition.blocker_id
              AND first.blocked_id = transition.blocked_id
              AND first.transition_ordinal = 1
              AND first.blocked
              AND first.applied_at IS NOT NULL
          )
        )
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.blocks AS block_relation
    WHERE (
      (block_relation.blocker_id = v_config.actor_a_id
       AND block_relation.blocked_id = v_config.actor_b_id)
      OR (block_relation.blocker_id = v_config.actor_b_id
          AND block_relation.blocked_id = v_config.actor_a_id)
    )
      AND NOT EXISTS (
        SELECT 1
        FROM private.hosted_realtime_canary_block_transitions AS transition
        WHERE transition.run_id = p_run_id
          AND transition.blocker_id = block_relation.blocker_id
          AND transition.blocked_id = block_relation.blocked_id
          AND transition.blocked
          AND transition.applied_at IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM private.hosted_realtime_canary_block_transitions AS later
            WHERE later.run_id = transition.run_id
              AND later.blocker_id = transition.blocker_id
              AND later.transition_ordinal > transition.transition_ordinal
              AND later.applied_at IS NOT NULL
          )
      )
  ) OR EXISTS (
    SELECT 1
    FROM private.hosted_realtime_canary_block_transitions AS transition
    WHERE transition.run_id = p_run_id
      AND transition.applied_at IS NOT NULL
      AND NOT transition.blocked
      AND EXISTS (
        SELECT 1
        FROM public.blocks AS block_relation
        WHERE block_relation.blocker_id = transition.blocker_id
          AND block_relation.blocked_id = transition.blocked_id
      )
  ) THEN
    UPDATE private.hosted_realtime_canary_runs AS run
    SET status = 'quarantined',
        last_cleanup_sqlstate = 'row_shape_drift'
    WHERE run.run_id = p_run_id;
    RETURN QUERY SELECT
      0,
      private.hosted_realtime_canary_residue_count(true);
    RETURN;
  END IF;

  PERFORM pg_catalog.set_config(
    'caaci.hosted_canary_cleanup_run_id',
    p_run_id::text,
    true
  );

  WITH restored AS (
    DELETE FROM public.blocks AS block_relation
    WHERE (
      (block_relation.blocker_id = v_config.actor_a_id
       AND block_relation.blocked_id = v_config.actor_b_id)
      OR (block_relation.blocker_id = v_config.actor_b_id
          AND block_relation.blocked_id = v_config.actor_a_id)
    )
      AND EXISTS (
        SELECT 1
        FROM private.hosted_realtime_canary_block_transitions AS transition
        WHERE transition.run_id = p_run_id
          AND transition.blocker_id = block_relation.blocker_id
          AND transition.blocked_id = block_relation.blocked_id
          AND transition.blocked
          AND transition.applied_at IS NOT NULL
      )
    RETURNING block_relation.blocker_id
  )
  SELECT pg_catalog.count(*)::integer INTO v_restored_blocks FROM restored;

  WITH deleted AS (
    DELETE FROM public.notifications AS notification
    USING private.hosted_realtime_canary_notifications AS ledger
    WHERE ledger.run_id = p_run_id
      AND ledger.notification_id = notification.id
      AND ledger.user_id = notification.user_id
      AND ledger.conversation_id = notification.conversation_id
      AND ledger.marker = notification.body
      AND ledger.expected_created_at = notification.created_at
      AND ledger.expected_emailed_at = notification.emailed_at
    RETURNING notification.id
  )
  SELECT pg_catalog.count(*)::integer
    INTO v_deleted_notifications
  FROM deleted;

  UPDATE private.hosted_realtime_canary_notifications AS ledger
  SET deleted_at = pg_catalog.statement_timestamp()
  WHERE ledger.run_id = p_run_id
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications AS notification
      WHERE notification.id = ledger.notification_id
    );

  WITH deleted AS (
    DELETE FROM public.messages AS message
    USING private.hosted_realtime_canary_writes AS write
    WHERE write.run_id = p_run_id
      AND write.message_id = message.id
      AND write.actor_id = message.sender_id
      AND write.conversation_id = message.conversation_id
      AND write.marker = message.content
      AND message.message_type::text = 'text'
    RETURNING message.id
  )
  SELECT pg_catalog.count(*)::integer INTO v_deleted FROM deleted;

  UPDATE private.hosted_realtime_canary_writes AS write
  SET deleted_at = pg_catalog.statement_timestamp()
  WHERE write.run_id = p_run_id
    AND NOT EXISTS (
      SELECT 1 FROM public.messages AS message
      WHERE message.id = write.message_id
    );

  UPDATE public.conversations AS conversation
  SET last_message_at = CASE
    WHEN conversation.id = v_config.conversation_ab_id
      THEN v_config.baseline_ab_last_message_at
    ELSE v_config.baseline_ac_last_message_at
  END
  WHERE conversation.id IN (
    v_config.conversation_ab_id,
    v_config.conversation_ac_id
  );

  FOR v_profile IN
    SELECT baseline.profile_id
    FROM private.hosted_realtime_canary_profile_baselines AS baseline
    ORDER BY baseline.profile_id
  LOOP
    PERFORM public.recompute_seller_response(v_profile);
  END LOOP;

  IF EXISTS (
       SELECT 1
       FROM public.conversation_archives AS archive
       WHERE archive.conversation_id IN (
         v_config.conversation_ab_id,
         v_config.conversation_ac_id
       )
     )
       OR EXISTS (
       SELECT 1
       FROM private.hosted_realtime_canary_profile_baselines AS baseline
       JOIN public.profiles AS profile ON profile.id = baseline.profile_id
       WHERE profile.updated_at IS DISTINCT FROM baseline.updated_at
          OR profile.response_rate IS DISTINCT FROM baseline.response_rate
          OR profile.response_sample IS DISTINCT FROM baseline.response_sample
     )
     OR EXISTS (
       SELECT 1
       FROM public.notifications AS notification
       WHERE notification.conversation_id IN (
         v_config.conversation_ab_id,
         v_config.conversation_ac_id
       )
         AND notification.user_id IN (
           v_config.actor_a_id,
           v_config.actor_b_id,
           v_config.actor_c_id
         )
         AND notification.created_at >= v_run.started_at
     )
     OR EXISTS (
       SELECT 1
       FROM public.blocks AS block_relation
       WHERE (block_relation.blocker_id = v_config.actor_a_id
              AND block_relation.blocked_id = v_config.actor_b_id)
          OR (block_relation.blocker_id = v_config.actor_b_id
              AND block_relation.blocked_id = v_config.actor_a_id)
     ) THEN
    v_quarantine := true;
  END IF;

  IF p_reason IN ('ttl', 'manual') THEN
    UPDATE private.hosted_realtime_canary_environment_config AS config
    SET session_quarantine_until =
      pg_catalog.statement_timestamp()
      + pg_catalog.make_interval(
          secs => config.max_access_token_lifetime_seconds + 60
        )
    WHERE config.singleton;
  END IF;

  UPDATE private.hosted_realtime_canary_runs AS run
  SET status = CASE
        WHEN v_quarantine THEN 'quarantined'
        WHEN p_reason = 'normal' THEN 'cleaned'
        ELSE 'recovery_required'
      END,
      cleaned_at = pg_catalog.statement_timestamp(),
      deleted_count = v_deleted,
      last_cleanup_sqlstate = CASE
        WHEN v_quarantine THEN 'derived_state_drift'
        ELSE NULL
      END
  WHERE run.run_id = p_run_id;

  v_residue := private.hosted_realtime_canary_residue_count(true);
  RETURN QUERY SELECT v_deleted, v_residue;
END
$function$;

REVOKE ALL ON FUNCTION
  private.hosted_realtime_canary_cleanup_run(uuid, text)
FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION private.hosted_realtime_canary_cleanup_run(uuid, text)
  OWNER TO caaci_hosted_realtime_executor;

CREATE FUNCTION public.hosted_realtime_canary_environment()
RETURNS TABLE(
  sentinel_id uuid,
  project_ref text,
  dataset_lineage text,
  fixture_manifest_sha256 text,
  fixture_revision integer,
  protocol_revision integer,
  provider_disable_proof_sha256 text,
  provider_proof_expires_at timestamptz,
  lifecycle_state text,
  synthetic_only boolean,
  disposable boolean,
  provider_side_effects_disabled boolean,
  write_cleanup_supported boolean,
  residue_count integer,
  expires_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT
    config.sentinel_id,
    config.project_ref,
    config.dataset_lineage,
    config.fixture_manifest_sha256,
    config.fixture_revision,
    config.protocol_revision,
    config.provider_disable_proof_sha256,
    config.provider_proof_expires_at,
    CASE
      WHEN config.admission_open
        AND NOT EXISTS (
          SELECT 1
          FROM private.hosted_realtime_canary_runs AS run
        ) THEN 'ready'
      WHEN NOT config.admission_open
        AND EXISTS (
          SELECT 1
          FROM private.hosted_realtime_canary_runs AS run
          WHERE run.status = 'cleaned'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM private.hosted_realtime_canary_runs AS run
          WHERE run.status IN (
            'active', 'recovery_required', 'quarantined'
          )
        ) THEN 'cleaned'
      ELSE 'blocked'
    END,
    config.synthetic_only,
    config.disposable,
    config.provider_side_effects_disabled,
    config.write_cleanup_supported,
    private.hosted_realtime_canary_residue_count(false),
    config.expires_at
  FROM private.hosted_realtime_canary_environment_config AS config
  WHERE config.singleton
    AND config.expires_at > pg_catalog.statement_timestamp()
    AND config.provider_proof_expires_at > pg_catalog.statement_timestamp()
    AND config.last_ttl_heartbeat_at >=
      pg_catalog.statement_timestamp() - interval '10 minutes'
$function$;

REVOKE ALL ON FUNCTION public.hosted_realtime_canary_environment()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hosted_realtime_canary_environment()
  TO anon;
ALTER FUNCTION public.hosted_realtime_canary_environment()
  OWNER TO caaci_hosted_realtime_executor;

CREATE FUNCTION public.hosted_realtime_canary_begin_run(
  p_run_id uuid
)
RETURNS TABLE(run_id uuid, lease_expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_config private.hosted_realtime_canary_environment_config%ROWTYPE;
  v_actor uuid;
  v_session_id uuid;
  v_lease timestamptz;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'caaci-hosted-realtime-canary-run-v1',
      20260731
    )
  );
  SELECT config.* INTO STRICT v_config
  FROM private.hosted_realtime_canary_environment_config AS config
  WHERE config.singleton
  FOR UPDATE;
  SELECT context.actor_id, context.session_id
    INTO v_actor, v_session_id
  FROM private.hosted_realtime_canary_auth_context(
    v_config.project_ref,
    v_config.dataset_lineage
  ) AS context;
  IF p_run_id IS NULL
     OR NOT v_config.admission_open
     OR v_config.expires_at <= pg_catalog.statement_timestamp()
     OR v_config.activated_at <
          pg_catalog.statement_timestamp() - interval '20 minutes'
     OR v_config.provider_proof_expires_at
          <= pg_catalog.statement_timestamp()
     OR v_config.last_ttl_heartbeat_at IS NULL
     OR v_config.last_ttl_heartbeat_at <
          pg_catalog.statement_timestamp() - interval '10 minutes'
     OR private.hosted_realtime_canary_residue_count(true) <> 0
     OR v_actor IS DISTINCT FROM v_config.actor_a_id
     OR v_session_id IS NULL
     OR NOT private.hosted_realtime_canary_actor_authorized(
       v_actor,
       'member-a'
     )
     OR private.hosted_realtime_canary_fixture_session_count(
       v_config.actor_a_id,
       v_config.actor_b_id,
       v_config.actor_c_id,
       v_config.dataset_lineage
     ) <> 1 THEN
    RAISE EXCEPTION 'hosted_realtime_canary_begin_denied'
      USING ERRCODE = '42501';
  END IF;

  v_lease := pg_catalog.statement_timestamp() + interval '45 minutes';
  INSERT INTO private.hosted_realtime_canary_runs (
    run_id,
    sentinel_id,
    coordinator_id,
    coordinator_session_id,
    status,
    started_at,
    lease_expires_at
  ) VALUES (
    p_run_id,
    v_config.sentinel_id,
    v_actor,
    v_session_id,
    'active',
    pg_catalog.statement_timestamp(),
    v_lease
  );
  RETURN QUERY SELECT p_run_id, v_lease;
END
$function$;

REVOKE ALL ON FUNCTION public.hosted_realtime_canary_begin_run(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hosted_realtime_canary_begin_run(uuid)
  TO authenticated;
ALTER FUNCTION public.hosted_realtime_canary_begin_run(uuid)
  OWNER TO caaci_hosted_realtime_executor;

CREATE FUNCTION public.hosted_realtime_canary_insert_message(
  p_run_id uuid,
  p_id uuid,
  p_conversation_id uuid,
  p_content text
)
RETURNS TABLE(id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_config private.hosted_realtime_canary_environment_config%ROWTYPE;
  v_run private.hosted_realtime_canary_runs%ROWTYPE;
  v_actor uuid;
  v_role text;
  v_quota integer;
  v_existing integer;
  v_inserted_id uuid;
  v_created_at timestamptz := pg_catalog.statement_timestamp();
BEGIN
  SELECT config.* INTO STRICT v_config
  FROM private.hosted_realtime_canary_environment_config AS config
  WHERE config.singleton;
  SELECT context.actor_id INTO v_actor
  FROM private.hosted_realtime_canary_auth_context(
    v_config.project_ref,
    v_config.dataset_lineage
  ) AS context;
  SELECT run.* INTO v_run
  FROM private.hosted_realtime_canary_runs AS run
  WHERE run.run_id = p_run_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'hosted_realtime_canary_insert_denied'
      USING ERRCODE = '42501';
  END IF;
  v_role := CASE
    WHEN v_actor = v_config.actor_a_id THEN 'member-a'
    WHEN v_actor = v_config.actor_b_id THEN 'member-b'
    WHEN v_actor = v_config.actor_c_id THEN 'member-c'
    ELSE NULL
  END;

  IF NOT v_config.admission_open
     OR v_run.status <> 'active'
     OR v_run.lease_expires_at <= pg_catalog.statement_timestamp()
     OR v_config.expires_at <= pg_catalog.statement_timestamp()
     OR v_config.provider_proof_expires_at
          <= pg_catalog.statement_timestamp()
     OR p_id IS NULL
     OR p_content IS DISTINCT FROM
          'caaci-hosted-canary-' || p_id::text
     OR NOT private.hosted_realtime_canary_actor_authorized(
       v_actor,
       v_role
     )
     THEN
    RAISE EXCEPTION 'hosted_realtime_canary_insert_denied'
      USING ERRCODE = '42501';
  END IF;

  v_quota := CASE
    WHEN v_actor = v_config.actor_a_id
      AND v_role = 'member-a'
      AND p_conversation_id = v_config.conversation_ab_id THEN 5
    WHEN v_actor = v_config.actor_a_id
      AND v_role = 'member-a'
      AND p_conversation_id = v_config.conversation_ac_id THEN 2
    WHEN v_actor = v_config.actor_c_id
      AND v_role = 'member-c'
      AND p_conversation_id = v_config.conversation_ac_id THEN 1
    ELSE 0
  END;
  IF v_quota = 0 THEN
    RAISE EXCEPTION 'hosted_realtime_canary_actor_conversation_denied'
      USING ERRCODE = '42501';
  END IF;
  SELECT pg_catalog.count(*)::integer INTO v_existing
  FROM private.hosted_realtime_canary_writes AS write
  WHERE write.run_id = p_run_id
    AND write.write_class = 'base'
    AND write.actor_id = v_actor
    AND write.conversation_id = p_conversation_id;
  IF v_existing >= v_quota OR (
       SELECT pg_catalog.count(*)
       FROM private.hosted_realtime_canary_writes AS write
       WHERE write.run_id = p_run_id
         AND write.write_class = 'base'
     ) >= 8 THEN
    RAISE EXCEPTION 'hosted_realtime_canary_write_quota_exceeded'
      USING ERRCODE = '54000';
  END IF;

  INSERT INTO private.hosted_realtime_canary_writes (
    message_id,
    run_id,
    actor_id,
    conversation_id,
    marker,
    write_class,
    expected_created_at
  ) VALUES (
    p_id,
    p_run_id,
    v_actor,
    p_conversation_id,
    p_content,
    'base',
    v_created_at
  );
  PERFORM pg_catalog.set_config(
    'caaci.hosted_canary_insert_run_id',
    p_run_id::text,
    true
  );
  INSERT INTO public.messages (
    id,
    conversation_id,
    sender_id,
    content,
    message_type,
    created_at
  ) VALUES (
    p_id,
    p_conversation_id,
    v_actor,
    p_content,
    'text'::public.message_type,
    v_created_at
  )
  RETURNING messages.id INTO v_inserted_id;

  UPDATE private.hosted_realtime_canary_writes AS write
  SET inserted_at = pg_catalog.statement_timestamp()
  WHERE write.message_id = p_id
    AND write.run_id = p_run_id;
  UPDATE private.hosted_realtime_canary_runs AS run
  SET attempted_count = run.attempted_count + 1,
      inserted_count = run.inserted_count + 1
  WHERE run.run_id = p_run_id;
  RETURN QUERY SELECT v_inserted_id;
END
$function$;

REVOKE ALL ON FUNCTION public.hosted_realtime_canary_insert_message(
  uuid, uuid, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hosted_realtime_canary_insert_message(
  uuid, uuid, uuid, text
) TO authenticated;
ALTER FUNCTION public.hosted_realtime_canary_insert_message(
  uuid, uuid, uuid, text
) OWNER TO caaci_hosted_realtime_executor;

CREATE FUNCTION public.hosted_realtime_canary_insert_scale_batch(
  p_run_id uuid,
  p_message_ids uuid[]
)
RETURNS TABLE(inserted_count integer, created_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_config private.hosted_realtime_canary_environment_config%ROWTYPE;
  v_run private.hosted_realtime_canary_runs%ROWTYPE;
  v_actor uuid;
  v_session_id uuid;
  v_sorted uuid[];
  v_created_at timestamptz := pg_catalog.statement_timestamp();
  v_inserted integer;
BEGIN
  SELECT config.* INTO STRICT v_config
  FROM private.hosted_realtime_canary_environment_config AS config
  WHERE config.singleton;
  SELECT context.actor_id, context.session_id
    INTO v_actor, v_session_id
  FROM private.hosted_realtime_canary_auth_context(
    v_config.project_ref,
    v_config.dataset_lineage
  ) AS context;
  SELECT run.* INTO v_run
  FROM private.hosted_realtime_canary_runs AS run
  WHERE run.run_id = p_run_id
  FOR UPDATE;
  SELECT coalesce(
    pg_catalog.array_agg(input.id ORDER BY input.id),
    '{}'::uuid[]
  ) INTO v_sorted
  FROM pg_catalog.unnest(
    coalesce(p_message_ids, '{}'::uuid[])
  ) AS input(id);

  IF v_run.run_id IS NULL
     OR v_actor IS DISTINCT FROM v_config.actor_a_id
     OR v_session_id IS DISTINCT FROM v_run.coordinator_session_id
     OR v_run.coordinator_id <> v_actor
     OR NOT v_config.admission_open
     OR v_run.status <> 'active'
     OR v_run.lease_expires_at <= pg_catalog.statement_timestamp()
     OR v_config.expires_at <= pg_catalog.statement_timestamp()
     OR v_config.provider_proof_expires_at
          <= pg_catalog.statement_timestamp()
     OR NOT private.hosted_realtime_canary_actor_authorized(
       v_actor, 'member-a'
     )
     OR pg_catalog.cardinality(v_sorted) <> 51
     OR v_sorted IS DISTINCT FROM p_message_ids
     OR pg_catalog.cardinality(v_sorted) <> (
       SELECT pg_catalog.count(DISTINCT input.id)
       FROM pg_catalog.unnest(v_sorted) AS input(id)
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.unnest(v_sorted) AS input(id)
       WHERE EXISTS (
         SELECT 1 FROM public.messages AS message
         WHERE message.id = input.id
       ) OR EXISTS (
         SELECT 1
         FROM private.hosted_realtime_canary_writes AS write
         WHERE write.message_id = input.id
       )
     )
     OR EXISTS (
       SELECT 1
       FROM public.messages AS message
       WHERE message.sender_id IN (
         v_config.actor_a_id,
         v_config.actor_b_id
       )
         AND message.created_at >
           pg_catalog.statement_timestamp() - interval '1 hour 1 second'
         AND NOT EXISTS (
           SELECT 1
           FROM private.hosted_realtime_canary_writes AS write
           WHERE write.run_id = p_run_id
             AND write.message_id = message.id
         )
     )
     OR (
       SELECT pg_catalog.count(*)
       FROM private.hosted_realtime_canary_writes AS write
       WHERE write.run_id = p_run_id
         AND write.write_class = 'base'
         AND write.inserted_at IS NOT NULL
     ) <> 8
     OR (
       SELECT pg_catalog.count(*)
       FROM private.hosted_realtime_canary_writes AS write
       WHERE write.run_id = p_run_id
         AND write.write_class = 'base'
         AND write.actor_id = v_config.actor_a_id
         AND write.conversation_id = v_config.conversation_ab_id
     ) <> 5
     OR (
       SELECT pg_catalog.count(*)
       FROM private.hosted_realtime_canary_writes AS write
       WHERE write.run_id = p_run_id
         AND write.write_class = 'base'
         AND write.actor_id = v_config.actor_a_id
         AND write.conversation_id = v_config.conversation_ac_id
     ) <> 2
     OR (
       SELECT pg_catalog.count(*)
       FROM private.hosted_realtime_canary_writes AS write
       WHERE write.run_id = p_run_id
         AND write.write_class = 'base'
         AND write.actor_id = v_config.actor_c_id
         AND write.conversation_id = v_config.conversation_ac_id
     ) <> 1
     OR EXISTS (
       SELECT 1
       FROM private.hosted_realtime_canary_writes AS write
       WHERE write.run_id = p_run_id
         AND write.write_class = 'scale'
     ) THEN
    RAISE EXCEPTION 'hosted_realtime_canary_scale_batch_denied'
      USING ERRCODE = '42501';
  END IF;

  -- Only an already-authorized coordinator may take this short lock. Repeat
  -- the external-window check after acquisition so a concurrent ordinary
  -- writer cannot push B over the source table's 30/min trigger boundary.
  LOCK TABLE public.messages IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS (
    SELECT 1
    FROM public.messages AS message
    WHERE message.sender_id IN (
      v_config.actor_a_id,
      v_config.actor_b_id
    )
      AND message.created_at >
        pg_catalog.statement_timestamp() - interval '1 hour 1 second'
      AND NOT EXISTS (
        SELECT 1
        FROM private.hosted_realtime_canary_writes AS write
        WHERE write.run_id = p_run_id
          AND write.message_id = message.id
      )
  ) THEN
    RAISE EXCEPTION 'hosted_realtime_canary_scale_batch_denied'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO private.hosted_realtime_canary_writes (
    message_id,
    run_id,
    actor_id,
    conversation_id,
    marker,
    write_class,
    batch_ordinal,
    expected_created_at
  )
  SELECT
    input.id,
    p_run_id,
    CASE WHEN input.ordinality <= 21
      THEN v_config.actor_a_id ELSE v_config.actor_b_id END,
    v_config.conversation_ab_id,
    'caaci-hosted-canary-' || input.id::text,
    'scale',
    input.ordinality::integer,
    v_created_at
  FROM pg_catalog.unnest(v_sorted) WITH ORDINALITY AS input(id, ordinality);

  PERFORM pg_catalog.set_config(
    'caaci.hosted_canary_insert_run_id', p_run_id::text, true
  );
  INSERT INTO public.messages (
    id,
    conversation_id,
    sender_id,
    content,
    message_type,
    created_at
  )
  SELECT
    input.id,
    v_config.conversation_ab_id,
    CASE WHEN input.ordinality <= 21
      THEN v_config.actor_a_id ELSE v_config.actor_b_id END,
    'caaci-hosted-canary-' || input.id::text,
    'text'::public.message_type,
    v_created_at
  FROM pg_catalog.unnest(v_sorted) WITH ORDINALITY AS input(id, ordinality);
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted <> 51 THEN
    RAISE EXCEPTION 'hosted_realtime_canary_scale_batch_shape_failed'
      USING ERRCODE = '55000';
  END IF;

  UPDATE private.hosted_realtime_canary_writes AS write
  SET inserted_at = v_created_at
  WHERE write.run_id = p_run_id
    AND write.write_class = 'scale';
  UPDATE private.hosted_realtime_canary_runs AS run
  SET attempted_count = run.attempted_count + 51,
      inserted_count = run.inserted_count + 51
  WHERE run.run_id = p_run_id;
  RETURN QUERY SELECT v_inserted, v_created_at;
END
$function$;

REVOKE ALL ON FUNCTION
  public.hosted_realtime_canary_insert_scale_batch(uuid, uuid[])
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.hosted_realtime_canary_insert_scale_batch(uuid, uuid[])
TO authenticated;
ALTER FUNCTION
  public.hosted_realtime_canary_insert_scale_batch(uuid, uuid[])
OWNER TO caaci_hosted_realtime_executor;

CREATE FUNCTION public.hosted_realtime_canary_insert_notification(
  p_run_id uuid,
  p_id uuid
)
RETURNS TABLE(notification_id uuid, created_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_config private.hosted_realtime_canary_environment_config%ROWTYPE;
  v_run private.hosted_realtime_canary_runs%ROWTYPE;
  v_actor uuid;
  v_session_id uuid;
  v_created_at timestamptz := pg_catalog.statement_timestamp();
  v_marker text;
  v_inserted_id uuid;
BEGIN
  SELECT config.* INTO STRICT v_config
  FROM private.hosted_realtime_canary_environment_config AS config
  WHERE config.singleton;
  SELECT context.actor_id, context.session_id
    INTO v_actor, v_session_id
  FROM private.hosted_realtime_canary_auth_context(
    v_config.project_ref,
    v_config.dataset_lineage
  ) AS context;
  SELECT run.* INTO v_run
  FROM private.hosted_realtime_canary_runs AS run
  WHERE run.run_id = p_run_id
  FOR UPDATE;
  v_marker := 'caaci-hosted-notification-' || p_id::text;
  IF v_run.run_id IS NULL
     OR p_id IS NULL
     OR v_actor IS DISTINCT FROM v_config.actor_a_id
     OR v_session_id IS DISTINCT FROM v_run.coordinator_session_id
     OR v_run.coordinator_id <> v_actor
     OR NOT v_config.admission_open
     OR v_run.status <> 'active'
     OR v_run.lease_expires_at <= pg_catalog.statement_timestamp()
     OR v_config.expires_at <= pg_catalog.statement_timestamp()
     OR v_config.provider_proof_expires_at
          <= pg_catalog.statement_timestamp()
     OR NOT private.hosted_realtime_canary_actor_authorized(
       v_actor, 'member-a'
     )
     OR EXISTS (
       SELECT 1 FROM private.hosted_realtime_canary_notifications AS ledger
       WHERE ledger.run_id = p_run_id
          OR ledger.notification_id = p_id
     )
     OR EXISTS (
       SELECT 1 FROM public.notifications AS notification
       WHERE notification.id = p_id
     )
     OR (
       SELECT pg_catalog.count(*)
       FROM private.hosted_realtime_canary_writes AS write
       WHERE write.run_id = p_run_id
         AND write.write_class = 'base'
         AND write.inserted_at IS NOT NULL
     ) <> 8 THEN
    RAISE EXCEPTION 'hosted_realtime_canary_notification_denied'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO private.hosted_realtime_canary_notifications (
    notification_id,
    run_id,
    user_id,
    conversation_id,
    marker,
    expected_created_at,
    expected_emailed_at
  ) VALUES (
    p_id,
    p_run_id,
    v_config.actor_a_id,
    v_config.conversation_ab_id,
    v_marker,
    v_created_at,
    v_created_at
  );
  PERFORM pg_catalog.set_config(
    'caaci.hosted_canary_notification_insert_run_id',
    p_run_id::text,
    true
  );
  INSERT INTO public.notifications (
    id,
    user_id,
    type,
    title,
    body,
    conversation_id,
    is_read,
    created_at,
    emailed_at
  ) VALUES (
    p_id,
    v_config.actor_a_id,
    'system',
    'CAACI hosted Realtime canary',
    v_marker,
    v_config.conversation_ab_id,
    false,
    v_created_at,
    v_created_at
  ) RETURNING notifications.id INTO v_inserted_id;
  UPDATE private.hosted_realtime_canary_notifications AS ledger
  SET inserted_at = v_created_at
  WHERE ledger.run_id = p_run_id
    AND ledger.notification_id = p_id;
  RETURN QUERY SELECT v_inserted_id, v_created_at;
END
$function$;

REVOKE ALL ON FUNCTION
  public.hosted_realtime_canary_insert_notification(uuid, uuid)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.hosted_realtime_canary_insert_notification(uuid, uuid)
TO authenticated;
ALTER FUNCTION
  public.hosted_realtime_canary_insert_notification(uuid, uuid)
OWNER TO caaci_hosted_realtime_executor;

CREATE FUNCTION public.hosted_realtime_canary_set_block(
  p_run_id uuid,
  p_blocked_id uuid,
  p_state boolean
)
RETURNS TABLE(blocked boolean, mutation_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_config private.hosted_realtime_canary_environment_config%ROWTYPE;
  v_run private.hosted_realtime_canary_runs%ROWTYPE;
  v_actor uuid;
  v_role text;
  v_expected_blocked uuid;
  v_existing_count integer;
  v_transition_count integer;
  v_mutation_count integer;
  v_ordinal integer;
BEGIN
  SELECT config.* INTO STRICT v_config
  FROM private.hosted_realtime_canary_environment_config AS config
  WHERE config.singleton;
  SELECT context.actor_id INTO v_actor
  FROM private.hosted_realtime_canary_auth_context(
    v_config.project_ref,
    v_config.dataset_lineage
  ) AS context;
  SELECT run.* INTO v_run
  FROM private.hosted_realtime_canary_runs AS run
  WHERE run.run_id = p_run_id
  FOR UPDATE;
  v_role := CASE
    WHEN v_actor = v_config.actor_a_id THEN 'member-a'
    WHEN v_actor = v_config.actor_b_id THEN 'member-b'
    ELSE NULL
  END;
  v_expected_blocked := CASE
    WHEN v_actor = v_config.actor_a_id THEN v_config.actor_b_id
    WHEN v_actor = v_config.actor_b_id THEN v_config.actor_a_id
    ELSE NULL
  END;
  SELECT pg_catalog.count(*)::integer INTO v_existing_count
  FROM public.blocks AS block_relation
  WHERE block_relation.blocker_id = v_actor
    AND block_relation.blocked_id = p_blocked_id;
  SELECT pg_catalog.count(*)::integer INTO v_transition_count
  FROM private.hosted_realtime_canary_block_transitions AS transition
  WHERE transition.run_id = p_run_id
    AND transition.blocker_id = v_actor;

  IF v_run.run_id IS NULL
     OR p_state IS NULL
     OR p_blocked_id IS DISTINCT FROM v_expected_blocked
     OR NOT v_config.admission_open
     OR v_run.status <> 'active'
     OR v_run.lease_expires_at <= pg_catalog.statement_timestamp()
     OR v_config.expires_at <= pg_catalog.statement_timestamp()
     OR v_config.provider_proof_expires_at
          <= pg_catalog.statement_timestamp()
     OR NOT private.hosted_realtime_canary_actor_authorized(v_actor, v_role)
     OR (p_state AND (v_transition_count <> 0 OR v_existing_count <> 0))
     OR (NOT p_state AND (
       v_transition_count <> 1
       OR v_existing_count <> 1
       OR NOT EXISTS (
         SELECT 1
         FROM private.hosted_realtime_canary_block_transitions AS transition
         WHERE transition.run_id = p_run_id
           AND transition.blocker_id = v_actor
           AND transition.blocked_id = p_blocked_id
           AND transition.transition_ordinal = 1
           AND transition.blocked
           AND transition.applied_at IS NOT NULL
       )
     )) THEN
    RAISE EXCEPTION 'hosted_realtime_canary_block_transition_denied'
      USING ERRCODE = '42501';
  END IF;
  v_ordinal := CASE WHEN p_state THEN 1 ELSE 2 END;
  INSERT INTO private.hosted_realtime_canary_block_transitions (
    run_id,
    blocker_id,
    blocked_id,
    transition_ordinal,
    blocked
  ) VALUES (
    p_run_id,
    v_actor,
    p_blocked_id,
    v_ordinal,
    p_state
  );
  PERFORM pg_catalog.set_config(
    'caaci.hosted_canary_block_run_id', p_run_id::text, true
  );
  IF p_state THEN
    INSERT INTO public.blocks (blocker_id, blocked_id)
    VALUES (v_actor, p_blocked_id);
  ELSE
    DELETE FROM public.blocks AS block_relation
    WHERE block_relation.blocker_id = v_actor
      AND block_relation.blocked_id = p_blocked_id;
  END IF;
  GET DIAGNOSTICS v_mutation_count = ROW_COUNT;
  IF v_mutation_count <> 1 THEN
    RAISE EXCEPTION 'hosted_realtime_canary_block_transition_shape_failed'
      USING ERRCODE = '55000';
  END IF;
  UPDATE private.hosted_realtime_canary_block_transitions AS transition
  SET applied_at = pg_catalog.statement_timestamp()
  WHERE transition.run_id = p_run_id
    AND transition.blocker_id = v_actor
    AND transition.transition_ordinal = v_ordinal;
  RETURN QUERY SELECT p_state, v_mutation_count;
END
$function$;

REVOKE ALL ON FUNCTION
  public.hosted_realtime_canary_set_block(uuid, uuid, boolean)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.hosted_realtime_canary_set_block(uuid, uuid, boolean)
TO authenticated;
ALTER FUNCTION
  public.hosted_realtime_canary_set_block(uuid, uuid, boolean)
OWNER TO caaci_hosted_realtime_executor;

CREATE FUNCTION public.hosted_realtime_canary_cleanup(
  p_run_id uuid,
  p_message_ids uuid[]
)
RETURNS TABLE(deleted_count integer, residue_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_config private.hosted_realtime_canary_environment_config%ROWTYPE;
  v_run private.hosted_realtime_canary_runs%ROWTYPE;
  v_actor uuid;
  v_session_id uuid;
  v_supplied uuid[];
  v_ledger uuid[];
  v_result record;
BEGIN
  SELECT config.* INTO STRICT v_config
  FROM private.hosted_realtime_canary_environment_config AS config
  WHERE config.singleton;
  SELECT context.actor_id, context.session_id
    INTO v_actor, v_session_id
  FROM private.hosted_realtime_canary_auth_context(
    v_config.project_ref,
    v_config.dataset_lineage
  ) AS context;
  SELECT run.* INTO v_run
  FROM private.hosted_realtime_canary_runs AS run
  WHERE run.run_id = p_run_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'hosted_realtime_canary_cleanup_denied'
      USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(
    pg_catalog.array_agg(input.id ORDER BY input.id),
    '{}'::uuid[]
  ) INTO v_supplied
  FROM pg_catalog.unnest(
    coalesce(p_message_ids, '{}'::uuid[])
  ) AS input(id);
  SELECT coalesce(
    pg_catalog.array_agg(write.message_id ORDER BY write.message_id),
    '{}'::uuid[]
  ) INTO v_ledger
  FROM private.hosted_realtime_canary_writes AS write
  WHERE write.run_id = p_run_id;

  IF v_actor IS DISTINCT FROM v_config.actor_a_id
     OR v_run.coordinator_id <> v_actor
     OR v_session_id IS DISTINCT FROM v_run.coordinator_session_id
     OR v_run.status <> 'active'
     OR NOT private.hosted_realtime_canary_actor_authorized(
       v_actor,
       'member-a'
     )
     OR pg_catalog.cardinality(v_supplied) > 8
     OR pg_catalog.cardinality(v_supplied)
          <> (
            SELECT pg_catalog.count(DISTINCT input.id)
            FROM pg_catalog.unnest(v_supplied) AS input(id)
          )
     OR v_supplied IS DISTINCT FROM
          coalesce(p_message_ids, '{}'::uuid[])
     OR NOT (v_supplied @> v_ledger)
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.unnest(v_supplied) AS supplied(id)
       JOIN public.messages AS message ON message.id = supplied.id
       WHERE NOT EXISTS (
         SELECT 1
         FROM private.hosted_realtime_canary_writes AS write
         WHERE write.run_id = p_run_id
           AND write.message_id = supplied.id
           AND write.actor_id = message.sender_id
           AND write.conversation_id = message.conversation_id
           AND write.marker = message.content
       )
     ) THEN
    RAISE EXCEPTION 'hosted_realtime_canary_cleanup_denied'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO STRICT v_result
  FROM private.hosted_realtime_canary_cleanup_run(p_run_id, 'normal');
  RETURN QUERY SELECT
    v_result.deleted_count::integer,
    v_result.residue_count::integer;
END
$function$;

REVOKE ALL ON FUNCTION public.hosted_realtime_canary_cleanup(uuid, uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hosted_realtime_canary_cleanup(uuid, uuid[])
  TO authenticated;
ALTER FUNCTION public.hosted_realtime_canary_cleanup(uuid, uuid[])
  OWNER TO caaci_hosted_realtime_executor;

CREATE FUNCTION public.hosted_realtime_canary_cleanup_v2(
  p_run_id uuid,
  p_message_ids uuid[],
  p_notification_ids uuid[]
)
RETURNS TABLE(
  deleted_messages integer,
  deleted_notifications integer,
  restored_blocks integer,
  residue_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_config private.hosted_realtime_canary_environment_config%ROWTYPE;
  v_run private.hosted_realtime_canary_runs%ROWTYPE;
  v_actor uuid;
  v_session_id uuid;
  v_supplied_messages uuid[];
  v_ledger_messages uuid[];
  v_supplied_notifications uuid[];
  v_ledger_notifications uuid[];
  v_notification_count integer;
  v_block_count integer;
  v_result record;
  v_final_status text;
BEGIN
  SELECT config.* INTO STRICT v_config
  FROM private.hosted_realtime_canary_environment_config AS config
  WHERE config.singleton;
  SELECT context.actor_id, context.session_id
    INTO v_actor, v_session_id
  FROM private.hosted_realtime_canary_auth_context(
    v_config.project_ref,
    v_config.dataset_lineage
  ) AS context;
  SELECT run.* INTO v_run
  FROM private.hosted_realtime_canary_runs AS run
  WHERE run.run_id = p_run_id
  FOR UPDATE;
  SELECT coalesce(
    pg_catalog.array_agg(input.id ORDER BY input.id), '{}'::uuid[]
  ) INTO v_supplied_messages
  FROM pg_catalog.unnest(
    coalesce(p_message_ids, '{}'::uuid[])
  ) AS input(id);
  SELECT coalesce(
    pg_catalog.array_agg(write.message_id ORDER BY write.message_id),
    '{}'::uuid[]
  ) INTO v_ledger_messages
  FROM private.hosted_realtime_canary_writes AS write
  WHERE write.run_id = p_run_id;
  SELECT coalesce(
    pg_catalog.array_agg(input.id ORDER BY input.id), '{}'::uuid[]
  ) INTO v_supplied_notifications
  FROM pg_catalog.unnest(
    coalesce(p_notification_ids, '{}'::uuid[])
  ) AS input(id);
  SELECT coalesce(
    pg_catalog.array_agg(ledger.notification_id ORDER BY ledger.notification_id),
    '{}'::uuid[]
  ) INTO v_ledger_notifications
  FROM private.hosted_realtime_canary_notifications AS ledger
  WHERE ledger.run_id = p_run_id;

  IF v_run.run_id IS NULL
     OR v_actor IS DISTINCT FROM v_config.actor_a_id
     OR v_run.coordinator_id <> v_actor
     OR v_session_id IS DISTINCT FROM v_run.coordinator_session_id
     OR v_run.status <> 'active'
     OR NOT private.hosted_realtime_canary_actor_authorized(
       v_actor, 'member-a'
     )
     OR pg_catalog.cardinality(v_supplied_messages) > 59
     OR v_supplied_messages IS DISTINCT FROM
          coalesce(p_message_ids, '{}'::uuid[])
     OR pg_catalog.cardinality(v_supplied_messages) <> (
       SELECT pg_catalog.count(DISTINCT input.id)
       FROM pg_catalog.unnest(v_supplied_messages) AS input(id)
     )
     OR pg_catalog.cardinality(v_ledger_messages) > 59
     OR NOT (v_supplied_messages @> v_ledger_messages)
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.unnest(v_supplied_messages) AS supplied(id)
       WHERE NOT (supplied.id = ANY(v_ledger_messages))
         AND EXISTS (
           SELECT 1 FROM public.messages AS message
           WHERE message.id = supplied.id
         )
     )
     OR pg_catalog.cardinality(v_supplied_notifications) > 1
     OR v_supplied_notifications IS DISTINCT FROM
          coalesce(p_notification_ids, '{}'::uuid[])
     OR pg_catalog.cardinality(v_ledger_notifications) > 1
     OR NOT (v_supplied_notifications @> v_ledger_notifications)
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.unnest(v_supplied_notifications) AS supplied(id)
       WHERE NOT (supplied.id = ANY(v_ledger_notifications))
         AND EXISTS (
           SELECT 1 FROM public.notifications AS notification
           WHERE notification.id = supplied.id
         )
     ) THEN
    RAISE EXCEPTION 'hosted_realtime_canary_cleanup_v2_denied'
      USING ERRCODE = '42501';
  END IF;

  SELECT pg_catalog.count(*)::integer INTO v_notification_count
  FROM private.hosted_realtime_canary_notifications AS ledger
  WHERE ledger.run_id = p_run_id
    AND ledger.inserted_at IS NOT NULL
    AND ledger.deleted_at IS NULL;
  SELECT pg_catalog.count(*)::integer INTO v_block_count
  FROM public.blocks AS block_relation
  WHERE (block_relation.blocker_id = v_config.actor_a_id
         AND block_relation.blocked_id = v_config.actor_b_id)
     OR (block_relation.blocker_id = v_config.actor_b_id
         AND block_relation.blocked_id = v_config.actor_a_id);

  SELECT * INTO STRICT v_result
  FROM private.hosted_realtime_canary_cleanup_run(p_run_id, 'normal');
  SELECT run.status INTO STRICT v_final_status
  FROM private.hosted_realtime_canary_runs AS run
  WHERE run.run_id = p_run_id;
  RETURN QUERY SELECT
    v_result.deleted_count::integer,
    CASE WHEN v_final_status = 'cleaned'
      THEN v_notification_count ELSE 0 END,
    CASE WHEN v_final_status = 'cleaned'
      THEN v_block_count ELSE 0 END,
    v_result.residue_count::bigint;
END
$function$;

REVOKE ALL ON FUNCTION
  public.hosted_realtime_canary_cleanup_v2(uuid, uuid[], uuid[])
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.hosted_realtime_canary_cleanup_v2(uuid, uuid[], uuid[])
TO authenticated;
ALTER FUNCTION
  public.hosted_realtime_canary_cleanup_v2(uuid, uuid[], uuid[])
OWNER TO caaci_hosted_realtime_executor;

CREATE FUNCTION
  private.hosted_realtime_canary_ttl_cleanup()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_config private.hosted_realtime_canary_environment_config%ROWTYPE;
  v_run_id uuid;
  v_cleaned integer := 0;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'caaci-hosted-realtime-canary-run-v1',
      20260731
    )
  );
  SELECT config.* INTO STRICT v_config
  FROM private.hosted_realtime_canary_environment_config AS config
  WHERE config.singleton
  FOR UPDATE;
  UPDATE private.hosted_realtime_canary_environment_config AS config
  SET last_ttl_heartbeat_at = pg_catalog.statement_timestamp()
  WHERE config.singleton;

  FOR v_run_id IN
    SELECT run.run_id
    FROM private.hosted_realtime_canary_runs AS run
    WHERE run.status = 'active'
      AND (
        run.lease_expires_at <= pg_catalog.statement_timestamp()
        OR v_config.expires_at <= pg_catalog.statement_timestamp()
      )
    ORDER BY run.lease_expires_at, run.run_id
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      PERFORM private.hosted_realtime_canary_cleanup_run(
        v_run_id,
        'ttl'
      );
      v_cleaned := v_cleaned + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE private.hosted_realtime_canary_runs AS run
      SET status = 'quarantined',
          last_cleanup_sqlstate = SQLSTATE
      WHERE run.run_id = v_run_id;
    END;
  END LOOP;

  RETURN v_cleaned;
END
$function$;

REVOKE ALL ON FUNCTION private.hosted_realtime_canary_ttl_cleanup()
  FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION private.hosted_realtime_canary_ttl_cleanup()
  OWNER TO caaci_hosted_realtime_executor;

SET LOCAL ROLE caaci_hosted_realtime_executor;
GRANT EXECUTE ON FUNCTION private.hosted_realtime_canary_ttl_cleanup()
  TO postgres;
RESET ROLE;

-- The target-owner CREATE capability was needed only while transferring
-- ownership. Keep the permanent executor schema surface at USAGE only.
REVOKE CREATE ON SCHEMA public, private
  FROM caaci_hosted_realtime_executor;

-- pg_cron binds username to current_user. Schedule only as the LOGIN operator;
-- the job then crosses into the NOLOGIN executor through SECURITY DEFINER.
SELECT pg_catalog.set_config(
  'caaci.activation_ttl_job_id',
  cron.schedule(
    'caaci-hosted-realtime-canary-ttl-v1',
    '*/5 * * * *',
    'SELECT private.hosted_realtime_canary_ttl_cleanup()'
  )::text,
  true
);

SET LOCAL ROLE caaci_hosted_realtime_executor;

UPDATE private.hosted_realtime_canary_environment_config AS config
SET ttl_job_id = pg_catalog.current_setting(
  'caaci.activation_ttl_job_id'
)::bigint
WHERE config.singleton;

NOTIFY pgrst, 'reload schema';

-- Run the catalog and zero-residue postconditions before the DDL commits.
SELECT pg_catalog.set_config(
  'caaci.activation_verify_require_heartbeat',
  'false',
  true
);
\ir VERIFY_BODY.sql

RESET ROLE;
\ir VERIFY_CRON_BODY.sql

COMMIT;
