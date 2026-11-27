import type { Page, Route } from '@playwright/test'
import { supabaseRefForBuild } from './supabase-ref'
import { CURRENT_CONSENT_VERSION } from '../src/legal'
import en from '../src/composables/i18n/messages/en'

/*
 * Route fixtures for the topic page and the member's topic lists (P3.2, P3.6).
 * Nothing here reaches a real Supabase project: every request is answered from
 * the in-memory state below, which a test can read and change.
 */
export const text = (key: string) => (en as Record<string, string>)[key]

const REF = supabaseRefForBuild()
export const READER = '11111111-1111-4111-8111-111111111111'
export const AUTHOR = '55555555-5555-4555-8555-555555555555'
const AUTHOR_PROFILE = { id: AUTHOR, nickname: 'Topic Author', avatar_url: null, is_illini_verified: true, uid: 'author' }
export const TOPIC = {
  id: '33333333-3333-4333-8333-333333333333', user_id: AUTHOR, title: 'Cheap desk in Urbana', category: 'settling-market',
  content: 'Where can I find one?', images: [] as string[], image_dimensions: [], content_i18n: null, source_lang: 'en',
  is_official: false, is_pinned: false, like_count: 0, comment_count: 0, status: 'active',
  created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', last_activity_at: '2026-11-01T00:00:00Z',
  answered_at: null, is_featured: false, locked_at: null as string | null, profile: AUTHOR_PROFILE, post_items: [],
}

export interface TopicFixture {
  /** Rows of the two mark tables, by table name. */
  marks: Record<'post_follows' | 'post_bookmarks', Set<string>>
  /** Every write the page sent: method, table and JSON body. */
  writes: { method: string; table: string; body: unknown }[]
  /** What the server says about the topic. `visible: false` makes it unreadable, as row security does. */
  topic: typeof TOPIC & { visible: boolean }
  /** Answers of the two P3.6 functions. */
  state: 'active' | 'hidden' | 'missing'
  ownHidden: Record<string, unknown>[]
}

/*
 * Every toast the page has shown since it loaded, in order. The app announces each toast in one
 * live region (App.vue installToastAnnouncer); this records what that region says as it says it, so
 * a test does not have to catch a toast while it is on screen.
 */
export const announced = (page: Page) => page.evaluate(() => (window as unknown as { __announced?: string[] }).__announced || [])

const json = (route: Route, body: unknown, status = 200) => route.fulfill({
  status, contentType: 'application/json', headers: { 'content-range': '0-0/1' }, body: JSON.stringify(body),
})

/** Seeds a session (or none) and installs the routes. `level` puts the reader under that restriction. */
export async function installTopicFixture(page: Page, options: {
  readonly user?: string | null
  readonly level?: number
  readonly verified?: boolean
  readonly lang?: 'en' | 'zh'
  readonly theme?: 'light' | 'dark'
} = {}): Promise<TopicFixture> {
  const user = options.user === undefined ? READER : options.user
  const fixture: TopicFixture = {
    marks: { post_follows: new Set(), post_bookmarks: new Set() },
    writes: [], topic: { ...TOPIC, visible: true }, state: 'active', ownHidden: [],
  }
  await page.routeWebSocket(/\.supabase\.co(?:[:/]|$)/, socket => socket.close())
  await page.addInitScript(() => {
    const said: string[] = []
    ;(window as unknown as { __announced: string[] }).__announced = said
    let last = ''
    new MutationObserver(() => {
      const now = document.querySelector('body > div.sr-only[role="status"]')?.textContent?.trim() || ''
      if (now && now !== last) said.push(now)
      last = now
    }).observe(document, { childList: true, subtree: true, characterData: true })
  })
  await page.addInitScript(([ref, uid, lang, theme]) => {
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', lang)
    localStorage.setItem('theme_pref', theme)
    if (!uid) return
    const generation = 'topic-fixture-generation-0001'
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
      tag: 'caaci-auth-value-v2', generation,
      value: JSON.stringify({
        access_token: 'stub', token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r',
        user: { id: uid, email: 'reader@example.test', aud: 'authenticated', role: 'authenticated' },
      }),
    }))
    localStorage.setItem(`sb-${ref}-auth-token-auth-boundary-v2`, JSON.stringify({ v: 2, mode: 'allowed', generation }))
  }, [REF, user, options.lang ?? 'en', options.theme ?? 'light'] as const)

  const profile = {
    id: user, nickname: 'Reader', avatar_url: null, tos_version: CURRENT_CONSENT_VERSION, bio: '', location: 'UIUC',
    is_illini_verified: options.verified ?? true, suspension_level: options.level ?? 0,
    suspended_until: options.level ? '2100-12-03T12:34:56Z' : null,
  }
  await page.route('**/*.supabase.co/**', route => json(route, route.request().url().includes('/rpc/get_my_profile') ? profile : []))
  await page.route(/\/api\/(moderate|translate)(?:\?|$)/, route => json(route, { flagged: false, categories: [] }))
  await page.route('**/rest/v1/rpc/community_post_state', route => json(route, fixture.state))
  await page.route('**/rest/v1/rpc/list_own_hidden_posts', route => json(route, fixture.ownHidden))
  await page.route('**/rest/v1/posts?**', route => {
    const url = new URL(route.request().url())
    const { visible, ...row } = fixture.topic
    // `id=eq.<id>` for one topic, `id=in.(<id>,<id>)` for several, or no id filter at all.
    const wanted = url.searchParams.get('id')?.replace(/^(?:eq\.|in\.\()/, '').replace(/\)$/, '').split(',')
    return json(route, visible && (!wanted || wanted.includes(row.id)) ? [row] : [])
  })
  for (const table of ['post_follows', 'post_bookmarks'] as const) {
    await page.route(new RegExp(`/rest/v1/${table}(?:\\?|$)`), route => {
      const request = route.request()
      const marked = fixture.marks[table]
      if (request.method() === 'POST') {
        const body = request.postDataJSON()
        fixture.writes.push({ method: 'POST', table, body })
        marked.add(body.post_id)
        return json(route, [], 201)
      }
      if (request.method() === 'DELETE') {
        fixture.writes.push({ method: 'DELETE', table, body: null })
        marked.delete(fixture.topic.id)
        return json(route, [], 200)
      }
      const { visible, ...row } = fixture.topic
      const select = new URL(request.url()).searchParams.get('select') || ''
      // The list embeds the topic; the topic page only asks whether the row exists.
      if (select.includes('post:posts')) {
        return json(route, [...marked].map(() => ({ created_at: '2026-11-02T00:00:00Z', post: visible ? row : null })))
      }
      return json(route, marked.has(row.id) ? [{ post_id: row.id }] : [])
    })
  }
  return fixture
}

export const topicUrl = (extra = '') => `/#/pages/post/index?id=${TOPIC.id}${extra}`
