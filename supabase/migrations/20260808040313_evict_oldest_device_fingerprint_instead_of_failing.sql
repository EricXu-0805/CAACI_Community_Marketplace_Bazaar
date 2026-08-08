-- Evict the least-recently-seen device fingerprint at the cap instead of
-- raising.
--
-- record_fingerprint bounds each profile at 20 distinct hashes. On the 20th it
-- raised ERRCODE 54000, which PostgREST returns as HTTP 500, and the client
-- discards the result — so from that point on the profile silently stopped
-- recording anything. The signal froze permanently for exactly the accounts it
-- exists to review: the ones that sign in from many devices.
--
-- The function's own comment calls this signal "bounded" and "advisory". The
-- bound is about storage, not a claim that a 21st device must be refused, so
-- the cap should evict rather than fail.
--
-- Observed 2026-08-08: the CI smoke account sits at exactly 20 and 500s on
-- every run; one production profile holds 168 rows, all predating the cap.

-- One-time convergence, here rather than inside the function, so that no
-- user's next sign-in is what triggers a bulk delete. Keeps the 20
-- most-recently-seen rows per profile and drops the rest.
DELETE FROM public.device_fingerprints AS stale
 WHERE stale.id IN (
   SELECT ranked.id
     FROM (
       SELECT fingerprint.id,
              row_number() OVER (
                PARTITION BY fingerprint.profile_id
                ORDER BY fingerprint.last_seen DESC, fingerprint.id DESC
              ) AS recency
         FROM public.device_fingerprints AS fingerprint
     ) AS ranked
    WHERE ranked.recency > 20
 );

CREATE OR REPLACE FUNCTION public.record_fingerprint(
  fp_hash_in    text,
  ua_snippet_in text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  cleaned_hash text;
  cleaned_ua text;
  existing_last_seen timestamptz;
  unique_hash_count integer;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'not_authenticated';
  END IF;

  cleaned_hash := pg_catalog.btrim(COALESCE(fp_hash_in, ''));
  IF cleaned_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_fingerprint';
  END IF;

  cleaned_ua := NULLIF(
    pg_catalog.left(
      pg_catalog.regexp_replace(
        COALESCE(ua_snippet_in, ''),
        '[[:cntrl:]]',
        '',
        'g'
      ),
      120
    ),
    ''
  );

  -- Serialize the per-profile count check. Without this lock, concurrent calls
  -- using distinct hashes can all observe 19 rows and bypass the cardinality
  -- cap together. It now also serializes eviction against insertion.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller_id::text, 0)
  );

  SELECT fingerprint.last_seen
    INTO existing_last_seen
    FROM public.device_fingerprints AS fingerprint
   WHERE fingerprint.profile_id = caller_id
     AND fingerprint.fp_hash = cleaned_hash;

  IF FOUND THEN
    -- Auth initialization can fire more than once. Do not generate a physical
    -- row/profile update more often than every five minutes.
    IF existing_last_seen > pg_catalog.now() - interval '5 minutes' THEN
      RETURN;
    END IF;

    UPDATE public.device_fingerprints AS fingerprint
       SET last_seen = pg_catalog.now(),
           seen_count = CASE
             WHEN fingerprint.seen_count < 2147483647
               THEN fingerprint.seen_count + 1
             ELSE fingerprint.seen_count
           END,
           ua_snippet = COALESCE(cleaned_ua, fingerprint.ua_snippet)
     WHERE fingerprint.profile_id = caller_id
       AND fingerprint.fp_hash = cleaned_hash;

    UPDATE public.profiles AS profile
       SET last_fp_hash = cleaned_hash,
           last_fp_seen_at = pg_catalog.now()
     WHERE profile.id = caller_id;
    RETURN;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO unique_hash_count
    FROM public.device_fingerprints AS fingerprint
   WHERE fingerprint.profile_id = caller_id;

  -- Make room for the new hash rather than refusing it. The formula also
  -- converges a profile that is already over the cap, one call at a time.
  IF unique_hash_count >= 20 THEN
    DELETE FROM public.device_fingerprints AS stale
     WHERE stale.id IN (
       SELECT evict.id
         FROM public.device_fingerprints AS evict
        WHERE evict.profile_id = caller_id
        ORDER BY evict.last_seen ASC, evict.id ASC
        LIMIT (unique_hash_count - 19)
     );
  END IF;

  INSERT INTO public.device_fingerprints (
    profile_id,
    fp_hash,
    ua_snippet
  ) VALUES (
    caller_id,
    cleaned_hash,
    cleaned_ua
  );

  UPDATE public.profiles AS profile
     SET last_fp_hash = cleaned_hash,
         last_fp_seen_at = pg_catalog.now()
   WHERE profile.id = caller_id;
END
$function$;

COMMENT ON FUNCTION public.record_fingerprint(text, text) IS
  'Records a bounded, exact SHA-256 installation signal for advisory abuse review; client asserted and never proof of identity. At the cap the least-recently-seen hash is evicted, because a frozen signal is worse than a rotating one.';
