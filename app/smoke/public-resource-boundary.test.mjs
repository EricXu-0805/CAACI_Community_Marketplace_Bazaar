import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const sourceUrl = new URL('../src/utils/publicResource.ts', import.meta.url)
const source = readFileSync(sourceUrl, 'utf8')

async function loadPublicResource(origin) {
  const compiled = ts.transpileModule(
    source.replace('import.meta.env.VITE_SUPABASE_URL', JSON.stringify(origin)),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    },
  ).outputText
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
}

function loadUtf8Length() {
  const match = source.match(
    /export function utf8Length\(value: string\): number \{[\s\S]*?\n\}/,
  )
  assert.ok(match, 'utf8Length implementation must remain directly testable')
  const javascript = match[0]
    .replace('export function', 'function')
    .replace('(value: string): number', '(value)')
  return Function(`${javascript}; return utf8Length`)()
}

test('public resource UTF-8 sizing is JSCore-safe and Unicode-correct', () => {
  assert.equal(source.includes('new TextEncoder'), false)
  const utf8Length = loadUtf8Length()
  for (const value of [
    '',
    'ASCII',
    '伊利诺伊',
    'a中b',
    '😀',
    '校友😀market',
    '\ud83d',
    '\udc00',
  ]) {
    assert.equal(utf8Length(value), Buffer.byteLength(value, 'utf8'), JSON.stringify(value))
  }
})

test('public media reads and writes fail closed around the exact configured origin', () => {
  assert.match(source, /url\.origin !== PUBLIC_STORAGE_ORIGIN/)
  assert.match(source, /storage\/v1\/object\/public\/item-images\/items\//)
  assert.match(source, /expectedOwner/)
  assert.match(source, /url\.search/)
  assert.match(source, /url\.hash/)
  assert.match(source, /throw new Error\('invalid_public_media'\)/)
  assert.match(source, /message\.message_type === 'text' \? message\.content : ''/)
})

test('avatar thumbnails validate exact origin and owner before constructing a render URL', async () => {
  const origin = 'https://abcdefghijklmnopqrst.supabase.co'
  const owner = '11111111-1111-4111-8111-111111111111'
  const other = '22222222-2222-4222-8222-222222222222'
  const raw = `${origin}/storage/v1/object/public/item-images/items/${owner}/avatar.webp`
  const resources = await loadPublicResource(origin)

  assert.equal(
    resources.safeAvatarThumbUrl(raw, owner),
    `${origin}/storage/v1/render/image/public/item-images/items/${owner}/avatar.webp?width=96&height=96&quality=75&resize=cover`,
  )
  assert.equal(resources.safeAvatarThumbUrl(raw, other), '')
  assert.equal(resources.safeAvatarThumbUrl(raw, null), '')
  assert.equal(resources.safeAvatarThumbUrl(`${raw}?download=1`, owner), '')
  assert.equal(
    resources.safeAvatarThumbUrl(
      `https://attacker.example/storage/v1/object/public/item-images/items/${owner}/avatar.webp`,
      owner,
    ),
    '',
  )
})

test('public banners render only exact-origin deterministic managed uploads', async () => {
  const origin = 'https://abcdefghijklmnopqrst.supabase.co'
  const tokenId = '11111111-1111-4111-8111-111111111111'
  const idempotencyKey = '22222222-2222-4222-8222-222222222222'
  const path = `/storage/v1/object/public/banners/managed/${tokenId}/${idempotencyKey}/${'a'.repeat(64)}.png`
  const resources = await loadPublicResource(origin)

  assert.equal(resources.safeManagedBannerUrl(`${origin}${path}`), `${origin}${path}`)
  for (const candidate of [
    `https://tracker.example${path}`,
    `${origin}${path}?download=1`,
    `${origin}${path}#tracking`,
    `${origin}/storage/v1/object/public/banners/legacy.png`,
    `${origin}/storage/v1/object/public/item-images${path}`,
  ]) {
    assert.equal(resources.safeManagedBannerUrl(candidate), '', candidate)
  }

  const banners = readFileSync(new URL('../src/composables/useBanners.ts', import.meta.url), 'utf8')
  assert.match(banners, /safeManagedBannerUrl\(banner\.image_url\)/)
  assert.match(banners, /imageUrl \? \[\{ \.\.\.banner, image_url: imageUrl \}\] : \[\]/)
})

test('public listing storage stays image-only and matches the client 5 MiB ceiling', () => {
  const migration = readFileSync(
    new URL('../../supabase/migrations/20260718230000_authoritative_public_write_resource_boundaries.sql', import.meta.url),
    'utf8',
  )
  const verify = readFileSync(
    new URL('../../supabase/_ops/VERIFY_20260718230000_authoritative_public_write_resource_boundaries.sql', import.meta.url),
    'utf8',
  )
  const regression = readFileSync(
    new URL('../../supabase/_ops/REGRESSION_20260718230000_authoritative_public_write_resource_boundaries.sql', import.meta.url),
    'utf8',
  )
  const items = readFileSync(new URL('../src/composables/useItems.ts', import.meta.url), 'utf8')

  assert.match(items, /const MAX_FILE_SIZE = 5 \* 1024 \* 1024/)
  assert.doesNotMatch(items, /uploadOneVideo|MAX_VIDEO_SIZE|VIDEO_UPLOAD_TIMEOUT_MS/)
  assert.match(migration, /SET file_size_limit = 5242880,/)
  assert.match(migration, /IF declared_size > 5242880 THEN/)
  assert.doesNotMatch(migration, /'video\//)
  assert.match(verify, /bucket_record\.file_size_limit <> 5242880/)
  assert.match(regression, /"size":5242881/)
})
