import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const migrationUrl = new URL(
  '../supabase/migrations/20260718180000_atomic_admin_mutations.sql',
  import.meta.url,
)
const verifyUrl = new URL(
  '../supabase/_ops/VERIFY_20260718_atomic_admin_mutations.sql',
  import.meta.url,
)

test('best-effort audit logging never emits database error text', async () => {
  const [migration, verify] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(verifyUrl, 'utf8'),
  ])

  assert.doesNotMatch(migration, /\bSQLERRM\b/)
  assert.match(
    migration,
    /record_audit best-effort failure: event_kind=% sqlstate=%/,
  )
  assert.match(verify, /strpos\(audit_source, 'SQLERRM'\) <> 0/)
  assert.match(verify, /strpos\(audit_source, 'SQLSTATE'\) = 0/)
})

test('revoke guards preserve both self-revoke and last-active contracts', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const lastActive = migration.indexOf("MESSAGE = 'last_active_admin_token'")
  const selfRevoke = migration.indexOf("MESSAGE = 'self_revoke_forbidden'")

  assert.notEqual(lastActive, -1)
  assert.notEqual(selfRevoke, -1)
  assert.ok(
    lastActive < selfRevoke,
    'last-active protection must run before the self-revoke sentinel',
  )
})
