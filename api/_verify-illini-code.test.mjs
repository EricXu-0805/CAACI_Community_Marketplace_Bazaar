// Leading underscore prevents Vercel from treating this test as an API Function.
import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { afterEach, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { inlineDeploymentBoundaryImport } from './_test-module-loader.mjs'

const API_URL = new URL('./auth/verify-illini-code.js', import.meta.url)
const SEND_API_URL = new URL('./auth/send-illini-code.js', import.meta.url)
const MIGRATION_URL = new URL(
  '../supabase/migrations/20260717194842_atomic_illini_email_verification.sql',
  import.meta.url,
)
const USER_ID = '11111111-1111-4111-8111-111111111111'
const BEARER = 'Bearer user-token'
const CODE = '123456'
const ENV_KEYS = [
  'SUPABASE_URL',
  'VITE_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_ANON_KEY',
  'SUPABASE_PUBLISHABLE_KEY',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'RESEND_API_KEY',
]
const originalEnv = new Map(ENV_KEYS.map(key => [key, process.env[key]]))
const originalFetch = globalThis.fetch
let importNonce = 0

const supabaseEnv = {
  SUPABASE_URL: 'https://supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  SUPABASE_ANON_KEY: 'anon-key',
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key)
    if (value == null) delete process.env[key]
    else process.env[key] = value
  }
  globalThis.fetch = originalFetch
})

async function loadHandler(env = supabaseEnv, apiUrl = API_URL, transform = source => source) {
  for (const key of ENV_KEYS) delete process.env[key]
  Object.assign(process.env, env)
  const source = transform(await readFile(apiUrl, 'utf8'))
  const encoded = Buffer.from(inlineDeploymentBoundaryImport(source)).toString('base64')
  return (await import(`data:text/javascript;base64,${encoded}#illini-${importNonce++}`)).default
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function pathOf(input) {
  return new URL(input instanceof Request ? input.url : String(input)).pathname
}

function verificationRequest(code = CODE) {
  return new Request('https://app.test/api/auth/verify-illini-code', {
    method: 'POST',
    headers: { Authorization: BEARER, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
}

function installHappyAuthAndLimiter(verificationResult, capture = null) {
  globalThis.fetch = async (input, init = {}) => {
    const path = pathOf(input)
    if (path === '/auth/v1/user') return json({ id: USER_ID })
    if (path === '/rest/v1/rpc/edge_rate_hit') return json(true)
    if (path === '/rest/v1/rpc/verify_illini_email_code') {
      if (capture) capture.push({ input, init })
      return json(verificationResult)
    }
    throw new Error(`unexpected fetch ${path}`)
  }
}

for (const [name, limiterResponse] of [
  ['non-2xx', () => json({ error: 'down' }, 503)],
  ['malformed JSON value', () => json({ allowed: true })],
  ['null JSON value', () => json(null)],
  ['invalid JSON', () => new Response('not-json', { status: 200 })],
]) {
  test(`verification fails closed when the limiter returns ${name}`, async () => {
    const calls = []
    globalThis.fetch = async (input) => {
      const path = pathOf(input)
      calls.push(path)
      if (path === '/auth/v1/user') return json({ id: USER_ID })
      if (path === '/rest/v1/rpc/edge_rate_hit') return limiterResponse()
      throw new Error(`unexpected fetch ${path}`)
    }
    const handler = await loadHandler()

    const response = await handler(verificationRequest())

    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { error: 'rate_limit_unavailable' })
    assert.equal(calls.includes('/rest/v1/rpc/verify_illini_email_code'), false)
  })
}

test('verification fails closed when the limiter request throws', async () => {
  const calls = []
  globalThis.fetch = async (input) => {
    const path = pathOf(input)
    calls.push(path)
    if (path === '/auth/v1/user') return json({ id: USER_ID })
    if (path === '/rest/v1/rpc/edge_rate_hit') throw new Error('limiter down')
    throw new Error(`unexpected fetch ${path}`)
  }
  const handler = await loadHandler()

  const response = await handler(verificationRequest())

  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'rate_limit_unavailable' })
  assert.equal(calls.includes('/rest/v1/rpc/verify_illini_email_code'), false)
})

test('a negative limiter decision returns 429 without calling verification', async () => {
  const calls = []
  globalThis.fetch = async (input) => {
    const path = pathOf(input)
    calls.push(path)
    if (path === '/auth/v1/user') return json({ id: USER_ID })
    if (path === '/rest/v1/rpc/edge_rate_hit') return json(false)
    throw new Error(`unexpected fetch ${path}`)
  }
  const handler = await loadHandler()

  const response = await handler(verificationRequest())

  assert.equal(response.status, 429)
  assert.deepEqual(await response.json(), { error: 'too_many_attempts' })
  assert.equal(calls.includes('/rest/v1/rpc/verify_illini_email_code'), false)
})

for (const [name, limiterResponse] of [
  ['non-2xx', () => json({ error: 'down' }, 503)],
  ['malformed JSON value', () => json({ allowed: true })],
  ['null JSON value', () => json(null)],
  ['invalid JSON', () => new Response('not-json', { status: 200 })],
]) {
  test(`Illini code send rejects a ${name} limiter response before every side effect`, async () => {
    const calls = []
    globalThis.fetch = async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      calls.push(url)
      if (url.pathname === '/auth/v1/user') return json({ id: USER_ID })
      if (url.pathname === '/rest/v1/rpc/edge_rate_hit') return limiterResponse()
      throw new Error(`unexpected fetch ${url}`)
    }
    const handler = await loadHandler({
      ...supabaseEnv,
      RESEND_API_KEY: 'resend-key',
    }, SEND_API_URL)

    const response = await handler(new Request('https://app.test/api/auth/send-illini-code', {
      method: 'POST',
      headers: {
        Authorization: BEARER,
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.9',
      },
      body: JSON.stringify({ email: 'student@illinois.edu' }),
    }))

    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { error: 'rate_limit_unavailable' })
    assert.equal(calls.filter(url => url.pathname === '/rest/v1/rpc/edge_rate_hit').length, 1)
    assert.equal(calls.some(url => url.pathname === '/rest/v1/profiles'), false)
    assert.equal(calls.some(url => url.pathname === '/rest/v1/illini_verifications'), false)
    assert.equal(calls.some(url => url.hostname === 'api.resend.com'), false)
  })
}

for (const [name, malformedResponse] of [
  ['malformed JSON value', () => json({ allowed: true })],
  ['null JSON value', () => json(null)],
  ['invalid JSON', () => new Response('not-json', { status: 200 })],
]) {
  test(`Illini code send rejects a ${name} daily limiter response`, async () => {
    const calls = []
    let limiterCallCount = 0
    globalThis.fetch = async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      calls.push(url)
      if (url.pathname === '/auth/v1/user') return json({ id: USER_ID })
      if (url.pathname === '/rest/v1/rpc/edge_rate_hit') {
        limiterCallCount += 1
        if (limiterCallCount === 1) return json(true)
        if (limiterCallCount === 2) return malformedResponse()
        return json(true)
      }
      throw new Error(`unexpected fetch ${url}`)
    }
    const handler = await loadHandler({
      ...supabaseEnv,
      RESEND_API_KEY: 'resend-key',
    }, SEND_API_URL)

    const response = await handler(new Request('https://app.test/api/auth/send-illini-code', {
      method: 'POST',
      headers: {
        Authorization: BEARER,
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.9',
      },
      body: JSON.stringify({ email: 'student@illinois.edu' }),
    }))

    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { error: 'rate_limit_unavailable' })
    assert.equal(limiterCallCount, 4)
    assert.equal(calls.some(url => url.pathname === '/rest/v1/profiles'), false)
    assert.equal(calls.some(url => url.pathname === '/rest/v1/illini_verifications'), false)
    assert.equal(calls.some(url => url.hostname === 'api.resend.com'), false)
  })
}

test('verification sends only a caller-bound digest through the authenticated RPC', async () => {
  const rpcCalls = []
  installHappyAuthAndLimiter('verified', rpcCalls)
  const handler = await loadHandler()

  const response = await handler(verificationRequest())

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true, verified: true })
  assert.equal(rpcCalls.length, 1)

  const { input, init } = rpcCalls[0]
  assert.equal(pathOf(input), '/rest/v1/rpc/verify_illini_email_code')
  assert.equal(init.method, 'POST')
  assert.equal(init.headers.apikey, 'anon-key')
  assert.equal(init.headers.Authorization, BEARER)
  assert.notEqual(init.headers.Authorization, 'Bearer service-key')

  const body = JSON.parse(init.body)
  const expectedHash = createHash('sha256').update(`${CODE}:${USER_ID}`).digest('hex')
  assert.deepEqual(body, {
    expected_user_id_in: USER_ID,
    submitted_code_hash_in: expectedHash,
  })
  assert.equal(init.body.includes(CODE), false)
})

test('Illini send limiter uses domain-separated HMAC buckets and a trusted network header', async () => {
  const limiterBodies = []
  let limiterCalls = 0
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname === '/auth/v1/user') return json({ id: USER_ID })
    if (url.pathname === '/rest/v1/rpc/edge_rate_hit') {
      limiterCalls += 1
      limiterBodies.push(JSON.parse(init.body))
      return limiterCalls === 1 ? json(true) : json(false)
    }
    throw new Error(`unexpected fetch ${url}`)
  }
  const handler = await loadHandler({
    ...supabaseEnv,
    RESEND_API_KEY: 'resend-key',
  }, SEND_API_URL)

  const response = await handler(new Request('https://app.test/api/auth/send-illini-code', {
    method: 'POST',
    headers: {
      Authorization: BEARER,
      'Content-Type': 'application/json',
      'x-vercel-forwarded-for': '203.0.113.10',
      'x-forwarded-for': '198.51.100.99',
    },
    body: JSON.stringify({ email: 'student@illinois.edu' }),
  }))

  assert.equal(response.status, 429)
  assert.equal(limiterBodies.length, 4)
  const buckets = limiterBodies.map(body => body.bucket_in)
  const expected = (label, value) => createHmac('sha256', 'service-key')
    .update(`${label}:v1\u0000${value}`)
    .digest('hex')
  assert.deepEqual(buckets, [
    `illini-send:cooldown:${expected('illini-send:user', USER_ID)}`,
    `illini-send:daily-user:${expected('illini-send:user', USER_ID)}`,
    `illini-send:daily-target:${expected('illini-send:target', 'student@illinois.edu')}`,
    `illini-send:hourly-ip:${expected('illini-send:network', '203.0.113.10')}`,
  ])
  for (const bucket of buckets) {
    assert.doesNotMatch(bucket, /203\.0\.113\.10|198\.51\.100\.99|student@illinois\.edu/)
  }
  assert.notEqual(
    buckets.at(-1),
    `illini-send:hourly-ip:${createHash('sha256').update('203.0.113.10').digest('hex')}`,
  )
})

for (const [result, expectedStatus] of Object.entries({
  no_pending: 400,
  expired: 400,
  bad_code: 400,
  invalid_email: 400,
  too_many_attempts: 429,
  email_taken: 409,
  already_verified: 409,
  profile_not_found: 409,
})) {
  test(`verification maps RPC result ${result} to ${expectedStatus}`, async () => {
    installHappyAuthAndLimiter(result)
    const handler = await loadHandler()

    const response = await handler(verificationRequest())

    assert.equal(response.status, expectedStatus)
    assert.deepEqual(await response.json(), { error: result })
  })
}

for (const [name, rpcResponse, expectedStatus, expectedError] of [
  ['missing RPC', () => json({ code: 'PGRST202' }, 404), 503, 'verification_unavailable'],
  ['authorization rejection', () => json({ code: '42501' }, 403), 401, 'auth_required'],
  ['database failure', () => json({ code: 'XX000' }, 500), 500, 'verify_failed'],
]) {
  test(`verification maps ${name} without exposing upstream details`, async () => {
    globalThis.fetch = async (input) => {
      const path = pathOf(input)
      if (path === '/auth/v1/user') return json({ id: USER_ID })
      if (path === '/rest/v1/rpc/edge_rate_hit') return json(true)
      if (path === '/rest/v1/rpc/verify_illini_email_code') return rpcResponse()
      throw new Error(`unexpected fetch ${path}`)
    }
    const handler = await loadHandler()

    const response = await handler(verificationRequest())

    assert.equal(response.status, expectedStatus)
    assert.deepEqual(await response.json(), { error: expectedError })
  })
}

test('verification maps an RPC network failure to a retryable 503', async () => {
  globalThis.fetch = async (input) => {
    const path = pathOf(input)
    if (path === '/auth/v1/user') return json({ id: USER_ID })
    if (path === '/rest/v1/rpc/edge_rate_hit') return json(true)
    if (path === '/rest/v1/rpc/verify_illini_email_code') throw new Error('rpc down')
    throw new Error(`unexpected fetch ${path}`)
  }
  const handler = await loadHandler()

  const response = await handler(verificationRequest())

  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'verification_unavailable' })
})

test('Illini request bodies are bounded before verification or mail side effects', async () => {
  const verifyCalls = []
  globalThis.fetch = async (input) => {
    const path = pathOf(input)
    verifyCalls.push(path)
    if (path === '/auth/v1/user') return json({ id: USER_ID })
    if (path === '/rest/v1/rpc/edge_rate_hit') return json(true)
    throw new Error(`unexpected fetch ${path}`)
  }
  const verifyHandler = await loadHandler()
  const oversized = JSON.stringify({ code: '1'.repeat(3_000) })
  const verifyResponse = await verifyHandler(new Request('https://app.test/api/auth/verify-illini-code', {
    method: 'POST',
    headers: { Authorization: BEARER, 'Content-Type': 'application/json' },
    body: oversized,
  }))
  assert.equal(verifyResponse.status, 413)
  assert.deepEqual(await verifyResponse.json(), { error: 'body_too_large' })
  assert.equal(verifyCalls.includes('/rest/v1/rpc/verify_illini_email_code'), false)

  const sendCalls = []
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    sendCalls.push(url)
    if (url.pathname === '/auth/v1/user') return json({ id: USER_ID })
    throw new Error(`unexpected fetch ${url}`)
  }
  const sendHandler = await loadHandler({
    ...supabaseEnv,
    RESEND_API_KEY: 'resend-key',
  }, SEND_API_URL)
  const sendResponse = await sendHandler(new Request('https://app.test/api/auth/send-illini-code', {
    method: 'POST',
    headers: { Authorization: BEARER, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${'a'.repeat(3_000)}@illinois.edu` }),
  }))
  assert.equal(sendResponse.status, 413)
  assert.deepEqual(await sendResponse.json(), { error: 'body_too_large' })
  assert.equal(sendCalls.some(url => url.pathname.endsWith('/rpc/edge_rate_hit')), false)
  assert.equal(sendCalls.some(url => url.hostname === 'api.resend.com'), false)
})

test('Illini upstream deadlines abort hangs, reject redirects, and keep errors stable', async () => {
  let verifyAborted = false
  const redirects = []
  globalThis.fetch = async (input, init = {}) => {
    const path = pathOf(input)
    redirects.push(init.redirect)
    if (path === '/auth/v1/user') return json({ id: USER_ID })
    if (path === '/rest/v1/rpc/edge_rate_hit') return json(true)
    if (path === '/rest/v1/rpc/verify_illini_email_code') {
      return new Promise((_, reject) => {
        init.signal?.addEventListener('abort', () => {
          verifyAborted = true
          reject(new DOMException('provider secret detail', 'AbortError'))
        }, { once: true })
      })
    }
    throw new Error(`unexpected fetch ${path}`)
  }
  const verifyHandler = await loadHandler(supabaseEnv, API_URL, source => (
    source.replace('const SUPABASE_TIMEOUT_MS = 5_000', 'const SUPABASE_TIMEOUT_MS = 10')
  ))
  const verifyResponse = await verifyHandler(verificationRequest())
  assert.equal(verifyResponse.status, 503)
  assert.deepEqual(await verifyResponse.json(), { error: 'verification_unavailable' })
  assert.equal(verifyAborted, true)

  let resendAborted = false
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    redirects.push(init.redirect)
    if (url.pathname === '/auth/v1/user') return json({ id: USER_ID })
    if (url.pathname.endsWith('/rpc/edge_rate_hit')) return json(true)
    if (url.pathname === '/rest/v1/profiles') return json([{ is_illini_verified: false }])
    if (url.pathname === '/rest/v1/illini_verifications' && !init.method) return json([])
    if (url.pathname === '/rest/v1/illini_verifications' && init.method === 'POST') {
      return new Response(null, { status: 204 })
    }
    if (url.hostname === 'api.resend.com') {
      return new Promise((_, reject) => {
        init.signal?.addEventListener('abort', () => {
          resendAborted = true
          reject(new DOMException('provider secret detail', 'AbortError'))
        }, { once: true })
      })
    }
    throw new Error(`unexpected fetch ${url}`)
  }
  const sendHandler = await loadHandler({
    ...supabaseEnv,
    RESEND_API_KEY: 'resend-key',
  }, SEND_API_URL, source => (
    source.replace('const RESEND_TIMEOUT_MS = 8_000', 'const RESEND_TIMEOUT_MS = 10')
  ))
  const sendResponse = await sendHandler(new Request('https://app.test/api/auth/send-illini-code', {
    method: 'POST',
    headers: {
      Authorization: BEARER,
      'Content-Type': 'application/json',
      'x-vercel-forwarded-for': '203.0.113.10',
    },
    body: JSON.stringify({ email: 'student@illinois.edu' }),
  }))
  assert.equal(sendResponse.status, 503)
  assert.deepEqual(await sendResponse.json(), { error: 'send_failed' })
  assert.equal(resendAborted, true)
  assert.ok(redirects.length > 0)
  assert.ok(redirects.every(value => value === 'error'))
})

test('Illini handlers never log upstream response bodies', async () => {
  const errors = []
  const originalConsoleError = console.error
  console.error = (...args) => errors.push(args.map(String).join(' '))
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.pathname === '/auth/v1/user') return json({ id: USER_ID })
      if (url.pathname.endsWith('/rpc/edge_rate_hit')) return json(true)
      if (url.pathname === '/rest/v1/profiles') return json([{ is_illini_verified: false }])
      if (url.pathname === '/rest/v1/illini_verifications' && !init.method) return json([])
      if (url.pathname === '/rest/v1/illini_verifications' && init.method === 'POST') {
        return new Response('student@illinois.edu secret provider detail', { status: 500 })
      }
      throw new Error(`unexpected fetch ${url}`)
    }
    const handler = await loadHandler({
      ...supabaseEnv,
      RESEND_API_KEY: 'resend-key',
    }, SEND_API_URL)
    const response = await handler(new Request('https://app.test/api/auth/send-illini-code', {
      method: 'POST',
      headers: { Authorization: BEARER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'student@illinois.edu' }),
    }))
    assert.equal(response.status, 503)
    assert.equal(errors.some(line => line.includes('student@illinois.edu')), false)
    assert.equal(errors.some(line => line.includes('secret provider detail')), false)
  } finally {
    console.error = originalConsoleError
  }
})

test('migration encodes the row-lock and all-or-nothing verification contract', async () => {
  const source = await readFile(MIGRATION_URL, 'utf8')
  const functionBody = source.match(
    /CREATE OR REPLACE FUNCTION public\.verify_illini_email_code[\s\S]*?AS \$function\$([\s\S]*?)\$function\$/i,
  )?.[1]

  assert.ok(functionBody, 'verification RPC body is present')
  assert.match(source, /SECURITY DEFINER\s+SET search_path = pg_catalog/i)
  assert.match(functionBody, /auth\.uid\(\)/i)
  assert.match(functionBody, /expected_user_id_in\s*<>\s*caller_id/i)
  assert.match(
    functionBody,
    /FROM public\.illini_verifications[\s\S]*?WHERE[\s\S]*?FOR UPDATE/i,
  )
  assert.match(
    functionBody,
    /SET attempts = verification\.attempts \+ 1/i,
  )
  assert.match(functionBody, /UPDATE public\.profiles/i)
  assert.match(functionBody, /DELETE FROM public\.illini_verifications/i)
  assert.match(
    source,
    /REVOKE ALL ON FUNCTION public\.verify_illini_email_code\(uuid, text\)[\s\S]*?FROM PUBLIC, anon, authenticated, service_role;[\s\S]*?GRANT EXECUTE[\s\S]*?TO authenticated;/i,
  )

  const profileUpdate = functionBody.lastIndexOf('UPDATE public.profiles')
  const finalConsume = functionBody.lastIndexOf('DELETE FROM public.illini_verifications')
  assert.ok(profileUpdate >= 0 && finalConsume > profileUpdate)
})

test('edge handler has no direct service-role verification table mutation path', async () => {
  const source = await readFile(API_URL, 'utf8')
  assert.doesNotMatch(source, /illini_verifications\?user_id=/)
  assert.doesNotMatch(source, /profiles\?id=/)
  assert.match(source, /rpc\/verify_illini_email_code/)
})
