export const config = { runtime: 'edge' }

/*
 * Illini email verification — STEP 2: check the code, flip the badge.
 *
 * Validates the 6-digit code against the row stored by send-illini-code, then
 * sets profiles.is_illini_verified + verified_illini_email via the SERVICE ROLE
 * (the only path allowed to — migration 072's guard trigger blocks clients).
 * Login email is never touched. One campus email → one account (DB unique index;
 * a race surfaces as email_taken). Code is consumed (row deleted) on success.
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
const ANON_KEY = env('SUPABASE_ANON_KEY', env('VITE_SUPABASE_ANON_KEY'))
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')

const MAX_ATTEMPTS = 5
const ILLINI_RE = /^[^@\s]+@illinois\.edu$/

async function getUser(bearer) {
  if (!bearer || !SUPABASE_URL || !ANON_KEY) return null
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY, Authorization: bearer } })
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}
async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
function sbREST(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', ...(init.headers || {}),
    },
  })
}

export default async function handler(request) {
  const origin = request.headers.get('origin') || ''
  const headers = { 'Content-Type': 'application/json', ...cors(origin) }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers })

  if (!SERVICE_KEY) return new Response(JSON.stringify({ error: 'not_configured' }), { status: 503, headers })

  const user = await getUser(request.headers.get('authorization') || '')
  if (!user || !user.id) return new Response(JSON.stringify({ error: 'auth_required' }), { status: 401, headers })

  let body
  try { body = await request.json() } catch { return new Response(JSON.stringify({ error: 'bad_json' }), { status: 400, headers }) }
  const code = String(body?.code || '').trim()
  if (!/^\d{6}$/.test(code)) return new Response(JSON.stringify({ error: 'bad_code' }), { status: 400, headers })

  try {
    const rows = await sbREST(`illini_verifications?user_id=eq.${user.id}&select=*`).then((r) => r.json())
    const row = Array.isArray(rows) ? rows[0] : null
    if (!row) return new Response(JSON.stringify({ error: 'no_pending' }), { status: 400, headers })

    if (new Date(row.expires_at).getTime() < Date.now()) {
      await sbREST(`illini_verifications?user_id=eq.${user.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
      return new Response(JSON.stringify({ error: 'expired' }), { status: 400, headers })
    }
    if ((row.attempts || 0) >= MAX_ATTEMPTS) return new Response(JSON.stringify({ error: 'too_many_attempts' }), { status: 429, headers })

    const hash = await sha256Hex(`${code}:${user.id}`)
    if (hash !== row.code_hash) {
      await sbREST(`illini_verifications?user_id=eq.${user.id}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ attempts: (row.attempts || 0) + 1 }),
      })
      return new Response(JSON.stringify({ error: 'bad_code' }), { status: 400, headers })
    }

    // Defense in depth: re-check the stored email is a campus address before granting.
    if (!ILLINI_RE.test(String(row.email || '').toLowerCase())) {
      await sbREST(`illini_verifications?user_id=eq.${user.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
      return new Response(JSON.stringify({ error: 'invalid_email' }), { status: 400, headers })
    }

    const patch = await sbREST(`profiles?id=eq.${user.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ is_illini_verified: true, verified_illini_email: row.email }),
    })
    if (!patch.ok) {
      const txt = await patch.text().catch(() => '')
      if (patch.status === 409 || /duplicate|unique|23505/i.test(txt)) {
        return new Response(JSON.stringify({ error: 'email_taken' }), { status: 409, headers })
      }
      try { console.error('illini grant', patch.status, txt.slice(0, 200)) } catch {}
      return new Response(JSON.stringify({ error: 'update_failed' }), { status: 500, headers })
    }

    await sbREST(`illini_verifications?user_id=eq.${user.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
    return new Response(JSON.stringify({ ok: true, verified: true }), { status: 200, headers })
  } catch (e) {
    try { console.error('illini verify exception', String(e).slice(0, 200)) } catch {}
    return new Response(JSON.stringify({ error: 'exception' }), { status: 500, headers })
  }
}
