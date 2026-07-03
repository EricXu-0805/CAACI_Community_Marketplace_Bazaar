export const config = { runtime: 'edge' }

/*
 * /api/unsubscribe?t=<uuid> — email-digest opt-out (QA4 L7).
 *
 * The per-user unsubscribe_token (profiles, migration 069) is an unguessable
 * UUID and IS the authorization — no login needed (standard list-unsubscribe
 * UX). The token is column-revoked from anon/authenticated, so it only ever
 * reaches a user via their own digest email's footer link.
 *
 * Two-step to survive email link scanners (QA8 audit #12): a GET only renders
 * a confirmation page — it performs NO write — so Microsoft Defender Safe
 * Links / Gmail prefetch fetching the footer URL can't silently opt a user
 * out. The opt-out write happens only when the human clicks the button, which
 * POSTs back. The POST uses the service-role key (bypasses RLS) to flip
 * email_digest_opt_out=true; its response is identical for a valid, invalid,
 * or already-used token (no user enumeration).
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function page(titleZh, titleEn, subZh, subEn) {
  const html = `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titleEn}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F7F4EE;font-family:-apple-system,'Segoe UI',sans-serif;color:#2A2521}
.card{max-width:360px;text-align:center;padding:32px 24px}
.seal{display:inline-block;width:44px;height:44px;line-height:44px;border-radius:11px;background:#C74A2F;color:#fff;font-weight:700;font-size:22px;margin-bottom:16px}
h1{font-size:19px;margin:0 0 6px}p{font-size:13px;color:#8B8478;line-height:1.6;margin:0}</style>
</head><body><div class="card"><div class="seal">集</div>
<h1>${titleZh} · ${titleEn}</h1><p>${subZh}<br>${subEn}</p></div></body></html>`
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/* Confirm page shown for a GET — a button that POSTs back to do the actual
   opt-out. encodeURIComponent keeps the (still-unvalidated) token safe inside
   the form action attribute. No DB write happens here. */
function confirmPage(token) {
  const action = `/api/unsubscribe?t=${encodeURIComponent(token)}`
  const html = `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Unsubscribe</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F7F4EE;font-family:-apple-system,'Segoe UI',sans-serif;color:#2A2521}
.card{max-width:360px;text-align:center;padding:32px 24px}
.seal{display:inline-block;width:44px;height:44px;line-height:44px;border-radius:11px;background:#C74A2F;color:#fff;font-weight:700;font-size:22px;margin-bottom:16px}
h1{font-size:19px;margin:0 0 6px}p{font-size:13px;color:#8B8478;line-height:1.6;margin:0 0 20px}
button{appearance:none;border:0;border-radius:10px;background:#C74A2F;color:#fff;font-size:15px;font-weight:600;padding:12px 28px;cursor:pointer}</style>
</head><body><div class="card"><div class="seal">集</div>
<h1>退订邮件提醒 · Unsubscribe</h1>
<p>点击下方按钮，将不再收到集市的邮件提醒。<br>Click below to stop receiving Illini Market email reminders.</p>
<form method="POST" action="${action}"><button type="submit">确认退订 · Confirm unsubscribe</button></form>
</div></body></html>`
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}

export default async function handler(req) {
  const url = new URL(req.url)
  const token = url.searchParams.get('t') || ''

  // Generic confirmation regardless of whether the token matched a real user —
  // never reveal that. But a genuine DB/network failure must NOT masquerade as
  // success, or the user is told "unsubscribed" while still getting mail.
  const done = () => page('已退订', "You're unsubscribed",
    '你将不再收到集市的邮件提醒。', "You won't receive Illini Market email reminders anymore.")
  const fail = () => page('退订失败', 'Unsubscribe failed',
    '请稍后重试，或在 App 设置中关闭邮件提醒。', 'Please try again later, or turn off email reminders in the app settings.')

  // A GET (including automated email link scanners) only renders the confirm
  // page — no write. The opt-out happens on the POST the button submits.
  if (req.method !== 'POST') return confirmPage(token)

  if (!UUID_RE.test(token) || !SUPABASE_URL || !SERVICE_KEY) return done()

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?unsubscribe_token=eq.${encodeURIComponent(token)}`,
      {
        method: 'PATCH',
        headers: {
          apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json', Prefer: 'return=minimal',
        },
        body: JSON.stringify({ email_digest_opt_out: true }),
      },
    )
    // return=minimal makes a no-match PATCH still succeed (204, 0 rows updated),
    // so a non-2xx genuinely signals a real failure — surface it, don't fake success.
    if (!res.ok) return fail()
  } catch {
    return fail()
  }
  return done()
}
