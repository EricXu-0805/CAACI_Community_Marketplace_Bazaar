import { test, expect, type Page } from '@playwright/test'
import { supabaseRefForBuild } from './supabase-ref'
import { CURRENT_CONSENT_VERSION } from '../src/legal'

// P2.7: a topic that posted while its item link failed can be completed later
// by its author, without ever writing a second post.
test.beforeEach(async ({ page }) => {
  await page.routeWebSocket(/\.supabase\.co(?:[:/]|$)/, socket => socket.close())
})

const REF = supabaseRefForBuild()
const UID = '11111111-1111-4111-8111-111111111111'
const OTHER = '99999999-9999-4999-8999-999999999999'
const POST_ID = '55555555-5555-4555-8555-555555555555'
const ITEM = {
  id: '66666666-6666-4666-8666-666666666666', user_id: UID, title: 'Desk lamp', title_i18n: null,
  price: 12, images: [], image_dimensions: null, status: 'active', listing_details: null, listing_type: 'sell',
}
const profile = (id: string) => ({
  id, nickname: 'Test User', avatar_url: null, tos_version: CURRENT_CONSENT_VERSION,
  suspension_level: 0, suspended_until: null, is_illini_verified: true, bio: 'hi', location: 'UIUC',
})

type Reply = { status: number; body?: unknown }
type State = {
  postWrites: number
  itemReplies: Reply[]
  linked: boolean
  failNextPostRead: boolean
}

async function signIn(page: Page, uid: string, pending?: { account: string; ids: string[] }) {
  await page.addInitScript(([ref, uid, pending]) => {
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', 'en')
    localStorage.setItem('theme_pref', 'light')
    const gen = `partial-attach-${uid}`
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
      tag: 'caaci-auth-value-v2', generation: gen,
      value: JSON.stringify({
        access_token: 'stub', token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r',
        user: { id: uid, email: 'a@illinois.edu', aud: 'authenticated', role: 'authenticated' },
      }),
    }))
    localStorage.setItem(`sb-${ref}-auth-token-auth-boundary-v2`, JSON.stringify({ v: 2, mode: 'allowed', generation: gen }))
    if (pending) sessionStorage.setItem(`pending-post-items:${pending.account}:${'55555555-5555-4555-8555-555555555555'}`, JSON.stringify(pending.ids))
  }, [REF, uid, pending ?? null] as const)
}

async function serve(page: Page, uid: string, state: State) {
  const post = () => ({
    id: POST_ID, user_id: UID, title: 'Selling my desk lamp', category: 'settling-market', content: 'Works well',
    images: [], image_dimensions: null, content_i18n: null, source_lang: 'en', is_official: false, is_pinned: false,
    like_count: 0, comment_count: 0, status: 'active', created_at: '2026-11-13T00:00:00Z', updated_at: '2026-11-13T00:00:00Z',
    profile: profile(UID), post_items: state.linked ? [{ display_order: 0, item: ITEM }] : [],
  })
  await page.route('**/*.supabase.co/**', route => route.fulfill({
    status: 200, contentType: 'application/json', headers: { 'content-range': '0-0/1' },
    body: JSON.stringify(route.request().url().includes('/rpc/get_my_profile') ? profile(uid) : []),
  }))
  await page.route(/\/api\/(moderate|translate)(?:\?|$)/, route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ flagged: false, categories: [] }),
  }))
  await page.route('**/rest/v1/items?**', route => {
    const url = new URL(route.request().url())
    const rows = url.searchParams.get('id')?.startsWith('in.') || url.searchParams.get('status') === 'eq.active' ? [ITEM] : []
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(rows) })
  })
  await page.route('**/rest/v1/post_items**', route => {
    const request = route.request()
    if (request.method() === 'GET') {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(state.linked ? [{ item_id: ITEM.id }] : []) })
    }
    const reply = state.itemReplies.shift() ?? { status: 201 }
    if (reply.status < 300) state.linked = true
    return route.fulfill({ status: reply.status, contentType: 'application/json', body: reply.body ? JSON.stringify(reply.body) : '' })
  })
  await page.route('**/rest/v1/posts**', route => {
    const request = route.request()
    if (request.method() === 'POST') {
      state.postWrites += 1
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(post()) })
    }
    if (request.method() !== 'GET') return route.fulfill({ status: 204, body: '' })
    const url = new URL(request.url())
    if (url.searchParams.get('id') === `eq.${POST_ID}` && state.failNextPostRead) {
      state.failNextPostRead = false
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'refetch failed' }) })
    }
    const single = request.headers().accept?.includes('vnd.pgrst.object')
    const body = url.searchParams.get('id') === `eq.${POST_ID}` ? (single ? post() : [post()]) : []
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
  })
}

const LONG_TITLE = 'Selling my desk lamp, barely used, pick it up near the Main Library this weekend, cash or Venmo is fine'
const TITLE_LEFT = 120 - Array.from(LONG_TITLE).length

async function publishWithItem(page: Page, state: State) {
  await signIn(page, UID)
  await serve(page, UID, state)
  await page.goto('/#/pages/plaza/index', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'New post', exact: true }).filter({ visible: true }).click({ timeout: 15_000 })
  const composer = page.locator('.composer-fullpage')
  const title = page.locator('.topic-title-input input')
  const body = page.locator('.comp-textarea textarea')
  // uni-input syncs v-model behind a 100 ms throttle; the length counter is derived from the
  // model, so seeing it proves the title reached the composer before anything re-renders.
  const titleLeft = page.locator('.title-left')
  await composer.getByRole('button', { name: 'Settling in', exact: true }).click()
  await title.fill(LONG_TITLE)
  await expect(titleLeft).toContainText(String(TITLE_LEFT))
  await body.fill('Works well')
  await page.locator('.comp-attach-btn').first().click()
  await page.locator('.attach-sheet .as-item').first().click()
  await expect(page.locator('.comp-attached')).toHaveCount(1)
  await expect(titleLeft).toContainText(String(TITLE_LEFT))
  await expect(body).toHaveValue('Works well')
  await page.locator('.comp-submit').click()
  await expect(page).toHaveURL(new RegExp(`pages/post/index.*id=${POST_ID}`), { timeout: 15_000 })
}

const fresh = (itemReplies: Reply[]): State => ({ postWrites: 0, itemReplies, linked: false, failNextPostRead: false })
const pendingKeys = (page: Page) => page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('pending-post-items:')))

test('a failed link is retried on the topic page and never writes a second post', async ({ page }) => {
  const state = fresh([{ status: 500, body: { message: 'upstream' } }, { status: 201 }])
  await publishWithItem(page, state)
  await expect(page).toHaveURL(/attach=pending/)
  const banner = page.locator('.attach-pending')
  await expect(banner).toContainText('Topic posted, but "Desk lamp" wasn\'t linked.')
  await expect(page.locator('.attached-item-card')).toHaveCount(0)
  await banner.getByRole('button', { name: 'Link again', exact: true }).click()
  await expect(page.locator('.attached-item-card')).toHaveCount(1)
  await expect(banner).toHaveCount(0)
  expect(state.postWrites).toBe(1)
  expect(await pendingKeys(page)).toEqual([])
})

test('an item sold before the retry is reported and dropped from the pending list', async ({ page }) => {
  const state = fresh([
    { status: 500, body: { message: 'upstream' } },
    { status: 403, body: { code: '42501', message: 'new row violates row-level security policy for table "post_items"' } },
  ])
  await publishWithItem(page, state)
  await page.locator('.attach-pending').getByRole('button', { name: 'Link again', exact: true }).click()
  await expect(page.getByText("This item is no longer for sale, so it can't be linked.", { exact: true })).toBeVisible()
  await expect(page.locator('.attach-pending')).toHaveCount(0)
  await expect(page.locator('.attached-item-card')).toHaveCount(0)
  expect(state.postWrites).toBe(1)
})

test('a refetch failure after the link landed shows no pending notice', async ({ page }) => {
  const state = fresh([{ status: 201 }])
  state.failNextPostRead = true
  await publishWithItem(page, state)
  await expect(page).not.toHaveURL(/attach=pending/)
  await expect(page.locator('.attached-item-card')).toHaveCount(1)
  await expect(page.locator('.attach-pending')).toHaveCount(0)
  expect(await pendingKeys(page)).toEqual([])
})

test('signing out removes the notice and its stored pending items', async ({ page }) => {
  const state = fresh([{ status: 500, body: { message: 'upstream' } }])
  await publishWithItem(page, state)
  await expect(page.locator('.attach-pending')).toBeVisible()
  expect(await pendingKeys(page)).toHaveLength(1)
  await page.evaluate(ref => {
    const channel = new BroadcastChannel(`sb-${ref}-auth-token`)
    channel.postMessage({ event: 'SIGNED_OUT', session: null }); channel.close()
  }, REF)
  await expect(page.locator('.attach-pending')).toHaveCount(0)
  await expect.poll(() => pendingKeys(page)).toEqual([])
})

test('someone else opening the same link sees no notice', async ({ page }) => {
  const state = fresh([])
  await signIn(page, OTHER, { account: UID, ids: [ITEM.id] })
  await serve(page, OTHER, state)
  await page.goto(`/#/pages/post/index?id=${POST_ID}&attach=pending`, { waitUntil: 'networkidle' })
  await expect(page.locator('.post-topic-title')).toHaveText('Selling my desk lamp', { timeout: 15_000 })
  await expect(page.locator('.attach-pending')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Link again', exact: true })).toHaveCount(0)
})
