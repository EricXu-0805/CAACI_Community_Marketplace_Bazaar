import http from 'k6/http'
import { check, sleep } from 'k6'
import { Counter } from 'k6/metrics'
import { APP_ORIGIN, loadTestAccounts, authenticateAccounts, sessionForVu } from './_shared.js'

const verdicts = new Counter('moderation_verdicts')
export const options = {
  scenarios: { ramp: { executor: 'ramping-arrival-rate', startRate: 5, timeUnit: '1s',
    preAllocatedVUs: 20, maxVUs: 60,
    stages: [{ duration: '20s', target: 20 }, { duration: '30s', target: 50 }, { duration: '15s', target: 10 }] } },
  thresholds: { checks: ['rate==1'], http_req_failed: ['rate<0.02'], http_req_duration: ['p(95)<2000'],
    moderation_verdicts: ['count>0'], dropped_iterations: ['count==0'] },
}
const accounts = loadTestAccounts()
export function setup() { return authenticateAccounts(accounts) }
export default function (sessions) {
  const session = sessionForVu(sessions)
  const res = http.post(`${APP_ORIGIN}/api/moderate`, JSON.stringify({ text: 'Selling my used textbook for $20.' }), {
    headers: { 'Content-Type': 'application/json', Origin: APP_ORIGIN, Authorization: `Bearer ${session.access_token}` },
    timeout: '10s', redirects: 0, responseCallback: http.expectedStatuses(200, 429),
  })
  let body
  try { body = res.json() } catch { body = null }
  const verdict = res.status === 200 && typeof body?.flagged === 'boolean' && body.skipped !== true
  verdicts.add(verdict ? 1 : 0)
  check(res, { 'authenticated verdict or explicit rate limit, never a missing provider': () =>
    verdict || (res.status === 429 && body?.error === 'rate_limited') })
  sleep(0.05)
}
