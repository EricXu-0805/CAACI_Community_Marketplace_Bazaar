import { deploymentBoundaryResponse, evaluateDeploymentBoundary } from '../_deployment-boundary.js'

export const config = { runtime: 'edge' }

/*
 * Illini email verification — STEP 2: check the code, flip the badge.
 *
 * The edge route authenticates + rate-limits, hashes the submitted code, then
 * calls a caller-bound SECURITY DEFINER RPC. That RPC owns the row lock,
 * attempts counter, campus-email uniqueness check, badge update, and code
 * consumption as one database transaction. Login email is never touched.
 */

const ALLOWED_ORIGINS = [
  'https://illinimarket.com',
  'https://www.illinimarket.com',
  'https://caaci-community-marketplace-bazaar.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
]
function cors(origin) {
  if (!ALLOWED_ORIGINS.includes(origin)) return { Vary: 'Origin' }
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}
function env(name, fb = '') { return process.env[name] || fb }

const SUPABASE_URL = env('SUPABASE_URL', env('VITE_SUPABASE_URL'))
const ANON_KEY = env(
  'SUPABASE_PUBLISHABLE_KEY',
  env('SUPABASE_ANON_KEY', env('VITE_SUPABASE_PUBLISHABLE_KEY', env('VITE_SUPABASE_ANON_KEY'))),
)
const SERVICE_KEY = env('SUPABASE_SECRET_KEY', env('SUPABASE_SERVICE_ROLE_KEY'))
const MAX_REQUEST_BYTES = 2 * 1024
const MAX_UPSTREAM_RESPONSE_BYTES = 64 * 1024
const BODY_TIMEOUT_MS = 5_000
const SUPABASE_TIMEOUT_MS = 5_000

function supabaseHeaders(key, authorization = '', extra = {}) {
  const headers = { apikey: key, ...extra }
  if (authorization) headers.Authorization = authorization
  else if (!/^sb_(?:publishable|secret)_/.test(key)) headers.Authorization = `Bearer ${key}`
  return headers
}

const VERIFICATION_ERRORS = Object.freeze({
  no_pending: 400,
  expired: 400,
  bad_code: 400,
  invalid_email: 400,
  too_many_attempts: 429,
  email_taken: 409,
  already_verified: 409,
  profile_not_found: 409,
})

async function readBoundedText(stream, declaredLength, maxBytes) {
  if (declaredLength != null) {
    if (!/^\d+$/.test(declaredLength)) throw Object.assign(new Error('bad length'), { code: 'bad_json' })
    if (Number(declaredLength) > maxBytes) {
      throw Object.assign(new Error('body too large'), { code: 'body_too_large' })
    }
  }
  if (!stream) throw Object.assign(new Error('missing body'), { code: 'bad_json' })

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
        throw Object.assign(new Error('body too large'), { code: 'body_too_large' })
      }
      raw += decoder.decode(value, { stream: true })
    }
    return raw + decoder.decode()
  })()
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      void reader.cancel().catch(() => {})
      reject(Object.assign(new Error('body timeout'), { code: 'body_timeout' }))
    }, BODY_TIMEOUT_MS)
  })
  try {
    return await Promise.race([consume, timeout])
  } finally {
    clearTimeout(timer)
  }
}

async function readJsonBody(request) {
  const raw = await readBoundedText(
    request.body,
    request.headers.get('content-length'),
    MAX_REQUEST_BYTES,
  )
  let value
  try { value = JSON.parse(raw) } catch { throw Object.assign(new Error('bad json'), { code: 'bad_json' }) }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('bad json'), { code: 'bad_json' })
  }
  return value
}

async function readJsonResponse(response) {
  const raw = await readBoundedText(
    response.body,
    response.headers.get('content-length'),
    MAX_UPSTREAM_RESPONSE_BYTES,
  )
  return JSON.parse(raw)
}

async function fetchWithTimeout(input, init = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SUPABASE_TIMEOUT_MS)
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
      redirect: 'error',
    })
  } finally {
    clearTimeout(timer)
  }
}

async function getUser(bearer) {
  if (!/^Bearer\s+[^\s]+$/i.test(bearer || '') || !SUPABASE_URL || !ANON_KEY) return null
  try {
    const r = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/user`, { headers: supabaseHeaders(ANON_KEY, bearer) })
    if (!r.ok) return null
    return await readJsonResponse(r)
  } catch { return null }
}
async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
/* Per-user edge cap supplements the RPC's atomic five-attempt code limit. A
   missing/malformed/non-2xx limiter response is not permission to verify. */
async function rateHit(userId) {
  if (!SUPABASE_URL || !SERVICE_KEY) return null
  try {
    const r = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/edge_rate_hit`, {
      method: 'POST',
      headers: supabaseHeaders(SERVICE_KEY, '', { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ bucket_in: `illini-verify:${userId}`, max_in: 10, window_secs_in: 3600 }),
    })
    if (!r.ok) return null
    const decision = await readJsonResponse(r).catch(() => null)
    if (decision === true) return true
    if (decision === false) return false
    return null
  } catch {
    return null
  }
}

export default async function handler(request) {
  const deploymentError = deploymentBoundaryResponse(evaluateDeploymentBoundary({ supabaseUrl: SUPABASE_URL }))
  if (deploymentError) return deploymentError
  const origin = request.headers.get('origin') || ''
  const headers = { 'Content-Type': 'application/json', ...cors(origin) }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers })

  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'not_configured' }), { status: 503, headers })
  }

  const bearer = request.headers.get('authorization') || ''
  const user = await getUser(bearer)
  if (!user || !user.id) return new Response(JSON.stringify({ error: 'auth_required' }), { status: 401, headers })

  const rateDecision = await rateHit(user.id)
  if (rateDecision === null) {
    return new Response(JSON.stringify({ error: 'rate_limit_unavailable' }), { status: 503, headers })
  }
  if (rateDecision === false) {
    return new Response(JSON.stringify({ error: 'too_many_attempts' }), { status: 429, headers })
  }

  let body
  try {
    body = await readJsonBody(request)
  } catch (error) {
    const tooLarge = error?.code === 'body_too_large'
    return new Response(JSON.stringify({ error: tooLarge ? 'body_too_large' : 'bad_json' }), {
      status: tooLarge ? 413 : 400,
      headers,
    })
  }
  const code = String(body?.code || '').trim()
  if (!/^\d{6}$/.test(code)) return new Response(JSON.stringify({ error: 'bad_code' }), { status: 400, headers })

  try {
    const hash = await sha256Hex(`${code}:${user.id}`)
    const verifyResponse = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/verify_illini_email_code`, {
      method: 'POST',
      headers: supabaseHeaders(ANON_KEY, bearer, {
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({
        expected_user_id_in: user.id,
        submitted_code_hash_in: hash,
      }),
    })
    const result = await readJsonResponse(verifyResponse).catch(() => null)

    if (!verifyResponse.ok) {
      if (verifyResponse.status === 401 || verifyResponse.status === 403) {
        return new Response(JSON.stringify({ error: 'auth_required' }), { status: 401, headers })
      }
      if (verifyResponse.status === 404 || result?.code === 'PGRST202') {
        return new Response(JSON.stringify({ error: 'verification_unavailable' }), { status: 503, headers })
      }
      try { console.error('illini verify rpc', verifyResponse.status, String(result?.code || 'unknown').slice(0, 40)) } catch {}
      return new Response(JSON.stringify({ error: 'verify_failed' }), { status: 500, headers })
    }

    if (result === 'verified') {
      return new Response(JSON.stringify({ ok: true, verified: true }), { status: 200, headers })
    }

    const status = VERIFICATION_ERRORS[result]
    if (status) {
      return new Response(JSON.stringify({ error: result }), { status, headers })
    }

    try { console.error('illini verify rpc unexpected result') } catch {}
    return new Response(JSON.stringify({ error: 'verify_failed' }), { status: 500, headers })
  } catch (e) {
    try { console.error('illini verify unavailable') } catch {}
    return new Response(JSON.stringify({ error: 'verification_unavailable' }), { status: 503, headers })
  }
}
