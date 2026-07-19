import {
  captureAccountRequest,
  isAccountRequestCurrent,
  onAccountTransition,
  type AccountRequestToken,
  type AccountTransition,
} from './accountScope'

/**
 * Page-local companion to the process-wide account generation guard.
 *
 * AccountRequestToken rejects A after A -> B. The extra request epoch also
 * rejects an older request for the same account after a newer refresh starts.
 * Account-transition invalidation runs synchronously, before Vue watchers or
 * network continuations can render the previous account's page-local refs.
 */
export interface AccountPageRequest {
  readonly accountToken: AccountRequestToken
  readonly requestEpoch: number
}

export interface AccountPageScope {
  begin(userId: string): AccountPageRequest | null
  isCurrent(request: AccountPageRequest | null): boolean
  invalidate(): void
  dispose(): void
}

export function createAccountPageScope(
  onTransition: (transition: AccountTransition) => void,
): AccountPageScope {
  let requestEpoch = 0
  let disposed = false

  const stopAccountTransitionListener = onAccountTransition((transition) => {
    if (disposed) return
    requestEpoch += 1
    onTransition(transition)
  })

  return {
    begin(userId: string): AccountPageRequest | null {
      if (disposed) return null
      const accountToken = captureAccountRequest(userId)
      // A delayed caller must not invalidate B's already-running request.
      if (!isAccountRequestCurrent(accountToken)) return null
      requestEpoch += 1
      return { accountToken, requestEpoch }
    },

    isCurrent(request: AccountPageRequest | null): boolean {
      return !!request
        && !disposed
        && request.requestEpoch === requestEpoch
        && isAccountRequestCurrent(request.accountToken)
    },

    invalidate(): void {
      if (!disposed) requestEpoch += 1
    },

    dispose(): void {
      if (disposed) return
      disposed = true
      requestEpoch += 1
      stopAccountTransitionListener()
    },
  }
}
