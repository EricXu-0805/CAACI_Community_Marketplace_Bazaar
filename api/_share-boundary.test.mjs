// Leading underscore prevents Vercel from treating this test as an API Function.
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { inlineDeploymentBoundaryImport } from './_test-module-loader.mjs'

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
  return import(`data:text/javascript;base64,${Buffer.from(inlineDeploymentBoundaryImport(source)).toString('base64')}#share-${nonce++}`)
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function assertHardenedHtml(response, html) {
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-security-policy') || '', /default-src 'none'/)
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(response.headers.get('x-frame-options'), 'DENY')
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
  assert.doesNotMatch(html, /https:\/\/attacker\.example/)
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

  const response = await handler(new Request(`https://attacker.example/api/share?id=${ITEM_ID}`))
  const html = await response.text()

  assertHardenedHtml(response, html)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].searchParams.get('id'), `eq.${ITEM_ID}`)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(html, /&lt;img src=x onerror=alert\(2\)&gt;/)
  assert.doesNotMatch(html, /<script|javascript:/i)
  assert.match(html, new RegExp(`https://illinimarket\\.com/#/pages/detail/index\\?id=${ITEM_ID}`))
  assert.match(html, /https:\/\/illinimarket\.com\/static\/app-icon-512\.png/)
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

  const response = await handler(new Request(`https://attacker.example/api/share-post?id=${POST_ID}`))
  const html = await response.text()

  assertHardenedHtml(response, html)
  assert.deepEqual(calls.map(call => call.pathname), [
    '/rest/v1/posts_visible',
    '/rest/v1/profiles',
  ])
  assert.match(html, /&lt;b&gt;unsafe post&lt;\/b&gt;/)
  assert.match(html, /&lt;script&gt;author\(\)&lt;\/script&gt;/)
  assert.doesNotMatch(html, /<script/i)
  assert.match(html, /https:\/\/project\.supabase\.co\/storage\/v1\/object\/public\/post-images\/safe\.jpg/)
})

for (const endpoint of ['share.js', 'share-post.js']) {
  test(`${endpoint} rejects non-GET requests before database work`, async () => {
    globalThis.fetch = async () => { throw new Error('must not fetch') }
    const { default: handler } = await load(endpoint)
    const response = await handler(new Request('https://illinimarket.com/api/share', { method: 'POST' }))
    assert.equal(response.status, 405)
    assert.equal(response.headers.get('allow'), 'GET')
  })
}

test('upstream errors and malformed rows fail to the generic share surface', async () => {
  globalThis.fetch = async () => new Response('{not-json', { status: 200 })
  const { default: handler } = await load('share.js')
  const response = await handler(new Request(`https://illinimarket.com/api/share?id=${ITEM_ID}`))
  const html = await response.text()
  assert.match(html, /Illini Market · 校园二手交易/)
  assert.doesNotMatch(html, /pages\/detail/)
})

test('share preview bounds public query responses and fails to the generic surface', async () => {
  globalThis.fetch = async () => new Response(null, {
    status: 200,
    headers: { 'Content-Length': String(64 * 1024 + 1) },
  })
  const { default: handler } = await load('share.js')
  const response = await handler(new Request(`https://illinimarket.com/api/share?id=${ITEM_ID}`))
  const html = await response.text()

  assert.match(html, /Illini Market · 校园二手交易/)
  assert.doesNotMatch(html, /pages\/detail/)
})
