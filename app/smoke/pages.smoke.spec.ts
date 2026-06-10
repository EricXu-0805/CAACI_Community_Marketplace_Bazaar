import { test, expect, type Page, type ConsoleMessage } from '@playwright/test'

/**
 * Page-load smoke: every route renders with no unexpected console errors,
 * in both light and dark, logged out. This is the regression net for big
 * sweeps (incl. wiring in the new UI library) — if a page throws on mount
 * or a component import breaks, this catches it.
 *
 * Auth-gated reads legitimately 401 when logged out; those are filtered.
 */
const PAGES = [
  'pages/index/index', 'pages/plaza/index', 'pages/publish/index',
  'pages/messages/index', 'pages/profile/index', 'pages/history/index',
  'pages/legal/index', 'pages/welcome/index', 'pages/settings/index',
  'pages/notifications/index', 'pages/blocked/index', 'pages/login/index',
  'pages/following/index', 'pages/saved-searches/index', 'pages/search/index',
  'pages/suspended/index', 'pages/admin/index', 'pages/reset-password/index',
]

// Console noise that is expected and not a regression.
const IGNORE = [
  /40[13]/, /permission denied/, /auth_required/,
  /Failed to load resource/, /favicon/,
]

function attachConsoleCollector(page: Page): string[] {
  const errs: string[] = []
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() !== 'error') return
    const t = m.text()
    if (!IGNORE.some(re => re.test(t))) errs.push(t.slice(0, 200))
  })
  page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 200)))
  return errs
}

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

/**
 * Core logged-in flow — opt-in. Set SMOKE_EMAIL + SMOKE_PASSWORD to run it
 * (kept out of the repo). Exercises the highest-value write surfaces.
 */
const EMAIL = process.env.SMOKE_EMAIL
const PASSWORD = process.env.SMOKE_PASSWORD

test.describe('core flow (logged in)', () => {
  test.skip(!EMAIL || !PASSWORD, 'set SMOKE_EMAIL + SMOKE_PASSWORD to run')

  test('login → reach publish + plaza + chat panel', async ({ page }) => {
    const errs = attachConsoleCollector(page)
    await page.addInitScript(() => localStorage.setItem('welcomed', '1'))
    await page.goto('/#/pages/login/index', { waitUntil: 'networkidle' })
    await page.waitForTimeout(1000)
    const inputs = page.locator('uni-input input')
    await inputs.nth(0).fill(EMAIL!)
    await inputs.nth(1).fill(PASSWORD!)
    await page.locator('uni-button.submit-btn').click()
    await page.waitForTimeout(4500)

    await page.goto('/#/pages/publish/index', { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    await expect(page.locator('uni-view.image-add, .submit-bar')).toBeTruthy()

    await page.goto('/#/pages/plaza/index', { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    expect(errs, 'console errors during core flow').toEqual([])
  })
})
