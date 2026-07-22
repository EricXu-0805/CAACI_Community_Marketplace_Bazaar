export interface SuspensionGateState {
  suspension_level?: number | null
  suspended_until?: string | null
}

// setTimeout is a signed 32-bit delay in browsers and mini-program runtimes.
// Long L4 actions are therefore scheduled in bounded chunks.
export const MAX_SUSPENSION_TIMER_MS = 2_147_000_000
export const SUSPENSION_REFRESH_INTERVAL_MS = 60_000

export function finiteSuspensionEndMs(value?: string | null): number | null {
  if (!value || /^infinity$/i.test(value)) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function isSuspensionActive(
  state: SuspensionGateState | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!state?.suspension_level || state.suspension_level < 2) return false
  if (!state.suspended_until || /^infinity$/i.test(state.suspended_until)) {
    return true
  }
  const endMs = finiteSuspensionEndMs(state.suspended_until)
  // An unparseable server value must fail closed. The suspended page's
  // authoritative minute refresh still recovers after an admin lift.
  if (endMs === null) return true
  return endMs > nowMs
}

export function nextSuspensionExpiryDelayMs(
  endsAt?: string | null,
  nowMs = Date.now(),
): number | null {
  const endMs = finiteSuspensionEndMs(endsAt)
  if (endMs === null) return null
  const remaining = endMs - nowMs
  if (remaining <= 0) return 0
  return Math.min(MAX_SUSPENSION_TIMER_MS, remaining + 50)
}
