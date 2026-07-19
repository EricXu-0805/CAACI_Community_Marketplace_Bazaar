/**
 * Durable client-side idempotency journal for privileged admin writes.
 *
 * An administrator can background the page after PostgreSQL commits but before
 * the response is observed. The admin token is deliberately erased on that
 * transition, so an in-memory retry key is not enough: a later unlock must
 * reuse the original key or the mutation can be applied twice.
 *
 * The journal stores only SHA-256-derived record ids, UUID idempotency keys and
 * timestamps. Raw admin tokens, request bodies and upload bytes never enter
 * durable storage. Unknown outcomes survive until authoritative reconciliation.
 * A definitive HTTP result becomes a tombstone and is removed only after the
 * caller applies or reloads the affected UI, or after explicit Owner recovery.
 * Capacity exhaustion fails closed instead of evicting evidence.
 */

export type AdminIdempotencyScope = 'mutation' | 'banner-upload'

export interface AdminIdempotencyHandle {
  readonly recordId: string
  readonly idempotencyKey: string
  /** True when this record belongs to an earlier same-intent request. */
  readonly reused: boolean
  /** True when an earlier same-intent request already reached a definitive result. */
  readonly resolved: boolean
}

export interface AdminIdempotencyRecoveryEntry extends AdminIdempotencyHandle {
  readonly createdAt: number
  readonly dispatchedAt: number
}

export interface AdminIdempotencyRecoverySnapshot {
  readonly resolvedCount: number
  readonly reservedCount: number
  readonly unknown: AdminIdempotencyRecoveryEntry[]
}

interface JournalEntry {
  id: string
  key: string
  createdAt: number
  /** Persisted immediately before transport so a crash cannot unlock unrelated writes. */
  dispatchedAt?: number
  resolvedAt?: number
}

interface JournalDocument {
  version: 1
  entries: JournalEntry[]
}

interface JournalStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

interface AdminIdempotencyDependencies {
  storage: JournalStorage
  digest(data: Uint8Array): Promise<Uint8Array>
  createUuid(): string
  withExclusiveLock<T>(operation: () => Promise<T>): Promise<T>
  withRequestLock?<T>(operation: () => Promise<T>): Promise<T>
  now(): number
}

export class AdminIdempotencyJournalError extends Error {
  readonly code = 'admin_idempotency_unavailable'

  constructor() {
    super('admin_idempotency_unavailable')
    this.name = 'AdminIdempotencyJournalError'
  }
}

export const ADMIN_IDEMPOTENCY_STORAGE_KEY = 'caaci.admin-idempotency-journal.v1'
const STORAGE_KEY = ADMIN_IDEMPOTENCY_STORAGE_KEY
const LOCK_NAME = 'caaci.admin-idempotency-journal.v1.lock'
const REQUEST_LOCK_NAME = 'caaci.admin-idempotency-journal.v1.request-lock'
const MAX_PENDING_ENTRIES = 128
// Resolved markers are durable acknowledgement tombstones. Transport only
// observes them; an exact post-render acknowledgement or explicit Owner
// recovery consumes them under the origin-wide request lock. Never silently
// evict markers during an unlocked session: doing so could turn a delayed tab
// into a duplicate privileged write. At capacity, reserve emits a
// non-dispatchable reconciliation barrier. Unknown outcomes are always retained.
const MAX_JOURNAL_ENTRIES = 4096
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DIGEST_PATTERN = /^[0-9a-f]{64}$/

let processLockTail: Promise<void> = Promise.resolve()
let processRequestLockTail: Promise<void> = Promise.resolve()

function fail(): never {
  throw new AdminIdempotencyJournalError()
}

function utf8(value: string): Uint8Array {
  try {
    return new TextEncoder().encode(value)
  } catch {
    return fail()
  }
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
}

function secureUuid(cryptoApi: Crypto): string {
  try {
    if (typeof cryptoApi.randomUUID === 'function') {
      const value = cryptoApi.randomUUID()
      if (UUID_PATTERN.test(value)) return value.toLowerCase()
    }
    const bytes = new Uint8Array(16)
    cryptoApi.getRandomValues(bytes)
    if (bytes.every(value => value === 0)) return fail()
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const value = `${hex(bytes.slice(0, 4))}-${hex(bytes.slice(4, 6))}-${hex(bytes.slice(6, 8))}-${hex(bytes.slice(8, 10))}-${hex(bytes.slice(10))}`
    if (!UUID_PATTERN.test(value)) return fail()
    return value
  } catch {
    return fail()
  }
}

async function processExclusive<T>(operation: () => Promise<T>): Promise<T> {
  const previous = processLockTail
  let release!: () => void
  processLockTail = new Promise<void>(resolve => { release = resolve })
  await previous.catch(() => {})
  try {
    return await operation()
  } finally {
    release()
  }
}

async function processRequestExclusive<T>(operation: () => Promise<T>): Promise<T> {
  const previous = processRequestLockTail
  let release!: () => void
  processRequestLockTail = new Promise<void>(resolve => { release = resolve })
  await previous.catch(() => {})
  try {
    return await operation()
  } finally {
    release()
  }
}

function defaultStorage(): JournalStorage {
  const uniStorage = (globalThis as any).uni
  if (
    uniStorage
    && typeof uniStorage.getStorageSync === 'function'
    && typeof uniStorage.setStorageSync === 'function'
    && typeof uniStorage.removeStorageSync === 'function'
  ) {
    return {
      getItem(key) {
        const value = uniStorage.getStorageSync(key)
        return typeof value === 'string' && value ? value : null
      },
      setItem(key, value) { uniStorage.setStorageSync(key, value) },
      removeItem(key) { uniStorage.removeStorageSync(key) },
    }
  }
  return fail()
}

function defaultDependencies(): AdminIdempotencyDependencies {
  const cryptoApi = globalThis.crypto
  if (
    !cryptoApi
    || !cryptoApi.subtle
    || typeof cryptoApi.subtle.digest !== 'function'
    || typeof cryptoApi.getRandomValues !== 'function'
  ) return fail()

  const browserLocks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  // A web admin console can be open in multiple tabs. Without Web Locks a
  // localStorage read/write pair is not atomic, so two tabs could dispatch
  // different keys for one action. Mini-program runtimes are single-process
  // and use the process mutex instead.
  if (typeof document !== 'undefined' && !browserLocks?.request) return fail()

  return {
    storage: defaultStorage(),
    async digest(data) {
      // Copy onto a concrete ArrayBuffer so TS 5.9's resizable-buffer types
      // cannot widen this to SharedArrayBufferLike at the Web Crypto boundary.
      const bytes = Uint8Array.from(data)
      const result = await cryptoApi.subtle.digest('SHA-256', bytes.buffer)
      return new Uint8Array(result)
    },
    createUuid: () => secureUuid(cryptoApi),
    withExclusiveLock: browserLocks?.request
      ? async operation => await browserLocks.request(
        LOCK_NAME,
        { mode: 'exclusive' },
        async () => await operation(),
      )
      : processExclusive,
    // Hold a separate origin-wide lock across reserve + transport + release.
    // The journal lock above stays short-lived and therefore cannot deadlock
    // when the request operation reads or updates its entry.
    withRequestLock: browserLocks?.request
      ? async operation => await browserLocks.request(
        REQUEST_LOCK_NAME,
        { mode: 'exclusive' },
        async () => await operation(),
      )
      : processRequestExclusive,
    now: () => Date.now(),
  }
}

function emptyJournal(): JournalDocument {
  return { version: 1, entries: [] }
}

function validateJournal(value: unknown): JournalDocument {
  if (!value || typeof value !== 'object') return fail()
  const candidate = value as Partial<JournalDocument>
  if (candidate.version !== 1 || !Array.isArray(candidate.entries)) return fail()
  if (candidate.entries.length > MAX_JOURNAL_ENTRIES) return fail()

  const ids = new Set<string>()
  const entries = candidate.entries.map(entry => {
    if (
      !entry
      || typeof entry !== 'object'
      || !DIGEST_PATTERN.test((entry as JournalEntry).id)
      || !UUID_PATTERN.test((entry as JournalEntry).key)
      || !Number.isSafeInteger((entry as JournalEntry).createdAt)
      || (entry as JournalEntry).createdAt <= 0
      || (
        (entry as JournalEntry).dispatchedAt !== undefined
        && (
          !Number.isSafeInteger((entry as JournalEntry).dispatchedAt)
          || (entry as JournalEntry).dispatchedAt! < (entry as JournalEntry).createdAt
          || (entry as JournalEntry).resolvedAt !== undefined
        )
      )
      || (
        (entry as JournalEntry).resolvedAt !== undefined
        && (
          !Number.isSafeInteger((entry as JournalEntry).resolvedAt)
          || (entry as JournalEntry).resolvedAt! < (entry as JournalEntry).createdAt
        )
      )
      || ids.has((entry as JournalEntry).id)
    ) return fail()
    ids.add((entry as JournalEntry).id)
    return {
      id: (entry as JournalEntry).id,
      key: (entry as JournalEntry).key.toLowerCase(),
      createdAt: (entry as JournalEntry).createdAt,
      ...((entry as JournalEntry).dispatchedAt === undefined
        ? {}
        : { dispatchedAt: (entry as JournalEntry).dispatchedAt }),
      ...((entry as JournalEntry).resolvedAt === undefined
        ? {}
        : { resolvedAt: (entry as JournalEntry).resolvedAt }),
    }
  })
  if (entries.filter(entry => entry.resolvedAt === undefined).length > MAX_PENDING_ENTRIES) {
    return fail()
  }
  return { version: 1, entries }
}

function readJournal(storage: JournalStorage): JournalDocument {
  let raw: string | null
  try {
    raw = storage.getItem(STORAGE_KEY)
  } catch {
    return fail()
  }
  if (raw === null) return emptyJournal()
  try {
    return validateJournal(JSON.parse(raw))
  } catch (error) {
    if (error instanceof AdminIdempotencyJournalError) throw error
    return fail()
  }
}

function writeJournal(storage: JournalStorage, journal: JournalDocument): void {
  const serialized = JSON.stringify(journal)
  try {
    if (journal.entries.length === 0) {
      storage.removeItem(STORAGE_KEY)
      if (storage.getItem(STORAGE_KEY) !== null) return fail()
      return
    }
    storage.setItem(STORAGE_KEY, serialized)
    if (storage.getItem(STORAGE_KEY) !== serialized) return fail()
  } catch {
    return fail()
  }
}

async function digestHex(
  dependencies: AdminIdempotencyDependencies,
  value: string | Uint8Array | ArrayBuffer,
): Promise<string> {
  const bytes = typeof value === 'string'
    ? utf8(value)
    : value instanceof Uint8Array
      ? value
      : new Uint8Array(value)
  try {
    const result = hex(await dependencies.digest(bytes))
    return DIGEST_PATTERN.test(result) ? result : fail()
  } catch (error) {
    if (error instanceof AdminIdempotencyJournalError) throw error
    return fail()
  }
}

export function createAdminIdempotencyJournal(
  dependencies: AdminIdempotencyDependencies = defaultDependencies(),
) {
  async function recordId(
    scope: AdminIdempotencyScope,
    adminToken: string,
    payload: string | Uint8Array | ArrayBuffer,
  ): Promise<string> {
    if (!adminToken || (scope !== 'mutation' && scope !== 'banner-upload')) return fail()
    const [tokenDigest, payloadDigest] = await Promise.all([
      digestHex(dependencies, adminToken),
      digestHex(dependencies, payload),
    ])
    return digestHex(dependencies, `v1\n${scope}\n${tokenDigest}\n${payloadDigest}`)
  }

  return {
    async reserve(
      scope: AdminIdempotencyScope,
      adminToken: string,
      payload: string | Uint8Array | ArrayBuffer,
    ): Promise<AdminIdempotencyHandle> {
      const id = await recordId(scope, adminToken, payload)
      return dependencies.withExclusiveLock(async () => {
        const journal = readJournal(dependencies.storage)
        const existing = journal.entries.find(entry => entry.id === id)
        if (existing) {
          return {
            recordId: id,
            idempotencyKey: existing.key,
            reused: true,
            resolved: existing.resolvedAt !== undefined,
          }
        }
        // Different intents may reserve while another tab is in flight, but
        // never dispatch here. The origin-wide request lock performs the
        // authoritative global unresolved/resolved barrier check immediately
        // before transport. This avoids falsely locking a queued action when
        // the earlier request finishes and is acknowledged first.
        const pendingCount = journal.entries.filter(entry => entry.resolvedAt === undefined).length
        if (pendingCount >= MAX_PENDING_ENTRIES) return fail()
        if (journal.entries.length >= MAX_JOURNAL_ENTRIES) {
          const barrierKey = dependencies.createUuid().toLowerCase()
          if (!UUID_PATTERN.test(barrierKey)) return fail()
          return {
            recordId: id,
            idempotencyKey: barrierKey,
            reused: true,
            resolved: true,
          }
        }
        const key = dependencies.createUuid().toLowerCase()
        if (!UUID_PATTERN.test(key)) return fail()
        const createdAt = dependencies.now()
        if (!Number.isSafeInteger(createdAt) || createdAt <= 0) return fail()
        const nextEntry = { id, key, createdAt }
        journal.entries.push(nextEntry)
        writeJournal(dependencies.storage, journal)
        return { recordId: id, idempotencyKey: key, reused: false, resolved: false }
      })
    },

    async markDispatched(handle: AdminIdempotencyHandle): Promise<boolean> {
      if (!DIGEST_PATTERN.test(handle.recordId) || !UUID_PATTERN.test(handle.idempotencyKey)) {
        return fail()
      }
      return dependencies.withExclusiveLock(async () => {
        const journal = readJournal(dependencies.storage)
        const current = journal.entries.find(entry => entry.id === handle.recordId)
        if (
          !current
          || current.key !== handle.idempotencyKey.toLowerCase()
          || current.resolvedAt !== undefined
        ) return fail()
        // Returning this state from the same locked read/write operation is
        // essential. `reused` only means a key was reserved before; another
        // tab may have reserved it before the first transport started, while
        // a different queued intent may never have reached transport at all.
        if (current.dispatchedAt !== undefined) return true
        const observedAt = dependencies.now()
        if (!Number.isSafeInteger(observedAt) || observedAt <= 0) return fail()
        writeJournal(dependencies.storage, {
          version: 1,
          entries: journal.entries.map(entry => entry.id === handle.recordId
            ? { ...entry, dispatchedAt: Math.max(observedAt, entry.createdAt) }
            : entry),
        })
        return false
      })
    },

    async hasOtherUnacknowledged(
      handle: AdminIdempotencyHandle,
      allowed: readonly AdminIdempotencyHandle[] = [],
    ): Promise<boolean> {
      if (!DIGEST_PATTERN.test(handle.recordId) || !UUID_PATTERN.test(handle.idempotencyKey)) {
        return fail()
      }
      if (allowed.length > MAX_PENDING_ENTRIES) return fail()
      const allowedKeys = new Map<string, string>()
      for (const candidate of allowed) {
        if (
          !DIGEST_PATTERN.test(candidate.recordId)
          || !UUID_PATTERN.test(candidate.idempotencyKey)
          || (
            allowedKeys.has(candidate.recordId)
            && allowedKeys.get(candidate.recordId) !== candidate.idempotencyKey.toLowerCase()
          )
        ) return fail()
        allowedKeys.set(candidate.recordId, candidate.idempotencyKey.toLowerCase())
      }
      return dependencies.withExclusiveLock(async () => {
        const journal = readJournal(dependencies.storage)
        const current = journal.entries.find(entry => entry.id === handle.recordId)
        if (!current || current.key !== handle.idempotencyKey.toLowerCase()) return true
        if (current.resolvedAt !== undefined) return true
        return journal.entries.some(entry => (
          entry.id !== handle.recordId
          && allowedKeys.get(entry.id) !== entry.key
          && (
            entry.resolvedAt !== undefined
            || entry.dispatchedAt !== undefined
          )
        ))
      })
    },

    async release(handle: AdminIdempotencyHandle): Promise<void> {
      if (!DIGEST_PATTERN.test(handle.recordId) || !UUID_PATTERN.test(handle.idempotencyKey)) {
        return fail()
      }
      await dependencies.withExclusiveLock(async () => {
        const journal = readJournal(dependencies.storage)
        const current = journal.entries.find(entry => entry.id === handle.recordId)
        // A missing entry was already superseded. A mismatched key belongs to
        // a newer logical action and must never be changed by a late response.
        if (!current || current.key !== handle.idempotencyKey.toLowerCase()) return
        if (current.resolvedAt !== undefined) return
        const observedAt = dependencies.now()
        if (!Number.isSafeInteger(observedAt) || observedAt <= 0) return fail()
        writeJournal(dependencies.storage, {
          version: 1,
          entries: journal.entries.map(entry => {
            if (entry.id !== handle.recordId) return entry
            return {
              id: entry.id,
              key: entry.key,
              createdAt: entry.createdAt,
              resolvedAt: Math.max(observedAt, entry.createdAt),
            }
          }),
        })
      })
    },

    async consumeResolved(handle: AdminIdempotencyHandle): Promise<boolean> {
      if (!DIGEST_PATTERN.test(handle.recordId) || !UUID_PATTERN.test(handle.idempotencyKey)) {
        return fail()
      }
      return dependencies.withExclusiveLock(async () => {
        const journal = readJournal(dependencies.storage)
        const current = journal.entries.find(entry => entry.id === handle.recordId)
        // A missing or mismatched record means this handle was already
        // reconciled or superseded. It must never be allowed to dispatch.
        if (!current || current.key !== handle.idempotencyKey.toLowerCase()) return true
        if (current.resolvedAt === undefined) return false
        writeJournal(dependencies.storage, {
          version: 1,
          entries: journal.entries.filter(entry => entry.id !== handle.recordId),
        })
        return true
      })
    },

    async isResolvedOrSuperseded(handle: AdminIdempotencyHandle): Promise<boolean> {
      if (!DIGEST_PATTERN.test(handle.recordId) || !UUID_PATTERN.test(handle.idempotencyKey)) {
        return fail()
      }
      return dependencies.withExclusiveLock(async () => {
        const journal = readJournal(dependencies.storage)
        const current = journal.entries.find(entry => entry.id === handle.recordId)
        // Read-only dispatch gate: explicit owner acknowledgement is the only
        // path that may remove a definitive tombstone. A missing/superseded
        // handle belongs to an older queued caller and must also stay inert.
        return !current
          || current.key !== handle.idempotencyKey.toLowerCase()
          || current.resolvedAt !== undefined
      })
    },

    async clearResolved(): Promise<number> {
      return dependencies.withExclusiveLock(async () => {
        const journal = readJournal(dependencies.storage)
        const pending = journal.entries.filter(entry => entry.resolvedAt === undefined)
        const removed = journal.entries.length - pending.length
        if (removed > 0) writeJournal(dependencies.storage, { version: 1, entries: pending })
        return removed
      })
    },

    async discardUndispatched(): Promise<number> {
      return dependencies.withExclusiveLock(async () => {
        const journal = readJournal(dependencies.storage)
        const retained = journal.entries.filter(entry => (
          entry.resolvedAt !== undefined || entry.dispatchedAt !== undefined
        ))
        const removed = journal.entries.length - retained.length
        if (removed > 0) writeJournal(dependencies.storage, { version: 1, entries: retained })
        return removed
      })
    },

    async inspect(): Promise<AdminIdempotencyRecoverySnapshot> {
      return dependencies.withExclusiveLock(async () => {
        const journal = readJournal(dependencies.storage)
        return {
          resolvedCount: journal.entries.filter(entry => entry.resolvedAt !== undefined).length,
          reservedCount: journal.entries.filter(entry => (
            entry.resolvedAt === undefined && entry.dispatchedAt === undefined
          )).length,
          unknown: journal.entries
            .filter((entry): entry is JournalEntry & { dispatchedAt: number } => (
              entry.resolvedAt === undefined && entry.dispatchedAt !== undefined
            ))
            .map(entry => ({
              recordId: entry.id,
              idempotencyKey: entry.key,
              reused: true,
              resolved: false,
              createdAt: entry.createdAt,
              dispatchedAt: entry.dispatchedAt,
            })),
        }
      })
    },

    async withRequestLock<T>(operation: () => Promise<T>): Promise<T> {
      return (dependencies.withRequestLock || processRequestExclusive)(operation)
    },
  }
}

let defaultJournal: ReturnType<typeof createAdminIdempotencyJournal> | null = null

function getDefaultJournal() {
  if (!defaultJournal) defaultJournal = createAdminIdempotencyJournal()
  return defaultJournal
}

export async function reserveAdminIdempotencyKey(
  scope: AdminIdempotencyScope,
  adminToken: string,
  payload: string | Uint8Array | ArrayBuffer,
): Promise<AdminIdempotencyHandle> {
  return getDefaultJournal().reserve(scope, adminToken, payload)
}

export async function releaseAdminIdempotencyKey(handle: AdminIdempotencyHandle): Promise<void> {
  await getDefaultJournal().release(handle)
}

export async function markAdminIdempotencyDispatchStarted(
  handle: AdminIdempotencyHandle,
): Promise<boolean> {
  return getDefaultJournal().markDispatched(handle)
}

export async function hasOtherAdminIdempotencyUnacknowledgedOutcome(
  handle: AdminIdempotencyHandle,
  allowed: readonly AdminIdempotencyHandle[] = [],
): Promise<boolean> {
  return getDefaultJournal().hasOtherUnacknowledged(handle, allowed)
}

export async function consumeResolvedAdminIdempotencyKey(
  handle: AdminIdempotencyHandle,
): Promise<boolean> {
  return getDefaultJournal().consumeResolved(handle)
}

export async function isAdminIdempotencyResolvedOrSuperseded(
  handle: AdminIdempotencyHandle,
): Promise<boolean> {
  return getDefaultJournal().isResolvedOrSuperseded(handle)
}

export async function clearResolvedAdminIdempotencyEntries(): Promise<number> {
  return getDefaultJournal().clearResolved()
}

export async function discardUndispatchedAdminIdempotencyEntries(): Promise<number> {
  return getDefaultJournal().discardUndispatched()
}

export async function inspectAdminIdempotencyRecovery(): Promise<AdminIdempotencyRecoverySnapshot> {
  return getDefaultJournal().inspect()
}

export async function withAdminIdempotencyRequestLock<T>(
  operation: () => Promise<T>,
): Promise<T> {
  return getDefaultJournal().withRequestLock(operation)
}
