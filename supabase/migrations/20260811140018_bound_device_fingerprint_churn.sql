-- Phase 1 of the fingerprint-churn hardening.
--
-- This bridge makes every would-be physical fingerprint write fail fast with
-- HTTP 429 while preserving the recent-same-hash no-op. It creates a clean
-- drain boundary before the later limiter table/function migration: once this
-- migration has committed, wait for the predecessor statement-timeout window
-- and prove no per-profile predecessor advisory lock remains before applying
-- 20260811143207. The official ledger-aware endpoint owns the transaction;
-- do not add top-level BEGIN/COMMIT here.

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
  IF current_user <> 'postgres' OR record_rpc IS NULL THEN
    RAISE EXCEPTION
      'migration_precheck_failed: postgres operator or record_fingerprint missing';
  END IF;

  IF pg_catalog.to_regclass('public.device_fingerprints') IS NULL
     OR pg_catalog.to_regclass('public.profiles') IS NULL
     OR pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NULL
     OR pg_catalog.to_regnamespace('private') IS NULL THEN
    RAISE EXCEPTION
      'migration_precheck_failed: fingerprint, private schema, or ledger prerequisite missing';
  END IF;

  IF pg_catalog.to_regclass('private.device_fingerprint_rate_limits')
       IS NOT NULL
     OR pg_catalog.to_regclass('private.device_fingerprint_churn_cutover')
       IS NOT NULL THEN
    RAISE EXCEPTION
      'migration_precheck_failed: fingerprint churn target relation already exists';
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
  ) <> 1 OR NOT EXISTS (
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
       AND routine.proconfig = ARRAY['search_path=pg_catalog']::text[]
       AND EXISTS (
         SELECT 1
           FROM pg_catalog.pg_language AS language
          WHERE language.oid = routine.prolang
            AND language.lanname = 'plpgsql'
       )
       AND pg_catalog.md5(routine.prosrc) =
           '2dad1c8a6d06046f5588f571cfb4cd3e'
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
      'migration_precheck_failed: fingerprint mutation/constraint/RLS surface drifted';
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
      '20260808040313',
      'evict_oldest_device_fingerprint_instead_of_failing',
      '20260808040313_evict_oldest_device_fingerprint_instead_of_failing',
      '20260811140018',
      'bound_device_fingerprint_churn',
      '20260811140018_bound_device_fingerprint_churn';

  IF predecessor_identity_count <> 1 OR predecessor_valid_count <> 1 THEN
    RAISE EXCEPTION
      'migration_precheck_failed: expected one valid eviction predecessor ledger row, found identity %, valid %',
      predecessor_identity_count,
      predecessor_valid_count;
  END IF;
  IF target_identity_count <> 0 THEN
    RAISE EXCEPTION
      'migration_precheck_failed: quiescence bridge ledger identity already exists % time(s)',
      target_identity_count;
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

CREATE TABLE private.device_fingerprint_churn_cutover (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  bridge_installed_at timestamptz NOT NULL,
  predecessor_function_md5 text NOT NULL CHECK (
    predecessor_function_md5 ~ '^[0-9a-f]{32}$'
  )
);

ALTER TABLE private.device_fingerprint_churn_cutover OWNER TO postgres;
ALTER TABLE private.device_fingerprint_churn_cutover ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.device_fingerprint_churn_cutover FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.device_fingerprint_churn_cutover
  FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO private.device_fingerprint_churn_cutover (
  singleton,
  bridge_installed_at,
  predecessor_function_md5
) VALUES (
  true,
  pg_catalog.statement_timestamp(),
  '2dad1c8a6d06046f5588f571cfb4cd3e'
);

COMMENT ON TABLE private.device_fingerprint_churn_cutover IS
  'Single-use DB239 drain gate. The final limiter migration may proceed only after this bridge age exceeds the remote statement window and no predecessor per-profile advisory lock remains.';

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
  observed_at timestamptz := pg_catalog.statement_timestamp();
  existing_last_seen timestamptz;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'not_authenticated';
  END IF;

  cleaned_hash := pg_catalog.btrim(COALESCE(fp_hash_in, ''));
  IF cleaned_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_fingerprint';
  END IF;

  IF NOT pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended(caller_id::text, 0)
  ) THEN
    RAISE SQLSTATE 'PT429' USING MESSAGE = 'fingerprint_busy';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.profiles AS profile
     WHERE profile.id = caller_id
  ) THEN
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

  RAISE SQLSTATE 'PT429' USING MESSAGE = 'fingerprint_write_deferred';
END
$function$;

ALTER FUNCTION public.record_fingerprint(text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_fingerprint(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_fingerprint(text, text)
  TO authenticated;

COMMENT ON FUNCTION public.record_fingerprint(text, text) IS
  'Temporary DB239 write-quiescence bridge: recent same-hash calls remain no-op; every physical fingerprint write is deferred with PT429 until the bounded limiter is installed after predecessor drain.';

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
     AND routine.proconfig = ARRAY['search_path=pg_catalog']::text[]
     AND pg_catalog.md5(routine.prosrc) =
         '36b7cda577e25ba6fb36c46a7557b496'
     AND EXISTS (
       SELECT 1
         FROM pg_catalog.pg_language AS language
        WHERE language.oid = routine.prolang
          AND language.lanname = 'plpgsql'
     );

  IF record_source IS NULL
     OR pg_catalog.strpos(record_source, 'pg_try_advisory_xact_lock') = 0
     OR pg_catalog.strpos(record_source, 'fingerprint_write_deferred') = 0
     OR pg_catalog.strpos(record_source, 'pg_advisory_xact_lock(') > 0
     OR pg_catalog.strpos(record_source, 'INSERT INTO') > 0
     OR pg_catalog.strpos(record_source, 'UPDATE ') > 0
     OR pg_catalog.strpos(record_source, 'DELETE FROM') > 0 THEN
    RAISE EXCEPTION
      'migration_postcheck_failed: write-quiescence bridge body drifted';
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
      'migration_postcheck_failed: write-quiescence bridge ACL drifted';
  END IF;

  IF pg_catalog.obj_description(record_rpc, 'pg_proc') IS DISTINCT FROM
       'Temporary DB239 write-quiescence bridge: recent same-hash calls remain no-op; every physical fingerprint write is deferred with PT429 until the bounded limiter is installed after predecessor drain.'
     OR pg_catalog.to_regclass('private.device_fingerprint_rate_limits')
          IS NOT NULL
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_roles AS role
        WHERE role.rolname = 'postgres'
          AND (role.rolsuper OR role.rolbypassrls)
     )
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_namespace AS namespace
        WHERE namespace.oid = pg_catalog.to_regnamespace('private')
          AND namespace.nspowner = pg_catalog.to_regrole('postgres')::oid
     )
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_class AS relation
        WHERE relation.oid =
              'private.device_fingerprint_churn_cutover'::pg_catalog.regclass
          AND relation.relowner = pg_catalog.to_regrole('postgres')::oid
          AND relation.relkind = 'r'
          AND relation.relpersistence = 'p'
          AND relation.relrowsecurity
          AND relation.relforcerowsecurity
     )
     OR (
       SELECT pg_catalog.count(*)
         FROM private.device_fingerprint_churn_cutover AS cutover
        WHERE cutover.singleton
          AND cutover.predecessor_function_md5 =
              '2dad1c8a6d06046f5588f571cfb4cd3e'
     ) <> 1
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_publication_rel AS publication_relation
        WHERE publication_relation.prrelid =
              'private.device_fingerprint_churn_cutover'::pg_catalog.regclass
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
              'private'::pg_catalog.regnamespace
     )
     OR pg_catalog.has_table_privilege(
       'anon',
       'private.device_fingerprint_churn_cutover',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     OR pg_catalog.has_table_privilege(
       'authenticated',
       'private.device_fingerprint_churn_cutover',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     OR pg_catalog.has_table_privilege(
       'service_role',
       'private.device_fingerprint_churn_cutover',
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
              'private.device_fingerprint_churn_cutover'::pg_catalog.regclass
          AND (
            table_acl.grantor <> pg_catalog.to_regrole('postgres')::oid
            OR table_acl.grantee <> pg_catalog.to_regrole('postgres')::oid
            OR table_acl.is_grantable
          )
     )
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_attribute AS attribute
        WHERE attribute.attrelid =
              'private.device_fingerprint_churn_cutover'::pg_catalog.regclass
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
          AND attribute.attacl IS NOT NULL
     ) THEN
    RAISE EXCEPTION
      'migration_postcheck_failed: bridge comment, cutover gate, or ACL drifted';
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
END;
$migration_postcheck$;
