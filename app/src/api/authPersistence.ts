/**
 * Fail-closed storage controller for Supabase Auth.
 *
 * Supabase Auth normally removes its persisted session at the end of
 * `signOut()`.  In auth-js 2.103.x a network/5xx error from the logout
 * endpoint returns before that removal.  This controller makes local privacy
 * independent from the remote revoke: once blocked, reads return anonymous,
 * writes are rejected, and the exact token / PKCE / split-user keys are
 * removed even if a previously-started storage write completes later.
 */

type MaybePromise<T> = T | Promise<T>

export interface AuthStorageBacking {
  getItem(key: string): MaybePromise<string | null>
  setItem(key: string, value: string): MaybePromise<void>
  removeItem(key: string): MaybePromise<void>
  /** Exceptional last resort; may remove unrelated app preferences. */
  clearAll?(): MaybePromise<void>
}

export interface AuthStorageAdapter {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

export interface FailClosedAuthStorage {
  readonly storageKey: string
  readonly logoutBlockKey: string
  readonly storage: AuthStorageAdapter
  /** Establish and adopt a new durable allowed generation after a verified purge. */
  allowWrites(): Promise<void>
  blockWrites(): Promise<void>
  syncPersistedBlock(): Promise<void>
  isWriteBlocked(): boolean
  isCrossRestartProtected(): boolean
  didUseFullStorageClear(): boolean
  trackedKeys(): string[]
  readAccessToken(): Promise<string | null>
  purge(options?: { allowFullStorageClear?: boolean }): Promise<void>
  waitForIdle(): Promise<void>
}

export interface AuthClientForLocalPurge {
  stopAutoRefresh(): Promise<void>
  signOut(options: { scope: 'local' }): Promise<{ error: unknown | null }>
  admin: {
    signOut(accessToken: string, scope: 'local'): Promise<{ error: unknown | null }>
  }
}

export interface FailClosedSignOutResult {
  accessTokenFound: boolean
  stopAutoRefreshError: unknown | null
  firstPurgeError: unknown | null
  remoteRevokeError: unknown | null
  signedOutEventError: unknown | null
  finalPurgeError: unknown | null
  crossRestartProtected: boolean
  storageClearFallbackUsed: boolean
}

const LOGOUT_BLOCK_VALUE = '1'
const AUTH_BOUNDARY_VERSION = 2
const AUTH_BOUNDARY_KEY_SUFFIX = '-auth-boundary-v2'
const LEGACY_LOGOUT_BLOCK_KEY_SUFFIX = '-logout-blocked'
const LEGACY_GENERATION = 'legacy-unversioned'
const AUTH_VALUE_ENVELOPE_TAG = 'caaci-auth-value-v2'

type AuthBoundaryMode = 'allowed' | 'blocked'

interface AuthBoundaryState {
  mode: AuthBoundaryMode
  generation: string
  persisted: boolean
}

interface AuthValueEnvelope {
  tag: typeof AUTH_VALUE_ENVELOPE_TAG
  generation: string
  value: string
}

let fallbackGenerationSequence = 0

function newBoundaryGeneration(): string {
  try {
    const randomUuid = (globalThis as any).crypto?.randomUUID?.()
    if (typeof randomUuid === 'string' && randomUuid) return randomUuid
  } catch {}
  try {
    const bytes = new Uint8Array(16)
    ;(globalThis as any).crypto?.getRandomValues?.(bytes)
    if (bytes.some(byte => byte !== 0)) {
      return Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('')
    }
  } catch {}
  fallbackGenerationSequence += 1
  // This value is an ABA/version token, not a secret. Time + process-local
  // sequence + randomness is sufficient when secure platform RNG is absent.
  return `${Date.now().toString(36)}-${fallbackGenerationSequence.toString(36)}-${Math.random().toString(36).slice(2)}`
}

function serializeBoundary(mode: AuthBoundaryMode, generation: string): string {
  return JSON.stringify({ v: AUTH_BOUNDARY_VERSION, mode, generation })
}

function parseBoundary(value: string | null): AuthBoundaryState {
  if (!value) return { mode: 'allowed', generation: LEGACY_GENERATION, persisted: false }
  // Compatibility with the boolean tombstone written by the first fail-closed
  // implementation. It remains a durable blocked state until an explicit new
  // session boundary purges Auth and upgrades it to v2.
  if (value === LOGOUT_BLOCK_VALUE) {
    return { mode: 'blocked', generation: 'legacy-blocked', persisted: true }
  }
  try {
    const parsed = JSON.parse(value) as { v?: unknown; mode?: unknown; generation?: unknown }
    if (
      parsed?.v === AUTH_BOUNDARY_VERSION &&
      (parsed.mode === 'allowed' || parsed.mode === 'blocked') &&
      typeof parsed.generation === 'string' &&
      parsed.generation.length >= 8 &&
      parsed.generation.length <= 160
    ) {
      return {
        mode: parsed.mode,
        generation: parsed.generation,
        persisted: true,
      }
    }
  } catch {}
  // An unreadable/malformed boundary is never interpreted as permission.
  return { mode: 'blocked', generation: 'malformed-boundary', persisted: true }
}

function wrapAuthValue(generation: string, value: string): string {
  const envelope: AuthValueEnvelope = {
    tag: AUTH_VALUE_ENVELOPE_TAG,
    generation,
    value,
  }
  return JSON.stringify(envelope)
}

function unwrapAuthValue(raw: string | null, generation: string): string | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<AuthValueEnvelope>
    if (parsed?.tag === AUTH_VALUE_ENVELOPE_TAG) {
      return parsed.generation === generation && typeof parsed.value === 'string'
        ? parsed.value
        : null
    }
  } catch {}
  // Existing installs have an unwrapped Supabase session and no v2 boundary.
  // Once a v2 generation exists, raw values can only come from an old/dormant
  // bundle and must never be treated as belonging to the new generation.
  return generation === LEGACY_GENERATION ? raw : null
}

function authKeySet(storageKey: string): Set<string> {
  return new Set([
    storageKey,
    `${storageKey}-code-verifier`,
    `${storageKey}-user`,
  ])
}

function serializedAccessToken(value: string | null): string | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as { access_token?: unknown }
    return typeof parsed?.access_token === 'string' && parsed.access_token
      ? parsed.access_token
      : null
  } catch {
    return null
  }
}

async function erasePersistedKey(backing: AuthStorageBacking, key: string): Promise<void> {
  let removeError: unknown | null = null
  try {
    await backing.removeItem(key)
  } catch (error) {
    removeError = error
  }

  try {
    const remaining = await backing.getItem(key)
    if (!remaining) return
    if (!removeError) removeError = new Error('supabase_auth_storage_remove_not_applied')
  } catch (error) {
    removeError = removeError
      ? new AggregateError([removeError, error], 'supabase_auth_storage_remove_unverifiable')
      : error
  }

  // Some embedded storage engines can fail deletion while still permitting a
  // write. Replacing serialized auth JSON with the empty string is an equally
  // anonymous restart state because the adapter normalizes it to null.
  try {
    await backing.setItem(key, '')
    const remaining = await backing.getItem(key)
    if (!remaining) return
    throw new Error('supabase_auth_storage_empty_overwrite_not_applied')
  } catch (overwriteError) {
    throw new AggregateError(
      [removeError, overwriteError].filter(Boolean),
      'supabase_auth_storage_key_could_not_be_erased',
    )
  }
}

async function settleWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('supabase_remote_revoke_timeout')), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Serialize backing-store operations.  The queue is important for an async
 * native storage implementation: a pre-logout setItem cannot finish after a
 * purge and resurrect the old session.  Blocking is checked both before and
 * after the physical write, while the queued purge is guaranteed to run last.
 */
export function createFailClosedAuthStorage(
  backing: AuthStorageBacking,
  storageKey: string,
): FailClosedAuthStorage {
  const keys = authKeySet(storageKey)
  // Use a versioned key so an old cached bundle cannot delete the generation
  // record it does not understand. The legacy boolean key is still honored on
  // read and is removed only after a verified v2 boundary has replaced it.
  const logoutBlockKey = `${storageKey}${AUTH_BOUNDARY_KEY_SUFFIX}`
  const legacyLogoutBlockKey = `${storageKey}${LEGACY_LOGOUT_BLOCK_KEY_SUFFIX}`
  let writeBlocked = false
  let purgeVerified = true
  let authKeysCleared = false
  let markerVerified = false
  let fullStorageClearUsed = false
  let operationGeneration = 0
  let adoptedGeneration: string | null = null
  let blockedGeneration: string | null = null
  let operationQueue: Promise<unknown> = Promise.resolve()

  const remember = (key: string) => {
    // This adapter is passed only to Supabase Auth, so every requested key is
    // an actual auth key.  Keep the three known keys above as a cold-start
    // backstop for keys that have not been touched in this process yet.
    keys.add(key)
  }

  const enqueue = <T>(operation: () => MaybePromise<T>): Promise<T> => {
    const next = operationQueue.then(operation, operation)
    operationQueue = next.then(() => undefined, () => undefined)
    return next
  }

  const enterBlockedState = (durableGeneration?: string, durableVerified = false) => {
    if (!writeBlocked) {
      operationGeneration += 1
      authKeysCleared = false
      fullStorageClearUsed = false
    }
    writeBlocked = true
    purgeVerified = false
    if (durableGeneration) blockedGeneration = durableGeneration
    if (durableVerified) markerVerified = true
  }

  const readBoundaryInsideQueue = async (): Promise<AuthBoundaryState> => {
    const current = await backing.getItem(logoutBlockKey)
    if (current) return parseBoundary(current)
    const legacy = await backing.getItem(legacyLogoutBlockKey)
    return parseBoundary(legacy)
  }

  // Capture the durable generation at controller construction, not lazily at
  // its first Auth call. A browser can freeze a newly-created tab before
  // auth-js performs getSession(); if another tab logs out and establishes a
  // new session meanwhile, the thawed old tab must still belong to the former
  // generation. Calling the async reader here starts the backing-store read
  // before this controller is returned to the caller. Its state adoption is
  // queued ahead of every adapter operation.
  const constructionBoundary = readBoundaryInsideQueue()
  void enqueue(async () => {
    if (writeBlocked) return
    let boundary: AuthBoundaryState
    try {
      boundary = await constructionBoundary
    } catch {
      markerVerified = false
      blockedGeneration = null
      enterBlockedState()
      return
    }
    if (boundary.mode === 'blocked') {
      enterBlockedState(boundary.generation, boundary.persisted)
      return
    }
    adoptedGeneration = boundary.generation
  })

  const persistBoundaryInsideQueue = async (
    mode: AuthBoundaryMode,
    durableGeneration: string,
  ): Promise<void> => {
    const serialized = serializeBoundary(mode, durableGeneration)
    await backing.setItem(logoutBlockKey, serialized)
    const persisted = parseBoundary(await backing.getItem(logoutBlockKey))
    if (
      !persisted.persisted ||
      persisted.mode !== mode ||
      persisted.generation !== durableGeneration
    ) {
      throw new Error('supabase_auth_boundary_not_persisted')
    }
    // The v2 key is authoritative once verified. Removing the old boolean
    // tombstone is best-effort and cannot weaken the new boundary.
    try { await backing.removeItem(legacyLogoutBlockKey) } catch {}
  }

  const persistBlockedBoundary = (): Promise<void> => enqueue(async () => {
    if (!blockedGeneration) blockedGeneration = newBoundaryGeneration()
    try {
      await persistBoundaryInsideQueue('blocked', blockedGeneration)
      markerVerified = true
    } catch (error) {
      markerVerified = false
      throw error
    }
  })

  const allowedGenerationInsideQueue = async (
    requestedOperationGeneration: number,
    expectedGeneration?: string,
  ): Promise<string | null> => {
    if (writeBlocked || requestedOperationGeneration !== operationGeneration) return null
    let boundary: AuthBoundaryState
    try {
      boundary = await readBoundaryInsideQueue()
    } catch {
      markerVerified = false
      blockedGeneration = null
      enterBlockedState()
      return null
    }

    if (boundary.mode === 'blocked') {
      enterBlockedState(boundary.generation, boundary.persisted)
      return null
    }

    if (adoptedGeneration === null) adoptedGeneration = boundary.generation
    if (
      adoptedGeneration !== boundary.generation ||
      (expectedGeneration !== undefined && expectedGeneration !== boundary.generation)
    ) {
      // Another tab established a newer allowed generation. This controller is
      // permanently stale until its own explicit new-session preparation.
      markerVerified = false
      blockedGeneration = null
      enterBlockedState()
      return null
    }
    return boundary.generation
  }

  const ownsCurrentBlockedBoundaryInsideQueue = async (): Promise<boolean> => {
    try {
      const boundary = await readBoundaryInsideQueue()
      if (
        boundary.mode === 'blocked' &&
        boundary.persisted &&
        (!blockedGeneration || blockedGeneration === boundary.generation)
      ) {
        blockedGeneration = boundary.generation
        markerVerified = true
        return true
      }
    } catch {}
    markerVerified = false
    return false
  }

  const eraseOwnLateWrite = async (key: string, encodedValue: string) => {
    try {
      const current = await backing.getItem(key)
      if (current === encodedValue) await erasePersistedKey(backing, key)
    } catch {
      // The generation envelope still prevents a fresh/new controller from
      // interpreting this old value as part of its current session.
    }
  }

  const storage: AuthStorageAdapter = {
    getItem(key: string) {
      remember(key)
      const requestedGeneration = operationGeneration
      if (writeBlocked) return Promise.resolve(null)
      return enqueue(async () => {
        const durableGeneration = await allowedGenerationInsideQueue(requestedGeneration)
        if (!durableGeneration) return null
        const rawValue = (await backing.getItem(key)) || null
        const stillAllowed = await allowedGenerationInsideQueue(
          requestedGeneration,
          durableGeneration,
        )
        if (!stillAllowed) return null
        return unwrapAuthValue(rawValue, durableGeneration)
      })
    },

    setItem(key: string, value: string) {
      remember(key)
      const requestedGeneration = operationGeneration
      if (writeBlocked) return Promise.reject(new Error('supabase_auth_persistence_blocked'))
      return enqueue(async () => {
        const durableGeneration = await allowedGenerationInsideQueue(requestedGeneration)
        if (!durableGeneration) {
          throw new Error('supabase_auth_persistence_blocked')
        }
        const encodedValue = wrapAuthValue(durableGeneration, value)
        await backing.setItem(key, encodedValue)
        // Re-read the shared durable generation after the physical write. A
        // logout/new login in another tab may have happened while an async
        // native store was awaiting completion.
        const stillAllowed = await allowedGenerationInsideQueue(
          requestedGeneration,
          durableGeneration,
        )
        if (!stillAllowed) {
          await eraseOwnLateWrite(key, encodedValue)
          throw new Error('supabase_auth_persistence_blocked')
        }
      })
    },

    removeItem(key: string) {
      remember(key)
      const requestedGeneration = operationGeneration
      return enqueue(async () => {
        if (writeBlocked) {
          // The controller that owns the current durable blocked generation may
          // let tokenless auth.signOut remove already-purged keys. A stale tab
          // facing a newer allowed generation gets a safe no-op instead.
          if (await ownsCurrentBlockedBoundaryInsideQueue()) {
            await backing.removeItem(key)
          }
          return
        }
        const durableGeneration = await allowedGenerationInsideQueue(requestedGeneration)
        if (!durableGeneration) return
        await backing.removeItem(key)
      })
    },
  }

  return {
    storageKey,
    logoutBlockKey,
    storage,

    async allowWrites() {
      if (!writeBlocked) return
      if (!purgeVerified || !authKeysCleared) {
        throw new Error('supabase_auth_storage_purge_unverified')
      }
      const nextGeneration = newBoundaryGeneration()
      await enqueue(async () => {
        await persistBoundaryInsideQueue('allowed', nextGeneration)
      })
      operationGeneration += 1
      adoptedGeneration = nextGeneration
      blockedGeneration = null
      markerVerified = false
      writeBlocked = false
    },

    async blockWrites() {
      if (!writeBlocked) {
        blockedGeneration = newBoundaryGeneration()
        markerVerified = false
      }
      enterBlockedState(blockedGeneration || undefined)
      try {
        await persistBlockedBoundary()
      } catch {
        // Individual Auth-key purge may still succeed. If it does not, purge()
        // will use clearAll only because cross-restart blocking is unverified.
      }
    },

    async syncPersistedBlock() {
      await enqueue(async () => {
        let boundary: AuthBoundaryState
        try {
          boundary = await readBoundaryInsideQueue()
        } catch {
          markerVerified = false
          blockedGeneration = null
          enterBlockedState()
          return
        }
        if (boundary.mode === 'blocked') {
          enterBlockedState(boundary.generation, boundary.persisted)
          return
        }
        if (adoptedGeneration === null) {
          adoptedGeneration = boundary.generation
        } else if (adoptedGeneration !== boundary.generation) {
          markerVerified = false
          blockedGeneration = null
          enterBlockedState()
        }
      })
    },

    isWriteBlocked() {
      return writeBlocked
    },

    isCrossRestartProtected() {
      // Empty Auth keys alone are not enough: another live tab can still write
      // its old token later. Only a durable blocked generation protects both
      // restart and multi-instance late writes.
      return writeBlocked && markerVerified
    },

    didUseFullStorageClear() {
      return fullStorageClearUsed
    },

    trackedKeys() {
      return [...keys]
    },

    async readAccessToken() {
      // Called before blockWrites(). Reading through the adapter waits behind
      // any earlier session save and therefore captures the newest persisted
      // token available for the best-effort remote revoke.
      return serializedAccessToken(await storage.getItem(storageKey))
    },

    async purge(options: { allowFullStorageClear?: boolean } = {}) {
      // Synchronous state transition first: calls queued by another task after
      // this line can no longer read or write the signed-out identity.
      enterBlockedState()
      let markerError: unknown | null = null
      if (!blockedGeneration) blockedGeneration = newBoundaryGeneration()
      try {
        // Always re-persist/re-verify: another tab may have changed the shared
        // boundary since this controller last observed it.
        await persistBlockedBoundary()
      } catch (error) {
        markerError = error
      }

      const purgeKeys = [...keys]
      const failures: unknown[] = []
      await enqueue(async () => {
        for (const key of purgeKeys) {
          try {
            await erasePersistedKey(backing, key)
          } catch (error) {
            failures.push(error)
          }
        }
      })

      if (failures.length > 0 || markerError) {
        authKeysCleared = false
        const mayClearAll = !markerVerified || options.allowFullStorageClear === true
        if (mayClearAll && backing.clearAll) {
          try {
            await enqueue(async () => {
              await backing.clearAll?.()
              for (const key of purgeKeys) {
                const remaining = await backing.getItem(key)
                if (remaining) throw new Error('supabase_full_storage_clear_not_applied')
              }
              if (!blockedGeneration) blockedGeneration = newBoundaryGeneration()
              await persistBoundaryInsideQueue('blocked', blockedGeneration)
            })
            fullStorageClearUsed = true
            authKeysCleared = true
            markerVerified = true
            purgeVerified = true
            return
          } catch (clearError) {
            failures.push(clearError)
          }
        }

        purgeVerified = false
        throw new AggregateError(
          markerError ? [markerError, ...failures] : failures,
          markerVerified
            ? 'supabase_auth_storage_purge_failed_marker_protected'
            : 'supabase_auth_storage_purge_failed_cross_restart_unprotected',
        )
      }

      authKeysCleared = true
      // Keep the blocked generation durable after successful cleanup. It is
      // replaced (never simply removed) by a new allowed generation only at an
      // explicit, verified new-session boundary.
      purgeVerified = markerVerified
      if (!purgeVerified) {
        throw new Error('supabase_auth_storage_purge_failed_cross_restart_unprotected')
      }
    },

    async waitForIdle() {
      await operationQueue
    },
  }
}

/**
 * Ordered local-first sign-out.  It intentionally calls auth.signOut only
 * after storage is blocked/purged, so auth-js sees no token and emits its
 * normal SIGNED_OUT notification without a second network dependency.
 */
export async function executeFailClosedAuthSignOut(
  auth: AuthClientForLocalPurge,
  controller: FailClosedAuthStorage,
): Promise<FailClosedSignOutResult> {
  const result: FailClosedSignOutResult = {
    accessTokenFound: false,
    stopAutoRefreshError: null,
    firstPurgeError: null,
    remoteRevokeError: null,
    signedOutEventError: null,
    finalPurgeError: null,
    crossRestartProtected: false,
    storageClearFallbackUsed: false,
  }

  let accessToken: string | null = null
  try {
    accessToken = await controller.readAccessToken()
    result.accessTokenFound = !!accessToken
  } catch {
    // Token capture is optional. Local purge remains authoritative.
  }

  await controller.blockWrites()
  try {
    await auth.stopAutoRefresh()
  } catch (error) {
    result.stopAutoRefreshError = error
  }

  try {
    await controller.purge()
  } catch (error) {
    result.firstPurgeError = error
  }

  if (accessToken) {
    try {
      // A server outage must not hold the local logout UI for the fetch
      // transport's full timeout. The request still has its own rejection
      // handler through Promise.race; local SIGNED_OUT proceeds after 5 s.
      const { error } = await settleWithin(auth.admin.signOut(accessToken, 'local'), 5000)
      result.remoteRevokeError = error
    } catch (error) {
      result.remoteRevokeError = error
    }
  }

  try {
    const { error } = await auth.signOut({ scope: 'local' })
    result.signedOutEventError = error
  } catch (error) {
    result.signedOutEventError = error
  } finally {
    try {
      await controller.purge()
    } catch (error) {
      result.finalPurgeError = error
    }
  }

  result.crossRestartProtected = controller.isCrossRestartProtected()
  result.storageClearFallbackUsed = controller.didUseFullStorageClear()

  return result
}
