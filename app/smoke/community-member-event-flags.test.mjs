import test from 'node:test'
import assert from 'node:assert/strict'
import { SECOND_USER, memberWorld } from './community-member-event-unit.mjs'

test('the member switch is cached for sixty seconds for the current account', async t => {
  const { state, load } = await memberWorld(t)
  const { useCommunityEvents } = await load('composables/useCommunityEvents.ts')
  const events = useCommunityEvents()
  assert.equal(await events.memberEventsOpen(), true)
  state.switchValue = false
  t.mock.timers.tick(59_999)
  assert.equal(await events.memberEventsOpen(), true)
  assert.equal(state.calls.length, 1)
  t.mock.timers.tick(1)
  assert.equal(await events.memberEventsOpen(), false)
  assert.equal(state.calls.length, 2)
})

test('an account change drops the previous account switch result', async t => {
  const { state, scope, load } = await memberWorld(t)
  const { useCommunityEvents } = await load('composables/useCommunityEvents.ts')
  const events = useCommunityEvents()
  assert.equal(await events.memberEventsOpen(), true)
  state.switchValue = false
  state.user = SECOND_USER
  scope.transitionAccount(SECOND_USER)
  assert.equal(await events.memberEventsOpen(), false)
  assert.equal(state.calls.length, 2)
})

test('an old account response cannot reopen creation after an account change', async t => {
  const { state, scope, load } = await memberWorld(t)
  const { useCommunityEvents } = await load('composables/useCommunityEvents.ts')
  const events = useCommunityEvents()
  let release
  state.holdOpen = new Promise(resolve => { release = resolve })
  const requested = new Promise(resolve => { state.onOpen = resolve })
  const pending = events.memberEventsOpen()
  await requested
  state.user = SECOND_USER
  scope.transitionAccount(SECOND_USER)
  state.switchValue = false
  state.holdOpen = null
  release()
  assert.equal(await pending, false)
  assert.equal(await events.memberEventsOpen(), false)
  assert.equal(state.calls.length, 2)
})

for (const [field, value] of [
  ['switchValue', 'true'], ['switchValue', 1], ['switchValue', null],
  ['switchError', { message: 'unavailable' }], ['switchThrow', new TypeError('fetch failed')],
]) {
  test(`creation remains closed for ${field}=${String(value)}`, async t => {
    const { state, load } = await memberWorld(t)
    state[field] = value
    const { useCommunityEvents } = await load('composables/useCommunityEvents.ts')
    assert.equal(await useCommunityEvents().memberEventsOpen(), false)
  })
}
