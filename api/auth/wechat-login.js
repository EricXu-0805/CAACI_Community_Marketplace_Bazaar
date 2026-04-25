export const config = { runtime: 'edge' }

/*
 * /api/auth/wechat-login — mp-weixin silent sign-in endpoint.
 *
 * Architecture (v3, 2025-12 — wechat_password_map era):
 *
 *   1. Client calls wx.login() → js_code
 *   2. POST { js_code, nickname?, avatar_url? } here
 *   3. We call api.weixin.qq.com/sns/jscode2session with AppSecret
 *      (server-only) → openid [+ unionid]
 *   4. Resolve the user's GoTrue password:
 *        a. Look up wechat_password_map[openid]. If found, use it.
 *        b. Otherwise generate a fresh 32-byte random hex password,
 *           call admin.updateUserById to set it on auth.users (or
 *           admin.createUser if the row doesn't exist yet), then
 *           UPSERT into wechat_password_map for next time.
 *        c. Transitional fallback: if migration 035 has not been
 *           applied (table missing → 404 from PostgREST), and the
 *           legacy WECHAT_USER_PASSWORD_SALT env var IS set, derive
 *           the password via HMAC like v2 used to. This branch will
 *           be removed once the wechat_password_map table is
 *           guaranteed-present in every environment.
 *   5. POST /auth/v1/token?grant_type=password → real GoTrue session
 *      with access_token AND refresh_token.
 *   6. PATCH /rest/v1/profiles?id=eq.<user_id> using service_role to
 *      bind wechat_openid + wechat_unionid onto the freshly-created
 *      profile row, fill nickname/avatar if the trigger defaulted
 *      them.
 *   7. Return the session body verbatim to the client.
 *
 * Why per-user random passwords instead of HMAC(openid, SALT):
 *   · Single-secret blast radius: a leaked SALT lets an attacker
 *     compute every user's plaintext password from their (non-secret)
 *     openid. Per-user random passwords cap the damage at one user.
 *   · Rotatable: rotating SALT in v2 invalidated EVERY existing
 *     user. Rotating one row in wechat_password_map invalidates
 *     exactly that user — they can re-login and get a fresh password.
 *   · Defense in depth: the password row in postgres is plaintext
 *     (not bcrypt) so we can pass it to GoTrue's signInWithPassword
 *     unchanged. Mitigations: RLS deny-all on wechat_password_map,
 *     no anon/authenticated grants, service_role-only access. A DB
 *     dump still requires the WeChat AppSecret + email mapping to
 *     be useful to an attacker.
 *
 * Environment variables REQUIRED on Vercel (production + preview):
 *
 *   WECHAT_APPID                — mp.weixin.qq.com · 开发设置
 *   WECHAT_APPSECRET            — ditto (NEVER commit, NEVER expose)
 *   SUPABASE_URL                — https://<ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY   — Dashboard · API Keys · service_role
 *   SUPABASE_ANON_KEY           — Dashboard · API Keys · anon
 *
 * Env var TRANSITIONAL (drop after all active users have migrated):
 *
 *   WECHAT_USER_PASSWORD_SALT   — only consulted when the new
 *                                 wechat_password_map table is
 *                                 unreachable (e.g. migration 035
 *                                 not yet applied). Once you confirm
 *                                 every active user has a row in
 *                                 wechat_password_map you can delete
 *                                 the env var; the lookup branch
 *                                 will then surface a clear error
 *                                 to anyone who never re-logged.
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

function randomHex(byteLen = 32) {
  const buf = new Uint8Array(byteLen)
  crypto.getRandomValues(buf)
  return Array.from(buf)
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

/*
 * Fetch the stored auth password for an openid from
 * public.wechat_password_map (migration 035). Returns:
 *   { password: string }            — found, use this
 *   { password: null }              — not found, caller must mint+store
 *   { password: null, missing: true } — table doesn't exist yet
 *                                       (migration 035 unapplied);
 *                                       caller may fall back to HMAC
 *
 * service_role bypasses RLS; the table denies anon/authenticated entirely.
 */
async function lookupStoredPassword(openid) {
  const url = `${SUPABASE_URL}/rest/v1/wechat_password_map`
    + `?select=password&openid=eq.${encodeURIComponent(openid)}&limit=1`
  const r = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE,
      Authorization: `Bearer ${SUPABASE_SERVICE}`,
      Accept: 'application/json',
    },
  })
  if (r.status === 404) return { password: null, missing: true }
  if (!r.ok) {
    const detail = await r.json().catch(() => ({}))
    const err = new Error('wechat_password_lookup_failed')
    err.detail = detail
    err.status = r.status
    throw err
  }
  const rows = await r.json().catch(() => [])
  const password = Array.isArray(rows) && rows[0]?.password ? rows[0].password : null
  return { password }
}

async function storePassword(openid, password) {
  const url = `${SUPABASE_URL}/rest/v1/wechat_password_map`
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE,
      Authorization: `Bearer ${SUPABASE_SERVICE}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({ openid, password }),
  })
  if (!r.ok) {
    const detail = await r.json().catch(() => ({}))
    const err = new Error('wechat_password_store_failed')
    err.detail = detail
    err.status = r.status
    throw err
  }
}

async function adminLookupUserByEmail(email) {
  const url = `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`
  const r = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE,
      Authorization: `Bearer ${SUPABASE_SERVICE}`,
    },
  })
  if (!r.ok) {
    const detail = await r.json().catch(() => ({}))
    const err = new Error('admin_lookup_failed')
    err.detail = detail
    err.status = r.status
    throw err
  }
  const body = await r.json().catch(() => ({}))
  const user = Array.isArray(body?.users) ? body.users[0] : null
  return user || null
}

async function adminUpdateUserPassword(userId, password) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers: {
      apikey: SUPABASE_SERVICE,
      Authorization: `Bearer ${SUPABASE_SERVICE}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password }),
  })
  if (!r.ok) {
    const detail = await r.json().catch(() => ({}))
    const err = new Error('admin_update_user_failed')
    err.detail = detail
    err.status = r.status
    throw err
  }
}

/*
 * Idempotent createOrUpdate: try create with the given password. If
 * the user already exists, look them up and PUT the password onto the
 * existing row. Returns nothing on success; throws on hard failure.
 *
 * On the 422 "already exists" branch we MUST update the password,
 * not swallow — the caller is about to call signInWithPassword with
 * `password`, which will fail unless we sync auth.users.
 */
async function adminUpsertUserWithPassword(email, password, nickname) {
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
  if (!alreadyExists) {
    const err = new Error('admin_create_user_failed')
    err.detail = detail
    err.status = r.status
    throw err
  }

  const existing = await adminLookupUserByEmail(email)
  if (!existing?.id) {
    const err = new Error('admin_user_exists_but_lookup_empty')
    err.detail = { lookup_email: email }
    throw err
  }
  await adminUpdateUserPassword(existing.id, password)
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

function sanitizeNickname(raw) {
  if (typeof raw !== 'string') return ''
  return raw
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[\u200B-\u200F\uFEFF]/g, '')
    .trim()
    .slice(0, 40)
}

function sanitizeAvatarUrl(raw) {
  if (typeof raw !== 'string') return ''
  const trimmed = raw.trim().slice(0, 500)
  if (!/^https?:\/\//i.test(trimmed)) return ''
  return trimmed
}

async function bindWechatIdentityOnProfile(userId, openid, unionid, nickname, avatar) {
  const patch = { wechat_openid: openid }
  if (unionid) patch.wechat_unionid = unionid
  const cleanNickname = sanitizeNickname(nickname)
  if (cleanNickname) patch.nickname = cleanNickname
  const cleanAvatar = sanitizeAvatarUrl(avatar)
  if (cleanAvatar) patch.avatar_url = cleanAvatar

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

/*
 * Resolve the GoTrue password for `openid`. Three paths:
 *
 *   1. wechat_password_map has a row → use it (steady state).
 *   2. Table reachable but no row → mint random 32-byte hex,
 *      sync auth.users via admin upsert, persist to map, return.
 *   3. Table missing (migration 035 not applied) AND
 *      WECHAT_USER_PASSWORD_SALT env var present → fall back to
 *      HMAC for backward compat. We do NOT attempt to migrate
 *      this user yet — once the migration runs, their next login
 *      hits path 2 and they're upgraded automatically.
 *
 * Returns the resolved password string.
 */
async function resolvePassword(openid, email, nickname) {
  const looked = await lookupStoredPassword(openid).catch(err => {
    if (err?.status === 404) return { password: null, missing: true }
    throw err
  })

  if (looked.password) {
    return looked.password
  }

  if (looked.missing) {
    if (!PASSWORD_SALT) {
      const err = new Error('password_storage_unavailable')
      err.detail = { hint: 'Apply supabase/migrations/035_wechat_password_map.sql, or set WECHAT_USER_PASSWORD_SALT during transition.' }
      throw err
    }
    return await hmacHex(openid, PASSWORD_SALT)
  }

  const fresh = randomHex(32)
  await adminUpsertUserWithPassword(email, fresh, nickname)
  await storePassword(openid, fresh)
  return fresh
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 })

  if (request.method === 'GET') {
    return json({
      endpoint: 'wechat-login',
      version: 'v3-wechat_password_map',
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
      ),
    })
  }

  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  if (!WECHAT_APPID || !WECHAT_APPSECRET) return json({ error: 'wechat_not_configured' }, 503)
  if (!SUPABASE_URL || !SUPABASE_SERVICE || !SUPABASE_ANON) return json({ error: 'supabase_not_configured' }, 503)

  let body
  try { body = await request.json() } catch { return json({ error: 'bad_json' }, 400) }

  const jsCode   = typeof body?.js_code === 'string' ? body.js_code.trim() : ''
  const nickname = sanitizeNickname(body?.nickname)
  const avatar   = sanitizeAvatarUrl(body?.avatar_url)

  if (!jsCode || jsCode.length > 256) return json({ error: 'bad_js_code' }, 400)

  let openid, unionid
  try {
    ({ openid, unionid } = await exchangeCodeForOpenid(jsCode))
  } catch (err) {
    return json({ error: err.message, wxErrcode: err.wxErrcode }, 400)
  }

  const email = emailFor(openid)

  let session
  try {
    const password = await resolvePassword(openid, email, nickname)
    session = await signInWithPassword(email, password)
    if (!session?.user?.id) throw new Error('signin_no_user_id')
    await bindWechatIdentityOnProfile(session.user.id, openid, unionid, nickname, avatar)
  } catch (err) {
    /*
     * Log detailed error server-side (visible in Vercel function logs)
     * but return ONLY a generic opaque error code to the client. This
     * avoids leaking:
     *   · account enumeration (different error per "email exists" vs
     *     "invalid credentials" vs "create failed")
     *   · fingerprinting of our Supabase version + auth flow
     *   · probing for storage/migration state via differential errors
     * Client gets a stable "login_failed" it can surface generically;
     * ops can pull the real error from function logs by correlating
     * on the timestamp.
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
