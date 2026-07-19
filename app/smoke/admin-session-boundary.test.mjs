import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const appRoot = new URL('../', import.meta.url)

function deferred() {
  let resolve
  const promise = new Promise(resolvePromise => { resolve = resolvePromise })
  return { promise, resolve }
}

function createAdminSessionModel() {
  let epoch = 0
  let key = ''
  let unlocked = false
  const privateState = { audit: [], detail: null, banners: [] }

  const capture = (requireUnlocked = true) => {
    if (!key || (requireUnlocked && !unlocked)) return null
    return { epoch, key }
  }
  const current = (owner, requireUnlocked = true) => !!owner
    && owner.epoch === epoch
    && owner.key === key
    && (!requireUnlocked || unlocked)
  const login = nextKey => {
    epoch += 1
    key = nextKey
    unlocked = true
    privateState.audit = []
    privateState.detail = null
    privateState.banners = []
  }
  const logout = () => {
    epoch += 1
    key = ''
    unlocked = false
    privateState.audit = []
    privateState.detail = null
    privateState.banners = []
  }

  return { capture, current, login, logout, privateState }
}

test('a dialog opened by admin A cannot mutate after logout and admin B login', () => {
  const session = createAdminSessionModel()
  session.login('admin-a')
  session.privateState.banners = ['a-banner']
  const dialogOwner = session.capture()

  session.logout()
  assert.deepEqual(session.privateState, { audit: [], detail: null, banners: [] })
  session.login('admin-b')

  let mutationSent = false
  if (session.current(dialogOwner)) mutationSent = true
  assert.equal(mutationSent, false)
})

test('a late admin A response cannot replace admin B private state', async () => {
  const session = createAdminSessionModel()
  session.login('admin-a')
  const ownerA = session.capture()
  const pendingA = deferred()
  const applyA = pendingA.promise.then(rows => {
    if (session.current(ownerA)) session.privateState.audit = rows
  })

  session.logout()
  session.login('admin-b')
  const ownerB = session.capture()
  assert.equal(session.current(ownerB), true)
  session.privateState.audit = ['b-event']

  pendingA.resolve(['late-a-event'])
  await applyA
  assert.deepEqual(session.privateState.audit, ['b-event'])
})

test('admin transport and destructive dialogs are bound to their captured session owner', async () => {
  const admin = await readFile(new URL('src/pages/admin/index.vue', appRoot), 'utf8')

  assert.match(admin, /let adminSessionEpoch = 0/)
  assert.match(admin, /headers: \{ Authorization: `Bearer \$\{owner\.key\}` \}/)
  assert.match(admin, /Authorization: `Bearer \$\{owner\.key\}`/)
  assert.doesNotMatch(admin, /x-admin-key/i)
  assert.match(admin, /if \(!isAdminSessionOwnerCurrent\(owner, false\)\) throw new AdminSessionChangedError\(\)/)
  assert.match(admin, /function onLogout\(expectedOwner\?: AdminSessionOwner\): boolean/)
  assert.match(admin, /auditLog\.value = \[\]/)
  assert.match(admin, /detailRow\.value = null/)
  assert.match(admin, /bannerUploading\.value = false/)

  for (const functionName of [
    'deleteBanner',
    'bulkResolve',
    'resolveTargetReports',
    'onTakedownContent',
    'onLiftSuspension',
    'onBanPrompt',
  ]) {
    const start = admin.indexOf(`function ${functionName}`)
    assert.notEqual(start, -1, `${functionName} exists`)
    const nextFunction = admin.indexOf('\nfunction ', start + 10)
    const block = admin.slice(start, nextFunction === -1 ? undefined : nextFunction)
    assert.match(block, /const owner = captureAdminSessionOwner\(\)/, `${functionName} captures its owner`)
    assert.match(block, /isAdminSessionOwnerCurrent\(owner\)/, `${functionName} rejects a stale callback`)
  }

  const uploadStart = admin.indexOf('function onPickBannerImage')
  const uploadEnd = admin.indexOf('\nasync function saveBanner', uploadStart)
  const upload = admin.slice(uploadStart, uploadEnd)
  const transportStart = admin.indexOf('async function uploadBannerFile')
  const transportEnd = admin.indexOf('\nasync function loadPlaza', transportStart)
  const uploadTransport = admin.slice(transportStart, transportEnd)
  assert.match(upload, /const owner = captureAdminSessionOwner\(\)/)
  assert.match(upload, /const request = beginAdminRequest\('banner-upload', owner\)/)
  assert.match(upload, /if \(!file \|\| !isAdminSessionOwnerCurrent\(owner\)\) return/)
  assert.match(uploadTransport, /Authorization: `Bearer \$\{request\.key\}`/)
  assert.match(uploadTransport, /'Idempotency-Key': idempotencyKey/)
  assert.match(uploadTransport, /if \(!isAdminRequestCurrent\(request\)\) throw new AdminSessionChangedError\(\)/)
})

test('admin token revocation requires accessible audit evidence bound to the opening session', async () => {
  const admin = await readFile(new URL('src/pages/admin/index.vue', appRoot), 'utf8')
  const openStart = admin.indexOf('function openTokenRevoke')
  const confirmStart = admin.indexOf('async function confirmTokenRevoke')
  const confirmEnd = admin.indexOf('\nasync function togglePin', confirmStart)
  const open = admin.slice(openStart, confirmStart)
  const confirm = admin.slice(confirmStart, confirmEnd)

  assert.match(admin, /<label class="token-revoke-field">[^]*?admin\.revokeCaseLabel[^]*?<\/label>/)
  assert.match(admin, /<label class="token-revoke-field">[^]*?admin\.revokeApprovalLabel[^]*?<\/label>/)
  assert.match(admin, /class="token-identifiers"[^]*?admin\.tokenId[^]*?selectable[^]*?token\.id[^]*?admin\.tokenAdminId[^]*?token\.admin_id/)
  assert.match(admin, /class="token-revoke-target"[^]*?admin\.revokeTargetTitle[^]*?admin\.tokenId[^]*?token\.id[^]*?admin\.tokenAdminId[^]*?token\.admin_id/)
  assert.match(admin, /v-if="tokenRevokeErrorVisible"[^]*?role="alert"/)
  assert.match(open, /const owner = captureAdminSessionOwner\(\)/)
  assert.match(open, /tokenRevokeOwner = owner/)
  assert.match(confirm, /isAdminSessionOwnerCurrent\(owner\)/)
  assert.match(confirm, /isSafeAuditEvidence\(caseId\)/)
  assert.match(confirm, /isSafeAuditEvidence\(approvalRef\)/)
  assert.match(confirm, /action: 'revoke_token'[^]*?token_id: token\.id[^]*?case_id: caseId[^]*?approval_ref: approvalRef/)
  assert.match(admin, /tokenRevokeOwner = null/)
  assert.doesNotMatch(admin, /apiPost\(\{ action: 'revoke_token', token_id: token\.id \}, owner\)/)
})

test('admin unlock removes the submitted secret and presents only localized errors', async () => {
  const admin = await readFile(new URL('src/pages/admin/index.vue', appRoot), 'utf8')
  const unlockStart = admin.indexOf('async function onUnlock()')
  const unlockEnd = admin.indexOf('\nasync function loadWhoAmI', unlockStart)
  const unlock = admin.slice(unlockStart, unlockEnd)

  assert.match(admin, /v-if="gateError" class="gate-error" role="alert"/)
  const gateInput = admin.slice(admin.indexOf('v-model="keyInput"'), admin.indexOf('/>', admin.indexOf('v-model="keyInput"')))
  assert.match(gateInput, /autocomplete="off"/)
  assert.match(gateInput, /autocapitalize="none"/)
  assert.match(gateInput, /autocorrect="off"/)
  assert.match(gateInput, /spellcheck="false"/)
  assert.match(unlock, /adminKey\.value = candidate\s*\/\/[^]*?keyInput\.value = ''\s*unlocked\.value = false/)
  assert.match(unlock, /err\?\.message === 'unauthorized'\s*\? t\('admin\.errWrongKey'\)\s*: t\('admin\.errUnlockFailed'\)/)
  assert.doesNotMatch(unlock, /err\?\.message \|\| t\('admin\.errUnlockFailed'\)/)
})

test('leaving or backgrounding the admin page always locks the in-memory session', async () => {
  const admin = await readFile(new URL('src/pages/admin/index.vue', appRoot), 'utf8')

  assert.match(admin, /function lockAdminSessionOnLeave\(\) \{\s*if \(unlocked\.value \|\| adminKey\.value\) onLogout\(\)/)
  assert.match(admin, /onHide\(lockAdminSessionOnLeave\)/)
  assert.match(admin, /onUnload\(lockAdminSessionOnLeave\)/)
  assert.match(admin, /document\.visibilityState === 'hidden'[^]*?lockAdminSessionOnLeave\(\)/)
  assert.match(admin, /document\.addEventListener\('visibilitychange', onAdminVisibilityChange\)/)
  assert.match(admin, /document\.removeEventListener\('visibilitychange', onAdminVisibilityChange\)/)
  assert.match(admin, /onUnmounted\(\(\) => \{[^]*?lockAdminSessionOnLeave\(\)/)
})

test('chat keyboard diagnostics require both a DEV build and the explicit debug query', async () => {
  const chat = await readFile(new URL('src/pages/chat/index.vue', appRoot), 'utf8')

  assert.match(chat, /dbg = import\.meta\.env\.DEV && new URL\(window\.location\.href\)\.searchParams\.has\('kbdebug'\)/)
  assert.doesNotMatch(chat, /import\.meta\.env\.DEV\s*\|\|[^\n]*kbdebug/)
})

test('settings cache confirmation expires on an account transition', async () => {
  const settings = await readFile(new URL('src/pages/settings/index.vue', appRoot), 'utf8')
  const start = settings.indexOf('function clearCache')
  const end = settings.indexOf('\nasync function onChangePassword', start)
  const block = settings.slice(start, end)
  assert.match(block, /const actionEpoch = settingsAccountEpoch/)
  assert.match(block, /if \(!res\.confirm \|\| actionEpoch !== settingsAccountEpoch\) return/)
})
