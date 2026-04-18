import { ref } from 'vue'
import { useSupabase } from './useSupabase'
import { useAuth } from './useAuth'
import { useModeration } from './useModeration'
import type { Post, PostComment } from '../types'

const posts = ref<Post[]>([])
const loading = ref(false)
const hasMore = ref(true)
const PAGE_SIZE = 20
const PUBLIC_PROFILE_FIELDS = 'id, nickname, avatar_url, is_illini_verified, uid'

export function usePlaza() {
  const { supabase } = useSupabase()
  const { currentUser } = useAuth()

  async function fetchPosts(options: { page?: number; reset?: boolean } = {}) {
    const { page = 0, reset = false } = options
    if (reset) {
      posts.value = []
      hasMore.value = true
    }
    loading.value = true
    try {
      const { data, error } = await supabase
        .from('posts')
        .select(`*, profile:profiles(${PUBLIC_PROFILE_FIELDS})`)
        .eq('status', 'active')
        .order('is_pinned', { ascending: false })
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

      if (error) throw error

      let result = (data || []) as Post[]

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
      uni.showToast({ title: err?.message || 'Failed to load plaza', icon: 'none', duration: 3000 })
    } finally {
      loading.value = false
    }
  }

  async function createPost(content: string, images: string[] = []) {
    if (!currentUser.value) throw new Error('Not authenticated')
    const trimmed = content.trim()
    if (!trimmed && images.length === 0) throw new Error('Content required')
    if (trimmed.length > 2000) throw new Error('Content too long')

    const payloadContent = trimmed || ' '
    const { data, error } = await supabase
      .from('posts')
      .insert({
        user_id: currentUser.value.id,
        content: payloadContent,
        images,
      })
      .select(`*, profile:profiles(${PUBLIC_PROFILE_FIELDS})`)
      .single()

    if (error) throw error
    posts.value = [data as Post, ...posts.value]
    return data as Post
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

  async function fetchComments(postId: string): Promise<PostComment[]> {
    const { data, error } = await supabase
      .from('post_comments')
      .select(`*, profile:profiles(${PUBLIC_PROFILE_FIELDS})`)
      .eq('post_id', postId)
      .order('created_at', { ascending: true })
    if (error) throw error
    return (data || []) as PostComment[]
  }

  async function createComment(postId: string, content: string, parentId?: string): Promise<PostComment> {
    if (!currentUser.value) throw new Error('Not authenticated')
    const trimmed = content.trim()
    if (!trimmed) throw new Error('Content required')
    const { data, error } = await supabase
      .from('post_comments')
      .insert({
        post_id: postId,
        user_id: currentUser.value.id,
        content: trimmed,
        parent_comment_id: parentId || null,
      })
      .select(`*, profile:profiles(${PUBLIC_PROFILE_FIELDS})`)
      .single()
    if (error) throw error
    const post = posts.value.find(p => p.id === postId)
    if (post) post.comment_count += 1
    return data as PostComment
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
    createPost,
    deletePost,
    toggleLike,
    fetchComments,
    createComment,
    deleteComment,
  }
}
