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
const SUPABASE_URL = env('SUPABASE_URL', env('VITE_SUPABASE_URL'))
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')
const ANON_KEY = env('SUPABASE_ANON_KEY', env('VITE_SUPABASE_ANON_KEY'))
const RESEND_API_KEY = env('RESEND_API_KEY')
const TEST_EMAIL = env('DIGEST_TEST_EMAIL')
const LIVE = env('DIGEST_LIVE') === 'true'
const APP_URL = env('DIGEST_APP_URL', 'https://illinimarket.com')
const FROM = env('DIGEST_FROM', 'Illini Market <noreply@send.illinimarket.com>')

const RATE_MAX = 10
const RATE_WINDOW_SECS = 3600

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

async function verifyUser(bearer) {
  if (!bearer || !SUPABASE_URL || !ANON_KEY) return null
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: bearer },
    })
    if (!r.ok) return null
    const u = await r.json().catch(() => null)
    return u?.id || null
  } catch {
    return null
  }
}

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  })
  if (!r.ok) throw new Error(`supabase read ${r.status}`)
  return r.json()
}

async function sbRpc(fn, args) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args || {}),
  })
  if (!r.ok) throw new Error(`rpc ${fn} ${r.status}`)
  const text = await r.text()
  try { return text ? JSON.parse(text) : null } catch { return text }
}

async function sbPatch(path, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`supabase patch ${r.status}`)
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

async function resendSend(to, subject, html) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
  })
  if (!r.ok) throw new Error(`resend ${r.status}`)
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'not_configured' }, 500)

  // JWT first — no anonymous work (ADM-SEC-07 posture).
  const callerId = await verifyUser(req.headers.get('authorization') || '')
  if (!callerId) return json({ error: 'unauthorized' }, 401)

  let body
  try { body = await req.json() } catch { return json({ error: 'bad_json' }, 400) }
  const meetupId = typeof body?.meetup_id === 'string' ? body.meetup_id : ''
  if (!/^[0-9a-f-]{36}$/i.test(meetupId)) return json({ error: 'bad_meetup_id' }, 400)

  // Rate limit per caller (fail-open like the admin limiter: a broken
  // limiter must not take meetup emails down with it).
  try {
    const allowed = await sbRpc('edge_rate_hit', {
      bucket_in: `meetup-mail:${callerId}`, max_in: RATE_MAX, window_secs_in: RATE_WINDOW_SECS,
    })
    if (allowed === false) return json({ error: 'rate_limited' }, 429)
  } catch { /* fail-open */ }

  try {
    let rows = await sbGet(`meetups?id=eq.${encodeURIComponent(meetupId)}&select=id,item_id,from_user,to_user,spot,meet_at,note,status,parent_meetup_id&limit=1`)
    let meetup = rows[0]
    if (!meetup) return json({ error: 'not_found' }, 404)
    if (meetup.from_user !== callerId && meetup.to_user !== callerId) return json({ error: 'forbidden' }, 403)

    // A reschedule marks the acted-on row 'rescheduled' and creates a fresh
    // pending child — follow it so the email describes the live proposal.
    if (meetup.status === 'rescheduled') {
      const kids = await sbGet(`meetups?parent_meetup_id=eq.${encodeURIComponent(meetup.id)}&status=eq.pending&select=id,item_id,from_user,to_user,spot,meet_at,note,status&order=created_at.desc&limit=1`)
      if (kids[0]) meetup = kids[0]
    }

    const kind = KIND[meetup.status]
    if (!kind) return json({ skipped: `status_${meetup.status}` })

    const recipientId = meetup[kind.recipient]
    const actorId = recipientId === meetup.from_user ? meetup.to_user : meetup.from_user
    // The caller must still be one of the two parties after a child-follow.
    if (callerId !== meetup.from_user && callerId !== meetup.to_user) return json({ error: 'forbidden' }, 403)
    if (recipientId === callerId) return json({ skipped: 'self' })

    // Send gate — identical posture to the digest.
    if (!TEST_EMAIL && !LIVE) return json({ skipped: 'inert' })
    if (!RESEND_API_KEY) return json({ error: 'resend_missing' }, 500)

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
    const to = TEST_EMAIL || recipient.email
    await resendSend(to, `香槟集市 · ${kind.title}`, html)

    // Stamp ONLY the single notification row this email corresponds to — the
    // recipient's newest un-emailed meetup notification for this item — so the
    // daily digest doesn't re-deliver it. The old filter matched EVERY recent
    // meetup notification for the recipient, silently marking an unrelated
    // proposal (from a different sender) as emailed without a mail being sent.
    // (QA8 audit #3/#18.) Test mode never stamps (repeatable-test posture).
    if (!TEST_EMAIL) {
      const sinceIso = new Date(Date.now() - 10 * 60000).toISOString()
      try {
        const itemFilter = meetup.item_id ? `&item_id=eq.${encodeURIComponent(meetup.item_id)}` : ''
        const rows = await sbGet(
          `notifications?user_id=eq.${encodeURIComponent(recipientId)}&type=eq.meetup&emailed_at=is.null&created_at=gte.${sinceIso}${itemFilter}&select=id&order=created_at.desc&limit=1`,
        )
        if (rows[0]?.id) {
          await sbPatch(`notifications?id=eq.${encodeURIComponent(rows[0].id)}`, { emailed_at: new Date().toISOString() })
        }
      } catch (e) {
        // Worst case the digest re-mentions this meetup tomorrow — never fail
        // the request over the stamp.
        console.warn('meetup-notify stamp failed:', e?.message)
      }
    }

    return json({ sent: true, mode: TEST_EMAIL ? 'test' : 'live' })
  } catch (e) {
    console.error('meetup-notify failed:', e?.message)
    return json({ error: 'internal' }, 500)
  }
}
