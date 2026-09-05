import { sleep, check } from 'k6'
import { Counter } from 'k6/metrics'
import { supabaseInsert, randomString, loadTestAccounts, authenticateAccounts, sessionForVu } from './_shared.js'
import { databaseOutcome } from './_contracts.js'

const accepted = new Counter('accepted_posts')
const moderated = new Counter('moderated_posts')
export const options = {
  scenarios: { burst: { executor: 'ramping-vus', startVUs: 0,
    stages: [{ duration: '15s', target: 10 }, { duration: '45s', target: 30 },
      { duration: '30s', target: 30 }, { duration: '10s', target: 0 }], gracefulRampDown: '10s' } },
  thresholds: { checks: ['rate==1'], http_req_failed: ['rate<0.01'],
    'http_req_duration{op:insert_posts}': ['p(95)<1500'],
    accepted_posts: ['count>0'], moderated_posts: ['count>0'] },
}
const accounts = loadTestAccounts()
export function setup() { return authenticateAccounts(accounts) }
export default function (sessions) {
  const auth = sessionForVu(sessions)
  const forbidden = Math.random() < 0.3
  // Contact information is allowed by the current marketplace policy.
  const content = (forbidden ? 'fuck off' : 'Selling my desk lamp. Contact buyer@example.com') + ` ${randomString(12)}`
  const res = supabaseInsert('posts', { user_id: auth.user.id, content, images: [] }, auth.access_token)
  const outcome = databaseOutcome(res)
  accepted.add(outcome === 'accepted' ? 1 : 0)
  moderated.add(outcome === 'moderated' ? 1 : 0)
  check(res, { 'post accepted or refused for the expected rule': () =>
    outcome === 'limited' || (forbidden ? outcome === 'moderated' : outcome === 'accepted') })
  sleep(Math.random() * 1.5 + 0.2)
}
