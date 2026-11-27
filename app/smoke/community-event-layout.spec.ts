import { test, expect, type Locator, type Page } from '@playwright/test'
import { installMemberEvents, EVENT_ID, NOW } from './community-member-event-fixture'

const partnerName = 'Synthetic Partner '.repeat(5).slice(0, 80)

async function layoutFixture(page: Page) {
  const state = await installMemberEvents(page, { reader: 'member', open: true, lang: 'en' })
  state.rows = Array.from({ length: 20 }, (_, index) => ({
    ...state.member,
    id: index === 0 ? EVENT_ID : `70000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    source_type: index === 0 ? 'partner' as const : 'member' as const,
    title: `Synthetic layout event ${index + 1}`,
    title_en: `Synthetic layout event ${index + 1}`,
    starts_at: new Date(NOW + (index + 1) * 86_400_000).toISOString(),
    ends_at: new Date(NOW + (index + 1) * 86_400_000 + 3_600_000).toISOString(),
    partner_name_en: index === 0 ? partnerName : null,
    organizer_user_id: index === 0 ? null : state.member.organizer_user_id,
    organizer_nickname: index === 0 ? null : state.member.organizer_nickname,
    organizer_avatar_url: null,
    organizer_is_illini_verified: index === 0 ? null : state.member.organizer_is_illini_verified,
    cancelled_at: index === 1 ? new Date(NOW).toISOString() : null,
  }))
  await page.route(/https:\/\/(?:[^/]+\.)?caaciorg\.com\//, () => { throw new Error('Forbidden external request') })
}

async function expectTagsInsideCards(tags: Locator) {
  const count = await tags.count()
  expect(count).toBeGreaterThan(0)
  for (let index = 0; index < count; index++) {
    const geometry = await tags.nth(index).evaluate(async element => {
      element.scrollIntoView({ block: 'center', inline: 'nearest' })
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      const card = element.closest('.evc')
      if (!card) throw new TypeError('An event tag must belong to a card')
      const rect = element.getBoundingClientRect()
      const edge = card.getBoundingClientRect().right - Number.parseFloat(getComputedStyle(card).paddingRight)
      const hit = document.elementFromPoint(rect.right - 2, rect.top + rect.height / 2)
      return {
        text: element.textContent,
        right: rect.right,
        edge,
        hitsTag: hit?.closest('.evc-tag') === element,
        hitsSidebar: Boolean(hit?.closest('.events-sidebar')),
      }
    })
    expect(geometry.right, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.edge + 0.5)
    expect(geometry.hitsTag, JSON.stringify(geometry)).toBe(true)
    expect(geometry.hitsSidebar, JSON.stringify(geometry)).toBe(false)
  }
}

for (const width of [390, 768, 1280]) {
  test.describe(`event labels at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, screen: { width, height: 900 },
      isMobile: width === 390, hasTouch: width === 390, deviceScaleFactor: 1 })
    test('every list tag fits its card and remains unobscured', async ({ page }) => {
      await layoutFixture(page)
      await page.goto('/#/pages/events/index', { waitUntil: 'networkidle' })
      await expect(page.locator(`[data-event-id="${EVENT_ID}"] [data-test="event-source"]`)).toContainText(partnerName)
      await expect(page.locator('.header .me-entry')).toBeVisible()
      await page.screenshot({ path: `test-results/d60-layout/list-${width}.png`, animations: 'disabled' })
      await expectTagsInsideCards(page.locator('.ev-main .evc-tag'))
    })
  })
}

for (const width of [390, 1280]) {
  test.describe(`home event labels at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, screen: { width, height: 900 },
      isMobile: width === 390, hasTouch: width === 390, deviceScaleFactor: 1 })
    test('every home tag fits its card and remains unobscured', async ({ page }) => {
      await layoutFixture(page)
      await page.goto('/#/pages/plaza/index', { waitUntil: 'networkidle' })
      const block = page.locator('.ch [data-block="events"]')
      await expect(block.locator(`[data-event-id="${EVENT_ID}"] [data-test="event-source"]`)).toContainText(partnerName)
      await block.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }))
      await page.screenshot({ path: `test-results/d60-layout/home-${width}.png`, animations: 'disabled' })
      await expectTagsInsideCards(block.locator('.evc-tag'))
    })
  })
}

test.describe('event sidebar at 768px', () => {
  test.use({ viewport: { width: 768, height: 900 }, screen: { width: 768, height: 900 },
    isMobile: false, hasTouch: false, deviceScaleFactor: 1 })
  test('the open creation switch leaves the full width to the list', async ({ page }) => {
    await layoutFixture(page)
    await page.goto('/#/pages/events/index', { waitUntil: 'networkidle' })
    await expect(page.locator('.header .me-entry')).toBeVisible()
    const widths = await page.locator('.ev-main').evaluate(element => {
      const content = element.closest('.secondary-content')
      if (!(content instanceof HTMLElement)) throw new TypeError('Expected secondary content')
      return { main: element.getBoundingClientRect().width, available: content.clientWidth }
    })
    console.log('W5_MAIN_WIDTH ' + JSON.stringify(widths))
    await page.screenshot({ path: 'test-results/d60-layout/sidebar-768.png', animations: 'disabled' })
    await expect(page.locator('.events-sidebar')).toHaveCSS('display', 'none')
    expect(widths.main).toBe(widths.available)
  })
})
