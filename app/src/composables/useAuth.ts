import { ref, computed } from 'vue'
import {
  useSupabase,
  platformFetch,
  prepareSupabaseAuthPersistence,
  failClosedSupabaseSignOut,
} from './useSupabase'
import { useModeration } from './useModeration'
import { deviceFingerprintHash, deviceUASnippet } from '../utils/fingerprint'
import { passwordValid } from '../utils'
import { checkContent, remoteModerate } from '../utils/contentSafety'
import { addBreadcrumb, captureException } from '../utils/sentry'
import { safeAvatarUrl, sanitizeProfileResource } from '../utils/publicResource'
import type { Profile } from '../types'
import { BASE_URL } from '../config/runtime'
import {
  captureAccountIdentityGeneration,
  captureAccountRequest,
  getActiveAccountId,
  isAccountRequestCurrent,
  isAccountIdentityGenerationCurrent,
  isAccountTransitionCurrent,
  transitionAccount,
  type AccountRequestToken,
} from './accountScope'
import {
  isDefinitiveMutationRejection,
  mutationCommitState,
  mutationOutcomeError,
} from '../api/mutationCommit'
import { reconcileAccountPrivateStorage } from '../api/accountLocalPrivacy'
import { readBoundedJsonResponse } from '../api/boundedJson'

const currentUser = ref<Profile | null>(null)
const isLoggedIn = computed(() => !!currentUser.value)
const loading = ref(false)
export type AuthState = 'initializing' | 'authenticated' | 'anonymous'
const authState = ref<AuthState>('initializing')
const authInitialized = computed(() => authState.value !== 'initializing')
export type ProfileLoadState = 'idle' | 'loading' | 'ready' | 'error'
const profileLoadState = ref<ProfileLoadState>('idle')
const profileLoadError = ref<unknown>(null)

let authSubscription: { unsubscribe: () => void } | null = null
let authInitPromise: Promise<void> | null = null
let authEventVersion = 0
let latestAuthEventTask: Promise<void> = Promise.resolve()
let initialAuthHandshakeComplete = false
let initialAnonymousBroadcastComplete = false
let profileRetryPromise: Promise<boolean> | null = null
let profileRetryForUser: string | null = null
let lastProfileRetryAt = 0

const PROFILE_RETRY_DELAYS_MS = [0, 350, 1100] as const
const PROFILE_RETRY_COOLDOWN_MS = 3000
const WECHAT_LOGIN_RESPONSE_MAX_BYTES = 64 * 1024

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function isGateCompleteProfile(value: unknown, userId: string): value is Profile {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return row.id === userId
    && typeof row.nickname === 'string'
    && hasOwn(row, 'tos_version')
    && hasOwn(row, 'suspension_level')
    && typeof row.suspension_level === 'number'
    && hasOwn(row, 'suspended_until')
}

let resolveAuthReady: ((state: AuthState) => void) | null = null
let authReadyPromise = new Promise<AuthState>((resolve) => { resolveAuthReady = resolve })

function beginAuthTransition() {
  if (authState.value === 'initializing') return
  authState.value = 'initializing'
  authReadyPromise = new Promise<AuthState>((resolve) => { resolveAuthReady = resolve })
}

function settleAuthState(state: Exclude<AuthState, 'initializing'>) {
  authState.value = state
  resolveAuthReady?.(state)
  resolveAuthReady = null
}

function awaitAuthReady(): Promise<AuthState> {
  if (authState.value !== 'initializing') return Promise.resolve(authState.value)
  return authReadyPromise
}

async function withAuthInitTimeout<T>(promise: PromiseLike<T>, timeoutMs = 10000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('auth_init_timeout')), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/*
 * Race-guard counter for concurrent fetchProfile calls. On cold start, init()
 * fires fetchProfile twice concurrently — once from onAuthStateChange's
 * INITIAL_SESSION event and once from getSession() resolution. Without this
 * guard, the slower call's failure path could overwrite the faster call's
 * success on currentUser, hiding the entire isLoggedIn-gated UI until app
 * full-quit + reopen rebuilds the JS module. Mirrors the requestId pattern
 * in composables/useItems.ts and composables/usePlaza.ts.
 */
let latestProfileRequestId = 0

const ALLOWED_PROFILE_FIELDS = ['nickname', 'avatar_url', 'bio', 'location', 'status_text', 'status_emoji'] as const
type AllowedProfileUpdate = Partial<Pick<Profile, typeof ALLOWED_PROFILE_FIELDS[number]>>

function sanitizeStatus(raw: string, maxLen: number): string {
  return raw
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLen)
}

export function useAuth() {
  const { supabase } = useSupabase()

  function reconcileLocalPrivacy(nextUserId: string | null, previousUserId: string | null) {
    const result = reconcileAccountPrivateStorage(nextUserId, previousUserId)
    if (result.unresolvedKeys.length > 0 || !result.ownerRecorded) {
      const error = new Error('account_private_storage_cleanup_unverified')
      captureException(error, {
        tags: { source: 'auth-account-private-storage', cleanup_attempted: String(result.cleanupAttempted) },
        extra: { unresolvedKeys: result.unresolvedKeys },
        level: 'warning',
      })
    }
  }

  async function applySession(
    session: { user: { id: string } } | null,
    options: { settle: boolean; forceAnonymous?: boolean; source: string }
  ) {
    if (!session?.user) {
      // Invalidate both profile requests and every account-scoped request
      // before clearing refs.  A completion already queued in the microtask
      // queue can no longer restore the previous identity after sign-out.
      latestProfileRequestId += 1
      const previousUserId = getActiveAccountId()
      const forceInitialAnonymous = !initialAuthHandshakeComplete
        && !initialAnonymousBroadcastComplete
      // Consume the one-shot before notifying listeners. INITIAL_SESSION and
      // getSession may both report the same cold-start null snapshot; marking
      // it first also makes two concurrently-started applySession tasks safe.
      if (forceInitialAnonymous) initialAnonymousBroadcastComplete = true
      const anonymousGeneration = transitionAccount(
        null,
        // A cold start can restore page/composable refs from account-owned
        // storage before Supabase has proved that there is no session.  The
        // first authoritative anonymous handshake must therefore emit a
        // transition even though accountScope also starts at null; otherwise
        // mounted page-local state that is not in the storage reset registry
        // can keep the previous device owner's data after storage is erased.
        options.forceAnonymous === true
          || previousUserId !== null
          || forceInitialAnonymous,
      )
      currentUser.value = null
      profileLoadState.value = 'idle'
      profileLoadError.value = null
      reconcileLocalPrivacy(null, previousUserId)
      if (
        options.settle
        && isAccountTransitionCurrent(anonymousGeneration, null)
      ) settleAuthState('anonymous')
      return
    }

    const userId = session.user.id
    const previousUserId = getActiveAccountId()
    const identityChanged = previousUserId !== userId
    if (identityChanged) {
      beginAuthTransition()
      latestProfileRequestId += 1
      currentUser.value = null
      profileLoadState.value = 'idle'
      profileLoadError.value = null
      transitionAccount(userId)
      reconcileLocalPrivacy(userId, previousUserId)
    }

    try {
      await ensureProfileReady({ force: true })
    } catch (err) {
      console.warn('[auth] fetch profile failed')
      captureException(err, { tags: { source: `fetchProfile-${options.source}` } })
    } finally {
      if (options.settle && getActiveAccountId() === userId) {
        // Session and profile readiness are separate states. A valid session
        // may settle as authenticated after a profile failure, but App.vue then
        // routes only to the fail-closed recovery surface until the complete
        // gate-bearing row is fetched.
        settleAuthState('authenticated')
      }
    }

    if (getActiveAccountId() === userId) {
      recordFingerprint().catch(() => {})
    }
  }

  async function initializeAuth() {
    authSubscription?.unsubscribe()
    const { loadBlockedIds } = useModeration()

    /*
     * Wire onAuthStateChange BEFORE getSession so the listener is
     * already attached when getSession's INITIAL_SESSION event fires.
     * Prior order called getSession twice with onAuthStateChange in
     * between — two network round-trips on cold start (worse on mp
     * where each is ~1 s) and a window where TOKEN_REFRESHED could
     * fire and trigger a third fetchProfile.
     */
    try {
      const { data } = supabase.auth.onAuthStateChange((event, session) => {
        authEventVersion += 1
        latestAuthEventTask = applySession(session, {
          // During the initial getSession handshake, getSession is the single
          // readiness barrier.  Later auth events settle their own transition.
          settle: initialAuthHandshakeComplete,
          forceAnonymous: event === 'SIGNED_OUT',
          source: `authchange-${String(event).toLowerCase()}`,
        }).then(() => {
          if (session?.user && getActiveAccountId() === session.user.id) {
            void loadBlockedIds().then(result => {
              if (!result.ok && result.reason === 'load_failed') {
                console.warn('loadBlockedIds failed after auth change')
                if (result.error) captureException(result.error, { tags: { source: 'authchange-blocks' } })
              }
            }).catch(err => {
              console.warn('[auth] load blocked accounts failed')
              captureException(err, { tags: { source: 'authchange-blocks' } })
            })
          }
        }).catch(err => {
          console.warn('[auth] state application failed')
          captureException(err, { tags: { source: 'authchange-apply' } })
        })
      })
      authSubscription = data.subscription
    } catch (err) {
      console.warn('[auth] state listener setup failed')
    }

    try {
      const eventVersionBeforeSessionRead = authEventVersion
      const { data: { session } } = await withAuthInitTimeout(supabase.auth.getSession())
      if (authEventVersion === eventVersionBeforeSessionRead) {
        await applySession(session, { settle: true, source: 'init' })
      } else {
        // An auth event that happened while getSession was in flight is newer
        // than the captured snapshot.  Wait for that event instead of rolling
        // the process back to the stale getSession identity.
        await latestAuthEventTask
        settleAuthState(getActiveAccountId() ? 'authenticated' : 'anonymous')
      }
    } catch (err) {
      console.warn('[auth] session bootstrap failed')
      captureException(err, { tags: { source: 'getSession-init' } })
      if (!getActiveAccountId() && !initialAnonymousBroadcastComplete) {
        // If both the subscription bootstrap and getSession fail to establish
        // an identity, fail closed through the same anonymous transition and
        // storage reconciliation as a normal null session. Merely settling
        // authState would let mounted pages hydrate the previous device
        // owner's unscoped history/drafts once awaitAuthReady resolves.
        await applySession(null, {
          settle: true,
          forceAnonymous: true,
          source: 'init-failure',
        })
      } else {
        // A newer auth event already established B (or already broadcast the
        // one-shot anonymous boundary); do not roll it back or double-reload.
        settleAuthState(getActiveAccountId() ? 'authenticated' : 'anonymous')
      }
    }
    initialAuthHandshakeComplete = true
  }

  function init(): Promise<void> {
    if (authInitPromise) return authInitPromise
    authInitPromise = initializeAuth().finally(() => {
      // Keep a resolved promise as the idempotence sentinel.  Repeated calls
      // from app/page lifecycles must not stack auth subscriptions.
    })
    return authInitPromise
  }

  async function recordFingerprint() {
    try {
      const hash = await deviceFingerprintHash()
      const ua   = deviceUASnippet()
      if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return
      await supabase.rpc('record_fingerprint', { fp_hash_in: hash, ua_snippet_in: ua })
    } catch (err) {
      console.warn('[auth] fingerprint record failed')
    }
  }

  async function fetchProfile(userId: string): Promise<boolean> {
    /*
     * Race-guarded against the dual-invocation pattern in init() above:
     * onAuthStateChange's INITIAL_SESSION and getSession() both fire
     * fetchProfile on cold start. requestId is captured at entry and
     * rechecked after every await; on mismatch we abandon the write so
     * the slower call cannot clobber the faster call's authoritative
     * state. See latestProfileRequestId comment at module top.
     */
    const requestId = ++latestProfileRequestId
    const accountToken = captureAccountRequest(userId)
    const controller = new AbortController()

    try {
      // Keep the deadline inside fetchProfile. Wrapping fetchProfile itself in
      // Promise.race lets its original async body continue after the caller has
      // timed out and can repopulate currentUser after the retry loop entered
      // the fail-closed error state. The abort also releases the underlying H5
      // fetch / mini-program request instead of leaving three orphaned reads.
      const { data, error } = await withAuthInitTimeout(
        supabase.rpc('get_my_profile').abortSignal(controller.signal),
        6000,
      )
      if (requestId !== latestProfileRequestId || !isAccountRequestCurrent(accountToken)) return false

      if (error) throw error
      if (isGateCompleteProfile(data, userId)) {
        currentUser.value = sanitizeProfileResource(data as Profile)
        return true
      }
      // Never substitute the public profile projection here. It intentionally
      // omits suspension and consent fields; treating it as authoritative lets
      // an RPC outage erase the very values used by the global access gate.
      const incomplete: any = new Error('profile_gate_fields_unavailable')
      incomplete.code = 'PROFILE_INCOMPLETE'
      throw incomplete
    } catch (err) {
      if (requestId !== latestProfileRequestId || !isAccountRequestCurrent(accountToken)) return false
      throw err
    } finally {
      controller.abort()
    }
  }

  async function loadProfileWithRetry(
    userId: string,
    options: { preserveCurrent?: boolean } = {},
  ): Promise<boolean> {
    const accountToken = captureAccountRequest(userId)
    const preserveCurrent = options.preserveCurrent === true
      && profileLoadState.value === 'ready'
      && currentUser.value?.id === userId
    // Foreground authority refreshes keep the last complete profile visible
    // while retries are in flight. A final failure still clears it and enters
    // the fail-closed recovery route below.
    if (!preserveCurrent) {
      currentUser.value = null
      profileLoadState.value = 'loading'
    }
    profileLoadError.value = null
    let lastError: unknown = new Error('profile_load_failed')

    for (const delayMs of PROFILE_RETRY_DELAYS_MS) {
      if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs))
      if (!isAccountRequestCurrent(accountToken)) return false
      try {
        const loaded = await fetchProfile(userId)
        if (!isAccountRequestCurrent(accountToken)) return false
        if (loaded && (currentUser.value as Profile | null)?.id === userId) {
          profileLoadState.value = 'ready'
          profileLoadError.value = null
          return true
        }
      } catch (error) {
        lastError = error
      }
    }

    if (!isAccountRequestCurrent(accountToken)) return false
    currentUser.value = null
    profileLoadState.value = 'error'
    profileLoadError.value = lastError
    addBreadcrumb({
      category: 'auth',
      level: 'error',
      message: 'Complete gate-bearing profile unavailable',
      data: { userId },
    })
    throw lastError
  }

  function ensureProfileReady(
    options: { force?: boolean; preserveCurrent?: boolean } = {},
  ): Promise<boolean> {
    const userId = getActiveAccountId()
    if (!userId) return Promise.resolve(false)
    if (
      !options.force
      && profileLoadState.value === 'ready'
      && currentUser.value?.id === userId
    ) return Promise.resolve(true)
    if (profileRetryPromise && profileRetryForUser === userId) return profileRetryPromise
    if (
      !options.force
      && profileLoadState.value === 'error'
      && Date.now() - lastProfileRetryAt < PROFILE_RETRY_COOLDOWN_MS
    ) return Promise.resolve(false)

    lastProfileRetryAt = Date.now()
    profileRetryForUser = userId
    const task = loadProfileWithRetry(userId, {
      preserveCurrent: options.preserveCurrent,
    })
    profileRetryPromise = task
    return task.finally(() => {
      if (profileRetryPromise === task) {
        profileRetryPromise = null
        profileRetryForUser = null
      }
    })
  }

  async function refreshProfile() {
    await ensureProfileReady({ force: true, preserveCurrent: true })
  }

  async function signUp(email: string, password: string, nickname: string) {
    loading.value = true
    try {
      // Backstop the client password policy (the UI gates first). Tag the
      // error with the gotrue weak_password code so callers localize it.
      if (!passwordValid(password)) {
        const e: any = new Error('Password does not meet the policy')
        e.code = 'weak_password'
        throw e
      }

      // Email confirmation now uses a 6-digit OTP code (verifyOtp), not a magic
      // link — so no emailRedirectTo. The login page shows an in-app code panel
      // after sign-up; the "Confirm signup" Supabase template must render
      // {{ .Token }}. See supabase/email-templates/README.md. (Mail scanners
      // pre-fetch single-use links, which made the link flow read "expired" on
      // an instant click — the same failure that moved password reset to OTP.)
      await prepareSupabaseAuthPersistence()
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { nickname },
        },
      })
      if (error) throw error
      if (data.session?.user) {
        await applySession(data.session, { settle: true, source: 'signup' })
      }
      return { data, error: null }
    } catch (error: any) {
      return { data: null, error }
    } finally {
      loading.value = false
    }
  }

  async function signIn(email: string, password: string) {
    loading.value = true
    try {
      await prepareSupabaseAuthPersistence()
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (error) throw error
      if (data.session?.user) {
        // Do not return success while the previous account can still be on
        // screen. This also makes post-login navigation wait for the profile
        // needed by the suspension/re-consent gate.
        await applySession(data.session, { settle: true, source: 'signin' })
      }
      return { data, error: null }
    } catch (error: any) {
      return { data: null, error }
    } finally {
      loading.value = false
    }
  }

  async function signInWithWeChat(): Promise<{ data: any; error: any }> {
    // #ifndef MP-WEIXIN
    return { data: null, error: new Error('wechat_login_only_available_on_mp_weixin') }
    // #endif
    // #ifdef MP-WEIXIN
    loading.value = true
    try {
      const code: string = await new Promise((resolve, reject) => {
        uni.login({
          provider: 'weixin',
          success: (res: any) => res?.code ? resolve(res.code) : reject(new Error('no_code')),
          fail: (err: any) => reject(new Error(err?.errMsg || 'wx_login_failed')),
        })
      })

      const endpoint = `${BASE_URL}/api/auth/wechat-login`
      const res = await platformFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ js_code: code }),
      })
      if (!res.ok) {
        const detail: Record<string, unknown> = await readBoundedJsonResponse<Record<string, unknown>>(
          res,
          WECHAT_LOGIN_RESPONSE_MAX_BYTES,
        ).catch(() => ({}))
        const rawProviderError: unknown = detail['error']
        const providerError: string = typeof rawProviderError === 'string'
          ? rawProviderError as string
          : ''
        throw new Error(providerError || `http_${res.status}`)
      }
      const payload = await readBoundedJsonResponse<Record<string, any>>(
        res,
        WECHAT_LOGIN_RESPONSE_MAX_BYTES,
      )
      if (!payload?.access_token) throw new Error('no_access_token')

      await prepareSupabaseAuthPersistence()
      const { data: sessionData, error } = await supabase.auth.setSession({
        access_token: payload.access_token,
        refresh_token: payload.refresh_token || payload.access_token,
      })
      if (error) throw error
      if (sessionData.session?.user) {
        await applySession(sessionData.session, { settle: true, source: 'wechat-signin' })
      }
      return { data: payload, error: null }
    } catch (error: any) {
      return { data: null, error }
    } finally {
      loading.value = false
    }
    // #endif
  }

  async function signOut(options: { redirect?: boolean } = {}): Promise<boolean> {
    const { clearBlocked } = useModeration()
    // Invalidate the account generation before awaiting the auth request.  No
    // in-flight A response can repopulate shared state during sign-out.
    latestProfileRequestId += 1
    const previousUserId = getActiveAccountId()
    transitionAccount(null, true)
    const signOutIdentityGeneration = captureAccountIdentityGeneration()
    currentUser.value = null
    profileLoadState.value = 'idle'
    profileLoadError.value = null
    settleAuthState('anonymous')
    clearBlocked()
    // This boundary is deliberately synchronous. Account-transition listeners
    // reset every loaded module singleton, while reconcileLocalPrivacy clears
    // unscoped persistent data plus loaded history/translation memory. A lazy
    // import after the revoke wait could resume after account B signs in and
    // erase B's newly-created state.
    reconcileLocalPrivacy(null, previousUserId)
    try {
      // Local storage is blocked and purged before the best-effort server
      // revoke. auth-js 2.103.x otherwise returns early on network/5xx logout
      // failures and leaves the persisted refresh token able to rehydrate on
      // the next launch. The helper then invokes tokenless local signOut to
      // preserve the normal SIGNED_OUT subscriber event and purges once more.
      const result = await failClosedSupabaseSignOut()
      if (result.remoteRevokeError) {
        console.warn('[auth] remote session revoke failed after local purge')
      }
      if (result.storageClearFallbackUsed) {
        addBreadcrumb({
          category: 'auth',
          level: 'warning',
          message: 'Full app storage clear used during fail-closed logout',
        })
      }
      if (!result.crossRestartProtected) {
        const restartProtectionError = new Error('auth_logout_cross_restart_protection_unverified')
        console.warn('[useAuth] logout could not verify cross-restart protection')
        captureException(restartProtectionError, { tags: { source: 'auth-cross-restart-protection' } })
      }
      if (result.stopAutoRefreshError || result.firstPurgeError || result.signedOutEventError || result.finalPurgeError) {
        const cleanupError = result.finalPurgeError
          || result.firstPurgeError
          || result.signedOutEventError
          || result.stopAutoRefreshError
        console.warn('[auth] local cleanup failed')
        if (cleanupError) captureException(cleanupError, { tags: { source: 'auth-local-purge' } })
      }
    } catch (err) {
      console.warn('[auth] fail-closed sign-out orchestration failed')
      captureException(err, { tags: { source: 'auth-signout-orchestration' } })
    }
    // A new login may complete after the revoke task releases its persistence
    // lock. Never let this old sign-out remove B's realtime channels or own B's
    // navigation. Identity-lineage equality rejects A -> null -> B -> null,
    // while tolerating the extra forced null -> null SIGNED_OUT event emitted
    // by this same fail-closed logout.
    if (!isAccountIdentityGenerationCurrent(signOutIdentityGeneration, null)) return false
    supabase.removeAllChannels()
    // Most callers want the normal signed-out home redirect. Flows that must
    // present a result first (durable account deletion, profile recovery) own
    // their single destination and explicitly suppress this navigation.
    if (
      options.redirect !== false
      && isAccountIdentityGenerationCurrent(signOutIdentityGeneration, null)
    ) {
      uni.reLaunch({ url: '/pages/index/index' })
    }
    return true
  }

  async function updateProfile(
    updates: AllowedProfileUpdate,
    options?: { accountToken?: AccountRequestToken },
  ) {
    // Capture authority before the first async session read. Otherwise a
    // caller that omitted the optional token could start under A, resume after
    // B signs in, and silently reinterpret A's form payload as B's update.
    const entryUserId = getActiveAccountId()
    const accountToken = options?.accountToken
      || (entryUserId ? captureAccountRequest(entryUserId) : null)
    if (!accountToken || !isAccountRequestCurrent(accountToken)) {
      return {
        error: mutationOutcomeError(
          new Error('Account changed while updating profile'),
          'not_committed',
        ),
      }
    }

    let session: any
    try {
      const response = await supabase.auth.getSession()
      session = response.data.session
    } catch (error) {
      return { error: mutationOutcomeError(error, 'not_committed') }
    }
    if (
      !session?.user
      || session.user.id !== accountToken.userId
      || !isAccountRequestCurrent(accountToken)
    ) {
      return { error: mutationOutcomeError(new Error('Not authenticated'), 'not_committed') }
    }

    const userId = accountToken.userId
    let mutationStarted = false
    let committed = false
    const assertAccountCurrent = () => {
      if (accountToken.userId !== userId || !isAccountRequestCurrent(accountToken)) {
        throw mutationOutcomeError(
          new Error('Account changed while updating profile'),
          committed ? 'committed' : 'not_committed',
        )
      }
    }

    try {
      assertAccountCurrent()
      const sanitized: Record<string, any> = Object.fromEntries(
        Object.entries(updates).filter(([k]) =>
          (ALLOWED_PROFILE_FIELDS as readonly string[]).includes(k)
        )
      )
      if (typeof sanitized.status_text === 'string') {
        sanitized.status_text = sanitizeStatus(sanitized.status_text, 60)
        if (!sanitized.status_text) sanitized.status_text = null
      }
      if (typeof sanitized.status_emoji === 'string') {
        sanitized.status_emoji = sanitizeStatus(sanitized.status_emoji, 8)
        if (!sanitized.status_emoji) sanitized.status_emoji = null
      }
      if (typeof sanitized.avatar_url === 'string') {
        const rawAvatar = sanitized.avatar_url.trim()
        if (rawAvatar) {
          const localAvatar = safeAvatarUrl(rawAvatar, userId)
          if (!localAvatar) throw new Error('invalid_public_media')
          sanitized.avatar_url = localAvatar
        } else {
          sanitized.avatar_url = ''
        }
      }
      // Nickname moderation (L1): items/posts/comments are screened; nicknames
      // were not, yet they show on every card/post/comment/chat. Block offensive
      // terms / contact-info / links (not length — the form + the server trigger
      // 067 own that). Server trigger is the authoritative gate; this gives
      // friendly pre-submit feedback.
      if (typeof sanitized.nickname === 'string') {
        const trimmed = sanitized.nickname.trim()
        const c = checkContent(trimmed, { kind: 'item_title' })
        if (!c.ok && c.category !== 'too_short' && c.category !== 'too_long') {
          throw new Error(`moderation_block:${c.category}`)
        }
        const ai = await remoteModerate(trimmed, accountToken)
        if (ai.flagged) throw new Error('moderation_block:sensitive_word')
        sanitized.nickname = trimmed
      }

      assertAccountCurrent()
      mutationStarted = true
      let error: any
      try {
        const response = await supabase
          .from('profiles')
          .update(sanitized)
          .eq('id', userId)
        error = response.error
      } catch (writeError) {
        throw mutationOutcomeError(writeError, 'unknown')
      }

      if (error?.code === '42703' && /status_/.test(String(error.message || ''))) {
        // 42703 is a definite rejection, so retrying the compatible payload is
        // safe, but only while the original account generation is still live.
        console.warn('[useAuth] profiles.status_* missing — retrying without (run migration 021)')
        delete sanitized.status_text
        delete sanitized.status_emoji
        assertAccountCurrent()
        try {
          const response = await supabase
            .from('profiles')
            .update(sanitized)
            .eq('id', userId)
          error = response.error
        } catch (writeError) {
          throw mutationOutcomeError(writeError, 'unknown')
        }
      }

      if (error) {
        throw mutationOutcomeError(
          error,
          isDefinitiveMutationRejection(error) ? 'not_committed' : 'unknown',
        )
      }

      committed = true
      assertAccountCurrent()
      if (currentUser.value?.id === userId) {
        currentUser.value = sanitizeProfileResource({
          ...currentUser.value,
          ...sanitized,
        } as Profile)
      }
      return { error: null }
    } catch (error) {
      const tagged = mutationCommitState(error)
        ? error
        : mutationOutcomeError(
          error,
          committed ? 'committed' : mutationStarted ? 'unknown' : 'not_committed',
        )
      return { error: tagged }
    }
  }

  function requireAuth() {
    // During hydration, null profile does not mean anonymous.  Callers that can
    // await should use awaitAuthReady(); synchronous guards must not send a
    // known in-flight session to the login page.
    if (authState.value === 'initializing') return false
    if (authState.value === 'anonymous') {
      uni.navigateTo({ url: '/pages/login/index' })
      return false
    }
    // A public profile projection is not enough to evaluate suspension/TOS.
    // Keep the authenticated session on the dedicated recovery surface until
    // the full self-profile RPC succeeds.
    if (profileLoadState.value !== 'ready' || !isLoggedIn.value) {
      uni.reLaunch({ url: '/pages/profile-recovery/index' })
      return false
    }
    return true
  }

  return {
    currentUser,
    isLoggedIn,
    loading,
    authState,
    authInitialized,
    profileLoadState,
    profileLoadError,
    awaitAuthReady,
    init,
    signUp,
    signIn,
    signInWithWeChat,
    signOut,
    refreshProfile,
    ensureProfileReady,
    updateProfile,
    requireAuth,
  }
}
