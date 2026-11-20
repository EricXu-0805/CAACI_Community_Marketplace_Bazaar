import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { ADMIN, PRE_P3_CAPABILITIES } from './fixtures/community-p3-database.mjs'
import {
  CREATED, DISPATCHER, EVENT_CAACI, EVENT_CAMPUS, EVENT_PARTNER, EVENT_REVOKED, EVENT_UNAVAILABLE, MEMBER_A, MEMBER_B, OFFICIAL,
  PARTNER, PREDECESSOR, RESTRICTED, SKIP, STATES, TOKENS, UNVERIFIED, id, pinned, readOps, setState, startEventsDatabase,
} from './fixtures/community-events-database.mjs'

/*
 * P4.2: community events in one table with a separate way in for each source,
 * and the database side of P4.8 (the list the events page reads) and P4.9 (one
 * discussion topic per event, takedown). Asked as anon, two verified members,
 * an unverified member, a restricted member and the service role.
 */
const EVENTS = 'public.admin_execute_community_events(text,uuid,text,text,jsonb)'
const CREATE = 'public.create_member_event(uuid,text,text,jsonb)'
const LIST = 'public.list_community_events(text,text,text,integer)'
const ACTIONS = ['create_event_discussion', 'hide_event', 'unhide_event']
const P3_ACTIONS = ['restore_content', 'set_post_official', 'set_post_featured', 'set_post_locked', 'set_post_category']
const REASON = 'Reviewed by the site team'
const ANON = { role: 'anon', uid: '' }
const post = n => id(6000 + n)

test('P4.2 community events', { skip: SKIP }, async t => {
  const db = startEventsDatabase()
  const { sql, as, attempt, mutate, createEvent } = db
  try {
    const member = (uid = MEMBER_A) => ({ role: 'authenticated', uid })
    const ask = (statement, who = member()) => attempt(statement, { ...who, ask: true })
    // What the owner of the database is told when a statement is refused.
    const owner = statement => { try { sql(statement); return 'ok' } catch (error) { return /ERROR:\s+(.*)/.exec(String(error.stderr))[1] } }
    // A committed member event; returns {post_id, event_id}.
    const commitEvent = (uid, postId, options) => JSON.parse(as(createEvent(uid, postId, options), 'authenticated', uid))
    const event = (eventId, columns) => sql(`SELECT ${columns} FROM public.community_events WHERE id = '${eventId}'`)
    const written = () => sql(`SELECT (SELECT count(*) FROM public.admin_audit_log) || ':' || (SELECT count(*) FROM public.admin_mutation_requests)
      || ':' || (SELECT count(*) FROM public.posts)`)

    await t.test('the ops files pin what the migration reads and what it stores', () => {
      const precheck = pinned(readOps('PRECHECK_20261120122054_community_events.sql'))
      assert.equal(db.readBefore.size, 8)
      for (const [signature, md5] of db.readBefore) assert.equal(precheck.get(signature), md5, `PRECHECK does not pin the stored ${signature}`)
      const verify = pinned(readOps('VERIFY_20261120122054_community_events.sql'))
      const after = db.bodyMd5([DISPATCHER, PREDECESSOR, ...CREATED])
      assert.equal(after.size, CREATED.length + 2)
      for (const [signature, md5] of after) assert.equal(verify.get(signature), md5, `VERIFY does not pin the stored ${signature}`)
      // The previous dispatcher is kept whole under its new name, and nothing the migration only reads has changed.
      assert.equal(after.get(PREDECESSOR), db.readBefore.get(DISPATCHER))
      assert.notEqual(after.get(DISPATCHER), db.readBefore.get(DISPATCHER))
      const untouched = [...db.readBefore.keys()].filter(signature => signature !== DISPATCHER)
      assert.deepEqual(db.bodyMd5(untouched), new Map([...db.readBefore].filter(([signature]) => signature !== DISPATCHER)))
    })

    await t.test('four sources, one row per source key, and a partner row needs its consent', () => {
      assert.equal(sql(`SELECT string_agg(source_type, ',' ORDER BY source_type) FROM (SELECT DISTINCT source_type FROM public.community_events) AS s`), 'caaci,campus,partner')
      assert.match(attempt(`INSERT INTO public.community_events (source_type, source_key, title, starts_at, registration_mode)
        VALUES ('club', 'x', 'T', now(), 'info_only')`, { role: 'service_role' }), /^42501:/)
      assert.match(owner(`INSERT INTO public.community_events (source_type, source_key, title, starts_at, registration_mode)
        VALUES ('club', 'x', 'T', now(), 'info_only')`), /community_events_source_type_check/)
      // The same event from the same source twice.
      assert.match(owner(`INSERT INTO public.community_events (source_type, source_key, organizer_name, title_en, starts_at, page_url, registration_mode)
        VALUES ('campus', '7/123456', 'University Library', 'Again', now(), 'https://calendars.illinois.edu/detail/7/123456', 'calendar_page')`), /community_events_source_unique/)
      // No recorded consent: neither the partner nor a partner event can be written.
      assert.match(owner(`INSERT INTO public.community_event_partners (slug, name_zh, name_en, consent_recorded_on, contact_role)
        VALUES ('no-consent', '无', 'None', '2026-11-01', 'President')`), /consent_ref/)
      assert.match(owner(`INSERT INTO public.community_events (source_type, source_key, partner_id, title, summary, starts_at, page_url, registration_mode)
        VALUES ('partner', 'chess-club|https://chess.example.test/b', '${PARTNER}', 'B', 'S', now(), 'https://chess.example.test/b', 'info_only')`), /community_events_partner_shape/)
      // An organization's row never carries a cancellation: that is for a member's own event.
      assert.match(owner(`UPDATE public.community_events SET cancelled_at = now() WHERE id = '${EVENT_CAACI}'`), /community_events_cancel_member_check/)
      assert.equal(sql(`SELECT count(*) FROM public.community_event_sync_state`), '0')
    })

    await t.test('anon reads visible rows only, and only the allowlisted columns', () => {
      assert.equal(ask(`SELECT string_agg(id::text, ',' ORDER BY id) FROM public.community_events`, ANON),
        `value:${[EVENT_CAACI, EVENT_PARTNER, EVENT_CAMPUS].sort().join(',')}`)
      // The revoked partner's event and the row its source withdrew are not there for anyone.
      for (const who of [ANON, member()]) {
        assert.equal(ask(`SELECT count(*) FROM public.community_events WHERE id IN ('${EVENT_REVOKED}', '${EVENT_UNAVAILABLE}')`, who), 'value:0')
      }
      for (const column of ['content_hash', 'missing_since', 'missing_checks', 'last_checked_at', 'first_seen_at', 'last_seen_at',
        'source_updated_at', 'review_flag', 'hidden_reason', 'consent_ref', 'created_by']) {
        assert.match(attempt(`SELECT ${column} FROM public.community_events`, ANON), /^42501:/, column)
        assert.match(attempt(`SELECT ${column} FROM public.community_events`, member()), /^42501:/, column)
      }
      assert.equal(ask(`SELECT string_agg(slug, ',') FROM public.community_event_partners`, ANON), 'value:chess-club')
      assert.match(attempt(`SELECT consent_ref FROM public.community_event_partners`, ANON), /^42501:/)
      assert.equal(ask(`SELECT count(*) FROM public.community_event_sync_state`, ANON), 'value:0')
      // No client writes an organization's row, and nobody deletes. The service role only reads.
      for (const who of [ANON, member(), { role: 'service_role', uid: '' }]) {
        assert.match(attempt(`UPDATE public.community_events SET title = 'x' WHERE id = '${EVENT_CAACI}'`, who), /^42501:/)
        assert.match(attempt(`DELETE FROM public.community_events WHERE id = '${EVENT_CAACI}'`, who), /^42501:/)
        assert.match(attempt(`INSERT INTO public.community_event_partners (slug, name_zh, name_en, consent_ref, consent_recorded_on, contact_role)
          VALUES ('x-club', 'x', 'x', 'CONSENT-009', '2026-11-01', 'Lead')`, who), /^42501:/)
        assert.match(attempt(`INSERT INTO public.community_event_sync_state (source) VALUES ('caaci')`, who), /^42501:/)
      }
      assert.equal(ask(`SELECT count(*) FROM public.community_events`, { role: 'service_role', uid: '' }), 'value:5')
    })

    await t.test('a member event is written only by create_member_event, for an eligible member, within the rules', () => {
      // Through the function: one topic in 找搭子 and one event, linked both ways.
      const made = commitEvent(MEMBER_A, post(1), { title: '  Badminton on Saturday ' })
      assert.equal(made.post_id, post(1))
      assert.equal(event(made.event_id, `source_type || '|' || source_key || '|' || organizer_user_id || '|' || discussion_post_id || '|' || registration_mode || '|' || availability`),
        `member|${post(1)}|${MEMBER_A}|${post(1)}|discussion|visible`)
      assert.equal(sql(`SELECT category || '|' || user_id || '|' || title FROM public.posts WHERE id = '${post(1)}'`), `events-social|${MEMBER_A}|Badminton on Saturday`)
      // A retry with the same id returns the pair that exists; nothing is written twice.
      const before = written()
      assert.deepEqual(commitEvent(MEMBER_A, post(1)), made)
      assert.equal(written(), before)
      assert.equal(sql(`SELECT count(*) FROM public.community_events WHERE source_type = 'member'`), '1')
      // The same id from another member is not theirs to get.
      assert.match(attempt(createEvent(MEMBER_B, post(1)), member(MEMBER_B)), /^23505:/)
      // A second event with the text of the first, inside a minute, is still refused as a repeated topic.
      assert.equal(attempt(createEvent(MEMBER_A, post(2), { content: `Three of us, three more welcome (${post(1).slice(-4)}).` }), member()), 'P0001:duplicate_post')

      // Straight into the table, around the function: no topic, the member's own earlier topic, somebody else's topic.
      const direct = (topic, organizer = MEMBER_A) => attempt(`INSERT INTO public.community_events
        (source_type, source_key, organizer_user_id, discussion_post_id, starts_at, location, registration_mode)
        VALUES ('member', '${topic || post(9)}', '${organizer}', ${topic ? `'${topic}'` : 'NULL'}, now() + interval '1 day', 'ARC', 'discussion')`, member())
      assert.equal(direct(null), '42501:member_event_rpc_required')
      assert.equal(direct(post(1)), '42501:member_event_rpc_required')
      assert.equal(direct(id(21)), '42501:member_event_rpc_required')
      assert.equal(direct(id(21), MEMBER_B), '42501:member_event_rpc_required')
      // A source that is not a member's is stopped by row security.
      assert.match(attempt(`INSERT INTO public.community_events (source_type, source_key, starts_at, registration_mode)
        VALUES ('caaci', '${id(22)}', now(), 'info_only')`, member()), /^42501:new row violates row-level security/)

      assert.equal(attempt(createEvent(UNVERIFIED, post(2)), member(UNVERIFIED)), '42501:member_event_not_eligible')
      assert.equal(attempt(createEvent(MEMBER_A, post(2), { starts: "now() + interval '61 days'" }), member()), '22008:member_event_time_out_of_range')
      assert.equal(attempt(createEvent(MEMBER_A, post(2), { starts: "now() - interval '1 minute'" }), member()), '22008:member_event_time_out_of_range')
      assert.equal(attempt(createEvent(MEMBER_A, post(2), { starts: "'not a time'" }), member()), '22008:member_event_time_out_of_range')
      assert.equal(attempt(createEvent(MEMBER_A, post(2), { title: 'x'.repeat(61) }), member()), '22023:member_event_title_too_long')
      assert.equal(attempt(createEvent(MEMBER_A, post(2), { location: 'x'.repeat(81) }), member()), '22023:member_event_location_invalid')
      assert.equal(attempt(createEvent(MEMBER_A, post(2), { location: '  ' }), member()), '22023:member_event_location_invalid')
      for (const title of ['官方羽毛球活动', 'Official badminton', 'Badminton hosted by us', '学生会主办的球赛']) {
        assert.equal(attempt(createEvent(MEMBER_A, post(2), { title }), member()), '23514:member_event_reserved_wording', title)
      }
      for (const options of [{ title: 'Sign up at example.com' }, { content: 'Details: https://forms.example.test/x' }, { location: 'www.example.org lobby' }, { content: 'see bit.ly/abc' }]) {
        assert.equal(attempt(createEvent(MEMBER_A, post(2), options), member()), '23514:member_event_link_not_allowed', JSON.stringify(options))
      }
      // A refused call leaves no topic behind, also when it is not rolled back by the caller.
      assert.throws(() => as(createEvent(UNVERIFIED, post(2)), 'authenticated', UNVERIFIED), /member_event_not_eligible/)
      assert.equal(sql(`SELECT count(*) FROM public.posts WHERE id = '${post(2)}'`), '0')

      // Two open events at most; an event that is cancelled does not count.
      commitEvent(MEMBER_A, post(3))
      assert.equal(attempt(createEvent(MEMBER_A, post(4)), member()), '23514:member_event_active_limit')
      as(`UPDATE public.community_events SET cancelled_at = now() WHERE discussion_post_id = '${post(3)}'`, 'authenticated', MEMBER_A)
      assert.equal(attempt(createEvent(MEMBER_A, post(4)), member()), 'ok:1')
      assert.equal(attempt(createEvent(MEMBER_B, post(5)), member(MEMBER_B)), 'ok:1', 'another member has their own two')
    })

    await t.test('one form sent twice at once makes one topic and one event', async () => {
      const call = createEvent(MEMBER_B, post(31))
      const answers = await db.together([call, call], { role: 'authenticated', uid: MEMBER_B })
      assert.deepEqual(JSON.parse(answers[0]), JSON.parse(answers[1]))
      assert.equal(JSON.parse(answers[0]).post_id, post(31))
      assert.equal(sql(`SELECT (SELECT count(*) FROM public.posts WHERE id = '${post(31)}') || ':'
        || (SELECT count(*) FROM public.community_events WHERE organizer_user_id = '${MEMBER_B}')`), '1:1')
    })

    await t.test('an organizer cancels once, may leave a note, and edits nothing else', () => {
      const eventId = sql(`SELECT id FROM public.community_events WHERE discussion_post_id = '${post(1)}'`)
      const own = { role: 'authenticated', uid: MEMBER_A }
      assert.match(attempt(`UPDATE public.community_events SET starts_at = now() + interval '5 days' WHERE id = '${eventId}'`, own), /^42501:/)
      assert.match(attempt(`UPDATE public.community_events SET location = 'Elsewhere' WHERE id = '${eventId}'`, own), /^42501:/)
      assert.equal(attempt(`UPDATE public.community_events SET cancelled_at = now() WHERE id = '${eventId}'`, member(MEMBER_B)), 'ok:0', 'not their event')
      as(`UPDATE public.community_events SET cancelled_at = now(), status_note = 'Court is closed' WHERE id = '${eventId}'`, 'authenticated', MEMBER_A)
      assert.equal(event(eventId, `(cancelled_at IS NOT NULL)::text || '|' || status_note`), 'true|Court is closed')
      assert.equal(attempt(`UPDATE public.community_events SET cancelled_at = NULL WHERE id = '${eventId}'`, own), '23514:member_event_cancel_final')
      assert.equal(attempt(`UPDATE public.community_events SET cancelled_at = now() + interval '1 hour' WHERE id = '${eventId}'`, own), '23514:member_event_cancel_final')
      // The note can still be corrected, and the topic stays.
      assert.equal(attempt(`UPDATE public.community_events SET status_note = 'Court is closed today' WHERE id = '${eventId}'`, own), 'ok:1')
      assert.equal(sql(`SELECT status FROM public.posts WHERE id = '${post(1)}'`), 'active')
    })

    await t.test('a member event follows its topic: hidden or deleted with it, back when it is restored', () => {
      const made = commitEvent(MEMBER_B, post(11))
      const state = () => event(made.event_id, `availability || '|' || coalesce(hidden_reason, '-')`)
      const seenByAnon = () => ask(`SELECT count(*) FROM public.community_events WHERE id = '${made.event_id}'`, ANON)
      assert.equal(seenByAnon(), 'value:1')
      sql(`UPDATE public.posts SET status = 'hidden' WHERE id = '${post(11)}'`)
      assert.equal(state(), 'hidden|post_removed')
      assert.equal(seenByAnon(), 'value:0')
      // The organizer still reads their own.
      assert.equal(ask(`SELECT count(*) FROM public.community_events WHERE id = '${made.event_id}'`, member(MEMBER_B)), 'value:1')
      sql(`UPDATE public.posts SET status = 'active' WHERE id = '${post(11)}'`)
      assert.equal(state(), 'visible|-')
      sql(`UPDATE public.posts SET status = 'deleted' WHERE id = '${post(11)}'`)
      assert.equal(state(), 'hidden|post_removed')
      sql(`UPDATE public.posts SET status = 'active' WHERE id = '${post(11)}'`)
      // A takedown of the event itself is not undone by restoring the topic.
      assert.deepEqual(mutate('operator', 'hide_event', { event_id: made.event_id, reason: REASON }), { success: true })
      sql(`UPDATE public.posts SET status = 'hidden' WHERE id = '${post(11)}'`)
      // Lifting the takedown while the topic is still hidden leaves the event hidden for that reason.
      assert.deepEqual(mutate('operator', 'unhide_event', { event_id: made.event_id, reason: REASON }), { success: true })
      assert.equal(state(), 'hidden|post_removed')
      sql(`UPDATE public.posts SET status = 'active' WHERE id = '${post(11)}'`)
      assert.equal(state(), 'visible|-')
      assert.deepEqual(mutate('operator', 'hide_event', { event_id: made.event_id, reason: REASON }), { success: true })
      sql(`UPDATE public.posts SET status = 'hidden' WHERE id = '${post(11)}'`)
      sql(`UPDATE public.posts SET status = 'active' WHERE id = '${post(11)}'`)
      assert.equal(state(), 'hidden|admin')
      assert.deepEqual(mutate('operator', 'unhide_event', { event_id: made.event_id, reason: REASON }), { success: true })
      assert.equal(state(), 'visible|-')
      // A hidden or taken-down event still holds one of its organizer's two places.
      assert.equal(attempt(createEvent(MEMBER_B, post(12)), member(MEMBER_B)), '23514:member_event_active_limit')
      // The author removes the topic altogether: the link is cleared, the event stays hidden, and its place is free.
      as(`DELETE FROM public.posts WHERE id = '${post(11)}'`, 'authenticated', MEMBER_B)
      assert.equal(event(made.event_id, `availability || '|' || hidden_reason || '|' || (discussion_post_id IS NULL)::text`), 'hidden|post_removed|true')
      assert.equal(attempt(createEvent(MEMBER_B, post(12)), member(MEMBER_B)), 'ok:1')
    })

    await t.test('an organization event that moves keeps its previous time; a member event has no such bookkeeping', () => {
      assert.equal(event(EVENT_CAMPUS, `revision || '|' || (previous_starts_at IS NULL)::text || '|' || (schedule_changed_at IS NULL)::text`), '1|true|true')
      const was = event(EVENT_CAMPUS, 'starts_at')
      sql(`UPDATE public.community_events SET location = 'Room 106' WHERE id = '${EVENT_CAMPUS}'`)
      assert.equal(event(EVENT_CAMPUS, `revision || '|' || (previous_starts_at IS NULL)::text`), '2|true')
      sql(`UPDATE public.community_events SET starts_at = starts_at + interval '1 day' WHERE id = '${EVENT_CAMPUS}'`)
      assert.equal(event(EVENT_CAMPUS, `revision || '|' || (previous_starts_at = '${was}')::text || '|' || (schedule_changed_at IS NOT NULL)::text || '|' || (updated_at >= created_at)::text`), '3|true|true|true')
      sql(`UPDATE public.community_events SET summary = 'Bring a laptop.' WHERE id = '${EVENT_CAMPUS}'`)
      assert.equal(event(EVENT_CAMPUS, 'revision'), '3')
      // A member row is cancelled, hidden and restored without any of it.
      assert.equal(sql(`SELECT string_agg(DISTINCT revision || '|' || (previous_starts_at IS NULL)::text, ',') FROM public.community_events WHERE source_type = 'member'`), '1|true')
    })

    await t.test('the list: windows, order, limit, duplicates, and member rows with their topic', () => {
      sql(`INSERT INTO public.community_events (id, source_type, source_key, organizer_name, title_en, starts_at, ends_at, page_url, registration_mode, duplicate_of)
          VALUES ('${id(61)}', 'campus', '7/200', 'Library', 'Duplicate of the CAACI one', now() + interval '3 days', NULL, 'https://calendars.illinois.edu/detail/7/200', 'calendar_page', '${EVENT_CAACI}'),
                 ('${id(62)}', 'campus', '7/201', 'Library', 'Over last week', now() - interval '7 days', now() - interval '6 days 22 hours', 'https://calendars.illinois.edu/detail/7/201', 'calendar_page', NULL),
                 ('${id(63)}', 'campus', '7/202', 'Library', 'Over long ago', now() - interval '200 days', NULL, 'https://calendars.illinois.edu/detail/7/202', 'calendar_page', NULL),
                 ('${id(64)}', 'campus', '7/203', 'Library', 'Too far ahead', now() + interval '181 days', NULL, 'https://calendars.illinois.edu/detail/7/203', 'calendar_page', NULL),
                 ('${id(65)}', 'campus', '7/204', 'Library', 'Started, still on', now() - interval '1 hour', now() + interval '1 hour', 'https://calendars.illinois.edu/detail/7/204', 'calendar_page', NULL);
        UPDATE public.community_events SET starts_at = (SELECT starts_at FROM public.community_events WHERE id = '${EVENT_CAACI}') WHERE id IN ('${EVENT_PARTNER}', '${EVENT_CAMPUS}')`)
      const titles = (args, who = ANON) => ask(`SELECT string_agg(coalesce(listed.title, listed.title_en), ' > ' ORDER BY listed.ordinality)
        FROM public.list_community_events(${args}) WITH ORDINALITY AS listed`, who).replace(/^value:/, '').replace(/^null$/, '')
      // Upcoming: what is still on comes first, then by start; on a tie caaci, partner, campus, member.
      const upcoming = titles('').split(' > ')
      assert.equal(upcoming[0], 'Started, still on')
      assert.deepEqual(upcoming.filter(title => ['迎新晚会', '公开赛', 'Research workshop'].includes(title)), ['迎新晚会', '公开赛', 'Research workshop'])
      for (const unlisted of ['Duplicate of the CAACI one', 'Over last week', 'Over long ago', 'Too far ahead', '旧活动', '已撤下']) {
        assert.ok(!upcoming.includes(unlisted), unlisted)
      }
      // A member row carries its topic's title; a cancelled one is still listed until it is over, a hidden one is not.
      assert.equal(upcoming.filter(title => title === 'Badminton on Saturday').length, 3)
      assert.equal(titles(`window_in => 'past'`), 'Over last week')
      assert.equal(titles(`source_in => 'partner'`), '公开赛')
      assert.equal(titles(`source_in => 'club'`), '')
      assert.equal(titles(`region_in => 'chicago'`), '')
      assert.equal(titles(`limit_in => 1`), 'Started, still on')
      assert.equal(titles(`limit_in => 0`), 'Started, still on')
      assert.equal(titles(`limit_in => 100000`).split(' > ').length, upcoming.length)
      // A member event whose topic is hidden is not listed.
      sql(`UPDATE public.posts SET status = 'hidden' WHERE id = '${post(3)}'`)
      assert.equal(titles('').split(' > ').filter(title => title === 'Badminton on Saturday').length, 2)
      sql(`UPDATE public.posts SET status = 'active' WHERE id = '${post(3)}'`)
      // What a row carries for the page.
      assert.equal(ask(`SELECT partner_name_zh || '|' || partner_name_en || '|' || array_to_string(allowed_link_hosts, ',') || '|' || registration_mode
        FROM public.list_community_events(source_in => 'partner')`, ANON), 'value:国际象棋社|Chess Club|chess.example.test|info_only')
      assert.equal(ask(`SELECT organizer_nickname || '|' || organizer_is_illini_verified::text || '|' || discussion_count || '|' || (discussion_post_id = '${post(1)}')::text
          || '|' || (cancelled_at IS NOT NULL)::text || '|' || status_note
        FROM public.list_community_events(source_in => 'member') WHERE organizer_user_id = '${MEMBER_A}' AND discussion_post_id = '${post(1)}'`, member(MEMBER_B)),
      'value:Member A|true|0|true|true|Court is closed')
    })

    await t.test('the list and the app agree on when an event is over: the shared effective-end rows, either side of now', () => {
      // The two JavaScript implementations are run against the same file (ENGINEERING 5.5).
      const rows = JSON.parse(readFileSync(new URL('../api/__fixtures__/community-events/effective-end.json', import.meta.url), 'utf8'))
      assert.ok(rows.length >= 4, `only ${rows.length} rows`)
      const stamp = value => (value == null ? 'NULL' : `'${value}'::timestamptz + moved.by`)
      // Each row twice, moved as a whole so that its effective end is an hour ahead of now, and an hour behind.
      const place = (row, index, side) => {
        const key = 8000 + index * 2 + (side === 'ahead' ? 0 : 1)
        sql(`INSERT INTO public.community_events (id, source_type, source_key, organizer_name, title_en, starts_at, ends_at, all_day, occurrence_count, page_url, registration_mode)
          SELECT '${id(key)}', 'campus', '7/${key}', 'Library', 'Effective end ${key}', ${stamp(row.starts_at)}, ${stamp(row.ends_at)},
            ${row.all_day === true}, ${row.occurrence_count || 1}, 'https://calendars.illinois.edu/detail/7/${key}', 'calendar_page'
          FROM (SELECT now() ${side === 'ahead' ? '+' : '-'} interval '1 hour' - '${row.effective_end}'::timestamptz AS by) AS moved`)
        return id(key)
      }
      const ahead = rows.map((row, index) => place(row, index, 'ahead'))
      const behind = rows.map((row, index) => place(row, index, 'behind'))
      const listed = window => ask(`SELECT coalesce(string_agg(listed.id::text, ',' ORDER BY listed.id), '')
        FROM public.list_community_events(source_in => 'campus', window_in => '${window}') AS listed
        WHERE listed.id IN (${[...ahead, ...behind].map(value => `'${value}'`).join(', ')})`, ANON).replace(/^value:/, '')
      assert.equal(listed('upcoming'), [...ahead].sort().join(','), rows.map(row => row.name).join(', '))
      assert.equal(listed('past'), [...behind].sort().join(','), rows.map(row => row.name).join(', '))
      sql(`DELETE FROM public.community_events WHERE id IN (${[...ahead, ...behind].map(value => `'${value}'`).join(', ')})`)
    })

    await t.test('the three administrator actions: who may, what they change, and one audit row each', () => {
      const capabilities = role => sql(`SELECT string_agg(action, ',' ORDER BY action) FROM public.admin_role_action_capabilities WHERE admin_role = '${role}'`).split(',')
      assert.deepEqual(capabilities('operator'), [...PRE_P3_CAPABILITIES.operator, 'restore_content', 'set_post_category', 'set_post_locked', 'hide_event', 'unhide_event'].sort())
      assert.deepEqual(capabilities('owner'), [...PRE_P3_CAPABILITIES.owner, ...P3_ACTIONS, ...ACTIONS].sort())
      assert.deepEqual(capabilities('security_admin'), PRE_P3_CAPABILITIES.security_admin)
      // The projections the deployed API compares with its own list do not grow.
      for (const role of ['owner', 'operator', 'security_admin']) {
        assert.equal(sql(`BEGIN; SET LOCAL ROLE service_role;
          SELECT role || ':' || array_to_string(capabilities, ',') FROM public.admin_token_authorization_v2('${TOKENS[role]}'); COMMIT;`),
        `${role}:${PRE_P3_CAPABILITIES[role].join(',')}`)
      }
      const accepts = (table, constraint) => sql(`SELECT string_agg(m[1], ',' ORDER BY m[1]) FROM pg_constraint AS c,
        regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') AS m
        WHERE c.conrelid = 'public.${table}'::regclass AND c.conname = '${constraint}'`).split(',')
      assert.equal(accepts('admin_mutation_requests', 'admin_mutation_requests_action_check').length, 20)
      assert.equal(accepts('admin_role_action_capabilities', 'admin_role_action_capabilities_action_check').length, 21)
      assert.equal(accepts('admin_audit_log', 'admin_audit_log_event_kind_check').length, 22)
      for (const action of ACTIONS) assert.ok(accepts('admin_mutation_requests', 'admin_mutation_requests_action_check').includes(action), action)
      assert.deepEqual(db.grants([DISPATCHER, PREDECESSOR, EVENTS, CREATE, LIST]), [
        `${EVENTS}:`, `${DISPATCHER}:service_role`, `${PREDECESSOR}:`, `${CREATE}:authenticated`, `${LIST}:anon,authenticated`,
      ].sort())
      assert.deepEqual(db.grants(CREATED.filter(signature => signature.startsWith('private.'))),
        CREATED.filter(signature => signature.startsWith('private.')).map(signature => `${signature}:`).sort())

      // Roles.
      assert.equal(mutate('security_admin', 'hide_event', { event_id: EVENT_CAMPUS, reason: REASON }), 'refused:admin_capability_denied')
      assert.equal(mutate('operator', 'create_event_discussion', { event_id: EVENT_CAMPUS, reason: REASON, official_profile_id: OFFICIAL }), 'refused:admin_capability_denied')
      // A reason, known keys and a real id are required.
      assert.equal(mutate('operator', 'hide_event', { event_id: EVENT_CAMPUS }), 'refused:admin_mutation_invalid_payload')
      assert.equal(mutate('operator', 'hide_event', { event_id: EVENT_CAMPUS, reason: REASON, extra: 1 }), 'refused:admin_mutation_invalid_payload')
      assert.equal(mutate('operator', 'hide_event', { event_id: EVENT_CAMPUS, reason: REASON, official_profile_id: OFFICIAL }), 'refused:admin_mutation_invalid_payload')
      assert.equal(mutate('operator', 'hide_event', { event_id: 'nope', reason: REASON }), 'refused:admin_mutation_invalid_payload')
      assert.equal(mutate('operator', 'hide_event', { event_id: id(99999), reason: REASON }), 'refused:event_not_found')
      assert.equal(mutate('operator', 'unhide_event', { event_id: EVENT_CAMPUS, reason: REASON }), 'refused:event_not_found', 'it is not hidden')

      // Takedown and back, each with one audit row; a replay with the same key changes nothing more.
      const before = written()
      const key = id(710001)
      assert.deepEqual(mutate('operator', 'hide_event', { event_id: EVENT_CAMPUS, reason: `  ${REASON}  ` }, key), { success: true })
      assert.equal(event(EVENT_CAMPUS, `availability || '|' || hidden_reason`), 'hidden|admin')
      assert.equal(ask(`SELECT count(*) FROM public.community_events WHERE id = '${EVENT_CAMPUS}'`, ANON), 'value:0')
      assert.deepEqual(mutate('operator', 'hide_event', { event_id: EVENT_CAMPUS, reason: `  ${REASON}  ` }, key), { success: true })
      assert.equal(mutate('operator', 'hide_event', { event_id: EVENT_CAMPUS, reason: 'Another reason' }, key, 'e'.repeat(64)), 'refused:idempotency_conflict')
      assert.equal(mutate('operator', 'unhide_event', { event_id: EVENT_CAMPUS, reason: REASON }, key), 'refused:idempotency_conflict')
      assert.equal(mutate('operator', 'hide_event', { event_id: EVENT_CAMPUS, reason: REASON }), 'refused:event_not_found', 'already taken down')
      assert.deepEqual(mutate('owner', 'unhide_event', { event_id: EVENT_CAMPUS, reason: REASON }), { success: true })
      assert.equal(event(EVENT_CAMPUS, `availability || '|' || coalesce(hidden_reason, '-')`), 'visible|-')
      const [audits, requests] = written().split(':').map(Number), [auditsBefore, requestsBefore] = before.split(':').map(Number)
      assert.deepEqual([audits - auditsBefore, requests - requestsBefore], [2, 2])
      assert.deepEqual(JSON.parse(sql(`SELECT json_agg(json_build_object('kind', event_kind, 'actor', actor_id, 'target', target_id, 'reason', details ->> 'reason') ORDER BY id)
        FROM (SELECT * FROM public.admin_audit_log ORDER BY id DESC LIMIT 2) AS last`)), [
        { kind: 'event_hidden', actor: ADMIN, target: EVENT_CAMPUS, reason: REASON },
        { kind: 'event_unhidden', actor: ADMIN, target: EVENT_CAMPUS, reason: REASON },
      ])
      // Earlier actions still go where they went.
      assert.equal(mutate('operator', 'set_post_locked', { post_id: id(99999), locked: true, reason: REASON }), 'refused:post_not_found')
    })

    await t.test('E6: without the official account create_event_discussion is refused by name and writes nothing', () => {
      const before = written()
      for (const payload of [
        { event_id: EVENT_CAACI, reason: REASON },
        { event_id: EVENT_CAACI, reason: REASON, official_profile_id: null },
        { event_id: EVENT_CAACI, reason: REASON, official_profile_id: id(424242) },
      ]) {
        assert.equal(mutate('owner', 'create_event_discussion', payload), 'refused:official_profile_not_configured', JSON.stringify(payload))
      }
      assert.equal(mutate('owner', 'create_event_discussion', { event_id: EVENT_CAACI, reason: REASON, official_profile_id: 'nope' }), 'refused:admin_mutation_invalid_payload')
      assert.equal(written(), before, 'no request row, no audit row, no topic')
      assert.equal(sql(`SELECT count(*) FROM public.community_events WHERE discussion_post_id IS NOT NULL AND source_type <> 'member'`), '0')
      // A key used for a refused call was never recorded, so it is free for the call that works.
      const key = id(730001)
      assert.equal(mutate('owner', 'create_event_discussion', { event_id: EVENT_CAACI, reason: REASON }, key), 'refused:official_profile_not_configured')
      assert.equal(sql(`SELECT count(*) FROM public.admin_mutation_requests WHERE idempotency_key = '${key}'`), '0')
      // The other two do not depend on it.
      assert.deepEqual(mutate('operator', 'hide_event', { event_id: EVENT_PARTNER, reason: REASON }), { success: true })
      assert.deepEqual(mutate('operator', 'unhide_event', { event_id: EVENT_PARTNER, reason: REASON }), { success: true })
    })

    await t.test('create_event_discussion opens one official topic per organization event', () => {
      const payload = eventId => ({ event_id: eventId, reason: REASON, official_profile_id: OFFICIAL })
      const made = mutate('owner', 'create_event_discussion', payload(EVENT_CAACI))
      assert.deepEqual(Object.keys(made.data).sort(), ['created', 'event_id', 'post_id'])
      assert.deepEqual([made.data.event_id, made.data.created], [EVENT_CAACI, true])
      assert.equal(sql(`SELECT user_id || '|' || is_official::text || '|' || category || '|' || title || '|' || status FROM public.posts WHERE id = '${made.data.post_id}'`),
        `${OFFICIAL}|true|events-social|迎新晚会|active`)
      // The body names neither a time nor a place, so it stays true when the event moves.
      assert.doesNotMatch(sql(`SELECT content FROM public.posts WHERE id = '${made.data.post_id}'`), /Illini Union|\d{1,2}:\d{2}|\d+月\d+日/)
      assert.equal(event(EVENT_CAACI, 'discussion_post_id'), made.data.post_id)
      assert.equal(sql(`SELECT event_kind || '|' || target_id || '|' || (details ->> 'post_id') || '|' || (details ->> 'created') FROM public.admin_audit_log ORDER BY id DESC LIMIT 1`),
        `event_discussion_created|${EVENT_CAACI}|${made.data.post_id}|true`)
      // Asked again with a new key: the same topic, not a second one.
      assert.deepEqual(mutate('owner', 'create_event_discussion', payload(EVENT_CAACI)).data, { event_id: EVENT_CAACI, post_id: made.data.post_id, created: false })
      assert.equal(sql(`SELECT count(*) FROM public.posts WHERE user_id = '${OFFICIAL}' AND title = '迎新晚会'`), '1')
      // The list carries it.
      assert.equal(ask(`SELECT discussion_post_id || '|' || discussion_count FROM public.list_community_events(source_in => 'caaci')`, ANON), `value:${made.data.post_id}|0`)
      // An English-only event takes its English title.
      const campus = mutate('owner', 'create_event_discussion', payload(EVENT_CAMPUS))
      assert.equal(sql(`SELECT title FROM public.posts WHERE id = '${campus.data.post_id}'`), 'Research workshop')
      // A title becomes one line of at most 120 characters with no space at either end.
      sql(`INSERT INTO public.community_events (id, source_type, source_key, organizer_name, title_en, starts_at, page_url, registration_mode)
        VALUES ('${id(66)}', 'campus', '7/300', 'Library', E'  Two\\nline   title ${'x'.repeat(130)}', now() + interval '6 days', 'https://calendars.illinois.edu/detail/7/300', 'calendar_page'),
               ('${id(67)}', 'campus', '7/301', 'Library', '   ', now() + interval '6 days', 'https://calendars.illinois.edu/detail/7/301', 'calendar_page')`)
      const shaped = mutate('owner', 'create_event_discussion', payload(id(66)))
      assert.equal(sql(`SELECT title FROM public.posts WHERE id = '${shaped.data.post_id}'`), `Two line title ${'x'.repeat(105)}`)
      // Not for a member's event (it has its own topic), a row readers cannot see, a duplicate, or a row with no title to give.
      const memberEvent = sql(`SELECT id FROM public.community_events WHERE source_type = 'member' LIMIT 1`)
      assert.equal(mutate('owner', 'create_event_discussion', payload(memberEvent)), 'refused:event_not_found')
      assert.equal(mutate('owner', 'create_event_discussion', payload(id(99999))), 'refused:event_not_found')
      for (const closed of [EVENT_UNAVAILABLE, EVENT_REVOKED, id(61), id(67)]) {
        assert.equal(mutate('owner', 'create_event_discussion', payload(closed)), 'refused:event_discussion_closed', closed)
      }
    })

    await t.test('two administrators opening the discussion at once get one topic', async () => {
      const call = key => `SELECT public.admin_execute_mutation('${TOKENS.owner}', '${key}', '${'f'.repeat(64)}', 'create_event_discussion',
        '${JSON.stringify({ event_id: EVENT_PARTNER, reason: REASON, official_profile_id: OFFICIAL })}'::jsonb)`
      const answers = (await db.together([call(id(720001)), call(id(720002))])).map(answer => JSON.parse(answer).data)
      assert.deepEqual(answers.map(answer => answer.created).sort(), [false, true])
      assert.equal(answers[0].post_id, answers[1].post_id)
      assert.equal(sql(`SELECT count(*) FROM public.posts WHERE user_id = '${OFFICIAL}' AND title = '公开赛'`), '1')
      assert.equal(event(EVENT_PARTNER, 'discussion_post_id'), answers[0].post_id)
    })

    await t.test('D-49: a restricted account cannot start an event or write a note, and can still cancel', () => {
      const made = commitEvent(RESTRICTED, post(21))
      const own = { role: 'authenticated', uid: RESTRICTED }
      for (const state of STATES) {
        setState(db, RESTRICTED, state)
        const create = attempt(createEvent(RESTRICTED, post(22)), own)
        const note = attempt(`UPDATE public.community_events SET status_note = 'Moved indoors' WHERE id = '${made.event_id}'`, own)
        const cancelWithNote = attempt(`UPDATE public.community_events SET cancelled_at = now(), status_note = 'Rained out' WHERE id = '${made.event_id}'`, own)
        const cancel = attempt(`UPDATE public.community_events SET cancelled_at = now() WHERE id = '${made.event_id}'`, own)
        const expected = state.refusal || 'ok:1'
        assert.equal(create, expected, `${state.name}: create`)
        assert.equal(note, expected, `${state.name}: note`)
        assert.equal(cancelWithNote, expected, `${state.name}: cancel with a note`)
        assert.equal(cancel, 'ok:1', `${state.name}: cancelling stays open`)
        // A retry of the form that already went through is answered from what exists, in any state.
        assert.equal(attempt(createEvent(RESTRICTED, post(21)), own), 'ok:1', `${state.name}: retry`)
      }
      setState(db, RESTRICTED, STATES[0])
      // The cached column is not consulted: only the action log decides.
      sql(`UPDATE public.profiles SET suspension_level = 5 WHERE id = '${RESTRICTED}'`)
      assert.equal(attempt(createEvent(RESTRICTED, post(22)), own), 'ok:1')
    })
  } finally {
    db.stop()
  }
})
