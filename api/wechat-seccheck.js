import { deploymentBoundaryResponse, evaluateDeploymentBoundary } from './_deployment-boundary.js'

export const config = { runtime: 'edge' }

/*
 * /api/wechat-seccheck — WeChat content-security gate for the mini-program.
 *
 * Store review requires machine moderation the reviewer can trigger: they
 * paste violating text and upload violating images expecting interception.
 * Our keyword table (moderation_keywords) covers scam/portal phrases, not
 * the porn/politics vocabulary reviewers actually test with — WeChat's own
 * free classifiers do. mp clients call this endpoint:
 *
 *   POST { kind: 'text',  content, scene, js_code? }
 *     → msg_sec_check v2 (synchronous verdict; caller blocks the insert
 *       when suggest === 'risky')
 *   POST { kind: 'image', media_url, bucket, storage_path, js_code? }
 *     → media_check_async v2 (async; trace_id → storage mapping recorded in
 *       wechat_media_checks (m087) so /api/wechat-callback can take a
 *       violating object down when WeChat pushes the verdict)
 *
 * openid: msg_sec_check v2 requires the openid of a user who opened the mp
 * within 2h. The current JWT user's profiles.wechat_openid is authoritative.
 * Only when that trusted binding is null do email-login users' fresh wx.login
 * js_code values get exchanged here (jscode2session — same call wechat-login
 * makes, no IP whitelist). Client-supplied openid values are never trusted,
 * and the stable identifier is never echoed back to browser storage.
 *
 * A fully disabled integration (both WeChat credentials absent) returns an
 * explicit not_configured degradation. Once either credential is configured,
 * the boundary is fail-closed: partial config, timeout, redirect, non-2xx,
 * malformed provider JSON, unknown verdict, or missing media trace all return
 * non-2xx and the client blocks the write / cleans the candidate upload.
 *
 * ⚠ Ops prerequisite: fetching access_token (stable_token) honors the mp
 * console IP whitelist. Vercel egress IPs are dynamic, so the whitelist
 * switch must be OFF (公众平台 → 开发管理 → 开发设置 → IP白名单).
 *
 * Env: WECHAT_APPID / WECHAT_APPSECRET (same as /api/auth/wechat-login),
 *      WECHAT_MEDIA_ASYNC_ENABLED must be exactly "true" to enqueue images.
 *      WECHAT_PUSH_TOKEN / WECHAT_ENCODING_AES_KEY must also form a valid
 *      security-mode callback configuration. Set the flag only after a
 *      real-provider encrypted callback and retry canary.
 *      SUPABASE_URL / SUPABASE_SECRET_KEY / SUPABASE_PUBLISHABLE_KEY.
 *      Legacy service-role / anon variable names remain rolling fallbacks.
 */

function env(name, fallback) {
  return process.env[name] || fallback
}

const WECHAT_APPID     = env('WECHAT_APPID', '')
const WECHAT_APPSECRET = env('WECHAT_APPSECRET', '')
const WECHAT_PUSH_TOKEN = env('WECHAT_PUSH_TOKEN', '')
const WECHAT_ENCODING_AES_KEY = env('WECHAT_ENCODING_AES_KEY', '')
const WECHAT_MEDIA_ASYNC_ENABLED = process.env.WECHAT_MEDIA_ASYNC_ENABLED === 'true'
const SUPABASE_URL     = env('SUPABASE_URL', env('VITE_SUPABASE_URL', ''))
const SUPABASE_SERVICE = env('SUPABASE_SECRET_KEY', env('SUPABASE_SERVICE_ROLE_KEY', ''))
const SUPABASE_ANON = env(
  'SUPABASE_PUBLISHABLE_KEY',
  env('SUPABASE_ANON_KEY', env('VITE_SUPABASE_PUBLISHABLE_KEY', env('VITE_SUPABASE_ANON_KEY', ''))),
)

const MAX_REQUEST_BYTES = 16 * 1024
const MAX_PROVIDER_BYTES = 32 * 1024
const MAX_SUPABASE_BYTES = 16 * 1024
const SUPABASE_TIMEOUT_MS = 5_000
const WECHAT_TIMEOUT_MS = 5_000
const STREAM_TIMEOUT_MS = 5_000
const MAX_TEXT_CHARS = 2_500
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function supabaseHeaders(key, authorization = '', extra = {}) {
  const headers = { apikey: key, ...extra }
  if (authorization) headers.Authorization = authorization
  else if (!/^sb_(?:publishable|secret)_/.test(key)) headers.Authorization = `Bearer ${key}`
  return headers
}

function responseHeaders() {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(),
  })
}

async function readBoundedText(stream, declaredLength, maxBytes) {
  if (declaredLength != null) {
    if (!/^\d+$/.test(declaredLength)) throw new Error('bad_length')
    if (Number(declaredLength) > maxBytes) throw new Error('body_too_large')
  }
  if (!stream) throw new Error('bad_json')
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

async function readJsonBody(request) {
  const raw = await readBoundedText(
    request.body,
    request.headers.get('content-length'),
    MAX_REQUEST_BYTES,
  )
  let body
  try { body = JSON.parse(raw) } catch { throw new Error('bad_json') }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('bad_json')
  return body
}

async function readJsonResponse(response, maxBytes) {
  const raw = await readBoundedText(
    response.body,
    response.headers.get('content-length'),
    maxBytes,
  )
  const value = JSON.parse(raw)
  if (value == null) throw new Error('invalid_upstream_json')
  return value
}

async function fetchWithTimeout(input, init, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, {
      ...(init || {}),
      signal: controller.signal,
      redirect: 'error',
    })
  } finally {
    clearTimeout(timer)
  }
}

async function verifyUser(bearer) {
  if (!/^Bearer\s+[^\s]+$/i.test(bearer || '') || !SUPABASE_URL || !SUPABASE_ANON) return null
  try {
    const r = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/user`, {
      headers: supabaseHeaders(SUPABASE_ANON, bearer),
    }, SUPABASE_TIMEOUT_MS)
    if (!r.ok) return null
    const u = await readJsonResponse(r, MAX_SUPABASE_BYTES)
    return UUID_RE.test(u?.id || '') ? u.id : null
  } catch {
    return null
  }
}

/* Per-user rate limit via edge_rate_hit (m082). The classifier itself may
   degrade safely, but an unavailable counter must not expose a high-volume
   authenticated proxy to WeChat. Returns true/false for allowed/exhausted,
   null when the limiter cannot be trusted. */
async function rateAllowed(userId) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE) return null
  try {
    const r = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/edge_rate_hit`, {
      method: 'POST',
      headers: supabaseHeaders(SUPABASE_SERVICE, '', {
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({ bucket_in: `seccheck:${userId}`, max_in: 600, window_secs_in: 3600 }),
    }, SUPABASE_TIMEOUT_MS)
    if (!r.ok) return null
    const decision = await readJsonResponse(r, MAX_SUPABASE_BYTES).catch(() => null)
    if (decision === true) return true
    if (decision === false) return false
    return null
  } catch {
    return null
  }
}

/*
 * stable_token: unlike /cgi-bin/token it never invalidates previously
 * issued tokens, so concurrent fetches from parallel edge isolates are
 * safe. Module-scope cache survives warm invocations within an isolate;
 * cold isolates just fetch again.
 */
let tokenCache = { token: '', expiresAt: 0 }

async function getAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token
  const r = await fetchWithTimeout('https://api.weixin.qq.com/cgi-bin/stable_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credential', appid: WECHAT_APPID, secret: WECHAT_APPSECRET }),
  }, WECHAT_TIMEOUT_MS)
  if (!r.ok) throw new Error('stable_token_unavailable')
  const data = await readJsonResponse(r, MAX_PROVIDER_BYTES)
  if (
    !data || typeof data !== 'object' || Array.isArray(data)
    || typeof data.access_token !== 'string'
    || data.access_token.length < 16 || data.access_token.length > 4096
    || !Number.isInteger(data.expires_in)
    || data.expires_in < 600 || data.expires_in > 86_400
  ) throw new Error('stable_token_invalid')
  tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 300) * 1000 }
  return tokenCache.token
}

function validWechatIdentifier(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{4,128}$/.test(value)
}

function validJsCode(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{4,256}$/.test(value)
}

async function resolveOpenid(body, userId) {
  /* Resolve the authenticated account first. A profile lookup outage must not
     fall through to attacker-controlled request identity: that would recreate
     the A -> B shared-device association this boundary exists to prevent. */
  const profileResponse = await fetchWithTimeout(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=wechat_openid&limit=1`,
    { headers: supabaseHeaders(SUPABASE_SERVICE) },
    SUPABASE_TIMEOUT_MS,
  )
  if (!profileResponse.ok) throw new Error('profile_identity_unavailable')
  const rows = await readJsonResponse(profileResponse, MAX_SUPABASE_BYTES)
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('profile_identity_unavailable')

  const boundOpenid = rows[0]?.wechat_openid
  if (boundOpenid != null) {
    if (!validWechatIdentifier(boundOpenid)) throw new Error('profile_identity_invalid')
    return boundOpenid
  }

  /* An unbound email account may use only a fresh one-time wx.login code.
     Legacy body.openid is deliberately ignored, even when present. */
  if (!validJsCode(body.js_code)) throw new Error('fresh_wechat_code_required')
  const r = await fetchWithTimeout(
    `https://api.weixin.qq.com/sns/jscode2session?appid=${WECHAT_APPID}&secret=${WECHAT_APPSECRET}&js_code=${encodeURIComponent(body.js_code)}&grant_type=authorization_code`,
    undefined,
    WECHAT_TIMEOUT_MS,
  )
  if (!r.ok) throw new Error('wechat_identity_exchange_unavailable')
  const data = await readJsonResponse(r, MAX_PROVIDER_BYTES)
  if (data?.errcode || !validWechatIdentifier(data?.openid)) {
    throw new Error('wechat_identity_exchange_failed')
  }
  return data.openid
}

function configuredState() {
  if (!WECHAT_APPID && !WECHAT_APPSECRET) return 'disabled'
  if (!WECHAT_APPID || !WECHAT_APPSECRET) return 'invalid'
  return 'configured'
}

function secureMediaCallbackConfigured() {
  let aesKeyValid = false
  try {
    const decoded = atob(`${WECHAT_ENCODING_AES_KEY}=`)
    aesKeyValid = /^[A-Za-z0-9+/]{43}$/.test(WECHAT_ENCODING_AES_KEY)
      && decoded.length === 32
      && btoa(decoded) === `${WECHAT_ENCODING_AES_KEY}=`
  } catch {}
  return /^wx[0-9a-f]{16}$/i.test(WECHAT_APPID)
    && WECHAT_PUSH_TOKEN.length >= 1
    && WECHAT_PUSH_TOKEN.length <= 256
    && !/[\u0000-\u001f\u007f]/.test(WECHAT_PUSH_TOKEN)
    && aesKeyValid
}

function validTraceId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{4,128}$/.test(value)
}

function textVerdict(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  if (data.errcode === 87014) return { ok: false, suggest: 'risky' }
  if (data.errcode !== 0) return null
  if (!data.result || typeof data.result !== 'object' || Array.isArray(data.result)) return null
  const suggest = data.result.suggest
  if (!['pass', 'review', 'risky'].includes(suggest)) return null
  if (suggest === 'pass') return { ok: true, suggest }
  const label = Number.isSafeInteger(data.result.label) && data.result.label >= 0
    ? data.result.label
    : 0
  return { ok: false, suggest, label }
}

async function callWechatJson(url, init) {
  const response = await fetchWithTimeout(url, init, WECHAT_TIMEOUT_MS)
  if (!response.ok) throw new Error('wechat_provider_non_2xx')
  return await readJsonResponse(response, MAX_PROVIDER_BYTES)
}

export default async function handler(request) {
  const deploymentError = deploymentBoundaryResponse(evaluateDeploymentBoundary({ supabaseUrl: SUPABASE_URL }))
  if (deploymentError) return deploymentError
  if (request.method === 'OPTIONS') return json({}, 200)
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const userId = await verifyUser(request.headers.get('authorization'))
  if (!userId) return json({ error: 'unauthorized' }, 401)
  const integrationState = configuredState()
  if (integrationState === 'disabled') {
    return json({ ok: true, degraded: true, reason: 'not_configured' })
  }
  if (integrationState === 'invalid') {
    return json({ error: 'wechat_misconfigured' }, 503)
  }
  const allowed = await rateAllowed(userId)
  if (allowed === null) return json({ error: 'rate_limit_unavailable' }, 503)
  if (!allowed) return json({ error: 'rate_limited' }, 429)

  let body
  try {
    body = await readJsonBody(request)
  } catch (error) {
    if (error?.message === 'body_timeout') return json({ error: 'body_timeout' }, 408)
    return json(
      { error: error?.message === 'body_too_large' ? 'body_too_large' : 'bad_json' },
      error?.message === 'body_too_large' ? 413 : 400,
    )
  }

  if (body.kind !== 'text' && body.kind !== 'image') {
    return json({ error: 'bad_kind' }, 400)
  }
  /* AppSecret also powers login and synchronous text moderation. Keep those
     available while media async remains fail-closed by default. */
  if (body.kind === 'image' && !WECHAT_MEDIA_ASYNC_ENABLED) {
    return json({ error: 'wechat_media_async_disabled' }, 503)
  }
  if (body.kind === 'image' && !secureMediaCallbackConfigured()) {
    return json({ error: 'wechat_media_async_misconfigured' }, 503)
  }

  let content = ''
  let media = null
  if (body.kind === 'text') {
    if (typeof body.content !== 'string') return json({ error: 'bad_content' }, 400)
    if (body.content.length > MAX_TEXT_CHARS) return json({ error: 'content_too_large' }, 400)
    content = body.content
    if (!content.trim()) return json({ ok: true, suggest: 'pass' })
  } else {
    if (typeof body.media_url !== 'string') return json({ error: 'bad_media_url' }, 400)
    const mediaUrl = body.media_url
    const ownPrefix = `${SUPABASE_URL}/storage/v1/object/public/item-images/items/${userId}/`
    if (!mediaUrl.startsWith(ownPrefix)) return json({ error: 'bad_media_url' }, 400)
    const fileName = mediaUrl.slice(ownPrefix.length).split('?')[0].split('#')[0]
    if (!fileName || !/^[A-Za-z0-9._-]+$/.test(fileName) || fileName.includes('..')) {
      return json({ error: 'bad_media_url' }, 400)
    }
    media = {
      mediaUrl,
      bucket: 'item-images',
      storagePath: `items/${userId}/${fileName}`,
    }
  }

  let openid
  try {
    openid = await resolveOpenid(body, userId)
  } catch {
    return json({ error: 'wechat_identity_unavailable' }, 503)
  }

  try {
    const token = await getAccessToken()

    if (body.kind === 'text') {
      const scene = [1, 2, 3, 4].includes(body.scene) ? body.scene : 3
      const data = await callWechatJson(`https://api.weixin.qq.com/wxa/msg_sec_check?access_token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: 2, openid, scene, content }),
      })
      const verdict = textVerdict(data)
      if (!verdict) throw new Error('wechat_verdict_invalid')
      return json(verdict)
    }

    if (body.kind === 'image') {
      const data = await callWechatJson(`https://api.weixin.qq.com/wxa/media_check_async?access_token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: 2,
          openid,
          scene: 1,
          media_type: 2,
          media_url: media.mediaUrl,
        }),
      })
      if (!data || typeof data !== 'object' || Array.isArray(data)
        || data.errcode !== 0 || !validTraceId(data.trace_id)) {
        throw new Error('wechat_media_response_invalid')
      }
      /* Record trace → object so the push callback can act on the verdict.
         A dropped mapping is a silent moderation hole: WeChat later pushes a
         risky verdict keyed only by trace_id. Do not acknowledge a submission
         whose durable handoff could not be recorded; the caller can retry. */
      let mapRes
      try {
        mapRes = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/wechat_media_checks`, {
          method: 'POST',
          headers: supabaseHeaders(SUPABASE_SERVICE, '', {
            'Content-Type': 'application/json',
            Prefer: 'resolution=ignore-duplicates',
          }),
          body: JSON.stringify({
            trace_id: data.trace_id,
            bucket: media.bucket,
            storage_path: media.storagePath,
            user_id: userId,
          }),
        }, SUPABASE_TIMEOUT_MS)
      } catch {
        console.error('wechat-seccheck: media_check mapping insert failed')
        return json({ error: 'media_mapping_unavailable' }, 503)
      }
      if (!mapRes.ok) {
        console.error(`wechat-seccheck: media_check mapping insert failed (${mapRes.status})`)
        return json({ error: 'media_mapping_unavailable' }, 503)
      }
      return json({ ok: true, trace_id: data.trace_id })
    }
  } catch {
    return json({ error: 'wechat_provider_unavailable' }, 503)
  }
}
