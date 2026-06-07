export const config = { runtime: 'edge' }

/*
 * User-facing subscription API (webpage only — see PRD §9.2).
 *
 * Auth: the caller passes their Supabase user access token as a Bearer
 * header. We verify it by calling GET /auth/v1/user (the same token the
 * browser already holds). This keeps the user trust boundary inside
 * Supabase Auth — no service-role power is ever exposed to the client.
 *
 * Routes (multiplexed, matching the admin edge style to stay within
 * Vercel's 12-edge-function budget — PRD §7 /subscriptions/*):
 *   POST ?action=checkout        → Stripe Checkout Session  → { url }
 *   GET  ?resource=me            → current subscription + plan + invoices
 *   POST ?action=cancel          → cancel at period end
 *   POST ?action=update_payment  → Stripe Billing Portal     → { url }
 *
 * Stripe calls use raw fetch (form-encoded) + an Idempotency-Key. No npm
 * dependency — the repo's edge functions are deliberately dependency-free.
 * The webhook (api/stripe/webhook.js) remains the single writer of
 * subscription state; this file only kicks off Stripe-hosted flows.
 */

const ALLOWED_ORIGINS = [
  'https://caaci-community-marketplace-bazaar.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
]

function env(name, fallback) {
  return process.env[name] || fallback
}

const SUPABASE_URL = env('SUPABASE_URL', env('VITE_SUPABASE_URL', ''))
const ANON_KEY     = env('SUPABASE_ANON_KEY', env('VITE_SUPABASE_ANON_KEY', ''))
const SERVICE_KEY  = env('SUPABASE_SERVICE_ROLE_KEY', '')
const STRIPE_KEY   = env('STRIPE_SECRET_KEY', '')

function cors(origin) {
  if (!ALLOWED_ORIGINS.includes(origin)) return { Vary: 'Origin' }
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  })
}

/*
 * Flatten a nested object into application/x-www-form-urlencoded with
 * Stripe's bracket notation, e.g. line_items[0][price]=price_123.
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
        if (item !== null && typeof item === 'object') {
          toForm(item, `${field}[${i}]`, out)
        } else {
          out.append(`${field}[${i}]`, String(item))
        }
      })
    } else {
      out.append(field, String(val))
    }
  }
  return out
}

async function stripe(path, params, method = 'POST', idemKey) {
  if (!STRIPE_KEY) throw new Error('stripe_not_configured')
  const headers = {
    Authorization: `Bearer ${STRIPE_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  }
  if (idemKey) headers['Idempotency-Key'] = idemKey
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers,
    body: params ? toForm(params).toString() : undefined,
  })
  const data = await r.json().catch(() => null)
  if (!r.ok) {
    const msg = data?.error?.message || `stripe_${r.status}`
    const err = new Error(msg)
    err.stripe = data?.error
    throw err
  }
  return data
}

/* Service-role PostgREST helpers (read plan, read/patch profile). */
async function rest(path, { method = 'GET', body, prefer } = {}) {
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

/* Verify the user's Supabase access token → returns the user id. */
async function getUser(bearer) {
  if (!bearer || !SUPABASE_URL || !ANON_KEY) return null
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${bearer}` },
  })
  if (!r.ok) return null
  const u = await r.json().catch(() => null)
  return u?.id ? u : null
}

/* Ensure the profile has a Stripe customer, creating one if needed. */
async function ensureCustomer(userId, email) {
  const rows = await rest(
    `profiles?id=eq.${userId}&select=stripe_customer_id`,
  )
  const existing = Array.isArray(rows) ? rows[0]?.stripe_customer_id : null
  if (existing) return existing

  const customer = await stripe('customers', {
    email: email || undefined,
    metadata: { profile_id: userId },
  }, 'POST', `cust_${userId}`)

  await rest(`profiles?id=eq.${userId}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: { stripe_customer_id: customer.id },
  })
  return customer.id
}

export default async function handler(request) {
  const origin = request.headers.get('origin') || ''
  const headers = cors(origin)

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: 'supabase_not_configured' }, 500, headers)
  }

  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  const user = await getUser(bearer)
  if (!user) return json({ error: 'unauthorized' }, 401, headers)

  const url = new URL(request.url)

  try {
    // ---------- GET ?resource=me ----------
    if (request.method === 'GET') {
      const resource = url.searchParams.get('resource')
      if (resource === 'me') {
        const subs = await rest(
          `subscriptions?user_id=eq.${user.id}` +
          `&select=*,plan:subscription_plans(*)` +
          `&order=created_at.desc&limit=1`,
        )
        const sub = Array.isArray(subs) ? subs[0] : null
        let invoices = []
        if (sub) {
          invoices = await rest(
            `invoices?user_id=eq.${user.id}` +
            `&select=id,stripe_invoice_id,amount_cents,currency,status,paid_at,hosted_invoice_url,created_at` +
            `&order=created_at.desc&limit=12`,
          )
        }
        return json({ data: { subscription: sub, invoices } }, 200, headers)
      }
      return json({ error: 'unknown_resource' }, 400, headers)
    }

    // ---------- POST ?action=... ----------
    if (request.method === 'POST') {
      const action = url.searchParams.get('action')
      const body = await request.json().catch(() => ({}))

      if (action === 'checkout') {
        const { plan_id, success_url, cancel_url } = body || {}
        if (!plan_id || !success_url || !cancel_url) {
          return json({ error: 'missing_args' }, 400, headers)
        }
        const plans = await rest(
          `subscription_plans?id=eq.${plan_id}&is_active=eq.true` +
          `&select=id,stripe_price_id`,
        )
        const plan = Array.isArray(plans) ? plans[0] : null
        if (!plan || !plan.stripe_price_id) {
          return json({ error: 'plan_unavailable' }, 400, headers)
        }
        const customerId = await ensureCustomer(user.id, user.email)
        const session = await stripe('checkout/sessions', {
          mode: 'subscription',
          customer: customerId,
          success_url,
          cancel_url,
          line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
          client_reference_id: user.id,
          subscription_data: { metadata: { user_id: user.id, plan_id: plan.id } },
          metadata: { user_id: user.id, plan_id: plan.id },
        })
        return json({ url: session.url }, 200, headers)
      }

      if (action === 'cancel') {
        // Cancel at period end (default per PRD §4.1; B7 immediate TBD).
        // We only cancel the caller's own subscription.
        const subs = await rest(
          `subscriptions?user_id=eq.${user.id}&status=in.(active,trialing,past_due)` +
          `&select=stripe_subscription_id&order=created_at.desc&limit=1`,
        )
        const sub = Array.isArray(subs) ? subs[0] : null
        if (!sub?.stripe_subscription_id) {
          return json({ error: 'no_active_subscription' }, 404, headers)
        }
        await stripe(
          `subscriptions/${sub.stripe_subscription_id}`,
          { cancel_at_period_end: true },
        )
        return json({ success: true }, 200, headers)
      }

      if (action === 'update_payment') {
        // Stripe Billing Portal — user self-serves card/cancel/upgrade.
        const rows = await rest(
          `profiles?id=eq.${user.id}&select=stripe_customer_id`,
        )
        const customerId = Array.isArray(rows) ? rows[0]?.stripe_customer_id : null
        if (!customerId) return json({ error: 'no_customer' }, 404, headers)
        const params = { customer: customerId }
        if (body?.return_url) params.return_url = body.return_url
        const cfg = env('STRIPE_PORTAL_CONFIGURATION_ID', '')
        if (cfg) params.configuration = cfg
        const portal = await stripe('billing_portal/sessions', params)
        return json({ url: portal.url }, 200, headers)
      }

      return json({ error: 'unknown_action' }, 400, headers)
    }

    return json({ error: 'method_not_allowed' }, 405, headers)
  } catch (err) {
    return json({ error: err?.message || 'internal_error' }, 500, headers)
  }
}
