import { POST_CATEGORIES, type PostCategory } from './communityPost'
import { campusPartsNoIntl } from './campusTime'
import type { Item, Post } from '../types'

export type HomeViewport = 'desktop' | 'phone'
export interface HomeText { zh: string; en: string }
export interface HomeMessage { key: string; params?: Record<string, string | number> }
export type HomePost = Pick<Post,
  'id' | 'user_id' | 'title' | 'category' | 'is_pinned' | 'is_official' | 'comment_count' | 'created_at' | 'status'
  | 'last_activity_at' | 'answered_at'
> & {
  /** User ids from the visible post_comments projection; repeated replies are allowed. */
  reply_user_ids?: readonly string[]
  /** P3.5's official "new here" selection. */
  is_featured?: boolean
}
export type HomeItem = Pick<Item, 'id' | 'title' | 'price' | 'images' | 'status' | 'created_at'>
export interface HomeEvent {
  id: string
  source_type: 'caaci' | 'partner' | 'campus' | 'member'
  starts_at: string
  availability: 'visible' | 'unavailable' | 'hidden'
  duplicate_of?: string | null
}
/** The orders the latest list can be in (SPEC 5.2 ④, from P3.4). */
export type HomeLatestSort = 'active' | 'recent' | 'unanswered'
export interface HomePostData {
  /** Union of the five board feeds and the latest feed, keyed by post id. */
  candidates: readonly HomePost[]
  /** Separate, already time/visibility filtered seven-day category projection (§7). */
  weeklyCategories: readonly { category?: PostCategory | null }[]
  /** Region-visible topics AND legacy updates, for the collapsed link. */
  totalDiscussionCount: number
}
export interface HomePostRow {
  kind: 'post'
  post: HomePost
  time: HomeText
  replyCount?: number
  unanswered: boolean
}
/** A start-here row also names its kind, 「守则」 or 「指南」 (SPEC 5.2 S1). */
export interface HomeStartRow extends HomePostRow { type: HomeMessage }
export interface HomeFillerRow { kind: 'filler' }
export interface HomeBoardCard {
  kind: 'board'
  category: PostCategory
  title: HomeMessage
  description: HomeMessage
  weeklyCount?: number
  weeklyLabel?: HomeMessage
  rows: (HomePostRow | HomeFillerRow)[]
}
export interface HomeMarketCard {
  kind: 'market'
  title: HomeMessage
  items: HomeItem[]
  filler?: HomeMessage
}
export interface HomeSections {
  cards: (HomeBoardCard | HomeMarketCard)[]
  latest: { mode: 'list' | 'link'; rows: HomePostRow[]; link: HomeMessage }
  newHere: HomeStartRow[] | null
  events: HomeEvent[] | null
  hot: { presentation: 'sidebar' | 'tab'; rows: HomePostRow[] } | null
  showAbout: boolean
}

const DAY = 86_400_000
/**
 * The filler uses the same catalog messages on home cards and board pages.
 * SPEC 7 joins them differently: 「适合在这里问：{话题} 发第一帖 ›」 and
 * "Good for: {topics} · Post the first one ›".
 */
export function boardFiller(category: PostCategory, t: (key: string) => string, lang: string): string {
  const zh = lang === 'zh'
  return `${t('home.fillPrefix')}${zh ? '' : ' '}${t(`plaza.boardAsk.${category}`)}${zh ? ' ' : ' · '}${t('home.firstPost')}`
}

// Binary string comparison avoids dependence on the host's locale.
const idDescending = (a: { id: string }, b: { id: string }) => a.id < b.id ? 1 : a.id > b.id ? -1 : 0
const newest = (a: { id: string; created_at: string }, b: { id: string; created_at: string }) =>
  Date.parse(b.created_at) - Date.parse(a.created_at) || idDescending(a, b)
// A topic nobody has replied to was last active when it was posted.
const lastActive = (post: HomePost) => Date.parse(post.last_activity_at || post.created_at)
const mostRecentlyActive = (a: HomePost, b: HomePost) => lastActive(b) - lastActive(a) || idDescending(a, b)

function timeLabel(createdAt: string, now: number): HomeText {
  const instant = Date.parse(createdAt)
  const elapsed = now - instant
  if (elapsed < 60_000) return { zh: '刚刚', en: 'Just now' }
  if (elapsed < 3_600_000) {
    const n = Math.floor(elapsed / 60_000)
    return { zh: `${n} 分钟前`, en: `${n} min ago` }
  }
  const date = campusPartsNoIntl(new Date(instant))
  const today = campusPartsNoIntl(new Date(now))
  const calendarDays = (Date.UTC(today.year, today.month - 1, today.day)
    - Date.UTC(date.year, date.month - 1, date.day)) / DAY
  if (elapsed <= 7 * DAY) {
    if (calendarDays === 1) {
      const clock = `${String(date.hour).padStart(2, '0')}:${String(date.minute).padStart(2, '0')}`
      return { zh: `昨天 ${clock}`, en: `Yesterday ${clock}` }
    }
    if (elapsed < DAY) {
      const n = Math.floor(elapsed / 3_600_000)
      return { zh: `${n} 小时前`, en: `${n} hr ago` }
    }
    const n = Math.floor(elapsed / DAY)
    return { zh: `${n} 天前`, en: `${n} days ago` }
  }
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.month - 1]
  return date.year === today.year
    ? { zh: `${date.month}月${date.day}日`, en: `${month} ${date.day}` }
    : { zh: `${date.year}年${date.month}月${date.day}日`, en: `${month} ${date.day}, ${date.year}` }
}

/**
 * Inputs are public, region-filtered query results. An array represents a complete
 * snapshot; HomePostData preserves §7's independent weekly/count projections.
 * Short cards contain one filler row; layout reserves their remaining height.
 */
export function buildHomeSections(
  posts: readonly HomePost[] | HomePostData,
  items: readonly HomeItem[],
  events: readonly HomeEvent[],
  now: number | Date,
  viewport: HomeViewport,
  latestSort: HomeLatestSort = 'recent',
): HomeSections {
  const nowMs = typeof now === 'number' ? now : now.getTime()
  const data = 'candidates' in posts ? posts : null
  const candidates = data ? data.candidates : posts as readonly HomePost[]
  // Overlapping board/latest queries return the same snapshot of each row.
  const visible = [...new Map(candidates.filter(p => p.status === 'active').map(p => [p.id, p])).values()]
  const topics = visible.filter(p => p.title && p.category && POST_CATEGORIES.includes(p.category)).sort(newest)
  const inWeek = (p: HomePost) => Date.parse(p.created_at) >= nowMs - 7 * DAY && Date.parse(p.created_at) <= nowMs
  const officialIds = new Set(topics.filter(p => p.is_official).slice(0, 3).map(p => p.id))
  const allowed = topics.filter(p => !p.is_official || officialIds.has(p.id))
  const used = new Set<string>()
  // SPEC 5.5, from P3.4: nobody but the author has replied, and it was posted within 30 days.
  const unanswered = (post: HomePost) => !post.answered_at && nowMs - Date.parse(post.created_at) <= 30 * DAY
  const row = (post: HomePost): HomePostRow => ({
    kind: 'post', post, time: timeLabel(post.created_at, nowMs),
    ...(post.comment_count > 0 ? { replyCount: post.comment_count } : {}),
    unanswered: unanswered(post),
  })
  const take = (post: HomePost) => { used.add(post.id); return row(post) }
  const rowLimit = viewport === 'desktop' ? 4 : 3
  const cards: HomeBoardCard[] = POST_CATEGORIES.map(category => ({
    kind: 'board', category, title: { key: `plaza.category.${category}` },
    description: { key: `plaza.boardDesc.${category}` }, rows: [],
  }))

  // Reserve one pin per board before any other placement consumes a post.
  for (const card of cards) {
    const pin = allowed.find(p => p.category === card.category && p.is_pinned)
    if (pin) card.rows.push(take(pin))
  }
  // Featured posts have their own slot; a pinned featured post stays in its board.
  // SPEC 2 names 社区守则 (Community guidelines), but provides no stored kind.
  // Identify that title for now; the rules/guide metadata contract remains undecided.
  const newHere: HomeStartRow[] = allowed.filter(p => p.is_official && p.is_featured && !used.has(p.id)).slice(0, 5)
    .map(post => ({
      ...take(post),
      type: { key: /社区守则|community guidelines/i.test(post.title || '') ? 'home.typeRules' : 'home.typeGuide' },
    }))
  for (const card of cards) {
    const authors = new Map<string, number>()
    for (const existing of card.rows) {
      if (existing.kind === 'post') authors.set(existing.post.user_id, 1)
    }
    for (const post of allowed) {
      if (card.rows.length >= rowLimit) break
      if (post.category !== card.category || post.is_pinned || used.has(post.id)) continue
      const count = authors.get(post.user_id) || 0
      if (count >= 2) continue
      card.rows.push(take(post))
      authors.set(post.user_id, count + 1)
    }
    const weeklyCount = data
      ? data.weeklyCategories.filter(p => p.category === card.category).length
      : topics.filter(p => p.category === card.category && inWeek(p)).length
    if (weeklyCount >= 3) {
      card.weeklyCount = weeklyCount
      card.weeklyLabel = { key: 'home.weekNew', params: { n: weeklyCount } }
    }
    if (card.rows.length < rowLimit) card.rows.push({ kind: 'filler' })
  }

  const remaining = allowed.filter(p => !used.has(p.id))
  // Whether the block is a list is decided by what is left for it, not by the order
  // chosen: an order with nothing to show must not take its own tabs away.
  const listed = remaining.length >= 5
  const ordered = latestSort === 'active' ? [...remaining].sort(mostRecentlyActive)
    : latestSort === 'unanswered' ? remaining.filter(unanswered) : remaining
  const latestRows = listed ? ordered.slice(0, viewport === 'desktop' ? 15 : 10).map(take) : []
  const total = data ? data.totalDiscussionCount : visible.length
  const hotCandidates = topics.filter(p => inWeek(p) && p.comment_count >= 3
    && new Set((p.reply_user_ids || []).filter(id => id !== p.user_id)).size >= 2)
  const hotRows = hotCandidates.length >= 5
    ? hotCandidates.filter(p => !used.has(p.id) && (!p.is_official || officialIds.has(p.id)))
      .sort((a, b) => b.comment_count - a.comment_count || newest(a, b)).slice(0, 5).map(take)
    : []
  const marketItems = [...new Map(items.filter(i => i.status === 'active').map(i => [i.id, i])).values()]
    .sort(newest).slice(0, viewport === 'desktop' ? 3 : 6)
  const market: HomeMarketCard = {
    kind: 'market',
    title: { key: viewport === 'desktop' ? 'home.market' : 'home.marketNew' },
    items: marketItems,
    ...(marketItems.length < (viewport === 'desktop' ? 3 : 6)
      ? { filler: { key: 'home.marketFill' } } : {}),
  }
  const upcoming = [...new Map(events.filter(e => e.source_type !== 'member' && e.availability === 'visible'
    && !e.duplicate_of && Date.parse(e.starts_at) >= nowMs && Date.parse(e.starts_at) <= nowMs + 30 * DAY)
    .map(e => [e.id, e])).values()]
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || idDescending(a, b)).slice(0, 3)
  return {
    cards: [...cards, market],
    latest: {
      mode: listed ? 'list' : 'link', rows: latestRows,
      link: total > 0
        ? { key: 'home.collapsed', params: { n: total } }
        : { key: 'home.allDiscussions' },
    },
    newHere: newHere.length ? newHere : null,
    events: upcoming.length ? upcoming : null,
    hot: hotRows.length ? { presentation: viewport === 'desktop' ? 'sidebar' : 'tab', rows: hotRows } : null,
    showAbout: viewport === 'desktop',
  }
}
