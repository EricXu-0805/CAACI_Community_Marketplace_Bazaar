import { test, expect, type Page, type ConsoleMessage } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Page-load smoke: every route renders with no unexpected console errors,
 * in both light and dark, logged out. This is the regression net for big
 * sweeps (incl. wiring in the new UI library) — if a page throws on mount
 * or a component import breaks, this catches it.
 *
 * Auth-gated reads legitimately 401 when logged out; those are filtered.
 */
const PAGES = [
  'pages/index/index', 'pages/plaza/index', 'pages/post/index',
  'pages/publish/index', 'pages/publish/edit', 'pages/messages/index',
  'pages/profile/index', 'pages/detail/index', 'pages/chat/index',
  'pages/history/index', 'pages/legal/index', 'pages/welcome/index',
  'pages/settings/index', 'pages/seller/index', 'pages/profile/edit',
  'pages/notifications/index', 'pages/blocked/index', 'pages/reset-password/index',
  'pages/illini-verify/index', 'pages/login/index', 'pages/following/index',
  'pages/saved-searches/index', 'pages/search/index', 'pages/onboarding/index',
  'pages/reconsent/index', 'pages/profile-recovery/index',
  'pages/suspended/index', 'pages/admin/index', 'pages/my-items/index',
]

// Console noise that is expected and not a regression.
const IGNORE = [
  // A logged-out page may legitimately probe an authenticated endpoint. Keep
  // this narrow: 429s and 5xx must remain visible here, and 404s move to the
  // response listener below rather than being dropped.
  /Failed to load resource: the server responded with a status of (401|403)/,
  /favicon/,
  /*
   * The console line for a 404 carries no URL, so on the runner it reads
   * "Failed to load resource: ... 404 (Not Found)" twice and names nothing.
   * The response listener below reports the same 404s with their URL, so
   * ignoring the anonymous console copy loses no coverage and makes the
   * failure say which resource is missing.
   */
  /Failed to load resource: the server responded with a status of 404/,
  // Playwright's bundled Chromium predates `interactive-widget` (Chrome 108+).
  // It logs this when parsing our viewport meta and then ignores the key — the
  // exact graceful-degradation fallback we rely on for pre-108 / pre-Safari-17.4
  // clients. Benign, not a regression. (app/index.html, useKeyboardHeight.ts)
  /Viewport argument key "interactive-widget" not recognized/,
]

function attachConsoleCollector(page: Page): string[] {
  const errs: string[] = []
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() !== 'error') return
    const t = m.text()
    if (!IGNORE.some(re => re.test(t))) errs.push(t.slice(0, 200))
  })
  page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 200)))
  page.on('response', (response) => {
    if (response.status() === 404 || response.status() >= 500) {
      errs.push(`http ${response.status()}: ${response.url().slice(0, 160)}`)
    }
  })
  return errs
}

function reviewedSessionUserId(
  storage: Pick<Storage, 'length' | 'key' | 'getItem'> = localStorage,
): string {
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index) || ''
    if (!/^sb-[a-z0-9]+-auth-token$/.test(key)) continue
    try {
      const outer = JSON.parse(storage.getItem(key) || 'null')
      let session = outer
      if (outer && typeof outer === 'object' && 'tag' in outer) {
        if (
          outer.tag !== 'caaci-auth-value-v2'
          || typeof outer.generation !== 'string'
          || outer.generation.length < 8
          || outer.generation.length > 160
          || typeof outer.value !== 'string'
        ) continue
        session = JSON.parse(outer.value)
      }
      const userId = session?.user?.id
        || session?.currentSession?.user?.id
        || session?.session?.user?.id
      if (typeof userId === 'string') return userId.toLowerCase()
    } catch { /* malformed or unknown-tag storage must fail the exact-id gate */ }
  }
  return ''
}

test('authenticated smoke identity evidence supports the v2 envelope without exposing it', () => {
  const userId = '11111111-1111-4111-8111-111111111111'
  const values = new Map<string, string>([[
    'sb-abcdefghijklmnopqrst-auth-token',
    JSON.stringify({
      tag: 'caaci-auth-value-v2',
      generation: 'generation-verified-1',
      value: JSON.stringify({ user: { id: userId }, access_token: 'never-return-this' }),
    }),
  ]])
  const storage = {
    get length() { return values.size },
    key: (index: number) => [...values.keys()][index] || null,
    getItem: (key: string) => values.get(key) || null,
  }
  expect(reviewedSessionUserId(storage)).toBe(userId)

  values.set('sb-abcdefghijklmnopqrst-auth-token', JSON.stringify({
    tag: 'unknown-auth-envelope',
    generation: 'generation-verified-1',
    value: JSON.stringify({ user: { id: userId } }),
    user: { id: userId },
  }))
  expect(reviewedSessionUserId(storage)).toBe('')

  values.set('sb-abcdefghijklmnopqrst-auth-token', JSON.stringify({ user: { id: userId } }))
  expect(reviewedSessionUserId(storage)).toBe(userId)
})

test('smoke route list stays in sync with pages.json', () => {
  // pages.json carries uni-app conditional-compilation directives (`// #ifdef`),
  // so it is JSON with comments, not strict JSON. Strip the directive lines —
  // the platform-gated routes they wrap still have to be swept on H5.
  const configured = JSON.parse(
    readFileSync(resolve(process.cwd(), 'src/pages.json'), 'utf8')
      .replace(/^\s*\/\/.*$/gm, ''),
  ).pages.map((page: { path: string }) => page.path)
  expect([...PAGES].sort()).toEqual([...configured].sort())
})

test('settings actions expose real H5 button semantics and keyboard activation', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', 'en')
  })
  await page.goto('/#/pages/settings/index', { waitUntil: 'networkidle' })

  const expectedPublicActions = [
    'Language: English',
    'Appearance: Auto',
    'Terms, Privacy & Guidelines',
  ]
  for (const name of expectedPublicActions) {
    const action = page.getByRole('button', { name, exact: true })
    await expect(action).toBeVisible()
    await expect(action).toHaveAttribute('tabindex', '0')
  }
  const clearCache = page.getByRole('button', { name: /^Clear Cache:/ })
  await expect(clearCache).toBeVisible()
  await expect(clearCache).toHaveAttribute('tabindex', '0')

  // The version row is deliberately informational: it must not join the tab
  // sequence or masquerade as an action.
  const versionRow = page.locator('.menu-item').filter({ hasText: 'Version' })
  await expect(versionRow).not.toHaveAttribute('role', 'button')
  await expect(versionRow).not.toHaveAttribute('tabindex', '0')

  // A custom uni-view does not inherit native button keyboard behaviour.
  // The explicit Enter handler must open the language action sheet.
  await page.getByRole('button', { name: 'Language: English', exact: true }).press('Enter')
  await expect(page.locator('.uni-actionsheet')).toBeVisible()
})

test('profile listing action stays mouse and keyboard discoverable', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/profile/index.vue'), 'utf8')
  const start = source.indexOf('class="horz-more"')
  expect(start).toBeGreaterThan(-1)
  const moreAction = source.slice(start, source.indexOf('</view>', start))
  expect(moreAction).toContain('role="button"')
  expect(moreAction).toContain('tabindex="0"')
  expect(moreAction).toContain(':aria-label="t(\'a11y.more\')')
  expect(moreAction).toContain('@click.stop="onCardLongPress(item)"')
  expect(moreAction).toContain('@keydown.enter.stop.prevent="onCardLongPress(item)"')
  expect(moreAction).toContain('@keydown.space.stop.prevent="onCardLongPress(item)"')
})

for (const theme of ['light', 'dark'] as const) {
  test.describe(`page sweep [${theme}]`, () => {
    test.use({ colorScheme: theme })
    for (const route of PAGES) {
      test(`${route} loads clean`, async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem('welcomed', '1'))
        const errs = attachConsoleCollector(page)
        await page.goto(`/#/${route}`, { waitUntil: 'networkidle' })
        await page.waitForTimeout(1200)
        expect(errs, `console errors on ${route}`).toEqual([])
      })
    }
  })
}

// An expired/invalid email link (signup-confirm or recovery) redirects to
// `${origin}/#error=...&error_code=otp_expired` with no code. App.vue must
// rescue the root case to login instead of leaving an unroutable blank screen.
test('expired auth email link → login, not a blank screen', async ({ page }) => {
  const errs = attachConsoleCollector(page)
  await page.addInitScript(() => localStorage.setItem('welcomed', '1'))
  await page.goto('/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  expect(page.url(), 'error hash should be cleared').not.toContain('error_code')
  await expect(page.locator('uni-input input').first(), 'should land on a real page (login inputs)').toBeVisible()
  expect(errs, 'console errors during error-link recovery').toEqual([])
})

/**
 * "Forgot password?" and "Sign In" said the same four words.
 *
 * Both paths toasted `login.needEmail` — "Enter your email" — when the field
 * was empty. Measured on production 2026-08-31: tapping "Forgot password?"
 * with nothing typed produced exactly the sign-in form's validation error and
 * no navigation, so the one screen a locked-out reader reaches first tells
 * them the field is blank and nothing about what filling it in would do.
 *
 * The handler is not broken — it sends the recovery code to whatever is in
 * that field and then routes to the reset page. Only the copy was wrong, and
 * password reset is the likeliest support request of the first week.
 *
 * This asserts the two paths say different things, not what either says: the
 * wording is free to change, the collision is not.
 */
test('forgot-password does not borrow the sign-in form\'s error', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('welcomed', '1'))

  const messageAfter = async (click: () => Promise<void>) => {
    await page.goto('/#/pages/login/index', { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    const before = new Set((await page.locator('body').innerText()).split('\n').map(l => l.trim()))
    await click()
    // The toast is transient, so poll. Deduplicate: uni renders the message
    // into both the visible toast and a live region, and one path was landing
    // twice while the other landed once — enough for a raw string compare to
    // call two identical messages different.
    for (let i = 0; i < 24; i++) {
      await page.waitForTimeout(250)
      const added = [...new Set((await page.locator('body').innerText())
        .split('\n').map(l => l.trim()).filter(l => l && !before.has(l)))]
      if (added.length) return added.sort().join(' ')
    }
    return ''
  }

  const signIn = await messageAfter(async () => {
    await page.getByRole('button', { name: /^Sign In$/ }).last().click()
  })
  const forgot = await messageAfter(async () => {
    await page.getByRole('button', { name: /Forgot password/i }).first().click()
  })

  // Control: both must actually say something, or "they differ" is vacuous.
  expect(signIn, 'sign-in with an empty email said nothing').not.toBe('')
  expect(forgot, 'forgot-password with an empty email said nothing').not.toBe('')
  expect(forgot, 'forgot-password reused the sign-in validation message').not.toBe(signIn)
})

/**
 * A route that never reaches a terminal state is worse than one that fails.
 *
 * pages/seller/index held `loading = ref(true)` and its onLoad opened with a
 * bare `if (!options?.id) return`. Nothing below it runs, and nothing else
 * clears the flag, so a seller link that lost its query string painted sixteen
 * skeletons and kept them: no error, no retry, no empty state, nothing
 * arriving. Measured against production on 2026-08-31 it was still on them
 * after twelve seconds. A bad id was already handled — it shows the page's own
 * "Failed to load" with a retry — so only the absent id fell through.
 *
 * Every other route answers a missing id: detail says the listing was removed,
 * post says the post was not found. This asserts seller does too.
 */
test('a seller link with no id reaches a terminal state', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('welcomed', '1'))

  // Control first: the locator must not match on a healthy page, or the
  // assertion below passes by matching some chrome every route paints.
  await page.goto('/#/pages/settings/index', { waitUntil: 'networkidle' })
  await expect(page.locator('.load-error')).toHaveCount(0)

  await page.goto('/#/pages/seller/index', { waitUntil: 'networkidle' })
  await expect(
    page.locator('.load-error'),
    'a seller link with no id must resolve to the page\'s error state, not stay on skeletons',
  ).toBeVisible({ timeout: 15_000 })

  // Retry re-runs the load. It cannot succeed without an id, but it must not
  // put the page back on the skeletons it just escaped.
  await page.locator('.le-retry').click()
  await page.waitForTimeout(3000)
  await expect(page.locator('.load-error'), 'retry left the page hanging again').toBeVisible()
})

/** The first-visit hint must reserve space even with only one short card. */
for (const dataset of ['live', 'single listing'] as const) {
test(`the install hint covers none of the home page controls (${dataset})`, async ({ page }) => {
  if (dataset === 'single listing') {
    await page.route('**/rest/v1/items?**', route => route.fulfill({
      status: 200, contentType: 'application/json', headers: { 'content-range': '0-0/1' },
      body: JSON.stringify([{
        id: '77777777-7777-4777-8777-777777777777',
        user_id: '11111111-1111-4111-8111-111111111111',
        title: 'Pet carrier XL', description: 'Campus pickup', source_lang: 'en',
        price: 120, category: 'other', condition: 'new', status: 'active', listing_type: 'sell',
        location: 'Illini Union', images: [], view_count: 4, favorite_count: 0,
        created_at: '2026-08-31T05:27:44Z', profile: { nickname: 'Fixture seller' },
      }]),
    }))
  }
  await page.addInitScript(() => {
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', 'en')
  })
  await page.goto('/#/pages/index/index', { waitUntil: 'networkidle' })

  // It reveals on a timer, so wait for the thing being asserted rather than
  // for a duration. A run where it never appears has tested nothing.
  const hint = page.locator('.a2hs')
  const emptyBlock = page.locator('.empty')
  await expect
    .poll(async () => (await hint.isVisible()) || (await emptyBlock.isVisible()), {
      message: 'the home page must settle into a populated feed with the hint, or into its empty state',
      timeout: 20_000,
    })
    .toBe(true)

  // Empty/error feeds yield to the primary action; hold the absence across
  // the reveal timer so the test cannot pass before the hint is scheduled.
  if (dataset === 'single listing') await expect(page.locator('.waterfall .card')).toHaveCount(1)
  if (await emptyBlock.isVisible()) {
    /* Asserting an absence once passes for the wrong reason: the component
       reveals on a 1.2s timer, so a single check right after the empty state
       paints is green even when the hint is about to appear — it stayed green
       against a build with the fix removed. Hold the assertion across a window
       several times that timer instead. */
    const deadline = Date.now() + 4_000
    while (Date.now() < deadline) {
      expect(await hint.count(), 'the empty feed owns the screen — the promo must not render').toBe(0)
      await page.waitForTimeout(150)
    }
    return
  }

  await hint.waitFor({ state: 'visible', timeout: 15_000 })

  const coveredControls = () => page.evaluate(() => {
    const banner = document.querySelector('.a2hs')!
    const bannerRect = banner.getBoundingClientRect()
    const hits: string[] = []
    for (const el of document.querySelectorAll('[role="button"], button, input, .fm-seg, .search-field, .filter-btn')) {
      if (banner.contains(el)) continue
      const r = el.getBoundingClientRect()
      if (r.width < 4 || r.height < 4) continue
      // Check the painted intersection rather than only the control's centre.
      // A banner covering the edge of a search field or button is still a
      // touch/reading defect even when its centre remains clickable.
      const left = Math.max(r.left, bannerRect.left, 0)
      const right = Math.min(r.right, bannerRect.right, innerWidth)
      const topEdge = Math.max(r.top, bannerRect.top, 0)
      const bottom = Math.min(r.bottom, bannerRect.bottom, innerHeight)
      if (right - left <= 1 || bottom - topEdge <= 1) continue
      const x = left + (right - left) / 2
      const y = topEdge + (bottom - topEdge) / 2
      const top = document.elementFromPoint(x, y)
      if (top && banner.contains(top)) {
        hits.push(`${(el.className || '').toString().trim()} "${(el.textContent || '').trim().slice(0, 28)}"`)
      }
    }
    return hits
  })

  const expectNoCoveredControls = async (orientation: string) => {
    const covered = await coveredControls()
    expect(
      covered,
      `the install hint is covering controls in ${orientation}:\n${covered.join('\n')}`,
    ).toEqual([])
  }

  const expectPortraitHintClear = async (orientation: string) => {
    await expect(hint, `${orientation} must show the first-visit hint`).toBeVisible()

    // The first card must start below the hint, including in a feed too
    // short to scroll. A floating banner at an arbitrary bottom offset fails.
    await expect.poll(() => page.evaluate(() => {
      const hint = document.querySelector('.a2hs')!.getBoundingClientRect()
      const card = document.querySelector('.waterfall .card')!.getBoundingClientRect()
      return card.top - hint.bottom
    }), { message: `${orientation} must reserve space for the hint` }).toBeGreaterThanOrEqual(0)

    await expectNoCoveredControls(orientation)
  }

  await expectPortraitHintClear('portrait')

  // iOS rotates the already-visible hint without remounting the page. There is
  // little reading room in the short landscape viewport, so the hint must yield
  // to the page controls and reappear when portrait space returns.
  await page.setViewportSize({ width: 664, height: 390 })
  await expect(hint, 'the short landscape viewport has no safe fixed lane').toBeHidden()
  await page.setViewportSize({ width: 390, height: 664 })
  await expectPortraitHintClear('portrait after rotation')

  // Large iPhones can start above the 768px desktop breakpoint in landscape.
  // Mount there, let the reveal delay expire, then rotate without remounting:
  // the portrait hint must become eligible instead of staying false forever.
  await page.setViewportSize({ width: 896, height: 414 })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await expect(hint, 'large-iPhone landscape entry must remain unobstructed').toBeHidden()
  await page.setViewportSize({ width: 414, height: 896 })
  await expectPortraitHintClear('large iPhone portrait after landscape entry')
  await hint.locator('.a2hs-close').click()
  await expect(hint).toHaveCount(0)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await expect(hint, 'dismissal must survive reload').toHaveCount(0)
})
}

/**
 * Core logged-in flow — opt-in. Set SMOKE_EMAIL + SMOKE_PASSWORD and the
 * explicit SMOKE_ACCOUNT_IS_SYNTHETIC=true and
 * SMOKE_DATASET_IS_SYNTHETIC=true attestations to run it (all kept out of the
 * repo). This keeps personal credentials and production datasets out of the
 * authenticated sweep. It deliberately performs no writes, and CI records no
 * screenshots, traces, videos, or browser artifacts.
 */
const EMAIL = process.env.SMOKE_EMAIL
const PASSWORD = process.env.SMOKE_PASSWORD
const ACCOUNT_IS_SYNTHETIC = process.env.SMOKE_ACCOUNT_IS_SYNTHETIC === 'true'
const DATASET_IS_SYNTHETIC = process.env.SMOKE_DATASET_IS_SYNTHETIC === 'true'
const EXPECTED_PROJECT_REF = process.env.SMOKE_EXPECTED_SUPABASE_PROJECT_REF || ''
const EXPECTED_USER_ID = (process.env.SMOKE_EXPECTED_USER_ID || '').toLowerCase()
const CONFIGURED_SUPABASE_URL = process.env.VITE_SUPABASE_URL || ''
const EXACT_STAGING_TARGET = /^[a-z0-9]{20}$/.test(EXPECTED_PROJECT_REF)
  && CONFIGURED_SUPABASE_URL === `https://${EXPECTED_PROJECT_REF}.supabase.co`
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(EXPECTED_USER_ID)

test.describe('core flow (logged in)', () => {
  test.skip(
    !EMAIL || !PASSWORD || !ACCOUNT_IS_SYNTHETIC || !DATASET_IS_SYNTHETIC || !EXACT_STAGING_TARGET,
    'set the protected synthetic credentials, exact staging project ref, and exact expected user id',
  )

  test('login → authenticated page sweep (no console errors)', async ({ page }) => {
    const errs = attachConsoleCollector(page)
    // Vite serves the frontend only. Keep the real synthetic Supabase login
    // and reads, but explicitly stub the paid translation boundary as the
    // server's no-provider fallback. Do not suppress missing API responses in
    // the collector or send fixture content to a paid production provider.
    await page.route('**/api/translate', async route => {
      const request = route.request()
      expect(request.method()).toBe('POST')
      const jwt = (request.headers().authorization || '').replace(/^Bearer /, '')
      const claims = JSON.parse(Buffer.from(jwt.split('.')[1] || '', 'base64url').toString())
      expect(claims.sub, 'translation must use the reviewed synthetic identity').toBe(EXPECTED_USER_ID)
      const body = request.postDataJSON()
      expect(typeof body.text).toBe('string')
      expect(Buffer.byteLength(body.text)).toBeLessThanOrEqual(4096)
      expect(['en', 'zh']).toContain(body.target)
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ translated: '', skipped: true, reason: 'no_key' }),
      })
    })
    await page.addInitScript(() => localStorage.setItem('welcomed', '1'))
    await page.goto('/#/pages/login/index', { waitUntil: 'networkidle' })
    await page.waitForTimeout(1000)
    const inputs = page.locator('uni-input input')
    await inputs.nth(0).fill(EMAIL!)
    await inputs.nth(1).fill(PASSWORD!)
    await page.locator('uni-button.submit-btn').click()
    await expect(page, 'valid smoke credentials must leave the login page')
      .not.toHaveURL(/\/pages\/login\/index/, { timeout: 15_000 })

    /*
     * A synthetic account starts at tos_version '0', so the consent gate meets
     * it on the way in — exactly as it meets a real new student. Accept, the
     * way a student does, instead of pinning the fixture to whatever version
     * is current: the next consent bump would silently stale it again.
     *
     * This sweep used to skip the screen entirely. The gate ran on app show
     * and on programmatic navigation, but not on a same-document hash change,
     * and `page.goto('/#/…')` inside an already-running SPA is exactly that —
     * so an unconsented account walked straight to the profile. Closing that
     * hole is what turned this red.
     */
    if (/\/pages\/reconsent\/index/.test(page.url())) {
      await page.locator('.btn-primary').click()
      await expect(page, 'accepting the terms must leave the consent screen')
        .not.toHaveURL(/\/pages\/reconsent\/index/, { timeout: 15_000 })
    }

    // Prove the session is usable instead of merely proving that a Locator
    // object exists. Invalid credentials used to pass because
    // `expect(locator).toBeTruthy()` only checked the JS object itself.
    await page.goto('/#/pages/profile/index', { waitUntil: 'networkidle' })
    await expect(page, 'the consent gate must not still be holding this session')
      .not.toHaveURL(/\/pages\/reconsent\/index/, { timeout: 15_000 })
    await expect(page.locator('.logged-in-wrap'), 'profile must render authenticated state')
      .toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.login-section')).toHaveCount(0)

    // Bind the credential to one reviewed synthetic user, not merely to two
    // self-attestation strings. Supabase stores the current session under its
    // project-scoped auth key; never print or export the session itself.
    const sessionUserId = await page.evaluate(reviewedSessionUserId)
    expect(sessionUserId, 'authenticated smoke must be the reviewed synthetic account')
      .toBe(EXPECTED_USER_ID)

    // Runtime proof when the smoke account owns a listing. Empty accounts are
    // still covered by the source-level contract above.
    const listingCards = page.locator('.horz-card')
    if (await listingCards.count() > 0) {
      const moreAction = listingCards.first().locator('.horz-more')
      await expect(moreAction).toBeVisible()
      await expect(moreAction).toHaveAttribute('role', 'button')
      await expect(moreAction).toHaveAttribute('tabindex', '0')
      await moreAction.press('Enter')
      await expect(page.locator('.uni-actionsheet')).toBeVisible()
    }

    // Authenticated sweep — the logged-out sweep at the top can't reach
    // login-only code paths: realtime subscriptions, auth-gated renders, and
    // the motion-layer `:key` remounts firing against real data. Read-only;
    // no writes to prod.
    const AUTHED = [
      'pages/index/index', 'pages/plaza/index', 'pages/messages/index',
      'pages/profile/index', 'pages/notifications/index', 'pages/publish/index',
    ]
    for (const route of AUTHED) {
      await page.goto(`/#/${route}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(1800)
    }
    await expect(page.locator('uni-view.image-add, .submit-bar').first()).toBeVisible()

    /*
     * Sign out, because a Supabase session is server-side state that closing
     * the browser does not release. This test signed in and never signed out,
     * so every push to main left another live session on the staging project:
     * 14 of them by 2026-08-07, the oldest dating to 2026-07-22. That is also
     * a contract problem for the hosted-canary activation review, which
     * expects the project to hold the three fixture accounts and nothing else.
     *
     * Driving the real settings control rather than clearing storage is the
     * point: local-only cleanup would leave the row behind, and this path has
     * regressed before.
     */
    /*
     * Local purge is authoritative, so the UI reports a successful sign-out
     * whatever the server answers — which is why the staging project kept
     * gaining a session per run even after this test started signing out.
     * Record the revoke call itself: without its status there is no way to
     * tell a request the server rejected from one it accepted and ignored.
     */
    const revokeCalls: Array<{ target: string; status: number }> = []
    page.on('response', (res) => {
      const url = new URL(res.url())
      if (url.pathname.endsWith('/auth/v1/logout')) {
        revokeCalls.push({ target: `${url.pathname}${url.search}`, status: res.status() })
      }
    })

    await page.goto('/#/pages/settings/index', { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
    // Label, not position — the delete-account item sits directly below and
    // shares its styling. Both languages, because this test does not pin one.
    await page.locator('[role="button"][aria-label="Sign Out"], [role="button"][aria-label="退出登录"]')
      .first().click()
    await expect(page.locator('uni-modal .uni-modal__btn_primary')).toBeVisible()
    await page.locator('uni-modal .uni-modal__btn_primary').click()
    await expect
      .poll(() => page.evaluate(reviewedSessionUserId), { timeout: 15_000 })
      .toBe('')

    // The revoke is best-effort and races a 5s cap, so give it its own wait
    // rather than reading whatever had arrived by the time storage cleared.
    await expect.poll(() => revokeCalls.length, { timeout: 10_000 }).toBeGreaterThan(0)
    expect(
      revokeCalls.filter(call => call.status >= 400),
      `sign-out revoke rejected: ${JSON.stringify(revokeCalls)}`,
    ).toEqual([])

    expect(errs, 'console errors during authenticated sweep').toEqual([])
  })
})
