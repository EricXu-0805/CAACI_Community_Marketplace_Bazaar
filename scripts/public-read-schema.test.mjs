import assert from 'node:assert/strict'
import test from 'node:test'
import { verifyPublicReadSchema } from './verify-public-read-schema.mjs'
const url = 'https://abcdefghijklmnopqrst.supabase.co'
const key = 'sb_publishable_synthetic'
test('public schema preflight checks listing, post and comment projections without write access', async () => {
  const seen = []
  const results = await verifyPublicReadSchema({ url, key, fetchImpl: async (target, init) => {
    seen.push({ target, init }); return new Response('[]', { status: 200 })
  } })
  assert.equal(results.length, 6)
  const reads = seen.filter(({ target }) => !target.pathname.includes('/rpc/'))
  assert.equal(reads.length, 5)
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
  const [rpc] = seen.filter(({ target }) => target.pathname === '/rest/v1/rpc/search_community_posts')
  assert.equal(rpc.init.method, 'POST')
  assert.deepEqual(JSON.parse(rpc.init.body), { terms_in: ['x'], limit_in: 1 })
  assert.equal(rpc.init.headers.Authorization, undefined)
  assert.equal(rpc.init.redirect, 'error')
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
    : new Response('[]', { status: 200 })
  await assert.rejects(verifyPublicReadSchema({ url, key, fetchImpl: missingColumns }), /public_schema_mismatch: community topic columns returned HTTP 400/)
  // P3: the client reads the activity columns on every list, so a target without them fails here too.
  const missingActivity = async target => target.searchParams.get('select')?.includes('last_activity_at')
    ? new Response('{}', { status: 400 })
    : new Response('[]', { status: 200 })
  await assert.rejects(verifyPublicReadSchema({ url, key, fetchImpl: missingActivity }), /public_schema_mismatch: community topic activity columns returned HTTP 400/)
  const missingRpc = async target => target.pathname.includes('/rpc/') ? new Response('{}', { status: 404 }) : new Response('[]', { status: 200 })
  await assert.rejects(verifyPublicReadSchema({ url, key, fetchImpl: missingRpc }), /public_schema_mismatch: community search rpc returned HTTP 404/)
})
test('service-role and opaque secrets are refused before any request', async () => {
  const secretJwt = 'e30.'+Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')+'.signature'
  for(const secret of [secretJwt,'sb_secret_no_client_access','']) {
    await assert.rejects(verifyPublicReadSchema({url,key:secret,fetchImpl:()=>assert.fail('must not send secret')}), /requires_publishable_or_anon_key/)
  }
})
