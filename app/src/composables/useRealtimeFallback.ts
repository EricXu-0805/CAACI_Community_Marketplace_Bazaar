import { useSupabase, platformFetch } from './useSupabase'
import { MESSAGE_FIELDS } from './useMessages.constants'
import { BASE_URL } from '../config/runtime'

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
  return `${BASE_URL}/api/realtime-poll`
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
  /* Fired once if the circuit breaker trips mid-session, so the caller can
     hand off to the direct-poll tier instead of the subscription silently
     going dark. Previously the fallback tier was only chosen at subscribe
     time, so a breaker trip on an already-open chat/inbox stopped delivery
     for the rest of the session. */
  onCircuitOpen?: () => void
}

function startLongPoll(opts: LongPollOptions): Unsubscribe {
  const { supabase } = useSupabase()
  let alive = true
  let ctrl: AbortController | null = null
  /* Seed the cursor at subscribe time: the first request must only ask for
     rows NEWER than now. A `since`-less request returns the OLDEST rows and
     the loop chain-pages the entire history — on the inbox scope that fires a
     '新消息' toast + unread refresh per historical message. */
  let sinceCursor: string | null = new Date().toISOString()

  function tripCircuit() {
    alive = false
    opts.onCircuitOpen?.()
  }

  async function tick(): Promise<void> {
    if (!alive) return
    try {
      const { data: sess } = await supabase.auth.getSession()
      const jwt = sess.session?.access_token
      const url = new URL(longPollBase())
      url.searchParams.set('scope', opts.scope)
      url.searchParams.set('id', opts.id)
      if (sinceCursor) url.searchParams.set('since', sinceCursor)

      ctrl = new AbortController()
      const activeCtrl = ctrl
      /* Slightly longer than the edge function's 20s hold so the edge
         gets a chance to return its final {rows:[]} before we abort. */
      const abortTimer = setTimeout(() => activeCtrl.abort(), 28000)
      const r = await platformFetch(url.toString(), {
        method: 'GET',
        headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
        signal: activeCtrl.signal,
      })
      clearTimeout(abortTimer)

      if (!r.ok) {
        longPollStrikes++
        if (!alive) return
        if (!longPollEnabled()) { tripCircuit(); return }
        setTimeout(tick, 1000)
        return
      }

      longPollStrikes = 0
      const body = await r.json().catch(() => ({}))
      const rows = Array.isArray(body?.rows) ? body.rows : []
      if (rows.length > 0) {
        // Teardown may have fired while this request was held server-side; a
        // dead subscription must not inject rows into a chat the user has
        // since navigated away from.
        if (alive) opts.onRows(rows)
        sinceCursor = body?.next_since || rows[rows.length - 1]?.created_at || sinceCursor
      } else if (body?.next_since) {
        sinceCursor = body.next_since
      }
      if (alive) setTimeout(tick, 50)
    } catch {
      longPollStrikes++
      if (!alive) return
      if (longPollEnabled()) setTimeout(tick, 1500)
      else tripCircuit()
    }
  }

  tick()

  // Abort the in-flight (up to 28s) held request on teardown, not just stop
  // the loop — otherwise it lingers and its late resolve is dropped by the
  // alive guard above.
  return () => { alive = false; ctrl?.abort() }
}

/* Direct PostgREST poll of a conversation's messages — the mp fallback when
   long-poll is absent or has tripped the breaker. Cursor seeded at now: the
   existing history is already loaded via fetchMessages, so we only need rows
   created after subscribe (a null cursor would replay the last 50). */
function directConversationPoll(conversationId: string, onNewMessage: (msg: any) => void): Unsubscribe {
  const { supabase } = useSupabase()
  let lastSeen: string = new Date().toISOString()
  return startPoll({
    intervalMs: 3000,
    run: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select(MESSAGE_FIELDS)
        .eq('conversation_id', conversationId)
        .gt('created_at', lastSeen)
        .order('created_at', { ascending: true })
        .limit(50)
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

/* Direct PostgREST poll of the user's incoming messages (inbox scope). Cursor
   seeded at now so the first tick doesn't replay the user's oldest messages
   as fresh toasts. */
function directInboxPoll(userId: string, onNewMessage: (msg: any) => void): Unsubscribe {
  const { supabase } = useSupabase()
  let lastSeen: string = new Date().toISOString()
  return startPoll({
    intervalMs: 10000,
    run: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('id, conversation_id, sender_id, created_at')
        .neq('sender_id', userId)
        .gt('created_at', lastSeen)
        .order('created_at', { ascending: true })
        .limit(25)
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

export function subscribeToConversation(
  conversationId: string,
  onNewMessage: (msg: any) => void,
  onMessageUpdate?: (msg: any) => void,
): Unsubscribe {
  const { supabase } = useSupabase()

  if (isRealtimeSupported()) {
    let channel = supabase
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
    if (onMessageUpdate) {
      /* Read receipts: the recipient flips is_read via markAsRead (the only
         client-writable messages column since m064), and this UPDATE stream
         is how the sender's open thread sees 未读 turn into 已读 live. */
      channel = channel.on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => onMessageUpdate(payload.new),
      )
    }
    channel = channel.subscribe()

    return () => { supabase.removeChannel(channel) }
  }

  /* mp fallback. onMessageUpdate (read receipts) is intentionally not wired
     here: both poll tiers ask for created_at > cursor, and an is_read flip
     doesn't change created_at, so it can't be delivered live on mp. The
     receipt still reconciles when the chat is re-opened (fetchMessages
     re-hydrates is_read) — consistent with the accepted "mp degrades to
     refetch-on-reshow" posture. Long-poll hands off to the direct tier if
     its breaker trips mid-session rather than going dark. */
  let convUnsub: Unsubscribe = () => {}
  let swapped = false
  convUnsub = longPollEnabled()
    ? startLongPoll({
        scope: 'conversation',
        id: conversationId,
        onRows: (rows) => { for (const r of rows) onNewMessage(r) },
        onCircuitOpen: () => {
          if (swapped) return
          swapped = true
          convUnsub = directConversationPoll(conversationId, onNewMessage)
        },
      })
    : directConversationPoll(conversationId, onNewMessage)

  return () => convUnsub()
}

/*
 * In-app notification feed (offers, meetups, sold, price-drops, system).
 * Mirrors subscribeToUserInbox but watches the notifications table instead
 * of messages, so a user already in the app gets a live toast + red-dot the
 * moment a row is inserted for them. RLS scopes the table to the owner, so
 * the user_id filter is just an extra narrowing of the channel.
 *
 * No long-poll tier here: the /api/realtime-poll edge route only knows the
 * 'conversation' and 'inbox' scopes, so mp falls straight through to a direct
 * PostgREST poll. Notifications are low-frequency, so a 20s tick is plenty.
 */
const NOTIFICATION_POLL_FIELDS = 'id, user_id, type, title, body, item_id, is_read, created_at'

export function subscribeToUserNotifications(
  userId: string,
  onNew: (row: any) => void,
): Unsubscribe {
  const { supabase } = useSupabase()

  if (isRealtimeSupported()) {
    const channel = supabase
      .channel(`user-${userId}-notifications`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => onNew(payload.new),
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }

  /* mp: seed the cursor at subscription time so the first tick doesn't replay
     historical notifications as fresh toasts. */
  let lastSeen: string = new Date().toISOString()

  return startPoll({
    intervalMs: 20000,
    run: async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select(NOTIFICATION_POLL_FIELDS)
        .eq('user_id', userId)
        .gt('created_at', lastSeen)
        .order('created_at', { ascending: true })
        .limit(25)
      if (error) throw error
      return data || []
    },
    onSuccess: (rows: any[]) => {
      if (!rows.length) return
      for (const row of rows) onNew(row)
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

  /* mp fallback — hand off to the direct tier if the long-poll breaker trips
     mid-session, so the session-wide inbox listener (toasts + red dot) doesn't
     silently stop after two transient failures. */
  let inboxUnsub: Unsubscribe = () => {}
  let swapped = false
  inboxUnsub = longPollEnabled()
    ? startLongPoll({
        scope: 'inbox',
        id: userId,
        onRows: (rows) => { for (const r of rows) onNewMessage(r) },
        onCircuitOpen: () => {
          if (swapped) return
          swapped = true
          inboxUnsub = directInboxPoll(userId, onNewMessage)
        },
      })
    : directInboxPoll(userId, onNewMessage)

  return () => inboxUnsub()
}
