import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

/*
 * Runs the real ChatThread read-receipt code, not a paraphrase of it: the three
 * regions below are sliced out of the component by their own declarations and
 * executed against stubbed collaborators, so a change to the shipped source is
 * what these assertions observe.
 */
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const chatSource = readFileSync(resolve(appRoot, 'src/components/ChatThread.vue'), 'utf8')

function slice(startMarker, endMarker, { includeEnd = false } = {}) {
  const start = chatSource.indexOf(startMarker)
  assert.ok(start >= 0, `ChatThread no longer contains ${JSON.stringify(startMarker)}`)
  const end = chatSource.indexOf(endMarker, start + startMarker.length)
  assert.ok(end > start, `ChatThread no longer contains ${JSON.stringify(endMarker)} after it`)
  return chatSource.slice(start, includeEnd ? end + endMarker.length : end)
}

const readStateSource = slice('function isThreadVisible(): boolean {', '\nfunction createOptimisticMessage(')
const incomingSource = slice('function applyIncomingMessage(', '\nfunction applyMessageUpdate(')
const threadOpenSource = slice(
  'nextTick(() => { if (isCurrentThreadSetup()) transcriptLive.value = true })',
  '\n    if (options.prefill',
)
const foregroundSource = slice(
  'onVisible = () => {',
  "document.addEventListener('visibilitychange', onVisible)",
  { includeEnd: true },
)

const harnessSource = `
export function createHarness(document, meId) {
  const conversationId = { value: 'conv-1' }
  const currentUser = { value: meId === null ? null : { id: meId } }
  const conversationDetail = { value: null }
  const transcriptLive = { value: false }
  const messages = { value: [] }
  const options = { id: 'conv-1' }
  const readWrites = []
  const backgroundFailures = []
  let onVisible = null
  let mounted = true

  const nextTick = (fn) => { if (fn) fn() }
  const scrollToBottom = () => {}
  const isCurrentThreadSetup = () => true
  const refreshItemSnapshot = () => Promise.resolve()
  const fetchMessages = () => Promise.resolve([])
  const fetchOffers = () => Promise.resolve([])
  const fetchMeetups = () => Promise.resolve([])
  const refreshUnreadCount = () => Promise.resolve()
  const markAsRead = (convId, userId) => {
    readWrites.push({ convId, userId })
    return Promise.resolve()
  }
  const reportBackgroundFailure = (source, error) => backgroundFailures.push({ source, error })

  ${readStateSource}

  ${incomingSource}

  ${foregroundSource}

  function openThread() {
    ${threadOpenSource}
  }

  return {
    open: openThread,
    deliver: (msg) => applyIncomingMessage('conv-1', msg),
    foreground: () => onVisible(),
    readWrites,
    backgroundFailures,
    get transcriptLive() { return transcriptLive.value },
    get rendered() { return messages.value.map(m => m.id) },
  }
}
`

const compiled = ts.transpileModule(harnessSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText
const { createHarness } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
)

const ME = '11111111-1111-4111-8111-111111111111'
const PEER = '22222222-2222-4222-8222-222222222222'

function fakeDocument(visibilityState) {
  const listeners = new Set()
  return {
    visibilityState,
    addEventListener: (type, listener) => { if (type === 'visibilitychange') listeners.add(listener) },
    removeEventListener: (type, listener) => listeners.delete(listener),
    listenerCount: () => listeners.size,
  }
}

function peerMessage(id) {
  return {
    id,
    conversation_id: 'conv-1',
    sender_id: PEER,
    content: 'are you around?',
    message_type: 'text',
    is_read: false,
    created_at: new Date().toISOString(),
  }
}

test('a message that arrives while the tab is hidden is not marked read', () => {
  const doc = fakeDocument('hidden')
  const harness = createHarness(doc, ME)

  harness.deliver(peerMessage('msg-hidden'))

  assert.deepEqual(harness.rendered, ['msg-hidden'], 'the message must still be delivered into the thread')
  assert.deepEqual(
    harness.readWrites,
    [],
    'a hidden tab told the sender their message had been read',
  )
})

// Control: without this the "no receipt" assertion above would also hold for a
// harness that can never write a receipt at all.
test('a message that arrives while the tab is visible is marked read on arrival', () => {
  const doc = fakeDocument('visible')
  const harness = createHarness(doc, ME)

  harness.deliver(peerMessage('msg-visible'))

  assert.deepEqual(harness.readWrites, [{ convId: 'conv-1', userId: ME }])
})

test('coming back to the tab flushes the receipt for what arrived while it was hidden', () => {
  const doc = fakeDocument('hidden')
  const harness = createHarness(doc, ME)

  harness.deliver(peerMessage('msg-deferred'))
  assert.equal(harness.readWrites.length, 0)

  doc.visibilityState = 'visible'
  harness.foreground()

  assert.deepEqual(harness.readWrites, [{ convId: 'conv-1', userId: ME }])
  assert.equal(doc.listenerCount(), 1, 'the flush must be wired to visibilitychange')
  assert.deepEqual(harness.backgroundFailures, [])
})

test('a thread that finishes opening in a hidden tab writes no receipt either', () => {
  const doc = fakeDocument('hidden')
  const harness = createHarness(doc, ME)

  harness.open()

  assert.equal(harness.transcriptLive, true, 'the thread must still finish opening')
  assert.deepEqual(harness.readWrites, [], 'a background-tab load marked the backlog read')

  doc.visibilityState = 'visible'
  harness.foreground()
  assert.deepEqual(harness.readWrites, [{ convId: 'conv-1', userId: ME }])
})

// Control: opening a visible thread is exactly when the backlog should clear.
test('a thread that opens in a visible tab clears the backlog immediately', () => {
  const harness = createHarness(fakeDocument('visible'), ME)

  harness.open()

  assert.deepEqual(harness.readWrites, [{ convId: 'conv-1', userId: ME }])
})

// Control: the gate is not the only reason a receipt can be withheld, so an
// always-hidden harness would still fail this one.
test('the recipient own echo never writes a receipt, visible or not', () => {
  const harness = createHarness(fakeDocument('visible'), ME)

  harness.deliver({ ...peerMessage('msg-mine'), sender_id: ME })

  assert.deepEqual(harness.rendered, ['msg-mine'])
  assert.deepEqual(harness.readWrites, [])
})

// Platform control: mini-program builds have no `document`, and an off-screen
// page there has already torn the thread down, so arrival is still the signal.
test('targets without a document still mark arriving messages read', () => {
  const harness = createHarness(undefined, ME)

  harness.deliver(peerMessage('msg-mp'))

  assert.deepEqual(harness.readWrites, [{ convId: 'conv-1', userId: ME }])
})
