import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

test('moderation snapshot exposes an explicit fail-closed load contract', () => {
  const moderation = source('src/composables/useModeration.ts')

  expect(moderation).toContain('export type ModerationLoadResult')
  expect(moderation).toContain("reason: 'unauthenticated' | 'load_failed' | 'account_changed'")
  expect(moderation).toContain('async function ensureLoaded(): Promise<ModerationLoadResult>')
  expect(moderation).toContain("return { ok: false, reason: 'load_failed', error }")

  const ensureStart = moderation.indexOf('async function ensureLoaded()')
  const ensureEnd = moderation.indexOf('\n  function isBlocked', ensureStart)
  const ensureContract = moderation.slice(ensureStart, ensureEnd)
  expect(ensureContract).toContain("if (!activeUserId) return { ok: false, reason: 'unauthenticated' }")
  expect(ensureContract).toContain('if (loadedForUserId === activeUserId)')
  expect(ensureContract).toContain('return { ok: true, userId: activeUserId, cached: true }')
  expect(ensureContract).toContain('return loadBlockedIds()')

  // A successful unblock updates the already-authoritative snapshot in place.
  // It must not invalidate it and force a transient reload failure to keep the
  // just-unblocked conversation closed.
  const unblockStart = moderation.indexOf('async function unblockUser')
  const unblockEnd = moderation.indexOf('\n  function clearBlocked', unblockStart)
  const unblockContract = moderation.slice(unblockStart, unblockEnd)
  expect(unblockContract).toContain('if (error) throw error')
  expect(unblockContract).toContain('blockedIds.value.delete(blockedId)')
  expect(unblockContract).not.toContain('loadedForUserId = null')
})

test('chat never renders actions before moderation succeeds and retry rechecks auth', () => {
  const chat = source('src/components/ChatThread.vue')

  const gateStart = chat.indexOf('async function openConversationBehindModerationGate()')
  const gateEnd = chat.indexOf('\nasync function retryConversationAccess()', gateStart)
  const gate = chat.slice(gateStart, gateEnd)
  expect(gateStart).toBeGreaterThan(-1)
  expect(gate).toContain('conversationAccessReady.value = false')
  expect(gate).toContain('blockLoadResult = await ensureBlocksLoaded()')
  expect(gate).toContain('if (!blockLoadResult.ok)')
  expect(gate).toContain('moderationAccessFailed.value = true')

  // The setup latch is now claimed synchronously, before the first await, so a
  // cold-start recovery and an account-transition reinitializer racing the same
  // block-load cannot both install realtime owners. That inverts the ordering
  // this test used to pin, so the safety moves to the release side: the gate
  // must still decide access before initializing, and every failure exit must
  // clear the latch — otherwise the thread loads forever with no way back.
  expect(gate.indexOf('conversationSetupStarted = true'))
    .toBeLessThan(gate.indexOf('blockLoadResult = await ensureBlocksLoaded()'))
  expect(gate.indexOf('blockLoadResult = await ensureBlocksLoaded()'))
    .toBeLessThan(gate.indexOf('if (!blockLoadResult.ok)'))
  expect(gate.indexOf('if (!blockLoadResult.ok)'))
    .toBeLessThan(gate.indexOf('await initializeConversationAfterGate()'))

  // A typed failure and a thrown exception are separate exits. Both reopen the
  // explicit Retry path; neither may leave the latch claimed.
  const thrownExit = gate.slice(
    gate.indexOf('} catch (error) {'), gate.indexOf('if (!blockLoadResult.ok)'),
  )
  const typedExit = gate.slice(
    gate.indexOf('if (!blockLoadResult.ok)'), gate.indexOf('await initializeConversationAfterGate()'),
  )
  for (const exit of [thrownExit, typedExit]) {
    expect(exit).toContain('conversationSetupStarted = false')
    expect(exit).toContain('moderationAccessFailed.value = true')
    expect(exit).toContain('conversationUnavailable.value = true')
  }

  const initializeStart = chat.indexOf('async function initializeConversationAfterGate()')
  const initializeEnd = chat.indexOf('\nasync function openConversationBehindModerationGate()', initializeStart)
  const initialize = chat.slice(initializeStart, initializeEnd)
  expect(initialize.indexOf('if (otherUserId.value && isBlocked(otherUserId.value))'))
    .toBeLessThan(initialize.indexOf('conversationAccessReady.value = true'))

  const retryStart = chat.indexOf('async function retryConversationAccess()')
  const retryEnd = chat.indexOf('\nonMounted(', retryStart)
  const retry = chat.slice(retryStart, retryEnd)
  expect(retry.indexOf('await awaitAuthReady()'))
    .toBeLessThan(retry.indexOf('if (!requireAuth()) return'))
  expect(retry.indexOf('if (!requireAuth()) return'))
    .toBeLessThan(retry.indexOf('await openConversationBehindModerationGate()'))

  const template = chat.slice(0, chat.indexOf('<script setup'))
  expect(template).toContain('v-if="conversationAccessReady && !conversationUnavailable"')
  expect(template).toContain('v-if="moderationAccessFailed"')
  expect(template).toContain('@click="retryConversationAccess"')
  expect(template).toContain('<template v-else>')
})
