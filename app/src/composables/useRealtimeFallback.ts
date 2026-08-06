import { useSupabase, platformFetch } from './useSupabase'
import { MESSAGE_FIELDS } from './useMessages.constants'
import { BASE_URL } from '../config/runtime'
import { readBoundedJson } from '../api/responseBody'
import { startPostgresChangesRealtimeChannel } from '../api/privateRealtime'
import {
  captureActiveAccountRequest,
  isAccountRequestCurrent,
  onAccountTransition,
} from './accountScope'

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
type ReconcileCallback = () => void | Promise<void>
type DeliveryCallback = (row: any) => void | Promise<void>

const MESSAGE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MESSAGE_TIMESTAMPTZ_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/
const MESSAGE_CURSOR_SEPARATOR = '|'
const MAX_REALTIME_POLL_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_DELIVERED_INSERT_IDS = 512
const MAX_PENDING_INSERT_DELIVERIES = 512

type OrderedInsertDelivery = DeliveryCallback & { stop: Unsubscribe }

/**
 * Serialize one subscription's insert callbacks in source invocation order.
 *
 * A callback may be async. Its id becomes durable in the bounded de-duplication
 * set only after that Promise fulfills; a rejection remains retryable by a
 * polling cursor or a later WebSocket replay. The settled tail absorbs the
 * rejection internally, while the per-row task returned to the transport still
 * reports it so polling can keep its cursor unchanged.
 */
function createBoundedInsertDelivery(
  deliver: DeliveryCallback,
  isCurrent: () => boolean = () => true,
): OrderedInsertDelivery {
  const deliveredIds = new Set<string>()
  const pendingById = new Map<string, Promise<void>>()
  type PendingDelivery = {
    id: string
    row: any
    promise: Promise<void>
    resolve: () => void
    reject: (reason?: unknown) => void
    settled: boolean
  }
  const queue: PendingDelivery[] = []
  let alive = true
  let running: PendingDelivery | null = null

  const settle = (entry: PendingDelivery, error?: unknown) => {
    if (entry.settled) return
    entry.settled = true
    if (pendingById.get(entry.id) === entry.promise) {
      pendingById.delete(entry.id)
    }
    if (error === undefined) entry.resolve()
    else entry.reject(error)
  }

  const rememberDelivered = (id: string) => {
    deliveredIds.add(id)
    if (deliveredIds.size > MAX_DELIVERED_INSERT_IDS) {
      const oldest = deliveredIds.values().next().value
      if (oldest) deliveredIds.delete(oldest)
    }
  }

  const drain = () => {
    if (!alive || running) return
    const entry = queue.shift()
    if (!entry) return
    if (!isCurrent()) {
      settle(entry)
      drain()
      return
    }

    running = entry
    const finish = (error?: unknown) => {
      if (error === undefined && alive && isCurrent()) {
        rememberDelivered(entry.id)
      }
      settle(entry, error)
      if (running === entry) running = null
      drain()
    }

    let result: void | Promise<void>
    try {
      // Preserve the historical synchronous first-delivery behavior for sync
      // consumers while still holding every later row behind an async result.
      result = deliver(entry.row)
    } catch (error) {
      finish(error)
      return
    }
    if (result && typeof (result as Promise<void>).then === 'function') {
      void Promise.resolve(result).then(
        () => finish(),
        error => finish(error),
      )
      return
    }
    finish()
  }

  const deliverInOrder = (row: any): Promise<void> => {
    const id = row?.id
    if (
      typeof id !== 'string'
      || id.length === 0
      || deliveredIds.has(id)
      || !alive
      || !isCurrent()
    ) return Promise.resolve()

    const pending = pendingById.get(id)
    if (pending) return pending
    if (pendingById.size >= MAX_PENDING_INSERT_DELIVERIES) {
      return Promise.reject(new Error('realtime_delivery_queue_capacity'))
    }

    let resolveTask!: () => void
    let rejectTask!: (reason?: unknown) => void
    const task = new Promise<void>((resolve, reject) => {
      resolveTask = resolve
      rejectTask = reject
    })
    const entry: PendingDelivery = {
      id,
      row,
      promise: task,
      resolve: resolveTask,
      reject: rejectTask,
      settled: false,
    }
    pendingById.set(id, task)
    queue.push(entry)
    drain()
    return task
  }

  const orderedDelivery = deliverInOrder as OrderedInsertDelivery
  orderedDelivery.stop = () => {
    if (!alive) return
    alive = false
    for (const entry of queue.splice(0)) settle(entry)
    if (running) {
      settle(running)
      running = null
    }
    deliveredIds.clear()
    pendingById.clear()
  }
  return orderedDelivery
}

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

function timestampSubMillisecondMicroseconds(value: string): number {
  const fraction = value.match(
    /\.(\d{1,6})(?:Z|[+-]\d{2}:\d{2})$/,
  )?.[1] || ''
  return Number(fraction.padEnd(6, '0').slice(3, 6))
}

function compareMessageCursorTimes(
  left: MessageCursor,
  right: MessageCursor,
): number {
  if (left.createdAt === right.createdAt) return 0
  if (!left.createdAt) return -1
  if (!right.createdAt) return 1

  const leftMilliseconds = Date.parse(left.createdAt)
  const rightMilliseconds = Date.parse(right.createdAt)
  if (leftMilliseconds !== rightMilliseconds) {
    return leftMilliseconds < rightMilliseconds ? -1 : 1
  }

  // Date.parse truncates PostgreSQL's fourth-through-sixth fractional digits.
  // Preserve those microseconds separately so two valid timestamptz rows in
  // the same millisecond are not reordered or treated as the same cursor.
  const leftSubMilliseconds = timestampSubMillisecondMicroseconds(left.createdAt)
  const rightSubMilliseconds = timestampSubMillisecondMicroseconds(right.createdAt)
  if (leftSubMilliseconds === rightSubMilliseconds) return 0
  return leftSubMilliseconds < rightSubMilliseconds ? -1 : 1
}

function cursorStrictlyFollows(
  previous: MessageCursor,
  next: MessageCursor,
): boolean {
  const timeOrder = compareMessageCursorTimes(previous, next)
  if (timeOrder !== 0) return timeOrder < 0
  if (!previous.id || !next.id) return false
  return next.id > previous.id
}

function cursorsEqual(left: MessageCursor, right: MessageCursor): boolean {
  return compareMessageCursorTimes(left, right) === 0
    && left.id === right.id
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

/* Circuit breaker: each long-poll subscription gets its own two-strike budget
   before that subscription alone falls back to direct PostgREST polling. */
const LONG_POLL_CIRCUIT_LIMIT = 2
const READY_RECONCILE_RETRY_MS = 1500

function longPollEnabled(): boolean {
  return LONG_POLL_CIRCUIT_LIMIT > 0
}

interface DeliveryFailureRecovery {
  trigger: () => void
  stop: Unsubscribe
}

/**
 * A WebSocket event has no cursor to hold back after an async consumer rejects.
 * Coalesce those failures into an account-scoped authoritative snapshot and
 * retry that snapshot until it succeeds or the owning subscription is stopped.
 */
function createDeliveryFailureRecovery(
  onReconcile: ReconcileCallback | undefined,
  isCurrent: () => boolean,
): DeliveryFailureRecovery {
  let alive = true
  let failureVersion = 0
  let reconciledThroughVersion = 0
  let reconcileFlight: Promise<void> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null

  const queue = (delayMs = 0) => {
    if (
      !alive
      || !isCurrent()
      || !onReconcile
      || reconciledThroughVersion >= failureVersion
      || retryTimer
      || reconcileFlight
    ) return

    retryTimer = setTimeout(() => {
      retryTimer = null
      if (!alive || !isCurrent() || !onReconcile) return
      const targetVersion = failureVersion
      const task = Promise.resolve()
        .then(() => onReconcile())
        .then(() => {
          if (alive && isCurrent()) {
            reconciledThroughVersion = Math.max(
              reconciledThroughVersion,
              targetVersion,
            )
          }
        })
      reconcileFlight = task
      let retryDelayMs = 0
      void task
        .catch(() => {
          retryDelayMs = READY_RECONCILE_RETRY_MS
        })
        .finally(() => {
          if (reconcileFlight === task) reconcileFlight = null
          if (
            alive
            && isCurrent()
            && reconciledThroughVersion < failureVersion
          ) queue(retryDelayMs)
        })
    }, delayMs)
  }

  return {
    trigger: () => {
      if (!alive || !isCurrent()) return
      failureVersion += 1
      queue()
    },
    stop: () => {
      if (!alive) return
      alive = false
      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
    },
  }
}

function startOrderedInsertSubscription(
  onInsert: DeliveryCallback,
  onDeliveryFailureReconcile: ReconcileCallback | undefined,
  startTransport: (
    deliverInsert: DeliveryCallback,
    recoverDeliveryFailure: () => void,
  ) => Unsubscribe,
): Unsubscribe {
  const accountToken = captureActiveAccountRequest()
  if (!accountToken) return () => {}

  let alive = true
  let transportStop: Unsubscribe = () => {}
  let stopAccountTransition: Unsubscribe = () => {}
  const isCurrent = () => alive && isAccountRequestCurrent(accountToken)
  const deliverInsert = createBoundedInsertDelivery(onInsert, isCurrent)
  const recovery = createDeliveryFailureRecovery(
    onDeliveryFailureReconcile,
    isCurrent,
  )

  const stop = () => {
    if (!alive) return
    alive = false
    stopAccountTransition()
    stopAccountTransition = () => {}
    recovery.stop()
    deliverInsert.stop()
    const stopTransport = transportStop
    transportStop = () => {}
    stopTransport()
  }

  try {
    transportStop = startTransport(deliverInsert, recovery.trigger)
  } catch (error) {
    stop()
    throw error
  }
  stopAccountTransition = onAccountTransition(stop)
  return stop
}

interface PollOptions<T> {
  intervalMs: number
  run: () => Promise<T>
  onSuccess?: (result: T) => void | Promise<void>
  onError?: (err: unknown) => void
}

function startPoll<T>(opts: PollOptions<T>): Unsubscribe {
  const accountToken = captureActiveAccountRequest()
  if (!accountToken) return () => {}

  let alive = true
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopAccountTransition = () => {}
  const isCurrent = () => alive && isAccountRequestCurrent(accountToken)

  async function tick() {
    if (!isCurrent()) return
    try {
      const v = await opts.run()
      if (isCurrent() && opts.onSuccess) await opts.onSuccess(v)
    } catch (e) {
      if (isCurrent() && opts.onError) opts.onError(e)
    } finally {
      if (isCurrent()) timer = setTimeout(tick, opts.intervalMs)
    }
  }

  const stop = () => {
    if (!alive) return
    alive = false
    stopAccountTransition()
    stopAccountTransition = () => {}
    if (timer) { clearTimeout(timer); timer = null }
  }
  stopAccountTransition = onAccountTransition(stop)
  void tick()

  return stop
}

interface StickyTransportOptions<Handoff> {
  onReady?: ReconcileCallback
  startPrimary: (
    onFailure: (handoff: Handoff) => void,
    onReady: () => void,
  ) => Unsubscribe
  startFallback: (
    handoff: Handoff,
    onReady: () => void,
  ) => Unsubscribe
}

/**
 * Own exactly one transport at a time. A real primary failure is sticky for
 * this subscription; explicit teardown never starts fallback. Readiness is
 * once per transport generation so a fallback seed can trigger a second
 * authoritative snapshot without duplicate SUBSCRIBED callbacks doing so.
 */
function startStickyTransport<Handoff>(
  options: StickyTransportOptions<Handoff>,
): Unsubscribe {
  const accountToken = captureActiveAccountRequest()
  if (!accountToken) return () => {}

  let alive = true
  let switched = false
  let transportGeneration = 0
  let activeUnsubscribe: Unsubscribe = () => {}
  let readyRetryTimer: ReturnType<typeof setTimeout> | null = null
  let primaryStarting = true
  let pendingFailure: { handoff: Handoff } | null = null
  let stopAccountTransition = () => {}
  const isCurrent = () => alive && isAccountRequestCurrent(accountToken)

  const nextReady = () => {
    if (readyRetryTimer) {
      clearTimeout(readyRetryTimer)
      readyRetryTimer = null
    }
    const generation = ++transportGeneration
    let sent = false
    let running = false
    const attempt = () => {
      if (!isCurrent() || sent || running || generation !== transportGeneration) return
      running = true
      let result: void | Promise<void>
      try {
        result = options.onReady?.()
      } catch {
        result = Promise.reject(new Error('realtime_reconcile_failed'))
      }
      if (!result || typeof (result as Promise<void>).then !== 'function') {
        if (isCurrent() && generation === transportGeneration) sent = true
        running = false
        return
      }
      void Promise.resolve(result)
        .then(() => {
          if (isCurrent() && generation === transportGeneration) sent = true
        })
        .catch(() => {
          if (!isCurrent() || generation !== transportGeneration) return
          readyRetryTimer = setTimeout(() => {
            readyRetryTimer = null
            attempt()
          }, READY_RECONCILE_RETRY_MS)
        })
        .finally(() => { running = false })
    }
    return attempt
  }

  const switchToFallback = (handoff: Handoff) => {
    if (!isCurrent() || switched) return
    // A future primary implementation may report a setup failure
    // synchronously. Defer the handoff until its real unsubscribe handle has
    // been installed; otherwise the assignment below could overwrite the
    // newly-started fallback owner.
    if (primaryStarting) {
      pendingFailure = { handoff }
      return
    }
    switched = true
    const stopPrimary = activeUnsubscribe
    activeUnsubscribe = () => {}
    stopPrimary()
    if (!isCurrent()) return
    activeUnsubscribe = options.startFallback(handoff, nextReady())
  }

  activeUnsubscribe = options.startPrimary(switchToFallback, nextReady())
  primaryStarting = false
  if (pendingFailure) {
    const { handoff } = pendingFailure
    pendingFailure = null
    switchToFallback(handoff)
  }

  const stop = () => {
    if (!alive) return
    alive = false
    stopAccountTransition()
    stopAccountTransition = () => {}
    transportGeneration += 1
    if (readyRetryTimer) {
      clearTimeout(readyRetryTimer)
      readyRetryTimer = null
    }
    const stopTransport = activeUnsubscribe
    activeUnsubscribe = () => {}
    stopTransport()
  }
  stopAccountTransition = onAccountTransition(stop)
  return stop
}

interface LongPollOptions {
  scope: 'conversation' | 'inbox'
  id: string
  onRows: (rows: any[]) => void | Promise<void>
  /* Fired once if the circuit breaker trips mid-session, so the caller can
     hand off to the direct-poll tier instead of the subscription silently
     going dark. Previously the fallback tier was only chosen at subscribe
     time, so a breaker trip on an already-open chat/inbox stopped delivery
     for the rest of the session. */
  onCircuitOpen?: (cursor: string | null) => void
  // Fired once after the server-clock cursor has been established. Callers
  // use this handshake to reconcile the narrow subscribe/snapshot gap.
  onReady?: () => void
  // Once ready, keep authoritative snapshots converging on healthy long-poll
  // responses too. INSERT cursors cannot observe UPDATE-only state such as
  // message read receipts.
  onReconcile?: ReconcileCallback
}

function startLongPoll(opts: LongPollOptions): Unsubscribe {
  const { supabase } = useSupabase()
  const accountToken = captureActiveAccountRequest()
  if (
    !accountToken
    || (opts.scope === 'inbox' && opts.id !== accountToken.userId)
  ) return () => {}
  const capturedAccountToken = accountToken

  let alive = true
  let ctrl: AbortController | null = null
  let abortTimer: ReturnType<typeof setTimeout> | null = null
  let nextTimer: ReturnType<typeof setTimeout> | null = null
  let stopAccountTransition = () => {}
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
  const isCurrent = () => alive && isAccountRequestCurrent(capturedAccountToken)

  function markReady() {
    if (readySent || !isCurrent()) return
    readySent = true
    opts.onReady?.()
  }

  const stop = () => {
    if (!alive) return
    alive = false
    stopAccountTransition()
    stopAccountTransition = () => {}
    if (nextTimer) { clearTimeout(nextTimer); nextTimer = null }
    if (abortTimer) { clearTimeout(abortTimer); abortTimer = null }
    ctrl?.abort()
    ctrl = null
  }

  function scheduleTick(delayMs: number) {
    if (!isCurrent()) return
    if (nextTimer) clearTimeout(nextTimer)
    nextTimer = setTimeout(() => {
      nextTimer = null
      void tick()
    }, delayMs)
  }

  function tripCircuit() {
    if (!isCurrent()) {
      stop()
      return
    }
    /* Hand the direct tier our cursor so it doesn't re-seed from the device
       clock; null if we never completed a request (sentinel unresolved). */
    const handoffCursor = sinceCursor === 'now' ? null : sinceCursor
    stop()
    opts.onCircuitOpen?.(handoffCursor)
  }

  async function tick(): Promise<void> {
    if (!isCurrent()) return
    let activeCtrl: AbortController | null = null
    try {
      const { data: sess } = await supabase.auth.getSession()
      // Teardown can happen while getSession is pending, before this tick has
      // created an AbortController. Without this barrier the dead A
      // subscription could still create a fresh 28-second request after an
      // account transition, and teardown would have no controller to abort.
      if (!isCurrent()) return
      const jwt = sess.session?.access_token
      if (sess.session?.user?.id !== capturedAccountToken.userId || !jwt) {
        throw new Error('realtime_poll_session_mismatch')
      }
      const url = new URL(longPollBase())
      url.searchParams.set('scope', opts.scope)
      url.searchParams.set('id', opts.id)
      if (sinceCursor) url.searchParams.set('since', sinceCursor)

      const requestCtrl = new AbortController()
      ctrl = requestCtrl
      activeCtrl = requestCtrl
      /* Slightly longer than the edge function's 20s hold so the edge
         gets a chance to return its final {rows:[]} before we abort. */
      abortTimer = setTimeout(() => requestCtrl.abort(), 28000)
      const r = await platformFetch(url.toString(), {
        method: 'GET',
        headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
        signal: requestCtrl.signal,
      })
      if (!isCurrent()) return

      if (!r.ok) {
        /* alive check FIRST: teardown aborts the in-flight 20s hold, and that
           client-initiated abort must not count as a strike — two quick chat
           exits were reaching the limit and permanently downgrading every
           later chat (and the session inbox) to the slow direct tier. The
           breaker is for a broken edge deploy, not for navigation. */
        consecutiveStrikes++
        if (consecutiveStrikes >= LONG_POLL_CIRCUIT_LIMIT) {
          tripCircuit()
          return
        }
        scheduleTick(1000)
        return
      }

      const body = await readBoundedJson<any>(r, {
        maxBytes: MAX_REALTIME_POLL_RESPONSE_BYTES,
        timeoutMs: 28_000,
      }).catch(() => ({}))
      if (!isCurrent()) return
      if (!Array.isArray(body?.rows)) {
        throw new Error('realtime_poll_malformed_rows')
      }
      const rows = body.rows
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
        for (let index = 1; index < rowCursors.length; index += 1) {
          if (!cursorStrictlyFollows(
            rowCursors[index - 1] as MessageCursor,
            rowCursors[index] as MessageCursor,
          )) {
            throw new Error('realtime_poll_non_monotonic_rows')
          }
        }
        const previousCursor = (
          typeof sinceCursor === 'string' && sinceCursor !== 'now'
        )
          ? parseMessageCursor(sinceCursor)
          : null
        if (
          previousCursor
          && !cursorStrictlyFollows(
            previousCursor,
            rowCursors[0] as MessageCursor,
          )
        ) {
          throw new Error('realtime_poll_non_monotonic_rows')
        }
        const rowCursor = rowCursors[rowCursors.length - 1]
        if (!rowCursor?.createdAt) {
          throw new Error('realtime_poll_malformed_cursor')
        }

        // A row-bearing response must advance to the last delivered row.
        // Upgrade a legacy timestamp-only cursor to the composite keyset so
        // rows sharing that timestamp cannot be skipped on the next page.
        // A v2 cursor is usable only when it identifies the same final row;
        // accepting a stale or future cursor can replay or silently skip data.
        if (hasNextSince && !parsedBodyCursor) {
          throw new Error('realtime_poll_malformed_cursor')
        }
        if (
          parsedBodyCursor?.id &&
          (
            parsedBodyCursor.createdAt !== rowCursor.createdAt ||
            parsedBodyCursor.id !== rowCursor.id
          )
        ) {
          throw new Error('realtime_poll_malformed_cursor')
        }

        const validatedCursor = serializeMessageCursor(
          parsedBodyCursor?.id ? parsedBodyCursor : rowCursor,
        )
        // Validate the batch cursor before producing any user-visible side
        // effect. A consumer failure leaves the cursor unchanged so the same
        // batch can be retried without losing its remaining rows.
        if (isCurrent()) {
          try {
            await opts.onRows(rows)
          } catch {
            // The network response and cursor are valid; only the consumer
            // failed. Do not spend the transport breaker budget and do not
            // commit the cursor. The next tick replays this same batch.
            consecutiveStrikes = 0
            scheduleTick(1500)
            return
          }
        }
        if (!isCurrent()) return
        sinceCursor = validatedCursor
      } else {
        // A 200 without an authoritative cursor is not a successful seed. If
        // it opened readiness, the caller could take its initial snapshot and
        // permanently miss rows inside this untracked interval.
        if (!hasNextSince) throw new Error('realtime_poll_missing_cursor')
        const nextCursor = body.next_since
        const parsedNextCursor = typeof nextCursor === 'string'
          ? parseMessageCursor(nextCursor)
          : null
        if (!parsedNextCursor) {
          throw new Error('realtime_poll_malformed_cursor')
        }
        if (sinceCursor !== 'now') {
          if (typeof sinceCursor !== 'string') {
            throw new Error('realtime_poll_malformed_cursor')
          }
          const previousCursor = parseMessageCursor(sinceCursor)
          if (!previousCursor || !cursorsEqual(previousCursor, parsedNextCursor)) {
            throw new Error('realtime_poll_non_monotonic_cursor')
          }
        }
        // Empty string is a meaningful cursor: the visible table was empty at
        // seed time, so the next request intentionally omits `since` and any
        // row it sees is new. A truthiness check would keep sending `now`
        // forever and never finish the handshake.
        sinceCursor = nextCursor
      }
      // A transport response is healthy only after its bounded body, rows and
      // authoritative cursor have all passed validation. Resetting on HTTP
      // 200 alone lets an edge deploy that repeatedly returns malformed JSON
      // or omits next_since stay below the breaker forever.
      consecutiveStrikes = 0
      const wasReady = readySent
      markReady()
      if (wasReady && isCurrent()) {
        // Consumer snapshot failures are not transport failures and must not
        // spend this subscription's circuit-breaker budget. A later healthy
        // long-poll response retries the reconciliation.
        try { await opts.onReconcile?.() } catch { /* next response retries */ }
      }
      if (isCurrent()) scheduleTick(50)
    } catch {
      if (!isCurrent()) return // teardown abort lands here — not a strike
      consecutiveStrikes++
      if (consecutiveStrikes < LONG_POLL_CIRCUIT_LIMIT) {
        scheduleTick(1500)
      } else {
        tripCircuit()
      }
    } finally {
      // The long-poll budget covers headers AND the JSON body. Clearing it at
      // fetch resolution left a stalled/chunked body able to pin this loop.
      if (abortTimer) { clearTimeout(abortTimer); abortTimer = null }
      if (ctrl === activeCtrl) ctrl = null
    }
  }

  stopAccountTransition = onAccountTransition(stop)
  void tick()

  // Abort the in-flight held request and every scheduled retry on teardown.
  return stop
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
  onNewMessage: DeliveryCallback,
  initialCursor?: string | null,
  onReady?: ReconcileCallback,
  onReconcile?: ReconcileCallback,
): Unsubscribe {
  const { supabase } = useSupabase()
  const parsedInitialCursor = initialCursor == null ? null : parseMessageCursor(initialCursor)
  let lastSeen: MessageCursor | null = parsedInitialCursor
  let readySettled = false
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
    onSuccess: async (rows: any[]) => {
      if (rows.length) {
        const nextCursor = messageCursorFromRow(rows[rows.length - 1])
        if (!nextCursor) return
        for (const row of rows) await onNewMessage(row)
        lastSeen = nextCursor
      }
      if (!readySettled) {
        await onReady?.()
        readySettled = true
        return
      }
      // A direct tier is the degraded authoritative owner, not just an INSERT
      // cursor. Reconcile later ticks so UPDATE-only state (for example
      // is_read) converges without redefining the one-shot readiness signal.
      await onReconcile?.()
    },
    onError: () => { /* swallow transient errors; next tick retries */ },
  })
}

/* Direct PostgREST poll of the user's incoming messages (inbox scope). */
function directInboxPoll(
  userId: string,
  onNewMessage: DeliveryCallback,
  initialCursor?: string | null,
  onReady?: ReconcileCallback,
  onReconcile?: ReconcileCallback,
): Unsubscribe {
  const { supabase } = useSupabase()
  const parsedInitialCursor = initialCursor == null ? null : parseMessageCursor(initialCursor)
  let lastSeen: MessageCursor | null = parsedInitialCursor
  let readySettled = false
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
    onSuccess: async (rows: any[]) => {
      if (rows.length) {
        const nextCursor = messageCursorFromRow(rows[rows.length - 1])
        if (!nextCursor) return
        for (const row of rows) await onNewMessage(row)
        lastSeen = nextCursor
      }
      if (!readySettled) {
        // Do not settle readiness until the authoritative inbox snapshot
        // succeeds. A rejected callback is retried on the next poll tick.
        await onReady?.()
        readySettled = true
        return
      }
      await onReconcile?.()
    },
    onError: () => { /* swallow transient errors; next tick retries */ },
  })
}

export function subscribeToConversation(
  conversationId: string,
  onNewMessage: DeliveryCallback,
  onMessageUpdate?: DeliveryCallback,
  onReady?: ReconcileCallback,
  onReconcile?: ReconcileCallback,
): Unsubscribe {
  const { supabase } = useSupabase()
  return startOrderedInsertSubscription(
    onNewMessage,
    onReconcile || onReady,
    (deliverInsert, recoverDeliveryFailure) => {
      if (isRealtimeSupported()) {
        return startStickyTransport<void>({
          onReady,
          startPrimary: (onFailure, markReady) => (
            startPostgresChangesRealtimeChannel({
              supabase,
              topic: `messages:${conversationId}`,
              configure: (channel, context) => {
                let configured = channel.on(
                  'postgres_changes',
                  {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'messages',
                    filter: `conversation_id=eq.${conversationId}`,
                  },
                  (payload) => {
                    if (!context.isCurrent()) return
                    void Promise.resolve(deliverInsert(payload.new))
                      .catch(() => {
                        if (context.isCurrent()) recoverDeliveryFailure()
                      })
                  },
                )
                if (onMessageUpdate) {
                  /* Read receipts: the recipient flips is_read via markAsRead
                     (the only client-writable messages column since m064).
                     INSERT de-duplication deliberately does not suppress this
                     UPDATE, but an async presentation failure still receives
                     the same guarded authoritative recovery. */
                  configured = configured.on(
                    'postgres_changes',
                    {
                      event: 'UPDATE',
                      schema: 'public',
                      table: 'messages',
                      filter: `conversation_id=eq.${conversationId}`,
                    },
                    (payload) => {
                      if (!context.isCurrent()) return
                      try {
                        void Promise.resolve(onMessageUpdate(payload.new))
                          .catch(() => {
                            if (context.isCurrent()) recoverDeliveryFailure()
                          })
                      } catch {
                        recoverDeliveryFailure()
                      }
                    },
                  )
                }
                return configured
              },
              onStatus: (status) => {
                if (status === 'SUBSCRIBED') markReady()
              },
              onFailure: () => onFailure(undefined),
            })
          ),
          startFallback: (_handoff, _markReady) => (
            directConversationPoll(
              conversationId,
              deliverInsert,
              undefined,
              onReady,
              onReconcile,
            )
          ),
        })
      }

      /* mp fallback. Incremental rows remain INSERT-only, but healthy long-poll
         responses also run the authoritative reconciliation callback so
         UPDATE-only state (notably read receipts) converges without reopening. */
      if (longPollEnabled()) {
        return startStickyTransport<string | null>({
          onReady,
          startPrimary: (onFailure, markReady) => startLongPoll({
            scope: 'conversation',
            id: conversationId,
            onRows: async (rows) => {
              for (const row of rows) await deliverInsert(row)
            },
            onReady: markReady,
            onReconcile,
            onCircuitOpen: onFailure,
          }),
          startFallback: (cursor, _markReady) => (
            directConversationPoll(
              conversationId,
              deliverInsert,
              cursor,
              onReady,
              onReconcile,
            )
          ),
        })
      }
      return directConversationPoll(
        conversationId,
        deliverInsert,
        undefined,
        onReady,
        onReconcile,
      )
    },
  )
}

/*
 * In-app notification feed (offers, meetups, sold, price-drops, system).
 * No long-poll tier: the edge route only knows conversation/inbox, so both MP
 * and an H5 socket failure use a 20s direct PostgREST poll.
 */
const NOTIFICATION_POLL_FIELDS = 'id, user_id, type, title, body, item_id, conversation_id, is_read, created_at'

function directNotificationPoll(
  userId: string,
  onNew: DeliveryCallback,
  onReady?: ReconcileCallback,
  onReconcile?: ReconcileCallback,
): Unsubscribe {
  const { supabase } = useSupabase()
  let lastSeen: MessageCursor | null = null
  let readySettled = false

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
        return []
      }
      const query = supabase
        .from('notifications')
        .select(NOTIFICATION_POLL_FIELDS)
        .eq('user_id', userId)
      const { data, error } = await applyMessageCursor(query, lastSeen)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(25)
      if (error) throw error
      if (data?.some((row: any) => !messageCursorFromRow(row))) {
        throw new Error('notification_poll_malformed_cursor')
      }
      return data || []
    },
    onSuccess: async (rows: any[]) => {
      if (rows.length) {
        const nextCursor = messageCursorFromRow(rows[rows.length - 1])
        if (!nextCursor) return
        for (const row of rows) await onNew(row)
        lastSeen = nextCursor
      }
      if (!readySettled) {
        await onReady?.()
        readySettled = true
        return
      }
      await onReconcile?.()
    },
    onError: () => { /* swallow transient errors; next tick retries */ },
  })
}

export function subscribeToUserNotifications(
  userId: string,
  onNew: DeliveryCallback,
  onReady?: ReconcileCallback,
  onReconcile?: ReconcileCallback,
): Unsubscribe {
  const { supabase } = useSupabase()
  return startOrderedInsertSubscription(
    onNew,
    onReconcile || onReady,
    (deliverInsert, recoverDeliveryFailure) => {
      if (isRealtimeSupported()) {
        return startStickyTransport<void>({
          onReady,
          startPrimary: (onFailure, markReady) => (
            startPostgresChangesRealtimeChannel({
              supabase,
              expectedUserId: userId,
              topic: `user-${userId}-notifications`,
              configure: (channel, context) => channel.on(
                'postgres_changes',
                {
                  event: 'INSERT',
                  schema: 'public',
                  table: 'notifications',
                  filter: `user_id=eq.${userId}`,
                },
                (payload) => {
                  if (!context.isCurrent()) return
                  void Promise.resolve(deliverInsert(payload.new))
                    .catch(() => {
                      if (context.isCurrent()) recoverDeliveryFailure()
                    })
                },
              ),
              onStatus: (status) => {
                if (status === 'SUBSCRIBED') markReady()
              },
              onFailure: () => onFailure(undefined),
            })
          ),
          startFallback: (_handoff, _markReady) => (
            directNotificationPoll(userId, deliverInsert, onReady, onReconcile)
          ),
        })
      }

      return directNotificationPoll(userId, deliverInsert, onReady, onReconcile)
    },
  )
}

export function subscribeToUserInbox(
  userId: string,
  onNewMessage: DeliveryCallback,
  onReady?: ReconcileCallback,
  onReconcile?: ReconcileCallback,
): Unsubscribe {
  const { supabase } = useSupabase()
  return startOrderedInsertSubscription(
    onNewMessage,
    onReconcile || onReady,
    (deliverInsert, recoverDeliveryFailure) => {
      if (isRealtimeSupported()) {
        return startStickyTransport<void>({
          onReady,
          startPrimary: (onFailure, markReady) => (
            startPostgresChangesRealtimeChannel({
              supabase,
              expectedUserId: userId,
              topic: `user-${userId}-new-messages`,
              configure: (channel, context) => channel.on(
                'postgres_changes',
                {
                  event: 'INSERT',
                  schema: 'public',
                  table: 'messages',
                  filter: `sender_id=neq.${userId}`,
                },
                (payload) => {
                  if (!context.isCurrent()) return
                  void Promise.resolve(deliverInsert(payload.new))
                    .catch(() => {
                      if (context.isCurrent()) recoverDeliveryFailure()
                    })
                },
              ),
              onStatus: (status) => {
                if (status === 'SUBSCRIBED') markReady()
              },
              onFailure: () => onFailure(undefined),
            })
          ),
          startFallback: (_handoff, _markReady) => (
            directInboxPoll(
              userId,
              deliverInsert,
              undefined,
              onReady,
              onReconcile,
            )
          ),
        })
      }

      /* mp fallback — hand off to the direct tier if the long-poll breaker
         trips mid-session, so the session-wide inbox listener (toasts + red
         dot) does not silently stop after two transient failures. */
      if (longPollEnabled()) {
        return startStickyTransport<string | null>({
          onReady,
          startPrimary: (onFailure, markReady) => startLongPoll({
            scope: 'inbox',
            id: userId,
            onRows: async (rows) => {
              for (const row of rows) await deliverInsert(row)
            },
            onReady: markReady,
            onReconcile,
            onCircuitOpen: onFailure,
          }),
          startFallback: (cursor, _markReady) => (
            directInboxPoll(
              userId,
              deliverInsert,
              cursor,
              onReady,
              onReconcile,
            )
          ),
        })
      }
      return directInboxPoll(
        userId,
        deliverInsert,
        undefined,
        onReady,
        onReconcile,
      )
    },
  )
}

interface SnapshotChangesSubscriptionOptions {
  topic: string
  table: 'offers' | 'meetups'
  filter: string
  intervalMs: number
  onChange: ReconcileCallback
  onReady?: ReconcileCallback
}

function startSnapshotPoll(
  onChange: ReconcileCallback,
  intervalMs: number,
): Unsubscribe {
  const accountToken = captureActiveAccountRequest()
  if (!accountToken) return () => {}

  let alive = true
  let stopAccountTransition = () => {}
  const timer = setInterval(() => {
    if (!alive || !isAccountRequestCurrent(accountToken)) return
    try {
      void Promise.resolve(onChange()).catch(() => {
        /* the next recurring snapshot is the retry owner */
      })
    } catch {
      /* the next recurring snapshot is the retry owner */
    }
  }, intervalMs)
  const stop = () => {
    if (!alive) return
    alive = false
    stopAccountTransition()
    stopAccountTransition = () => {}
    clearInterval(timer)
  }
  stopAccountTransition = onAccountTransition(stop)
  return stop
}

/**
 * Small full-snapshot streams (offers/meetups). DELETE is intentionally not
 * subscribed: Postgres Changes cannot filter DELETE and source-table RLS is
 * not applied to those events. INSERT/UPDATE plus authoritative snapshots are
 * sufficient for the product's append/state-transition lifecycle.
 */
export function subscribeToSnapshotChanges(
  options: SnapshotChangesSubscriptionOptions,
): Unsubscribe {
  const { supabase } = useSupabase()
  const accountToken = captureActiveAccountRequest()
  if (!accountToken) return () => {}

  if (isRealtimeSupported()) {
    let alive = true
    let changeVersion = 0
    let reconciledThroughChangeVersion = 0
    let changeFlight: Promise<void> | null = null
    let changeRetryTimer: ReturnType<typeof setTimeout> | null = null
    const isCurrent = () => (
      alive && isAccountRequestCurrent(accountToken)
    )

    const runSnapshotChange = (): Promise<void> | undefined => {
      if (!isCurrent()) return
      if (changeFlight) return changeFlight

      const targetVersion = changeVersion
      const flight = Promise.resolve()
        .then(() => options.onChange())
        .then(() => {
          if (isCurrent()) {
            reconciledThroughChangeVersion = Math.max(
              reconciledThroughChangeVersion,
              targetVersion,
            )
          }
        })
        .finally(() => {
          if (changeFlight === flight) changeFlight = null
        })
      changeFlight = flight
      return flight
    }

    const queueSnapshotChange = (delayMs = 0) => {
      if (!isCurrent()) return
      if (reconciledThroughChangeVersion >= changeVersion) return
      if (changeRetryTimer) return
      changeRetryTimer = setTimeout(() => {
        changeRetryTimer = null
        if (!isCurrent()) return
        const task = runSnapshotChange()
        if (!task) return
        void task
          .then(() => {
            if (
              isCurrent()
              && reconciledThroughChangeVersion < changeVersion
            ) queueSnapshotChange()
          })
          .catch(() => {
            if (
              isCurrent()
              && reconciledThroughChangeVersion < changeVersion
            ) queueSnapshotChange(READY_RECONCILE_RETRY_MS)
          })
      }, delayMs)
    }

    const transportStop = startStickyTransport<void>({
      onReady: options.onReady,
      startPrimary: (onFailure, markReady) => (
        startPostgresChangesRealtimeChannel({
          supabase,
          topic: options.topic,
          configure: (channel, context) => {
            const onRow = () => {
              if (!context.isCurrent()) return
              changeVersion += 1
              queueSnapshotChange()
            }
            return channel
              .on(
                'postgres_changes',
                {
                  event: 'INSERT',
                  schema: 'public',
                  table: options.table,
                  filter: options.filter,
                },
                onRow,
              )
              .on(
                'postgres_changes',
                {
                  event: 'UPDATE',
                  schema: 'public',
                  table: options.table,
                  filter: options.filter,
                },
                onRow,
              )
          },
          onStatus: (status) => {
            if (status === 'SUBSCRIBED') markReady()
          },
          onFailure: () => onFailure(undefined),
        })
      ),
      startFallback: (_handoff, markReady) => {
        const stop = startSnapshotPoll(options.onChange, options.intervalMs)
        markReady()
        return stop
      },
    })
    return () => {
      if (!alive) return
      alive = false
      if (changeRetryTimer) {
        clearTimeout(changeRetryTimer)
        changeRetryTimer = null
      }
      transportStop()
    }
  }

  // MP keeps its existing recurring full-snapshot posture. The caller installs
  // this timer before its initial snapshot, so no separate ready callback is
  // claimed for a cursorless transport.
  return startSnapshotPoll(options.onChange, options.intervalMs)
}
