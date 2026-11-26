// Keep this conversion paired with app/src/utils/campusTime.ts.
const STANDARD_OFFSET_MIN = -360
const DAYLIGHT_OFFSET_MIN = -300

function nthWeekdayUtc(year, month, weekday, nth, hourUtc) {
  const first = Date.UTC(year, month, 1)
  const shift = (weekday - new Date(first).getUTCDay() + 7) % 7
  return Date.UTC(year, month, 1 + shift + (nth - 1) * 7, hourUtc)
}

function daylightWindowUtc(year) {
  return [
    nthWeekdayUtc(year, 2, 0, 2, 8),
    nthWeekdayUtc(year, 10, 0, 1, 7),
  ]
}

export function campusOffsetMinutes(instantMs) {
  const year = new Date(instantMs).getUTCFullYear()
  const [start, end] = daylightWindowUtc(year)
  return instantMs >= start && instantMs < end ? DAYLIGHT_OFFSET_MIN : STANDARD_OFFSET_MIN
}

export function campusWallClockToInstant(date, time) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const t = /^(\d{2}):(\d{2})$/.exec(time)
  if (!d || !t) return null
  const asUtc = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]))
  if (Number.isNaN(asUtc)) return null
  const guess = asUtc - STANDARD_OFFSET_MIN * 60_000
  return new Date(asUtc - campusOffsetMinutes(guess) * 60_000)
}
