// Leading underscore prevents Vercel from treating this test as an API Function.
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { inlineDeploymentBoundaryImport } from './_test-module-loader.mjs'

const API_ROOT = new URL('./', import.meta.url)
const USER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222'
const CRON_SECRET = 'cron-test-secret'
const ENV_KEYS = [
  'SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY', 'CRON_SECRET',
]
const originalEnv = new Map(ENV_KEYS.map(key => [key, process.env[key]]))
const originalFetch = globalThis.fetch
const originalConsoleError = console.error
let importNonce = 0

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key)
    if (value == null) delete process.env[key]
    else process.env[key] = value
  }
  globalThis.fetch = originalFetch
  console.error = originalConsoleError
})

async function loadApi({ cronSecret = CRON_SECRET, transform = source => source } = {}) {
  for (const key of ENV_KEYS) delete process.env[key]
  Object.assign(process.env, {
    SUPABASE_URL: 'https://supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-test-key',
    SUPABASE_ANON_KEY: 'anon-test-key',
    ...(cronSecret ? { CRON_SECRET: cronSecret } : {}),
  })
  const source = transform(await readFile(new URL('auth/delete-account.js', API_ROOT), 'utf8'))
  const encoded = Buffer.from(inlineDeploymentBoundaryImport(source)).toString('base64')
  return import(`data:text/javascript;base64,${encoded}#delete-account-test-${importNonce++}`)
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

function requestUrl(input) {
  return new URL(input instanceof Request ? input.url : String(input))
}

function requestMethod(input, init = {}) {
  return String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
}

function requestBody(init = {}) {
  return init.body ? JSON.parse(String(init.body)) : null
}

function requestPrefer(init = {}) {
  const headers = new Headers(init.headers || {})
  return headers.get('prefer') || ''
}

function deleteRequest(body = {}) {
  return new Request('https://app.test/api/auth/delete-account', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer caller-token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function cronRequest(secret = CRON_SECRET) {
  return new Request('https://app.test/api/auth/delete-account', {
    method: 'GET',
    headers: secret ? { Authorization: `Bearer ${secret}` } : {},
  })
}

function jobRow(stage = 'requested', overrides = {}) {
  const completed = stage === 'completed'
  return {
    user_id: USER_ID,
    stage,
    wechat_openid: 'wx-test',
    last_error: null,
    requested_at: '2026-07-18T00:00:00.000Z',
    updated_at: '2026-07-18T00:00:00.000Z',
    completed_at: completed ? '2026-07-18T00:01:00.000Z' : null,
    ...overrides,
  }
}

function createHarness({
  initialJob = null,
  jobTableMissing = false,
  adminPreparationReady = true,
  adminPreparationStatus = 200,
  adminPreparationJobMutator = row => row,
  loadJobMutator = row => row,
  checkpointRowMutator = row => row,
  storageObjects = ['photo.jpg', 'clip.mp4'],
  storageDeleteStatuses = [],
  storageDeleteApplies = true,
  storageListMutator = result => result,
  authDeleteStatuses = [],
  storageObjectsAddedOnAuthDelete = [],
  wechatDeleteStatuses = [],
  wechatRpcMissing = false,
  wechatLegacyDeleteStatuses = [],
  checkpointFailures = {},
} = {}) {
  const calls = []
  let job = initialJob ? { ...initialJob } : null
  const ownerPrefix = `items/${USER_ID}/`
  let nextStorageId = 1
  const normalizeStorageName = name => String(name).startsWith('items/')
    ? String(name)
    : `${ownerPrefix}${name}`
  const storageRow = name => ({
    id: `storage-object-${nextStorageId++}`,
    name: normalizeStorageName(name),
  })
  let objects = storageObjects.map(storageRow)
  let authDeleteAdditionApplied = false
  const checkpointFailureCounts = { ...checkpointFailures }

  const fetch = async (input, init = {}) => {
    const url = requestUrl(input)
    const method = requestMethod(input, init)
    const body = requestBody(init)
    const prefer = requestPrefer(init)
    calls.push({ url, method, body, prefer })

    if (url.pathname === '/auth/v1/user') return json({ id: USER_ID })

    if (url.pathname === '/rest/v1/rpc/admin_prepare_account_deletion' && method === 'POST') {
      if (jobTableMissing) {
        return json({ code: '42883', message: 'function does not exist' }, 404)
      }
      if (adminPreparationStatus !== 200) {
        return json({ code: 'XX000', message: 'prepare failed' }, adminPreparationStatus)
      }
      if (!adminPreparationReady) {
        return json({
          ready: false,
          reason: 'admin_recovery_transfer_required',
          job: null,
        })
      }
      if (!job) job = jobRow('requested')
      return json({
        ready: true,
        reason: null,
        job: adminPreparationJobMutator({ ...job }),
      })
    }

    if (url.pathname === '/rest/v1/account_deletion_jobs') {
      if (jobTableMissing) {
        return json({ code: '42P01', message: 'relation does not exist' }, 404)
      }

      if (method === 'GET') {
        if (url.searchParams.get('stage') === 'in.(requested,storage_deleted,auth_deleted)') {
          return json(job && job.stage !== 'completed' ? [{ ...job }] : [])
        }
        return json(job ? [loadJobMutator({ ...job })] : [])
      }

      if (method === 'POST') {
        if (job) return json({ code: '23505', message: 'duplicate key' }, 409)
        job = jobRow('requested', {
          ...body,
          last_error: null,
          completed_at: null,
        })
        return json([{ ...job }], 201)
      }

      if (method === 'PATCH') {
        const expectedStage = String(url.searchParams.get('stage') || '').replace(/^eq\./, '')
        const nextStage = body?.stage
        if (nextStage && checkpointFailureCounts[nextStage] > 0) {
          checkpointFailureCounts[nextStage] -= 1
          return json({ code: 'XX000', message: 'simulated checkpoint crash' }, 500)
        }
        if (job && (!expectedStage || job.stage === expectedStage)) {
          job = { ...job, ...body }
          return prefer.includes('return=minimal')
            ? empty()
            : json([checkpointRowMutator({ ...job }, { expectedStage, nextStage })])
        }
        return prefer.includes('return=minimal') ? empty() : json([])
      }
    }

    if (url.pathname === '/rest/v1/profiles') return json([{ wechat_openid: 'wx-test' }])

    if (url.pathname === '/storage/v1/object/list-v2/item-images') {
      const limit = Number(body?.limit || 100)
      const prefix = String(body?.prefix || '')
      const cursor = String(body?.cursor || '')
      const eligible = objects
        .filter(row => row.name.startsWith(prefix) && (!cursor || row.name > cursor))
        .sort((left, right) => left.name.localeCompare(right.name))
      const page = eligible.slice(0, limit)
      const hasNext = eligible.length > limit
      return json(storageListMutator({
        hasNext,
        ...(hasNext ? { nextCursor: page.at(-1).name, nextCursorKey: page.at(-1).name } : {}),
        folders: [],
        objects: page.map(row => ({ ...row })),
      }, { body, objects: objects.map(row => ({ ...row })) }))
    }

    if (url.pathname === '/storage/v1/object/item-images' && method === 'DELETE') {
      const status = storageDeleteStatuses.length ? storageDeleteStatuses.shift() : 204
      if (status >= 200 && status < 300 && storageDeleteApplies) {
        const deletedNames = new Set(body?.prefixes || [])
        objects = objects.filter(row => !deletedNames.has(row.name))
      }
      return empty(status)
    }

    if (url.pathname === `/auth/v1/admin/users/${USER_ID}` && method === 'DELETE') {
      const status = authDeleteStatuses.length ? authDeleteStatuses.shift() : 204
      if (status >= 200 && status < 300 && !authDeleteAdditionApplied) {
        // Simulate an old access JWT winning the race after the pre-Auth
        // Storage sweep but immediately before Auth deletion commits.
        objects.push(...storageObjectsAddedOnAuthDelete.map(storageRow))
        authDeleteAdditionApplied = true
      }
      return empty(status)
    }

    if (url.pathname === '/rest/v1/rpc/delete_wechat_password_credential' && method === 'POST') {
      if (wechatRpcMissing) {
        return json({ code: 'PGRST202', message: 'function missing' }, 404)
      }
      const outcome = wechatDeleteStatuses.length ? wechatDeleteStatuses.shift() : 204
      if (typeof outcome === 'object') {
        return json({ code: outcome.code || '', message: 'simulated RPC error' }, outcome.status)
      }
      return empty(outcome)
    }

    if (url.pathname === '/rest/v1/wechat_password_map' && method === 'DELETE') {
      return empty(
        wechatLegacyDeleteStatuses.length ? wechatLegacyDeleteStatuses.shift() : 204,
      )
    }

    throw new Error(`unexpected fetch ${method} ${url}`)
  }

  return {
    fetch,
    calls,
    get job() { return job },
    get objects() {
      return objects.map(row => row.name.startsWith(ownerPrefix)
        ? row.name.slice(ownerPrefix.length)
        : row.name)
    },
    addStorageObject(name) { objects.push(storageRow(name)) },
  }
}

function callIndex(calls, predicate) {
  return calls.findIndex(predicate)
}

test('persists the durable job before side effects and checkpoints every ordered step', async () => {
  const harness = createHarness()
  globalThis.fetch = harness.fetch
  const { default: handler } = await loadApi()

  const response = await handler(deleteRequest())
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { success: true, status: 'completed' })
  assert.equal(harness.job.stage, 'completed')
  assert.ok(harness.job.completed_at)

  const jobPreparation = callIndex(harness.calls, call =>
    call.url.pathname === '/rest/v1/rpc/admin_prepare_account_deletion' && call.method === 'POST')
  const storageDelete = callIndex(harness.calls, call =>
    call.url.pathname === '/storage/v1/object/item-images' && call.method === 'DELETE')
  const storageCheckpoint = callIndex(harness.calls, call => call.body?.stage === 'storage_deleted')
  const authDelete = callIndex(harness.calls, call =>
    call.url.pathname === `/auth/v1/admin/users/${USER_ID}` && call.method === 'DELETE')
  const authCheckpoint = callIndex(harness.calls, call => call.body?.stage === 'auth_deleted')
  const postAuthStorageList = harness.calls.findIndex((call, index) =>
    index > authCheckpoint
      && call.url.pathname === '/storage/v1/object/list-v2/item-images')
  const wechatDelete = callIndex(harness.calls, call =>
    call.url.pathname === '/rest/v1/rpc/delete_wechat_password_credential' && call.method === 'POST')
  const completionCheckpoint = callIndex(harness.calls, call => call.body?.stage === 'completed')

  assert.ok(jobPreparation >= 0 && jobPreparation < storageDelete)
  assert.deepEqual(harness.calls[jobPreparation].body, { p_user_id: USER_ID })
  assert.ok(storageDelete < storageCheckpoint)
  assert.ok(storageCheckpoint < authDelete && authDelete < authCheckpoint)
  assert.ok(authCheckpoint < postAuthStorageList && postAuthStorageList < wechatDelete)
  assert.ok(wechatDelete < completionCheckpoint)
  assert.deepEqual(harness.calls[wechatDelete].body, { openid_in: 'wx-test' })
  assert.equal(harness.calls[wechatDelete].url.search, '')
  assert.equal(harness.calls.some(call =>
    call.url.pathname === '/rest/v1/wechat_password_map'), false)
})

test('a valid Auth user without a profile can complete deletion with a null WeChat identity', async () => {
  const harness = createHarness({
    // The database preparation RPC emits this shape when the Auth trigger
    // previously allowed account creation despite a profile insert failure.
    initialJob: jobRow('requested', { wechat_openid: null }),
    adminPreparationJobMutator: row => ({ ...row, wechat_openid: null }),
  })
  globalThis.fetch = harness.fetch
  const { default: handler } = await loadApi()

  const response = await handler(deleteRequest())
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { success: true, status: 'completed' })
  assert.equal(harness.job.stage, 'completed')
  assert.equal(harness.calls.some(call => (
    call.url.pathname === '/rest/v1/rpc/delete_wechat_password_credential'
  )), false)
  assert.equal(harness.calls.some(call => (
    call.url.pathname === `/auth/v1/admin/users/${USER_ID}` && call.method === 'DELETE'
  )), true)
})

test('pre-retirement RPC absence uses one exact legacy row delete and completes the saga', async () => {
  const harness = createHarness({ wechatRpcMissing: true })
  globalThis.fetch = harness.fetch
  const { default: handler } = await loadApi()

  const response = await handler(deleteRequest())
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { success: true, status: 'completed' })
  const rpcCall = harness.calls.find(call => (
    call.url.pathname === '/rest/v1/rpc/delete_wechat_password_credential'
  ))
  const legacyCall = harness.calls.find(call => (
    call.url.pathname === '/rest/v1/wechat_password_map'
  ))
  assert.ok(rpcCall)
  assert.ok(legacyCall)
  assert.equal(legacyCall.method, 'DELETE')
  assert.equal(legacyCall.url.searchParams.get('openid'), 'eq.wx-test')
  assert.equal(legacyCall.prefer, 'return=minimal')
})

test('RPC 404/42883 undefined_function uses one exact legacy row delete and completes the saga', async () => {
  const harness = createHarness({
    wechatDeleteStatuses: [{ status: 404, code: '42883' }],
  })
  globalThis.fetch = harness.fetch
  const { default: handler } = await loadApi()

  const response = await handler(deleteRequest())
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { success: true, status: 'completed' })
  assert.equal(harness.job.stage, 'completed')

  const rpcCalls = harness.calls.filter(call => (
    call.url.pathname === '/rest/v1/rpc/delete_wechat_password_credential'
  ))
  const legacyCalls = harness.calls.filter(call => (
    call.url.pathname === '/rest/v1/wechat_password_map'
  ))
  assert.equal(rpcCalls.length, 1)
  assert.deepEqual(rpcCalls[0].body, { openid_in: 'wx-test' })
  assert.equal(rpcCalls[0].url.search, '')
  assert.equal(legacyCalls.length, 1)
  assert.equal(legacyCalls[0].method, 'DELETE')
  assert.equal(legacyCalls[0].url.searchParams.get('openid'), 'eq.wx-test')
  assert.equal(legacyCalls[0].prefer, 'return=minimal')
})

test('malformed durable WeChat identity cannot reach the legacy PostgREST delete filter', async () => {
  console.error = () => {}
  const harness = createHarness({
    initialJob: jobRow('auth_deleted', { wechat_openid: 'wx-test,openid=neq.safe' }),
    wechatRpcMissing: true,
  })
  globalThis.fetch = harness.fetch
  const { default: handler } = await loadApi()

  const response = await handler(cronRequest())
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), {
    success: false,
    error: 'deletion_jobs_pending',
    processed: 1,
    completed: 0,
    pending: 1,
  })
  assert.equal(harness.calls.filter(call => (
    call.url.pathname === '/rest/v1/rpc/delete_wechat_password_credential'
  )).length, 1)
  assert.equal(harness.calls.some(call => (
    call.url.pathname === '/rest/v1/wechat_password_map'
  )), false)
  assert.equal(harness.job.stage, 'auth_deleted')
  assert.equal(harness.job.last_error, 'wechat_legacy_openid_invalid')
})

test('failed pre-retirement legacy delete leaves the auth-deleted saga retryable', async () => {
  console.error = () => {}
  const harness = createHarness({
    initialJob: jobRow('auth_deleted'),
    wechatRpcMissing: true,
    wechatLegacyDeleteStatuses: [500, 204],
  })
  globalThis.fetch = harness.fetch
  const { default: handler } = await loadApi()

  const first = await handler(cronRequest())
  assert.equal(first.status, 503)
  assert.equal(harness.job.stage, 'auth_deleted')
  assert.match(harness.job.last_error, /^wechat_legacy_delete_failed:500/)

  const second = await handler(cronRequest())
  assert.equal(second.status, 200)
  assert.equal(harness.job.stage, 'completed')
  assert.equal(harness.calls.filter(call => (
    call.url.pathname === '/rest/v1/wechat_password_map'
  )).length, 2)
})

for (const outcome of [
  { status: 404, code: 'PGRST301' },
  { status: 500, code: 'PGRST202' },
  { status: 500, code: '42883' },
]) {
  test(`RPC ${outcome.status}/${outcome.code} never downgrades to legacy table delete`, async () => {
    console.error = () => {}
    const harness = createHarness({
      initialJob: jobRow('auth_deleted'),
      wechatDeleteStatuses: [outcome],
    })
    globalThis.fetch = harness.fetch
    const { default: handler } = await loadApi()

    const response = await handler(cronRequest())
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), {
      success: false,
      error: 'deletion_jobs_pending',
      processed: 1,
      completed: 0,
      pending: 1,
    })
    assert.equal(harness.calls.some(call => (
      call.url.pathname === '/rest/v1/wechat_password_map'
    )), false)
    assert.equal(harness.job.stage, 'auth_deleted')
    assert.match(harness.job.last_error, new RegExp(`^wechat_delete_failed:${outcome.status}:${outcome.code}`))
  })
}

test('returns 503 before every destructive call when the jobs migration is absent', async () => {
  console.error = () => {}
  const harness = createHarness({ jobTableMissing: true })
  globalThis.fetch = harness.fetch
  const { default: handler } = await loadApi()

  const response = await handler(deleteRequest())
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'delete_unavailable' })
  assert.deepEqual(
    harness.calls.map(call => `${call.method} ${call.url.pathname}`),
    ['GET /auth/v1/user', 'POST /rest/v1/rpc/admin_prepare_account_deletion'],
  )
})

test('last administrator recovery holder is rejected atomically before tombstone or Storage', async () => {
  const harness = createHarness({ adminPreparationReady: false })
  globalThis.fetch = harness.fetch
  const { default: handler } = await loadApi()

  const response = await handler(deleteRequest())
  assert.equal(response.status, 409)
  assert.deepEqual(await response.json(), { error: 'admin_recovery_transfer_required' })
  assert.equal(harness.job, null)
  assert.deepEqual(harness.objects, ['photo.jpg', 'clip.mp4'])
  assert.deepEqual(
    harness.calls.map(call => `${call.method} ${call.url.pathname}`),
    ['GET /auth/v1/user', 'POST /rest/v1/rpc/admin_prepare_account_deletion'],
  )
})

test('fails closed when atomic preparation returns a different user job', async () => {
  console.error = () => {}
  const harness = createHarness({
    adminPreparationJobMutator: row => ({ ...row, user_id: OTHER_USER_ID }),
  })
  globalThis.fetch = harness.fetch
  const { default: handler } = await loadApi()

  const response = await handler(deleteRequest())
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'delete_unavailable' })
  assert.deepEqual(
    harness.calls.map(call => `${call.method} ${call.url.pathname}`),
    ['GET /auth/v1/user', 'POST /rest/v1/rpc/admin_prepare_account_deletion'],
  )
  assert.equal(harness.calls.some(call => call.url.pathname.startsWith('/storage/')), false)
  assert.equal(harness.calls.some(call => call.url.pathname.startsWith('/auth/v1/admin/users/')), false)
})

test('fails closed when atomic preparation returns a malformed 2xx job', async () => {
  console.error = () => {}
  const harness = createHarness({
    adminPreparationJobMutator: row => ({ ...row, unexpected: true }),
  })
  globalThis.fetch = harness.fetch
  const { default: handler } = await loadApi()

  const response = await handler(deleteRequest())
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'delete_unavailable' })
  assert.equal(harness.calls.some(call => call.url.pathname.startsWith('/storage/')), false)
  assert.equal(harness.calls.some(call => call.url.pathname.startsWith('/auth/v1/admin/users/')), false)
})

test('rejects a mismatched checkpoint row before it can redirect later destructive stages', async () => {
  console.error = () => {}
  const harness = createHarness({
    checkpointRowMutator: row => ({ ...row, user_id: OTHER_USER_ID }),
  })
  globalThis.fetch = harness.fetch
  const { default: handler } = await loadApi()

  const response = await handler(deleteRequest())
  assert.equal(response.status, 202)
  assert.deepEqual(await response.json(), { success: true, status: 'pending' })
  assert.equal(harness.calls.some(call =>
    call.url.pathname === `/auth/v1/admin/users/${OTHER_USER_ID}`), false)
  assert.equal(harness.calls.some(call =>
    call.url.pathname === `/auth/v1/admin/users/${USER_ID}`), false)
  assert.equal(harness.calls.some(call =>
    call.url.pathname === '/rest/v1/rpc/delete_wechat_password_credential'), false)
})

test('rejects a checkpoint 2xx that skips the exact requested next stage', async () => {
  console.error = () => {}
  const harness = createHarness({
    checkpointRowMutator: row => ({ ...row, stage: 'auth_deleted' }),
  })
  globalThis.fetch = harness.fetch
  const { default: handler } = await loadApi()

  const response = await handler(deleteRequest())
  assert.equal(response.status, 202)
  assert.equal(harness.calls.some(call =>
    call.url.pathname.startsWith('/auth/v1/admin/users/')), false)
  assert.equal(harness.calls.some(call =>
    call.url.pathname === '/rest/v1/rpc/delete_wechat_password_credential'), false)
})

test('existing pre-migration jobs are re-prepared before cron can touch Storage', async () => {
  console.error = () => {}
  const harness = createHarness({
    initialJob: jobRow('requested'),
    adminPreparationReady: false,
  })
  globalThis.fetch = harness.fetch
  const { default: handler } = await loadApi()

  const response = await handler(cronRequest())
  assert.equal(response.status, 503)
  assert.equal(harness.job.stage, 'requested')
  assert.equal(harness.job.last_error, 'admin_recovery_transfer_required')
  assert.deepEqual(harness.objects, ['photo.jpg', 'clip.mp4'])
  const preparation = callIndex(harness.calls, call =>
    call.url.pathname === '/rest/v1/rpc/admin_prepare_account_deletion')
  const storage = callIndex(harness.calls, call => call.url.pathname.startsWith('/storage/'))
  assert.ok(preparation >= 0)
  assert.equal(storage, -1)
})

test('refuses to accept a deletion job when its recovery worker secret is absent', async () => {
  const harness = createHarness()
  globalThis.fetch = harness.fetch
  const { default: handler } = await loadApi({ cronSecret: '' })

  const response = await handler(deleteRequest())
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'not_configured' })
  assert.equal(harness.calls.length, 0)
})

test('rejects a body uid that differs from the authenticated caller before job creation', async () => {
  const harness = createHarness()
  globalThis.fetch = harness.fetch
  const { default: handler } = await loadApi()

  const response = await handler(deleteRequest({ user_id: OTHER_USER_ID }))
  assert.equal(response.status, 403)
  assert.deepEqual(await response.json(), { error: 'forbidden' })
  assert.deepEqual(harness.calls.map(call => call.url.pathname), ['/auth/v1/user'])
})

test('replays an idempotent step after a crash between Storage deletion and its checkpoint', async () => {
  console.error = () => {}
  const harness = createHarness({ checkpointFailures: { storage_deleted: 1 } })
  globalThis.fetch = harness.fetch
  const { default: handler } = await loadApi()

  const first = await handler(deleteRequest())
  assert.equal(first.status, 202)
  assert.deepEqual(await first.json(), { success: true, status: 'pending' })
  assert.equal(harness.job.stage, 'requested')
  assert.deepEqual(harness.objects, [])
  assert.equal(harness.calls.some(call => call.url.pathname.startsWith('/auth/v1/admin/users/')), false)

  const second = await handler(deleteRequest())
  assert.equal(second.status, 200)
  assert.equal(harness.job.stage, 'completed')
  assert.equal(harness.calls.some(call =>
    call.url.pathname === '/rest/v1/account_deletion_jobs' && call.method === 'POST'), false)
  assert.equal(harness.calls.filter(call =>
    call.url.pathname === '/rest/v1/rpc/admin_prepare_account_deletion').length, 2)
  assert.equal(harness.calls.filter(call =>
    call.url.pathname === '/storage/v1/object/list-v2/item-images').length >= 3, true)
})

test('resumes at storage_deleted, revalidates Storage, and treats Auth 404 as success', async () => {
  const harness = createHarness({
    initialJob: jobRow('storage_deleted'),
    authDeleteStatuses: [404],
  })
  globalThis.fetch = harness.fetch
  const { default: handler } = await loadApi()

  const response = await handler(deleteRequest())
  assert.equal(response.status, 200)
  assert.equal(harness.job.stage, 'completed')
  const storageDelete = callIndex(harness.calls, call =>
    call.url.pathname === '/storage/v1/object/item-images' && call.method === 'DELETE')
  const authDelete = callIndex(harness.calls, call =>
    call.url.pathname === `/auth/v1/admin/users/${USER_ID}` && call.method === 'DELETE')
  assert.ok(storageDelete >= 0 && storageDelete < authDelete)
  assert.equal(harness.calls.filter(call =>
    call.url.pathname === `/auth/v1/admin/users/${USER_ID}`).length, 1)
})

test('returns 202 pending after Auth failure and preserves the resumable checkpoint', async () => {
  console.error = () => {}
  const harness = createHarness({ authDeleteStatuses: [500] })
  globalThis.fetch = harness.fetch
  const { default: handler } = await loadApi()

  const response = await handler(deleteRequest())
  assert.equal(response.status, 202)
  assert.deepEqual(await response.json(), { success: true, status: 'pending' })
  assert.equal(response.headers.get('retry-after'), '600')
  assert.equal(harness.job.stage, 'storage_deleted')
  assert.match(harness.job.last_error, /^auth_delete_failed:500/)
  assert.equal(harness.calls.some(call =>
    call.url.pathname === '/rest/v1/rpc/delete_wechat_password_credential' && call.method === 'POST'), false)
})

test('cron removes objects uploaded by another live session after an Auth failure', async () => {
  console.error = () => {}
  const harness = createHarness({ authDeleteStatuses: [500, 204] })
  globalThis.fetch = harness.fetch
  const { default: handler } = await loadApi()

  const post = await handler(deleteRequest())
  assert.equal(post.status, 202)
  assert.equal(harness.job.stage, 'storage_deleted')

  harness.addStorageObject('late-other-device.jpg')
  const callBoundary = harness.calls.length
  const cron = await handler(cronRequest())
  assert.equal(cron.status, 200)
  assert.equal(harness.job.stage, 'completed')

  const resumedCalls = harness.calls.slice(callBoundary)
  const lateStorageDelete = callIndex(resumedCalls, call =>
    call.url.pathname === '/storage/v1/object/item-images' && call.method === 'DELETE')
  const retriedAuthDelete = callIndex(resumedCalls, call =>
    call.url.pathname === `/auth/v1/admin/users/${USER_ID}` && call.method === 'DELETE')
  assert.ok(lateStorageDelete >= 0 && lateStorageDelete < retriedAuthDelete)
  assert.deepEqual(harness.objects, [])
})

test('cron fails visibly and stays retryable when a deletion job remains pending', async () => {
  console.error = () => {}
  const harness = createHarness({
    initialJob: jobRow('storage_deleted'),
    authDeleteStatuses: [500],
  })
  globalThis.fetch = harness.fetch
  const { default: handler } = await loadApi()

  const response = await handler(cronRequest())
  assert.equal(response.status, 503)
  assert.equal(response.headers.get('retry-after'), '600')
  assert.deepEqual(await response.json(), {
    success: false,
    error: 'deletion_jobs_pending',
    processed: 1,
    completed: 0,
    pending: 1,
  })
  assert.equal(harness.job.stage, 'storage_deleted')
  assert.match(harness.job.last_error, /^auth_delete_failed:500/)
})

test('post-Auth sweep closes the upload race and stays auth_deleted until Storage is empty', async () => {
  console.error = () => {}
  const harness = createHarness({
    storageDeleteStatuses: [204, 500, 204],
    storageObjectsAddedOnAuthDelete: ['raced-before-auth-commit.jpg'],
  })
  globalThis.fetch = harness.fetch
  const { default: handler } = await loadApi()

  const post = await handler(deleteRequest())
  assert.equal(post.status, 202)
  assert.deepEqual(await post.json(), { success: true, status: 'pending' })
  assert.equal(harness.job.stage, 'auth_deleted')
  assert.match(harness.job.last_error, /^storage_delete_failed:500/)
  assert.deepEqual(harness.objects, ['raced-before-auth-commit.jpg'])
  assert.equal(harness.calls.some(call =>
    call.url.pathname === '/rest/v1/rpc/delete_wechat_password_credential' && call.method === 'POST'), false)

  const authDelete = callIndex(harness.calls, call =>
    call.url.pathname === `/auth/v1/admin/users/${USER_ID}` && call.method === 'DELETE')
  const authCheckpoint = callIndex(harness.calls, call => call.body?.stage === 'auth_deleted')
  const failedPostAuthDelete = harness.calls.findIndex((call, index) =>
    index > authCheckpoint
      && call.url.pathname === '/storage/v1/object/item-images'
      && call.method === 'DELETE')
  assert.ok(authDelete < authCheckpoint && authCheckpoint < failedPostAuthDelete)

  const callBoundary = harness.calls.length
  const cron = await handler(cronRequest())
  assert.equal(cron.status, 200)
  assert.deepEqual(await cron.json(), {
    success: true,
    processed: 1,
    completed: 1,
    pending: 0,
  })
  assert.equal(harness.job.stage, 'completed')
  assert.deepEqual(harness.objects, [])

  const resumedCalls = harness.calls.slice(callBoundary)
  const storageDelete = callIndex(resumedCalls, call =>
    call.url.pathname === '/storage/v1/object/item-images' && call.method === 'DELETE')
  const wechatDelete = callIndex(resumedCalls, call =>
    call.url.pathname === '/rest/v1/rpc/delete_wechat_password_credential' && call.method === 'POST')
  assert.ok(storageDelete >= 0 && storageDelete < wechatDelete)
  assert.equal(harness.calls.filter(call =>
    call.url.pathname === `/auth/v1/admin/users/${USER_ID}`).length, 1)
})

test('cron finishes a mapping cleanup that failed after Auth deletion', async () => {
  console.error = () => {}
  const harness = createHarness({ wechatDeleteStatuses: [500, 204] })
  globalThis.fetch = harness.fetch
  const { default: handler } = await loadApi()

  const post = await handler(deleteRequest())
  assert.equal(post.status, 202)
  assert.equal(harness.job.stage, 'auth_deleted')

  const cron = await handler(cronRequest())
  assert.equal(cron.status, 200)
  assert.deepEqual(await cron.json(), {
    success: true,
    processed: 1,
    completed: 1,
    pending: 0,
  })
  assert.equal(harness.job.stage, 'completed')
  assert.equal(harness.calls.filter(call =>
    call.url.pathname === `/auth/v1/admin/users/${USER_ID}`).length, 1)
  assert.equal(harness.calls.filter(call =>
    call.url.pathname === '/rest/v1/rpc/delete_wechat_password_credential' && call.method === 'POST').length, 2)
})

test('cron requires the timing-safe bearer secret before reading pending jobs', async () => {
  const harness = createHarness({ initialJob: jobRow('completed') })
  globalThis.fetch = harness.fetch
  const { default: handler } = await loadApi()

  const missing = await handler(cronRequest(''))
  const wrong = await handler(cronRequest('wrong-secret'))
  assert.equal(missing.status, 401)
  assert.equal(wrong.status, 401)
  assert.equal(harness.calls.length, 0)

  const allowed = await handler(cronRequest())
  assert.equal(allowed.status, 200)
  assert.deepEqual(await allowed.json(), {
    success: true,
    processed: 0,
    completed: 0,
    pending: 0,
  })
  assert.equal(harness.calls.length, 1)
  assert.equal(harness.calls[0].url.pathname, '/rest/v1/account_deletion_jobs')
})

test('lists and deletes more than 1000 owned objects in bounded chunks', async () => {
  const harness = createHarness({
    storageObjects: Array.from({ length: 1001 }, (_, i) => `photo-${i}.jpg`),
  })
  globalThis.fetch = harness.fetch
  const { default: handler } = await loadApi()

  const response = await handler(deleteRequest())
  assert.equal(response.status, 200)
  const deletes = harness.calls.filter(call =>
    call.url.pathname === '/storage/v1/object/item-images' && call.method === 'DELETE')
  assert.deepEqual(deletes.map(call => call.body.prefixes.length), [1000, 1])
  const pagedLists = harness.calls.filter(call =>
    call.url.pathname === '/storage/v1/object/list-v2/item-images'
      && call.body?.limit === 1000)
  assert.equal(pagedLists.length >= 2, true)
  assert.equal(pagedLists[0].body.cursor, undefined)
  assert.equal(typeof pagedLists[1].body.cursor, 'string')
  assert.equal(pagedLists[1].body.cursor.length > 0, true)
  assert.ok(pagedLists.every(call => call.body.prefix === `items/${USER_ID}/`))
  assert.ok(pagedLists.every(call => call.body.with_delimiter === false))
  assert.deepEqual(harness.objects, [])
})

test('deletes nested objects by their exact full owner-scoped keys, never folder names', async () => {
  const harness = createHarness({
    storageObjects: [
      'root.jpg',
      'nested/photo.jpg',
      'nested/deeper/clip.mp4',
    ],
  })
  globalThis.fetch = harness.fetch
  const { default: handler } = await loadApi()

  const response = await handler(deleteRequest())

  assert.equal(response.status, 200)
  const firstDelete = harness.calls.find(call =>
    call.url.pathname === '/storage/v1/object/item-images' && call.method === 'DELETE')
  assert.deepEqual(new Set(firstDelete.body.prefixes), new Set([
    `items/${USER_ID}/root.jpg`,
    `items/${USER_ID}/nested/photo.jpg`,
    `items/${USER_ID}/nested/deeper/clip.mp4`,
  ]))
  assert.equal(firstDelete.body.prefixes.includes(`items/${USER_ID}/nested`), false)
  assert.deepEqual(harness.objects, [])
})

test('flattens large numbers of nested directories without accumulating a directory queue', async () => {
  const harness = createHarness({
    storageObjects: Array.from(
      { length: 1501 },
      (_, i) => `directory-${String(i).padStart(4, '0')}/deep/file.jpg`,
    ),
  })
  globalThis.fetch = harness.fetch
  const { default: handler } = await loadApi()

  const response = await handler(deleteRequest())

  assert.equal(response.status, 200)
  const deletes = harness.calls.filter(call =>
    call.url.pathname === '/storage/v1/object/item-images' && call.method === 'DELETE')
  assert.deepEqual(deletes.map(call => call.body.prefixes.length), [1000, 501])
  assert.ok(deletes.flatMap(call => call.body.prefixes).every(path =>
    path.startsWith(`items/${USER_ID}/directory-`) && path.endsWith('/deep/file.jpg')))
  assert.deepEqual(harness.objects, [])
})

test('completes an empty owner prefix without issuing a folder or object delete', async () => {
  const harness = createHarness({ storageObjects: [] })
  globalThis.fetch = harness.fetch
  const { default: handler } = await loadApi()

  const response = await handler(deleteRequest())

  assert.equal(response.status, 200)
  assert.equal(harness.job.stage, 'completed')
  assert.equal(harness.calls.some(call =>
    call.url.pathname === '/storage/v1/object/item-images' && call.method === 'DELETE'), false)
})

test('fails closed on an unexpected folder row instead of deleting it as an object', async () => {
  console.error = () => {}
  const harness = createHarness({
    storageObjects: [],
    storageListMutator: result => ({
      ...result,
      folders: [{ name: `items/${USER_ID}/empty-folder/` }],
    }),
  })
  globalThis.fetch = harness.fetch
  const { default: handler } = await loadApi()

  const response = await handler(deleteRequest())

  assert.equal(response.status, 202)
  assert.equal(harness.job.stage, 'requested')
  assert.equal(harness.job.last_error, 'storage_list_invalid')
  assert.equal(harness.calls.some(call =>
    call.url.pathname === '/storage/v1/object/item-images' && call.method === 'DELETE'), false)
  assert.equal(harness.calls.some(call =>
    call.url.pathname.startsWith('/auth/v1/admin/users/')), false)
})

test('rejects a malicious List V2 row outside the authenticated owner prefix', async () => {
  console.error = () => {}
  const harness = createHarness({
    storageListMutator: result => ({
      ...result,
      hasNext: false,
      folders: [],
      objects: [{ id: 'malicious-row', name: `items/${OTHER_USER_ID}/victim.jpg` }],
    }),
  })
  globalThis.fetch = harness.fetch
  const { default: handler } = await loadApi()

  const response = await handler(deleteRequest())

  assert.equal(response.status, 202)
  assert.equal(harness.job.stage, 'requested')
  assert.equal(harness.job.last_error, 'storage_object_invalid')
  assert.equal(harness.calls.some(call =>
    call.url.pathname === '/storage/v1/object/item-images' && call.method === 'DELETE'), false)
})

test('keeps the job pending when Storage reports success but verification still sees the object', async () => {
  console.error = () => {}
  const harness = createHarness({ storageDeleteApplies: false })
  globalThis.fetch = harness.fetch
  const { default: handler } = await loadApi()

  const response = await handler(deleteRequest())

  assert.equal(response.status, 202)
  assert.equal(harness.job.stage, 'requested')
  assert.equal(harness.job.last_error, 'storage_delete_incomplete')
  assert.deepEqual(harness.objects, ['photo.jpg', 'clip.mp4'])
  assert.equal(harness.calls.some(call =>
    call.url.pathname.startsWith('/auth/v1/admin/users/')), false)
})

test('bounds each sweep and makes forward progress across retries for more than four pages', async () => {
  console.error = () => {}
  const harness = createHarness({
    storageObjects: Array.from({ length: 4001 }, (_, i) =>
      `directory-${String(i).padStart(4, '0')}/file.jpg`),
  })
  globalThis.fetch = harness.fetch
  const { default: handler } = await loadApi()

  const first = await handler(deleteRequest())
  assert.equal(first.status, 202)
  assert.equal(harness.job.stage, 'requested')
  assert.equal(harness.job.last_error, 'storage_sweep_page_budget_exhausted')
  assert.equal(harness.objects.length, 1)
  assert.deepEqual(
    harness.calls
      .filter(call => call.url.pathname === '/storage/v1/object/item-images')
      .map(call => call.body.prefixes.length),
    [1000, 1000, 1000, 1000],
  )

  const second = await handler(deleteRequest())
  assert.equal(second.status, 200)
  assert.equal(harness.job.stage, 'completed')
  assert.deepEqual(harness.objects, [])
})

test('detects a repeated pagination cursor before an unbounded listing loop', async () => {
  console.error = () => {}
  const harness = createHarness({ storageObjects: ['loop.jpg'] })
  globalThis.fetch = async (input, init = {}) => {
    const url = requestUrl(input)
    if (url.pathname === '/storage/v1/object/list-v2/item-images') {
      return json({
        hasNext: true,
        nextCursor: 'same-cursor',
        folders: [],
        objects: [{ id: 'loop-row', name: `items/${USER_ID}/loop.jpg` }],
      })
    }
    return harness.fetch(input, init)
  }
  const { default: handler } = await loadApi()

  const response = await handler(deleteRequest())

  assert.equal(response.status, 202)
  assert.equal(harness.job.stage, 'requested')
  assert.equal(harness.job.last_error, 'storage_cursor_invalid')
  assert.equal(harness.calls.filter(call =>
    call.url.pathname === '/storage/v1/object/item-images').length, 2)
})

test('replays safely when a Storage delete committed but its response was unknown', async () => {
  console.error = () => {}
  const harness = createHarness({ storageObjects: ['nested/committed.jpg'] })
  let loseFirstDeleteResponse = true
  globalThis.fetch = async (input, init = {}) => {
    const url = requestUrl(input)
    const method = requestMethod(input, init)
    if (
      loseFirstDeleteResponse
      && url.pathname === '/storage/v1/object/item-images'
      && method === 'DELETE'
    ) {
      loseFirstDeleteResponse = false
      await harness.fetch(input, init)
      throw new TypeError('simulated lost response after commit')
    }
    return harness.fetch(input, init)
  }
  const { default: handler } = await loadApi()

  const first = await handler(deleteRequest())
  assert.equal(first.status, 202)
  assert.equal(harness.job.stage, 'requested')
  assert.equal(harness.job.last_error, 'upstream_network_error')
  assert.deepEqual(harness.objects, [])

  const second = await handler(deleteRequest())
  assert.equal(second.status, 200)
  assert.equal(harness.job.stage, 'completed')
  assert.equal(harness.calls.filter(call =>
    call.url.pathname === '/storage/v1/object/item-images').length, 1)
})

test('a first-stage Storage delete failure never advances to Auth deletion', async () => {
  console.error = () => {}
  const harness = createHarness({ storageDeleteStatuses: [500] })
  globalThis.fetch = harness.fetch
  const { default: handler } = await loadApi()

  const response = await handler(deleteRequest())

  assert.equal(response.status, 202)
  assert.equal(harness.job.stage, 'requested')
  assert.match(harness.job.last_error, /^storage_delete_failed:500/)
  assert.equal(harness.calls.some(call =>
    call.url.pathname.startsWith('/auth/v1/admin/users/')), false)
})

test('rejects an oversized deletion request before durable-job creation', async () => {
  const harness = createHarness()
  globalThis.fetch = harness.fetch
  const { default: handler } = await loadApi()

  const response = await handler(new Request('https://app.test/api/auth/delete-account', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer caller-token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ padding: 'x'.repeat(3_000) }),
  }))

  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: 'invalid_request' })
  assert.deepEqual(harness.calls.map(call => call.url.pathname), ['/auth/v1/user'])
})

test('a hanging Storage call is aborted and leaves the durable saga retryable', async () => {
  console.error = () => {}
  const harness = createHarness()
  const redirects = []
  let storageAborted = false
  globalThis.fetch = async (input, init = {}) => {
    const url = requestUrl(input)
    redirects.push(init.redirect)
    if (url.pathname === '/storage/v1/object/list-v2/item-images') {
      return new Promise((_, reject) => {
        init.signal?.addEventListener('abort', () => {
          storageAborted = true
          reject(new DOMException('private upstream detail', 'AbortError'))
        }, { once: true })
      })
    }
    return harness.fetch(input, init)
  }
  const { default: handler } = await loadApi({
    transform: source => source.replace(
      'const UPSTREAM_TIMEOUT_MS = 5_000',
      'const UPSTREAM_TIMEOUT_MS = 10',
    ),
  })

  const response = await handler(deleteRequest())

  assert.equal(response.status, 202)
  assert.deepEqual(await response.json(), { success: true, status: 'pending' })
  assert.equal(response.headers.get('retry-after'), '600')
  assert.equal(storageAborted, true)
  assert.equal(harness.job.stage, 'requested')
  assert.equal(harness.job.last_error, 'upstream_timeout')
  assert.equal(harness.job.last_error.includes('private'), false)
  assert.ok(redirects.length > 0)
  assert.ok(redirects.every(value => value === 'manual'))
})
