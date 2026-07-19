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
}

test('Realtime migration authorizes only conversation members on exact private features', async () => {
  const migration = await source(files.migration)
  assert.match(migration, /ALTER TABLE realtime\.messages ENABLE ROW LEVEL SECURITY/)
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
  assert.match(migration, /unexpected realtime\.messages policies/)
  assert.match(migration, /policy\.policyname NOT IN/)
  assert.doesNotMatch(migration, /CREATE (?:SCHEMA|TABLE|FUNCTION) (?:IF NOT EXISTS )?realtime\./i)
})

test('operations bundle separates read-only gates from rolled-back behavior', async () => {
  const [precheck, verify, regression, bootstrap] = await Promise.all([
    source(files.precheck),
    source(files.verify),
    source(files.regression),
    source(files.bootstrap),
  ])
  for (const readOnly of [precheck, verify]) {
    assert.doesNotMatch(
      readOnly,
      /^\s*(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE)\b/im,
    )
  }
  assert.match(verify, /roles IS DISTINCT FROM ARRAY\['authenticated'\]::name\[\]/)
  assert.match(verify, /has_table_privilege\('anon', 'realtime\.messages', 'SELECT'\)/)
  assert.match(regression, /^BEGIN;/m)
  assert.match(regression, /^ROLLBACK;/m)
  assert.match(regression, /non-member received Realtime rows/)
  assert.match(regression, /global topic exposed Realtime rows/)
  assert.match(regression, /blocked pair retained Realtime access/)
  assert.match(regression, /anon retained realtime\.messages SELECT/)
  assert.match(bootstrap, /LOCAL\/ISOLATED POSTGRESQL ONLY/)
  assert.match(bootstrap, /CREATE OR REPLACE FUNCTION realtime\.topic\(\)/)
})

test('all SQL blocks retain explicit END semicolons', async () => {
  for (const path of Object.values(files)) {
    const sql = await source(path)
    assert.doesNotMatch(sql, /\bEND\n\$[^$]+\$;/)
  }
})
