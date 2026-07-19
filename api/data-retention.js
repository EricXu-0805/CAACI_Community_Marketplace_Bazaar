import { deploymentBoundaryResponse, evaluateDeploymentBoundary } from './_deployment-boundary.js'

export const config = { runtime: 'edge' }

/*
 * Hourly, service-role-only cleanup of short-lived operational rows.
 *
 * The database RPC owns the cutoffs and fixed batch limits. This route only
 * authenticates Vercel Cron, invokes that exact no-argument capability, and
 * turns every ambiguous outcome into a retryable failure. It never receives
 * or logs row data.
 */

function env(name, fallback = '') {
  return process.env[name] || fallback
}

const SUPABASE_URL = env('SUPABASE_URL', env('VITE_SUPABASE_URL'))
const SERVICE_KEY = env('SUPABASE_SECRET_KEY', env('SUPABASE_SERVICE_ROLE_KEY'))
const CRON_SECRET = env('CRON_SECRET')
const RPC_TIMEOUT_MS = 5_000
const RUN_TIMEOUT_MS = 20_000
const MAX_RPC_BATCHES = 5
const MAX_RESPONSE_BYTES = 16 * 1024
const RETRY_AFTER_SECONDS = 600

function supabaseHeaders(key, authorization = '', extra = {}) {
  const headers = { apikey: key, ...extra }
  if (authorization) headers.Authorization = authorization
  else if (!/^sb_(?:publishable|secret)_/.test(key)) headers.Authorization = `Bearer ${key}`
  return headers
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

function retryable(body, status = 503) {
  return json(body, status, { 'Retry-After': String(RETRY_AFTER_SECONDS) })
}

function bearerToken(req) {
  const value = req.headers.get('authorization') || ''
  const match = /^Bearer ([^\s]+)$/i.exec(value)
  return match?.[1] || ''
}

// Web Crypto is available in the Edge runtime. Hashing both inputs before the
// byte comparison avoids a secret-length timing branch.
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

function rpcUrl() {
  if (!SUPABASE_URL || !SERVICE_KEY || !CRON_SECRET) return null
  try {
    const base = new URL(SUPABASE_URL)
    const localHttp = base.protocol === 'http:'
      && (base.hostname === 'localhost' || base.hostname === '127.0.0.1')
    if (base.username || base.password || (base.protocol !== 'https:' && !localHttp)) return null
    return new URL('/rest/v1/rpc/run_ephemeral_data_retention', base).toString()
  } catch {
    return null
  }
}

async function readBodyLimited(response) {
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
      if (total > MAX_RESPONSE_BYTES) throw new Error('rpc_response_too_large')
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    return text
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
}

function validDeletedCount(value) {
  return Number.isInteger(value) && value >= 0 && value <= 1000
}

function normalizeRpcResult(payload) {
  if (!Array.isArray(payload) || payload.length !== 1) return null
  const row = payload[0]
  if (!row || Array.isArray(row) || typeof row !== 'object') return null
  if (!validDeletedCount(row.edge_rate_limits_deleted)
      || !validDeletedCount(row.illini_verifications_deleted)
      || !validDeletedCount(row.wechat_media_checks_deleted)
      || typeof row.has_more !== 'boolean') return null
  return {
    deleted: {
      edgeRateLimits: row.edge_rate_limits_deleted,
      illiniVerifications: row.illini_verifications_deleted,
      wechatMediaChecks: row.wechat_media_checks_deleted,
    },
    hasMore: row.has_more,
  }
}

async function runRetentionBatch(url, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: supabaseHeaders(SERVICE_KEY, '', {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      }),
      body: '{}',
      signal: controller.signal,
      redirect: 'error',
    })

    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      throw new Error(`rpc_status_${response.status}`)
    }
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) {
      await response.body?.cancel().catch(() => {})
      throw new Error('rpc_response_content_type')
    }
    const raw = await readBodyLimited(response)
    let payload
    try { payload = JSON.parse(raw) } catch { throw new Error('rpc_response_malformed') }
    const normalized = normalizeRpcResult(payload)
    if (!normalized) throw new Error('rpc_response_invalid')
    return normalized
  } finally {
    clearTimeout(timer)
  }
}

export default async function handler(req) {
  const deploymentError = deploymentBoundaryResponse(evaluateDeploymentBoundary({ supabaseUrl: SUPABASE_URL }))
  if (deploymentError) return deploymentError
  if (req.method !== 'GET') {
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' })
  }

  const url = rpcUrl()
  if (!url) return retryable({ error: 'not_configured' })
  if (!(await timingSafeSecretEqual(bearerToken(req), CRON_SECRET))) {
    return json({ error: 'unauthorized' }, 401)
  }

  const deleted = {
    edgeRateLimits: 0,
    illiniVerifications: 0,
    wechatMediaChecks: 0,
  }
  const startedAt = Date.now()
  let batches = 0
  let hasMore = true
  try {
    while (hasMore && batches < MAX_RPC_BATCHES) {
      const remainingMs = RUN_TIMEOUT_MS - (Date.now() - startedAt)
      if (remainingMs <= 0) throw new Error('run_deadline_exceeded')
      const result = await runRetentionBatch(
        url,
        Math.min(RPC_TIMEOUT_MS, remainingMs),
      )
      batches += 1
      deleted.edgeRateLimits += result.deleted.edgeRateLimits
      deleted.illiniVerifications += result.deleted.illiniVerifications
      deleted.wechatMediaChecks += result.deleted.wechatMediaChecks
      hasMore = result.hasMore
    }
  } catch (error) {
    // Static error codes only: no upstream body, secret, URL, bucket, email,
    // trace id, or row payload is written to logs.
    const code = String(error?.message || '').startsWith('rpc_status_')
      ? String(error.message)
      : 'rpc_unavailable'
    console.error('[data-retention] sweep failed', code)
    return retryable({
      success: false,
      error: 'retention_unavailable',
      deleted,
      batches,
    })
  }

  if (hasMore) {
    console.error('[data-retention] eligible backlog remains after capped batches')
    return retryable({
      success: false,
      error: 'retention_backlog_pending',
      deleted,
      batches,
    })
  }

  return json({ success: true, deleted, batches })
}
