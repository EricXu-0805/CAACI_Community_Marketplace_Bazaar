import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let moduleSequence = 0

async function loadTsModule(relativePath, runtime = {}) {
  const runtimeKey = `__conversation_pagination_${++moduleSequence}`
  globalThis[runtimeKey] = runtime
  let input = await readFile(resolve(APP_ROOT, relativePath), 'utf8')
  input = input.replace(
    /^import[\s\S]*?\sfrom\s['"][^'"]+['"]\s*$/gm,
    '',
  )
  const importedNames = Object.keys(runtime)
  if (importedNames.length > 0) {
    input = `const { ${importedNames.join(', ')} } = globalThis.${runtimeKey};
${input}`
  }
  const compiled = ts.transpileModule(input, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText
  try {
    return await import(
      `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}#${moduleSequence}`
    )
  } finally {
    delete globalThis[runtimeKey]
  }
}

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function makeAscendingQuery(rows, {
  key = 'id',
  serverMax = 500,
  mapRow = row => row,
  onPage = () => {},
  firstPageGate = null,
} = {}) {
  const state = {
    after: null,
    requested: Number.MAX_SAFE_INTEGER,
    childLimit: null,
    orders: [],
  }
  let readStarted = false
  const query = {
    select() { return query },
    eq() { return query },
    neq() { return query },
    or() { return query },
    in() { return query },
    gt(column, value) {
      assert.equal(column, key)
      state.after = value
      return query
    },
    order(column, options) {
      state.orders.push([column, options])
      return query
    },
    limit(value, options) {
      if (options?.referencedTable) {
        state.childLimit = { value, options }
      } else {
        state.requested = value
      }
      return query
    },
    then(resolve, reject) {
      const run = async () => {
        if (!readStarted && firstPageGate) {
          readStarted = true
          await firstPageGate.promise
        }
        const page = rows
          .filter(row => state.after === null || row[key] > state.after)
          .slice(0, Math.min(state.requested, serverMax))
          .map(mapRow)
        onPage({ ...state, length: page.length })
        return { data: page, error: null }
      }
      return run().then(resolve, reject)
    },
  }
  return query
}

const ids = (count, prefix = 'row') => Array.from(
  { length: count },
  (_, index) => `${prefix}-${String(index + 1).padStart(5, '0')}`,
)

test('ascending keyset reader drains 501 rows through a server clamp smaller than its request', async () => {
  const { readAllAscendingKeyset } = await loadTsModule('src/api/paginatedRead.ts')
  const source = ids(501)
  const pageLengths = []
  const rows = await readAllAscendingKeyset({
    isOwnerCurrent: () => true,
    keyOf: row => row.id,
    fetchPage: (afterKey, requestedRows) => makeAscendingQuery(
      source.map(id => ({ id })),
      {
        serverMax: 137,
        onPage: page => pageLengths.push(page.length),
      },
    ).gt('id', afterKey || '').limit(requestedRows),
  })

  assert.deepEqual(rows.map(row => row.id), source)
  assert.deepEqual(pageLengths, [137, 137, 137, 90, 0])
})

test('ascending keyset reader fails closed on malformed or non-progressing keys', async () => {
  const { readAllAscendingKeyset } = await loadTsModule('src/api/paginatedRead.ts')
  await assert.rejects(
    readAllAscendingKeyset({
      isOwnerCurrent: () => true,
      keyOf: row => row.id,
      fetchPage: async () => ({
        data: [{ id: 'same' }, { id: 'same' }],
        error: null,
      }),
    }),
    /paginated_read_non_progress/,
  )
  await assert.rejects(
    readAllAscendingKeyset({
      isOwnerCurrent: () => true,
      keyOf: row => row.id,
      fetchPage: async () => ({ data: [{ id: null }], error: null }),
    }),
    /paginated_read_invalid_key/,
  )
})

test('archive pagination returns the 1001st archive and aborts after an account switch', async () => {
  const pagination = await loadTsModule('src/api/paginatedRead.ts')
  const archiveModule = await loadTsModule('src/api/conversationArchive.ts', pagination)
  const archiveRows = ids(1001, 'archive').map(conversation_id => ({ conversation_id }))
  const pageLengths = []
  const supabase = {
    from(table) {
      assert.equal(table, 'conversation_archives')
      return makeAscendingQuery(archiveRows, {
        key: 'conversation_id',
        serverMax: 500,
        onPage: page => pageLengths.push(page.length),
      })
    },
  }

  const archived = await archiveModule.fetchArchivedConversationIds(supabase, 'user-a')
  assert.equal(archived.size, 1001)
  assert.equal(archived.has('archive-01001'), true)
  assert.deepEqual(pageLengths, [500, 500, 1, 0])

  let ownerCurrent = true
  let switchedPageCount = 0
  const gate = deferred()
  const switchingSupabase = {
    from() {
      return makeAscendingQuery(archiveRows, {
        key: 'conversation_id',
        firstPageGate: gate,
        onPage: () => { switchedPageCount += 1 },
      })
    },
  }
  const pending = archiveModule.fetchArchivedConversationIds(
    switchingSupabase,
    'user-a',
    { isOwnerCurrent: () => ownerCurrent },
  )
  ownerCurrent = false
  gate.resolve()
  assert.equal(await pending, null)
  assert.equal(switchedPageCount, 1)
})

function unreadRuntime(supabase, pagination, accountState = { current: true }) {
  const userId = 'user-a'
  return {
    ref: value => ({ value }),
    watch: () => () => {},
    useSupabase: () => ({ supabase }),
    useAuth: () => ({ currentUser: { value: { id: userId } } }),
    useI18n: () => ({ t: key => key }),
    useModeration: () => ({
      blockedIds: { value: new Set() },
      ensureLoaded: async () => ({ ok: true }),
    }),
    subscribeToUserInbox: () => () => {},
    useMessages: () => ({ fetchConversations: async () => true }),
    captureAccountRequest: requestedUserId => ({ userId: requestedUserId }),
    getActiveAccountId: () => userId,
    isAccountRequestCurrent: token => accountState.current && token?.userId === userId,
    onAccountTransition: () => () => {},
    fetchArchivedConversationIds: async (_client, _uid, options) => (
      options?.isOwnerCurrent?.() === false ? null : new Set()
    ),
    ...pagination,
  }
}

test('useUnread keeps the per-parent witness and finds the only unread conversation on row 501', async () => {
  const pagination = await loadTsModule('src/api/paginatedRead.ts')
  const userId = 'user-a'
  const conversations = ids(501, 'conversation').map((id, index) => ({
    id,
    buyer_id: userId,
    seller_id: `seller-${index}`,
    is_muted_buyer: false,
    is_muted_seller: false,
    unread_messages: index === 500 ? [{ id: 'only-unread' }] : [],
  }))
  const pageEvidence = []
  const supabase = {
    from(table) {
      assert.equal(table, 'conversations')
      return makeAscendingQuery(conversations, {
        serverMax: 500,
        onPage: page => pageEvidence.push(page),
      })
    },
  }
  const module = await loadTsModule(
    'src/composables/useUnread.ts',
    unreadRuntime(supabase, pagination),
  )

  const unread = module.useUnread()
  const result = await unread.refreshUnreadCount()

  assert.equal(result.reconciled, true)
  assert.equal(unread.unreadCount.value, 1)
  assert.deepEqual([...unread.unreadConvIds.value], ['conversation-00501'])
  assert.deepEqual(pageEvidence.map(page => page.length), [500, 1, 0])
  assert.ok(pageEvidence.every(page => (
    page.childLimit?.value === 1
    && page.childLimit?.options?.referencedTable === 'unread_messages'
  )))
  assert.ok(pageEvidence.every(page => (
    page.orders.some(([column, options]) => (
      column === 'id' && options?.ascending === true
    ))
  )))
})

test('useUnread stops a paged snapshot after an account switch and applies no partial badge', async () => {
  const pagination = await loadTsModule('src/api/paginatedRead.ts')
  const accountState = { current: true }
  const gate = deferred()
  let pageCount = 0
  const conversations = ids(1001, 'conversation').map(id => ({
    id,
    buyer_id: 'user-a',
    seller_id: 'seller',
    is_muted_buyer: false,
    is_muted_seller: false,
    unread_messages: [{ id: `unread-${id}` }],
  }))
  const supabase = {
    from() {
      return makeAscendingQuery(conversations, {
        firstPageGate: gate,
        onPage: () => { pageCount += 1 },
      })
    },
  }
  const module = await loadTsModule(
    'src/composables/useUnread.ts',
    unreadRuntime(supabase, pagination, accountState),
  )
  const unread = module.useUnread()
  const pending = unread.refreshUnreadCount()
  accountState.current = false
  gate.resolve()
  const result = await pending

  assert.equal(result.reconciled, false)
  assert.equal(unread.unreadCount.value, 0)
  assert.deepEqual([...unread.unreadConvIds.value], [])
  assert.equal(pageCount, 1)
})

function messageRuntime(supabase, pagination, overrides = {}) {
  return {
    ref: value => ({ value }),
    useSupabase: () => ({ supabase }),
    useModeration: () => ({
      blockedIds: { value: new Set() },
      ensureLoaded: async () => ({ ok: true }),
    }),
    useI18n: () => ({ t: key => key, lang: { value: 'en' } }),
    subscribeToConversationFallback: () => () => {},
    MESSAGE_FIELDS: 'id, conversation_id, sender_id, content, message_type, is_read, created_at',
    friendlyErrorMessage: () => 'load failed',
    checkContent: () => ({ ok: true }),
    isLocalDuplicate: () => false,
    clearLocalDuplicate: () => {},
    remoteModerate: async () => ({ flagged: false, categories: [] }),
    mpTextGate: async () => {},
    parseStickerToken: () => null,
    isDefinitiveMutationRejection: () => false,
    mutationCommitState: () => 'unknown',
    mutationOutcomeError: error => error,
    shouldCompensateMutationFailure: () => false,
    captureAccountRequest: userId => ({ userId }),
    captureActiveAccountRequest: () => ({ userId: 'user-a' }),
    getActiveAccountId: () => 'user-a',
    isAccountRequestCurrent: token => token?.userId === 'user-a',
    onAccountTransition: () => () => {},
    createClientMessageId: () => 'message-id',
    fetchArchivedConversationIds: async (_client, _uid, options) => (
      options?.isOwnerCurrent?.() === false ? null : new Set()
    ),
    sanitizeConversationResources: row => row,
    sanitizeMessageResources: row => row,
    ...pagination,
    ...overrides,
  }
}

function conversationRow(id, lastMessageAt = '2026-07-31T00:00:00.000Z') {
  return {
    id,
    item_id: null,
    buyer_id: 'user-a',
    seller_id: 'seller',
    last_message_at: lastMessageAt,
    created_at: lastMessageAt,
    is_pinned_buyer: false,
    is_pinned_seller: false,
    is_muted_buyer: false,
    is_muted_seller: false,
    latest_messages: [{
      id: `message-${id}`,
      content: `preview-${id}`,
      message_type: 'text',
      created_at: lastMessageAt,
    }],
  }
}

test('useMessages reads 1001 conversations with one per-parent latest preview and no giant message filter', async () => {
  const pagination = await loadTsModule('src/api/paginatedRead.ts')
  const conversations = ids(1001, 'conversation').map(id => conversationRow(id))
  const pageEvidence = []
  const supabase = {
    from(table) {
      assert.equal(table, 'conversations')
      return makeAscendingQuery(conversations, {
        serverMax: 500,
        onPage: page => pageEvidence.push(page),
      })
    },
  }
  const module = await loadTsModule(
    'src/composables/useMessages.ts',
    messageRuntime(supabase, pagination),
  )
  const messages = module.useMessages()

  assert.equal(await messages.fetchConversations('user-a', { force: true }), true)
  assert.equal(messages.conversations.value.length, 1001)
  assert.deepEqual(
    messages.conversations.value.map(row => row.id),
    conversations.map(row => row.id),
  )
  assert.equal(messages.conversations.value[0].last_message_preview, 'preview-conversation-00001')
  assert.equal(messages.conversations.value.at(-1).last_message_preview, 'preview-conversation-01001')
  assert.deepEqual(pageEvidence.map(page => page.length), [500, 500, 1, 0])
  assert.ok(pageEvidence.every(page => (
    page.childLimit?.value === 1
    && page.childLimit?.options?.referencedTable === 'latest_messages'
  )))
  assert.ok(pageEvidence.every(page => (
    page.orders.some(([column, options]) => (
      column === 'created_at'
      && options?.ascending === false
      && options?.referencedTable === 'latest_messages'
    ))
    && page.orders.some(([column, options]) => (
      column === 'id'
      && options?.ascending === false
      && options?.referencedTable === 'latest_messages'
    ))
  )))
})

test('a newer conversation request cancels the older keyset scan before partial rows apply', async () => {
  const pagination = await loadTsModule('src/api/paginatedRead.ts')
  const firstGate = deferred()
  let conversationQueryCount = 0
  const supabase = {
    from(table) {
      assert.equal(table, 'conversations')
      conversationQueryCount += 1
      if (conversationQueryCount === 1) {
        return makeAscendingQuery([conversationRow('old-row')], {
          firstPageGate: firstGate,
        })
      }
      if (conversationQueryCount === 2) {
        return makeAscendingQuery([conversationRow('new-row')])
      }
      return makeAscendingQuery([])
    },
  }
  const module = await loadTsModule(
    'src/composables/useMessages.ts',
    messageRuntime(supabase, pagination),
  )
  const messages = module.useMessages()

  const older = messages.fetchConversations('user-a', { force: true })
  await Promise.resolve()
  const newer = messages.fetchConversations('user-a', { force: true })
  assert.equal(await newer, true)
  firstGate.resolve()
  assert.equal(await older, false)
  assert.deepEqual(messages.conversations.value.map(row => row.id), ['new-row'])
})
