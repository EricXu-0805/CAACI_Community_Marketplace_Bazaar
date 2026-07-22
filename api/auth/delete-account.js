import { deploymentBoundaryResponse, evaluateDeploymentBoundary } from '../_deployment-boundary.js'

export const config = { runtime: 'edge' }

/*
 * /api/auth/delete-account — durable hard-account-deletion saga.
 *
 * A hard delete spans three independent systems (Storage, Auth, and the
 * out-of-FK WeChat password map), so a single request cannot be treated as a
 * transaction. Before the first destructive call we persist a service-role-
 * only account_deletion_jobs row containing the caller-derived uid and the
 * WeChat cleanup key. Each idempotent step advances a monotonic checkpoint:
 *
 *   requested -> storage_deleted -> auth_deleted -> completed
 *
 * A POST authenticates the caller and can create/resume only that caller's
 * job. Once the job exists, any transient failure returns 202 pending: the
 * client signs out, while the cron-authenticated GET keeps retrying. The job
 * row remains after completion as a Storage-write tombstone for access JWTs
 * that GoTrue cannot revoke before their expiry. If the migration/job write
 * is unavailable, POST returns 503 before Storage/Auth/WeChat is touched.
 * Auth 404 is a successful replay because the desired state (user absent) has
 * already been reached.
 */

function env(name, fallback = '') {
  return process.env[name] || fallback
}

const SUPABASE_URL = env('SUPABASE_URL', env('VITE_SUPABASE_URL'))
const SERVICE_KEY = env('SUPABASE_SECRET_KEY', env('SUPABASE_SERVICE_ROLE_KEY'))
const ANON_KEY = env(
  'SUPABASE_PUBLISHABLE_KEY',
  env('SUPABASE_ANON_KEY', env('VITE_SUPABASE_PUBLISHABLE_KEY', env('VITE_SUPABASE_ANON_KEY'))),
)
const CRON_SECRET = env('CRON_SECRET')
const IMAGE_BUCKET = 'item-images'
const STORAGE_PAGE_SIZE = 1000
const MAX_STORAGE_PAGES_PER_SWEEP = 4
const MAX_STORAGE_CURSOR_CHARS = 4 * 1024
const MAX_STORAGE_OBJECT_NAME_BYTES = 1024
const CRON_BATCH_SIZE = 20
const MAX_REQUEST_BYTES = 2 * 1024
const MAX_UPSTREAM_RESPONSE_BYTES = 2 * 1024 * 1024
const BODY_TIMEOUT_MS = 5_000
const UPSTREAM_TIMEOUT_MS = 5_000
const JOB_SELECT = [
  'user_id', 'stage', 'wechat_openid', 'last_error',
  'requested_at', 'updated_at', 'completed_at',
].join(',')
const JOB_FIELDS = Object.freeze(JOB_SELECT.split(','))
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STAGE_RANK = Object.freeze({
  requested: 0,
  storage_deleted: 1,
  auth_deleted: 2,
  completed: 3,
})

function supabaseHeaders(key, authorization = '', extra = {}) {
  const headers = { apikey: key, ...extra }
  if (authorization) headers.Authorization = authorization
  else if (!/^sb_(?:publishable|secret)_/.test(key)) headers.Authorization = `Bearer ${key}`
  return headers
}

async function readBoundedText(stream, declaredLength, maxBytes) {
  if (declaredLength != null) {
    if (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxBytes) {
      throw new Error('response_body_invalid')
    }
  }
  if (!stream) throw new Error('response_body_invalid')
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let raw = ''
  let timer
  const consume = (async () => {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        void reader.cancel().catch(() => {})
        throw new Error('response_body_invalid')
      }
      raw += decoder.decode(value, { stream: true })
    }
    return raw + decoder.decode()
  })()
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      void reader.cancel().catch(() => {})
      reject(new Error('response_body_timeout'))
    }, BODY_TIMEOUT_MS)
  })
  try {
    return await Promise.race([consume, timeout])
  } finally {
    clearTimeout(timer)
  }
}

async function readJsonResponse(response) {
  const raw = await readBoundedText(
    response.body,
    response.headers.get('content-length'),
    MAX_UPSTREAM_RESPONSE_BYTES,
  )
  try { return JSON.parse(raw) } catch { throw new Error('response_json_invalid') }
}

async function readJsonRequest(request) {
  const raw = await readBoundedText(
    request.body,
    request.headers.get('content-length'),
    MAX_REQUEST_BYTES,
  )
  try { return JSON.parse(raw) } catch { throw new Error('request_json_invalid') }
}

async function fetchWithTimeout(input, init = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
      redirect: 'manual',
    })
  } catch {
    throw new Error(controller.signal.aborted ? 'upstream_timeout' : 'upstream_network_error')
  } finally {
    clearTimeout(timer)
  }
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...headers,
    },
  })
}

function serviceHeaders(extra = {}) {
  return supabaseHeaders(SERVICE_KEY, '', extra)
}

function bearerToken(req) {
  const value = req.headers.get('authorization') || ''
  const match = value.match(/^Bearer\s+(.+)$/i)
  return match?.[1] || ''
}

// Web Crypto keeps this Edge-runtime compatible. Hashing both values first
// makes the comparison loop fixed-width even when the supplied length differs.
async function timingSafeSecretEqual(provided, expected) {
  const encoder = new TextEncoder()
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(String(provided || ''))),
    crypto.subtle.digest('SHA-256', encoder.encode(String(expected || ''))),
  ])
  const left = new Uint8Array(providedHash)
  const right = new Uint8Array(expectedHash)
  let mismatch = left.length ^ right.length
  for (let i = 0; i < left.length; i += 1) mismatch |= left[i] ^ right[i]
  return mismatch === 0 && typeof provided === 'string' && provided.length > 0
}

async function responseError(prefix, response) {
  const text = await readBoundedText(
    response.body,
    response.headers.get('content-length'),
    MAX_UPSTREAM_RESPONSE_BYTES,
  ).catch(() => '')
  let code = ''
  try { code = JSON.parse(text)?.code || '' } catch { /* opaque remote body */ }
  const error = new Error(`${prefix}:${response.status}${code ? `:${code}` : ''}`)
  error.status = response.status
  error.remoteCode = code
  return error
}

function safeErrorCode(error) {
  const value = String(error?.message || 'unknown_failure')
  return value.replace(/[^a-z0-9_:-]/gi, '_').slice(0, 160)
}

function isKnownStage(stage) {
  return Object.prototype.hasOwnProperty.call(STAGE_RANK, stage)
}

function normalizeJob(row, { expectedUserId = '', expectedStage = '', minimumStage = '' } = {}) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error('job_row_invalid')
  }
  const keys = Object.keys(row).sort()
  const expectedKeys = [...JOB_FIELDS].sort()
  if (
    keys.length !== expectedKeys.length
    || keys.some((key, index) => key !== expectedKeys[index])
    || typeof row.user_id !== 'string'
    || !UUID_PATTERN.test(row.user_id)
    || !isKnownStage(row.stage)
    || (row.wechat_openid !== null && (
      typeof row.wechat_openid !== 'string'
      || row.wechat_openid.length < 4
      || row.wechat_openid.length > 128
    ))
    || (row.last_error !== null && (
      typeof row.last_error !== 'string'
      || row.last_error.length > 160
    ))
    || !isBoundedTimestamp(row.requested_at)
    || !isBoundedTimestamp(row.updated_at)
    || (row.completed_at !== null && !isBoundedTimestamp(row.completed_at))
    || (row.stage === 'completed') !== (row.completed_at !== null)
    || (row.stage === 'completed' && row.wechat_openid !== null)
  ) {
    throw new Error('job_row_invalid')
  }
  const normalizedUserId = row.user_id.toLowerCase()
  if (expectedUserId && normalizedUserId !== expectedUserId.toLowerCase()) {
    throw new Error('job_user_mismatch')
  }
  if (expectedStage && row.stage !== expectedStage) throw new Error('job_stage_mismatch')
  if (minimumStage && STAGE_RANK[row.stage] < STAGE_RANK[minimumStage]) {
    throw new Error('job_stage_mismatch')
  }
  return { ...row, user_id: normalizedUserId }
}

function isBoundedTimestamp(value) {
  return typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value))
}

async function identifyCaller(jwt) {
  const response = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/user`, {
    headers: supabaseHeaders(ANON_KEY, `Bearer ${jwt}`),
  })
  if (response.status === 401 || response.status === 403) return null
  if (!response.ok) throw await responseError('caller_lookup_failed', response)
  const user = await readJsonResponse(response).catch(() => null)
  return typeof user?.id === 'string' ? user.id : null
}

async function jobRequest(path, init = {}) {
  const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/account_deletion_jobs${path}`, {
    ...init,
    headers: serviceHeaders({
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    }),
  })
  if (!response.ok) throw await responseError('job_store_unavailable', response)
  if (response.status === 204) return []
  const rows = await readJsonResponse(response).catch(() => null)
  if (!Array.isArray(rows)) throw new Error('job_store_invalid_response')
  return rows
}

async function loadJob(uid) {
  const rows = await jobRequest(
    `?user_id=eq.${encodeURIComponent(uid)}&select=${JOB_SELECT}&limit=1`,
  )
  if (rows.length > 1) throw new Error('job_store_invalid_response')
  return rows[0] ? normalizeJob(rows[0], { expectedUserId: uid }) : null
}

async function prepareAccountDeletion(uid) {
  // One service-only transaction checks administrator recovery continuity,
  // revokes this profile's remaining admin credentials with system audit, and
  // creates/reuses the durable deletion tombstone. It must commit before the
  // first external Storage/Auth side effect, eliminating the readiness TOCTOU.
  const response = await fetchWithTimeout(
    `${SUPABASE_URL}/rest/v1/rpc/admin_prepare_account_deletion`,
    {
      method: 'POST',
      headers: serviceHeaders({
        Accept: 'application/json',
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({ p_user_id: uid }),
    },
  )
  if (!response.ok) throw await responseError('admin_deletion_prepare_failed', response)
  const result = await readJsonResponse(response).catch(() => null)
  if (
    !result
    || typeof result !== 'object'
    || Array.isArray(result)
    || Object.keys(result).sort().join(',') !== 'job,ready,reason'
  ) {
    throw new Error('admin_deletion_prepare_invalid')
  }
  if (result.ready === false) {
    if (result.reason !== 'admin_recovery_transfer_required' || result.job !== null) {
      throw new Error('admin_deletion_prepare_invalid')
    }
    return { ready: false, reason: result.reason, job: null }
  }
  if (result.ready !== true || result.reason !== null) {
    throw new Error('admin_deletion_prepare_invalid')
  }
  return {
    ready: true,
    reason: null,
    job: normalizeJob(result.job, { expectedUserId: uid }),
  }
}

async function advanceStage(job, nextStage) {
  const expectedStage = job.stage
  if (STAGE_RANK[nextStage] <= STAGE_RANK[expectedStage]) return job

  const now = new Date().toISOString()
  const patch = {
    stage: nextStage,
    last_error: null,
    updated_at: now,
    ...(nextStage === 'completed'
      ? { completed_at: now, wechat_openid: null }
      : {}),
  }
  const rows = await jobRequest(
    `?user_id=eq.${encodeURIComponent(job.user_id)}&stage=eq.${encodeURIComponent(expectedStage)}&select=${JOB_SELECT}`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    },
  )
  if (rows.length > 1) throw new Error('job_store_invalid_response')
  if (rows[0]) {
    return normalizeJob(rows[0], {
      expectedUserId: job.user_id,
      expectedStage: nextStage,
    })
  }

  // Another worker may have checkpointed the same idempotent step first.
  // Accept only monotonic progress; never write an older stage over it.
  const latest = await loadJob(job.user_id)
  if (latest) {
    return normalizeJob(latest, {
      expectedUserId: job.user_id,
      minimumStage: nextStage,
    })
  }
  throw new Error('job_checkpoint_conflict')
}

async function recordFailure(job, error) {
  try {
    await jobRequest(
      `?user_id=eq.${encodeURIComponent(job.user_id)}&stage=eq.${encodeURIComponent(job.stage)}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          last_error: safeErrorCode(error),
          updated_at: new Date().toISOString(),
        }),
      },
    )
  } catch (checkpointError) {
    console.error('[delete-account] failed to record pending job', safeErrorCode(checkpointError))
  }
}

function ownedStoragePrefix(uid) {
  return `items/${uid}/`
}

function validateOwnedStorageName(uid, name) {
  const ownerPrefix = ownedStoragePrefix(uid)
  if (typeof name !== 'string' || !name.startsWith(ownerPrefix) || name === ownerPrefix) {
    throw new Error('storage_object_invalid')
  }
  if (new TextEncoder().encode(name).byteLength > MAX_STORAGE_OBJECT_NAME_BYTES) {
    throw new Error('storage_object_invalid')
  }

  // Storage object names are opaque keys, but reject path-like ambiguity at
  // this destructive boundary as defense in depth. The app's uploader emits
  // only non-empty, slash-separated segments under items/<caller uid>/.
  const suffix = name.slice(ownerPrefix.length)
  const segments = suffix.split('/')
  if (
    name.includes('\\')
    || /[\u0000-\u001f\u007f]/.test(name)
    || segments.some(segment => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error('storage_object_invalid')
  }
  return name
}

async function listOwnedStorage(uid, limit, cursor = '') {
  const response = await fetchWithTimeout(`${SUPABASE_URL}/storage/v1/object/list-v2/${IMAGE_BUCKET}`, {
    method: 'POST',
    headers: serviceHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      prefix: ownedStoragePrefix(uid),
      limit,
      ...(cursor ? { cursor } : {}),
      with_delimiter: false,
      sortBy: { column: 'name', order: 'asc' },
    }),
  })
  if (!response.ok) throw await responseError('storage_list_failed', response)
  const result = await readJsonResponse(response).catch(() => null)
  if (
    !result
    || typeof result !== 'object'
    || Array.isArray(result)
    || typeof result.hasNext !== 'boolean'
    || !Array.isArray(result.objects)
    || !Array.isArray(result.folders)
    || result.objects.length > limit
    // Flat List V2 separates actual files from derived folders. A folder row
    // despite with_delimiter=false violates that contract, so fail closed
    // instead of ever converting it into a DELETE target.
    || result.folders.length > 0
  ) {
    throw new Error('storage_list_invalid')
  }

  const paths = []
  const uniquePaths = new Set()
  for (const row of result.objects) {
    if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id) {
      throw new Error('storage_object_invalid')
    }
    const path = validateOwnedStorageName(uid, row.name)
    if (uniquePaths.has(path)) throw new Error('storage_list_invalid')
    uniquePaths.add(path)
    paths.push(path)
  }

  let nextCursor = ''
  if (result.hasNext) {
    if (
      paths.length === 0
      || typeof result.nextCursor !== 'string'
      || !result.nextCursor
      || result.nextCursor.length > MAX_STORAGE_CURSOR_CHARS
    ) {
      throw new Error('storage_cursor_invalid')
    }
    nextCursor = result.nextCursor
  }
  return { paths, hasNext: result.hasNext, nextCursor }
}

async function deleteOwnedStorage(uid, paths) {
  if (paths.length === 0) return
  if (paths.length > STORAGE_PAGE_SIZE) throw new Error('storage_delete_batch_invalid')
  for (const path of paths) validateOwnedStorageName(uid, path)

  const response = await fetchWithTimeout(`${SUPABASE_URL}/storage/v1/object/${IMAGE_BUCKET}`, {
    method: 'DELETE',
    headers: serviceHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prefixes: paths }),
  })
  if (!response.ok) throw await responseError('storage_delete_failed', response)
}

async function sweepStorage(uid) {
  // List V2 with delimiter disabled returns every nested object as a flat,
  // full key. Delete each page immediately so memory stays O(page size). A
  // fixed page budget also prevents a single Edge invocation from traversing
  // an attacker-amplified namespace forever; the durable saga retries from
  // the now-smaller prefix on its next POST/cron run.
  let cursor = ''
  const seenCursors = new Set()
  for (let pageIndex = 0; pageIndex < MAX_STORAGE_PAGES_PER_SWEEP; pageIndex += 1) {
    const page = await listOwnedStorage(uid, STORAGE_PAGE_SIZE, cursor)
    await deleteOwnedStorage(uid, page.paths)
    if (!page.hasNext) break

    if (seenCursors.has(page.nextCursor)) throw new Error('storage_cursor_invalid')
    seenCursors.add(page.nextCursor)
    if (pageIndex + 1 >= MAX_STORAGE_PAGES_PER_SWEEP) {
      throw new Error('storage_sweep_page_budget_exhausted')
    }
    cursor = page.nextCursor
  }

  const remaining = await listOwnedStorage(uid, 1)
  if (remaining.paths.length > 0 || remaining.hasNext) {
    throw new Error('storage_delete_incomplete')
  }
}

async function deleteAuthUser(uid) {
  const response = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(uid)}`, {
    method: 'DELETE',
    headers: serviceHeaders(),
  })
  if (response.ok || response.status === 404) return
  throw await responseError('auth_delete_failed', response)
}

async function sweepWechatPassword(openid) {
  if (!openid) return
  const response = await fetchWithTimeout(
    `${SUPABASE_URL}/rest/v1/rpc/delete_wechat_password_credential`,
    {
      method: 'POST',
      headers: serviceHeaders({
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      }),
      body: JSON.stringify({ openid_in: openid }),
    },
  )
  if (!response.ok) throw await responseError('wechat_delete_failed', response)
}

async function resumeJob(initialJob, { prepared = false } = {}) {
  let job = normalizeJob(initialJob)
  let storageVerifiedThisRun = false
  try {
    if (!prepared && (job.stage === 'requested' || job.stage === 'storage_deleted')) {
      const preparation = await prepareAccountDeletion(job.user_id)
      if (!preparation.ready) {
        const error = new Error('admin_recovery_transfer_required')
        await recordFailure(job, error)
        return { completed: false, blocked: true, job }
      }
      job = preparation.job
    }

    if (job.stage === 'requested') {
      await sweepStorage(job.user_id)
      storageVerifiedThisRun = true
      job = await advanceStage(job, 'storage_deleted')
    }

    if (job.stage === 'storage_deleted') {
      // Another still-live device can upload after a prior Storage checkpoint
      // when an Auth attempt failed. Re-sweep on every resumed Auth attempt;
      // the just-completed requested step can reuse its same-run verification.
      if (!storageVerifiedThisRun) await sweepStorage(job.user_id)
      await deleteAuthUser(job.user_id)
      job = await advanceStage(job, 'auth_deleted')
    }

    if (job.stage === 'auth_deleted') {
      // GoTrue access JWTs remain valid until exp, so an upload can race the
      // pre-Auth sweep. The database tombstone now rejects any later write;
      // this second sweep closes the finite window before Auth deletion was
      // committed. Never advance to WeChat/completed until Storage is empty.
      await sweepStorage(job.user_id)
      await sweepWechatPassword(job.wechat_openid)
      job = await advanceStage(job, 'completed')
    }

    return { completed: job.stage === 'completed', blocked: false, job }
  } catch (error) {
    await recordFailure(job, error)
    console.error('[delete-account] deletion pending', job.stage, safeErrorCode(error))
    return { completed: false, blocked: false, job }
  }
}

async function handlePost(req) {
  // Accepting a durable/irreversible request is unsafe unless the recovery
  // worker is configured too: any later transient step can return 202 after
  // partial deletion and only the cron is able to finish it after sign-out.
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY || !CRON_SECRET) {
    return json({ error: 'not_configured' }, 503)
  }

  const jwt = bearerToken(req)
  if (!jwt) return json({ error: 'unauthorized' }, 401)

  let uid
  try {
    uid = await identifyCaller(jwt)
  } catch (error) {
    console.error('[delete-account] caller lookup unavailable', safeErrorCode(error))
    return json({ error: 'delete_unavailable' }, 503)
  }
  if (!uid) return json({ error: 'unauthorized' }, 401)

  let body
  try { body = await readJsonRequest(req) } catch { return json({ error: 'invalid_request' }, 400) }
  if (!body || Array.isArray(body) || typeof body !== 'object') {
    return json({ error: 'invalid_request' }, 400)
  }
  if (body.user_id != null && typeof body.user_id !== 'string') {
    return json({ error: 'invalid_request' }, 400)
  }
  if (body.user_id && body.user_id !== uid) return json({ error: 'forbidden' }, 403)

  let preparation
  try {
    preparation = await prepareAccountDeletion(uid)
  } catch (error) {
    // The atomic preparation either committed both tombstone + credential
    // retirement or changed nothing. No external destructive call occurred.
    console.error('[delete-account] atomic preparation unavailable', safeErrorCode(error))
    return json({ error: 'delete_unavailable' }, 503)
  }
  if (!preparation.ready) {
    return json({ error: 'admin_recovery_transfer_required' }, 409)
  }

  const result = await resumeJob(preparation.job, { prepared: true })
  if (result.completed) return json({ success: true, status: 'completed' })
  return json(
    { success: true, status: 'pending' },
    202,
    { 'Retry-After': '600' },
  )
}

async function loadPendingJobs() {
  const rows = await jobRequest(
    `?stage=in.(requested,storage_deleted,auth_deleted)&select=${JOB_SELECT}`
      + `&order=updated_at.asc&limit=${CRON_BATCH_SIZE}`,
  )
  const jobs = rows.map(row => normalizeJob(row))
  if (new Set(jobs.map(job => job.user_id)).size !== jobs.length) {
    throw new Error('job_store_invalid_response')
  }
  return jobs
}

async function handleCron(req) {
  if (!SUPABASE_URL || !SERVICE_KEY || !CRON_SECRET) {
    return json({ error: 'not_configured' }, 503)
  }
  if (!(await timingSafeSecretEqual(bearerToken(req), CRON_SECRET))) {
    return json({ error: 'unauthorized' }, 401)
  }

  let jobs
  try {
    jobs = await loadPendingJobs()
  } catch (error) {
    console.error('[delete-account] cron job store unavailable', safeErrorCode(error))
    return json({ error: 'delete_unavailable' }, 503)
  }

  let completed = 0
  let pending = 0
  for (const job of jobs) {
    const result = await resumeJob(job)
    if (result.completed) completed += 1
    else pending += 1
  }
  if (pending > 0) {
    // A 2xx here makes the scheduler/uptime monitor report a healthy run even
    // though at least one irreversible deletion saga still needs recovery.
    // Keep the response machine-readable and retryable while failing the run.
    console.error('[delete-account] cron left deletion jobs pending', { processed: jobs.length, completed, pending })
    return json(
      { success: false, error: 'deletion_jobs_pending', processed: jobs.length, completed, pending },
      503,
      { 'Retry-After': '600' },
    )
  }
  return json({ success: true, processed: jobs.length, completed, pending })
}

export default async function handler(req) {
  const deploymentError = deploymentBoundaryResponse(evaluateDeploymentBoundary({ supabaseUrl: SUPABASE_URL }))
  if (deploymentError) return deploymentError
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (req.method === 'POST') return handlePost(req)
  if (req.method === 'GET') return handleCron(req)
  return json({ error: 'method_not_allowed' }, 405)
}
