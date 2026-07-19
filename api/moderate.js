import { deploymentBoundaryResponse, evaluateDeploymentBoundary } from './_deployment-boundary.js'

export const config = { runtime: 'edge' }

/*
 * Server-side AI moderation proxy.
 *
 * Called by the client before insert; keeps OPENAI_API_KEY off the
 * browser. Returns `{ flagged, categories }`. If OPENAI_API_KEY is
 * not set in the Vercel env, this endpoint short-circuits to
 * `{ flagged: false, skipped: true, reason: 'no_key' }`. A configured
 * provider that times out, fails, or returns an invalid payload is different:
 * it returns a non-2xx response so the client cannot mistake an incomplete
 * safety check for a clean result.
 *
 * Abuse control: requires a valid Supabase JWT, same as the translate
 * proxy. CORS alone cannot stop scripted callers (curl ignores it), and
 * an open endpoint is an unmetered OpenAI moderations proxy. Moderation
 * only ever runs right before an authenticated insert, so gating it
 * costs legitimate callers nothing.
 */

const ALLOWED_ORIGINS = [
  'https://illinimarket.com',
  'https://www.illinimarket.com',
  'https://caaci-community-marketplace-bazaar.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
]

const MAX_INPUT_CHARS = 8_000
const MAX_REQUEST_BYTES = 64 * 1024
const MAX_UPSTREAM_RESPONSE_BYTES = 128 * 1024
const REQUEST_BODY_TIMEOUT_MS = 5_000
const SUPABASE_TIMEOUT_MS = 5_000
const OPENAI_TIMEOUT_MS = 2_500

async function fetchWithTimeout(input, init, timeoutMs) {
  const controller = new AbortController()
  let reader = null
  let timer
  const operation = (async () => {
    const response = await fetch(input, {
      ...(init || {}),
      redirect: 'error',
      signal: controller.signal,
    })
    if (response.redirected || (response.status >= 300 && response.status < 400)) {
      await response.body?.cancel().catch(() => {})
      throw new Error('upstream_redirect')
    }
    const declared = response.headers.get('content-length')
    if (declared != null && (!/^\d+$/.test(declared) || Number(declared) > MAX_UPSTREAM_RESPONSE_BYTES)) {
      await response.body?.cancel().catch(() => {})
      throw new Error('upstream_response_too_large')
    }
    if (!response.body) return response

    reader = response.body.getReader()
    const chunks = []
    let total = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_UPSTREAM_RESPONSE_BYTES) {
        void reader.cancel().catch(() => {})
        throw new Error('upstream_response_too_large')
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return new Response(total ? bytes : null, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  })()
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      void reader?.cancel().catch(() => {})
      reject(new Error('upstream_timeout'))
    }, timeoutMs)
  })
  try {
    return await Promise.race([operation, timeout])
  } finally {
    clearTimeout(timer)
  }
}

async function readBoundedText(stream, declaredLength, maxBytes, timeoutMs) {
  if (declaredLength != null) {
    if (!/^\d+$/.test(declaredLength)) throw Object.assign(new Error('bad content-length'), { code: 'bad_json' })
    if (Number(declaredLength) > maxBytes) {
      throw Object.assign(new Error('request too large'), { code: 'body_too_large' })
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
        throw Object.assign(new Error('request too large'), { code: 'body_too_large' })
      }
      raw += decoder.decode(value, { stream: true })
    }
    return raw + decoder.decode()
  })()
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      void reader.cancel().catch(() => {})
      reject(Object.assign(new Error('request timeout'), { code: 'body_timeout' }))
    }, timeoutMs)
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
    REQUEST_BODY_TIMEOUT_MS,
  )
  try {
    return JSON.parse(raw)
  } catch (error) {
    throw Object.assign(new Error('bad json'), { code: 'bad_json' })
  }
}

function cors(origin) {
  if (!ALLOWED_ORIGINS.includes(origin)) {
    return {
      Vary: 'Origin',
    }
  }
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}

function env(name, fallback) {
  return process.env[name] || fallback
}

const SUPABASE_URL = env('SUPABASE_URL', env('VITE_SUPABASE_URL', ''))
const ANON_KEY = env(
  'SUPABASE_PUBLISHABLE_KEY',
  env('SUPABASE_ANON_KEY', env('VITE_SUPABASE_PUBLISHABLE_KEY', env('VITE_SUPABASE_ANON_KEY', ''))),
)
const SERVICE_KEY = env('SUPABASE_SECRET_KEY', env('SUPABASE_SERVICE_ROLE_KEY', ''))

function supabaseHeaders(key, authorization = '', extra = {}) {
  const headers = { apikey: key, ...extra }
  if (authorization) headers.Authorization = authorization
  else if (!/^sb_(?:publishable|secret)_/.test(key)) headers.Authorization = `Bearer ${key}`
  return headers
}

// Per-user call cap: JWT-gating alone left this an unmetered OpenAI proxy.
// 300/hour is well above real use (moderation runs pre-insert on titles /
// posts / comments / messages) yet bounds a runaway account. (QA8 audit #13.)
const RATE_MAX = 300
const RATE_WINDOW_SECS = 3600

/* Validate the caller's Supabase access token and return the user id (or
   null). Anonymous/forged tokens get 401. ~1 round trip to Supabase. */
async function verifyUser(bearer) {
  if (!/^Bearer\s+[^\s]+$/i.test(bearer) || !SUPABASE_URL || !ANON_KEY) return null
  try {
    const r = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/user`, {
      headers: supabaseHeaders(ANON_KEY, bearer),
    }, SUPABASE_TIMEOUT_MS)
    if (!r.ok) return null
    const u = await r.json().catch(() => null)
    return u?.id || null
  } catch {
    return null
  }
}

/* Per-user rate limit via edge_rate_hit (m082). The moderation model has
   provider rate limits even though it is free, so an unavailable counter fails
   closed. Missing-provider-key fallback is resolved before this limiter and
   remains available. */
async function rateHit(bucket) {
  if (!SUPABASE_URL || !SERVICE_KEY) return null
  try {
    const r = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/edge_rate_hit`, {
      method: 'POST',
      headers: supabaseHeaders(SERVICE_KEY, '', { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ bucket_in: bucket, max_in: RATE_MAX, window_secs_in: RATE_WINDOW_SECS }),
    }, SUPABASE_TIMEOUT_MS)
    if (!r.ok) return null
    const decision = await r.json().catch(() => null)
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

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers })
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers })
  }

  // Verify the JWT before reading attacker-controlled JSON. This keeps the
  // endpoint private and prevents anonymous oversized-body parsing work.
  const userId = await verifyUser(request.headers.get('authorization') || '')
  if (!userId) {
    return new Response(JSON.stringify({ error: 'auth_required' }), { status: 401, headers })
  }

  let body
  try {
    body = await readJsonBody(request)
  } catch (error) {
    const tooLarge = error?.code === 'body_too_large'
    return new Response(
      JSON.stringify({ error: tooLarge ? 'body_too_large' : 'bad_json' }),
      { status: tooLarge ? 413 : 400, headers },
    )
  }

  const text = typeof body?.text === 'string' ? body.text : ''
  if (!text || text.length < 1) {
    return new Response(JSON.stringify({ flagged: false, skipped: true, reason: 'empty' }), { status: 200, headers })
  }
  // Never silently moderate a prefix while the caller proceeds with the full
  // text. An explicit rejection is safer than a false "not flagged" result.
  if (text.length > MAX_INPUT_CHARS) {
    return new Response(JSON.stringify({ error: 'input_too_large' }), { status: 400, headers })
  }

  const key = process.env.OPENAI_API_KEY
  if (!key) {
    return new Response(JSON.stringify({ flagged: false, skipped: true, reason: 'no_key' }), { status: 200, headers })
  }

  const allowed = await rateHit(`moderate:${userId}`)
  if (allowed === null) {
    return new Response(JSON.stringify({ error: 'rate_limit_unavailable' }), { status: 503, headers })
  }
  if (!allowed) {
    return new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429, headers })
  }

  try {
    const r = await fetchWithTimeout('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'omni-moderation-latest',
        input: text,
      }),
    }, OPENAI_TIMEOUT_MS)

    if (!r.ok) {
      // Provider bodies can include project/request metadata. Status is enough
      // for operations without copying that material into application logs.
      console.error('moderate upstream status', r.status)
      return new Response(
        JSON.stringify({ error: 'moderation_unavailable' }),
        { status: 502, headers },
      )
    }

    const data = await r.json().catch(() => null)
    const result = data?.results?.[0]
    if (!result || typeof result.flagged !== 'boolean' || !result.categories || typeof result.categories !== 'object') {
      return new Response(
        JSON.stringify({ error: 'moderation_unavailable' }),
        { status: 502, headers },
      )
    }
    const categories = result.categories
    const flaggedCats = Object.entries(categories)
      .filter(([, v]) => v === true)
      .map(([k]) => k)

    return new Response(
      JSON.stringify({
        flagged: !!result.flagged,
        categories: flaggedCats,
      }),
      { status: 200, headers },
    )
  } catch (e) {
    return new Response(
      JSON.stringify({ error: 'moderation_unavailable' }),
      { status: 503, headers },
    )
  }
}
