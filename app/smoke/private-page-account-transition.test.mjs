import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const sourceRoot = new URL('../src/', import.meta.url)

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function importTypeScriptModule(relativePath) {
  const source = await readFile(new URL(relativePath, sourceRoot), 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`)
}

async function readPage(relativePath) {
  return readFile(new URL(relativePath, sourceRoot), 'utf8')
}

test('a controlled late A promise cannot write after A to B or B to anonymous', async () => {
  const scope = await importTypeScriptModule('composables/accountScope.ts')
  let pageEpoch = 0
  let visiblePrivateState = 'empty'
  const stop = scope.onAccountTransition(() => {
    pageEpoch += 1
    visiblePrivateState = 'empty'
  })

  const startOwnedRequest = (pending, userId) => {
    const token = scope.captureAccountRequest(userId)
    const requestEpoch = pageEpoch
    return pending.promise.then((value) => {
      if (requestEpoch !== pageEpoch || !scope.isAccountRequestCurrent(token)) return
      visiblePrivateState = value
    })
  }

  scope.transitionAccount('account-a')
  const lateA = deferred()
  const aRequest = startOwnedRequest(lateA, 'account-a')

  scope.transitionAccount('account-b')
  lateA.resolve('A private response')
  await aRequest
  assert.equal(visiblePrivateState, 'empty')

  const lateB = deferred()
  const bRequest = startOwnedRequest(lateB, 'account-b')
  lateB.resolve('B private response')
  await bRequest
  assert.equal(visiblePrivateState, 'B private response')

  const laterB = deferred()
  const staleBRequest = startOwnedRequest(laterB, 'account-b')
  scope.transitionAccount(null)
  laterB.resolve('late B private response')
  await staleBRequest
  assert.equal(visiblePrivateState, 'empty')

  stop()
})

test('private pages synchronously reset and guard their account-owned continuations', async () => {
  const pages = Object.fromEntries(await Promise.all([
    'history/index.vue',
    'saved-searches/index.vue',
    'illini-verify/index.vue',
    'onboarding/index.vue',
    'settings/index.vue',
    'search/index.vue',
    'post/index.vue',
    'plaza/index.vue',
    'seller/index.vue',
    'detail/index.vue',
    'index/index.vue',
    'profile/index.vue',
  ].map(async (path) => [path, await readPage(`pages/${path}`)])))

  assert.match(pages['history/index.vue'], /historyActionEpoch \+= 1/)
  assert.match(pages['history/index.vue'], /actionEpoch !== historyActionEpoch/)

  assert.match(pages['saved-searches/index.vue'], /resetSavedSearchPrivateState/)
  assert.match(pages['saved-searches/index.vue'], /showForm\.value = false/)
  assert.match(pages['saved-searches/index.vue'], /isAccountRequestCurrent\(submitAccountToken\)/)

  assert.match(pages['illini-verify/index.vue'], /resetVerificationPrivateState/)
  assert.match(pages['illini-verify/index.vue'], /email\.value = ''/)
  assert.match(pages['illini-verify/index.vue'], /currentUser\.value\?\.id === accountToken\.userId/)

  assert.match(pages['onboarding/index.vue'], /resetOnboardingPrivateState/)
  assert.match(pages['onboarding/index.vue'], /nickname\.value = ''/)
  assert.match(pages['onboarding/index.vue'], /pickerIsCurrent/)

  assert.match(pages['settings/index.vue'], /flowStillCurrent/)
  assert.match(pages['settings/index.vue'], /await supabase\.auth\.resetPasswordForEmail/)

  assert.match(pages['search/index.vue'], /query\.value = ''/)
  assert.match(pages['search/index.vue'], /recent\.value = \[\]/)

  assert.match(pages['post/index.vue'], /resetPostAccountState/)
  assert.match(pages['post/index.vue'], /liked_by_me: false/)
  assert.match(pages['post/index.vue'], /actionEpoch === postLoadEpoch/)

  assert.match(pages['plaza/index.vue'], /resetPlazaAccountState/)
  assert.match(pages['plaza/index.vue'], /myActiveItems\.value = \[\]/)
  assert.match(pages['plaza/index.vue'], /pickerEpoch === plazaAccountEpoch/)
  assert.match(pages['plaza/index.vue'], /actionEpoch === plazaAccountEpoch/)

  assert.match(pages['seller/index.vue'], /loadSellerWithModerationGate/)
  assert.match(pages['seller/index.vue'], /seller\.value = null/)
  assert.match(pages['seller/index.vue'], /requestEpoch === sellerLoadEpoch/)

  assert.match(pages['detail/index.vue'], /resetDetailAccountState/)
  assert.match(pages['detail/index.vue'], /notFound\.value = false/)
  assert.match(pages['detail/index.vue'], /actionEpoch === detailLoadEpoch/)

  assert.match(pages['index/index.vue'], /resetHomeAccountState/)
  assert.match(pages['index/index.vue'], /searchText\.value = ''/)
  assert.match(pages['index/index.vue'], /selectedCategory\.value = null/)
  assert.match(pages['index/index.vue'], /actionEpoch === homeAccountEpoch/)

  assert.match(pages['profile/index.vue'], /onShow\(async \(\) => \{\s*profilePageVisible = true\s*const showEpoch = \+\+profileShowEpoch/)
  assert.match(pages['profile/index.vue'], /await awaitAuthReady\(\)\s*if \(!profilePageVisible \|\| showEpoch !== profileShowEpoch\) return/)
  assert.match(pages['profile/index.vue'], /onHide\(\(\) => \{\s*profilePageVisible = false\s*profileShowEpoch \+= 1/)
  assert.match(pages['profile/index.vue'], /onUnload\(\(\) => \{\s*profilePageVisible = false\s*profileShowEpoch \+= 1/)
})
