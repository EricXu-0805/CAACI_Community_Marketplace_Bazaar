import { useSupabase } from './useSupabase'

/*
 * Realtime abstraction that falls back to polling when Supabase's
 * Phoenix channel handshake is unavailable — specifically on WeChat
 * mini-program (mp-weixin), which supports uni.connectSocket but NOT
 * the Phoenix protocol that @supabase/realtime-js speaks. The same
 * is true for the other non-H5 mp adapters.
 *
 * Strategy: on H5 use real channels (existing behavior); on every mp
 * target, return a polling loop with identical (subscribe, unsub)
 * ergonomics. Call sites stay platform-agnostic.
 *
 * Polling cadence is intentionally conservative:
 *   · per-conversation message feed    → 3s
 *   · global unread + toast            → 10s
 * Short-polling is fine on mp because mini-program pages sleep when
 * backgrounded, so polling auto-pauses. The client also stops the
 * timer when the subscription is torn down.
 */

type Unsubscribe = () => void

function isRealtimeSupported(): boolean {
  // #ifdef H5
  return true
  // #endif
  // #ifndef H5
  return false
  // #endif
}

interface PollOptions<T> {
  intervalMs: number
  run: () => Promise<T>
  onSuccess?: (result: T) => void
  onError?: (err: unknown) => void
}

function startPoll<T>(opts: PollOptions<T>): Unsubscribe {
  let alive = true
  let timer: ReturnType<typeof setTimeout> | null = null

  async function tick() {
    if (!alive) return
    try {
      const v = await opts.run()
      if (alive && opts.onSuccess) opts.onSuccess(v)
    } catch (e) {
      if (alive && opts.onError) opts.onError(e)
    } finally {
      if (alive) timer = setTimeout(tick, opts.intervalMs)
    }
  }

  tick()

  return () => {
    alive = false
    if (timer) { clearTimeout(timer); timer = null }
  }
}

export function subscribeToConversation(
  conversationId: string,
  onNewMessage: (msg: any) => void,
): Unsubscribe {
  const { supabase } = useSupabase()

  if (isRealtimeSupported()) {
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
        (payload) => onNewMessage(payload.new),
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }

  /* Polling fallback — remember the last seen row and ask for newer ones
     each tick. Using created_at > $last_seen is simpler than tracking
     ids because messages are append-only and created_at carries a
     monotonic server clock. */
  let lastSeen: string | null = null

  return startPoll({
    intervalMs: 3000,
    run: async () => {
      const q = supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(50)

      if (lastSeen) q.gt('created_at', lastSeen)

      const { data, error } = await q
      if (error) throw error
      return data || []
    },
    onSuccess: (rows: any[]) => {
      if (!rows.length) return
      for (const row of rows) onNewMessage(row)
      lastSeen = rows[rows.length - 1].created_at
    },
    onError: () => { /* swallow transient errors; next tick retries */ },
  })
}

export function subscribeToUserInbox(
  userId: string,
  onNewMessage: (msg: any) => void,
): Unsubscribe {
  const { supabase } = useSupabase()

  if (isRealtimeSupported()) {
    const channel = supabase
      .channel(`user-${userId}-new-messages`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `sender_id=neq.${userId}`,
        },
        (payload) => onNewMessage(payload.new),
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }

  let lastSeen: string | null = null

  return startPoll({
    intervalMs: 10000,
    run: async () => {
      const q = supabase
        .from('messages')
        .select('id, conversation_id, sender_id, created_at')
        .neq('sender_id', userId)
        .order('created_at', { ascending: true })
        .limit(25)

      if (lastSeen) q.gt('created_at', lastSeen)

      const { data, error } = await q
      if (error) throw error
      return data || []
    },
    onSuccess: (rows: any[]) => {
      if (!rows.length) return
      for (const row of rows) onNewMessage(row)
      lastSeen = rows[rows.length - 1].created_at
    },
    onError: () => { /* swallow transient errors; next tick retries */ },
  })
}
