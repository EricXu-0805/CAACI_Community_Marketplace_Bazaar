export const config = { runtime: 'edge' }

/*
 * Reverse-geocode proxy: lat,lon → address (for "use current location").
 *
 * The browser cannot reverse-geocode directly (QA6 #12) for THREE reasons,
 * all of which this same-origin proxy resolves:
 *   1. CSP — connect-src in vercel.json allows 'self' but not
 *      nominatim.openstreetmap.org, so a direct browser fetch is blocked
 *      outright. /api/geocode IS 'self'.
 *   2. Nominatim returns 403 to requests without a User-Agent, and browsers
 *      can't set one. Server-side we send a compliant UA (app + contact).
 *   3. Nominatim sends no Access-Control-Allow-Origin header, so even a 200
 *      would be unreadable cross-origin. Same-origin has no CORS.
 *
 * Returns the raw Nominatim `address` object so the client keeps its own
 * label cascade (building → road → city → …). Edge-cached: a given
 * coordinate's address is effectively static.
 */

const ALLOWED_ORIGINS = [
  'https://illinimarket.com',
  'https://www.illinimarket.com',
  'https://caaci-community-marketplace-bazaar.vercel.app',
  'https://community-marketplace-bazaar.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
]

function cors(origin) {
  if (!ALLOWED_ORIGINS.includes(origin)) return { Vary: 'Origin' }
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}

function env(name, fb = '') { return process.env[name] || fb }
const SUPABASE_URL = env('SUPABASE_URL', env('VITE_SUPABASE_URL'))
const SERVICE_KEY  = env('SUPABASE_SERVICE_ROLE_KEY')

/* Per-IP rate limit via edge_rate_hit (m082). This endpoint is anonymous
   (no JWT), so abuse — looping randomized coords, each a cache miss — would
   hammer Nominatim past its 1 req/s policy under the app's identifying UA and
   get it banned, breaking location for everyone. 40/hour per IP covers a real
   user detecting their location a handful of times. Fail-open. (QA8 #14.) */
async function rateHit(ip) {
  if (!SUPABASE_URL || !SERVICE_KEY || !ip) return true
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/edge_rate_hit`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucket_in: `geocode:${ip}`, max_in: 40, window_secs_in: 3600 }),
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

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers })
  }

  const params = new URL(request.url).searchParams
  const latRaw = params.get('lat')
  const lonRaw = params.get('lon')
  // Require the params to be PRESENT — Number(null) is 0 (finite), so a
  // param-less GET used to sail through as (0,0). (QA8 audit #14.)
  if (latRaw === null || latRaw === '' || lonRaw === null || lonRaw === '') {
    return new Response(JSON.stringify({ error: 'bad_coords' }), { status: 400, headers })
  }
  const lat = Number(latRaw)
  const lon = Number(lonRaw)
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return new Response(JSON.stringify({ error: 'bad_coords' }), { status: 400, headers })
  }

  // Per-IP rate limit (anonymous endpoint — protect the shared Nominatim UA).
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim()
    || request.headers.get('x-real-ip') || ''
  if (!(await rateHit(ip))) {
    return new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429, headers })
  }

  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=18&addressdetails=1&email=help@illinimarket.com`

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 6000)
    const r = await fetch(url, {
      headers: {
        // The actual fix — a real User-Agent the browser can't send. Names
        // the app + a contact, per Nominatim's usage policy.
        'User-Agent': 'IlliniMarket/1.0 (+https://illinimarket.com; help@illinimarket.com)',
        'Accept-Language': 'en',
      },
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!r.ok) {
      return new Response(JSON.stringify({ error: 'geocoder_status', status: r.status }), { status: 502, headers })
    }
    const data = await r.json()
    return new Response(
      JSON.stringify({ address: (data && data.address) || {}, display_name: data?.display_name || '' }),
      { status: 200, headers: { ...headers, 'Cache-Control': 's-maxage=86400, stale-while-revalidate=604800' } },
    )
  } catch {
    return new Response(JSON.stringify({ error: 'timeout_or_network' }), { status: 504, headers })
  }
}
