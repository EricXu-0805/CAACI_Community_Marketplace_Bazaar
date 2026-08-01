\set ON_ERROR_STOP on

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
  LOCK TABLE public.conversations IN SHARE MODE;
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
  fixture_revision integer NOT NULL CHECK (fixture_revision > 0),
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
  registered_at timestamptz NOT NULL
    DEFAULT pg_catalog.statement_timestamp(),
  inserted_at timestamptz,
  deleted_at timestamptz,
  CHECK (marker = 'caaci-hosted-canary-' || message_id::text)
);

CREATE INDEX hosted_realtime_canary_writes_run_idx
  ON private.hosted_realtime_canary_writes (run_id, message_id);

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

SET LOCAL ROLE caaci_hosted_realtime_executor;

REVOKE ALL ON TABLE
  private.hosted_realtime_canary_environment_config,
  private.hosted_realtime_canary_runs,
  private.hosted_realtime_canary_writes,
  private.hosted_realtime_canary_profile_baselines
FROM PUBLIC, anon, authenticated, service_role;

RESET ROLE;

GRANT USAGE ON SCHEMA public, private, auth
  TO caaci_hosted_realtime_executor;
GRANT SELECT ON TABLE
  auth.users,
  auth.sessions,
  auth.identities,
  public.profiles,
  public.conversations,
  public.messages,
  public.conversation_archives,
  public.notifications
TO caaci_hosted_realtime_executor;
GRANT INSERT (id, conversation_id, sender_id, content, message_type)
  ON TABLE public.messages TO caaci_hosted_realtime_executor;
GRANT DELETE ON TABLE public.messages
  TO caaci_hosted_realtime_executor;
GRANT UPDATE (last_message_at) ON TABLE public.conversations
  TO caaci_hosted_realtime_executor;
GRANT EXECUTE ON FUNCTION public.recompute_seller_response(uuid)
  TO caaci_hosted_realtime_executor;

CREATE OR REPLACE FUNCTION private.hosted_realtime_canary_residue_count(
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

  IF NOT p_ignore_auth_sessions THEN
    SELECT v_count + pg_catalog.count(*)::integer INTO v_count
    FROM auth.sessions AS session
    WHERE session.user_id IN (
      v_config.actor_a_id,
      v_config.actor_b_id,
      v_config.actor_c_id
    )
      AND NOT v_has_active;
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

CREATE OR REPLACE FUNCTION
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
    AND p_actor = auth.uid()
    AND p_expected_role IN ('member-a', 'member-b', 'member-c')
    AND auth.jwt()->>'sub' = p_actor::text
    AND auth.jwt()->>'aud' = 'authenticated'
    AND auth.jwt()->>'iss' =
      'https://' || config.project_ref || '.supabase.co/auth/v1'
    AND CASE
      WHEN auth.jwt()->>'exp' ~ '^[0-9]{10,12}$' THEN
        (auth.jwt()->>'exp')::bigint >
          extract(
            epoch FROM pg_catalog.statement_timestamp()
          )::bigint
      ELSE false
    END
    AND auth.jwt()->'app_metadata'->'caaci_hosted_canary'
      IS NOT DISTINCT FROM 'true'::jsonb
    AND auth.jwt()->'app_metadata'->>'caaci_dataset_lineage' =
      config.dataset_lineage
    AND auth.jwt()->'app_metadata'->>'caaci_canary_role' =
      p_expected_role
    AND CASE p_expected_role
      WHEN 'member-a' THEN p_actor = config.actor_a_id
      WHEN 'member-b' THEN p_actor = config.actor_b_id
      WHEN 'member-c' THEN p_actor = config.actor_c_id
      ELSE false
    END
    AND EXISTS (
      SELECT 1
      FROM auth.users AS user_row
      WHERE user_row.id = p_actor
        AND (
          user_row.banned_until IS NULL
          OR user_row.banned_until <= pg_catalog.statement_timestamp()
        )
        AND user_row.raw_app_meta_data->'caaci_hosted_canary'
          IS NOT DISTINCT FROM 'true'::jsonb
        AND user_row.raw_app_meta_data->>'caaci_dataset_lineage' =
          config.dataset_lineage
        AND user_row.raw_app_meta_data->>'caaci_canary_role' =
          p_expected_role
        AND lower(user_row.email) ~
          '^[^@[:space:]]+@[^@[:space:]]+\.invalid$'
    )
    AND (
      SELECT pg_catalog.count(*)
      FROM auth.identities AS identity
      WHERE identity.user_id = p_actor
        AND identity.provider = 'email'
    ) = 1
    AND NOT EXISTS (
      SELECT 1
      FROM auth.identities AS identity
      WHERE identity.user_id = p_actor
        AND identity.provider <> 'email'
    )
    AND EXISTS (
      SELECT 1
      FROM auth.sessions AS session
      WHERE session.id::text = auth.jwt()->>'session_id'
        AND session.user_id = p_actor
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

CREATE OR REPLACE FUNCTION
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
      AND run.status = 'active'
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

-- The existing seller-response trigger updates profiles and therefore also
-- fires set_profiles_updated_at. During an exact cleanup only, this final
-- alphabetic BEFORE UPDATE trigger restores the captured synthetic-fixture
-- timestamp after the ordinary trigger has run. It cannot bypass a response
-- metric mismatch; cleanup verifies those values independently.
CREATE OR REPLACE FUNCTION
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
        AND run.status = 'active'
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

CREATE OR REPLACE FUNCTION
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

CREATE OR REPLACE FUNCTION public.hosted_realtime_canary_environment()
RETURNS TABLE(
  sentinel_id uuid,
  project_ref text,
  dataset_lineage text,
  fixture_manifest_sha256 text,
  fixture_revision integer,
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

CREATE OR REPLACE FUNCTION public.hosted_realtime_canary_begin_run(
  p_run_id uuid
)
RETURNS TABLE(run_id uuid, lease_expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_config private.hosted_realtime_canary_environment_config%ROWTYPE;
  v_actor uuid := auth.uid();
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
  BEGIN
    v_session_id := nullif(
      auth.jwt()->>'session_id',
      ''
    )::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_session_id := NULL;
  END;
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
     OR (
       SELECT pg_catalog.count(*)
       FROM auth.sessions AS session
       WHERE session.user_id IN (
         v_config.actor_a_id,
         v_config.actor_b_id,
         v_config.actor_c_id
       )
     ) <> 1
     OR NOT EXISTS (
       SELECT 1 FROM auth.sessions AS session
       WHERE session.id = v_session_id
         AND session.user_id = v_actor
     ) THEN
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

CREATE OR REPLACE FUNCTION public.hosted_realtime_canary_insert_message(
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
  v_actor uuid := auth.uid();
  v_role text;
  v_quota integer;
  v_existing integer;
  v_inserted_id uuid;
BEGIN
  SELECT config.* INTO STRICT v_config
  FROM private.hosted_realtime_canary_environment_config AS config
  WHERE config.singleton;
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
    AND write.actor_id = v_actor
    AND write.conversation_id = p_conversation_id;
  IF v_existing >= v_quota OR (
       SELECT pg_catalog.count(*)
       FROM private.hosted_realtime_canary_writes AS write
       WHERE write.run_id = p_run_id
     ) >= 8 THEN
    RAISE EXCEPTION 'hosted_realtime_canary_write_quota_exceeded'
      USING ERRCODE = '54000';
  END IF;

  INSERT INTO private.hosted_realtime_canary_writes (
    message_id,
    run_id,
    actor_id,
    conversation_id,
    marker
  ) VALUES (
    p_id,
    p_run_id,
    v_actor,
    p_conversation_id,
    p_content
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
    message_type
  ) VALUES (
    p_id,
    p_conversation_id,
    v_actor,
    p_content,
    'text'::public.message_type
  )
  RETURNING messages.id INTO v_inserted_id;

  UPDATE private.hosted_realtime_canary_writes AS write
  SET inserted_at = pg_catalog.statement_timestamp()
  WHERE write.message_id = p_id
    AND write.run_id = p_run_id;
  UPDATE private.hosted_realtime_canary_runs AS run
  SET attempted_count = attempted_count + 1,
      inserted_count = inserted_count + 1
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

CREATE OR REPLACE FUNCTION public.hosted_realtime_canary_cleanup(
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
  v_actor uuid := auth.uid();
  v_supplied uuid[];
  v_ledger uuid[];
  v_result record;
BEGIN
  SELECT config.* INTO STRICT v_config
  FROM private.hosted_realtime_canary_environment_config AS config
  WHERE config.singleton;
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
     OR (auth.jwt()->>'session_id') IS DISTINCT FROM
          v_run.coordinator_session_id::text
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

CREATE OR REPLACE FUNCTION
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
