import { ref } from 'vue'
import { useSupabase } from './useSupabase'
import { useAuth } from './useAuth'
import { useModeration } from './useModeration'
import { useI18n } from './useI18n'
import type { Post, PostComment } from '../types'
import { expandSearch } from '../utils'
import { checkContent, isLocalDuplicate, remoteModerate } from '../utils/contentSafety'

const posts = ref<Post[]>([])
const loading = ref(false)
const hasMore = ref(true)
const PAGE_SIZE = 20
const PUBLIC_PROFILE_FIELDS = 'id, nickname, avatar_url, is_illini_verified, uid'
// title_i18n is included so attached-item previews localize too. Supabase
// returns the column as null on pre-015 databases and localize() silently
// falls back to plain `title`, so this is safe on unmigrated schemas.
const ATTACHED_ITEM_FIELDS = 'id, title, title_i18n, price, images, image_dimensions, status'
const POST_COMMENT_FIELDS = 'id, post_id, user_id, content, parent_comment_id, like_count, created_at'
const POST_SELECT = `*,
  profile:profiles!posts_user_id_fkey(${PUBLIC_PROFILE_FIELDS}),
  attached_item:items!posts_attached_item_id_fkey(${ATTACHED_ITEM_FIELDS})`

export interface CommentThread {
  parent: PostComment
  children: PostComment[]
}

/*
 * Group flat comment list into top-level threads.
 *
 * Single-level indentation semantic: ALL replies render under their
 * top-level ancestor regardless of how deep their parent_comment_id
 * chain goes in storage. New replies are normalized at submit time
 * (see onSubmitComment in plaza/post pages), but this function also
 * walks up the chain at render time as defense against stale or
 * manually-mutated rows in prod.
 *
 * Walk-up cap = 10 hops to defend against accidental cycles.
 *
 * Orphans (parent_comment_id points at a comment NOT in the current
 * list — e.g. parent was deleted, or hidden by RLS) are surfaced as
 * top-level rather than dropped. Preserves user-visible content even
 * when the conversation context can't be reconstructed.
 */
export function groupCommentsByParent(comments: PostComment[]): CommentThread[] {
  const byId = new Map(comments.map(c => [c.id, c]))
  const topLevel: PostComment[] = []
  const childMap = new Map<string, PostComment[]>()

  function topLevelAncestorId(c: PostComment): string {
    let cur = c
    let hops = 0
    while (cur.parent_comment_id && byId.has(cur.parent_comment_id) && hops < 10) {
      cur = byId.get(cur.parent_comment_id)!
      hops++
    }
    return cur.id
  }

  for (const c of comments) {
    if (!c.parent_comment_id) {
      topLevel.push(c)
      continue
    }
    const ancestorId = topLevelAncestorId(c)
    if (ancestorId === c.id) {
      // Orphan: parent_comment_id set but parent not in list (deleted? RLS-hidden?)
      topLevel.push(c)
    } else {
      const arr = childMap.get(ancestorId) ?? []
      arr.push(c)
      childMap.set(ancestorId, arr)
    }
  }

  return topLevel.map(p => ({
    parent: p,
    children: (childMap.get(p.id) ?? []).sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    ),
  }))
}

export function usePlaza() {
  const { supabase } = useSupabase()
  const { currentUser } = useAuth()
  const { t } = useI18n()

  async function fetchPosts(options: { page?: number; reset?: boolean; search?: string } = {}) {
    const { page = 0, reset = false, search } = options
    if (reset) {
      posts.value = []
      hasMore.value = true
    }
    loading.value = true
    try {
      let q = supabase
        .from('posts')
        .select(POST_SELECT)
        .eq('status', 'active')
        .order('is_pinned', { ascending: false })
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

      if (search && search.trim()) {
        const terms = expandSearch(search)
        const conditions = terms.map(term => {
          const s = term.replace(/[%_]/g, '\\$&').replace(/[.,()]/g, '').slice(0, 100)
          return `content.ilike.%${s}%`
        })
        q = q.or(conditions.join(','))
      }

      const { data, error } = await q

      if (error) throw error

      let result = (data || []) as unknown as Post[]

      const { blockedIds } = useModeration()
      if (blockedIds.value.size > 0) {
        result = result.filter(p => !blockedIds.value.has(p.user_id))
      }

      if (currentUser.value && result.length > 0) {
        const postIds = result.map(p => p.id)
        const { data: myLikes } = await supabase
          .from('post_likes')
          .select('post_id')
          .eq('user_id', currentUser.value.id)
          .in('post_id', postIds)
        const likeSet = new Set((myLikes || []).map((l: any) => l.post_id))
        result.forEach(p => { p.liked_by_me = likeSet.has(p.id) })
      }

      if (reset) posts.value = result
      else posts.value.push(...result)
      hasMore.value = (data || []).length === PAGE_SIZE
    } catch (err: any) {
      console.error('fetchPosts failed:', err)
      uni.showToast({ title: err?.message || t('error.loadFailed'), icon: 'none', duration: 3000 })
    } finally {
      loading.value = false
    }
  }

  async function fetchPost(id: string): Promise<Post | null> {
    const { data, error } = await supabase
      .from('posts')
      .select(POST_SELECT)
      .eq('id', id)
      .eq('status', 'active')
      .maybeSingle()
    if (error) throw error
    if (!data) return null
    const post = data as unknown as Post
    if (currentUser.value) {
      const { data: myLike } = await supabase
        .from('post_likes')
        .select('post_id')
        .eq('user_id', currentUser.value.id)
        .eq('post_id', id)
        .maybeSingle()
      post.liked_by_me = !!myLike
    }
    return post
  }

  /*
   * Create a plaza post.
   *
   * Post-014/015 writes (image_dimensions, content_i18n, source_lang) are
   * optional and silently retried-without on a 42703 schema error, so
   * this function works against older databases that haven't applied the
   * image-dimensions / content-i18n migrations.
   *
   * content_i18n is seeded with the author's text in `sourceLang` only;
   * the caller is expected to kick off an async translator after this
   * returns and upsert the other locale(s) via updatePostI18n.
   */
  async function createPost(
    content: string,
    images: string[] = [],
    attachedItemId: string | null = null,
    extras: {
      image_dimensions?: Array<{ w: number; h: number }>
      content_i18n?: Record<string, string> | null
      source_lang?: string | null
    } = {},
  ) {
    if (!currentUser.value) throw new Error('Not authenticated')
    const trimmed = content.trim()
    if (!trimmed && images.length === 0 && !attachedItemId) throw new Error('Content required')
    if (trimmed.length > 2000) throw new Error('Content too long')

    if (trimmed) {
      const safety = checkContent(trimmed, { kind: 'post' })
      if (!safety.ok) throw new Error(`moderation_block:${safety.category}:${safety.reason || ''}`)
      if (isLocalDuplicate('post', trimmed)) throw new Error('duplicate_post')
      const ai = await remoteModerate(trimmed)
      if (ai.flagged) throw new Error(`moderation_block:sensitive_word:ai(${ai.categories.join(',')})`)
    }

    const payloadContent = trimmed || ' '
    const basePayload: Record<string, any> = {
      user_id: currentUser.value.id,
      content: payloadContent,
      images,
      attached_item_id: attachedItemId,
    }
    if (extras.image_dimensions && extras.image_dimensions.length) {
      basePayload.image_dimensions = extras.image_dimensions
    }
    if (extras.content_i18n) basePayload.content_i18n = extras.content_i18n
    if (extras.source_lang) basePayload.source_lang = extras.source_lang

    const stripNewCols = (p: Record<string, any>) => {
      delete p.image_dimensions
      delete p.content_i18n
      delete p.source_lang
    }
    const isMissingNewCol = (err: any): boolean => {
      const msg = String(err?.message || '')
      return err?.code === '42703' && /image_dimensions|content_i18n|source_lang/.test(msg)
    }

    let res = await supabase.from('posts').insert(basePayload).select(POST_SELECT).single()
    if (res.error && isMissingNewCol(res.error)) {
      stripNewCols(basePayload)
      res = await supabase.from('posts').insert(basePayload).select(POST_SELECT).single()
    }
    if (res.error) throw res.error
    posts.value = [res.data as unknown as Post, ...posts.value]
    return res.data as unknown as Post
  }

  /*
   * Patch a post's content_i18n after an async translation call. Thin
   * helper so the publish flow doesn't have to reach into supabase
   * directly, and it stays within the RLS boundary of the row owner.
   */
  async function updatePostI18n(postId: string, content_i18n: Record<string, string>) {
    if (!currentUser.value) return
    const { error } = await supabase
      .from('posts')
      .update({ content_i18n })
      .eq('id', postId)
      .eq('user_id', currentUser.value.id)
    if (error) console.warn('[usePlaza] updatePostI18n:', error.message)
  }

  async function fetchMyActiveItems(): Promise<Array<Pick<import('../types').Item, 'id' | 'title' | 'price' | 'images' | 'status'>>> {
    if (!currentUser.value) return []
    const { data } = await supabase
      .from('items')
      .select(ATTACHED_ITEM_FIELDS)
      .eq('user_id', currentUser.value.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(20)
    return (data || []) as any
  }

  async function deletePost(postId: string) {
    const { error } = await supabase
      .from('posts')
      .delete()
      .eq('id', postId)
    if (error) throw error
    posts.value = posts.value.filter(p => p.id !== postId)
  }

  async function toggleLike(post: Post) {
    if (!currentUser.value) throw new Error('Not authenticated')
    const uid = currentUser.value.id
    if (post.liked_by_me) {
      const { error } = await supabase
        .from('post_likes')
        .delete()
        .eq('post_id', post.id)
        .eq('user_id', uid)
      if (error) throw error
      post.liked_by_me = false
      post.like_count = Math.max(0, post.like_count - 1)
    } else {
      const { error } = await supabase
        .from('post_likes')
        .insert({ post_id: post.id, user_id: uid })
      if (error && error.code !== '23505') throw error
      post.liked_by_me = true
      post.like_count = post.like_count + 1
    }
  }

  async function toggleCommentLike(comment: PostComment) {
    if (!currentUser.value) throw new Error('Not authenticated')
    const uid = currentUser.value.id
    if (comment.liked_by_me) {
      const { error } = await supabase
        .from('post_comment_likes')
        .delete()
        .eq('comment_id', comment.id)
        .eq('user_id', uid)
      if (error) throw error
      comment.liked_by_me = false
      comment.like_count = Math.max(0, (comment.like_count ?? 0) - 1)
    } else {
      const { error } = await supabase
        .from('post_comment_likes')
        .insert({ comment_id: comment.id, user_id: uid })
      if (error && error.code !== '23505') throw error
      comment.liked_by_me = true
      comment.like_count = (comment.like_count ?? 0) + 1
    }
  }

  async function fetchComments(postId: string): Promise<PostComment[]> {
    const { data, error } = await supabase
      .from('post_comments')
      .select(`${POST_COMMENT_FIELDS}, profile:profiles!post_comments_user_id_fkey(${PUBLIC_PROFILE_FIELDS})`)
      .eq('post_id', postId)
      .order('created_at', { ascending: true })
    if (error) throw error
    const result = (data || []) as unknown as PostComment[]

    if (currentUser.value && result.length > 0) {
      const commentIds = result.map(c => c.id)
      const { data: myLikes } = await supabase
        .from('post_comment_likes')
        .select('comment_id')
        .eq('user_id', currentUser.value.id)
        .in('comment_id', commentIds)
      const likeSet = new Set((myLikes || []).map((l: any) => l.comment_id))
      result.forEach(c => { c.liked_by_me = likeSet.has(c.id) })
    }

    /*
     * Hydrate reply_to_name from parent_comment_id → parent.profile.nickname.
     * Replaces the previous client-side onSubmitComment-only assignment which
     * vanished after page refresh. Now reply_to_name reflects DB truth via
     * in-memory lookup at fetch time. Top-level comments get null. Orphan
     * children whose parent was deleted/hidden also get null (groupCommentsByParent
     * surfaces them as top-level, so the @<name> ref would be misleading).
     */
    if (result.length > 0) {
      const byId = new Map(result.map(c => [c.id, c]))
      for (const c of result) {
        if (c.parent_comment_id) {
          const parent = byId.get(c.parent_comment_id)
          c.reply_to_name = parent?.profile?.nickname ?? null
        } else {
          c.reply_to_name = null
        }
      }
    }
    return result
  }

  async function createComment(postId: string, content: string, parentId?: string): Promise<PostComment> {
    if (!currentUser.value) throw new Error('Not authenticated')
    const trimmed = content.trim()
    if (!trimmed) throw new Error('Content required')

    const safety = checkContent(trimmed, { kind: 'comment' })
    if (!safety.ok) throw new Error(`moderation_block:${safety.category}:${safety.reason || ''}`)
    if (isLocalDuplicate(`comment:${postId}`, trimmed)) throw new Error('duplicate_comment')
    const aiComment = await remoteModerate(trimmed)
    if (aiComment.flagged) throw new Error(`moderation_block:sensitive_word:ai(${aiComment.categories.join(',')})`)
    const { data, error } = await supabase
      .from('post_comments')
      .insert({
        post_id: postId,
        user_id: currentUser.value.id,
        content: trimmed,
        parent_comment_id: parentId || null,
      })
      .select(`${POST_COMMENT_FIELDS}, profile:profiles!post_comments_user_id_fkey(${PUBLIC_PROFILE_FIELDS})`)
      .single()
    if (error) throw error
    const post = posts.value.find(p => p.id === postId)
    if (post) post.comment_count += 1
    return data as unknown as PostComment
  }

  async function deleteComment(commentId: string, postId: string) {
    const { error } = await supabase
      .from('post_comments')
      .delete()
      .eq('id', commentId)
    if (error) throw error
    const post = posts.value.find(p => p.id === postId)
    if (post) post.comment_count = Math.max(0, post.comment_count - 1)
  }

  return {
    posts,
    loading,
    hasMore,
    fetchPosts,
    fetchPost,
    createPost,
    updatePostI18n,
    deletePost,
    toggleLike,
    toggleCommentLike,
    fetchComments,
    createComment,
    deleteComment,
    fetchMyActiveItems,
  }
}
