import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const moduleUrl = new URL('../src/api/adminIdempotencyJournal.ts', import.meta.url)

async function loadModule() {
  const source = await readFile(moduleUrl, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}#${Date.now()}-${Math.random()}`)
}

function memoryStorage() {
  const values = new Map()
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  }
}

function dependencies(storage, options = {}) {
  let uuidSequence = options.uuidSequence ?? 1
  const readNow = typeof options.now === 'function'
    ? options.now
    : () => options.now ?? 1_800_000_000_000
  return {
    storage,
    digest: async data => new Uint8Array(createHash('sha256').update(data).digest()),
    createUuid: () => `00000000-0000-4000-8000-${String(uuidSequence++).padStart(12, '0')}`,
    withExclusiveLock: operation => operation(),
    ...(options.withRequestLock ? { withRequestLock: options.withRequestLock } : {}),
    now: readNow,
  }
}

test('unknown admin outcomes reuse one durable key across a page restart without persisting secrets', async () => {
  const { createAdminIdempotencyJournal } = await loadModule()
  const storage = memoryStorage()
  const firstPage = createAdminIdempotencyJournal(dependencies(storage))
  const first = await firstPage.reserve('mutation', 'iam_admin_top-secret-token', '{"action":"apply_ban"}')
  assert.equal(first.reused, false)
  assert.equal(first.resolved, false)

  const restartedPage = createAdminIdempotencyJournal(dependencies(storage, { uuidSequence: 99 }))
  const retry = await restartedPage.reserve('mutation', 'iam_admin_top-secret-token', '{"action":"apply_ban"}')
  assert.equal(retry.idempotencyKey, first.idempotencyKey)
  assert.equal(retry.reused, true)
  assert.equal(retry.resolved, false)
  assert.match(retry.idempotencyKey, /^[0-9a-f-]{36}$/)

  const persisted = [...storage.values.values()].join('\n')
  assert.doesNotMatch(persisted, /top-secret-token|apply_ban/)
})

test('a definitive result leaves a one-use tombstone before a later intent receives a new UUID', async () => {
  const { createAdminIdempotencyJournal } = await loadModule()
  const storage = memoryStorage()
  let now = 1_800_000_000_100
  const journal = createAdminIdempotencyJournal(dependencies(storage, { now: () => now }))
  const first = await journal.reserve('mutation', 'token-a', '{"action":"warn"}')
  now = 1_800_000_000_200
  await journal.release(first)

  const queuedBeforeResolution = await journal.reserve('mutation', 'token-a', '{"action":"warn"}')
  assert.equal(queuedBeforeResolution.idempotencyKey, first.idempotencyKey)
  assert.equal(queuedBeforeResolution.reused, true)
  assert.equal(queuedBeforeResolution.resolved, true)
  assert.equal(await journal.consumeResolved(queuedBeforeResolution), true)
  // A delayed handle cannot dispatch after the tombstone was consumed.
  assert.equal(await journal.consumeResolved(first), true)

  now = 1_800_000_000_201
  const next = await journal.reserve('mutation', 'token-a', '{"action":"warn"}')
  assert.notEqual(next.idempotencyKey, first.idempotencyKey)
  assert.equal(next.reused, false)
  assert.equal(next.resolved, false)
})

test('clock jumps cannot turn a queued pre-resolution handle into a new privileged write', async () => {
  const { createAdminIdempotencyJournal } = await loadModule()
  const storage = memoryStorage()
  let now = 9_000_000_000_000
  const journal = createAdminIdempotencyJournal(dependencies(storage, { now: () => now }))
  const first = await journal.reserve('mutation', 'token-clock', '{"action":"warn"}')

  // The wall clock rolls backwards before the definitive response, then far
  // forwards before the queued caller resumes. Ordering relies only on the
  // durable tombstone and locks, never on these timestamps.
  now = 1_000
  await journal.release(first)
  now = 99_000_000_000_000
  const queued = await journal.reserve('mutation', 'token-clock', '{"action":"warn"}')
  assert.equal(queued.idempotencyKey, first.idempotencyKey)
  assert.equal(queued.resolved, true)
  assert.equal(await journal.consumeResolved(queued), true)
})

test('a crash-surviving replay is distinguishable from a new intentional action', async () => {
  const { createAdminIdempotencyJournal } = await loadModule()
  const storage = memoryStorage()
  let now = 1_800_000_001_000
  const firstPage = createAdminIdempotencyJournal(dependencies(storage, { now: () => now }))
  const committedButUnobserved = await firstPage.reserve(
    'mutation',
    'token-a',
    '{"action":"set_post_pinned","pinned":true}',
  )

  // Simulate a page crash after the server committed but before release().
  now = 1_800_000_001_100
  const restartedPage = createAdminIdempotencyJournal(dependencies(storage, {
    uuidSequence: 99,
    now: () => now,
  }))
  const reconciliation = await restartedPage.reserve(
    'mutation',
    'token-a',
    '{"action":"set_post_pinned","pinned":true}',
  )
  assert.equal(reconciliation.idempotencyKey, committedButUnobserved.idempotencyKey)
  assert.equal(reconciliation.reused, true)
  assert.equal(reconciliation.resolved, false)

  // Once the old result is definitively reconciled, the tombstone is consumed
  // under the request lock before a later user click can receive a fresh key.
  now = 1_800_000_001_200
  await restartedPage.release(reconciliation)
  assert.equal(await restartedPage.consumeResolved(reconciliation), true)
  now = 1_800_000_001_201
  const intentionalRetry = await restartedPage.reserve(
    'mutation',
    'token-a',
    '{"action":"set_post_pinned","pinned":true}',
  )
  assert.equal(intentionalRetry.reused, false)
  assert.equal(intentionalRetry.resolved, false)
  assert.notEqual(intentionalRetry.idempotencyKey, reconciliation.idempotencyKey)
})

test('two callers reserved before dispatch produce only one network operation', async () => {
  const { createAdminIdempotencyJournal } = await loadModule()
  const journal = createAdminIdempotencyJournal(dependencies(memoryStorage()))
  const first = await journal.reserve('mutation', 'token-a', '{"action":"delete_banner"}')
  const queued = await journal.reserve('mutation', 'token-a', '{"action":"delete_banner"}')
  assert.equal(queued.idempotencyKey, first.idempotencyKey)

  let dispatches = 0
  await journal.withRequestLock(async () => {
    assert.equal(await journal.consumeResolved(first), false)
    dispatches += 1
    await journal.release(first)
  })
  await journal.withRequestLock(async () => {
    assert.equal(await journal.consumeResolved(queued), true)
  })
  assert.equal(dispatches, 1)
})

test('the dispatch-time global barrier blocks unknown and unacknowledged outcomes across tabs', async () => {
  const { createAdminIdempotencyJournal } = await loadModule()
  const storage = memoryStorage()
  const firstPage = createAdminIdempotencyJournal(dependencies(storage))
  const first = await firstPage.reserve('mutation', 'token-a', '{"action":"warn"}')
  const sameIntentQueuedBeforeDispatch = await firstPage.reserve(
    'mutation',
    'token-a',
    '{"action":"warn"}',
  )
  // Model a second tab that reserved a different intent before the first tab
  // acquired the origin-wide request lock.
  const alreadyQueued = await firstPage.reserve('mutation', 'token-a', '{"action":"ban"}')

  assert.equal(await firstPage.markDispatched(first), false)
  // The state is read atomically when the queued same-key caller eventually
  // acquires the request lock; its stale reserve-time snapshot cannot erase it.
  assert.equal(await firstPage.markDispatched(sameIntentQueuedBeforeDispatch), true)
  assert.equal(await firstPage.hasOtherUnacknowledged(first), false)
  assert.equal(await firstPage.hasOtherUnacknowledged(alreadyQueued), true)

  const blocked = await firstPage.reserve('mutation', 'token-a', '{"action":"delete"}')
  assert.equal(blocked.reused, false)
  assert.equal(blocked.resolved, false)
  assert.equal(await firstPage.hasOtherUnacknowledged(blocked), true)

  // A restarted page may reconcile only the exact same intent and key.
  const restartedPage = createAdminIdempotencyJournal(dependencies(storage, { uuidSequence: 99 }))
  const retry = await restartedPage.reserve('mutation', 'token-a', '{"action":"warn"}')
  assert.equal(retry.idempotencyKey, first.idempotencyKey)
  assert.equal(retry.reused, true)
  assert.equal(await restartedPage.markDispatched(retry), true)
  await restartedPage.release(retry)
  // Seeing a 2xx is not enough: until the exact caller applies/reloads UI and
  // acknowledges, another tab's different intent remains non-dispatchable.
  assert.equal(await restartedPage.hasOtherUnacknowledged(alreadyQueued), true)
  // A single in-process batch may explicitly carry its own earlier definitive
  // receipt to the next dispatch while one outer request lock is still held.
  assert.equal(await restartedPage.hasOtherUnacknowledged(alreadyQueued, [retry]), false)
  assert.equal(await restartedPage.consumeResolved(retry), true)

  // Once the exact outcome is definitive, the previously queued distinct
  // intent is eligible to dispatch.
  assert.equal(await restartedPage.hasOtherUnacknowledged(alreadyQueued), false)
  const queuedRetry = await restartedPage.reserve('mutation', 'token-a', '{"action":"ban"}')
  assert.equal(queuedRetry.reused, true)
  // This key was merely reserved before A became unknown. It must not inherit
  // A's sticky-unknown state or turn a deterministic B rejection into a
  // permanent global barrier.
  assert.equal(await restartedPage.markDispatched(queuedRetry), false)
  await restartedPage.release(queuedRetry)
  assert.equal(await restartedPage.consumeResolved(queuedRetry), true)
  const afterDefinitiveB = await restartedPage.reserve(
    'mutation',
    'token-a',
    '{"action":"after-b"}',
  )
  assert.equal(afterDefinitiveB.resolved, false)
  const persisted = [...storage.values.values()].join('\n')
  assert.doesNotMatch(persisted, /token-a|warn|ban|delete/)
})

test('a batch allowlist never masks an external unacknowledged outcome', async () => {
  const { createAdminIdempotencyJournal } = await loadModule()
  const journal = createAdminIdempotencyJournal(dependencies(memoryStorage()))
  const firstBatch = await journal.reserve('mutation', 'token-a', 'batch-a')
  const secondBatch = await journal.reserve('mutation', 'token-a', 'batch-b')
  const external = await journal.reserve('mutation', 'token-a', 'external')
  const current = await journal.reserve('mutation', 'token-a', 'batch-c')

  await journal.markDispatched(firstBatch)
  await journal.release(firstBatch)
  await journal.markDispatched(secondBatch)
  await journal.release(secondBatch)
  await journal.markDispatched(external)
  await journal.release(external)

  assert.equal(
    await journal.hasOtherUnacknowledged(current, [firstBatch, secondBatch]),
    true,
  )
  assert.equal(
    await journal.hasOtherUnacknowledged(current, [firstBatch, secondBatch, external]),
    false,
  )
})

test('capacity emits a reconciliation barrier and explicit re-unlock compacts only resolved entries', async () => {
  const { createAdminIdempotencyJournal } = await loadModule()
  const storage = memoryStorage()
  const journal = createAdminIdempotencyJournal(dependencies(storage))
  let unresolved
  let oldResolved
  for (let index = 0; index < 4096; index += 1) {
    const handle = await journal.reserve('mutation', 'capacity-token', `payload-${index}`)
    if (index === 0) unresolved = handle
    else {
      await journal.release(handle)
      if (index === 1) oldResolved = handle
    }
  }

  const barrier = await journal.reserve('mutation', 'capacity-token', 'payload-over-capacity')
  assert.equal(barrier.reused, true)
  assert.equal(barrier.resolved, true)
  assert.equal(await journal.consumeResolved(barrier), true)

  // This models successful explicit admin re-authentication while holding the
  // origin-wide request lock. Unknown outcomes survive; definitive markers do not.
  const removed = await journal.withRequestLock(async () => journal.clearResolved())
  assert.equal(removed, 4095)
  const persisted = JSON.parse([...storage.values.values()][0])
  assert.deepEqual(persisted.entries.map(entry => entry.key), [unresolved.idempotencyKey])
  assert.equal(await journal.consumeResolved(oldResolved), true)

  const afterUnlock = await journal.reserve('mutation', 'capacity-token', 'payload-over-capacity')
  assert.equal(afterUnlock.reused, false)
  assert.equal(afterUnlock.resolved, false)
})

test('recovery inspection exposes only opaque keys and never silently clears definitive results', async () => {
  const { createAdminIdempotencyJournal } = await loadModule()
  const storage = memoryStorage()
  const journal = createAdminIdempotencyJournal(dependencies(storage))
  const resolved = await journal.reserve('mutation', 'token-secret', '{"private":"resolved"}')
  await journal.markDispatched(resolved)
  await journal.release(resolved)
  const unknown = await journal.reserve('mutation', 'token-secret', '{"private":"unknown"}')
  await journal.reserve('mutation', 'token-secret', '{"private":"reserved-only"}')
  await journal.markDispatched(unknown)

  const before = await journal.inspect()
  assert.equal(before.resolvedCount, 1)
  assert.equal(before.reservedCount, 1)
  assert.deepEqual(before.unknown.map(entry => entry.idempotencyKey), [unknown.idempotencyKey])
  assert.equal(before.unknown[0].recordId, unknown.recordId)
  assert.equal(typeof before.unknown[0].dispatchedAt, 'number')
  assert.equal(await journal.isResolvedOrSuperseded(resolved), true)
  assert.equal((await journal.inspect()).resolvedCount, 1)

  assert.equal(await journal.discardUndispatched(), 1)
  const afterDiscard = await journal.inspect()
  assert.equal(afterDiscard.resolvedCount, 1)
  assert.equal(afterDiscard.unknown.length, 1)
  const persisted = [...storage.values.values()].join('\n')
  assert.doesNotMatch(persisted, /token-secret|"private"|reserved-only/)
})

test('the request lease serializes reserve-through-response operations', async () => {
  const { createAdminIdempotencyJournal } = await loadModule()
  const journal = createAdminIdempotencyJournal(dependencies(memoryStorage()))
  const events = []
  let releaseFirst
  const firstGate = new Promise(resolve => { releaseFirst = resolve })

  const first = journal.withRequestLock(async () => {
    events.push('first:start')
    await firstGate
    events.push('first:end')
  })
  await Promise.resolve()
  const second = journal.withRequestLock(async () => {
    events.push('second:start')
    events.push('second:end')
  })
  await Promise.resolve()
  assert.deepEqual(events, ['first:start'])

  releaseFirst()
  await Promise.all([first, second])
  assert.deepEqual(events, ['first:start', 'first:end', 'second:start', 'second:end'])
})

test('payload bytes, scope and admin token all isolate journal records', async () => {
  const { createAdminIdempotencyJournal } = await loadModule()
  const journal = createAdminIdempotencyJournal(dependencies(memoryStorage()))
  const base = await journal.reserve('banner-upload', 'token-a', new Uint8Array([1, 2, 3]))
  const changedBytes = await journal.reserve('banner-upload', 'token-a', new Uint8Array([1, 2, 4]))
  const changedToken = await journal.reserve('banner-upload', 'token-b', new Uint8Array([1, 2, 3]))
  const changedScope = await journal.reserve('mutation', 'token-a', new Uint8Array([1, 2, 3]))
  assert.equal(new Set([base.recordId, changedBytes.recordId, changedToken.recordId, changedScope.recordId]).size, 4)
})

test('corrupt or unverifiable durable storage fails closed before a request can be dispatched', async () => {
  const { createAdminIdempotencyJournal, AdminIdempotencyJournalError } = await loadModule()
  const corrupt = memoryStorage()
  corrupt.values.set('caaci.admin-idempotency-journal.v1', '{not-json')
  const corruptJournal = createAdminIdempotencyJournal(dependencies(corrupt))
  await assert.rejects(
    corruptJournal.reserve('mutation', 'token-a', '{}'),
    error => error instanceof AdminIdempotencyJournalError,
  )

  const droppedWrites = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  }
  const droppedJournal = createAdminIdempotencyJournal(dependencies(droppedWrites))
  await assert.rejects(
    droppedJournal.reserve('mutation', 'token-a', '{}'),
    error => error instanceof AdminIdempotencyJournalError,
  )

  const impossibleState = memoryStorage()
  impossibleState.values.set('caaci.admin-idempotency-journal.v1', JSON.stringify({
    version: 1,
    entries: [{
      id: 'a'.repeat(64),
      key: '00000000-0000-4000-8000-000000000001',
      createdAt: 100,
      dispatchedAt: 101,
      resolvedAt: 102,
    }],
  }))
  const impossibleJournal = createAdminIdempotencyJournal(dependencies(impossibleState))
  await assert.rejects(
    impossibleJournal.reserve('mutation', 'token-a', '{}'),
    error => error instanceof AdminIdempotencyJournalError,
  )
})
