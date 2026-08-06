import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = relativePath => readFileSync(resolve(appRoot, relativePath), 'utf8')

let runtimeSequence = 0
/* Telemetry emitted by the module under test since the last loadWithRuntime. */
const capturedTelemetry = []

async function readAllAscendingKeysetForTest(options) {
  const rows = []
  let afterKey = null
  while (true) {
    if (!options.isOwnerCurrent()) return null
    const result = await options.fetchPage(afterKey, options.pageSize || 500)
    if (!options.isOwnerCurrent()) return null
    if (result?.error) throw result.error
    if (!Array.isArray(result?.data)) throw new Error('paginated_read_malformed_rows')
    if (result.data.length === 0) return rows
    let previousKey = afterKey
    for (const row of result.data) {
      const key = options.keyOf(row)
      if (typeof key !== 'string' || (previousKey !== null && key <= previousKey)) {
        throw new Error('paginated_read_non_progress')
      }
      previousKey = key
    }
    rows.push(...result.data)
    afterKey = previousKey
  }
}

async function loadWithRuntime(relativePath, replacements, runtime, transform = value => value) {
  const runtimeKey = `__chat_realtime_smoke_${++runtimeSequence}`
  capturedTelemetry.length = 0
  const defaultAccountToken = {
    userId: '11111111-1111-4111-8111-111111111111',
    generation: 1,
  }
  const startChannel = (options, privateChannel, failOnTerminalStatus) => {
    let alive = true
    let failureSent = false
    const context = {
      userId: options.expectedUserId || defaultAccountToken.userId,
      isCurrent: () => alive,
    }
    const config = typeof options.config === 'function'
      ? options.config(context)
      : options.config
    let channel = options.configure(
      options.supabase.channel(options.topic, {
        config: privateChannel ? { ...config, private: true } : { ...config },
      }),
      context,
    )
    const close = () => {
      if (!alive) return
      alive = false
      options.supabase.removeChannel(channel)
      options.onClose?.()
    }
    channel = channel.subscribe((status, error) => {
      if (!alive) return
      options.onStatus?.(status, error)
      if (
        failOnTerminalStatus
        && !failureSent
        && ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)
      ) {
        failureSent = true
        close()
        options.onFailure?.({ stage: 'status', status, error })
      }
    })
    return close
  }
  globalThis[runtimeKey] = {
    readBoundedJson: response => response.json(),
    readBoundedText: response => response.text(),
    // These tests exercise each composable's event/readiness behavior. The
    // authenticated async boundary itself has a dedicated regression suite;
    // keep this harness synchronous so existing status controls stay exact.
    startPrivateRealtimeChannel: options => startChannel(options, true, false),
    startPostgresChangesRealtimeChannel: options => startChannel(options, false, true),
    captureActiveAccountRequest: () => defaultAccountToken,
    isAccountRequestCurrent: token => (
      token?.userId === defaultAccountToken.userId
      && token?.generation === defaultAccountToken.generation
    ),
    onAccountTransition: () => () => {},
    readAllAscendingKeyset: readAllAscendingKeysetForTest,
    subscribeToSnapshotChanges: () => () => {},
    // Fallback takeovers report to Sentry. Record them per load so a test can
    // assert the degradation was announced, not just that polling took over.
    captureException: (error, context) => {
      capturedTelemetry.push({ message: error?.message, source: context?.tags?.source })
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
    .replace(
      "import { startPostgresChangesRealtimeChannel } from '../api/privateRealtime'",
      'const { startPostgresChangesRealtimeChannel } = globalThis.__RUNTIME_KEY__',
    )
    .replace(
      "import { subscribeToSnapshotChanges } from './useRealtimeFallback'",
      'const { subscribeToSnapshotChanges } = globalThis.__RUNTIME_KEY__',
    )
    .replace(
      "import { readAllAscendingKeyset } from '../api/paginatedRead'",
      'const { readAllAscendingKeyset } = globalThis.__RUNTIME_KEY__',
    )
    .replace(
      /import \{\s*captureActiveAccountRequest,\s*isAccountRequestCurrent,\s*onAccountTransition,\s*\} from '\.\/accountScope'/,
      'const { captureActiveAccountRequest, isAccountRequestCurrent, onAccountTransition } = globalThis.__RUNTIME_KEY__',
    )
    .replace(
      "import { captureException } from '../utils/sentry'",
      'const { captureException } = globalThis.__RUNTIME_KEY__',
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
  const events = []
  let statusCallback = null
  let removeCount = 0
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
    channel(topic, options) {
      events.push({ type: 'channel', topic, options })
      return channel
    },
    removeChannel(value) {
      assert.equal(value, channel)
      removeCount += 1
      events.push({ type: 'remove' })
    },
  }
  return {
    supabase,
    listeners,
    events,
    status: value => statusCallback?.(value),
    wasRemoved: () => removeCount > 0,
    removeCount: () => removeCount,
  }
}

function deferred() {
  let resolvePromise
  let rejectPromise
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

const authenticatedSession = () => ({
  data: {
    session: {
      user: { id: '11111111-1111-4111-8111-111111111111' },
      access_token: 'test-jwt',
    },
  },
})

async function waitUntil(condition, message, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(message)
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

test('insert de-duplication is subscription-local and bounded to 512 ids', async () => {
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
      [
        'function createBoundedInsertDelivery(',
        'export function createBoundedInsertDelivery(',
      ],
    ],
    {
      useSupabase: () => ({ supabase: {} }),
      platformFetch: globalThis.fetch,
      MESSAGE_FIELDS: 'id, conversation_id, sender_id, created_at',
      BASE_URL: 'https://example.invalid',
    },
    input => preprocessUniPlatform(input, false),
  )

  const firstScope = []
  const secondScope = []
  const deliverFirst = realtime.createBoundedInsertDelivery(row => firstScope.push(row.id))
  const deliverSecond = realtime.createBoundedInsertDelivery(row => secondScope.push(row.id))
  const shared = { id: 'shared-row-id' }

  deliverFirst(shared)
  deliverFirst(shared)
  deliverSecond(shared)
  assert.deepEqual(firstScope, [shared.id])
  assert.deepEqual(secondScope, [shared.id])

  for (let index = 0; index < 512; index += 1) {
    deliverFirst({ id: `bounded-row-${index}` })
  }
  deliverFirst(shared)
  assert.equal(firstScope.length, 514)
  assert.equal(firstScope[513], shared.id, 'the oldest id must be eligible after bounded eviction')
})

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
  harness.status('SUBSCRIBED')
  harness.status('SUBSCRIBED')
  assert.equal(readyCount, 1)

  const insertListener = harness.listeners.find(listener => listener.filter.event === 'INSERT')
  insertListener.callback({ new: { id: 'message-1' } })
  insertListener.callback({ new: { id: 'message-1' } })
  harness.listeners.find(listener => listener.filter.event === 'UPDATE')
    .callback({ new: { id: 'message-1', is_read: true } })
  assert.deepEqual(inserts, [{ id: 'message-1' }])
  assert.deepEqual(updates, [{ id: 'message-1', is_read: true }])

  unsubscribe()
  assert.equal(harness.wasRemoved(), true)
})

test('H5 readiness retries a rejected authoritative snapshot without duplicating success', async () => {
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
      ['const READY_RECONCILE_RETRY_MS = 1500', 'const READY_RECONCILE_RETRY_MS = 0'],
    ],
    {
      useSupabase: () => ({ supabase: harness.supabase }),
      platformFetch: globalThis.fetch,
      MESSAGE_FIELDS: 'id, conversation_id, created_at',
      BASE_URL: 'https://example.invalid',
    },
  )

  let attempts = 0
  let successes = 0
  const unsubscribe = realtime.subscribeToConversation(
    'conversation-ready-retry',
    () => {},
    undefined,
    () => {
      attempts += 1
      if (attempts === 1) return Promise.reject(new Error('snapshot unavailable'))
      successes += 1
    },
  )
  try {
    harness.status('SUBSCRIBED')
    harness.status('SUBSCRIBED')
    assert.equal(attempts, 1, 'duplicate status must not overlap a pending reconcile')
    await waitUntil(() => successes === 1, 'failed H5 readiness did not retry')
    harness.status('SUBSCRIBED')
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(attempts, 2)
    assert.equal(successes, 1)
  } finally {
    unsubscribe()
  }
})

test('a Postgres Changes setup failure crosses the composable seam into one direct poll', async () => {
  const seed = deferred()
  let pollCount = 0
  let primaryStops = 0
  const supabase = {
    from(table) {
      assert.equal(table, 'messages')
      const query = {
        select() { return query },
        eq() { return query },
        order() { return query },
        limit() {
          pollCount += 1
          return seed.promise
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
    ],
    {
      useSupabase: () => ({ supabase }),
      platformFetch: globalThis.fetch,
      MESSAGE_FIELDS: 'id, conversation_id, created_at',
      BASE_URL: 'https://example.invalid',
      startPostgresChangesRealtimeChannel: options => {
        options.onFailure?.({ stage: 'getSession' })
        return () => { primaryStops += 1 }
      },
    },
  )

  let readyCount = 0
  const unsubscribe = realtime.subscribeToConversation(
    'conversation-setup-failure',
    () => {},
    undefined,
    () => { readyCount += 1 },
  )
  try {
    await waitUntil(() => pollCount === 1, 'setup failure did not start direct polling')
    assert.equal(primaryStops, 1)
    assert.equal(readyCount, 0)
    seed.resolve({ data: [], error: null })
    await waitUntil(() => readyCount === 1, 'direct poll did not establish recovery readiness')
  } finally {
    unsubscribe()
    seed.resolve({ data: [], error: null })
  }
})

for (const failedStatus of ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']) {
  test(`conversation H5 ${failedStatus} removes WS, cold-seeds direct poll, and de-duplicates overlap`, async () => {
    const harness = channelHarness()
    const seed = deferred()
    const nextRows = deferred()
    let queryCount = 0
    const supabase = {
      ...harness.supabase,
      from(table) {
        assert.equal(table, 'messages')
        const query = {
          select() { return query },
          eq() { return query },
          gt() { return query },
          or() { return query },
          order() { return query },
          limit() {
            queryCount += 1
            harness.events.push({ type: 'poll', queryCount })
            if (queryCount === 1) return seed.promise
            if (queryCount === 2) return nextRows.promise
            return Promise.resolve({ data: [], error: null })
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
        ['intervalMs: 3000', 'intervalMs: 0'],
      ],
      {
        useSupabase: () => ({ supabase }),
        platformFetch: globalThis.fetch,
        MESSAGE_FIELDS: 'id, conversation_id, sender_id, created_at',
        BASE_URL: 'https://example.invalid',
      },
    )

    const firstId = '11111111-1111-4111-8111-111111111111'
    const secondId = '22222222-2222-4222-8222-222222222222'
    const received = []
    let readyCount = 0
    let reconcileCount = 0
    let receiptState = 'unread'
    const unsubscribe = realtime.subscribeToConversation(
      'conversation-failover',
      row => received.push(row),
      undefined,
      () => { readyCount += 1 },
      () => {
        reconcileCount += 1
        receiptState = 'read'
      },
    )
    try {
      harness.status('SUBSCRIBED')
      harness.status('SUBSCRIBED')
      assert.equal(readyCount, 1)

      const insertListener = harness.listeners.find(listener => listener.filter.event === 'INSERT')
      insertListener.callback({ new: { id: firstId } })
      harness.status(failedStatus)

      assert.equal(harness.removeCount(), 1)
      assert.equal(queryCount, 1, 'fallback must own one cold seed')
      // Polling keeps the feature working, which is exactly why the takeover
      // has to announce itself: otherwise Realtime can be broken in production
      // for days and the only symptom is latency nobody attributes.
      assert.deepEqual(
        capturedTelemetry,
        [{ message: 'realtime_fallback_takeover', source: 'realtime.fallback.conversation' }],
        'the handoff must report exactly once, tagged with its surface',
      )
      assert.ok(
        harness.events.findIndex(event => event.type === 'remove')
          < harness.events.findIndex(event => event.type === 'poll'),
        'the failed channel must be removed before polling starts',
      )
      assert.equal(readyCount, 1, 'cold fallback is not ready before server-clock seed')

      seed.resolve({ data: [], error: null })
      await waitUntil(() => readyCount === 2, 'fallback seed did not trigger recovery readiness')
      await waitUntil(() => queryCount >= 2, 'fallback did not continue after its seed')

      nextRows.resolve({
        data: [
          {
            id: firstId,
            conversation_id: 'conversation-failover',
            sender_id: 'peer',
            created_at: '2026-07-30T00:00:00.000Z',
          },
          {
            id: secondId,
            conversation_id: 'conversation-failover',
            sender_id: 'peer',
            created_at: '2026-07-30T00:00:01.000Z',
          },
          {
            id: firstId,
            conversation_id: 'conversation-failover',
            sender_id: 'peer',
            created_at: '2026-07-30T00:00:02.000Z',
          },
        ],
        error: null,
      })
      await waitUntil(() => received.length === 2, 'WS/poll overlap was not delivered')
      assert.deepEqual(received.map(row => row.id), [firstId, secondId])
      await waitUntil(() => reconcileCount >= 1, 'degraded snapshot reconciliation did not continue')
      assert.equal(receiptState, 'read', 'UPDATE-only receipt state must converge while polling owns transport')

      // A queued callback from the removed socket and repeated failure statuses
      // cannot revive it or create another poll owner.
      insertListener.callback({ new: { id: secondId } })
      harness.status(failedStatus)
      assert.deepEqual(received.map(row => row.id), [firstId, secondId])
      assert.equal(harness.removeCount(), 1)
      assert.equal(readyCount, 2)
    } finally {
      unsubscribe()
      seed.resolve({ data: [], error: null })
      nextRows.resolve({ data: [], error: null })
    }
  })
}

test('failed authoritative seed reconciliation retries before fallback readiness settles', async () => {
  const harness = channelHarness()
  const seed = deferred()
  let queryCount = 0
  const supabase = {
    ...harness.supabase,
    from(table) {
      assert.equal(table, 'messages')
      const query = {
        select() { return query },
        eq() { return query },
        gt() { return query },
        or() { return query },
        order() { return query },
        limit() {
          queryCount += 1
          if (queryCount === 1) return seed.promise
          return Promise.resolve({ data: [], error: null })
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
      ['intervalMs: 3000', 'intervalMs: 0'],
    ],
    {
      useSupabase: () => ({ supabase }),
      platformFetch: globalThis.fetch,
      MESSAGE_FIELDS: 'id, conversation_id, sender_id, created_at',
      BASE_URL: 'https://example.invalid',
    },
  )

  let reconcileAttempts = 0
  let successfulReadyGenerations = 0
  let incrementalRows = 0
  const unsubscribe = realtime.subscribeToConversation(
    'conversation-reconcile-retry',
    () => { incrementalRows += 1 },
    undefined,
    () => {
      reconcileAttempts += 1
      if (reconcileAttempts === 2) {
        return Promise.reject(new Error('snapshot temporarily unavailable'))
      }
      successfulReadyGenerations += 1
    },
  )
  try {
    harness.status('SUBSCRIBED')
    assert.equal(successfulReadyGenerations, 1)
    harness.status('CHANNEL_ERROR')
    seed.resolve({ data: [], error: null })

    await waitUntil(
      () => successfulReadyGenerations === 2,
      'fallback did not retry its failed authoritative reconciliation',
    )
    assert.equal(reconcileAttempts, 3)
    assert.ok(queryCount >= 2)
    assert.equal(incrementalRows, 0, 'cold seed history must reconcile via snapshot, not event delivery')
  } finally {
    unsubscribe()
    seed.resolve({ data: [], error: null })
  }
})

test('explicit H5 teardown suppresses late row/status and never starts fallback', async () => {
  const harness = channelHarness()
  let pollCount = 0
  const supabase = {
    ...harness.supabase,
    from() {
      pollCount += 1
      throw new Error('intentional teardown must not poll')
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
    ],
    {
      useSupabase: () => ({ supabase }),
      platformFetch: globalThis.fetch,
      MESSAGE_FIELDS: 'id, conversation_id, sender_id, created_at',
      BASE_URL: 'https://example.invalid',
    },
  )

  const received = []
  let readyCount = 0
  const unsubscribe = realtime.subscribeToConversation(
    'conversation-teardown',
    row => received.push(row),
    undefined,
    () => { readyCount += 1 },
  )
  const insertListener = harness.listeners.find(listener => listener.filter.event === 'INSERT')
  unsubscribe()
  harness.status('CHANNEL_ERROR')
  insertListener.callback({ new: { id: '11111111-1111-4111-8111-111111111111' } })
  await Promise.resolve()

  assert.equal(harness.removeCount(), 1)
  assert.equal(pollCount, 0)
  assert.equal(readyCount, 0)
  assert.deepEqual(received, [])
})

test('account replacement suppresses a pending direct-poll seed and every late continuation', async () => {
  const seed = deferred()
  let queryCount = 0
  let activeUserId = '11111111-1111-4111-8111-111111111111'
  let generation = 1
  const transitionListeners = new Set()
  const accountRuntime = {
    captureActiveAccountRequest: () => ({ userId: activeUserId, generation }),
    isAccountRequestCurrent: token => (
      token?.userId === activeUserId && token?.generation === generation
    ),
    onAccountTransition: listener => {
      transitionListeners.add(listener)
      return () => transitionListeners.delete(listener)
    },
  }
  const transition = (nextUserId) => {
    activeUserId = nextUserId
    generation += 1
    for (const listener of [...transitionListeners]) {
      listener({ userId: nextUserId, generation })
    }
  }
  const supabase = {
    from(table) {
      assert.equal(table, 'messages')
      const query = {
        select() { return query },
        eq() { return query },
        order() { return query },
        limit() {
          queryCount += 1
          return seed.promise
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
      ...accountRuntime,
      useSupabase: () => ({ supabase }),
      platformFetch: globalThis.fetch,
      MESSAGE_FIELDS: 'id, conversation_id, sender_id, created_at',
      BASE_URL: 'https://example.invalid',
    },
    input => preprocessUniPlatform(input, false),
  )

  const received = []
  let readyCount = 0
  const unsubscribe = realtime.subscribeToConversation(
    'conversation-account-switch',
    row => received.push(row),
    undefined,
    () => { readyCount += 1 },
  )
  assert.equal(queryCount, 1)
  transition('22222222-2222-4222-8222-222222222222')
  seed.resolve({ data: [], error: null })
  await new Promise(resolve => setTimeout(resolve, 0))

  assert.equal(queryCount, 1)
  assert.equal(readyCount, 0)
  assert.deepEqual(received, [])
  unsubscribe()
})

for (const userStream of [
  {
    label: 'notifications',
    subscribe: 'subscribeToUserNotifications',
    table: 'notifications',
  },
  {
    label: 'inbox',
    subscribe: 'subscribeToUserInbox',
    table: 'messages',
  },
]) {
  for (const failedStatus of ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']) {
    test(`H5 ${userStream.label} ${failedStatus} enters one direct poll and de-duplicates overlap`, async () => {
      const harness = channelHarness()
      const seed = deferred()
      const nextRows = deferred()
      let queryCount = 0
      const supabase = {
        ...harness.supabase,
        from(table) {
          assert.equal(table, userStream.table)
          const query = {
            select() { return query },
            eq() { return query },
            neq() { return query },
            gt() { return query },
            or() { return query },
            order() { return query },
            limit() {
              queryCount += 1
              if (queryCount === 1) return seed.promise
              if (queryCount === 2) return nextRows.promise
              return Promise.resolve({ data: [], error: null })
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
          ['intervalMs: 20000', 'intervalMs: 0'],
          ['intervalMs: 10000', 'intervalMs: 0'],
        ],
        {
          useSupabase: () => ({ supabase }),
          platformFetch: globalThis.fetch,
          MESSAGE_FIELDS: 'id, conversation_id, sender_id, created_at',
          BASE_URL: 'https://example.invalid',
        },
      )

      const firstId = '11111111-1111-4111-8111-111111111111'
      const secondId = '22222222-2222-4222-8222-222222222222'
      const received = []
      let readyCount = 0
      let reconcileCount = 0
      const unsubscribe = realtime[userStream.subscribe](
        '11111111-1111-4111-8111-111111111111',
        row => received.push(row),
        () => { readyCount += 1 },
        () => { reconcileCount += 1 },
      )
      try {
        harness.status('SUBSCRIBED')
        harness.status('SUBSCRIBED')
        assert.equal(readyCount, 1)
        const insertListener = harness.listeners.find(listener => listener.filter.event === 'INSERT')
        insertListener.callback({
          new: {
            id: firstId,
            user_id: '11111111-1111-4111-8111-111111111111',
            conversation_id: 'conversation-1',
            sender_id: 'peer',
            created_at: '2026-07-30T00:00:00.000Z',
          },
        })

        harness.status(failedStatus)
        assert.equal(harness.removeCount(), 1)
        assert.equal(queryCount, 1)
        assert.equal(readyCount, 1)

        seed.resolve({ data: [], error: null })
        await waitUntil(() => readyCount === 2, `${userStream.label} fallback did not become ready`)
        await waitUntil(() => queryCount >= 2, `${userStream.label} fallback did not continue`)
        nextRows.resolve({
          data: [
            {
              id: firstId,
              user_id: '11111111-1111-4111-8111-111111111111',
              conversation_id: 'conversation-1',
              sender_id: 'peer',
              created_at: '2026-07-30T00:00:00.000Z',
            },
            {
              id: secondId,
              user_id: '11111111-1111-4111-8111-111111111111',
              conversation_id: 'conversation-2',
              sender_id: 'peer',
              created_at: '2026-07-30T00:00:01.000Z',
            },
          ],
          error: null,
        })
        await waitUntil(() => received.length === 2, `${userStream.label} overlap was not delivered`)
        await waitUntil(() => reconcileCount >= 1, `${userStream.label} degraded reconciliation did not repeat`)
        assert.deepEqual(received.map(row => row.id), [firstId, secondId])
        assert.equal(readyCount, 2)

        harness.status(failedStatus)
        assert.equal(harness.removeCount(), 1)
      } finally {
        unsubscribe()
        seed.resolve({ data: [], error: null })
        nextRows.resolve({ data: [], error: null })
      }
    })
  }
}

test('conversation MP direct poll becomes ready only after server-clock seed succeeds', async () => {
  const seedQueries = []
  const seedId = '11111111-1111-4111-8111-111111111111'
  const supabase = {
    auth: { getSession: async () => authenticatedSession() },
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

test('conversation MP long poll recovers from one malformed seed before readiness', async () => {
  const responses = []
  const supabase = {
    auth: { getSession: async () => authenticatedSession() },
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
      ['scheduleTick(1000)', 'scheduleTick(0)'],
      [/scheduleTick\(1500\)/g, 'scheduleTick(0)'],
      ['scheduleTick(50)', 'scheduleTick(0)'],
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
  let reconcileAttempts = 0
  let reconcileSuccesses = 0
  const unsubscribe = realtime.subscribeToConversation(
    'conversation-long-poll',
    () => assert.fail('cursor seed responses must not deliver rows'),
    undefined,
    () => { readyCount += 1 },
    () => {
      reconcileAttempts += 1
      if (reconcileAttempts <= 2) {
        return Promise.reject(new Error('snapshot temporarily unavailable'))
      }
      reconcileSuccesses += 1
    },
  )
  try {
    await waitForResponse(0)
    responses[0].resolve(new Response(JSON.stringify({ rows: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    await waitForResponse(1)
    assert.equal(readyCount, 0, 'a 200 response without next_since is not a completed handshake')

    responses[1].resolve(new Response(JSON.stringify({
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

    const healthyResponse = () => new Response(JSON.stringify({
      rows: [],
      next_since: '2026-07-18T00:00:00.000Z|11111111-1111-4111-8111-111111111111',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
    await waitForResponse(2)
    responses[2].resolve(healthyResponse())
    await waitForResponse(3)
    responses[3].resolve(new Response('', { status: 503 }))
    await waitForResponse(4)
    responses[4].resolve(healthyResponse())
    await waitForResponse(5)
    responses[5].resolve(healthyResponse())
    await waitUntil(
      () => reconcileSuccesses === 1,
      'healthy long-poll responses did not retry authoritative reconciliation',
    )
    assert.equal(reconcileAttempts, 3)
    assert.equal(readyCount, 1, 'recurring reconciliation must not redefine readiness')
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

test('MP long poll upgrades legacy cursors and rejects unordered or mismatched row batches', async () => {
  const requests = []
  const delivered = []
  let directSeedCount = 0
  const initialCursor = '2026-07-18T00:00:00.000000Z'
  const createdAt = '2026-07-18T00:00:01.000002Z'
  const firstRow = {
    id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    conversation_id: 'conversation-long-poll-cursor',
    sender_id: '22222222-2222-4222-8222-222222222222',
    created_at: '2026-07-18T00:00:01.000001Z',
  }
  const secondRow = {
    ...firstRow,
    id: '11111111-1111-4111-8111-111111111111',
    created_at: createdAt,
  }
  const supabase = {
    auth: { getSession: async () => authenticatedSession() },
    from(table) {
      assert.equal(table, 'messages')
      directSeedCount += 1
      const query = {
        select() { return query },
        eq() { return query },
        order() { return query },
        limit() { return Promise.resolve({ data: [], error: null }) },
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
      ['scheduleTick(1000)', 'scheduleTick(0)'],
      [/scheduleTick\(1500\)/g, 'scheduleTick(0)'],
      ['scheduleTick(50)', 'scheduleTick(0)'],
    ],
    {
      useSupabase: () => ({ supabase }),
      platformFetch: async (input) => {
        const response = deferred()
        requests.push({ url: new URL(String(input)), response })
        return response.promise
      },
      MESSAGE_FIELDS: 'id, conversation_id, sender_id, created_at',
      BASE_URL: 'https://example.invalid',
    },
    input => preprocessUniPlatform(input, false),
  )

  const waitForRequest = async (index) => {
    await waitUntil(
      () => !!requests[index],
      `long-poll request ${index + 1} did not start`,
    )
  }
  const response = (rows, nextSince) => new Response(JSON.stringify({
    rows,
    next_since: nextSince,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

  const unsubscribe = realtime.subscribeToConversation(
    firstRow.conversation_id,
    row => delivered.push(row.id),
  )
  try {
    await waitForRequest(0)
    requests[0].response.resolve(response([], initialCursor))
    await waitForRequest(1)

    // A rolling old endpoint can return a timestamp-only cursor with rows. The
    // client must upgrade from the final row instead of keeping strict `gt`.
    requests[1].response.resolve(response([firstRow, secondRow], createdAt))
    await waitForRequest(2)
    assert.deepEqual(delivered, [firstRow.id, secondRow.id])
    assert.equal(
      requests[2].url.searchParams.get('since'),
      `${createdAt}|${secondRow.id}`,
    )

    // Rows must be strictly keyset ordered before the terminal cursor is
    // accepted. Pair one unordered batch with one mismatched-cursor batch; the
    // two malformed responses must trip this subscription without delivery.
    requests[2].response.resolve(response(
      [
        { ...secondRow, id: '55555555-5555-4555-8555-555555555555' },
        { ...secondRow, id: '44444444-4444-4444-8444-444444444444' },
      ],
      `${createdAt}|44444444-4444-4444-8444-444444444444`,
    ))
    await waitForRequest(3)
    requests[3].response.resolve(response(
      [{ ...secondRow, id: '66666666-6666-4666-8666-666666666666' }],
      `${createdAt}|77777777-7777-4777-8777-777777777777`,
    ))
    await waitUntil(
      () => directSeedCount === 1,
      'two mismatched row cursors did not hand off to direct polling',
    )
    assert.deepEqual(
      delivered,
      [firstRow.id, secondRow.id],
      'mismatched cursor batches must be rejected before delivery',
    )
  } finally {
    unsubscribe()
    for (const request of requests) {
      request.response.resolve(response([], initialCursor))
    }
  }
})

test('MP long poll rejects parseable forward and backward empty cursor jumps', async () => {
  const requests = []
  let directPollCount = 0
  const baseCursor = '2026-07-18T00:00:01.000001Z|11111111-1111-4111-8111-111111111111'
  const futureCursor = '2026-07-18T00:00:02.000001Z|22222222-2222-4222-8222-222222222222'
  const staleCursor = '2026-07-18T00:00:00.000001Z|33333333-3333-4333-8333-333333333333'
  const supabase = {
    auth: { getSession: async () => authenticatedSession() },
    from(table) {
      assert.equal(table, 'messages')
      const query = {
        select() { return query },
        eq() { return query },
        gt() { return query },
        or() { return query },
        order() { return query },
        limit() {
          directPollCount += 1
          return Promise.resolve({ data: [], error: null })
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
      [/scheduleTick\(1500\)/g, 'scheduleTick(0)'],
      ['scheduleTick(50)', 'scheduleTick(0)'],
    ],
    {
      useSupabase: () => ({ supabase }),
      platformFetch: async (input) => {
        const pending = deferred()
        requests.push({ url: new URL(String(input)), pending })
        return pending.promise
      },
      MESSAGE_FIELDS: 'id, conversation_id, sender_id, created_at',
      BASE_URL: 'https://example.invalid',
    },
    input => preprocessUniPlatform(input, false),
  )
  const emptyResponse = nextSince => new Response(JSON.stringify({
    rows: [],
    next_since: nextSince,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

  const unsubscribe = realtime.subscribeToConversation(
    'conversation-empty-cursor-jump',
    () => {},
  )
  try {
    await waitUntil(() => !!requests[0], 'empty-cursor seed request did not start')
    requests[0].pending.resolve(emptyResponse(baseCursor))
    await waitUntil(() => !!requests[1], 'steady-state long poll did not start')
    assert.equal(requests[1].url.searchParams.get('since'), baseCursor)

    requests[1].pending.resolve(emptyResponse(futureCursor))
    await waitUntil(() => !!requests[2], 'forward cursor jump was not retried')
    assert.equal(
      requests[2].url.searchParams.get('since'),
      baseCursor,
      'a parseable forward cursor must not be committed without its rows',
    )

    requests[2].pending.resolve(emptyResponse(staleCursor))
    await waitUntil(
      () => directPollCount === 1,
      'two empty-response cursor jumps did not hand off to direct polling',
    )
  } finally {
    unsubscribe()
    for (const request of requests) request.pending.resolve(emptyResponse(baseCursor))
  }
})

test('MP long poll retries a batch when its consumer throws before cursor commit', async () => {
  const requests = []
  const delivered = []
  const attempted = []
  let failFirstDelivery = true
  const seedCursor = '2026-07-18T00:00:00.000Z|11111111-1111-4111-8111-111111111111'
  const rows = [
    {
      id: '22222222-2222-4222-8222-222222222222',
      conversation_id: 'conversation-consumer-retry',
      sender_id: '33333333-3333-4333-8333-333333333333',
      created_at: '2026-07-18T00:00:01.000Z',
    },
    {
      id: '44444444-4444-4444-8444-444444444444',
      conversation_id: 'conversation-consumer-retry',
      sender_id: '33333333-3333-4333-8333-333333333333',
      created_at: '2026-07-18T00:00:02.000Z',
    },
  ]
  const supabase = {
    auth: { getSession: async () => authenticatedSession() },
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
      [/scheduleTick\(1500\)/g, 'scheduleTick(0)'],
      ['scheduleTick(50)', 'scheduleTick(0)'],
    ],
    {
      useSupabase: () => ({ supabase }),
      platformFetch: async (input) => {
        const pending = deferred()
        requests.push({ url: new URL(String(input)), pending })
        return pending.promise
      },
      MESSAGE_FIELDS: 'id, conversation_id, sender_id, created_at',
      BASE_URL: 'https://example.invalid',
    },
    input => preprocessUniPlatform(input, false),
  )
  const response = (responseRows, nextSince) => new Response(JSON.stringify({
    rows: responseRows,
    next_since: nextSince,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

  const unsubscribe = realtime.subscribeToConversation(
    rows[0].conversation_id,
    row => {
      attempted.push(row.id)
      if (row.id === rows[0].id && failFirstDelivery) {
        failFirstDelivery = false
        throw new Error('consumer temporarily unavailable')
      }
      delivered.push(row.id)
    },
  )
  try {
    await waitUntil(() => !!requests[0], 'consumer retry seed request did not start')
    requests[0].pending.resolve(response([], seedCursor))
    await waitUntil(() => !!requests[1], 'consumer retry row request did not start')
    requests[1].pending.resolve(response(
      rows,
      `${rows[1].created_at}|${rows[1].id}`,
    ))
    await waitUntil(() => !!requests[2], 'failed consumer batch was not retried')
    assert.equal(
      requests[2].url.searchParams.get('since'),
      seedCursor,
      'the transport cursor must remain at the last fully-consumed batch',
    )
    requests[2].pending.resolve(response(
      rows,
      `${rows[1].created_at}|${rows[1].id}`,
    ))
    await waitUntil(() => delivered.length === 2, 'retried batch did not fully drain')
    assert.deepEqual(attempted, [rows[0].id, rows[0].id, rows[1].id])
    assert.deepEqual(delivered, rows.map(row => row.id))
  } finally {
    unsubscribe()
    for (const request of requests) {
      request.pending.resolve(response([], seedCursor))
    }
  }
})

test('two non-array MP long-poll row payloads trip directly to PostgREST polling', async () => {
  const directSeed = deferred()
  let longPollCalls = 0
  let directSeedCount = 0
  const supabase = {
    auth: { getSession: async () => authenticatedSession() },
    from(table) {
      assert.equal(table, 'messages')
      const query = {
        select() { return query },
        eq() { return query },
        order() { return query },
        limit() {
          directSeedCount += 1
          return directSeed.promise
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
      [/scheduleTick\(1500\)/g, 'scheduleTick(0)'],
    ],
    {
      useSupabase: () => ({ supabase }),
      platformFetch: async () => {
        longPollCalls += 1
        if (longPollCalls <= 2) {
          return new Response(JSON.stringify({
            rows: { unexpected: true },
            next_since: '2026-07-18T00:00:00.000Z|11111111-1111-4111-8111-111111111111',
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        throw new Error('long poll should already have tripped its circuit')
      },
      MESSAGE_FIELDS: 'id, conversation_id, sender_id, created_at',
      BASE_URL: 'https://example.invalid',
    },
    input => preprocessUniPlatform(input, false),
  )

  let readyCount = 0
  const unsubscribe = realtime.subscribeToConversation(
    'conversation-malformed-breaker',
    () => {},
    undefined,
    () => { readyCount += 1 },
  )
  try {
    await waitUntil(
      () => directSeedCount === 1,
      'malformed long-poll responses did not hand off to direct polling',
    )
    assert.equal(longPollCalls, 2)
    assert.equal(readyCount, 0, 'fallback is not ready before its server cursor seed')
    directSeed.resolve({ data: [], error: null })
    await waitUntil(() => readyCount === 1, 'direct fallback did not complete readiness')
  } finally {
    unsubscribe()
    directSeed.resolve({ data: [], error: null })
  }
})

test('one healthy MP long poll cannot reset another subscription failure streak', async () => {
  const conversationId = 'conversation-failing'
  const freshConversationId = 'conversation-fresh'
  const userId = '11111111-1111-4111-8111-111111111111'
  const requests = new Map([
    [conversationId, []],
    [freshConversationId, []],
    [userId, []],
  ])
  let directSeedCount = 0
  const supabase = {
    auth: { getSession: async () => authenticatedSession() },
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
      ['scheduleTick(1000)', 'scheduleTick(0)'],
      [/scheduleTick\(1500\)/g, 'scheduleTick(0)'],
      ['scheduleTick(50)', 'scheduleTick(0)'],
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
  let unsubscribeFresh = () => {}
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

    unsubscribeFresh = realtime.subscribeToConversation(freshConversationId, () => {})
    await waitFor(
      () => requests.get(freshConversationId).length >= 1,
      'one subscription circuit must not force a fresh scope into direct poll',
    )
    assert.equal(
      directSeedCount,
      1,
      'a tripped conversation cannot contaminate another subscription circuit',
    )
  } finally {
    unsubscribeConversation()
    unsubscribeInbox()
    unsubscribeFresh()
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

test('MP direct poll retries a batch when its consumer throws before cursor commit', async () => {
  const initialCreatedAt = '2026-07-18T00:00:00.000Z'
  const rows = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      conversation_id: 'conversation-direct-consumer-retry',
      sender_id: 'peer',
      created_at: '2026-07-18T00:00:01.000Z',
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      conversation_id: 'conversation-direct-consumer-retry',
      sender_id: 'peer',
      created_at: '2026-07-18T00:00:02.000Z',
    },
  ]
  let rowBatchReads = 0
  const supabase = {
    from(table) {
      assert.equal(table, 'messages')
      const state = { gt: null, or: null }
      const query = {
        select() { return query },
        eq() { return query },
        gt(column, value) { state.gt = { column, value }; return query },
        or(value) { state.or = value; return query },
        order() { return query },
        limit() {
          if (state.gt?.value === initialCreatedAt) {
            rowBatchReads += 1
            return Promise.resolve({ data: rows, error: null })
          }
          if (state.or?.includes(`id.gt.${rows[1].id}`)) {
            return Promise.resolve({ data: [], error: null })
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

  let failFirstDelivery = true
  const attempted = []
  const delivered = []
  const deliverInsert = row => {
    attempted.push(row.id)
    if (row.id === rows[0].id && failFirstDelivery) {
      failFirstDelivery = false
      throw new Error('direct consumer temporarily unavailable')
    }
    delivered.push(row.id)
  }
  const unsubscribe = realtime.directConversationPoll(
    rows[0].conversation_id,
    deliverInsert,
    initialCreatedAt,
  )
  try {
    await waitUntil(() => delivered.length === rows.length, 'direct consumer batch was not retried')
  } finally {
    unsubscribe()
  }

  assert.equal(rowBatchReads, 2)
  assert.deepEqual(attempted, [rows[0].id, rows[0].id, rows[1].id])
  assert.deepEqual(delivered, rows.map(row => row.id))
})

test('MP direct inbox drains 30 timestamp ties across its 25-row boundary', async () => {
  const userId = '11111111-1111-4111-8111-111111111111'
  const createdAt = '2026-07-18T00:00:01.000Z'
  const initialCreatedAt = '2026-07-18T00:00:00.000Z'
  const rows = Array.from({ length: 30 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    conversation_id: `conversation-${index + 1}`,
    sender_id: 'peer',
    created_at: createdAt,
  }))
  const queryEvidence = []
  const supabase = {
    from(table) {
      assert.equal(table, 'messages')
      const state = { neq: null, gt: null, or: null, orders: [], limit: null }
      const query = {
        select() { return query },
        neq(column, value) { state.neq = { column, value }; return query },
        gt(column, value) { state.gt = { column, value }; return query },
        or(value) { state.or = value; return query },
        order(column, options) { state.orders.push({ column, options }); return query },
        limit(value) {
          state.limit = value
          queryEvidence.push(state)
          if (state.or?.includes(`id.gt.${rows[24].id}`)) {
            return Promise.resolve({ data: rows.slice(25), error: null })
          }
          if (state.gt?.column === 'created_at' && state.gt.value === initialCreatedAt) {
            return Promise.resolve({ data: rows.slice(0, 25), error: null })
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
      ['function directInboxPoll(', 'export function directInboxPoll('],
      ['intervalMs: 10000', 'intervalMs: 0'],
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
  const unsubscribe = realtime.directInboxPoll(
    userId,
    row => received.push(row),
    initialCreatedAt,
  )
  try {
    await waitUntil(() => received.length === rows.length, 'direct inbox did not drain timestamp ties')
  } finally {
    unsubscribe()
  }

  assert.deepEqual(received.map(row => row.id), rows.map(row => row.id))
  assert.deepEqual(queryEvidence[0].neq, { column: 'sender_id', value: userId })
  assert.deepEqual(queryEvidence[0].orders.map(order => order.column), ['created_at', 'id'])
  assert.equal(queryEvidence[0].limit, 25)
  assert.match(queryEvidence[1].or, /created_at\.gt\..+id\.gt\./)
})

test('MP direct notifications retain the composite keyset order', async () => {
  const userId = '11111111-1111-4111-8111-111111111111'
  const queryEvidence = []
  let queryCount = 0
  const supabase = {
    from(table) {
      assert.equal(table, 'notifications')
      const state = { orders: [], limit: null }
      const query = {
        select() { return query },
        eq() { return query },
        gt() { return query },
        or() { return query },
        order(column, options) {
          state.orders.push({ column, options })
          return query
        },
        limit(value) {
          state.limit = value
          queryEvidence.push(state)
          queryCount += 1
          if (queryCount === 1) {
            return Promise.resolve({
              data: [{
                id: '11111111-1111-4111-8111-111111111111',
                created_at: '2026-07-18T00:00:00.000001Z',
              }],
              error: null,
            })
          }
          return Promise.resolve({ data: [], error: null })
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
      ['function directNotificationPoll(', 'export function directNotificationPoll('],
      ['intervalMs: 20000', 'intervalMs: 0'],
    ],
    {
      useSupabase: () => ({ supabase }),
      platformFetch: globalThis.fetch,
      MESSAGE_FIELDS: 'id, conversation_id, sender_id, created_at',
      BASE_URL: 'https://example.invalid',
    },
    input => preprocessUniPlatform(input, false),
  )

  const unsubscribe = realtime.directNotificationPoll(userId, () => {})
  try {
    await waitUntil(() => queryEvidence.length >= 2, 'notification incremental poll did not run')
  } finally {
    unsubscribe()
  }

  assert.deepEqual(
    queryEvidence[1].orders.map(order => [order.column, order.options?.ascending]),
    [['created_at', true], ['id', true]],
  )
  assert.equal(queryEvidence[1].limit, 25)
})

for (const snapshotTable of ['offers', 'meetups']) {
  test(`${snapshotTable} uses INSERT+UPDATE only and one recurring fallback owner`, async () => {
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
        ['const READY_RECONCILE_RETRY_MS = 1500', 'const READY_RECONCILE_RETRY_MS = 0'],
      ],
      {
        useSupabase: () => ({ supabase: harness.supabase }),
        platformFetch: globalThis.fetch,
        MESSAGE_FIELDS: 'id, conversation_id, sender_id, created_at',
        BASE_URL: 'https://example.invalid',
      },
    )

    let readyAttempts = 0
    let readyCount = 0
    let changeAttempts = 0
    let changeCount = 0
    const unsubscribe = realtime.subscribeToSnapshotChanges({
      topic: `${snapshotTable}:conversation-1`,
      table: snapshotTable,
      filter: 'conversation_id=eq.conversation-1',
      intervalMs: 0,
      onChange: () => {
        changeAttempts += 1
        if (changeAttempts === 1) {
          return Promise.reject(new Error(`${snapshotTable} event snapshot unavailable`))
        }
        changeCount += 1
      },
      onReady: () => {
        readyAttempts += 1
        if (readyAttempts === 1) {
          return Promise.reject(new Error(`${snapshotTable} snapshot unavailable`))
        }
        readyCount += 1
      },
    })
    try {
      harness.status('SUBSCRIBED')
      harness.status('SUBSCRIBED')
      assert.equal(readyAttempts, 1, 'duplicate SUBSCRIBED must not overlap snapshot readiness')
      await waitUntil(() => readyCount === 1, `${snapshotTable} readiness did not retry`)
      assert.equal(readyAttempts, 2)
      assert.equal(readyCount, 1)
      assert.deepEqual(
        harness.listeners.map(listener => listener.filter.event),
        ['INSERT', 'UPDATE'],
      )

      harness.listeners[0].callback({ new: { id: `${snapshotTable}-1` } })
      await waitUntil(
        () => changeCount === 1,
        `${snapshotTable} event snapshot did not retry`,
      )
      assert.equal(changeAttempts, 2)
      harness.listeners[1].callback({ new: { id: `${snapshotTable}-1`, status: 'accepted' } })
      await waitUntil(() => changeCount === 2, `${snapshotTable} update snapshot did not settle`)

      harness.status('CHANNEL_ERROR')
      harness.status('CHANNEL_ERROR')
      assert.equal(harness.removeCount(), 1)
      await waitUntil(() => readyCount === 2, `${snapshotTable} fallback readiness did not settle`)
      assert.equal(readyCount, 2, 'snapshot fallback starts a new reconciliation generation')
      await waitUntil(() => changeCount > 2, `${snapshotTable} fallback timer never reconciled`)

      harness.listeners[0].callback({ new: { id: `stale-${snapshotTable}` } })
      const countBeforeStop = changeCount
      unsubscribe()
      await new Promise(resolve => setTimeout(resolve, 5))
      assert.equal(changeCount, countBeforeStop, 'teardown must clear the recurring snapshot timer')
    } finally {
      unsubscribe()
    }
  })
}

test('mini-program snapshot subscriptions never construct a channel and account transition stops their timer', async () => {
  let activeUserId = '11111111-1111-4111-8111-111111111111'
  let generation = 1
  let clearedSnapshotTimers = 0
  const transitionListeners = new Set()
  const transition = (nextUserId) => {
    activeUserId = nextUserId
    generation += 1
    for (const listener of [...transitionListeners]) listener()
  }
  const realtime = await loadWithRuntime(
    'src/composables/useRealtimeFallback.ts',
    [
      [
        "import { useSupabase, platformFetch } from './useSupabase'",
        'const { useSupabase, platformFetch, trackedSetInterval, trackedClearInterval } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { MESSAGE_FIELDS } from './useMessages.constants'",
        'const { MESSAGE_FIELDS } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { BASE_URL } from '../config/runtime'",
        'const { BASE_URL } = globalThis.__RUNTIME_KEY__',
      ],
      [
        'const timer = setInterval(',
        'const timer = trackedSetInterval(',
      ],
      [
        'clearInterval(timer)',
        'trackedClearInterval(timer)',
      ],
    ],
    {
      useSupabase: () => ({
        supabase: {
          channel() { assert.fail('mini-program snapshot transport must not create a channel') },
        },
      }),
      platformFetch: globalThis.fetch,
      MESSAGE_FIELDS: 'id, conversation_id, sender_id, created_at',
      BASE_URL: 'https://example.invalid',
      trackedSetInterval: (callback, delay) => globalThis.setInterval(callback, delay),
      trackedClearInterval: timer => {
        clearedSnapshotTimers += 1
        globalThis.clearInterval(timer)
      },
      captureActiveAccountRequest: () => ({ userId: activeUserId, generation }),
      isAccountRequestCurrent: token => (
        token?.userId === activeUserId && token?.generation === generation
      ),
      onAccountTransition: listener => {
        transitionListeners.add(listener)
        return () => transitionListeners.delete(listener)
      },
    },
    input => preprocessUniPlatform(input, false),
  )

  let changeCount = 0
  let readyCount = 0
  const unsubscribe = realtime.subscribeToSnapshotChanges({
    topic: 'offers:conversation-mp',
    table: 'offers',
    filter: 'conversation_id=eq.conversation-mp',
    intervalMs: 0,
    onChange: () => { changeCount += 1 },
    onReady: () => { readyCount += 1 },
  })
  await waitUntil(() => changeCount > 0, 'mini-program snapshot timer never fired')
  assert.equal(readyCount, 0, 'cursorless MP snapshot timer must not claim readiness')
  assert.equal(transitionListeners.size, 1)
  const countBeforeStop = changeCount
  transition('22222222-2222-4222-8222-222222222222')
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(changeCount, countBeforeStop)
  assert.equal(clearedSnapshotTimers, 1, 'account transition must clear the live interval')
  assert.equal(transitionListeners.size, 0, 'stopped snapshot transport must detach its transition listener')
  unsubscribe()
})

test('a delayed notification INSERT always heals a torn list/count snapshot', async () => {
  const userId = '11111111-1111-4111-8111-111111111111'
  let activeUserId = userId
  let generation = 1
  let transitionListener = null
  let liveCallback = null
  let transportReadyCallback = null
  let transportReconcileCallback = null
  let transportStops = 0
  let toastCount = 0
  const listReadQueue = []
  const countReadQueue = []
  const mutationQueue = []
  const verificationReadQueue = []
  let listReadCalls = 0
  let countReadCalls = 0
  let mutationCalls = 0
  let verificationReadCalls = 0
  const notificationSupabase = {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: activeUserId } } },
      }),
    },
    from(table) {
      assert.equal(table, 'notifications')
      let operation = 'unknown'
      const query = {
        select(fields, options) {
          operation = options?.head
            ? 'count'
            : fields === 'id, user_id, is_read'
              ? 'verification'
              : 'list'
          return query
        },
        update() {
          operation = 'mutation'
          return query
        },
        delete() {
          operation = 'mutation'
          return query
        },
        eq() { return query },
        order() { return query },
        limit() { return query },
        then(resolvePromise, rejectPromise) {
          if (operation === 'count') {
            countReadCalls += 1
            const pending = countReadQueue.shift()
            assert.ok(pending, 'unexpected notification count read')
            return pending.promise.then(resolvePromise, rejectPromise)
          }
          if (operation === 'mutation') {
            mutationCalls += 1
            const pending = mutationQueue.shift()
            assert.ok(pending, 'unexpected notification mutation')
            return pending.promise.then(resolvePromise, rejectPromise)
          }
          if (operation === 'verification') {
            verificationReadCalls += 1
            const pending = verificationReadQueue.shift()
            assert.ok(pending, 'unexpected notification verification read')
            return pending.promise.then(resolvePromise, rejectPromise)
          }
          return Promise.reject(new Error(`unexpected notification operation: ${operation}`))
            .then(resolvePromise, rejectPromise)
        },
      }
      return query
    },
  }

  const notificationModule = await loadWithRuntime(
    'src/composables/useNotifications.ts',
    [
      [
        "import { ref, watch } from 'vue'",
        'const { ref, watch } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { useSupabase } from './useSupabase'",
        'const { useSupabase } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { useAuth } from './useAuth'",
        'const { useAuth } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { subscribeToUserNotifications } from './useRealtimeFallback'",
        'const { subscribeToUserNotifications } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { pushToast } from './useAppToast'",
        'const { pushToast } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { useI18n } from './useI18n'",
        'const { useI18n } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { invalidateConversations, useMessages } from './useMessages'",
        'const { invalidateConversations, useMessages } = globalThis.__RUNTIME_KEY__',
      ],
      [
        `import {
  captureAccountRequest,
  captureActiveAccountRequest,
  getActiveAccountId,
  isAccountRequestCurrent,
  onAccountTransition,
} from './accountScope'`,
        'const { captureAccountRequest, captureActiveAccountRequest, getActiveAccountId, isAccountRequestCurrent, onAccountTransition } = globalThis.__RUNTIME_KEY__',
      ],
      [
        `import {
  fetchNotificationRowsWithCompatibility,
  notificationDestination,
  notificationIcon,
  notificationToastKind,
  notificationTypeLabelKey,
  type Notification,
} from '../api/notifications'`,
        `const {
  fetchNotificationRowsWithCompatibility,
  notificationDestination,
  notificationIcon,
  notificationToastKind,
  notificationTypeLabelKey,
} = globalThis.__RUNTIME_KEY__
type Notification = any`,
      ],
      [
        'const LIVE_NOTIFICATION_RECONCILE_RETRY_MS = 1500',
        'const LIVE_NOTIFICATION_RECONCILE_RETRY_MS = 0',
      ],
    ],
    {
      ref: value => ({ value }),
      watch: () => () => {},
      useSupabase: () => ({ supabase: notificationSupabase }),
      useAuth: () => ({ currentUser: { value: null } }),
      subscribeToUserNotifications: (_uid, onNew, onReady, onReconcile) => {
        liveCallback = onNew
        transportReadyCallback = onReady
        transportReconcileCallback = onReconcile
        return () => { transportStops += 1 }
      },
      pushToast: () => { toastCount += 1 },
      useI18n: () => ({ t: key => key }),
      invalidateConversations: () => {},
      useMessages: () => ({ fetchConversations: async () => true }),
      captureAccountRequest: uid => ({ userId: uid, generation }),
      captureActiveAccountRequest: () => ({ userId: activeUserId, generation }),
      getActiveAccountId: () => activeUserId,
      isAccountRequestCurrent: token => (
        token?.userId === activeUserId && token?.generation === generation
      ),
      onAccountTransition: listener => {
        transitionListener = listener
        return () => { transitionListener = null }
      },
      fetchNotificationRowsWithCompatibility: async () => {
        listReadCalls += 1
        const pending = listReadQueue.shift()
        assert.ok(pending, 'unexpected notification list read')
        return pending.promise
      },
      notificationDestination: () => ({ url: '/pages/notifications/index', switchTab: false }),
      notificationIcon: () => 'bell',
      notificationToastKind: () => 'info',
      notificationTypeLabelKey: () => 'notif.system',
    },
    input => input
      .replace('const notifications = ref<Notification[]>([])', 'export const notifications = ref<Notification[]>([])')
      .replace('const unreadNotifCount = ref(0)', 'export const unreadNotifCount = ref(0)')
      .replace('async function markReadById(', 'export async function markReadById(')
      .replace('function startNotificationsListener(', 'export function startNotificationsListener(')
      .replace('function stopNotificationsListener()', 'export function stopNotificationsListener()'),
  )

  const firstRow = {
    id: 'notification-after-split-snapshot',
    user_id: userId,
    type: 'system',
    title: 'First',
    body: '',
    is_read: false,
    created_at: '2026-07-30T00:00:00.000Z',
  }
  let overcountAttempts = 0
  notificationModule.notifications.value = []
  // Simulate list-before-commit/count-after-commit. The delayed realtime row
  // pushes the locally-maintained badge to 2 until the post-event snapshot.
  notificationModule.unreadNotifCount.value = 1
  notificationModule.startNotificationsListener(userId, async () => {
    overcountAttempts += 1
    if (overcountAttempts === 1) throw new Error('transient snapshot failure')
    notificationModule.notifications.value = [firstRow]
    notificationModule.unreadNotifCount.value = 1
  })
  liveCallback(firstRow)
  assert.equal(notificationModule.unreadNotifCount.value, 2)
  await waitUntil(
    () => overcountAttempts === 2 && notificationModule.unreadNotifCount.value === 1,
    'post-event notification reconciliation did not retry and heal an overcount',
  )
  assert.equal(toastCount, 1, 'authoritative reconciliation must not replay the live toast')

  const duplicateRow = {
    ...firstRow,
    id: 'notification-before-split-count',
    title: 'Second',
  }
  let undercountAttempts = 0
  // Simulate list-after-commit/count-before-commit. The delayed realtime row
  // de-dupes locally, so only the queued authoritative snapshot can raise 0→1.
  notificationModule.notifications.value = [duplicateRow]
  notificationModule.unreadNotifCount.value = 0
  notificationModule.startNotificationsListener(userId, async () => {
    undercountAttempts += 1
    notificationModule.notifications.value = [duplicateRow]
    notificationModule.unreadNotifCount.value = 1
  })
  liveCallback(duplicateRow)
  assert.equal(notificationModule.unreadNotifCount.value, 0)
  await waitUntil(
    () => undercountAttempts === 1 && notificationModule.unreadNotifCount.value === 1,
    'post-event notification reconciliation did not heal an undercount',
  )
  assert.equal(toastCount, 2, 'a first live delivery still toasts when a snapshot preloaded its row')

  const heldReconcile = deferred()
  let singleFlightAttempts = 0
  notificationModule.startNotificationsListener(userId, async () => {
    singleFlightAttempts += 1
    if (singleFlightAttempts === 1) await heldReconcile.promise
  })
  const burstRow = suffix => ({
    ...firstRow,
    id: `notification-single-flight-${suffix}`,
    title: `Burst ${suffix}`,
  })
  // Match a direct-poll tick: deliver rows, then invoke its authoritative
  // reconcile callback. The queued post-live repair must join that same flight.
  liveCallback(burstRow('a'))
  const transportFlight = transportReconcileCallback()
  await waitUntil(() => singleFlightAttempts === 1, 'transport reconciliation never started')
  liveCallback(burstRow('b'))
  liveCallback(burstRow('c'))
  const joinedFlight = transportReadyCallback()
  assert.equal(joinedFlight, transportFlight, 'transport and live repair must share one flight')
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(singleFlightAttempts, 1, 'events during a pending reconcile started a concurrent snapshot')
  heldReconcile.resolve()
  await transportFlight
  await waitUntil(
    () => singleFlightAttempts === 2,
    'events arriving during a pending reconcile did not schedule one follow-up',
  )
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(singleFlightAttempts, 2, 'a coalesced event burst scheduled more than one follow-up')

  const notificationApi = notificationModule.useNotifications()
  const unreadRow = {
    ...firstRow,
    id: 'notification-read-during-snapshot',
    title: 'Read during snapshot',
  }
  notificationModule.notifications.value = [{ ...unreadRow }]
  notificationModule.unreadNotifCount.value = 1
  const staleReadList = deferred()
  const staleReadCount = deferred()
  const authoritativeReadList = deferred()
  const authoritativeReadCount = deferred()
  listReadQueue.push(staleReadList, authoritativeReadList)
  countReadQueue.push(staleReadCount, authoritativeReadCount)
  mutationQueue.push({ promise: Promise.resolve({ error: null }) })
  const readSnapshot = notificationApi.fetchNotifications()
  await waitUntil(
    () => listReadCalls === 1 && countReadCalls === 1,
    'notification snapshot did not start',
  )
  await notificationApi.markRead(unreadRow.id)
  assert.equal(notificationModule.notifications.value[0].is_read, true)
  assert.equal(
    notificationModule.unreadNotifCount.value,
    1,
    'mark-read must not infer exact badge ownership from the local list row',
  )
  staleReadList.resolve([{ ...unreadRow, is_read: false }])
  staleReadCount.resolve({ count: 1, error: null })
  await waitUntil(
    () => listReadCalls === 2 && countReadCalls === 2,
    'snapshot did not retry after a successful read mutation',
  )
  authoritativeReadList.resolve([{ ...unreadRow, is_read: true }])
  authoritativeReadCount.resolve({ count: 0, error: null })
  assert.equal(await readSnapshot, true)
  assert.equal(notificationModule.notifications.value[0].is_read, true)
  assert.equal(notificationModule.unreadNotifCount.value, 0)

  const deletedRow = {
    ...firstRow,
    id: 'notification-delete-during-snapshot',
    title: 'Delete during snapshot',
  }
  notificationModule.notifications.value = [{ ...deletedRow }]
  notificationModule.unreadNotifCount.value = 1
  const staleDeleteList = deferred()
  const staleDeleteCount = deferred()
  const authoritativeDeleteList = deferred()
  const authoritativeDeleteCount = deferred()
  listReadQueue.push(staleDeleteList, authoritativeDeleteList)
  countReadQueue.push(staleDeleteCount, authoritativeDeleteCount)
  mutationQueue.push({ promise: Promise.resolve({ error: null }) })
  const deleteSnapshot = notificationApi.fetchNotifications()
  await waitUntil(
    () => listReadCalls === 3 && countReadCalls === 3,
    'delete-overlap notification snapshot did not start',
  )
  await notificationApi.deleteNotification(deletedRow.id)
  assert.deepEqual(notificationModule.notifications.value, [])
  assert.equal(
    notificationModule.unreadNotifCount.value,
    1,
    'delete must not infer exact badge ownership from the local list row',
  )
  staleDeleteList.resolve([{ ...deletedRow }])
  staleDeleteCount.resolve({ count: 1, error: null })
  await waitUntil(
    () => listReadCalls === 4 && countReadCalls === 4,
    'snapshot did not retry after a successful delete mutation',
  )
  authoritativeDeleteList.resolve([])
  authoritativeDeleteCount.resolve({ count: 0, error: null })
  assert.equal(await deleteSnapshot, true)
  assert.deepEqual(notificationModule.notifications.value, [])
  assert.equal(notificationModule.unreadNotifCount.value, 0)

  notificationModule.startNotificationsListener(userId)
  const toastCountBeforeDelayedMutations = toastCount
  liveCallback({ ...deletedRow })
  assert.deepEqual(
    notificationModule.notifications.value,
    [],
    'a delayed pre-delete INSERT must not resurrect a successfully deleted row',
  )
  assert.equal(notificationModule.unreadNotifCount.value, 0)
  liveCallback({ ...unreadRow, is_read: false })
  assert.equal(
    notificationModule.notifications.value.find(row => row.id === unreadRow.id)?.is_read,
    true,
    'a delayed pre-read INSERT must not roll a successfully read row back to unread',
  )
  assert.equal(
    toastCount,
    toastCountBeforeDelayedMutations,
    'rows already handled by the user must not produce a delayed first-live toast',
  )

  let mutationReconcileAttempts = 0
  notificationModule.startNotificationsListener(userId, async () => {
    mutationReconcileAttempts += 1
  })
  const preFenceReadRow = {
    ...firstRow,
    id: 'notification-prefence-pending-read',
    title: 'Read before any mark-all fence',
  }
  notificationModule.notifications.value = [{ ...preFenceReadRow }]
  // This count may belong to another unread row omitted from the local list.
  notificationModule.unreadNotifCount.value = 1
  const preFenceReadMutation = deferred()
  mutationQueue.push(preFenceReadMutation)
  const preFenceReadPromise = notificationModule.markReadById(preFenceReadRow.id)
  await waitUntil(() => mutationCalls === 3, 'pre-fence mark-read did not start')
  const toastCountBeforePreFence = toastCount
  const preFenceReadDelivery = liveCallback(preFenceReadRow)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(
    verificationReadCalls,
    0,
    'a pre-fence INSERT must wait while mark-read is pending',
  )
  const preFenceReadVerification = deferred()
  verificationReadQueue.push(preFenceReadVerification)
  preFenceReadMutation.resolve({ error: null })
  await waitUntil(
    () => verificationReadCalls === 1,
    'pre-fence INSERT was not point-read after mark-read settled',
  )
  await waitUntil(
    () => mutationReconcileAttempts === 1,
    'successful toast mark-read did not immediately queue authoritative reconcile',
  )
  preFenceReadVerification.resolve({
    data: [{ id: preFenceReadRow.id, user_id: userId, is_read: true }],
    error: null,
  })
  await Promise.all([preFenceReadPromise, preFenceReadDelivery])
  assert.equal(notificationModule.notifications.value[0]?.is_read, true)
  assert.equal(notificationModule.unreadNotifCount.value, 1)
  assert.equal(toastCount, toastCountBeforePreFence)
  await waitUntil(
    () => mutationReconcileAttempts === 2,
    'classified pre-fence read did not finish its live reconcile',
  )

  const preFenceDeleteRow = {
    ...firstRow,
    id: 'notification-prefence-pending-delete',
    title: 'Deleted before any mark-all fence',
  }
  notificationModule.notifications.value = [{ ...preFenceDeleteRow }]
  notificationModule.unreadNotifCount.value = 1
  const preFenceDeleteMutation = deferred()
  mutationQueue.push(preFenceDeleteMutation)
  const preFenceDeletePromise = notificationApi.deleteNotification(preFenceDeleteRow.id)
  await waitUntil(() => mutationCalls === 4, 'pre-fence delete did not start')
  const preFenceDeleteDelivery = liveCallback(preFenceDeleteRow)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(
    verificationReadCalls,
    1,
    'a pre-fence INSERT must wait while delete is pending',
  )
  const preFenceDeleteVerification = deferred()
  verificationReadQueue.push(preFenceDeleteVerification)
  preFenceDeleteMutation.resolve({ error: null })
  await waitUntil(
    () => verificationReadCalls === 2,
    'pre-fence INSERT was not point-read after delete settled',
  )
  await waitUntil(
    () => mutationReconcileAttempts === 3,
    'successful delete did not immediately queue authoritative reconcile',
  )
  preFenceDeleteVerification.resolve({ data: [], error: null })
  await Promise.all([preFenceDeletePromise, preFenceDeleteDelivery])
  assert.deepEqual(notificationModule.notifications.value, [])
  assert.equal(notificationModule.unreadNotifCount.value, 1)
  assert.equal(toastCount, toastCountBeforePreFence)

  const markAllExistingRow = {
    ...firstRow,
    id: 'notification-mark-all-existing',
    title: 'Existing before mark all',
  }
  const markAllNewRow = {
    ...firstRow,
    id: 'notification-mark-all-new',
    title: 'Arrived after server update',
  }
  notificationModule.notifications.value = [{ ...markAllExistingRow }]
  notificationModule.unreadNotifCount.value = 1
  notificationModule.startNotificationsListener(userId, (isListenerCurrent) => (
    notificationApi.fetchNotifications(isListenerCurrent).then((reconciled) => {
      if (!reconciled && isListenerCurrent()) throw new Error('mark_all_reconcile_failed')
    })
  ))

  const markAllMutation = deferred()
  mutationQueue.push(markAllMutation)
  const markAllPromise = notificationApi.markAllRead()
  await waitUntil(() => mutationCalls === 5, 'mark-all server update did not start')

  const preResponseList = deferred()
  const preResponseCount = deferred()
  listReadQueue.push(preResponseList)
  countReadQueue.push(preResponseCount)
  // A snapshot preloads the post-UPDATE row before its delayed realtime
  // callback. Snapshot application itself must advance the local state
  // revision because the duplicate callback will not mutate the list/count.
  const preResponseRepair = transportReadyCallback()
  await waitUntil(
    () => listReadCalls === 5 && countReadCalls === 5,
    'pre-response notification snapshot did not start',
  )
  preResponseList.resolve([
    { ...markAllNewRow },
    // This request started before the server UPDATE and resolves after it, so
    // its payload can still carry the pre-write unread shape.
    { ...markAllExistingRow, is_read: false },
  ])
  preResponseCount.resolve({ count: 2, error: null })
  await preResponseRepair
  assert.equal(notificationModule.unreadNotifCount.value, 2)
  liveCallback(markAllNewRow)
  notificationModule.stopNotificationsListener()

  const postWriteList = deferred()
  const postWriteCount = deferred()
  listReadQueue.push(postWriteList)
  countReadQueue.push(postWriteCount)
  markAllMutation.resolve({ error: null })
  await waitUntil(
    () => listReadCalls === 6 && countReadCalls === 6,
    'mark-all completion did not request an authoritative post-write snapshot',
  )
  assert.equal(
    notificationModule.unreadNotifCount.value,
    2,
    'a mark-all overlapped by local state changes must preserve the current badge',
  )
  assert.equal(
    notificationModule.notifications.value.find(row => row.id === markAllNewRow.id)?.is_read,
    false,
  )
  assert.equal(
    notificationModule.notifications.value.find(row => row.id === markAllExistingRow.id)?.is_read,
    true,
    'a successful mark-all must locally preserve the rows it definitely updated',
  )
  postWriteList.reject(new Error('post-write snapshot unavailable'))
  postWriteCount.resolve({ count: 2, error: null })
  await markAllPromise
  assert.equal(
    notificationModule.notifications.value.find(row => row.id === markAllNewRow.id)?.is_read,
    false,
  )
  assert.equal(
    notificationModule.notifications.value.find(row => row.id === markAllExistingRow.id)?.is_read,
    true,
  )
  assert.equal(
    notificationModule.unreadNotifCount.value,
    2,
    'a failed post-write reconcile must conservatively preserve the torn count',
  )

  const walFenceReconcileRetry = deferred()
  let walFenceReconcileAttempts = 0
  let walFenceReconciled = false
  notificationModule.startNotificationsListener(userId, async () => {
    walFenceReconcileAttempts += 1
    if (walFenceReconcileAttempts === 1) {
      throw new Error('first WAL-fence reconcile unavailable')
    }
    if (walFenceReconcileAttempts === 2) {
      await walFenceReconcileRetry.promise
      // The exact count belongs to the genuinely new row already represented
      // by the badge, not to the stale covered row in the list.
      notificationModule.unreadNotifCount.value = 1
      walFenceReconciled = true
    }
  })
  const delayedCoveredRow = {
    ...firstRow,
    id: 'notification-mark-all-delayed-covered',
    title: 'Covered before update; WAL arrived late',
  }
  const trulyNewRow = {
    ...firstRow,
    id: 'notification-mark-all-truly-new',
    title: 'Committed after update',
  }
  const toastCountBeforeWalFence = toastCount
  // Model the precise-count counterexample directly: this exact badge belongs
  // to N even though stale H is also present as unread in the local list.
  notificationModule.unreadNotifCount.value = 1
  // A torn snapshot may leave stale H unread in the list while the badge's
  // single count already belongs to genuinely new N. H's point read must fix
  // the row without consuming N's count.
  notificationModule.notifications.value = [
    { ...delayedCoveredRow, is_read: false },
    ...notificationModule.notifications.value,
  ]
  const delayedCoveredVerification = deferred()
  verificationReadQueue.push(delayedCoveredVerification)
  const delayedCoveredDelivery = liveCallback(delayedCoveredRow)
  await waitUntil(
    () => verificationReadCalls === 3,
    'delayed covered INSERT was not checked against current server state',
  )
  delayedCoveredVerification.resolve({
    data: [{ id: delayedCoveredRow.id, user_id: userId, is_read: true }],
    error: null,
  })
  await delayedCoveredDelivery
  assert.equal(
    notificationModule.notifications.value.find(row => (
      row.id === delayedCoveredRow.id
    ))?.is_read,
    true,
    'a current read=true point result did not heal the stale unread list row',
  )
  assert.equal(notificationModule.unreadNotifCount.value, 1)
  assert.equal(toastCount, toastCountBeforeWalFence)
  await waitUntil(
    () => walFenceReconcileAttempts === 2,
    'failed WAL-fence reconcile did not retry',
  )
  assert.equal(
    notificationModule.unreadNotifCount.value,
    1,
    'a failed reconcile must not undercount the genuinely new row',
  )
  walFenceReconcileRetry.resolve()
  await waitUntil(
    () => walFenceReconciled,
    'successful WAL-fence reconcile did not converge the badge',
  )
  assert.equal(notificationModule.unreadNotifCount.value, 1)

  const deletedAfterMarkAllRow = {
    ...firstRow,
    id: 'notification-deleted-after-mark-all',
    title: 'Deleted before delayed WAL delivery',
  }
  notificationModule.notifications.value = [
    { ...deletedAfterMarkAllRow },
    ...notificationModule.notifications.value,
  ]
  const deletedAfterMarkAllVerification = deferred()
  verificationReadQueue.push(deletedAfterMarkAllVerification)
  const deletedAfterMarkAllDelivery = liveCallback(deletedAfterMarkAllRow)
  await waitUntil(
    () => verificationReadCalls === 4,
    'deleted delayed INSERT was not checked against current server state',
  )
  deletedAfterMarkAllVerification.resolve({ data: [], error: null })
  await deletedAfterMarkAllDelivery
  assert.equal(
    notificationModule.notifications.value.some(row => (
      row.id === deletedAfterMarkAllRow.id
    )),
    false,
    'a missing point result did not remove the stale local row',
  )
  assert.equal(notificationModule.unreadNotifCount.value, 1)
  assert.equal(toastCount, toastCountBeforeWalFence)

  const trulyNewVerification = deferred()
  verificationReadQueue.push(trulyNewVerification)
  const trulyNewDelivery = liveCallback(trulyNewRow)
  await waitUntil(
    () => verificationReadCalls === 5,
    'post-update INSERT was not checked against current server state',
  )
  trulyNewVerification.resolve({
    data: [{ id: trulyNewRow.id, user_id: userId, is_read: false }],
    error: null,
  })
  await trulyNewDelivery
  assert.equal(
    notificationModule.notifications.value.find(row => row.id === trulyNewRow.id)?.is_read,
    false,
  )
  assert.equal(notificationModule.unreadNotifCount.value, 2)
  assert.equal(toastCount, toastCountBeforeWalFence + 1)

  const failedVerificationRow = {
    ...firstRow,
    id: 'notification-mark-all-verification-retry',
    title: 'Verification retries without a permanent lock',
  }
  const failedVerification = deferred()
  verificationReadQueue.push(failedVerification)
  const failedDelivery = liveCallback(failedVerificationRow)
  await waitUntil(
    () => verificationReadCalls === 6,
    'verification failure case did not start',
  )
  failedVerification.reject(new Error('verification unavailable'))
  await assert.rejects(failedDelivery, /verification unavailable/)
  assert.equal(
    notificationModule.notifications.value.some(row => row.id === failedVerificationRow.id),
    false,
  )
  assert.equal(notificationModule.unreadNotifCount.value, 2)
  assert.equal(toastCount, toastCountBeforeWalFence + 1)

  const retriedVerification = deferred()
  verificationReadQueue.push(retriedVerification)
  const retriedDelivery = liveCallback(failedVerificationRow)
  await waitUntil(
    () => verificationReadCalls === 7,
    'failed verification remained permanently locked',
  )
  retriedVerification.resolve({
    data: [{ id: failedVerificationRow.id, user_id: userId, is_read: false }],
    error: null,
  })
  await retriedDelivery
  assert.equal(notificationModule.unreadNotifCount.value, 3)
  assert.equal(toastCount, toastCountBeforeWalFence + 2)

  const readDuringPointRow = {
    ...firstRow,
    id: 'notification-read-during-point-read',
    title: 'Read while point read is pending',
  }
  const stalePointBeforeRead = deferred()
  verificationReadQueue.push(stalePointBeforeRead)
  const readDuringPointDelivery = liveCallback(readDuringPointRow)
  await waitUntil(
    () => verificationReadCalls === 8,
    'read-race point verification did not start',
  )
  const readDuringPointMutation = deferred()
  mutationQueue.push(readDuringPointMutation)
  const readDuringPointPromise = notificationApi.markRead(readDuringPointRow.id)
  await waitUntil(() => mutationCalls === 6, 'overlapping mark-read did not start')
  stalePointBeforeRead.resolve({
    data: [{ id: readDuringPointRow.id, user_id: userId, is_read: false }],
    error: null,
  })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(
    notificationModule.notifications.value.some(row => row.id === readDuringPointRow.id),
    false,
    'a stale point result escaped while mark-read was still pending',
  )
  const currentPointAfterRead = deferred()
  verificationReadQueue.push(currentPointAfterRead)
  readDuringPointMutation.resolve({ error: null })
  await waitUntil(
    () => verificationReadCalls === 9,
    'point verification did not retry after mark-read settled',
  )
  currentPointAfterRead.resolve({
    data: [{ id: readDuringPointRow.id, user_id: userId, is_read: true }],
    error: null,
  })
  await Promise.all([readDuringPointPromise, readDuringPointDelivery])
  assert.equal(
    notificationModule.notifications.value.some(row => row.id === readDuringPointRow.id),
    false,
  )
  assert.equal(toastCount, toastCountBeforeWalFence + 2)

  const deleteDuringPointRow = {
    ...firstRow,
    id: 'notification-delete-during-point-read',
    title: 'Deleted while point read is pending',
  }
  const stalePointBeforeDelete = deferred()
  verificationReadQueue.push(stalePointBeforeDelete)
  const deleteDuringPointDelivery = liveCallback(deleteDuringPointRow)
  await waitUntil(
    () => verificationReadCalls === 10,
    'delete-race point verification did not start',
  )
  const deleteDuringPointMutation = deferred()
  mutationQueue.push(deleteDuringPointMutation)
  const deleteDuringPointPromise = notificationApi.deleteNotification(
    deleteDuringPointRow.id,
  )
  await waitUntil(() => mutationCalls === 7, 'overlapping delete did not start')
  stalePointBeforeDelete.resolve({
    data: [{ id: deleteDuringPointRow.id, user_id: userId, is_read: false }],
    error: null,
  })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(
    notificationModule.notifications.value.some(row => (
      row.id === deleteDuringPointRow.id
    )),
    false,
    'a stale point result escaped while delete was still pending',
  )
  const currentPointAfterDelete = deferred()
  verificationReadQueue.push(currentPointAfterDelete)
  deleteDuringPointMutation.resolve({ error: null })
  await waitUntil(
    () => verificationReadCalls === 11,
    'point verification did not retry after delete settled',
  )
  currentPointAfterDelete.resolve({ data: [], error: null })
  await Promise.all([deleteDuringPointPromise, deleteDuringPointDelivery])
  assert.equal(
    notificationModule.notifications.value.some(row => (
      row.id === deleteDuringPointRow.id
    )),
    false,
  )
  assert.equal(toastCount, toastCountBeforeWalFence + 2)

  const markAllDuringPointRow = {
    ...firstRow,
    id: 'notification-mark-all-during-point-read',
    title: 'Covered by mark-all while point read is pending',
  }
  const stalePointBeforeMarkAll = deferred()
  verificationReadQueue.push(stalePointBeforeMarkAll)
  const markAllDuringPointDelivery = liveCallback(markAllDuringPointRow)
  await waitUntil(
    () => verificationReadCalls === 12,
    'mark-all-race point verification did not start',
  )
  const overlappingMarkAllMutation = deferred()
  mutationQueue.push(overlappingMarkAllMutation)
  const overlappingMarkAllPromise = notificationApi.markAllRead()
  await waitUntil(() => mutationCalls === 8, 'overlapping mark-all did not start')
  stalePointBeforeMarkAll.resolve({
    data: [{ id: markAllDuringPointRow.id, user_id: userId, is_read: false }],
    error: null,
  })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(
    notificationModule.notifications.value.some(row => (
      row.id === markAllDuringPointRow.id
    )),
    false,
    'a stale point result escaped while mark-all was still pending',
  )
  const currentPointAfterMarkAll = deferred()
  const overlappingPostWriteList = deferred()
  const overlappingPostWriteCount = deferred()
  verificationReadQueue.push(currentPointAfterMarkAll)
  listReadQueue.push(overlappingPostWriteList)
  countReadQueue.push(overlappingPostWriteCount)
  overlappingMarkAllMutation.resolve({ error: null })
  await waitUntil(
    () => verificationReadCalls === 13,
    'point verification did not retry after mark-all settled',
  )
  await waitUntil(
    () => listReadCalls === 7 && countReadCalls === 7,
    'overlapping mark-all did not start its post-write repair',
  )
  currentPointAfterMarkAll.resolve({
    data: [{ id: markAllDuringPointRow.id, user_id: userId, is_read: true }],
    error: null,
  })
  overlappingPostWriteList.reject(new Error('overlap post-write unavailable'))
  overlappingPostWriteCount.resolve({ count: 0, error: null })
  await Promise.all([overlappingMarkAllPromise, markAllDuringPointDelivery])
  assert.equal(
    notificationModule.notifications.value.some(row => (
      row.id === markAllDuringPointRow.id
    )),
    false,
  )
  assert.equal(toastCount, toastCountBeforeWalFence + 2)

  const failedMutationRow = {
    ...firstRow,
    id: 'notification-mutation-failure-releases-fence',
    title: 'Still unread after failed mutation',
  }
  const stalePointBeforeFailedMutation = deferred()
  verificationReadQueue.push(stalePointBeforeFailedMutation)
  const failedMutationDelivery = liveCallback(failedMutationRow)
  await waitUntil(
    () => verificationReadCalls === 14,
    'failed-mutation point verification did not start',
  )
  const failedMutation = deferred()
  mutationQueue.push(failedMutation)
  const failedMutationPromise = notificationApi.markRead(failedMutationRow.id)
  await waitUntil(() => mutationCalls === 9, 'failing mark-read did not start')
  stalePointBeforeFailedMutation.resolve({
    data: [{ id: failedMutationRow.id, user_id: userId, is_read: false }],
    error: null,
  })
  const currentPointAfterFailedMutation = deferred()
  verificationReadQueue.push(currentPointAfterFailedMutation)
  failedMutation.resolve({ error: new Error('mark-read unavailable') })
  await assert.rejects(failedMutationPromise, /mark-read unavailable/)
  await waitUntil(
    () => verificationReadCalls === 15,
    'a failed mutation left point verification permanently fenced',
  )
  currentPointAfterFailedMutation.resolve({
    data: [{ id: failedMutationRow.id, user_id: userId, is_read: false }],
    error: null,
  })
  await failedMutationDelivery
  assert.equal(
    notificationModule.notifications.value.find(row => (
      row.id === failedMutationRow.id
    ))?.is_read,
    false,
  )
  assert.equal(notificationModule.unreadNotifCount.value, 1)
  assert.equal(toastCount, toastCountBeforeWalFence + 3)

  let staleAccountAttempts = 0
  const staleAccountList = deferred()
  const staleAccountCount = deferred()
  listReadQueue.push(staleAccountList)
  countReadQueue.push(staleAccountCount)
  notificationModule.startNotificationsListener(userId, (isListenerCurrent) => {
    staleAccountAttempts += 1
    return notificationApi.fetchNotifications(isListenerCurrent).then((reconciled) => {
      if (!reconciled && isListenerCurrent()) throw new Error('stale_listener_reconcile_failed')
    })
  })
  const staleAccountVerification = deferred()
  verificationReadQueue.push(staleAccountVerification)
  const staleAccountDelivery = liveCallback({
    ...firstRow,
    id: 'notification-cancelled-by-account-switch',
  })
  await waitUntil(
    () => verificationReadCalls === 16,
    'account-switch point verification did not start',
  )
  const staleAccountSnapshot = transportReadyCallback()
  await waitUntil(
    () => listReadCalls === 8 && countReadCalls === 8,
    'listener-owned notification snapshot did not start',
  )
  activeUserId = '22222222-2222-4222-8222-222222222222'
  generation += 1
  transitionListener()
  staleAccountVerification.resolve({
    data: [{
      id: 'notification-cancelled-by-account-switch',
      user_id: userId,
      is_read: false,
    }],
    error: null,
  })
  staleAccountList.resolve([{ ...firstRow, id: 'stale-account-row' }])
  staleAccountCount.resolve({ count: 1, error: null })
  await Promise.allSettled([staleAccountDelivery, staleAccountSnapshot])
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(staleAccountAttempts, 1)
  assert.deepEqual(notificationModule.notifications.value, [])
  assert.equal(notificationModule.unreadNotifCount.value, 0)
  assert.equal(listReadCalls, 8, 'stopped listener must not start a follow-up snapshot')
  assert.equal(transportStops, 8)
})

test('Presence duplicate readiness tracks once and transport failure stays offline/no-op', async () => {
  const listeners = []
  let statusCallback = null
  let presenceState = {}
  let trackCount = 0
  let sendCount = 0
  let removeCount = 0
  const channel = {
    on(event, filter, callback) {
      listeners.push({ event, filter, callback })
      return channel
    },
    subscribe(callback) {
      statusCallback = callback
      return channel
    },
    presenceState() {
      return presenceState
    },
    track() {
      trackCount += 1
      return Promise.resolve('ok')
    },
    send() {
      sendCount += 1
      return Promise.resolve('ok')
    },
  }
  const supabase = {
    channel: () => channel,
    removeChannel(value) {
      assert.equal(value, channel)
      removeCount += 1
    },
  }
  const presenceModule = await loadWithRuntime(
    'src/composables/usePresence.ts',
    [
      ["import { ref, type Ref } from 'vue'", 'const { ref } = globalThis.__RUNTIME_KEY__'],
      [
        "import { useSupabase } from './useSupabase'",
        'const { useSupabase } = globalThis.__RUNTIME_KEY__',
      ],
    ],
    {
      ref: value => ({ value }),
      useSupabase: () => ({ supabase }),
    },
    input => preprocessUniPlatform(input, true),
  )

  const peerId = '33333333-3333-4333-8333-333333333333'
  let typingCount = 0
  const onlineStates = []
  const presence = presenceModule.usePresence().subscribeConversationPresence(
    '22222222-2222-4222-8222-222222222222',
    peerId,
    () => { typingCount += 1 },
    online => onlineStates.push(online),
  )
  const presenceListener = listeners.find(listener => listener.event === 'presence')
  const typingListener = listeners.find(listener => listener.event === 'broadcast')

  statusCallback('SUBSCRIBED')
  statusCallback('SUBSCRIBED')
  assert.equal(trackCount, 1)
  await Promise.resolve()

  presenceState = { [peerId]: [{ user_id: peerId }] }
  presenceListener.callback()
  typingListener.callback({
    payload: {
      conversation_id: '22222222-2222-4222-8222-222222222222',
      user_id: peerId,
    },
  })
  presence.sendTyping()
  assert.equal(presence.peerOnline.value, true)
  assert.equal(typingCount, 1)
  assert.equal(sendCount, 1)

  statusCallback('CHANNEL_ERROR')
  presenceListener.callback()
  typingListener.callback({
    payload: {
      conversation_id: '22222222-2222-4222-8222-222222222222',
      user_id: peerId,
    },
  })
  presence.sendTyping()
  assert.equal(presence.peerOnline.value, false)
  assert.equal(typingCount, 1)
  assert.equal(sendCount, 1)
  assert.deepEqual(onlineStates, [true, false])

  presence.unsubscribe()
  assert.equal(removeCount, 1)
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
    let snapshotOptions = null
    let snapshotStopped = false
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
        subscribeToSnapshotChanges: options => {
          snapshotOptions = options
          return () => { snapshotStopped = true }
        },
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
    assert.equal(snapshotOptions.topic, `${config.table}:conversation-1`)
    assert.equal(snapshotOptions.table, config.table)
    assert.equal(snapshotOptions.filter, 'conversation_id=eq.conversation-1')
    assert.equal(snapshotOptions.intervalMs, 8000)
    snapshotOptions.onReady()
    assert.equal(readyCount, 1)
    snapshotOptions.onChange()
    assert.equal(refetchCount, 1)
    unsubscribe()
    assert.equal(snapshotStopped, true)
  })
}

async function loadUseMessagesConsumer(supabase, runtime = {}) {
  return loadWithRuntime(
    'src/composables/useMessages.ts',
    [
      ["import { ref } from 'vue'", 'const { ref } = globalThis.__RUNTIME_KEY__'],
      [
        "import { useSupabase } from './useSupabase'",
        'const { useSupabase } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { useModeration } from './useModeration'",
        'const { useModeration } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { useI18n } from './useI18n'",
        'const { useI18n } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { subscribeToConversation as subscribeToConversationFallback } from './useRealtimeFallback'",
        'const { subscribeToConversationFallback } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { MESSAGE_FIELDS } from './useMessages.constants'",
        'const { MESSAGE_FIELDS } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { friendlyErrorMessage } from '../utils'",
        'const { friendlyErrorMessage } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { checkContent, isLocalDuplicate, clearLocalDuplicate, remoteModerate } from '../utils/contentSafety'",
        'const { checkContent, isLocalDuplicate, clearLocalDuplicate, remoteModerate } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { mpTextGate } from './useWechatSecCheck'",
        'const { mpTextGate } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { parseStickerToken } from '../components/stickers/registry'",
        'const { parseStickerToken } = globalThis.__RUNTIME_KEY__',
      ],
      [
        /import \{\s*isDefinitiveMutationRejection,[\s\S]*?\} from '\.\.\/api\/mutationCommit'/,
        `const {
          isDefinitiveMutationRejection,
          mutationCommitState,
          mutationOutcomeError,
          shouldCompensateMutationFailure,
        } = globalThis.__RUNTIME_KEY__`,
      ],
      [
        /import \{\s*captureAccountRequest,[\s\S]*?\} from '\.\/accountScope'/,
        `const {
          captureAccountRequest,
          captureActiveAccountRequest,
          getActiveAccountId,
          isAccountRequestCurrent,
          onAccountTransition,
        } = globalThis.__RUNTIME_KEY__`,
      ],
      [
        "import { createClientMessageId } from '../api/clientMessageId'",
        'const { createClientMessageId } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { fetchArchivedConversationIds } from '../api/conversationArchive'",
        'const { fetchArchivedConversationIds } = globalThis.__RUNTIME_KEY__',
      ],
      [
        /import \{\s*sanitizeConversationResources,[\s\S]*?\} from '\.\.\/utils\/publicResource'/,
        'const { sanitizeConversationResources, sanitizeMessageResources } = globalThis.__RUNTIME_KEY__',
      ],
    ],
    {
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
      captureAccountRequest: userId => ({ userId, generation: 1 }),
      captureActiveAccountRequest: () => ({
        userId: '11111111-1111-4111-8111-111111111111',
        generation: 1,
      }),
      getActiveAccountId: () => '11111111-1111-4111-8111-111111111111',
      isAccountRequestCurrent: () => true,
      onAccountTransition: () => () => {},
      createClientMessageId: () => '11111111-1111-4111-8111-111111111111',
      fetchArchivedConversationIds: async () => new Set(),
      sanitizeConversationResources: row => row,
      sanitizeMessageResources: row => row,
      ...runtime,
    },
  )
}

test('a superseded message snapshot reports failure when its newer owner also fails', async () => {
  const pending = []
  const supabase = {
    from(table) {
      const query = {
        select() { return query },
        eq() { return query },
        or() { return query },
        order() {
          if (table === 'conversations') {
            return Promise.resolve({
              data: null,
              error: { code: '503', message: 'conversation snapshot failed' },
            })
          }
          assert.equal(table, 'messages')
          return query
        },
        limit() {
          const request = deferred()
          pending.push(request)
          return request.promise
        },
      }
      return query
    },
  }
  const module = await loadWithRuntime(
    'src/composables/useMessages.ts',
    [
      ["import { ref } from 'vue'", 'const { ref } = globalThis.__RUNTIME_KEY__'],
      [
        "import { useSupabase } from './useSupabase'",
        'const { useSupabase } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { useModeration } from './useModeration'",
        'const { useModeration } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { useI18n } from './useI18n'",
        'const { useI18n } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { subscribeToConversation as subscribeToConversationFallback } from './useRealtimeFallback'",
        'const { subscribeToConversationFallback } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { MESSAGE_FIELDS } from './useMessages.constants'",
        'const { MESSAGE_FIELDS } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { friendlyErrorMessage } from '../utils'",
        'const { friendlyErrorMessage } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { checkContent, isLocalDuplicate, clearLocalDuplicate, remoteModerate } from '../utils/contentSafety'",
        'const { checkContent, isLocalDuplicate, clearLocalDuplicate, remoteModerate } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { mpTextGate } from './useWechatSecCheck'",
        'const { mpTextGate } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { parseStickerToken } from '../components/stickers/registry'",
        'const { parseStickerToken } = globalThis.__RUNTIME_KEY__',
      ],
      [
        /import \{\s*isDefinitiveMutationRejection,[\s\S]*?\} from '\.\.\/api\/mutationCommit'/,
        `const {
          isDefinitiveMutationRejection,
          mutationCommitState,
          mutationOutcomeError,
          shouldCompensateMutationFailure,
        } = globalThis.__RUNTIME_KEY__`,
      ],
      [
        /import \{\s*captureAccountRequest,[\s\S]*?\} from '\.\/accountScope'/,
        `const {
          captureAccountRequest,
          captureActiveAccountRequest,
          getActiveAccountId,
          isAccountRequestCurrent,
          onAccountTransition,
        } = globalThis.__RUNTIME_KEY__`,
      ],
      [
        "import { createClientMessageId } from '../api/clientMessageId'",
        'const { createClientMessageId } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { fetchArchivedConversationIds } from '../api/conversationArchive'",
        'const { fetchArchivedConversationIds } = globalThis.__RUNTIME_KEY__',
      ],
      [
        /import \{\s*sanitizeConversationResources,[\s\S]*?\} from '\.\.\/utils\/publicResource'/,
        'const { sanitizeConversationResources, sanitizeMessageResources } = globalThis.__RUNTIME_KEY__',
      ],
    ],
    {
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
      captureAccountRequest: userId => ({ userId, generation: 1 }),
      captureActiveAccountRequest: () => ({
        userId: '11111111-1111-4111-8111-111111111111',
        generation: 1,
      }),
      getActiveAccountId: () => '11111111-1111-4111-8111-111111111111',
      isAccountRequestCurrent: () => true,
      onAccountTransition: () => () => {},
      createClientMessageId: () => '11111111-1111-4111-8111-111111111111',
      fetchArchivedConversationIds: async () => new Set(),
      sanitizeConversationResources: row => row,
      sanitizeMessageResources: row => row,
    },
  )
  const api = module.useMessages()

  const readySnapshot = api.fetchMessages('conversation-consumer-race')
  const newerSnapshot = api.fetchMessages('conversation-consumer-race')
  assert.equal(pending.length, 2)
  pending[0].resolve({
    data: [{
      id: '11111111-1111-4111-8111-111111111111',
      conversation_id: 'conversation-consumer-race',
      created_at: '2026-07-30T00:00:00.000Z',
    }],
    error: null,
  })
  assert.equal(
    await readySnapshot,
    false,
    'a superseded snapshot must not satisfy the authoritative ready barrier',
  )
  pending[1].resolve({ data: null, error: { code: '503', message: 'newer failed' } })
  await assert.rejects(newerSnapshot)

  const retry = api.fetchMessages('conversation-consumer-race')
  pending[2].resolve({
    data: [{
      id: '22222222-2222-4222-8222-222222222222',
      conversation_id: 'conversation-consumer-race',
      created_at: '2026-07-30T00:00:01.000Z',
    }],
    error: null,
  })
  assert.equal(await retry, true)
  assert.deepEqual(api.messages.value.map(row => row.id), [
    '22222222-2222-4222-8222-222222222222',
  ])

  const previousUni = globalThis.uni
  globalThis.uni = { showToast() {} }
  try {
    assert.equal(
      await api.fetchConversations(
        '11111111-1111-4111-8111-111111111111',
        { force: true },
      ),
      false,
      'a handled conversation-list failure must remain visible to the ready barrier',
    )
  } finally {
    if (previousUni === undefined) delete globalThis.uni
    else globalThis.uni = previousUni
  }
})

test('an older HTTP message snapshot cannot roll back a later realtime read update', async () => {
  const conversationId = 'conversation-live-read'
  const messageId = '33333333-3333-4333-8333-333333333333'
  const snapshot = deferred()
  let liveUpdate
  const supabase = {
    from(table) {
      assert.equal(table, 'messages')
      const query = {
        select() { return query },
        eq() { return query },
        order() { return query },
        limit() { return snapshot.promise },
      }
      return query
    },
  }
  const module = await loadUseMessagesConsumer(supabase, {
    subscribeToConversationFallback: (_conversationId, _onInsert, onUpdate) => {
      liveUpdate = onUpdate
      return () => {}
    },
  })
  const api = module.useMessages()

  const unsubscribe = api.subscribeToMessages(
    conversationId,
    () => {},
    updated => {
      const index = api.messages.value.findIndex(row => row.id === updated.id)
      assert.ok(index >= 0)
      api.messages.value[index] = updated
      api.messages.value = [...api.messages.value]
    },
  )
  api.messages.value = [{
    id: messageId,
    conversation_id: conversationId,
    sender_id: '22222222-2222-4222-8222-222222222222',
    content: 'already seen',
    message_type: 'text',
    is_read: false,
    created_at: '2026-07-30T00:00:00.000Z',
  }]

  const staleFetch = api.fetchMessages(conversationId)
  assert.equal(typeof liveUpdate, 'function')
  liveUpdate({
    ...api.messages.value[0],
    is_read: true,
  })
  assert.equal(api.messages.value[0].is_read, true)

  snapshot.resolve({
    data: [{
      ...api.messages.value[0],
      is_read: false,
    }],
    error: null,
  })
  assert.equal(await staleFetch, true)
  assert.equal(
    api.messages.value[0].is_read,
    true,
    'the accepted realtime UPDATE is newer than the in-flight HTTP snapshot',
  )
  unsubscribe()
})

test('an older conversation snapshot cannot roll back a later live preview and order', async () => {
  const userId = '11111111-1111-4111-8111-111111111111'
  const otherId = '22222222-2222-4222-8222-222222222222'
  const liveConversationId = 'conversation-live-preview'
  const priorNewestId = 'conversation-prior-newest'
  const conversationSnapshot = deferred()
  let conversationPageReads = 0
  const supabase = {
    from(table) {
      assert.equal(table, 'conversations')
      const query = {
        select() { return query },
        or() { return query },
        gt(column) {
          assert.equal(column, 'id')
          return query
        },
        order() {
          return query
        },
        limit() {
          return query
        },
        then(resolve, reject) {
          conversationPageReads += 1
          const result = conversationPageReads === 1
            ? conversationSnapshot.promise
            : Promise.resolve({ data: [], error: null })
          return result.then(resolve, reject)
        },
      }
      return query
    },
  }
  const module = await loadUseMessagesConsumer(supabase)
  const api = module.useMessages()
  const staleRows = () => [
    {
      id: priorNewestId,
      item_id: 'item-2',
      buyer_id: userId,
      seller_id: otherId,
      last_message_at: '2026-07-30T00:00:02.000Z',
      created_at: '2026-07-30T00:00:00.000Z',
      is_pinned_buyer: false,
      is_pinned_seller: false,
      is_muted_buyer: false,
      is_muted_seller: false,
      latest_messages: [{
        id: 'message-prior-newest',
        content: 'previous newest',
        message_type: 'text',
        created_at: '2026-07-30T00:00:02.000Z',
      }],
    },
    {
      id: liveConversationId,
      item_id: 'item-1',
      buyer_id: userId,
      seller_id: otherId,
      last_message_at: '2026-07-30T00:00:00.000Z',
      created_at: '2026-07-30T00:00:00.000Z',
      is_pinned_buyer: false,
      is_pinned_seller: false,
      is_muted_buyer: false,
      is_muted_seller: false,
      latest_messages: [{
        id: 'message-live-old-snapshot',
        content: 'old snapshot preview',
        message_type: 'text',
        created_at: '2026-07-30T00:00:00.000Z',
      }],
    },
  ]
  api.conversations.value = staleRows()

  const staleFetch = api.fetchConversations(userId, { force: true })
  assert.equal(module.applyIncomingMessage({
    conversation_id: liveConversationId,
    content: 'new live preview',
    message_type: 'text',
    created_at: '2026-07-30T00:00:03.000Z',
  }, userId), true)
  assert.deepEqual(
    api.conversations.value.map(row => row.id),
    [liveConversationId, priorNewestId],
  )

  conversationSnapshot.resolve({
    data: staleRows().sort((a, b) => a.id.localeCompare(b.id)),
    error: null,
  })
  await staleFetch

  assert.deepEqual(
    api.conversations.value.map(row => row.id),
    [liveConversationId, priorNewestId],
    'the conversation that received the live row must remain first',
  )
  assert.equal(
    api.conversations.value[0].last_message_preview,
    'new live preview',
    'the accepted live preview must survive the older HTTP snapshot',
  )
  assert.equal(
    api.conversations.value[0].last_message_at,
    '2026-07-30T00:00:03.000Z',
  )
})

test('a slower earlier inbox callback cannot roll a conversation preview backward', async () => {
  const userId = '11111111-1111-4111-8111-111111111111'
  const conversationId = 'conversation-live-callback-order'
  const module = await loadUseMessagesConsumer({ from: () => assert.fail('no snapshot expected') })
  const api = module.useMessages()
  api.conversations.value = [{
    id: conversationId,
    item_id: 'item-1',
    buyer_id: userId,
    seller_id: '22222222-2222-4222-8222-222222222222',
    last_message_at: '2026-07-30T00:00:00.000Z',
    created_at: '2026-07-30T00:00:00.000Z',
    is_pinned_buyer: false,
    is_pinned_seller: false,
    is_muted_buyer: false,
    is_muted_seller: false,
  }]

  assert.equal(module.applyIncomingMessage({
    conversation_id: conversationId,
    content: 'newer callback finished first',
    message_type: 'text',
    created_at: '2026-07-30T00:00:02.000Z',
  }, userId, 2), true)
  assert.equal(module.applyIncomingMessage({
    conversation_id: conversationId,
    content: 'older callback finished late',
    message_type: 'text',
    created_at: '2026-07-30T00:00:01.000Z',
  }, userId, 1), true)

  assert.equal(api.conversations.value[0].last_message_preview, 'newer callback finished first')
  assert.equal(api.conversations.value[0].last_message_at, '2026-07-30T00:00:02.000Z')
})

async function loadFreshUseUnread(runtime) {
  return loadWithRuntime(
    'src/composables/useUnread.ts',
    [
      [
        "import { ref, watch } from 'vue'",
        'const { ref, watch } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { useSupabase } from './useSupabase'",
        'const { useSupabase } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { useAuth } from './useAuth'",
        'const { useAuth } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { useI18n } from './useI18n'",
        'const { useI18n } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { subscribeToUserInbox } from './useRealtimeFallback'",
        'const { subscribeToUserInbox } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { invalidateConversations, applyIncomingMessage, useMessages } from './useMessages'",
        'const { invalidateConversations, applyIncomingMessage, useMessages } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { useModeration } from './useModeration'",
        'const { useModeration } = globalThis.__RUNTIME_KEY__',
      ],
      [
        /import \{\s*captureAccountRequest,[\s\S]*?\} from '\.\/accountScope'/,
        `const {
          captureAccountRequest,
          getActiveAccountId,
          isAccountRequestCurrent,
          onAccountTransition,
        } = globalThis.__RUNTIME_KEY__`,
      ],
      [
        "import { fetchArchivedConversationIds } from '../api/conversationArchive'",
        'const { fetchArchivedConversationIds } = globalThis.__RUNTIME_KEY__',
      ],
    ],
    runtime,
  )
}

function withUnreadWitness(conversation, hasUnread = true) {
  return {
    ...conversation,
    unread_messages: hasUnread ? [{ id: `unread-${conversation.id}` }] : [],
  }
}

function createUnreadSnapshotSupabase(readSnapshot) {
  return {
    from(table) {
      assert.equal(
        table,
        'conversations',
        'the badge snapshot must not fetch a globally-limited messages list',
      )
      let selectFields = ''
      let participantFilter = ''
      let embeddedReadFilter = false
      let embeddedSenderFilter = ''
      let afterId = null
      let topLevelLimit = null
      const query = {
        select(fields) {
          selectFields = String(fields)
          return query
        },
        or(filter) {
          participantFilter = filter
          return query
        },
        eq(column, value) {
          assert.equal(column, 'unread_messages.is_read')
          assert.equal(value, false)
          embeddedReadFilter = true
          return query
        },
        neq(column, value) {
          assert.equal(column, 'unread_messages.sender_id')
          embeddedSenderFilter = value
          return query
        },
        gt(column, value) {
          assert.equal(column, 'id')
          afterId = value
          return query
        },
        order(column, options) {
          assert.equal(column, 'id')
          assert.deepEqual(options, { ascending: true })
          return query
        },
        limit(value, options) {
          if (!options?.referencedTable) {
            topLevelLimit = value
            return query
          }
          assert.match(selectFields, /unread_messages:messages\(id\)/)
          assert.doesNotMatch(selectFields, /messages!inner/)
          assert.equal(embeddedReadFilter, true)
          assert.ok(embeddedSenderFilter)
          assert.equal(
            participantFilter,
            `buyer_id.eq.${embeddedSenderFilter},seller_id.eq.${embeddedSenderFilter}`,
          )
          assert.equal(value, 1)
          assert.deepEqual(options, { referencedTable: 'unread_messages' })
          assert.equal(topLevelLimit, 500)
          if (afterId !== null) {
            return Promise.resolve({ data: [], error: null })
          }
          return Promise.resolve(readSnapshot({
            userId: embeddedSenderFilter,
            selectFields,
          })).then(result => ({
            ...result,
            data: Array.isArray(result?.data)
              ? [...result.data].sort((a, b) => a.id.localeCompare(b.id))
              : result?.data,
          }))
        },
      }
      return query
    },
  }
}

test('useUnread does not lose a later conversation behind 500 unread rows', async () => {
  const userId = '11111111-1111-4111-8111-111111111111'
  const heavyConversation = {
    id: 'conversation-with-500-unread',
    buyer_id: userId,
    seller_id: '22222222-2222-4222-8222-222222222222',
    is_muted_buyer: false,
    is_muted_seller: false,
  }
  const laterConversation = {
    id: 'conversation-after-row-500',
    buyer_id: userId,
    seller_id: '33333333-3333-4333-8333-333333333333',
    is_muted_buyer: false,
    is_muted_seller: false,
  }
  const authoritativeUnreadRows = [
    ...Array.from({ length: 501 }, (_, index) => ({
      id: `heavy-unread-${index}`,
      conversation_id: heavyConversation.id,
    })),
    {
      id: 'later-conversation-unread',
      conversation_id: laterConversation.id,
    },
  ]
  const supabase = createUnreadSnapshotSupabase(() => Promise.resolve({
    data: [heavyConversation, laterConversation].map(conversation => ({
      ...conversation,
      // Model PostgREST's per-parent embedded limit: 502 authoritative rows
      // collapse to one existence witness for each conversation.
      unread_messages: authoritativeUnreadRows
        .filter(row => row.conversation_id === conversation.id)
        .slice(0, 1),
    })),
    error: null,
  }))
  const module = await loadFreshUseUnread({
    ref: value => ({ value }),
    watch: () => () => {},
    useSupabase: () => ({ supabase }),
    useAuth: () => ({ currentUser: { value: { id: userId } } }),
    useI18n: () => ({ t: key => key }),
    subscribeToUserInbox: () => () => {},
    invalidateConversations: () => {},
    applyIncomingMessage: () => false,
    useMessages: () => ({ fetchConversations: async () => true }),
    useModeration: () => ({
      blockedIds: { value: new Set() },
      ensureLoaded: async () => ({ ok: true }),
    }),
    captureAccountRequest: requestedUserId => ({
      userId: requestedUserId,
      generation: 1,
    }),
    getActiveAccountId: () => userId,
    isAccountRequestCurrent: token => token?.userId === userId,
    onAccountTransition: () => () => {},
    fetchArchivedConversationIds: async () => new Set(),
  })

  const unread = module.useUnread()
  const result = await unread.refreshUnreadCount()

  assert.equal(result.reconciled, true)
  assert.equal(unread.unreadCount.value, 2)
  assert.deepEqual(
    [...unread.unreadConvIds.value].sort(),
    [heavyConversation.id, laterConversation.id].sort(),
  )
})

test('useUnread filters embedded unread witnesses after moderation and archive boundaries', async () => {
  const userId = '11111111-1111-4111-8111-111111111111'
  const blockedUserId = '55555555-5555-4555-8555-555555555555'
  const rows = [
    withUnreadWitness({
      id: 'visible-unread',
      buyer_id: userId,
      seller_id: '22222222-2222-4222-8222-222222222222',
      is_muted_buyer: false,
      is_muted_seller: false,
    }),
    withUnreadWitness({
      id: 'muted-unread',
      buyer_id: userId,
      seller_id: '33333333-3333-4333-8333-333333333333',
      is_muted_buyer: true,
      is_muted_seller: false,
    }),
    withUnreadWitness({
      id: 'muted-zero-unread',
      buyer_id: userId,
      seller_id: '44444444-4444-4444-8444-444444444444',
      is_muted_buyer: true,
      is_muted_seller: false,
    }, false),
    withUnreadWitness({
      id: 'blocked-unread',
      buyer_id: userId,
      seller_id: blockedUserId,
      is_muted_buyer: false,
      is_muted_seller: false,
    }),
    withUnreadWitness({
      id: 'archived-unread',
      buyer_id: userId,
      seller_id: '66666666-6666-4666-8666-666666666666',
      is_muted_buyer: false,
      is_muted_seller: false,
    }),
    withUnreadWitness({
      id: 'visible-zero-unread',
      buyer_id: userId,
      seller_id: '77777777-7777-4777-8777-777777777777',
      is_muted_buyer: false,
      is_muted_seller: false,
    }, false),
  ]
  const supabase = createUnreadSnapshotSupabase(() => Promise.resolve({
    data: rows,
    error: null,
  }))
  const module = await loadFreshUseUnread({
    ref: value => ({ value }),
    watch: () => () => {},
    useSupabase: () => ({ supabase }),
    useAuth: () => ({ currentUser: { value: { id: userId } } }),
    useI18n: () => ({ t: key => key }),
    subscribeToUserInbox: () => () => {},
    invalidateConversations: () => {},
    applyIncomingMessage: () => false,
    useMessages: () => ({ fetchConversations: async () => true }),
    useModeration: () => ({
      blockedIds: { value: new Set([blockedUserId]) },
      ensureLoaded: async () => ({ ok: true }),
    }),
    captureAccountRequest: requestedUserId => ({
      userId: requestedUserId,
      generation: 1,
    }),
    getActiveAccountId: () => userId,
    isAccountRequestCurrent: token => token?.userId === userId,
    onAccountTransition: () => () => {},
    fetchArchivedConversationIds: async () => new Set(['archived-unread']),
  })

  const unread = module.useUnread()
  const result = await unread.refreshUnreadCount()

  assert.equal(result.reconciled, true)
  assert.equal(unread.unreadCount.value, 1)
  assert.deepEqual(
    [...unread.unreadConvIds.value].sort(),
    ['muted-unread', 'visible-unread'],
  )
  assert.deepEqual(
    [...unread.mutedConvIds.value].sort(),
    ['muted-unread', 'muted-zero-unread'],
    'a muted conversation with zero unread must remain in the left-embedded snapshot',
  )
  assert.equal(unread.hasMutedUnread.value, true)
})

test('useUnread prevents a superseded badge callback from reaching inbox preview state', async () => {
  const userId = '11111111-1111-4111-8111-111111111111'
  const conversation = {
    id: 'conversation-live-callback-wiring',
    buyer_id: userId,
    seller_id: '22222222-2222-4222-8222-222222222222',
    is_muted_buyer: false,
    is_muted_seller: false,
  }
  const olderBadge = deferred()
  const newerBadge = deferred()
  const applied = []
  let conversationQueryCount = 0
  let onNewMessage

  const unreadConversation = withUnreadWitness(conversation)
  const supabase = createUnreadSnapshotSupabase(() => {
    conversationQueryCount += 1
    if (conversationQueryCount === 1) {
      return Promise.resolve({ data: [unreadConversation], error: null })
    }
    if (conversationQueryCount === 2) return olderBadge.promise
    if (conversationQueryCount === 3) return newerBadge.promise
    return Promise.resolve({ data: [unreadConversation], error: null })
  })

  const module = await loadFreshUseUnread({
    ref: value => ({ value }),
    watch: (state, callback, options) => {
      if (options?.immediate) callback(state.value, undefined)
      return () => {}
    },
    useSupabase: () => ({ supabase }),
    useAuth: () => ({ currentUser: { value: { id: userId } } }),
    useI18n: () => ({ t: key => key }),
    subscribeToUserInbox: (_userId, onNew) => {
      onNewMessage = onNew
      return () => {}
    },
    invalidateConversations: () => {},
    applyIncomingMessage: (newMsg, receivedUserId, deliveryVersion) => {
      assert.equal(receivedUserId, userId)
      applied.push({
        content: newMsg.content,
        deliveryVersion,
      })
      return true
    },
    useMessages: () => ({
      fetchConversations: async () => assert.fail('loaded conversation must not refetch'),
    }),
    useModeration: () => ({
      blockedIds: { value: new Set() },
      ensureLoaded: async () => ({ ok: true }),
    }),
    captureAccountRequest: requestedUserId => ({
      userId: requestedUserId,
      generation: 1,
    }),
    getActiveAccountId: () => userId,
    isAccountRequestCurrent: token => token?.userId === userId,
    onAccountTransition: () => () => {},
    fetchArchivedConversationIds: async () => new Set(),
  })

  const previousUni = globalThis.uni
  globalThis.uni = { showToast() {} }
  const unread = module.useUnread()
  try {
    assert.equal(typeof onNewMessage, 'function')
    const older = onNewMessage({
      id: '33333333-3333-4333-8333-333333333331',
      conversation_id: conversation.id,
      sender_id: conversation.seller_id,
      content: 'older callback finished late',
      message_type: 'text',
      is_read: false,
      created_at: '2026-07-30T00:00:01.000Z',
    })
    const newer = onNewMessage({
      id: '33333333-3333-4333-8333-333333333332',
      conversation_id: conversation.id,
      sender_id: conversation.seller_id,
      content: 'newer callback finished first',
      message_type: 'text',
      is_read: false,
      created_at: '2026-07-30T00:00:02.000Z',
    })

    newerBadge.resolve({ data: [unreadConversation], error: null })
    await newer
    olderBadge.resolve({ data: [unreadConversation], error: null })
    await older

    assert.deepEqual(applied, [
      {
        content: 'newer callback finished first',
        deliveryVersion: 2,
      },
    ], 'the older callback must stop before it can apply stale preview state')
  } finally {
    unread.stopListening()
    if (previousUni === undefined) delete globalThis.uni
    else globalThis.uni = previousUni
  }
})

test('a new-conversation live row retries after its first forced fetch fails', async () => {
  const userId = '11111111-1111-4111-8111-111111111111'
  let onNewMessage
  let forcedFetchAttempts = 0
  const supabase = createUnreadSnapshotSupabase(() => (
    Promise.resolve({ data: [], error: null })
  ))
  const module = await loadWithRuntime(
    'src/composables/useUnread.ts',
    [
      [
        'const LIVE_INBOX_RECONCILE_RETRY_MS = 1500',
        'const LIVE_INBOX_RECONCILE_RETRY_MS = 0',
      ],
      [
        "import { ref, watch } from 'vue'",
        'const { ref, watch } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { useSupabase } from './useSupabase'",
        'const { useSupabase } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { useAuth } from './useAuth'",
        'const { useAuth } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { useI18n } from './useI18n'",
        'const { useI18n } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { subscribeToUserInbox } from './useRealtimeFallback'",
        'const { subscribeToUserInbox } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { invalidateConversations, applyIncomingMessage, useMessages } from './useMessages'",
        'const { invalidateConversations, applyIncomingMessage, useMessages } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { useModeration } from './useModeration'",
        'const { useModeration } = globalThis.__RUNTIME_KEY__',
      ],
      [
        /import \{\s*captureAccountRequest,[\s\S]*?\} from '\.\/accountScope'/,
        `const {
          captureAccountRequest,
          getActiveAccountId,
          isAccountRequestCurrent,
          onAccountTransition,
        } = globalThis.__RUNTIME_KEY__`,
      ],
      [
        "import { fetchArchivedConversationIds } from '../api/conversationArchive'",
        'const { fetchArchivedConversationIds } = globalThis.__RUNTIME_KEY__',
      ],
    ],
    {
      ref: value => ({ value }),
      watch: (state, callback, options) => {
        if (options?.immediate) callback(state.value, undefined)
        return () => {}
      },
      useSupabase: () => ({ supabase }),
      useAuth: () => ({ currentUser: { value: { id: userId } } }),
      useI18n: () => ({ t: key => key }),
      subscribeToUserInbox: (_userId, onNew) => {
        onNewMessage = onNew
        return () => {}
      },
      invalidateConversations: () => {},
      applyIncomingMessage: () => false,
      useMessages: () => ({
        fetchConversations: async (_userId, options) => {
          assert.equal(options?.force, true)
          forcedFetchAttempts += 1
          return forcedFetchAttempts > 1
        },
      }),
      useModeration: () => ({
        blockedIds: { value: new Set() },
        ensureLoaded: async () => ({ ok: true }),
      }),
      captureAccountRequest: requestedUserId => ({
        userId: requestedUserId,
        generation: 1,
      }),
      getActiveAccountId: () => userId,
      isAccountRequestCurrent: token => token?.userId === userId,
      onAccountTransition: () => () => {},
      fetchArchivedConversationIds: async () => new Set(),
    },
  )

  const previousUni = globalThis.uni
  globalThis.uni = { showToast() {} }
  try {
    module.useUnread()
    assert.equal(typeof onNewMessage, 'function')
    await onNewMessage({
      id: '44444444-4444-4444-8444-444444444444',
      conversation_id: 'brand-new-conversation',
      sender_id: '22222222-2222-4222-8222-222222222222',
      content: 'first message',
      message_type: 'text',
      is_read: false,
      created_at: '2026-07-30T00:00:00.000Z',
    })
    assert.equal(forcedFetchAttempts, 1)
    await waitUntil(
      () => forcedFetchAttempts >= 2,
      'the failed forced fetch was never retried',
      100,
    )
    assert.equal(forcedFetchAttempts, 2)
  } finally {
    if (previousUni === undefined) delete globalThis.uni
    else globalThis.uni = previousUni
  }
})

test('a live inbox badge failure schedules authoritative recovery without another event', async () => {
  const userId = '11111111-1111-4111-8111-111111111111'
  let onNewMessage
  let snapshotReads = 0
  let conversationReconciles = 0
  const conversationRow = {
    id: 'conversation-badge-retry',
    buyer_id: userId,
    seller_id: '22222222-2222-4222-8222-222222222222',
    is_muted_buyer: false,
    is_muted_seller: false,
  }
  const snapshotResponses = [
    { data: [withUnreadWitness(conversationRow, false)], error: null },
    { data: null, error: { code: '503', message: 'badge temporarily unavailable' } },
    { data: [withUnreadWitness(conversationRow)], error: null },
  ]
  const supabase = createUnreadSnapshotSupabase(() => {
    const response = snapshotResponses[snapshotReads++]
    assert.ok(response, `unexpected unread snapshot ${snapshotReads}`)
    return Promise.resolve(response)
  })
  const module = await loadWithRuntime(
    'src/composables/useUnread.ts',
    [
      [
        'const LIVE_INBOX_RECONCILE_RETRY_MS = 1500',
        'const LIVE_INBOX_RECONCILE_RETRY_MS = 0',
      ],
      [
        "import { ref, watch } from 'vue'",
        'const { ref, watch } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { useSupabase } from './useSupabase'",
        'const { useSupabase } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { useAuth } from './useAuth'",
        'const { useAuth } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { useI18n } from './useI18n'",
        'const { useI18n } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { subscribeToUserInbox } from './useRealtimeFallback'",
        'const { subscribeToUserInbox } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { invalidateConversations, applyIncomingMessage, useMessages } from './useMessages'",
        'const { invalidateConversations, applyIncomingMessage, useMessages } = globalThis.__RUNTIME_KEY__',
      ],
      [
        "import { useModeration } from './useModeration'",
        'const { useModeration } = globalThis.__RUNTIME_KEY__',
      ],
      [
        /import \{\s*captureAccountRequest,[\s\S]*?\} from '\.\/accountScope'/,
        `const {
          captureAccountRequest,
          getActiveAccountId,
          isAccountRequestCurrent,
          onAccountTransition,
        } = globalThis.__RUNTIME_KEY__`,
      ],
      [
        "import { fetchArchivedConversationIds } from '../api/conversationArchive'",
        'const { fetchArchivedConversationIds } = globalThis.__RUNTIME_KEY__',
      ],
    ],
    {
      ref: value => ({ value }),
      watch: (state, callback, options) => {
        if (options?.immediate) callback(state.value, undefined)
        return () => {}
      },
      useSupabase: () => ({ supabase }),
      useAuth: () => ({ currentUser: { value: { id: userId } } }),
      useI18n: () => ({ t: key => key }),
      subscribeToUserInbox: (_userId, onNew) => {
        onNewMessage = onNew
        return () => {}
      },
      invalidateConversations: () => {},
      applyIncomingMessage: () => true,
      useMessages: () => ({
        fetchConversations: async () => {
          conversationReconciles += 1
          return true
        },
      }),
      useModeration: () => ({
        blockedIds: { value: new Set() },
        ensureLoaded: async () => ({ ok: true }),
      }),
      captureAccountRequest: requestedUserId => ({
        userId: requestedUserId,
        generation: 1,
      }),
      getActiveAccountId: () => userId,
      isAccountRequestCurrent: token => token?.userId === userId,
      onAccountTransition: () => () => {},
      fetchArchivedConversationIds: async () => new Set(),
    },
  )

  const previousUni = globalThis.uni
  globalThis.uni = { showToast() {} }
  try {
    module.useUnread()
    await waitUntil(() => snapshotReads === 1, 'initial badge snapshot did not settle')
    await onNewMessage({
      id: '33333333-3333-4333-8333-333333333333',
      conversation_id: conversationRow.id,
      sender_id: conversationRow.seller_id,
      content: 'retry badge',
      message_type: 'text',
      is_read: false,
      created_at: '2026-07-30T00:00:01.000Z',
    })
    assert.equal(snapshotReads, 2)
    await waitUntil(
      () => snapshotReads >= 3 && conversationReconciles >= 1,
      'failed live badge state was not reconciled without another incoming event',
      100,
    )
  } finally {
    if (previousUni === undefined) delete globalThis.uni
    else globalThis.uni = previousUni
  }
})

test('useUnread preserves the last badge on query failure and rejects a late prior-account result', async () => {
  const userA = '11111111-1111-4111-8111-111111111111'
  const userB = '22222222-2222-4222-8222-222222222222'
  const currentUser = { value: { id: userA } }
  const transitionListeners = new Set()
  const staleASnapshot = deferred()
  let activeUserId = userA
  let activeGeneration = 1
  let snapshotRead = 0

  const conversationA = {
      id: 'conversation-a',
      buyer_id: userA,
      seller_id: '33333333-3333-4333-8333-333333333333',
      is_muted_buyer: false,
      is_muted_seller: false,
  }
  const conversationsB = [
      {
        id: 'conversation-b-1',
        buyer_id: userB,
        seller_id: '44444444-4444-4444-8444-444444444444',
        is_muted_buyer: false,
        is_muted_seller: false,
      },
      {
        id: 'conversation-b-2',
        buyer_id: userB,
        seller_id: '55555555-5555-4555-8555-555555555555',
        is_muted_buyer: false,
        is_muted_seller: false,
      },
  ]
  const snapshotResponses = [
    Promise.resolve({
      data: [withUnreadWitness(conversationA)],
      error: null,
    }),
    Promise.resolve({
      data: null,
      error: { code: '503', message: 'unread snapshot unavailable' },
    }),
    staleASnapshot.promise,
    Promise.resolve({
      data: conversationsB.map(row => withUnreadWitness(row)),
      error: null,
    }),
  ]
  const supabase = createUnreadSnapshotSupabase(({ userId }) => {
    const response = snapshotResponses[snapshotRead++]
    assert.ok(response, `unexpected unread snapshot ${snapshotRead}`)
    assert.equal(userId, snapshotRead <= 3 ? userA : userB)
    return response
  })

  const module = await loadFreshUseUnread({
    ref: value => ({ value }),
    // Drive refreshUnreadCount directly so the two asynchronous boundaries stay
    // deterministic; watcher lifecycle has separate regression coverage.
    watch: () => () => {},
    useSupabase: () => ({ supabase }),
    useAuth: () => ({ currentUser }),
    useI18n: () => ({ t: key => key }),
    subscribeToUserInbox: () => () => {},
    invalidateConversations: () => {},
    applyIncomingMessage: () => false,
    useMessages: () => ({
      fetchConversations: async () => true,
    }),
    useModeration: () => ({
      blockedIds: { value: new Set() },
      ensureLoaded: async () => ({ ok: true }),
    }),
    captureAccountRequest: requestedUserId => ({
      userId: requestedUserId,
      generation: activeGeneration,
    }),
    getActiveAccountId: () => activeUserId,
    isAccountRequestCurrent: token => (
      token?.userId === activeUserId
      && token?.generation === activeGeneration
    ),
    onAccountTransition: listener => {
      transitionListeners.add(listener)
      return () => transitionListeners.delete(listener)
    },
    fetchArchivedConversationIds: async () => new Set(),
  })
  const unread = module.useUnread()

  const firstA = await unread.refreshUnreadCount()
  assert.equal(firstA.reconciled, true)
  assert.equal(unread.unreadCount.value, 1)
  assert.deepEqual([...unread.unreadConvIds.value], ['conversation-a'])

  const failedA = await unread.refreshUnreadCount()
  assert.equal(failedA.reconciled, false)
  assert.equal(
    unread.unreadCount.value,
    1,
    'a failed embedded unread query must preserve the last authoritative badge',
  )
  assert.deepEqual([...unread.unreadConvIds.value], ['conversation-a'])

  const lateA = unread.refreshUnreadCount()
  await waitUntil(
    () => snapshotRead === 3,
    'the prior-account refresh did not reach its delayed unread snapshot',
  )

  activeUserId = userB
  activeGeneration += 1
  currentUser.value = { id: userB }
  for (const listener of [...transitionListeners]) listener()

  const freshB = await unread.refreshUnreadCount()
  assert.equal(freshB.reconciled, true)
  assert.equal(unread.unreadCount.value, 2)
  assert.deepEqual(
    [...unread.unreadConvIds.value].sort(),
    ['conversation-b-1', 'conversation-b-2'],
  )

  staleASnapshot.resolve({
    data: [withUnreadWitness(conversationA)],
    error: null,
  })
  const staleAResult = await lateA
  assert.equal(staleAResult.reconciled, false)
  assert.equal(
    unread.unreadCount.value,
    2,
    'a late A response must not replace B state',
  )
  assert.deepEqual(
    [...unread.unreadConvIds.value].sort(),
    ['conversation-b-1', 'conversation-b-2'],
  )
})

test('markConversationUnread surfaces a failed latest-message lookup', async () => {
  let updateCalls = 0
  const supabase = {
    from(table) {
      assert.equal(table, 'messages')
      const query = {
        select() { return query },
        update() { updateCalls += 1; return query },
        eq() { return query },
        neq() { return query },
        order() { return query },
        limit() { return query },
        maybeSingle() {
          return Promise.resolve({
            data: null,
            error: { code: '503', message: 'latest message unavailable' },
          })
        },
      }
      return query
    },
  }
  const module = await loadUseMessagesConsumer(supabase)
  await assert.rejects(
    module.useMessages().markConversationUnread(
      'conversation-mark-unread',
      '11111111-1111-4111-8111-111111111111',
    ),
    error => error?.code === '503',
  )
  assert.equal(updateCalls, 0)
})

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
  assert.match(setup, /const reconcileMessagesFromSubscription = \(\) => \{[\s\S]*?return fetchMessages\(options\.id\)/)
  assert.match(
    setup,
    /fetchMessages\(options\.id\)\.then\(\(reconciled\) => \{\s*if \(!reconciled && isCurrentThreadSetup\(\)\) \{\s*throw new Error\('message_reconcile_failed'\)/,
  )
  assert.match(
    setup,
    /subscribeToMessages\([\s\S]*reconcileMessagesFromSubscription,\s*reconcileMessagesFromSubscription/,
  )
  assert.match(setup, /const reconcileOffersFromSubscription = \(\) => \{[\s\S]*?return fetchOffers\(options\.id\)/)
  assert.match(setup, /const refreshOffersFromChange = \(\) => reconcileOffersFromSubscription\(\)/)
  assert.match(setup, /subscribeToOffers\(\s*options\.id,\s*refreshOffersFromChange,\s*reconcileOffersFromSubscription,/)
  assert.match(setup, /const reconcileMeetupsFromSubscription = \(\) => \{[\s\S]*?return fetchMeetups\(options\.id\)/)
  assert.match(setup, /const refreshMeetupsFromChange = \(\) => reconcileMeetupsFromSubscription\(\)/)
  assert.match(setup, /subscribeToMeetups\(\s*options\.id,\s*refreshMeetupsFromChange,\s*reconcileMeetupsFromSubscription,/)
  assert.ok(setup.indexOf('offersUnsub = subscribeToOffers(') < setup.indexOf('try { await fetchOffers(options.id) }'))
  assert.ok(setup.indexOf('meetupsUnsub = subscribeToMeetups(') < setup.indexOf('try { await fetchMeetups(options.id) }'))

  assert.match(messages, /async function fetchMessages\(conversationId: string\): Promise<boolean>/)
  assert.match(messages, /requestId !== latestMessagesRequestId[\s\S]*?\) return false/)
  const subscribeMessagesStart = messages.indexOf('function subscribeToMessages(')
  const subscribeMessagesEnd = messages.indexOf('\n  async function markAsRead(', subscribeMessagesStart)
  const subscribeMessagesBlock = messages.slice(subscribeMessagesStart, subscribeMessagesEnd)
  assert.ok(subscribeMessagesStart >= 0 && subscribeMessagesEnd > subscribeMessagesStart)
  assert.match(subscribeMessagesBlock, /onReady\?: \(\) => void \| Promise<void>/)
  assert.match(subscribeMessagesBlock, /onReconcile\?: \(\) => void \| Promise<void>/)
  assert.match(subscribeMessagesBlock, /onReady \? \(\) => \{[\s\S]*?activeMessagesConversationId !== conversationId[\s\S]*?!isAccountRequestCurrent\(accountToken\)[\s\S]*?return onReady\(\)/)
  assert.match(subscribeMessagesBlock, /onReconcile \? \(\) => \{[\s\S]*?activeMessagesConversationId !== conversationId[\s\S]*?!isAccountRequestCurrent\(accountToken\)[\s\S]*?return onReconcile\(\)/)

  const directPollStart = realtime.indexOf('function directConversationPoll(')
  const directPollEnd = realtime.indexOf('\nfunction directInboxPoll(', directPollStart)
  const directPollBlock = realtime.slice(directPollStart, directPollEnd)
  assert.ok(directPollStart >= 0 && directPollEnd > directPollStart)
  assert.match(directPollBlock, /onReady\?: ReconcileCallback,/)
  assert.match(directPollBlock, /onReconcile\?: ReconcileCallback,/)
  assert.match(directPollBlock, /await onReady\?\.\(\)[\s\S]*?readySettled = true/)
  assert.match(directPollBlock, /await onReconcile\?\.\(\)/)

  const subscribeConversationStart = realtime.indexOf('export function subscribeToConversation(')
  const subscribeConversationEnd = realtime.indexOf('\n/*\n * In-app notification feed', subscribeConversationStart)
  const subscribeConversationBlock = realtime.slice(subscribeConversationStart, subscribeConversationEnd)
  assert.ok(subscribeConversationStart >= 0 && subscribeConversationEnd > subscribeConversationStart)
  assert.match(subscribeConversationBlock, /scope: 'conversation',[\s\S]*?onReady: markReady,[\s\S]*?onReconcile,[\s\S]*?onCircuitOpen: onFailure/)
  assert.match(subscribeConversationBlock, /directConversationPoll\([\s\S]*?onReady,[\s\S]*?onReconcile/)
})

test('consumer readiness requires both inbox and notification snapshots to apply', () => {
  const messages = source('src/composables/useMessages.ts')
  const unread = source('src/composables/useUnread.ts')
  const notifications = source('src/composables/useNotifications.ts')

  assert.match(messages, /async function fetchConversations\([\s\S]*?\): Promise<boolean>/)
  assert.match(messages, /latest_messages:messages\(id, content, message_type, created_at\)/)
  assert.match(messages, /\.limit\(1, \{ referencedTable: 'latest_messages' \}\)/)
  assert.doesNotMatch(messages, /\.in\('conversation_id', ids\)/)
  assert.match(messages, /requestId !== latestConversationsRequestId\) return false/)
  assert.match(unread, /const applied = seq === unreadSeq && isAccountRequestCurrent\(token\)/)
  const inboxReconcileStart = unread.indexOf('const reconcileInboxFromSubscription = () => {')
  const inboxReconcileEnd = unread.indexOf('\n    const stopTransport = subscribeToUserInbox(', inboxReconcileStart)
  const inboxReconcileBlock = unread.slice(inboxReconcileStart, inboxReconcileEnd)
  assert.ok(inboxReconcileStart >= 0 && inboxReconcileEnd > inboxReconcileStart)
  assert.match(inboxReconcileBlock, /return Promise\.all\(\[/)
  assert.match(inboxReconcileBlock, /\.then\(\(\[unreadState, conversationsReconciled\]\) => \{[\s\S]*?!unreadState\.reconciled \|\| !conversationsReconciled/)
  const inboxListenerStart = unread.indexOf('const stopTransport = subscribeToUserInbox(')
  const inboxListenerEnd = unread.indexOf('\n    inboxUnsub = () => {', inboxListenerStart)
  const inboxListenerBlock = unread.slice(inboxListenerStart, inboxListenerEnd)
  assert.ok(inboxListenerStart >= 0 && inboxListenerEnd > inboxListenerStart)
  assert.match(
    inboxListenerBlock,
    /const deliveryVersion = \+\+inboxDeliveryVersion[\s\S]*?await refreshUnreadCount\(\)[\s\S]*?if \(!reconciled\) queueInboxReconcileRetry\(\)[\s\S]*?applyIncomingMessage\([\s\S]*?deliveryVersion/,
  )
  assert.match(notifications, /async function fetchNotifications\([\s\S]*?ownerIsCurrent: \(\) => boolean = \(\) => true,[\s\S]*?\): Promise<boolean>/)
  assert.match(notifications, /requestId !== latestNotificationFetchId\) return false/)
  const notificationListenerStart = notifications.indexOf('function startNotificationsListener(')
  const notificationListenerEnd = notifications.indexOf('\nfunction stopNotificationsListener()', notificationListenerStart)
  const notificationListenerBlock = notifications.slice(notificationListenerStart, notificationListenerEnd)
  assert.ok(notificationListenerStart >= 0 && notificationListenerEnd > notificationListenerStart)
  assert.match(notificationListenerBlock, /const runAuthoritativeReconcile = \(\): Promise<void> \| undefined => \{[\s\S]*?if \(reconcileFlight\) return reconcileFlight[\s\S]*?onReady\(isListenerCurrent\)/)
  assert.match(notificationListenerBlock, /const reconcileNotificationsFromSubscription = \(\) => \([\s\S]*?runAuthoritativeReconcile\(\)/)
  assert.match(notificationListenerBlock, /handleIncoming\(row\)[\s\S]*?listenerLiveVersion \+= 1[\s\S]*?queueLiveReconcile\(\)/)
  for (const [startMarker, endMarker] of [
    ['async function markReadById(', '\nfunction handleIncoming('],
    ['async function markRead(id: string)', '\n  async function deleteNotification('],
    ['async function deleteNotification(', '\n  function clearNotifications('],
  ]) {
    const start = notifications.indexOf(startMarker)
    const end = notifications.indexOf(endMarker, start)
    const mutationBlock = notifications.slice(start, end)
    assert.ok(start >= 0 && end > start)
    assert.match(mutationBlock, /requestNotificationReconcile\?\.\(token\.userId\)/)
    assert.doesNotMatch(mutationBlock, /unreadNotifCount\.value\s*=/)
  }

  const notificationWatchStart = notifications.indexOf('watch(currentUser, (u, prev) => {')
  const notificationWatchEnd = notifications.indexOf('\n    }, { immediate: true })', notificationWatchStart)
  const notificationWatchBlock = notifications.slice(notificationWatchStart, notificationWatchEnd)
  assert.ok(notificationWatchStart >= 0 && notificationWatchEnd > notificationWatchStart)
  assert.match(notificationWatchBlock, /startNotificationsListener\(u\.id, \(isListenerCurrent\) => \{[\s\S]*?return fetchNotifications\(isListenerCurrent\)\.then\(\(reconciled\) => \{[\s\S]*?throw new Error\('notification_reconcile_failed'\)/)
})
