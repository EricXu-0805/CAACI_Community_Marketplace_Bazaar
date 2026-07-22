import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const TRGM_VERSION = '20260722081137'
const FUNCTION_VERSION = '20260722081141'

const migrationUrl = name => new URL(`../supabase/migrations/${name}`, import.meta.url)
const operationUrl = name => new URL(`../supabase/_ops/${name}`, import.meta.url)

const TRGM_MIGRATION = migrationUrl(
  `${TRGM_VERSION}_relocate_pg_trgm_to_extensions.sql`,
)
const FUNCTION_MIGRATION = migrationUrl(
  `${FUNCTION_VERSION}_harden_authenticated_function_surface.sql`,
)

const intentionalAuthenticatedRpcs = [
  'public.archive_conversation(uuid,uuid)',
  'public.get_item_sale_candidates(uuid,uuid)',
  'public.get_last_messages(uuid[])',
  'public.get_my_profile()',
  'public.get_transaction_rating_eligibility(uuid,uuid)',
  'public.increment_view_count(uuid)',
  'public.make_offer(uuid,numeric,uuid,text)',
  'public.mark_item_sold(uuid,uuid,uuid)',
  'public.mark_onboarded(text,text,uuid,text)',
  'public.propose_meetup(uuid,text,timestamptz,uuid,text)',
  'public.record_consent(text,uuid)',
  'public.record_fingerprint(text,text)',
  'public.reschedule_accepted_meetup(uuid,text,timestamptz,uuid,text)',
  'public.respond_to_meetup(uuid,text,uuid,text,timestamptz,text)',
  'public.respond_to_offer(uuid,text,uuid,numeric,text)',
  'public.submit_appeal(text,uuid,uuid)',
  'public.submit_transaction_rating(uuid,uuid,integer,text,uuid)',
  'public.verify_illini_email_code(uuid,text)',
]

const retiredAuthenticatedRpcs = [
  'public.mark_onboarded(text,text,text)',
  'public.record_consent(text)',
  'public.submit_appeal(text)',
]

test('pg_trgm moves in place and both invoker search RPCs keep a fixed extension path', async () => {
  const migration = await readFile(TRGM_MIGRATION, 'utf8')

  assert.match(migration, /^BEGIN;$/m)
  assert.equal(migration.trimEnd().endsWith('COMMIT;'), true)
  assert.match(migration, /extension\.extrelocatable/)
  assert.match(migration, /extension_schema NOT IN \('public', 'extensions'\)/)
  assert.match(migration, /ALTER EXTENSION pg_trgm SET SCHEMA extensions/)
  assert.match(migration, /index_oids_after IS DISTINCT FROM index_oids_before/)
  assert.match(migration, /actual\.indisvalid IS DISTINCT FROM true/)
  assert.match(migration, /actual\.indisready IS DISTINCT FROM true/)
  assert.match(migration, /actual\.indislive IS DISTINCT FROM true/)
  assert.match(migration, /actual\.operator_schema IS DISTINCT FROM 'extensions'/)
  assert.match(migration, /actual\.operator_class IS DISTINCT FROM 'gin_trgm_ops'/)
  assert.match(
    migration,
    /ALTER FUNCTION public\.search_items_fuzzy\([\s\S]*?\) SET search_path = pg_catalog, public, extensions;/,
  )
  assert.match(
    migration,
    /ALTER FUNCTION public\.search_posts_fuzzy\([\s\S]*?\) SET search_path = pg_catalog, public, extensions;/,
  )
  assert.doesNotMatch(migration, /\bDROP\s+EXTENSION\b/i)
  assert.doesNotMatch(migration, /\bCREATE\s+EXTENSION\b/i)
  assert.doesNotMatch(migration, /\bCASCADE\b/i)
  assert.match(migration, /NOTIFY pgrst, 'reload schema';/)
})

test('pg_trgm operations prove extension, search execution, and all four GIN indexes', async () => {
  const [precheck, verify, regression] = await Promise.all([
    readFile(
      operationUrl(`PRECHECK_${TRGM_VERSION}_relocate_pg_trgm_to_extensions.sql`),
      'utf8',
    ),
    readFile(
      operationUrl(`VERIFY_${TRGM_VERSION}_relocate_pg_trgm_to_extensions.sql`),
      'utf8',
    ),
    readFile(
      operationUrl(`REGRESSION_${TRGM_VERSION}_relocate_pg_trgm_to_extensions.sql`),
      'utf8',
    ),
  ])

  for (const index of [
    'idx_items_description_trgm',
    'idx_items_title_trgm',
    'idx_posts_content_trgm',
    'idx_profiles_nickname_trgm',
  ]) {
    assert.match(precheck, new RegExp(index))
    assert.match(verify, new RegExp(index))
    assert.match(regression, new RegExp(index))
  }

  assert.match(verify, /extension_schema IS DISTINCT FROM 'extensions'/)
  assert.match(verify, /ARRAY\['search_path=pg_catalog, public, extensions'\]/)
  assert.match(verify, /search API role lacks schema usage/)
  assert.match(verify, /search API role lacks RPC execute privilege/)
  assert.match(verify, /trigram_opclass_oid = ANY \(index_row\.indclass::oid\[\]\)/)
  assert.match(verify, /pg_trgm function\/operator member remains in public/)
  assert.match(regression, /LOCAL\/STAGING ONLY — NEVER PRODUCTION/)
  assert.match(regression, /FROM public\.search_items_fuzzy\(/)
  assert.match(regression, /FROM public\.search_posts_fuzzy\(/)
  assert.match(regression, /SET LOCAL ROLE anon;/)
  assert.match(regression, /SET LOCAL ROLE authenticated;/)
  assert.equal(regression.trimEnd().endsWith('ROLLBACK;'), true)
})

test('future function defaults fail closed and only the three stale overloads retire', async () => {
  const migration = await readFile(FUNCTION_MIGRATION, 'utf8')

  assert.ok(TRGM_VERSION < FUNCTION_VERSION)
  assert.match(
    migration,
    /ALTER DEFAULT PRIVILEGES FOR ROLE postgres\s+REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;/,
  )
  assert.match(
    migration,
    /ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public\s+REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated, service_role;/,
  )
  assert.equal(
    [...migration.matchAll(/^DROP FUNCTION public\./gm)].length,
    retiredAuthenticatedRpcs.length,
  )
  assert.match(migration, /DROP FUNCTION public\.mark_onboarded\(text, text, text\);/)
  assert.match(migration, /DROP FUNCTION public\.record_consent\(text\);/)
  assert.match(migration, /DROP FUNCTION public\.submit_appeal\(text\);/)
  assert.doesNotMatch(migration, /DROP FUNCTION IF EXISTS/)
  assert.doesNotMatch(migration, /\bCASCADE\b/i)
  assert.doesNotMatch(migration, /^GRANT\b/m)
  assert.match(migration, /NOTIFY pgrst, 'reload schema';/)
})

test('authenticated SECURITY DEFINER verification pins the reviewed 18-RPC allowlist', async () => {
  const [precheck, verify, regression] = await Promise.all([
    readFile(
      operationUrl(
        `PRECHECK_${FUNCTION_VERSION}_harden_authenticated_function_surface.sql`,
      ),
      'utf8',
    ),
    readFile(
      operationUrl(
        `VERIFY_${FUNCTION_VERSION}_harden_authenticated_function_surface.sql`,
      ),
      'utf8',
    ),
    readFile(
      operationUrl(
        `REGRESSION_${FUNCTION_VERSION}_harden_authenticated_function_surface.sql`,
      ),
      'utf8',
    ),
  ])

  assert.equal(intentionalAuthenticatedRpcs.length, 18)
  for (const signature of intentionalAuthenticatedRpcs) {
    assert.match(verify, new RegExp(signature.replace(/[()[\]]/g, '\\$&')))
  }
  for (const signature of retiredAuthenticatedRpcs) {
    const escaped = new RegExp(signature.replace(/[()[\]]/g, '\\$&'))
    assert.match(precheck, escaped)
    assert.match(verify, escaped)
    assert.match(regression, escaped)
  }

  assert.match(verify, /authenticated SECURITY DEFINER allowlist drift/)
  assert.match(verify, /ARRAY\['search_path=pg_catalog'\]::text\[\]/)
  assert.match(verify, /global postgres function default still grants PUBLIC/)
  assert.match(verify, /postgres function defaults expose an API role/)
  assert.match(regression, /LOCAL\/STAGING ONLY — NEVER PRODUCTION/)
  assert.match(regression, /current_user <> 'postgres'/)
  assert.match(regression, /CREATE FUNCTION public\.caaci_default_acl_probe_20260722081141\(\)/)
  assert.match(
    regression,
    /has_function_privilege\(\s*'authenticated', probe_oid, 'EXECUTE'\s*\)/,
  )
  assert.equal(regression.trimEnd().endsWith('ROLLBACK;'), true)
})

test('the shipped app calls only expected-account replacements for retired overloads', async () => {
  const [onboarding, reconsent, suspended] = await Promise.all([
    readFile(new URL('../app/src/pages/onboarding/index.vue', import.meta.url), 'utf8'),
    readFile(new URL('../app/src/pages/reconsent/index.vue', import.meta.url), 'utf8'),
    readFile(new URL('../app/src/pages/suspended/index.vue', import.meta.url), 'utf8'),
  ])

  assert.match(
    onboarding,
    /rpc\('mark_onboarded',[\s\S]{0,500}expected_user_id_in:/,
  )
  assert.match(
    onboarding,
    /rpc\('record_consent',[\s\S]{0,300}expected_user_id_in:/,
  )
  assert.match(
    reconsent,
    /rpc\('record_consent',[\s\S]{0,300}expected_user_id_in:/,
  )
  assert.match(
    suspended,
    /rpc\('submit_appeal',[\s\S]{0,400}expected_user_id_in:[\s\S]{0,200}expected_suspension_id_in:/,
  )
})
