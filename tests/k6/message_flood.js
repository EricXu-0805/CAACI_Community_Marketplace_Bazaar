import http from 'k6/http'
import { sleep, check } from 'k6'
import { Counter } from 'k6/metrics'
import { SUPABASE_URL, ANON_KEY, supabaseInsert, randomString, loadTestAccounts, authenticateAccounts, sessionForVu } from './_shared.js'
import { assertUuid, databaseOutcome } from './_contracts.js'

const accepted = new Counter('accepted_messages')
const moderated = new Counter('moderated_messages')
export const options = {
  scenarios: { flood: { executor: 'constant-arrival-rate', rate: 20, timeUnit: '1s',
    duration: '60s', preAllocatedVUs: 15, maxVUs: 40 } },
  thresholds: { checks: ['rate==1'], http_req_failed: ['rate<0.01'],
    'http_req_duration{op:insert_messages}': ['p(95)<1200'],
    accepted_messages: ['count>0'], moderated_messages: ['count>0'], dropped_iterations: ['count==0'] },
}
const accounts = loadTestAccounts()
const conversation = assertUuid(__ENV.CONVERSATION_ID, 'CONVERSATION_ID')
export function setup() {
  const sessions = authenticateAccounts(accounts)
  for (const session of sessions) {
    const result = http.get(`${SUPABASE_URL}/rest/v1/conversations?id=eq.${conversation}&select=id,buyer_id,seller_id`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${session.access_token}` }, timeout: '10s', redirects: 0,
    })
    if (result.status !== 200) throw new Error('Synthetic conversation preflight failed.')
    const rows = result.json()
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0].id !== conversation
      || ![rows[0].buyer_id, rows[0].seller_id].includes(session.user.id)) {
      throw new Error('Every account must be a participant in the synthetic conversation.')
    }
  }
  return sessions
}
export default function (sessions) {
  const auth = sessionForVu(sessions)
  const forbidden = Math.random() < 0.3
  const content = (forbidden ? 'fuck off' : 'Can you go a bit cheaper? wechat: student_123') + ` ${randomString(12)}`
  const res = supabaseInsert('messages', { conversation_id: conversation, sender_id: auth.user.id,
    content, message_type: 'text' }, auth.access_token)
  const outcome = databaseOutcome(res)
  accepted.add(outcome === 'accepted' ? 1 : 0)
  moderated.add(outcome === 'moderated' ? 1 : 0)
  check(res, { 'message accepted or refused for the expected rule': () =>
    outcome === 'limited' || (forbidden ? outcome === 'moderated' : outcome === 'accepted') })
  sleep(0.05)
}
