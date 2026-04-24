export const config = { runtime: 'edge' }

/*
 * /api/auth/wechat-login — mp-weixin silent sign-in endpoint.
 *
 * Flow (see docs/WECHAT_MP_SETUP.md §8 for the full ops story):
 *
 *   1. Client calls wx.login() → js_code
 *   2. POST { js_code, nickname?, avatar_url? } here
 *   3. We call api.weixin.qq.com/sns/jscode2session with AppSecret
 *      (server-only) → openid [+ unionid]
 *   4. Look up profiles WHERE wechat_openid = openid. If missing,
 *      use Supabase admin API to create auth.users (which triggers
 *      handle_new_user to seed the profile row) and then call the
 *      upsert_wechat_user RPC to bind wechat_openid.
 *   5. Mint an HS256 JWT signed with SUPABASE_JWT_SECRET. Shape
 *      matches what GoTrue issues so supabase-js accepts it via
 *      setSession(). The client pairs it with our own refresh token
 *      (just the opaque JWT string re-used — short 1h expiry; the
 *      client re-runs wx.login on expiry which is silent anyway).
 *
 * Environment variables REQUIRED on Vercel (production + preview):
 *
 *   WECHAT_APPID              — from mp.weixin.qq.com · 小程序 · 开发管理
 *   WECHAT_APPSECRET          — ditto (NEVER commit, NEVER expose)
 *   SUPABASE_URL              — e.g. https://<ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY — Dashboard · API · service_role secret
 *   SUPABASE_JWT_SECRET       — Dashboard · API · JWT Secret
 *
 * Security posture:
 *   · AppSecret and service_role are read from env ONLY; never
 *     bundled to the client.
 *   · RLS is bypassed by service_role during profile seeding, but
 *     the minted JWT carries the real user's sub so subsequent
 *     REST calls the client makes go through RLS as that user.
 *   · We mint 1h tokens (not forever) so a stolen token has a
 *     short lifetime. wx.login re-auth is silent anyway.
 *   · We never log the AppSecret, js_code, or minted JWT.
 *
 * What this endpoint does NOT do yet (Phase 3 skeleton — honesty):
 *   · No replay / rate-limit protection on js_code
 *     (WeChat's own jscode2session already single-uses js_code,
 *     but we should still add an abuse counter)
 *   · No account linking path for an existing email user who
 *     ALSO wants to bind WeChat to their account. For now, the
 *     two identities stay separate. See §8 of WECHAT_MP_SETUP.md.
 *   · No unionid-aware merge logic across multiple WeChat apps.
 *   · No refresh-token rotation — the client just re-runs wx.login.
 */

function env(name, fallback) {
  return process.env[name] || fallback
}

const WECHAT_APPID        = env('WECHAT_APPID', '')
const WECHAT_APPSECRET    = env('WECHAT_APPSECRET', '')
const SUPABASE_URL        = env('SUPABASE_URL', env('VITE_SUPABASE_URL', ''))
const SUPABASE_SERVICE    = env('SUPABASE_SERVICE_ROLE_KEY', '')
const SUPABASE_JWT_SECRET = env('SUPABASE_JWT_SECRET', '')

const JWT_TTL_SECONDS = 3600

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

function base64url(input) {
  const bytes = typeof input === 'string'
    ? new TextEncoder().encode(input)
    : input
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function hmacSha256(message, secret) {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return base64url(new Uint8Array(sig))
}

async function mintSupabaseJwt(userId) {
  const header  = { alg: 'HS256', typ: 'JWT' }
  const now     = Math.floor(Date.now() / 1000)
  const payload = {
    sub: userId,
    aud: 'authenticated',
    role: 'authenticated',
    iat: now,
    exp: now + JWT_TTL_SECONDS,
    app_metadata: { provider: 'wechat', providers: ['wechat'] },
    user_metadata: {},
  }
  const h = base64url(JSON.stringify(header))
  const p = base64url(JSON.stringify(payload))
  const s = await hmacSha256(`${h}.${p}`, SUPABASE_JWT_SECRET)
  return `${h}.${p}.${s}`
}

async function exchangeCodeForOpenid(jsCode) {
  const url = 'https://api.weixin.qq.com/sns/jscode2session'
    + `?appid=${encodeURIComponent(WECHAT_APPID)}`
    + `&secret=${encodeURIComponent(WECHAT_APPSECRET)}`
    + `&js_code=${encodeURIComponent(jsCode)}`
    + '&grant_type=authorization_code'
  const r = await fetch(url)
  if (!r.ok) throw new Error(`wechat_http_${r.status}`)
  const body = await r.json()
  if (body.errcode) {
    const err = new Error('wechat_exchange_failed')
    err.wxErrcode = body.errcode
    err.wxErrmsg  = body.errmsg
    throw err
  }
  if (!body.openid) throw new Error('wechat_no_openid')
  return { openid: body.openid, unionid: body.unionid || null }
}

async function supabaseAdminFetch(path, init = {}) {
  const r = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE,
      Authorization: `Bearer ${SUPABASE_SERVICE}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const text = await r.text()
  const data = text ? JSON.parse(text) : null
  if (!r.ok) {
    const err = new Error(`supabase_${r.status}`)
    err.detail = data
    throw err
  }
  return data
}

async function findProfileByOpenid(openid) {
  const rows = await supabaseAdminFetch(
    `/rest/v1/profiles?wechat_openid=eq.${encodeURIComponent(openid)}&select=id&limit=1`,
  )
  return rows?.[0]?.id || null
}

async function createWechatAuthUser(openid, nickname) {
  const placeholderEmail = `wx_${openid}@wechat.placeholder`
  const created = await supabaseAdminFetch('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email: placeholderEmail,
      email_confirm: true,
      user_metadata: { nickname: nickname || 'WeChat User' },
    }),
  })
  if (!created?.id) {
    const err = new Error('create_user_no_id')
    err.detail = created
    throw err
  }
  return created.id
}

async function bindWechatIdentity(openid, unionid, nickname, avatar) {
  await supabaseAdminFetch('/rest/v1/rpc/upsert_wechat_user', {
    method: 'POST',
    body: JSON.stringify({
      p_openid:   openid,
      p_unionid:  unionid,
      p_nickname: nickname || '',
      p_avatar:   avatar   || '',
    }),
  })
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  if (!WECHAT_APPID || !WECHAT_APPSECRET) return json({ error: 'wechat_not_configured' }, 503)
  if (!SUPABASE_URL || !SUPABASE_SERVICE) return json({ error: 'supabase_not_configured' }, 503)
  if (!SUPABASE_JWT_SECRET)               return json({ error: 'jwt_secret_not_configured' }, 503)

  let body
  try { body = await request.json() } catch { return json({ error: 'bad_json' }, 400) }

  const jsCode   = typeof body?.js_code === 'string' ? body.js_code.trim() : ''
  const nickname = typeof body?.nickname === 'string' ? body.nickname.slice(0, 40) : ''
  const avatar   = typeof body?.avatar_url === 'string' ? body.avatar_url.slice(0, 500) : ''

  if (!jsCode || jsCode.length > 256) return json({ error: 'bad_js_code' }, 400)

  let openid, unionid
  try {
    ({ openid, unionid } = await exchangeCodeForOpenid(jsCode))
  } catch (err) {
    return json({ error: err.message, wxErrcode: err.wxErrcode }, 400)
  }

  let userId
  try {
    userId = await findProfileByOpenid(openid)
    if (!userId) userId = await createWechatAuthUser(openid, nickname)
    await bindWechatIdentity(openid, unionid, nickname, avatar)
  } catch (err) {
    return json({ error: err.message, detail: err.detail }, 500)
  }

  let access_token
  try {
    access_token = await mintSupabaseJwt(userId)
  } catch (err) {
    return json({ error: 'jwt_sign_failed' }, 500)
  }

  return json({
    access_token,
    refresh_token: access_token,
    token_type: 'bearer',
    expires_in: JWT_TTL_SECONDS,
    user: { id: userId },
  })
}
