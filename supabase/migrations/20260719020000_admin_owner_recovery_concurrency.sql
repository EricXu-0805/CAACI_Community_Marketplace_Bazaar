-- Forward-only reconciliation for databases that already recorded an earlier
-- 20260719010000 tail. Keep recovery-owner verification and token mutation
-- lock ordering durable even when the earlier migration bytes cannot rerun.

BEGIN;

SELECT pg_catalog.pg_advisory_xact_lock(20260718180000::bigint);
SELECT pg_catalog.pg_advisory_xact_lock(20260718190000::bigint);
LOCK TABLE public.admin_tokens IN SHARE ROW EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION public.admin_owner_token_recoverable(p_admin_id uuid, p_role text, p_revoked_at timestamp with time zone, p_expires_at timestamp with time zone, p_last_used_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT p_admin_id IS NOT NULL
     AND p_role = 'owner'
     AND p_revoked_at IS NULL
     AND (
       p_expires_at IS NULL
       OR p_expires_at >= pg_catalog.clock_timestamp() + interval '24 hours'
     )
     AND p_last_used_at IS NOT NULL;
$function$;


CREATE OR REPLACE FUNCTION public.admin_assert_token_revoke_allowed(p_actor_token_id uuid, p_target_token_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  target_admin_id uuid;
  target_role text;
  target_revoked_at timestamptz;
  target_expires_at timestamptz;
  target_last_used_at timestamptz;
BEGIN
  IF p_actor_token_id IS NULL OR p_target_token_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'admin_token_revoke_context_invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.admin_tokens AS actor_token
     WHERE actor_token.id = p_actor_token_id
       AND actor_token.admin_id IS NOT NULL
       AND actor_token.revoked_at IS NULL
       AND (
         actor_token.expires_at IS NULL
         OR actor_token.expires_at > pg_catalog.now()
       )
       AND EXISTS (
         SELECT 1
           FROM public.profiles AS actor_profile
          WHERE actor_profile.id = actor_token.admin_id
       )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'admin_token_revoke_context_invalid';
  END IF;

  SELECT target_token.admin_id,
         target_token.role,
         target_token.revoked_at,
         target_token.expires_at,
         target_token.last_used_at
    INTO target_admin_id,
         target_role,
         target_revoked_at,
         target_expires_at,
         target_last_used_at
    FROM public.admin_tokens AS target_token
   WHERE target_token.id = p_target_token_id
     AND target_token.revoked_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'admin_token_revoke_context_invalid';
  END IF;

  IF public.admin_owner_token_recoverable(
       target_admin_id,
       target_role,
       target_revoked_at,
       target_expires_at,
       target_last_used_at
     )
     AND EXISTS (
       SELECT 1
         FROM public.profiles AS target_profile
        WHERE target_profile.id = target_admin_id
     )
     AND NOT EXISTS (
       SELECT 1
         FROM public.admin_tokens AS owner_token
        WHERE owner_token.id <> p_target_token_id
          AND public.admin_owner_token_recoverable(
            owner_token.admin_id,
            owner_token.role,
            owner_token.revoked_at,
            owner_token.expires_at,
            owner_token.last_used_at
          )
          AND EXISTS (
            SELECT 1
              FROM public.profiles AS owner_profile
             WHERE owner_profile.id = owner_token.admin_id
          )
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'last_active_owner_token';
  END IF;
END;
$function$;


CREATE OR REPLACE FUNCTION public.admin_protect_recovery_tokens()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  old_was_active boolean;
  new_is_active boolean := false;
  old_was_recoverable_owner boolean;
  new_is_recoverable_owner boolean := false;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718190000::bigint);

  old_was_active := OLD.admin_id IS NOT NULL
    AND OLD.revoked_at IS NULL
    AND (OLD.expires_at IS NULL OR OLD.expires_at > pg_catalog.now());
  old_was_recoverable_owner := public.admin_owner_token_recoverable(
    OLD.admin_id,
    OLD.role,
    OLD.revoked_at,
    OLD.expires_at,
    OLD.last_used_at
  );

  IF TG_OP = 'UPDATE' THEN
    new_is_active := NEW.admin_id IS NOT NULL
      AND NEW.revoked_at IS NULL
      AND (NEW.expires_at IS NULL OR NEW.expires_at > pg_catalog.now());
    new_is_recoverable_owner := public.admin_owner_token_recoverable(
      NEW.admin_id,
      NEW.role,
      NEW.revoked_at,
      NEW.expires_at,
      NEW.last_used_at
    );
  END IF;

  IF old_was_active AND NOT new_is_active AND NOT EXISTS (
    SELECT 1
      FROM public.admin_tokens AS other_token
     WHERE other_token.id <> OLD.id
       AND other_token.admin_id IS NOT NULL
       AND other_token.revoked_at IS NULL
       AND (
         other_token.expires_at IS NULL
         OR other_token.expires_at > pg_catalog.now()
       )
       AND EXISTS (
         SELECT 1
           FROM public.profiles AS other_profile
          WHERE other_profile.id = other_token.admin_id
       )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'last_active_admin_token';
  END IF;

  IF old_was_recoverable_owner
     AND NOT new_is_recoverable_owner
     AND NOT EXISTS (
       SELECT 1
         FROM public.admin_tokens AS other_owner
        WHERE other_owner.id <> OLD.id
          AND public.admin_owner_token_recoverable(
            other_owner.admin_id,
            other_owner.role,
            other_owner.revoked_at,
            other_owner.expires_at,
            other_owner.last_used_at
          )
          AND EXISTS (
            SELECT 1
              FROM public.profiles AS owner_profile
             WHERE owner_profile.id = other_owner.admin_id
          )
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'last_active_owner_token';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;


CREATE OR REPLACE FUNCTION public.admin_lock_token_recovery_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718180000::bigint);
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718190000::bigint);
  RETURN NULL;
END;
$function$;


CREATE OR REPLACE FUNCTION public.admin_token_authorization(p_token_hash text)
 RETURNS TABLE(admin_id uuid, admin_name text, admin_email text, role text, capabilities text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN;
  END IF;

  -- A successful presentation is the event that turns an issued owner token
  -- into a proven recovery credential. Serialize that state transition with
  -- lifecycle/account-deletion decisions before touching the token row.
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718180000::bigint);
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718190000::bigint);

  RETURN QUERY
  WITH matched AS (
    UPDATE public.admin_tokens AS token
       SET last_used_at = pg_catalog.now()
     WHERE token.token_hash = p_token_hash
       AND token.admin_id IS NOT NULL
       AND token.revoked_at IS NULL
       AND (token.expires_at IS NULL OR token.expires_at > pg_catalog.now())
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
            ORDER BY capability.action
         )::text[]
    FROM matched;
END;
$function$;


CREATE OR REPLACE FUNCTION public.admin_prepare_account_deletion(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  job_row public.account_deletion_jobs%ROWTYPE;
  profile_wechat_openid text;
  profile_exists boolean;
  target_active_token_count bigint;
  remaining_active_admin_token_count bigint;
  remaining_recoverable_owner_token_count bigint;
  revoked_token_count bigint;
  revoked_token_ids jsonb;
  revoked_token_ids_truncated boolean;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'admin_account_deletion_invalid';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(20260718180000::bigint);
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718190000::bigint);

  -- Lock all target rows only after both advisory locks. This preserves the
  -- global order used by lifecycle/recovery mutations and makes the following
  -- readiness counts and revoke set one coherent transaction view.
  PERFORM token.id
    FROM public.admin_tokens AS token
   WHERE token.admin_id = p_user_id
     AND token.revoked_at IS NULL
   ORDER BY token.id
   FOR UPDATE;

  SELECT
    pg_catalog.count(*) FILTER (
      WHERE token.admin_id = p_user_id
        AND token.revoked_at IS NULL
        AND (
          token.expires_at IS NULL
          OR token.expires_at > pg_catalog.now()
        )
    ),
    pg_catalog.count(*) FILTER (
      WHERE token.admin_id IS DISTINCT FROM p_user_id
        AND token.admin_id IS NOT NULL
        AND token.revoked_at IS NULL
        AND (
          token.expires_at IS NULL
          OR token.expires_at > pg_catalog.now()
        )
        AND EXISTS (
          SELECT 1
            FROM public.profiles AS admin_profile
           WHERE admin_profile.id = token.admin_id
        )
    ),
    pg_catalog.count(*) FILTER (
      WHERE token.admin_id IS DISTINCT FROM p_user_id
        AND public.admin_owner_token_recoverable(
          token.admin_id,
          token.role,
          token.revoked_at,
          token.expires_at,
          token.last_used_at
        )
        AND EXISTS (
          SELECT 1
            FROM public.profiles AS owner_profile
           WHERE owner_profile.id = token.admin_id
        )
    )
    INTO target_active_token_count,
         remaining_active_admin_token_count,
         remaining_recoverable_owner_token_count
    FROM public.admin_tokens AS token;

  -- Auth creation can legitimately leave an auth.users row without its
  -- public profile because the historical handle_new_user trigger swallowed
  -- profile-insert errors. Snapshot the optional profile while the same
  -- advisory locks also exclude a concurrent profile deletion. A still-active
  -- token attached to a missing profile violates the credential FK invariant;
  -- fail closed even if a privileged/manual write ever bypassed that FK.
  SELECT profile.wechat_openid
    INTO profile_wechat_openid
    FROM public.profiles AS profile
   WHERE profile.id = p_user_id;
  profile_exists := FOUND;

  IF NOT profile_exists AND target_active_token_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'admin_active_token_profile_missing';
  END IF;

  -- A profile with no active admin token cannot weaken the recovery set.
  -- Otherwise removing the account must leave both an active administrator
  -- credential and a verified/recoverable owner credential on another live
  -- profile. Merely issuing a token does not prove that its plaintext survived.
  IF target_active_token_count > 0
     AND (
       remaining_active_admin_token_count < 1
       OR remaining_recoverable_owner_token_count < 1
     ) THEN
    RETURN pg_catalog.jsonb_build_object(
      'ready', false,
      'reason', 'admin_recovery_transfer_required',
      'job', NULL
    );
  END IF;

  SELECT deletion_job.*
    INTO job_row
    FROM public.account_deletion_jobs AS deletion_job
   WHERE deletion_job.user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    -- A missing profile is recoverable only for a real Auth identity. The
    -- durable job deliberately has no FK so it survives Auth deletion, but
    -- its first creation must never mint a tombstone for an arbitrary UUID.
    IF NOT profile_exists THEN
      PERFORM auth_user.id
        FROM auth.users AS auth_user
       WHERE auth_user.id = p_user_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING
          ERRCODE = 'P0002',
          MESSAGE = 'account_auth_user_not_found';
      END IF;
    END IF;

    INSERT INTO public.account_deletion_jobs (
      user_id,
      stage,
      wechat_openid
    ) VALUES (
      p_user_id,
      'requested',
      profile_wechat_openid
    )
    RETURNING * INTO job_row;
  END IF;

  WITH revoked AS (
    UPDATE public.admin_tokens AS token
       SET revoked_at = pg_catalog.now()
     WHERE token.admin_id = p_user_id
       AND token.revoked_at IS NULL
    RETURNING token.id
  ), revoked_summary AS (
    SELECT pg_catalog.count(*) AS revoked_count FROM revoked
  ), revoked_sample AS (
    SELECT COALESCE(
             pg_catalog.jsonb_agg(sample.id ORDER BY sample.id),
             '[]'::jsonb
           ) AS token_ids
      FROM (
        SELECT revoked.id FROM revoked ORDER BY revoked.id LIMIT 100
      ) AS sample
  )
  SELECT revoked_summary.revoked_count,
         revoked_sample.token_ids,
         revoked_summary.revoked_count > 100
    INTO revoked_token_count,
         revoked_token_ids,
         revoked_token_ids_truncated
    FROM revoked_summary
    CROSS JOIN revoked_sample;

  IF revoked_token_count > 0 THEN
    -- Direct required insert: any audit failure rolls back both the durable
    -- tombstone and token revocation. actor_id NULL marks a system boundary,
    -- while target_id and bounded UUID evidence preserve attribution.
    INSERT INTO public.admin_audit_log (
      event_kind,
      actor_id,
      target_id,
      details,
      admin_token_id,
      idempotency_key
    ) VALUES (
      'token_revoked',
      NULL,
      p_user_id,
      pg_catalog.jsonb_build_object(
        'mode', 'account_deletion_prepared',
        'admin_id', p_user_id,
        'token_ids', revoked_token_ids,
        'token_ids_truncated', revoked_token_ids_truncated,
        'revoked_count', revoked_token_count,
        'via', 'admin_prepare_account_deletion'
      ),
      NULL,
      NULL
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ready', true,
    'reason', NULL,
    'job', pg_catalog.to_jsonb(job_row)
  );
END;
$function$;


CREATE OR REPLACE FUNCTION public.admin_execute_token_lifecycle(p_token_hash text, p_idempotency_key uuid, p_payload_hash text, p_action text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
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
  affected_rows integer;
  target_token_id uuid;
  target_admin_id uuid;
  target_role text;
  target_expires_at timestamptz;
  target_admin_name text;
  target_admin_email text;
  case_id_value text;
  approval_ref_value text;
  token_hash_value text;
  target_token_ids uuid[];
  payload_key text;
BEGIN
  -- This is intentionally the same lock as the original dispatcher. Token
  -- issue/revoke therefore has a deterministic order with every admin write,
  -- and duplicate/concurrent revocations cannot both observe an active row.
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718180000::bigint);

  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING
      ERRCODE = '28000',
      MESSAGE = 'admin_token_inactive';
  END IF;

  SELECT token.id, token.admin_id, token.role
    INTO actor_token_id, actor_id_value, actor_role_value
    FROM public.admin_tokens AS token
   WHERE token.token_hash = p_token_hash
     AND token.admin_id IS NOT NULL
     AND token.revoked_at IS NULL
     AND (token.expires_at IS NULL OR token.expires_at > pg_catalog.now())
     AND EXISTS (
       SELECT 1
         FROM public.profiles AS actor_profile
        WHERE actor_profile.id = token.admin_id
     )
   FOR UPDATE;

  IF actor_token_id IS NULL OR actor_id_value IS NULL
     OR actor_role_value NOT IN ('operator', 'security_admin', 'owner') THEN
    RAISE EXCEPTION USING
      ERRCODE = '28000',
      MESSAGE = 'admin_token_inactive';
  END IF;

  UPDATE public.admin_tokens AS token
     SET last_used_at = pg_catalog.now()
   WHERE token.id = actor_token_id;

  IF p_idempotency_key IS NULL
     OR p_payload_hash IS NULL
     OR p_payload_hash !~ '^[0-9a-f]{64}$'
     OR p_action NOT IN ('issue_token', 'revoke_token', 'revoke_admin_tokens')
     OR pg_catalog.jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'admin_mutation_invalid';
  END IF;

  PERFORM public.admin_assert_mutation_capability(actor_token_id, p_action);

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
     WHERE request.admin_token_id = actor_token_id
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
  PERFORM pg_catalog.set_config('admin.token_id', actor_token_id::text, true);
  PERFORM pg_catalog.set_config(
    'admin.idempotency_key', p_idempotency_key::text, true
  );
  PERFORM pg_catalog.set_config('admin.role', actor_role_value, true);
  PERFORM pg_catalog.set_config('admin.audit_required', 'on', true);

  IF p_action = 'issue_token' THEN
    FOR payload_key IN SELECT pg_catalog.jsonb_object_keys(p_payload) LOOP
      IF payload_key NOT IN (
        'token_hash', 'admin_id', 'role', 'expires_at', 'case_id', 'approval_ref'
      ) THEN
        RAISE EXCEPTION USING
          ERRCODE = '22023',
          MESSAGE = 'admin_mutation_invalid_payload';
      END IF;
    END LOOP;

    token_hash_value := p_payload ->> 'token_hash';
    IF pg_catalog.jsonb_typeof(p_payload -> 'token_hash') IS DISTINCT FROM 'string'
       OR token_hash_value !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'admin_mutation_invalid_payload';
    END IF;

    IF pg_catalog.jsonb_typeof(p_payload -> 'admin_id') IS DISTINCT FROM 'string'
       OR (p_payload ->> 'admin_id') !~* uuid_pattern THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'admin_mutation_invalid_payload';
    END IF;
    target_admin_id := pg_catalog.lower(p_payload ->> 'admin_id')::uuid;

    target_role := p_payload ->> 'role';
    IF pg_catalog.jsonb_typeof(p_payload -> 'role') IS DISTINCT FROM 'string'
       OR target_role NOT IN ('operator', 'security_admin', 'owner') THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'admin_mutation_invalid_payload';
    END IF;
    IF actor_role_value <> 'owner' THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'admin_capability_denied';
    END IF;

    IF pg_catalog.jsonb_typeof(p_payload -> 'expires_at') IS DISTINCT FROM 'string'
       OR pg_catalog.length(p_payload ->> 'expires_at') > 64 THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'admin_mutation_invalid_payload';
    END IF;
    BEGIN
      target_expires_at := (p_payload ->> 'expires_at')::timestamptz;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'admin_mutation_invalid_payload';
    END;
    IF target_expires_at <= pg_catalog.now()
       OR target_expires_at > pg_catalog.now() + interval '365 days' THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'admin_mutation_invalid_payload';
    END IF;
    IF target_role = 'owner'
       AND target_expires_at
           < pg_catalog.clock_timestamp() + interval '24 hours' THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'admin_mutation_invalid_payload';
    END IF;

    case_id_value := p_payload ->> 'case_id';
    approval_ref_value := p_payload ->> 'approval_ref';
    IF pg_catalog.jsonb_typeof(p_payload -> 'case_id') IS DISTINCT FROM 'string'
       OR NOT public.admin_lifecycle_evidence_valid(case_id_value)
       OR pg_catalog.jsonb_typeof(p_payload -> 'approval_ref') IS DISTINCT FROM 'string'
       OR NOT public.admin_lifecycle_evidence_valid(approval_ref_value) THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'admin_mutation_invalid_payload';
    END IF;

    SELECT NULLIF(pg_catalog.btrim(profile.nickname), ''),
           NULLIF(pg_catalog.btrim(profile.email), '')
      INTO target_admin_name, target_admin_email
      FROM public.profiles AS profile
     WHERE profile.id = target_admin_id
     FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0002',
        MESSAGE = 'admin_profile_not_found';
    END IF;
    IF target_admin_name IS NULL
       OR pg_catalog.length(target_admin_name) > 100
       OR target_admin_email IS NULL
       OR pg_catalog.length(target_admin_email) < 3
       OR pg_catalog.length(target_admin_email) > 200
       OR pg_catalog.strpos(target_admin_email, '@') = 0 THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'admin_profile_identity_incomplete';
    END IF;
    IF EXISTS (
      SELECT 1
        FROM public.account_deletion_jobs AS deletion_job
       WHERE deletion_job.user_id = target_admin_id
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'admin_account_deletion_in_progress';
    END IF;

    BEGIN
      INSERT INTO public.admin_tokens (
        token_hash,
        admin_id,
        admin_name,
        admin_email,
        role,
        expires_at,
        created_by
      ) VALUES (
        token_hash_value,
        target_admin_id,
        target_admin_name,
        target_admin_email,
        target_role,
        target_expires_at,
        actor_id_value
      )
      RETURNING id INTO target_token_id;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION USING
        ERRCODE = '23505',
        MESSAGE = 'admin_token_hash_conflict';
    END;

    PERFORM public.record_audit(
      'token_issued',
      actor_id_value,
      target_admin_id,
      pg_catalog.jsonb_build_object(
        'token_id', target_token_id,
        'admin_id', target_admin_id,
        'role', target_role,
        'expires_at', target_expires_at,
        'created_by', actor_id_value,
        'case_id', case_id_value,
        'approval_ref', approval_ref_value,
        'identity_source', 'profiles'
      )
    );
    result_value := pg_catalog.jsonb_build_object(
      'data', pg_catalog.jsonb_build_object(
        'token_id', target_token_id,
        'admin_id', target_admin_id,
        'role', target_role,
        'expires_at', target_expires_at
      )
    );

  ELSIF p_action = 'revoke_token' THEN
    FOR payload_key IN SELECT pg_catalog.jsonb_object_keys(p_payload) LOOP
      IF payload_key NOT IN ('token_id', 'case_id', 'approval_ref') THEN
        RAISE EXCEPTION USING
          ERRCODE = '22023',
          MESSAGE = 'admin_mutation_invalid_payload';
      END IF;
    END LOOP;

    IF pg_catalog.jsonb_typeof(p_payload -> 'token_id') IS DISTINCT FROM 'string'
       OR (p_payload ->> 'token_id') !~* uuid_pattern THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'admin_mutation_invalid_payload';
    END IF;
    target_token_id := pg_catalog.lower(p_payload ->> 'token_id')::uuid;

    case_id_value := p_payload ->> 'case_id';
    approval_ref_value := p_payload ->> 'approval_ref';
    IF pg_catalog.jsonb_typeof(p_payload -> 'case_id') IS DISTINCT FROM 'string'
       OR NOT public.admin_lifecycle_evidence_valid(case_id_value)
       OR pg_catalog.jsonb_typeof(p_payload -> 'approval_ref') IS DISTINCT FROM 'string'
       OR NOT public.admin_lifecycle_evidence_valid(approval_ref_value) THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'admin_mutation_invalid_payload';
    END IF;

    SELECT token.admin_id, token.expires_at
      INTO target_admin_id, target_expires_at
      FROM public.admin_tokens AS token
     WHERE token.id = target_token_id
       AND token.revoked_at IS NULL
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0002',
        MESSAGE = 'token_not_active';
    END IF;

    -- Preserve the established deterministic sentinel order: loss of the last
    -- active recovery credential wins over the self-revoke sentinel.
    IF (target_expires_at IS NULL OR target_expires_at > pg_catalog.now())
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

    IF target_token_id = actor_token_id THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'self_revoke_forbidden';
    END IF;

    PERFORM public.admin_assert_token_revoke_allowed(
      actor_token_id,
      target_token_id
    );

    UPDATE public.admin_tokens AS token
       SET revoked_at = pg_catalog.now()
     WHERE token.id = target_token_id
       AND token.revoked_at IS NULL;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows <> 1 THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0002',
        MESSAGE = 'token_not_active';
    END IF;

    PERFORM public.record_audit(
      'token_revoked',
      actor_id_value,
      target_admin_id,
      pg_catalog.jsonb_build_object(
        'mode', 'token_id',
        'token_id', target_token_id,
        'admin_id', target_admin_id,
        'case_id', case_id_value,
        'approval_ref', approval_ref_value
      )
    );
    result_value := pg_catalog.jsonb_build_object('success', true);

  ELSE
    FOR payload_key IN SELECT pg_catalog.jsonb_object_keys(p_payload) LOOP
      IF payload_key NOT IN ('admin_id', 'case_id', 'approval_ref') THEN
        RAISE EXCEPTION USING
          ERRCODE = '22023',
          MESSAGE = 'admin_mutation_invalid_payload';
      END IF;
    END LOOP;

    IF pg_catalog.jsonb_typeof(p_payload -> 'admin_id') IS DISTINCT FROM 'string'
       OR (p_payload ->> 'admin_id') !~* uuid_pattern THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'admin_mutation_invalid_payload';
    END IF;
    target_admin_id := pg_catalog.lower(p_payload ->> 'admin_id')::uuid;

    case_id_value := p_payload ->> 'case_id';
    approval_ref_value := p_payload ->> 'approval_ref';
    IF pg_catalog.jsonb_typeof(p_payload -> 'case_id') IS DISTINCT FROM 'string'
       OR NOT public.admin_lifecycle_evidence_valid(case_id_value)
       OR pg_catalog.jsonb_typeof(p_payload -> 'approval_ref') IS DISTINCT FROM 'string'
       OR NOT public.admin_lifecycle_evidence_valid(approval_ref_value) THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'admin_mutation_invalid_payload';
    END IF;

    SELECT pg_catalog.array_agg(locked_token.id ORDER BY locked_token.id)
      INTO target_token_ids
      FROM (
        SELECT token.id
          FROM public.admin_tokens AS token
         WHERE token.admin_id = target_admin_id
           AND token.id <> actor_token_id
           AND token.revoked_at IS NULL
         ORDER BY token.id
         FOR UPDATE
      ) AS locked_token;

    IF COALESCE(pg_catalog.cardinality(target_token_ids), 0) = 0 THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0002',
        MESSAGE = 'token_not_active';
    END IF;
    IF pg_catalog.cardinality(target_token_ids) > 100 THEN
      RAISE EXCEPTION USING
        ERRCODE = '54000',
        MESSAGE = 'admin_token_batch_too_large';
    END IF;

    -- Evaluate recovery loss against the complete revoke set. Per-token checks
    -- alone let two verified owners in the same batch each see the other before
    -- either row changes; the row trigger is defense in depth, not the set-wise
    -- authorization decision.
    IF EXISTS (
         SELECT 1
           FROM public.admin_tokens AS target_owner
          WHERE target_owner.id = ANY(target_token_ids)
            AND public.admin_owner_token_recoverable(
              target_owner.admin_id,
              target_owner.role,
              target_owner.revoked_at,
              target_owner.expires_at,
              target_owner.last_used_at
            )
            AND EXISTS (
              SELECT 1
                FROM public.profiles AS target_owner_profile
               WHERE target_owner_profile.id = target_owner.admin_id
            )
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public.admin_tokens AS remaining_owner
          WHERE NOT (remaining_owner.id = ANY(target_token_ids))
            AND public.admin_owner_token_recoverable(
              remaining_owner.admin_id,
              remaining_owner.role,
              remaining_owner.revoked_at,
              remaining_owner.expires_at,
              remaining_owner.last_used_at
            )
            AND EXISTS (
              SELECT 1
                FROM public.profiles AS remaining_owner_profile
               WHERE remaining_owner_profile.id = remaining_owner.admin_id
            )
       ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'last_active_owner_token';
    END IF;

    FOREACH target_token_id IN ARRAY target_token_ids LOOP
      PERFORM public.admin_assert_token_revoke_allowed(
        actor_token_id,
        target_token_id
      );
    END LOOP;

    UPDATE public.admin_tokens AS token
       SET revoked_at = pg_catalog.now()
     WHERE token.id = ANY(target_token_ids)
       AND token.revoked_at IS NULL;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows <> pg_catalog.cardinality(target_token_ids) THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'admin_token_batch_conflict';
    END IF;

    PERFORM public.record_audit(
      'token_revoked',
      actor_id_value,
      target_admin_id,
      pg_catalog.jsonb_build_object(
        'mode', 'admin_id',
        'admin_id', target_admin_id,
        'token_ids', pg_catalog.to_jsonb(target_token_ids),
        'revoked_count', affected_rows,
        'case_id', case_id_value,
        'approval_ref', approval_ref_value
      )
    );
    result_value := pg_catalog.jsonb_build_object(
      'data', pg_catalog.jsonb_build_object(
        'admin_id', target_admin_id,
        'token_ids', pg_catalog.to_jsonb(target_token_ids),
        'revoked_count', affected_rows
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.admin_audit_log AS audit
     WHERE audit.admin_token_id = actor_token_id
       AND audit.idempotency_key = p_idempotency_key
       AND audit.actor_id = actor_id_value
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'admin_audit_required_missing';
  END IF;

  UPDATE public.admin_mutation_requests AS request
     SET status = 'completed',
         result = result_value,
         completed_at = pg_catalog.now()
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

REVOKE ALL ON FUNCTION public.admin_owner_token_recoverable(
  uuid, text, timestamptz, timestamptz, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_assert_token_revoke_allowed(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_protect_recovery_tokens()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_lock_token_recovery_mutation()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_token_authorization(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_token_authorization(text)
  TO service_role;
REVOKE ALL ON FUNCTION public.admin_prepare_account_deletion(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_prepare_account_deletion(uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.admin_execute_token_lifecycle(
  text, uuid, text, text, jsonb
) FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS admin_tokens_protect_recovery
ON public.admin_tokens;
CREATE TRIGGER admin_tokens_protect_recovery
BEFORE UPDATE OF admin_id, revoked_at, expires_at, role OR DELETE
ON public.admin_tokens
FOR EACH ROW
EXECUTE FUNCTION public.admin_protect_recovery_tokens();

DROP TRIGGER IF EXISTS admin_tokens_00_lock_recovery_mutation
ON public.admin_tokens;
CREATE TRIGGER admin_tokens_00_lock_recovery_mutation
BEFORE UPDATE OR DELETE
ON public.admin_tokens
FOR EACH STATEMENT
EXECUTE FUNCTION public.admin_lock_token_recovery_mutation();

COMMENT ON FUNCTION public.admin_owner_token_recoverable(
  uuid, text, timestamptz, timestamptz, timestamptz
) IS
  'Internal verified recovery-owner predicate: live identity at caller, presented token, and at least 24 hours remaining.';
COMMENT ON FUNCTION public.admin_lock_token_recovery_mutation() IS
  'Statement-level ordered advisory lock fence for every direct admin token UPDATE/DELETE.';

NOTIFY pgrst, 'reload schema';

COMMIT;
