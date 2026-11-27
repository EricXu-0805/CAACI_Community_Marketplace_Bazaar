import { fetchBounded } from './_http-boundary.js'
import { parseCampusIcs } from './_campus-ics.js'
import { CAMPUS_CALENDARS, normalizeCaaciEvents, normalizeCampusEvent } from './_community-events.js'

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
    if (error instanceof SyntaxError) return 'bad_json'
    if (!(error instanceof Error)) return 'unexpected_failure'
    if (error.name === 'AbortError' || error.message === 'request_timeout') return 'timeout'
    if (error.message === 'response_too_large') return 'too_large'
    if (error.message === 'upstream_redirect') return 'upstream_redirect'
    if (error.message === 'response_malformed') return 'bad_json'
    return 'unexpected_failure'
  } catch {
    return 'unexpected_failure'
  }
}

// Supabase RPC failures name the step, so they never read as a CAACI response.
function rpcFailureCode(step, error) {
  try {
    if (error instanceof SyncDeadlineError) return 'deadline'
    if (!(error instanceof Error)) return step + '_failed'
    if (error.message === 'provider_timeout') return step + '_timeout'
    const status = /^provider_status_([45]\d{2})$/.exec(error.message)
    return status ? step + '_http_' + status[1] : step + '_failed'
  } catch {
    return step + '_failed'
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
          || (applied.complete && !snapshot.complete)) result = failed('apply_result_invalid')
      else result = {
        outcome: applied.complete ? 'ok' : 'partial',
        code: applied.rejected ? 'rows_rejected' : applied.complete && rows.length === 0 ? 'empty_snapshot' : null,
        rejected: applied.rejected,
      }
    }
  } catch (error) {
    result = failed(rpcFailureCode('apply', error))
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
    const code = rpcFailureCode('finish', error)
    if (error instanceof SyncDeadlineError) result = failed('deadline', result.rejected)
    console.error('[community-events-sync] finish not recorded', { code })
  }
  return result
}

export const CAMPUS_CHECKS_PER_RUN = 2
// Strictly below the shortest gap between two cron ticks (about 50 seconds), so every tick may check.
export const CAMPUS_CHECK_CLAIM_INTERVAL_SECONDS = 30
const CAMPUS_KEY = /^([0-9]{1,6})\/([0-9]{1,12})$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
// The only columns a refresh may change (apply_campus_event_check refuses any other key).
const CAMPUS_ROW_KEYS = ['all_day', 'content_hash', 'ends_at', 'location', 'occurrence_count',
  'review_flag', 'source_updated_at', 'starts_at', 'title_en']

// Mode A: one event's own ICS. Nothing is requested for a calendar outside the allowlist.
export async function fetchCampusEvent(fetch, sourceKey, timeoutMs, now, calendars = CAMPUS_CALENDARS) {
  if (!calendars.length) return { error: 'campus_calendar_not_allowed' }
  const key = CAMPUS_KEY.exec(typeof sourceKey === 'string' ? sourceKey : '')
  if (!key) return { error: 'bad_ics' }
  const [, calendarId, eventId] = key
  if (!calendars.some(calendar => String(calendar.id) === calendarId)) return { error: 'campus_calendar_not_allowed' }
  try {
    const response = await fetchBounded(fetch,
      `https://calendars.illinois.edu/icalGmail/${calendarId}/${eventId}.ics?hourOffset=0&timeZone=America%2FChicago`, {
        method: 'GET',
        headers: { accept: 'text/calendar', 'user-agent': 'CornfieldSync/1 (+https://www.illinimarket.com)' },
        redirect: 'manual',
      }, { timeoutMs, maxBytes: MAX_BYTES })
    if (response.status === 404) return { not_found: true }
    if (!response.ok) return { error: httpFailureCode(response.status, response.headers) }
    const parsed = await parseCampusIcs(await response.text(), { now, event_id: eventId })
    if (parsed.error) return parsed
    if (parsed.rows.length !== 1) return { error: 'bad_ics' }
    const card = normalizeCampusEvent({ ...parsed.rows[0], calendar_id: calendarId }, calendars)
    if (card.error) return card
    return { row: Object.fromEntries(CAMPUS_ROW_KEYS.map(name => [name, card[name]])) }
  } catch (error) {
    return { error: failureCode(error) }
  }
}

function campusApplied(value) {
  return Boolean(value) && typeof value === 'object'
    && Object.keys(value).sort().join() === 'availability,missing_checks,rejected'
    && ['visible', 'unavailable', 'hidden'].includes(value.availability)
    && Number.isInteger(value.missing_checks) && value.missing_checks >= 0 && value.missing_checks <= 2
    && typeof value.rejected === 'boolean'
}

export async function syncCampusEvents({ deadline, call, fetch, calendars = CAMPUS_CALENDARS }) {
  if (process.env.COMMUNITY_SYNC_CAMPUS_EVENTS !== '1') return null
  let claimed
  try {
    claimed = await call('claim_community_event_sync', {
      source_in: 'campus', interval_in: CAMPUS_CHECK_CLAIM_INTERVAL_SECONDS + ' seconds',
    }, stepTimeout(deadline))
  } catch (error) {
    return failed(error instanceof SyncDeadlineError ? 'deadline' : 'claim_failed')
  }
  if (claimed !== true) return claimed === false
    ? { outcome: 'not_due', code: null, rejected: 0 } : failed('claim_failed')

  let result
  let step = 'checks'
  try {
    const rows = await call('claim_campus_event_checks', { limit_in: CAMPUS_CHECKS_PER_RUN }, stepTimeout(deadline))
    if (!Array.isArray(rows) || rows.length > CAMPUS_CHECKS_PER_RUN
        || !rows.every(row => row && UUID.test(row.id) && CAMPUS_KEY.test(row.source_key))) result = failed('checks_result_invalid')
    else {
      let code = null
      let rejected = 0
      step = 'apply'
      for (const row of rows) {
        const checked = await fetchCampusEvent(fetch, row.source_key, stepTimeout(deadline), new Date(Date.now()).toISOString(), calendars)
        const outcome = checked.row ? 'ok' : checked.not_found ? 'not_found' : 'error'
        const applied = await call('apply_campus_event_check', {
          event_id_in: row.id, outcome_in: outcome, row_in: checked.row ?? null,
        }, stepTimeout(deadline))
        if (!campusApplied(applied)) { result = failed('apply_result_invalid', rejected); break }
        if (applied.rejected) { rejected++; code ??= 'rows_rejected' }
        if (checked.error) code ??= checked.error
        // A 503 asks us to stop; the rows not requested keep their six-hour lease.
        if (checked.error === 'http_503') break
      }
      result ??= { outcome: code ? 'partial' : 'ok', code, rejected }
    }
  } catch (error) {
    result = failed(rpcFailureCode(step, error))
  }
  if (result.code === 'deadline') {
    console.error('[community-events-sync] campus finish skipped', { code: 'deadline' })
    return result
  }
  try {
    const finished = await call('finish_community_event_sync', {
      source_in: 'campus', outcome_in: result.outcome, error_code_in: result.code,
    }, stepTimeout(deadline))
    if (finished !== true) console.error('[community-events-sync] campus finish not recorded', { code: 'unexpected_failure' })
  } catch (error) {
    const code = rpcFailureCode('finish', error)
    if (error instanceof SyncDeadlineError) result = failed('deadline', result.rejected)
    console.error('[community-events-sync] campus finish not recorded', { code })
  }
  return result
}
