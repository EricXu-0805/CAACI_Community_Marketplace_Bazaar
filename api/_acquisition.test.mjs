import test from 'node:test'
import assert from 'node:assert/strict'
import handler, { smallBody } from './acquisition.js'
const id='11111111-1111-4111-8111-111111111111'
const env={ACQUISITION_ENABLED:'true',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',SUPABASE_SECRET_KEY:'sb_secret_fixture'}
const request=(data={},headers={})=>new Request('https://www.illinimarket.com/api/acquisition',{method:'POST',headers:{origin:'https://www.illinimarket.com','content-type':'application/json',...headers},body:JSON.stringify({source:'reddit',event:'visit',visit_id:id,...data})})
test('only bounded same-origin campaign events reach service-only writes; signup identity comes from verified Auth',async()=>{
 const oldFetch=globalThis.fetch,oldEnv={...process.env};Object.assign(process.env,env)
 const calls=[]
 globalThis.fetch=async(url,init)=>{calls.push({url,init});return url.endsWith('/record_acquisition')?new Response(null,{status:204}):Response.json(url.endsWith('/edge_rate_hit')?true:{id:'22222222-2222-4222-8222-222222222222'})}
 try{
  process.env.ACQUISITION_ENABLED='false'
  assert.equal((await handler(request())).status,204)
  assert.equal(calls.length,0,'disabled collection never touches upstream')
  process.env.ACQUISITION_ENABLED='true'
  Object.assign(process.env,{VERCEL:'1',VERCEL_ENV:'preview',DEPLOYMENT_EXPECTED_VERCEL_ENV:'preview',VERCEL_URL:'campaign-preview.vercel.app',SUPABASE_EXPECTED_PROJECT_REF:'abcdefghijklmnopqrst',SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co'})
  assert.equal((await handler(request())).status,204)
  assert.equal(calls.length,0,'preview collection never touches upstream')
  for(const k of ['VERCEL','VERCEL_ENV','DEPLOYMENT_EXPECTED_VERCEL_ENV','VERCEL_URL','SUPABASE_EXPECTED_PROJECT_REF'])delete process.env[k]
  Object.assign(process.env,env)
  assert.equal((await handler(request({}, {origin:'https://evil.example'}))).status,403)
  assert.equal((await handler(request({source:'my-private-email@example.org'}))).status,400)
  assert.equal((await handler(request({user_id:id}))).status,400)
  assert.equal((await handler(request({}, {'sec-gpc':'1'}))).status,204)
  assert.equal(calls.length,0)
  assert.equal((await handler(request())).status,204)
  assert.equal(calls.length,2);assert.match(JSON.parse(calls[0].init.body).bucket_in,/^growth:[a-f0-9]{64}$/)
  assert.deepEqual(JSON.parse(calls[1].init.body),{visit_in:id,source_in:'reddit',user_in:null})
  assert.equal(calls[0].init.redirect,'manual')
  assert.equal(calls[0].init.headers.apikey,'sb_secret_fixture')
  assert.equal(calls[0].init.headers.Authorization,undefined)
  calls.length=0
  assert.equal((await handler(request({event:'signup'},{authorization:'Bearer caller-token'}))).status,204)
  assert.equal(calls[1].init.headers.Authorization,'Bearer caller-token')
  assert.equal(JSON.parse(calls[2].init.body).user_in,'22222222-2222-4222-8222-222222222222')
  globalThis.fetch=async()=>Response.json(false)
  assert.equal((await handler(request())).status,429)
  globalThis.fetch=async()=>Response.redirect('https://untrusted.example',302)
  assert.equal((await handler(request())).status,503,'upstream redirects do not forward privileged headers')
  globalThis.fetch=async()=>{throw Error('network')}
  assert.equal((await handler(request())).status,503)
 }finally{globalThis.fetch=oldFetch;for(const k of Object.keys(process.env))if(!(k in oldEnv))delete process.env[k];Object.assign(process.env,oldEnv)}
})
test('chunked, oversized and malformed bodies are bounded',async()=>{
 await assert.rejects(()=>smallBody(new Request('https://example.test',{method:'POST',body:'x'.repeat(513)})),/body_limit/)
 await assert.rejects(()=>smallBody(new Request('https://example.test',{method:'POST',body:'{' })),SyntaxError)
})
