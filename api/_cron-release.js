import { fetchBounded } from './_http-boundary.js'
import { monitoredCron } from './_cron-monitor.js'

const DEPLOYMENT_ID_RE = /^dpl_[a-zA-Z0-9]{1,128}$/
const COMMIT_RE = /^[0-9a-f]{40}$/
const CRON_JOBS = new Set(['background-jobs', 'notification-digest', 'data-retention', 'banner-upload-gc', 'delete-account'])
const REJECTION_CODES = new Set(['cron_release_identity_missing', 'cron_release_unverified', 'cron_deployment_not_current'])
// Keep the release authority in reviewed source. A production candidate may
// have its own valid HTTPS app origin; letting it choose the probe destination
// would let that candidate authorize itself before the formal domain moves.
const PRODUCTION_CRON_ORIGIN = 'https://www.illinimarket.com'
const PRODUCTION_APP_ORIGINS = new Set([PRODUCTION_CRON_ORIGIN, 'https://illinimarket.com'])
export const CRON_RELEASE_NONCE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

// A commit can be rebuilt with different configuration. Only the unique
// deployment ID identifies the candidate that actually owns the public alias.
export function cronDeploymentIdentity(boundary, env = process.env) {
  const deploymentId = String(env.VERCEL_DEPLOYMENT_ID || '')
  const commit = String(env.VERCEL_GIT_COMMIT_SHA || '')
  if (!boundary?.ok || boundary.environment !== 'production'
      || !PRODUCTION_APP_ORIGINS.has(boundary.appOrigin)
      || env.VERCEL !== '1' || env.VERCEL_ENV !== 'production'
      || !DEPLOYMENT_ID_RE.test(deploymentId) || !COMMIT_RE.test(commit)) return null
  return {
    schema: 1,
    environment: 'production',
    deploymentId,
    commit,
    projectRef: boundary.projectRef,
    appOrigin: boundary.appOrigin,
  }
}

function unavailable(code, job) {
  // Reached only after production GET authentication. Never include the probe's
  // unverified identity, body, URL, nonce, or request credentials in diagnostics.
  if (process.env.VERCEL_ENV === 'production' && CRON_JOBS.has(job) && REJECTION_CODES.has(code)) {
    try {
      const deploymentId = String(process.env.VERCEL_DEPLOYMENT_ID || '')
      const commit = String(process.env.VERCEL_GIT_COMMIT_SHA || '')
      console.info(JSON.stringify({ event: 'cron_release_rejected', job, code,
        deployment_id: DEPLOYMENT_ID_RE.test(deploymentId) ? deploymentId : null,
        commit_sha: COMMIT_RE.test(commit) ? commit : null }))
    } catch { /* Diagnostics must not change the rejection or permit work. */ }
  }
  return new Response(JSON.stringify({ error: code }), {
    status: 503,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'Retry-After': '60',
    },
  })
}

async function authorized(request) {
  const expected = process.env.CRON_SECRET
  const actual = /^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization') || '')?.[1]
  if (!expected || !actual) return false
  const encoder = new TextEncoder()
  const [left, right] = await Promise.all([expected, actual].map(async value =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))))
  let difference = 0
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index]
  return difference === 0
}

/**
 * Production cron can reach a staged deployment before its domain promotion.
 * Resolve the reviewed canonical origin afresh, before any business operation
 * or Sentry check-in. Never forward the scheduler secret or trust request Host.
 * A nonce makes a stale intermediary response fail closed even if it ignores
 * no-store. Do not cache a successful check across runs (promotion/rollback).
 */
export async function releasedCron(request, job, run, boundary) {
  // POST /auth/delete-account is a user operation, not a scheduled recovery.
  // Detached tests/local and reviewed Preview keep their existing behavior.
  if (request.method !== 'GET' || boundary?.environment !== 'production') {
    return monitoredCron(request, job, run)
  }
  if (!await authorized(request)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, max-age=0' },
    })
  }

  const identity = cronDeploymentIdentity(boundary)
  if (!identity) return unavailable('cron_release_identity_missing', job)
  const nonce = crypto.randomUUID()
  const url = new URL('/api/deployment-identity', PRODUCTION_CRON_ORIGIN)
  url.searchParams.set('nonce', nonce)
  try {
    const response = await fetchBounded(fetch, url, {
      method: 'GET',
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache, no-store' },
    }, { timeoutMs: 3_000, maxBytes: 4_096 })
    if (response.status !== 200 || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) {
      return unavailable('cron_release_unverified', job)
    }
    const current = await response.json()
    if (current?.nonce !== nonce) return unavailable('cron_release_unverified', job)
    if (!Object.entries(identity).every(([key, value]) => current[key] === value)) {
      return unavailable('cron_deployment_not_current', job)
    }
  } catch {
    return unavailable('cron_release_unverified', job)
  }
  return monitoredCron(request, job, run)
}
