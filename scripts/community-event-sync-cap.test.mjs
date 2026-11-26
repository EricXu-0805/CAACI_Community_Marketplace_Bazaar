import assert from 'node:assert/strict'
import test from 'node:test'
import { readMigration } from './fixtures/community-p3-database.mjs'
import {
  id, SKIP, startEventSyncDatabase, startEventSyncCapDatabase, startMemberEventsDatabase,
} from './fixtures/community-member-events-database.mjs'

const A = '20261123201501_community_event_sync.sql'
const B = '20261125004742_community_event_sync_cap.sql'
const keys = [id(9601), id(9602), id(9603)]
const result = '{"complete": true, "rejected": 0}'
const row = key => `jsonb_build_object(
  'source_type','caaci','source_key','${key}','organizer_name','CAACI',
  'title','Fresh','summary','Synthetic snapshot.',
  'starts_at',now()+interval '3 days','ends_at',now()+interval '3 days 2 hours',
  'location','Synthetic hall','page_url','https://caaciorg.com/events/#cap-${key}',
  'registration_mode','info_only','takes_registrations',false,'registration_open',false)`
const snapshot = selected => `SELECT public.apply_caaci_event_snapshot(true,jsonb_build_array(${selected.map(row).join(',')}))`
const state = (db, key) => db.sql(`SELECT availability||':'||missing_checks FROM public.community_events WHERE source_key='${key}'`)

function contract(db) {
  return db.sql(`SELECT string_agg(p.oid::regprocedure::text||'|'||
    pg_get_function_arguments(p.oid)||'|'||pg_get_function_result(p.oid)||'|'||
    p.prosecdef::text||'|'||p.proisstrict::text||'|'||p.provolatile::text||'|'||
    coalesce(p.proconfig::text,'')||'|'||p.proowner::regrole::text||'|'||
    coalesce(p.proacl::text,''), E'\\n' ORDER BY p.oid::regprocedure::text)
    FROM pg_proc AS p WHERE p.oid IN (
      'public.claim_community_event_sync(text,interval)'::regprocedure,
      'public.apply_caaci_event_snapshot(boolean,jsonb)'::regprocedure,
      'public.finish_community_event_sync(text,text,text)'::regprocedure)`)
}

function seedPoisonedRows(db) {
  db.sql(`INSERT INTO public.community_events
    (id,source_type,source_key,organizer_name,title,starts_at,page_url,
      registration_mode,availability,hidden_reason,missing_checks,missing_since)
    VALUES
    ('${keys[0]}','caaci','${keys[0]}','CAACI','Unavailable synthetic event',now()+interval '3 days',
      'https://caaciorg.com/events/#cap-unavailable','info_only','unavailable',NULL,32767,now()-interval '300 days'),
    ('${keys[1]}','caaci','${keys[1]}','CAACI','Hidden synthetic event',now()+interval '3 days',
      'https://caaciorg.com/events/#cap-hidden','info_only','hidden','admin',32767,now()-interval '300 days'),
    ('${keys[2]}','caaci','${keys[2]}','CAACI','Before snapshot',now()+interval '3 days',
      'https://caaciorg.com/events/#cap-fresh','info_only','visible',NULL,0,NULL)`)
}

test('cap preserves all three sync function contracts including strictness', { skip: SKIP }, () => {
  const before = startEventSyncDatabase()
  try {
    const after = startEventSyncCapDatabase()
    try {
      assert.equal(contract(after), contract(before))
    } finally {
      after.stop()
    }
  } finally {
    before.stop()
  }
})

test('cap prevents A overflow and commits the fresh snapshot beside poisoned rows', { skip: SKIP }, () => {
  const statement = snapshot([keys[2]])
  const before = startEventSyncDatabase()
  try {
    seedPoisonedRows(before)
    assert.match(before.attempt(statement, { role: 'service_role' }), /^22003:/)
  } finally {
    before.stop()
  }
  const after = startEventSyncCapDatabase()
  try {
    seedPoisonedRows(after)
    assert.equal(after.as(statement, 'service_role'), result)
    assert.equal(state(after, keys[0]), 'unavailable:2')
    assert.equal(state(after, keys[1]), 'hidden:2')
    assert.equal(after.sql(`SELECT title FROM public.community_events WHERE source_key='${keys[2]}'`), 'Fresh')
  } finally {
    after.stop()
  }
})

test('five absences preserve the first missing time and reappearance resets the count', { skip: SKIP }, () => {
  const db = startEventSyncCapDatabase()
  try {
    db.as(snapshot([keys[0]]), 'service_role')
    const states = []
    const missingSince = []
    for (let absence = 0; absence < 5; absence++) {
      db.as(snapshot([]), 'service_role')
      states.push(state(db, keys[0]))
      missingSince.push(db.sql(`SELECT missing_since::text FROM public.community_events WHERE source_key='${keys[0]}'`))
    }
    assert.deepEqual(states, ['visible:1', 'unavailable:2', 'unavailable:2', 'unavailable:2', 'unavailable:2'])
    assert.notEqual(missingSince[0], '')
    assert.deepEqual(missingSince, Array(5).fill(missingSince[0]))
    db.as(snapshot([keys[0]]), 'service_role')
    assert.equal(state(db, keys[0]), 'visible:0')
    assert.equal(db.sql(`SELECT (missing_since IS NULL)::text FROM public.community_events WHERE source_key='${keys[0]}'`), 'true')
  } finally {
    db.stop()
  }
})

test('unhide keeps the existing threshold for capped and once-missing events', { skip: SKIP }, () => {
  const db = startEventSyncCapDatabase()
  try {
    db.as(snapshot(keys.slice(0, 2)), 'service_role')
    for (const [key, count, expected] of [
      [keys[0], 2, 'unavailable:2'],
      [keys[1], 1, 'visible:1'],
    ]) {
      db.sql(`UPDATE public.community_events SET availability='hidden',hidden_reason='admin',
        missing_checks=${count},missing_since=now()-interval '1 day' WHERE source_key='${key}'`)
      const eventId = db.sql(`SELECT id FROM public.community_events WHERE source_key='${key}'`)
      db.mutate('operator', 'unhide_event', {
        event_id: eventId,
        reason: 'Source details rechecked for this synthetic regression.',
      })
      assert.equal(state(db, key), expected)
    }
  } finally {
    db.stop()
  }
})

test('cap leaves a poisoned event outside the 179-day window untouched', { skip: SKIP }, () => {
  const db = startEventSyncCapDatabase()
  try {
    db.as(snapshot([keys[0]]), 'service_role')
    db.sql(`UPDATE public.community_events SET starts_at=now()-interval '200 days 2 hours',
      ends_at=now()-interval '200 days',availability='unavailable',missing_checks=32767,
      missing_since=now()-interval '300 days' WHERE source_key='${keys[0]}'`)
    db.as(snapshot([]), 'service_role')
    assert.equal(db.sql(`SELECT missing_checks::text FROM public.community_events WHERE source_key='${keys[0]}'`), '32767')
  } finally {
    db.stop()
  }
})

test('cap refuses a second application and refuses a database without A', { skip: SKIP }, () => {
  const migrated = startEventSyncCapDatabase()
  try {
    assert.throws(() => migrated.sql(readMigration(B)), error => error instanceof Error &&
      error.message.includes('community_event_sync_cap_precondition:function:public.apply_caaci_event_snapshot(boolean,jsonb):55227c4b42b7ac90e9b1ba34f274b057'))
  } finally {
    migrated.stop()
  }
  const predecessor = startMemberEventsDatabase()
  try {
    assert.throws(() => predecessor.sql(readMigration(B)), error => error instanceof Error &&
      error.message.includes('community_event_sync_cap_precondition:function:public.claim_community_event_sync(text,interval):missing'))
  } finally {
    predecessor.stop()
  }
})

test('cap bytes change only the authorized absence line and CREATE declaration', () => {
  const definitions = [A, B].map(name => {
    const definition = /CREATE(?: OR REPLACE)? FUNCTION public\.apply_caaci_event_snapshot[\s\S]*?\$function\$;/.exec(readMigration(name))?.[0]
    assert.ok(definition)
    const body = /AS \$function\$([\s\S]*?)\$function\$;/.exec(definition)?.[1]
    assert.ok(body)
    return { declaration: definition.split('\n')[0], lines: body.split('\n') }
  })
  const [before, after] = definitions
  assert.equal(after.declaration, before.declaration.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'))
  assert.equal(after.lines.length, before.lines.length)
  assert.deepEqual(before.lines.flatMap((line, index) =>
    line === after.lines[index] ? [] : [[line, after.lines[index]]]), [[
    '       SET missing_checks = missing_checks + 1,',
    '       SET missing_checks = LEAST(missing_checks + 1, 2),',
  ]])
})
