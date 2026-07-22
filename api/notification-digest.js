import { deploymentBoundaryResponse, evaluateDeploymentBoundary } from './_deployment-boundary.js'

export const config = { runtime: 'edge' }

/*
 * Off-platform notification digest (the biggest retention leak: notifications
 * were in-app only). Reads un-emailed notification rows via the service key,
 * groups per user, sends each user a digest via Resend, and marks the rows
 * emailed_at so they're never sent twice. Intended to run on a daily Vercel
 * cron (see vercel.json), but is also safe to hit manually for testing.
 *
 * SAFETY — this sends real email, so the gate is deliberately paranoid:
 *   · Requires Authorization: Bearer ${CRON_SECRET} (timing-safe). If
 *     CRON_SECRET is unset the route refuses everything.
 *   · DIGEST_TEST_EMAIL set  → sends deterministic synthetic sample rows to
 *     that one address. Production notification content is never previewed.
 *   · DIGEST_TEST_EMAIL unset AND DIGEST_LIVE !== 'true' → refuses to send.
 *     So the only way to email real users is to explicitly set DIGEST_LIVE=true
 *     AND clear DIGEST_TEST_EMAIL — two deliberate actions. Default is inert.
 *
 * Env (set in Vercel): SUPABASE_URL, SUPABASE_SECRET_KEY (preferred; legacy
 * SUPABASE_SERVICE_ROLE_KEY remains a rolling fallback),
 * RESEND_API_KEY, CRON_SECRET, DIGEST_TEST_EMAIL (test), DIGEST_LIVE ('true' to
 * go live), DIGEST_FROM (sender on the Resend-verified illinimarket.com domain;
 * defaults to "Illini Market <noreply@send.illinimarket.com>").
 */

function env(name, fallback = '') { return process.env[name] || fallback }
const DEFAULT_APP_URL = 'https://illinimarket.com'

function strictAppOrigin(value) {
  try {
    const parsed = new URL(value)
    if (
      parsed.protocol !== 'https:' || parsed.username || parsed.password ||
      parsed.pathname !== '/' || parsed.search || parsed.hash
    ) return ''
    return parsed.origin
  } catch {
    return ''
  }
}

const SUPABASE_URL = env('SUPABASE_URL', env('VITE_SUPABASE_URL'))
const SERVICE_KEY = env('SUPABASE_SECRET_KEY', env('SUPABASE_SERVICE_ROLE_KEY'))
const RESEND_API_KEY = env('RESEND_API_KEY')
const CRON_SECRET = env('CRON_SECRET')
const TEST_EMAIL = env('DIGEST_TEST_EMAIL')
const LIVE = env('DIGEST_LIVE') === 'true'
const EXPLICIT_APP_URL = env('DEPLOYMENT_APP_ORIGIN', env('DIGEST_APP_URL'))
const EXPLICIT_APP_ORIGIN = strictAppOrigin(EXPLICIT_APP_URL)
const APP_URL = EXPLICIT_APP_ORIGIN || DEFAULT_APP_URL
const VERCEL_ENV = env('VERCEL_ENV').toLowerCase()
const VERCEL_URL = env('VERCEL_URL').toLowerCase()
// Resend requires the From address to be on a domain verified in Resend.
// Eric verifies the send.illinimarket.com subdomain; override via DIGEST_FROM.
const FROM = env('DIGEST_FROM', 'Illini Market <noreply@send.illinimarket.com>')
// Same Sentry project as client errors + admin audit failures — one dashboard.
const SENTRY_DSN = env('SENTRY_DSN', env('VITE_SENTRY_DSN', ''))
const WINDOW_DAYS = 7
const MAX_ROWS = 40
const NOTIFICATION_PAGE_SIZE = MAX_ROWS * 5
const MAX_NOTIFICATION_SCAN_PAGES = 25
const MAX_DIGEST_USERS = 200
const EMAIL_CONCURRENCY = 8
const LIVE_RUN_LOCK_WINDOW_SECS = 15 * 60
const MAX_UPSTREAM_RESPONSE_BYTES = 2 * 1024 * 1024
const SUPABASE_TIMEOUT_MS = 5_000
const RESEND_TIMEOUT_MS = 8_000
const SENTRY_TIMEOUT_MS = 2_000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function liveAppOriginReady() {
  if (!EXPLICIT_APP_ORIGIN) return false
  if (!VERCEL_ENV || VERCEL_ENV === 'production') return true
  if (!VERCEL_URL) return true
  try {
    return new URL(EXPLICIT_APP_ORIGIN).host.toLowerCase() === VERCEL_URL
  } catch {
    return false
  }
}

function supabaseHeaders(key, authorization = '', extra = {}) {
  const headers = { apikey: key, ...extra }
  if (authorization) headers.Authorization = authorization
  else if (!/^sb_(?:publishable|secret)_/.test(key)) headers.Authorization = `Bearer ${key}`
  return headers
}
// Unread-message reminder: a chat message unread for at least this long seeds a
// one-shot 'unread_message' notification that rides this same digest (migration 070).
const UNREAD_REMINDER_HOURS = 12

async function fetchWithTimeout(input, init, timeoutMs) {
  const controller = new AbortController()
  let reader = null
  let timer
  const operation = (async () => {
    const response = await fetch(input, {
      ...(init || {}),
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

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let m = 0
  for (let i = 0; i < a.length; i++) m |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return m === 0
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

/* Best-effort Sentry alert (same store endpoint + DSN parsing as api/admin).
   Fires when a live digest run has send/mark failures so the gap pages someone
   instead of only landing in Vercel logs. No-op without a DSN. */
async function reportToSentry(message, extra) {
  if (!SENTRY_DSN) return
  try {
    const m = SENTRY_DSN.match(/^https:\/\/([^@]+)@([^/]+)\/(.+)$/)
    if (!m) return
    const [, key, host, projectId] = m
    await fetchWithTimeout(`https://${host}/api/${projectId}/store/?sentry_key=${key}&sentry_version=7`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        level: 'error',
        platform: 'javascript',
        logger: 'api/notification-digest',
        environment: VERCEL_ENV || 'unknown',
        release: env('VERCEL_GIT_COMMIT_SHA').slice(0, 7) || undefined,
        extra: extra || {},
      }),
    }, SENTRY_TIMEOUT_MS)
  } catch { /* a monitoring failure must never affect the run */ }
}

const TYPE_ICON = { price_drop: '↓', sold: '✓', offer: '$', meetup: '📍', system: '🔔', unread_message: '✉' }

function rowHtml(n) {
  const icon = TYPE_ICON[n.type] || '🔔'
  return `<tr><td style="padding:12px 0;border-bottom:1px solid #ECE5DA;vertical-align:top">
    <span style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;border-radius:50%;background:#F5D9CE;color:#A03A24;font-weight:700;font-size:13px">${esc(icon)}</span>
  </td><td style="padding:12px 0 12px 12px;border-bottom:1px solid #ECE5DA">
    <div style="font-size:15px;font-weight:600;color:#2A2521">${esc(n.title)}</div>
    ${n.body ? `<div style="font-size:13px;color:#6B6459;margin-top:2px">${esc(n.body)}</div>` : ''}
  </td></tr>`
}

function digestHtml(rows, isSample, unsubToken) {
  const items = rows.map(rowHtml).join('')
  const unsub = unsubToken
    ? `不想再收到邮件提醒？<a href="${esc(APP_URL)}/api/unsubscribe?t=${esc(unsubToken)}" style="color:#A39A8C">一键退订 Unsubscribe</a>`
    : '示例预览 · Sample preview'
  return `<!DOCTYPE html><html><body style="margin:0;background:#F7F4EE;font-family:-apple-system,'Segoe UI',sans-serif">
  <div style="max-width:520px;margin:0 auto;padding:24px 16px">
    <div style="text-align:center;margin-bottom:8px">
      <span style="display:inline-block;width:40px;height:40px;line-height:40px;border-radius:10px;background:#C74A2F;color:#fff;font-weight:700;font-size:20px">集</span>
    </div>
    <h1 style="font-family:Georgia,serif;font-size:22px;color:#2A2521;text-align:center;margin:8px 0 2px">香槟集市</h1>
    <p style="text-align:center;color:#8B8478;font-size:13px;margin:0 0 20px">你有 ${rows.length} 条新动态 · You have ${rows.length} update${rows.length === 1 ? '' : 's'}${isSample ? ' · 示例 Sample' : ''}</p>
    <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:16px;padding:4px 16px" cellpadding="0" cellspacing="0">
      <tbody><tr><td style="padding:4px 16px"><table style="width:100%;border-collapse:collapse" cellpadding="0" cellspacing="0"><tbody>${items}</tbody></table></td></tr></tbody>
    </table>
    <div style="text-align:center;margin:24px 0">
      <a href="${esc(APP_URL)}" style="display:inline-block;background:#C74A2F;color:#fff;text-decoration:none;padding:12px 28px;border-radius:999px;font-weight:600;font-size:15px">打开集市 · Open</a>
    </div>
    <p style="text-align:center;color:#A39A8C;font-size:11px;line-height:1.6;margin-top:24px">
      香槟集市 · UIUC 校园二手集市 · Champaign-Urbana, IL<br>
      ${unsub}
    </p>
  </div></body></html>`
}

const SAMPLE_ROWS = [
  { type: 'system', title: '系统通知 · System notice', body: '示例预览 · Sample preview' },
  { type: 'sold', title: '商品已售出 · Item sold', body: '示例商品 · Sample item' },
  { type: 'price_drop', title: '降价提醒 · Price drop', body: '你收藏的「IKEA 书桌」降到 $30' },
]

// These are the complete notification types in the current schema, split by
// whether their content must be routed through a verified conversation. Every
// unknown/future type is closed until explicitly reviewed for email delivery.
const SAFE_UNROUTED_NOTIFICATION_TYPES = new Set(['price_drop', 'system', 'sold'])
const SAFE_CONVERSATION_NOTIFICATION_TYPES = new Set(['offer', 'meetup', 'unread_message'])

async function supabaseError(prefix, response) {
  const body = await response.text().catch(() => '')
  const error = new Error(`${prefix} ${response.status}`)
  error.status = response.status
  try {
    const detail = JSON.parse(body)
    error.code = detail?.code
    // Keep only the small schema diagnostics needed for the rolling
    // notification-column probe. Never retain arbitrary PostgREST bodies or
    // row values on an error that may later reach logs/telemetry.
    error.details = typeof detail?.details === 'string' ? detail.details.slice(0, 512) : ''
    error.hint = typeof detail?.hint === 'string' ? detail.hint.slice(0, 512) : ''
    error.remoteMessage = typeof detail?.message === 'string' ? detail.message.slice(0, 512) : ''
  } catch { /* PostgREST normally returns JSON; status still remains useful */ }
  return error
}

async function sbGet(path) {
  const r = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: supabaseHeaders(SERVICE_KEY),
  }, SUPABASE_TIMEOUT_MS)
  if (!r.ok) throw await supabaseError('supabase read', r)
  const rows = await r.json().catch(() => null)
  if (!Array.isArray(rows)) throw new Error('invalid supabase response')
  return rows
}

async function sbRpc(fn, args) {
  const r = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: supabaseHeaders(SERVICE_KEY, '', {
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify(args || {}),
  }, SUPABASE_TIMEOUT_MS)
  if (!r.ok) throw new Error(`rpc ${fn} ${r.status}`)
  return r.json().catch(() => null)
}

function parseDeliveryClaim(rows, expectedKind) {
  if (!Array.isArray(rows) || rows.length > 1) throw new Error('invalid delivery claim')
  if (rows.length === 0) return null
  const row = rows[0]
  const ids = row?.notification_ids
  if (
    typeof row?.delivery_key !== 'string' ||
    !row.delivery_key.startsWith(`${expectedKind}/`) ||
    !UUID_RE.test(row?.claim_token || '') ||
    !Array.isArray(ids) || ids.length < 1 || ids.length > MAX_ROWS ||
    ids.some(id => !UUID_RE.test(id)) || new Set(ids).size !== ids.length
  ) throw new Error('invalid delivery claim')
  return { key: row.delivery_key, token: row.claim_token, notificationIds: ids }
}

async function claimNotificationEmailDelivery(ids, kind) {
  return parseDeliveryClaim(await sbRpc('claim_notification_email_delivery', {
    notification_ids_in: ids,
    delivery_kind_in: kind,
    lease_seconds_in: 120,
  }), kind)
}

async function beginNotificationEmailDelivery(claim) {
  return sbRpc('begin_notification_email_delivery', {
    claim_token_in: claim.token,
    delivery_key_in: claim.key,
    lease_seconds_in: 600,
  })
}

async function completeNotificationEmailDelivery(claim) {
  return sbRpc('complete_notification_email_delivery', {
    claim_token_in: claim.token,
    delivery_key_in: claim.key,
  })
}

async function releaseNotificationEmailDelivery(claim) {
  return sbRpc('release_notification_email_delivery', {
    claim_token_in: claim.token,
    delivery_key_in: claim.key,
  })
}

function pairKey(userA, userB) {
  if (!userA || !userB || userA === userB) return ''
  return userA < userB ? `${userA}:${userB}` : `${userB}:${userA}`
}

function chunks(values, size) {
  const out = []
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size))
  return out
}

/*
 * Resolve exact participant pairs in small OR-query chunks. Querying
 * blocker_id=in.(all users)&blocked_id=in.(all users) can hit PostgREST's row
 * cap with unrelated cross-pair blocks and produce a dangerous false negative.
 * Every chunk must succeed before callers mutate or send; any failure throws
 * and therefore closes that email path.
 */
async function loadBlockedPairKeys(pairs) {
  const unique = new Map()
  for (const [userA, userB] of pairs) {
    const key = pairKey(userA, userB)
    if (key && !unique.has(key)) unique.set(key, [userA, userB])
  }

  const blocked = new Set()
  for (const group of chunks([...unique.values()], 20)) {
    const clauses = group.flatMap(([userA, userB]) => {
      const a = encodeURIComponent(userA)
      const b = encodeURIComponent(userB)
      return [
        `and(blocker_id.eq.${a},blocked_id.eq.${b})`,
        `and(blocker_id.eq.${b},blocked_id.eq.${a})`,
      ]
    })
    const rows = await sbGet(
      `blocks?or=(${clauses.join(',')})&select=blocker_id,blocked_id&limit=${clauses.length}`,
    )
    for (const row of rows) {
      const key = pairKey(row.blocker_id, row.blocked_id)
      if (key) blocked.add(key)
    }
  }
  return blocked
}

function isMissingNotificationConversationColumn(error) {
  if (error?.status !== 400) return false
  if (error?.code !== '42703' && error?.code !== 'PGRST204') return false
  const detail = `${error?.remoteMessage || ''} ${error?.details || ''} ${error?.hint || ''}`
  return /(^|[^a-z0-9_])conversation_id([^a-z0-9_]|$)/i.test(detail)
}

async function notificationConversationColumnAvailable() {
  try {
    // limit=0 is a schema capability probe: it validates the projection without
    // reading or exposing any notification row.
    await sbGet('notifications?select=conversation_id&limit=0')
    return true
  } catch (error) {
    if (isMissingNotificationConversationColumn(error)) return false
    throw error
  }
}

async function loadPendingNotificationPage(since, conversationColumnAvailable, afterUserId) {
  const cursor = afterUserId ? `&user_id=gt.${encodeURIComponent(afterUserId)}` : ''
  const prefix = `notifications?emailed_at=is.null&created_at=gte.${since}${cursor}`
  const suffix = `&order=user_id.asc,created_at.desc&limit=${NOTIFICATION_PAGE_SIZE}`
  const currentPath = `${prefix}&select=id,user_id,type,title,body,created_at,conversation_id${suffix}`
  const legacyPath = `${prefix}&select=id,user_id,type,title,body,created_at${suffix}`

  if (conversationColumnAvailable === true) return sbGet(currentPath)
  if (conversationColumnAvailable === false) {
    const legacyRows = await sbGet(legacyPath)
    return legacyRows.map(row => ({ ...row, conversation_id: null }))
  }

  try {
    return await sbGet(currentPath)
  } catch (error) {
    // Production may run this API before the pending migration that adds the
    // nullable routing column. Fall back only for the precise missing-column
    // error; conversation-derived rows are filtered below, while safe item and
    // system notifications may still send. Every unrelated failure is closed.
    if (!isMissingNotificationConversationColumn(error)) throw error
    const legacyRows = await sbGet(legacyPath)
    return legacyRows.map(row => ({ ...row, conversation_id: null }))
  }
}

async function loadPendingNotifications(since, conversationColumnAvailable) {
  const rows = []
  const users = new Set()
  let afterUserId = ''

  // Keyset by user_id instead of one global LIMIT. With the old single query,
  // one noisy/opted-out account could occupy all 200 rows and indefinitely
  // starve every lexicographically later recipient. We intentionally keep at
  // most MAX_ROWS for the page's trailing user and advance past it; unsent rows
  // stay durable for a later run while other users still make progress now.
  for (let page = 0; page < MAX_NOTIFICATION_SCAN_PAGES; page++) {
    const batch = await loadPendingNotificationPage(since, conversationColumnAvailable, afterUserId)
    if (!batch.length) break

    for (const row of batch) {
      if (typeof row.user_id !== 'string' || !row.user_id) continue
      if (!users.has(row.user_id) && users.size >= MAX_DIGEST_USERS) continue
      users.add(row.user_id)
      rows.push(row)
    }

    if (batch.length < NOTIFICATION_PAGE_SIZE || users.size >= MAX_DIGEST_USERS) break
    const nextUserId = batch[batch.length - 1]?.user_id
    if (typeof nextUserId !== 'string' || !nextUserId || nextUserId === afterUserId) {
      throw new Error('notification pagination did not advance')
    }
    afterUserId = nextUserId
  }
  return rows
}

async function loadNotificationsByIds(ids, conversationColumnAvailable) {
  if (!ids.length) return []
  const inList = `(${ids.map(encodeURIComponent).join(',')})`
  const prefix = `notifications?id=in.${inList}`
  if (conversationColumnAvailable) {
    return sbGet(`${prefix}&select=id,user_id,type,title,body,created_at,conversation_id&limit=${ids.length}`)
  }
  const legacyRows = await sbGet(
    `${prefix}&select=id,user_id,type,title,body,created_at&limit=${ids.length}`,
  )
  return legacyRows.map(row => ({ ...row, conversation_id: null }))
}

function canEmailWithoutConversation(row) {
  return !row.conversation_id && SAFE_UNROUTED_NOTIFICATION_TYPES.has(row.type)
}

function canEmailWithConversation(row) {
  return Boolean(row.conversation_id && SAFE_CONVERSATION_NOTIFICATION_TYPES.has(row.type))
}

async function filterBlockedConversationNotifications(rows) {
  // Both routed and unrouted types are explicit allowlists. A future schema
  // value must receive an off-platform privacy review before this API emails
  // it, even when it happens to carry a valid conversation id.
  const eligibleRows = rows.filter(row => canEmailWithConversation(row) || canEmailWithoutConversation(row))
  const conversationIds = [...new Set(eligibleRows.map(row => row.conversation_id).filter(Boolean))]
  if (!conversationIds.length) return eligibleRows.filter(canEmailWithoutConversation)

  const conversations = []
  for (const group of chunks(conversationIds, 50)) {
    const inList = `(${group.map(encodeURIComponent).join(',')})`
    conversations.push(...await sbGet(
      `conversations?id=in.${inList}&select=id,buyer_id,seller_id&limit=${group.length}`,
    ))
  }
  const byId = new Map(conversations.map(row => [row.id, row]))
  const blockedPairs = await loadBlockedPairKeys(
    conversations.map(row => [row.buyer_id, row.seller_id]),
  )

  return eligibleRows.filter(row => {
    if (!row.conversation_id) return canEmailWithoutConversation(row)
    const conversation = byId.get(row.conversation_id)
    // Missing/corrupt routing data is not safe to email. The notification stays
    // un-stamped for diagnosis instead of leaking conversation content.
    if (!conversation) return false
    if (row.user_id !== conversation.buyer_id && row.user_id !== conversation.seller_id) return false
    return !blockedPairs.has(pairKey(conversation.buyer_id, conversation.seller_id))
  })
}

/*
 * Migration 20260718260000 owns reminder selection, block/mute/recipient
 * checks, notification insertion, and reminded_at stamps in one transaction.
 * Edge code makes one bounded RPC call and validates its small metrics object;
 * there is no cross-HTTP split state left to misreport or strand.
 */
async function generateDigestReminders() {
  const result = await sbRpc('seed_digest_reminders', {
    meetup_limit_in: 200,
    message_limit_in: 500,
    unread_hours_in: UNREAD_REMINDER_HOURS,
  })
  const keys = [
    'meetup_sources_scanned',
    'meetup_reminders',
    'meetup_notifications',
    'unread_messages_scanned',
    'unread_reminders',
  ]
  if (!result || Array.isArray(result) || keys.some(key => (
    !Number.isSafeInteger(result[key]) || result[key] < 0
  ))) {
    throw new Error('invalid reminder seed response')
  }
  return result
}

async function resendSend(to, subject, html, idempotencyKey = '') {
  const headers = { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
  const r = await fetchWithTimeout('https://api.resend.com/emails', {
    method: 'POST',
    headers,
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
  }, RESEND_TIMEOUT_MS)
  // Provider error bodies may reflect recipient or account metadata; status is
  // sufficient for operations and keeps those details out of application logs.
  if (!r.ok) throw new Error(`resend ${r.status}`)
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })
}

export default async function handler(req) {
  const deploymentError = deploymentBoundaryResponse(evaluateDeploymentBoundary({ supabaseUrl: SUPABASE_URL }))
  if (deploymentError) return deploymentError
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405)

  // Auth — require the documented Bearer scheme exactly. Accepting the raw
  // secret as an Authorization value makes proxy/header mistakes harder to
  // detect and broadens the credential parser unnecessarily.
  const auth = req.headers.get('authorization') || ''
  const match = /^Bearer ([^\s]+)$/i.exec(auth)
  const bearer = match?.[1] || ''
  if (!CRON_SECRET || !timingSafeEqual(bearer, CRON_SECRET)) return json({ error: 'unauthorized' }, 401)

  // Paranoid send gate. An intentionally inert deployment does not require
  // provider/database credentials because it performs no external work.
  if (!TEST_EMAIL && !LIVE) {
    return json({ skipped: 'inert: set DIGEST_TEST_EMAIL to test, or DIGEST_LIVE=true to send to users' })
  }
  if (!RESEND_API_KEY) return json({ error: 'RESEND_API_KEY missing' }, 500)
  if (!TEST_EMAIL && LIVE && !liveAppOriginReady()) {
    return json({ error: 'live_app_origin_required' }, 500)
  }

  // Test mode sends deterministic synthetic rows only. The old implementation
  // queried production notifications and forwarded their real titles/bodies to
  // the operator's test mailbox, which was a cross-user privacy disclosure.
  if (TEST_EMAIL) {
    try {
      await resendSend(
        TEST_EMAIL,
        `香槟集市 · ${SAMPLE_ROWS.length} 条新动态（示例）`,
        digestHtml(SAMPLE_ROWS, true),
      )
      return json({ mode: 'test', sentTo: 'DIGEST_TEST_EMAIL', sample: true, previewed: 0 })
    } catch {
      return json({ error: 'test_send_failed' }, 502)
    }
  }

  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'supabase env missing' }, 500)

  // A trusted cron may still overlap with a platform retry or a manual run.
  // Use the existing atomic DB counter as a short distributed lease before any
  // read/send/mark work. This closes the duplicate-digest race across isolates.
  let runClaim
  try {
    runClaim = await sbRpc('edge_rate_hit', {
      bucket_in: 'notification-digest-live-run',
      max_in: 1,
      window_secs_in: LIVE_RUN_LOCK_WINDOW_SECS,
    })
  } catch {
    return json({ error: 'run_guard_unavailable' }, 503)
  }
  if (runClaim === false) return json({ error: 'digest_run_locked' }, 429)
  if (runClaim !== true) return json({ error: 'run_guard_unavailable' }, 503)

  try {
    const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString()

    // Probe the routing schema BEFORE any reminder source is stamped. On the
    // legacy schema we keep safe item/system digests working, but conversation
    // reminders stay untouched until the routing migration is available.
    const conversationColumnAvailable = await notificationConversationColumnAvailable()

    let meetupReminders = 0
    let unreadReminders = 0
    let reminderFailures = 0
    if (conversationColumnAvailable) {
      try {
        const reminderSeed = await generateDigestReminders()
        meetupReminders = reminderSeed.meetup_reminders
        unreadReminders = reminderSeed.unread_reminders
      } catch (error) {
        reminderFailures = 1
        console.error('notification_digest_reminder_seed_failed')
      }
    }

    const rows = await loadPendingNotifications(since, conversationColumnAvailable)

    // LIVE MODE — per-user digests to real emails (requires DIGEST_LIVE=true).
    const byUser = new Map()
    const mailCandidates = rows.filter(row => canEmailWithConversation(row) || canEmailWithoutConversation(row))
    for (const notification of mailCandidates) {
      if (!byUser.has(notification.user_id)) byUser.set(notification.user_id, [])
      const userRows = byUser.get(notification.user_id)
      // Keep the bounded scan intact, but do not apply the per-email cap until
      // blocked/missing conversation rows have been removed. Otherwise 40
      // suppressed rows at the head of one account permanently starve its next
      // safe system or price-drop notification.
      userRows.push(notification)
    }
    const userIds = [...byUser.keys()]

    if (!userIds.length) {
      if (reminderFailures > 0) {
        await reportToSentry('notification digest: reminder generation failure(s)', { reminderFailures })
      }
      return json(
        { mode: 'live', usersNotified: 0, notifications: 0, sendFailed: 0, markFailed: 0, reminderFailures, meetupReminders, unreadReminders },
        reminderFailures > 0 ? 500 : 200,
      )
    }

    // Chunk profile lookups so a busy day cannot exceed proxy/PostgREST URL
    // limits with one `id=in.(...)` query.
    const profiles = []
    for (const group of chunks(userIds, 50)) {
      profiles.push(...await sbGet(
        `profiles?id=in.(${group.map(encodeURIComponent).join(',')})&email_digest_opt_out=is.false&select=id,email,unsubscribe_token`,
      ))
    }
    const mailable = profiles.filter(profile =>
      typeof profile.email === 'string' &&
      profile.email.length > 0 &&
      !profile.email.endsWith('@wechat.placeholder')
    )
    const emailById = new Map(mailable.map(profile => [profile.id, profile.email]))
    const tokenById = new Map(mailable.map(profile => [profile.id, profile.unsubscribe_token]))

    let usersNotified = 0
    let sentCount = 0
    let sendFailed = 0
    let markFailed = 0

    async function deliverUserDigest(userId) {
      const to = emailById.get(userId)
      let userRows = byUser.get(userId)
      if (!to || !userRows.length) return

      try {
        userRows = await filterBlockedConversationNotifications(userRows)
      } catch (error) {
        sendFailed++
        console.error('notification_digest_block_boundary_failed')
        return
      }
      userRows = userRows.slice(0, MAX_ROWS)
      if (!userRows.length) return

      let providerAccepted = false
      let deliveryClaim = null
      try {
        deliveryClaim = await claimNotificationEmailDelivery(
          userRows.map(row => row.id),
          'digest',
        )
        // A concurrent immediate sender or digest worker owns every candidate.
        // That is normal arbitration, not an email failure.
        if (!deliveryClaim) return

        let claimedRows = await loadNotificationsByIds(
          deliveryClaim.notificationIds,
          conversationColumnAvailable,
        )
        if (
          claimedRows.length !== deliveryClaim.notificationIds.length ||
          claimedRows.some(row => row.user_id !== userId) ||
          new Set(claimedRows.map(row => row.id)).size !== claimedRows.length
        ) throw new Error('claimed notification set changed')

        // A recovered sticky batch can include rows outside this scan page.
        // Re-resolve its exact rows and repeat the block/routing gate as close
        // as possible to the provider call.
        claimedRows = await filterBlockedConversationNotifications(claimedRows)
        const claimedIdSet = new Set(deliveryClaim.notificationIds)
        if (
          claimedRows.length !== deliveryClaim.notificationIds.length ||
          claimedRows.some(row => !claimedIdSet.has(row.id))
        ) {
          await releaseNotificationEmailDelivery(deliveryClaim)
          deliveryClaim = null
          return
        }
        claimedRows.sort((left, right) => {
          const byCreated = String(right.created_at).localeCompare(String(left.created_at))
          return byCreated || String(left.id).localeCompare(String(right.id))
        })

        const began = await beginNotificationEmailDelivery(deliveryClaim)
        if (began !== claimedRows.length) throw new Error('delivery claim expired')
        await resendSend(
          to,
          `香槟集市 · 你有 ${claimedRows.length} 条新动态 · ${claimedRows.length} update${claimedRows.length === 1 ? '' : 's'}`,
          digestHtml(claimedRows, false, tokenById.get(userId)),
          deliveryClaim.key,
        )
        providerAccepted = true
        const completed = await completeNotificationEmailDelivery(deliveryClaim)
        if (completed !== claimedRows.length) throw new Error('delivery acknowledgement rejected')
        usersNotified++
        sentCount += claimedRows.length
      } catch (error) {
        if (deliveryClaim) {
          await releaseNotificationEmailDelivery(deliveryClaim).catch(() => {})
        }
        if (providerAccepted) markFailed++
        else sendFailed++
        console.error(
          providerAccepted
            ? 'notification_digest_complete_failed'
            : 'notification_digest_send_failed',
        )
      }
    }

    // Keep throughput bounded but avoid a fully sequential batch: 200 users at
    // multiple network round-trips each can exceed an edge invocation window.
    for (const group of chunks(userIds, EMAIL_CONCURRENCY)) {
      await Promise.all(group.map(deliverUserDigest))
    }

    const failed = sendFailed + markFailed + reminderFailures
    if (failed > 0) {
      await reportToSentry(`notification digest: ${failed} failure(s)`, {
        sendFailed,
        markFailed,
        reminderFailures,
        usersNotified,
        notifications: sentCount,
      })
    }
    return json(
      { mode: 'live', usersNotified, notifications: sentCount, sendFailed, markFailed, reminderFailures, meetupReminders, unreadReminders },
      failed > 0 ? 500 : 200,
    )
  } catch (error) {
    console.error('notification_digest_failed')
    await reportToSentry('notification digest: fatal failure', { phase: 'live_run' })
    return json({ error: 'internal' }, 500)
  }
}
