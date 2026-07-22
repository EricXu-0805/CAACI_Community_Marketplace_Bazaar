import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'

const ROOT = new URL('../', import.meta.url)

test('every listing flow that can invoke reverse geocoding shows linked OpenStreetMap attribution', async () => {
  const [publish, edit, attribution, en, zh, location] = await Promise.all([
    readFile(new URL('src/pages/publish/index.vue', ROOT), 'utf8'),
    readFile(new URL('src/pages/publish/edit.vue', ROOT), 'utf8'),
    readFile(new URL('src/components/OsmAttribution.vue', ROOT), 'utf8'),
    readFile(new URL('src/composables/i18n/messages/en.ts', ROOT), 'utf8'),
    readFile(new URL('src/composables/i18n/messages/zh.ts', ROOT), 'utf8'),
    readFile(new URL('src/composables/useLocation.ts', ROOT), 'utf8'),
  ])

  for (const source of [publish, edit]) {
    assert.match(source, /<OsmAttribution\s*\/>/)
    assert.match(source, /import OsmAttribution from/)
  }
  assert.match(attribution, /publish\.osmAttribution/)
  assert.match(en, /'publish\.osmAttribution': '© OpenStreetMap contributors'/)
  assert.match(zh, /'publish\.osmAttribution': '© OpenStreetMap contributors'/)
  assert.match(attribution, /https:\/\/www\.openstreetmap\.org\/copyright/)
  assert.match(attribution, /role="link"/)
  assert.match(attribution, /@keyup\.enter=/)
  assert.match(location, /const queryLat = lat\.toFixed\(3\)/)
  assert.match(location, /const queryLng = lng\.toFixed\(3\)/)
  assert.match(location, /geocode\?lat=\$\{queryLat\}&lon=\$\{queryLng\}/)
  assert.doesNotMatch(location, /lat\.toFixed\([45]\).*lng\.toFixed\([45]\)/s)
  assert.match(location, /return precise \|\| city \|\| region \|\| null/)
  assert.match(location, /LOCATION_FIX_TIMEOUT_MS\s*=\s*15_000/)
  assert.match(location, /GEOCODE_REQUEST_TIMEOUT_MS\s*=\s*8_000/)
  assert.match(location, /reject\(\{ code: 3, message: 'location deadline exceeded' \}\)/)
  assert.match(location, /timeout: GEOCODE_REQUEST_TIMEOUT_MS/)
})

test('cached location is short-lived and cleared at every account transition', async () => {
  const source = await readFile(new URL('src/composables/useLocation.ts', ROOT), 'utf8')
  assert.match(source, /LOCATION_CACHE_TTL_MS\s*=\s*5 \* 60 \* 1000/)
  assert.match(source, /onAccountTransition\(\(\) => \{[\s\S]*?cachedLocation\.value = ''[\s\S]*?cachedLocationAt = 0/)
  assert.match(source, /Date\.now\(\) - cachedLocationAt < LOCATION_CACHE_TTL_MS/)
  assert.match(source, /cachedLocationAt = Date\.now\(\)/)
})
