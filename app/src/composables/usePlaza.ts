import { ref } from 'vue'
import { useSupabase } from './useSupabase'
import { useAuth } from './useAuth'
import { useModeration } from './useModeration'
import { useI18n } from './useI18n'
import type { Post, PostComment } from '../types'
import { expandSearch, friendlyErrorMessage } from '../utils'
import { checkContent, isLocalDuplicate, remoteModerate } from '../utils/contentSafety'
import { mpTextGate } from './useWechatSecCheck'
import { addBreadcrumb } from '../utils/sentry'

const posts = ref<Post[]>([])
const loading = ref(false)
const hasMore = ref(true)
const PAGE_SIZE = 20
// In-flight guard for like/unlike toggles (keyed by post or comment id). A
// rapid double-tap would otherwise double-apply the optimistic count and
// desync from the DB. Mirrors the useFavorites loading guard.
const likeInFlight = new Set<string>()

// Race guard for fetchPosts(): posts/loading/hasMore above are module-scoped,
// so every consumer of usePlaza() shares one race surface. Mirrors the same
// pattern applied to useItems.ts in commit 66466d3.
let latestRequestId = 0

const PUBLIC_PROFILE_FIELDS = 'id, nickname, avatar_url, is_illini_verified, uid'
// title_i18n is included so attached-item previews localize too. Supabase
// returns the column as null on pre-015 databases and localize() silently
// falls back to plain `title`, so this is safe on unmigrated schemas.
const ATTACHED_ITEM_FIELDS = 'id, title, title_i18n, price, images, image_dimensions, status, listing_type'
const POST_COMMENT_FIELDS = 'id, post_id, user_id, content, parent_comment_id, like_count, created_at'
// Explicit column list rather than `*` — same liability rationale as
// useMessages.constants: every new posts column would otherwise start
// shipping down the wire even when no UI consumes it. This enumerates
// all current posts columns; add here when a new read dependency lands.
const POST_COLUMNS =
  'id, user_id, content, images, image_dimensions, content_i18n, source_lang, is_official, is_pinned, like_count, comment_count, status, created_at, updated_at'
// post_items is mig 041's join table; replaces the single posts.attached_item_id
// column. Display order is enforced by the .order(..., { foreignTable: 'post_items' })
// clause on every SELECT below — Supabase doesn't sort nested relations otherwise.
const POST_SELECT = `${POST_COLUMNS},
  profile:profiles!posts_user_id_fkey(${PUBLIC_PROFILE_FIELDS}),
  post_items(
    display_order,
    item:items(${ATTACHED_ITEM_FIELDS})
  )`

// An attached item that was soft-deleted (e.g. via account deletion,
// migration 058) comes back as a post_items row whose embedded `item` is
// null — and the plaza/post templates key on `pi.item.id`, so an unfiltered
// row throws on render. Drop the orphaned rows; the post and its remaining
// chips still display. (search_posts_fuzzy already omits post_items.)
function stripDeletedItems(p: Post): Post {
  if (p.post_items) p.post_items = p.post_items.filter((pi: any) => pi && pi.item)
  return p
}

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
  const { t, lang } = useI18n()

  async function fetchPosts(options: { page?: number; reset?: boolean; search?: string; sort?: 'recent' | 'hot' } = {}) {
    const { page = 0, reset = false, search, sort = 'recent' } = options
    const requestId = ++latestRequestId
    if (reset) {
      posts.value = []
      hasMore.value = true
    }
    loading.value = true
    try {
      let data: any, error: any
      if (search && search.trim()) {
        // Posts fuzzy search (migration 062): trigram match on content OR
        // author nickname, ranked — so a person's name surfaces their posts
        // (#11) and typos/partial words match (#12). The RPC sorts internally
        // (pinned → rank → hot/recent → recency) and omits post_items chips.
        // Escape literal % / _ (else they act as ILIKE wildcards and a query
        // like "50% off" or "size_M" matches the whole feed) and cap length —
        // same sanitization the item search uses (useItems.ts).
        const terms = expandSearch(search)
          .map(t => t.replace(/[%_]/g, '\\$&').replace(/[.,()]/g, '').slice(0, 100))
          .filter(Boolean)
        if (terms.length === 0) { hasMore.value = false; return }
        const res = await supabase.rpc('search_posts_fuzzy', {
          terms_in: terms,
          sort_in: sort,
          limit_in: PAGE_SIZE,
          offset_in: page * PAGE_SIZE,
        })
        data = res.data; error = res.error
      } else {
        // Pinned posts (CAACI 官方 announcements) always lead. Within that,
        // 热门 ranks by engagement (likes → comments → recency); 最新 is
        // chronological. PostgREST can't order by an expression, so 热门 is a
        // likes→comments→recency tie-break ladder — close enough at campus scale.
        let q = supabase
          .from('posts')
          .select(POST_SELECT)
          .eq('status', 'active')
          .order('is_pinned', { ascending: false })
        if (sort === 'hot') {
          q = q
            .order('like_count', { ascending: false })
            .order('comment_count', { ascending: false })
            .order('created_at', { ascending: false })
        } else {
          q = q.order('created_at', { ascending: false })
        }
        q = q
          .order('display_order', { foreignTable: 'post_items', ascending: true })
          .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
        const res = await q
        data = res.data; error = res.error
      }
      if (requestId !== latestRequestId) return

      if (error) throw error

      let result = (data || []) as unknown as Post[]
      result.forEach(stripDeletedItems)

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
        if (requestId !== latestRequestId) return
        const likeSet = new Set((myLikes || []).map((l: any) => l.post_id))
        result.forEach(p => { p.liked_by_me = likeSet.has(p.id) })
      }

      if (reset) posts.value = result
      else posts.value.push(...result)
      hasMore.value = (data || []).length === PAGE_SIZE
    } catch (err: any) {
      if (requestId !== latestRequestId) return
      console.error('fetchPosts failed:', err)
      uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh') || t('error.loadFailed'), icon: 'none', duration: 3000 })
    } finally {
      if (requestId === latestRequestId) {
        loading.value = false
      }
    }
  }

  async function fetchPost(id: string): Promise<Post | null> {
    const { data, error } = await supabase
      .from('posts')
      .select(POST_SELECT)
      .eq('id', id)
      .eq('status', 'active')
      .order('display_order', { foreignTable: 'post_items', ascending: true })
      .maybeSingle()
    if (error) throw error
    if (!data) return null
    const post = stripDeletedItems(data as unknown as Post)
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
   * Writes image_dimensions / content_i18n / source_lang unconditionally —
   * every active DB has the 014/015 columns, so the old 42703 retry-without
   * fallback was retired.
   *
   * content_i18n is seeded with the author's text in `sourceLang` only;
   * the caller is expected to kick off an async translator after this
   * returns and upsert the other locale(s) via updatePostI18n.
   *
   * N7-redux (mig 041): attached items move from a single posts.attached_item_id
   * column to the post_items join table. The write is now two-step — insert
   * the post row first, then bulk-insert the post_items rows. If step 2 fails
   * after step 1 succeeds, the post exists without its chips; we surface this
   * via the `partial: true` return so the caller can show a soft warning
   * toast. The post itself is not rolled back (no client-side transactions
   * via supabase-js; a cleaner solution would be a SECURITY DEFINER RPC, but
   * that is out of scope for this sprint).
   */
  async function createPost(
    content: string,
    images: string[] = [],
    attachedItemIds: string[] = [],
    extras: {
      image_dimensions?: Array<{ w: number; h: number }>
      content_i18n?: Record<string, string> | null
      source_lang?: string | null
    } = {},
  ): Promise<{ id: string; partial: boolean; itemsErr?: any }> {
    if (!currentUser.value) throw new Error('Not authenticated')
    const trimmed = content.trim()
    if (!trimmed && images.length === 0 && attachedItemIds.length === 0) {
      throw new Error('content_required')
    }
    if (trimmed.length > 2000) throw new Error('content_too_long')
    if (attachedItemIds.length > 3) throw new Error('attach_item_cap')

    if (trimmed) {
      const safety = checkContent(trimmed, { kind: 'post' })
      if (!safety.ok) throw new Error(`moderation_block:${safety.category}:${safety.reason || ''}`)
      if (isLocalDuplicate('post', trimmed)) throw new Error('duplicate_post')
      const ai = await remoteModerate(trimmed)
      if (ai.flagged) throw new Error(`moderation_block:sensitive_word:ai(${ai.categories.join(',')})`)
      /* mp store review: WeChat's own classifier (no-op on H5). */
      await mpTextGate(trimmed, 3)
    }

    const payloadContent = trimmed || ' '
    const basePayload: Record<string, any> = {
      user_id: currentUser.value.id,
      content: payloadContent,
      images,
    }
    if (extras.image_dimensions && extras.image_dimensions.length) {
      basePayload.image_dimensions = extras.image_dimensions
    }
    if (extras.content_i18n) basePayload.content_i18n = extras.content_i18n
    if (extras.source_lang) basePayload.source_lang = extras.source_lang

    /* Step 1: insert post row. POST_SELECT includes post_items but the
       relation is empty at this point — step 2 backfills it. The pre-014/015
       missing-column (42703) retry-without fallback was retired: every active
       DB has image_dimensions/content_i18n/source_lang, same as useItems. */
    const res = await supabase.from('posts').insert(basePayload).select(POST_SELECT).single()
    if (res.error) throw res.error
    let post = res.data as unknown as Post
    const newId = post.id

    /* Step 2: bulk insert post_items in addition order. RLS enforces
       (post owner AND item owner); BEFORE INSERT trigger enforces 3-cap. */
    let partial = false
    let itemsErr: any = null
    if (attachedItemIds.length > 0) {
      const rows = attachedItemIds.map((item_id, idx) => ({
        post_id: newId,
        item_id,
        display_order: idx,
      }))
      const { error: piErr } = await supabase.from('post_items').insert(rows)
      if (piErr) {
        partial = true
        itemsErr = piErr
        addBreadcrumb({
          category: 'plaza',
          level: 'error',
          message: 'createPost: post created but post_items insert failed',
          data: {
            postId: newId,
            itemCount: attachedItemIds.length,
            err: piErr.message || null,
            code: (piErr as any)?.code || null,
          },
        })
      } else {
        /* Refetch to populate the post_items relation in our local cache,
           ordered by display_order — the insert-time .select returned an
           empty post_items array since rows didn't exist yet. */
        const { data: full } = await supabase
          .from('posts')
          .select(POST_SELECT)
          .order('display_order', { foreignTable: 'post_items', ascending: true })
          .eq('id', newId)
          .single()
        if (full) post = full as unknown as Post
      }
    }

    posts.value = [post, ...posts.value]
    return { id: newId, partial, itemsErr }
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

  async function fetchMyActiveItems(): Promise<Array<Pick<import('../types').Item, 'id' | 'title' | 'title_i18n' | 'price' | 'images' | 'image_dimensions' | 'status' | 'listing_type'>>> {
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

  /* Seller-page 动态 tab — one user's active posts, newest first. Single
     fetch capped at 30: a personal feed rarely exceeds this, and the
     seller page stays pagination-free. */
  async function fetchUserPosts(userId: string): Promise<Post[]> {
    const { data, error } = await supabase
      .from('posts')
      .select(POST_SELECT)
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .order('display_order', { foreignTable: 'post_items', ascending: true })
      .limit(30)
    if (error) throw error
    const result = (data || []) as unknown as Post[]
    result.forEach(stripDeletedItems)
    return result
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
    if (likeInFlight.has(post.id)) return
    likeInFlight.add(post.id)
    const uid = currentUser.value.id
    try {
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
    } finally {
      likeInFlight.delete(post.id)
    }
  }

  async function toggleCommentLike(comment: PostComment) {
    if (!currentUser.value) throw new Error('Not authenticated')
    if (likeInFlight.has(comment.id)) return
    likeInFlight.add(comment.id)
    const uid = currentUser.value.id
    try {
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
    } finally {
      likeInFlight.delete(comment.id)
    }
  }

  async function fetchComments(postId: string): Promise<PostComment[]> {
    // Cap comment load: a viral post could otherwise pull hundreds of
    // rows + a like-membership query over all of them. Oldest-first up
    // to COMMENT_PAGE keeps thread structure intact for the common case.
    const COMMENT_PAGE = 100
    const { data, error } = await supabase
      .from('post_comments')
      .select(`${POST_COMMENT_FIELDS}, profile:profiles!post_comments_user_id_fkey(${PUBLIC_PROFILE_FIELDS})`)
      .eq('post_id', postId)
      .order('created_at', { ascending: true })
      .limit(COMMENT_PAGE)
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
    if (!trimmed) throw new Error('content_required')

    const safety = checkContent(trimmed, { kind: 'comment' })
    if (!safety.ok) throw new Error(`moderation_block:${safety.category}:${safety.reason || ''}`)
    if (isLocalDuplicate(`comment:${postId}`, trimmed)) throw new Error('duplicate_comment')
    const aiComment = await remoteModerate(trimmed)
    if (aiComment.flagged) throw new Error(`moderation_block:sensitive_word:ai(${aiComment.categories.join(',')})`)
    /* mp store review: WeChat's own classifier (no-op on H5). */
    await mpTextGate(trimmed, 2)
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

  /*
   * Release the module-scoped feed so it doesn't survive a page unmount.
   * Mirrors clearItems()/clearMessages() in useItems/useMessages — the
   * plaza feed can grow to many posts (each with images + comments) and
   * was previously retained across navigations for the whole session.
   */
  function clearPosts() {
    posts.value = []
    hasMore.value = true
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
    fetchUserPosts,
    clearPosts,
  }
}
