import { test, expect, type Page, type ConsoleMessage } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Page-load smoke: every route renders with no unexpected console errors,
 * in both light and dark, logged out. This is the regression net for big
 * sweeps (incl. wiring in the new UI library) — if a page throws on mount
 * or a component import breaks, this catches it.
 *
 * Auth-gated reads legitimately 401 when logged out; those are filtered.
 */
const PAGES = [
  'pages/index/index', 'pages/plaza/index', 'pages/post/index',
  'pages/publish/index', 'pages/publish/edit', 'pages/messages/index',
  'pages/profile/index', 'pages/detail/index', 'pages/chat/index',
  'pages/history/index', 'pages/legal/index', 'pages/welcome/index',
  'pages/settings/index', 'pages/seller/index', 'pages/profile/edit',
  'pages/notifications/index', 'pages/blocked/index', 'pages/reset-password/index',
  'pages/illini-verify/index', 'pages/login/index', 'pages/following/index',
  'pages/saved-searches/index', 'pages/search/index', 'pages/onboarding/index',
  'pages/reconsent/index', 'pages/profile-recovery/index',
  'pages/suspended/index', 'pages/admin/index',
]

// Console noise that is expected and not a regression.
const IGNORE = [
  // A logged-out page may legitimately probe an authenticated endpoint. Keep
  // this narrow: 404s, 429s and 5xx responses must remain visible to the test.
  /Failed to load resource: the server responded with a status of (401|403)/,
  /favicon/,
  // Playwright's bundled Chromium predates `interactive-widget` (Chrome 108+).
  // It logs this when parsing our viewport meta and then ignores the key — the
  // exact graceful-degradation fallback we rely on for pre-108 / pre-Safari-17.4
  // clients. Benign, not a regression. (app/index.html, useKeyboardHeight.ts)
  /Viewport argument key "interactive-widget" not recognized/,
]

function attachConsoleCollector(page: Page): string[] {
  const errs: string[] = []
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() !== 'error') return
    const t = m.text()
    if (!IGNORE.some(re => re.test(t))) errs.push(t.slice(0, 200))
  })
  page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 200)))
  page.on('response', (response) => {
    if (response.status() >= 500) {
      errs.push(`http ${response.status()}: ${response.url().slice(0, 160)}`)
    }
  })
  return errs
}

function reviewedSessionUserId(
  storage: Pick<Storage, 'length' | 'key' | 'getItem'> = localStorage,
): string {
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index) || ''
    if (!/^sb-[a-z0-9]+-auth-token$/.test(key)) continue
    try {
      const outer = JSON.parse(storage.getItem(key) || 'null')
      let session = outer
      if (outer && typeof outer === 'object' && 'tag' in outer) {
        if (
          outer.tag !== 'caaci-auth-value-v2'
          || typeof outer.generation !== 'string'
          || outer.generation.length < 8
          || outer.generation.length > 160
          || typeof outer.value !== 'string'
        ) continue
        session = JSON.parse(outer.value)
      }
      const userId = session?.user?.id
        || session?.currentSession?.user?.id
        || session?.session?.user?.id
      if (typeof userId === 'string') return userId.toLowerCase()
    } catch { /* malformed or unknown-tag storage must fail the exact-id gate */ }
  }
  return ''
}

test('authenticated smoke identity evidence supports the v2 envelope without exposing it', () => {
  const userId = '11111111-1111-4111-8111-111111111111'
  const values = new Map<string, string>([[
    'sb-abcdefghijklmnopqrst-auth-token',
    JSON.stringify({
      tag: 'caaci-auth-value-v2',
      generation: 'generation-verified-1',
      value: JSON.stringify({ user: { id: userId }, access_token: 'never-return-this' }),
    }),
  ]])
  const storage = {
    get length() { return values.size },
    key: (index: number) => [...values.keys()][index] || null,
    getItem: (key: string) => values.get(key) || null,
  }
  expect(reviewedSessionUserId(storage)).toBe(userId)

  values.set('sb-abcdefghijklmnopqrst-auth-token', JSON.stringify({
    tag: 'unknown-auth-envelope',
    generation: 'generation-verified-1',
    value: JSON.stringify({ user: { id: userId } }),
    user: { id: userId },
  }))
  expect(reviewedSessionUserId(storage)).toBe('')

  values.set('sb-abcdefghijklmnopqrst-auth-token', JSON.stringify({ user: { id: userId } }))
  expect(reviewedSessionUserId(storage)).toBe(userId)
})

test('smoke route list stays in sync with pages.json', () => {
  const configured = JSON.parse(
    readFileSync(resolve(process.cwd(), 'src/pages.json'), 'utf8'),
  ).pages.map((page: { path: string }) => page.path)
  expect([...PAGES].sort()).toEqual([...configured].sort())
})

test('settings actions expose real H5 button semantics and keyboard activation', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', 'en')
  })
  await page.goto('/#/pages/settings/index', { waitUntil: 'networkidle' })

  const expectedPublicActions = [
    'Language: English',
    'Appearance: Auto',
    'Terms, Privacy & Guidelines',
  ]
  for (const name of expectedPublicActions) {
    const action = page.getByRole('button', { name, exact: true })
    await expect(action).toBeVisible()
    await expect(action).toHaveAttribute('tabindex', '0')
  }
  const clearCache = page.getByRole('button', { name: /^Clear Cache:/ })
  await expect(clearCache).toBeVisible()
  await expect(clearCache).toHaveAttribute('tabindex', '0')

  // The version row is deliberately informational: it must not join the tab
  // sequence or masquerade as an action.
  const versionRow = page.locator('.menu-item').filter({ hasText: 'Version' })
  await expect(versionRow).not.toHaveAttribute('role', 'button')
  await expect(versionRow).not.toHaveAttribute('tabindex', '0')

  // A custom uni-view does not inherit native button keyboard behaviour.
  // The explicit Enter handler must open the language action sheet.
  await page.getByRole('button', { name: 'Language: English', exact: true }).press('Enter')
  await expect(page.locator('.uni-actionsheet')).toBeVisible()
})

test('profile listing action stays mouse and keyboard discoverable', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/profile/index.vue'), 'utf8')
  const start = source.indexOf('class="horz-more"')
  expect(start).toBeGreaterThan(-1)
  const moreAction = source.slice(start, source.indexOf('</view>', start))
  expect(moreAction).toContain('role="button"')
  expect(moreAction).toContain('tabindex="0"')
  expect(moreAction).toContain(':aria-label="t(\'a11y.more\')')
  expect(moreAction).toContain('@click.stop="onCardLongPress(item)"')
  expect(moreAction).toContain('@keydown.enter.stop.prevent="onCardLongPress(item)"')
  expect(moreAction).toContain('@keydown.space.stop.prevent="onCardLongPress(item)"')
})

for (const theme of ['light', 'dark'] as const) {
  test.describe(`page sweep [${theme}]`, () => {
    test.use({ colorScheme: theme })
    for (const route of PAGES) {
      test(`${route} loads clean`, async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem('welcomed', '1'))
        const errs = attachConsoleCollector(page)
        await page.goto(`/#/${route}`, { waitUntil: 'networkidle' })
        await page.waitForTimeout(1200)
        expect(errs, `console errors on ${route}`).toEqual([])
      })
    }
  })
}

// An expired/invalid email link (signup-confirm or recovery) redirects to
// `${origin}/#error=...&error_code=otp_expired` with no code. App.vue must
// rescue the root case to login instead of leaving an unroutable blank screen.
test('expired auth email link → login, not a blank screen', async ({ page }) => {
  const errs = attachConsoleCollector(page)
  await page.addInitScript(() => localStorage.setItem('welcomed', '1'))
  await page.goto('/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  expect(page.url(), 'error hash should be cleared').not.toContain('error_code')
  await expect(page.locator('uni-input input').first(), 'should land on a real page (login inputs)').toBeVisible()
  expect(errs, 'console errors during error-link recovery').toEqual([])
})

/**
 * Core logged-in flow — opt-in. Set SMOKE_EMAIL + SMOKE_PASSWORD and the
 * explicit SMOKE_ACCOUNT_IS_SYNTHETIC=true and
 * SMOKE_DATASET_IS_SYNTHETIC=true attestations to run it (all kept out of the
 * repo). This keeps personal credentials and production datasets out of the
 * authenticated sweep. It deliberately performs no writes, and CI records no
 * screenshots, traces, videos, or browser artifacts.
 */
const EMAIL = process.env.SMOKE_EMAIL
const PASSWORD = process.env.SMOKE_PASSWORD
const ACCOUNT_IS_SYNTHETIC = process.env.SMOKE_ACCOUNT_IS_SYNTHETIC === 'true'
const DATASET_IS_SYNTHETIC = process.env.SMOKE_DATASET_IS_SYNTHETIC === 'true'
const EXPECTED_PROJECT_REF = process.env.SMOKE_EXPECTED_SUPABASE_PROJECT_REF || ''
const EXPECTED_USER_ID = (process.env.SMOKE_EXPECTED_USER_ID || '').toLowerCase()
const CONFIGURED_SUPABASE_URL = process.env.VITE_SUPABASE_URL || ''
const EXACT_STAGING_TARGET = /^[a-z0-9]{20}$/.test(EXPECTED_PROJECT_REF)
  && CONFIGURED_SUPABASE_URL === `https://${EXPECTED_PROJECT_REF}.supabase.co`
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(EXPECTED_USER_ID)

test.describe('core flow (logged in)', () => {
  test.skip(
    !EMAIL || !PASSWORD || !ACCOUNT_IS_SYNTHETIC || !DATASET_IS_SYNTHETIC || !EXACT_STAGING_TARGET,
    'set the protected synthetic credentials, exact staging project ref, and exact expected user id',
  )

  test('login → authenticated page sweep (no console errors)', async ({ page }) => {
    const errs = attachConsoleCollector(page)
    await page.addInitScript(() => localStorage.setItem('welcomed', '1'))
    await page.goto('/#/pages/login/index', { waitUntil: 'networkidle' })
    await page.waitForTimeout(1000)
    const inputs = page.locator('uni-input input')
    await inputs.nth(0).fill(EMAIL!)
    await inputs.nth(1).fill(PASSWORD!)
    await page.locator('uni-button.submit-btn').click()
    await expect(page, 'valid smoke credentials must leave the login page')
      .not.toHaveURL(/\/pages\/login\/index/, { timeout: 15_000 })

    // Prove the session is usable instead of merely proving that a Locator
    // object exists. Invalid credentials used to pass because
    // `expect(locator).toBeTruthy()` only checked the JS object itself.
    await page.goto('/#/pages/profile/index', { waitUntil: 'networkidle' })
    await expect(page.locator('.logged-in-wrap'), 'profile must render authenticated state')
      .toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.login-section')).toHaveCount(0)

    // Bind the credential to one reviewed synthetic user, not merely to two
    // self-attestation strings. Supabase stores the current session under its
    // project-scoped auth key; never print or export the session itself.
    const sessionUserId = await page.evaluate(reviewedSessionUserId)
    expect(sessionUserId, 'authenticated smoke must be the reviewed synthetic account')
      .toBe(EXPECTED_USER_ID)

    // Runtime proof when the smoke account owns a listing. Empty accounts are
    // still covered by the source-level contract above.
    const listingCards = page.locator('.horz-card')
    if (await listingCards.count() > 0) {
      const moreAction = listingCards.first().locator('.horz-more')
      await expect(moreAction).toBeVisible()
      await expect(moreAction).toHaveAttribute('role', 'button')
      await expect(moreAction).toHaveAttribute('tabindex', '0')
      await moreAction.press('Enter')
      await expect(page.locator('.uni-actionsheet')).toBeVisible()
    }

    // Authenticated sweep — the logged-out sweep at the top can't reach
    // login-only code paths: realtime subscriptions, auth-gated renders, and
    // the motion-layer `:key` remounts firing against real data. Read-only;
    // no writes to prod.
    const AUTHED = [
      'pages/index/index', 'pages/plaza/index', 'pages/messages/index',
      'pages/profile/index', 'pages/notifications/index', 'pages/publish/index',
    ]
    for (const route of AUTHED) {
      await page.goto(`/#/${route}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(1800)
    }
    await expect(page.locator('uni-view.image-add, .submit-bar').first()).toBeVisible()

    expect(errs, 'console errors during authenticated sweep').toEqual([])
  })
})
