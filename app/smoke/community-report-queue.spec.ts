import { test, expect, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { text } from './community-topic-fixture'
import { supabaseRefForBuild } from './supabase-ref'

/*
 * P3.6 ③ and P3.5 in the running console, on a stubbed API. The pending queue is shown in the order
 * the server gives it (longest wait first), and a wait over 24 hours and one over 48 are each painted
 * on their own surface. A topic card shows what SPEC 6.11 lists and the list read returns. Each
 * governance button asks for a reason and sends its own action.
 */
test.use({ browserName: 'webkit' })

const OWNER = '11111111-1111-4111-8111-111111111111'
const TOKEN_ID = '22222222-2222-4222-8222-222222222222'
const AUTHOR = '55555555-5555-4555-8555-555555555555'
const TIME = '2026-11-18T12:00:00Z'
const HOUR = 3_600_000
const REASON = 'Synthetic reason for this test'
const THUMB = `https://${supabaseRefForBuild()}.supabase.co/storage/v1/object/public/post-images/posts/${AUTHOR}/first.png`
const uuid = (n: number) => '00000000-0000-4000-8000-000000000000'.replace(/0/g, String(n))
const iso = (ms: number) => new Date(ms).toISOString()

// One row of the pending queue: a target, since when its oldest pending report has waited, when its
// newest report came in and how many there are.
const waiting = (n: number, reason: string, since: number, newest: number, reports: number): Record<string, unknown> => ({
  target_type: 'post', target_id: uuid(n), report_count: reports, pending_count: reports, reporter_count: reports,
  last_reason: reason, last_note: null, last_reporter_nickname: 'Test reporter', last_status: 'pending',
  first_created_at: iso(since), last_created_at: iso(newest), last_report_id: uuid(n + 5), oldest_pending_at: iso(since),
})

const topic = (fields: Record<string, unknown>) => ({
  id: uuid(3), title: 'A synthetic topic', category: 'campus-life', content: 'Synthetic body', author_nickname: 'Test author',
  author_id: AUTHOR, status: 'active', is_pinned: false, is_official: false, is_featured: false, locked_at: null,
  like_count: 0, comment_count: 0, thumbnail: null, created_at: TIME, last_activity_at: TIME, ...fields,
})

async function openConsole(page: Page, lists: { queue?: unknown[]; topics?: (status: string | null) => unknown[] }) {
  await page.addInitScript(() => { localStorage.setItem('welcomed', '1'); localStorage.setItem('lang', 'en') })
  await page.routeWebSocket(/supabase\.co/, socket => socket.close())
  await page.route('**/*.supabase.co/**', route => route.fulfill({ json: [] }))
  await page.route(THUMB, route => route.fulfill({ contentType: 'image/png', body: readFileSync(resolve('src/static/banner-safety.png')) }))
  const writes: Array<Record<string, unknown>> = []
  await page.route(url => url.pathname.startsWith('/api/'), route => {
    const request = route.request()
    if (request.method() === 'POST') {
      const body = request.postDataJSON()
      writes.push(body)
      if (body.action === 'resolve_target_reports') lists.queue = (lists.queue || []).filter(row => (row as { target_id?: string }).target_id !== body.target_id)
      return route.fulfill({ json: { ok: true, data: TOKEN_ID } })
    }
    const query = new URL(request.url()).searchParams
    const resource = query.get('resource')
    const data = resource === 'whoami' ? {
      admin_id: OWNER, token_id: TOKEN_ID, admin_name: 'Test owner', admin_email: 'owner@example.invalid', role: 'owner',
      source: 'token', expires_at: null, server_now: new Date().toISOString(),
      capabilities: ['apply_ban', 'resolve_target_reports', 'set_post_pinned', 'upsert_banner', 'delete_banner'],
    }
      : resource === 'stats' ? { active_suspensions: 0, pending_reports: (lists.queue || []).length, pending_appeals: 0, shadow_banned: 0, oldest_pending_hours: null }
      : resource === 'report_queue' ? (lists.queue || [])
      : resource === 'community_posts' ? (lists.topics ? lists.topics(query.get('status')) : [])
      : []
    return route.fulfill({ json: { data } })
  })
  await page.goto('/#/pages/admin/index')
  await page.getByRole('textbox', { name: 'Enter personal admin token' }).fill(`iam_admin_${'a'.repeat(43)}`)
  await page.getByRole('button', { name: 'Unlock', exact: true }).click()
  await expect(page.getByRole('tab', { name: text('admin.tabReports'), exact: true })).toBeVisible()
  return writes
}

const reportCards = (page: Page) => page.locator('.card:has(.pill-count)')
const paint = (target: Locator) => target.evaluate(el => getComputedStyle(el).backgroundColor)

test('the pending queue keeps the order it is given and paints a wait over 24 hours and one over 48', async ({ page }) => {
  const now = Date.now()
  // Longest wait first, as the server sorts it. Neither the newest report nor the number of reports
  // gives this order, so a console that sorted the rows again would show another one.
  await openConsole(page, { queue: [
    waiting(1, 'Sixty hours', now - 60 * HOUR, now - 2 * HOUR, 1),
    waiting(2, 'Thirty hours', now - 30 * HOUR, now - 29 * HOUR, 3),
    waiting(3, 'One hour', now - HOUR, now - HOUR, 2),
  ] })
  await expect(reportCards(page).locator('.card-title')).toHaveText(['post · Sixty hours', 'post · Thirty hours', 'post · One hour'])

  const card = (reason: string) => reportCards(page).filter({ hasText: reason })
  // What each surface token paints where the cards are, read from the page itself.
  const surface = (token: string) => card('One hour').evaluate((el, name) => {
    const probe = el.parentElement!.appendChild(document.createElement('div'))
    probe.style.backgroundColor = `var(${name})`
    const colour = getComputedStyle(probe).backgroundColor
    probe.remove()
    return colour
  }, token)
  const danger = await surface('--danger-soft')
  const warning = await surface('--warning-soft')
  expect(new Set([danger, warning, await paint(card('One hour'))]).size).toBe(3)
  await expect.poll(() => paint(card('Sixty hours'))).toBe(danger)
  await expect.poll(() => paint(card('Thirty hours'))).toBe(warning)
  await expect(card('Sixty hours').locator('.pill-wait')).toHaveText(text('admin.waitOver48'))
  await expect(card('Thirty hours').locator('.pill-wait')).toHaveText(text('admin.waitOver24'))
  await expect(card('One hour').locator('.pill-wait')).toHaveCount(0)

  // Settling one target reads the queue again: the rest keep their order and their marks.
  await card('Thirty hours').getByRole('button', { name: 'Resolve all', exact: true }).click()
  await page.locator('.uni-modal__btn_primary').click()
  await expect(reportCards(page).locator('.card-title')).toHaveText(['post · Sixty hours', 'post · One hour'])
  await expect.poll(() => paint(card('Sixty hours'))).toBe(danger)
  await expect(card('One hour').locator('.pill-wait')).toHaveCount(0)
})

test('a queue row that does not say since when its target has waited is refused, not shown unmarked', async ({ page }) => {
  const row = waiting(1, 'Sixty hours', Date.now() - 60 * HOUR, Date.now() - 60 * HOUR, 1)
  delete row.oldest_pending_at
  await openConsole(page, { queue: [row] })
  await expect(page.locator('.admin-read-error')).toHaveCount(1)
  await expect(reportCards(page)).toHaveCount(0)
  await expect(page.getByText(text('admin.emptyReports'), { exact: true })).toHaveCount(0)
})

test('a topic card shows its board and author, the start of its body and its first image', async ({ page }, testInfo) => {
  // The list read cuts the body at 200 characters.
  const body = 'A sentence of the body. '.repeat(9).slice(0, 200).trim()
  const long = topic({ id: uuid(3), title: 'Where to buy winter boots', content: body, thumbnail: THUMB })
  const short = topic({ id: uuid(4), title: null, category: null, content: 'A short update' })
  await openConsole(page, { topics: status => (status === 'hidden' ? [] : [long, short]) })
  await page.getByRole('tab', { name: text('admin.tabTopics'), exact: true }).click()

  const card = page.locator(`.card[data-topic-id="${long.id}"]`)
  await expect(card.locator('.card-title')).toHaveText('Where to buy winter boots')
  await expect(card.locator('.card-head + .card-meta')).toContainText(`${text('plaza.category.campus-life')} · Test author`)
  await expect(card.locator('.topic-excerpt')).toHaveText(body)
  // <image> paints through a child div's background on H5.
  await expect.poll(() => card.locator('.topic-body .banner-thumb > div').evaluate(el => getComputedStyle(el).backgroundImage))
    .toContain(`/posts/${AUTHOR}/first.png`)
  await card.screenshot({ path: testInfo.outputPath('admin-topic-card.png'), animations: 'disabled' })

  // An update has no title, so its line is already the start of its body: a short one is not printed twice.
  const update = page.locator(`.card[data-topic-id="${short.id}"]`)
  await expect(update.locator('.card-title')).toHaveText('A short update')
  await expect(update.locator('.topic-body')).toHaveCount(0)
})

test('each governance button asks for a reason and sends its own action', async ({ page }) => {
  const official = topic({ id: uuid(3), title: 'Read this first', is_official: true })
  const hidden = topic({ id: uuid(4), title: 'Taken down', status: 'hidden' })
  const writes = await openConsole(page, { topics: status => (status === 'hidden' ? [hidden] : [official]) })
  await page.getByRole('tab', { name: text('admin.tabTopics'), exact: true }).click()

  const govern = async (card: Locator, label: string, board?: string) => {
    const sent = writes.length
    const button = card.getByRole('button', { name: label, exact: true })
    // The card's buttons are off while the last action and the list reload after it are under way.
    await expect(button).toHaveAttribute('aria-disabled', 'false')
    await button.click()
    if (board) await page.locator('.uni-actionsheet__cell').filter({ hasText: board }).click()
    const dialog = page.getByRole('dialog', { name: label })
    if (sent === 0) {
      // Without a reason nothing is sent and the question stays open.
      await dialog.locator('.reason-confirm').click()
      await expect(dialog).toBeVisible()
      expect(writes).toHaveLength(0)
    }
    await page.locator('#admin-reason-input textarea').fill(REASON)
    await dialog.locator('.reason-confirm').click()
    await expect.poll(() => writes.length).toBe(sent + 1)
    await expect(dialog).toHaveCount(0)
  }

  const card = page.locator(`.card[data-topic-id="${official.id}"]`)
  await govern(card, text('admin.lockReplies'))
  await govern(card, text('admin.unsetOfficial'))
  await govern(card, text('admin.feature'))
  await govern(card, text('admin.changeBoard'), text('plaza.category.settling-market'))
  await page.getByRole('button', { name: text('admin.topicsHidden'), exact: true }).click()
  await govern(page.locator(`.card[data-topic-id="${hidden.id}"]`), text('admin.restoreContent'))

  expect(writes).toMatchObject([
    { action: 'set_post_locked', post_id: official.id, locked: true, reason: REASON },
    { action: 'set_post_official', post_id: official.id, official: false, reason: REASON },
    { action: 'set_post_featured', post_id: official.id, featured: true, reason: REASON },
    { action: 'set_post_category', post_id: official.id, category: 'settling-market', reason: REASON },
    { action: 'restore_content', target_type: 'post', target_id: hidden.id, reason: REASON },
  ])
})
