import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createContext, Script } from 'node:vm'
import ts from 'typescript'
import { createClient } from '@supabase/supabase-js'
import { createHarness, deferred, flush, OWNER } from './helpers/auth-init-harness.mjs'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const origin = 'https://logout-order.example.invalid'
const source = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
function compile(input, module = ts.ModuleKind.CommonJS) {
  return ts.transpileModule(input, {
    compilerOptions: { module, target: ts.ScriptTarget.ES2022 },
  }).outputText
}
async function persistenceModule() {
  const code = compile(source('api/authPersistence.ts'), ts.ModuleKind.ES2022)
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}
function session(id) {
  const now = Math.floor(Date.now() / 1000)
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  return {
    access_token: `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: id, aud: 'authenticated', exp: now + 3600, iat: now })}.synthetic`,
    refresh_token: 'local-synthetic-refresh', expires_at: now + 3600, expires_in: 3600,
    token_type: 'bearer',
    user: { id, aud: 'authenticated', role: 'authenticated', email: 'fixture@example.invalid',
      app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
  }
}

// Execute the real useSupabase orchestration with an actual SDK client and
// actual persistence controller. Only platform/config/transport setup is stubbed;
// no production env, tokens, network or credentials are read by this test.
function boundaryModule(client, persistence, controller) {
  const identity = value => value
  const dependencies = new Map([
    ['../utils/platformGlobals', {}],
    ['@supabase/supabase-js', { createClient: () => client }],
    ['../utils/mpFetch', { makeMpFetch: () => () => { throw new Error('Unexpected platform request') } }],
    ['../api/authPersistence', { ...persistence, createFailClosedAuthStorage: () => controller }],
    ['../api/transportBoundary', { withTransportDeadlines: identity }],
    ['../utils/supabaseKeys', { preferredSupabasePublicKey: () => 'synthetic-public-key', withSupabaseApiKeySemantics: identity }],
    ['../api/privateRealtime', { installRealtimeAuthSerialization: () => {} }],
  ])
  const context = createContext({
    URL, console, fixtureEnv: { VITE_SUPABASE_URL: origin, VITE_SUPABASE_PUBLISHABLE_KEY: 'synthetic-public-key' },
    fetch: () => { throw new Error('Unexpected global fetch') },
    uni: {},
  })
  const exports = {}
  const code = compile(source('composables/useSupabase.ts').replaceAll('import.meta.env', 'fixtureEnv'))
  new Script(`(function(require, exports) {${code}\n})`).runInContext(context)(name => {
    assert.ok(dependencies.has(name), `Unexpected boundary dependency: ${name}`)
    return dependencies.get(name)
  }, exports)
  return exports
}

for (const nextId of [A, B]) {
  test(`logout rejects SDK refresh events during token capture and after cleanup, then allows explicit ${nextId === A ? 'same-account' : 'different-account'} login`, { timeout: 10000 }, async () => {
    const persistence = await persistenceModule()
    const key = `sb-logout-order-${nextId}-auth-token`
    const values = new Map([[key, JSON.stringify(session(A))]])
    const controller = persistence.createFailClosedAuthStorage({
      getItem: name => values.get(name) ?? null,
      setItem: (name, value) => { values.set(name, value) },
      removeItem: name => { values.delete(name) },
    }, key)
    let refreshed = 0
    let revoked = 0
    const client = createClient(origin, 'synthetic-public-key', {
      auth: { storage: controller.storage, storageKey: key, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: async input => {
        const url = new URL(String(input))
        assert.equal(url.origin, origin)
        if (url.pathname === '/auth/v1/token') {
          assert.equal(url.searchParams.get('grant_type'), 'refresh_token')
          refreshed += 1
          return new Response(JSON.stringify(session(A)), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }
        assert.equal(url.pathname, '/auth/v1/logout')
        revoked += 1
        return new Response(null, { status: 204 })
      } },
    })
    const boundary = boundaryModule(client, persistence, controller)
    const h = createHarness({ authBoundary: {
      prepareSupabaseAuthPersistence: boundary.prepareSupabaseAuthPersistence,
      failClosedSupabaseSignOut: boundary.failClosedSupabaseSignOut,
      ...(boundary.canAcceptSupabaseAuthSession ? { canAcceptSupabaseAuthSession: boundary.canAcceptSupabaseAuthSession } : {}),
    } })
    h.storage.set(OWNER, A)
    const init = h.auth.init()
    const events = []
    const { data: { subscription } } = client.auth.onAuthStateChange((event, value) => {
      events.push(event)
      h.emit(event, value)
    })
    const captureStarted = deferred()
    const releaseCapture = deferred()
    const readAccessToken = controller.readAccessToken.bind(controller)
    controller.readAccessToken = async () => {
      captureStarted.resolve()
      await releaseCapture.promise
      return readAccessToken()
    }
    let logout
    let duringCapture
    let afterCleanup
    try {
      h.getSession.resolve(await client.auth.getSession())
      await init
      await flush()
      assert.equal(h.scope.getActiveAccountId(), A)
      const transitionCount = h.calls.transitions.length
      const profileCalls = h.calls.profiles.length
      logout = h.auth.signOut({ redirect: false })
      assert.equal(h.scope.getActiveAccountId(), null)
      await captureStarted.promise
      // This real SDK refresh completes while logout is deliberately still
      // capturing its revoke token. Storage is not yet write-blocked here.
      assert.equal(controller.isWriteBlocked(), false)
      assert.equal(boundary.canAcceptSupabaseAuthSession(), false)
      const refreshedSession = await client.auth.refreshSession()
      assert.equal(refreshedSession.error, null)
      await flush()
      assert.ok(events.includes('TOKEN_REFRESHED'), 'SDK really emitted the positive event')
      duringCapture = h.scope.getActiveAccountId()
      releaseCapture.resolve()
      const logoutOwnsNavigation = await logout
      assert.equal(controller.isWriteBlocked(), true)
      assert.equal(boundary.canAcceptSupabaseAuthSession(), false)
      // Model an already queued SDK/broadcast notification without bypassing
      // the actual SDK subscriber delivery path. No remote broadcast occurs.
      await client.auth._notifyAllSubscribers('TOKEN_REFRESHED', session(A), false)
      await flush()
      afterCleanup = h.scope.getActiveAccountId()
      const invalidResurrections = h.calls.transitions.slice(transitionCount).filter(change => change.userId)
      assert.equal(duringCapture, null, 'logout must not briefly restore A while capturing its revoke token')
      assert.equal(afterCleanup, null, 'persistently blocked auth must reject a queued positive event')
      assert.deepEqual(invalidResurrections, [])
      assert.equal(h.calls.profiles.length, profileCalls, 'rejected events must not launch private profile work')
      assert.equal(logoutOwnsNavigation, true, 'an old SDK event must not steal logout continuation ownership')
      assert.equal(refreshed, 1)
      assert.equal(revoked, 1, 'the original best-effort remote revoke must remain intact')
      assert.equal(values.has(key), false)
      await boundary.prepareSupabaseAuthPersistence()
      assert.equal(controller.isWriteBlocked(), false)
      assert.equal(boundary.canAcceptSupabaseAuthSession(), true)
      await controller.storage.setItem(key, JSON.stringify(session(nextId)))
      await client.auth._notifyAllSubscribers('SIGNED_IN', session(nextId), false)
      await flush()
      assert.equal(h.scope.getActiveAccountId(), nextId)
      assert.equal(h.auth.authState.value, 'authenticated')
      h.assertIsolated()
    } finally {
      releaseCapture.resolve()
      if (logout) await logout
      subscription.unsubscribe()
      await client.auth.stopAutoRefresh()
    }
  })
}
