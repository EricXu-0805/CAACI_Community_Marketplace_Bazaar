import { useSupabase } from './useSupabase'
import {
  notificationBodyKey,
  notificationDestination,
  notificationPostTarget,
  type Notification,
} from '../api/notifications'

/*
 * P3.3 (SPEC 6.8): how the notifications list shows replies. Only that page
 * imports this module, which keeps it out of the Mini Program main package.
 */

/** One line of the list: usually one notice, sometimes several merged into one. */
export interface NotificationLine {
  /** The newest notice in the line; the line shows its type, headline and time. */
  head: Notification
  /** Every notice the line stands for, newest first. */
  rows: Notification[]
}

/*
 * New replies in a watched topic are one line per topic with a count, not one
 * line per reply. Unread ones and read ones are merged separately, so reading
 * a line does not scatter it into its rows. Every other notice is its own
 * line. `rows` arrive newest first, as the list is loaded.
 */
export function notificationLines(rows: readonly Notification[]): NotificationLine[] {
  const lines: NotificationLine[] = []
  const merged = new Map<string, NotificationLine>()
  for (const row of rows) {
    const { key, target } = notificationBodyKey(row.body)
    const slot = key === 'followed_post_reply' && target ? `${target}|${row.is_read}` : ''
    const line = slot ? merged.get(slot) : undefined
    if (line) {
      line.rows.push(row)
      continue
    }
    const created = { head: row, rows: [row] }
    if (slot) merged.set(slot, created)
    lines.push(created)
  }
  return lines
}

/** Where a line leads: an unread line opens at its earliest reply, a read one at its latest. */
export function notificationLineDestination(line: NotificationLine) {
  return notificationDestination(line.head.is_read ? line.head : line.rows[line.rows.length - 1])
}

/** The first 20 characters of a topic's title, or of its first line when an update has no title. */
export function notificationTopicTitle(topic: { title?: string | null; content?: string | null }): string {
  const text = (topic.title || '').trim() || (topic.content || '').trim().split('\n')[0]
  return Array.from(text).slice(0, 20).join('')
}

/** What a reply notice says beyond its own row. */
export interface ReplyNoticeContext {
  /** Topic id to shortened title. A topic that can no longer be read has no entry. */
  titles: Map<string, string>
  /** replyNoticeKey to the nickname of whoever wrote that reply. */
  names: Map<string, string>
  /** Every topic id that was looked up, readable or not. */
  checked: Set<string>
}

/** A reply is identified by its topic and the instant it was written. */
export function replyNoticeKey(postId: string, createdAt: string): string {
  return `${postId}|${Date.parse(createdAt)}`
}

/** Titles for every notice that opens a topic, and names for replies to a reply: one request each. */
export async function fetchReplyNoticeContext(rows: readonly Notification[]): Promise<ReplyNoticeContext> {
  const context: ReplyNoticeContext = { titles: new Map(), names: new Map(), checked: new Set() }
  const replies: Array<{ post: string; at: string }> = []
  for (const row of rows) {
    const post = notificationPostTarget(row)
    if (!post) continue
    context.checked.add(post)
    if (notificationBodyKey(row.body).key === 'comment_reply') replies.push({ post, at: row.created_at })
  }
  if (!context.checked.size) return context

  const { supabase } = useSupabase()
  const [topics, authors] = await Promise.all([
    // Row security returns only the topics this member can still read.
    supabase.from('posts').select('id, title, content').in('id', [...context.checked]),
    replies.length
      ? supabase
        .from('post_comments')
        .select('post_id, created_at, profile:profiles!post_comments_user_id_fkey(nickname)')
        .in('post_id', [...new Set(replies.map(reply => reply.post))])
        .in('created_at', [...new Set(replies.map(reply => reply.at))])
      : null,
  ])
  if (topics.error) throw topics.error
  for (const topic of topics.data || []) context.titles.set(topic.id, notificationTopicTitle(topic))
  // A name that cannot be read costs the line its name and nothing else.
  for (const reply of authors?.data || []) {
    const name = (reply.profile as { nickname?: string | null } | null)?.nickname
    if (name) context.names.set(replyNoticeKey(reply.post_id, reply.created_at), name)
  }
  return context
}
