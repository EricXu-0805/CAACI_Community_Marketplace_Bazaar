import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

/**
 * The dimensions we persist have to be a shape the write guard accepts.
 *
 * safeDimensions() was written as a read sanitizer for hostile rows and then
 * reused to validate our own writes, so three legitimate shapes were rejected:
 * a real camera resolution (a current iPhone shoots 24 MP, one pixel over the
 * ceiling), the { w: 0, h: 0 } slot the edit flow sends for a kept photo it
 * cannot measure, and an array shorter than images[] when one measurement
 * failed. All three surfaced as invalid_image_dimensions, a machine string.
 */

const OWNER = '11111111-1111-4111-8111-111111111111'
const ORIGIN = 'https://lfhvgprfphyfvhidegum.supabase.co'

async function load(rel, name) {
  const { transformSync } = await import('esbuild')
  const ts = (await readFile(new URL(rel, import.meta.url), 'utf8'))
    .replace(/import\.meta\.env\.VITE_SUPABASE_URL/g, JSON.stringify(ORIGIN))
  const { code } = transformSync(ts, { loader: 'ts', format: 'cjs' })
  const module = { exports: {} }
  new Function('module', 'exports', 'require', code)(module, module.exports, () => ({}))
  return module.exports[name]
}

const urls = n => Array.from({ length: n }, (_, i) =>
  `${ORIGIN}/storage/v1/object/public/item-images/items/${OWNER}/pic${i}.jpg`)

/*
 * Sizes a phone actually produces. 5712x4284 is the iPhone 15/16 default and
 * is 24 469 008 pixels — the guard's ceiling is 24 000 000.
 */
const CAMERA_SIZES = [
  { label: 'iPhone 12 MP', w: 4032, h: 3024 },
  { label: 'iPhone 24 MP', w: 5712, h: 4284 },
  { label: 'iPhone 48 MP', w: 8064, h: 6048 },
  { label: 'panorama', w: 12000, h: 2000 },
  { label: 'screenshot', w: 1179, h: 2556 },
]

test('every resolution a phone shoots survives measurement and the write guard', async () => {
  const storedImageDimensions = await load('../src/utils/index.ts', 'storedImageDimensions')
  const assertPublicMediaWrite = await load('../src/utils/publicResource.ts', 'assertPublicMediaWrite')

  for (const { label, w, h } of CAMERA_SIZES) {
    const stored = storedImageDimensions({ w, h })
    assert.doesNotThrow(
      () => assertPublicMediaWrite(urls(1), OWNER, 9, [stored]),
      `${label} (${w}x${h}) cannot be published`,
    )
    // Only the ratio is ever read back, so scaling has to preserve it exactly
    // enough that a card reserves the same slot.
    assert.ok(
      Math.abs(stored.w / stored.h - w / h) < 0.005,
      `${label} lost its aspect ratio: ${w}x${h} became ${stored.w}x${stored.h}`,
    )
  }
})

test('an unmeasurable photo keeps its slot instead of shortening the array', async () => {
  const assertPublicMediaWrite = await load('../src/utils/publicResource.ts', 'assertPublicMediaWrite')
  const unknown = { w: 0, h: 0 }

  // The edit flow: one photo kept from the existing listing (a remote URL it
  // cannot measure) plus one newly uploaded.
  assert.doesNotThrow(() => assertPublicMediaWrite(urls(2), OWNER, 9, [unknown, { w: 1080, h: 810 }]))
  assert.doesNotThrow(() => assertPublicMediaWrite(urls(1), OWNER, 9, [unknown]))
  // The whole-array legacy form stays legal.
  assert.doesNotThrow(() => assertPublicMediaWrite(urls(2), OWNER, 9, []))
})

/*
 * The control. Loosening the guard until it accepts our writes is only correct
 * if it still rejects what it was written to reject: a row that does not line
 * up with images[], a half-known pair, and an absurd size arriving straight
 * from the database rather than from our own measurement.
 */
test('the guard still rejects what it was written to reject', async () => {
  const assertPublicMediaWrite = await load('../src/utils/publicResource.ts', 'assertPublicMediaWrite')
  const rejected = [
    ['fewer dimensions than images', urls(2), [{ w: 1080, h: 810 }]],
    ['more dimensions than images', urls(1), [{ w: 1080, h: 810 }, { w: 1080, h: 810 }]],
    ['half-known pair', urls(1), [{ w: 0, h: 600 }]],
    ['negative side', urls(1), [{ w: -1080, h: -810 }]],
    ['non-integer', urls(1), [{ w: 1080.5, h: 810 }]],
    ['past the pixel ceiling', urls(1), [{ w: 5712, h: 4284 }]],
    ['past the per-side ceiling', urls(1), [{ w: 12000, h: 2 }]],
  ]
  for (const [label, u, dims] of rejected) {
    assert.throws(
      () => assertPublicMediaWrite(u, OWNER, 9, dims),
      /invalid_image_dimensions/,
      `the guard accepted ${label}`,
    )
  }
})
