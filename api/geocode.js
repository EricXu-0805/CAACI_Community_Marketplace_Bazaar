import { streetCheckInput, streetLabel, verifiedSessionId } from './_street-location.js'
import { deploymentBoundaryResponse, evaluateDeploymentBoundary } from './_deployment-boundary.js'

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
 * Returns a minimized Nominatim `address` object so the client keeps its own
 * label cascade (building → road → city → …). Coordinates are precise
 * device context, so neither successful nor failed responses are CDN-cached.
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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}

function env(name, fb = '') { return process.env[name] || fb }
const SUPABASE_URL = env('SUPABASE_URL', env('VITE_SUPABASE_URL'))
const ANON_KEY = env('SUPABASE_PUBLISHABLE_KEY', env('SUPABASE_ANON_KEY', env('VITE_SUPABASE_PUBLISHABLE_KEY', env('VITE_SUPABASE_ANON_KEY'))))
const SERVICE_KEY = env('SUPABASE_SECRET_KEY', env('SUPABASE_SERVICE_ROLE_KEY'))
const DEFAULT_NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org'
const UPSTREAM_TIMEOUT_MS = 6000
const LIMITER_TIMEOUT_MS = 4000
const MAX_UPSTREAM_RESPONSE_BYTES = 64 * 1024

function supabaseHeaders(key, authorization = '', extra = {}) {
  const headers = { apikey: key, ...extra }
  if (authorization) headers.Authorization = authorization
  else if (!/^sb_(?:publishable|secret)_/.test(key)) headers.Authorization = `Bearer ${key}`
  return headers
}

function normalizedNominatimBase(raw) {
  try {
    const url = new URL(String(raw || '').trim())
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return ''
    const path = url.pathname.replace(/\/+$/, '')
    return `${url.origin}${path}`
  } catch {
    return ''
  }
}

// Keep the provider endpoint configurable so a policy/capacity change can be
// handled at deploy time without shipping a new client bundle. The configured
// endpoint must expose Nominatim's /reverse-compatible response shape.
const NOMINATIM_BASE_URL = normalizedNominatimBase(
  env('NOMINATIM_BASE_URL', DEFAULT_NOMINATIM_BASE_URL),
)

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController()
  let reader = null
  let timer
  const operation = (async () => {
    const response = await fetch(url, {
      ...init,
      redirect: 'manual',
      signal: controller.signal,
    })
    if (response.type === 'opaqueredirect' || response.status === 0
        || response.redirected || (response.status >= 300 && response.status < 400)) {
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

async function hmacHex(label, value) {
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
    encoder.encode(`${label}\u0000${value}`),
  )
  return Array.from(new Uint8Array(signature))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

function clientNetworkIdentifier(request) {
  // Vercel overwrites these forwarding headers at its managed edge. A
  // different reverse proxy must provide the same trusted-header guarantee.
  const candidate = request.headers.get('x-vercel-forwarded-for')
    || request.headers.get('x-real-ip')
    || (request.headers.get('x-forwarded-for') || '').split(',')[0]
    || 'unknown'
  return candidate.trim().slice(0, 128) || 'unknown'
}

/* Per-IP rate limit via edge_rate_hit (m082). This endpoint is anonymous
   (no JWT), so abuse — looping randomized coords, each a cache miss — would
   hammer Nominatim past its 1 req/s policy under the app's identifying UA and
   get it banned, breaking location for everyone. 40/hour per IP covers a real
   user detecting their location a handful of times. The limiter is fail-closed:
   an unavailable counter must not turn this endpoint into an unmetered proxy.
   (QA8 #14.) */
async function rateHit(bucket, max, windowSeconds) {
  if (!SUPABASE_URL || !SERVICE_KEY) return null
  try {
    const r = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/edge_rate_hit`, {
      method: 'POST',
      headers: supabaseHeaders(SERVICE_KEY, '', { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ bucket_in: bucket, max_in: max, window_secs_in: windowSeconds }),
    }, LIMITER_TIMEOUT_MS)
    if (!r.ok) return null
    const decision = await r.json().catch(() => null)
    if (decision === true) return true
    if (decision === false) return false
    return null
  } catch {
    return null
  }
}

function rateLimited(headers, retryAfter) {
  return new Response(JSON.stringify({ error: 'rate_limited' }), {
    status: 429,
    headers: { ...headers, 'Retry-After': String(retryAfter) },
  })
}

const ADDRESS_FIELDS = [
  'building', 'amenity', 'shop', 'university', 'school',
  'road', 'street', 'pedestrian',
  'neighbourhood', 'suburb', 'city', 'town', 'village', 'hamlet',
  'county', 'state', 'region',
]

function safeAddress(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result = {}
  for (const field of ADDRESS_FIELDS) {
    if (typeof value[field] === 'string') result[field] = value[field].slice(0, 256)
  }
  return result
}

export default async function handler(request) {
  const deploymentError = deploymentBoundaryResponse(evaluateDeploymentBoundary({ supabaseUrl: SUPABASE_URL }))
  if (deploymentError) return deploymentError
  const origin = request.headers.get('origin') || ''
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'private, no-store, max-age=0',
    'CDN-Cache-Control': 'no-store',
    'Vercel-CDN-Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...cors(origin),
  }

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (!['GET', 'POST'].includes(request.method)) {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers })
  }

  let body = null, check = null, userId = null, sessionId = null
  if (request.method === 'POST') {
    // Bound streaming request bytes even when Content-Length is omitted.
    const reader = request.body?.getReader(); let bytes = 0; const chunks = []
    let bodyTimer
    try {
      if (!reader) throw new Error('empty')
      await Promise.race([
        (async () => {
          while (true) {
            const part = await reader.read(); if (part.done) break
            bytes += part.value.byteLength
            if (bytes > 2048) { void reader.cancel().catch(() => {}); throw new Error('large') }
            chunks.push(part.value)
          }
        })(),
        new Promise((_, reject) => {
          bodyTimer = setTimeout(() => {
            void reader.cancel().catch(() => {})
            reject(new Error('body_timeout'))
          }, 4000)
        }),
      ])
      const joined = new Uint8Array(bytes); let at = 0
      for (const part of chunks) { joined.set(part, at); at += part.byteLength }
      body = JSON.parse(new TextDecoder().decode(joined))
    } catch { return new Response(JSON.stringify({ error: 'invalid_request' }), { status: 400, headers }) }
    finally { clearTimeout(bodyTimer) }
    check = streetCheckInput(body)
    if (!check) return new Response(JSON.stringify({ error: 'fresh_accurate_fix_required' }), { status: 422, headers })
    const bearer = request.headers.get('authorization') || ''
    if (!/^Bearer [^\s]+$/i.test(bearer) || !ANON_KEY) return new Response('{}', { status: 401, headers })
    try {
      const auth = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/user`, { headers: supabaseHeaders(ANON_KEY, bearer) }, LIMITER_TIMEOUT_MS)
      const user = auth.ok ? await auth.json() : null
      userId = user?.id; sessionId = verifiedSessionId(bearer, userId)
    } catch { /* fail closed */ }
    if (!userId || !sessionId) return new Response('{}', { status: 401, headers })
  }
  const params = new URL(request.url).searchParams
  const latRaw = body ? body.lat : params.get('lat')
  const lonRaw = body ? body.lon : params.get('lon')
  // Require the params to be PRESENT — Number(null) is 0 (finite), so a
  // param-less GET used to sail through as (0,0). (QA8 audit #14.)
  if (!['string','number'].includes(typeof latRaw) || !['string','number'].includes(typeof lonRaw)
      || String(latRaw).trim() === '' || String(lonRaw).trim() === '') {
    return new Response(JSON.stringify({ error: 'bad_coords' }), { status: 400, headers })
  }
  const lat = Number(latRaw)
  const lon = Number(lonRaw)
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return new Response(JSON.stringify({ error: 'bad_coords' }), { status: 400, headers })
  }

  if (!NOMINATIM_BASE_URL) {
    return new Response(JSON.stringify({ error: 'geocoder_unavailable' }), { status: 503, headers })
  }

  // Store only an HMAC-pseudonymized network signal in the limiter table; raw
  // IP addresses are not needed to enforce this anonymous abuse boundary.
  let networkKey
  try {
    networkKey = await hmacHex('geocode-network', clientNetworkIdentifier(request))
  } catch {
    return new Response(JSON.stringify({ error: 'rate_limit_unavailable' }), { status: 503, headers })
  }

  if (check) {
    const allowed = await rateHit(`geocode:account:${userId}`, 20, 3600)
    if (allowed !== true) return allowed === false ? rateLimited(headers, 3600) : new Response('{}', { status: 503, headers })
  }
  const perNetworkAllowed = await rateHit(`geocode:network:${networkKey}`, 40, 3600)
  if (perNetworkAllowed === null) {
    return new Response(JSON.stringify({ error: 'rate_limit_unavailable' }), { status: 503, headers })
  }
  if (!perNetworkAllowed) return rateLimited(headers, 3600)

  // Nominatim's public service limit is application-wide, not per visitor.
  // The shared database bucket serializes all edge instances and guarantees
  // that provider calls start at least one second apart.
  const globalAllowed = await rateHit('geocode:global:nominatim', 1, 1)
  if (globalAllowed === null) {
    return new Response(JSON.stringify({ error: 'rate_limit_unavailable' }), { status: 503, headers })
  }
  if (!globalAllowed) return rateLimited(headers, 1)

  // Enforce the same approximately 100 m grid as the client. This prevents a
  // caller from bypassing the privacy boundary by invoking the API directly.
  const providerLat = lat.toFixed(3)
  const providerLon = lon.toFixed(3)
  const url = new URL(`${NOMINATIM_BASE_URL}/reverse`)
  url.search = new URLSearchParams({
    lat: providerLat,
    lon: providerLon,
    format: 'json',
    // Street/campus-area precision matches the rounded coordinate; asking for
    // a building-level result would imply accuracy that was deliberately
    // discarded above.
    zoom: '16',
    addressdetails: '1',
    email: 'help@illinimarket.com',
  }).toString()

  try {
    const r = await fetchWithTimeout(url, {
      headers: {
        // The actual fix — a real User-Agent the browser can't send. Names
        // the app + a contact, per Nominatim's usage policy.
        'User-Agent': 'IlliniMarket/1.0 (+https://illinimarket.com; help@illinimarket.com)',
        'Accept-Language': 'en',
      },
    }, UPSTREAM_TIMEOUT_MS)
    if (!r.ok) {
      return new Response(JSON.stringify({ error: 'geocoder_status', status: r.status }), { status: 502, headers })
    }
    const data = await r.json().catch(() => null)
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return new Response(JSON.stringify({ error: 'invalid_geocoder_response' }), { status: 502, headers })
    }
    const address = safeAddress(data.address)
    // Do not forward the provider's full address (door/unit/postcode included).
    // Preserve the response field for older clients, but derive it from the
    // same minimized area fields used for public listing autofill.
    const displayName = [
      address.road || address.street || address.pedestrian || address.neighbourhood || address.suburb,
      address.city || address.town || address.village || address.county,
    ].filter(Boolean).join(', ')
    let verification = null
    const checkedStreet = check && streetLabel(data, Number(providerLat), Number(providerLon))
    if (checkedStreet) {
      try {
        const issued = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/issue_street_location_check`, {
          method: 'POST', headers: supabaseHeaders(SERVICE_KEY, '', { 'Content-Type': 'application/json' }),
          body: JSON.stringify({ user_id_in: userId, session_id_in: sessionId, item_id_in: check.itemId, street_label_in: checkedStreet }),
        }, LIMITER_TIMEOUT_MS)
        verification = issued.ok ? await issued.json().catch(() => null) : null
      } catch { /* Autofill remains useful without a verification badge. */ }
    }
    return new Response(
      JSON.stringify({ address, display_name: displayName, ...(check ? { verification } : {}) }),
      {
        status: 200,
        headers,
      },
    )
  } catch {
    return new Response(JSON.stringify({ error: 'timeout_or_network' }), { status: 504, headers })
  }
}
