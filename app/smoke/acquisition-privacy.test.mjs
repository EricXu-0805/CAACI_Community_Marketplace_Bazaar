import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { randomUUID } from 'node:crypto'
import ts from 'typescript'
const source=readFileSync(new URL('../src/api/acquisition.ts',import.meta.url),'utf8')
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
function harness({hostname='www.illinimarket.com',gpc=false,search='?utm_source=reddit&email=must-not-leave@example.org',getSession}={}){
 let user=null,generation=0,listener
 const sent=[],storage=new Map(),exports={}
 const scope={getActiveAccountId:()=>user,captureAccountIdentityGeneration:()=>generation,isAccountIdentityGenerationCurrent:(g,u)=>g===generation&&u===user,onAccountTransition:fn=>{listener=fn}}
 const context={exports,require:name=>name.includes('accountScope')?scope:{useSupabase:()=>({supabase:{auth:{getSession:getSession|| (async()=>({data:{session:{user:{id:user},access_token:'fixture-token'}}}))}}})},
  window:{location:{hostname,search}},navigator:{doNotTrack:'0',globalPrivacyControl:gpc},
  sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
  crypto:{randomUUID},URLSearchParams,AbortController,setTimeout,clearTimeout,Date,
  fetch:async(url,init)=>{sent.push({url,headers:init.headers,body:JSON.parse(init.body)});return {status:204}},
 }
 vm.runInNewContext(code,context)
 return{api:exports,sent,storage,transition(next){const previousUserId=user;user=next;generation++;listener?.({previousUserId,userId:next,generation})}}
}
test('only allowlisted channels on production collect; GPC and unrelated query data never leave the browser',async()=>{
 for(const config of [{hostname:'preview.vercel.app'},{gpc:true},{search:'?utm_source=private@example.org'}]){const h=harness(config);h.api.startAcquisition();assert.equal(h.sent.length,0)}
 const h=harness();h.api.startAcquisition();assert.equal(h.sent.length,1)
 assert.deepEqual(Object.keys(h.sent[0].body).sort(),['event','source','visit_id'])
 assert.equal(h.sent[0].body.source,'reddit');assert.equal(JSON.stringify(h.sent).includes('must-not-leave'),false)
 h.api.startAcquisition();assert.equal(h.sent.length,1,'once per tab boot')
 h.transition('user-A');await h.api.attributeNewAccount('user-A','2026-09-17');assert.equal(h.sent.length,1,'require new consent')
 await h.api.attributeNewAccount('user-A','2026-09-19');assert.equal(h.sent.length,2)
 await h.api.attributeNewAccount('user-A','2026-09-19');assert.equal(h.sent.length,2,'deduplicate profile updates')
 h.transition(null);assert.equal(h.storage.size,0)
})
test('a session lookup finishing after an account switch cannot attribute the old campaign',async()=>{
 let finish
 const h=harness({getSession:()=>new Promise(resolve=>{finish=resolve})});h.api.startAcquisition();h.transition('user-A')
 const pending=h.api.attributeNewAccount('user-A','2026-09-19')
 while(!finish)await new Promise(resolve=>setTimeout(resolve,0))
 h.transition('user-B');finish({data:{session:{user:{id:'user-A'},access_token:'old-token'}}})
 await pending;assert.equal(h.sent.length,1);assert.equal(h.storage.size,0)
})
