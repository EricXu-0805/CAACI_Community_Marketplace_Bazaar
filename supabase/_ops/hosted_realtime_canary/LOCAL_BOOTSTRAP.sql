\set ON_ERROR_STOP on

-- Disposable PostgreSQL-only fixture for LOCAL_REGRESSION.sql. Never run this
-- file against Supabase, Preview, staging, production, or a shared database.
DO $bootstrap_api_roles$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon'
  ) THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated'
  ) THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role'
  ) THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'supabase_realtime_admin'
  ) THEN
    CREATE ROLE supabase_realtime_admin NOLOGIN;
  END IF;
END
$bootstrap_api_roles$;
DO $bootstrap_role$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'postgres'
  ) THEN
    CREATE ROLE postgres NOLOGIN;
  END IF;
END
$bootstrap_role$;

-- Local regression impersonates the ordinary API role without making the
-- non-superuser installation operator inherit it between explicit SET ROLE
-- blocks. Hosted Supabase already owns its API role/session switching.
GRANT authenticated TO postgres WITH INHERIT FALSE, SET TRUE;

CREATE SCHEMA auth;
CREATE SCHEMA private;
CREATE SCHEMA extensions;
CREATE SCHEMA cron;
CREATE SCHEMA realtime;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text,
  raw_app_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  banned_until timestamptz
);
CREATE TABLE auth.sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id)
);
CREATE TABLE auth.identities (
  user_id uuid NOT NULL REFERENCES auth.users(id),
  provider text NOT NULL
);

CREATE FUNCTION auth.jwt()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
  SELECT coalesce(
    nullif(
      pg_catalog.current_setting('request.jwt.claims', true),
      ''
    ),
    '{}'
  )::jsonb
$function$;

CREATE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $function$
  SELECT CASE
    WHEN auth.jwt()->>'sub' ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN (auth.jwt()->>'sub')::uuid
    ELSE NULL
  END
$function$;

CREATE TABLE cron.job (
  jobid bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  schedule text NOT NULL,
  command text NOT NULL,
  database text NOT NULL,
  username text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  jobname text NOT NULL UNIQUE
);

CREATE FUNCTION cron.schedule(text, text, text)
RETURNS bigint
LANGUAGE plpgsql
AS $function$
DECLARE
  v_job_id bigint;
BEGIN
  INSERT INTO cron.job (jobname, schedule, command, database, username)
  VALUES ($1, $2, $3, pg_catalog.current_database(), current_user)
  RETURNING jobid INTO v_job_id;
  RETURN v_job_id;
END
$function$;

CREATE FUNCTION cron.unschedule(bigint)
RETURNS boolean
LANGUAGE plpgsql
AS $function$
BEGIN
  DELETE FROM cron.job WHERE jobid = $1;
  RETURN FOUND;
END
$function$;

CREATE TYPE public.message_type AS ENUM ('text', 'image', 'video');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL,
  response_rate integer NOT NULL DEFAULT 0,
  response_sample integer NOT NULL DEFAULT 0,
  shadow_banned boolean NOT NULL DEFAULT false,
  suspension_level smallint NOT NULL DEFAULT 0,
  suspended_until timestamptz
);
CREATE TABLE public.conversations (
  id uuid PRIMARY KEY,
  buyer_id uuid NOT NULL REFERENCES public.profiles(id),
  seller_id uuid NOT NULL REFERENCES public.profiles(id),
  last_message_at timestamptz
);
CREATE TABLE public.messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id),
  sender_id uuid NOT NULL REFERENCES public.profiles(id),
  content text NOT NULL,
  message_type public.message_type NOT NULL DEFAULT 'text',
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.statement_timestamp()
);
CREATE TABLE public.conversation_archives (
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id),
  archived_at timestamptz NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  PRIMARY KEY (user_id, conversation_id)
);
CREATE TABLE public.notifications (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id uuid REFERENCES public.conversations(id),
  user_id uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.statement_timestamp()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_archives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION private.current_user_can_access_pair(
  first_user_id uuid,
  second_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND $1 IS NOT NULL
    AND $2 IS NOT NULL
    AND auth.uid() IN ($1, $2)
$function$;

CREATE FUNCTION realtime.topic()
RETURNS text
LANGUAGE sql
STABLE
AS $function$
  SELECT pg_catalog.current_setting('realtime.topic', true)
$function$;

CREATE TABLE realtime.messages (
  topic text,
  extension text NOT NULL,
  event text,
  private boolean NOT NULL DEFAULT true
);

GRANT supabase_realtime_admin TO postgres
  WITH INHERIT FALSE, SET TRUE;
GRANT USAGE, CREATE ON SCHEMA realtime TO supabase_realtime_admin;
GRANT USAGE ON SCHEMA public, auth, private
  TO supabase_realtime_admin;
ALTER TABLE realtime.messages OWNER TO supabase_realtime_admin;

SET ROLE supabase_realtime_admin;
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON realtime.messages
  TO anon, authenticated, service_role;

CREATE POLICY "Conversation participants can receive private realtime"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    realtime.messages.extension IN ('broadcast', 'presence')
    AND EXISTS (
      SELECT 1
      FROM public.conversations AS conversation
      WHERE conversation.id = CASE
        WHEN (SELECT realtime.topic()) ~
          '^conversation:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN pg_catalog.substr((SELECT realtime.topic()), 14)::uuid
        ELSE NULL
      END
        AND (SELECT auth.uid()) IN (
          conversation.buyer_id,
          conversation.seller_id
        )
        AND private.current_user_can_access_pair(
          conversation.buyer_id,
          conversation.seller_id
        )
    )
  );

CREATE POLICY "Conversation participants can send private realtime"
  ON realtime.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    realtime.messages.extension IN ('broadcast', 'presence')
    AND EXISTS (
      SELECT 1
      FROM public.conversations AS conversation
      WHERE conversation.id = CASE
        WHEN (SELECT realtime.topic()) ~
          '^conversation:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN pg_catalog.substr((SELECT realtime.topic()), 14)::uuid
        ELSE NULL
      END
        AND (SELECT auth.uid()) IN (
          conversation.buyer_id,
          conversation.seller_id
        )
        AND private.current_user_can_access_pair(
          conversation.buyer_id,
          conversation.seller_id
        )
    )
  );
RESET ROLE;

REVOKE CREATE ON SCHEMA realtime FROM supabase_realtime_admin;
GRANT USAGE ON SCHEMA public, auth, private, realtime TO authenticated;
GRANT SELECT (id, buyer_id, seller_id)
  ON public.conversations TO authenticated;
GRANT EXECUTE ON FUNCTION
  auth.uid(),
  realtime.topic(),
  private.current_user_can_access_pair(uuid, uuid)
TO authenticated;

CREATE FUNCTION public.local_passthrough_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$function$;

CREATE FUNCTION public.update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := pg_catalog.statement_timestamp();
  RETURN NEW;
END
$function$;

CREATE FUNCTION public.recompute_seller_response(p_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_total integer;
  v_responded integer;
BEGIN
  SELECT
    pg_catalog.count(*)::integer,
    pg_catalog.count(*) FILTER (WHERE seller_replied)::integer
  INTO v_total, v_responded
  FROM (
    SELECT
      conversation.id,
      pg_catalog.bool_or(message.sender_id = p_user) AS seller_replied
    FROM public.conversations AS conversation
    JOIN public.messages AS message
      ON message.conversation_id = conversation.id
    WHERE conversation.seller_id = p_user
    GROUP BY conversation.id, conversation.buyer_id
    HAVING pg_catalog.bool_or(
      message.sender_id = conversation.buyer_id
    )
  ) AS sample;

  UPDATE public.profiles AS profile
  SET response_sample = coalesce(v_total, 0),
      response_rate = CASE
        WHEN coalesce(v_total, 0) > 0 THEN
          pg_catalog.round(
            coalesce(v_responded, 0)::numeric
            / v_total * 100
          )::integer
        ELSE 0
      END
  WHERE profile.id = p_user;
END
$function$;

CREATE FUNCTION public.local_messages_response()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_conversation uuid;
  v_seller uuid;
BEGIN
  v_conversation := CASE
    WHEN TG_OP = 'DELETE' THEN OLD.conversation_id
    ELSE NEW.conversation_id
  END;
  SELECT conversation.seller_id INTO v_seller
  FROM public.conversations AS conversation
  WHERE conversation.id = v_conversation;
  PERFORM public.recompute_seller_response(v_seller);
  RETURN NULL;
END
$function$;

CREATE FUNCTION public.clear_conversation_archives_on_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  DELETE FROM public.conversation_archives AS archive
  WHERE archive.conversation_id = NEW.conversation_id;
  RETURN NEW;
END
$function$;

CREATE TRIGGER authoritative_public_write_boundary
  BEFORE INSERT OR UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.local_passthrough_trigger();
CREATE TRIGGER enforce_actor_messages
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.local_passthrough_trigger();
CREATE TRIGGER moderate_messages
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.local_passthrough_trigger();
CREATE TRIGGER trg_chat_block_boundary
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.local_passthrough_trigger();
CREATE TRIGGER trg_chat_block_boundary_update
  BEFORE UPDATE ON public.messages
  FOR EACH ROW
  WHEN (
    (pg_catalog.to_jsonb(NEW) - 'reminded_at') IS DISTINCT FROM
    (pg_catalog.to_jsonb(OLD) - 'reminded_at')
  )
  EXECUTE FUNCTION public.local_passthrough_trigger();
CREATE TRIGGER trg_clear_archives_message_insert
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_conversation_archives_on_activity();
CREATE TRIGGER trg_messages_response
  AFTER INSERT OR DELETE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.local_messages_response();
CREATE TRIGGER trg_rl_messages_before_insert
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.local_passthrough_trigger();

CREATE TRIGGER authoritative_public_write_boundary
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.local_passthrough_trigger();
CREATE TRIGGER guard_illini_verify_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.local_passthrough_trigger();
CREATE TRIGGER moderate_profiles
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.local_passthrough_trigger();
CREATE TRIGGER profiles_00_lock_admin_recovery_before_delete
  BEFORE DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.local_passthrough_trigger();
CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
  (
    '11111111-1111-4111-8111-111111111111',
    'a@caaci.invalid',
    '{"caaci_hosted_canary":true,"caaci_dataset_lineage":"local-fixture-v1","caaci_canary_role":"member-a"}'
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'b@caaci.invalid',
    '{"caaci_hosted_canary":true,"caaci_dataset_lineage":"local-fixture-v1","caaci_canary_role":"member-b"}'
  ),
  (
    '33333333-3333-4333-8333-333333333333',
    'c@caaci.invalid',
    '{"caaci_hosted_canary":true,"caaci_dataset_lineage":"local-fixture-v1","caaci_canary_role":"member-c"}'
  );
INSERT INTO auth.identities (user_id, provider)
SELECT id, 'email' FROM auth.users ORDER BY id;
INSERT INTO public.profiles (
  id, updated_at, response_rate, response_sample
)
SELECT
  id,
  pg_catalog.statement_timestamp() - interval '1 day',
  0,
  0
FROM auth.users
ORDER BY id;
INSERT INTO public.conversations (
  id, buyer_id, seller_id, last_message_at
) VALUES
  (
    '44444444-4444-4444-8444-444444444444',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    pg_catalog.statement_timestamp() - interval '1 day'
  ),
  (
    '55555555-5555-4555-8555-555555555555',
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333333',
    pg_catalog.statement_timestamp() - interval '1 day'
  );

-- Reproduce the hosted managed-Auth ownership boundary. The runner granted a
-- temporary SET path solely for these ownership transfers and revokes it
-- before LOCAL_REGRESSION.sql starts.
GRANT CREATE ON DATABASE caaci_hosted_realtime_regression
  TO supabase_admin;
GRANT USAGE, CREATE ON SCHEMA auth TO supabase_admin;
ALTER TABLE auth.identities OWNER TO supabase_admin;
ALTER TABLE auth.sessions OWNER TO supabase_admin;
ALTER TABLE auth.users OWNER TO supabase_admin;
ALTER FUNCTION auth.uid() OWNER TO supabase_admin;
ALTER FUNCTION auth.jwt() OWNER TO supabase_admin;
ALTER SCHEMA auth OWNER TO supabase_admin;
REVOKE CREATE ON DATABASE caaci_hosted_realtime_regression
  FROM supabase_admin;

SET ROLE supabase_admin;
CREATE FUNCTION auth.local_canary_set_session(
  p_session_id uuid,
  p_user_id uuid,
  p_present boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $local_canary_set_session$
BEGIN
  IF p_present THEN
    INSERT INTO auth.sessions (id, user_id)
    VALUES (p_session_id, p_user_id)
    ON CONFLICT (id) DO UPDATE
    SET user_id = EXCLUDED.user_id;
  ELSE
    DELETE FROM auth.sessions
    WHERE id = p_session_id
      AND user_id = p_user_id;
  END IF;
END
$local_canary_set_session$;
REVOKE ALL ON FUNCTION auth.local_canary_set_session(uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.local_canary_set_session(uuid, uuid, boolean)
  TO postgres;
GRANT USAGE ON SCHEMA auth TO postgres;
GRANT SELECT ON TABLE auth.users, auth.sessions, auth.identities
  TO postgres;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.jwt() TO postgres;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.jwt()
  TO anon, authenticated, service_role;
RESET ROLE;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
