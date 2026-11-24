// Offline parity and independent ICU checks of the server's campus clock.
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const originalFetch = globalThis.fetch
let fetchCalls = 0
globalThis.fetch = () => { fetchCalls += 1; throw new Error('Network forbidden in campus time tests') }
const { campusWallClockToInstant, campusOffsetMinutes } = await import('./_campus-time.js')
const appRequire = createRequire(new URL('../app/package.json', import.meta.url))
const { transform } = appRequire('esbuild')
const source = await readFile(new URL('../app/src/utils/campusTime.ts', import.meta.url), 'utf8')
const { code } = await transform(source, { loader: 'ts', format: 'esm', target: 'es2022' })
const reference = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
after(() => {
  globalThis.fetch = originalFetch
  assert.equal(fetchCalls, 0)
})

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'shortOffset',
})
const parts = instant => Object.fromEntries(formatter.formatToParts(instant).map(part => [part.type, part.value]))

test('DoD ②: repeated hour uses CST, skipped hour resolves earlier, ordinary time uses CST', () => {
  for (const [date, time, expected] of [
    ['2026-11-01', '01:30', '2026-11-01T07:30:00.000Z'],
    ['2027-03-14', '02:30', '2027-03-14T07:30:00.000Z'],
    ['2026-11-20', '11:30', '2026-11-20T17:30:00.000Z'],
  ]) assert.equal(campusWallClockToInstant(date, time).toISOString(), expected)
})

test('every 15 minutes of 2027 and every transition minute match TypeScript and independent Chicago ICU', t => {
  let yearly = 0
  let transition = 0
  const check = (date, time) => {
    const instant = campusWallClockToInstant(date, time)
    assert.equal(instant.getTime(), reference.campusWallClockToInstant(date, time).getTime(), `${date} ${time} TS`)
    const local = parts(instant)
    const expectedTime = date === '2027-03-14' && time.startsWith('02:') ? `01:${time.slice(3)}` : time
    assert.equal(`${local.year}-${local.month}-${local.day} ${local.hour}:${local.minute}`, `${date} ${expectedTime}`, 'Chicago ICU')
    assert.equal(campusOffsetMinutes(instant.getTime()), local.timeZoneName === 'GMT-5' ? -300 : -360, 'ICU offset')
  }
  for (let day = Date.UTC(2027, 0, 1); day < Date.UTC(2028, 0, 1); day += 86_400_000) {
    const date = new Date(day).toISOString().slice(0, 10)
    for (let minute = 0; minute < 1440; minute += 15) {
      check(date, `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`)
      yearly += 1
    }
  }
  for (const date of ['2026-11-01', '2027-03-14']) {
    for (let minute = 0; minute <= 240; minute += 1) {
      check(date, `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`)
      transition += 1
    }
  }
  t.diagnostic(`yearly=${yearly} transition=${transition} TS comparisons=${yearly + transition} ICU comparisons=${yearly + transition}`)
})

test('offsets change at the exact UTC DST boundaries, and malformed clock shapes return null', () => {
  for (const [instant, offset] of [
    ['2027-03-14T07:59:59.999Z', -360], ['2027-03-14T08:00:00Z', -300],
    ['2027-11-07T06:59:59.999Z', -300], ['2027-11-07T07:00:00Z', -360],
  ]) assert.equal(campusOffsetMinutes(Date.parse(instant)), offset)
  for (const [date, time] of [['not-a-date', '11:30'], ['2027-03-14', '1:30'], ['', '']]) {
    assert.equal(campusWallClockToInstant(date, time), null)
  }
})
