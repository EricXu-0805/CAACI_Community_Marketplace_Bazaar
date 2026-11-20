import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ADMIN, AUTHOR, DISPATCHER, OFFICIAL, OTHER, PREDECESSOR, PRE_P3_CAPABILITIES, REPLIER, SKIP, TOKENS, TOPIC, TOPIC_OTHER,
  UPDATE, id, startCommunityDatabase,
} from './fixtures/community-p3-database.mjs'

/*
 * P3.5: five administrator actions on the existing atomic channel (one
 * transaction: token, capability, idempotency, change, audit), and what
 * P3.6 reads: the public state of a topic, an author's own hidden topics,
 * and the report queue ordered by how long it has waited.
 */

const HIDDEN = id(31), REMOVED = id(32), OFFICIAL_POST = id(35), INVISIBLE_AUTHOR = id(36)
const GOVERNANCE = 'public.admin_execute_community_governance(text,uuid,text,text,jsonb)'
const ACTIONS = ['restore_content', 'set_post_official', 'set_post_featured', 'set_post_locked', 'set_post_category']
const key = n => id(7000 + n)

test('P3.5 governance actions and P3.6 reads', { skip: SKIP }, async t => {
  const db = startCommunityDatabase()
  const { sql, as, attempt, mutate } = db
  try {
    sql(`INSERT INTO public.profiles(id, nickname) VALUES ('${id(7)}', 'Restricted author');
      INSERT INTO public.suspensions(profile_id, level, started_at) VALUES ('${id(7)}', 3, now() - interval '1 day');
      INSERT INTO public.posts(id, user_id, content, title, category, status) VALUES
        ('${HIDDEN}','${OTHER}','Hidden body','Hidden topic','campus-life','hidden'),
        ('${REMOVED}','${OTHER}','Removed body','Removed topic','campus-life','deleted'),
        ('${OFFICIAL_POST}','${OFFICIAL}','Read this first.','Community guidelines','campus-life','active'),
        ('${INVISIBLE_AUTHOR}','${id(7)}','Body','Topic of a restricted author','campus-life','active')`)
    const post = (postId, columns) => sql(`SELECT ${columns} FROM public.posts WHERE id = '${postId}'`)
    const audit = () => JSON.parse(sql(`SELECT coalesce(json_agg(json_build_object('kind', event_kind, 'actor', actor_id, 'target', target_id,
      'details', details - 'admin_token_id' - 'idempotency_key') ORDER BY id), '[]') FROM public.admin_audit_log`))
    const written = () => sql(`SELECT (SELECT count(*) FROM public.admin_audit_log) || ':' || (SELECT count(*) FROM public.admin_mutation_requests)`)
    const entry = (kind, target, details, role = 'operator') =>
      ({ kind, actor: ADMIN, target, details: { ...details, via: 'admin_execute_mutation', admin_role: role } })

    await t.test('capabilities and vocabularies grow; the authorization projection the deployed API reads does not', () => {
      const capabilities = role => sql(`SELECT string_agg(action, ',' ORDER BY action) FROM public.admin_role_action_capabilities WHERE admin_role = '${role}'`).split(',')
      assert.deepEqual(capabilities('operator'), [...PRE_P3_CAPABILITIES.operator, 'restore_content', 'set_post_category', 'set_post_locked'].sort())
      assert.deepEqual(capabilities('owner'), [...PRE_P3_CAPABILITIES.owner, ...ACTIONS].sort())
      assert.deepEqual(capabilities('security_admin'), PRE_P3_CAPABILITIES.security_admin)
      // The API in production compares this list with its own, exactly; an extra
      // action would lock every administrator out until the new API is deployed.
      for (const role of ['owner', 'operator', 'security_admin']) {
        assert.equal(sql(`BEGIN; SET LOCAL ROLE service_role;
          SELECT role || ':' || array_to_string(capabilities, ',') FROM public.admin_token_authorization_v2('${TOKENS[role]}'); COMMIT;`),
        `${role}:${PRE_P3_CAPABILITIES[role].join(',')}`)
        // v1, kept for builds from before v2, never listed decide_appeal.
        assert.equal(sql(`BEGIN; SET LOCAL ROLE service_role;
          SELECT role || ':' || array_to_string(capabilities, ',') FROM public.admin_token_authorization('${TOKENS[role]}'); COMMIT;`),
        `${role}:${PRE_P3_CAPABILITIES[role].filter(action => action !== 'decide_appeal').join(',')}`)
      }
      const accepts = (table, constraint) => sql(`SELECT string_agg(m[1], ',' ORDER BY m[1]) FROM pg_constraint AS c,
        regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') AS m
        WHERE c.conrelid = 'public.${table}'::regclass AND c.conname = '${constraint}'`).split(',')
      for (const action of ACTIONS) {
        assert.ok(accepts('admin_mutation_requests', 'admin_mutation_requests_action_check').includes(action), action)
        assert.ok(accepts('admin_role_action_capabilities', 'admin_role_action_capabilities_action_check').includes(action), action)
      }
      assert.equal(accepts('admin_mutation_requests', 'admin_mutation_requests_action_check').length, 17)
      assert.equal(accepts('admin_role_action_capabilities', 'admin_role_action_capabilities_action_check').length, 18)
      const kinds = accepts('admin_audit_log', 'admin_audit_log_event_kind_check')
      for (const kind of ['content_restored', 'post_official_changed', 'post_featured_changed', 'post_lock_changed', 'post_category_changed', 'support_email_claimed', 'content_takedown']) {
        assert.ok(kinds.includes(kind), kind)
      }
      assert.equal(kinds.length, 19)
      assert.deepEqual(db.grants([DISPATCHER, PREDECESSOR, GOVERNANCE, 'public.admin_list_community_posts(integer,integer,text)',
        'public.admin_list_report_queue(integer,integer)', 'public.community_post_state(uuid)', 'public.list_own_hidden_posts(uuid)']), [
        `${GOVERNANCE}:`,
        `${DISPATCHER}:service_role`,
        `${PREDECESSOR}:`,
        'public.admin_list_community_posts(integer,integer,text):service_role',
        'public.admin_list_report_queue(integer,integer):service_role',
        'public.community_post_state(uuid):anon,authenticated',
        'public.list_own_hidden_posts(uuid):authenticated',
      ])
      assert.equal(sql(`SELECT string_agg(prosecdef::text || ':' || proconfig::text, ' ') FROM pg_proc
        WHERE oid IN ('${GOVERNANCE}'::regprocedure, '${DISPATCHER}'::regprocedure)`), 'true:{search_path=pg_catalog} true:{search_path=pg_catalog}')
    })

    await t.test('restore_content returns a hidden topic to the list, once', () => {
      const payload = { target_type: 'post', target_id: HIDDEN, reason: '  Reviewed on appeal  ' }
      assert.equal(mutate('operator', 'restore_content', { target_type: 'post', target_id: TOPIC, reason: 'Not hidden' }), 'refused:content_not_found')
      assert.equal(mutate('operator', 'restore_content', { target_type: 'post', target_id: REMOVED, reason: 'Deleted by its author' }), 'refused:content_not_found')
      assert.equal(mutate('operator', 'restore_content', { target_type: 'item', target_id: HIDDEN, reason: 'Listings are not restored here' }), 'refused:admin_mutation_invalid_payload')
      assert.equal(written(), '0:0', 'a refused action leaves no request and no audit entry')
      assert.deepEqual(mutate('operator', 'restore_content', payload, key(1)), { data: { ok: true, affected: 1 } })
      assert.equal(post(HIDDEN, 'status'), 'active')
      assert.deepEqual(audit(), [entry('content_restored', HIDDEN, { target_type: 'post', reason: 'Reviewed on appeal', affected: 1 })])
      assert.equal(sql(`SELECT action || ':' || status || ':' || result::text || ':' || actor_id FROM public.admin_mutation_requests WHERE idempotency_key = '${key(1)}'`),
        `restore_content:completed:{"data": {"ok": true, "affected": 1}}:${ADMIN}`)
      // A retry with the same key is answered from the stored result and changes nothing.
      sql(`UPDATE public.posts SET status = 'hidden' WHERE id = '${HIDDEN}'`)
      assert.deepEqual(mutate('operator', 'restore_content', payload, key(1)), { data: { ok: true, affected: 1 } })
      assert.equal(post(HIDDEN, 'status'), 'hidden')
      assert.equal(written(), '1:1')
      assert.equal(mutate('operator', 'restore_content', payload, key(1), 'e'.repeat(64)), 'refused:idempotency_conflict')
      assert.equal(mutate('operator', 'set_post_locked', { post_id: TOPIC, locked: true, reason: 'Same key, other action' }, key(1)), 'refused:idempotency_conflict')
      assert.equal(written(), '1:1')
      sql('DELETE FROM public.admin_audit_log; DELETE FROM public.admin_mutation_requests')
    })

    await t.test('restore_content returns a hidden reply and counts it again', () => {
      const reply = as(`INSERT INTO public.post_comments(post_id, user_id, content) VALUES ('${TOPIC}', '${REPLIER}', 'A reply') RETURNING id`, 'authenticated', REPLIER)
      // What a takedown leaves behind: the reply hidden and already subtracted.
      sql(`UPDATE public.post_comments SET status = 'hidden' WHERE id = '${reply}';
        UPDATE public.posts SET comment_count = comment_count - 1 WHERE id = '${TOPIC}'`)
      const before = post(TOPIC, `comment_count || '|' || last_activity_at::text || '|' || answered_at::text`)
      assert.equal(before.split('|')[0], '0')
      assert.deepEqual(mutate('operator', 'restore_content', { target_type: 'comment', target_id: reply, reason: 'Restored after review' }), { data: { ok: true, affected: 1 } })
      assert.equal(sql(`SELECT status FROM public.post_comments WHERE id = '${reply}'`), 'active')
      assert.equal(post(TOPIC, `comment_count || '|' || last_activity_at::text || '|' || answered_at::text`), before.replace(/^0/, '1'))
      assert.deepEqual(audit(), [entry('content_restored', reply, { target_type: 'comment', reason: 'Restored after review', affected: 1 })])
      assert.equal(mutate('operator', 'restore_content', { target_type: 'comment', target_id: reply, reason: 'Already visible' }), 'refused:content_not_found')
      sql(`DELETE FROM public.admin_audit_log; DELETE FROM public.admin_mutation_requests; DELETE FROM public.post_comments;
        TRUNCATE public.notifications; UPDATE public.posts SET comment_count = 0`)
    })

    await t.test('set_post_locked closes a topic to new replies and reopens it', () => {
      const reply = `INSERT INTO public.post_comments(post_id, user_id, content) VALUES ('${TOPIC}', '${REPLIER}', 'A reply')`
      assert.equal(attempt(reply, { uid: REPLIER }), 'ok:1')
      assert.deepEqual(mutate('operator', 'set_post_locked', { post_id: TOPIC, locked: true, reason: 'Thread has run its course' }), { success: true })
      const lockedAt = post(TOPIC, 'locked_at::text')
      assert.notEqual(lockedAt, '')
      assert.equal(attempt(reply, { uid: REPLIER }), 'P0001:post_locked')
      assert.equal(attempt(reply.replace(REPLIER, AUTHOR), { uid: AUTHOR }), 'P0001:post_locked', 'the author too')
      assert.equal(attempt(reply, { role: 'service_role', uid: '' }), 'P0001:post_locked', 'and trusted writers')
      assert.equal(attempt(reply.replace("'A reply'", "'RATE'"), { uid: REPLIER }), 'P0001:post_locked', 'before the rate limiter is consulted')
      assert.equal(attempt(reply.replace(TOPIC, TOPIC_OTHER), { uid: REPLIER }), 'ok:1', 'other topics are open')
      assert.deepEqual(mutate('owner', 'set_post_locked', { post_id: TOPIC, locked: true, reason: 'Still closed' }), { success: true })
      assert.equal(post(TOPIC, 'locked_at::text'), lockedAt, 'closing a closed topic keeps the first time')
      assert.deepEqual(mutate('operator', 'set_post_locked', { post_id: TOPIC, locked: false, reason: 'Reopened on request' }), { success: true })
      assert.equal(post(TOPIC, 'locked_at IS NULL'), 't')
      assert.equal(attempt(reply, { uid: REPLIER }), 'ok:1')
      assert.deepEqual(audit(), [
        entry('post_lock_changed', null, { post_id: TOPIC, locked: true, reason: 'Thread has run its course' }),
        entry('post_lock_changed', null, { post_id: TOPIC, locked: true, reason: 'Still closed' }, 'owner'),
        entry('post_lock_changed', null, { post_id: TOPIC, locked: false, reason: 'Reopened on request' }),
      ])
      assert.equal(mutate('operator', 'set_post_locked', { post_id: HIDDEN, locked: true, reason: 'Not visible' }), 'refused:post_not_found')
      assert.equal(mutate('operator', 'set_post_locked', { post_id: TOPIC, locked: 'yes', reason: 'Not a boolean' }), 'refused:admin_mutation_invalid_payload')
      sql('DELETE FROM public.admin_audit_log; DELETE FROM public.admin_mutation_requests')
    })

    await t.test('set_post_category moves a topic to another board', () => {
      assert.deepEqual(mutate('operator', 'set_post_category', { post_id: TOPIC, category: 'campus-life', reason: 'Posted in the wrong board' }), { success: true })
      assert.equal(post(TOPIC, 'category'), 'campus-life')
      assert.deepEqual(audit(), [entry('post_category_changed', null,
        { post_id: TOPIC, from: 'settling-market', to: 'campus-life', reason: 'Posted in the wrong board' })])
      assert.equal(mutate('operator', 'set_post_category', { post_id: TOPIC, category: 'furniture', reason: 'Not a board' }), 'refused:admin_mutation_invalid_payload')
      assert.equal(mutate('operator', 'set_post_category', { post_id: UPDATE, category: 'campus-life', reason: 'An update has no board' }), 'refused:post_not_topic')
      assert.equal(mutate('operator', 'set_post_category', { post_id: HIDDEN, category: 'campus-life', reason: 'Not visible' }), 'refused:post_not_found')
      assert.equal(post(UPDATE, 'category IS NULL'), 't')
      assert.equal(written(), '1:1')
      sql(`DELETE FROM public.admin_audit_log; DELETE FROM public.admin_mutation_requests; UPDATE public.posts SET category = 'settling-market' WHERE id = '${TOPIC}'`)
    })

    await t.test('set_post_official is refused, with nothing written, until the official account is configured', () => {
      const request = { post_id: OFFICIAL_POST, official: true, reason: 'Posted by the site team' }
      // E6 not done: the API has no COMMUNITY_OFFICIAL_PROFILE_ID to pass.
      assert.equal(mutate('owner', 'set_post_official', request, key(2)), 'refused:official_profile_not_configured')
      assert.equal(mutate('owner', 'set_post_official', { ...request, official_profile_id: null }, key(2)), 'refused:official_profile_not_configured')
      assert.equal(written(), '0:0')
      assert.equal(post(OFFICIAL_POST, 'is_official'), 'f')
      // Configured: only that account's posts qualify, and only an owner decides.
      const configured = { ...request, official_profile_id: OFFICIAL }
      assert.equal(mutate('owner', 'set_post_official', { ...configured, post_id: TOPIC }), 'refused:post_not_official_account')
      assert.equal(mutate('operator', 'set_post_official', configured), 'refused:admin_capability_denied')
      assert.equal(mutate('owner', 'set_post_official', { ...configured, official_profile_id: 'not-a-uuid' }), 'refused:admin_mutation_invalid_payload')
      assert.equal(written(), '0:0')
      assert.deepEqual(mutate('owner', 'set_post_official', configured, key(2)), { success: true })
      assert.equal(post(OFFICIAL_POST, 'is_official'), 't')
      assert.deepEqual(audit(), [entry('post_official_changed', null, { post_id: OFFICIAL_POST, official: true, reason: 'Posted by the site team' }, 'owner')])
      sql('DELETE FROM public.admin_audit_log; DELETE FROM public.admin_mutation_requests')
    })

    await t.test('set_post_featured accepts official posts only', () => {
      assert.equal(mutate('owner', 'set_post_featured', { post_id: TOPIC, featured: true, reason: 'A member topic' }), 'refused:post_not_official')
      assert.equal(mutate('operator', 'set_post_featured', { post_id: OFFICIAL_POST, featured: true, reason: 'Not an owner' }), 'refused:admin_capability_denied')
      assert.equal(written(), '0:0')
      assert.equal(post(TOPIC, 'is_featured'), 'f')
      assert.deepEqual(mutate('owner', 'set_post_featured', { post_id: OFFICIAL_POST, featured: true, reason: 'Start here' }), { success: true })
      assert.equal(post(OFFICIAL_POST, 'is_featured'), 't')
      // An official post that is featured cannot quietly stop being official.
      assert.equal(mutate('owner', 'set_post_official', { post_id: OFFICIAL_POST, official: false, reason: 'No longer official', official_profile_id: OFFICIAL }),
        'refused:admin_mutation_conflict')
      assert.deepEqual(mutate('owner', 'set_post_featured', { post_id: OFFICIAL_POST, featured: false, reason: 'Out of date' }), { success: true })
      assert.deepEqual(mutate('owner', 'set_post_official', { post_id: OFFICIAL_POST, official: false, reason: 'No longer official', official_profile_id: OFFICIAL }), { success: true })
      assert.equal(post(OFFICIAL_POST, `is_official::text || ':' || is_featured::text`), 'false:false')
      assert.deepEqual(audit().map(row => [row.kind, row.details.featured ?? row.details.official]), [
        ['post_featured_changed', true], ['post_featured_changed', false], ['post_official_changed', false],
      ])
      sql('DELETE FROM public.admin_audit_log; DELETE FROM public.admin_mutation_requests')
    })

    await t.test('the caller must be an active administrator, with the capability and a well-formed request', () => {
      const lock = { post_id: TOPIC, locked: true, reason: 'A reason' }
      const call = (token, action, payload, hash = 'f'.repeat(64), idempotency = `'${key(9)}'`) => {
        try {
          return sql(`BEGIN; SET LOCAL ROLE service_role; SELECT public.admin_execute_mutation(${token}, ${idempotency}, ${hash === null ? 'NULL' : `'${hash}'`},
            '${action}', ${payload}); COMMIT;`)
        } catch (error) { return /ERROR:\s+(.*)/.exec(String(error.stderr))[1].trim() }
      }
      const json = value => `$json$${JSON.stringify(value)}$json$::jsonb`
      assert.equal(call(`'${'9'.repeat(64)}'`, 'set_post_locked', json(lock)), 'admin_token_inactive')
      assert.equal(call('NULL', 'set_post_locked', json(lock)), 'admin_token_inactive')
      assert.equal(call(`'${TOKENS.operator}'`, 'set_post_locked', json(lock), 'not-a-hash'), 'admin_mutation_invalid')
      assert.equal(call(`'${TOKENS.operator}'`, 'set_post_locked', json(lock), 'f'.repeat(64), 'NULL'), 'admin_mutation_invalid')
      assert.equal(call(`'${TOKENS.operator}'`, 'set_post_locked', `'[]'::jsonb`), 'admin_mutation_invalid')
      for (const action of ACTIONS) {
        assert.equal(mutate('security_admin', action, lock), 'refused:admin_capability_denied', action)
      }
      sql(`UPDATE public.admin_tokens SET revoked_at = now() WHERE token_hash = '${TOKENS.security_admin}'`)
      assert.equal(mutate('security_admin', 'set_post_locked', lock), 'refused:admin_token_inactive')
      sql(`UPDATE public.admin_tokens SET revoked_at = NULL, expires_at = now() - interval '1 second' WHERE token_hash = '${TOKENS.security_admin}'`)
      assert.equal(mutate('security_admin', 'set_post_locked', lock), 'refused:admin_token_inactive')
      for (const [action, payload] of [
        ['set_post_locked', { ...lock, extra: 1 }],
        ['set_post_locked', { post_id: TOPIC, locked: true }],
        ['set_post_locked', { ...lock, reason: '   ' }],
        ['set_post_locked', { ...lock, reason: 'line\u0001break' }],
        ['set_post_locked', { ...lock, reason: 'x'.repeat(1001) }],
        ['set_post_locked', { ...lock, post_id: 'not-a-uuid' }],
        ['set_post_locked', { ...lock, post_id: 7 }],
        ['set_post_category', { post_id: TOPIC, category: 7, reason: 'A reason' }],
        ['set_post_featured', { post_id: TOPIC, featured: 'true', reason: 'A reason' }],
        ['set_post_official', { post_id: TOPIC, official: 1, reason: 'A reason', official_profile_id: OFFICIAL }],
        ['restore_content', { target_type: 'post', target_id: 'not-a-uuid', reason: 'A reason' }],
        ['restore_content', { target_type: 'message', target_id: TOPIC, reason: 'A reason' }],
      ]) {
        assert.equal(mutate('owner', action, payload), 'refused:admin_mutation_invalid_payload', `${action} ${JSON.stringify(payload).slice(0, 60)}`)
      }
      assert.equal(written(), '0:0')
      assert.equal(post(TOPIC, 'locked_at IS NULL'), 't')
      // Identifiers are accepted in either case, as the other actions accept them.
      assert.deepEqual(mutate('owner', 'set_post_locked', { ...lock, post_id: TOPIC.toUpperCase() }), { success: true })
      sql(`DELETE FROM public.admin_audit_log; DELETE FROM public.admin_mutation_requests; UPDATE public.posts SET locked_at = NULL`)
    })

    await t.test('every earlier action still reaches the previous dispatcher', () => {
      assert.deepEqual(mutate('owner', 'set_post_pinned', { post_id: TOPIC, pinned: true }),
        { delegated: 'set_post_pinned', payload: { post_id: TOPIC, pinned: true } })
      assert.deepEqual(mutate('owner', 'takedown_content', { target_type: 'post', target_id: TOPIC, reason: '  Spam  ' }),
        { delegated: 'takedown_content', payload: { target_type: 'post', target_id: TOPIC, reason: 'Spam' } }, 'the stored wrapper still normalises the reason')
      assert.deepEqual(mutate('operator', 'decide_appeal', { suspension_id: TOPIC, decision: 'denied', reason: 'Reviewed' }),
        { delegated: 'decide_appeal', payload: { suspension_id: TOPIC, decision: 'denied', reason: 'Reviewed' } })
      assert.equal(mutate('owner', 'takedown_content', { target_type: 'post', target_id: TOPIC }), 'refused:admin_mutation_invalid_payload')
      assert.equal(written(), '0:0', 'the decoys write nothing; the real predecessor does its own bookkeeping')
    })

    await t.test('the moderation audit list shows restores, locks and board moves, and still omits owner decisions', () => {
      mutate('operator', 'set_post_locked', { post_id: TOPIC, locked: true, reason: 'Closed' })
      mutate('operator', 'set_post_category', { post_id: TOPIC, category: 'local-deals', reason: 'Moved' })
      mutate('operator', 'restore_content', { target_type: 'post', target_id: HIDDEN, reason: 'Restored' })
      mutate('owner', 'set_post_official', { post_id: OFFICIAL_POST, official: true, reason: 'Official', official_profile_id: OFFICIAL })
      mutate('owner', 'set_post_featured', { post_id: OFFICIAL_POST, featured: true, reason: 'Featured' })
      const listed = filter => JSON.parse(sql(`BEGIN; SET LOCAL ROLE service_role;
        SELECT coalesce(json_agg(json_build_object('kind', event_kind, 'actor', actor_nickname, 'details', details) ORDER BY id), '[]')
        FROM public.admin_list_moderation_audit_log(100, 0, ${filter}); COMMIT;`))
      assert.deepEqual(listed('NULL'), [
        { kind: 'post_lock_changed', actor: 'Admin', details: { post_id: TOPIC, locked: true, reason: 'Closed' } },
        { kind: 'post_category_changed', actor: 'Admin', details: { post_id: TOPIC, from: 'settling-market', to: 'local-deals', reason: 'Moved' } },
        { kind: 'content_restored', actor: 'Admin', details: { target_type: 'post', reason: 'Restored', affected: 1 } },
      ])
      assert.deepEqual(listed(`'content_restored'`).map(row => row.kind), ['content_restored'])
      assert.deepEqual(listed(`'post_featured_changed'`), [])
      sql(`DELETE FROM public.admin_audit_log; DELETE FROM public.admin_mutation_requests;
        UPDATE public.posts SET locked_at = NULL, category = 'settling-market' WHERE id = '${TOPIC}';
        UPDATE public.posts SET is_featured = false, is_official = false WHERE id = '${OFFICIAL_POST}';
        UPDATE public.posts SET status = 'hidden' WHERE id = '${HIDDEN}'`)
    })

    await t.test('the administrator topic list carries what the five buttons need', () => {
      sql(`UPDATE public.posts SET is_official = true, is_featured = true, is_pinned = true, locked_at = now() WHERE id = '${OFFICIAL_POST}'`)
      const list = status => JSON.parse(sql(`BEGIN; SET LOCAL ROLE service_role;
        SELECT coalesce(json_agg(to_jsonb(t) ORDER BY t.n), '[]') FROM (SELECT *, row_number() OVER () AS n FROM public.admin_list_community_posts(50, 0, ${status})) AS t; COMMIT;`))
      const active = list(`'active'`)
      assert.deepEqual(Object.keys(active[0]).sort(), ['author_id', 'author_nickname', 'category', 'comment_count', 'content', 'created_at', 'id',
        'is_featured', 'is_official', 'is_pinned', 'last_activity_at', 'like_count', 'locked_at', 'n', 'status', 'thumbnail', 'title'])
      assert.equal(active[0].id, OFFICIAL_POST, 'pinned first')
      assert.deepEqual([active[0].is_official, active[0].is_featured, active[0].is_pinned, active[0].locked_at !== null, active[0].author_nickname, active[0].title],
        [true, true, true, true, 'Site team', 'Community guidelines'])
      assert.ok(active.every(row => row.status === 'active') && !active.some(row => [HIDDEN, REMOVED].includes(row.id)))
      assert.ok(active.some(row => row.id === UPDATE && row.title === null), 'legacy updates are listed too')
      assert.deepEqual(list(`'hidden'`).map(row => [row.id, row.status]), [[HIDDEN, 'hidden']])
      assert.deepEqual(list('NULL').map(row => row.id), active.map(row => row.id), 'active is the default')
      assert.equal(list(`'deleted'`).length, active.length, 'any other value is the default too')
      for (const role of ['anon', 'authenticated']) {
        assert.equal(attempt(`SELECT count(*) FROM public.admin_list_community_posts(50, 0, 'active')`, { role, uid: role === 'anon' ? '' : AUTHOR, ask: true }).slice(0, 6), '42501:')
        assert.equal(attempt(`SELECT count(*) FROM public.admin_list_report_queue(50, 0)`, { role, uid: role === 'anon' ? '' : AUTHOR, ask: true }).slice(0, 6), '42501:')
      }
      sql(`UPDATE public.posts SET is_official = false, is_featured = false, is_pinned = false, locked_at = NULL WHERE id = '${OFFICIAL_POST}'`)
    })

    await t.test('the report queue is ordered by its oldest report still waiting', () => {
      const report = (target, hours, status = 'pending', reporter = AUTHOR) => `('${reporter}', 'post', '${target}', 'spam', 'note', '${status}', now() - interval '${hours} hours')`
      sql(`INSERT INTO public.reports(reporter_id, target_type, target_id, reason, note, status, created_at) VALUES
        ${report(TOPIC, 100, 'resolved')}, ${report(TOPIC, 30)}, ${report(TOPIC, 10, 'pending', REPLIER)},
        ${report(TOPIC_OTHER, 50)}, ${report(HIDDEN, 200, 'dismissed')}, ${report(UPDATE, 2)}`)
      const queue = JSON.parse(sql(`BEGIN; SET LOCAL ROLE service_role;
        SELECT coalesce(json_agg(to_jsonb(t) ORDER BY t.n), '[]') FROM (SELECT *, row_number() OVER () AS n FROM public.admin_list_report_queue(50, 0)) AS t; COMMIT;`))
      assert.deepEqual(queue.map(row => row.target_id), [TOPIC_OTHER, TOPIC, UPDATE], 'longest wait first; a target with nothing pending is not in the queue')
      assert.deepEqual(Object.keys(queue[0]).sort(), ['first_created_at', 'last_created_at', 'last_note', 'last_reason', 'last_report_id',
        'last_reporter_nickname', 'last_status', 'n', 'oldest_pending_at', 'pending_count', 'report_count', 'reporter_count', 'target_id', 'target_type'])
      const topic = queue[1]
      assert.deepEqual([topic.report_count, topic.pending_count, topic.reporter_count, topic.last_status, topic.last_reporter_nickname], [3, 2, 2, 'pending', 'Replier'])
      assert.equal(sql(`SELECT ('${topic.oldest_pending_at}'::timestamptz = (SELECT created_at FROM public.reports WHERE target_id = '${TOPIC}' AND status = 'pending' ORDER BY created_at LIMIT 1))::text
        || ':' || ('${topic.first_created_at}'::timestamptz < '${topic.oldest_pending_at}'::timestamptz)::text`), 'true:true', 'an older resolved report does not count as waiting')
      assert.equal(JSON.parse(sql(`BEGIN; SET LOCAL ROLE service_role; SELECT json_agg(target_id) FROM public.admin_list_report_queue(1, 1); COMMIT;`))[0], TOPIC)
      sql('DELETE FROM public.reports')
    })

    await t.test('anyone can tell a hidden topic from one that is gone, and nothing more', () => {
      const state = (postId, options = {}) => attempt(`SELECT public.community_post_state('${postId}')`, { ask: true, ...options })
      for (const options of [{ role: 'anon', uid: '' }, { uid: REPLIER }]) {
        assert.equal(state(TOPIC, options), 'value:active')
        assert.equal(state(HIDDEN, options), 'value:hidden')
        assert.equal(state(REMOVED, options), 'value:missing')
        assert.equal(state(id(99), options), 'value:missing')
        assert.equal(state(INVISIBLE_AUTHOR, options), 'value:hidden', 'a topic whose author is hidden from others')
      }
      assert.equal(state(INVISIBLE_AUTHOR, { uid: id(7) }), 'value:active', 'its own author still sees it')
      assert.equal(attempt(`SELECT public.community_post_state(NULL)`, { ask: true }), 'value:missing')
      assert.match(sql(`SELECT provolatile::text || ':' || prosecdef::text || ':' || array_to_string(proconfig, ';') FROM pg_proc
        WHERE oid = 'public.community_post_state(uuid)'::regprocedure`), /^s:true:search_path=pg_catalog;statement_timeout=3s$/)
    })

    await t.test('an author reads their own hidden topics with the reason, and nobody else does', () => {
      sql(`INSERT INTO public.admin_audit_log(event_kind, actor_id, target_id, details, created_at) VALUES
        ('content_takedown', '${ADMIN}', '${HIDDEN}', '{"target_type":"post","reason":"First reason","affected":1}', now() - interval '2 days'),
        ('content_takedown', '${ADMIN}', '${HIDDEN}', '{"target_type":"post","reason":"Personal information in the photo","affected":1}', now() - interval '1 day'),
        ('content_takedown', '${ADMIN}', '${HIDDEN}', '{"target_type":"comment","reason":"About something else","affected":1}', now())`)
      const own = (uid, argument = '') => JSON.parse(as(`SELECT coalesce(json_agg(to_jsonb(t)), '[]') FROM public.list_own_hidden_posts(${argument}) AS t`, 'authenticated', uid))
      const rows = own(OTHER)
      assert.deepEqual(rows.map(row => [row.id, row.title, row.category, row.content, row.hidden_reason]),
        [[HIDDEN, 'Hidden topic', 'campus-life', 'Hidden body', 'Personal information in the photo']])
      assert.deepEqual(Object.keys(rows[0]).sort(), ['category', 'content', 'created_at', 'hidden_reason', 'id', 'title'])
      assert.deepEqual(own(OTHER, `'${HIDDEN}'`).map(row => row.id), [HIDDEN])
      assert.deepEqual(own(OTHER, `'${TOPIC_OTHER}'`), [], 'a visible topic is not listed')
      assert.deepEqual(own(AUTHOR), [])
      assert.deepEqual(own(AUTHOR, `'${HIDDEN}'`), [], 'somebody else cannot read it by id')
      assert.equal(attempt(`SELECT count(*) FROM public.list_own_hidden_posts()`, { role: 'anon', uid: '', ask: true }).slice(0, 6), '42501:')
      assert.equal(attempt(`SELECT count(*) FROM public.list_own_hidden_posts()`, { uid: '', ask: true }), 'value:0', 'no user claim, no rows')
      // The row policy is unchanged: the author still cannot read, edit or delete the hidden row itself.
      assert.equal(attempt(`SELECT count(*) FROM public.posts WHERE id = '${HIDDEN}'`, { uid: OTHER, ask: true }), 'value:0')
      assert.equal(attempt(`DELETE FROM public.posts WHERE id = '${HIDDEN}'`, { uid: OTHER }), 'ok:0')
      sql('DELETE FROM public.admin_audit_log')
    })
  } finally {
    db.stop()
  }
})
