// Leading underscore prevents Vercel from treating this test as an API Function.
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { inlineDeploymentBoundaryImport } from './_test-module-loader.mjs'

const API_ROOT = new URL('./', import.meta.url)
const USER_A = '11111111-1111-4111-8111-111111111111'
const USER_B = '22222222-2222-4222-8222-222222222222'
const MEETUP_ID = '33333333-3333-4333-8333-333333333333'
const CONVERSATION_ID = '44444444-4444-4444-8444-444444444444'
const ITEM_ID = '55555555-5555-4555-8555-555555555555'
const NOTIFICATION_ID = '66666666-6666-4666-8666-666666666666'
const ENV_KEYS = [
  'SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY', 'OPENAI_API_KEY',
  'RESEND_API_KEY', 'DIGEST_TEST_EMAIL', 'DIGEST_LIVE', 'DIGEST_APP_URL',
  'MEETUP_APP_URL', 'VERCEL_ENV', 'VERCEL_URL',
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
  const encoded = Buffer.from(inlineDeploymentBoundaryImport(source)).toString('base64')
  return import(`data:text/javascript;base64,${encoded}#external-hardening-${nonce++}`)
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
  SUPABASE_SERVICE_ROLE_KEY: 'service-test',
  SUPABASE_ANON_KEY: 'anon-test',
}

for (const endpoint of ['translate.js', 'moderate.js']) {
  test(`${endpoint} authenticates before rejecting an oversized request body`, async () => {
    const calls = []
    globalThis.fetch = async (input, init = {}) => {
      const url = urlOf(input)
      calls.push({ url, init })
      if (url.pathname === '/auth/v1/user') return json({ id: USER_A })
      throw new Error(`unexpected fetch ${url}`)
    }
    const { default: handler } = await loadApi(endpoint, supabaseEnv)
    const response = await handler(new Request(`https://app.test/api/${endpoint.slice(0, -3)}`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer user-token',
        'Content-Type': 'application/json',
        'Content-Length': '70000',
      },
      body: '{}',
    }))

    assert.equal(response.status, 413)
    assert.deepEqual(await response.json(), { error: 'body_too_large' })
    assert.equal(calls.length, 1)
    assert.ok(calls[0].init.signal instanceof AbortSignal)
  })
}

test('moderation rejects over-limit text instead of silently checking a prefix', async () => {
  globalThis.fetch = async (input) => {
    const url = urlOf(input)
    if (url.pathname === '/auth/v1/user') return json({ id: USER_A })
    throw new Error(`unexpected fetch ${url}`)
  }
  const { default: handler } = await loadApi('moderate.js', supabaseEnv)
  const response = await handler(new Request('https://app.test/api/moderate', {
    method: 'POST',
    headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'x'.repeat(8001) }),
  }))

  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: 'input_too_large' })
})

test('translation uses deadlines and rejects a non-JSON model payload', async () => {
  const calls = []
  let invalidPayload = false
  globalThis.fetch = async (input, init = {}) => {
    const url = urlOf(input)
    calls.push({ url, init })
    if (url.pathname === '/auth/v1/user') return json({ id: USER_A })
    if (url.pathname.endsWith('/rpc/edge_rate_hit')) return json(true)
    if (url.pathname === '/v1/chat/completions') {
      const content = invalidPayload ? 'not-json' : JSON.stringify({ translated: '台灯' })
      return json({ choices: [{ message: { content } }] })
    }
    throw new Error(`unexpected fetch ${url}`)
  }
  const { default: handler } = await loadApi('translate.js', {
    ...supabaseEnv,
    OPENAI_API_KEY: 'openai-test',
  })

  const makeRequest = () => new Request('https://app.test/api/translate', {
    method: 'POST',
    headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'desk lamp', target: 'zh' }),
  })
  const success = await handler(makeRequest())
  assert.deepEqual(await success.json(), { translated: '台灯', target: 'zh' })

  invalidPayload = true
  const malformed = await handler(makeRequest())
  assert.deepEqual(await malformed.json(), {
    translated: '',
    skipped: true,
    reason: 'bad_upstream_payload',
  })
  assert.equal(calls.every(call => call.init.signal instanceof AbortSignal), true)
})

test('configured moderation fails closed on malformed/provider errors and never logs provider bodies', async () => {
  let providerMode = 'malformed'
  const logs = []
  console.error = (...args) => logs.push(args.join(' '))
  globalThis.fetch = async (input) => {
    const url = urlOf(input)
    if (url.pathname === '/auth/v1/user') return json({ id: USER_A })
    if (url.pathname.endsWith('/rpc/edge_rate_hit')) return json(true)
    if (url.pathname === '/v1/moderations') {
      if (providerMode === 'error') return new Response('private-project@example.com', { status: 500 })
      return json({ results: [{}] })
    }
    throw new Error(`unexpected fetch ${url}`)
  }
  const { default: handler } = await loadApi('moderate.js', {
    ...supabaseEnv,
    OPENAI_API_KEY: 'openai-test',
  })
  const makeRequest = () => new Request('https://app.test/api/moderate', {
    method: 'POST',
    headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'desk lamp' }),
  })

  const malformed = await handler(makeRequest())
  assert.equal(malformed.status, 502)
  assert.deepEqual(await malformed.json(), { error: 'moderation_unavailable' })

  providerMode = 'error'
  const upstreamError = await handler(makeRequest())
  assert.equal(upstreamError.status, 502)
  assert.deepEqual(await upstreamError.json(), { error: 'moderation_unavailable' })
  assert.equal(logs.some(line => line.includes('private-project@example.com')), false)
})

test('live meetup mail resolves and stamps one exact event, then closes replays before Resend', async () => {
  const calls = []
  let emailedAt = null
  let resendCalls = 0
  const claimToken = '77777777-7777-4777-8777-777777777777'
  globalThis.fetch = async (input, init = {}) => {
    const url = urlOf(input)
    const method = String(init.method || 'GET').toUpperCase()
    const body = init.body ? JSON.parse(String(init.body)) : null
    calls.push({ url, method, body, signal: init.signal, headers: init.headers || {} })

    if (url.pathname === '/auth/v1/user') return json({ id: USER_A })
    if (url.pathname.endsWith('/rpc/edge_rate_hit')) {
      return json(true)
    }
    if (url.pathname.endsWith('/rpc/resolve_meetup_email_notification')) {
      return json([{
        notification_id: NOTIFICATION_ID,
        source_event_key: `meetup:${MEETUP_ID}:pending`,
        emailed_at: emailedAt,
      }])
    }
    if (url.pathname.endsWith('/rpc/claim_notification_email_delivery')) {
      if (emailedAt) return json([])
      return json([{
        delivery_key: `immediate/${NOTIFICATION_ID}`,
        claim_token: claimToken,
        notification_ids: [NOTIFICATION_ID],
      }])
    }
    if (url.pathname.endsWith('/rpc/begin_notification_email_delivery')) {
      return json(1)
    }
    if (url.pathname.endsWith('/rpc/complete_notification_email_delivery')) {
      emailedAt = '2026-07-18T01:03:04.000Z'
      return json(1)
    }
    if (url.pathname.endsWith('/rpc/release_notification_email_delivery')) {
      return json(1)
    }
    if (url.pathname === '/rest/v1/meetups') {
      return json([{
        id: MEETUP_ID,
        conversation_id: CONVERSATION_ID,
        item_id: ITEM_ID,
        from_user: USER_A,
        to_user: USER_B,
        spot: 'Grainger <img src=x onerror=alert(1)>',
        meet_at: '2026-07-20T18:00:00.000Z',
        note: '\"><script>alert(1)</script>',
        status: 'pending',
        parent_meetup_id: null,
        updated_at: '2026-07-18T01:02:03.000Z',
      }])
    }
    if (url.pathname === '/rest/v1/profiles') {
      return json([
        { id: USER_A, email: 'sender@example.com', nickname: 'Sender <script>alert(1)</script>', email_digest_opt_out: false },
        { id: USER_B, email: 'recipient@example.com', nickname: 'Recipient', email_digest_opt_out: false },
      ])
    }
    if (url.pathname === '/rest/v1/items') return json([{ title: '<b>Desk lamp</b>' }])
    if (url.pathname === '/rest/v1/blocks') return json([])
    if (url.hostname === 'api.resend.com') {
      resendCalls++
      return json({ id: 'mail-id' })
    }
    throw new Error(`unexpected fetch ${method} ${url}`)
  }
  const { default: handler } = await loadApi('meetup-notify.js', {
    ...supabaseEnv,
    RESEND_API_KEY: 'resend-test',
    DIGEST_LIVE: 'true',
    MEETUP_APP_URL: 'https://app.test',
  })
  const makeRequest = () => new Request('https://app.test/api/meetup-notify', {
    method: 'POST',
    headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ meetup_id: MEETUP_ID }),
  })

  const first = await handler(makeRequest())
  assert.deepEqual(await first.json(), { sent: true, mode: 'live' })
  const replay = await handler(makeRequest())
  assert.deepEqual(await replay.json(), { skipped: 'already_processed' })
  assert.equal(resendCalls, 1)

  const eventCall = calls.find(call => String(call.body?.bucket_in || '').startsWith('meetup-mail-event:'))
  assert.equal(eventCall, undefined)
  const resendRequests = calls.filter(call => call.url.hostname === 'api.resend.com')
  assert.equal(resendRequests[0].headers['Idempotency-Key'], `immediate/${NOTIFICATION_ID}`)
  assert.doesNotMatch(resendRequests[0].body.html, /<script>|<img src=x|<b>Desk lamp<\/b>/)
  assert.match(resendRequests[0].body.html, /&lt;script&gt;|&lt;img/)
  const resolveCalls = calls.filter(call => call.url.pathname.endsWith('/rpc/resolve_meetup_email_notification'))
  assert.equal(resolveCalls.length, 2)
  assert.deepEqual(resolveCalls[0].body, {
    meetup_id_in: MEETUP_ID,
    event_kind_in: 'pending',
    recipient_id_in: USER_B,
    conversation_id_in: CONVERSATION_ID,
  })
  const claimCalls = calls.filter(call => call.url.pathname.endsWith('/rpc/claim_notification_email_delivery'))
  assert.equal(claimCalls.length, 1)
  assert.deepEqual(claimCalls[0].body, {
    notification_ids_in: [NOTIFICATION_ID],
    delivery_kind_in: 'immediate',
    lease_seconds_in: 120,
  })
  assert.equal(calls.filter(call => call.url.pathname.endsWith('/rpc/begin_notification_email_delivery')).length, 1)
  assert.equal(calls.filter(call => call.url.pathname.endsWith('/rpc/complete_notification_email_delivery')).length, 1)
  assert.equal(calls.every(call => call.signal instanceof AbortSignal), true)
})
