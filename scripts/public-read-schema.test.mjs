import assert from 'node:assert/strict'
import test from 'node:test'
import { verifyPublicReadSchema } from './verify-public-read-schema.mjs'
const url = 'https://abcdefghijklmnopqrst.supabase.co'
const key = 'sb_publishable_synthetic'
// What a migrated target answers: no rows for a limit=0 read, and "missing" for a topic that does not exist.
const migrated = target => new Response(target.pathname.endsWith('/rpc/community_member_events_open') ? 'false'
  : target.pathname.endsWith('/rpc/community_post_state') ? '"missing"' : '[]', { status: 200 })
test('public schema preflight checks listing, post and comment projections without write access', async () => {
  const seen = []
  const results = await verifyPublicReadSchema({ url, key, fetchImpl: async (target, init) => {
    seen.push({ target, init }); return migrated(target)
  } })
  // Six projections, search, events, the member switch, and topic state.
  assert.equal(results.length, 10)
  const reads = seen.filter(({ target }) => !target.pathname.includes('/rpc/'))
  assert.equal(reads.length, 6)
  for (const { target, init } of reads) {
    assert.equal(target.searchParams.get('limit'), '0')
    assert.equal(init.method, undefined)
    assert.equal(init.headers.Authorization, undefined)
    assert.equal(init.redirect, 'error')
    assert.ok(init.signal instanceof AbortSignal)
  }
  assert.equal(seen[1].target.searchParams.get('select'), 'id,item:items(id,listing_details)')
  assert.match(seen[0].target.searchParams.get('select'), /location_checked_at/)
  assert.equal(seen[2].target.searchParams.get('select'), 'id,content_i18n')
  assert.equal(seen[3].target.searchParams.get('select'), 'id,title,category,region')
  assert.equal(seen[4].target.searchParams.get('select'), 'id,last_activity_at,answered_at,is_featured,locked_at')
  assert.equal(seen[5].target.pathname, '/rest/v1/community_events')
  assert.equal(seen[5].target.searchParams.get('select'), 'id,source_type,starts_at,availability')
  const [rpc] = seen.filter(({ target }) => target.pathname === '/rest/v1/rpc/search_community_posts')
  assert.equal(rpc.init.method, 'POST')
  assert.deepEqual(JSON.parse(rpc.init.body), { terms_in: ['x'], limit_in: 1 })
  assert.equal(rpc.init.headers.Authorization, undefined)
  assert.equal(rpc.init.redirect, 'error')
  // P4: the events page reads its list through one function.
  const [events] = seen.filter(({ target }) => target.pathname === '/rest/v1/rpc/list_community_events')
  assert.equal(events.init.method, 'POST')
  assert.deepEqual(JSON.parse(events.init.body), { limit_in: 1 })
  assert.equal(events.init.headers.Authorization, undefined)
  assert.equal(events.init.redirect, 'error')
  const [memberEvents] = seen.filter(({ target }) => target.pathname === '/rest/v1/rpc/community_member_events_open')
  assert.equal(memberEvents.init.method, 'POST')
  assert.deepEqual(JSON.parse(memberEvents.init.body), {})
  assert.equal(memberEvents.init.headers.Authorization, undefined)
  assert.equal(memberEvents.init.redirect, 'error')
  assert.ok(memberEvents.init.signal instanceof AbortSignal)
  // P3.6: the topic page asks this function why a topic cannot be read. Asking about a topic that
  // does not exist reads nothing and writes nothing.
  const [state] = seen.filter(({ target }) => target.pathname === '/rest/v1/rpc/community_post_state')
  assert.equal(state.init.method, 'POST')
  assert.deepEqual(JSON.parse(state.init.body), { post_id_in: '00000000-0000-0000-0000-000000000000' })
  assert.equal(state.init.headers.Authorization, undefined)
  assert.equal(state.init.redirect, 'error')
  assert.ok(state.init.signal instanceof AbortSignal)
  assert.deepEqual(results.at(-1), { name: 'community topic state rpc', status: 200 })
})
test('the member events switch probe requires HTTP 200 and a boolean', async () => {
  for (const body of ['true', 'false']) {
    const results = await verifyPublicReadSchema({ url, key, fetchImpl: async target =>
      target.pathname.endsWith('/rpc/community_member_events_open') ? new Response(body) : migrated(target) })
    assert.deepEqual(results.find(result => result.name === 'community member events switch rpc'),
      { name: 'community member events switch rpc', status: 200 })
  }
  for (const body of ['null', '[]', '{}', '"false"', '0']) {
    await assert.rejects(verifyPublicReadSchema({ url, key, fetchImpl: async target =>
      target.pathname.endsWith('/rpc/community_member_events_open') ? new Response(body) : migrated(target) }),
    /public_schema_unexpected_response/)
  }
  for (const status of [202, 400, 404, 500]) {
    await assert.rejects(verifyPublicReadSchema({ url, key, fetchImpl: async target =>
      target.pathname.endsWith('/rpc/community_member_events_open') ? new Response('false', { status }) : migrated(target) }),
    new RegExp(`community member events switch rpc returned HTTP ${status}`))
  }
})
test('missing fields, authentication failure and provider outage cannot pass preflight', async () => {
  for (const status of [400,401,403,500]) {
    await assert.rejects(verifyPublicReadSchema({ url,key,fetchImpl:async()=>new Response('{}',{status}) }), /public_schema_mismatch/)
  }
  await assert.rejects(verifyPublicReadSchema({ url,key,fetchImpl:async()=>new Response('[{"id":"unexpected"}]') }), /unexpected_response/)
})
test('a candidate without the community topic migration fails before any browser starts', async () => {
  const missingColumns = async target => target.searchParams.get('select')?.includes('region')
    ? new Response('{}', { status: 400 })
    : migrated(target)
  await assert.rejects(verifyPublicReadSchema({ url, key, fetchImpl: missingColumns }), /public_schema_mismatch: community topic columns returned HTTP 400/)
  // P3: the client reads the activity columns on every list, so a target without them fails here too.
  const missingActivity = async target => target.searchParams.get('select')?.includes('last_activity_at')
    ? new Response('{}', { status: 400 })
    : migrated(target)
  await assert.rejects(verifyPublicReadSchema({ url, key, fetchImpl: missingActivity }), /public_schema_mismatch: community topic activity columns returned HTTP 400/)
  const missingRpc = async target => target.pathname.includes('/rpc/') ? new Response('{}', { status: 404 }) : new Response('[]', { status: 200 })
  await assert.rejects(verifyPublicReadSchema({ url, key, fetchImpl: missingRpc }), /public_schema_mismatch: community search rpc returned HTTP 404/)
  // P4: a target without the events migration has neither the table nor its list function.
  const missingEvents = async target => target.pathname.endsWith('/community_events') ? new Response('{}', { status: 404 }) : migrated(target)
  await assert.rejects(verifyPublicReadSchema({ url, key, fetchImpl: missingEvents }), /public_schema_mismatch: community events returned HTTP 404/)
  const missingList = async target => target.pathname.endsWith('/rpc/list_community_events') ? new Response('{}', { status: 404 }) : migrated(target)
  await assert.rejects(verifyPublicReadSchema({ url, key, fetchImpl: missingList }), /public_schema_mismatch: community events rpc returned HTTP 404/)
  // P3: a target that has the columns and not the function the topic page calls. The function ships in
  // the same migration as the watch and save tables, which the publishable key cannot read, so this one
  // answer also stands for them.
  const missingState = async target => target.pathname.endsWith('/rpc/community_post_state') ? new Response('{}', { status: 404 }) : migrated(target)
  await assert.rejects(verifyPublicReadSchema({ url, key, fetchImpl: missingState }), /public_schema_mismatch: community topic state rpc returned HTTP 404/)
  const oddState = async target => target.pathname.endsWith('/rpc/community_post_state') ? new Response('"active"', { status: 200 }) : migrated(target)
  await assert.rejects(verifyPublicReadSchema({ url, key, fetchImpl: oddState }), /public_schema_unexpected_response/)
})
test('service-role and opaque secrets are refused before any request', async () => {
  const secretJwt = 'e30.'+Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')+'.signature'
  for(const secret of [secretJwt,'sb_secret_no_client_access','']) {
    await assert.rejects(verifyPublicReadSchema({url,key:secret,fetchImpl:()=>assert.fail('must not send secret')}), /requires_publishable_or_anon_key/)
  }
})
