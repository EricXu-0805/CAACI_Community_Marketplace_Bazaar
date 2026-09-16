import { test, expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { CURRENT_CONSENT_VERSION } from '../src/legal'
import { supabaseRefForBuild } from './supabase-ref'

test.use({ browserName: process.env.UI_AUDIT_BROWSER === 'webkit' ? 'webkit' : 'chromium' })
const ME = '11111111-1111-4111-8111-111111111111'
const PEER = '22222222-2222-4222-8222-222222222222'
const ITEM = '33333333-3333-4333-8333-333333333333'
const CONV = '44444444-4444-4444-8444-444444444444'
const POST = '55555555-5555-4555-8555-555555555555'
const profile = { id: ME, nickname: 'Demo buyer', avatar_url: null, bio: '', location: 'UIUC', tos_version: CURRENT_CONSENT_VERSION, suspension_level: 0, suspended_until: null, created_at: '2026-08-01T00:00:00Z' }
const peer = { ...profile, id: PEER, nickname: 'Demo seller' }
const item = { id: ITEM, user_id: PEER, title: 'Study desk', description: 'Desk with adjustable legs. Pickup after class.', price: 35, category: 'furniture', listing_type: 'sell', condition: 'good', status: 'active', images: [], image_dimensions: [], location: 'UIUC', created_at: '2026-09-01T00:00:00Z', profile: peer, view_count: 1, favorite_count: 0 }

async function fixture(page: Page, options: { anonymous?: boolean; blocked?: boolean; race?: boolean; theme?: string } = {}) {
  const writes: { path: string; data: any }[] = []
  const conversations: any[] = []
  const messages: any[] = []
  await page.addInitScript(({ ref, me, anonymous, theme }) => {
    localStorage.setItem('welcomed', '1'); localStorage.setItem('lang', 'en'); localStorage.setItem('theme_pref', theme)
    if (anonymous) return
    const generation = 'seller-publish-responsive'
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({ tag: 'caaci-auth-value-v2', generation, value: JSON.stringify({ access_token: 'stub', refresh_token: 'stub', token_type: 'bearer', expires_at: Math.floor(Date.now()/1000)+3600, user: { id: me, email: 'fixture@example.invalid', aud: 'authenticated', role: 'authenticated' } }) }))
    localStorage.setItem(`sb-${ref}-auth-token-auth-boundary-v2`, JSON.stringify({ v: 2, mode: 'allowed', generation }))
  }, { ref: supabaseRefForBuild(), me: ME, anonymous: options.anonymous, theme: options.theme || 'light' })
  await page.routeWebSocket(/supabase\.co/, socket => socket.close())
  await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({ contentType: 'application/json', body: '{"flagged":false,"categories":[],"messages":[],"events":[]}' }))
  await page.route('**/*.supabase.co/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname
    const eq = (key: string) => url.searchParams.get(key)?.replace(/^eq\./, '')
    const single = (req.headers().accept || '').includes('vnd.pgrst.object')
    const send = (value: any, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(single && Array.isArray(value) ? value[0] ?? null : value) })
    if (req.method() === 'POST' && !path.includes('/rpc/')) writes.push({ path, data: req.postDataJSON() })
    if (path.endsWith('/rpc/get_my_profile')) return send(profile)
    if (path.endsWith('/profiles')) return send([profile, peer].filter(p => !eq('id') || p.id === eq('id')))
    if (path.endsWith('/blocks')) return send(options.blocked ? [{ blocker_id: ME, blocked_id: PEER }] : [])
    if (path.endsWith('/conversations')) {
      if (req.method() === 'POST') {
        const row = { ...req.postDataJSON(), id: CONV, buyer: profile, seller: peer, item: null, created_at: new Date().toISOString(), last_message_at: new Date().toISOString() }
        conversations.push(row)
        if (options.race) return send({ code: '23505', message: 'duplicate key' }, 409)
        return send(row)
      }
      return send(conversations.filter(c => (!eq('id') || c.id === eq('id')) && (url.searchParams.get('is_direct') !== 'eq.true' || c.is_direct)))
    }
    if (path.endsWith('/messages')) {
      if (req.method() === 'POST') { const row = { ...req.postDataJSON(), created_at: new Date().toISOString(), is_read: false }; messages.push(row); return send(row) }
      if (req.method() === 'PATCH') return send([])
      return send(messages.filter(m => (!eq('conversation_id') || m.conversation_id === eq('conversation_id')) && (!eq('id') || m.id === eq('id'))))
    }
    if (path.endsWith('/items') || path.endsWith('/items_visible')) return send([item].filter(i => (!eq('id') || i.id === eq('id')) && (!eq('user_id') || i.user_id === eq('user_id')) && (!eq('listing_type') || i.listing_type === eq('listing_type')) && (!eq('category') || i.category === eq('category'))))
    if (path.endsWith('/posts')) return send([{ id: POST, user_id: PEER, content: 'A quiet afternoon on campus.', images: [], profile: peer, created_at: item.created_at, like_count: 0, comment_count: 0, status: 'active', post_items: [] }])
    return send([])
  })
  return { writes, conversations, messages }
}

async function capture(page: Page, name: string) {
  if (!process.env.UI_AUDIT_CAPTURE) return
  const dir = resolve('../output/ui-followup-20260916', process.env.UI_AUDIT_CAPTURE)
  mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: resolve(dir, `${name}.png`) })
}

for (const race of [false, true]) test(`seller DM ${race ? 'concurrent reverse-pair conflict' : 'start, send and reopen'} reuses conversation`, async ({ page }) => {
  const f = await fixture(page, { race })
  await page.goto(`/#/pages/seller/index?id=${PEER}`)
  await page.getByRole('button', { name: 'Message', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`pages/chat/index\\?id=${CONV}`))
  await expect(page.locator('.chat-header')).toContainText('Demo seller')
  await expect(page.locator('.chat-thread .item-card')).toHaveCount(0)
  await page.locator('.msg-input textarea').fill('Hi, are you around campus today?')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await expect.poll(() => f.messages.length).toBe(1)
  await page.goto(`/#/pages/seller/index?id=${PEER}`)
  await page.getByRole('button', { name: 'Message', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`pages/chat/index\\?id=${CONV}`))
  expect(f.writes.filter(w => w.path.endsWith('/conversations'))).toHaveLength(1)
  expect(f.conversations[0]).toMatchObject({ item_id: null, is_direct: true, buyer_id: ME, seller_id: PEER })
})

test('self and blocked seller have no message action', async ({ page }) => {
  await fixture(page, { blocked: true })
  for (const id of [ME, PEER]) {
    await page.goto(`/#/pages/seller/index?id=${id}`)
    await expect(page.locator('.seller-section, .blocked-state').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Message', exact: true })).toHaveCount(0)
  }
})

for (const kind of ['sell', 'wanted'] as const) test(`publish ${kind} from a category carries context into a fresh and cached composer`, async ({ page }) => {
  await fixture(page)
  await page.goto('/#/')
  if (kind === 'wanted') await page.getByRole('tab', { name: 'Wanted', exact: true }).click()
  await page.locator('.cat-bar').getByRole('button', { name: 'Electronics', exact: true }).click()
  await page.locator('.feed-publish').click()
  await expect(page.locator('.lt-seg.on')).toContainText(kind === 'wanted' ? 'Wanted' : 'Selling')
  await expect(page.locator('.field-value').first()).toContainText('Electronics')
  // On leaving a prefilled form, explicitly discard the draft. Re-enter via
  // a different category to exercise uni-app's cached tab (no second onLoad).
  await page.locator('.tabbar').getByRole('button', { name: 'Home', exact: true }).click()
  await page.getByText('Drop', { exact: true }).last().click()
  await expect(page.locator('.feed-publish')).toBeVisible()
  await page.locator('.cat-bar').getByRole('button', { name: 'Furniture', exact: true }).click()
  await page.locator('.feed-publish').click()
  await expect(page.locator('.field-value').first()).toContainText('Furniture')
})

test('a category entry preserves a saved draft when the user chooses Keep', async ({ page }) => {
  await fixture(page)
  await page.goto('/#/pages/publish/index')
  const title = page.getByRole('textbox', { name: 'Title (required)', exact: true })
  await title.fill('My existing listing draft')
  await page.locator('.image-tip').click()
  await page.locator('.tabbar').getByRole('button', { name: 'Home', exact: true }).click()
  await page.getByText('Save', { exact: true }).click()
  await page.getByRole('tab', { name: 'Wanted', exact: true }).click()
  await page.locator('.cat-bar').getByRole('button', { name: 'Electronics', exact: true }).click()
  await page.locator('.feed-publish').click()
  await page.getByText('Keep', { exact: true }).click()
  await expect(title).toHaveValue('My existing listing draft')
  await expect(page.locator('.lt-seg.on')).toContainText('Selling')
})

test('anonymous category publishing requests login without creating a listing', async ({ page }) => {
  const f = await fixture(page, { anonymous: true })
  await page.goto('/#/')
  await page.getByRole('tab', { name: 'Wanted', exact: true }).click()
  await page.locator('.cat-bar').getByRole('button', { name: 'Books', exact: true }).click()
  await page.locator('.feed-publish').click()
  await expect(page).toHaveURL(/pages\/login\/index\?intent=/)
  expect(f.writes.filter(w => w.path.endsWith('/items'))).toHaveLength(0)
})

test('authorized publish return parses type and category on initial page load', async ({ page }) => {
  await fixture(page)
  await page.goto('/#/pages/publish/index?listingType=wanted&category=books')
  await expect(page.locator('.lt-seg.on')).toContainText('Wanted')
  await expect(page.locator('.field-value').first()).toContainText('Books')
})

for (const [name, width, height] of [['phone',390,844],['ipad-portrait',820,1180],['ipad-landscape',1180,820],['mac',1920,1080]] as const) {
  for (const theme of ['light', 'dark']) test.describe(`${name} ${theme}`, () => {
    test.use({ viewport: { width, height } })
    test('deep routes keep navigation and usable content width', async ({ page }) => {
      await fixture(page, { theme })
      for (const route of ['settings/index','notifications/index','profile/edit','following/index','history/index','saved-searches/index','blocked/index','my-items/index','search/index','legal/index','illini-verify/index',`seller/index?id=${PEER}`,`post/index?id=${POST}`]) {
        await page.goto(`/#/pages/${route}`)
        const content = page.locator('.secondary-content')
        await expect(content).toBeVisible()
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
        const box = (await content.boundingBox())!
        expect(box.width, route).toBeGreaterThan(width >= 768 ? Math.min(width - 300, 750) : width - (route === 'illini-verify/index' ? 60 : 10))
        if (width >= 768) {
          await expect(page.locator('.app-sidebar')).toBeVisible()
          expect(box.x).toBeGreaterThanOrEqual(240)
          expect(box.x + box.width).toBeLessThanOrEqual(width)
        } else await expect(page.locator('.app-sidebar')).toBeHidden()
        if (['settings/index',`seller/index?id=${PEER}`].includes(route)) await capture(page, `${name}-${theme}-${route.split('/')[0]}`)
      }
      await page.goto('/#/pages/plaza/index')
      await page.locator(width >= 768 ? '.plaza-compose-d' : '.compose-btn').click()
      const dialog = page.locator('.composer-fullpage')
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Add photos', exact: true })).toBeVisible()
      const box = (await dialog.boundingBox())!
      expect(box.width).toBeGreaterThan(width >= 768 ? 650 : 380)
      expect(box.height).toBeLessThanOrEqual(height)
      if (width >= 768) expect(box.height).toBeLessThan(height - 35)
      await capture(page, `${name}-${theme}-composer`)
      // Model the visual viewport shrinking for a software keyboard, including
      // iPad: the photo toolbar must remain in the visible area.
      const visibleHeight = height - 330
      await page.evaluate(h => {
        Object.defineProperty(visualViewport!, 'height', { configurable: true, value: h })
        Object.defineProperty(visualViewport!, 'offsetTop', { configurable: true, value: 0 })
        visualViewport!.dispatchEvent(new Event('resize'))
      }, visibleHeight)
      await expect.poll(async () => {
        const footer = (await dialog.locator('.comp-footer').boundingBox())!
        return footer.y + footer.height
      }).toBeLessThanOrEqual(visibleHeight + 1)
      await dialog.getByText('Cancel', { exact: true }).click()
      await expect(dialog).toHaveCount(0)
    })
  })
}
