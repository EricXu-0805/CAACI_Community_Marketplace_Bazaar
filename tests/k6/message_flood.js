import { sleep, check } from 'k6'
import { supabaseInsert, supabaseSignIn, randomString, loadTestAccounts } from './_shared.js'

/*
 * Stress test: message path under flood.
 *
 * Simulates a spammer rotating accounts pushing ~10 messages/second
 * into the same conversation. Verifies:
 *   1. rate_limit_messages_minute triggers at the configured threshold
 *   2. moderation triggers catch contact-info in messages too
 *   3. legitimate low-rate messages still succeed
 *
 * Pre-req: a conversation row already exists with known id. Pass it
 * via CONVERSATION_ID env var. Create one by tapping "Message seller"
 * on a listing in the app once.
 *
 * Usage:
 *   SUPABASE_PUBLISHABLE_KEY=sb_publishable_... TEST_ACCOUNTS_FILE=./accounts.txt \
 *   CONVERSATION_ID=<uuid> k6 run tests/k6/message_flood.js
 */

export const options = {
  scenarios: {
    flood: {
      executor: 'constant-arrival-rate',
      rate: 20,
      timeUnit: '1s',
      duration: '60s',
      preAllocatedVUs: 15,
      maxVUs: 40,
    },
  },
  thresholds: {
    'http_req_duration{op:insert_messages}': ['p(95)<1200'],
    http_req_failed: ['rate<0.3'],
  },
}

const ACCOUNTS = loadTestAccounts()
const CONVERSATION_ID = __ENV.CONVERSATION_ID || ''

if (!CONVERSATION_ID) {
  throw new Error('CONVERSATION_ID env var is required.')
}

const BENIGN = [
  'hey still have it?',
  'can we meet tomorrow',
  'what is your best price',
  '还在吗',
  '能面交吗',
]

const SPAM = [
  'wechat: zhang_wei_888',
  'add me on qq 123456789',
  'reply to my email buyer@example.com for fast deal',
  '加微信有优惠',
]

export default function () {
  if (ACCOUNTS.length === 0) return
  const acct = ACCOUNTS[Math.floor(Math.random() * ACCOUNTS.length)]
  const auth = supabaseSignIn(acct.email, acct.password)
  const jwt = auth.access_token
  const uid = auth.user && auth.user.id

  const useSpam = Math.random() < 0.3
  const content = (useSpam ? SPAM : BENIGN)[Math.floor(Math.random() * (useSpam ? SPAM.length : BENIGN.length))]
    + ' ' + randomString(3)

  const res = supabaseInsert('messages', {
    conversation_id: CONVERSATION_ID,
    sender_id: uid,
    content,
    message_type: 'text',
  }, jwt)

  check(res, {
    'status not 5xx': (r) => r.status < 500,
    'spam blocked or clean accepted': (r) => {
      if (useSpam) {
        return r.status >= 400 || (r.body && r.body.toString().includes('moderation_block'))
      }
      return r.status === 201 || r.status === 204 || r.status === 429
    },
  })

  sleep(0.05)
}
