export const config = { runtime: 'edge' }

/*
 * /api/auth/delete-account — IRREVERSIBLE hard delete of the authenticated
 * caller's own account (QA4 B15). Replaces the soft-delete delete_my_account
 * RPC, which only anonymized the profile + tombstoned items and left auth.users
 * (so the email stayed registered and most owned content survived) — contradicting
 * the "permanent, cannot be undone" promise in the delete dialog.
 *
 * SAFETY — the entire correctness of this endpoint is "delete ONLY the caller":
 *   · The target uid is derived ONLY from validating the caller's own access
 *     token against GoTrue (GET /auth/v1/user with the ANON key). It is NEVER
 *     read from the request body or a query param.
 *   · If the body carries a user_id that isn't the caller's, return 403 — a
 *     defense-in-depth tripwire against any client that thinks it can target
 *     another account.
 *   · The service-role key is used ONLY after the uid is established, purely to
 *     run the admin delete on that already-derived uid.
 *
 * What the hard delete destroys (auth.users delete cascades profiles ->
 * ON DELETE CASCADE across items, conversations, messages, favorites, follows,
 * ratings, offers, meetups, notifications, reports, blocks, saved_searches,
 * suspensions, device_fingerprints, posts, post_comments, post_likes,
 * post_comment_likes; admin_tokens.created_by -> SET NULL; auth sessions /
 * identities / mfa / tokens). Storage objects and wechat_password_map have NO
 * FK to auth.users, so they are swept manually BEFORE the delete (after the
 * cascade we lose the wechat_openid mapping). Errors are kept opaque.
 *
 * Env (already present for wechat-login/admin): SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.
 */

function env(name, fallback) {
  return process.env[name] || fallback
}

const SUPABASE_URL  = env('SUPABASE_URL', env('VITE_SUPABASE_URL', ''))
const SERVICE_KEY   = env('SUPABASE_SERVICE_ROLE_KEY', '')
const ANON_KEY      = env('SUPABASE_ANON_KEY', env('VITE_SUPABASE_ANON_KEY', ''))
const IMAGE_BUCKET  = 'item-images'

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

// Validate the caller's access token and return their uid, or null.
async function identifyCaller(jwt) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${jwt}` },
  })
  if (!r.ok) return null
  const user = await r.json().catch(() => null)
  return user?.id || null
}

// Best-effort: remove every object under items/<uid>/ (user-scoped prefix).
// Public-bucket reads don't help here; service key lists + removes.
async function sweepStorage(uid) {
  const listR = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${IMAGE_BUCKET}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prefix: `items/${uid}`, limit: 1000 }),
  })
  if (!listR.ok) return
  const rows = await listR.json().catch(() => [])
  if (!Array.isArray(rows) || rows.length === 0) return
  const prefixes = rows.filter(o => o?.name).map(o => `items/${uid}/${o.name}`)
  if (!prefixes.length) return
  await fetch(`${SUPABASE_URL}/storage/v1/object/${IMAGE_BUCKET}`, {
    method: 'DELETE',
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prefixes }),
  })
}

// Best-effort: clear the user's wechat_password_map row (no FK to auth.users).
async function sweepWechatPassword(uid) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(uid)}&select=wechat_openid`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: 'application/json' } },
  )
  if (!r.ok) return
  const rows = await r.json().catch(() => [])
  const openid = Array.isArray(rows) && rows[0]?.wechat_openid
  if (!openid) return
  await fetch(
    `${SUPABASE_URL}/rest/v1/wechat_password_map?openid=eq.${encodeURIComponent(openid)}`,
    { method: 'DELETE', headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Prefer: 'return=minimal' } },
  )
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) return json({ error: 'not_configured' }, 503)

  // (A) Identify the caller from their OWN JWT — the only id we ever trust.
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ error: 'unauthorized' }, 401)
  const uid = await identifyCaller(jwt)
  if (!uid) return json({ error: 'unauthorized' }, 401)

  // Defense-in-depth: a body id that isn't the caller is a hard stop.
  const body = await req.json().catch(() => ({}))
  if (body && body.user_id && body.user_id !== uid) return json({ error: 'forbidden' }, 403)

  // (B) Sweep things with NO FK to auth.users BEFORE the cascade removes the
  //     profile (and with it the wechat_openid mapping). Best-effort.
  try { await sweepStorage(uid) } catch (e) { console.error('[delete-account] storage sweep failed', e?.message) }
  try { await sweepWechatPassword(uid) } catch (e) { console.error('[delete-account] wechat sweep failed', e?.message) }

  // (C) Hard delete the auth user (permanent — no should_soft_delete). This
  //     cascades the profile and all owned public.* rows + auth sub-rows.
  const del = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  })
  if (!del.ok) {
    console.error('[delete-account] admin delete failed', del.status)
    return json({ error: 'delete_failed' }, 500)
  }
  return json({ success: true })
}
