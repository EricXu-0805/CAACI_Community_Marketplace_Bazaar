-- Atomic, actor-attributed and idempotent administrator mutations.
--
-- The Edge API can time out after PostgreSQL committed a write. Retrying the
-- old RPC/direct-PostgREST paths could therefore duplicate suspensions,
-- warning increments or other control-plane changes. It also wrote the actor
-- audit in a separate transaction. This migration introduces one service-only
-- mutation RPC that:
--   * locks and revalidates the bearer token in the mutation transaction;
--   * serializes the small admin write surface to give revoke/action a clear
--     ordering and avoid cross-token revoke deadlocks;
--   * stores one result per (token, idempotency key), replaying it verbatim;
--   * rejects the same key with a different action/payload hash;
--   * writes exactly one required actor/token/key audit row before commit.

BEGIN;

ALTER TABLE public.admin_audit_log
  ADD COLUMN IF NOT EXISTS admin_token_id uuid,
  ADD COLUMN IF NOT EXISTS idempotency_key uuid;

CREATE UNIQUE INDEX IF NOT EXISTS admin_audit_log_admin_mutation_uidx
  ON public.admin_audit_log (admin_token_id, idempotency_key)
  WHERE admin_token_id IS NOT NULL AND idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS admin_audit_log_admin_token_created_idx
  ON public.admin_audit_log (admin_token_id, created_at DESC)
  WHERE admin_token_id IS NOT NULL;

CREATE TABLE public.admin_mutation_requests (
  admin_token_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  actor_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN (
    'apply_ban',
    'lift_suspension',
    'update_report_status',
    'resolve_target_reports',
    'takedown_content',
    'set_post_pinned',
    'upsert_banner',
    'delete_banner',
    'revoke_token'
  )),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (admin_token_id, idempotency_key),
  CHECK (
    (status = 'running' AND result IS NULL AND completed_at IS NULL)
    OR
    (status = 'completed' AND result IS NOT NULL AND completed_at IS NOT NULL)
  )
);

ALTER TABLE public.admin_mutation_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_mutation_requests
  FROM PUBLIC, anon, authenticated, service_role;

CREATE INDEX admin_mutation_requests_actor_created_idx
  ON public.admin_mutation_requests (actor_id, created_at DESC);

-- Context is transaction-local and can only become authoritative when the
-- service-only wrapper sets admin.audit_required=on. Direct legacy RPC calls
-- retain their former best-effort behavior.
CREATE OR REPLACE FUNCTION public.admin_context_actor_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $function$
  SELECT COALESCE(
    NULLIF(pg_catalog.current_setting('admin.actor_id', true), '')::uuid,
    auth.uid()
  );
$function$;

REVOKE ALL ON FUNCTION public.admin_context_actor_id()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_audit(
  event_kind_in text,
  actor_id_in uuid,
  target_id_in uuid,
  details_in jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  audit_required boolean := COALESCE(
    pg_catalog.current_setting('admin.audit_required', true),
    'off'
  ) = 'on';
  context_actor_id uuid;
  context_token_id uuid;
  context_key uuid;
  effective_actor_id uuid;
  effective_details jsonb;
BEGIN
  context_actor_id := NULLIF(
    pg_catalog.current_setting('admin.actor_id', true),
    ''
  )::uuid;
  context_token_id := NULLIF(
    pg_catalog.current_setting('admin.token_id', true),
    ''
  )::uuid;
  context_key := NULLIF(
    pg_catalog.current_setting('admin.idempotency_key', true),
    ''
  )::uuid;

  IF audit_required AND (
    context_actor_id IS NULL
    OR context_token_id IS NULL
    OR context_key IS NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'admin_audit_context_missing';
  END IF;

  effective_actor_id := COALESCE(context_actor_id, actor_id_in);
  effective_details := COALESCE(details_in, '{}'::jsonb);
  IF context_token_id IS NOT NULL AND context_key IS NOT NULL THEN
    effective_details := effective_details || pg_catalog.jsonb_build_object(
      'via', 'admin_execute_mutation',
      'admin_token_id', context_token_id,
      'idempotency_key', context_key
    );
  END IF;

  INSERT INTO public.admin_audit_log (
    event_kind,
    actor_id,
    target_id,
    details,
    admin_token_id,
    idempotency_key
  ) VALUES (
    event_kind_in,
    effective_actor_id,
    target_id_in,
    effective_details,
    context_token_id,
    context_key
  );
EXCEPTION WHEN OTHERS THEN
  IF audit_required THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'admin_audit_required_failed';
  END IF;
  RAISE LOG 'record_audit best-effort failure: event_kind=% sqlstate=%',
    event_kind_in, SQLSTATE;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_audit(text, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_audit(text, uuid, uuid, jsonb)
  TO service_role;

-- Keep the existing RPC signatures for compatibility, but source actor fields
-- from the required transaction context when invoked by the wrapper.
CREATE OR REPLACE FUNCTION public.apply_ban_level(
  target_in uuid,
  level_in smallint,
  reason_in text,
  category_in text DEFAULT 'generic',
  hours_in integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  new_id uuid;
  ban_interval interval;
  ends_at_val timestamptz;
  linked_candidate_count integer := 0;
  admin_actor_id uuid := public.admin_context_actor_id();
BEGIN
  IF level_in NOT BETWEEN 0 AND 5 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_level';
  END IF;
  IF target_in IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_target';
  END IF;
  IF reason_in IS NULL
     OR pg_catalog.length(pg_catalog.btrim(reason_in)) = 0
     OR pg_catalog.length(reason_in) > 1000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_reason';
  END IF;
  IF category_in IS NULL
     OR pg_catalog.length(pg_catalog.btrim(category_in)) = 0
     OR pg_catalog.length(category_in) > 80 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_category';
  END IF;
  IF hours_in IS NOT NULL AND (hours_in < 1 OR hours_in > 87600) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_hours';
  END IF;

  PERFORM 1
    FROM public.profiles AS profile
   WHERE profile.id = target_in
   FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'apply_ban_target_not_found';
  END IF;

  ban_interval := CASE
    WHEN hours_in IS NOT NULL THEN (hours_in || ' hours')::interval
    WHEN level_in IN (0, 1) THEN NULL
    WHEN level_in = 2 THEN interval '72 hours'
    WHEN level_in = 3 THEN interval '7 days'
    WHEN level_in = 4 THEN interval '30 days'
    WHEN level_in = 5 THEN NULL
  END;

  ends_at_val := CASE
    WHEN ban_interval IS NULL AND level_in = 5
      THEN 'infinity'::timestamptz
    WHEN ban_interval IS NULL THEN NULL
    ELSE pg_catalog.now() + ban_interval
  END;

  INSERT INTO public.suspensions (
    profile_id,
    level,
    reason,
    category,
    issued_by,
    ends_at
  ) VALUES (
    target_in,
    level_in,
    reason_in,
    category_in,
    admin_actor_id,
    ends_at_val
  )
  RETURNING id INTO new_id;

  UPDATE public.profiles AS profile
     SET suspension_level = level_in,
         suspended_until = ends_at_val,
         shadow_banned = CASE
           WHEN level_in >= 3 THEN true
           ELSE profile.shadow_banned
         END,
         warning_count = CASE
           WHEN level_in = 1 THEN profile.warning_count + 1
           ELSE profile.warning_count
         END
   WHERE profile.id = target_in;

  IF level_in >= 4 THEN
    SELECT pg_catalog.count(DISTINCT other.profile_id)::integer
      INTO linked_candidate_count
      FROM public.device_fingerprints AS target_fingerprint
      JOIN public.device_fingerprints AS other
        ON other.fp_hash = target_fingerprint.fp_hash
       AND other.profile_id <> target_fingerprint.profile_id
     WHERE target_fingerprint.profile_id = target_in
       AND other.last_seen > pg_catalog.now() - interval '90 days';
  END IF;

  PERFORM public.recompute_trust_score(target_in);

  PERFORM public.record_audit(
    'ban_applied',
    admin_actor_id,
    target_in,
    pg_catalog.jsonb_build_object(
      'suspension_id', new_id,
      'level', level_in,
      'reason', reason_in,
      'category', category_in,
      'ends_at', ends_at_val,
      'linked_fingerprint_candidates', linked_candidate_count,
      'linked_accounts_action', 'manual_review_only'
    )
  );

  RETURN new_id;
END
$function$;

REVOKE ALL ON FUNCTION public.apply_ban_level(uuid, smallint, text, text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_ban_level(uuid, smallint, text, text, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.lift_suspension(
  suspension_id uuid,
  reason_in text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  target uuid;
  max_active_level smallint;
  max_active_ends timestamptz;
  admin_actor_id uuid := public.admin_context_actor_id();
BEGIN
  IF reason_in IS NULL
     OR pg_catalog.length(pg_catalog.btrim(reason_in)) = 0
     OR pg_catalog.length(reason_in) > 1000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_reason';
  END IF;

  UPDATE public.suspensions AS suspension
     SET lifted_at = pg_catalog.now(),
         lifted_by = admin_actor_id,
         lift_reason = reason_in
   WHERE suspension.id = suspension_id
     AND suspension.lifted_at IS NULL
     AND (suspension.ends_at IS NULL OR suspension.ends_at > pg_catalog.now())
  RETURNING suspension.profile_id INTO target;

  IF target IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'suspension_not_active';
  END IF;

  SELECT COALESCE(pg_catalog.max(suspension.level), 0)::smallint,
         pg_catalog.max(suspension.ends_at)
    INTO max_active_level, max_active_ends
    FROM public.suspensions AS suspension
   WHERE suspension.profile_id = target
     AND suspension.started_at <= pg_catalog.now()
     AND suspension.lifted_at IS NULL
     AND (suspension.ends_at IS NULL OR suspension.ends_at > pg_catalog.now());

  UPDATE public.profiles AS profile
     SET suspension_level = COALESCE(max_active_level, 0),
         suspended_until = max_active_ends,
         shadow_banned = COALESCE(max_active_level, 0) >= 3
   WHERE profile.id = target;

  PERFORM public.recompute_trust_score(target);

  PERFORM public.record_audit(
    'suspension_lifted',
    admin_actor_id,
    target,
    pg_catalog.jsonb_build_object(
      'suspension_id', suspension_id,
      'reason', reason_in
    )
  );
END
$function$;

REVOKE ALL ON FUNCTION public.lift_suspension(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lift_suspension(uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.admin_update_report_status(
  report_id_in uuid,
  status_in text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  old_status text;
  admin_actor_id uuid := public.admin_context_actor_id();
BEGIN
  IF status_in NOT IN ('pending', 'reviewed', 'resolved', 'dismissed') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_status';
  END IF;

  SELECT report.status
    INTO old_status
    FROM public.reports AS report
   WHERE report.id = report_id_in
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'report_not_found';
  END IF;

  UPDATE public.reports AS report
     SET status = status_in
   WHERE report.id = report_id_in;

  PERFORM public.record_audit(
    'report_status_changed',
    admin_actor_id,
    report_id_in,
    pg_catalog.jsonb_build_object('from', old_status, 'to', status_in)
  );
END
$function$;

REVOKE ALL ON FUNCTION public.admin_update_report_status(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_report_status(uuid, text)
  TO service_role;

-- Stable internal seams for the follow-up role/capability migration. They are
-- deliberately no-op beyond argument validation in this migration; the outer
-- SECURITY DEFINER wrapper calls them as its owner and nobody receives direct
-- EXECUTE. A later migration can CREATE OR REPLACE only these hooks instead of
-- copying the full mutation dispatcher.
CREATE OR REPLACE FUNCTION public.admin_assert_mutation_capability(
  p_token_id uuid,
  p_action text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF p_token_id IS NULL OR p_action IS NULL OR p_action = '' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'admin_mutation_capability_invalid';
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION public.admin_assert_mutation_capability(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_assert_token_revoke_allowed(
  p_actor_token_id uuid,
  p_target_token_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF p_actor_token_id IS NULL OR p_target_token_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'admin_token_revoke_context_invalid';
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION public.admin_assert_token_revoke_allowed(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_execute_mutation(
  p_token_hash text,
  p_idempotency_key uuid,
  p_payload_hash text,
  p_action text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  token_id_value uuid;
  actor_id_value uuid;
  inserted_rows integer;
  existing_action text;
  existing_payload_hash text;
  existing_status text;
  existing_result jsonb;
  result_value jsonb;
  data_value jsonb;
  id_value uuid;
  secondary_id uuid;
  text_value text;
  secondary_text text;
  level_value integer;
  hours_value integer;
  bool_value boolean;
  affected_rows integer;
  target_token_expires_at timestamptz;
  banner_row public.banners%ROWTYPE;
  image_url_value text;
  target_url_value text;
  title_zh_value text;
  title_en_value text;
  priority_value integer;
  active_value boolean;
  default_value boolean;
  start_at_value timestamptz;
  end_at_value timestamptz;
  has_image boolean;
  has_target boolean;
  has_title_zh boolean;
  has_title_en boolean;
  has_priority boolean;
  has_active boolean;
  has_default boolean;
  has_start boolean;
  has_end boolean;
  is_banner_update boolean;
BEGIN
  -- The admin write rate is tiny. A single transaction lock gives mutation vs
  -- revocation a deterministic order and prevents two admins revoking each
  -- other's locked tokens from deadlocking.
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718180000::bigint);

  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING
      ERRCODE = '28000',
      MESSAGE = 'admin_token_inactive';
  END IF;

  SELECT token.id, token.admin_id
    INTO token_id_value, actor_id_value
    FROM public.admin_tokens AS token
   WHERE token.token_hash = p_token_hash
     AND token.revoked_at IS NULL
     AND (token.expires_at IS NULL OR token.expires_at > pg_catalog.now())
   FOR UPDATE;

  IF token_id_value IS NULL OR actor_id_value IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '28000',
      MESSAGE = 'admin_token_inactive';
  END IF;

  UPDATE public.admin_tokens AS token
     SET last_used_at = pg_catalog.now()
   WHERE token.id = token_id_value;

  IF p_idempotency_key IS NULL
     OR p_payload_hash IS NULL
     OR p_payload_hash !~ '^[0-9a-f]{64}$'
     OR p_action IS NULL
     OR p_action NOT IN (
       'apply_ban',
       'lift_suspension',
       'update_report_status',
       'resolve_target_reports',
       'takedown_content',
       'set_post_pinned',
       'upsert_banner',
       'delete_banner',
       'revoke_token'
     )
     OR pg_catalog.jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'admin_mutation_invalid';
  END IF;

  PERFORM public.admin_assert_mutation_capability(token_id_value, p_action);

  INSERT INTO public.admin_mutation_requests (
    admin_token_id,
    idempotency_key,
    actor_id,
    action,
    payload_hash
  ) VALUES (
    token_id_value,
    p_idempotency_key,
    actor_id_value,
    p_action,
    p_payload_hash
  )
  ON CONFLICT (admin_token_id, idempotency_key) DO NOTHING;
  GET DIAGNOSTICS inserted_rows = ROW_COUNT;

  IF inserted_rows = 0 THEN
    SELECT request.action,
           request.payload_hash,
           request.status,
           request.result
      INTO existing_action,
           existing_payload_hash,
           existing_status,
           existing_result
      FROM public.admin_mutation_requests AS request
     WHERE request.admin_token_id = token_id_value
       AND request.idempotency_key = p_idempotency_key
     FOR UPDATE;

    IF existing_action IS DISTINCT FROM p_action
       OR existing_payload_hash IS DISTINCT FROM p_payload_hash THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'idempotency_conflict';
    END IF;

    IF existing_status = 'completed' AND existing_result IS NOT NULL THEN
      RETURN existing_result;
    END IF;

    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'idempotency_incomplete';
  END IF;

  PERFORM pg_catalog.set_config('admin.actor_id', actor_id_value::text, true);
  PERFORM pg_catalog.set_config('admin.token_id', token_id_value::text, true);
  PERFORM pg_catalog.set_config('admin.idempotency_key', p_idempotency_key::text, true);
  PERFORM pg_catalog.set_config('admin.audit_required', 'on', true);

  IF p_action = 'apply_ban' THEN
    text_value := p_payload ->> 'target_id';
    secondary_text := p_payload ->> 'reason';
    IF text_value IS NULL OR text_value !~* uuid_pattern
       OR pg_catalog.jsonb_typeof(p_payload -> 'level') IS DISTINCT FROM 'number'
       OR (p_payload ->> 'level') !~ '^[0-9]+$'
       OR pg_catalog.length(p_payload ->> 'level') > 1
       OR secondary_text IS NULL
       OR pg_catalog.length(pg_catalog.btrim(secondary_text)) = 0
       OR pg_catalog.length(secondary_text) > 1000 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid_payload';
    END IF;
    id_value := pg_catalog.lower(text_value)::uuid;
    level_value := (p_payload ->> 'level')::integer;
    IF level_value < 0 OR level_value > 5 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid_payload';
    END IF;

    text_value := COALESCE(p_payload ->> 'category', 'generic');
    IF pg_catalog.length(pg_catalog.btrim(text_value)) = 0
       OR pg_catalog.length(text_value) > 80 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid_payload';
    END IF;

    hours_value := NULL;
    IF p_payload ? 'hours' AND p_payload -> 'hours' <> 'null'::jsonb THEN
      IF pg_catalog.jsonb_typeof(p_payload -> 'hours') IS DISTINCT FROM 'number'
         OR (p_payload ->> 'hours') !~ '^[0-9]+$'
         OR pg_catalog.length(p_payload ->> 'hours') > 5 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid_payload';
      END IF;
      hours_value := (p_payload ->> 'hours')::integer;
      IF hours_value < 1 OR hours_value > 87600 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid_payload';
      END IF;
    END IF;

    secondary_id := public.apply_ban_level(
      id_value,
      level_value::smallint,
      secondary_text,
      text_value,
      hours_value
    );
    result_value := pg_catalog.jsonb_build_object('data', secondary_id);

  ELSIF p_action = 'lift_suspension' THEN
    text_value := p_payload ->> 'suspension_id';
    secondary_text := p_payload ->> 'reason';
    IF text_value IS NULL OR text_value !~* uuid_pattern
       OR secondary_text IS NULL
       OR pg_catalog.length(pg_catalog.btrim(secondary_text)) = 0
       OR pg_catalog.length(secondary_text) > 1000 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid_payload';
    END IF;
    id_value := pg_catalog.lower(text_value)::uuid;
    PERFORM public.lift_suspension(id_value, secondary_text);
    result_value := pg_catalog.jsonb_build_object('success', true);

  ELSIF p_action = 'update_report_status' THEN
    text_value := p_payload ->> 'report_id';
    secondary_text := p_payload ->> 'status';
    IF text_value IS NULL OR text_value !~* uuid_pattern
       OR secondary_text IS NULL
       OR secondary_text NOT IN ('pending', 'reviewed', 'resolved', 'dismissed') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid_payload';
    END IF;
    id_value := pg_catalog.lower(text_value)::uuid;
    PERFORM public.admin_update_report_status(id_value, secondary_text);
    result_value := pg_catalog.jsonb_build_object('success', true);

  ELSIF p_action = 'resolve_target_reports' THEN
    text_value := p_payload ->> 'target_id';
    secondary_text := p_payload ->> 'target_type';
    IF text_value IS NULL OR text_value !~* uuid_pattern
       OR secondary_text IS NULL
       OR secondary_text NOT IN ('item', 'user', 'message', 'post', 'comment')
       OR (p_payload ->> 'status') IS NULL
       OR (p_payload ->> 'status') NOT IN ('reviewed', 'resolved', 'dismissed') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid_payload';
    END IF;
    id_value := pg_catalog.lower(text_value)::uuid;
    text_value := p_payload ->> 'status';
    data_value := public.admin_resolve_target_reports(
      secondary_text,
      id_value,
      text_value
    );
    affected_rows := COALESCE((data_value ->> 'affected')::integer, 0);
    IF affected_rows = 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'report_group_not_found';
    END IF;
    PERFORM public.record_audit(
      'report_status_changed',
      actor_id_value,
      id_value,
      pg_catalog.jsonb_build_object(
        'bulk', true,
        'target_type', secondary_text,
        'to', text_value,
        'affected', affected_rows
      )
    );
    result_value := pg_catalog.jsonb_build_object('data', data_value);

  ELSIF p_action = 'takedown_content' THEN
    text_value := p_payload ->> 'target_id';
    secondary_text := p_payload ->> 'target_type';
    IF text_value IS NULL OR text_value !~* uuid_pattern
       OR secondary_text IS NULL
       OR secondary_text NOT IN ('item', 'post', 'comment')
       OR (
         p_payload ? 'reason'
         AND p_payload -> 'reason' <> 'null'::jsonb
         AND (
           pg_catalog.jsonb_typeof(p_payload -> 'reason') <> 'string'
           OR pg_catalog.length(p_payload ->> 'reason') > 1000
         )
       ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid_payload';
    END IF;
    id_value := pg_catalog.lower(text_value)::uuid;
    text_value := p_payload ->> 'reason';
    data_value := public.admin_takedown_content(
      secondary_text,
      id_value,
      text_value
    );
    affected_rows := COALESCE((data_value ->> 'affected')::integer, 0);
    IF affected_rows = 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'content_not_found';
    END IF;
    PERFORM public.record_audit(
      'content_takedown',
      actor_id_value,
      id_value,
      pg_catalog.jsonb_build_object(
        'target_type', secondary_text,
        'reason', text_value,
        'affected', affected_rows
      )
    );
    result_value := pg_catalog.jsonb_build_object('data', data_value);

  ELSIF p_action = 'set_post_pinned' THEN
    text_value := p_payload ->> 'post_id';
    IF text_value IS NULL OR text_value !~* uuid_pattern
       OR pg_catalog.jsonb_typeof(p_payload -> 'pinned') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid_payload';
    END IF;
    id_value := pg_catalog.lower(text_value)::uuid;
    bool_value := (p_payload ->> 'pinned')::boolean;
    UPDATE public.posts AS post
       SET is_pinned = bool_value
     WHERE post.id = id_value
       AND post.status = 'active'
    RETURNING post.id INTO secondary_id;
    IF secondary_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'post_not_found';
    END IF;
    PERFORM public.record_audit(
      'post_pin_changed',
      actor_id_value,
      NULL,
      pg_catalog.jsonb_build_object('post_id', id_value, 'pinned', bool_value)
    );
    result_value := pg_catalog.jsonb_build_object('success', true);

  ELSIF p_action = 'upsert_banner' THEN
    is_banner_update := p_payload ? 'id';
    has_image := p_payload ? 'image_url';
    has_target := p_payload ? 'target_url';
    has_title_zh := p_payload ? 'title_zh';
    has_title_en := p_payload ? 'title_en';
    has_priority := p_payload ? 'priority';
    has_active := p_payload ? 'active';
    has_default := p_payload ? 'is_default';
    has_start := p_payload ? 'start_at';
    has_end := p_payload ? 'end_at';

    IF is_banner_update THEN
      text_value := p_payload ->> 'id';
      IF text_value IS NULL OR text_value !~* uuid_pattern THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid_payload';
      END IF;
      id_value := pg_catalog.lower(text_value)::uuid;
    END IF;
    IF NOT has_image AND NOT has_target AND NOT has_title_zh AND NOT has_title_en
       AND NOT has_priority AND NOT has_active AND NOT has_default
       AND NOT has_start AND NOT has_end THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid_payload';
    END IF;

    IF has_image THEN
      IF pg_catalog.jsonb_typeof(p_payload -> 'image_url') <> 'string' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid_payload';
      END IF;
      image_url_value := p_payload ->> 'image_url';
      IF image_url_value = ''
         OR pg_catalog.length(image_url_value) > 2048
         OR image_url_value !~ '^https://'
         OR image_url_value ~ '[[:cntrl:][:space:]]'
         OR pg_catalog.split_part(pg_catalog.substr(image_url_value, 9), '/', 1) LIKE '%@%' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid_payload';
      END IF;
    ELSIF NOT is_banner_update THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid_payload';
    END IF;

    IF has_target THEN
      IF p_payload -> 'target_url' = 'null'::jsonb THEN
        target_url_value := NULL;
      ELSIF pg_catalog.jsonb_typeof(p_payload -> 'target_url') <> 'string' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid_payload';
      ELSE
        target_url_value := p_payload ->> 'target_url';
        IF target_url_value = '' OR pg_catalog.length(target_url_value) > 2048
           OR target_url_value ~ '[[:cntrl:][:space:]]'
           OR NOT (
             (
               target_url_value LIKE '/pages/%'
               AND target_url_value !~ '[\\#]'
               AND target_url_value !~ '(^|/)\.\.(/|$)'
             )
             OR (
               target_url_value ~ '^https://'
               AND pg_catalog.split_part(pg_catalog.substr(target_url_value, 9), '/', 1) NOT LIKE '%@%'
             )
           ) THEN
          RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid_payload';
        END IF;
      END IF;
    END IF;

    IF has_title_zh THEN
      IF p_payload -> 'title_zh' = 'null'::jsonb THEN title_zh_value := NULL;
      ELSIF pg_catalog.jsonb_typeof(p_payload -> 'title_zh') = 'string'
            AND pg_catalog.length(p_payload ->> 'title_zh') <= 200 THEN
        title_zh_value := p_payload ->> 'title_zh';
      ELSE
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid_payload';
      END IF;
    END IF;
    IF has_title_en THEN
      IF p_payload -> 'title_en' = 'null'::jsonb THEN title_en_value := NULL;
      ELSIF pg_catalog.jsonb_typeof(p_payload -> 'title_en') = 'string'
            AND pg_catalog.length(p_payload ->> 'title_en') <= 200 THEN
        title_en_value := p_payload ->> 'title_en';
      ELSE
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid_payload';
      END IF;
    END IF;

    IF has_priority THEN
      IF pg_catalog.jsonb_typeof(p_payload -> 'priority') IS DISTINCT FROM 'number'
         OR (p_payload ->> 'priority') !~ '^-?[0-9]+$'
         OR pg_catalog.length(p_payload ->> 'priority') > 6 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid_payload';
      END IF;
      priority_value := (p_payload ->> 'priority')::integer;
      IF priority_value < -10000 OR priority_value > 10000 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid_payload';
      END IF;
    END IF;
    IF has_active THEN
      IF pg_catalog.jsonb_typeof(p_payload -> 'active') IS DISTINCT FROM 'boolean' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid_payload';
      END IF;
      active_value := (p_payload ->> 'active')::boolean;
    END IF;
    IF has_default THEN
      IF pg_catalog.jsonb_typeof(p_payload -> 'is_default') IS DISTINCT FROM 'boolean' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid_payload';
      END IF;
      default_value := (p_payload ->> 'is_default')::boolean;
    END IF;

    BEGIN
      IF has_start AND p_payload -> 'start_at' <> 'null'::jsonb THEN
        IF pg_catalog.jsonb_typeof(p_payload -> 'start_at') <> 'string'
           OR pg_catalog.length(p_payload ->> 'start_at') > 64 THEN
          RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid_payload';
        END IF;
        start_at_value := (p_payload ->> 'start_at')::timestamptz;
      END IF;
      IF has_end AND p_payload -> 'end_at' <> 'null'::jsonb THEN
        IF pg_catalog.jsonb_typeof(p_payload -> 'end_at') <> 'string'
           OR pg_catalog.length(p_payload ->> 'end_at') > 64 THEN
          RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid_payload';
        END IF;
        end_at_value := (p_payload ->> 'end_at')::timestamptz;
      END IF;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid_payload';
    END;

    IF is_banner_update THEN
      UPDATE public.banners AS banner
         SET image_url = CASE WHEN has_image THEN image_url_value ELSE banner.image_url END,
             target_url = CASE WHEN has_target THEN target_url_value ELSE banner.target_url END,
             title_zh = CASE WHEN has_title_zh THEN title_zh_value ELSE banner.title_zh END,
             title_en = CASE WHEN has_title_en THEN title_en_value ELSE banner.title_en END,
             priority = CASE WHEN has_priority THEN priority_value ELSE banner.priority END,
             active = CASE WHEN has_active THEN active_value ELSE banner.active END,
             is_default = CASE WHEN has_default THEN default_value ELSE banner.is_default END,
             start_at = CASE WHEN has_start THEN start_at_value ELSE banner.start_at END,
             end_at = CASE WHEN has_end THEN end_at_value ELSE banner.end_at END,
             updated_at = pg_catalog.now()
       WHERE banner.id = id_value
      RETURNING banner.* INTO banner_row;
      IF banner_row.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'banner_not_found';
      END IF;
    ELSE
      INSERT INTO public.banners (
        image_url,
        target_url,
        title_zh,
        title_en,
        priority,
        active,
        is_default,
        start_at,
        end_at
      ) VALUES (
        image_url_value,
        target_url_value,
        title_zh_value,
        title_en_value,
        COALESCE(priority_value, 0),
        COALESCE(active_value, true),
        COALESCE(default_value, false),
        start_at_value,
        end_at_value
      )
      RETURNING * INTO banner_row;
    END IF;

    IF banner_row.start_at IS NOT NULL
       AND banner_row.end_at IS NOT NULL
       AND banner_row.start_at > banner_row.end_at THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid_payload';
    END IF;

    PERFORM public.record_audit(
      'banner_changed',
      actor_id_value,
      NULL,
      pg_catalog.jsonb_build_object(
        'op', CASE WHEN is_banner_update THEN 'updated' ELSE 'created' END,
        'banner_id', banner_row.id
      )
    );
    result_value := pg_catalog.jsonb_build_object('data', pg_catalog.to_jsonb(banner_row));

  ELSIF p_action = 'delete_banner' THEN
    text_value := p_payload ->> 'id';
    IF text_value IS NULL OR text_value !~* uuid_pattern THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid_payload';
    END IF;
    id_value := pg_catalog.lower(text_value)::uuid;
    DELETE FROM public.banners AS banner
     WHERE banner.id = id_value
    RETURNING banner.* INTO banner_row;
    IF banner_row.id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'banner_not_found';
    END IF;
    PERFORM public.record_audit(
      'banner_changed',
      actor_id_value,
      NULL,
      pg_catalog.jsonb_build_object('op', 'deleted', 'banner_id', id_value)
    );
    result_value := pg_catalog.jsonb_build_object('success', true);

  ELSIF p_action = 'revoke_token' THEN
    text_value := p_payload ->> 'token_id';
    IF text_value IS NULL OR text_value !~* uuid_pattern THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid_payload';
    END IF;
    id_value := pg_catalog.lower(text_value)::uuid;
    SELECT token.expires_at
      INTO target_token_expires_at
      FROM public.admin_tokens AS token
     WHERE token.id = id_value
       AND token.revoked_at IS NULL
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'token_not_active';
    END IF;

    IF (target_token_expires_at IS NULL OR target_token_expires_at > pg_catalog.now())
       AND (
         SELECT pg_catalog.count(*)
           FROM public.admin_tokens AS active_token
          WHERE active_token.revoked_at IS NULL
            AND (
              active_token.expires_at IS NULL
              OR active_token.expires_at > pg_catalog.now()
            )
       ) <= 1 THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'last_active_admin_token';
    END IF;

    IF id_value = token_id_value THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'self_revoke_forbidden';
    END IF;

    PERFORM public.admin_assert_token_revoke_allowed(token_id_value, id_value);

    UPDATE public.admin_tokens AS token
       SET revoked_at = pg_catalog.now()
     WHERE token.id = id_value
       AND token.revoked_at IS NULL
    RETURNING token.id INTO secondary_id;
    IF secondary_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'token_not_active';
    END IF;
    PERFORM public.record_audit(
      'token_revoked',
      actor_id_value,
      NULL,
      pg_catalog.jsonb_build_object('token_id', id_value)
    );
    result_value := pg_catalog.jsonb_build_object('success', true);
  END IF;

  IF result_value IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'admin_mutation_result_missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.admin_audit_log AS audit
     WHERE audit.admin_token_id = token_id_value
       AND audit.idempotency_key = p_idempotency_key
       AND audit.actor_id = actor_id_value
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'admin_audit_required_missing';
  END IF;

  UPDATE public.admin_mutation_requests AS request
     SET status = 'completed',
         result = result_value,
         completed_at = pg_catalog.now()
   WHERE request.admin_token_id = token_id_value
     AND request.idempotency_key = p_idempotency_key
     AND request.status = 'running';
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'idempotency_completion_failed';
  END IF;

  PERFORM pg_catalog.set_config('admin.audit_required', 'off', true);
  PERFORM pg_catalog.set_config('admin.actor_id', '', true);
  PERFORM pg_catalog.set_config('admin.token_id', '', true);
  PERFORM pg_catalog.set_config('admin.idempotency_key', '', true);

  RETURN result_value;
END
$function$;

REVOKE ALL ON FUNCTION public.admin_execute_mutation(text, uuid, text, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_execute_mutation(text, uuid, text, text, jsonb)
  TO service_role;

COMMENT ON TABLE public.admin_mutation_requests IS
  'Service-only idempotency ledger for atomic administrator mutations; completed results are replayed verbatim.';
COMMENT ON FUNCTION public.admin_execute_mutation(text, uuid, text, text, jsonb) IS
  'Revalidates an active administrator token and atomically executes, audits and deduplicates one JSON mutation.';
COMMENT ON COLUMN public.admin_audit_log.admin_token_id IS
  'Token snapshot recorded by admin_execute_mutation; intentionally not a foreign key so audit survives token/profile deletion.';
COMMENT ON COLUMN public.admin_audit_log.idempotency_key IS
  'Per-token mutation key linking the committed action, result ledger and required audit row.';

NOTIFY pgrst, 'reload schema';

COMMIT;
