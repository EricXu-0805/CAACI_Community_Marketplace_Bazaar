import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(
  new URL('../src/pages/admin/index.vue', import.meta.url),
  'utf8',
)

function latestRequestModel() {
  let epoch = 0
  const latest = new Map()
  return {
    begin(scope) {
      const request = { scope, epoch: ++epoch }
      latest.set(scope, request.epoch)
      return request
    },
    current(request) {
      return latest.get(request.scope) === request.epoch
    },
    invalidate(scope) {
      latest.set(scope, ++epoch)
    },
  }
}

test('a slower same-admin request cannot replace the latest target', () => {
  const requests = latestRequestModel()
  const detailA = requests.begin('detail')
  const detailB = requests.begin('detail')
  let visible = null

  if (requests.current(detailB)) visible = 'suspension-b'
  if (requests.current(detailA)) visible = 'report-a'

  assert.equal(visible, 'suspension-b')
  requests.invalidate('detail')
  assert.equal(requests.current(detailB), false)
})

test('search, linked accounts, detail and uploads use latest-request ownership', () => {
  assert.match(source, /type AdminRequestScope = 'tab-load' \| 'stats' \| 'reports' \| 'plaza' \| 'tokens' \| 'search-users' \| 'linked-accounts' \| 'detail' \| 'banner-upload'/)
  assert.match(source, /latestAdminRequest\.get\(request\.requestScope\) === request\.requestEpoch/)
  assert.match(source, /function resetAdminPrivateState\(\) \{\s+invalidateAllAdminRequests\(\)/)

  const search = source.slice(
    source.indexOf('async function searchUsers'),
    source.indexOf('\ninterface LinkedRow'),
  )
  assert.match(search, /beginAdminRequest\('search-users'\)/)
  assert.match(search, /const requestIsLatest = \(\) => isAdminRequestCurrent\(request\)/)
  assert.match(search, /const requestCanApply = \(\) => requestIsLatest\(\) && userQuery\.value\.trim\(\) === q/)
  assert.match(search, /finally \{\s+if \(requestIsLatest\(\)\) userSearching\.value = false/)

  const linked = source.slice(
    source.indexOf('async function loadLinked'),
    source.indexOf('\nconst detailOpen'),
  )
  assert.match(linked, /invalidateAdminRequest\('linked-accounts'\)/)
  assert.match(linked, /beginAdminRequest\('linked-accounts'\)/)
  assert.match(linked, /isAdminRequestCurrent\(request\) && linkedFor\.value === userId/)

  const sharedDetail = source.slice(
    source.indexOf('async function loadAdminDetail'),
    source.indexOf('\nfunction retryDetail'),
  )
  const reportDetail = source.slice(
    source.indexOf('async function openReportById'),
    source.indexOf('\nfunction openReport\('),
  )
  const suspensionDetail = source.slice(
    source.indexOf('async function openSuspension'),
    source.indexOf('\n/* Open-target navigation'),
  )
  assert.match(sharedDetail, /beginAdminRequest\('detail'\)/)
  assert.match(sharedDetail, /detailKind\.value === kind/)
  assert.match(sharedDetail, /detailTargetId\.value === id/)
  assert.match(reportDetail, /loadAdminDetail\('report', id\)/)
  assert.match(suspensionDetail, /loadAdminDetail\('suspension', s\.id\)/)
  assert.match(source, /function closeDetail[\s\S]*?invalidateAdminRequest\('detail'\)/)
  assert.match(source, /function editBanner[\s\S]*?invalidateAdminRequest\('banner-upload'\)/)
  assert.match(source, /function resetBannerForm[\s\S]*?invalidateAdminRequest\('banner-upload'\)/)
})

test('report detail exposes one destructive takedown action', () => {
  const reportDetail = source.slice(
    source.indexOf("<view v-else-if=\"detailKind === 'report' && detailRow\">"),
    source.indexOf("<view v-else-if=\"detailKind === 'suspension' && detailRow\">"),
  )
  assert.equal(
    (reportDetail.match(/@click="onTakedownContent\(detailRow\)"/g) || []).length,
    1,
  )
})

test('report filter races cannot paint an older queue under the latest chip', () => {
  const reports = source.slice(
    source.indexOf('async function loadReports'),
    source.indexOf('\nfunction fmtAuditEvent'),
  )
  assert.match(reports, /request = beginAdminRequest\('reports'\)/)
  assert.match(reports, /const pendingOnly = reportPendingOnly\.value/)
  assert.match(reports, /isAdminRequestCurrent\(request\) \|\| reportPendingOnly\.value !== pendingOnly/)
  assert.match(reports, /const request = beginAdminRequest\('reports', owner\)/)
  assert.match(reports, /if \(isAdminRequestCurrent\(request\)\) loading\.value = false/)
})

test('rapid admin tab changes keep only the latest queue and loading owner', () => {
  const loadTab = source.slice(
    source.indexOf('async function loadTab'),
    source.indexOf('\nfunction fmtAuditEvent'),
  )
  assert.match(loadTab, /beginAdminRequest\('tab-load', owner\)/)
  assert.match(loadTab, /loadPagedAdminTab\(tab, true, tabRequest\)/)
  assert.match(loadTab, /if \(isAdminRequestCurrent\(tabRequest\)\) loading\.value = false/)
  const pagedTab = source.slice(
    source.indexOf('async function loadPagedAdminTab'),
    source.indexOf('\nasync function loadMoreAdminList'),
  )
  assert.match(pagedTab, /apiGet<any\[]>\([\s\S]*?, request\)/)
  assert.match(pagedTab, /if \(!isAdminRequestCurrent\(request\)\) return/)
  assert.match(source, /function isAdminReadOwnerCurrent[\s\S]*?isAdminRequestCurrent\(owner as AdminRequestOwner\)/)
  assert.match(source, /if \(id !== 'reports'\) \{\s+invalidateAdminRequest\('reports'\)/)
})

test('admin request failures expose localized contracts, never raw provider text', () => {
  const errors = source.slice(
    source.indexOf('function showAdminRequestError'),
    source.indexOf('\nfunction canonicalAdminMutation'),
  )
  assert.match(errors, /admin_outcome_unknown[\s\S]*?admin_capability_denied[\s\S]*?admin_mutation_conflict/)
  assert.match(errors, /: fallback/)
  assert.doesNotMatch(errors, /message \|\| fallback/)
})

test('plaza mutations are single-flight and reload authoritative rows before acknowledgement', () => {
  const pin = source.slice(
    source.indexOf('async function togglePin'),
    source.indexOf('\nfunction editBanner'),
  )
  assert.match(pin, /if \(!owner \|\| plazaWriteBusy\.value\) return/)
  assert.match(pin, /const desiredPinned = !p\.is_pinned/)
  assert.match(pin, /pinned: desiredPinned[\s\S]*?await loadPlaza\(owner\)/)
  assert.doesNotMatch(pin, /p\.is_pinned\s*=/)

  const banner = source.slice(
    source.indexOf('async function toggleBannerActive'),
    source.indexOf('\nfunction deleteBanner'),
  )
  assert.match(banner, /if \(!owner \|\| plazaWriteBusy\.value\) return/)
  assert.match(banner, /const desiredActive = !b\.active/)
  assert.match(banner, /active: desiredActive[\s\S]*?await loadPlaza\(owner\)/)
  assert.doesNotMatch(banner, /b\.active\s*=/)
})

test('bulk report settlement always reconciles the authoritative queue', () => {
  const bulk = source.slice(
    source.indexOf("function bulkResolve(status"),
    source.indexOf('\nfunction resolveTargetReports'),
  )
  assert.match(bulk, /apiPostBatch\(groups\.map/)
  assert.match(bulk, /await Promise\.all\(\[loadTab\('reports', owner, true\), loadStats\(owner, true\)\]\)/)
  assert.match(bulk, /const failed = outcomes\.filter/)
  assert.match(bulk, /bulkResolving\.value = false/)
})

test('mobile admin controls meet the local touch and wrapping contract', () => {
  assert.match(source, /@media \(max-width: 600px\)/)
  assert.match(source, /\.bf-sched \{ flex-direction: column; \}/)
  assert.match(source, /\.mini-btn,[\s\S]*?min-height: 44px;/)
  assert.match(source, /\.detail-close \{ width: 44px; height: 44px; \}/)
  assert.match(source, /class="dash-loading" role="status" aria-live="polite"/)
})

test('admin mutation retries retain one idempotency key until a definitive result', () => {
  const post = source.slice(
    source.indexOf('async function apiPost<T>'),
    source.indexOf('\nasync function onUnlock'),
  )
  assert.match(post, /return withAdminIdempotencyRequestLock\(/)
  assert.match(post, /reserveAdminIdempotencyKey\(\s*'mutation',\s*owner\.key,\s*canonicalAdminMutation\(body\)/)
  assert.ok(post.indexOf('const journalHandle = await runAdminJournalStep') < post.indexOf('return withAdminIdempotencyRequestLock'))
  assert.match(post, /'Idempotency-Key': idempotencyKey/)
  assert.match(post, /for \(let attempt = 0; attempt < 2; attempt \+= 1\)/)
  assert.match(post, /if \(attempt === 0\) continue/)
  assert.match(post, /if \(r\.ok\) \{\s+await runAdminJournalStep\(owner, \(\) => releaseAdminIdempotencyKey\(journalHandle\)\)/)
  assert.match(post, /isAdminIdempotencyResolvedOrSuperseded\(journalHandle\)\)\) \{\s+lockAdminAfterReplayedOutcome\(owner\)/)
  assert.match(post, /hasOtherAdminIdempotencyUnacknowledgedOutcome\(journalHandle, allowedBatchReceipts\)[\s\S]*?markAdminIdempotencyDispatchStarted\(journalHandle\)[\s\S]*?platformFetch/)
  assert.match(post, /const replayingUnknown = await runAdminJournalStep\([\s\S]*?markAdminIdempotencyDispatchStarted\(journalHandle\)/)
  assert.match(post, /if \(replayingUnknown\) \{\s+lockAdminAfterReplayedOutcome\(owner\)/)
  assert.match(post, /Keep the durable key so a later unlock\/manual retry/)
  assert.doesNotMatch(source, /pendingAdminMutationKeys/)
})

test('normal 2xx responses are acknowledged only after current UI state is applied', () => {
  const acknowledge = source.slice(
    source.indexOf('async function acknowledgeAdminMutationReceipts'),
    source.indexOf('\nasync function apiPost<T>'),
  )
  assert.ok(acknowledge.indexOf('await applyDefinitiveResults') < acknowledge.indexOf('consumeResolvedAdminIdempotencyKey'))
  assert.match(acknowledge, /await applyDefinitiveResults[\s\S]*?if \(!isAdminSessionOwnerCurrent\(owner, false\)\) throw new AdminSessionChangedError/)
  assert.match(acknowledge, /catch \(err\)[\s\S]*?lockAdminAfterReplayedOutcome\(owner\)/)

  const post = source.slice(
    source.indexOf('async function apiPost<T>'),
    source.indexOf('\nasync function apiPostLocked<T>'),
  )
  assert.match(post, /const receipt = await apiPostLocked[\s\S]*?acknowledgeAdminMutationReceipts\(owner, \[receipt\]/)

  const batch = source.slice(
    source.indexOf('async function apiPostBatch<T>'),
    source.indexOf('\nasync function apiPostLocked<T>'),
  )
  assert.equal((batch.match(/withAdminIdempotencyRequestLock/g) || []).length, 1)
  assert.ok(batch.indexOf('for (const entry of entries)') < batch.indexOf('acknowledgeAdminMutationReceipts'))
  assert.match(batch, /receipts\.map\(previous => previous\.journalHandle\)/)
  assert.ok(batch.indexOf('await applyDefinitiveResults(outcomes)') < batch.indexOf('return outcomes'))
})

test('only exact no-commit errors erase a rejected mutation tombstone', () => {
  const allowlist = source.slice(
    source.indexOf('const DEFINITIVE_ADMIN_NO_COMMIT_ERRORS'),
    source.indexOf('\nasync function acknowledgeAdminMutationReceipts'),
  )
  assert.match(allowlist, /'invalid_image_dimensions'/)
  assert.match(allowlist, /'admin_mutation_conflict'/)
  assert.doesNotMatch(allowlist, /'idempotency_conflict'/)

  const post = source.slice(
    source.indexOf('async function apiPostLocked<T>'),
    source.indexOf('\ntype AdminIdempotencyOutcomeStatus'),
  )
  assert.match(post, /if \(!DEFINITIVE_ADMIN_NO_COMMIT_ERRORS\.has\(errorCode\)\) \{\s+return lockAdminAfterUnknownOutcome\(owner\)/)
  assert.ok(post.indexOf('DEFINITIVE_ADMIN_NO_COMMIT_ERRORS.has(errorCode)') < post.lastIndexOf('releaseAdminIdempotencyKey(journalHandle)'))
})

test('plaza form and row actions are cross-disabled during any plaza write', () => {
  const busy = source.slice(
    source.indexOf('const plazaWriteBusy'),
    source.indexOf('\nconst emptyBannerForm'),
  )
  assert.match(busy, /bannerSaving\.value[\s\S]*?bannerUploading\.value[\s\S]*?pinMutationIds\.value\.length[\s\S]*?bannerMutationIds\.value\.length/)
  for (const name of ['togglePin', 'editBanner', 'onPickBannerImage', 'saveBanner', 'toggleBannerActive', 'deleteBanner']) {
    const start = source.indexOf(`${name.startsWith('toggle') || name === 'saveBanner' ? 'async function' : 'function'} ${name}`)
    assert.notEqual(start, -1, `${name} exists`)
    const end = source.indexOf('\nfunction ', start + 10)
    const asyncEnd = source.indexOf('\nasync function ', start + 10)
    const candidates = [end, asyncEnd].filter(value => value > start)
    const block = source.slice(start, candidates.length ? Math.min(...candidates) : undefined)
    assert.match(block, /plazaWriteBusy\.value/, `${name} must reject overlapping plaza writes`)
  }
  assert.match(source, /plazaWriteBusy \|\| !bannerForm\.image_url/)
})

test('definitive tombstones require explicit acknowledgement and a strict refresh before writes', () => {
  const unlock = source.slice(
    source.indexOf('async function onUnlock'),
    source.indexOf('\nfunction resetAdminPrivateState'),
  )
  const recovery = source.slice(
    source.indexOf('async function finishAdminRecovery'),
    source.indexOf('\nasync function onUnlock'),
  )
  assert.doesNotMatch(unlock, /clearResolvedAdminIdempotencyEntries/)
  assert.match(recovery, /before\.resolvedCount > 0 && !acknowledgeResolved[\s\S]*?strictReloadAdminState\(owner\)[\s\S]*?if \(acknowledgeResolved\) \{[\s\S]*?clearResolvedAdminIdempotencyEntries/)
  assert.ok(recovery.indexOf('await strictReloadAdminState(owner)') < recovery.indexOf('clearResolvedAdminIdempotencyEntries()'))
  assert.match(recovery, /adminWritesReady\.value = true/)
  assert.match(unlock, /adminWritesReady\.value = false[\s\S]*?reconcileAdminOutcomeJournal\(owner\)[\s\S]*?if \(!adminRecoveryVisible\.value\) adminWritesReady\.value = true/)
})

test('outcome recovery is owner-only, comprehensive, and blocks transport before reserve', () => {
  const state = source.slice(
    source.indexOf('const adminWritesReady'),
    source.indexOf('const tokenMutationIds'),
  )
  assert.match(state, /adminRecoveryResolvedCount\.value > 0 \|\| adminRecoveryUnknownCount\.value > 0[\s\S]*?whoami\.value\?\.role !== 'owner'/)

  const acknowledge = source.slice(
    source.indexOf('async function acknowledgeAdminOutcomes'),
    source.indexOf('\nasync function onUnlock'),
  )
  assert.match(acknowledge, /whoami\.value\?\.role !== 'owner'[\s\S]*?finishAdminRecovery\(owner, true\)/)

  const strict = source.slice(
    source.indexOf('async function strictReloadAdminState'),
    source.indexOf('\nasync function finishAdminRecovery'),
  )
  for (const resource of [
    'stats', 'reports_grouped', 'suspensions', 'appeals', 'warnings',
    'audit', 'plaza_posts', 'banners', 'tokens',
  ]) assert.match(strict, new RegExp(`resource: '${resource}'`))

  const post = source.slice(
    source.indexOf('async function apiPost<T>'),
    source.indexOf('\nasync function apiPostLocked<T>'),
  )
  assert.ok(post.indexOf('adminWritesReady.value') < post.indexOf('reserveAdminIdempotencyKey'))
  const upload = source.slice(
    source.indexOf('async function uploadBannerFile('),
    source.indexOf('\nasync function uploadBannerFileLocked'),
  )
  assert.ok(upload.indexOf('adminWritesReady.value') < upload.indexOf('reserveAdminIdempotencyKey'))

  const journalBoundary = source.slice(
    source.indexOf('async function runAdminJournalStep'),
    source.indexOf('\nfunction canonicalAdminMutation'),
  )
  assert.match(journalBoundary, /admin_idempotency_unavailable[\s\S]*?lockAdminAfterUnknownOutcome\(owner\)/)
})

test('banner upload retries retain one file-scoped key and rebuild multipart bodies safely', () => {
  const upload = source.slice(
    source.indexOf('async function uploadBannerFile'),
    source.indexOf('\nasync function loadPlaza'),
  )
  assert.match(upload, /return withAdminIdempotencyRequestLock\(/)
  assert.match(upload, /reserveAdminIdempotencyKey\(\s*'banner-upload',\s*request\.key,\s*await file\.arrayBuffer\(\)/)
  assert.ok(upload.indexOf('const journalHandle = await runAdminJournalStep') < upload.indexOf('return withAdminIdempotencyRequestLock'))
  assert.match(upload, /for \(let attempt = 0; attempt < 2; attempt \+= 1\)/)
  assert.match(upload, /const fd = new FormData\(\)/)
  assert.match(upload, /'Idempotency-Key': idempotencyKey/)
  assert.match(upload, /if \(response\.status >= 500\)/)
  assert.doesNotMatch(upload, /throw new Error\('admin_outcome_unknown'\)/)
  assert.match(upload, /isAdminIdempotencyResolvedOrSuperseded\(journalHandle\)\)\) \{\s+lockAdminAfterReplayedOutcome\(request\)/)
  assert.match(upload, /hasOtherAdminIdempotencyUnacknowledgedOutcome\(journalHandle\)[\s\S]*?markAdminIdempotencyDispatchStarted\(journalHandle\)[\s\S]*?platformFetch/)
  assert.match(upload, /const replayingUnknown = await runAdminJournalStep\([\s\S]*?markAdminIdempotencyDispatchStarted\(journalHandle\)/)
  assert.match(upload, /if \(replayingUnknown\) \{\s+lockAdminAfterReplayedOutcome\(request\)/)
  assert.doesNotMatch(upload, /Promise\.allSettled/)
  assert.doesNotMatch(source, /pendingBannerUploadKeys/)
})

test('a released upload from an old admin session cannot repopulate the current banner form', () => {
  const picker = source.slice(
    source.indexOf('function onPickBannerImage'),
    source.indexOf('\nasync function saveBanner'),
  )
  assert.match(picker, /await uploadBannerFile\(file, request, \(uploadedUrl\) => \{[\s\S]*?if \(!isAdminRequestCurrent\(request\)\) throw new AdminSessionChangedError\(\)[\s\S]*?bannerForm\.value\.image_url = uploadedUrl/)
  assert.doesNotMatch(picker, /bannerForm\.value\.image_url = await uploadBannerFile/)
})

test('later rejections cannot erase a key after an earlier admin dispatch became unknown', () => {
  const upload = source.slice(
    source.indexOf('async function uploadBannerFileLocked'),
    source.indexOf('\nasync function loadPlaza'),
  )
  const post = source.slice(
    source.indexOf('async function apiPostLocked<T>'),
    source.indexOf('\nasync function onUnlock'),
  )
  for (const operation of [upload, post]) {
    assert.match(operation, /let sawOutcomeUnknown = replayingUnknown/)
    assert.equal((operation.match(/sawOutcomeUnknown = true/g) || []).length >= 3, true)
    assert.match(operation, /status === 401\) \{\s+if \(sawOutcomeUnknown\) return lockAdminAfterUnknownOutcome/)
    assert.match(operation, /if \(sawOutcomeUnknown\) return lockAdminAfterUnknownOutcome\([^)]+\)\s+await runAdminJournalStep\([^)]+, \(\) => releaseAdminIdempotencyKey/)
  }
  const stickyLock = source.slice(
    source.indexOf('function lockAdminAfterUnknownOutcome'),
    source.indexOf('\nfunction canonicalAdminMutation'),
  )
  assert.match(stickyLock, /onLogout\(owner\)/)
  assert.match(stickyLock, /\): never \{/)
  assert.match(stickyLock, /throw new AdminSessionChangedError\(\)/)
  assert.doesNotMatch(stickyLock, /releaseAdminIdempotencyKey|consumeResolvedAdminIdempotencyKey/)
})

test('role-aware dashboard hides unauthorized domains and exposes token recovery controls', () => {
  assert.match(source, /type AdminRole = 'operator' \| 'security_admin' \| 'owner'/)
  assert.match(source, /const canReadModeration = computed[\s\S]*?'operator'[\s\S]*?'owner'/)
  assert.match(source, /const canReadPlaza = computed\(\(\) => whoami\.value\?\.role === 'owner'\)/)
  assert.match(source, /const canReadTokens = computed[\s\S]*?'security_admin'[\s\S]*?'owner'/)
  assert.match(source, /id: 'tokens'[\s\S]*?domain: 'tokens'/)
  assert.match(source, /v-else-if="activeTab === 'tokens'"/)
  assert.match(source, /action: 'revoke_token'[\s\S]*?token_id: token\.id[\s\S]*?case_id: caseId[\s\S]*?approval_ref: approvalRef/)
  assert.match(source, /tokenStatus\(token\) !== 'revoked'/)
  assert.match(source, /isSafeAuditEvidence\(caseId\)[\s\S]*?isSafeAuditEvidence\(approvalRef\)/)
  assert.match(source, /message === 'admin_capability_denied' \? t\('admin\.errCapabilityDenied'\)/)
  assert.match(source, /ownerRecovery\.status === 'critical' \? 'alert' : 'status'/)
  assert.match(source, /admin\.ownerRecoveryCount/)
  assert.match(source, /admin\.ownerNearestExpiry/)
  assert.match(source, /owner-recovery-critical/)
})

test('banner date pickers expose names and keyboard activation on H5', () => {
  const pickerMarkup = source.slice(
    source.indexOf('<view class="bf-sched">'),
    source.indexOf('<view\n            class="bf-default-row"'),
  )
  assert.equal((pickerMarkup.match(/role="button"/g) || []).length >= 2, true)
  assert.equal((pickerMarkup.match(/tabindex="0"/g) || []).length >= 2, true)
  assert.match(pickerMarkup, /:aria-label="t\('admin\.bannerStartLabel'\)"/)
  assert.match(pickerMarkup, /:aria-label="t\('admin\.bannerEndLabel'\)"/)
  assert.equal((pickerMarkup.match(/@keydown="onBannerPickerKeydown"/g) || []).length, 2)
  assert.match(source, /function onBannerPickerKeydown[\s\S]*?event\.key !== 'Enter'[\s\S]*?event\.key !== ' '[\s\S]*?\.click\(\)/)
})
