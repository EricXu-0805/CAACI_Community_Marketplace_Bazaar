/**
 * Ownership boundary for device-local data that predates account-scoped keys.
 *
 * These values can contain searches, unpublished copy, browsing history, and
 * chat preferences.  They may survive an auth setSession(A -> B) unless the
 * authoritative auth transition explicitly reconciles their owner.
 */

export const ACCOUNT_PRIVATE_STORAGE_OWNER_KEY = 'account_private_storage_owner_v1'
export const ACCOUNT_PRIVATE_STORAGE_CLEANUP_SENTINEL = 'privacy_cleanup_required'

export const ACCOUNT_PRIVATE_STORAGE_KEYS = [
  'viewHistory',
  'postViewHistory',
  'searchHistory',
  'publish_draft_v1',
  'pending_search',
  'pending_category',
  'chat_emoji_recent',
  'translate_cache_v2',
  'translate_cache_v1',
  // Retired unscoped WeChat identity cache from older app builds.
  'wechat_seccheck_openid',
] as const

export type AccountPrivateStorageKey = typeof ACCOUNT_PRIVATE_STORAGE_KEYS[number]

export interface SyncStorage {
  getStorageSync(key: string): unknown
  setStorageSync(key: string, value: unknown): void
  removeStorageSync(key: string): void
}

export interface AccountPrivateStorageReconciliation {
  cleanupAttempted: boolean
  unresolvedKeys: string[]
  ownerRecorded: boolean
}

type AccountPrivateStateResetter = () => void
const accountPrivateStateResetters = new Set<AccountPrivateStateResetter>()
const accountPrivateStateHydrators = new Set<AccountPrivateStateResetter>()

// `undefined` means the persisted auth session has not been reconciled yet.
// At that point only genuinely unowned anonymous data may be used. Once auth
// settles, access also requires the durable owner write/removal to have been
// verified so a storage-adapter failure cannot turn into a reader fail-open.
let reconciledRuntimeOwner: string | null | undefined
let reconciledRuntimeOwnerVerified = false

/**
 * Register synchronous cleanup for private module memory that exists only
 * after its owning module has been loaded. Unloaded modules have no memory to
 * clear and will observe the reconciled storage when they are imported later.
 */
export function registerAccountPrivateStateReset(
  resetter: AccountPrivateStateResetter,
): () => void {
  accountPrivateStateResetters.add(resetter)
  return () => accountPrivateStateResetters.delete(resetter)
}

/** Rehydrate loaded private module memory after the durable owner is safe. */
export function registerAccountPrivateStateHydrate(
  hydrator: AccountPrivateStateResetter,
): () => void {
  accountPrivateStateHydrators.add(hydrator)
  return () => accountPrivateStateHydrators.delete(hydrator)
}

function resetLoadedAccountPrivateState() {
  for (const resetter of Array.from(accountPrivateStateResetters)) {
    try { resetter() } catch { /* one cache must not block the privacy boundary */ }
  }
}

function hydrateLoadedAccountPrivateState() {
  for (const hydrator of Array.from(accountPrivateStateHydrators)) {
    try { hydrator() } catch { /* one cache must not block auth readiness */ }
  }
}

function isEmptyStorageValue(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

function eraseAndVerify(storage: SyncStorage, key: string): boolean {
  try { storage.removeStorageSync(key) } catch { /* verify/fallback below */ }
  try {
    if (isEmptyStorageValue(storage.getStorageSync(key))) return true
  } catch { /* fallback below */ }

  // Some uni storage adapters can fail remove while still accepting a write.
  // An empty value is understood as absent by every current consumer.
  try { storage.setStorageSync(key, '') } catch { return false }
  try { return isEmptyStorageValue(storage.getStorageSync(key)) } catch { return false }
}

type StoredOwnerState =
  | { readable: true; owner: string | null }
  | { readable: false; owner: null }

function readStoredOwner(storage: SyncStorage): StoredOwnerState {
  try {
    const raw = storage.getStorageSync(ACCOUNT_PRIVATE_STORAGE_OWNER_KEY)
    if (isEmptyStorageValue(raw)) return { readable: true, owner: null }
    if (typeof raw !== 'string' || !raw.trim()) return { readable: false, owner: null }
    return { readable: true, owner: raw }
  } catch {
    return { readable: false, owner: null }
  }
}

/**
 * True only when this runtime is allowed to observe or mutate unscoped private
 * storage. A prior owner's marker is never trusted while auth is unresolved.
 */
export function canAccessAccountPrivateStorage(storage: SyncStorage = uni): boolean {
  const stored = readStoredOwner(storage)
  if (!stored.readable || stored.owner === ACCOUNT_PRIVATE_STORAGE_CLEANUP_SENTINEL) return false

  if (reconciledRuntimeOwner === undefined) {
    // Preserve the legacy anonymous-draft contract without letting a durable
    // account owner flash on screen before the auth handshake completes.
    return stored.owner === null
  }
  if (!reconciledRuntimeOwnerVerified) return false
  if (reconciledRuntimeOwner === null) return stored.owner === null
  return stored.owner === reconciledRuntimeOwner
}

export interface AccountPrivateStorageRead<T> {
  allowed: boolean
  value: T
}

/** Read a private value without ever returning residue from another owner. */
export function readAccountPrivateStorage<T>(
  key: AccountPrivateStorageKey,
  fallback: T,
  storage: SyncStorage = uni,
): AccountPrivateStorageRead<T> {
  if (!canAccessAccountPrivateStorage(storage)) return { allowed: false, value: fallback }
  try {
    const value = storage.getStorageSync(key)
    return {
      allowed: true,
      value: isEmptyStorageValue(value) ? fallback : value as T,
    }
  } catch {
    return { allowed: false, value: fallback }
  }
}

/** Write only inside the currently verified owner lineage. */
export function writeAccountPrivateStorage(
  key: AccountPrivateStorageKey,
  value: unknown,
  storage: SyncStorage = uni,
): boolean {
  if (!canAccessAccountPrivateStorage(storage)) return false
  try {
    storage.setStorageSync(key, value)
    return true
  } catch {
    return false
  }
}

/** Remove only inside the currently verified owner lineage. */
export function removeAccountPrivateStorage(
  key: AccountPrivateStorageKey,
  storage: SyncStorage = uni,
): boolean {
  if (!canAccessAccountPrivateStorage(storage)) return false
  return eraseAndVerify(storage, key)
}

/**
 * Reconcile unscoped private storage after the account generation changes.
 * Anonymous data with no prior owner is preserved and adopted on first login;
 * owned data is erased before another account (or anonymous mode) can use it.
 */
export function reconcileAccountPrivateStorage(
  nextUserId: string | null,
  previousUserId: string | null,
  storage: SyncStorage = uni,
): AccountPrivateStorageReconciliation {
  const storedOwnerState = readStoredOwner(storage)
  // An unreadable/malformed marker must never be interpreted as anonymous.
  // Force a cleanup attempt, then require a verified replacement marker.
  const storedOwner = storedOwnerState.readable ? storedOwnerState.owner || '' : '__unreadable__'

  const runtimeOwnerChanged = Boolean(previousUserId && previousUserId !== nextUserId)
  const durableOwnerChanged = Boolean(storedOwner && storedOwner !== nextUserId)
  const cleanupAttempted = runtimeOwnerChanged || durableOwnerChanged
  const unresolvedKeys: string[] = []

  const memoryOwnerChanged = previousUserId !== nextUserId
  if (cleanupAttempted) {
    for (const key of ACCOUNT_PRIVATE_STORAGE_KEYS) {
      if (!eraseAndVerify(storage, key)) unresolvedKeys.push(key)
    }
    // This must remain synchronous. A lazy import started for A -> B can
    // otherwise finish after B -> C and erase C's newly-created in-memory
    // history/cache even though C owns the current account generation.
  }
  if (cleanupAttempted || memoryOwnerChanged) resetLoadedAccountPrivateState()

  let ownerRecorded = false
  if (nextUserId) {
    // A sentinel intentionally cannot equal a Supabase user id. If cleanup was
    // incomplete, the next reconciliation retries instead of blessing residue
    // as belonging to the new account.
    const ownerValue = unresolvedKeys.length === 0
      ? nextUserId
      : ACCOUNT_PRIVATE_STORAGE_CLEANUP_SENTINEL
    try {
      storage.setStorageSync(ACCOUNT_PRIVATE_STORAGE_OWNER_KEY, ownerValue)
      ownerRecorded = storage.getStorageSync(ACCOUNT_PRIVATE_STORAGE_OWNER_KEY) === ownerValue
    } catch { ownerRecorded = false }
  } else if (unresolvedKeys.length > 0) {
    try {
      storage.setStorageSync(ACCOUNT_PRIVATE_STORAGE_OWNER_KEY, ACCOUNT_PRIVATE_STORAGE_CLEANUP_SENTINEL)
      ownerRecorded = storage.getStorageSync(ACCOUNT_PRIVATE_STORAGE_OWNER_KEY) === ACCOUNT_PRIVATE_STORAGE_CLEANUP_SENTINEL
    } catch { ownerRecorded = false }
  } else {
    ownerRecorded = eraseAndVerify(storage, ACCOUNT_PRIVATE_STORAGE_OWNER_KEY)
  }

  reconciledRuntimeOwner = nextUserId
  reconciledRuntimeOwnerVerified = unresolvedKeys.length === 0 && ownerRecorded
  if (reconciledRuntimeOwnerVerified && canAccessAccountPrivateStorage(storage)) {
    hydrateLoadedAccountPrivateState()
  }

  return { cleanupAttempted, unresolvedKeys, ownerRecorded }
}
