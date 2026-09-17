import { resolve } from 'node:path'
import { readFileSync, mkdirSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { CURRENT_CONSENT_VERSION } from '../src/legal'
import { supabaseRefForBuild } from './supabase-ref'
test.use({browserName: process.env.CHAT_AUDIT_BROWSER === 'chromium' ? 'chromium' : 'webkit'})
const ME='11111111-1111-4111-8111-111111111111',PEER='22222222-2222-4222-8222-222222222222',CONV='44444444-4444-4444-8444-444444444444'
async function fixture(page:Page){
 const sent:any[]=[];const signed:any[]=[];const uploads:any[]=[];let failSend=false
 const profile={id:ME,nickname:'Buyer',avatar_url:null,tos_version:CURRENT_CONSENT_VERSION,suspension_level:0,suspended_until:null}
 const conv={id:CONV,buyer_id:ME,seller_id:PEER,is_direct:true,item_id:null,item:null,buyer:profile,seller:{id:PEER,nickname:'Demo seller',avatar_url:null},created_at:'2026-09-16T10:00:00Z',last_message_at:'2026-09-16T10:00:00Z',is_pinned_buyer:false,is_pinned_seller:false,is_muted_buyer:false,is_muted_seller:false,is_unread_buyer:false,is_unread_seller:false,latest_messages:[],unread_messages:[]}
 let archived=false, rejectPin=false
 const writes:{path:string;body:any}[]=[]
 await page.addInitScript(([ref,id])=>{
  localStorage.setItem('welcomed','1');localStorage.setItem('lang','en');localStorage.setItem('theme_pref','light')
  const generation='inbox-actions';localStorage.setItem(`sb-${ref}-auth-token`,JSON.stringify({tag:'caaci-auth-value-v2',generation,value:JSON.stringify({access_token:'stub',refresh_token:'stub',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,user:{id,email:'test@example.invalid',aud:'authenticated',role:'authenticated'}})}))
  localStorage.setItem(`sb-${ref}-auth-token-auth-boundary-v2`,JSON.stringify({v:2,mode:'allowed',generation}))
 },[supabaseRefForBuild(),ME])
 await page.routeWebSocket(/supabase\.co/,socket=>socket.close())
 await page.route(url=>url.pathname.startsWith('/api/'),r=>r.fulfill({contentType:'application/json',body:'{"messages":[],"events":[]}'}))
 await page.route('**/*.supabase.co/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname
  if(path.startsWith('/storage/v1/object/chat-media/')){
   uploads.push({path,method:req.method(),headers:req.headers()})
   return route.fulfill({contentType:'application/json',body:JSON.stringify({Key:path.split('/object/')[1]})})
  }
  if(path.startsWith('/storage/v1/object/sign/chat-media/')){
   if(req.method()==='POST'){
    signed.push({path,body:req.postDataJSON()})
    return route.fulfill({contentType:'application/json',body:JSON.stringify({signedURL:path.replace('/storage/v1','')+'?token=synthetic-private'})})
   }
   if(path.endsWith('.mp4'))return route.fulfill({contentType:'video/mp4',body:readFileSync(resolve(process.cwd(),'smoke/fixtures/media/chat-sample.mp4'))})
   return route.fulfill({contentType:'image/png',body:Buffer.from(PNG,'base64')})
  }
  const body=req.postDataJSON()
  if(req.method()!=='GET')writes.push({path,body})
  let data:any=[]
  if(path.endsWith('/messages')){
   if(req.method()==='POST'){
    if(failSend)return route.fulfill({status:503,contentType:'application/json',body:'{"code":"service_unavailable"}'})
    if(!sent.some(m=>m.id===body.id))sent.push({...body,is_read:false,created_at:new Date().toISOString()})
    data=sent.find(m=>m.id===body.id)
   }else data=sent.filter(m=>!url.searchParams.has('id') || url.searchParams.get('id')===`eq.${m.id}`)
  }
  else if(path.endsWith('/get_my_profile'))data=profile
  else if(path.endsWith('/profiles'))data=[profile]
  else if(path.endsWith('/set_conversation_read_state')){
   expect(body.expected_user_id_in).toBe(ME);expect(body.conversation_id_in).toBe(CONV)
   conv.is_unread_buyer=body.unread_in;data=null
  }else if(path.endsWith('/archive_conversation')){archived=true;data=null}
  else if(path.endsWith('/conversation_archives'))data=archived&&!url.searchParams.has('conversation_id')?[{conversation_id:CONV}]:[]
  else if(path.endsWith('/conversations')){
   if(req.method()==='PATCH'){
    if(rejectPin)return route.fulfill({status:406,contentType:'application/json',body:JSON.stringify({code:'PGRST116',message:'0 rows'})})
    Object.assign(conv,body)
   }
   data=url.searchParams.get('id')?.startsWith('gt.')?[]:[conv]
  }
  if(req.headers().accept?.includes('vnd.pgrst.object')&&Array.isArray(data))data=data[0]??null
  return route.fulfill({contentType:'application/json',body:JSON.stringify(data)})
 })
 return {conv,sent,signed,uploads,setFail:(v:boolean)=>{failSend=v}}
}

const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6zdAAAAAASUVORK5CYII='
async function open(page:Page){
 const state=await fixture(page)
 await page.goto(`/#/pages/chat/index?id=${CONV}`)
 await expect(page.locator('.attachment-actions')).toBeVisible()
 return state
}
test('photo attachment uploads privately, retries one logical message and loads a short-lived URL',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
 const state=await open(page);state.setFail(true)
 const chooser=page.waitForEvent('filechooser')
 await page.locator('.attachment-actions').getByRole('button',{name:'Photo',exact:true}).click()
 await (await chooser).setFiles({name:'photo.png',mimeType:'image/png',buffer:Buffer.from(PNG,'base64')})
 await expect(page.locator('.msg-status.failed')).toBeVisible()
 expect(state.uploads).toHaveLength(1)
 state.setFail(false)
 await page.locator('.msg-status.failed').click()
 await expect(page.locator('.chat-photo')).toBeVisible()
 expect(state.sent).toHaveLength(1);expect(state.uploads).toHaveLength(1)
 const m=state.sent[0]
 expect(m.message_type).toBe('image');expect(m.content).toMatch(new RegExp(`^items/${ME}/${CONV}/${m.id}\\.(jpg|png)$`))
 expect(state.signed[0].body.expiresIn).toBe(60)
 await expect(page.locator('.chat-photo img')).toHaveAttribute('src',/\/object\/sign\/chat-media\//)
 expect(errors).toEqual([])
})
test('video attachment uses private storage and renders playback controls',async({page})=>{
 const state=await open(page)
 const chooser=page.waitForEvent('filechooser')
 await page.locator('.attachment-actions').getByRole('button',{name:'Video',exact:true}).click()
 await (await chooser).setFiles(resolve(process.cwd(),'smoke/fixtures/media/chat-sample.mp4'))
 await expect(page.locator('.chat-video')).toBeVisible()
 expect(state.sent).toHaveLength(1);expect(state.sent[0].message_type).toBe('video')
 expect(state.sent[0].content).toMatch(/\.mp4$/)
 expect(state.uploads[0].path).toContain('/chat-media/')
})

for (const [device,width,height] of [['phone',390,844],['ipad',820,1180],['mac',1920,1080]] as const) {
 test(`${device}: composer starts level, stays borderless on focus and grows only for content`,async({page})=>{
  await page.setViewportSize({width,height});await open(page)
  const editor=page.locator('.msg-input textarea')
  const sizes=()=>page.locator('.input-bar').evaluate(el=>['.emoji-btn','.msg-input','.send-btn'].map(s=>{const e=el.querySelector(s)!;const r=e.getBoundingClientRect();return {height:r.height,bottom:r.bottom,outline:getComputedStyle(e).outlineWidth,shadow:getComputedStyle(e).boxShadow}}))
  for(const focused of [false,true]){
   if(focused)await editor.focus()
   const boxes=await sizes()
   expect(Math.max(...boxes.map(b=>b.height))-Math.min(...boxes.map(b=>b.height))).toBeLessThan(2)
   expect(boxes[1].shadow).toBe('none')
   expect(await editor.evaluate(e=>getComputedStyle(e).outlineStyle)).toBe('none')
  }
  await editor.fill('First line\nSecond line\nThird line')
  await expect.poll(async()=> (await sizes())[1].height).toBeGreaterThan(60)
  const boxes=await sizes();expect(Math.abs(boxes[1].bottom-boxes[2].bottom)).toBeLessThan(2)
  await editor.fill('');await expect.poll(async()=> (await sizes())[1].height).toBeLessThan(46)
  if(process.env.FEEDBACK_VISUAL_DIR){mkdirSync(process.env.FEEDBACK_VISUAL_DIR,{recursive:true});await page.screenshot({path:`${process.env.FEEDBACK_VISUAL_DIR}/${device}-chat.png`})}
 })
}

test('existing photo stays mounted through repeated authoritative message refreshes',async({page})=>{
 const state=await open(page)
 const chooser=page.waitForEvent('filechooser')
 await page.locator('.attachment-actions').getByRole('button',{name:'Photo',exact:true}).click()
 await (await chooser).setFiles({name:'photo.png',mimeType:'image/png',buffer:Buffer.from(PNG,'base64')})
 await expect(page.locator('.chat-photo img')).toBeVisible()
 await page.evaluate(()=>{(window as any).__originalPhoto=document.querySelector('.chat-photo img')})
 const signedBefore=state.signed.length
 for(let n=0;n<3;n++){
  state.sent[0].is_read=n%2===0
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/rest/v1/messages'&&r.request().method()==='GET')
  await page.evaluate(()=>window.dispatchEvent(new Event('online')))
  await response
  await page.waitForTimeout(150)
  expect(await page.evaluate(()=>(window as any).__originalPhoto===document.querySelector('.chat-photo img'))).toBe(true)
 }
 expect(state.signed.length).toBe(signedBefore)
})
