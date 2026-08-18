import { test, expect, type Page } from '@playwright/test'
import { supabaseRefForBuild } from './supabase-ref'

/**
 * A background token refresh must not throw a browsing user off their page.
 *
 * applySession runs on every auth event, and TOKEN_REFRESHED fires on its own
 * roughly hourly. It called ensureProfileReady({ force: true }) without
 * preserveCurrent, so the refresh cleared currentUser and set profileLoadState
 * to 'loading' before the first request left the device — and App.vue's
 * requiredGatePath() treats every non-'ready' state as profile-recovery.
 *
 * Measured on the unfixed build, seeding a token that expires inside the
 * client's refresh window:
 *
 *   profile #1 -> 200
 *   t+0s   #/pages/index/index
 *   refresh #1 ; profile #2 -> 500 ; profile #3 -> 500
 *   t+26s  #/pages/profile-recovery/index
 *
 * The session was valid throughout. A flaky connection during the refresh is
 * exactly when this happens, and it is also exactly when it is least welcome.
 *
 * Token lifetime matters and is the whole reason this reproduces: at 110s the
 * client refreshes inside the observation window, at 200s it does not refresh
 * at all, and at 20s the refresh folds into the initial handshake and there is
 * no second applySession to observe.
 */

const REF = supabaseRefForBuild()
const UID = '11111111-1111-4111-8111-111111111111'
const GEN = 'token-refresh-generation-0001'
// Long enough that the initial handshake does not refresh, short enough that
// the client's auto-refresh tick does, inside the window below.
const TOKEN_TTL_S = 110
const PROFILE = {
  id: UID, nickname: 'Test User', avatar_url: null, tos_version: '2026-08-01',
  suspension_level: 0, suspended_until: null, is_illini_verified: true, bio: 'hi', location: 'UIUC',
}

async function seedExpiringSession(page: Page) {
  await page.addInitScript(([ref, uid, gen, ttl]) => {
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', 'en')
    localStorage.setItem('theme_pref', 'light')
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
      tag: 'caaci-auth-value-v2', generation: gen,
      value: JSON.stringify({
        access_token: 'stub', token_type: 'bearer', expires_in: ttl,
        expires_at: Math.floor(Date.now() / 1000) + (ttl as number),
        refresh_token: 'stub-refresh',
        user: { id: uid, email: 'a@illinois.edu', aud: 'authenticated', role: 'authenticated' },
      }),
    }))
    localStorage.setItem(`sb-${ref}-auth-token-auth-boundary-v2`, JSON.stringify({
      v: 2, mode: 'allowed', generation: gen,
    }))
  }, [REF, UID, GEN, TOKEN_TTL_S] as const)
}

/*
 * failFrom = which profile read starts failing. `Infinity` never fails;
 * failUntil bounds it, so 2..3 is a connection that drops and comes back and
 * Infinity is a profile that is genuinely unreadable.
 */
async function browseAcrossARefresh(
  page: Page,
  { failFrom, failUntil }: { failFrom: number; failUntil: number },
) {
  let profileCalls = 0
  let refreshes = 0
  await seedExpiringSession(page)
  await page.route('**/*.supabase.co/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/auth/v1/token') {
      refreshes += 1
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          access_token: `stub-${refreshes}`, token_type: 'bearer', expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'stub-refresh-next',
          user: { id: UID, email: 'a@illinois.edu', aud: 'authenticated', role: 'authenticated' },
        }),
      })
    }
    if (url.pathname.includes('/rpc/get_my_profile')) {
      profileCalls += 1
      if (profileCalls >= failFrom && profileCalls <= failUntil) {
        return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PROFILE) })
    }
    return route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { 'content-range': '0-0/1' }, body: '[]',
    })
  })

  await page.goto('/#/pages/index/index', { waitUntil: 'networkidle' })
  expect(new URL(page.url()).hash, 'the first load never reached the feed').toContain('pages/index/index')

  // Watch across the refresh. A negative assertion needs a hold window: the
  // eviction landed at t+26s, so checking once would pass before it happened.
  const deadline = Date.now() + 50_000
  let evictedAt = ''
  while (Date.now() < deadline) {
    const hash = new URL(page.url()).hash
    if (hash.includes('profile-recovery')) { evictedAt = hash; break }
    await page.waitForTimeout(1_500)
  }
  return { evictedAt, refreshes, profileCalls }
}

test('a dropped connection during a background token refresh leaves you where you were', async ({ page }) => {
  // The refresh triggers profile read #2; #2 and #3 fail, the third retry works.
  const { evictedAt, refreshes, profileCalls } = await browseAcrossARefresh(page, { failFrom: 2, failUntil: 3 })

  expect(refreshes, 'no token refresh happened — the token lifetime no longer lands in the window').toBeGreaterThan(0)
  expect(profileCalls, 'the refresh never re-read the profile, so nothing was under test').toBeGreaterThan(1)
  expect(evictedAt, 'a valid session was thrown onto profile recovery by a refresh it survived').toBe('')
})

test('a profile that really cannot be read still reaches recovery', async ({ page }) => {
  // The control. Without it, the assertion above is satisfied by removing the
  // recovery route altogether.
  const { evictedAt, refreshes } = await browseAcrossARefresh(page, { failFrom: 2, failUntil: Infinity })

  expect(refreshes).toBeGreaterThan(0)
  expect(evictedAt, 'an unreadable profile no longer reaches the recovery surface').toContain('profile-recovery')
})
