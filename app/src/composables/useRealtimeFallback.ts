import { useSupabase } from './useSupabase'
import { MESSAGE_FIELDS } from './useMessages'

/*
 * Realtime abstraction with three tiers:
 *
 *   H5                   → Supabase channel (Phoenix over WebSocket)
 *   mp + long-poll ok    → /api/realtime-poll (~1s server-side tick)
 *   mp + long-poll down  → direct PostgREST poll (3-10s client tick)
 *
 * Phoenix channels don't work on mp because uni.connectSocket can't
 * round-trip the channel handshake. Long-poll is an opt-in upgrade
 * of the plain polling path: same (subscribe, unsub) surface, better
 * latency, graceful fallback if the edge endpoint 5xx's or CORS's
 * or isn't deployed yet.
 *
 * Polling cadence (only used when long-poll is unavailable):
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

function longPollBase(): string {
  // #ifdef H5
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin + '/api/realtime-poll'
  }
  // #endif
  return 'https://caaci-community-marketplace-bazaar.vercel.app/api/realtime-poll'
}

/* Circuit breaker: if long-poll fails twice in a row, skip it for
   this session and fall back to direct PostgREST polling. Prevents
   a broken edge deploy from blocking chat entirely. */
let longPollStrikes = 0
const LONG_POLL_CIRCUIT_LIMIT = 2

function longPollEnabled(): boolean {
  return longPollStrikes < LONG_POLL_CIRCUIT_LIMIT
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

interface LongPollOptions {
  scope: 'conversation' | 'inbox'
  id: string
  onRows: (rows: any[]) => void
}

function startLongPoll(opts: LongPollOptions): Unsubscribe {
  const { supabase } = useSupabase()
  let alive = true
  let sinceCursor: string | null = null

  async function tick(): Promise<void> {
    if (!alive) return
    try {
      const { data: sess } = await supabase.auth.getSession()
      const jwt = sess.session?.access_token
      const url = new URL(longPollBase())
      url.searchParams.set('scope', opts.scope)
      url.searchParams.set('id', opts.id)
      if (sinceCursor) url.searchParams.set('since', sinceCursor)

      const ctrl = new AbortController()
      /* Slightly longer than the edge function's 20s hold so the edge
         gets a chance to return its final {rows:[]} before we abort. */
      const abortTimer = setTimeout(() => ctrl.abort(), 28000)
      const r = await fetch(url.toString(), {
        method: 'GET',
        headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
        signal: ctrl.signal,
      })
      clearTimeout(abortTimer)

      if (!r.ok) {
        longPollStrikes++
        if (alive && !longPollEnabled()) return
        if (alive) setTimeout(tick, 1000)
        return
      }

      longPollStrikes = 0
      const body = await r.json().catch(() => ({}))
      const rows = Array.isArray(body?.rows) ? body.rows : []
      if (rows.length > 0) {
        opts.onRows(rows)
        sinceCursor = body?.next_since || rows[rows.length - 1]?.created_at || sinceCursor
      } else if (body?.next_since) {
        sinceCursor = body.next_since
      }
      if (alive) setTimeout(tick, 50)
    } catch {
      longPollStrikes++
      if (alive && longPollEnabled()) setTimeout(tick, 1500)
    }
  }

  tick()

  return () => { alive = false }
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

  if (longPollEnabled()) {
    return startLongPoll({
      scope: 'conversation',
      id: conversationId,
      onRows: (rows) => { for (const r of rows) onNewMessage(r) },
    })
  }

  /* Direct PostgREST poll — used on mp when the long-poll edge route is
     absent or has tripped the circuit breaker. Remember the last seen
     row and ask for newer ones each tick. Using created_at > $last_seen
     is simpler than tracking ids because messages are append-only and
     created_at carries a monotonic server clock. */
  let lastSeen: string | null = null

  return startPoll({
    intervalMs: 3000,
    run: async () => {
      const q = supabase
        .from('messages')
        .select(MESSAGE_FIELDS)
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

  if (longPollEnabled()) {
    return startLongPoll({
      scope: 'inbox',
      id: userId,
      onRows: (rows) => { for (const r of rows) onNewMessage(r) },
    })
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
