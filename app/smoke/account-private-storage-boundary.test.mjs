import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let boundaryLoadId = 0

async function loadBoundary() {
  const source = readFileSync(resolve(appRoot, 'src/api/accountLocalPrivacy.ts'), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText
  boundaryLoadId += 1
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}#${boundaryLoadId}`)
}

function memoryStorage(initial = []) {
  const values = new Map(initial)
  return {
    values,
    storage: {
      getStorageSync: key => values.get(key) ?? '',
      setStorageSync: (key, value) => { values.set(key, value) },
      removeStorageSync: key => { values.delete(key) },
    },
  }
}

test('anonymous local work is adopted once, then never crosses A -> B', async () => {
  const boundary = await loadBoundary()
  const { values, storage } = memoryStorage([
    ['publish_draft_v1', { title: 'anonymous draft' }],
    ['searchHistory', '["private query"]'],
  ])

  const adopt = boundary.reconcileAccountPrivateStorage('account-a', null, storage)
  assert.equal(adopt.cleanupAttempted, false)
  assert.deepEqual(values.get('publish_draft_v1'), { title: 'anonymous draft' })
  assert.equal(values.get(boundary.ACCOUNT_PRIVATE_STORAGE_OWNER_KEY), 'account-a')

  const switchAccount = boundary.reconcileAccountPrivateStorage('account-b', 'account-a', storage)
  assert.equal(switchAccount.cleanupAttempted, true)
  assert.deepEqual(switchAccount.unresolvedKeys, [])
  for (const key of boundary.ACCOUNT_PRIVATE_STORAGE_KEYS) assert.equal(values.has(key), false)
  assert.equal(values.get(boundary.ACCOUNT_PRIVATE_STORAGE_OWNER_KEY), 'account-b')
})

test('durable owner marker handles cold-start same-account, different-account, and anonymous boundaries', async () => {
  const boundary = await loadBoundary()
  const ownerKey = boundary.ACCOUNT_PRIVATE_STORAGE_OWNER_KEY

  const same = memoryStorage([[ownerKey, 'account-a'], ['viewHistory', 'A history']])
  assert.equal(boundary.reconcileAccountPrivateStorage('account-a', null, same.storage).cleanupAttempted, false)
  assert.equal(same.values.get('viewHistory'), 'A history')

  const different = memoryStorage([[ownerKey, 'account-a'], ['viewHistory', 'A history']])
  assert.equal(boundary.reconcileAccountPrivateStorage('account-b', null, different.storage).cleanupAttempted, true)
  assert.equal(different.values.has('viewHistory'), false)
  assert.equal(different.values.get(ownerKey), 'account-b')

  const anonymous = memoryStorage([[ownerKey, 'account-a'], ['viewHistory', 'A history']])
  assert.equal(boundary.reconcileAccountPrivateStorage(null, null, anonymous.storage).cleanupAttempted, true)
  assert.equal(anonymous.values.has('viewHistory'), false)
  assert.equal(anonymous.values.has(ownerKey), false)
})

test('owner-gated reads preserve same-owner reloads and fail closed before auth or after A -> B', async () => {
  const boundary = await loadBoundary()
  const ownerKey = boundary.ACCOUNT_PRIVATE_STORAGE_OWNER_KEY
  const same = memoryStorage([
    [ownerKey, 'account-a'],
    ['publish_draft_v1', { form: { title: 'A draft' }, images: [], savedAt: 1 }],
  ])

  const cold = boundary.readAccountPrivateStorage('publish_draft_v1', null, same.storage)
  assert.equal(cold.allowed, false, 'an owned draft must stay hidden while auth is unresolved')
  assert.equal(cold.value, null)
  assert.equal(boundary.writeAccountPrivateStorage('searchHistory', '["blocked"]', same.storage), false)

  const reconciled = boundary.reconcileAccountPrivateStorage('account-a', null, same.storage)
  assert.equal(reconciled.cleanupAttempted, false)
  const restored = boundary.readAccountPrivateStorage('publish_draft_v1', null, same.storage)
  assert.equal(restored.allowed, true)
  assert.equal(restored.value.form.title, 'A draft', 'same-owner reload must retain the draft')

  boundary.reconcileAccountPrivateStorage('account-b', 'account-a', same.storage)
  const afterSwitch = boundary.readAccountPrivateStorage('publish_draft_v1', null, same.storage)
  assert.equal(afterSwitch.allowed, true)
  assert.equal(afterSwitch.value, null, 'B sees an empty lineage, never A residue')
  assert.equal(boundary.writeAccountPrivateStorage('searchHistory', '["B query"]', same.storage), true)
  assert.equal(same.values.get('searchHistory'), '["B query"]')

  same.values.set(ownerKey, 'account-a')
  const mismatched = boundary.readAccountPrivateStorage('searchHistory', '[]', same.storage)
  assert.equal(mismatched.allowed, false)
  assert.equal(mismatched.value, '[]', 'a mismatched durable marker is always fail-closed')
})

test('unowned anonymous data is usable and adopted by the first login', async () => {
  const boundary = await loadBoundary()
  const local = memoryStorage([['searchHistory', '["anonymous query"]']])

  const anonymous = boundary.readAccountPrivateStorage('searchHistory', '[]', local.storage)
  assert.equal(anonymous.allowed, true)
  assert.equal(anonymous.value, '["anonymous query"]')

  const adopted = boundary.reconcileAccountPrivateStorage('account-a', null, local.storage)
  assert.equal(adopted.cleanupAttempted, false)
  assert.equal(local.values.get(boundary.ACCOUNT_PRIVATE_STORAGE_OWNER_KEY), 'account-a')
  assert.equal(boundary.readAccountPrivateStorage('searchHistory', '[]', local.storage).value, '["anonymous query"]')
})

test('failed remove overwrites empty, while unverifiable residue keeps a retry sentinel', async () => {
  const boundary = await loadBoundary()
  const ownerKey = boundary.ACCOUNT_PRIVATE_STORAGE_OWNER_KEY
  const fallback = memoryStorage([[ownerKey, 'account-a'], ['searchHistory', 'secret']])
  fallback.storage.removeStorageSync = key => {
    if (key === 'searchHistory') throw new Error('remove unavailable')
    fallback.values.delete(key)
  }
  const recovered = boundary.reconcileAccountPrivateStorage('account-b', 'account-a', fallback.storage)
  assert.deepEqual(recovered.unresolvedKeys, [])
  assert.equal(fallback.values.get('searchHistory'), '')
  assert.equal(fallback.values.get(ownerKey), 'account-b')

  const blocked = memoryStorage([[ownerKey, 'account-a'], ['searchHistory', 'secret']])
  blocked.storage.removeStorageSync = key => {
    if (key === 'searchHistory') throw new Error('remove unavailable')
    blocked.values.delete(key)
  }
  blocked.storage.setStorageSync = (key, value) => {
    if (key === 'searchHistory') throw new Error('write unavailable')
    blocked.values.set(key, value)
  }
  const unresolved = boundary.reconcileAccountPrivateStorage('account-b', 'account-a', blocked.storage)
  assert.deepEqual(unresolved.unresolvedKeys, ['searchHistory'])
  assert.equal(blocked.values.get(ownerKey), 'privacy_cleanup_required')
  const hidden = boundary.readAccountPrivateStorage('searchHistory', '[]', blocked.storage)
  assert.equal(hidden.allowed, false)
  assert.equal(hidden.value, '[]', 'unerasable A residue must never reach B readers')
  assert.equal(boundary.writeAccountPrivateStorage('searchHistory', '["B"]', blocked.storage), false)
})

test('loaded private module state resets synchronously at the ownership boundary', async () => {
  const boundary = await loadBoundary()
  const { storage } = memoryStorage([
    [boundary.ACCOUNT_PRIVATE_STORAGE_OWNER_KEY, 'account-a'],
    ['viewHistory', 'A history'],
  ])
  const calls = []
  const unregister = boundary.registerAccountPrivateStateReset(() => calls.push('reset'))

  const result = boundary.reconcileAccountPrivateStorage('account-b', 'account-a', storage)
  assert.equal(result.cleanupAttempted, true)
  assert.deepEqual(calls, ['reset'])

  unregister()
  boundary.reconcileAccountPrivateStorage('account-c', 'account-b', storage)
  assert.deepEqual(calls, ['reset'])
})

test('loaded modules rehydrate only after the durable owner is verified', async () => {
  const boundary = await loadBoundary()
  const { storage } = memoryStorage([
    [boundary.ACCOUNT_PRIVATE_STORAGE_OWNER_KEY, 'account-a'],
    ['viewHistory', '[{"id":"same-owner"}]'],
  ])
  const events = []
  boundary.registerAccountPrivateStateReset(() => events.push('reset'))
  boundary.registerAccountPrivateStateHydrate(() => {
    const stored = boundary.readAccountPrivateStorage('viewHistory', '[]', storage)
    events.push(stored.allowed ? stored.value : 'blocked')
  })

  boundary.reconcileAccountPrivateStorage('account-a', null, storage)
  assert.deepEqual(events, ['reset', '[{"id":"same-owner"}]'])
})

test('every private storage consumer uses the owner-gated access layer', () => {
  const files = [
    'src/components/ChatEmojiPanel.vue',
    'src/composables/useHistory.ts',
    'src/composables/useTranslate.ts',
    'src/composables/useWechatSecCheck.ts',
    'src/pages/index/index.vue',
    'src/pages/profile/index.vue',
    'src/pages/publish/index.vue',
    'src/pages/search/index.vue',
    'src/pages/settings/index.vue',
  ]
  const privateKeys = [
    'viewHistory', 'postViewHistory', 'searchHistory', 'publish_draft_v1',
    'pending_search', 'pending_category', 'chat_emoji_recent',
    'translate_cache_v2', 'translate_cache_v1', 'wechat_seccheck_openid',
  ]

  for (const file of files) {
    const source = readFileSync(resolve(appRoot, file), 'utf8')
    for (const key of privateKeys) {
      const direct = new RegExp(`uni\\.(?:get|set|remove)StorageSync\\([^\\n]*['\"]${key}['\"]`)
      assert.doesNotMatch(source, direct, `${file} must not bypass the private-storage owner gate for ${key}`)
    }
  }

  const emoji = readFileSync(resolve(appRoot, 'src/components/ChatEmojiPanel.vue'), 'utf8')
  assert.match(emoji, /readAccountPrivateStorage<unknown>\(RECENT_KEY, \[\]\)/)
  assert.match(emoji, /writeAccountPrivateStorage\(RECENT_KEY/)
})

test('auth reconciles private storage at session and explicit sign-out boundaries', () => {
  const source = readFileSync(resolve(appRoot, 'src/composables/useAuth.ts'), 'utf8')
  assert.match(source, /transitionAccount\(userId\)[\s\S]*?reconcileLocalPrivacy\(userId, previousUserId\)/)
  assert.match(source, /transitionAccount\([\s\S]*?null,[\s\S]*?options\.[\s\S]*?reconcileLocalPrivacy\(null, previousUserId\)/)
  assert.match(source, /transitionAccount\(null, true\)[\s\S]*?reconcileLocalPrivacy\(null, previousUserId\)/)

  const reconcileStart = source.indexOf('function reconcileLocalPrivacy(')
  const applySessionStart = source.indexOf('async function applySession(', reconcileStart)
  assert.ok(reconcileStart >= 0 && applySessionStart > reconcileStart)
  const reconcileBlock = source.slice(reconcileStart, applySessionStart)
  assert.doesNotMatch(reconcileBlock, /await import\(/)
  assert.match(reconcileBlock, /reconcileAccountPrivateStorage\(nextUserId, previousUserId\)/)

  const historySource = readFileSync(resolve(appRoot, 'src/composables/useHistory.ts'), 'utf8')
  const translateSource = readFileSync(resolve(appRoot, 'src/composables/useTranslate.ts'), 'utf8')
  assert.match(historySource, /registerAccountPrivateStateReset\(resetHistoryMemory\)/)
  assert.match(historySource, /registerAccountPrivateStateHydrate\(hydrateHistoryMemory\)/)
  assert.match(translateSource, /registerAccountPrivateStateReset\(resetTranslationMemory\)/)
  assert.match(translateSource, /registerAccountPrivateStateHydrate\(loadDisk\)/)
})
