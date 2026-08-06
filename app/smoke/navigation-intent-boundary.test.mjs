import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const intentSource = await readFile(
  new URL('../src/api/navigationIntent.ts', import.meta.url),
  'utf8',
)
const compiledIntent = ts.transpileModule(intentSource, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
}).outputText
const intentModuleUrl = `data:text/javascript;base64,${Buffer.from(compiledIntent).toString('base64')}`
const intent = await import(intentModuleUrl)

const searchSource = await readFile(
  new URL('../src/pages/search/index.vue', import.meta.url),
  'utf8',
)
const homeSource = await readFile(
  new URL('../src/pages/index/index.vue', import.meta.url),
  'utf8',
)
const appSource = await readFile(
  new URL('../src/App.vue', import.meta.url),
  'utf8',
)
const welcomeSource = await readFile(
  new URL('../src/pages/welcome/index.vue', import.meta.url),
  'utf8',
)
const loginSource = await readFile(
  new URL('../src/pages/login/index.vue', import.meta.url),
  'utf8',
)
const authSource = await readFile(
  new URL('../src/composables/useAuth.ts', import.meta.url),
  'utf8',
)

const anonymousOwner = { userId: null, identityGeneration: 4 }
const accountAOwner = { userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', identityGeneration: 8 }
const accountBOwner = { userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', identityGeneration: 9 }

test('anonymous search and category handoffs are runtime-only, typed, and latest-wins', () => {
  intent.clearHomeNavigationIntent()
  intent.stageHomeNavigationIntent({ kind: 'query', query: '  desk lamp  ' }, anonymousOwner)
  assert.deepEqual(
    intent.consumeHomeNavigationIntent(anonymousOwner),
    { kind: 'query', query: 'desk lamp' },
  )
  assert.equal(intent.consumeHomeNavigationIntent(anonymousOwner), null, 'intent is one-shot')

  intent.stageHomeNavigationIntent({ kind: 'query', query: 'old' }, anonymousOwner)
  intent.stageHomeNavigationIntent({ kind: 'category', category: 'books' }, anonymousOwner)
  assert.deepEqual(
    intent.consumeHomeNavigationIntent(anonymousOwner),
    { kind: 'category', category: 'books' },
    'a rapid later submission replaces the old query',
  )
})

test('home intents fail closed across account identity generations', () => {
  intent.clearHomeNavigationIntent()
  intent.stageHomeNavigationIntent({ kind: 'query', query: 'account a' }, accountAOwner)
  assert.equal(intent.consumeHomeNavigationIntent(accountBOwner), null)
  assert.equal(intent.consumeHomeNavigationIntent(accountAOwner), null, 'stale intent is discarded')
})

test('search handoff no longer depends on private storage writes', () => {
  const submitBlock = searchSource.slice(
    searchSource.indexOf('function onSubmit'),
    searchSource.indexOf('\nfunction removeOne'),
  )
  const consumeBlock = homeSource.slice(
    homeSource.indexOf('function consumePendingSearch'),
    homeSource.indexOf('\n/*', homeSource.indexOf('function consumePendingSearch')),
  )

  assert.match(submitBlock, /stageHomeNavigationIntent\(\s*\{ kind: 'query'/)
  assert.match(submitBlock, /stageHomeNavigationIntent\(\s*\{ kind: 'category'/)
  assert.doesNotMatch(submitBlock, /writeAccountPrivateStorage\('pending_(?:search|category)'/)
  assert.match(consumeBlock, /consumeHomeNavigationIntent/)
  assert.doesNotMatch(consumeBlock, /readAccountPrivateStorage<unknown>\('pending_(?:search|category)'/)
  assert.match(consumeBlock, /searchText\.value = intent\.query[\s\S]*onSearch\(\)/)
  assert.match(consumeBlock, /selectCategory\(intent\.category/)
})

test('welcome launch capture restores canonical product and post deep links', () => {
  const product = intent.welcomeRouteFromLaunch(
    { path: 'pages/detail/index', query: { id: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' } },
    '',
  )
  assert.equal(
    intent.canonicalReturnRoute(product),
    '/pages/detail/index?id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  )

  const post = intent.welcomeRouteFromLaunch(
    { path: 'pages/index/index', query: {} },
    '#/pages/post/index?id=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  )
  assert.equal(
    intent.canonicalReturnRoute(post),
    '/pages/post/index?id=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  )

  assert.match(appSource, /welcomeRouteFromLaunch\(launchOptions, launchHash\)/)
  assert.match(appSource, /stageWelcomeReturnIntent/)
  assert.match(welcomeSource, /consumeWelcomeReturnIntent/)
})

test('welcome launch capture restores Plaza and still rejects unknown no-param routes', () => {
  const plaza = intent.welcomeRouteFromLaunch(
    { path: 'pages/plaza/index', query: {} },
    '',
  )
  assert.equal(intent.canonicalReturnRoute(plaza), '/pages/plaza/index')
  assert.equal(intent.parseReturnRoute('/pages/unknown/index', 'welcome'), null)
})

test('return-target parser rejects external, traversal, loops, fragments, duplicates, and unknown params', () => {
  const malicious = [
    'https://evil.test/pages/detail/index?id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '//evil.test/pages/detail/index?id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '/pages/detail/../login/index?id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '/pages/detail/%2e%2e/login/index?id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '/pages/detail/index%253fid=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '/pages/detail\\index?id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '/pages/detail/index?id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa#x',
    '/pages/detail/index?id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&id=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '/pages/detail/index?id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&next=https://evil.test',
    '/pages/login/index',
    '/pages/welcome/index',
    '/pages/reset-password/index',
    `/pages/detail/index?id=${'a'.repeat(1100)}`,
  ]

  for (const target of malicious) {
    assert.equal(intent.parseReturnRoute(target, 'welcome'), null, target)
    assert.equal(intent.parseReturnRoute(target, 'login'), null, target)
  }
})

test('login return uses an opaque nonce and defaults direct login to home', () => {
  const staged = intent.stageLoginReturnIntent(
    '/pages/publish/index',
    anonymousOwner,
    { nonce: 'nonce-1234567890', now: 100 },
  )
  assert.equal(staged, 'nonce-1234567890')
  assert.equal(intent.buildLoginRoute(staged), '/pages/login/index?intent=nonce-1234567890')
  assert.equal(intent.buildLoginRoute(null), '/pages/login/index')

  assert.match(authSource, /stageLoginReturnIntent/)
  assert.match(loginSource, /authorizeLoginReturnIntent/)
  assert.match(loginSource, /peekAuthorizedLoginReturnIntent/)
  assert.match(appSource, /consumeActiveAuthorizedLoginReturnIntent/)
  assert.match(loginSource, /destination \|\| '\/pages\/index\/index'/)
})

test('protected actions recover the current target on H5 and mini-program page shapes', () => {
  const itemId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  assert.equal(
    intent.loginReturnRouteFromPage({
      route: 'pages/detail/index',
      options: { id: itemId },
    }),
    `/pages/detail/index?id=${itemId}`,
  )
  assert.equal(
    intent.loginReturnRouteFromPage({
      $page: { fullPath: `/pages/detail/index?id=${itemId}` },
    }),
    `/pages/detail/index?id=${itemId}`,
  )
  assert.equal(
    intent.loginReturnRouteFromPage({
      $page: { fullPath: '/pages/detail/index?id=bad&next=https://evil.test' },
    }),
    null,
  )
})

test('H5 OAuth restores only the nonce-bound descriptor from session storage', async () => {
  const values = new Map()
  globalThis.window = {
    sessionStorage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: key => values.delete(key),
    },
  }
  try {
    const beforeDeparture = await import(`${intentModuleUrl}#oauth-before`)
    const nonce = beforeDeparture.stageLoginReturnIntent(
      '/pages/publish/index',
      anonymousOwner,
      { nonce: 'nonce-oauth12345', now: 100 },
    )
    assert.equal(nonce, 'nonce-oauth12345')
    assert.equal(values.size, 1)
    const stored = JSON.parse([...values.values()][0])
    assert.deepEqual(stored.route, { path: '/pages/publish/index', params: {} })
    assert.equal('target' in stored, false)

    // A fresh module instance models the full-page provider round trip.
    const afterCallback = await import(`${intentModuleUrl}#oauth-after`)
    assert.equal(
      afterCallback.authorizeLoginReturnIntent(nonce, accountAOwner, { now: 200 }),
      true,
    )
    assert.equal(
      afterCallback.peekAuthorizedLoginReturnIntent(nonce, accountAOwner, { now: 201 }),
      '/pages/publish/index',
    )
    assert.match(loginSource, /redirectTo = loginIntentNonce[\s\S]*buildLoginRoute\(loginIntentNonce\)/)
    assert.match(loginSource, /oauthReturnExpected[\s\S]*watch\(currentUser/)
  } finally {
    delete globalThis.window
  }
})

test('every successful auth path enters the same identity-validating redirect coordinator', () => {
  const verify = loginSource.slice(
    loginSource.indexOf('async function onVerifySignup'),
    loginSource.indexOf('\nasync function onResendSignup'),
  )
  const google = loginSource.slice(
    loginSource.indexOf('async function onSignInWithGoogle'),
    loginSource.indexOf('\nasync function onSubmit'),
  )
  const submit = loginSource.slice(
    loginSource.indexOf('async function onSubmit'),
    loginSource.indexOf('\n</script>'),
  )

  assert.match(verify, /scheduleHomeRedirect\(800, data\?\.session\?\.user\?\.id\)/)
  assert.match(google, /buildLoginRoute\(loginIntentNonce\)/)
  assert.equal((submit.match(/scheduleHomeRedirect\(/g) || []).length, 4)
  assert.match(loginSource, /watch\(currentUser,[\s\S]*scheduleHomeRedirect\(0, user\.id\)/)

  const coordinator = loginSource.slice(
    loginSource.indexOf('function scheduleHomeRedirect'),
    loginSource.indexOf('\nonLoad('),
  )
  assert.match(coordinator, /authorizeCurrentLoginReturn\(expectedUserId\)/)
  assert.match(coordinator, /peekAuthorizedLoginReturnIntent\(loginIntentNonce, navigationIntentOwner\(\)\)/)
  assert.match(coordinator, /destination \|\| '\/pages\/index\/index'/)
})

test('gate routes retain the authorized return until the gate clears', () => {
  assert.match(appSource, /RETURN_RESUME_GATE_PAGES[\s\S]*profile-recovery[\s\S]*suspended[\s\S]*reconsent/)
  assert.match(appSource, /const target = requiredGatePath\(\)[\s\S]*if \(target\) \{[\s\S]*enforceConsentGate\(\)[\s\S]*return/)
  assert.match(appSource, /consumeActiveAuthorizedLoginReturnIntent\(navigationIntentOwner\(\)\)/)
  const interceptor = appSource.slice(
    appSource.indexOf('function installGateNavigationInterceptors'),
    appSource.indexOf('\n/*', appSource.indexOf('function installGateNavigationInterceptors')),
  )
  assert.match(interceptor, /const target = requiredGatePath\(\)/)
  assert.match(interceptor, /if \(!target\)[\s\S]*leavingGate[\s\S]*consumeActiveAuthorizedLoginReturnIntent/)
  assert.match(interceptor, /if \(gateDestinationAllowed\(target,[\s\S]*args\.url = target/)
})

test('authorized login return is one-shot and A to B to A cannot revive it', () => {
  intent.clearLoginReturnIntent()
  const nonce = intent.stageLoginReturnIntent(
    '/pages/publish/index',
    anonymousOwner,
    { nonce: 'nonce-abcdefghij', now: 100 },
  )
  assert.equal(
    intent.authorizeLoginReturnIntent(nonce, accountAOwner, { now: 200 }),
    true,
  )
  assert.equal(
    intent.peekAuthorizedLoginReturnIntent(nonce, accountAOwner, { now: 300 }),
    '/pages/publish/index',
  )
  assert.equal(
    intent.peekAuthorizedLoginReturnIntent(nonce, accountBOwner, { now: 301 }),
    null,
    'B mismatch permanently revokes the record',
  )
  assert.equal(
    intent.consumeAuthorizedLoginReturnIntent(nonce, accountAOwner, { now: 302 }),
    null,
    'switching back to A cannot revive the revoked target',
  )
})
