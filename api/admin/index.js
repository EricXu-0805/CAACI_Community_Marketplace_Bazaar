export const config = { runtime: 'edge' }

/*
 * Unified admin API surface.
 *
 * Auth model (v2, post-036):
 *   Bearer token per admin (Authorization: Bearer iam_admin_<random>).
 *   The token is SHA-256 hashed and matched against admin_tokens.
 *   On hit, the admin's identity is propagated into every audit-log
 *   row written by RPCs called from this request.
 *
 *   No shared-key fallback (ADM-SEC-01): the legacy ADMIN_API_KEY path
 *   was removed once every admin held a per-admin token. A bearer that
 *   doesn't resolve via admin_token_validate gets a 401 — there is no
 *   second chance. Finish the cutover by deleting the ADMIN_API_KEY env
 *   var (it is no longer read).
 *
 * Why not gate on profiles.is_admin in Supabase instead?
 *   Adding is_admin would require rewriting every RLS policy that
 *   references auth.uid(). A bearer token + service_role keeps the
 *   admin trust boundary OUTSIDE the user auth system — so a
 *   stolen user session cannot reach this surface.
 *
 * Why one edge function instead of per-resource files?
 *   Vercel's free tier caps at 12 edge functions; we already use 5
 *   (translate, moderate, share, share-post, wechat-login). This
 *   multiplexed route keeps the budget while still exposing a
 *   clean REST-ish surface (GET ?resource=... / POST {action,...}).
 *
 * Why raw fetch to PostgREST instead of @supabase/supabase-js?
 *   Sibling edge routes (translate, moderate, share*) already use
 *   raw fetch. Keeping the admin route in the same style avoids
 *   adding a deploy-time dependency — there is no root package.json
 *   and the edge runtime resolves each file independently.
 */

function env(name, fallback) {
  return process.env[name] || fallback
}

const SUPABASE_URL = env('SUPABASE_URL', env('VITE_SUPABASE_URL', ''))
const SERVICE_KEY  = env('SUPABASE_SERVICE_ROLE_KEY', '')
// Reuses the project's existing Sentry DSN (the frontend SDK reads the same
// VITE_SENTRY_DSN). A dedicated SENTRY_DSN wins if ever set; otherwise audit
// failures land in the same Sentry project as client errors — one dashboard.
const SENTRY_DSN   = env('SENTRY_DSN', env('VITE_SENTRY_DSN', ''))

/*
 * ADM-SEC-04: audit writes are best-effort (we never break a request when the
 * audit log is unavailable), but that means a security event can vanish into
 * logs. When a Sentry DSN is present, also emit a Sentry event on an
 * audit-write failure so the gap pages someone. No-op when no DSN is
 * configured — safe default.
 */
async function reportToSentry(message, extra) {
  if (!SENTRY_DSN) return
  try {
    // DSN format: https://<publicKey>@<host>/<projectId>
    const m = SENTRY_DSN.match(/^https:\/\/([^@]+)@([^/]+)\/(.+)$/)
    if (!m) return
    const [, key, host, projectId] = m
    await fetch(`https://${host}/api/${projectId}/store/?sentry_key=${key}&sentry_version=7`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        level: 'error',
        platform: 'javascript',
        logger: 'api/admin',
        extra: extra || {},
      }),
    })
  } catch {
    // A monitoring failure must never affect the request.
  }
}

function reportAuditFailure(kind, err) {
  console.warn(`[admin] audit ${kind} failed`, err?.message)
  reportToSentry(`admin audit write failed: ${kind}`, { error: err?.message || String(err) })
}

async function sha256Hex(input) {
  const buf = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/*
 * Validate the bearer token via PostgREST RPC.
 *
 * Returns:
 *   { ok: true,  adminId, adminName, adminEmail, source: 'token' }
 *   { ok: false, source: 'missing' | 'invalid' }
 *
 * There is NO shared-key fallback: every admin must present a per-admin
 * iam_admin_ token that resolves via admin_token_validate. The legacy
 * ADMIN_API_KEY path was removed (ADM-SEC-01) once all admins were on
 * per-admin tokens; delete the ADMIN_API_KEY env var to finish the cutover.
 */
async function validateBearer(bearer) {
  if (!bearer) return { ok: false, source: 'missing' }

  if (SUPABASE_URL && SERVICE_KEY) {
    try {
      const tokenHash = await sha256Hex(bearer)
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/rpc/admin_token_validate`,
        {
          method: 'POST',
          headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ p_token_hash: tokenHash }),
        },
      )
      if (r.status === 404) {
        // RPC missing — migration 036 not applied. With no shared-key
        // fallback this falls through to a 401 below; 036 is applied in
        // prod, so this branch is effectively unreachable.
      } else if (r.ok) {
        const rows = await r.json().catch(() => [])
        const row = Array.isArray(rows) ? rows[0] : rows
        if (row?.admin_id) {
          return {
            ok: true,
            adminId:    row.admin_id,
            adminName:  row.admin_name,
            adminEmail: row.admin_email,
            source: 'token',
          }
        }
      } else {
        console.warn('[admin] admin_token_validate failed', r.status)
      }
    } catch (err) {
      console.warn('[admin] admin_token_validate threw', err?.message)
    }
  }

  return { ok: false, source: 'invalid' }
}

function readBearer(request) {
  const xKey = request.headers.get('x-admin-key') || ''
  const auth = request.headers.get('authorization') || ''
  const bearer = auth.replace(/^Bearer\s+/i, '')
  return xKey || bearer || ''
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

/*
 * RPC helper. The optional `actorAdminId` parameter, when set, is
 * stuffed into a "Prefer: params=single-object" header so RPCs that
 * accept an `actor_id_in` argument can record the per-admin identity
 * in admin_audit_log. PostgREST has no built-in concept of "auth
 * context for SECURITY DEFINER functions", so we pass it explicitly.
 *
 * Note: today's audit_log RPCs (apply_ban_level, lift_suspension,
 * admin_update_report_status) read the actor from auth.uid(), which
 * is NULL for service_role calls. Migration 036 keeps those RPCs
 * unchanged — the admin_id from this header is logged via a separate
 * admin_login event below, which is enough to map "this request →
 * this admin" in the audit log timeline. A follow-up migration can
 * thread actor_admin_id directly into apply_ban_level if needed.
 */
async function rpc(fn, args) {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('supabase_not_configured')
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify(args || {}),
  })
  const text = await r.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!r.ok) {
    const msg = (data && data.message) || `postgrest_${r.status}`
    throw new Error(msg)
  }
  return data
}

async function recordAdminLogin(adminId, source) {
  if (!SUPABASE_URL || !SERVICE_KEY) return
  if (!adminId) return
  try {
    await rpc('record_audit', {
      event_kind_in: 'admin_login',
      actor_id_in:   adminId,
      target_id_in:  null,
      details_in:    { auth_source: source },
    })
  } catch (err) {
    // Audit failures must never break a request. Swallow + warn.
    reportAuditFailure('admin_login', err)
  }
}

async function handleGet(request, auth) {
  const url = new URL(request.url)
  const resource = url.searchParams.get('resource') || ''
  const limit = Math.max(1, Math.min(200, parseInt(url.searchParams.get('limit') || '50', 10)))
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10))

  if (resource === 'whoami') {
    /*
     * Returns the current admin's identity so the dashboard can show
     * "logged in as <name>" in its header. Pulled from the auth result
     * we already computed in checkAuth — no extra DB roundtrip. Legacy
     * shared-key sessions return null fields (no per-admin identity).
     */
    return json({
      data: {
        admin_id:    auth?.adminId    || null,
        admin_name:  auth?.adminName  || null,
        admin_email: auth?.adminEmail || null,
        source:      auth?.source     || null,
      },
    })
  }

  if (resource === 'stats') {
    const data = await rpc('admin_dashboard_stats', {})
    return json({ data: Array.isArray(data) ? data[0] : data })
  }

  if (resource === 'suspensions') {
    const activeOnly = url.searchParams.get('active') === '1'
    const data = await rpc('admin_list_suspensions', {
      limit_in: limit, offset_in: offset, active_only_in: activeOnly,
    })
    return json({ data })
  }

  if (resource === 'suspension') {
    const id = url.searchParams.get('id')
    if (!id) return json({ error: 'missing_id' }, 400)
    const data = await rpc('admin_get_suspension_detail', { suspension_id_in: id })
    return json({ data: Array.isArray(data) ? data[0] : data })
  }

  if (resource === 'reports') {
    const status = url.searchParams.get('status')
    const data = await rpc('admin_list_reports', {
      limit_in: limit, offset_in: offset, status_filter: status || null,
    })
    return json({ data })
  }

  if (resource === 'reports_grouped') {
    const pendingOnly = url.searchParams.get('pending') !== '0'
    const data = await rpc('admin_list_reports_grouped', {
      limit_in: limit, offset_in: offset, pending_only: pendingOnly,
    })
    return json({ data })
  }

  if (resource === 'report') {
    const id = url.searchParams.get('id')
    if (!id) return json({ error: 'missing_id' }, 400)
    const data = await rpc('admin_get_report_detail', { report_id_in: id })
    return json({ data: Array.isArray(data) ? data[0] : data })
  }

  if (resource === 'search_users') {
    const q = url.searchParams.get('q') || ''
    const data = await rpc('admin_search_users', { query_in: q, limit_in: limit })
    return json({ data })
  }

  if (resource === 'linked_accounts') {
    const profileId = url.searchParams.get('profile_id')
    if (!profileId) return json({ error: 'missing_profile_id' }, 400)
    const data = await rpc('admin_get_linked_accounts', { profile_id_in: profileId })
    return json({ data })
  }

  if (resource === 'appeals') {
    const data = await rpc('admin_list_appeals', { limit_in: limit, offset_in: offset })
    return json({ data })
  }

  if (resource === 'warnings') {
    const data = await rpc('admin_list_warnings', { limit_in: limit, offset_in: offset })
    return json({ data })
  }

  if (resource === 'profile_suspensions') {
    const profileId = url.searchParams.get('profile_id')
    if (!profileId) return json({ error: 'missing_profile_id' }, 400)
    const data = await rpc('admin_get_profile_suspensions', { profile_id_in: profileId })
    return json({ data })
  }

  if (resource === 'audit') {
    const kind = url.searchParams.get('kind')
    const data = await rpc('admin_list_audit_log', {
      limit_in: limit, offset_in: offset, kind_filter: kind || null,
    })
    return json({ data })
  }

  if (resource === 'tokens') {
    const data = await rpc('admin_token_list', {})
    return json({ data })
  }

  return json({ error: 'unknown_resource' }, 400)
}

async function handlePost(request, auth) {
  const body = await request.json().catch(() => null)
  if (!body || !body.action) return json({ error: 'missing_action' }, 400)

  if (body.action === 'apply_ban') {
    if (!body.target_id || typeof body.level !== 'number' || !body.reason) {
      return json({ error: 'missing_args' }, 400)
    }
    const data = await rpc('apply_ban_level', {
      target_in:   body.target_id,
      level_in:    body.level,
      reason_in:   body.reason,
      category_in: body.category || 'generic',
      hours_in:    body.hours ?? null,
    })
    if (auth.adminId) {
      await rpc('record_audit', {
        event_kind_in: 'ban_applied',
        actor_id_in:   auth.adminId,
        target_id_in:  body.target_id,
        details_in: {
          via: 'edge_admin',
          level: body.level,
          reason: body.reason,
          category: body.category || 'generic',
        },
      }).catch(err => reportAuditFailure('ban_applied', err))
    }
    return json({ data })
  }

  if (body.action === 'lift_suspension') {
    if (!body.suspension_id || !body.reason) {
      return json({ error: 'missing_args' }, 400)
    }
    await rpc('lift_suspension', {
      suspension_id: body.suspension_id,
      reason_in:     body.reason,
    })
    if (auth.adminId) {
      await rpc('record_audit', {
        event_kind_in: 'suspension_lifted',
        actor_id_in:   auth.adminId,
        target_id_in:  null,
        details_in: {
          via: 'edge_admin',
          suspension_id: body.suspension_id,
          reason: body.reason,
        },
      }).catch(err => reportAuditFailure('suspension_lifted', err))
    }
    return json({ success: true })
  }

  if (body.action === 'update_report_status') {
    if (!body.report_id || !body.status) {
      return json({ error: 'missing_args' }, 400)
    }
    await rpc('admin_update_report_status', {
      report_id_in: body.report_id,
      status_in:    body.status,
    })
    if (auth.adminId) {
      await rpc('record_audit', {
        event_kind_in: 'report_status_changed',
        actor_id_in:   auth.adminId,
        target_id_in:  body.report_id,
        details_in: {
          via: 'edge_admin',
          to: body.status,
        },
      }).catch(err => reportAuditFailure('report_status_changed', err))
    }
    return json({ success: true })
  }

  if (body.action === 'resolve_target_reports') {
    if (!body.target_type || !body.target_id || !body.status) {
      return json({ error: 'missing_args' }, 400)
    }
    const data = await rpc('admin_resolve_target_reports', {
      target_type_in: body.target_type,
      target_id_in:   body.target_id,
      status_in:      body.status,
    })
    if (auth.adminId) {
      await rpc('record_audit', {
        event_kind_in: 'report_status_changed',
        actor_id_in:   auth.adminId,
        target_id_in:  body.target_id,
        details_in: {
          via: 'edge_admin',
          bulk: true,
          target_type: body.target_type,
          to: body.status,
        },
      }).catch(err => reportAuditFailure('report_status_changed_bulk', err))
    }
    return json({ data })
  }

  if (body.action === 'takedown_content') {
    if (!body.target_type || !body.target_id) {
      return json({ error: 'missing_args' }, 400)
    }
    const data = await rpc('admin_takedown_content', {
      target_type_in: body.target_type,
      target_id_in:   body.target_id,
      reason_in:      body.reason || null,
    })
    if (auth.adminId) {
      await rpc('record_audit', {
        event_kind_in: 'content_takedown',
        actor_id_in:   auth.adminId,
        target_id_in:  body.target_id,
        details_in: {
          via: 'edge_admin',
          target_type: body.target_type,
          reason: body.reason || null,
        },
      }).catch(err => reportAuditFailure('content_takedown', err))
    }
    return json({ data })
  }

  if (body.action === 'revoke_token') {
    if (!body.token_id) return json({ error: 'missing_args' }, 400)
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/admin_tokens?id=eq.${encodeURIComponent(body.token_id)}`,
      {
        method: 'PATCH',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ revoked_at: new Date().toISOString() }),
      },
    )
    if (!r.ok) {
      const detail = await r.json().catch(() => ({}))
      return json({ error: 'revoke_failed', detail }, 500)
    }
    if (auth.adminId) {
      await rpc('record_audit', {
        event_kind_in: 'token_revoked',
        actor_id_in:   auth.adminId,
        target_id_in:  null,
        details_in: {
          via: 'edge_admin',
          token_id: body.token_id,
        },
      }).catch(err => console.warn('[admin] audit token_revoked failed', err?.message))
    }
    return json({ success: true })
  }

  return json({ error: 'unknown_action' }, 400)
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 })

  /*
   * ADM-SEC-06: per-IP rate limit, ahead of auth so credential-stuffing /
   * audit-spam / flood is throttled before any token work. 120 req/min is far
   * above any legitimate admin's burst. Fails OPEN — a rate-store hiccup must
   * never lock the real admins out.
   */
  if (SUPABASE_URL && SERVICE_KEY) {
    try {
      const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
      const bucket = 'admin:' + (await sha256Hex(ip))
      const allowed = await rpc('edge_rate_hit', { bucket_in: bucket, max_in: 120, window_secs_in: 60 })
      if (allowed === false) return json({ error: 'rate_limited' }, 429)
    } catch (err) {
      console.warn('[admin] rate check failed (fail-open)', err?.message)
    }
  }

  const bearer = readBearer(request)
  const auth = await validateBearer(bearer)
  if (!auth.ok) {
    /*
     * Audit unauthorized attempts. Useful for spotting credential
     * stuffing or a leaked-token scenario in the wild. We deliberately
     * include only minimal fingerprinting (the SHA-256 prefix of the
     * presented bearer) so the audit log itself doesn't become a
     * leak vector.
     */
    if (bearer && SUPABASE_URL && SERVICE_KEY) {
      try {
        const presentedHash = await sha256Hex(bearer)
        await rpc('record_audit', {
          event_kind_in: 'admin_unauthorized',
          actor_id_in:   null,
          target_id_in:  null,
          details_in: {
            source: auth.source,
            hash_prefix: presentedHash.slice(0, 8),
          },
        })
      } catch (err) {
        reportAuditFailure('admin_unauthorized', err)
      }
    }
    return json({ error: auth.source === 'missing' ? 'unauthorized' : 'unauthorized' }, 401)
  }

  if (auth.source === 'token') {
    await recordAdminLogin(auth.adminId, auth.source)
  }

  try {
    if (request.method === 'GET')  return await handleGet(request, auth)
    if (request.method === 'POST') return await handlePost(request, auth)
    return json({ error: 'method_not_allowed' }, 405)
  } catch (err) {
    return json({ error: err?.message || 'internal_error' }, 500)
  }
}
