import { test, expect, type Page } from '@playwright/test'

/**
 * Two ways the app used to strand a user on a screen that is not a screen.
 *
 * 1. The full-screen photo preview survived browser Back. uni.previewImage
 *    mounts its own Vue app on a <div id="u-a-p"> appended to <body>, outside
 *    the router's page tree, so popping the detail page off the stack left the
 *    preview painted over Home. Every photo surface in the app — detail, plaza,
 *    post, admin — opens it through that one API, which is what these tests
 *    drive.
 *
 * 2. An unknown hash route rendered nothing. uni-app's H5 router has no
 *    catch-all, and a returning user (welcomed set, so the first-run reLaunch
 *    to /welcome does not fire) got a white page: no text, no tab bar, no
 *    error.
 *
 * Coverage is behavioural: the assertion is whether the routed page is
 * reachable at a point on screen, not which element happens to be on top.
 * elementFromPoint is the only instrument that sees this — the home page's own
 * computed styles are correct underneath the orphaned overlay.
 */

// 1x1 transparent GIF, so the preview needs no network and no seeded listing.
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=='

// Home is registered as path '/' with alias '/pages/index/index'; a fallback
// may legitimately land on either spelling.
const HOME_HASH = /^#\/(pages\/index\/index)?$/

async function returningUser(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', 'en')
    localStorage.setItem('theme_pref', 'light')
  })
}

/**
 * True at each sample point when the routed page itself is what a tap would
 * hit. Three points rather than one: a partial overlay would still leave the
 * centre covered, and a single sample cannot tell the two apart.
 */
async function routedPageIsReachable(page: Page): Promise<boolean[]> {
  return page.evaluate(() => [[0.5, 0.5], [0.3, 0.35], [0.7, 0.75]].map(([fx, fy]) => {
    const el = document.elementFromPoint(
      Math.round(window.innerWidth * fx),
      Math.round(window.innerHeight * fy),
    )
    return !!el && !!el.closest('uni-page')
  }))
}

async function openHome(page: Page) {
  await page.goto('/#/pages/index/index', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.body.innerText.trim().length > 50)
}

async function openPreview(page: Page) {
  await page.evaluate((url) => {
    (window as any).uni.previewImage({ urls: [url], current: url })
  }, PIXEL)
  await expect.poll(
    async () => (await routedPageIsReachable(page)).every(hit => !hit),
    { message: 'the photo preview must cover the page it was opened from' },
  ).toBe(true)
}

test.describe('the app never leaves you on a screen you cannot use', () => {
  test('browser Back does not leave the photo preview over the page underneath', async ({ page }) => {
    await returningUser(page)
    await openHome(page)

    await page.evaluate(() => {
      (window as any).uni.navigateTo({ url: '/pages/detail/index?id=00000000-0000-4000-8000-000000000000' })
    })
    await expect.poll(async () => page.evaluate(() => location.hash)).toContain('/pages/detail/index')

    // Control: the preview opens and does cover the page it was opened from.
    // Without this the reachability assertion below could pass against a
    // preview that never opened at all.
    await openPreview(page)

    await page.goBack()
    await expect.poll(
      async () => page.evaluate(() => location.hash),
      { message: 'Back must pop the detail page' },
    ).toMatch(HOME_HASH)

    // Hold window: uni unmounts the preview app on nextTick, and nothing may
    // remount it afterwards. A single check right after Back would pass on
    // timing alone.
    await expect.poll(
      async () => routedPageIsReachable(page),
      { message: 'Home must be reachable after Back — no orphaned preview overlay' },
    ).toEqual([true, true, true])
    await page.waitForTimeout(1200)
    expect(await routedPageIsReachable(page)).toEqual([true, true, true])
  })

  test('the preview still opens and still closes on its own dismiss', async ({ page }) => {
    await returningUser(page)
    await openHome(page)
    expect(await routedPageIsReachable(page)).toEqual([true, true, true])

    await openPreview(page)

    // uni's preview closes on a tap anywhere on it. The route guard must not
    // be the only thing that can dismiss it.
    await page.mouse.click(
      Math.round(page.viewportSize()!.width * 0.5),
      Math.round(page.viewportSize()!.height * 0.5),
    )
    await expect.poll(
      async () => routedPageIsReachable(page),
      { message: 'tapping the preview must dismiss it' },
    ).toEqual([true, true, true])
  })
})

test.describe('an unknown hash route is not a blank page', () => {
  for (const hash of ['#/pages/nope/index', '#/foo/bar']) {
    test(`${hash} lands the returning user on Home`, async ({ page }) => {
      await returningUser(page)
      await page.goto(`/${hash}`, { waitUntil: 'domcontentloaded' })

      await expect.poll(
        async () => page.evaluate(() => location.hash),
        { message: 'an unroutable hash must fall back to Home' },
      ).toMatch(HOME_HASH)
      await expect.poll(
        async () => page.evaluate(() => document.body.innerText.trim().length),
        { message: 'Home must actually render' },
      ).toBeGreaterThan(50)
    })
  }

  test('a bad hash reached from inside the app falls back too', async ({ page }) => {
    // The cold-load path and the in-app path are two different hooks: a hash
    // typed into an already-running tab fires hashchange, which onLaunch never
    // sees.
    await returningUser(page)
    await openHome(page)

    await page.evaluate(() => { window.location.hash = '#/pages/nope/index' })
    await expect.poll(
      async () => page.evaluate(() => location.hash),
      { message: 'an unroutable hash must fall back to Home from inside the app too' },
    ).toMatch(HOME_HASH)
    expect(await page.evaluate(() => document.body.innerText.trim().length)).toBeGreaterThan(50)
  })

  test('a first-run user on a bad hash still gets Welcome, not Home', async ({ page }) => {
    // The fallback runs after the first-run branch on purpose: a brand-new
    // visitor with a stale link must still be introduced to the app.
    await page.addInitScript(() => {
      localStorage.removeItem('welcomed')
      localStorage.setItem('lang', 'en')
    })
    await page.goto('/#/pages/nope/index', { waitUntil: 'domcontentloaded' })

    await expect.poll(
      async () => page.evaluate(() => location.hash),
      { message: 'a first-run visitor must land on Welcome' },
    ).toContain('/pages/welcome/index')
  })

  test('a real route is left where it is', async ({ page }) => {
    // Control: the fallback must distinguish routes, not send everything Home.
    await returningUser(page)
    await page.goto('/#/pages/settings/index', { waitUntil: 'domcontentloaded' })

    await expect.poll(
      async () => page.evaluate(() => document.body.innerText.trim().length),
      { message: 'Settings must render' },
    ).toBeGreaterThan(50)
    await page.waitForTimeout(1200)
    expect(await page.evaluate(() => location.hash)).toBe('#/pages/settings/index')
  })
})
