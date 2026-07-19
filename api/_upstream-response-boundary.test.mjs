// Leading underscore prevents Vercel from treating this test as an API Function.
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { inlineDeploymentBoundaryImport } from './_test-module-loader.mjs'

const API_ROOT = new URL('./', import.meta.url)
const USER_ID = '11111111-1111-4111-8111-111111111111'
const ENV_KEYS = [
  'SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY', 'OPENAI_API_KEY',
  'RESEND_API_KEY', 'DIGEST_TEST_EMAIL', 'DIGEST_LIVE', 'CRON_SECRET',
  'NOMINATIM_BASE_URL',
]
const originalEnv = new Map(ENV_KEYS.map(key => [key, process.env[key]]))
const originalFetch = globalThis.fetch
const originalConsoleError = console.error
let nonce = 0

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key)
    if (value == null) delete process.env[key]
    else process.env[key] = value
  }
  globalThis.fetch = originalFetch
  console.error = originalConsoleError
})

async function loadApi(filename, env = {}) {
  for (const key of ENV_KEYS) delete process.env[key]
  Object.assign(process.env, env)
  const source = await readFile(new URL(filename, API_ROOT), 'utf8')
  return import(`data:text/javascript;base64,${Buffer.from(inlineDeploymentBoundaryImport(source)).toString('base64')}#upstream-boundary-${nonce++}`)
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function urlOf(input) {
  return new URL(input instanceof Request ? input.url : String(input))
}

const supabaseEnv = {
  SUPABASE_URL: 'https://supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-test',
  SUPABASE_ANON_KEY: 'anon-test',
}

test('moderation rejects an oversized chunked provider body without parsing it', async () => {
  globalThis.fetch = async input => {
    const url = urlOf(input)
    if (url.pathname === '/auth/v1/user') return json({ id: USER_ID })
    if (url.pathname.endsWith('/rpc/edge_rate_hit')) return json(true)
    if (url.pathname === '/v1/moderations') {
      // No Content-Length: the streaming byte counter, not just a header
      // preflight, must stop the response.
      return new Response(new Uint8Array(128 * 1024 + 1), { status: 200 })
    }
    throw new Error(`unexpected fetch ${url}`)
  }
  const { default: handler } = await loadApi('moderate.js', {
    ...supabaseEnv,
    OPENAI_API_KEY: 'openai-test',
  })
  const response = await handler(new Request('https://app.test/api/moderate', {
    method: 'POST',
    headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'desk lamp' }),
  }))

  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'moderation_unavailable' })
})

test('moderation total deadline includes a provider body that never finishes', async () => {
  globalThis.fetch = async input => {
    const url = urlOf(input)
    if (url.pathname === '/auth/v1/user') return json({ id: USER_ID })
    if (url.pathname.endsWith('/rpc/edge_rate_hit')) return json(true)
    if (url.pathname === '/v1/moderations') {
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"results":['))
          // Deliberately never close: the endpoint's absolute deadline must
          // cancel this reader and return a stable failure.
        },
      }), { status: 200 })
    }
    throw new Error(`unexpected fetch ${url}`)
  }
  const { default: handler } = await loadApi('moderate.js', {
    ...supabaseEnv,
    OPENAI_API_KEY: 'openai-test',
  })
  const started = Date.now()
  const response = await handler(new Request('https://app.test/api/moderate', {
    method: 'POST',
    headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'desk lamp' }),
  }))

  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'moderation_unavailable' })
  assert.ok(Date.now() - started < 4_500, 'response body deadline should bound the request')
})

test('geocoder rejects an oversized provider response after both abuse gates', async () => {
  let limiterCalls = 0
  globalThis.fetch = async input => {
    const url = urlOf(input)
    if (url.pathname.endsWith('/rpc/edge_rate_hit')) {
      limiterCalls += 1
      return json(true)
    }
    if (url.hostname === 'geo.test') {
      return new Response(null, {
        status: 200,
        headers: { 'Content-Length': String(64 * 1024 + 1) },
      })
    }
    throw new Error(`unexpected fetch ${url}`)
  }
  const { default: handler } = await loadApi('geocode.js', {
    ...supabaseEnv,
    NOMINATIM_BASE_URL: 'https://geo.test',
  })
  const response = await handler(new Request('https://app.test/api/geocode?lat=40.11&lon=-88.23', {
    headers: { 'x-vercel-forwarded-for': '203.0.113.8' },
  }))

  assert.equal(limiterCalls, 2)
  assert.equal(response.status, 504)
  assert.deepEqual(await response.json(), { error: 'timeout_or_network' })
})

test('test digest rejects an oversized Resend response and never reports success', async () => {
  globalThis.fetch = async input => {
    const url = urlOf(input)
    if (url.hostname === 'api.resend.com') {
      return new Response(null, {
        status: 200,
        headers: { 'Content-Length': String(2 * 1024 * 1024 + 1) },
      })
    }
    throw new Error(`unexpected fetch ${url}`)
  }
  const { default: handler } = await loadApi('notification-digest.js', {
    RESEND_API_KEY: 'resend-test',
    DIGEST_TEST_EMAIL: 'sink@example.com',
    CRON_SECRET: 'cron-test',
  })
  const response = await handler(new Request('https://app.test/api/notification-digest', {
    headers: { Authorization: 'Bearer cron-test' },
  }))

  assert.equal(response.status, 502)
  assert.deepEqual(await response.json(), { error: 'test_send_failed' })
})

test('unsubscribe treats an oversized limiter response as unavailable', async () => {
  globalThis.fetch = async input => {
    const url = urlOf(input)
    if (url.pathname.endsWith('/rpc/edge_rate_hit')) {
      return new Response(null, {
        status: 200,
        headers: { 'Content-Length': String(64 * 1024 + 1) },
      })
    }
    throw new Error(`unexpected fetch ${url}`)
  }
  const { default: handler } = await loadApi('unsubscribe.js', supabaseEnv)
  const response = await handler(new Request(
    'https://app.test/api/unsubscribe?t=11111111-1111-4111-8111-111111111111',
    { method: 'POST' },
  ))

  assert.equal(response.status, 200)
  assert.match(await response.text(), /Unsubscribe failed/)
})
