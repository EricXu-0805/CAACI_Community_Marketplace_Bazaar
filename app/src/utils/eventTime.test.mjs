import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'

const source = readFileSync(new URL('./eventTime.ts', import.meta.url), 'utf8')
const load = source => import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`)

test('event time utilities run offline, use Central time without Intl, and share effective-end fixtures', async t => {
  const saved = { fetch: globalThis.fetch, Intl: globalThis.Intl, window: globalThis.window }
  let fetchCalls = 0
  globalThis.fetch = () => { fetchCalls += 1; throw new Error('Network forbidden') }
  try {
    const campus = await load(readFileSync(new URL('./campusTime.ts', import.meta.url), 'utf8'))
    globalThis.Intl = undefined
    const time = await load(source)
    await t.test('effective end matches server coalesce for timed, no-end, all-day and multiday events', () => {
      const rows = JSON.parse(readFileSync(new URL('../../../api/__fixtures__/community-events/effective-end.json', import.meta.url), 'utf8'))
      for (const row of rows) assert.equal(time.eventEffectiveEnd(row), row.effective_end, row.name)
    })
    await t.test('no-Intl parts match campusPartsNoIntl throughout the year and both DST transitions', () => {
      for (let ms = Date.UTC(2026, 0, 1); ms <= Date.UTC(2027, 3, 1); ms += 6 * 3600_000) {
        const date = new Date(ms)
        const { weekday, ...parts } = time.eventTimeParts(date)
        assert.deepEqual(parts, campus.campusPartsNoIntl(date))
        assert.ok(weekday >= 0 && weekday <= 6)
      }
      for (const [iso, hour, minute] of [
        ['2026-11-01T06:59:00Z', 1, 59], ['2026-11-01T07:00:00Z', 1, 0],
        ['2027-03-14T07:59:00Z', 1, 59], ['2027-03-14T08:00:00Z', 3, 0],
      ]) {
        const parts = time.eventTimeParts(iso)
        assert.equal(parts.hour, hour)
        assert.equal(parts.minute, minute)
      }
    })
    await t.test('SPEC list, previous time and detail formats in Chinese and English', () => {
      const event = { starts_at: '2026-11-20T17:30:00Z', ends_at: '2026-11-20T19:30:00Z' }
      assert.equal(time.formatEventListTime(event.starts_at), '周五 11:30')
      assert.equal(time.formatEventListTime(event.starts_at, 'en'), 'Fri 11:30 AM')
      assert.equal(time.formatEventPreviousTime(event.starts_at), '11月20日 周五 11:30 CT')
      assert.equal(time.formatEventPreviousTime(event.starts_at, 'en'), 'Fri, Nov 20, 2026 11:30 AM CT')
      assert.equal(time.formatEventDetailTime(event), '2026年11月20日（周五）11:30–13:30（美国中部时间）')
      assert.equal(time.formatEventDetailTime(event, 'en'), 'Fri, Nov 20, 2026 · 11:30 AM–1:30 PM CT')
      assert.equal(time.formatEventDetailTime({ ...event, ends_at: null }), '2026年11月20日（周五）11:30 开始（美国中部时间）')
      assert.equal(time.formatEventDetailTime({ starts_at: '2026-11-22T02:00:00Z', ends_at: '2026-11-22T08:00:00Z' }), '11月21日（周六）20:00 – 11月22日 02:00（美国中部时间）')
      assert.match(time.formatEventDetailTime({ starts_at: event.starts_at, all_day: true }), /全天/)
      assert.match(time.formatEventDetailTime({ starts_at: '2027-01-01T05:00:00Z', ends_at: '2027-01-01T07:00:00Z' }), /2026年12月31日.*2027年1月1日/)
    })
    await t.test('an all-day event names its own days: one day alone, several days up to the last one (ENGINEERING 9.3)', () => {
      // A calendar gives an all-day event from 00:00 of its first day to 00:00 of the day after its last, in Champaign.
      const one = { all_day: true, starts_at: '2026-11-23T06:00:00Z', ends_at: '2026-11-24T06:00:00Z' }
      assert.equal(time.formatEventDetailTime(one), '2026年11月23日（周一） 全天（美国中部时间）')
      assert.equal(time.formatEventDetailTime(one, 'en'), 'Mon, Nov 23, 2026 · All day CT')
      const two = { all_day: true, starts_at: '2026-11-20T06:00:00Z', ends_at: '2026-11-22T06:00:00Z' }
      assert.equal(time.formatEventDetailTime(two), '2026年11月20日（周五） – 11月21日（周六） 全天（美国中部时间）')
      assert.equal(time.formatEventDetailTime(two, 'en'), 'Fri, Nov 20, 2026 – Sat, Nov 21 · All day CT')
      const overNewYear = { all_day: true, starts_at: '2026-12-31T06:00:00Z', ends_at: '2027-01-02T06:00:00Z' }
      assert.equal(time.formatEventDetailTime(overNewYear), '2026年12月31日（周四） – 2027年1月1日（周五） 全天（美国中部时间）')
      assert.equal(time.formatEventDetailTime(overNewYear, 'en'), 'Thu, Dec 31, 2026 – Fri, Jan 1, 2027 · All day CT')
      // The day the clocks go back lasts 25 hours and the day they go forward 23; each is still one day.
      assert.equal(time.formatEventDetailTime({ all_day: true, starts_at: '2026-11-01T05:00:00Z', ends_at: '2026-11-02T06:00:00Z' }), '2026年11月1日（周日） 全天（美国中部时间）')
      assert.equal(time.formatEventDetailTime({ all_day: true, starts_at: '2027-03-14T06:00:00Z', ends_at: '2027-03-15T05:00:00Z' }), '2027年3月14日（周日） 全天（美国中部时间）')
      // Without an end that is later than the start there is only the first day.
      for (const ends_at of [null, undefined, one.starts_at, 'infinity', 'not a time']) {
        assert.equal(time.formatEventDetailTime({ ...one, ends_at }), '2026年11月23日（周一） 全天（美国中部时间）', String(ends_at))
      }
      const day = parts => `${parts.year}-${parts.month}-${parts.day}`
      assert.equal(day(time.eventLastDay(one)), '2026-11-23')
      assert.equal(day(time.eventLastDay(two)), '2026-11-21')
      // A timed event ends on the day its end falls on.
      assert.equal(day(time.eventLastDay({ starts_at: '2026-11-22T02:00:00Z', ends_at: '2026-11-22T08:00:00Z' })), '2026-11-22')
      assert.equal(day(time.eventLastDay({ starts_at: '2026-11-22T02:00:00Z', ends_at: null })), '2026-11-21')
    })
    await t.test('an end that is missing, infinite or not a time reads as no end time', () => {
      const starts_at = '2026-11-20T17:30:00Z'
      for (const ends_at of [null, undefined, 'infinity', '-infinity', 'not a time', '', 42]) {
        const event = { starts_at, ends_at }
        assert.equal(time.eventEnd(event), null, String(ends_at))
        assert.equal(time.eventEffectiveEnd(event), starts_at, String(ends_at))
        assert.equal(time.formatEventDetailTime(event), '2026年11月20日（周五）11:30 开始（美国中部时间）', String(ends_at))
        assert.equal(time.formatEventDetailTime(event, 'en'), 'Fri, Nov 20, 2026 · 11:30 AM start CT', String(ends_at))
      }
      assert.equal(time.eventEnd({ starts_at, ends_at: '2026-11-20T19:30:00Z' }), '2026-11-20T19:30:00Z')
    })
    await t.test('optional device time is absent without Intl and on Central devices, and follows SPEC 6.7.8 elsewhere', () => {
      assert.equal(time.formatEventDeviceTime({ starts_at: '2026-11-20T17:30:00Z' }), null)
      globalThis.Intl = saved.Intl
      globalThis.window = {}
      const Original = saved.Intl.DateTimeFormat
      const fake = zone => function (locale, options) {
        return options ? new Original(locale, options) : { resolvedOptions: () => ({ timeZone: zone }) }
      }
      globalThis.Intl = { DateTimeFormat: fake('America/Chicago') }
      assert.equal(time.formatEventDeviceTime({ starts_at: '2026-11-20T17:30:00Z' }), null)
      globalThis.Intl = { DateTimeFormat: fake('Asia/Shanghai') }
      const timed = { starts_at: '2026-11-20T17:30:00Z', ends_at: '2026-11-20T19:30:00Z' }
      assert.equal(time.formatEventDeviceTime(timed), '你的时间：11月21日（周六）01:30–03:30（中国标准时间）')
      assert.equal(time.formatEventDeviceTime(timed, 'en'), 'Your time: Sat, Nov 21 · 1:30 AM–3:30 AM (China Standard Time)')
      // An event that crosses midnight on the device names both days.
      const late = { starts_at: '2026-11-20T14:30:00Z', ends_at: '2026-11-20T17:30:00Z' }
      assert.equal(time.formatEventDeviceTime(late), '你的时间：11月20日（周五）22:30 – 11月21日（周六）01:30（中国标准时间）')
      assert.equal(time.formatEventDeviceTime(late, 'en'), 'Your time: Fri, Nov 20 · 10:30 PM – Sat, Nov 21 1:30 AM (China Standard Time)')
      // No end time, whatever stands where the end should be: the start alone, and nothing is thrown.
      for (const ends_at of [undefined, null, 'infinity', 'not a time']) {
        assert.equal(time.formatEventDeviceTime({ starts_at: timed.starts_at, ends_at }), '你的时间：11月21日（周六）01:30 开始（中国标准时间）', String(ends_at))
      }
      assert.equal(time.formatEventDeviceTime({ starts_at: timed.starts_at, ends_at: 'infinity' }, 'en'), 'Your time: Sat, Nov 21 · 1:30 AM start (China Standard Time)')
      // An all-day event is a calendar day in Champaign, not an instant to convert.
      assert.equal(time.formatEventDeviceTime({ all_day: true, starts_at: '2026-11-23T06:00:00Z', ends_at: '2026-11-24T06:00:00Z' }), null)
    })
    await t.test('no device-local getters appear in event time calculations', () => {
      assert.equal(/\.get(?:FullYear|Month|Date|Day|Hours|Minutes|Seconds)\(/.test(source), false)
    })
    await t.test('fetch was called zero times', () => assert.equal(fetchCalls, 0))
  } finally {
    globalThis.fetch = saved.fetch
    globalThis.Intl = saved.Intl
    if (saved.window === undefined) delete globalThis.window
    else globalThis.window = saved.window
    assert.equal(fetchCalls, 0)
  }
})
