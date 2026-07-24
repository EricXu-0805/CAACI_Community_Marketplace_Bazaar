// Leading underscore prevents Vercel from treating this test as an API Function.
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { inlineDeploymentBoundaryImport } from './_test-module-loader.mjs'
import {
  TEST_WECHAT_APP_ID,
  TEST_WECHAT_ENCODING_AES_KEY,
  secureCallbackEnv,
  secureCallbackRequest,
} from './_wechat-callback-test-crypto.mjs'

const API_ROOT = new URL('./', import.meta.url)
const USER_ID = '11111111-1111-4111-8111-111111111111'
const SUPABASE_URL = 'https://supabase.test'
const ENV_KEYS = [
  'WECHAT_APPID', 'WECHAT_APPSECRET', 'WECHAT_PUSH_TOKEN',
  'WECHAT_ENCODING_AES_KEY', 'WECHAT_MEDIA_ASYNC_ENABLED',
  'SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY',
]
const originalEnv = new Map(ENV_KEYS.map(key => [key, process.env[key]]))
const originalFetch = globalThis.fetch
const originalSetTimeout = globalThis.setTimeout
const originalConsoleError = console.error
const originalDateNow = Date.now
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
  Date.now = originalDateNow
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
    WECHAT_APPID: TEST_WECHAT_APP_ID,
    WECHAT_APPSECRET: 'wx-secret',
    WECHAT_PUSH_TOKEN: 'push-token',
    WECHAT_ENCODING_AES_KEY: TEST_WECHAT_ENCODING_AES_KEY,
    WECHAT_MEDIA_ASYNC_ENABLED: 'true',
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

test('media async is fail-closed by default while AppSecret-backed text remains available', async () => {
  const calls = []
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    calls.push(url)
    const common = baseSecResponse(url)
    if (common) return common
    if (url.pathname === '/wxa/msg_sec_check') {
      return json({ errcode: 0, result: { suggest: 'pass' } })
    }
    throw new Error(`unexpected fetch ${url}`)
  }
  const env = configuredEnv()
  delete env.WECHAT_MEDIA_ASYNC_ENABLED
  const { default: handler } = await loadApi('wechat-seccheck.js', env)

  const image = await handler(secRequest({
    kind: 'image',
    media_url: `${SUPABASE_URL}/storage/v1/object/public/item-images/items/${USER_ID}/own.jpg`,
  }))
  assert.equal(image.status, 503)
  assert.deepEqual(await image.json(), { error: 'wechat_media_async_disabled' })
  assert.equal(calls.some(url => url.pathname === '/wxa/media_check_async'), false)
  assert.equal(calls.some(url => url.pathname === '/rest/v1/profiles'), false)

  const text = await handler(secRequest({ kind: 'text', content: 'hello', scene: 4 }))
  assert.equal(text.status, 200)
  assert.deepEqual(await text.json(), { ok: true, suggest: 'pass' })
  assert.equal(calls.some(url => url.pathname === '/wxa/msg_sec_check'), true)
})

test('media enqueue cannot be enabled without a complete security-mode callback configuration', async () => {
  const calls = []
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    calls.push(url)
    const common = baseSecResponse(url)
    if (common) return common
    throw new Error(`unexpected fetch ${url}`)
  }
  const env = configuredEnv()
  delete env.WECHAT_ENCODING_AES_KEY
  const { default: handler } = await loadApi('wechat-seccheck.js', env)
  const image = await handler(secRequest({
    kind: 'image',
    media_url: `${SUPABASE_URL}/storage/v1/object/public/item-images/items/${USER_ID}/own.jpg`,
  }))

  assert.equal(image.status, 503)
  assert.deepEqual(await image.json(), { error: 'wechat_media_async_misconfigured' })
  assert.equal(calls.some(url => url.pathname === '/rest/v1/profiles'), false)
  assert.equal(calls.some(url => url.pathname === '/wxa/media_check_async'), false)
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
      assert.equal(init.redirect, 'manual')
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

async function callbackRequest(token, event, options = {}) {
  return secureCallbackRequest(token, event, options)
}

function callbackEnv(token = 'push-token') {
  return {
    ...secureCallbackEnv(token),
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  }
}

test('plaintext callback is rejected before reading an oversized body', async () => {
  globalThis.fetch = async () => { throw new Error('unauthenticated callback must not fetch') }
  const { default: handler } = await loadApi('wechat-callback.js', callbackEnv())
  const request = await callbackRequest('push-token', { padding: 'x'.repeat(40_000) }, {
    plaintext: true,
  })
  const response = await handler(request)

  assert.equal(response.status, 403)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
})

test('disabled media flag rejects callback POST before body read, claim, or Storage', async () => {
  globalThis.fetch = async () => { throw new Error('disabled callback must not fetch') }
  const env = callbackEnv()
  delete env.WECHAT_MEDIA_ASYNC_ENABLED
  const { default: handler } = await loadApi('wechat-callback.js', env)
  const response = await handler(await callbackRequest('push-token', {
    Event: 'wxa_media_check',
    trace_id: 'trace-disabled',
    result: { suggest: 'risky' },
    padding: 'x'.repeat(40_000),
  }))

  assert.equal(response.status, 503)
  assert.equal(await response.text(), 'media async disabled')
})

test('enabled media callback rejects plaintext mode without reading body or touching upstreams', async () => {
  globalThis.fetch = async () => { throw new Error('plaintext callback must not fetch') }
  const { default: handler } = await loadApi('wechat-callback.js', callbackEnv())
  const response = await handler(await callbackRequest('push-token', {
    trace_id: 'trace-plaintext',
    result: { suggest: 'risky' },
    padding: 'x'.repeat(40_000),
  }, { plaintext: true }))

  assert.equal(response.status, 403)
  assert.equal(await response.text(), 'forbidden')
})

test('enabled media callback rejects missing security-mode secrets before body or upstream work', async () => {
  const logs = []
  console.error = value => logs.push(String(value))
  globalThis.fetch = async () => { throw new Error('misconfigured callback must not fetch') }
  const env = callbackEnv()
  delete env.WECHAT_ENCODING_AES_KEY
  const { default: handler } = await loadApi('wechat-callback.js', env)
  const response = await handler(await callbackRequest('push-token', {
    trace_id: 'trace-missing-key',
    result: { suggest: 'risky' },
  }))

  assert.equal(response.status, 503)
  assert.equal(await response.text(), 'retry')
  assert.deepEqual(logs, ['wechat-callback: secure_callback_configuration_unavailable'])
})

test('security-mode callback rejects a wrong message signature and AppID before any upstream', async () => {
  globalThis.fetch = async () => { throw new Error('unauthenticated callback must not fetch') }
  const { default: handler } = await loadApi('wechat-callback.js', callbackEnv())
  const event = { trace_id: 'trace-auth-boundary', result: { suggest: 'risky' } }

  const wrongSignature = await handler(await callbackRequest('push-token', event, {
    msgSignature: '0'.repeat(40),
  }))
  assert.equal(wrongSignature.status, 403)

  const wrongAppId = await handler(await callbackRequest('push-token', event, {
    appIdSuffix: 'wx0000000000000000',
  }))
  assert.equal(wrongAppId.status, 403)
})

test('security-mode callback rejects duplicate signed query fields and compatibility envelopes', async () => {
  globalThis.fetch = async () => { throw new Error('ambiguous callback must not fetch') }
  const { default: handler } = await loadApi('wechat-callback.js', callbackEnv())
  const event = { trace_id: 'trace-secure-only', result: { suggest: 'risky' } }

  const duplicateBase = await callbackRequest('push-token', event)
  const duplicateUrl = new URL(duplicateBase.url)
  duplicateUrl.searchParams.append('msg_signature', duplicateUrl.searchParams.get('msg_signature'))
  const duplicateSignature = await handler(new Request(duplicateUrl, {
    method: 'POST',
    headers: duplicateBase.headers,
    body: await duplicateBase.text(),
  }))
  assert.equal(duplicateSignature.status, 403)

  const jsonBase = await callbackRequest('push-token', event)
  const jsonEnvelope = await jsonBase.json()
  const compatibleJson = await handler(new Request(jsonBase.url, {
    method: 'POST',
    headers: jsonBase.headers,
    body: JSON.stringify({ ...jsonEnvelope, MsgType: 'event' }),
  }))
  assert.equal(compatibleJson.status, 403)

  const xmlBase = await callbackRequest('push-token', event, { envelopeFormat: 'xml' })
  const compatibleXml = await handler(new Request(xmlBase.url, {
    method: 'POST',
    headers: xmlBase.headers,
    body: (await xmlBase.text()).replace('</xml>', '<MsgType>event</MsgType></xml>'),
  }))
  assert.equal(compatibleXml.status, 403)
})

test('security-mode callback rejects authenticated malformed K=32 padding before any upstream', async () => {
  globalThis.fetch = async () => { throw new Error('invalid ciphertext must not fetch') }
  const { default: handler } = await loadApi('wechat-callback.js', callbackEnv())
  const response = await handler(await callbackRequest('push-token', {
    trace_id: 'trace-bad-padding',
    result: { suggest: 'risky' },
  }, {
    mutateCiphertext(bytes) {
      bytes[bytes.length - 1] ^= 0x01
    },
  }))

  assert.equal(response.status, 403)
  assert.equal(await response.text(), 'forbidden')

  const halfBlockProtocolCiphertext = await handler(await callbackRequest('push-token', {
    trace_id: 'trace-bad-block-size',
    result: { suggest: 'risky' },
  }, { truncateCiphertextBytes: 16 }))
  assert.equal(halfBlockProtocolCiphertext.status, 403)
  assert.equal(await halfBlockProtocolCiphertext.text(), 'forbidden')
})

test('official WeChat security-mode vector passes msg_signature, AES and AppID verification', async () => {
  Date.now = () => 1714112445 * 1000
  globalThis.fetch = async () => { throw new Error('debug vector must stop before upstreams') }
  const { default: handler } = await loadApi('wechat-callback.js', {
    ...callbackEnv('AAAAA'),
    WECHAT_ENCODING_AES_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  })
  const encrypt = '+qdx1OKCy+5JPCBFWw70tm0fJGb2Jmeia4FCB7kao+/Q5c/ohsOzQHi8khUOb05JCpj0JB4RvQMkUyus8TPxLKJGQqcvZqzDpVzazhZv6JsXUnnR8XGT740XgXZUXQ7vJVnAG+tE8NUd4yFyjPy7GgiaviNrlCTj+l5kdfMuFUPpRSrfMZuMcp3Fn2Pede2IuQrKEYwKSqFIZoNqJ4M8EajAsjLY2km32IIjdf8YL/P50F7mStwntrA2cPDrM1kb6mOcfBgRtWygb3VIYnSeOBrebufAlr7F9mFUPAJGj04='
  const request = new Request(
    'https://app.test/api/wechat-callback?timestamp=1714112445&nonce=415670741&encrypt_type=aes&msg_signature=046e02f8204d34f8ba5fa3b1db94908f3df2e9b3',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ToUserName: 'gh_97417a04a28d', Encrypt: encrypt }),
    },
  )
  const response = await handler(request)

  // The official vector decrypts successfully, then stops because debug_demo
  // is intentionally not this endpoint's sole supported wxa_media_check event.
  assert.equal(response.status, 400)
  assert.equal(await response.text(), 'bad request')
})

test('authenticated callback enforces its streamed body limit before upstream work', async () => {
  globalThis.fetch = async () => { throw new Error('oversized callback must not fetch') }
  const { default: handler } = await loadApi('wechat-callback.js', callbackEnv())
  const response = await handler(await callbackRequest('push-token', { padding: 'x'.repeat(40_000) }))

  assert.equal(response.status, 413)
  assert.equal(await response.text(), 'payload too large')
})

test('media callback rejects malformed structure before any durable claim', async () => {
  globalThis.fetch = async () => { throw new Error('invalid event must not fetch') }
  const { default: handler } = await loadApi('wechat-callback.js', callbackEnv())

  const missingTrace = await handler(await callbackRequest('push-token', {
    Event: 'wxa_media_check',
    result: { suggest: 'risky' },
  }))
  assert.equal(missingTrace.status, 400)
  assert.equal(await missingTrace.text(), 'bad request')

  const unknownVerdict = await handler(await callbackRequest('push-token', {
    Event: 'wxa_media_check',
    trace_id: 'trace-unknown',
    result: { suggest: 'unknown' },
  }))
  assert.equal(unknownVerdict.status, 400)
  assert.equal(await unknownVerdict.text(), 'bad request')
})

test('callback upstream timeout is aborted, redirect-disabled, and keeps the event retryable', async () => {
  console.error = () => {}
  globalThis.setTimeout = (fn, _ms, ...args) => originalSetTimeout(fn, 0, ...args)
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname.endsWith('/rpc/claim_wechat_callback_receipt')) return json('claimed')
    if (url.pathname.endsWith('/rpc/release_wechat_callback_receipt')) return json(true)
    assert.equal(init.redirect, 'manual')
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

test('callback handshake rejects timestamps outside the strict past and future windows', async () => {
  const now = 1714112445
  Date.now = () => now * 1000
  globalThis.fetch = async () => { throw new Error('handshake must not fetch') }
  const { default: handler } = await loadApi('wechat-callback.js', callbackEnv())

  const stale = await handler(await callbackRequest('push-token', {}, {
    method: 'GET',
    echostr: 'challenge-a',
    timestamp: String(now - 301),
  }))
  assert.equal(stale.status, 403)

  const future = await handler(await callbackRequest('push-token', {}, {
    method: 'GET',
    echostr: 'challenge-b',
    timestamp: String(now + 61),
  }))
  assert.equal(future.status, 403)

  const oldestAccepted = await handler(await callbackRequest('push-token', {}, {
    method: 'GET',
    echostr: 'challenge-oldest',
    timestamp: String(now - 300),
  }))
  assert.equal(oldestAccepted.status, 200)

  const newestAccepted = await handler(await callbackRequest('push-token', {}, {
    method: 'GET',
    echostr: 'challenge-newest',
    timestamp: String(now + 60),
  }))
  assert.equal(newestAccepted.status, 200)

  const current = await handler(await callbackRequest('push-token', {}, {
    method: 'GET',
    echostr: 'challenge-c',
    timestamp: String(now),
  }))
  assert.equal(current.status, 200)
  assert.equal(await current.text(), 'challenge-c')
})

test('callback canonicalizes one trace across signatures, JSON reordering and XML', async () => {
  const calls = []
  let claimCount = 0
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const body = init.body ? JSON.parse(String(init.body)) : null
    calls.push({ url, body })
    if (url.pathname.endsWith('/rpc/claim_wechat_callback_receipt')) {
      claimCount += 1
      return json(claimCount === 1 ? 'claimed' : 'completed')
    }
    if (url.pathname.endsWith('/rpc/complete_wechat_callback_receipt')) return json(true)
    throw new Error(`unexpected fetch ${url}`)
  }
  const { default: handler } = await loadApi('wechat-callback.js', callbackEnv())
  const now = Math.floor(Date.now() / 1000)
  const firstEvent = {
    Event: 'wxa_media_check',
    trace_id: 'trace-canonical',
    result: { suggest: 'pass', label: 100 },
    provider_extra: 'first',
  }
  const reorderedRaw = JSON.stringify({
    MsgType: 'event',
    appid: TEST_WECHAT_APP_ID,
    version: 2,
    errcode: 0,
    provider_extra: 'changed',
    result: { label: 200, suggest: 'pass' },
    trace_id: 'trace-canonical',
    Event: 'wxa_media_check',
  })
  const first = await handler(await callbackRequest('push-token', firstEvent, {
    timestamp: String(now), nonce: 'nonce-first',
  }))
  const second = await handler(await callbackRequest('push-token', firstEvent, {
    timestamp: String(now + 1), nonce: 'nonce-second', rawBody: reorderedRaw,
  }))
  const third = await handler(await callbackRequest('push-token', firstEvent, {
    timestamp: String(now + 2), nonce: 'nonce-third', messageFormat: 'xml', envelopeFormat: 'xml',
  }))

  assert.equal(first.status, 200)
  assert.equal(second.status, 200)
  assert.equal(third.status, 200)
  const claims = calls.filter(call => call.url.pathname.endsWith('/rpc/claim_wechat_callback_receipt'))
  assert.equal(claims.length, 3)
  assert.equal(claims[0].body.event_key_in, 'wxa_media_check:trace-canonical')
  assert.equal(claims[0].body.event_key_in, claims[1].body.event_key_in)
  assert.equal(claims[0].body.event_key_in, claims[2].body.event_key_in)
  assert.match(claims[0].body.payload_sha256_in, /^[0-9a-f]{64}$/)
  assert.equal(claims[0].body.payload_sha256_in, claims[1].body.payload_sha256_in)
  assert.equal(claims[0].body.payload_sha256_in, claims[2].body.payload_sha256_in)
  assert.notEqual(claims[0].body.callback_timestamp_in, claims[1].body.callback_timestamp_in)
  assert.equal(calls.filter(call => call.url.pathname.endsWith('/rpc/complete_wechat_callback_receipt')).length, 1)
})

test('callback rejects malformed bodies without logging trace, signature, or body data', async () => {
  const logs = []
  console.error = value => logs.push(String(value))
  globalThis.fetch = async () => { throw new Error('invalid event must not fetch') }
  const { default: handler } = await loadApi('wechat-callback.js', callbackEnv())
  const secretBodyMarker = 'private-body-marker-93'
  const request = await callbackRequest('push-token', {
    Event: 'wxa_media_check',
    result: { suggest: 'risky' },
    marker: secretBodyMarker,
  })
  const signature = new URL(request.url).searchParams.get('msg_signature')
  const response = await handler(request)

  assert.equal(response.status, 400)
  assert.deepEqual(logs, [])
  assert.equal(logs.some(line => line.includes(secretBodyMarker)), false)
  assert.equal(logs.some(line => line.includes(signature)), false)
})

test('all WeChat and callback upstreams use the bounded redirect-safe fetch helper', async () => {
  const sec = await readFile(new URL('wechat-seccheck.js', API_ROOT), 'utf8')
  const callback = await readFile(new URL('wechat-callback.js', API_ROOT), 'utf8')

  assert.match(sec, /signal: controller\.signal,[\s\S]*redirect: 'manual'/)
  assert.match(callback, /signal: controller\.signal,[\s\S]*redirect: 'manual'/)
  assert.equal((sec.match(/\bfetch\(/g) || []).length, 1)
  assert.equal((callback.match(/\bfetch\(/g) || []).length, 1)
  assert.match(sec, /MAX_REQUEST_BYTES = 16 \* 1024/)
  assert.match(callback, /MAX_CALLBACK_BYTES = 32 \* 1024/)
  assert.match(sec, /STREAM_TIMEOUT_MS = 5_000/)
  assert.match(callback, /STREAM_TIMEOUT_MS = 5_000/)
})
