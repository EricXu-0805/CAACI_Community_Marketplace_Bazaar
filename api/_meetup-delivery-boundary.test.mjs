// Leading underscore prevents Vercel from treating this test as an API Function.
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { inlineSharedApiImports } from './_test-module-loader.mjs'

const API_ROOT = new URL('./', import.meta.url)
const BUYER_A = '11111111-1111-4111-8111-111111111111'
const BUYER_B = '22222222-2222-4222-8222-222222222222'
const SELLER = '33333333-3333-4333-8333-333333333333'
const ITEM = '44444444-4444-4444-8444-444444444444'
const CONVERSATION_A = '55555555-5555-4555-8555-555555555555'
const CONVERSATION_B = '66666666-6666-4666-8666-666666666666'
const MEETUP_A = '77777777-7777-4777-8777-777777777777'
const MEETUP_B = '88888888-8888-4888-8888-888888888888'
const MEETUP_PARENT = '99999999-9999-4999-8999-999999999999'
const MEETUP_CHILD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const NOTIFICATION_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const NOTIFICATION_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const NOTIFICATION_OLD = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const NOTIFICATION_CHILD = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

const ENV_KEYS = [
  'SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY', 'RESEND_API_KEY',
  'DIGEST_TEST_EMAIL', 'DIGEST_LIVE', 'MEETUP_LIVE', 'DIGEST_APP_URL', 'MEETUP_APP_URL',
  'DIGEST_FROM', 'VERCEL_ENV', 'VERCEL_URL',
]
const originalEnv = new Map(ENV_KEYS.map(key => [key, process.env[key]]))
const originalFetch = globalThis.fetch
const originalConsoleError = console.error
const originalConsoleWarn = console.warn
let nonce = 0

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key)
    if (value == null) delete process.env[key]
    else process.env[key] = value
  }
  globalThis.fetch = originalFetch
  console.error = originalConsoleError
  console.warn = originalConsoleWarn
})

async function loadHandler(overrides = {}) {
  for (const key of ENV_KEYS) delete process.env[key]
  Object.assign(process.env, {
    SUPABASE_URL: 'https://supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-test',
    SUPABASE_ANON_KEY: 'anon-test',
    RESEND_API_KEY: 'resend-test',
    DIGEST_LIVE: 'true',
    MEETUP_APP_URL: 'https://app.test',
  }, overrides)
  // An override of undefined means "unset"; Object.assign would store the
  // string 'undefined', which reads as set.
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key]
  }
  const source = await readFile(new URL('meetup-notify.js', API_ROOT), 'utf8')
  const encoded = Buffer.from(inlineSharedApiImports(source)).toString('base64')
  return (await import(`data:text/javascript;base64,${encoded}#meetup-delivery-${nonce++}`)).default
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function meetup({
  id,
  conversationId,
  fromUser,
  toUser,
  status = 'pending',
  parentMeetupId = null,
}) {
  return {
    id,
    conversation_id: conversationId,
    item_id: ITEM,
    from_user: fromUser,
    to_user: toUser,
    spot: 'Grainger Library',
    meet_at: '2026-07-20T18:00:00.000Z',
    note: 'Front desk',
    status,
    parent_meetup_id: parentMeetupId,
    updated_at: '2026-07-18T01:02:03.000Z',
  }
}

function makeHarness({ meetups, notifications, resendStatuses = [], cachedProfileFields = {} }) {
  const calls = []
  const emailed = new Map()
  const deliveries = new Map()
  let callerId = BUYER_A
  let resendIndex = 0
  let tokenIndex = 0
  // get_my_profile answers for the bearer's own account with the canonical
  // moderation state. The default is an unrestricted caller.
  let canonicalProfile = id => json({ id, suspension_level: 0, suspended_until: null })

  const fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const body = init.body ? JSON.parse(String(init.body)) : null
    calls.push({ url, method, body, headers: init.headers || {}, signal: init.signal })

    if (url.pathname === '/auth/v1/user') return json({ id: callerId })
    if (url.pathname === '/rest/v1/rpc/get_my_profile') return canonicalProfile(callerId)
    if (url.pathname === '/rest/v1/rpc/edge_rate_hit') return json(true)
    if (url.pathname === '/rest/v1/rpc/resolve_meetup_email_notification') {
      const key = `meetup:${body.meetup_id_in}:${body.event_kind_in}`
      const notification = notifications.get(key)
      if (!notification) return json([])
      return json([{
        notification_id: notification,
        source_event_key: key,
        emailed_at: emailed.get(notification) || null,
      }])
    }
    if (url.pathname === '/rest/v1/rpc/claim_notification_email_delivery') {
      const id = body.notification_ids_in?.[0]
      if (!id || emailed.has(id)) return json([])
      const existing = deliveries.get(id)
      if (existing?.active || (existing?.kind && existing.kind !== body.delivery_kind_in)) return json([])
      tokenIndex++
      const token = `f0000000-0000-4000-8000-${tokenIndex.toString(16).padStart(12, '0')}`
      const delivery = existing || {
        kind: body.delivery_kind_in,
        key: `${body.delivery_kind_in}/${id}`,
        attempted: false,
      }
      Object.assign(delivery, { active: true, token })
      deliveries.set(id, delivery)
      return json([{
        delivery_key: delivery.key,
        claim_token: token,
        notification_ids: [id],
      }])
    }
    if (url.pathname === '/rest/v1/rpc/begin_notification_email_delivery') {
      const delivery = [...deliveries.values()].find(row => (
        row.token === body.claim_token_in && row.key === body.delivery_key_in && row.active
      ))
      if (!delivery) return json(0)
      delivery.attempted = true
      return json(1)
    }
    if (url.pathname === '/rest/v1/rpc/complete_notification_email_delivery') {
      const entry = [...deliveries.entries()].find(([, row]) => (
        row.token === body.claim_token_in && row.key === body.delivery_key_in && row.active && row.attempted
      ))
      if (!entry) return json(0)
      emailed.set(entry[0], '2026-07-18T02:03:04.000Z')
      return json(1)
    }
    if (url.pathname === '/rest/v1/rpc/release_notification_email_delivery') {
      const delivery = [...deliveries.values()].find(row => (
        row.token === body.claim_token_in && row.key === body.delivery_key_in && row.active
      ))
      if (!delivery) return json(0)
      delivery.active = false
      delivery.token = null
      if (!delivery.attempted) {
        delivery.kind = null
        delivery.key = null
      }
      return json(1)
    }
    if (url.pathname === '/rest/v1/meetups') {
      const parentFilter = url.searchParams.get('parent_meetup_id')
      if (parentFilter?.startsWith('eq.')) {
        const parentId = parentFilter.slice(3)
        return json([...meetups.values()].filter(row => (
          row.parent_meetup_id === parentId && row.status === 'pending'
        )))
      }
      const idFilter = url.searchParams.get('id')
      const id = idFilter?.startsWith('eq.') ? idFilter.slice(3) : ''
      return json(meetups.has(id) ? [meetups.get(id)] : [])
    }
    if (url.pathname === '/rest/v1/profiles') {
      return json([
        { id: BUYER_A, email: 'buyer-a@example.com', nickname: 'Buyer A', email_digest_opt_out: false },
        { id: BUYER_B, email: 'buyer-b@example.com', nickname: 'Buyer B', email_digest_opt_out: false },
        { id: SELLER, email: 'seller@example.com', nickname: 'Seller', email_digest_opt_out: false },
      ].map(row => ({ ...row, ...cachedProfileFields })))
    }
    if (url.pathname === '/rest/v1/items') return json([{ title: 'Desk lamp' }])
    if (url.pathname === '/rest/v1/blocks') return json([])
    if (url.hostname === 'api.resend.com' && url.pathname === '/emails') {
      const status = resendStatuses[resendIndex++] || 200
      return status === 200 ? json({ id: `mail-${resendIndex}` }) : json({ error: 'send failed' }, status)
    }
    throw new Error(`unexpected fetch ${method} ${url}`)
  }

  return {
    calls,
    emailed,
    fetch,
    setCaller(value) { callerId = value },
    setCanonicalProfile(value) { canonicalProfile = value },
  }
}

function invoke(handler, meetupId) {
  return handler(new Request('https://app.test/api/meetup-notify', {
    method: 'POST',
    headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ meetup_id: meetupId }),
  }))
}

function rpcCalls(harness, name) {
  return harness.calls.filter(call => call.url.pathname.endsWith(`/rpc/${name}`))
}

test('two buyers of one item stamp only their own meetup event notification', async () => {
  const meetups = new Map([
    [MEETUP_A, meetup({ id: MEETUP_A, conversationId: CONVERSATION_A, fromUser: BUYER_A, toUser: SELLER })],
    [MEETUP_B, meetup({ id: MEETUP_B, conversationId: CONVERSATION_B, fromUser: BUYER_B, toUser: SELLER })],
  ])
  const notifications = new Map([
    [`meetup:${MEETUP_A}:pending`, NOTIFICATION_A],
    [`meetup:${MEETUP_B}:pending`, NOTIFICATION_B],
  ])
  const harness = makeHarness({ meetups, notifications })
  globalThis.fetch = harness.fetch
  const handler = await loadHandler()

  harness.setCaller(BUYER_A)
  assert.deepEqual(await (await invoke(handler, MEETUP_A)).json(), { sent: true, mode: 'live' })
  harness.setCaller(BUYER_B)
  assert.deepEqual(await (await invoke(handler, MEETUP_B)).json(), { sent: true, mode: 'live' })

  assert.deepEqual(rpcCalls(harness, 'claim_notification_email_delivery').map(call => call.body.notification_ids_in), [
    [NOTIFICATION_A],
    [NOTIFICATION_B],
  ])
  assert.equal(rpcCalls(harness, 'complete_notification_email_delivery').length, 2)
  assert.equal(harness.calls.some(call => call.url.pathname === '/rest/v1/notifications'), false)
})

test('a rescheduled parent follows the pending child and cannot stamp an older same-conversation event', async () => {
  const parent = meetup({
    id: MEETUP_PARENT,
    conversationId: CONVERSATION_A,
    fromUser: BUYER_A,
    toUser: SELLER,
    status: 'rescheduled',
  })
  const child = meetup({
    id: MEETUP_CHILD,
    conversationId: CONVERSATION_A,
    fromUser: SELLER,
    toUser: BUYER_A,
    parentMeetupId: MEETUP_PARENT,
  })
  const meetups = new Map([[MEETUP_PARENT, parent], [MEETUP_CHILD, child]])
  const notifications = new Map([
    [`meetup:${MEETUP_PARENT}:accepted`, NOTIFICATION_OLD],
    [`meetup:${MEETUP_CHILD}:pending`, NOTIFICATION_CHILD],
  ])
  const harness = makeHarness({ meetups, notifications })
  harness.setCaller(SELLER)
  globalThis.fetch = harness.fetch
  const handler = await loadHandler()

  assert.deepEqual(await (await invoke(handler, MEETUP_PARENT)).json(), { sent: true, mode: 'live' })
  assert.deepEqual(rpcCalls(harness, 'resolve_meetup_email_notification').map(call => call.body), [{
    meetup_id_in: MEETUP_CHILD,
    event_kind_in: 'pending',
    recipient_id_in: BUYER_A,
    conversation_id_in: CONVERSATION_A,
  }])
  assert.deepEqual(rpcCalls(harness, 'claim_notification_email_delivery').map(call => call.body.notification_ids_in), [[
    NOTIFICATION_CHILD,
  ]])
  assert.equal(rpcCalls(harness, 'complete_notification_email_delivery').length, 1)
  assert.equal(harness.emailed.has(NOTIFICATION_OLD), false)
})

test('provider failure leaves the exact event unstamped; retry reuses one key and later replay stops before Resend', async () => {
  const meetups = new Map([
    [MEETUP_A, meetup({ id: MEETUP_A, conversationId: CONVERSATION_A, fromUser: BUYER_A, toUser: SELLER })],
  ])
  const notifications = new Map([[`meetup:${MEETUP_A}:pending`, NOTIFICATION_A]])
  const harness = makeHarness({ meetups, notifications, resendStatuses: [500, 200] })
  globalThis.fetch = harness.fetch
  const logged = []
  console.error = (...args) => logged.push(args)
  const handler = await loadHandler()

  const failed = await invoke(handler, MEETUP_A)
  assert.equal(failed.status, 500)
  assert.deepEqual(await failed.json(), { error: 'internal' })
  // The log has to say which failure this was. A bare constant is how the
  // first live sends failed on 2026-09-01 with no way to tell a rejected key
  // from a timeout; the provider status is all that may be said.
  assert.deepEqual(logged, [['meetup_notify_failed', 'resend_500']])
  assert.equal(rpcCalls(harness, 'complete_notification_email_delivery').length, 0)
  assert.equal(harness.emailed.has(NOTIFICATION_A), false)

  assert.deepEqual(await (await invoke(handler, MEETUP_A)).json(), { sent: true, mode: 'live' })
  assert.deepEqual(await (await invoke(handler, MEETUP_A)).json(), { skipped: 'already_processed' })

  const sends = harness.calls.filter(call => call.url.hostname === 'api.resend.com')
  assert.equal(sends.length, 2)
  assert.deepEqual(sends.map(call => call.headers['Idempotency-Key']), [
    `immediate/${NOTIFICATION_A}`,
    `immediate/${NOTIFICATION_A}`,
  ])
  assert.equal(rpcCalls(harness, 'complete_notification_email_delivery').length, 1)
  assert.equal(rpcCalls(harness, 'release_notification_email_delivery').length, 1)
  assert.equal(rpcCalls(harness, 'edge_rate_hit').filter(call => (
    String(call.body?.bucket_in || '').startsWith('meetup-mail-event:')
  )).length, 0)
})

test('a missing exact event row falls back to the digest without sending or stamping', async () => {
  const meetups = new Map([
    [MEETUP_A, meetup({ id: MEETUP_A, conversationId: CONVERSATION_A, fromUser: BUYER_A, toUser: SELLER })],
  ])
  const harness = makeHarness({ meetups, notifications: new Map() })
  globalThis.fetch = harness.fetch
  const handler = await loadHandler()

  assert.deepEqual(await (await invoke(handler, MEETUP_A)).json(), { skipped: 'notification_unavailable' })
  assert.equal(harness.calls.some(call => call.url.hostname === 'api.resend.com'), false)
  assert.equal(rpcCalls(harness, 'claim_notification_email_delivery').length, 0)
})

/* The daily digest and instant meetup mail shared DIGEST_LIVE. The beta step in
   RUNBOOK tells an operator to quiet the digest, and on one flag that also
   stopped telling people their meetup was accepted — inert 200, no error
   anywhere. These four pin the split: MEETUP_LIVE decides this route,
   DIGEST_LIVE is only what it falls back to, and that fallback is what keeps
   production sending across the deploy that introduces the flag. */

async function attemptSend(overrides) {
  const meetups = new Map([
    [MEETUP_A, meetup({ id: MEETUP_A, conversationId: CONVERSATION_A, fromUser: BUYER_A, toUser: SELLER })],
  ])
  const notifications = new Map([[`meetup:${MEETUP_A}:pending`, NOTIFICATION_A]])
  const harness = makeHarness({ meetups, notifications })
  globalThis.fetch = harness.fetch
  const handler = await loadHandler(overrides)
  harness.setCaller(BUYER_A)
  return { body: await (await invoke(handler, MEETUP_A)).json(), harness }
}

test('MEETUP_LIVE alone sends, so the daily digest can be quiet without silencing meetup mail', async () => {
  const { body, harness } = await attemptSend({ DIGEST_LIVE: undefined, MEETUP_LIVE: 'true' })
  assert.deepEqual(body, { sent: true, mode: 'live' })
  assert.equal(harness.emailed.has(NOTIFICATION_A), true)
})

test('DIGEST_LIVE alone still sends, so the deploy that adds MEETUP_LIVE does not go dark', async () => {
  const { body, harness } = await attemptSend({ DIGEST_LIVE: 'true' })
  assert.deepEqual(body, { sent: true, mode: 'live' })
  assert.equal(harness.emailed.has(NOTIFICATION_A), true)
})

test('MEETUP_LIVE replaces DIGEST_LIVE rather than being ORed with it', async () => {
  const { body, harness } = await attemptSend({ DIGEST_LIVE: 'true', MEETUP_LIVE: 'false' })
  assert.deepEqual(body, { skipped: 'inert' })
  assert.equal(harness.emailed.has(NOTIFICATION_A), false)
})

test('neither flag set stays inert, so the split did not open a send path', async () => {
  const { body, harness } = await attemptSend({ DIGEST_LIVE: undefined })
  assert.deepEqual(body, { skipped: 'inert' })
  assert.equal(harness.emailed.has(NOTIFICATION_A), false)
})

/* D-49: an account under an active posting restriction (canonical level 2-5)
   must not trigger immediate meetup mail. The database refuses the meetup RPCs,
   so the normal follow-up call never happens, but this endpoint can be called
   on its own for an older event. The caller's state comes from get_my_profile,
   asked with the caller's own bearer and the public key, after the inert and
   configuration exits and before the rate-limit write, any delivery claim, or
   Resend. An answer that cannot be read is an outage, never a restriction. */

const CANONICAL_PATH = '/rest/v1/rpc/get_my_profile'

async function attemptWithCanonical(canonicalProfile, { env = {}, cachedProfileFields = {} } = {}) {
  const meetups = new Map([
    [MEETUP_A, meetup({ id: MEETUP_A, conversationId: CONVERSATION_A, fromUser: BUYER_A, toUser: SELLER })],
  ])
  const notifications = new Map([[`meetup:${MEETUP_A}:pending`, NOTIFICATION_A]])
  const harness = makeHarness({ meetups, notifications, cachedProfileFields })
  harness.setCaller(BUYER_A)
  harness.setCanonicalProfile(canonicalProfile)
  globalThis.fetch = harness.fetch
  const logged = []
  console.error = (...args) => logged.push(['error', ...args])
  console.warn = (...args) => logged.push(['warn', ...args])
  const handler = await loadHandler(env)
  const response = await invoke(handler, MEETUP_A)
  return { response, body: await response.json(), harness, logged }
}

function contacted(harness) {
  return harness.calls.map(call => (
    call.url.hostname === 'api.resend.com' ? 'resend' : call.url.pathname
  ))
}

const ACTIVE_RESTRICTIONS = [
  ['L2 with a finite end', 2, '2026-12-01T03:04:05.678901+00:00', 'suspension_active:2:2026-12-01T03:04:05Z'],
  ['L2 with no end', 2, null, 'suspension_active:2:permanent'],
  ['L3 with a finite end in another zone', 3, '2026-12-01T03:04:05-06:00', 'suspension_active:3:2026-12-01T09:04:05Z'],
  ['L3 with no end', 3, null, 'suspension_active:3:permanent'],
  ['L4 with a finite end', 4, '2027-01-02T00:00:00Z', 'suspension_active:4:2027-01-02T00:00:00Z'],
  ['L4 with an infinite end', 4, 'infinity', 'suspension_active:4:permanent'],
  ['L5 with a finite end', 5, '2026-11-30T23:59:59+00:00', 'suspension_active:5:2026-11-30T23:59:59Z'],
  ['L5 with an infinite end', 5, 'infinity', 'suspension_active:5:permanent'],
]
const SEND_MODES = [
  ['live', {}],
  ['test-sink', { DIGEST_LIVE: undefined, DIGEST_TEST_EMAIL: 'sink@example.com' }],
]

for (const [label, level, until, message] of ACTIVE_RESTRICTIONS) {
  for (const [mode, env] of SEND_MODES) {
    test(`a caller under ${label} is refused before any ${mode} side effect`, async () => {
      const { response, body, harness, logged } = await attemptWithCanonical(
        id => json({ id, suspension_level: level, suspended_until: until }),
        { env },
      )
      assert.equal(response.status, 403)
      assert.deepEqual(body, { error: 'suspension_active', message })
      // Nothing after the canonical lookup: no rate-limit write, no meetup or
      // notification read, no delivery claim, no provider call.
      assert.deepEqual(contacted(harness), ['/auth/v1/user', CANONICAL_PATH])
      assert.equal(harness.emailed.size, 0)
      // An expected refusal is not an error and is not logged as one.
      assert.deepEqual(logged, [])
    })
  }
}

for (const [label, level, until] of [
  ['L0', 0, null],
  ['L1 with a finite end', 1, '2026-12-01T03:04:05+00:00'],
  ['L1 with no end', 1, null],
  ['L1 with an infinite end', 1, 'infinity'],
]) {
  test(`a caller at ${label} still sends`, async () => {
    const { body, harness } = await attemptWithCanonical(
      id => json({ id, suspension_level: level, suspended_until: until }),
    )
    assert.deepEqual(body, { sent: true, mode: 'live' })
    assert.equal(harness.emailed.has(NOTIFICATION_A), true)
  })
}

test('an expired or lifted restriction that survives only in the cached profile columns does not block', async () => {
  // The canonical state stops reporting a restriction once it expires or is
  // lifted; the public cache can still show level 5 with a future end.
  const { body, harness } = await attemptWithCanonical(
    id => json({ id, suspension_level: 0, suspended_until: null }),
    { cachedProfileFields: { suspension_level: 5, suspended_until: '2099-01-01T00:00:00+00:00' } },
  )
  assert.deepEqual(body, { sent: true, mode: 'live' })
  assert.equal(harness.emailed.has(NOTIFICATION_A), true)
})

test('an active restriction is refused even when the cached profile columns look unrestricted', async () => {
  const { response, body, harness } = await attemptWithCanonical(
    id => json({ id, suspension_level: 3, suspended_until: '2026-12-01T03:04:05+00:00' }),
    { cachedProfileFields: { suspension_level: 0, suspended_until: null } },
  )
  assert.equal(response.status, 403)
  assert.deepEqual(body, { error: 'suspension_active', message: 'suspension_active:3:2026-12-01T03:04:05Z' })
  assert.deepEqual(contacted(harness), ['/auth/v1/user', CANONICAL_PATH])
})

test('the canonical state is asked with the public key and the caller bearer, before the rate-limit write', async () => {
  const { body, harness } = await attemptWithCanonical(
    id => json({ id, suspension_level: 0, suspended_until: null }),
  )
  assert.deepEqual(body, { sent: true, mode: 'live' })
  const lookups = harness.calls.filter(call => call.url.pathname === CANONICAL_PATH)
  assert.equal(lookups.length, 1)
  assert.equal(lookups[0].method, 'POST')
  assert.equal(lookups[0].headers.apikey, 'anon-test')
  assert.equal(lookups[0].headers.Authorization, 'Bearer user-token')
  assert.equal(JSON.stringify(lookups[0].headers).includes('service-test'), false)
  const order = contacted(harness)
  assert.equal(order.indexOf(CANONICAL_PATH), 1)
  assert.ok(order.indexOf(CANONICAL_PATH) < order.indexOf('/rest/v1/rpc/edge_rate_hit'))
})

for (const [label, answer] of [
  ['an upstream failure', () => json({ message: 'boom' }, 500)],
  ['a permission failure', () => json({ code: '42501', message: 'permission denied' }, 403)],
  ['a body that is not JSON', () => new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } })],
  ['a null profile', () => json(null)],
  ['an array of profiles', id => json([{ id, suspension_level: 0, suspended_until: null }])],
  ['another account', () => json({ id: BUYER_B, suspension_level: 0, suspended_until: null })],
  ['a missing id', () => json({ suspension_level: 0, suspended_until: null })],
  ['a missing level', id => json({ id, suspended_until: null })],
  ['a null level', id => json({ id, suspension_level: null, suspended_until: null })],
  ['a textual level', id => json({ id, suspension_level: '3', suspended_until: null })],
  ['a fractional level', id => json({ id, suspension_level: 2.5, suspended_until: null })],
  ['a level above the scale', id => json({ id, suspension_level: 6, suspended_until: null })],
  ['a negative level', id => json({ id, suspension_level: -1, suspended_until: null })],
  ['an unreadable end on an active level', id => json({ id, suspension_level: 3, suspended_until: 'next tuesday' })],
  ['a numeric end on an active level', id => json({ id, suspension_level: 3, suspended_until: 1764547200 })],
  ['a transport failure', () => { throw new Error('socket hang up') }],
]) {
  test(`${label} from the canonical lookup is an outage, not a restriction`, async () => {
    const { response, body, harness, logged } = await attemptWithCanonical(answer)
    assert.equal(response.status, 503)
    assert.deepEqual(body, { error: 'account_state_unavailable' })
    assert.deepEqual(contacted(harness), ['/auth/v1/user', CANONICAL_PATH])
    assert.equal(harness.emailed.size, 0)
    assert.deepEqual(logged, [['warn', 'meetup_notify_account_state_unavailable']])
  })
}
