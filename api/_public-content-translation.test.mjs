import test from 'node:test'
import assert from 'node:assert/strict'
import { translatePublicContent } from './_public-content-translation.js'
const job={id:'11111111-1111-4111-8111-111111111111',lease:'22222222-2222-4222-8222-222222222222',revision:2,kind:'comment',content:'周五下午取货'}
function fixture(translated='Pickup Friday afternoon') {
 const calls=[],requests=[]
 return {calls,requests,options:{key:'synthetic',call:async(name,args)=>{calls.push({name,args});return name==='claim_public_content_translation'?job:true},request:async(url,init)=>{requests.push({url,init});return {response:{ok:true},text:JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({translated})}}]})}}}}
}
test('public worker isolates copy and commits only its content revision and lease',async()=>{
 const f=fixture();assert.deepEqual(await translatePublicContent(f.options),{state:'complete'})
 assert.equal(JSON.parse(f.requests[0].init.body).messages[1].content,job.content)
 assert.deepEqual(f.calls[1].args,{kind_in:'comment',id_in:job.id,revision_in:2,lease_in:job.lease,source_in:job.content,english_in:'Pickup Friday afternoon',failure_in:null})
})
test('provider receives a strict required translated field, not an ambiguous JSON object',async()=>{
 const f=fixture();await translatePublicContent(f.options)
 const format=JSON.parse(f.requests[0].init.body).response_format
 assert.equal(format.type,'json_schema')
 assert.equal(format.json_schema.strict,true)
 assert.deepEqual(format.json_schema.schema,{type:'object',properties:{translated:{type:'string'}},required:['translated'],additionalProperties:false})
})
test('the literal bilingual language-switch label is readable in English without dropping other text',async()=>{
 for(const label of ['中 / EN','中 | EN','中/EN']) {
  const f=fixture(`Switch ${label} in your profile.`)
  assert.deepEqual(await translatePublicContent(f.options),{state:'complete'})
  assert.equal(f.calls[1].args.english_in,'Switch Chinese / English in your profile.')
 }
 const f=fixture('Switch 中 / EN; 未翻译的信息')
 assert.deepEqual(await translatePublicContent(f.options),{state:'retry'})
 assert.equal(f.calls[1].args.english_in,null)
})
test('refusal, truncation and alternative field names never become published English',async()=>{
 for(const choice of [
  {finish_reason:'length',message:{content:JSON.stringify({translated:'Pickup Friday'})}},
  {finish_reason:'stop',message:{refusal:'Cannot translate'}},
  {finish_reason:'stop',message:{content:JSON.stringify({translation:'Pickup Friday'})}},
 ]) {
  const f=fixture();f.options.request=async()=>({response:{ok:true},text:JSON.stringify({choices:[choice]})})
  assert.deepEqual(await translatePublicContent(f.options),{state:'retry'})
  assert.equal(f.calls[1].args.english_in,null)
  assert.equal(f.calls[1].args.failure_in,'invalid_translation')
 }
})
test('missing key never claims; invalid output and provider failure remain retryable',async()=>{
 const absent=fixture();absent.options.key='';assert.deepEqual(await translatePublicContent(absent.options),{state:'unconfigured'});assert.equal(absent.calls.length,0)
 for(const value of ['',null,'仍为中文','x'.repeat(8001)]) {const f=fixture(value);assert.deepEqual(await translatePublicContent(f.options),{state:'retry'})}
 const f=fixture();f.options.request=async()=>{throw new Error('private provider detail')};await translatePublicContent(f.options);assert.equal(f.calls[1].args.failure_in,'provider_unavailable')
})
test('private messages and malformed jobs never reach the provider',async()=>{
 for(const extra of [{kind:'message'},{content:'x'.repeat(4001)},{revision:0},{lease:'bad'}]) {
  const f=fixture();f.options.call=async()=>({...job,...extra});await assert.rejects(translatePublicContent(f.options),/claim_invalid/);assert.equal(f.requests.length,0)
 }
})
