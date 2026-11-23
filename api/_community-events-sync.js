import { fetchBounded } from './_http-boundary.js'
import { normalizeCaaciEvents } from './_community-events.js'

export const CAACI_SYNC_INTERVAL_MINUTES = 12
const SOURCE_URL = 'https://caaciorg.com/api/public-events?window=recent'
const MAX_BYTES = 256 * 1024

class SyncDeadlineError extends Error {
  constructor() { super('deadline'); this.name = 'SyncDeadlineError' }
}

function stepTimeout(deadline) {
  const timeout = Math.min(5000, deadline - Date.now() - 5000)
  if (timeout < 1000) throw new SyncDeadlineError()
  return timeout
}

function httpFailureCode(status, headers) {
  if (status === 403) {
    const html = String(headers?.get('content-type') || '').toLowerCase().includes('text/html')
    return html || headers?.has('cf-mitigated') ? 'http_403_edge' : 'http_403'
  }
  if (status === 404) return 'http_404'
  if (status === 429) return 'http_429'
  if (status === 503) return 'http_503'
  if (status >= 400 && status < 500) return 'http_4xx'
  if (status >= 500 && status < 600) return 'http_5xx'
  return 'unexpected_failure'
}

function failureCode(error) {
  // This is an untrusted I/O boundary. Arbitrary error messages never become codes.
  try {
    if (error instanceof SyncDeadlineError) return 'deadline'
    if (error instanceof SyntaxError) return 'bad_json'
    if (!(error instanceof Error)) return 'unexpected_failure'
    if (error.name === 'AbortError' || error.message === 'request_timeout' || error.message === 'provider_timeout') return 'timeout'
    if (error.message === 'response_too_large') return 'too_large'
    if (error.message === 'upstream_redirect' || error.message === 'provider_redirect') return 'upstream_redirect'
    if (error.message === 'provider_malformed' || error.message === 'response_malformed') return 'bad_json'
    const status = /^provider_status_([45]\d{2})$/.exec(error.message)
    return status ? httpFailureCode(Number(status[1])) : 'unexpected_failure'
  } catch {
    return 'unexpected_failure'
  }
}

// Shared by the worker and the explicit dry-run CLI; neither supplies an arbitrary URL.
export async function fetchCaaciSnapshot(fetch, timeoutMs) {
  try {
    const response = await fetchBounded(fetch, SOURCE_URL, {
      method: 'GET',
      headers: { accept: 'application/json', 'user-agent': 'CornfieldSync/1 (+https://www.illinimarket.com)' },
      redirect: 'manual',
    }, { timeoutMs, maxBytes: MAX_BYTES })
    if (!response.ok) return { error: httpFailureCode(response.status, response.headers) }
    return normalizeCaaciEvents(await response.json())
  } catch (error) {
    return { error: failureCode(error) }
  }
}

const failed = (code, rejected = 0) => ({ outcome: 'failed', code, rejected })

export async function syncCaaciEvents({ deadline, call, fetch }) {
  if (process.env.COMMUNITY_SYNC_CAACI_EVENTS !== '1') return null
  let claimed
  try {
    claimed = await call('claim_community_event_sync', {
      source_in: 'caaci', interval_in: CAACI_SYNC_INTERVAL_MINUTES + ' minutes',
    }, stepTimeout(deadline))
  } catch (error) {
    return failed(error instanceof SyncDeadlineError ? 'deadline' : 'claim_failed')
  }
  if (claimed !== true) return claimed === false
    ? { outcome: 'not_due', code: null, rejected: 0 } : failed('claim_failed')

  let result
  try {
    const snapshot = await fetchCaaciSnapshot(fetch, stepTimeout(deadline))
    if (snapshot.error) result = failed(snapshot.error)
    else {
      const rows = snapshot.rows.map(row => ({
        source_type: 'caaci', source_key: row.source_key.toLowerCase(), region: row.region,
        organizer_name: 'CAACI', title: row.title, title_en: row.title_en,
        summary: row.summary, summary_en: row.summary_en,
        starts_at: new Date(row.starts_at).toISOString(),
        ends_at: row.ends_at === null ? null : new Date(row.ends_at).toISOString(),
        all_day: row.all_day, occurrence_count: row.occurrence_count, time_zone: row.time_zone,
        location: row.location, page_url: row.page_url, register_url: row.register_url,
        registration_mode: row.registration_mode, takes_registrations: row.takes_registrations,
        registration_open: row.registration_open, content_hash: row.content_hash,
        source_updated_at: row.source_updated_at,
      }))
      const applied = await call('apply_caaci_event_snapshot', {
        complete_in: snapshot.complete, rows_in: rows,
      }, stepTimeout(deadline))
      if (!applied || typeof applied.complete !== 'boolean'
          || !Number.isSafeInteger(applied.rejected) || applied.rejected < 0 || applied.rejected > rows.length
          || (applied.complete && !snapshot.complete)) result = failed('schema_mismatch')
      else result = {
        outcome: applied.complete ? 'ok' : 'partial',
        code: applied.rejected ? 'rows_rejected' : null, rejected: applied.rejected,
      }
    }
  } catch (error) {
    result = failed(failureCode(error))
  }
  if (result.code === 'deadline') {
    console.error('[community-events-sync] finish skipped', { code: 'deadline' })
    return result
  }
  try {
    const finished = await call('finish_community_event_sync', {
      source_in: 'caaci', outcome_in: result.outcome, error_code_in: result.code,
    }, stepTimeout(deadline))
    if (finished !== true) console.error('[community-events-sync] finish not recorded', { code: 'unexpected_failure' })
  } catch (error) {
    const code = failureCode(error)
    if (error instanceof SyncDeadlineError) result = failed('deadline', result.rejected)
    console.error('[community-events-sync] finish not recorded', { code })
  }
  return result
}
