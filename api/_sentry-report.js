/*
 * Reporting for server-side events no user is present to see.
 *
 * A cron sweep has no user watching and no scheduler that retries: Vercel
 * fires the next tick on schedule regardless of what the last one returned.
 * The 503 these handlers carefully return therefore lands in Vercel logs and
 * nowhere else, so a sweep that has been failing every hour for a week looks
 * exactly like one that has been succeeding. The same is true of an email that
 * Resend accepted and then could not deliver.
 *
 * Sentry groups by message, so an hourly repeat becomes one issue with a
 * rising count rather than 24 alerts a day. The count is the signal that
 * separates a transient upstream blip from a stalled sweep.
 *
 * Callers must only report outcomes an unauthenticated request cannot reach —
 * otherwise the endpoint's public URL becomes an alert-flooding primitive.
 *
 * api/admin/index.js predates this module and carries an equivalent reporter
 * bound to its own hardened fetch stack.
 */

const SENTRY_TIMEOUT_MS = 2_000

// Read at call time, not module load: this module is imported once per process
// while the handlers around it are re-imported per test with fresh env.
function dsn() {
  return String(process.env.SENTRY_DSN || process.env.VITE_SENTRY_DSN || '').trim()
}

/**
 * Best-effort alert. `message` carries the grouping, so it must stay constant
 * across occurrences — only `extra` may vary between them.
 *
 * `extra` must carry only counts and stable codes — these handlers deliberately
 * keep upstream bodies, row payloads, secrets and addresses out of their logs,
 * and an alert is just another log sink.
 *
 * Never throws and never rejects: a monitoring failure must not change the
 * outcome of the run that is already failing.
 */
export async function reportToSentry(logger, message, extra = {}, level = 'error') {
  const parsed = /^https:\/\/([^@]+)@([^/]+)\/(.+)$/.exec(dsn())
  if (!parsed) return
  const [, key, host, projectId] = parsed
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SENTRY_TIMEOUT_MS)
  try {
    const response = await fetch(
      `https://${host}/api/${projectId}/store/?sentry_key=${key}&sentry_version=7`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        redirect: 'manual',
        signal: controller.signal,
        body: JSON.stringify({
          message,
          level,
          platform: 'javascript',
          logger,
          environment: process.env.VERCEL_ENV || 'unknown',
          release: String(process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || undefined,
          extra,
        }),
      },
    )
    await response?.body?.cancel().catch(() => {})
  } catch {
    /* a monitoring failure must never affect the run */
  } finally {
    clearTimeout(timer)
  }
}
