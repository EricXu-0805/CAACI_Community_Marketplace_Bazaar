import { test, expect, type Page } from '@playwright/test'
import { installTopicFixture } from './community-topic-fixture'
import { visualAudit } from './visual-audit'
import zh from '../src/composables/i18n/messages/zh'
import en from '../src/composables/i18n/messages/en'

/*
 * P4.8 (SPEC 6.7.4-6.7.9, 6.7.12; 5.2 S2; 5.3 ⑤) and the reference card of
 * P4.9 (SPEC 6.4 row 6). Every read is answered from the rows below, so what
 * is on screen is decided by what the page asked list_community_events for.
 * The clock is fixed at a Friday morning in Champaign, which keeps "明天" and
 * "进行中" true whenever the spec runs.
 */
const NOW = Date.parse('2026-11-20T16:00:00Z') // Friday 10:00 Central
const HOUR = 3_600_000, DAY = 24 * HOUR
const SHOTS = 'test-results/visual/P4.8'
const at = (ms: number) => new Date(NOW + ms).toISOString()
const text = (key: string, params: Record<string, string | number> = {}) =>
  Object.entries(params).reduce((line, [name, value]) => line.replaceAll(`{${name}}`, String(value)), (zh as Record<string, string>)[key])

type Row = Record<string, unknown> & { id: string; source_type: string }
let serial = 0
const event = (source_type: string, startsIn: number, extra: Record<string, unknown> = {}): Row => ({
  id: `70000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`, source_type, region: 'cu',
  title: null, title_en: null, summary: null, summary_en: null, organizer_name: null,
  partner_name_zh: null, partner_name_en: null, allowed_link_hosts: null, page_url: null, register_url: null,
  registration_mode: 'info_only', takes_registrations: null, registration_open: null,
  starts_at: at(startsIn), ends_at: null, all_day: false, occurrence_count: 1, time_zone: 'America/Chicago',
  location: null, availability: 'visible', cancelled_at: null, status_note: null, previous_starts_at: null,
  schedule_changed_at: null, revision: 1, organizer_user_id: null, organizer_nickname: null, organizer_avatar_url: null,
  organizer_is_illini_verified: null, discussion_post_id: null, discussion_count: null,
  ...extra,
})
const TOPIC_ID = '71000000-0000-4000-8000-000000000001'
const LIVE = event('campus', -HOUR, {
  title_en: 'Library tour', organizer_name: 'University Library', ends_at: at(2 * HOUR), location: 'Main Library',
  page_url: 'https://calendars.illinois.edu/detail/7/100001', registration_mode: 'calendar_page',
})
const CAACI = event('caaci', DAY, {
  title: '迎新晚会', title_en: 'Welcome night', ends_at: at(DAY + 2 * HOUR), location: 'Illini Union',
  page_url: 'https://caaciorg.com/events/#welcome-night', register_url: 'https://caaciorg.com/events/welcome-night/register/',
  registration_mode: 'caaci_site', takes_registrations: true, registration_open: true,
  summary: '新学期第一场聚会。', discussion_post_id: TOPIC_ID, discussion_count: 3,
})
const PARTNER = event('partner', DAY + HOUR, {
  title: '公开赛', summary: '面向所有水平的公开赛。', partner_name_zh: '国际象棋社', partner_name_en: 'Chess Club',
  allowed_link_hosts: ['chess.example.test'], location: 'ARC', registration_mode: 'external_link',
  page_url: 'https://chess.example.test/open', register_url: 'https://chess.example.test/signup',
})
const MEMBER = event('member', DAY + 2 * HOUR, {
  title: '周六羽毛球，3 缺 3', location: 'ARC 3 号场', registration_mode: 'discussion', organizer_user_id: '72000000-0000-4000-8000-000000000001',
  organizer_nickname: '小林', organizer_is_illini_verified: true, discussion_post_id: '71000000-0000-4000-8000-000000000002', discussion_count: 0,
})
const CAMPUS = event('campus', 2 * DAY, {
  title_en: 'Research workshop', organizer_name: 'University Library', location: 'Room 106',
  page_url: 'https://calendars.illinois.edu/detail/7/100002', registration_mode: 'calendar_page',
  previous_starts_at: at(DAY), schedule_changed_at: at(-DAY), revision: 2,
})
const CANCELLED = event('member', 2 * DAY + HOUR, {
  title: '周日约饭', location: 'Green Street', registration_mode: 'discussion', organizer_nickname: '阿明',
  cancelled_at: at(-HOUR), status_note: '改天再约', discussion_post_id: '71000000-0000-4000-8000-000000000003',
})
// Its registration link is on a host the partner never registered: no button for it.
const OFF_LIST = event('partner', 3 * DAY, {
  title: '读书会', summary: '每月一次。', partner_name_zh: '读书社', partner_name_en: 'Book Club', allowed_link_hosts: ['books.example.test'],
  page_url: 'https://books.example.test/meet', register_url: 'https://forms.example.test/signup', registration_mode: 'external_link',
})
const OVER = event('campus', -7 * DAY, {
  title_en: 'Resume clinic', organizer_name: 'Career Center', ends_at: at(-7 * DAY + 2 * HOUR), location: 'Illini Union',
  page_url: 'https://calendars.illinois.edu/detail/7/100003', registration_mode: 'calendar_page',
})
const UPCOMING = [LIVE, CAACI, PARTNER, MEMBER, CAMPUS, CANCELLED, OFF_LIST]

interface Served { upcoming: Row[]; past: Row[]; fail: boolean; calls: Record<string, unknown>[] }

async function serve(page: Page, rows: Partial<Pick<Served, 'upcoming' | 'past'>> = {}): Promise<Served> {
  const served: Served = { upcoming: rows.upcoming ?? UPCOMING, past: rows.past ?? [OVER], fail: false, calls: [] }
  await page.addInitScript(() => {
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', 'zh')
    localStorage.setItem('theme_pref', 'light')
    // H5 opens an outbound link in a new tab; record the call instead of leaving the test.
    ;(window as unknown as { opened: unknown[][] }).opened = []
    window.open = (...args: unknown[]) => { (window as unknown as { opened: unknown[][] }).opened.push(args); return null }
  })
  await page.clock.setFixedTime(new Date(NOW))
  await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ flagged: false, categories: [] }),
  }))
  await page.route('**/*.supabase.co/**', route => {
    const request = route.request(), url = new URL(request.url())
    if (url.pathname.endsWith('/rest/v1/rpc/list_community_events')) {
      const asked = request.postDataJSON() as Record<string, unknown>
      served.calls.push(asked)
      if (served.fail) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"unavailable"}' })
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(asked.window_in === 'past' ? served.past : served.upcoming) })
    }
    if (request.method() === 'HEAD') {
      return route.fulfill({ status: 200, headers: { 'content-range': '*/0', 'access-control-expose-headers': 'content-range' }, body: '' })
    }
    return route.fulfill({ contentType: 'application/json', headers: { 'content-range': '0-0/0' }, body: '[]' })
  })
  return served
}
const opened = (page: Page) => page.evaluate(() => (window as unknown as { opened: unknown[][] }).opened)
const cards = (page: Page, scope = '.ev-main') => page.locator(`${scope} .evc`)
const titles = (page: Page, scope = '.ev-main') => page.locator(`${scope} .evc-title`).allTextContents()
// uni-h5 keeps a page's instance when only the hash changes, so a direct open starts a new
// document, as opening a shared link does.
const openFresh = async (page: Page, route: string) => {
  await page.goto('about:blank')
  await page.goto(`/#${route}`, { waitUntil: 'networkidle' })
}

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket(/\.supabase\.co(?:[:/]|$)/, socket => socket.close())
})

const PHONE = { width: 390, height: 844, scale: 2, mobile: true }
const DESKTOP = { width: 1280, height: 800, scale: 1, mobile: false }
// uni-h5 reads the window width from the screen, so both have to move.
const phone = {
  viewport: { width: PHONE.width, height: PHONE.height }, screen: { width: PHONE.width, height: PHONE.height },
  deviceScaleFactor: PHONE.scale, isMobile: true, hasTouch: true,
}

for (const size of [PHONE, DESKTOP]) {
  test.describe(`events at ${size.width}px`, () => {
    // uni-h5 reads the window width from the screen, so both have to move.
    test.use({
      viewport: { width: size.width, height: size.height },
      screen: { width: size.width, height: size.height },
      deviceScaleFactor: size.scale, isMobile: size.mobile, hasTouch: size.mobile,
    })

    test('the list: one card for each source, named in words, with its state, and no picture', async ({ page }) => {
      const served = await serve(page)
      await page.goto('/#/pages/events/index', { waitUntil: 'networkidle' })
      await expect(cards(page).first()).toBeVisible({ timeout: 15_000 })
      expect(served.calls[0]).toEqual({ region_in: 'cu', window_in: 'upcoming', limit_in: 200 })

      // SPEC 6.7.4: the five filters, "all" chosen; what is on now first, then by Champaign date.
      await expect(page.locator('.ev-chip')).toHaveText(['全部', 'CAACI', '合作组织', '学校', '网友发起'])
      await expect(page.locator('.ev-chip[data-filter="all"]')).toHaveAttribute('aria-selected', 'true')
      // SPEC 6.7.4: the page title is 17px on a phone and 22px in the desktop layout.
      await expect(page.locator('.header-title')).toHaveCSS('font-size', size === DESKTOP ? '22px' : '17px')
      await expect(page.locator('.ev-group-h')).toHaveText(['进行中', '明天 · 11月21日 周六', '11月22日 周日', '11月23日 周一'])
      expect(await titles(page)).toEqual(['Library tour', '迎新晚会', '公开赛', '周六羽毛球，3 缺 3', 'Research workshop', '周日约饭', '读书会'])

      // SPEC 6.7.1 rule 1 and 6.7.3: the source is written out on every card.
      const source = (row: Row) => page.locator(`.evc[data-event-id="${row.id}"] [data-test="event-source"]`)
      await expect(source(CAACI)).toHaveText('CAACI 主办')
      await expect(source(PARTNER)).toHaveText('转发 · 国际象棋社')
      await expect(source(CAMPUS)).toHaveText('学校活动')
      await expect(source(MEMBER)).toHaveText('网友发起')
      await expect(page.locator(`.evc[data-event-id="${MEMBER.id}"] .evc-who`)).toHaveText('小林')

      // SPEC 6.7.7: on now, moved, cancelled by its organizer; an ordinary event has no state label.
      const state = (row: Row) => page.locator(`.evc[data-event-id="${row.id}"] [data-test="event-state"]`)
      await expect(state(LIVE)).toHaveText('进行中')
      await expect(state(CAMPUS)).toHaveText('时间已更新')
      await expect(state(CANCELLED)).toHaveText('发起人已取消')
      await expect(page.locator(`.evc[data-event-id="${CANCELLED.id}"] .evc-title`)).toHaveCSS('text-decoration-line', 'line-through')
      await expect(state(CAACI)).toHaveCount(0)

      // SPEC 6.7.5: date block, when and where; replies only when there are some.
      const card = page.locator(`.evc[data-event-id="${CAACI.id}"]`)
      await expect(card.locator('.evc-mo')).toHaveText('11月')
      await expect(card.locator('.evc-day')).toHaveText('21')
      await expect(card.locator('.evc-when')).toHaveText('周六 10:00 · Illini Union')
      await expect(card.locator('.evc-replies')).toHaveText('3 条回复')
      await expect(page.locator(`.evc[data-event-id="${MEMBER.id}"] .evc-replies`)).toHaveCount(0)
      // An event that ends the day it starts carries no multi-day mark, and the card's name says its date in words.
      await expect(card.locator('.evc-on')).toHaveCount(0)
      await expect(card).toHaveAttribute('aria-label', '迎新晚会 · 11月21日 · 周六 10:00 · Illini Union · CAACI 主办')
      // v1 renders no image of any source, and opens no web view.
      await expect(page.locator('.ev-main img, .ev-main uni-image, .ev-main uni-web-view, .ev-main iframe')).toHaveCount(0)

      await page.screenshot({ path: `${SHOTS}/events-${size.width}-zh.png`, animations: 'disabled' })
      const audit = await visualAudit(page, `P4.8 events-${size.width}-zh`, { include: '.secondary-content' })
      expect(audit.small, 'text under 12px on the events list').toEqual([])
      expect(audit.contrast, 'contrast on the events list').toEqual([])
      if (audit.axe) expect(audit.axe, 'axe color-contrast on the events list').toEqual([])
      expect(audit.overflow, 'horizontal overflow').toBe(0)
      // SPEC 6.7.4, desktop: the four sources explained beside the list.
      const sources = page.locator('[data-block="event-sources"]')
      if (size === DESKTOP) await expect(sources.locator('.ev-side-row')).toHaveCount(4)
      else await expect(sources).toBeHidden()
    })

    test('the source filter stays at the top while the list scrolls (SPEC 6.7.4 item 2)', async ({ page }) => {
      const many = Array.from({ length: 24 }, (_, index) => event('campus', (index + 1) * DAY, {
        title_en: `Workshop ${index + 1}`, organizer_name: 'University Library', location: 'Room 106',
        page_url: `https://calendars.illinois.edu/detail/7/2${String(index).padStart(5, '0')}`, registration_mode: 'calendar_page',
      }))
      await serve(page, { upcoming: many })
      await page.goto('/#/pages/events/index', { waitUntil: 'networkidle' })
      await expect(cards(page).first()).toBeVisible({ timeout: 15_000 })
      const chips = page.locator('.ev-chips')
      const top = async (target: ReturnType<Page['locator']>) => (await target.boundingBox())!.y
      const chipsAt = await top(chips), firstAt = await top(cards(page).first())
      expect(chipsAt).toBeGreaterThan(0)
      await cards(page).last().scrollIntoViewIfNeeded()
      // The list has moved up by more than the row's own distance from the top, and the row is still there.
      expect(firstAt - await top(cards(page).first())).toBeGreaterThan(chipsAt)
      await expect(chips).toBeInViewport()
      expect(Math.abs(await top(chips))).toBeLessThanOrEqual(1)
      // It still works from there.
      await page.locator('.ev-chip[data-filter="caaci"]').click()
      await expect(page.locator('[data-test="events-empty"] .ev-state-t')).toHaveText('CAACI 近期没有已发布的活动。往期活动在 CAACI 官网。')
    })

    test('a filter lists its source only and is remembered; the past is one tap away', async ({ page }) => {
      const served = await serve(page)
      await page.goto('/#/pages/events/index', { waitUntil: 'networkidle' })
      await page.locator('.ev-chip[data-filter="campus"]').click()
      expect(await titles(page)).toEqual(['Library tour', 'Research workshop'])
      await page.locator('.ev-chip[data-filter="member"]').click()
      expect(await titles(page)).toEqual(['周六羽毛球，3 缺 3', '周日约饭'])
      await page.reload({ waitUntil: 'networkidle' })
      await expect(page.locator('.ev-chip[data-filter="member"]')).toHaveAttribute('aria-selected', 'true')
      expect(await titles(page)).toEqual(['周六羽毛球，3 缺 3', '周日约饭'])

      await page.locator('[data-test="events-past-link"]').click()
      await expect(page.locator('[data-test="events-past"] .evc-title')).toHaveText(['Resume clinic'])
      await expect(page.locator('.header-title')).toHaveText('往期活动')
      expect(served.calls.at(-1)).toEqual({ region_in: 'cu', window_in: 'past', limit_in: 200 })
      // What is over carries no state label and no outbound button.
      await expect(page.locator('[data-test="events-past"] [data-test="event-state"]')).toHaveCount(0)
      await page.locator('[data-test="events-upcoming-link"]').click()
      await expect(page.locator('.ev-chip[data-filter="member"]')).toBeVisible()
    })

    test('nothing listed, and a failed load, are told apart (SPEC 6.7.12)', async ({ page }) => {
      const served = await serve(page, { upcoming: [], past: [] })
      await page.goto('/#/pages/events/index', { waitUntil: 'networkidle' })
      const empty = page.locator('[data-test="events-empty"]')
      await expect(empty.locator('.ev-state-t')).toHaveText('近期没有收录的活动')
      await expect(empty.locator('.ev-link')).toHaveText(['CAACI 官网活动 ›', 'UIUC 国际学生活动日历 ›'])
      // The CAACI link goes out through the allowlist, to the Chinese page for a Chinese reader.
      await empty.locator('[data-link="events.empty.caaciLink"]').click()
      expect(await opened(page)).toEqual([['https://caaciorg.com/zh/events/', '_blank', 'noopener,noreferrer']])
      await page.screenshot({ path: `${SHOTS}/events-empty-${size.width}-zh.png`, animations: 'disabled' })

      await page.locator('.ev-chip[data-filter="partner"]').click()
      await expect(empty.locator('.ev-state-t')).toHaveText('还没有合作组织的活动。')
      await expect(empty.locator('.ev-link')).toHaveCount(0)
      await page.locator('.ev-chip[data-filter="campus"]').click()
      await expect(empty.locator('.ev-link')).toHaveText(['UIUC 国际学生活动日历 ›'])
      await page.locator('[data-test="events-past-link"]').click()
      await expect(empty.locator('.ev-state-t')).toHaveText('过去 180 天没有活动记录。')

      // A load that fails says so and offers to try again; it is not an empty calendar.
      served.fail = true
      await page.locator('[data-test="events-upcoming-link"]').click()
      const failed = page.locator('[data-test="events-failed"]')
      await expect(failed.locator('.ev-state-t')).toHaveText('活动没有加载出来')
      await expect(empty).toHaveCount(0)
      served.fail = false
      served.upcoming = [CAACI]
      await page.locator('.ev-chip[data-filter="all"]').click()
      await failed.locator('.ev-btn').click()
      await expect(page.locator('.ev-main .evc-title')).toHaveText(['迎新晚会'])
    })

    test('the detail page: who is responsible, when in Champaign time, and registration with the organizer', async ({ page }) => {
      await serve(page)
      await page.goto('/#/pages/events/index', { waitUntil: 'networkidle' })
      await page.locator(`.evc[data-event-id="${CAACI.id}"]`).click()
      const detail = page.locator('.ed')
      await expect(detail).toHaveAttribute('data-event-id', CAACI.id)
      await expect(detail.locator('.ed-title')).toHaveText('迎新晚会')
      await expect(detail.locator('[data-test="event-source"]')).toHaveText('CAACI 主办')
      await expect(detail.locator('.ed-source-t')).toHaveText('CAACI 主办。报名和名额以 CAACI 官网为准。')
      await expect(detail.locator('[data-test="event-time"]')).toHaveText('2026年11月21日（周六）10:00–12:00（美国中部时间）')
      await expect(detail.locator('[data-test="event-place"]')).toHaveText('Illini Union')
      await expect(detail.locator('.ed-summary')).toHaveText('新学期第一场聚会。')
      await expect(detail.locator('[data-test="event-banner"]')).toHaveCount(0)
      // SPEC 6.7.9: the registration button leaves for the organizer's own site, in a new tab.
      await expect(detail.locator('.ed-act')).toHaveText(['去 CAACI 官网报名', '参加讨论 · 3 条回复 ›'])
      await expect(detail.locator('.ed-note')).toHaveText(['报名结果以 CAACI 官网邮件为准'])
      await detail.locator('[data-action="caaciRegister"]').click()
      expect(await opened(page)).toEqual([['https://caaciorg.com/events/welcome-night/register/?lang=zh', '_blank', 'noopener,noreferrer']])
      await expect(page.locator('.ed img, .ed uni-image, .ed uni-web-view, .ed iframe')).toHaveCount(0)

      await page.screenshot({ path: `${SHOTS}/event-detail-${size.width}-zh.png`, animations: 'disabled' })
      const audit = await visualAudit(page, `P4.8 event-detail-${size.width}-zh`, { include: '.secondary-content' })
      expect(audit.small, 'text under 12px on the event page').toEqual([])
      expect(audit.contrast, 'contrast on the event page').toEqual([])
      if (audit.axe) expect(audit.axe, 'axe color-contrast on the event page').toEqual([])
      expect(audit.overflow, 'horizontal overflow').toBe(0)

      // The discussion opens the topic.
      await detail.locator('[data-action="discuss"]').click()
      await expect(page).toHaveURL(new RegExp(`/pages/post/index\\?id=${TOPIC_ID}`))
    })

    test('each source and state has its own buttons and banner; a link off the allowlist has none', async ({ page }) => {
      await serve(page)
      const open = async (row: Row) => {
        await openFresh(page, `/pages/event/detail/index?id=${row.id}`)
        await expect(page.locator('.ed')).toHaveAttribute('data-event-id', row.id)
      }
      await open(PARTNER)
      await expect(page.locator('.ed-source-t')).toHaveText('由玉米地站务转发，主办方是 国际象棋社。报名、名额和现场安排由 国际象棋社 负责。')
      await expect(page.locator('.ed-act')).toHaveText(['去主办方报名（chess.example.test）', '查看原页'])
      await expect(page.locator('.ed-note')).toHaveText(['报名和名额由 国际象棋社 负责'])
      await page.locator('[data-action="partnerView"]').click()
      expect(await opened(page)).toEqual([['https://chess.example.test/open', '_blank', 'noopener,noreferrer']])

      await open(OFF_LIST)
      await expect(page.locator('.ed-act')).toHaveText(['查看原页'])

      await open(CAMPUS)
      await expect(page.locator('.ed-source-t')).toHaveText('收录自 UIUC 日历，主办方：University Library。列在学校日历上不等于学校主办。')
      await expect(page.locator('[data-test="event-banner"] .ed-banner-t')).toHaveText('时间已更新：原 11月21日 周六 10:00 CT')
      await expect(page.locator('.ed-act')).toHaveText(['查看学校页面'])

      // SPEC 6.7.7: what is on now has no banner in Chinese; the list says 进行中.
      await open(LIVE)
      await expect(page.locator('.ed')).toHaveAttribute('data-state', 'live')
      await expect(page.locator('[data-test="event-banner"]')).toHaveCount(0)

      await open(MEMBER)
      await expect(page.locator('.ed-source-t')).toHaveText('网友自发组织，不是 CAACI 或学校的活动。')
      await expect(page.locator('.ed-act')).toHaveText(['参加讨论'])
      await expect(page.locator('.ed-safety')).toHaveText(text('events.memberSafety'))

      await open(CANCELLED)
      await expect(page.locator('[data-test="event-banner"] .ed-banner-t')).toHaveText('发起人已取消这场活动')
      await expect(page.locator('[data-test="event-banner"] .ed-banner-note')).toHaveText('改天再约')
      await expect(page.locator('.ed-title')).toHaveCSS('text-decoration-line', 'line-through')

      // Over: it says so and offers no way out to register.
      await open(OVER)
      await expect(page.locator('[data-test="event-banner"] .ed-banner-t')).toHaveText('活动已结束')
      await expect(page.locator('.ed-act')).toHaveCount(0)
    })

    test('an event readers no longer get shows one line, whatever the reason', async ({ page }) => {
      await serve(page)
      await page.goto('/#/pages/event/detail/index?id=79999999-0000-4000-8000-000000000001', { waitUntil: 'networkidle' })
      const gone = page.locator('[data-test="event-gone"]')
      await expect(gone.locator('.ed-state-t')).toHaveText('这场活动已不再展示')
      await gone.locator('.ed-btn').click()
      await expect(page).toHaveURL(/\/pages\/events\/index/)
      await expect(cards(page).first()).toBeVisible()
    })

    test('the home shows up to three organizations\' events of the next 30 days, and nothing when there are none', async ({ page }) => {
      const far = event('caaci', 40 * DAY, { title: '春节联欢', page_url: 'https://caaciorg.com/events/#gala' })
      const served = await serve(page, { upcoming: [...UPCOMING, far] })
      await page.goto('/#/pages/plaza/index', { waitUntil: 'networkidle' })
      const block = page.locator('.ch [data-block="events"]')
      await expect(block).toBeVisible({ timeout: 15_000 })
      // What has started, a member's event and what is more than 30 days away are not here.
      await expect(block.locator('.evc-title')).toHaveText(['迎新晚会', '公开赛', 'Research workshop'])
      await expect(block.locator('[data-test="event-source"]')).toHaveText(['CAACI 主办', '转发 · 国际象棋社', '学校活动'])
      await block.scrollIntoViewIfNeeded()
      await page.screenshot({ path: `${SHOTS}/home-events-${size.width}-zh.png`, animations: 'disabled' })
      await block.locator('[data-test="all-events"]').click()
      await expect(page).toHaveURL(/\/pages\/events\/index/)
      await expect(cards(page).first()).toBeVisible()

      // SPEC 6.7.2: the 找搭子 board's head also leads there, whether or not the home has the block.
      await openFresh(page, '/pages/plaza/index?board=events-social')
      await page.locator('[data-test="board-events"]').click()
      await expect(page).toHaveURL(/\/pages\/events\/index/)

      served.upcoming = [LIVE, MEMBER, far]
      await openFresh(page, '/pages/plaza/index')
      await expect(page.locator('.ch [data-block="board"]').first()).toBeVisible({ timeout: 15_000 })
      await expect(page.locator('.ch [data-block="events"]')).toHaveCount(0)
      // The read that failed hides the block and leaves the rest of the home alone.
      served.fail = true
      await page.reload({ waitUntil: 'networkidle' })
      await expect(page.locator('.ch [data-block="board"]').first()).toBeVisible({ timeout: 15_000 })
      await expect(page.locator('.ch [data-block="events"]')).toHaveCount(0)
    })
  })
}

test.describe('events for an English reader', () => {
  test.use(phone)

  test('one reply is "1 reply", the card names its date, and what is on now says so on its page', async ({ page }) => {
    const one = { ...CAACI, discussion_count: 1 }
    await serve(page, { upcoming: [LIVE, one] })
    await page.addInitScript(() => localStorage.setItem('lang', 'en'))
    await page.goto('/#/pages/events/index', { waitUntil: 'networkidle' })
    const card = page.locator(`.evc[data-event-id="${one.id}"]`)
    await expect(card.locator('.evc-replies')).toHaveText('1 reply')
    await expect(card).toHaveAttribute('aria-label', 'Welcome night · Nov 21 · Sat 10:00 AM · Illini Union · Hosted by CAACI')
    await card.click()
    await expect(page.locator('.ed')).toHaveAttribute('data-event-id', one.id)
    await expect(page.locator('.ed [data-action="discuss"]')).toHaveText('Join discussion · 1 reply ›')
    // SPEC 6.7.7: English has a banner for what is on now.
    await openFresh(page, `/pages/event/detail/index?id=${LIVE.id}`)
    await expect(page.locator('.ed')).toHaveAttribute('data-event-id', LIVE.id)
    await expect(page.locator('[data-test="event-banner"] .ed-banner-t')).toHaveText('Happening now')
  })

  test('a card that runs past its first day says so in a word, not with the mark of its date block', async ({ page }) => {
    const fair = event('campus', 0, {
      title_en: 'Book fair', organizer_name: 'University Library', location: 'Main Library', all_day: true,
      starts_at: '2026-11-24T06:00:00Z', ends_at: '2026-11-27T06:00:00Z',
    })
    await serve(page, { upcoming: [fair] })
    await page.addInitScript(() => localStorage.setItem('lang', 'en'))
    await page.goto('/#/pages/events/index', { waitUntil: 'networkidle' })
    const copy = en as Record<string, string>
    const named = (date: string) => `Book fair · ${date} · Tue ${copy['events.allDay']} · Main Library · ${copy['events.source.campus']}`
    const card = page.locator(`.evc[data-event-id="${fair.id}"]`)
    await expect(card.locator('.evc-on')).toHaveText(copy['events.runsOn'])
    // The date block is not read out, so the name of the card is not the one a single day would have.
    await expect(card).not.toHaveAttribute('aria-label', named('Nov 24'))
    const spoken = copy['events.runsOnSpoken'].replace('{date}', 'Nov 24')
    await expect(card).toHaveAttribute('aria-label', named(spoken))
    // client:P4-B8-5
    expect(spoken).not.toContain(copy['events.runsOn'])
  })
})

test.describe('event times, for a reader whose device is not on Champaign time', () => {
  test.use({ ...phone, timezoneId: 'Asia/Shanghai' })

  // ENGINEERING 9.3: a calendar gives an all-day event from 00:00 of its first day to 00:00 of the day after its last.
  const ONE_DAY = event('campus', 0, {
    title_en: 'Quad Day', organizer_name: 'Student Affairs', location: 'Main Quad', all_day: true,
    starts_at: '2026-11-23T06:00:00Z', ends_at: '2026-11-24T06:00:00Z',
    page_url: 'https://calendars.illinois.edu/detail/7/100011', registration_mode: 'calendar_page',
  })
  const THREE_DAYS = event('campus', 0, {
    title_en: 'Book fair', organizer_name: 'University Library', location: 'Main Library', all_day: true,
    starts_at: '2026-11-24T06:00:00Z', ends_at: '2026-11-27T06:00:00Z',
    page_url: 'https://calendars.illinois.edu/detail/7/100012', registration_mode: 'calendar_page',
  })
  // A member's event whose end is not a time at all.
  const ENDLESS = event('member', 0, {
    title: '周末徒步', location: 'Allerton Park', registration_mode: 'discussion', organizer_nickname: '小林',
    starts_at: '2026-11-21T17:30:00Z', ends_at: 'infinity', discussion_post_id: '71000000-0000-4000-8000-000000000004',
  })
  // Tuesday 20:00 to midnight in Champaign: its end is the first moment of Wednesday.
  const EVENING = event('caaci', 0, {
    title: '晚间放映', title_en: 'Evening screening', location: 'Illini Union',
    starts_at: '2026-11-25T02:00:00Z', ends_at: '2026-11-25T06:00:00Z',
  })

  test('an all-day event shows its own days and no time of the reader\'s own', async ({ page }) => {
    await serve(page, { upcoming: [CAACI, ONE_DAY, THREE_DAYS] })
    await page.goto('/#/pages/events/index', { waitUntil: 'networkidle' })
    const one = page.locator(`.evc[data-event-id="${ONE_DAY.id}"]`)
    await expect(one.locator('.evc-day')).toHaveText('23')
    await expect(one.locator('.evc-when')).toHaveText('周一 全天 · Main Quad')
    // One day: no multi-day mark.
    await expect(one.locator('.evc-on')).toHaveCount(0)
    const several = page.locator(`.evc[data-event-id="${THREE_DAYS.id}"]`)
    await expect(several.locator('.evc-day')).toHaveText('24')
    await expect(several.locator('.evc-on')).toHaveText('起')

    await one.click()
    await expect(page.locator('.ed')).toHaveAttribute('data-event-id', ONE_DAY.id)
    await expect(page.locator('[data-test="event-time"]')).toHaveText('2026年11月23日（周一） 全天（美国中部时间）')
    // A calendar day in Champaign is not an instant to convert.
    await expect(page.locator('[data-test="event-device-time"]')).toHaveCount(0)
    // Several days: the page names the last one.
    await openFresh(page, `/pages/event/detail/index?id=${THREE_DAYS.id}`)
    await expect(page.locator('.ed')).toHaveAttribute('data-event-id', THREE_DAYS.id)
    await expect(page.locator('[data-test="event-time"]')).toHaveText('2026年11月24日（周二） – 11月26日（周四） 全天（美国中部时间）')
    await expect(page.locator('[data-test="event-device-time"]')).toHaveCount(0)
    // A timed event: the reader's own time, as SPEC 6.7.8 writes it.
    await openFresh(page, `/pages/event/detail/index?id=${CAACI.id}`)
    await expect(page.locator('.ed')).toHaveAttribute('data-event-id', CAACI.id)
    await expect(page.locator('[data-test="event-time"]')).toHaveText('2026年11月21日（周六）10:00–12:00（美国中部时间）')
    await expect(page.locator('[data-test="event-device-time"]')).toHaveText('你的时间：11月22日（周日）00:00–02:00（中国标准时间）')
  })

  test('an end that is not a time reads as no end time, and the page still opens', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await serve(page, { upcoming: [ENDLESS] })
    await page.goto('/#/pages/events/index', { waitUntil: 'networkidle' })
    const card = page.locator(`.evc[data-event-id="${ENDLESS.id}"]`)
    await expect(card.locator('.evc-when')).toHaveText('周六 11:30 · Allerton Park')
    await expect(card.locator('.evc-on')).toHaveCount(0)
    await card.click()
    await expect(page.locator('.ed')).toHaveAttribute('data-event-id', ENDLESS.id)
    await expect(page.locator('[data-test="event-time"]')).toHaveText('2026年11月21日（周六）11:30 开始（美国中部时间）')
    await expect(page.locator('[data-test="event-device-time"]')).toHaveText('你的时间：11月22日（周日）01:30 开始（中国标准时间）')
    expect(errors).toEqual([])
    // With no end time an event is over once it has started: opened again half an hour in, it is not "on now".
    await page.clock.setFixedTime(new Date('2026-11-21T18:00:00Z'))
    await page.reload({ waitUntil: 'networkidle' })
    await expect(page.locator('.ed')).toHaveAttribute('data-event-id', ENDLESS.id)
    await expect(page.locator('.ed')).toHaveAttribute('data-state', 'ended')
    await expect(page.locator('[data-test="event-banner"] .ed-banner-t')).toHaveText('活动已结束')
    expect(errors).toEqual([])
  })

  test('the name of a card says in words when an event runs past its first day', async ({ page }) => {
    await serve(page, { upcoming: [ONE_DAY, THREE_DAYS] })
    await page.goto('/#/pages/events/index', { waitUntil: 'networkidle' })
    const named = (title: string, date: string, weekday: string, place: string) =>
      `${title} · ${date} · ${weekday} ${text('events.allDay')} · ${place} · ${text('events.source.campus')}`
    // One day: the title, the date, when and where, and the source.
    await expect(page.locator(`.evc[data-event-id="${ONE_DAY.id}"]`)).toHaveAttribute('aria-label', named('Quad Day', '11月23日', '周一', 'Main Quad'))
    // Several days: the mark in the date block is not read out, so the name carries it as a word with the date.
    const several = page.locator(`.evc[data-event-id="${THREE_DAYS.id}"]`)
    await expect(several.locator('.evc-on')).toHaveText(text('events.runsOn'))
    await expect(several).not.toHaveAttribute('aria-label', named('Book fair', '11月24日', '周二', 'Main Library'))
    await expect(several).toHaveAttribute('aria-label', named('Book fair', text('events.runsOnSpoken', { date: '11月24日' }), '周二', 'Main Library'))
  })

  test('an evening that ends at midnight is on that evening only: its card has no multi-day mark', async ({ page }) => {
    await serve(page, { upcoming: [EVENING] })
    await page.goto('/#/pages/events/index', { waitUntil: 'networkidle' })
    const card = page.locator(`.evc[data-event-id="${EVENING.id}"]`)
    await expect(card.locator('.evc-day')).toHaveText('24')
    await expect(card.locator('.evc-when')).toHaveText('周二 20:00 · Illini Union')
    await expect(card.locator('.evc-on')).toHaveCount(0)
    await expect(card).toHaveAttribute('aria-label', `晚间放映 · 11月24日 · 周二 20:00 · Illini Union · ${text('events.source.caaci')}`)
    // Its page still gives the end as the time it is.
    await card.click()
    await expect(page.locator('.ed')).toHaveAttribute('data-event-id', EVENING.id)
    await expect(page.locator('[data-test="event-time"]')).toHaveText('11月24日（周二）20:00 – 11月25日 00:00（美国中部时间）')
  })
})

test.describe('events from the desktop header and on a topic page', () => {
  test.use({ viewport: { width: DESKTOP.width, height: DESKTOP.height }, screen: { width: DESKTOP.width, height: DESKTOP.height } })

  test('the desktop header has 活动, which opens the list', async ({ page }) => {
    await serve(page)
    await page.goto('/#/pages/plaza/index', { waitUntil: 'networkidle' })
    const link = page.locator('.cx-nav [data-test="nav-events"]')
    await expect(link).toHaveText('活动')
    await link.click()
    await expect(page).toHaveURL(/\/pages\/events\/index/)
    await expect(cards(page).first()).toBeVisible()
  })

  test('a topic that is an event\'s discussion shows the event above its body (SPEC 6.4 row 6)', async ({ page }) => {
    const fixture = await installTopicFixture(page, { user: null })
    fixture.topic.category = 'events-social'
    const asked: URL[] = []
    await page.clock.setFixedTime(new Date(NOW))
    await page.route('**/rest/v1/community_events*', route => {
      const url = new URL(route.request().url())
      asked.push(url)
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify([{
          id: CAACI.id, source_type: 'caaci', region: 'cu', title: '迎新晚会', title_en: 'Welcome night', starts_at: CAACI.starts_at,
          ends_at: CAACI.ends_at, all_day: false, location: 'Illini Union', availability: 'visible', cancelled_at: null,
          previous_starts_at: null, schedule_changed_at: null, revision: 1, discussion_post_id: fixture.topic.id, partner: null,
        }]),
      })
    })
    await page.goto(`/#/pages/post/index?id=${fixture.topic.id}`, { waitUntil: 'networkidle' })
    const card = page.locator('[data-test="topic-event"] .evc')
    await expect(card).toBeVisible({ timeout: 15_000 })
    // The fixture's reader sees the app in English.
    await expect(card.locator('.evc-title')).toHaveText('Welcome night')
    await expect(card.locator('[data-test="event-source"]')).toHaveText('Hosted by CAACI')
    await expect(card.locator('.evc-when')).toHaveText('Sat 10:00 AM · Illini Union')
    // ENGINEERING 9.7: one row by discussion topic, through the allowlisted columns.
    expect(asked[0].searchParams.get('discussion_post_id')).toBe(`eq.${fixture.topic.id}`)
    // Only an event readers are shown: the organizer's own policy also returns one that was taken down.
    expect(asked[0].searchParams.get('availability')).toBe('eq.visible')
    expect(asked[0].searchParams.get('duplicate_of')).toBe('is.null')
    expect(asked[0].searchParams.get('limit')).toBe('1')
    // Only an event its page can open: the list reaches 180 days ahead (ENGINEERING 9.6).
    expect(asked[0].searchParams.get('starts_at')).toBe(`lte.${new Date(NOW + 180 * DAY).toISOString()}`)
    expect(asked[0].searchParams.get('select')).not.toMatch(/consent_ref|hidden_reason|content_hash|\*/)
    await card.click()
    await expect(page).toHaveURL(new RegExp(`/pages/event/detail/index\\?id=${CAACI.id}`))
  })

  test('a topic of another board asks for no event', async ({ page }) => {
    const fixture = await installTopicFixture(page, { user: null })
    let asked = 0
    await page.route('**/rest/v1/community_events*', route => { asked += 1; return route.fulfill({ contentType: 'application/json', body: '[]' }) })
    await page.goto(`/#/pages/post/index?id=${fixture.topic.id}`, { waitUntil: 'networkidle' })
    await expect(page.locator('.post-topic-title')).toHaveText(fixture.topic.title)
    await expect(page.locator('[data-test="topic-event"]')).toHaveCount(0)
    expect(asked).toBe(0)
  })
})
