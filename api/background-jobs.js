import { moderationObjectKeys, mediaMoveSucceeded } from './_moderation-media.js'
import { deploymentBoundaryResponse, evaluateDeploymentBoundary } from './_deployment-boundary.js'
import { reportToSentry } from './_sentry-report.js'

export const config = { runtime: 'edge' }

// Bounded recovery for atomic database outboxes. All credentials stay server-side.

function env(name, fallback = '') {
  return process.env[name] || fallback
}

const SUPABASE_URL = env('SUPABASE_URL', env('VITE_SUPABASE_URL'))
const SERVICE_KEY = env('SUPABASE_SECRET_KEY', env('SUPABASE_SERVICE_ROLE_KEY'))
const CRON_SECRET = env('CRON_SECRET')
const CALL_TIMEOUT_MS = 5_000
const RUN_TIMEOUT_MS = 25_000
const MAX_RESPONSE_BYTES = 256 * 1024
const RETRY_AFTER_SECONDS = 600
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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
      redirect: 'manual',
      signal: controller.signal,
    })
    if (response.type === 'opaqueredirect' || response.status === 0
        || response.redirected || (response.status >= 300 && response.status < 400)) {
      throw new Error('provider_redirect')
    }
    const rawLength = response.headers.get('content-length')
    if (rawLength && /^\d+$/.test(rawLength) && Number(rawLength) > MAX_RESPONSE_BYTES) {
      await response.body?.cancel().catch(() => {})
      throw new Error('response_too_large')
    }
    const text = await readLimited(response)
    return { response, text }
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
  const { response, text } = await serviceCall(url, {
    method: 'POST',
    headers: serviceHeaders({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify(args),
  }, timeoutMs)
  if (!response.ok) throw new Error(`provider_status_${response.status}`)
  return parseJson(text)
}

export default async function handler(request) {
  const deploymentError = deploymentBoundaryResponse(evaluateDeploymentBoundary({ supabaseUrl: SUPABASE_URL }))
  if (deploymentError) return deploymentError
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' })
  const origin = serviceOrigin()
  if (!origin) return retryable({ error: 'not_configured' })
  if (!(await timingSafeSecretEqual(bearerToken(request), CRON_SECRET))) return json({ error: 'unauthorized' }, 401)
  const deadline = Date.now() + RUN_TIMEOUT_MS
  const timeLeft = () => {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error('run_deadline_exceeded')
    return Math.min(CALL_TIMEOUT_MS, remaining)
  }
  const call = (name, args = {}) => rpc(origin, name, args, timeLeft())
  const counts = { listing_batches: 0, notifications: 0, media_completed: 0, media_retried: 0, media_cancelled: 0 }
  try {
    // Reserve time for both kinds of work. Each object has its own lease, so a
    // single bad upload cannot delay all later evidence or listing reminders.
    for (let i = 0; i < 3 && deadline - Date.now() > 10_000; i++) {
      const job = await call('claim_moderation_media_job')
      if (job === null) break
      if (job?.cancelled === true) { counts.media_cancelled++; continue }
      if (!job || !UUID_RE.test(job.id || '') || !UUID_RE.test(job.lease_token || '') ||
          !UUID_RE.test(job.owner_id || '') || typeof job.image_url !== 'string') throw new Error('claim_invalid')
      const key = moderationObjectKeys([job.image_url], job.owner_id, origin.href)[0]
      let outcome = 'invalid_reference'
      if (key) {
        outcome = 'storage_unavailable'
        try {
          const { response, text } = await serviceCall(new URL('/storage/v1/object/move', origin), {
            method: 'POST', headers: serviceHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ bucketId: 'item-images', sourceKey: key,
              destinationBucket: 'moderation-evidence', destinationKey: key }),
          }, timeLeft())
          if (mediaMoveSucceeded(response, text)) outcome = 'complete'
        } catch { /* Persist a retry after timeout, redirect, or provider failure. */ }
      }
      if (await call('finish_moderation_media_job', {
        id_in: job.id, lease_in: job.lease_token, outcome_in: outcome,
      }) !== true) throw new Error('media_lease_lost')
      if (outcome === 'complete') counts.media_completed++
      else if (outcome === 'invalid_reference') counts.media_cancelled++
      else counts.media_retried++
    }
    for (let i = 0; i < 100 && deadline - Date.now() > 5_000; i++) {
      const batch = await call('process_listing_notification_job', { batch_size_in: 200 })
      if (!batch || typeof batch.worked !== 'boolean' || !Number.isInteger(batch.scanned) ||
          batch.scanned < 0 || batch.scanned > 200 || !Number.isInteger(batch.inserted) ||
          batch.inserted < 0 || batch.inserted > batch.scanned) throw new Error('listing_batch_invalid')
      if (!batch.worked) break
      counts.listing_batches++
      counts.notifications += batch.inserted
    }
    await call('purge_completed_background_jobs', { limit_in: 500 })
    const backlog = await call('background_job_status')
    if (!backlog || !['listing_pending','listing_oldest_seconds','media_pending','media_failed'].every(
      name => Number.isSafeInteger(backlog[name]) && backlog[name] >= 0,
    )) throw new Error('backlog_invalid')
    if (counts.media_retried || backlog.media_failed) {
      await reportToSentry('api/background-jobs', 'moderation media needs retry', {
        retryCount: counts.media_retried, failedCount: backlog.media_failed,
      })
    }
    return json({ success: backlog.media_failed === 0, ...counts, backlog }, backlog.media_failed ? 503 : 200)
  } catch {
    await reportToSentry('api/background-jobs', 'background worker incomplete', counts)
    return retryable({ error: 'background_work_incomplete', ...counts })
  }
}
