import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const root = new URL('../', import.meta.url)
const source = path => readFile(new URL(path, root), 'utf8')

const CAP_MIGRATION = 'supabase/migrations/20260718130000_harden_device_fingerprint_signal.sql'
const EVICT_MIGRATION = 'supabase/migrations/20260808040313_evict_oldest_device_fingerprint_instead_of_failing.sql'
const PRECHECK = 'supabase/_ops/PRECHECK_20260808040313_evict_oldest_device_fingerprint_instead_of_failing.sql'
const VERIFY = 'supabase/_ops/VERIFY_20260808040313_evict_oldest_device_fingerprint_instead_of_failing.sql'
const REGRESSION = 'supabase/_ops/REGRESSION_20260808040313_evict_oldest_device_fingerprint_instead_of_failing.sql'
const LOCAL_BOOTSTRAP = 'supabase/_ops/LOCAL_BOOTSTRAP_20260808040313_device_fingerprint_eviction.sql'
const OLD_REGRESSION = 'supabase/_ops/REGRESSION_20260718_harden_device_fingerprint_signal.sql'
const OLD_VERIFY = 'supabase/_ops/VERIFY_20260718_harden_device_fingerprint_signal.sql'

const [
  capMigration,
  evictMigration,
  precheck,
  verify,
  regression,
  localBootstrap,
  oldRegression,
  oldVerify,
  runbook,
  useAuth,
] = await Promise.all([
  source(CAP_MIGRATION),
  source(EVICT_MIGRATION),
  source(PRECHECK),
  source(VERIFY),
  source(REGRESSION),
  source(LOCAL_BOOTSTRAP),
  source(OLD_REGRESSION),
  source(OLD_VERIFY),
  source('RUNBOOK.md'),
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
  assert.match(body, /IF unique_hash_count > 20 THEN[\s\S]*fingerprint_cleanup_required/)
  assert.match(body, /ELSIF unique_hash_count = 20 THEN\s*\n\s*DELETE FROM public\.device_fingerprints/)
  // Least-recently-seen first, with a deterministic tiebreak.
  assert.match(body, /ORDER BY evict\.last_seen ASC, evict\.id ASC/)
  assert.match(body, /LIMIT 1/)

  // Eviction and insertion have to stay inside the same per-caller lock, or two
  // concurrent calls can each delete a row and each insert one.
  const lockAt = body.indexOf('pg_advisory_xact_lock')
  assert.ok(lockAt >= 0 && lockAt < body.indexOf('DELETE FROM public.device_fingerprints'))
})

test('the migration is atomic and cannot authorize bulk history cleanup', () => {
  const beforeFunction = evictMigration.slice(
    0,
    evictMigration.indexOf('CREATE OR REPLACE FUNCTION'),
  )
  assert.match(evictMigration, /BEGIN;[\s\S]*SET LOCAL lock_timeout = '5s'/)
  assert.match(evictMigration, /SET LOCAL statement_timeout = '60s'/)
  assert.match(evictMigration, /LOCK TABLE public\.device_fingerprints IN SHARE ROW EXCLUSIVE MODE/)
  assert.match(evictMigration, /migration_precheck_failed:[\s\S]*over-cap profile/)
  assert.match(evictMigration, /unexpected record_fingerprint overload surface/)
  assert.match(evictMigration, /pg_catalog\.count\(\*\) <> 2[\s\S]*function_acl\.is_grantable/)
  assert.match(evictMigration, /WHERE \(version = \$1 AND name = \$2\)/)
  assert.match(evictMigration, /version ~ ''\^\[0-9\]\{14\}\$''[\s\S]*name IN \(\$2, \$3\)/)
  assert.match(
    evictMigration,
    /predecessor_identity_count <> 1 OR predecessor_valid_count <> 1/,
  )
  assert.match(evictMigration, /ALTER FUNCTION public\.record_fingerprint\(text, text\) OWNER TO postgres/)
  assert.match(evictMigration, /REVOKE ALL ON FUNCTION public\.record_fingerprint\(text, text\)[\s\S]*GRANT EXECUTE/)
  assert.match(evictMigration, /migration_postcheck_failed:[\s\S]*COMMIT;/)
  assert.doesNotMatch(beforeFunction, /DELETE FROM public\.device_fingerprints/)
  assert.doesNotMatch(evictMigration, /PARTITION BY fingerprint\.profile_id/)
  assert.doesNotMatch(
    evictMigration,
    /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+auth\.sessions\b/i,
  )
})

test('the migration has read-only precheck, verify, and runtime regression companions', () => {
  assert.match(precheck, /\\set ON_ERROR_STOP on[\s\S]*BEGIN;[\s\S]*SET TRANSACTION READ ONLY;[\s\S]*ROLLBACK;/)
  assert.match(precheck, /0ed8f81e54a5316dd918b100b9369053/)
  assert.match(precheck, /over-cap profile\(s\) require separately approved cleanup/)
  assert.match(precheck, /20260808040313_evict_oldest_device_fingerprint_instead_of_failing/)
  assert.match(
    precheck,
    /predecessor_identity_count <> 1 OR predecessor_valid_count <> 1/,
  )
  assert.match(precheck, /fingerprint_rows_md5/)
  assert.match(precheck, /profile_rows_md5/)
  assert.match(precheck, /auth_session_rows_md5/)

  assert.match(verify, /\\set ON_ERROR_STOP on[\s\S]*BEGIN;[\s\S]*SET TRANSACTION READ ONLY;[\s\S]*ROLLBACK;/)
  assert.match(verify, /unique_hash_count > 20/)
  assert.match(verify, /fingerprint_cleanup_required/)
  assert.match(verify, /unique_hash_count = 20/)
  assert.match(verify, /2dad1c8a6d06046f5588f571cfb4cd3e/)
  assert.match(verify, /fingerprint_limit_reached[\s\S]*> 0/)
  assert.match(verify, /expected one exact target migration ledger row/)
  assert.match(verify, /migration_identity_count <> 1 OR migration_valid_count <> 1/)
  assert.match(
    verify,
    /constraint_row\.conkey = ARRAY\[[\s\S]*attname = 'profile_id'[\s\S]*attname = 'fp_hash'/,
  )
  assert.match(verify, /fingerprint_rows_md5/)
  assert.match(verify, /profile_rows_md5/)
  assert.match(verify, /auth_session_rows_md5/)

  assert.match(regression, /BEGIN;[\s\S]*public\.record_fingerprint[\s\S]*ROLLBACK;/)
  assert.match(regression, /least-recently-seen replacement was not exact/)
  assert.match(regression, /fingerprint_cleanup_required/)
  assert.match(regression, /fingerprint regression unexpectedly created Auth sessions/)
  assert.match(regression, /ON CONFLICT \(id\) DO UPDATE/)
  assert.match(regression, /disposable LOCAL PostgreSQL only/)
  assert.match(regression, /caaci\.local_fingerprint_regression/)
  assert.match(regression, /20260808040313-disposable-fingerprint-regression/)
  assert.match(regression, /explicit disposable-local marker required/)
  assert.doesNotMatch(regression, /fingerprint_limit_reached/)
  assert.doesNotMatch(
    regression,
    /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+auth\.sessions\b/i,
  )

  assert.match(localBootstrap, /CREATE TRIGGER on_auth_user_created[\s\S]*public\.handle_new_user/)

  // The timestamped predecessor companion must retain predecessor semantics so
  // an ordered replay can verify 20260718130000 before reaching this migration.
  assert.match(oldRegression, /twenty-first unique fingerprint accepted/)
  assert.match(oldRegression, /fingerprint_limit_reached/)
  assert.doesNotMatch(oldRegression, /twenty-first replaces oldest/)
  assert.match(oldVerify, /unique_hash_count >= 20/)
  assert.doesNotMatch(oldVerify, /fingerprint_cleanup_required/)
})

test('the runbook keeps staging apply, smoke, production cleanup, and sessions separate', () => {
  assert.match(runbook, /20260808040313[\s\S]*staging-smoke[\s\S]*hygkwxugskijadgfisji/)
  assert.match(runbook, /official[\s\S]*ledger-aware migrations endpoint/)
  assert.match(runbook, /pre\/post equality of all three counts and row-set digests/)
  assert.match(runbook, /do not automatically restore the old[\s\S]*obtain a new exact approval/)
  assert.match(runbook, /Production project ref `lfhvgprfphyfvhidegum` is out of scope/)
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
