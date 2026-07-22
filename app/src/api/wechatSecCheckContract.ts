export type WechatTextGateOutcome = 'disabled' | 'pass' | 'block' | 'unavailable'

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/** Interpret only the small response vocabulary the client can act on safely. */
export function wechatTextGateOutcome(value: unknown): WechatTextGateOutcome {
  const data = record(value)
  if (!data) return 'unavailable'
  if (
    data.ok === true
    && data.degraded === true
    && data.reason === 'not_configured'
  ) return 'disabled'
  if (
    data.ok === false
    && data.degraded !== true
    && (data.suggest === 'risky' || data.suggest === 'review')
  ) return 'block'
  if (data.ok === true && data.degraded !== true && data.suggest === 'pass') return 'pass'
  return 'unavailable'
}

/** Media is publishable only after a concrete, non-degraded durable trace. */
export function hasDurableWechatMediaHandoff(value: unknown): boolean {
  const data = record(value)
  return !!data
    && data.ok === true
    && data.degraded !== true
    && typeof data.trace_id === 'string'
    && /^[A-Za-z0-9_-]{4,128}$/.test(data.trace_id)
}
