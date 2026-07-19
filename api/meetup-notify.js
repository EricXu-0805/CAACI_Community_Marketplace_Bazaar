import { deploymentBoundaryResponse, evaluateDeploymentBoundary } from './_deployment-boundary.js'

export const config = { runtime: 'edge' }

/*
 * Instant email for meetup actions (QA8 #8). Meetup RPCs already write
 * type='meetup' notification rows, but off-platform delivery waited for the
 * daily digest — a 约见/确认/婉拒/改约 sat invisible for up to 23h. The client
 * fire-and-forgets a POST here right after a successful meetup RPC; this
 * endpoint derives the recipient from DB state and emails them immediately.
 * The daily digest stays the fallback: if this call never lands, the
 * notification row still rides the next digest. After a successful send we
 * stamp the recipient's fresh meetup notification rows emailed_at so the
 * digest doesn't re-deliver them.
 *
 * Security posture:
 *   · JWT verified against /auth/v1/user BEFORE any work (ADM-SEC-07).
 *   · Caller must be a participant of the meetup (from_user or to_user).
 *   · Per-user rate limit via edge_rate_hit (m082): 10 sends/hour — a chat
 *     pair realistically produces a handful of meetup actions.
 *   · Same paranoid send gate as the digest: DIGEST_TEST_EMAIL reroutes
 *     everything to the test address; without it DIGEST_LIVE='true' is
 *     required to email a real user; neither set → inert 200.
 *   · profiles.email_digest_opt_out is honored — unsubscribed users get
 *     nothing from this path either.
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
const ANON_KEY = env(
  'SUPABASE_PUBLISHABLE_KEY',
  env('SUPABASE_ANON_KEY', env('VITE_SUPABASE_PUBLISHABLE_KEY', env('VITE_SUPABASE_ANON_KEY'))),
)
const RESEND_API_KEY = env('RESEND_API_KEY')
const TEST_EMAIL = env('DIGEST_TEST_EMAIL')
const LIVE = env('DIGEST_LIVE') === 'true'
const EXPLICIT_APP_URL = env('DEPLOYMENT_APP_ORIGIN', env('MEETUP_APP_URL', env('DIGEST_APP_URL')))
const EXPLICIT_APP_ORIGIN = strictAppOrigin(EXPLICIT_APP_URL)
const APP_URL = EXPLICIT_APP_ORIGIN || DEFAULT_APP_URL
const VERCEL_ENV = env('VERCEL_ENV').toLowerCase()
const VERCEL_URL = env('VERCEL_URL').toLowerCase()
const FROM = env('DIGEST_FROM', 'Illini Market <noreply@send.illinimarket.com>')

const RATE_MAX = 10
const RATE_WINDOW_SECS = 3600
const MAX_REQUEST_BYTES = 2 * 1024
const MAX_UPSTREAM_RESPONSE_BYTES = 512 * 1024
const REQUEST_BODY_TIMEOUT_MS = 5_000
const SUPABASE_TIMEOUT_MS = 5_000
const RESEND_TIMEOUT_MS = 8_000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function liveAppOriginReady() {
  // Every real-user email needs an explicit HTTPS origin. Synthetic transport
  // tests may use the harmless production sample default, but live deployments
  // never silently inherit it.
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

async function fetchWithTimeout(input, init, timeoutMs) {
  const controller = new AbortController()
  let reader = null
  let timer
  const operation = (async () => {
    const response = await fetch(input, {
      ...(init || {}),
      redirect: 'error',
      signal: controller.signal,
    })
    if (response.redirected || (response.status >= 300 && response.status < 400)) {
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

async function readBoundedText(stream, declaredLength, maxBytes, timeoutMs) {
  if (declaredLength != null) {
    if (!/^\d+$/.test(declaredLength)) throw Object.assign(new Error('bad content-length'), { code: 'bad_json' })
    if (Number(declaredLength) > maxBytes) {
      throw Object.assign(new Error('request too large'), { code: 'body_too_large' })
    }
  }
  if (!stream) throw Object.assign(new Error('missing body'), { code: 'bad_json' })

  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let raw = ''
  let timer
  const consume = (async () => {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        void reader.cancel().catch(() => {})
        throw Object.assign(new Error('request too large'), { code: 'body_too_large' })
      }
      raw += decoder.decode(value, { stream: true })
    }
    return raw + decoder.decode()
  })()
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      void reader.cancel().catch(() => {})
      reject(Object.assign(new Error('request timeout'), { code: 'body_timeout' }))
    }, timeoutMs)
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
    REQUEST_BODY_TIMEOUT_MS,
  )
  try {
    return JSON.parse(raw)
  } catch (error) {
    throw Object.assign(new Error('bad json'), { code: 'bad_json' })
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

async function verifyUser(bearer) {
  if (!/^Bearer\s+[^\s]+$/i.test(bearer) || !SUPABASE_URL || !ANON_KEY) return null
  try {
    const r = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/user`, {
      headers: supabaseHeaders(ANON_KEY, bearer),
    }, SUPABASE_TIMEOUT_MS)
    if (!r.ok) return null
    const u = await r.json().catch(() => null)
    return u?.id || null
  } catch {
    return null
  }
}

async function sbGet(path) {
  const r = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: supabaseHeaders(SERVICE_KEY),
  }, SUPABASE_TIMEOUT_MS)
  if (!r.ok) throw new Error(`supabase read ${r.status}`)
  const rows = await r.json().catch(() => null)
  if (!Array.isArray(rows)) throw new Error('invalid supabase response')
  return rows
}

async function pairIsBlocked(userA, userB) {
  const a = encodeURIComponent(userA)
  const b = encodeURIComponent(userB)
  const rows = await sbGet(
    `blocks?or=(and(blocker_id.eq.${a},blocked_id.eq.${b}),and(blocker_id.eq.${b},blocked_id.eq.${a}))` +
    `&select=blocker_id,blocked_id&limit=1`,
  )
  if (!Array.isArray(rows)) throw new Error('invalid blocks response')
  return rows.length > 0
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
  const text = await r.text()
  try { return text ? JSON.parse(text) : null } catch { return text }
}

async function resolveMeetupEmailNotification(meetup, recipientId) {
  const expectedKey = `meetup:${meetup.id}:${meetup.status}`
  const rows = await sbRpc('resolve_meetup_email_notification', {
    meetup_id_in: meetup.id,
    event_kind_in: meetup.status,
    recipient_id_in: recipientId,
    conversation_id_in: meetup.conversation_id,
  })
  if (!Array.isArray(rows)) throw new Error('invalid meetup notification resolution')
  if (rows.length === 0) return null
  if (rows.length !== 1) throw new Error('ambiguous meetup notification resolution')
  const row = rows[0]
  if (!UUID_RE.test(row?.notification_id || '') || row?.source_event_key !== expectedKey) {
    throw new Error('invalid meetup notification identity')
  }
  return {
    id: row.notification_id,
    sourceEventKey: row.source_event_key,
    emailedAt: typeof row.emailed_at === 'string' && row.emailed_at ? row.emailed_at : null,
  }
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
    !Array.isArray(ids) || ids.length < 1 || ids.length > 40 ||
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

function fmtWhen(iso) {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'America/Chicago', month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso))
  } catch { return String(iso).slice(5, 16).replace('T', ' ') }
}

/*
 * Which party gets the email, and what the mail says, falls straight out of
 * the meetup row's state (the client just pings with the id it holds):
 *   pending    → to_user   (new proposal or reschedule request awaiting them)
 *   accepted   → from_user (their proposal got confirmed)
 *   declined   → from_user (their proposal was declined)
 *   rescheduled→ follow the child pending row (parent_meetup_id) instead
 */
const KIND = {
  pending: { recipient: 'to_user', title: '新的见面提议 · Meetup proposed', verb: '向你发起了见面提议', verbEn: 'proposed a meetup with you' },
  accepted: { recipient: 'from_user', title: '约见已确认 · Meetup confirmed', verb: '确认了你的见面提议', verbEn: 'confirmed your meetup' },
  declined: { recipient: 'from_user', title: '约见被婉拒 · Meetup declined', verb: '婉拒了你的见面提议', verbEn: 'declined your meetup' },
}

const LIVE_MEETUP_SELECT = 'id,conversation_id,item_id,from_user,to_user,spot,meet_at,note,status,parent_meetup_id,updated_at'
const TEST_MEETUP_SELECT = 'id,conversation_id,item_id,from_user,to_user,status,parent_meetup_id'

function mailHtml({ actorName, verb, verbEn, spot, whenLabel, note, itemTitle, unsubToken }) {
  const unsub = unsubToken
    ? `不想再收到邮件提醒？<a href="${esc(APP_URL)}/api/unsubscribe?t=${esc(unsubToken)}" style="color:#A39A8C">一键退订 Unsubscribe</a>`
    : ''
  return `<!DOCTYPE html><html><body style="margin:0;background:#F7F4EE;font-family:-apple-system,'Segoe UI',sans-serif">
  <div style="max-width:520px;margin:0 auto;padding:24px 16px">
    <div style="text-align:center;margin-bottom:8px">
      <span style="display:inline-block;width:40px;height:40px;line-height:40px;border-radius:10px;background:#C74A2F;color:#fff;font-weight:700;font-size:20px">集</span>
    </div>
    <h1 style="font-family:Georgia,serif;font-size:22px;color:#2A2521;text-align:center;margin:8px 0 2px">香槟集市</h1>
    <p style="text-align:center;color:#8B8478;font-size:13px;margin:0 0 20px">${esc(actorName)} ${esc(verb)}<br><span style="color:#A39A8C">${esc(actorName)} ${esc(verbEn || verb)}</span></p>
    <div style="background:#fff;border-radius:16px;padding:18px 20px">
      ${itemTitle ? `<div style="font-size:13px;color:#8B8478;margin-bottom:8px">关于 · Re: ${esc(itemTitle)}</div>` : ''}
      <div style="font-size:16px;font-weight:600;color:#2A2521">📍 ${esc(spot)}</div>
      <div style="font-size:14px;color:#6B6459;margin-top:4px">🕐 ${esc(whenLabel)}（美中时间 · US Central）</div>
      ${note ? `<div style="font-size:13px;color:#6B6459;margin-top:8px;font-style:italic">“${esc(note)}”</div>` : ''}
    </div>
    <div style="text-align:center;margin:24px 0">
      <a href="${esc(APP_URL)}/#/pages/messages/index" style="display:inline-block;background:#C74A2F;color:#fff;text-decoration:none;padding:12px 28px;border-radius:999px;font-weight:600;font-size:15px">去回应 · Respond</a>
    </div>
    <p style="text-align:center;color:#A39A8C;font-size:11px;line-height:1.6;margin-top:24px">
      香槟集市 · UIUC 校园二手集市 · Champaign-Urbana, IL<br>
      ${unsub}
    </p>
  </div></body></html>`
}

async function resendSend(to, subject, html, idempotencyKey = '') {
  const headers = { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
  const r = await fetchWithTimeout('https://api.resend.com/emails', {
    method: 'POST',
    headers,
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
  }, RESEND_TIMEOUT_MS)
  if (!r.ok) throw new Error(`resend ${r.status}`)
}

export default async function handler(req) {
  const deploymentError = deploymentBoundaryResponse(evaluateDeploymentBoundary({ supabaseUrl: SUPABASE_URL }))
  if (deploymentError) return deploymentError
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'not_configured' }, 500)

  // JWT first — no anonymous work (ADM-SEC-07 posture).
  const callerId = await verifyUser(req.headers.get('authorization') || '')
  if (!callerId) return json({ error: 'unauthorized' }, 401)

  let body
  try {
    body = await readJsonBody(req)
  } catch (error) {
    return json({ error: error?.code === 'body_too_large' ? 'body_too_large' : 'bad_json' }, error?.code === 'body_too_large' ? 413 : 400)
  }
  const meetupId = typeof body?.meetup_id === 'string' ? body.meetup_id : ''
  if (!UUID_RE.test(meetupId)) return json({ error: 'bad_meetup_id' }, 400)

  // Inert deployments perform no database work or external side effect, so
  // they do not depend on the production email abuse counter.
  if (!TEST_EMAIL && !LIVE) return json({ skipped: 'inert' })
  if (!RESEND_API_KEY) return json({ error: 'resend_missing' }, 500)
  if (!TEST_EMAIL && LIVE && !liveAppOriginReady()) {
    return json({ error: 'live_app_origin_required' }, 500)
  }

  // Email is an off-platform side effect. If its abuse counter is unavailable,
  // fail closed rather than turning this authenticated route into an
  // unmetered Resend proxy.
  try {
    const allowed = await sbRpc('edge_rate_hit', {
      bucket_in: `meetup-mail:${callerId}`, max_in: RATE_MAX, window_secs_in: RATE_WINDOW_SECS,
    })
    if (allowed === false) return json({ error: 'rate_limited' }, 429)
    if (allowed !== true) return json({ error: 'rate_limit_unavailable' }, 503)
  } catch {
    return json({ error: 'rate_limit_unavailable' }, 503)
  }

  try {
    const meetupSelect = TEST_EMAIL ? TEST_MEETUP_SELECT : LIVE_MEETUP_SELECT
    let rows = await sbGet(`meetups?id=eq.${encodeURIComponent(meetupId)}&select=${meetupSelect}&limit=1`)
    let meetup = rows[0]
    if (!meetup) return json({ error: 'not_found' }, 404)
    if (meetup.from_user !== callerId && meetup.to_user !== callerId) return json({ error: 'forbidden' }, 403)

    // A reschedule marks the acted-on row 'rescheduled' and creates a fresh
    // pending child — follow it so the email describes the live proposal.
    if (meetup.status === 'rescheduled') {
      const kids = await sbGet(`meetups?parent_meetup_id=eq.${encodeURIComponent(meetup.id)}&status=eq.pending&select=${meetupSelect}&order=created_at.desc&limit=1`)
      if (kids[0]) meetup = kids[0]
    }

    const kind = KIND[meetup.status]
    if (!kind) return json({ skipped: `status_${meetup.status}` })

    const recipientId = meetup[kind.recipient]
    const actorId = recipientId === meetup.from_user ? meetup.to_user : meetup.from_user
    // The caller must still be one of the two parties after a child-follow.
    if (callerId !== meetup.from_user && callerId !== meetup.to_user) return json({ error: 'forbidden' }, 403)
    if (recipientId === callerId) return json({ skipped: 'self' })

    // Never guess which notification this state transition created. Migration
    // 20260718250000 writes one stable event key in the same transaction as
    // the meetup mutation; the service-only resolver returns that exact id or
    // no row for legacy/corrupt data. Legacy rows remain eligible for the
    // daily digest instead of risking an immediate-mail misattribution.
    let eventNotification
    try {
      eventNotification = await resolveMeetupEmailNotification(meetup, recipientId)
    } catch {
      return json({ error: 'delivery_contract_unavailable' }, 503)
    }
    if (!eventNotification) return json({ skipped: 'notification_unavailable' })
    if (!TEST_EMAIL && eventNotification.emailedAt) {
      return json({ skipped: 'already_processed' })
    }

    // A block in EITHER direction closes every off-platform contact path too.
    // Resolve it as late as possible before any email build/send work. Keep the
    // response direction-neutral and fail closed on a lookup outage.
    try {
      if (await pairIsBlocked(meetup.from_user, meetup.to_user)) {
        return json({ skipped: 'conversation_unavailable' })
      }
    } catch (e) {
      console.warn('meetup_notify_block_boundary_unavailable')
      return json({ skipped: 'conversation_unavailable' })
    }

    // DIGEST_TEST_EMAIL is an operator transport check, not a copy of a real
    // user's private conversation. Never fetch profiles/items or place a real
    // nickname, listing, location, time, note, or unsubscribe token in the
    // message sent to the test sink. Participant/event/block checks above still
    // prevent this endpoint from becoming an anonymous mail trigger.
    if (TEST_EMAIL) {
      const previewHtml = mailHtml({
        actorName: '测试用户 · Test user',
        verb: '发起了合成见面测试',
        verbEn: 'triggered a synthetic meetup preview',
        spot: 'Sample campus location',
        whenLabel: '7/20 13:00',
        note: 'Synthetic preview — no user content',
        itemTitle: 'Sample listing',
        unsubToken: '',
      })
      await resendSend(
        TEST_EMAIL,
        '香槟集市 · 合成邮件链路测试 · Synthetic meetup preview',
        previewHtml,
      )
      return json({ sent: true, mode: 'test' })
    }

    const profiles = await sbGet(
      `profiles?id=in.(${encodeURIComponent(recipientId)},${encodeURIComponent(actorId)})&select=id,email,nickname,email_digest_opt_out,unsubscribe_token`
    )
    const recipient = profiles.find(p => p.id === recipientId)
    const actor = profiles.find(p => p.id === actorId)
    if (!recipient?.email) return json({ skipped: 'no_email' })
    // WeChat-login users have a synthetic wx_<openid>@wechat.placeholder email
    // (wechat-login.js) that would hard-bounce at Resend — never send there.
    if (recipient.email.endsWith('@wechat.placeholder')) return json({ skipped: 'wechat_placeholder' })
    if (recipient.email_digest_opt_out) return json({ skipped: 'opted_out' })

    let itemTitle = ''
    if (meetup.item_id) {
      try {
        const items = await sbGet(`items?id=eq.${encodeURIComponent(meetup.item_id)}&select=title&limit=1`)
        itemTitle = items[0]?.title || ''
      } catch { /* cosmetic only */ }
    }

    const html = mailHtml({
      actorName: actor?.nickname || '对方',
      verb: kind.verb,
      verbEn: kind.verbEn,
      spot: meetup.spot,
      whenLabel: fmtWhen(meetup.meet_at),
      note: meetup.note,
      itemTitle,
      unsubToken: recipient.unsubscribe_token,
    })
    const to = recipient.email

    // The database is the common arbitration point for both immediate and
    // digest delivery. Exactly one path can hold this notification. Once a
    // provider call begins, the same kind/key stays sticky across ambiguous
    // failures so a later retry cannot use a second Resend idempotency key.
    let deliveryClaim
    try {
      deliveryClaim = await claimNotificationEmailDelivery(
        [eventNotification.id],
        'immediate',
      )
    } catch {
      return json({ error: 'delivery_guard_unavailable' }, 503)
    }
    if (!deliveryClaim) return json({ skipped: 'delivery_in_progress' })
    if (
      deliveryClaim.notificationIds.length !== 1 ||
      deliveryClaim.notificationIds[0] !== eventNotification.id
    ) {
      await releaseNotificationEmailDelivery(deliveryClaim).catch(() => {})
      return json({ error: 'delivery_guard_unavailable' }, 503)
    }

    try {
      const began = await beginNotificationEmailDelivery(deliveryClaim)
      if (began !== 1) throw new Error('delivery claim expired')
      await resendSend(to, `香槟集市 · ${kind.title}`, html, deliveryClaim.key)
      const completed = await completeNotificationEmailDelivery(deliveryClaim)
      if (completed !== 1) throw new Error('delivery acknowledgement rejected')
    } catch (error) {
      // Before begin this clears the assignment. After begin it clears only the
      // lease while preserving the sticky owner/key for an ambiguity-safe retry.
      await releaseNotificationEmailDelivery(deliveryClaim).catch(() => {})
      throw error
    }

    return json({ sent: true, mode: 'live' })
  } catch (e) {
    console.error('meetup_notify_failed')
    return json({ error: 'internal' }, 500)
  }
}
