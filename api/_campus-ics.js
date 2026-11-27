import { campusWallClockToInstant } from './_campus-time.js'

const FIELDS = new Set(['UID', 'SUMMARY', 'DTSTART', 'DTEND', 'LOCATION', 'LAST-MODIFIED', 'TZID'])
const unescapeText = value => value.replace(/\\([\\;,nN])/g, (_, char) => /[nN]/.test(char) ? '\n' : char)

function parseDate(property) {
  const allDay = property.params.VALUE === 'DATE'
  if (property.params.VALUE && !['DATE', 'DATE-TIME'].includes(property.params.VALUE)) return null
  const match = (allDay ? /^(\d{4})(\d{2})(\d{2})$/ : /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/).exec(property.value)
  if (!match) return null
  const [, year, month, day, hour = '00', minute = '00', second = '00', utc] = match
  const roundTrip = new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute, +second))
  if (roundTrip.getUTCFullYear() !== +year || roundTrip.getUTCMonth() !== +month - 1
    || roundTrip.getUTCDate() !== +day || +hour > 23 || +minute > 59 || +second > 59) return null
  const instant = utc ? roundTrip
    : new Date(campusWallClockToInstant(`${year}-${month}-${day}`, `${hour}:${minute}`).getTime() + +second * 1000)
  return { instant, allDay, date: `${year}-${month}-${day}` }
}

function parseOccurrence(fields) {
  if (Object.values(fields).some(field => field.params.TZID && field.params.TZID !== 'America/Chicago')
    || (fields.TZID && fields.TZID.value !== 'America/Chicago')) return { error: 'campus_unexpected_tz' }
  const uid = /^(\d{1,12})(?:-[0-9]+)?@illinois\.edu$/.exec(fields.UID?.value ?? '')
  const title = fields.SUMMARY?.value.trim()
  const start = fields.DTSTART && parseDate(fields.DTSTART)
  const end = fields.DTEND && parseDate(fields.DTEND)
  const modified = fields['LAST-MODIFIED'] && parseDate(fields['LAST-MODIFIED'])
  if (!uid || !title || !start || (fields.DTEND && !end)
    || (fields['LAST-MODIFIED'] && !modified)
    || (end && (start.allDay !== end.allDay || end.instant < start.instant))) return { error: 'bad_ics' }
  let endsAt = end?.instant ?? null
  if (start.allDay && (!end || end.instant.getTime() === start.instant.getTime())) {
    const next = new Date(`${start.date}T00:00:00Z`)
    next.setUTCDate(next.getUTCDate() + 1)
    endsAt = campusWallClockToInstant(next.toISOString().slice(0, 10), '00:00')
  }
  return {
    event_id: uid[1], title_en: Array.from(title).slice(0, 160).join(''),
    starts_at: start.instant.toISOString(), ends_at: endsAt?.toISOString() ?? null,
    all_day: start.allDay, time_zone: 'America/Chicago',
    location: fields.LOCATION ? Array.from(fields.LOCATION.value).slice(0, 160).join('') : null,
    source_updated_at: modified?.instant.toISOString() ?? null,
  }
}

// Pure projection; the caller supplies a clock and, for mode A, the linked ID.
// If a series has ended entirely, retain its first start so it remains an ended event.
export async function parseCampusIcs(text, { now, event_id } = {}) {
  if (typeof text !== 'string' || !Number.isFinite(Date.parse(now))) return { error: 'bad_ics' }
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
  const stack = []
  const occurrences = []
  let fields = null
  let calendars = 0
  for (const line of lines) {
    if (!line) continue
    const match = /^([^:]+):(.*)$/.exec(line)
    if (!match) return { error: 'bad_ics' }
    const [, header, value] = match
    const [name, ...parameters] = header.split(';')
    if (name === 'BEGIN') {
      if (!stack.length && (value !== 'VCALENDAR' || calendars++)) return { error: 'bad_ics' }
      if (value === 'VEVENT') {
        if (stack.length !== 1 || stack[0] !== 'VCALENDAR') return { error: 'bad_ics' }
        fields = {}
      }
      stack.push(value)
    } else if (name === 'END') {
      if (!stack.length || stack.pop() !== value) return { error: 'bad_ics' }
      if (value === 'VEVENT') {
        const occurrence = parseOccurrence(fields)
        if (occurrence.error) return occurrence
        occurrences.push(occurrence)
        if (occurrences.length > 400) return { error: 'campus_too_many_occurrences' }
        fields = null
      }
    } else {
      if (!stack.length) return { error: 'bad_ics' }
      if (stack.at(-1) === 'VEVENT' && ['RRULE', 'RDATE', 'EXDATE', 'EXRULE', 'RECURRENCE-ID', 'DURATION'].includes(name.toUpperCase())) {
        return { error: 'bad_ics' }
      }
      if (stack.at(-1) !== 'VEVENT' || !FIELDS.has(name)) continue
      if (fields[name]) return { error: 'bad_ics' }
      const params = {}
      for (const parameter of parameters) {
        const pair = /^([A-Z-]+)=(?:"([^"]*)"|([^"]+))$/.exec(parameter)
        if (!pair || Object.hasOwn(params, pair[1])) return { error: 'bad_ics' }
        params[pair[1]] = pair[2] ?? pair[3]
      }
      fields[name] = { value: unescapeText(value), params }
    }
  }
  if (stack.length || calendars !== 1 || !occurrences.length) return { error: 'bad_ics' }
  if (event_id != null && occurrences.some(row => row.event_id !== String(event_id))) return { error: 'campus_uid_mismatch' }
  const groups = new Map()
  for (const occurrence of occurrences) {
    if (!groups.has(occurrence.event_id)) groups.set(occurrence.event_id, [])
    groups.get(occurrence.event_id).push(occurrence)
  }
  const rows = []
  for (const group of groups.values()) {
    if (group.some(row => row.all_day !== group[0].all_day)) return { error: 'bad_ics' }
    group.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
    const first = group.find(row => Date.parse(row.ends_at ?? row.starts_at) >= Date.parse(now)) ?? group[0]
    const end = group.at(-1)
    const updated = group.map(row => row.source_updated_at).filter(Boolean).sort().at(-1) ?? null
    const row = {
      ...first, ends_at: end.ends_at ?? (group.length > 1 ? end.starts_at : null), occurrence_count: group.length,
      all_day: group.every(item => item.all_day), source_updated_at: updated,
    }
    const content = JSON.stringify([row.title_en, row.starts_at, row.ends_at, row.location, row.occurrence_count])
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
    rows.push({ ...row, content_hash: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('') })
  }
  return { rows }
}
