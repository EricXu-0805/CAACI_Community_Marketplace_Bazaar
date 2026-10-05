/** Support replies have a separate, once-only delivery ledger. Never retry a POST. */
export const SUPPORT_FROM = 'help@illinimarket.com'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HEADER_CONTROLS = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u
const DOT_ATOM = /^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+(?:\.[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+)*$/
const DOMAIN_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/

function wellFormed(value: string): boolean {
  // The u flag treats valid surrogate pairs as one code point; remaining
  // surrogate code points cannot be encoded as the confirmed UTF-8 text.
  return !/[\uD800-\uDFFF]/u.test(value)
}

function validRecipient(value: string): boolean {
  const parts = value.split('@')
  if (value.length > 254 || parts.length !== 2 || parts[0].length > 64 || !DOT_ATOM.test(parts[0])) return false
  const labels = parts[1].split('.')
  return labels.length >= 2 && parts[1].length <= 253
    && labels.every(label => DOMAIN_LABEL.test(label))
    && /^[A-Za-z]{2,63}$/.test(labels[labels.length - 1])
}

function validSubject(value: string): boolean {
  return value.length <= 200 && !!value.trim() && !HEADER_CONTROLS.test(value) && wellFormed(value)
}

function validMessageId(value: string): boolean {
  if (value.length > 254 || !value.startsWith('<') || !value.endsWith('>')) return false
  const parts = value.slice(1, -1).split('@')
  return parts.length === 2 && DOT_ATOM.test(parts[0]) && parts[1].split('.').every(label => DOMAIN_LABEL.test(label))
}

export interface SupportReplyDraft {
  to: string
  subject: string
  text: string
  /** Local reference only. Never included in the outgoing message or storage. */
  context: string
  inReplyTo: string
}

export interface SupportReplyPayload {
  action: 'send_support_reply'
  request_id: string
  to: string
  subject: string
  text: string
  in_reply_to: string | null
}

export interface SupportReplyReceipt {
  request_id: string
  status: 'sent' | 'pending' | 'unknown' | 'failed'
  provider_id: string | null
  to: string
  subject: string
  created_at: string
}

interface SupportReceiptStore {
  read(): string | null
  write(requestId: string): void
  remove(requestId: string): void
}

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface SupportReplyTransport {
  status(): Promise<unknown>
  receipt(requestId: string): Promise<unknown>
  send(payload: SupportReplyPayload): Promise<unknown>
}

class SupportReplyNotAttemptedError extends Error {
  constructor(readonly requestId: string, readonly reason: 'rateLimited' | 'unavailable') {
    super('support_email_not_attempted')
  }
}

/** Only these exact responses prove that this fresh submission never claimed a send. */
export function decodeSupportReplySendResponse(status: number, value: unknown, requestId: string): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const row = value as Record<string, unknown>
    const keys = Object.keys(row).sort().join(',')
    if (status >= 200 && status < 300 && keys === 'data' && row.data != null) return row.data
    if (keys === 'error,request_id,submission' && UUID.test(requestId)
      && row.request_id === requestId && row.submission === 'not_attempted') {
      if (status === 429 && row.error === 'support_email_rate_limited') {
        throw new SupportReplyNotAttemptedError(requestId, 'rateLimited')
      }
      if (status === 503 && row.error === 'support_email_unavailable') {
        throw new SupportReplyNotAttemptedError(requestId, 'unavailable')
      }
    }
  }
  throw new Error('support_email_outcome_unknown')
}

function failure(): never { throw new Error('support_receipt_storage') }

/** Only the actor UUID and request UUID are durable. A rotated owner token can recover. */
export function createSupportReceiptStore(storage: StorageLike, actorId: string): SupportReceiptStore {
  if (!UUID.test(actorId)) return failure()
  const key = `caaci.support-reply.v1.${actorId.toLowerCase()}`
  const read = () => {
    const value = storage.getItem(key)
    if (value !== null && !UUID.test(value)) return failure()
    return value
  }
  return {
    read,
    write(requestId) {
      if (!UUID.test(requestId) || read() !== null) return failure()
      storage.setItem(key, requestId)
      if (read() !== requestId) return failure()
    },
    remove(requestId) {
      if (read() !== requestId) return failure()
      storage.removeItem(key)
      if (read() !== null) return failure()
    },
  }
}

const emptyDraft = (): SupportReplyDraft => ({ to: '', subject: '', text: '', context: '', inReplyTo: '' })

export function createSupportReplyState() {
  return {
    draft: emptyDraft(),
    preview: null as SupportReplyDraft | null,
    receipt: null as SupportReplyReceipt | null,
    requestId: null as string | null,
    availability: 'idle' as 'idle' | 'loading' | 'available' | 'unavailable',
    busy: false,
    checking: false,
    error: '',
  }
}

export function supportDraftError(draft: SupportReplyDraft): string {
  const to = draft.to.trim()
  if (!validRecipient(to)) return 'recipient'
  if (!validSubject(draft.subject)) return 'subject'
  if (!draft.text.trim() || draft.text.length > 10000 || !wellFormed(draft.text)
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(draft.text)) return 'text'
  if (draft.context.length > 10000) return 'context'
  if (draft.inReplyTo && !validMessageId(draft.inReplyTo)) return 'messageId'
  return ''
}

function receiptIsValid(value: unknown, requestId: string, expected?: SupportReplyDraft): value is SupportReplyReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.keys(value).sort().join(',')
  if (keys !== 'created_at,provider_id,request_id,status,subject,to') return false
  const row = value as SupportReplyReceipt
  return row.request_id === requestId
    && ['sent', 'pending', 'unknown', 'failed'].includes(row.status)
    && (row.status === 'sent' ? typeof row.provider_id === 'string' && UUID.test(row.provider_id) : row.provider_id === null)
    && typeof row.to === 'string' && validRecipient(row.to)
    && typeof row.subject === 'string' && validSubject(row.subject)
    && typeof row.created_at === 'string' && row.created_at.length <= 64
    && ISO_TIMESTAMP.test(row.created_at) && Number.isFinite(Date.parse(row.created_at))
    && (!expected || (row.to === expected.to && row.subject === expected.subject))
}

interface SupportReplyDependencies {
  store: SupportReceiptStore
  transport: SupportReplyTransport
  uuid(): string
  /** Origin-wide lock prevents two open Admin tabs reserving separate sends. */
  withLock<T>(operation: () => Promise<T>): Promise<T>
}

export function createSupportReplyController(
  state: ReturnType<typeof createSupportReplyState>,
  dependencies: SupportReplyDependencies,
) {
  let active = true
  let initialized = false
  const current = () => active
  const editable = () => current() && !state.busy && !state.requestId

  function initialize() {
    if (!current() || initialized) return
    initialized = true
    try { state.requestId = dependencies.store.read() }
    catch { state.error = 'storage' }
  }

  async function refreshAvailability() {
    if (!current() || state.availability === 'loading' || state.busy) return
    state.availability = 'loading'
    try {
      const result = await dependencies.transport.status() as Record<string, unknown> | null
      if (!current()) return
      state.availability = result?.available === true
        && result.from === SUPPORT_FROM && result.reply_to === SUPPORT_FROM ? 'available' : 'unavailable'
    } catch {
      if (current()) state.availability = 'unavailable'
    }
  }

  function updateDraft(field: keyof SupportReplyDraft, value: string) {
    // uni-app can repeat the current value after blur/composition settles.
    // Only an actual change invalidates the exact snapshot being reviewed.
    if (!editable() || state.draft[field] === value) return
    state.draft[field] = value
    state.preview = null
    if (state.error !== 'storage') state.error = ''
  }

  function review() {
    initialize()
    if (!editable() || state.error === 'storage' || state.availability !== 'available') return
    state.error = supportDraftError(state.draft)
    state.preview = state.error ? null : { ...state.draft, to: state.draft.to.trim() }
  }

  function applyReceipt(value: unknown, requestId: string, expected?: SupportReplyDraft) {
    if (!receiptIsValid(value, requestId, expected)) throw new Error('support_receipt_invalid')
    // Pick bounded fields explicitly; never retain unexpected provider content.
    const { status, provider_id, to, subject, created_at } = value
    state.receipt = { request_id: requestId, status, provider_id, to, subject, created_at }
    state.error = ''
    if (status === 'sent' || status === 'failed') {
      state.draft = emptyDraft()
      state.preview = null
    }
  }

  async function sendConfirmed() {
    if (!editable() || !state.preview || state.availability !== 'available' || state.error === 'storage') return
    const snapshot = { ...state.draft, to: state.draft.to.trim() }
    if (supportDraftError(snapshot) || JSON.stringify(snapshot) !== JSON.stringify(state.preview)) {
      state.preview = null
      state.error = 'reviewAgain'
      return
    }
    // Synchronous guard before storage/transport awaits also covers keyboard activation.
    state.busy = true
    state.error = ''
    let dispatchId: string | null = null
    try {
      await dependencies.withLock(async () => {
        if (!current()) return
        const prior = dependencies.store.read()
        if (prior) {
          state.requestId = prior
          state.preview = null
          state.draft = emptyDraft()
          return
        }
        const requestId = dependencies.uuid()
        if (!UUID.test(requestId)) return failure()
        // Record before the one external attempt; crash/network loss keeps a read-only receipt.
        dependencies.store.write(requestId)
        state.requestId = requestId
        dispatchId = requestId
      })
      if (!current() || !dispatchId) return
      const result = await dependencies.transport.send({
        action: 'send_support_reply', request_id: dispatchId,
        to: snapshot.to, subject: snapshot.subject, text: snapshot.text,
        in_reply_to: snapshot.inReplyTo || null,
      })
      if (current()) applyReceipt(result, dispatchId, snapshot)
    } catch (error) {
      if (current() && dispatchId && state.requestId === dispatchId
        && error instanceof SupportReplyNotAttemptedError && error.requestId === dispatchId) {
        // This proof applies only to the fresh POST above, never to an existing
        // or recovered unknown receipt. Cleanup cannot remove another tab's ID.
        const rejectedRequestId = dispatchId
        state.preview = null
        try {
          await dependencies.withLock(async () => {
            if (!current() || state.requestId !== rejectedRequestId) return
            dependencies.store.remove(rejectedRequestId)
            state.requestId = null
            state.receipt = null
            state.error = error.reason === 'rateLimited' ? 'rateLimited' : 'notAttempted'
            if (error.reason === 'unavailable') state.availability = 'unavailable'
          })
        } catch {
          if (current()) state.error = 'storage'
        }
      } else if (current()) {
        state.error = state.requestId ? 'unknown' : 'storage'
      }
    } finally {
      if (current()) state.busy = false
    }
  }

  async function checkReceipt() {
    if (!current() || state.busy || state.checking || !state.requestId) return
    const requestId = state.requestId
    state.checking = true
    try {
      const result = await dependencies.transport.receipt(requestId)
      if (current() && state.requestId === requestId) applyReceipt(result, requestId, state.preview || undefined)
    } catch {
      if (current() && state.requestId === requestId) state.error = 'receipt'
    } finally {
      if (current()) state.checking = false
    }
  }

  async function finish() {
    if (!current() || state.busy || state.checking || !state.requestId
      || !state.receipt || !['sent', 'failed'].includes(state.receipt.status)) return
    state.busy = true
    const requestId = state.requestId
    try {
      await dependencies.withLock(async () => {
        if (!current()) return
        dependencies.store.remove(requestId)
        state.requestId = null
        state.receipt = null
        state.preview = null
        state.draft = emptyDraft()
        state.error = ''
      })
    } catch {
      if (current()) state.error = 'storage'
    } finally {
      if (current()) state.busy = false
    }
  }

  function dispose() {
    active = false
    Object.assign(state, createSupportReplyState())
    // Deliberately retain the opaque durable request ID for the same authorized actor.
  }

  return { initialize, refreshAvailability, updateDraft, review, sendConfirmed, checkReceipt, finish, dispose }
}
