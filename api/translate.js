import { deploymentBoundaryResponse, evaluateDeploymentBoundary } from './_deployment-boundary.js'

export const config = { runtime: 'edge' }

/*
 * User-content translation proxy.
 *
 * Translates item titles, descriptions, plaza posts, and comments
 * on demand via OpenAI gpt-4o-mini (cheapest model with reliable
 * bilingual output). Keeps OPENAI_API_KEY off the browser.
 *
 * Safe fallbacks:
 *   · no OPENAI_API_KEY set  → returns { skipped: true }; client
 *     falls back to the static dictionary quickTranslate() and the
 *     user sees the pre-dictionary title instead of a broken UI.
 *   · upstream 429 / 5xx     → same skipped fallback.
 *   · input empty / too long → 400 with explicit reason.
 *
 * Abuse controls:
 *   · requires a valid Supabase JWT — CORS alone cannot stop scripted
 *     callers (curl ignores it), and an open endpoint is an unmetered
 *     OpenAI proxy. Logged-out visitors degrade to the client-side
 *     quickTranslate() dictionary, not a broken UI.
 *   · input capped at 4 KB (item descriptions are capped at 3 KB
 *     client-side so 4 KB gives headroom with a little padding).
 *   · output capped at 1200 tokens, which is ~3 KB of CJK.
 *   · single-shot, no streaming, no conversation memory.
 */

const ALLOWED_ORIGINS = [
  'https://illinimarket.com',
  'https://www.illinimarket.com',
  'https://caaci-community-marketplace-bazaar.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
]

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

const MAX_INPUT_BYTES = 4 * 1024
const MAX_REQUEST_BYTES = 32 * 1024
const MAX_OUTPUT_CHARS = 8 * 1024
const MAX_UPSTREAM_RESPONSE_BYTES = 128 * 1024
const REQUEST_BODY_TIMEOUT_MS = 5_000
const SUPABASE_TIMEOUT_MS = 5_000
const OPENAI_TIMEOUT_MS = 6_500

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

function env(name, fallback) {
  return process.env[name] || fallback
}

const SUPABASE_URL  = env('SUPABASE_URL', env('VITE_SUPABASE_URL', ''))
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

// Per-user call cap: JWT-gating alone left this a volume-unlimited gpt-4o-mini
// proxy (one account could loop distinct 4KB payloads and bill indefinitely).
// 60/hour is far above real use (translations are click-driven + cached 30d
// client-side) yet bounds a runaway account. (QA8 audit #13.)
const RATE_MAX = 60
const RATE_WINDOW_SECS = 3600

/* Validate the caller's Supabase access token and return the user id (or
   null). Anonymous/forged tokens get 401 and the client falls back to its
   static dictionary. ~1 round trip to Supabase per call — fine, translations
   are click-driven and cached client-side for 30 days. */
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

/* Per-user rate limit via edge_rate_hit (m082). This protects a metered API,
   so an unavailable counter is distinct from an exhausted bucket and fails
   closed. The no-provider-key local dictionary fallback happens before this. */
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

  // Authenticate before reading attacker-controlled bodies. Besides keeping
  // every validation branch private, this prevents anonymous oversized JSON
  // from consuming the edge function's parser/memory budget.
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
  const target = body?.target === 'zh' ? 'zh' : body?.target === 'en' ? 'en' : null

  if (!text.trim()) {
    return new Response(JSON.stringify({ translated: '', skipped: true, reason: 'empty' }), { status: 200, headers })
  }
  if (new Blob([text]).size > MAX_INPUT_BYTES) {
    return new Response(JSON.stringify({ error: 'input_too_large' }), { status: 400, headers })
  }
  if (!target) {
    return new Response(JSON.stringify({ error: 'bad_target' }), { status: 400, headers })
  }

  const key = process.env.OPENAI_API_KEY
  if (!key) {
    return new Response(
      JSON.stringify({ translated: '', skipped: true, reason: 'no_key' }),
      { status: 200, headers },
    )
  }

  const allowed = await rateHit(`translate:${userId}`)
  if (allowed === null) {
    return new Response(JSON.stringify({ error: 'rate_limit_unavailable' }), { status: 503, headers })
  }
  if (!allowed) {
    return new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429, headers })
  }

  const sys = target === 'zh'
    ? 'You translate e-commerce/marketplace copy from English into natural, concise Simplified Chinese. Preserve prices, model numbers, brand names, URLs, @mentions, and emojis exactly. Keep the translation tight — do not add marketing flourishes. Return JSON: {"translated": "..."}.'
    : 'You translate e-commerce/marketplace copy from Chinese into natural, concise English. Preserve prices, model numbers, brand names, URLs, @mentions, and emojis exactly. Keep the translation tight — do not add marketing flourishes. Return JSON: {"translated": "..."}.'

  try {
    const r = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: text },
        ],
        temperature: 0.2,
        max_tokens: 1200,
        response_format: { type: 'json_object' },
      }),
    }, OPENAI_TIMEOUT_MS)

    if (!r.ok) {
      return new Response(
        JSON.stringify({ translated: '', skipped: true, reason: `upstream_${r.status}` }),
        { status: 200, headers },
      )
    }

    const data = await r.json().catch(() => null)
    const content = data?.choices?.[0]?.message?.content || ''
    let translated = ''
    try {
      const parsed = JSON.parse(content)
      translated = typeof parsed?.translated === 'string' ? parsed.translated : ''
    } catch {
      translated = ''
    }
    translated = translated.trim()
    if (!translated || translated.length > MAX_OUTPUT_CHARS) {
      return new Response(
        JSON.stringify({ translated: '', skipped: true, reason: 'bad_upstream_payload' }),
        { status: 200, headers },
      )
    }

    return new Response(
      JSON.stringify({ translated, target }),
      { status: 200, headers },
    )
  } catch {
    return new Response(
      JSON.stringify({ translated: '', skipped: true, reason: 'exception' }),
      { status: 200, headers },
    )
  }
}
