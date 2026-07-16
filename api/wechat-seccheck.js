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
 *   POST { kind: 'text',  content, scene, openid? | js_code? }
 *     → msg_sec_check v2 (synchronous verdict; caller blocks the insert
 *       when suggest === 'risky')
 *   POST { kind: 'image', media_url, bucket, storage_path, openid? | js_code? }
 *     → media_check_async v2 (async; trace_id → storage mapping recorded in
 *       wechat_media_checks (m087) so /api/wechat-callback can take a
 *       violating object down when WeChat pushes the verdict)
 *
 * openid: msg_sec_check v2 requires the openid of a user who opened the mp
 * within 2h. WeChat-login users have profiles.wechat_openid; email-login
 * users pass a fresh wx.login js_code instead and we exchange it here
 * (jscode2session — same call wechat-login makes, no IP whitelist). The
 * resolved openid is echoed back so the client can cache it.
 *
 * Fail-open by design: if WeChat's API errors or credentials are missing,
 * content still goes through ({ ok:true, degraded:true }) — the DB keyword
 * trigger remains the floor, and a broken third-party API must not take
 * down posting. At review time the API works or nothing does.
 *
 * ⚠ Ops prerequisite: fetching access_token (stable_token) honors the mp
 * console IP whitelist. Vercel egress IPs are dynamic, so the whitelist
 * switch must be OFF (公众平台 → 开发管理 → 开发设置 → IP白名单).
 *
 * Env: WECHAT_APPID / WECHAT_APPSECRET (same as /api/auth/wechat-login),
 *      SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY.
 */

function env(name, fallback) {
  return process.env[name] || fallback
}

const WECHAT_APPID     = env('WECHAT_APPID', '')
const WECHAT_APPSECRET = env('WECHAT_APPSECRET', '')
const SUPABASE_URL     = env('SUPABASE_URL', env('VITE_SUPABASE_URL', ''))
const SUPABASE_SERVICE = env('SUPABASE_SERVICE_ROLE_KEY', '')
const SUPABASE_ANON    = env('SUPABASE_ANON_KEY', env('VITE_SUPABASE_ANON_KEY', ''))

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}

async function verifyUser(bearer) {
  if (!bearer || !bearer.startsWith('Bearer ')) return null
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON, Authorization: bearer },
    })
    if (!r.ok) return null
    const u = await r.json()
    return u?.id || null
  } catch {
    return null
  }
}

/* Per-user rate limit via edge_rate_hit (m082). Fail-open, matching the
   other edge limiters — a broken limiter must not block publishes. Ceiling
   is generous (chat sends one check per message). */
async function rateLimited(userId) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/edge_rate_hit`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE,
        Authorization: `Bearer ${SUPABASE_SERVICE}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bucket_in: `seccheck:${userId}`, limit_in: 600, window_seconds_in: 3600 }),
    })
    if (!r.ok) return false
    return (await r.json()) === false
  } catch {
    return false
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
  const r = await fetch('https://api.weixin.qq.com/cgi-bin/stable_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credential', appid: WECHAT_APPID, secret: WECHAT_APPSECRET }),
  })
  const data = await r.json()
  if (!data?.access_token) throw new Error(`stable_token failed: ${data?.errcode} ${data?.errmsg}`)
  tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 300) * 1000 }
  return tokenCache.token
}

async function resolveOpenid(body, userId) {
  if (body.openid && typeof body.openid === 'string') return body.openid
  if (body.js_code && typeof body.js_code === 'string') {
    const r = await fetch(
      `https://api.weixin.qq.com/sns/jscode2session?appid=${WECHAT_APPID}&secret=${WECHAT_APPSECRET}&js_code=${encodeURIComponent(body.js_code)}&grant_type=authorization_code`,
    )
    const data = await r.json()
    if (data?.openid) return data.openid
  }
  /* WeChat-login users: openid was bound onto their profile at sign-in. */
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=wechat_openid`,
      { headers: { apikey: SUPABASE_SERVICE, Authorization: `Bearer ${SUPABASE_SERVICE}` } },
    )
    if (r.ok) {
      const rows = await r.json()
      if (rows?.[0]?.wechat_openid) return rows[0].wechat_openid
    }
  } catch { /* fall through */ }
  return null
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') return json({}, 200)
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!WECHAT_APPID || !WECHAT_APPSECRET) return json({ ok: true, degraded: true })

  const userId = await verifyUser(request.headers.get('authorization'))
  if (!userId) return json({ error: 'unauthorized' }, 401)
  if (await rateLimited(userId)) return json({ error: 'rate_limited' }, 429)

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_json' }, 400)
  }

  let openid
  try {
    openid = await resolveOpenid(body, userId)
  } catch {
    openid = null
  }
  /* No openid resolvable (e.g. H5 caller) — WeChat check impossible; the
     DB keyword trigger remains the moderation floor. */
  if (!openid) return json({ ok: true, degraded: true })

  try {
    const token = await getAccessToken()

    if (body.kind === 'text') {
      const content = String(body.content || '').slice(0, 2500)
      if (!content.trim()) return json({ ok: true, openid })
      const scene = [1, 2, 3, 4].includes(body.scene) ? body.scene : 3
      const r = await fetch(`https://api.weixin.qq.com/wxa/msg_sec_check?access_token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: 2, openid, scene, content }),
      })
      const data = await r.json()
      /* v2 verdict lives in result.suggest; legacy errcode 87014 = risky. */
      const suggest = data?.result?.suggest || (data?.errcode === 87014 ? 'risky' : 'pass')
      if (data?.errcode && data.errcode !== 0 && data.errcode !== 87014) {
        return json({ ok: true, degraded: true, openid })
      }
      if (suggest === 'risky') {
        return json({ ok: false, suggest, label: data?.result?.label || 0, openid })
      }
      return json({ ok: true, suggest, openid })
    }

    if (body.kind === 'image') {
      const mediaUrl = String(body.media_url || '')
      const bucket = String(body.bucket || 'item-images')
      const storagePath = String(body.storage_path || '')
      /* Only submit our own storage objects — this endpoint must not become
         an open proxy for checking (and thus fetching) arbitrary URLs. */
      if (!mediaUrl.startsWith(`${SUPABASE_URL}/storage/v1/object/public/`) || !storagePath) {
        return json({ error: 'bad_media_url' }, 400)
      }
      const r = await fetch(`https://api.weixin.qq.com/wxa/media_check_async?access_token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: 2, openid, scene: 1, media_type: 2, media_url: mediaUrl }),
      })
      const data = await r.json()
      if (!data?.trace_id) return json({ ok: true, degraded: true, openid })
      /* Record trace → object so the push callback can act on the verdict. */
      await fetch(`${SUPABASE_URL}/rest/v1/wechat_media_checks`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SERVICE,
          Authorization: `Bearer ${SUPABASE_SERVICE}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=ignore-duplicates',
        },
        body: JSON.stringify({ trace_id: data.trace_id, bucket, storage_path: storagePath, user_id: userId }),
      })
      return json({ ok: true, trace_id: data.trace_id, openid })
    }

    return json({ error: 'bad_kind' }, 400)
  } catch {
    return json({ ok: true, degraded: true, openid })
  }
}
