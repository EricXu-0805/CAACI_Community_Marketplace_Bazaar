import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = (relativePath) => readFileSync(resolve(appRoot, relativePath), 'utf8')

async function loadTypeScriptModule(relativePath) {
  const compiled = ts.transpileModule(source(relativePath), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
}

test('upload batches carry their account generation into item mutations', () => {
  const items = source('src/composables/useItems.ts')
  const publish = source('src/pages/publish/index.vue')
  const edit = source('src/pages/publish/edit.vue')

  assert.match(items, /interface UploadBatchResult[\s\S]*accountToken: UploadAccountToken/)
  assert.match(items, /const accountToken = options\?\.accountToken[\s\S]*captureAccountRequest\(entryUserId\)[\s\S]*await supabase\.auth\.getSession\(\)/)
  assert.match(items, /return \{ urls, dims, accountToken \}/)

  assert.match(publish, /uploadAccountToken = res\.accountToken/)
  assert.match(
    publish,
    /createItem\(payload, \{\s*accountToken: submitAccountToken,?\s*\}\)/,
  )
  assert.match(edit, /uploadAccountToken = res\.accountToken/)
  assert.match(
    edit,
    /commitEditWithCompatibleRetry\(\s*\{ \.\.\.payload \},\s*submitAccountToken,?\s*\)/,
  )
  assert.match(edit, /\{ expectedUpdatedAt: loadedUpdatedAt\.value, accountToken \}/)
})

test('account changes fail closed before writes and committed writes are not compensated', () => {
  const items = source('src/composables/useItems.ts')
  const publish = source('src/pages/publish/index.vue')
  const edit = source('src/pages/publish/edit.vue')

  const createStart = items.indexOf('async function createItem(')
  const updateStart = items.indexOf('async function updateItem(')
  const uploadStart = items.indexOf('async function cleanupFailedUploadBatch(')
  const createBlock = items.slice(createStart, updateStart)
  const updateBlock = items.slice(updateStart, uploadStart)

  assert.ok(createStart >= 0 && updateStart > createStart && uploadStart > updateStart)
  assert.ok(createBlock.indexOf('assertAccountCurrent(accountToken, session.user.id)') < createBlock.indexOf(".from('items').insert"))
  assert.ok(updateBlock.indexOf('assertAccountCurrent(accountToken, session.user.id)') < updateBlock.indexOf(".from('items')"))
  assert.match(createBlock, /throw accountChangedError\(true\)/)
  assert.match(updateBlock, /throw accountChangedError\(true\)/)

  assert.match(publish, /shouldCompensateMutationFailure\(error\)/)
  assert.match(edit, /shouldCompensateMutationFailure\(error\)/)
  assert.match(publish, /mutationCommitState\(error\) === 'unknown'/)
  assert.match(edit, /mutationCommitState\(error\) === 'unknown'/)
})

test('compensation targets only the original owner and makes orphan risk observable', () => {
  const items = source('src/composables/useItems.ts')
  const cleanupStart = items.indexOf('async function removeOwnedItemImages(')
  const cleanupEnd = items.indexOf('\n  async function deleteItem(', cleanupStart)
  const cleanup = items.slice(cleanupStart, cleanupEnd)

  assert.ok(cleanupStart >= 0 && cleanupEnd > cleanupStart)
  assert.match(cleanup, /ownedItemImagePaths\(\s*urls,\s*ownerUserId,/)
  assert.match(cleanup, /if \(session\.user\.id !== ownerUserId\)/)
  assert.ok(cleanup.indexOf('if (session.user.id !== ownerUserId)') < cleanup.indexOf(".from('item-images').remove(paths)"))
  assert.match(cleanup, /orphan_risk: 'true'/)
  assert.match(cleanup, /reason: 'session_mismatch'/)

  assert.match(items, /ownerUserId: accountToken\.userId/)
  assert.match(items, /items\.heic_batch_upload_cleanup/)
  assert.match(items, /items\.account_changed_single_image_cleanup/)
  assert.doesNotMatch(items, /uploadOneVideo|single_video_upload|MAX_VIDEO_SIZE/)

  const deleteStart = items.indexOf('async function deleteItem(')
  const deleteBlock = items.slice(deleteStart, items.indexOf('\n  function clearItems(', deleteStart))
  assert.match(deleteBlock, /ownerUserId: accountToken\.userId/)
  assert.match(deleteBlock, /telemetrySource: 'items\.delete_cleanup'/)
})

test('response-lost and 5xx mutations retain media while definite rejections compensate', async () => {
  const commit = await loadTypeScriptModule('src/api/mutationCommit.ts')

  const responseLost = commit.mutationOutcomeError(new TypeError('Failed to fetch'), 'unknown')
  assert.equal(commit.mutationCommitState(responseLost), 'unknown')
  assert.equal(commit.shouldCompensateMutationFailure(responseLost), false)

  assert.equal(commit.isDefinitiveMutationRejection({ status: 503, message: 'upstream unavailable' }), false)
  assert.equal(commit.isDefinitiveMutationRejection({ code: '23514', message: 'check failed' }), true)
  const rejected = commit.mutationOutcomeError({ code: '23514', message: 'check failed' }, 'not_committed')
  assert.equal(commit.shouldCompensateMutationFailure(rejected), true)

  const committed = commit.mutationOutcomeError(new Error('UI reconcile failed'), 'committed')
  assert.equal(commit.shouldCompensateMutationFailure(committed), false)
  assert.equal(committed.mutationCommitted, true)
})

test('public chat rejects media while text and stickers retain account-bound idempotent sends', () => {
  const messages = source('src/composables/useMessages.ts')
  const chat = source('src/components/ChatThread.vue')
  const edit = source('src/pages/publish/edit.vue')

  assert.doesNotMatch(chat, /sendUploadedMedia|uni\.chooseImage\(|uni\.chooseVideo\(|uploadOneImage|uploadOneVideo/)
  assert.match(messages, /if \(type !== 'text'\) throw new Error\('chat_media_private_storage_required'\)/)
  assert.match(messages, /options\?: \{[\s\S]*accountToken\?: AccountRequestToken[\s\S]*messageId\?: string/)
  assert.match(messages, /mutationOutcomeError\(writeError, 'unknown'\)/)
  assert.match(chat, /sendMessage\(convId, senderId, content, 'text', \{ messageId: tempId \}\)/)
  assert.match(chat, /sendWithLocalEcho\(convId, senderId, stickerToken\(name\)\)/)
  assert.match(chat, /if \(msg\?\.message_type !== 'text'\) return/)
  assert.match(chat, /throw mutationOutcomeError\(error, 'committed'\)/)

  // Removing old edit images must still know A when no new upload batch exists.
  assert.match(edit, /ownerUserId: updatedItem\.user_id/)
})

test('chat retries reuse a client-allocated row id and recover response-lost commits', async () => {
  const ids = await loadTypeScriptModule('src/api/clientMessageId.ts')
  const generated = Array.from({ length: 500 }, () => ids.createClientMessageId())
  const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  assert.equal(new Set(generated).size, generated.length)
  assert.ok(generated.every(id => uuidV4.test(id)))

  const messages = source('src/composables/useMessages.ts')
  const chat = source('src/components/ChatThread.vue')
  const migration = source('../supabase/migrations/20260717092804_secure_public_write_boundaries.sql')

  assert.match(messages, /const messageId = options\?\.messageId \|\| createClientMessageId\(\)/)
  assert.match(messages, /\.insert\(\{\s*id: messageId,/)
  assert.match(messages, /recoverCommittedMessage\(\s*messageId, senderId, conversationId, content, type/)
  assert.match(messages, /String\(\(error as any\)\?\.code \|\| ''\) === '23505'/)
  assert.match(messages, /duplicatePrimaryKey\s*\? 'unknown'/)
  const recovery = messages.slice(messages.indexOf('async function recoverCommittedMessage('))
  assert.match(recovery, /\.eq\('conversation_id', conversationId\)/)
  assert.match(recovery, /data\.content !== content \|\| data\.message_type !== type/)
  assert.match(chat, /messageId: tempId/)
  assert.match(chat, /messageId: msg\.id,[\s\S]*isRetry: true/)
  assert.match(chat, /existingIndex >= 0[\s\S]*_pending[\s\S]*messages\.value\.splice\(existingIndex, 1, newMsg\)/)
  const actionMenu = chat.slice(
    chat.indexOf('function onMsgLongPress('),
    chat.indexOf('\nfunction scrollToBottom(', chat.indexOf('function onMsgLongPress(')),
  )
  assert.match(actionMenu, /const isFailedTemp = msg\._failed === true/)
  assert.doesNotMatch(actionMenu, /startsWith\('temp-'\)/)
  assert.match(actionMenu, /if \(live\?\._failed === true\)/)
  assert.match(migration, /GRANT INSERT \(id, conversation_id, sender_id, content, message_type\)/)
})

test('mini-program image moderation waits for a durable verdict handoff', () => {
  const items = source('src/composables/useItems.ts')
  const gate = source('src/composables/useWechatSecCheck.ts')

  assert.match(gate, /export async function mpImageCheck[\s\S]*Promise<void>/)
  assert.match(gate, /\{ failureCode: 'wechat_media_check_unavailable' \}/)
  assert.match(gate, /!hasDurableWechatMediaHandoff\(result\)/)
  assert.doesNotMatch(gate, /fire-and-forget async submit/)
  assert.equal((items.match(/await mpImageCheck\(storagePath, 'item-images', accountToken\)/g) || []).length, 2)

  const batchCheck = items.indexOf("await mpImageCheck(storagePath, 'item-images', accountToken)")
  const batchPublish = items.indexOf('urls.push(candidateUrl)', batchCheck)
  assert.ok(batchCheck >= 0 && batchPublish > batchCheck,
    'batch upload exposes the URL before the moderation handoff')
  assert.match(items, /items\.wechat_media_handoff_cleanup/)
})

test('every remaining upload caller carries owner generation through its database write', () => {
  const items = source('src/composables/useItems.ts')
  const plazaPage = source('src/pages/plaza/index.vue')
  const plaza = source('src/composables/usePlaza.ts')
  const profile = source('src/pages/profile/edit.vue')
  const auth = source('src/composables/useAuth.ts')
  const onboarding = source('src/pages/onboarding/index.vue')

  assert.match(items, /Promise<\{ urls: string\[\]; accountToken: UploadAccountToken \}>/)
  assert.match(items, /return \{ urls, accountToken \}/)
  assert.match(items, /items\.late_upload_candidate_cleanup/)

  assert.match(plazaPage, /uploadAccountToken = up\.accountToken/)
  assert.match(plazaPage, /accountToken: submitAccountToken/)
  assert.match(plazaPage, /shouldCompensateMutationFailure\(err\)/)
  assert.match(plazaPage, /plaza\.create_commit_unknown/)
  assert.match(plaza, /extras\.accountToken \|\| captureAccountRequest\(userId\)/)
  assert.match(plaza, /assertAccountCurrent\(true\)/)
  assert.match(plaza, /postCommitted \? 'committed'/)

  assert.match(profile, /const \{ urls, accountToken \} = await uploadImages[\s\S]*accountToken: submitAccountToken/)
  assert.match(profile, /\{ accountToken: submitAccountToken \}/)
  assert.match(profile, /profile\.update_commit_unknown/)
  assert.match(auth, /options\?: \{ accountToken\?: AccountRequestToken \}/)
  assert.match(auth, /isAccountRequestCurrent\(accountToken\)/)
  assert.match(auth, /committed \? 'committed'/)

  const pickStart = onboarding.indexOf('async function pickAvatar(')
  const finishStart = onboarding.indexOf('async function finish(')
  assert.ok(pickStart >= 0 && finishStart > pickStart)
  assert.doesNotMatch(onboarding.slice(pickStart, finishStart), /uploadImages\(/)
  assert.match(onboarding.slice(finishStart), /const uploaded = await uploadImages[\s\S]*?accountToken:\s*submitAccountToken,/)
  assert.match(onboarding.slice(finishStart), /isAccountRequestCurrent\(accountToken\)/)
  assert.match(onboarding, /onboarding\.mark_commit_unknown/)
})

test('text-only and no-upload submits remain bound to the account that owns the page state', () => {
  const publish = source('src/pages/publish/index.vue')
  const edit = source('src/pages/publish/edit.vue')
  const plaza = source('src/pages/plaza/index.vue')
  const profile = source('src/pages/profile/edit.vue')
  const onboarding = source('src/pages/onboarding/index.vue')

  assert.match(publish, /publishPageAccountToken = nextAccountToken/)
  assert.match(publish, /clearDraft\(\)\s*resetForm\(\)/)
  assert.match(publish, /const entryAccountToken = publishPageAccountToken/)
  assert.match(publish, /const submitAccountToken = entryAccountToken/)
  assert.match(publish, /accountToken: submitAccountToken/)

  assert.match(edit, /const accountToken = captureAccountRequest\(currentUser\.value\.id\)/)
  assert.match(edit, /editPageAccountToken = accountToken/)
  assert.match(edit, /item\.user_id !== accountToken\.userId/)
  assert.match(edit, /commitEditWithCompatibleRetry\(\s*\{ \.\.\.payload \},\s*submitAccountToken/)

  assert.match(plaza, /composerAccountToken = captureAccountRequest\(currentUser\.value\.id\)/)
  assert.match(plaza, /const submitAccountToken = composerAccountToken/)
  assert.match(plaza, /accountToken: submitAccountToken/)

  assert.match(profile, /const accountToken = captureAccountRequest\(currentUser\.value\.id\)/)
  assert.match(profile, /pageAccountToken = accountToken/)
  assert.match(profile, /const submitAccountToken = entryAccountToken/)
  assert.match(profile, /updateProfile\([\s\S]*\{ accountToken: submitAccountToken \}/)

  assert.match(onboarding, /pageAccountToken = captureAccountRequest\(u\.id\)/)
  assert.match(onboarding, /const submitAccountToken = pageAccountToken/)
  assert.match(onboarding, /const accountToken = submitAccountToken/)
  assert.match(onboarding, /mark_onboarded[\s\S]*expected_user_id_in: accountToken\.userId/)
  assert.match(onboarding, /record_consent[\s\S]*expected_user_id_in: accountToken\.userId/)
})

test('consent RPC calls carry page intent and never acknowledge or navigate a replacement account', () => {
  const reconsent = source('src/pages/reconsent/index.vue')

  assert.match(reconsent, /const accountToken = captureActiveAccountRequest\(\)/)
  assert.match(reconsent, /record_consent[\s\S]*expected_user_id_in: accountToken\.userId/)
  assert.equal((reconsent.match(/if \(!pageMounted \|\| submitEpoch !== consentSubmitEpoch \|\| !isAccountRequestCurrent\(accountToken\)\) return/g) || []).length, 2)
  assert.match(reconsent, /setTimeout\(\(\) => \{[\s\S]*pageMounted && submitEpoch === consentSubmitEpoch && isAccountRequestCurrent\(accountToken\)[\s\S]*switchTab/)
})

test('an incomplete public profile can never satisfy the suspension and consent gate', () => {
  const auth = source('src/composables/useAuth.ts')
  const app = source('src/App.vue')
  const recovery = source('src/pages/profile-recovery/index.vue')

  assert.match(auth, /isGateCompleteProfile\(data, userId\)/)
  assert.match(auth, /hasOwn\(row, 'tos_version'\)/)
  assert.match(auth, /hasOwn\(row, 'suspension_level'\)/)
  assert.match(auth, /hasOwn\(row, 'suspended_until'\)/)
  assert.doesNotMatch(auth, /\.from\('profiles'\)[\s\S]{0,180}is_illini_verified/)
  assert.match(auth, /profileLoadState\.value = 'error'/)
  assert.match(auth, /uni\.reLaunch\(\{ url: '\/pages\/profile-recovery\/index' \}\)/)
  assert.match(app, /authState\.value === 'authenticated' && profileLoadState\.value !== 'ready'/)
  assert.match(recovery, /ensureProfileReady\(\{ force: true \}\)/)
  assert.match(recovery, /await signOut\(\{ redirect: false \}\)/)
  assert.match(recovery, /requestAccountDeletion\(/)
  assert.match(recovery, /session\.user\.id !== accountToken\.userId/)
})

test('submit locks are released only when the in-flight operation settles', () => {
  for (const [relativePath, lockName] of [
    ['src/pages/publish/index.vue', 'submitting'],
    ['src/pages/publish/edit.vue', 'submitting'],
    ['src/pages/plaza/index.vue', 'submitting'],
    ['src/pages/plaza/index.vue', 'commentSubmitting'],
    ['src/pages/post/index.vue', 'submitting'],
    ['src/components/ChatThread.vue', 'sending'],
  ]) {
    const page = source(relativePath)
    const unsafeUnlock = new RegExp(
      `setTimeout\\(\\(\\) => \\{ ${lockName}\\.value = false`,
    )
    const settledUnlock = new RegExp(
      `finally \\{[\\s\\S]*${lockName}\\.value = false`,
    )
    assert.doesNotMatch(page, unsafeUnlock, `${relativePath}:${lockName} has an uncancelled timeout unlock`)
    assert.match(page, settledUnlock, `${relativePath}:${lockName} does not release in finally`)
  }

  for (const relativePath of [
    'src/pages/publish/index.vue',
    'src/pages/publish/edit.vue',
  ]) {
    const page = source(relativePath)
    const submit = page.indexOf('async function onSubmit()')
    const guard = page.indexOf('if (submitEntryLocked) return', submit)
    const acquire = page.indexOf('submitEntryLocked = true', guard)
    const firstAwait = page.indexOf('await awaitAuthReady()', submit)
    assert.ok(submit >= 0 && guard > submit && acquire > guard && firstAwait > acquire,
      `${relativePath} does not lock before the first await`)
    assert.match(
      page.slice(submit),
      /finally \{\s*if \(operationEpoch === (?:publish|edit)OperationEpoch\) submitEntryLocked = false\s*\}/,
    )
  }

  const edit = source('src/pages/publish/edit.vue')
  const successToast = edit.indexOf("uni.showToast({ title: t('publish.updated')")
  const lockedDelay = edit.indexOf('await new Promise<void>((resolve) => setTimeout(resolve, 1500))', successToast)
  const navigate = edit.indexOf('goBack()', lockedDelay)
  const release = edit.indexOf('submitEntryLocked = false', navigate)
  assert.ok(successToast >= 0 && lockedDelay > successToast && navigate > lockedDelay && release > navigate,
    'edit success releases its entry lock before navigation')
})

test('publish removes only its scoped switch-tab guard', () => {
  const publish = source('src/pages/publish/index.vue')
  assert.match(publish, /removeScopedInterceptor\('switchTab', switchTabInterceptor\)/)
  assert.doesNotMatch(publish, /uni\.removeInterceptor\('switchTab'\)/)
})

test('chat history is archived per participant and never hard-deleted by the client', () => {
  const messages = source('src/composables/useMessages.ts')
  const inbox = source('src/pages/messages/index.vue')
  const chat = source('src/components/ChatThread.vue')
  const archives = source('src/api/conversationArchive.ts')
  const notifications = source('src/composables/useNotifications.ts')

  assert.match(messages, /supabase\.rpc\('archive_conversation'/)
  assert.match(messages, /fetchArchivedConversationIds\(supabase, userId\)/)
  assert.doesNotMatch(messages, /\.from\('conversations'\)[\s\S]{0,120}\.delete\(\)/)
  assert.doesNotMatch(messages, /\.from\('messages'\)[\s\S]{0,120}\.delete\(\)/)
  assert.match(inbox, /archiveConversation\(conv\.id\)/)
  assert.doesNotMatch(chat, /deleteMessage|chat\.deleteMsg/)
  assert.match(archives, /\['42P01', 'PGRST205'\]/)
  assert.doesNotMatch(archives, /\['42P01', 'PGRST204'/)
  assert.match(archives, /detail\.includes\('conversation_archives'\)/)

  const unread = source('src/composables/useUnread.ts')
  assert.match(unread, /const updatedExistingRow = applyIncomingMessage\(newMsg, userId\)/)
  assert.match(unread, /if \(!updatedExistingRow\)[\s\S]*?fetchConversations\(userId, \{ force: true \}\)/)
  assert.match(unread, /subscribeToUserInbox\([\s\S]*?\(\) => \{[\s\S]*?refreshUnreadCount\(\)[\s\S]*?fetchConversations\(userId, \{ force: true \}\)/)
  assert.match(notifications, /row\.conversation_id[\s\S]*row\.type !== 'offer'[\s\S]*row\.type !== 'meetup'/)
  assert.match(notifications, /invalidateConversations\(\)[\s\S]*?fetchConversations\(userId, \{ force: true \}\)/)
  const incoming = notifications.indexOf('function handleIncoming(row: Notification)')
  const restore = notifications.indexOf('restoreInboxForStructuredActivity(row)', incoming)
  const dedupe = notifications.indexOf('notifications.value.some', incoming)
  assert.ok(incoming >= 0 && incoming < restore && restore < dedupe,
    'structured archive restore must happen before notification de-duplication')
  assert.match(notifications, /for \(const row of listRows\) restoreInboxForStructuredActivity\(row\)/)
  assert.match(notifications, /startNotificationsListener\(u\.id, \(\) => \{[\s\S]*?fetchNotifications\(\)/)
  assert.match(notifications, /const requestId = \+\+latestNotificationFetchId/)
  assert.match(notifications, /requestId !== latestNotificationFetchId/)
  assert.match(notifications, /notificationLiveGeneration \+= 1/)
  const liveSnapshotGuard = notifications.indexOf('liveGenerationAtStart !== notificationLiveGeneration')
  const snapshotAssignment = notifications.indexOf('notifications.value = listRows', liveSnapshotGuard)
  assert.ok(liveSnapshotGuard >= 0 && liveSnapshotGuard < snapshotAssignment,
    'an HTTP snapshot can overwrite a newer realtime notification')

  const realtime = source('src/composables/useRealtimeFallback.ts')
  assert.match(realtime, /subscribeToUserNotifications\([\s\S]*onReady\?: \(\) => void/)
  assert.match(realtime, /status === 'SUBSCRIBED'[\s\S]*onReady\?\.\(\)/)
  assert.match(realtime, /\.from\('notifications'\)[\s\S]*?\.select\('id, created_at'\)[\s\S]*?messageCursorFromRow\(data\[0\]\)[\s\S]*?lastSeen = \{ createdAt: '', id: null \}[\s\S]*?onReady\?\.\(\)/)
  assert.match(realtime, /subscribeToUserInbox\([\s\S]*onReady\?: \(\) => void/)
  assert.match(realtime, /scope: 'inbox'[\s\S]*onReady,/)
})

test('a committed chat response cannot repopulate the next account singleton', () => {
  const messages = source('src/composables/useMessages.ts')
  const chat = source('src/components/ChatThread.vue')

  const dataGuard = messages.indexOf("throw mutationOutcomeError(new Error('Account changed after message send'), 'committed')")
  const invalidate = messages.indexOf('invalidateConversations()', dataGuard)
  assert.ok(dataGuard >= 0 && invalidate > dataGuard)

  const sendStart = chat.indexOf('async function sendWithLocalEcho(')
  const reconcile = chat.indexOf('reconcileSentMessage(sent, tempId)', sendStart)
  const accountGuard = chat.indexOf('currentUser.value?.id !== senderId', sendStart)
  assert.ok(sendStart >= 0 && accountGuard > sendStart && accountGuard < reconcile)
  assert.match(chat.slice(sendStart, reconcile), /mutationOutcomeError\(new Error\('Account changed after message send'\), 'committed'\)/)
})

test('comment moderation and delayed plaza pickers stay bound to their originating account session', () => {
  const plaza = source('src/composables/usePlaza.ts')
  const plazaPage = source('src/pages/plaza/index.vue')
  const postPage = source('src/pages/post/index.vue')

  const commentStart = plaza.indexOf('async function createComment(')
  const commentEnd = plaza.indexOf('\n  async function deleteComment(', commentStart)
  const comment = plaza.slice(commentStart, commentEnd)
  assert.ok(commentStart >= 0 && commentEnd > commentStart)
  assert.match(comment, /const userId = currentUser\.value\.id/)
  assert.match(comment, /const accountToken = captureAccountRequest\(userId\)/)
  assert.ok(comment.indexOf('assertAccountCurrent()') > comment.indexOf('await mpTextGate'))
  assert.ok(comment.indexOf('assertAccountCurrent()') < comment.indexOf(".from('post_comments')"))
  assert.match(comment, /user_id: userId/)
  assert.match(comment, /assertAccountCurrent\(true\)/)
  assert.match(comment, /committed \? 'committed' : mutationStarted \? 'unknown'/)

  assert.match(plazaPage, /let composerSessionId = 0/)
  assert.match(plazaPage, /const pickerSessionId = composerSessionId/)
  assert.match(plazaPage, /const pickerAccountToken = composerAccountToken/)
  assert.match(plazaPage, /pickerSessionId === composerSessionId/)
  assert.match(plazaPage, /isAccountRequestCurrent\(pickerAccountToken\)/)
  assert.match(plazaPage, /const commentAccountToken = captureAccountRequest\(me\.id\)/)
  assert.match(plazaPage, /if \(!isAccountRequestCurrent\(commentAccountToken\)\) return/)
  assert.match(postPage, /const commentAccountToken = captureAccountRequest\(currentUser\.value\.id\)/)
  assert.match(postPage, /if \(!isAccountRequestCurrent\(commentAccountToken\)\) return/)
})
