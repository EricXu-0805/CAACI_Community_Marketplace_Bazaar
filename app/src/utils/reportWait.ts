/*
 * P3.6 (SPEC 6.10): how long a reported target has been waiting, as the
 * moderation queue colours it. The wait runs from the oldest report on the
 * target that is still pending: more than 24 hours is marked, more than 48
 * hours is marked again.
 */
export type ReportWaitLevel = 0 | 24 | 48

export function reportWaitLevel(oldestPendingAt: string | null | undefined, now: number): ReportWaitLevel {
  const since = oldestPendingAt ? Date.parse(oldestPendingAt) : NaN
  if (!Number.isFinite(since)) return 0
  const hours = (now - since) / 3_600_000
  return hours > 48 ? 48 : hours > 24 ? 24 : 0
}
