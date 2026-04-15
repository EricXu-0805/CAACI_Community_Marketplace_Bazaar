import { ref } from 'vue'
import { useSupabase } from './useSupabase'
import type { Conversation, Message } from '../types'

export function useMessages() {
  const { supabase } = useSupabase()
  const conversations = ref<Conversation[]>([])
  const messages = ref<Message[]>([])
  const loading = ref(false)

  // Fetch all conversations for current user
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
      conversations.value = (data || []) as Conversation[]
    } catch (error) {
      console.error('Failed to fetch conversations:', error)
    } finally {
      loading.value = false
    }
  }

  // Fetch messages for a conversation
  async function fetchMessages(conversationId: string) {
    const { data, error } = await supabase
      .from('messages')
      .select('*, sender:profiles(id, nickname, avatar_url)')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })

    if (error) throw error
    messages.value = (data || []) as Message[]
  }

  // Send a message
  async function sendMessage(conversationId: string, senderId: string, content: string) {
    const { data, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_id: senderId,
        content,
        message_type: 'text',
      })
      .select()
      .single()

    if (error) throw error

    // Update conversation's last_message_at
    await supabase
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversationId)

    return data as Message
  }

  // Create or get existing conversation
  async function getOrCreateConversation(itemId: string, buyerId: string, sellerId: string) {
    // Check if conversation exists
    const { data: existing } = await supabase
      .from('conversations')
      .select('*')
      .eq('item_id', itemId)
      .eq('buyer_id', buyerId)
      .eq('seller_id', sellerId)
      .single()

    if (existing) return existing as Conversation

    // Create new conversation
    const { data, error } = await supabase
      .from('conversations')
      .insert({ item_id: itemId, buyer_id: buyerId, seller_id: sellerId })
      .select()
      .single()

    if (error) throw error
    return data as Conversation
  }

  // Subscribe to new messages in a conversation (realtime)
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

  // Mark messages as read
  async function markAsRead(conversationId: string, userId: string) {
    await supabase
      .from('messages')
      .update({ is_read: true })
      .eq('conversation_id', conversationId)
      .neq('sender_id', userId)
      .eq('is_read', false)
  }

  // Fetch conversation detail (for chat header context)
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
  }
}
