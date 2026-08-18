import { test, expect, type Page } from '@playwright/test'
import zlib from 'node:zlib'
import { supabaseRefForBuild } from './supabase-ref'

/**
 * A listing that will be refused must be refused before its photos are sent.
 *
 * publish's own gate was four presence checks; every content rule lived inside
 * createItem, which runs after the upload. So a one-character title — "桌",
 * "床", "书" are ordinary Chinese listing titles — cost a full nine-image
 * upload over campus wifi and then failed with "Content is too short", which
 * names no field.
 *
 * Measured on the unfixed page: the same submit fired two storage requests
 * before the refusal.
 */

const UID = '11111111-1111-4111-8111-111111111111'
const GEN = 'publish-order-generation-0001'

const REF = supabaseRefForBuild()

const PROFILE = {
  id: UID, nickname: 'Test User', avatar_url: null, tos_version: '2026-08-01',
  suspension_level: 0, suspended_until: null, is_illini_verified: true, bio: 'hi', location: 'UIUC',
}

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d494844520000000100000001080600000'
  + '01f15c4890000000a49444154789c6360000002000100'
  + '05fe02fea7000000004945' + '4e44ae426082', 'hex')

function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = c ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed))
  return Buffer.concat([len, typed, crc])
}

/*
 * A real photo at a real camera resolution. Blank grayscale, so 24 megapixels
 * deflate to about 24 KB — the browser still decodes it at full size, which is
 * the only part that matters here.
 */
function photoOfSize(w: number, h: number): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(Buffer.alloc((w + 1) * h), { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

async function publishWith(page: Page, title: string, photo: Buffer | Buffer[] = PNG) {
  const uploads: string[] = []
  const listingWrites: string[] = []
  await page.addInitScript(([ref, uid, gen]) => {
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', 'en')
    localStorage.setItem('theme_pref', 'light')
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
      tag: 'caaci-auth-value-v2', generation: gen,
      value: JSON.stringify({
        access_token: 'stub', token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'stub',
        user: { id: uid, email: 'a@illinois.edu', aud: 'authenticated', role: 'authenticated' },
      }),
    }))
    localStorage.setItem(`sb-${ref}-auth-token-auth-boundary-v2`, JSON.stringify({
      v: 2, mode: 'allowed', generation: gen,
    }))
  }, [REF, UID, GEN] as const)

  /* The dev server has no /api routes, so an unstubbed moderation call 404s
     and the submit dies before the listing insert it is here to observe. */
  await page.route('**/api/moderate', route => route.fulfill({
    status: 200, contentType: 'application/json', body: '{"flagged":false,"categories":[]}',
  }))

  await page.route('**/*.supabase.co/**', async route => {
    const url = route.request().url()
    if (url.includes('/storage/v1/object')) {
      uploads.push(url)
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"Key":"items/x/a.png"}' })
    }
    if (route.request().method() === 'POST' && url.includes('/rest/v1/items')) {
      listingWrites.push(url)
    }
    const body = url.includes('/rpc/get_my_profile') ? PROFILE : []
    await route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { 'content-range': '0-0/1' }, body: JSON.stringify(body),
    })
  })

  await page.goto('/#/pages/publish/index', { waitUntil: 'networkidle' })
  await expect(page.locator('.image-add').first()).toBeVisible({ timeout: 15_000 })

  const chooser = page.waitForEvent('filechooser', { timeout: 10_000 })
  await page.locator('.image-add').first().click()
  await (await chooser).setFiles(
    (Array.isArray(photo) ? photo : [photo]).map((buffer, i) => ({
      name: `a${i}.png`, mimeType: 'image/png', buffer,
    })),
  )

  const inputs = page.locator('input.uni-input-input')
  await inputs.nth(0).fill(title)
  await inputs.nth(1).fill('25')
  for (const field of ['Category', 'Condition']) {
    await page.locator(`uni-view.field-header:has-text("${field}")`).first().click()
    await page.locator('.pill-grid .sel-pill').first().click()
  }

  await page.locator('uni-view.u-btn-primary:has-text("Post Item")').first().click()
  await page.waitForTimeout(3_000)

  const toast = await page.evaluate(() =>
    [...document.querySelectorAll('uni-toast, .uni-toast')].map(e => e.textContent!.trim()).filter(Boolean).join(' | '))
  return { uploads: uploads.length, listingWrites: listingWrites.length, toast }
}

test('a title too short to publish costs no photo upload', async ({ page }) => {
  const { uploads, toast } = await publishWith(page, '桌')

  expect(uploads, 'the photo was uploaded before the title was checked').toBe(0)
  expect(toast, 'the refusal must name the field, not just say "content"').toMatch(/Title/i)
})

/**
 * The control. Without it the assertion above is satisfied by a submit button
 * that no longer uploads anything at all.
 */
test('a valid listing still reaches the upload', async ({ page }) => {
  const { uploads } = await publishWith(page, 'Desk lamp barely used')
  expect(uploads, 'a good listing stopped uploading its photos').toBeGreaterThan(0)
})

/**
 * The photo a student actually takes has to be publishable.
 *
 * Dimensions were measured on the file the camera produced, but the object
 * that reaches storage is resized to a 1080px long edge first. The write guard
 * rejects anything past 24 000 000 pixels, and an iPhone 15/16 shoots 24 MP on
 * the default setting — 5712x4284 is 24 469 008. So every photo from a recent
 * phone threw invalid_image_dimensions, which is a machine string: the student
 * saw "Something went wrong", and retrying produced it again.
 *
 * Measured on the unfixed page: zero listing writes for a 24 MP photo,
 * one for the same shot at 12 MP.
 */
test('a photo at the default resolution of a current iPhone can be published', async ({ page }) => {
  const { listingWrites, toast } = await publishWith(page, 'Desk lamp barely used', photoOfSize(5712, 4284))

  expect(listingWrites, 'a 24 MP photo never reached the listing insert').toBeGreaterThan(0)
  expect(toast, 'the student was told nothing about what failed').not.toMatch(/went wrong|操作失败/i)
})

/**
 * The control. A resolution that always worked must still work, so the
 * assertion above cannot be satisfied by a publish that stopped checking
 * dimensions at all — or by one that stopped uploading photos.
 */
test('a photo at 12 MP still publishes', async ({ page }) => {
  const { uploads, listingWrites } = await publishWith(page, 'Desk lamp barely used', photoOfSize(4032, 3024))

  expect(uploads, 'the photo was never uploaded').toBeGreaterThan(0)
  expect(listingWrites, 'a 12 MP photo never reached the listing insert').toBeGreaterThan(0)
})

/**
 * A photo the browser will upload but refuses to decode still has a slot.
 *
 * getImageDimensions() answers { w: 0, h: 0 } when it cannot measure — a
 * truncated file off a phone that ran out of space, say. Publish used to drop
 * those entries, which left image_dimensions[] shorter than images[], and the
 * write guard rejects an array that does not line up one-to-one. One
 * unreadable photo out of nine failed the entire listing.
 */
test('one photo that cannot be measured does not fail the whole listing', async ({ page }) => {
  const truncated = photoOfSize(1200, 900).subarray(0, 60)
  const { uploads, listingWrites } = await publishWith(
    page, 'Desk lamp barely used', [photoOfSize(1200, 900), truncated],
  )

  expect(uploads, 'nothing was uploaded at all').toBeGreaterThan(0)
  expect(listingWrites, 'an unmeasurable photo took the listing down with it').toBeGreaterThan(0)
})
