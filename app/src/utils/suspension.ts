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

/** An active restriction: level 2-5, `until` in UTC seconds or null when permanent. */
export interface SuspensionRefusal {
  level: number
  until: string | null
}

const REFUSAL = /^suspension_active:([2-5]):(permanent|\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ)$/

/*
 * The server's write refusal: P0001 `suspension_active:<level>:<until>`, where
 * <until> is `permanent` or UTC seconds (it contains colons, so it is matched
 * whole). Accepts the PostgREST error, a bare message, or a Storage JSON body.
 * Anything else, including other P0001 errors and plain 403s, is not one.
 */
export function parseSuspensionRefusal(value: unknown): SuspensionRefusal | null {
  let error: any = value
  if (typeof error === 'string' && error.charAt(0) === '{') {
    try { error = JSON.parse(error) } catch { return null }
  }
  const message = typeof error === 'string' ? error : error?.message
  const code = typeof error === 'object' ? error?.code : undefined
  if (typeof message !== 'string' || (/^[0-9A-Z]{5}$/.test(code) && code !== 'P0001')) return null
  const match = REFUSAL.exec(message)
  if (!match || (match[2] !== 'permanent' && !Number.isFinite(Date.parse(match[2])))) return null
  return { level: Number(match[1]), until: match[2] === 'permanent' ? null : match[2] }
}

/** The account's own active restriction, in the shape the server would refuse with. */
export function activeRestriction(
  state: SuspensionGateState | null | undefined,
  nowMs = Date.now(),
): SuspensionRefusal | null {
  if (!state || !isSuspensionActive(state, nowMs)) return null
  const endMs = finiteSuspensionEndMs(state.suspended_until)
  return {
    level: Number(state.suspension_level),
    until: endMs === null ? null : new Date(endMs).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  }
}

export function restrictionError(restriction: SuspensionRefusal): Error {
  return Object.assign(
    new Error(`suspension_active:${restriction.level}:${restriction.until || 'permanent'}`),
    { code: 'P0001' },
  )
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
