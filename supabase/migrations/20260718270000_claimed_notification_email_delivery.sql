-- Shared, durable notification-email delivery claims.
--
-- Immediate meetup mail and the daily digest used independent guards. Both
-- could observe emailed_at IS NULL, send different Resend idempotency keys,
-- and then stamp the same notification. A short process-local or rate-limit
-- guard cannot make that cross-path decision atomic.
--
-- The database now owns one lease and one sticky provider key for every email
-- batch. Claims serialize on notification rows. A provider attempt makes its
-- delivery kind/key sticky across ambiguous failures, so another path cannot
-- send the same notification under a different key. Before a provider attempt,
-- an expired/released claim may safely return to the common pool.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS email_delivery_kind text,
  ADD COLUMN IF NOT EXISTS email_delivery_key text,
  ADD COLUMN IF NOT EXISTS email_claim_token uuid,
  ADD COLUMN IF NOT EXISTS email_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_claim_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_provider_attempted_at timestamptz;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.notifications'::pg_catalog.regclass
      AND conname = 'notifications_email_delivery_state_check'
  ) THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_email_delivery_state_check CHECK (
        (email_delivery_kind IS NULL) = (email_delivery_key IS NULL)
        AND (
          email_delivery_kind IS NULL
          OR (
            email_delivery_kind IN ('immediate', 'digest')
            AND pg_catalog.char_length(email_delivery_key) BETWEEN 10 AND 96
            AND email_delivery_key LIKE email_delivery_kind || '/%'
          )
        )
        AND (
          email_claim_token IS NULL
          AND email_claimed_at IS NULL
          AND email_claim_expires_at IS NULL
          OR
          email_claim_token IS NOT NULL
          AND email_claimed_at IS NOT NULL
          AND email_claim_expires_at IS NOT NULL
          AND email_delivery_kind IS NOT NULL
        )
        AND (
          email_provider_attempted_at IS NULL
          OR email_delivery_kind IS NOT NULL
        )
      );
  END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS notifications_email_delivery_key_idx
  ON public.notifications (email_delivery_key, user_id, id)
  WHERE email_delivery_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS notifications_email_claim_expiry_idx
  ON public.notifications (email_claim_expires_at)
  WHERE emailed_at IS NULL AND email_claim_token IS NOT NULL;

COMMENT ON COLUMN public.notifications.email_delivery_kind IS
  'Server-owned owner of off-platform delivery: immediate or digest.';
COMMENT ON COLUMN public.notifications.email_delivery_key IS
  'Sticky Resend idempotency key shared by every row in one email.';
COMMENT ON COLUMN public.notifications.email_provider_attempted_at IS
  'Most recent claim provider-start time. Once non-NULL, kind/key stay sticky because any earlier acceptance may be ambiguous.';

CREATE OR REPLACE FUNCTION public.claim_notification_email_delivery(
  notification_ids_in uuid[],
  delivery_kind_in text,
  lease_seconds_in integer DEFAULT 120
) RETURNS TABLE (
  delivery_key text,
  claim_token uuid,
  notification_ids uuid[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  now_value timestamptz := pg_catalog.clock_timestamp();
  requested_ids uuid[];
  selected_ids uuid[];
  recipient_id uuid;
  recipient_count integer := 0;
  selected_count integer := 0;
  changed_count integer := 0;
  sticky_key text;
  next_key text;
  next_token uuid;
BEGIN
  IF delivery_kind_in NOT IN ('immediate', 'digest')
     OR lease_seconds_in IS NULL
     OR lease_seconds_in < 30
     OR lease_seconds_in > 900
     OR notification_ids_in IS NULL
     OR pg_catalog.cardinality(notification_ids_in) < 1
     OR pg_catalog.cardinality(notification_ids_in) > 40
     OR pg_catalog.array_position(notification_ids_in, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_email_delivery_claim' USING ERRCODE = '22023';
  END IF;

  SELECT pg_catalog.array_agg(candidate.id ORDER BY candidate.id)
    INTO requested_ids
  FROM (
    SELECT DISTINCT requested.id
    FROM pg_catalog.unnest(notification_ids_in) AS requested(id)
  ) AS candidate;

  IF pg_catalog.cardinality(requested_ids) <> pg_catalog.cardinality(notification_ids_in) THEN
    RAISE EXCEPTION 'duplicate_email_delivery_notification' USING ERRCODE = '22023';
  END IF;

  -- Deterministic row order prevents two overlapping digest batches from
  -- deadlocking. Locks also serialize immediate-vs-digest ownership.
  PERFORM notification.id
  FROM public.notifications AS notification
  WHERE notification.id = ANY (requested_ids)
  ORDER BY notification.id
  FOR UPDATE;

  SELECT
    pg_catalog.count(DISTINCT notification.user_id)::integer,
    pg_catalog.min(notification.user_id::text)::uuid
  INTO recipient_count, recipient_id
  FROM public.notifications AS notification
  WHERE notification.id = ANY (requested_ids)
    AND notification.emailed_at IS NULL;

  IF recipient_count = 0 THEN
    RETURN;
  END IF;
  IF recipient_count <> 1 THEN
    RAISE EXCEPTION 'mixed_email_delivery_recipients' USING ERRCODE = '22023';
  END IF;

  -- A retry of an already-attempted batch must recover the complete original
  -- group and key, even if only one of its ids appeared in today's scan.
  SELECT notification.email_delivery_key
  INTO sticky_key
  FROM public.notifications AS notification
  WHERE notification.id = ANY (requested_ids)
    AND notification.user_id = recipient_id
    AND notification.emailed_at IS NULL
    AND notification.email_delivery_kind = delivery_kind_in
    AND (
      notification.email_claim_token IS NULL
      OR notification.email_claim_expires_at <= now_value
    )
  ORDER BY
    (notification.email_provider_attempted_at IS NOT NULL) DESC,
    notification.email_delivery_key
  LIMIT 1;

  IF sticky_key IS NOT NULL THEN
    PERFORM notification.id
    FROM public.notifications AS notification
    WHERE notification.user_id = recipient_id
      AND notification.email_delivery_key = sticky_key
    ORDER BY notification.id
    FOR UPDATE;

    -- Another worker may have reclaimed this group while we waited on its
    -- wider key lock. It owns the batch until that lease expires.
    IF EXISTS (
      SELECT 1
      FROM public.notifications AS notification
      WHERE notification.user_id = recipient_id
        AND notification.email_delivery_key = sticky_key
        AND notification.emailed_at IS NULL
        AND notification.email_claim_token IS NOT NULL
        AND notification.email_claim_expires_at > now_value
    ) THEN
      RETURN;
    END IF;

    -- Completion is atomic. A mixed pending/completed key therefore signals
    -- corrupted state; refuse to build a different body under the same key.
    IF EXISTS (
      SELECT 1 FROM public.notifications AS notification
      WHERE notification.user_id = recipient_id
        AND notification.email_delivery_key = sticky_key
        AND notification.emailed_at IS NULL
    ) AND EXISTS (
      SELECT 1 FROM public.notifications AS notification
      WHERE notification.user_id = recipient_id
        AND notification.email_delivery_key = sticky_key
        AND notification.emailed_at IS NOT NULL
    ) THEN
      RETURN;
    END IF;

    SELECT pg_catalog.array_agg(notification.id ORDER BY notification.id)
    INTO selected_ids
    FROM public.notifications AS notification
    WHERE notification.user_id = recipient_id
      AND notification.email_delivery_key = sticky_key
      AND notification.emailed_at IS NULL;
    next_key := sticky_key;
  ELSE
    -- A different delivery path may take over only if no provider call began
    -- and the old lease is absent/expired. Ambiguous attempts stay sticky.
    UPDATE public.notifications AS notification
    SET
      email_delivery_kind = NULL,
      email_delivery_key = NULL,
      email_claim_token = NULL,
      email_claimed_at = NULL,
      email_claim_expires_at = NULL
    WHERE notification.id = ANY (requested_ids)
      AND notification.user_id = recipient_id
      AND notification.emailed_at IS NULL
      AND notification.email_delivery_kind IS NOT NULL
      AND notification.email_provider_attempted_at IS NULL
      AND (
        notification.email_claim_token IS NULL
        OR notification.email_claim_expires_at <= now_value
      );

    SELECT pg_catalog.array_agg(candidate.id ORDER BY candidate.id)
    INTO selected_ids
    FROM (
      SELECT notification.id
      FROM public.notifications AS notification
      WHERE notification.id = ANY (requested_ids)
        AND notification.user_id = recipient_id
        AND notification.emailed_at IS NULL
        AND notification.email_delivery_kind IS NULL
      ORDER BY notification.id
      LIMIT CASE WHEN delivery_kind_in = 'immediate' THEN 1 ELSE 40 END
    ) AS candidate;

    IF selected_ids IS NULL THEN
      RETURN;
    END IF;
    IF delivery_kind_in = 'immediate'
       AND pg_catalog.cardinality(selected_ids) <> 1 THEN
      RETURN;
    END IF;

    next_key := CASE
      WHEN delivery_kind_in = 'immediate'
        THEN 'immediate/' || selected_ids[1]::text
      ELSE 'digest/' || pg_catalog.md5(
        recipient_id::text || ':' || pg_catalog.array_to_string(selected_ids, ',')
      )
    END;
  END IF;

  selected_count := COALESCE(pg_catalog.cardinality(selected_ids), 0);
  IF selected_count < 1 OR selected_count > 40 THEN
    RETURN;
  END IF;

  next_token := pg_catalog.gen_random_uuid();
  UPDATE public.notifications AS notification
  SET
    email_delivery_kind = delivery_kind_in,
    email_delivery_key = next_key,
    email_claim_token = next_token,
    email_claimed_at = now_value,
    email_claim_expires_at = now_value + pg_catalog.make_interval(secs => lease_seconds_in)
  WHERE notification.id = ANY (selected_ids)
    AND notification.emailed_at IS NULL;
  GET DIAGNOSTICS changed_count = ROW_COUNT;

  IF changed_count <> selected_count THEN
    RAISE EXCEPTION 'email_delivery_claim_changed' USING ERRCODE = '40001';
  END IF;

  RETURN QUERY SELECT next_key, next_token, selected_ids;
END
$function$;

CREATE OR REPLACE FUNCTION public.renew_notification_email_delivery(
  claim_token_in uuid,
  delivery_key_in text,
  lease_seconds_in integer DEFAULT 120
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  changed_count integer := 0;
  now_value timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF claim_token_in IS NULL
     OR delivery_key_in IS NULL
     OR pg_catalog.char_length(delivery_key_in) > 96
     OR lease_seconds_in IS NULL
     OR lease_seconds_in < 30
     OR lease_seconds_in > 900 THEN
    RETURN 0;
  END IF;

  UPDATE public.notifications AS notification
  SET email_claim_expires_at = now_value + pg_catalog.make_interval(secs => lease_seconds_in)
  WHERE notification.email_claim_token = claim_token_in
    AND notification.email_delivery_key = delivery_key_in
    AND notification.emailed_at IS NULL
    AND notification.email_claim_expires_at > now_value;
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  RETURN changed_count;
END
$function$;

CREATE OR REPLACE FUNCTION public.begin_notification_email_delivery(
  claim_token_in uuid,
  delivery_key_in text,
  lease_seconds_in integer DEFAULT 600
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  changed_count integer := 0;
  now_value timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF claim_token_in IS NULL
     OR delivery_key_in IS NULL
     OR pg_catalog.char_length(delivery_key_in) > 96
     OR lease_seconds_in IS NULL
     OR lease_seconds_in < 30
     OR lease_seconds_in > 900 THEN
    RETURN 0;
  END IF;

  -- Mark attempted immediately before the provider call. From this point the
  -- kind/key cannot be reassigned: a timeout may still have been accepted.
  UPDATE public.notifications AS notification
  SET
    email_provider_attempted_at = now_value,
    email_claim_expires_at = now_value + pg_catalog.make_interval(secs => lease_seconds_in)
  WHERE notification.email_claim_token = claim_token_in
    AND notification.email_delivery_key = delivery_key_in
    AND notification.emailed_at IS NULL
    AND notification.email_claim_expires_at > now_value;
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  RETURN changed_count;
END
$function$;

CREATE OR REPLACE FUNCTION public.complete_notification_email_delivery(
  claim_token_in uuid,
  delivery_key_in text
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  group_count integer := 0;
  now_value timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF claim_token_in IS NULL
     OR delivery_key_in IS NULL
     OR pg_catalog.char_length(delivery_key_in) > 96 THEN
    RETURN 0;
  END IF;

  PERFORM notification.id
  FROM public.notifications AS notification
  WHERE notification.email_claim_token = claim_token_in
    AND notification.email_delivery_key = delivery_key_in
  ORDER BY notification.id
  FOR UPDATE;

  SELECT pg_catalog.count(*)::integer
  INTO group_count
  FROM public.notifications AS notification
  WHERE notification.email_claim_token = claim_token_in
    AND notification.email_delivery_key = delivery_key_in;

  IF group_count = 0 OR EXISTS (
    SELECT 1
    FROM public.notifications AS notification
    WHERE notification.email_claim_token = claim_token_in
      AND notification.email_delivery_key = delivery_key_in
      AND (
        notification.email_provider_attempted_at IS NULL
        OR notification.email_claimed_at IS NULL
        OR notification.email_provider_attempted_at < notification.email_claimed_at
      )
  ) THEN
    RETURN 0;
  END IF;

  UPDATE public.notifications AS notification
  SET
    emailed_at = COALESCE(notification.emailed_at, now_value),
    email_claim_expires_at = now_value
  WHERE notification.email_claim_token = claim_token_in
    AND notification.email_delivery_key = delivery_key_in;

  RETURN group_count;
END
$function$;

CREATE OR REPLACE FUNCTION public.release_notification_email_delivery(
  claim_token_in uuid,
  delivery_key_in text
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  changed_count integer := 0;
BEGIN
  IF claim_token_in IS NULL
     OR delivery_key_in IS NULL
     OR pg_catalog.char_length(delivery_key_in) > 96 THEN
    RETURN 0;
  END IF;

  -- No provider attempt: return rows to the common pool. Attempted/ambiguous:
  -- drop only the lease/token and preserve the kind/key for same-path retry.
  UPDATE public.notifications AS notification
  SET
    email_delivery_kind = CASE
      WHEN notification.email_provider_attempted_at IS NULL THEN NULL
      ELSE notification.email_delivery_kind
    END,
    email_delivery_key = CASE
      WHEN notification.email_provider_attempted_at IS NULL THEN NULL
      ELSE notification.email_delivery_key
    END,
    email_claim_token = NULL,
    email_claimed_at = NULL,
    email_claim_expires_at = NULL
  WHERE notification.email_claim_token = claim_token_in
    AND notification.email_delivery_key = delivery_key_in
    AND notification.emailed_at IS NULL;
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  RETURN changed_count;
END
$function$;

REVOKE ALL ON FUNCTION public.claim_notification_email_delivery(uuid[], text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.renew_notification_email_delivery(uuid, text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.begin_notification_email_delivery(uuid, text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_notification_email_delivery(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.release_notification_email_delivery(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.claim_notification_email_delivery(uuid[], text, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_notification_email_delivery(uuid, text, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.begin_notification_email_delivery(uuid, text, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_notification_email_delivery(uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.release_notification_email_delivery(uuid, text)
  TO service_role;

NOTIFY pgrst, 'reload schema';
