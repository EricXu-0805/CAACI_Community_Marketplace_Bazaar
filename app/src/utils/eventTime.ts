export const EVENT_TIME_ZONE = 'America/Chicago'
type Language = 'zh' | 'en'
type EventTime = { starts_at: string; ends_at?: string | null; all_day?: boolean }
type Parts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number }

/**
 * The end an event has, or null. A missing end, 'infinity' and anything else
 * that is not a time all read as "no end time", so nothing after this formats
 * or compares a date that does not exist.
 */
export function eventEnd(event: EventTime): string | null {
  const end = event.ends_at
  return typeof end === 'string' && Number.isFinite(Date.parse(end)) ? end : null
}

export function eventEffectiveEnd(event: EventTime): string {
  return eventEnd(event) ?? event.starts_at
}

// Same arithmetic as campusPartsNoIntl. Importing campusTime currently creates
// an Intl formatter at module load, which cannot run on Mini Programs without
// Intl. Keep this module loadable there; the tests compare both implementations.
export function eventTimeParts(value: string | Date): Parts {
  const instant = value instanceof Date ? value : new Date(value)
  const year = instant.getUTCFullYear()
  const sunday = (month: number, nth: number, hour: number) => {
    const first = new Date(Date.UTC(year, month, 1)).getUTCDay()
    return Date.UTC(year, month, 1 + (7 - first) % 7 + (nth - 1) * 7, hour)
  }
  const ms = instant.getTime()
  const offset = ms >= sunday(2, 2, 8) && ms < sunday(10, 1, 7) ? -300 : -360
  const shifted = new Date(ms + offset * 60_000)
  return {
    year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(), minute: shifted.getUTCMinutes(), weekday: shifted.getUTCDay(),
  }
}

/**
 * The last Champaign day an event is on. An end is the first moment an event
 * is no longer on, so it belongs to the day before the instant it names: an
 * all-day event is stored the way its calendar gives it (ENGINEERING 9.3),
 * from 00:00 of its first day to 00:00 of the day after its last, and an
 * evening that ends at midnight is on that evening only. With no end later
 * than the start, that is the first day.
 */
export function eventLastDay(event: EventTime): Parts {
  const end = eventEnd(event)
  if (!end || Date.parse(end) <= Date.parse(event.starts_at)) return eventTimeParts(event.starts_at)
  return eventTimeParts(new Date(Date.parse(end) - 1))
}

const WEEK_ZH = ['日', '一', '二', '三', '四', '五', '六']
const WEEK_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (value: number) => String(value).padStart(2, '0')
const sameDay = (a: Parts, b: Parts) => a.year === b.year && a.month === b.month && a.day === b.day

function clock(parts: Parts, lang: Language): string {
  return lang === 'zh' ? `${pad(parts.hour)}:${pad(parts.minute)}`
    : `${parts.hour % 12 || 12}:${pad(parts.minute)} ${parts.hour < 12 ? 'AM' : 'PM'}`
}

export function formatEventListTime(value: string, lang: Language = 'zh'): string {
  const p = eventTimeParts(value)
  return `${lang === 'zh' ? `周${WEEK_ZH[p.weekday]}` : WEEK_EN[p.weekday]} ${clock(p, lang)}`
}

export function formatEventPreviousTime(value: string, lang: Language = 'zh'): string {
  const p = eventTimeParts(value)
  return lang === 'zh' ? `${p.month}月${p.day}日 周${WEEK_ZH[p.weekday]} ${clock(p, lang)} CT`
    : `${WEEK_EN[p.weekday]}, ${MONTH_EN[p.month - 1]} ${p.day}, ${p.year} ${clock(p, lang)} CT`
}

export function formatEventCheckedAt(value: string, lang: Language = 'zh', now = Date.now()): string {
  const p = eventTimeParts(value)
  const year = p.year !== eventTimeParts(new Date(now)).year
  return lang === 'zh'
    ? `${year ? `${p.year}年` : ''}${p.month}月${p.day}日 ${clock(p, lang)} CT`
    : `${MONTH_EN[p.month - 1]} ${p.day}${year ? `, ${p.year}` : ''}, ${clock(p, lang)} CT`
}

function dateLabel(p: Parts, lang: Language, year: boolean): string {
  return lang === 'zh' ? `${year ? `${p.year}年` : ''}${p.month}月${p.day}日（周${WEEK_ZH[p.weekday]}）`
    : `${WEEK_EN[p.weekday]}, ${MONTH_EN[p.month - 1]} ${p.day}${year ? `, ${p.year}` : ''}`
}

export function formatEventDetailTime(event: EventTime, lang: Language = 'zh'): string {
  const start = eventTimeParts(event.starts_at)
  if (event.all_day) {
    // One day reads as that day; several days name the last one too.
    const last = eventLastDay(event)
    const days = sameDay(start, last) ? dateLabel(start, lang, true)
      : `${dateLabel(start, lang, true)} – ${dateLabel(last, lang, start.year !== last.year)}`
    return `${days} ${lang === 'zh' ? '全天（美国中部时间）' : '· All day CT'}`
  }
  const ends = eventEnd(event)
  const end = ends ? eventTimeParts(ends) : null
  if (!end) {
    return lang === 'zh' ? `${dateLabel(start, lang, true)}${clock(start, lang)} 开始（美国中部时间）`
      : `${dateLabel(start, lang, true)} · ${clock(start, lang)} start CT`
  }
  if (sameDay(start, end)) {
    return lang === 'zh' ? `${dateLabel(start, lang, true)}${clock(start, lang)}–${clock(end, lang)}（美国中部时间）`
      : `${dateLabel(start, lang, true)} · ${clock(start, lang)}–${clock(end, lang)} CT`
  }
  const crossYear = start.year !== end.year
  return lang === 'zh'
    ? `${dateLabel(start, lang, crossYear)}${clock(start, lang)} – ${crossYear ? `${end.year}年` : ''}${end.month}月${end.day}日 ${clock(end, lang)}（美国中部时间）`
    : `${dateLabel(start, lang, true)} · ${clock(start, lang)} – ${dateLabel(end, lang, crossYear)} ${clock(end, lang)} CT`
}

// Only the optional H5 device-time line uses Intl. All primary event times use
// Central arithmetic above, regardless of the device's locale or time zone.
// SPEC 6.7.8: 「你的时间：11月21日（周六）01:30–03:30（中国标准时间）」.
export function formatEventDeviceTime(event: EventTime, lang: Language = 'zh'): string | null {
  // #ifdef H5
  // An all-day event is a calendar day in Champaign, not an instant to convert.
  if (!event.all_day && typeof window !== 'undefined' && typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function') {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!zone || zone === EVENT_TIME_ZONE || zone === 'US/Central') return null
    const numbers = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    })
    const local = (value: string): Parts => {
      const read: Record<string, string> = {}
      for (const part of numbers.formatToParts(new Date(value))) read[part.type] = part.value
      return {
        year: Number(read.year), month: Number(read.month), day: Number(read.day),
        hour: Number(read.hour), minute: Number(read.minute), weekday: WEEK_EN.indexOf(read.weekday),
      }
    }
    const start = local(event.starts_at)
    const ends = eventEnd(event)
    const end = ends ? local(ends) : null
    // The zone by the name its own readers use; its identifier when the device has no such name.
    const zoneName = new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', { timeZone: zone, timeZoneName: 'long' })
      .formatToParts(new Date(event.starts_at)).find(part => part.type === 'timeZoneName')?.value || zone
    const day = dateLabel(start, lang, false)
    if (lang === 'zh') {
      const span = !end ? `${clock(start, lang)} 开始`
        : sameDay(start, end) ? `${clock(start, lang)}–${clock(end, lang)}`
          : `${clock(start, lang)} – ${dateLabel(end, lang, false)}${clock(end, lang)}`
      return `你的时间：${day}${span}（${zoneName}）`
    }
    const span = !end ? `${clock(start, lang)} start`
      : sameDay(start, end) ? `${clock(start, lang)}–${clock(end, lang)}`
        : `${clock(start, lang)} – ${dateLabel(end, lang, false)} ${clock(end, lang)}`
    return `Your time: ${day} · ${span} (${zoneName})`
  }
  // #endif
  return null
}
