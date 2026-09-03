import { test, expect, type Page } from '@playwright/test'
import { supabaseRefForBuild, supabaseUrlForBuild } from './supabase-ref'
import { CURRENT_CONSENT_VERSION } from '../src/legal'

/**
 * A failed avatar upload must not end in a green checkmark.
 *
 * uploadImagesWithDims swallows per-file upload errors and returns a short
 * list, so a 500 from Storage leaves the edit page with `urls: []`, an old
 * avatar, and a profile row that saves fine. It fired "Avatar upload failed"
 * at that moment and then, once the row was written, fired "Saved!" with
 * icon: 'success' — which replaces it. Measured against the pre-fix build,
 * the failing and succeeding runs were indistinguishable from the outside:
 * both ended on "Saved!" and navigated back, and the warning never survived
 * long enough to be sampled at 60ms.
 *
 * publish/index.vue and plaza/index.vue already carry this kind of partial
 * failure to the terminal message and say why in a comment; this page was the
 * one that didn't.
 */

const SUPABASE_HOST = new URL(supabaseUrlForBuild()).hostname
const REF = supabaseRefForBuild()
const UID = '11111111-1111-4111-8111-111111111111'
const GEN = 'avatar-failure-generation-0001'

const PROFILE = {
  id: UID, nickname: 'Test User', avatar_url: null, tos_version: CURRENT_CONSENT_VERSION,
  suspension_level: 0, suspended_until: null, is_illini_verified: true, bio: 'hi', location: 'UIUC',
}

// Smallest valid PNG; the H5 path runs it through canvas compression.
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d494844520000000100000001080600000'
  + '01f15c4890000000a49444154789c6360000002000100'
  + '05fe02fea7000000004945'
  + '4e44ae426082',
  'hex',
)

async function seed(page: Page, { storageFails }: { storageFails: boolean }) {
  await page.addInitScript(([ref, uid, gen]) => {
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', 'en')
    localStorage.setItem('theme_pref', 'light')
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
      tag: 'caaci-auth-value-v2',
      generation: gen,
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

  // Narrow globs: src/api/ exists, so `**/api/**` would swallow module requests.
  await page.route('**/api/moderate*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: '{"flagged":false,"categories":[]}',
  }))
  await page.route('**/api/translate*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: '{"translated":""}',
  }))

  const storageStatus: number[] = []
  const profileWrites: string[] = []
  await page.route(`**/${SUPABASE_HOST}/**`, async (route) => {
    const path = route.request().url().replace(/^https:\/\/[^/]+/, '')
    if (path.includes('/storage/v1/object')) {
      if (route.request().method() === 'POST') storageStatus.push(storageFails ? 500 : 200)
      return storageFails
        ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' })
        : route.fulfill({ status: 200, contentType: 'application/json', body: '{"Key":"items/x/a.jpg"}' })
    }
    // The profile row itself always saves — that is what makes the success
    // toast plausible and the bug invisible.
    if (path.startsWith('/rest/v1/profiles') && route.request().method() === 'PATCH') {
      profileWrites.push(path)
      return route.fulfill({ status: 204, body: '' })
    }
    const body = path.includes('/rpc/get_my_profile') ? PROFILE : []
    await route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { 'content-range': '0-0/1' }, body: JSON.stringify(body),
    })
  })
  return { storageStatus, profileWrites }
}

async function saveWithAnAvatar(page: Page) {
  await page.goto('/#/pages/profile/edit', { waitUntil: 'networkidle' })
  await expect(page.locator('.avatar-section')).toBeVisible()

  const chooser = page.waitForEvent('filechooser')
  await page.locator('.avatar-section').click()
  await (await chooser).setFiles([{ name: 'a.png', mimeType: 'image/png', buffer: PNG }])
  // The preview swaps to the chosen file once uni.chooseImage resolves. uni's
  // <image> paints through a child div's background-image on H5, so the src
  // attribute of the custom element stays null and cannot be asserted on.
  await expect.poll(
    () => page.evaluate(() => {
      const host = document.querySelector('.avatar-preview')
      const painted = host?.querySelector('div')
      return painted ? getComputedStyle(painted).backgroundImage : ''
    }),
    { message: 'the chosen file must reach the preview before saving' },
  ).toMatch(/blob:|data:/)

  await page.locator('.save-btn').click()
}

const toastText = (page: Page) => page.locator('uni-toast').first().innerText().catch(() => '')

test('a failed avatar upload is the last thing the user is told', async ({ page }) => {
  const { storageStatus, profileWrites } = await seed(page, { storageFails: true })
  await saveWithAnAvatar(page)

  await expect.poll(() => toastText(page), {
    message: 'the terminal message must name the avatar failure, not report a clean save',
    timeout: 15_000,
  }).toContain('Avatar upload failed')

  // Nothing may quietly replace it afterwards.
  await page.waitForTimeout(2_000)
  expect(await toastText(page)).toContain('Avatar upload failed')

  expect(storageStatus, 'the upload must actually have been attempted and refused').toEqual([500])
  expect(profileWrites.length, 'the rest of the profile must still have saved').toBe(1)
})

/*
 * Control. Without it, deleting the success toast outright would make the
 * assertion above pass while leaving a worse app behind.
 */
test('a clean save still reports success', async ({ page }) => {
  const { storageStatus, profileWrites } = await seed(page, { storageFails: false })
  await saveWithAnAvatar(page)

  await expect.poll(() => toastText(page), {
    message: 'a save with no failures must still say so',
    timeout: 15_000,
  }).toContain('Saved')

  expect(await toastText(page)).not.toContain('Avatar upload failed')
  expect(storageStatus).toEqual([200])
  expect(profileWrites.length).toBe(1)
})
