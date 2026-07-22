// Leading underscore prevents Vercel from treating this test as an API Function.
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { inlineDeploymentBoundaryImport } from './_test-module-loader.mjs'

const API_ROOT = new URL('./', import.meta.url)
const USER_ID = '11111111-1111-4111-8111-111111111111'
const MEETUP_ID = '22222222-2222-4222-8222-222222222222'
const ENV_KEYS = [
  'SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY', 'OPENAI_API_KEY',
  'WECHAT_APPID', 'WECHAT_APPSECRET', 'WECHAT_PUSH_TOKEN', 'WECHAT_ENCODING_AES_KEY',
  'WECHAT_MEDIA_ASYNC_ENABLED', 'RESEND_API_KEY',
  'DIGEST_TEST_EMAIL', 'DIGEST_LIVE',
  'NOMINATIM_BASE_URL',
]
const originalEnv = new Map(ENV_KEYS.map(key => [key, process.env[key]]))
const originalFetch = globalThis.fetch
let importNonce = 0

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key)
    if (value == null) delete process.env[key]
    else process.env[key] = value
  }
  globalThis.fetch = originalFetch
})

async function loadApi(filename, env) {
  for (const key of ENV_KEYS) delete process.env[key]
  Object.assign(process.env, env)
  const source = await readFile(new URL(filename, API_ROOT), 'utf8')
  const encoded = Buffer.from(inlineDeploymentBoundaryImport(source)).toString('base64')
  return import(`data:text/javascript;base64,${encoded}#rate-boundary-${importNonce++}`)
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function urlOf(input) {
  return new URL(input instanceof Request ? input.url : String(input))
}

const supabaseEnv = {
  SUPABASE_URL: 'https://supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  SUPABASE_ANON_KEY: 'anon-key',
}

const malformedLimiterResponses = [
  ['object', () => json({ allowed: true })],
  ['null', () => json(null)],
  ['invalid JSON', () => new Response('not-json', { status: 200 })],
]

test('translation authenticates even empty payloads before returning a success fallback', async () => {
  globalThis.fetch = async () => { throw new Error('unauthorized request must not reach upstream') }
  const { default: handler } = await loadApi('translate.js', supabaseEnv)

  const response = await handler(new Request('https://app.test/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '', target: 'zh' }),
  }))

  assert.equal(response.status, 401)
  assert.deepEqual(await response.json(), { error: 'auth_required' })
})

test('anonymous geocoder fails closed without calling Nominatim when its limiter is unavailable', async () => {
  const calls = []
  globalThis.fetch = async (input) => {
    const url = urlOf(input)
    calls.push(url)
    if (url.pathname.endsWith('/rpc/edge_rate_hit')) return json({ error: 'down' }, 503)
    throw new Error(`unexpected fetch ${url}`)
  }
  const { default: handler } = await loadApi('geocode.js', supabaseEnv)

  const response = await handler(new Request('https://app.test/api/geocode?lat=40.11&lon=-88.23', {
    headers: { 'x-forwarded-for': '203.0.113.9' },
  }))

  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'rate_limit_unavailable' })
  assert.equal(calls.some(url => url.hostname === 'nominatim.openstreetmap.org'), false)
})

for (const [responseKind, limiterResponse] of malformedLimiterResponses) {
  test(`anonymous geocoder rejects a 200 ${responseKind} limiter response`, async () => {
    const calls = []
    globalThis.fetch = async (input) => {
      const url = urlOf(input)
      calls.push(url)
      if (url.pathname.endsWith('/rpc/edge_rate_hit')) return limiterResponse()
      throw new Error(`unexpected fetch ${url}`)
    }
    const { default: handler } = await loadApi('geocode.js', supabaseEnv)

    const response = await handler(new Request('https://app.test/api/geocode?lat=40.11&lon=-88.23', {
      headers: { 'x-forwarded-for': '203.0.113.9' },
    }))

    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { error: 'rate_limit_unavailable' })
    assert.equal(calls.some(url => url.hostname === 'nominatim.openstreetmap.org'), false)
  })
}

test('anonymous geocoder pseudonymizes the network key and enforces a shared one-per-second provider gate', async () => {
  const limiterBodies = []
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    const url = urlOf(input)
    calls.push(url)
    if (url.pathname.endsWith('/rpc/edge_rate_hit')) {
      limiterBodies.push(JSON.parse(init.body))
      return json(true)
    }
    if (url.hostname === 'geo.example.test') {
      return json({
        address: { road: 'Green Street', city: 'Champaign', injected: '<script>alert(1)</script>' },
        display_name: 'Green Street',
      })
    }
    throw new Error(`unexpected fetch ${url}`)
  }
  const { default: handler } = await loadApi('geocode.js', {
    ...supabaseEnv,
    NOMINATIM_BASE_URL: 'https://geo.example.test/nominatim/',
  })

  const response = await handler(new Request('https://app.test/api/geocode?lat=40.1100019&lon=-88.2300019', {
    headers: { 'x-vercel-forwarded-for': '203.0.113.9' },
  }))

  assert.equal(response.status, 200)
  assert.match(response.headers.get('cache-control') || '', /no-store/)
  assert.doesNotMatch(response.headers.get('cache-control') || '', /public|s-maxage/i)
  assert.equal(response.headers.get('vercel-cdn-cache-control'), 'no-store')
  assert.equal(limiterBodies.length, 2)
  assert.match(limiterBodies[0].bucket_in, /^geocode:network:[a-f0-9]{64}$/)
  assert.equal(JSON.stringify(limiterBodies).includes('203.0.113.9'), false)
  assert.deepEqual(limiterBodies[1], {
    bucket_in: 'geocode:global:nominatim',
    max_in: 1,
    window_secs_in: 1,
  })
  const provider = calls.find(url => url.hostname === 'geo.example.test')
  assert.ok(provider)
  assert.equal(provider.pathname, '/nominatim/reverse')
  assert.equal(provider.searchParams.get('lat'), '40.110')
  assert.equal(provider.searchParams.get('lon'), '-88.230')
  assert.equal(provider.searchParams.get('zoom'), '16')
  assert.deepEqual(await response.json(), {
    address: { road: 'Green Street', city: 'Champaign' },
    display_name: 'Green Street',
  })
})

test('anonymous geocoder does not call its provider when the application-wide gate is full', async () => {
  let limiterCall = 0
  const calls = []
  globalThis.fetch = async (input) => {
    const url = urlOf(input)
    calls.push(url)
    if (url.pathname.endsWith('/rpc/edge_rate_hit')) {
      limiterCall += 1
      return json(limiterCall === 1)
    }
    throw new Error(`unexpected fetch ${url}`)
  }
  const { default: handler } = await loadApi('geocode.js', supabaseEnv)

  const response = await handler(new Request('https://app.test/api/geocode?lat=40.11&lon=-88.23', {
    headers: { 'x-vercel-forwarded-for': '203.0.113.9' },
  }))

  assert.equal(response.status, 429)
  assert.equal(response.headers.get('Retry-After'), '1')
  assert.deepEqual(await response.json(), { error: 'rate_limited' })
  assert.equal(calls.some(url => url.hostname === 'nominatim.openstreetmap.org'), false)
})

for (const endpoint of ['translate.js', 'moderate.js']) {
  test(`${endpoint} keeps its no-provider fallback without depending on the limiter`, async () => {
    const calls = []
    globalThis.fetch = async (input) => {
      const url = urlOf(input)
      calls.push(url)
      if (url.pathname === '/auth/v1/user') return json({ id: USER_ID })
      throw new Error(`unexpected fetch ${url}`)
    }
    const { default: handler } = await loadApi(endpoint, supabaseEnv)
    const body = endpoint === 'translate.js'
      ? { text: 'desk lamp', target: 'zh' }
      : { text: 'desk lamp' }

    const response = await handler(new Request(`https://app.test/api/${endpoint.slice(0, -3)}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }))

    assert.equal(response.status, 200)
    assert.equal((await response.json()).reason, 'no_key')
    assert.equal(calls.some(url => url.pathname.endsWith('/rpc/edge_rate_hit')), false)
  })

  test(`${endpoint} fails closed before its paid provider when the limiter is unavailable`, async () => {
    const calls = []
    globalThis.fetch = async (input) => {
      const url = urlOf(input)
      calls.push(url)
      if (url.pathname === '/auth/v1/user') return json({ id: USER_ID })
      if (url.pathname.endsWith('/rpc/edge_rate_hit')) return json({ error: 'down' }, 503)
      throw new Error(`unexpected fetch ${url}`)
    }
    const { default: handler } = await loadApi(endpoint, {
      ...supabaseEnv,
      OPENAI_API_KEY: 'openai-test-key',
    })
    const body = endpoint === 'translate.js'
      ? { text: 'desk lamp', target: 'zh' }
      : { text: 'desk lamp' }

    const response = await handler(new Request(`https://app.test/api/${endpoint.slice(0, -3)}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }))

    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { error: 'rate_limit_unavailable' })
    assert.equal(calls.some(url => url.hostname === 'api.openai.com'), false)
  })

  for (const [responseKind, limiterResponse] of malformedLimiterResponses) {
    test(`${endpoint} rejects a 200 ${responseKind} limiter response`, async () => {
      const calls = []
      globalThis.fetch = async (input) => {
        const url = urlOf(input)
        calls.push(url)
        if (url.pathname === '/auth/v1/user') return json({ id: USER_ID })
        if (url.pathname.endsWith('/rpc/edge_rate_hit')) return limiterResponse()
        throw new Error(`unexpected fetch ${url}`)
      }
      const { default: handler } = await loadApi(endpoint, {
        ...supabaseEnv,
        OPENAI_API_KEY: 'openai-test-key',
      })
      const body = endpoint === 'translate.js'
        ? { text: 'desk lamp', target: 'zh' }
        : { text: 'desk lamp' }

      const response = await handler(new Request(`https://app.test/api/${endpoint.slice(0, -3)}`, {
        method: 'POST',
        headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }))

      assert.equal(response.status, 503)
      assert.deepEqual(await response.json(), { error: 'rate_limit_unavailable' })
      assert.equal(calls.some(url => url.hostname === 'api.openai.com'), false)
    })
  }
}

test('meetup email fails closed before any recipient lookup or Resend call when its limiter is unavailable', async () => {
  const calls = []
  globalThis.fetch = async (input) => {
    const url = urlOf(input)
    calls.push(url)
    if (url.pathname === '/auth/v1/user') return json({ id: USER_ID })
    if (url.pathname.endsWith('/rpc/edge_rate_hit')) return json({ error: 'down' }, 503)
    throw new Error(`unexpected fetch ${url}`)
  }
  const { default: handler } = await loadApi('meetup-notify.js', {
    ...supabaseEnv,
    RESEND_API_KEY: 'resend-key',
    DIGEST_TEST_EMAIL: 'sink@example.com',
  })

  const response = await handler(new Request('https://app.test/api/meetup-notify', {
    method: 'POST',
    headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ meetup_id: MEETUP_ID }),
  }))

  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'rate_limit_unavailable' })
  assert.equal(calls.some(url => url.pathname === '/rest/v1/meetups'), false)
  assert.equal(calls.some(url => url.hostname === 'api.resend.com'), false)
})

for (const [responseKind, limiterResponse] of malformedLimiterResponses) {
  test(`meetup email rejects a 200 ${responseKind} limiter response`, async () => {
    const calls = []
    globalThis.fetch = async (input) => {
      const url = urlOf(input)
      calls.push(url)
      if (url.pathname === '/auth/v1/user') return json({ id: USER_ID })
      if (url.pathname.endsWith('/rpc/edge_rate_hit')) return limiterResponse()
      throw new Error(`unexpected fetch ${url}`)
    }
    const { default: handler } = await loadApi('meetup-notify.js', {
      ...supabaseEnv,
      RESEND_API_KEY: 'resend-key',
      DIGEST_TEST_EMAIL: 'sink@example.com',
    })

    const response = await handler(new Request('https://app.test/api/meetup-notify', {
      method: 'POST',
      headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ meetup_id: MEETUP_ID }),
    }))

    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { error: 'rate_limit_unavailable' })
    assert.equal(calls.some(url => url.pathname === '/rest/v1/meetups'), false)
    assert.equal(calls.some(url => url.hostname === 'api.resend.com'), false)
  })
}

test('an inert meetup email deployment skips the limiter and every side effect after authentication', async () => {
  const calls = []
  globalThis.fetch = async (input) => {
    const url = urlOf(input)
    calls.push(url)
    if (url.pathname === '/auth/v1/user') return json({ id: USER_ID })
    throw new Error(`unexpected fetch ${url}`)
  }
  const { default: handler } = await loadApi('meetup-notify.js', supabaseEnv)

  const response = await handler(new Request('https://app.test/api/meetup-notify', {
    method: 'POST',
    headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ meetup_id: MEETUP_ID }),
  }))

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { skipped: 'inert' })
  assert.equal(calls.some(url => url.pathname.endsWith('/rpc/edge_rate_hit')), false)
  assert.equal(calls.some(url => url.hostname === 'api.resend.com'), false)
})

test('WeChat security proxy fails closed before classifier calls when its limiter is unavailable', async () => {
  const calls = []
  globalThis.fetch = async (input) => {
    const url = urlOf(input)
    calls.push(url)
    if (url.pathname === '/auth/v1/user') return json({ id: USER_ID })
    if (url.pathname.endsWith('/rpc/edge_rate_hit')) return json({ error: 'down' }, 503)
    throw new Error(`unexpected fetch ${url}`)
  }
  const { default: handler } = await loadApi('wechat-seccheck.js', {
    ...supabaseEnv,
    WECHAT_APPID: 'wx-app',
    WECHAT_APPSECRET: 'wx-secret',
  })

  const response = await handler(new Request('https://app.test/api/wechat-seccheck', {
    method: 'POST',
    headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'text', content: 'hello', openid: 'wx-user' }),
  }))

  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'rate_limit_unavailable' })
  assert.equal(calls.some(url => url.hostname === 'api.weixin.qq.com'), false)
})

for (const [responseKind, limiterResponse] of malformedLimiterResponses) {
  test(`WeChat security proxy rejects a 200 ${responseKind} limiter response`, async () => {
    const calls = []
    globalThis.fetch = async (input) => {
      const url = urlOf(input)
      calls.push(url)
      if (url.pathname === '/auth/v1/user') return json({ id: USER_ID })
      if (url.pathname.endsWith('/rpc/edge_rate_hit')) return limiterResponse()
      throw new Error(`unexpected fetch ${url}`)
    }
    const { default: handler } = await loadApi('wechat-seccheck.js', {
      ...supabaseEnv,
      WECHAT_APPID: 'wx-app',
      WECHAT_APPSECRET: 'wx-secret',
    })

    const response = await handler(new Request('https://app.test/api/wechat-seccheck', {
      method: 'POST',
      headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'text', content: 'hello', openid: 'wx-user' }),
    }))

    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { error: 'rate_limit_unavailable' })
    assert.equal(calls.some(url => url.hostname === 'api.weixin.qq.com'), false)
  })
}

test('missing WeChat credentials degrade only after authentication', async () => {
  globalThis.fetch = async () => { throw new Error('missing bearer must not reach upstream') }
  const { default: handler } = await loadApi('wechat-seccheck.js', supabaseEnv)

  const unauthorized = await handler(new Request('https://app.test/api/wechat-seccheck', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'text', content: 'hello' }),
  }))

  assert.equal(unauthorized.status, 401)
  assert.deepEqual(await unauthorized.json(), { error: 'unauthorized' })
})
