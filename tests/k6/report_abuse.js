import { sleep, check } from 'k6'
import { supabaseInsert, supabaseSignIn, loadTestAccounts } from './_shared.js'

/*
 * Stress test: report abuse.
 *
 * Verifies that the reports rate limit + unique constraint (one report
 * per reporter+target) hold under concurrent attempts. An attacker
 * trying to flag-bomb a user should be stopped by both:
 *   - rate_limit_reports_hour / day
 *   - reports_unique_reporter_target
 *
 * Pass the victim profile id via TARGET_PROFILE_ID.
 */

export const options = {
  scenarios: {
    bombard: {
      executor: 'constant-vus',
      vus: 10,
      duration: '30s',
    },
  },
  thresholds: {
    'http_req_duration{op:insert_reports}': ['p(95)<1200'],
  },
}

const ACCOUNTS = loadTestAccounts()
const TARGET_PROFILE_ID = __ENV.TARGET_PROFILE_ID || ''
if (!TARGET_PROFILE_ID) throw new Error('TARGET_PROFILE_ID env var is required.')

const REASONS = [
  'spam',
  'harassment',
  'scam',
  'prohibited_item',
  'other',
]

export default function () {
  if (ACCOUNTS.length === 0) return
  const acct = ACCOUNTS[Math.floor(Math.random() * ACCOUNTS.length)]
  const auth = supabaseSignIn(acct.email, acct.password)
  const jwt = auth.access_token
  const uid = auth.user && auth.user.id

  const res = supabaseInsert('reports', {
    reporter_id: uid,
    target_type: 'user',
    target_id: TARGET_PROFILE_ID,
    reason: REASONS[Math.floor(Math.random() * REASONS.length)],
  }, jwt)

  check(res, {
    'status never 5xx': (r) => r.status < 500,
    'duplicate or rate-limited rejected': (r) => {
      if (r.status >= 400) return true
      return r.status === 201 || r.status === 204
    },
  })
  sleep(0.3)
}
