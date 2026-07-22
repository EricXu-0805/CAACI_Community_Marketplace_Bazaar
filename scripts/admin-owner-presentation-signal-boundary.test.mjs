import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationName =
  '20260722161200_protect_admin_owner_presentation_signal.sql'
const source = relative => readFile(new URL(relative, import.meta.url), 'utf8')

test('forward migration extends the owner guard to last_used_at without rewriting its function', async () => {
  const migration = await source(`../supabase/migrations/${migrationName}`)
  assert.match(migration, /pg_advisory_xact_lock\(20260718180000::bigint\)/)
  assert.match(migration, /pg_advisory_xact_lock\(20260718190000::bigint\)/)
  assert.match(migration, /LOCK TABLE public\.admin_tokens IN SHARE ROW EXCLUSIVE MODE/)
  assert.match(
    migration,
    /CREATE TRIGGER admin_tokens_protect_recovery\s+BEFORE UPDATE OF admin_id, revoked_at, expires_at, last_used_at, role OR DELETE\s+ON public\.admin_tokens\s+FOR EACH ROW\s+EXECUTE FUNCTION public\.admin_protect_recovery_tokens\(\)/,
  )
  assert.doesNotMatch(
    migration,
    /CREATE OR REPLACE FUNCTION public\.admin_protect_recovery_tokens/,
  )
})

test('production ops enforce predecessor ledger identity, exact topology, and rollback-only behavior', async () => {
  const [precheck, verify, predecessorVerify, regression, runbook] = await Promise.all([
    source('../supabase/_ops/PRECHECK_20260722161200_protect_admin_owner_presentation_signal.sql'),
    source('../supabase/_ops/VERIFY_20260722161200_protect_admin_owner_presentation_signal.sql'),
    source('../supabase/_ops/VERIFY_20260722145042_harden_last_active_owner_revoke.sql'),
    source('../supabase/_ops/REGRESSION_20260722161200_protect_admin_owner_presentation_signal.sql'),
    source('../RUNBOOK.md'),
  ])

  assert.match(precheck, /SET TRANSACTION READ ONLY/)
  assert.match(precheck, /pg_try_advisory_xact_lock\(20260718180000/)
  assert.match(precheck, /pg_try_advisory_xact_lock\(20260718190000/)
  assert.match(precheck, /20260722145042_harden_last_active_owner_revoke/)
  assert.match(precheck, /20260722152000_harden_admin_invalid_auth_amplification/)
  assert.match(precheck, /version = \$5 OR name = \$6/)
  assert.match(precheck, /expected predecessor trigger topology drifted/)

  assert.match(verify, /SET TRANSACTION READ ONLY/)
  assert.match(verify, /last_used_at owner recovery trigger topology drifted/)
  assert.match(verify, /migration_record_count <> 1/)
  assert.match(verify, /version = \$1 OR name = \$2/)
  assert.match(
    predecessorVerify,
    /UPDATE OF admin_id, revoked_at, expires_at, last_used_at, role ON public\.admin_tokens/,
  )

  assert.match(regression, /NEVER run against production/)
  assert.match(regression, /last recoverable owner presentation signal was cleared/)
  assert.match(regression, /refused presentation clear changed final recoverable owner state/)
  assert.match(regression, /recoverable replacement did not allow presentation-signal clear/)
  assert.doesNotMatch(regression, /\bCOMMIT\b/)
  assert.match(regression.trimEnd(), /ROLLBACK;$/)

  assert.match(
    runbook,
    /145042[^]*152000[^]*161200[^]*PRECHECK_20260722161200_protect_admin_owner_presentation_signal\.sql/,
  )
})

test('migration manifest pins the forward-only presentation-signal repair', async () => {
  const [migration, manifest] = await Promise.all([
    readFile(new URL(`../supabase/migrations/${migrationName}`, import.meta.url)),
    source('../supabase/migrations/manifest.sha256'),
  ])
  const hash = createHash('sha256').update(migration).digest('hex')
  assert.match(
    manifest,
    new RegExp(`^${hash}  ${migrationName.replace('.', '\\.')}$`, 'm'),
  )
})
