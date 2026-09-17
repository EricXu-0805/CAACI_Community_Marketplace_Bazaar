#!/usr/bin/env node
// Protected staging only. Aggregate timings, never credentials or content.
import {createRequire} from 'node:module'
import {randomUUID} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import {assertSafeTarget,PIXEL_PNG_BASE64} from './verify-staging-write-path.mjs'
const require=createRequire(new URL('../app/package.json',import.meta.url))
const {createClient}=require('@supabase/supabase-js')
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
export function safeSoakTarget(env){
 const target=assertSafeTarget(env)
 if(target.ref!=='hygkwxugskijadgfisji'||!UUID.test(env.SMOKE_EXPECTED_USER_ID||''))throw Error('soak_target_not_reviewed')
 const key=target.key
 if(!/^sb_publishable_[\w-]+$/.test(key)){
  let role;try{role=JSON.parse(Buffer.from(key.split('.')[1],'base64url')).role}catch{}
  if(role!=='anon')throw Error('soak_requires_public_key')
 }
 return target
}
export function timingSummary(samples){
 const sorted=[...samples].sort((a,b)=>a-b)
 return {count:sorted.length,p95Ms:sorted[Math.max(0,Math.ceil(sorted.length*.95)-1)]??null,maxMs:sorted.at(-1)??null}
}
export async function main(){
 const {url,key}=safeSoakTarget(process.env)
 const durationMs=300_000,stopAt=Date.now()+durationMs
 const id=randomUUID(),postId=randomUUID(),run=id.slice(0,8)
 const timings={search:[],listing:[],plaza:[],write:[],media:[]},events=new Set(),written=new Set()
 let token='',client,channel,objectName='',cleanupOk=true,runFailure=null,operations=0
 const http=async(path,{method='GET',body,headers={},bytes=false}={})=>{
  const res=await fetch(url+path,{method,headers:{apikey:key,...(token?{Authorization:`Bearer ${token}`}:{}) ,...headers},
   ...(body===undefined?{}:{body:typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(10000)})
  if(!res.ok){await res.body?.cancel();throw Error(`soak_http_${res.status}`)}
  return bytes?Buffer.from(await res.arrayBuffer()):(await res.text()).trim()
 }
 const rest=(path,options={})=>http('/rest/v1/'+path,{...options,headers:{'Content-Type':'application/json',...options.headers}})
 const timed=async(kind,fn)=>{const start=performance.now();const result=await fn();timings[kind].push(Math.round(performance.now()-start));operations++;return result}
 try{
  const auth=JSON.parse(await http('/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json'},body:{email:process.env.SMOKE_EMAIL,password:process.env.SMOKE_PASSWORD}}))
  token=auth.access_token
  if(!token||auth.user?.id!==process.env.SMOKE_EXPECTED_USER_ID)throw Error('soak_account_mismatch')
  const uid=auth.user.id
  client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(input,init={})=>fetch(input,{...init,signal:AbortSignal.timeout(10000)})}})
  const {error}=await client.auth.setSession({access_token:token,refresh_token:auth.refresh_token})
  if(error)throw Error('soak_sdk_session_failed')
  objectName=`items/${uid}/ci-soak-${id}.png`
  await http(`/storage/v1/object/item-images/${objectName}`,{method:'POST',body:Buffer.from(PIXEL_PNG_BASE64,'base64'),headers:{'Content-Type':'image/png'}})
  const photo=`${url}/storage/v1/object/public/item-images/${objectName}`
  await rest('items',{method:'POST',body:{id,user_id:uid,title:`[ci soak] Desk ${run}`,description:'Synthetic staging acceptance. Removed after the run.',price:25,category:'furniture',condition:'good',images:[photo],image_dimensions:[{w:1,h:1}],location:'UIUC'}})
  await rest('posts',{method:'POST',body:{id:postId,user_id:uid,content:`Synthetic staging soak ${run} revision 0`,images:[],status:'active'}})
  channel=client.channel(`soak-${run}`).on('postgres_changes',{event:'UPDATE',schema:'public',table:'posts',filter:`id=eq.${postId}`},event=>{
   const n=/ revision (\d+)$/.exec(event.new?.content||'')?.[1]
   if(n)events.add(Number(n))
  })
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('soak_realtime_subscribe_timeout')),12000);channel.subscribe(status=>{if(status==='SUBSCRIBED'){clearTimeout(timer);resolve()}else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'){clearTimeout(timer);reject(Error('soak_realtime_subscribe_failed'))}})})
  let round=0,nextWrite=0
  while(Date.now()<stopAt){
   const start=Date.now()
   const queries=[['desk'],['furnture'],['desk','student','room','pickup','table','chair','campus','wood','study','lamp','shelf','book']]
   const terms=queries[round++%queries.length]
   const results=await Promise.allSettled([
    timed('search',()=>rest('rpc/search_items_fuzzy_v2',{method:'POST',body:{terms_in:terms,limit_in:20,offset_in:0}})),
    timed('listing',()=>rest(`items?id=eq.${id}&select=id,price,location_checked_at`)),
    timed('plaza',()=>rest(`posts?id=eq.${postId}&select=id,content_i18n`)),
   ])
   if(results.some(r=>r.status==='rejected'))throw Error('soak_read_failed')
   if(Date.now()>=nextWrite){
    const rev=written.size+1
    await timed('write',()=>rest(`posts?id=eq.${postId}`,{method:'PATCH',body:{content:`Synthetic staging soak ${run} revision ${rev}`}}))
    written.add(rev);nextWrite=Date.now()+30000
    await timed('media',async()=>{
     const body=await http(`/storage/v1/object/public/item-images/${objectName}`,{bytes:true})
     if(!body.equals(Buffer.from(PIXEL_PNG_BASE64,'base64')))throw Error('soak_media_mismatch')
    })
   }
   await sleep(Math.max(0,1000-(Date.now()-start)))
  }
  for(let tries=0;tries<10&&[...written].some(n=>!events.has(n));tries++)await sleep(500)
  if([...written].some(n=>!events.has(n)))throw Error('soak_realtime_delivery_missing')
  if(timingSummary(timings.search).p95Ms>2000||timingSummary(timings.listing).p95Ms>1500)throw Error('soak_latency_budget_exceeded')
 }catch(error){runFailure=/^soak_[a-z_0-9]+$/.test(error?.message)?error.message:'soak_unexpected_failure'}
 finally{
  if(channel)await client.removeChannel(channel).catch(()=>{})
  // Exact per-run IDs only; no deletion by broad title/prefix or other accounts.
  if(token){
   for(const path of [`posts?id=eq.${postId}`,`items?id=eq.${id}`]){
    try{await rest(path,{method:'DELETE'});if(JSON.parse(await rest(path+'&select=id')).length)cleanupOk=false}catch{cleanupOk=false}
   }
   if(objectName)try{await http('/storage/v1/object/item-images',{method:'DELETE',headers:{'Content-Type':'application/json'},body:{prefixes:[objectName]}})}catch{cleanupOk=false}
   try{await http('/auth/v1/logout?scope=local',{method:'POST'})}catch{cleanupOk=false}
  }
 }
 const summary={durationSeconds:Math.round((Date.now()-(stopAt-durationMs))/1000),dataset:'isolated synthetic staging, not 10k capacity',parallelReads:3,operations,
  timings:Object.fromEntries(Object.entries(timings).map(([k,v])=>[k,timingSummary(v)])),writes:written.size,realtimeDelivered:[...written].filter(n=>events.has(n)).length,cleanupOk,passed:!runFailure&&cleanupOk,failure:runFailure}
 console.log(JSON.stringify(summary,null,2))
 if(!summary.passed)process.exitCode=1
 return summary
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href)main().catch(()=>{console.error('soak_configuration_or_initialization_failed');process.exitCode=1})
