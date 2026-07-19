import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = relativePath => readFileSync(resolve(appRoot, relativePath), 'utf8')

async function loadTypeScriptModule(relativePath) {
  let input = source(relativePath)
  if (input.includes("from './responseBody'")) {
    const responseBodyCompiled = ts.transpileModule(source('src/api/responseBody.ts'), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    }).outputText
    const responseBodyUrl = `data:text/javascript;base64,${Buffer.from(responseBodyCompiled).toString('base64')}`
    input = input.replace("'./responseBody'", `'${responseBodyUrl}'`)
  }
  const compiled = ts.transpileModule(input, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
}

test('signOut supports local privacy cleanup without forcing a competing navigation', () => {
  const auth = source('src/composables/useAuth.ts')
  assert.match(auth, /async function signOut\(options: \{ redirect\?: boolean \} = \{\}\)/)
  assert.match(auth, /options\.redirect !== false[\s\S]*isAccountIdentityGenerationCurrent\(signOutIdentityGeneration, null\)[\s\S]*uni\.reLaunch\(\{ url: '\/pages\/index\/index' \}\)/)

  const signOutStart = auth.indexOf('async function signOut(')
  const signOutEnd = auth.indexOf('\n  async function updateProfile(', signOutStart)
  const signOut = auth.slice(signOutStart, signOutEnd)
  const invalidate = signOut.indexOf('transitionAccount(null, true)')
  const clearUser = signOut.indexOf('currentUser.value = null', invalidate)
  const clearPrivateCache = signOut.indexOf('reconcileLocalPrivacy(null, previousUserId)', clearUser)
  const revoke = signOut.indexOf('await failClosedSupabaseSignOut()', clearPrivateCache)
  const continuationGuard = signOut.indexOf('if (!isAccountIdentityGenerationCurrent(signOutIdentityGeneration, null)) return false', revoke)
  const removeChannels = signOut.indexOf('supabase.removeAllChannels()', continuationGuard)
  const optionalRedirect = signOut.indexOf('options.redirect !== false', removeChannels)
  assert.ok(invalidate >= 0 && invalidate < clearUser)
  assert.ok(clearUser < clearPrivateCache && clearPrivateCache < revoke)
  assert.ok(revoke < continuationGuard && continuationGuard < removeChannels)
  assert.ok(removeChannels < optionalRedirect)
  assert.doesNotMatch(signOut, /await import\(/)
})

test('an old anonymous continuation never becomes current after another account cycle', async () => {
  const scope = await loadTypeScriptModule('src/composables/accountScope.ts')
  const firstAnonymousGeneration = scope.transitionAccount(null, true)
  assert.equal(scope.isAccountTransitionCurrent(firstAnonymousGeneration, null), true)

  scope.transitionAccount('account-b')
  assert.equal(scope.isAccountTransitionCurrent(firstAnonymousGeneration, null), false)

  scope.transitionAccount(null, true)
  assert.equal(
    scope.isAccountTransitionCurrent(firstAnonymousGeneration, null),
    false,
    'identity equality alone must not revive the first sign-out continuation',
  )
})

test('the logout-owned null lineage survives its own forced SIGNED_OUT event only', async () => {
  const scope = await loadTypeScriptModule('src/composables/accountScope.ts')
  scope.transitionAccount('account-a')
  scope.transitionAccount(null, true)
  const ownedIdentityGeneration = scope.captureAccountIdentityGeneration()

  scope.transitionAccount(null, true)
  assert.equal(scope.isAccountIdentityGenerationCurrent(ownedIdentityGeneration, null), true)

  scope.transitionAccount('account-b')
  scope.transitionAccount(null, true)
  assert.equal(scope.isAccountIdentityGenerationCurrent(ownedIdentityGeneration, null), false)
})

test('account deletion signs out for both completed and pending before owning one result UI', () => {
  const settings = source('src/pages/settings/index.vue')
  const request = settings.indexOf('const deletion = await requestAccountDeletion(')
  const signOut = settings.indexOf('await signOut({ redirect: false })', request)
  const pendingDialog = settings.indexOf("if (deletion.status === 'pending')", signOut)
  const welcome = settings.indexOf("uni.reLaunch({ url: '/pages/welcome/index' })", pendingDialog)

  assert.ok(request >= 0 && request < signOut)
  assert.ok(signOut < pendingDialog && pendingDialog < welcome)
  assert.match(settings, /title: t\('settings\.deleteAccountPendingTitle'\)/)
  assert.match(settings, /content: t\('settings\.deleteAccountPending'\)/)
})

test('account deletion treats lost or malformed acknowledgements as commit-unknown', async () => {
  const deletion = await loadTypeScriptModule('src/api/accountDeletion.ts')

  const completed = await deletion.requestAccountDeletion(
    'https://app.test/delete',
    'token',
    async () => new Response(JSON.stringify({ status: 'completed' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
  assert.deepEqual(completed, { status: 'completed' })

  const pending = await deletion.requestAccountDeletion(
    'https://app.test/delete',
    'token',
    async () => new Response(JSON.stringify({ status: 'pending' }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
  assert.deepEqual(pending, { status: 'pending' })

  await assert.rejects(
    deletion.requestAccountDeletion('https://app.test/delete', 'token', async () => (
      new Response(JSON.stringify({ error: 'delete_unavailable' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      })
    )),
    error => error?.outcome === 'rejected'
      && !deletion.accountDeletionOutcomeUnknown(error),
  )

  await assert.rejects(
    deletion.requestAccountDeletion('https://app.test/delete', 'token', async () => (
      new Response(JSON.stringify({ error: 'admin_recovery_transfer_required' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      })
    )),
    error => error?.outcome === 'rejected'
      && error?.message === 'admin_recovery_transfer_required'
      && !deletion.accountDeletionOutcomeUnknown(error),
  )

  await assert.rejects(
    deletion.requestAccountDeletion('https://app.test/delete', 'token', async () => {
      throw new TypeError('connection reset')
    }),
    error => deletion.accountDeletionOutcomeUnknown(error),
  )

  await assert.rejects(
    deletion.requestAccountDeletion('https://app.test/delete', 'token', async () => (
      new Response('not-json', { status: 200 })
    )),
    error => deletion.accountDeletionOutcomeUnknown(error),
  )

  await assert.rejects(
    deletion.requestAccountDeletion('https://app.test/delete', 'token', async () => (
      new Response(JSON.stringify({ error: 'proxy_failure' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      })
    )),
    error => deletion.accountDeletionOutcomeUnknown(error),
  )

  let stalledBodyCancelled = false
  await assert.rejects(
    deletion.requestAccountDeletion('https://app.test/delete', 'token', async () => (
      new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"status":'))
          // Deliberately never close: the bounded reader must cancel it.
        },
        cancel() { stalledBodyCancelled = true },
      }))
    ), 15),
    error => deletion.accountDeletionOutcomeUnknown(error),
  )
  assert.equal(stalledBodyCancelled, true)

  const settings = source('src/pages/settings/index.vue')
  const unknown = settings.indexOf('if (accountDeletionOutcomeUnknown(err))')
  const signOut = settings.indexOf('await signOut({ redirect: false })', unknown)
  const dialog = settings.indexOf("title: t('settings.deleteAccountUnknownTitle')", signOut)
  assert.ok(unknown >= 0 && unknown < signOut && signOut < dialog)
  assert.match(settings, /err\?\.message === 'admin_recovery_transfer_required'[\s\S]*?settings\.deleteAccountAdminRecoveryRequired/)
  assert.doesNotMatch(settings, /account (?:was not|is un)changed|账号尚未发生改变/)
})

test('profile recovery navigates only while its sign-out still owns anonymous state', () => {
  const recovery = source('src/pages/profile-recovery/index.vue')
  assert.match(recovery, /const accountToken = pageAccountToken/)
  assert.match(recovery, /isAccountRequestCurrent\(accountToken\)/)
  assert.match(recovery, /const ownsAnonymousContinuation = await signOut\(\{ redirect: false \}\)/)
  assert.match(recovery, /if \(!ownsAnonymousContinuation \|\| !mounted\) return/)
  assert.match(recovery, /uni\.reLaunch\(\{ url: '\/pages\/welcome\/index' \}\)/)
})

test('profile recovery keeps permanent deletion reachable and account-bound without a profile row', () => {
  const recovery = source('src/pages/profile-recovery/index.vue')
  const request = recovery.indexOf('const deletion = await requestAccountDeletion(')
  const signOut = recovery.indexOf('await signOut({ redirect: false })', request)
  const pending = recovery.indexOf("if (deletion.status === 'pending')", signOut)
  const unknown = recovery.indexOf('if (accountDeletionOutcomeUnknown(error))', pending)
  const unknownSignOut = recovery.indexOf('await signOut({ redirect: false })', unknown)
  const unknownDialog = recovery.indexOf("title: t('settings.deleteAccountUnknownTitle')", unknownSignOut)

  assert.match(recovery, /class="privacy-option"[^]*?auth\.profileDeleteAvailable/)
  assert.match(recovery, /class="\['danger-action'[^]*?role="button"[^]*?:tabindex=[^]*?@keydown\.enter\.prevent="deleteAccount"[^]*?@keydown\.space\.prevent="deleteAccount"/)
  assert.match(recovery, /const accountToken = pageAccountToken[^]*?isAccountRequestCurrent\(accountToken\)/)
  assert.match(recovery, /session\.user\.id !== accountToken\.userId/)
  assert.ok(request >= 0 && request < signOut && signOut < pending)
  assert.ok(unknown >= 0 && unknown < unknownSignOut && unknownSignOut < unknownDialog)
  assert.match(recovery, /resultUiEpoch === pageEpoch/)
  assert.match(recovery, /onAccountTransition\(\(\) => \{[^]*?pageEpoch \+= 1[^]*?stopDeletionLoading\(\)/)
  assert.match(recovery, /onUnmounted\(\(\) => \{[^]*?clearTimeout\(completionTimer\)[^]*?stopDeletionLoading\(\)/)
})
