export const EVENT_TIME_ZONE = 'America/Chicago'
type Language = 'zh' | 'en'
type EventTime = { starts_at: string; ends_at?: string | null; all_day?: boolean }
type Parts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number }

export function eventEffectiveEnd(event: EventTime): string {
  return event.ends_at ?? event.starts_at
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

const WEEK_ZH = ['日', '一', '二', '三', '四', '五', '六']
const WEEK_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (value: number) => String(value).padStart(2, '0')

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

function dateLabel(p: Parts, lang: Language, year: boolean): string {
  return lang === 'zh' ? `${year ? `${p.year}年` : ''}${p.month}月${p.day}日（周${WEEK_ZH[p.weekday]}）`
    : `${WEEK_EN[p.weekday]}, ${MONTH_EN[p.month - 1]} ${p.day}${year ? `, ${p.year}` : ''}`
}

export function formatEventDetailTime(event: EventTime, lang: Language = 'zh'): string {
  const start = eventTimeParts(event.starts_at)
  const end = event.ends_at ? eventTimeParts(event.ends_at) : null
  const sameDay = end && start.year === end.year && start.month === end.month && start.day === end.day
  if (event.all_day) {
    return `${dateLabel(start, lang, true)} ${lang === 'zh' ? '全天（美国中部时间）' : '· All day CT'}`
  }
  if (!end) {
    return lang === 'zh' ? `${dateLabel(start, lang, true)}${clock(start, lang)} 开始（美国中部时间）`
      : `${dateLabel(start, lang, true)} · ${clock(start, lang)} start CT`
  }
  if (sameDay) {
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
export function formatEventDeviceTime(event: EventTime, lang: Language = 'zh'): string | null {
  // #ifdef H5
  if (typeof window !== 'undefined' && typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function') {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!zone || zone === EVENT_TIME_ZONE || zone === 'US/Central') return null
    const formatter = new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', {
      timeZone: zone, month: 'numeric', day: 'numeric', weekday: 'short',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    })
    const start = formatter.format(new Date(event.starts_at))
    const end = event.ends_at ? `–${formatter.format(new Date(event.ends_at))}` : ''
    return `${lang === 'zh' ? '你的时间：' : 'Your time: '}${start}${end}（${zone}）`
  }
  // #endif
  return null
}
