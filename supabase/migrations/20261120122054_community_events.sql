-- P4.2: community events (ENGINEERING 5.5), with the database side of the
-- events page (P4.8) and of the discussion and takedown actions (P4.9).
-- Events from four sources live in one table: caaci, partner, campus and
-- member. Each source has its own way in. Everything is additive.
--
-- Release order: apply this and pass VERIFY before the client or the Edge API
-- that uses it is deployed. What is already deployed keeps working: nothing
-- existing changes shape, and admin_token_authorization(_v2) keep reporting
-- the vocabulary they always have, so the three new administrator actions do
-- not lock anyone out before the new API ships.
--
-- Who writes what:
--   member   only public.create_member_event, which writes the topic and the
--            event in one transaction; the guard refuses a direct insert.
--   caaci, campus, partner
--            no client or service write is granted here. Their writers (the
--            CAACI sync, the campus import and the partner actions: P4.4,
--            P4.7, P4.5) are not part of this batch and need a later
--            migration.
--   discussion topic of an organization's event, and takedown
--            the administrator actions create_event_discussion, hide_event
--            and unhide_event on the atomic channel.
--
-- D-49 classification of the new write paths (decided by the action log
-- through moderation_private.assert_posting_allowed, never by the cached
-- profiles.suspension_level):
--   create a member event       other people see it: refused for an account
--                               under an active level 2-5 restriction.
--   write status_note           free text other people read: refused.
--   cancel one's own event      withdrawing one's own content, like delisting
--   without a note              an item: stays open.
--   member_event_not_eligible therefore means only "campus email not
--   verified". The aa_restricted_account_write trigger is not attached to the
--   new table; the member guard calls the assertion itself.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Wrap only what the local full replay measured (PRECHECK repeats this for
-- the hosted database). A different body or vocabulary means the object was
-- changed outside this repository and the edits below must be reviewed
-- against it.
DO $guard$
DECLARE
  expected record;
  stored text;
BEGIN
  FOR expected IN
    SELECT * FROM (VALUES
    ('public.admin_execute_mutation(text,uuid,text,text,jsonb)', '64d6f1d37e03577d534ccc5e1d496499'),
    ('public.admin_assert_mutation_capability(uuid,text)', '51c79ee5189f512333e2e8a3e4b47ba0'),
    ('public.record_audit(text,uuid,uuid,jsonb)', '38cb635c4cf81051966bc563ebf6142d'),
    ('public.admin_moderation_reason_valid(text)', '3f75864d5dfc236033a8cd232238baf2'),
    ('moderation_private.profile_content_visible(uuid)', 'a41223ba4e42754a12eec610e9ab03cf'),
    ('moderation_private.assert_posting_allowed(uuid)', 'bce717345cade3cf4d4656b20d5ae2df'),
    ('public.update_updated_at()', 'da5ac28a58c8b4bb30209bf0d3d7082c')
    ) AS known(signature, body_md5)
  LOOP
    SELECT pg_catalog.md5(routine.prosrc) INTO stored
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = pg_catalog.to_regprocedure(expected.signature);
    IF stored IS DISTINCT FROM expected.body_md5 THEN
      RAISE EXCEPTION 'community_events_function_drift:%:%',
        expected.signature, coalesce(stored, 'missing');
    END IF;
  END LOOP;

  -- The three administrator vocabularies are restated below. Restating a
  -- list that somebody extended elsewhere would silently drop their values.
  FOR expected IN
    SELECT * FROM (VALUES
    ('public.admin_mutation_requests', 'admin_mutation_requests_action_check',
     'apply_ban,decide_appeal,delete_banner,issue_token,lift_suspension,resolve_target_reports,restore_content,revoke_admin_tokens,revoke_token,set_post_category,set_post_featured,set_post_locked,set_post_official,set_post_pinned,takedown_content,update_report_status,upsert_banner'),
    ('public.admin_role_action_capabilities', 'admin_role_action_capabilities_action_check',
     'apply_ban,decide_appeal,delete_banner,issue_token,lift_suspension,resolve_target_reports,restore_content,revoke_admin_tokens,revoke_token,set_post_category,set_post_featured,set_post_locked,set_post_official,set_post_pinned,takedown_content,update_report_status,upload_banner,upsert_banner'),
    ('public.admin_audit_log', 'admin_audit_log_event_kind_check',
     'actor_blocked,admin_login,admin_unauthorized,appeal_decided,appeal_more_information_requested,ban_applied,banner_changed,content_restored,content_takedown,post_category_changed,post_featured_changed,post_lock_changed,post_official_changed,post_pin_changed,report_status_changed,support_email_claimed,suspension_lifted,token_issued,token_revoked')
    ) AS known(relation, constraint_name, vocabulary)
  LOOP
    SELECT pg_catalog.string_agg(accepted.value, ',' ORDER BY accepted.value COLLATE "C") INTO stored
    FROM pg_catalog.pg_constraint AS definition
    CROSS JOIN LATERAL (
      SELECT (pg_catalog.regexp_matches(
        pg_catalog.pg_get_constraintdef(definition.oid), '''([a-z_]+)''::text', 'g'
      ))[1] AS value
    ) AS accepted
    WHERE definition.conrelid = pg_catalog.to_regclass(expected.relation)
      AND definition.conname = expected.constraint_name
      AND definition.contype = 'c';
    IF stored IS DISTINCT FROM expected.vocabulary THEN
      RAISE EXCEPTION 'community_events_vocabulary_drift:%:%',
        expected.constraint_name, coalesce(stored, 'missing');
    END IF;
  END LOOP;
END
$guard$;

-- ---------------------------------------------------------------------------
-- Tables (ENGINEERING 5.5)
-- ---------------------------------------------------------------------------
CREATE TABLE public.community_event_partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{2,32}$'),
  name_zh text NOT NULL CHECK (char_length(name_zh) BETWEEN 1 AND 40),
  name_en text NOT NULL CHECK (char_length(name_en) BETWEEN 1 AND 80),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','revoked')),
  consent_ref text NOT NULL CHECK (consent_ref ~ '^[A-Za-z0-9-]{3,40}$'),
  consent_recorded_on date NOT NULL,
  contact_role text NOT NULL CHECK (char_length(contact_role) BETWEEN 2 AND 60),
  allowed_link_hosts text[] NOT NULL DEFAULT '{}' CHECK (cardinality(allowed_link_hosts) <= 5),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);

CREATE TABLE public.community_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL CHECK (source_type IN ('caaci','partner','campus','member')),
  source_key text NOT NULL CHECK (char_length(source_key) BETWEEN 1 AND 600),
  region text NOT NULL DEFAULT 'cu',
  organizer_name text CHECK (char_length(organizer_name) BETWEEN 2 AND 80),
  partner_id uuid REFERENCES public.community_event_partners(id),
  consent_ref text,
  title text CHECK (char_length(title) <= 160),
  title_en text CHECK (char_length(title_en) <= 160),
  summary text CHECK (char_length(summary) <= 280),
  summary_en text CHECK (char_length(summary_en) <= 280),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  all_day boolean NOT NULL DEFAULT false,
  occurrence_count integer NOT NULL DEFAULT 1 CHECK (occurrence_count BETWEEN 1 AND 400),
  time_zone text NOT NULL DEFAULT 'America/Chicago' CHECK (time_zone = 'America/Chicago'),
  location text CHECK (char_length(location) <= 160),
  page_url text CHECK (char_length(page_url) <= 500),
  register_url text CHECK (char_length(register_url) <= 500),
  registration_mode text NOT NULL CHECK (registration_mode IN
    ('caaci_site','info_only','external_link','calendar_page','discussion')),
  takes_registrations boolean,
  registration_open boolean,
  organizer_user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  discussion_post_id uuid UNIQUE REFERENCES public.posts(id) ON DELETE SET NULL,
  availability text NOT NULL DEFAULT 'visible' CHECK (availability IN ('visible','unavailable','hidden')),
  hidden_reason text CHECK (hidden_reason IN ('admin','post_removed')),
  cancelled_at timestamptz,
  status_note text CHECK (char_length(status_note) BETWEEN 1 AND 80),
  previous_starts_at timestamptz,
  schedule_changed_at timestamptz,
  revision integer NOT NULL DEFAULT 1,
  review_flag text CHECK (review_flag IN ('title_says_cancelled','source_time_changed_near_start')),
  duplicate_of uuid REFERENCES public.community_events(id) ON DELETE SET NULL,
  content_hash text,
  source_updated_at timestamptz,
  last_checked_at timestamptz,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  missing_since timestamptz,
  missing_checks smallint NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_events_region_check CHECK (region IN ('cu')),
  CONSTRAINT community_events_source_unique UNIQUE (source_type, source_key),
  CONSTRAINT community_events_time_order_check CHECK (ends_at IS NULL OR ends_at >= starts_at),
  CONSTRAINT community_events_duplicate_check CHECK (duplicate_of IS NULL OR duplicate_of <> id),
  CONSTRAINT community_events_hidden_pair_check CHECK ((availability = 'hidden') = (hidden_reason IS NOT NULL)),
  CONSTRAINT community_events_cancel_member_check CHECK (cancelled_at IS NULL OR source_type = 'member'),
  CONSTRAINT community_events_display_title_check CHECK (
    source_type = 'member' OR coalesce(title, '') <> '' OR coalesce(title_en, '') <> ''),
  CONSTRAINT community_events_caaci_shape CHECK (source_type <> 'caaci' OR (
    source_key ~ '^[0-9a-f-]{36}$'
    AND page_url ~ '^https://caaciorg[.]com/events/#[A-Za-z0-9-]+$'
    AND (register_url IS NULL OR register_url ~ '^https://caaciorg[.]com/events/[a-z0-9-]+/register/$')
    AND registration_mode IN ('caaci_site','info_only')
    AND partner_id IS NULL AND organizer_user_id IS NULL)),
  CONSTRAINT community_events_partner_shape CHECK (source_type <> 'partner' OR (
    partner_id IS NOT NULL AND consent_ref IS NOT NULL
    AND page_url ~ '^https://' AND (register_url IS NULL OR register_url ~ '^https://')
    AND registration_mode IN ('external_link','info_only')
    AND ((registration_mode = 'external_link') = (register_url IS NOT NULL))
    AND coalesce(summary, '') <> '' AND organizer_user_id IS NULL)),
  CONSTRAINT community_events_campus_shape CHECK (source_type <> 'campus' OR (
    source_key ~ '^[0-9]{1,6}/[0-9]{1,12}$'
    AND page_url = 'https://calendars.illinois.edu/detail/' || source_key
    AND register_url IS NULL AND registration_mode = 'calendar_page'
    AND organizer_name IS NOT NULL AND coalesce(title_en, '') <> ''
    AND partner_id IS NULL AND organizer_user_id IS NULL)),
  CONSTRAINT community_events_member_shape CHECK (source_type <> 'member' OR (
    organizer_user_id IS NOT NULL AND source_key ~ '^[0-9a-f-]{36}$'
    AND page_url IS NULL AND register_url IS NULL
    AND registration_mode = 'discussion' AND title IS NULL AND title_en IS NULL
    AND occurrence_count = 1 AND char_length(location) BETWEEN 1 AND 80))
);

CREATE INDEX community_events_list_idx ON public.community_events (region, starts_at, id)
  WHERE availability = 'visible' AND duplicate_of IS NULL;
CREATE INDEX community_events_organizer_idx ON public.community_events (organizer_user_id, starts_at)
  WHERE source_type = 'member';
CREATE INDEX community_events_campus_check_idx ON public.community_events (last_checked_at NULLS FIRST)
  WHERE source_type = 'campus' AND availability <> 'hidden';

CREATE TABLE public.community_event_sync_state (
  source text PRIMARY KEY CHECK (source IN ('caaci','campus')),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_outcome text CHECK (last_outcome IN ('ok','partial','failed')),
  last_error_code text CHECK (last_error_code ~ '^[a-z0-9_]{1,40}$')
);

-- ---------------------------------------------------------------------------
-- Privileges and row security
-- ---------------------------------------------------------------------------
ALTER TABLE public.community_event_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_event_sync_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.community_event_partners, public.community_events, public.community_event_sync_state
  FROM PUBLIC, anon, authenticated, service_role;
-- The service role only reads. caaci, campus and partner rows get their
-- writers in a later migration.
GRANT SELECT ON TABLE public.community_event_partners, public.community_events, public.community_event_sync_state
  TO service_role;

-- Everything a reader may see of an event. Bookkeeping of the sources, the
-- review flag, why a row is hidden, the consent reference and who created the
-- row stay private.
GRANT SELECT (
  id, source_type, source_key, region, organizer_name, partner_id, title, title_en, summary, summary_en,
  starts_at, ends_at, all_day, occurrence_count, time_zone, location, page_url, register_url,
  registration_mode, takes_registrations, registration_open, organizer_user_id, discussion_post_id,
  availability, cancelled_at, status_note, previous_starts_at, schedule_changed_at, revision,
  duplicate_of, created_at, updated_at
) ON TABLE public.community_events TO anon, authenticated;

-- Only visible rows are public. An organization's event needs its partner to
-- be active, and a member's event needs its organizer to be visible.
CREATE POLICY "Anyone can view visible events" ON public.community_events
  FOR SELECT TO anon, authenticated
  USING (
    availability = 'visible'
    AND (partner_id IS NULL OR EXISTS (
      SELECT 1
        FROM public.community_event_partners AS partner
       WHERE partner.id = community_events.partner_id
         AND partner.status = 'active'
    ))
    AND (source_type <> 'member' OR moderation_private.profile_content_visible(organizer_user_id))
  );
-- An organizer keeps reading their own event after it was taken down.
CREATE POLICY "Organizers can view own events" ON public.community_events
  FOR SELECT TO authenticated
  USING (organizer_user_id = (SELECT auth.uid()));

GRANT INSERT (
  source_type, source_key, organizer_user_id, discussion_post_id, starts_at, ends_at, location, registration_mode
) ON TABLE public.community_events TO authenticated;
CREATE POLICY "Members can create own events" ON public.community_events
  FOR INSERT TO authenticated
  WITH CHECK (source_type = 'member' AND organizer_user_id = (SELECT auth.uid()));

-- An organizer may cancel and may leave a short note; time and place cannot
-- be edited. There is no DELETE.
GRANT UPDATE (cancelled_at, status_note) ON TABLE public.community_events TO authenticated;
CREATE POLICY "Organizers can cancel own events" ON public.community_events
  FOR UPDATE TO authenticated
  USING (source_type = 'member' AND organizer_user_id = (SELECT auth.uid()))
  WITH CHECK (source_type = 'member' AND organizer_user_id = (SELECT auth.uid()));

GRANT SELECT (id, slug, name_zh, name_en, status, allowed_link_hosts)
  ON TABLE public.community_event_partners TO anon, authenticated;
CREATE POLICY "Anyone can view active partners" ON public.community_event_partners
  FOR SELECT TO anon, authenticated
  USING (status = 'active');

-- Nothing in the sync state is secret.
GRANT SELECT ON TABLE public.community_event_sync_state TO anon, authenticated;
CREATE POLICY "Anyone can view sync state" ON public.community_event_sync_state
  FOR SELECT TO anon, authenticated
  USING (true);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
CREATE TRIGGER community_events_touch
  BEFORE UPDATE ON public.community_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- An organization's event that moves keeps where it was, so the page can say
-- "time updated". A member cannot edit time or place at all.
CREATE FUNCTION private.community_events_schedule_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NEW.source_type = 'member' THEN
    RETURN NEW;
  END IF;
  IF NEW.starts_at IS DISTINCT FROM OLD.starts_at THEN
    NEW.previous_starts_at := OLD.starts_at;
    NEW.schedule_changed_at := pg_catalog.now();
    NEW.revision := OLD.revision + 1;
  ELSIF NEW.location IS DISTINCT FROM OLD.location THEN
    NEW.revision := OLD.revision + 1;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.community_events_schedule_change()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER community_events_schedule_change
  BEFORE UPDATE ON public.community_events
  FOR EACH ROW EXECUTE FUNCTION private.community_events_schedule_change();

-- Everything a member's event has to satisfy. An insert is only accepted for
-- a topic the caller wrote in this same transaction, which a direct table
-- write cannot arrange: a client has no INSERT privilege on posts.created_at.
-- An update is checked only when cancelled_at or status_note changes, so the
-- system's own updates (a deleted topic, a takedown) do not pass through here.
CREATE FUNCTION private.community_events_member_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  link_pattern constant text :=
    '(https?://|www[.]|[a-z0-9-]+[.](com|net|org|edu|cn|io|me|ly|link)\y)';
  topic_author uuid;
  topic_status text;
  topic_category text;
  topic_created_at timestamptz;
  topic_title text;
  topic_content text;
  open_events integer;
BEGIN
  IF NEW.source_type <> 'member' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.cancelled_at IS NOT DISTINCT FROM OLD.cancelled_at
       AND NEW.status_note IS NOT DISTINCT FROM OLD.status_note THEN
      RETURN NEW;
    END IF;
    IF OLD.cancelled_at IS NOT NULL AND NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'member_event_cancel_final';
    END IF;
    -- D-49: a note is text other people read. Cancelling without one stays open.
    IF NEW.status_note IS NOT NULL AND NEW.status_note IS DISTINCT FROM OLD.status_note THEN
      PERFORM moderation_private.assert_posting_allowed(NEW.organizer_user_id);
    END IF;
    RETURN NEW;
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

  -- D-49: other people see a member's event.
  PERFORM moderation_private.assert_posting_allowed(NEW.organizer_user_id);

  IF NOT EXISTS (
    SELECT 1
      FROM public.profiles AS member
     WHERE member.id = NEW.organizer_user_id
       AND member.is_illini_verified
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'member_event_not_eligible';
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

  IF topic_title ~* '(官方|主办|official|hosted by)' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'member_event_reserved_wording';
  END IF;
  IF coalesce(topic_title, '') ~* link_pattern
     OR coalesce(topic_content, '') ~* link_pattern
     OR coalesce(NEW.location, '') ~* link_pattern THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'member_event_link_not_allowed';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.community_events_member_guard()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER community_events_member_guard
  BEFORE INSERT OR UPDATE ON public.community_events
  FOR EACH ROW EXECUTE FUNCTION private.community_events_member_guard();

-- A member's event lives with its topic. When the author deletes the topic
-- the foreign key clears the link, and the event goes with it.
CREATE FUNCTION private.community_events_post_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NEW.source_type = 'member'
     AND OLD.discussion_post_id IS NOT NULL
     AND NEW.discussion_post_id IS NULL
     AND NEW.availability <> 'hidden' THEN
    NEW.availability := 'hidden';
    NEW.hidden_reason := 'post_removed';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.community_events_post_link()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER community_events_post_link
  BEFORE UPDATE OF discussion_post_id ON public.community_events
  FOR EACH ROW EXECUTE FUNCTION private.community_events_post_link();

-- The same when the topic is hidden or soft-deleted, and back again when a
-- moderator restores it. A takedown of the event itself (reason 'admin') is
-- not undone by restoring the topic.
CREATE FUNCTION private.community_events_follow_topic()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;
  IF NEW.status IN ('hidden', 'deleted') THEN
    UPDATE public.community_events AS event
       SET availability = 'hidden',
           hidden_reason = 'post_removed'
     WHERE event.discussion_post_id = NEW.id
       AND event.source_type = 'member'
       AND event.availability <> 'hidden';
  ELSIF NEW.status = 'active' THEN
    UPDATE public.community_events AS event
       SET availability = 'visible',
           hidden_reason = NULL
     WHERE event.discussion_post_id = NEW.id
       AND event.source_type = 'member'
       AND event.hidden_reason = 'post_removed';
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION private.community_events_follow_topic()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER community_events_follow_topic
  AFTER UPDATE OF status ON public.posts
  FOR EACH ROW EXECUTE FUNCTION private.community_events_follow_topic();

-- ---------------------------------------------------------------------------
-- A member's own event (ENGINEERING 9.5)
-- ---------------------------------------------------------------------------
-- The topic and the event are written in one transaction as the caller, so
-- row security, the posting limits and the moderation triggers of posts all
-- apply, and the guard above checks the rest. post_id_in is generated by the
-- client when the form opens: a retry with the same id after an unknown
-- outcome returns the pair that already exists. The pair is looked up before
-- anything is written, because the posting limits refuse a repeated text
-- (duplicate_post) before the primary key can; two requests in flight at once
-- end the same way, through the handler below.
--
--   event_in: {"starts_at": timestamptz, "ends_at": timestamptz|null, "location": text}
CREATE FUNCTION public.create_member_event(
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
  title_value text := pg_catalog.btrim(title_in);
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
  location_value := pg_catalog.btrim(event_in ->> 'location');
  IF location_value IS NULL OR pg_catalog.char_length(location_value) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'member_event_location_invalid';
  END IF;
  BEGIN
    starts_value := (event_in ->> 'starts_at')::timestamptz;
    ends_value := nullif(event_in ->> 'ends_at', '')::timestamptz;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION USING ERRCODE = '22008', MESSAGE = 'member_event_time_out_of_range';
  END;
  IF starts_value IS NULL OR (ends_value IS NOT NULL AND ends_value < starts_value) THEN
    RAISE EXCEPTION USING ERRCODE = '22008', MESSAGE = 'member_event_time_out_of_range';
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

REVOKE ALL ON FUNCTION public.create_member_event(uuid, text, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_member_event(uuid, text, text, jsonb)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- The list the events page reads (ENGINEERING 9.6)
-- ---------------------------------------------------------------------------
-- Runs as the caller, so it returns only what the caller's row security and
-- column privileges allow. A member's event is listed with its topic: when
-- the caller cannot read the topic, the event is not returned either.
--   upcoming  not over yet and starting within 180 days, soonest first; on a
--             tie caaci, partner, campus, member.
--   past      over within the last 180 days, latest first.
-- A row that duplicates another source's row is never listed.
CREATE FUNCTION public.list_community_events(
  region_in text DEFAULT 'cu',
  source_in text DEFAULT NULL,
  window_in text DEFAULT 'upcoming',
  limit_in integer DEFAULT 200
)
RETURNS TABLE (
  id uuid,
  source_type text,
  region text,
  title text,
  title_en text,
  summary text,
  summary_en text,
  organizer_name text,
  partner_name_zh text,
  partner_name_en text,
  allowed_link_hosts text[],
  page_url text,
  register_url text,
  registration_mode text,
  takes_registrations boolean,
  registration_open boolean,
  starts_at timestamptz,
  ends_at timestamptz,
  all_day boolean,
  occurrence_count integer,
  time_zone text,
  location text,
  availability text,
  cancelled_at timestamptz,
  status_note text,
  previous_starts_at timestamptz,
  schedule_changed_at timestamptz,
  revision integer,
  organizer_user_id uuid,
  organizer_nickname text,
  organizer_avatar_url text,
  organizer_is_illini_verified boolean,
  discussion_post_id uuid,
  discussion_count integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
SET statement_timeout = '3s'
AS $function$
  SELECT
    event.id,
    event.source_type,
    event.region,
    CASE WHEN event.source_type = 'member' THEN topic.title ELSE event.title END,
    event.title_en,
    event.summary,
    event.summary_en,
    event.organizer_name,
    partner.name_zh,
    partner.name_en,
    partner.allowed_link_hosts,
    event.page_url,
    event.register_url,
    event.registration_mode,
    event.takes_registrations,
    event.registration_open,
    event.starts_at,
    event.ends_at,
    event.all_day,
    event.occurrence_count,
    event.time_zone,
    event.location,
    event.availability,
    event.cancelled_at,
    event.status_note,
    event.previous_starts_at,
    event.schedule_changed_at,
    event.revision,
    event.organizer_user_id,
    organizer.nickname,
    organizer.avatar_url,
    organizer.is_illini_verified,
    event.discussion_post_id,
    topic.comment_count
  FROM public.community_events AS event
  LEFT JOIN public.community_event_partners AS partner
    ON partner.id = event.partner_id
  LEFT JOIN public.posts AS topic
    ON topic.id = event.discussion_post_id
   AND topic.status = 'active'
  LEFT JOIN public.profiles AS organizer
    ON organizer.id = event.organizer_user_id
  WHERE event.region = region_in
    AND event.availability = 'visible'
    AND event.duplicate_of IS NULL
    AND (source_in IS NULL OR event.source_type = source_in)
    AND (event.source_type <> 'member' OR topic.id IS NOT NULL)
    AND CASE WHEN window_in = 'past'
          THEN coalesce(event.ends_at, event.starts_at) >= pg_catalog.now() - interval '180 days'
           AND coalesce(event.ends_at, event.starts_at) < pg_catalog.now()
          ELSE coalesce(event.ends_at, event.starts_at) >= pg_catalog.now()
           AND event.starts_at <= pg_catalog.now() + interval '180 days'
        END
  ORDER BY
    CASE WHEN window_in = 'past' THEN event.starts_at END DESC,
    CASE WHEN window_in = 'past' THEN NULL ELSE event.starts_at END ASC,
    CASE event.source_type WHEN 'caaci' THEN 0 WHEN 'partner' THEN 1 WHEN 'campus' THEN 2 ELSE 3 END,
    event.id
  LIMIT greatest(1, least(coalesce(limit_in, 200), 200));
$function$;

REVOKE ALL ON FUNCTION public.list_community_events(text, text, text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_community_events(text, text, text, integer)
  TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- P4.9  Discussion and takedown on the atomic administrator channel
-- ---------------------------------------------------------------------------
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
    'decide_appeal',
    'restore_content',
    'set_post_official',
    'set_post_featured',
    'set_post_locked',
    'set_post_category',
    'create_event_discussion',
    'hide_event',
    'unhide_event'
  ));

-- Takedown for the moderation role; opening a discussion as the official
-- account for the owner only.
INSERT INTO public.admin_role_action_capabilities (admin_role, action) VALUES
  ('operator', 'hide_event'),
  ('operator', 'unhide_event'),
  ('owner', 'hide_event'),
  ('owner', 'unhide_event'),
  ('owner', 'create_event_discussion')
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
    'decide_appeal',
    'restore_content',
    'set_post_official',
    'set_post_featured',
    'set_post_locked',
    'set_post_category',
    'create_event_discussion',
    'hide_event',
    'unhide_event'
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
    'appeal_more_information_requested',
    'support_email_claimed',
    'content_restored',
    'post_official_changed',
    'post_featured_changed',
    'post_lock_changed',
    'post_category_changed',
    'event_discussion_created',
    'event_hidden',
    'event_unhidden'
  ));

-- Preserve the current dispatcher under a private name. Every earlier action
-- is still delegated to it unchanged.
ALTER FUNCTION public.admin_execute_mutation(text, uuid, text, text, jsonb)
  RENAME TO admin_execute_mutation_pre_community_events;

REVOKE ALL ON FUNCTION public.admin_execute_mutation_pre_community_events(
  text, uuid, text, text, jsonb
) FROM PUBLIC, anon, authenticated, service_role;

-- One transaction, like every other administrator action: the token is
-- locked and revalidated, the role's capability is asserted, the request is
-- recorded once per (token, idempotency key), the change is made, and exactly
-- one actor-attributed audit row is written before the result is stored.
--
--   create_event_discussion  {event_id, reason, official_profile_id}
--   hide_event               {event_id, reason}
--   unhide_event             {event_id, reason}
--
-- create_event_discussion opens the one discussion topic of an organization's
-- event, written as the official account. The event row is locked first, so
-- two administrators pressing the button together get the same topic, and a
-- second call returns the topic that already exists. official_profile_id is
-- the account the site posts as. The Edge API passes it from
-- COMMUNITY_OFFICIAL_PROFILE_ID and never from the request; when it is not
-- configured, or names no profile, the action is refused by name and nothing
-- is written. A member's event already has its own topic and is not accepted.
--
-- hide_event takes any event down at once. unhide_event undoes only that: an
-- event that is hidden because its topic is gone stays hidden.
CREATE FUNCTION public.admin_execute_community_events(
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
  uuid_pattern constant text :=
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  -- The topic says neither when nor where: the event can move and this text stays true.
  discussion_body constant text := '这里是这场活动的讨论帖，时间和地点以活动页为准。';
  actor_token_id uuid;
  actor_id_value uuid;
  actor_role_value text;
  action_time timestamptz;
  inserted_rows integer;
  existing_action text;
  existing_payload_hash text;
  existing_status text;
  existing_result jsonb;
  result_value jsonb;
  allowed_keys text[];
  payload_key text;
  reason_value text;
  event_id_value uuid;
  official_profile_value uuid;
  event_source text;
  event_availability text;
  event_duplicate_of uuid;
  event_partner_id uuid;
  event_title text;
  discussion_post_value uuid;
  discussion_created boolean := false;
  affected_rows integer := 0;
  event_kind_value text;
  audit_details jsonb;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718180000::bigint);
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718190000::bigint);
  action_time := pg_catalog.clock_timestamp();

  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'admin_token_inactive';
  END IF;

  SELECT token.id, token.admin_id, token.role
    INTO actor_token_id, actor_id_value, actor_role_value
    FROM public.admin_tokens AS token
   WHERE token.token_hash = p_token_hash
     AND token.admin_id IS NOT NULL
     AND token.revoked_at IS NULL
     AND (token.expires_at IS NULL OR token.expires_at > action_time)
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
     SET last_used_at = action_time
   WHERE token.id = actor_token_id;

  IF p_idempotency_key IS NULL
     OR p_payload_hash IS NULL
     OR p_payload_hash !~ '^[0-9a-f]{64}$'
     OR p_action IS NULL
     OR p_action NOT IN ('create_event_discussion', 'hide_event', 'unhide_event')
     OR pg_catalog.jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid';
  END IF;

  PERFORM public.admin_assert_mutation_capability(actor_token_id, p_action);

  allowed_keys := CASE p_action
    WHEN 'create_event_discussion' THEN ARRAY['event_id', 'reason', 'official_profile_id']
    ELSE ARRAY['event_id', 'reason']
  END;
  FOR payload_key IN SELECT pg_catalog.jsonb_object_keys(p_payload) LOOP
    IF NOT (payload_key = ANY (allowed_keys)) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid_payload';
    END IF;
  END LOOP;

  -- Every action carries a human-readable reason for the audit.
  IF pg_catalog.jsonb_typeof(p_payload -> 'reason') IS DISTINCT FROM 'string'
     OR public.admin_moderation_reason_valid(p_payload ->> 'reason') IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid_payload';
  END IF;
  reason_value := pg_catalog.btrim(p_payload ->> 'reason');

  IF pg_catalog.jsonb_typeof(p_payload -> 'event_id') IS DISTINCT FROM 'string'
     OR (p_payload ->> 'event_id') !~* uuid_pattern THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid_payload';
  END IF;
  event_id_value := pg_catalog.lower(p_payload ->> 'event_id')::uuid;

  IF p_action = 'create_event_discussion' THEN
    IF NOT (p_payload ? 'official_profile_id')
       OR p_payload -> 'official_profile_id' = 'null'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'official_profile_not_configured';
    END IF;
    IF pg_catalog.jsonb_typeof(p_payload -> 'official_profile_id') IS DISTINCT FROM 'string'
       OR (p_payload ->> 'official_profile_id') !~* uuid_pattern THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid_payload';
    END IF;
    official_profile_value := pg_catalog.lower(p_payload ->> 'official_profile_id')::uuid;
    IF NOT EXISTS (
      SELECT 1
        FROM public.profiles AS official
       WHERE official.id = official_profile_value
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'official_profile_not_configured';
    END IF;
  END IF;

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
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'idempotency_conflict';
    END IF;

    IF existing_status = 'completed' AND existing_result IS NOT NULL THEN
      RETURN existing_result;
    END IF;

    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'idempotency_incomplete';
  END IF;

  PERFORM pg_catalog.set_config('admin.actor_id', actor_id_value::text, true);
  PERFORM pg_catalog.set_config('admin.token_id', actor_token_id::text, true);
  PERFORM pg_catalog.set_config('admin.idempotency_key', p_idempotency_key::text, true);
  PERFORM pg_catalog.set_config('admin.audit_required', 'on', true);

  IF p_action = 'create_event_discussion' THEN
    SELECT event.source_type, event.availability, event.duplicate_of, event.partner_id,
           event.discussion_post_id,
           -- A topic title is one line of at most 120 characters with no space at either end.
           pg_catalog.rtrim(pg_catalog.left(pg_catalog.btrim(pg_catalog.regexp_replace(
             coalesce(nullif(pg_catalog.btrim(event.title), ''), event.title_en), '\s+', ' ', 'g')), 120))
      INTO event_source, event_availability, event_duplicate_of, event_partner_id,
           discussion_post_value, event_title
      FROM public.community_events AS event
     WHERE event.id = event_id_value
     FOR UPDATE;
    IF NOT FOUND OR event_source = 'member' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'event_not_found';
    END IF;
    -- Only an event readers can see, with a title to give the topic, gets a discussion.
    IF event_availability <> 'visible'
       OR event_duplicate_of IS NOT NULL
       OR coalesce(event_title, '') = ''
       OR (event_partner_id IS NOT NULL AND NOT EXISTS (
             SELECT 1
               FROM public.community_event_partners AS partner
              WHERE partner.id = event_partner_id
                AND partner.status = 'active'
           )) THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'event_discussion_closed';
    END IF;

    IF discussion_post_value IS NULL THEN
      INSERT INTO public.posts (user_id, content, title, category, is_official)
      VALUES (official_profile_value, discussion_body, event_title, 'events-social', true)
      RETURNING id INTO discussion_post_value;

      UPDATE public.community_events AS event
         SET discussion_post_id = discussion_post_value
       WHERE event.id = event_id_value
         AND event.discussion_post_id IS NULL;
      GET DIAGNOSTICS affected_rows = ROW_COUNT;
      IF affected_rows <> 1 THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'admin_mutation_conflict';
      END IF;
      discussion_created := true;
    END IF;

    event_kind_value := 'event_discussion_created';
    audit_details := pg_catalog.jsonb_build_object(
      'event_id', event_id_value,
      'post_id', discussion_post_value,
      'created', discussion_created,
      'reason', reason_value
    );
    result_value := pg_catalog.jsonb_build_object(
      'data', pg_catalog.jsonb_build_object(
        'event_id', event_id_value,
        'post_id', discussion_post_value,
        'created', discussion_created
      )
    );
  ELSIF p_action = 'hide_event' THEN
    UPDATE public.community_events AS event
       SET availability = 'hidden',
           hidden_reason = 'admin'
     WHERE event.id = event_id_value
       AND (event.availability <> 'hidden' OR event.hidden_reason IS DISTINCT FROM 'admin');
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows = 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'event_not_found';
    END IF;
    event_kind_value := 'event_hidden';
    audit_details := pg_catalog.jsonb_build_object('event_id', event_id_value, 'reason', reason_value);
    result_value := pg_catalog.jsonb_build_object('success', true);
  ELSE
    -- A member's event whose topic is gone goes back to hidden for that reason.
    UPDATE public.community_events AS event
       SET availability = CASE WHEN gone.topic_gone THEN 'hidden' ELSE 'visible' END,
           hidden_reason = CASE WHEN gone.topic_gone THEN 'post_removed' END
      FROM (
        SELECT candidate.id,
               candidate.source_type = 'member' AND NOT EXISTS (
                 SELECT 1
                   FROM public.posts AS topic
                  WHERE topic.id = candidate.discussion_post_id
                    AND topic.status = 'active'
               ) AS topic_gone
          FROM public.community_events AS candidate
         WHERE candidate.id = event_id_value
      ) AS gone
     WHERE event.id = gone.id
       AND event.availability = 'hidden'
       AND event.hidden_reason = 'admin';
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows = 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'event_not_found';
    END IF;
    event_kind_value := 'event_unhidden';
    audit_details := pg_catalog.jsonb_build_object('event_id', event_id_value, 'reason', reason_value);
    result_value := pg_catalog.jsonb_build_object('success', true);
  END IF;

  PERFORM public.record_audit(event_kind_value, actor_id_value, event_id_value, audit_details);

  IF NOT EXISTS (
    SELECT 1
      FROM public.admin_audit_log AS audit
     WHERE audit.admin_token_id = actor_token_id
       AND audit.idempotency_key = p_idempotency_key
       AND audit.actor_id = actor_id_value
       AND audit.event_kind = event_kind_value
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'admin_audit_required_missing';
  END IF;

  UPDATE public.admin_mutation_requests AS request
     SET status = 'completed',
         result = result_value,
         completed_at = action_time
   WHERE request.admin_token_id = actor_token_id
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
  PERFORM pg_catalog.set_config('admin.role', '', true);

  RETURN result_value;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_execute_community_events(
  text, uuid, text, text, jsonb
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
BEGIN
  IF p_action IN ('create_event_discussion', 'hide_event', 'unhide_event') THEN
    RETURN public.admin_execute_community_events(
      p_token_hash,
      p_idempotency_key,
      p_payload_hash,
      p_action,
      p_payload
    );
  END IF;

  RETURN public.admin_execute_mutation_pre_community_events(
    p_token_hash,
    p_idempotency_key,
    p_payload_hash,
    p_action,
    p_payload
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_execute_mutation(
  text, uuid, text, text, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_execute_mutation(
  text, uuid, text, text, jsonb
) TO service_role;

COMMENT ON TABLE public.community_events IS
  'Events from four sources (caaci, partner, campus, member). Readers see visible rows through an allowlist of columns. A member row is written only by create_member_event; the other sources get their writers in a later migration.';
COMMENT ON TABLE public.community_event_partners IS
  'Organizations whose events may be listed. A row needs a recorded consent reference; only active partners are readable.';
COMMENT ON TABLE public.community_event_sync_state IS
  'Outcome of the last CAACI and campus synchronisation attempts. No secrets.';
COMMENT ON FUNCTION public.create_member_event(uuid, text, text, jsonb) IS
  'Writes a member''s topic and event in one transaction as the caller. A retry with the same post id returns the existing pair.';
COMMENT ON FUNCTION public.list_community_events(text, text, text, integer) IS
  'Visible, non-duplicate events of a region for the upcoming or past 180-day window, at most 200 rows, under the caller''s row security.';
COMMENT ON FUNCTION public.admin_execute_community_events(text, uuid, text, text, jsonb) IS
  'Atomic administrator actions on events: create_event_discussion (owner), hide_event and unhide_event (operator and owner). Reached only through admin_execute_mutation.';

COMMIT;
