import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { assertLoadTarget, parseAccounts, databaseOutcome } from '../tests/k6/_contracts.js'

const target = over => ({
  SUPABASE_URL: 'https://synthetic.supabase.co', APP_ORIGIN: 'https://synthetic.example.test',
  K6_EXPECTED_SUPABASE_URL: 'https://synthetic.supabase.co', K6_EXPECTED_APP_ORIGIN: 'https://synthetic.example.test',
  K6_TARGET_ENV: 'staging', K6_DATASET_IS_SYNTHETIC: 'true', ...over,
})
test('load targets require exact origins and refuse production disguised as staging', () => {
  assert.ok(assertLoadTarget(target()))
  assert.throws(() => assertLoadTarget(target({ K6_EXPECTED_APP_ORIGIN: 'https://other.test' })))
  assert.throws(() => assertLoadTarget(target({ K6_EXPECTED_SUPABASE_URL: '' })))
  assert.throws(() => assertLoadTarget(target({ K6_DATASET_IS_SYNTHETIC: 'false' })))
  assert.throws(() => assertLoadTarget(target({ APP_ORIGIN: 'https://user:password@synthetic.example.test' })))
  assert.throws(() => assertLoadTarget(target({ APP_ORIGIN: 'https://synthetic.example.test/path' })))
  assert.throws(() => assertLoadTarget(target({ K6_TARGET_ENV: 'local' })))
  for (const db of ['https://lfhvgprfphyfvhidegum.supabase.co']) {
    assert.throws(() => assertLoadTarget(target({ SUPABASE_URL: db, K6_EXPECTED_SUPABASE_URL: db })), /production/)
  }
  for (const app of ['https://illinimarket.com', 'https://www.illinimarket.com', 'https://caaci-community-marketplace-bazaar.vercel.app']) {
    assert.throws(() => assertLoadTarget(target({ APP_ORIGIN: app, K6_EXPECTED_APP_ORIGIN: app })), /production/)
  }
})
test('empty/malformed account files cannot pass and colon-containing passwords are intact', () => {
  for (const raw of ['', '\n ', 'missing-colon', 'a@example.com:']) assert.throws(() => parseAccounts(raw))
  assert.deepEqual(parseAccounts('a@example.test:password:with:colons\r\n'),
    [{ email: 'a@example.test', password: 'password:with:colons' }])
})
test('unrelated errors cannot masquerade as moderation, dedupe, or rate limiting', () => {
  const response = (status, code, message) => ({ status, body: JSON.stringify({ code, message }) })
  assert.equal(databaseOutcome(response(201)), 'accepted')
  assert.equal(databaseOutcome(response(400, 'P0001', 'moderation_block:sensitive_word')), 'moderated')
  assert.equal(databaseOutcome(response(400, 'P0001', 'rate_limit_messages_minute')), 'limited')
  assert.equal(databaseOutcome(response(409, '23505', 'duplicate key violates unique constraint "uq_reports_pending_per_reporter_target"')), 'duplicate_report')
  for (const bad of [response(0), response(401), response(403, '42501', 'permission denied'),
    response(400, 'PGRST204', 'column missing'), response(400, '23514', 'check constraint'),
    response(500, 'P0001', 'moderation_block:sensitive_word'), response(409, '23505', 'unrelated unique constraint')]) {
    assert.equal(databaseOutcome(bad), 'unexpected')
  }
})

function loadSuite(name, response) {
  const checks = [], calls = []
  const session = { access_token: 'synthetic-session', user: { id: '11111111-1111-4111-8111-111111111111' } }
  const runtime = {
    __ENV: { CONVERSATION_ID: '22222222-2222-4222-8222-222222222222', TARGET_PROFILE_ID: '33333333-3333-4333-8333-333333333333' },
    Counter: class { add() {} }, sleep() {},
    check: (res, predicates) => { for (const check of Object.values(predicates)) checks.push(check(res)) },
    randomString: () => 'uniquesuffix', loadTestAccounts: () => [{ email: 'test@example.invalid', password: 'pw' }],
    authenticateAccounts: () => [session], sessionForVu: () => session,
    assertUuid: value => value, databaseOutcome,
    supabaseInsert: (...args) => { calls.push(args); return response },
    APP_ORIGIN: 'https://synthetic.example.test', SUPABASE_URL: 'https://synthetic.supabase.co', ANON_KEY: 'public',
    http: { expectedStatuses: () => () => {}, post: (...args) => { calls.push(args); return response } },
  }
  const source = readFileSync(new URL(`../tests/k6/${name}.js`, import.meta.url), 'utf8')
    .replace(/^import .*$/gm, '').replace('export default function (sessions)', 'function run(sessions)').replace(/export /g, '')
  const suite = new Function(...Object.keys(runtime), `${source}\nreturn { options, setup, run }`)(...Object.values(runtime))
  return { suite, checks, calls, session }
}
for (const name of ['publish_spam', 'message_flood', 'report_abuse', 'moderate_endpoint']) {
  test(`${name} records failed checks for permission/schema failures and has a checks threshold`, () => {
    const response = { status: 403, body: '{"code":"42501"}', json() { return JSON.parse(this.body) } }
    const { suite, checks } = loadSuite(name, response)
    suite.run([])
    assert.deepEqual(suite.options.thresholds.checks, ['rate==1'])
    assert.ok(checks.length > 0)
    assert.ok(checks.every(result => result === false))
  })
}
test('moderation tests supply authentication and refuse skipped/no-provider verdicts', () => {
  for (const [body, expected] of [[{ flagged: false }, true], [{ flagged: false, skipped: true, reason: 'no_key' }, false]]) {
    const { suite, checks, calls } = loadSuite('moderate_endpoint', { status: 200, json: () => body })
    suite.run([])
    assert.equal(checks[0], expected)
    assert.equal(calls[0][2].headers.Authorization, 'Bearer synthetic-session')
  }
})
