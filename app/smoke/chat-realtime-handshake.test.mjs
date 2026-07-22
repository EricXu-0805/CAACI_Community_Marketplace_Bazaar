import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = relativePath => readFileSync(resolve(appRoot, relativePath), 'utf8')

let runtimeSequence = 0

async function loadWithRuntime(relativePath, replacements, runtime, transform = value => value) {
  const runtimeKey = `__chat_realtime_smoke_${++runtimeSequence}`
  globalThis[runtimeKey] = {
    readBoundedJson: response => response.json(),
    readBoundedText: response => response.text(),
    // These tests exercise each composable's event/readiness behavior. The
    // authenticated async boundary itself has a dedicated regression suite;
    // keep this harness synchronous so existing status controls stay exact.
    startPrivateRealtimeChannel: options => {
      const context = {
        userId: options.expectedUserId || '11111111-1111-4111-8111-111111111111',
        isCurrent: () => true,
      }
      const config = typeof options.config === 'function'
        ? options.config(context)
        : options.config
      const channel = options.configure(
        options.supabase.channel(options.topic, { config: { ...config, private: true } }),
        context,
      ).subscribe((status, error) => options.onStatus?.(status, error))
      return () => { options.supabase.removeChannel(channel) }
    },
    ...runtime,
  }
  let input = transform(source(relativePath))
  input = input
    .replace(
      "import { readBoundedJson } from '../api/responseBody'",
      'const { readBoundedJson } = globalThis.__RUNTIME_KEY__',
    )
    .replace(
      "import { readBoundedText } from '../api/responseBody'",
      'const { readBoundedText } = globalThis.__RUNTIME_KEY__',
    )
    .replace(
      "import { startPrivateRealtimeChannel } from '../api/privateRealtime'",
      'const { startPrivateRealtimeChannel } = globalThis.__RUNTIME_KEY__',
    )
  for (const [from, to] of replacements) input = input.replace(from, to.replaceAll('__RUNTIME_KEY__', runtimeKey))
  input = input.replaceAll('__RUNTIME_KEY__', runtimeKey)
  const compiled = ts.transpileModule(input, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText
  try {
    return await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
  } finally {
    delete globalThis[runtimeKey]
  }
}

function preprocessUniPlatform(input, isH5) {
  const enabled = [true]
  const output = []
  for (const line of input.split('\n')) {
    const directive = line.match(/^\s*\/\/\s*#(ifdef|ifndef|endif)(?:\s+(\S+))?\s*$/)
    if (directive) {
      if (directive[1] === 'endif') {
        assert.ok(enabled.length > 1, 'unbalanced uni-app #endif')
        enabled.pop()
      } else {
        const platformMatches = directive[2] === 'H5' ? isH5 : false
        enabled.push(enabled.at(-1) && (directive[1] === 'ifdef' ? platformMatches : !platformMatches))
      }
      continue
    }
    if (enabled.at(-1)) output.push(line)
  }
  assert.equal(enabled.length, 1, 'unbalanced uni-app platform directives')
  return output.join('\n')
}

function channelHarness() {
  const listeners = []
  let statusCallback = null
  let removed = false
  const channel = {
    on(event, filter, callback) {
      listeners.push({ event, filter, callback })
      return channel
    },
    subscribe(callback) {
      statusCallback = callback
      return channel
    },
  }
  const supabase = {
    channel: () => channel,
    removeChannel(value) {
      assert.equal(value, channel)
      removed = true
    },
  }
  return {
    supabase,
    listeners,
    status: value => statusCallback?.(value),
    wasRemoved: () => removed,
  }
}

function deferred() {
  let resolvePromise
  const promise = new Promise(resolve => { resolvePromise = resolve })
  return { promise, resolve: resolvePromise }
}

test('conversation H5 readiness fires once only after SUBSCRIBED', async () => {
  const harness = channelHarness()
  const realtime = await loadWithRuntime(
    'src/composables/useRealtimeFallback.ts',
    [
      [
        "import { useSupabase, platformFetch } from './useSupabase'",
        'const { useSupabase, platformFetch } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { MESSAGE_FIELDS } from './useMessages.constants'",
        'const { MESSAGE_FIELDS } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { BASE_URL } from '../config/runtime'",
        'const { BASE_URL } = globalThis.__RUNTIME_KEY__',
      ],
    ],
    {
      useSupabase: () => ({ supabase: harness.supabase }),
      platformFetch: globalThis.fetch,
      MESSAGE_FIELDS: 'id, conversation_id, created_at',
      BASE_URL: 'https://example.invalid',
    },
  )

  let readyCount = 0
  const inserts = []
  const updates = []
  const unsubscribe = realtime.subscribeToConversation(
    'conversation-1',
    row => inserts.push(row),
    row => updates.push(row),
    () => { readyCount += 1 },
  )

  assert.equal(readyCount, 0)
  harness.status('CHANNEL_ERROR')
  assert.equal(readyCount, 0)
  harness.status('SUBSCRIBED')
  harness.status('SUBSCRIBED')
  assert.equal(readyCount, 1)

  harness.listeners.find(listener => listener.filter.event === 'INSERT')
    .callback({ new: { id: 'message-1' } })
  harness.listeners.find(listener => listener.filter.event === 'UPDATE')
    .callback({ new: { id: 'message-1', is_read: true } })
  assert.deepEqual(inserts, [{ id: 'message-1' }])
  assert.deepEqual(updates, [{ id: 'message-1', is_read: true }])

  unsubscribe()
  assert.equal(harness.wasRemoved(), true)
})

test('conversation MP direct poll becomes ready only after server-clock seed succeeds', async () => {
  const seedQueries = []
  const seedId = '11111111-1111-4111-8111-111111111111'
  const supabase = {
    auth: { getSession: async () => ({ data: { session: null } }) },
    from(table) {
      assert.equal(table, 'messages')
      const query = {
        select(fields) { seedQueries.push({ step: 'select', fields }); return query },
        eq(column, value) { seedQueries.push({ step: 'eq', column, value }); return query },
        order(column, options) { seedQueries.push({ step: 'order', column, options }); return query },
        limit(value) {
          seedQueries.push({ step: 'limit', value })
          return Promise.resolve({ data: [{ id: seedId, created_at: '2026-07-18T00:00:00.000Z' }], error: null })
        },
      }
      return query
    },
  }
  const realtime = await loadWithRuntime(
    'src/composables/useRealtimeFallback.ts',
    [
      [
        "import { useSupabase, platformFetch } from './useSupabase'",
        'const { useSupabase, platformFetch } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { MESSAGE_FIELDS } from './useMessages.constants'",
        'const { MESSAGE_FIELDS } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { BASE_URL } from '../config/runtime'",
        'const { BASE_URL } = globalThis.__RUNTIME_KEY__',
      ],
      ['const LONG_POLL_CIRCUIT_LIMIT = 2', 'const LONG_POLL_CIRCUIT_LIMIT = 0'],
    ],
    {
      useSupabase: () => ({ supabase }),
      platformFetch: globalThis.fetch,
      MESSAGE_FIELDS: 'id, conversation_id, created_at',
      BASE_URL: 'https://example.invalid',
    },
    input => preprocessUniPlatform(input, false),
  )

  let readyCount = 0
  let resolveReady
  const ready = new Promise(resolve => { resolveReady = resolve })
  const unsubscribe = realtime.subscribeToConversation(
    'conversation-mp',
    () => assert.fail('seed tick must not replay an existing row'),
    undefined,
    () => {
      readyCount += 1
      resolveReady()
    },
  )
  let readyTimeout
  try {
    await Promise.race([
      ready,
      new Promise((_, reject) => {
        readyTimeout = setTimeout(() => reject(new Error('MP seed readiness timed out')), 500)
      }),
    ])
  } finally {
    clearTimeout(readyTimeout)
    unsubscribe()
  }

  assert.equal(readyCount, 1)
  assert.deepEqual(seedQueries, [
    { step: 'select', fields: 'id, created_at' },
    { step: 'eq', column: 'conversation_id', value: 'conversation-mp' },
    { step: 'order', column: 'created_at', options: { ascending: false } },
    { step: 'order', column: 'id', options: { ascending: false } },
    { step: 'limit', value: 1 },
  ])
})

test('conversation MP long poll rejects missing or malformed seed cursors before readiness', async () => {
  const responses = []
  const supabase = {
    auth: { getSession: async () => ({ data: { session: null } }) },
  }
  const realtime = await loadWithRuntime(
    'src/composables/useRealtimeFallback.ts',
    [
      [
        "import { useSupabase, platformFetch } from './useSupabase'",
        'const { useSupabase, platformFetch } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { MESSAGE_FIELDS } from './useMessages.constants'",
        'const { MESSAGE_FIELDS } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { BASE_URL } from '../config/runtime'",
        'const { BASE_URL } = globalThis.__RUNTIME_KEY__',
      ],
      ['setTimeout(tick, 1500)', 'setTimeout(tick, 0)'],
      ['setTimeout(tick, 50)', 'setTimeout(tick, 0)'],
    ],
    {
      useSupabase: () => ({ supabase }),
      platformFetch: async () => {
        const response = deferred()
        responses.push(response)
        return response.promise
      },
      MESSAGE_FIELDS: 'id, conversation_id, created_at',
      BASE_URL: 'https://example.invalid',
    },
    input => preprocessUniPlatform(input, false),
  )

  const waitForResponse = async (index) => {
    const deadline = Date.now() + 500
    while (!responses[index]) {
      if (Date.now() > deadline) throw new Error(`long-poll request ${index + 1} did not start`)
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  }
  let readyCount = 0
  const unsubscribe = realtime.subscribeToConversation(
    'conversation-long-poll',
    () => assert.fail('cursor seed responses must not deliver rows'),
    undefined,
    () => { readyCount += 1 },
  )
  try {
    await waitForResponse(0)
    responses[0].resolve(new Response(JSON.stringify({ rows: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    await waitForResponse(1)
    assert.equal(readyCount, 0, 'a 200 response without next_since is not a completed handshake')

    responses[1].resolve(new Response(JSON.stringify({ rows: [], next_since: 'not-a-timestamp' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    await waitForResponse(2)
    assert.equal(readyCount, 0, 'an invalid server cursor must not open the snapshot barrier')

    responses[2].resolve(new Response(JSON.stringify({
      rows: [],
      next_since: '2026-07-18T00:00:00.000Z|11111111-1111-4111-8111-111111111111',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const readyDeadline = Date.now() + 500
    while (readyCount === 0) {
      if (Date.now() > readyDeadline) throw new Error('valid long-poll cursor did not open readiness')
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    assert.equal(readyCount, 1)
  } finally {
    unsubscribe()
    for (const response of responses) {
      response.resolve(new Response(JSON.stringify({ rows: [], next_since: '' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
    }
  }
})

test('one healthy MP long poll cannot reset another subscription failure streak', async () => {
  const conversationId = 'conversation-failing'
  const userId = 'user-healthy'
  const requests = new Map([
    [conversationId, []],
    [userId, []],
  ])
  let directSeedCount = 0
  const supabase = {
    auth: { getSession: async () => ({ data: { session: null } }) },
    from(table) {
      assert.equal(table, 'messages')
      directSeedCount += 1
      const query = {
        select() { return query },
        eq() { return query },
        order() { return query },
        limit() {
          return Promise.resolve({
            data: [{ created_at: '2026-07-18T00:00:00.000Z' }],
            error: null,
          })
        },
      }
      return query
    },
  }
  const realtime = await loadWithRuntime(
    'src/composables/useRealtimeFallback.ts',
    [
      [
        "import { useSupabase, platformFetch } from './useSupabase'",
        'const { useSupabase, platformFetch } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { MESSAGE_FIELDS } from './useMessages.constants'",
        'const { MESSAGE_FIELDS } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { BASE_URL } from '../config/runtime'",
        'const { BASE_URL } = globalThis.__RUNTIME_KEY__',
      ],
      ['setTimeout(tick, 1000)', 'setTimeout(tick, 0)'],
      ['setTimeout(tick, 1500)', 'setTimeout(tick, 0)'],
      ['setTimeout(tick, 50)', 'setTimeout(tick, 0)'],
    ],
    {
      useSupabase: () => ({ supabase }),
      platformFetch: async (input) => {
        const id = new URL(String(input)).searchParams.get('id')
        const request = deferred()
        requests.get(id).push(request)
        return request.promise
      },
      MESSAGE_FIELDS: 'id, conversation_id, created_at',
      BASE_URL: 'https://example.invalid',
    },
    input => preprocessUniPlatform(input, false),
  )
  const waitFor = async (condition, message) => {
    const deadline = Date.now() + 500
    while (!condition()) {
      if (Date.now() > deadline) throw new Error(message)
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  }
  const validEmptyResponse = () => new Response(JSON.stringify({
    rows: [],
    next_since: '2026-07-18T00:00:00.000Z',
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
  const failedResponse = () => new Response('{}', { status: 503 })

  const unsubscribeConversation = realtime.subscribeToConversation(conversationId, () => {})
  const unsubscribeInbox = realtime.subscribeToUserInbox(userId, () => {})
  try {
    await waitFor(
      () => requests.get(conversationId).length >= 1 && requests.get(userId).length >= 1,
      'initial long-poll requests did not start',
    )
    requests.get(conversationId)[0].resolve(failedResponse())
    requests.get(userId)[0].resolve(validEmptyResponse())

    await waitFor(
      () => requests.get(conversationId).length >= 2 && requests.get(userId).length >= 2,
      'second long-poll requests did not start',
    )
    // Finish another healthy request before the failing subscription records
    // its second strike. A process-global strike counter used to erase the
    // conversation's first failure here.
    requests.get(userId)[1].resolve(validEmptyResponse())
    await waitFor(() => requests.get(userId).length >= 3, 'healthy poll did not continue')
    requests.get(conversationId)[1].resolve(failedResponse())

    await waitFor(
      () => directSeedCount > 0 || requests.get(conversationId).length >= 3,
      'failing poll neither tripped nor retried',
    )
    assert.equal(directSeedCount, 1, 'two consecutive failures for one subscription must open its circuit')
    assert.equal(requests.get(conversationId).length, 2)
  } finally {
    unsubscribeConversation()
    unsubscribeInbox()
    for (const pending of requests.values()) {
      for (const request of pending) request.resolve(validEmptyResponse())
    }
  }
})

test('MP direct legacy timestamp handoff upgrades to keyset and drains timestamp ties', async () => {
  const createdAt = '2026-07-18T00:00:01.000Z'
  const initialCreatedAt = '2026-07-18T00:00:00.000Z'
  const rows = Array.from({ length: 55 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    conversation_id: 'conversation-direct-keyset',
    sender_id: 'sender',
    created_at: createdAt,
  }))
  const queryEvidence = []
  const supabase = {
    from(table) {
      assert.equal(table, 'messages')
      const state = { gt: null, or: null, orders: [], limit: null }
      const query = {
        select() { return query },
        eq() { return query },
        gt(column, value) { state.gt = { column, value }; return query },
        or(value) { state.or = value; return query },
        order(column, options) { state.orders.push({ column, options }); return query },
        limit(value) {
          state.limit = value
          queryEvidence.push(state)
          if (state.or?.includes(`id.gt.${rows[49].id}`)) {
            return Promise.resolve({ data: rows.slice(50), error: null })
          }
          if (state.gt?.column === 'created_at' && state.gt.value === initialCreatedAt) {
            return Promise.resolve({ data: rows.slice(0, 50), error: null })
          }
          return Promise.resolve({ data: null, error: { code: 'bad_cursor_filter' } })
        },
      }
      return query
    },
  }
  const realtime = await loadWithRuntime(
    'src/composables/useRealtimeFallback.ts',
    [
      [
        "import { useSupabase, platformFetch } from './useSupabase'",
        'const { useSupabase, platformFetch } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { MESSAGE_FIELDS } from './useMessages.constants'",
        'const { MESSAGE_FIELDS } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { BASE_URL } from '../config/runtime'",
        'const { BASE_URL } = globalThis.__RUNTIME_KEY__',
      ],
      ['function directConversationPoll(', 'export function directConversationPoll('],
      ['intervalMs: 3000', 'intervalMs: 0'],
    ],
    {
      useSupabase: () => ({ supabase }),
      platformFetch: globalThis.fetch,
      MESSAGE_FIELDS: 'id, conversation_id, sender_id, created_at',
      BASE_URL: 'https://example.invalid',
    },
    input => preprocessUniPlatform(input, false),
  )

  const received = []
  const unsubscribe = realtime.directConversationPoll(
    'conversation-direct-keyset',
    row => received.push(row),
    initialCreatedAt,
  )
  try {
    const deadline = Date.now() + 500
    while (received.length < rows.length) {
      if (Date.now() > deadline) throw new Error('direct keyset poll did not drain all timestamp ties')
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  } finally {
    unsubscribe()
  }

  assert.deepEqual(received.map(row => row.id), rows.map(row => row.id))
  assert.equal(new Set(received.map(row => row.id)).size, 55)
  assert.deepEqual(queryEvidence[0].gt, { column: 'created_at', value: initialCreatedAt })
  assert.equal(queryEvidence[0].or, null)
  assert.match(queryEvidence[1].or, /created_at\.gt\..+id\.gt\./)
  assert.deepEqual(queryEvidence[0].orders.map(order => order.column), ['created_at', 'id'])
  assert.equal(queryEvidence[0].limit, 50)
})

for (const config of [
  {
    label: 'offer',
    path: 'src/composables/useOffers.ts',
    factory: 'useOffers',
    fetch: 'fetchOffers',
    rows: 'offers',
    subscribe: 'subscribeToOffers',
    table: 'offers',
    extraReplacements: [],
  },
  {
    label: 'meetup',
    path: 'src/composables/useMeetups.ts',
    factory: 'useMeetups',
    fetch: 'fetchMeetups',
    rows: 'meetups',
    subscribe: 'subscribeToMeetups',
    table: 'meetups',
    extraReplacements: [
      [
        "import { BASE_URL } from '../config/runtime'",
        'const { BASE_URL } = globalThis.__RUNTIME_KEY__',
      ],
    ],
  },
]) {
  test(`${config.label} snapshots are latest-wins and reconcile after channel readiness`, async () => {
    const harness = channelHarness()
    const pending = []
    const supabase = {
      ...harness.supabase,
      from(table) {
        assert.equal(table, config.table)
        const query = {
          select() { return query },
          eq() { return query },
          order() {
            const request = deferred()
            pending.push(request)
            return request.promise
          },
        }
        return query
      },
    }
    const module = await loadWithRuntime(
      config.path,
      [
        ["import { ref } from 'vue'", 'const { ref } = globalThis.__RUNTIME_KEY__'],
        [
          config.label === 'offer'
            ? "import { useSupabase } from './useSupabase'"
            : "import { useSupabase, platformFetch } from './useSupabase'",
          config.label === 'offer'
            ? 'const { useSupabase } = globalThis.__RUNTIME_KEY__'
            : 'const { useSupabase, platformFetch } = globalThis.__RUNTIME_KEY__',
        ],
        [
          /import \{\s*captureActiveAccountRequest,\s*isAccountRequestCurrent,?\s*(?:type AccountRequestToken,?\s*)?\} from '\.\/accountScope'/,
          'const { captureActiveAccountRequest, isAccountRequestCurrent } = globalThis.__RUNTIME_KEY__',
        ],
        ...config.extraReplacements,
      ],
      {
        ref: value => ({ value }),
        useSupabase: () => ({ supabase }),
        captureActiveAccountRequest: () => ({ userId: 'smoke-user', generation: 1 }),
        isAccountRequestCurrent: () => true,
        platformFetch: globalThis.fetch,
        BASE_URL: 'https://example.invalid',
      },
    )
    const api = module[config.factory]()

    const older = api[config.fetch]('conversation-1')
    const newer = api[config.fetch]('conversation-1')
    assert.equal(pending.length, 2)
    pending[1].resolve({ data: [{ id: 'newer' }], error: null })
    await newer
    pending[0].resolve({ data: [{ id: 'older' }], error: null })
    await older
    assert.deepEqual(api[config.rows].value, [{ id: 'newer' }])

    // A newer reconciliation that fails must not suppress a still-valid older
    // snapshot for the same conversation when that older request later lands.
    const recoverableOlder = api[config.fetch]('conversation-1')
    const failedNewer = api[config.fetch]('conversation-1')
    pending[3].resolve({ data: null, error: { code: '503', message: 'transient' } })
    await assert.rejects(failedNewer)
    pending[2].resolve({ data: [{ id: 'recovered-older' }], error: null })
    await recoverableOlder
    assert.deepEqual(api[config.rows].value, [{ id: 'recovered-older' }])

    // Conversation id alone is not a sufficient stale-response guard: after
    // A→B→A, the first A request sees the same active id again. Its captured
    // activation epoch must still be stale, even when the new A request fails.
    const firstA = api[config.fetch]('conversation-1')
    const middleB = api[config.fetch]('conversation-2')
    const secondA = api[config.fetch]('conversation-1')
    pending[6].resolve({ data: null, error: { code: '503', message: 'new A failed' } })
    await assert.rejects(secondA)
    pending[5].resolve({ data: [{ id: 'middle-b' }], error: null })
    await middleB
    pending[4].resolve({ data: [{ id: 'stale-first-a' }], error: null })
    await firstA
    assert.deepEqual(api[config.rows].value, [{ id: 'recovered-older' }])

    let readyCount = 0
    let refetchCount = 0
    const unsubscribe = api[config.subscribe](
      'conversation-1',
      () => { refetchCount += 1 },
      () => { readyCount += 1 },
    )
    harness.status('SUBSCRIBED')
    harness.status('SUBSCRIBED')
    assert.equal(readyCount, 1)
    harness.listeners[0].callback({ new: { id: 'live' } })
    assert.equal(refetchCount, 1)
    unsubscribe()
    assert.equal(harness.wasRemoved(), true)
  })
}

test('ChatThread wires guarded ready refetches before initial snapshots', () => {
  const chat = source('src/components/ChatThread.vue')
  const messages = source('src/composables/useMessages.ts')
  const realtime = source('src/composables/useRealtimeFallback.ts')

  const setupStart = chat.indexOf('async function initializeConversationAfterGate()')
  const setupEnd = chat.indexOf('\nasync function openConversationBehindModerationGate()', setupStart)
  const setup = chat.slice(setupStart, setupEnd)
  assert.ok(setupStart >= 0 && setupEnd > setupStart)

  assert.match(setup, /const setupAccountToken = captureActiveAccountRequest\(\)/)
  assert.match(setup, /mounted &&[\s\S]*conversationId\.value === options\.id[\s\S]*isAccountRequestCurrent\(setupAccountToken\)/)
  assert.match(setup, /subscribeToMessages\([\s\S]*if \(!isCurrentThreadSetup\(\)\) return[\s\S]*fetchMessages\(options\.id\)/)
  assert.ok(setup.indexOf('offersUnsub = subscribeToOffers(') < setup.indexOf('try { await fetchOffers(options.id) }'))
  assert.ok(setup.indexOf('meetupsUnsub = subscribeToMeetups(') < setup.indexOf('try { await fetchMeetups(options.id) }'))

  assert.match(messages, /function subscribeToMessages\([\s\S]*onReady\?: \(\) => void/)
  assert.match(messages, /onReady \? \(\) => \{[\s\S]*activeMessagesConversationId !== conversationId[\s\S]*!isAccountRequestCurrent\(accountToken\)/)
  assert.match(realtime, /function directConversationPoll\([\s\S]*onReady\?: \(\) => void/)
  assert.match(realtime, /scope: 'conversation',[\s\S]*onReady,[\s\S]*onCircuitOpen/)
})
