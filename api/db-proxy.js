export const config = { runtime: 'edge' }

/*
 * PATCH tunnel for WeChat mini-program PostgREST updates.
 *
 * wx.request's documented method list is OPTIONS/GET/HEAD/POST/PUT/DELETE/
 * TRACE/CONNECT — no PATCH. supabase-js issues every .update() as HTTP
 * PATCH, so on real devices profile edits, listing edits, mark-sold and
 * is_read updates all die in the transport (DevTools is permissive, phones
 * are not). mpFetch rewrites those calls to:
 *
 *   POST /api/db-proxy
 *     x-mp-method: PATCH            (only PATCH is accepted)
 *     x-mp-path:   /rest/v1/...     (only PostgREST paths are accepted)
 *     apikey / authorization / content-type / prefer / content-profile:
 *       forwarded VERBATIM from the caller
 *
 * and this function re-issues the request as a real PATCH against our
 * Supabase project. Security posture: the caller's own anon key + JWT are
 * forwarded unchanged — PostgREST evaluates RLS exactly as if the client
 * had reached it directly (which the same client already can, on H5).
 * No service key is ever involved, the target host is pinned to our
 * SUPABASE_URL, and only /rest/v1/ paths pass — this endpoint grants no
 * capability beyond what a direct PostgREST call already allows.
 */

function env(name, fallback) {
  return process.env[name] || fallback
}

const SUPABASE_URL = env('SUPABASE_URL', env('VITE_SUPABASE_URL', ''))

const FORWARD_HEADERS = ['apikey', 'authorization', 'content-type', 'prefer', 'content-profile', 'accept', 'x-client-info']

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!SUPABASE_URL) return json({ error: 'not_configured' }, 503)

  const method = (request.headers.get('x-mp-method') || '').toUpperCase()
  if (method !== 'PATCH') return json({ error: 'bad_method' }, 400)

  const path = request.headers.get('x-mp-path') || ''
  // PostgREST only. Reject anything that could re-target the request:
  // no protocol smuggling, no path traversal, no auth/storage endpoints.
  if (!path.startsWith('/rest/v1/') || path.includes('..') || path.includes('://')) {
    return json({ error: 'bad_path' }, 400)
  }

  const headers = {}
  for (const h of FORWARD_HEADERS) {
    const v = request.headers.get(h)
    if (v) headers[h] = v
  }
  if (!headers['apikey']) return json({ error: 'missing_apikey' }, 401)

  let upstream
  try {
    upstream = await fetch(`${SUPABASE_URL}${path}`, {
      method: 'PATCH',
      headers,
      body: await request.text(),
    })
  } catch {
    return json({ error: 'upstream_unreachable' }, 502)
  }

  const respHeaders = { 'Cache-Control': 'no-store' }
  const ct = upstream.headers.get('content-type')
  if (ct) respHeaders['Content-Type'] = ct
  const range = upstream.headers.get('content-range')
  if (range) respHeaders['Content-Range'] = range

  // 204 (Prefer: return=minimal) must not carry a body.
  if (upstream.status === 204) return new Response(null, { status: 204, headers: respHeaders })
  return new Response(await upstream.text(), { status: upstream.status, headers: respHeaders })
}
