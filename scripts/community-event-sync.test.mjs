import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { readFileSync } from 'node:fs'
import { SKIP, startEventSyncDatabase } from './fixtures/community-member-events-database.mjs'

const originalFetch = globalThis.fetch
let realFetchCalls = 0
globalThis.fetch = () => { realFetchCalls++; throw new Error('Real network is forbidden') }
const { syncCaaciEvents } = await import('../api/_community-events-sync.js')
after(() => { globalThis.fetch = originalFetch; assert.equal(realFetchCalls, 0) })

test('community event sync uses its service RPCs on stock PostgreSQL', { skip: SKIP }, async t => {
  const db = startEventSyncDatabase()
  try {
    await t.test('two connections claiming an absent source get exactly one true', async () => {
      db.sql("DELETE FROM public.community_event_sync_state WHERE source = 'caaci'")
      const answers = await db.together([
        "SELECT public.claim_community_event_sync('caaci', interval '12 minutes')",
        "SELECT public.claim_community_event_sync('caaci', interval '12 minutes')",
      ], { role: 'service_role' })
      assert.equal(new Set(answers.map(answer => answer.pid)).size, 2)
      assert.deepEqual(answers.map(answer => answer.answer).sort(), ['f', 't'])
      assert.equal(db.sql("SELECT count(*) FROM public.community_event_sync_state WHERE source = 'caaci' AND last_attempt_at IS NOT NULL"), '1')
    })

    for (const role of ['anon', 'authenticated']) {
      for (const [name, args] of [
        ['claim_community_event_sync', "'caaci', interval '12 minutes'"],
        ['apply_caaci_event_snapshot', "true, '[]'::jsonb"],
        ['finish_community_event_sync', "'caaci', 'ok', NULL"],
      ]) {
        await t.test(`${role} is actually denied execution of ${name}`, () => {
          assert.equal(db.attempt(`SELECT public.${name}(${args})`, { role }),
            `42501:permission denied for function ${name}`)
        })
      }
    }
  } finally {
    db.stop()
  }
})

test('the real sync projection is accepted by the real service-only snapshot RPCs', { skip: SKIP }, async () => {
  const db = startEventSyncDatabase()
  const previous = process.env.COMMUNITY_SYNC_CAACI_EVENTS
  process.env.COMMUNITY_SYNC_CAACI_EVENTS = '1'
  try {
    db.sql("DELETE FROM public.community_events WHERE source_type = 'caaci'; DELETE FROM public.community_event_sync_state WHERE source = 'caaci'")
    const feed = JSON.parse(readFileSync(new URL('../api/__fixtures__/community-events/caaci-handler-28d59b1.json', import.meta.url), 'utf8'))
    const literal = value => "'" + String(value).replaceAll("'", "''") + "'"
    let requests = 0
    const result = await syncCaaciEvents({
      deadline: Date.now() + 20_000,
      fetch: async () => { requests++; return new Response(JSON.stringify(feed)) },
      call: async (name, args) => {
        let expression
        switch (name) {
          case 'claim_community_event_sync':
            expression = 'public.claim_community_event_sync(' + literal(args.source_in) + ',' + literal(args.interval_in) + '::interval)'
            break
          case 'apply_caaci_event_snapshot':
            expression = 'public.apply_caaci_event_snapshot(' + args.complete_in + ',' + literal(JSON.stringify(args.rows_in)) + '::jsonb)'
            break
          case 'finish_community_event_sync':
            expression = 'public.finish_community_event_sync(' + literal(args.source_in) + ',' + literal(args.outcome_in) + ','
              + (args.error_code_in === null ? 'NULL' : literal(args.error_code_in)) + ')'
            break
          default: throw new Error('Unexpected local RPC')
        }
        return JSON.parse(db.as('SELECT to_jsonb(' + expression + ')', 'service_role'))
      },
    })
    assert.deepEqual(result, { outcome: 'ok', code: null, rejected: 0 })
    assert.equal(requests, 1)
    assert.equal(db.sql("SELECT count(*) FROM public.community_events WHERE source_type = 'caaci'"), '2')
    assert.equal(db.sql("SELECT coalesce(title,title_en) FROM public.community_events WHERE source_key = 'a0000000-0000-4000-8000-000000000002'"), 'Synthetic second gathering')
    assert.equal(db.sql("SELECT last_outcome || ':' || (last_success_at IS NOT NULL)::text FROM public.community_event_sync_state WHERE source = 'caaci'"), 'ok:true')
  } finally {
    if (previous === undefined) delete process.env.COMMUNITY_SYNC_CAACI_EVENTS
    else process.env.COMMUNITY_SYNC_CAACI_EVENTS = previous
    db.stop()
  }
})
