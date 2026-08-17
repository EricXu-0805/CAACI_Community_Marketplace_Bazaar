import { test, expect, type Page } from '@playwright/test'
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

async function publishWith(page: Page, title: string) {
  const uploads: string[] = []
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

  await page.route('**/*.supabase.co/**', async route => {
    const url = route.request().url()
    if (url.includes('/storage/v1/object')) {
      uploads.push(url)
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"Key":"items/x/a.png"}' })
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
  await (await chooser).setFiles([{ name: 'a.png', mimeType: 'image/png', buffer: PNG }])

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
  return { uploads: uploads.length, toast }
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
