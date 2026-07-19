-- Durable, exact meetup-email delivery attribution.
--
-- Immediate meetup mail used to guess the notification to stamp by selecting
-- the recipient's newest meetup row for the same item in a ten-minute window.
-- Two buyers of one listing, or two out-of-order actions in one conversation,
-- could therefore mark an unrelated notification as emailed. The unrelated
-- row would disappear from the digest even though no email covered it.
--
-- This migration gives every meetup state event a stable unique key, writes
-- that key in the same transaction as the state transition, and exposes two
-- service-role-only functions: exact resolution and exact compare-and-set
-- acknowledgement. Existing client RPC signatures/return types stay intact.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS source_event_key text;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_source_event_key_uidx
  ON public.notifications (source_event_key)
  WHERE source_event_key IS NOT NULL;

COMMENT ON COLUMN public.notifications.source_event_key IS
  'Server-owned stable event identity. Meetup events use meetup:<meetup_uuid>:<pending|accepted|declined>; NULL denotes legacy or non-meetup notifications.';

-- One internal writer owns event-key construction and validates that the
-- recipient/item/conversation actually match the durable meetup row. It
-- returns the exact notification id to its state-machine caller.
CREATE OR REPLACE FUNCTION private.enqueue_meetup_event_notification(
  meetup_id_in uuid,
  event_kind_in text,
  recipient_id_in uuid,
  title_in text,
  body_in text,
  item_id_in uuid,
  conversation_id_in uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  meetup_row public.meetups;
  expected_recipient uuid;
  event_key text;
  notification_id uuid;
BEGIN
  IF meetup_id_in IS NULL
     OR recipient_id_in IS NULL
     OR conversation_id_in IS NULL
     OR event_kind_in NOT IN ('pending', 'accepted', 'declined') THEN
    RAISE EXCEPTION 'invalid_meetup_notification_event' USING ERRCODE = '22023';
  END IF;

  SELECT meetup.*
  INTO meetup_row
  FROM public.meetups AS meetup
  WHERE meetup.id = meetup_id_in;

  IF meetup_row.id IS NULL
     OR meetup_row.status::text <> event_kind_in
     OR meetup_row.conversation_id IS DISTINCT FROM conversation_id_in
     OR meetup_row.item_id IS DISTINCT FROM item_id_in THEN
    RAISE EXCEPTION 'meetup_notification_event_mismatch' USING ERRCODE = '23514';
  END IF;

  expected_recipient := CASE
    WHEN event_kind_in = 'pending' THEN meetup_row.to_user
    ELSE meetup_row.from_user
  END;
  IF expected_recipient IS DISTINCT FROM recipient_id_in THEN
    RAISE EXCEPTION 'meetup_notification_recipient_mismatch' USING ERRCODE = '23514';
  END IF;

  event_key := pg_catalog.format(
    'meetup:%s:%s', meetup_id_in::text, event_kind_in
  );

  INSERT INTO public.notifications (
    user_id, type, title, body, item_id, conversation_id, source_event_key
  ) VALUES (
    recipient_id_in,
    'meetup',
    title_in,
    COALESCE(body_in, ''),
    item_id_in,
    conversation_id_in,
    event_key
  )
  RETURNING id INTO notification_id;

  RETURN notification_id;
END
$function$;

REVOKE ALL ON FUNCTION private.enqueue_meetup_event_notification(
  uuid, text, uuid, text, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;

-- Service-only resolution returns exactly one id or no row. Recipient and
-- conversation are part of the lookup so an API bug cannot resolve an event
-- belonging to another participant.
CREATE OR REPLACE FUNCTION public.resolve_meetup_email_notification(
  meetup_id_in uuid,
  event_kind_in text,
  recipient_id_in uuid,
  conversation_id_in uuid
) RETURNS TABLE (
  notification_id uuid,
  source_event_key text,
  emailed_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT
    notification.id,
    notification.source_event_key,
    notification.emailed_at
  FROM public.notifications AS notification
  WHERE meetup_id_in IS NOT NULL
    AND event_kind_in IN ('pending', 'accepted', 'declined')
    AND recipient_id_in IS NOT NULL
    AND conversation_id_in IS NOT NULL
    AND notification.source_event_key = pg_catalog.format(
      'meetup:%s:%s', meetup_id_in::text, event_kind_in
    )
    AND notification.user_id = recipient_id_in
    AND notification.conversation_id = conversation_id_in
    AND notification.type = 'meetup'
  LIMIT 1
$function$;

-- Idempotent exact CAS: a success acknowledgement may mark only the resolved
-- id+event pair. Replaying the same acknowledgement returns true; supplying a
-- mismatched id/key returns false and changes nothing.
CREATE OR REPLACE FUNCTION public.mark_meetup_email_notification_emailed(
  notification_id_in uuid,
  source_event_key_in text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  changed_rows integer := 0;
BEGIN
  IF notification_id_in IS NULL
     OR source_event_key_in IS NULL
     OR pg_catalog.char_length(source_event_key_in) > 96 THEN
    RETURN false;
  END IF;

  UPDATE public.notifications AS notification
  SET emailed_at = pg_catalog.clock_timestamp()
  WHERE notification.id = notification_id_in
    AND notification.source_event_key = source_event_key_in
    AND notification.type = 'meetup'
    AND notification.emailed_at IS NULL;
  GET DIAGNOSTICS changed_rows = ROW_COUNT;

  IF changed_rows = 1 THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.notifications AS notification
    WHERE notification.id = notification_id_in
      AND notification.source_event_key = source_event_key_in
      AND notification.type = 'meetup'
      AND notification.emailed_at IS NOT NULL
  );
END
$function$;

REVOKE ALL ON FUNCTION public.resolve_meetup_email_notification(
  uuid, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mark_meetup_email_notification_emailed(
  uuid, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_meetup_email_notification(
  uuid, text, uuid, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_meetup_email_notification_emailed(
  uuid, text
) TO service_role;

-- Preserve the current symmetric-block/account-binding state machines and
-- replace only their notification writer with the exact event writer above.
CREATE OR REPLACE FUNCTION public.propose_meetup(
  p_conversation_id uuid,
  p_spot text,
  p_meet_at timestamptz,
  expected_user_id_in uuid,
  p_note text DEFAULT NULL
) RETURNS public.meetups
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_conv public.conversations;
  v_to uuid;
  v_spot text;
  v_meetup public.meetups;
  v_item_status public.item_status;
  v_notification_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF expected_user_id_in IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'account_changed' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_conv
  FROM public.conversations
  WHERE id = p_conversation_id;

  IF v_conv.id IS NULL
     OR NOT private.current_user_can_access_conversation(p_conversation_id) THEN
    RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT item.status INTO v_item_status
  FROM public.items AS item
  WHERE item.id = v_conv.item_id;

  IF v_item_status IS NULL
     OR v_item_status IN ('sold'::public.item_status, 'deleted'::public.item_status) THEN
    RAISE EXCEPTION 'item_unavailable_for_meetup' USING ERRCODE = '55000';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_conversation_id::text)::bigint
  );

  IF EXISTS (
    SELECT 1 FROM public.meetups
    WHERE conversation_id = p_conversation_id
      AND status = 'pending'
      AND expires_at > pg_catalog.now()
  ) THEN
    RAISE EXCEPTION 'a meetup proposal is already pending' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.meetups
    WHERE conversation_id = p_conversation_id
      AND status = 'accepted'
      AND meet_at > pg_catalog.now()
  ) THEN
    RAISE EXCEPTION 'a meetup is already confirmed; reschedule it instead'
      USING ERRCODE = '55000';
  END IF;

  v_spot := pg_catalog.btrim(COALESCE(p_spot, ''));
  IF pg_catalog.char_length(v_spot) = 0 OR pg_catalog.char_length(v_spot) > 120 THEN
    RAISE EXCEPTION 'invalid spot' USING ERRCODE = '22023';
  END IF;
  IF p_meet_at IS NULL
     OR p_meet_at < pg_catalog.now() - interval '2 hours'
     OR p_meet_at > pg_catalog.now() + interval '90 days' THEN
    RAISE EXCEPTION 'invalid meet time' USING ERRCODE = '22023';
  END IF;

  v_to := CASE
    WHEN v_uid = v_conv.buyer_id THEN v_conv.seller_id
    ELSE v_conv.buyer_id
  END;

  INSERT INTO public.meetups (
    conversation_id, item_id, from_user, to_user, spot, meet_at, note
  ) VALUES (
    p_conversation_id,
    v_conv.item_id,
    v_uid,
    v_to,
    v_spot,
    p_meet_at,
    NULLIF(pg_catalog.btrim(COALESCE(p_note, '')), '')
  )
  RETURNING * INTO v_meetup;

  UPDATE public.conversations
  SET last_message_at = pg_catalog.now()
  WHERE id = p_conversation_id;

  v_notification_id := private.enqueue_meetup_event_notification(
    v_meetup.id,
    'pending',
    v_to,
    '见面提议 · Meetup proposed',
    v_spot,
    v_conv.item_id,
    p_conversation_id
  );
  IF v_notification_id IS NULL THEN
    RAISE EXCEPTION 'meetup_notification_not_created' USING ERRCODE = '23514';
  END IF;
  RETURN v_meetup;
END
$function$;

CREATE OR REPLACE FUNCTION public.respond_to_meetup(
  p_meetup_id uuid,
  p_action text,
  expected_user_id_in uuid,
  p_new_spot text DEFAULT NULL,
  p_new_meet_at timestamptz DEFAULT NULL,
  p_new_note text DEFAULT NULL
) RETURNS public.meetups
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_meetup public.meetups;
  v_new public.meetups;
  v_spot text;
  v_item_status public.item_status;
  v_notification_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF expected_user_id_in IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'account_changed' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_meetup
  FROM public.meetups
  WHERE id = p_meetup_id
  FOR UPDATE;

  IF v_meetup.id IS NULL
     OR v_uid <> v_meetup.to_user
     OR NOT private.current_user_can_access_conversation(v_meetup.conversation_id) THEN
    RAISE EXCEPTION 'meetup_unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT item.status INTO v_item_status
  FROM public.items AS item
  WHERE item.id = v_meetup.item_id;

  IF v_item_status IS NULL
     OR v_item_status IN ('sold'::public.item_status, 'deleted'::public.item_status) THEN
    RAISE EXCEPTION 'item_unavailable_for_meetup' USING ERRCODE = '55000';
  END IF;

  IF v_meetup.status <> 'pending' THEN
    RAISE EXCEPTION 'meetup is no longer pending' USING ERRCODE = '55000';
  END IF;
  IF v_meetup.expires_at <= pg_catalog.now() THEN
    UPDATE public.meetups
    SET status = 'expired', updated_at = pg_catalog.now()
    WHERE id = p_meetup_id
    RETURNING * INTO v_meetup;
    RETURN v_meetup;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(v_meetup.conversation_id::text)::bigint
  );

  IF p_action = 'accept' THEN
    IF EXISTS (
      SELECT 1 FROM public.meetups
      WHERE conversation_id = v_meetup.conversation_id
        AND status = 'accepted'
        AND meet_at > pg_catalog.now()
        AND id <> p_meetup_id
    ) THEN
      RAISE EXCEPTION 'another meetup is already confirmed' USING ERRCODE = '55000';
    END IF;

    UPDATE public.meetups
    SET status = 'accepted', updated_at = pg_catalog.now()
    WHERE id = p_meetup_id
    RETURNING * INTO v_meetup;

    v_notification_id := private.enqueue_meetup_event_notification(
      v_meetup.id,
      'accepted',
      v_meetup.from_user,
      '约定已确认 · Meetup confirmed',
      v_meetup.spot,
      v_meetup.item_id,
      v_meetup.conversation_id
    );
    IF v_notification_id IS NULL THEN
      RAISE EXCEPTION 'meetup_notification_not_created' USING ERRCODE = '23514';
    END IF;
    UPDATE public.conversations
    SET last_message_at = pg_catalog.now()
    WHERE id = v_meetup.conversation_id;
    RETURN v_meetup;

  ELSIF p_action = 'decline' THEN
    UPDATE public.meetups
    SET status = 'declined', updated_at = pg_catalog.now()
    WHERE id = p_meetup_id
    RETURNING * INTO v_meetup;

    v_notification_id := private.enqueue_meetup_event_notification(
      v_meetup.id,
      'declined',
      v_meetup.from_user,
      '约定被婉拒 · Meetup declined',
      v_meetup.spot,
      v_meetup.item_id,
      v_meetup.conversation_id
    );
    IF v_notification_id IS NULL THEN
      RAISE EXCEPTION 'meetup_notification_not_created' USING ERRCODE = '23514';
    END IF;
    RETURN v_meetup;

  ELSIF p_action = 'reschedule' THEN
    v_spot := pg_catalog.btrim(COALESCE(p_new_spot, ''));
    IF pg_catalog.char_length(v_spot) = 0 OR pg_catalog.char_length(v_spot) > 120 THEN
      RAISE EXCEPTION 'invalid spot' USING ERRCODE = '22023';
    END IF;
    IF p_new_meet_at IS NULL
       OR p_new_meet_at < pg_catalog.now() - interval '2 hours'
       OR p_new_meet_at > pg_catalog.now() + interval '90 days' THEN
      RAISE EXCEPTION 'invalid meet time' USING ERRCODE = '22023';
    END IF;

    UPDATE public.meetups
    SET status = 'rescheduled', updated_at = pg_catalog.now()
    WHERE id = p_meetup_id;

    INSERT INTO public.meetups (
      conversation_id, item_id, from_user, to_user, spot, meet_at, note, parent_meetup_id
    ) VALUES (
      v_meetup.conversation_id,
      v_meetup.item_id,
      v_uid,
      v_meetup.from_user,
      v_spot,
      p_new_meet_at,
      NULLIF(pg_catalog.btrim(COALESCE(p_new_note, '')), ''),
      v_meetup.id
    )
    RETURNING * INTO v_new;

    UPDATE public.conversations
    SET last_message_at = pg_catalog.now()
    WHERE id = v_meetup.conversation_id;

    v_notification_id := private.enqueue_meetup_event_notification(
      v_new.id,
      'pending',
      v_meetup.from_user,
      '新的见面提议 · Meetup updated',
      v_spot,
      v_meetup.item_id,
      v_meetup.conversation_id
    );
    IF v_notification_id IS NULL THEN
      RAISE EXCEPTION 'meetup_notification_not_created' USING ERRCODE = '23514';
    END IF;
    RETURN v_new;

  ELSE
    RAISE EXCEPTION 'unknown action' USING ERRCODE = '22023';
  END IF;
END
$function$;

CREATE OR REPLACE FUNCTION public.reschedule_accepted_meetup(
  p_meetup_id uuid,
  p_new_spot text,
  p_new_meet_at timestamptz,
  expected_user_id_in uuid,
  p_new_note text DEFAULT NULL
) RETURNS public.meetups
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_meetup public.meetups;
  v_new public.meetups;
  v_spot text;
  v_other uuid;
  v_item_status public.item_status;
  v_notification_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF expected_user_id_in IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'account_changed' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_meetup
  FROM public.meetups
  WHERE id = p_meetup_id
  FOR UPDATE;

  IF v_meetup.id IS NULL
     OR v_uid NOT IN (v_meetup.from_user, v_meetup.to_user)
     OR NOT private.current_user_can_access_conversation(v_meetup.conversation_id) THEN
    RAISE EXCEPTION 'meetup_unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT item.status INTO v_item_status
  FROM public.items AS item
  WHERE item.id = v_meetup.item_id;

  IF v_item_status IS NULL
     OR v_item_status IN ('sold'::public.item_status, 'deleted'::public.item_status) THEN
    RAISE EXCEPTION 'item_unavailable_for_meetup' USING ERRCODE = '55000';
  END IF;

  IF v_meetup.status <> 'accepted' THEN
    RAISE EXCEPTION 'only an accepted meetup can be rescheduled' USING ERRCODE = '55000';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(v_meetup.conversation_id::text)::bigint
  );

  IF EXISTS (
    SELECT 1 FROM public.meetups
    WHERE conversation_id = v_meetup.conversation_id
      AND status = 'pending'
      AND expires_at > pg_catalog.now()
  ) THEN
    RAISE EXCEPTION 'a meetup proposal is already pending' USING ERRCODE = '55000';
  END IF;

  v_spot := pg_catalog.btrim(COALESCE(p_new_spot, ''));
  IF pg_catalog.char_length(v_spot) = 0 OR pg_catalog.char_length(v_spot) > 120 THEN
    RAISE EXCEPTION 'invalid spot' USING ERRCODE = '22023';
  END IF;
  IF p_new_meet_at IS NULL
     OR p_new_meet_at < pg_catalog.now() - interval '2 hours'
     OR p_new_meet_at > pg_catalog.now() + interval '90 days' THEN
    RAISE EXCEPTION 'invalid meet time' USING ERRCODE = '22023';
  END IF;

  v_other := CASE
    WHEN v_uid = v_meetup.from_user THEN v_meetup.to_user
    ELSE v_meetup.from_user
  END;

  UPDATE public.meetups
  SET status = 'rescheduled', updated_at = pg_catalog.now()
  WHERE id = p_meetup_id;

  INSERT INTO public.meetups (
    conversation_id, item_id, from_user, to_user, spot, meet_at, note, parent_meetup_id
  ) VALUES (
    v_meetup.conversation_id,
    v_meetup.item_id,
    v_uid,
    v_other,
    v_spot,
    p_new_meet_at,
    NULLIF(pg_catalog.btrim(COALESCE(p_new_note, '')), ''),
    v_meetup.id
  )
  RETURNING * INTO v_new;

  UPDATE public.conversations
  SET last_message_at = pg_catalog.now()
  WHERE id = v_meetup.conversation_id;

  v_notification_id := private.enqueue_meetup_event_notification(
    v_new.id,
    'pending',
    v_other,
    '改约请求 · Meetup change requested',
    v_spot,
    v_meetup.item_id,
    v_meetup.conversation_id
  );
  IF v_notification_id IS NULL THEN
    RAISE EXCEPTION 'meetup_notification_not_created' USING ERRCODE = '23514';
  END IF;
  RETURN v_new;
END
$function$;

REVOKE ALL ON FUNCTION public.propose_meetup(
  uuid, text, timestamptz, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.respond_to_meetup(
  uuid, text, uuid, text, timestamptz, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reschedule_accepted_meetup(
  uuid, text, timestamptz, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.propose_meetup(
  uuid, text, timestamptz, uuid, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_meetup(
  uuid, text, uuid, text, timestamptz, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_accepted_meetup(
  uuid, text, timestamptz, uuid, text
) TO authenticated;

NOTIFY pgrst, 'reload schema';
