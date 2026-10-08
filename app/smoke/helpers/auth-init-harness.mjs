import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, Script } from 'node:vm'
import { setImmediate } from 'node:timers/promises'
import { ref, computed } from 'vue'
import ts from 'typescript'

// Isolated execution of the complete production auth modules.
// Tests control only transport, timers, storage, and unrelated side effects;
// no auth, account transition, or storage reconciliation logic is copied.
// The VM exposes only explicit dependency stubs and never imports useSupabase,
// the Supabase SDK, Sentry, environment configuration, or a network transport.
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const compiledModules = new Map([
  ['./accountScope', 'src/composables/accountScope.ts'],
  ['../api/accountLocalPrivacy', 'src/api/accountLocalPrivacy.ts'],
  ['../api/navigationIntent', 'src/api/navigationIntent.ts'],
  ['./useAuth', 'src/composables/useAuth.ts'],
].map(([specifier, path]) => [specifier, {
  path,
  output: ts.transpileModule(readFileSync(resolve(appRoot, path), 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText,
}]))

export const ACCOUNT = 'local-timeout-account-a'
export const OTHER_ACCOUNT = 'local-timeout-account-b'
export const OWNER = 'account_private_storage_owner_v1'
export const DRAFT = 'publish_draft_v1'
export const PRIVATE_DRAFT = { title: 'Synthetic unpublished draft', body: 'Local fixture only' }
export const session = (id = ACCOUNT) => ({ user: { id } })
export const profile = (id = ACCOUNT) => ({
  id,
  nickname: 'Synthetic profile',
  tos_version: 'local-test-policy',
  suspension_level: 0,
  suspended_until: null,
})
export const profileResponse = (id = ACCOUNT) => ({ data: profile(id), error: null, status: 200 })

export function deferred() {
  let resolvePromise
  let rejectPromise
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

export function observe(promise) {
  const observation = { settled: false, value: undefined, error: undefined }
  promise.then(value => {
    observation.settled = true
    observation.value = value
  }, error => {
    observation.settled = true
    observation.error = error
  })
  return observation
}

// One event-loop turn drains both host and VM promise microtasks, without
// sleeping or moving the fake clock. advance() runs each timer at its deadline
// and drains microtasks before looking for the next newly scheduled timer.
export const flush = () => setImmediate()

function fakeClock() {
  let now = 0
  let nextId = 1
  const timers = new Map()
  return {
    now: () => now,
    pendingCount: () => timers.size,
    setTimeout(callback, delay = 0, ...args) {
      const id = nextId++
      timers.set(id, { at: now + Math.max(0, Number(delay)), callback, args })
      return id
    },
    clearTimeout: id => { timers.delete(id) },
    async advance(ms) {
      assert.ok(Number.isFinite(ms) && ms >= 0)
      const target = now + ms
      await flush()
      let callbacks = 0
      for (;;) {
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort(([a, left], [b, right]) => left.at - right.at || a - b)[0]
        if (!next) break
        assert.ok(++callbacks <= 1000, 'fake clock detected an unbounded timer loop')
        const [id, timer] = next
        timers.delete(id)
        now = timer.at
        timer.callback(...timer.args)
        await flush()
      }
      now = target
      await flush()
    },
  }
}

export function createHarness({ owned = true, getProfile, authBoundary = {} } = {}) {
  const clock = fakeClock()
  const storage = new Map([
    ...(owned ? [[OWNER, ACCOUNT]] : []),
    [DRAFT, { ...PRIVATE_DRAFT }],
    ['theme', 'dark'],
  ])
  const getSession = deferred()
  const sessionFlights = []
  const calls = {
    getSession: 0,
    subscriptions: 0,
    unsubscriptions: 0,
    profiles: [],
    captured: [],
    transitions: [],
    warnings: [],
    forbidden: [],
    navigation: [],
    clearBlocked: 0,
    removeAllChannels: 0,
    localSignOut: 0,
    directSignIn: 0,
    maxActiveSubscriptions: 0,
    memoryResets: 0,
    memoryHydrates: 0,
  }
  const authListeners = new Set()
  let scope
  let profileImplementation = getProfile ?? ((_attempt, call) => profileResponse(call.userId))
  let signOutImplementation = async () => ({
    accessTokenFound: true,
    crossRestartProtected: true,
    storageClearFallbackUsed: false,
    remoteRevokeError: null,
    stopAutoRefreshError: null,
    firstPurgeError: null,
    signedOutEventError: null,
    finalPurgeError: null,
  })
  let signInImplementation = async () => ({ data: { session: session(OTHER_ACCOUNT) }, error: null })
  let mountedPrivateState = ['Synthetic prior-owner state']
  const forbidden = name => (..._args) => {
    calls.forbidden.push(name)
    throw new Error(`Unexpected isolated-harness call: ${name}`)
  }
  const supabase = {
    auth: {
      getSession() {
        calls.getSession += 1
        assert.ok(calls.getSession <= 50, 'unexpected unbounded session retry')
        const flight = calls.getSession === 1 ? getSession : deferred()
        flight.at = clock.now()
        sessionFlights.push(flight)
        return flight.promise
      },
      onAuthStateChange(callback) {
        calls.subscriptions += 1
        authListeners.add(callback)
        calls.maxActiveSubscriptions = Math.max(calls.maxActiveSubscriptions, authListeners.size)
        return { data: { subscription: { unsubscribe() {
          calls.unsubscriptions += 1
          authListeners.delete(callback)
        } } } }
      },
      signInWithPassword() {
        calls.directSignIn += 1
        return signInImplementation()
      },
    },
    removeAllChannels() { calls.removeAllChannels += 1 },
    rpc(name) {
      assert.equal(name, 'get_my_profile', 'only the synthetic self-profile transport is allowed')
      return {
        abortSignal(signal) {
          const call = { at: clock.now(), signal, userId: scope.getActiveAccountId() }
          calls.profiles.push(call)
          return Promise.resolve(profileImplementation(calls.profiles.length, call))
        },
      }
    },
  }
  const uni = {
    getStorageSync: key => storage.get(key) ?? '',
    setStorageSync: (key, value) => { storage.set(key, value) },
    removeStorageSync: key => { storage.delete(key) },
    request: forbidden('uni.request'),
    connectSocket: forbidden('uni.connectSocket'),
    navigateTo: ({ url }) => calls.navigation.push({ method: 'navigateTo', url }),
    redirectTo: ({ url }) => calls.navigation.push({ method: 'redirectTo', url }),
    reLaunch: ({ url }) => calls.navigation.push({ method: 'reLaunch', url }),
  }
  const stubs = new Map([
    ['vue', { ref, computed }],
    ['./useSupabase', {
      useSupabase: () => ({ supabase }),
      prepareSupabaseAuthPersistence: async () => {},
      failClosedSupabaseSignOut: () => {
        calls.localSignOut += 1
        return signOutImplementation()
      },
      canAcceptSupabaseAuthSession: () => true,
      ...authBoundary,
    }],
    ['./useModeration', { useModeration: () => ({
      loadBlockedIds: async () => ({ ok: true }),
      clearBlocked: () => { calls.clearBlocked += 1 },
    }) }],
    ['../utils/fingerprint', {
      deviceFingerprintHash: async () => null,
      deviceUASnippet: () => '',
      isExpectedFingerprintDeferral: forbidden('isExpectedFingerprintDeferral'),
    }],
    ['../utils', { passwordValid: forbidden('passwordValid') }],
    ['../utils/contentSafety', {
      checkContent: forbidden('checkContent'),
      remoteModerate: forbidden('remoteModerate'),
    }],
    ['../utils/sentry', {
      addBreadcrumb: () => {},
      captureAuthFailure: (error, source) => {
        calls.captured.push({ message: error.message, source })
      },
      captureException: (error, context) => {
        calls.captured.push({ message: error.message, source: context?.tags?.source })
      },
    }],
    ['../utils/publicResource', {
      safeAvatarUrl: forbidden('safeAvatarUrl'),
      sanitizeProfileResource: row => row,
    }],
    ['../api/mutationCommit', {
      isDefinitiveMutationRejection: forbidden('isDefinitiveMutationRejection'),
      mutationCommitState: forbidden('mutationCommitState'),
      mutationOutcomeError: forbidden('mutationOutcomeError'),
    }],
    ['../api/wechatAccountLink', {
      freshWechatCode: forbidden('freshWechatCode'),
      wechatAccountRequest: forbidden('wechatAccountRequest'),
    }],
    ['./useI18n', { syncActiveAccountEmailLanguage: async () => {} }],
  ])
  const RealDate = Date
  class ClockDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [1_700_000_000_000 + clock.now()]))
    }
    static now() { return 1_700_000_000_000 + clock.now() }
  }
  const context = createContext({
    Date: ClockDate,
    AbortController,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    console: { warn: message => calls.warnings.push(message) },
    uni,
    getCurrentPages: () => [],
    window: { localStorage: { getItem: key => storage.get(key) ?? null } },
    fetch: forbidden('fetch'),
    WebSocket: forbidden('WebSocket'),
    XMLHttpRequest: forbidden('XMLHttpRequest'),
  })
  const loaded = new Map()
  function isolatedRequire(specifier) {
    if (stubs.has(specifier)) return stubs.get(specifier)
    if (loaded.has(specifier)) return loaded.get(specifier)
    const compiled = compiledModules.get(specifier)
    assert.ok(compiled, `module is outside the isolated allowlist: ${specifier}`)
    const exports = {}
    loaded.set(specifier, exports)
    const evaluate = new Script(`(function(require, exports) {\n${compiled.output}\n})`, {
      filename: compiled.path,
    }).runInContext(context)
    evaluate(isolatedRequire, exports)
    return exports
  }
  scope = isolatedRequire('./accountScope')
  const privacy = isolatedRequire('../api/accountLocalPrivacy')
  scope.onAccountTransition(transition => {
    calls.transitions.push({ ...transition })
    mountedPrivateState = []
  })
  privacy.registerAccountPrivateStateReset(() => { calls.memoryResets += 1 })
  privacy.registerAccountPrivateStateHydrate(() => { calls.memoryHydrates += 1 })
  const auth = isolatedRequire('./useAuth').useAuth()
  return {
    auth, scope, privacy, clock, storage, calls, getSession, sessionFlights,
    mountedPrivateState: () => mountedPrivateState,
    emit(event, value) {
      assert.equal(authListeners.size, 1, 'exactly one active auth listener must be registered')
      for (const listener of authListeners) listener(event, value)
    },
    setProfileImplementation(value) { profileImplementation = value },
    setSignOutImplementation(value) { signOutImplementation = value },
    setSignInImplementation(value) { signInImplementation = value },
    assertIsolated() {
      assert.deepEqual(calls.forbidden, [])
      assert.deepEqual([...loaded.keys()].sort(), [...compiledModules.keys()].sort())
      assert.equal(calls.maxActiveSubscriptions, 1)
    },
  }
}

export async function start(harness) {
  const initPromise = harness.auth.init()
  const readyPromise = harness.auth.awaitAuthReady()
  const ready = observe(readyPromise)
  const init = observe(initPromise)
  assert.equal(harness.auth.init(), initPromise, 'concurrent init calls share the cached promise')
  await flush()
  assert.equal(harness.calls.getSession, 1)
  assert.equal(harness.calls.subscriptions, 1)
  return { readyPromise, ready, initPromise, init }
}

export function assertAnonymous(harness) {
  assert.equal(harness.scope.getActiveAccountId(), null)
  assert.equal(harness.auth.authState.value, 'anonymous')
  assert.equal(harness.auth.authInitialized.value, true)
  assert.equal(harness.auth.isLoggedIn.value, false)
  assert.equal(harness.auth.currentUser.value, null)
  assert.equal(harness.auth.profileLoadState.value, 'idle')
}

export function assertAuthenticated(harness, profileState = 'ready', userId = ACCOUNT) {
  assert.equal(harness.scope.getActiveAccountId(), userId)
  assert.equal(harness.auth.authState.value, 'authenticated')
  assert.equal(harness.auth.authInitialized.value, true)
  assert.equal(harness.auth.profileLoadState.value, profileState)
  assert.equal(harness.auth.isLoggedIn.value, profileState === 'ready')
  assert.equal(harness.auth.currentUser.value?.id ?? null, profileState === 'ready' ? userId : null)
}

export function assertUnavailable(harness) {
  assert.equal(harness.scope.getActiveAccountId(), null)
  assert.equal(harness.auth.authState.value, 'unavailable')
  assert.equal(harness.auth.isLoggedIn.value, false)
  assert.equal(harness.auth.currentUser.value, null)
  assert.equal(harness.auth.profileLoadState.value, 'idle')
}

export function assertOwnedDraftProtected(harness) {
  assert.deepEqual(harness.storage.get(DRAFT), PRIVATE_DRAFT)
  assert.equal(harness.storage.get(OWNER), ACCOUNT)
  const read = harness.privacy.readAccountPrivateStorage(DRAFT, null)
  assert.equal(read.allowed, false)
  assert.equal(read.value, null)
  assert.equal(harness.privacy.writeAccountPrivateStorage(DRAFT, { title: 'Must not replace owned draft' }), false)
  assert.equal(harness.privacy.removeAccountPrivateStorage(DRAFT), false)
  assert.deepEqual(harness.storage.get(DRAFT), PRIVATE_DRAFT)
}

export function assertOwnedDraftErased(harness) {
  assert.equal(harness.storage.has(DRAFT), false)
  assert.equal(harness.storage.has(OWNER), false)
  assert.equal(harness.storage.get('theme'), 'dark')
  assert.deepEqual(harness.mountedPrivateState(), [])
  const read = harness.privacy.readAccountPrivateStorage(DRAFT, null)
  assert.equal(read.allowed, true)
  assert.equal(read.value, null)
}
