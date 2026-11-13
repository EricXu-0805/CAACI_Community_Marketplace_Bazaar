// Pure source adapters. No HTTP, database access, or inferred cancellation.
export const CAMPUS_CALENDARS = Object.freeze([]) // D-33 has not selected any calendars.
const SOURCE_PRIORITY = { caaci: 0, partner: 1, campus: 2, member: 3 }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000

function linkHost(value) {
  if (typeof value !== 'string' || /[\s\\]/.test(value)) return null
  const match = /^https:\/\/([a-z0-9.-]+)(?:[/?#]|$)/i.exec(value)
  if (!match || !match[1].split('.').every(label => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))) return null
  return match[1].toLowerCase()
}

export function isAllowedEventLink(value, extraHosts = []) {
  const host = linkHost(value)
  // §9.11 expressly excludes direct Illinois Forms links.
  if (!host || host === 'forms.illinois.edu' || host.endsWith('.forms.illinois.edu')) return false
  return host === 'caaciorg.com' || host === 'illinois.edu' || host.endsWith('.illinois.edu')
    || extraHosts.some(allowed => typeof allowed === 'string' && allowed.toLowerCase() === host)
}

export function normalizeEventUrl(value) {
  if (typeof value !== 'string' || !value) return null
  try {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key)) url.searchParams.delete(key)
    }
    url.searchParams.sort()
    const path = url.pathname.replace(/\/+$/, '')
    return `${url.origin}${path}${url.search}`
  } catch {
    return null
  }
}

export function eventEffectiveEnd(event) {
  return event.ends_at ?? event.starts_at
}

// This is the same output shape for feed projections, table rows and RPC joins.
// Select fields explicitly so private upstream metadata cannot leak into cards.
export function normalizeEventCard(event, { partner, post } = {}) {
  const member = event.source_type === 'member'
  const extraHosts = partner?.allowed_link_hosts ?? event.allowed_link_hosts ?? []
  const page = member ? null : event.page_url ?? null
  const register = member || event.source_type === 'campus' ? null : event.register_url ?? null
  let mode = 'info_only'
  if (member) mode = 'discussion'
  else if (event.source_type === 'campus') mode = 'calendar_page'
  else if (event.source_type === 'caaci' && event.takes_registrations) mode = 'caaci_site'
  else if (event.source_type === 'partner' && register) mode = 'external_link'
  return {
    id: event.id ?? null,
    source_type: event.source_type,
    source_key: event.source_key,
    region: 'cu',
    organizer_name: event.source_type === 'caaci' ? 'CAACI' : event.organizer_name ?? null,
    partner_id: partner?.id ?? event.partner_id ?? null,
    partner_name_zh: partner?.name_zh ?? event.partner_name_zh ?? null,
    partner_name_en: partner?.name_en ?? event.partner_name_en ?? null,
    allowed_link_hosts: [...extraHosts],
    consent_ref: partner?.consent_ref ?? event.consent_ref ?? null,
    title: member ? post?.title ?? event.post_title ?? event.title ?? null : event.title ?? null,
    title_en: member ? null : event.title_en ?? null,
    summary: member ? post?.content ?? event.summary ?? null : event.summary ?? null,
    summary_en: member ? null : event.summary_en ?? null,
    starts_at: event.starts_at,
    ends_at: event.ends_at ?? null,
    all_day: event.all_day ?? false,
    occurrence_count: member ? 1 : event.occurrence_count ?? 1,
    time_zone: 'America/Chicago',
    location: event.location ?? null,
    page_url: isAllowedEventLink(page, extraHosts) ? page : null,
    register_url: isAllowedEventLink(register, extraHosts) ? register : null,
    registration_mode: mode,
    takes_registrations: event.source_type === 'caaci' ? event.takes_registrations ?? false : null,
    registration_open: event.source_type === 'caaci' ? event.registration_open ?? false : null,
    organizer_user_id: member ? event.organizer_user_id ?? null : null,
    discussion_post_id: event.discussion_post_id ?? null,
    comment_count: post?.comment_count ?? event.comment_count ?? 0,
    availability: partner && partner.status !== 'active' ? 'hidden' : event.availability ?? 'visible',
    cancelled_at: member ? event.cancelled_at ?? null : null,
    status_note: event.status_note ?? null,
    previous_starts_at: event.previous_starts_at ?? null,
    schedule_changed_at: event.schedule_changed_at ?? null,
    review_flag: event.review_flag ?? null,
    duplicate_of: event.duplicate_of ?? null,
    content_hash: event.content_hash ?? null,
    source_updated_at: event.source_updated_at ?? null,
  }
}

function hasPrivateFields(value) {
  if (!value || typeof value !== 'object') return false
  return Object.entries(value).some(([key, item]) => {
    const publicFlag = ['takes_registrations', 'registration_open'].includes(key)
    return (!publicFlag && /(?:^|_)(?:email|phone|registration|registrations|volunteer|volunteers|questions)(?:_|$)/i.test(key))
      || hasPrivateFields(item)
  })
}

function validTimes(event) {
  return typeof event.starts_at === 'string' && Number.isFinite(Date.parse(event.starts_at))
    && (event.ends_at == null || (typeof event.ends_at === 'string'
      && Number.isFinite(Date.parse(event.ends_at)) && Date.parse(event.ends_at) >= Date.parse(event.starts_at)))
}

export function normalizeCaaciEvents(payload) {
  if (hasPrivateFields(payload)) return { error: 'unexpected_private_fields' }
  if (!payload || payload.schema !== 'caaci.public-events.v1') return { error: 'schema_mismatch' }
  if (typeof payload.complete !== 'boolean' || !Array.isArray(payload.events) || payload.events.length > 200) return { error: 'bad_json' }
  const rows = []
  for (const event of payload.events) {
    if (!event || !UUID.test(event.id) || !validTimes(event) || event.time_zone !== 'America/Chicago'
      || (!event.title_zh && !event.title_en) || typeof event.takes_registrations !== 'boolean'
      || typeof event.registration_open !== 'boolean'
      || !/^https:\/\/caaciorg\.com\/events\/#[A-Za-z0-9-]+$/.test(event.page_url)
      || (event.register_url != null && !/^https:\/\/caaciorg\.com\/events\/[a-z0-9-]+\/register\/$/.test(event.register_url))
      || (event.takes_registrations !== (event.register_url != null))) return { error: 'bad_json' }
    rows.push(normalizeEventCard({
      ...event, id: null, source_type: 'caaci', source_key: event.id,
      title: event.title_zh, summary: event.summary_zh,
    }))
  }
  return { complete: payload.complete, rows }
}

// Input is the safe parsed projection from _campus-ics.js, not raw ICS.
// Production callers omit calendars; fixtures can explicitly supply a calendar.
export function normalizeCampusEvent(event, calendars = CAMPUS_CALENDARS) {
  const calendar = calendars.find(item => String(item.id) === String(event.calendar_id))
  if (!calendar) return { error: 'campus_calendar_not_allowed' }
  if (event.time_zone && event.time_zone !== 'America/Chicago') return { error: 'campus_unexpected_tz' }
  if (event.occurrence_count > 400) return { error: 'campus_too_many_occurrences' }
  if (!/^\d{1,6}$/.test(String(event.calendar_id)) || !/^\d{1,12}$/.test(String(event.event_id))
    || !validTimes(event) || typeof event.title_en !== 'string' || !event.title_en.trim()) return { error: 'bad_ics' }
  const sourceKey = `${event.calendar_id}/${event.event_id}`
  return normalizeEventCard({
    ...event, source_type: 'campus', source_key: sourceKey,
    title_en: event.title_en.trim().slice(0, 160),
    organizer_name: event.organizer_name ?? calendar.name_en,
    page_url: `https://calendars.illinois.edu/detail/${sourceKey}`,
    review_flag: /^(cancel+ed|postponed)\b/i.test(event.title_en.trim()) ? 'title_says_cancelled' : null,
  })
}

export function normalizePartnerEvent(event, partner) {
  if (!partner?.consent_ref) return { error: 'partner_consent_required' }
  const hosts = partner.allowed_link_hosts ?? []
  if (!isAllowedEventLink(event.page_url, hosts) || (event.register_url != null
    && (!isAllowedEventLink(event.register_url, hosts)
      || !hosts.some(host => host.toLowerCase() === linkHost(event.register_url))))) return { error: 'event_link_not_allowed' }
  return normalizeEventCard({
    ...event, source_type: 'partner',
    source_key: `${partner.slug}|${normalizeEventUrl(event.page_url)}`,
    organizer_name: event.organizer_name ?? partner.name_zh ?? partner.name_en,
  }, { partner })
}

export function normalizeMemberEvent(event, post) {
  return normalizeEventCard({
    ...event, source_type: 'member', source_key: event.source_key ?? post.id,
    discussion_post_id: event.discussion_post_id ?? post.id,
  }, { post })
}

function previousTime(value, lang) {
  const date = new Date(value)
  if (lang === 'en') {
    const day = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    }).format(date)
    const time = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', hour12: true }).format(date)
    return `${day} ${time} CT`
  }
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', month: 'numeric', day: 'numeric', weekday: 'short',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(part => [part.type, part.value]))
  const weekdays = { Sun: '日', Mon: '一', Tue: '二', Wed: '三', Thu: '四', Fri: '五', Sat: '六' }
  return `${parts.month}月${parts.day}日 周${weekdays[parts.weekday]} ${parts.hour}:${parts.minute} CT`
}

export function deriveEventState(event, now, lang = 'zh', partner) {
  const clock = new Date(now).getTime()
  const ended = clock > Date.parse(eventEffectiveEnd(event))
  const changed = Date.parse(event.schedule_changed_at)
  let key = 'normal'
  // Unavailable rows can survive in a client's cache, but never enter a list.
  if (event.availability === 'hidden' || (partner && partner.status !== 'active')) key = 'hidden'
  else if (event.availability === 'unavailable') key = 'unavailable'
  else if (ended) key = 'ended'
  else if (event.source_type === 'member' && event.cancelled_at) key = 'cancelled'
  else if (event.previous_starts_at && clock >= changed && clock - changed <= TWO_WEEKS) key = 'rescheduled'
  else if (clock >= Date.parse(event.starts_at)) key = 'ongoing'
  const en = lang === 'en'
  const labels = {
    normal: '', ongoing: en ? 'Happening now' : '进行中',
    rescheduled: en ? 'Rescheduled' : '时间已更新', ended: '', unavailable: '',
    cancelled: en ? 'Cancelled by organizer' : '发起人已取消', hidden: '',
  }
  const banners = {
    normal: '', ongoing: en ? 'Happening now' : '', ended: en ? 'Ended' : '活动已结束',
    unavailable: en ? 'No longer listed at the source. Check the source.'
      : event.source_type === 'campus' ? '学校日历已不再显示这场活动，请以学校页面为准。'
        : 'CAACI 官网已不再展示这场活动，请以官网为准。',
    cancelled: en ? 'Cancelled by organizer' : '发起人已取消这场活动',
    hidden: en ? 'This event has been removed' : '这场活动已下架',
  }
  if (key === 'rescheduled') {
    const previous = previousTime(event.previous_starts_at, lang)
    banners.rescheduled = en ? `Rescheduled (was ${previous})` : `时间已更新：原 ${previous}`
  }
  const visible = !['hidden', 'unavailable'].includes(key) && !event.duplicate_of
  return {
    key, list_label: labels[key], banner: banners[key],
    in_list: visible && !ended, in_past: visible && ended,
    strikethrough: key === 'cancelled',
    show_external_links: !['ended', 'unavailable', 'hidden', 'cancelled'].includes(key),
  }
}

function duplicateAssignments(rows) {
  const parents = rows.map((_, index) => index)
  const root = index => {
    while (parents[index] !== index) index = parents[index]
    return index
  }
  const links = rows.map(row => new Set([normalizeEventUrl(row.register_url), normalizeEventUrl(row.page_url)].filter(Boolean)))
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      if (rows[i].source_type !== rows[j].source_type && [...links[i]].some(link => links[j].has(link))) parents[root(i)] = root(j)
    }
  }
  const groups = new Map()
  for (let i = 0; i < rows.length; i += 1) {
    const group = root(i)
    if (!groups.has(group)) groups.set(group, [])
    groups.get(group).push(i)
  }
  const assignments = new Map()
  for (const group of groups.values()) {
    group.sort((a, b) => SOURCE_PRIORITY[rows[a].source_type] - SOURCE_PRIORITY[rows[b].source_type]
      || String(rows[a].id).localeCompare(String(rows[b].id)))
    for (const index of group) assignments.set(index, group[0])
  }
  return assignments
}

// Return write assignments, including the winning row's duplicate_of = null.
// Existing rows must include the connected matches, not just one source.
export function duplicateCandidates(newRow, existingRows) {
  const rows = [...existingRows, newRow]
  const assignments = duplicateAssignments(rows)
  const winner = assignments.get(rows.length - 1)
  return rows.flatMap((row, index) => assignments.get(index) === winner
    ? [{ id: row.id, duplicate_of: index === winner ? null : rows[winner].id }] : [])
}

export function dedupeCommunityEvents(rows) {
  const assignments = duplicateAssignments(rows)
  return rows.filter((_, index) => assignments.get(index) === index)
}
