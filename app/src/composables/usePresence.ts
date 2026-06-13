import { ref, watch } from 'vue'
import { useSupabase } from './useSupabase'
import { useAuth } from './useAuth'

/*
 * Online presence + typing indicators (v5 Phase 7).
 *
 * Two independent realtime surfaces, both H5-only and strictly best-effort
 * (mp-weixin can't speak the Phoenix channel protocol; realtime is a known
 * weak link per the project notes). Everything degrades silently to "no
 * dot / no typing" — presence never blocks or errors a screen.
 *
 *   · Presence — one shared `online-users` channel keyed by user id. The
 *     messages list and chat header read `onlineUsers` to show a green dot
 *     / "在线" label. Module-scoped so a single channel serves the session.
 *   · Typing — a per-conversation broadcast channel; the chat input pings
 *     it (throttled) and the peer shows a transient "正在输入…".
 */
const onlineUsers = ref<Set<string>>(new Set())
let presenceChannel: any = null
// Register the identity watcher exactly once for the session (mirrors the
// bootstrapped guard in useNotifications), so reading presence from N
// components doesn't stack N watchers.
let presenceWatchBootstrapped = false

export function usePresence() {
  const { supabase } = useSupabase()
  const { currentUser } = useAuth()

  // The presence channel is module-scoped and keyed to a uid, so on sign-out
  // (currentUser → null) or an account switch the stale channel must be torn
  // down — otherwise startPresence()'s `if (presenceChannel) return` guard
  // skips re-subscribing and the next user shows offline to everyone for the
  // rest of the JS session (uni.reLaunch on H5 is SPA nav, not a hard reload).
  if (!presenceWatchBootstrapped) {
    presenceWatchBootstrapped = true
    watch(currentUser, (u, prev) => {
      if (prev?.id && u?.id !== prev.id) {
        stopPresence()
        if (u) startPresence()
      }
    })
  }

  function startPresence() {
    // #ifdef H5
    if (presenceChannel || !currentUser.value) return
    const uid = currentUser.value.id
    presenceChannel = supabase.channel('online-users', { config: { presence: { key: uid } } })
    presenceChannel
      .on('presence', { event: 'sync' }, () => {
        try {
          const state = presenceChannel.presenceState()
          onlineUsers.value = new Set(Object.keys(state))
        } catch { /* ignore malformed state */ }
      })
      .subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          try { presenceChannel.track({ online_at: Date.now() }) } catch { /* ignore */ }
        }
      })
    // #endif
  }

  function stopPresence() {
    // #ifdef H5
    if (presenceChannel) {
      try { supabase.removeChannel(presenceChannel) } catch { /* already gone */ }
      presenceChannel = null
      onlineUsers.value = new Set()
    }
    // #endif
  }

  function isOnline(userId: string | undefined | null): boolean {
    return !!userId && onlineUsers.value.has(userId)
  }

  function subscribeTyping(
    conversationId: string,
    onPeerTyping: (userId: string) => void,
  ): { sendTyping: () => void; unsubscribe: () => void } {
    // #ifdef H5
    const ch = supabase.channel(`typing:${conversationId}`)
    ch.on('broadcast', { event: 'typing' }, (payload: any) => {
      const uid = payload?.payload?.user_id
      if (uid && uid !== currentUser.value?.id) onPeerTyping(uid)
    }).subscribe()
    let lastSent = 0
    function sendTyping() {
      const now = Date.now()
      if (now - lastSent < 1500) return // throttle — one ping per 1.5s
      lastSent = now
      try {
        ch.send({ type: 'broadcast', event: 'typing', payload: { user_id: currentUser.value?.id } })
      } catch { /* best-effort */ }
    }
    return {
      sendTyping,
      unsubscribe: () => { try { supabase.removeChannel(ch) } catch { /* already gone */ } },
    }
    // #endif
    // #ifndef H5
    return { sendTyping: () => {}, unsubscribe: () => {} }
    // #endif
  }

  return { onlineUsers, startPresence, stopPresence, isOnline, subscribeTyping }
}
