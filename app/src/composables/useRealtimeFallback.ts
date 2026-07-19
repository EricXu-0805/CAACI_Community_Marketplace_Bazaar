import { useSupabase, platformFetch } from './useSupabase'
import { MESSAGE_FIELDS } from './useMessages.constants'
import { BASE_URL } from '../config/runtime'
import { readBoundedJson } from '../api/responseBody'
import { startPrivateRealtimeChannel } from '../api/privateRealtime'

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

const MESSAGE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MESSAGE_TIMESTAMPTZ_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/
const MESSAGE_CURSOR_SEPARATOR = '|'
const MAX_REALTIME_POLL_RESPONSE_BYTES = 2 * 1024 * 1024

function isMessageTimestamp(value: unknown): value is string {
  return typeof value === 'string' &&
    MESSAGE_TIMESTAMPTZ_RE.test(value) &&
    Number.isFinite(Date.parse(value))
}

interface MessageCursor {
  createdAt: string
  /** Null is the rolling-compat timestamp-only v1 cursor. */
  id: string | null
}

function parseMessageCursor(value: string): MessageCursor | null {
  if (value === '') return { createdAt: '', id: null }
  const separatorAt = value.lastIndexOf(MESSAGE_CURSOR_SEPARATOR)
  if (separatorAt < 0) {
    return isMessageTimestamp(value)
      ? { createdAt: value, id: null }
      : null
  }
  const createdAt = value.slice(0, separatorAt)
  const id = value.slice(separatorAt + MESSAGE_CURSOR_SEPARATOR.length)
  if (!isMessageTimestamp(createdAt) || !MESSAGE_ID_RE.test(id)) return null
  return { createdAt, id }
}

function messageCursorFromRow(row: any): MessageCursor | null {
  const createdAt = row?.created_at
  const id = row?.id
  if (
    !isMessageTimestamp(createdAt) ||
    typeof id !== 'string' ||
    !MESSAGE_ID_RE.test(id)
  ) return null
  return { createdAt, id }
}

function serializeMessageCursor(cursor: MessageCursor): string {
  return cursor.id
    ? `${cursor.createdAt}${MESSAGE_CURSOR_SEPARATOR}${cursor.id}`
    : cursor.createdAt
}

function applyMessageCursor(query: any, cursor: MessageCursor): any {
  if (!cursor.createdAt) return query
  if (!cursor.id) return query.gt('created_at', cursor.createdAt)
  return query.or(
    `created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id})`,
  )
}

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

/* Circuit breaker: if one long-poll subscription fails twice in a row, skip
   the edge tier for the rest of this app session and fall back to direct
   PostgREST polling. The failure streak is subscription-local: a healthy
   inbox must not erase a broken conversation's strikes (or vice versa). */
const LONG_POLL_CIRCUIT_LIMIT = 2
let longPollCircuitOpen = false

function longPollEnabled(): boolean {
  return LONG_POLL_CIRCUIT_LIMIT > 0 && !longPollCircuitOpen
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
  onCircuitOpen?: (cursor: string | null) => void
  // Fired once after the server-clock cursor has been established. Callers
  // use this handshake to reconcile the narrow subscribe/snapshot gap.
  onReady?: () => void
}

function startLongPoll(opts: LongPollOptions): Unsubscribe {
  const { supabase } = useSupabase()
  let alive = true
  let ctrl: AbortController | null = null
  let abortTimer: ReturnType<typeof setTimeout> | null = null
  let consecutiveStrikes = 0
  /* Seed the cursor at subscribe time: the first request must only ask for
     rows newer than the current database snapshot — a `since`-less request
     returns the oldest rows and chain-pages the entire history (on inbox that
     would toast once per historical message). 'now' is a sentinel the edge
     resolves from the newest RLS-visible PostgreSQL-created timestamp, never
     the phone or edge runtime clock. Every later cursor likewise comes from a
     database row. */
  let sinceCursor: string | null = 'now'
  let readySent = false

  function markReady() {
    if (readySent || !alive) return
    readySent = true
    opts.onReady?.()
  }

  function tripCircuit() {
    alive = false
    /* Hand the direct tier our cursor so it doesn't re-seed from the device
       clock; null if we never completed a request (sentinel unresolved). */
    opts.onCircuitOpen?.(sinceCursor === 'now' ? null : sinceCursor)
  }

  async function tick(): Promise<void> {
    if (!alive) return
    try {
      const { data: sess } = await supabase.auth.getSession()
      // Teardown can happen while getSession is pending, before this tick has
      // created an AbortController. Without this barrier the dead A
      // subscription could still create a fresh 28-second request after an
      // account transition, and teardown would have no controller to abort.
      if (!alive) return
      const jwt = sess.session?.access_token
      const url = new URL(longPollBase())
      url.searchParams.set('scope', opts.scope)
      url.searchParams.set('id', opts.id)
      if (sinceCursor) url.searchParams.set('since', sinceCursor)

      ctrl = new AbortController()
      const activeCtrl = ctrl
      /* Slightly longer than the edge function's 20s hold so the edge
         gets a chance to return its final {rows:[]} before we abort. */
      abortTimer = setTimeout(() => activeCtrl.abort(), 28000)
      const r = await platformFetch(url.toString(), {
        method: 'GET',
        headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
        signal: activeCtrl.signal,
      })

      if (!r.ok) {
        /* alive check FIRST: teardown aborts the in-flight 20s hold, and that
           client-initiated abort must not count as a strike — two quick chat
           exits were reaching the limit and permanently downgrading every
           later chat (and the session inbox) to the slow direct tier. The
           breaker is for a broken edge deploy, not for navigation. */
        if (!alive) return
        consecutiveStrikes++
        if (consecutiveStrikes >= LONG_POLL_CIRCUIT_LIMIT) {
          longPollCircuitOpen = true
          tripCircuit()
          return
        }
        setTimeout(tick, 1000)
        return
      }

      consecutiveStrikes = 0
      const body = await readBoundedJson<any>(r, {
        maxBytes: MAX_REALTIME_POLL_RESPONSE_BYTES,
        timeoutMs: 28_000,
      }).catch(() => ({}))
      const rows = Array.isArray(body?.rows) ? body.rows : []
      const hasNextSince = Object.prototype.hasOwnProperty.call(body || {}, 'next_since')
      if (rows.length > 0) {
        const bodyCursor = body?.next_since
        const parsedBodyCursor = typeof bodyCursor === 'string'
          ? parseMessageCursor(bodyCursor)
          : null
        const rowCursors = rows.map(messageCursorFromRow)
        if (rowCursors.some((cursor: MessageCursor | null) => !cursor)) {
          throw new Error('realtime_poll_malformed_cursor')
        }
        const rowCursor = rowCursors[rowCursors.length - 1]
        let validatedCursor: string
        if (parsedBodyCursor?.createdAt) {
          validatedCursor = bodyCursor
        } else if (rowCursor?.createdAt) {
          // Defensive compatibility with an older endpoint that omitted
          // next_since. Never accept an object/number as a future query value.
          validatedCursor = serializeMessageCursor(rowCursor)
        } else {
          throw new Error('realtime_poll_malformed_cursor')
        }
        // Validate the batch cursor before producing any user-visible side
        // effect. Teardown may also have fired while the request was held.
        if (alive) opts.onRows(rows)
        sinceCursor = validatedCursor
      } else {
        // A 200 without an authoritative cursor is not a successful seed. If
        // it opened readiness, the caller could take its initial snapshot and
        // permanently miss rows inside this untracked interval.
        if (!hasNextSince) throw new Error('realtime_poll_missing_cursor')
        const nextCursor = body.next_since
        if (typeof nextCursor !== 'string' || !parseMessageCursor(nextCursor)) {
          throw new Error('realtime_poll_malformed_cursor')
        }
        // Empty string is a meaningful cursor: the visible table was empty at
        // seed time, so the next request intentionally omits `since` and any
        // row it sees is new. A truthiness check would keep sending `now`
        // forever and never finish the handshake.
        sinceCursor = nextCursor
      }
      markReady()
      if (alive) setTimeout(tick, 50)
    } catch {
      if (!alive) return // teardown abort lands here — not a strike (see above)
      consecutiveStrikes++
      if (consecutiveStrikes < LONG_POLL_CIRCUIT_LIMIT) {
        setTimeout(tick, 1500)
      } else {
        longPollCircuitOpen = true
        tripCircuit()
      }
    } finally {
      // The long-poll budget covers headers AND the JSON body. Clearing it at
      // fetch resolution left a stalled/chunked body able to pin this loop.
      if (abortTimer) { clearTimeout(abortTimer); abortTimer = null }
    }
  }

  tick()

  // Abort the in-flight (up to 28s) held request on teardown, not just stop
  // the loop — otherwise it lingers and its late resolve is dropped by the
  // alive guard above.
  return () => {
    alive = false
    if (abortTimer) { clearTimeout(abortTimer); abortTimer = null }
    ctrl?.abort()
  }
}

/*
 * Server-clock cursor seeding for the direct poll tiers.
 *
 * Seeding from the device clock (`new Date().toISOString()`) silently drops
 * every row created inside the client's clock-skew window: a phone whose
 * clock runs N minutes fast never matches `created_at > cursor` for rows
 * stamped between server-now and client-now. So the first tick is a SEED
 * tick: fetch the newest row's created_at (server clock) and process
 * nothing. States:
 *   null  → not seeded yet (first tick seeds)
 *   ''    → table was empty at seed time; next tick takes everything it
 *           finds (those rows are genuinely new — nothing existed before)
 *   ISO|ID → v2 keyset cursor; timestamp-only ISO remains rolling-compatible
 * A live handoff from the long-poll tier passes its current (already
 * server-clock) cursor via initialCursor and skips the seed tick.
 */

/* Direct PostgREST poll of a conversation's messages — the mp fallback when
   long-poll is absent or has tripped the breaker. */
function directConversationPoll(
  conversationId: string,
  onNewMessage: (msg: any) => void,
  initialCursor?: string | null,
  onReady?: () => void,
): Unsubscribe {
  const { supabase } = useSupabase()
  const parsedInitialCursor = initialCursor == null ? null : parseMessageCursor(initialCursor)
  let lastSeen: MessageCursor | null = parsedInitialCursor
  // A non-null handoff cursor means the long-poll tier already completed its
  // readiness handshake. A cold direct-poll subscription instead becomes
  // ready only after its server-clock seed query succeeds.
  let readySent = initialCursor != null && parsedInitialCursor != null
  return startPoll({
    intervalMs: 3000,
    run: async () => {
      if (lastSeen === null) {
        const { data, error } = await supabase
          .from('messages')
          .select('id, created_at')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(1)
        if (error) throw error
        if (data?.[0]) {
          const seeded = messageCursorFromRow(data[0])
          if (!seeded) throw new Error('direct_poll_malformed_cursor')
          lastSeen = seeded
        } else {
          lastSeen = { createdAt: '', id: null }
        }
        if (!readySent) {
          readySent = true
          onReady?.()
        }
        return []
      }
      const q = supabase
        .from('messages')
        .select(MESSAGE_FIELDS)
        .eq('conversation_id', conversationId)
      const { data, error } = await applyMessageCursor(q, lastSeen)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(50)
      if (error) throw error
      if (data?.some((row: any) => !messageCursorFromRow(row))) {
        throw new Error('direct_poll_malformed_cursor')
      }
      return data || []
    },
    onSuccess: (rows: any[]) => {
      if (!rows.length) return
      const nextCursor = messageCursorFromRow(rows[rows.length - 1])
      if (!nextCursor) return
      lastSeen = nextCursor
      for (const row of rows) onNewMessage(row)
    },
    onError: () => { /* swallow transient errors; next tick retries */ },
  })
}

/* Direct PostgREST poll of the user's incoming messages (inbox scope). */
function directInboxPoll(
  userId: string,
  onNewMessage: (msg: any) => void,
  initialCursor?: string | null,
  onReady?: () => void,
): Unsubscribe {
  const { supabase } = useSupabase()
  const parsedInitialCursor = initialCursor == null ? null : parseMessageCursor(initialCursor)
  let lastSeen: MessageCursor | null = parsedInitialCursor
  let readySent = initialCursor != null && parsedInitialCursor != null
  return startPoll({
    intervalMs: 10000,
    run: async () => {
      if (lastSeen === null) {
        const { data, error } = await supabase
          .from('messages')
          .select('id, created_at')
          .neq('sender_id', userId)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(1)
        if (error) throw error
        if (data?.[0]) {
          const seeded = messageCursorFromRow(data[0])
          if (!seeded) throw new Error('direct_poll_malformed_cursor')
          lastSeen = seeded
        } else {
          lastSeen = { createdAt: '', id: null }
        }
        if (!readySent) {
          readySent = true
          onReady?.()
        }
        return []
      }
      const q = supabase
        .from('messages')
        .select('id, conversation_id, sender_id, created_at')
        .neq('sender_id', userId)
      const { data, error } = await applyMessageCursor(q, lastSeen)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(25)
      if (error) throw error
      if (data?.some((row: any) => !messageCursorFromRow(row))) {
        throw new Error('direct_poll_malformed_cursor')
      }
      return data || []
    },
    onSuccess: (rows: any[]) => {
      if (!rows.length) return
      const nextCursor = messageCursorFromRow(rows[rows.length - 1])
      if (!nextCursor) return
      lastSeen = nextCursor
      for (const row of rows) onNewMessage(row)
    },
    onError: () => { /* swallow transient errors; next tick retries */ },
  })
}

export function subscribeToConversation(
  conversationId: string,
  onNewMessage: (msg: any) => void,
  onMessageUpdate?: (msg: any) => void,
  onReady?: () => void,
): Unsubscribe {
  const { supabase } = useSupabase()
  let readySent = false
  const markReady = () => {
    if (readySent) return
    readySent = true
    onReady?.()
  }

  if (isRealtimeSupported()) {
    return startPrivateRealtimeChannel({
      supabase,
      topic: `messages:${conversationId}`,
      configure: (privateChannel) => {
        let configured = privateChannel.on(
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
          configured = configured.on(
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
        return configured
      },
      onStatus: (status) => {
        if (status === 'SUBSCRIBED') markReady()
      },
    })
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
        onReady: markReady,
        onCircuitOpen: (cursor) => {
          if (swapped) return
          swapped = true
          convUnsub = directConversationPoll(conversationId, onNewMessage, cursor, markReady)
        },
      })
    : directConversationPoll(conversationId, onNewMessage, undefined, markReady)

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
const NOTIFICATION_POLL_FIELDS = 'id, user_id, type, title, body, item_id, conversation_id, is_read, created_at'

export function subscribeToUserNotifications(
  userId: string,
  onNew: (row: any) => void,
  onReady?: () => void,
): Unsubscribe {
  const { supabase } = useSupabase()

  if (isRealtimeSupported()) {
    let readySent = false
    return startPrivateRealtimeChannel({
      supabase,
      expectedUserId: userId,
      topic: `user-${userId}-notifications`,
      configure: (privateChannel) => privateChannel.on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => onNew(payload.new),
      ),
      onStatus: (status) => {
        if (status === 'SUBSCRIBED' && !readySent) {
          readySent = true
          onReady?.()
        }
      },
    })
  }

  /* mp: lazy server-clock seed (see the direct-poll comment above) so the
     first tick neither replays history as fresh toasts nor — on a device
     with a fast clock — skips rows created in the skew window. */
  let lastSeen: MessageCursor | null = null

  return startPoll({
    intervalMs: 20000,
    run: async () => {
      if (lastSeen === null) {
        const { data, error } = await supabase
          .from('notifications')
          .select('id, created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(1)
        if (error) throw error
        if (data?.[0]) {
          const seeded = messageCursorFromRow(data[0])
          if (!seeded) throw new Error('notification_poll_malformed_cursor')
          lastSeen = seeded
        } else {
          lastSeen = { createdAt: '', id: null }
        }
        onReady?.()
        return []
      }
      const q = supabase
        .from('notifications')
        .select(NOTIFICATION_POLL_FIELDS)
        .eq('user_id', userId)
      const { data, error } = await applyMessageCursor(q, lastSeen)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(25)
      if (error) throw error
      if (data?.some((row: any) => !messageCursorFromRow(row))) {
        throw new Error('notification_poll_malformed_cursor')
      }
      return data || []
    },
    onSuccess: (rows: any[]) => {
      if (!rows.length) return
      const nextCursor = messageCursorFromRow(rows[rows.length - 1])
      if (!nextCursor) return
      lastSeen = nextCursor
      for (const row of rows) onNew(row)
    },
    onError: () => { /* swallow transient errors; next tick retries */ },
  })
}

export function subscribeToUserInbox(
  userId: string,
  onNewMessage: (msg: any) => void,
  onReady?: () => void,
): Unsubscribe {
  const { supabase } = useSupabase()

  if (isRealtimeSupported()) {
    let readySent = false
    return startPrivateRealtimeChannel({
      supabase,
      expectedUserId: userId,
      topic: `user-${userId}-new-messages`,
      configure: (privateChannel) => privateChannel.on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `sender_id=neq.${userId}`,
        },
        (payload) => onNewMessage(payload.new),
      ),
      onStatus: (status) => {
        if (status === 'SUBSCRIBED' && !readySent) {
          readySent = true
          onReady?.()
        }
      },
    })
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
        onReady,
        onCircuitOpen: (cursor) => {
          if (swapped) return
          swapped = true
          inboxUnsub = directInboxPoll(userId, onNewMessage, cursor, onReady)
        },
      })
    : directInboxPoll(userId, onNewMessage, undefined, onReady)

  return () => inboxUnsub()
}
