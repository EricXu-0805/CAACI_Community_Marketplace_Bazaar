// Leading underscore prevents Vercel from treating this test as an API Function.
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { inlineSharedApiImports } from './_test-module-loader.mjs'

const API_ROOT = new URL('./', import.meta.url)
const ITEM_ID = '11111111-1111-4111-8111-111111111111'
const POST_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const ENV_KEYS = [
  'SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_ANON_KEY',
  'SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY',
  'VITE_SUPABASE_ANON_KEY', 'SHARE_SITE_URL', 'DIGEST_APP_URL',
]
const originalEnv = new Map(ENV_KEYS.map(key => [key, process.env[key]]))
const originalFetch = globalThis.fetch
let nonce = 0

afterEach(() => {
  globalThis.fetch = originalFetch
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key)
    if (value == null) delete process.env[key]
    else process.env[key] = value
  }
})

async function load(relativePath) {
  for (const key of ENV_KEYS) delete process.env[key]
  Object.assign(process.env, {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
    SHARE_SITE_URL: 'https://illinimarket.com',
  })
  const source = await readFile(new URL(relativePath, API_ROOT), 'utf8')
  return import(`data:text/javascript;base64,${Buffer.from(inlineSharedApiImports(source)).toString('base64')}#share-${nonce++}`)
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function assertHardenedHtml(response, html) {
  assert.equal(response.status, 200)
  assertHardenedHeaders(response)
  assert.doesNotMatch(html, /https:\/\/attacker\.example/)
}

function assertHardenedHeaders(response) {
  assert.match(response.headers.get('content-security-policy') || '', /default-src 'none'/)
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(response.headers.get('x-frame-options'), 'DENY')
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
}

async function assertHeadMatchesGet(getResponse, headResponse) {
  assert.equal(headResponse.status, getResponse.status)
  assert.equal(headResponse.statusText, getResponse.statusText)
  for (const name of [
    'cache-control',
    'content-security-policy',
    'content-type',
    'referrer-policy',
    'x-content-type-options',
    'x-frame-options',
    'x-robots-tag',
  ]) {
    assert.equal(headResponse.headers.get(name), getResponse.headers.get(name), `${name} drifted`)
  }
  assert.equal(await headResponse.text(), '')
}

test('item share reads the visibility view, escapes content, pins canonical origin, and rejects image schemes', async () => {
  const calls = []
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    calls.push(url)
    assert.equal(url.pathname, '/rest/v1/items_visible')
    return json([{
      id: ITEM_ID,
      title: '\"><script>alert(1)</script>',
      description: '<img src=x onerror=alert(2)>',
      price: 10,
      images: ['javascript:alert(3)'],
      listing_type: 'sell',
    }])
  }
  const { default: handler } = await load('share.js')
  const requestUrl = `https://attacker.example/api/share?id=${ITEM_ID}`

  const response = await handler(new Request(requestUrl))
  const html = await response.text()
  const headResponse = await handler(new Request(requestUrl, { method: 'HEAD' }))

  assertHardenedHtml(response, html)
  await assertHeadMatchesGet(response, headResponse)
  assert.equal(calls.length, 2)
  for (const call of calls) assert.equal(call.searchParams.get('id'), `eq.${ITEM_ID}`)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(html, /&lt;img src=x onerror=alert\(2\)&gt;/)
  assert.doesNotMatch(html, /<script|javascript:/i)
  assert.match(html, new RegExp(`https://illinimarket\\.com/#/pages/detail/index\\?id=${ITEM_ID}`))
  assert.match(html, /https:\/\/illinimarket\.com\/static\/app-icon-512\.png/)
})

/**
 * items_visible hides only 'deleted', so a sold or reserved listing unfurls
 * from this endpoint too. Before this, the card for a sold item was
 * byte-identical to an on-sale one — forwarding it to a group chat sent
 * several people after something already gone.
 */
test('a share card says when the listing is no longer on sale', async () => {
  const { default: handler } = await load('share.js')
  const selects = []
  async function unfurl(status) {
    globalThis.fetch = async (input) => {
      selects.push(new URL(String(input)).searchParams.get('select') || '')
      return json([{
        id: ITEM_ID, title: 'Desk lamp', description: 'Barely used', price: 15,
        images: [], listing_type: 'sell', status,
      }])
    }
    const html = await (await handler(new Request(`https://illinimarket.com/api/share?id=${ITEM_ID}`))).text()
    return html.match(/<meta property="og:title" content="([^"]*)"/)[1]
  }

  const [active, reserved, sold] = [await unfurl('active'), await unfurl('reserved'), await unfurl('sold')]

  assert.match(sold, /已售出 \/ Sold/, 'a sold listing unfurled as if it were on sale')
  assert.match(reserved, /已预定 \/ Reserved/, 'a reserved listing unfurled as if it were on sale')
  // The control: an on-sale listing must NOT be labelled, or the assertions
  // above are satisfied by a card that says "sold" about everything.
  assert.doesNotMatch(active, /Sold|Reserved|已售出|已预定/)
  for (const label of [sold, reserved, active]) assert.match(label, /Desk lamp · \$15/)
  // The status has to be read from the row, not guessed.
  for (const select of selects) assert.match(select, /(^|,)status(,|$)/)
})

test('post share uses posts_visible before a separate public author lookup', async () => {
  const calls = []
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    calls.push(url)
    if (url.pathname === '/rest/v1/posts_visible') {
      return json([{
        id: POST_ID,
        user_id: USER_ID,
        content: '<b>unsafe post</b>',
        images: ['https://project.supabase.co/storage/v1/object/public/post-images/safe.jpg'],
      }])
    }
    if (url.pathname === '/rest/v1/profiles') {
      return json([{ nickname: '\"><script>author()</script>' }])
    }
    throw new Error(`unexpected fetch ${url}`)
  }
  const { default: handler } = await load('share-post.js')
  const requestUrl = `https://attacker.example/api/share-post?id=${POST_ID}`

  const response = await handler(new Request(requestUrl))
  const html = await response.text()
  const headResponse = await handler(new Request(requestUrl, { method: 'HEAD' }))

  assertHardenedHtml(response, html)
  await assertHeadMatchesGet(response, headResponse)
  assert.deepEqual(calls.map(call => call.pathname), [
    '/rest/v1/posts_visible',
    '/rest/v1/profiles',
    '/rest/v1/posts_visible',
    '/rest/v1/profiles',
  ])
  assert.match(html, /&lt;b&gt;unsafe post&lt;\/b&gt;/)
  assert.match(html, /&lt;script&gt;author\(\)&lt;\/script&gt;/)
  assert.doesNotMatch(html, /<script/i)
  assert.match(html, /https:\/\/project\.supabase\.co\/storage\/v1\/object\/public\/post-images\/safe\.jpg/)
})

for (const endpoint of ['share.js', 'share-post.js']) {
  const route = endpoint === 'share.js' ? 'share' : 'share-post'
  const id = endpoint === 'share.js' ? ITEM_ID : POST_ID

  test(`${endpoint} keeps missing-id HEAD status and headers aligned with GET`, async () => {
    globalThis.fetch = async () => { throw new Error('must not fetch') }
    const { default: handler } = await load(endpoint)
    const url = `https://illinimarket.com/api/${route}`
    const getResponse = await handler(new Request(url))
    const headResponse = await handler(new Request(url, { method: 'HEAD' }))
    await assertHeadMatchesGet(getResponse, headResponse)
  })

  test(`${endpoint} keeps missing-resource HEAD status and headers aligned with GET`, async () => {
    let calls = 0
    globalThis.fetch = async () => {
      calls += 1
      return json([])
    }
    const { default: handler } = await load(endpoint)
    const url = `https://illinimarket.com/api/${route}?id=${id}`
    const getResponse = await handler(new Request(url))
    const headResponse = await handler(new Request(url, { method: 'HEAD' }))
    await assertHeadMatchesGet(getResponse, headResponse)
    assert.equal(calls, 2)
  })

  test(`${endpoint} rejects unsupported methods before database work`, async () => {
    globalThis.fetch = async () => { throw new Error('must not fetch') }
    const { default: handler } = await load(endpoint)
    const response = await handler(new Request('https://illinimarket.com/api/share', { method: 'POST' }))
    assert.equal(response.status, 405)
    assert.equal(response.headers.get('allow'), 'GET, HEAD')
    assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0')
  })
}

test('upstream errors and malformed rows fail to the generic share surface', async () => {
  globalThis.fetch = async () => new Response('{not-json', { status: 200 })
  const { default: handler } = await load('share.js')
  const response = await handler(new Request(`https://illinimarket.com/api/share?id=${ITEM_ID}`))
  const meta = metaOf(await response.text())
  assert.equal(meta.title, 'Illini Market · 校园二手交易')
  assert.equal(meta.description, 'UIUC 校园二手交易平台')
})

test('share preview bounds public query responses and fails to the generic surface', async () => {
  globalThis.fetch = async () => new Response(null, {
    status: 200,
    headers: { 'Content-Length': String(64 * 1024 + 1) },
  })
  const { default: handler } = await load('share.js')
  const response = await handler(new Request(`https://illinimarket.com/api/share?id=${ITEM_ID}`))
  const meta = metaOf(await response.text())

  assert.equal(meta.title, 'Illini Market · 校园二手交易')
  assert.equal(meta.description, 'UIUC 校园二手交易平台')
})

const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

function stubRow(id, extra) {
  return async (input) => {
    const url = new URL(String(input))
    if (url.pathname === '/rest/v1/profiles') return json([{ nickname: 'A' }])
    return json([{
      id, user_id: USER_ID, title: 'Desk lamp', content: 'c', description: 'd',
      price: 15, images: [], listing_type: 'sell', status: 'active', ...extra,
    }])
  }
}

function metaOf(html) {
  const pick = re => (html.match(re) || [])[1]
  return {
    html,
    title: pick(/<meta property="og:title" content="([^"]*)"/),
    description: pick(/<meta property="og:description" content="([^"]*)"/),
    canonical: pick(/<link rel="canonical" href="([^"]*)"/),
    ogUrl: pick(/<meta property="og:url" content="([^"]*)"/),
    refresh: pick(/<meta http-equiv="refresh" content="0; url=([^"]*)"/),
  }
}

/**
 * items.price is DECIMAL(10,2) and PostgREST hands it over as a JSON number,
 * so 18.50 arrives as 18.5 and a bare template literal printed "$18.5" —
 * while the app's own formatPrice renders "$18.50". The card follows the
 * app's two-decimal rule.
 */
test('item share prices carry cents the way the app renders them', async () => {
  const { default: handler } = await load('share.js')
  async function titleFor(extra) {
    globalThis.fetch = stubRow(ITEM_ID, extra)
    const html = await (await handler(new Request(`https://illinimarket.com/api/share?id=${ITEM_ID}`))).text()
    return metaOf(html).title
  }

  assert.match(await titleFor({ price: 18.5 }), /Desk lamp · \$18\.50$/, 'trailing cent dropped')
  assert.match(await titleFor({ price: 1234.5 }), /Desk lamp · \$1,234\.50$/, 'thousands or cents drifted from the app')
  assert.match(await titleFor({ price: 18.5, listing_type: 'wanted' }), /求购预算 \$18\.50$/)
  // Whole dollars stay bare: the fix must not be "always two decimals".
  assert.match(await titleFor({ price: 18 }), /Desk lamp · \$18$/)
})

for (const endpoint of ['share.js', 'share-post.js']) {
  const route = endpoint === 'share.js' ? 'share' : 'share-post'
  const page = endpoint === 'share.js' ? 'detail' : 'post'
  const id = endpoint === 'share.js' ? ITEM_ID : POST_ID

  /**
   * String#slice counts UTF-16 code units. An emoji is two, so a description
   * cut at 160 could keep only its first half and emit a lone surrogate, which
   * the response encoder turns into U+FFFD — a "�" on every unfurl of that card.
   */
  test(`${endpoint} never cuts the description inside an emoji`, async () => {
    const { default: handler } = await load(endpoint)
    async function describe(text) {
      globalThis.fetch = stubRow(id, { content: text, description: text })
      return metaOf(await (await handler(new Request(`https://illinimarket.com/api/${route}?id=${id}`))).text())
    }

    // 159 ASCII units then a two-unit emoji: a cut at 160 lands between its halves.
    const straddling = await describe('x'.repeat(159) + '\u{1F525}' + 'tail')
    assert.doesNotMatch(straddling.html, LONE_SURROGATE_RE, 'a lone surrogate reached the HTML')
    assert.doesNotMatch(straddling.html, /�/, 'the cut split an emoji and the encoder replaced the half with U+FFFD')
    assert.equal(straddling.description, 'x'.repeat(159))

    // Control: an emoji that fits entirely (units 158-159) must survive intact,
    // or the assertions above are satisfied by stripping every emoji.
    const fitting = await describe('x'.repeat(158) + '\u{1F525}' + 'tail')
    assert.equal(fitting.description, 'x'.repeat(158) + '\u{1F525}')
    assert.doesNotMatch(fitting.html, /�/)
  })

  /**
   * The apex 308-redirects to www, so a canonical / og:url / meta-refresh on
   * the configured apex origin costs every share click an extra hop. When the
   * request arrived on the www form of the configured host, that is the site.
   */
  test(`${endpoint} canonical follows the www host the request arrived on`, async () => {
    const { default: handler } = await load(endpoint)
    async function canonicalFor(origin) {
      globalThis.fetch = stubRow(id, {})
      return metaOf(await (await handler(new Request(`${origin}/api/${route}?id=${id}`))).text())
    }

    const www = await canonicalFor('https://www.illinimarket.com')
    const expected = `https://www.illinimarket.com/#/pages/${page}/index?id=${id}`
    assert.equal(www.canonical, expected, 'canonical points at the apex, which 308s back to www')
    assert.equal(www.ogUrl, expected)
    assert.equal(www.refresh, expected)

    // Controls: no other request host may leak into the canonical — the
    // configured origin wins for the apex itself, an unrelated www host, and
    // a plain-http www.
    for (const origin of ['https://illinimarket.com', 'https://www.attacker.example', 'http://www.illinimarket.com']) {
      const other = await canonicalFor(origin)
      assert.equal(other.canonical, `https://illinimarket.com/#/pages/${page}/index?id=${id}`, `${origin} leaked into the canonical`)
      assert.equal(other.ogUrl, other.canonical)
      assert.equal(other.refresh, other.canonical)
    }
  })
}

// Mirrors the items.source_lang whitelist from migration 015.
const DOCUMENT_LANGS = new Set(['zh', 'en', 'ja', 'ko', 'zh-Hant'])

function htmlLangOf(markup) {
  const tag = (markup.match(/<html\b[^>]*>/i) || [])[0]
  if (!tag) return null
  const attr = tag.match(/\slang="([^"]*)"/)
  return attr ? attr[1] : null
}

/**
 * items_visible drops deleted listings, so a forwarded link to one reads back
 * nothing. Every one of those used to point at the site root: whoever tapped
 * the link landed on the home page with nothing to tell them the listing was
 * gone, while the detail route has an "Item not available" screen for exactly
 * this case.
 */
test('a share link whose listing is gone lands on the detail route, not the home page', async () => {
  const { default: handler } = await load('share.js')
  async function share(query) {
    globalThis.fetch = async () => json([])
    return metaOf(await (await handler(new Request(`https://illinimarket.com/api/share${query}`))).text())
  }

  const detail = `https://illinimarket.com/#/pages/detail/index?id=${ITEM_ID}`
  const missing = await share(`?id=${ITEM_ID}`)
  assert.equal(missing.canonical, detail, 'a deleted listing dropped the reader on the home page')
  assert.equal(missing.ogUrl, detail)
  assert.equal(missing.refresh, detail)
  // The card still must not invent a listing it could not read.
  assert.equal(missing.title, 'Illini Market · 校园二手交易')

  // Control: with no listing named there is nothing to explain, so the root
  // stays the destination — the fix is not "always append a detail route".
  for (const query of ['', '?id=not-a-uuid']) {
    const rootward = await share(query)
    assert.equal(rootward.canonical, 'https://illinimarket.com', `${query || '(no id)'} invented a detail route`)
    assert.equal(rootward.ogUrl, 'https://illinimarket.com')
    assert.equal(rootward.refresh, 'https://illinimarket.com')
  }
})

/**
 * The interstitial hardcoded lang="zh" while carrying the listing's own title
 * and description, so an English listing was announced in a Chinese voice and
 * offered for translation out of a language it was never written in.
 * items.source_lang records what the seller actually typed.
 */
test('the share interstitial declares the language the listing was written in', async () => {
  const { default: handler } = await load('share.js')
  const selects = []
  async function langFor(sourceLang) {
    globalThis.fetch = async (input) => {
      selects.push(new URL(String(input)).searchParams.get('select') || '')
      return json([{
        id: ITEM_ID, title: 'Desk lamp', description: 'Barely used', price: 15,
        images: [], listing_type: 'sell', status: 'active', source_lang: sourceLang,
      }])
    }
    return htmlLangOf(await (await handler(new Request(`https://illinimarket.com/api/share?id=${ITEM_ID}`))).text())
  }

  assert.equal(await langFor('en'), 'en', 'an English listing was still declared Chinese')
  assert.equal(await langFor('ja'), 'ja')
  // Control: the Chinese case has to keep saying zh, or a blanket 'en' passes.
  assert.equal(await langFor('zh'), 'zh')
  // Unsupported or hostile values fall back instead of reaching the attribute.
  for (const value of [null, undefined, 'de', 'en" onload="alert(1)']) {
    assert.equal(await langFor(value), 'zh', `${value} reached the lang attribute`)
  }
  assert.ok(selects.length > 0)
  for (const select of selects) assert.match(select, /(^|,)source_lang(,|$)/)
})

/**
 * The SPA shell shipped a bare <html>, so every page that is not a share
 * interstitial handed assistive technology and translation tools no language
 * at all.
 */
test('the app shell declares a language', async () => {
  const shell = await readFile(new URL('../app/index.html', API_ROOT), 'utf8')
  const lang = htmlLangOf(shell)
  assert.ok(lang && DOCUMENT_LANGS.has(lang), `app/index.html declares no supported lang (got ${lang})`)
  // Control: a shell without the attribute has to be visible as such here.
  assert.equal(htmlLangOf('<!DOCTYPE html>\n<html>\n<head></head>\n</html>'), null)
})
