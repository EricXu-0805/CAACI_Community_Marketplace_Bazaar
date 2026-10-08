import { expect, test, type Page } from '@playwright/test'
import { CURRENT_CONSENT_VERSION } from '../src/legal'
import { supabaseRefForBuild } from './supabase-ref'

// Run in a clean local fixture; resolve the seed only after explicit env validation.
const SUPABASE_ORIGIN = 'https://00000000000000000000.supabase.co'
const UID = '11111111-1111-4111-8111-111111111111'
const OWNER_KEY = 'account_private_storage_owner_v1'
const DRAFT_KEY = 'publish_draft_v1'
const UNAVAILABLE = 'Unable to check your sign-in status'
const DRAFT = {
  form: {
    title: 'Synthetic desk draft survives auth recovery',
    description: 'An unpublished, device-local fixture.',
    price: '25', category: 'furniture', condition: 'good',
    location: 'Illini Union', listingType: 'sell', negotiable: false,
  },
  images: [], savedAt: 1_800_000_000_000,
}
const USER = {
  id: UID, email: 'timeout-fixture@example.invalid',
  aud: 'authenticated', role: 'authenticated',
}
const PROFILE = {
  id: UID, nickname: 'Synthetic timeout account', avatar_url: null,
  bio: '', location: 'UIUC', is_illini_verified: true,
  tos_version: CURRENT_CONSENT_VERSION, suspension_level: 0, suspended_until: null,
}

test.use({
  browserName: process.env.UI_AUDIT_BROWSER === 'chromium' ? 'chromium' : 'webkit',
  serviceWorkers: 'block',
})
test.beforeEach(() => {
  test.skip(process.env.VITE_SUPABASE_URL !== SUPABASE_ORIGIN,
    'Requires a clean local fixture configured with the synthetic all-zero Supabase ref.')
})

function deferred() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}

async function installFixture(page: Page, baseURL: string | undefined, pendingProfile = false) {
  if (process.env.VITE_SUPABASE_URL !== SUPABASE_ORIGIN) {
    throw new Error('Auth timeout fixture requires an explicit synthetic build URL')
  }
  // This explicit env requirement prevents the helper from falling back to .env.
  const ref = supabaseRefForBuild()
  if (!baseURL || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL).hostname)) {
    throw new Error('Auth timeout browser tests require a loopback app server')
  }
  const localOrigin = new URL(baseURL).origin
  const refresh = deferred(), profile = deferred()
  const observed = { refreshStartedAt: 0, profileStartedAt: 0, refreshes: 0, profiles: 0 }
  const navigation: string[] = []
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) navigation.push(frame.url())
  })

  await page.addInitScript(({ ref, user, draft, ownerKey, draftKey, pendingProfile }) => {
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', 'en')
    localStorage.setItem('theme_pref', 'light')
    localStorage.setItem(ownerKey, user.id)
    // Match uni.setStorageSync's object envelope; raw JSON is read as a string.
    localStorage.setItem(draftKey, JSON.stringify({ type: 'object', data: draft }))
    const generation = 'synthetic-auth-timeout-fixture'
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
      tag: 'caaci-auth-value-v2', generation,
      value: JSON.stringify({
        access_token: 'synthetic-seeded-access-token',
        refresh_token: 'synthetic-seeded-refresh-token', token_type: 'bearer',
        expires_in: pendingProfile ? 3600 : -3600,
        expires_at: Math.floor(Date.now() / 1000) + (pendingProfile ? 3600 : -3600), user,
      }),
    }))
    localStorage.setItem(`sb-${ref}-auth-token-auth-boundary-v2`, JSON.stringify({
      v: 2, mode: 'allowed', generation,
    }))
  }, { ref, user: USER, draft: DRAFT, ownerKey: OWNER_KEY, draftKey: DRAFT_KEY, pendingProfile })

  // No external transport gets through, including hosted Realtime and metrics.
  // Closing local HMR also keeps the fixture snapshot stable while observing it.
  await page.context().routeWebSocket(/.*/, socket => socket.close())
  await page.context().route('**/*', async route => {
    const url = new URL(route.request().url())
    const send = (body: unknown, status = 200) => route.fulfill({
      status, contentType: 'application/json',
      headers: { 'content-range': '*/0' }, body: JSON.stringify(body),
    })
    if (url.origin === localOrigin) {
      if (url.pathname.startsWith('/api/')) return send({})
      return route.continue()
    }
    if (url.origin !== SUPABASE_ORIGIN) return route.abort('blockedbyclient')
    if (url.pathname === '/auth/v1/token') {
      observed.refreshes += 1
      observed.refreshStartedAt ||= Date.now()
      await refresh.promise
      return send({
        access_token: 'synthetic-refreshed-access-token',
        refresh_token: 'synthetic-refreshed-refresh-token', token_type: 'bearer',
        expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: USER,
      })
    }
    if (url.pathname === '/auth/v1/user') return send(USER)
    if (url.pathname === '/rest/v1/rpc/get_my_profile') {
      observed.profiles += 1
      observed.profileStartedAt ||= Date.now()
      if (pendingProfile) {
        // The first failure and held retries cross the session deadline while
        // the profile's separate bounded retry budget remains live.
        if (observed.profiles === 1) return send({ message: 'synthetic transient failure' }, 503)
        await profile.promise
      }
      return send(PROFILE)
    }
    return send([])
  })
  return {
    observed, navigation, releaseRefresh: refresh.release, releaseProfile: profile.release,
    releaseAll() { refresh.release(); profile.release() },
  }
}

async function expectOwnedDraft(page: Page) {
  const stored = await page.evaluate(({ ownerKey, draftKey }) => ({
    owner: localStorage.getItem(ownerKey), draft: localStorage.getItem(draftKey),
  }), { ownerKey: OWNER_KEY, draftKey: DRAFT_KEY })
  expect(stored.owner).toBe(UID)
  expect(stored.draft).not.toBeNull()
  expect(JSON.parse(stored.draft!).data).toEqual(DRAFT)
}

function expectNoLogin(navigation: string[]) {
  expect(navigation.filter(url => /pages\/login\/index/.test(url))).toEqual([])
}

async function expectHome(page: Page) {
  // uni-app canonicalizes its first page to #/ in H5.
  await expect(page).toHaveURL(/#\/(?:pages\/index\/index)?$/, { timeout: 15_000 })
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
}

async function waitBeyondAuthDeadline(page: Page, startedAt: number) {
  // Real time and an actual pending browser request exercise the SDK's lock.
  await page.waitForTimeout(Math.max(0, startedAt + 11_000 - Date.now()))
  expect(Date.now() - startedAt).toBeGreaterThan(10_000)
}

test('a refresh held beyond 10s preserves the owned draft and late success restores publishing', async ({ page, baseURL }) => {
  const fixture = await installFixture(page, baseURL)
  try {
    await page.goto('/#/pages/publish/index', { waitUntil: 'domcontentloaded' })
    await expect.poll(() => fixture.observed.refreshes).toBeGreaterThan(0)
    await expect(page.getByText('Please wait...', { exact: true })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Title (required)', exact: true })).toHaveCount(0)
    await waitBeyondAuthDeadline(page, fixture.observed.refreshStartedAt)
    await expect(page).toHaveURL(/pages\/profile-recovery\/index/)
    await expect(page.getByRole('heading', { name: UNAVAILABLE, exact: true })).toBeVisible()
    await expectOwnedDraft(page)
    expectNoLogin(fixture.navigation)
    expect(fixture.observed.profiles).toBe(0)

    fixture.releaseRefresh()
    await expectHome(page)
    await expectOwnedDraft(page)
    await page.evaluate(() => { (window as any).uni.switchTab({ url: '/pages/publish/index' }) })
    await expect(page.getByText('Restore draft?', { exact: true })).toBeVisible()
    await page.getByText('Keep', { exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Title (required)', exact: true })).toHaveValue(DRAFT.form.title)
    expect(fixture.observed.profiles).toBeGreaterThan(0)
    expectNoLogin(fixture.navigation)
  } finally { fixture.releaseAll() }
})

test('recovery opened before the timeout exits automatically on late session success', async ({ page, baseURL }) => {
  const fixture = await installFixture(page, baseURL)
  try {
    await page.goto('/#/pages/profile-recovery/index', { waitUntil: 'domcontentloaded' })
    await expect.poll(() => fixture.observed.refreshes).toBeGreaterThan(0)
    const retry = page.getByRole('button', { name: 'Retry', exact: true })
    await expect(retry).toHaveAttribute('aria-disabled', 'true')
    await waitBeyondAuthDeadline(page, fixture.observed.refreshStartedAt)
    await expect(page.getByRole('heading', { name: UNAVAILABLE, exact: true })).toBeVisible()
    await expect(retry).toHaveAttribute('aria-disabled', 'false')
    await expect(retry).toHaveAttribute('tabindex', '0')
    await expect(page.getByRole('button', { name: 'Sign Out', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Delete Account', exact: true })).toHaveCount(0)
    await expectOwnedDraft(page)
    fixture.releaseRefresh()
    await expectHome(page)
    await expect(page.getByRole('heading', { name: UNAVAILABLE, exact: true })).toHaveCount(0)
    expectNoLogin(fixture.navigation)
  } finally { fixture.releaseAll() }
})

test('a confirmed session awaiting its profile does not enter recovery at the session deadline', async ({ page, baseURL }) => {
  const fixture = await installFixture(page, baseURL, true)
  try {
    await page.goto('/#/pages/publish/index', { waitUntil: 'domcontentloaded' })
    await expect.poll(() => fixture.observed.profiles).toBeGreaterThan(0)
    await waitBeyondAuthDeadline(page, fixture.observed.profileStartedAt)
    expect(fixture.observed.profiles, 'the profile retry budget must still be exercised').toBeGreaterThanOrEqual(3)
    expect(fixture.observed.refreshes).toBe(0)
    await expect(page).toHaveURL(/pages\/publish\/index/)
    await expect(page.getByText('Please wait...', { exact: true })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Title (required)', exact: true })).toHaveCount(0)
    expect(fixture.navigation.filter(url => /pages\/profile-recovery\/index/.test(url))).toEqual([])
    expectNoLogin(fixture.navigation)
    await expectOwnedDraft(page)
    fixture.releaseProfile()
    await expect(page.getByText('Restore draft?', { exact: true })).toBeVisible({ timeout: 10_000 })
    await page.getByText('Keep', { exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Title (required)', exact: true })).toHaveValue(DRAFT.form.title)
    await expect(page).toHaveURL(/pages\/publish\/index/)
    expect(fixture.navigation.filter(url => /pages\/profile-recovery\/index/.test(url))).toEqual([])
  } finally { fixture.releaseAll() }
})

for (const [surface, key] of [['profile', 'Enter'], ['messages', 'Space']] as const) {
  test(`${surface} exposes keyboard retry for unavailable auth and recovers without login`, async ({ page, baseURL }) => {
    const fixture = await installFixture(page, baseURL)
    try {
      await page.goto(`/#/pages/${surface}/index`, { waitUntil: 'domcontentloaded' })
      await expect.poll(() => fixture.observed.refreshes).toBeGreaterThan(0)
      await waitBeyondAuthDeadline(page, fixture.observed.refreshStartedAt)
      const unavailable = page.getByRole('status').filter({ hasText: UNAVAILABLE })
      await expect(unavailable).toBeVisible()
      const retry = unavailable.getByRole('button', { name: 'Retry', exact: true })
      await expect(retry).toHaveAttribute('tabindex', '0')
      await retry.focus()
      await expect(retry).toBeFocused()
      await retry.press(key)
      // A retry starts a new readiness barrier while the SDK's original
      // refresh remains pending; do not require a second refresh HTTP call.
      await expect(unavailable).toHaveCount(0)
      expectNoLogin(fixture.navigation)
      await expectOwnedDraft(page)
      fixture.releaseRefresh()
      if (surface === 'profile') {
        await expect(page.locator('.user-card')).toContainText(PROFILE.nickname, { timeout: 15_000 })
      } else {
        await expect(page.locator('.msg-left .empty-title')).toHaveText('No messages yet', { timeout: 15_000 })
      }
      await expect(page).toHaveURL(new RegExp(`pages/${surface}/index`))
      await expectOwnedDraft(page)
      expectNoLogin(fixture.navigation)
    } finally { fixture.releaseAll() }
  })
}
