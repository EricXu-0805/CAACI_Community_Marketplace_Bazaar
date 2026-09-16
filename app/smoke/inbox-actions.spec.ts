import { test, expect, type Page } from '@playwright/test'
import { CURRENT_CONSENT_VERSION } from '../src/legal'
import { supabaseRefForBuild } from './supabase-ref'
test.use({browserName:'webkit'})
const ME='11111111-1111-4111-8111-111111111111',PEER='22222222-2222-4222-8222-222222222222',CONV='44444444-4444-4444-8444-444444444444'
async function fixture(page:Page){
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
  const req=route.request(),url=new URL(req.url()),path=url.pathname,body=req.postDataJSON()
  if(req.method()!=='GET')writes.push({path,body})
  let data:any=[]
  if(path.endsWith('/get_my_profile'))data=profile
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
 return {conv,writes,rejectPin:()=>{rejectPin=true},archived:()=>archived}
}
async function menu(page:Page,label:string){
 await page.locator('.conv-item').click({button:'right'})
 await page.locator('.uni-actionsheet__cell').filter({hasText:new RegExp(`^${label}$`)}).click()
}
for(const [device,width,height] of [['phone',390,844],['desktop',1440,900]] as const){
 test(`${device}: empty direct thread pin and manual unread persist; archive clears list and badge`,async({page})=>{
  await page.setViewportSize({width,height});const state=await fixture(page);await page.goto('/#/pages/messages/index')
  await expect(page.locator('.conv-item')).toBeVisible()
  await menu(page,'Pin');await expect(page.locator('.pin-badge')).toBeVisible();expect(state.conv.is_pinned_buyer).toBe(true)
  await page.reload();await expect(page.locator('.pin-badge')).toBeVisible()
  await menu(page,'Mark unread');await expect(page.locator('.conv-item')).toHaveAttribute('aria-label',/Unread/)
  expect(state.conv.is_unread_buyer).toBe(true);expect(state.conv.is_unread_seller).toBe(false)
  await page.reload();await expect(page.locator('.conv-item')).toHaveAttribute('aria-label',/Unread/)
  await menu(page,'Archive Conversation');await page.locator('.uni-modal__btn_primary').click()
  await expect(page.locator('.conv-item')).toHaveCount(0);expect(state.archived()).toBe(true)
  await page.reload();await expect(page.locator('.conv-item')).toHaveCount(0)
  expect(state.writes.filter(w=>w.path.endsWith('/messages'))).toHaveLength(0)
 })
}
test('pin failure is visible and does not falsely mark the conversation pinned',async({page})=>{
 const state=await fixture(page);state.rejectPin();await page.goto('/#/pages/messages/index')
 await expect(page.locator('.conv-item')).toBeVisible();await menu(page,'Pin')
 await expect(page.locator('.uni-simple-toast__text')).toBeVisible()
 await expect(page.locator('.pin-badge')).toHaveCount(0);expect(state.conv.is_pinned_buyer).toBe(false)
})
