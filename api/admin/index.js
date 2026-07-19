import { deploymentBoundaryResponse, evaluateDeploymentBoundary } from '../_deployment-boundary.js'

export const config = { runtime: 'edge' }

/*
 * Unified admin API surface.
 *
 * Auth model (v2, post-036):
 *   Bearer token per admin (Authorization: Bearer iam_admin_<random>).
 *   The token is SHA-256 hashed and matched against admin_tokens.
 *   On hit, JSON writes pass the token digest into admin_execute_mutation,
 *   which revalidates it and commits the business change, actor/token/key
 *   audit row, and idempotency result in one database transaction. Login,
 *   unauthorized-attempt and multipart-upload telemetry remain separate
 *   best-effort events because they are not part of a JSON business write.
 *
 *   No shared-key fallback (ADM-SEC-01): the legacy ADMIN_API_KEY path
 *   was removed once every admin held a per-admin token. A bearer that
 *   doesn't resolve via admin_token_authorization gets a 401 — there is no
 *   second chance. Finish the cutover by deleting the ADMIN_API_KEY env
 *   var (it is no longer read).
 *
 * Why not gate on profiles.is_admin in Supabase instead?
 *   Adding is_admin would require rewriting every RLS policy that
 *   references auth.uid(). A bearer token + service_role keeps the
 *   admin trust boundary OUTSIDE the user auth system — so a
 *   stolen user session cannot reach this surface.
 *
 * Why one edge function instead of per-resource files?
 *   Vercel function limits depend on the active plan and may change over
 *   time. This multiplexed route keeps route growth bounded while exposing a
 *   clean REST-ish surface (GET ?resource=... / POST {action,...}).
 *
 * Why raw fetch to PostgREST instead of @supabase/supabase-js?
 *   Sibling edge routes (translate, moderate, share*) already use
 *   raw fetch. Keeping the admin route in the same style avoids
 *   adding a deploy-time dependency; the edge runtime resolves each file
 *   independently.
 */

function env(name, fallback) {
  return process.env[name] || fallback
}

const SUPABASE_URL = env('SUPABASE_URL', env('VITE_SUPABASE_URL', ''))
const SERVICE_KEY = env('SUPABASE_SECRET_KEY', env('SUPABASE_SERVICE_ROLE_KEY', ''))
const UPSTREAM_TIMEOUT_MS = 5000
const SENTRY_TIMEOUT_MS = 2000
const UPSTREAM_RESPONSE_MAX_BYTES = 2 * 1024 * 1024
const ADMIN_JSON_MAX_BYTES = 64 * 1024
const REQUEST_BODY_TIMEOUT_MS = 5000
const ADMIN_BEARER_PATTERN = /^iam_admin_[A-Za-z0-9_-]{43}$/

function supabaseHeaders(key, authorization = '', extra = {}) {
  const headers = { apikey: key, ...extra }
  if (authorization) headers.Authorization = authorization
  else if (!/^sb_(?:publishable|secret)_/.test(key)) headers.Authorization = `Bearer ${key}`
  return headers
}

function codedError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

function declaredContentLength(headers) {
  const raw = headers.get('content-length')
  if (raw == null || raw === '') return null
  if (!/^\d+$/.test(raw)) throw codedError('invalid_content_length')
  const value = Number(raw)
  if (!Number.isSafeInteger(value)) throw codedError('invalid_content_length')
  return value
}

async function readStreamBytes(stream, maxBytes, timeoutMs, timeoutCode, tooLargeCode) {
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
          if (!(value instanceof Uint8Array)) throw codedError('invalid_body_stream')
          total += value.byteLength
          if (total > maxBytes) {
            try { await reader.cancel() } catch {}
            throw codedError(tooLargeCode)
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
          try { void reader.cancel().catch(() => {}) } catch {}
          reject(codedError(timeoutCode))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function readRequestBytes(request, maxBytes, { requireLength = false } = {}) {
  const length = declaredContentLength(request.headers)
  if (requireLength && length == null) throw codedError('content_length_required')
  if (length != null && length > maxBytes) throw codedError('body_too_large')
  return readStreamBytes(
    request.body,
    maxBytes,
    REQUEST_BODY_TIMEOUT_MS,
    'request_body_timeout',
    'body_too_large',
  )
}

async function readRequestText(request, maxBytes) {
  const bytes = await readRequestBytes(request, maxBytes)
  return new TextDecoder().decode(bytes)
}

/*
 * One transport boundary for every provider call in this admin surface.
 * The timer remains active while the response body is consumed, so a server
 * that sends headers and then stalls cannot pin an Edge invocation forever.
 */
async function adminFetch(input, init = {}, options = {}) {
  const timeoutMs = options.timeoutMs || UPSTREAM_TIMEOUT_MS
  const maxBytes = options.maxBytes || UPSTREAM_RESPONSE_MAX_BYTES
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(input, {
      ...init,
      redirect: 'error',
      signal: controller.signal,
    })
    if (response.redirected || (response.status >= 300 && response.status < 400)) {
      throw codedError('admin_upstream_redirect')
    }
    const length = declaredContentLength(response.headers)
    if (length != null && length > maxBytes) throw codedError('admin_upstream_response_too_large')
    const bytes = await readStreamBytes(
      response.body,
      maxBytes,
      timeoutMs,
      'admin_upstream_timeout',
      'admin_upstream_response_too_large',
    )
    return { response, text: new TextDecoder().decode(bytes) }
  } catch (err) {
    if (controller.signal.aborted || err?.name === 'AbortError') {
      throw codedError('admin_upstream_timeout')
    }
    if (typeof err?.code === 'string' && err.code.startsWith('admin_upstream_')) throw err
    throw codedError('admin_upstream_failed')
  } finally {
    clearTimeout(timer)
  }
}

function parseUpstreamJson(text) {
  try { return text ? JSON.parse(text) : null } catch {
    throw codedError('admin_upstream_malformed')
  }
}

function parseUpstreamArray(text) {
  const value = parseUpstreamJson(text)
  if (!Array.isArray(value)) throw codedError('admin_upstream_malformed')
  return value
}
// Reuses the project's existing Sentry DSN (the frontend SDK reads the same
// VITE_SENTRY_DSN). A dedicated SENTRY_DSN wins if ever set; otherwise audit
// failures land in the same Sentry project as client errors — one dashboard.
const SENTRY_DSN   = env('SENTRY_DSN', env('VITE_SENTRY_DSN', ''))

/*
 * Login, unauthorized-attempt and multipart-upload telemetry is best-effort.
 * Required JSON-mutation audits are enforced inside admin_execute_mutation and
 * roll the business transaction back on failure. For these remaining
 * telemetry-only writes, emit a stable-code Sentry event when configured.
 */
async function reportToSentry(message, extra) {
  if (!SENTRY_DSN) return
  try {
    // DSN format: https://<publicKey>@<host>/<projectId>
    const m = SENTRY_DSN.match(/^https:\/\/([^@]+)@([^/]+)\/(.+)$/)
    if (!m) return
    const [, key, host, projectId] = m
    await adminFetch(
      `https://${host}/api/${projectId}/store/?sentry_key=${key}&sentry_version=7`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          level: 'error',
          platform: 'javascript',
          logger: 'api/admin',
          environment: env('VERCEL_ENV', 'unknown'),
          release: env('VERCEL_GIT_COMMIT_SHA', '').slice(0, 7) || undefined,
          extra: extra || {},
        }),
      },
      { timeoutMs: SENTRY_TIMEOUT_MS, maxBytes: 64 * 1024 },
    )
  } catch {
    // A monitoring failure must never affect the request.
  }
}

function stableErrorCode(err) {
  const code = typeof err?.code === 'string' ? err.code : ''
  if (/^[a-z0-9_:-]{1,80}$/i.test(code)) return code
  return 'admin_upstream_failed'
}

async function reportAuditFailure(kind, err) {
  const errorCode = stableErrorCode(err)
  console.warn(`[admin] audit ${kind} failed`, errorCode)
  await reportToSentry(`admin audit write failed: ${kind}`, { error_code: errorCode })
}

async function sha256Hex(input) {
  const buf = new TextEncoder().encode(input)
  return sha256Bytes(buf)
}

async function sha256Bytes(input) {
  const digest = await crypto.subtle.digest('SHA-256', input)
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

async function hmacHex(label, value) {
  if (!SERVICE_KEY) throw new Error('rate_key_unavailable')
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
    encoder.encode(`${label}:v1\u0000${String(value)}`),
  )
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/*
 * Validate and authorize the bearer token via the service-only PostgREST RPC.
 *
 * Returns:
 *   { ok: true, adminId, adminName, adminEmail, role, capabilities, source: 'token' }
 *   { ok: false, source: 'missing' | 'invalid' | 'unavailable' }
 *
 * There is NO shared-key fallback: every admin must present a per-admin
 * iam_admin_ token that resolves via admin_token_authorization. The legacy
 * ADMIN_API_KEY path was removed (ADM-SEC-01) once all admins were on
 * per-admin tokens; delete the ADMIN_API_KEY env var to finish the cutover.
 */
async function validateBearer(bearer) {
  if (!bearer) return { ok: false, source: 'missing' }
  if (!SUPABASE_URL || !SERVICE_KEY) return { ok: false, source: 'unavailable' }

  try {
    const tokenHash = await sha256Hex(bearer)
    const { response: r, text } = await adminFetch(
      `${SUPABASE_URL}/rest/v1/rpc/admin_token_authorization`,
      {
        method: 'POST',
        headers: supabaseHeaders(SERVICE_KEY, '', {
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ p_token_hash: tokenHash }),
      },
    )
    if (!r.ok) {
      // A provider/configuration failure is not evidence that the presented
      // credential is invalid. Preserve that truth so operators do not rotate
      // a valid token in response to a 401 caused by an upstream outage.
      console.warn('[admin] admin_token_authorization unavailable', r.status)
      return { ok: false, source: 'unavailable' }
    }
    const rows = parseUpstreamJson(text)
    if (!Array.isArray(rows)) return { ok: false, source: 'unavailable' }
    if (rows.length === 0) return { ok: false, source: 'invalid' }
    if (rows.length !== 1) return { ok: false, source: 'unavailable' }
    const row = rows[0]
    const capabilities = row?.capabilities
    if (
      hasExactKeys(row, ['admin_id', 'admin_name', 'admin_email', 'role', 'capabilities'])
      && isUuid(row.admin_id)
      && isBoundedNullableIdentity(row.admin_name, 100, false)
      && isBoundedNullableIdentity(row.admin_email, 200, true)
      && ADMIN_ROLES.has(row.role)
      && hasExactRoleCapabilities(row.role, capabilities)
    ) {
      return {
        ok: true,
        adminId:    row.admin_id,
        adminName:  row.admin_name,
        adminEmail: row.admin_email,
        role:        row.role,
        capabilities,
        // Retain only the one-way digest after the initial validation. The
        // atomic mutation RPC re-checks this exact token while holding its
        // database row lock, closing the validate-then-revoke race without
        // ever forwarding or persisting the plaintext credential.
        tokenHash,
        source: 'token',
      }
    }
    return { ok: false, source: 'unavailable' }
  } catch (err) {
    console.warn('[admin] admin_token_authorization unavailable', stableErrorCode(err))
    return { ok: false, source: 'unavailable' }
  }

  return { ok: false, source: 'invalid' }
}

function isBoundedNullableIdentity(value, maxLength, requireEmailShape) {
  if (value === null) return true
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= maxLength
    && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value)
    && (!requireEmailShape || (value.length >= 3 && value.includes('@')))
}

function hasExactRoleCapabilities(role, capabilities) {
  if (!Array.isArray(capabilities) || capabilities.some(value => typeof value !== 'string')) {
    return false
  }
  const expected = role === 'owner'
    ? [...OWNER_ACTIONS].sort()
    : role === 'operator'
      ? [...MODERATION_ACTIONS].sort()
      : role === 'security_admin'
        ? [...SECURITY_ACTIONS].sort()
        : []
  const actual = [...capabilities].sort()
  return new Set(capabilities).size === capabilities.length
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index])
}

function readBearer(request) {
  const xKey = (request.headers.get('x-admin-key') || '').trim()
  const auth = (request.headers.get('authorization') || '').trim()
  const match = auth ? auth.match(/^Bearer\s+([^\s]+)$/i) : null
  if (auth && !match) return ''
  const bearer = match?.[1] || ''
  // Multiple credential channels must agree. Silently preferring one header
  // can execute and audit a destructive action as a different admin than the
  // caller intended.
  if (xKey && bearer && xKey !== bearer) return ''
  return xKey || bearer || ''
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

function boundedQueryInt(value, fallback, min, max) {
  const raw = value == null || value === '' ? String(fallback) : String(value)
  if (!/^\d+$/.test(raw)) return fallback
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value, expected) {
  if (!isPlainObject(value)) return false
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index])
}

function sameNullableTimestamp(actual, expected) {
  if (expected === null) return actual === null
  if (typeof expected !== 'string' || typeof actual !== 'string') return false
  const actualTime = Date.parse(actual)
  const expectedTime = Date.parse(expected)
  return Number.isFinite(actualTime)
    && Number.isFinite(expectedTime)
    && actualTime === expectedTime
}

const ADMIN_BANNER_RESULT_KEYS = [
  'id', 'image_url', 'target_url', 'title', 'title_en', 'title_zh',
  'priority', 'active', 'is_default', 'start_at', 'end_at',
  'created_at', 'updated_at',
]

/*
 * A 2xx PostgREST response is not proof that the requested mutation reached
 * its expected terminal state. Validate the action-owned result contract
 * before the Edge function lets a client release its durable idempotency key
 * or display optimistic success. Any malformed/mismatched result is outcome
 * unknown and must be retried with the same key.
 */
function isExpectedAdminMutationResult(action, payload, result) {
  if (!isPlainObject(result)) return false

  if (action === 'apply_ban') {
    return hasExactKeys(result, ['data']) && isUuid(result.data)
  }

  if (new Set([
    'lift_suspension',
    'update_report_status',
    'set_post_pinned',
    'delete_banner',
    'revoke_token',
  ]).has(action)) {
    return hasExactKeys(result, ['success']) && result.success === true
  }

  if (action === 'resolve_target_reports' || action === 'takedown_content') {
    return hasExactKeys(result, ['data'])
      && hasExactKeys(result.data, ['ok', 'affected'])
      && result.data.ok === true
      && Number.isInteger(result.data.affected)
      && result.data.affected > 0
  }

  if (action === 'upsert_banner') {
    if (
      !hasExactKeys(result, ['data'])
      || !hasExactKeys(result.data, ADMIN_BANNER_RESULT_KEYS)
      || !isUuid(result.data.id)
      || !isBoundedString(result.data.image_url, 2048)
      || !isNullableBoundedString(result.data.target_url, 2048)
      || !isNullableBoundedString(result.data.title, 1000)
      || !isNullableBoundedString(result.data.title_en, 200)
      || !isNullableBoundedString(result.data.title_zh, 200)
      || !Number.isInteger(result.data.priority)
      || result.data.priority < -10_000
      || result.data.priority > 10_000
      || typeof result.data.active !== 'boolean'
      || typeof result.data.is_default !== 'boolean'
      || !isNullableTimestamp(result.data.start_at)
      || !isNullableTimestamp(result.data.end_at)
      || !isIsoTimestamp(result.data.created_at)
      || !isIsoTimestamp(result.data.updated_at)
    ) {
      return false
    }
    if (payload.id && result.data.id.toLowerCase() !== payload.id.toLowerCase()) return false
    for (const field of ['image_url', 'target_url', 'title_zh', 'title_en', 'priority', 'active', 'is_default']) {
      if (Object.prototype.hasOwnProperty.call(payload, field) && result.data[field] !== payload[field]) {
        return false
      }
    }
    for (const field of ['start_at', 'end_at']) {
      if (Object.prototype.hasOwnProperty.call(payload, field)
          && !sameNullableTimestamp(result.data[field], payload[field])) return false
    }
    return true
  }

  if (action === 'issue_token') {
    const data = result.data
    return hasExactKeys(result, ['data'])
      && hasExactKeys(data, ['token_id', 'admin_id', 'role', 'expires_at'])
      && isUuid(data.token_id)
      && typeof data.admin_id === 'string'
      && data.admin_id.toLowerCase() === payload.admin_id?.toLowerCase()
      && data.role === payload.role
      && sameNullableTimestamp(data.expires_at, payload.expires_at)
  }

  if (action === 'revoke_admin_tokens') {
    const data = result.data
    return hasExactKeys(result, ['data'])
      && hasExactKeys(data, ['admin_id', 'token_ids', 'revoked_count'])
      && typeof data.admin_id === 'string'
      && data.admin_id.toLowerCase() === payload.admin_id?.toLowerCase()
      && Array.isArray(data.token_ids)
      && data.token_ids.length > 0
      && data.token_ids.length <= 100
      && data.token_ids.every(isUuid)
      && new Set(data.token_ids.map(id => id.toLowerCase())).size === data.token_ids.length
      && Number.isInteger(data.revoked_count)
      && data.revoked_count === data.token_ids.length
  }

  return false
}

function projectAdminMutationResult(action, result) {
  if (action !== 'upsert_banner') return result
  return {
    data: Object.fromEntries(ADMIN_BANNER_RESULT_KEYS.map(key => [key, result.data[key]])),
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MANAGED_BANNER_PUBLIC_PATH_PATTERN = /^\/storage\/v1\/object\/public\/banners\/managed\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{64}\.(?:png|jpg|webp)$/i
const REPORT_STATUSES = new Set(['pending', 'reviewed', 'resolved', 'dismissed'])
const BULK_REPORT_STATUSES = new Set(['reviewed', 'resolved', 'dismissed'])
const REPORT_TARGET_TYPES = new Set(['item', 'user', 'message', 'post', 'comment'])
const TAKEDOWN_TARGET_TYPES = new Set(['item', 'post', 'comment'])
const ADMIN_ROLES = new Set(['operator', 'security_admin', 'owner'])
const MODERATION_ACTIONS = new Set([
  'apply_ban',
  'lift_suspension',
  'update_report_status',
  'resolve_target_reports',
  'takedown_content',
])
const OWNER_ACTIONS = new Set([
  ...MODERATION_ACTIONS,
  'set_post_pinned',
  'upsert_banner',
  'delete_banner',
  'upload_banner',
  'revoke_token',
  'issue_token',
  'revoke_admin_tokens',
])
const SECURITY_ACTIONS = new Set(['revoke_token', 'revoke_admin_tokens'])
const MODERATION_RESOURCES = new Set([
  'stats',
  'suspensions',
  'suspension',
  'reports',
  'reports_grouped',
  'report',
  'search_users',
  'linked_accounts',
  'appeals',
  'warnings',
  'profile_suspensions',
  'audit',
])
const OWNER_RESOURCES = new Set([
  ...MODERATION_RESOURCES,
  'tokens',
  'token_reconciliation',
  'idempotency_reconciliation',
  'plaza_posts',
  'banners',
])
const SECURITY_RESOURCES = new Set(['tokens'])
const ADMIN_RESOURCES = new Set(['whoami', ...OWNER_RESOURCES])

function roleCanMutate(role, action) {
  if (role === 'owner') return OWNER_ACTIONS.has(action)
  if (role === 'operator') return MODERATION_ACTIONS.has(action)
  if (role === 'security_admin') return SECURITY_ACTIONS.has(action)
  return false
}

function roleCanRead(role, resource) {
  if (resource === 'whoami') return ADMIN_ROLES.has(role)
  if (role === 'owner') return OWNER_RESOURCES.has(resource)
  if (role === 'operator') return MODERATION_RESOURCES.has(resource)
  if (role === 'security_admin') return SECURITY_RESOURCES.has(resource)
  return false
}

function ownerRecoveryHealth(tokens) {
  const now = Date.now()
  const minimumRecoveryHorizon = now + 24 * 60 * 60 * 1000
  const activeOwnerTokens = tokens.filter(token => {
    if (token?.role !== 'owner' || !token?.admin_id || token?.revoked_at) return false
    if (!token.expires_at) return true
    const expiry = Date.parse(token.expires_at)
    return Number.isFinite(expiry) && expiry > now
  })
  const activeOwnerCandidates = activeOwnerTokens.filter(token => (
    !token.expires_at || Date.parse(token.expires_at) >= minimumRecoveryHorizon
  ))
  // Issuance alone does not prove that anyone retained the plaintext. A new
  // Owner credential becomes recovery-capable only after it successfully
  // authorizes at least one request and the DB records last_used_at.
  const activeOwners = activeOwnerCandidates.filter(token => token.last_used_at !== null)
  const finiteExpiries = activeOwners
    .map(token => token.expires_at)
    .filter(Boolean)
    .map(value => ({ value, time: Date.parse(value) }))
    .filter(entry => Number.isFinite(entry.time))
    .sort((left, right) => left.time - right.time)
  const nonExpiring = activeOwners.filter(token => !token.expires_at).length
  const nearest = finiteExpiries[0] || null
  const expiresWithinThirtyDays = !!nearest
    && nearest.time - now <= 30 * 24 * 60 * 60 * 1000
  return {
    active_owner_tokens: activeOwners.length,
    unverified_owner_tokens: activeOwnerCandidates.length - activeOwners.length,
    expiring_owner_tokens: activeOwnerTokens.length - activeOwnerCandidates.length,
    non_expiring_owner_tokens: nonExpiring,
    nearest_owner_expiry: nearest?.value || null,
    status: activeOwners.length === 0 ? 'critical'
      : activeOwners.length < 2 || (nonExpiring === 0 && expiresWithinThirtyDays)
        ? 'warning'
        : 'healthy',
  }
}

function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
  ).join(',')}}`
}

function isBoundedString(value, maxLength, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || value.length > maxLength) return false
  return allowEmpty || value.trim().length > 0
}

function isAuditEvidence(value) {
  return isBoundedString(value, 200)
    && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value)
}

function isNullableBoundedString(value, maxLength) {
  return value === null || isBoundedString(value, maxLength, { allowEmpty: true })
}

function isIsoTimestamp(value) {
  return typeof value === 'string'
    && value.length <= 64
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value))
}

function isNullableTimestamp(value) {
  return value === null || isIsoTimestamp(value)
}

function isSafeBannerImage(value) {
  if (typeof value !== 'string' || !value || value.length > 2048 || !SUPABASE_URL) return false
  try {
    const url = new URL(value)
    const configured = new URL(SUPABASE_URL)
    return configured.protocol === 'https:'
      && configured.pathname.replace(/\/+$/, '') === ''
      && !configured.username
      && !configured.password
      && !configured.search
      && !configured.hash
      && url.origin === configured.origin
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
      && MANAGED_BANNER_PUBLIC_PATH_PATTERN.test(url.pathname)
  } catch {
    return false
  }
}

function isSafeBannerTarget(value) {
  if (value == null) return true
  if (typeof value !== 'string' || !value || value.length > 2048) return false
  if (value.startsWith('/pages/')) {
    return !/[\\#]/.test(value) && !/(?:^|\/)\.\.(?:\/|$)/.test(value)
  }
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}

/*
 * Generic RPC helper for reads, rate limiting, identity probes and the few
 * telemetry-only audit calls. JSON business writes deliberately bypass this
 * helper and use executeAdminMutation so token revalidation, actor evidence,
 * required audit and idempotency share one database transaction.
 */
async function rpc(fn, args) {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('supabase_not_configured')
  const { response: r, text } = await adminFetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: supabaseHeaders(SERVICE_KEY, '', {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    }),
    body: JSON.stringify(args || {}),
  })
  if (!r.ok) {
    // Provider/PostgREST messages can contain values copied from rows or SQL.
    // Keep them out of logs, Sentry, and the admin HTTP response.
    const error = new Error('admin_upstream_failed')
    error.code = `postgrest_${r.status}`
    throw error
  }
  return parseUpstreamJson(text)
}

async function executeAdminMutation(request, auth, body) {
  const idempotencyKey = (request.headers.get('idempotency-key') || '').trim()
  if (!isUuid(idempotencyKey)) throw codedError('invalid_idempotency_key')
  if (!auth?.tokenHash) throw codedError('admin_token_inactive')

  const { action, ...payload } = body
  const payloadHash = await sha256Hex(canonicalJson({ action, payload }))
  let upstreamResponse
  try {
    upstreamResponse = await adminFetch(
      `${SUPABASE_URL}/rest/v1/rpc/admin_execute_mutation`,
      {
        method: 'POST',
        headers: supabaseHeaders(SERVICE_KEY, '', {
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        }),
        body: JSON.stringify({
          p_token_hash: auth.tokenHash,
          p_idempotency_key: idempotencyKey,
          p_payload_hash: payloadHash,
          p_action: action,
          p_payload: payload,
        }),
      },
    )
  } catch {
    // A transport failure after dispatch cannot tell us whether PostgreSQL
    // committed. The caller retains this idempotency key and may safely retry.
    throw codedError('admin_outcome_unknown')
  }
  const { response: r, text } = upstreamResponse

  if (!r.ok) {
    // Only recognize exact, migration-owned sentinel messages. Never surface
    // arbitrary PostgREST text because row values can be embedded in it.
    let upstream = null
    try { upstream = parseUpstreamJson(text) } catch {}
    const message = typeof upstream?.message === 'string' ? upstream.message : ''
    if (message === 'admin_token_inactive') throw codedError('admin_token_inactive')
    if (message === 'idempotency_conflict') throw codedError('idempotency_conflict')
    if (new Set([
      'admin_mutation_not_found',
      'apply_ban_target_not_found',
      'suspension_not_active',
      'report_not_found',
      'report_group_not_found',
      'content_not_found',
      'post_not_found',
      'banner_not_found',
      'admin_upload_not_found',
      'admin_profile_not_found',
    ]).has(message)) throw codedError('admin_mutation_not_found')
    if (new Set([
      'admin_mutation_conflict',
      'token_not_active',
      'self_revoke_forbidden',
      'last_active_admin_token',
      'admin_upload_expired',
      'admin_upload_gc_in_progress',
      'admin_token_hash_conflict',
      'admin_token_batch_conflict',
      'admin_account_deletion_in_progress',
    ]).has(message)) throw codedError('admin_mutation_conflict')
    if (message === 'admin_mutation_invalid'
        || message === 'admin_mutation_invalid_payload'
        || message === 'admin_profile_identity_incomplete'
        || message === 'admin_token_batch_too_large'
        || message === 'admin_upload_required') {
      throw codedError('admin_mutation_invalid')
    }
    if (message === 'admin_capability_denied') throw codedError('admin_capability_denied')
    if (message === 'last_active_owner_token') throw codedError('admin_mutation_conflict')
    if (message === 'idempotency_incomplete') throw codedError('admin_outcome_unknown')
    if (r.status >= 500) throw codedError('admin_outcome_unknown')
    throw codedError('admin_upstream_failed')
  }

  let result = null
  try { result = parseUpstreamJson(text) } catch {
    throw codedError('admin_outcome_unknown')
  }
  if (!isExpectedAdminMutationResult(action, payload, result)) {
    throw codedError('admin_outcome_unknown')
  }
  return projectAdminMutationResult(action, result)
}

const MANAGED_BANNER_OBJECT_PATTERN = /^managed\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f]{64}\.(?:png|jpg|webp)$/

/*
 * Prepare/complete are separate database transactions around an external
 * Storage write. Their deterministic saga row is the idempotency ledger, and
 * completion owns the required audit. A transport failure is always reported
 * as outcome-unknown so the same caller key can safely reconcile it.
 */
async function executeBannerUploadStage(fn, args, { allowedStatuses, expectedObjectName = '' }) {
  let upstreamResponse
  try {
    upstreamResponse = await adminFetch(
      `${SUPABASE_URL}/rest/v1/rpc/${fn}`,
      {
        method: 'POST',
        headers: supabaseHeaders(SERVICE_KEY, '', {
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        }),
        body: JSON.stringify(args),
      },
    )
  } catch {
    throw codedError('admin_outcome_unknown')
  }

  const { response, text } = upstreamResponse
  if (!response.ok) {
    let upstream = null
    try { upstream = parseUpstreamJson(text) } catch {}
    const message = typeof upstream?.message === 'string' ? upstream.message : ''
    if (message === 'admin_token_inactive') throw codedError('admin_token_inactive')
    if (message === 'admin_capability_denied') throw codedError('admin_capability_denied')
    if (message === 'idempotency_conflict') throw codedError('idempotency_conflict')
    if (message === 'admin_upload_invalid') throw codedError('admin_mutation_invalid')
    if (message === 'admin_upload_not_found') throw codedError('admin_mutation_not_found')
    if (message === 'admin_upload_expired' || message === 'admin_upload_gc_in_progress') {
      throw codedError('admin_mutation_conflict')
    }
    if (response.status >= 500) throw codedError('admin_outcome_unknown')
    throw codedError('admin_upstream_failed')
  }

  let result
  try {
    const parsed = parseUpstreamJson(text)
    result = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : parsed
  } catch {
    throw codedError('admin_outcome_unknown')
  }
  if (!result || typeof result !== 'object' || Array.isArray(result)
      || Object.keys(result).sort().join(',') !== 'object_name,status'
      || !MANAGED_BANNER_OBJECT_PATTERN.test(result.object_name || '')
      || !allowedStatuses.has(result.status)
      || (expectedObjectName && result.object_name !== expectedObjectName)) {
    throw codedError('admin_outcome_unknown')
  }
  return result
}

async function recordAdminLogin(auth) {
  if (!SUPABASE_URL || !SERVICE_KEY) return
  if (!auth?.adminId) return
  try {
    await rpc('record_audit', {
      event_kind_in: 'admin_login',
      actor_id_in:   auth.adminId,
      target_id_in:  null,
      details_in:    { auth_source: auth.source, role: auth.role },
    })
  } catch (err) {
    // A login event is telemetry, not a business mutation. Keep unlock usable
    // while reporting the stable failure code out of band.
    await reportAuditFailure('admin_login', err)
  }
}

async function handleGet(request, auth) {
  const url = new URL(request.url)
  const resource = url.searchParams.get('resource') || ''
  const limit = boundedQueryInt(url.searchParams.get('limit'), 50, 1, 200)
  const offset = boundedQueryInt(url.searchParams.get('offset'), 0, 0, 1_000_000)

  if (ADMIN_RESOURCES.has(resource) && !roleCanRead(auth?.role, resource)) {
    throw codedError('admin_capability_denied')
  }

  if (resource === 'whoami') {
    /*
     * Returns the current admin's identity so the dashboard can show
     * "logged in as <name>" in its header. Pulled from the auth result
     * we already computed in checkAuth — no extra DB roundtrip. Legacy
     * shared-key sessions return null fields (no per-admin identity).
     */
    return json({
      data: {
        admin_id:    auth?.adminId    || null,
        admin_name:  auth?.adminName  || null,
        admin_email: auth?.adminEmail || null,
        role:        auth?.role       || null,
        capabilities: Array.isArray(auth?.capabilities) ? auth.capabilities : [],
        source:      auth?.source     || null,
      },
    })
  }

  if (resource === 'stats') {
    const data = await rpc('admin_dashboard_stats', {})
    return json({ data: Array.isArray(data) ? data[0] : data })
  }

  if (resource === 'suspensions') {
    const activeOnly = url.searchParams.get('active') === '1'
    const data = await rpc('admin_list_suspensions', {
      limit_in: limit, offset_in: offset, active_only_in: activeOnly,
    })
    return json({ data })
  }

  if (resource === 'suspension') {
    const id = url.searchParams.get('id')
    if (!id) return json({ error: 'missing_id' }, 400)
    if (!isUuid(id)) return json({ error: 'invalid_id' }, 400)
    const data = await rpc('admin_get_suspension_detail', { suspension_id_in: id })
    const detail = Array.isArray(data) ? data[0] : data
    if (!detail || typeof detail !== 'object') return json({ error: 'admin_detail_not_found' }, 404)
    return json({ data: detail })
  }

  if (resource === 'reports') {
    const status = url.searchParams.get('status')
    if (status && !REPORT_STATUSES.has(status)) return json({ error: 'invalid_status' }, 400)
    const data = await rpc('admin_list_reports', {
      limit_in: limit, offset_in: offset, status_filter: status || null,
    })
    return json({ data })
  }

  if (resource === 'reports_grouped') {
    const pendingOnly = url.searchParams.get('pending') !== '0'
    const data = await rpc('admin_list_reports_grouped', {
      limit_in: limit, offset_in: offset, pending_only: pendingOnly,
    })
    return json({ data })
  }

  if (resource === 'report') {
    const id = url.searchParams.get('id')
    if (!id) return json({ error: 'missing_id' }, 400)
    if (!isUuid(id)) return json({ error: 'invalid_id' }, 400)
    const data = await rpc('admin_get_report_detail', { report_id_in: id })
    const detail = Array.isArray(data) ? data[0] : data
    if (!detail || typeof detail !== 'object') return json({ error: 'admin_detail_not_found' }, 404)
    return json({ data: detail })
  }

  if (resource === 'search_users') {
    const q = url.searchParams.get('q') || ''
    if (!isBoundedString(q, 200)) return json({ error: 'invalid_query' }, 400)
    const data = await rpc('admin_search_users', { query_in: q, limit_in: limit })
    return json({ data })
  }

  if (resource === 'linked_accounts') {
    const profileId = url.searchParams.get('profile_id')
    if (!profileId) return json({ error: 'missing_profile_id' }, 400)
    if (!isUuid(profileId)) return json({ error: 'invalid_id' }, 400)
    const data = await rpc('admin_get_linked_accounts', { profile_id_in: profileId })
    return json({ data })
  }

  if (resource === 'appeals') {
    const data = await rpc('admin_list_appeals', { limit_in: limit, offset_in: offset })
    return json({ data })
  }

  if (resource === 'warnings') {
    const data = await rpc('admin_list_warnings', { limit_in: limit, offset_in: offset })
    return json({ data })
  }

  if (resource === 'profile_suspensions') {
    const profileId = url.searchParams.get('profile_id')
    if (!profileId) return json({ error: 'missing_profile_id' }, 400)
    if (!isUuid(profileId)) return json({ error: 'invalid_id' }, 400)
    const data = await rpc('admin_get_profile_suspensions', { profile_id_in: profileId })
    return json({ data })
  }

  if (resource === 'audit') {
    const kind = url.searchParams.get('kind')
    if (kind && !isBoundedString(kind, 80)) return json({ error: 'invalid_kind' }, 400)
    const data = await rpc('admin_list_audit_log', {
      limit_in: limit, offset_in: offset, kind_filter: kind || null,
    })
    return json({ data })
  }

  if (resource === 'tokens') {
    const data = await rpc('admin_token_inventory', {})
    if (!Array.isArray(data) || data.some(row => (
      !hasExactKeys(row, [
        'id', 'admin_id', 'admin_name', 'admin_email', 'role',
        'created_at', 'last_used_at', 'expires_at', 'revoked_at',
      ])
      || !isUuid(row.id)
      || !(
        isUuid(row.admin_id)
        || (row.admin_id === null && row.revoked_at !== null)
      )
      || !isBoundedNullableIdentity(row.admin_name, 100, false)
      || !isBoundedNullableIdentity(row.admin_email, 200, true)
      || !ADMIN_ROLES.has(row.role)
      || !isIsoTimestamp(row.created_at)
      || !isNullableTimestamp(row.last_used_at)
      || !isNullableTimestamp(row.expires_at)
      || !isNullableTimestamp(row.revoked_at)
    ))) throw codedError('admin_upstream_malformed')
    return json({
      data: {
        tokens: data,
        owner_recovery: ownerRecoveryHealth(data),
      },
    })
  }

  if (resource === 'token_reconciliation') {
    if (!auth?.capabilities?.includes('issue_token')) {
      throw codedError('admin_capability_denied')
    }
    const tokenHash = (request.headers.get('x-admin-token-hash') || '').trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(tokenHash)) return json({ error: 'invalid_token_hash' }, 400)
    let rows
    try {
      rows = await rpc('admin_reconcile_issued_token', { p_token_hash: tokenHash })
    } catch {
      throw codedError('admin_upstream_failed')
    }
    if (!Array.isArray(rows) || rows.length > 1) throw codedError('admin_upstream_malformed')
    if (rows.length === 0) return json({ data: { found: false } })
    const row = rows[0]
    if (
      !hasExactKeys(row, ['id', 'admin_id', 'role', 'expires_at', 'revoked_at'])
      || !isUuid(row.id)
      || !(
        isUuid(row.admin_id)
        || (row.admin_id === null && row.revoked_at !== null)
      )
      || !ADMIN_ROLES.has(row.role)
      || (row.expires_at !== null && !isIsoTimestamp(row.expires_at))
      || (row.revoked_at !== null && !isIsoTimestamp(row.revoked_at))
    ) throw codedError('admin_upstream_malformed')
    return json({
      data: {
        found: true,
        token_id: row.id.toLowerCase(),
        admin_id: row.admin_id === null ? null : row.admin_id.toLowerCase(),
        role: row.role,
        expires_at: row.expires_at,
        revoked_at: row.revoked_at,
      },
    })
  }

  if (resource === 'idempotency_reconciliation') {
    const idempotencyKey = (url.searchParams.get('idempotency_key') || '').trim().toLowerCase()
    if (!isUuid(idempotencyKey)) return json({ error: 'invalid_idempotency_key' }, 400)
    if (!auth?.tokenHash || auth?.role !== 'owner') {
      throw codedError('admin_capability_denied')
    }
    const outcome = await rpc('admin_reconcile_idempotency_outcome', {
      p_token_hash: auth.tokenHash,
      p_idempotency_key: idempotencyKey,
    })
    if (
      !hasExactKeys(outcome, ['status'])
      || !new Set(['completed', 'running', 'not_dispatched']).has(outcome.status)
    ) throw codedError('admin_upstream_malformed')
    return json({ data: { status: outcome.status } })
  }

  if (resource === 'plaza_posts') {
    const data = await rpc('admin_list_plaza_posts', { limit_in: limit, offset_in: offset })
    return json({ data })
  }

  if (resource === 'banners') {
    // Full table incl. inactive/scheduled rows — the public banners_live view
    // only shows what's currently displayable, which is useless for managing.
    const { response: r, text } = await adminFetch(
      `${SUPABASE_URL}/rest/v1/banners?select=id,image_url,target_url,title,title_en,title_zh,priority,active,is_default,start_at,end_at,created_at&order=priority.desc,created_at.desc,id.desc&limit=${limit}&offset=${offset}`,
      { headers: supabaseHeaders(SERVICE_KEY) },
    )
    if (!r.ok) return json({ error: 'banners_read_failed' }, 500)
    return json({ data: parseUpstreamArray(text) })
  }

  return json({ error: 'unknown_resource' }, 400)
}

/*
 * Banner image upload (QA8 #7 admin half). multipart/form-data with a single
 * "file" field; stored in the public 'banners' bucket (m083) via the service
 * key — no client-writable storage policies exist, so this edge function is
 * the only write path. Returns the public CDN URL to paste into the banner
 * form. 2MB cap: banners are single marketing images, and edge request
 * bodies must stay small anyway.
 */
const BANNER_MAX_BYTES = 2 * 1024 * 1024
const BANNER_MULTIPART_MAX_BYTES = BANNER_MAX_BYTES + 256 * 1024
const BANNER_MAX_DIMENSION = 8192
const BANNER_MAX_PIXELS = 24_000_000
// Raster-only: an SVG is active XML and can become a script/phishing surface
// when opened directly from the public bucket. MIME metadata is caller-owned,
// so verify the corresponding binary signature before uploading too.
const BANNER_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

function matchesBannerMagic(bytes, mime) {
  const b = new Uint8Array(bytes)
  if (mime === 'image/png') {
    return b.length >= 8
      && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
        .every((value, index) => b[index] === value)
  }
  if (mime === 'image/jpeg') {
    return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
  }
  if (mime === 'image/webp') {
    if (b.length < 12) return false
    const riff = String.fromCharCode(...b.slice(0, 4))
    const webp = String.fromCharCode(...b.slice(8, 12))
    return riff === 'RIFF' && webp === 'WEBP'
  }
  return false
}

function bannerImageDimensions(bytes, mime) {
  const b = new Uint8Array(bytes)
  const be16 = offset => (b[offset] << 8) | b[offset + 1]
  const le16 = offset => b[offset] | (b[offset + 1] << 8)
  const be32 = offset => (
    (b[offset] * 0x1000000)
    + (b[offset + 1] << 16)
    + (b[offset + 2] << 8)
    + b[offset + 3]
  )

  if (mime === 'image/png') {
    if (b.length < 24 || String.fromCharCode(...b.slice(12, 16)) !== 'IHDR') return null
    return { width: be32(16), height: be32(20) }
  }
  if (mime === 'image/webp') {
    if (b.length < 25) return null
    const chunk = String.fromCharCode(...b.slice(12, 16))
    if (chunk === 'VP8X' && b.length >= 30) {
      const width = 1 + b[24] + (b[25] << 8) + (b[26] << 16)
      const height = 1 + b[27] + (b[28] << 8) + (b[29] << 16)
      return { width, height }
    }
    if (chunk === 'VP8 ' && b.length >= 30
        && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
      return { width: le16(26) & 0x3fff, height: le16(28) & 0x3fff }
    }
    if (chunk === 'VP8L' && b[20] === 0x2f) {
      const width = 1 + b[21] + ((b[22] & 0x3f) << 8)
      const height = 1 + ((b[22] & 0xc0) >> 6) + (b[23] << 2) + ((b[24] & 0x0f) << 10)
      return { width, height }
    }
    return null
  }
  if (mime === 'image/jpeg') {
    let offset = 2
    const startOfFrame = new Set([
      0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
      0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
    ])
    while (offset + 3 < b.length) {
      if (b[offset] !== 0xff) { offset += 1; continue }
      while (offset < b.length && b[offset] === 0xff) offset += 1
      if (offset >= b.length) return null
      const marker = b[offset]
      offset += 1
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01
          || (marker >= 0xd0 && marker <= 0xd7)) continue
      if (offset + 1 >= b.length) return null
      const segmentLength = be16(offset)
      if (segmentLength < 2 || offset + segmentLength > b.length) return null
      if (startOfFrame.has(marker)) {
        if (segmentLength < 7) return null
        return { width: be16(offset + 5), height: be16(offset + 3) }
      }
      offset += segmentLength
    }
  }
  return null
}

function bannerDimensionsAllowed(dimensions) {
  return !!dimensions
    && Number.isInteger(dimensions.width)
    && Number.isInteger(dimensions.height)
    && dimensions.width > 0
    && dimensions.height > 0
    && dimensions.width <= BANNER_MAX_DIMENSION
    && dimensions.height <= BANNER_MAX_DIMENSION
    && dimensions.width * dimensions.height <= BANNER_MAX_PIXELS
}

async function handleBannerUpload(request, auth) {
  if (!roleCanMutate(auth?.role, 'upload_banner')) {
    throw codedError('admin_capability_denied')
  }
  const idempotencyKey = (request.headers.get('idempotency-key') || '').trim()
  if (!isUuid(idempotencyKey)) throw codedError('invalid_idempotency_key')
  if (!auth?.tokenHash) throw codedError('admin_token_inactive')
  let multipartBytes
  try {
    // formData() materializes the complete multipart body. Bound and time the
    // raw stream first, and require the platform-provided Content-Length so a
    // chunked upload cannot bypass the Edge admission check.
    multipartBytes = await readRequestBytes(
      request,
      BANNER_MULTIPART_MAX_BYTES,
      { requireLength: true },
    )
  } catch (err) {
    if (err?.code === 'content_length_required') return json({ error: 'content_length_required' }, 411)
    if (err?.code === 'invalid_content_length') return json({ error: 'invalid_content_length' }, 400)
    if (err?.code === 'body_too_large') return json({ error: 'too_large', max: BANNER_MAX_BYTES }, 413)
    if (err?.code === 'request_body_timeout') return json({ error: 'request_timeout' }, 408)
    return json({ error: 'bad_multipart' }, 400)
  }

  let form
  try {
    const replay = new Request(request.url, {
      method: 'POST',
      headers: { 'Content-Type': request.headers.get('content-type') || '' },
      body: multipartBytes,
    })
    form = await replay.formData()
  } catch {
    return json({ error: 'bad_multipart' }, 400)
  }
  const file = form.get('file')
  if (!file || typeof file.arrayBuffer !== 'function') return json({ error: 'missing_file' }, 400)
  const ext = BANNER_TYPES[file.type]
  if (!ext) return json({ error: 'unsupported_type' }, 400)
  if (file.size > BANNER_MAX_BYTES) return json({ error: 'too_large', max: BANNER_MAX_BYTES }, 413)

  const bytes = await file.arrayBuffer()
  if (bytes.byteLength !== file.size || bytes.byteLength === 0) {
    return json({ error: 'invalid_image' }, 400)
  }
  if (!matchesBannerMagic(bytes, file.type)) return json({ error: 'invalid_image' }, 400)
  const dimensions = bannerImageDimensions(bytes, file.type)
  if (!bannerDimensionsAllowed(dimensions)) {
    return json({
      error: 'invalid_image_dimensions',
      max_dimension: BANNER_MAX_DIMENSION,
      max_pixels: BANNER_MAX_PIXELS,
    }, 400)
  }
  const contentHash = await sha256Bytes(bytes)
  const prepared = await executeBannerUploadStage('admin_prepare_banner_upload', {
    p_token_hash: auth.tokenHash,
    p_idempotency_key: idempotencyKey,
    p_content_hash: contentHash,
    p_mime_type: file.type,
    p_size_bytes: bytes.byteLength,
  }, {
    // Replaying a completed upload may already be available or attached. GC
    // claims and deleted rows are explicit conflicts, never a writable path.
    allowedStatuses: new Set(['prepared', 'available', 'attached']),
  })
  const expectedObjectSuffix = `/${idempotencyKey}/${contentHash}.${ext}`
  if (!prepared.object_name.endsWith(expectedObjectSuffix)) {
    throw codedError('admin_outcome_unknown')
  }

  let storageResponse
  try {
    storageResponse = await adminFetch(
      `${SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/banners/${prepared.object_name}`,
      {
        method: 'POST',
        headers: supabaseHeaders(SERVICE_KEY, '', {
          'Content-Type': file.type,
          // Deterministic overwrite removes the blind-409 trust gap: a replay
          // reasserts the exact bytes whose full SHA-256 is in the object path.
          // Only this service-key path can write the public banners bucket.
          'x-upsert': 'true',
        }),
        body: bytes,
      },
      { maxBytes: 64 * 1024 },
    )
  } catch {
    // Storage may have persisted the deterministic object before the response
    // disappeared. Retrying this same key/path with deterministic overwrite
    // reasserts the exact hash-named bytes and is therefore the safe recovery.
    throw codedError('admin_outcome_unknown')
  }
  if (!storageResponse.response.ok) {
    if (storageResponse.response.status >= 500) throw codedError('admin_outcome_unknown')
    throw codedError('admin_upstream_failed')
  }

  const completed = await executeBannerUploadStage('admin_complete_banner_upload', {
    p_token_hash: auth.tokenHash,
    p_idempotency_key: idempotencyKey,
    p_content_hash: contentHash,
  }, {
    allowedStatuses: new Set(['available', 'attached']),
    expectedObjectName: prepared.object_name,
  })
  const publicUrl = `${SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/public/banners/${completed.object_name}`
  return json({ data: { url: publicUrl } })
}

async function handlePost(request, auth) {
  let body = null
  try {
    const text = await readRequestText(request, ADMIN_JSON_MAX_BYTES)
    body = text ? JSON.parse(text) : null
  } catch (err) {
    if (err?.code === 'body_too_large') {
      return json({ error: 'body_too_large', max: ADMIN_JSON_MAX_BYTES }, 413)
    }
    if (err?.code === 'request_body_timeout') return json({ error: 'request_timeout' }, 408)
    if (err?.code === 'invalid_content_length') return json({ error: 'invalid_content_length' }, 400)
    return json({ error: 'bad_json' }, 400)
  }
  if (!body || !body.action) return json({ error: 'missing_action' }, 400)
  if (OWNER_ACTIONS.has(body.action) && !roleCanMutate(auth?.role, body.action)) {
    throw codedError('admin_capability_denied')
  }

  if (body.action === 'apply_ban') {
    if (!body.target_id || body.level == null || !body.reason) return json({ error: 'missing_args' }, 400)
    if (!isUuid(body.target_id)) return json({ error: 'invalid_id' }, 400)
    if (!Number.isInteger(body.level) || body.level < 0 || body.level > 5) {
      return json({ error: 'invalid_level' }, 400)
    }
    if (!isBoundedString(body.reason, 1000)) return json({ error: 'invalid_reason' }, 400)
    if (body.category != null && !isBoundedString(body.category, 80)) {
      return json({ error: 'invalid_category' }, 400)
    }
    if (body.hours != null && (
      !Number.isInteger(body.hours) || body.hours < 1 || body.hours > 87_600
    )) return json({ error: 'invalid_hours' }, 400)
    return json(await executeAdminMutation(request, auth, body))
  }

  if (body.action === 'lift_suspension') {
    if (!body.suspension_id || !body.reason) {
      return json({ error: 'missing_args' }, 400)
    }
    if (!isUuid(body.suspension_id)) return json({ error: 'invalid_id' }, 400)
    if (!isBoundedString(body.reason, 1000)) return json({ error: 'invalid_reason' }, 400)
    return json(await executeAdminMutation(request, auth, body))
  }

  if (body.action === 'update_report_status') {
    if (!body.report_id || !body.status) {
      return json({ error: 'missing_args' }, 400)
    }
    if (!isUuid(body.report_id)) return json({ error: 'invalid_id' }, 400)
    if (!REPORT_STATUSES.has(body.status)) return json({ error: 'invalid_status' }, 400)
    return json(await executeAdminMutation(request, auth, body))
  }

  if (body.action === 'resolve_target_reports') {
    if (!body.target_type || !body.target_id || !body.status) {
      return json({ error: 'missing_args' }, 400)
    }
    if (!REPORT_TARGET_TYPES.has(body.target_type)) return json({ error: 'invalid_target_type' }, 400)
    if (!isUuid(body.target_id)) return json({ error: 'invalid_id' }, 400)
    if (!BULK_REPORT_STATUSES.has(body.status)) return json({ error: 'invalid_status' }, 400)
    return json(await executeAdminMutation(request, auth, body))
  }

  if (body.action === 'takedown_content') {
    if (!body.target_type || !body.target_id) {
      return json({ error: 'missing_args' }, 400)
    }
    if (!TAKEDOWN_TARGET_TYPES.has(body.target_type)) return json({ error: 'invalid_target_type' }, 400)
    if (!isUuid(body.target_id)) return json({ error: 'invalid_id' }, 400)
    if (body.reason != null && !isBoundedString(body.reason, 1000)) {
      return json({ error: 'invalid_reason' }, 400)
    }
    return json(await executeAdminMutation(request, auth, body))
  }

  if (body.action === 'set_post_pinned') {
    if (!body.post_id || typeof body.pinned !== 'boolean') return json({ error: 'missing_args' }, 400)
    if (!isUuid(body.post_id)) return json({ error: 'invalid_id' }, 400)
    return json(await executeAdminMutation(request, auth, body))
  }

  if (body.action === 'upsert_banner') {
    const has = key => Object.prototype.hasOwnProperty.call(body, key)
    if (has('id') && !isUuid(body.id)) return json({ error: 'invalid_id' }, 400)
    if (has('image_url') && !isSafeBannerImage(body.image_url)) {
      return json({ error: 'invalid_image_url' }, 400)
    }
    if (has('target_url') && !isSafeBannerTarget(body.target_url)) {
      return json({ error: 'invalid_target_url' }, 400)
    }
    if (has('title_zh') && !isNullableBoundedString(body.title_zh, 200)) {
      return json({ error: 'invalid_title' }, 400)
    }
    if (has('title_en') && !isNullableBoundedString(body.title_en, 200)) {
      return json({ error: 'invalid_title' }, 400)
    }
    if (has('priority') && (
      !Number.isInteger(body.priority) || body.priority < -10_000 || body.priority > 10_000
    )) return json({ error: 'invalid_priority' }, 400)
    if (has('active') && typeof body.active !== 'boolean') return json({ error: 'invalid_active' }, 400)
    if (has('is_default') && typeof body.is_default !== 'boolean') {
      return json({ error: 'invalid_default' }, 400)
    }
    if (has('start_at') && !isNullableTimestamp(body.start_at)) {
      return json({ error: 'invalid_schedule' }, 400)
    }
    if (has('end_at') && !isNullableTimestamp(body.end_at)) {
      return json({ error: 'invalid_schedule' }, 400)
    }
    if (
      typeof body.start_at === 'string'
      && typeof body.end_at === 'string'
      && Date.parse(body.start_at) > Date.parse(body.end_at)
    ) return json({ error: 'invalid_schedule' }, 400)

    const allowed = {
      image_url:  typeof body.image_url === 'string' ? body.image_url : undefined,
      target_url: body.target_url === null || typeof body.target_url === 'string' ? body.target_url : undefined,
      title_zh:   body.title_zh === null || typeof body.title_zh === 'string' ? body.title_zh : undefined,
      title_en:   body.title_en === null || typeof body.title_en === 'string' ? body.title_en : undefined,
      priority:   Number.isInteger(body.priority) ? body.priority : undefined,
      active:     typeof body.active === 'boolean' ? body.active : undefined,
      is_default: typeof body.is_default === 'boolean' ? body.is_default : undefined,
      start_at:   body.start_at === null || typeof body.start_at === 'string' ? body.start_at : undefined,
      end_at:     body.end_at === null || typeof body.end_at === 'string' ? body.end_at : undefined,
    }
    const patch = Object.fromEntries(Object.entries(allowed).filter(([, v]) => v !== undefined))
    const isUpdate = has('id')
    if (!isUpdate && !patch.image_url) return json({ error: 'missing_image_url' }, 400)
    if (!Object.keys(patch).length) return json({ error: 'missing_args' }, 400)

    return json(await executeAdminMutation(request, auth, { action: body.action, ...(isUpdate ? { id: body.id } : {}), ...patch }))
  }

  if (body.action === 'delete_banner') {
    if (!body.id) return json({ error: 'missing_args' }, 400)
    if (!isUuid(body.id)) return json({ error: 'invalid_id' }, 400)
    return json(await executeAdminMutation(request, auth, body))
  }

  if (body.action === 'revoke_token') {
    if (!body.token_id) return json({ error: 'missing_args' }, 400)
    if (!isUuid(body.token_id)) return json({ error: 'invalid_id' }, 400)
    if (!isAuditEvidence(body.case_id)) {
      return json({ error: 'invalid_case_id' }, 400)
    }
    if (!isAuditEvidence(body.approval_ref)) {
      return json({ error: 'invalid_approval_ref' }, 400)
    }
    return json(await executeAdminMutation(request, auth, {
      action: body.action,
      token_id: body.token_id,
      case_id: body.case_id,
      approval_ref: body.approval_ref,
    }))
  }

  if (body.action === 'issue_token') {
    if (!/^[0-9a-f]{64}$/.test(body.token_hash || '')) {
      return json({ error: 'invalid_token_hash' }, 400)
    }
    if (!isUuid(body.admin_id)) return json({ error: 'invalid_id' }, 400)
    if (!ADMIN_ROLES.has(body.role)) return json({ error: 'invalid_role' }, 400)
    if (!isIsoTimestamp(body.expires_at)) return json({ error: 'invalid_expiry' }, 400)
    const expiresAt = Date.parse(body.expires_at)
    if (expiresAt <= Date.now() || expiresAt > Date.now() + 365 * 24 * 60 * 60 * 1000) {
      return json({ error: 'invalid_expiry' }, 400)
    }
    if (!isAuditEvidence(body.case_id)) return json({ error: 'invalid_case_id' }, 400)
    if (!isAuditEvidence(body.approval_ref)) {
      return json({ error: 'invalid_approval_ref' }, 400)
    }
    return json(await executeAdminMutation(request, auth, {
      action: body.action,
      token_hash: body.token_hash,
      admin_id: body.admin_id,
      role: body.role,
      expires_at: body.expires_at,
      case_id: body.case_id,
      approval_ref: body.approval_ref,
    }))
  }

  if (body.action === 'revoke_admin_tokens') {
    if (!isUuid(body.admin_id)) return json({ error: 'invalid_id' }, 400)
    if (!isAuditEvidence(body.case_id)) return json({ error: 'invalid_case_id' }, 400)
    if (!isAuditEvidence(body.approval_ref)) {
      return json({ error: 'invalid_approval_ref' }, 400)
    }
    return json(await executeAdminMutation(request, auth, {
      action: body.action,
      admin_id: body.admin_id,
      case_id: body.case_id,
      approval_ref: body.approval_ref,
    }))
  }

  return json({ error: 'unknown_action' }, 400)
}

export default async function handler(request) {
  const deploymentError = deploymentBoundaryResponse(evaluateDeploymentBoundary({ supabaseUrl: SUPABASE_URL }))
  if (deploymentError) return deploymentError
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 })

  // Reject malformed credential material locally. This prevents an arbitrary
  // header from reaching either the rate store, token authorization, or audit
  // RPCs, while preserving one exact format for both supported header paths.
  const bearer = readBearer(request)
  if (!ADMIN_BEARER_PATTERN.test(bearer)) {
    return json({ error: 'unauthorized' }, 401)
  }

  /*
   * ADM-SEC-06: per-IP rate limit, ahead of auth so credential-stuffing /
   * audit-spam / flood is throttled before any token work. 120 req/min is far
   * above any legitimate admin's burst. A missing or drifting rate-store
   * response fails closed before authorization/audit RPCs so an outage cannot
   * be turned into an unbounded database-call amplifier.
   */
  if (SUPABASE_URL && SERVICE_KEY) {
    try {
      const forwarded = request.headers.get('x-vercel-forwarded-for')
        || request.headers.get('x-forwarded-for')
        || ''
      const ip = forwarded.split(',')[0].trim() || 'unknown'
      const bucket = 'admin:network:' + (await hmacHex('admin-rate-network', ip))
      const allowed = await rpc('edge_rate_hit', { bucket_in: bucket, max_in: 120, window_secs_in: 60 })
      if (allowed === false) return json({ error: 'rate_limited' }, 429)
      if (allowed !== true) return json({ error: 'rate_limit_unavailable' }, 503)
    } catch (err) {
      console.warn('[admin] rate check failed (fail-closed)', stableErrorCode(err))
      return json({ error: 'rate_limit_unavailable' }, 503)
    }
  }

  const auth = await validateBearer(bearer)
  if (!auth.ok) {
    if (auth.source === 'unavailable') {
      return json({ error: 'auth_unavailable' }, 503)
    }
    /*
     * Audit unauthorized attempts. Useful for spotting credential
     * stuffing or a leaked-token scenario in the wild. We deliberately
     * include only minimal fingerprinting (the SHA-256 prefix of the
     * presented bearer) so the audit log itself doesn't become a
     * leak vector.
     */
    if (bearer && SUPABASE_URL && SERVICE_KEY) {
      try {
        const presentedHash = await sha256Hex(bearer)
        await rpc('record_audit', {
          event_kind_in: 'admin_unauthorized',
          actor_id_in:   null,
          target_id_in:  null,
          details_in: {
            source: auth.source,
            hash_prefix: presentedHash.slice(0, 8),
          },
        })
      } catch (err) {
        await reportAuditFailure('admin_unauthorized', err)
      }
    }
    return json({ error: auth.source === 'missing' ? 'unauthorized' : 'unauthorized' }, 401)
  }

  // The dashboard calls whoami once after a successful unlock. Recording a
  // "login" on every list row, refresh and mutation both floods the audit log
  // and adds a provider round-trip before each destructive action.
  const isLoginProbe = request.method === 'GET'
    && new URL(request.url).searchParams.get('resource') === 'whoami'
  if (auth.source === 'token' && isLoginProbe) {
    await recordAdminLogin(auth)
  }

  try {
    if (request.method === 'GET')  return await handleGet(request, auth)
    if (request.method === 'POST') {
      // Banner image upload is the one non-JSON POST (multipart body) — route
      // it before handlePost's request.json() would eat the stream.
      const ctype = request.headers.get('content-type') || ''
      if (ctype.includes('multipart/form-data')) return await handleBannerUpload(request, auth)
      return await handlePost(request, auth)
    }
    return json({ error: 'method_not_allowed' }, 405)
  } catch (err) {
    const error = stableErrorCode(err)
    const status = error === 'invalid_idempotency_key' || error === 'admin_mutation_invalid' ? 400
      : error === 'admin_token_inactive' ? 401
        : error === 'admin_capability_denied' ? 403
          : error === 'idempotency_conflict' || error === 'admin_mutation_conflict' ? 409
          : error === 'admin_mutation_not_found' ? 404
            : error === 'admin_outcome_unknown' ? 503
              : 500
    return json({ error }, status)
  }
}
