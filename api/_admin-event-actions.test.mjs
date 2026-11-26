// Leading underscore prevents Vercel from treating this test as an API Function.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { inlineSharedApiImports } from './_test-module-loader.mjs'
import { afterEach, test } from 'node:test'

/*
 * P4.9: the three event actions at the Edge boundary. create_event_discussion
 * opens the one discussion topic of an organization's event as the official
 * account (COMMUNITY_OFFICIAL_PROFILE_ID, E6); until that is configured it is
 * refused by name before anything is written. hide_event and unhide_event take
 * an event down and bring it back and do not depend on that account.
 */

const API_URL = new URL('./admin/index.js', import.meta.url)
const ENV_KEYS = [
  'SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY',
  'SENTRY_DSN', 'VITE_SENTRY_DSN', 'COMMUNITY_OFFICIAL_PROFILE_ID',
]
const originalEnv = new Map(ENV_KEYS.map(key => [key, process.env[key]]))
const originalFetch = globalThis.fetch
let importNonce = 0

const ADMIN = `iam_admin_${'a'.repeat(43)}`
const EVENT_ID = '11111111-1111-4111-8111-111111111111'
const IDEMPOTENCY_KEY = '22222222-2222-4222-8222-222222222222'
const OFFICIAL_ID = '33333333-3333-4333-8333-333333333333'
const TOPIC_ID = '55555555-5555-4555-8555-555555555555'
const REASON = 'Reviewed by the site team'
// What admin_token_authorization_v2 reports: the vocabulary from before P3.
const ROLE_CAPABILITIES = {
  operator: ['apply_ban', 'lift_suspension', 'decide_appeal', 'update_report_status', 'resolve_target_reports', 'takedown_content'],
  security_admin: ['revoke_admin_tokens', 'revoke_token'],
  owner: [
    'apply_ban', 'lift_suspension', 'decide_appeal', 'update_report_status', 'resolve_target_reports',
    'takedown_content', 'set_post_pinned', 'upsert_banner', 'delete_banner',
    'upload_banner', 'issue_token', 'revoke_admin_tokens', 'revoke_token',
  ],
}
const DISCUSSION = { data: { event_id: EVENT_ID, post_id: TOPIC_ID, created: true } }
// One valid request per action, and what the wrapper answers when it worked.
const ACTIONS = {
  create_event_discussion: { result: DISCUSSION, roles: ['owner'] },
  hide_event: { result: { success: true }, roles: ['operator', 'owner'] },
  unhide_event: { result: { success: true }, roles: ['operator', 'owner'] },
}
const BODY = { event_id: EVENT_ID, reason: REASON }

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key)
    if (value == null) delete process.env[key]
    else process.env[key] = value
  }
  globalThis.fetch = originalFetch
})

async function loadHandler(official = OFFICIAL_ID) {
  for (const key of ENV_KEYS) delete process.env[key]
  Object.assign(process.env, { SUPABASE_URL: 'https://supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key' })
  if (official !== null) process.env.COMMUNITY_OFFICIAL_PROFILE_ID = official
  const source = await readFile(API_URL, 'utf8')
  const encoded = Buffer.from(inlineSharedApiImports(source)).toString('base64')
  return (await import(`data:text/javascript;base64,${encoded}#admin-events-${importNonce++}`)).default
}

function authenticatedFetch(calls, business = null, role = 'owner') {
  return async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    calls.push({ url, init })
    if (url.pathname === '/rest/v1/rpc/edge_rate_hit') return new Response('true', { status: 200 })
    if (url.pathname === '/rest/v1/rpc/admin_token_authorization_v2') {
      return new Response(JSON.stringify([{
        token_id: EVENT_ID, admin_id: EVENT_ID, admin_name: 'Admin', admin_email: 'admin@example.com', role,
        expires_at: null, server_now: '2026-11-20T00:00:00Z', capabilities: ROLE_CAPABILITIES[role],
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.pathname === '/rest/v1/rpc/record_audit') return new Response('null', { status: 200 })
    if (business) return business(url, init)
    throw new Error(`unexpected business call ${url.pathname}`)
  }
}

const request = (body, method = 'POST') => new Request(`https://app.test/api/admin${method === 'GET' ? body : ''}`, {
  method,
  headers: { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json', 'Idempotency-Key': IDEMPOTENCY_KEY },
  ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
})
const wrapper = (answer, status = 200) => async url => {
  assert.equal(url.pathname, '/rest/v1/rpc/admin_execute_mutation')
  return new Response(JSON.stringify(answer), { status, headers: { 'Content-Type': 'application/json' } })
}
const mutations = calls => calls.filter(call => call.url.pathname === '/rest/v1/rpc/admin_execute_mutation').map(call => JSON.parse(call.init.body))
// Calls that change something: the wrapper, Storage, or a direct table write.
const writes = calls => calls.filter(call => call.url.pathname === '/rest/v1/rpc/admin_execute_mutation'
  || call.url.pathname.startsWith('/storage/')
  || (call.url.pathname.startsWith('/rest/v1/') && !call.url.pathname.startsWith('/rest/v1/rpc/') && (call.init.method || 'GET') !== 'GET'))

for (const [action, { result, roles }] of Object.entries(ACTIONS)) {
  test(`${action} reaches the atomic wrapper with exactly its own fields`, async () => {
    const calls = []
    globalThis.fetch = authenticatedFetch(calls, wrapper(result), roles[0])
    const handler = await loadHandler()
    // Whatever else the client sends is not forwarded, the official account least of all.
    const response = await handler(request({ action, ...BODY, reason: `  ${REASON}  `, official_profile_id: EVENT_ID, post_id: TOPIC_ID, junk: 1 }))
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), result)
    assert.deepEqual(mutations(calls), [{
      p_token_hash: mutations(calls)[0].p_token_hash,
      p_idempotency_key: IDEMPOTENCY_KEY,
      p_payload_hash: mutations(calls)[0].p_payload_hash,
      p_action: action,
      p_payload: { ...BODY, ...(action === 'create_event_discussion' ? { official_profile_id: OFFICIAL_ID } : {}) },
    }])
    assert.match(mutations(calls)[0].p_token_hash, /^[0-9a-f]{64}$/)
    assert.match(mutations(calls)[0].p_payload_hash, /^[0-9a-f]{64}$/)
  })

  // E6: one test per action for the unset official account.
  test(`${action} with the official account unset ${action === 'create_event_discussion' ? 'is refused by name and writes nothing' : 'does not depend on it'}`, async () => {
    for (const official of [null, '', '   ', 'not-a-uuid', `${OFFICIAL_ID}0`]) {
      const calls = []
      globalThis.fetch = authenticatedFetch(calls, wrapper(result))
      const handler = await loadHandler(official)
      const response = await handler(request({ action, ...BODY }))
      if (action === 'create_event_discussion') {
        // A definitive refusal: nothing was written, so the request key can be released.
        assert.equal(response.status, 409, String(official))
        assert.deepEqual(await response.json(), { error: 'official_profile_not_configured' })
        assert.deepEqual(writes(calls), [], 'nothing reached the database or Storage')
      } else {
        assert.equal(response.status, 200, String(official))
        assert.equal(mutations(calls).length, 1)
        assert.ok(!('official_profile_id' in mutations(calls)[0].p_payload))
      }
    }
  })

  test(`${action} is open to ${roles.join(' and ')} only`, async () => {
    for (const role of ['operator', 'security_admin', 'owner']) {
      const calls = []
      globalThis.fetch = authenticatedFetch(calls, wrapper(result), role)
      const handler = await loadHandler()
      const response = await handler(request({ action, ...BODY }))
      if (roles.includes(role)) {
        assert.equal(response.status, 200, role)
        assert.equal(mutations(calls).length, 1)
      } else {
        assert.equal(response.status, 403, role)
        assert.deepEqual(await response.json(), { error: 'admin_capability_denied' })
        assert.deepEqual(writes(calls), [])
      }
    }
  })
}

test('the official account id is normalised before it is sent', async () => {
  const calls = []
  globalThis.fetch = authenticatedFetch(calls, wrapper(DISCUSSION))
  const handler = await loadHandler(`  ${OFFICIAL_ID.toUpperCase()}  `)
  assert.equal((await handler(request({ action: 'create_event_discussion', ...BODY }))).status, 200)
  assert.equal(mutations(calls)[0].p_payload.official_profile_id, OFFICIAL_ID)
})

test('malformed event requests are answered locally', async () => {
  const cases = Object.keys(ACTIONS).flatMap(action => [
    [{ action, reason: REASON }, 'missing_args'],
    [{ action, event_id: EVENT_ID }, 'missing_args'],
    [{ action, event_id: 'not-a-uuid', reason: REASON }, 'invalid_id'],
    [{ action, event_id: EVENT_ID, reason: '   ' }, 'invalid_reason'],
    [{ action, event_id: EVENT_ID, reason: 'line\u0001break' }, 'invalid_reason'],
    [{ action, event_id: EVENT_ID, reason: 'x'.repeat(1001) }, 'invalid_reason'],
  ])
  for (const [body, error] of cases) {
    const calls = []
    globalThis.fetch = authenticatedFetch(calls)
    const handler = await loadHandler()
    const response = await handler(request(body))
    assert.equal(response.status, 400, JSON.stringify(body))
    assert.deepEqual(await response.json(), { error })
    assert.deepEqual(writes(calls), [])
  }
})

test('an answer that is not the action\'s own result is an unknown outcome', async () => {
  const cases = [
    ...['hide_event', 'unhide_event'].flatMap(action =>
      [[action, {}], [action, { success: false }], [action, { success: true, extra: 1 }], [action, DISCUSSION]]),
    ['create_event_discussion', {}], ['create_event_discussion', { success: true }],
    ['create_event_discussion', { data: { event_id: EVENT_ID, post_id: TOPIC_ID } }],
    ['create_event_discussion', { data: { event_id: EVENT_ID, post_id: TOPIC_ID, created: 'yes' } }],
    ['create_event_discussion', { data: { event_id: EVENT_ID, post_id: 'not-a-uuid', created: true } }],
    // Another event's topic is not this request's answer.
    ['create_event_discussion', { data: { event_id: TOPIC_ID, post_id: TOPIC_ID, created: true } }],
    ['create_event_discussion', { data: { event_id: EVENT_ID, post_id: TOPIC_ID, created: true, extra: 1 } }],
  ]
  for (const [action, answer] of cases) {
    const calls = []
    globalThis.fetch = authenticatedFetch(calls, wrapper(answer))
    const handler = await loadHandler()
    const response = await handler(request({ action, ...BODY }))
    assert.equal(response.status, 503, `${action} ${JSON.stringify(answer)}`)
    assert.deepEqual(await response.json(), { error: 'admin_outcome_unknown' })
  }
  // The topic that already existed is this request's answer too.
  const calls = []
  globalThis.fetch = authenticatedFetch(calls, wrapper({ data: { event_id: EVENT_ID.toUpperCase(), post_id: TOPIC_ID, created: false } }))
  const handler = await loadHandler()
  assert.equal((await handler(request({ action: 'create_event_discussion', ...BODY }))).status, 200)
})

test('refusals named by the migration map to stable responses', async () => {
  const cases = [
    ['create_event_discussion', 'official_profile_not_configured', 409, 'official_profile_not_configured'],
    ['create_event_discussion', 'event_discussion_closed', 409, 'event_discussion_closed'],
    ['create_event_discussion', 'event_not_found', 404, 'admin_mutation_not_found'],
    ['create_event_discussion', 'admin_mutation_conflict', 409, 'admin_mutation_conflict'],
    ['hide_event', 'event_not_found', 404, 'admin_mutation_not_found'],
    ['unhide_event', 'event_not_found', 404, 'admin_mutation_not_found'],
    ['hide_event', 'admin_mutation_invalid_payload', 400, 'admin_mutation_invalid'],
    ['hide_event', 'admin_capability_denied', 403, 'admin_capability_denied'],
    ['unhide_event', 'idempotency_conflict', 409, 'idempotency_conflict'],
    ['hide_event', 'some row value copied into an error', 500, 'admin_upstream_failed'],
  ]
  for (const [action, message, status, error] of cases) {
    const calls = []
    globalThis.fetch = authenticatedFetch(calls, wrapper({ message }, 400))
    const handler = await loadHandler()
    const response = await handler(request({ action, ...BODY }))
    assert.equal(response.status, status, `${action} ${message}`)
    assert.deepEqual(await response.json(), { error })
  }
})

test('the console reads every event, hidden ones included, for the moderation roles only', async () => {
  for (const role of ['operator', 'owner', 'security_admin']) {
    const calls = []
    globalThis.fetch = authenticatedFetch(calls, async (url, init) => {
      assert.equal(url.pathname, '/rest/v1/community_events')
      assert.equal(init.method || 'GET', 'GET')
      // The service role may only read this table; the read is bounded and ordered.
      assert.equal(url.searchParams.get('limit'), '50')
      assert.equal(url.searchParams.get('offset'), '100')
      assert.equal(url.searchParams.get('order'), 'starts_at.desc,id.desc')
      const select = url.searchParams.get('select')
      for (const column of ['id', 'source_type', 'availability', 'hidden_reason', 'discussion_post_id', 'duplicate_of']) {
        assert.ok(select.split(',').includes(column), column)
      }
      assert.doesNotMatch(select, /consent_ref|content_hash|created_by|\*/)
      return new Response(JSON.stringify([{ id: EVENT_ID }]), { status: 200 })
    }, role)
    const handler = await loadHandler()
    const response = await handler(request('?resource=community_events&limit=50&offset=100', 'GET'))
    if (role === 'security_admin') {
      assert.equal(response.status, 403, role)
      assert.deepEqual(await response.json(), { error: 'admin_capability_denied' })
      assert.equal(calls.filter(call => call.url.pathname === '/rest/v1/community_events').length, 0)
    } else {
      assert.equal(response.status, 200, role)
      assert.deepEqual(await response.json(), { data: [{ id: EVENT_ID }] })
    }
  }
  const calls = []
  globalThis.fetch = authenticatedFetch(calls, async () => new Response('{}', { status: 500 }))
  const handler = await loadHandler()
  const response = await handler(request('?resource=community_events', 'GET'))
  assert.equal(response.status, 500)
  assert.deepEqual(await response.json(), { error: 'community_events_read_failed' })
})
