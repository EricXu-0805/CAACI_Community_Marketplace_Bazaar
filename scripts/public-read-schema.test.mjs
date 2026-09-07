import assert from 'node:assert/strict'
import test from 'node:test'
import { verifyPublicReadSchema } from './verify-public-read-schema.mjs'
const url = 'https://abcdefghijklmnopqrst.supabase.co'
const key = 'sb_publishable_synthetic'
test('public schema preflight checks both zero-row projections without write access', async () => {
  const seen = []
  const results = await verifyPublicReadSchema({ url, key, fetchImpl: async (target, init) => {
    seen.push({ target, init }); return new Response('[]', { status: 200 })
  } })
  assert.equal(results.length, 2)
  for (const { target, init } of seen) {
    assert.equal(target.searchParams.get('limit'), '0')
    assert.equal(init.method, undefined)
    assert.equal(init.headers.Authorization, undefined)
    assert.equal(init.redirect, 'error')
    assert.ok(init.signal instanceof AbortSignal)
  }
  assert.equal(seen[1].target.searchParams.get('select'), 'id,item:items(id,listing_details)')
})
test('missing fields, authentication failure and provider outage cannot pass preflight', async () => {
  for (const status of [400,401,403,500]) {
    await assert.rejects(verifyPublicReadSchema({ url,key,fetchImpl:async()=>new Response('{}',{status}) }), /public_schema_mismatch/)
  }
  await assert.rejects(verifyPublicReadSchema({ url,key,fetchImpl:async()=>new Response('[{"id":"unexpected"}]') }), /unexpected_response/)
})
test('service-role and opaque secrets are refused before any request', async () => {
  const secretJwt = 'e30.'+Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')+'.signature'
  for(const secret of [secretJwt,'sb_secret_no_client_access','']) {
    await assert.rejects(verifyPublicReadSchema({url,key:secret,fetchImpl:()=>assert.fail('must not send secret')}), /requires_publishable_or_anon_key/)
  }
})
