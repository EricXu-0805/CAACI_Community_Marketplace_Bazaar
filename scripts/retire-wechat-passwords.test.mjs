import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildRetirementPlan,
  normalizeSupabaseOrigin,
  retireWechatCredentials,
} from './retire-wechat-passwords.mjs'

const UID = '11111111-1111-4111-8111-111111111111'
const OPENID = 'Openid_A-12345'
const EMAIL = `wx_${OPENID}@wechat.placeholder`.toLowerCase()
const SERVICE_KEY = 'service-secret-that-must-not-be-logged'

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function fixtureFetch(calls, { failRotation = false } = {}) {
  let mapPresent = true
  return async (input, init = {}) => {
    const url = new URL(String(input))
    const method = init.method || 'GET'
    const body = init.body ? JSON.parse(init.body) : null
    calls.push({ url, method, body, headers: new Headers(init.headers) })
    if (url.pathname === '/rest/v1/wechat_password_map' && method === 'GET') {
      return json(mapPresent ? [{ openid: OPENID }] : [])
    }
    if (url.pathname === '/rest/v1/profiles') {
      return json([{ id: UID, wechat_openid: OPENID }])
    }
    if (url.pathname === '/auth/v1/admin/users' && method === 'GET') {
      return json({ users: [
        { id: UID, email: EMAIL },
        { id: '33333333-3333-4333-8333-333333333333', email: null },
      ] })
    }
    if (url.pathname === `/auth/v1/admin/users/${UID}` && method === 'PUT') {
      if (failRotation) return json({ code: 'failure' }, 500)
      return json({ user: { id: UID } })
    }
    if (url.pathname === '/rest/v1/wechat_password_map' && method === 'DELETE') {
      mapPresent = false
      return new Response(null, { status: 204 })
    }
    throw new Error(`unexpected ${method} ${url}`)
  }
}

test('configuration and case-normalized identity plans fail closed', () => {
  assert.equal(normalizeSupabaseOrigin('https://project.supabase.co/'), 'https://project.supabase.co')
  assert.equal(normalizeSupabaseOrigin('http://attacker.example'), '')
  assert.equal(normalizeSupabaseOrigin('https://user:pass@project.supabase.co'), '')

  assert.throws(() => buildRetirementPlan(
    [{ openid: 'CaseSensitive' }, { openid: 'casesensitive' }],
    new Map(),
    [],
  ), /placeholder_email_case_collision/)
  assert.throws(() => buildRetirementPlan(
    [{ openid: OPENID }],
    new Map([[OPENID, '22222222-2222-4222-8222-222222222222']]),
    [{ id: UID, email: EMAIL }],
  ), /wechat_identity_user_mismatch/)
})

test('privileged inventory rejects an oversized upstream body before parsing it', async () => {
  const oversizedFetch = async () => new Response('{}', {
    status: 200,
    headers: { 'Content-Length': String(8 * 1024 * 1024 + 1) },
  })
  await assert.rejects(() => retireWechatCredentials({
    fetchImpl: oversizedFetch,
    supabaseUrl: 'https://project.supabase.co',
    serviceKey: SERVICE_KEY,
    apply: false,
    logger: { log() {} },
  }), /response_too_large/)
})

test('dry run inventories but never rotates or deletes credentials', async () => {
  const calls = []
  const logs = []
  const result = await retireWechatCredentials({
    fetchImpl: fixtureFetch(calls),
    supabaseUrl: 'https://project.supabase.co',
    serviceKey: SERVICE_KEY,
    apply: false,
    logger: { log: message => logs.push(message) },
  })
  assert.equal(result.applied, false)
  assert.equal(result.mapRows, 1)
  assert.equal(calls.some(call => call.method === 'PUT' || call.method === 'DELETE'), false)
  assert.equal(JSON.stringify(logs).includes(OPENID), false)
  assert.equal(JSON.stringify(logs).includes(SERVICE_KEY), false)
})

test('an opaque secret key is preferred as apikey and never forged into a bearer JWT', async () => {
  const calls = []
  await retireWechatCredentials({
    fetchImpl: fixtureFetch(calls),
    supabaseUrl: 'https://project.supabase.co',
    serviceKey: 'sb_secret_named-test-key',
    apply: false,
    logger: { log() {} },
  })
  assert.ok(calls.length > 0)
  for (const call of calls) {
    assert.equal(call.headers.get('apikey'), 'sb_secret_named-test-key')
    assert.equal(call.headers.has('authorization'), false)
  }
})

test('apply rotates every matching Auth password before deleting and verifies the map', async () => {
  const calls = []
  const result = await retireWechatCredentials({
    fetchImpl: fixtureFetch(calls),
    supabaseUrl: 'https://project.supabase.co',
    serviceKey: SERVICE_KEY,
    apply: true,
    logger: { log() {} },
  })
  assert.equal(result.applied, true)
  const rotationIndex = calls.findIndex(call => call.method === 'PUT')
  const deleteIndex = calls.findIndex(call => call.method === 'DELETE')
  assert.ok(rotationIndex >= 0 && deleteIndex > rotationIndex)
  const password = calls[rotationIndex].body.password
  assert.ok(password.length >= 64)
  assert.match(password, /^Wx!.*9a$/)
  assert.equal(password.includes(OPENID), false)
  assert.equal(calls.at(-1).method, 'GET')
})

test('a failed Auth rotation prevents every legacy-map deletion', async () => {
  const calls = []
  await assert.rejects(() => retireWechatCredentials({
    fetchImpl: fixtureFetch(calls, { failRotation: true }),
    supabaseUrl: 'https://project.supabase.co',
    serviceKey: SERVICE_KEY,
    apply: true,
    logger: { log() {} },
  }), /auth_rotation_failed/)
  assert.equal(calls.some(call => call.method === 'DELETE'), false)
})
