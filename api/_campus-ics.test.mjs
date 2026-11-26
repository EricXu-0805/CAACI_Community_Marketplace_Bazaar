// Synthetic, offline tests at the ICS projection boundary.
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const originalFetch = globalThis.fetch
let fetchCalls = 0
globalThis.fetch = () => { fetchCalls += 1; throw new Error('Network forbidden in campus ICS tests') }
const { parseCampusIcs } = await import('./_campus-ics.js')
const { normalizeCampusEvent } = await import('./_community-events.js')
after(() => {
  globalThis.fetch = originalFetch
  assert.equal(fetchCalls, 0, 'all imports and parsing made zero fetch calls')
})
const text = name => readFileSync(new URL(`./__fixtures__/community-events/${name}`, import.meta.url), 'utf8')
const clock = { now: '2026-11-13T18:00:00Z' }
const sample = text('campus-sample.ics')
const chicago = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})
const local = iso => Object.fromEntries(chicago.formatToParts(new Date(iso)).map(part => [part.type, part.value]))

test('sample projects public fields and a SHA-256 over exactly title, times, location and count', async () => {
  const { rows } = await parseCampusIcs(sample, { ...clock, event_id: '90000001' })
  const contentHash = createHash('sha256').update(JSON.stringify([
    'Synthetic campus gathering', '2026-11-20T17:30:00.000Z',
    '2026-11-20T19:30:00.000Z', 'Synthetic public hall', 1,
  ])).digest('hex')
  assert.deepEqual(rows, [{
    event_id: '90000001', title_en: 'Synthetic campus gathering',
    starts_at: '2026-11-20T17:30:00.000Z', ends_at: '2026-11-20T19:30:00.000Z',
    all_day: false, occurrence_count: 1, time_zone: 'America/Chicago',
    location: 'Synthetic public hall', source_updated_at: '2026-11-12T18:00:00.000Z',
    content_hash: contentHash,
  }])
})

for (const [fixture, start, end, hours] of [
  ['campus-allday-spring-no-end.ics', '2027-03-14T06:00:00.000Z', '2027-03-15T05:00:00.000Z', 23],
  ['campus-allday-equal-end.ics', '2027-03-14T06:00:00.000Z', '2027-03-15T05:00:00.000Z', 23],
  ['campus-allday-multiday-dst.ics', '2027-03-13T06:00:00.000Z', '2027-03-16T05:00:00.000Z', 71],
]) {
  test(`all-day ${fixture} ends at Chicago midnight across DST`, async () => {
    const { rows: [row] } = await parseCampusIcs(text(fixture), clock)
    assert.equal(row.all_day, true)
    assert.equal(row.starts_at, start)
    assert.equal(row.ends_at, end)
    assert.equal((Date.parse(end) - Date.parse(start)) / 3_600_000, hours)
    assert.equal(`${local(row.ends_at).hour}:${local(row.ends_at).minute}`, '00:00')
  })
}

test('existing all-day fixture retains separate IDs and next local midnight without DTEND', async () => {
  const { rows } = await parseCampusIcs(text('campus-allday.ics'), clock)
  assert.deepEqual(rows.map(({ event_id, starts_at, ends_at, all_day }) => ({ event_id, starts_at, ends_at, all_day })), [
    { event_id: '90000003', starts_at: '2026-11-20T06:00:00.000Z', ends_at: '2026-11-22T06:00:00.000Z', all_day: true },
    { event_id: '90000004', starts_at: '2026-11-23T06:00:00.000Z', ends_at: '2026-11-24T06:00:00.000Z', all_day: true },
  ])
})

test('series merges by UID base, counts ended occurrences, and starts at first unended occurrence', async () => {
  // Reverse source order to distinguish chronological merging from input order.
  const source = text('campus-series-3.ics')
  const events = source.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g)
  const result = await parseCampusIcs(`BEGIN:VCALENDAR\n${events.reverse().join('\n')}\nEND:VCALENDAR`, { now: '2026-11-21T18:00:00Z' })
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].event_id, '90000002')
  assert.equal(result.rows[0].occurrence_count, 3)
  assert.equal(result.rows[0].starts_at, '2026-11-21T17:30:00.000Z')
  assert.equal(result.rows[0].ends_at, '2026-11-22T19:30:00.000Z')
  const ended = await parseCampusIcs(source, { now: '2026-12-01T00:00:00Z' })
  assert.equal(ended.rows[0].starts_at, '2026-11-20T17:30:00.000Z')
})

test('series uses the last chronological occurrence end even when an earlier occurrence overlaps it', async () => {
  const source = text('campus-series-3.ics').replace('DTEND;VALUE=DATE-TIME:20261120T133000', 'DTEND;VALUE=DATE-TIME:20261125T133000')
  const { rows: [row] } = await parseCampusIcs(source, clock)
  assert.equal(row.ends_at, '2026-11-22T19:30:00.000Z')
})

test('unfolds LF and CRLF space/tab continuations and reverses ICS text escapes once', async () => {
  const fixture = text('campus-escaped.ics').replace('public\\\\space', 'public\\\\space\\nSecond line')
  for (const source of [fixture, fixture.replace(/\n/g, '\r\n').replace('\r\n  title', '\r\n\t title')]) {
    const { rows: [row] } = await parseCampusIcs(source, clock)
    assert.equal(row.title_en, 'Synthetic folded title, with punctuation; and \\ slash')
    assert.equal(row.location, 'Synthetic hall, room A; public\\space\nSecond line')
  }
})

test('privacy fields and source URL never enter a projection or affect its content hash', async () => {
  const { rows: [original] } = await parseCampusIcs(sample, clock)
  const changed = sample.replace('Synthetic description.', 'Synthetic description.\\nPrivate note')
    .replace('organizer@example.test', 'other@example.test').replace('key=synthetic', 'key=private')
  assert.deepEqual(await parseCampusIcs(changed, clock), { rows: [original] })
  for (const key of ['organizer', 'contact', 'description', 'url', 'ORGANIZER', 'CONTACT', 'DESCRIPTION', 'URL']) {
    assert.equal(Object.hasOwn(original, key), false, key)
  }
})

test('timed DST fixtures use the copied campus clock and preserve UTC seconds', async () => {
  for (const [fixture, start, end] of [
    ['campus-dst-fallback-2026-11-01.ics', '2026-11-01T07:30:00.000Z', '2026-11-01T08:30:00.000Z'],
    ['campus-dst-spring-2027-03-14.ics', '2027-03-14T07:30:00.000Z', '2027-03-14T09:30:00.000Z'],
  ]) {
    const { rows: [row] } = await parseCampusIcs(text(fixture), clock)
    assert.equal(row.starts_at, start)
    assert.equal(row.ends_at, end)
  }
  const utc = sample.replace('20261120T113000', '20261120T173045Z').replace('20261120T133000', '20261120T193059Z')
  const { rows: [row] } = await parseCampusIcs(utc, clock)
  assert.equal(row.starts_at, '2026-11-20T17:30:45.000Z')
  assert.equal(row.ends_at, '2026-11-20T19:30:59.000Z')
})

test('cancelled and postponed titles request review without inferring cancellation', async () => {
  for (const title of ['Cancelled synthetic gathering', 'Canceled synthetic gathering', 'POSTPONED synthetic gathering', 'Synthetic gathering']) {
    const { rows: [row] } = await parseCampusIcs(text('campus-cancel-title.ics').replace('Cancelled synthetic gathering', title), clock)
    const card = normalizeCampusEvent({ ...row, calendar_id: '3715' }, [{ id: '3715', name_en: 'Synthetic calendar' }])
    assert.equal(card.review_flag, title === 'Synthetic gathering' ? null : 'title_says_cancelled')
    assert.equal(card.availability, 'visible')
    assert.equal(card.cancelled_at, null)
  }
})

test('malformed structures, dates, required fields and earlier DTEND report bad_ics', async () => {
  const malformed = [
    null, '', text('campus-404.html'), text('campus-malformed.ics'), text('campus-allday-earlier-end.ics'),
    sample.replace('20261120T113000', '20260230T113000'),
    sample.replace('20261120T113000', '20261120T243000'),
    sample.replace('20261120T133000', '20261119T133000'),
    sample.replace('DTSTART:', 'DTSTART;VALUE=OTHER:'),
    sample.replace('20261112T180000Z', 'invalid'),
    sample.replace('UID:90000001@illinois.edu\n', ''),
    sample.replace('SUMMARY:Synthetic campus gathering', 'SUMMARY: '),
    sample.replace('END:VCALENDAR', 'END:OTHER'),
    sample.replace('END:VEVENT', ''),
    sample.replace('END:VEVENT', 'SUMMARY:Duplicate\nEND:VEVENT'),
    sample.replace('DTSTART:', 'DTSTART;TZID=America/Chicago;TZID=America/Chicago:'),
    sample.replace('DTSTART:', 'DTSTART;BROKEN:'),
    sample.replace('END:VCALENDAR', 'END:VCALENDAR\ntrailing garbage'),
    sample.replace('DTEND:20261120T133000', 'DTEND;VALUE=DATE:20261121'),
  ]
  for (const source of malformed) assert.deepEqual(await parseCampusIcs(source, clock), { error: 'bad_ics' })
  assert.deepEqual(await parseCampusIcs(sample), { error: 'bad_ics' })
  const equal = await parseCampusIcs(sample.replace('20261120T133000', '20261120T113000'), clock)
  assert.equal(equal.rows[0].ends_at, equal.rows[0].starts_at)
  const missing = await parseCampusIcs(sample.replace('DTEND:20261120T133000\n', ''), clock)
  assert.equal(missing.rows[0].ends_at, null)
})

test('unexpected property or parameter TZID and linked UID mismatch have exact errors', async () => {
  for (const source of [
    text('campus-other-tz.ics'),
    sample.replace('TZID:America/Chicago', 'TZID:America/New_York'),
    sample.replace('DTSTART:', 'DTSTART;TZID=America/New_York:'),
  ]) assert.deepEqual(await parseCampusIcs(source, clock), { error: 'campus_unexpected_tz' })
  assert.deepEqual(await parseCampusIcs(sample, { ...clock, event_id: '90000002' }), { error: 'campus_uid_mismatch' })
})

test('400 occurrences merge exactly and occurrence 401 is rejected without network access', async () => {
  const event = sample.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/)[0]
  const series = count => `BEGIN:VCALENDAR\n${Array.from({ length: count }, (_, i) =>
    event.replace('90000001@', `90000001-${i + 1}@`)).join('\n')}\nEND:VCALENDAR`
  const accepted = await parseCampusIcs(series(400), clock)
  assert.equal(accepted.rows.length, 1)
  assert.equal(accepted.rows[0].occurrence_count, 400)
  assert.deepEqual(await parseCampusIcs(series(401), clock), { error: 'campus_too_many_occurrences' })
  assert.equal(fetchCalls, 0)
})

test('data-URL handler loading resolves the transitive campus clock import', async () => {
  const { inlineSharedApiImports } = await import('./_test-module-loader.mjs')
  const source = inlineSharedApiImports("export { parseCampusIcs } from './_campus-ics.js'")
  const loaded = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
  const result = await loaded.parseCampusIcs(text('campus-allday-spring-no-end.ics'), clock)
  assert.equal(result.rows[0].starts_at, '2027-03-14T06:00:00.000Z')
  assert.equal(result.rows[0].ends_at, '2027-03-15T05:00:00.000Z')
})

test('a series without a final DTEND ends at the last occurrence start', async () => {
  const source = text('campus-series-3.ics').replace('DTEND:20261122T133000\n', '')
  const { rows: [row] } = await parseCampusIcs(source, clock)
  assert.equal(row.ends_at, '2026-11-22T17:30:00.000Z')
})

for (const prefixLength of [159, 160]) {
  test(`SUMMARY preserves code points at the ${prefixLength}-character boundary`, async () => {
    const emoji = String.fromCodePoint(0x1f600)
    const title = 'a'.repeat(prefixLength) + emoji + 'tail'
    const source = sample.replace('SUMMARY:Synthetic campus gathering', 'SUMMARY:' + title)
    const { rows: [row] } = await parseCampusIcs(source, clock)
    assert.equal(row.title_en.isWellFormed(), true)
    assert.equal([...row.title_en].length, 160)
    assert.equal(row.title_en, prefixLength === 159 ? 'a'.repeat(159) + emoji : 'a'.repeat(160))
  })
}

for (const scenario of ['long-ascii', 'surrogate-boundary']) {
  test(`LOCATION is bounded by code points for ${scenario}`, async () => {
    const emoji = String.fromCodePoint(0x1f600)
    const location = scenario === 'long-ascii' ? 'L'.repeat(300) : 'L'.repeat(159) + emoji + 'tail'
    const source = sample.replace('LOCATION:Synthetic public hall', 'LOCATION:' + location)
    const { rows: [row] } = await parseCampusIcs(source, clock)
    assert.equal(row.location.isWellFormed(), true)
    assert.equal([...row.location].length, 160)
    assert.equal(row.location, scenario === 'long-ascii' ? 'L'.repeat(160) : 'L'.repeat(159) + emoji)
  })
}

for (const property of [
  'RRULE:FREQ=WEEKLY;COUNT=5',
  'RDATE:20261127T113000',
  'EXDATE:20261120T113000',
  'RECURRENCE-ID:20261120T113000',
  'DURATION:PT2H',
]) {
  test(`VEVENT rejects unsupported ${property.split(':')[0]}`, async () => {
    const source = property.startsWith('DURATION:')
      ? sample.replace('DTEND:20261120T133000', property)
      : sample.replace('END:VEVENT', property + '\nEND:VEVENT')
    assert.deepEqual(await parseCampusIcs(source, clock), { error: 'bad_ics' })
  })
}

test('VALARM duration and trigger do not reject a valid event', async () => {
  const source = sample.replace('END:VEVENT',
    'BEGIN:VALARM\nTRIGGER:-PT15M\nDURATION:PT15M\nACTION:DISPLAY\nEND:VALARM\nEND:VEVENT')
  const result = await parseCampusIcs(source, clock)
  assert.equal(result.rows.length, 1)
})

test('a UID series cannot mix all-day and timed occurrences', async () => {
  const source = text('campus-series-3.ics')
    .replace('DTSTART;VALUE=DATE-TIME:20261120T113000', 'DTSTART;VALUE=DATE:20261120')
    .replace('DTEND;VALUE=DATE-TIME:20261120T133000\n', '')
  assert.deepEqual(await parseCampusIcs(source, clock), { error: 'bad_ics' })
})

test('LOCATION preserves escaped text after exactly one unescape', async () => {
  const source = sample.replace('LOCATION:Synthetic public hall', 'LOCATION:C:\\\\new\\\\,x\\\\;y')
  const { rows: [row] } = await parseCampusIcs(source, clock)
  assert.equal(row.location, 'C:\\new\\,x\\;y')
})

test('a quoted parameter containing a colon is rejected before source intake', async () => {
  const source = sample.replace('LOCATION:Synthetic public hall',
    'LOCATION;ALTREP="cid:room1.example.invalid":Synthetic public hall')
  assert.deepEqual(await parseCampusIcs(source, clock), { error: 'bad_ics' })
})
