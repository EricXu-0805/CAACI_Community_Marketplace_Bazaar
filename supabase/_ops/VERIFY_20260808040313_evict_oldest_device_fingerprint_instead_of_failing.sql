-- Read-only post-deploy verification for the bounded fingerprint eviction.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '30s';

DO $verify$
DECLARE
  record_rpc oid := pg_catalog.to_regprocedure(
    'public.record_fingerprint(text,text)'
  );
  record_source text;
  migration_identity_count bigint := 0;
  migration_valid_count bigint := 0;
BEGIN
  IF record_rpc IS NULL THEN
    RAISE EXCEPTION 'verify_failed: record_fingerprint is missing';
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
      'verify_failed: unexpected record_fingerprint overload surface';
  END IF;

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
      'verify_failed: record_fingerprint eviction body drifted';
  END IF;

  IF pg_catalog.obj_description(record_rpc, 'pg_proc') IS DISTINCT FROM
       'Records a bounded, exact SHA-256 installation signal for advisory abuse review; client asserted and never proof of identity. At exactly 20 the least-recently-seen hash is evicted; pre-existing over-cap data requires separately approved cleanup.' THEN
    RAISE EXCEPTION
      'verify_failed: record_fingerprint comment drifted';
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
    RAISE EXCEPTION 'verify_failed: record_fingerprint ACL drifted';
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
       AND constraint_row.conname =
           'device_fingerprints_fp_hash_sha256_chk'
       AND constraint_row.contype = 'c'
       AND NOT constraint_row.convalidated
       AND pg_catalog.pg_get_expr(
         constraint_row.conbin,
         constraint_row.conrelid
       ) = '(fp_hash ~ ''^[0-9a-f]{64}$''::text)'
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
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policies AS policy
     WHERE policy.schemaname = 'public'
       AND policy.tablename = 'device_fingerprints'
       AND policy.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
       AND (
         'public' = ANY (policy.roles)
         OR 'anon' = ANY (policy.roles)
         OR 'authenticated' = ANY (policy.roles)
       )
  ) THEN
    RAISE EXCEPTION
      'verify_failed: fingerprint table constraint/RLS boundary drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.device_fingerprints AS fingerprint
     GROUP BY fingerprint.profile_id
    HAVING pg_catalog.count(*) > 20
  ) THEN
    RAISE EXCEPTION
      'verify_failed: fingerprint profile remains above the cap';
  END IF;

  IF pg_catalog.to_regclass(
       'supabase_migrations.schema_migrations'
     ) IS NULL THEN
    RAISE EXCEPTION 'verify_failed: Supabase migration ledger is missing';
  END IF;

  EXECUTE
    'SELECT
       pg_catalog.count(*) FILTER (
         WHERE version = $1 OR name IN ($2, $3)
       ),
       pg_catalog.count(*) FILTER (
         WHERE (
           version = $1 AND name = $3
         ) OR (
           name = $2
           AND version ~ ''^[0-9]{14}$''
           AND version >= $1
         )
       )
       FROM supabase_migrations.schema_migrations'
    INTO migration_identity_count, migration_valid_count
    USING
      '20260808040313',
      '20260808040313_evict_oldest_device_fingerprint_instead_of_failing',
      'evict_oldest_device_fingerprint_instead_of_failing';

  IF migration_identity_count <> 1 OR migration_valid_count <> 1 THEN
    RAISE EXCEPTION
      'verify_failed: expected one exact target migration ledger row, found identity %, valid %',
      migration_identity_count,
      migration_valid_count;
  END IF;
END;
$verify$;

WITH per_profile AS (
  SELECT fingerprint.profile_id, pg_catalog.count(*)::integer AS row_count
    FROM public.device_fingerprints AS fingerprint
   GROUP BY fingerprint.profile_id
)
SELECT
  (SELECT pg_catalog.count(*) FROM public.device_fingerprints)
    AS fingerprint_rows,
  (
    SELECT pg_catalog.md5(
      COALESCE(
        pg_catalog.jsonb_agg(
          pg_catalog.to_jsonb(fingerprint)
          ORDER BY fingerprint.id
        )::text,
        '[]'
      )
    )
      FROM public.device_fingerprints AS fingerprint
  ) AS fingerprint_rows_md5,
  (SELECT pg_catalog.count(*) FROM per_profile) AS fingerprint_profiles,
  (
    SELECT pg_catalog.count(DISTINCT fingerprint.profile_id)
      FROM public.device_fingerprints AS fingerprint
      JOIN auth.users AS auth_user
        ON auth_user.id = fingerprint.profile_id
     WHERE auth_user.raw_user_meta_data @> '{"synthetic":true}'::jsonb
  ) AS synthetic_fingerprint_profiles,
  (SELECT COALESCE(pg_catalog.max(row_count), 0) FROM per_profile)
    AS max_rows_per_profile,
  (SELECT pg_catalog.count(*) FROM public.profiles) AS profile_rows,
  (
    SELECT pg_catalog.md5(
      COALESCE(
        pg_catalog.jsonb_agg(
          pg_catalog.to_jsonb(profile)
          ORDER BY profile.id
        )::text,
        '[]'
      )
    )
      FROM public.profiles AS profile
  ) AS profile_rows_md5,
  (SELECT pg_catalog.count(*) FROM auth.sessions) AS auth_session_rows,
  (
    SELECT pg_catalog.md5(
      COALESCE(
        pg_catalog.jsonb_agg(
          pg_catalog.to_jsonb(session_row)
          ORDER BY session_row.id
        )::text,
        '[]'
      )
    )
      FROM auth.sessions AS session_row
  ) AS auth_session_rows_md5,
  (SELECT pg_catalog.count(*) FROM auth.users) AS auth_user_rows,
  pg_catalog.md5(routine.prosrc) AS installed_function_md5,
  routine.proacl AS installed_function_acl
FROM pg_catalog.pg_proc AS routine
WHERE routine.oid = 'public.record_fingerprint(text,text)'::pg_catalog.regprocedure;

ROLLBACK;
