import { test, expect, type Page } from '@playwright/test'
import en from '../src/composables/i18n/messages/en'

/*
 * P4.9: the console's events tab, in a browser. The API is answered from the
 * rows below, in exactly the shape the console accepts. What is checked is
 * which buttons each row gets, what a click sends, what the row offers once
 * the list is read again, and that a refusal is told by name and leaves the
 * console able to try again.
 */
const NOW = Date.parse('2026-11-20T16:00:00Z')
const TOKEN = `iam_admin_${'a'.repeat(43)}`
const TOPIC = '74000000-0000-4000-8000-000000000001'
const copy = en as Record<string, string>

type Row = Record<string, unknown> & { id: string }
let serial = 0
const row = (source_type: string, extra: Record<string, unknown> = {}): Row => ({
  id: `73000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`, source_type,
  title: null, title_en: null, organizer_name: null, starts_at: new Date(NOW + serial * 86_400_000).toISOString(), ends_at: null,
  location: null, availability: 'visible', hidden_reason: null, cancelled_at: null, duplicate_of: null, discussion_post_id: null,
  partner: null, topic: null,
  ...extra,
})
const CAACI = row('caaci', { title: '迎新晚会', title_en: 'Welcome night' })
const PARTNER = row('partner', { title: '公开赛', partner: { name_zh: '国际象棋社', name_en: 'Chess Club', status: 'active' } })
const PAUSED = row('partner', { title: '读书会', partner: { name_zh: '读书社', name_en: 'Book Club', status: 'paused' } })
const UNTITLED = row('campus', { title_en: '   ', organizer_name: 'University Library' })
const DUPLICATE = row('campus', { title_en: 'Welcome night at the Union', organizer_name: 'Illini Union', duplicate_of: CAACI.id })
const DISCUSSED = row('campus', {
  title_en: 'Research workshop', organizer_name: 'University Library',
  discussion_post_id: '74000000-0000-4000-8000-000000000002', topic: { title: 'Research workshop', status: 'active' },
})
const MEMBER = row('member', { discussion_post_id: '74000000-0000-4000-8000-000000000003', topic: { title: '周日约饭', status: 'active' } })
const TAKEN_DOWN = row('campus', { title_en: 'Resume clinic', organizer_name: 'Career Center', availability: 'hidden', hidden_reason: 'admin' })
const TOPIC_GONE = row('member', {
  availability: 'hidden', hidden_reason: 'post_removed',
  discussion_post_id: '74000000-0000-4000-8000-000000000004', topic: { title: '周六羽毛球', status: 'hidden' },
})
const WITHDRAWN = row('caaci', { title: '春节联欢', availability: 'unavailable' })
const ROWS = [CAACI, PARTNER, PAUSED, UNTITLED, DUPLICATE, DISCUSSED, MEMBER, TAKEN_DOWN, TOPIC_GONE, WITHDRAWN]

interface Api { rows: Row[]; writes: Record<string, unknown>[]; refuse: string | null }

async function unlock(page: Page, role: 'owner' | 'operator', lang: 'en' | 'zh' = 'en'): Promise<Api> {
  const api: Api = { rows: ROWS.map(item => ({ ...item })), writes: [], refuse: null }
  await page.addInitScript((language) => {
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', language)
  }, lang)
  await page.routeWebSocket(/supabase\.co/, socket => socket.close())
  await page.route('**/*.supabase.co/**', route => route.fulfill({ contentType: 'application/json', body: '[]' }))
  await page.route(url => url.pathname.startsWith('/api/'), (route) => {
    const request = route.request()
    const answer = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>
      api.writes.push(body)
      if (api.refuse) return answer({ error: api.refuse }, 409)
      const target = api.rows.find(item => item.id === body.event_id)!
      if (body.action === 'hide_event') Object.assign(target, { availability: 'hidden', hidden_reason: 'admin' })
      if (body.action === 'unhide_event') Object.assign(target, { availability: 'visible', hidden_reason: null })
      if (body.action !== 'create_event_discussion') return answer({ success: true })
      Object.assign(target, { discussion_post_id: TOPIC, topic: { title: target.title || target.title_en, status: 'active' } })
      return answer({ data: { event_id: target.id, post_id: TOPIC, created: true } })
    }
    const resource = new URL(request.url()).searchParams.get('resource')
    if (resource === 'whoami') {
      return answer({ data: {
        admin_id: '11111111-1111-4111-8111-111111111111', token_id: '22222222-2222-4222-8222-222222222222',
        admin_name: 'Test administrator', admin_email: 'administrator@example.invalid', role, source: 'token', expires_at: null,
        server_now: new Date().toISOString(),
        capabilities: role === 'owner'
          ? ['apply_ban', 'resolve_target_reports', 'set_post_pinned', 'upsert_banner', 'delete_banner']
          : ['apply_ban', 'decide_appeal', 'lift_suspension', 'resolve_target_reports', 'takedown_content', 'update_report_status'],
      } })
    }
    if (resource === 'stats') {
      return answer({ data: { active_suspensions: 0, pending_reports: 0, pending_appeals: 0, shadow_banned: 0, oldest_pending_hours: null } })
    }
    return answer({ data: resource === 'community_events' ? api.rows : [] })
  })
  await page.goto('/#/pages/admin/index')
  await page.locator('.gate-input input').fill(TOKEN)
  await page.locator('.gate-btn').click()
  await page.locator('#admin-tab-community_events').click()
  await expect(card(page, CAACI)).toBeVisible()
  return api
}
const card = (page: Page, item: Row) => page.locator(`#admin-tab-panel .card[data-event-id="${item.id}"]`)
const offered = (page: Page, item: Row) => card(page, item).locator('[data-action]')
  .evaluateAll(buttons => buttons.map(button => button.getAttribute('data-action')))
async function act(page: Page, item: Row, action: string, reason: string) {
  await card(page, item).locator(`[data-action="${action}"]`).click()
  await page.locator('#admin-reason-input textarea').fill(reason)
  await page.locator('.reason-confirm').click()
}

test('the owner is offered, row by row, what the database would accept', async ({ page }) => {
  await unlock(page, 'owner')
  const expected: [Row, string[]][] = [
    [CAACI, ['create_event_discussion', 'hide_event']],
    [PARTNER, ['create_event_discussion', 'hide_event']],
    // No discussion for a partner that is not active, a row with no title to give the topic, a duplicate,
    // a row that has one already, or a member's event, which has its own topic.
    [PAUSED, ['hide_event']], [UNTITLED, ['hide_event']], [DUPLICATE, ['hide_event']], [DISCUSSED, ['hide_event']], [MEMBER, ['hide_event']],
    // Only an administrator's own takedown is undone here.
    [TAKEN_DOWN, ['unhide_event']],
    // Hidden with its topic: it comes back with the topic. Withdrawn by its source: it stays as the source left it.
    [TOPIC_GONE, []], [WITHDRAWN, []],
  ]
  for (const [item, actions] of expected) expect(await offered(page, item), JSON.stringify(item)).toEqual(actions)
  // A row is named by its title, and by its id when it has none; the organizer is named in the console's language.
  await expect(card(page, CAACI).locator('.card-title')).toHaveText('迎新晚会')
  await expect(card(page, MEMBER).locator('.card-title')).toHaveText('周日约饭')
  await expect(card(page, UNTITLED).locator('.card-title')).toHaveText(UNTITLED.id)
  await expect(card(page, PARTNER).locator('.card-meta')).toContainText('Chess Club')
  await expect(card(page, PARTNER).locator('.card-meta')).not.toContainText('国际象棋社')
  await expect(card(page, DUPLICATE).locator('.card-meta')).toContainText('Illini Union')
})

test('a moderator is offered takedown and its undo, never the discussion; a Chinese console names the partner in Chinese', async ({ page }) => {
  await unlock(page, 'operator', 'zh')
  for (const item of ROWS) expect(await offered(page, item), JSON.stringify(item)).not.toContain('create_event_discussion')
  expect(await offered(page, CAACI)).toEqual(['hide_event'])
  expect(await offered(page, TAKEN_DOWN)).toEqual(['unhide_event'])
  expect(await offered(page, WITHDRAWN)).toEqual([])
  await expect(card(page, PARTNER).locator('.card-meta')).toContainText('国际象棋社')
})

test('a takedown and its undo each send their own action with the reason, and the row follows the list', async ({ page }) => {
  const api = await unlock(page, 'operator')
  await act(page, CAACI, 'hide_event', 'Synthetic takedown')
  await expect.poll(() => offered(page, CAACI)).toEqual(['unhide_event'])
  await act(page, CAACI, 'unhide_event', 'Synthetic restore')
  await expect.poll(() => offered(page, CAACI)).toEqual(['hide_event'])
  expect(api.writes).toEqual([
    { action: 'hide_event', event_id: CAACI.id, reason: 'Synthetic takedown' },
    { action: 'unhide_event', event_id: CAACI.id, reason: 'Synthetic restore' },
  ])
})

test('a refused discussion is told by name, and the same button works once the cause is gone', async ({ page }) => {
  const api = await unlock(page, 'owner')
  const toast = page.locator('.uni-simple-toast__text')
  // The official account is not configured (E6): nothing was written, and the message is the one for that refusal.
  api.refuse = 'official_profile_not_configured'
  await act(page, CAACI, 'create_event_discussion', 'Synthetic discussion')
  await expect(toast).toHaveText(copy['admin.errOfficialNotConfigured'])
  // The event stopped qualifying between the list and the click.
  api.refuse = 'event_discussion_closed'
  await act(page, CAACI, 'create_event_discussion', 'Synthetic discussion')
  await expect(toast).toHaveText(copy['events.err.discussionClosed'])
  expect(await offered(page, CAACI)).toEqual(['create_event_discussion', 'hide_event'])
  // Neither refusal left a request pending: the next try goes through, and the row then has its discussion.
  api.refuse = null
  await act(page, CAACI, 'create_event_discussion', 'Synthetic discussion')
  await expect.poll(() => offered(page, CAACI)).toEqual(['hide_event'])
  expect(api.writes.map(write => write.action)).toEqual(['create_event_discussion', 'create_event_discussion', 'create_event_discussion'])
  expect(api.writes.at(-1)).toEqual({ action: 'create_event_discussion', event_id: CAACI.id, reason: 'Synthetic discussion' })
})
