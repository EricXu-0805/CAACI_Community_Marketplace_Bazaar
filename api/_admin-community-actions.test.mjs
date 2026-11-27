// Leading underscore prevents Vercel from treating this test as an API Function.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { inlineSharedApiImports } from './_test-module-loader.mjs'
import { afterEach, test } from 'node:test'

/*
 * P3.5: the five community governance actions at the Edge boundary. Each one
 * is validated here, authorised by role, and sent to the atomic database
 * wrapper with exactly its own fields. set_post_official needs the official
 * account (COMMUNITY_OFFICIAL_PROFILE_ID, E6); until that is configured it is
 * refused by name before anything is written.
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
const POST_ID = '11111111-1111-4111-8111-111111111111'
const IDEMPOTENCY_KEY = '22222222-2222-4222-8222-222222222222'
const OFFICIAL_ID = '33333333-3333-4333-8333-333333333333'
const OWNER_DIR = '44444444-4444-4444-8444-444444444444'
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
// One valid request per action, and what the wrapper answers when it worked.
const ACTIONS = {
  restore_content: { body: { target_type: 'comment', target_id: POST_ID, reason: REASON }, result: { data: { ok: true, affected: 1 } }, roles: ['operator', 'owner'] },
  set_post_official: { body: { post_id: POST_ID, official: true, reason: REASON }, result: { success: true }, roles: ['owner'] },
  set_post_featured: { body: { post_id: POST_ID, featured: true, reason: REASON }, result: { success: true }, roles: ['owner'] },
  set_post_locked: { body: { post_id: POST_ID, locked: true, reason: REASON }, result: { success: true }, roles: ['operator', 'owner'] },
  set_post_category: { body: { post_id: POST_ID, category: 'campus-life', reason: REASON }, result: { success: true }, roles: ['operator', 'owner'] },
}

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
  return (await import(`data:text/javascript;base64,${encoded}#admin-community-${importNonce++}`)).default
}

function authenticatedFetch(calls, business = null, role = 'owner') {
  return async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    calls.push({ url, init })
    if (url.pathname === '/rest/v1/rpc/edge_rate_hit') return new Response('true', { status: 200 })
    if (url.pathname === '/rest/v1/rpc/admin_token_authorization_v2') {
      return new Response(JSON.stringify([{
        token_id: POST_ID, admin_id: POST_ID, admin_name: 'Admin', admin_email: 'admin@example.com', role,
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

for (const [action, { body, result, roles }] of Object.entries(ACTIONS)) {
  test(`${action} reaches the atomic wrapper with exactly its own fields`, async () => {
    const calls = []
    globalThis.fetch = authenticatedFetch(calls, wrapper(result), roles[0])
    const handler = await loadHandler()
    // Whatever else the client sends is not forwarded, the official account least of all.
    const response = await handler(request({ action, ...body, reason: `  ${REASON}  `, official_profile_id: POST_ID, status: 'active', junk: 1 }))
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), result)
    assert.deepEqual(mutations(calls), [{
      p_token_hash: mutations(calls)[0].p_token_hash,
      p_idempotency_key: IDEMPOTENCY_KEY,
      p_payload_hash: mutations(calls)[0].p_payload_hash,
      p_action: action,
      p_payload: { ...body, ...(action === 'set_post_official' ? { official_profile_id: OFFICIAL_ID } : {}) },
    }])
    assert.match(mutations(calls)[0].p_token_hash, /^[0-9a-f]{64}$/)
    assert.match(mutations(calls)[0].p_payload_hash, /^[0-9a-f]{64}$/)
  })

  // E6: one test per action for the unset official account.
  test(`${action} with the official account unset ${action === 'set_post_official' ? 'is refused by name and writes nothing' : 'does not depend on it'}`, async () => {
    for (const official of [null, '', '   ', 'not-a-uuid', `${OFFICIAL_ID}0`]) {
      const calls = []
      globalThis.fetch = authenticatedFetch(calls, wrapper(result))
      const handler = await loadHandler(official)
      const response = await handler(request({ action, ...body }))
      if (action === 'set_post_official') {
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
      const response = await handler(request({ action, ...body }))
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
  globalThis.fetch = authenticatedFetch(calls, wrapper({ success: true }))
  const handler = await loadHandler(`  ${OFFICIAL_ID.toUpperCase()}  `)
  assert.equal((await handler(request({ action: 'set_post_official', ...ACTIONS.set_post_official.body }))).status, 200)
  assert.equal(mutations(calls)[0].p_payload.official_profile_id, OFFICIAL_ID)
})

test('malformed governance requests are answered locally', async () => {
  const cases = [
    [{ action: 'restore_content', target_id: POST_ID, reason: REASON }, 'missing_args'],
    [{ action: 'restore_content', target_type: 'post', reason: REASON }, 'missing_args'],
    [{ action: 'restore_content', target_type: 'item', target_id: POST_ID, reason: REASON }, 'invalid_target_type'],
    [{ action: 'restore_content', target_type: 'user', target_id: POST_ID, reason: REASON }, 'invalid_target_type'],
    [{ action: 'restore_content', target_type: 'post', target_id: 'not-a-uuid', reason: REASON }, 'invalid_id'],
    [{ action: 'restore_content', target_type: 'post', target_id: POST_ID }, 'missing_args'],
    [{ action: 'restore_content', target_type: 'post', target_id: POST_ID, reason: 'line\u0001break' }, 'invalid_reason'],
    [{ action: 'set_post_official', post_id: POST_ID, reason: REASON }, 'missing_args'],
    [{ action: 'set_post_official', post_id: POST_ID, official: 'true', reason: REASON }, 'missing_args'],
    [{ action: 'set_post_featured', post_id: 'not-a-uuid', featured: true, reason: REASON }, 'invalid_id'],
    [{ action: 'set_post_featured', post_id: POST_ID, featured: 1, reason: REASON }, 'missing_args'],
    [{ action: 'set_post_locked', locked: true, reason: REASON }, 'missing_args'],
    [{ action: 'set_post_locked', post_id: POST_ID, locked: true }, 'missing_args'],
    [{ action: 'set_post_locked', post_id: POST_ID, locked: true, reason: '   ' }, 'invalid_reason'],
    [{ action: 'set_post_locked', post_id: POST_ID, locked: true, reason: 'x'.repeat(1001) }, 'invalid_reason'],
    [{ action: 'set_post_category', post_id: POST_ID, reason: REASON }, 'missing_args'],
    [{ action: 'set_post_category', post_id: POST_ID, category: 'furniture', reason: REASON }, 'invalid_category'],
    [{ action: 'set_post_category', post_id: POST_ID, category: 7, reason: REASON }, 'invalid_category'],
  ]
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
    ['restore_content', {}], ['restore_content', { success: true }], ['restore_content', { data: { ok: true, affected: 0 } }],
    ['restore_content', { data: { ok: true, affected: 1, extra: 1 } }],
    ...['set_post_official', 'set_post_featured', 'set_post_locked', 'set_post_category'].flatMap(action =>
      [[action, {}], [action, { success: false }], [action, { success: true, extra: 1 }], [action, { data: { ok: true, affected: 1 } }]]),
  ]
  for (const [action, answer] of cases) {
    const calls = []
    globalThis.fetch = authenticatedFetch(calls, wrapper(answer))
    const handler = await loadHandler()
    const response = await handler(request({ action, ...ACTIONS[action].body }))
    assert.equal(response.status, 503, `${action} ${JSON.stringify(answer)}`)
    assert.deepEqual(await response.json(), { error: 'admin_outcome_unknown' })
  }
})

test('refusals named by the migration map to stable responses', async () => {
  const cases = [
    ['restore_content', 'content_not_found', 404, 'admin_mutation_not_found'],
    ['set_post_locked', 'post_not_found', 404, 'admin_mutation_not_found'],
    ['set_post_official', 'official_profile_not_configured', 409, 'official_profile_not_configured'],
    ['set_post_official', 'post_not_official_account', 409, 'post_not_official_account'],
    ['set_post_official', 'admin_mutation_conflict', 409, 'admin_mutation_conflict'],
    ['set_post_featured', 'post_not_official', 409, 'post_not_official'],
    ['set_post_category', 'post_not_topic', 409, 'post_not_topic'],
    ['set_post_category', 'admin_mutation_invalid_payload', 400, 'admin_mutation_invalid'],
    ['set_post_locked', 'admin_capability_denied', 403, 'admin_capability_denied'],
    ['set_post_locked', 'idempotency_conflict', 409, 'idempotency_conflict'],
    ['set_post_locked', 'some row value copied into an error', 500, 'admin_upstream_failed'],
  ]
  for (const [action, message, status, error] of cases) {
    const calls = []
    globalThis.fetch = authenticatedFetch(calls, wrapper({ message }, 400))
    const handler = await loadHandler()
    const response = await handler(request({ action, ...ACTIONS[action].body }))
    assert.equal(response.status, status, message)
    assert.deepEqual(await response.json(), { error })
  }
})

function restoreFetch(calls, images, { readStatus = 200, moveStatus = 200, moveBody = '{}' } = {}) {
  return authenticatedFetch(calls, async (url, init) => {
    if (url.pathname === '/rest/v1/posts') {
      return new Response(JSON.stringify([{ images, user_id: OWNER_DIR }]), { status: readStatus, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.pathname === '/rest/v1/rpc/admin_execute_mutation') return wrapper({ data: { ok: true, affected: 1 } })(url, init)
    if (url.pathname === '/storage/v1/object/move') return new Response(moveBody, { status: moveStatus })
    throw new Error(`unexpected business call ${url.pathname}`)
  })
}
const image = name => `https://supabase.test/storage/v1/object/public/item-images/items/${OWNER_DIR}/${name}`
const moves = calls => calls.filter(call => call.url.pathname === '/storage/v1/object/move').map(call => JSON.parse(call.init.body))
const restorePost = { action: 'restore_content', target_type: 'post', target_id: POST_ID, reason: REASON }

test('a restored topic gets its photos back from the evidence bucket', async () => {
  const calls = []
  globalThis.fetch = restoreFetch(calls, [image('a.jpg'), image('b.jpg'), 'https://elsewhere.test/c.jpg'])
  const handler = await loadHandler()
  const response = await handler(request(restorePost))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { data: { ok: true, affected: 1 } })
  assert.deepEqual(moves(calls), ['a.jpg', 'b.jpg'].map(name => ({
    bucketId: 'moderation-evidence', sourceKey: `items/${OWNER_DIR}/${name}`,
    destinationBucket: 'item-images', destinationKey: `items/${OWNER_DIR}/${name}`,
  })))
  const order = calls.map(call => call.url.pathname)
  assert.ok(order.indexOf('/rest/v1/posts') < order.indexOf('/rest/v1/rpc/admin_execute_mutation'), 'the photo list is read before the row changes')
  assert.ok(order.indexOf('/rest/v1/rpc/admin_execute_mutation') < order.indexOf('/storage/v1/object/move'), 'nothing is made public before the topic is restored')
  const read = calls.find(call => call.url.pathname === '/rest/v1/posts')
  assert.equal(read.url.search, `?id=eq.${POST_ID}&select=images,user_id`)
})

test('a photo that never left the public bucket counts as restored', async () => {
  for (const [moveStatus, moveBody] of [[404, '{}'], [400, '{"statusCode":"404","error":"not_found","message":"Object not found"}']]) {
    const calls = []
    globalThis.fetch = restoreFetch(calls, [image('a.jpg')], { moveStatus, moveBody })
    const handler = await loadHandler()
    assert.deepEqual(await (await handler(request(restorePost))).json(), { data: { ok: true, affected: 1 } })
  }
})

test('a photo that could not be moved back, or a photo list that could not be read, is reported as pending', async () => {
  for (const options of [{ moveStatus: 500 }, { moveStatus: 400, moveBody: '{"statusCode":"403","error":"denied"}' }, { readStatus: 500 }]) {
    const calls = []
    globalThis.fetch = restoreFetch(calls, [image('a.jpg'), image('b.jpg')], options)
    const handler = await loadHandler()
    const response = await handler(request(restorePost))
    assert.equal(response.status, 200, JSON.stringify(options))
    assert.deepEqual(await response.json(), { data: { ok: true, affected: 1 }, media_restore_pending: true })
    assert.equal(mutations(calls).length, 1, 'the topic itself is restored')
  }
})

test('nothing is moved when the restore is refused, and a reply has no photos to move', async () => {
  const refused = []
  globalThis.fetch = authenticatedFetch(refused, async url => url.pathname === '/rest/v1/posts'
    ? new Response(JSON.stringify([{ images: [image('a.jpg')], user_id: OWNER_DIR }]), { status: 200 })
    : wrapper({ message: 'content_not_found' }, 400)(url))
  let handler = await loadHandler()
  assert.equal((await handler(request(restorePost))).status, 404)
  assert.deepEqual(moves(refused), [])

  const reply = []
  globalThis.fetch = authenticatedFetch(reply, wrapper({ data: { ok: true, affected: 1 } }))
  handler = await loadHandler()
  assert.equal((await handler(request({ ...restorePost, target_type: 'comment' }))).status, 200)
  assert.deepEqual(reply.filter(call => !call.url.pathname.startsWith('/rest/v1/rpc/')), [])
})

test('the topic list and the report queue are read through their own functions by moderation roles', async () => {
  const cases = [
    ['?resource=community_posts', 'admin_list_community_posts', { limit_in: 50, offset_in: 0, status_in: 'active' }],
    ['?resource=community_posts&status=hidden&limit=20&offset=40', 'admin_list_community_posts', { limit_in: 20, offset_in: 40, status_in: 'hidden' }],
    ['?resource=report_queue', 'admin_list_report_queue', { limit_in: 50, offset_in: 0 }],
    ['?resource=report_queue&limit=200', 'admin_list_report_queue', { limit_in: 200, offset_in: 0 }],
  ]
  for (const [query, rpc, args] of cases) {
    for (const role of ['operator', 'owner', 'security_admin']) {
      const calls = []
      globalThis.fetch = authenticatedFetch(calls, async (url, init) => {
        assert.equal(url.pathname, `/rest/v1/rpc/${rpc}`)
        assert.deepEqual(JSON.parse(init.body), args)
        return new Response(JSON.stringify([{ id: POST_ID }]), { status: 200 })
      }, role)
      const handler = await loadHandler()
      const response = await handler(request(query, 'GET'))
      if (role === 'security_admin') {
        assert.equal(response.status, 403, `${query} ${role}`)
        assert.deepEqual(await response.json(), { error: 'admin_capability_denied' })
      } else {
        assert.equal(response.status, 200, `${query} ${role}`)
        assert.deepEqual(await response.json(), { data: [{ id: POST_ID }] })
      }
    }
  }
  const calls = []
  globalThis.fetch = authenticatedFetch(calls)
  const handler = await loadHandler()
  const response = await handler(request('?resource=community_posts&status=deleted', 'GET'))
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: 'invalid_status' })
})
