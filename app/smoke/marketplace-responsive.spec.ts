import { test, expect, type Page } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CURRENT_CONSENT_VERSION } from '../src/legal'
import { supabaseRefForBuild } from './supabase-ref'

test.use({ browserName: process.env.UI_AUDIT_BROWSER === 'chromium' ? 'chromium' : 'webkit' })

// Real page components, entirely synthetic data. No request, message or
// authentication session from this suite reaches the hosted marketplace.
const ME = '11111111-1111-4111-8111-111111111111'
const PEER = '22222222-2222-4222-8222-222222222222'
const ITEM = '33333333-3333-4333-8333-333333333333'
const CONV = '44444444-4444-4444-8444-444444444444'
const OTHER = '55555555-5555-4555-8555-555555555555'
const PROFILE = { id: ME, nickname: 'Buyer', avatar_url: null, tos_version: CURRENT_CONSENT_VERSION,
  suspension_level: 0, suspended_until: null, is_illini_verified: true, location: 'UIUC', bio: '' }
const SELLER = { id: PEER, nickname: 'Alex — campus furniture seller', avatar_url: null, location: 'UIUC' }
const LISTING = { id: ITEM, user_id: PEER, title: 'Adjustable study desk for a small apartment',
  price: 75, category: 'furniture', condition: 'like_new', listing_type: 'sell', status: 'active',
  negotiable: true, location: 'UIUC', images: [], image_dimensions: [],
  description: 'A clean desk with adjustable legs. Pickup on campus. '.repeat(18),
  view_count: 5, favorite_count: 1, created_at: '2026-09-01T00:00:00Z', profile: SELLER }

async function seedMarketplace(page: Page, photos = false) {
  const listing = { ...LISTING, images: photos ? ['front', 'side', 'back'].map(name =>
    `https://${supabaseRefForBuild()}.supabase.co/storage/v1/object/public/item-images/items/${PEER}/${name}.jpg`) : [] }
  const conversations = [CONV, OTHER].map((id, i) => ({ id, item_id: ITEM, buyer_id: ME, seller_id: PEER,
    buyer: PROFILE, seller: { ...SELLER, nickname: i ? 'Jordan' : SELLER.nickname }, item: listing,
    last_message_at: '2026-09-05T10:00:00Z', created_at: '2026-09-01T00:00:00Z',
    is_pinned_buyer: false, is_pinned_seller: false, is_muted_buyer: false, is_muted_seller: false,
    latest_messages: [{ id: `preview-${i}`, content: i ? 'Jordan thread' : 'Alex thread',
      message_type: 'text', created_at: '2026-09-05T10:00:00Z' }], unread_messages: [] }))
  const messages = [CONV, OTHER].flatMap((conversation_id, c) => Array.from({ length: 35 }, (_, i) => ({
    id: `66666666-6666-4666-8666-${String(c * 100 + i).padStart(12, '0')}`, conversation_id,
    sender_id: i % 2 ? ME : PEER, sender: i % 2 ? PROFILE : SELLER, message_type: 'text', is_read: true,
    content: `${c ? 'Jordan' : 'Alex'} message ${i + 1}: ` + (i === 34 ? 'Could we meet tomorrow afternoon at the campus pickup spot?' : 'Yes, the desk is available.'),
    created_at: new Date(Date.UTC(2026, 8, 5, 10, i)).toISOString(),
  })))
  let sends = 0
  await page.addInitScript(([ref, uid, theme]) => {
    localStorage.setItem('welcomed', '1'); localStorage.setItem('lang', 'en'); localStorage.setItem('theme_pref', theme)
    const generation = 'responsive-fixture-generation-01'
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({ tag: 'caaci-auth-value-v2', generation,
      value: JSON.stringify({ access_token: 'stub', refresh_token: 'stub', token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: uid, email: 'fixture@example.invalid', aud: 'authenticated', role: 'authenticated' } }) }))
    localStorage.setItem(`sb-${ref}-auth-token-auth-boundary-v2`, JSON.stringify({ v: 2, mode: 'allowed', generation }))
  }, [supabaseRefForBuild(), ME, process.env.UI_AUDIT_THEME === 'dark' ? 'dark' : 'light'] as const)
  await page.routeWebSocket(/supabase\.co/, socket => socket.close())
  await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ flagged: false, categories: [], messages: [], events: [] }) }))
  await page.route('**/*.supabase.co/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname
    if (path.includes('/storage/v1/')) return route.fulfill({ contentType: 'image/svg+xml',
      body: readFileSync(resolve('src/static/placeholder.svg')) })
    const eq = (key: string) => url.searchParams.get(key)?.replace(/^eq\./, '')
    let body: unknown = []
    if (path.endsWith('/rpc/get_my_profile')) body = PROFILE
    else if (path.endsWith('/conversations')) {
      body = url.searchParams.get('id')?.startsWith('gt.') ? [] : conversations.filter(c => !eq('id') || c.id === eq('id'))
    } else if (path.endsWith('/messages')) {
      if (req.method() === 'POST') {
        const row = { ...req.postDataJSON(), created_at: new Date().toISOString(), is_read: false, sender: PROFILE }
        messages.push(row); sends++; body = [row]
      } else if (req.method() === 'GET') {
        body = messages.filter(m => !eq('conversation_id') || m.conversation_id === eq('conversation_id'))
          .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, Number(url.searchParams.get('limit') || 50))
      }
    } else if (path.endsWith('/items') || path.endsWith('/items_visible')) {
      body = url.searchParams.get('id') === `neq.${ITEM}` ? [] : [listing]
    }
    else if (path.endsWith('/profiles')) body = [PROFILE, SELLER].filter(p => !eq('id') || p.id === eq('id'))
    const single = (req.headers().accept || '').includes('vnd.pgrst.object+json')
    if (single && Array.isArray(body)) body = body[0] ?? null
    await route.fulfill({ status: 200, contentType: 'application/json',
      headers: { 'content-range': '0-1/2' }, body: JSON.stringify(body) })
  })
  return { sends: () => sends }
}

async function screenshot(page: Page, name: string) {
  if (!process.env.UI_AUDIT_CAPTURE) return
  const dir = resolve('../output/audit-20260905/ui', process.env.UI_AUDIT_CAPTURE)
  mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: resolve(dir, `${name}.png`), fullPage: false })
}

test.describe('composer draft recovery', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false })

  test('modified Enter inserts a newline and plain Enter sends exactly once', async ({ page }) => {
    const fixture = await seedMarketplace(page)
    await page.goto(`/#/pages/chat/index?id=${CONV}`)
    const input = page.locator('.msg-input textarea')
    await input.fill('First line')
    await input.press('Shift+Enter')
    await expect(input).toHaveValue('First line\n')
    expect(fixture.sends()).toBe(0)
    for (const modifier of ['Control', 'Meta']) {
      await input.press(`${modifier}+Enter`)
      expect(fixture.sends()).toBe(0)
    }
    await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true })
    await input.dispatchEvent('keyup', { key: 'Enter', code: 'Enter', isComposing: true })
    await expect(input).not.toHaveValue('')
    expect(fixture.sends()).toBe(0)
    await input.fill('First line\nLatest second line')
    await input.press('Enter')
    await expect.poll(fixture.sends).toBe(1)
    await expect(page.locator('.msg-bubble').last()).toContainText('Latest second line')
    await expect(input).toHaveValue('')
  })

  test('conversation drafts survive switching threads and desktop to phone layout', async ({ page }) => {
    await seedMarketplace(page)
    await page.goto('/#/pages/messages/index')
    await page.locator('.conv-item').first().click()
    const input = page.locator('.msg-input textarea')
    const draft = 'I can meet near the library after class; let me check the time.'
    await input.fill(draft)
    await page.locator('.conv-item').nth(1).click()
    await expect(input).toHaveValue('')
    await input.fill('A different conversation draft')
    await page.locator('.conv-item').first().click()
    await expect(input).toHaveValue(draft)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(input).toHaveCount(0)
    await page.locator('.conv-item').first().click()
    await expect(input).toHaveValue(draft)
    await contained(page, '.send-btn', 40)
  })

  test('a delayed rejection preserves the next draft and keeps the rejected text available', async ({ page }) => {
    const fixture = await seedMarketplace(page)
    let reject!: () => void
    const response = new Promise<void>(resolve => { reject = resolve })
    let requested = false
    await page.route('**/api/moderate', async route => {
      requested = true
      await response
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ flagged: true, categories: ['harassment'] }) })
    })
    await page.goto(`/#/pages/chat/index?id=${CONV}`)
    const input = page.locator('.msg-input textarea')
    await input.fill('First message awaiting review')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect.poll(() => requested).toBe(true)
    await input.fill('A different message I am still writing')
    reject()
    await expect(page.locator('.msg-status.pending')).toHaveCount(0)
    await expect(input).toHaveValue('A different message I am still writing')
    await expect(page.locator('.msg-bubble').last()).toContainText('First message awaiting review')
    await expect(page.locator('.msg-status.failed')).toBeVisible()
    expect(fixture.sends()).toBe(0)
  })
})

async function contained(page: Page, selector: string, minWidth = 0) {
  const box = await page.locator(selector).first().boundingBox()
  expect(box, selector).not.toBeNull()
  const viewport = page.viewportSize()!
  expect(box!.x, `${selector} left edge`).toBeGreaterThanOrEqual(-1)
  expect(box!.x + box!.width, `${selector} right edge`).toBeLessThanOrEqual(viewport.width + 1)
  expect(box!.y + box!.height, `${selector} bottom edge`).toBeLessThanOrEqual(viewport.height + 1)
  expect(box!.width, `${selector} usable width`).toBeGreaterThanOrEqual(minWidth)
}

for (const device of [
  { name: 'mac-wide', width: 1440, height: 900 },
  { name: 'mac-compact', width: 1280, height: 720 },
  { name: 'ipad-portrait', width: 820, height: 1180 },
  { name: 'ipad-landscape', width: 1180, height: 820 },
  { name: 'phone-390', width: 390, height: 844 },
  { name: 'phone-360', width: 360, height: 800 },
]) {
  test.describe(device.name, () => {
    test.use({ viewport: { width: device.width, height: device.height },
      isMobile: device.width < 768, hasTouch: device.name.startsWith('ipad') || device.width < 768, deviceScaleFactor: 1 })

    test('listing details and bottom actions stay reachable', async ({ page }) => {
      await seedMarketplace(page)
      await page.goto(`/#/pages/detail/index?id=${ITEM}`)
      await expect(page.getByRole('heading', { name: LISTING.title })).toBeVisible()
      await page.getByRole('button', { name: 'Show more', exact: true }).click()
      await screenshot(page, `${device.name}-detail`)
      await contained(page, '.action-bar')
      await contained(page, '.action-bar .chat-btn', 100)
      await expect(page.locator('.desc-text')).not.toHaveClass(/clamped/)
      await page.locator('.safety-tip').scrollIntoViewIfNeeded()
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
      await expect.poll(async () => {
        const tip = (await page.locator('.safety-tip').boundingBox())!
        const bar = (await page.locator('.action-bar').boundingBox())!
        return Math.round(tip.y + tip.height - bar.y)
      }, { message: 'the fixed action bar must not cover the end of the listing' }).toBeLessThanOrEqual(-4)
    })

    test('inbox opens a usable chat, sends once and keeps the composer visible', async ({ page }) => {
      const fixture = await seedMarketplace(page)
      await page.goto('/#/pages/messages/index')
      await expect(page.locator('.conv-item').first()).toContainText('Alex thread')
      await page.locator('.conv-item').first().click()
      await expect(page.locator('.message-list')).toContainText('Alex message 35')
      await expect(page.locator('.message-list')).toHaveAttribute('aria-live', 'polite')
      await expect(page.getByText(/Alex message 35:/)).toBeInViewport({ ratio: 1 })
      await screenshot(page, `${device.name}-chat`)
      await contained(page, '.chat-thread', 320)
      await contained(page, '.send-btn', 40)
      await contained(page, '.msg-input', 100)
      await page.locator('.msg-input textarea').fill('Tomorrow at three works for me.')
      await page.getByRole('button', { name: 'Send message', exact: true }).click()
      await expect.poll(fixture.sends).toBe(1)
      await expect(page.locator('.message-list')).toContainText('Tomorrow at three works for me.')
      await page.locator('.offer-btn').first().click()
      await expect(page.locator('.offer-sheet')).toBeVisible()
      await screenshot(page, `${device.name}-offer`)
      await contained(page, '.offer-sheet')
      await contained(page, '.os-submit', 100)
    })

    if (device.name.startsWith('ipad')) test('visual viewport shrink keeps tablet input and sheets above the keyboard', async ({ page }) => {
      await seedMarketplace(page)
      await page.goto('/#/pages/messages/index')
      await page.locator('.conv-item').first().click()
      await expect(page.locator('.message-list')).toHaveAttribute('aria-live', 'polite')
      const visibleHeight = device.height - 350
      // Simulates the browser's visual-only keyboard resize. This proves the
      // layout response, not iPad hardware/IME behaviour; keep the real-device gate.
      await page.evaluate(height => {
        Object.defineProperty(window.visualViewport!, 'height', { configurable: true, get: () => height })
        Object.defineProperty(window.visualViewport!, 'offsetTop', { configurable: true, get: () => 0 })
        window.visualViewport!.dispatchEvent(new Event('resize'))
      }, visibleHeight)
      await expect.poll(async () => {
        const box = (await page.locator('.send-btn').boundingBox())!
        return Math.round(box.y + box.height)
      }).toBeLessThanOrEqual(visibleHeight)
      await page.locator('.offer-btn').first().click()
      await expect(page.locator('.offer-sheet')).toBeVisible()
      await expect.poll(async () => {
        const box = (await page.locator('.offer-sheet').boundingBox())!
        return Math.round(box.y + box.height)
      }).toBeLessThanOrEqual(visibleHeight)
      await screenshot(page, `${device.name}-keyboard`)
      await page.evaluate(() => {
        delete (window.visualViewport as any).height
        delete (window.visualViewport as any).offsetTop
        window.visualViewport!.dispatchEvent(new Event('resize'))
      })
    })

    if (device.width >= 768) test('product photos have visible mouse and keyboard navigation', async ({ page }) => {
      await seedMarketplace(page, true)
      await page.goto(`/#/pages/detail/index?id=${ITEM}`)
      await expect(page.locator('.img-counter')).toHaveText('1/3')
      await page.getByRole('button', { name: 'Next photo', exact: true }).click()
      await expect(page.locator('.img-counter')).toHaveText('2/3')
      await page.getByRole('button', { name: 'Next photo', exact: true }).press('Enter')
      await expect(page.locator('.img-counter')).toHaveText('3/3')
      await page.getByRole('button', { name: 'Previous photo', exact: true }).click()
      await expect(page.locator('.img-counter')).toHaveText('2/3')
      await screenshot(page, `${device.name}-gallery`)
    })
  })
}

test('desktop conversation switching and tablet rotation never leave a hidden second thread', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await seedMarketplace(page)
  await page.goto('/#/pages/messages/index')
  await page.locator('.conv-item').filter({ hasText: 'Alex thread' }).click()
  await expect(page.getByText(/Alex message 35:/)).toBeInViewport()
  await page.locator('.conv-item').filter({ hasText: 'Jordan thread' }).click()
  await expect(page.getByText(/Jordan message 35:/)).toBeInViewport()
  await expect(page.locator('.message-list')).not.toContainText('Alex message')
  await expect(page.locator('.chat-thread')).toHaveCount(1)
  await page.setViewportSize({ width: 820, height: 1180 })
  await expect(page.locator('.chat-thread')).toHaveCount(0)
  await page.locator('.conv-item').filter({ hasText: 'Alex thread' }).click()
  await expect(page).toHaveURL(new RegExp(`/pages/chat/index\\?id=${CONV}`))
  await expect(page.getByText(/Alex message 35:/)).toBeInViewport()
  await page.setViewportSize({ width: 1180, height: 820 })
  await expect(page.locator('.chat-thread')).toHaveCount(1)
  await contained(page, '.send-btn')
})

test('layout resize is not subtracted twice and pinch zoom is not treated as a keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 })
  await seedMarketplace(page)
  await page.goto(`/#/pages/chat/index?id=${CONV}`)
  await expect(page.locator('.message-list')).toHaveAttribute('aria-live', 'polite')
  await page.setViewportSize({ width: 820, height: 830 })
  await expect.poll(async () => Math.round((await page.locator('.chat-thread').boundingBox())!.height)).toBe(830)
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, 'scale', { configurable: true, get: () => 2 })
    Object.defineProperty(window.visualViewport!, 'height', { configurable: true, get: () => 415 })
    window.visualViewport!.dispatchEvent(new Event('resize'))
  })
  await expect(page.locator('.chat-page-wrap')).not.toHaveClass(/kb-up/)
  await expect.poll(async () => Math.round((await page.locator('.chat-thread').boundingBox())!.height)).toBe(830)
})
