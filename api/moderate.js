export const config = { runtime: 'edge' }

/*
 * Server-side AI moderation proxy.
 *
 * Called by the client before insert; keeps OPENAI_API_KEY off the
 * browser. Returns `{ flagged, categories }`. If OPENAI_API_KEY is
 * not set in the Vercel env, this endpoint short-circuits to
 * `{ flagged: false, skipped: true }` — safe fallback so a missing
 * key never breaks publish flows.
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
const ANON_KEY     = env('SUPABASE_ANON_KEY', env('VITE_SUPABASE_ANON_KEY', ''))
const SERVICE_KEY  = env('SUPABASE_SERVICE_ROLE_KEY', '')

// Per-user call cap: JWT-gating alone left this an unmetered OpenAI proxy.
// 300/hour is well above real use (moderation runs pre-insert on titles /
// posts / comments / messages) yet bounds a runaway account. (QA8 audit #13.)
const RATE_MAX = 300
const RATE_WINDOW_SECS = 3600

/* Validate the caller's Supabase access token and return the user id (or
   null). Anonymous/forged tokens get 401. ~1 round trip to Supabase. */
async function verifyUser(bearer) {
  if (!bearer || !SUPABASE_URL || !ANON_KEY) return null
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: bearer },
    })
    if (!r.ok) return null
    const u = await r.json()
    return u?.id || null
  } catch {
    return null
  }
}

/* Per-user rate limit via edge_rate_hit (m082). Fail-open, matching the other
   edge limiters — a broken limiter must not block publishes. */
async function rateHit(bucket) {
  if (!SUPABASE_URL || !SERVICE_KEY) return true
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/edge_rate_hit`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucket_in: bucket, max_in: RATE_MAX, window_secs_in: RATE_WINDOW_SECS }),
    })
    if (!r.ok) return true
    return (await r.json()) !== false
  } catch {
    return true
  }
}

export default async function handler(request) {
  const origin = request.headers.get('origin') || ''
  const headers = { 'Content-Type': 'application/json', ...cors(origin) }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers })
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'bad_json' }), { status: 400, headers })
  }

  // ADM-SEC-07: verify the JWT BEFORE any other work. The empty-text 200
  // short-circuit used to sit ahead of this check, letting an unauthenticated
  // caller probe the endpoint for free.
  const userId = await verifyUser(request.headers.get('authorization') || '')
  if (!userId) {
    return new Response(JSON.stringify({ error: 'auth_required' }), { status: 401, headers })
  }
  if (!(await rateHit(`moderate:${userId}`))) {
    return new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429, headers })
  }

  const text = typeof body?.text === 'string' ? body.text.slice(0, 8000) : ''
  if (!text || text.length < 1) {
    return new Response(JSON.stringify({ flagged: false, skipped: true, reason: 'empty' }), { status: 200, headers })
  }

  const key = process.env.OPENAI_API_KEY
  if (!key) {
    return new Response(JSON.stringify({ flagged: false, skipped: true, reason: 'no_key' }), { status: 200, headers })
  }

  try {
    const r = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'omni-moderation-latest',
        input: text,
      }),
    })

    if (!r.ok) {
      /* Don't reflect the upstream error body to (anonymous) callers —
         it leaks request-ids/org hints. console.error lands in Vercel
         function logs, which is where debugging happens anyway. */
      try { console.error('moderate upstream', r.status, (await r.text()).slice(0, 400)) } catch {}
      return new Response(
        JSON.stringify({
          flagged: false,
          skipped: true,
          reason: `upstream_${r.status}`,
        }),
        { status: 200, headers },
      )
    }

    const data = await r.json()
    const result = data?.results?.[0] || {}
    const categories = result.categories || {}
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
      JSON.stringify({ flagged: false, skipped: true, reason: 'exception' }),
      { status: 200, headers },
    )
  }
}
