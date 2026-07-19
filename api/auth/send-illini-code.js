import { deploymentBoundaryResponse, evaluateDeploymentBoundary } from '../_deployment-boundary.js'

export const config = { runtime: 'edge' }

/*
 * Illini email verification — STEP 1: send a 6-digit code.
 *
 * For users who signed up with a non-@illinois.edu email and want the verified
 * badge. We email a code to the @illinois.edu address they enter; controlling
 * that inbox proves the affiliation. The login email is NOT changed. The badge
 * (is_illini_verified) is only flipped in verify-illini-code, server-side via
 * the service role — never by the client (see migration 072's guard trigger).
 *
 * Env (already set in Vercel — same as notification-digest / moderate):
 *   SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, RESEND_API_KEY,
 *   (legacy SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY remain fallbacks),
 *   DIGEST_FROM (sender on the Resend-verified send.illinimarket.com domain).
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
const RESEND_API_KEY = env('RESEND_API_KEY')
const FROM = env('DIGEST_FROM', 'Illini Market <noreply@send.illinimarket.com>')

const CODE_TTL_MIN = 10
const RESEND_COOLDOWN_S = 60
const DAILY_CAP = 8
const TARGET_DAILY_CAP = 8
const IP_HOURLY_CAP = 24
const ILLINI_RE = /^[^@\s]+@illinois\.edu$/
const MAX_REQUEST_BYTES = 2 * 1024
const MAX_UPSTREAM_RESPONSE_BYTES = 64 * 1024
const BODY_TIMEOUT_MS = 5_000
const SUPABASE_TIMEOUT_MS = 5_000
const RESEND_TIMEOUT_MS = 8_000

function supabaseHeaders(key, authorization = '', extra = {}) {
  const headers = { apikey: key, ...extra }
  if (authorization) headers.Authorization = authorization
  else if (!/^sb_(?:publishable|secret)_/.test(key)) headers.Authorization = `Bearer ${key}`
  return headers
}

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

async function fetchWithTimeout(input, init = {}, timeoutMs = SUPABASE_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
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

/* Validate the caller's Supabase access token → return the user (id, email) or null. */
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
async function hmacHex(label, value) {
  if (!SERVICE_KEY) throw new Error('rate_key_unavailable')
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(SERVICE_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${label}:v1\u0000${String(value)}`),
  )
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
function gen6() {
  const a = new Uint32Array(1)
  crypto.getRandomValues(a)
  return String(a[0] % 1000000).padStart(6, '0')
}

function sbREST(path, init = {}) {
  return fetchWithTimeout(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: supabaseHeaders(SERVICE_KEY, '', {
      'Content-Type': 'application/json', ...(init.headers || {}),
    }),
  })
}

// Atomic limiter backed by migration 082. Unlike the old
// read-check-write counters on illini_verifications, concurrent requests
// serialize inside Postgres and cannot all pass the same stale count.
async function rateHit(bucket, max, windowSeconds) {
  const r = await sbREST('rpc/edge_rate_hit', {
    method: 'POST',
    body: JSON.stringify({ bucket_in: bucket, max_in: max, window_secs_in: windowSeconds }),
  })
  if (!r.ok) return null
  const decision = await readJsonResponse(r).catch(() => null)
  if (decision === true) return true
  if (decision === false) return false
  return null
}

function clientIp(request) {
  // Vercel overwrites this header at the edge, so a caller cannot select a
  // victim's rate bucket. Keep x-forwarded-for as a local/dev fallback.
  const forwarded = request.headers.get('x-vercel-forwarded-for')
    || request.headers.get('x-forwarded-for')
    || ''
  return forwarded.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown'
}

function codeEmailHtml(code) {
  // Matches the house transactional-email style (notification-digest): parchment
  // ground, the orange 集 brand seal, Georgia serif wordmark, warm text palette,
  // white card. color-scheme:light pins it so dark mail clients (Apple Mail)
  // render it as designed instead of auto-inverting it into muddy dark-on-dark.
  // The code box uses Illini navy — on-brand for the badge being earned.
  return `<!doctype html><html lang="en"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0;background:#F7F4EE;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:32px 20px;">
    <div style="text-align:center;">
      <span style="display:inline-block;width:44px;height:44px;line-height:44px;border-radius:12px;background:#C74A2F;color:#fff;font-weight:700;font-size:22px;">集</span>
      <div style="font-family:Georgia,'Times New Roman',serif;font-size:20px;color:#2A2521;margin-top:10px;">Illini Market</div>
    </div>
    <div style="background:#fff;border-radius:16px;padding:28px 28px 26px;margin-top:18px;">
      <div style="font-size:15px;color:#4A443B;line-height:1.55;">
        Use this code to verify your Illinois campus email and earn your <b style="color:#13294B;">Illini</b> badge:
      </div>
      <div style="font-size:32px;font-weight:800;letter-spacing:9px;color:#ffffff;text-align:center;background:#13294B;border-radius:12px;padding:18px 0;margin:18px 0 4px;">${code}</div>
      <div style="font-size:12px;color:#8B8478;line-height:1.5;margin-top:16px;">
        The code expires in ${CODE_TTL_MIN} minutes. If you didn't request this, you can ignore this email — your account is unchanged.
      </div>
    </div>
    <div style="text-align:center;color:#A39A8C;font-size:11px;line-height:1.6;margin-top:20px;">
      Illini Market · UIUC campus marketplace
    </div>
  </div>
</body></html>`
}

export default async function handler(request) {
  const deploymentError = deploymentBoundaryResponse(evaluateDeploymentBoundary({ supabaseUrl: SUPABASE_URL }))
  if (deploymentError) return deploymentError
  const origin = request.headers.get('origin') || ''
  const headers = { 'Content-Type': 'application/json', ...cors(origin) }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers })

  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY || !RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: 'not_configured' }), { status: 503, headers })
  }

  const user = await getUser(request.headers.get('authorization') || '')
  if (!user || !user.id) return new Response(JSON.stringify({ error: 'auth_required' }), { status: 401, headers })

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
  const email = String(body?.email || '').trim().toLowerCase()
  if (!ILLINI_RE.test(email)) return new Response(JSON.stringify({ error: 'invalid_email' }), { status: 400, headers })

  // Layer limits by account, target inbox and source network. Key every
  // persistent bucket with a versioned, service-secret HMAC so identifiers
  // cannot be recovered with an offline dictionary. Fail closed: sending
  // email is a cost-bearing action, so a broken limiter must not silently turn
  // into an unlimited endpoint.
  try {
    const [userKey, targetKey, ipKey] = await Promise.all([
      hmacHex('illini-send:user', user.id),
      hmacHex('illini-send:target', email),
      hmacHex('illini-send:network', clientIp(request)),
    ])
    const cooldownAllowed = await rateHit(
      `illini-send:cooldown:${userKey}`,
      1,
      RESEND_COOLDOWN_S,
    )
    if (cooldownAllowed === null) {
      return new Response(JSON.stringify({ error: 'rate_limit_unavailable' }), { status: 503, headers })
    }
    if (cooldownAllowed === false) {
      return new Response(JSON.stringify({ error: 'cooldown' }), { status: 429, headers })
    }
    const [userDaily, targetDaily, ipHourly] = await Promise.all([
      rateHit(`illini-send:daily-user:${userKey}`, DAILY_CAP, 24 * 60 * 60),
      rateHit(`illini-send:daily-target:${targetKey}`, TARGET_DAILY_CAP, 24 * 60 * 60),
      rateHit(`illini-send:hourly-ip:${ipKey}`, IP_HOURLY_CAP, 60 * 60),
    ])
    if ([userDaily, targetDaily, ipHourly].some((decision) => decision === null)) {
      return new Response(JSON.stringify({ error: 'rate_limit_unavailable' }), { status: 503, headers })
    }
    if ([userDaily, targetDaily, ipHourly].some((decision) => decision === false)) {
      return new Response(JSON.stringify({ error: 'daily_cap' }), { status: 429, headers })
    }
  } catch (error) {
    try { console.error('illini limiter unavailable') } catch {}
    return new Response(JSON.stringify({ error: 'rate_limit_unavailable' }), { status: 503, headers })
  }

  try {
    // Already verified? No-op. (Caller's own row — not a cross-account oracle.)
    const meResponse = await sbREST(`profiles?id=eq.${user.id}&select=is_illini_verified`)
    if (!meResponse.ok) {
      try { console.error('illini profile lookup failed', meResponse.status) } catch {}
      return new Response(JSON.stringify({ error: 'store_failed' }), { status: 503, headers })
    }
    const meRows = await readJsonResponse(meResponse)
    if (!Array.isArray(meRows)) throw new Error('profile_response_invalid')
    if (meRows?.[0]?.is_illini_verified) return new Response(JSON.stringify({ error: 'already_verified' }), { status: 409, headers })
    // We deliberately do NOT pre-check whether `email` is taken by another
    // account here — that was a free enumeration oracle (409 = "this campus
    // email is a verified member"). One-email-one-account is enforced at verify
    // time by the unique index (→ email_taken); a wasted send is the acceptable cost.

    // The pending row retains delivery metadata for support/debugging. Actual
    // enforcement is the atomic edge_rate_hit gate above.
    const existingResponse = await sbREST(`illini_verifications?user_id=eq.${user.id}&select=last_sent_at,sent_today,sent_date`)
    if (!existingResponse.ok) {
      try { console.error('illini pending lookup failed', existingResponse.status) } catch {}
      return new Response(JSON.stringify({ error: 'store_failed' }), { status: 503, headers })
    }
    const existingRows = await readJsonResponse(existingResponse)
    if (!Array.isArray(existingRows)) throw new Error('pending_response_invalid')
    const existing = existingRows[0]
    const today = new Date().toISOString().slice(0, 10)
    const priorToday = existing?.sent_date === today ? (existing.sent_today || 0) : 0

    const code = gen6()
    const code_hash = await sha256Hex(`${code}:${user.id}`)
    const nowIso = new Date().toISOString()
    const expires_at = new Date(Date.now() + CODE_TTL_MIN * 60 * 1000).toISOString()

    const up = await sbREST('illini_verifications', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ user_id: user.id, email, code_hash, expires_at, attempts: 0, last_sent_at: nowIso, sent_today: priorToday + 1, sent_date: today }),
    })
    if (!up.ok) {
      try { console.error('illini store failed', up.status) } catch {}
      return new Response(JSON.stringify({ error: 'store_failed' }), { status: 503, headers })
    }

    const sent = await fetchWithTimeout('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [email], subject: 'Your Illini Market verification code', html: codeEmailHtml(code) }),
    }, RESEND_TIMEOUT_MS)
    if (!sent.ok) {
      try { console.error('illini resend failed', sent.status) } catch {}
      return new Response(JSON.stringify({ error: 'send_failed' }), { status: 502, headers })
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers })
  } catch (e) {
    try { console.error('illini send unavailable') } catch {}
    return new Response(JSON.stringify({ error: 'send_failed' }), { status: 503, headers })
  }
}
