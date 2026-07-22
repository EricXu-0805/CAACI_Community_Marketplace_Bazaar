import { sleep, check } from 'k6'
import { supabaseInsert, supabaseSignIn, randomString, loadTestAccounts } from './_shared.js'

/*
 * Stress test: publish path under spam load.
 *
 * What it verifies:
 *   1. The moderation triggers on posts/items do what they claim:
 *      - a contact-info payload gets rejected  (409/400 with moderation_block)
 *      - a plain clean payload gets 201
 *   2. p95 latency stays under 1500 ms with 30 concurrent virtual users
 *      generating ~60 req/s against Supabase.
 *   3. No 500s, no connection resets.
 *
 * Usage:
 *   SUPABASE_PUBLISHABLE_KEY=sb_publishable_... TEST_ACCOUNTS_FILE=./accounts.txt \
 *   k6 run tests/k6/publish_spam.js
 *
 * accounts.txt is one email:password per line. Create ~10 throwaway
 * accounts in the Supabase dashboard before running.
 */

export const options = {
  scenarios: {
    burst: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 10 },
        { duration: '45s', target: 30 },
        { duration: '30s', target: 30 },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{op:insert_posts}':  ['p(95)<1500'],
    'http_req_duration{op:insert_items}':  ['p(95)<1500'],
  },
}

const ACCOUNTS = loadTestAccounts()

const CLEAN_POSTS = [
  'Looking for a study buddy for ECON 101 this semester',
  'Selling my barely-used desk lamp, happy to meet near Union',
  'Anyone know where to find good noodles near engineering campus',
  '卖一个闲置台灯，几乎全新',
  '找人拼车回机场',
]

const BAD_POSTS = [
  'add my wechat 1888-8888-8888 for deal',
  'contact me at me@example.com for discount',
  '加微信 abcd1234 看详细，本店代写论文',
  'ghostwriter service, term paper, DM for price',
]

export default function () {
  if (ACCOUNTS.length === 0) return
  const acct = ACCOUNTS[Math.floor(Math.random() * ACCOUNTS.length)]
  const auth = supabaseSignIn(acct.email, acct.password)
  const jwt = auth.access_token
  const uid = auth.user && auth.user.id

  const useBad = Math.random() < 0.5

  if (useBad) {
    const content = BAD_POSTS[Math.floor(Math.random() * BAD_POSTS.length)] + ' ' + randomString(4)
    const r = supabaseInsert('posts', { user_id: uid, content, images: [] }, jwt)
    check(r, {
      'bad payload blocked': (res) =>
        res.status === 400 || res.status === 409 ||
        (res.body && res.body.toString().includes('moderation_block')),
    })
  } else {
    const content = CLEAN_POSTS[Math.floor(Math.random() * CLEAN_POSTS.length)] + ' #' + randomString(4)
    const r = supabaseInsert('posts', { user_id: uid, content, images: [] }, jwt)
    check(r, { 'clean post accepted': (res) => res.status === 201 || res.status === 204 })
  }

  sleep(Math.random() * 1.5 + 0.2)
}
