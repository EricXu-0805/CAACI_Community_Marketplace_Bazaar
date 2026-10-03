-- Durable owner-only support reply authorization. A committed claim is the
-- only permission to submit one provider request; it is NEVER reclaimed.
-- Recovery reads receipts only, including after a provider's idempotency TTL.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

DO $precheck$
BEGIN
  IF pg_catalog.to_regclass('public.admin_tokens') IS NULL
     OR pg_catalog.to_regclass('public.profiles') IS NULL
     OR pg_catalog.to_regclass('public.admin_audit_log') IS NULL
     OR pg_catalog.to_regprocedure('public.admin_token_authorization_v2(text)') IS NULL
     OR pg_catalog.to_regprocedure('public.admin_token_identity_safe(text,text)') IS NULL THEN
    RAISE EXCEPTION 'support_email_prerequisite_missing' USING ERRCODE = '55000';
  END IF;
END;
$precheck$;

CREATE TABLE public.admin_support_email_requests (
  request_id uuid PRIMARY KEY,
  -- Deliberately no cascading FK: deleting a profile/token must not remove
  -- the durable global request ID and accidentally permit another send.
  actor_id uuid NOT NULL,
  admin_token_id uuid NOT NULL,
  intent_hash text NOT NULL CHECK (intent_hash ~ '^[0-9a-f]{64}$'),
  recipient text NOT NULL CHECK (
    pg_catalog.length(recipient) BETWEEN 3 AND 254
    AND recipient ~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,63}$'
  ),
  subject text NOT NULL CHECK (
    pg_catalog.length(subject) BETWEEN 1 AND 200
    AND pg_catalog.length(pg_catalog.btrim(subject)) > 0
    AND subject !~ '[[:cntrl:]]'
    AND subject !~ U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
  ),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'unknown', 'failed', 'sent')),
  provider_id text CHECK (
    provider_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  completed_at timestamptz,
  CONSTRAINT admin_support_email_requests_state_check CHECK (
    (status = 'pending' AND provider_id IS NULL AND completed_at IS NULL)
    OR (status IN ('unknown', 'failed') AND provider_id IS NULL AND completed_at IS NOT NULL)
    OR (status = 'sent' AND provider_id IS NOT NULL AND completed_at IS NOT NULL)
  )
);
CREATE INDEX admin_support_email_requests_actor_created_idx
  ON public.admin_support_email_requests (actor_id, created_at DESC);
ALTER TABLE public.admin_support_email_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_support_email_requests
  FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE public.admin_support_email_requests IS
  'Permanent global send claims. Never reclaim, expire, purge, or cascade-delete request IDs: that would permit duplicate email. No body, rendered HTML, raw token, or provider error is retained.';

-- Preserve the complete installed audit vocabulary, including forward additions
-- made by other features. Only this new event is added to the existing check.
DO $audit_vocabulary$
DECLARE previous_check text;
BEGIN
  SELECT pg_catalog.pg_get_expr(conbin, conrelid) INTO previous_check
    FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.admin_audit_log'::regclass
     AND conname = 'admin_audit_log_event_kind_check' AND contype = 'c';
  IF previous_check IS NULL THEN
    RAISE EXCEPTION 'support_email_audit_vocabulary_missing' USING ERRCODE = '55000';
  END IF;
  ALTER TABLE public.admin_audit_log DROP CONSTRAINT admin_audit_log_event_kind_check;
  EXECUTE pg_catalog.format(
    'ALTER TABLE public.admin_audit_log ADD CONSTRAINT admin_audit_log_event_kind_check CHECK ((%s) OR event_kind = %L)',
    previous_check, 'support_email_claimed'
  );
END;
$audit_vocabulary$;

-- Internal authorization helper. The negative probe avoids global lock
-- contention for unknown/inactive hashes. Every positive candidate is checked
-- again under the same lock order as token revoke and profile deletion.
CREATE FUNCTION public.admin_support_email_owner(p_token_hash text)
RETURNS TABLE (token_id uuid, actor_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  candidate public.admin_tokens%ROWTYPE;
  locked_token public.admin_tokens%ROWTYPE;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'support_email_invalid_token' USING ERRCODE = '28000';
  END IF;
  SELECT token.* INTO candidate FROM public.admin_tokens AS token
   WHERE token.token_hash = p_token_hash
     AND token.revoked_at IS NULL
     AND (token.expires_at IS NULL OR token.expires_at > pg_catalog.clock_timestamp())
     AND public.admin_token_identity_safe(token.admin_name, token.admin_email)
     AND EXISTS (SELECT 1 FROM public.profiles AS profile WHERE profile.id = token.admin_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'support_email_invalid_token' USING ERRCODE = '28000';
  END IF;
  IF candidate.role <> 'owner' THEN
    RAISE EXCEPTION 'support_email_forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718180000::bigint);
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718190000::bigint);
  PERFORM 1 FROM public.profiles AS profile
   WHERE profile.id = candidate.admin_id FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'support_email_invalid_token' USING ERRCODE = '28000';
  END IF;
  SELECT token.* INTO locked_token FROM public.admin_tokens AS token
   WHERE token.id = candidate.id AND token.token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND OR locked_token.admin_id IS DISTINCT FROM candidate.admin_id
     OR locked_token.revoked_at IS NOT NULL
     OR (locked_token.expires_at IS NOT NULL AND locked_token.expires_at <= pg_catalog.clock_timestamp())
     OR NOT public.admin_token_identity_safe(locked_token.admin_name, locked_token.admin_email) THEN
    RAISE EXCEPTION 'support_email_invalid_token' USING ERRCODE = '28000';
  END IF;
  IF locked_token.role <> 'owner' THEN
    RAISE EXCEPTION 'support_email_forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.admin_tokens SET last_used_at = pg_catalog.clock_timestamp()
   WHERE id = locked_token.id;
  RETURN QUERY SELECT locked_token.id, locked_token.admin_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_support_email_owner(text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.admin_support_email_receipt_json(
  p_request public.admin_support_email_requests
)
RETURNS jsonb LANGUAGE sql VOLATILE SET search_path = pg_catalog
AS $function$
  SELECT pg_catalog.jsonb_build_object(
    'request_id', p_request.request_id,
    'status', CASE WHEN p_request.status = 'pending'
                        AND p_request.created_at <= pg_catalog.clock_timestamp() - interval '2 minutes'
                   THEN 'unknown' ELSE p_request.status END,
    'provider_id', p_request.provider_id,
    'to', p_request.recipient,
    'subject', p_request.subject,
    'created_at', p_request.created_at
  );
$function$;
REVOKE ALL ON FUNCTION public.admin_support_email_receipt_json(public.admin_support_email_requests)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.admin_support_email_status(p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  required_rpc text;
  required_oid regprocedure;
BEGIN
  PERFORM 1 FROM public.admin_support_email_owner(p_token_hash);
  IF pg_catalog.to_regclass('public.admin_support_email_requests') IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('available', false);
  END IF;
  FOREACH required_rpc IN ARRAY ARRAY[
    'public.admin_support_email_claim(text,uuid,text,text,text)',
    'public.admin_support_email_receipt(text,uuid)',
    'public.admin_support_email_finish(text,uuid,text,text,text)'
  ] LOOP
    required_oid := pg_catalog.to_regprocedure(required_rpc);
    IF required_oid IS NULL
       OR NOT pg_catalog.has_function_privilege('service_role', required_oid, 'EXECUTE') THEN
      RETURN pg_catalog.jsonb_build_object('available', false);
    END IF;
  END LOOP;
  RETURN pg_catalog.jsonb_build_object('available', true);
END;
$function$;

CREATE FUNCTION public.admin_support_email_claim(
  p_token_hash text, p_request_id uuid, p_intent_hash text, p_to text, p_subject text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  owner_identity record;
  request_row public.admin_support_email_requests%ROWTYPE;
BEGIN
  SELECT * INTO owner_identity FROM public.admin_support_email_owner(p_token_hash);
  IF p_request_id IS NULL OR p_intent_hash IS NULL OR p_intent_hash !~ '^[0-9a-f]{64}$'
     OR p_to IS NULL OR pg_catalog.length(p_to) NOT BETWEEN 3 AND 254
     OR p_to !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,63}$'
     OR p_subject IS NULL OR pg_catalog.length(p_subject) NOT BETWEEN 1 AND 200
     OR pg_catalog.length(pg_catalog.btrim(p_subject)) = 0
     OR p_subject ~ '[[:cntrl:]]'
     OR p_subject ~ U&'[\061C\200E\200F\202A-\202E\2066-\2069]' THEN
    RAISE EXCEPTION 'support_email_invalid_request' USING ERRCODE = '22023';
  END IF;

  -- Global UUID uniqueness prevents another actor/token from reusing the
  -- provider idempotency key. Same actor recovery can use a rotated owner token.
  SELECT request.* INTO request_row FROM public.admin_support_email_requests AS request
   WHERE request.request_id = p_request_id FOR UPDATE;
  IF FOUND THEN
    IF request_row.actor_id <> owner_identity.actor_id
       OR request_row.intent_hash <> p_intent_hash
       OR request_row.recipient <> p_to OR request_row.subject <> p_subject THEN
      RAISE EXCEPTION 'support_email_request_conflict' USING ERRCODE = '22023';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'claimed', false, 'receipt', public.admin_support_email_receipt_json(request_row)
    );
  END IF;
  -- Both admin advisory locks remain held through commit. This limit includes
  -- pending/unknown/failed attempts, spans token rotations, and excludes replay.
  IF (SELECT pg_catalog.count(*) FROM public.admin_support_email_requests AS request
       WHERE request.actor_id = owner_identity.actor_id
         AND request.created_at > pg_catalog.clock_timestamp() - interval '1 hour') >= 10 THEN
    RAISE EXCEPTION 'support_email_rate_limited' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.admin_support_email_requests (
    request_id, actor_id, admin_token_id, intent_hash, recipient, subject
  ) VALUES (
    p_request_id, owner_identity.actor_id, owner_identity.token_id, p_intent_hash, p_to, p_subject
  ) RETURNING * INTO request_row;

  -- Required audit insertion is in the claim transaction. Any audit failure
  -- rolls back the claim: the API must not contact the provider on RPC errors.
  INSERT INTO public.admin_audit_log (
    event_kind, actor_id, target_id, admin_token_id, idempotency_key, details
  ) VALUES (
    'support_email_claimed', owner_identity.actor_id, NULL,
    owner_identity.token_id, p_request_id,
    pg_catalog.jsonb_build_object('via', 'admin_support_email_claim', 'request_id', p_request_id)
  );
  RETURN pg_catalog.jsonb_build_object(
    'claimed', true, 'receipt', public.admin_support_email_receipt_json(request_row)
      || pg_catalog.jsonb_build_object('status', 'pending')
  );
END;
$function$;

CREATE FUNCTION public.admin_support_email_receipt(p_token_hash text, p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  owner_identity record;
  request_row public.admin_support_email_requests%ROWTYPE;
BEGIN
  SELECT * INTO owner_identity FROM public.admin_support_email_owner(p_token_hash);
  SELECT request.* INTO request_row FROM public.admin_support_email_requests AS request
   WHERE request.request_id = p_request_id AND request.actor_id = owner_identity.actor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'support_email_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN public.admin_support_email_receipt_json(request_row);
END;
$function$;

CREATE FUNCTION public.admin_support_email_finish(
  p_token_hash text, p_request_id uuid, p_intent_hash text, p_status text, p_provider_id text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  request_row public.admin_support_email_requests%ROWTYPE;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'support_email_invalid_token' USING ERRCODE = '28000';
  END IF;
  IF p_request_id IS NULL OR p_intent_hash IS NULL OR p_intent_hash !~ '^[0-9a-f]{64}$'
     OR p_status IS NULL OR p_status NOT IN ('sent', 'failed', 'unknown')
     OR (p_status = 'sent' AND (p_provider_id IS NULL
         OR p_provider_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
     OR (p_status <> 'sent' AND p_provider_id IS NOT NULL) THEN
    RAISE EXCEPTION 'support_email_invalid_request' USING ERRCODE = '22023';
  END IF;
  -- This service-only function records an already-authorized external outcome;
  -- it cannot claim/send. Original token ID+actor+hash must still match, but
  -- expiry/revoke/role changes during the provider request must not hide success.
  -- Profile deletion detaches the token; an absent or detached original token
  -- leaves the durable claim unknown rather than accepting a substitute actor.
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_support_email_requests AS request
    JOIN public.admin_tokens AS token ON token.id = request.admin_token_id
     AND token.admin_id = request.actor_id
     WHERE request.request_id = p_request_id AND token.token_hash = p_token_hash
  ) THEN
    RAISE EXCEPTION 'support_email_not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718180000::bigint);
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718190000::bigint);
  SELECT request.* INTO request_row FROM public.admin_support_email_requests AS request
    JOIN public.admin_tokens AS token ON token.id = request.admin_token_id
     AND token.admin_id = request.actor_id
   WHERE request.request_id = p_request_id AND token.token_hash = p_token_hash
   FOR UPDATE OF request, token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'support_email_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF request_row.intent_hash <> p_intent_hash THEN
    RAISE EXCEPTION 'support_email_request_conflict' USING ERRCODE = '22023';
  END IF;
  IF request_row.status <> 'pending' THEN
    IF request_row.status <> p_status OR request_row.provider_id IS DISTINCT FROM p_provider_id THEN
      RAISE EXCEPTION 'support_email_request_conflict' USING ERRCODE = '22023';
    END IF;
    RETURN public.admin_support_email_receipt_json(request_row);
  END IF;
  UPDATE public.admin_support_email_requests
     SET status = p_status, provider_id = p_provider_id, completed_at = pg_catalog.clock_timestamp()
   WHERE request_id = p_request_id RETURNING * INTO request_row;
  RETURN public.admin_support_email_receipt_json(request_row);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_support_email_status(text),
  public.admin_support_email_claim(text, uuid, text, text, text),
  public.admin_support_email_receipt(text, uuid),
  public.admin_support_email_finish(text, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_support_email_status(text),
  public.admin_support_email_claim(text, uuid, text, text, text),
  public.admin_support_email_receipt(text, uuid),
  public.admin_support_email_finish(text, uuid, text, text, text)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
