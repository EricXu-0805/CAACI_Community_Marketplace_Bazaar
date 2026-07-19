import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = relativePath => readFileSync(resolve(appRoot, relativePath), 'utf8')

function compiledDataUrl(input) {
  const output = ts.transpileModule(input, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText
  return `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`
}

function functionBlock(input, startMarker, endMarker) {
  const start = input.indexOf(startMarker)
  const end = input.indexOf(endMarker, start + startMarker.length)
  assert.ok(start >= 0, `missing ${startMarker}`)
  assert.ok(end > start, `missing ${endMarker} after ${startMarker}`)
  return input.slice(start, end)
}

test('the first authoritative anonymous handshake clears mounted prior-owner state', async () => {
  const scope = await import(compiledDataUrl(source('src/composables/accountScope.ts')))
  let mountedSearchHistory = ['account A private query']
  const stop = scope.onAccountTransition(() => { mountedSearchHistory = [] })

  // accountScope starts anonymous. A non-forced null -> null is intentionally
  // a no-op, which models the cold-start bug this regression protects.
  scope.transitionAccount(null)
  assert.deepEqual(mountedSearchHistory, ['account A private query'])
  scope.transitionAccount(null, true)
  assert.deepEqual(mountedSearchHistory, [])
  stop()

  const auth = source('src/composables/useAuth.ts')
  assert.match(auth, /let initialAnonymousBroadcastComplete = false/)
  assert.match(auth, /const forceInitialAnonymous = !initialAuthHandshakeComplete[^]*?&& !initialAnonymousBroadcastComplete/)
  assert.match(auth, /if \(forceInitialAnonymous\) initialAnonymousBroadcastComplete = true[^]*?transitionAccount\([^]*?\|\| forceInitialAnonymous/)

  // Supabase is allowed to deliver INITIAL_SESSION synchronously from listener
  // registration and then return the same null snapshot from getSession. The
  // one-shot must produce exactly one forced notification in either ordering.
  let initialAnonymousBroadcastComplete = false
  const forceDecisions = [0, 1].map(() => {
    const force = !initialAnonymousBroadcastComplete
    if (force) initialAnonymousBroadcastComplete = true
    return force
  })
  assert.deepEqual(forceDecisions, [true, false])
  assert.match(auth, /if \(!getActiveAccountId\(\) && !initialAnonymousBroadcastComplete\) \{[^]*?await applySession\(null, \{[^]*?forceAnonymous: true,[^]*?source: 'init-failure'/)

  const search = source('src/pages/search/index.vue')
  const mounted = functionBlock(search, 'onMounted(async () => {', 'onUnmounted(() => {')
  assert.ok(
    mounted.indexOf('await awaitAuthReady()') < mounted.indexOf("readAccountPrivateStorage<unknown>('searchHistory'"),
    'search history must not hydrate before auth/storage reconciliation',
  )

  const history = source('src/pages/history/index.vue')
  assert.match(history, /v-else-if="historyReady && tab === 'items'"/)
  assert.match(history, /v-else-if="historyReady" id="history-posts-panel"/)
  const historyReveal = functionBlock(history, 'async function revealReconciledHistory', 'const stopAccountTransitionListener')
  assert.ok(
    historyReveal.indexOf('await awaitAuthReady()') < historyReveal.indexOf('historyReady.value = true'),
    'history rows stay hidden until storage ownership is reconciled',
  )

  const home = source('src/pages/index/index.vue')
  const onShow = functionBlock(home, 'onShow(async () => {', 'onHide(() => {')
  assert.ok(
    onShow.indexOf('await awaitAuthReady()') < onShow.indexOf('consumePendingSearch()'),
    'pending account-owned search state must wait for auth authority',
  )
})

test('detail and seller actions reject late results from a replaced account/page', () => {
  const detail = source('src/pages/detail/index.vue')
  const contact = functionBlock(detail, 'async function contactSeller()', '\n}\n\n</script>')
  assert.match(contact, /if \(contactingSeller\.value\) return[^]*?contactingSeller\.value = true/)
  assert.ok(contact.indexOf('contactingSeller.value = true') < contact.indexOf('await awaitAuthReady()'))
  assert.match(contact, /const accountToken = captureAccountRequest\(buyerId\)/)
  assert.match(contact, /const entryDetailEpoch = detailLoadEpoch/)
  assert.match(contact, /const conversation = await getOrCreateConversation[^]*?if \(!actionIsCurrent\(\)\) return[^]*?uni\.navigateTo/)
  assert.match(contact, /catch \(error\) \{\s*if \(!actionIsCurrent\(\)\) return/)

  const ownerStatus = functionBlock(detail, 'async function updateOwnedItemStatus', 'function onMarkReserved')
  assert.match(ownerStatus, /await updateItemStatus[^]*?if \(!actionIsCurrent\(\)\) return[^]*?item\.value\.status/)
  assert.match(ownerStatus, /catch \{\s*if \(!actionIsCurrent\(\)\) return/)

  const messages = source('src/composables/useMessages.ts')
  const conversation = functionBlock(messages, 'async function getOrCreateConversation', 'function subscribeToMessages')
  assert.match(conversation, /const accountToken = captureAccountRequest\(buyerId\)/)
  assert.ok((conversation.match(/assertCurrentAccount\(\)/g) || []).length >= 5)

  const seller = source('src/pages/seller/index.vue')
  const follow = functionBlock(seller, 'async function onToggleFollow()', 'const joinLabel')
  assert.match(follow, /if \(followingActionActive\.value\) return[^]*?followingActionActive\.value = true/)
  assert.ok(follow.indexOf('followingActionActive.value = true') < follow.indexOf('await awaitAuthReady()'))
  assert.match(follow, /const entryLoadEpoch = sellerLoadEpoch/)
  assert.match(follow, /await toggleFollow\(targetSellerId\)[^]*?if \(!actionIsCurrent\(\)\) return/)
  assert.match(follow, /catch \(err: any\) \{\s*if \(!actionIsCurrent\(\)\) return/)
  assert.match(seller, /onUnmounted\(\(\) => \{[^]*?sellerPageMounted = false[^]*?sellerLoadEpoch \+= 1[^]*?followingActionEpoch \+= 1/)
})

test('account-bound external side effects cannot cross the A to B handoff', () => {
  const meetups = source('src/composables/useMeetups.ts')
  const notify = functionBlock(meetups, 'function notifyMeetupEmail', 'async function fetchMeetups')
  assert.match(notify, /accountToken: AccountRequestToken/)
  assert.match(notify, /!isAccountRequestCurrent\(accountToken\)[^]*?sess\.session\?\.user\.id !== accountToken\.userId/)
  assert.ok(notify.indexOf('isAccountRequestCurrent(accountToken)') < notify.indexOf('platformFetch(meetupNotifyBase()'))
  for (const operation of ['proposeMeetup', 'respondToMeetup', 'rescheduleAccepted']) {
    const start = meetups.indexOf(`async function ${operation}`)
    assert.ok(start >= 0)
    const tail = meetups.slice(start, start + 1800)
    assert.match(tail, /if \(!isAccountRequestCurrent\(accountToken\)\) throw new Error/)
    assert.match(tail, /notifyMeetupEmail\(data as Meetup, accountToken\)/)
  }
  const meetupBoundaryMigration = source('../supabase/migrations/20260717141822_enforce_symmetric_chat_block_boundary.sql')
  for (const signature of [
    /CREATE OR REPLACE FUNCTION public\.propose_meetup\([^]*?expected_user_id_in uuid,[^]*?p_note text DEFAULT NULL\s*\)/,
    /CREATE OR REPLACE FUNCTION public\.respond_to_meetup\([^]*?expected_user_id_in uuid,[^]*?p_new_note text DEFAULT NULL\s*\)/,
    /CREATE OR REPLACE FUNCTION public\.reschedule_accepted_meetup\([^]*?expected_user_id_in uuid,[^]*?p_new_note text DEFAULT NULL\s*\)/,
  ]) assert.match(meetupBoundaryMigration, signature)

  const translate = source('src/composables/useTranslate.ts')
  const translateResult = functionBlock(translate, 'async function translateResult', 'async function translate(')
  const captureIndex = translateResult.indexOf('const accountToken = captureAccountRequest(entryUserId)')
  const sessionIndex = translateResult.indexOf('await supabase.auth.getSession()')
  const cacheReadIndex = translateResult.indexOf('const cached = getCached(text, target)')
  const fetchIndex = translateResult.indexOf('platformFetch(endpoint')
  assert.ok(captureIndex >= 0 && captureIndex < sessionIndex && sessionIndex < cacheReadIndex && cacheReadIndex < fetchIndex)
  assert.match(translateResult, /session\.user\.id !== accountToken\.userId[^]*?\|\| !isAccountRequestCurrent\(accountToken\)/)
  assert.match(translateResult, /cacheGeneration === translateCacheGeneration[^]*?&& isAccountRequestCurrent\(accountToken\)/)
  assert.match(translateResult, /return isAccountRequestCurrent\(accountToken\)/)
  const getCached = functionBlock(translate, 'function getCached', 'async function translateResult')
  assert.match(getCached, /if \(!getActiveAccountId\(\)\) return null/)

  const autoTranslate = source('src/composables/i18n/translate.ts')
  const schedule = autoTranslate.slice(autoTranslate.indexOf('export function scheduleAutoTranslate'))
  assert.ok(schedule.indexOf('const accountToken = captureAccountRequest(entryUserId)') < schedule.indexOf('supabase.auth.getSession()'))
  assert.match(schedule, /data\.session\?\.user\.id !== accountToken\.userId[^]*?return platformFetch/)
  assert.match(schedule, /\.then\(\(r\) => \{\s*if \(generation !== autoCacheGeneration \|\| !isAccountRequestCurrent\(accountToken\)\) return null/)

  const wechatGate = source('src/composables/useWechatSecCheck.ts')
  const bearer = functionBlock(wechatGate, 'async function authenticatedBearer', 'function assertAccountCurrent')
  assert.ok(bearer.indexOf('const accountToken = expectedAccountToken') < bearer.indexOf('await supabase.auth.getSession()'))
  assert.match(bearer, /session\.user\.id !== accountToken\.userId[^]*?!isAccountRequestCurrent\(accountToken\)/)
  for (const [path, expectedCalls] of [
    ['src/composables/useItems.ts', 4],
    ['src/composables/usePlaza.ts', 2],
    ['src/composables/useMessages.ts', 1],
  ]) {
    const guardedCalls = source(path).match(/mp(?:TextGate|ImageCheck)\([^\n]*accountToken\)/g) || []
    assert.equal(guardedCalls.length, expectedCalls, `${path} binds every WeChat gate to its entry account`)
  }

  const contentSafety = source('src/utils/contentSafety.ts')
  const remoteModeration = functionBlock(contentSafety, 'export async function remoteModerate', '/* ---------- Duplicate-within-session')
  assert.ok(remoteModeration.indexOf('const accountToken = expectedAccountToken') < remoteModeration.indexOf("await import('../composables/useSupabase')"))
  assert.match(remoteModeration, /sess\.session\?\.user\.id !== accountToken\.userId[^]*?!isAccountRequestCurrent\(accountToken\)[^]*?platformFetch/)
  for (const [path, expectedCalls] of [
    ['src/composables/useItems.ts', 2],
    ['src/composables/usePlaza.ts', 2],
    ['src/composables/useMessages.ts', 1],
    ['src/composables/useAuth.ts', 1],
  ]) {
    const guardedCalls = source(path).match(/remoteModerate\([^\n]*accountToken\)/g) || []
    assert.equal(guardedCalls.length, expectedCalls, `${path} binds every remote moderation call to its entry account`)
  }

  const auth = source('src/composables/useAuth.ts')
  const updateProfile = functionBlock(auth, 'async function updateProfile', 'function requireAuth')
  const profileTokenIndex = updateProfile.indexOf('const accountToken = options?.accountToken')
  const profileSessionIndex = updateProfile.indexOf('await supabase.auth.getSession()')
  assert.ok(profileTokenIndex >= 0 && profileTokenIndex < profileSessionIndex)
  assert.match(updateProfile, /session\.user\.id !== accountToken\.userId[^]*?!isAccountRequestCurrent\(accountToken\)/)
})

test('stale notification failures are silent and auth-waiting forms acquire a single-entry lock', () => {
  const notifications = source('src/composables/useNotifications.ts')
  const fetchBlock = functionBlock(notifications, 'async function fetchNotifications()', 'async function markAllRead()')
  assert.match(fetchBlock, /Promise\.all\([^]*?\.catch\(error => \{[^]*?!isAccountRequestCurrent\(token\)[^]*?return null[^]*?throw error/)
  assert.ok(
    fetchBlock.indexOf('if (!isAccountRequestCurrent(token) || requestId !== latestNotificationFetchId) return')
      < fetchBlock.indexOf('if (countResult.error) throw countResult.error'),
  )

  const illini = source('src/pages/illini-verify/index.vue')
  assert.match(illini, /function flowIsCurrent[^]*?return pageMounted[^]*?requestEpoch === pageEpoch/)
  assert.match(illini, /onUnmounted\(\(\) => \{[^]*?pageMounted = false[^]*?pageEpoch \+= 1/)
  for (const [startMarker, endMarker, lock] of [
    ['async function onSendCode()', 'async function onResend()', 'sending.value = true'],
    ['async function onResend()', 'async function onVerify()', 'sending.value = true'],
    ['async function onVerify()', 'function goBack()', 'verifying.value = true'],
  ]) {
    const block = functionBlock(illini, startMarker, endMarker)
    assert.ok(block.indexOf(lock) < block.indexOf('await awaitAuthReady()'), `${startMarker} locks before auth wait`)
  }

  const settings = source('src/pages/settings/index.vue')
  assert.match(settings, /if \(passwordResetFlowActive\) return[^]*?passwordResetFlowActive = true/)
  assert.match(settings, /if \(deletionFlowActive\) return[^]*?deletionFlowActive = true/)

  for (const [path, waitMarker, secondGuard] of [
    ['src/pages/saved-searches/index.vue', 'await awaitAuthReady()', 'if (submitting.value) return'],
    ['src/pages/onboarding/index.vue', 'await awaitAuthReady()', 'if (submitting.value) return'],
    ['src/pages/reconsent/index.vue', 'await awaitAuthReady()', 'if (submitting.value) return'],
    ['src/pages/suspended/index.vue', 'await awaitAuthReady()', 'if (submittingAppeal.value) return'],
  ]) {
    const page = source(path)
    const wait = page.indexOf(waitMarker, page.indexOf('async function'))
    assert.ok(wait >= 0 && page.indexOf(secondGuard, wait) > wait, `${path} rechecks its lock after auth wait`)
  }
})

test('polling, offer, moderation and view-count continuations retain their entry owner', () => {
  const realtime = source('src/composables/useRealtimeFallback.ts')
  const longPoll = functionBlock(realtime, 'function startLongPoll', 'function directConversationPoll')
  const sessionRead = longPoll.indexOf('await supabase.auth.getSession()')
  const aliveBarrier = longPoll.indexOf('if (!alive) return', sessionRead)
  const controllerCreation = longPoll.indexOf('ctrl = new AbortController()', sessionRead)
  assert.ok(sessionRead >= 0 && sessionRead < aliveBarrier && aliveBarrier < controllerCreation)

  const offers = source('src/composables/useOffers.ts')
  assert.match(offers, /await supabase\.rpc\('make_offer'[^]*?if \(!isAccountRequestCurrent\(accountToken\)\) throw/)
  assert.match(offers, /await supabase\.rpc\('respond_to_offer'[^]*?if \(!isAccountRequestCurrent\(accountToken\)\) throw/)

  const items = source('src/composables/useItems.ts')
  const fetchItem = functionBlock(items, 'async function fetchItem', 'async function createItem')
  assert.match(fetchItem, /const viewOwnerId = getActiveAccountId\(\)/)
  assert.match(fetchItem, /session\.user\.id !== viewAccountToken\.userId[^]*?\|\| !isAccountRequestCurrent\(viewAccountToken\)/)

  const moderation = source('src/composables/useModeration.ts')
  assert.match(moderation, /catch \(error\) \{\s*if \(!isAccountRequestCurrent\(token\)\) return \{ ok: false, reason: 'account_changed' \}/)
  assert.match(moderation, /const entryToken = entryUserId \? captureAccountRequest\(entryUserId\) : null/)
  const moderationEntry = functionBlock(moderation, 'async function requireEntryAccountToken', 'async function queryBlockedIds')
  assert.ok(moderationEntry.indexOf('const token = captureAccountRequest(entryUserId)') < moderationEntry.indexOf('await supabase.auth.getSession()'))
  assert.match(moderationEntry, /session\.user\.id !== token\.userId[^]*?!isAccountRequestCurrent\(token\)/)

  const notificationPage = source('src/pages/notifications/index.vue')
  assert.match(notificationPage, /onAccountTransition\(\(\) => \{[^]*?pageLoadEpoch \+= 1[^]*?markAllEpoch \+= 1[^]*?markingAll\.value = false/)
  assert.match(notificationPage, /onUnmounted\(\(\) => \{[^]*?pageVisible = false[^]*?pageLoadEpoch \+= 1[^]*?markAllEpoch \+= 1/)
  assert.match(notificationPage, /if \(markingAll\.value\) return[^]*?markingAll\.value = true/)

  const onboarding = source('src/pages/onboarding/index.vue')
  assert.match(onboarding, /onUnmounted\(\(\) => \{[^]*?pageMounted = false[^]*?resetOnboardingPrivateState\(\)/)
  const reconsent = source('src/pages/reconsent/index.vue')
  assert.match(reconsent, /onUnmounted\(\(\) => \{[^]*?pageMounted = false[^]*?consentSubmitEpoch \+= 1/)
  assert.match(reconsent, /pageMounted && submitEpoch === consentSubmitEpoch && isAccountRequestCurrent\(accountToken\)/)
  const savedSearches = source('src/pages/saved-searches/index.vue')
  assert.match(savedSearches, /onUnmounted\(\(\) => \{[^]*?pageVisible = false[^]*?pageEpoch \+= 1/)

  const blocked = source('src/pages/blocked/index.vue')
  assert.match(blocked, /await awaitAuthReady\(\)[^]*?if \(!blockedPageAlive\) return/)
  assert.match(blocked, /onUnload\(\(\) => \{\s*blockedPageAlive = false/)
  const following = source('src/pages/following/index.vue')
  assert.match(following, /const state = await awaitAuthReady\(\)\s*if \(!followingPageAlive\) return false/)
  assert.match(following, /onUnload\(\(\) => \{\s*followingPageAlive = false/)
  const messagesPage = source('src/pages/messages/index.vue')
  assert.match(messagesPage, /const showEpoch = messagesPageEpoch[^]*?await awaitAuthReady\(\)[^]*?!messagesPageAlive \|\| showEpoch !== messagesPageEpoch/)
  assert.match(messagesPage, /onUnload\(\(\) => \{\s*messagesPageAlive = false\s*messagesPageEpoch \+= 1/)

  const chatThread = source('src/components/ChatThread.vue')
  assert.match(chatThread, /await fetchMessages\(options\.id\)[^]*?catch \{\s*if \(isCurrentThreadSetup\(\)\) uni\.showToast/)
  assert.match(chatThread, /fetchMessages\(options\.id\)\.then\(\(\) => \{\s*if \(isCurrentThreadSetup\(\)\) nextTick/)

  const profileRecovery = source('src/pages/profile-recovery/index.vue')
  assert.match(profileRecovery, /const ready = await ensureProfileReady[^]*?if \(!mounted \|\| !isAccountRequestCurrent\(accountToken\)\) return[^]*?uni\.showToast/)
  assert.match(profileRecovery, /finally \{\s*if \(mounted && isAccountRequestCurrent\(accountToken\)\) retrying\.value = false/)

  const plaza = source('src/composables/usePlaza.ts')
  for (const [startMarker, endMarker] of [
    ['async function toggleLike', 'async function toggleCommentLike'],
    ['async function toggleCommentLike', 'async function fetchComments'],
  ]) {
    const toggle = functionBlock(plaza, startMarker, endMarker)
    const guardedErrors = toggle.match(/if \(!isAccountRequestCurrent\(accountToken\)\) return\s*if \(error/g) || []
    assert.equal(guardedErrors.length, 2, `${startMarker} suppresses both stale mutation failures`)
  }

  const messages = source('src/composables/useMessages.ts')
  for (const [startMarker, endMarker] of [
    ['async function markAsRead', 'async function archiveConversation'],
    ['async function archiveConversation', 'async function fetchConversationDetail'],
    ['async function setConversationPinned', 'async function setConversationMuted'],
    ['async function setConversationMuted', 'async function markConversationUnread'],
    ['async function markConversationUnread', '\n\n  return {'],
  ]) {
    const mutation = functionBlock(messages, startMarker, endMarker)
    assert.match(mutation, /isAccountRequestCurrent\(accountToken\)/)
  }

  const favorites = source('src/composables/useFavorites.ts')
  const favoriteItems = functionBlock(favorites, 'async function fetchMyFavoriteItems', 'function reset()')
  assert.ok(
    favoriteItems.indexOf('if (!isAccountRequestCurrent(token)) return []')
      < favoriteItems.indexOf('if (error) throw error'),
  )

  const ratings = source('src/composables/useRatings.ts')
  const submitRating = functionBlock(ratings, 'async function submitRating', 'async function fetchForUser')
  assert.match(submitRating, /const accountToken = (?:input\.accountToken \|\| )?captureAccountRequest\(userId\)[^]*?await supabase[^]*?if \(!isAccountRequestCurrent\(accountToken\)\) throw/)
  const hasRated = functionBlock(ratings, 'async function hasRated', '\n\n  return {')
  assert.match(hasRated, /if \(!isAccountRequestCurrent\(accountToken\)\) return false[^]*?if \(error\) throw error/)

  const plazaPrivateReads = source('src/composables/usePlaza.ts')
  const activeItems = functionBlock(plazaPrivateReads, 'async function fetchMyActiveItems', 'async function fetchUserPosts')
  assert.match(activeItems, /const accountToken = captureAccountRequest\(userId\)[^]*?if \(!isAccountRequestCurrent\(accountToken\)\) return \[\][^]*?if \(error\) throw error/)
  const postI18n = functionBlock(plazaPrivateReads, 'async function updatePostI18n', 'async function fetchMyActiveItems')
  assert.match(postI18n, /expectedAccountToken[^]*?isAccountRequestCurrent\(accountToken\)[^]*?await supabase[^]*?if \(!isAccountRequestCurrent\(accountToken\)\) return/)

  const itemUploads = source('src/composables/useItems.ts')
  for (const [startMarker, endMarker] of [
    ['async function uploadImagesWithDims', 'async function uploadImages('],
    ['async function uploadOneImage', 'async function fetchMyItems'],
  ]) {
    const upload = functionBlock(itemUploads, startMarker, endMarker)
    assert.ok(upload.indexOf('const accountToken = options?.accountToken') < upload.indexOf('await supabase.auth.getSession()'))
    assert.match(upload, /assertAccountCurrent\(accountToken, session\.user\.id\)/)
  }
  assert.doesNotMatch(itemUploads, /uploadOneVideo|MAX_VIDEO_SIZE|VIDEO_UPLOAD_TIMEOUT_MS/)
  for (const [startMarker, endMarker] of [
    ['async function createItem', 'async function updateItem'],
    ['async function updateItem(', 'async function cleanupFailedUploadBatch'],
    ['async function updateItemStatus', 'async function removeOwnedItemImages'],
    ['async function deleteItem', 'function clearItems'],
  ]) {
    const mutation = functionBlock(itemUploads, startMarker, endMarker)
    assert.ok(mutation.indexOf('captureAccountRequest(entryUserId)') < mutation.indexOf('await supabase.auth.getSession()'))
    assert.match(mutation, /assertAccountCurrent\(accountToken, session\.user\.id\)/)
  }
})
