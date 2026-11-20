import type { SupabaseClient } from '@supabase/supabase-js'
import { useSupabase } from './useSupabase'
import { captureAccountRequest, isAccountRequestCurrent } from './accountScope'
import type { PostCategory } from '../utils/communityPost'
import { captureException } from '../utils/sentry'

/*
 * P3.2: watching and saving a topic, and the member's own topic lists.
 *
 * A watch (post_follows) means "tell me about new replies"; a save
 * (post_bookmarks) is a private bookmark. Both are private rows nobody else
 * reads and neither notifies anyone, so D-49 leaves them open to restricted
 * accounts: there is deliberately no write guard in this file.
 */
export type TopicMark = 'watch' | 'save'
export type TopicMarks = Record<TopicMark, boolean>
export type PostState = 'active' | 'hidden' | 'missing'

export interface TopicListRow {
  id: string
  title: string | null
  category: PostCategory | null
  content: string
  comment_count: number
  created_at: string
  /** Only the author's own list carries hidden topics. */
  hidden?: boolean
}
/** What stands in for a topic that cannot be read, and the author's own copy when the caller wrote it. */
export interface GoneTopic {
  state: 'hidden' | 'missing'
  own: TopicListRow | null
}

const ROW_FIELDS = 'id, title, category, content, comment_count, created_at'
const LIST_LIMIT = 100

/** A list line: the title, or the first words of an update that has none. */
export function topicRowTitle(row: Pick<TopicListRow, 'title' | 'content'>): string {
  const title = row.title?.trim()
  if (title) return title
  const firstLine = (row.content || '').trim().split('\n')[0]
  return Array.from(firstLine).slice(0, 40).join('')
}

/** Newest first; a topic that is no longer visible arrives without its row and is left out. */
export function markedTopicRows(rows: ReadonlyArray<{ post?: TopicListRow | null }> | null): TopicListRow[] {
  return (rows || []).map(row => row.post).filter((post): post is TopicListRow => !!post)
}

/*
 * The author's own hidden topic as the pages get it: the text they wrote and nothing else. The fields
 * are named one by one, so whatever else a response carries, a moderator's note for one, stays out.
 */
type OwnHiddenRow = Pick<TopicListRow, 'id' | 'title' | 'category' | 'content' | 'created_at'>
const ownHiddenRow = (row: OwnHiddenRow): TopicListRow => ({
  id: row.id, title: row.title, category: row.category, content: row.content, created_at: row.created_at,
  comment_count: 0, hidden: true,
})

/** The author's visible and hidden topics as one list, newest first. */
export function ownTopicRows(
  visible: ReadonlyArray<TopicListRow> | null,
  hidden: ReadonlyArray<OwnHiddenRow> | null,
): TopicListRow[] {
  return [
    ...(visible || []),
    ...(hidden || []).map(ownHiddenRow),
  ].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || (a.id < b.id ? 1 : -1))
}

export function useTopicLists() {
  const { supabase } = useSupabase()
  // Both names are written out as literals: scripts/app-direct-table-acl-boundary.test.mjs
  // finds every table the app reads directly by these calls.
  const markTable = (mark: TopicMark): ReturnType<SupabaseClient['from']> => (
    mark === 'watch' ? supabase.from('post_follows') : supabase.from('post_bookmarks')
  )

  /** Which of the two marks this member has on one topic. */
  async function loadTopicMarks(userId: string, postId: string): Promise<TopicMarks> {
    const token = captureAccountRequest(userId)
    const [watch, save] = await Promise.all((['watch', 'save'] as const).map(mark => markTable(mark)
      .select('post_id')
      .eq('user_id', userId)
      .eq('post_id', postId)
      .maybeSingle()))
    if (!isAccountRequestCurrent(token)) return { watch: false, save: false }
    if (watch.error) throw watch.error
    if (save.error) throw save.error
    return { watch: !!watch.data, save: !!save.data }
  }

  async function setTopicMark(userId: string, postId: string, mark: TopicMark, on: boolean): Promise<void> {
    const { error } = on
      ? await markTable(mark).insert({ user_id: userId, post_id: postId })
      : await markTable(mark).delete().eq('user_id', userId).eq('post_id', postId)
    // A repeated tap that lost the race already left the state the member asked for.
    if (error && !(on && error.code === '23505')) throw error
  }

  async function fetchMarkedTopics(userId: string, mark: TopicMark): Promise<TopicListRow[]> {
    const token = captureAccountRequest(userId)
    const { data, error } = await markTable(mark)
      .select(`created_at, post:posts(${ROW_FIELDS})`)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(LIST_LIMIT)
    if (!isAccountRequestCurrent(token)) return []
    if (error) throw error
    return markedTopicRows(data as unknown as Array<{ post?: TopicListRow | null }>)
  }

  async function fetchOwnTopics(userId: string): Promise<TopicListRow[]> {
    const token = captureAccountRequest(userId)
    const [visible, hidden] = await Promise.all([
      supabase
        .from('posts')
        .select(ROW_FIELDS)
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(LIST_LIMIT),
      // Row security hides a hidden topic even from its author; this function returns the author's own.
      supabase.rpc('list_own_hidden_posts', {}),
    ])
    if (!isAccountRequestCurrent(token)) return []
    if (visible.error) throw visible.error
    if (hidden.error) throw hidden.error
    return ownTopicRows(visible.data as unknown as TopicListRow[], hidden.data as unknown as TopicListRow[])
  }

  /** Why a topic could not be loaded: it was hidden, or it is gone. */
  async function fetchPostState(postId: string): Promise<PostState> {
    const { data, error } = await supabase.rpc('community_post_state', { post_id_in: postId })
    if (error) throw error
    return data === 'active' || data === 'hidden' ? data : 'missing'
  }

  /** The signed-in author's own hidden topic; null for anyone else. */
  async function fetchOwnHiddenPost(postId: string): Promise<TopicListRow | null> {
    const { data, error } = await supabase.rpc('list_own_hidden_posts', { post_id_in: postId })
    if (error) throw error
    const row = (data as unknown as OwnHiddenRow[] | null)?.[0]
    return row ? ownHiddenRow(row) : null
  }

  /*
   * Why a topic page has no topic to show. "Hidden" and "gone" are answers; a read that failed is
   * neither, so it is reported and thrown and the page offers a retry. Telling an author that their
   * hidden topic was deleted because one request timed out is the thing this must never do.
   */
  async function fetchGoneTopic(postId: string, signedIn: boolean): Promise<GoneTopic> {
    try {
      const state = await fetchPostState(postId)
      if (state !== 'hidden') return { state: 'missing', own: null }
      return { state, own: signedIn ? await fetchOwnHiddenPost(postId) : null }
    } catch (error) {
      captureException(error, { tags: { source: 'post.gone_state' } })
      throw error
    }
  }

  return { loadTopicMarks, setTopicMark, fetchMarkedTopics, fetchOwnTopics, fetchPostState, fetchOwnHiddenPost, fetchGoneTopic }
}
