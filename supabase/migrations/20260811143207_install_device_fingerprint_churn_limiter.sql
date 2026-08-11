-- Install the final bounded device-fingerprint write limiter after the
-- 20260811140018 write-quiescence bridge has committed and its drain gate has
-- proved that no predecessor invocation remains in flight. The previous
-- function kept cardinality at 20 but allowed
-- every distinct client-supplied hash to perform DELETE + INSERT + profile
-- UPDATE while waiting on a blocking advisory lock.  An authenticated caller
-- could therefore create unbounded write/WAL/sequence churn and queue database
-- connections even though the live row count stayed bounded.
--
-- This forward migration intentionally leaves the reviewed 20260808040313
-- migration and its ledger row immutable.  The official ledger-aware migration
-- endpoint owns the transaction; do not add top-level BEGIN/COMMIT here.
-- A brand-new branch replay may reach this file immediately after the bridge.
-- Its only age-gate exception is an exact empty Auth/profile/fingerprint data
-- plane; every populated hosted target must still use the companion PRECHECK,
-- wait at least 65 seconds, and prove the drain twice before applying this file.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog;

DO $migration_precheck$
DECLARE
  record_rpc oid := pg_catalog.to_regprocedure(
    'public.record_fingerprint(text,text)'
  );
  predecessor_identity_count bigint := 0;
  predecessor_valid_count bigint := 0;
  target_identity_count bigint := 0;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION
      'migration_precheck_failed: fingerprint hardening must run as postgres, got %',
      current_user;
  END IF;

  IF pg_catalog.to_regclass('public.device_fingerprints') IS NULL
     OR pg_catalog.to_regclass('public.profiles') IS NULL
     OR pg_catalog.to_regclass('auth.users') IS NULL
     OR pg_catalog.to_regclass('auth.identities') IS NULL
     OR pg_catalog.to_regclass('auth.sessions') IS NULL
     OR pg_catalog.to_regclass('auth.refresh_tokens') IS NULL
     OR pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NULL
     OR pg_catalog.to_regnamespace('private') IS NULL
     OR pg_catalog.to_regclass(
          'private.device_fingerprint_churn_cutover'
        ) IS NULL
     OR record_rpc IS NULL THEN
    RAISE EXCEPTION
      'migration_precheck_failed: fingerprint, private schema, or ledger prerequisite missing';
  END IF;

  IF pg_catalog.to_regclass('private.device_fingerprint_rate_limits')
       IS NOT NULL THEN
    RAISE EXCEPTION
      'migration_precheck_failed: device fingerprint limiter relation already exists';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = 'postgres'
       AND (role.rolsuper OR role.rolbypassrls)
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_namespace AS namespace
     WHERE namespace.oid = pg_catalog.to_regnamespace('private')
       AND namespace.nspowner = pg_catalog.to_regrole('postgres')::oid
  ) THEN
    RAISE EXCEPTION
      'migration_precheck_failed: postgres RLS bypass or private schema owner drifted';
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
           '36b7cda577e25ba6fb36c46a7557b496'
  ) THEN
    RAISE EXCEPTION
      'migration_precheck_failed: record_fingerprint quiescence bridge drifted';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
       'authenticated', record_rpc, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege('anon', record_rpc, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
       'service_role', record_rpc, 'EXECUTE'
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
     WHERE relation.oid = 'public.device_fingerprints'::pg_catalog.regclass
       AND relation.relowner = pg_catalog.to_regrole('postgres')::oid
       AND relation.relkind = 'r'
       AND relation.relpersistence = 'p'
       AND relation.relrowsecurity
       AND relation.relreplident = 'd'
  )
  OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid =
           'public.device_fingerprints'::pg_catalog.regclass
       AND NOT trigger_row.tgisinternal
  )
  OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_rewrite AS rule_row
     WHERE rule_row.ev_class =
           'public.device_fingerprints'::pg_catalog.regclass
       AND rule_row.rulename <> '_RETURN'
  )
  OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint AS foreign_key
     WHERE foreign_key.contype = 'f'
       AND foreign_key.confrelid =
           'public.device_fingerprints'::pg_catalog.regclass
  )
  OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_publication_rel AS publication_relation
     WHERE publication_relation.prrelid =
           'public.device_fingerprints'::pg_catalog.regclass
  )
  OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_publication AS publication
     WHERE publication.puballtables
  )
  OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_publication_namespace AS publication_namespace
     WHERE publication_namespace.pnnspid =
           'public'::pg_catalog.regnamespace
  ) THEN
    RAISE EXCEPTION
      'migration_precheck_failed: fingerprint mutation surface drifted';
  END IF;

  IF NOT EXISTS (
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
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_row
     WHERE constraint_row.conrelid =
           'public.device_fingerprints'::pg_catalog.regclass
       AND constraint_row.conname =
           'device_fingerprints_fp_hash_sha256_chk'
       AND constraint_row.contype = 'c'
       AND NOT constraint_row.convalidated
       AND pg_catalog.pg_get_expr(
         constraint_row.conbin,
         constraint_row.conrelid
       ) = '(fp_hash ~ ''^[0-9a-f]{64}$''::text)'
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policies AS policy
     WHERE policy.schemaname = 'public'
       AND policy.tablename = 'device_fingerprints'
       AND policy.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ) THEN
    RAISE EXCEPTION
      'migration_precheck_failed: fingerprint uniqueness/hash/RLS drifted';
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
              AND name = $3
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
      '20260811140018',
      'bound_device_fingerprint_churn',
      '20260811140018_bound_device_fingerprint_churn',
      '20260811143207',
      'install_device_fingerprint_churn_limiter',
      '20260811143207_install_device_fingerprint_churn_limiter';

  IF predecessor_identity_count <> 1 OR predecessor_valid_count <> 1 THEN
    RAISE EXCEPTION
      'migration_precheck_failed: expected one valid quiescence bridge ledger row, found identity %, valid %',
      predecessor_identity_count,
      predecessor_valid_count;
  END IF;
  IF target_identity_count <> 0 THEN
    RAISE EXCEPTION
      'migration_precheck_failed: target migration ledger identity already exists % time(s)',
      target_identity_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid =
           'private.device_fingerprint_churn_cutover'::pg_catalog.regclass
       AND relation.relowner = pg_catalog.to_regrole('postgres')::oid
       AND relation.relkind = 'r'
       AND relation.relpersistence = 'p'
       AND relation.relrowsecurity
       AND relation.relforcerowsecurity
  ) OR (
    SELECT pg_catalog.count(*)
     FROM private.device_fingerprint_churn_cutover AS cutover
     WHERE cutover.singleton
       AND cutover.predecessor_function_md5 =
           '2dad1c8a6d06046f5588f571cfb4cd3e'
       AND cutover.bridge_installed_at <= pg_catalog.clock_timestamp()
       AND (
         cutover.bridge_installed_at <=
           pg_catalog.clock_timestamp() - interval '65 seconds'
         OR (
           NOT EXISTS (SELECT 1 FROM auth.users)
           AND NOT EXISTS (SELECT 1 FROM auth.identities)
           AND NOT EXISTS (SELECT 1 FROM auth.sessions)
           AND NOT EXISTS (SELECT 1 FROM auth.refresh_tokens)
           AND NOT EXISTS (SELECT 1 FROM public.profiles)
           AND NOT EXISTS (SELECT 1 FROM public.device_fingerprints)
         )
       )
  ) <> 1 OR pg_catalog.has_table_privilege(
       'anon',
       'private.device_fingerprint_churn_cutover',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     ) OR pg_catalog.has_table_privilege(
       'authenticated',
       'private.device_fingerprint_churn_cutover',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     ) OR pg_catalog.has_table_privilege(
       'service_role',
       'private.device_fingerprint_churn_cutover',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_publication_rel AS publication_relation
     WHERE publication_relation.prrelid =
           'private.device_fingerprint_churn_cutover'::pg_catalog.regclass
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_publication AS publication
     WHERE publication.puballtables
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_publication_namespace AS publication_namespace
     WHERE publication_namespace.pnnspid =
           'private'::pg_catalog.regnamespace
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(
          relation.relacl,
          pg_catalog.acldefault('r', relation.relowner)
        )
      ) AS table_acl
     WHERE relation.oid =
           'private.device_fingerprint_churn_cutover'::pg_catalog.regclass
       AND (
         table_acl.grantor <> pg_catalog.to_regrole('postgres')::oid
         OR table_acl.grantee <> pg_catalog.to_regrole('postgres')::oid
         OR table_acl.is_grantable
       )
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid =
           'private.device_fingerprint_churn_cutover'::pg_catalog.regclass
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
       AND attribute.attacl IS NOT NULL
     ) THEN
    RAISE EXCEPTION
      'migration_precheck_failed: 65-second cutover drain gate or ACL not satisfied';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_stat_activity AS activity
     WHERE activity.datname = pg_catalog.current_database()
       AND activity.pid <> pg_catalog.pg_backend_pid()
       AND activity.backend_type = 'client backend'
       AND activity.state IS DISTINCT FROM 'idle'
       AND activity.query ~* 'record_fingerprint'
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_locks AS held_lock
      JOIN public.profiles AS profile
        ON held_lock.classid = (
             (
               pg_catalog.hashtextextended(profile.id::text, 0) >> 32
             ) & 4294967295
           )::oid
       AND held_lock.objid = (
             pg_catalog.hashtextextended(profile.id::text, 0)
             & 4294967295
           )::oid
     WHERE held_lock.locktype = 'advisory'
       AND held_lock.database = (
         SELECT database_row.oid
           FROM pg_catalog.pg_database AS database_row
          WHERE database_row.datname = pg_catalog.current_database()
       )
       AND held_lock.objsubid = 1
  ) THEN
    RAISE EXCEPTION
      'migration_precheck_failed: predecessor RPC activity or per-profile advisory call remains in flight';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.device_fingerprints AS fingerprint
     GROUP BY fingerprint.profile_id
    HAVING pg_catalog.count(*) > 20
  ) THEN
    RAISE EXCEPTION
      'migration_precheck_failed: over-cap fingerprint data requires separately approved cleanup';
  END IF;
END;
$migration_precheck$;

CREATE TABLE private.device_fingerprint_rate_limits (
  profile_id uuid PRIMARY KEY
    REFERENCES public.profiles(id) ON DELETE CASCADE,
  last_accepted_write_at timestamptz NOT NULL,
  accepted_new_hash_at timestamptz[] NOT NULL,
  CONSTRAINT device_fingerprint_rate_limits_count_chk CHECK (
    pg_catalog.cardinality(accepted_new_hash_at) BETWEEN 0 AND 5
  ),
  CONSTRAINT device_fingerprint_rate_limits_no_null_chk CHECK (
    pg_catalog.array_position(accepted_new_hash_at, NULL::timestamptz)
      IS NULL
  )
);

ALTER TABLE private.device_fingerprint_rate_limits OWNER TO postgres;
ALTER TABLE private.device_fingerprint_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.device_fingerprint_rate_limits FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.device_fingerprint_rate_limits
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE private.device_fingerprint_rate_limits IS
  'One server-owned row per profile bounding physical fingerprint writes and new installation hashes; never exposed through the Data API.';
COMMENT ON COLUMN private.device_fingerprint_rate_limits.accepted_new_hash_at IS
  'Server timestamps for the at-most-five accepted new hashes in the rolling 24-hour window.';

-- Seed bounded state from the currently retained signal.  This changes only
-- the new private limiter table; device/profile/Auth rows remain untouched.
INSERT INTO private.device_fingerprint_rate_limits (
  profile_id,
  last_accepted_write_at,
  accepted_new_hash_at
)
SELECT
  fingerprint.profile_id,
  pg_catalog.max(fingerprint.last_seen),
  ARRAY(
    SELECT recent.first_seen
      FROM (
        SELECT candidate.first_seen
          FROM public.device_fingerprints AS candidate
         WHERE candidate.profile_id = fingerprint.profile_id
           AND candidate.first_seen >
               pg_catalog.statement_timestamp() - interval '24 hours'
         ORDER BY candidate.first_seen DESC, candidate.id DESC
         LIMIT 5
      ) AS recent
     ORDER BY recent.first_seen ASC
  )
FROM public.device_fingerprints AS fingerprint
GROUP BY fingerprint.profile_id;

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
  observed_at timestamptz := pg_catalog.statement_timestamp();
  profile_exists boolean := false;
  existing_id bigint;
  existing_last_seen timestamptz;
  existing_hash boolean := false;
  unique_hash_count integer := 0;
  limiter_exists boolean := false;
  limiter_last_write timestamptz;
  limiter_new_hash_at timestamptz[] := ARRAY[]::timestamptz[];
  most_recent_fingerprint_write timestamptz;
  lru_id bigint;
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

  -- Never queue database backends behind another call for the same profile.
  IF NOT pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended(caller_id::text, 0)
  ) THEN
    RAISE SQLSTATE 'PT429' USING MESSAGE = 'fingerprint_busy';
  END IF;

  -- Phase one is read-only. Rejected requests must not take row locks because
  -- a row lock itself can dirty tuple lock state and amplify WAL under abuse.
  SELECT EXISTS (
    SELECT 1
      FROM public.profiles AS profile
     WHERE profile.id = caller_id
  ) INTO profile_exists;
  IF NOT profile_exists THEN
    RETURN;
  END IF;

  SELECT fingerprint.last_seen
    INTO existing_last_seen
    FROM public.device_fingerprints AS fingerprint
   WHERE fingerprint.profile_id = caller_id
     AND fingerprint.fp_hash = cleaned_hash;
  IF FOUND
     AND existing_last_seen > observed_at - interval '5 minutes' THEN
    RETURN;
  END IF;

  SELECT
    pg_catalog.count(*)::integer,
    pg_catalog.max(fingerprint.last_seen)
    INTO unique_hash_count, most_recent_fingerprint_write
    FROM public.device_fingerprints AS fingerprint
   WHERE fingerprint.profile_id = caller_id;

  IF unique_hash_count > 20 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'fingerprint_cleanup_required';
  END IF;

  SELECT limiter.last_accepted_write_at
    INTO limiter_last_write
    FROM private.device_fingerprint_rate_limits AS limiter
   WHERE limiter.profile_id = caller_id;
  limiter_exists := FOUND;

  limiter_last_write := CASE
    WHEN limiter_last_write IS NULL THEN most_recent_fingerprint_write
    WHEN most_recent_fingerprint_write IS NULL THEN limiter_last_write
    ELSE GREATEST(
      limiter_last_write,
      most_recent_fingerprint_write
    )
  END;

  IF limiter_exists THEN
    SELECT ARRAY(
      SELECT accepted.accepted_at
        FROM private.device_fingerprint_rate_limits AS limiter
        CROSS JOIN LATERAL pg_catalog.unnest(
          limiter.accepted_new_hash_at
        ) AS accepted(accepted_at)
       WHERE limiter.profile_id = caller_id
         AND accepted.accepted_at > observed_at - interval '24 hours'
       ORDER BY accepted.accepted_at DESC
       LIMIT 5
    ) INTO limiter_new_hash_at;
  ELSE
    SELECT ARRAY(
      SELECT fingerprint.first_seen
        FROM public.device_fingerprints AS fingerprint
       WHERE fingerprint.profile_id = caller_id
         AND fingerprint.first_seen > observed_at - interval '24 hours'
       ORDER BY fingerprint.first_seen DESC, fingerprint.id DESC
       LIMIT 5
    ) INTO limiter_new_hash_at;
  END IF;

  IF limiter_last_write > observed_at - interval '5 minutes' THEN
    RAISE SQLSTATE 'PT429' USING MESSAGE = 'fingerprint_write_deferred';
  END IF;

  existing_hash := existing_last_seen IS NOT NULL;
  IF NOT existing_hash
     AND pg_catalog.cardinality(limiter_new_hash_at) >= 5 THEN
    RAISE SQLSTATE 'PT429' USING MESSAGE = 'fingerprint_rate_limited';
  END IF;

  -- Phase two runs only for an accepted physical write. Fixed lock order:
  -- profile advisory -> profile parent -> limiter -> fingerprint row.
  BEGIN
    SELECT true
      INTO profile_exists
      FROM public.profiles AS profile
     WHERE profile.id = caller_id
       FOR NO KEY UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE SQLSTATE 'PT429' USING MESSAGE = 'fingerprint_busy';
  END;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  limiter_last_write := NULL;
  limiter_new_hash_at := ARRAY[]::timestamptz[];
  BEGIN
    SELECT limiter.last_accepted_write_at
      INTO limiter_last_write
      FROM private.device_fingerprint_rate_limits AS limiter
     WHERE limiter.profile_id = caller_id
       FOR UPDATE NOWAIT;
    limiter_exists := FOUND;
  EXCEPTION WHEN lock_not_available THEN
    RAISE SQLSTATE 'PT429' USING MESSAGE = 'fingerprint_busy';
  END;

  BEGIN
    SELECT fingerprint.id, fingerprint.last_seen
      INTO existing_id, existing_last_seen
      FROM public.device_fingerprints AS fingerprint
     WHERE fingerprint.profile_id = caller_id
       AND fingerprint.fp_hash = cleaned_hash
       FOR UPDATE NOWAIT;
    existing_hash := FOUND;
  EXCEPTION WHEN lock_not_available THEN
    RAISE SQLSTATE 'PT429' USING MESSAGE = 'fingerprint_busy';
  END;

  IF existing_hash
     AND existing_last_seen > observed_at - interval '5 minutes' THEN
    RETURN;
  END IF;

  SELECT
    pg_catalog.count(*)::integer,
    pg_catalog.max(fingerprint.last_seen)
    INTO unique_hash_count, most_recent_fingerprint_write
    FROM public.device_fingerprints AS fingerprint
   WHERE fingerprint.profile_id = caller_id;

  IF unique_hash_count > 20 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'fingerprint_cleanup_required';
  END IF;

  limiter_last_write := CASE
    WHEN limiter_last_write IS NULL THEN most_recent_fingerprint_write
    WHEN most_recent_fingerprint_write IS NULL THEN limiter_last_write
    ELSE GREATEST(
      limiter_last_write,
      most_recent_fingerprint_write
    )
  END;

  IF limiter_exists THEN
    SELECT ARRAY(
      SELECT accepted.accepted_at
        FROM private.device_fingerprint_rate_limits AS limiter
        CROSS JOIN LATERAL pg_catalog.unnest(
          limiter.accepted_new_hash_at
        ) AS accepted(accepted_at)
       WHERE limiter.profile_id = caller_id
         AND accepted.accepted_at > observed_at - interval '24 hours'
       ORDER BY accepted.accepted_at DESC
       LIMIT 5
    ) INTO limiter_new_hash_at;
  ELSE
    SELECT ARRAY(
      SELECT fingerprint.first_seen
        FROM public.device_fingerprints AS fingerprint
       WHERE fingerprint.profile_id = caller_id
         AND fingerprint.first_seen > observed_at - interval '24 hours'
       ORDER BY fingerprint.first_seen DESC, fingerprint.id DESC
       LIMIT 5
    ) INTO limiter_new_hash_at;
  END IF;

  IF limiter_last_write > observed_at - interval '5 minutes' THEN
    RAISE SQLSTATE 'PT429' USING MESSAGE = 'fingerprint_write_deferred';
  END IF;

  IF NOT existing_hash
     AND pg_catalog.cardinality(limiter_new_hash_at) >= 5 THEN
    RAISE SQLSTATE 'PT429' USING MESSAGE = 'fingerprint_rate_limited';
  END IF;

  BEGIN
    IF existing_hash THEN
      UPDATE public.device_fingerprints AS fingerprint
         SET last_seen = observed_at,
             seen_count = CASE
               WHEN fingerprint.seen_count < 2147483647
                 THEN fingerprint.seen_count + 1
               ELSE fingerprint.seen_count
             END,
             ua_snippet = COALESCE(cleaned_ua, fingerprint.ua_snippet)
       WHERE fingerprint.id = existing_id
         AND fingerprint.profile_id = caller_id;
    ELSIF unique_hash_count = 20 THEN
      SELECT fingerprint.id
        INTO lru_id
        FROM public.device_fingerprints AS fingerprint
       WHERE fingerprint.profile_id = caller_id
       ORDER BY fingerprint.last_seen ASC, fingerprint.id ASC
       LIMIT 1
       FOR UPDATE NOWAIT;

      UPDATE public.device_fingerprints AS fingerprint
         SET fp_hash = cleaned_hash,
             first_seen = observed_at,
             last_seen = observed_at,
             seen_count = 1,
             ua_snippet = cleaned_ua
       WHERE fingerprint.id = lru_id
         AND fingerprint.profile_id = caller_id;
    ELSE
      INSERT INTO public.device_fingerprints (
        profile_id,
        fp_hash,
        first_seen,
        last_seen,
        seen_count,
        ua_snippet
      ) VALUES (
        caller_id,
        cleaned_hash,
        observed_at,
        observed_at,
        1,
        cleaned_ua
      );
    END IF;
  EXCEPTION
    WHEN lock_not_available OR unique_violation THEN
      RAISE SQLSTATE 'PT429' USING MESSAGE = 'fingerprint_busy';
  END;

  IF NOT existing_hash THEN
    limiter_new_hash_at := pg_catalog.array_prepend(
      observed_at,
      limiter_new_hash_at
    );
  END IF;

  IF limiter_exists THEN
    UPDATE private.device_fingerprint_rate_limits AS limiter
       SET last_accepted_write_at = observed_at,
           accepted_new_hash_at = limiter_new_hash_at
     WHERE limiter.profile_id = caller_id;
  ELSE
    INSERT INTO private.device_fingerprint_rate_limits (
      profile_id,
      last_accepted_write_at,
      accepted_new_hash_at
    ) VALUES (
      caller_id,
      observed_at,
      limiter_new_hash_at
    );
  END IF;

  UPDATE public.profiles AS profile
     SET last_fp_hash = cleaned_hash,
         last_fp_seen_at = observed_at
   WHERE profile.id = caller_id;

  IF (
    SELECT pg_catalog.count(*)
      FROM public.device_fingerprints AS fingerprint
     WHERE fingerprint.profile_id = caller_id
  ) > 20 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'fingerprint_cleanup_required';
  END IF;
END
$function$;

ALTER FUNCTION public.record_fingerprint(text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_fingerprint(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_fingerprint(text, text)
  TO authenticated;

COMMENT ON FUNCTION public.record_fingerprint(text, text) IS
  'Records a bounded, exact SHA-256 installation signal for advisory abuse review; client asserted and never proof of identity. Physical writes are limited per profile, new hashes are capped per 24-hour window, lock contention fails fast with PT429, and an at-cap LRU row is reused without advancing the sequence.';

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
         '236e5532c22d63f9a0336e38fc381c82';

  IF record_source IS NULL
     OR pg_catalog.strpos(
       record_source,
       'pg_try_advisory_xact_lock'
     ) = 0
     OR pg_catalog.strpos(
       record_source,
       'pg_advisory_xact_lock('
     ) > 0
     OR pg_catalog.strpos(record_source, 'fingerprint_busy') = 0
     OR pg_catalog.strpos(record_source, 'fingerprint_write_deferred') = 0
     OR pg_catalog.strpos(record_source, 'fingerprint_rate_limited') = 0
     OR pg_catalog.strpos(
       record_source,
       'UPDATE public.device_fingerprints AS fingerprint'
     ) = 0
     OR pg_catalog.strpos(record_source, 'DELETE FROM') > 0 THEN
    RAISE EXCEPTION
      'migration_postcheck_failed: bounded fingerprint function body drifted';
  END IF;

  IF pg_catalog.obj_description(record_rpc, 'pg_proc') IS DISTINCT FROM
       'Records a bounded, exact SHA-256 installation signal for advisory abuse review; client asserted and never proof of identity. Physical writes are limited per profile, new hashes are capped per 24-hour window, lock contention fails fast with PT429, and an at-cap LRU row is reused without advancing the sequence.'
     OR NOT pg_catalog.has_function_privilege(
       'authenticated', record_rpc, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege('anon', record_rpc, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
       'service_role', record_rpc, 'EXECUTE'
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
      'migration_postcheck_failed: bounded fingerprint function ACL/comment drifted';
  END IF;


  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid = 'public.device_fingerprints'::pg_catalog.regclass
       AND relation.relowner = pg_catalog.to_regrole('postgres')::oid
       AND relation.relkind = 'r'
       AND relation.relpersistence = 'p'
       AND relation.relrowsecurity
       AND relation.relreplident = 'd'
  )
  OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid =
           'public.device_fingerprints'::pg_catalog.regclass
       AND NOT trigger_row.tgisinternal
  )
  OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_rewrite AS rule_row
     WHERE rule_row.ev_class =
           'public.device_fingerprints'::pg_catalog.regclass
       AND rule_row.rulename <> '_RETURN'
  )
  OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint AS foreign_key
     WHERE foreign_key.contype = 'f'
       AND foreign_key.confrelid =
           'public.device_fingerprints'::pg_catalog.regclass
  )
  OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication_rel AS publication_relation
     WHERE publication_relation.prrelid =
           'public.device_fingerprints'::pg_catalog.regclass
  )
  OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_publication AS publication
     WHERE publication.puballtables
  )
  OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_publication_namespace AS publication_namespace
     WHERE publication_namespace.pnnspid =
           'public'::pg_catalog.regnamespace
  )
  OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_row
     WHERE constraint_row.conrelid =
           'public.device_fingerprints'::pg_catalog.regclass
       AND constraint_row.contype IN ('p', 'u')
       AND constraint_row.conkey = ARRAY[
         (
           SELECT attribute.attnum FROM pg_catalog.pg_attribute AS attribute
            WHERE attribute.attrelid =
                  'public.device_fingerprints'::pg_catalog.regclass
              AND attribute.attname = 'profile_id'
         ),
         (
           SELECT attribute.attnum FROM pg_catalog.pg_attribute AS attribute
            WHERE attribute.attrelid =
                  'public.device_fingerprints'::pg_catalog.regclass
              AND attribute.attname = 'fp_hash'
         )
       ]::smallint[]
  )
  OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_row
     WHERE constraint_row.conrelid =
           'public.device_fingerprints'::pg_catalog.regclass
       AND constraint_row.contype = 'c'
       AND constraint_row.conname =
           'device_fingerprints_fp_hash_sha256_chk'
       AND NOT constraint_row.convalidated
       AND pg_catalog.pg_get_expr(
         constraint_row.conbin,
         constraint_row.conrelid
       ) = '(fp_hash ~ ''^[0-9a-f]{64}$''::text)'
  )
  OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policies AS policy
     WHERE policy.schemaname = 'public'
       AND policy.tablename = 'device_fingerprints'
       AND policy.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ) THEN
    RAISE EXCEPTION
      'migration_postcheck_failed: fingerprint mutation/constraint/RLS surface drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = 'postgres'
       AND (role.rolsuper OR role.rolbypassrls)
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_namespace AS namespace
     WHERE namespace.oid = pg_catalog.to_regnamespace('private')
       AND namespace.nspowner = pg_catalog.to_regrole('postgres')::oid
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'private'
       AND relation.relname = 'device_fingerprint_rate_limits'
       AND relation.relkind = 'r'
       AND relation.relpersistence = 'p'
       AND relation.relowner = pg_catalog.to_regrole('postgres')::oid
       AND relation.relrowsecurity
       AND relation.relforcerowsecurity
       AND relation.relreplident = 'd'
  ) THEN
    RAISE EXCEPTION
      'migration_postcheck_failed: limiter relation boundary drifted';
  END IF;

  IF (
    SELECT pg_catalog.array_agg(attribute.attname ORDER BY attribute.attnum)
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid =
           'private.device_fingerprint_rate_limits'::pg_catalog.regclass
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  ) <> ARRAY[
    'profile_id',
    'last_accepted_write_at',
    'accepted_new_hash_at'
  ]::name[] OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_constraint AS constraint_row
     WHERE constraint_row.conrelid =
           'private.device_fingerprint_rate_limits'::pg_catalog.regclass
  ) <> 4 OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_row
     WHERE constraint_row.conrelid =
           'private.device_fingerprint_rate_limits'::pg_catalog.regclass
       AND constraint_row.contype = 'f'
       AND constraint_row.confrelid = 'public.profiles'::pg_catalog.regclass
       AND constraint_row.confdeltype = 'c'
       AND constraint_row.convalidated
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policies AS policy
     WHERE policy.schemaname = 'private'
       AND policy.tablename = 'device_fingerprint_rate_limits'
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid =
           'private.device_fingerprint_rate_limits'::pg_catalog.regclass
       AND NOT trigger_row.tgisinternal
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_rewrite AS rule_row
     WHERE rule_row.ev_class =
           'private.device_fingerprint_rate_limits'::pg_catalog.regclass
       AND rule_row.rulename <> '_RETURN'
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_publication_rel AS publication_relation
     WHERE publication_relation.prrelid =
           'private.device_fingerprint_rate_limits'::pg_catalog.regclass
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_publication AS publication
     WHERE publication.puballtables
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_publication_namespace AS publication_namespace
     WHERE publication_namespace.pnnspid =
           'private'::pg_catalog.regnamespace
  ) THEN
    RAISE EXCEPTION
      'migration_postcheck_failed: limiter shape or mutation surface drifted';
  END IF;

  IF pg_catalog.has_table_privilege(
       'anon',
       'private.device_fingerprint_rate_limits',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     OR pg_catalog.has_table_privilege(
       'authenticated',
       'private.device_fingerprint_rate_limits',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     OR pg_catalog.has_table_privilege(
       'service_role',
       'private.device_fingerprint_rate_limits',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_class AS relation
         CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(
             relation.relacl,
             pg_catalog.acldefault('r', relation.relowner)
           )
         ) AS table_acl
        WHERE relation.oid =
              'private.device_fingerprint_rate_limits'::pg_catalog.regclass
          AND (
            table_acl.grantor <>
              pg_catalog.to_regrole('postgres')::oid
            OR table_acl.grantee <>
              pg_catalog.to_regrole('postgres')::oid
            OR table_acl.is_grantable
          )
     )
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_attribute AS attribute
        WHERE attribute.attrelid =
              'private.device_fingerprint_rate_limits'::pg_catalog.regclass
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
          AND attribute.attacl IS NOT NULL
     ) THEN
    RAISE EXCEPTION
      'migration_postcheck_failed: limiter ACL drifted';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
      FROM private.device_fingerprint_rate_limits AS limiter
  ) <> (
    SELECT pg_catalog.count(DISTINCT fingerprint.profile_id)
      FROM public.device_fingerprints AS fingerprint
  ) THEN
    RAISE EXCEPTION
      'migration_postcheck_failed: limiter seed cardinality drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM private.device_fingerprint_rate_limits AS limiter
     WHERE pg_catalog.cardinality(limiter.accepted_new_hash_at) > 5
        OR pg_catalog.array_position(
             limiter.accepted_new_hash_at,
             NULL::timestamptz
           ) IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'migration_postcheck_failed: limiter seed payload drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.device_fingerprints AS fingerprint
     GROUP BY fingerprint.profile_id
    HAVING pg_catalog.count(*) > 20
  ) THEN
    RAISE EXCEPTION
      'migration_postcheck_failed: over-cap fingerprint data appeared';
  END IF;
END;
$migration_postcheck$;

DROP TABLE private.device_fingerprint_churn_cutover;
