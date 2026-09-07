import { sleep, check } from 'k6'
import { Counter } from 'k6/metrics'
import { supabaseInsert, loadTestAccounts, authenticateAccounts, sessionForVu } from './_shared.js'
import { assertUuid, databaseOutcome } from './_contracts.js'

const accepted = new Counter('accepted_reports')
const duplicates = new Counter('duplicate_reports')
export const options = {
  scenarios: { bombard: { executor: 'constant-vus', vus: 10, duration: '30s' } },
  thresholds: { checks: ['rate==1'], http_req_failed: ['rate<0.01'],
    'http_req_duration{op:insert_reports}': ['p(95)<1200'],
    accepted_reports: ['count>0'], duplicate_reports: ['count>0'] },
}
const accounts = loadTestAccounts()
const target = assertUuid(__ENV.TARGET_PROFILE_ID, 'TARGET_PROFILE_ID')
export function setup() {
  const sessions = authenticateAccounts(accounts)
  if (sessions.some(session => session.user.id === target)) throw new Error('Report target must be a different synthetic account.')
  return sessions
}
export default function (sessions) {
  const auth = sessionForVu(sessions)
  const res = supabaseInsert('reports', { reporter_id: auth.user.id, target_type: 'user',
    target_id: target, reason: 'spam' }, auth.access_token)
  const outcome = databaseOutcome(res)
  accepted.add(outcome === 'accepted' ? 1 : 0)
  duplicates.add(outcome === 'duplicate_report' ? 1 : 0)
  check(res, { 'only the pending-report constraint or rate limit can reject': () =>
    ['accepted', 'duplicate_report', 'limited'].includes(outcome) })
  sleep(0.3)
}
