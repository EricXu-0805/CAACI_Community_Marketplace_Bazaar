export const CAMPUS_TIME_ZONE = 'America/Chicago'

interface DateParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const campusPartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CAMPUS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

function partsAt(instantMs: number): DateParts {
  const values = Object.fromEntries(
    campusPartsFormatter
      .formatToParts(new Date(instantMs))
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, Number(part.value)]),
  ) as Record<string, number>
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  }
}

function parseDateOnly(value: string): Pick<DateParts, 'year' | 'month' | 'day'> {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new Error('invalid_campus_date')
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const roundTrip = new Date(Date.UTC(year, month - 1, day))
  if (
    roundTrip.getUTCFullYear() !== year
    || roundTrip.getUTCMonth() !== month - 1
    || roundTrip.getUTCDate() !== day
  ) throw new Error('invalid_campus_date')
  return { year, month, day }
}

function wallClockToUtc(parts: DateParts): number {
  const desiredWallMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  )
  let instantMs = desiredWallMs
  // Resolve the zone offset at the target instant rather than assuming CST or
  // CDT. Two passes cover the DST transition because each pass re-evaluates
  // the offset at the newly resolved instant.
  for (let pass = 0; pass < 3; pass += 1) {
    const actual = partsAt(instantMs)
    const actualWallMs = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    )
    const correction = desiredWallMs - actualWallMs
    instantMs += correction
    if (correction === 0) break
  }
  const resolved = partsAt(instantMs)
  if (
    resolved.year !== parts.year
    || resolved.month !== parts.month
    || resolved.day !== parts.day
    || resolved.hour !== parts.hour
    || resolved.minute !== parts.minute
    || resolved.second !== parts.second
  ) throw new Error('unresolvable_campus_date')
  return instantMs
}

function nextCalendarDate(date: Pick<DateParts, 'year' | 'month' | 'day'>) {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + 1))
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  }
}

export function campusDateBounds(value: string): { startIso: string; endIso: string } {
  const date = parseDateOnly(value)
  const next = nextCalendarDate(date)
  const startMs = wallClockToUtc({ ...date, hour: 0, minute: 0, second: 0 })
  const nextStartMs = wallClockToUtc({ ...next, hour: 0, minute: 0, second: 0 })
  return {
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(nextStartMs - 1).toISOString(),
  }
}

export function campusDateFromIso(value: string | null | undefined): string {
  if (!value) return ''
  const instantMs = Date.parse(value)
  if (!Number.isFinite(instantMs)) return ''
  const parts = partsAt(instantMs)
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

/*
 * The same clock, without Intl.
 *
 * Everything above resolves the zone through Intl, which is correct on H5 and
 * is what the admin console uses. The chat thread also runs in the WeChat
 * mini-program, whose iOS runtime is JSC without full ICU — the reason
 * fmtMeetupWhen hand-pads its numbers rather than calling toLocaleTimeString.
 * A timeZone option that is silently ignored there would put a meetup at the
 * wrong hour without saying so, so the meetup path encodes the rule instead.
 *
 * US Central has been the same rule since 2007: CST is UTC-6, CDT is UTC-5,
 * daylight time runs from 02:00 local standard on the second Sunday in March
 * to 02:00 local daylight on the first Sunday in November. Meetups are capped
 * at 89 days out, so no proposal reaches a year whose rules might differ.
 * smoke/campus-time-boundary.test.mjs checks every six hours across a year
 * that these two agree.
 */

const STANDARD_OFFSET_MIN = -360 // CST
const DAYLIGHT_OFFSET_MIN = -300 // CDT

/** UTC ms for the nth given weekday of a month, at a given UTC hour. */
function nthWeekdayUtc(year: number, month: number, weekday: number, nth: number, hourUtc: number): number {
  const first = Date.UTC(year, month, 1)
  const shift = (weekday - new Date(first).getUTCDay() + 7) % 7
  return Date.UTC(year, month, 1 + shift + (nth - 1) * 7, hourUtc)
}

/* Both transitions expressed in UTC, where they are unambiguous even though
   the local clock skips and repeats around them: 02:00 CST is 08:00 UTC and
   02:00 CDT is 07:00 UTC. */
function daylightWindowUtc(year: number): [number, number] {
  return [
    nthWeekdayUtc(year, 2, 0, 2, 8),
    nthWeekdayUtc(year, 10, 0, 1, 7),
  ]
}

/** Minutes to add to UTC to get campus wall-clock time at this instant. */
export function campusOffsetMinutes(instantMs: number): number {
  const year = new Date(instantMs).getUTCFullYear()
  const [start, end] = daylightWindowUtc(year)
  return instantMs >= start && instantMs < end ? DAYLIGHT_OFFSET_MIN : STANDARD_OFFSET_MIN
}

/**
 * Read a picker's `YYYY-MM-DD` and `HH:MM` as campus wall-clock time.
 *
 * The offset depends on the instant being computed, so guess with the standard
 * offset and re-resolve. The two agree except inside the hour daylight time
 * skips, where the guess lands on the far side and the second pass corrects it.
 */
export function campusWallClockToInstant(date: string, time: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const t = /^(\d{2}):(\d{2})$/.exec(time)
  if (!d || !t) return null
  const asUtc = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]))
  if (Number.isNaN(asUtc)) return null
  const guess = asUtc - STANDARD_OFFSET_MIN * 60_000
  return new Date(asUtc - campusOffsetMinutes(guess) * 60_000)
}

/** Campus wall-clock parts of an instant, without Intl. */
export function campusPartsNoIntl(instant: Date): {
  year: number; month: number; day: number; hour: number; minute: number
} {
  const shifted = new Date(instant.getTime() + campusOffsetMinutes(instant.getTime()) * 60_000)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  }
}

/** `YYYY-MM-DD` on campus — what the date picker's bounds want. */
export function campusDateStringNoIntl(instant: Date): string {
  const p = campusPartsNoIntl(instant)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}
