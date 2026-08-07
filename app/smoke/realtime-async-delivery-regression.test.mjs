import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fallbackSource = readFileSync(
  resolve(appRoot, 'src/composables/useRealtimeFallback.ts'),
  'utf8',
)
const USER_A = '11111111-1111-4111-8111-111111111111'
const USER_B = '22222222-2222-4222-8222-222222222222'
let runtimeSequence = 0

function deferred() {
  let resolvePromise
  let rejectPromise
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

async function waitUntil(condition, message, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(message)
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

function preprocessUniPlatform(input, isH5) {
  const enabled = [true]
  const output = []
  for (const line of input.split('\n')) {
    const directive = line.match(
      /^\s*\/\/\s*#(ifdef|ifndef|endif)(?:\s+(\S+))?\s*$/,
    )
    if (directive) {
      if (directive[1] === 'endif') {
        assert.ok(enabled.length > 1, 'unbalanced uni-app #endif')
        enabled.pop()
      } else {
        const platformMatches = directive[2] === 'H5' ? isH5 : false
        enabled.push(
          enabled.at(-1)
          && (directive[1] === 'ifdef'
            ? platformMatches
            : !platformMatches),
        )
      }
      continue
    }
    if (enabled.at(-1)) output.push(line)
  }
  assert.equal(enabled.length, 1, 'unbalanced uni-app platform directives')
  return output.join('\n')
}

async function loadFallback({
  isH5,
  runtime,
  replacements = [],
}) {
  const runtimeKey = `__realtime_async_delivery_${++runtimeSequence}`
  // These cases are about delivery ordering, not observability; the fallback
  // takeover still reports, so give it a sink rather than a real Sentry client.
  globalThis[runtimeKey] = { captureException: () => {}, ...runtime }
  let input = fallbackSource
    .replace(
      "import { useSupabase, platformFetch } from './useSupabase'",
      `const { useSupabase, platformFetch } = globalThis.${runtimeKey}`,
    )
    .replace(
      "import { MESSAGE_FIELDS } from './useMessages.constants'",
      `const { MESSAGE_FIELDS } = globalThis.${runtimeKey}`,
    )
    .replace(
      "import { BASE_URL } from '../config/runtime'",
      `const { BASE_URL } = globalThis.${runtimeKey}`,
    )
    .replace(
      "import { readBoundedJson } from '../api/responseBody'",
      `const { readBoundedJson } = globalThis.${runtimeKey}`,
    )
    .replace(
      "import { startPostgresChangesRealtimeChannel } from '../api/privateRealtime'",
      `const { startPostgresChangesRealtimeChannel } = globalThis.${runtimeKey}`,
    )
    .replace(
      /import \{\s*captureActiveAccountRequest,\s*isAccountRequestCurrent,\s*onAccountTransition,\s*\} from '\.\/accountScope'/,
      `const {
        captureActiveAccountRequest,
        isAccountRequestCurrent,
        onAccountTransition,
      } = globalThis.${runtimeKey}`,
    )
    .replace(
      "import { captureException } from '../utils/sentry'",
      `const { captureException } = globalThis.${runtimeKey}`,
    )

  for (const [from, to] of replacements) input = input.replace(from, to)
  input = preprocessUniPlatform(input, isH5)
  const compiled = ts.transpileModule(input, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText
  try {
    return await import(
      `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
    )
  } finally {
    delete globalThis[runtimeKey]
  }
}

function baseRuntime(overrides = {}) {
  const token = { userId: USER_A, generation: 1 }
  return {
    useSupabase: () => ({ supabase: {} }),
    platformFetch: globalThis.fetch,
    MESSAGE_FIELDS: 'id, conversation_id, sender_id, created_at',
    BASE_URL: 'https://example.invalid',
    readBoundedJson: response => response.json(),
    startPostgresChangesRealtimeChannel: () => () => {},
    captureActiveAccountRequest: () => token,
    isAccountRequestCurrent: candidate => (
      candidate?.userId === token.userId
      && candidate?.generation === token.generation
    ),
    onAccountTransition: () => () => {},
    ...overrides,
  }
}

const authenticatedSession = () => ({
  data: {
    session: {
      user: { id: USER_A },
      access_token: 'test-jwt',
    },
  },
})

test('long poll retries async consumer rejection without spending its transport circuit', async () => {
  const requests = []
  const attempts = []
  const delivered = []
  let failuresRemaining = 2
  const seedCursor =
    '2026-07-31T00:00:00.000Z|11111111-1111-4111-8111-111111111111'
  const row = {
    id: '22222222-2222-4222-8222-222222222222',
    conversation_id: 'conversation-async-long-poll',
    sender_id: USER_B,
    created_at: '2026-07-31T00:00:01.000Z',
  }
  const supabase = {
    auth: { getSession: async () => authenticatedSession() },
  }
  const fallback = await loadFallback({
    isH5: false,
    runtime: baseRuntime({
      useSupabase: () => ({ supabase }),
      platformFetch: async (input) => {
        const pending = deferred()
        requests.push({ url: new URL(String(input)), pending })
        return pending.promise
      },
    }),
    replacements: [
      [/scheduleTick\(1500\)/g, 'scheduleTick(0)'],
      ['scheduleTick(50)', 'scheduleTick(0)'],
    ],
  })
  const response = (rows, nextSince) => new Response(JSON.stringify({
    rows,
    next_since: nextSince,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

  const stop = fallback.subscribeToConversation(
    row.conversation_id,
    async deliveredRow => {
      attempts.push(deliveredRow.id)
      await Promise.resolve()
      if (failuresRemaining > 0) {
        failuresRemaining -= 1
        throw new Error('async consumer unavailable')
      }
      delivered.push(deliveredRow.id)
    },
  )

  try {
    await waitUntil(() => !!requests[0], 'long-poll seed did not start')
    requests[0].pending.resolve(response([], seedCursor))
    await waitUntil(() => !!requests[1], 'first row request did not start')

    for (let index = 1; index <= 3; index += 1) {
      assert.equal(
        requests[index].url.searchParams.get('since'),
        seedCursor,
        'consumer rejection must keep the last committed cursor',
      )
      requests[index].pending.resolve(response(
        [row],
        `${row.created_at}|${row.id}`,
      ))
      if (index < 3) {
        await waitUntil(
          () => !!requests[index + 1],
          `async consumer retry ${index} did not start`,
        )
      }
    }

    await waitUntil(() => delivered.length === 1, 'row never delivered')
    assert.deepEqual(attempts, [row.id, row.id, row.id])
    assert.deepEqual(delivered, [row.id])
  } finally {
    stop()
    for (const request of requests) {
      request.pending.resolve(response([], seedCursor))
    }
  }
})

test('direct inbox keeps its cursor until an async batch fully succeeds', async () => {
  const initialCursor =
    '2026-07-31T00:00:00.000Z|11111111-1111-4111-8111-111111111111'
  const rows = [
    {
      id: '22222222-2222-4222-8222-222222222222',
      conversation_id: 'conversation-direct-async',
      sender_id: USER_B,
      created_at: '2026-07-31T00:00:01.000Z',
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      conversation_id: 'conversation-direct-async',
      sender_id: USER_B,
      created_at: '2026-07-31T00:00:02.000Z',
    },
  ]
  let batchReads = 0
  const attempted = []
  const delivered = []
  let failFirst = true
  const supabase = {
    from(table) {
      assert.equal(table, 'messages')
      const state = { or: '' }
      const query = {
        select() { return query },
        neq() { return query },
        or(value) { state.or = value; return query },
        order() { return query },
        limit() {
          if (state.or.includes(`id.gt.${rows[1].id}`)) {
            return Promise.resolve({ data: [], error: null })
          }
          batchReads += 1
          return Promise.resolve({ data: rows, error: null })
        },
      }
      return query
    },
  }
  const fallback = await loadFallback({
    isH5: false,
    runtime: baseRuntime({ useSupabase: () => ({ supabase }) }),
    replacements: [
      ['function directInboxPoll(', 'export function directInboxPoll('],
      ['intervalMs: 10000', 'intervalMs: 0'],
    ],
  })

  const stop = fallback.directInboxPoll(
    USER_A,
    async row => {
      attempted.push(row.id)
      await Promise.resolve()
      if (row.id === rows[0].id && failFirst) {
        failFirst = false
        throw new Error('async direct consumer unavailable')
      }
      delivered.push(row.id)
    },
    initialCursor,
  )

  try {
    await waitUntil(
      () => delivered.length === rows.length,
      'direct inbox did not replay the rejected batch',
    )
  } finally {
    stop()
  }

  assert.equal(batchReads, 2)
  assert.deepEqual(attempted, [rows[0].id, rows[0].id, rows[1].id])
  assert.deepEqual(delivered, rows.map(row => row.id))
})

test('H5 serializes async rows, reconciles rejection, and drops an old account queue', async () => {
  const transitionListeners = new Set()
  const eventCallbacks = []
  const firstAttempt = deferred()
  const staleAttempt = deferred()
  const starts = []
  const writes = []
  let activeToken = { userId: USER_A, generation: 1 }
  let firstRowAttempts = 0
  let reconcileCount = 0

  const runtime = baseRuntime({
    useSupabase: () => ({ supabase: {} }),
    captureActiveAccountRequest: () => activeToken,
    isAccountRequestCurrent: candidate => (
      candidate?.userId === activeToken.userId
      && candidate?.generation === activeToken.generation
    ),
    onAccountTransition: callback => {
      transitionListeners.add(callback)
      return () => transitionListeners.delete(callback)
    },
    startPostgresChangesRealtimeChannel: options => {
      let alive = true
      const context = {
        userId: options.expectedUserId || USER_A,
        isCurrent: () => (
          alive
          && activeToken.userId === USER_A
          && activeToken.generation === 1
        ),
      }
      const channel = {
        on(_event, _filter, callback) {
          eventCallbacks.push(callback)
          return channel
        },
      }
      options.configure(channel, context)
      return () => {
        alive = false
        options.onClose?.()
      }
    },
  })
  const fallback = await loadFallback({ isH5: true, runtime })
  const rowOne = {
    id: '33333333-3333-4333-8333-333333333333',
    user_id: USER_A,
  }
  const rowTwo = {
    id: '44444444-4444-4444-8444-444444444444',
    user_id: USER_A,
  }
  const staleRow = {
    id: '55555555-5555-4555-8555-555555555555',
    user_id: USER_A,
  }

  const stop = fallback.subscribeToUserInbox(
    USER_A,
    async row => {
      starts.push(row.id)
      if (row.id === rowOne.id && firstRowAttempts++ === 0) {
        await firstAttempt.promise
        throw new Error('first H5 delivery failed')
      }
      if (row.id === staleRow.id) {
        await staleAttempt.promise
        if (activeToken.userId !== USER_A || activeToken.generation !== 1) return
      }
      writes.push(row.id)
    },
    undefined,
    async () => {
      if (activeToken.userId === USER_A && activeToken.generation === 1) {
        reconcileCount += 1
      }
    },
  )

  try {
    assert.equal(eventCallbacks.length, 1)
    eventCallbacks[0]({ new: rowOne })
    eventCallbacks[0]({ new: rowTwo })
    assert.deepEqual(starts, [rowOne.id], 'second row started before the first settled')

    firstAttempt.resolve()
    await waitUntil(
      () => starts.includes(rowTwo.id) && reconcileCount === 1,
      'H5 rejection did not advance the queue and reconcile',
    )
    assert.deepEqual(writes, [rowTwo.id])

    eventCallbacks[0]({ new: rowOne })
    await waitUntil(
      () => writes.includes(rowOne.id),
      'failed H5 id remained permanently de-duplicated',
    )

    eventCallbacks[0]({ new: staleRow })
    await waitUntil(
      () => starts.includes(staleRow.id),
      'stale-account row did not enter the delivery queue',
    )
    const reconcilesBeforeSwitch = reconcileCount
    activeToken = { userId: USER_B, generation: 2 }
    for (const listener of [...transitionListeners]) listener()
    staleAttempt.resolve()
    await Promise.resolve()
    await Promise.resolve()

    assert.equal(writes.includes(staleRow.id), false)
    assert.equal(reconcileCount, reconcilesBeforeSwitch)
  } finally {
    stop()
    firstAttempt.resolve()
    staleAttempt.resolve()
  }
})
