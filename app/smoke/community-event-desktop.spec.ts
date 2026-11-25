import { test, expect, type Page } from '@playwright/test'
import { installMemberEvents, EVENT_ID, NOW } from './community-member-event-fixture'
import { visualAudit } from './visual-audit'

async function fixture(page: Page, options: { lang?: 'zh' | 'en'; theme?: 'light' | 'dark'; guest?: boolean } = {}) {
  const state = await installMemberEvents(page, {
    reader: options.guest ? 'guest' : 'member', lang: options.lang ?? 'en', theme: options.theme ?? 'light',
  })
  state.rows = Array.from({ length: 20 }, (_, index) => ({
    ...state.member,
    id: index === 0 ? EVENT_ID : `70000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    source_type: index === 0 ? 'caaci' as const : 'member' as const,
    title: `合成活动 ${index + 1}`, title_en: `Synthetic event ${index + 1}`,
    summary: 'Synthetic description.', summary_en: 'Synthetic description.',
    starts_at: new Date(NOW + (index + 1) * 86_400_000).toISOString(),
    ends_at: new Date(NOW + (index + 1) * 86_400_000 + 3_600_000).toISOString(),
    cancelled_at: index === 1 ? new Date(NOW).toISOString() : null,
  }))
  await page.route('**/rest/v1/community_event_sync_state?**', route => route.fulfill({
    contentType: 'application/json', body: '{"source":"caaci","last_success_at":"2026-11-12T20:05:00Z"}',
  }))
  await page.route(/https:\/\/(?:[^/]+\.)?caaciorg\.com\//, () => { throw new Error('Forbidden external request') })
  return state
}

const header = (page: Page) => page.locator('.ev-desktop-header:visible .cx-hdr')
const eventsNav = (page: Page) => header(page).locator('[data-test="nav-events"]')
const stackSize = (page: Page) => page.evaluate(() => getCurrentPages().length)

for (const width of [390, 768, 1280]) {
  test.describe(`event chrome at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, screen: { width, height: 900 }, isMobile: width === 390, deviceScaleFactor: 1 })
    for (const route of ['list', 'detail', 'create'] as const) {
      test(`${route} keeps the required header and back behavior`, async ({ page }) => {
        await fixture(page)
        const path = route === 'list' ? 'pages/events/index'
          : route === 'detail' ? `pages/event/detail/index?id=${EVENT_ID}` : 'pages/event/create/index'
        await page.goto(`/#/${path}`, { waitUntil: 'networkidle' })
        await expect(page.locator(route === 'list' ? '.evc-title' : route === 'detail' ? '.ed-title' : '.me-form').first()).toBeVisible()
        const back = page.locator(route === 'create' ? '.me-header .u-btn' : '.header .back-btn')
        if (width === 1280) {
          await expect(header(page)).toBeVisible()
          await expect(header(page)).toHaveCSS('height', '56px')
          await expect(header(page).locator('.cx-nav-on')).toHaveText('Events')
          await expect(page.locator('.app-sidebar')).toHaveCSS('display', 'none')
          if (route === 'list') await expect(back).toBeHidden()
          else await expect(back).toBeVisible()
        } else {
          await expect(page.locator('.ev-desktop-header, .cx-hdr, .cx-m')).toHaveCount(0)
          await expect(back).toBeVisible()
          if (width === 768) await expect(page.locator('.app-sidebar')).toBeVisible()
          else await expect(page.locator('.app-sidebar')).toBeHidden()
          if (route === 'list') await expect(page.locator('.ev-chips')).toHaveCSS('top', '0px')
        }
        if (route === 'list' && width === 1280) {
          const metrics = await page.evaluate(() => {
            const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().width
            return { container: box('.secondary-content'), main: box('.ev-main'), sidebar: box('.events-sidebar'), chips: box('.ev-chips') }
          })
          expect(metrics).toEqual({ container: 1200, main: 876, sidebar: 300, chips: 876 })
          console.log(`EVENT_LAYOUT ${JSON.stringify(metrics)}`)
          await expect(page.locator('.ev-side-h')).toHaveText('Reading the sources')
          await expect(page.locator('.ev-create-h')).toHaveText('Want to organize an event?')
          await expect(page.locator('.ev-side-row')).toHaveCount(4)
          await expect(page.locator('.header .me-entry')).toHaveCSS('box-shadow', /inset/)
          await expect(page.locator('.header-title')).toHaveCSS('font-size', '22px')
        }
        await page.screenshot({ path: `test-results/d59-desktop/${route}-${width}-en-light.png`, animations: 'disabled' })
        // Below 1024 the unchanged shared rail is outside this event-page contract.
        const audit = await visualAudit(page, `event-${route}-${width}-en-light`, {
          include: width >= 1024 ? '.page.secondary-page' : '.secondary-content',
        })
        expect(audit).toEqual({ small: [], contrast: [], axe: [], overflow: 0 })
      })
    }
  })
}

test.describe('desktop event navigation', () => {
  test.use({ viewport: { width: 1280, height: 800 }, screen: { width: 1280, height: 800 }, isMobile: false, deviceScaleFactor: 1 })

  test('list header and source filters remain usable at the bottom without a duplicate stack entry', async ({ page }) => {
    await fixture(page)
    await page.goto('/#/pages/events/index', { waitUntil: 'networkidle' })
    const before = await stackSize(page)
    await eventsNav(page).click()
    expect(await stackSize(page)).toBe(before)
    await page.locator('[data-test="events-stale"]').scrollIntoViewIfNeeded()
    await expect(header(page)).toBeInViewport()
    const top = await header(page).evaluate(el => el.getBoundingClientRect().top)
    expect(Math.abs(top)).toBeLessThanOrEqual(1)
    const chipsTop = await page.locator('.ev-chips').evaluate(el => el.getBoundingClientRect().top)
    const headerBottom = await header(page).evaluate(el => el.getBoundingClientRect().bottom)
    expect(Math.abs(chipsTop - headerBottom)).toBeLessThanOrEqual(1)
    await page.locator('[data-filter="caaci"]').click()
    await expect(page.locator('.ev-main .evc-title')).toHaveText(['Synthetic event 1'])
  })

  for (const destination of ['detail', 'create'] as const) {
    test(`${destination} events navigation returns to the existing list`, async ({ page }) => {
      await fixture(page)
      await page.goto('/#/pages/events/index', { waitUntil: 'networkidle' })
      const before = await stackSize(page)
      if (destination === 'detail') await page.locator('.evc').first().click()
      else await page.locator('.header .me-entry').click()
      await expect(page.locator(destination === 'detail' ? '.ed-title' : '.me-form')).toBeVisible()
      expect(await stackSize(page)).toBe(before + 1)
      await eventsNav(page).click()
      await expect(page.locator('.ev-main .evc').first()).toBeVisible()
      expect(await stackSize(page)).toBe(before)
    })

    test(`direct ${destination} events navigation replaces the page`, async ({ page }) => {
      await fixture(page)
      await page.goto(`/#/pages/event/${destination}/index${destination === 'detail' ? `?id=${EVENT_ID}` : ''}`, { waitUntil: 'networkidle' })
      const before = await stackSize(page)
      await eventsNav(page).click()
      await expect(page.locator('.ev-main .evc').first()).toBeVisible()
      expect(await stackSize(page)).toBe(before)
    })
  }

  for (const action of ['home', 'all', 'board', 'compose', 'login'] as const) {
    test(`${action} control reaches its destination after a previous plaza view`, async ({ page }) => {
      await fixture(page, { guest: true })
      const previousView = action === 'all' ? 'home' : 'all'
      await page.goto(`/#/pages/plaza/index?view=${previousView}`, { waitUntil: 'networkidle' })
      await page.locator('.cx-hdr [data-test="nav-events"]').click()
      await expect(header(page)).toBeVisible()
      if (action === 'home') await header(page).locator('.cx-brand').click()
      if (action === 'compose') await header(page).locator('.cx-compose').click()
      if (action === 'login') await header(page).locator('.cx-login').click()
      if (action === 'all' || action === 'board') {
        await header(page).locator('[aria-controls="cx-boards"]').click()
        await header(page).locator(action === 'all' ? '.cx-pop-all' : '.cx-pop-i').first().click()
      }
      if (action === 'login') await expect(page).toHaveURL(/pages\/login\/index/)
      else {
        await expect(page).toHaveURL(/pages\/plaza\/index/)
        if (action === 'home' || action === 'compose') await expect(page.locator('.ch')).toBeVisible()
        if (action === 'all') await expect(page.locator('.search-wrap')).toBeAttached()
        if (action === 'board') await expect(page.locator('.board-head')).toBeVisible()
      }
    })
  }

  for (const route of ['list', 'detail'] as const) {
    test(`${route} dark Chinese desktop visual audit`, async ({ page }) => {
      await fixture(page, { lang: 'zh', theme: 'dark' })
      await page.goto(route === 'list' ? '/#/pages/events/index' : `/#/pages/event/detail/index?id=${EVENT_ID}`, { waitUntil: 'networkidle' })
      await expect(header(page)).toBeVisible()
      await page.screenshot({ path: `test-results/d59-desktop/${route}-1280-zh-dark.png`, animations: 'disabled' })
      expect(await visualAudit(page, `event-${route}-1280-zh-dark`, { include: '.page.secondary-page' }))
        .toEqual({ small: [], contrast: [], axe: [], overflow: 0 })
    })
  }
})

test.describe('desktop event search handoff', () => {
  test.use({ viewport: { width: 1280, height: 800 }, screen: { width: 1280, height: 800 }, isMobile: false, deviceScaleFactor: 1 })
  const scenarios = [
    { route: 'list', previousView: 'home', following: false, query: 'Synthetic' },
    { route: 'list', previousView: 'all', following: false, query: 'Synthetic' },
    { route: 'detail', previousView: 'home', following: false, query: 'Synthetic' },
    { route: 'detail', previousView: 'all', following: false, query: 'Synthetic' },
    { route: 'create', previousView: 'home', following: false, query: 'Synthetic' },
    { route: 'create', previousView: 'all', following: false, query: 'Synthetic' },
    { route: 'list', previousView: 'all', following: true, query: 'Synthetic' },
    { route: 'list', previousView: 'all', following: false, query: '' },
  ] as const

  for (const scenario of scenarios) {
    test(`${scenario.route} submits from ${scenario.previousView}${scenario.following ? ' following' : ''}${scenario.query ? '' : ' with empty input'}`, async ({ page }) => {
      await fixture(page, { guest: scenario.route !== 'create' })
      let searchRequests = 0
      await page.route('**/rest/v1/rpc/search_community_posts', route => route.fulfill({
        contentType: 'application/json', body: '[]',
      }))
      page.on('request', request => {
        if (new URL(request.url()).pathname === '/rest/v1/rpc/search_community_posts') searchRequests += 1
      })
      await page.goto(`/#/pages/plaza/index?view=${scenario.previousView}`, { waitUntil: 'networkidle' })
      if (scenario.following) {
        const following = page.getByRole('tab', { name: 'Following', exact: true })
        await following.click()
        await expect(following).toHaveAttribute('aria-selected', 'true')
      }
      await page.locator('.cx-hdr:visible [data-test="nav-events"]').click()
      await expect(page.locator('.ev-main .evc').first()).toBeVisible()
      switch (scenario.route) {
        case 'list': break
        case 'detail':
          await page.locator('.ev-main .evc').first().click()
          await expect(page.locator('.ed-title')).toBeVisible()
          break
        case 'create':
          await page.locator('.header .me-entry').click()
          await expect(page.locator('.me-form')).toBeVisible()
          break
        default: {
          const unexpected: never = scenario
          throw new TypeError(String(unexpected))
        }
      }
      const input = header(page).locator('input')
      if (!scenario.query) {
        await expect(input).toHaveValue('')
        await input.press('Enter')
        await expect(page).toHaveURL(/pages\/plaza\/index\?view=all$/)
        await page.waitForTimeout(600)
        expect(searchRequests).toBe(0)
        return
      }
      const originalUrl = page.url()
      await input.pressSequentially('Synthetic')
      await page.waitForTimeout(600)
      await expect(page).toHaveURL(originalUrl)
      expect(searchRequests).toBe(0)
      await expect(input).toHaveValue('Synthetic')
      const requestPromise = page.waitForRequest('**/rest/v1/rpc/search_community_posts')
      await input.press('Enter')
      const request = await requestPromise
      await expect(page).toHaveURL(/pages\/plaza\/index\?view=all$/)
      const body: unknown = request.postDataJSON()
      expect(body).toMatchObject({ terms_in: ['synthetic'] })
      await expect(page.locator('.cx-hdr:visible input')).toHaveValue('Synthetic')
    })
  }
})
