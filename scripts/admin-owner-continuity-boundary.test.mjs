import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const migrationUrl = new URL(
  '../supabase/migrations/20260722145042_harden_last_active_owner_revoke.sql',
  import.meta.url,
)
const precheckUrl = new URL(
  '../supabase/_ops/PRECHECK_20260722145042_harden_last_active_owner_revoke.sql',
  import.meta.url,
)
const verifyUrl = new URL(
  '../supabase/_ops/VERIFY_20260722145042_harden_last_active_owner_revoke.sql',
  import.meta.url,
)
const regressionUrl = new URL(
  '../supabase/_ops/REGRESSION_20260722145042_harden_last_active_owner_revoke.sql',
  import.meta.url,
)
const manifestUrl = new URL(
  '../supabase/migrations/manifest.sha256',
  import.meta.url,
)
const adminApiUrl = new URL('../api/admin/index.js', import.meta.url)

function functionBody(source, signature, nextMarker) {
  const start = source.indexOf(signature)
  const end = source.indexOf(nextMarker, start)
  assert.ok(start >= 0, `missing ${signature}`)
  assert.ok(end > start, `missing boundary after ${signature}`)
  return source.slice(start, end)
}

function occurrences(source, needle) {
  return source.split(needle).length - 1
}

test('exact revoke protects every active owner but accepts only a durable replacement', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const guard = functionBody(
    migration,
    'CREATE OR REPLACE FUNCTION public.admin_assert_token_revoke_allowed(',
    'REVOKE ALL ON FUNCTION public.admin_assert_token_revoke_allowed',
  )

  assert.match(guard, /check_time timestamptz := pg_catalog\.clock_timestamp\(\)/)
  assert.match(
    guard,
    /target_is_active_owner := target_admin_id IS NOT NULL[^]*target_role = 'owner'[^]*target_expires_at IS NULL OR target_expires_at > check_time[^]*target_profile\.id = target_admin_id/,
  )
  assert.match(
    guard,
    /IF target_is_active_owner[^]*owner_token\.id <> p_target_token_id[^]*admin_owner_token_recoverable\([^]*owner_profile\.id = owner_token\.admin_id[^]*MESSAGE = 'last_active_owner_token'/,
  )
  assert.equal(
    occurrences(guard, 'admin_owner_token_recoverable('),
    1,
    'the strict recovery predicate belongs only to the replacement side',
  )
  assert.doesNotMatch(guard, /target_last_used_at/)
  assert.match(
    guard,
    /target_is_active_owner[^]*admin_token_identity_safe\([^]*target_admin_name,[^]*target_admin_email/,
  )
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.admin_assert_token_revoke_allowed\(uuid, uuid\)[^]*FROM PUBLIC, anon, authenticated, service_role/,
  )
})

test('issuance, authorization, inventory, and recovery share the identity-safety boundary', async () => {
  const [migration, adminApi] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(adminApiUrl, 'utf8'),
  ])
  const identity = functionBody(
    migration,
    'CREATE OR REPLACE FUNCTION public.admin_token_identity_safe(',
    'REVOKE ALL ON FUNCTION public.admin_token_identity_safe',
  )
  const recoverable = functionBody(
    migration,
    'CREATE OR REPLACE FUNCTION public.admin_owner_token_recoverable(\n  p_admin_id uuid,\n  p_role text,\n  p_revoked_at timestamptz,\n  p_expires_at timestamptz,\n  p_last_used_at timestamptz,\n  p_admin_name text,',
    'REVOKE ALL ON FUNCTION public.admin_owner_token_recoverable',
  )
  const authorizationV1 = functionBody(
    migration,
    'CREATE OR REPLACE FUNCTION public.admin_token_authorization(p_token_hash text)',
    'REVOKE ALL ON FUNCTION public.admin_token_authorization(text)',
  )
  const authorizationV2 = functionBody(
    migration,
    'CREATE OR REPLACE FUNCTION public.admin_token_authorization_v2(',
    'REVOKE ALL ON FUNCTION public.admin_token_authorization_v2(text)',
  )
  const reconciliation = functionBody(
    migration,
    'CREATE OR REPLACE FUNCTION public.admin_reconcile_issued_token(',
    'REVOKE ALL ON FUNCTION public.admin_reconcile_issued_token(text)',
  )
  const inventory = functionBody(
    migration,
    'CREATE OR REPLACE FUNCTION public.admin_token_inventory()',
    'REVOKE ALL ON FUNCTION public.admin_token_inventory()',
  )

  for (const escape of [
    '061C', '200E', '200F', '202A', '202B', '202C', '202D', '202E',
    '2066', '2067', '2068', '2069',
  ]) {
    assert.match(identity, new RegExp(`U&'\\\\${escape}'`))
  }
  assert.equal(occurrences(identity, "!~ '[[:cntrl:]]'"), 2)
  assert.match(identity, /length\(p_admin_name\) BETWEEN 1 AND 100/)
  assert.match(identity, /length\(p_admin_email\) BETWEEN 3 AND 200/)
  assert.match(identity, /strpos\(p_admin_email, '@'\) > 0/)
  assert.match(recoverable, /admin_token_identity_safe\(p_admin_name, p_admin_email\)/)
  assert.match(
    adminApi,
    /function isBoundedAdminIdentity\(value, maxLength, requireEmailShape\) \{[^]*Array\.from\(value\)\.length/,
  )
  assert.equal(
    occurrences(adminApi, 'isBoundedAdminIdentity('),
    5,
    'authorization and inventory must use the same non-null Edge identity validator',
  )
  assert.doesNotMatch(adminApi, /isBoundedNullableIdentity|value === null\) return true/)

  for (const authorization of [authorizationV1, authorizationV2]) {
    assert.match(
      authorization,
      /UPDATE public\.admin_tokens AS token[^]*SET last_used_at = authorization_time[^]*admin_token_identity_safe\([^]*token\.admin_name,[^]*token\.admin_email/,
    )
  }
  assert.match(
    reconciliation,
    /token\.token_hash = p_token_hash[^]*admin_token_identity_safe/,
  )
  assert.match(inventory, /ELSE '\[unsafe identity\]'/)
  assert.match(inventory, /ELSE 'unsafe@invalid\.local'/)
  assert.match(inventory, /THEN token\.last_used_at[^]*ELSE NULL/)
  assert.match(
    migration,
    /CREATE TRIGGER admin_tokens_01_validate_active_identity\s+BEFORE INSERT OR UPDATE OF admin_name, admin_email, revoked_at[^]*EXECUTE FUNCTION public\.admin_validate_token_identity_write\(\)/,
  )
  assert.match(migration, /MESSAGE = 'admin_token_identity_unsafe'/)
})

test('table trigger protects short owners and recoverability loss under ordered locks', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const trigger = functionBody(
    migration,
    'CREATE OR REPLACE FUNCTION public.admin_protect_recovery_tokens()',
    'REVOKE ALL ON FUNCTION public.admin_protect_recovery_tokens()',
  )
  const lifecycleLock = migration.indexOf(
    'pg_advisory_xact_lock(20260718180000',
  )
  const recoveryLock = migration.indexOf(
    'pg_advisory_xact_lock(20260718190000',
  )
  const tableLock = migration.indexOf(
    'LOCK TABLE public.admin_tokens IN SHARE ROW EXCLUSIVE MODE',
  )

  assert.ok(
    lifecycleLock >= 0 && recoveryLock > lifecycleLock && tableLock > recoveryLock,
    'migration lock order drifted',
  )
  assert.match(
    trigger,
    /old_was_active_owner := old_was_active AND OLD\.role = 'owner'/,
  )
  assert.match(
    trigger,
    /new_is_active_owner := new_is_active AND NEW\.role = 'owner'/,
  )
  assert.match(
    trigger,
    /IF old_was_active_owner[^]*NOT new_is_active_owner[^]*old_was_recoverable_owner AND NOT new_is_recoverable_owner[^]*other_owner\.id <> OLD\.id[^]*MESSAGE = 'last_active_owner_token'/,
  )
  assert.equal(occurrences(trigger, 'admin_owner_token_recoverable('), 3)
  assert.match(
    migration,
    /CREATE TRIGGER admin_tokens_protect_recovery\s+BEFORE UPDATE OF admin_id, revoked_at, expires_at, role OR DELETE\s+ON public\.admin_tokens\s+FOR EACH ROW\s+EXECUTE FUNCTION public\.admin_protect_recovery_tokens\(\)/,
  )
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.admin_protect_recovery_tokens\(\)[^]*FROM PUBLIC, anon, authenticated, service_role/,
  )
})

test('ops gate topology and exercise exact, batch, direct, and positive-control behavior', async () => {
  const [precheck, verify, regression] = await Promise.all([
    readFile(precheckUrl, 'utf8'),
    readFile(verifyUrl, 'utf8'),
    readFile(regressionUrl, 'utf8'),
  ])

  assert.match(precheck, /SET TRANSACTION READ ONLY/)
  assert.match(precheck, /pg_try_advisory_xact_lock\(20260718180000/)
  assert.match(precheck, /pg_try_advisory_xact_lock\(20260718190000/)
  assert.match(precheck, /active_owner_issuers < 1 OR recoverable_owner_issuers < 1/)
  assert.match(precheck, /internal recovery guard is executable by an API role/)
  assert.match(precheck, /version = \$1 OR name = \$2/)
  assert.match(precheck, /20260722145042_harden_last_active_owner_revoke/)

  assert.match(verify, /SET TRANSACTION READ ONLY/)
  assert.match(verify, /guard_recovery_predicate_count <> 1/)
  assert.match(verify, /trigger_recovery_predicate_count <> 3/)
  assert.match(verify, /version = \$1 OR name = \$2/)
  assert.match(verify, /migration ledger lacks 20260722145042_harden_last_active_owner_revoke/)
  assert.match(verify, /owner continuity row-trigger topology drifted/)
  assert.match(
    verify,
    /UPDATE OF admin_id, revoked_at, expires_at, role ON public\.admin_tokens/,
  )
  assert.match(
    verify,
    /UPDATE OF admin_id, revoked_at, expires_at, last_used_at, role ON public\.admin_tokens/,
  )

  assert.match(regression, /NEVER run against production/)
  assert.match(regression, /session_replication_role = replica/)
  assert.match(regression, /interval '23 hours'/)
  assert.match(regression, /'security_admin'/)
  assert.match(regression, /'revoke_token'/)
  assert.match(regression, /'revoke_admin_tokens'/)
  assert.match(regression, /short sole owner exact revoke was accepted/)
  assert.match(regression, /short sole owner batch revoke was accepted/)
  assert.match(regression, /short sole owner direct table revoke was accepted/)
  assert.match(regression, /owner continuity refusal left an idempotency or audit side effect/)
  assert.match(regression, /recoverable owner replacement did not allow exact revoke/)
  assert.match(regression, /recoverable replacement success lost its ledger or audit evidence/)
  assert.match(regression, /U&'Unsafe\\202EOwner'/)
  assert.match(regression, /unsafe administrator identity was issued a token/)
  assert.match(regression, /unsafe administrator identity authorized or reconciled/)
  assert.match(regression, /unsafe administrator authorization stamped last_used_at/)
  assert.match(regression, /unsafe administrator identity counted as a recoverable owner/)
  assert.match(regression, /unsafe owner replacement allowed exact revoke/)
  assert.match(regression, /unsafe owner replacement allowed batch revoke/)
  assert.match(regression, /unsafe owner replacement allowed direct table revoke/)
  assert.doesNotMatch(regression, /\bCOMMIT\b/)
  assert.match(regression.trimEnd(), /ROLLBACK;$/)
})

test('migration manifest pins the owner-continuity migration bytes', async () => {
  const [migration, manifest] = await Promise.all([
    readFile(migrationUrl),
    readFile(manifestUrl, 'utf8'),
  ])
  const digest = createHash('sha256').update(migration).digest('hex')
  assert.match(
    manifest,
    new RegExp(
      `^${digest}  20260722145042_harden_last_active_owner_revoke\\.sql$`,
      'm',
    ),
  )
})
