export const config = { runtime: 'edge' }

/*
 * Stripe webhook — the single writer of subscription/invoice state.
 *
 * Signature verification is done with Web Crypto (HMAC-SHA256), NOT the
 * Stripe SDK: the repo's edge functions are deliberately dependency-free
 * (no package.json in api/). Stripe's scheme is well documented and trivial
 * to verify manually:
 *   header "Stripe-Signature: t=<ts>,v1=<hex>"
 *   expected = HMAC_SHA256(webhook_secret, `${t}.${rawBody}`)
 * We compare in constant time and reject stale timestamps (replay defence).
 *
 * Idempotency (PRD §7): every event.id is recorded in stripe_events. If we
 * have seen it, we 200 immediately — Stripe retries are then no-ops.
 *
 * All DB writes go through the service-role key (RLS-bypassing) via
 * PostgREST; users never write these tables directly.
 */

function env(name, fallback) {
  return process.env[name] || fallback
}

const SUPABASE_URL    = env('SUPABASE_URL', env('VITE_SUPABASE_URL', ''))
const SERVICE_KEY     = env('SUPABASE_SERVICE_ROLE_KEY', '')
const WEBHOOK_SECRET  = env('STRIPE_WEBHOOK_SECRET', '')
const TOLERANCE_SEC   = 300 // reject signatures older than 5 minutes

function hex(buf) {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

async function verifySignature(rawBody, sigHeader) {
  if (!WEBHOOK_SECRET || !sigHeader) return false
  // Parse "t=...,v1=...,v1=..." (multiple v1 possible during secret rotation).
  let t = null
  const v1 = []
  for (const part of sigHeader.split(',')) {
    const [k, v] = part.split('=')
    if (k === 't') t = v
    else if (k === 'v1') v1.push(v)
  }
  if (!t || v1.length === 0) return false

  // Replay protection.
  const age = Math.abs(Math.floor(Date.now() / 1000) - parseInt(t, 10))
  if (!Number.isFinite(age) || age > TOLERANCE_SEC) return false

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${t}.${rawBody}`),
  )
  const expected = hex(mac)
  return v1.some(sig => timingSafeEqual(sig, expected))
}

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

const iso = (sec) => (sec ? new Date(sec * 1000).toISOString() : null)

/* Resolve plan_id from a Stripe price id (set by CAACI on each plan). */
async function planIdForPrice(priceId) {
  if (!priceId) return null
  const rows = await rest(
    `subscription_plans?stripe_price_id=eq.${encodeURIComponent(priceId)}&select=id&limit=1`,
  )
  return Array.isArray(rows) ? rows[0]?.id || null : null
}

/* Resolve our profile id from a Stripe customer id. */
async function userIdForCustomer(customerId) {
  if (!customerId) return null
  const rows = await rest(
    `profiles?stripe_customer_id=eq.${encodeURIComponent(customerId)}&select=id&limit=1`,
  )
  return Array.isArray(rows) ? rows[0]?.id || null : null
}

/* Upsert a Stripe subscription object into public.subscriptions. */
async function upsertSubscription(sub, fallbackUserId) {
  const priceId = sub.items?.data?.[0]?.price?.id || null
  const planId = await planIdForPrice(priceId)
  const userId =
    sub.metadata?.user_id ||
    fallbackUserId ||
    (await userIdForCustomer(sub.customer))
  if (!userId) return // can't attribute — skip rather than orphan a row

  // Newer Stripe API versions expose the billing period on the subscription
  // item rather than the subscription root — read root first, fall back.
  const item0 = sub.items?.data?.[0] || {}
  const periodStart = sub.current_period_start ?? item0.current_period_start
  const periodEnd = sub.current_period_end ?? item0.current_period_end

  const row = {
    user_id: userId,
    plan_id: planId,
    stripe_subscription_id: sub.id,
    status: sub.status,
    current_period_start: iso(periodStart),
    current_period_end: iso(periodEnd),
    trial_end: iso(sub.trial_end),
    cancel_at_period_end: !!sub.cancel_at_period_end,
    canceled_at: iso(sub.canceled_at),
    source: 'stripe',
  }
  await rest('subscriptions?on_conflict=stripe_subscription_id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: row,
  })
}

/* Upsert a Stripe invoice + push a notification. */
async function upsertInvoice(inv, notifyType) {
  const userId = await userIdForCustomer(inv.customer)
  let subscriptionId = null
  if (inv.subscription) {
    const rows = await rest(
      `subscriptions?stripe_subscription_id=eq.${encodeURIComponent(inv.subscription)}&select=id&limit=1`,
    )
    subscriptionId = Array.isArray(rows) ? rows[0]?.id || null : null
  }
  await rest('invoices?on_conflict=stripe_invoice_id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: {
      stripe_invoice_id: inv.id,
      subscription_id: subscriptionId,
      user_id: userId,
      amount_cents: inv.amount_paid ?? inv.amount_due ?? null,
      currency: inv.currency || null,
      status: inv.status || null,
      paid_at: inv.status_transitions?.paid_at ? iso(inv.status_transitions.paid_at) : null,
      hosted_invoice_url: inv.hosted_invoice_url || null,
    },
  })

  if (userId && notifyType) {
    const isFail = notifyType === 'failed'
    await rest('notifications', {
      method: 'POST',
      prefer: 'return=minimal',
      body: {
        user_id: userId,
        type: 'subscription',
        title: isFail ? '订阅扣费失败' : '订阅续费成功',
        body: isFail
          ? '本次会员扣费失败，请更新支付方式以免会员中断。'
          : '您的会员已成功续费。',
      },
    }).catch(() => {})
  }
}

export default async function handler(request) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    })
  }
  if (!SUPABASE_URL || !SERVICE_KEY || !WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: 'not_configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Raw body required for signature verification — read before any parse.
  const rawBody = await request.text()
  const sig = request.headers.get('stripe-signature') || ''
  const ok = await verifySignature(rawBody, sig)
  if (!ok) {
    return new Response(JSON.stringify({ error: 'bad_signature' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  let event
  try { event = JSON.parse(rawBody) } catch {
    return new Response(JSON.stringify({ error: 'bad_json' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Idempotency: skip only events we have already processed SUCCESSFULLY.
  // We record event.id AFTER handling (below), not before — otherwise a
  // handler that throws would mark the event seen, and Stripe's retry would
  // be short-circuited as a duplicate, losing the event forever. Re-running
  // a handler is safe (all writes are merge-duplicates upserts).
  try {
    const seen = await rest(
      `stripe_events?event_id=eq.${encodeURIComponent(event.id)}&select=event_id&limit=1`,
    )
    if (Array.isArray(seen) && seen.length > 0) {
      return new Response(JSON.stringify({ received: true, duplicate: true }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }
  } catch (e) {
    // Existence check failed — fall through and process. Worst case is a
    // harmless re-process; dropping the event would be worse.
    console.warn('[stripe] idempotency check failed', e?.message)
  }

  try {
    const obj = event.data?.object || {}
    switch (event.type) {
      case 'checkout.session.completed': {
        // No-op for subscription rows: we set subscription_data.metadata on
        // the Checkout Session, so the customer.subscription.created/updated
        // events carry full detail (periods, plan, user_id) and are the
        // authoritative writers. Acting here too would risk a stale 'active'
        // + null-periods row clobbering the richer one if events arrive out
        // of order. Acknowledged silently.
        break
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await upsertSubscription(obj)
        break
      }
      case 'invoice.payment_succeeded': {
        await upsertInvoice(obj, 'succeeded')
        break
      }
      case 'invoice.payment_failed': {
        await upsertInvoice(obj, 'failed')
        break
      }
      case 'charge.refunded': {
        // Sync refund(s) on the charge → refunds table, keyed by invoice.
        if (obj.invoice) {
          const rows = await rest(
            `invoices?stripe_invoice_id=eq.${encodeURIComponent(obj.invoice)}&select=id,currency&limit=1`,
          )
          const inv = Array.isArray(rows) ? rows[0] : null
          const refunds = obj.refunds?.data || []
          for (const rf of refunds) {
            await rest('refunds?on_conflict=stripe_refund_id', {
              method: 'POST',
              prefer: 'resolution=merge-duplicates,return=minimal',
              body: {
                stripe_refund_id: rf.id,
                invoice_id: inv?.id || null,
                amount_cents: rf.amount ?? null,
                currency: rf.currency || inv?.currency || null,
                reason: rf.reason || null,
                status: rf.status || null,
              },
            })
          }
        }
        break
      }
      default:
        // Unhandled event types are acknowledged so Stripe stops retrying.
        break
    }
  } catch (err) {
    // Returning 500 makes Stripe retry — acceptable because handlers are
    // idempotent (merge-duplicates) and the event row was inserted with
    // ignore-duplicates, so a retry re-processes cleanly.
    return new Response(JSON.stringify({ error: err?.message || 'handler_error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Mark processed only now that handling succeeded. ignore-duplicates makes
  // a concurrent double-delivery a harmless no-op.
  try {
    await rest('stripe_events', {
      method: 'POST',
      prefer: 'resolution=ignore-duplicates,return=minimal',
      body: { event_id: event.id, type: event.type },
    })
  } catch (e) {
    console.warn('[stripe] idempotency record failed', e?.message)
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
