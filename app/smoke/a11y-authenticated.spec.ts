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
const BLOCKED = '55555555-5555-4555-8555-555555555555'
const GEN = 'a11y-sweep-generation-0001'

const PROFILE = { id: UID, nickname: 'Test User', avatar_url: null, tos_version: '2026-08-01',
  suspension_level: 0, suspended_until: null, is_illini_verified: true, bio: 'hello', location: 'UIUC' }
const PEER_PROFILE = { id: PEER, nickname: 'Other Person', avatar_url: null, location: 'UIUC', is_illini_verified: false }
const BLOCKED_PROFILE = { id: BLOCKED, nickname: 'Muted Stranger', avatar_url: null, bio: 'spam',
  location: 'UIUC', is_illini_verified: false }
const PROFILE_ROWS = [PROFILE, PEER_PROFILE, BLOCKED_PROFILE]
const ITEM_ROW = { id: ITEM, user_id: PEER, title: 'Desk lamp', price: 20, category: 'furniture',
  condition: 'mint', status: 'active', listing_type: 'sell', location: 'UIUC', location_verified: true,
  images: [`items/${ITEM}/a.jpg`], image_dimensions: [{ width: 800, height: 600 }], view_count: 5,
  favorite_count: 1, negotiable: true, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
  description: 'A lamp', profile: PEER_PROFILE }
/*
 * The conversation list renders its preview from an embedded child row, not
 * from a column on the conversation — useMessages.ts asks for
 * `latest_messages:messages(id, content, message_type, created_at)` and keeps
 * the text only when `message_type === 'text'`.
 */
const LAST_MESSAGE = { id: 'm2', content: 'Yes, it is.', message_type: 'text',
  created_at: '2026-08-06T10:00:00Z' }
const CONV_ROW = { id: CONV, buyer_id: UID, seller_id: PEER, item_id: ITEM,
  created_at: '2026-08-06T09:00:00Z', last_message_at: '2026-08-06T10:00:00Z',
  is_muted_buyer: false, is_muted_seller: false, is_pinned_buyer: true, is_pinned_seller: false,
  buyer: PROFILE, seller: PEER_PROFILE, item: ITEM_ROW,
  latest_messages: [LAST_MESSAGE], unread_messages: [{ id: 'm2' }] }
/*
 * `message_type`, not `type`. utils/publicResource.ts blanks the body of any
 * message whose message_type is not exactly 'text', because historical media
 * lived in a public bucket. With the wrong column name every bubble rendered
 * with its avatar, timestamp and read receipt — and no words in it.
 */
const MSGS = [
  { id: 'm1', conversation_id: CONV, sender_id: UID, content: 'Is this still available?', message_type: 'text',
    is_read: true, created_at: '2026-08-06T09:00:00Z', sender: PROFILE },
  { id: 'm2', conversation_id: CONV, sender_id: PEER, content: LAST_MESSAGE.content, message_type: 'text',
    is_read: false, created_at: LAST_MESSAGE.created_at, sender: PEER_PROFILE },
]
const NOTIFS = [
  { id: 'n1', user_id: UID, type: 'message', title: 'New message', body: 'Other Person replied',
    item_id: ITEM, conversation_id: CONV, is_read: false, created_at: '2026-08-06T10:00:00Z' },
  { id: 'n2', user_id: UID, type: 'sold', title: 'Item sold', body: 'Your desk lamp sold',
    item_id: ITEM, conversation_id: null, is_read: true, created_at: '2026-08-05T10:00:00Z' },
]
const SAVED_SEARCH = { id: 's1', user_id: UID, keyword: 'mini fridge', category: 'furniture',
  listing_type: 'sell', price_min: 5, price_max: 40, created_at: '2026-08-01T00:00:00Z',
  last_notified_at: null }
/* useFollow.ts names the FK explicitly, so the embed arrives under `followee`. */
const FOLLOW_ROW = { created_at: '2026-08-01T00:00:00Z', followee_id: PEER, followee: PEER_PROFILE }
/*
 * Blocking the peer would empty the conversation, follow and item lists this
 * sweep depends on, so the blocked list gets a profile of its own.
 */
const BLOCK_ROW = { blocked_id: BLOCKED }
const VIEW_HISTORY = [ITEM_ROW]

/**
 * Row filters the fixtures have to honour. Ignoring one is not merely
 * incomplete — it answers confidently wrong: `/profiles?id=eq.<peer>` served
 * with the first row of the pool made the seller route render the *viewer's*
 * name and bio under the peer's listings.
 */
function filterById<T extends { id: string }>(query: string, rows: T[]): T[] {
  const eq = /[?&]id=eq\.([^&]+)/.exec(query)
  if (eq) return rows.filter(row => row.id === eq[1])
  const list = /[?&]id=in\.\(([^)]*)\)/.exec(query)
  if (list) {
    const wanted = new Set(list[1].split(',').map(value => value.replace(/^"|"$/g, '')))
    return rows.filter(row => wanted.has(row.id))
  }
  return rows
}

/**
 * api/paginatedRead.ts only stops scanning on an *empty* page and throws
 * `paginated_read_non_progress` when a page repeats a key it already read. A
 * fixture that answered every page with the same conversation row therefore
 * made the whole inbox fail: the messages route rendered "Failed to load".
 */
function afterKeysetCursor<T extends { id: string }>(query: string, rows: T[]): T[] {
  const gt = /[?&]id=gt\.([^&]+)/.exec(query)
  return gt ? rows.filter(row => row.id > gt[1]) : rows
}

function fixtureFor(path: string): unknown {
  const query = decodeURIComponent(path)
  if (query.includes('/rpc/get_my_profile')) return PROFILE
  if (query.includes('/rpc/')) return []
  if (query.includes('/conversation_archives')) return []
  if (query.includes('/conversations')) return afterKeysetCursor(query, [CONV_ROW])
  if (query.includes('/messages')) return MSGS
  if (query.includes('/notifications')) return query.includes('is_read=eq.false') ? [{ id: 'n1' }] : NOTIFS
  if (query.includes('/items')) return [ITEM_ROW]
  if (query.includes('/blocks')) return [BLOCK_ROW]
  if (query.includes('/profiles')) return filterById(query, PROFILE_ROWS)
  if (query.includes('/favorites')) return [{ item_id: ITEM, item: ITEM_ROW }]
  if (query.includes('/follows')) return [FOLLOW_ROW]
  if (query.includes('/saved_searches')) return [SAVED_SEARCH]
  if (query.includes('/offers')) return []
  if (query.includes('/meetups')) return []
  return []
}

const GATED = [
  'pages/profile/index', 'pages/messages/index', 'pages/notifications/index',
  'pages/my-items/index', 'pages/history/index', 'pages/following/index',
  'pages/saved-searches/index', 'pages/publish/index', 'pages/detail/index?id=' + ITEM,
  'pages/seller/index?id=' + PEER, 'pages/chat/index?id=' + CONV, 'pages/profile/edit',
  'pages/settings/index', 'pages/blocked/index',
]

/**
 * Per-route control, one string each that only the fixture data can put on
 * screen. Everything else in this file grades whatever reached the screen, and
 * a route that failed to assemble still has a heading, still has named
 * controls and still has legible text — an error banner and an empty state
 * both pass the sweep in silence. #292 added this for the detail route only,
 * which left four routes being graded as blank: messages was showing "Failed
 * to load", chat was showing wordless bubbles, following and saved searches
 * were showing their "nothing here yet" art.
 */
const CONTROL: Record<string, string> = {
  'pages/profile/index': PROFILE.nickname,
  'pages/messages/index': LAST_MESSAGE.content,
  'pages/notifications/index': NOTIFS[0].body,
  'pages/my-items/index': ITEM_ROW.title,
  'pages/history/index': ITEM_ROW.title,
  'pages/following/index': PEER_PROFILE.nickname,
  'pages/saved-searches/index': SAVED_SEARCH.keyword,
  ['pages/detail/index?id=' + ITEM]: ITEM_ROW.title,
  ['pages/seller/index?id=' + PEER]: PEER_PROFILE.nickname,
  ['pages/chat/index?id=' + CONV]: MSGS[0].content,
  'pages/profile/edit': PROFILE.nickname,
  'pages/blocked/index': BLOCKED_PROFILE.nickname,
}

/*
 * The two gated routes that read nothing: an empty publish form and a list of
 * device-local settings toggles. Neither can have a data control. They are
 * named rather than merely absent so that a gated route added later has to be
 * classified instead of silently losing its control.
 */
const NO_SERVER_DATA = new Set(['pages/publish/index', 'pages/settings/index'])

/** Form values are data on screen too — the edit form shows the nickname in an input. */
function renderedContent(page: Page, routePath: string): Promise<string> {
  return page.evaluate((selector) => {
    const shells = document.querySelectorAll(selector)
    const shell = shells[shells.length - 1] as HTMLElement | undefined
    if (!shell) return ''
    const values = [...shell.querySelectorAll('input, textarea')]
      .map(node => (node as HTMLInputElement).value)
      .join('\n')
    return `${shell.innerText}\n${values}`
  }, `uni-page[data-page="${routePath}"]`)
}

/** '' once the control text is on screen; otherwise the last thing that was. */
async function missingControl(page: Page, route: string, control: string, deadlineMs = 15_000): Promise<string> {
  const routePath = route.split('?')[0]
  const deadline = Date.now() + deadlineMs
  let rendered = ''
  while (Date.now() < deadline) {
    rendered = await renderedContent(page, routePath)
    if (rendered.includes(control)) return ''
    await page.waitForTimeout(150)
  }
  return rendered.replace(/\s+/g, ' ').trim().slice(0, 160) || '<nothing rendered>'
}

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
    await page.addInitScript(([ref, uid, gen, th, history]) => {
      localStorage.setItem('welcomed', '1'); localStorage.setItem('lang', 'en')
      localStorage.setItem('theme_pref', th)
      /*
       * Recently-viewed is device-local, not a table, so no fixture can fill
       * it — api/accountLocalPrivacy.ts reads it only while the durable owner
       * marker matches the signed-in account. Without both keys the route
       * renders "No browsing history" and the sweep grades that.
       */
      localStorage.setItem('account_private_storage_owner_v1', uid)
      localStorage.setItem('viewHistory', history)
      localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
        tag: 'caaci-auth-value-v2', generation: gen,
        value: JSON.stringify({ access_token: 'stub', token_type: 'bearer', expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'stub',
          user: { id: uid, email: 'a@illinois.edu', aud: 'authenticated', role: 'authenticated' } }),
      }))
      localStorage.setItem(`sb-${ref}-auth-token-auth-boundary-v2`, JSON.stringify({ v: 2, mode: 'allowed', generation: gen }))
    }, [REF, UID, GEN, theme, JSON.stringify(VIEW_HISTORY)] as const)

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

    /*
     * Warm the dev server before anything is graded. The first navigation
     * also pays for compiling the route chunk, and on a loaded runner that
     * outlasts the per-route deadlines below — so the first route in the list
     * gets reported as empty when it renders perfectly well. Waiting for its
     * shell here spends that cost once, outside every assertion.
     */
    await page.goto(`/#/${GATED[0]}`, { waitUntil: 'networkidle' })
    await page.locator(`uni-page[data-page="${GATED[0].split('?')[0]}"]`).last()
      .waitFor({ state: 'attached', timeout: 120_000 })

    const nameless: string[] = []
    const noHeading: string[] = []
    const contrast: string[] = []
    const noData: string[] = []
    for (const route of GATED) {
      await page.goto(`/#/${route}`, { waitUntil: 'networkidle' })
      /*
       * The control runs first because it is also the strongest "this route
       * has finished assembling" signal there is: its own data is on screen.
       * Snapshotting before it left the heading check racing a cold first
       * route on a loaded runner.
       */
      const control = CONTROL[route]
      if (control) {
        const rendered = await missingControl(page, route, control)
        if (rendered) noData.push(`${route}  expected "${control}", got: ${rendered}`)
      }
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
     * Falsy, not just absent. Every control above reads a property off a
     * fixture row, so renaming that property leaves `CONTROL[route]`
     * undefined and the check below skips the route in silence — the exact
     * blind spot this control exists to close.
     */
    const unclassified = GATED.filter(route => !CONTROL[route] && !NO_SERVER_DATA.has(route))
    expect(unclassified, `gated routes with neither a data control nor a documented reason for not having one:\n${unclassified.join('\n')}`).toEqual([])

    expect(noData, `routes the sweep graded without their data on screen:\n${noData.join('\n')}`).toEqual([])
    expect(noHeading, `logged-in routes with no heading:\n${noHeading.join('\n')}`).toEqual([])
    expect([...new Set(nameless)], `nameless controls:\n${[...new Set(nameless)].join('\n')}`).toEqual([])
    expect([...new Set(contrast)], `contrast failures:\n${[...new Set(contrast)].join('\n')}`).toEqual([])
  })
}
