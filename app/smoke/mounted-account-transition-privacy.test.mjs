import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = relativePath => readFileSync(resolve(appRoot, relativePath), 'utf8')

function functionBlock(input, startMarker, endMarker) {
  const start = input.indexOf(startMarker)
  const end = input.indexOf(endMarker, start + startMarker.length)
  assert.ok(start >= 0, `missing ${startMarker}`)
  assert.ok(end > start, `missing ${endMarker} after ${startMarker}`)
  return input.slice(start, end)
}

function compiledDataUrl(input) {
  const output = ts.transpileModule(input, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText
  return `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`
}

test('an A location request cannot repopulate the cache after B is adopted', async () => {
  const scopeUrl = compiledDataUrl(source('src/composables/accountScope.ts'))
  const scope = await import(scopeUrl)
  const runtimeUrl = 'data:text/javascript,export%20const%20BASE_URL%20%3D%20%22https%3A%2F%2Fapp.test%22'
  const vueUrl = 'data:text/javascript,export%20const%20ref%20%3D%20(value)%20%3D%3E%20(%7Bvalue%7D)'
  const locationInput = source('src/composables/useLocation.ts')
    .replace("'vue'", `'${vueUrl}'`)
    .replace("'./accountScope'", `'${scopeUrl}'`)
    .replace("'../config/runtime'", `'${runtimeUrl}'`)
  const locationUrl = compiledDataUrl(locationInput)

  const previousUni = globalThis.uni
  const locationCallbacks = []
  let geolocationStarts = 0
  globalThis.uni = {
    getLocation(options) {
      geolocationStarts += 1
      locationCallbacks.push(options)
    },
    request(options) {
      options.success({
        statusCode: 200,
        data: { address: { building: 'Account A private building' } },
      })
    },
  }

  try {
    scope.transitionAccount('account-a')
    const { useLocation } = await import(locationUrl)
    const location = useLocation()
    const staleA = location.detectLocation()
    assert.equal(geolocationStarts, 1)

    scope.transitionAccount('account-b')
    const freshB = location.detectLocation()
    assert.equal(geolocationStarts, 2, 'B can start a fresh fix while A is still in flight')
    locationCallbacks[0].success({ latitude: 40.11, longitude: -88.22 })
    assert.deepEqual(await staleA, { ok: false, reason: 'position_unavailable' })
    assert.equal(location.cachedLocation.value, '')
    assert.equal(location.detecting.value, true, 'A finalization must not clear B detecting state')
    locationCallbacks[1].fail({ code: 2, message: 'unavailable' })
    assert.deepEqual(await freshB, { ok: false, reason: 'position_unavailable' })
    assert.equal(location.detecting.value, false)
  } finally {
    if (previousUni === undefined) delete globalThis.uni
    else globalThis.uni = previousUni
  }
})

test('mounted private pages synchronously hide A while the central owner boundary handles persistence', () => {
  const publish = source('src/pages/publish/index.vue')
  const profile = source('src/pages/profile/edit.vue')
  const edit = source('src/pages/publish/edit.vue')

  assert.match(publish, /onAccountTransition\(\(transition\) => \{\s*\/\/[^]*?resetPublishMemoryState\(\)/)
  const publishReset = functionBlock(publish, 'function resetPublishMemoryState()', '\n}\n\nconst stopAccountTransitionListener')
  assert.match(publishReset, /publishReady\.value = false[^]*?publishPageAccountToken = null[^]*?resetForm\(\)/)
  assert.doesNotMatch(publishReset, /clearDraft\(\)/, 'null -> same owner must not delete the durable draft')
  assert.match(publish, /readAccountPrivateStorage<unknown>\(DRAFT_KEY, null\)/)
  assert.match(publish, /writeAccountPrivateStorage\(DRAFT_KEY/)
  assert.match(publish, /persistent A -> B cleanup/)
  assert.match(publish, /const operationStillCurrent = \(\) => \([^]*?operationEpoch === publishOperationEpoch[^]*?isAccountRequestCurrent\(entryAccountToken\)/)

  assert.match(profile, /v-if="profileEditReady" class="form"/)
  assert.match(profile, /onAccountTransition\(\(transition\) => \{\s*resetProfilePrivateState\(\)/)
  assert.match(profile, /function resetProfilePrivateState\(\) \{[^]*?profileEditReady\.value = false[^]*?pageAccountToken = null[^]*?nickname\.value = ''[^]*?avatarUrl\.value = ''/)

  assert.match(edit, /v-if="editReady" class="form"/)
  assert.match(edit, /onAccountTransition\(\(transition\) => \{\s*resetEditPrivateState\(\)/)
  assert.match(edit, /function resetEditPrivateState\(\) \{[^]*?editReady\.value = false[^]*?editPageAccountToken = null[^]*?resetEditForm\(\)/)
  assert.match(edit, /const prepareStillVisible = \(\) => \([^]*?editPageVisible[^]*?prepareEpoch === editPrepareEpoch[^]*?navigationEpoch === editNavigationEpoch/)
  assert.match(edit, /!prepareStillVisible\(\)[^]*?!isAccountRequestCurrent\(accountToken\)/)
})

test('unloaded edit pages invalidate delayed navigation and detached account writes', () => {
  const publish = source('src/pages/publish/index.vue')
  const profile = source('src/pages/profile/edit.vue')
  const edit = source('src/pages/publish/edit.vue')

  assert.match(edit, /function destroyEditPage\(\) \{[^]*?editPageMounted = false[^]*?resetEditPrivateState\(\)[^]*?stopAccountTransitionListener\(\)/)
  assert.match(edit, /onUnload\(destroyEditPage\)/)
  assert.match(edit, /editPageVisible[^]*?invalidRouteEpoch === editPrepareEpoch[^]*?invalidRouteNavigationEpoch === editNavigationEpoch[^]*?!routeEditId[^]*?goBack\(\)/)
  assert.match(edit, /function showOwnedEditLoadToast\([^]*?editLoadToastOwned = true[^]*?uni\.showToast[^]*?editLoadToastOwned = false/)
  assert.match(edit, /function hideOwnedEditLoadToast\(\) \{[^]*?if \(!editLoadToastOwned\) return[^]*?editLoadToastOwned = false[^]*?uni\.hideToast\(\)/)
  assert.match(edit, /onHide\(\(\) => \{[^]*?editPageVisible = false[^]*?editNavigationEpoch \+= 1[^]*?hideOwnedEditLoadToast\(\)/)
  assert.match(edit, /showOwnedEditLoadToast\(t\('publish\.editFetchFailed'\)\)/)
  assert.match(edit, /if \(prepareStillVisible\(\)\) goBack\(\)/)

  assert.match(profile, /function destroyProfileEditPage\(\) \{[^]*?profileEditMounted = false[^]*?resetProfilePrivateState\(\)[^]*?stopAccountTransitionListener\(\)/)
  assert.match(profile, /onUnload\(destroyProfileEditPage\)/)
  assert.match(profile, /onHide\(\(\) => \{[^]*?profileEditVisible = false[^]*?profileEditNavigationEpoch \+= 1/)

  assert.match(publish, /function destroyPublishPage\(\) \{[^]*?publishPageMounted = false[^]*?publishOperationEpoch \+= 1[^]*?publishPageAccountToken = null[^]*?stopAccountTransitionListener\(\)/)
  assert.match(publish, /onUnload\(\(\) => \{\s*destroyPublishPage\(\)\s*\}\)/)
  assert.match(publish, /operationShowVersion === publishShowVersion[^]*?publishVisible/)

  for (const page of [publish, edit]) {
    assert.match(page, /async function scheduleBilingualFill\([^]*?accountToken: UploadAccountToken[^]*?\{ expectedUpdatedAt, accountToken \}/)
    assert.match(page, /scheduleBilingualFill\([^]*?updatedItem\.updated_at|scheduleBilingualFill\([^]*?newItem\.updated_at/)
  }
})

test('ChatThread tears down account-owned subscriptions and invalidates pending snapshots', () => {
  const chatRoute = source('src/pages/chat/index.vue')
  const chat = source('src/components/ChatThread.vue')
  const offers = source('src/composables/useOffers.ts')
  const meetups = source('src/composables/useMeetups.ts')

  const resetStart = chat.indexOf('function resetThreadPrivateState()')
  const resetEnd = chat.indexOf('\nfunction isThreadEpochCurrent', resetStart)
  const reset = chat.slice(resetStart, resetEnd)
  assert.ok(resetStart >= 0 && resetEnd > resetStart)
  assert.ok(
    reset.indexOf('conversationAccessReady.value = false') < reset.indexOf('teardownThreadSubscriptions()'),
    'the render gate must close before subscription cleanup begins',
  )
  for (const required of [
    'threadEpoch += 1',
    'teardownThreadSubscriptions()',
    'resetOffers()',
    'resetMeetups()',
    'messages.value = []',
    "conversationId.value = ''",
    'itemInfo.value = null',
    "inputText.value = ''",
  ]) assert.match(reset, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

  assert.match(chat, /const stopAccountTransitionListener = onAccountTransition\([^]*?resetThreadPrivateState\(\)/)
  assert.match(chat, /const setupThreadEpoch = threadEpoch[^]*?setupThreadEpoch === threadEpoch/)
  assert.match(chat, /const gateEpoch = threadEpoch[^]*?gateEpoch !== threadEpoch/)
  assert.match(offers, /function resetOffers\(\) \{[^]*?activeFetchEpoch \+= 1[^]*?offers\.value = \[\]/)
  assert.match(meetups, /function resetMeetups\(\) \{[^]*?activeFetchEpoch \+= 1[^]*?meetups\.value = \[\]/)

  assert.match(chatRoute, /const \{ currentUser, awaitAuthReady \} = useAuth\(\)/)
  assert.match(chatRoute, /onMounted\(\(\) => \{[^]*?routeMounted = true[^]*?const state = await awaitAuthReady\(\)[^]*?if \(!routeMounted \|\| conversationId\.value\) return[^]*?state === 'authenticated' \? '\/pages\/messages\/index' : '\/pages\/login\/index'/)
  assert.match(chatRoute, /onUnmounted\(\(\) => \{\s*routeMounted = false\s*\}\)/)
})

test('stale sign-out owners cannot navigate or present deletion results over B', () => {
  const auth = source('src/composables/useAuth.ts')
  const recovery = source('src/pages/profile-recovery/index.vue')
  const settings = source('src/pages/settings/index.vue')

  assert.match(auth, /async function signOut\([^)]*\): Promise<boolean>/)
  assert.match(auth, /if \(!isAccountIdentityGenerationCurrent\(signOutIdentityGeneration, null\)\) return false/)
  assert.match(auth, /return true\s*\n\s*}/)
  assert.match(recovery, /const ownsAnonymousContinuation = await signOut\(\{ redirect: false \}\)[^]*?if \(!ownsAnonymousContinuation \|\| !mounted\) return[^]*?reLaunch/)
  assert.match(settings, /if \(!flowStillCurrent\(\)\) return\s*const ownsAnonymousContinuation = await signOut/)
  assert.match(settings, /if \(!ownsAnonymousContinuation\) return/)
  assert.match(settings, /resultUiEpoch === settingsAccountEpoch/)
})
