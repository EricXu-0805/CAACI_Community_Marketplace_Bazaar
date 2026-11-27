-- P4.7 step 3: refresh campus events one by one (mode A) and read one row's
-- last confirmation for the detail page. Apply after 20261125004742 and its
-- VERIFY. Three new functions only: no row, table, constraint, index, trigger,
-- policy or table grant changes, and no existing function is replaced.
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
      ('public.claim_community_event_sync(text,interval)', 'a730ca4867b03e5379ee497571c7cae8'),
      ('public.apply_caaci_event_snapshot(boolean,jsonb)', '55227c4b42b7ac90e9b1ba34f274b057'),
      ('public.finish_community_event_sync(text,text,text)', '1ea1588cb277079ab5911ba84924f450'),
      ('private.community_events_schedule_change()', 'e4a2e33f688e3f6d4e192a3426b0ea36'),
      ('private.community_events_member_guard()', '7eb7680e59995c1dc8e9d754603ed790'),
      ('private.community_events_moderate_text()', 'c3da68f508cbcee6724a6926892300ed'),
      ('public.update_updated_at()', 'da5ac28a58c8b4bb30209bf0d3d7082c')
    ) AS known(signature, body_md5)
  LOOP
    SELECT pg_catalog.md5(routine.prosrc) INTO stored
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid = pg_catalog.to_regprocedure(expected.signature);
    IF stored IS DISTINCT FROM expected.body_md5 THEN
      RAISE EXCEPTION 'community_campus_checks_precondition:function:%:%', expected.signature, coalesce(stored, 'missing');
    END IF;
  END LOOP;
  FOR expected IN
    SELECT * FROM (VALUES
      ('public.community_events', 'community_events_campus_shape', $d$CHECK (((source_type <> 'campus'::text) OR ((source_key ~ '^[0-9]{1,6}/[0-9]{1,12}$'::text) AND (page_url = ('https://calendars.illinois.edu/detail/'::text || source_key)) AND (register_url IS NULL) AND (registration_mode = 'calendar_page'::text) AND (organizer_name IS NOT NULL) AND (COALESCE(title_en, ''::text) <> ''::text) AND (partner_id IS NULL) AND (organizer_user_id IS NULL))))$d$),
      ('public.community_events', 'community_events_unavailable_check', $d$CHECK (((availability <> 'unavailable'::text) OR (missing_checks >= 2)))$d$),
      ('public.community_event_sync_state', 'community_event_sync_state_source_check', $d$CHECK ((source = ANY (ARRAY['caaci'::text, 'campus'::text])))$d$)
    ) AS known(relation, constraint_name, definition)
  LOOP
    SELECT pg_catalog.regexp_replace(pg_catalog.pg_get_constraintdef(c.oid), '\s+', ' ', 'g') INTO stored
      FROM pg_catalog.pg_constraint AS c
     WHERE c.conrelid = pg_catalog.to_regclass(expected.relation) AND c.conname = expected.constraint_name;
    IF stored IS DISTINCT FROM expected.definition THEN
      RAISE EXCEPTION 'community_campus_checks_precondition:constraint:%', expected.constraint_name;
    END IF;
  END LOOP;
  IF pg_catalog.to_regprocedure('public.claim_campus_event_checks(integer)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.apply_campus_event_check(uuid,text,jsonb)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.community_campus_event_checked_at(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'community_campus_checks_precondition:already_applied';
  END IF;
END
$guard$;

CREATE FUNCTION public.claim_campus_event_checks(limit_in integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  claimed jsonb;
BEGIN
  IF limit_in IS NULL OR limit_in < 1 OR limit_in > 2 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'campus_check_limit_invalid';
  END IF;
  -- The claim is the lease: a row whose request fails, times out or is cut
  -- off is not requested again for six hours.
  WITH picked AS (
    SELECT event.id, event.last_checked_at AS previous
      FROM public.community_events AS event
     WHERE event.source_type = 'campus' AND event.availability <> 'hidden'
       AND coalesce(event.ends_at, event.starts_at) >= pg_catalog.now()
       AND (event.last_checked_at IS NULL
            OR event.last_checked_at < pg_catalog.now() - interval '6 hours')
     ORDER BY event.last_checked_at NULLS FIRST, event.id
     LIMIT limit_in
     FOR UPDATE SKIP LOCKED
  ), leased AS (
    UPDATE public.community_events AS event
       SET last_checked_at = pg_catalog.now()
      FROM picked
     WHERE event.id = picked.id
    RETURNING event.id, event.source_key, picked.previous
  )
  SELECT coalesce(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object('id', leased.id, 'source_key', leased.source_key)
           ORDER BY leased.previous NULLS FIRST, leased.id), '[]'::jsonb)
    INTO claimed
    FROM leased;
  RETURN claimed;
END;
$function$;
ALTER FUNCTION public.claim_campus_event_checks(integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_campus_event_checks(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_campus_event_checks(integer) TO service_role;

CREATE FUNCTION public.apply_campus_event_check(event_id_in uuid, outcome_in text, row_in jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  before_row public.community_events%ROWTYPE;
  after_row public.community_events%ROWTYPE;
  new_starts timestamptz;
  rolled boolean := false;
  rejected boolean := false;
BEGIN
  IF outcome_in IS NULL OR outcome_in NOT IN ('ok', 'not_found', 'error')
     OR (outcome_in = 'ok') <> coalesce(pg_catalog.jsonb_typeof(row_in) = 'object', false)
     OR (outcome_in = 'ok' AND (
          ARRAY(SELECT pg_catalog.jsonb_object_keys(row_in) ORDER BY 1)
            IS DISTINCT FROM ARRAY['all_day', 'content_hash', 'ends_at', 'location', 'occurrence_count',
                                   'review_flag', 'source_updated_at', 'starts_at', 'title_en']
          OR coalesce(row_in ->> 'review_flag', 'title_says_cancelled') <> 'title_says_cancelled')) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'campus_check_invalid';
  END IF;
  SELECT * INTO before_row FROM public.community_events
   WHERE id = event_id_in AND source_type = 'campus'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'campus_check_event_invalid';
  END IF;

  IF outcome_in = 'error' THEN
    UPDATE public.community_events SET last_checked_at = pg_catalog.now() WHERE id = event_id_in;
  ELSIF outcome_in = 'not_found' THEN
    -- Two checks at least twelve hours apart must both miss the row before it
    -- is withdrawn, so missing_checks >= 2 keeps unhide_event's meaning.
    UPDATE public.community_events
       SET last_checked_at = pg_catalog.now(),
           missing_since = coalesce(missing_since, pg_catalog.now()),
           missing_checks = CASE
             WHEN missing_since IS NULL THEN 1
             WHEN missing_since <= pg_catalog.now() - interval '12 hours' THEN 2
             ELSE missing_checks END,
           availability = CASE
             WHEN availability = 'hidden' THEN 'hidden'
             WHEN missing_since <= pg_catalog.now() - interval '12 hours' THEN 'unavailable'
             ELSE availability END
     WHERE id = event_id_in;
  ELSE
    new_starts := (row_in ->> 'starts_at')::timestamptz;
    -- A series whose first session ended moves on to the next one; that is
    -- not a schedule change, so the trigger's notes are put back below.
    rolled := before_row.occurrence_count > 1
      AND (row_in ->> 'occurrence_count')::integer = before_row.occurrence_count
      AND (row_in ->> 'ends_at')::timestamptz IS NOT DISTINCT FROM before_row.ends_at
      AND new_starts > before_row.starts_at
      AND before_row.starts_at <= pg_catalog.now();
    BEGIN
      UPDATE public.community_events AS event
         SET title_en = row_in ->> 'title_en',
             starts_at = new_starts,
             ends_at = (row_in ->> 'ends_at')::timestamptz,
             all_day = (row_in ->> 'all_day')::boolean,
             occurrence_count = (row_in ->> 'occurrence_count')::integer,
             location = row_in ->> 'location',
             source_updated_at = (row_in ->> 'source_updated_at')::timestamptz,
             content_hash = row_in ->> 'content_hash',
             review_flag = CASE
               WHEN row_in ->> 'review_flag' = 'title_says_cancelled' THEN 'title_says_cancelled'
               WHEN NOT rolled AND new_starts IS DISTINCT FROM event.starts_at
                AND new_starts <= pg_catalog.now() + interval '48 hours'
               THEN 'source_time_changed_near_start'
               ELSE event.review_flag END,
             last_seen_at = pg_catalog.now(), last_checked_at = pg_catalog.now(),
             missing_checks = 0, missing_since = NULL,
             availability = CASE WHEN event.availability = 'hidden' THEN 'hidden' ELSE 'visible' END
       WHERE event.id = event_id_in;
      IF rolled THEN
        -- community_events_schedule_change runs BEFORE UPDATE and overwrites
        -- these two columns within the statement above.
        UPDATE public.community_events
           SET previous_starts_at = before_row.previous_starts_at,
               schedule_changed_at = before_row.schedule_changed_at
         WHERE id = event_id_in;
      END IF;
    EXCEPTION WHEN SQLSTATE '23514' OR SQLSTATE '23502' OR SQLSTATE '23505'
                OR SQLSTATE '22001' OR SQLSTATE '22023' THEN
      rejected := true;
      -- The source still has the row; a refused unavailable row keeps its
      -- count, which community_events_unavailable_check requires.
      UPDATE public.community_events
         SET last_checked_at = pg_catalog.now(),
             missing_checks = CASE WHEN availability = 'unavailable' THEN missing_checks ELSE 0 END,
             missing_since = CASE WHEN availability = 'unavailable' THEN missing_since END
       WHERE id = event_id_in;
    END;
  END IF;
  SELECT * INTO after_row FROM public.community_events WHERE id = event_id_in;
  RETURN pg_catalog.jsonb_build_object(
    'availability', after_row.availability, 'missing_checks', after_row.missing_checks, 'rejected', rejected);
END;
$function$;
ALTER FUNCTION public.apply_campus_event_check(uuid, text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.apply_campus_event_check(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_campus_event_check(uuid, text, jsonb) TO service_role;

CREATE FUNCTION public.community_campus_event_checked_at(event_id_in uuid)
RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
SET statement_timeout = '3s'
AS $function$
  SELECT event.last_seen_at
    FROM public.community_events AS event
   WHERE event.id = event_id_in AND event.source_type = 'campus'
     AND event.availability = 'visible'
     AND coalesce(event.ends_at, event.starts_at) >= pg_catalog.now() - interval '180 days'
$function$;
ALTER FUNCTION public.community_campus_event_checked_at(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.community_campus_event_checked_at(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_campus_event_checked_at(uuid) TO anon, authenticated;

COMMIT;
