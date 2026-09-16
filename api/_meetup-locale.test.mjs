import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./meetup-notify.js', import.meta.url), 'utf8')
const start = source.indexOf('function fmtWhen(')
const code = source.slice(start, source.indexOf('\n}\n', start) + 3)
const format = new Function(`${code};return fmtWhen`)()

test('meetup dates use the recipient language and Chicago daylight-saving offset', () => {
  for (const [iso, english, chinese] of [
    ['2026-09-16T20:30:00Z', '9/16, 03:30 PM', '9/16 15:30'],
    ['2026-01-16T20:30:00Z', '1/16, 02:30 PM', '1/16 14:30'],
  ]) {
    assert.equal(format(iso, 'en'), english)
    assert.equal(format(iso, null), english)
    assert.equal(format(iso, 'zh'), chinese)
  }
  assert.match(source, /whenLabel: fmtWhen\(meetup\.meet_at, lang\)/)
})
