export const config = { runtime: 'edge' }

/*
 * Off-platform notification digest (the biggest retention leak: notifications
 * were in-app only). Reads un-emailed notification rows via the service key,
 * groups per user, sends each user a digest via Brevo, and marks the rows
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
 * BREVO_API_KEY, CRON_SECRET, DIGEST_TEST_EMAIL (test), DIGEST_LIVE ('true' to
 * go live). Sender is the verified Brevo address newsletter@news.caaciorg.com.
 */

function env(name, fallback = '') { return process.env[name] || fallback }
const SUPABASE_URL = env('SUPABASE_URL', env('VITE_SUPABASE_URL'))
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')
const BREVO_API_KEY = env('BREVO_API_KEY')
const CRON_SECRET = env('CRON_SECRET')
const TEST_EMAIL = env('DIGEST_TEST_EMAIL')
const LIVE = env('DIGEST_LIVE') === 'true'
const APP_URL = env('DIGEST_APP_URL', 'https://caaci-community-marketplace-bazaar.vercel.app')
const SENDER = { email: 'newsletter@news.caaciorg.com', name: '香槟集市 Illini Market' }
const WINDOW_DAYS = 7
const MAX_ROWS = 40

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

const TYPE_ICON = { price_drop: '↓', sold: '✓', offer: '$', meetup: '📍', system: '🔔' }

function rowHtml(n) {
  const icon = TYPE_ICON[n.type] || '🔔'
  return `<tr><td style="padding:12px 0;border-bottom:1px solid #ECE5DA;vertical-align:top">
    <span style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;border-radius:50%;background:#F5D9CE;color:#A03A24;font-weight:700;font-size:13px">${esc(icon)}</span>
  </td><td style="padding:12px 0 12px 12px;border-bottom:1px solid #ECE5DA">
    <div style="font-size:15px;font-weight:600;color:#2A2521">${esc(n.title)}</div>
    ${n.body ? `<div style="font-size:13px;color:#6B6459;margin-top:2px">${esc(n.body)}</div>` : ''}
  </td></tr>`
}

function digestHtml(rows, isSample) {
  const items = rows.map(rowHtml).join('')
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
      香槟集市 · UIUC 校园二手集市<br>
      在 App 的「设置 · 通知」里管理通知偏好。
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
  await fetch(`${SUPABASE_URL}/rest/v1/notifications?id=in.${inList}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify({ emailed_at: new Date().toISOString() }),
  })
}

async function brevoSend(to, subject, html) {
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ sender: SENDER, to: [{ email: to }], subject, htmlContent: html }),
  })
  if (!r.ok) throw new Error(`brevo ${r.status}: ${(await r.text()).slice(0, 200)}`)
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })
}

export default async function handler(req) {
  // Auth — no secret configured means the endpoint is closed.
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!CRON_SECRET || !timingSafeEqual(bearer, CRON_SECRET)) return json({ error: 'unauthorized' }, 401)
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'supabase env missing' }, 500)
  if (!BREVO_API_KEY) return json({ error: 'BREVO_API_KEY missing' }, 500)

  // Paranoid send gate.
  if (!TEST_EMAIL && !LIVE) {
    return json({ skipped: 'inert: set DIGEST_TEST_EMAIL to test, or DIGEST_LIVE=true to send to users' })
  }

  try {
  const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString()
  const rows = await sbGet(
    `notifications?emailed_at=is.null&created_at=gte.${since}` +
    `&select=id,user_id,type,title,body,created_at&order=user_id.asc,created_at.desc&limit=${MAX_ROWS * 5}`
  )

  // TEST MODE — everything to the one address; never touches real users.
  if (TEST_EMAIL) {
    const sample = rows.length === 0
    const useRows = sample ? SAMPLE_ROWS : rows.slice(0, MAX_ROWS)
    await brevoSend(TEST_EMAIL, `香槟集市 · ${useRows.length} 条新动态${sample ? '（示例）' : '（测试）'}`, digestHtml(useRows, sample))
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

  const profiles = await sbGet(
    `profiles?id=in.(${userIds.map(encodeURIComponent).join(',')})&select=id,email`
  )
  const emailById = new Map(profiles.filter(p => p.email).map(p => [p.id, p.email]))

  let usersNotified = 0, sentCount = 0
  for (const uid of userIds) {
    const to = emailById.get(uid)
    const userRows = byUser.get(uid)
    if (!to || !userRows.length) continue
    try {
      await brevoSend(to, `香槟集市 · 你有 ${userRows.length} 条新动态`, digestHtml(userRows, false))
      await sbMarkEmailed(userRows.map(r => r.id))
      usersNotified++; sentCount += userRows.length
    } catch (e) {
      // one user's failure shouldn't abort the batch; leave their rows un-emailed for the next run
    }
  }
  return json({ mode: 'live', usersNotified, notifications: sentCount })
  } catch (e) {
    return json({ error: 'internal' }, 500)
  }
}
