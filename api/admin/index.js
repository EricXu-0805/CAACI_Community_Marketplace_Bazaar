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
 *   Backward-compat fallback: if migration 036 has not been applied
 *   yet (admin_tokens table missing → PostgREST 404), or if the
 *   incoming bearer doesn't match any per-admin token but matches
 *   the legacy ADMIN_API_KEY env var, the request is allowed but
 *   audit_log.actor_id is recorded as NULL (same as v1 behaviour).
 *   This preserves uptime during the transition window.
 *
 *   Once at least one per-admin token has been minted AND every
 *   admin's browser has the new token, you can delete the
 *   ADMIN_API_KEY env var; the fallback branch then surfaces a
 *   clear 401 to anyone still on the old shared key.
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
const STRIPE_KEY   = env('STRIPE_SECRET_KEY', '')

async function sha256Hex(input) {
  const buf = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/*
 * Compare two strings in constant time. Defends against a timing
 * side-channel where an attacker can shave off attempts by binary-
 * searching the bearer header. Both strings must be the same length;
 * we early-return false on mismatched length (the length itself is
 * not secret — bearer tokens are fixed-format).
 */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

/*
 * Validate the bearer token via PostgREST RPC.
 *
 * Returns:
 *   { ok: true,  adminId, adminName, adminEmail, source: 'token' }
 *   { ok: true,  adminId: null, source: 'legacy_shared' }
 *   { ok: false, source: 'missing' | 'invalid' | 'admin_tokens_unavailable' }
 *
 * The "legacy_shared" branch is consulted only when the per-admin
 * token lookup misses AND ADMIN_API_KEY env var is set. This is the
 * back-compat path that preserves uptime during the rollout window.
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
        // RPC missing — migration 036 not applied. Skip per-admin
        // path entirely and fall through to the legacy shared key.
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

  const legacy = env('ADMIN_API_KEY', '')
  if (legacy && timingSafeEqual(bearer, legacy)) {
    return { ok: true, adminId: null, source: 'legacy_shared' }
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

/*
 * Direct PostgREST table access with the service-role key. Used for the
 * subscription/plan/refund surfaces (migration 043) — same precedent as
 * the revoke_token PATCH below. `path` includes the table + query string.
 */
async function restTable(path, { method = 'GET', body, prefer } = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('supabase_not_configured')
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  }
  if (prefer) headers.Prefer = prefer
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!r.ok) throw new Error((data && data.message) || `postgrest_${r.status}`)
  return data
}

/*
 * Flatten a nested object into Stripe's form-encoded bracket notation.
 * Mirrors the helper in api/subscriptions/index.js — kept inline because
 * edge functions resolve independently (no shared module).
 */
function toForm(obj, prefix, out) {
  out = out || new URLSearchParams()
  for (const key of Object.keys(obj)) {
    const val = obj[key]
    if (val === undefined || val === null) continue
    const field = prefix ? `${prefix}[${key}]` : key
    if (typeof val === 'object' && !Array.isArray(val)) {
      toForm(val, field, out)
    } else if (Array.isArray(val)) {
      val.forEach((item, i) => {
        if (item !== null && typeof item === 'object') toForm(item, `${field}[${i}]`, out)
        else out.append(`${field}[${i}]`, String(item))
      })
    } else {
      out.append(field, String(val))
    }
  }
  return out
}

async function stripe(path, params, method = 'POST') {
  if (!STRIPE_KEY) throw new Error('stripe_not_configured')
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${STRIPE_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params ? toForm(params).toString() : undefined,
  })
  const data = await r.json().catch(() => null)
  if (!r.ok) throw new Error(data?.error?.message || `stripe_${r.status}`)
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
    console.warn('[admin] record_audit(admin_login) failed', err?.message)
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

  // ---------- Subscription management (migration 043) ----------
  if (resource === 'subscriptions') {
    const data = await rpc('admin_list_subscriptions', {
      limit_in: limit,
      offset_in: offset,
      status_filter: url.searchParams.get('status') || null,
      plan_filter: url.searchParams.get('plan_id') || null,
      search_in: url.searchParams.get('search') || null,
    })
    return json({ data })
  }

  if (resource === 'subscription') {
    const id = url.searchParams.get('id')
    if (!id) return json({ error: 'missing_id' }, 400)
    const data = await rpc('admin_get_subscription_detail', { id_in: id })
    return json({ data })
  }

  if (resource === 'invoices') {
    const data = await rpc('admin_list_invoices', {
      limit_in: limit,
      offset_in: offset,
      status_filter: url.searchParams.get('status') || null,
    })
    return json({ data })
  }

  if (resource === 'subscription_metrics') {
    const data = await rpc('admin_subscription_metrics', {})
    return json({ data })
  }

  if (resource === 'plans') {
    // Full catalogue incl. inactive — admin needs to see everything.
    const data = await restTable(
      'subscription_plans?select=*&order=sort_order.asc,created_at.desc',
    )
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
      }).catch(err => console.warn('[admin] audit ban_applied failed', err?.message))
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
      }).catch(err => console.warn('[admin] audit suspension_lifted failed', err?.message))
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
      }).catch(err => console.warn('[admin] audit report_status_changed failed', err?.message))
    }
    return json({ success: true })
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
    return json({ success: true })
  }

  // ---------- Subscription management actions (migration 043) ----------

  if (body.action === 'upsert_plan') {
    // Create or update a sellable plan. `id` present → update, else insert.
    const p = body.plan || {}
    if (!p.code || !p.name || !p.interval || p.amount_cents == null) {
      return json({ error: 'missing_args' }, 400)
    }
    const fields = {
      code: p.code,
      name: p.name,
      name_zh: p.name_zh ?? null,
      description: p.description ?? null,
      description_zh: p.description_zh ?? null,
      stripe_price_id: p.stripe_price_id ?? null,
      interval: p.interval,
      amount_cents: p.amount_cents,
      currency: p.currency || 'usd',
      benefits: p.benefits ?? [],
      is_active: p.is_active ?? true,
      sort_order: p.sort_order ?? 0,
    }
    let data
    if (body.id) {
      data = await restTable(`subscription_plans?id=eq.${encodeURIComponent(body.id)}`, {
        method: 'PATCH', prefer: 'return=representation', body: fields,
      })
    } else {
      data = await restTable('subscription_plans', {
        method: 'POST', prefer: 'return=representation', body: fields,
      })
    }
    const row = Array.isArray(data) ? data[0] : data
    if (auth.adminId) {
      await rpc('record_audit', {
        event_kind_in: 'plan_upserted',
        actor_id_in: auth.adminId,
        target_id_in: row?.id || null,
        details_in: { via: 'edge_admin', code: fields.code },
      }).catch(err => console.warn('[admin] audit plan_upserted failed', err?.message))
    }
    return json({ data: row })
  }

  if (body.action === 'grant_subscription') {
    // Manually grant/extend a comp subscription (source='manual'). Does not
    // touch Stripe — used for community comps / corrections.
    if (!body.user_id || !body.plan_id || !body.current_period_end) {
      return json({ error: 'missing_args' }, 400)
    }
    const data = await restTable('subscriptions', {
      method: 'POST', prefer: 'return=representation',
      body: {
        user_id: body.user_id,
        plan_id: body.plan_id,
        status: body.status || 'active',
        current_period_end: body.current_period_end,
        source: 'manual',
        notes: body.notes ?? null,
      },
    })
    const row = Array.isArray(data) ? data[0] : data
    if (auth.adminId) {
      await rpc('record_audit', {
        event_kind_in: 'subscription_granted',
        actor_id_in: auth.adminId,
        target_id_in: row?.id || null,
        details_in: { via: 'edge_admin', user_id: body.user_id, plan_id: body.plan_id },
      }).catch(err => console.warn('[admin] audit subscription_granted failed', err?.message))
    }
    return json({ data: row })
  }

  if (body.action === 'cancel_subscription') {
    // Cancel a Stripe subscription. DB state is reconciled by the webhook.
    if (!body.stripe_subscription_id) return json({ error: 'missing_args' }, 400)
    const immediate = body.immediate === true
    if (immediate) {
      await stripe(`subscriptions/${body.stripe_subscription_id}`, null, 'DELETE')
    } else {
      await stripe(`subscriptions/${body.stripe_subscription_id}`, { cancel_at_period_end: true })
    }
    if (auth.adminId) {
      await rpc('record_audit', {
        event_kind_in: 'subscription_canceled',
        actor_id_in: auth.adminId,
        target_id_in: body.subscription_id || null,
        details_in: { via: 'edge_admin', stripe_subscription_id: body.stripe_subscription_id, immediate },
      }).catch(err => console.warn('[admin] audit subscription_canceled failed', err?.message))
    }
    return json({ success: true })
  }

  if (body.action === 'change_plan') {
    // Swap a subscription to a different Stripe price. Needs the current
    // subscription item id + the target price id.
    if (!body.stripe_subscription_id || !body.item_id || !body.stripe_price_id) {
      return json({ error: 'missing_args' }, 400)
    }
    await stripe(`subscriptions/${body.stripe_subscription_id}`, {
      items: [{ id: body.item_id, price: body.stripe_price_id }],
      proration_behavior: body.proration_behavior || 'create_prorations',
    })
    if (auth.adminId) {
      await rpc('record_audit', {
        event_kind_in: 'subscription_changed',
        actor_id_in: auth.adminId,
        target_id_in: body.subscription_id || null,
        details_in: { via: 'edge_admin', to_price: body.stripe_price_id },
      }).catch(err => console.warn('[admin] audit subscription_changed failed', err?.message))
    }
    return json({ success: true })
  }

  if (body.action === 'issue_refund') {
    // Refund a charge (full or partial) and record it. The charge.refunded
    // webhook will also sync, but we write immediately for admin feedback.
    if (!body.stripe_charge_id && !body.stripe_payment_intent_id) {
      return json({ error: 'missing_args' }, 400)
    }
    const params = {}
    if (body.stripe_charge_id) params.charge = body.stripe_charge_id
    if (body.stripe_payment_intent_id) params.payment_intent = body.stripe_payment_intent_id
    if (body.amount_cents != null) params.amount = body.amount_cents
    // Stripe's `reason` only accepts a fixed enum; a free-form admin note is
    // kept in our refunds.reason column, not sent to Stripe.
    const STRIPE_REASONS = ['duplicate', 'fraudulent', 'requested_by_customer']
    if (body.reason && STRIPE_REASONS.includes(body.reason)) params.reason = body.reason
    const refund = await stripe('refunds', params)
    await restTable('refunds?on_conflict=stripe_refund_id', {
      method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
      body: {
        stripe_refund_id: refund.id,
        invoice_id: body.invoice_id || null,
        amount_cents: refund.amount ?? null,
        currency: refund.currency || null,
        reason: body.reason || refund.reason || null,
        operator_id: auth.adminId || null,
        status: refund.status || null,
      },
    }).catch(err => console.warn('[admin] refunds insert failed', err?.message))
    if (auth.adminId) {
      await rpc('record_audit', {
        event_kind_in: 'refund_issued',
        actor_id_in: auth.adminId,
        target_id_in: body.invoice_id || null,
        details_in: { via: 'edge_admin', stripe_refund_id: refund.id, amount_cents: refund.amount },
      }).catch(err => console.warn('[admin] audit refund_issued failed', err?.message))
    }
    return json({ data: { id: refund.id, status: refund.status } })
  }

  return json({ error: 'unknown_action' }, 400)
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 })

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
      } catch {}
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
