import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import {
  captureActiveAccountRequest,
  isAccountRequestCurrent,
  onAccountTransition,
  type AccountRequestToken,
} from '../composables/accountScope'

export interface PrivateRealtimeContext {
  readonly userId: string
  isCurrent: () => boolean
}

export type RealtimeChannelFailureStage =
  | 'getSession'
  | 'setAuth'
  | 'channel'
  | 'configure'
  | 'subscribe'
  | 'status'

export interface RealtimeChannelFailure {
  readonly stage: RealtimeChannelFailureStage
  readonly status?: 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'
  readonly error?: Error
}

interface StartRealtimeChannelOptions {
  supabase: SupabaseClient
  topic: string
  /** Reject user-scoped topics that do not belong to the active account. */
  expectedUserId?: string
  config?: Record<string, unknown> | ((context: PrivateRealtimeContext) => Record<string, unknown>)
  configure: (
    channel: RealtimeChannel,
    context: PrivateRealtimeContext,
  ) => RealtimeChannel
  onStatus?: (status: string, error?: Error) => void
  onFailure?: (failure: RealtimeChannelFailure) => void
  onClose?: () => void
}

const TERMINAL_REALTIME_STATUSES = new Set(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'])

class RealtimeAuthBoundaryError extends Error {
  readonly stage: 'getSession' | 'setAuth'
  readonly poisonCoordinator: boolean

  constructor(
    stage: 'getSession' | 'setAuth',
    message: string,
    cause?: unknown,
    poisonCoordinator = false,
  ) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'RealtimeAuthBoundaryError'
    this.stage = stage
    this.poisonCoordinator = poisonCoordinator
  }
}

interface CoordinatedRealtimeClient {
  accessTokenValue?: string | null
  setAuth: (token?: string | null) => Promise<void>
  removeAllChannels?: () => Promise<unknown>
  disconnect?: () => Promise<unknown> | unknown
}

interface QueuedRealtimeAuthOperation {
  kind: 'ambient' | 'preflight'
  operation: () => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
  timeout: ReturnType<typeof setTimeout> | null
  settled: boolean
}

interface RealtimeAuthCoordinator {
  active: QueuedRealtimeAuthOperation | null
  queue: QueuedRealtimeAuthOperation[]
  blocked: boolean
  blockedError: RealtimeAuthBoundaryError | null
  realtime: CoordinatedRealtimeClient
  originalSetAuth: (token?: string | null) => Promise<void>
}

const realtimeAuthCoordinators = new WeakMap<object, RealtimeAuthCoordinator>()
const REALTIME_AUTH_TIMEOUT_MS = 10000

function enqueueRealtimeAuth<T>(
  coordinator: RealtimeAuthCoordinator,
  operation: () => Promise<T>,
  kind: QueuedRealtimeAuthOperation['kind'],
): Promise<T> {
  if (coordinator.blocked) {
    if (kind === 'ambient') return Promise.resolve(undefined as T)
    return Promise.reject(
      coordinator.blockedError
        || new RealtimeAuthBoundaryError('setAuth', 'realtime_auth_coordinator_blocked'),
    )
  }

  const flight = new Promise<T>((resolve, reject) => {
    const queued: QueuedRealtimeAuthOperation = {
      kind,
      operation,
      resolve: value => resolve(value as T),
      reject,
      timeout: null,
      settled: false,
    }
    queued.timeout = setTimeout(() => {
      poisonRealtimeAuthCoordinator(
        coordinator,
        new RealtimeAuthBoundaryError('setAuth', 'realtime_auth_timeout', undefined, true),
      )
    }, REALTIME_AUTH_TIMEOUT_MS)
    coordinator.queue.push(queued)
  })
  drainRealtimeAuthQueue(coordinator)
  return flight
}

function drainRealtimeAuthQueue(coordinator: RealtimeAuthCoordinator): void {
  if (coordinator.blocked || coordinator.active) return
  const next = coordinator.queue.shift()
  if (!next) return

  coordinator.active = next
  let result: Promise<unknown>
  try {
    // Start the first operation synchronously. RealtimeClient.setAuth(token)
    // updates accessTokenValue before its returned Promise settles, and SDK
    // callers rely on that timing when a socket connects immediately afterward.
    result = next.operation()
  } catch (error) {
    finishRealtimeAuthOperation(coordinator, next, false, error)
    return
  }
  void Promise.resolve(result).then(
    (value) => {
      if (next.settled) {
        if (coordinator.blocked) coordinator.realtime.accessTokenValue = null
        return
      }
      finishRealtimeAuthOperation(coordinator, next, true, value)
    },
    (error) => {
      if (next.settled) {
        if (coordinator.blocked) coordinator.realtime.accessTokenValue = null
        return
      }
      finishRealtimeAuthOperation(coordinator, next, false, error)
    },
  )
}

function finishRealtimeAuthOperation(
  coordinator: RealtimeAuthCoordinator,
  operation: QueuedRealtimeAuthOperation,
  succeeded: boolean,
  value: unknown,
): void {
  if (operation.settled) return
  if (
    !succeeded
    && (
      operation.kind === 'ambient'
      || (
        value instanceof RealtimeAuthBoundaryError
        && value.poisonCoordinator
      )
    )
  ) {
    poisonRealtimeAuthCoordinator(
      coordinator,
      new RealtimeAuthBoundaryError(
        'setAuth',
        'realtime_auth_coordinator_failed',
        value,
        true,
      ),
    )
    return
  }

  operation.settled = true
  if (operation.timeout) clearTimeout(operation.timeout)
  operation.timeout = null
  if (coordinator.active === operation) coordinator.active = null
  if (succeeded) operation.resolve(value)
  else operation.reject(value)
  drainRealtimeAuthQueue(coordinator)
}

function poisonRealtimeAuthCoordinator(
  coordinator: RealtimeAuthCoordinator,
  error: RealtimeAuthBoundaryError,
): void {
  if (coordinator.blocked) return
  coordinator.blocked = true
  coordinator.blockedError = error
  coordinator.realtime.accessTokenValue = null

  const pending = [
    ...(coordinator.active ? [coordinator.active] : []),
    ...coordinator.queue,
  ]
  coordinator.active = null
  coordinator.queue = []
  for (const operation of pending) {
    if (operation.settled) continue
    operation.settled = true
    if (operation.timeout) clearTimeout(operation.timeout)
    operation.timeout = null
    if (operation.kind === 'ambient') operation.resolve(undefined)
    else operation.reject(error)
  }

  // Once an auth flight times out, its underlying Promise cannot be cancelled
  // and could still write a stale token later. Remove every channel and close
  // the socket exactly at the poison boundary; future app preflights fail into
  // polling and future SDK/Auth-event setAuth calls become safe no-ops.
  try {
    const removing = coordinator.realtime.removeAllChannels?.()
    if (removing) void Promise.resolve(removing).catch(() => {})
  } catch {
  }
  try {
    const disconnecting = coordinator.realtime.disconnect?.()
    if (disconnecting) void Promise.resolve(disconnecting).catch(() => {})
  } catch {
  }
}

/**
 * Install before the shared Supabase client can emit Auth events or create a
 * channel. RealtimeClient.setAuth() is completion-order-wins, and the SDK calls
 * it from connect, join, heartbeat, TOKEN_REFRESHED, SIGNED_IN, and SIGNED_OUT.
 * Wrapping the method itself is the only application boundary that serializes
 * both our channel preflight and those SDK-owned calls.
 */
export function installRealtimeAuthSerialization(
  realtime: CoordinatedRealtimeClient,
): void {
  if (realtimeAuthCoordinators.has(realtime)) return

  const originalSetAuth = realtime.setAuth.bind(realtime)
  const coordinator: RealtimeAuthCoordinator = {
    active: null,
    queue: [],
    blocked: false,
    blockedError: null,
    realtime,
    originalSetAuth,
  }
  realtimeAuthCoordinators.set(realtime, coordinator)
  realtime.setAuth = (token?: string | null) => enqueueRealtimeAuth(
    coordinator,
    () => token === undefined ? originalSetAuth() : originalSetAuth(token),
    'ambient',
  )
}

function runSerializedRealtimeAuth<T>(
  realtime: CoordinatedRealtimeClient,
  operation: (
    setAuth: (token?: string | null) => Promise<void>,
  ) => Promise<T>,
): Promise<T> {
  const coordinator = realtimeAuthCoordinators.get(realtime)
  if (!coordinator) {
    return Promise.reject(new Error('realtime_auth_serialization_not_installed'))
  }
  return enqueueRealtimeAuth(
    coordinator,
    () => operation((token?: string | null) => {
      if (coordinator.blocked) {
        return Promise.reject(
          coordinator.blockedError
            || new RealtimeAuthBoundaryError('setAuth', 'realtime_auth_coordinator_blocked'),
        )
      }
      return token === undefined
        ? coordinator.originalSetAuth()
        : coordinator.originalSetAuth(token)
    }),
    'preflight',
  )
}

function asError(value: unknown): Error | undefined {
  if (value instanceof Error) return value
  if (value == null) return undefined
  return new Error(String(value))
}

function sessionStillOwns(
  token: AccountRequestToken,
  session: { user?: { id?: string }; access_token?: string } | null | undefined,
): session is { user: { id: string }; access_token: string } {
  return isAccountRequestCurrent(token)
    && session?.user?.id === token.userId
    && typeof session.access_token === 'string'
    && session.access_token.length > 0
}

function realtimeUsesSession(
  realtime: { accessTokenValue?: string | null },
  session: { access_token: string },
): boolean {
  // RealtimeClient.setAuth() can resolve after its access-token callback
  // throws by silently retaining accessTokenValue. Verify the SDK's actual
  // applied token before any channel is constructed; a successful Promise is
  // not sufficient proof that this account owns the shared client.
  return typeof realtime.accessTokenValue === 'string'
    && realtime.accessTokenValue === session.access_token
}

async function setLatestRealtimeAuth(
  supabase: SupabaseClient,
  accountToken: AccountRequestToken,
  isCurrent: () => boolean,
): Promise<void> {
  await runSerializedRealtimeAuth(
    optionsRealtime(supabase),
    async (setAuth) => {
      // A same-account refresh can land while this operation is running. Keep
      // the lock while re-reading and applying the access-token callback's
      // newest session. The instance wrapper also queues SDK-owned connect,
      // join, heartbeat, and Auth-event writes behind this same operation.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (!isCurrent()) {
          throw new RealtimeAuthBoundaryError(
            attempt === 0 ? 'getSession' : 'setAuth',
            'realtime_auth_request_superseded',
          )
        }
        let sessionResult: Awaited<ReturnType<typeof supabase.auth.getSession>>
        try {
          sessionResult = await supabase.auth.getSession()
        } catch (error) {
          throw new RealtimeAuthBoundaryError(
            attempt === 0 ? 'getSession' : 'setAuth',
            'realtime_auth_session_read_failed',
            error,
          )
        }
        const session = sessionResult.data.session
        if (
          !isCurrent()
          || sessionResult.error
          || !sessionStillOwns(accountToken, session)
        ) {
          throw new RealtimeAuthBoundaryError(
            attempt === 0 ? 'getSession' : 'setAuth',
            'realtime_auth_session_not_owned',
            sessionResult.error,
          )
        }

        try {
          await setAuth()
        } catch (error) {
          throw new RealtimeAuthBoundaryError(
            'setAuth',
            'realtime_auth_apply_failed',
            error,
          )
        }
        if (!isCurrent()) {
          throw new RealtimeAuthBoundaryError(
            'setAuth',
            'realtime_auth_request_superseded',
          )
        }

        let verifiedResult: Awaited<ReturnType<typeof supabase.auth.getSession>>
        try {
          verifiedResult = await supabase.auth.getSession()
        } catch (error) {
          throw new RealtimeAuthBoundaryError(
            'setAuth',
            'realtime_auth_verification_read_failed',
            error,
          )
        }
        const verifiedSession = verifiedResult.data.session
        if (
          !isCurrent()
          || verifiedResult.error
          || !sessionStillOwns(accountToken, verifiedSession)
        ) {
          throw new RealtimeAuthBoundaryError(
            'setAuth',
            'realtime_auth_verification_not_owned',
            verifiedResult.error,
          )
        }
        if (realtimeUsesSession(optionsRealtime(supabase), verifiedSession)) return

        // If Auth rotated the token between the two reads, retry under the same
        // serialized ownership flight. Otherwise callback-mode setAuth
        // resolved without applying the active session and must fail closed.
        if (verifiedSession.access_token === session.access_token) {
          throw new RealtimeAuthBoundaryError(
            'setAuth',
            'realtime_auth_not_applied',
            undefined,
            true,
          )
        }
      }
      throw new RealtimeAuthBoundaryError(
        'setAuth',
        'realtime_auth_session_unstable',
        undefined,
        true,
      )
    },
  )
}

function optionsRealtime(supabase: SupabaseClient): CoordinatedRealtimeClient {
  return supabase.realtime
}

/**
 * Open an authenticated Supabase Realtime channel without exposing an
 * anonymous interval during async session restoration.
 *
 * The returned teardown is synchronous and safe to call before getSession(),
 * setAuth(), or channel construction settles. Every continuation is tied to
 * the account generation captured at entry; an A -> B transition removes the
 * channel immediately and a late A continuation can no longer subscribe.
 */
function startAuthenticatedRealtimeChannel(
  options: StartRealtimeChannelOptions,
  privateChannel: boolean,
  failOnTerminalStatus: boolean,
): () => void {
  const accountToken = captureActiveAccountRequest()
  if (
    !accountToken
    || (options.expectedUserId && options.expectedUserId !== accountToken.userId)
  ) return () => {}

  let alive = true
  let failureSent = false
  let channel: RealtimeChannel | null = null
  let stopAccountTransition = () => {}

  const isCurrent = () => alive && isAccountRequestCurrent(accountToken)
  const close = () => {
    if (!alive) return
    alive = false
    stopAccountTransition()
    stopAccountTransition = () => {}
    if (channel) {
      const closing = channel
      channel = null
      try {
        void Promise.resolve(options.supabase.removeChannel(closing)).catch(() => {})
      } catch {
        // A concurrently closed socket is already in the desired state.
      }
    }
    try { options.onClose?.() } catch { /* teardown is authoritative */ }
  }
  const fail = (failure: RealtimeChannelFailure) => {
    if (!isCurrent() || failureSent) {
      close()
      return
    }
    failureSent = true
    // Remove the failed SDK channel before handing transport ownership to the
    // polling tier. close() also suppresses CLOSED emitted by removeChannel.
    close()
    try { options.onFailure?.(failure) } catch {
      // Failure reporting cannot revive or retain a dead transport.
    }
  }

  stopAccountTransition = onAccountTransition(() => close())

  void (async () => {
    // Both private Broadcast/Presence and Postgres Changes must use the latest
    // token owned by SupabaseClient's access-token callback. The coordinator
    // reads and verifies Auth while it owns the same queue used by every SDK
    // setAuth call, so an older account cannot complete after this preflight.
    try {
      await setLatestRealtimeAuth(options.supabase, accountToken, isCurrent)
    } catch (error) {
      fail({
        stage: error instanceof RealtimeAuthBoundaryError ? error.stage : 'setAuth',
        error: asError(error),
      })
      return
    }
    if (!isCurrent()) {
      close()
      return
    }

    const context: PrivateRealtimeContext = {
      userId: accountToken.userId,
      isCurrent,
    }
    let channelConfig: Record<string, unknown> | undefined
    try {
      channelConfig = typeof options.config === 'function'
        ? options.config(context)
        : options.config
    } catch (error) {
      fail({ stage: 'configure', error: asError(error) })
      return
    }
    // Keep ownership of the channel as soon as the SDK registers it. If a
    // listener factory or subscribe() throws, close() can still remove the
    // half-configured channel from the shared Realtime client.
    try {
      channel = options.supabase.channel(options.topic, {
        config: privateChannel
          ? { ...channelConfig, private: true }
          : { ...channelConfig },
      })
    } catch (error) {
      fail({ stage: 'channel', error: asError(error) })
      return
    }
    let configured: RealtimeChannel
    try {
      configured = options.configure(channel, context)
    } catch (error) {
      fail({ stage: 'configure', error: asError(error) })
      return
    }
    channel = configured
    if (!isCurrent()) {
      close()
      return
    }
    try {
      channel = configured.subscribe((status: string, error?: Error) => {
        if (!isCurrent()) {
          close()
          return
        }
        try { options.onStatus?.(status, error) } catch {
          // A presentation/readiness callback cannot break socket bookkeeping.
        }
        if (failOnTerminalStatus && TERMINAL_REALTIME_STATUSES.has(status)) {
          fail({
            stage: 'status',
            status: status as RealtimeChannelFailure['status'],
            error: asError(error),
          })
        }
      })
    } catch (error) {
      fail({ stage: 'subscribe', error: asError(error) })
    }
  })().catch((error) => fail({ stage: 'configure', error: asError(error) }))

  return close
}

/**
 * Broadcast/Presence transport. These extensions are intentionally private
 * and are authorized by exact `realtime.messages` topic policies.
 */
export function startPrivateRealtimeChannel(
  options: StartRealtimeChannelOptions,
): () => void {
  return startAuthenticatedRealtimeChannel(options, true, false)
}

/**
 * Authenticated Postgres Changes transport. Row visibility remains governed
 * by the source table's SELECT/RLS policy; this path does not opt into private
 * Broadcast/Presence authorization for its arbitrary SDK topic name.
 *
 * The current public-channel posture is a local release candidate only. A
 * hosted canary is still required before the project disables public channels.
 */
export function startPostgresChangesRealtimeChannel(
  options: StartRealtimeChannelOptions,
): () => void {
  return startAuthenticatedRealtimeChannel(options, false, true)
}
