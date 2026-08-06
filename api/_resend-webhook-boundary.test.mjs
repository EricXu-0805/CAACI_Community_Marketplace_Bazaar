// Leading underscore prevents Vercel from treating this test as an API Function.
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { inlineSharedApiImports } from './_test-module-loader.mjs'

/*
 * The signature check is the whole security boundary here: anyone can POST to
 * this URL, and a forged bounce would be indistinguishable from a real one.
 * The construction is pinned against Svix's published test vector rather than
 * against this file's own helper, because a self-consistent test would happily
 * agree with a wrong construction.
 */

const API_ROOT = new URL('./', import.meta.url)
const DSN = 'https://publickey123@o99.ingest.sentry.io/4507'
const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'
const ENV_KEYS = [
  'RESEND_WEBHOOK_SECRET', 'SENTRY_DSN', 'VITE_SENTRY_DSN', 'VERCEL_ENV',
  'SUPABASE_URL', 'VITE_SUPABASE_URL',
]
const originalEnv = new Map(ENV_KEYS.map(key => [key, process.env[key]]))
const originalFetch = globalThis.fetch
const originalDateNow = Date.now
let importNonce = 0

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key)
    if (value == null) delete process.env[key]
    else process.env[key] = value
  }
  globalThis.fetch = originalFetch
  Date.now = originalDateNow
})

async function loadHandler(overrides = {}) {
  for (const key of ENV_KEYS) delete process.env[key]
  Object.assign(process.env, {
    SUPABASE_URL: 'https://supabase.test',
    RESEND_WEBHOOK_SECRET: SECRET,
    SENTRY_DSN: DSN,
    ...overrides,
  })
  const source = await readFile(new URL('resend-webhook.js', API_ROOT), 'utf8')
  const encoded = Buffer.from(inlineSharedApiImports(source)).toString('base64')
  return (await import(`data:text/javascript;base64,${encoded}#resend-webhook-${importNonce++}`)).default
}

function sentryRecorder() {
  const events = []
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.hostname === 'o99.ingest.sentry.io') {
      events.push(JSON.parse(String(init.body || '{}')))
      return new Response('{}', { status: 200 })
    }
    throw new Error(`unexpected fetch ${url}`)
  }
  return events
}

function sign(id, timestamp, payload, secret = SECRET) {
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64')
  return createHmac('sha256', key).update(`${id}.${timestamp}.${payload}`).digest('base64')
}

function webhookRequest(payload, { id = 'msg_test', timestamp, signature, headers = {} } = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  const ts = String(timestamp ?? Math.floor(Date.now() / 1000))
  return new Request('https://app.test/api/resend-webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'svix-id': id,
      'svix-timestamp': ts,
      'svix-signature': signature ?? `v1,${sign(id, ts, body)}`,
      ...headers,
    },
    body,
  })
}

function bouncedEvent(overrides = {}) {
  return {
    type: 'email.bounced',
    created_at: '2026-08-06T18:00:00.000Z',
    data: {
      email_id: '56761188-7520-42d8-8898-ff6fc54ce618',
      message_id: '<111-222-333@email.example.com>',
      from: 'CAACI Marketplace <notify@send.illinimarket.com>',
      to: ['netid@illinois.edu'],
      subject: 'You have 3 new notifications',
      bounce: { type: 'Permanent', subType: 'Suppressed', message: 'on the suppression list' },
      ...overrides,
    },
  }
}

test('the signature construction matches Svix’s published test vector', async () => {
  // Payload, headers and expected signature are Svix's own documented example.
  // If the order, separators or secret decoding were wrong, this fails while a
  // self-signed fixture would still pass.
  const payload = '{"test": 2432232314}'
  const id = 'msg_p5jXN8AQM9LWM0D4loKWxJek'
  const timestamp = '1614265330'
  const published = 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE='
  Date.now = () => Number(timestamp) * 1000

  const events = sentryRecorder()
  const handler = await loadHandler()
  const response = await handler(webhookRequest(payload, { id, timestamp, signature: published }))

  assert.equal(response.status, 200)
  assert.equal(events.length, 0, 'the vector payload is not a reportable event')
})

test('a forged or absent signature is rejected before anything is parsed', async () => {
  const cases = [
    { label: 'wrong signature', options: { signature: 'v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } },
    { label: 'unsigned', options: { signature: '' } },
    { label: 'unknown scheme', options: { signature: 'v2,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=' } },
    { label: 'signed with another secret', options: {} },
  ]
  for (const { label, options } of cases) {
    const events = sentryRecorder()
    const handler = await loadHandler()
    const payload = JSON.stringify(bouncedEvent())
    const timestamp = String(Math.floor(Date.now() / 1000))
    const request = webhookRequest(payload, {
      timestamp,
      signature: label === 'signed with another secret'
        ? `v1,${sign('msg_test', timestamp, payload, 'whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')}`
        : options.signature,
    })
    const response = await handler(request)
    assert.equal(response.status, 401, label)
    assert.equal(events.length, 0, `${label} must not reach Sentry`)
  }
})

test('a valid signature over a replayed timestamp is still rejected', async () => {
  const events = sentryRecorder()
  const handler = await loadHandler()
  const now = Math.floor(Date.now() / 1000)
  for (const timestamp of [now - 6 * 60, now + 6 * 60]) {
    const response = await handler(webhookRequest(bouncedEvent(), { timestamp }))
    assert.equal(response.status, 401, `skew ${timestamp - now}s must be rejected`)
  }
  assert.equal(events.length, 0)
})

test('a body edited after signing no longer verifies', async () => {
  const events = sentryRecorder()
  const handler = await loadHandler()
  const original = JSON.stringify(bouncedEvent())
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = `v1,${sign('msg_test', timestamp, original)}`
  const tampered = original.replace('"Permanent"', '"Transient"')

  const response = await handler(webhookRequest(tampered, { timestamp, signature }))
  assert.equal(response.status, 401)
  assert.equal(events.length, 0)
})

test('a rotation window with two signatures verifies on the surviving one', async () => {
  sentryRecorder()
  const handler = await loadHandler()
  const payload = JSON.stringify(bouncedEvent())
  const timestamp = String(Math.floor(Date.now() / 1000))
  const stale = sign('msg_test', timestamp, payload, 'whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
  const live = sign('msg_test', timestamp, payload)

  const response = await handler(webhookRequest(payload, {
    timestamp,
    signature: `v1,${stale} v1,${live}`,
  }))
  assert.equal(response.status, 200)
})

test('delivery outcomes map to the level someone should be paged at', async () => {
  const expectations = [
    { event: bouncedEvent(), message: 'resend: email hard bounced', level: 'error' },
    {
      event: bouncedEvent({ bounce: { type: 'Transient', subType: 'General' } }),
      message: 'resend: email soft bounced',
      level: 'warning',
    },
    { event: { type: 'email.complained', data: { email_id: 'a', to: ['x@illinois.edu'] } }, message: 'resend: recipient marked email as spam', level: 'error' },
    { event: { type: 'email.failed', data: { email_id: 'a', to: ['x@illinois.edu'] } }, message: 'resend: send failed', level: 'error' },
    { event: { type: 'email.suppressed', data: { email_id: 'a', to: ['x@illinois.edu'] } }, message: 'resend: send suppressed before delivery', level: 'warning' },
    { event: { type: 'email.delivery_delayed', data: { email_id: 'a', to: ['x@illinois.edu'] } }, message: 'resend: delivery delayed', level: 'warning' },
  ]
  for (const { event, message, level } of expectations) {
    const events = sentryRecorder()
    const handler = await loadHandler()
    const response = await handler(webhookRequest(event))
    assert.equal(response.status, 200)
    assert.equal(events.length, 1, `${event.type} must report exactly once`)
    assert.equal(events[0].message, message)
    assert.equal(events[0].level, level)
    assert.equal(events[0].logger, 'api/resend-webhook')
  }
})

test('successful and unrelated events are acknowledged without noise', async () => {
  const quiet = [
    { type: 'email.delivered', data: { email_id: 'a', to: ['x@illinois.edu'] } },
    { type: 'email.sent', data: { email_id: 'a' } },
    { type: 'email.opened', data: { email_id: 'a' } },
    { type: 'email.clicked', data: { email_id: 'a' } },
    { type: 'domain.updated', data: {} },
    { type: 'contact.created', data: {} },
    // An event type Resend adds after this deploy must still be acknowledged;
    // a 4xx would make Resend retry a payload we will never accept.
    { type: 'email.something_new', data: {} },
  ]
  for (const event of quiet) {
    const events = sentryRecorder()
    const handler = await loadHandler()
    const response = await handler(webhookRequest(event))
    assert.equal(response.status, 200, event.type)
    assert.deepEqual(await response.json(), { received: true })
    assert.equal(events.length, 0, `${event.type} must not page anyone`)
  }
})

test('no recipient address, subject or message id reaches the report', async () => {
  const events = sentryRecorder()
  const handler = await loadHandler()
  await handler(webhookRequest(bouncedEvent()))

  const serialized = JSON.stringify(events[0])
  for (const secret of ['netid', 'netid@illinois.edu', 'You have 3 new notifications', '111-222-333']) {
    assert.doesNotMatch(serialized, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  // The provider is kept: a bounce storm is almost always one provider, and
  // the domain alone identifies nobody.
  assert.equal(events[0].extra.recipient_domain, 'illinois.edu')
  assert.equal(events[0].extra.email_id, '56761188-7520-42d8-8898-ff6fc54ce618')
})

test('a mixed-provider recipient list reports no domain rather than a guess', async () => {
  const events = sentryRecorder()
  const handler = await loadHandler()
  await handler(webhookRequest(bouncedEvent({ to: ['a@illinois.edu', 'b@gmail.com'] })))
  assert.equal(events[0].extra.recipient_domain, '')
})

test('an unconfigured secret refuses the request instead of accepting it unverified', async () => {
  const events = sentryRecorder()
  const handler = await loadHandler({ RESEND_WEBHOOK_SECRET: '' })
  const response = await handler(webhookRequest(bouncedEvent()))
  assert.equal(response.status, 503)
  assert.equal(events.length, 0)
})

test('an oversized or unparseable body is refused before signature work', async () => {
  const events = sentryRecorder()
  const handler = await loadHandler()

  const huge = 'x'.repeat(64 * 1024 + 1)
  assert.equal((await handler(webhookRequest(huge))).status, 400)

  const signedButNotJson = webhookRequest('not json at all')
  assert.equal((await handler(signedButNotJson)).status, 400)
  assert.equal(events.length, 0)
})

test('only POST is accepted', async () => {
  const handler = await loadHandler()
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const response = await handler(new Request('https://app.test/api/resend-webhook', { method }))
    assert.equal(response.status, 405, method)
  }
})
