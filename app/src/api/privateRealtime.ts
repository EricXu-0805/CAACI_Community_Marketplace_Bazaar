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

interface StartPrivateRealtimeChannelOptions {
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
  onClose?: () => void
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

/**
 * Open an authenticated, private Supabase Realtime channel without exposing a
 * public-channel interval during async session restoration.
 *
 * The returned teardown is synchronous and safe to call before getSession(),
 * setAuth(), or channel construction settles. Every continuation is tied to
 * the account generation captured at entry; an A -> B transition removes the
 * channel immediately and a late A continuation can no longer subscribe.
 */
export function startPrivateRealtimeChannel(
  options: StartPrivateRealtimeChannelOptions,
): () => void {
  const accountToken = captureActiveAccountRequest()
  if (
    !accountToken
    || (options.expectedUserId && options.expectedUserId !== accountToken.userId)
  ) return () => {}

  let alive = true
  let channel: RealtimeChannel | null = null
  let stopAccountTransition = () => {}

  const isCurrent = () => alive && isAccountRequestCurrent(accountToken)
  const close = () => {
    if (!alive) return
    alive = false
    stopAccountTransition()
    stopAccountTransition = () => {}
    try { options.onClose?.() } catch { /* teardown is authoritative */ }
    if (channel) {
      const closing = channel
      channel = null
      try {
        void Promise.resolve(options.supabase.removeChannel(closing)).catch(() => {})
      } catch {
        // A concurrently closed socket is already in the desired state.
      }
    }
  }

  stopAccountTransition = onAccountTransition(() => close())

  void (async () => {
    const sessionResult = await options.supabase.auth.getSession()
    const session = sessionResult.data.session
    if (!isCurrent() || sessionResult.error || !sessionStillOwns(accountToken, session)) {
      close()
      return
    }

    // Realtime Authorization evaluates realtime.messages policies using this
    // JWT. Await it before constructing/subscribing so there is never a public
    // or anonymous join attempt while Auth is still hydrating.
    await options.supabase.realtime.setAuth(session.access_token)
    if (!isCurrent() || !sessionStillOwns(accountToken, session)) {
      close()
      return
    }

    const context: PrivateRealtimeContext = {
      userId: accountToken.userId,
      isCurrent,
    }
    const channelConfig = typeof options.config === 'function'
      ? options.config(context)
      : options.config
    // Keep ownership of the channel as soon as the SDK registers it. If a
    // listener factory or subscribe() throws, close() can still remove the
    // half-configured channel from the shared Realtime client.
    channel = options.supabase.channel(options.topic, {
      config: {
        ...channelConfig,
        private: true,
      },
    })
    const configured = options.configure(channel, context)
    channel = configured
    if (!isCurrent()) {
      try {
        void Promise.resolve(options.supabase.removeChannel(configured)).catch(() => {})
      } catch {}
      close()
      return
    }
    channel = configured.subscribe((status: string, error?: Error) => {
      if (!isCurrent()) {
        close()
        return
      }
      try { options.onStatus?.(status, error) } catch {
        // A presentation/readiness callback cannot break socket bookkeeping.
      }
    })
  })().catch(() => close())

  return close
}
