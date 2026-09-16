import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { inlineSharedApiImports } from './_test-module-loader.mjs'

const UID = '11111111-1111-4111-8111-111111111111'
const SID = '22222222-2222-4222-8222-222222222222'
const OTHER = '33333333-3333-4333-8333-333333333333'
const EMAIL = 'existing@example.test'
const OPENID = 'verified_openid_A'
const UNIONID = 'verified_unionid_A'
const CODE = 'ABCDEFGHJK'
const CONFIRMATION = 'a'.repeat(64)
const ENV = { WECHAT_LOGIN_ENABLED:'true',WECHAT_ACCOUNT_LINK_ENABLED:'true',WECHAT_APPID:'wx-test-appid',
  WECHAT_APPSECRET:'test-secret',SUPABASE_URL:'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY:'service-test-key',SUPABASE_ANON_KEY:'anon-test-key',
  SUPABASE_SECRET_KEY:'',SUPABASE_PUBLISHABLE_KEY:'' }
let seq = 0
const json = (value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}})
const expiry = ()=>new Date(Date.now()+299_000).toISOString()
const bearer = (sub=UID,session_id=SID)=>`Bearer eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({sub,session_id})).toString('base64url')}.signature_12345678901234567890`
const request = (body,auth='')=>new Request('https://app.test/api/auth/wechat-login',{method:'POST',
  headers:{'Content-Type':'application/json',...(auth?{Authorization:auth}:{})},body:JSON.stringify(body)})
async function load(overrides={}) {
  Object.assign(process.env,ENV,overrides)
  const source=inlineSharedApiImports(await readFile(new URL('./auth/wechat-login.js',import.meta.url),'utf8'))
  return (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#link${seq++}`)).default
}
function mock(options={}) {
  const calls=[]
  globalThis.fetch=async(input,init={})=>{
    const url=new URL(input),body=init.body?JSON.parse(init.body):null
    calls.push({url,body,init})
    if(options.override){const response=await options.override(url,body,init);if(response)return response}
    if(url.pathname==='/rest/v1/rpc/edge_rate_hit')return json(true)
    if(url.hostname==='api.weixin.qq.com')return json({openid:OPENID,unionid:UNIONID})
    if(url.pathname==='/auth/v1/user')return json({id:UID,email:EMAIL})
    if(url.pathname==='/rest/v1/rpc/wechat_link_issue')return json({expires_at:expiry()})
    if(url.pathname==='/rest/v1/rpc/wechat_link_preview')return json({nickname:'Existing member',email_label:'e***@example.test',expires_at:expiry(),internal:'not-for-client'})
    if(url.pathname==='/rest/v1/rpc/wechat_link_confirm')return json({user_id:UID})
    if(url.pathname==='/rest/v1/account_deletion_jobs')return json([])
    if(url.pathname==='/rest/v1/profiles')return json(options.unbound && !url.searchParams.has('id') ? [] : [{id:UID,wechat_openid:OPENID,wechat_unionid:UNIONID,nickname:'Existing member'}])
    if(url.pathname===`/auth/v1/admin/users/${UID}`)return json({id:UID,email:EMAIL,email_confirmed_at:'2026-01-01T00:00:00Z',user_metadata:{provider:'google'}})
    if(url.pathname==='/auth/v1/admin/generate_link')return json({id:UID,email:EMAIL,hashed_token:'token-hash-1234567890123456',verification_type:'magiclink'})
    if(url.pathname==='/auth/v1/verify')return json({access_token:'access-12345678901234567890',refresh_token:'refresh-12345678901234567890',token_type:'bearer',expires_in:3600,user:{id:UID,email:EMAIL},provider_token:'never-forward'})
    throw new Error(`Unexpected fixture destination ${url.pathname}`)
  }
  return calls
}

test('website/WeChat account linking API rejects unproved identity and preserves the canonical account',async t=>{
  const oldFetch=globalThis.fetch,oldEnv=Object.fromEntries(Object.keys(ENV).map(k=>[k,process.env[k]]))
  t.after(()=>{globalThis.fetch=oldFetch;for(const[k,v]of Object.entries(oldEnv)){if(v===undefined)delete process.env[k];else process.env[k]=v}})
  await t.test('linking is a separate exact-value gate; capabilities reveal only enabled actions',async()=>{
    for(const flag of ['', 'false','TRUE',' true ']){
      const handler=await load({WECHAT_ACCOUNT_LINK_ENABLED:flag}),calls=mock()
      const res=await handler(request({action:'link_issue'},bearer()))
      assert.equal(res.status,404);assert.equal(calls.length,0)
      assert.deepEqual(await(await handler(request({action:'capabilities'}))).json(),{login:true,account_link:false})
    }
  })
  await t.test('issue authenticates exact bearer and derives owner/session only from verified claims',async()=>{
    const handler=await load(),calls=mock()
    const res=await handler(request({action:'link_issue',user_id:OTHER,session_id:OTHER},bearer()))
    assert.equal(res.status,200)
    const payload=await res.json();assert.match(payload.link_code,/^[0-9A-HJKMNP-TV-Z]{10}$/)
    assert.deepEqual(Object.keys(payload).sort(),['expires_at','link_code'])
    assert.equal(res.headers.get('cache-control'),'no-store')
    const rpc=calls.find(c=>c.url.pathname.endsWith('wechat_link_issue'))
    assert.equal(rpc.body.user_id_in,UID);assert.equal(rpc.body.session_id_in,SID)
    assert.match(rpc.body.code_hash_in,/^[0-9a-f]{64}$/)
    assert.equal(JSON.stringify(rpc.body).includes(payload.link_code),false)
    assert.equal(calls.some(c=>c.url.hostname==='api.weixin.qq.com'),false)
    assert.equal(calls.find(c=>c.url.pathname==='/auth/v1/user').init.headers.Authorization,bearer())
  })
  await t.test('missing bearer, rejected bearer or mismatched sub never issues a ticket',async()=>{
    const handler=await load()
    for(const auth of ['',bearer(OTHER),bearer(UID,'not-a-session')]){
      const calls=mock();const res=await handler(request({action:'link_issue'},auth))
      assert.equal(res.status,401);assert.equal(calls.some(c=>c.url.pathname.endsWith('wechat_link_issue')),false)
    }
    const calls=mock({override:url=>url.pathname==='/auth/v1/user'?json({id:UID},401):null})
    assert.equal((await handler(request({action:'link_issue'},bearer()))).status,401)
    assert.equal(calls.some(c=>c.url.pathname.endsWith('wechat_link_issue')),false)
  })
  await t.test('preview uses fresh provider identity, returns masked target and never creates a session',async()=>{
    const handler=await load(),calls=mock()
    const res=await handler(request({action:'link_preview',js_code:'fresh',link_code:'abcde-fghjk',openid:'attacker',user_id:OTHER}))
    assert.equal(res.status,200);const body=await res.json()
    assert.deepEqual(Object.keys(body).sort(),['confirmation','email_label','expires_at','nickname'])
    assert.match(body.confirmation,/^[0-9a-f]{64}$/);assert.equal(body.email_label,'e***@example.test')
    const rpc=calls.find(c=>c.url.pathname.endsWith('wechat_link_preview'))
    assert.equal(rpc.body.openid_in,OPENID);assert.equal(rpc.body.unionid_in,UNIONID)
    assert.notEqual(rpc.body.proof_hash_in,body.confirmation)
    assert.equal(calls.some(c=>c.url.pathname.includes('/auth/v1/')),false)
  })
  await t.test('confirmation signs in to the exact website account without modifying Google metadata',async()=>{
    const handler=await load(),calls=mock()
    const res=await handler(request({action:'link_confirm',js_code:'fresh-confirm',link_code:CODE,confirmation:CONFIRMATION}))
    assert.equal(res.status,200);const body=await res.json()
    assert.equal(body.user.id,UID);assert.equal(body.user.email,EMAIL);assert.equal(body.provider_token,undefined)
    const generated=calls.find(c=>c.url.pathname.endsWith('generate_link')).body
    assert.deepEqual(generated,{type:'magiclink',email:EMAIL})
    assert.equal(calls.some(c=>c.init.method==='PATCH'),false)
  })
  await t.test('bound login keeps working with new linking disabled and never creates a duplicate',async()=>{
    const handler=await load({WECHAT_ACCOUNT_LINK_ENABLED:'false'}),calls=mock()
    const res=await handler(request({js_code:'returning-code'}));assert.equal(res.status,200)
    assert.equal((await res.json()).user.id,UID)
    assert.equal(calls.find(c=>c.url.pathname.endsWith('generate_link')).body.email,EMAIL)
  })
  await t.test('unbound login requires explicit registration rather than creating a placeholder silently',async()=>{
    const handler=await load(),calls=mock({unbound:true})
    const res=await handler(request({js_code:'unbound-code'}))
    assert.equal(res.status,409);assert.equal((await res.json()).error,'wechat_account_not_linked')
    assert.equal(calls.some(c=>c.url.pathname.includes('generate_link')),false)
  })
  await t.test('expired, competing, replayed or backend-denied requests never reach Auth',async()=>{
    const handler=await load()
    for(const error of ['link_expired','link_conflict','reauth_required']){
      const calls=mock({override:url=>url.pathname.endsWith('wechat_link_confirm')?json({error}):null})
      const res=await handler(request({action:'link_confirm',js_code:'fresh',link_code:CODE,confirmation:CONFIRMATION}))
      assert.equal(res.status,error==='reauth_required'?401:409)
      assert.equal(calls.some(c=>c.url.pathname.includes('/auth/v1/')),false)
    }
  })
  await t.test('changed account, malformed binding and unavailable lookup fail closed without placeholder fallback',async()=>{
    const handler=await load()
    const cases=[
      [url=>url.pathname==='/rest/v1/profiles'?json({invalid:true}):null,503],
      [url=>url.pathname==='/rest/v1/profiles'?json([],500):null,503],
      [url=>url.pathname===`/auth/v1/admin/users/${UID}`?json({id:OTHER,email:EMAIL,email_confirmed_at:'yes'}):null,409],
      [url=>url.pathname.endsWith('generate_link')?json({id:OTHER,email:EMAIL,hashed_token:'token-hash-1234567890123456',verification_type:'magiclink'}):null,409],
    ]
    for(const[override,status]of cases){const calls=mock({override});const res=await handler(request({js_code:'fresh'}));assert.equal(res.status,status)
      assert.equal(calls.some(c=>c.url.pathname==='/auth/v1/verify'),false)
      assert.equal(calls.some(c=>c.body?.email?.endsWith('@wechat.placeholder')),false)}
  })
  await t.test('invalid link code/proof is rejected before paid upstream work',async()=>{
    const handler=await load(),calls=mock()
    for(const body of [{action:'link_preview',link_code:'too-short'},{action:'link_confirm',link_code:CODE,confirmation:'wrong'}]){
      assert.equal((await handler(request({js_code:'fresh',...body}))).status,400)
    }
    assert.equal(calls.length,0)
  })
})
