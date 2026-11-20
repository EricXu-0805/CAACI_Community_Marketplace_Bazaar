import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

/*
 * P4.8, P4.9: the reads behind the events pages, run as code against a small
 * stand-in for the database. What is checked is what a reader ends up seeing:
 * nothing from people they blocked, nothing a list no longer shows, nothing the
 * previous account was shown, and on a topic only an event readers are shown.
 */
const NOW = Date.parse('2026-11-20T16:00:00Z')
const MINUTE = 60_000
const read = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`

// What the composable is given in place of the app's modules. Each test gets its own world.
const WORLD = '__communityEventReads'
const stand = {
  './accountScope': `export const onAccountTransition = listener => { globalThis.${WORLD}.transitions.push(listener); return () => {} }`,
  './useAuth': `export const useAuth = () => ({
    currentUser: { get value() { const id = globalThis.${WORLD}.account; return id ? { id } : null } },
    awaitAuthReady: () => globalThis.${WORLD}.authReady,
  })`,
  './useModeration': `export const useModeration = () => ({
    blockedIds: { get value() { return globalThis.${WORLD}.blocked } },
    ensureLoaded: async () => { const world = globalThis.${WORLD}; world.gateCalls += 1; return world.gate },
  })`,
  './useSupabase': `export const useSupabase = () => ({ supabase: globalThis.${WORLD}.supabase })`,
  '../utils/region': `export const ACTIVE_REGION = 'cu'`,
}
let instance = 0
// A fresh copy of the module for each test, so that what one test left in its memory is not there for the next.
async function load() {
  let input = read('composables/useCommunityEvents.ts')
  for (const [specifier, code] of Object.entries(stand)) input = input.replaceAll(`'${specifier}'`, `'${moduleUrl(code)}'`)
  const output = ts.transpileModule(input, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
  return import(moduleUrl(`${output}\n// instance ${++instance}`))
}

let serial = 0
const event = (source_type, extra = {}) => ({
  id: `event-${String(++serial).padStart(3, '0')}`, source_type, region: 'cu', title: `Event ${serial}`, title_en: null,
  starts_at: new Date(NOW + 86_400_000).toISOString(), ends_at: null, all_day: false, location: 'ARC', availability: 'visible',
  cancelled_at: null, previous_starts_at: null, schedule_changed_at: null, revision: 1, duplicate_of: null,
  organizer_user_id: source_type === 'member' ? 'member-1' : null, discussion_post_id: null,
  ...extra,
})
const ids = rows => rows.map(row => row.id)

async function world(t) {
  // Only the clock is stood in for; nothing here waits for time to pass.
  t.mock.timers.enable({ apis: ['Date'], now: NOW })
  const state = {
    account: null, blocked: new Set(), gate: { ok: true }, gateCalls: 0, authReady: Promise.resolve(), transitions: [],
    lists: { upcoming: [], past: [] }, table: [], calls: [], reads: [], hold: null, onCall: null,
  }
  state.supabase = {
    // list_community_events: the rows of the window that was asked for, or its failure.
    async rpc(name, args) {
      state.calls.push({ name, args })
      state.onCall?.()
      if (state.hold) await state.hold
      if (state.fail) return { data: null, error: { message: 'unavailable' } }
      return { data: structuredClone(state.lists[args.window_in]), error: null }
    },
    // A direct read of the table: the rows row security lets this reader have, narrowed by the filters the caller adds.
    from(table) {
      const filters = []
      const query = {
        select(fields) { query.fields = fields; return query },
        eq(column, value) { filters.push(row => String(row[column]) === String(value)); return query },
        is(column, value) { filters.push(row => (row[column] ?? null) === value); return query },
        limit(count) { query.count = count; return query },
        then(resolve, reject) {
          state.reads.push({ table, fields: query.fields })
          const rows = state.table.filter(row => filters.every(passes => passes(row))).slice(0, query.count ?? Infinity)
          return Promise.resolve({ data: structuredClone(rows), error: null }).then(resolve, reject)
        },
      }
      return query
    },
  }
  globalThis[WORLD] = state
  const loaded = await load()
  state.changeAccount = (next) => {
    const previousUserId = state.account
    state.account = next
    state.blocked = new Set()
    for (const listener of state.transitions) listener({ userId: next, previousUserId, generation: 1 })
  }
  return { state, loaded, events: loaded.useCommunityEvents() }
}
const listCalls = state => state.calls.map(call => call.args.window_in)

test('the list asks one function for one window of the active region', async t => {
  const { state, events } = await world(t)
  const rows = [event('caaci'), event('member')]
  state.lists.upcoming = rows
  state.lists.past = [event('campus')]
  assert.deepEqual(ids(await events.listEvents()), ids(rows))
  assert.deepEqual(ids(await events.listEvents('past')), ids(state.lists.past))
  assert.deepEqual(state.calls, [
    { name: 'list_community_events', args: { region_in: 'cu', window_in: 'upcoming', limit_in: 200 } },
    { name: 'list_community_events', args: { region_in: 'cu', window_in: 'past', limit_in: 200 } },
  ])
  // A visitor has no block list, and none is asked for.
  assert.equal(state.gateCalls, 0)
  state.fail = true
  await assert.rejects(events.listEvents(), { message: 'unavailable' })
})

test('a signed-in reader is not shown the events of people they blocked, in a list or by link', async t => {
  const { state, events } = await world(t)
  const shown = event('member', { organizer_user_id: 'member-2' })
  const blocked = event('member', { organizer_user_id: 'member-9' })
  const organization = event('caaci')
  const blockedPast = event('member', { organizer_user_id: 'member-9' })
  state.account = 'reader-1'
  state.blocked = new Set(['member-9'])
  state.lists.upcoming = [organization, blocked, shown]
  state.lists.past = [blockedPast]
  assert.deepEqual(ids(await events.listEvents()), ids([organization, shown]))
  assert.deepEqual(await events.listEvents('past'), [])
  assert.equal(await events.findEvent(blocked.id), null)
  assert.equal(await events.findEvent(blockedPast.id), null)
  assert.equal((await events.findEvent(shown.id)).id, shown.id)
  assert.ok(state.gateCalls >= 1)

  // The block list is read before anything is shown. When it cannot be read, the list fails: it is not shown unfiltered.
  state.gate = { ok: false, reason: 'load_failed' }
  const before = state.calls.length
  await assert.rejects(events.listEvents(), /moderation_gate_unavailable/)
  assert.equal(state.calls.length, before, 'no rows were asked for')
})

test('the reader is known before the list is read', async t => {
  const { state, events } = await world(t)
  const blocked = event('member', { organizer_user_id: 'member-9' })
  state.lists.upcoming = [blocked]
  // The session is still being restored when the page asks: the reader turns out to be signed in, with a block.
  let restored
  state.authReady = new Promise(resolve => { restored = resolve })
  const pending = events.listEvents()
  state.account = 'reader-1'
  state.blocked = new Set(['member-9'])
  restored()
  assert.deepEqual(await pending, [])
})

test('a card opens from the list that showed it; an event no list showed is looked for in both windows', async t => {
  const { state, events } = await world(t)
  const upcoming = [event('caaci'), event('partner')]
  const over = event('campus')
  state.lists.upcoming = upcoming
  state.lists.past = [over]
  await events.listEvents()
  assert.equal((await events.findEvent(upcoming[1].id)).id, upcoming[1].id)
  assert.deepEqual(listCalls(state), ['upcoming'], 'no second read for a card of the list just shown')
  assert.equal((await events.findEvent(over.id)).id, over.id)
  assert.deepEqual(listCalls(state), ['upcoming', 'upcoming', 'past'])
  assert.equal(await events.findEvent('event-none'), null)
})

test('a list replaces what the last one showed: an event taken down since is not opened from memory', async t => {
  const { state, events } = await world(t)
  const [kept, taken] = [event('caaci'), event('campus')]
  state.lists.upcoming = [kept, taken]
  await events.listEvents()
  state.lists.upcoming = [kept]
  await events.listEvents()
  assert.equal(await events.findEvent(taken.id), null)
  assert.equal((await events.findEvent(kept.id)).id, kept.id)
})

test('what a list showed is handed to the page a card opens for five minutes, then read again', async t => {
  const { state, events } = await world(t)
  const row = event('member')
  state.lists.upcoming = [row]
  await events.listEvents()
  state.lists.upcoming = [{ ...row, cancelled_at: new Date(NOW + MINUTE).toISOString() }]
  t.mock.timers.setTime(NOW + 5 * MINUTE)
  assert.equal((await events.findEvent(row.id)).cancelled_at, null)
  assert.deepEqual(listCalls(state), ['upcoming'])
  t.mock.timers.setTime(NOW + 5 * MINUTE + 1)
  assert.equal((await events.findEvent(row.id)).cancelled_at, state.lists.upcoming[0].cancelled_at)
  assert.deepEqual(listCalls(state), ['upcoming', 'upcoming'])
})

test('rows another read of the list got are kept the same way, without blocked organizers', async t => {
  const { state, loaded, events } = await world(t)
  const [organization, blocked] = [event('caaci'), event('member', { organizer_user_id: 'member-9' })]
  state.account = 'reader-1'
  state.blocked = new Set(['member-9'])
  // The home reads the same list for its own block and hands the rows on.
  assert.deepEqual(ids(loaded.keepCommunityEvents('upcoming', [organization, blocked])), [organization.id])
  assert.equal((await events.findEvent(organization.id)).id, organization.id)
  assert.deepEqual(state.calls, [], 'the event opens from the rows the home already had')
  assert.equal(await events.findEvent(blocked.id), null)
})

test('an account change drops what the previous reader was shown, also when the list arrives after it', async t => {
  const { state, events } = await world(t)
  const row = event('caaci')
  state.account = 'reader-1'
  state.lists.upcoming = [row]
  await events.listEvents()
  state.changeAccount(null)
  state.lists.upcoming = []
  assert.equal(await events.findEvent(row.id), null)

  // A list that was asked for by the previous reader and comes back after the change is not kept.
  state.changeAccount('reader-1')
  state.lists.upcoming = [row]
  let release
  state.hold = new Promise(resolve => { release = resolve })
  const asked = new Promise(resolve => { state.onCall = resolve })
  const pending = events.listEvents()
  await asked
  state.changeAccount('reader-2')
  state.hold = null
  release()
  await pending
  state.lists.upcoming = []
  assert.equal(await events.findEvent(row.id), null)
})

test('the card on a topic is for an event readers are shown: not a hidden one its organizer still reads, not a duplicate', async t => {
  const { state, events } = await world(t)
  const topic = 'topic-1'
  const linked = extra => ({ ...event('member', { discussion_post_id: topic, title: null }), partner: null, ...extra })
  state.table = [linked(), event('caaci', { discussion_post_id: 'topic-2', partner: null })]
  const card = await events.findTopicEvent(topic, 'Badminton on Saturday')
  assert.equal(card.id, state.table[0].id)
  assert.equal(card.title, 'Badminton on Saturday', "a member's event is titled by its topic")
  // The organizer's own policy still returns their event after a takedown; the card is not for that.
  for (const hiddenOrGone of [{ availability: 'hidden' }, { availability: 'unavailable' }, { source_type: 'campus', duplicate_of: 'event-000' }]) {
    state.table = [linked(hiddenOrGone)]
    assert.equal(await events.findTopicEvent(topic, 'Badminton on Saturday'), null, JSON.stringify(hiddenOrGone))
  }
  state.table = [linked({ source_type: 'partner', title: '公开赛', partner: { name_zh: '国际象棋社', name_en: 'Chess Club' } })]
  const shared = await events.findTopicEvent(topic, 'Discussion')
  assert.deepEqual([shared.title, shared.partner_name_zh, shared.partner_name_en], ['公开赛', '国际象棋社', 'Chess Club'])
  assert.equal(await events.findTopicEvent('topic-9', null), null)
  // One table, and a projection that names nothing private.
  assert.deepEqual([...new Set(state.reads.map(read => read.table))], ['community_events'])
  for (const { fields } of state.reads) assert.doesNotMatch(fields, /consent_ref|hidden_reason|content_hash|created_by|\*/)
})
