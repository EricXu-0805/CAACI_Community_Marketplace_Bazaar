import { deploymentBoundaryResponse, evaluateDeploymentBoundary } from './_deployment-boundary.js'

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
const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SUPABASE_TIMEOUT_MS = 5_000
const MAX_UPSTREAM_RESPONSE_BYTES = 64 * 1024
const IP_RATE_MAX = 30
const IP_RATE_WINDOW_SECS = 3600
const GLOBAL_RATE_MAX = 120
const GLOBAL_RATE_WINDOW_SECS = 60

function supabaseHeaders(key, authorization = '', extra = {}) {
  const headers = { apikey: key, ...extra }
  if (authorization) headers.Authorization = authorization
  else if (!/^sb_(?:publishable|secret)_/.test(key)) headers.Authorization = `Bearer ${key}`
  return headers
}

const HTML_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store, max-age=0',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
}

async function fetchWithTimeout(input, init, timeoutMs = SUPABASE_TIMEOUT_MS) {
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

async function hmacSha256Hex(secret, label, value) {
  if (!globalThis.crypto?.subtle) return null
  try {
    const encoder = new TextEncoder()
    const key = await globalThis.crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const signature = await globalThis.crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(`${label}\0${value}`),
    )
    return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}

async function rateHit(bucket, max, windowSecs) {
  const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/edge_rate_hit`, {
    method: 'POST',
    headers: supabaseHeaders(SERVICE_KEY, '', {
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify({ bucket_in: bucket, max_in: max, window_secs_in: windowSecs }),
  })
  if (!response.ok) return null
  const decision = await response.json().catch(() => null)
  return decision === true ? true : decision === false ? false : null
}

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
    headers: HTML_HEADERS,
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
    headers: HTML_HEADERS,
  })
}

export default async function handler(req) {
  const deploymentError = deploymentBoundaryResponse(evaluateDeploymentBoundary({ supabaseUrl: SUPABASE_URL }))
  if (deploymentError) return deploymentError
  const url = new URL(req.url)
  const tokens = url.searchParams.getAll('t')
  const token = tokens.length === 1 ? tokens[0] : ''

  // Generic confirmation regardless of whether the token matched a real user —
  // never reveal that. But a genuine DB/network failure must NOT masquerade as
  // success, or the user is told "unsubscribed" while still getting mail.
  const done = () => page('已退订', "You're unsubscribed",
    '你将不再收到集市的邮件提醒。', "You won't receive Illini Market email reminders anymore.")
  const fail = () => page('退订失败', 'Unsubscribe failed',
    '请稍后重试，或在 App 设置中关闭邮件提醒。', 'Please try again later, or turn off email reminders in the app settings.')

  // A GET (including automated email link scanners) only renders the confirm
  // page — no write. Reject unrelated verbs rather than treating method
  // confusion as a successful confirmation page.
  if (req.method === 'GET') return confirmPage(token)
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { ...HTML_HEADERS, allow: 'GET, POST' },
    })
  }

  // Invalid tokens intentionally receive the same generic terminal response
  // as no-match tokens. A valid-looking request on a misconfigured deployment
  // is different: claiming success there would leave the user subscribed, so
  // surface the honest retry page.
  if (!UUID_RE.test(token)) return done()
  if (!SUPABASE_URL || !SERVICE_KEY) return fail()

  try {
    // Capability-token entropy stops guessing a particular user, but a caller
    // can still manufacture UUID-shaped misses and force service-role writes.
    // Bound that anonymous database work without persisting raw network data.
    // Vercel overwrites x-vercel-forwarded-for at its edge; prefer that trusted
    // value so a caller-supplied x-forwarded-for cannot rotate limiter buckets.
    const forwarded = req.headers.get('x-vercel-forwarded-for') ||
      req.headers.get('x-forwarded-for') ||
      req.headers.get('x-real-ip') ||
      'unknown'
    const network = forwarded.split(',')[0].trim().slice(0, 128) || 'unknown'
    // A plain hash of an IP has a tiny, enumerable input space. Key the digest
    // with the server-only service credential and a versioned purpose label so
    // a leaked rate-limit table cannot be reversed with an address dictionary
    // or correlated with another feature's pseudonym.
    const networkHash = await hmacSha256Hex(SERVICE_KEY, 'unsubscribe-ip-v1', network)
    if (!networkHash) return fail()

    const globalAllowed = await rateHit('unsubscribe:global', GLOBAL_RATE_MAX, GLOBAL_RATE_WINDOW_SECS)
    if (globalAllowed !== true) return fail()
    const networkAllowed = await rateHit(`unsubscribe:ip:${networkHash}`, IP_RATE_MAX, IP_RATE_WINDOW_SECS)
    if (networkAllowed !== true) return fail()

    const res = await fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/profiles?unsubscribe_token=eq.${encodeURIComponent(token)}`,
      {
        method: 'PATCH',
        headers: supabaseHeaders(SERVICE_KEY, '', {
          'Content-Type': 'application/json', Prefer: 'return=minimal',
        }),
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
