import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const source = path => readFile(new URL(path, root), 'utf8')

const files = {
  migration: 'supabase/migrations/20260718240000_private_conversation_realtime.sql',
  precheck: 'supabase/_ops/PRECHECK_20260718_private_conversation_realtime.sql',
  verify: 'supabase/_ops/VERIFY_20260718_private_conversation_realtime.sql',
  regression: 'supabase/_ops/REGRESSION_20260718_private_conversation_realtime.sql',
  bootstrap: 'supabase/_ops/LOCAL_BOOTSTRAP_20260718_private_conversation_realtime.sql',
  forwardMigration: 'supabase/migrations/20260719164126_reconcile_managed_realtime_authorization_contract.sql',
  forwardPrecheck: 'supabase/_ops/PRECHECK_20260719164126_reconcile_managed_realtime_authorization_contract.sql',
  forwardVerify: 'supabase/_ops/VERIFY_20260719164126_reconcile_managed_realtime_authorization_contract.sql',
  forwardRegression: 'supabase/_ops/REGRESSION_20260719164126_reconcile_managed_realtime_authorization_contract.sql',
}

test('Realtime migration authorizes only conversation members on exact private features', async () => {
  const migration = await source(files.migration)
  assert.match(migration, /relation\.relrowsecurity/)
  assert.match(migration, /managed-schema owner intervention required/)
  assert.doesNotMatch(migration, /ALTER TABLE realtime\.messages ENABLE ROW LEVEL SECURITY/)
  assert.match(migration, /REVOKE ALL ON TABLE realtime\.messages FROM PUBLIC, anon, authenticated/)
  assert.match(migration, /GRANT SELECT, INSERT ON TABLE realtime\.messages TO authenticated/)
  assert.match(migration, /FOR SELECT\s+TO authenticated\s+USING/)
  assert.match(migration, /FOR INSERT\s+TO authenticated\s+WITH CHECK/)
  assert.equal((migration.match(/realtime\.messages\.extension IN \('broadcast', 'presence'\)/g) || []).length, 2)
  assert.equal((migration.match(/\(SELECT realtime\.topic\(\)\)/g) || []).length, 4)
  assert.equal((migration.match(/\(SELECT auth\.uid\(\)\) IN/g) || []).length, 2)
  assert.equal((migration.match(/private\.current_user_can_access_pair\(/g) || []).length, 4)
  assert.match(migration, /has_function_privilege\([\s\S]*?'authenticated'[\s\S]*?'private\.current_user_can_access_pair\(uuid,uuid\)'[\s\S]*?'EXECUTE'/)
  for (const sourceTable of ['messages', 'offers', 'meetups', 'notifications']) {
    assert.match(migration, new RegExp(`'${sourceTable}'`))
  }
  assert.match(migration, /publication\.pubname = 'supabase_realtime'/)
  assert.match(migration, /policy\.polcmd IN \('r', '\*'\)/)
  assert.doesNotMatch(migration, /extension IN \([^)]*postgres_changes/i)
  assert.doesNotMatch(migration, /TO anon/)
  assert.doesNotMatch(migration, /USING\s*\(\s*true\s*\)/i)
  assert.doesNotMatch(migration, /WITH CHECK\s*\(\s*true\s*\)/i)
})

test('migration fails closed on managed-schema or permissive-policy drift', async () => {
  const migration = await source(files.migration)
  assert.match(migration, /to_regclass\('realtime\.messages'\) IS NULL/)
  assert.match(migration, /to_regprocedure\('realtime\.topic\(\)'\) IS NULL/)
  assert.match(migration, /relation\.oid = pg_catalog\.to_regclass\('realtime\.messages'\)[\s\S]*?relation\.relrowsecurity/)
  assert.match(migration, /unexpected realtime\.messages policies/)
  assert.match(migration, /policy\.policyname NOT IN/)
  assert.doesNotMatch(migration, /CREATE (?:SCHEMA|TABLE|FUNCTION) (?:IF NOT EXISTS )?realtime\./i)
})

test('operations bundle separates read-only gates from rolled-back behavior', async () => {
  const [precheck, verify, regression, bootstrap, forwardPrecheck, forwardVerify] = await Promise.all([
    source(files.precheck),
    source(files.verify),
    source(files.regression),
    source(files.bootstrap),
    source(files.forwardPrecheck),
    source(files.forwardVerify),
  ])
  for (const readOnly of [precheck, verify, forwardPrecheck, forwardVerify]) {
    assert.doesNotMatch(
      readOnly,
      /^\s*(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE)\b/im,
    )
    assert.match(readOnly, /relation\.relrowsecurity/)
  }
  for (const legacyOperation of [precheck, verify]) {
    assert.match(legacyOperation, /managed-schema owner intervention required/)
  }
  assert.match(verify, /roles IS DISTINCT FROM ARRAY\['authenticated'\]::name\[\]/)
  assert.doesNotMatch(
    verify,
    /has_table_privilege\('anon', 'realtime\.messages', 'SELECT'\)/,
  )
  assert.match(verify, /owner-issued S\/I\/U/)
  assert.match(verify, /managed realtime\.messages direct ACL provenance drift/)
  assert.match(regression, /^BEGIN;/m)
  assert.match(regression, /^ROLLBACK;/m)
  assert.match(regression, /non-member received Realtime rows/)
  assert.match(regression, /global topic exposed Realtime rows/)
  assert.match(regression, /blocked pair retained Realtime access/)
  assert.match(regression, /anon received managed Realtime rows/)
  assert.match(bootstrap, /LOCAL\/ISOLATED POSTGRESQL ONLY/)
  assert.match(bootstrap, /CREATE OR REPLACE FUNCTION realtime\.topic\(\)/)
})

test('forward reconciliation owns exact policies but never rewrites managed table ACLs', async () => {
  const [migration, precheck, verify, regression] = await Promise.all([
    source(files.forwardMigration),
    source(files.forwardPrecheck),
    source(files.forwardVerify),
    source(files.forwardRegression),
  ])

  assert.doesNotMatch(migration, /^\s*(?:GRANT|REVOKE)\b/im)
  assert.doesNotMatch(migration, /aclexplode\(\s*COALESCE/i)
  assert.equal(
    (migration.match(/CREATE POLICY "Conversation participants can /g) || []).length,
    2,
  )
  assert.match(migration, /FOR SELECT\s+TO authenticated\s+USING/)
  assert.match(migration, /FOR INSERT\s+TO authenticated\s+WITH CHECK/)
  assert.equal(
    (migration.match(/realtime\.messages\.extension IN \('broadcast', 'presence'\)/g) || []).length,
    2,
  )
  assert.match(migration, /managed_realtime_exact_policy_set_drift/)
  assert.match(migration, /managed_realtime_exact_policy_predicate_drift/)
  assert.match(migration, /pg_catalog\.aclexplode\(relation\.relacl\)/)
  assert.match(migration, /attribute\.attacl IS NOT NULL/)
  assert.match(migration, /acl\.grantor <> owner_oid/)
  assert.match(migration, /acl\.is_grantable/)
  assert.match(migration, /acl\.privilege_type NOT IN \('SELECT', 'INSERT', 'UPDATE'\)/)
  assert.match(migration, /pg_catalog\.pg_has_role\(api_role\.oid, owner_oid, 'MEMBER'\)/)
  assert.match(migration, /api_role\.rolbypassrls/)
  assert.match(migration, /owner_name NOT IN \('supabase_admin', 'supabase_realtime_admin'\)/)
  assert.match(migration, /current_setting\('server_version_num'\)/)
  assert.match(migration, /'MAINTAIN'/)
  assert.match(migration, /expected_predicate constant text/)
  assert.match(migration, /ARRAY\['broadcast'::text,'presence'::text\]/)
  assert.match(
    migration,
    /current_user_can_access_pair\(conversation\.buyer_id,conversation\.seller_id\)/,
  )
  assert.match(migration, /regexp_replace\([\s\S]*?receive_qual[\s\S]*?IS DISTINCT FROM expected_predicate/)
  assert.match(migration, /regexp_replace\([\s\S]*?send_check[\s\S]*?IS DISTINCT FROM expected_predicate/)
  assert.doesNotMatch(migration, /regexp_count\(receive_qual/)

  for (const operation of [migration, precheck, verify]) {
    for (const column of ['id', 'buyer_id', 'seller_id']) {
      assert.match(
        operation,
        new RegExp(
          `has_column_privilege\\([\\s\\S]*?'authenticated'[\\s\\S]*?'public\\.conversations'[\\s\\S]*?'${column}'[\\s\\S]*?'SELECT'`,
        ),
      )
    }
    for (const schema of ['realtime', 'auth', 'public', 'private']) {
      assert.match(
        operation,
        new RegExp(
          `has_schema_privilege\\([\\s\\S]*?'authenticated'[\\s\\S]*?'${schema}'[\\s\\S]*?'USAGE'`,
        ),
      )
    }
    for (const signature of [
      'realtime\\.topic\\(\\)',
      'auth\\.uid\\(\\)',
      'private\\.current_user_can_access_pair\\(uuid,uuid\\)',
    ]) {
      assert.match(
        operation,
        new RegExp(
          `has_function_privilege\\([\\s\\S]*?'authenticated'[\\s\\S]*?'${signature}'[\\s\\S]*?'EXECUTE'`,
        ),
      )
    }
  }

  for (const operation of [precheck, verify]) {
    assert.match(operation, /authenticated managed Realtime base grants/)
    assert.match(operation, /direct ACL provenance drift/)
    assert.match(operation, /column ACL drift/)
    assert.match(operation, /MAINTAIN/)
    assert.doesNotMatch(operation, /aclexplode\(\s*COALESCE/i)
  }

  assert.match(regression, /LOCAL\/ISOLATED POSTGRESQL ONLY/)
  assert.match(regression, /anon saw managed Realtime rows/)
  assert.match(regression, /authenticated UPDATE escaped policy boundary/)
  assert.match(regression, /PUBLIC ACL fixture escaped detection/)
  assert.match(regression, /grant-option fixture escaped detection/)
  assert.match(regression, /inherited ACL fixture escaped detection/)
  assert.match(regression, /unknown grantor fixture escaped detection/)
  assert.match(regression, /column ACL fixture escaped detection/)
  assert.match(regression, /MAINTAIN ACL fixture escaped detection/)
  assert.match(regression, /conversation dependency revoke escaped detection/)
  assert.match(regression, /realtime schema revoke escaped detection/)
  assert.match(regression, /auth schema revoke escaped detection/)
  assert.match(regression, /public schema revoke escaped detection/)
  assert.match(regression, /private schema revoke escaped detection/)
  assert.match(regression, /topic execute revoke escaped detection/)
  assert.match(regression, /uid execute revoke escaped detection/)
  assert.match(regression, /helper execute revoke escaped detection/)
  assert.match(regression, /^ROLLBACK;$/m)
})

test('all SQL blocks retain explicit END semicolons', async () => {
  for (const path of Object.values(files)) {
    const sql = await source(path)
    assert.doesNotMatch(sql, /\bEND\n\$[^$]+\$;/)
  }
})
