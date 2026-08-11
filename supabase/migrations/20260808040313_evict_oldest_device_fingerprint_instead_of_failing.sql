-- Evict the least-recently-seen device fingerprint at the cap instead of
-- raising. This migration deliberately does not clean up pre-existing
-- over-cap profiles: that is a separate retention decision and must have its
-- own reviewed data operation.
--
-- record_fingerprint bounds each profile at 20 distinct hashes. On the 20th it
-- accepted the final slot; every later new hash raised ERRCODE 54000, which
-- PostgREST returns as HTTP 500. The signal then froze for exactly the accounts
-- it exists to review: the ones that sign in from many installations.
--
-- The function's own comment calls this signal "bounded" and "advisory". The
-- bound is about storage, not a claim that a 21st device must be refused, so
-- the cap should evict rather than fail.
--
-- Observed 2026-08-09: the protected synthetic staging smoke account sits at
-- exactly 20 and 500s on every new hash. Production has a separate over-cap
-- profile. This migration fails closed on any over-cap target so applying the
-- staging fix can never implicitly authorize production history deletion.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog;

-- Block concurrent INSERT/UPDATE/DELETE while the predecessor and cardinality
-- contract are checked and the function is replaced. SELECT remains available.
LOCK TABLE public.device_fingerprints IN SHARE ROW EXCLUSIVE MODE;

DO $migration_precheck$
DECLARE
  record_rpc oid := pg_catalog.to_regprocedure(
    'public.record_fingerprint(text,text)'
  );
  predecessor_identity_count bigint := 0;
  predecessor_valid_count bigint := 0;
  target_identity_count bigint := 0;
  over_cap_profiles bigint := 0;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION
      'migration_precheck_failed: record_fingerprint migration must run as postgres, got %',
      current_user;
  END IF;

  IF pg_catalog.to_regclass('public.device_fingerprints') IS NULL
     OR pg_catalog.to_regclass('public.profiles') IS NULL
     OR record_rpc IS NULL
     OR pg_catalog.to_regclass(
       'supabase_migrations.schema_migrations'
     ) IS NULL THEN
    RAISE EXCEPTION
      'migration_precheck_failed: fingerprint or migration-ledger prerequisite missing';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_proc AS routine
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = routine.pronamespace
     WHERE namespace.nspname = 'public'
       AND routine.proname = 'record_fingerprint'
  ) <> 1 THEN
    RAISE EXCEPTION
      'migration_precheck_failed: unexpected record_fingerprint overload surface';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid = record_rpc
       AND routine.proowner = pg_catalog.to_regrole('postgres')::oid
       AND routine.prosecdef
       AND routine.prokind = 'f'
       AND NOT routine.proretset
       AND routine.provolatile = 'v'
       AND routine.prorettype = 'void'::pg_catalog.regtype
       AND routine.pronargs = 2
       AND routine.pronargdefaults = 1
       AND routine.proargtypes = '25 25'::pg_catalog.oidvector
       AND routine.proargnames = ARRAY['fp_hash_in', 'ua_snippet_in']::text[]
       AND EXISTS (
         SELECT 1
           FROM pg_catalog.pg_language AS language
          WHERE language.oid = routine.prolang
            AND language.lanname = 'plpgsql'
       )
       AND routine.proconfig = ARRAY['search_path=pg_catalog']::text[]
       AND pg_catalog.md5(routine.prosrc) =
           '0ed8f81e54a5316dd918b100b9369053'
  ) THEN
    RAISE EXCEPTION
      'migration_precheck_failed: record_fingerprint predecessor drifted';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
       'authenticated', record_rpc, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege('anon', record_rpc, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
       'service_role', record_rpc, 'EXECUTE'
     )
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc AS routine
         CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(
             routine.proacl,
             pg_catalog.acldefault('f', routine.proowner)
           )
         ) AS function_acl
        WHERE routine.oid = record_rpc
          AND function_acl.grantee = 0
          AND function_acl.privilege_type = 'EXECUTE'
     )
     OR (
       SELECT pg_catalog.count(*) <> 2
          OR pg_catalog.count(*) FILTER (
               WHERE function_acl.grantor =
                       pg_catalog.to_regrole('postgres')::oid
                 AND function_acl.grantee =
                       pg_catalog.to_regrole('postgres')::oid
                 AND function_acl.privilege_type = 'EXECUTE'
                 AND NOT function_acl.is_grantable
             ) <> 1
          OR pg_catalog.count(*) FILTER (
               WHERE function_acl.grantor =
                       pg_catalog.to_regrole('postgres')::oid
                 AND function_acl.grantee =
                       pg_catalog.to_regrole('authenticated')::oid
                 AND function_acl.privilege_type = 'EXECUTE'
                 AND NOT function_acl.is_grantable
             ) <> 1
         FROM pg_catalog.pg_proc AS routine
         CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(
             routine.proacl,
             pg_catalog.acldefault('f', routine.proowner)
           )
         ) AS function_acl
        WHERE routine.oid = record_rpc
     ) THEN
    RAISE EXCEPTION
      'migration_precheck_failed: record_fingerprint ACL drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid =
           'public.device_fingerprints'::pg_catalog.regclass
       AND relation.relowner = pg_catalog.to_regrole('postgres')::oid
       AND relation.relrowsecurity
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_row
     WHERE constraint_row.conrelid =
           'public.device_fingerprints'::pg_catalog.regclass
       AND constraint_row.contype IN ('p', 'u')
       AND constraint_row.conkey = ARRAY[
         (
           SELECT attribute.attnum
             FROM pg_catalog.pg_attribute AS attribute
            WHERE attribute.attrelid =
                  'public.device_fingerprints'::pg_catalog.regclass
              AND attribute.attname = 'profile_id'
         ),
         (
           SELECT attribute.attnum
             FROM pg_catalog.pg_attribute AS attribute
            WHERE attribute.attrelid =
                  'public.device_fingerprints'::pg_catalog.regclass
              AND attribute.attname = 'fp_hash'
         )
       ]::smallint[]
  ) THEN
    RAISE EXCEPTION
      'migration_precheck_failed: fingerprint table owner/RLS/uniqueness drifted';
  END IF;

  EXECUTE
    'SELECT
       pg_catalog.count(*) FILTER (
         WHERE version = $1 OR name IN ($2, $3)
       ),
       pg_catalog.count(*) FILTER (
         WHERE (version = $1 AND name = $2)
            OR (
              version ~ ''^[0-9]{14}$''
              AND version >= $1
              AND name IN ($2, $3)
            )
       ),
       pg_catalog.count(*) FILTER (
         WHERE version = $4 OR name IN ($5, $6)
       )
       FROM supabase_migrations.schema_migrations'
    INTO
      predecessor_identity_count,
      predecessor_valid_count,
      target_identity_count
    USING
      '20260801082650',
      'advance_privacy_consent_for_first_release_auth_matrix',
      '20260801082650_advance_privacy_consent_for_first_release_auth_matrix',
      '20260808040313',
      '20260808040313_evict_oldest_device_fingerprint_instead_of_failing',
      'evict_oldest_device_fingerprint_instead_of_failing';

  IF predecessor_identity_count <> 1 OR predecessor_valid_count <> 1 THEN
    RAISE EXCEPTION
      'migration_precheck_failed: expected one valid consent predecessor ledger row, found identity %, valid %',
      predecessor_identity_count,
      predecessor_valid_count;
  END IF;
  IF target_identity_count <> 0 THEN
    RAISE EXCEPTION
      'migration_precheck_failed: target migration ledger identity already exists % time(s)',
      target_identity_count;
  END IF;

  SELECT pg_catalog.count(*)
    INTO over_cap_profiles
    FROM (
      SELECT fingerprint.profile_id
        FROM public.device_fingerprints AS fingerprint
       GROUP BY fingerprint.profile_id
      HAVING pg_catalog.count(*) > 20
    ) AS over_cap;

  IF over_cap_profiles <> 0 THEN
    RAISE EXCEPTION
      'migration_precheck_failed: % over-cap profile(s) require a separately approved data cleanup',
      over_cap_profiles;
  END IF;
END;
$migration_precheck$;

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

  -- Pre-existing over-cap data belongs to a separate, reviewed cleanup. Never
  -- let an ordinary sign-in become the event that bulk-deletes that history.
  IF unique_hash_count > 20 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'fingerprint_cleanup_required';
  ELSIF unique_hash_count = 20 THEN
    DELETE FROM public.device_fingerprints AS stale
     WHERE stale.id IN (
       SELECT evict.id
        FROM public.device_fingerprints AS evict
        WHERE evict.profile_id = caller_id
        ORDER BY evict.last_seen ASC, evict.id ASC
        LIMIT 1
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

ALTER FUNCTION public.record_fingerprint(text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_fingerprint(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_fingerprint(text, text)
  TO authenticated;

COMMENT ON FUNCTION public.record_fingerprint(text, text) IS
  'Records a bounded, exact SHA-256 installation signal for advisory abuse review; client asserted and never proof of identity. At exactly 20 the least-recently-seen hash is evicted; pre-existing over-cap data requires separately approved cleanup.';

DO $migration_postcheck$
DECLARE
  record_rpc oid := pg_catalog.to_regprocedure(
    'public.record_fingerprint(text,text)'
  );
  record_source text;
BEGIN
  SELECT routine.prosrc
    INTO record_source
    FROM pg_catalog.pg_proc AS routine
   WHERE routine.oid = record_rpc
     AND routine.proowner = pg_catalog.to_regrole('postgres')::oid
     AND routine.prosecdef
     AND routine.prokind = 'f'
     AND NOT routine.proretset
     AND routine.provolatile = 'v'
     AND routine.prorettype = 'void'::pg_catalog.regtype
     AND routine.pronargs = 2
     AND routine.pronargdefaults = 1
     AND routine.proargtypes = '25 25'::pg_catalog.oidvector
     AND routine.proargnames = ARRAY['fp_hash_in', 'ua_snippet_in']::text[]
     AND EXISTS (
       SELECT 1
         FROM pg_catalog.pg_language AS language
        WHERE language.oid = routine.prolang
          AND language.lanname = 'plpgsql'
     )
     AND routine.proconfig = ARRAY['search_path=pg_catalog']::text[]
     AND pg_catalog.md5(routine.prosrc) =
         '2dad1c8a6d06046f5588f571cfb4cd3e';

  IF record_source IS NULL
     OR pg_catalog.strpos(record_source, 'unique_hash_count > 20') = 0
     OR pg_catalog.strpos(
       record_source,
       'MESSAGE = ''fingerprint_cleanup_required'''
     ) = 0
     OR pg_catalog.strpos(record_source, 'unique_hash_count = 20') = 0
     OR pg_catalog.strpos(
       record_source,
       'ORDER BY evict.last_seen ASC, evict.id ASC'
     ) = 0
     OR pg_catalog.strpos(record_source, 'LIMIT 1') = 0
     OR pg_catalog.strpos(record_source, 'fingerprint_limit_reached') > 0
     OR pg_catalog.strpos(record_source, '54000') > 0 THEN
    RAISE EXCEPTION
      'migration_postcheck_failed: eviction function body drifted';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_proc AS routine
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = routine.pronamespace
     WHERE namespace.nspname = 'public'
       AND routine.proname = 'record_fingerprint'
  ) <> 1 THEN
    RAISE EXCEPTION
      'migration_postcheck_failed: unexpected record_fingerprint overload surface';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
       'authenticated', record_rpc, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege('anon', record_rpc, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
       'service_role', record_rpc, 'EXECUTE'
     )
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc AS routine
         CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(
             routine.proacl,
             pg_catalog.acldefault('f', routine.proowner)
           )
         ) AS function_acl
        WHERE routine.oid = record_rpc
          AND function_acl.grantee = 0
          AND function_acl.privilege_type = 'EXECUTE'
     )
     OR (
       SELECT pg_catalog.count(*) <> 2
          OR pg_catalog.count(*) FILTER (
               WHERE function_acl.grantor =
                       pg_catalog.to_regrole('postgres')::oid
                 AND function_acl.grantee =
                       pg_catalog.to_regrole('postgres')::oid
                 AND function_acl.privilege_type = 'EXECUTE'
                 AND NOT function_acl.is_grantable
             ) <> 1
          OR pg_catalog.count(*) FILTER (
               WHERE function_acl.grantor =
                       pg_catalog.to_regrole('postgres')::oid
                 AND function_acl.grantee =
                       pg_catalog.to_regrole('authenticated')::oid
                 AND function_acl.privilege_type = 'EXECUTE'
                 AND NOT function_acl.is_grantable
             ) <> 1
         FROM pg_catalog.pg_proc AS routine
         CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(
             routine.proacl,
             pg_catalog.acldefault('f', routine.proowner)
           )
         ) AS function_acl
        WHERE routine.oid = record_rpc
     ) THEN
    RAISE EXCEPTION
      'migration_postcheck_failed: record_fingerprint ACL drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.device_fingerprints AS fingerprint
     GROUP BY fingerprint.profile_id
    HAVING pg_catalog.count(*) > 20
  ) THEN
    RAISE EXCEPTION
      'migration_postcheck_failed: over-cap fingerprint data appeared during migration';
  END IF;
END;
$migration_postcheck$;

COMMIT;
