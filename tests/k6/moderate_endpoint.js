import http from 'k6/http'
import { check, sleep } from 'k6'
import { APP_ORIGIN } from './_shared.js'

/*
 * Stress test: /api/moderate edge function.
 *
 * Confirms that the Vercel edge moderation proxy survives ~50 rps for
 * a minute without 5xx, and that p95 stays under 2 s (OpenAI API
 * typically responds in 300-800 ms).
 *
 * Unauthenticated — the endpoint is public (it's a pre-insert
 * advisory; the real trust boundary is the DB trigger).
 */

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-arrival-rate',
      startRate: 5,
      timeUnit: '1s',
      preAllocatedVUs: 20,
      maxVUs: 60,
      stages: [
        { duration: '20s', target: 20 },
        { duration: '30s', target: 50 },
        { duration: '15s', target: 10 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<2000'],
  },
}

const SAMPLES = [
  'hi there',
  'selling textbook $20',
  'i want to kill myself tonight',
  'selling nude photos',
  'fake id for sale dm me',
  'you are a worthless piece of garbage',
  '我想杀了他',
  '找代写，急需代考',
  '普通的二手家具出售',
]

export default function () {
  const text = SAMPLES[Math.floor(Math.random() * SAMPLES.length)]
  const res = http.post(
    `${APP_ORIGIN}/api/moderate`,
    JSON.stringify({ text }),
    { headers: { 'Content-Type': 'application/json' } },
  )
  check(res, {
    'status 200': (r) => r.status === 200,
    'has flagged field': (r) => {
      try {
        const j = r.json()
        return typeof j.flagged === 'boolean' || j.skipped === true
      } catch { return false }
    },
  })
  sleep(0.05)
}
