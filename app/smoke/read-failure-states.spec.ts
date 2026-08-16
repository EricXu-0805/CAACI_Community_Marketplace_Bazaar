import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * A failed read must not render as "you have nothing".
 *
 * Every one of these surfaces holds its rows in a ref that starts empty, so a
 * rejected fetch leaves behind exactly the state a brand-new account has. The
 * pages then paint their designed empty art over it — "You haven't posted
 * anything yet", "No comments yet" — and the only correction is a toast that
 * is gone in a second and a half. On a flaky campus connection a seller is
 * told their listings are gone, and a plaza reader sees a header promising
 * twelve comments above a body saying nobody has commented.
 *
 * The plaza comment sheet already got this right (commentsError + a retry, at
 * pages/plaza/index.vue), which is the shape these follow.
 *
 * Session seeding is the same recipe as a11y-authenticated.spec.ts — the
 * boundary key is `<storageKey>-auth-boundary-v2` and its generation must
 * match the envelope's, or the fail-closed adapter discards the session; and
 * tos_version must equal CURRENT_CONSENT_VERSION or the consent gate
 * redirects. Kept local rather than shared so that spec stays untouched.
 */

/**
 * The app derives its auth storage key from the Supabase URL it was compiled
 * against — authStorageKeyForUrl() in composables/useSupabase.ts takes the
 * first hostname label. A hardcoded project ref therefore only seeds a usable
 * session when the dev server happens to point at that same project.
 *
 * It did not under the authenticated-smoke job, which pins VITE_SUPABASE_URL
 * to the staging project: the seeded key was one nobody reads, so no session
 * existed, every route below fell through to the login page, and the
 * assertions failed against sign-in copy. That job is skipped on pull
 * requests, so it only turned red after the merge.
 *
 * Resolve it the way Vite does — process env first, then app/.env — and throw
 * rather than fall back, because a wrong ref here fails as a page full of
 * plausible text rather than as a missing session.
 */
function supabaseUrlForBuild(): string {
  const fromEnv = process.env.VITE_SUPABASE_URL
  if (fromEnv) return fromEnv
  const dotenv = readFileSync(resolve(process.cwd(), '.env'), 'utf8')
  const match = /^\s*VITE_SUPABASE_URL\s*=\s*(.+?)\s*$/m.exec(dotenv)
  if (!match) throw new Error('no VITE_SUPABASE_URL in the environment or app/.env — cannot seed a session')
  return match[1].replace(/^["']|["']$/g, '')
}

const REF = new URL(supabaseUrlForBuild()).hostname.split('.')[0]
const UID = '11111111-1111-4111-8111-111111111111'
const GEN = 'read-failure-generation-0001'
const POST = '55555555-5555-4555-8555-555555555555'
const OWNED_ITEM_ID = '22222222-2222-4222-8222-222222222222'
const SAVED_ITEM_ID = '33333333-3333-4333-8333-333333333333'
const COMMENT_ID = '44444444-4444-4444-8444-444444444444'

const PROFILE = {
  id: UID, nickname: 'Test User', avatar_url: null, tos_version: '2026-08-01',
  suspension_level: 0, suspended_until: null, is_illini_verified: true, bio: 'hi', location: 'UIUC',
}
// comment_count is deliberately non-zero: the contradiction only shows when
// the header has a number to print.
const POST_ROW = {
  id: POST, user_id: UID, content: 'Anyone selling a rice cooker?', images: [],
  comment_count: 12, like_count: 3, created_at: '2026-08-01T00:00:00Z', profile: PROFILE,
}

const OWNED_ITEM_ROW = {
  id: OWNED_ITEM_ID, user_id: UID, title: 'Owned partition remains visible', description: 'mine',
  price: 25, category: 'other', condition: 'good', status: 'active', listing_type: 'sell',
  location: 'UIUC', images: [], view_count: 1,
  created_at: '2026-08-02T00:00:00Z', updated_at: '2026-08-02T00:00:00Z', profile: PROFILE,
}

const SAVED_ITEM_ROW = {
  ...OWNED_ITEM_ROW,
  id: SAVED_ITEM_ID,
  user_id: '99999999-9999-4999-8999-999999999999',
  title: 'Saved partition remains visible',
  profile: { ...PROFILE, id: '99999999-9999-4999-8999-999999999999', nickname: 'Seller' },
}

const COMMENT_ROW = {
  id: COMMENT_ID, post_id: POST, user_id: UID, content: 'Recovered comment stays scoped',
  parent_comment_id: null, like_count: 0, created_at: '2026-08-03T00:00:00Z', profile: PROFILE,
}

const READS_UNDER_TEST = [/\/rest\/v1\/items/, /\/rest\/v1\/favorites/, /\/rest\/v1\/post_comments/]

function fixtureFor(path: string): unknown {
  if (path.includes('/rpc/get_my_profile')) return PROFILE
  if (path.includes('/rpc/')) return []
  if (path.includes('/posts')) return [POST_ROW]
  if (path.includes('/profiles')) return [PROFILE]
  return []
}

async function seedSession(page: Page) {
  await page.addInitScript(([ref, uid, gen]) => {
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', 'en')
    localStorage.setItem('theme_pref', 'light')
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
      tag: 'caaci-auth-value-v2', generation: gen,
      value: JSON.stringify({
        access_token: 'stub', token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'stub',
        user: { id: uid, email: 'a@illinois.edu', aud: 'authenticated', role: 'authenticated' },
      }),
    }))
    localStorage.setItem(`sb-${ref}-auth-token-auth-boundary-v2`, JSON.stringify({
      v: 2, mode: 'allowed', generation: gen,
    }))
  }, [REF, UID, GEN] as const)
}

async function serve(page: Page, { failReads }: { failReads: boolean }) {
  await page.route('**/*.supabase.co/**', async route => {
    const path = route.request().url().replace(/^https:\/\/[^/]+/, '')
    if (failReads && READS_UNDER_TEST.some(re => re.test(path))) {
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' })
    }
    await route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { 'content-range': '0-1/2' }, body: JSON.stringify(fixtureFor(path)),
    })
  })
}

type ControlledEndpoint = 'items' | 'favorites' | 'posts' | 'post_comments'

type ControlledReadState = {
  failing: ControlledEndpoint | null
  delayed: ControlledEndpoint | null
  delayMs: number
  requests: Record<ControlledEndpoint, number>
}

function endpointFor(pathname: string): ControlledEndpoint | null {
  if (pathname.endsWith('/rest/v1/items')) return 'items'
  if (pathname.endsWith('/rest/v1/favorites')) return 'favorites'
  if (pathname.endsWith('/rest/v1/posts')) return 'posts'
  if (pathname.endsWith('/rest/v1/post_comments')) return 'post_comments'
  return null
}

function partitionFixture(path: string): unknown {
  if (path.includes('/rest/v1/items')) return [OWNED_ITEM_ROW]
  if (path.includes('/rest/v1/favorites')) {
    // profile asks for both the id set and the joined item rows. Keep those
    // wire shapes distinct or a false fixture can make one branch look green.
    const decoded = decodeURIComponent(path)
    if (decoded.includes('item:items')) return [{ item_id: SAVED_ITEM_ID, item: SAVED_ITEM_ROW }]
    return [{ item_id: SAVED_ITEM_ID }]
  }
  if (path.includes('/rest/v1/post_comments')) return [COMMENT_ROW]
  return fixtureFor(path)
}

async function serveControlled(page: Page, state: ControlledReadState) {
  await page.route('**/*.supabase.co/**', async route => {
    const url = new URL(route.request().url())
    const path = `${url.pathname}${url.search}`
    const endpoint = endpointFor(url.pathname)
    if (endpoint) {
      state.requests[endpoint] += 1
      if (state.failing === endpoint) {
        return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' })
      }
      if (state.delayed === endpoint && state.delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, state.delayMs))
      }
    }
    await route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { 'content-range': '0-0/1' }, body: JSON.stringify(partitionFixture(path)),
    })
  })
}

function controlledState(failing: ControlledEndpoint): ControlledReadState {
  return {
    failing,
    delayed: null,
    delayMs: 0,
    requests: { items: 0, favorites: 0, posts: 0, post_comments: 0 },
  }
}

async function visibleText(page: Page, route: string): Promise<string[]> {
  await page.goto(`/#/${route}`, { waitUntil: 'networkidle' })
  const deadline = Date.now() + 15_000
  let previous: string[] = []
  while (Date.now() < deadline) {
    await page.waitForTimeout(200)
    const current = await page.evaluate(() => {
      const visible = (el: Element) => {
        const cs = getComputedStyle(el)
        if (cs.visibility === 'hidden' || cs.display === 'none') return false
        const r = el.getBoundingClientRect()
        return r.width >= 2 && r.height >= 2
      }
      return [...document.querySelectorAll('*')]
        .filter(el => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent!.trim()) && visible(el))
        .map(el => el.textContent!.trim().replace(/\s+/g, ' ').slice(0, 60))
    })
    if (current.length && current.join('|') === previous.join('|')) return current
    previous = current
  }
  return previous
}

const CLAIMS_EMPTY = /haven't posted anything|no listings|haven't saved|No saved|No comments yet|nothing yet/i

const SURFACES = [
  { label: 'my items', route: 'pages/my-items/index' },
  { label: 'profile', route: 'pages/profile/index' },
  { label: 'post detail', route: `pages/post/index?id=${POST}` },
]

for (const { label, route } of SURFACES) {
  test(`${label}: a failed read reports the failure instead of an empty account`, async ({ page }) => {
    await seedSession(page)
    await serve(page, { failReads: true })

    const texts = await visibleText(page, route)
    const joined = texts.join(' | ')

    expect(joined, `${label} never told the reader the load failed`).toMatch(/Failed to load/i)
    expect(joined, `${label} still claims the account is empty after a failed read`).not.toMatch(CLAIMS_EMPTY)
  })
}

test('post detail never shows a comment count above "no comments"', async ({ page }) => {
  await seedSession(page)
  await serve(page, { failReads: true })

  const joined = (await visibleText(page, `pages/post/index?id=${POST}`)).join(' | ')
  // The count comes from the post row and stays truthful; it is the body that
  // must not contradict it.
  expect(joined).toMatch(/Comments \(12\)/)
  expect(joined, 'the header promised 12 comments and the body said there are none').not.toMatch(/No comments yet/i)
})

/**
 * The control. Without it every assertion above is satisfied by deleting the
 * empty states outright, which would be a worse app and a green suite.
 */
test('a genuinely empty account still gets its designed empty state', async ({ page }) => {
  await seedSession(page)
  await serve(page, { failReads: false })

  const joined = (await visibleText(page, 'pages/my-items/index')).join(' | ')
  expect(joined, 'the empty state disappeared instead of being made conditional').toMatch(CLAIMS_EMPTY)
  expect(joined, 'a healthy empty account must not be reported as a failure').not.toMatch(/Failed to load/i)
})

test('profile preserves saved rows when listings fail, and retry never flashes a healthy empty listing', async ({ page }) => {
  const state = controlledState('items')
  await seedSession(page)
  await serveControlled(page, state)

  await visibleText(page, 'pages/profile/index')
  await expect(page.locator('#profile-listings-panel').getByText('Failed to load', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: SAVED_ITEM_ROW.title, exact: true }),
    'a failed listings endpoint erased the independently successful favorites partition',
  ).toBeVisible()

  const requestsBeforeRetry = state.requests.items
  state.failing = null
  state.delayed = 'items'
  state.delayMs = 1_500
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect.poll(() => state.requests.items).toBeGreaterThan(requestsBeforeRetry)

  await expect(
    page.getByText("You haven't posted anything yet", { exact: true }),
    'retry temporarily advertised a healthy empty account while the listings request was still pending',
  ).toHaveCount(0)
  await expect(page.getByRole('button', { name: SAVED_ITEM_ROW.title, exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: OWNED_ITEM_ROW.title, exact: true })).toBeVisible()
})

test('my items preserves listed rows when favorites fail, and retry never flashes a healthy empty saved tab', async ({ page }) => {
  const state = controlledState('favorites')
  await seedSession(page)
  await serveControlled(page, state)

  await visibleText(page, 'pages/my-items/index')
  await expect(
    page.getByRole('button', { name: OWNED_ITEM_ROW.title, exact: true }),
    'a failed favorites endpoint erased the independently successful listings partition',
  ).toBeVisible()

  await page.getByRole('tab', { name: /My Favorites/i }).click()
  await expect(page.locator('#my-items-panel').getByText('Failed to load', { exact: true })).toBeVisible()
  const requestsBeforeRetry = state.requests.favorites
  state.failing = null
  state.delayed = 'favorites'
  state.delayMs = 1_500
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect.poll(() => state.requests.favorites).toBeGreaterThan(requestsBeforeRetry)

  await expect(
    page.getByText('No saved items yet', { exact: true }),
    'retry temporarily advertised a healthy empty saved list while the request was still pending',
  ).toHaveCount(0)
  await expect(page.getByRole('button', { name: SAVED_ITEM_ROW.title, exact: true })).toBeVisible()
})

test('comment retry is scoped to comments and keeps the loaded post alive', async ({ page }) => {
  const state = controlledState('post_comments')
  await seedSession(page)
  await serveControlled(page, state)

  await visibleText(page, `pages/post/index?id=${POST}`)
  await expect(page.getByText(POST_ROW.content, { exact: true })).toBeVisible()
  await expect(page.getByText('Failed to load', { exact: true })).toBeVisible()
  const postRequestsBeforeRetry = state.requests.posts
  const commentRequestsBeforeRetry = state.requests.post_comments

  state.failing = null
  state.delayed = 'post_comments'
  state.delayMs = 1_500
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect.poll(() => state.requests.post_comments).toBeGreaterThan(commentRequestsBeforeRetry)

  expect(state.requests.posts, 'comment retry reloaded the already-valid main post').toBe(postRequestsBeforeRetry)
  await expect(page.getByText(POST_ROW.content, { exact: true })).toBeVisible()
  await expect(
    page.getByText('No comments yet', { exact: true }),
    'comment retry flashed a healthy empty thread while the retry was pending',
  ).toHaveCount(0)
  await expect(page.getByText(COMMENT_ROW.content, { exact: true })).toBeVisible()
  expect(state.requests.posts, 'comment recovery invalidated and fetched the main post').toBe(postRequestsBeforeRetry)
})
