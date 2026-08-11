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
const BRIDGE_MIGRATION = 'supabase/migrations/20260811140018_bound_device_fingerprint_churn.sql'
const LIMITER_MIGRATION = 'supabase/migrations/20260811143207_install_device_fingerprint_churn_limiter.sql'
const BRIDGE_PRECHECK = 'supabase/_ops/PRECHECK_20260811140018_bound_device_fingerprint_churn.sql'
const BRIDGE_VERIFY = 'supabase/_ops/VERIFY_20260811140018_bound_device_fingerprint_churn.sql'
const BRIDGE_REGRESSION = 'supabase/_ops/REGRESSION_20260811140018_bound_device_fingerprint_churn.sql'
const BRIDGE_BOOTSTRAP = 'supabase/_ops/LOCAL_BOOTSTRAP_20260811140018_device_fingerprint_churn.sql'
const LIMITER_PRECHECK = 'supabase/_ops/PRECHECK_20260811143207_install_device_fingerprint_churn_limiter.sql'
const LIMITER_VERIFY = 'supabase/_ops/VERIFY_20260811143207_install_device_fingerprint_churn_limiter.sql'
const LIMITER_REGRESSION = 'supabase/_ops/REGRESSION_20260811143207_install_device_fingerprint_churn_limiter.sql'
const LIMITER_BOOTSTRAP = 'supabase/_ops/LOCAL_BOOTSTRAP_20260811143207_device_fingerprint_churn_limiter.sql'

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
  operationsReadme,
  useAuth,
  fingerprintUtil,
  bridgeMigration,
  limiterMigration,
  bridgePrecheck,
  bridgeVerify,
  bridgeRegression,
  bridgeBootstrap,
  limiterPrecheck,
  limiterVerify,
  limiterRegression,
  limiterBootstrap,
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
  source('supabase/_ops/README.md'),
  source('app/src/composables/useAuth.ts'),
  source('app/src/utils/fingerprint.ts'),
  source(BRIDGE_MIGRATION),
  source(LIMITER_MIGRATION),
  source(BRIDGE_PRECHECK),
  source(BRIDGE_VERIFY),
  source(BRIDGE_REGRESSION),
  source(BRIDGE_BOOTSTRAP),
  source(LIMITER_PRECHECK),
  source(LIMITER_VERIFY),
  source(LIMITER_REGRESSION),
  source(LIMITER_BOOTSTRAP),
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
  assert.match(runbook, /At the time of DB239-S1 approval[\s\S]*`lfhvgprfphyfvhidegum` was out of scope/)
  assert.match(runbook, /20260811140018_bound_device_fingerprint_churn\.sql[\s\S]*Wait at least 65 seconds/)
  assert.match(runbook, /PRECHECK_20260811143207_install_device_fingerprint_churn_limiter\.sql[\s\S]*twice,[\s\S]*five seconds apart/)
  assert.match(runbook, /active_rpc_rows = 0[\s\S]*matching_advisory_rows = 0/)
  for (const operatorGuide of [runbook, operationsReadme]) {
    assert.match(operatorGuide, /operator-controlled browser\/smoke/)
    assert.match(operatorGuide, /not (?:a claim|evidence) that an already-distributed (?:browser or mini-program|client) (?:can|has been)[\s\S]*remotely recall/)
    assert.match(operatorGuide, /bridge commit[\s\S]*authoritative server-side pause[\s\S]*point/)
    assert.match(operatorGuide, /protected-data[\s\S]*digests and sequence/)
    assert.match(operatorGuide, /twice[\s\S]*five seconds apart/)
    assert.match(operatorGuide, /independent VERIFY[\s\S]*resume/i)
    assert.match(operatorGuide, /apparently benign digest drift[\s\S]*(?:HOLD|waiver)/)
    assert.match(operatorGuide, /If the bridge committed, preserve[\s\S]*safe HOLD state; do not retry/)
  }
  assert.match(runbook, /Staging and production each need their own exact[\s\S]*approval/)
  assert.match(operationsReadme, /Staging and production require separate exact[\s\S]*approvals/)
  assert.doesNotMatch(runbook, /First pause browser fingerprint calls plus all service\/admin direct writes/)
  assert.match(runbook, /Hosted REGRESSION and[\s\S]*LOCAL_BOOTSTRAP are forbidden/)
})

test('a rejected fingerprint write is reported, not dropped on the floor', () => {
  const start = useAuth.indexOf('async function recordFingerprint()')
  const body = useAuth.slice(start, useAuth.indexOf('\n  async function', start + 1))
  // supabase.rpc resolves with { error }; it does not throw. Awaiting it bare
  // meant the surrounding try/catch never saw a server-side failure at all.
  assert.match(body, /const response = await supabase[\s\S]*\.rpc\('record_fingerprint'/)
  assert.match(body, /\.retry\(false\)/)
  assert.match(body, /isExpectedFingerprintDeferral\(response\)/)
  assert.match(body, /if \(response\.error\)[\s\S]*captureException\(response\.error, \{ tags: \{ source: 'auth-record-fingerprint' \} \}\)/)
  assert.match(body, /catch \(err\)[\s\S]*captureException\(err, \{ tags: \{ source: 'auth-record-fingerprint' \} \}\)/)
  assert.doesNotMatch(useAuth, /await recordFingerprint\(/)

  for (const message of [
    'fingerprint_busy',
    'fingerprint_write_deferred',
    'fingerprint_rate_limited',
  ]) {
    assert.match(fingerprintUtil, new RegExp(`'${message}'`))
  }
  assert.match(fingerprintUtil, /candidate\.status !== 429/)
  assert.match(fingerprintUtil, /errorRecord\.code === 'PT429'/)
})

test('the forward fix uses an atomic write-quiescence bridge before the limiter', () => {
  assert.doesNotMatch(bridgeMigration, /^BEGIN;$/m)
  assert.doesNotMatch(bridgeMigration, /^COMMIT;$/m)
  assert.match(bridgeMigration, /SET LOCAL lock_timeout = '5s'/)
  assert.match(bridgeMigration, /CREATE TABLE private\.device_fingerprint_churn_cutover/)
  assert.match(bridgeMigration, /bridge_installed_at timestamptz NOT NULL/)

  const bridgeBody = recordFingerprintBody(bridgeMigration)
  assert.match(bridgeBody, /pg_try_advisory_xact_lock/)
  assert.doesNotMatch(bridgeBody, /(?<!try_)pg_advisory_xact_lock\s*\(/)
  assert.match(bridgeBody, /fingerprint_busy/)
  assert.match(bridgeBody, /fingerprint_write_deferred/)
  assert.doesNotMatch(bridgeBody, /\b(?:INSERT INTO|UPDATE|DELETE FROM)\b/)
  assert.match(bridgeMigration, /36b7cda577e25ba6fb36c46a7557b496/)
  assert.match(bridgeMigration, /REVOKE ALL ON TABLE private\.device_fingerprint_churn_cutover/)
  assert.match(bridgeMigration, /ALTER TABLE private\.device_fingerprint_churn_cutover FORCE ROW LEVEL SECURITY/)
  assert.match(bridgeMigration, /role\.rolsuper OR role\.rolbypassrls/)
  assert.match(bridgeMigration, /namespace\.nspowner = pg_catalog\.to_regrole\('postgres'\)::oid/)
  assert.match(bridgeMigration, /pg_catalog\.pg_publication AS publication[\s\S]*publication\.puballtables/)
  assert.match(bridgeMigration, /pg_catalog\.pg_publication_namespace AS publication_namespace/)
  assert.match(bridgeMigration, /migration_postcheck_failed: fingerprint mutation\/constraint\/RLS surface drifted/)
})

test('the final limiter is fail-fast, bounded, deterministic, and sequence-stable at cap', () => {
  assert.doesNotMatch(limiterMigration, /^BEGIN;$/m)
  assert.doesNotMatch(limiterMigration, /^COMMIT;$/m)
  assert.doesNotMatch(limiterMigration, /LOCK TABLE public\.device_fingerprints/)
  assert.match(limiterMigration, /36b7cda577e25ba6fb36c46a7557b496/)
  assert.match(limiterMigration, /bridge_installed_at <= pg_catalog\.clock_timestamp\(\)[\s\S]*bridge_installed_at <=[\s\S]*interval '65 seconds'/)
  assert.match(limiterMigration, /bridge_installed_at <=[\s\S]*interval '65 seconds'/)
  assert.match(limiterMigration, /NOT EXISTS \(SELECT 1 FROM auth\.users\)[\s\S]*NOT EXISTS \(SELECT 1 FROM auth\.identities\)[\s\S]*NOT EXISTS \(SELECT 1 FROM auth\.sessions\)[\s\S]*NOT EXISTS \(SELECT 1 FROM auth\.refresh_tokens\)[\s\S]*NOT EXISTS \(SELECT 1 FROM public\.profiles\)[\s\S]*NOT EXISTS \(SELECT 1 FROM public\.device_fingerprints\)/)
  assert.match(limiterMigration, /pg_stat_activity[\s\S]*record_fingerprint/)
  assert.match(limiterMigration, /pg_locks[\s\S]*hashtextextended/)
  assert.match(limiterMigration, /CREATE TABLE private\.device_fingerprint_rate_limits/)
  assert.match(limiterMigration, /cardinality\(accepted_new_hash_at\) BETWEEN 0 AND 5/)
  assert.match(limiterMigration, /pg_try_advisory_xact_lock/)
  assert.doesNotMatch(recordFingerprintBody(limiterMigration), /(?<!try_)pg_advisory_xact_lock\s*\(/)
  assert.doesNotMatch(recordFingerprintBody(limiterMigration), /DELETE FROM/)
  assert.doesNotMatch(recordFingerprintBody(limiterMigration), /\bUNION\b/)
  assert.match(limiterMigration, /FOR NO KEY UPDATE NOWAIT/)
  assert.match(limiterMigration, /FOR UPDATE NOWAIT/)
  assert.match(limiterMigration, /IF NOT FOUND THEN[\s\S]*RETURN;/)
  assert.match(limiterMigration, /ELSIF unique_hash_count = 20 THEN[\s\S]*ORDER BY fingerprint\.last_seen ASC, fingerprint\.id ASC[\s\S]*SET fp_hash = cleaned_hash,[\s\S]*first_seen = observed_at,[\s\S]*seen_count = 1,[\s\S]*ua_snippet = cleaned_ua/)
  assert.match(limiterMigration, /236e5532c22d63f9a0336e38fc381c82/)
  assert.match(limiterMigration, /DROP TABLE private\.device_fingerprint_churn_cutover/)

  const firstRowLock = limiterMigration.indexOf('FOR NO KEY UPDATE NOWAIT')
  assert.ok(limiterMigration.indexOf("MESSAGE = 'fingerprint_write_deferred'") < firstRowLock)
  assert.ok(limiterMigration.indexOf("MESSAGE = 'fingerprint_rate_limited'") < firstRowLock)
})

test('both forward migrations have fail-closed local and read-only companions', () => {
  for (const companion of [bridgePrecheck, bridgeVerify, limiterPrecheck, limiterVerify]) {
    assert.match(companion, /\\set ON_ERROR_STOP on[\s\S]*BEGIN;[\s\S]*SET TRANSACTION READ ONLY;[\s\S]*ROLLBACK;/)
  }
  assert.match(bridgeVerify, /36b7cda577e25ba6fb36c46a7557b496/)
  assert.match(bridgeVerify, /active_rpc_rows/)
  assert.match(bridgeVerify, /matching_advisory_rows/)
  for (const bridgeBoundary of [bridgePrecheck, bridgeVerify]) {
    assert.match(bridgeBoundary, /pg_catalog\.pg_publication_rel/)
    assert.match(bridgeBoundary, /pg_catalog\.pg_publication AS publication[\s\S]*publication\.puballtables/)
    assert.match(bridgeBoundary, /pg_catalog\.pg_publication_namespace AS publication_namespace/)
  }
  assert.match(limiterPrecheck, /Run twice at least five seconds apart/)
  assert.match(limiterPrecheck, /bridge_age_seconds/)
  assert.doesNotMatch(limiterPrecheck, /NOT EXISTS \(SELECT 1 FROM auth\.users\)/)
  assert.match(limiterVerify, /236e5532c22d63f9a0336e38fc381c82/)
  assert.match(limiterVerify, /single-use cutover gate still exists/)

  assert.match(bridgeRegression, /20260811140018-disposable-fingerprint-bridge/)
  assert.match(bridgeRegression, /bridge accepted a new physical write/)
  assert.match(limiterRegression, /20260811143207-disposable-fingerprint-churn/)
  assert.match(limiterRegression, /same-timestamp events lost multiplicity/)
  assert.match(limiterRegression, /at-cap in-place replacement drifted/)
  assert.match(limiterRegression, /19-to-20 insert did not advance sequence exactly once/)
  assert.match(limiterBootstrap, /BEGIN;[\s\S]*20260811140018_bound_device_fingerprint_churn\.sql[\s\S]*COMMIT;/)
  assert.match(limiterBootstrap, /CREATE TABLE IF NOT EXISTS auth\.identities[\s\S]*CREATE TABLE IF NOT EXISTS auth\.refresh_tokens/)
  assert.match(limiterBootstrap, /COMMIT;[\s\S]*BEGIN;[\s\S]*20260811143207_install_device_fingerprint_churn_limiter\.sql[\s\S]*ROLLBACK;[\s\S]*interval '2 minutes'/)
  assert.match(bridgeBootstrap, /20260811140018-disposable-fingerprint/)
  assert.match(bridgeBootstrap, /20260808040313_evict_oldest_device_fingerprint_instead_of_failing\.sql/)
})
