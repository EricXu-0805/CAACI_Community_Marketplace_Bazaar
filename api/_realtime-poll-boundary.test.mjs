// Leading underscore prevents Vercel from treating this test as an API Function.
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { inlineDeploymentBoundaryImport } from './_test-module-loader.mjs'

const API_ROOT = new URL('./', import.meta.url)
const USER_A = '11111111-1111-4111-8111-111111111111'
const USER_B = '22222222-2222-4222-8222-222222222222'
const MESSAGE_A = '33333333-3333-4333-8333-333333333333'
const ENV_KEYS = [
  'SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY',
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

async function loadApi(transform = source => source) {
  for (const key of ENV_KEYS) delete process.env[key]
  Object.assign(process.env, {
    SUPABASE_URL: 'https://supabase.test',
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  })
  const source = await readFile(new URL('realtime-poll.js', API_ROOT), 'utf8')
  return import(`data:text/javascript;base64,${Buffer.from(inlineDeploymentBoundaryImport(transform(source))).toString('base64')}#realtime-poll-${importNonce++}`)
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const malformedLimiterResponses = [
  ['object', () => json({ allowed: true })],
  ['null', () => json(null)],
  ['invalid JSON', () => new Response('not-json', { status: 200 })],
]

function request(scope, id, since = '2026-07-18T00:00:00.000Z') {
  return new Request(
    `https://app.test/api/realtime-poll?scope=${scope}&id=${id}&since=${encodeURIComponent(since)}`,
    { headers: { Authorization: 'Bearer caller-token' } },
  )
}

test('inbox scope is bound to the authenticated user id', async () => {
  let fetchCount = 0
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    fetchCount += 1
    if (url.pathname === '/auth/v1/user') return json({ id: USER_A })
    throw new Error(`unexpected fetch ${url}`)
  }
  const { default: handler } = await loadApi()

  const response = await handler(request('inbox', USER_B))
  assert.equal(response.status, 403)
  assert.deepEqual(await response.json(), { error: 'forbidden' })
  assert.equal(fetchCount, 1)
})

test('valid inbox long-poll is rate-gated and forwards only the caller JWT under RLS', async () => {
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined))
    calls.push({ url, method: String(init.method || 'GET').toUpperCase(), authorization: headers.get('authorization') })
    if (url.pathname === '/auth/v1/user') return json({ id: USER_A })
    if (url.pathname.endsWith('/rpc/edge_rate_hit')) return json(true)
    if (url.pathname === '/rest/v1/messages') {
      return json([{ id: MESSAGE_A, conversation_id: USER_B, sender_id: USER_B, created_at: '2026-07-18T00:00:01.000Z' }])
    }
    throw new Error(`unexpected fetch ${url}`)
  }
  const { default: handler } = await loadApi()

  const response = await handler(request('inbox', USER_A))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.rows.length, 1)

  const rateCall = calls.find(call => call.url.pathname.endsWith('/rpc/edge_rate_hit'))
  assert.equal(rateCall.authorization, 'Bearer service-key')
  const messageCall = calls.find(call => call.url.pathname === '/rest/v1/messages')
  assert.equal(messageCall.authorization, 'Bearer caller-token')
  assert.equal(messageCall.url.searchParams.get('sender_id'), `neq.${USER_A}`)
})

test('now sentinel is seeded from the newest RLS-visible database timestamp, never the edge clock', async () => {
  const dbCursor = '2026-07-18T00:00:01.000Z'
  const dbRowId = USER_B
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined))
    calls.push({ url, authorization: headers.get('authorization') })
    if (url.pathname === '/auth/v1/user') return json({ id: USER_A })
    if (url.pathname.endsWith('/rpc/edge_rate_hit')) return json(true)
    if (url.pathname === '/rest/v1/messages') return json([{ id: dbRowId, created_at: dbCursor }])
    throw new Error(`unexpected fetch ${url}`)
  }
  const { default: handler } = await loadApi()

  const response = await handler(request('inbox', USER_A, 'now'))

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { rows: [], next_since: `${dbCursor}|${dbRowId}` })
  const seedCall = calls.find(call => call.url.pathname === '/rest/v1/messages')
  assert.equal(seedCall.authorization, 'Bearer caller-token')
  assert.equal(seedCall.url.searchParams.get('sender_id'), `neq.${USER_A}`)
  assert.equal(seedCall.url.searchParams.get('order'), 'created_at.desc,id.desc')
  assert.equal(seedCall.url.searchParams.get('limit'), '1')
  assert.equal(seedCall.url.searchParams.get('select'), 'id,created_at')
})

test('empty database seed returns an explicit empty cursor for the next poll', async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname === '/auth/v1/user') return json({ id: USER_A })
    if (url.pathname.endsWith('/rpc/edge_rate_hit')) return json(true)
    if (url.pathname === '/rest/v1/messages') return json([])
    throw new Error(`unexpected fetch ${url}`)
  }
  const { default: handler } = await loadApi()

  const response = await handler(request('conversation', USER_B, 'now'))

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { rows: [], next_since: '' })
})

test('an empty cursor stays explicit after an empty hold instead of degrading to null', async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname === '/auth/v1/user') return json({ id: USER_A })
    if (url.pathname.endsWith('/rpc/edge_rate_hit')) return json(true)
    throw new Error(`unexpected fetch ${url}`)
  }
  const { default: handler } = await loadApi(source => (
    source.replace('const MAX_HOLD_MS = 20000', 'const MAX_HOLD_MS = 0')
  ))

  const response = await handler(request('conversation', USER_B, ''))

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { rows: [], next_since: '' })
})

test('keyset cursor drains more than one limit of identical timestamps without dropping rows', async () => {
  const createdAt = '2026-07-18T00:00:01.000Z'
  const initialSince = '2026-07-18T00:00:00.000Z'
  const rows = Array.from({ length: 30 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    conversation_id: USER_B,
    sender_id: USER_A,
    created_at: createdAt,
  }))
  const messageUrls = []
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname === '/auth/v1/user') return json({ id: USER_A })
    if (url.pathname.endsWith('/rpc/edge_rate_hit')) return json(true)
    if (url.pathname === '/rest/v1/messages') {
      messageUrls.push(url)
      const legacyFilter = url.searchParams.get('created_at')
      const keysetFilter = url.searchParams.get('or')
      if (legacyFilter === `gt.${initialSince}`) return json(rows.slice(0, 25))
      if (keysetFilter?.includes(`id.gt.${rows[24].id}`)) return json(rows.slice(25))
      return json({ error: 'cursor_did_not_advance' }, 409)
    }
    throw new Error(`unexpected fetch ${url}`)
  }
  const { default: handler } = await loadApi()

  const firstResponse = await handler(request('conversation', USER_B, initialSince))
  assert.equal(firstResponse.status, 200)
  const first = await firstResponse.json()
  assert.equal(first.rows.length, 25)

  const secondResponse = await handler(request('conversation', USER_B, first.next_since))
  assert.equal(secondResponse.status, 200)
  const second = await secondResponse.json()

  assert.equal(second.rows.length, 5)
  assert.deepEqual(
    [...first.rows, ...second.rows].map(row => row.id),
    rows.map(row => row.id),
  )
  assert.equal(new Set([...first.rows, ...second.rows].map(row => row.id)).size, 30)
  assert.ok(first.next_since.endsWith(`|${rows[24].id}`))
  assert.ok(second.next_since.endsWith(`|${rows[29].id}`))
  assert.equal(messageUrls[1].searchParams.get('created_at'), null)
  assert.match(messageUrls[1].searchParams.get('or'), /created_at\.gt\..+id\.gt\./)
})

test('malformed database seed fails closed instead of advancing an unsafe cursor', async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname === '/auth/v1/user') return json({ id: USER_A })
    if (url.pathname.endsWith('/rpc/edge_rate_hit')) return json(true)
    if (url.pathname === '/rest/v1/messages') return json({ created_at: 'wrong-shape' })
    throw new Error(`unexpected fetch ${url}`)
  }
  const { default: handler } = await loadApi()

  const response = await handler(request('conversation', USER_B, 'now'))

  assert.equal(response.status, 500)
  assert.deepEqual(await response.json(), { error: 'postgrest_malformed' })
})

test('malformed poll rows fail closed instead of silently holding or returning a broken cursor', async () => {
  for (const badRows of [
    { wrong: 'shape' },
    [{ id: USER_B }],
    [{ id: 'not-a-uuid', created_at: '2026-07-18T00:00:01.000Z' }],
    [
      { id: 'not-a-uuid', created_at: '2026-07-18T00:00:01.000Z' },
      { id: MESSAGE_A, created_at: '2026-07-18T00:00:01.000Z' },
    ],
  ]) {
    globalThis.fetch = async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.pathname === '/auth/v1/user') return json({ id: USER_A })
      if (url.pathname.endsWith('/rpc/edge_rate_hit')) return json(true)
      if (url.pathname === '/rest/v1/messages') return json(badRows)
      throw new Error(`unexpected fetch ${url}`)
    }
    const { default: handler } = await loadApi()

    const response = await handler(request('conversation', USER_B))

    assert.equal(response.status, 500)
    assert.deepEqual(await response.json(), { error: 'postgrest_malformed' })
  }
})

test('long-poll fails closed when its amplification limiter is unavailable', async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname === '/auth/v1/user') return json({ id: USER_A })
    if (url.pathname.endsWith('/rpc/edge_rate_hit')) return json({ error: 'down' }, 503)
    throw new Error(`unexpected fetch ${url}`)
  }
  const { default: handler } = await loadApi()

  const response = await handler(request('inbox', USER_A))
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'rate_limit_unavailable' })
})

test('auth and poll upstream deadlines abort hangs and expose only stable errors', async () => {
  let authAborted = false
  globalThis.fetch = async (_input, init = {}) => new Promise((_, reject) => {
    init.signal?.addEventListener('abort', () => {
      authAborted = true
      reject(new DOMException('aborted', 'AbortError'))
    }, { once: true })
  })
  const { default: authTimeoutHandler } = await loadApi(source => (
    source.replace('const UPSTREAM_TIMEOUT_MS = 1500', 'const UPSTREAM_TIMEOUT_MS = 10')
  ))

  const authTimeout = await authTimeoutHandler(request('conversation', USER_B))
  assert.equal(authTimeout.status, 401)
  assert.deepEqual(await authTimeout.json(), { error: 'auth_required' })
  assert.equal(authAborted, true)

  let bodyCancelled = false
  const redirects = []
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    redirects.push(init.redirect)
    if (url.pathname === '/auth/v1/user') return json({ id: USER_A })
    if (url.pathname.endsWith('/rpc/edge_rate_hit')) return json(true)
    if (url.pathname === '/rest/v1/messages') {
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('[')) },
        cancel() { bodyCancelled = true },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    throw new Error(`unexpected fetch ${url}`)
  }
  const { default: bodyTimeoutHandler } = await loadApi(source => (
    source.replace('const UPSTREAM_TIMEOUT_MS = 1500', 'const UPSTREAM_TIMEOUT_MS = 10')
  ))

  const bodyTimeout = await bodyTimeoutHandler(request('conversation', USER_B))
  assert.equal(bodyTimeout.status, 500)
  assert.deepEqual(await bodyTimeout.json(), { error: 'fetch_error' })
  assert.equal(bodyCancelled, true)
  assert.ok(redirects.length >= 3)
  assert.ok(redirects.every(value => value === 'error'))
})

for (const [responseKind, limiterResponse] of malformedLimiterResponses) {
  test(`long-poll rejects a 200 ${responseKind} limiter response`, async () => {
    const calls = []
    globalThis.fetch = async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      calls.push(url)
      if (url.pathname === '/auth/v1/user') return json({ id: USER_A })
      if (url.pathname.endsWith('/rpc/edge_rate_hit')) return limiterResponse()
      throw new Error(`unexpected fetch ${url}`)
    }
    const { default: handler } = await loadApi()

    const response = await handler(request('inbox', USER_A))

    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { error: 'rate_limit_unavailable' })
    assert.equal(calls.some(url => url.pathname === '/rest/v1/messages'), false)
  })
}

test('invalid ids and cursors are rejected before any upstream work', async () => {
  globalThis.fetch = async () => { throw new Error('upstream should not be called') }
  const { default: handler } = await loadApi()

  const badId = await handler(request('conversation', 'not-a-uuid'))
  assert.equal(badId.status, 400)
  assert.deepEqual(await badId.json(), { error: 'bad_id' })

  const badSince = await handler(request('conversation', USER_A, 'not-a-date'))
  assert.equal(badSince.status, 400)
  assert.deepEqual(await badSince.json(), { error: 'bad_since' })
})
