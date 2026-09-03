import { test, expect, type Page } from '@playwright/test'
import { supabaseRefForBuild } from './supabase-ref'
import { CURRENT_CONSENT_VERSION } from '../src/legal'

/**
 * The consent / suspension gate has to survive same-document navigation.
 *
 * uni.addInterceptor only sees navigateTo / redirectTo / reLaunch / switchTab
 * / navigateBack, and App.onShow only fires when the app comes back to the
 * foreground. On H5 the router is hash-based, so browser Back, a hash edited
 * in the address bar, and a deep link opened into an already-running PWA
 * change the route through none of those. A user whose tos_version is behind
 * CURRENT_CONSENT_VERSION — or who is suspended — could leave the gate page
 * that way and read and write the whole app.
 *
 * The gate page is reached by reLaunch, which replaces the stack rather than
 * pushing onto it, so `location.hash = ...` is the reproduction that does not
 * depend on how many history entries uni happens to have left behind.
 */

const REF = supabaseRefForBuild()
const UID = '11111111-1111-4111-8111-111111111111'
const GEN = 'gate-hash-generation-0001'
const STALE_CONSENT = '2026-04-20'

const HOME = 'pages/index/index'
const RECONSENT = 'pages/reconsent/index'
const AWAY = 'pages/profile/index'

function profileWith(tosVersion: string) {
  return {
    id: UID, nickname: 'Gate User', avatar_url: null, tos_version: tosVersion,
    suspension_level: 0, suspended_until: null, is_illini_verified: true,
    bio: 'hello', location: 'UIUC',
  }
}

async function seedSession(page: Page, tosVersion: string) {
  await page.addInitScript(([ref, uid, gen]) => {
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', 'en')
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
      tag: 'caaci-auth-value-v2', generation: gen,
      value: JSON.stringify({
        access_token: 'stub', token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'stub',
        user: { id: uid, email: 'a@illinois.edu', aud: 'authenticated', role: 'authenticated' },
      }),
    }))
    localStorage.setItem(`sb-${ref}-auth-token-auth-boundary-v2`,
      JSON.stringify({ v: 2, mode: 'allowed', generation: gen }))
  }, [REF, UID, GEN] as const)

  const profile = profileWith(tosVersion)
  await page.route('**/*.supabase.co/**', async (route) => {
    const path = route.request().url().replace(/^https:\/\/[^/]+/, '')
    const fixture: unknown = path.includes('/rpc/get_my_profile') ? profile
      : path.includes('/profiles') ? [profile]
      : []
    // PostgREST signals .single()/.maybeSingle() with this Accept header;
    // answering one with an array makes the array itself the row.
    const wantsObject = (route.request().headers()['accept'] || '').includes('vnd.pgrst.object+json')
    const body = wantsObject && Array.isArray(fixture) ? (fixture[0] ?? null) : fixture
    await route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { 'content-range': '0-1/2' }, body: JSON.stringify(body),
    })
  })
}

/** The route the address bar names — what a deep link or a Back button gives us. */
function currentRoute(page: Page): string {
  const hash = page.url().split('#')[1] || ''
  return hash.replace(/^\//, '').split(/[?#]/, 1)[0]
}

async function waitForRoute(page: Page, expected: string, timeoutMs = 8_000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let seen = currentRoute(page)
  while (Date.now() < deadline) {
    seen = currentRoute(page)
    if (seen === expected) return seen
    await page.waitForTimeout(100)
  }
  return seen
}

/*
 * Playwright retries an assertion until it succeeds, which for "the app did
 * NOT let me through" would pass on the first sample and never look again.
 * Sample across a window and report every route that was seen in it.
 */
async function routesDuring(page: Page, holdMs: number): Promise<string[]> {
  const seen = new Set<string>()
  const deadline = Date.now() + holdMs
  while (Date.now() < deadline) {
    seen.add(currentRoute(page))
    await page.waitForTimeout(100)
  }
  return [...seen]
}

test('a stale consent version cannot be escaped by same-document hash navigation', async ({ page }) => {
  await seedSession(page, STALE_CONSENT)
  await page.goto(`/#/${HOME}`, { waitUntil: 'domcontentloaded' })

  expect(await waitForRoute(page, RECONSENT),
    'a profile behind CURRENT_CONSENT_VERSION should have been sent to re-consent on load').toBe(RECONSENT)

  await page.evaluate((route) => { location.hash = `#/${route}` }, AWAY)

  expect(await waitForRoute(page, RECONSENT),
    `setting location.hash to ${AWAY} escaped the consent gate`).toBe(RECONSENT)
  expect(await routesDuring(page, 2_000),
    'the gate let go of the user after re-asserting itself').toEqual([RECONSENT])
})

test('a current consent version navigates by hash freely (control)', async ({ page }) => {
  await seedSession(page, CURRENT_CONSENT_VERSION)
  await page.goto(`/#/${HOME}`, { waitUntil: 'domcontentloaded' })

  expect(await routesDuring(page, 2_000),
    'a fully consented user was redirected off the home page').toEqual([HOME])

  await page.evaluate((route) => { location.hash = `#/${route}` }, AWAY)

  expect(await waitForRoute(page, AWAY),
    'hash navigation moved nobody — the test above would prove nothing').toBe(AWAY)
  expect(await routesDuring(page, 2_000),
    'a fully consented user was bounced off the page they navigated to').toEqual([AWAY])
})
