-- P4.4: service-only CAACI snapshot reconciliation.
-- Apply after 20261122035253 and its VERIFY. The worker switch stays off
-- until the release prerequisites in RUNBOOK have been met.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE FUNCTION public.claim_community_event_sync(source_in text, interval_in interval)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  claimed boolean;
BEGIN
  -- The unique source key arbitrates even the first two concurrent claims.
  INSERT INTO public.community_event_sync_state AS state (source, last_attempt_at)
  VALUES (source_in, pg_catalog.now())
  ON CONFLICT (source) DO UPDATE SET last_attempt_at = pg_catalog.now()
    WHERE state.last_attempt_at IS NULL
       OR state.last_attempt_at < pg_catalog.now() - interval_in
  RETURNING true INTO claimed;
  RETURN coalesce(claimed, false);
END;
$function$;
ALTER FUNCTION public.claim_community_event_sync(text, interval) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_community_event_sync(text, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_community_event_sync(text, interval) TO service_role;

CREATE FUNCTION public.apply_caaci_event_snapshot(complete_in boolean, rows_in jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  source_row jsonb;
  key_value text;
  seen_keys text[] := ARRAY[]::text[];
  effective_complete boolean := complete_in;
  rejected integer := 0;
BEGIN
  IF complete_in IS NULL OR pg_catalog.jsonb_typeof(rows_in) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'event_snapshot_invalid';
  END IF;

  FOR source_row IN SELECT value FROM pg_catalog.jsonb_array_elements(rows_in) LOOP
    key_value := source_row ->> 'source_key';
    IF key_value IS NULL OR key_value !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      rejected := rejected + 1;
      effective_complete := false;
      CONTINUE;
    END IF;
    -- Keep identity outside the row's subtransaction: a rejected row was
    -- still present in the snapshot, so absence must not count it again.
    seen_keys := pg_catalog.array_append(seen_keys, key_value);
    BEGIN
      IF source_row ->> 'source_type' IS DISTINCT FROM 'caaci' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'event_snapshot_source_invalid';
      END IF;
      -- Only source-owned columns cross this boundary. IDs, discussion links,
      -- moderation, visibility and bookkeeping cannot come from the payload.
      INSERT INTO public.community_events AS event (
        source_type, source_key, region, organizer_name, title, title_en, summary, summary_en,
        starts_at, ends_at, all_day, occurrence_count, time_zone, location,
        page_url, register_url, registration_mode, takes_registrations, registration_open,
        content_hash, source_updated_at, first_seen_at, last_seen_at
      ) VALUES (
        'caaci', key_value, coalesce(source_row ->> 'region', 'cu'),
        source_row ->> 'organizer_name', source_row ->> 'title', source_row ->> 'title_en',
        source_row ->> 'summary', source_row ->> 'summary_en',
        (source_row ->> 'starts_at')::timestamptz, (source_row ->> 'ends_at')::timestamptz,
        coalesce((source_row ->> 'all_day')::boolean, false),
        coalesce((source_row ->> 'occurrence_count')::integer, 1),
        coalesce(source_row ->> 'time_zone', 'America/Chicago'), source_row ->> 'location',
        source_row ->> 'page_url', source_row ->> 'register_url', source_row ->> 'registration_mode',
        (source_row ->> 'takes_registrations')::boolean, (source_row ->> 'registration_open')::boolean,
        source_row ->> 'content_hash', (source_row ->> 'source_updated_at')::timestamptz,
        pg_catalog.now(), pg_catalog.now()
      )
      ON CONFLICT (source_type, source_key) DO UPDATE SET
        region = excluded.region,
        organizer_name = excluded.organizer_name,
        title = excluded.title, title_en = excluded.title_en,
        summary = excluded.summary, summary_en = excluded.summary_en,
        starts_at = excluded.starts_at, ends_at = excluded.ends_at,
        all_day = excluded.all_day, occurrence_count = excluded.occurrence_count,
        time_zone = excluded.time_zone, location = excluded.location,
        page_url = excluded.page_url, register_url = excluded.register_url,
        registration_mode = excluded.registration_mode,
        takes_registrations = excluded.takes_registrations,
        registration_open = excluded.registration_open,
        content_hash = excluded.content_hash, source_updated_at = excluded.source_updated_at,
        last_seen_at = pg_catalog.now(), missing_checks = 0, missing_since = NULL,
        availability = CASE WHEN event.availability = 'hidden' THEN 'hidden' ELSE 'visible' END,
        review_flag = CASE
          WHEN event.starts_at IS DISTINCT FROM excluded.starts_at
           AND excluded.starts_at <= pg_catalog.now() + interval '48 hours'
          THEN 'source_time_changed_near_start'
          ELSE event.review_flag END;
    EXCEPTION WHEN SQLSTATE '23514' OR SQLSTATE '23502' OR SQLSTATE '23505'
                OR SQLSTATE '22001' OR SQLSTATE '22023' THEN
      rejected := rejected + 1;
      -- A refused unavailable row cannot be revived with its old time/place;
      -- clearing its count would also violate community_events_unavailable_check.
      UPDATE public.community_events
         SET missing_checks = 0, missing_since = NULL
       WHERE source_type = 'caaci' AND source_key = key_value
         AND availability IN ('visible', 'hidden');
    END;
  END LOOP;

  IF effective_complete THEN
    UPDATE public.community_events
       SET missing_checks = missing_checks + 1,
           missing_since = coalesce(missing_since, pg_catalog.now()),
           availability = CASE
             WHEN availability = 'hidden' THEN 'hidden'
             WHEN missing_checks + 1 >= 2 THEN 'unavailable'
             ELSE availability END
     WHERE source_type = 'caaci' AND NOT (source_key = ANY(seen_keys))
       AND coalesce(ends_at, starts_at) >= pg_catalog.now() - interval '179 days';
  END IF;
  RETURN pg_catalog.jsonb_build_object('complete', effective_complete, 'rejected', rejected);
END;
$function$;
ALTER FUNCTION public.apply_caaci_event_snapshot(boolean, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.apply_caaci_event_snapshot(boolean, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_caaci_event_snapshot(boolean, jsonb) TO service_role;

CREATE FUNCTION public.finish_community_event_sync(source_in text, outcome_in text, error_code_in text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  UPDATE public.community_event_sync_state
     SET last_outcome = outcome_in, last_error_code = error_code_in,
         last_success_at = CASE WHEN outcome_in IN ('ok', 'partial')
                           THEN pg_catalog.now() ELSE last_success_at END
   WHERE source = source_in;
  RETURN FOUND;
END;
$function$;
ALTER FUNCTION public.finish_community_event_sync(text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.finish_community_event_sync(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_community_event_sync(text, text, text) TO service_role;

COMMIT;
