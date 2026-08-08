import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const root = new URL('../', import.meta.url)
const source = path => readFile(new URL(path, root), 'utf8')

const CAP_MIGRATION = 'supabase/migrations/20260718130000_harden_device_fingerprint_signal.sql'
const EVICT_MIGRATION = 'supabase/migrations/20260808040313_evict_oldest_device_fingerprint_instead_of_failing.sql'

const [capMigration, evictMigration, useAuth] = await Promise.all([
  source(CAP_MIGRATION),
  source(EVICT_MIGRATION),
  source('app/src/composables/useAuth.ts'),
])

/**
 * Body of the last CREATE OR REPLACE of record_fingerprint in a migration.
 */
function recordFingerprintBody(sql) {
  const start = sql.lastIndexOf('CREATE OR REPLACE FUNCTION public.record_fingerprint')
  assert.ok(start >= 0, 'record_fingerprint is not defined here')
  return sql.slice(start, sql.indexOf('$function$;', start))
}

test('the fingerprint cap evicts rather than raising', () => {
  // The old behaviour, kept here so the regression is named: ERRCODE 54000
  // leaves PostgREST no choice but HTTP 500, and the profile then recorded
  // nothing ever again — the signal froze for the accounts it exists to review.
  assert.match(recordFingerprintBody(capMigration), /fingerprint_limit_reached/)

  const body = recordFingerprintBody(evictMigration)
  assert.doesNotMatch(body, /fingerprint_limit_reached/)
  assert.doesNotMatch(body, /54000/)
  assert.match(body, /IF unique_hash_count >= 20 THEN\s*\n\s*DELETE FROM public\.device_fingerprints/)
  // Least-recently-seen first, with a deterministic tiebreak.
  assert.match(body, /ORDER BY evict\.last_seen ASC, evict\.id ASC/)
  // Converges a profile already over the cap instead of only ever dropping one.
  assert.match(body, /LIMIT \(unique_hash_count - 19\)/)

  // Eviction and insertion have to stay inside the same per-caller lock, or two
  // concurrent calls can each delete a row and each insert one.
  const lockAt = body.indexOf('pg_advisory_xact_lock')
  assert.ok(lockAt >= 0 && lockAt < body.indexOf('DELETE FROM public.device_fingerprints'))
})

test('the one-time convergence is in the migration, not in a user request', () => {
  // A profile sitting at 168 rows would otherwise have 149 of them deleted by
  // whichever sign-in happened to be next.
  const cleanup = evictMigration.slice(0, evictMigration.indexOf('CREATE OR REPLACE FUNCTION'))
  assert.match(cleanup, /DELETE FROM public\.device_fingerprints/)
  assert.match(cleanup, /PARTITION BY fingerprint\.profile_id/)
  assert.match(cleanup, /ORDER BY fingerprint\.last_seen DESC/)
  assert.match(cleanup, /WHERE ranked\.recency > 20/)
})

test('a rejected fingerprint write is reported, not dropped on the floor', () => {
  const start = useAuth.indexOf('async function recordFingerprint()')
  const body = useAuth.slice(start, useAuth.indexOf('\n  async function', start + 1))
  // supabase.rpc resolves with { error }; it does not throw. Awaiting it bare
  // meant the surrounding try/catch never saw a server-side failure at all.
  assert.match(body, /const \{ error \} = await supabase\.rpc\('record_fingerprint'/)
  assert.match(body, /if \(error\)[\s\S]*captureException\(error, \{ tags: \{ source: 'auth-record-fingerprint' \} \}\)/)
  assert.match(body, /catch \(err\)[\s\S]*captureException\(err, \{ tags: \{ source: 'auth-record-fingerprint' \} \}\)/)
})
