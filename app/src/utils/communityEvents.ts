import { isAllowedEventLink } from './eventLinks'
import { eventEffectiveEnd, eventTimeParts } from './eventTime'

/*
 * P4.8 (SPEC 6.7): how the events page arranges what list_community_events
 * returns. The function gives visible, non-duplicate rows in order (start
 * time, then caaci, partner, campus, member); grouping by date, the two caps
 * of the "all" view, the states and the buttons are decided here. Dates are
 * Champaign dates on every device (SPEC 6.7.8).
 */
export type EventSource = 'caaci' | 'partner' | 'campus' | 'member'
export type EventFilter = 'all' | EventSource
export const EVENT_FILTERS: readonly EventFilter[] = ['all', 'caaci', 'partner', 'campus', 'member']
type Language = 'zh' | 'en'

/** One row of list_community_events (ENGINEERING 9.6). */
export interface CommunityEvent {
  id: string
  source_type: EventSource
  region: string
  /** A member's event carries its topic's title here. */
  title: string | null
  title_en: string | null
  summary: string | null
  summary_en: string | null
  organizer_name: string | null
  partner_name_zh: string | null
  partner_name_en: string | null
  allowed_link_hosts: string[] | null
  page_url: string | null
  register_url: string | null
  registration_mode: string
  takes_registrations: boolean | null
  registration_open: boolean | null
  starts_at: string
  ends_at: string | null
  all_day: boolean
  occurrence_count: number
  time_zone: string
  location: string | null
  availability: 'visible' | 'unavailable' | 'hidden'
  cancelled_at: string | null
  status_note: string | null
  previous_starts_at: string | null
  schedule_changed_at: string | null
  revision: number
  organizer_user_id: string | null
  organizer_nickname: string | null
  organizer_avatar_url: string | null
  organizer_is_illini_verified: boolean | null
  discussion_post_id: string | null
  discussion_count: number | null
}
export type EventState = 'normal' | 'live' | 'rescheduled' | 'cancelled' | 'ended'
export interface EventMessage { key: string; params?: Record<string, string | number> }

const DAY = 86_400_000

/** SPEC 6.7.7. Over wins, then cancelled by its organizer, then on now, then moved within 14 days. */
export function eventState(event: CommunityEvent, now: number): EventState {
  if (now > Date.parse(eventEffectiveEnd(event))) return 'ended'
  if (event.source_type === 'member' && event.cancelled_at) return 'cancelled'
  if (Date.parse(event.starts_at) <= now) return 'live'
  if (event.previous_starts_at && event.schedule_changed_at && now - Date.parse(event.schedule_changed_at) <= 14 * DAY) return 'rescheduled'
  return 'normal'
}

export function eventTitle(event: CommunityEvent, lang: Language): string {
  return (lang === 'zh' ? event.title || event.title_en : event.title_en || event.title) || ''
}

/** The source in words (SPEC 6.7.1 rule 1); readers do not tell sources apart by colour. */
export function eventSourceLabel(event: CommunityEvent, lang: Language): EventMessage {
  if (event.source_type !== 'partner') return { key: `events.source.${event.source_type}` }
  const org = (lang === 'zh' ? event.partner_name_zh || event.partner_name_en : event.partner_name_en || event.partner_name_zh) || ''
  return { key: 'events.source.partner', params: { org } }
}

export interface EventDateHead { kind: 'today' | 'tomorrow' | 'day' | 'month'; year: number; month: number; day: number; weekday: number }
export interface EventGroup {
  key: string
  head: EventDateHead
  rows: CommunityEvent[]
  /** Member events of this group left out of "all" (SPEC 6.7.1 rule 6). */
  memberMore: number
  /** Campus events left out of "all" in the weeks that end in this group (rule 5). */
  campusMore: number
}
export interface EventListView {
  /** Started and not over: three at most unless all are asked for. */
  live: CommunityEvent[]
  liveMore: number
  groups: EventGroup[]
  /** Everything the filter matches that is not over, shown or folded away. */
  total: number
}

// A Champaign calendar day as a whole number of days, for differences and weeks.
const dayNumber = (parts: { year: number; month: number; day: number }) => Math.round(Date.UTC(parts.year, parts.month - 1, parts.day) / DAY)

export function buildEventList(
  events: readonly CommunityEvent[], filter: EventFilter, now: number, options: { allLive?: boolean } = {},
): EventListView {
  const shown = events.filter(event => (filter === 'all' || event.source_type === filter)
    && event.availability === 'visible' && eventState(event, now) !== 'ended')
  const live = shown.filter(event => eventState(event, now) === 'live')
  const today = dayNumber(eventTimeParts(new Date(now)))
  const groups: EventGroup[] = []
  const byKey = new Map<string, EventGroup>()
  // The last group each Monday-to-Sunday week reaches, and what was left out of that week.
  const weekGroup = new Map<number, EventGroup>()
  const campusKept = new Map<number, number>()
  const campusLeft = new Map<number, number>()
  const memberKept = new Map<EventGroup, number>()

  for (const event of shown) {
    if (eventState(event, now) === 'live') continue
    const parts = eventTimeParts(event.starts_at)
    const ahead = Math.max(0, dayNumber(parts) - today)
    const month = ahead >= 14
    const key = month ? `m:${parts.year}-${String(parts.month).padStart(2, '0')}`
      : `d:${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
    let group = byKey.get(key)
    if (!group) {
      group = {
        key, rows: [], memberMore: 0, campusMore: 0,
        head: {
          kind: month ? 'month' : ahead === 0 ? 'today' : ahead === 1 ? 'tomorrow' : 'day',
          year: parts.year, month: parts.month, day: parts.day, weekday: parts.weekday,
        },
      }
      byKey.set(key, group)
      groups.push(group)
    }
    // Monday of the event's week: getUTCDay counts from Sunday.
    const week = dayNumber(parts) - (parts.weekday + 6) % 7
    weekGroup.set(week, group)
    if (filter === 'all' && event.source_type === 'campus') {
      const kept = campusKept.get(week) || 0
      if (kept >= 10) { campusLeft.set(week, (campusLeft.get(week) || 0) + 1); continue }
      campusKept.set(week, kept + 1)
    }
    if (filter === 'all' && event.source_type === 'member') {
      const kept = memberKept.get(group) || 0
      if (kept >= 2) { group.memberMore += 1; continue }
      memberKept.set(group, kept + 1)
    }
    group.rows.push(event)
  }
  for (const [week, left] of campusLeft) weekGroup.get(week)!.campusMore += left
  return {
    live: options.allLive ? live : live.slice(0, 3),
    liveMore: options.allLive ? 0 : Math.max(0, live.length - 3),
    groups: groups.filter(group => group.rows.length || group.memberMore || group.campusMore),
    total: shown.length,
  }
}

const WEEK_ZH = ['日', '一', '二', '三', '四', '五', '六']
const WEEK_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "今天 · 11月20日 周五", "11月24日 周二", "12月" (SPEC 6.7.4 item 4). A month in another year names the year. */
export function formatEventGroupHead(head: EventDateHead, lang: Language, words: { today: string; tomorrow: string }, now: number): string {
  if (head.kind === 'month') {
    const otherYear = head.year !== eventTimeParts(new Date(now)).year
    return lang === 'zh' ? `${otherYear ? `${head.year}年` : ''}${head.month}月`
      : `${MONTH_EN[head.month - 1]}${otherYear ? ` ${head.year}` : ''}`
  }
  const date = lang === 'zh' ? `${head.month}月${head.day}日 周${WEEK_ZH[head.weekday]}`
    : `${WEEK_EN[head.weekday]}, ${MONTH_EN[head.month - 1].slice(0, 3)} ${head.day}`
  return head.kind === 'day' ? date : `${words[head.kind]} · ${date}`
}

/** The 44x48 block of a card: the first day, and whether the event runs past it (SPEC 6.7.5). */
export function eventDateBlock(event: CommunityEvent, lang: Language): { month: string; day: string; runsOn: boolean } {
  const start = eventTimeParts(event.starts_at)
  const end = event.ends_at ? eventTimeParts(event.ends_at) : start
  return {
    month: lang === 'zh' ? `${start.month}月` : MONTH_EN[start.month - 1].slice(0, 3),
    day: String(start.day),
    runsOn: dayNumber(end) > dayNumber(start),
  }
}

export interface EventAction {
  kind: 'caaciRegister' | 'caaciClosed' | 'caaciView' | 'partnerRegister' | 'partnerView' | 'campus' | 'discuss'
  primary: boolean
  disabled?: boolean
  /** An outbound link, already checked against the allowlist. */
  url?: string
  host?: string
}

/**
 * The buttons of a detail page (SPEC 6.7.9). Registration always happens with
 * the organizer. A link that is not on the allowlist gets no button, and an
 * event that is over gets no outbound button at all.
 */
export function eventActions(event: CommunityEvent, state: EventState): EventAction[] {
  const actions: EventAction[] = []
  const hosts = event.allowed_link_hosts || []
  const allowed = (url: string | null): url is string => !!url && isAllowedEventLink(url, hosts)
  if (state !== 'ended') {
    if (event.source_type === 'caaci') {
      if (allowed(event.register_url)) {
        actions.push(event.registration_open === false
          ? { kind: 'caaciClosed', primary: false, disabled: true }
          : { kind: 'caaciRegister', primary: true, url: event.register_url })
      } else if (allowed(event.page_url)) {
        actions.push({ kind: 'caaciView', primary: false, url: event.page_url })
      }
    } else if (event.source_type === 'partner') {
      if (allowed(event.register_url)) {
        actions.push({ kind: 'partnerRegister', primary: true, url: event.register_url, host: /^https:\/\/([^/?#]+)/i.exec(event.register_url)![1].toLowerCase() })
      }
      if (allowed(event.page_url)) actions.push({ kind: 'partnerView', primary: false, url: event.page_url })
    } else if (event.source_type === 'campus' && allowed(event.page_url)) {
      actions.push({ kind: 'campus', primary: false, url: event.page_url })
    }
  }
  if (event.discussion_post_id) actions.push({ kind: 'discuss', primary: event.source_type === 'member' })
  return actions
}
