import { test, expect, type Page } from '@playwright/test'
import { supabaseRefForBuild } from './supabase-ref'

/**
 * Navigating between hash routes is a same-document navigation, so
 * `networkidle` can resolve before uni's router has swapped the page in. A
 * fixed sleep after it is a coin flip on a loaded runner: on 2026-08-14 this
 * sweep reported `pages/messages/index` as having no heading and turned main
 * red, on a commit that only touched documentation. The heading is static
 * markup, so the snapshot had simply been taken mid-transition.
 *
 * Measured on WebKit: at the instant `goto` resolves, `location.hash` is
 * already the target and `<uni-page data-page="...">` already carries the
 * target route, so neither can tell "mounted" from "about to mount". Waiting
 * for the snapshot to stop changing does not work either, because an empty
 * page is a perfectly stable one. Nor does waiting for rendered text: publish,
 * detail and seller all paint some text before their heading.
 *
 * So wait for the heading inside the target route's own `<uni-page>`, bounded.
 * Scoping matters: the previous route can keep a valid heading in `<body>` for
 * a frame after the hash and target page shell have changed. A body snapshot
 * could therefore accept that stale heading before the new route mounted.
 * This is not circular — a route that never grows a heading still falls out at
 * the deadline and is still reported.
 */
const HEADING = /^\s*- heading\b/m

async function settledAriaSnapshot(page: Page, route: string, deadlineMs = 15_000): Promise<string> {
  const deadline = Date.now() + deadlineMs
  const routePath = route.split('?')[0]
  const targetPage = page.locator(`uni-page[data-page="${routePath}"]`).last()
  let previous = ''
  while (Date.now() < deadline) {
    await page.waitForTimeout(150)
    if (await targetPage.count() === 0) continue
    const current = await targetPage.ariaSnapshot()
    if (current === previous && HEADING.test(current)) return current
    previous = current
  }
  return previous
}

/**
 * The half of the app a logged-out sweep can never see.
 *
 * smoke/a11y-tree.spec.ts and smoke/contrast-runtime.spec.ts walk every route
 * anonymously, which means chat bubbles, conversation rows, notification
 * rows, listing detail and the seller profile are all behind a redirect and
 * simply never render. Those are the surfaces where the state lives, so they
 * are also where the accessible-name and contrast defects live.
 *
 * This seeds the session envelope directly (the same v2 shape
 * src/api/authPersistence.ts writes) and stubs the data layer, so it is
 * deterministic and touches no network. Two things it has to get right:
 * the boundary key is `<storageKey>-auth-boundary-v2` where storageKey
 * already ends in `-auth-token`, and its generation must match the envelope's
 * or the fail-closed adapter discards the session; and tos_version must equal
 * CURRENT_CONSENT_VERSION or the consent gate redirects to /reconsent.
 */

/*
 * Not a literal. The authenticated CI job pins VITE_SUPABASE_URL to staging,
 * so a hardcoded production ref wrote a key the app never reads: every gated
 * route below fell through to the login page, and this sweep — which used to
 * snapshot the whole document — found the login page's heading and passed.
 * The scoped snapshot introduced in #253 is what finally noticed, by
 * reporting ten routes as having no heading at all.
 */
const REF = supabaseRefForBuild()
const UID = '11111111-1111-4111-8111-111111111111'
const PEER = '22222222-2222-4222-8222-222222222222'
const ITEM = '33333333-3333-4333-8333-333333333333'
const CONV = '44444444-4444-4444-8444-444444444444'
const GEN = 'a11y-sweep-generation-0001'

const PROFILE = { id: UID, nickname: 'Test User', avatar_url: null, tos_version: '2026-08-01',
  suspension_level: 0, suspended_until: null, is_illini_verified: true, bio: 'hello', location: 'UIUC' }
const PEER_PROFILE = { id: PEER, nickname: 'Other Person', avatar_url: null, location: 'UIUC', is_illini_verified: false }
const ITEM_ROW = { id: ITEM, user_id: PEER, title: 'Desk lamp', price: 20, category: 'furniture',
  condition: 'mint', status: 'active', listing_type: 'sell', location: 'UIUC', location_verified: true,
  images: [`items/${ITEM}/a.jpg`], image_dimensions: [{ width: 800, height: 600 }], view_count: 5,
  favorite_count: 1, negotiable: true, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
  description: 'A lamp', profile: PEER_PROFILE }
const CONV_ROW = { id: CONV, buyer_id: UID, seller_id: PEER, item_id: ITEM, last_message_at: '2026-08-06T10:00:00Z',
  is_muted_buyer: false, is_muted_seller: false, is_pinned_buyer: true, is_pinned_seller: false,
  buyer: PROFILE, seller: PEER_PROFILE, item: ITEM_ROW, unread_messages: [{ id: 'm2' }] }
const MSGS = [
  { id: 'm1', conversation_id: CONV, sender_id: UID, content: 'Is this still available?', type: 'text',
    is_read: true, created_at: '2026-08-06T09:00:00Z', sender: PROFILE },
  { id: 'm2', conversation_id: CONV, sender_id: PEER, content: 'Yes, it is.', type: 'text',
    is_read: false, created_at: '2026-08-06T10:00:00Z', sender: PEER_PROFILE },
]
const NOTIFS = [
  { id: 'n1', user_id: UID, type: 'message', title: 'New message', body: 'Other Person replied',
    item_id: ITEM, conversation_id: CONV, is_read: false, created_at: '2026-08-06T10:00:00Z' },
  { id: 'n2', user_id: UID, type: 'sold', title: 'Item sold', body: 'Your desk lamp sold',
    item_id: ITEM, conversation_id: null, is_read: true, created_at: '2026-08-05T10:00:00Z' },
]

function fixtureFor(path: string): unknown {
  if (path.includes('/rpc/get_my_profile')) return PROFILE
  if (path.includes('/rpc/')) return []
  if (path.includes('/conversations')) return [CONV_ROW]
  if (path.includes('/messages')) return MSGS
  if (path.includes('/notifications')) return path.includes('is_read=eq.false') ? [{ id: 'n1' }] : NOTIFS
  if (path.includes('/items')) return [ITEM_ROW]
  if (path.includes('/profiles')) return [PROFILE, PEER_PROFILE]
  if (path.includes('/favorites')) return [{ item_id: ITEM, item: ITEM_ROW }]
  if (path.includes('/follows')) return [{ followee_id: PEER, profiles: PEER_PROFILE }]
  if (path.includes('/saved_searches')) return [{ id: 's1', user_id: UID, query: 'lamp', created_at: '2026-08-01T00:00:00Z' }]
  if (path.includes('/offers')) return []
  if (path.includes('/meetups')) return []
  return []
}

const GATED = [
  'pages/profile/index', 'pages/messages/index', 'pages/notifications/index',
  'pages/my-items/index', 'pages/history/index', 'pages/following/index',
  'pages/saved-searches/index', 'pages/publish/index', 'pages/detail/index?id=' + ITEM,
  'pages/seller/index?id=' + PEER, 'pages/chat/index?id=' + CONV, 'pages/profile/edit',
  'pages/settings/index', 'pages/blocked/index',
]

const PROBE = `(() => {
  const px = (s) => parseFloat(s) || 0
  const ch = (c) => { const s = c/255; return s <= 0.03928 ? s/12.92 : Math.pow((s+0.055)/1.055, 2.4) }
  const lum = ([r,g,b]) => 0.2126*ch(r) + 0.7152*ch(g) + 0.0722*ch(b)
  const ratio = (a,b) => { const [hi,lo] = [lum(a),lum(b)].sort((x,y)=>y-x); return (hi+0.05)/(lo+0.05) }
  const parse = (s) => { const m = /rgba?\\(([^)]+)\\)/.exec(s); if (!m) return null
    const p = m[1].split(',').map(Number); return [p[0],p[1],p[2], p.length>3?p[3]:1] }
  const over = (fg, bg) => [0,1,2].map(i => Math.round(fg[i]*fg[3] + bg[i]*(1-fg[3])))

  const out = []
  for (const el of document.querySelectorAll('*')) {
    const direct = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())
    if (!direct) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || px(cs.opacity) === 0) continue
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) continue
    const fg = parse(cs.color); if (!fg) continue

    // Walk up for the first opaque background; bail out on an image/gradient,
    // which we cannot sample from CSS.
    let node = el, bg = null, stack = [], imaged = false
    while (node && node !== document.documentElement.parentNode) {
      const s = getComputedStyle(node)
      if (s.backgroundImage && s.backgroundImage !== 'none') { imaged = true; break }
      const c = parse(s.backgroundColor)
      if (c && c[3] > 0) { if (c[3] >= 0.999) { bg = c; break } stack.push(c) }
      node = node.parentElement
    }
    if (imaged || !bg) continue
    let base = [bg[0],bg[1],bg[2]]
    for (const layer of stack.reverse()) base = over(layer, base)
    const fgc = fg[3] >= 0.999 ? [fg[0],fg[1],fg[2]] : over(fg, base)

    const size = px(cs.fontSize), weight = parseInt(cs.fontWeight) || 400
    const large = size >= 24 || (size >= 18.66 && weight >= 700)
    const need = large ? 3.0 : 4.5
    const got = ratio(fgc, base)
    if (got >= need) continue
    out.push({
      cls: (el.className && String(el.className).split(/\\s+/).filter(Boolean).slice(0,3).join('.')) || el.tagName.toLowerCase(),
      text: el.textContent.trim().slice(0, 28),
      ratio: Math.round(got*100)/100, need, size, weight,
      fg: cs.color, bg: 'rgb(' + base.join(',') + ')',
    })
  }
  return out
})()`

const MUST_BE_NAMED = new Set(['button','link','textbox','checkbox','radio','combobox','switch','slider','tab','menuitem'])
const NODE = /^(\s*)- ([a-z]+[a-z-]*)(\s+"([^"]*)")?/

for (const theme of ['light', 'dark']) {
  test(`authenticated a11y + contrast sweep (${theme})`, async ({ page }) => {
    test.setTimeout(600_000)
    await page.addInitScript(([ref, uid, gen, th]) => {
      localStorage.setItem('welcomed', '1'); localStorage.setItem('lang', 'en')
      localStorage.setItem('theme_pref', th)
      localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
        tag: 'caaci-auth-value-v2', generation: gen,
        value: JSON.stringify({ access_token: 'stub', token_type: 'bearer', expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'stub',
          user: { id: uid, email: 'a@illinois.edu', aud: 'authenticated', role: 'authenticated' } }),
      }))
      localStorage.setItem(`sb-${ref}-auth-token-auth-boundary-v2`, JSON.stringify({ v: 2, mode: 'allowed', generation: gen }))
    }, [REF, UID, GEN, theme] as const)

    await page.route('**/*.supabase.co/**', async (route) => {
      const path = route.request().url().replace(/^https:\/\/[^/]+/, '')
      const fixture = fixtureFor(path)
      /*
       * PostgREST signals .single()/.maybeSingle() with this Accept header and
       * supabase-js passes the body straight through, so answering one with an
       * array makes the array itself the row. fetchItem() uses .single(), which
       * meant `item` was `[ITEM_ROW]`: the detail route below rendered with no
       * title, `cat.undefined`, `condition.undefined`, "No photos", and a
       * TypeError out of formatPrice — and this sweep graded that for
       * accessible names and contrast as though it were the real page.
       */
      const wantsObject = (route.request().headers()['accept'] || '').includes('vnd.pgrst.object+json')
      const body = wantsObject && Array.isArray(fixture) ? (fixture[0] ?? null) : fixture
      await route.fulfill({ status: 200, contentType: 'application/json',
        headers: { 'content-range': '0-1/2' }, body: JSON.stringify(body) })
    })
    await page.route('**/*.jpg', route => route.fulfill({ status: 200, contentType: 'image/png',
      body: Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100' +
        '05fe02fea7000000004945' + '4e44ae426082', 'hex') }))

    const nameless: string[] = []
    const noHeading: string[] = []
    const contrast: string[] = []
    for (const route of GATED) {
      await page.goto(`/#/${route}`, { waitUntil: 'networkidle' })
      const snap = await settledAriaSnapshot(page, route)
      if (!HEADING.test(snap)) noHeading.push(route)
      const bad = await page.evaluate(PROBE)
      for (const f of bad as any[]) contrast.push(`${route}  ${f.cls}  ${f.ratio}/${f.need}  ${f.fg} on ${f.bg}  ${f.size}px/${f.weight}  "${f.text}"`)
      snap.split('\n').forEach((line, i, all) => {
        const m = NODE.exec(line)
        if (!m) return
        const [, , role, , name] = m
        if (!MUST_BE_NAMED.has(role)) return
        if (name && name.trim()) return
        nameless.push(`${route}  ${role}  ${all.slice(i, i + 3).filter(Boolean).join(' / ').slice(0, 110)}`)
      })
    }
    /*
     * Control. Everything above grades whatever reached the screen, and a page
     * that failed to assemble still has a heading, still has named controls and
     * still has legible text — so the sweep stayed green for as long as the
     * fixtures answered .single() with an array. Name something only the real
     * data can put on screen, so a fixture that stops feeding the app is a
     * failure here rather than silence everywhere else.
     */
    await page.goto(`/#/pages/detail/index?id=${ITEM}`, { waitUntil: 'networkidle' })
    await expect(page.getByText(ITEM_ROW.title, { exact: false }).first(),
      'the detail route rendered without its item — the sweep above graded a page that never assembled')
      .toBeVisible({ timeout: 15_000 })

    expect(noHeading, `logged-in routes with no heading:\n${noHeading.join('\n')}`).toEqual([])
    expect([...new Set(nameless)], `nameless controls:\n${[...new Set(nameless)].join('\n')}`).toEqual([])
    expect([...new Set(contrast)], `contrast failures:\n${[...new Set(contrast)].join('\n')}`).toEqual([])
  })
}
