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

export default async function handler(request) {
  const origin = request.headers.get('origin') || ''
  const headers = { 'Content-Type': 'application/json', ...cors(origin) }

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers })
  }

  const params = new URL(request.url).searchParams
  const lat = Number(params.get('lat'))
  const lon = Number(params.get('lon'))
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return new Response(JSON.stringify({ error: 'bad_coords' }), { status: 400, headers })
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
