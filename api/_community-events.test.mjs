// Leading underscore keeps this offline test out of Vercel's function list.
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'

const originalFetch = globalThis.fetch
let fetchCalls = 0
globalThis.fetch = () => {
  fetchCalls += 1
  throw new Error('Network access is forbidden in community event tests')
}
// Install the guard before importing production code, including module startup.
const {
  CAMPUS_CALENDARS, normalizeCaaciEvents, normalizeCampusEvent, normalizePartnerEvent,
  normalizeMemberEvent, normalizeEventCard, deriveEventState, eventEffectiveEnd,
  normalizeEventUrl, duplicateCandidates, dedupeCommunityEvents, isAllowedEventLink,
} = await import('./_community-events.js')
after(() => {
  globalThis.fetch = originalFetch
  assert.equal(fetchCalls, 0, 'global fetch was called 0 times during the entire test run')
})

const fixtures = new URL('./__fixtures__/community-events/', import.meta.url)
const text = name => readFileSync(new URL(name, fixtures), 'utf8')
const json = name => JSON.parse(text(`${name}.json`))
const now = '2026-11-13T18:00:00Z'
const future = { source_type: 'caaci', starts_at: '2026-11-20T17:30:00Z', ends_at: '2026-11-20T19:30:00Z', availability: 'visible' }

test('DoD ①: four sources normalize to exactly the same card keys', () => {
  const caaci = normalizeCaaciEvents(json('caaci-v1-complete')).rows[0]
  const partner = json('partner-valid')
  const member = json('member-valid')
  const campus = normalizeCampusEvent({
    calendar_id: '3715', event_id: '90000001', title_en: 'Synthetic campus gathering',
    starts_at: future.starts_at, ends_at: future.ends_at, organizer_name: 'Synthetic campus host',
    location: 'Synthetic public hall', description: 'Synthetic description.',
    organizer: 'organizer@example.test', contact: 'organizer@example.test',
  }, [{ id: '3715', name_en: 'Synthetic calendar' }])
  const cards = [caaci, normalizePartnerEvent(partner.event, partner.partner), campus, normalizeMemberEvent(member.event, member.post)]
  assert.deepEqual(cards.map(card => card.source_type), ['caaci', 'partner', 'campus', 'member'])
  for (const card of cards) {
    assert.deepEqual(Object.keys(card).sort(), Object.keys(caaci).sort())
    assert.equal(card.region, 'cu')
    assert.equal(card.time_zone, 'America/Chicago')
    assert.equal('organizer' in card, false)
    assert.equal('contact' in card, false)
    assert.equal('description' in card, false)
  }
  assert.equal(caaci.title, '示例活动')
  assert.equal(caaci.organizer_name, 'CAACI')
  assert.equal(caaci.registration_mode, 'caaci_site')
  assert.equal(cards[1].source_key, 'synthetic-club|https://partner.example.test/events/games')
  assert.equal(cards[1].consent_ref, 'SYNTHETIC-001')
  assert.equal(cards[2].source_key, '3715/90000001')
  assert.equal(cards[2].page_url, 'https://calendars.illinois.edu/detail/3715/90000001')
  assert.equal(cards[2].registration_mode, 'calendar_page')
  assert.equal(cards[3].title, member.post.title)
  assert.equal(cards[3].summary, member.post.content)
  assert.equal(cards[3].registration_mode, 'discussion')
  assert.equal(cards[3].page_url, null)
  assert.equal(cards[3].register_url, null)
})

test('CAACI schema, completeness, null slug, and private-field boundaries', () => {
  assert.equal(normalizeCaaciEvents(json('caaci-v1-complete')).complete, true)
  assert.deepEqual(normalizeCaaciEvents(json('caaci-v1-incomplete')), { complete: false, rows: [] })
  const noSlug = normalizeCaaciEvents(json('caaci-slug-null')).rows[0]
  assert.equal(noSlug.register_url, null)
  assert.match(noSlug.page_url, /#bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb$/)
  assert.equal(noSlug.registration_mode, 'info_only')
  assert.deepEqual(normalizeCaaciEvents({ schema: 'v2' }), { error: 'schema_mismatch' })
  assert.deepEqual(normalizeCaaciEvents(json('caaci-event-register-signed-in')), { error: 'unexpected_private_fields' })
  for (const key of ['email', 'phone_number', 'registration', 'volunteer_questions', 'questions']) {
    const feed = json('caaci-v1-complete')
    feed.events[0].nested = [{ [key]: 'synthetic' }]
    assert.deepEqual(normalizeCaaciEvents(feed), { error: 'unexpected_private_fields' }, key)
  }
  for (const bad of [null, 'html', { schema: 'caaci.public-events.v1', events: [] }, { schema: 'caaci.public-events.v1', complete: true, events: [null] }]) {
    assert.ok(normalizeCaaciEvents(bad).error)
  }
  for (const [field, value] of [['starts_at', 'not a date'], ['ends_at', '2026-11-01T00:00:00Z'], ['time_zone', 'America/New_York'], ['id', 'invalid']]) {
    const feed = json('caaci-v1-complete')
    feed.events[0][field] = value
    assert.deepEqual(normalizeCaaciEvents(feed), { error: 'bad_json' }, field)
  }
})

test('campus defaults deny every calendar until D-33, and accepts a parsed projection only', () => {
  assert.deepEqual(CAMPUS_CALENDARS, [])
  assert.deepEqual(normalizeCampusEvent({ calendar_id: '3715' }), { error: 'campus_calendar_not_allowed' })
  assert.deepEqual(normalizeCampusEvent({ calendar_id: '3715', time_zone: 'America/New_York' }, [{ id: '3715' }]), { error: 'campus_unexpected_tz' })
  const campus = normalizeCampusEvent({
    calendar_id: '3715', event_id: '90000008', title_en: 'Cancelled synthetic gathering',
    starts_at: future.starts_at, ends_at: future.ends_at, occurrence_count: 3,
  }, [{ id: '3715', name_en: 'Synthetic calendar' }])
  assert.equal(campus.review_flag, 'title_says_cancelled')
  assert.equal(campus.occurrence_count, 3)
  assert.equal(deriveEventState(campus, now).key, 'normal')
})

test('partner registration hosts require an exact registered host and active consent', () => {
  const { event, partner } = json('partner-valid')
  assert.equal(normalizePartnerEvent(event, { ...partner, status: 'revoked' }).availability, 'hidden')
  assert.deepEqual(normalizePartnerEvent(event, { ...partner, consent_ref: '' }), { error: 'partner_consent_required' })
  for (const register_url of ['https://sub.forms.example.test/form', 'https://illinois.edu/form', 'https://forms.example.test:443/form']) {
    assert.deepEqual(normalizePartnerEvent({ ...event, register_url }, partner), { error: 'event_link_not_allowed' })
  }
  const card = normalizeMemberEvent({ ...json('member-valid').event, register_url: 'https://caaciorg.com/form', page_url: 'https://illinois.edu' }, json('member-valid').post)
  assert.equal(card.page_url, null)
  assert.equal(card.register_url, null)
})

test('DoD ②: every SPEC 6.7.7 state and bilingual wording', () => {
  const cases = [
    [future, 'normal', '', ''],
    [{ ...future, starts_at: '2026-11-13T17:00:00Z' }, 'ongoing', '进行中', ''],
    [json('caaci-rescheduled'), 'rescheduled', '时间已更新', '时间已更新：原 11月20日 周五 11:30 CT'],
    [json('caaci-ended-with-form'), 'ended', '', '活动已结束'],
    [json('caaci-missing-twice').event, 'unavailable', '', 'CAACI 官网已不再展示这场活动，请以官网为准。'],
    [{ ...future, source_type: 'campus', availability: 'unavailable' }, 'unavailable', '', '学校日历已不再显示这场活动，请以学校页面为准。'],
    [{ ...future, source_type: 'member', cancelled_at: now }, 'cancelled', '发起人已取消', '发起人已取消这场活动'],
    [{ ...future, availability: 'hidden' }, 'hidden', '', '这场活动已下架'],
  ]
  for (const [row, key, label, banner] of cases) {
    const state = deriveEventState(row, now)
    assert.equal(state.key, key)
    assert.equal(state.list_label, label)
    assert.equal(state.banner, banner)
  }
  const expectedEnglish = {
    ongoing: 'Happening now', rescheduled: 'Rescheduled (was Fri, Nov 20, 2026 11:30 AM CT)',
    ended: 'Ended', unavailable: 'No longer listed at the source. Check the source.',
    cancelled: 'Cancelled by organizer', hidden: 'This event has been removed',
  }
  for (const [row, key] of cases.slice(1)) assert.equal(deriveEventState(row, now, 'en').banner, expectedEnglish[key])
  assert.equal(deriveEventState(future, now, 'en').banner, '')
})

test('rescheduling expires at 14 days, never appears for a future or missing change time', () => {
  const row = { ...json('caaci-rescheduled'), starts_at: '2027-01-20T18:00:00Z', ends_at: null }
  assert.equal(deriveEventState(row, '2026-11-26T18:00:00Z').key, 'rescheduled')
  assert.equal(deriveEventState(row, '2026-11-26T18:00:00.001Z').key, 'normal')
  assert.equal(deriveEventState(row, '2026-11-12T17:59:59Z').key, 'normal')
  assert.equal(deriveEventState({ ...row, previous_starts_at: null }, now).key, 'normal')
  assert.equal(deriveEventState({ ...row, schedule_changed_at: null }, now).key, 'normal')
})

test('states follow the table the app reads too, one row at a time (SPEC 6.7.7)', () => {
  // app/smoke/community-event-list.test.mjs reads the same rows, so the two implementations cannot drift apart.
  const rows = json('event-states')
  assert.ok(rows.length >= 20, `only ${rows.length} rows`)
  const appName = { ongoing: 'live' }
  for (const row of rows) {
    const key = deriveEventState({ availability: 'visible', ...row.event }, row.now).key
    assert.equal(appName[key] || key, row.state, row.name)
  }
  // An end that is missing, infinite or not a time is no end.
  for (const ends_at of [null, undefined, 'infinity', '-infinity', 'not a time', '', 42]) {
    assert.equal(eventEffectiveEnd({ starts_at: future.starts_at, ends_at }), future.starts_at, String(ends_at))
  }
})

test('effective end is the shared coalesce fixture, with exact boundaries and state precedence', () => {
  for (const row of json('effective-end')) {
    assert.equal(eventEffectiveEnd(row), row.effective_end, row.name)
    assert.equal(deriveEventState({ ...future, ...row }, row.effective_end).key, 'ongoing', row.name)
    assert.equal(deriveEventState({ ...future, ...row }, new Date(Date.parse(row.effective_end) + 1)).key, 'ended', row.name)
  }
  const ended = deriveEventState(json('caaci-ended-with-form'), now)
  assert.equal(ended.show_external_links, false)
  assert.equal(ended.in_list, false)
  assert.equal(ended.in_past, true)
  const cancelled = { ...future, source_type: 'member', cancelled_at: now }
  assert.equal(deriveEventState(cancelled, now).strikethrough, true)
  assert.equal(deriveEventState(cancelled, now).in_list, true)
  assert.equal(deriveEventState(cancelled, '2026-11-21T00:00:00Z').key, 'ended')
  assert.equal(deriveEventState({ ...cancelled, availability: 'hidden' }, now).key, 'hidden')
  assert.equal(deriveEventState({ ...future, availability: 'unavailable' }, now).in_past, false)
  assert.equal(deriveEventState(future, now, 'zh', { status: 'paused' }).key, 'hidden')
})

test('synced sources never infer cancellation from titles, text, or cancelled_at', () => {
  for (const source_type of ['caaci', 'campus', 'partner']) {
    assert.equal(deriveEventState({ ...future, source_type, title: 'Cancelled postponed', summary: '取消', cancelled_at: now }, now).key, 'normal')
    assert.equal(normalizeEventCard({ ...future, source_type, cancelled_at: now }).cancelled_at, null)
  }
})

test('DoD ③: cross-source URL dedupe is deterministic and follows the full source priority', () => {
  const rows = json('cross-source-duplicate')
  assert.deepEqual(dedupeCommunityEvents(rows).map(row => row.id), ['member', 'caaci'])
  assert.deepEqual(dedupeCommunityEvents([...rows].reverse()).map(row => row.id), ['caaci', 'member'])
  const updates = duplicateCandidates(rows[3], rows.slice(0, 3))
  assert.deepEqual(new Map(updates.map(row => [row.id, row.duplicate_of])), new Map([['caaci', null], ['partner', 'caaci'], ['campus', 'caaci']]))
  for (const [higher, lower] of [['caaci', 'partner'], ['partner', 'campus'], ['campus', 'member']]) {
    const pair = [lower, higher].map(source_type => ({ id: source_type, source_type, page_url: 'https://illinois.edu/same/' }))
    assert.equal(dedupeCommunityEvents(pair)[0].source_type, higher)
  }
  assert.equal(dedupeCommunityEvents([{ id: 'a', source_type: 'caaci', page_url: 'https://illinois.edu/a' }, { id: 'b', source_type: 'campus', page_url: 'https://illinois.edu/b' }]).length, 2)
  assert.equal(dedupeCommunityEvents([{ id: 'a', source_type: 'member' }, { id: 'b', source_type: 'member' }]).length, 2)
})

test('URL dedupe strips tracking and fragments but preserves meaningful query and path case', () => {
  assert.equal(normalizeEventUrl('HTTPS://ILLINOIS.EDU/Event///?utm_source=x&b=2&a=1#top'), 'https://illinois.edu/Event?a=1&b=2')
  assert.equal(normalizeEventUrl('https://illinois.edu/Event?a=1&b=2&utm_MEDIUM=x'), 'https://illinois.edu/Event?a=1&b=2')
  assert.notEqual(normalizeEventUrl('https://illinois.edu/Event?a=1'), normalizeEventUrl('https://illinois.edu/event?a=2'))
  assert.equal(normalizeEventUrl('not a URL'), null)
  assert.equal(normalizeEventUrl(null), null)
})

test('DoD ④: allowlist rejects protocol, credentials, ports and hostname lookalikes', () => {
  for (const url of ['https://caaciorg.com/events/', 'https://illinois.edu/', 'https://calendars.illinois.edu/detail/3715/1', 'HTTPS://SUB.ILLINOIS.EDU/path', 'https://forms.example.test/form']) {
    assert.equal(isAllowedEventLink(url, ['forms.example.test']), true, url)
  }
  for (const url of ['http://caaciorg.com', '//illinois.edu', 'javascript:alert(1)', 'https://caaciorg.com.evil.test', 'https://evilillinois.edu', 'https://illinois.edu.evil.test', 'https://sub.forms.example.test', 'https://user@illinois.edu', 'https://illinois.edu:443/path', 'https://illinois.edu:8443/path', 'https://illinois.edu\\@evil.test', 'https://illinois.edu\n/path', ' https://illinois.edu', 'https://sub.caaciorg.com', 'https://forms.illinois.edu/form']) {
    assert.equal(isAllowedEventLink(url, []), false, url)
  }
})

test('DoD ⑤: all 22 required synthetic fixtures exist and contain only fixture emails and descriptions', () => {
  const required = [
    'caaci-v1-complete.json', 'caaci-v1-incomplete.json', 'caaci-slug-null.json',
    'caaci-ended-with-form.json', 'caaci-rescheduled.json', 'caaci-edge-403.html',
    'caaci-500-upstream.txt', 'campus-sample.ics', 'campus-malformed.ics',
    'partner-valid.json', 'member-valid.json', 'cross-source-duplicate.json',
    'caaci-missing-twice.json', 'caaci-event-register-signed-in.json', 'campus-series-3.ics',
    'campus-allday.ics', 'campus-dst-fallback-2026-11-01.ics', 'campus-dst-spring-2027-03-14.ics',
    'campus-escaped.ics', 'campus-cancel-title.ics', 'campus-other-tz.ics', 'campus-404.html',
  ]
  const files = readdirSync(fixtures)
  for (const file of required) assert.ok(files.includes(file), file)
  for (const file of files) {
    const source = text(file)
    for (const email of source.match(/[A-Za-z][\w.+-]*@[\w.-]+\.[A-Za-z]{2,}/g) || []) assert.equal(email, 'organizer@example.test', file)
    for (const [, description] of source.matchAll(/^DESCRIPTION:(.*)$/gm)) assert.equal(description, 'Synthetic description.', file)
    if (file.endsWith('.json')) {
      const check = value => {
        if (!value || typeof value !== 'object') return
        for (const [key, item] of Object.entries(value)) {
          if (/^summary(_en|_zh)?$|^description$/.test(key) && item != null) assert.equal(item, 'Synthetic description.', file)
          check(item)
        }
      }
      check(JSON.parse(source))
    }
  }
})

test('DoD ⑥: fixtures and pure functions made zero fetch calls', () => assert.equal(fetchCalls, 0))
