import { ref, type Ref } from 'vue'
import { startPrivateRealtimeChannel } from '../api/privateRealtime'
import { useSupabase } from './useSupabase'

/*
 * Conversation-scoped Presence + typing.
 *
 * There is deliberately no process-wide user-directory room. Opening a chat
 * reveals only whether that conversation's expected counterpart is currently
 * in the same private `conversation:<uuid>` channel. Typing uses Broadcast on
 * that same channel. Both features remain H5-only and best-effort; an auth,
 * RLS, socket, account-switch, or payload failure degrades to offline/no typing
 * and never opens a public channel.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface ConversationPresenceApi {
  peerOnline: Ref<boolean>
  sendTyping: () => void
  unsubscribe: () => void
}

function inactivePresence(): ConversationPresenceApi {
  return {
    peerOnline: ref(false),
    sendTyping: () => {},
    unsubscribe: () => {},
  }
}

export function usePresence() {
  const { supabase } = useSupabase()

  function subscribeConversationPresence(
    conversationId: string,
    expectedPeerId: string,
    onPeerTyping: () => void,
    onPeerOnline: (online: boolean) => void = () => {},
  ): ConversationPresenceApi {
    // #ifdef H5
    if (!UUID_RE.test(conversationId) || !UUID_RE.test(expectedPeerId)) {
      return inactivePresence()
    }

    const peerOnline = ref(false)
    let channel: any = null
    let ownUserId = ''
    let isCurrentAccount = () => false
    let subscribed = false
    let lastSentAt = 0
    const setPeerOnline = (online: boolean) => {
      if (peerOnline.value === online) return
      peerOnline.value = online
      try { onPeerOnline(online) } catch { /* presentation callback is isolated */ }
    }

    const unsubscribe = startPrivateRealtimeChannel({
      supabase,
      topic: `conversation:${conversationId.toLowerCase()}`,
      config: (context) => ({
        presence: { key: context.userId },
        broadcast: { self: false, ack: true },
      }),
      configure: (privateChannel, context) => {
        // Bind the Presence key only after the session/account guard has been
        // established; a caller cannot supply a peer or third-party key.
        ownUserId = context.userId
        isCurrentAccount = context.isCurrent
        channel = privateChannel
        return privateChannel
          .on('presence', { event: 'sync' }, () => {
            if (!context.isCurrent()) return
            try {
              const state = privateChannel.presenceState() as Record<string, unknown>
              const peerEntries = state?.[expectedPeerId]
              setPeerOnline(Array.isArray(peerEntries) && peerEntries.some(entry => (
                !!entry
                && typeof entry === 'object'
                && (entry as { user_id?: unknown }).user_id === expectedPeerId
              )))
            } catch {
              setPeerOnline(false)
            }
          })
          .on('broadcast', { event: 'typing' }, (message: any) => {
            if (!context.isCurrent()) return
            const payload = message?.payload
            if (
              payload?.conversation_id !== conversationId
              || payload?.user_id !== expectedPeerId
            ) return
            try { onPeerTyping() } catch { /* presentation callback is isolated */ }
          })
      },
      onStatus: (status) => {
        if (status === 'SUBSCRIBED' && channel) {
          subscribed = true
          try {
            void Promise.resolve(channel.track({
              user_id: ownUserId,
              online_at: Date.now(),
            })).catch(() => { setPeerOnline(false) })
          } catch {
            setPeerOnline(false)
          }
          return
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          subscribed = false
          setPeerOnline(false)
        }
      },
      onClose: () => {
        subscribed = false
        channel = null
        ownUserId = ''
        isCurrentAccount = () => false
        setPeerOnline(false)
      },
    })

    return {
      peerOnline,
      sendTyping: () => {
        if (!subscribed || !channel || !isCurrentAccount()) return
        const now = Date.now()
        if (now - lastSentAt < 1500) return
        lastSentAt = now
        try {
          void Promise.resolve(channel.send({
            type: 'broadcast',
            event: 'typing',
            payload: {
              conversation_id: conversationId,
              user_id: ownUserId,
            },
          })).catch(() => {})
        } catch { /* typing is best-effort */ }
      },
      unsubscribe: () => {
        subscribed = false
        setPeerOnline(false)
        channel = null
        ownUserId = ''
        unsubscribe()
      },
    }
    // #endif
    // #ifndef H5
    return inactivePresence()
    // #endif
  }

  return { subscribeConversationPresence }
}
