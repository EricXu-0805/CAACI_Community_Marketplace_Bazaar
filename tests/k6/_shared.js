import http from 'k6/http'
import { check, fail } from 'k6'

export const SUPABASE_URL = (__ENV.SUPABASE_URL || '').replace(/\/+$/, '')
export const ANON_KEY     = __ENV.SUPABASE_PUBLISHABLE_KEY || __ENV.SUPABASE_ANON_KEY || ''
export const APP_ORIGIN   = (__ENV.APP_ORIGIN || '').replace(/\/+$/, '')

const TARGET_ENV = (__ENV.K6_TARGET_ENV || '').trim().toLowerCase()
const PRODUCTION_CONFIRMATION = 'I_UNDERSTAND_THIS_WILL_LOAD_PRODUCTION'

if (!SUPABASE_URL) {
  throw new Error('SUPABASE_URL is required before running k6; there is deliberately no production default.')
}

if (!APP_ORIGIN) {
  throw new Error('APP_ORIGIN is required before running k6; there is deliberately no production default.')
}

if (!['local', 'staging', 'production'].includes(TARGET_ENV)) {
  throw new Error('K6_TARGET_ENV must be explicitly set to local, staging, or production.')
}

if (TARGET_ENV === 'production' && __ENV.K6_ALLOW_PRODUCTION_LOAD_TESTS !== PRODUCTION_CONFIRMATION) {
  throw new Error(
    `Production load tests are blocked. Set K6_ALLOW_PRODUCTION_LOAD_TESTS=${PRODUCTION_CONFIRMATION} only after an approved maintenance plan.`,
  )
}

if (!ANON_KEY) {
  throw new Error('SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY is required before running k6.')
}

const TEST_ACCOUNTS_FILE = __ENV.TEST_ACCOUNTS_FILE || ''

export function loadTestAccounts() {
  if (!TEST_ACCOUNTS_FILE) return []
  const raw = open(TEST_ACCOUNTS_FILE)
  const lines = raw.split('\n').map(s => s.trim()).filter(Boolean)
  return lines.map(line => {
    const [email, password] = line.split(':')
    return { email, password }
  })
}

export function supabaseSignIn(email, password) {
  const url = `${SUPABASE_URL}/auth/v1/token?grant_type=password`
  const res = http.post(url, JSON.stringify({ email, password }), {
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
    },
    tags: { op: 'signin' },
  })
  const ok = check(res, { 'signin 200': r => r.status === 200 })
  if (!ok) fail(`signin failed for ${email}: ${res.status} ${res.body}`)
  return res.json()
}

export function supabaseInsert(table, payload, jwt) {
  return http.post(
    `${SUPABASE_URL}/rest/v1/${table}`,
    JSON.stringify(payload),
    {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      tags: { op: `insert_${table}` },
    },
  )
}

export function supabaseRpc(fnName, args, jwt) {
  return http.post(
    `${SUPABASE_URL}/rest/v1/rpc/${fnName}`,
    JSON.stringify(args || {}),
    {
      headers: {
        apikey: ANON_KEY,
        ...(jwt
          ? { Authorization: `Bearer ${jwt}` }
          : !/^sb_publishable_/.test(ANON_KEY)
            ? { Authorization: `Bearer ${ANON_KEY}` }
            : {}),
        'Content-Type': 'application/json',
      },
      tags: { op: `rpc_${fnName}` },
    },
  )
}

export function randomString(n = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < n; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

export function expectedBlockedBody(category) {
  return `moderation_block:${category}`
}
