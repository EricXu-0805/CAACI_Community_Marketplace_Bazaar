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
 *   · DIGEST_TEST_EMAIL set  → EVERY digest is rerouted to that one address
 *     (real users are never emailed). This is the test mode Eric uses.
 *   · DIGEST_TEST_EMAIL unset AND DIGEST_LIVE !== 'true' → refuses to send.
 *     So the only way to email real users is to explicitly set DIGEST_LIVE=true
 *     AND clear DIGEST_TEST_EMAIL — two deliberate actions. Default is inert.
 *
 * Env (set in Vercel): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (already present),
 * RESEND_API_KEY, CRON_SECRET, DIGEST_TEST_EMAIL (test), DIGEST_LIVE ('true' to
 * go live), DIGEST_FROM (sender on the Resend-verified illinimarket.com domain;
 * defaults to "Illini Market <noreply@send.illinimarket.com>").
 */

function env(name, fallback = '') { return process.env[name] || fallback }
const SUPABASE_URL = env('SUPABASE_URL', env('VITE_SUPABASE_URL'))
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')
const RESEND_API_KEY = env('RESEND_API_KEY')
const CRON_SECRET = env('CRON_SECRET')
const TEST_EMAIL = env('DIGEST_TEST_EMAIL')
const LIVE = env('DIGEST_LIVE') === 'true'
const APP_URL = env('DIGEST_APP_URL', 'https://illinimarket.com')
// Resend requires the From address to be on a domain verified in Resend.
// Eric verifies the send.illinimarket.com subdomain; override via DIGEST_FROM.
const FROM = env('DIGEST_FROM', 'Illini Market <noreply@send.illinimarket.com>')
const WINDOW_DAYS = 7
const MAX_ROWS = 40
// Unread-message reminder: a chat message unread for at least this long seeds a
// one-shot 'unread_message' notification that rides this same digest (migration 070).
const UNREAD_REMINDER_HOURS = 12

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
    <p style="text-align:center;color:#8B8478;font-size:13px;margin:0 0 20px">你有 ${rows.length} 条新动态${isSample ? ' · 示例 Sample' : ''}</p>
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
  { type: 'offer', title: '新报价 · New offer', body: '$25' },
  { type: 'meetup', title: '见面提议 · Meetup proposed', body: 'Grainger Library' },
  { type: 'price_drop', title: '降价提醒 · Price drop', body: '你收藏的「IKEA 书桌」降到 $30' },
]

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  })
  if (!r.ok) throw new Error(`supabase read ${r.status}`)
  return r.json()
}

async function sbMarkEmailed(ids) {
  if (!ids.length) return
  const inList = `(${ids.map(encodeURIComponent).join(',')})`
  const r = await fetch(`${SUPABASE_URL}/rest/v1/notifications?id=in.${inList}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify({ emailed_at: new Date().toISOString() }),
  })
  // edge fetch only rejects on network errors, not on HTTP 4xx/5xx — without
  // this check a failed PATCH was swallowed, leaving emailed_at NULL so the
  // next cron re-sent an identical digest to a real user. Throw so the caller
  // counts it as a failure instead of falsely reporting success.
  if (!r.ok) throw new Error(`mark-emailed ${r.status}`)
}

async function sbInsert(path, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`supabase insert ${r.status}`)
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

/*
 * #6e — pre-meetup reminder. Seeds a 'meetup' notification for BOTH parties of
 * each accepted meetup happening in the next ~24h, then stamps reminded_at so
 * it fires exactly once. The rows ride the same digest pass below. LIVE-only:
 * it mutates (inserts + stamps), so it must not run in the repeatable test
 * mode — same posture as "test mode never marks emailed_at".
 */
async function generateMeetupReminders() {
  const nowIso = new Date().toISOString()
  const soonIso = new Date(Date.now() + 24 * 3600000).toISOString()
  const meetups = await sbGet(
    `meetups?status=eq.accepted&reminded_at=is.null&meet_at=gte.${nowIso}&meet_at=lte.${soonIso}` +
    `&select=id,item_id,from_user,to_user,spot,meet_at&limit=200`
  )
  if (!meetups.length) return 0

  const fmtWhen = (iso) => {
    try {
      return new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'America/Chicago', month: 'numeric', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(new Date(iso))
    } catch { return iso.slice(5, 16).replace('T', ' ') }
  }

  const notifs = []
  for (const m of meetups) {
    const body = `${m.spot} · ${fmtWhen(m.meet_at)}`
    notifs.push({ user_id: m.from_user, type: 'meetup', title: '见面提醒 · Meetup reminder', body, item_id: m.item_id })
    notifs.push({ user_id: m.to_user, type: 'meetup', title: '见面提醒 · Meetup reminder', body, item_id: m.item_id })
  }
  const inList = `(${meetups.map(m => encodeURIComponent(m.id)).join(',')})`
  // Claim-then-act: stamp reminded_at BEFORE inserting the notifications. If a
  // transient failure splits the two writes, a missed reminder (PATCH ok,
  // INSERT fails) is far better than a duplicate (INSERT ok, PATCH fails →
  // both parties re-emailed next cron). Same at-most-once posture as emailed_at.
  await sbPatch(`meetups?id=in.${inList}`, { reminded_at: nowIso })
  await sbInsert('notifications', notifs)
  return meetups.length
}

/*
 * Unread-message reminder (#070). Chat messages never create a notifications
 * row, so an unread message sat invisible off-platform. This finds messages the
 * RECIPIENT hasn't read that have been unread for >12h (long enough that they
 * had a chance to see it in-app), collapses them to ONE 'unread_message'
 * notification per recipient, and stamps messages.reminded_at so each unread
 * message reminds at most once. Reading the thread (is_read -> true) before the
 * cron simply drops it from the query — a since-read message is never reminded.
 *
 * Same claim-then-act + LIVE-only posture as generateMeetupReminders: stamp
 * reminded_at BEFORE inserting the notification so a split write misses a
 * reminder rather than duplicating one; mutates, so it never runs in test mode.
 */
async function generateUnreadMessageReminders() {
  const cutoffIso = new Date(Date.now() - UNREAD_REMINDER_HOURS * 3600000).toISOString()
  // Embed the conversation so we can resolve the recipient (the participant who
  // is NOT the sender) and honor that side's mute flag.
  const msgs = await sbGet(
    `messages?is_read=is.false&reminded_at=is.null&created_at=lte.${cutoffIso}` +
    `&select=id,sender_id,conversation_id,conversations(buyer_id,seller_id,is_muted_buyer,is_muted_seller)` +
    `&order=created_at.asc&limit=500`
  )
  if (!msgs.length) return 0

  // recipientId -> { ids: [messageId], count }. Skip rows whose recipient muted.
  const byRecipient = new Map()
  for (const m of msgs) {
    const c = m.conversations
    if (!c) continue
    const recipient = c.buyer_id === m.sender_id ? c.seller_id : c.buyer_id
    if (!recipient) continue
    const recipientMuted = recipient === c.buyer_id ? c.is_muted_buyer : c.is_muted_seller
    if (recipientMuted) continue
    if (!byRecipient.has(recipient)) byRecipient.set(recipient, { ids: [], count: 0 })
    const e = byRecipient.get(recipient)
    e.ids.push(m.id); e.count++
  }
  if (!byRecipient.size) return 0

  const allIds = [...byRecipient.values()].flatMap(e => e.ids)
  // Claim-then-act: stamp reminded_at on every included message FIRST. Clients
  // can't write reminded_at (064 column lock), so only this digest sets it.
  await sbPatch(`messages?id=in.(${allIds.map(encodeURIComponent).join(',')})`, { reminded_at: new Date().toISOString() })

  const notifs = [...byRecipient.entries()].map(([recipient, e]) => ({
    user_id: recipient,
    type: 'unread_message',
    title: '未读消息 · Unread messages',
    body: `你有 ${e.count} 条未读消息 · ${e.count} unread message${e.count > 1 ? 's' : ''}`,
  }))
  await sbInsert('notifications', notifs)
  return notifs.length
}

async function resendSend(to, subject, html) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
  })
  if (!r.ok) throw new Error(`resend ${r.status}: ${(await r.text()).slice(0, 200)}`)
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })
}

export default async function handler(req) {
  // Auth — no secret configured means the endpoint is closed.
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!CRON_SECRET || !timingSafeEqual(bearer, CRON_SECRET)) return json({ error: 'unauthorized' }, 401)
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'supabase env missing' }, 500)
  if (!RESEND_API_KEY) return json({ error: 'RESEND_API_KEY missing' }, 500)

  // Paranoid send gate.
  if (!TEST_EMAIL && !LIVE) {
    return json({ skipped: 'inert: set DIGEST_TEST_EMAIL to test, or DIGEST_LIVE=true to send to users' })
  }

  try {
  // #6e — seed pre-meetup reminders before the digest read so they ride this
  // same pass. LIVE-only (mutates); test mode stays repeatable. A failure here
  // must not abort the digest.
  let meetupReminders = 0
  let unreadReminders = 0
  if (!TEST_EMAIL) {
    try { meetupReminders = await generateMeetupReminders() }
    catch (e) { console.error('meetup reminders failed:', e?.message || e) }
    // #070 — seed unread-message reminders into the same pass. Independent of
    // meetups; a failure here must not abort the digest either.
    try { unreadReminders = await generateUnreadMessageReminders() }
    catch (e) { console.error('unread reminders failed:', e?.message || e) }
  }

  const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString()
  const rows = await sbGet(
    `notifications?emailed_at=is.null&created_at=gte.${since}` +
    `&select=id,user_id,type,title,body,created_at&order=user_id.asc,created_at.desc&limit=${MAX_ROWS * 5}`
  )

  // TEST MODE — everything to the one address; never touches real users.
  if (TEST_EMAIL) {
    const sample = rows.length === 0
    const useRows = sample ? SAMPLE_ROWS : rows.slice(0, MAX_ROWS)
    await resendSend(TEST_EMAIL, `香槟集市 · ${useRows.length} 条新动态${sample ? '（示例）' : '（测试）'}`, digestHtml(useRows, sample))
    // Test mode never marks emailed_at — keeps runs repeatable and never
    // consumes a real user's notification (they'd lose it when you go live).
    return json({ mode: 'test', sentTo: 'DIGEST_TEST_EMAIL', sample, previewed: sample ? 0 : Math.min(rows.length, MAX_ROWS) })
  }

  // LIVE MODE — per-user digests to real emails (requires DIGEST_LIVE=true).
  const byUser = new Map()
  for (const n of rows) {
    if (!byUser.has(n.user_id)) byUser.set(n.user_id, [])
    const arr = byUser.get(n.user_id)
    if (arr.length < MAX_ROWS) arr.push(n)
  }
  const userIds = [...byUser.keys()]
  if (!userIds.length) return json({ mode: 'live', usersNotified: 0, notifications: 0 })

  // email_digest_opt_out=is.false drops users who unsubscribed (L7); their
  // notification rows stay un-emailed and age out of the 7-day window.
  const profiles = await sbGet(
    `profiles?id=in.(${userIds.map(encodeURIComponent).join(',')})&email_digest_opt_out=is.false&select=id,email,unsubscribe_token`
  )
  const emailById = new Map(profiles.filter(p => p.email).map(p => [p.id, p.email]))
  const tokenById = new Map(profiles.filter(p => p.email).map(p => [p.id, p.unsubscribe_token]))

  let usersNotified = 0, sentCount = 0, sendFailed = 0, markFailed = 0
  for (const uid of userIds) {
    const to = emailById.get(uid)
    const userRows = byUser.get(uid)
    if (!to || !userRows.length) continue
    let sent = false
    try {
      await resendSend(to, `香槟集市 · 你有 ${userRows.length} 条新动态`, digestHtml(userRows, false, tokenById.get(uid)))
      sent = true
      await sbMarkEmailed(userRows.map(r => r.id))
      usersNotified++; sentCount += userRows.length
    } catch (e) {
      // One user's failure shouldn't abort the batch. Distinguish the two
      // modes so the operator isn't shown a falsely-clean success: a send
      // failure is safe (no email went out; rows stay un-emailed → retried),
      // but a mark failure AFTER a successful send means the digest WAS
      // delivered yet the rows weren't stamped → next run sends a DUPLICATE.
      if (sent) markFailed++; else sendFailed++
      console.error(`digest user ${uid}: ${sent ? 'mark-emailed' : 'send'} failed:`, e?.message || e)
    }
  }
  // Surface partial failures as a non-2xx so the Vercel cron run is flagged
  // instead of falsely logged green — a swallowed 200 here is the silent
  // failure this whole pipeline is built to avoid. markFailed is the worse of
  // the two (a delivered digest whose rows weren't stamped → duplicate next
  // run); sendFailed is safe (rows stay un-emailed and retry). Either is a 500.
  const failed = sendFailed + markFailed
  return json(
    { mode: 'live', usersNotified, notifications: sentCount, sendFailed, markFailed, meetupReminders, unreadReminders },
    failed > 0 ? 500 : 200,
  )
  } catch (e) {
    return json({ error: 'internal' }, 500)
  }
}
