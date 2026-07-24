import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertSafePrivilegedNetworkEnvironment,
  buildRetirementPlan,
  normalizeSupabaseOrigin,
  parseRetirementArguments,
  retireWechatCredentials,
} from './retire-wechat-passwords.mjs'

const UID = '11111111-1111-4111-8111-111111111111'
const OPENID = 'Openid_A-12345'
const EMAIL = `wx_${OPENID}@wechat.placeholder`.toLowerCase()
const UID_2 = '22222222-2222-4222-8222-222222222222'
const OPENID_2 = 'Openid_B-67890'
const EMAIL_2 = `wx_${OPENID_2}@wechat.placeholder`.toLowerCase()
const PRODUCTION_URL = 'https://lfhvgprfphyfvhidegum.supabase.co'
const PROJECT_REF = 'lfhvgprfphyfvhidegum'
const SERVICE_KEY = 'sb_secret_named-test-key-that-must-not-be-logged'
const REVIEWED_SHA256 = 'a'.repeat(64)

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function postgrestJson(rows, total = rows.length) {
  const range = rows.length === 0 ? '*' : `0-${rows.length - 1}`
  return json(rows, 200, { 'Content-Range': `${range}/${total}` })
}

function fixtureInventorySha256({
  missingAuthUser = false,
  missingProfile = false,
  mapInitiallyPresent = true,
} = {}) {
  return buildRetirementPlan(
    mapInitiallyPresent ? [{ openid: OPENID }] : [],
    new Map(!missingProfile ? [[OPENID, UID]] : []),
    [
      ...(!missingAuthUser ? [{ id: UID, email: EMAIL }] : []),
      { id: '33333333-3333-4333-8333-333333333333', email: null },
    ],
  ).inventorySha256
}

function fixtureFetch(calls, {
  failRotation = false,
  missingAuthUser = false,
  missingProfile = false,
  mapInitiallyPresent = true,
  addMaplessIdentityAfterRotation = false,
  addMaplessIdentityAfterCleanup = false,
} = {}) {
  let mapPresent = mapInitiallyPresent
  let rotationCompleted = false
  return async (input, init = {}) => {
    const url = new URL(String(input))
    const method = init.method || 'GET'
    const body = init.body ? JSON.parse(init.body) : null
    calls.push({ url, method, body, headers: new Headers(init.headers) })
    if (url.pathname === '/rest/v1/wechat_password_map' && method === 'GET') {
      return postgrestJson(mapPresent ? [{ openid: OPENID }] : [])
    }
    if (url.pathname === '/rest/v1/profiles') {
      const newIdentityVisible =
        (addMaplessIdentityAfterRotation && rotationCompleted) ||
        (addMaplessIdentityAfterCleanup && !mapPresent)
      const profiles = [
        ...(!missingProfile ? [{ id: UID, wechat_openid: OPENID }] : []),
        ...(newIdentityVisible
          ? [{ id: UID_2, wechat_openid: OPENID_2 }]
          : []),
      ]
      return postgrestJson(profiles)
    }
    if (url.pathname === '/auth/v1/admin/users' && method === 'GET') {
      const newIdentityVisible =
        (addMaplessIdentityAfterRotation && rotationCompleted) ||
        (addMaplessIdentityAfterCleanup && !mapPresent)
      const users = [
        ...(!missingAuthUser ? [{ id: UID, email: EMAIL }] : []),
        ...(newIdentityVisible
          ? [{ id: UID_2, email: EMAIL_2 }]
          : []),
        { id: '33333333-3333-4333-8333-333333333333', email: null },
      ]
      return json(
        { users },
        200,
        { 'x-total-count': String(users.length) },
      )
    }
    if (url.pathname === `/auth/v1/admin/users/${UID}` && method === 'PUT') {
      if (failRotation) return json({ code: 'failure' }, 500)
      rotationCompleted = true
      return json({ user: { id: UID } })
    }
    if (url.pathname === '/rest/v1/wechat_password_map' && method === 'DELETE') {
      mapPresent = false
      return new Response(null, { status: 204 })
    }
    throw new Error(`unexpected ${method} ${url}`)
  }
}

function retryableMultiIdentityFixture(calls, {
  failSecondRotationOnce = false,
  failSecondDeleteOnce = false,
} = {}) {
  const state = {
    mapOpenids: [OPENID, OPENID_2],
    rotationAttempts: 0,
    deleteAttempts: 0,
  }
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input))
    const method = init.method || 'GET'
    const body = init.body ? JSON.parse(init.body) : null
    calls.push({ url, method, body, headers: new Headers(init.headers) })
    if (url.pathname === '/rest/v1/wechat_password_map' && method === 'GET') {
      const cursor = (url.searchParams.get('openid') || '').replace(/^gt\./, '')
      const rows = state.mapOpenids
        .filter(openid => !cursor || openid > cursor)
        .map(openid => ({ openid }))
      return postgrestJson(rows)
    }
    if (url.pathname === '/rest/v1/profiles' && method === 'GET') {
      const cursor = (url.searchParams.get('id') || '').replace(/^gt\./, '')
      const rows = [
        { id: UID, wechat_openid: OPENID },
        { id: UID_2, wechat_openid: OPENID_2 },
      ].filter(row => !cursor || row.id > cursor)
      return postgrestJson(rows)
    }
    if (url.pathname === '/auth/v1/admin/users' && method === 'GET') {
      const users = [
        { id: UID, email: EMAIL },
        { id: UID_2, email: EMAIL_2 },
      ]
      return json({ users }, 200, { 'x-total-count': '2' })
    }
    if (url.pathname.startsWith('/auth/v1/admin/users/') && method === 'PUT') {
      state.rotationAttempts += 1
      if (failSecondRotationOnce && state.rotationAttempts === 2) {
        return json({ code: 'failure' }, 500)
      }
      return json({ user: { id: decodeURIComponent(url.pathname.split('/').at(-1)) } })
    }
    if (url.pathname === '/rest/v1/wechat_password_map' && method === 'DELETE') {
      state.deleteAttempts += 1
      const openid = (url.searchParams.get('openid') || '').replace(/^eq\./, '')
      if (failSecondDeleteOnce && state.deleteAttempts === 2) {
        return json({ code: 'failure' }, 500)
      }
      state.mapOpenids = state.mapOpenids.filter(value => value !== openid)
      return new Response(null, { status: 204 })
    }
    throw new Error(`unexpected ${method} ${url}`)
  }
  return { fetchImpl, state }
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
  assert.throws(() => buildRetirementPlan(
    [],
    new Map(),
    [{ id: UID, email: 'wx_invalid+openid@wechat.placeholder' }],
  ), /placeholder_auth_email_invalid/)
  assert.doesNotThrow(() => buildRetirementPlan(
    [],
    new Map(),
    [
      { id: UID, email: 'shared-non-placeholder@example.test' },
      { id: UID_2, email: 'shared-non-placeholder@example.test' },
    ],
  ))
})

test('production target, flags, and destructive confirmation are exact and unique', () => {
  assert.deepEqual(parseRetirementArguments(['--project-ref', PROJECT_REF]), {
    apply: false,
    projectRef: PROJECT_REF,
    expectedInventorySha256: '',
  })
  assert.deepEqual(parseRetirementArguments([
    '--project-ref', PROJECT_REF,
    '--apply',
    '--confirm', 'RETIRE_WECHAT_PASSWORDS',
    '--expected-inventory-sha256', REVIEWED_SHA256,
  ]), {
    apply: true,
    projectRef: PROJECT_REF,
    expectedInventorySha256: REVIEWED_SHA256,
  })
  assert.throws(() => parseRetirementArguments([]), /exact_production_project_ref_required/)
  assert.throws(
    () => parseRetirementArguments(['--project-ref', PROJECT_REF, '--apply']),
    /apply_requires_confirmation/,
  )
  assert.throws(
    () => parseRetirementArguments([
      '--project-ref', PROJECT_REF,
      '--apply',
      '--confirm', 'RETIRE_WECHAT_PASSWORDS',
    ]),
    /apply_requires_reviewed_inventory_sha256/,
  )
  assert.throws(
    () => parseRetirementArguments(['--project-ref', PROJECT_REF, '--project-ref', PROJECT_REF]),
    /duplicate_argument/,
  )
  assert.throws(
    () => parseRetirementArguments(['--project-ref', PROJECT_REF, '--shell', 'bash']),
    /unknown_argument/,
  )
  const misplacedSecret = 'sb_secret_must-never-appear-in-an-error'
  assert.throws(
    () => parseRetirementArguments(['--project-ref', PROJECT_REF, misplacedSecret]),
    error => error.message === 'unknown_argument' && !error.message.includes(misplacedSecret),
  )
})

test('privileged inventory rejects every unreviewed origin or legacy key before a request', async () => {
  for (const [supabaseUrl, serviceKey] of [
    ['https://attacker.example', SERVICE_KEY],
    ['https://another-project.supabase.co', SERVICE_KEY],
    [PRODUCTION_URL, 'legacy-service-role-jwt'],
  ]) {
    const calls = []
    await assert.rejects(() => retireWechatCredentials({
      fetchImpl: async (...args) => {
        calls.push(args)
        throw new Error('must_not_call')
      },
      supabaseUrl,
      serviceKey,
      apply: false,
      logger: { log() {} },
    }), /invalid_configuration/)
    assert.equal(calls.length, 0)
  }
})

test('privileged inventory rejects active TLS, proxy, preload, and key-log overrides before a request', async () => {
  for (const environment of [
    { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    { NODE_EXTRA_CA_CERTS: '/tmp/unreviewed-ca.pem' },
    { SSL_CERT_FILE: '/tmp/unreviewed-ca.pem' },
    { SSLKEYLOGFILE: '/tmp/tls-keys.log' },
    { NODE_USE_ENV_PROXY: '1', HTTPS_PROXY: 'http://127.0.0.1:8080' },
    { NODE_OPTIONS: '--use-env-proxy' },
    { NODE_OPTIONS: '--use-env-proxy=true' },
    { NODE_OPTIONS: '--require /tmp/unreviewed-preload.cjs' },
    { NODE_OPTIONS: '--tls-keylog=/tmp/tls-keys.log' },
    { NODE_OPTIONS: '--trace-tls' },
    { NODE_OPTIONS: '--use-openssl-ca' },
    { NODE_DEBUG: 'http,tls' },
  ]) {
    const calls = []
    await assert.rejects(() => retireWechatCredentials({
      fetchImpl: async (...args) => {
        calls.push(args)
        throw new Error('must_not_call')
      },
      supabaseUrl: PRODUCTION_URL,
      serviceKey: SERVICE_KEY,
      apply: false,
      logger: { log() {} },
      environment,
    }), /unsafe_privileged_network_environment/)
    assert.equal(calls.length, 0)
  }
  assert.doesNotThrow(() => assertSafePrivilegedNetworkEnvironment({
    NODE_TLS_REJECT_UNAUTHORIZED: '1',
    HTTP_PROXY: 'http://inert-unless-enabled.example',
    HTTPS_PROXY: 'http://inert-unless-enabled.example',
  }))
})

test('privileged inventory rejects an oversized upstream body before parsing it', async () => {
  const oversizedFetch = async () => new Response('{}', {
    status: 200,
    headers: { 'Content-Length': String(8 * 1024 * 1024 + 1) },
  })
  await assert.rejects(() => retireWechatCredentials({
    fetchImpl: oversizedFetch,
    supabaseUrl: PRODUCTION_URL,
    serviceKey: SERVICE_KEY,
    apply: false,
    logger: { log() {} },
  }), /response_too_large/)
})

test('a repeated full inventory page stops in bounded requests and before every mutation', async () => {
  const calls = []
  const repeatedRows = Array.from({ length: 500 }, (_, index) => ({
    openid: `Openid_${String(index).padStart(6, '0')}`,
  }))
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input))
    const method = init.method || 'GET'
    calls.push({ url, method })
    if (url.pathname === '/rest/v1/wechat_password_map') {
      return postgrestJson(
        repeatedRows,
        url.searchParams.has('openid') ? 500 : 1000,
      )
    }
    if (url.pathname === '/rest/v1/profiles') return postgrestJson([])
    if (url.pathname === '/auth/v1/admin/users') {
      return json({ users: [] }, 200, { 'x-total-count': '0' })
    }
    throw new Error(`unexpected ${method} ${url}`)
  }
  await assert.rejects(() => retireWechatCredentials({
    fetchImpl,
    supabaseUrl: PRODUCTION_URL,
    serviceKey: SERVICE_KEY,
    apply: true,
    logger: { log() {} },
  }), /map_inventory_not_progressing/)
  const mapCalls = calls.filter(
    call => call.url.pathname === '/rest/v1/wechat_password_map',
  )
  assert.equal(mapCalls.length, 2)
  assert.equal(mapCalls[0].url.searchParams.has('offset'), false)
  assert.equal(mapCalls[1].url.searchParams.get('openid'), 'gt.Openid_000499')
  assert.equal(mapCalls[0].url.searchParams.get('limit'), '500')
  assert.equal(calls.some(call => call.method === 'PUT' || call.method === 'DELETE'), false)
})

test('exact counts keep map and profile inventories complete below the requested page size', async () => {
  const calls = []
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input))
    const method = init.method || 'GET'
    const headers = new Headers(init.headers)
    calls.push({ url, method, headers })
    if (url.pathname === '/rest/v1/wechat_password_map') {
      return url.searchParams.has('openid')
        ? postgrestJson([{ openid: OPENID_2 }], 1)
        : postgrestJson([{ openid: OPENID }], 2)
    }
    if (url.pathname === '/rest/v1/profiles') {
      return url.searchParams.has('id')
        ? postgrestJson([{ id: UID_2, wechat_openid: OPENID_2 }], 1)
        : postgrestJson([{ id: UID, wechat_openid: OPENID }], 2)
    }
    if (url.pathname === '/auth/v1/admin/users') {
      return json({
        users: [
          { id: UID, email: EMAIL },
          { id: UID_2, email: EMAIL_2 },
        ],
      }, 200, { 'x-total-count': '2' })
    }
    throw new Error(`unexpected ${method} ${url}`)
  }

  const result = await retireWechatCredentials({
    fetchImpl,
    supabaseUrl: PRODUCTION_URL,
    serviceKey: SERVICE_KEY,
    apply: false,
    logger: { log() {} },
  })
  assert.equal(result.mapRows, 2)
  assert.equal(result.rotationCount, 2)
  const mapCalls = calls.filter(call => call.url.pathname === '/rest/v1/wechat_password_map')
  const profileCalls = calls.filter(call => call.url.pathname === '/rest/v1/profiles')
  assert.equal(mapCalls.length, 2)
  assert.equal(profileCalls.length, 2)
  assert.equal(mapCalls[1].url.searchParams.get('openid'), `gt.${OPENID}`)
  assert.equal(profileCalls[1].url.searchParams.get('id'), `gt.${UID}`)
  for (const call of [...mapCalls, ...profileCalls]) {
    assert.equal(call.headers.get('prefer'), 'count=exact')
    assert.equal(call.url.searchParams.has('offset'), false)
  }
  assert.equal(calls.some(call => call.method === 'PUT' || call.method === 'DELETE'), false)
})

test('map and profile inventories reject missing or changing exact counts', async () => {
  const missingMapCountFetch = async (input) => {
    const url = new URL(String(input))
    if (url.pathname === '/rest/v1/wechat_password_map') return json([])
    if (url.pathname === '/rest/v1/profiles') return postgrestJson([])
    if (url.pathname === '/auth/v1/admin/users') {
      return json({ users: [] }, 200, { 'x-total-count': '0' })
    }
    throw new Error(`unexpected ${url}`)
  }
  await assert.rejects(() => retireWechatCredentials({
    fetchImpl: missingMapCountFetch,
    supabaseUrl: PRODUCTION_URL,
    serviceKey: SERVICE_KEY,
    apply: false,
    logger: { log() {} },
  }), /map_inventory_exact_count_missing/)

  const changingProfileCountFetch = async (input) => {
    const url = new URL(String(input))
    if (url.pathname === '/rest/v1/wechat_password_map') return postgrestJson([])
    if (url.pathname === '/rest/v1/profiles') {
      return url.searchParams.has('id')
        ? postgrestJson([{ id: UID_2, wechat_openid: OPENID_2 }], 2)
        : postgrestJson([{ id: UID, wechat_openid: OPENID }], 2)
    }
    if (url.pathname === '/auth/v1/admin/users') {
      return json({
        users: [
          { id: UID, email: EMAIL },
          { id: UID_2, email: EMAIL_2 },
        ],
      }, 200, { 'x-total-count': '2' })
    }
    throw new Error(`unexpected ${url}`)
  }
  await assert.rejects(() => retireWechatCredentials({
    fetchImpl: changingProfileCountFetch,
    supabaseUrl: PRODUCTION_URL,
    serviceKey: SERVICE_KEY,
    apply: false,
    logger: { log() {} },
  }), /profile_inventory_exact_count_changed/)
})

test('Auth inventory rejects a total that changes between pages', async () => {
  const fetchImpl = async (input) => {
    const url = new URL(String(input))
    if (url.pathname === '/rest/v1/wechat_password_map') return postgrestJson([])
    if (url.pathname === '/rest/v1/profiles') return postgrestJson([])
    if (url.pathname === '/auth/v1/admin/users') {
      const secondPage = url.searchParams.get('page') === '2'
      return json({
        users: [secondPage
          ? { id: UID_2, email: EMAIL_2 }
          : { id: UID, email: EMAIL }],
      }, 200, { 'x-total-count': secondPage ? '3' : '2' })
    }
    throw new Error(`unexpected ${url}`)
  }
  await assert.rejects(() => retireWechatCredentials({
    fetchImpl,
    supabaseUrl: PRODUCTION_URL,
    serviceKey: SERVICE_KEY,
    apply: false,
    logger: { log() {} },
  }), /auth_inventory_total_changed/)
})

test('phone-only Auth users with an empty email remain canonical inventory members', async () => {
  const phoneOnlyId = '33333333-3333-4333-8333-333333333333'
  const calls = []
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input))
    const method = init.method || 'GET'
    calls.push({ url, method })
    if (url.pathname === '/rest/v1/wechat_password_map') return postgrestJson([])
    if (url.pathname === '/rest/v1/profiles') return postgrestJson([])
    if (url.pathname === '/auth/v1/admin/users') {
      return json(
        { users: [{ id: phoneOnlyId, email: '' }] },
        200,
        { 'x-total-count': '1' },
      )
    }
    throw new Error(`unexpected ${method} ${url}`)
  }

  const result = await retireWechatCredentials({
    fetchImpl,
    supabaseUrl: PRODUCTION_URL,
    serviceKey: SERVICE_KEY,
    apply: false,
    logger: { log() {} },
  })
  const expected = buildRetirementPlan(
    [],
    new Map(),
    [{ id: phoneOnlyId, email: null }],
  )
  assert.equal(result.inventorySha256, expected.inventorySha256)
  assert.equal(result.rotationCount, 0)
  assert.equal(calls.some(call => call.method === 'PUT' || call.method === 'DELETE'), false)
})

test('Auth inventory requires a total and two identical complete scans', async () => {
  let authCall = 0
  const calls = []
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input))
    const method = init.method || 'GET'
    calls.push({ url, method })
    if (url.pathname === '/rest/v1/wechat_password_map') return postgrestJson([])
    if (url.pathname === '/rest/v1/profiles') return postgrestJson([])
    if (url.pathname === '/auth/v1/admin/users') {
      authCall += 1
      const user = authCall === 1
        ? { id: UID, email: EMAIL }
        : { id: UID_2, email: EMAIL_2 }
      return json({ users: [user] }, 200, { 'x-total-count': '1' })
    }
    throw new Error(`unexpected ${method} ${url}`)
  }
  await assert.rejects(() => retireWechatCredentials({
    fetchImpl,
    supabaseUrl: PRODUCTION_URL,
    serviceKey: SERVICE_KEY,
    apply: false,
    logger: { log() {} },
  }), /auth_inventory_not_stable/)
  assert.equal(calls.some(call => call.method === 'PUT' || call.method === 'DELETE'), false)
})

test('apply binds the exact reviewed inventory digest before every mutation', async () => {
  const calls = []
  await assert.rejects(() => retireWechatCredentials({
    fetchImpl: fixtureFetch(calls),
    supabaseUrl: PRODUCTION_URL,
    serviceKey: SERVICE_KEY,
    apply: true,
    expectedInventorySha256: 'b'.repeat(64),
    logger: { log() {} },
  }), /reviewed_inventory_digest_mismatch/)
  assert.equal(calls.some(call => call.method === 'PUT' || call.method === 'DELETE'), false)
})

test('dry run inventories but never rotates or deletes credentials', async () => {
  const calls = []
  const logs = []
  const result = await retireWechatCredentials({
    fetchImpl: fixtureFetch(calls),
    supabaseUrl: PRODUCTION_URL,
    serviceKey: SERVICE_KEY,
    apply: false,
    logger: { log: message => logs.push(message) },
  })
  assert.equal(result.applied, false)
  assert.equal(result.mapRows, 1)
  assert.match(result.inventorySha256, /^[0-9a-f]{64}$/)
  assert.equal(logs.includes(`Inventory SHA-256: ${result.inventorySha256}`), true)
  assert.equal(calls.some(call => call.method === 'PUT' || call.method === 'DELETE'), false)
  assert.equal(JSON.stringify(logs).includes(OPENID), false)
  assert.equal(JSON.stringify(logs).includes(SERVICE_KEY), false)
})

test('an opaque secret key is preferred as apikey and never forged into a bearer JWT', async () => {
  const calls = []
  await retireWechatCredentials({
    fetchImpl: fixtureFetch(calls),
    supabaseUrl: PRODUCTION_URL,
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
    supabaseUrl: PRODUCTION_URL,
    serviceKey: SERVICE_KEY,
    apply: true,
    expectedInventorySha256: fixtureInventorySha256(),
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

test('mapless HMAC-era placeholder Auth user is still rotated before retirement', async () => {
  const plan = buildRetirementPlan(
    [],
    new Map([[OPENID, UID]]),
    [{ id: UID, email: EMAIL }],
  )
  assert.deepEqual(plan.targets, [{ userId: UID, openid: OPENID }])
  assert.equal(plan.maplessRotationCount, 1)
  assert.equal(plan.orphanRows, 0)

  const calls = []
  const result = await retireWechatCredentials({
    fetchImpl: fixtureFetch(calls, { mapInitiallyPresent: false }),
    supabaseUrl: PRODUCTION_URL,
    serviceKey: SERVICE_KEY,
    apply: true,
    expectedInventorySha256: fixtureInventorySha256({ mapInitiallyPresent: false }),
    logger: { log() {} },
  })
  assert.equal(result.mapRows, 0)
  assert.equal(result.rotationCount, 1)
  assert.equal(result.maplessRotationCount, 1)
  assert.equal(calls.filter(call => call.method === 'PUT').length, 1)
  assert.equal(calls.some(call => call.method === 'DELETE'), false)
})

test('a failed Auth rotation prevents every legacy-map deletion', async () => {
  const calls = []
  await assert.rejects(() => retireWechatCredentials({
    fetchImpl: fixtureFetch(calls, { failRotation: true }),
    supabaseUrl: PRODUCTION_URL,
    serviceKey: SERVICE_KEY,
    apply: true,
    expectedInventorySha256: fixtureInventorySha256(),
    logger: { log() {} },
  }), /auth_rotation_failed/)
  assert.equal(calls.some(call => call.method === 'DELETE'), false)
})

test('an in-flight mapless HMAC identity after rotation stops before map deletion', async () => {
  const calls = []
  await assert.rejects(() => retireWechatCredentials({
    fetchImpl: fixtureFetch(calls, { addMaplessIdentityAfterRotation: true }),
    supabaseUrl: PRODUCTION_URL,
    serviceKey: SERVICE_KEY,
    apply: true,
    expectedInventorySha256: fixtureInventorySha256(),
    logger: { log() {} },
  }), /wechat_inventory_changed_after_rotation/)
  assert.equal(calls.filter(call => call.method === 'PUT').length, 1)
  assert.equal(calls.some(call => call.method === 'DELETE'), false)
})

test('an identity created during cleanup invalidates the final receipt', async () => {
  const calls = []
  await assert.rejects(() => retireWechatCredentials({
    fetchImpl: fixtureFetch(calls, { addMaplessIdentityAfterCleanup: true }),
    supabaseUrl: PRODUCTION_URL,
    serviceKey: SERVICE_KEY,
    apply: true,
    expectedInventorySha256: fixtureInventorySha256(),
    logger: { log() {} },
  }), /wechat_inventory_changed_after_cleanup/)
  assert.equal(calls.some(call => call.method === 'DELETE'), true)
})

test('a partial Auth rotation failure leaves the map intact and is safely retryable', async () => {
  const calls = []
  const fixture = retryableMultiIdentityFixture(calls, {
    failSecondRotationOnce: true,
  })
  const expectedInventorySha256 = buildRetirementPlan(
    [{ openid: OPENID }, { openid: OPENID_2 }],
    new Map([[OPENID, UID], [OPENID_2, UID_2]]),
    [{ id: UID, email: EMAIL }, { id: UID_2, email: EMAIL_2 }],
  ).inventorySha256
  await assert.rejects(() => retireWechatCredentials({
    fetchImpl: fixture.fetchImpl,
    supabaseUrl: PRODUCTION_URL,
    serviceKey: SERVICE_KEY,
    apply: true,
    expectedInventorySha256,
    logger: { log() {} },
  }), /auth_rotation_failed/)
  assert.deepEqual(fixture.state.mapOpenids, [OPENID, OPENID_2])

  const result = await retireWechatCredentials({
    fetchImpl: fixture.fetchImpl,
    supabaseUrl: PRODUCTION_URL,
    serviceKey: SERVICE_KEY,
    apply: true,
    expectedInventorySha256,
    logger: { log() {} },
  })
  assert.equal(result.applied, true)
  assert.deepEqual(fixture.state.mapOpenids, [])
})

test('a partial map cleanup requires a new digest and is safely retryable', async () => {
  const calls = []
  const fixture = retryableMultiIdentityFixture(calls, {
    failSecondDeleteOnce: true,
  })
  const initialInventorySha256 = buildRetirementPlan(
    [{ openid: OPENID }, { openid: OPENID_2 }],
    new Map([[OPENID, UID], [OPENID_2, UID_2]]),
    [{ id: UID, email: EMAIL }, { id: UID_2, email: EMAIL_2 }],
  ).inventorySha256
  await assert.rejects(() => retireWechatCredentials({
    fetchImpl: fixture.fetchImpl,
    supabaseUrl: PRODUCTION_URL,
    serviceKey: SERVICE_KEY,
    apply: true,
    expectedInventorySha256: initialInventorySha256,
    logger: { log() {} },
  }), /map_delete_failed/)
  assert.deepEqual(fixture.state.mapOpenids, [OPENID_2])

  const reviewedRetry = await retireWechatCredentials({
    fetchImpl: fixture.fetchImpl,
    supabaseUrl: PRODUCTION_URL,
    serviceKey: SERVICE_KEY,
    apply: false,
    logger: { log() {} },
  })
  assert.notEqual(reviewedRetry.inventorySha256, initialInventorySha256)
  const result = await retireWechatCredentials({
    fetchImpl: fixture.fetchImpl,
    supabaseUrl: PRODUCTION_URL,
    serviceKey: SERVICE_KEY,
    apply: true,
    expectedInventorySha256: reviewedRetry.inventorySha256,
    logger: { log() {} },
  })
  assert.equal(result.applied, true)
  assert.equal(result.maplessRotationCount, 1)
  assert.deepEqual(fixture.state.mapOpenids, [])
})

for (const [label, fixtureOptions] of [
  ['map-backed profile without Auth user', { missingAuthUser: true }],
  ['map-backed Auth user without profile', { missingProfile: true }],
  ['mapless profile without Auth user', { missingAuthUser: true, mapInitiallyPresent: false }],
  ['mapless Auth user without profile', { missingProfile: true, mapInitiallyPresent: false }],
]) {
  test(`apply stops before every mutation for an orphan with ${label}`, async () => {
    const calls = []
    await assert.rejects(() => retireWechatCredentials({
      fetchImpl: fixtureFetch(calls, fixtureOptions),
      supabaseUrl: PRODUCTION_URL,
      serviceKey: SERVICE_KEY,
      apply: true,
      expectedInventorySha256: fixtureInventorySha256(fixtureOptions),
      logger: { log() {} },
    }), /orphan_wechat_identities_require_investigation/)
    assert.equal(calls.some(call => call.method === 'PUT'), false)
    assert.equal(calls.some(call => call.method === 'DELETE'), false)
  })
}
