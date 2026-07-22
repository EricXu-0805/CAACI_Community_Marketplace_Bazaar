/**
 * Process-wide account identity guard.
 *
 * Several composables in this app intentionally expose module-singleton refs
 * so badges and membership state stay in sync across pages.  That also means a
 * request started for account A can finish after the auth session has changed
 * to account B.  A token captured here lets each async boundary reject that
 * stale completion before it writes to shared state.
 *
 * useAuth is the only owner of transitions.  Consumers may observe transitions
 * and capture/validate request tokens, but must not adopt an identity from a
 * query result themselves.
 */

export interface AccountRequestToken {
  readonly userId: string
  readonly generation: number
}

export interface AccountTransition {
  readonly userId: string | null
  readonly previousUserId: string | null
  readonly generation: number
}

type AccountTransitionListener = (transition: AccountTransition) => void

let activeUserId: string | null = null
let generation = 0
// Unlike `generation`, this advances only when the identity value changes.
// A local sign-out deliberately emits a second forced null -> null transition;
// that event belongs to the same anonymous ownership lineage. A -> null -> B
// -> null still advances twice and can never revive the original continuation.
let identityGeneration = 0
const listeners = new Set<AccountTransitionListener>()

export function getActiveAccountId(): string | null {
  return activeUserId
}

/** Called only by useAuth when the authoritative session identity changes. */
export function transitionAccount(userId: string | null, force = false): number {
  const previousUserId = activeUserId
  if (!force && previousUserId === userId) return generation

  activeUserId = userId
  generation += 1
  if (previousUserId !== userId) identityGeneration += 1
  const transition: AccountTransition = { userId, previousUserId, generation }
  for (const listener of Array.from(listeners)) {
    try {
      listener(transition)
    } catch {
      // An account transition must never be blocked by one cache's cleanup.
      console.warn('[accountScope] transition listener failed')
    }
  }
  return generation
}

export function captureAccountRequest(userId: string): AccountRequestToken {
  return { userId, generation }
}

export function captureActiveAccountRequest(): AccountRequestToken | null {
  if (!activeUserId) return null
  return captureAccountRequest(activeUserId)
}

export function isAccountRequestCurrent(token: AccountRequestToken | null): boolean {
  if (!token) return false
  return token.generation === generation && token.userId === activeUserId
}

/**
 * Validate a continuation that belongs to an identity transition rather than
 * to an authenticated request.  In particular, sign-out owns an anonymous
 * generation; an A -> anonymous -> B -> anonymous sequence must not make the
 * first sign-out current again merely because the active id is null again.
 */
export function isAccountTransitionCurrent(
  expectedGeneration: number,
  expectedUserId: string | null,
): boolean {
  return generation === expectedGeneration && activeUserId === expectedUserId
}

export function captureAccountIdentityGeneration(): number {
  return identityGeneration
}

export function isAccountIdentityGenerationCurrent(
  expectedIdentityGeneration: number,
  expectedUserId: string | null,
): boolean {
  return identityGeneration === expectedIdentityGeneration && activeUserId === expectedUserId
}

export function onAccountTransition(listener: AccountTransitionListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
