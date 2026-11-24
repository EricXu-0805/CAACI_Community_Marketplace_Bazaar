import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import { CURRENT_CONSENT_VERSION } from '../src/legal'
import { supabaseRefForBuild } from './supabase-ref'

test.use({ browserName: 'webkit', viewport: { width: 820, height: 1180 } })

// The browser probe mutates its gate and counters as events arrive.
interface ViewportEvents {
  withhold: boolean
  withheld: number
  readonly events: string[]
}
declare global {
  interface Window { __viewportEvents: ViewportEvents }
}

const ME = '11111111-1111-4111-8111-111111111111'
const PEER = '22222222-2222-4222-8222-222222222222'
const POST = '33333333-3333-4333-8333-333333333333'
const CONV = '44444444-4444-4444-8444-444444444444'
const profile = { id: ME, nickname: 'Viewport reader', avatar_url: null,
  tos_version: CURRENT_CONSENT_VERSION, suspension_level: 0, suspended_until: null,
  is_illini_verified: true, location: 'UIUC', bio: '' } as const
const peer = { ...profile, id: PEER, nickname: 'Viewport peer' } as const
const post = { id: POST, user_id: PEER, title: null, category: null,
  content: 'Synthetic viewport discussion', images: [], like_count: 0, comment_count: 1,
  created_at: '2026-11-01T00:00:00Z', profile: peer, status: 'active' } as const

test.beforeEach(async ({ page }) => {
  // Install before navigation, ahead of framework and composable listeners.
  await page.addInitScript(([ref, uid]) => {
    const state: ViewportEvents = { withhold: false, withheld: 0, events: [] }
    window.__viewportEvents = state
    const gate = (source: string) => (event: Event) => {
      state.events.push(`${source}:${event.type}:${state.withhold ? 'withheld' : 'delivered'}`)
      if (!state.withhold) return
      state.withheld++
      event.stopImmediatePropagation()
    }
    window.addEventListener('resize', gate('window'), true)
    window.addEventListener('scroll', gate('window'), true)
    window.visualViewport?.addEventListener('resize', gate('visualViewport'))
    window.visualViewport?.addEventListener('scroll', gate('visualViewport'))
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', 'en')
    localStorage.setItem('theme_pref', 'light')
    const generation = 'viewport-consumers-generation'
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
      tag: 'caaci-auth-value-v2', generation, value: JSON.stringify({
        access_token: 'stub', refresh_token: 'stub', token_type: 'bearer',
        expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: uid, email: 'fixture@example.invalid', aud: 'authenticated', role: 'authenticated' },
      }),
    }))
    localStorage.setItem(`sb-${ref}-auth-token-auth-boundary-v2`,
      JSON.stringify({ v: 2, mode: 'allowed', generation }))
  }, [supabaseRefForBuild(), ME] as const)
  await page.routeWebSocket(/\.supabase\.co(?:[:/]|$)/, socket => socket.close())
  await page.route(url => url.pathname.startsWith('/api/'), route =>
    route.fulfill({ contentType: 'application/json', body: '{"flagged":false,"categories":[],"messages":[],"events":[]}' }))
  await page.route('**/*.supabase.co/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    let body: unknown = []
    if (path.endsWith('/rpc/get_my_profile')) body = profile
    else if (path.endsWith('/profiles')) body = [profile, peer]
    else if (path.endsWith('/posts')) body = [post]
    else if (path.endsWith('/post_comments')) body = [{
      id: '55555555-5555-4555-8555-555555555555', post_id: POST, user_id: PEER,
      content: 'Synthetic viewport reply', created_at: '2026-11-01T01:00:00Z', profile: peer,
    }]
    else if (path.endsWith('/conversations')) body = url.searchParams.get('id')?.startsWith('gt.') ? [] : [{
      id: CONV, item_id: null, buyer_id: ME, seller_id: PEER, buyer: profile, seller: peer,
      item: null, last_message_at: '2026-11-01T01:00:00Z', created_at: '2026-11-01T00:00:00Z',
      is_pinned_buyer: false, is_muted_buyer: false, unread_messages: [],
      latest_messages: [{ id: 'preview', content: 'Viewport thread', message_type: 'text',
        created_at: '2026-11-01T01:00:00Z' }],
    }]
    else if (path.endsWith('/messages') && request.method() === 'GET') body = [{
      id: '66666666-6666-4666-8666-666666666666', conversation_id: CONV,
      sender_id: PEER, sender: peer, message_type: 'text', is_read: true,
      content: 'Viewport thread message', created_at: '2026-11-01T01:00:00Z',
    }]
    if (request.headers().accept?.includes('vnd.pgrst.object') && Array.isArray(body)) body = body[0] ?? null
    await route.fulfill({ status: 200, contentType: 'application/json',
      headers: { 'content-range': '0-0/1' }, body: JSON.stringify(body) })
  })
})

async function record(page: Page, target: Locator, stage: string) {
  const values = await target.evaluate(element => {
    if (!(element instanceof HTMLElement)) throw new TypeError('Expected an HTML viewport consumer')
    const viewport = window.visualViewport
    if (!viewport) throw new TypeError('Expected the WebKit visual viewport')
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element)
    return { clientHeight: document.documentElement.clientHeight,
      rootHeight: document.documentElement.getBoundingClientRect().height,
      visualHeight: viewport.height, bottom: style.bottom,
      inlineBottom: element.style.bottom,
      composerInset: style.getPropertyValue('--composer-bottom-inset').trim(),
      inset: style.getPropertyValue('--chat-bottom-inset').trim(),
      top: rect.top, edge: rect.bottom, height: rect.height,
      events: window.__viewportEvents }
  })
  console.log(`VIEWPORT ${stage} ${JSON.stringify(values)}`)
}

async function screenshot(page: Page, info: TestInfo, name: string) {
  if (info.repeatEachIndex === 0) await page.screenshot({ path: info.outputPath(`${name}.png`), animations: 'disabled' })
}

async function staleInset(page: Page, target: Locator, info: TestInfo, name: string, property = 'bottom', width = 820) {
  await expect(target).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.clientHeight)).toBe(1180)
  await page.evaluate(() => {
    const viewport = window.visualViewport
    if (!viewport) throw new TypeError('Expected the WebKit visual viewport')
    Object.defineProperty(viewport, 'height', { configurable: true, get: () => 830 })
    viewport.dispatchEvent(new Event('resize'))
    window.__viewportEvents.withhold = true
  })
  await expect(target).toHaveCSS(property, '350px')
  if (name === 'messages') {
    await expect(target).toHaveClass(/kb-up/)
    await expect(target).toHaveCSS('--chat-bottom-inset', '350px')
  }
  if (property === '--composer-bottom-inset') await expect(target).toHaveCSS('bottom', '425px')
  await record(page, target, `${name}:inset-350`)
  await screenshot(page, info, `${name}-inset-350`)
  await page.setViewportSize({ width, height: 830 })
  await expect.poll(() => page.evaluate(() => document.documentElement.clientHeight)).toBe(830)
  await expect.poll(() => page.evaluate(() => window.__viewportEvents.withheld)).toBeGreaterThan(0)
  await record(page, target, `${name}:layout-830`)
}

async function recovered(page: Page, target: Locator, info: TestInfo, name: string, property = 'bottom') {
  // A soft assertion still fails the test, while allowing the plaza test to
  // exercise both independent dialogs during the observer-removal control.
  await expect.soft(target, `${name}: recovery to zero without viewport events`).toHaveCSS(property, '0px')
  await expect.poll(() => target.evaluate(element => Math.round(element.getBoundingClientRect().bottom))).toBeLessThanOrEqual(830)
  await record(page, target, `${name}:recovered`)
  await screenshot(page, info, `${name}-recovered`)
}

test('root box height matches the layout viewport at both tablet heights', async ({ page }) => {
  await page.goto('/#/pages/index/index')
  // This real home control appears after the page mounts, so the measurements
  // include its rendered content rather than the short startup shell.
  await expect(page.getByRole('button', { name: 'Open filters', exact: true })).toBeVisible()
  for (const height of [1180, 830]) {
    await page.setViewportSize({ width: 820, height })
    await expect.poll(() => page.evaluate(() => document.documentElement.clientHeight)).toBe(height)
    expect(await page.evaluate(() => document.documentElement.scrollHeight > document.documentElement.clientHeight),
      `home content must exceed the viewport at 820x${height}`).toBe(true)
    await expect.poll(() => page.evaluate(() => {
      const root = document.documentElement
      console.log(`ROOT_HEIGHT box=${Math.round(root.getBoundingClientRect().height)} client=${root.clientHeight}`)
      return Math.round(root.getBoundingClientRect().height) - root.clientHeight
    })).toBe(0)
    console.log(`ROOT_HEIGHT viewport=820x${height} difference=0`)
  }
})

test.describe('wide messages viewport', () => {
  // uni-h5 uses the smallest of innerWidth, clientWidth and screen width.
  // Override both sizes while retaining the inherited iPhone touch settings.
  test.use({ viewport: { width: 1280, height: 1180 }, screen: { width: 1280, height: 1180 } })

  test('messages two-pane recovers its inset without viewport events', async ({ page }, info) => {
    await page.goto('/#/pages/messages/index')
    await page.locator('.conv-item').first().click()
    await expect(page).toHaveURL(/\/#\/pages\/messages\/index$/)
    await expect(page.locator('.msg-thread-pane .chat-thread')).toBeVisible()
    const target = page.locator('.page.has-sidebar').filter({ has: page.locator('.chat-thread') })
    await staleInset(page, target, info, 'messages', 'bottom', 1280)
    await recovered(page, target, info, 'messages')
    await expect(target).not.toHaveClass(/kb-up/)
    await expect.poll(() => target.evaluate(element => getComputedStyle(element).getPropertyValue('--chat-bottom-inset').trim())).toBe('0px')
    await expect.poll(() => page.locator('.send-btn').evaluate(element => Math.round(element.getBoundingClientRect().bottom))).toBeLessThanOrEqual(830)
  })
})

test('index filters recover their inset without viewport events', async ({ page }, info) => {
  await page.goto('/#/pages/index/index')
  await page.getByRole('button', { name: 'Open filters', exact: true }).click()
  const target = page.getByRole('dialog', { name: 'Filters', exact: true })
  await staleInset(page, target, info, 'filters')
  await recovered(page, target, info, 'filters')
  await expect.poll(() => target.evaluate(element => Math.round(element.getBoundingClientRect().top))).toBeGreaterThanOrEqual(0)
})

test('plaza comments and composer recover their inset without viewport events', async ({ page }, info) => {
  await page.goto('/#/pages/plaza/index?view=all')
  await page.locator('.post-card').getByRole('button', { name: 'Reply', exact: true }).click()
  const comments = page.locator('.comment-sheet')
  await staleInset(page, comments, info, 'comments')
  await recovered(page, comments, info, 'comments')
  // A fresh navigation resets the event gate and the synthetic viewport.
  await page.setViewportSize({ width: 820, height: 1180 })
  await page.goto('/#/pages/plaza/index?view=all')
  await page.reload()
  await page.getByRole('button', { name: 'New topic', exact: true }).filter({ visible: true }).click()
  const composer = page.locator('.composer-fullpage')
  // At tablet width the modal adds centering space to its bottom position.
  // Assert the consumer's inset separately from that unchanged CSS offset.
  await staleInset(page, composer, info, 'composer', '--composer-bottom-inset')
  await recovered(page, composer, info, 'composer', '--composer-bottom-inset')
  await expect.poll(() => composer.evaluate(element => {
    if (!(element instanceof HTMLElement)) throw new TypeError('Expected the HTML composer')
    return element.style.bottom
  })).toBe('0px')
  await expect(composer).toHaveCSS('bottom', '75px')
})

test('post page recovers its inset without viewport events', async ({ page }, info) => {
  await page.goto(`/#/pages/post/index?id=${POST}`)
  await expect(page.getByText(post.content, { exact: true })).toBeVisible()
  const target = page.locator('.secondary-page--post')
  await staleInset(page, target, info, 'post')
  await recovered(page, target, info, 'post')
  await expect.poll(() => target.evaluate(element => Math.round(element.getBoundingClientRect().height))).toBe(830)
})
