import { test, expect, type Page } from '@playwright/test'
import { supabaseRefForBuild } from './supabase-ref'
import { CURRENT_CONSENT_VERSION } from '../src/legal'

/**
 * The translate control must not tell a signed-out reader it worked.
 *
 * Measured on production 2026-09-04, on the only live listing (a Chinese one):
 * tapping 文A while signed out flipped the glyph to A文 — the "showing the
 * translation" state — over completely unchanged Chinese, and issued no
 * request at all. /api/translate answers 401 without a session, and
 * toggleTranslate() flipped `translated` before asking, so the failure landed
 * in a ref nobody rendered.
 *
 * That matters more here than it looks: this is a bilingual campus
 * marketplace, every visitor is signed out before they sign up, and every
 * /share/ link opens signed out. The three sibling actions on that same screen
 * — Save, Report, Chat with Seller — all route to /pages/login/index?intent=…
 * when tapped signed out. Translate was the only one that lied instead.
 *
 * Session seeding is the recipe from a11y-authenticated.spec.ts: the boundary
 * key is `<storageKey>-auth-boundary-v2`, its generation must match the
 * envelope's or the fail-closed adapter drops the session, and tos_version
 * must equal CURRENT_CONSENT_VERSION or the consent gate takes the page.
 */

const REF = supabaseRefForBuild()
const UID = '11111111-1111-4111-8111-111111111111'
const GEN = 'translate-gate-generation-0001'
const ITEM = '77777777-7777-4777-8777-777777777777'

const ZH_TITLE = '宠物航空箱 XL'
const ZH_DESC = '宠物航空箱，九成新，校内自取'
const EN_TITLE = 'Pet Airline Carrier XL'

const PROFILE = {
  id: UID, nickname: 'Test User', avatar_url: null, tos_version: CURRENT_CONSENT_VERSION,
  suspension_level: 0, suspended_until: null, is_illini_verified: true, bio: 'hi', location: 'UIUC',
}

/*
 * source_lang 'zh' with only the zh key is the exact shape migration
 * 20260903061500 leaves behind, and the shape every Chinese listing on
 * production is in: there is no stored English, so the screen has nothing to
 * fall back to and the endpoint is the only way to read it.
 */
const ITEM_ROW = {
  id: ITEM, user_id: UID, title: ZH_TITLE, description: ZH_DESC,
  source_lang: 'zh',
  title_i18n: { zh: ZH_TITLE }, description_i18n: { zh: ZH_DESC },
  price: 120, category: 'other', condition: 'new', status: 'active', listing_type: 'sell',
  location: 'Illini Union', location_verified: false, images: [], image_dimensions: null,
  view_count: 4, favorite_count: 0, negotiable: true,
  created_at: '2026-08-31T05:27:44Z', updated_at: '2026-08-31T05:27:44Z', profile: PROFILE,
}

function fixtureFor(path: string): unknown {
  if (path.includes('/rest/v1/items')) return [ITEM_ROW]
  if (path.includes('/rest/v1/profiles')) return [PROFILE]
  if (path.includes('get_my_profile')) return PROFILE
  return []
}

async function serve(page: Page, translateCalls: string[]) {
  await page.route('**/*.supabase.co/**', async (route) => {
    const path = route.request().url().replace(/^https:\/\/[^/]+/, '')
    const fixture = fixtureFor(path)
    const wantsObject = (route.request().headers()['accept'] || '').includes('vnd.pgrst.object+json')
    const body = wantsObject && Array.isArray(fixture) ? (fixture[0] ?? null) : fixture
    await route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { 'content-range': '0-1/2' }, body: JSON.stringify(body),
    })
  })
  await page.route('**/api/translate', async (route) => {
    translateCalls.push(route.request().method())
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ translated: EN_TITLE }),
    })
  })
}

async function seedAnonymous(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', 'en')
    localStorage.setItem('theme_pref', 'light')
  })
}

async function seedSession(page: Page) {
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
}

test('a signed-out reader is sent to sign in, not shown a fake translation', async ({ page }) => {
  const translateCalls: string[] = []
  await seedAnonymous(page)
  await serve(page, translateCalls)

  await page.goto(`/#/pages/detail/index?id=${ITEM}`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.translate-btn'), 'the listing must render before the control is tapped')
    .toBeVisible({ timeout: 20_000 })

  await page.locator('.translate-btn').click()

  await expect(page, 'tapping translate signed out must route to login, the way Save and Report do')
    .toHaveURL(/\/pages\/login\/index/, { timeout: 15_000 })
  expect(translateCalls, 'no translation can be requested without a session').toEqual([])
})

test('the control does not claim the translated state it could not reach', async ({ page }) => {
  const translateCalls: string[] = []
  await seedAnonymous(page)
  await serve(page, translateCalls)

  await page.goto(`/#/pages/detail/index?id=${ITEM}`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.translate-btn')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.translate-btn')).toContainText('文A')

  await page.locator('.translate-btn').click()
  await page.waitForTimeout(2_000)

  /*
   * The bug was exactly this: A文 (the "showing translation" glyph) over text
   * that never changed. Whether the page has navigated away or stayed put, the
   * one thing that must never be true is the control claiming a state the
   * content is not in.
   */
  const stillOnDetail = /pages\/detail\/index/.test(page.url())
  if (stillOnDetail) {
    await expect(page.locator('.translate-btn'), 'the glyph must not flip when nothing was translated')
      .not.toContainText('A文')
  }
})

test('control: with a session the same tap really does translate', async ({ page }) => {
  const translateCalls: string[] = []
  await seedSession(page)
  await serve(page, translateCalls)

  await page.goto(`/#/pages/detail/index?id=${ITEM}`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.translate-btn')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('body'), 'the Chinese title is what a reader starts from')
    .toContainText(ZH_TITLE)

  await page.locator('.translate-btn').click()

  await expect(page.locator('body'), 'a signed-in reader gets the real translation')
    .toContainText(EN_TITLE, { timeout: 20_000 })
  expect(translateCalls.length, 'the endpoint must actually be called').toBeGreaterThan(0)
})
