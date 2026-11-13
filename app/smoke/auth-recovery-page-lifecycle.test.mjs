import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createContext, Script } from 'node:vm'
import { ref, computed, watch, nextTick } from 'vue'
import ts from 'typescript'

// Execute the production page, App navigation coordinator and account guards.
// All external effects are local doubles; no SDK, env or transport is loaded.
const source = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const script = path => source(path).match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
const compile = input => ts.transpileModule(input, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const flush = async () => { await nextTick(); await Promise.resolve(); await nextTick() }

async function fixture(t, { account = null, state = 'unavailable', app = false, ready = false, returnTo = null } = {}) {
  const calls = { init: 0, profile: 0, signOut: 0, session: 0, deletion: 0, routes: [], toasts: [], modals: [] }
  const hooks = { page: {}, app: {} }
  const cleanup = []
  const timers = new Map()
  const events = new Map()
  let timerId = 0
  let owner = 'page'
  let route = 'pages/profile-recovery/index'
  let authorizedReturn = returnTo
  const auth = {
    authState: ref(state),
    currentUser: ref(ready ? { id: account, tos_version: 'test-consent', suspension_level: 0 } : null),
    profileLoadState: ref(ready ? 'ready' : account ? 'error' : 'idle'),
    awaitAuthReady: async () => auth.authState.value,
    ensureProfileReady: async () => { calls.profile++; return false },
    refreshProfile: async () => false,
    init: async () => {
      calls.init++
      auth.authState.value = 'initializing'
      await retryResult.promise
      if (auth.authState.value === 'initializing') auth.authState.value = 'unavailable'
    },
    signOut: async () => {
      calls.signOut++
      scope.transitionAccount(null)
      auth.currentUser.value = null
      auth.authState.value = 'anonymous'
      return true
    },
  }
  const retryResult = deferred()
  const uni = {
    reLaunch: ({ url }) => { calls.routes.push(url); route = url.replace(/^\//, '').split('?')[0] },
    showToast: value => calls.toasts.push(value),
    showModal: value => calls.modals.push(value),
    showLoading() {}, hideLoading() {},
    $on: (name, handler) => events.set(name, handler),
    $off: name => events.delete(name),
    $emit: name => events.get(name)?.(),
  }
  const context = createContext({
    uni, console,
    getCurrentPages: () => [{ route }],
    setTimeout: fn => { timers.set(++timerId, fn); return timerId },
    clearTimeout: id => timers.delete(id),
  })
  function evaluate(input, require = () => { throw new Error('Unexpected import') }) {
    const module = { exports: {} }
    new Script(`(function(require,module,exports){${compile(input)}\n})`).runInContext(context)(require, module, module.exports)
    return module.exports
  }
  const scope = evaluate(source('src/composables/accountScope.ts'))
  if (account) scope.transitionAccount(account)
  function hook(name, handler) { (hooks[owner][name] ??= []).push(handler) }
  function dependency(name) {
    if (name === 'vue') return {
      ref, computed,
      watch: (...args) => { const stop = watch(...args); cleanup.push(stop); return stop },
      onMounted: fn => hook('mounted', fn), onUnmounted: fn => cleanup.push(fn),
    }
    if (name === '@dcloudio/uni-app') return {
      onShow: fn => hook('show', fn), onHide: fn => hook('hide', fn), onLaunch: fn => hook('launch', fn),
    }
    if (name.endsWith('/accountScope')) return scope
    if (name.endsWith('/useAuth')) return { useAuth: () => auth }
    if (name.endsWith('/useI18n')) return { useI18n: () => ({ t: key => key, lang: ref('en') }) }
    if (name.endsWith('/useTheme')) return { useTheme() {} }
    if (name.endsWith('/useMpChrome')) return { mpChromeVars: () => ({}), mpThemeClass: '' }
    if (name.endsWith('/sentry')) return { captureException() {} }
    if (name.endsWith('/dialogColors')) return { DIALOG_DANGER: '#a00' }
    if (name.endsWith('/runtime')) return { BASE_URL: 'https://fixture.invalid' }
    if (name.endsWith('/useSupabase')) return { useSupabase: () => ({ supabase: { auth: {
      getSession: async () => { calls.session++; return { data: { session: { user: { id: scope.getActiveAccountId() }, access_token: 'synthetic' } } } },
    } } }), platformFetch: () => { throw new Error('No transport allowed') } }
    if (name.endsWith('/accountDeletion')) return {
      accountDeletionOutcomeUnknown: () => false,
      requestAccountDeletion: async () => { calls.deletion++; return { status: 'pending' } },
    }
    if (name.endsWith('/legal')) return { CURRENT_CONSENT_VERSION: 'test-consent' }
    if (name.endsWith('/suspension')) return { isSuspensionActive: profile => profile.suspension_level >= 2 }
    if (name.endsWith('/acquisition')) return { attributeNewAccount() {}, startAcquisition() {} }
    if (name.endsWith('/responseBody')) return {}
    if (name.endsWith('/navigationIntent')) return {
      consumeActiveAuthorizedLoginReturnIntent: () => { const value = authorizedReturn; authorizedReturn = null; return value },
      peekActiveAuthorizedLoginReturnIntent: () => authorizedReturn,
    }
    if (name.endsWith('.vue') || name.endsWith('.css')) return {}
    throw new Error(`Unexpected dependency: ${name}`)
  }
  if (app) {
    owner = 'app'
    evaluate(script('src/App.vue'), dependency)
    owner = 'page'
  }
  const page = evaluate(script('src/pages/profile-recovery/index.vue') + '\nexport { retry, leave, deleteAccount, sessionRecovery, accountControlsAvailable, retryDisabled };', dependency)
  for (const fn of hooks.page.show ?? []) fn()
  for (const fn of hooks.page.mounted ?? []) await fn()
  t.after(() => cleanup.forEach(fn => fn()))
  return {
    auth, scope, page, calls, retryResult, hooks,
    hide() { route = 'pages/legal/index'; for (const fn of hooks.page.hide ?? []) fn() },
    show() { route = 'pages/profile-recovery/index'; for (const fn of hooks.page.show ?? []) fn() },
    setRoute(value) { route = value },
    setReturn(value) { authorizedReturn = value },
    startAccount(id, force = false) {
      auth.authState.value = 'initializing'
      scope.transitionAccount(id, force)
      auth.currentUser.value = null
      auth.profileLoadState.value = 'loading'
    },
    settleProfile({ ready = true, suspension = 0, consent = 'test-consent' } = {}) {
      auth.currentUser.value = ready ? { id: scope.getActiveAccountId(), tos_version: consent, suspension_level: suspension } : null
      auth.profileLoadState.value = ready ? 'ready' : 'error'
      auth.authState.value = 'authenticated'
    },
    async drainNavigation() {
      await flush()
      for (const [id, callback] of [...timers]) { timers.delete(id); callback() }
      await flush()
    },
  }
}

test('unknown session retry stays in session mode and hides account actions while initializing', async t => {
  const h = await fixture(t)
  const retry = h.page.retry()
  assert.equal(h.auth.authState.value, 'initializing')
  assert.equal(h.page.sessionRecovery.value, true)
  assert.equal(h.page.accountControlsAvailable.value, false)
  assert.equal(h.page.retryDisabled.value, true)
  await h.page.retry()
  await h.page.leave()
  h.page.deleteAccount()
  assert.equal(h.calls.init, 1)
  assert.equal(h.calls.profile + h.calls.signOut + h.calls.modals.length, 0)
  h.retryResult.resolve()
  await retry
  assert.equal(h.page.retryDisabled.value, false)
  assert.equal(h.calls.toasts.length, 1)
})

test('late first identity can expose profile recovery only after its profile task settles', async t => {
  const h = await fixture(t)
  h.startAccount('account-a')
  assert.equal(h.page.accountControlsAvailable.value, false)
  assert.equal(h.page.sessionRecovery.value, true)
  h.settleProfile({ ready: false })
  assert.equal(h.page.accountControlsAvailable.value, true)
  assert.equal(h.page.sessionRecovery.value, false)
  await h.page.retry()
  assert.equal(h.calls.profile, 1)
  assert.equal(h.calls.init, 0)
  assert.deepEqual(h.calls.routes, [])
})

test('a replacement generation invalidates old retry, sign-out and deletion confirmation', async t => {
  for (const replacement of ['account-b', 'account-a']) {
    const h = await fixture(t, { account: 'account-a', state: 'authenticated' })
    h.page.deleteAccount()
    const confirm = h.calls.modals[0].success
    h.startAccount(replacement, true)
    h.settleProfile({ ready: false })
    await confirm({ confirm: true })
    await h.page.leave()
    await h.page.retry()
    assert.equal(h.page.accountControlsAvailable.value, false)
    assert.equal(h.calls.session + h.calls.deletion + h.calls.signOut + h.calls.profile, 0)
    assert.deepEqual(h.calls.routes, ['/pages/profile-recovery/index'])
  }
})

test('external authoritative sign-out leaves recovery, while page sign-out keeps its welcome continuation', async t => {
  const external = await fixture(t, { account: 'account-a', state: 'authenticated' })
  external.scope.transitionAccount(null)
  external.auth.authState.value = 'anonymous'
  assert.deepEqual(external.calls.routes, ['/pages/login/index'])

  const local = await fixture(t, { account: 'account-a', state: 'authenticated' })
  await local.page.leave()
  assert.deepEqual(local.calls.routes, ['/pages/welcome/index'])
})

test('sign-out finishing after page hide releases navigation ownership before recovery is shown again', async t => {
  const h = await fixture(t, { account: 'account-a', state: 'authenticated' })
  const signOutResult = deferred()
  h.auth.signOut = async () => {
    h.calls.signOut++
    h.scope.transitionAccount(null)
    h.auth.authState.value = 'anonymous'
    await signOutResult.promise
    return true
  }
  const pending = h.page.leave()
  h.hide()
  signOutResult.resolve()
  await pending
  assert.deepEqual(h.calls.routes, [])
  h.show()
  assert.deepEqual(h.calls.routes, ['/pages/login/index'])
})

test('account deletion keeps its result modal without an anonymous watcher redirect', async t => {
  const h = await fixture(t, { account: 'account-a', state: 'authenticated' })
  h.page.deleteAccount()
  await h.calls.modals[0].success({ confirm: true })
  assert.equal(h.calls.deletion, 1)
  assert.equal(h.calls.modals[1].title, 'settings.deleteAccountPendingTitle')
  assert.deepEqual(h.calls.routes, [])
  h.calls.modals[1].success()
  assert.deepEqual(h.calls.routes, ['/pages/welcome/index'])
})

test('a deletion result cannot navigate from another page or trap a later recovery visit', async t => {
  const h = await fixture(t, { account: 'account-a', state: 'authenticated' })
  h.page.deleteAccount()
  await h.calls.modals[0].success({ confirm: true })
  const acknowledge = h.calls.modals[1].success
  h.hide()
  acknowledge()
  assert.deepEqual(h.calls.routes, [])
  h.show()
  assert.deepEqual(h.calls.routes, ['/pages/login/index'])
})

test('late readiness exits recovery through the shared return coordinator exactly once', async t => {
  for (const destination of [null, '/pages/messages/index']) {
    const h = await fixture(t, { app: true })
    h.setReturn(destination)
    h.startAccount('account-a')
    h.settleProfile()
    await h.drainNavigation()
    assert.deepEqual(h.calls.routes, [destination ?? '/pages/index/index'])
  }
})

test('a recovery page entered after readiness still delegates its authorized return to App', async t => {
  const h = await fixture(t, {
    app: true, account: 'account-a', state: 'authenticated', ready: true,
    returnTo: '/pages/messages/index',
  })
  assert.deepEqual(h.calls.routes, [])
  await h.drainNavigation()
  assert.deepEqual(h.calls.routes, ['/pages/messages/index'])
})

test('late readiness respects every active restriction before consent and return navigation', async t => {
  for (const [profile, destination] of [
    [{ suspension: 0 }, '/pages/messages/index'],
    [{ suspension: 1 }, '/pages/messages/index'],
    [{ suspension: 2 }, '/pages/suspended/index'],
    [{ suspension: 3 }, '/pages/suspended/index'],
    [{ suspension: 4 }, '/pages/suspended/index'],
    [{ suspension: 5 }, '/pages/suspended/index'],
    [{ consent: '0' }, '/pages/reconsent/index'],
    [{ suspension: 2, consent: '0' }, '/pages/suspended/index'],
    [{ suspension: 5, consent: '0' }, '/pages/suspended/index'],
  ]) {
    const h = await fixture(t, { app: true })
    h.setReturn('/pages/messages/index')
    h.startAccount('account-a')
    h.settleProfile(profile)
    await h.drainNavigation()
    assert.deepEqual(h.calls.routes, [destination])
  }
})

test('late success and retry failure never steal navigation from a hidden recovery page', async t => {
  const h = await fixture(t, { app: true })
  const retry = h.page.retry()
  h.hide()
  h.retryResult.resolve()
  await retry
  assert.deepEqual(h.calls.toasts, [])
  h.startAccount('account-a')
  h.settleProfile()
  await h.drainNavigation()
  assert.deepEqual(h.calls.routes, [])
})

test('foreground retries unavailable auth without gating public home or an initializing profile', async t => {
  const h = await fixture(t, { app: true })
  h.setRoute('pages/index/index')
  for (const show of h.hooks.app.show ?? []) show()
  assert.equal(h.calls.init, 1)
  h.startAccount('account-a')
  await h.drainNavigation()
  assert.deepEqual(h.calls.routes, [])
  h.retryResult.resolve()
})
