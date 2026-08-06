import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RealtimeClient } from '@supabase/realtime-js'
import test from 'node:test'
import ts from 'typescript'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = relativePath => readFile(resolve(appRoot, relativePath), 'utf8')

function deferred() {
  let resolvePromise
  let rejectPromise
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

async function loadBoundaryRuntime({ authTimeoutMs } = {}) {
  const runtimeKey = `__private_realtime_boundary_${Date.now()}_${Math.random()}`
  let activeUserId = '11111111-1111-4111-8111-111111111111'
  let generation = 1
  const listeners = new Set()
  globalThis[runtimeKey] = {
    captureActiveAccountRequest: () => activeUserId
      ? { userId: activeUserId, generation }
      : null,
    isAccountRequestCurrent: token => (
      !!token && token.userId === activeUserId && token.generation === generation
    ),
    onAccountTransition: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }

  let input = await source('src/api/privateRealtime.ts')
  input = input.replace(
    /import type \{ RealtimeChannel, SupabaseClient \} from '@supabase\/supabase-js'\s*/,
    '',
  ).replace(
    /import \{[\s\S]*?\} from '\.\.\/composables\/accountScope'/,
    `const {
      captureActiveAccountRequest,
      isAccountRequestCurrent,
      onAccountTransition,
    } = globalThis[${JSON.stringify(runtimeKey)}]`,
  )
  if (typeof authTimeoutMs === 'number') {
    input = input.replace(
      'const REALTIME_AUTH_TIMEOUT_MS = 10000',
      `const REALTIME_AUTH_TIMEOUT_MS = ${authTimeoutMs}`,
    )
  }
  const compiled = ts.transpileModule(input, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText
  const module = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
  const startPrivateRealtimeChannel = options => {
    module.installRealtimeAuthSerialization(options.supabase.realtime)
    return module.startPrivateRealtimeChannel(options)
  }
  const startPostgresChangesRealtimeChannel = options => {
    module.installRealtimeAuthSerialization(options.supabase.realtime)
    return module.startPostgresChangesRealtimeChannel(options)
  }

  return {
    ...module,
    startPrivateRealtimeChannel,
    startPostgresChangesRealtimeChannel,
    transition(nextUserId) {
      activeUserId = nextUserId
      generation += 1
      for (const listener of [...listeners]) listener({ userId: nextUserId, generation })
    },
    dispose() { delete globalThis[runtimeKey] },
  }
}

function realtimeHarness({
  sessionPromise,
  verifiedSessionPromise,
  authPromise = Promise.resolve(),
  ambientToken,
  channelError = null,
  closeOnRemove = false,
  subscribeError = null,
}) {
  const events = []
  const authTokensUsed = []
  let currentAmbientToken = ambientToken
  let sessionCalls = 0
  let statusCallback = null
  const channel = {
    subscribe(callback) {
      events.push('subscribe')
      if (subscribeError) throw subscribeError
      statusCallback = callback
      return channel
    },
  }
  const supabase = {
    auth: {
      getSession() {
        events.push('getSession')
        sessionCalls += 1
        const selectedSession = sessionCalls === 1 || !verifiedSessionPromise
          ? sessionPromise
          : verifiedSessionPromise
        return Promise.resolve(selectedSession).then((result) => {
          if (currentAmbientToken === undefined) {
            currentAmbientToken = result?.data?.session?.access_token
          }
          return result
        })
      },
    },
    realtime: {
      accessTokenValue: null,
      async setAuth(...args) {
        const token = args.length === 0 ? currentAmbientToken : args[0]
        events.push(args.length === 0 ? 'setAuth:callback' : `setAuth:${args[0]}`)
        authTokensUsed.push(token)
        await authPromise
        this.accessTokenValue = token
      },
    },
    channel(topic, options) {
      events.push({ topic, options })
      if (channelError) throw channelError
      return channel
    },
    removeChannel(value) {
      assert.equal(value, channel)
      events.push('removeChannel')
      if (closeOnRemove) statusCallback?.('CLOSED')
      return Promise.resolve('ok')
    },
  }
  return {
    supabase,
    channel,
    events,
    authTokensUsed,
    setAmbientToken(token) { currentAmbientToken = token },
    status: (value, error) => statusCallback?.(value, error),
  }
}

test('private Realtime waits for the account session and JWT before subscribing', async () => {
  const runtime = await loadBoundaryRuntime()
  try {
    const session = deferred()
    const setAuth = deferred()
    const harness = realtimeHarness({ sessionPromise: session.promise, authPromise: setAuth.promise })
    const statuses = []
    const unsubscribe = runtime.startPrivateRealtimeChannel({
      supabase: harness.supabase,
      topic: 'messages:22222222-2222-4222-8222-222222222222',
      config: { broadcast: { self: false } },
      configure: channel => channel,
      onStatus: status => statuses.push(status),
    })

    await Promise.resolve()
    assert.deepEqual(harness.events, ['getSession'])
    session.resolve({
      data: {
        session: {
          user: { id: '11111111-1111-4111-8111-111111111111' },
          access_token: 'test-jwt',
        },
      },
      error: null,
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.deepEqual(harness.events, ['getSession', 'setAuth:callback'])

    setAuth.resolve()
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(harness.events[3].topic, 'messages:22222222-2222-4222-8222-222222222222')
    assert.deepEqual(harness.events[3].options, {
      config: { broadcast: { self: false }, private: true },
    })
    assert.equal(harness.events[4], 'subscribe')
    harness.status('SUBSCRIBED')
    assert.deepEqual(statuses, ['SUBSCRIBED'])

    unsubscribe()
    await Promise.resolve()
    assert.equal(harness.events.at(-1), 'removeChannel')
  } finally {
    runtime.dispose()
  }
})

test('Postgres Changes keeps the authenticated account boundary without requesting private channel authorization', async () => {
  const runtime = await loadBoundaryRuntime()
  try {
    const harness = realtimeHarness({
      sessionPromise: Promise.resolve({
        data: {
          session: {
            user: { id: '11111111-1111-4111-8111-111111111111' },
            access_token: 'postgres-change-jwt',
          },
        },
        error: null,
      }),
    })
    const statuses = []
    const failures = []
    runtime.startPostgresChangesRealtimeChannel({
      supabase: harness.supabase,
      topic: 'user-11111111-1111-4111-8111-111111111111-notifications',
      expectedUserId: '11111111-1111-4111-8111-111111111111',
      configure: channel => channel,
      onStatus: status => statuses.push(status),
      onFailure: failure => {
        harness.events.push(`failure:${failure.status || failure.stage}`)
        failures.push(failure)
      },
    })
    await new Promise(resolve => setTimeout(resolve, 0))

    assert.deepEqual(harness.events.slice(0, 5), [
      'getSession',
      'setAuth:callback',
      'getSession',
      {
        topic: 'user-11111111-1111-4111-8111-111111111111-notifications',
        options: { config: {} },
      },
      'subscribe',
    ])

    harness.status('SUBSCRIBED')
    harness.status('CHANNEL_ERROR', new Error('join failed'))
    harness.status('TIMED_OUT')
    assert.deepEqual(statuses, ['SUBSCRIBED', 'CHANNEL_ERROR'])
    assert.equal(failures.length, 1, 'one failed transport can trigger only one fallback handoff')
    assert.equal(failures[0].stage, 'status')
    assert.equal(failures[0].status, 'CHANNEL_ERROR')
    assert.deepEqual(harness.events.slice(-2), ['removeChannel', 'failure:CHANNEL_ERROR'])
  } finally {
    runtime.dispose()
  }
})

for (const terminalStatus of ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']) {
  test(`a fresh Postgres Changes channel hands off when its first status is ${terminalStatus}`, async () => {
    const runtime = await loadBoundaryRuntime()
    try {
      const harness = realtimeHarness({
        sessionPromise: Promise.resolve({
          data: {
            session: {
              user: { id: '11111111-1111-4111-8111-111111111111' },
              access_token: 'postgres-change-jwt',
            },
          },
          error: null,
        }),
      })
      const statuses = []
      const failures = []
      runtime.startPostgresChangesRealtimeChannel({
        supabase: harness.supabase,
        topic: `messages:first-${terminalStatus.toLowerCase()}`,
        configure: channel => channel,
        onStatus: status => statuses.push(status),
        onFailure: failure => failures.push(failure),
      })
      await new Promise(resolve => setTimeout(resolve, 0))

      harness.status(terminalStatus, new Error(`first status ${terminalStatus}`))
      harness.status('SUBSCRIBED')
      harness.status(terminalStatus)

      assert.deepEqual(statuses, [terminalStatus], 'a dead fresh channel must suppress every late status')
      assert.equal(failures.length, 1, 'the first terminal status must hand off exactly once')
      assert.equal(failures[0].stage, 'status')
      assert.equal(failures[0].status, terminalStatus)
      assert.equal(
        harness.events.filter(event => event === 'removeChannel').length,
        1,
        'the failed fresh channel must be removed before fallback takes ownership',
      )
    } finally {
      runtime.dispose()
    }
  })
}

test('a late same-account session snapshot cannot roll the shared Realtime token back', async () => {
  const runtime = await loadBoundaryRuntime()
  try {
    const session = deferred()
    const harness = realtimeHarness({
      sessionPromise: session.promise,
      verifiedSessionPromise: Promise.resolve({
        data: {
          session: {
            user: { id: '11111111-1111-4111-8111-111111111111' },
            access_token: 'jwt-new',
          },
        },
        error: null,
      }),
      ambientToken: 'jwt-old',
    })
    runtime.startPostgresChangesRealtimeChannel({
      supabase: harness.supabase,
      topic: 'messages:22222222-2222-4222-8222-222222222222',
      configure: channel => channel,
    })

    // TOKEN_REFRESHED keeps the same account generation. The helper's earlier
    // getSession result is now stale, but callback-mode setAuth must resolve the
    // ambient latest token instead of writing that snapshot back globally.
    harness.setAmbientToken('jwt-new')
    session.resolve({
      data: {
        session: {
          user: { id: '11111111-1111-4111-8111-111111111111' },
          access_token: 'jwt-old',
        },
      },
      error: null,
    })
    await new Promise(resolve => setTimeout(resolve, 0))

    assert.deepEqual(harness.authTokensUsed, ['jwt-new'])
    assert.ok(harness.events.includes('setAuth:callback'))
    assert.ok(!harness.events.includes('setAuth:jwt-old'))
    assert.ok(harness.events.includes('subscribe'))
  } finally {
    runtime.dispose()
  }
})

test('a late account-A setAuth completion cannot roll the shared Realtime JWT back after account B subscribes', async () => {
  const runtime = await loadBoundaryRuntime()
  try {
    const accountA = '11111111-1111-4111-8111-111111111111'
    const accountB = '33333333-3333-4333-8333-333333333333'
    const lateAccountAAuth = deferred()
    const events = []
    let sessionReads = 0
    let authCalls = 0
    let sharedRealtimeJwt = null

    const channel = {
      subscribe() {
        events.push('subscribe:B')
        return channel
      },
    }
    const supabase = {
      auth: {
        getSession() {
          const userId = ++sessionReads === 1 ? accountA : accountB
          events.push(`getSession:${userId}`)
          return Promise.resolve({
            data: {
              session: {
                user: { id: userId },
                access_token: userId === accountA ? 'jwt-A' : 'jwt-B',
              },
            },
            error: null,
          })
        },
      },
      realtime: {
        accessTokenValue: null,
        async setAuth() {
          const call = ++authCalls
          const token = call === 1 ? 'jwt-A' : 'jwt-B'
          events.push(`setAuth:${token}:start`)
          if (call === 1) await lateAccountAAuth.promise
          sharedRealtimeJwt = token
          this.accessTokenValue = token
          events.push(`setAuth:${token}:applied`)
        },
      },
      channel() {
        events.push('channel:B')
        return channel
      },
      removeChannel(value) {
        assert.equal(value, channel)
        events.push('removeChannel:B')
        return Promise.resolve('ok')
      },
    }

    runtime.startPostgresChangesRealtimeChannel({
      supabase,
      expectedUserId: accountA,
      topic: `user-${accountA}-notifications`,
      configure: value => value,
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.ok(events.includes('setAuth:jwt-A:start'), 'account A did not enter the delayed setAuth boundary')

    runtime.transition(accountB)
    runtime.startPostgresChangesRealtimeChannel({
      supabase,
      expectedUserId: accountB,
      topic: `user-${accountB}-notifications`,
      configure: value => value,
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(sharedRealtimeJwt, null)
    assert.ok(
      !events.includes('subscribe:B'),
      'account B must wait until the older shared auth write has settled',
    )

    lateAccountAAuth.resolve()
    await new Promise(resolve => setTimeout(resolve, 0))

    assert.equal(sharedRealtimeJwt, 'jwt-B')
    const accountBSubscribeIndex = events.indexOf('subscribe:B')
    assert.notEqual(accountBSubscribeIndex, -1)
    assert.equal(
      events.slice(accountBSubscribeIndex + 1).some(event => event === 'setAuth:jwt-A:applied'),
      false,
      'once account B subscribes, a late account-A auth call must never be applied to the shared client',
    )
    assert.equal(
      sharedRealtimeJwt,
      'jwt-B',
      'a stale account-A auth continuation must not overwrite the shared token used by account B channels',
    )
  } finally {
    runtime.dispose()
  }
})

test('an ambient callback auth write from the real Realtime SDK cannot roll account B back to A', async () => {
  const runtime = await loadBoundaryRuntime()
  try {
    const accountB = '33333333-3333-4333-8333-333333333333'
    const lateAccountAToken = deferred()
    let accessTokenCalls = 0
    const realtime = new RealtimeClient('ws://localhost/realtime/v1', {
      params: { apikey: 'test-public-key' },
      accessToken: async () => {
        accessTokenCalls += 1
        if (accessTokenCalls === 1) return lateAccountAToken.promise
        return 'jwt-B'
      },
    })
    runtime.installRealtimeAuthSerialization(realtime)

    // This represents callback-mode auth started by RealtimeClient itself
    // during connect/join/heartbeat, outside the app helper's current queue.
    const lateAmbientAuth = realtime.setAuth()
    while (accessTokenCalls === 0) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }

    runtime.transition(accountB)
    const events = []
    const channel = {
      subscribe() {
        events.push('subscribe:B')
        return channel
      },
    }
    const supabase = {
      auth: {
        getSession: async () => ({
          data: {
            session: {
              user: { id: accountB },
              access_token: 'jwt-B',
            },
          },
          error: null,
        }),
      },
      realtime,
      channel() {
        events.push('channel:B')
        return channel
      },
      removeChannel(value) {
        assert.equal(value, channel)
        events.push('removeChannel:B')
        return Promise.resolve('ok')
      },
    }

    runtime.startPostgresChangesRealtimeChannel({
      supabase,
      expectedUserId: accountB,
      topic: `user-${accountB}-notifications`,
      configure: value => value,
    })
    await new Promise(resolve => setTimeout(resolve, 0))

    assert.equal(realtime.accessTokenValue, null)
    assert.ok(!events.includes('subscribe:B'))

    lateAccountAToken.resolve('jwt-A')
    await lateAmbientAuth
    const subscribeDeadline = Date.now() + 250
    while (!events.includes('subscribe:B')) {
      if (Date.now() > subscribeDeadline) {
        throw new Error('account B did not subscribe after the older SDK auth write settled')
      }
      await new Promise(resolve => setTimeout(resolve, 0))
    }

    assert.equal(
      realtime.accessTokenValue,
      'jwt-B',
      'an SDK-owned callback started for A must not complete after B and roll back the shared client',
    )
    assert.equal(realtime._isManualToken(), false)
  } finally {
    runtime.dispose()
  }
})

test('the real SDK internal auth path and explicit Auth events share invocation order', async () => {
  const runtime = await loadBoundaryRuntime()
  try {
    const lateCallbackToken = deferred()
    let accessTokenCalls = 0
    const realtime = new RealtimeClient('ws://localhost/realtime/v1', {
      params: { apikey: 'test-public-key' },
      accessToken: async () => {
        accessTokenCalls += 1
        return lateCallbackToken.promise
      },
    })
    runtime.installRealtimeAuthSerialization(realtime)
    runtime.installRealtimeAuthSerialization(realtime)

    // _setAuthSafely is the exact dynamic dispatch used by connect and
    // heartbeat. Its callback-mode write must own the queue before the later
    // SIGNED_IN/TOKEN_REFRESHED-style explicit write.
    realtime._setAuthSafely('contract-test')
    while (accessTokenCalls === 0) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    const latestAuth = realtime.setAuth('jwt-refreshed')
    assert.equal(realtime.accessTokenValue, null)

    lateCallbackToken.resolve('jwt-stale')
    await latestAuth

    assert.equal(realtime.accessTokenValue, 'jwt-refreshed')
    assert.equal(realtime._isManualToken(), true)
  } finally {
    runtime.dispose()
  }
})

test('an idle coordinated explicit Auth event preserves the SDK synchronous token write', async () => {
  const runtime = await loadBoundaryRuntime()
  try {
    const realtime = new RealtimeClient('ws://localhost/realtime/v1', {
      params: { apikey: 'test-public-key' },
    })
    runtime.installRealtimeAuthSerialization(realtime)

    const applied = realtime.setAuth('jwt-now')
    assert.equal(
      realtime.accessTokenValue,
      'jwt-now',
      'wrapping must not add an anonymous microtask interval to an idle explicit Auth event',
    )
    await applied
  } finally {
    runtime.dispose()
  }
})

test('a real SDK ambient auth timeout permanently poisons and tears down the shared client', async () => {
  const runtime = await loadBoundaryRuntime({ authTimeoutMs: 20 })
  try {
    const accountB = '33333333-3333-4333-8333-333333333333'
    const lateAccountAToken = deferred()
    let accessTokenCalls = 0
    let removeAllCalls = 0
    let disconnectCalls = 0
    const realtime = new RealtimeClient('ws://localhost/realtime/v1', {
      params: { apikey: 'test-public-key' },
      accessToken: async () => {
        accessTokenCalls += 1
        return lateAccountAToken.promise
      },
    })
    realtime.removeAllChannels = async () => {
      removeAllCalls += 1
      return []
    }
    realtime.disconnect = async () => {
      disconnectCalls += 1
      return 'ok'
    }
    runtime.installRealtimeAuthSerialization(realtime)

    const ambientAuth = realtime.setAuth()
    while (accessTokenCalls === 0) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    await new Promise(resolve => setTimeout(resolve, 40))
    await ambientAuth

    assert.equal(removeAllCalls, 1)
    assert.equal(disconnectCalls, 1)
    assert.equal(realtime.accessTokenValue, null)

    // SupabaseClient Auth handlers do not await/catch setAuth. Once poisoned,
    // ambient calls must resolve as no-ops instead of creating unhandled
    // rejections or silently reopening the shared client.
    await realtime.setAuth('jwt-B')
    assert.equal(realtime.accessTokenValue, null)

    runtime.transition(accountB)
    let sessionReads = 0
    let channelCalls = 0
    const failures = []
    const supabase = {
      auth: {
        getSession: async () => {
          sessionReads += 1
          return {
            data: {
              session: {
                user: { id: accountB },
                access_token: 'jwt-B',
              },
            },
            error: null,
          }
        },
      },
      realtime,
      channel() {
        channelCalls += 1
        assert.fail('a poisoned shared client must never construct a new channel')
      },
      removeChannel() {
        return Promise.resolve('ok')
      },
    }
    runtime.startPostgresChangesRealtimeChannel({
      supabase,
      expectedUserId: accountB,
      topic: `user-${accountB}-notifications`,
      configure: value => value,
      onFailure: failure => failures.push(failure),
    })
    await new Promise(resolve => setTimeout(resolve, 0))

    assert.equal(sessionReads, 0)
    assert.equal(channelCalls, 0)
    assert.equal(failures.length, 1)
    assert.equal(failures[0].stage, 'setAuth')

    // The timed-out SDK Promise is not cancellable and does write A internally
    // when released. The poisoned completion handler must scrub it back to null
    // and must not reopen the queue or tear down twice.
    lateAccountAToken.resolve('jwt-A')
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(realtime.accessTokenValue, null)
    await realtime.setAuth('jwt-B-late')
    assert.equal(realtime.accessTokenValue, null)
    assert.equal(removeAllCalls, 1)
    assert.equal(disconnectCalls, 1)
  } finally {
    runtime.dispose()
  }
})

test('a preflight timeout cannot resume into setAuth after its session read returns late', async () => {
  const runtime = await loadBoundaryRuntime({ authTimeoutMs: 20 })
  try {
    const lateSession = deferred()
    let authCalls = 0
    let channelCalls = 0
    let teardownCalls = 0
    const failures = []
    const supabase = {
      auth: {
        getSession: () => lateSession.promise,
      },
      realtime: {
        accessTokenValue: null,
        async setAuth() {
          authCalls += 1
          this.accessTokenValue = 'must-not-apply'
        },
        async removeAllChannels() {
          teardownCalls += 1
          return []
        },
        async disconnect() {
          return 'ok'
        },
      },
      channel() {
        channelCalls += 1
        assert.fail('a timed-out preflight must not construct a channel')
      },
      removeChannel() {
        return Promise.resolve('ok')
      },
    }
    runtime.startPostgresChangesRealtimeChannel({
      supabase,
      topic: 'messages:late-session',
      configure: value => value,
      onFailure: failure => failures.push(failure),
    })
    await new Promise(resolve => setTimeout(resolve, 40))

    assert.equal(failures.length, 1)
    assert.equal(failures[0].stage, 'setAuth')
    assert.equal(teardownCalls, 1)

    lateSession.resolve({
      data: {
        session: {
          user: { id: '11111111-1111-4111-8111-111111111111' },
          access_token: 'late-jwt',
        },
      },
      error: null,
    })
    await new Promise(resolve => setTimeout(resolve, 0))

    assert.equal(authCalls, 0)
    assert.equal(channelCalls, 0)
    assert.equal(supabase.realtime.accessTokenValue, null)
  } finally {
    runtime.dispose()
  }
})

test('a rejected account-A auth write cannot block or authenticate the queued account-B channel', async () => {
  const runtime = await loadBoundaryRuntime()
  try {
    const accountA = '11111111-1111-4111-8111-111111111111'
    const accountB = '33333333-3333-4333-8333-333333333333'
    const lateAccountAAuth = deferred()
    const events = []
    let sessionReads = 0
    let authCalls = 0
    let sharedRealtimeJwt = null

    const channelB = {
      subscribe() {
        events.push('subscribe:B')
        return channelB
      },
    }
    const supabase = {
      auth: {
        getSession() {
          const userId = ++sessionReads === 1 ? accountA : accountB
          return Promise.resolve({
            data: {
              session: {
                user: { id: userId },
                access_token: userId === accountA ? 'jwt-A' : 'jwt-B',
              },
            },
            error: null,
          })
        },
      },
      realtime: {
        accessTokenValue: null,
        async setAuth() {
          const call = ++authCalls
          if (call === 1) {
            events.push('setAuth:A:start')
            await lateAccountAAuth.promise
            sharedRealtimeJwt = 'jwt-A'
            this.accessTokenValue = 'jwt-A'
            return
          }
          events.push('setAuth:B:applied')
          sharedRealtimeJwt = 'jwt-B'
          this.accessTokenValue = 'jwt-B'
        },
      },
      channel() {
        events.push('channel:B')
        return channelB
      },
      removeChannel(value) {
        assert.equal(value, channelB)
        events.push('removeChannel:B')
        return Promise.resolve('ok')
      },
    }

    runtime.startPostgresChangesRealtimeChannel({
      supabase,
      expectedUserId: accountA,
      topic: `user-${accountA}-notifications`,
      configure: value => value,
    })
    await new Promise(resolve => setTimeout(resolve, 0))

    runtime.transition(accountB)
    runtime.startPostgresChangesRealtimeChannel({
      supabase,
      expectedUserId: accountB,
      topic: `user-${accountB}-notifications`,
      configure: value => value,
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.ok(!events.includes('subscribe:B'))

    lateAccountAAuth.reject(new Error('stale account-A auth failed'))
    await new Promise(resolve => setTimeout(resolve, 0))

    assert.equal(sharedRealtimeJwt, 'jwt-B')
    assert.deepEqual(events.slice(-3), ['setAuth:B:applied', 'channel:B', 'subscribe:B'])
  } finally {
    runtime.dispose()
  }
})

test('a callback-mode auth fallback cannot subscribe with another account cached in Realtime', async () => {
  const runtime = await loadBoundaryRuntime()
  try {
    const accountA = '11111111-1111-4111-8111-111111111111'
    const channel = {
      subscribe() {
        assert.fail('a channel must not subscribe before the applied Realtime JWT is verified')
      },
    }
    const failures = []
    const supabase = {
      auth: {
        getSession: async () => ({
          data: {
            session: {
              user: { id: accountA },
              access_token: 'jwt-account-A',
            },
          },
          error: null,
        }),
      },
      realtime: {
        // RealtimeClient silently falls back to its cached accessTokenValue
        // when the access-token callback throws, and setAuth() still resolves.
        accessTokenValue: 'jwt-other-account',
        async setAuth() {},
      },
      channel() {
        return channel
      },
      removeChannel() {
        return Promise.resolve('ok')
      },
    }

    runtime.startPostgresChangesRealtimeChannel({
      supabase,
      expectedUserId: accountA,
      topic: `user-${accountA}-notifications`,
      configure: value => value,
      onFailure: failure => failures.push(failure),
    })
    await new Promise(resolve => setTimeout(resolve, 0))

    assert.equal(failures.length, 1)
    assert.equal(failures[0].stage, 'setAuth')
  } finally {
    runtime.dispose()
  }
})

test('a hung stale auth write fails later accounts into polling instead of wedging forever', async () => {
  const runtime = await loadBoundaryRuntime({ authTimeoutMs: 20 })
  try {
    const accountA = '11111111-1111-4111-8111-111111111111'
    const accountB = '33333333-3333-4333-8333-333333333333'
    const neverSettles = deferred()
    let sessionReads = 0
    let authCalls = 0
    let channelCalls = 0
    const accountBFailures = []
    const supabase = {
      auth: {
        getSession() {
          const userId = ++sessionReads === 1 ? accountA : accountB
          return Promise.resolve({
            data: {
              session: {
                user: { id: userId },
                access_token: userId === accountA ? 'jwt-A' : 'jwt-B',
              },
            },
            error: null,
          })
        },
      },
      realtime: {
        accessTokenValue: null,
        async setAuth() {
          authCalls += 1
          await neverSettles.promise
        },
      },
      channel() {
        channelCalls += 1
        assert.fail('a poisoned shared auth client must not construct a channel')
      },
      removeChannel() {
        return Promise.resolve('ok')
      },
    }

    runtime.startPostgresChangesRealtimeChannel({
      supabase,
      expectedUserId: accountA,
      topic: `user-${accountA}-notifications`,
      configure: value => value,
    })
    const deadline = Date.now() + 100
    while (authCalls === 0) {
      if (Date.now() > deadline) throw new Error('account A did not enter setAuth')
      await new Promise(resolve => setTimeout(resolve, 0))
    }

    runtime.transition(accountB)
    runtime.startPostgresChangesRealtimeChannel({
      supabase,
      expectedUserId: accountB,
      topic: `user-${accountB}-notifications`,
      configure: value => value,
      onFailure: failure => accountBFailures.push(failure),
    })
    await new Promise(resolve => setTimeout(resolve, 50))

    assert.equal(authCalls, 1, 'account B must not race the still-running account-A write')
    assert.equal(channelCalls, 0)
    assert.equal(accountBFailures.length, 1)
    assert.equal(accountBFailures[0].stage, 'setAuth')
  } finally {
    runtime.dispose()
  }
})

test('Postgres Changes setup failures signal fallback, but teardown and account replacement do not', async () => {
  const runtime = await loadBoundaryRuntime()
  try {
    const validSession = () => ({
      data: {
        session: {
          user: { id: '11111111-1111-4111-8111-111111111111' },
          access_token: 'live-jwt',
        },
      },
      error: null,
    })

    for (const failAt of ['getSession', 'setAuth', 'channel', 'configure', 'subscribe']) {
      const harness = realtimeHarness({
        sessionPromise: failAt === 'getSession'
          ? Promise.reject(new Error('getSession failed'))
          : Promise.resolve(validSession()),
        authPromise: failAt === 'setAuth'
          ? Promise.reject(new Error('setAuth failed'))
          : Promise.resolve(),
        channelError: failAt === 'channel' ? new Error('channel failed') : null,
        subscribeError: failAt === 'subscribe' ? new Error('subscribe failed') : null,
      })
      const failures = []
      runtime.startPostgresChangesRealtimeChannel({
        supabase: harness.supabase,
        topic: 'messages:22222222-2222-4222-8222-222222222222',
        configure: channel => {
          if (failAt === 'configure') throw new Error('configure failed')
          return channel
        },
        onFailure: failure => failures.push(failure),
      })
      await new Promise(resolve => setTimeout(resolve, 0))
      assert.equal(failures.length, 1, `${failAt} must hand off to polling exactly once`)
      assert.equal(failures[0].stage, failAt)
      assert.equal(
        harness.events.filter(event => event === 'removeChannel').length,
        failAt === 'configure' || failAt === 'subscribe' ? 1 : 0,
      )
    }

    for (const mode of ['unsubscribe', 'account-switch']) {
      const session = deferred()
      const harness = realtimeHarness({ sessionPromise: session.promise })
      const failures = []
      const unsubscribe = runtime.startPostgresChangesRealtimeChannel({
        supabase: harness.supabase,
        topic: 'messages:22222222-2222-4222-8222-222222222222',
        configure: channel => channel,
        onFailure: failure => failures.push(failure),
      })
      if (mode === 'unsubscribe') unsubscribe()
      else runtime.transition('33333333-3333-4333-8333-333333333333')
      session.resolve(validSession())
      await new Promise(resolve => setTimeout(resolve, 0))
      assert.deepEqual(failures, [], `${mode} is intentional teardown, not a transport failure`)
      if (mode === 'account-switch') {
        runtime.transition('11111111-1111-4111-8111-111111111111')
      }
    }

    const pendingAuth = deferred()
    const authHarness = realtimeHarness({
      sessionPromise: Promise.resolve({
        data: {
          session: {
            user: { id: '11111111-1111-4111-8111-111111111111' },
            access_token: 'stale-before-switch',
          },
        },
        error: null,
      }),
      authPromise: pendingAuth.promise,
    })
    const failures = []
    runtime.startPostgresChangesRealtimeChannel({
      supabase: authHarness.supabase,
      topic: 'messages:22222222-2222-4222-8222-222222222222',
      configure: channel => channel,
      onFailure: failure => failures.push(failure),
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.ok(
      authHarness.events.includes('setAuth:callback'),
      'setAuth did not enter its pending boundary',
    )
    runtime.transition('33333333-3333-4333-8333-333333333333')
    pendingAuth.resolve()
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.deepEqual(
      authHarness.events,
      ['getSession', 'setAuth:callback'],
      'account replacement during setAuth must prevent channel creation',
    )
    assert.deepEqual(failures, [], 'account replacement is not a fallback-worthy setup failure')
    runtime.transition('11111111-1111-4111-8111-111111111111')
  } finally {
    runtime.dispose()
  }
})

test('intentional teardown stays intentional when removeChannel synchronously emits CLOSED', async () => {
  const runtime = await loadBoundaryRuntime()
  try {
    const harness = realtimeHarness({
      sessionPromise: Promise.resolve({
        data: {
          session: {
            user: { id: '11111111-1111-4111-8111-111111111111' },
            access_token: 'live-jwt',
          },
        },
        error: null,
      }),
      closeOnRemove: true,
    })
    const failures = []
    const unsubscribe = runtime.startPostgresChangesRealtimeChannel({
      supabase: harness.supabase,
      topic: 'messages:22222222-2222-4222-8222-222222222222',
      configure: channel => channel,
      onFailure: failure => failures.push(failure),
    })
    await new Promise(resolve => setTimeout(resolve, 0))

    unsubscribe()
    unsubscribe()
    assert.deepEqual(failures, [])
    assert.equal(
      harness.events.filter(event => event === 'removeChannel').length,
      1,
    )
  } finally {
    runtime.dispose()
  }
})

test('teardown and account replacement invalidate every late auth continuation', async () => {
  const runtime = await loadBoundaryRuntime()
  try {
    for (const mode of ['unsubscribe', 'account-switch']) {
      const session = deferred()
      const harness = realtimeHarness({ sessionPromise: session.promise })
      const unsubscribe = runtime.startPrivateRealtimeChannel({
        supabase: harness.supabase,
        topic: 'offers:22222222-2222-4222-8222-222222222222',
        configure: channel => channel,
      })
      if (mode === 'unsubscribe') unsubscribe()
      else runtime.transition('33333333-3333-4333-8333-333333333333')
      session.resolve({
        data: {
          session: {
            user: { id: '11111111-1111-4111-8111-111111111111' },
            access_token: 'stale-jwt',
          },
        },
        error: null,
      })
      await new Promise(resolve => setTimeout(resolve, 0))
      assert.deepEqual(harness.events, ['getSession'], `${mode} must prevent setAuth/channel creation`)
      if (mode === 'account-switch') {
        runtime.transition('11111111-1111-4111-8111-111111111111')
      }
    }
  } finally {
    runtime.dispose()
  }
})

test('an established channel closes immediately when its account is replaced', async () => {
  const runtime = await loadBoundaryRuntime()
  try {
    const harness = realtimeHarness({
      sessionPromise: Promise.resolve({
        data: {
          session: {
            user: { id: '11111111-1111-4111-8111-111111111111' },
            access_token: 'live-jwt',
          },
        },
        error: null,
      }),
    })
    const statuses = []
    let closed = 0
    runtime.startPrivateRealtimeChannel({
      supabase: harness.supabase,
      topic: 'meetups:22222222-2222-4222-8222-222222222222',
      configure: channel => channel,
      onStatus: status => statuses.push(status),
      onClose: () => { closed += 1 },
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    harness.status('SUBSCRIBED')
    assert.deepEqual(statuses, ['SUBSCRIBED'])

    runtime.transition('33333333-3333-4333-8333-333333333333')
    await Promise.resolve()
    assert.equal(closed, 1)
    assert.equal(harness.events.at(-1), 'removeChannel')
    harness.status('SUBSCRIBED')
    assert.deepEqual(statuses, ['SUBSCRIBED'], 'stale socket status is suppressed')
  } finally {
    runtime.dispose()
  }
})

test('user-scoped channel rejects a different active account before reading Auth', async () => {
  const runtime = await loadBoundaryRuntime()
  try {
    const harness = realtimeHarness({
      sessionPromise: Promise.resolve({ data: { session: null }, error: null }),
    })
    const unsubscribe = runtime.startPrivateRealtimeChannel({
      supabase: harness.supabase,
      expectedUserId: '99999999-9999-4999-8999-999999999999',
      topic: 'user-99999999-9999-4999-8999-999999999999-notifications',
      configure: channel => channel,
    })
    unsubscribe()
    assert.deepEqual(harness.events, [])
  } finally {
    runtime.dispose()
  }
})

test('a listener or subscribe exception removes the half-configured private channel', async () => {
  const runtime = await loadBoundaryRuntime()
  try {
    const sessionResult = Promise.resolve({
      data: {
        session: {
          user: { id: '11111111-1111-4111-8111-111111111111' },
          access_token: 'live-jwt',
        },
      },
      error: null,
    })

    for (const failAt of ['configure', 'subscribe']) {
      const harness = realtimeHarness({
        sessionPromise: sessionResult,
        subscribeError: failAt === 'subscribe' ? new Error('subscribe failed') : null,
      })
      runtime.startPrivateRealtimeChannel({
        supabase: harness.supabase,
        topic: 'messages:22222222-2222-4222-8222-222222222222',
        configure: channel => {
          if (failAt === 'configure') throw new Error('configure failed')
          return channel
        },
      })
      await new Promise(resolve => setTimeout(resolve, 0))
      assert.equal(
        harness.events.at(-1),
        'removeChannel',
        `${failAt} failure must not leak an SDK-registered channel`,
      )
    }
  } finally {
    runtime.dispose()
  }
})

test('the app has no default-public or global user-enumeration channel', async () => {
  const srcRoot = resolve(appRoot, 'src')
  const files = []
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (/\.(?:ts|vue)$/.test(entry.name)) files.push(path)
    }
  }
  await walk(srcRoot)
  const bodies = await Promise.all(files.map(path => readFile(path, 'utf8')))
  const channelOwners = files.filter((_, index) => /\.channel\s*\(/.test(bodies[index]))
  assert.deepEqual(
    channelOwners.map(path => path.slice(srcRoot.length + 1)),
    ['api/privateRealtime.ts'],
    'all Supabase channels must pass through the authenticated account boundary',
  )

  const combined = bodies.join('\n')
  assert.doesNotMatch(combined, /['"`]online-users['"`]/)
  assert.doesNotMatch(combined, /['"`]typing:/)

  assert.match(
    await source('src/composables/useRealtimeFallback.ts'),
    /startPostgresChangesRealtimeChannel/,
  )
  const realtimeBoundary = await source('src/api/privateRealtime.ts')
  assert.match(realtimeBoundary, /await setAuth\(\)/)
  assert.doesNotMatch(
    realtimeBoundary,
    /realtime\.setAuth\(session\.access_token\)/,
    'a late same-account session snapshot must never roll the shared client token back',
  )
  const supabaseOwner = await source('src/composables/useSupabase.ts')
  assert.match(
    supabaseOwner,
    /installRealtimeAuthSerialization\(sharedClient\.realtime\)[\s\S]*supabase = sharedClient/,
    'the shared Realtime client must be wrapped before it is published to app consumers',
  )
  for (const path of [
    'src/composables/useOffers.ts',
    'src/composables/useMeetups.ts',
  ]) {
    assert.match(await source(path), /subscribeToSnapshotChanges/)
  }
  assert.match(await source('src/composables/usePresence.ts'), /startPrivateRealtimeChannel/)

  const messagesPage = await source('src/pages/messages/index.vue')
  assert.doesNotMatch(messagesPage, /usePresence|isOnline|online-dot/)
  assert.doesNotMatch(await source('src/composables/i18n/messages/en.ts'), /usually replies/)
  assert.doesNotMatch(await source('src/composables/i18n/messages/zh.ts'), /通常\s*1\s*小时内回复/)
  const presence = await source('src/composables/usePresence.ts')
  assert.match(presence, /topic: `conversation:\$\{conversationId\.toLowerCase\(\)\}`/)
  assert.match(presence, /presence: \{ key: context\.userId \}/)
  assert.match(presence, /const state = trackedChannel\.presenceState\(\)/)
  assert.match(presence, /state\?\.\[expectedPeerId\]/)
  assert.match(presence, /payload\?\.user_id !== expectedPeerId/)
  assert.match(presence, /payload\?\.conversation_id !== conversationId/)
})
