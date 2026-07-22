import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const MIGRATION = new URL(
  '../supabase/migrations/20260718160000_reconcile_expired_suspension_visibility.sql',
  import.meta.url,
)
const PRECHECK = new URL(
  '../supabase/_ops/PRECHECK_20260718_reconcile_expired_suspension_visibility.sql',
  import.meta.url,
)
const VERIFY = new URL(
  '../supabase/_ops/VERIFY_20260718_reconcile_expired_suspension_visibility.sql',
  import.meta.url,
)

const legacyColumns = [
  'id',
  'user_id',
  'title',
  'description',
  'price',
  'category',
  'condition',
  'status',
  'location',
  'images',
  'view_count',
  'created_at',
  'updated_at',
  'negotiable',
  'favorite_count',
  'location_verified',
]

const finalColumns = [
  ...legacyColumns.slice(0, 14),
  'image_dimensions',
  'title_i18n',
  'description_i18n',
  'source_lang',
  ...legacyColumns.slice(14),
  'listing_type',
]

function normalizedSql(source) {
  return source.replace(/--.*$/gm, '').replace(/\s+/g, ' ').trim()
}

function sqlTextArray(columns) {
  return `ARRAY[ ${columns.map(column => `'${column}'`).join(', ')} ]::text[]`
}

function occurrenceCount(source, pattern) {
  return [...source.matchAll(pattern)].length
}

test('legacy items_visible projection is accepted only through a dependency-free rebuild', async () => {
  const migration = await readFile(MIGRATION, 'utf8')
  const normalized = normalizedSql(migration)
  const legacyArray = sqlTextArray(legacyColumns)

  assert.ok(
    normalized.includes(
      `rebuild_legacy_item_view := item_view_columns = ${legacyArray};`,
    ),
    'the exact production legacy projection must be the rebuild trigger',
  )
  assert.match(
    normalized,
    /FROM pg_catalog\.pg_depend AS dependency WHERE dependency\.refclassid = 'pg_catalog\.pg_class'::pg_catalog\.regclass AND dependency\.refobjid = 'public\.items_visible'::pg_catalog\.regclass AND dependency\.deptype <> 'i'/,
  )
  assert.match(normalized, /pg_catalog\.pg_describe_object\(/)
  assert.match(
    normalized,
    /IF pg_catalog\.cardinality\(item_view_dependents\) > 0 THEN RAISE EXCEPTION 'suspension_visibility_items_visible_has_dependents:/,
  )
  assert.match(
    normalized,
    /IF rebuild_legacy_item_view THEN DROP VIEW public\.items_visible; END IF;/,
  )
  assert.equal(
    occurrenceCount(migration, /DROP\s+VIEW\s+public\.items_visible\s*;/gi),
    1,
  )
  assert.doesNotMatch(normalized, /DROP VIEW[^;]*\bCASCADE\b/i)

  const dependencyGuard = normalized.indexOf('FROM pg_catalog.pg_depend AS dependency')
  const drop = normalized.indexOf('DROP VIEW public.items_visible;')
  const recreate = normalized.indexOf('CREATE OR REPLACE VIEW public.items_visible')
  assert.ok(dependencyGuard >= 0 && dependencyGuard < drop && drop < recreate)
})

test('migration and VERIFY converge on the same explicit secure projection', async () => {
  const [migration, verify] = await Promise.all([
    readFile(MIGRATION, 'utf8'),
    readFile(VERIFY, 'utf8'),
  ])
  const normalizedMigration = normalizedSql(migration)
  const normalizedVerify = normalizedSql(verify)

  assert.ok(normalizedVerify.includes(sqlTextArray(finalColumns)))
  const projectedColumns = finalColumns
    .map(column => `item.${column}`)
    .join(', ')
  assert.match(
    normalizedMigration,
    new RegExp(
      `CREATE OR REPLACE VIEW public\\.items_visible WITH \\(security_invoker = true, security_barrier = true\\) AS SELECT ${projectedColumns.replaceAll('.', '\\.')}`,
    ),
  )
  assert.match(
    normalizedMigration,
    /REVOKE ALL ON public\.items_visible, public\.posts_visible FROM PUBLIC; GRANT SELECT ON public\.items_visible, public\.posts_visible TO anon, authenticated, service_role;/,
  )
  assert.match(normalizedVerify, /security_invoker=true/)
  assert.match(normalizedVerify, /security_barrier=true/)
  assert.match(normalizedVerify, /unexpected items_visible dependents/)
})

test('read-only PRECHECK accepts the legacy shape but cannot mutate it', async () => {
  const precheck = await readFile(PRECHECK, 'utf8')
  const normalized = normalizedSql(precheck)

  assert.ok(
    normalized.includes(
      `rebuild_legacy_item_view := item_view_columns = ${sqlTextArray(legacyColumns)};`,
    ),
  )
  assert.match(normalized, /legacy items_visible has dependents/)
  assert.match(normalized, /dependency\.deptype <> 'i'/)
  assert.match(precheck, /^SET TRANSACTION READ ONLY;$/m)
  assert.doesNotMatch(precheck, /DROP\s+VIEW|CREATE\s+(?:OR\s+REPLACE\s+)?VIEW/i)
})
