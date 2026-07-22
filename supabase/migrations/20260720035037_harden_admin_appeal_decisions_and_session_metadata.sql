-- Forward-only administrator lifecycle hardening.
--
-- This tail deliberately leaves every historical migration byte unchanged.
-- It adds a structured three-state appeal review boundary, versioned token
-- session metadata, authoritative appeal filing time, literal administrator
-- search, and service-only audit projections while preserving the existing
-- public mutation signature.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

-- Hold the two established administrator lock namespaces for the complete
-- catalog/data cutover. PRECHECK proves they are free, but it releases its
-- transaction lock before this migration starts; reacquiring here closes that
-- gap and prevents an old authorization or mutation transaction from observing
-- a partially replaced capability/function surface.
SELECT pg_catalog.pg_advisory_xact_lock(20260718180000::bigint);
SELECT pg_catalog.pg_advisory_xact_lock(20260718190000::bigint);

CREATE FUNCTION public.admin_moderation_reason_valid(p_value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
  SELECT p_value IS NOT NULL
     AND pg_catalog.length(pg_catalog.btrim(p_value)) BETWEEN 1 AND 1000
     AND p_value !~ '[[:cntrl:]]'
     AND p_value !~ U&'[\0001-\001F\007F-\009F]'
     AND pg_catalog.strpos(p_value, U&'\061C') = 0
     AND pg_catalog.strpos(p_value, U&'\200E') = 0
     AND pg_catalog.strpos(p_value, U&'\200F') = 0
     AND pg_catalog.strpos(p_value, U&'\202A') = 0
     AND pg_catalog.strpos(p_value, U&'\202B') = 0
     AND pg_catalog.strpos(p_value, U&'\202C') = 0
     AND pg_catalog.strpos(p_value, U&'\202D') = 0
     AND pg_catalog.strpos(p_value, U&'\202E') = 0
     AND pg_catalog.strpos(p_value, U&'\2066') = 0
     AND pg_catalog.strpos(p_value, U&'\2067') = 0
     AND pg_catalog.strpos(p_value, U&'\2068') = 0
     AND pg_catalog.strpos(p_value, U&'\2069') = 0;
$function$;

REVOKE ALL ON FUNCTION public.admin_moderation_reason_valid(text)
  FROM PUBLIC, anon, authenticated, service_role;

-- `suspensions.created_at` is the enforcement-row creation time, not the
-- user's filing time. Preserve unknown provenance for historical appeals as
-- NULL, while every new first-writer submission records the database clock in
-- the same atomic UPDATE as the immutable note.
ALTER TABLE public.suspensions
  ADD COLUMN appeal_submitted_at timestamptz;

ALTER TABLE public.suspensions
  ADD CONSTRAINT suspensions_appeal_submitted_shape_check
  CHECK (appeal_submitted_at IS NULL OR appeal_note IS NOT NULL);

CREATE INDEX suspensions_pending_appeal_submitted_idx
  ON public.suspensions (appeal_submitted_at ASC NULLS FIRST, id ASC)
  WHERE appeal_note IS NOT NULL;

COMMENT ON COLUMN public.suspensions.appeal_submitted_at IS
  'Authoritative database filing time written atomically with a new appeal note; NULL on pre-column historical appeals whose true filing time is unknown.';

CREATE OR REPLACE FUNCTION public.submit_appeal(note_in text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  cleaned_note text;
  updated_suspension_id uuid;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  cleaned_note := pg_catalog.btrim(COALESCE(note_in, ''));
  IF pg_catalog.length(cleaned_note) < 10
     OR pg_catalog.length(cleaned_note) > 2000 THEN
    RAISE EXCEPTION 'invalid_appeal_length' USING ERRCODE = '22023';
  END IF;

  UPDATE public.suspensions AS suspension
     SET appeal_note = cleaned_note,
         appeal_submitted_at = pg_catalog.clock_timestamp()
   WHERE suspension.id = (
     SELECT newest_suspension.id
       FROM public.suspensions AS newest_suspension
      WHERE newest_suspension.profile_id = caller_id
        AND newest_suspension.lifted_at IS NULL
      ORDER BY newest_suspension.created_at DESC, newest_suspension.id DESC
      LIMIT 1
   )
     AND suspension.profile_id = caller_id
     AND suspension.lifted_at IS NULL
     AND suspension.appeal_note IS NULL
     AND suspension.appeal_submitted_at IS NULL
  RETURNING suspension.id INTO updated_suspension_id;

  IF updated_suspension_id IS NULL THEN
    RAISE EXCEPTION 'appeal_unavailable' USING ERRCODE = '55000';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_appeal(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_appeal(text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_appeal(
  note_in text,
  expected_user_id_in uuid,
  expected_suspension_id_in uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  cleaned_note text;
  updated_suspension_id uuid;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF expected_user_id_in IS DISTINCT FROM caller_id THEN
    RAISE EXCEPTION 'account_changed' USING ERRCODE = '42501';
  END IF;

  cleaned_note := pg_catalog.btrim(COALESCE(note_in, ''));
  IF pg_catalog.length(cleaned_note) < 10
     OR pg_catalog.length(cleaned_note) > 2000 THEN
    RAISE EXCEPTION 'invalid_appeal_length' USING ERRCODE = '22023';
  END IF;

  UPDATE public.suspensions AS suspension
     SET appeal_note = cleaned_note,
         appeal_submitted_at = pg_catalog.clock_timestamp()
   WHERE suspension.id = expected_suspension_id_in
     AND suspension.profile_id = caller_id
     AND suspension.lifted_at IS NULL
     AND suspension.appeal_note IS NULL
     AND suspension.appeal_submitted_at IS NULL
  RETURNING suspension.id INTO updated_suspension_id;

  IF updated_suspension_id IS NULL THEN
    RAISE EXCEPTION 'appeal_unavailable' USING ERRCODE = '55000';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_appeal(text, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_appeal(text, uuid, uuid)
  TO authenticated;

-- A lifted suspension row is not necessarily the end of the account's
-- restriction: another stronger/longer active row can remain authoritative.
-- Keep the user notification atomic with the row transition, but describe the
-- effective account state rather than claiming that every restriction ended.
CREATE OR REPLACE FUNCTION public.notify_suspension_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  notification_time timestamptz := pg_catalog.clock_timestamp();
  another_restriction_active boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Historical, already-lifted, expired, future, and level-zero rows are not
    -- new active enforcement and must not generate a misleading alert.
    IF NEW.level >= 1
       AND NEW.started_at <= notification_time
       AND NEW.lifted_at IS NULL
       AND (NEW.ends_at IS NULL OR NEW.ends_at > notification_time) THEN
      INSERT INTO public.notifications (user_id, type, title, body)
      VALUES (
        NEW.profile_id,
        'system',
        CASE WHEN NEW.level = 1
          THEN '收到一次警告 · You received a warning'
          ELSE '账号已被限制 · Your account was restricted'
        END,
        pg_catalog.coalesce(NEW.reason, '')
      );
    END IF;
  ELSIF TG_OP = 'UPDATE'
        AND OLD.lifted_at IS NULL
        AND NEW.lifted_at IS NOT NULL
        AND OLD.level >= 1
        AND OLD.started_at <= notification_time
        AND (OLD.ends_at IS NULL OR OLD.ends_at > notification_time) THEN
    SELECT EXISTS (
      SELECT 1
        FROM public.suspensions AS suspension
       WHERE suspension.profile_id = NEW.profile_id
         AND suspension.id <> NEW.id
         AND suspension.level >= 2
         AND suspension.started_at <= notification_time
         AND suspension.lifted_at IS NULL
         AND (
           suspension.ends_at IS NULL
           OR suspension.ends_at > notification_time
         )
    ) INTO another_restriction_active;

    INSERT INTO public.notifications (user_id, type, title, body)
    VALUES (
      NEW.profile_id,
      'system',
      CASE
        WHEN another_restriction_active
          THEN '一项处置已解除 · One action was lifted'
        WHEN OLD.level >= 2
          THEN '账号限制已解除 · Your restriction was lifted'
        ELSE '一项处置已解除 · One action was lifted'
      END,
      CASE WHEN another_restriction_active
        THEN '另一项账号限制仍在生效 · Another account restriction remains active'
        ELSE ''
      END
    );
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_suspension_change()
  FROM PUBLIC, anon, authenticated, service_role;

-- Reassert the exact trigger timing/event/row contract as part of the same
-- transaction; replacing only the function body would not repair a drifted
-- INSERT-only, BEFORE, disabled, or statement-level trigger.
DROP TRIGGER IF EXISTS trg_notify_suspension_change ON public.suspensions;
CREATE TRIGGER trg_notify_suspension_change
  AFTER INSERT OR UPDATE ON public.suspensions
  FOR EACH ROW EXECUTE FUNCTION public.notify_suspension_change();

-- Extend only the migration-owned role/action vocabulary. The old v1 token
-- authorization RPC below explicitly filters this new capability so an old
-- deployment remains usable while the migration and new Edge build roll out.
ALTER TABLE public.admin_role_action_capabilities
  DROP CONSTRAINT admin_role_action_capabilities_action_check;

ALTER TABLE public.admin_role_action_capabilities
  ADD CONSTRAINT admin_role_action_capabilities_action_check
  CHECK (action IN (
    'apply_ban',
    'lift_suspension',
    'update_report_status',
    'resolve_target_reports',
    'takedown_content',
    'set_post_pinned',
    'upsert_banner',
    'delete_banner',
    'revoke_token',
    'upload_banner',
    'issue_token',
    'revoke_admin_tokens',
    'decide_appeal'
  ));

INSERT INTO public.admin_role_action_capabilities (admin_role, action) VALUES
  ('operator', 'decide_appeal'),
  ('owner', 'decide_appeal')
ON CONFLICT (admin_role, action) DO NOTHING;

ALTER TABLE public.admin_mutation_requests
  DROP CONSTRAINT admin_mutation_requests_action_check;

ALTER TABLE public.admin_mutation_requests
  ADD CONSTRAINT admin_mutation_requests_action_check
  CHECK (action IN (
    'apply_ban',
    'lift_suspension',
    'update_report_status',
    'resolve_target_reports',
    'takedown_content',
    'set_post_pinned',
    'upsert_banner',
    'delete_banner',
    'revoke_token',
    'issue_token',
    'revoke_admin_tokens',
    'decide_appeal'
  ));

ALTER TABLE public.admin_audit_log
  DROP CONSTRAINT admin_audit_log_event_kind_check;

ALTER TABLE public.admin_audit_log
  ADD CONSTRAINT admin_audit_log_event_kind_check
  CHECK (event_kind IN (
    'ban_applied',
    'suspension_lifted',
    'report_status_changed',
    'actor_blocked',
    'admin_login',
    'admin_unauthorized',
    'content_takedown',
    'token_revoked',
    'post_pin_changed',
    'banner_changed',
    'token_issued',
    'appeal_decided',
    'appeal_more_information_requested'
  ));

-- Appeal audit rows are operational state, not retention-eligible telemetry.
-- A terminal row suppresses the pending queue forever. It therefore requires
-- an attributed admin token/idempotency context and a validated minimal shape;
-- deleting or archiving it without a durable tombstone would resurrect a case.
ALTER TABLE public.admin_audit_log
  ADD CONSTRAINT admin_audit_log_appeal_event_shape_check
  CHECK (
    event_kind NOT IN ('appeal_decided', 'appeal_more_information_requested')
    OR COALESCE(
      actor_id IS NOT NULL
      AND admin_token_id IS NOT NULL
      AND idempotency_key IS NOT NULL
      AND target_id IS NOT NULL
      AND pg_catalog.jsonb_typeof(details) = 'object'
      AND details - ARRAY[
        'decision', 'terminal', 'reason', 'effective_at',
        'suspension_active', 'lifted_now', 'remains_active'
      ]::text[] = '{}'::jsonb
      AND pg_catalog.jsonb_typeof(details -> 'decision') = 'string'
      AND (
        (event_kind = 'appeal_decided'
          AND details ->> 'decision' IN ('accepted', 'denied'))
        OR
        (event_kind = 'appeal_more_information_requested'
          AND details ->> 'decision' = 'more_information_required')
      )
      AND pg_catalog.jsonb_typeof(details -> 'terminal') = 'boolean'
      AND (details ->> 'terminal')::boolean = (event_kind = 'appeal_decided')
      AND public.admin_moderation_reason_valid(details ->> 'reason')
      AND pg_catalog.jsonb_typeof(details -> 'effective_at') = 'string'
      AND pg_catalog.length(details ->> 'effective_at') BETWEEN 20 AND 64
      AND pg_catalog.jsonb_typeof(details -> 'suspension_active') = 'boolean'
      AND pg_catalog.jsonb_typeof(details -> 'lifted_now') = 'boolean'
      AND pg_catalog.jsonb_typeof(details -> 'remains_active') = 'boolean'
      AND (details ->> 'lifted_now')::boolean = (
        details ->> 'decision' = 'accepted'
        AND (details ->> 'suspension_active')::boolean
      )
      AND (details ->> 'remains_active')::boolean = (
        (details ->> 'suspension_active')::boolean
        AND details ->> 'decision' <> 'accepted'
      ),
      false
    )
  );

CREATE UNIQUE INDEX admin_audit_log_terminal_appeal_suspension_uidx
  ON public.admin_audit_log (target_id)
  WHERE event_kind = 'appeal_decided';

CREATE INDEX admin_audit_log_appeal_suspension_created_idx
  ON public.admin_audit_log (target_id, created_at DESC, id DESC)
  WHERE event_kind IN ('appeal_decided', 'appeal_more_information_requested');

-- Table ACLs now match the append-only design. SECURITY DEFINER functions
-- retain owner access; Data API roles and the service key cannot directly
-- select, forge, update, delete, truncate, reference, or trigger this ledger.
REVOKE ALL PRIVILEGES ON TABLE public.admin_audit_log
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON SEQUENCE public.admin_audit_log_id_seq
  FROM PUBLIC, anon, authenticated, service_role;

-- Preserve the current required-audit implementation and close record_audit's
-- telemetry path as a way to forge operational appeal state.
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
  context_role text;
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
  context_role := NULLIF(
    pg_catalog.current_setting('admin.role', true),
    ''
  );

  IF event_kind_in IN (
       'appeal_decided', 'appeal_more_information_requested'
     ) AND NOT audit_required THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'appeal_audit_context_required';
  END IF;

  IF audit_required AND (
    context_actor_id IS NULL
    OR context_token_id IS NULL
    OR context_key IS NULL
    OR context_role IS NULL
    OR context_role NOT IN ('operator', 'security_admin', 'owner')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'admin_audit_context_missing';
  END IF;

  effective_actor_id := COALESCE(context_actor_id, actor_id_in);
  effective_details := COALESCE(details_in, '{}'::jsonb);
  IF context_token_id IS NOT NULL
     AND context_key IS NOT NULL
     AND event_kind_in NOT IN (
       'appeal_decided', 'appeal_more_information_requested'
     ) THEN
    effective_details := effective_details || pg_catalog.jsonb_build_object(
      'via', 'admin_execute_mutation',
      'admin_token_id', context_token_id,
      'idempotency_key', context_key,
      'admin_role', context_role
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
  -- Operational appeal state must never look successfully recorded through
  -- the telemetry-only service RPC. Preserve the explicit refusal when no
  -- required mutation context was established; required mutations still map
  -- every audit failure to the stable rollback sentinel below.
  IF event_kind_in IN (
       'appeal_decided', 'appeal_more_information_requested'
     ) AND NOT audit_required THEN
    RAISE;
  END IF;
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
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_audit(text, uuid, uuid, jsonb)
  TO service_role;

-- Reconcile direct helpers so a reason is never optional and direct service
-- calls cannot bypass the atomic required-audit dispatcher.
ALTER FUNCTION public.apply_ban_level(uuid, smallint, text, text, integer)
  RENAME TO apply_ban_level_pre_text_hardening;

REVOKE ALL ON FUNCTION public.apply_ban_level_pre_text_hardening(
  uuid, smallint, text, text, integer
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.apply_ban_level(
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
  normalized_reason text;
  normalized_category text;
  new_suspension_id uuid;
  reconcile_time timestamptz;
  effective_level smallint;
  effective_ends_at timestamptz;
BEGIN
  IF public.admin_moderation_reason_valid(reason_in) IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_reason';
  END IF;
  IF public.admin_moderation_reason_valid(category_in) IS NOT TRUE
     OR pg_catalog.length(pg_catalog.btrim(category_in)) > 80 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_category';
  END IF;

  normalized_reason := pg_catalog.btrim(reason_in);
  normalized_category := pg_catalog.btrim(category_in);
  new_suspension_id := public.apply_ban_level_pre_text_hardening(
    target_in,
    level_in,
    normalized_reason,
    normalized_category,
    hours_in
  );

  -- The predecessor wrote the newly requested level directly onto profiles.
  -- If a stronger overlapping suspension already exists, that cached state is
  -- wrong even though moderation_private.current_profile_state remains right.
  -- Reconcile from the authoritative ordered active set before returning.
  reconcile_time := pg_catalog.clock_timestamp();
  SELECT suspension.level, suspension.ends_at
    INTO effective_level, effective_ends_at
    FROM public.suspensions AS suspension
   WHERE suspension.profile_id = target_in
     AND suspension.started_at <= reconcile_time
     AND suspension.lifted_at IS NULL
     AND (
       suspension.ends_at IS NULL
       OR suspension.ends_at > reconcile_time
     )
   ORDER BY
     suspension.level DESC,
     suspension.ends_at DESC NULLS FIRST,
     suspension.started_at DESC,
     suspension.id DESC
   LIMIT 1;

  UPDATE public.profiles AS profile
     SET suspension_level = COALESCE(effective_level, 0),
         suspended_until = effective_ends_at,
         shadow_banned = COALESCE(effective_level, 0) >= 3
   WHERE profile.id = target_in;

  PERFORM public.recompute_trust_score(target_in);
  RETURN new_suspension_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_ban_level(
  uuid, smallint, text, text, integer
) FROM PUBLIC, anon, authenticated, service_role;

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
  normalized_reason text := pg_catalog.btrim(reason_in);
  effective_level smallint;
  effective_ends_at timestamptz;
  operation_time timestamptz := pg_catalog.clock_timestamp();
  admin_actor_id uuid := public.admin_context_actor_id();
BEGIN
  IF public.admin_moderation_reason_valid(reason_in) IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_reason';
  END IF;

  SELECT suspension.profile_id
    INTO target
    FROM public.suspensions AS suspension
   WHERE suspension.id = suspension_id
     AND suspension.started_at <= operation_time
     AND suspension.lifted_at IS NULL
     AND (
       suspension.ends_at IS NULL
       OR suspension.ends_at > operation_time
     )
   FOR UPDATE;

  IF target IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'suspension_not_active';
  END IF;

  IF admin_actor_id IS NOT NULL AND target = admin_actor_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'self_appeal_decision_forbidden';
  END IF;

  UPDATE public.suspensions AS suspension
     SET lifted_at = operation_time,
         lifted_by = admin_actor_id,
         lift_reason = normalized_reason
   WHERE suspension.id = suspension_id;

  SELECT suspension.level, suspension.ends_at
    INTO effective_level, effective_ends_at
    FROM public.suspensions AS suspension
   WHERE suspension.profile_id = target
     AND suspension.started_at <= operation_time
     AND suspension.lifted_at IS NULL
     AND (
       suspension.ends_at IS NULL
       OR suspension.ends_at > operation_time
     )
   ORDER BY
     suspension.level DESC,
     suspension.ends_at DESC NULLS FIRST,
     suspension.started_at DESC,
     suspension.id DESC
   LIMIT 1;

  UPDATE public.profiles AS profile
     SET suspension_level = COALESCE(effective_level, 0),
         suspended_until = effective_ends_at,
         shadow_banned = COALESCE(effective_level, 0) >= 3
   WHERE profile.id = target;

  PERFORM public.recompute_trust_score(target);

  PERFORM public.record_audit(
    'suspension_lifted',
    admin_actor_id,
    target,
    pg_catalog.jsonb_build_object(
      'suspension_id', suspension_id,
      'reason', normalized_reason
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.lift_suspension(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_takedown_content(
  target_type_in text,
  target_id_in uuid,
  reason_in text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  affected integer := 0;
  post_id_value uuid;
BEGIN
  IF public.admin_moderation_reason_valid(reason_in) IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_reason';
  END IF;

  IF target_type_in = 'item' THEN
    UPDATE public.items AS item
       SET status = 'deleted'
     WHERE item.id = target_id_in
       AND item.status <> 'deleted';
    GET DIAGNOSTICS affected = ROW_COUNT;
  ELSIF target_type_in = 'post' THEN
    UPDATE public.posts AS post
       SET status = 'hidden'
     WHERE post.id = target_id_in
       AND post.status = 'active';
    GET DIAGNOSTICS affected = ROW_COUNT;
  ELSIF target_type_in = 'comment' THEN
    UPDATE public.post_comments AS comment
       SET status = 'hidden'
     WHERE comment.id = target_id_in
       AND comment.status = 'active'
    RETURNING comment.post_id INTO post_id_value;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected > 0 THEN
      UPDATE public.posts AS post
         SET comment_count = GREATEST(0, post.comment_count - 1)
       WHERE post.id = post_id_value;
    END IF;
  ELSE
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'unsupported_target_type';
  END IF;

  RETURN pg_catalog.jsonb_build_object('ok', true, 'affected', affected);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_takedown_content(text, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- Keep the v1 row shape and old exact capability set for zero-downtime
-- migration-first rollout and rollback. Marketplace moderation and admin-token
-- authorization remain separate domains; reviewer independence is enforced
-- at the suspension mutation itself to avoid last-owner recovery lockout.
CREATE OR REPLACE FUNCTION public.admin_token_authorization(p_token_hash text)
RETURNS TABLE (
  admin_id uuid,
  admin_name text,
  admin_email text,
  role text,
  capabilities text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  authorization_time timestamptz;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(20260718180000::bigint);
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718190000::bigint);
  authorization_time := pg_catalog.clock_timestamp();

  RETURN QUERY
  WITH matched AS (
    UPDATE public.admin_tokens AS token
       SET last_used_at = authorization_time
     WHERE token.token_hash = p_token_hash
       AND token.admin_id IS NOT NULL
       AND token.revoked_at IS NULL
       AND (token.expires_at IS NULL OR token.expires_at > authorization_time)
       AND EXISTS (
         SELECT 1
           FROM public.profiles AS profile
          WHERE profile.id = token.admin_id
       )
    RETURNING token.admin_id, token.admin_name, token.admin_email, token.role
  )
  SELECT matched.admin_id,
         matched.admin_name,
         matched.admin_email,
         matched.role,
         ARRAY(
           SELECT capability.action
             FROM public.admin_role_action_capabilities AS capability
            WHERE capability.admin_role = matched.role
              AND capability.action <> 'decide_appeal'
            ORDER BY capability.action
         )::text[]
    FROM matched;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_token_authorization(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_token_authorization(text)
  TO service_role;

CREATE FUNCTION public.admin_token_authorization_v2(p_token_hash text)
RETURNS TABLE (
  token_id uuid,
  admin_id uuid,
  admin_name text,
  admin_email text,
  role text,
  expires_at timestamptz,
  server_now timestamptz,
  capabilities text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  authorization_time timestamptz;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(20260718180000::bigint);
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718190000::bigint);
  authorization_time := pg_catalog.clock_timestamp();

  RETURN QUERY
  WITH matched AS (
    UPDATE public.admin_tokens AS token
       SET last_used_at = authorization_time
     WHERE token.token_hash = p_token_hash
       AND token.admin_id IS NOT NULL
       AND token.revoked_at IS NULL
       AND (token.expires_at IS NULL OR token.expires_at > authorization_time)
       AND EXISTS (
         SELECT 1
           FROM public.profiles AS profile
          WHERE profile.id = token.admin_id
       )
    RETURNING
      token.id,
      token.admin_id,
      token.admin_name,
      token.admin_email,
      token.role,
      token.expires_at
  )
  SELECT matched.id,
         matched.admin_id,
         matched.admin_name,
         matched.admin_email,
         matched.role,
         matched.expires_at,
         authorization_time,
         ARRAY(
           SELECT capability.action
             FROM public.admin_role_action_capabilities AS capability
            WHERE capability.admin_role = matched.role
            ORDER BY capability.action
         )::text[]
    FROM matched;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_token_authorization_v2(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_token_authorization_v2(text)
  TO service_role;

-- Literal search: %, _ and backslash are data, never wildcard controls. A
-- non-UUID query must contain at least two characters to prevent broad user
-- enumeration; exact UUID lookup remains available.
CREATE OR REPLACE FUNCTION public.admin_search_users(
  query_in text,
  limit_in integer DEFAULT 25
)
RETURNS TABLE (
  id uuid,
  nickname text,
  email text,
  avatar_url text,
  trust_score smallint,
  warning_count integer,
  suspension_level smallint,
  suspended_until timestamptz,
  shadow_banned boolean,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  WITH parameter AS (
    SELECT pg_catalog.btrim(COALESCE(query_in, '')) AS query
  ), normalized AS (
    SELECT parameter.query,
           pg_catalog.replace(
             pg_catalog.replace(
               pg_catalog.replace(
                 parameter.query,
                 pg_catalog.chr(92),
                 pg_catalog.chr(92) || pg_catalog.chr(92)
               ),
               '%',
               pg_catalog.chr(92) || '%'
             ),
             '_',
             pg_catalog.chr(92) || '_'
           ) AS escaped_query,
           parameter.query ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             AS is_uuid
      FROM parameter
  )
  SELECT
    profile.id,
    profile.nickname,
    profile.email,
    profile.avatar_url,
    public.compute_trust_score(profile.id),
    profile.warning_count,
    state.suspension_level,
    state.suspended_until,
    state.shadow_banned,
    profile.created_at
  FROM public.profiles AS profile
  CROSS JOIN normalized
  CROSS JOIN LATERAL moderation_private.current_profile_state(profile.id)
    AS state
  WHERE (
      normalized.is_uuid
      AND profile.id::text = pg_catalog.lower(normalized.query)
    )
    OR (
      NOT normalized.is_uuid
      AND pg_catalog.length(normalized.query) BETWEEN 2 AND 200
      AND (
        profile.nickname ILIKE '%' || normalized.escaped_query || '%'
          ESCAPE '\'
        OR profile.email ILIKE '%' || normalized.escaped_query || '%'
          ESCAPE '\'
      )
    )
  ORDER BY
    (state.suspension_level > 0) DESC,
    profile.warning_count DESC,
    profile.nickname,
    profile.id
  LIMIT GREATEST(1, LEAST(COALESCE(limit_in, 25), 50));
$function$;

REVOKE ALL ON FUNCTION public.admin_search_users(text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_search_users(text, integer)
  TO service_role;

-- Keep v1 readable by a rolled-back deployment while teaching it terminal
-- closure and FIFO ordering by authoritative filing time. v2 exposes filing,
-- lifted, and latest more-information state to the new dashboard without
-- changing v1's OUT row type.
CREATE OR REPLACE FUNCTION public.admin_list_appeals(
  limit_in integer DEFAULT 50,
  offset_in integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  profile_id uuid,
  profile_nickname text,
  profile_avatar_url text,
  level smallint,
  reason text,
  ends_at timestamptz,
  appeal_note text,
  created_at timestamptz,
  issued_by uuid,
  issued_by_nickname text,
  lifted_by uuid,
  lifted_by_nickname text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT
    suspension.id,
    suspension.profile_id,
    profile.nickname,
    profile.avatar_url,
    suspension.level,
    suspension.reason,
    suspension.ends_at,
    suspension.appeal_note,
    suspension.created_at,
    suspension.issued_by,
    issuer.nickname,
    suspension.lifted_by,
    lifter.nickname
  FROM public.suspensions AS suspension
  JOIN public.profiles AS profile
    ON profile.id = suspension.profile_id
  LEFT JOIN public.profiles AS issuer
    ON issuer.id = suspension.issued_by
  LEFT JOIN public.profiles AS lifter
    ON lifter.id = suspension.lifted_by
  WHERE suspension.appeal_note IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
        FROM public.admin_audit_log AS terminal
       WHERE terminal.event_kind = 'appeal_decided'
         AND terminal.target_id = suspension.id
    )
  ORDER BY
    suspension.appeal_submitted_at ASC NULLS FIRST,
    suspension.id ASC
  LIMIT GREATEST(1, LEAST(limit_in, 200))
  OFFSET GREATEST(0, offset_in);
$function$;

REVOKE ALL ON FUNCTION public.admin_list_appeals(integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_appeals(integer, integer)
  TO service_role;

CREATE FUNCTION public.admin_list_appeals_v2(
  limit_in integer DEFAULT 50,
  offset_in integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  profile_id uuid,
  profile_nickname text,
  profile_avatar_url text,
  level smallint,
  reason text,
  ends_at timestamptz,
  appeal_note text,
  appeal_submitted_at timestamptz,
  created_at timestamptz,
  issued_by uuid,
  issued_by_nickname text,
  lifted_at timestamptz,
  lifted_by uuid,
  lifted_by_nickname text,
  review_status text,
  reviewed_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT
    suspension.id,
    suspension.profile_id,
    profile.nickname,
    profile.avatar_url,
    suspension.level,
    suspension.reason,
    suspension.ends_at,
    suspension.appeal_note,
    suspension.appeal_submitted_at,
    suspension.created_at,
    suspension.issued_by,
    issuer.nickname,
    suspension.lifted_at,
    suspension.lifted_by,
    lifter.nickname,
    CASE WHEN latest_more.created_at IS NULL
      THEN 'pending'
      ELSE 'more_information_required'
    END,
    latest_more.created_at
  FROM public.suspensions AS suspension
  JOIN public.profiles AS profile
    ON profile.id = suspension.profile_id
  LEFT JOIN public.profiles AS issuer
    ON issuer.id = suspension.issued_by
  LEFT JOIN public.profiles AS lifter
    ON lifter.id = suspension.lifted_by
  LEFT JOIN LATERAL (
    SELECT audit.created_at
      FROM public.admin_audit_log AS audit
     WHERE audit.event_kind = 'appeal_more_information_requested'
       AND audit.target_id = suspension.id
     ORDER BY audit.created_at DESC, audit.id DESC
     LIMIT 1
  ) AS latest_more ON true
  WHERE suspension.appeal_note IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
        FROM public.admin_audit_log AS terminal
       WHERE terminal.event_kind = 'appeal_decided'
         AND terminal.target_id = suspension.id
    )
  ORDER BY
    suspension.appeal_submitted_at ASC NULLS FIRST,
    suspension.id ASC
  LIMIT GREATEST(1, LEAST(limit_in, 200))
  OFFSET GREATEST(0, offset_in);
$function$;

REVOKE ALL ON FUNCTION public.admin_list_appeals_v2(integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_appeals_v2(integer, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.admin_dashboard_stats()
RETURNS TABLE (
  active_suspensions integer,
  pending_reports integer,
  pending_appeals integer,
  shadow_banned integer,
  oldest_pending_hours integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT
    (
      SELECT pg_catalog.count(*)::integer
        FROM public.suspensions AS suspension
       WHERE suspension.level >= 2
         AND suspension.started_at <= pg_catalog.statement_timestamp()
         AND suspension.lifted_at IS NULL
         AND (
           suspension.ends_at IS NULL
           OR suspension.ends_at > pg_catalog.statement_timestamp()
         )
    ),
    (
      SELECT pg_catalog.count(*)::integer
        FROM public.reports AS report
       WHERE report.status = 'pending'
    ),
    (
      SELECT pg_catalog.count(*)::integer
        FROM public.suspensions AS suspension
       WHERE suspension.appeal_note IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
             FROM public.admin_audit_log AS terminal
            WHERE terminal.event_kind = 'appeal_decided'
              AND terminal.target_id = suspension.id
         )
    ),
    (
      SELECT pg_catalog.count(DISTINCT suspension.profile_id)::integer
        FROM public.suspensions AS suspension
       WHERE suspension.level >= 3
         AND suspension.started_at <= pg_catalog.statement_timestamp()
         AND suspension.lifted_at IS NULL
         AND (
           suspension.ends_at IS NULL
           OR suspension.ends_at > pg_catalog.statement_timestamp()
         )
    ),
    (
      SELECT pg_catalog.floor(
        EXTRACT(
          epoch FROM (
            pg_catalog.statement_timestamp() - pg_catalog.min(report.created_at)
          )
        ) / 3600
      )::integer
        FROM public.reports AS report
       WHERE report.status = 'pending'
    );
$function$;

REVOKE ALL ON FUNCTION public.admin_dashboard_stats()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_stats()
  TO service_role;

-- Operators receive only moderation events and event-specific projections.
-- Filtering occurs before pagination; token governance case IDs, approvals,
-- token IDs, actor-token IDs and idempotency keys never reach their response.
CREATE FUNCTION public.admin_list_moderation_audit_log(
  limit_in integer DEFAULT 100,
  offset_in integer DEFAULT 0,
  kind_filter text DEFAULT NULL
)
RETURNS TABLE (
  id bigint,
  event_kind text,
  actor_id uuid,
  actor_nickname text,
  target_id uuid,
  target_nickname text,
  details jsonb,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT
    audit.id,
    audit.event_kind,
    audit.actor_id,
    actor.nickname,
    audit.target_id,
    target.nickname,
    CASE audit.event_kind
      WHEN 'ban_applied' THEN pg_catalog.jsonb_strip_nulls(
        pg_catalog.jsonb_build_object(
          'suspension_id', audit.details -> 'suspension_id',
          'level', audit.details -> 'level',
          'reason', audit.details -> 'reason',
          'category', audit.details -> 'category',
          'ends_at', audit.details -> 'ends_at',
          'linked_fingerprint_candidates',
            audit.details -> 'linked_fingerprint_candidates',
          'linked_accounts_action', audit.details -> 'linked_accounts_action'
        )
      )
      WHEN 'suspension_lifted' THEN pg_catalog.jsonb_strip_nulls(
        pg_catalog.jsonb_build_object(
          'suspension_id', audit.details -> 'suspension_id',
          'reason', audit.details -> 'reason'
        )
      )
      WHEN 'report_status_changed' THEN pg_catalog.jsonb_strip_nulls(
        pg_catalog.jsonb_build_object(
          'from', audit.details -> 'from',
          'to', audit.details -> 'to',
          'bulk', audit.details -> 'bulk',
          'target_type', audit.details -> 'target_type',
          'affected', audit.details -> 'affected'
        )
      )
      WHEN 'content_takedown' THEN pg_catalog.jsonb_strip_nulls(
        pg_catalog.jsonb_build_object(
          'target_type', audit.details -> 'target_type',
          'reason', audit.details -> 'reason',
          'affected', audit.details -> 'affected'
        )
      )
      WHEN 'actor_blocked' THEN pg_catalog.jsonb_strip_nulls(
        pg_catalog.jsonb_build_object(
          'table', audit.details -> 'table',
          'level', audit.details -> 'level',
          'ends_at', audit.details -> 'ends_at'
        )
      )
      ELSE pg_catalog.jsonb_strip_nulls(
        pg_catalog.jsonb_build_object(
          'decision', audit.details -> 'decision',
          'terminal', audit.details -> 'terminal',
          'reason', audit.details -> 'reason',
          'effective_at', audit.details -> 'effective_at',
          'suspension_active', audit.details -> 'suspension_active',
          'lifted_now', audit.details -> 'lifted_now',
          'remains_active', audit.details -> 'remains_active'
        )
      )
    END,
    audit.created_at
  FROM public.admin_audit_log AS audit
  LEFT JOIN public.profiles AS actor
    ON actor.id = audit.actor_id
  LEFT JOIN public.suspensions AS appeal_suspension
    ON audit.event_kind IN (
      'appeal_decided', 'appeal_more_information_requested'
    )
   AND appeal_suspension.id = audit.target_id
  LEFT JOIN public.profiles AS target
    ON target.id = COALESCE(appeal_suspension.profile_id, audit.target_id)
  WHERE audit.event_kind IN (
      'ban_applied',
      'suspension_lifted',
      'report_status_changed',
      'content_takedown',
      'actor_blocked',
      'appeal_decided',
      'appeal_more_information_requested'
    )
    AND (kind_filter IS NULL OR audit.event_kind = kind_filter)
  ORDER BY audit.created_at DESC, audit.id DESC
  LIMIT GREATEST(1, LEAST(limit_in, 500))
  OFFSET GREATEST(0, offset_in);
$function$;

REVOKE ALL ON FUNCTION public.admin_list_moderation_audit_log(
  integer, integer, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_moderation_audit_log(
  integer, integer, text
) TO service_role;

-- The legacy RPC becomes safe-by-default so rolling back to an older Edge
-- build cannot re-expose token-governance evidence to an operator. The new
-- API uses the versioned owner RPC below only after token-role authorization.
CREATE OR REPLACE FUNCTION public.admin_list_audit_log(
  limit_in integer DEFAULT 100,
  offset_in integer DEFAULT 0,
  kind_filter text DEFAULT NULL
)
RETURNS TABLE (
  id bigint,
  event_kind text,
  actor_id uuid,
  actor_nickname text,
  target_id uuid,
  target_nickname text,
  details jsonb,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT *
    FROM public.admin_list_moderation_audit_log(
      limit_in,
      offset_in,
      kind_filter
    );
$function$;

REVOKE ALL ON FUNCTION public.admin_list_audit_log(integer, integer, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_audit_log(integer, integer, text)
  TO service_role;

CREATE FUNCTION public.admin_list_owner_audit_log(
  limit_in integer DEFAULT 100,
  offset_in integer DEFAULT 0,
  kind_filter text DEFAULT NULL
)
RETURNS TABLE (
  id bigint,
  event_kind text,
  actor_id uuid,
  actor_nickname text,
  target_id uuid,
  target_nickname text,
  details jsonb,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT
    audit.id,
    audit.event_kind,
    audit.actor_id,
    actor.nickname,
    audit.target_id,
    target.nickname,
    audit.details,
    audit.created_at
  FROM public.admin_audit_log AS audit
  LEFT JOIN public.profiles AS actor
    ON actor.id = audit.actor_id
  LEFT JOIN public.suspensions AS appeal_suspension
    ON audit.event_kind IN (
      'appeal_decided', 'appeal_more_information_requested'
    )
   AND appeal_suspension.id = audit.target_id
  LEFT JOIN public.profiles AS target
    ON target.id = COALESCE(appeal_suspension.profile_id, audit.target_id)
  WHERE kind_filter IS NULL OR audit.event_kind = kind_filter
  ORDER BY audit.created_at DESC, audit.id DESC
  LIMIT GREATEST(1, LEAST(limit_in, 500))
  OFFSET GREATEST(0, offset_in);
$function$;

REVOKE ALL ON FUNCTION public.admin_list_owner_audit_log(
  integer, integer, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_owner_audit_log(
  integer, integer, text
) TO service_role;

-- Preserve the current dispatcher under a private name. Every pre-existing
-- action remains byte-for-byte delegated through that predecessor.
ALTER FUNCTION public.admin_execute_mutation(text, uuid, text, text, jsonb)
  RENAME TO admin_execute_mutation_pre_appeal_lifecycle;

REVOKE ALL ON FUNCTION public.admin_execute_mutation_pre_appeal_lifecycle(
  text, uuid, text, text, jsonb
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.admin_execute_appeal_decision(
  p_token_hash text,
  p_idempotency_key uuid,
  p_payload_hash text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  uuid_pattern constant text :=
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  actor_token_id uuid;
  actor_id_value uuid;
  actor_role_value text;
  inserted_rows integer;
  existing_action text;
  existing_payload_hash text;
  existing_status text;
  existing_result jsonb;
  result_value jsonb;
  suspension_id_value uuid;
  profile_id_value uuid;
  decision_value text;
  reason_value text;
  payload_key text;
  suspension_started_at timestamptz;
  suspension_ends_at timestamptz;
  suspension_lifted_at timestamptz;
  suspension_appeal_note text;
  decision_time timestamptz;
  suspension_active boolean;
  lifted_now boolean := false;
  remains_active boolean;
  terminal boolean;
  effective_level smallint;
  effective_ends_at timestamptz;
  affected_rows integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718180000::bigint);
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718190000::bigint);
  decision_time := pg_catalog.clock_timestamp();

  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'admin_token_inactive';
  END IF;

  SELECT token.id, token.admin_id, token.role
    INTO actor_token_id, actor_id_value, actor_role_value
    FROM public.admin_tokens AS token
   WHERE token.token_hash = p_token_hash
     AND token.admin_id IS NOT NULL
     AND token.revoked_at IS NULL
     AND (token.expires_at IS NULL OR token.expires_at > decision_time)
     AND EXISTS (
       SELECT 1
         FROM public.profiles AS actor_profile
        WHERE actor_profile.id = token.admin_id
     )
   FOR UPDATE;

  IF actor_token_id IS NULL OR actor_id_value IS NULL
     OR actor_role_value NOT IN ('operator', 'security_admin', 'owner') THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'admin_token_inactive';
  END IF;

  UPDATE public.admin_tokens AS token
     SET last_used_at = decision_time
   WHERE token.id = actor_token_id;

  IF p_idempotency_key IS NULL
     OR p_payload_hash IS NULL
     OR p_payload_hash !~ '^[0-9a-f]{64}$'
     OR pg_catalog.jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid';
  END IF;

  FOR payload_key IN SELECT pg_catalog.jsonb_object_keys(p_payload) LOOP
    IF payload_key NOT IN ('suspension_id', 'decision', 'reason') THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'admin_mutation_invalid_payload';
    END IF;
  END LOOP;

  IF pg_catalog.jsonb_typeof(p_payload -> 'suspension_id') IS DISTINCT FROM 'string'
     OR (p_payload ->> 'suspension_id') !~* uuid_pattern
     OR pg_catalog.jsonb_typeof(p_payload -> 'decision') IS DISTINCT FROM 'string'
     OR (p_payload ->> 'decision') NOT IN (
       'accepted', 'denied', 'more_information_required'
     )
     OR pg_catalog.jsonb_typeof(p_payload -> 'reason') IS DISTINCT FROM 'string'
     OR public.admin_moderation_reason_valid(p_payload ->> 'reason') IS NOT TRUE THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'admin_mutation_invalid_payload';
  END IF;

  suspension_id_value := pg_catalog.lower(p_payload ->> 'suspension_id')::uuid;
  decision_value := p_payload ->> 'decision';
  reason_value := pg_catalog.btrim(p_payload ->> 'reason');
  terminal := decision_value IN ('accepted', 'denied');

  PERFORM public.admin_assert_mutation_capability(actor_token_id, 'decide_appeal');

  INSERT INTO public.admin_mutation_requests (
    admin_token_id,
    idempotency_key,
    actor_id,
    action,
    payload_hash
  ) VALUES (
    actor_token_id,
    p_idempotency_key,
    actor_id_value,
    'decide_appeal',
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
     WHERE request.admin_token_id = actor_token_id
       AND request.idempotency_key = p_idempotency_key
     FOR UPDATE;

    IF existing_action IS DISTINCT FROM 'decide_appeal'
       OR existing_payload_hash IS DISTINCT FROM p_payload_hash THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'idempotency_conflict';
    END IF;

    IF existing_status = 'completed' AND existing_result IS NOT NULL THEN
      RETURN existing_result;
    END IF;

    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'idempotency_incomplete';
  END IF;

  SELECT suspension.profile_id,
         suspension.started_at,
         suspension.ends_at,
         suspension.lifted_at,
         suspension.appeal_note
    INTO profile_id_value,
         suspension_started_at,
         suspension_ends_at,
         suspension_lifted_at,
         suspension_appeal_note
    FROM public.suspensions AS suspension
   WHERE suspension.id = suspension_id_value
   FOR UPDATE;

  IF NOT FOUND OR suspension_appeal_note IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'appeal_not_found';
  END IF;

  IF profile_id_value = actor_id_value THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'self_appeal_decision_forbidden';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.admin_audit_log AS prior_terminal
     WHERE prior_terminal.event_kind = 'appeal_decided'
       AND prior_terminal.target_id = suspension_id_value
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'appeal_already_decided';
  END IF;

  suspension_active := suspension_started_at <= decision_time
    AND suspension_lifted_at IS NULL
    AND (
      suspension_ends_at IS NULL
      OR suspension_ends_at > decision_time
    );

  PERFORM pg_catalog.set_config('admin.actor_id', actor_id_value::text, true);
  PERFORM pg_catalog.set_config('admin.token_id', actor_token_id::text, true);
  PERFORM pg_catalog.set_config(
    'admin.idempotency_key', p_idempotency_key::text, true
  );
  PERFORM pg_catalog.set_config('admin.role', actor_role_value, true);
  PERFORM pg_catalog.set_config('admin.audit_required', 'on', true);

  IF decision_value = 'accepted' AND suspension_active THEN
    UPDATE public.suspensions AS suspension
       SET lifted_at = decision_time,
           lifted_by = actor_id_value,
           lift_reason = reason_value
     WHERE suspension.id = suspension_id_value
       AND suspension.lifted_at IS NULL;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows <> 1 THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'appeal_lift_conflict';
    END IF;
    lifted_now := true;

    SELECT suspension.level, suspension.ends_at
      INTO effective_level, effective_ends_at
      FROM public.suspensions AS suspension
     WHERE suspension.profile_id = profile_id_value
       AND suspension.started_at <= decision_time
       AND suspension.lifted_at IS NULL
       AND (
         suspension.ends_at IS NULL
         OR suspension.ends_at > decision_time
       )
     ORDER BY
       suspension.level DESC,
       suspension.ends_at DESC NULLS FIRST,
       suspension.started_at DESC,
       suspension.id DESC
     LIMIT 1;

    UPDATE public.profiles AS profile
       SET suspension_level = COALESCE(effective_level, 0),
           suspended_until = effective_ends_at,
           shadow_banned = COALESCE(effective_level, 0) >= 3
     WHERE profile.id = profile_id_value;

    PERFORM public.recompute_trust_score(profile_id_value);
  END IF;

  remains_active := suspension_active AND NOT lifted_now;

  PERFORM public.record_audit(
    CASE WHEN terminal
      THEN 'appeal_decided'
      ELSE 'appeal_more_information_requested'
    END,
    actor_id_value,
    suspension_id_value,
    pg_catalog.jsonb_build_object(
      'decision', decision_value,
      'terminal', terminal,
      'reason', reason_value,
      'effective_at', decision_time,
      'suspension_active', suspension_active,
      'lifted_now', lifted_now,
      'remains_active', remains_active
    )
  );

  result_value := pg_catalog.jsonb_build_object(
    'data', pg_catalog.jsonb_build_object(
      'suspension_id', suspension_id_value,
      'decision', decision_value,
      'terminal', terminal,
      'lifted_now', lifted_now,
      'remains_active', remains_active
    )
  );

  IF NOT EXISTS (
    SELECT 1
      FROM public.admin_audit_log AS audit
     WHERE audit.admin_token_id = actor_token_id
       AND audit.idempotency_key = p_idempotency_key
       AND audit.actor_id = actor_id_value
       AND audit.target_id = suspension_id_value
       AND audit.event_kind = CASE WHEN terminal
         THEN 'appeal_decided'
         ELSE 'appeal_more_information_requested'
       END
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'admin_audit_required_missing';
  END IF;

  UPDATE public.admin_mutation_requests AS request
     SET status = 'completed',
         result = result_value,
         completed_at = decision_time
   WHERE request.admin_token_id = actor_token_id
     AND request.idempotency_key = p_idempotency_key
     AND request.status = 'running';
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'idempotency_completion_failed';
  END IF;

  PERFORM pg_catalog.set_config('admin.audit_required', 'off', true);
  PERFORM pg_catalog.set_config('admin.actor_id', '', true);
  PERFORM pg_catalog.set_config('admin.token_id', '', true);
  PERFORM pg_catalog.set_config('admin.idempotency_key', '', true);
  PERFORM pg_catalog.set_config('admin.role', '', true);

  RETURN result_value;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_execute_appeal_decision(
  text, uuid, text, jsonb
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.admin_execute_mutation(
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
  normalized_payload jsonb := p_payload;
BEGIN
  IF p_action = 'decide_appeal' THEN
    RETURN public.admin_execute_appeal_decision(
      p_token_hash,
      p_idempotency_key,
      p_payload_hash,
      p_payload
    );
  END IF;

  -- The predecessor already validates basic reason lengths. This wrapper
  -- additionally rejects control/bidi text, makes takedown reasons mandatory,
  -- and delegates normalized human-visible moderation text for the audit.
  IF p_action IN ('apply_ban', 'lift_suspension', 'takedown_content') THEN
    IF pg_catalog.jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
       OR pg_catalog.jsonb_typeof(p_payload -> 'reason') IS DISTINCT FROM 'string'
       OR public.admin_moderation_reason_valid(p_payload ->> 'reason') IS NOT TRUE THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'admin_mutation_invalid_payload';
    END IF;
    normalized_payload := pg_catalog.jsonb_set(
      p_payload,
      '{reason}',
      pg_catalog.to_jsonb(pg_catalog.btrim(p_payload ->> 'reason')),
      false
    );
  END IF;

  IF p_action = 'apply_ban' AND p_payload ? 'category' THEN
    IF pg_catalog.jsonb_typeof(p_payload -> 'category') IS DISTINCT FROM 'string'
       OR public.admin_moderation_reason_valid(p_payload ->> 'category') IS NOT TRUE
       OR pg_catalog.length(pg_catalog.btrim(p_payload ->> 'category')) > 80 THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'admin_mutation_invalid_payload';
    END IF;
    normalized_payload := pg_catalog.jsonb_set(
      normalized_payload,
      '{category}',
      pg_catalog.to_jsonb(pg_catalog.btrim(p_payload ->> 'category')),
      false
    );
  END IF;

  RETURN public.admin_execute_mutation_pre_appeal_lifecycle(
    p_token_hash,
    p_idempotency_key,
    p_payload_hash,
    p_action,
    normalized_payload
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_execute_mutation(
  text, uuid, text, text, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_execute_mutation(
  text, uuid, text, text, jsonb
) TO service_role;

COMMENT ON INDEX public.admin_audit_log_terminal_appeal_suspension_uidx IS
  'One terminal accepted/denied decision per suspension across all actors and idempotency keys; these rows are operational ledger state and must not be retention-deleted.';
COMMENT ON FUNCTION public.admin_token_authorization(text) IS
  'Backward-compatible v1 active token authorization; excludes decide_appeal from the capability projection so old exact-key clients remain usable.';
COMMENT ON FUNCTION public.admin_token_authorization_v2(text) IS
  'Service-only v2 authorization returning server-verified token ID/expiry/time and the current exact role capability set; never returns the digest.';
COMMENT ON FUNCTION public.admin_list_appeals_v2(integer, integer) IS
  'Pending appeals are those with no terminal appeal_decided ledger row; unknown historical filing times sort first, then authoritative appeal_submitted_at FIFO; more-information requests remain pending and historical lifted cases remain reviewable.';
COMMENT ON FUNCTION public.admin_list_moderation_audit_log(integer, integer, text) IS
  'Operator-safe moderation-only audit projection; token governance and mutation credential metadata are omitted before pagination.';
COMMENT ON FUNCTION public.admin_list_audit_log(integer, integer, text) IS
  'Backward-compatible safe-by-default moderation audit projection for mixed-version rollback.';
COMMENT ON FUNCTION public.admin_list_owner_audit_log(integer, integer, text) IS
  'Versioned full governance audit projection; the Edge API invokes it only after current owner-token authorization.';
COMMENT ON FUNCTION public.admin_execute_appeal_decision(text, uuid, text, jsonb) IS
  'Private atomic three-state appeal review implementation; accepted/denied are terminal, more_information_required remains pending.';
COMMENT ON FUNCTION public.admin_execute_mutation(text, uuid, text, text, jsonb) IS
  'Stable service-only mutation dispatcher with appeal decisions and mandatory bounded moderation reasons; all existing actions delegate to the reviewed predecessor.';
COMMENT ON FUNCTION public.admin_execute_mutation_pre_appeal_lifecycle(
  text, uuid, text, text, jsonb
) IS
  'Private pre-appeal dispatcher retained verbatim for every existing administrator mutation action.';

NOTIFY pgrst, 'reload schema';

COMMIT;
