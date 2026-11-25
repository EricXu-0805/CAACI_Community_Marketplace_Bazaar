import { test, expect, type Page } from '@playwright/test'
import { installMemberEvents, NOW, EVENT_ID } from './community-member-event-fixture'
import { visualAudit } from './visual-audit'
import type { EventSource } from '../src/utils/communityEvents'

const STALE = '2026-11-12T20:05:00Z'
const syncPath = '**/rest/v1/community_event_sync_state?**'

async function fixture(page: Page, lang: 'zh' | 'en' = 'en', source: EventSource = 'caaci') {
  const state = await installMemberEvents(page, { reader: 'guest', lang })
  state.rows = [{
    ...state.member, source_type: source, title: '合成活动', title_en: 'Synthetic event',
    summary: 'Synthetic description.', summary_en: 'Synthetic description.',
    organizer_user_id: null, organizer_nickname: null, discussion_post_id: null,
  }]
  await page.route(/https:\/\/(?:[^/]+\.)?caaciorg\.com\//, () => { throw new Error('Forbidden external request') })
  return state
}

async function sync(page: Page, value: string | null, status = 200) {
  await page.route(syncPath, route => route.fulfill({
    status, contentType: 'application/json',
    body: JSON.stringify(status === 200 ? { source: 'caaci', last_success_at: value } : { message: 'Synthetic failure' }),
  }))
}

for (const width of [390, 1280]) {
  test.describe(`freshness at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, screen: { width, height: 900 }, isMobile: width === 390, deviceScaleFactor: 1 })
    for (const lang of ['zh', 'en'] as const) {
      test(`stale CAACI list uses ${lang} Chicago text without changing the cards`, async ({ page }) => {
        await fixture(page, lang)
        await sync(page, STALE)
        await page.goto('/#/pages/events/index', { waitUntil: 'networkidle' })
        await expect(page.locator('.evc-title')).toHaveText(lang === 'zh' ? '合成活动' : 'Synthetic event')
        const line = page.locator('[data-test="events-stale"]')
        await expect(line).toHaveText(lang === 'zh'
          ? 'CAACI 活动信息上次核对：11月12日 14:05 CT'
          : 'CAACI event info last checked Nov 12, 2:05 PM CT')
        await expect(line).toHaveCSS('font-size', '12px')
        await page.screenshot({ path: `test-results/d59-freshness/list-${width}-${lang}.png`, animations: 'disabled', fullPage: true })
        const audit = await visualAudit(page, `freshness-list-${width}-${lang}`, { include: '.secondary-content' })
        expect(audit).toEqual({ small: [], contrast: [], axe: [], overflow: 0 })
      })
    }
  })
}

for (const scenario of [
  { name: 'fresh', value: new Date(NOW - 60 * 60_000).toISOString(), status: 200 },
  { name: 'exactly two hours', value: new Date(NOW - 2 * 60 * 60_000).toISOString(), status: 200 },
  { name: 'null timestamp', value: null, status: 200 },
  { name: 'failed read', value: null, status: 500 },
] as const) {
  test(`${scenario.name} omits freshness while the list remains usable`, async ({ page }) => {
    await fixture(page)
    await sync(page, scenario.value, scenario.status)
    await page.goto('/#/pages/events/index', { waitUntil: 'networkidle' })
    await expect(page.locator('.evc-title')).toHaveText('Synthetic event')
    await expect(page.locator('[data-test="events-stale"]')).toHaveCount(0)
    await page.locator('[data-filter="caaci"]').click()
    await expect(page.locator('.evc-title')).toHaveText('Synthetic event')
  })
}

test('missing CAACI state omits freshness', async ({ page }) => {
  await fixture(page)
  await page.route(syncPath, route => route.fulfill({ contentType: 'application/json', body: 'null' }))
  await page.goto('/#/pages/events/index', { waitUntil: 'networkidle' })
  await expect(page.locator('.evc-title')).toHaveText('Synthetic event')
  await expect(page.locator('[data-test="events-stale"]')).toHaveCount(0)
})

test('pending sync state never blocks the list and appears when released', async ({ page }) => {
  await fixture(page)
  let release = () => {}
  const pending = new Promise<void>(resolve => { release = resolve })
  await page.route(syncPath, async route => {
    await pending
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ source: 'caaci', last_success_at: STALE }) })
  })
  try {
    await page.goto('/#/pages/events/index', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.evc-title')).toHaveText('Synthetic event')
    await expect(page.locator('[data-test="events-stale"]')).toHaveCount(0)
  } finally {
    release()
  }
  await expect(page.locator('[data-test="events-stale"]')).toContainText('Nov 12, 2:05 PM CT')
})

for (const source of ['caaci', 'member', 'partner', 'campus'] as const) {
  test(`${source} detail only shows freshness for CAACI`, async ({ page }) => {
    await fixture(page, 'en', source)
    await sync(page, STALE)
    await page.goto(`/#/pages/event/detail/index?id=${EVENT_ID}`, { waitUntil: 'networkidle' })
    await expect(page.locator('.ed-title')).toHaveText('Synthetic event')
    const line = page.locator('[data-test="event-checked"]')
    if (source === 'caaci') {
      await expect(line).toHaveText('Source last checked Nov 12, 2:05 PM CT')
      await expect(line).toHaveCSS('font-size', '13px')
      await page.screenshot({ path: 'test-results/d59-freshness/detail-390-en.png', animations: 'disabled', fullPage: true })
      expect(await visualAudit(page, 'freshness-detail-390-en', { include: '.secondary-content' }))
        .toEqual({ small: [], contrast: [], axe: [], overflow: 0 })
    } else await expect(line).toHaveCount(0)
  })
}

test('CAACI detail without a timestamp omits the checked line', async ({ page }) => {
  await fixture(page)
  await sync(page, null)
  await page.goto(`/#/pages/event/detail/index?id=${EVENT_ID}`, { waitUntil: 'networkidle' })
  await expect(page.locator('.ed-title')).toHaveText('Synthetic event')
  await expect(page.locator('[data-test="event-checked"]')).toHaveCount(0)
})

test.describe('future-only list freshness', () => {
  test('a failed list omits the stale caption', async ({ page }) => {
    await fixture(page)
    await sync(page, STALE)
    await page.route('**/rest/v1/rpc/list_community_events', route => route.fulfill({
      status: 500, contentType: 'application/json', body: '{"message":"Synthetic list failure"}',
    }))
    const checked = page.waitForResponse(syncPath)
    await page.goto('/#/pages/events/index', { waitUntil: 'networkidle' })
    await expect(page.locator('[data-test="events-failed"]')).toBeVisible()
    await checked
    await page.waitForTimeout(500)
    await page.screenshot({ path: 'test-results/d60-w4b/failed.png', animations: 'disabled' })
    expect(await page.locator('[data-test="events-stale"]').count()).toBe(0)
  })

  test('the past view omits the stale caption', async ({ page }) => {
    const state = await fixture(page)
    await sync(page, STALE)
    const checked = page.waitForResponse(syncPath)
    await page.goto('/#/pages/events/index', { waitUntil: 'networkidle' })
    await checked
    await expect(page.locator('[data-test="events-stale"]')).toBeVisible()
    state.rows = []
    const past = page.waitForResponse('**/rest/v1/rpc/list_community_events')
    const pastChecked = page.waitForResponse(syncPath)
    await page.locator('[data-test="events-past-link"]').click()
    await past
    await pastChecked
    await expect(page.locator('[data-test="events-empty"]')).toBeVisible()
    await page.waitForTimeout(500)
    await page.screenshot({ path: 'test-results/d60-w4b/past.png', animations: 'disabled' })
    expect(await page.locator('[data-test="events-stale"]').count()).toBe(0)
  })

  test('a pending list omits freshness until the rows arrive', async ({ page }) => {
    await fixture(page)
    await sync(page, STALE)
    let release: (() => void) | undefined
    const pending = new Promise<void>(resolve => { release = resolve })
    await page.route('**/rest/v1/rpc/list_community_events', async route => {
      await pending
      await route.fallback()
    })
    const checked = page.waitForResponse(syncPath)
    try {
      await page.goto('/#/pages/events/index', { waitUntil: 'domcontentloaded' })
      await checked
      await expect(page.locator('.ev-main [aria-busy="true"]')).toBeVisible()
      await page.waitForTimeout(500)
      await page.screenshot({ path: 'test-results/d60-w4b/loading.png', animations: 'disabled' })
      expect(await page.locator('[data-test="events-stale"]').count()).toBe(0)
    } finally {
      release?.()
    }
    await expect(page.locator('[data-test="events-stale"]')).toBeVisible()
  })
})
