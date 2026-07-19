-- Treat client-generated installation fingerprints as a bounded, advisory
-- moderation signal. They are pseudonymous and client-asserted: storage can
-- be cleared, devices can be shared, and an authenticated caller can invoke
-- the RPC directly. They must therefore never be the sole cause of an
-- automatic sanction.

DO $migration_precheck$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('public.device_fingerprints'),
      ('public.profiles'),
      ('public.suspensions'),
      ('public.admin_audit_log')
    ) AS required(relation_name)
    WHERE pg_catalog.to_regclass(required.relation_name) IS NULL
  ) THEN
    RAISE EXCEPTION 'migration_precheck_failed: fingerprint/ban relation missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('device_fingerprints', 'profile_id', 'uuid'),
      ('device_fingerprints', 'fp_hash', 'text'),
      ('device_fingerprints', 'last_seen', 'timestamp with time zone'),
      ('device_fingerprints', 'seen_count', 'integer'),
      ('device_fingerprints', 'ua_snippet', 'text'),
      ('profiles', 'id', 'uuid'),
      ('profiles', 'last_fp_hash', 'text'),
      ('profiles', 'last_fp_seen_at', 'timestamp with time zone'),
      ('profiles', 'suspension_level', 'smallint'),
      ('profiles', 'suspended_until', 'timestamp with time zone'),
      ('profiles', 'shadow_banned', 'boolean'),
      ('profiles', 'warning_count', 'integer')
    ) AS required(table_name, column_name, formatted_type)
    LEFT JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = pg_catalog.to_regclass(
        'public.' || required.table_name
      )
     AND attribute.attname = required.column_name
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
    WHERE attribute.attname IS NULL
       OR pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
          <> required.formatted_type
  ) THEN
    RAISE EXCEPTION 'migration_precheck_failed: fingerprint/ban column shape mismatch';
  END IF;

  IF pg_catalog.to_regprocedure('auth.uid()') IS NULL
     OR pg_catalog.to_regprocedure(
       'public.recompute_trust_score(uuid)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.record_audit(text,uuid,uuid,jsonb)'
     ) IS NULL THEN
    RAISE EXCEPTION 'migration_precheck_failed: fingerprint/ban helper missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.device_fingerprints'::pg_catalog.regclass
      AND constraint_row.contype IN ('p', 'u')
      AND constraint_row.conkey = ARRAY[
        (
          SELECT attribute.attnum
          FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attrelid = 'public.device_fingerprints'::pg_catalog.regclass
            AND attribute.attname = 'profile_id'
        ),
        (
          SELECT attribute.attnum
          FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attrelid = 'public.device_fingerprints'::pg_catalog.regclass
            AND attribute.attname = 'fp_hash'
        )
      ]::smallint[]
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = 'public.device_fingerprints'::pg_catalog.regclass
      AND relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION
      'migration_precheck_failed: fingerprint uniqueness/RLS boundary missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS required(role_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles AS role
      WHERE role.rolname = required.role_name
    )
  ) THEN
    RAISE EXCEPTION 'migration_precheck_failed: API role missing';
  END IF;
END
$migration_precheck$;

ALTER TABLE public.device_fingerprints
  DROP CONSTRAINT IF EXISTS device_fingerprints_fp_hash_sha256_chk;

-- Existing installations may contain the legacy 32-character FNV fallback.
-- NOT VALID avoids blocking deployment on those historical rows while still
-- rejecting every new/updated non-SHA-256 row. Production cleanup can validate
-- this constraint later after retention/governance review.
ALTER TABLE public.device_fingerprints
  ADD CONSTRAINT device_fingerprints_fp_hash_sha256_chk
  CHECK (fp_hash ~ '^[0-9a-f]{64}$') NOT VALID;

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
  -- cap together.
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

  IF unique_hash_count >= 20 THEN
    RAISE EXCEPTION USING
      ERRCODE = '54000',
      MESSAGE = 'fingerprint_limit_reached';
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

REVOKE ALL ON FUNCTION public.record_fingerprint(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_fingerprint(text, text)
  TO authenticated;

-- Preserve the latest audited admin-ban behavior from migration 031, but do
-- not mutate accounts that merely share a client-asserted fingerprint. The
-- linked count remains in the audit event so staff can review it alongside
-- stronger evidence through the existing linked-account admin surface.
CREATE OR REPLACE FUNCTION public.apply_ban_level(
  target_in   uuid,
  level_in    smallint,
  reason_in   text,
  category_in text DEFAULT 'generic',
  hours_in    integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  new_id uuid;
  ban_interval interval;
  ends_at_val timestamptz;
  linked_candidate_count integer := 0;
BEGIN
  IF level_in NOT BETWEEN 0 AND 5 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_level';
  END IF;
  IF target_in IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_target';
  END IF;
  IF reason_in IS NULL OR pg_catalog.length(pg_catalog.btrim(reason_in)) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reason_required';
  END IF;

  ban_interval := CASE
    WHEN hours_in IS NOT NULL THEN (hours_in || ' hours')::interval
    WHEN level_in = 0 THEN NULL
    WHEN level_in = 1 THEN NULL
    WHEN level_in = 2 THEN interval '72 hours'
    WHEN level_in = 3 THEN interval '7 days'
    WHEN level_in = 4 THEN interval '30 days'
    WHEN level_in = 5 THEN NULL
  END;

  ends_at_val := CASE
    WHEN ban_interval IS NULL AND level_in = 5
      THEN 'infinity'::timestamptz
    WHEN ban_interval IS NULL THEN NULL
    ELSE pg_catalog.now() + ban_interval
  END;

  INSERT INTO public.suspensions (
    profile_id,
    level,
    reason,
    category,
    issued_by,
    ends_at
  ) VALUES (
    target_in,
    level_in,
    reason_in,
    category_in,
    auth.uid(),
    ends_at_val
  )
  RETURNING id INTO new_id;

  UPDATE public.profiles AS profile
     SET suspension_level = level_in,
         suspended_until = ends_at_val,
         shadow_banned = CASE
           WHEN level_in >= 3 THEN true
           ELSE profile.shadow_banned
         END,
         warning_count = CASE
           WHEN level_in = 1 THEN profile.warning_count + 1
           ELSE profile.warning_count
         END
   WHERE profile.id = target_in;

  IF level_in >= 4 THEN
    SELECT pg_catalog.count(DISTINCT other.profile_id)::integer
      INTO linked_candidate_count
      FROM public.device_fingerprints AS target_fingerprint
      JOIN public.device_fingerprints AS other
        ON other.fp_hash = target_fingerprint.fp_hash
       AND other.profile_id <> target_fingerprint.profile_id
     WHERE target_fingerprint.profile_id = target_in
       AND other.last_seen > pg_catalog.now() - interval '90 days';
  END IF;

  PERFORM public.recompute_trust_score(target_in);

  PERFORM public.record_audit(
    'ban_applied',
    auth.uid(),
    target_in,
    pg_catalog.jsonb_build_object(
      'suspension_id', new_id,
      'level', level_in,
      'reason', reason_in,
      'category', category_in,
      'ends_at', ends_at_val,
      'linked_fingerprint_candidates', linked_candidate_count,
      'linked_accounts_action', 'manual_review_only'
    )
  );

  RETURN new_id;
END
$function$;

REVOKE ALL ON FUNCTION public.apply_ban_level(uuid, smallint, text, text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_ban_level(uuid, smallint, text, text, integer)
  TO service_role;

COMMENT ON FUNCTION public.record_fingerprint(text, text) IS
  'Records a bounded, exact SHA-256 installation signal for advisory abuse review; client asserted and never proof of identity.';
COMMENT ON FUNCTION public.apply_ban_level(uuid, smallint, text, text, integer) IS
  'Applies a sanction to the explicit target only; fingerprint-linked accounts are counted for manual review and are never sanctioned automatically.';
