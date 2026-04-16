import { ref } from 'vue'
import { useSupabase } from './useSupabase'
import type { Conversation, Message } from '../types'

const conversations = ref<Conversation[]>([])
const messages = ref<Message[]>([])
const loading = ref(false)

export function useMessages() {
  const { supabase } = useSupabase()

  async function fetchConversations(userId: string) {
    loading.value = true
    try {
      const { data, error } = await supabase
        .from('conversations')
        .select(`
          *,
          item:items(id, title, images, price),
          buyer:profiles!conversations_buyer_id_fkey(id, nickname, avatar_url),
          seller:profiles!conversations_seller_id_fkey(id, nickname, avatar_url)
        `)
        .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
        .order('last_message_at', { ascending: false })

      if (error) throw error

      const convs = (data || []) as Conversation[]
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
    } catch (error) {
      console.error('Failed to fetch conversations:', error)
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

    await supabase
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversationId)

    return data as Message
  }

  async function getOrCreateConversation(itemId: string, buyerId: string, sellerId: string) {
    const { data: existing } = await supabase
      .from('conversations')
      .select('*')
      .eq('item_id', itemId)
      .eq('buyer_id', buyerId)
      .eq('seller_id', sellerId)
      .single()

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
    await supabase
      .from('messages')
      .update({ is_read: true })
      .eq('conversation_id', conversationId)
      .neq('sender_id', userId)
      .eq('is_read', false)
  }

  async function fetchConversationDetail(conversationId: string) {
    const { data, error } = await supabase
      .from('conversations')
      .select(`
        *,
        item:items(id, title, images, price),
        buyer:profiles!conversations_buyer_id_fkey(id, nickname, avatar_url),
        seller:profiles!conversations_seller_id_fkey(id, nickname, avatar_url)
      `)
      .eq('id', conversationId)
      .single()

    if (error) throw error
    return data as Conversation
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
    fetchConversationDetail,
    clearMessages,
  }
}
