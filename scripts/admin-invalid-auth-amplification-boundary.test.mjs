import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationUrl = new URL(
  '../supabase/migrations/20260722152000_harden_admin_invalid_auth_amplification.sql',
  import.meta.url,
)
const precheckUrl = new URL(
  '../supabase/_ops/PRECHECK_20260722152000_harden_admin_invalid_auth_amplification.sql',
  import.meta.url,
)
const verifyUrl = new URL(
  '../supabase/_ops/VERIFY_20260722152000_harden_admin_invalid_auth_amplification.sql',
  import.meta.url,
)
const regressionUrl = new URL(
  '../supabase/_ops/REGRESSION_20260722152000_harden_admin_invalid_auth_amplification.sql',
  import.meta.url,
)
const adminApiUrl = new URL('../api/admin/index.js', import.meta.url)

test('invalid admin-token hashes exit before the serialized lock domain', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const functionStart = migration.indexOf(
    'CREATE OR REPLACE FUNCTION public.admin_token_authorization_v2',
  )
  const functionEnd = migration.indexOf(
    'REVOKE ALL ON FUNCTION public.admin_token_authorization_v2',
    functionStart,
  )
  assert.ok(functionStart >= 0 && functionEnd > functionStart)
  const source = migration.slice(functionStart, functionEnd)
  const negativeProbe = source.indexOf('IF NOT EXISTS (')
  const firstLock = source.indexOf('pg_advisory_xact_lock(20260718180000::bigint)')
  const secondLock = source.indexOf('pg_advisory_xact_lock(20260718190000::bigint)')
  const authoritativeUpdate = source.indexOf('UPDATE public.admin_tokens AS token')

  assert.ok(negativeProbe > 0)
  assert.ok(firstLock > negativeProbe)
  assert.ok(secondLock > firstLock)
  assert.ok(authoritativeUpdate > secondLock)
  assert.match(source, /candidate\.token_hash = p_token_hash/)
  assert.match(
    source,
    /candidate\.token_hash = p_token_hash[^]*?admin_token_identity_safe\(\s*candidate\.admin_name,\s*candidate\.admin_email\s*\)[^]*?pg_advisory_xact_lock\(20260718180000::bigint\)/,
  )
  assert.match(source, /token\.token_hash = p_token_hash/)
  assert.match(
    source,
    /UPDATE public\.admin_tokens AS token[^]*?token\.token_hash = p_token_hash[^]*?admin_token_identity_safe\(\s*token\.admin_name,\s*token\.admin_email\s*\)/,
  )
  assert.match(source, /SET last_used_at = authorization_time/)
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.admin_token_authorization_v2\(text\)[^]*?FROM PUBLIC, anon, authenticated, service_role;[^]*?GRANT EXECUTE ON FUNCTION public\.admin_token_authorization_v2\(text\)[^]*?TO service_role;/,
  )
})

test('unauthorized persistent audit evidence is network-bounded and fail-closed', async () => {
  const source = await readFile(adminApiUrl, 'utf8')
  assert.match(source, /const ADMIN_UNAUTHORIZED_AUDIT_MAX = 1/)
  assert.match(source, /const ADMIN_UNAUTHORIZED_AUDIT_WINDOW_SECS = 60 \* 60/)
  assert.match(
    source,
    /bucket_in: `admin:unauthorized-audit:\$\{networkFingerprint\}`,[^]*?max_in: ADMIN_UNAUTHORIZED_AUDIT_MAX,[^]*?window_secs_in: ADMIN_UNAUTHORIZED_AUDIT_WINDOW_SECS/,
  )
  assert.match(source, /if \(auditAllowed === true\) \{[^]*?'admin_unauthorized'/)
})

test('operations prove the preflight, deployed order, ACL, and no-lock miss', async () => {
  const [precheck, verify, regression] = await Promise.all([
    readFile(precheckUrl, 'utf8'),
    readFile(verifyUrl, 'utf8'),
    readFile(regressionUrl, 'utf8'),
  ])
  assert.match(precheck, /SET LOCAL lock_timeout = '2s'/)
  assert.match(precheck, /SET LOCAL statement_timeout = '30s'/)
  assert.match(precheck, /admin_token_authorization_v2\(text\)/)
  assert.match(precheck, /admin_token_identity_safe\(text,text\)/)
  assert.match(precheck, /token_index\.indisvalid/)
  assert.match(precheck, /token_index\.indisready/)
  assert.match(precheck, /token_index\.indnkeyatts = 1/)
  assert.match(precheck, /token_index\.indkey\[0\] = token_hash_column\.attnum/)
  assert.match(precheck, /admin token hash lacks a ready, valid probe index/)
  assert.match(precheck, /version = \$1 OR name = \$2/)
  assert.match(precheck, /migration ledger already contains 20260722152000_harden_admin_invalid_auth_amplification/)
  assert.match(verify, /negative-probe\/locked-revalidation order drifted/)
  assert.match(verify, /SET LOCAL lock_timeout = '2s'/)
  assert.match(verify, /SET LOCAL statement_timeout = '30s'/)
  assert.match(verify, /authorization RPC ACL drifted/)
  assert.match(verify, /token_index\.indisvalid/)
  assert.match(verify, /token_index\.indisready/)
  assert.match(verify, /admin token hash lacks a ready, valid probe index/)
  assert.match(verify, /version = \$1 OR name = \$2/)
  assert.match(verify, /migration ledger lacks 20260722152000_harden_admin_invalid_auth_amplification/)
  assert.match(regression, /admin token identity safety prerequisite drifted/)
  assert.match(regression, /absent token hash entered advisory-lock domain/)
  assert.match(regression, /NEVER run against production/)
  assert.match(regression, /ROLLBACK;/)
})
