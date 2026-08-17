import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

/**
 * The hand-rolled Central clock has to agree with the real one.
 *
 * utils/campusTime.ts cannot use Intl with a timeZone — WeChat's iOS runtime
 * is JSC without full ICU and ignores the option — so it encodes the US rule
 * directly. Node does have full ICU, which makes
 * `Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago' })` an
 * independent oracle rather than a restatement of the same arithmetic. That is
 * also exactly what api/meetup-notify.js formats with, so agreement here is
 * agreement between the app and the email.
 */

const SRC = new URL('../src/utils/campusTime.ts', import.meta.url)

/*
 * Compiled with esbuild rather than regex-stripped, so what runs here is what
 * ships. Stripping annotations by hand went wrong on the multi-line return
 * type and produced a syntax error that looked like a test failure.
 */
async function load() {
  const { transformSync } = await import('esbuild')
  const ts = await readFile(SRC, 'utf8')
  const { code } = transformSync(ts, { loader: 'ts', format: 'cjs' })
  const module = { exports: {} }
  new Function('module', 'exports', code)(module, module.exports)
  return module.exports
}

const oracle = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
})

function oracleParts(instant) {
  const p = Object.fromEntries(oracle.formatToParts(instant).map(x => [x.type, x.value]))
  return {
    year: +p.year, month: +p.month, day: +p.day,
    hour: +p.hour % 24, minute: +p.minute,
  }
}

test('rendering an instant matches America/Chicago all year', async () => {
  const { campusPartsNoIntl } = await load()
  const wrong = []
  // Every six hours across a year that contains both transitions.
  for (let ms = Date.UTC(2026, 0, 1); ms < Date.UTC(2027, 0, 1); ms += 6 * 3600_000) {
    const instant = new Date(ms)
    const mine = campusPartsNoIntl(instant)
    const theirs = oracleParts(instant)
    if (JSON.stringify(mine) !== JSON.stringify(theirs)) {
      wrong.push(`${instant.toISOString()}  ours ${JSON.stringify(mine)}  Intl ${JSON.stringify(theirs)}`)
    }
  }
  assert.deepEqual(wrong.slice(0, 5), [], `${wrong.length} instants disagree with America/Chicago:\n  ${wrong.slice(0, 5).join('\n  ')}`)
})

test('the transitions land on the right minute', async () => {
  const { campusOffsetMinutes } = await load()
  // 2026: DST starts Sunday 8 March, ends Sunday 1 November.
  const springForward = Date.UTC(2026, 2, 8, 8) // 02:00 CST
  const fallBack = Date.UTC(2026, 10, 1, 7)     // 02:00 CDT
  assert.equal(campusOffsetMinutes(springForward - 60_000), -360, 'still CST a minute before')
  assert.equal(campusOffsetMinutes(springForward), -300, 'CDT at the transition')
  assert.equal(campusOffsetMinutes(fallBack - 60_000), -300, 'still CDT a minute before')
  assert.equal(campusOffsetMinutes(fallBack), -360, 'CST at the transition')
})

test('a picked wall-clock time means that time in Champaign', async () => {
  const { campusWallClockToInstant } = await load()
  const cases = [
    // [picked date, picked time, the instant it names]
    ['2026-09-01', '15:00', '2026-09-01T20:00:00.000Z'], // CDT, UTC-5
    ['2026-01-15', '15:00', '2026-01-15T21:00:00.000Z'], // CST, UTC-6
    ['2026-03-08', '01:00', '2026-03-08T07:00:00.000Z'], // before spring forward
    ['2026-03-08', '03:00', '2026-03-08T08:00:00.000Z'], // after it
    ['2026-11-01', '00:30', '2026-11-01T05:30:00.000Z'], // before fall back
  ]
  for (const [date, time, expected] of cases) {
    const got = campusWallClockToInstant(date, time)
    assert.equal(got?.toISOString(), expected, `${date} ${time} named the wrong instant`)
  }
})

/*
 * The whole point: what a proposer picks is what the email tells the other
 * party, whatever either phone is set to. Round-trips the picked value through
 * the instant and back out through Intl.
 */
test('what one student picks is what the other is told', async () => {
  const { campusWallClockToInstant } = await load()
  const wrong = []
  for (const date of ['2026-01-15', '2026-03-08', '2026-06-20', '2026-11-01', '2026-12-24']) {
    for (const time of ['00:30', '09:00', '15:00', '23:45']) {
      const instant = campusWallClockToInstant(date, time)
      const shown = oracleParts(instant)
      const asShown = `${shown.year}-${String(shown.month).padStart(2, '0')}-${String(shown.day).padStart(2, '0')} ${String(shown.hour).padStart(2, '0')}:${String(shown.minute).padStart(2, '0')}`
      if (asShown !== `${date} ${time}`) wrong.push(`picked ${date} ${time} → email says ${asShown}`)
    }
  }
  assert.deepEqual(wrong, [], `the number the proposer typed did not survive:\n  ${wrong.join('\n  ')}`)
})

/*
 * Control. The oracle comparison above is not enough on its own: on a machine
 * whose own timezone is America/Chicago — Eric's, in Champaign — a helper that
 * silently read device-local time would agree with Intl on every sample and
 * the whole suite would pass while testing nothing.
 *
 * So pin the property structurally instead of with an inequality that itself
 * depends on where it runs: the module must reach for UTC accessors only.
 * getHours/getMonth/getDate and friends are the device's clock by definition.
 */
test('the module never reads the device clock', async () => {
  const src = await readFile(SRC, 'utf8')
  // Only the Intl-free half; everything above it resolves the zone properly.
  const noIntlHalf = src.slice(src.indexOf('const STANDARD_OFFSET_MIN'))
  const local = [...noIntlHalf.matchAll(/\.get(FullYear|Month|Date|Day|Hours|Minutes|Seconds)\b/g)].map(m => m[0])
  assert.deepEqual(local, [], `device-local accessors in the Intl-free half of campusTime.ts: ${local.join(', ')}`)
  assert.ok(/getUTC/.test(noIntlHalf), 'and it must actually be reading UTC parts')
})

test('a fixed instant reads the same everywhere', async () => {
  const { campusPartsNoIntl } = await load()
  assert.deepEqual(
    campusPartsNoIntl(new Date('2026-09-01T20:00:00.000Z')),
    { year: 2026, month: 9, day: 1, hour: 15, minute: 0 },
    '20:00Z on 1 September is 15:00 in Champaign, wherever this test runs',
  )
})

/*
 * The two halves of campusTime.ts must not drift. The admin console resolves
 * the zone through Intl and the meetup path encodes the rule; if either is
 * ever changed alone, a listing filtered by campus date and a meetup proposed
 * for that date would start disagreeing about where the day begins.
 */
test('the Intl half and the rule half describe the same day', async () => {
  const { campusDateFromIso, campusDateStringNoIntl } = await load()
  const wrong = []
  for (let ms = Date.UTC(2026, 0, 1); ms < Date.UTC(2027, 0, 1); ms += 6 * 3600_000) {
    const instant = new Date(ms)
    const viaIntl = campusDateFromIso(instant.toISOString())
    const viaRule = campusDateStringNoIntl(instant)
    if (viaIntl !== viaRule) wrong.push(`${instant.toISOString()}  Intl ${viaIntl}  rule ${viaRule}`)
  }
  assert.deepEqual(wrong.slice(0, 5), [], `${wrong.length} instants fall on different campus days:\n  ${wrong.slice(0, 5).join('\n  ')}`)
})
