import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

const [
  utils,
  envTypes,
  vite,
  en,
  zh,
  packageJsonText,
  lockText,
  useItems,
  onboarding,
  plaza,
  publish,
  publishEdit,
  profileEdit,
] = await Promise.all([
  'app/src/utils/index.ts',
  'app/src/env.d.ts',
  'app/vite.config.ts',
  'app/src/composables/i18n/messages/en.ts',
  'app/src/composables/i18n/messages/zh.ts',
  'app/package.json',
  'app/package-lock.json',
  'app/src/composables/useItems.ts',
  'app/src/pages/onboarding/index.vue',
  'app/src/pages/plaza/index.vue',
  'app/src/pages/publish/index.vue',
  'app/src/pages/publish/edit.vue',
  'app/src/pages/profile/edit.vue',
].map((file) => readFile(new URL(file, root), 'utf8')))

test('H5 HEIC handling is native-only and fails closed when native decoding is unavailable', () => {
  assert.match(utils, /heicInput = await looksLikeHeic\(origBlob\)/)
  assert.match(utils, /bitmap = await createImageBitmap\(origBlob, \{ imageOrientation:/)
  assert.match(utils, /throw makeHeicError\(`native HEIC decode unsupported:/)
  assert.match(utils, /if \(!heicInput && longEdge <= maxLongEdge\)/)
  assert.match(utils, /const ratio = longEdge > maxLongEdge \? maxLongEdge \/ longEdge : 1/)
  assert.match(utils, /if \(heicInput && !dataUrl\.startsWith\('data:image\/jpeg'\)\)/)
  assert.match(utils, /message: 'heic native-encoded'/)
  assert.doesNotMatch(utils, /heic-to|libheif|heicToJpegBlob/)
})

test('removed decoder cannot re-enter dependency, type, or chunk boundaries silently', () => {
  const packageJson = JSON.parse(packageJsonText)
  const lock = JSON.parse(lockText)
  assert.equal(packageJson.dependencies?.['heic-to'], undefined)
  assert.equal(lock.packages?.['node_modules/heic-to'], undefined)
  assert.doesNotMatch(envTypes, /heic-to/)
  assert.doesNotMatch(vite, /heic-to|libheif/)
})

test('every active HEIC upload surface preserves explicit unsupported-format handling', () => {
  assert.match(useItems, /\?\.heic === true/)
  assert.match(useItems, /items\.heic_batch_upload_cleanup/)
  for (const [surface, source] of [
    ['onboarding', onboarding],
    ['plaza', plaza],
    ['publish', publish],
    ['publish edit', publishEdit],
    ['profile edit', profileEdit],
  ]) {
    assert.match(source, /\?\.heic === true/, `${surface} must surface the HEIC marker explicitly`)
  }
  assert.match(en, /'heic\.unsupported': 'Image format not supported/)
  assert.match(zh, /'heic\.unsupported': '这种图片格式不支持/)
  assert.doesNotMatch(en, /heic\.converting/)
  assert.doesNotMatch(zh, /heic\.converting/)
})
