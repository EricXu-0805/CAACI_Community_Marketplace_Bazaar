import { deploymentBoundaryResponse, evaluateDeploymentBoundary } from './_deployment-boundary.js'
import { reportToSentry } from './_sentry-report.js'

export const config = { runtime: 'edge' }

/*
 * /api/resend-webhook — delivery outcomes for mail we already handed off.
 *
 * Every sender in this repo checks whether Resend *accepted* the message and
 * stops there. Acceptance is not delivery: a hard bounce, a spam complaint or
 * a suppressed address all happen after the 200 and are invisible from here.
 * That gap matters more than the individual message, because bounce and
 * complaint rates are what mail providers score the sending domain on — and
 * the same domain carries the .edu verification codes people need to sign in.
 * A reputation slide would first show up as "new users can't get their code",
 * with nothing in our logs to explain it.
 *
 * Resend signs with Svix: HMAC-SHA256 over `${svix-id}.${svix-timestamp}.${raw
 * body}`, keyed by the base64 body of the `whsec_` secret, compared against the
 * space-separated `v1,<signature>` entries. The raw bytes must be hashed before
 * anything parses them.
 *
 * Env: RESEND_WEBHOOK_SECRET (whsec_...), SENTRY_DSN.
 */

function env(name, fallback = '') {
  return process.env[name] || fallback
}

const SUPABASE_URL = env('SUPABASE_URL', env('VITE_SUPABASE_URL'))
const WEBHOOK_SECRET = env('RESEND_WEBHOOK_SECRET')
const MAX_BODY_BYTES = 64 * 1024
const TIMESTAMP_TOLERANCE_S = 5 * 60

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

async function readBoundedText(request) {
  const declared = request.headers.get('content-length')
  if (declared != null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    throw new Error('body_invalid')
  }
  if (!request.body) throw new Error('body_invalid')
  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let raw = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_BODY_BYTES) throw new Error('body_invalid')
      raw += decoder.decode(value, { stream: true })
    }
    return raw + decoder.decode()
  } finally {
    reader.cancel().catch(() => {})
  }
}

function base64ToBytes(value) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function bytesToBase64(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

// Both operands are hashed first so the comparison loop is fixed-width even
// when a forged signature differs in length.
async function timingSafeEqual(left, right) {
  const encoder = new TextEncoder()
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(String(left || ''))),
    crypto.subtle.digest('SHA-256', encoder.encode(String(right || ''))),
  ])
  const x = new Uint8Array(a)
  const y = new Uint8Array(b)
  let mismatch = 0
  for (let i = 0; i < x.length; i += 1) mismatch |= x[i] ^ y[i]
  return mismatch === 0 && typeof left === 'string' && left.length > 0
}

async function signatureMatches(rawBody, headers) {
  const id = headers.get('svix-id') || ''
  const timestamp = headers.get('svix-timestamp') || ''
  const signatures = headers.get('svix-signature') || ''
  if (!id || !/^\d{1,15}$/.test(timestamp) || !signatures) return false

  // A replayed delivery is a valid signature over stale content, so the age of
  // the timestamp is part of the check, not a nicety.
  const skew = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp))
  if (!Number.isFinite(skew) || skew > TIMESTAMP_TOLERANCE_S) return false

  const secret = WEBHOOK_SECRET.startsWith('whsec_') ? WEBHOOK_SECRET.slice('whsec_'.length) : ''
  if (!secret) return false
  let key
  try {
    key = await crypto.subtle.importKey(
      'raw',
      base64ToBytes(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
  } catch {
    return false
  }
  const expected = bytesToBase64(new Uint8Array(await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`),
  )))

  // Svix sends every currently-valid key's signature, so a secret rotation is
  // two entries for a while. Only the `v1,` scheme exists today.
  for (const entry of signatures.split(' ')) {
    const [version, candidate] = entry.split(',')
    if (version !== 'v1' || !candidate) continue
    if (await timingSafeEqual(candidate, expected)) return true
  }
  return false
}

function recipientDomain(to) {
  const list = Array.isArray(to) ? to : [to]
  const domains = new Set()
  for (const address of list) {
    const at = String(address || '').lastIndexOf('@')
    if (at > 0) domains.add(String(address).slice(at + 1).toLowerCase())
  }
  // The provider is the operational dimension — a bounce storm is almost always
  // one provider. The local part never leaves this function.
  return domains.size === 1 ? [...domains][0] : ''
}

/*
 * Only outcomes that mean a person did not get their mail, or that cost the
 * sending domain reputation. Delivered/opened/clicked and the domain, contact
 * and suppression-list events are acknowledged and dropped: reporting them
 * would bury the four that matter.
 *
 * Messages are constant so Sentry groups occurrences into one issue — the
 * count over time is the actual signal here, not any single bounce.
 */
function classify(event) {
  const type = String(event?.type || '')
  const bounceType = String(event?.data?.bounce?.type || '')
  switch (type) {
    case 'email.bounced':
      return bounceType === 'Permanent'
        ? { message: 'resend: email hard bounced', level: 'error' }
        : { message: 'resend: email soft bounced', level: 'warning' }
    case 'email.complained':
      return { message: 'resend: recipient marked email as spam', level: 'error' }
    case 'email.failed':
      return { message: 'resend: send failed', level: 'error' }
    case 'email.suppressed':
      return { message: 'resend: send suppressed before delivery', level: 'warning' }
    case 'email.delivery_delayed':
      return { message: 'resend: delivery delayed', level: 'warning' }
    default:
      return null
  }
}

export default async function handler(req) {
  const deploymentError = deploymentBoundaryResponse(evaluateDeploymentBoundary({ supabaseUrl: SUPABASE_URL }))
  if (deploymentError) return deploymentError
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!WEBHOOK_SECRET) return json({ error: 'not_configured' }, 503)

  let raw
  try {
    raw = await readBoundedText(req)
  } catch {
    return json({ error: 'invalid_request' }, 400)
  }

  if (!(await signatureMatches(raw, req.headers))) {
    return json({ error: 'unauthorized' }, 401)
  }

  let event
  try { event = JSON.parse(raw) } catch { return json({ error: 'invalid_request' }, 400) }

  const outcome = classify(event)
  if (outcome) {
    await reportToSentry(
      'api/resend-webhook',
      outcome.message,
      {
        event_type: String(event?.type || ''),
        email_id: String(event?.data?.email_id || ''),
        bounce_type: String(event?.data?.bounce?.type || ''),
        bounce_sub_type: String(event?.data?.bounce?.subType || ''),
        recipient_domain: recipientDomain(event?.data?.to),
      },
      outcome.level,
    )
  }

  // 200 for anything that verified, including event types added after this
  // deploy: a 4xx would make Resend retry a payload we will never accept.
  return json({ received: true })
}
