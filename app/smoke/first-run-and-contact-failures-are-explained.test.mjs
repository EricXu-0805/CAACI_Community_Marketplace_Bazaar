import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

/**
 * Four actions that decide whether someone can use this app at all, each of
 * which used to fail without saying why:
 *
 *   · finishing onboarding  — the last write of the signup funnel. Its sibling
 *     record_consent, one RPC later on the same screen, already reported to
 *     Sentry with a written rationale: a fleet-wide rejection strands every new
 *     signup. mark_onboarded only reported when an avatar had been uploaded,
 *     and the avatar is optional.
 *   · contacting a seller   — the buyer's primary action. The block trigger's
 *     `conversation_unavailable` already HAS copy in utils/index.ts; the call
 *     site threw it away for a generic "couldn't start chat" and told nobody.
 *   · a quick-reply chip    — the other three send paths in ChatThread all run
 *     the error through friendlyErrorMessage. This one did not.
 *   · unblocking someone    — same shape, lower traffic.
 *
 * These assert the property (the reason survives to the reader, and a fleet-wide
 * failure reaches telemetry), not a spelling. Each has a control so the file
 * cannot pass by matching nothing.
 */

const SRC = new URL('../src/', import.meta.url)
const read = path => readFileSync(new URL(path, SRC), 'utf8')

/** The balanced body of `function name(` / `async function name(`. */
function functionBody(source, name) {
  const start = source.search(new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`))
  assert.notEqual(start, -1, `${name} is gone — this guard is pointed at nothing`)
  const open = source.indexOf('{', source.indexOf(')', start))
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open + 1, i)
    }
  }
  throw new Error(`unbalanced body for ${name}`)
}

/** Every `catch` body inside a chunk of source, whether or not it binds. */
function catchBodies(source) {
  const bodies = []
  const re = /\}\s*catch\s*(?:\([^)]*\)\s*)?\{/g
  let match
  while ((match = re.exec(source)) !== null) {
    const open = match.index + match[0].length - 1
    let depth = 0
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1
      else if (source[i] === '}') {
        depth -= 1
        if (depth === 0) { bodies.push(source.slice(open + 1, i)); break }
      }
    }
  }
  return bodies
}

const explains = body => body.includes('friendlyErrorMessage')
const reports = body => /captureException|report[A-Za-z]*Failure/.test(body)
const toasts = body => body.includes('showToast')

test('finishing onboarding reports a failed mark_onboarded, avatar or no avatar', () => {
  const source = read('pages/onboarding/index.vue')
  const finish = functionBody(source, 'finish')

  // Both ways the RPC can fail: a rejected promise and a returned { error }.
  const reported = [...finish.matchAll(/onboarding\.mark_onboarded/g)]
  assert.equal(reported.length, 2,
    'both the throw path and the { error } path must report; supabase-js uses both')

  // The avatar-only reporter must stay a *separate* fact, not the only one.
  const avatarOnly = functionBody(source, 'handleUploadedAvatarFailure')
  assert.ok(avatarOnly.includes('orphan_risk'),
    'the avatar reporter is about orphaned objects and should stay that way')
  assert.ok(!avatarOnly.includes('onboarding.mark_onboarded'),
    'the write-failed report must not live behind the avatar guard again')

  // Control: the sibling whose treatment set the precedent is still there, so
  // a rewrite that drops telemetry from this screen cannot pass silently.
  assert.ok(finish.includes('onboarding.record_consent'))
})

test('contacting a seller says why it failed and reports it', () => {
  const source = read('pages/detail/index.vue')
  const contact = functionBody(source, 'contactSeller')
  const bodies = catchBodies(contact).filter(toasts)
  assert.ok(bodies.length >= 1, 'contactSeller must still tell the buyer something')
  for (const body of bodies) {
    assert.ok(explains(body), 'the reason must reach the buyer, not just "couldn\'t start chat"')
    assert.ok(reports(body), 'a fleet-wide failure to open any conversation must reach telemetry')
  }

  // Control: the copy this exists to surface is really in the map. If someone
  // deletes it, the assertion above would still pass while the user learned
  // nothing, so pin the source of the message too.
  assert.match(read('utils/index.ts'), /'conversation_unavailable':/)
})

test('no way of sending a message swallows the reason', () => {
  const source = read('components/ChatThread.vue')
  for (const name of ['sendQuickReply', 'retrySend']) {
    for (const body of catchBodies(functionBody(source, name)).filter(toasts)) {
      assert.ok(explains(body), `${name} must run the error through friendlyErrorMessage`)
    }
  }

  // Control: the file still contains a deliberate generic toast — the failed
  // history fetch during thread setup, which is a read and keeps its own copy.
  // If this stops matching, the sweep above has quietly become vacuous.
  assert.ok(catchBodies(source).some(body => body.includes("t('chat.fail')")),
    'expected the setup read to still be the one generic chat toast')
})

test('unblocking someone says why it failed', () => {
  const body = catchBodies(functionBody(read('pages/blocked/index.vue'), 'onUnblock'))
    .filter(toasts)
  assert.equal(body.length, 1)
  assert.ok(explains(body[0]))
})
