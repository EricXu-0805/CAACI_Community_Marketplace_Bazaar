-- Read-only verification for the DB239 write-quiescence bridge.

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
     AND routine.proconfig = ARRAY['search_path=pg_catalog']::text[]
     AND EXISTS (
       SELECT 1
         FROM pg_catalog.pg_language AS language
        WHERE language.oid = routine.prolang
          AND language.lanname = 'plpgsql'
     )
     AND pg_catalog.md5(routine.prosrc) =
         '36b7cda577e25ba6fb36c46a7557b496';

  IF record_source IS NULL
     OR pg_catalog.strpos(record_source, 'pg_try_advisory_xact_lock') = 0
     OR pg_catalog.strpos(record_source, 'fingerprint_busy') = 0
     OR pg_catalog.strpos(record_source, 'fingerprint_write_deferred') = 0
     OR pg_catalog.strpos(record_source, 'pg_advisory_xact_lock(') > 0
     OR pg_catalog.strpos(record_source, 'INSERT INTO') > 0
     OR pg_catalog.strpos(record_source, 'UPDATE ') > 0
     OR pg_catalog.strpos(record_source, 'DELETE FROM') > 0 THEN
    RAISE EXCEPTION
      'verify_failed: write-quiescence bridge body drifted';
  END IF;

  IF pg_catalog.obj_description(record_rpc, 'pg_proc') IS DISTINCT FROM
       'Temporary DB239 write-quiescence bridge: recent same-hash calls remain no-op; every physical fingerprint write is deferred with PT429 until the bounded limiter is installed after predecessor drain.'
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
      'verify_failed: write-quiescence bridge ACL/comment drifted';
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
       AND relation.relreplident = 'd'
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = 'postgres'
       AND (role.rolsuper OR role.rolbypassrls)
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_namespace AS namespace
     WHERE namespace.oid = pg_catalog.to_regnamespace('private')
       AND namespace.nspowner = pg_catalog.to_regrole('postgres')::oid
  ) OR (
    SELECT pg_catalog.count(*)
      FROM private.device_fingerprint_churn_cutover AS cutover
     WHERE cutover.singleton
       AND cutover.predecessor_function_md5 =
           '2dad1c8a6d06046f5588f571cfb4cd3e'
  ) <> 1 OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policies AS policy
     WHERE policy.schemaname = 'private'
       AND policy.tablename = 'device_fingerprint_churn_cutover'
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
  ) OR pg_catalog.has_table_privilege(
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
     ) OR pg_catalog.to_regclass(
       'private.device_fingerprint_rate_limits'
     ) IS NOT NULL OR EXISTS (
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
      'verify_failed: cutover gate, ACL, or final-limiter absence drifted';
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
      'verify_failed: fingerprint mutation/constraint/RLS surface drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.device_fingerprints AS fingerprint
     GROUP BY fingerprint.profile_id
    HAVING pg_catalog.count(*) > 20
  ) THEN
    RAISE EXCEPTION
      'verify_failed: fingerprint profile remains above cap';
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
      '20260811140018',
      'bound_device_fingerprint_churn',
      '20260811140018_bound_device_fingerprint_churn';

  IF migration_identity_count <> 1 OR migration_valid_count <> 1 THEN
    RAISE EXCEPTION
      'verify_failed: expected one valid bridge ledger row, found identity %, valid %',
      migration_identity_count,
      migration_valid_count;
  END IF;
END;
$verify$;

WITH per_profile AS (
  SELECT fingerprint.profile_id, pg_catalog.count(*)::integer AS row_count
    FROM public.device_fingerprints AS fingerprint
   GROUP BY fingerprint.profile_id
), activity AS (
  SELECT pg_catalog.count(*) AS active_rpc_rows
    FROM pg_catalog.pg_stat_activity AS activity_row
   WHERE activity_row.datname = pg_catalog.current_database()
     AND activity_row.pid <> pg_catalog.pg_backend_pid()
     AND activity_row.backend_type = 'client backend'
     AND activity_row.state IS DISTINCT FROM 'idle'
     AND activity_row.query ~* 'record_fingerprint'
), advisory AS (
  SELECT pg_catalog.count(*) AS matching_advisory_rows
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
)
SELECT
  pg_catalog.statement_timestamp() AS captured_at,
  cutover.bridge_installed_at,
  EXTRACT(
    epoch FROM pg_catalog.clock_timestamp() - cutover.bridge_installed_at
  )::bigint AS bridge_age_seconds,
  activity.active_rpc_rows,
  advisory.matching_advisory_rows,
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
  sequence_state.last_value AS fingerprint_sequence_last_value,
  sequence_state.is_called AS fingerprint_sequence_is_called,
  pg_catalog.md5(routine.prosrc) AS bridge_function_md5
FROM private.device_fingerprint_churn_cutover AS cutover
CROSS JOIN pg_catalog.pg_proc AS routine
CROSS JOIN public.device_fingerprints_id_seq AS sequence_state
CROSS JOIN activity
CROSS JOIN advisory
WHERE cutover.singleton
  AND routine.oid =
      'public.record_fingerprint(text,text)'::pg_catalog.regprocedure;

ROLLBACK;
