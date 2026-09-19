// Opt in only after the matching Sentry monitor and its notification recipient
// have been configured. Missing check-ins are detected outside this scheduler.
const JOBS = new Set(['background-jobs', 'notification-digest', 'data-retention', 'banner-upload-gc', 'delete-account'])

async function authorized(request, job) {
  if (process.env.VERCEL_ENV !== 'production' || request.method !== 'GET' || !JOBS.has(job)) return false
  const enabled = String(process.env.SENTRY_CRON_MONITORS || '').split(',').map(value => value.trim())
  if (!enabled.includes(job)) return false
  const expected = process.env.CRON_SECRET
  const actual = /^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization') || '')?.[1]
  if (!expected || !actual) return false
  const encoder = new TextEncoder()
  const [a, b] = await Promise.all([expected, actual].map(value => crypto.subtle.digest('SHA-256', encoder.encode(value))))
  const left = new Uint8Array(a), right = new Uint8Array(b)
  let difference = 0
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index]
  return difference === 0
}

function destination() {
  try {
    const raw = String(process.env.SENTRY_DSN || process.env.VITE_SENTRY_DSN || '').trim()
    if (!/^https:\/\/[a-z0-9]+@[a-z0-9.-]+\.ingest(?:\.[a-z]+)?\.sentry\.io\/\d+$/i.test(raw)) return null
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.password || url.port || url.search || url.hash
      || !/^[a-z0-9]+$/i.test(url.username) || !/^\/\d+$/.test(url.pathname)
      || !/^[a-z0-9.-]+\.ingest(?:\.[a-z]+)?\.sentry\.io$/i.test(url.hostname)) return null
    return `https://${url.hostname}/api${url.pathname}/envelope/?sentry_key=${url.username}&sentry_version=7`
  } catch { return null }
}

async function checkIn(endpoint, job, id, status, duration) {
  const configured = process.env[`SENTRY_CRON_SLUG_${job.toUpperCase().replaceAll('-', '_')}`]
  const slug = /^[a-z0-9][a-z0-9_-]{0,99}$/.test(configured || '') ? configured : `illini-${job}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2000)
  try {
    const response = await fetch(endpoint, {
      method: 'POST', redirect: 'manual', signal: controller.signal,
      headers: { 'Content-Type': 'application/x-sentry-envelope' },
      body: [JSON.stringify({ sent_at: new Date().toISOString() }),
        JSON.stringify({ type: 'check_in' }), JSON.stringify({
          check_in_id: id, monitor_slug: slug, status,
          environment: 'production', duration,
          release: String(process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || undefined,
        })].join('\n'),
    })
    await response.body?.cancel().catch(() => {})
  } catch { /* A monitoring outage must not change the business operation. */ }
  finally { clearTimeout(timer) }
}

export async function monitoredCron(request, job, run) {
  let enabled = false
  try { enabled = await authorized(request, job) } catch {}
  const endpoint = enabled ? destination() : null
  if (!endpoint) return run(request)
  const id = crypto.randomUUID().replaceAll('-', '')
  await checkIn(endpoint, job, id, 'in_progress')
  const started = Date.now()
  try {
    const response = await run(request)
    await checkIn(endpoint, job, id, response.ok ? 'ok' : 'error', (Date.now() - started) / 1000)
    return response
  } catch (error) {
    await checkIn(endpoint, job, id, 'error', (Date.now() - started) / 1000)
    throw error
  }
}
