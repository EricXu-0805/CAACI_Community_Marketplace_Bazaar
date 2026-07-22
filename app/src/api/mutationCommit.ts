export type MutationCommitState = 'not_committed' | 'unknown' | 'committed'

export type MutationOutcomeError = Error & {
  mutationCommitState: MutationCommitState
  /** Backward-compatible convenience flag for already-committed stale results. */
  mutationCommitted?: true
  code?: string
  status?: number
}

export function mutationCommitState(error: unknown): MutationCommitState | undefined {
  if (!error || typeof error !== 'object') return undefined
  const state = (error as { mutationCommitState?: unknown }).mutationCommitState
  return state === 'not_committed' || state === 'unknown' || state === 'committed'
    ? state
    : undefined
}

/**
 * Attach a commit outcome without discarding PostgREST error fields used by
 * friendlyErrorMessage. Non-extensible/foreign errors are copied into a new
 * Error so callers can always inspect the state.
 */
export function mutationOutcomeError(
  error: unknown,
  state: MutationCommitState,
): MutationOutcomeError {
  let tagged: MutationOutcomeError
  if (error instanceof Error && Object.isExtensible(error)) {
    tagged = error as MutationOutcomeError
  } else {
    const message = error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
      ? String((error as { message: string }).message)
      : error instanceof Error
        ? error.message
        : 'Mutation failed'
    tagged = new Error(message) as MutationOutcomeError
    if (error && typeof error === 'object') {
      for (const [key, value] of Object.entries(error as Record<string, unknown>)) {
        try { (tagged as unknown as Record<string, unknown>)[key] = value } catch {}
      }
    }
    try { (tagged as Error & { cause?: unknown }).cause = error } catch {}
  }

  tagged.mutationCommitState = state
  if (state === 'committed') tagged.mutationCommitted = true
  return tagged
}

/**
 * A structured SQLSTATE or explicit HTTP 4xx is a definite server rejection:
 * the transaction did not commit. Transport failures, 5xx responses and
 * unclassified PostgREST connectivity errors remain unknown and retain media.
 */
export function isDefinitiveMutationRejection(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = String((error as { code?: unknown }).code || '')
  if (/^[0-9A-Z]{5}$/.test(code)) return true

  const status = Number((error as { status?: unknown }).status)
  return Number.isInteger(status) && status >= 400 && status < 500
}

/** Only definitely uncommitted writes may compensate uploaded media. */
export function shouldCompensateMutationFailure(error: unknown): boolean {
  const state = mutationCommitState(error)
  // Errors thrown before a request starts are intentionally untagged and safe.
  return state === undefined || state === 'not_committed'
}
