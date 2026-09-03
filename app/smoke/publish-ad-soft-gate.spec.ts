import { test, expect, type Page } from '@playwright/test'
import { supabaseRefForBuild } from './supabase-ref'
import { CURRENT_CONSENT_VERSION } from '../src/legal'

/**
 * A solicitation verdict asks; it does not refuse.
 *
 * /api/moderate now also runs the listing past a chat model that answers one
 * question: is this an ad for off-platform services — 代写, 代购, 办证, 刷单 —
 * rather than a student selling something. That answer is a guess about copy
 * the server was willing to accept, and #290 is what happens when the client
 * turns a guess into a refusal: a publish the server had passed was blocked
 * with nothing the seller could do about it.
 *
 * So the verdict is a confirm. Cancel keeps the form exactly as it was;
 * "Post" publishes the listing unchanged.
 */

const UID = '11111111-1111-4111-8111-111111111111'
const GEN = 'publish-ad-gate-generation-0001'
const REF = supabaseRefForBuild()

const PROFILE = {
  id: UID, nickname: 'Test User', avatar_url: null, tos_version: CURRENT_CONSENT_VERSION,
  suspension_level: 0, suspended_until: null, is_illini_verified: true, bio: 'hi', location: 'UIUC',
}

const AD_TITLE = 'Homework help service, guaranteed A, ask me'
const AD_BODY = 'This reads like an ad for off-platform services. Illini Market is for students trading items on campus. Post anyway?'

async function openPublish(page: Page, verdict: string) {
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

  await page.route('**/api/moderate', route => route.fulfill({
    status: 200, contentType: 'application/json', body: verdict,
  }))

  await page.route('**/*.supabase.co/**', async route => {
    const url = route.request().url()
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

  const inputs = page.locator('input.uni-input-input')
  await inputs.nth(0).fill(AD_TITLE)
  await inputs.nth(1).fill('25')
  for (const field of ['Category', 'Condition']) {
    await page.locator(`uni-view.field-header:has-text("${field}")`).first().click()
    await page.locator('.pill-grid .sel-pill').first().click()
  }

  const submit = () => page.locator('uni-view.u-btn-primary:has-text("Post Item")').first().click()
  return { listingWrites, submit, title: inputs.nth(0) }
}

const SPAM_AD = JSON.stringify({
  flagged: false,
  categories: ['spam_ad'],
  ad: { ad: true, kind: 'daixie', confidence: 0.93 },
})

test('a listing read as an ad is questioned, and Cancel leaves the form alone', async ({ page }) => {
  const { listingWrites, submit, title } = await openPublish(page, SPAM_AD)
  await submit()

  const modal = page.locator('uni-modal')
  await expect(modal).toBeVisible({ timeout: 15_000 })
  await expect(modal).toContainText(AD_BODY)

  await modal.locator('.uni-modal__btn').filter({ hasText: 'Edit' }).first().click()
  await page.waitForTimeout(2_000)

  expect(listingWrites, 'Cancel published the listing anyway').toEqual([])
  await expect(title, 'the form was cleared out from under the seller').toHaveValue(AD_TITLE)
  const toast = await page.evaluate(() =>
    [...document.querySelectorAll('uni-toast, .uni-toast')].map(e => e.textContent!.trim()).filter(Boolean).join(' | '))
  expect(toast, 'cancelling their own confirm is not a failure to report').toBe('')
})

test('the same listing publishes when the seller says post anyway', async ({ page }) => {
  const { listingWrites, submit } = await openPublish(page, SPAM_AD)
  await submit()

  const modal = page.locator('uni-modal')
  await expect(modal).toBeVisible({ timeout: 15_000 })
  await modal.locator('.uni-modal__btn').filter({ hasText: 'Post' }).first().click()

  await expect.poll(() => listingWrites.length, { timeout: 15_000 }).toBeGreaterThan(0)
})

/**
 * The control. Without it both assertions above are satisfied by a page that
 * shows this dialog for every listing — or by one that cannot publish at all.
 */
test('an ordinary listing is never questioned', async ({ page }) => {
  const clean = JSON.stringify({
    flagged: false, categories: [], ad: { ad: false, kind: 'none', confidence: 0.95 },
  })
  const { listingWrites, submit } = await openPublish(page, clean)
  await submit()

  await expect.poll(() => listingWrites.length, { timeout: 15_000 }).toBeGreaterThan(0)
  expect(await page.locator('uni-modal').isVisible(), 'a clean listing was questioned').toBe(false)
})
