-- P4.6: grant member event writes behind a switch and normalize event text.
-- Release: apply 20261120122054 and pass its VERIFY, then run
-- PRECHECK_20261122035253, this migration, and VERIFY_20261122035253, in that order.
-- The switch starts off. Only the release owner, or a person approved by
-- name by that owner, may enable it after the RUNBOOK prerequisites hold.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
DECLARE
  expected record;
  stored text;
BEGIN
  FOR expected IN
    SELECT * FROM (VALUES
    ('private.community_events_member_guard()', 'ec91e9bd0c1be76895d1adba1227af8c'),
    ('public.create_member_event(uuid,text,text,jsonb)', '9a22a3c4dc3326b90a29160466416887')
    ) AS known(signature, body_md5)
  LOOP
    SELECT pg_catalog.md5(routine.prosrc) INTO stored
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid = pg_catalog.to_regprocedure(expected.signature);
    IF stored IS DISTINCT FROM expected.body_md5 THEN
      RAISE EXCEPTION 'community_member_events_precondition:function:%:%', expected.signature, coalesce(stored, 'missing');
    END IF;
  END LOOP;

  IF pg_catalog.has_function_privilege('authenticated', 'public.create_member_event(uuid,text,text,jsonb)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.create_member_event(uuid,text,text,jsonb)', 'EXECUTE')
     OR pg_catalog.has_any_column_privilege('authenticated', 'public.community_events', 'INSERT')
     OR pg_catalog.has_any_column_privilege('authenticated', 'public.community_events', 'UPDATE')
     OR pg_catalog.has_any_column_privilege('anon', 'public.community_events', 'INSERT')
     OR pg_catalog.has_any_column_privilege('anon', 'public.community_events', 'UPDATE') THEN
    RAISE EXCEPTION 'community_member_events_precondition:channel_open';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM public.community_events WHERE source_type = 'member') <> 0 THEN
    RAISE EXCEPTION 'community_member_events_precondition:member_rows';
  END IF;
END
$guard$;

CREATE TABLE private.community_member_event_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false
);
INSERT INTO private.community_member_event_config DEFAULT VALUES;
ALTER TABLE private.community_member_event_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.community_member_event_config FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.community_member_events_open()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
SET statement_timeout = '3s'
AS $function$
  SELECT coalesce((SELECT config.enabled FROM private.community_member_event_config AS config WHERE config.singleton), false)
$function$;
REVOKE ALL ON FUNCTION public.community_member_events_open() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_member_events_open() TO anon, authenticated;

ALTER TABLE public.community_events DROP CONSTRAINT community_events_member_shape;
ALTER TABLE public.community_events
  ADD CONSTRAINT community_events_member_shape CHECK (source_type <> 'member' OR (
    organizer_user_id IS NOT NULL AND source_key ~ '^[0-9a-f-]{36}$'
    AND page_url IS NULL AND register_url IS NULL
    AND registration_mode = 'discussion' AND title IS NULL AND title_en IS NULL
    AND occurrence_count = 1
    -- A normalized place, as create_member_event stores it.
    -- IS NOT NULL is spelled out: a CHECK holds for an unknown place.
    AND location IS NOT NULL AND location = pg_catalog.btrim(pg_catalog.regexp_replace(location, '[\u0009-\u000D \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+', ' ', 'g'), ' ')
    AND char_length(location) BETWEEN 1 AND 80
    AND (status_note IS NULL OR status_note = pg_catalog.btrim(pg_catalog.regexp_replace(status_note, '[\u0009-\u000D \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+', ' ', 'g'), ' '))));

CREATE OR REPLACE FUNCTION public.create_member_event(
  post_id_in uuid,
  title_in text,
  content_in text,
  event_in jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
DECLARE
  caller uuid := (SELECT auth.uid());
  title_value text := pg_catalog.btrim(pg_catalog.regexp_replace(title_in, '[\u0009-\u000D \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+', ' ', 'g'), ' ');
  location_value text;
  starts_value timestamptz;
  ends_value timestamptz;
  event_id_value uuid;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'not_authenticated';
  END IF;
  IF post_id_in IS NULL OR pg_catalog.jsonb_typeof(event_in) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'member_event_invalid';
  END IF;
  IF pg_catalog.char_length(coalesce(title_value, '')) > 60 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'member_event_title_too_long';
  END IF;
  location_value := pg_catalog.btrim(pg_catalog.regexp_replace(event_in ->> 'location', '[\u0009-\u000D \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+', ' ', 'g'), ' ');
  IF location_value IS NULL OR pg_catalog.char_length(location_value) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'member_event_location_invalid';
  END IF;
  BEGIN
    starts_value := (event_in ->> 'starts_at')::timestamptz;
    ends_value := nullif(event_in ->> 'ends_at', '')::timestamptz;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION USING ERRCODE = '22008', MESSAGE = 'member_event_time_out_of_range';
  END;
  IF starts_value IS NULL OR NOT pg_catalog.isfinite(starts_value) THEN
    RAISE EXCEPTION USING ERRCODE = '22008', MESSAGE = 'member_event_time_out_of_range';
  END IF;
  IF ends_value IS NOT NULL THEN
    IF NOT pg_catalog.isfinite(ends_value) OR ends_value < starts_value THEN
      RAISE EXCEPTION USING ERRCODE = '22008', MESSAGE = 'member_event_time_out_of_range';
    END IF;
    IF ends_value - starts_value > interval '30 days' THEN
      RAISE EXCEPTION USING ERRCODE = '22008', MESSAGE = 'member_event_time_out_of_range';
    END IF;
  END IF;

  SELECT event.id INTO event_id_value
    FROM public.community_events AS event
   WHERE event.source_type = 'member'
     AND event.source_key = post_id_in::text
     AND event.organizer_user_id = caller;
  IF event_id_value IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('post_id', post_id_in, 'event_id', event_id_value);
  END IF;

  BEGIN
    INSERT INTO public.posts (id, user_id, content, title, category)
    VALUES (post_id_in, caller, content_in, title_value, 'events-social');

    INSERT INTO public.community_events (
      source_type, source_key, organizer_user_id, discussion_post_id,
      starts_at, ends_at, location, registration_mode
    ) VALUES (
      'member', post_id_in::text, caller, post_id_in,
      starts_value, ends_value, location_value, 'discussion'
    )
    RETURNING id INTO event_id_value;
  EXCEPTION WHEN unique_violation OR raise_exception THEN
    IF SQLSTATE = 'P0001' AND SQLERRM <> 'duplicate_post' THEN
      RAISE;
    END IF;
    SELECT event.id INTO event_id_value
      FROM public.community_events AS event
     WHERE event.source_type = 'member'
       AND event.source_key = post_id_in::text
       AND event.organizer_user_id = caller;
    IF event_id_value IS NULL THEN
      RAISE;
    END IF;
  END;

  RETURN pg_catalog.jsonb_build_object('post_id', post_id_in, 'event_id', event_id_value);
END;
$function$;

CREATE OR REPLACE FUNCTION private.community_events_member_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  link_pattern constant text :=
    '(https?://|www[.]|[a-z0-9-]+[.](com|net|org|edu|cn|io|me|ly|link)\y)';
  reserved_pattern constant text := '(官方|主办|official|hosted by)';
  topic_author uuid;
  topic_status text;
  topic_category text;
  topic_created_at timestamptz;
  topic_title text;
  topic_content text;
  open_events integer;
  -- What this write sets: an insert sets everything, an update what it changes.
  sets_place boolean := true;
  sets_note boolean := true;
  sets_times boolean := true;
BEGIN
  IF NEW.source_type <> 'member' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    sets_place := NEW.location IS DISTINCT FROM OLD.location;
    NEW.status_note := nullif(pg_catalog.btrim(pg_catalog.regexp_replace(NEW.status_note, '[\u0009-\u000D \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+', ' ', 'g'), ' '), '');
    sets_note := NEW.status_note IS DISTINCT FROM OLD.status_note;
    sets_times := NEW.starts_at IS DISTINCT FROM OLD.starts_at
      OR NEW.ends_at IS DISTINCT FROM OLD.ends_at;
    IF OLD.cancelled_at IS NOT NULL AND NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'member_event_cancel_final';
    END IF;
    -- A cancellation is dated by the server, whatever instant the client sent:
    -- the list reads "cancelled" and "over" from it.
    IF OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NOT NULL THEN
      NEW.cancelled_at := pg_catalog.now();
    END IF;
    -- D-49: a note is text other people read. Cancelling without one stays open.
    IF sets_note AND NEW.status_note IS NOT NULL THEN
      PERFORM moderation_private.assert_posting_allowed(NEW.organizer_user_id);
    END IF;
  ELSE
    IF NOT coalesce((SELECT enabled FROM private.community_member_event_config WHERE singleton), false) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'member_events_closed';
    END IF;
    SELECT post.user_id, post.status, post.category, post.created_at, post.title, post.content
      INTO topic_author, topic_status, topic_category, topic_created_at, topic_title, topic_content
      FROM public.posts AS post
     WHERE post.id = NEW.discussion_post_id;
    IF NOT FOUND
       OR topic_author IS DISTINCT FROM (SELECT auth.uid())
       OR topic_author IS DISTINCT FROM NEW.organizer_user_id
       OR topic_status IS DISTINCT FROM 'active'
       OR topic_category IS DISTINCT FROM 'events-social'
       OR topic_created_at IS DISTINCT FROM pg_catalog.now()
       OR NEW.source_key IS DISTINCT FROM NEW.discussion_post_id::text THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'member_event_rpc_required';
    END IF;

    -- D-49: other people see a member's event. The topic's own trigger refuses
    -- a restricted account first; this holds the rule for the event itself.
    PERFORM moderation_private.assert_posting_allowed(NEW.organizer_user_id);

    IF NOT EXISTS (
      SELECT 1
        FROM public.profiles AS member
       WHERE member.id = NEW.organizer_user_id
         AND member.is_illini_verified
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'member_event_not_eligible';
    END IF;

    -- The length create_member_event allows a title.
    IF pg_catalog.char_length(topic_title) > 60 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'member_event_title_too_long';
    END IF;

    IF NEW.starts_at <= pg_catalog.now()
       OR NEW.starts_at > pg_catalog.now() + interval '60 days' THEN
      RAISE EXCEPTION USING ERRCODE = '22008', MESSAGE = 'member_event_time_out_of_range';
    END IF;

    -- An event whose topic its author deleted is gone for good (the link is
    -- cleared and nothing can restore it), so it holds no place.
    SELECT pg_catalog.count(*) INTO open_events
      FROM public.community_events AS event
     WHERE event.source_type = 'member'
       AND event.organizer_user_id = NEW.organizer_user_id
       AND event.cancelled_at IS NULL
       AND event.discussion_post_id IS NOT NULL
       AND coalesce(event.ends_at, event.starts_at) >= pg_catalog.now();
    IF open_events >= 2 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'member_event_active_limit';
    END IF;

    IF topic_title ~* reserved_pattern THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'member_event_reserved_wording';
    END IF;
    IF coalesce(topic_title, '') ~* link_pattern
       OR coalesce(topic_content, '') ~* link_pattern THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'member_event_link_not_allowed';
    END IF;
  END IF;

  -- An end is an instant, not before the start and within 30 days of it.
  IF sets_times AND NEW.ends_at IS NOT NULL THEN
    IF NOT pg_catalog.isfinite(NEW.starts_at) OR NOT pg_catalog.isfinite(NEW.ends_at)
       OR NEW.ends_at < NEW.starts_at THEN
      RAISE EXCEPTION USING ERRCODE = '22008', MESSAGE = 'member_event_time_out_of_range';
    END IF;
    IF NEW.ends_at - NEW.starts_at > interval '30 days' THEN
      RAISE EXCEPTION USING ERRCODE = '22008', MESSAGE = 'member_event_time_out_of_range';
    END IF;
  END IF;

  -- The place and the note are text other people read: no reserved wording
  -- and no link, as in the topic's title.
  IF (sets_place AND NEW.location ~* reserved_pattern)
     OR (sets_note AND NEW.status_note ~* reserved_pattern) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'member_event_reserved_wording';
  END IF;
  IF (sets_place AND NEW.location ~* link_pattern)
     OR (sets_note AND NEW.status_note ~* link_pattern) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'member_event_link_not_allowed';
  END IF;

  RETURN NEW;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_member_event(uuid, text, text, jsonb) TO authenticated;
GRANT INSERT (source_type, source_key, organizer_user_id, discussion_post_id, starts_at, ends_at, location, registration_mode) ON TABLE public.community_events TO authenticated;
GRANT UPDATE (cancelled_at, status_note) ON TABLE public.community_events TO authenticated;

COMMENT ON TABLE public.community_events IS
  'Community events. Member writes are granted by 20261122035253 and new events require the member switch to be on.';
COMMENT ON FUNCTION public.create_member_event(uuid, text, text, jsonb) IS
  'Creates one member topic and event. The write channel is granted by 20261122035253 and new events obey the member switch.';
COMMENT ON TABLE private.community_member_event_config IS
  'One member event creation switch, initially off and writable only by the owner.';
COMMENT ON FUNCTION public.community_member_events_open() IS
  'Reports whether members may start new events; cancellation remains available when off.';
COMMIT;
