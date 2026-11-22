import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import ts from 'typescript'
import { EVENT, INPUT, NOW, SECOND_USER, USER, memberWorld } from './community-member-event-unit.mjs'

// D-57's package boundary keeps these writes out of the mini-program main package.
test('event writes are imported only by pages in the event subpackage', () => {
  const root = new URL('../src/', import.meta.url)
  const queue = [root], violations = []
  while (queue.length) {
    const directory = queue.pop()
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)
      if (entry.isDirectory()) { queue.push(file); continue }
      if (!/\.(?:ts|js|vue)$/.test(entry.name)) continue
      const relative = file.href.slice(root.href.length)
      if (relative.startsWith('pages/event/')) continue
      const text = readFileSync(file, 'utf8')
      const script = entry.name.endsWith('.vue')
        ? [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]).join('\n')
        : text
      const source = ts.createSourceFile(relative, script, ts.ScriptTarget.Latest, true)
      function visit(node) {
        let specifier
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier
        else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) specifier = node.arguments[0]
        else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) specifier = node.argument.literal
        if (specifier && ts.isStringLiteral(specifier) && /(?:^|\/)useMemberEventWrites(?:\.[jt]s)?$/.test(specifier.text)) {
          violations.push(relative)
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
  }
  assert.deepEqual(violations, [])
})

// The order and payload below are the D-57 app/server and moderation protocol.
test('publishing checks restriction before all text checks, then moderates before its one RPC', async t => {
  const { state, load } = await memberWorld(t)
  const { useMemberEventWrites } = await load('pages/event/useMemberEventWrites.ts')
  const result = await useMemberEventWrites().createMemberEvent(INPUT)
  assert.deepEqual(state.timeline, ['auth', 'writes', 'check', 'check', 'check', 'remote', 'wechat', 'rpc'])
  const title = 'Saturday badminton', content = 'Bring a racket.\nSplit costs in person.', location = 'ARC Court 1'
  assert.deepEqual(state.checks, [title, content, location].map(text => ({ text, options: { kind: 'post' } })))
  const combined = `${title}\n${content}\n${location}`
  assert.deepEqual(state.moderations, [{ text: combined, token: { userId: USER, generation: 1 } }])
  assert.deepEqual(state.wechat, [{ text: combined, scene: 3, token: { userId: USER, generation: 1 } }])
  assert.deepEqual(state.calls, [{
    name: 'create_member_event',
    args: {
      post_id_in: INPUT.postId, title_in: title, content_in: content,
      event_in: { starts_at: INPUT.startsAt, ends_at: INPUT.endsAt, location },
    },
  }])
  assert.deepEqual(result, { post_id: INPUT.postId, event_id: EVENT })
})

test('flagged text never reaches WeChat moderation or the database write', async t => {
  const { state, load } = await memberWorld(t)
  state.flagged = true
  const { useMemberEventWrites } = await load('pages/event/useMemberEventWrites.ts')
  await assert.rejects(useMemberEventWrites().createMemberEvent(INPUT), /moderation_block/)
  assert.equal(state.moderations.length, 1)
  assert.deepEqual(state.wechat, [])
  assert.deepEqual(state.calls, [])
})

test('a restricted account stops before any text or remote check', async t => {
  const { state, load } = await memberWorld(t)
  state.restricted = true
  const { useMemberEventWrites } = await load('pages/event/useMemberEventWrites.ts')
  await assert.rejects(useMemberEventWrites().createMemberEvent(INPUT), /suspension_active/)
  assert.deepEqual(state.timeline, ['auth', 'writes'])
  assert.deepEqual(state.calls, [])
})

test('campus eligibility is checked locally before moderation', async t => {
  const { state, load } = await memberWorld(t)
  state.verified = false
  const { useMemberEventWrites } = await load('pages/event/useMemberEventWrites.ts')
  await assert.rejects(useMemberEventWrites().createMemberEvent(INPUT), /member_event_not_eligible/)
  assert.deepEqual(state.timeline, ['auth', 'writes'])
  assert.deepEqual(state.calls, [])
})

test('an account change during moderation cannot publish the old account draft', async t => {
  const { state, scope, load } = await memberWorld(t)
  state.onModerate = () => { state.user = SECOND_USER; scope.transitionAccount(SECOND_USER) }
  const { useMemberEventWrites } = await load('pages/event/useMemberEventWrites.ts')
  await assert.rejects(useMemberEventWrites().createMemberEvent(INPUT))
  assert.deepEqual(state.calls, [])
})

test('transport uncertainty is tagged and retry keeps the caller-owned post id', async t => {
  const { state, load } = await memberWorld(t)
  const { useMemberEventWrites } = await load('pages/event/useMemberEventWrites.ts')
  const { mutationCommitState } = await load('api/mutationCommit.ts')
  state.rpcThrow = new TypeError('fetch failed')
  await assert.rejects(useMemberEventWrites().createMemberEvent(INPUT), error => mutationCommitState(error) === 'unknown')
  state.rpcThrow = null
  await useMemberEventWrites().createMemberEvent(INPUT)
  assert.deepEqual(state.calls.map(call => call.args.post_id_in), [INPUT.postId, INPUT.postId])
})

test('a SQL rejection is definitely not committed', async t => {
  const { state, load } = await memberWorld(t)
  state.rpcError = { code: '23514', message: 'member_event_active_limit' }
  const { useMemberEventWrites } = await load('pages/event/useMemberEventWrites.ts')
  const { mutationCommitState } = await load('api/mutationCommit.ts')
  await assert.rejects(useMemberEventWrites().createMemberEvent(INPUT),
    error => mutationCommitState(error) === 'not_committed')
})

test('cancellation stays available under restriction and invalidates a previously read list', async t => {
  const { state, load } = await memberWorld(t)
  const { useCommunityEvents } = await load('composables/useCommunityEvents.ts')
  const events = useCommunityEvents()
  await events.listEvents()
  state.timeline.length = 0
  state.restricted = true
  const { useMemberEventWrites } = await load('pages/event/useMemberEventWrites.ts')
  await useMemberEventWrites().cancelMemberEvent(EVENT)
  assert.deepEqual(state.timeline, ['auth', 'update'])
  assert.deepEqual(state.updates, [{
    table: 'community_events', values: { cancelled_at: new Date(NOW).toISOString() },
    filters: [['id', EVENT], ['organizer_user_id', USER]], fields: ['id', 'cancelled_at'],
  }])
  assert.equal((await events.findEvent(EVENT)).cancelled_at, new Date(NOW).toISOString())
  assert.equal(state.calls.filter(call => call.name === 'list_community_events').length, 2)
})

const errors = {
  member_event_not_eligible: 'events.needVerify',
  member_event_time_out_of_range: 'events.err.timeRange',
  member_event_active_limit: 'events.err.activeLimit',
  member_event_reserved_wording: 'events.err.reservedWording',
  member_event_link_not_allowed: 'events.err.noLinks',
  member_event_title_too_long: 'events.err.titleTooLong',
  member_event_location_invalid: 'events.err.locationInvalid',
  member_event_cancel_final: 'events.err.cancelFinal',
  member_event_rpc_required: 'events.err.notSubmitted',
  event_discussion_closed: 'events.err.discussionClosed',
  official_account_unset: 'events.err.discussionUnavailable',
  member_events_closed: 'events.err.closed',
}
for (const [message, key] of Object.entries(errors)) {
  test(`the ${message} server error selects its SPEC translation`, async t => {
    const { load } = await memberWorld(t)
    const { memberEventErrorKey } = await load('pages/event/useMemberEventWrites.ts')
    assert.equal(memberEventErrorKey({ message }), key)
  })
}

for (const [label, input, expected] of [
  ...['\t', '\n', '\u0085', '\u2028', '\u3000', '\u00a0', '\ufeff']
    .map(space => [`U+${space.codePointAt(0).toString(16).padStart(4, '0')}`, `${space}ARC${space}${space}Court${space}`, 'ARC Court']),
  ['only whitespace', '\t\n\u2028\u3000\u00a0\ufeff', ''],
]) {
  test(`event text normalizes ${label}`, async t => {
    const { load } = await memberWorld(t)
    const { normalizeEventText } = await load('utils/communityEvents.ts')
    assert.equal(normalizeEventText(input), expected)
  })
}
