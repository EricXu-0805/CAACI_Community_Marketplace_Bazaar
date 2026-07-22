-- Atomic, concurrency-safe seeding for daily meetup and unread-message email
-- reminders. The previous Edge implementation PATCHed reminded_at and then
-- POSTed notifications over a second HTTP request. A split failure after the
-- PATCH permanently lost the reminder; blocked/muted rows also stayed at the
-- head of a bounded scan forever and starved later eligible messages.
--
-- One service-only transaction now locks a bounded source batch, inserts
-- idempotently keyed notification rows, and stamps every evaluated source row.
-- Any SQL/trigger failure rolls the whole call back. Suppressed block/mute or
-- corrupt-recipient messages are deliberately retired: unblocking/unmuting
-- must not emit stale off-platform mail, and they can no longer starve the
-- oldest-first scan.

-- The symmetric chat trigger intentionally rejects ordinary writes without an
-- authenticated participant, including service-role PATCH requests. Reminder
-- stamps are server-owned bookkeeping and change no conversation payload. Keep
-- INSERT fully guarded, and on UPDATE bypass the block check only when the
-- entire row is identical after removing reminded_at. JSONB comparison keeps
-- future columns covered automatically; authenticated cannot update
-- reminded_at, so this does not open a client write path.
DROP TRIGGER IF EXISTS trg_chat_block_boundary ON public.messages;
DROP TRIGGER IF EXISTS trg_chat_block_boundary_update ON public.messages;
CREATE TRIGGER trg_chat_block_boundary
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_chat_block_boundary();
CREATE TRIGGER trg_chat_block_boundary_update
  BEFORE UPDATE ON public.messages
  FOR EACH ROW
  WHEN (
    (pg_catalog.to_jsonb(NEW) - 'reminded_at') IS DISTINCT FROM
    (pg_catalog.to_jsonb(OLD) - 'reminded_at')
  )
  EXECUTE FUNCTION public.enforce_chat_block_boundary();

DROP TRIGGER IF EXISTS trg_chat_block_boundary ON public.meetups;
DROP TRIGGER IF EXISTS trg_chat_block_boundary_update ON public.meetups;
CREATE TRIGGER trg_chat_block_boundary
  BEFORE INSERT ON public.meetups
  FOR EACH ROW EXECUTE FUNCTION public.enforce_chat_block_boundary();
CREATE TRIGGER trg_chat_block_boundary_update
  BEFORE UPDATE ON public.meetups
  FOR EACH ROW
  WHEN (
    (pg_catalog.to_jsonb(NEW) - 'reminded_at') IS DISTINCT FROM
    (pg_catalog.to_jsonb(OLD) - 'reminded_at')
  )
  EXECUTE FUNCTION public.enforce_chat_block_boundary();

CREATE OR REPLACE FUNCTION public.seed_digest_reminders(
  meetup_limit_in integer DEFAULT 200,
  message_limit_in integer DEFAULT 500,
  unread_hours_in integer DEFAULT 12
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  now_value timestamptz := pg_catalog.clock_timestamp();
  meetup_ids uuid[] := ARRAY[]::uuid[];
  message_ids uuid[] := ARRAY[]::uuid[];
  meetup_sources integer := 0;
  meetup_notifications integer := 0;
  unread_sources integer := 0;
  unread_notifications integer := 0;
BEGIN
  IF meetup_limit_in IS NULL
     OR meetup_limit_in < 1
     OR meetup_limit_in > 1000
     OR message_limit_in IS NULL
     OR message_limit_in < 1
     OR message_limit_in > 2000
     OR unread_hours_in IS NULL
     OR unread_hours_in < 1
     OR unread_hours_in > 168 THEN
    RAISE EXCEPTION 'invalid_reminder_seed_bounds' USING ERRCODE = '22023';
  END IF;

  -- Locks survive the aggregate's subquery until this function transaction
  -- commits. Concurrent cron retries SKIP the owned rows instead of duplicating
  -- them, while later rows can still make progress.
  SELECT COALESCE(pg_catalog.array_agg(candidate.id), ARRAY[]::uuid[])
    INTO meetup_ids
  FROM (
    SELECT meetup.id
    FROM public.meetups AS meetup
    WHERE meetup.status = 'accepted'
      AND meetup.reminded_at IS NULL
      AND meetup.meet_at >= now_value
      AND meetup.meet_at <= now_value + interval '24 hours'
    ORDER BY meetup.meet_at, meetup.id
    FOR UPDATE OF meetup SKIP LOCKED
    LIMIT meetup_limit_in
  ) AS candidate;

  meetup_sources := pg_catalog.cardinality(meetup_ids);
  IF meetup_sources > 0 THEN
    WITH eligible_meetup AS (
      SELECT meetup.*
      FROM public.meetups AS meetup
      JOIN public.conversations AS conversation
        ON conversation.id = meetup.conversation_id
       AND (
         (
           conversation.buyer_id = meetup.from_user
           AND conversation.seller_id = meetup.to_user
         ) OR (
           conversation.seller_id = meetup.from_user
           AND conversation.buyer_id = meetup.to_user
         )
       )
      WHERE meetup.id = ANY (meetup_ids)
        AND meetup.from_user <> meetup.to_user
        AND NOT EXISTS (
          SELECT 1
          FROM public.blocks AS block_relation
          WHERE (
            block_relation.blocker_id = meetup.from_user
            AND block_relation.blocked_id = meetup.to_user
          ) OR (
            block_relation.blocker_id = meetup.to_user
            AND block_relation.blocked_id = meetup.from_user
          )
        )
    ), reminder_row AS (
      SELECT
        meetup.id AS meetup_id,
        meetup.item_id,
        meetup.conversation_id,
        meetup.spot,
        meetup.meet_at,
        recipient.user_id
      FROM eligible_meetup AS meetup
      CROSS JOIN LATERAL (
        VALUES (meetup.from_user), (meetup.to_user)
      ) AS recipient(user_id)
    )
    INSERT INTO public.notifications (
      user_id,
      type,
      title,
      body,
      item_id,
      conversation_id,
      source_event_key
    )
    SELECT
      reminder.user_id,
      'meetup',
      '见面提醒 · Meetup reminder',
      meetup.spot || ' · ' || pg_catalog.to_char(
        meetup.meet_at AT TIME ZONE 'America/Chicago',
        'FMMM/FMDD HH24:MI'
      ) || ' CT',
      reminder.item_id,
      reminder.conversation_id,
      pg_catalog.format(
        'meetup-reminder:%s:%s',
        reminder.meetup_id::text,
        reminder.user_id::text
      )
    FROM reminder_row AS reminder
    JOIN eligible_meetup AS meetup ON meetup.id = reminder.meetup_id
    ON CONFLICT (source_event_key) WHERE source_event_key IS NOT NULL
      DO NOTHING;
    GET DIAGNOSTICS meetup_notifications = ROW_COUNT;

    UPDATE public.meetups AS meetup
    SET reminded_at = now_value
    WHERE meetup.id = ANY (meetup_ids)
      AND meetup.reminded_at IS NULL;
  END IF;

  SELECT COALESCE(pg_catalog.array_agg(candidate.id), ARRAY[]::uuid[])
    INTO message_ids
  FROM (
    SELECT message.id
    FROM public.messages AS message
    WHERE message.is_read IS FALSE
      AND message.reminded_at IS NULL
      AND message.created_at <= now_value - pg_catalog.make_interval(
        hours => unread_hours_in
      )
    ORDER BY message.created_at, message.id
    FOR UPDATE OF message SKIP LOCKED
    LIMIT message_limit_in
  ) AS candidate;

  unread_sources := pg_catalog.cardinality(message_ids);
  IF unread_sources > 0 THEN
    WITH resolved_message AS (
      SELECT
        message.id,
        message.conversation_id,
        conversation.buyer_id,
        conversation.seller_id,
        conversation.is_muted_buyer,
        conversation.is_muted_seller,
        CASE
          WHEN message.sender_id = conversation.buyer_id
            THEN conversation.seller_id
          WHEN message.sender_id = conversation.seller_id
            THEN conversation.buyer_id
          ELSE NULL
        END AS recipient_id
      FROM public.messages AS message
      JOIN public.conversations AS conversation
        ON conversation.id = message.conversation_id
      WHERE message.id = ANY (message_ids)
    ), eligible_message AS (
      SELECT resolved.*
      FROM resolved_message AS resolved
      WHERE resolved.recipient_id IS NOT NULL
        AND CASE
          WHEN resolved.recipient_id = resolved.buyer_id
            THEN resolved.is_muted_buyer IS NOT TRUE
          ELSE resolved.is_muted_seller IS NOT TRUE
        END
        AND NOT EXISTS (
          SELECT 1
          FROM public.blocks AS block_relation
          WHERE (
            block_relation.blocker_id = resolved.buyer_id
            AND block_relation.blocked_id = resolved.seller_id
          ) OR (
            block_relation.blocker_id = resolved.seller_id
            AND block_relation.blocked_id = resolved.buyer_id
          )
        )
    ), reminder_group AS (
      SELECT
        eligible.recipient_id,
        eligible.conversation_id,
        pg_catalog.count(*)::integer AS message_count,
        pg_catalog.md5(pg_catalog.string_agg(
          eligible.id::text,
          ',' ORDER BY eligible.id::text
        )) AS message_set_hash
      FROM eligible_message AS eligible
      GROUP BY eligible.recipient_id, eligible.conversation_id
    )
    INSERT INTO public.notifications (
      user_id,
      type,
      title,
      body,
      conversation_id,
      source_event_key
    )
    SELECT
      reminder.recipient_id,
      'unread_message',
      '未读消息 · Unread messages',
      '你有 ' || reminder.message_count::text || ' 条未读消息 · ' ||
        reminder.message_count::text || ' unread message' ||
        CASE WHEN reminder.message_count = 1 THEN '' ELSE 's' END,
      reminder.conversation_id,
      pg_catalog.format(
        'unread-reminder:%s:%s:%s',
        reminder.recipient_id::text,
        reminder.conversation_id::text,
        reminder.message_set_hash
      )
    FROM reminder_group AS reminder
    ON CONFLICT (source_event_key) WHERE source_event_key IS NOT NULL
      DO NOTHING;
    GET DIAGNOSTICS unread_notifications = ROW_COUNT;

    -- Stamp every evaluated source, including muted/blocked/corrupt-recipient
    -- rows. That is both the explicit no-stale-contact policy and the bounded
    -- scan's starvation fix. An insert/trigger error above rolls this back.
    UPDATE public.messages AS message
    SET reminded_at = now_value
    WHERE message.id = ANY (message_ids)
      AND message.reminded_at IS NULL;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'meetup_sources_scanned', meetup_sources,
    'meetup_reminders', meetup_notifications / 2,
    'meetup_notifications', meetup_notifications,
    'unread_messages_scanned', unread_sources,
    'unread_reminders', unread_notifications
  );
END
$function$;

REVOKE ALL ON FUNCTION public.seed_digest_reminders(integer, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.seed_digest_reminders(integer, integer, integer)
  TO service_role;

NOTIFY pgrst, 'reload schema';
