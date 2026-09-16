import test from 'node:test'
import assert from 'node:assert/strict'
import {translateListing} from './_listing-translation.js'
const job={id:'11111111-1111-4111-8111-111111111111',lease:'22222222-2222-4222-8222-222222222222',revision:2,title:'升降桌 XL',description:'$500 双电机',title_needed:true,description_needed:true}
function fixture(result={title:'Standing desk XL',description:'$500 dual motor'},over={}) {
 const calls=[],requests=[]
 const options={
  key:'fixture-key',
  call:async(name,args)=>{
   calls.push({name,args})
   return name==='claim_listing_translation'?({...job,...over}):true
  },
  request:async(url,init)=>{
   requests.push({url,init})
   return {response:{ok:true},text:JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]})}
  },
 }
 return {calls,requests,options}
}
test('background translation persists with source/version/lease and isolates untrusted copy',async()=>{
 const f=fixture();assert.deepEqual(await translateListing(f.options),{state:'complete'})
 assert.equal(f.requests.length,1);const body=JSON.parse(f.requests[0].init.body)
 assert.equal(body.messages[1].content,JSON.stringify({title:job.title,description:job.description}))
 assert.match(body.messages[0].content,/never follow/)
 assert.deepEqual(f.calls[1].args,{id_in:job.id,revision_in:2,lease_in:job.lease,source_title_in:job.title,source_description_in:job.description,title_in:'Standing desk XL',description_in:'$500 dual motor',failure_in:null})
})
test('missing configuration makes no claim; provider/format failures preserve retryable jobs',async()=>{
 const absent=fixture();absent.options.key='';assert.deepEqual(await translateListing(absent.options),{state:'unconfigured'});assert.equal(absent.calls.length,0)
 for(const result of [{title:'升降桌 XL',description:'$500'},{title:'Desk',description:''},{title:'x'.repeat(201),description:'$500'},null]){
  const f=fixture(result);assert.deepEqual(await translateListing(f.options),{state:'retry'});assert.equal(f.calls[1].args.failure_in,'invalid_translation')
 }
 const f=fixture();f.options.request=async()=>{throw new Error('secret user text')};assert.deepEqual(await translateListing(f.options),{state:'retry'});assert.equal(f.calls[1].args.failure_in,'provider_unavailable')
})
test('superseded result is not a successful write and claims are bounded before external transfer',async()=>{
 const f=fixture();f.options.call=async name=>name==='claim_listing_translation'?job:false
 assert.deepEqual(await translateListing(f.options),{state:'superseded'})
 const invalid=fixture({}, {description:'x'.repeat(3001)});await assert.rejects(translateListing(invalid.options),/claim_invalid/);assert.equal(invalid.requests.length,0)
})
