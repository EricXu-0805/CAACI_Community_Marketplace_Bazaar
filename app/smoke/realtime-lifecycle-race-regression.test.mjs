import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = relativePath => readFileSync(resolve(appRoot, relativePath), 'utf8')

function deferred() {
  let resolvePromise
  let rejectPromise
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  }
}

function browserLifecycleHarness(initialVisibility = 'visible') {
  const documentListeners = new Map()
  const windowListeners = new Map()
  const previousDocument = globalThis.document
  const previousWindow = globalThis.window
  const add = (registry, type, listener) => {
    if (!registry.has(type)) registry.set(type, new Set())
    registry.get(type).add(listener)
  }
  const fakeDocument = {
    visibilityState: initialVisibility,
    addEventListener: (type, listener) => add(documentListeners, type, listener),
    removeEventListener: (type, listener) => documentListeners.get(type)?.delete(listener),
  }
  const fakeWindow = {
    addEventListener: (type, listener) => add(windowListeners, type, listener),
    removeEventListener: (type, listener) => windowListeners.get(type)?.delete(listener),
  }
  return {
    install() {
      globalThis.document = fakeDocument
      globalThis.window = fakeWindow
    },
    restore() {
      if (previousDocument === undefined) delete globalThis.document
      else globalThis.document = previousDocument
      if (previousWindow === undefined) delete globalThis.window
      else globalThis.window = previousWindow
    },
    setVisibility(value) {
      fakeDocument.visibilityState = value
      for (const listener of [...(documentListeners.get('visibilitychange') || [])]) {
        listener()
      }
    },
    emitWindow(type) {
      for (const listener of [...(windowListeners.get(type) || [])]) listener()
    },
    listenerCount() {
      return [...documentListeners.values(), ...windowListeners.values()]
        .reduce((total, listeners) => total + listeners.size, 0)
    },
  }
}

async function waitUntil(condition, message, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(message)
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

function preprocessH5(input) {
  const enabled = [true]
  const output = []
  for (const line of input.split('\n')) {
    const directive = line.match(/^\s*\/\/\s*#(ifdef|ifndef|endif)(?:\s+(\S+))?\s*$/)
    if (directive) {
      if (directive[1] === 'endif') {
        assert.ok(enabled.length > 1, 'unbalanced uni-app #endif')
        enabled.pop()
      } else {
        const platformMatches = directive[2] === 'H5'
        enabled.push(
          enabled.at(-1)
          && (directive[1] === 'ifdef' ? platformMatches : !platformMatches),
        )
      }
      continue
    }
    if (enabled.at(-1)) output.push(line)
  }
  assert.equal(enabled.length, 1, 'unbalanced uni-app platform directives')
  return output.join('\n')
}

let presenceRuntimeSequence = 0

async function loadPresence(runtime, trackRetryMs = 0) {
  const runtimeKey = `__realtime_lifecycle_presence_${++presenceRuntimeSequence}`
  globalThis[runtimeKey] = runtime
  let input = preprocessH5(source('src/composables/usePresence.ts'))
  input = input
    .replace(
      'const PRESENCE_TRACK_RETRY_MS = 1500',
      `const PRESENCE_TRACK_RETRY_MS = ${trackRetryMs}`,
    )
    .replace(
      "import { ref, type Ref } from 'vue'",
      `const { ref } = globalThis.${runtimeKey}`,
    )
    .replace(
      "import { startPrivateRealtimeChannel } from '../api/privateRealtime'",
      `const { startPrivateRealtimeChannel } = globalThis.${runtimeKey}`,
    )
    .replace(
      "import { useSupabase } from './useSupabase'",
      `const { useSupabase } = globalThis.${runtimeKey}`,
    )
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

async function createPresenceHarness(trackFlights, { trackRetryMs = 0 } = {}) {
  const listeners = []
  let channelOptions = null
  let presenceState = {}
  let accountCurrent = true
  let transportClosed = false
  let transportStops = 0
  let trackCalls = 0
  let sendCalls = 0
  let typingEvents = 0

  const channel = {
    on(event, filter, callback) {
      listeners.push({ event, filter, callback })
      return channel
    },
    presenceState() {
      return presenceState
    },
    track() {
      const flight = trackFlights[trackCalls]
      assert.ok(flight, `unexpected track call ${trackCalls + 1}`)
      trackCalls += 1
      if (flight.throw) throw flight.throw
      return flight.promise
    },
    send() {
      sendCalls += 1
      return Promise.resolve('ok')
    },
  }

  const module = await loadPresence({
    ref: value => ({ value }),
    useSupabase: () => ({ supabase: {} }),
    startPrivateRealtimeChannel: (options) => {
      channelOptions = options
      options.configure(channel, {
        userId: '11111111-1111-4111-8111-111111111111',
        isCurrent: () => accountCurrent && !transportClosed,
      })
      return () => {
        if (transportClosed) return
        transportClosed = true
        transportStops += 1
        accountCurrent = false
        options.onClose?.()
      }
    },
  }, trackRetryMs)

  const onlineStates = []
  const presence = module.usePresence().subscribeConversationPresence(
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    () => { typingEvents += 1 },
    online => onlineStates.push(online),
  )
  assert.ok(channelOptions, 'presence channel was not configured')

  return {
    presence,
    onlineStates,
    get trackCalls() {
      return trackCalls
    },
    get sendCalls() {
      return sendCalls
    },
    get typingEvents() {
      return typingEvents
    },
    get transportStops() {
      return transportStops
    },
    status(status) {
      channelOptions.onStatus?.(status)
    },
    syncPeerOnline() {
      presenceState = {
        '33333333-3333-4333-8333-333333333333': [{
          user_id: '33333333-3333-4333-8333-333333333333',
        }],
      }
      const listener = listeners.find(entry => entry.event === 'presence')
      assert.ok(listener, 'presence sync listener was not installed')
      listener.callback()
    },
    receivePeerTyping() {
      const listener = listeners.find(entry => entry.event === 'broadcast')
      assert.ok(listener, 'typing listener was not installed')
      listener.callback({
        payload: {
          conversation_id: '22222222-2222-4222-8222-222222222222',
          user_id: '33333333-3333-4333-8333-333333333333',
        },
      })
    },
    closeTransport() {
      if (transportClosed) return
      transportClosed = true
      accountCurrent = false
      channelOptions.onClose?.()
    },
  }
}

function loadConversationGateHarness({
  ensureBlocksLoaded,
  initializeConversationAfterGate,
}) {
  const chatSource = source('src/components/ChatThread.vue')
  const start = chatSource.indexOf('async function openConversationBehindModerationGate()')
  const end = chatSource.indexOf('\nasync function retryConversationAccess()', start)
  assert.ok(start >= 0 && end > start, 'ChatThread moderation gate was not found')
  const gateSource = chatSource.slice(start, end)

  const createHarness = new Function(
    'ensureBlocksLoaded',
    'initializeConversationAfterGate',
    `
      let mounted = true
      let conversationSetupStarted = false
      let threadEpoch = 0
      const moderationAccessFailed = { value: false }
      const conversationUnavailable = { value: false }
      const conversationAccessReady = { value: false }
      const backgroundFailures = []
      let teardownCalls = 0
      function reportBackgroundFailure(label, error) {
        backgroundFailures.push({ label, error })
      }
      function teardownThreadSubscriptions() {
        teardownCalls += 1
      }
      ${gateSource}
      return {
        open: openConversationBehindModerationGate,
        replaceEpoch() {
          threadEpoch += 1
          conversationSetupStarted = false
        },
        get started() { return conversationSetupStarted },
        get epoch() { return threadEpoch },
        get moderationFailed() { return moderationAccessFailed.value },
        get unavailable() { return conversationUnavailable.value },
        get teardownCalls() { return teardownCalls },
        get backgroundFailures() { return backgroundFailures },
      }
    `,
  )

  return createHarness(ensureBlocksLoaded, initializeConversationAfterGate)
}

test('ChatThread moderation gate claims one setup owner before concurrent auth continuations', async () => {
  const blockLoad = deferred()
  let blockLoadCalls = 0
  let initializeCalls = 0
  const harness = loadConversationGateHarness({
    ensureBlocksLoaded: () => {
      blockLoadCalls += 1
      return blockLoad.promise
    },
    initializeConversationAfterGate: async () => {
      initializeCalls += 1
    },
  })

  const mountedContinuation = harness.open()
  const accountTransitionContinuation = harness.open()
  assert.equal(harness.started, true)
  assert.equal(blockLoadCalls, 1)

  blockLoad.resolve({ ok: true, userId: 'user-a', cached: false })
  await Promise.all([mountedContinuation, accountTransitionContinuation])
  assert.equal(initializeCalls, 1)
  assert.equal(harness.started, true)
})

test('ChatThread current setup failures release the latch for an explicit retry', async () => {
  const blockResults = [
    { ok: false, reason: 'load_failed', error: new Error('blocks unavailable') },
    { ok: true, userId: 'user-a', cached: true },
    { ok: true, userId: 'user-a', cached: true },
  ]
  let blockLoadCalls = 0
  let initializeCalls = 0
  const harness = loadConversationGateHarness({
    ensureBlocksLoaded: async () => {
      const result = blockResults[blockLoadCalls]
      blockLoadCalls += 1
      assert.ok(result, 'unexpected block-load attempt')
      return result
    },
    initializeConversationAfterGate: async () => {
      initializeCalls += 1
      if (initializeCalls === 1) throw new Error('realtime setup failed')
    },
  })

  await harness.open()
  assert.equal(harness.started, false)
  assert.equal(harness.moderationFailed, true)
  assert.equal(harness.unavailable, true)

  await harness.open()
  assert.equal(harness.started, false)
  assert.equal(initializeCalls, 1)
  assert.equal(harness.teardownCalls, 1)
  assert.equal(harness.backgroundFailures.at(-1)?.label, 'chat.initializeConversation')

  await harness.open()
  assert.equal(blockLoadCalls, 3)
  assert.equal(initializeCalls, 2)
  assert.equal(harness.started, true)
})

test('ChatThread unexpected moderation-gate exceptions expose Retry and can recover', async () => {
  let blockLoadCalls = 0
  let initializeCalls = 0
  const harness = loadConversationGateHarness({
    ensureBlocksLoaded: async () => {
      blockLoadCalls += 1
      if (blockLoadCalls === 1) throw new Error('unexpected block provider crash')
      return { ok: true, userId: 'user-a', cached: false }
    },
    initializeConversationAfterGate: async () => {
      initializeCalls += 1
    },
  })

  await harness.open()
  assert.equal(harness.started, false)
  assert.equal(harness.moderationFailed, true)
  assert.equal(harness.unavailable, true)
  assert.equal(harness.teardownCalls, 0)
  assert.equal(harness.backgroundFailures.at(-1)?.label, 'chat.loadBlockedIds')

  await harness.open()
  assert.equal(blockLoadCalls, 2)
  assert.equal(initializeCalls, 1)
  assert.equal(harness.started, true)
})

test('an old ChatThread gate continuation cannot unlock its replacement epoch', async () => {
  const oldBlockLoad = deferred()
  const replacementBlockLoad = deferred()
  const blockLoads = [oldBlockLoad, replacementBlockLoad]
  let blockLoadCalls = 0
  let initializeCalls = 0
  const harness = loadConversationGateHarness({
    ensureBlocksLoaded: () => {
      const flight = blockLoads[blockLoadCalls]
      blockLoadCalls += 1
      assert.ok(flight, 'unexpected block-load attempt')
      return flight.promise
    },
    initializeConversationAfterGate: async () => {
      initializeCalls += 1
    },
  })

  const oldSetup = harness.open()
  assert.equal(harness.started, true)
  harness.replaceEpoch()
  const replacementSetup = harness.open()
  assert.equal(harness.epoch, 1)
  assert.equal(harness.started, true)
  assert.equal(blockLoadCalls, 2)

  oldBlockLoad.resolve({
    ok: false,
    reason: 'load_failed',
    error: new Error('stale account failure'),
  })
  await oldSetup
  assert.equal(
    harness.started,
    true,
    'the stale epoch released the replacement setup latch',
  )
  assert.equal(harness.moderationFailed, false)

  replacementBlockLoad.resolve({ ok: true, userId: 'user-b', cached: false })
  await replacementSetup
  assert.equal(initializeCalls, 1)
  assert.equal(harness.started, true)
})

test('a stale Presence track rejection cannot overwrite a healthy rejoin generation', async () => {
  const firstTrack = deferred()
  const secondTrack = deferred()
  const harness = await createPresenceHarness([firstTrack, secondTrack])

  harness.status('SUBSCRIBED')
  harness.status('SUBSCRIBED')
  assert.equal(harness.trackCalls, 1, 'duplicate readiness must not retrack')
  harness.status('CHANNEL_ERROR')
  harness.status('SUBSCRIBED')
  assert.equal(harness.trackCalls, 2)
  secondTrack.resolve('ok')
  await secondTrack.promise
  await Promise.resolve()
  harness.syncPeerOnline()
  assert.equal(harness.presence.peerOnline.value, true)

  firstTrack.reject(new Error('old track failed after reconnect'))
  await Promise.allSettled([firstTrack.promise])
  await Promise.resolve()
  assert.equal(
    harness.presence.peerOnline.value,
    true,
    'the first generation clobbered the healthy replacement',
  )
})

test('current Presence track failures disable typing and recover within the bounded retry owner', async () => {
  for (const failureKind of ['sync', 'async', 'resolved-error', 'resolved-timeout']) {
    let firstTrack
    if (failureKind === 'sync') {
      firstTrack = { throw: new Error('sync track failed') }
    } else if (failureKind === 'resolved-error') {
      firstTrack = { promise: Promise.resolve('error') }
    } else if (failureKind === 'resolved-timeout') {
      firstTrack = { promise: Promise.resolve('timed out') }
    } else {
      firstTrack = deferred()
    }
    const recoveredTrack = deferred()
    const harness = await createPresenceHarness(
      [firstTrack, recoveredTrack],
      { trackRetryMs: 0 },
    )

    harness.status('SUBSCRIBED')
    harness.presence.sendTyping()
    harness.receivePeerTyping()
    harness.syncPeerOnline()
    assert.equal(harness.sendCalls, 0, `${failureKind} pending track sent typing`)
    assert.equal(harness.typingEvents, 0, `${failureKind} pending track accepted typing`)
    assert.equal(harness.presence.peerOnline.value, false)

    if (failureKind === 'async') {
      firstTrack.reject(new Error('async track failed'))
      await Promise.allSettled([firstTrack.promise])
    }
    await waitUntil(
      () => harness.trackCalls === 2,
      `${failureKind} track failure did not retry`,
    )
    harness.presence.sendTyping()
    harness.receivePeerTyping()
    assert.equal(harness.sendCalls, 0, `${failureKind} retry pending sent typing`)
    assert.equal(harness.typingEvents, 0, `${failureKind} retry pending accepted typing`)

    recoveredTrack.resolve('ok')
    await recoveredTrack.promise
    await Promise.resolve()
    harness.syncPeerOnline()
    harness.presence.sendTyping()
    harness.receivePeerTyping()
    assert.equal(harness.presence.peerOnline.value, true)
    assert.equal(harness.sendCalls, 1)
    assert.equal(harness.typingEvents, 1)
  }
})

test('Presence track retries are bounded and remain fail closed after exhaustion', async () => {
  const attempts = [deferred(), deferred(), deferred()]
  const harness = await createPresenceHarness(attempts, { trackRetryMs: 0 })
  harness.status('SUBSCRIBED')

  for (let index = 0; index < attempts.length; index += 1) {
    attempts[index].reject(new Error(`track attempt ${index + 1} failed`))
    await Promise.allSettled([attempts[index].promise])
    if (index < attempts.length - 1) {
      await waitUntil(
        () => harness.trackCalls === index + 2,
        `track retry ${index + 2} did not start`,
      )
    }
  }
  await new Promise(resolve => setTimeout(resolve, 5))

  assert.equal(harness.trackCalls, 3)
  harness.presence.sendTyping()
  harness.receivePeerTyping()
  harness.syncPeerOnline()
  assert.equal(harness.sendCalls, 0)
  assert.equal(harness.typingEvents, 0)
  assert.equal(harness.presence.peerOnline.value, false)
})

test('Presence close and explicit unsubscribe invalidate a pending track generation', async () => {
  for (const closeKind of ['transport', 'unsubscribe']) {
    const pendingTrack = deferred()
    const harness = await createPresenceHarness([pendingTrack])
    harness.status('SUBSCRIBED')
    harness.syncPeerOnline()
    assert.equal(
      harness.presence.peerOnline.value,
      false,
      'presence must stay fail closed until track succeeds',
    )

    if (closeKind === 'transport') harness.closeTransport()
    else harness.presence.unsubscribe()
    assert.equal(harness.presence.peerOnline.value, false)
    harness.presence.sendTyping()
    harness.receivePeerTyping()
    assert.equal(harness.sendCalls, 0)
    assert.equal(harness.typingEvents, 0)

    pendingTrack.reject(new Error(`late rejection after ${closeKind}`))
    await Promise.allSettled([pendingTrack.promise])
    await Promise.resolve()
    await new Promise(resolve => setTimeout(resolve, 5))
    assert.equal(harness.presence.peerOnline.value, false)
    assert.equal(harness.trackCalls, 1, 'teardown scheduled a stale track retry')
    assert.deepEqual(harness.onlineStates, [])
  }
})

for (const presenceBrowserCase of [
  {
    label: 'an initially hidden tab resumes visible',
    initialVisibility: 'hidden',
    trigger(lifecycle) {
      lifecycle.setVisibility('visible')
    },
  },
  {
    label: 'a fresh offline event fires',
    initialVisibility: 'visible',
    trigger(lifecycle) {
      lifecycle.emitWindow('offline')
    },
  },
  {
    label: 'an observed hidden tab resumes visible',
    initialVisibility: 'visible',
    trigger(lifecycle) {
      lifecycle.setVisibility('hidden')
      lifecycle.setVisibility('visible')
    },
  },
]) {
  test(`Presence tears down exactly once when ${presenceBrowserCase.label}`, async () => {
    const lifecycle = browserLifecycleHarness(presenceBrowserCase.initialVisibility)
    const track = deferred()
    let harness = null
    lifecycle.install()
    try {
      harness = await createPresenceHarness([track])
      assert.equal(lifecycle.listenerCount(), 2)
      harness.status('SUBSCRIBED')
      track.resolve('ok')
      await track.promise
      await Promise.resolve()
      harness.syncPeerOnline()
      assert.equal(harness.presence.peerOnline.value, true)

      presenceBrowserCase.trigger(lifecycle)
      assert.equal(harness.presence.peerOnline.value, false)
      assert.equal(harness.transportStops, 1, 'browser recovery must close the SDK transport')
      assert.equal(lifecycle.listenerCount(), 0)
      assert.deepEqual(harness.onlineStates, [true, false])
      harness.presence.sendTyping()
      harness.receivePeerTyping()
      assert.equal(harness.sendCalls, 0)
      assert.equal(harness.typingEvents, 0)

      lifecycle.setVisibility('hidden')
      lifecycle.setVisibility('visible')
      lifecycle.emitWindow('offline')
      harness.presence.unsubscribe()
      assert.equal(
        harness.transportStops,
        1,
        'repeated browser signals and explicit teardown must share one idempotent stop owner',
      )
      assert.equal(lifecycle.listenerCount(), 0)
    } finally {
      harness?.presence.unsubscribe()
      track.resolve('ok')
      lifecycle.restore()
    }
  })
}
