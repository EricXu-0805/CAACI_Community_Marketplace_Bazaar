import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from '../node_modules/typescript/lib/typescript.js'

const moduleUrl = new URL('../src/api/adminSupportReply.ts', import.meta.url)

async function loadModule() {
  const source = await readFile(moduleUrl, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}#${Date.now()}-${Math.random()}`)
}

function deferred() {
  let resolve, reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function memoryStorage() {
  const values = new Map()
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: key => { values.delete(key) },
  }
}

function serializedLock() {
  let tail = Promise.resolve()
  return operation => {
    const result = tail.then(operation)
    tail = result.then(() => {}, () => {})
    return result
  }
}

const actorA = '11111111-1111-4111-8111-111111111111'
const actorB = '22222222-2222-4222-8222-222222222222'
const requestA = '33333333-3333-4333-8333-333333333333'
const requestB = '44444444-4444-4444-8444-444444444444'
const providerId = '55555555-5555-4555-8555-555555555555'

const support = await loadModule()

function receipt(requestId, status = 'sent', extra = {}) {
  return {
    request_id: requestId,
    status,
    provider_id: status === 'sent' ? providerId : null,
    to: 'recipient@example.invalid',
    subject: 'Your marketplace question',
    created_at: '2026-10-03T14:00:00.000Z',
    ...extra,
  }
}

function harness(options = {}) {
  const storage = options.storage ?? memoryStorage()
  const store = options.store ?? support.createSupportReceiptStore(storage, options.actor ?? actorA)
  const state = support.createSupportReplyState()
  const calls = { statuses: 0, receipts: [], sends: [] }
  const controller = support.createSupportReplyController(state, {
    store,
    uuid: options.uuid ?? (() => requestA),
    withLock: options.withLock ?? serializedLock(),
    transport: {
      async status() {
        calls.statuses += 1
        return options.status ? options.status() : {
          available: true, from: support.SUPPORT_FROM, reply_to: support.SUPPORT_FROM,
        }
      },
      async receipt(requestId) {
        calls.receipts.push(requestId)
        return options.receipt ? options.receipt(requestId) : receipt(requestId)
      },
      async send(payload) {
        calls.sends.push(structuredClone(payload))
        return options.send ? options.send(payload) : receipt(payload.request_id)
      },
    },
  })
  return { state, controller, calls, storage, store }
}

async function reviewed(h, values = {}) {
  h.controller.initialize()
  await h.controller.refreshAvailability()
  for (const [key, value] of Object.entries({
    to: 'recipient@example.invalid',
    subject: 'Your marketplace question',
    text: 'Private reply body.\nSecond line.',
    context: 'Private incoming message and case notes.',
    inReplyTo: '<original-message@example.invalid>',
    ...values,
  })) h.controller.updateDraft(key, value)
  h.controller.review()
  assert.ok(h.state.preview)
}

test('durable storage contains only opaque request UUIDs scoped to the exact admin actor', () => {
  const storage = memoryStorage()
  const first = support.createSupportReceiptStore(storage, actorA)
  const rotatedTokenSameActor = support.createSupportReceiptStore(storage, actorA.toUpperCase())
  const other = support.createSupportReceiptStore(storage, actorB)
  first.write(requestA)
  assert.equal(rotatedTokenSameActor.read(), requestA)
  assert.equal(other.read(), null)
  assert.deepEqual([...storage.values.values()], [requestA])
  assert.ok([...storage.values.keys()].every(key => key.includes(actorA)))

  other.write(requestB)
  assert.equal(first.read(), requestA)
  assert.equal(other.read(), requestB)
  assert.throws(() => first.write(requestB))
  assert.throws(() => first.remove(requestB))
  assert.equal(first.read(), requestA)
  first.remove(requestA)
  assert.equal(first.read(), null)
  assert.equal(other.read(), requestB)

  assert.throws(() => support.createSupportReceiptStore(storage, 'iam_admin_secret-token'))
  assert.throws(() => first.write('recipient@example.invalid'))
  storage.values.set(`caaci.support-reply.v1.${actorA}`, 'private draft instead of UUID')
  assert.throws(() => first.read())
})

test('initialization restores an opaque receipt without sending or fetching any private data', async () => {
  const h = harness()
  h.store.write(requestA)
  h.controller.initialize()
  h.controller.initialize()
  assert.equal(h.state.requestId, requestA)
  assert.deepEqual(h.calls, { statuses: 0, receipts: [], sends: [] })
  assert.deepEqual(h.state.draft, support.createSupportReplyState().draft)
  await h.controller.checkReceipt()
  assert.deepEqual(h.calls.receipts, [requestA])
  assert.equal(h.state.receipt.status, 'sent')
  assert.equal(h.calls.sends.length, 0)
  assert.equal(h.store.read(), requestA, 'a definitive receipt still needs explicit acknowledgement')
  await h.controller.finish()
  assert.equal(h.store.read(), null)
  assert.equal(h.state.requestId, null)
})

test('delayed unchanged field events preserve the reviewed snapshot without authorizing an automatic send', async () => {
  const h = harness()
  await reviewed(h)
  const preview = h.state.preview
  for (const field of ['to', 'subject', 'text', 'context', 'inReplyTo']) {
    h.controller.updateDraft(field, h.state.draft[field])
    assert.equal(h.state.preview, preview, field)
    assert.equal(h.state.error, '', field)
  }
  assert.equal(h.calls.sends.length, 0)
  assert.equal(h.store.read(), null)

  h.controller.updateDraft('text', `${h.state.draft.text} `)
  assert.equal(h.state.preview, null, 'even a whitespace edit changes the exact outgoing message')
  h.controller.updateDraft('text', h.state.draft.text)
  assert.equal(h.state.preview, null, 'a repeated value cannot restore an invalidated review')
  await h.controller.sendConfirmed()
  assert.equal(h.calls.sends.length, 0)
  assert.equal(h.store.read(), null)
})

test('every draft edit invalidates the reviewed snapshot, and direct stale changes cannot dispatch', async () => {
  for (const field of ['to', 'subject', 'text', 'context', 'inReplyTo']) {
    const h = harness()
    await reviewed(h)
    h.controller.updateDraft(field, `${h.state.draft[field]} changed`)
    assert.equal(h.state.preview, null, field)
    await h.controller.sendConfirmed()
    assert.equal(h.calls.sends.length, 0, field)
    assert.equal(h.store.read(), null, field)
  }

  const h = harness()
  await reviewed(h)
  h.state.draft.text = 'Changed outside the normal input event'
  await h.controller.sendConfirmed()
  assert.equal(h.state.preview, null)
  assert.equal(h.state.error, 'reviewAgain')
  assert.equal(h.calls.sends.length, 0)
  assert.equal(h.store.read(), null)
})

test('review rejects header injection, multiple recipients, empty replies, and invalid message IDs', async () => {
  for (const [field, value, error] of [
    ['to', 'one@example.invalid,two@example.invalid', 'recipient'],
    ['to', 'person@example.invalid\r\nBcc: other@example.invalid', 'recipient'],
    ['to', '.person@example.invalid', 'recipient'],
    ['subject', 'Question\r\nBcc: other@example.invalid', 'subject'],
    ['subject', '\u202Ehidden subject', 'subject'],
    ['text', ' \n\t ', 'text'],
    ['text', 'reply\0body', 'text'],
    ['inReplyTo', '<id@example.invalid>\r\nBcc: other@example.invalid', 'messageId'],
  ]) {
    const h = harness()
    await reviewed(h)
    h.controller.updateDraft(field, value)
    h.controller.review()
    assert.equal(h.state.error, error, field)
    assert.equal(h.state.preview, null)
    await h.controller.sendConfirmed()
    assert.equal(h.calls.sends.length, 0)
  }
})

test('one confirmed send persists its UUID first and excludes local context and unapproved headers', async () => {
  const storage = memoryStorage()
  const h = harness({
    storage,
    send: payload => {
      assert.deepEqual([...storage.values.values()], [payload.request_id], 'reserve must be durable before POST')
      return receipt(payload.request_id)
    },
  })
  await reviewed(h, { to: '  recipient@example.invalid  ' })
  await h.controller.sendConfirmed()
  assert.deepEqual(h.calls.sends, [{
    action: 'send_support_reply',
    request_id: requestA,
    to: 'recipient@example.invalid',
    subject: 'Your marketplace question',
    text: 'Private reply body.\nSecond line.',
    in_reply_to: '<original-message@example.invalid>',
  }])
  assert.deepEqual(h.state.receipt, receipt(requestA))
  assert.equal(h.state.preview, null)
  assert.deepEqual(h.state.draft, support.createSupportReplyState().draft)
  assert.deepEqual([...storage.values.values()], [requestA])
  const durable = JSON.stringify([...storage.values])
  assert.doesNotMatch(durable, /recipient|marketplace question|Private|original-message|provider data|iam_admin/)
})

test('double confirmation is single-flight before the lock or transport can settle', async () => {
  const pending = deferred()
  const dispatched = deferred()
  const h = harness({ send: () => { dispatched.resolve(); return pending.promise } })
  await reviewed(h)
  const first = h.controller.sendConfirmed()
  assert.equal(h.state.busy, true)
  const second = h.controller.sendConfirmed()
  await dispatched.promise
  assert.equal(h.calls.sends.length, 1)
  h.controller.updateDraft('text', 'A racing edit')
  assert.equal(h.state.draft.text, 'Private reply body.\nSecond line.')
  pending.resolve(receipt(requestA))
  await Promise.all([first, second])
  assert.equal(h.calls.sends.length, 1)
  assert.equal(h.state.busy, false)
})

test('two tabs sharing an actor adopt the reserved receipt instead of dispatching separate sends', async () => {
  const storage = memoryStorage()
  const withLock = serializedLock()
  const pending = deferred()
  const first = harness({ storage, withLock, uuid: () => requestA, send: () => pending.promise })
  const second = harness({ storage, withLock, uuid: () => requestB })
  await Promise.all([reviewed(first), reviewed(second)])
  const sending = first.controller.sendConfirmed()
  await second.controller.sendConfirmed()
  assert.equal(first.calls.sends.length, 1)
  assert.equal(second.calls.sends.length, 0)
  assert.equal(second.state.requestId, requestA)
  assert.equal(second.state.preview, null)
  assert.deepEqual(second.state.draft, support.createSupportReplyState().draft)
  assert.deepEqual([...storage.values.values()], [requestA])
  pending.resolve(receipt(requestA))
  await sending
})

test('unknown and pending outcomes retain the receipt and never retry a POST', async () => {
  for (const initial of ['network-error', 'pending', 'unknown']) {
    const h = harness({
      send: payload => {
        if (initial === 'network-error') throw new Error('secret provider diagnostics')
        return receipt(payload.request_id, initial)
      },
      receipt: requestId => receipt(requestId, 'unknown'),
    })
    await reviewed(h)
    await h.controller.sendConfirmed()
    assert.equal(h.state.requestId, requestA)
    assert.equal(h.store.read(), requestA)
    if (initial === 'network-error') assert.equal(h.state.error, 'unknown')
    await h.controller.sendConfirmed()
    await h.controller.checkReceipt()
    await h.controller.finish()
    await h.controller.sendConfirmed()
    assert.equal(h.calls.sends.length, 1, initial)
    assert.equal(h.store.read(), requestA, initial)
    assert.equal(h.state.receipt.status, 'unknown')
    assert.doesNotMatch(JSON.stringify(h.state), /secret provider diagnostics/)
  }
})

test('unavailable, misconfigured, and failing status checks cannot enable a send', async () => {
  for (const status of [
    () => ({ available: false, from: support.SUPPORT_FROM, reply_to: support.SUPPORT_FROM }),
    () => ({ available: true, from: 'other@example.invalid', reply_to: support.SUPPORT_FROM }),
    () => ({ available: true, from: support.SUPPORT_FROM, reply_to: 'other@example.invalid' }),
    () => { throw new Error('private environment failure') },
  ]) {
    const h = harness({ status })
    h.controller.initialize()
    await h.controller.refreshAvailability()
    assert.equal(h.state.availability, 'unavailable')
    h.state.draft = {
      to: 'recipient@example.invalid', subject: 'Question', text: 'Reply', context: '', inReplyTo: '',
    }
    h.controller.review()
    assert.equal(h.state.preview, null)
    await h.controller.sendConfirmed()
    assert.equal(h.calls.sends.length, 0)
    assert.equal(h.store.read(), null)
  }
})

test('receipt reads are single-flight and reject mismatched or malformed response evidence', async () => {
  const pending = deferred()
  const h = harness({ receipt: () => pending.promise })
  h.store.write(requestA)
  h.controller.initialize()
  const first = h.controller.checkReceipt()
  const second = h.controller.checkReceipt()
  assert.deepEqual(h.calls.receipts, [requestA])
  pending.resolve(receipt(requestB))
  await Promise.all([first, second])
  assert.equal(h.state.receipt, null)
  assert.equal(h.state.error, 'receipt')
  assert.equal(h.store.read(), requestA)
  await h.controller.finish()
  assert.equal(h.store.read(), requestA)

  for (const bad of [
    { status: 'delivered' },
    { provider_id: 'secret provider diagnostics' },
    { to: 'recipient@example.invalid\r\nBcc: other@example.invalid' },
    { subject: 'Question\u202Ehidden' },
    { created_at: 'invalid-date' },
  ]) {
    const malformed = harness({ receipt: requestId => receipt(requestId, 'sent', bad) })
    malformed.store.write(requestA)
    malformed.controller.initialize()
    await malformed.controller.checkReceipt()
    assert.equal(malformed.state.receipt, null)
    assert.equal(malformed.state.error, 'receipt')
    assert.equal(malformed.calls.sends.length, 0)
  }
})

test('disposal clears private state and ignores late availability, receipt, and send responses', async () => {
  const statusWait = deferred()
  const availability = harness({ status: () => statusWait.promise })
  const refreshing = availability.controller.refreshAvailability()
  availability.controller.dispose()
  statusWait.resolve({ available: true, from: support.SUPPORT_FROM, reply_to: support.SUPPORT_FROM })
  await refreshing
  assert.deepEqual(availability.state, support.createSupportReplyState())

  const receiptWait = deferred()
  const recovering = harness({ receipt: () => receiptWait.promise })
  recovering.store.write(requestA)
  recovering.controller.initialize()
  const checking = recovering.controller.checkReceipt()
  recovering.controller.dispose()
  receiptWait.resolve(receipt(requestA))
  await checking
  assert.deepEqual(recovering.state, support.createSupportReplyState())
  assert.equal(recovering.store.read(), requestA)

  for (const reject of [false, true]) {
    const sendWait = deferred()
    const dispatched = deferred()
    const sending = harness({ send: () => { dispatched.resolve(); return sendWait.promise } })
    await reviewed(sending)
    const completion = sending.controller.sendConfirmed()
    await dispatched.promise
    assert.equal(sending.calls.sends.length, 1)
    sending.controller.dispose()
    if (reject) sendWait.reject(new Error('private late failure'))
    else sendWait.resolve(receipt(requestA))
    await completion
    assert.deepEqual(sending.state, support.createSupportReplyState())
    assert.equal(sending.store.read(), requestA)
    await sending.controller.checkReceipt()
    await sending.controller.sendConfirmed()
    assert.equal(sending.calls.receipts.length, 0)
    assert.equal(sending.calls.sends.length, 1)
  }
})

test('disposing a queued sender prevents reservation and dispatch when its lock eventually opens', async () => {
  const gate = deferred()
  const h = harness({ withLock: async operation => { await gate.promise; return operation() } })
  await reviewed(h)
  const queued = h.controller.sendConfirmed()
  h.controller.dispose()
  gate.resolve()
  await queued
  assert.equal(h.calls.sends.length, 0)
  assert.equal(h.store.read(), null)
  assert.deepEqual(h.state, support.createSupportReplyState())
})

test('storage failures and failed persistence verification prevent provider dispatch', async () => {
  for (const storage of [
    { getItem() { throw new Error('read denied') }, setItem() {}, removeItem() {} },
    { getItem() { return null }, setItem() { throw new Error('quota') }, removeItem() {} },
    { getItem() { return null }, setItem() {}, removeItem() {} },
  ]) {
    const h = harness({ storage })
    h.controller.initialize()
    await h.controller.refreshAvailability()
    for (const [key, value] of Object.entries({
      to: 'recipient@example.invalid', subject: 'Question', text: 'Reply', context: '', inReplyTo: '',
    })) h.controller.updateDraft(key, value)
    h.controller.review()
    await h.controller.sendConfirmed()
    assert.equal(h.calls.sends.length, 0)
    assert.equal(h.state.error, 'storage')
  }
})

test('acknowledging an older terminal receipt cannot erase a newer tab reservation', async () => {
  const h = harness()
  await reviewed(h)
  await h.controller.sendConfirmed()
  h.store.remove(requestA)
  h.store.write(requestB)
  await h.controller.finish()
  assert.equal(h.store.read(), requestB)
  assert.equal(h.state.requestId, requestA)
  assert.equal(h.state.error, 'storage')
  assert.equal(h.calls.sends.length, 1)
})

test('draft validation accepts exact limits and rejects malformed DNS, Unicode, and Message-ID boundaries', () => {
  const valid = {
    to: 'recipient@example.invalid', subject: 'Question', text: 'Reply', context: '', inReplyTo: '',
  }
  const maximumRecipient = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`
  assert.equal(maximumRecipient.length, 254)
  for (const draft of [
    { to: maximumRecipient },
    { to: `person@example.${'a'.repeat(63)}` },
    { subject: '😀'.repeat(100) },
    { text: 'a'.repeat(10000) },
    { text: 'Unicode reply 😀\tTabbed\r\nNew line\nLast line' },
    { context: 'a'.repeat(10000) },
    { inReplyTo: '<original.message+tag@mail.example.invalid>' },
    { inReplyTo: '<original-message@internal>' },
  ]) assert.equal(support.supportDraftError({ ...valid, ...draft }), '', JSON.stringify(draft).slice(0, 100))

  for (const [field, value, error] of [
    ['to', `${maximumRecipient}d`, 'recipient'],
    ['to', `${'a'.repeat(65)}@example.invalid`, 'recipient'],
    ['to', `person@${'a'.repeat(64)}.invalid`, 'recipient'],
    ['to', `person@example.${'a'.repeat(64)}`, 'recipient'],
    ['to', 'person@example.a', 'recipient'],
    ['to', 'person@example.12', 'recipient'],
    ['to', 'person@-example.invalid', 'recipient'],
    ['to', 'person@example-.invalid', 'recipient'],
    ['to', 'person@example..invalid', 'recipient'],
    ['to', 'person@例子.invalid', 'recipient'],
    ['subject', 'a'.repeat(201), 'subject'],
    ['subject', ' \t ', 'subject'],
    ['subject', 'Question\uD800', 'subject'],
    ['subject', 'Question\uDC00', 'subject'],
    ['text', 'a'.repeat(10001), 'text'],
    ['text', 'Reply\uD800', 'text'],
    ['text', 'Reply\uDC00', 'text'],
    ['context', 'a'.repeat(10001), 'context'],
    ['inReplyTo', '<original.消息@example.invalid>', 'messageId'],
    ['inReplyTo', '<original@例子.invalid>', 'messageId'],
    ['inReplyTo', '<original@[127.0.0.1]>', 'messageId'],
    ['inReplyTo', '<"original"@example.invalid>', 'messageId'],
    ['inReplyTo', '<original..message@example.invalid>', 'messageId'],
    ['inReplyTo', '<original@example.invalid.>', 'messageId'],
  ]) assert.equal(support.supportDraftError({ ...valid, [field]: value }), error, `${field}: ${JSON.stringify(value).slice(0, 100)}`)

  for (const codePoint of [0, 1, 8, 11, 12, 14, 31, 127, 128, 159]) {
    assert.equal(support.supportDraftError({ ...valid, text: `Reply${String.fromCodePoint(codePoint)}` }), 'text', `control ${codePoint}`)
  }
})

test('exact receipt fields, provider evidence, timestamps, and nonempty subjects are mandatory', async () => {
  const missingField = receipt(requestA)
  delete missingField.provider_id
  for (const invalidReceipt of [
    receipt(requestA, 'sent', { provider_id: null }),
    receipt(requestA, 'pending', { provider_id: providerId }),
    receipt(requestA, 'unknown', { provider_id: providerId }),
    receipt(requestA, 'failed', { provider_id: providerId }),
    receipt(requestA, 'sent', { unexpected_provider_body: 'private provider data' }),
    missingField,
    receipt(requestA, 'sent', { created_at: 'October 3, 2026' }),
    receipt(requestA, 'sent', { created_at: '2026-10-03' }),
    receipt(requestA, 'sent', { created_at: '2026-10-03 14:00:00Z' }),
    receipt(requestA, 'sent', { subject: '' }),
    receipt(requestA, 'sent', { subject: '   ' }),
    receipt(requestA, 'sent', { subject: 'Question\uD800' }),
    receipt(requestA, 'sent', { to: `person@${'a'.repeat(64)}.invalid` }),
  ]) {
    const h = harness({ receipt: () => invalidReceipt })
    h.store.write(requestA)
    h.controller.initialize()
    await h.controller.checkReceipt()
    assert.equal(h.state.error, 'receipt')
    assert.equal(h.state.receipt, null)
    await h.controller.finish()
    await h.controller.sendConfirmed()
    assert.equal(h.store.read(), requestA)
    assert.equal(h.state.requestId, requestA)
    assert.equal(h.calls.sends.length, 0)
    assert.doesNotMatch(JSON.stringify(h.state), /private provider data/)
  }
})

test('POST evidence must match the confirmed recipient and subject before a receipt can be acknowledged', async () => {
  for (const changed of [
    { to: 'different-recipient@example.invalid' },
    { subject: 'Different outgoing subject' },
    { unexpected_provider_body: 'private provider data' },
    { provider_id: null },
  ]) {
    const h = harness({ send: request => receipt(request.request_id, 'sent', changed) })
    await reviewed(h)
    await h.controller.sendConfirmed()
    assert.equal(h.state.receipt, null)
    assert.equal(h.state.error, 'unknown')
    assert.equal(h.state.requestId, requestA)
    assert.equal(h.store.read(), requestA)
    assert.ok(h.state.preview, 'the confirmed snapshot remains available to validate later receipt reads')
    await h.controller.finish()
    await h.controller.sendConfirmed()
    assert.equal(h.calls.sends.length, 1)
    assert.equal(h.store.read(), requestA)
    assert.doesNotMatch(JSON.stringify(h.state), /different-recipient|Different outgoing subject|private provider data/)
  }
})

test('same-session receipt recovery rejects evidence that differs from the confirmed recipient or subject', async () => {
  for (const changed of [
    { to: 'different-recipient@example.invalid' },
    { subject: 'Different outgoing subject' },
  ]) {
    let matchesConfirmation = false
    const h = harness({
      send: () => { throw new Error('network lost') },
      receipt: requestId => receipt(requestId, 'sent', matchesConfirmation ? {} : changed),
    })
    await reviewed(h)
    await h.controller.sendConfirmed()
    await h.controller.checkReceipt()
    assert.equal(h.state.receipt, null)
    assert.equal(h.state.error, 'receipt')
    await h.controller.finish()
    await h.controller.sendConfirmed()
    assert.equal(h.calls.sends.length, 1)
    assert.equal(h.store.read(), requestA)

    matchesConfirmation = true
    await h.controller.checkReceipt()
    assert.equal(h.state.receipt.status, 'sent')
    assert.equal(h.store.read(), requestA)
    await h.controller.finish()
    assert.equal(h.store.read(), null)
    assert.equal(h.calls.sends.length, 1)
  }
})

test('a failed receipt with no provider ID is definitive only after explicit acknowledgement', async () => {
  const h = harness({ send: request => receipt(request.request_id, 'failed') })
  await reviewed(h)
  await h.controller.sendConfirmed()
  assert.equal(h.state.receipt.status, 'failed')
  assert.equal(h.state.receipt.provider_id, null)
  assert.equal(h.store.read(), requestA)
  assert.deepEqual(h.state.draft, support.createSupportReplyState().draft)
  await h.controller.sendConfirmed()
  assert.equal(h.calls.sends.length, 1)
  await h.controller.finish()
  assert.equal(h.store.read(), null)
})

test('the owner-only component exposes synchronous cleanup and renders private draft content as text', async () => {
  const [component, admin] = await Promise.all([
    readFile(new URL('../src/components/AdminSupportReply.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/admin/index.vue', import.meta.url), 'utf8'),
  ])
  assert.match(admin, /<AdminSupportReply\s+v-if="whoami\?\.role === 'owner'"/)
  assert.match(admin, /:actor-id="whoami\.admin_id"/)
  assert.match(component, /defineExpose\(\{ clearPrivateState \}\)/)
  assert.match(component, /onBeforeUnmount\(clearPrivateState\)/)
  const reset = admin.slice(admin.indexOf('function resetAdminPrivateState()'), admin.indexOf('\nfunction onLogout'))
  assert.ok(reset.includes('supportReply.value?.clearPrivateState()'))
  assert.ok(reset.indexOf('supportReply.value?.clearPrivateState()') < reset.indexOf('whoami.value = null'))

  const cleanup = component.slice(component.indexOf('function clearPrivateState()'), component.indexOf('\ndefineExpose'))
  const compiled = ts.transpileModule(cleanup, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const expanded = { value: true }, advanced = { value: true }
  let disposed = false
  const run = Function('controller', 'expanded', 'advanced', `${compiled}; return clearPrivateState`)(
    { dispose() { disposed = true } }, expanded, advanced,
  )
  run()
  assert.equal(disposed, true)
  assert.equal(expanded.value, false)
  assert.equal(advanced.value, false)

  assert.match(component, /data-private="true"/)
  assert.match(component, /\{\{ state\.preview\.text \}\}/)
  assert.doesNotMatch(component, /v-html|innerHTML|outerHTML|insertAdjacentHTML|sessionStorage|setStorageSync|JSON\.stringify\(state/)
  assert.match(component, /setItem: \(key, value\) => window\.localStorage\.setItem\(key, value\)/)
  assert.match(component, /createSupportReceiptStore\([\s\S]*?props\.actorId\)/)
})

function noClaim(requestId, status = 429, extra = {}) {
  return {
    error: status === 503 ? 'support_email_unavailable' : 'support_email_rate_limited',
    request_id: requestId,
    submission: 'not_attempted',
    ...extra,
  }
}

test('send decoding recognizes only the exact HTTP and request-bound no-claim proof', () => {
  const sent = receipt(requestA)
  assert.equal(support.decodeSupportReplySendResponse(200, { data: sent }, requestA), sent)
  assert.equal(support.decodeSupportReplySendResponse(202, { data: sent }, requestA), sent)
  assert.equal(support.SupportReplyNotAttemptedError, undefined, 'callers cannot construct the internal proof error')
  for (const status of [429, 503]) {
    assert.throws(
      () => support.decodeSupportReplySendResponse(status, noClaim(requestA, status), requestA),
      error => error.message === 'support_email_not_attempted'
        && error.requestId === requestA
        && error.reason === (status === 429 ? 'rateLimited' : 'unavailable'),
    )
  }

  for (const [status, body, expectedId = requestA] of [
    [200, noClaim(requestA)],
    [400, noClaim(requestA)],
    [401, noClaim(requestA)],
    [403, noClaim(requestA)],
    [404, noClaim(requestA)],
    [500, noClaim(requestA)],
    ['429', noClaim(requestA)],
    [429, noClaim(requestA, 503)],
    [503, noClaim(requestA, 429)],
    [429, noClaim(requestB)],
    [429, noClaim(requestA, 429, { submission: 'unknown' })],
    [429, noClaim(requestA, 429, { error: 'rate_limit' })],
    [429, noClaim(requestA, 429, { extra: true })],
    [429, { error: 'support_email_rate_limited', request_id: requestA }],
    [429, { data: noClaim(requestA) }],
    [429, noClaim('malformed-id'), 'malformed-id'],
    [429, null],
    [429, [noClaim(requestA)]],
    [200, { data: sent, submission: 'not_attempted' }],
    [200, { data: null }],
  ]) {
    assert.throws(
      () => support.decodeSupportReplySendResponse(status, body, expectedId),
      { message: 'support_email_outcome_unknown' },
      `${status}: ${JSON.stringify(body)}`,
    )
  }
})

test('verified unattempted submissions release only their UUID and require a fresh manual review and send', async () => {
  for (const status of [429, 503]) {
    let uuidCalls = 0, sendCalls = 0
    const h = harness({
      uuid: () => ++uuidCalls === 1 ? requestA : requestB,
      send: payload => {
        sendCalls += 1
        return support.decodeSupportReplySendResponse(
          sendCalls === 1 ? status : 200,
          sendCalls === 1 ? noClaim(payload.request_id, status) : { data: receipt(payload.request_id) },
          payload.request_id,
        )
      },
    })
    await reviewed(h)
    const confirmedDraft = structuredClone(h.state.draft)
    await h.controller.sendConfirmed()
    assert.equal(h.store.read(), null)
    assert.equal(h.state.requestId, null)
    assert.equal(h.state.receipt, null)
    assert.equal(h.state.preview, null)
    assert.equal(h.state.busy, false)
    assert.deepEqual(h.state.draft, confirmedDraft)
    assert.equal(h.state.error, status === 429 ? 'rateLimited' : 'notAttempted')
    assert.equal(h.state.availability, status === 429 ? 'available' : 'unavailable')
    assert.equal(h.calls.sends.length, 1)
    assert.equal(uuidCalls, 1)

    await h.controller.sendConfirmed()
    await h.controller.checkReceipt()
    await h.controller.finish()
    assert.equal(h.calls.sends.length, 1, 'release must never automatically retry the send')
    assert.equal(h.calls.receipts.length, 0)
    if (status === 503) {
      h.controller.review()
      assert.equal(h.state.preview, null, 'unavailable delivery must be explicitly checked again')
      await h.controller.refreshAvailability()
      await h.controller.sendConfirmed()
      assert.equal(h.calls.sends.length, 1)
    }
    h.controller.review()
    assert.ok(h.state.preview)
    assert.equal(h.calls.sends.length, 1, 'review itself has no transport side effects')
    await h.controller.sendConfirmed()
    assert.deepEqual(h.calls.sends.map(payload => payload.request_id), [requestA, requestB])
    assert.equal(h.store.read(), requestB)
    assert.equal(h.state.receipt.status, 'sent')
  }
})

test('forged, malformed, wrong-ID, or status-mismatched rejection evidence never releases an unknown send', async () => {
  const invalidDecodedProofs = [
    [429, noClaim(requestA, 429, { extra: 'private provider details' })],
    [429, noClaim(requestB)],
    [503, noClaim(requestA, 429)],
    [429, noClaim(requestA, 503)],
    [400, noClaim(requestA)],
    [429, noClaim(requestA, 429, { submission: 'attempted' })],
    [429, { error: 'support_email_rate_limited' }],
  ].map(([status, body]) => payload => support.decodeSupportReplySendResponse(status, body, payload.request_id))
  const fakeProofError = Object.assign(new Error('support_email_not_attempted'), {
    name: 'SupportReplyNotAttemptedError', requestId: requestA, reason: 'rateLimited',
  })
  for (const send of [
    ...invalidDecodedProofs,
    () => noClaim(requestA),
    () => { throw noClaim(requestA) },
    () => { throw fakeProofError },
    () => { throw { name: 'SupportReplyNotAttemptedError', requestId: requestA, reason: 'rateLimited' } },
    () => support.decodeSupportReplySendResponse(429, noClaim(requestB), requestB),
  ]) {
    const h = harness({ send })
    await reviewed(h)
    await h.controller.sendConfirmed()
    assert.equal(h.state.requestId, requestA)
    assert.equal(h.store.read(), requestA)
    assert.equal(h.state.error, 'unknown')
    assert.equal(h.state.receipt, null)
    await h.controller.finish()
    h.controller.review()
    await h.controller.sendConfirmed()
    assert.equal(h.calls.sends.length, 1)
    assert.equal(h.store.read(), requestA)
    assert.doesNotMatch(JSON.stringify(h.state), /private provider details/)
  }
})

test('recovered receipts cannot consume no-claim proof received outside their original fresh POST', async () => {
  for (const status of [429, 503]) {
    const h = harness({
      receipt: requestId => support.decodeSupportReplySendResponse(status, noClaim(requestId, status), requestId),
    })
    h.store.write(requestA)
    h.controller.initialize()
    await h.controller.checkReceipt()
    assert.equal(h.state.error, 'receipt')
    assert.equal(h.state.requestId, requestA)
    assert.equal(h.store.read(), requestA)
    await h.controller.finish()
    await h.controller.sendConfirmed()
    assert.equal(h.calls.sends.length, 0)
    assert.equal(h.store.read(), requestA)
  }
})

test('verified no-claim cleanup stays single-flight while queued and preserves a newer tab receipt', async () => {
  const cleanupQueued = deferred(), releaseCleanup = deferred()
  let lockCalls = 0
  const h = harness({
    withLock: async operation => {
      lockCalls += 1
      if (lockCalls === 2) {
        cleanupQueued.resolve()
        await releaseCleanup.promise
      }
      return operation()
    },
    send: payload => support.decodeSupportReplySendResponse(429, noClaim(payload.request_id), payload.request_id),
  })
  await reviewed(h)
  const sending = h.controller.sendConfirmed()
  await cleanupQueued.promise
  assert.equal(h.state.busy, true)
  assert.equal(h.state.preview, null)
  assert.equal(h.store.read(), requestA)
  await h.controller.sendConfirmed()
  assert.equal(h.calls.sends.length, 1)
  h.store.remove(requestA)
  h.store.write(requestB)
  releaseCleanup.resolve()
  await sending
  assert.equal(h.store.read(), requestB)
  assert.equal(h.state.requestId, requestA)
  assert.equal(h.state.error, 'storage')
  assert.equal(h.calls.sends.length, 1)
})

test('failed no-claim receipt removal retains the lock and cannot enable another send', async () => {
  const storage = memoryStorage()
  const realStore = support.createSupportReceiptStore(storage, actorA)
  const h = harness({
    storage,
    store: {
      read: () => realStore.read(),
      write: requestId => realStore.write(requestId),
      remove() { throw new Error('storage removal denied') },
    },
    send: payload => support.decodeSupportReplySendResponse(429, noClaim(payload.request_id), payload.request_id),
  })
  await reviewed(h)
  const confirmedDraft = structuredClone(h.state.draft)
  await h.controller.sendConfirmed()
  assert.equal(h.state.requestId, requestA)
  assert.equal(h.store.read(), requestA)
  assert.equal(h.state.error, 'storage')
  assert.equal(h.state.preview, null)
  assert.deepEqual(h.state.draft, confirmedDraft)
  h.controller.review()
  await h.controller.sendConfirmed()
  assert.equal(h.calls.sends.length, 1)
})

test('a stale session cannot release its receipt after a delayed valid no-claim response', async () => {
  const dispatched = deferred(), response = deferred()
  const storage = memoryStorage()
  const oldSession = harness({
    storage,
    send: async payload => {
      dispatched.resolve()
      await response.promise
      return support.decodeSupportReplySendResponse(429, noClaim(payload.request_id), payload.request_id)
    },
  })
  await reviewed(oldSession)
  const sending = oldSession.controller.sendConfirmed()
  await dispatched.promise
  oldSession.controller.dispose()
  const newSession = harness({ storage })
  newSession.controller.initialize()
  assert.equal(newSession.state.requestId, requestA)
  response.resolve()
  await sending
  assert.deepEqual(oldSession.state, support.createSupportReplyState())
  assert.equal(newSession.store.read(), requestA)
  assert.equal(newSession.state.requestId, requestA)
  assert.equal(newSession.calls.sends.length, 0)
})

test('leaving while verified no-claim cleanup waits for its lock preserves the durable receipt', async () => {
  const cleanupQueued = deferred(), releaseCleanup = deferred()
  let lockCalls = 0
  const h = harness({
    withLock: async operation => {
      lockCalls += 1
      if (lockCalls === 2) {
        cleanupQueued.resolve()
        await releaseCleanup.promise
      }
      return operation()
    },
    send: payload => support.decodeSupportReplySendResponse(503, noClaim(payload.request_id, 503), payload.request_id),
  })
  await reviewed(h)
  const sending = h.controller.sendConfirmed()
  await cleanupQueued.promise
  h.controller.dispose()
  releaseCleanup.resolve()
  await sending
  assert.deepEqual(h.state, support.createSupportReplyState())
  assert.equal(h.store.read(), requestA)
  assert.equal(h.calls.sends.length, 1)
})

test('mini-program preprocessing removes the entire support integration while retaining the existing admin page', async () => {
  const source = await readFile(new URL('../src/pages/admin/index.vue', import.meta.url), 'utf8')
  function preprocess(platform) {
    const enabled = [true]
    const output = []
    for (const line of source.split('\n')) {
      const directive = line.match(/^\s*(?:\/\/|<!--|\/\*)\s*#(ifdef|ifndef|endif)(?:\s+([A-Z0-9-]+))?/)
      if (!directive) {
        if (enabled.at(-1)) output.push(line)
      } else if (directive[1] === 'endif') {
        assert.ok(enabled.length > 1, 'platform #endif has an opening guard')
        enabled.pop()
      } else {
        const matches = directive[2] === platform
        enabled.push(enabled.at(-1) && (directive[1] === 'ifdef' ? matches : !matches))
      }
    }
    assert.equal(enabled.length, 1, 'every platform guard closes')
    return output.join('\n')
  }
  const browser = preprocess('H5')
  const miniProgram = preprocess('MP-WEIXIN')
  for (const identifier of [
    'AdminSupportReply', 'adminSupportReply', 'supportReply', 'supportReplyTransport',
    'SupportReplyPayload', 'SupportReplyTransport', 'requireSupportEmailOwner',
    'supportEmailGet', 'sendSupportEmail', 'decodeSupportReplySendResponse',
  ]) {
    assert.match(browser, new RegExp(`\\b${identifier}\\b`), `${identifier} remains available on H5`)
    assert.doesNotMatch(miniProgram, new RegExp(`\\b${identifier}\\b`), `${identifier} is entirely removed on mini-program`)
  }
  assert.doesNotMatch(miniProgram, /support_email_status|support_email_receipt|clearPrivateState/)
  for (const preserved of [
    'const adminKey = ref', 'async function apiGet', 'async function apiPost',
    'function resetAdminPrivateState()', 'function onLogout(',
    'onHide(lockAdminSessionOnLeave)', 'onUnload(lockAdminSessionOnLeave)',
  ]) assert.ok(miniProgram.includes(preserved), `${preserved} remains in the original admin surface`)
  assert.match(miniProgram, /<view v-if="!unlocked" class="gate">/)
})
