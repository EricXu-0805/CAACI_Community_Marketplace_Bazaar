// Leading underscore prevents Vercel from treating this test as an API Function.
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { createHash, createHmac } from 'node:crypto'
import { inlineDeploymentBoundaryImport } from './_test-module-loader.mjs'

const API_ROOT = new URL('./', import.meta.url)
const originalFetch = globalThis.fetch
const trackedEnv = [
  'SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_ANON_KEY',
  'VITE_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY',
]
const originalEnv = new Map(trackedEnv.map(key => [key, process.env[key]]))
let nonce = 0

afterEach(() => {
  globalThis.fetch = originalFetch
  for (const key of trackedEnv) {
    const value = originalEnv.get(key)
    if (value == null) delete process.env[key]
    else process.env[key] = value
  }
})

async function load(relativePath, env) {
  for (const key of trackedEnv) delete process.env[key]
  Object.assign(process.env, env)
  const source = await readFile(new URL(relativePath, API_ROOT), 'utf8')
  return import(`data:text/javascript;base64,${Buffer.from(inlineDeploymentBoundaryImport(source)).toString('base64')}#boundary-${nonce++}`)
}

function proxyRequest(path, overrides = {}) {
  return new Request('https://app.test/api/db-proxy', {
    method: 'POST',
    headers: {
      'x-mp-method': 'PATCH',
      'x-mp-path': path,
      apikey: 'anon-key',
      authorization: 'Bearer caller-jwt',
      'content-type': 'application/json',
      ...overrides,
    },
    body: '{}',
  })
}

test('mp PATCH proxy pins the canonical PostgREST path and forwards the caller boundary', async () => {
  const calls = []
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init })
    return new Response(JSON.stringify([{ id: 'ok' }]), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Content-Range': '0-0/*' },
    })
  }
  const { default: handler } = await load('db-proxy.js', {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
  })

  const response = await handler(proxyRequest('/rest/v1/profiles?id=eq.abc&select=id'))

  assert.equal(response.status, 200)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://project.supabase.co/rest/v1/profiles?id=eq.abc&select=id')
  assert.equal(calls[0].init.method, 'PATCH')
  assert.equal(calls[0].init.headers.authorization, 'Bearer caller-jwt')
  assert.equal(calls[0].init.headers.apikey, 'anon-key')
  assert.ok(calls[0].init.signal instanceof AbortSignal)
  assert.equal(calls[0].init.redirect, 'error')
  assert.equal(response.headers.get('content-range'), '0-0/*')
})

test('mp PATCH proxy rejects oversized, malformed, and non-JSON bodies before upstream work', async () => {
  globalThis.fetch = async () => { throw new Error('must not fetch') }
  const { default: handler } = await load('db-proxy.js', {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
  })

  const oversized = await handler(proxyRequest('/rest/v1/profiles?id=eq.abc', {
    'content-length': String(256 * 1024 + 1),
  }))
  assert.equal(oversized.status, 413)
  assert.deepEqual(await oversized.json(), { error: 'body_too_large' })

  const malformed = await handler(new Request('https://app.test/api/db-proxy', {
    method: 'POST',
    headers: {
      'x-mp-method': 'PATCH',
      'x-mp-path': '/rest/v1/profiles?id=eq.abc',
      apikey: 'anon-key',
      authorization: 'Bearer caller-jwt',
      'content-type': 'application/json',
    },
    body: '{',
  }))
  assert.equal(malformed.status, 400)
  assert.deepEqual(await malformed.json(), { error: 'bad_json' })

  const text = await handler(proxyRequest('/rest/v1/profiles?id=eq.abc', {
    'content-type': 'text/plain',
  }))
  assert.equal(text.status, 415)
  assert.deepEqual(await text.json(), { error: 'unsupported_content_type' })
})

for (const path of [
  '/rest/v1/../../auth/v1/user',
  '/rest/v1/%2e%2e/%2e%2e/auth/v1/user',
  '/rest/v1/%2Fauth%2Fv1%2Fuser',
  '/rest/v1/profiles\\..\\auth',
  '/storage/v1/object/item-images',
  'https://evil.test/rest/v1/profiles',
]) {
  test(`mp PATCH proxy rejects retargeting path ${path}`, async () => {
    globalThis.fetch = async () => { throw new Error('must not fetch') }
    const { default: handler } = await load('db-proxy.js', {
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_ANON_KEY: 'anon-key',
    })
    const response = await handler(proxyRequest(path))
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error: 'bad_path' })
  })
}

test('mp PATCH proxy rejects a foreign key or missing caller JWT before upstream work', async () => {
  globalThis.fetch = async () => { throw new Error('must not fetch') }
  const { default: handler } = await load('db-proxy.js', {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
  })

  const wrongKey = await handler(proxyRequest('/rest/v1/profiles?id=eq.abc', { apikey: 'other-key' }))
  assert.equal(wrongKey.status, 401)
  assert.deepEqual(await wrongKey.json(), { error: 'bad_apikey' })

  const noJwt = await handler(proxyRequest('/rest/v1/profiles?id=eq.abc', { authorization: '' }))
  assert.equal(noJwt.status, 401)
  assert.deepEqual(await noJwt.json(), { error: 'auth_required' })
})

const VALID_TOKEN = '11111111-1111-4111-8111-111111111111'

test('unsubscribe GET is read-only and POST fails honestly when service config is absent', async () => {
  globalThis.fetch = async () => { throw new Error('must not fetch') }
  const { default: handler } = await load('unsubscribe.js', {})

  const get = await handler(new Request(`https://app.test/api/unsubscribe?t=${VALID_TOKEN}`))
  assert.equal(get.status, 200)
  assert.match(await get.text(), /Confirm unsubscribe/)

  const post = await handler(new Request(`https://app.test/api/unsubscribe?t=${VALID_TOKEN}`, { method: 'POST' }))
  assert.equal(post.status, 200)
  assert.match(await post.text(), /Unsubscribe failed/)
})

test('unsubscribe POST keeps invalid/no-match tokens indistinguishable and reports real upstream failure', async () => {
  const { default: handler } = await load('unsubscribe.js', {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  })

  globalThis.fetch = async () => { throw new Error('invalid token must not fetch') }
  const invalid = await handler(new Request('https://app.test/api/unsubscribe?t=not-a-token', { method: 'POST' }))
  assert.match(await invalid.text(), /You're unsubscribed/)

  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/rpc/edge_rate_hit')) {
      return new Response(JSON.stringify(true), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ error: 'down' }), { status: 503 })
  }
  const failed = await handler(new Request(`https://app.test/api/unsubscribe?t=${VALID_TOKEN}`, { method: 'POST' }))
  assert.match(await failed.text(), /Unsubscribe failed/)

  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input))
    calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : null })
    if (url.pathname.endsWith('/rpc/edge_rate_hit')) {
      return new Response(JSON.stringify(true), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(null, { status: 204 })
  }
  const noMatchOrSuccess = await handler(new Request(`https://app.test/api/unsubscribe?t=${VALID_TOKEN}`, {
    method: 'POST',
    headers: {
      'x-vercel-forwarded-for': '198.51.100.77',
      'x-forwarded-for': '203.0.113.42',
    },
  }))
  assert.match(await noMatchOrSuccess.text(), /You're unsubscribed/)
  const limiterBodies = calls.filter(call => call.url.pathname.endsWith('/rpc/edge_rate_hit')).map(call => call.body)
  assert.equal(limiterBodies.length, 2)
  assert.match(limiterBodies[1].bucket_in, /^unsubscribe:ip:[0-9a-f]{64}$/)
  assert.doesNotMatch(limiterBodies[1].bucket_in, /198\.51\.100\.77|203\.0\.113\.42/)
  const expectedHmac = createHmac('sha256', 'service-key')
    .update('unsubscribe-ip-v1\0' + '198.51.100.77')
    .digest('hex')
  const plainHash = createHash('sha256').update('198.51.100.77').digest('hex')
  const spoofedHmac = createHmac('sha256', 'service-key')
    .update('unsubscribe-ip-v1\0' + '203.0.113.42')
    .digest('hex')
  assert.equal(limiterBodies[1].bucket_in, `unsubscribe:ip:${expectedHmac}`)
  assert.notEqual(limiterBodies[1].bucket_in, `unsubscribe:ip:${plainHash}`)
  assert.notEqual(limiterBodies[1].bucket_in, `unsubscribe:ip:${spoofedHmac}`)
  assert.equal(calls.filter(call => call.url.pathname === '/rest/v1/profiles').length, 1)
})

test('unsubscribe confirmation pages protect the capability URL and reject method confusion', async () => {
  globalThis.fetch = async () => { throw new Error('must not fetch') }
  const { default: handler } = await load('unsubscribe.js', {})

  const get = await handler(new Request(`https://app.test/api/unsubscribe?t=${VALID_TOKEN}`))
  assert.equal(get.headers.get('referrer-policy'), 'no-referrer')
  assert.equal(get.headers.get('x-frame-options'), 'DENY')
  assert.match(get.headers.get('content-security-policy') || '', /form-action 'self'/)

  const put = await handler(new Request(`https://app.test/api/unsubscribe?t=${VALID_TOKEN}`, { method: 'PUT' }))
  assert.equal(put.status, 405)
  assert.equal(put.headers.get('allow'), 'GET, POST')
})
