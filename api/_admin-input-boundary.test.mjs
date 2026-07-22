// Leading underscore prevents Vercel from treating this test as an API Function.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { inlineDeploymentBoundaryImport } from './_test-module-loader.mjs'
import { afterEach, test } from 'node:test'

const API_URL = new URL('./admin/index.js', import.meta.url)
const ENV_KEYS = [
  'SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY', 'SENTRY_DSN', 'VITE_SENTRY_DSN',
]
const originalEnv = new Map(ENV_KEYS.map(key => [key, process.env[key]]))
const originalFetch = globalThis.fetch
let importNonce = 0

const ADMIN_A = `iam_admin_${'a'.repeat(43)}`
const ADMIN_B = `iam_admin_${'b'.repeat(43)}`
const VALID_ID = '11111111-1111-4111-8111-111111111111'
const IDEMPOTENCY_KEY = '22222222-2222-4222-8222-222222222222'
const AUTH_SERVER_NOW = '2026-07-20T00:00:00Z'
const AUTH_ONE_HOUR_LATER = '2026-07-20T01:00:00Z'
const AUTH_TWENTY_THREE_HOURS_LATER = '2026-07-20T23:00:00Z'
const ISSUE_EXPIRY = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
const RECOVERY_TOO_SOON_EXPIRY = new Date(Date.parse(AUTH_SERVER_NOW) + 60 * 60 * 1000).toISOString()
const MANAGED_BANNER_URL = `https://supabase.test/storage/v1/object/public/banners/managed/${VALID_ID}/${IDEMPOTENCY_KEY}/${'a'.repeat(64)}.png`

function tokenInventoryRow(overrides = {}) {
  return {
    id: VALID_ID,
    admin_id: VALID_ID,
    admin_name: 'Admin',
    admin_email: 'admin@example.com',
    role: 'owner',
    created_at: '2026-01-01T00:00:00Z',
    last_used_at: null,
    expires_at: null,
    revoked_at: null,
    ...overrides,
  }
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key)
    if (value == null) delete process.env[key]
    else process.env[key] = value
  }
  globalThis.fetch = originalFetch
})

async function loadHandler() {
  for (const key of ENV_KEYS) delete process.env[key]
  Object.assign(process.env, {
    SUPABASE_URL: 'https://supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  })
  const source = await readFile(API_URL, 'utf8')
  const encoded = Buffer.from(inlineDeploymentBoundaryImport(source)).toString('base64')
  return (await import(`data:text/javascript;base64,${encoded}#admin-input-${importNonce++}`)).default
}

const ROLE_CAPABILITIES = {
  operator: ['apply_ban', 'lift_suspension', 'decide_appeal', 'update_report_status', 'resolve_target_reports', 'takedown_content'],
  security_admin: ['revoke_admin_tokens', 'revoke_token'],
  owner: [
    'apply_ban', 'lift_suspension', 'decide_appeal', 'update_report_status', 'resolve_target_reports',
    'takedown_content', 'set_post_pinned', 'upsert_banner', 'delete_banner',
    'upload_banner', 'issue_token', 'revoke_admin_tokens', 'revoke_token',
  ],
}

function authenticatedFetch(calls, business = null, role = 'owner', authOverrides = {}) {
  return async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    calls.push({ url, init })
    if (url.pathname === '/rest/v1/rpc/edge_rate_hit') {
      return new Response('true', { status: 200 })
    }
    if (url.pathname === '/rest/v1/rpc/admin_token_authorization_v2') {
      return new Response(JSON.stringify([{
        token_id: VALID_ID,
        admin_id: VALID_ID,
        admin_name: 'Admin',
        admin_email: 'admin@example.com',
        role,
        expires_at: null,
        server_now: AUTH_SERVER_NOW,
        capabilities: ROLE_CAPABILITIES[role],
        ...authOverrides,
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.pathname === '/rest/v1/rpc/record_audit') {
      return new Response('null', { status: 200 })
    }
    if (business) return business(url, init)
    throw new Error(`unexpected business call ${url.pathname}`)
  }
}

function adminPost(body, headers = {}) {
  return new Request('https://app.test/api/admin', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ADMIN_A}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': IDEMPOTENCY_KEY,
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

function validMutationResult(body) {
  if (body.action === 'apply_ban') return { data: VALID_ID }
  if (body.action === 'decide_appeal') {
    return { data: {
      suspension_id: body.suspension_id,
      decision: body.decision,
      terminal: body.decision !== 'more_information_required',
      lifted_now: body.decision === 'accepted',
      remains_active: body.decision !== 'accepted',
    } }
  }
  if (body.action === 'resolve_target_reports' || body.action === 'takedown_content') {
    return { data: { ok: true, affected: 1 } }
  }
  if (body.action === 'upsert_banner') {
    const data = {
      id: body.id || VALID_ID,
      image_url: MANAGED_BANNER_URL,
      target_url: null,
      title: null,
      title_en: null,
      title_zh: null,
      priority: 0,
      active: true,
      is_default: false,
      start_at: null,
      end_at: null,
      created_at: '2026-07-19T00:00:00Z',
      updated_at: '2026-07-19T00:00:00Z',
    }
    for (const field of [
      'image_url', 'target_url', 'title_zh', 'title_en', 'priority', 'active',
      'is_default', 'start_at', 'end_at',
    ]) {
      if (Object.prototype.hasOwnProperty.call(body, field)) data[field] = body[field]
    }
    return { data }
  }
  if (body.action === 'issue_token') {
    return { data: {
      token_id: IDEMPOTENCY_KEY,
      admin_id: body.admin_id,
      role: body.role,
      expires_at: body.expires_at,
    } }
  }
  if (body.action === 'revoke_admin_tokens') {
    return { data: {
      admin_id: body.admin_id,
      token_ids: [IDEMPOTENCY_KEY],
      revoked_count: 1,
    } }
  }
  return { success: true }
}

test('Authorization requires a Bearer scheme and conflicting credential channels fail closed', async () => {
  for (const headers of [
    { Authorization: ADMIN_A },
    { Authorization: `Basic ${ADMIN_A}` },
    { Authorization: `Bearer ${ADMIN_B}`, 'x-admin-key': ADMIN_A },
  ]) {
    const calls = []
    globalThis.fetch = authenticatedFetch(calls)
    const handler = await loadHandler()
    const response = await handler(new Request('https://app.test/api/admin?resource=stats', { headers }))

    assert.equal(response.status, 401)
    assert.deepEqual(await response.json(), { error: 'unauthorized' })
    assert.equal(calls.some(call => call.url.pathname === '/rest/v1/rpc/admin_token_authorization_v2'), false)
  }
})

test('malformed authorization 2xx rows fail closed before privileged reads', async () => {
  const valid = {
    token_id: VALID_ID,
    admin_id: VALID_ID,
    admin_name: 'Admin',
    admin_email: 'admin@example.com',
    role: 'owner',
    expires_at: null,
    server_now: AUTH_SERVER_NOW,
    capabilities: ROLE_CAPABILITIES.owner,
  }
  const fixtures = [
    [valid, { ...valid }],
    { ...valid, unexpected: true },
    { ...valid, admin_id: 'not-a-uuid' },
    { ...valid, capabilities: [...valid.capabilities, 'unknown_action'] },
    { ...valid, capabilities: [...valid.capabilities, valid.capabilities[0]] },
    { ...valid, capabilities: valid.capabilities.slice(1) },
    { ...valid, admin_name: null },
    { ...valid, admin_email: null },
    { ...valid, admin_name: '😀'.repeat(101) },
    { ...valid, admin_email: 'bad\u202e@example.com' },
    { ...valid, expires_at: AUTH_SERVER_NOW },
    { ...valid, expires_at: '2026-07-19T23:59:59Z' },
  ]
  for (const fixture of fixtures) {
    const calls = []
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      calls.push({ url, init })
      if (url.pathname === '/rest/v1/rpc/edge_rate_hit') return new Response('true', { status: 200 })
      if (url.pathname === '/rest/v1/rpc/admin_token_authorization_v2') {
        const body = Array.isArray(fixture) ? fixture : [fixture]
        return new Response(JSON.stringify(body), { status: 200 })
      }
      throw new Error(`unexpected privileged call ${url.pathname}`)
    }
    const handler = await loadHandler()
    const response = await handler(new Request('https://app.test/api/admin?resource=stats', {
      headers: { Authorization: `Bearer ${ADMIN_A}` },
    }))
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { error: 'auth_unavailable' })
    assert.equal(calls.some(call => call.url.pathname === '/rest/v1/rpc/admin_dashboard_stats'), false)
  }
})

test('authorization identity length matches PostgreSQL Unicode code-point semantics', async () => {
  const adminName = '😀'.repeat(100)
  const calls = []
  globalThis.fetch = authenticatedFetch(calls, null, 'owner', { admin_name: adminName })
  const handler = await loadHandler()
  const response = await handler(new Request('https://app.test/api/admin?resource=whoami', {
    headers: { Authorization: `Bearer ${ADMIN_A}` },
  }))

  assert.equal(response.status, 200)
  assert.equal((await response.json()).data.admin_name, adminName)
  assert.equal(
    calls.filter(call => call.url.pathname === '/rest/v1/rpc/admin_token_authorization_v2').length,
    1,
  )
})

test('malformed admin reads are rejected before a data-bearing RPC', async () => {
  for (const [query, error] of [
    ['resource=report&id=not-a-uuid', 'invalid_id'],
    ['resource=suspension&id=not-a-uuid', 'invalid_id'],
    ['resource=linked_accounts&profile_id=not-a-uuid', 'invalid_id'],
    ['resource=search_users&q=', 'invalid_query'],
    ['resource=search_users&q=a', 'invalid_query'],
    ['resource=reports&status=deleted', 'invalid_status'],
  ]) {
    const calls = []
    globalThis.fetch = authenticatedFetch(calls)
    const handler = await loadHandler()
    const response = await handler(new Request(`https://app.test/api/admin?${query}`, {
      headers: { Authorization: `Bearer ${ADMIN_A}` },
    }))

    assert.equal(response.status, 400, query)
    assert.deepEqual(await response.json(), { error }, query)
  }
})

test('destructive mutations enforce ids, enums and bounded values before RPC execution', async () => {
  const cases = [
    [{ action: 'apply_ban', target_id: VALID_ID, level: -1, reason: 'x' }, 'invalid_level'],
    [{ action: 'apply_ban', target_id: VALID_ID, level: 4, reason: 'x', hours: -1 }, 'invalid_hours'],
    [{ action: 'apply_ban', target_id: VALID_ID, level: 4, reason: { text: 'x' } }, 'invalid_reason'],
    [{ action: 'apply_ban', target_id: VALID_ID, level: 4, reason: 'bad\u0085reason' }, 'invalid_reason'],
    [{ action: 'apply_ban', target_id: VALID_ID, level: 4, reason: 'bad\u061creason' }, 'invalid_reason'],
    [{ action: 'apply_ban', target_id: VALID_ID, level: 4, reason: 'bad\u200ereason' }, 'invalid_reason'],
    [{ action: 'apply_ban', target_id: VALID_ID, level: 4, reason: 'bad\u200freason' }, 'invalid_reason'],
    [{ action: 'apply_ban', target_id: VALID_ID, level: 4, reason: 'x', category: 'bad\u061ccategory' }, 'invalid_category'],
    [{ action: 'apply_ban', target_id: VALID_ID, level: 4, reason: 'x', category: 'bad\u200ecategory' }, 'invalid_category'],
    [{ action: 'apply_ban', target_id: VALID_ID, level: 4, reason: 'x', category: 'bad\u200fcategory' }, 'invalid_category'],
    [{ action: 'resolve_target_reports', target_type: 'user', target_id: VALID_ID, status: 'pending' }, 'invalid_status'],
    [{ action: 'revoke_token', token_id: VALID_ID }, 'invalid_case_id'],
    [{ action: 'revoke_token', token_id: VALID_ID, case_id: 'CASE-1' }, 'invalid_approval_ref'],
    [{ action: 'revoke_token', token_id: VALID_ID, case_id: 'CASE-\u202e1', approval_ref: 'APP-1' }, 'invalid_case_id'],
    [{ action: 'revoke_admin_tokens', admin_id: VALID_ID, case_id: 'CASE-1' }, 'invalid_approval_ref'],
    [{ action: 'issue_token', token_hash: 'not-a-hash', admin_id: VALID_ID, role: 'operator', expires_at: ISSUE_EXPIRY, case_id: 'CASE-1', approval_ref: 'APP-1' }, 'invalid_token_hash'],
    [{ action: 'issue_token', token_hash: 'a'.repeat(64), admin_id: VALID_ID, role: 'owner', expires_at: AUTH_TWENTY_THREE_HOURS_LATER, case_id: 'CASE-1', approval_ref: 'APP-1' }, 'invalid_expiry'],
    [{ action: 'resolve_target_reports', target_type: 'database', target_id: VALID_ID, status: 'resolved' }, 'invalid_target_type'],
    [{ action: 'takedown_content', target_type: 'message', target_id: VALID_ID }, 'invalid_target_type'],
    [{ action: 'takedown_content', target_type: 'post', target_id: VALID_ID }, 'missing_args'],
    [{ action: 'lift_suspension', suspension_id: VALID_ID }, 'missing_args'],
    [{ action: 'lift_suspension', suspension_id: VALID_ID, reason: 'bad\u202ereason' }, 'invalid_reason'],
    [{ action: 'decide_appeal', suspension_id: VALID_ID, decision: 'approved', reason: 'x' }, 'invalid_decision'],
    [{ action: 'decide_appeal', suspension_id: VALID_ID, decision: 'denied' }, 'invalid_args'],
    [{ action: 'decide_appeal', suspension_id: VALID_ID, decision: 'denied', reason: 'x', extra: true }, 'invalid_args'],
    [{ action: 'decide_appeal', suspension_id: VALID_ID, decision: 'denied', reason: 'bad\nreason' }, 'invalid_reason'],
    [{ action: 'set_post_pinned', post_id: 'not-a-uuid', pinned: true }, 'invalid_id'],
    [{ action: 'delete_banner', id: 'not-a-uuid' }, 'invalid_id'],
  ]

  for (const [body, error] of cases) {
    const calls = []
    globalThis.fetch = authenticatedFetch(calls)
    const handler = await loadHandler()
    const response = await handler(adminPost(body))

    assert.equal(response.status, 400, JSON.stringify(body))
    assert.deepEqual(await response.json(), { error }, JSON.stringify(body))
  }
})

test('banner writes reject unsafe images, oversized fields and reversed schedules', async () => {
  const cases = [
    [{ action: 'upsert_banner', image_url: 'javascript:alert(1)' }, 'invalid_image_url'],
    [{ action: 'upsert_banner', image_url: 'http://cdn.example/banner.png' }, 'invalid_image_url'],
    [{ action: 'upsert_banner', image_url: 'https://cdn.example/banner.png' }, 'invalid_image_url'],
    [{ action: 'upsert_banner', image_url: MANAGED_BANNER_URL.replace('supabase.test', 'tracker.example') }, 'invalid_image_url'],
    [{ action: 'upsert_banner', image_url: `${MANAGED_BANNER_URL}?download=1` }, 'invalid_image_url'],
    [{ action: 'upsert_banner', image_url: `${MANAGED_BANNER_URL}#tracking` }, 'invalid_image_url'],
    [{ action: 'upsert_banner', image_url: 'https://supabase.test/storage/v1/object/public/banners/legacy.png' }, 'invalid_image_url'],
    [{ action: 'upsert_banner', image_url: MANAGED_BANNER_URL, title_en: 'x'.repeat(201) }, 'invalid_title'],
    [{ action: 'upsert_banner', image_url: MANAGED_BANNER_URL, priority: 10001 }, 'invalid_priority'],
    [{
      action: 'upsert_banner',
      image_url: MANAGED_BANNER_URL,
      start_at: '2026-08-02T00:00:00Z',
      end_at: '2026-08-01T23:59:59Z',
    }, 'invalid_schedule'],
  ]

  for (const [body, error] of cases) {
    const calls = []
    globalThis.fetch = authenticatedFetch(calls)
    const handler = await loadHandler()
    const response = await handler(adminPost(body))

    assert.equal(response.status, 400, JSON.stringify(body))
    assert.deepEqual(await response.json(), { error }, JSON.stringify(body))
    assert.equal(calls.some(call => call.url.pathname === '/rest/v1/banners'), false)
  }
})

test('JSON mutations require a UUID idempotency key before their business RPC', async () => {
  for (const headerValue of [undefined, 'not-a-uuid']) {
    const calls = []
    globalThis.fetch = authenticatedFetch(calls)
    const handler = await loadHandler()
    const headers = headerValue === undefined ? { 'Idempotency-Key': '' } : { 'Idempotency-Key': headerValue }
    const response = await handler(adminPost({
      action: 'set_post_pinned',
      post_id: VALID_ID,
      pinned: true,
    }, headers))

    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error: 'invalid_idempotency_key' })
    assert.equal(calls.some(call => call.url.pathname === '/rest/v1/rpc/admin_execute_mutation'), false)
  }
})

test('valid bounded mutations still reach their intended provider contract', async () => {
  const calls = []
  globalThis.fetch = authenticatedFetch(calls, async (url, init) => {
    if (url.pathname === '/rest/v1/rpc/admin_execute_mutation') {
      const request = JSON.parse(init.body)
      assert.equal(request.p_idempotency_key, IDEMPOTENCY_KEY)
      assert.equal(request.p_action, 'resolve_target_reports')
      assert.deepEqual(request.p_payload, {
        target_type: 'user',
        target_id: VALID_ID,
        status: 'resolved',
      })
      assert.match(request.p_token_hash, /^[0-9a-f]{64}$/)
      assert.match(request.p_payload_hash, /^[0-9a-f]{64}$/)
      return new Response(JSON.stringify({ data: { ok: true, affected: 1 } }), { status: 200 })
    }
    throw new Error(`unexpected business call ${url.pathname}`)
  })
  const handler = await loadHandler()
  const response = await handler(adminPost({
    action: 'resolve_target_reports',
    target_type: 'user',
    target_id: VALID_ID,
    status: 'resolved',
  }))

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { data: { ok: true, affected: 1 } })
})

test('token issuance expiry validation uses the authorization database clock', async () => {
  const body = {
    action: 'issue_token',
    token_hash: 'a'.repeat(64),
    admin_id: VALID_ID,
    role: 'operator',
    expires_at: AUTH_ONE_HOUR_LATER,
    case_id: 'CASE-CLOCK',
    approval_ref: 'APP-CLOCK',
  }
  const calls = []
  globalThis.fetch = authenticatedFetch(calls, async (url) => {
    assert.equal(url.pathname, '/rest/v1/rpc/admin_execute_mutation')
    return new Response(JSON.stringify(validMutationResult(body)), { status: 200 })
  })
  const handler = await loadHandler()
  const response = await handler(adminPost(body))

  assert.equal(response.status, 200)
  assert.equal(
    calls.filter(call => call.url.pathname === '/rest/v1/rpc/admin_execute_mutation').length,
    1,
  )
})

test('all twelve JSON write actions use the one atomic mutation RPC', async () => {
  const bodies = [
    { action: 'apply_ban', target_id: VALID_ID, level: 1, reason: 'x' },
    { action: 'lift_suspension', suspension_id: VALID_ID, reason: 'x' },
    { action: 'decide_appeal', suspension_id: VALID_ID, decision: 'denied', reason: 'x' },
    { action: 'update_report_status', report_id: VALID_ID, status: 'resolved' },
    { action: 'resolve_target_reports', target_type: 'user', target_id: VALID_ID, status: 'resolved' },
    { action: 'takedown_content', target_type: 'post', target_id: VALID_ID, reason: 'x' },
    { action: 'set_post_pinned', post_id: VALID_ID, pinned: true },
    { action: 'upsert_banner', image_url: MANAGED_BANNER_URL, active: true },
    { action: 'delete_banner', id: VALID_ID },
    { action: 'revoke_token', token_id: VALID_ID, case_id: 'CASE-1', approval_ref: 'APP-1' },
    {
      action: 'issue_token', token_hash: 'a'.repeat(64), admin_id: VALID_ID,
      role: 'operator', expires_at: ISSUE_EXPIRY, case_id: 'CASE-2', approval_ref: 'APP-2',
    },
    { action: 'revoke_admin_tokens', admin_id: VALID_ID, case_id: 'CASE-3', approval_ref: 'APP-3' },
  ]

  for (const body of bodies) {
    const calls = []
    globalThis.fetch = authenticatedFetch(calls, async (url, init) => {
      assert.equal(url.pathname, '/rest/v1/rpc/admin_execute_mutation')
      assert.equal(JSON.parse(init.body).p_action, body.action)
      return new Response(JSON.stringify(validMutationResult(body)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    const handler = await loadHandler()
    const response = await handler(adminPost(body))
    assert.equal(response.status, 200, body.action)
    const businessPaths = calls
      .map(call => call.url.pathname)
      .filter(path => ![
        '/rest/v1/rpc/edge_rate_hit',
        '/rest/v1/rpc/admin_token_authorization_v2',
      ].includes(path))
    assert.deepEqual(businessPaths, ['/rest/v1/rpc/admin_execute_mutation'], body.action)
  }
})

test('admin_login audit is emitted for the unlock identity probe, not every request', async () => {
  const statsCalls = []
  globalThis.fetch = authenticatedFetch(statsCalls, async (url) => {
    if (url.pathname === '/rest/v1/rpc/admin_dashboard_stats') {
      return new Response('[{"pending_reports":0}]', { status: 200 })
    }
    throw new Error(`unexpected business call ${url.pathname}`)
  })
  const statsHandler = await loadHandler()
  const stats = await statsHandler(new Request('https://app.test/api/admin?resource=stats', {
    headers: { Authorization: `Bearer ${ADMIN_A}` },
  }))
  assert.equal(stats.status, 200)
  assert.equal(statsCalls.filter(call => call.url.pathname === '/rest/v1/rpc/record_audit').length, 0)

  const whoamiCalls = []
  globalThis.fetch = authenticatedFetch(whoamiCalls)
  const whoamiHandler = await loadHandler()
  const whoami = await whoamiHandler(new Request('https://app.test/api/admin?resource=whoami', {
    headers: { Authorization: `Bearer ${ADMIN_A}` },
  }))
  assert.equal(whoami.status, 200)
  const identity = (await whoami.json()).data
  assert.equal(identity.role, 'owner')
  assert.equal(identity.token_id, VALID_ID)
  assert.equal(identity.expires_at, null)
  assert.equal(identity.server_now, AUTH_SERVER_NOW)
  assert.deepEqual(identity.capabilities, ROLE_CAPABILITIES.owner)
  const loginAudits = whoamiCalls.filter(call => call.url.pathname === '/rest/v1/rpc/record_audit')
  assert.equal(loginAudits.length, 1)
  assert.deepEqual(JSON.parse(loginAudits[0].init.body), {
    event_kind_in: 'admin_login',
    actor_id_in: VALID_ID,
    target_id_in: null,
    details_in: {
      auth_source: 'token',
      role: 'owner',
      admin_token_id: VALID_ID,
    },
  })
})

test('appeals and role-scoped audit reads use only their versioned projections', async () => {
  for (const [role, resource, expectedPath] of [
    ['operator', 'appeals', '/rest/v1/rpc/admin_list_appeals_v2'],
    ['operator', 'audit', '/rest/v1/rpc/admin_list_moderation_audit_log'],
    ['owner', 'audit', '/rest/v1/rpc/admin_list_owner_audit_log'],
  ]) {
    const calls = []
    globalThis.fetch = authenticatedFetch(calls, async (url, init) => {
      assert.equal(url.pathname, expectedPath)
      const payload = JSON.parse(init.body)
      if (resource === 'appeals') {
        assert.deepEqual(payload, { limit_in: 50, offset_in: 0 })
      } else {
        assert.deepEqual(payload, { limit_in: 50, offset_in: 0, kind_filter: null })
      }
      return new Response('[]', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }, role)
    const handler = await loadHandler()
    const response = await handler(new Request(
      `https://app.test/api/admin?resource=${resource}`,
      { headers: { Authorization: `Bearer ${ADMIN_A}` } },
    ))
    assert.equal(response.status, 200, `${role}:${resource}`)
    assert.deepEqual(await response.json(), { data: [] }, `${role}:${resource}`)
    assert.equal(
      calls.some(call => call.url.pathname === '/rest/v1/rpc/admin_list_audit_log'),
      false,
    )
  }
})

test('role matrix denies reads and writes before a provider business call', async () => {
  const cases = [
    {
      role: 'operator',
      request: adminPost({ action: 'set_post_pinned', post_id: VALID_ID, pinned: true }),
    },
    {
      role: 'operator',
      request: new Request('https://app.test/api/admin?resource=tokens', {
        headers: { Authorization: `Bearer ${ADMIN_A}` },
      }),
    },
    {
      role: 'security_admin',
      request: adminPost({ action: 'apply_ban', target_id: VALID_ID, level: 1, reason: 'x' }),
    },
    {
      role: 'security_admin',
      request: adminPost({
        action: 'issue_token', token_hash: 'a'.repeat(64), admin_id: VALID_ID,
        role: 'operator', expires_at: ISSUE_EXPIRY, case_id: 'CASE-4', approval_ref: 'APP-4',
      }),
    },
    {
      role: 'security_admin',
      request: new Request('https://app.test/api/admin?resource=plaza_posts', {
        headers: { Authorization: `Bearer ${ADMIN_A}` },
      }),
    },
  ]

  for (const { role, request } of cases) {
    const calls = []
    globalThis.fetch = authenticatedFetch(calls, null, role)
    const handler = await loadHandler()
    const response = await handler(request)
    assert.equal(response.status, 403, role)
    assert.deepEqual(await response.json(), { error: 'admin_capability_denied' }, role)
    const businessCalls = calls.filter(call => ![
      '/rest/v1/rpc/edge_rate_hit',
      '/rest/v1/rpc/admin_token_authorization_v2',
    ].includes(call.url.pathname))
    assert.deepEqual(businessCalls, [], role)
  }
})

test('operator moderation, security token revoke, and owner plaza mutations reach the atomic wrapper', async () => {
  for (const [role, body] of [
    ['operator', { action: 'apply_ban', target_id: VALID_ID, level: 1, reason: 'x' }],
    ['security_admin', { action: 'revoke_token', token_id: VALID_ID, case_id: 'CASE-5', approval_ref: 'APP-5' }],
    ['security_admin', { action: 'revoke_admin_tokens', admin_id: VALID_ID, case_id: 'CASE-6', approval_ref: 'APP-6' }],
    ['owner', { action: 'set_post_pinned', post_id: VALID_ID, pinned: true }],
  ]) {
    const calls = []
    globalThis.fetch = authenticatedFetch(calls, async (url, init) => {
      assert.equal(url.pathname, '/rest/v1/rpc/admin_execute_mutation')
      assert.equal(JSON.parse(init.body).p_action, body.action)
      return new Response(JSON.stringify(validMutationResult(body)), { status: 200 })
    }, role)
    const handler = await loadHandler()
    const response = await handler(adminPost(body))
    assert.equal(response.status, 200, role)
  }
})

test('banner reads honor validated limit and offset with a unique deterministic order', async () => {
  const calls = []
  globalThis.fetch = authenticatedFetch(calls, async (url) => {
    assert.equal(url.pathname, '/rest/v1/banners')
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
  const handler = await loadHandler()
  const response = await handler(new Request(
    'https://app.test/api/admin?resource=banners&limit=21&offset=20',
    { headers: { Authorization: `Bearer ${ADMIN_A}` } },
  ))

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { data: [] })
  const read = calls.find(call => call.url.pathname === '/rest/v1/banners')
  assert.ok(read)
  assert.equal(read.url.searchParams.get('limit'), '21')
  assert.equal(read.url.searchParams.get('offset'), '20')
  assert.equal(read.url.searchParams.get('order'), 'priority.desc,created_at.desc,id.desc')
})

test('missing report and suspension details return a retryable 404 instead of null success', async () => {
  for (const resource of ['report', 'suspension']) {
    const calls = []
    globalThis.fetch = authenticatedFetch(calls, async (url) => {
      assert.match(url.pathname, /\/rest\/v1\/rpc\/admin_get_(?:report|suspension)_detail/)
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    const handler = await loadHandler()
    const response = await handler(new Request(
      `https://app.test/api/admin?resource=${resource}&id=${VALID_ID}`,
      { headers: { Authorization: `Bearer ${ADMIN_A}` } },
    ))
    assert.equal(response.status, 404, resource)
    assert.deepEqual(await response.json(), { error: 'admin_detail_not_found' }, resource)
  }
})

test('security and owner token inventory includes active-owner recovery health', async () => {
  for (const [rows, expected] of [
    [[], {
      active_owner_tokens: 0,
      unverified_owner_tokens: 0,
      expiring_owner_tokens: 0,
      non_expiring_owner_tokens: 0,
      nearest_owner_expiry: null,
      status: 'critical',
    }],
    [[tokenInventoryRow({ expires_at: '2099-01-01T00:00:00Z' })], {
      active_owner_tokens: 0,
      unverified_owner_tokens: 1,
      expiring_owner_tokens: 0,
      non_expiring_owner_tokens: 0,
      nearest_owner_expiry: null,
      status: 'critical',
    }],
    [[tokenInventoryRow({
      last_used_at: '2026-07-19T00:00:00Z',
      expires_at: '2099-01-01T00:00:00Z',
    })], {
      active_owner_tokens: 1,
      unverified_owner_tokens: 0,
      expiring_owner_tokens: 0,
      non_expiring_owner_tokens: 0,
      nearest_owner_expiry: '2099-01-01T00:00:00Z',
      status: 'warning',
    }],
    [[
      tokenInventoryRow({ last_used_at: '2026-07-19T00:00:00Z' }),
      tokenInventoryRow({
        id: IDEMPOTENCY_KEY,
        last_used_at: '2026-07-19T00:00:00Z',
        expires_at: '2099-01-01T00:00:00Z',
      }),
    ], {
      active_owner_tokens: 2,
      unverified_owner_tokens: 0,
      expiring_owner_tokens: 0,
      non_expiring_owner_tokens: 1,
      nearest_owner_expiry: '2099-01-01T00:00:00Z',
      status: 'healthy',
    }],
    [[tokenInventoryRow({
      last_used_at: '2026-07-19T00:00:00Z',
      expires_at: RECOVERY_TOO_SOON_EXPIRY,
    })], {
      active_owner_tokens: 0,
      unverified_owner_tokens: 0,
      expiring_owner_tokens: 1,
      non_expiring_owner_tokens: 0,
      nearest_owner_expiry: null,
      status: 'critical',
    }],
  ]) {
    const calls = []
    globalThis.fetch = authenticatedFetch(calls, async (url) => {
      assert.equal(url.pathname, '/rest/v1/rpc/admin_token_inventory')
      return new Response(JSON.stringify(rows), { status: 200 })
    }, 'security_admin')
    const handler = await loadHandler()
    const response = await handler(new Request('https://app.test/api/admin?resource=tokens', {
      headers: { Authorization: `Bearer ${ADMIN_A}` },
    }))
    assert.equal(response.status, 200)
    const data = (await response.json()).data
    assert.deepEqual(data.tokens, rows)
    assert.deepEqual(data.owner_recovery, expected)
  }
})

test('token inventory validates and projects every provider row before returning browser data', async () => {
  const detached = tokenInventoryRow({
    admin_id: null,
    revoked_at: '2026-07-19T00:00:00Z',
  })
  {
    const calls = []
    globalThis.fetch = authenticatedFetch(calls, async () => new Response(JSON.stringify([detached]), { status: 200 }), 'security_admin')
    const handler = await loadHandler()
    const response = await handler(new Request('https://app.test/api/admin?resource=tokens', {
      headers: { Authorization: `Bearer ${ADMIN_A}` },
    }))
    assert.equal(response.status, 200)
    assert.deepEqual((await response.json()).data.tokens, [detached])
  }

  for (const malformed of [
    { not: 'an array' },
    [tokenInventoryRow({ token_hash: 'f'.repeat(64) })],
    [tokenInventoryRow({ admin_id: null })],
    [tokenInventoryRow({ admin_name: null })],
    [tokenInventoryRow({ admin_email: null })],
    [tokenInventoryRow({ created_at: 'not-a-timestamp' })],
  ]) {
    const calls = []
    globalThis.fetch = authenticatedFetch(calls, async () => new Response(JSON.stringify(malformed), { status: 200 }), 'security_admin')
    const handler = await loadHandler()
    const response = await handler(new Request('https://app.test/api/admin?resource=tokens', {
      headers: { Authorization: `Bearer ${ADMIN_A}` },
    }))
    assert.equal(response.status, 500)
    assert.deepEqual(await response.json(), { error: 'admin_upstream_malformed' })
  }
})

test('replacement owner can reconcile one token hash without receiving the hash or plaintext', async () => {
  const tokenHash = 'f'.repeat(64)
  const calls = []
  globalThis.fetch = authenticatedFetch(calls, async (url, init) => {
    assert.equal(url.pathname, '/rest/v1/rpc/admin_reconcile_issued_token')
    assert.deepEqual(JSON.parse(init.body), { p_token_hash: tokenHash })
    return new Response(JSON.stringify([{
      id: IDEMPOTENCY_KEY,
      admin_id: VALID_ID,
      role: 'operator',
      expires_at: ISSUE_EXPIRY,
      revoked_at: null,
    }]), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }, 'owner')
  const handler = await loadHandler()
  const response = await handler(new Request(
    'https://app.test/api/admin?resource=token_reconciliation',
    {
      headers: {
        Authorization: `Bearer ${ADMIN_A}`,
        'X-Admin-Token-Hash': tokenHash,
      },
    },
  ))
  assert.equal(response.status, 200)
  const responseBody = await response.json()
  assert.deepEqual(responseBody, {
    data: {
      found: true,
      token_id: IDEMPOTENCY_KEY,
      admin_id: VALID_ID,
      role: 'operator',
      expires_at: ISSUE_EXPIRY,
      revoked_at: null,
      server_now: AUTH_SERVER_NOW,
    },
  })
  assert.equal(JSON.stringify(responseBody).includes(tokenHash), false)
})

test('missing token reconciliation still carries the authoritative database clock', async () => {
  const calls = []
  globalThis.fetch = authenticatedFetch(
    calls,
    async () => new Response('[]', { status: 200 }),
    'owner',
  )
  const handler = await loadHandler()
  const response = await handler(new Request(
    'https://app.test/api/admin?resource=token_reconciliation',
    {
      headers: {
        Authorization: `Bearer ${ADMIN_A}`,
        'X-Admin-Token-Hash': 'f'.repeat(64),
      },
    },
  ))

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    data: { found: false, server_now: AUTH_SERVER_NOW },
  })
})

test('replacement owner reconciliation preserves a detached revoked token as authoritative evidence', async () => {
  const tokenHash = 'e'.repeat(64)
  const revokedAt = '2026-07-19T00:00:00Z'
  const calls = []
  globalThis.fetch = authenticatedFetch(calls, async (url) => {
    assert.equal(url.pathname, '/rest/v1/rpc/admin_reconcile_issued_token')
    return new Response(JSON.stringify([{
      id: IDEMPOTENCY_KEY,
      admin_id: null,
      role: 'operator',
      expires_at: ISSUE_EXPIRY,
      revoked_at: revokedAt,
    }]), { status: 200 })
  }, 'owner')
  const handler = await loadHandler()
  const response = await handler(new Request(
    'https://app.test/api/admin?resource=token_reconciliation',
    {
      headers: {
        Authorization: `Bearer ${ADMIN_A}`,
        'X-Admin-Token-Hash': tokenHash,
      },
    },
  ))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    data: {
      found: true,
      token_id: IDEMPOTENCY_KEY,
      admin_id: null,
      role: 'operator',
      expires_at: ISSUE_EXPIRY,
      revoked_at: revokedAt,
      server_now: AUTH_SERVER_NOW,
    },
  })
})

test('token reconciliation is owner-only and malformed provider 2xx fails closed', async () => {
  for (const role of ['operator', 'security_admin']) {
    const calls = []
    globalThis.fetch = authenticatedFetch(calls, null, role)
    const handler = await loadHandler()
    const response = await handler(new Request(
      'https://app.test/api/admin?resource=token_reconciliation',
      { headers: { Authorization: `Bearer ${ADMIN_A}`, 'X-Admin-Token-Hash': 'f'.repeat(64) } },
    ))
    assert.equal(response.status, 403)
    assert.equal(calls.some(call => call.url.pathname === '/rest/v1/rpc/admin_reconcile_issued_token'), false)
  }

  const calls = []
  globalThis.fetch = authenticatedFetch(calls, async () => new Response(JSON.stringify([{
    id: IDEMPOTENCY_KEY,
    admin_id: VALID_ID,
    role: 'operator',
    expires_at: ISSUE_EXPIRY,
    revoked_at: null,
    unexpected: true,
  }]), { status: 200 }))
  const handler = await loadHandler()
  const response = await handler(new Request(
    'https://app.test/api/admin?resource=token_reconciliation',
    { headers: { Authorization: `Bearer ${ADMIN_A}`, 'X-Admin-Token-Hash': 'f'.repeat(64) } },
  ))
  assert.equal(response.status, 500)
  assert.deepEqual(await response.json(), { error: 'admin_upstream_malformed' })
})

test('replacement owner reconciles opaque idempotency outcomes through an exact status contract', async () => {
  for (const status of ['completed', 'running', 'not_dispatched']) {
    const calls = []
    globalThis.fetch = authenticatedFetch(calls, async (url, init) => {
      assert.equal(url.pathname, '/rest/v1/rpc/admin_reconcile_idempotency_outcome')
      const body = JSON.parse(init.body)
      assert.equal(body.p_idempotency_key, IDEMPOTENCY_KEY)
      assert.match(body.p_token_hash, /^[0-9a-f]{64}$/)
      return new Response(JSON.stringify({ status }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }, 'owner')
    const handler = await loadHandler()
    const response = await handler(new Request(
      `https://app.test/api/admin?resource=idempotency_reconciliation&idempotency_key=${IDEMPOTENCY_KEY}`,
      { headers: { Authorization: `Bearer ${ADMIN_A}` } },
    ))
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { data: { status } })
  }
})

test('idempotency reconciliation is owner-only and rejects malformed keys or provider projections', async () => {
  for (const role of ['operator', 'security_admin']) {
    const calls = []
    globalThis.fetch = authenticatedFetch(calls, null, role)
    const handler = await loadHandler()
    const response = await handler(new Request(
      `https://app.test/api/admin?resource=idempotency_reconciliation&idempotency_key=${IDEMPOTENCY_KEY}`,
      { headers: { Authorization: `Bearer ${ADMIN_A}` } },
    ))
    assert.equal(response.status, 403)
    assert.equal(calls.some(call => call.url.pathname.includes('reconcile_idempotency')), false)
  }

  const malformedKeyCalls = []
  globalThis.fetch = authenticatedFetch(malformedKeyCalls, null, 'owner')
  const malformedKeyHandler = await loadHandler()
  const malformedKeyResponse = await malformedKeyHandler(new Request(
    'https://app.test/api/admin?resource=idempotency_reconciliation&idempotency_key=not-a-uuid',
    { headers: { Authorization: `Bearer ${ADMIN_A}` } },
  ))
  assert.equal(malformedKeyResponse.status, 400)
  assert.equal(malformedKeyCalls.some(call => call.url.pathname.includes('reconcile_idempotency')), false)

  for (const providerBody of [
    { status: 'not_found' },
    { status: 'completed', result: { secret: true } },
    [{ status: 'completed' }],
  ]) {
    const calls = []
    globalThis.fetch = authenticatedFetch(calls, async () => new Response(
      JSON.stringify(providerBody),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ), 'owner')
    const handler = await loadHandler()
    const response = await handler(new Request(
      `https://app.test/api/admin?resource=idempotency_reconciliation&idempotency_key=${IDEMPOTENCY_KEY}`,
      { headers: { Authorization: `Bearer ${ADMIN_A}` } },
    ))
    assert.equal(response.status, 500)
    assert.deepEqual(await response.json(), { error: 'admin_upstream_malformed' })
  }
})

test('migration-owned absence, revoke and managed-upload sentinels map to stable responses', async () => {
  const cases = [
    [{ action: 'apply_ban', target_id: VALID_ID, level: 1, reason: 'x' }, 'apply_ban_target_not_found', 404, 'admin_mutation_not_found'],
    [{ action: 'lift_suspension', suspension_id: VALID_ID, reason: 'x' }, 'suspension_not_active', 404, 'admin_mutation_not_found'],
    [{ action: 'update_report_status', report_id: VALID_ID, status: 'resolved' }, 'report_not_found', 404, 'admin_mutation_not_found'],
    [{ action: 'resolve_target_reports', target_type: 'user', target_id: VALID_ID, status: 'resolved' }, 'report_group_not_found', 404, 'admin_mutation_not_found'],
    [{ action: 'takedown_content', target_type: 'post', target_id: VALID_ID, reason: 'confirmed policy violation' }, 'content_not_found', 404, 'admin_mutation_not_found'],
    [{ action: 'set_post_pinned', post_id: VALID_ID, pinned: true }, 'post_not_found', 404, 'admin_mutation_not_found'],
    [{ action: 'delete_banner', id: VALID_ID }, 'banner_not_found', 404, 'admin_mutation_not_found'],
    [{ action: 'issue_token', token_hash: 'b'.repeat(64), admin_id: VALID_ID, role: 'operator', expires_at: ISSUE_EXPIRY, case_id: 'CASE-11', approval_ref: 'APP-11' }, 'admin_profile_not_found', 404, 'admin_mutation_not_found'],
    [{ action: 'issue_token', token_hash: 'c'.repeat(64), admin_id: VALID_ID, role: 'operator', expires_at: ISSUE_EXPIRY, case_id: 'CASE-12', approval_ref: 'APP-12' }, 'admin_token_hash_conflict', 409, 'admin_mutation_conflict'],
    [{ action: 'issue_token', token_hash: 'e'.repeat(64), admin_id: VALID_ID, role: 'operator', expires_at: ISSUE_EXPIRY, case_id: 'CASE-12B', approval_ref: 'APP-12B' }, 'admin_account_deletion_in_progress', 409, 'admin_mutation_conflict'],
    [{ action: 'revoke_admin_tokens', admin_id: VALID_ID, case_id: 'CASE-13', approval_ref: 'APP-13' }, 'admin_token_batch_conflict', 409, 'admin_mutation_conflict'],
    [{ action: 'upsert_banner', image_url: MANAGED_BANNER_URL }, 'admin_upload_required', 400, 'admin_mutation_invalid'],
    [{ action: 'revoke_token', token_id: VALID_ID, case_id: 'CASE-7', approval_ref: 'APP-7' }, 'token_not_active', 409, 'admin_mutation_conflict'],
    [{ action: 'revoke_token', token_id: VALID_ID, case_id: 'CASE-8', approval_ref: 'APP-8' }, 'self_revoke_forbidden', 409, 'admin_mutation_conflict'],
    [{ action: 'revoke_token', token_id: VALID_ID, case_id: 'CASE-9', approval_ref: 'APP-9' }, 'last_active_admin_token', 409, 'admin_mutation_conflict'],
  ]
  for (const [body, providerMessage, status, error] of cases) {
    const calls = []
    globalThis.fetch = authenticatedFetch(calls, async (url) => {
      if (url.pathname === '/rest/v1/rpc/admin_execute_mutation') {
        return new Response(JSON.stringify({ code: 'P0002', message: providerMessage }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`unexpected business call ${url.pathname}`)
    })
    const handler = await loadHandler()
    const response = await handler(adminPost(body))

    assert.equal(response.status, status)
    assert.deepEqual(await response.json(), { error })
    assert.equal(calls.filter(call => call.url.pathname === '/rest/v1/rpc/record_audit').length, 0)
  }
})

test('mutation transport uncertainty preserves one caller key and a stable payload hash for reconciliation', async () => {
  const calls = []
  let mutationAttempts = 0
  const seenRequests = []
  globalThis.fetch = authenticatedFetch(calls, async (url, init) => {
    if (url.pathname !== '/rest/v1/rpc/admin_execute_mutation') {
      throw new Error(`unexpected business call ${url.pathname}`)
    }
    mutationAttempts += 1
    seenRequests.push(JSON.parse(init.body))
    if (mutationAttempts === 1) throw new Error('response_lost_after_commit')
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  const handler = await loadHandler()
  const body = { action: 'set_post_pinned', post_id: VALID_ID, pinned: true }

  const first = await handler(adminPost(body))
  assert.equal(first.status, 503)
  assert.deepEqual(await first.json(), { error: 'admin_outcome_unknown' })

  const retry = await handler(adminPost(body))
  assert.equal(retry.status, 200)
  assert.deepEqual(await retry.json(), { success: true })
  assert.equal(mutationAttempts, 2)
  assert.equal(seenRequests[0].p_idempotency_key, IDEMPOTENCY_KEY)
  assert.equal(seenRequests[1].p_idempotency_key, IDEMPOTENCY_KEY)
  assert.equal(seenRequests[0].p_payload_hash, seenRequests[1].p_payload_hash)
})

test('malformed or action-mismatched 2xx mutation results remain outcome-unknown', async () => {
  const bannerBody = { action: 'upsert_banner', id: VALID_ID, active: true }
  const bannerWithProviderDrift = validMutationResult(bannerBody)
  bannerWithProviderDrift.data.unexpected_private_column = 'must-not-cross-edge-boundary'
  const cases = [
    [{ action: 'set_post_pinned', post_id: VALID_ID, pinned: true }, {}],
    [{ action: 'set_post_pinned', post_id: VALID_ID, pinned: true }, { success: false }],
    [{ action: 'apply_ban', target_id: VALID_ID, level: 1, reason: 'x' }, { data: 'not-a-uuid' }],
    [{ action: 'resolve_target_reports', target_type: 'user', target_id: VALID_ID, status: 'resolved' }, { data: { ok: true, affected: 0 } }],
    [{
      action: 'decide_appeal', suspension_id: VALID_ID,
      decision: 'accepted', reason: 'x',
    }, { data: {
      suspension_id: VALID_ID, decision: 'accepted', terminal: false,
      lifted_now: true, remains_active: false,
    } }],
    [{
      action: 'decide_appeal', suspension_id: VALID_ID,
      decision: 'accepted', reason: 'x',
    }, { data: {
      suspension_id: VALID_ID, decision: 'accepted', terminal: true,
      lifted_now: false, remains_active: true,
    } }],
    [{
      action: 'decide_appeal', suspension_id: VALID_ID,
      decision: 'denied', reason: 'x',
    }, { data: {
      suspension_id: VALID_ID, decision: 'denied', terminal: true,
      lifted_now: true, remains_active: false,
    } }],
    [{
      action: 'decide_appeal', suspension_id: VALID_ID,
      decision: 'more_information_required', reason: 'x',
    }, { data: {
      suspension_id: VALID_ID, decision: 'more_information_required', terminal: false,
      lifted_now: true, remains_active: false,
    } }],
    [{
      action: 'decide_appeal', suspension_id: VALID_ID,
      decision: 'denied', reason: 'x',
    }, { data: {
      suspension_id: IDEMPOTENCY_KEY, decision: 'denied', terminal: true,
      lifted_now: false, remains_active: true,
    } }],
    [{
      action: 'decide_appeal', suspension_id: VALID_ID,
      decision: 'denied', reason: 'x',
    }, { data: {
      suspension_id: VALID_ID, decision: 'accepted', terminal: true,
      lifted_now: false, remains_active: false,
    } }],
    [{
      action: 'decide_appeal', suspension_id: VALID_ID,
      decision: 'denied', reason: 'x',
    }, { data: {
      suspension_id: VALID_ID, decision: 'denied', terminal: true,
      lifted_now: false, remains_active: true, unexpected: true,
    } }],
    [bannerBody, { data: { id: IDEMPOTENCY_KEY, active: true } }],
    [bannerBody, bannerWithProviderDrift],
    [{
      action: 'issue_token', token_hash: 'd'.repeat(64), admin_id: VALID_ID,
      role: 'operator', expires_at: ISSUE_EXPIRY, case_id: 'CASE-MALFORMED', approval_ref: 'APP-MALFORMED',
    }, { data: {
      token_id: IDEMPOTENCY_KEY, admin_id: IDEMPOTENCY_KEY,
      role: 'operator', expires_at: ISSUE_EXPIRY,
    } }],
    [{
      action: 'revoke_admin_tokens', admin_id: VALID_ID,
      case_id: 'CASE-MALFORMED', approval_ref: 'APP-MALFORMED',
    }, { data: { admin_id: VALID_ID, token_ids: [IDEMPOTENCY_KEY], revoked_count: 2 } }],
  ]

  for (const [body, providerResult] of cases) {
    const calls = []
    globalThis.fetch = authenticatedFetch(calls, async (url) => {
      assert.equal(url.pathname, '/rest/v1/rpc/admin_execute_mutation')
      return new Response(JSON.stringify(providerResult), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    const handler = await loadHandler()
    const response = await handler(adminPost(body))
    assert.equal(response.status, 503, body.action)
    assert.deepEqual(await response.json(), { error: 'admin_outcome_unknown' }, body.action)
  }
})

test('mutation-time token revocation fails closed even after the initial identity probe passed', async () => {
  const calls = []
  globalThis.fetch = authenticatedFetch(calls, async (url) => {
    if (url.pathname === '/rest/v1/rpc/admin_execute_mutation') {
      return new Response(JSON.stringify({ code: '28000', message: 'admin_token_inactive' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    throw new Error(`unexpected business call ${url.pathname}`)
  })
  const handler = await loadHandler()
  const response = await handler(adminPost({
    action: 'set_post_pinned',
    post_id: VALID_ID,
    pinned: true,
  }))

  assert.equal(response.status, 401)
  assert.deepEqual(await response.json(), { error: 'admin_token_inactive' })
})

test('capability denial is 403 and arbitrary provider messages remain opaque', async () => {
  for (const [providerMessage, providerStatus, status, error] of [
    ['admin_capability_denied', 403, 403, 'admin_capability_denied'],
    ['last_active_owner_token', 400, 409, 'admin_mutation_conflict'],
    ['row user@example.test failed secret-policy', 400, 500, 'admin_upstream_failed'],
  ]) {
    const calls = []
    globalThis.fetch = authenticatedFetch(calls, async (url) => {
      if (url.pathname === '/rest/v1/rpc/admin_execute_mutation') {
        return new Response(JSON.stringify({ code: 'P0001', message: providerMessage }), {
          status: providerStatus,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`unexpected business call ${url.pathname}`)
    })
    const handler = await loadHandler()
    const response = await handler(adminPost({
      action: 'revoke_token',
      token_id: VALID_ID,
      case_id: 'CASE-10',
      approval_ref: 'APP-10',
    }))
    assert.equal(response.status, status)
    const result = await response.json()
    assert.deepEqual(result, { error })
    assert.doesNotMatch(JSON.stringify(result), /user@example|secret-policy/)
  }
})

test('appeal lifecycle sentinels map to stable definitive HTTP outcomes', async () => {
  for (const [providerMessage, status, error] of [
    ['self_appeal_decision_forbidden', 403, 'self_appeal_decision_forbidden'],
    ['appeal_already_decided', 409, 'appeal_already_decided'],
    ['appeal_not_found', 404, 'admin_mutation_not_found'],
    ['appeal_lift_conflict', 409, 'admin_mutation_conflict'],
  ]) {
    const calls = []
    globalThis.fetch = authenticatedFetch(calls, async (url) => {
      assert.equal(url.pathname, '/rest/v1/rpc/admin_execute_mutation')
      return new Response(JSON.stringify({ code: 'P0001', message: providerMessage }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    const handler = await loadHandler()
    const response = await handler(adminPost({
      action: 'decide_appeal',
      suspension_id: VALID_ID,
      decision: 'denied',
      reason: 'reviewed evidence',
    }))
    assert.equal(response.status, status, providerMessage)
    assert.deepEqual(await response.json(), { error }, providerMessage)
  }
})
