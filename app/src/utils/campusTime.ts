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
