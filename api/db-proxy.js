import { deploymentBoundaryResponse, evaluateDeploymentBoundary } from './_deployment-boundary.js'

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
const SUPABASE_ANON_KEY = env(
  'SUPABASE_PUBLISHABLE_KEY',
  env('SUPABASE_ANON_KEY', env('VITE_SUPABASE_PUBLISHABLE_KEY', env('VITE_SUPABASE_ANON_KEY', ''))),
)

const FORWARD_HEADERS = ['apikey', 'authorization', 'content-type', 'prefer', 'content-profile', 'accept', 'x-client-info']
const MAX_PROXY_PATH_LENGTH = 8192
const MAX_REQUEST_BYTES = 256 * 1024
const MAX_RESPONSE_BYTES = 1024 * 1024
const UPSTREAM_TIMEOUT_MS = 10_000
const STREAM_TIMEOUT_MS = 10_000

async function readBoundedText(stream, declaredLength, maxBytes) {
  if (declaredLength != null) {
    if (!/^\d+$/.test(declaredLength)) throw new Error('bad_length')
    if (Number(declaredLength) > maxBytes) throw new Error('body_too_large')
  }
  if (!stream) return ''
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let text = ''
  let timer
  const consume = (async () => {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        void reader.cancel().catch(() => {})
        throw new Error('body_too_large')
      }
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  })()
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      void reader.cancel().catch(() => {})
      reject(new Error('body_timeout'))
    }, STREAM_TIMEOUT_MS)
  })
  try {
    return await Promise.race([consume, timeout])
  } finally {
    clearTimeout(timer)
  }
}

async function fetchWithTimeout(input, init) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    return await fetch(input, { ...init, signal: controller.signal, redirect: 'error' })
  } finally {
    clearTimeout(timer)
  }
}

function postgrestTarget(rawPath) {
  if (
    !rawPath
    || rawPath.length > MAX_PROXY_PATH_LENGTH
    || /[\u0000-\u001f\u007f\\#]/.test(rawPath)
  ) return null

  const queryAt = rawPath.indexOf('?')
  const rawPathname = queryAt >= 0 ? rawPath.slice(0, queryAt) : rawPath
  // The mini-program adapter supplies URL.pathname verbatim; legitimate table
  // and RPC paths never require percent escapes. Reject them in the pathname
  // so %2e%2e / %2f cannot be decoded or normalized by a downstream proxy
  // into /auth/v1 or /storage/v1 after this check.
  if (!rawPathname.startsWith('/rest/v1/') || rawPathname.includes('%')) return null

  try {
    const base = new URL(SUPABASE_URL)
    const target = new URL(rawPath, base)
    if (target.origin !== base.origin || !target.pathname.startsWith('/rest/v1/')) return null
    return target.toString()
  } catch {
    return null
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

export default async function handler(request) {
  const deploymentError = deploymentBoundaryResponse(evaluateDeploymentBoundary({ supabaseUrl: SUPABASE_URL }))
  if (deploymentError) return deploymentError
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return json({ error: 'not_configured' }, 503)

  const method = (request.headers.get('x-mp-method') || '').toUpperCase()
  if (method !== 'PATCH') return json({ error: 'bad_method' }, 400)

  const path = request.headers.get('x-mp-path') || ''
  const target = postgrestTarget(path)
  if (!target) return json({ error: 'bad_path' }, 400)

  const headers = {}
  for (const h of FORWARD_HEADERS) {
    const v = request.headers.get(h)
    if (v) headers[h] = v
  }
  // The tunnel is only for this bundle's publishable key + caller JWT. Requiring
  // both avoids turning it into an anonymous generic PostgREST relay while RLS
  // still evaluates the exact caller identity upstream.
  if (headers['apikey'] !== SUPABASE_ANON_KEY) return json({ error: 'bad_apikey' }, 401)
  if (!/^Bearer\s+\S+$/i.test(headers.authorization || '')) {
    return json({ error: 'auth_required' }, 401)
  }
  if (!/^application\/json(?:\s*;|$)/i.test(headers['content-type'] || '')) {
    return json({ error: 'unsupported_content_type' }, 415)
  }

  let bodyText
  try {
    bodyText = await readBoundedText(
      request.body,
      request.headers.get('content-length'),
      MAX_REQUEST_BYTES,
    )
    const body = JSON.parse(bodyText)
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error('bad_json')
  } catch (error) {
    if (error?.message === 'body_too_large') return json({ error: 'body_too_large' }, 413)
    return json({ error: 'bad_json' }, 400)
  }

  let upstream
  try {
    upstream = await fetchWithTimeout(target, {
      method: 'PATCH',
      headers,
      body: bodyText,
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
  let responseText
  try {
    responseText = await readBoundedText(
      upstream.body,
      upstream.headers.get('content-length'),
      MAX_RESPONSE_BYTES,
    )
  } catch {
    return json({ error: 'upstream_response_too_large' }, 502)
  }
  return new Response(responseText, { status: upstream.status, headers: respHeaders })
}
