// Leading underscore prevents Vercel from treating this test as an API Function.
import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { afterEach, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { inlineSharedApiImports } from './_test-module-loader.mjs'

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
  'SENTRY_DSN',
  'VITE_SENTRY_DSN',
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
  const encoded = Buffer.from(inlineSharedApiImports(source)).toString('base64')
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

/**
 * Three caps guard this endpoint and one of them is not the caller's.
 *
 * The per-IP bucket is 24/hour and shared: campus wifi NATs a whole building
 * behind one egress address, which is where this beta runs. Answering
 * 'daily_cap' there told the 25th student in an hour that their own quota was
 * spent and to come back tomorrow — wrong about whose limit it was, and wrong
 * about the hour it actually resets in, so they stop trying for a day when ten
 * minutes would have worked.
 */
test('a cap that belongs to the shared network is not reported as the caller’s own', async () => {
  async function answerWhenExhausted(exhaustedBucketPrefix) {
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.pathname === '/auth/v1/user') return json({ id: USER_ID })
      if (url.pathname === '/rest/v1/rpc/edge_rate_hit') {
        const bucket = JSON.parse(init.body).bucket_in
        return json(!bucket.startsWith(exhaustedBucketPrefix))
      }
      if (url.pathname === '/rest/v1/profiles') return json([{ is_illini_verified: false }])
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
    return { status: response.status, ...(await response.json()) }
  }

  const network = await answerWhenExhausted('illini-send:hourly-ip')
  const mine = await answerWhenExhausted('illini-send:daily-user')
  const target = await answerWhenExhausted('illini-send:daily-target')
  const cooldown = await answerWhenExhausted('illini-send:cooldown')

  assert.deepEqual(network, { status: 429, error: 'network_busy' })
  // The controls. A cap that really is the caller's own must still say so, or
  // the assertion above is satisfied by an endpoint that blames the network for
  // everything — and every branch must stay a refusal.
  assert.deepEqual(mine, { status: 429, error: 'daily_cap' })
  assert.deepEqual(target, { status: 429, error: 'daily_cap' })
  assert.deepEqual(cooldown, { status: 429, error: 'cooldown' })
})

/*
 * Every refusal a student can do something about has to reach the screen as a
 * sentence. errToast() falls back to a generic string for an unmapped code, so
 * a new error name degrades quietly instead of breaking loudly.
 *
 * "Can do something about" is read off the status rather than a hand-kept list:
 * a 4xx is the caller's to fix, a 405 is unreachable from the app, and a 5xx is
 * ours — those go through the page's generic path on purpose.
 */
test('every actionable Illini refusal has copy in both languages', async () => {
  const [send, verify, zh, en] = await Promise.all([
    readFile(SEND_API_URL, 'utf8'),
    readFile(API_URL, 'utf8'),
    readFile(new URL('../app/src/composables/i18n/messages/zh.ts', import.meta.url), 'utf8'),
    readFile(new URL('../app/src/composables/i18n/messages/en.ts', import.meta.url), 'utf8'),
  ])
  const REFUSAL_RE = /JSON\.stringify\(\{\s*error:\s*'([a-z_]+)'[^)]*\}\),\s*\{\s*status:\s*(\d{3})/g
  const actionable = new Set()
  const seen = new Set()
  for (const source of [send, verify]) {
    for (const [, code, status] of source.matchAll(REFUSAL_RE)) {
      seen.add(code)
      if (status.startsWith('4') && status !== '405') actionable.add(code)
    }
  }
  assert.ok(seen.size >= 10, `only found ${seen.size} refusal codes — the scan stopped matching`)
  assert.ok(actionable.size >= 6, `only found ${actionable.size} actionable refusals — the status split broke`)
  assert.ok(actionable.has('network_busy'), 'the shared-network refusal is no longer a 4xx')

  const missing = []
  for (const code of [...actionable].sort()) {
    for (const [lang, source] of [['zh', zh], ['en', en]]) {
      if (!source.includes(`'illini.err.${code}'`)) missing.push(`${lang}: illini.err.${code}`)
    }
  }
  assert.deepEqual(missing, [], `Illini refusals a student can act on with no copy:\n${missing.join('\n')}`)
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
  assert.ok(redirects.every(value => value === 'manual'))
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


/*
 * Nobody has ever verified an Illini address in production — illini_verifications
 * holds zero rows. With no telemetry on either handler, "nobody tried" and
 * "everyone failed" produced exactly the same evidence: a toast for the student
 * and a console line in Vercel that nothing reads.
 *
 * api/auth/delete-account.js, the third endpoint in this directory, already
 * reported. These two did not.
 *
 * _sentry-report.js states the rule these tests exist to hold: report only
 * outcomes an unauthenticated request cannot reach, or the public URL becomes a
 * way to generate alerts. Both handlers answer 401 before any of this, so the
 * last test here is the one that matters most.
 */

const DSN = 'https://publickey@sentry.test/4321'

/** Every Sentry envelope the handler sent, decoded. */
function sentryCollector() {
  const sent = []
  return {
    sent,
    intercept(path, init) {
      if (path !== '/api/4321/store/') return null
      sent.push(JSON.parse(init.body))
      return json({ id: 'evt' })
    },
  }
}

test('a provider that will not send the code is reported, without an address or a body', async () => {
  const sentry = sentryCollector()
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const intercepted = sentry.intercept(url.pathname, init)
    if (intercepted) return intercepted
    if (url.pathname === '/auth/v1/user') return json({ id: USER_ID })
    if (url.pathname === '/rest/v1/rpc/edge_rate_hit') return json(true)
    if (url.pathname === '/rest/v1/profiles') return json([{ is_illini_verified: false }])
    if (url.pathname === '/rest/v1/illini_verifications') return json([])
    if (url.hostname === 'api.resend.com') return json({ message: 'domain not verified' }, 403)
    throw new Error(`unexpected fetch ${url}`)
  }
  const handler = await loadHandler(
    { ...supabaseEnv, RESEND_API_KEY: 'resend-key', SENTRY_DSN: DSN }, SEND_API_URL)

  const response = await handler(new Request('https://app.test/api/auth/send-illini-code', {
    method: 'POST',
    headers: { Authorization: BEARER, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'student@illinois.edu' }),
  }))

  assert.equal(response.status, 502)
  assert.deepEqual(sentry.sent.map(e => e.message),
    ['illini send: provider rejected the code email'])
  assert.deepEqual(sentry.sent[0].extra, { status: 403 })

  // The suite already forbids logging upstream bodies; an alert is another log.
  const envelope = JSON.stringify(sentry.sent[0])
  assert.doesNotMatch(envelope, /student@illinois\.edu|domain not verified|resend-key/)
})

test('a verification RPC that is not on the database is reported as exactly that', async () => {
  const sentry = sentryCollector()
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const intercepted = sentry.intercept(url.pathname, init)
    if (intercepted) return intercepted
    if (url.pathname === '/auth/v1/user') return json({ id: USER_ID })
    if (url.pathname === '/rest/v1/rpc/edge_rate_hit') return json(true)
    if (url.pathname === '/rest/v1/rpc/verify_illini_email_code') {
      return json({ code: 'PGRST202', message: 'Could not find the function' }, 404)
    }
    throw new Error(`unexpected fetch ${url}`)
  }
  const handler = await loadHandler({ ...supabaseEnv, SENTRY_DSN: DSN })

  const response = await handler(verificationRequest())

  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'verification_unavailable' })
  assert.deepEqual(sentry.sent.map(e => e.message),
    ['illini verify: RPC missing from this database'])
})

test('an ordinary refusal is not an alert', async () => {
  // A wrong code and an exhausted attempt budget are the two things this
  // endpoint is *for*. Reporting them would bury the faults above under the
  // normal traffic of people mistyping six digits.
  for (const [label, result] of [['wrong code', 'bad_code'], ['expired', 'expired'],
    ['out of attempts', 'too_many_attempts'], ['already taken', 'email_taken']]) {
    const sentry = sentryCollector()
    installHappyAuthAndLimiter(result)
    const inner = globalThis.fetch
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      return sentry.intercept(url.pathname, init) || inner(input, init)
    }
    const handler = await loadHandler({ ...supabaseEnv, SENTRY_DSN: DSN })

    await handler(verificationRequest())
    assert.deepEqual(sentry.sent, [], `${label} must not raise an alert`)
  }

  // Control: the same harness DOES capture an envelope when the fault is real,
  // so the emptiness above is the handler staying quiet rather than the
  // collector being wired up wrong.
  const sentry = sentryCollector()
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const intercepted = sentry.intercept(url.pathname, init)
    if (intercepted) return intercepted
    if (url.pathname === '/auth/v1/user') return json({ id: USER_ID })
    if (url.pathname === '/rest/v1/rpc/edge_rate_hit') return json(true)
    if (url.pathname === '/rest/v1/rpc/verify_illini_email_code') return json({}, 500)
    throw new Error(`unexpected fetch ${url}`)
  }
  const handler = await loadHandler({ ...supabaseEnv, SENTRY_DSN: DSN })
  await handler(verificationRequest())
  assert.equal(sentry.sent.length, 1, 'the collector must be able to see a real fault')
})

test('an unauthenticated caller cannot make either handler raise an alert', async () => {
  for (const [label, apiUrl, request] of [
    ['verify', API_URL, verificationRequest()],
    ['send', SEND_API_URL, new Request('https://app.test/api/auth/send-illini-code', {
      method: 'POST',
      headers: { Authorization: BEARER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'student@illinois.edu' }),
    })],
  ]) {
    const sentry = sentryCollector()
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      const intercepted = sentry.intercept(url.pathname, init)
      if (intercepted) return intercepted
      if (url.pathname === '/auth/v1/user') return json({ error: 'bad token' }, 401)
      throw new Error(`unexpected fetch ${url}`)
    }
    const handler = await loadHandler(
      { ...supabaseEnv, RESEND_API_KEY: 'resend-key', SENTRY_DSN: DSN }, apiUrl)

    const response = await handler(request)
    assert.equal(response.status, 401, `${label} must refuse an unauthenticated caller`)
    assert.deepEqual(sentry.sent, [],
      `${label}'s public URL must not be a way to generate alerts`)
  }
})
