import { deploymentBoundaryResponse, evaluateDeploymentBoundary } from '../_deployment-boundary.js'

export const config = { runtime: 'edge' }

/*
 * /api/auth/wechat-login — mp-weixin silent sign-in endpoint.
 *
 * Passwordless custom-provider flow (v4):
 *
 *   1. The mini program obtains a single-use js_code with wx.login().
 *   2. This endpoint applies a fail-closed atomic network limit before
 *      contacting WeChat. Limiter keys are HMAC-pseudonymized; raw IPs and
 *      js_codes are never written to the limiter table.
 *   3. WeChat exchanges js_code for openid/unionid server-side, followed by a
 *      second fail-closed limit on the pseudonymized identity.
 *   4. Supabase Admin generate_link(type=magiclink) creates or reuses the
 *      deterministic placeholder-email user and returns a one-time token hash.
 *   5. /auth/v1/verify exchanges that token hash for a real access/refresh
 *      session. No email is sent and this endpoint creates, retrieves and
 *      returns no reusable plaintext password.
 *   6. The service role binds the verified WeChat identity to the same profile
 *      id before the session is returned.
 *
 * This is the server-side custom-provider flow implemented by the installed
 * @supabase/auth-js client: admin.generateLink() calls /admin/generate_link,
 * and verifyOtp({ token_hash, type }) calls /verify. Existing password-era
 * WeChat users keep the same deterministic email, so they transition on their
 * next login without reading or mutating public.wechat_password_map.
 * Deployment cleanup must separately rotate legacy Auth passwords and purge
 * that historical table; switching this endpoint alone cannot invalidate
 * credentials exposed by an old database dump or backup.
 *
 * Required server-only environment variables:
 *   WECHAT_APPID, WECHAT_APPSECRET, SUPABASE_URL,
 *   SUPABASE_SECRET_KEY, SUPABASE_PUBLISHABLE_KEY
 * Legacy SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY remain rolling fallbacks.
 */

const MAX_BODY_BYTES = 2 * 1024
const RATE_WINDOW_SECONDS = 10 * 60
const RATE_IP_MAX = 30
const RATE_IDENTITY_MAX = 20
const UPSTREAM_TIMEOUT_MS = 8_000
const UPSTREAM_RESPONSE_MAX_BYTES = 256 * 1024
const REQUEST_BODY_TIMEOUT_MS = 5_000
const VERIFY_ATTEMPTS = 2
const AUTH_API_VERSION = '2024-01-01'

function env(name, fallback = '') {
  return String(process.env[name] || fallback).trim()
}

const WECHAT_APPID = env('WECHAT_APPID')
const WECHAT_APPSECRET = env('WECHAT_APPSECRET')
const SUPABASE_URL_RAW = env('SUPABASE_URL', env('VITE_SUPABASE_URL'))
const SUPABASE_SERVICE = env('SUPABASE_SECRET_KEY', env('SUPABASE_SERVICE_ROLE_KEY'))
const SUPABASE_ANON = env(
  'SUPABASE_PUBLISHABLE_KEY',
  env('SUPABASE_ANON_KEY', env('VITE_SUPABASE_PUBLISHABLE_KEY', env('VITE_SUPABASE_ANON_KEY'))),
)

function normalizedSupabaseOrigin(raw) {
  try {
    const url = new URL(raw)
    const localHttp = url.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (url.protocol !== 'https:' && !localHttp) return ''
    if (url.username || url.password || url.search || url.hash) return ''
    if (url.pathname !== '/' && url.pathname !== '') return ''
    return url.origin
  } catch {
    return ''
  }
}

const SUPABASE_URL = normalizedSupabaseOrigin(SUPABASE_URL_RAW)

function supabaseHeaders(key, authorization = '', extra = {}) {
  const headers = { apikey: key, ...extra }
  if (authorization) headers.Authorization = authorization
  else if (!/^sb_(?:publishable|secret)_/.test(key)) headers.Authorization = `Bearer ${key}`
  return headers
}

function json(body, status = 200, requestId = '') {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  }
  if (requestId) headers['X-Request-Id'] = requestId
  return new Response(JSON.stringify(body), { status, headers })
}

function requestId() {
  try { return crypto.randomUUID() } catch { return 'wechat-login' }
}

function endpointError(code, stage, status = 500, upstreamCode = '') {
  const error = new Error(code)
  error.stage = stage
  error.status = status
  error.upstreamCode = upstreamCode
  return error
}

function safeCode(value, fallback = '') {
  const text = typeof value === 'string' ? value : String(value || '')
  return /^[a-zA-Z0-9_.-]{1,80}$/.test(text) ? text : fallback
}

function logFailure(id, error) {
  // Deliberately exclude URLs, request bodies, openids, emails, tokens and
  // upstream response bodies. The request id is enough to correlate stages.
  try {
    console.error('[wechat-login] request failed', {
      request_id: id,
      stage: safeCode(error?.stage, 'unknown'),
      code: safeCode(error?.message, 'unexpected_failure'),
      upstream_code: safeCode(error?.upstreamCode),
      upstream_status: Number.isInteger(error?.upstreamStatus)
        ? error.upstreamStatus
        : undefined,
    })
  } catch {}
}

function transportError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

async function readBoundedStream(
  stream,
  maxBytes,
  timeoutMs,
  { timeoutCode, tooLargeCode, onTimeout } = {},
) {
  if (!stream) return new Uint8Array()
  const reader = stream.getReader()
  const chunks = []
  let total = 0
  let timer = null
  try {
    return await Promise.race([
      (async () => {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (!(value instanceof Uint8Array)) throw transportError('invalid_body_stream')
          total += value.byteLength
          if (total > maxBytes) {
            try { await reader.cancel() } catch {}
            throw transportError(tooLargeCode)
          }
          chunks.push(value)
        }
        const bytes = new Uint8Array(total)
        let offset = 0
        for (const chunk of chunks) {
          bytes.set(chunk, offset)
          offset += chunk.byteLength
        }
        return bytes
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          try { onTimeout?.() } catch {}
          try { void reader.cancel().catch(() => {}) } catch {}
          reject(transportError(timeoutCode))
        }, Math.max(1, timeoutMs))
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function contentLength(headers, invalidCode) {
  const raw = headers.get('content-length')
  if (raw == null || raw === '') return null
  if (!/^\d+$/.test(raw)) throw transportError(invalidCode)
  const value = Number(raw)
  if (!Number.isSafeInteger(value)) throw transportError(invalidCode)
  return value
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController()
  const startedAt = Date.now()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  let response
  try {
    // Every destination is fixed by configuration/code. Refuse redirects so a
    // compromised or misconfigured upstream cannot bounce secret-bearing
    // headers (or WeChat's AppSecret query) to another origin.
    response = await fetch(url, {
      ...init,
      cache: 'no-store',
      redirect: 'manual',
      signal: controller.signal,
    })
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'AbortError') {
      throw transportError('upstream_timeout')
    }
    throw error
  } finally {
    clearTimeout(timer)
  }

  if (response.type === 'opaqueredirect' || response.status === 0
      || response.redirected || (response.status >= 300 && response.status < 400)) {
    try { await response.body?.cancel() } catch {}
    throw transportError('upstream_redirect')
  }
  const declared = contentLength(response.headers, 'upstream_response_invalid')
  if (declared != null && declared > UPSTREAM_RESPONSE_MAX_BYTES) {
    try { await response.body?.cancel() } catch {}
    throw transportError('upstream_response_too_large')
  }

  const remainingMs = UPSTREAM_TIMEOUT_MS - (Date.now() - startedAt)
  if (remainingMs <= 0) {
    controller.abort()
    try { await response.body?.cancel() } catch {}
    throw transportError('upstream_timeout')
  }
  const bytes = await readBoundedStream(
    response.body,
    UPSTREAM_RESPONSE_MAX_BYTES,
    remainingMs,
    {
      timeoutCode: 'upstream_timeout',
      tooLargeCode: 'upstream_response_too_large',
      onTimeout: () => controller.abort(),
    },
  )
  return new Response(bytes.byteLength ? bytes : null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

async function hmacHex(label, value) {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(SUPABASE_SERVICE),
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
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function clientNetworkIdentifier(request) {
  // Vercel overwrites its forwarding headers at the managed edge. Deployments
  // behind a different proxy must verify equivalent header-rewrite behavior.
  const candidate = request.headers.get('x-vercel-forwarded-for')
    || request.headers.get('x-real-ip')
    || (request.headers.get('x-forwarded-for') || '').split(',')[0]
    || 'unknown'
  return candidate.trim().slice(0, 128) || 'unknown'
}

async function rateHit(bucket, max) {
  try {
    const response = await fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/rpc/edge_rate_hit`,
      {
        method: 'POST',
        headers: supabaseHeaders(SUPABASE_SERVICE, '', {
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          bucket_in: bucket,
          max_in: max,
          window_secs_in: RATE_WINDOW_SECONDS,
        }),
      },
    )
    if (!response.ok) return null
    const decision = await response.json().catch(() => null)
    if (decision === true) return true
    if (decision === false) return false
    return null
  } catch {
    return null
  }
}

async function enforceNetworkRateLimit(request) {
  // Do not create one persistent limiter row per js_code: codes are
  // high-cardinality and WeChat already makes them single-use. A network
  // bucket bounds pre-exchange work without turning random input into an
  // unbounded edge_rate_limits storage-amplification primitive.
  let networkKey
  try {
    networkKey = await hmacHex('network', clientNetworkIdentifier(request))
  } catch {
    throw endpointError('rate_limit_unavailable', 'rate_limit', 503)
  }

  const networkAllowed = await rateHit(`wechat-login:network:${networkKey}`, RATE_IP_MAX)
  if (networkAllowed === null) throw endpointError('rate_limit_unavailable', 'rate_limit', 503)
  if (networkAllowed === false) throw endpointError('rate_limited', 'rate_limit', 429)
}

async function enforceIdentityRateLimit(openid) {
  let identityKey
  try {
    identityKey = await hmacHex('openid', openid)
  } catch {
    throw endpointError('rate_limit_unavailable', 'rate_limit', 503)
  }
  const allowed = await rateHit(
    `wechat-login:identity:${identityKey}`,
    RATE_IDENTITY_MAX,
  )
  if (allowed === null) throw endpointError('rate_limit_unavailable', 'rate_limit', 503)
  if (allowed === false) throw endpointError('rate_limited', 'rate_limit', 429)
}

async function parseRequestBody(request) {
  let declared
  try {
    declared = contentLength(request.headers, 'invalid_content_length')
  } catch {
    throw endpointError('bad_json', 'input', 400)
  }
  if (declared != null && declared > MAX_BODY_BYTES) {
    try { await request.body?.cancel() } catch {}
    throw endpointError('body_too_large', 'input', 413)
  }
  let bytes
  try {
    bytes = await readBoundedStream(
      request.body,
      MAX_BODY_BYTES,
      REQUEST_BODY_TIMEOUT_MS,
      {
        timeoutCode: 'request_body_timeout',
        tooLargeCode: 'body_too_large',
      },
    )
  } catch (error) {
    if (error?.code === 'body_too_large') {
      throw endpointError('body_too_large', 'input', 413)
    }
    if (error?.code === 'request_body_timeout') {
      throw endpointError('request_timeout', 'input', 408)
    }
    throw endpointError('bad_json', 'input', 400)
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw endpointError('bad_json', 'input', 400)
  }
}

function sanitizeNickname(raw) {
  if (typeof raw !== 'string') return ''
  return raw
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[\u200B-\u200F\uFEFF]/g, '')
    .trim()
    .slice(0, 40)
}

function validWechatIdentifier(value) {
  return typeof value === 'string'
    && /^[A-Za-z0-9_-]{4,128}$/.test(value)
}

async function exchangeCodeForIdentity(jsCode) {
  const url = new URL('https://api.weixin.qq.com/sns/jscode2session')
  url.searchParams.set('appid', WECHAT_APPID)
  url.searchParams.set('secret', WECHAT_APPSECRET)
  url.searchParams.set('js_code', jsCode)
  url.searchParams.set('grant_type', 'authorization_code')

  let response
  try {
    response = await fetchWithTimeout(url.toString())
  } catch {
    throw endpointError('wechat_exchange_unavailable', 'wechat_exchange', 502)
  }

  let body
  try { body = await response.json() } catch {
    throw endpointError('wechat_exchange_unavailable', 'wechat_exchange', 502)
  }
  if (!response.ok) {
    const error = endpointError('wechat_exchange_unavailable', 'wechat_exchange', 502)
    error.upstreamStatus = response.status
    throw error
  }
  if (body?.errcode) {
    if (body.errcode === 45011) {
      throw endpointError('wechat_rate_limited', 'wechat_exchange', 429, '45011')
    }
    if (body.errcode === 40029 || body.errcode === 40163) {
      throw endpointError('wechat_code_rejected', 'wechat_exchange', 401, String(body.errcode))
    }
    throw endpointError(
      'wechat_exchange_failed',
      'wechat_exchange',
      502,
      safeCode(body.errcode),
    )
  }
  if (!validWechatIdentifier(body?.openid)) {
    throw endpointError('wechat_identity_invalid', 'wechat_exchange', 502)
  }
  if (body?.unionid != null && !validWechatIdentifier(body.unionid)) {
    throw endpointError('wechat_identity_invalid', 'wechat_exchange', 502)
  }
  return { openid: body.openid, unionid: body.unionid || null }
}

function emailFor(openid) {
  return `wx_${openid}@wechat.placeholder`
}

function authResponseCode(body) {
  return safeCode(body?.code || body?.error_code || body?.error)
}

function validUserId(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

async function generateMagicLink(email, nickname) {
  let response
  try {
    response = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: supabaseHeaders(SUPABASE_SERVICE, '', {
        'Content-Type': 'application/json',
        'X-Supabase-Api-Version': AUTH_API_VERSION,
      }),
      body: JSON.stringify({
        type: 'magiclink',
        email,
        data: {
          provider: 'wechat',
          ...(nickname ? { nickname } : {}),
        },
      }),
    })
  } catch {
    throw endpointError('auth_generate_link_unavailable', 'auth_generate_link', 503)
  }

  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = endpointError(
      'auth_generate_link_failed',
      'auth_generate_link',
      response.status >= 500 ? 503 : 500,
      authResponseCode(body),
    )
    error.upstreamStatus = response.status
    throw error
  }

  const tokenHash = typeof body?.hashed_token === 'string' ? body.hashed_token : ''
  const verificationType = body?.verification_type
  const userId = body?.id
  const returnedEmail = typeof body?.email === 'string' ? body.email.toLowerCase() : ''
  if (
    !/^[A-Za-z0-9_-]{16,2048}$/.test(tokenHash)
    || verificationType !== 'magiclink'
    || !validUserId(userId)
    || returnedEmail !== email.toLowerCase()
  ) {
    throw endpointError('auth_generate_link_malformed', 'auth_generate_link', 502)
  }
  return { tokenHash, verificationType, userId }
}

async function readProfileForBinding(userId) {
  let response
  try {
    response = await fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`
        + '&select=id,wechat_openid,wechat_unionid,nickname&limit=2',
      {
        headers: supabaseHeaders(SUPABASE_SERVICE),
      },
    )
  } catch {
    throw endpointError('profile_read_unavailable', 'profile_bind', 503)
  }

  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const error = endpointError(
      'profile_read_failed',
      'profile_bind',
      response.status >= 500 ? 503 : 500,
      authResponseCode(body),
    )
    error.upstreamStatus = response.status
    throw error
  }
  if (
    !Array.isArray(body)
    || body.length !== 1
    || body[0]?.id !== userId
    || !Object.hasOwn(body[0], 'wechat_openid')
    || !Object.hasOwn(body[0], 'wechat_unionid')
  ) {
    throw endpointError('profile_bind_missing', 'profile_bind', 503)
  }
  return body[0]
}

function ensureIdentityCompatible(profile, openid, unionid) {
  if (profile.wechat_openid != null && profile.wechat_openid !== openid) {
    throw endpointError('profile_identity_conflict', 'profile_bind', 500)
  }
  if (unionid && profile.wechat_unionid != null && profile.wechat_unionid !== unionid) {
    throw endpointError('profile_identity_conflict', 'profile_bind', 500)
  }
}

function profileHasBoundIdentity(profile, openid, unionid) {
  return profile.wechat_openid === openid
    && (!unionid || profile.wechat_unionid === unionid)
}

async function bindWechatIdentityOnProfile(userId, openid, unionid, nickname) {
  const before = await readProfileForBinding(userId)
  ensureIdentityCompatible(before, openid, unionid)

  const patch = {}
  if (before.wechat_openid == null) patch.wechat_openid = openid
  if (unionid && before.wechat_unionid == null) patch.wechat_unionid = unionid

  // WeChat login is an identity operation, not an alternate profile editor.
  // Only seed optional display fields during the first identity bind.
  if (before.wechat_openid == null) {
    if (nickname && (!before.nickname || before.nickname === '用户')) patch.nickname = nickname
  }
  if (Object.keys(patch).length === 0) return

  const url = new URL(`${SUPABASE_URL}/rest/v1/profiles`)
  url.searchParams.set('id', `eq.${userId}`)
  url.searchParams.set(
    'wechat_openid',
    before.wechat_openid == null ? 'is.null' : `eq.${before.wechat_openid}`,
  )
  if (unionid) {
    url.searchParams.set(
      'wechat_unionid',
      before.wechat_unionid == null ? 'is.null' : `eq.${before.wechat_unionid}`,
    )
  }
  url.searchParams.set('select', 'id,wechat_openid,wechat_unionid')

  let response
  try {
    response = await fetchWithTimeout(url.toString(), {
      method: 'PATCH',
      headers: supabaseHeaders(SUPABASE_SERVICE, '', {
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      }),
      body: JSON.stringify(patch),
    })
  } catch {
    throw endpointError('profile_bind_unavailable', 'profile_bind', 503)
  }

  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const error = endpointError(
      'profile_bind_failed',
      'profile_bind',
      response.status >= 500 ? 503 : 500,
      authResponseCode(body),
    )
    error.upstreamStatus = response.status
    throw error
  }
  if (
    Array.isArray(body)
    && body.length === 1
    && body[0]?.id === userId
    && profileHasBoundIdentity(body[0], openid, unionid)
  ) {
    return
  }
  if (!Array.isArray(body) || body.length !== 0) {
    throw endpointError('profile_bind_malformed', 'profile_bind', 503)
  }

  // Another concurrent login may have won the compare-and-set. Treat that as
  // success only after an authoritative read proves it bound the same identity.
  const after = await readProfileForBinding(userId)
  ensureIdentityCompatible(after, openid, unionid)
  if (!profileHasBoundIdentity(after, openid, unionid)) {
    throw endpointError('profile_bind_conflict', 'profile_bind', 500)
  }
}

function retryableOtpConflict(error) {
  return error?.stage === 'auth_verify'
    && error?.upstreamCode === 'otp_expired'
    && [400, 401, 403].includes(error?.upstreamStatus)
}

function retryableGenerateConflict(error) {
  return error?.stage === 'auth_generate_link'
    && ['conflict', 'email_exists', 'user_already_exists'].includes(error?.upstreamCode)
    && [400, 409, 422].includes(error?.upstreamStatus)
}

async function verifyMagicLink(link, expectedEmail) {
  let response
  try {
    response = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/verify`, {
      method: 'POST',
      headers: supabaseHeaders(SUPABASE_ANON, '', {
        'Content-Type': 'application/json',
        'X-Supabase-Api-Version': AUTH_API_VERSION,
      }),
      body: JSON.stringify({
        token_hash: link.tokenHash,
        type: link.verificationType,
      }),
    })
  } catch {
    throw endpointError('auth_verify_unavailable', 'auth_verify', 503)
  }

  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = endpointError(
      'auth_verify_failed',
      'auth_verify',
      response.status >= 500 ? 503 : 500,
      authResponseCode(body),
    )
    error.upstreamStatus = response.status
    throw error
  }

  const returnedEmail = typeof body?.user?.email === 'string'
    ? body.user.email.toLowerCase()
    : ''
  if (
    typeof body?.access_token !== 'string'
    || body.access_token.length < 16
    || body.access_token.length > 16_384
    || typeof body?.refresh_token !== 'string'
    || body.refresh_token.length < 16
    || body.refresh_token.length > 16_384
    || body?.token_type !== 'bearer'
    || !Number.isFinite(body?.expires_in)
    || body.expires_in <= 0
    || !validUserId(body?.user?.id)
    || body.user.id !== link.userId
    || returnedEmail !== expectedEmail.toLowerCase()
  ) {
    throw endpointError('auth_verify_malformed', 'auth_verify', 502)
  }
  return body
}

async function retryPause() {
  const random = new Uint8Array(1)
  crypto.getRandomValues(random)
  await new Promise((resolve) => setTimeout(resolve, 35 + (random[0] % 31)))
}

async function createPasswordlessSession(identity, nickname) {
  const email = emailFor(identity.openid)
  let lastError
  for (let attempt = 0; attempt < VERIFY_ATTEMPTS; attempt += 1) {
    let link
    try {
      link = await generateMagicLink(email, nickname)
    } catch (error) {
      lastError = error
      if (attempt + 1 >= VERIFY_ATTEMPTS || !retryableGenerateConflict(error)) throw error
      // A concurrent first request can win the placeholder-user INSERT before
      // this request's generate_link transaction observes it. Retry only the
      // exact Auth conflict codes; unrelated 4xx responses remain fail-closed.
      await retryPause()
      continue
    }
    await bindWechatIdentityOnProfile(
      link.userId,
      identity.openid,
      identity.unionid,
      nickname,
    )
    try {
      return await verifyMagicLink(link, email)
    } catch (error) {
      lastError = error
      if (attempt + 1 >= VERIFY_ATTEMPTS || !retryableOtpConflict(error)) throw error
      // Concurrent first-login requests can invalidate the earlier one-time
      // token. Wait briefly for the winner, then generate one fresh token. No
      // password or auth.users credential is mutated, so retries cannot leave
      // the account and a side table out of sync.
      await retryPause()
    }
  }
  throw lastError || endpointError('auth_verify_failed', 'auth_verify', 500)
}

function sessionForClient(session) {
  // Allowlist the established Supabase session fields instead of forwarding
  // arbitrary future GoTrue response properties.
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    token_type: session.token_type || 'bearer',
    expires_in: session.expires_in,
    ...(Number.isFinite(session.expires_at) ? { expires_at: session.expires_at } : {}),
    user: session.user,
  }
}

function rateLimitFailureResponse(error, id) {
  const limited = error?.message === 'rate_limited' && error?.status === 429
  if (!limited) logFailure(id, error)
  return json(
    { error: limited ? 'rate_limited' : 'rate_limit_unavailable' },
    limited ? 429 : 503,
    id,
  )
}

function inputFailureResponse(error, id) {
  if (error?.message === 'body_too_large' && error?.status === 413) {
    return json({ error: 'body_too_large' }, 413, id)
  }
  if (error?.message === 'request_timeout' && error?.status === 408) {
    return json({ error: 'request_timeout' }, 408, id)
  }
  return json({ error: 'bad_json' }, 400, id)
}

function wechatFailureResponse(error, id) {
  const allowed = new Map([
    ['wechat_rate_limited', 429],
    ['wechat_code_rejected', 401],
    ['wechat_exchange_failed', 502],
    ['wechat_exchange_unavailable', 502],
    ['wechat_identity_invalid', 502],
  ])
  const status = allowed.get(error?.message)
  if (status === error?.status) return json({ error: error.message }, status, id)
  return json({ error: 'wechat_exchange_unavailable' }, 502, id)
}

export default async function handler(request) {
  const deploymentError = deploymentBoundaryResponse(evaluateDeploymentBoundary({ supabaseUrl: SUPABASE_URL }))
  if (deploymentError) return deploymentError
  const id = requestId()
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { Allow: 'POST, OPTIONS', 'Cache-Control': 'no-store', 'X-Request-Id': id },
    })
  }
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405, id)
  }

  if (!WECHAT_APPID || !WECHAT_APPSECRET) {
    return json({ error: 'wechat_not_configured' }, 503, id)
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE || !SUPABASE_ANON) {
    return json({ error: 'supabase_not_configured' }, 503, id)
  }

  let body
  try {
    body = await parseRequestBody(request)
  } catch (error) {
    return inputFailureResponse(error, id)
  }

  const jsCode = typeof body?.js_code === 'string' ? body.js_code.trim() : ''
  const nickname = sanitizeNickname(body?.nickname)
  if (!jsCode || jsCode.length > 256 || /[\u0000-\u001F\u007F]/.test(jsCode)) {
    return json({ error: 'bad_js_code' }, 400, id)
  }

  try {
    await enforceNetworkRateLimit(request)
  } catch (error) {
    return rateLimitFailureResponse(error, id)
  }

  let identity
  try {
    identity = await exchangeCodeForIdentity(jsCode)
  } catch (error) {
    logFailure(id, error)
    return wechatFailureResponse(error, id)
  }

  try {
    await enforceIdentityRateLimit(identity.openid)
  } catch (error) {
    return rateLimitFailureResponse(error, id)
  }

  try {
    const session = await createPasswordlessSession(identity, nickname)
    return json(sessionForClient(session), 200, id)
  } catch (error) {
    logFailure(id, error)
    return json({ error: 'login_failed' }, error.status === 503 ? 503 : 500, id)
  }
}
