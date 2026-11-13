import { POST_CATEGORIES, type PostCategory } from './communityPost'
import { campusPartsNoIntl } from './campusTime'
import type { Item, Post } from '../types'

export type HomeViewport = 'desktop' | 'phone'
export interface HomeText { zh: string; en: string }
export type HomePost = Pick<Post,
  'id' | 'user_id' | 'title' | 'category' | 'is_pinned' | 'is_official' | 'comment_count' | 'created_at' | 'status'
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
export interface HomeFillerRow { kind: 'filler'; text: HomeText }
export interface HomeBoardCard {
  kind: 'board'
  category: PostCategory
  title: HomeText
  description: HomeText
  weeklyCount?: number
  weeklyLabel?: HomeText
  rows: (HomePostRow | HomeFillerRow)[]
}
export interface HomeMarketCard {
  kind: 'market'
  title: HomeText
  items: HomeItem[]
  filler?: HomeText
}
export interface HomeSections {
  cards: (HomeBoardCard | HomeMarketCard)[]
  latest: { mode: 'list' | 'link'; rows: HomePostRow[]; link: HomeText }
  newHere: HomePostRow[] | null
  events: HomeEvent[] | null
  hot: { presentation: 'sidebar' | 'tab'; rows: HomePostRow[] } | null
  showAbout: boolean
}

const DAY = 86_400_000
const BOARD_COPY: Record<PostCategory, { title: HomeText; description: HomeText; ask: HomeText }> = {
  'campus-life': {
    title: { zh: '校园日常', en: 'Campus life' },
    description: { zh: '课程、考试、校园里的事', en: 'Classes, exams, campus life' },
    ask: { zh: '选课、考试、图书馆座位', en: 'course loads, exams, library seats' },
  },
  'settling-market': {
    title: { zh: '落脚香槟', en: 'Settling in' },
    description: { zh: '租房、银行卡、驾照、公交', en: 'Housing, banks, licenses, buses' },
    ask: { zh: '租房合同、银行开户、驾照', en: 'leases, bank accounts, licenses' },
  },
  'alumni-career': {
    title: { zh: '学长学姐说', en: 'Ask alumni' },
    description: { zh: '选课、实习、读研，问过来人', en: 'Courses, internships, grad school' },
    ask: { zh: '实习、简历、读研选择', en: 'internships, résumés, grad school' },
  },
  'events-social': {
    title: { zh: '找搭子', en: 'Find a buddy' },
    description: { zh: '拼车、饭搭子、自习、看球', en: 'Rides, meals, study, games' },
    ask: { zh: '拼车、饭搭子、一起自习', en: 'rides, meal buddies, study partners' },
  },
  'local-deals': {
    title: { zh: '吃喝好店', en: 'Around town' },
    description: { zh: '香槟附近吃喝和小店', en: 'Food and shops nearby' },
    ask: { zh: '火锅、超市、生日蛋糕', en: 'hot pot, grocery stores, birthday cakes' },
  },
}

// Binary string comparison avoids dependence on the host's locale.
const idDescending = (a: { id: string }, b: { id: string }) => a.id < b.id ? 1 : a.id > b.id ? -1 : 0
const newest = (a: { id: string; created_at: string }, b: { id: string; created_at: string }) =>
  Date.parse(b.created_at) - Date.parse(a.created_at) || idDescending(a, b)

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
  const row = (post: HomePost): HomePostRow => ({
    kind: 'post', post, time: timeLabel(post.created_at, nowMs),
    ...(post.comment_count > 0 ? { replyCount: post.comment_count } : {}),
    unanswered: post.comment_count === 0 && nowMs - Date.parse(post.created_at) <= 30 * DAY,
  })
  const take = (post: HomePost) => { used.add(post.id); return row(post) }
  const rowLimit = viewport === 'desktop' ? 4 : 3
  const cards: HomeBoardCard[] = POST_CATEGORIES.map(category => ({
    kind: 'board', category, title: { ...BOARD_COPY[category].title },
    description: { ...BOARD_COPY[category].description }, rows: [],
  }))

  // Reserve one pin per board before any other placement consumes a post.
  for (const card of cards) {
    const pin = allowed.find(p => p.category === card.category && p.is_pinned)
    if (pin) card.rows.push(take(pin))
  }
  // Featured posts have their own slot; a pinned featured post stays in its board.
  const newHere = allowed.filter(p => p.is_official && p.is_featured && !used.has(p.id)).slice(0, 5).map(take)
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
      card.weeklyLabel = { zh: `本周 ${weeklyCount} 新帖`, en: `${weeklyCount} new posts this week` }
    }
    if (card.rows.length < rowLimit) {
      const ask = BOARD_COPY[card.category].ask
      card.rows.push({
        kind: 'filler',
        text: { zh: `适合在这里问：${ask.zh} 发第一帖 ›`, en: `Ask here about ${ask.en}. Start the first topic ›` },
      })
    }
  }

  const remaining = allowed.filter(p => !used.has(p.id))
  const latestRows = remaining.length >= 5 ? remaining.slice(0, viewport === 'desktop' ? 15 : 10).map(take) : []
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
    title: { zh: viewport === 'desktop' ? '二手好物' : '二手新上架', en: viewport === 'desktop' ? 'Secondhand finds' : 'New on Market' },
    items: marketItems,
    ...(marketItems.length < (viewport === 'desktop' ? 3 : 6)
      ? { filler: { zh: '发布第一件 ›', en: 'List the first item ›' } } : {}),
  }
  const upcoming = [...new Map(events.filter(e => e.source_type !== 'member' && e.availability === 'visible'
    && !e.duplicate_of && Date.parse(e.starts_at) >= nowMs && Date.parse(e.starts_at) <= nowMs + 30 * DAY)
    .map(e => [e.id, e])).values()]
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || idDescending(a, b)).slice(0, 3)
  return {
    cards: [...cards, market],
    latest: {
      mode: latestRows.length ? 'list' : 'link', rows: latestRows,
      link: total > 0
        ? { zh: `查看全部 ${total} 个讨论 ›`, en: `View all ${total} discussions ›` }
        : { zh: '查看全部讨论 ›', en: 'View all discussions ›' },
    },
    newHere: newHere.length ? newHere : null,
    events: upcoming.length ? upcoming : null,
    hot: hotRows.length ? { presentation: viewport === 'desktop' ? 'sidebar' : 'tab', rows: hotRows } : null,
    showAbout: viewport === 'desktop',
  }
}
