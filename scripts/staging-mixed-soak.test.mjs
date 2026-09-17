import test from 'node:test'
import assert from 'node:assert/strict'
import {safeSoakTarget,timingSummary,createSoakPost,setSoakLike,waitForPostgresReady} from './staging-mixed-soak.mjs'
const env={SUPABASE_URL:'https://hygkwxugskijadgfisji.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',SMOKE_EXPECTED_SUPABASE_PROJECT_REF:'hygkwxugskijadgfisji',SMOKE_EXPECTED_USER_ID:'11111111-1111-4111-8111-111111111111',SMOKE_EMAIL:'test@example.invalid',SMOKE_PASSWORD:'fixture',SMOKE_ACCOUNT_IS_SYNTHETIC:'true',SMOKE_DATASET_IS_SYNTHETIC:'true'}
test('soak rejects production, non-reviewed targets, privileged keys, missing exact user and real data',()=>{
 assert.equal(safeSoakTarget(env).ref,env.SMOKE_EXPECTED_SUPABASE_PROJECT_REF)
 for(const changes of [{SMOKE_EXPECTED_USER_ID:''},{SMOKE_DATASET_IS_SYNTHETIC:'false'},{SUPABASE_SECRET_KEY:'secret'},{SUPABASE_PUBLISHABLE_KEY:'sb_secret_opaque'},{SUPABASE_PUBLISHABLE_KEY:'e30.'+Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')+'.x'},...['lfhvgprfphyfvhidegum','aaaaaaaaaaaaaaaaaaaa'].map(ref=>({SUPABASE_URL:`https://${ref}.supabase.co`,SMOKE_EXPECTED_SUPABASE_PROJECT_REF:ref}))])assert.throws(()=>safeSoakTarget({...env,...changes}))
})
test('p95 includes tail latency and empty samples cannot imply zero latency',()=>{
 assert.deepEqual(timingSummary([]),{count:0,p95Ms:null,maxMs:null})
 assert.deepEqual(timingSummary([...Array(18).fill(10),2000,3000]),{count:20,p95Ms:2000,maxMs:3000})
})
function channelHarness(){
 let system,status
 const channel={on(type,filter,callback){assert.equal(type,'system');assert.equal(filter,'*');system=callback;return channel},subscribe(callback){status=callback;return channel}}
 return {channel,system:payload=>system(payload),status:value=>status(value)}
}
for(const first of ['socket','database'])test(`soak waits for the actual database listener when ${first} acknowledges first`,async()=>{
 const h=channelHarness();let ready=false
 const waiting=waitForPostgresReady(h.channel).then(()=>{ready=true})
 const socket=()=>h.status('SUBSCRIBED'),database=()=>h.system({extension:'postgres_changes',status:'ok'})
 ;(first==='socket'?socket:database)()
 await Promise.resolve();assert.equal(ready,false,'the first write must still be blocked')
 h.system({extension:'presence',status:'ok'})
 await Promise.resolve();assert.equal(ready,false)
 ;(first==='socket'?database:socket)()
 await waiting;assert.equal(ready,true)
})
test('soak fails instead of counting a socket-only join as a ready database listener',async()=>{
 const h=channelHarness(),waiting=waitForPostgresReady(h.channel,{timeoutMs:5})
 h.status('SUBSCRIBED')
 await assert.rejects(waiting,/soak_realtime_ready_timeout/)
})
test('soak rejects database-listener errors and channel closures before writes',async()=>{
 for(const fail of [h=>h.system({extension:'postgres_changes',status:'error'}),h=>h.status('CLOSED'),h=>h.status('CHANNEL_ERROR')]){
  const h=channelHarness(),waiting=waitForPostgresReady(h.channel)
  fail(h);await assert.rejects(waiting,/soak_realtime_(listener|subscribe)_failed/)
 }
})
test('soak uses the ordinary post grants and observes both like transitions',async()=>{
 const uid=env.SMOKE_EXPECTED_USER_ID,pid='22222222-2222-4222-8222-222222222222'
 let created=false,liked=false
 const rest=async(path,{method='GET',body,headers}={})=>{
  const url=new URL(path,'https://example.invalid/')
  if(url.pathname==='/posts'&&method==='POST'){
   for(const key of Object.keys(body))assert.ok(['user_id','content','images'].includes(key),'server-owned column sent')
   assert.equal(body.user_id,uid);assert.equal(url.searchParams.get('select'),'id');assert.equal(headers.Prefer,'return=representation')
   created=true;return JSON.stringify([{id:pid}])
  }
  if(url.pathname==='/post_likes'){
   assert.equal(created,true)
   if(method==='POST'){assert.deepEqual(body,{post_id:pid,user_id:uid});liked=true}
   else{assert.equal(method,'DELETE');assert.equal(url.searchParams.get('post_id'),`eq.${pid}`);assert.equal(url.searchParams.get('user_id'),`eq.${uid}`);liked=false}
   return ''
  }
  assert.equal(method,'GET');assert.equal(url.searchParams.get('id'),`eq.${pid}`)
  return JSON.stringify([{id:pid,like_count:Number(liked)}])
 }
 assert.equal(await createSoakPost(rest,uid,'Synthetic fixture'),pid)
 await setSoakLike(rest,pid,uid,true);assert.equal(liked,true)
 await setSoakLike(rest,pid,uid,false);assert.equal(liked,false)
 await assert.rejects(createSoakPost(async()=>JSON.stringify([{id:'invalid'}]),uid,'fixture'),/identity_invalid/)
 await assert.rejects(setSoakLike(async(path,opts)=>opts?'':JSON.stringify([{id:pid,like_count:0}]),pid,uid,true),/like_mismatch/)
})
