// Leading underscore prevents Vercel from treating this test as an API Function.
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { inlineDeploymentBoundaryImport } from './_test-module-loader.mjs'

const API_ROOT = new URL('./', import.meta.url)
const USER_ID = '11111111-1111-4111-8111-111111111111'
const SUPABASE_URL = 'https://supabase.test'
const ENV_KEYS = [
  'WECHAT_APPID', 'WECHAT_APPSECRET', 'WECHAT_PUSH_TOKEN',
  'SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY',
]
const originalEnv = new Map(ENV_KEYS.map(key => [key, process.env[key]]))
const originalFetch = globalThis.fetch
const originalSetTimeout = globalThis.setTimeout
const originalConsoleError = console.error
let importNonce = 0

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key)
    if (value == null) delete process.env[key]
    else process.env[key] = value
  }
  globalThis.fetch = originalFetch
  globalThis.setTimeout = originalSetTimeout
  console.error = originalConsoleError
})

async function loadApi(file, env = {}) {
  for (const key of ENV_KEYS) delete process.env[key]
  Object.assign(process.env, env)
  const source = await readFile(new URL(file, API_ROOT), 'utf8')
  return import(`data:text/javascript;base64,${Buffer.from(inlineDeploymentBoundaryImport(source)).toString('base64')}#wechat-provider-${importNonce++}`)
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function configuredEnv() {
  return {
    WECHAT_APPID: 'wx-app',
    WECHAT_APPSECRET: 'wx-secret',
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    SUPABASE_ANON_KEY: 'anon-key',
  }
}

function secRequest(body) {
  return new Request('https://app.test/api/wechat-seccheck', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer caller-token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function baseSecResponse(url) {
  if (url.pathname === '/auth/v1/user') return json({ id: USER_ID })
  if (url.pathname.endsWith('/rpc/edge_rate_hit')) return json(true)
  if (url.pathname === '/rest/v1/profiles') return json([{ wechat_openid: 'openid_bound_A' }])
  if (url.pathname === '/cgi-bin/stable_token') {
    return json({ access_token: 'wechat-access-token', expires_in: 7200 })
  }
  return null
}

test('fully disabled WeChat integration degrades explicitly after auth without touching limiter or provider', async () => {
  const calls = []
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    calls.push(url)
    if (url.pathname === '/auth/v1/user') return json({ id: USER_ID })
    throw new Error(`unexpected fetch ${url}`)
  }
  const { default: handler } = await loadApi('wechat-seccheck.js', {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    SUPABASE_ANON_KEY: 'anon-key',
  })

  const response = await handler(secRequest({ kind: 'text', content: 'hello', scene: 4 }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    ok: true,
    degraded: true,
    reason: 'not_configured',
  })
  assert.equal(calls.length, 1)
})

test('partial WeChat credentials are a fail-closed misconfiguration, not disabled mode', async () => {
  const calls = []
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    calls.push(url)
    if (url.pathname === '/auth/v1/user') return json({ id: USER_ID })
    throw new Error(`unexpected fetch ${url}`)
  }
  const { default: handler } = await loadApi('wechat-seccheck.js', {
    WECHAT_APPID: 'wx-app',
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    SUPABASE_ANON_KEY: 'anon-key',
  })

  const response = await handler(secRequest({ kind: 'text', content: 'hello', scene: 4 }))
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'wechat_misconfigured' })
  assert.equal(calls.length, 1)
})

test('configured security gate enforces streamed body limit after auth and limiter', async () => {
  const calls = []
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    calls.push(url)
    const common = baseSecResponse(url)
    if (common) return common
    throw new Error(`unexpected fetch ${url}`)
  }
  const { default: handler } = await loadApi('wechat-seccheck.js', configuredEnv())
  const response = await handler(secRequest({ kind: 'text', content: 'x'.repeat(20_000), scene: 4 }))

  assert.equal(response.status, 413)
  assert.deepEqual(await response.json(), { error: 'body_too_large' })
  assert.equal(calls.some(url => url.pathname === '/rest/v1/profiles'), false)
  assert.equal(calls.some(url => url.hostname === 'api.weixin.qq.com'), false)
})

test('configured text gate rejects over-limit content instead of moderating a prefix', async () => {
  const calls = []
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    calls.push(url)
    const common = baseSecResponse(url)
    if (common) return common
    throw new Error(`unexpected fetch ${url}`)
  }
  const { default: handler } = await loadApi('wechat-seccheck.js', configuredEnv())
  const response = await handler(secRequest({ kind: 'text', content: 'x'.repeat(2501), scene: 4 }))

  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: 'content_too_large' })
  assert.equal(calls.some(url => url.pathname === '/rest/v1/profiles'), false)
  assert.equal(calls.some(url => url.pathname === '/wxa/msg_sec_check'), false)
})

for (const [name, tokenResponse] of [
  ['non-2xx', () => json({ error: 'down' }, 503)],
  ['malformed JSON', () => new Response('{', { status: 200 })],
  ['short token', () => json({ access_token: 'short', expires_in: 7200 })],
  ['invalid expiry', () => json({ access_token: 'wechat-access-token', expires_in: '7200' })],
]) {
  test(`configured gate fails closed on ${name} stable_token response`, async () => {
    const calls = []
    globalThis.fetch = async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      calls.push(url)
      if (url.pathname === '/cgi-bin/stable_token') return tokenResponse()
      const common = baseSecResponse(url)
      if (common) return common
      throw new Error(`unexpected fetch ${url}`)
    }
    const { default: handler } = await loadApi('wechat-seccheck.js', configuredEnv())
    const response = await handler(secRequest({ kind: 'text', content: 'hello', scene: 4 }))

    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { error: 'wechat_provider_unavailable' })
    assert.equal(calls.some(url => url.pathname === '/wxa/msg_sec_check'), false)
  })
}

for (const [name, classifierResponse] of [
  ['non-2xx', () => json({ error: 'down' }, 502)],
  ['malformed JSON', () => new Response('{', { status: 200 })],
  ['unknown errcode', () => json({ errcode: 40001, errmsg: 'invalid credential' })],
  ['missing result', () => json({ errcode: 0 })],
  ['unknown verdict', () => json({ errcode: 0, result: { suggest: 'maybe' } })],
]) {
  test(`configured text gate fails closed on ${name} classifier response`, async () => {
    globalThis.fetch = async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.pathname === '/wxa/msg_sec_check') return classifierResponse()
      const common = baseSecResponse(url)
      if (common) return common
      throw new Error(`unexpected fetch ${url}`)
    }
    const { default: handler } = await loadApi('wechat-seccheck.js', configuredEnv())
    const response = await handler(secRequest({ kind: 'text', content: 'hello', scene: 4 }))

    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { error: 'wechat_provider_unavailable' })
  })
}

test('known review verdict is explicit non-pass and never silently allowed', async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname === '/wxa/msg_sec_check') {
      return json({ errcode: 0, result: { suggest: 'review', label: 100 } })
    }
    const common = baseSecResponse(url)
    if (common) return common
    throw new Error(`unexpected fetch ${url}`)
  }
  const { default: handler } = await loadApi('wechat-seccheck.js', configuredEnv())
  const response = await handler(secRequest({ kind: 'text', content: 'hello', scene: 4 }))

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: false, suggest: 'review', label: 100 })
})

for (const [name, mediaResponse] of [
  ['non-2xx', () => json({ error: 'down' }, 502)],
  ['malformed JSON', () => new Response('{', { status: 200 })],
  ['unknown errcode', () => json({ errcode: 40001, trace_id: 'trace-invalid' })],
  ['missing trace', () => json({ errcode: 0 })],
  ['malformed trace', () => json({ errcode: 0, trace_id: '../../victim' })],
]) {
  test(`configured media gate fails closed on ${name} provider response before mapping`, async () => {
    const calls = []
    globalThis.fetch = async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      calls.push(url)
      if (url.pathname === '/wxa/media_check_async') return mediaResponse()
      const common = baseSecResponse(url)
      if (common) return common
      throw new Error(`unexpected fetch ${url}`)
    }
    const { default: handler } = await loadApi('wechat-seccheck.js', configuredEnv())
    const mediaUrl = `${SUPABASE_URL}/storage/v1/object/public/item-images/items/${USER_ID}/own.jpg`
    const response = await handler(secRequest({ kind: 'image', media_url: mediaUrl }))

    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { error: 'wechat_provider_unavailable' })
    assert.equal(calls.some(url => url.pathname === '/rest/v1/wechat_media_checks'), false)
  })
}

test('configured provider timeout is aborted and fails closed', async () => {
  globalThis.setTimeout = (fn, _ms, ...args) => originalSetTimeout(fn, 0, ...args)
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname === '/wxa/msg_sec_check') {
      assert.equal(init.redirect, 'error')
      return await new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      })
    }
    const common = baseSecResponse(url)
    if (common) return common
    throw new Error(`unexpected fetch ${url}`)
  }
  const { default: handler } = await loadApi('wechat-seccheck.js', configuredEnv())
  const response = await handler(secRequest({ kind: 'text', content: 'hello', scene: 4 }))

  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'wechat_provider_unavailable' })
})

test('configured provider response-body stall is bounded and fails closed', async () => {
  globalThis.setTimeout = (fn, _ms, ...args) => originalSetTimeout(fn, 0, ...args)
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname === '/wxa/msg_sec_check') {
      return new Response(new ReadableStream({ start() {} }), { status: 200 })
    }
    const common = baseSecResponse(url)
    if (common) return common
    throw new Error(`unexpected fetch ${url}`)
  }
  const { default: handler } = await loadApi('wechat-seccheck.js', configuredEnv())
  const response = await handler(secRequest({ kind: 'text', content: 'hello', scene: 4 }))

  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'wechat_provider_unavailable' })
})

async function callbackSignature(token, timestamp, nonce) {
  const value = [token, timestamp, nonce].sort().join('')
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function callbackRequest(token, event, options = {}) {
  const timestamp = '1720000000'
  const nonce = 'nonce-a'
  const signature = options.signature || await callbackSignature(token, timestamp, nonce)
  return new Request(
    `https://app.test/api/wechat-callback?signature=${signature}&timestamp=${timestamp}&nonce=${nonce}`,
    {
      method: options.method || 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: options.method === 'GET' ? undefined : JSON.stringify(event),
    },
  )
}

function callbackEnv(token = 'push-token') {
  return {
    WECHAT_PUSH_TOKEN: token,
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  }
}

test('callback authenticates before reading an oversized body', async () => {
  globalThis.fetch = async () => { throw new Error('unauthenticated callback must not fetch') }
  const { default: handler } = await loadApi('wechat-callback.js', callbackEnv())
  const request = await callbackRequest('push-token', { padding: 'x'.repeat(40_000) }, {
    signature: '0'.repeat(40),
  })
  const response = await handler(request)

  assert.equal(response.status, 403)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
})

test('authenticated callback enforces its streamed body limit before upstream work', async () => {
  globalThis.fetch = async () => { throw new Error('oversized callback must not fetch') }
  const { default: handler } = await loadApi('wechat-callback.js', callbackEnv())
  const response = await handler(await callbackRequest('push-token', { padding: 'x'.repeat(40_000) }))

  assert.equal(response.status, 413)
  assert.equal(await response.text(), 'payload too large')
})

test('media callback missing trace or unknown verdict remains retryable', async () => {
  console.error = () => {}
  globalThis.fetch = async () => { throw new Error('invalid callback must not fetch') }
  const { default: handler } = await loadApi('wechat-callback.js', callbackEnv())

  const missingTrace = await handler(await callbackRequest('push-token', {
    Event: 'wxa_media_check',
    result: { suggest: 'risky' },
  }))
  assert.equal(missingTrace.status, 503)
  assert.equal(await missingTrace.text(), 'retry')

  const unknownVerdict = await handler(await callbackRequest('push-token', {
    Event: 'wxa_media_check',
    trace_id: 'trace-unknown',
    result: { suggest: 'unknown' },
  }))
  assert.equal(unknownVerdict.status, 503)
  assert.equal(await unknownVerdict.text(), 'retry')
})

test('callback upstream timeout is aborted, redirect-disabled, and keeps the event retryable', async () => {
  console.error = () => {}
  globalThis.setTimeout = (fn, _ms, ...args) => originalSetTimeout(fn, 0, ...args)
  globalThis.fetch = async (_input, init = {}) => {
    assert.equal(init.redirect, 'error')
    return await new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    })
  }
  const { default: handler } = await loadApi('wechat-callback.js', callbackEnv())
  const response = await handler(await callbackRequest('push-token', {
    Event: 'wxa_media_check',
    trace_id: 'trace-timeout',
    result: { suggest: 'risky' },
  }))

  assert.equal(response.status, 503)
  assert.equal(await response.text(), 'retry')
})

test('callback bounds a stalled Supabase response body and keeps the event retryable', async () => {
  console.error = () => {}
  globalThis.setTimeout = (fn, _ms, ...args) => originalSetTimeout(fn, 0, ...args)
  globalThis.fetch = async () => {
    return new Response(new ReadableStream({ start() {} }), { status: 200 })
  }
  const { default: handler } = await loadApi('wechat-callback.js', callbackEnv())
  const response = await handler(await callbackRequest('push-token', {
    Event: 'wxa_media_check',
    trace_id: 'trace-body-timeout',
    result: { suggest: 'risky' },
  }))

  assert.equal(response.status, 503)
  assert.equal(await response.text(), 'retry')
})

test('all WeChat and callback upstreams use the bounded redirect-safe fetch helper', async () => {
  const sec = await readFile(new URL('wechat-seccheck.js', API_ROOT), 'utf8')
  const callback = await readFile(new URL('wechat-callback.js', API_ROOT), 'utf8')

  assert.match(sec, /signal: controller\.signal,[\s\S]*redirect: 'error'/)
  assert.match(callback, /signal: controller\.signal,[\s\S]*redirect: 'error'/)
  assert.equal((sec.match(/\bfetch\(/g) || []).length, 1)
  assert.equal((callback.match(/\bfetch\(/g) || []).length, 1)
  assert.match(sec, /MAX_REQUEST_BYTES = 16 \* 1024/)
  assert.match(callback, /MAX_CALLBACK_BYTES = 32 \* 1024/)
  assert.match(sec, /STREAM_TIMEOUT_MS = 5_000/)
  assert.match(callback, /STREAM_TIMEOUT_MS = 5_000/)
})
