import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'
import { createClient } from '@supabase/supabase-js'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function loadAuthPersistence() {
  const source = readFileSync(resolve(appRoot, 'src/api/authPersistence.ts'), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
}

function tokenFor(userId) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
    aud: 'authenticated',
    exp: now + 3600,
    iat: now,
    role: 'authenticated',
    sub: userId,
  })}.signature`
}

function serializedSession(userId = '11111111-1111-4111-8111-111111111111') {
  const accessToken = tokenFor(userId)
  return JSON.stringify({
    access_token: accessToken,
    refresh_token: 'refresh-token-that-must-not-survive',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600,
    token_type: 'bearer',
    user: {
      id: userId,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'purge-test@example.com',
      app_metadata: {},
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  })
}

function memoryBacking(initial = []) {
  const values = new Map(initial)
  const stats = { clearAllCalls: 0 }
  return {
    values,
    stats,
    backing: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value) },
      removeItem: key => { values.delete(key) },
      clearAll: () => {
        stats.clearAllCalls += 1
        values.clear()
      },
    },
  }
}

function boundaryState(values, controller) {
  const serialized = values.get(controller.logoutBlockKey)
  assert.equal(typeof serialized, 'string', 'the durable auth boundary must be persisted')
  return JSON.parse(serialized)
}

function authClient(storage, storageKey, fetcher) {
  return createClient('https://local-purge-test.supabase.co', 'anon-test-key', {
    auth: {
      storage,
      storageKey,
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: fetcher },
  })
}

for (const failure of ['network', '5xx']) {
  test(`logout ${failure} failure cannot preserve or rehydrate the local session`, async () => {
    const persistence = await loadAuthPersistence()
    const storageKey = `sb-local-${failure}-auth-token`
    const session = serializedSession()
    const { values, backing, stats } = memoryBacking([
      [storageKey, session],
      [`${storageKey}-code-verifier`, 'pkce-secret'],
      [`${storageKey}-user`, JSON.stringify({ id: 'stale-user' })],
      ['theme', 'dark'],
    ])
    const controller = persistence.createFailClosedAuthStorage(backing, storageKey)
    let logoutFetches = 0
    const fetcher = async () => {
      logoutFetches += 1
      if (failure === 'network') throw new TypeError('simulated network loss')
      return new Response(JSON.stringify({ message: 'simulated auth outage' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const client = authClient(controller.storage, storageKey, fetcher)

    const before = await client.auth.getSession()
    assert.equal(before.data.session?.user.id, '11111111-1111-4111-8111-111111111111')

    const events = []
    const { data: listener } = client.auth.onAuthStateChange(event => events.push(event))
    const originalConsoleError = console.error
    let result
    try {
      // auth-js intentionally logs the caught fetch exception before wrapping
      // it as AuthRetryableFetchError. Keep the regression output readable.
      if (failure === 'network') console.error = () => {}
      result = await persistence.executeFailClosedAuthSignOut(client.auth, controller)
    } finally {
      console.error = originalConsoleError
    }
    await Promise.resolve()

    assert.equal(result.accessTokenFound, true)
    assert.equal(result.crossRestartProtected, true)
    assert.equal(result.storageClearFallbackUsed, false)
    assert.ok(result.remoteRevokeError, 'remote revoke failure should remain observable')
    assert.equal(result.signedOutEventError, null)
    assert.ok(events.includes('SIGNED_OUT'), 'tokenless signOut must still notify subscribers')
    assert.ok(logoutFetches >= 1, 'captured token must attempt a best-effort remote local revoke')
    assert.equal(controller.isWriteBlocked(), true)
    assert.equal(values.has(storageKey), false)
    assert.equal(values.has(`${storageKey}-code-verifier`), false)
    assert.equal(values.has(`${storageKey}-user`), false)
    assert.equal(values.has(controller.logoutBlockKey), true)
    assert.equal(boundaryState(values, controller).mode, 'blocked')
    assert.equal(values.get('theme'), 'dark', 'normal logout must preserve unrelated preferences')
    assert.equal(stats.clearAllCalls, 0, 'normal logout must not use the full-storage fallback')

    // A new client models an app restart. It must not recover the old account.
    const freshController = persistence.createFailClosedAuthStorage(backing, storageKey)
    const freshClient = authClient(freshController.storage, storageKey, async () => {
      throw new Error('fresh anonymous getSession must not use the network')
    })
    const afterRestart = await freshClient.auth.getSession()
    assert.equal(afterRestart.data.session, null)

    listener.subscription.unsubscribe()
    await client.auth.stopAutoRefresh()
    await freshClient.auth.stopAutoRefresh()
  })
}

test('a storage write already in flight cannot resurrect a blocked auth key', async () => {
  const persistence = await loadAuthPersistence()
  const storageKey = 'sb-local-race-auth-token'
  const values = new Map([[storageKey, serializedSession()]])
  let releaseWrite
  const writeGate = new Promise(resolve => { releaseWrite = resolve })
  let delayedWriteStarted = false
  const controller = persistence.createFailClosedAuthStorage({
    getItem: key => values.get(key) ?? null,
    async setItem(key, value) {
      delayedWriteStarted = true
      await writeGate
      values.set(key, value)
    },
    removeItem: key => { values.delete(key) },
  }, storageKey)

  const staleWrite = controller.storage.setItem(storageKey, serializedSession())
  while (!delayedWriteStarted) await Promise.resolve()
  const block = controller.blockWrites()
  const purge = controller.purge()
  releaseWrite()
  await assert.rejects(staleWrite, /supabase_auth_persistence_blocked/)
  await Promise.all([block, purge])

  assert.equal(values.has(storageKey), false)
  assert.equal(controller.isWriteBlocked(), true)
  await assert.rejects(
    controller.storage.setItem(storageKey, serializedSession()),
    /supabase_auth_persistence_blocked/,
  )
  assert.equal(values.has(storageKey), false, 'post-logout writes must remain blocked')
})

test('a failed remove falls back to an empty persisted value that restarts anonymous', async () => {
  const persistence = await loadAuthPersistence()
  const storageKey = 'sb-local-remove-fallback-auth-token'
  const values = new Map([[storageKey, serializedSession()]])
  const backing = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: () => { throw new Error('simulated remove failure') },
  }
  const controller = persistence.createFailClosedAuthStorage(backing, storageKey)

  await controller.blockWrites()
  await controller.purge()
  assert.equal(values.get(storageKey), '')

  const freshController = persistence.createFailClosedAuthStorage(backing, storageKey)
  const freshClient = authClient(freshController.storage, storageKey, async () => {
    throw new Error('empty auth storage must not use the network')
  })
  assert.equal((await freshClient.auth.getSession()).data.session, null)
  await freshClient.auth.stopAutoRefresh()
})

test('a durable logout marker keeps a residual token anonymous across an app restart', async () => {
  const persistence = await loadAuthPersistence()
  const storageKey = 'sb-local-total-storage-failure-auth-token'
  const authKeys = new Set([
    storageKey,
    `${storageKey}-code-verifier`,
    `${storageKey}-user`,
  ])
  const values = new Map([
    [storageKey, serializedSession()],
    ['theme', 'dark'],
  ])
  let authEraseFailed = true
  let clearAllCalls = 0
  const backing = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => {
      if (authEraseFailed && authKeys.has(key) && value === '') {
        throw new Error('simulated auth overwrite failure')
      }
      values.set(key, value)
    },
    removeItem: key => {
      if (authEraseFailed && authKeys.has(key)) throw new Error('simulated auth remove failure')
      values.delete(key)
    },
    clearAll: () => {
      clearAllCalls += 1
      values.clear()
    },
  }
  const controller = persistence.createFailClosedAuthStorage(backing, storageKey)
  const logoutBlockKey = controller.logoutBlockKey

  await controller.blockWrites()
  await assert.rejects(controller.purge(), /supabase_auth_storage_purge_failed_marker_protected/)
  assert.equal(values.has(storageKey), true, 'test fixture should preserve the unverifiable residual token')
  assert.equal(boundaryState(values, controller).mode, 'blocked', 'restart boundary must survive while the token cannot be erased')
  assert.equal(values.get('theme'), 'dark', 'marker protection must not erase unrelated preferences')
  assert.equal(clearAllCalls, 0, 'ordinary logout must not clear all storage when the marker is durable')
  assert.equal(controller.isCrossRestartProtected(), true)
  assert.equal(controller.didUseFullStorageClear(), false)
  await assert.rejects(controller.allowWrites(), /supabase_auth_storage_purge_unverified/)

  const authSource = readFileSync(resolve(appRoot, 'src/composables/useAuth.ts'), 'utf8')
  assert.match(authSource, /result\.finalPurgeError[\s\S]*captureException\(cleanupError, \{ tags: \{ source: 'auth-local-purge' \} \}\)/)
  assert.match(authSource, /!result\.crossRestartProtected[\s\S]*auth-cross-restart-protection/)

  // A brand-new controller models an application restart. It starts with no
  // in-memory state, but must consult the durable marker before returning the
  // still-present token to auth-js.
  const freshController = persistence.createFailClosedAuthStorage(backing, storageKey)
  const freshClient = authClient(freshController.storage, storageKey, async () => {
    throw new Error('marker-protected getSession must not use the network')
  })
  const afterRestart = await freshClient.auth.getSession()
  assert.equal(afterRestart.data.session, null)
  assert.equal(freshController.isWriteBlocked(), true)
  assert.equal(freshController.isCrossRestartProtected(), true)

  // A later explicit session boundary can retry the purge, but cannot re-open
  // persistence until the backing store proves the stale value is gone.
  authEraseFailed = false
  await freshController.syncPersistedBlock()
  await freshController.purge({ allowFullStorageClear: true })
  await freshController.allowWrites()
  await freshController.storage.setItem(storageKey, serializedSession('33333333-3333-4333-8333-333333333333'))
  assert.ok(values.has(storageKey))
  assert.equal(boundaryState(values, freshController).mode, 'allowed')
  assert.equal(values.get('theme'), 'dark')
  assert.equal(clearAllCalls, 0)
  await freshClient.auth.stopAutoRefresh()
})

test('full app-storage clear is a verified and observable last resort', async () => {
  const persistence = await loadAuthPersistence()
  const storageKey = 'sb-local-clear-all-fallback-auth-token'
  const authKeys = new Set([
    storageKey,
    `${storageKey}-code-verifier`,
    `${storageKey}-user`,
  ])
  const values = new Map([
    [storageKey, serializedSession()],
    ['theme', 'dark'],
  ])
  let clearAllCalls = 0
  let logoutBlockKey = ''
  let boundaryWritable = false
  const controller = persistence.createFailClosedAuthStorage({
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => {
      if ((key === logoutBlockKey && !boundaryWritable) || (authKeys.has(key) && value === '')) {
        throw new Error('simulated storage write failure')
      }
      values.set(key, value)
    },
    removeItem: key => {
      if (authKeys.has(key)) throw new Error('simulated auth remove failure')
      values.delete(key)
    },
    clearAll: () => {
      clearAllCalls += 1
      values.clear()
      boundaryWritable = true
    },
  }, storageKey)
  logoutBlockKey = controller.logoutBlockKey
  const fakeAuth = {
    stopAutoRefresh: async () => {},
    signOut: async () => ({ error: null }),
    admin: { signOut: async () => ({ error: null }) },
  }

  const result = await persistence.executeFailClosedAuthSignOut(fakeAuth, controller)

  assert.equal(result.crossRestartProtected, true)
  assert.equal(result.storageClearFallbackUsed, true)
  assert.equal(controller.isCrossRestartProtected(), true)
  assert.equal(controller.didUseFullStorageClear(), true)
  assert.equal(clearAllCalls, 1)
  assert.equal(values.size, 1, 'only the repaired durable boundary remains after the full clear')
  assert.equal(boundaryState(values, controller).mode, 'blocked')
  assert.equal(values.has('theme'), false, 'the verified last resort necessarily removes unrelated preferences')
})

test('an explicit new-session boundary re-allows persistence only after purge', async () => {
  const persistence = await loadAuthPersistence()
  const storageKey = 'sb-local-new-session-auth-token'
  const { values, backing } = memoryBacking([[storageKey, serializedSession()]])
  const controller = persistence.createFailClosedAuthStorage(backing, storageKey)

  await controller.blockWrites()
  await controller.purge()
  await assert.rejects(
    controller.storage.setItem(storageKey, serializedSession()),
    /supabase_auth_persistence_blocked/,
  )
  assert.equal(values.has(storageKey), false)

  await controller.allowWrites()
  const nextSession = serializedSession('22222222-2222-4222-8222-222222222222')
  await controller.storage.setItem(storageKey, nextSession)
  assert.equal(values.has(storageKey), true)
  assert.equal(boundaryState(values, controller).mode, 'allowed')
  assert.equal(await controller.readAccessToken(), JSON.parse(nextSession).access_token)
})

test('a dormant old tab cannot overwrite a newer login generation', async () => {
  const persistence = await loadAuthPersistence()
  const storageKey = 'sb-local-multitab-generation-auth-token'
  const oldSession = serializedSession('44444444-4444-4444-8444-444444444444')
  const nextSession = serializedSession('55555555-5555-4555-8555-555555555555')
  const { values, backing } = memoryBacking([
    [storageKey, oldSession],
    ['theme', 'dark'],
  ])
  const tabA = persistence.createFailClosedAuthStorage(backing, storageKey)
  const dormantTabB = persistence.createFailClosedAuthStorage(backing, storageKey)

  // Both existing tabs explicitly adopt the legacy generation before one of
  // them becomes dormant.
  assert.equal(await tabA.storage.getItem(storageKey), oldSession)
  assert.equal(await dormantTabB.storage.getItem(storageKey), oldSession)

  await tabA.blockWrites()
  await tabA.purge()

  const loginTabC = persistence.createFailClosedAuthStorage(backing, storageKey)
  await loginTabC.syncPersistedBlock()
  await loginTabC.blockWrites()
  await loginTabC.purge({ allowFullStorageClear: true })
  await loginTabC.allowWrites()
  await loginTabC.storage.setItem(storageKey, nextSession)

  await assert.rejects(
    dormantTabB.storage.setItem(storageKey, oldSession),
    /supabase_auth_persistence_blocked/,
  )

  const restartedTab = persistence.createFailClosedAuthStorage(backing, storageKey)
  assert.equal(await restartedTab.storage.getItem(storageKey), nextSession)
  assert.equal(boundaryState(values, restartedTab).mode, 'allowed')
  assert.equal(values.get('theme'), 'dark')
})

test('a controller created before logout is stale even if its first auth operation is delayed', async () => {
  const persistence = await loadAuthPersistence()
  const storageKey = 'sb-local-delayed-first-operation-auth-token'
  const oldSession = serializedSession('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  const nextSession = serializedSession('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
  const { backing } = memoryBacking([[storageKey, oldSession]])
  const logoutTab = persistence.createFailClosedAuthStorage(backing, storageKey)
  const preExistingDormantTab = persistence.createFailClosedAuthStorage(backing, storageKey)

  // Deliberately perform no storage operation through the dormant controller.
  // Its generation must still be the one that existed when it was created.
  assert.equal(await logoutTab.storage.getItem(storageKey), oldSession)
  await logoutTab.blockWrites()
  await logoutTab.purge()

  const loginTab = persistence.createFailClosedAuthStorage(backing, storageKey)
  await loginTab.syncPersistedBlock()
  await loginTab.blockWrites()
  await loginTab.purge()
  await loginTab.allowWrites()
  await loginTab.storage.setItem(storageKey, nextSession)

  await assert.rejects(
    preExistingDormantTab.storage.setItem(storageKey, oldSession),
    /supabase_auth_persistence_blocked/,
  )
  const restartedTab = persistence.createFailClosedAuthStorage(backing, storageKey)
  assert.equal(await restartedTab.storage.getItem(storageKey), nextSession)
})

test('an old write that lands after logout and relogin can never rehydrate the old account', async () => {
  const persistence = await loadAuthPersistence()
  const storageKey = 'sb-local-cross-boundary-write-auth-token'
  const oldSession = serializedSession('66666666-6666-4666-8666-666666666666')
  const nextSession = serializedSession('77777777-7777-4777-8777-777777777777')
  const values = new Map([[storageKey, oldSession]])
  let releaseOldWrite
  const oldWriteGate = new Promise(resolve => { releaseOldWrite = resolve })
  let oldWriteStarted = false
  const backing = {
    getItem: key => values.get(key) ?? null,
    async setItem(key, value) {
      let decoded = null
      try { decoded = JSON.parse(value) } catch {}
      if (key === storageKey && decoded?.value === oldSession) {
        oldWriteStarted = true
        await oldWriteGate
      }
      values.set(key, value)
    },
    removeItem: key => { values.delete(key) },
  }
  const tabA = persistence.createFailClosedAuthStorage(backing, storageKey)
  const oldTabB = persistence.createFailClosedAuthStorage(backing, storageKey)
  assert.equal(await oldTabB.storage.getItem(storageKey), oldSession)

  const staleWrite = oldTabB.storage.setItem(storageKey, oldSession)
  while (!oldWriteStarted) await Promise.resolve()

  await tabA.blockWrites()
  await tabA.purge()
  const loginTabC = persistence.createFailClosedAuthStorage(backing, storageKey)
  await loginTabC.syncPersistedBlock()
  await loginTabC.blockWrites()
  await loginTabC.purge()
  await loginTabC.allowWrites()
  await loginTabC.storage.setItem(storageKey, nextSession)

  releaseOldWrite()
  await assert.rejects(staleWrite, /supabase_auth_persistence_blocked/)

  const restartedTab = persistence.createFailClosedAuthStorage(backing, storageKey)
  const restartedValue = await restartedTab.storage.getItem(storageKey)
  assert.ok(
    restartedValue === null || restartedValue === nextSession,
    'the losing race may fail closed to anonymous, but must never restore the old account',
  )
  assert.notEqual(restartedValue, oldSession)
})

test('a cached old bundle raw write is ignored once a v2 generation exists', async () => {
  const persistence = await loadAuthPersistence()
  const storageKey = 'sb-local-cached-bundle-auth-token'
  const oldSession = serializedSession('88888888-8888-4888-8888-888888888888')
  const nextSession = serializedSession('99999999-9999-4999-8999-999999999999')
  const { values, backing } = memoryBacking([[storageKey, oldSession]])
  const controller = persistence.createFailClosedAuthStorage(backing, storageKey)

  await controller.blockWrites()
  await controller.purge()
  await controller.allowWrites()
  await controller.storage.setItem(storageKey, nextSession)

  // Models a cached pre-v2 tab that writes Supabase's unwrapped JSON directly.
  values.set(storageKey, oldSession)
  const restartedTab = persistence.createFailClosedAuthStorage(backing, storageKey)
  assert.equal(await restartedTab.storage.getItem(storageKey), null)
  assert.equal(await restartedTab.readAccessToken(), null)
})

test('the legacy boolean logout marker upgrades without exposing its residual token', async () => {
  const persistence = await loadAuthPersistence()
  const storageKey = 'sb-local-legacy-marker-auth-token'
  const legacyMarkerKey = `${storageKey}-logout-blocked`
  const oldSession = serializedSession('cccccccc-cccc-4ccc-8ccc-cccccccccccc')
  const nextSession = serializedSession('dddddddd-dddd-4ddd-8ddd-dddddddddddd')
  const { values, backing } = memoryBacking([
    [storageKey, oldSession],
    [legacyMarkerKey, '1'],
    ['theme', 'dark'],
  ])
  const controller = persistence.createFailClosedAuthStorage(backing, storageKey)

  assert.equal(await controller.storage.getItem(storageKey), null)
  assert.equal(controller.isWriteBlocked(), true)
  assert.equal(controller.isCrossRestartProtected(), true)

  await controller.blockWrites()
  await controller.purge()
  await controller.allowWrites()
  await controller.storage.setItem(storageKey, nextSession)

  assert.equal(values.has(legacyMarkerKey), false)
  assert.equal(boundaryState(values, controller).mode, 'allowed')
  assert.equal(await controller.storage.getItem(storageKey), nextSession)
  assert.equal(values.get('theme'), 'dark')
})

test('a malformed durable boundary fails closed instead of granting persistence', async () => {
  const persistence = await loadAuthPersistence()
  const storageKey = 'sb-local-malformed-boundary-auth-token'
  const boundaryKey = `${storageKey}-auth-boundary-v2`
  const oldSession = serializedSession('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')
  const { backing } = memoryBacking([
    [storageKey, oldSession],
    [boundaryKey, '{"v":2,"mode":"allowed","generation":3}'],
  ])
  const controller = persistence.createFailClosedAuthStorage(backing, storageKey)

  assert.equal(await controller.storage.getItem(storageKey), null)
  assert.equal(controller.isWriteBlocked(), true)
  assert.equal(controller.isCrossRestartProtected(), true)
  await assert.rejects(
    controller.storage.setItem(storageKey, oldSession),
    /supabase_auth_persistence_blocked/,
  )
})

test('all session-producing UI entry points prepare persistence before auth-js writes', () => {
  const auth = readFileSync(resolve(appRoot, 'src/composables/useAuth.ts'), 'utf8')
  const supabase = readFileSync(resolve(appRoot, 'src/composables/useSupabase.ts'), 'utf8')
  const login = readFileSync(resolve(appRoot, 'src/pages/login/index.vue'), 'utf8')
  const reset = readFileSync(resolve(appRoot, 'src/pages/reset-password/index.vue'), 'utf8')

  const assertPreparedBefore = (source, method, from = 0) => {
    const authCall = source.indexOf(method, from)
    const prepare = source.lastIndexOf('await prepareSupabaseAuthPersistence()', authCall)
    assert.ok(authCall >= 0 && prepare >= from && prepare < authCall, `${method} is missing its persistence boundary`)
    return authCall
  }

  let cursor = auth.indexOf('async function signUp(')
  assertPreparedBefore(auth, 'supabase.auth.signUp(', cursor)
  cursor = auth.indexOf('async function signIn(', cursor)
  assertPreparedBefore(auth, 'supabase.auth.signInWithPassword(', cursor)
  cursor = auth.indexOf('async function signInWithWeChat(', cursor)
  assertPreparedBefore(auth, 'supabase.auth.setSession(', cursor)
  assertPreparedBefore(login, 'supabase.auth.verifyOtp(')
  assertPreparedBefore(login, 'supabase.auth.signInWithOAuth(')
  // Recovery is deliberately isolated from persisted auth. Its OTP must use
  // the same fresh, non-persisted client as the password update, not prepare
  // or write the shared application session.
  assert.match(reset, /const recoveryClient = createEphemeralSupabaseClient\(\)[\s\S]*recoveryClient\.auth\.verifyOtp\(/)
  assert.doesNotMatch(reset, /supabase\.auth\.verifyOtp\(/)

  const signOut = auth.slice(auth.indexOf('async function signOut('), auth.indexOf('async function updateProfile('))
  assert.ok(signOut.indexOf('transitionAccount(null, true)') < signOut.indexOf('await failClosedSupabaseSignOut()'))

  const prepare = supabase.slice(
    supabase.indexOf('export async function prepareSupabaseAuthPersistence('),
    supabase.indexOf('export function failClosedSupabaseSignOut('),
  )
  assert.match(prepare, /while \(authSignOutTask\) await authSignOutTask[\s\S]*await authStorage\.syncPersistedBlock\(\)[\s\S]*await authStorage\.blockWrites\(\)[\s\S]*await authStorage\.purge\(\)[\s\S]*await authStorage\.allowWrites\(\)[\s\S]*await client\.auth\.startAutoRefresh\(\)/)
  // The generic controller retains a separately tested full-clear fallback,
  // but the real app must never wire it: a synchronous absence check cannot
  // be atomic with another browser tab's privileged admin journal write.
  assert.doesNotMatch(supabase, /clearAll\s*\(|clearStorageSync|allowFullStorageClear/)
  assert.match(prepare, /if \(authStorage\.isWriteBlocked\(\)\)[\s\S]*await client\.auth\.stopAutoRefresh\(\)[\s\S]*auth_session_boundary_superseded_by_signout/)
})
