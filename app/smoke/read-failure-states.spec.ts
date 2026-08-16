import { test, expect, type Page } from '@playwright/test'

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

const REF = 'lfhvgprfphyfvhidegum'
const UID = '11111111-1111-4111-8111-111111111111'
const GEN = 'read-failure-generation-0001'
const POST = '55555555-5555-4555-8555-555555555555'

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
