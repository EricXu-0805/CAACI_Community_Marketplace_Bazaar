import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import ts from 'typescript'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = relativePath => readFile(resolve(appRoot, relativePath), 'utf8')

function deferred() {
  let resolvePromise
  const promise = new Promise(resolve => { resolvePromise = resolve })
  return { promise, resolve: resolvePromise }
}

async function loadBoundaryRuntime() {
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
  const compiled = ts.transpileModule(input, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText
  const module = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

  return {
    ...module,
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
  authPromise = Promise.resolve(),
  subscribeError = null,
}) {
  const events = []
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
        return sessionPromise
      },
    },
    realtime: {
      async setAuth(token) {
        events.push(`setAuth:${token}`)
        await authPromise
      },
    },
    channel(topic, options) {
      events.push({ topic, options })
      return channel
    },
    removeChannel(value) {
      assert.equal(value, channel)
      events.push('removeChannel')
      return Promise.resolve('ok')
    },
  }
  return { supabase, channel, events, status: (value) => statusCallback?.(value) }
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
    await Promise.resolve()
    assert.deepEqual(harness.events, ['getSession', 'setAuth:test-jwt'])

    setAuth.resolve()
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(harness.events[2].topic, 'messages:22222222-2222-4222-8222-222222222222')
    assert.deepEqual(harness.events[2].options, {
      config: { broadcast: { self: false }, private: true },
    })
    assert.equal(harness.events[3], 'subscribe')
    harness.status('SUBSCRIBED')
    assert.deepEqual(statuses, ['SUBSCRIBED'])

    unsubscribe()
    await Promise.resolve()
    assert.equal(harness.events.at(-1), 'removeChannel')
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
    'all Supabase channels must pass through the private authenticated boundary',
  )

  const combined = bodies.join('\n')
  assert.doesNotMatch(combined, /['"`]online-users['"`]/)
  assert.doesNotMatch(combined, /['"`]typing:/)

  for (const path of [
    'src/composables/useRealtimeFallback.ts',
    'src/composables/useOffers.ts',
    'src/composables/useMeetups.ts',
    'src/composables/usePresence.ts',
  ]) {
    assert.match(await source(path), /startPrivateRealtimeChannel/)
  }

  const messagesPage = await source('src/pages/messages/index.vue')
  assert.doesNotMatch(messagesPage, /usePresence|isOnline|online-dot/)
  assert.doesNotMatch(await source('src/composables/i18n/messages/en.ts'), /usually replies/)
  assert.doesNotMatch(await source('src/composables/i18n/messages/zh.ts'), /通常\s*1\s*小时内回复/)
  const presence = await source('src/composables/usePresence.ts')
  assert.match(presence, /topic: `conversation:\$\{conversationId\.toLowerCase\(\)\}`/)
  assert.match(presence, /presence: \{ key: context\.userId \}/)
  assert.match(presence, /privateChannel\.presenceState\(\)/)
  assert.match(presence, /state\?\.\[expectedPeerId\]/)
  assert.match(presence, /payload\?\.user_id !== expectedPeerId/)
  assert.match(presence, /payload\?\.conversation_id !== conversationId/)
})
