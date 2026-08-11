-- Read-only post-deploy verification for the final fingerprint limiter.

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
  IF current_user <> 'postgres' OR record_rpc IS NULL THEN
    RAISE EXCEPTION
      'verify_failed: postgres operator or record_fingerprint missing';
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
      'verify_failed: bounded fingerprint function body drifted';
  END IF;

  IF pg_catalog.obj_description(record_rpc, 'pg_proc') IS DISTINCT FROM
       'Records a bounded, exact SHA-256 installation signal for advisory abuse review; client asserted and never proof of identity. Physical writes are limited per profile, new hashes are capped per 24-hour window, lock contention fails fast with PT429, and an at-cap LRU row is reused without advancing the sequence.' THEN
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
      'verify_failed: postgres RLS bypass or private schema owner drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid =
           'private.device_fingerprint_rate_limits'::pg_catalog.regclass
       AND relation.relowner = pg_catalog.to_regrole('postgres')::oid
       AND relation.relkind = 'r'
       AND relation.relpersistence = 'p'
       AND relation.relrowsecurity
       AND relation.relforcerowsecurity
       AND relation.relreplident = 'd'
  ) OR (
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
    SELECT pg_catalog.array_agg(
             pg_catalog.format_type(
               attribute.atttypid,
               attribute.atttypmod
             )
             ORDER BY attribute.attnum
           )
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid =
           'private.device_fingerprint_rate_limits'::pg_catalog.regclass
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  ) <> ARRAY[
    'uuid',
    'timestamp with time zone',
    'timestamp with time zone[]'
  ]::text[] OR (
    SELECT pg_catalog.bool_and(attribute.attnotnull)
           AND pg_catalog.bool_and(default_row.adbin IS NULL)
           AND pg_catalog.bool_and(attribute.attacl IS NULL)
      FROM pg_catalog.pg_attribute AS attribute
      LEFT JOIN pg_catalog.pg_attrdef AS default_row
        ON default_row.adrelid = attribute.attrelid
       AND default_row.adnum = attribute.attnum
     WHERE attribute.attrelid =
           'private.device_fingerprint_rate_limits'::pg_catalog.regclass
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  ) IS NOT TRUE THEN
    RAISE EXCEPTION
      'verify_failed: limiter relation or column shape drifted';
  END IF;

  IF pg_catalog.to_regclass(
       'private.device_fingerprint_churn_cutover'
     ) IS NOT NULL THEN
    RAISE EXCEPTION
      'verify_failed: single-use cutover gate still exists';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_constraint AS constraint_row
     WHERE constraint_row.conrelid =
           'private.device_fingerprint_rate_limits'::pg_catalog.regclass
  ) <> 4 OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_row
     WHERE constraint_row.conrelid =
           'private.device_fingerprint_rate_limits'::pg_catalog.regclass
       AND constraint_row.conname =
           'device_fingerprint_rate_limits_pkey'
       AND constraint_row.contype = 'p'
       AND constraint_row.convalidated
       AND constraint_row.conkey = ARRAY[
         (
           SELECT attribute.attnum
             FROM pg_catalog.pg_attribute AS attribute
            WHERE attribute.attrelid =
                  'private.device_fingerprint_rate_limits'::pg_catalog.regclass
              AND attribute.attname = 'profile_id'
         )
       ]::smallint[]
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_row
     WHERE constraint_row.conrelid =
           'private.device_fingerprint_rate_limits'::pg_catalog.regclass
       AND constraint_row.conname =
           'device_fingerprint_rate_limits_profile_id_fkey'
       AND constraint_row.contype = 'f'
       AND constraint_row.convalidated
       AND constraint_row.confrelid = 'public.profiles'::pg_catalog.regclass
       AND constraint_row.confdeltype = 'c'
       AND constraint_row.confupdtype = 'a'
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_row
     WHERE constraint_row.conrelid =
           'private.device_fingerprint_rate_limits'::pg_catalog.regclass
       AND constraint_row.conname =
           'device_fingerprint_rate_limits_count_chk'
       AND constraint_row.contype = 'c'
       AND constraint_row.convalidated
       AND pg_catalog.pg_get_expr(
         constraint_row.conbin,
         constraint_row.conrelid
       ) = '((cardinality(accepted_new_hash_at) >= 0) AND (cardinality(accepted_new_hash_at) <= 5))'
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_row
     WHERE constraint_row.conrelid =
           'private.device_fingerprint_rate_limits'::pg_catalog.regclass
       AND constraint_row.conname =
           'device_fingerprint_rate_limits_no_null_chk'
       AND constraint_row.contype = 'c'
       AND constraint_row.convalidated
       AND pg_catalog.pg_get_expr(
         constraint_row.conbin,
         constraint_row.conrelid
       ) = '(array_position(accepted_new_hash_at, NULL::timestamp with time zone) IS NULL)'
  ) THEN
    RAISE EXCEPTION
      'verify_failed: limiter constraint surface drifted';
  END IF;

  IF EXISTS (
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
  ) OR pg_catalog.has_table_privilege(
       'anon',
       'private.device_fingerprint_rate_limits',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     ) OR pg_catalog.has_table_privilege(
       'authenticated',
       'private.device_fingerprint_rate_limits',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     ) OR pg_catalog.has_table_privilege(
       'service_role',
       'private.device_fingerprint_rate_limits',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
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
           'private.device_fingerprint_rate_limits'::pg_catalog.regclass
       AND (
         table_acl.grantor <> pg_catalog.to_regrole('postgres')::oid
         OR table_acl.grantee <> pg_catalog.to_regrole('postgres')::oid
         OR table_acl.is_grantable
       )
  ) THEN
    RAISE EXCEPTION
      'verify_failed: limiter policy, mutation surface, or ACL drifted';
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
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid =
           'public.device_fingerprints'::pg_catalog.regclass
       AND NOT trigger_row.tgisinternal
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_rewrite AS rule_row
     WHERE rule_row.ev_class =
           'public.device_fingerprints'::pg_catalog.regclass
       AND rule_row.rulename <> '_RETURN'
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint AS foreign_key
     WHERE foreign_key.contype = 'f'
       AND foreign_key.confrelid =
           'public.device_fingerprints'::pg_catalog.regclass
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_publication_rel AS publication_relation
     WHERE publication_relation.prrelid =
           'public.device_fingerprints'::pg_catalog.regclass
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_publication AS publication
     WHERE publication.puballtables
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_publication_namespace AS publication_namespace
     WHERE publication_namespace.pnnspid =
           'public'::pg_catalog.regnamespace
  ) THEN
    RAISE EXCEPTION
      'verify_failed: fingerprint table boundary drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM private.device_fingerprint_rate_limits AS limiter
     WHERE pg_catalog.cardinality(limiter.accepted_new_hash_at) > 5
        OR pg_catalog.array_position(
             limiter.accepted_new_hash_at,
             NULL::timestamptz
           ) IS NOT NULL
  ) OR (
    SELECT pg_catalog.count(*)
      FROM private.device_fingerprint_rate_limits AS limiter
  ) <> (
    SELECT pg_catalog.count(DISTINCT fingerprint.profile_id)
      FROM public.device_fingerprints AS fingerprint
  ) OR EXISTS (
    SELECT 1
      FROM public.device_fingerprints AS fingerprint
     GROUP BY fingerprint.profile_id
    HAVING pg_catalog.count(*) > 20
  ) THEN
    RAISE EXCEPTION
      'verify_failed: limiter state or fingerprint cap drifted';
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
       )
       FROM supabase_migrations.schema_migrations'
    INTO migration_identity_count, migration_valid_count
    USING
      '20260811143207',
      'install_device_fingerprint_churn_limiter',
      '20260811143207_install_device_fingerprint_churn_limiter';

  IF migration_identity_count <> 1 OR migration_valid_count <> 1 THEN
    RAISE EXCEPTION
      'verify_failed: expected one valid final limiter ledger row, found identity %, valid %',
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
  pg_catalog.statement_timestamp() AS captured_at,
  (SELECT pg_catalog.count(*) FROM public.device_fingerprints)
    AS fingerprint_rows,
  (
    SELECT pg_catalog.md5(COALESCE(pg_catalog.jsonb_agg(
      pg_catalog.to_jsonb(fingerprint) ORDER BY fingerprint.id
    )::text, '[]'))
      FROM public.device_fingerprints AS fingerprint
  ) AS fingerprint_rows_md5,
  (SELECT pg_catalog.count(*) FROM per_profile) AS fingerprint_profiles,
  (SELECT COALESCE(pg_catalog.max(row_count), 0) FROM per_profile)
    AS max_rows_per_profile,
  (SELECT pg_catalog.count(*) FROM public.profiles) AS profile_rows,
  (
    SELECT pg_catalog.md5(COALESCE(pg_catalog.jsonb_agg(
      pg_catalog.to_jsonb(profile) ORDER BY profile.id
    )::text, '[]'))
      FROM public.profiles AS profile
  ) AS profile_rows_md5,
  (SELECT pg_catalog.count(*) FROM auth.sessions) AS auth_session_rows,
  (
    SELECT pg_catalog.md5(COALESCE(pg_catalog.jsonb_agg(
      pg_catalog.to_jsonb(session_row) ORDER BY session_row.id
    )::text, '[]'))
      FROM auth.sessions AS session_row
  ) AS auth_session_rows_md5,
  (SELECT pg_catalog.count(*)
     FROM private.device_fingerprint_rate_limits) AS limiter_rows,
  (
    SELECT pg_catalog.md5(COALESCE(pg_catalog.jsonb_agg(
      pg_catalog.to_jsonb(limiter) ORDER BY limiter.profile_id
    )::text, '[]'))
      FROM private.device_fingerprint_rate_limits AS limiter
  ) AS limiter_rows_md5,
  sequence_state.last_value AS fingerprint_sequence_last_value,
  sequence_state.is_called AS fingerprint_sequence_is_called,
  pg_catalog.md5(routine.prosrc) AS installed_function_md5,
  routine.proacl AS installed_function_acl
FROM pg_catalog.pg_proc AS routine
CROSS JOIN public.device_fingerprints_id_seq AS sequence_state
WHERE routine.oid =
      'public.record_fingerprint(text,text)'::pg_catalog.regprocedure;

ROLLBACK;
