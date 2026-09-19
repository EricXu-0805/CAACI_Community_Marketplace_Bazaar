import { evaluateDeploymentBoundary, deploymentBoundaryResponse } from './_deployment-boundary.js'
import { fetchBounded, normalizeSupabaseOrigin } from './_http-boundary.js'

export const config = { runtime: 'edge' }
export const SOURCES = new Set(['caaci', 'wechat_students', 'wechat_local', 'xiaohongshu', 'facebook', 'reddit', 'instagram', 'x', 'linkedin'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const reply = (status = 204) => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } })
function supabaseHeaders(key, authorization = '', extra = {}) {
  const headers = { apikey: key, ...extra }
  if (authorization) headers.Authorization = authorization
  else if (!/^sb_(?:publishable|secret)_/.test(key)) headers.Authorization = `Bearer ${key}`
  return headers
}

export async function smallBody(request) {
  if (Number(request.headers.get('content-length')) > 512) throw Error('body_limit')
  const reader = request.body?.getReader()
  if (!reader) throw Error('body_missing')
  let timer
  try {
    const body = (async () => {
      const parts = []; let size = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 512) throw Error('body_limit')
        parts.push(value)
      }
      const bytes = new Uint8Array(size); let offset = 0
      for (const part of parts) { bytes.set(part, offset); offset += part.byteLength }
      return JSON.parse(new TextDecoder().decode(bytes))
    })()
    return await Promise.race([body, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('body_timeout')), 1500) })])
  } finally { clearTimeout(timer); void reader.cancel().catch(() => {}) }
}

export default async function handler(request) {
  const boundary = evaluateDeploymentBoundary({ supabaseUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL })
  if (!boundary.ok) return deploymentBoundaryResponse(boundary)
  if (request.method !== 'POST') return reply(405)
  const env = process.env
  if (env.ACQUISITION_ENABLED !== 'true') return reply()
  const origin = normalizeSupabaseOrigin(env.SUPABASE_URL || env.VITE_SUPABASE_URL)
  // Preview traffic must not inflate the live acquisition report.
  if (!['production', 'test'].includes(boundary.environment)) return reply()
  if (request.headers.get('origin') !== new URL(request.url).origin) return reply(403)
  if (request.headers.get('sec-gpc') === '1' || request.headers.get('dnt') === '1') return reply()
  const service = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY
  const publicKey = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY
  if (!origin || !service || !publicKey) return reply(503)
  let data
  try { data = await smallBody(request) } catch { return reply(400) }
  if (!data || !SOURCES.has(data.source) || !UUID.test(data.visit_id || '') || !['visit', 'signup'].includes(data.event)
    || Object.keys(data).some(k => !['event', 'source', 'visit_id'].includes(k))) return reply(400)
  const call = async (path, key, body, authorization) => {
    const r = await fetchBounded(fetch, `${origin}${path}`, {
      method: body ? 'POST' : 'GET', headers: supabaseHeaders(key, authorization, { 'Content-Type': 'application/json' }),
      ...(body ? { body: JSON.stringify(body) } : {}),
    }, { timeoutMs: 2500, maxBytes: 32 * 1024 })
    if (!r.ok) throw Error('upstream_failed')
    return r.bytes.byteLength ? await r.json() : null
  }
  try {
    const network = (request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-real-ip') || 'unknown').slice(0, 128)
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(service), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const hash = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`growth:${new Date().toISOString().slice(0, 10)}:${network}`))
    const bucket = 'growth:' + [...new Uint8Array(hash)].map(v => v.toString(16).padStart(2, '0')).join('')
    if (await call('/rest/v1/rpc/edge_rate_hit', service, { bucket_in: bucket, max_in: 120, window_secs_in: 60 }) !== true) return reply(429)
    let userId = null
    if (data.event === 'signup') {
      const authorization = request.headers.get('authorization') || ''
      if (!/^Bearer [^\s]+$/i.test(authorization)) return reply(401)
      const user = await call('/auth/v1/user', publicKey, null, authorization)
      if (typeof user?.id !== 'string') return reply(401)
      userId = user.id
    }
    await call('/rest/v1/rpc/record_acquisition', service, { visit_in: data.visit_id, source_in: data.source, user_in: userId })
    return reply()
  } catch { return reply(503) }
}
