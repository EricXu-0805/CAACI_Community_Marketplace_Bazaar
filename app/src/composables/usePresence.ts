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
const PRESENCE_TRACK_RETRY_LIMIT = 3
const PRESENCE_TRACK_RETRY_MS = 1500

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
    let trackReady = false
    let trackGeneration = 0
    let trackAttempts = 0
    let trackRetryTimer: ReturnType<typeof setTimeout> | null = null
    let lastSentAt = 0
    let transportUnsubscribe: () => void = () => {}
    let stopBrowserLifecycle = () => {}
    const setPeerOnline = (online: boolean) => {
      if (peerOnline.value === online) return
      peerOnline.value = online
      try { onPeerOnline(online) } catch { /* presentation callback is isolated */ }
    }
    const clearTrackRetry = () => {
      if (!trackRetryTimer) return
      clearTimeout(trackRetryTimer)
      trackRetryTimer = null
    }
    const syncPeerFromState = (trackedChannel: any) => {
      try {
        const state = trackedChannel.presenceState() as Record<string, unknown>
        const peerEntries = state?.[expectedPeerId]
        setPeerOnline(Array.isArray(peerEntries) && peerEntries.some(entry => (
          !!entry
          && typeof entry === 'object'
          && (entry as { user_id?: unknown }).user_id === expectedPeerId
        )))
      } catch {
        setPeerOnline(false)
      }
    }
    const invalidateTrack = () => {
      clearTrackRetry()
      trackGeneration += 1
      trackAttempts = 0
      trackReady = false
      setPeerOnline(false)
    }
    const attemptTrack = () => {
      if (
        !subscribed
        || trackReady
        || !channel
        || !isCurrentAccount()
        || trackAttempts >= PRESENCE_TRACK_RETRY_LIMIT
      ) return

      clearTrackRetry()
      const trackedChannel = channel
      const trackedAccountIsCurrent = isCurrentAccount
      const generation = ++trackGeneration
      trackAttempts += 1
      const isCurrentTrack = () => (
        subscribed
        && channel === trackedChannel
        && generation === trackGeneration
        && trackedAccountIsCurrent()
      )
      const failCurrentTrack = () => {
        if (!isCurrentTrack()) return
        trackReady = false
        setPeerOnline(false)
        if (trackAttempts >= PRESENCE_TRACK_RETRY_LIMIT) return
        trackRetryTimer = setTimeout(() => {
          trackRetryTimer = null
          if (isCurrentTrack()) attemptTrack()
        }, PRESENCE_TRACK_RETRY_MS)
      }

      let result: unknown
      try {
        result = trackedChannel.track({
          user_id: ownUserId,
          online_at: Date.now(),
        })
      } catch {
        failCurrentTrack()
        return
      }
      void Promise.resolve(result).then(
        (response) => {
          if (!isCurrentTrack()) return
          // RealtimeChannel.track() resolves transport failures as the string
          // statuses "timed out" or "error"; it does not reject them.
          if (response !== 'ok') {
            failCurrentTrack()
            return
          }
          trackReady = true
          syncPeerFromState(trackedChannel)
        },
        failCurrentTrack,
      )
    }

    const stopPresenceTransport = () => {
      stopBrowserLifecycle()
      stopBrowserLifecycle = () => {}
      subscribed = false
      invalidateTrack()
      channel = null
      ownUserId = ''
      isCurrentAccount = () => false
      const stopTransport = transportUnsubscribe
      transportUnsubscribe = () => {}
      stopTransport()
    }

    transportUnsubscribe = startPrivateRealtimeChannel({
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
            if (!context.isCurrent() || !subscribed || !trackReady) return
            syncPeerFromState(privateChannel)
          })
          .on('broadcast', { event: 'typing' }, (message: any) => {
            if (!context.isCurrent() || !subscribed || !trackReady) return
            const payload = message?.payload
            if (
              payload?.conversation_id !== conversationId
              || payload?.user_id !== expectedPeerId
            ) return
            try { onPeerTyping() } catch { /* presentation callback is isolated */ }
          })
      },
      onStatus: (status) => {
        if (status === 'SUBSCRIBED' && channel && !subscribed) {
          subscribed = true
          trackAttempts = 0
          trackReady = false
          attemptTrack()
          return
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          subscribed = false
          invalidateTrack()
        }
      },
      onClose: () => {
        stopBrowserLifecycle()
        stopBrowserLifecycle = () => {}
        subscribed = false
        invalidateTrack()
        channel = null
        ownUserId = ''
        isCurrentAccount = () => false
      },
    })

    // A backgrounded browser may resume with a stale socket without emitting
    // CHANNEL_ERROR/TIMED_OUT/CLOSED. Presence has no polling substitute, so
    // fail closed to offline/no-op for this mount and let the next legal mount
    // establish a fresh private channel.
    let observedHidden = typeof document !== 'undefined'
      && document.visibilityState !== 'visible'
    const onVisibilityChange = () => {
      if (typeof document === 'undefined') return
      if (document.visibilityState === 'hidden') {
        observedHidden = true
        return
      }
      if (document.visibilityState === 'visible' && observedHidden) {
        observedHidden = false
        stopPresenceTransport()
      }
    }
    const onOffline = () => stopPresenceTransport()
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange)
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('offline', onOffline)
    }
    stopBrowserLifecycle = () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange)
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('offline', onOffline)
      }
    }

    return {
      peerOnline,
      sendTyping: () => {
        if (!subscribed || !trackReady || !channel || !isCurrentAccount()) return
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
        stopPresenceTransport()
      },
    }
    // #endif
    // #ifndef H5
    return inactivePresence()
    // #endif
  }

  return { subscribeConversationPresence }
}
