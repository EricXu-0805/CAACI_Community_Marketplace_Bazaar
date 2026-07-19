import { deploymentBoundaryResponse, evaluateDeploymentBoundary } from './_deployment-boundary.js'

export const config = { runtime: 'edge' }

/*
 * Hourly recovery worker for abandoned/detached managed banner uploads.
 * PostgreSQL leases deterministic object names; Storage batch deletion is
 * idempotent; PostgreSQL then records terminal deletion. A lost response at
 * either external boundary leaves a retryable lease, never a false success.
 */

function env(name, fallback = '') {
  return process.env[name] || fallback
}

const SUPABASE_URL = env('SUPABASE_URL', env('VITE_SUPABASE_URL'))
const SERVICE_KEY = env('SUPABASE_SECRET_KEY', env('SUPABASE_SERVICE_ROLE_KEY'))
const CRON_SECRET = env('CRON_SECRET')
const CALL_TIMEOUT_MS = 5_000
const RUN_TIMEOUT_MS = 25_000
const MAX_RESPONSE_BYTES = 64 * 1024
const MAX_GC_BATCHES = 3
const GC_BATCH_SIZE = 25
const RETRY_AFTER_SECONDS = 600
const OBJECT_PATTERN = /^managed\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f]{64}\.(?:png|jpg|webp|gif)$/

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

function retryable(body) {
  return json(body, 503, { 'Retry-After': String(RETRY_AFTER_SECONDS) })
}

function bearerToken(request) {
  const match = /^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization') || '')
  return match?.[1] || ''
}

async function timingSafeSecretEqual(provided, expected) {
  const encoder = new TextEncoder()
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(String(provided || ''))),
    crypto.subtle.digest('SHA-256', encoder.encode(String(expected || ''))),
  ])
  const left = new Uint8Array(providedHash)
  const right = new Uint8Array(expectedHash)
  let mismatch = left.length ^ right.length
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ right[index]
  return mismatch === 0 && typeof provided === 'string' && provided.length > 0
}

function serviceOrigin() {
  if (!SUPABASE_URL || !SERVICE_KEY || !CRON_SECRET) return null
  try {
    const url = new URL(SUPABASE_URL)
    const localHttp = url.protocol === 'http:'
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
    if (url.username || url.password || (url.protocol !== 'https:' && !localHttp)) return null
    url.pathname = '/'
    url.search = ''
    url.hash = ''
    return url
  } catch {
    return null
  }
}

function supabaseHeaders(key, authorization = '', extra = {}) {
  const headers = { apikey: key, ...extra }
  if (authorization) headers.Authorization = authorization
  else if (!/^sb_(?:publishable|secret)_/.test(key)) headers.Authorization = `Bearer ${key}`
  return headers
}

function serviceHeaders(extra = {}) {
  return supabaseHeaders(SERVICE_KEY, '', extra)
}

async function readLimited(response) {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) throw new Error('response_too_large')
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
}

async function serviceCall(url, init, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      ...init,
      redirect: 'error',
      signal: controller.signal,
    })
    if (response.redirected || (response.status >= 300 && response.status < 400)) {
      throw new Error('provider_redirect')
    }
    const rawLength = response.headers.get('content-length')
    if (rawLength && /^\d+$/.test(rawLength) && Number(rawLength) > MAX_RESPONSE_BYTES) {
      await response.body?.cancel().catch(() => {})
      throw new Error('response_too_large')
    }
    const text = await readLimited(response)
    if (!response.ok) throw new Error(`provider_status_${response.status}`)
    return text
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'AbortError') {
      throw new Error('provider_timeout')
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function parseJson(text) {
  try { return JSON.parse(text) } catch { throw new Error('provider_malformed') }
}

async function rpc(origin, name, args, timeoutMs) {
  const url = new URL(`/rest/v1/rpc/${name}`, origin)
  const text = await serviceCall(url, {
    method: 'POST',
    headers: serviceHeaders({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify(args),
  }, timeoutMs)
  return parseJson(text)
}

function normalizeClaim(payload) {
  const result = Array.isArray(payload) && payload.length === 1 ? payload[0] : payload
  if (!result || Array.isArray(result) || typeof result !== 'object'
      || !Array.isArray(result.object_names)
      || typeof result.has_more !== 'boolean'
      || result.object_names.length > GC_BATCH_SIZE) return null
  const names = result.object_names
  if (new Set(names).size !== names.length
      || names.some(name => typeof name !== 'string' || !OBJECT_PATTERN.test(name))) return null
  return { names, hasMore: result.has_more }
}

function normalizeCompleted(payload, expected) {
  const result = Array.isArray(payload) && payload.length === 1 ? payload[0] : payload
  return Number.isInteger(result) && result === expected
}

async function deleteStorageObjects(origin, names, timeoutMs) {
  if (!names.length) return
  const url = new URL('/storage/v1/object/banners', origin)
  await serviceCall(url, {
    method: 'DELETE',
    headers: serviceHeaders({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify({ prefixes: names }),
  }, timeoutMs)
}

export default async function handler(request) {
  const deploymentError = deploymentBoundaryResponse(evaluateDeploymentBoundary({ supabaseUrl: SUPABASE_URL }))
  if (deploymentError) return deploymentError
  if (request.method !== 'GET') {
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' })
  }
  const origin = serviceOrigin()
  if (!origin) return retryable({ error: 'not_configured' })
  if (!(await timingSafeSecretEqual(bearerToken(request), CRON_SECRET))) {
    return json({ error: 'unauthorized' }, 401)
  }

  const startedAt = Date.now()
  let deleted = 0
  let batches = 0
  let hasMore = true
  try {
    while (hasMore && batches < MAX_GC_BATCHES) {
      let remaining = RUN_TIMEOUT_MS - (Date.now() - startedAt)
      if (remaining <= 0) throw new Error('run_deadline_exceeded')
      const claimId = crypto.randomUUID()
      const claim = normalizeClaim(await rpc(
        origin,
        'admin_claim_banner_upload_gc',
        { p_claim_id: claimId, p_limit: GC_BATCH_SIZE },
        Math.min(CALL_TIMEOUT_MS, remaining),
      ))
      if (!claim) throw new Error('claim_response_invalid')
      if (!claim.names.length) {
        if (claim.hasMore) throw new Error('claim_lease_contention')
        hasMore = false
        break
      }

      remaining = RUN_TIMEOUT_MS - (Date.now() - startedAt)
      if (remaining <= 0) throw new Error('run_deadline_exceeded')
      await deleteStorageObjects(origin, claim.names, Math.min(CALL_TIMEOUT_MS, remaining))

      remaining = RUN_TIMEOUT_MS - (Date.now() - startedAt)
      if (remaining <= 0) throw new Error('run_deadline_exceeded')
      const completed = await rpc(
        origin,
        'admin_complete_banner_upload_gc',
        { p_claim_id: claimId, p_object_names: claim.names },
        Math.min(CALL_TIMEOUT_MS, remaining),
      )
      if (!normalizeCompleted(completed, claim.names.length)) {
        throw new Error('complete_response_invalid')
      }
      deleted += claim.names.length
      batches += 1
      hasMore = claim.hasMore
    }
  } catch (error) {
    const stable = /^provider_status_\d{3}$/.test(String(error?.message || ''))
      ? String(error.message)
      : 'banner_gc_unavailable'
    console.error('[banner-upload-gc] sweep failed', stable)
    return retryable({
      success: false,
      error: 'banner_gc_unavailable',
      deleted,
      batches,
    })
  }

  if (hasMore) {
    console.error('[banner-upload-gc] eligible backlog remains after capped batches')
    return retryable({
      success: false,
      error: 'banner_gc_backlog_pending',
      deleted,
      batches,
    })
  }
  return json({ success: true, deleted, batches })
}
