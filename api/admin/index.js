export const config = { runtime: 'edge' }

/*
 * Unified admin API surface.
 *
 * Gating: ADMIN_API_KEY header (x-admin-key OR Authorization: Bearer).
 * The key lives in Vercel env; the admin dashboard prompts the
 * operator on first visit and stores it in localStorage only.
 *
 * Why not gate on profiles.is_admin in Supabase instead?
 *   Adding is_admin would require rewriting every RLS policy that
 *   references auth.uid(). A shared-secret API key + service_role
 *   keeps the admin trust boundary OUTSIDE the user auth system — so
 *   a stolen user session cannot reach this surface.
 *
 * Why one edge function instead of per-resource files?
 *   Vercel's free tier caps at 12 edge functions; we already use 5
 *   (translate, moderate, share, share-post, probe-022). This
 *   multiplexed route keeps the budget while still exposing a clean
 *   REST-ish surface (GET ?resource=... / POST {action,...}).
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

function checkAuth(request) {
  const key = env('ADMIN_API_KEY', '')
  if (!key) throw new Error('admin_not_configured')

  const xKey = request.headers.get('x-admin-key') || ''
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  const provided = xKey || bearer

  if (!provided || provided !== key) throw new Error('unauthorized')
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

async function handleGet(request) {
  const url = new URL(request.url)
  const resource = url.searchParams.get('resource') || ''
  const limit = Math.max(1, Math.min(200, parseInt(url.searchParams.get('limit') || '50', 10)))
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10))

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

  if (resource === 'report') {
    const id = url.searchParams.get('id')
    if (!id) return json({ error: 'missing_id' }, 400)
    const data = await rpc('admin_get_report_detail', { report_id_in: id })
    return json({ data: Array.isArray(data) ? data[0] : data })
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

  return json({ error: 'unknown_resource' }, 400)
}

async function handlePost(request) {
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
    return json({ success: true })
  }

  return json({ error: 'unknown_action' }, 400)
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 })

  try {
    checkAuth(request)
  } catch (err) {
    const code = err.message === 'admin_not_configured' ? 503 : 401
    return json({ error: err.message }, code)
  }

  try {
    if (request.method === 'GET') return await handleGet(request)
    if (request.method === 'POST') return await handlePost(request)
    return json({ error: 'method_not_allowed' }, 405)
  } catch (err) {
    return json({ error: err?.message || 'internal_error' }, 500)
  }
}
