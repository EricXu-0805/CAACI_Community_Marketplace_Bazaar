// Leading underscore prevents Vercel from treating this test as an API Function.
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { inlineDeploymentBoundaryImport } from './_test-module-loader.mjs'

const API_ROOT = new URL('./', import.meta.url)
const USER_A = '11111111-1111-4111-8111-111111111111'
const USER_B = '22222222-2222-4222-8222-222222222222'
const CONVERSATION = '33333333-3333-4333-8333-333333333333'
const MEETUP = '44444444-4444-4444-8444-444444444444'
const MESSAGE = '55555555-5555-4555-8555-555555555555'
const NOTIFICATION = '66666666-6666-4666-8666-666666666666'
const NOTIFICATION_2 = '88888888-8888-4888-8888-888888888888'
const NOTIFICATION_3 = '99999999-9999-4999-8999-999999999999'
const NOTIFICATION_4 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ITEM = '77777777-7777-4777-8777-777777777777'

const ENV_KEYS = [
  'SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY', 'RESEND_API_KEY',
  'CRON_SECRET', 'DIGEST_TEST_EMAIL', 'DIGEST_LIVE', 'DIGEST_APP_URL',
  'MEETUP_APP_URL', 'DIGEST_FROM', 'SENTRY_DSN', 'VITE_SENTRY_DSN',
  'VERCEL_ENV', 'VERCEL_URL',
]
const originalEnv = new Map(ENV_KEYS.map(key => [key, process.env[key]]))
const originalFetch = globalThis.fetch
const originalConsoleError = console.error
const originalConsoleWarn = console.warn
let importNonce = 0

function restoreEnvironment() {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key)
    if (value == null) delete process.env[key]
    else process.env[key] = value
  }
}

afterEach(() => {
  restoreEnvironment()
  globalThis.fetch = originalFetch
  console.error = originalConsoleError
  console.warn = originalConsoleWarn
})

async function loadApi(filename, env) {
  for (const key of ENV_KEYS) delete process.env[key]
  Object.assign(process.env, env)
  const source = await readFile(new URL(filename, API_ROOT), 'utf8')
  const encoded = Buffer.from(inlineDeploymentBoundaryImport(source)).toString('base64')
  return import(`data:text/javascript;base64,${encoded}#blocked-email-test-${importNonce++}`)
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function empty(status = 204) {
  return new Response(null, { status })
}

function requestMethod(input, init) {
  return String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
}

function requestUrl(input) {
  return new URL(input instanceof Request ? input.url : String(input))
}

function requestBody(init) {
  if (!init?.body) return null
  return JSON.parse(String(init.body))
}

function meetupRow() {
  return {
    id: MEETUP,
    conversation_id: CONVERSATION,
    item_id: ITEM,
    from_user: USER_A,
    to_user: USER_B,
    spot: 'Grainger Library',
    meet_at: '2026-07-18T12:00:00.000Z',
    note: 'Front desk',
    status: 'pending',
    parent_meetup_id: null,
  }
}

function instantFetch({ blockRows = [], blockStatus = 200 } = {}) {
  const calls = []
  const fetch = async (input, init = {}) => {
    const url = requestUrl(input)
    const method = requestMethod(input, init)
    calls.push({ url, method, body: requestBody(init) })

    if (url.pathname === '/auth/v1/user') return json({ id: USER_A })
    if (url.pathname === '/rest/v1/rpc/edge_rate_hit') return json(true)
    if (url.pathname === '/rest/v1/rpc/resolve_meetup_email_notification') {
      return json([{
        notification_id: NOTIFICATION,
        source_event_key: `meetup:${MEETUP}:pending`,
        emailed_at: null,
      }])
    }
    if (url.pathname === '/rest/v1/meetups') return json([meetupRow()])
    if (url.pathname === '/rest/v1/blocks') {
      return blockStatus === 200 ? json(blockRows) : json({ message: 'block lookup failed' }, blockStatus)
    }
    if (url.pathname === '/rest/v1/profiles') {
      return json([
        { id: USER_A, email: 'sender@example.com', nickname: 'Sender', email_digest_opt_out: false },
        { id: USER_B, email: 'recipient@example.com', nickname: 'Recipient', email_digest_opt_out: false, unsubscribe_token: 'token' },
      ])
    }
    if (url.pathname === '/rest/v1/items') return json([{ title: 'Desk lamp' }])
    if (url.hostname === 'api.resend.com' && url.pathname === '/emails') return json({ id: 'mail-id' })
    throw new Error(`unexpected fetch ${method} ${url}`)
  }
  return { fetch, calls }
}

async function runInstant(fetch) {
  globalThis.fetch = fetch
  const { default: handler } = await loadApi('meetup-notify.js', {
    SUPABASE_URL: 'https://supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-test',
    SUPABASE_ANON_KEY: 'anon-test',
    RESEND_API_KEY: 'resend-test',
    DIGEST_TEST_EMAIL: 'sink@example.com',
  })
  return handler(new Request('https://app.test/api/meetup-notify', {
    method: 'POST',
    headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ meetup_id: MEETUP }),
  }))
}

for (const [label, blockRows] of [
  ['blocker-to-blocked', [{ blocker_id: USER_A, blocked_id: USER_B }]],
  ['blocked-to-blocker', [{ blocker_id: USER_B, blocked_id: USER_A }]],
]) {
  test(`instant meetup mail is closed for ${label} without revealing direction`, async () => {
    const mock = instantFetch({ blockRows })
    const response = await runInstant(mock.fetch)

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { skipped: 'conversation_unavailable' })
    assert.equal(mock.calls.filter(call => call.url.hostname === 'api.resend.com').length, 0)
    const blockCall = mock.calls.find(call => call.url.pathname === '/rest/v1/blocks')
    assert.ok(blockCall)
    assert.match(blockCall.url.search, /blocker_id\.eq\.11111111/)
    assert.match(blockCall.url.search, /blocker_id\.eq\.22222222/)
  })
}

test('instant meetup mail sends when neither direction is blocked', async () => {
  const mock = instantFetch()
  const response = await runInstant(mock.fetch)

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { sent: true, mode: 'test' })
  const sends = mock.calls.filter(call => call.url.hostname === 'api.resend.com')
  assert.equal(sends.length, 1)
  assert.equal(mock.calls.some(call => call.url.pathname === '/rest/v1/profiles'), false)
  assert.equal(mock.calls.some(call => call.url.pathname === '/rest/v1/items'), false)
  assert.deepEqual(sends[0].body.to, ['sink@example.com'])
  assert.match(sends[0].body.subject, /Synthetic meetup preview/)
  assert.match(sends[0].body.html, /Synthetic preview — no user content/)
  assert.doesNotMatch(
    sends[0].body.html,
    /Grainger Library|Front desk|sender@example\.com|recipient@example\.com|Recipient/,
  )
})

test('instant meetup mail fails closed when the block lookup fails', async () => {
  const warnings = []
  console.warn = (...args) => warnings.push(args)
  const mock = instantFetch({ blockStatus: 503 })
  const response = await runInstant(mock.fetch)

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { skipped: 'conversation_unavailable' })
  assert.equal(mock.calls.filter(call => call.url.hostname === 'api.resend.com').length, 0)
  assert.deepEqual(warnings, [['meetup_notify_block_boundary_unavailable']])
})

function digestFetch(options = {}) {
  const calls = []
  let notificationReads = 0
  let tokenIndex = 0
  const deliveries = new Map()
  const deliveryByNotification = new Map()
  const fetch = async (input, init = {}) => {
    const url = requestUrl(input)
    const method = requestMethod(input, init)
    const body = requestBody(init)
    calls.push({ url, method, body, headers: init.headers || {} })

    if (url.pathname === '/rest/v1/rpc/edge_rate_hit' && method === 'POST') {
      return json(options.runClaim ?? true)
    }
    if (url.pathname === '/rest/v1/rpc/seed_digest_reminders' && method === 'POST') {
      if (options.reminderSeedStatus && options.reminderSeedStatus !== 200) {
        return json({ code: 'XX000', message: 'atomic seed failed' }, options.reminderSeedStatus)
      }
      return json(options.reminderSeed ?? {
        meetup_sources_scanned: 0,
        meetup_reminders: 0,
        meetup_notifications: 0,
        unread_messages_scanned: 0,
        unread_reminders: 0,
      })
    }
    if (url.pathname === '/rest/v1/rpc/claim_notification_email_delivery' && method === 'POST') {
      if (options.claimStatus && options.claimStatus !== 200) {
        return json({ code: 'XX000', message: 'attacker-controlled claim detail' }, options.claimStatus)
      }
      const requested = [...new Set(body.notification_ids_in || [])].sort()
      const existing = requested.map(id => deliveryByNotification.get(id)).find(Boolean)
      if (existing?.active) return json([])
      const ids = existing?.kind === body.delivery_kind_in
        ? existing.ids
        : requested.filter(id => !deliveryByNotification.get(id))
      if (!ids.length) return json([])
      tokenIndex++
      const token = `f1000000-0000-4000-8000-${tokenIndex.toString(16).padStart(12, '0')}`
      const delivery = existing || {
        kind: body.delivery_kind_in,
        key: `${body.delivery_kind_in}/${ids.join('').replaceAll('-', '').slice(0, 32)}`,
        ids,
        attempted: false,
      }
      Object.assign(delivery, { active: true, token })
      deliveries.set(delivery.key, delivery)
      for (const id of delivery.ids) deliveryByNotification.set(id, delivery)
      return json([{
        delivery_key: delivery.key,
        claim_token: token,
        notification_ids: delivery.ids,
      }])
    }
    if (url.pathname === '/rest/v1/rpc/begin_notification_email_delivery' && method === 'POST') {
      if (options.beginStatus && options.beginStatus !== 200) {
        return json({ code: 'XX000', message: 'attacker-controlled begin detail' }, options.beginStatus)
      }
      const delivery = deliveries.get(body.delivery_key_in)
      if (!delivery?.active || delivery.token !== body.claim_token_in) return json(0)
      delivery.attempted = true
      return json(delivery.ids.length)
    }
    if (url.pathname === '/rest/v1/rpc/complete_notification_email_delivery' && method === 'POST') {
      if (options.markStatus && options.markStatus !== 200) {
        return json({ code: 'XX000', message: 'attacker-controlled complete detail' }, options.markStatus)
      }
      const delivery = deliveries.get(body.delivery_key_in)
      if (!delivery?.active || delivery.token !== body.claim_token_in || !delivery.attempted) return json(0)
      delivery.completed = true
      return json(delivery.ids.length)
    }
    if (url.pathname === '/rest/v1/rpc/release_notification_email_delivery' && method === 'POST') {
      const delivery = deliveries.get(body.delivery_key_in)
      if (!delivery?.active || delivery.token !== body.claim_token_in || delivery.completed) return json(0)
      delivery.active = false
      delivery.token = null
      if (!delivery.attempted) {
        deliveries.delete(delivery.key)
        for (const id of delivery.ids) deliveryByNotification.delete(id)
      }
      return json(delivery.ids.length)
    }
    if (url.pathname === '/rest/v1/meetups' && method === 'GET') return json(options.meetups || [])
    if (url.pathname === '/rest/v1/messages' && method === 'GET') return json(options.messages || [])
    if (url.pathname === '/rest/v1/blocks' && method === 'GET') {
      if (options.blockStatus && options.blockStatus !== 200) {
        return json({ code: 'XX000', message: 'block lookup failed' }, options.blockStatus)
      }
      return json(options.blockRows || [])
    }
    if (url.pathname === '/rest/v1/conversations' && method === 'GET') return json(options.conversations || [])
    if (url.pathname === '/rest/v1/profiles' && method === 'GET') return json(options.profiles || [])
    if (url.pathname === '/rest/v1/notifications' && method === 'GET') {
      notificationReads++
      const asksForConversation = (url.searchParams.get('select') || '').split(',').includes('conversation_id')
      if (asksForConversation && options.currentNotificationError) {
        return json(options.currentNotificationError.body, options.currentNotificationError.status)
      }
      if (asksForConversation && url.searchParams.get('limit') === '0') return json([])
      const idFilter = url.searchParams.get('id') || ''
      if (idFilter.startsWith('in.(')) {
        const ids = new Set(idFilter.slice(4, -1).split(','))
        const exactRows = options.exactNotifications || (
          asksForConversation ? (options.notifications || []) : (options.legacyNotifications || [])
        )
        return json(exactRows.filter(row => ids.has(row.id)))
      }
      if (typeof options.notificationPage === 'function') {
        return json(options.notificationPage(url, asksForConversation))
      }
      if ((url.searchParams.get('user_id') || '').startsWith('gt.')) return json([])
      return json(asksForConversation ? (options.notifications || []) : (options.legacyNotifications || []))
    }
    if (url.pathname.startsWith('/rest/v1/') && method === 'PATCH') return empty()
    if (url.pathname === '/rest/v1/notifications' && method === 'POST') {
      const hasConversation = Array.isArray(body) && body.some(row => Object.hasOwn(row, 'conversation_id'))
      if (hasConversation && options.notificationInsertConversationError) {
        return json(
          options.notificationInsertConversationError.body,
          options.notificationInsertConversationError.status,
        )
      }
      return empty()
    }
    if (url.hostname === 'api.resend.com' && url.pathname === '/emails') {
      return options.resendStatus
        ? json({ message: 'send failed' }, options.resendStatus)
        : json({ id: 'mail-id' })
    }
    throw new Error(`unexpected fetch ${method} ${url}`)
  }
  return { fetch, calls, notificationReads: () => notificationReads }
}

async function runDigest(fetch, { testMode = false } = {}) {
  globalThis.fetch = fetch
  const env = {
    SUPABASE_URL: 'https://supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-test',
    RESEND_API_KEY: 'resend-test',
    CRON_SECRET: 'cron-test',
  }
  if (testMode) env.DIGEST_TEST_EMAIL = 'sink@example.com'
  else {
    env.DIGEST_LIVE = 'true'
    env.DIGEST_APP_URL = 'https://app.test'
  }
  const { default: handler } = await loadApi('notification-digest.js', env)
  return handler(new Request('https://app.test/api/notification-digest', {
    headers: { Authorization: 'Bearer cron-test' },
  }))
}

function missingConversationColumn(code = 'PGRST204') {
  return {
    status: 400,
    body: {
      code,
      message: code === '42703'
        ? 'column notifications.conversation_id does not exist'
        : "Could not find the 'conversation_id' column of 'notifications' in the schema cache",
    },
  }
}

function acceptedMeetup() {
  return { ...meetupRow(), status: 'accepted' }
}

function unreadMessage() {
  return {
    id: MESSAGE,
    sender_id: USER_A,
    conversation_id: CONVERSATION,
    conversations: {
      buyer_id: USER_A,
      seller_id: USER_B,
      is_muted_buyer: false,
      is_muted_seller: false,
    },
  }
}

function queuedNotification(overrides = {}) {
  return {
    id: NOTIFICATION,
    user_id: USER_B,
    type: 'offer',
    title: 'New offer',
    body: '$15',
    created_at: '2026-07-17T00:00:00.000Z',
    conversation_id: CONVERSATION,
    ...overrides,
  }
}

function recipientProfile() {
  return { id: USER_B, email: 'recipient@example.com', unsubscribe_token: 'token' }
}

function conversationRow() {
  return { id: CONVERSATION, buyer_id: USER_A, seller_id: USER_B }
}

test('digest seeds meetup and unread reminders through one bounded atomic RPC', async () => {
  const mock = digestFetch({
    reminderSeed: {
      meetup_sources_scanned: 3,
      meetup_reminders: 1,
      meetup_notifications: 2,
      unread_messages_scanned: 7,
      unread_reminders: 2,
    },
  })
  const response = await runDigest(mock.fetch)
  const body = await response.json()
  const schemaProbeIndex = mock.calls.findIndex(call =>
    call.method === 'GET' &&
    call.url.pathname === '/rest/v1/notifications' &&
    call.url.searchParams.get('select') === 'conversation_id' &&
    call.url.searchParams.get('limit') === '0')
  const seedIndex = mock.calls.findIndex(call => call.url.pathname.endsWith('/rpc/seed_digest_reminders'))
  const seed = mock.calls[seedIndex]

  assert.equal(response.status, 200)
  assert.equal(body.meetupReminders, 1)
  assert.equal(body.unreadReminders, 2)
  assert.equal(body.reminderFailures, 0)
  assert.ok(schemaProbeIndex >= 0 && seedIndex > schemaProbeIndex)
  assert.deepEqual(seed.body, {
    meetup_limit_in: 200,
    message_limit_in: 500,
    unread_hours_in: 12,
  })
  assert.equal(mock.calls.some(call => call.url.pathname === '/rest/v1/meetups'), false)
  assert.equal(mock.calls.some(call => call.url.pathname === '/rest/v1/messages'), false)
  assert.equal(mock.calls.some(call => call.method === 'PATCH'), false)
  assert.equal(mock.calls.some(call => call.method === 'POST' && call.url.pathname === '/rest/v1/notifications'), false)
})

test('atomic reminder seed failure is surfaced without any legacy split writes', async () => {
  const errors = []
  console.error = (...args) => errors.push(args)
  const mock = digestFetch({ reminderSeedStatus: 503 })
  const response = await runDigest(mock.fetch)
  const body = await response.json()

  assert.equal(response.status, 500)
  assert.equal(body.meetupReminders, 0)
  assert.equal(body.unreadReminders, 0)
  assert.equal(body.reminderFailures, 1)
  assert.equal(mock.calls.filter(call => call.url.pathname.endsWith('/rpc/seed_digest_reminders')).length, 1)
  assert.equal(mock.calls.some(call => call.method === 'PATCH'), false)
  assert.equal(mock.calls.some(call => call.method === 'POST' && call.url.pathname === '/rest/v1/notifications'), false)
  assert.deepEqual(errors, [['notification_digest_reminder_seed_failed']])
})

test('malformed atomic reminder metrics fail closed instead of fabricating success', async () => {
  console.error = () => {}
  const mock = digestFetch({
    reminderSeed: {
      meetup_sources_scanned: 1,
      meetup_reminders: '1',
      meetup_notifications: 2,
      unread_messages_scanned: 0,
      unread_reminders: 0,
    },
  })
  const response = await runDigest(mock.fetch)
  const body = await response.json()

  assert.equal(response.status, 500)
  assert.equal(body.reminderFailures, 1)
  assert.equal(body.meetupReminders, 0)
  assert.equal(body.unreadReminders, 0)
})

test('legacy notification schema gates reminder generation before source reads or stamps', async () => {
  const missingColumn = missingConversationColumn()
  const mock = digestFetch({
    meetups: [acceptedMeetup()],
    messages: [unreadMessage()],
    currentNotificationError: missingColumn,
  })
  const response = await runDigest(mock.fetch)
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.meetupReminders, 0)
  assert.equal(body.unreadReminders, 0)
  assert.equal(mock.notificationReads(), 2)
  assert.equal(mock.calls.some(call => call.url.pathname.endsWith('/rpc/seed_digest_reminders')), false)
  assert.equal(mock.calls.some(call => call.url.pathname === '/rest/v1/meetups'), false)
  assert.equal(mock.calls.some(call => call.url.pathname === '/rest/v1/messages'), false)
  assert.equal(mock.calls.some(call => call.method === 'PATCH'), false)
  assert.equal(mock.calls.some(call => call.method === 'POST' && call.url.pathname === '/rest/v1/notifications'), false)
})

test('queued conversation notifications are filtered after a block and remain un-stamped', async () => {
  const mock = digestFetch({
    notifications: [queuedNotification()],
    conversations: [conversationRow()],
    blockRows: [{ blocker_id: USER_B, blocked_id: USER_A }],
    profiles: [recipientProfile()],
  })
  const response = await runDigest(mock.fetch)
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.usersNotified, 0)
  assert.equal(mock.calls.some(call => call.url.hostname === 'api.resend.com'), false)
  assert.equal(mock.calls.some(call => call.method === 'PATCH' && call.url.pathname === '/rest/v1/notifications'), false)
})

test('queued conversation notifications send and stamp when the pair is unblocked', async () => {
  const mock = digestFetch({
    notifications: [queuedNotification()],
    conversations: [conversationRow()],
    profiles: [recipientProfile()],
  })
  const response = await runDigest(mock.fetch)
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.usersNotified, 1)
  assert.equal(body.notifications, 1)
  const resendCalls = mock.calls.filter(call => call.url.hostname === 'api.resend.com')
  assert.equal(resendCalls.length, 1)
  assert.match(resendCalls[0].headers['Idempotency-Key'], /^digest\/[0-9a-f]{32}$/)
  assert.deepEqual(
    mock.calls.find(call => call.url.pathname.endsWith('/rpc/claim_notification_email_delivery')).body.notification_ids_in,
    [NOTIFICATION],
  )
  assert.equal(mock.calls.filter(call => call.url.pathname.endsWith('/rpc/complete_notification_email_delivery')).length, 1)
  assert.equal(mock.calls.some(call => call.method === 'PATCH'), false)
})

test('blocked rows are filtered before the per-email cap so a safe row cannot starve', async () => {
  const blockedRows = Array.from({ length: 40 }, (_, index) => queuedNotification({
    id: `${(index + 100).toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`,
    title: `Blocked private ${index}`,
  }))
  const safeRow = queuedNotification({
    id: NOTIFICATION_4,
    type: 'system',
    title: 'Safe account notice',
    conversation_id: null,
  })
  const mock = digestFetch({
    notifications: [...blockedRows, safeRow],
    conversations: [conversationRow()],
    blockRows: [{ blocker_id: USER_B, blocked_id: USER_A }],
    profiles: [recipientProfile()],
  })
  const response = await runDigest(mock.fetch)
  const body = await response.json()
  const resend = mock.calls.find(call => call.url.hostname === 'api.resend.com')
  const claim = mock.calls.find(call => call.url.pathname.endsWith('/rpc/claim_notification_email_delivery'))

  assert.equal(response.status, 200)
  assert.equal(body.usersNotified, 1)
  assert.equal(body.notifications, 1)
  assert.match(resend.body.html, /Safe account notice/)
  assert.doesNotMatch(resend.body.html, /Blocked private/)
  assert.deepEqual(claim.body.notification_ids_in, [NOTIFICATION_4])
})

test('a digest completion failure retries with the same provider idempotency key', async () => {
  console.error = () => {}
  const options = {
    notifications: [queuedNotification()],
    conversations: [conversationRow()],
    profiles: [recipientProfile()],
  }
  const firstMock = digestFetch({ ...options, markStatus: 503 })
  const first = await runDigest(firstMock.fetch)
  const firstBody = await first.json()
  const firstSend = firstMock.calls.find(call => call.url.hostname === 'api.resend.com')

  assert.equal(first.status, 500)
  assert.equal(firstBody.markFailed, 1)

  const retryMock = digestFetch(options)
  const retry = await runDigest(retryMock.fetch)
  const retrySend = retryMock.calls.find(call => call.url.hostname === 'api.resend.com')

  assert.equal(retry.status, 200)
  assert.equal(firstSend.headers['Idempotency-Key'], retrySend.headers['Idempotency-Key'])
})

test('a noisy earlier user cannot consume the global row limit and starve the next user', async () => {
  const noisyRows = Array.from({ length: 200 }, (_, index) => queuedNotification({
    id: `${index.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`,
    user_id: USER_A,
    type: 'system',
    title: `Noise ${index}`,
    conversation_id: null,
  }))
  const laterRow = queuedNotification({
    id: NOTIFICATION_2,
    user_id: USER_B,
    type: 'system',
    title: 'Later recipient notice',
    conversation_id: null,
  })
  const mock = digestFetch({
    notificationPage(url) {
      const cursor = url.searchParams.get('user_id') || ''
      if (!cursor) return noisyRows
      if (cursor === `gt.${USER_A}`) return [laterRow]
      return []
    },
    exactNotifications: [laterRow],
    profiles: [recipientProfile()],
  })
  const response = await runDigest(mock.fetch)
  const body = await response.json()
  const resend = mock.calls.find(call => call.url.hostname === 'api.resend.com')

  assert.equal(response.status, 200)
  assert.equal(body.usersNotified, 1)
  assert.equal(body.notifications, 1)
  assert.match(resend.body.html, /Later recipient notice/)
  assert.doesNotMatch(resend.body.html, /Noise 0/)
  assert.equal(mock.notificationReads(), 4) // schema probe + two keyset pages + exact claimed set
})

test('queued-notification block lookup failure closes the send and flags the cron run', async () => {
  console.error = () => {}
  const mock = digestFetch({
    notifications: [queuedNotification()],
    conversations: [conversationRow()],
    profiles: [recipientProfile()],
    blockStatus: 503,
  })
  const response = await runDigest(mock.fetch)
  const body = await response.json()

  assert.equal(response.status, 500)
  assert.equal(body.sendFailed, 1)
  assert.equal(mock.calls.some(call => call.url.hostname === 'api.resend.com'), false)
  assert.equal(mock.calls.some(call => call.method === 'PATCH' && call.url.pathname === '/rest/v1/notifications'), false)
})

const legacyConversationTypes = ['offer', 'meetup', 'unread_message', 'future_conversation_action']
for (const type of legacyConversationTypes) {
  for (const scenario of [
    { label: 'unblocked', blockRows: [] },
    { label: 'blocked', blockRows: [{ blocker_id: USER_A, blocked_id: USER_B }] },
  ]) {
    test(`legacy ${type} notification stays closed when the pair is ${scenario.label}`, async () => {
      const mock = digestFetch({
        currentNotificationError: missingConversationColumn(),
        legacyNotifications: [queuedNotification({
          type,
          title: `private legacy ${type}`,
          conversation_id: undefined,
        })],
        blockRows: scenario.blockRows,
        profiles: [recipientProfile()],
      })
      const response = await runDigest(mock.fetch)
      const body = await response.json()

      assert.equal(response.status, 200)
      assert.equal(body.usersNotified, 0)
      assert.equal(body.notifications, 0)
      assert.equal(mock.notificationReads(), 2)
      assert.equal(mock.calls.some(call => call.url.pathname === '/rest/v1/blocks'), false)
      assert.equal(mock.calls.some(call => call.url.hostname === 'api.resend.com'), false)
      assert.equal(mock.calls.some(call => call.method === 'PATCH' && call.url.pathname === '/rest/v1/notifications'), false)
    })
  }
}

test('current schema also closes historical conversation rows whose routing id is null', async () => {
  const mock = digestFetch({
    notifications: [
      queuedNotification({ type: 'offer', conversation_id: null }),
      queuedNotification({ id: NOTIFICATION_2, type: 'meetup', conversation_id: null }),
      queuedNotification({ id: NOTIFICATION_3, type: 'unread_message', conversation_id: null }),
    ],
    profiles: [recipientProfile()],
  })
  const response = await runDigest(mock.fetch)
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.usersNotified, 0)
  assert.equal(body.notifications, 0)
  assert.equal(mock.calls.some(call => call.url.hostname === 'api.resend.com'), false)
  assert.equal(mock.calls.some(call => call.method === 'PATCH' && call.url.pathname === '/rest/v1/notifications'), false)
})

test('current schema closes an unreviewed future type even when it has a conversation id', async () => {
  const mock = digestFetch({
    notifications: [queuedNotification({ type: 'future_private_action' })],
    conversations: [conversationRow()],
    profiles: [recipientProfile()],
  })
  const response = await runDigest(mock.fetch)
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.usersNotified, 0)
  assert.equal(body.notifications, 0)
  assert.equal(mock.calls.some(call => call.url.pathname === '/rest/v1/conversations'), false)
  assert.equal(mock.calls.some(call => call.url.hostname === 'api.resend.com'), false)
})

test('legacy schema keeps only explicit non-conversation notification types mailable and marks only those rows', async () => {
  const legacyRows = [
    queuedNotification({ id: NOTIFICATION, type: 'system', title: 'System update', conversation_id: undefined }),
    queuedNotification({ id: NOTIFICATION_2, type: 'price_drop', title: 'Price drop', conversation_id: undefined }),
    queuedNotification({ id: NOTIFICATION_3, type: 'sold', title: 'Item sold', conversation_id: undefined }),
    queuedNotification({ id: NOTIFICATION_4, type: 'offer', title: 'PRIVATE OFFER', conversation_id: undefined }),
  ]
  const mock = digestFetch({
    currentNotificationError: missingConversationColumn(),
    legacyNotifications: legacyRows,
    profiles: [recipientProfile()],
  })
  const response = await runDigest(mock.fetch)
  const body = await response.json()
  const resend = mock.calls.find(call => call.url.hostname === 'api.resend.com')
  const claim = mock.calls.find(call => call.url.pathname.endsWith('/rpc/claim_notification_email_delivery'))

  assert.equal(response.status, 200)
  assert.equal(body.usersNotified, 1)
  assert.equal(body.notifications, 3)
  assert.match(resend.body.html, /System update/)
  assert.match(resend.body.html, /Price drop/)
  assert.match(resend.body.html, /Item sold/)
  assert.doesNotMatch(resend.body.html, /PRIVATE OFFER/)
  assert.deepEqual(new Set(claim.body.notification_ids_in), new Set([
    NOTIFICATION,
    NOTIFICATION_2,
    NOTIFICATION_3,
  ]))
  assert.equal(claim.body.notification_ids_in.includes(NOTIFICATION_4), false)
})

test('test-mode preview never includes a legacy conversation row without routing', async () => {
  const mock = digestFetch({
    currentNotificationError: missingConversationColumn(),
    legacyNotifications: [queuedNotification({
      type: 'offer',
      title: 'PRIVATE LEGACY OFFER',
      body: '$999 private offer',
      conversation_id: undefined,
    })],
  })
  const response = await runDigest(mock.fetch, { testMode: true })
  const body = await response.json()
  const resend = mock.calls.find(call => call.url.hostname === 'api.resend.com')

  assert.equal(response.status, 200)
  assert.equal(body.sample, true)
  assert.equal(body.previewed, 0)
  assert.equal(mock.calls.some(call => call.url.hostname === 'supabase.test'), false)
  assert.doesNotMatch(resend.body.html, /PRIVATE LEGACY OFFER|\$999 private offer/)
  assert.match(resend.body.html, /System notice|系统通知/)
})

for (const code of ['42703', 'PGRST204']) {
  test(`missing notifications.conversation_id (${code}) uses the legacy projection without failing the batch`, async () => {
    const mock = digestFetch({
      currentNotificationError: missingConversationColumn(code),
      legacyNotifications: [queuedNotification({
        type: 'system',
        title: 'System notice',
        conversation_id: undefined,
      })],
      profiles: [recipientProfile()],
    })
    const response = await runDigest(mock.fetch)
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.equal(body.usersNotified, 1)
    assert.equal(mock.notificationReads(), 3)
    assert.equal(mock.calls.filter(call => call.url.hostname === 'api.resend.com').length, 1)
  })
}

test('an unrelated missing column does not trigger the legacy compatibility fallback', async () => {
  const mock = digestFetch({
    currentNotificationError: {
      status: 400,
      body: { code: '42703', message: 'column notifications.title does not exist' },
    },
  })
  const response = await runDigest(mock.fetch)

  assert.equal(response.status, 500)
  assert.equal(mock.notificationReads(), 1)
  assert.equal(mock.calls.some(call => call.url.hostname === 'api.resend.com'), false)
})

for (const [label, runClaim, expectedStatus, expectedBody] of [
  ['already-held', false, 429, { error: 'digest_run_locked' }],
  ['malformed', { allowed: true }, 503, { error: 'run_guard_unavailable' }],
]) {
  test(`live digest ${label} run guard closes before reads or email`, async () => {
    const mock = digestFetch({
      runClaim,
      notifications: [queuedNotification()],
      profiles: [recipientProfile()],
    })
    const response = await runDigest(mock.fetch)

    assert.equal(response.status, expectedStatus)
    assert.deepEqual(await response.json(), expectedBody)
    assert.equal(mock.calls.filter(call => call.url.pathname === '/rest/v1/rpc/edge_rate_hit').length, 1)
    assert.equal(mock.calls.some(call => call.url.pathname === '/rest/v1/notifications'), false)
    assert.equal(mock.calls.some(call => call.url.hostname === 'api.resend.com'), false)
  })
}

test('digest requires GET with an explicit Bearer scheme', async () => {
  globalThis.fetch = async () => { throw new Error('must not fetch') }
  const { default: handler } = await loadApi('notification-digest.js', {
    CRON_SECRET: 'cron-test',
    RESEND_API_KEY: 'resend-test',
    DIGEST_TEST_EMAIL: 'sink@example.com',
  })

  const rawSecret = await handler(new Request('https://app.test/api/notification-digest', {
    headers: { Authorization: 'cron-test' },
  }))
  assert.equal(rawSecret.status, 401)

  const post = await handler(new Request('https://app.test/api/notification-digest', {
    method: 'POST',
    headers: { Authorization: 'Bearer cron-test' },
  }))
  assert.equal(post.status, 405)
})

for (const [label, appUrl, extraEnv, expectedStatus, expectedBody] of [
  ['missing', undefined, {}, 500, { error: 'live_app_origin_required' }],
  ['insecure', 'http://app.test', {}, 500, { error: 'live_app_origin_required' }],
  ['non-origin path', 'https://app.test/private', {}, 500, { error: 'live_app_origin_required' }],
  ['preview host mismatch', 'https://illinimarket.com', {
    VERCEL_ENV: 'preview',
    VERCEL_URL: 'branch-preview.vercel.app',
  }, 503, { error: 'deployment_configuration_invalid' }],
]) {
  test(`live digest rejects ${label} app origin before database or email work`, async () => {
    const calls = []
    globalThis.fetch = async input => {
      calls.push(String(input instanceof Request ? input.url : input))
      throw new Error('must not fetch')
    }
    const env = {
      SUPABASE_URL: 'https://supabase.test',
      SUPABASE_SERVICE_ROLE_KEY: 'service-test',
      RESEND_API_KEY: 'resend-test',
      CRON_SECRET: 'cron-test',
      DIGEST_LIVE: 'true',
      ...extraEnv,
    }
    if (appUrl !== undefined) env.DIGEST_APP_URL = appUrl
    const { default: handler } = await loadApi('notification-digest.js', env)
    const response = await handler(new Request('https://app.test/api/notification-digest', {
      headers: { Authorization: 'Bearer cron-test' },
    }))

    assert.equal(response.status, expectedStatus)
    assert.deepEqual(await response.json(), expectedBody)
    assert.deepEqual(calls, [])
  })
}

test('live meetup rejects a missing app origin after auth but before rate, data, or email work', async () => {
  const calls = []
  globalThis.fetch = async input => {
    const url = requestUrl(input)
    calls.push(url.pathname)
    if (url.pathname === '/auth/v1/user') return json({ id: USER_A })
    throw new Error('must not fetch beyond auth')
  }
  const { default: handler } = await loadApi('meetup-notify.js', {
    SUPABASE_URL: 'https://supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-test',
    SUPABASE_ANON_KEY: 'anon-test',
    RESEND_API_KEY: 'resend-test',
    DIGEST_LIVE: 'true',
  })
  const response = await handler(new Request('https://app.test/api/meetup-notify', {
    method: 'POST',
    headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ meetup_id: MEETUP }),
  }))

  assert.equal(response.status, 500)
  assert.deepEqual(await response.json(), { error: 'live_app_origin_required' })
  assert.deepEqual(calls, ['/auth/v1/user'])
})

test('email APIs never log arbitrary caught error messages', async () => {
  for (const filename of ['meetup-notify.js', 'notification-digest.js']) {
    const source = await readFile(new URL(filename, API_ROOT), 'utf8')
    assert.doesNotMatch(source, /console\.(?:error|warn|log)\([^\n]*(?:error|e)\?\.?message/)
    assert.doesNotMatch(source, /console\.(?:error|warn|log)\(`[^`]*\$\{[^}]*message/)
  }
})
