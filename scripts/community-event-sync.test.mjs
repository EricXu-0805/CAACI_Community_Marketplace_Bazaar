import assert from 'node:assert/strict'
import test from 'node:test'
import { SKIP, startEventSyncDatabase } from './fixtures/community-member-events-database.mjs'

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
