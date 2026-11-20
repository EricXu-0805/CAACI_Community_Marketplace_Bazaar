import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

/*
 * P4.8 (SPEC 6.7.4, 6.7.5, 6.7.7, 6.7.9): how the events page arranges the
 * rows list_community_events returns. The function gives them in order and
 * already without duplicates; grouping by date, the two caps of the "all"
 * view, the states and the buttons are decided here, on the client.
 */
const source = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const compile = input => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(input, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText).toString('base64')}`
const input = source('utils/communityEvents.ts')
  .replace("'./eventTime'", `'${compile(source('utils/eventTime.ts'))}'`)
  .replace("'./eventLinks'", `'${compile(source('utils/eventLinks.ts'))}'`)
const {
  EVENT_FILTERS, buildEventList, eventActions, eventDateBlock, eventEmptyLinks, eventSourceLabel, eventState, eventTitle, formatEventGroupHead,
} = await import(compile(input))
// SPEC 6.7.7 as rows. api/_community-events.test.mjs reads the same file, so the two cannot drift apart.
const STATE_ROWS = JSON.parse(readFileSync(new URL('../../api/__fixtures__/community-events/event-states.json', import.meta.url), 'utf8'))

// Friday 2026-11-20 10:00 in Champaign (16:00 UTC, standard time).
const NOW = Date.parse('2026-11-20T16:00:00Z')
const HOUR = 3_600_000
const DAY = 24 * HOUR
const iso = ms => new Date(ms).toISOString()
let serial = 0
const event = (source_type, startsIn, extra = {}) => ({
  id: `event-${String(++serial).padStart(3, '0')}`, source_type, region: 'cu',
  title: source_type === 'campus' ? null : `活动 ${serial}`, title_en: source_type === 'member' ? null : `Event ${serial}`,
  summary: null, summary_en: null, organizer_name: source_type === 'campus' ? 'University Library' : null,
  partner_name_zh: source_type === 'partner' ? '国际象棋社' : null, partner_name_en: source_type === 'partner' ? 'Chess Club' : null,
  allowed_link_hosts: source_type === 'partner' ? ['chess.example.test'] : null,
  page_url: null, register_url: null, registration_mode: 'info_only', takes_registrations: null, registration_open: null,
  starts_at: iso(NOW + startsIn), ends_at: null, all_day: false, occurrence_count: 1, time_zone: 'America/Chicago',
  location: 'ARC', availability: 'visible', cancelled_at: null, status_note: null, previous_starts_at: null,
  schedule_changed_at: null, revision: 1, organizer_user_id: source_type === 'member' ? 'member-1' : null,
  organizer_nickname: source_type === 'member' ? 'Member' : null, organizer_avatar_url: null,
  organizer_is_illini_verified: source_type === 'member' ? true : null, discussion_post_id: null, discussion_count: null,
  ...extra,
})
const ids = rows => rows.map(row => row.id)

test('the five filters, in the order of the chips', () => {
  assert.deepEqual(EVENT_FILTERS, ['all', 'caaci', 'partner', 'campus', 'member'])
})

test('states: live, rescheduled, cancelled by its organizer, ended', () => {
  assert.equal(eventState(event('caaci', 2 * HOUR), NOW), 'normal')
  assert.equal(eventState(event('caaci', -HOUR, { ends_at: iso(NOW + HOUR) }), NOW), 'live')
  // Without an end the event is over once it has started (ENGINEERING 9.6: effective end).
  assert.equal(eventState(event('caaci', -HOUR), NOW), 'ended')
  assert.equal(eventState(event('caaci', -3 * HOUR, { ends_at: iso(NOW - HOUR) }), NOW), 'ended')
  const moved = { previous_starts_at: iso(NOW + DAY), schedule_changed_at: iso(NOW - 13 * DAY) }
  assert.equal(eventState(event('campus', 2 * DAY, moved), NOW), 'rescheduled')
  assert.equal(eventState(event('campus', 2 * DAY, { ...moved, schedule_changed_at: iso(NOW - 15 * DAY) }), NOW), 'normal')
  assert.equal(eventState(event('member', 2 * DAY, { cancelled_at: iso(NOW - HOUR) }), NOW), 'cancelled')
  // A cancelled event that would be on right now is cancelled, not live; an organization's row has no such state.
  assert.equal(eventState(event('member', -HOUR, { ends_at: iso(NOW + HOUR), cancelled_at: iso(NOW - DAY) }), NOW), 'cancelled')
  assert.equal(eventState(event('caaci', 2 * DAY, { cancelled_at: iso(NOW - HOUR) }), NOW), 'normal')
})

test('states follow the table the API reads too, one row at a time (SPEC 6.7.7)', () => {
  assert.ok(STATE_ROWS.length >= 20, `only ${STATE_ROWS.length} rows`)
  for (const row of STATE_ROWS) {
    assert.equal(eventState(event(row.event.source_type, 0, row.event), Date.parse(row.now)), row.state, row.name)
  }
  // What is on now is listed as on now, moved or not (SPEC 6.7.4 item 3).
  const moved = STATE_ROWS.find(row => row.name === 'moved, and on now')
  const view = buildEventList([event('campus', 0, moved.event)], 'all', Date.parse(moved.now))
  assert.equal(view.live.length, 1)
  assert.deepEqual(view.groups, [])
  // An end that is not a time counts as no end: once started the event is over, and it is not kept on the list.
  const endless = STATE_ROWS.find(row => row.name === 'an end of infinity reads as no end')
  assert.equal(buildEventList([event('member', 0, endless.event)], 'all', Date.parse(endless.now)).total, 0)
})

test('titles follow the reader language and fall back; the source is named in words', () => {
  const both = event('caaci', DAY, { title: '迎新晚会', title_en: 'Welcome night' })
  assert.equal(eventTitle(both, 'zh'), '迎新晚会')
  assert.equal(eventTitle(both, 'en'), 'Welcome night')
  assert.equal(eventTitle(event('campus', DAY, { title: null, title_en: 'Workshop' }), 'zh'), 'Workshop')
  assert.equal(eventTitle(event('member', DAY, { title: '周六羽毛球' }), 'en'), '周六羽毛球')
  assert.deepEqual(eventSourceLabel(event('caaci', DAY), 'zh'), { key: 'events.source.caaci' })
  assert.deepEqual(eventSourceLabel(event('campus', DAY), 'zh'), { key: 'events.source.campus' })
  assert.deepEqual(eventSourceLabel(event('member', DAY), 'zh'), { key: 'events.source.member' })
  assert.deepEqual(eventSourceLabel(event('partner', DAY), 'zh'), { key: 'events.source.partner', params: { org: '国际象棋社' } })
  assert.deepEqual(eventSourceLabel(event('partner', DAY), 'en'), { key: 'events.source.partner', params: { org: 'Chess Club' } })
  assert.deepEqual(eventSourceLabel(event('partner', DAY, { partner_name_en: null }), 'en').params, { org: '国际象棋社' })
})

test('date groups: today, tomorrow, a day each for two weeks, then by month, in Central time', () => {
  const rows = [
    event('caaci', 2 * HOUR), // today, Friday
    event('partner', 15 * HOUR), // 01:00 Saturday in Champaign, although still Friday in UTC-8 and Saturday in UTC
    event('campus', 4 * DAY),
    event('caaci', 13 * DAY), // the last day that gets its own group
    event('campus', 14 * DAY), // December 4
    event('caaci', 20 * DAY), // December 10
    event('caaci', 45 * DAY), // January 4, next year
  ]
  const view = buildEventList(rows, 'all', NOW)
  assert.deepEqual(view.groups.map(group => group.key), ['d:2026-11-20', 'd:2026-11-21', 'd:2026-11-24', 'd:2026-12-03', 'm:2026-12', 'm:2027-01'])
  assert.deepEqual(view.groups.map(group => group.head.kind), ['today', 'tomorrow', 'day', 'day', 'month', 'month'])
  assert.deepEqual(view.groups.map(group => ids(group.rows)), [[rows[0].id], [rows[1].id], [rows[2].id], [rows[3].id], [rows[4].id, rows[5].id], [rows[6].id]])
  assert.equal(view.total, 7)
  assert.deepEqual(view.live, [])
  // A month of another year names the year; "another" is judged at the instant the list was built for.
  assert.deepEqual(view.groups.map(group => formatEventGroupHead(group.head, 'zh', { today: '今天', tomorrow: '明天' }, NOW)),
    ['今天 · 11月20日 周五', '明天 · 11月21日 周六', '11月24日 周二', '12月3日 周四', '12月', '2027年1月'])
  assert.deepEqual(view.groups.map(group => formatEventGroupHead(group.head, 'en', { today: 'Today', tomorrow: 'Tomorrow' }, NOW)),
    ['Today · Fri, Nov 20', 'Tomorrow · Sat, Nov 21', 'Tue, Nov 24', 'Thu, Dec 3', 'December', 'January 2027'])
})

test('what is on now comes first, three at most; what is over or not visible is not listed', () => {
  const live = Array.from({ length: 5 }, (_, i) => event('campus', -HOUR - i * 60_000, { ends_at: iso(NOW + HOUR) }))
  const rows = [
    ...live,
    event('caaci', -2 * DAY, { ends_at: iso(NOW - DAY) }),
    event('caaci', DAY, { availability: 'hidden' }),
    event('caaci', DAY, { availability: 'unavailable' }),
    event('caaci', DAY),
  ]
  const view = buildEventList(rows, 'all', NOW)
  assert.deepEqual(ids(view.live), ids(live.slice(0, 3)))
  assert.equal(view.liveMore, 2)
  assert.deepEqual(view.groups.map(group => ids(group.rows)), [[rows[8].id]])
  assert.equal(view.total, 6)
  // Asked for all of them, the page gets all of them.
  assert.equal(buildEventList(rows, 'all', NOW, { allLive: true }).live.length, 5)
})

test('"all": two member events per date group, the rest as one line; the member filter shows every one', () => {
  const rows = [
    event('member', 26 * HOUR), event('caaci', 27 * HOUR), event('member', 28 * HOUR), event('member', 29 * HOUR), event('member', 30 * HOUR),
    event('member', 50 * HOUR),
  ]
  const all = buildEventList(rows, 'all', NOW)
  assert.deepEqual(all.groups.map(group => ids(group.rows)), [[rows[0].id, rows[1].id, rows[2].id], [rows[5].id]])
  assert.deepEqual(all.groups.map(group => group.memberMore), [2, 0])
  const members = buildEventList(rows, 'member', NOW)
  assert.deepEqual(members.groups.map(group => ids(group.rows)), [[rows[0].id, rows[2].id, rows[3].id, rows[4].id], [rows[5].id]])
  assert.deepEqual(members.groups.map(group => group.memberMore), [0, 0])
  assert.equal(members.total, 5)
  // A cancelled one is still listed until it is over.
  const cancelled = event('member', 26 * HOUR, { cancelled_at: iso(NOW - HOUR) })
  assert.deepEqual(ids(buildEventList([cancelled], 'all', NOW).groups[0].rows), [cancelled.id])
})

test('"all": ten campus events per week (Monday to Sunday, Central), the rest counted at the end of that week', () => {
  // Monday 2026-11-23 09:00 in Champaign is 3 days minus 1 hour from NOW.
  const monday = 3 * DAY - HOUR
  const week = Array.from({ length: 13 }, (_, i) => event('campus', monday + Math.floor(i / 3) * DAY + (i % 3) * HOUR))
  const thisWeek = [event('campus', 2 * HOUR), event('campus', 2 * DAY)] // Friday and Sunday of the current week
  const other = event('caaci', monday + 6 * DAY) // Sunday of that week
  const next = event('campus', monday + 7 * DAY)
  const view = buildEventList([...thisWeek, ...week, other, next], 'all', NOW)
  const kept = view.groups.flatMap(group => group.rows).filter(row => row.source_type === 'campus')
  assert.deepEqual(ids(kept), ids([...thisWeek, ...week.slice(0, 10), next]))
  // The line sits in the last group of that week, which here holds another source's event.
  const sunday = view.groups.find(group => group.rows.includes(other))
  assert.equal(sunday.campusMore, 3)
  assert.equal(view.groups.filter(group => group.campusMore > 0).length, 1)
  // The campus filter lists them all and adds no line.
  const campus = buildEventList([...thisWeek, ...week, other, next], 'campus', NOW)
  assert.equal(campus.groups.flatMap(group => group.rows).length, 16)
  assert.ok(campus.groups.every(group => group.campusMore === 0))
})

test('the date block names the first day, and says when an event runs on', () => {
  assert.deepEqual(eventDateBlock(event('caaci', 2 * HOUR), 'zh'), { month: '11月', day: '20', runsOn: false })
  assert.deepEqual(eventDateBlock(event('caaci', 2 * HOUR), 'en'), { month: 'Nov', day: '20', runsOn: false })
  assert.deepEqual(eventDateBlock(event('caaci', 2 * HOUR, { ends_at: iso(NOW + 3 * HOUR) }), 'zh').runsOn, false)
  assert.deepEqual(eventDateBlock(event('caaci', 2 * HOUR, { ends_at: iso(NOW + 30 * HOUR) }), 'zh'), { month: '11月', day: '20', runsOn: true })
  // An end that is not a time is no end: nothing runs on.
  for (const ends_at of ['infinity', 'not a time']) {
    assert.deepEqual(eventDateBlock(event('member', 2 * HOUR, { ends_at }), 'zh'), { month: '11月', day: '20', runsOn: false }, ends_at)
  }
})

test('an all-day event occupies its own days only (ENGINEERING 9.3)', () => {
  // A calendar gives it from 00:00 of its first day to 00:00 of the day after its last, in Champaign.
  const allDay = (starts_at, ends_at) => eventDateBlock(event('campus', 0, { all_day: true, starts_at, ends_at }), 'zh')
  // One day, with or without a DTEND in the source: no multi-day mark.
  assert.deepEqual(allDay('2026-11-23T06:00:00Z', '2026-11-24T06:00:00Z'), { month: '11月', day: '23', runsOn: false })
  // Two days.
  assert.deepEqual(allDay('2026-11-20T06:00:00Z', '2026-11-22T06:00:00Z'), { month: '11月', day: '20', runsOn: true })
  // The 25-hour day the clocks go back and the 23-hour day they go forward are one day each.
  assert.equal(allDay('2026-11-01T05:00:00Z', '2026-11-02T06:00:00Z').runsOn, false)
  assert.equal(allDay('2027-03-14T06:00:00Z', '2027-03-15T05:00:00Z').runsOn, false)
  assert.equal(allDay('2026-10-31T05:00:00Z', '2026-11-02T06:00:00Z').runsOn, true)
  // No end that is later than the start: the first day alone.
  for (const ends_at of [null, 'infinity', 'not a time', '2026-11-23T06:00:00Z']) {
    assert.equal(allDay('2026-11-23T06:00:00Z', ends_at).runsOn, false, String(ends_at))
  }
})

test('where to look when nothing is listed; in the mini program a link copies, and its label says so', () => {
  const keys = (filter, copies) => eventEmptyLinks(filter, copies).map(link => link.key)
  assert.deepEqual(keys('all', false), ['events.empty.caaciLink', 'events.empty.campusLink'])
  assert.deepEqual(keys('caaci', false), ['events.empty.caaciLink'])
  assert.deepEqual(keys('campus', false), ['events.empty.campusLink'])
  assert.deepEqual(keys('partner', false), [])
  assert.deepEqual(keys('member', false), [])
  assert.deepEqual(keys('all', true), ['events.empty.caaciLinkCopy', 'events.empty.campusLinkCopy'])
  assert.deepEqual(keys('campus', true), ['events.empty.campusLinkCopy'])
  // The same two places either way.
  for (const copies of [false, true]) {
    assert.deepEqual(eventEmptyLinks('all', copies).map(link => link.url), ['https://caaciorg.com/events/', 'https://calendars.illinois.edu/list/3715'])
  }
  // The page looks these keys up by name, so both catalogs must carry them.
  for (const language of ['zh', 'en']) {
    const catalog = source(`composables/i18n/messages/${language}.ts`)
    for (const key of [...keys('all', false), ...keys('all', true)]) assert.ok(catalog.includes(`'${key}':`), `${language} ${key}`)
  }
})

test('buttons: registration stays with the organizer, and a link off the allowlist gets no button', () => {
  const kinds = (row, now = NOW) => eventActions(row, eventState(row, now)).map(action => `${action.kind}${action.primary ? '!' : ''}${action.disabled ? '-' : ''}`)
  const page = 'https://caaciorg.com/events/#welcome'
  const form = 'https://caaciorg.com/events/welcome/register/'
  assert.deepEqual(kinds(event('caaci', DAY, { page_url: page, register_url: form, registration_mode: 'caaci_site' })), ['caaciRegister!'])
  assert.deepEqual(kinds(event('caaci', DAY, { page_url: page, register_url: form, registration_mode: 'caaci_site', registration_open: false })), ['caaciClosed-'])
  assert.deepEqual(kinds(event('caaci', DAY, { page_url: page })), ['caaciView'])
  assert.deepEqual(kinds(event('caaci', DAY, { page_url: 'https://evil.example.test/' })), [])
  const partner = { page_url: 'https://chess.example.test/open', registration_mode: 'external_link' }
  assert.deepEqual(kinds(event('partner', DAY, { ...partner, register_url: 'https://chess.example.test/signup' })), ['partnerRegister!', 'partnerView'])
  assert.deepEqual(kinds(event('partner', DAY, partner)), ['partnerView'])
  // The partner's registered host is what makes its link acceptable.
  assert.deepEqual(kinds(event('partner', DAY, { ...partner, register_url: 'https://forms.example.test/x' })), ['partnerView'])
  assert.deepEqual(kinds(event('partner', DAY, { ...partner, allowed_link_hosts: [] })), [])
  assert.deepEqual(kinds(event('campus', DAY, { page_url: 'https://calendars.illinois.edu/detail/7/123456' })), ['campus'])
  assert.deepEqual(kinds(event('campus', DAY, { page_url: 'https://forms.illinois.edu/sec/1' })), [])
  assert.deepEqual(kinds(event('member', DAY, { discussion_post_id: 'topic-1' })), ['discuss!'])
  assert.deepEqual(kinds(event('member', DAY)), [])
  // An organization's event with a discussion offers it after its own links.
  assert.deepEqual(kinds(event('caaci', DAY, { page_url: page, discussion_post_id: 'topic-2' })), ['caaciView', 'discuss'])
  // Over: no outbound button; the discussion stays.
  const over = event('caaci', -3 * HOUR, { ends_at: iso(NOW - HOUR), page_url: page, register_url: form, registration_mode: 'caaci_site', discussion_post_id: 'topic-3' })
  assert.deepEqual(kinds(over), ['discuss'])
  const action = eventActions(event('partner', DAY, { ...partner, register_url: 'https://chess.example.test/signup' }), 'normal')[0]
  assert.deepEqual({ url: action.url, host: action.host }, { url: 'https://chess.example.test/signup', host: 'chess.example.test' })
})
