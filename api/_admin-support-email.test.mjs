import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { afterEach, test } from 'node:test'
import { inlineSharedApiImports } from './_test-module-loader.mjs'

const ENV_KEYS = ['SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SENTRY_DSN', 'VITE_SENTRY_DSN', 'RESEND_API_KEY']
const originalEnv = new Map(ENV_KEYS.map(key => [key, process.env[key]]))
const originalFetch = globalThis.fetch
const ADMIN_TOKEN = `iam_admin_${'a'.repeat(43)}`
const ACTOR = '11111111-1111-4111-8111-111111111111'
const REQUEST_ID = '22222222-2222-4222-8222-222222222222'
const PROVIDER_ID = '33333333-3333-4333-8333-333333333333'
const NOW = '2026-10-03T12:00:00Z'
const OWNER_CAPABILITIES = ['apply_ban', 'lift_suspension', 'decide_appeal', 'update_report_status', 'resolve_target_reports', 'takedown_content', 'set_post_pinned', 'upsert_banner', 'delete_banner', 'upload_banner', 'revoke_token', 'issue_token', 'revoke_admin_tokens']
const CAPABILITIES = {
  owner: OWNER_CAPABILITIES,
  operator: ['apply_ban', 'lift_suspension', 'decide_appeal', 'update_report_status', 'resolve_target_reports', 'takedown_content'],
  security_admin: ['revoke_token', 'revoke_admin_tokens'],
}
let importNonce = 0

afterEach(() => {
  globalThis.fetch = originalFetch
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

async function loadHandler({ key = 'resend-private-test-key', fastTimeout = false } = {}) {
  for (const name of ENV_KEYS) delete process.env[name]
  Object.assign(process.env, { SUPABASE_URL: 'https://supabase.test', SUPABASE_SECRET_KEY: 'service-test-key', RESEND_API_KEY: key })
  let source = await readFile(new URL('./admin/index.js', import.meta.url), 'utf8')
  if (fastTimeout) source = source.replace('const SUPPORT_EMAIL_TIMEOUT_MS = 8000', 'const SUPPORT_EMAIL_TIMEOUT_MS = 20')
  const encoded = Buffer.from(inlineSharedApiImports(source)).toString('base64')
  return (await import(`data:text/javascript;base64,${encoded}#support-${importNonce++}`)).default
}

function message(overrides = {}) {
  return { action: 'send_support_reply', request_id: REQUEST_ID, to: 'student+help@example.com', subject: 'Re: Your question', text: 'Hello,\nHere is a private support answer.\n谢谢', in_reply_to: '<original.123@example.com>', ...overrides }
}

function post(body = message(), headers = {}) {
  return new Request('https://app.test/api/admin', { method: 'POST', headers: {
    Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json', 'Idempotency-Key': body.request_id, ...headers,
  }, body: JSON.stringify(body) })
}

function get(resource, id = REQUEST_ID, token = ADMIN_TOKEN) {
  return new Request(`https://app.test/api/admin?resource=${resource}&request_id=${id}`, { headers: { Authorization: `Bearer ${token}` } })
}

function response(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
}

// A durable fake ledger exercises dispatch behavior and transport ambiguity;
// the companion PostgreSQL regression proves the actual transaction/locks.
function installTransport(options = {}) {
  const calls = []
  const rows = new Map()
  const state = { calls, rows, sends: 0, actor: ACTOR }
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input))
    const args = init.body ? JSON.parse(init.body) : null
    const call = { url, init, args }
    calls.push(call)
    assert.equal(init.redirect, 'manual')
    if (url.pathname === '/rest/v1/rpc/edge_rate_hit') return response(options.rateAllowed ?? true)
    if (url.pathname === '/rest/v1/rpc/admin_token_authorization_v2') {
      const role = options.role || 'owner'
      return response([{
        token_id: ACTOR, admin_id: state.actor, admin_name: 'Admin', admin_email: 'admin@example.com',
        role, expires_at: null, server_now: NOW, capabilities: options.capabilities || CAPABILITIES[role],
      }])
    }
    if (url.pathname === '/rest/v1/rpc/admin_support_email_status') {
      return options.schemaMissing ? response({ code: 'PGRST202', message: 'private DB details' }, 404) : response(options.statusResult ?? { available: true })
    }
    if (url.pathname === '/rest/v1/rpc/admin_support_email_claim') {
      if (options.claimError) return response(options.claimError, options.claimErrorStatus || 400)
      if (options.schemaMissing) return response({ code: 'PGRST202' }, 404)
      if (options.claimResult) return response(options.claimResult)
      const found = rows.get(args.p_request_id)
      if (found) {
        if (found.actor !== state.actor || found.hash !== args.p_intent_hash) {
          return response({ message: 'support_email_request_conflict' }, 400)
        }
        return response({ claimed: false, receipt: found.receipt })
      }
      const receipt = { request_id: args.p_request_id, status: 'pending', provider_id: null, to: args.p_to, subject: args.p_subject, created_at: NOW }
      rows.set(args.p_request_id, { actor: state.actor, hash: args.p_intent_hash, receipt })
      if (options.claimResponseLost) throw new Error('claim response lost after commit')
      return response({ claimed: true, receipt })
    }
    if (url.hostname === 'api.resend.com') {
      state.sends++
      assert.equal(rows.size, 1, 'durable claim must precede provider request')
      if (options.provider) return options.provider(call)
      return response({ id: PROVIDER_ID })
    }
    if (url.pathname === '/rest/v1/rpc/admin_support_email_finish') {
      const found = rows.get(args.p_request_id)
      if (options.finishFails) throw new Error('private finish error')
      Object.assign(found.receipt, { status: args.p_status, provider_id: args.p_provider_id })
      if (options.finishResponseLost) throw new Error('lost finish response after commit')
      return response(options.finishResult || found.receipt)
    }
    if (url.pathname === '/rest/v1/rpc/admin_support_email_receipt') {
      const found = rows.get(args.p_request_id)
      if (!found || found.actor !== state.actor) return response({ message: 'support_email_not_found' }, 404)
      return response(options.receiptResult || found.receipt)
    }
    throw new Error(`Unexpected fetch ${url.pathname}`)
  }
  return state
}

test('owner support readiness requires both existing server secret and installed SQL feature', async () => {
  for (const options of [{}, { key: '' }, { schemaMissing: true }, { statusResult: { available: true, unknown: 1 } }]) {
    const handler = await loadHandler(options)
    const state = installTransport(options)
    const res = await handler(get('support_email_status'))
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { data: { available: Object.keys(options).length === 0, from: 'help@illinimarket.com', reply_to: 'help@illinimarket.com' } })
    assert.equal(state.sends, 0)
    assert.ok(state.calls.every(call => call.url.hostname !== 'api.resend.com'))
  }
})

test('non-owner tokens cannot read readiness, receipts or send; owner capability projection remains exact', async () => {
  const handler = await loadHandler()
  for (const role of ['operator', 'security_admin']) {
    const state = installTransport({ role })
    for (const req of [get('support_email_status'), get('support_email_receipt'), post()]) {
      const res = await handler(req)
      assert.equal(res.status, 403)
      assert.deepEqual(await res.json(), { error: 'admin_capability_denied' })
    }
    assert.equal(state.calls.filter(call => /support_email|resend/.test(call.url.href)).length, 0)
  }
  const state = installTransport({ capabilities: [...OWNER_CAPABILITIES, 'send_support_reply'] })
  assert.equal((await handler(post())).status, 503)
  assert.equal(state.sends, 0)
})

test('send uses fixed headers, plain text and a durable exact intent before provider acceptance', async () => {
  const handler = await loadHandler()
  const state = installTransport()
  const res = await handler(post())
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { data: { request_id: REQUEST_ID, status: 'sent', provider_id: PROVIDER_ID, to: message().to, subject: message().subject, created_at: NOW } })
  const provider = state.calls.find(call => call.url.hostname === 'api.resend.com')
  assert.equal(provider.url.href, 'https://api.resend.com/emails')
  assert.deepEqual(provider.args, { from: 'help@illinimarket.com', reply_to: 'help@illinimarket.com', to: [message().to], subject: message().subject, text: message().text, headers: { 'In-Reply-To': message().in_reply_to, References: message().in_reply_to } })
  assert.equal(provider.init.headers['Idempotency-Key'], `support-reply/${REQUEST_ID}`)
  assert.equal(provider.init.headers.Authorization, 'Bearer resend-private-test-key')
  const claim = state.calls.find(call => call.url.pathname.endsWith('admin_support_email_claim'))
  assert.match(claim.args.p_token_hash, /^[a-f0-9]{64}$/)
  assert.match(claim.args.p_intent_hash, /^[a-f0-9]{64}$/)
  for (const call of state.calls.filter(call => call.url.hostname === 'supabase.test')) {
    assert.ok(!JSON.stringify(call.args).includes(message().text))
    assert.ok(!JSON.stringify(call.args).includes(ADMIN_TOKEN))
    assert.ok(!JSON.stringify(call.args).includes('resend-private-test-key'))
  }
})

test('missing server key blocks sends before claim and optional threading emits no fabricated header', async () => {
  let handler = await loadHandler({ key: '' })
  let state = installTransport()
  const unavailable = await handler(post())
  assert.equal(unavailable.status, 503)
  assert.deepEqual(await unavailable.json(), { error: 'support_email_unavailable', request_id: REQUEST_ID, submission: 'not_attempted' })
  assert.equal(state.rows.size, 0)
  assert.equal(state.sends, 0)
  handler = await loadHandler()
  state = installTransport()
  const bounded = message({ in_reply_to: null, subject: '中'.repeat(200), text: 'a'.repeat(10000) })
  assert.equal((await handler(post(bounded))).status, 200)
  const provider = state.calls.find(call => call.url.hostname === 'api.resend.com')
  assert.equal(provider.args.headers, undefined)
  assert.equal(provider.args.subject, bounded.subject)
  assert.equal(provider.args.text, bounded.text)
})

test('duplicate and concurrent POSTs cause exactly one external attempt', async () => {
  const handler = await loadHandler()
  const state = installTransport()
  const results = await Promise.all(Array.from({ length: 10 }, () => handler(post())))
  for (const res of results) {
    assert.equal(res.status, 200)
    assert.ok(['sent', 'pending'].includes((await res.json()).data.status))
  }
  assert.equal(state.sends, 1)
  assert.equal(state.rows.size, 1)
  assert.equal((await (await handler(post())).json()).data.status, 'sent')
  assert.equal(state.sends, 1)
})

test('same request ID with any altered intent conflicts without another send', async () => {
  const handler = await loadHandler()
  const state = installTransport()
  await handler(post())
  for (const overrides of [{ to: 'other@example.com' }, { subject: 'Another subject' }, { text: 'Different private body' }, { in_reply_to: null }]) {
    const res = await handler(post(message(overrides)))
    assert.equal(res.status, 409)
    assert.deepEqual(await res.json(), { error: 'idempotency_conflict' })
  }
  assert.equal(state.sends, 1)
})

test('strict request validation rejects header injection, extra fields, multiple recipients and invalid bounds before claim', async () => {
  const handler = await loadHandler()
  const state = installTransport()
  const invalid = [
    { to: ['a@example.com'] }, { to: 'a@example.com,b@example.com' }, { to: 'User <a@example.com>' },
    { to: 'ü@example.com' }, { to: 'a..b@example.com' }, { to: '.a@example.com' }, { to: 'a@-example.com' },
    { to: 'a@example.com\r\nBcc: victim@example.com' }, { to: `${'a'.repeat(65)}@example.com` },
    { subject: 'x\r\nBcc: victim@example.com' }, { subject: 'x'.repeat(201) }, { subject: '\u202eevil' }, { subject: '\ud800' },
    { text: 'x'.repeat(10001) }, { text: ' \n' }, { text: 'x\u0000y' }, { text: '\ud800' },
    { in_reply_to: '<a@example.com>\r\nBcc: bad@example.com' }, { in_reply_to: '<a@example.com> <b@example.com>' },
    { in_reply_to: '<a@bad..com>' }, { in_reply_to: '<a@-bad.com>' }, { in_reply_to: '<a@bad.com> (comment)' },
    { in_reply_to: 2 }, { html: '<b>extra</b>' }, { from: 'attacker@example.com' },
    { reply_to: 'attacker@example.com' }, { bcc: 'attacker@example.com' }, { request_id: 'invalid' },
  ]
  for (const overrides of invalid) {
    const res = await handler(post(message(overrides)))
    assert.equal(res.status, 400, JSON.stringify(overrides))
    assert.deepEqual(await res.json(), { error: 'support_email_invalid' })
  }
  for (const key of ['', ACTOR, 'invalid']) {
    const res = await handler(post(message(), { 'Idempotency-Key': key }))
    assert.equal(res.status, 400)
    assert.deepEqual(await res.json(), { error: 'invalid_idempotency_key' })
  }
  assert.equal(state.rows.size, 0)
  assert.equal(state.sends, 0)
})

test('body byte limit and existing root limiter remain ahead of any support claim', async () => {
  const handler = await loadHandler()
  let state = installTransport()
  const req = post(message({ text: 'x'.repeat(70000) }))
  assert.equal((await handler(req)).status, 413)
  assert.equal(state.rows.size, 0)
  state = installTransport({ rateAllowed: false })
  assert.equal((await handler(post())).status, 429)
  assert.equal(state.calls.length, 1)
})

test('claim authorization, rate, missing schema and required audit failures all prevent provider dispatch', async () => {
  const handler = await loadHandler()
  const cases = [
    [{ schemaMissing: true }, 503, 'support_email_unavailable'],
    [{ claimError: { message: 'support_email_invalid_token' } }, 401, 'admin_token_inactive'],
    [{ claimError: { message: 'support_email_forbidden' } }, 403, 'admin_capability_denied'],
    [{ claimError: { message: 'support_email_rate_limited' } }, 429, 'support_email_rate_limited'],
    [{ claimError: { message: 'required audit failed with private body and secret' } }, 503, 'support_email_outcome_unknown'],
    [{ claimResult: { claimed: true, receipt: { request_id: REQUEST_ID } } }, 503, 'support_email_outcome_unknown'],
  ]
  for (const [options, status, error] of cases) {
    const state = installTransport(options)
    const res = await handler(post())
    assert.equal(res.status, status)
    assert.deepEqual(await res.json(), { error })
    assert.equal(state.sends, 0)
  }
})

test('lost claim response leaves a permanent pending claim and never dispatches on repeated request', async () => {
  const handler = await loadHandler()
  const state = installTransport({ claimResponseLost: true })
  assert.equal((await handler(post())).status, 503)
  const repeat = await handler(post())
  assert.equal((await repeat.json()).data.status, 'pending')
  assert.equal(state.sends, 0)
})

test('only the exact rolled-back SQL rate-limit rejection grants the fresh-submission no-attempt fence', async () => {
  const handler = await loadHandler()
  let state = installTransport({ claimError: { code: 'P0001', message: 'support_email_rate_limited' } })
  const limited = await handler(post())
  assert.equal(limited.status, 429)
  assert.deepEqual(await limited.json(), { error: 'support_email_rate_limited', request_id: REQUEST_ID, submission: 'not_attempted' })
  assert.equal(state.rows.size, 0)
  assert.equal(state.sends, 0)

  for (const options of [
    { claimError: { message: 'support_email_rate_limited' } },
    { claimError: { code: 'XX000', message: 'support_email_rate_limited' } },
    { claimError: { code: 'P0001', message: 'support_email_rate_limited' }, claimErrorStatus: 500 },
    { claimError: { code: 'P0001', message: 'unknown rejection' } },
    { schemaMissing: true },
    { claimResponseLost: true },
    { finishFails: true },
    { finishResponseLost: true },
  ]) {
    state = installTransport(options)
    const res = await handler(post())
    const body = await res.json()
    assert.ok(res.status >= 400)
    assert.deepEqual(Object.keys(body), ['error'], 'uncertainty cannot release the durable recovery ID')
  }
})

test('provider uncertainty is persisted, bounded, redacted and never retried', async () => {
  const handler = await loadHandler({ fastTimeout: true })
  const cases = [
    () => { throw new Error('private provider network error') },
    () => response({ private: 'unexpected success without id' }),
    () => new Response('not JSON', { status: 200 }),
    () => response({ message: 'private provider error' }, 500),
    () => new Response('', { status: 302, headers: { Location: 'https://evil.test/steal' } }),
    () => response({ id: PROVIDER_ID, padding: 'x'.repeat(17000) }),
    () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(17000)) } })),
    () => new Response(new ReadableStream({ start() {}, cancel() {} })),
    ({ init }) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')))),
  ]
  for (const provider of cases) {
    const state = installTransport({ provider })
    const res = await handler(post())
    assert.equal(res.status, 200)
    const receipt = (await res.json()).data
    assert.equal(receipt.status, 'unknown')
    assert.equal(receipt.provider_id, null)
    assert.equal((await (await handler(post())).json()).data.status, 'unknown')
    assert.equal(state.sends, 1)
    assert.ok(state.calls.every(call => call.url.hostname !== 'evil.test'))
  }
})

test('explicit provider rejection is terminal failed with no fallback sender or retry', async () => {
  const handler = await loadHandler()
  for (const code of [400, 401, 403, 422, 429]) {
    const state = installTransport({ provider: () => response({ message: 'private account or domain rejection' }, code) })
    const res = await handler(post())
    assert.equal(res.status, 200)
    assert.equal((await res.json()).data.status, 'failed')
    assert.equal((await (await handler(post())).json()).data.status, 'failed')
    assert.equal(state.sends, 1)
  }
})

test('finish loss reports unknown while receipt reads recover durable truth without any provider work', async () => {
  const handler = await loadHandler()
  for (const options of [{ finishFails: true }, { finishResponseLost: true }]) {
    const state = installTransport(options)
    const sent = await handler(post())
    assert.equal(sent.status, 503)
    assert.deepEqual(await sent.json(), { error: 'support_email_outcome_unknown' })
    const expectedStatus = options.finishFails ? 'pending' : 'sent'
    const receipt = await handler(get('support_email_receipt'))
    assert.equal(receipt.status, 200)
    assert.equal((await receipt.json()).data.status, expectedStatus)
    assert.equal((await (await handler(post())).json()).data.status, expectedStatus)
    assert.equal(state.sends, 1)
  }
})

test('receipt is scoped to authenticated actor and excludes private body, hash, token and provider response', async () => {
  const handler = await loadHandler()
  const state = installTransport()
  await handler(post())
  const receipt = await handler(get('support_email_receipt'))
  assert.deepEqual(Object.keys((await receipt.json()).data).sort(), ['request_id', 'status', 'provider_id', 'to', 'subject', 'created_at'].sort())
  state.actor = PROVIDER_ID
  const foreign = await handler(get('support_email_receipt'))
  assert.equal(foreign.status, 404)
  assert.deepEqual(await foreign.json(), { error: 'support_email_not_found' })
  assert.equal((await handler(get('support_email_receipt', 'bad-id'))).status, 400)
  assert.equal(state.sends, 1)
})

test('malformed claim and finish success never permit false sent or a second attempt', async () => {
  const handler = await loadHandler()
  const base = { request_id: REQUEST_ID, status: 'pending', provider_id: null, to: message().to, subject: message().subject, created_at: NOW }
  for (const receipt of [{ ...base, status: 'sent', provider_id: PROVIDER_ID }, { ...base, to: 'other@example.com' }, { ...base, extra: 'secret' }]) {
    const state = installTransport({ claimResult: { claimed: true, receipt } })
    assert.equal((await handler(post())).status, 503)
    assert.equal(state.sends, 0)
  }
  for (const receipt of [{ ...base, status: 'sent', provider_id: ACTOR }, { ...base, status: 'sent', provider_id: PROVIDER_ID, private: 'secret' }]) {
    const state = installTransport({ finishResult: receipt })
    const res = await handler(post())
    assert.equal(res.status, 503)
    assert.deepEqual(await res.json(), { error: 'support_email_outcome_unknown' })
    assert.equal(state.sends, 1)
  }
})
