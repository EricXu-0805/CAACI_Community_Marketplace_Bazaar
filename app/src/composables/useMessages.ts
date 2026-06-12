import { ref } from 'vue'
import { useSupabase } from './useSupabase'
import { useModeration } from './useModeration'
import { useI18n } from './useI18n'
import { subscribeToConversation as subscribeToConversationFallback } from './useRealtimeFallback'
import { MESSAGE_FIELDS } from './useMessages.constants'
import type { Conversation, Message } from '../types'
import { friendlyErrorMessage } from '../utils'
import { checkContent, isLocalDuplicate, remoteModerate } from '../utils/contentSafety'
import { parseStickerToken } from '../components/stickers/registry'

/*
 * Explicit column lists for the two tables we touch here. SELECT '*'
 * is a liability as the schema grows — every new column (migration
 * adds tos_version, flagged_at, etc) starts shipping down the wire
 * even when no UI surface consumes it. Named lists keep payloads lean
 * and make it obvious where to update when a new read dependency lands.
 *
 * MESSAGE_FIELDS lives in ./useMessages.constants to break a Vite
 * chunker cycle with useRealtimeFallback. Re-exported here so external
 * callers keep the single import site.
 */
export { MESSAGE_FIELDS }
export const CONVERSATION_FIELDS =
  'id, item_id, buyer_id, seller_id, last_message_at, created_at, is_pinned_buyer, is_pinned_seller, is_muted_buyer, is_muted_seller' as const

const conversations = ref<Conversation[]>([])
const messages = ref<Message[]>([])
const loading = ref(false)

/*
 * SWR guard for the conversations list. messages/index.vue refetches on
 * every onShow (tab switch), which was a 500ms-1s round-trip each time
 * even when nothing changed. We skip the refetch when the same user's
 * list was loaded within CONVERSATIONS_TTL. Any write that changes the
 * list (sendMessage / deleteConversation) and clearMessages() invalidate
 * it; pull-to-refresh passes { force: true }.
 */
const CONVERSATIONS_TTL = 30_000
let conversationsFetchedAt = 0
let conversationsFetchedFor: string | null = null
// Exported so useUnread's realtime inbox subscription can invalidate the
// list when an INCOMING message arrives — without that hook the SWR guard
// could hide a new message/conversation for up to CONVERSATIONS_TTL.
export function invalidateConversations() {
  conversationsFetchedAt = 0
  conversationsFetchedFor = null
}

export function useMessages() {
  const { supabase } = useSupabase()
  const { t, lang } = useI18n()

  async function fetchConversations(userId: string, opts: { force?: boolean } = {}) {
    if (
      !opts.force &&
      conversationsFetchedFor === userId &&
      conversations.value.length > 0 &&
      Date.now() - conversationsFetchedAt < CONVERSATIONS_TTL
    ) {
      return
    }
    loading.value = true
    try {
      const { data, error } = await supabase
        .from('conversations')
        .select(`${CONVERSATION_FIELDS},
          item:items(id, title, images, price, status, category),
          buyer:profiles!conversations_buyer_id_fkey(id, nickname, avatar_url, is_illini_verified),
          seller:profiles!conversations_seller_id_fkey(id, nickname, avatar_url, is_illini_verified)`)
        .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
        .order('last_message_at', { ascending: false })

      if (error) throw error

      const { blockedIds } = useModeration()
      let convs = (data || []) as unknown as Conversation[]
      if (blockedIds.value.size > 0) {
        convs = convs.filter(c => !blockedIds.value.has(c.buyer_id) && !blockedIds.value.has(c.seller_id))
      }

      convs.sort((a, b) => {
        const aPinned = (a.buyer_id === userId && a.is_pinned_buyer) || (a.seller_id === userId && a.is_pinned_seller)
        const bPinned = (b.buyer_id === userId && b.is_pinned_buyer) || (b.seller_id === userId && b.is_pinned_seller)
        if (aPinned !== bPinned) return aPinned ? -1 : 1
        return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
      })
      if (convs.length > 0) {
        const ids = convs.map(c => c.id)
        const { data: lastMsgs } = await supabase.rpc('get_last_messages', { conv_ids: ids })
        if (lastMsgs) {
          const msgMap = new Map((lastMsgs as any[]).map(m => [m.conversation_id, m]))
          for (const c of convs) {
            const lm = msgMap.get(c.id)
            if (lm) (c as any).last_message_preview = lm.content
            if (lm) (c as any).last_message_type = lm.message_type
          }
        }
      }
      conversations.value = convs
      conversationsFetchedAt = Date.now()
      conversationsFetchedFor = userId
    } catch (error: any) {
      console.error('Failed to fetch conversations:', error)
      uni.showToast({ title: friendlyErrorMessage(error, lang.value as 'en' | 'zh') || t('error.loadFailed'), icon: 'none', duration: 3000 })
    } finally {
      loading.value = false
    }
  }

  // Cap a single conversation load. A long-running thread can hold
  // thousands of rows; loading them all blew up the DOM and memory.
  // Fetch the most-recent MESSAGE_PAGE descending, then flip to
  // chronological for render (older history is rarely scrolled to in
  // a marketplace chat; a "load earlier" affordance can come later).
  const MESSAGE_PAGE = 200

  async function fetchMessages(conversationId: string) {
    messages.value = []
    const { data, error } = await supabase
      .from('messages')
      .select(`${MESSAGE_FIELDS}, sender:profiles(id, nickname, avatar_url)`)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(MESSAGE_PAGE)

    if (error) throw error
    /* PostgREST embed 'sender:profiles(...)' resolves to a single row via
       the FK, but TS can't narrow that from our template-literal select —
       the as-unknown hop matches the pattern already used by fetchConversations. */
    messages.value = ((data || []) as unknown as Message[]).reverse()
  }

  function clearMessages() {
    conversations.value = []
    messages.value = []
    invalidateConversations()
  }

  async function sendMessage(conversationId: string, senderId: string, content: string, type: import('../types').MessageType = 'text') {
    if (type === 'text' && content.length > 2000) throw new Error('message_too_long')

    // App-generated sticker tokens skip the prose guards (the DB trigger
    // whitelists them too, migration 049) — no point spending an OpenAI
    // moderation call on '[sticker:smile]'.
    const isSticker = type === 'text' && parseStickerToken(content) !== null

    if (type === 'text' && !isSticker) {
      const safety = checkContent(content, { kind: 'message', allowLinks: false })
      if (!safety.ok) throw new Error(`moderation_block:${safety.category}:${safety.reason || ''}`)
      if (isLocalDuplicate(`msg:${conversationId}`, content)) throw new Error('duplicate_message')
      const ai = await remoteModerate(content)
      if (ai.flagged) throw new Error(`moderation_block:sensitive_word:ai(${ai.categories.join(',')})`)
    }

    const { data, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_id: senderId,
        content,
        message_type: type,
      })
      .select(MESSAGE_FIELDS)
      .single()

    if (error) throw error

    // The list's last-message preview + sort order just changed; force a
    // fresh fetch next time the conversations tab is shown.
    invalidateConversations()

    /*
     * No client-side conversations.last_message_at UPDATE here:
     * migration 003 installed the bump_conversation_last_message
     * trigger on messages AFTER INSERT, so the server keeps it in
     * sync. Doing it from the client too was a redundant RTT and
     * a race (client clock skew vs trigger NOW() — whoever lands
     * second wins, which on a slow phone could be the client and
     * give wrong sort order in the conversations list).
     */
    return data as Message
  }

  async function getOrCreateConversation(itemId: string, buyerId: string, sellerId: string) {
    const { data: existing, error: findErr } = await supabase
      .from('conversations')
      .select(CONVERSATION_FIELDS)
      .eq('item_id', itemId)
      .eq('buyer_id', buyerId)
      .eq('seller_id', sellerId)
      .maybeSingle()

    if (findErr) throw findErr
    if (existing) return existing as Conversation

    const { data, error } = await supabase
      .from('conversations')
      .insert({ item_id: itemId, buyer_id: buyerId, seller_id: sellerId })
      .select(CONVERSATION_FIELDS)
      .single()

    if (error) throw error
    return data as Conversation
  }

  function subscribeToMessages(conversationId: string, onNewMessage: (msg: Message) => void) {
    /* Platform-aware: H5 uses Supabase Realtime (WebSocket); mp targets
       use polling because their uni.connectSocket doesn't speak the
       Phoenix channel protocol. See useRealtimeFallback for details. */
    return subscribeToConversationFallback(conversationId, (m) => onNewMessage(m as Message))
  }

  async function markAsRead(conversationId: string, userId: string) {
    const { error } = await supabase
      .from('messages')
      .update({ is_read: true })
      .eq('conversation_id', conversationId)
      .neq('sender_id', userId)
      .eq('is_read', false)

    if (error) {
      console.error('markAsRead failed:', error.message)
      throw error
    }
  }

  async function deleteMessage(messageId: string) {
    const { error } = await supabase
      .from('messages')
      .delete()
      .eq('id', messageId)
    if (error) throw error
    messages.value = messages.value.filter(m => m.id !== messageId)
  }

  async function deleteConversation(conversationId: string) {
    const { error } = await supabase
      .from('conversations')
      .delete()
      .eq('id', conversationId)

    if (error) throw error
    conversations.value = conversations.value.filter(c => c.id !== conversationId)
    invalidateConversations()
  }

  async function fetchConversationDetail(conversationId: string) {
    const { data, error } = await supabase
      .from('conversations')
      .select(`${CONVERSATION_FIELDS},
        item:items(id, title, images, price, status, negotiable, user_id, category, listing_type),
        buyer:profiles!conversations_buyer_id_fkey(id, nickname, avatar_url),
        seller:profiles!conversations_seller_id_fkey(id, nickname, avatar_url)`)
      .eq('id', conversationId)
      .single()

    if (error) throw error
    return data as unknown as Conversation
  }

  async function setConversationPinned(conv: Conversation, userId: string, pinned: boolean) {
    const field = conv.buyer_id === userId ? 'is_pinned_buyer' : 'is_pinned_seller'
    const { error } = await supabase
      .from('conversations')
      .update({ [field]: pinned })
      .eq('id', conv.id)
    if (error) throw error
    ;(conv as any)[field] = pinned
    // Pin state drives list sort order; callers re-fetch to re-sort, so the
    // SWR guard must not short-circuit that fetch.
    invalidateConversations()
  }

  async function setConversationMuted(conv: Conversation, userId: string, muted: boolean) {
    const field = conv.buyer_id === userId ? 'is_muted_buyer' : 'is_muted_seller'
    const { error } = await supabase
      .from('conversations')
      .update({ [field]: muted })
      .eq('id', conv.id)
    if (error) throw error
    ;(conv as any)[field] = muted
    invalidateConversations()
  }

  async function markConversationUnread(conversationId: string, userId: string) {
    const { data: lastMsg } = await supabase
      .from('messages')
      .select('id')
      .eq('conversation_id', conversationId)
      .neq('sender_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (lastMsg) {
      const { error } = await supabase
        .from('messages')
        .update({ is_read: false })
        .eq('id', lastMsg.id)
      if (error) throw error
    }
  }

  return {
    conversations,
    messages,
    loading,
    fetchConversations,
    fetchMessages,
    sendMessage,
    getOrCreateConversation,
    subscribeToMessages,
    markAsRead,
    markConversationUnread,
    deleteConversation,
    deleteMessage,
    fetchConversationDetail,
    setConversationPinned,
    setConversationMuted,
    clearMessages,
  }
}
