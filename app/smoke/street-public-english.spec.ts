import {test,expect,type Page} from '@playwright/test'
import {CURRENT_CONSENT_VERSION} from '../src/legal'
import {supabaseRefForBuild} from './supabase-ref'
import {mkdir} from 'node:fs/promises'
const ME='11111111-1111-4111-8111-111111111111',PEER='22222222-2222-4222-8222-222222222222',ITEM='33333333-3333-4333-8333-333333333333',POST='44444444-4444-4444-8444-444444444444',COMMENT='55555555-5555-4555-8555-555555555555'
const profile={id:ME,nickname:'Test publisher',tos_version:CURRENT_CONSENT_VERSION,suspension_level:0,suspended_until:null,location:'UIUC',created_at:'2026-08-01T00:00:00Z'}
const item={id:ITEM,user_id:ME,title:'Standing desk',description:'Used desk for a student room',title_i18n:{en:'Standing desk'},price:45,category:'furniture',condition:'good',status:'active',listing_type:'sell',images:[],image_dimensions:[],location:'Green Street, Champaign',location_verified:true,location_checked_at:'2026-09-16T18:00:00Z',updated_at:'2026-09-16T18:00:00Z',created_at:'2026-09-16T18:00:00Z',profile}
const post={id:POST,user_id:PEER,content:'周五下午取货',content_i18n:{zh:'周五下午取货',en:'Pickup Friday afternoon'},status:'active',images:[],profile:{...profile,id:PEER},created_at:'2026-09-16T18:00:00Z',comment_count:1,like_count:0,post_items:[]}
async function setup(page:Page,{anonymous=false,accuracy=30}={}){
 const geo:any[]=[]
 await page.addInitScript(({ref,uid,anonymous,accuracy})=>{
  localStorage.setItem('welcomed','1');localStorage.setItem('lang','en');if(!localStorage.getItem('theme_pref'))localStorage.setItem('theme_pref','light')
  Object.defineProperty(navigator,'permissions',{configurable:true,value:{query:async()=>({state:'granted'})}})
  Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:(success:any)=>success({coords:{latitude:40.110123,longitude:-88.230456,accuracy},timestamp:Date.now()})}})
  if(anonymous)return
  const generation='street-english-test'
  localStorage.setItem(`sb-${ref}-auth-token`,JSON.stringify({tag:'caaci-auth-value-v2',generation,value:JSON.stringify({access_token:'stub',refresh_token:'stub',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid,email:'street@example.invalid',aud:'authenticated',role:'authenticated'}})}))
  localStorage.setItem(`sb-${ref}-auth-token-auth-boundary-v2`,JSON.stringify({v:2,mode:'allowed',generation}))
 },{ref:supabaseRefForBuild(),uid:ME,anonymous,accuracy})
 await page.routeWebSocket(/supabase\.co/,s=>s.close())
 await page.route(url=>url.pathname.startsWith('/api/'),route=>{
  if(new URL(route.request().url()).pathname==='/api/geocode'){
   const req=route.request();geo.push({method:req.method(),url:req.url(),data:req.method()==='POST'?req.postDataJSON():null})
   return route.fulfill({json:{address:{road:'Green Street',city:'Champaign'},verification:req.method()==='POST'?{token:ITEM,location:'Green Street, Champaign',checked_at:new Date().toISOString(),expires_at:new Date(Date.now()+600000).toISOString()}:null}})
  }
  return route.fulfill({json:{flagged:false,categories:[],messages:[],events:[]}})
 })
 await page.route('**/*.supabase.co/**',route=>{
  const req=route.request(),path=new URL(req.url()).pathname,single=(req.headers().accept||'').includes('vnd.pgrst.object')
  const data=path.endsWith('/rpc/get_my_profile')?profile:path.endsWith('/profiles')?[profile]:path.endsWith('/items')?[item]:path.endsWith('/posts')?[post]:path.endsWith('/post_comments')?[{id:COMMENT,post_id:POST,user_id:PEER,content:'可以下午三点吗',content_i18n:{en:'Can we meet at 3 pm?'},status:'active',created_at:post.created_at,profile:post.profile,parent_id:null,like_count:0}]:[]
  return route.fulfill({json:single&&Array.isArray(data)?data[0]??null:data})
 })
 return geo
}
for(const [name,width,height] of [['phone',390,844],['ipad',820,1180],['mac',1920,1080]] as const){
 test(`${name}: fresh street receipt is visible; editing the location removes it`,async({page})=>{
  await page.setViewportSize({width,height});const geo=await setup(page)
  await page.goto('/#/pages/publish/index?listingType=wanted&category=furniture')
  await page.getByRole('button',{name:'Detect current location',exact:true}).click()
  await expect(page.locator('.location-result, .location-guidance[role=status]')).toContainText('Street area checked')
  expect(geo).toHaveLength(1);expect(geo[0].method).toBe('POST');expect(geo[0].url).not.toContain('lat=')
  expect(geo[0].data).toMatchObject({lat:'40.110',lon:'-88.230',accuracy:30})
  await page.getByRole('textbox',{name:'Location',exact:true}).fill('Urbana pickup')
  await expect(page.locator('.location-result, .location-guidance[role=status]')).toContainText('Entered manually')
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)
  expect(overflow).toBe(false)
 })
 test(`${name}: public English post and comments work signed out; Original really shows the source`,async({page})=>{
  await page.setViewportSize({width,height});await setup(page,{anonymous:true})
  await page.goto(`/#/pages/post/index?id=${POST}`)
  await expect(page.locator('.content-wrap .content')).toHaveText('Pickup Friday afternoon')
  await expect(page.getByText('Can we meet at 3 pm?',{exact:true})).toBeVisible()
  await page.locator('.translate-btn').click()
  await expect(page.locator('.content-wrap .content')).toHaveText('周五下午取货')
  await page.locator('.translate-btn').click()
  await expect(page.locator('.content-wrap .content')).toHaveText('Pickup Friday afternoon')
  expect(page.url()).not.toContain('/pages/login/')
  const contentBox=await page.locator('.content-wrap .content').boundingBox()
  const buttonBox=await page.locator('.translate-btn').boundingBox()
  expect(buttonBox!.height).toBeGreaterThanOrEqual(44)
  expect(buttonBox!.y).toBeGreaterThanOrEqual(contentBox!.y+contentBox!.height)
  if(process.env.STREET_VISUAL_DIR){
   await mkdir(process.env.STREET_VISUAL_DIR,{recursive:true})
   await page.screenshot({path:`${process.env.STREET_VISUAL_DIR}/${name}-post-light.png`})
   await page.evaluate(()=>{localStorage.setItem('theme_pref','dark')})
   await page.reload()
   await expect(page.locator('.content-wrap .content')).toHaveText('Pickup Friday afternoon')
   await page.screenshot({path:`${process.env.STREET_VISUAL_DIR}/${name}-post-dark.png`})
  }
 })
}
test('editing an already checked listing retains the correct status until its location changes',async({page})=>{
 await setup(page);await page.goto(`/#/pages/publish/edit?id=${ITEM}`)
 await expect(page.locator('.location-result, .location-guidance[role=status]')).toContainText('checked when this listing was published')
 await page.getByRole('textbox',{name:'Location',exact:true}).fill('Manual other street')
 await expect(page.locator('.location-result, .location-guidance[role=status]')).toContainText('Entered manually')
})
test('a coarse device fix autofills without claiming street verification',async({page})=>{
 const geo=await setup(page,{accuracy:800});await page.goto('/#/pages/publish/index')
 await page.getByRole('button',{name:'Detect current location',exact:true}).click()
 await expect(page.locator('.location-result, .location-guidance[role=status]')).toContainText('Detected')
 await expect(page.locator('.location-result, .location-guidance[role=status]')).not.toContainText('Street area checked')
 expect(geo[0].method).toBe('GET')
})
