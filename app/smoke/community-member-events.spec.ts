import { test, expect } from '@playwright/test'
import { AUTHOR, READER, TOPIC, announced, text } from './community-topic-fixture'
import { CONVERSATION_ID, EVENT_ID, fillMemberForm, installMemberEvents, openFresh } from './community-member-event-fixture'

const CREATE = 'pages/event/create/index'
const DETAIL = `pages/event/detail/index?id=${EVENT_ID}`
const organize = /^Organize(?: an event)?$/
const errors = {
  titleRequired: 'Add a title.',
  titleLong: 'Titles can be up to 60 characters.',
  content: 'Add details, up to 2,000 characters.',
  location: 'Add a location, up to 80 characters.',
  links: "Member events can't include links. Use the discussion or messages instead.",
  wording: 'Member events can\'t say "official" or "hosted by". Ask the site team to share an organization\'s event.',
  time: 'The start time must be within 60 days.',
  end: "The end can't be before the start or more than 30 days after it.",
  closed: "Organizing events isn't open yet.",
  limit: 'You already have 2 upcoming events. End or cancel one first.',
} as const

const invalid = [
  ['empty title', 'title', 'input', '', errors.titleRequired],
  ['long title', 'title', 'input', 'x'.repeat(61), errors.titleLong],
  ['empty details', 'content', 'textarea', '', errors.content],
  ['long details', 'content', 'textarea', 'x'.repeat(2001), errors.content],
  ['empty location', 'location', 'input', '', errors.location],
  ['long location', 'location', 'input', 'x'.repeat(81), errors.location],
  ['title link', 'title', 'input', 'Meet at https://example.test', errors.links],
  ['details link', 'content', 'textarea', 'Read https://example.test', errors.links],
  ['location link', 'location', 'input', 'www.example.org', errors.links],
  ['reserved title', 'title', 'input', 'OFFICIAL badminton', errors.wording],
  ['reserved location', 'location', 'input', 'Hosted by someone', errors.wording],
  ['missing start', 'startsAt', 'input[type="date"]', '', errors.time],
  ['past start', 'startsAt', 'input[type="date"]', '2026-11-21', errors.time],
  ['distant start', 'startsAt', 'input[type="date"]', '2027-02-01', errors.time],
  ['end before start', 'endsAt', 'input[type="date"]', '2026-11-23', errors.end],
  ['end beyond thirty days', 'endsAt', 'input[type="date"]', '2026-12-25', errors.end],
  ['incomplete end', 'endsAt', 'input[type="time"]', '', errors.end],
] as const

for (const width of [390, 1280]) {
  test.describe(`member events at ${width}px`, () => {
    test.use({
      viewport: { width, height: 900 }, isMobile: width === 390, hasTouch: width === 390,
      timezoneId: 'Asia/Shanghai',
    })

    test('closed entries stay absent, while the open switch shows every applicable entry', async ({ page }, testInfo) => {
      const fixture = await installMemberEvents(page, { open: false })
      await openFresh(page, 'pages/events/index')
      await expect(page.locator('[data-test="events-empty"]')).toBeVisible()
      const seen = await page.evaluate(() => new Promise<boolean>(resolve => {
        const start = performance.now()
        let found = false
        const sample = () => {
          found ||= document.querySelector('[data-test="member-event-start"]') !== null
          if (performance.now() - start >= 1500) resolve(found)
          else requestAnimationFrame(sample)
        }
        sample()
      }))
      expect(seen).toBe(false)
      fixture.open = true
      await page.reload({ waitUntil: 'networkidle' })
      await expect(page.getByRole('button', { name: organize })).toHaveCount(width === 390 ? 2 : 3)
      await page.screenshot({ path: testInfo.outputPath(`events-${width}-light-en.png`), animations: 'disabled' })
      await page.getByRole('tab', { name: 'Members', exact: true }).click()
      await expect(page.locator('[data-test="events-empty"]').getByRole('button', { name: organize })).toBeVisible()
    })

    test('a guest follows the existing login flow', async ({ page }) => {
      await installMemberEvents(page, { reader: 'guest' })
      await openFresh(page, 'pages/events/index')
      await expect(page.getByRole('button', { name: organize }).first()).toBeVisible()
      await page.getByRole('button', { name: organize }).first().click()
      await expect(page).toHaveURL(/pages\/login\/index/)
    })

    test('an unverified member is sent to campus verification', async ({ page }) => {
      await installMemberEvents(page, { reader: 'unverified' })
      await openFresh(page, 'pages/events/index')
      await expect(page.getByRole('button', { name: organize }).first()).toBeVisible()
      await page.getByRole('button', { name: organize }).first().click()
      const sheet = page.locator('uni-actionsheet')
      await expect(sheet).toContainText('Verify your campus email to organize an event.')
      await sheet.getByRole('menuitem', { name: 'Go verify', exact: true }).click()
      await expect(page).toHaveURL(/pages\/illini-verify\/index/)
    })

    test('a verified member reaches the form', async ({ page }) => {
      await installMemberEvents(page)
      await openFresh(page, 'pages/events/index')
      await expect(page.getByRole('button', { name: organize }).first()).toBeVisible()
      await page.getByRole('button', { name: organize }).first().click()
      await expect(page).toHaveURL(/pages\/event\/create\/index/)
      await expect(page.locator('.me-form')).toBeVisible()
    })

    test('a direct form link stays closed when the switch is off', async ({ page }) => {
      const fixture = await installMemberEvents(page, { open: false })
      await openFresh(page, CREATE)
      await expect(page.getByText(errors.closed, { exact: true })).toBeVisible()
      await expect(page.locator('.me-form')).toHaveCount(0)
      expect(fixture.createCalls).toHaveLength(0)
    })

    for (const [name, field, selector, value, message] of invalid) {
      test(`local validation: ${name}`, async ({ page }) => {
        const fixture = await installMemberEvents(page)
        await openFresh(page, CREATE)
        await fillMemberForm(page)
        const group = page.locator(`.me-form [data-field="${field}"]`)
        await group.locator(selector).fill(value)
        await page.locator('.me-form').getByRole('button', { name: 'Organize an event', exact: true }).click()
        await expect(group.getByRole('alert')).toHaveText(message)
        expect(fixture.createCalls).toHaveLength(0)
      })
    }

    test('submission sends one complete payload in campus time and opens the event', async ({ page }) => {
      const fixture = await installMemberEvents(page)
      await openFresh(page, CREATE)
      await fillMemberForm(page)
      await page.locator('.me-form').getByRole('button', { name: 'Organize an event', exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`pages/event/detail/index\\?id=${EVENT_ID}`))
      expect(fixture.createCalls).toEqual([{
        post_id_in: expect.stringMatching(/^[0-9a-f-]{36}$/),
        title_in: 'Saturday badminton',
        content_in: 'Bring a racket. Split court costs in person.',
        event_in: { starts_at: '2026-11-24T16:00:00.000Z', ends_at: '2026-11-24T18:00:00.000Z', location: 'ARC' },
      }])
      await expect(page.getByRole('heading', { name: 'Saturday badminton', exact: true })).toBeVisible()
    })

    test('an omitted end is sent as null', async ({ page }) => {
      const fixture = await installMemberEvents(page)
      await openFresh(page, CREATE)
      await fillMemberForm(page)
      await page.locator('[data-field="endsAt"] input[type="date"]').fill('')
      await page.locator('[data-field="endsAt"] input[type="time"]').fill('')
      await page.locator('.me-form').getByRole('button', { name: 'Organize an event', exact: true }).click()
      await expect(page).toHaveURL(/pages\/event\/detail\/index/)
      expect(fixture.createCalls).toHaveLength(1)
      expect(fixture.createCalls[0]).toMatchObject({ event_in: { ends_at: null } })
    })

    test('an uncertain result survives reload and retries the same post id', async ({ page }) => {
      const fixture = await installMemberEvents(page)
      fixture.abortCreateOnce = true
      await openFresh(page, CREATE)
      await fillMemberForm(page)
      await page.locator('.me-form').getByRole('button', { name: 'Organize an event', exact: true }).click()
      await expect(page.locator('.me-form > [role="alert"]')).toBeVisible()
      expect(fixture.createCalls).toHaveLength(1)
      await page.reload({ waitUntil: 'networkidle' })
      await expect(page.locator('[data-field="title"] input')).toHaveValue('Saturday badminton')
      await page.locator('.me-form').getByRole('button', { name: 'Organize an event', exact: true }).click()
      await expect(page).toHaveURL(/pages\/event\/detail\/index/)
      expect(fixture.createCalls).toHaveLength(2)
      expect(fixture.createCalls[1]).toEqual(fixture.createCalls[0])
    })

    for (const [code, message] of [['member_event_active_limit', errors.limit], ['member_events_closed', errors.closed]] as const) {
      test(`server rejection: ${code}`, async ({ page }) => {
        const fixture = await installMemberEvents(page)
        fixture.createError = code
        await openFresh(page, CREATE)
        await fillMemberForm(page)
        await page.locator('.me-form').getByRole('button', { name: 'Organize an event', exact: true }).click()
        await expect(page.locator('.me-form > [role="alert"]')).toHaveText(message)
        expect(fixture.createCalls).toHaveLength(1)
      })
    }

    for (const reader of ['owner', 'restricted-owner'] as const) {
      test(`${reader} can cancel while creation is closed`, async ({ page }, testInfo) => {
        const fixture = await installMemberEvents(page, { reader, open: false })
        fixture.rows = [fixture.member]
        await openFresh(page, DETAIL)
        await expect(page.getByRole('button', { name: 'Message organizer', exact: true })).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Message', exact: true })).toHaveCount(0)
        await page.screenshot({ path: testInfo.outputPath(`event-${reader}-${width}-light-en.png`), animations: 'disabled' })
        await expect(page.locator('.ed-more')).toBeVisible()
        await page.locator('.ed-more').click()
        const menu = page.locator('uni-actionsheet')
        await expect(menu.getByRole('menuitem', { name: 'Copy link', exact: true })).toBeVisible()
        await expect(menu.getByRole('menuitem', { name: 'Report', exact: true })).toHaveCount(0)
        await menu.getByRole('menuitem', { name: 'Cancel event', exact: true }).click()
        const modal = page.locator('uni-modal')
        await expect(modal).toContainText("This can't be undone.")
        await modal.getByRole('button', { name: 'Confirm', exact: true }).click()
        await expect(page.getByText(text('events.status.cancelled'), { exact: true })).toBeVisible()
        await page.screenshot({ path: testInfo.outputPath(`event-${reader}-cancelled-${width}-light-en.png`), animations: 'disabled' })
        expect(fixture.cancelCalls).toHaveLength(1)
        for (const call of fixture.cancelCalls) {
          expect(call.body).toEqual({ cancelled_at: expect.any(String) })
          const url = new URL(call.url)
          expect(url.searchParams.get('id')).toBe(`eq.${EVENT_ID}`)
          expect(url.searchParams.get('organizer_user_id')).toBe(`eq.${READER}`)
        }
      })
    }

    test('another member can report and message but cannot cancel', async ({ page }, testInfo) => {
      const fixture = await installMemberEvents(page)
      fixture.rows = [fixture.member]
      await openFresh(page, DETAIL)
      await expect(page.getByRole('button', { name: 'Message organizer', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Message', exact: true })).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath(`event-member-${width}-light-en.png`), animations: 'disabled' })
      await page.locator('.ed-more').click()
      const menu = page.locator('uni-actionsheet')
      await expect(menu.getByRole('menuitem', { name: 'Report', exact: true })).toBeVisible()
      await expect(menu.getByRole('menuitem', { name: 'Cancel event', exact: true })).toHaveCount(0)
      await menu.getByRole('menuitem', { name: 'Report', exact: true }).click()
      const reason = menu.getByRole('menuitem', { name: text('report.reasonSpam'), exact: true })
      await expect(reason).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath(`event-report-${width}-light-en.png`), animations: 'disabled' })
      await reason.click()
      await expect.poll(() => announced(page)).toContain(text('report.thanksCommunity'))
      expect(fixture.reportCalls).toEqual([{
        reporter_id: READER, target_type: 'post', target_id: TOPIC.id,
        reason: text('report.reasonSpam'), note: '',
      }])
      await page.getByRole('button', { name: 'Message organizer', exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`pages/chat/index\\?id=${CONVERSATION_ID}$`))
      expect(fixture.conversationCalls).toEqual([{
        item_id: null, buyer_id: READER, seller_id: AUTHOR, is_direct: true,
      }])
    })

    for (const theme of ['light', 'dark'] as const) {
      test(`create form ${theme} Chinese evidence`, async ({ page }, testInfo) => {
        await page.emulateMedia({ colorScheme: theme })
        await installMemberEvents(page, { lang: 'zh', theme })
        await openFresh(page, CREATE)
        await expect(page.locator('.me-form')).toBeVisible()
        await expect(page.getByPlaceholder('周六下午 ARC 羽毛球，3 缺 3')).toBeVisible()
        await expect(page.getByPlaceholder('ARC（公共场所）')).toBeVisible()
        await expect(page.getByPlaceholder('费用怎么分、要带什么、怎么联系你')).toBeVisible()
        await expect(page.getByText('私人住所只写大致区域，不要写门牌号和房间号', { exact: true })).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: testInfo.outputPath(`create-${width}-${theme}-zh.png`), animations: 'disabled' })
      })
    }
  })
}
