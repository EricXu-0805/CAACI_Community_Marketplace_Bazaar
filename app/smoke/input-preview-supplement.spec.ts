import { test, expect, chromium, devices, type Page, type Locator } from '@playwright/test'
import { CURRENT_CONSENT_VERSION } from '../src/legal'
import { supabaseRefForBuild } from './supabase-ref'

test.use({ browserName: process.env.UI_AUDIT_BROWSER === 'chromium' ? 'chromium' : 'webkit' })
const UID = '11111111-1111-4111-8111-111111111111'
const ID = '22222222-2222-4222-8222-222222222222'
const REF = supabaseRefForBuild()
const profile = { id: UID, nickname: 'Student', avatar_url: null, tos_version: CURRENT_CONSENT_VERSION,
  suspension_level: 0, suspended_until: null, is_illini_verified: true, location: 'UIUC' }
const photos = ['front', 'back'].map(name => `https://${REF}.supabase.co/storage/v1/object/public/item-images/items/${UID}/${name}.svg`)
const item = { id: ID, user_id: UID, title: 'Campus desk', description: 'A study desk.', price: 25,
  category: 'furniture', condition: 'good', status: 'active', images: photos, image_dimensions: [{ w: 800, h: 600 }, { w: 800, h: 600 }],
  created_at: '2026-09-01T00:00:00Z', profile }
const post = { id: ID, user_id: UID, content: 'Campus questions', images: [], comment_count: 0,
  like_count: 0, created_at: '2026-09-01T00:00:00Z', profile }

async function fixture(page: Page) {
  const comments: any[] = []
  await page.addInitScript(([ref, uid]) => {
    localStorage.setItem('welcomed', '1'); localStorage.setItem('lang', 'en')
    const generation = 'supplemental-input-preview'
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({ tag: 'caaci-auth-value-v2', generation,
      value: JSON.stringify({ access_token: 'stub', refresh_token: 'stub', token_type: 'bearer',
        expires_at: Math.floor(Date.now()/1000)+3600, user: { id: uid, email: 'fixture@example.invalid', role: 'authenticated' } }) }))
    localStorage.setItem(`sb-${ref}-auth-token-auth-boundary-v2`, JSON.stringify({ v: 2, mode: 'allowed', generation }))
  }, [REF, UID])
  await page.routeWebSocket(/supabase\.co/, socket => socket.close())
  await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({ contentType: 'application/json', body: '{"flagged":false,"categories":[]}' }))
  await page.route('**/*.supabase.co/**', async route => {
    const req = route.request(), url = new URL(req.url())
    if (url.pathname.startsWith('/storage/')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#f4bb7a"/></svg>' })
    let body: any = []
    if (url.pathname.endsWith('/get_my_profile') || url.pathname.endsWith('/get_public_profile')) body = profile
    else if (url.pathname.endsWith('/profiles')) body = [profile]
    else if (url.pathname.endsWith('/items')) body = url.searchParams.get('id')?.startsWith('neq.') ? [] : [item]
    else if (url.pathname.endsWith('/posts') || url.pathname.endsWith('/list_posts')) body = [post]
    else if (url.pathname.endsWith('/post_comments')) {
      if (req.method() === 'POST') {
        const row = { ...req.postDataJSON(), id: '33333333-3333-4333-8333-333333333333', created_at: new Date().toISOString(), profile }
        comments.push(row); body = [row]
      } else body = comments
    }
    if (req.headers().accept?.includes('vnd.pgrst.object') && Array.isArray(body)) body = body[0] ?? null
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
  })
  return comments
}

// Many IMEs finish composition before the keyup whose Enter selected a
// candidate. Event-sequence coverage is not a claim of physical IME testing.
async function acceptComposition(input: Locator) {
  await input.dispatchEvent('compositionstart', { data: '' })
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true })
  await input.dispatchEvent('compositionend', { data: '桌子' })
  await input.dispatchEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, isComposing: false })
}

for (const kind of ['preload', 'safari-rejection'] as const) test(`supplement: ${kind} recovers a stale page once and preserves the publishing draft`, async ({ page }) => {
  await fixture(page); await page.goto('/#/pages/publish/index')
  const title = page.getByRole('textbox', { name: 'Title (required)', exact: true })
  await title.fill('Desk with a draft that must survive an update')
  await page.locator('.image-tip').click()
  const failChunk = () => page.evaluate(kind => {
    const error = new TypeError(kind === 'preload'
      ? 'Failed to fetch dynamically imported module: /assets/stale-page.js'
      : 'Importing a module script failed.')
    if (kind === 'preload') {
      const event = Object.assign(new Event('vite:preloadError', { cancelable: true }), { payload: error })
      window.dispatchEvent(event)
    } else {
      window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', { reason: error, promise: Promise.resolve(), cancelable: true }))
    }
  }, kind)
  await Promise.all([page.waitForEvent('load', { timeout: 5000 }), failChunk()])
  await page.getByText('Keep', { exact: true }).click()
  await expect(title).toHaveValue('Desk with a draft that must survive an update')
  let reloads = 0
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) reloads++ })
  await failChunk()
  await page.waitForTimeout(800)
  expect(reloads, 'a persistent network/module error must not cause a reload loop').toBe(0)
  await expect(title).toHaveValue('Desk with a draft that must survive an update')
})

for (const width of [390, 834]) test(`supplement: touch inputs remain readable at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  await page.addInitScript(() => { localStorage.setItem('welcomed', '1'); localStorage.setItem('lang', 'en') })
  await page.route('**/*.supabase.co/**', route => route.fulfill({ contentType: 'application/json', body: '[]' }))
  await page.goto('/#/pages/login/index')
  const email = page.getByRole('textbox', { name: 'Email', exact: true })
  await expect(email).toBeVisible()
  const inputs = page.locator('input')
  for (const input of await inputs.all()) expect(await input.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16)
  await email.fill('reading-check@example.invalid')
  await expect(email).toHaveValue('reading-check@example.invalid')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1)
})

// Chromium's touch gesture API exercises the browser zoom policy rather than
// replacing visualViewport properties. This is still device emulation.
test('supplement: browser touch pinch can enlarge the login page', async ({ baseURL }) => {
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({ ...devices['iPhone 13'], baseURL, viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    await page.addInitScript(() => { localStorage.setItem('welcomed', '1'); localStorage.setItem('lang', 'en') })
    await page.route('**/*.supabase.co/**', route => route.fulfill({ contentType: 'application/json', body: '[]' }))
    await page.goto('/#/pages/login/index')
    await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toBeVisible()
    const cdp = await context.newCDPSession(page)
    try {
      await cdp.send('Input.synthesizePinchGesture', { x: 180, y: 180, scaleFactor: 2, gestureSourceType: 'touch' })
      await expect.poll(() => page.evaluate(() => visualViewport!.scale)).toBeGreaterThan(1.5)
      await cdp.send('Input.synthesizePinchGesture', { x: 180, y: 180, scaleFactor: 0.5, gestureSourceType: 'touch' })
      await expect.poll(() => page.evaluate(() => visualViewport!.scale)).toBeLessThan(1.1)
    } finally { await cdp.detach() }
  } finally { await browser.close() }
})

test('supplement: IME candidate Enter stays in search until the next deliberate Enter', async ({ page }) => {
  await fixture(page); await page.goto('/#/pages/search/index')
  const input = page.getByRole('searchbox')
  await input.fill('桌子')
  await acceptComposition(input)
  await expect(input).toBeFocused()
  await expect(input).toHaveValue('桌子')
  await expect(page).toHaveURL(/pages\/search\/index/)
  await input.press('Enter')
  await expect(page).not.toHaveURL(/pages\/search\/index/)
})

test('supplement: IME candidate Enter never submits a comment', async ({ page }) => {
  const comments = await fixture(page); await page.goto(`/#/pages/post/index?id=${ID}`)
  const input = page.locator('.input-bar input')
  await input.fill('桌子今天可以取吗')
  await acceptComposition(input)
  await expect(input).toBeFocused()
  await expect(input).toHaveValue('桌子今天可以取吗')
  expect(comments).toHaveLength(0)
  await input.press('Enter')
  await expect.poll(() => comments.length).toBe(1)
})

test('supplement: finishing an earlier comment preserves the next draft', async ({ page }) => {
  const comments = await fixture(page)
  let release!: () => void, started = false
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/rest/v1/post_comments?**', async route => {
    if (route.request().method() !== 'POST') return route.fallback()
    started = true; await gate; await route.fallback()
  })
  await page.goto(`/#/pages/post/index?id=${ID}`)
  const input = page.locator('.input-bar input')
  await input.fill('My first comment')
  await page.locator('.input-bar .send-btn').click()
  await expect.poll(() => started).toBe(true)
  await input.fill('My next comment is still being written')
  release()
  await expect.poll(() => comments.length).toBe(1)
  await expect(page.locator('.cs-content')).toContainText('My first comment')
  await expect(input).toHaveValue('My next comment is still being written')
})

test('supplement: a failed plaza comment does not replace the next draft', async ({ page }) => {
  const comments = await fixture(page)
  let release!: () => void, started = false
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/rest/v1/post_comments?**', async route => {
    if (route.request().method() !== 'POST') return route.fallback()
    if (started) return route.fallback()
    started = true; await gate
    await route.fulfill({ status: 400, contentType: 'application/json', body: '{"code":"P0001","message":"rate_limit_comments_hour"}' })
  })
  await page.goto('/#/pages/plaza/index')
  await page.locator('.pa-btn[aria-label="Comment"]').first().click()
  const input = page.locator('.ci-input textarea')
  await input.fill('The earlier comment')
  await page.locator('.ci-send').click()
  await expect.poll(() => started).toBe(true)
  await expect(input).toHaveValue('')
  await expect(page.locator('.comment-sheet .cs-content')).toHaveText('The earlier comment')
  await input.fill('My new draft')
  release()
  await expect(page.locator('uni-toast')).toContainText('Commenting too fast')
  await expect(page.locator('.comment-sheet .cs-content')).toHaveCount(0)
  await expect(page.locator('.ci-send')).toHaveAttribute('aria-disabled', 'false')
  await expect(input).toHaveValue('My new draft')
  await page.locator('.ci-send').click()
  await expect.poll(() => comments.map(c => c.content)).toEqual(['My new draft'])
})

test('supplement: closing a comment sheet isolates its pending submission from the reopened sheet', async ({ page }) => {
  const comments = await fixture(page)
  let release!: () => void, started = false
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/rest/v1/post_comments?**', async route => {
    if (route.request().method() !== 'POST' || started) return route.fallback()
    started = true; await gate; await route.fallback()
  })
  await page.goto('/#/pages/plaza/index')
  const open = page.locator('.pa-btn[aria-label="Comment"]').first()
  await open.click()
  const input = page.locator('.ci-input textarea')
  await input.fill('Earlier sheet comment'); await page.locator('.ci-send').click()
  await expect.poll(() => started).toBe(true)
  await page.locator('.comment-sheet .as-close').click()
  await open.click()
  await input.fill('Reopened sheet comment')
  await page.locator('.ci-send').click()
  await expect.poll(() => comments.map(c => c.content)).toEqual(['Reopened sheet comment'])
  release()
  await expect.poll(() => comments.length).toBe(2)
  // A new interaction after the old completion makes sure it cannot append
  // the old optimistic result or take control of the reopened composer.
  await input.fill('Current draft')
  await expect(page.locator('.comment-sheet .cs-content')).toHaveText(['Reopened sheet comment'])
  await expect(input).toHaveValue('Current draft')
})

for (const width of [1440, 820, 390]) test(`supplement: image preview traps keyboard focus and restores it at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await fixture(page)
  await page.goto(`/#/pages/detail/index?id=${ID}`)
  const opener = page.locator('.swiper-img').first()
  await opener.focus(); await opener.press('Enter')
  const preview = page.getByRole('dialog', { name: 'Preview image', exact: true })
  await expect(preview).toBeVisible()
  const close = preview.getByRole('button', { name: 'Close', exact: true })
  await expect(close).toBeFocused()
  for (const key of ['Tab', 'Shift+Tab']) {
    await page.keyboard.press(key)
    expect(await preview.evaluate(el => el.contains(document.activeElement))).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(preview).toHaveCount(0)
  await expect(opener).toBeFocused()
  await opener.press('Enter'); await expect(preview).toBeVisible()
  await close.press('Enter'); await expect(preview).toHaveCount(0)
  await expect(opener).toBeFocused()
  // Leaving via browser navigation also removes the modal and restores the
  // page's ability to receive input; don't restore focus to an old page.
  await opener.press('Enter'); await expect(preview).toBeVisible()
  await page.evaluate(() => { window.location.hash = '#/pages/search/index' })
  await expect(preview).toHaveCount(0)
  const search = page.getByRole('searchbox')
  await search.fill('desk'); await expect(search).toHaveValue('desk')
})
