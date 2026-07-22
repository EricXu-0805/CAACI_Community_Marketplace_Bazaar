import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationUrl = new URL(
  '../supabase/migrations/20260719174928_reconcile_trigger_only_function_acl.sql',
  import.meta.url,
)
const precheckUrl = new URL(
  '../supabase/_ops/PRECHECK_20260719174928_reconcile_trigger_only_function_acl.sql',
  import.meta.url,
)
const verifyUrl = new URL(
  '../supabase/_ops/VERIFY_20260719174928_reconcile_trigger_only_function_acl.sql',
  import.meta.url,
)
const regressionUrl = new URL(
  '../supabase/_ops/REGRESSION_20260719174928_reconcile_trigger_only_function_acl.sql',
  import.meta.url,
)

function withoutLineComments(source) {
  return source.replace(/^\s*--.*$/gm, '')
}

test('forward migration only hardens the existing trigger function', async () => {
  const migration = withoutLineComments(await readFile(migrationUrl, 'utf8'))

  assert.match(migration, /^\s*BEGIN;/)
  assert.match(migration, /COMMIT;\s*$/)
  assert.match(
    migration,
    /ALTER FUNCTION public\.block_currency_exchange_items\(\) SECURITY INVOKER/,
  )
  assert.match(
    migration,
    /ALTER FUNCTION public\.block_currency_exchange_items\(\) RESET ALL/,
  )
  assert.match(
    migration,
    /ALTER FUNCTION public\.block_currency_exchange_items\(\)\s+SET search_path = pg_catalog/,
  )
  assert.match(
    migration,
    /REVOKE ALL PRIVILEGES ON FUNCTION public\.block_currency_exchange_items\(\)\s+FROM PUBLIC, anon, authenticated, service_role/,
  )
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION/i)
  assert.doesNotMatch(migration, /CREATE TRIGGER|DROP TRIGGER|ALTER TABLE/i)
  assert.doesNotMatch(migration, /GRANT EXECUTE/i)
})

test('guard and postcondition pin the function business and runtime contract', async () => {
  const [migration, precheck, verify] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(precheckUrl, 'utf8'),
    readFile(verifyUrl, 'utf8'),
  ])

  for (const source of [migration, precheck, verify]) {
    assert.match(source, /block_currency_exchange_items/)
    assert.match(source, /routine\.prokind/)
    assert.match(source, /routine\.pronargs/)
    assert.match(source, /routine\.pronargdefaults/)
    assert.match(source, /routine\.prorettype/)
    assert.match(source, /routine\.proretset/)
    assert.match(source, /language\.lanname/)
    assert.match(source, /routine\.provolatile/)
    assert.match(source, /routine\.proparallel/)
    assert.match(source, /routine\.proisstrict/)
    assert.match(source, /routine\.proleakproof/)
    assert.match(source, /routine\.prosrc/)
    assert.match(source, /NEW\.category = ''currency_exchange''/)
    assert.match(source, /RAISE EXCEPTION ''category_not_allowed''/)
    assert.match(
      source,
      /Currency exchange listings are not permitted\./,
    )
    assert.match(source, /current_setting\('server_version_num'\)/)
  }

  for (const source of [migration, verify]) {
    assert.match(source, /routine\.prosecdef/)
    assert.match(
      source,
      /function_definition\.proconfig IS DISTINCT FROM\s+ARRAY\['search_path=pg_catalog'\]::text\[\]/,
    )
    assert.doesNotMatch(source, /proconfig[\s\S]{0,80}@>/)
  }

  assert.match(migration, /DO \$guard\$/)
  assert.match(migration, /DO \$postcondition\$/)
  assert.match(migration, /trigger_only_acl_function_business_contract_drift/)
  assert.match(migration, /trigger_only_acl_postcondition_function_contract/)
})

test('the exact BEFORE INSERT and UPDATE OF category trigger stays pinned', async () => {
  const [migration, precheck, verify] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(precheckUrl, 'utf8'),
    readFile(verifyUrl, 'utf8'),
  ])

  for (const source of [migration, precheck, verify]) {
    assert.match(source, /trg_block_currency_exchange/)
    assert.match(source, /trigger_row\.tgfoid = function_oid/)
    assert.match(source, /trigger_row\.tgrelid = items_oid/)
    assert.match(source, /trigger_row\.tgenabled = 'O'/)
    assert.match(source, /trigger_row\.tgtype = 23/)
    assert.match(source, /trigger_row\.tgnargs = 0/)
    assert.match(source, /trigger_row\.tgattr::text = category_attnum::text/)
    assert.match(source, /trigger_row\.tgqual IS NULL/)
    assert.match(source, /trigger_row\.tgconstraint = 0/)
    assert.match(source, /NOT trigger_row\.tgdeferrable/)
    assert.match(source, /NOT trigger_row\.tginitdeferred/)
    assert.match(source, /trigger_row\.tgoldtable IS NULL/)
    assert.match(source, /trigger_row\.tgnewtable IS NULL/)
    assert.match(source, /trigger_row\.tgparentid = 0/)
    assert.match(source, /public\.item_category/)
    assert.match(source, /enum_value\.enumlabel = 'currency_exchange'/)
  }
})

test('ACL proof covers direct, effective, inherited, grantor, and grant option truth', async () => {
  const [migration, precheck, verify] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(precheckUrl, 'utf8'),
    readFile(verifyUrl, 'utf8'),
  ])

  for (const source of [migration, precheck, verify]) {
    assert.match(source, /aclexplode\(/)
    assert.match(source, /acldefault\('f', routine\.proowner\)/)
    assert.match(source, /acl\.grantee/)
    assert.match(source, /acl\.privilege_type = 'EXECUTE'/)
    assert.match(source, /acl\.grantor/)
    assert.match(source, /pg_catalog\.pg_has_role\(/)
    assert.match(source, /owner_membership_count/)
    assert.match(source, /anon/)
    assert.match(source, /authenticated/)
    assert.match(source, /service_role/)
  }

  for (const source of [migration, verify]) {
    assert.match(source, /acl\.is_grantable/)
    assert.match(source, /has_function_privilege\(/)
    assert.match(source, /EXECUTE WITH GRANT OPTION/)
  }

  assert.match(precheck, /non-owner function ACL grantor count/)
  assert.match(precheck, /inherited\/owner execution provenance count/)
  assert.match(verify, /direct function ACL\/grantor\/grant-option drift/)
  assert.match(verify, /PUBLIC effective EXECUTE drift/)
  assert.match(verify, /API effective EXECUTE\/grant-option drift/)
  assert.match(verify, /inherited function ACL provenance drift/)
})

test('operation files are read-only or rollback-only and exercise adversarial roles', async () => {
  const [precheck, verify, regression] = await Promise.all([
    readFile(precheckUrl, 'utf8'),
    readFile(verifyUrl, 'utf8'),
    readFile(regressionUrl, 'utf8'),
  ])

  for (const source of [precheck, verify]) {
    const executable = withoutLineComments(source)
    assert.match(executable, /SET TRANSACTION READ ONLY/)
    assert.doesNotMatch(
      executable,
      /^\s*(?:GRANT|REVOKE|CREATE|ALTER|DROP)\b/im,
    )
    assert.match(executable, /ROLLBACK;\s*$/)
  }

  for (const marker of [
    'baseline_contract',
    'currency_insert_blocked',
    'currency_update_blocked',
    'direct_call_denied',
    'ordinary_write_preserved',
    'direct_acl_drift_detected',
    'inherited_acl_drift_detected',
    'foreign_grantor_drift_detected',
    'function_security_drift_detected',
    'function_body_drift_detected',
    'trigger_contract_drift_detected',
    'overload_drift_detected',
  ]) {
    assert.match(regression, new RegExp(`\\$${marker}\\$`))
  }

  assert.match(regression, /NEVER run against production/)
  assert.match(regression, /SET LOCAL ROLE authenticated/)
  assert.match(regression, /RESET ROLE/)
  assert.match(regression, /INSERT INTO public\.trigger_only_acl_regression_items/)
  assert.match(regression, /UPDATE public\.trigger_only_acl_regression_items/)
  assert.match(regression, /SELECT public\.block_currency_exchange_items\(\)/)
  assert.match(regression, /WITH GRANT OPTION/)
  assert.match(regression, /ROLLBACK;\s*$/)
})
