import { expect, type Page, type Route } from '@playwright/test'
import type { CommunityEvent } from '../src/utils/communityEvents'
import { AUTHOR, READER, TOPIC, installTopicFixture } from './community-topic-fixture'

export const NOW = Date.parse('2026-11-22T16:00:00Z')
export const EVENT_ID = '70000000-0000-4000-8000-000000000057'
export const CONVERSATION_ID = '80000000-0000-4000-8000-000000000057'
const READERS = {
  guest: { user: null, level: 0, verified: false, owner: false },
  member: { user: READER, level: 0, verified: true, owner: false },
  unverified: { user: READER, level: 0, verified: false, owner: false },
  owner: { user: READER, level: 0, verified: true, owner: true },
  'restricted-owner': { user: READER, level: 2, verified: true, owner: true },
} as const

interface Scenario {
  readonly reader?: keyof typeof READERS
  readonly open?: boolean
  readonly lang?: 'en' | 'zh'
  readonly theme?: 'light' | 'dark'
}

// Scenarios deliberately change these wire responses between user actions.
interface MemberFixture {
  open: boolean
  member: CommunityEvent
  rows: CommunityEvent[]
  createCalls: unknown[]
  cancelCalls: { readonly body: unknown; readonly url: string }[]
  reportCalls: unknown[]
  conversationCalls: unknown[]
  switchReads: number
  abortCreateOnce: boolean
  createError: string
}

const json = (route: Route, value: unknown, status = 200) => route.fulfill({
  status, contentType: 'application/json', body: JSON.stringify(value),
})
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export async function installMemberEvents(page: Page, scenario: Scenario = {}): Promise<MemberFixture> {
  const reader = READERS[scenario.reader ?? 'member']
  await page.clock.setFixedTime(new Date(NOW))
  const topic = await installTopicFixture(page, {
    user: reader.user, level: reader.level, verified: reader.verified,
    lang: scenario.lang ?? 'en', theme: scenario.theme ?? 'light',
  })
  const member: CommunityEvent = {
    id: EVENT_ID, source_type: 'member', region: 'cu',
    title: 'Saturday badminton', title_en: null, summary: null, summary_en: null,
    organizer_name: null, partner_name_zh: null, partner_name_en: null, allowed_link_hosts: null,
    page_url: null, register_url: null, registration_mode: 'discussion',
    takes_registrations: null, registration_open: null,
    starts_at: '2026-11-24T16:00:00.000Z', ends_at: '2026-11-24T18:00:00.000Z',
    all_day: false, occurrence_count: 1, time_zone: 'America/Chicago', location: 'ARC',
    availability: 'visible', cancelled_at: null, status_note: null,
    previous_starts_at: null, schedule_changed_at: null, revision: 1,
    organizer_user_id: reader.owner ? READER : AUTHOR, organizer_nickname: 'Event organizer',
    organizer_avatar_url: null, organizer_is_illini_verified: true,
    discussion_post_id: TOPIC.id, discussion_count: 0,
  }
  const state: MemberFixture = {
    open: scenario.open ?? true, member, rows: [],
    createCalls: [], cancelCalls: [], reportCalls: [], conversationCalls: [],
    switchReads: 0, abortCreateOnce: false, createError: '',
  }
  await page.route('**/rest/v1/rpc/community_member_events_open', route => {
    state.switchReads += 1
    return json(route, state.open)
  })
  await page.route('**/rest/v1/rpc/list_community_events', route => json(route, state.rows))
  await page.route('**/rest/v1/rpc/create_member_event', async route => {
    const body: unknown = route.request().postDataJSON()
    state.createCalls.push(body)
    if (state.createError) {
      return json(route, { code: 'P0001', message: state.createError }, 400)
    }
    if (!record(body) || typeof body.post_id_in !== 'string' || typeof body.title_in !== 'string'
      || typeof body.content_in !== 'string'
      || !record(body.event_in) || typeof body.event_in.starts_at !== 'string'
      || typeof body.event_in.location !== 'string') {
      return json(route, { code: '22023', message: 'member_event_invalid' }, 400)
    }
    state.member = {
      ...member, organizer_user_id: READER, title: body.title_in, discussion_post_id: body.post_id_in,
      summary: body.content_in,
      starts_at: body.event_in.starts_at, location: body.event_in.location,
      ends_at: typeof body.event_in.ends_at === 'string' ? body.event_in.ends_at : null,
    }
    topic.topic = {
      ...topic.topic, id: body.post_id_in, title: body.title_in, content: body.content_in,
      user_id: READER, category: 'events-social',
      profile: { ...topic.topic.profile, id: READER, nickname: 'Reader' },
    }
    state.rows = [state.member]
    if (state.abortCreateOnce) {
      state.abortCreateOnce = false
      return route.abort('failed')
    }
    return json(route, { post_id: body.post_id_in, event_id: EVENT_ID })
  })
  await page.route('**/rest/v1/community_events?**', route => {
    if (route.request().method() !== 'PATCH') return route.fallback()
    const body: unknown = route.request().postDataJSON()
    state.cancelCalls.push({ body, url: route.request().url() })
    if (!record(body) || typeof body.cancelled_at !== 'string') {
      return json(route, { code: '22023', message: 'invalid cancellation' }, 400)
    }
    state.member = { ...state.member, cancelled_at: body.cancelled_at }
    state.rows = [state.member]
    return json(route, { id: EVENT_ID, cancelled_at: body.cancelled_at })
  })
  await page.route('**/rest/v1/reports', route => {
    const body: unknown = route.request().postDataJSON()
    state.reportCalls.push(body)
    return json(route, [], 201)
  })
  const conversation = {
    id: CONVERSATION_ID, is_direct: true, item_id: null, buyer_id: READER, seller_id: AUTHOR,
    created_at: new Date(NOW).toISOString(), last_message_at: null, item: null,
    is_pinned_buyer: false, is_pinned_seller: false, is_muted_buyer: false,
    is_muted_seller: false, is_unread_buyer: false, is_unread_seller: false,
    buyer: { id: READER, nickname: 'Reader', avatar_url: null },
    seller: { id: AUTHOR, nickname: 'Event organizer', avatar_url: null },
  }
  await page.route('**/rest/v1/conversations?**', route => {
    if (route.request().method() === 'POST') {
      const body: unknown = route.request().postDataJSON()
      state.conversationCalls.push(body)
      return json(route, conversation, 201)
    }
    const byId = new URL(route.request().url()).searchParams.has('id')
    return json(route, byId ? conversation : state.conversationCalls.length ? [conversation] : [])
  })
  return state
}

export async function openFresh(page: Page, path: string) {
  await page.goto('about:blank')
  await page.goto(`/#/${path}`, { waitUntil: 'networkidle' })
}

export async function fillMemberForm(page: Page) {
  const form = page.locator('.me-form')
  await expect(form).toBeVisible()
  await form.getByRole('textbox', { name: 'Title', exact: true }).fill('Saturday badminton')
  await form.locator('[data-field="startsAt"] input[type="date"]').fill('2026-11-24')
  await form.locator('[data-field="startsAt"] input[type="time"]').fill('10:00')
  await form.locator('[data-field="endsAt"] input[type="date"]').fill('2026-11-24')
  await form.locator('[data-field="endsAt"] input[type="time"]').fill('12:00')
  await form.getByRole('textbox', { name: 'Location', exact: true }).fill('ARC')
  await form.getByRole('textbox', { name: 'Details', exact: true }).fill('Bring a racket. Split court costs in person.')
}
