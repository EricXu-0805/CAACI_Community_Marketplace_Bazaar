import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const detailUrl = new URL('../src/pages/detail/index.vue', import.meta.url)
const favoritesUrl = new URL('../src/composables/useFavorites.ts', import.meta.url)
const itemsUrl = new URL('../src/composables/useItems.ts', import.meta.url)
const migrationUrl = new URL(
  '../../supabase/migrations/20260717092804_secure_public_write_boundaries.sql',
  import.meta.url,
)
const verifyUrl = new URL(
  '../../supabase/_ops/VERIFY_20260717_secure_public_write_boundaries.sql',
  import.meta.url,
)

function block(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.ok(start >= 0, `missing ${startMarker}`)
  assert.ok(end > start, `missing ${endMarker} after ${startMarker}`)
  return source.slice(start, end)
}

test('anonymous item detail skips the private favorites relation entirely', async () => {
  const [detail, favorites] = await Promise.all([
    readFile(detailUrl, 'utf8'),
    readFile(favoritesUrl, 'utf8'),
  ])
  const loadDetail = block(
    detail,
    'async function loadDetailForCurrentAccount()',
    '\n}\n\nonLoad((options)',
  )

  assert.ok(
    loadDetail.indexOf('await awaitAuthReady()')
      < loadDetail.indexOf('const accountToken = currentUser.value'),
    'the detail page must resolve auth before deciding whether favorites are private',
  )
  assert.match(
    loadDetail,
    /accountToken \? loadMyFavorites\(accountToken\.userId\) : Promise\.resolve\(\)/,
  )
  assert.doesNotMatch(detail, /\.from\(['"]favorites['"]\)/)

  const loadFavorites = block(
    favorites,
    'async function loadMyFavorites',
    '\n  }\n\n  function isFavorited',
  )
  assert.match(loadFavorites, /\.from\('favorites'\)[^]*?\.select\('item_id'\)/)
  assert.doesNotMatch(loadFavorites, /head\s*:\s*true/)
})

test('anonymous item detail skips the authenticated view-counter RPC', async () => {
  const items = await readFile(itemsUrl, 'utf8')
  const fetchItem = block(items, 'async function fetchItem', 'async function createItem')

  assert.match(
    fetchItem,
    /if \(options\.incrementView !== false && viewAccountToken\) \{[^]*?supabase\.auth\.getSession\(\)[^]*?supabase\.rpc\('increment_view_count'/,
  )
  assert.match(
    fetchItem,
    /session\.user\.id !== viewAccountToken\.userId[^]*?\|\| !isAccountRequestCurrent\(viewAccountToken\)/,
  )
  assert.equal(
    (fetchItem.match(/supabase\.rpc\('increment_view_count'/g) || []).length,
    1,
    'there must be one guarded view-counter call site',
  )
})

test('view counter remains a least-privilege, unique authenticated-viewer RPC', async () => {
  const [migration, verify] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(verifyUrl, 'utf8'),
  ])
  const functionContract = block(
    migration,
    'CREATE OR REPLACE FUNCTION public.increment_view_count(item_id uuid)',
    '-- -----------------------------------------------------------------------------\n-- 10.',
  )

  assert.match(migration, /PRIMARY KEY \(item_id, viewer_id\)/)
  assert.match(migration, /ALTER TABLE public\.item_view_events ENABLE ROW LEVEL SECURITY/)
  assert.match(migration, /REVOKE ALL ON public\.item_view_events FROM PUBLIC, anon, authenticated/)
  assert.match(functionContract, /SECURITY DEFINER\s+SET search_path = pg_catalog/)
  assert.match(functionContract, /viewer uuid := auth\.uid\(\)/)
  assert.match(functionContract, /IF viewer IS NULL THEN[^]*?ERRCODE = '42501'/)
  assert.match(functionContract, /listed_item\.user_id <> viewer/)
  assert.match(functionContract, /ON CONFLICT ON CONSTRAINT item_view_events_pkey DO NOTHING/)
  assert.match(functionContract, /GET DIAGNOSTICS inserted_rows = ROW_COUNT/)
  assert.match(functionContract, /IF inserted_rows = 1 THEN[^]*?SET view_count = counted_item\.view_count \+ 1/)
  assert.match(
    functionContract,
    /REVOKE ALL ON FUNCTION public\.increment_view_count\(uuid\)[^]*?FROM PUBLIC, anon, authenticated, service_role/,
  )
  assert.match(
    functionContract,
    /GRANT EXECUTE ON FUNCTION public\.increment_view_count\(uuid\)\s+TO authenticated/,
  )

  assert.match(
    verify,
    /has_function_privilege\(\s*'anon', 'public\.increment_view_count\(uuid\)', 'EXECUTE'\s*\)[^]*?NOT pg_catalog\.has_function_privilege\(\s*'authenticated', 'public\.increment_view_count\(uuid\)', 'EXECUTE'\s*\)/,
  )
})
