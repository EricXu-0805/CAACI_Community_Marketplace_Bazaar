export const config = { runtime: 'edge' }

/*
 * /api/auth/wechat-login — mp-weixin silent sign-in endpoint.
 *
 * Architecture (v2, 2025 post-JWT-Signing-Keys era):
 *
 *   1. Client calls wx.login() → js_code
 *   2. POST { js_code, nickname?, avatar_url? } here
 *   3. We call api.weixin.qq.com/sns/jscode2session with AppSecret
 *      (server-only) → openid [+ unionid]
 *   4. Derive a deterministic virtual email + password per openid:
 *        email    = wx_<openid>@wechat.placeholder
 *        password = HMAC-SHA256(openid, WECHAT_USER_PASSWORD_SALT)
 *      Password is unguessable without SALT (server-only) but stable
 *      per-user so returning users always authenticate to the same
 *      auth.users row.
 *   5. Idempotent admin.createUser — first login creates the auth row
 *      (which fires handle_new_user → seeds profiles), subsequent
 *      logins return 422 email_exists which we swallow.
 *   6. POST /auth/v1/token?grant_type=password → real GoTrue session
 *      with access_token AND refresh_token. Key win over the v1
 *      JWT-mint design: supabase-js setSession works correctly, auto-
 *      refresh works, no HS256/ES256 signing key to manage.
 *   7. PATCH /rest/v1/profiles?id=eq.<user_id> using service_role to
 *      bind wechat_openid + wechat_unionid onto the freshly-created
 *      profile row, fill nickname/avatar if the trigger defaulted
 *      them. We use session.user.id here instead of calling migration
 *      034's upsert_wechat_user RPC because that RPC was designed
 *      for the "already-bound" path and cannot do the first-time bind.
 *   8. Return the session body verbatim to the client; shape is the
 *      standard GoTrue token response.
 *
 * Why this design instead of minting our own JWT:
 *   · Supabase 2024+ migrated from a single HS256 JWT secret to an
 *     asymmetric JWT Signing Keys system where the ES256 private key
 *     is never exposed. Minting JWTs externally requires generating
 *     our own key pair, importing the public half into Supabase, and
 *     rotating — not worth it for a mini-program login.
 *   · Admin API path is the officially recommended 2025 pattern (see
 *     docs/WECHAT_MP_SETUP.md §8 for citations).
 *   · Works identically whether the project is on Legacy HS256 or
 *     new ES256 Signing Keys — nothing to migrate if Supabase later
 *     revokes the legacy key.
 *
 * Environment variables REQUIRED on Vercel (production + preview):
 *
 *   WECHAT_APPID                — mp.weixin.qq.com · 开发设置
 *   WECHAT_APPSECRET            — ditto (NEVER commit, NEVER expose)
 *   SUPABASE_URL                — https://<ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY   — Dashboard · API Keys · service_role
 *   SUPABASE_ANON_KEY           — Dashboard · API Keys · anon
 *   WECHAT_USER_PASSWORD_SALT   — random 32+ bytes generated via
 *                                 `openssl rand -base64 32`.
 *                                 Server-only. DO NOT rotate without
 *                                 migrating every WeChat user's
 *                                 stored password.
 *
 * Security posture:
 *   · AppSecret, service_role, and password salt are read from env
 *     ONLY; never bundled to the client.
 *   · Passwords on auth.users are bcrypt-hashed by GoTrue per its
 *     usual policy — even a Supabase DB breach does not expose
 *     openids directly (attacker would still need the salt to HMAC
 *     an openid → password pair).
 *   · Per-user password entropy = 256 bits (HMAC-SHA256 output),
 *     well above brute-force feasibility.
 *   · GET health branch reports env-var presence without values.
 *
 * What this endpoint does NOT do yet:
 *   · No account linking between email users and WeChat users.
 *   · No per-IP / per-openid rate limiting at the edge. Supabase
 *     Auth throttles signInWithPassword; WeChat's jscode2session is
 *     single-use so js_code replay is impossible.
 *   · No unionid-aware merge across multiple WeChat apps.
 */

function env(name, fallback) {
  return process.env[name] || fallback
}

const WECHAT_APPID     = env('WECHAT_APPID', '')
const WECHAT_APPSECRET = env('WECHAT_APPSECRET', '')
const SUPABASE_URL     = env('SUPABASE_URL', env('VITE_SUPABASE_URL', ''))
const SUPABASE_SERVICE = env('SUPABASE_SERVICE_ROLE_KEY', '')
const SUPABASE_ANON    = env('SUPABASE_ANON_KEY', env('VITE_SUPABASE_ANON_KEY', ''))
const PASSWORD_SALT    = env('WECHAT_USER_PASSWORD_SALT', '')

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

async function hmacHex(message, secret) {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
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

function emailFor(openid) {
  return `wx_${openid}@wechat.placeholder`
}

async function adminCreateIdempotent(email, password, nickname) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE,
      Authorization: `Bearer ${SUPABASE_SERVICE}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { provider: 'wechat', nickname: nickname || 'WeChat User' },
    }),
  })
  if (r.ok) return
  const detail = await r.json().catch(() => ({}))
  const msg = JSON.stringify(detail || {}).toLowerCase()
  const alreadyExists = (r.status === 422 || r.status === 400) && (
    msg.includes('already been registered')
    || msg.includes('email_exists')
    || msg.includes('already exists')
    || msg.includes('user already registered')
    || msg.includes('duplicate key')
  )
  if (alreadyExists) return
  const err = new Error('admin_create_user_failed')
  err.detail = detail
  err.status = r.status
  throw err
}

async function signInWithPassword(email, password) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) {
    const err = new Error('signin_failed')
    err.detail = body
    err.status = r.status
    throw err
  }
  return body
}

async function bindWechatIdentityOnProfile(userId, openid, unionid, nickname, avatar) {
  const patch = { wechat_openid: openid }
  if (unionid) patch.wechat_unionid = unionid
  if (nickname) patch.nickname = String(nickname).slice(0, 40)
  if (avatar) patch.avatar_url = String(avatar).slice(0, 500)

  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`,
    {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_SERVICE,
        Authorization: `Bearer ${SUPABASE_SERVICE}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(patch),
    },
  )
  if (!r.ok) {
    const detail = await r.json().catch(() => ({}))
    const err = new Error('bind_wechat_identity_failed')
    err.detail = detail
    err.status = r.status
    throw err
  }
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 })

  if (request.method === 'GET') {
    return json({
      endpoint: 'wechat-login',
      configured: {
        WECHAT_APPID:              !!WECHAT_APPID,
        WECHAT_APPSECRET:          !!WECHAT_APPSECRET,
        SUPABASE_URL:              !!SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: !!SUPABASE_SERVICE,
        SUPABASE_ANON_KEY:         !!SUPABASE_ANON,
        WECHAT_USER_PASSWORD_SALT: !!PASSWORD_SALT,
      },
      ready: !!(
        WECHAT_APPID && WECHAT_APPSECRET
        && SUPABASE_URL && SUPABASE_SERVICE && SUPABASE_ANON
        && PASSWORD_SALT
      ),
    })
  }

  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  if (!WECHAT_APPID || !WECHAT_APPSECRET) return json({ error: 'wechat_not_configured' }, 503)
  if (!SUPABASE_URL || !SUPABASE_SERVICE || !SUPABASE_ANON) return json({ error: 'supabase_not_configured' }, 503)
  if (!PASSWORD_SALT) return json({ error: 'password_salt_not_configured' }, 503)

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

  const password = await hmacHex(openid, PASSWORD_SALT)
  const email    = emailFor(openid)

  let session
  try {
    await adminCreateIdempotent(email, password, nickname)
    session = await signInWithPassword(email, password)
    if (!session?.user?.id) throw new Error('signin_no_user_id')
    await bindWechatIdentityOnProfile(session.user.id, openid, unionid, nickname, avatar)
  } catch (err) {
    /*
     * Log detailed error server-side (visible in Vercel function logs)
     * but return ONLY a generic opaque error code to the client. The
     * prior shape leaked err.message + err.detail + Supabase status
     * to anyone calling the endpoint, which enables:
     *   · account enumeration (different error per "email exists" vs
     *     "invalid credentials" vs "create failed")
     *   · fingerprinting of our Supabase version + auth flow
     *   · probing for PASSWORD_SALT misconfiguration via differential
     *     error messages
     * Client gets a stable "login_failed" it can surface generically;
     * ops can pull the real error from function logs by correlating
     * on the timestamp or adding a request-id later if needed.
     */
    console.error('[wechat-login] auth path failed', {
      openid_suffix: openid?.slice(-6),
      message: err?.message,
      detail: err?.detail,
      status: err?.status,
    })
    return json({ error: 'login_failed' }, 500)
  }

  return json(session)
}
