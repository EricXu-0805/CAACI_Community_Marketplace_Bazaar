import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { createClient } from '@supabase/supabase-js'

// SDK sequencing evidence only. The separate useAuth test exercises the app's
// actual 10-second timeout; this test does not reimplement its state machine.
// Every request terminates in the supplied in-memory fetch. No real storage,
// credentials, DNS, project endpoint, browser, or Sentry client is used.
const USER_ID = '11111111-1111-4111-8111-111111111111'
const FIXTURE_NOW = Date.parse('2026-10-08T17:00:00Z')

function session(expiresAt) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  return {
    access_token: `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
      sub: USER_ID, aud: 'authenticated', exp: expiresAt, iat: expiresAt - 3600,
    })}.synthetic-signature`,
    refresh_token: 'synthetic-only-delayed-initialization',
    expires_at: expiresAt,
    expires_in: 3600,
    token_type: 'bearer',
    user: {
      id: USER_ID, aud: 'authenticated', role: 'authenticated',
      email: 'sdk-delay@example.invalid', app_metadata: {}, user_metadata: {},
      created_at: '2026-01-01T00:00:00Z',
    },
  }
}

async function flush() {
  for (let index = 0; index < 100; index += 1) await Promise.resolve()
}

async function loadTransport() {
  const source = readFileSync(new URL('../src/api/transportBoundary.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
}

test('real SDK emits a late auth event when a held refresh succeeds after the app deadline but before the transport deadline', async t => {
  const { withTransportDeadlines } = await loadTransport()
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: FIXTURE_NOW })
  const storageKey = 'sb-synthetic-sdk-delay-auth-token'
  const values = new Map([[storageKey, JSON.stringify(session(FIXTURE_NOW / 1000 - 3600))]])
  const events = []
  const requests = []
  let release
  const responseGate = new Promise(resolve => { release = resolve })
  const client = createClient('https://sdk-delay.example.invalid', 'synthetic-public-key', {
    auth: {
      storageKey, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false,
      storage: {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => { values.set(key, value) },
        removeItem: key => { values.delete(key) },
      },
    },
    global: {
      fetch: withTransportDeadlines(async (input, init) => {
        const url = new URL(String(input))
        assert.equal(url.origin, 'https://sdk-delay.example.invalid')
        assert.equal(url.pathname, '/auth/v1/token')
        assert.equal(url.searchParams.get('grant_type'), 'refresh_token')
        requests.push({ startedAt: Date.now(), signal: init.signal })
        await responseGate
        return new Response(JSON.stringify(session(Date.now() / 1000 + 3600)), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        })
      }),
    },
  })
  const { data: { subscription } } = client.auth.onAuthStateChange((event, restored) => {
    events.push({ event, userId: restored?.user?.id ?? null, at: Date.now() })
  })
  let settled = false
  const pendingSession = client.auth.getSession().then(result => {
    settled = true
    return result
  })

  try {
    await flush()
    assert.equal(requests.length, 1)
    t.mock.timers.tick(10_001)
    await flush()
    assert.equal(settled, false, 'SDK getSession still waits on initialization')
    assert.deepEqual(events, [], 'no authoritative auth event arrived before app deadline')
    assert.equal(requests[0].signal.aborted, false, 'app deadline is not this transport abort boundary')

    t.mock.timers.tick(4_999)
    release()
    await flush()
    const result = await pendingSession
    assert.equal(result.error, null)
    assert.equal(result.data.session?.user.id, USER_ID)
    assert.ok(events.some(entry => entry.event === 'TOKEN_REFRESHED' && entry.userId === USER_ID))
    assert.ok(events.some(entry => entry.event === 'INITIAL_SESSION' && entry.userId === USER_ID))
    assert.ok(events.every(entry => entry.at >= FIXTURE_NOW + 15_000))
    assert.equal(requests[0].signal.aborted, false)
    assert.equal(requests.length, 1)
  } finally {
    release()
    subscription.unsubscribe()
    await client.auth.stopAutoRefresh()
    t.mock.timers.reset()
  }
})
