import { ref } from 'vue'
import { useSupabase } from './useSupabase'
import { useModeration } from './useModeration'
import { useI18n } from './useI18n'
import type { Conversation, Message } from '../types'
import { checkContent, isLocalDuplicate, remoteModerate } from '../utils/contentSafety'

const conversations = ref<Conversation[]>([])
const messages = ref<Message[]>([])
const loading = ref(false)

export function useMessages() {
  const { supabase } = useSupabase()
  const { t } = useI18n()

  async function fetchConversations(userId: string) {
    loading.value = true
    try {
      const { data, error } = await supabase
        .from('conversations')
        .select(`
          id, item_id, buyer_id, seller_id, last_message_at, created_at,
          is_pinned_buyer, is_pinned_seller, is_muted_buyer, is_muted_seller,
          item:items(id, title, images, price, status, category),
          buyer:profiles!conversations_buyer_id_fkey(id, nickname, avatar_url, is_illini_verified),
          seller:profiles!conversations_seller_id_fkey(id, nickname, avatar_url, is_illini_verified)
        `)
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
    } catch (error: any) {
      console.error('Failed to fetch conversations:', error)
      uni.showToast({ title: error?.message || t('error.loadFailed'), icon: 'none', duration: 3000 })
    } finally {
      loading.value = false
    }
  }

  async function fetchMessages(conversationId: string) {
    messages.value = []
    const { data, error } = await supabase
      .from('messages')
      .select('*, sender:profiles(id, nickname, avatar_url)')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })

    if (error) throw error
    messages.value = (data || []) as Message[]
  }

  function clearMessages() {
    conversations.value = []
    messages.value = []
  }

  async function sendMessage(conversationId: string, senderId: string, content: string, type: 'text' | 'image' = 'text') {
    if (type === 'text' && content.length > 2000) throw new Error('Message too long')

    if (type === 'text') {
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
      .select()
      .single()

    if (error) throw error

    const { error: convUpdateError } = await supabase
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversationId)
    if (convUpdateError) console.warn('conversation last_message_at update failed:', convUpdateError.message)

    return data as Message
  }

  async function getOrCreateConversation(itemId: string, buyerId: string, sellerId: string) {
    const { data: existing, error: findErr } = await supabase
      .from('conversations')
      .select('*')
      .eq('item_id', itemId)
      .eq('buyer_id', buyerId)
      .eq('seller_id', sellerId)
      .maybeSingle()

    if (findErr) throw findErr
    if (existing) return existing as Conversation

    const { data, error } = await supabase
      .from('conversations')
      .insert({ item_id: itemId, buyer_id: buyerId, seller_id: sellerId })
      .select()
      .single()

    if (error) throw error
    return data as Conversation
  }

  function subscribeToMessages(conversationId: string, onNewMessage: (msg: Message) => void) {
    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          onNewMessage(payload.new as Message)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
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
  }

  async function fetchConversationDetail(conversationId: string) {
    const { data, error } = await supabase
      .from('conversations')
      .select(`
        *,
        item:items(id, title, images, price, status, negotiable, user_id, category),
        buyer:profiles!conversations_buyer_id_fkey(id, nickname, avatar_url),
        seller:profiles!conversations_seller_id_fkey(id, nickname, avatar_url)
      `)
      .eq('id', conversationId)
      .single()

    if (error) throw error
    return data as Conversation
  }

  async function setConversationPinned(conv: Conversation, userId: string, pinned: boolean) {
    const field = conv.buyer_id === userId ? 'is_pinned_buyer' : 'is_pinned_seller'
    const { error } = await supabase
      .from('conversations')
      .update({ [field]: pinned })
      .eq('id', conv.id)
    if (error) throw error
    ;(conv as any)[field] = pinned
  }

  async function setConversationMuted(conv: Conversation, userId: string, muted: boolean) {
    const field = conv.buyer_id === userId ? 'is_muted_buyer' : 'is_muted_seller'
    const { error } = await supabase
      .from('conversations')
      .update({ [field]: muted })
      .eq('id', conv.id)
    if (error) throw error
    ;(conv as any)[field] = muted
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
