import { test, expect, type Page } from '@playwright/test'
import { CURRENT_CONSENT_VERSION } from '../src/legal'
import { supabaseRefForBuild } from './supabase-ref'
import { CAMPUS_LOCATION_TERMS, matchesListingLocation } from '../src/utils/listingLocation'
const auditTheme = process.env.PRODUCT_AUDIT_THEME === 'dark' ? 'dark' : 'light'
test.use({ browserName: process.env.PRODUCT_AUDIT_BROWSER === 'chromium' ? 'chromium' : 'webkit', colorScheme: auditTheme })
const UID='11111111-1111-4111-8111-111111111111', REF=supabaseRefForBuild()
const profile={id:UID,nickname:'Demo student',avatar_url:null,bio:'',tos_version:CURRENT_CONSENT_VERSION,suspension_level:0,suspended_until:null,is_illini_verified:true,location:'UIUC'}
const png=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c636000000200010005fe02fea70000000049454e44ae426082','hex')
const photos=['front','back'].map(n=>`https://${REF}.supabase.co/storage/v1/object/public/item-images/items/${UID}/${n}.png`)
const dims=[{w:640,h:480},{w:480,h:640}]
const base={id:'22222222-2222-4222-8222-000000000001',user_id:UID,title:'Desk lamp warm white',description:'Adjustable desk lamp. Pickup after class.',title_i18n:{en:'Desk lamp warm white'},description_i18n:null,source_lang:'en',price:25,category:'electronics',condition:'good',status:'active',listing_type:'sell',location:'Illini Union',images:photos,image_dimensions:dims,location_verified:false,created_at:'2026-09-05T10:00:00Z',updated_at:'2026-09-05T10:00:00Z',view_count:0,favorite_count:0,negotiable:false,profile}
async function fixture(page:Page, overrides:Record<string,unknown>={}){
 const requests:{url:URL;body:any;method:string}[]=[]
 const rows=[{...base,...overrides},{...base,id:'22222222-2222-4222-8222-000000000002',title:'Desk lamp free',price:0,images:[],location:'伊利尼学生中心'},{...base,id:'22222222-2222-4222-8222-000000000003',title:'Wanted desk lamp',price:0,images:[],listing_type:'wanted'}]
 await page.addInitScript(([ref,uid,theme])=>{localStorage.setItem('welcomed','1');localStorage.setItem('lang','en');localStorage.setItem('theme_pref',theme);const generation='product-publishing-discovery';localStorage.setItem(`sb-${ref}-auth-token`,JSON.stringify({tag:'caaci-auth-value-v2',generation,value:JSON.stringify({access_token:'stub',refresh_token:'stub',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,user:{id:uid,email:'test@example.invalid',aud:'authenticated',role:'authenticated'}})}));localStorage.setItem(`sb-${ref}-auth-token-auth-boundary-v2`,JSON.stringify({v:2,mode:'allowed',generation}));},[REF,UID,auditTheme])
 await page.routeWebSocket(/supabase\.co/,s=>s.close())
 await page.route(url=>url.pathname.startsWith('/api/'),r=>r.fulfill({contentType:'application/json',body:'{"flagged":false,"categories":[]}'}))
 await page.route('**/*.supabase.co/**',async route=>{
  const req=route.request(),url=new URL(req.url()),body=req.postDataJSON();requests.push({url,body,method:req.method()})
  const send=(v:any)=>route.fulfill({contentType:'application/json',body:JSON.stringify(v)})
  if(url.pathname.startsWith('/storage'))return route.fulfill({contentType:'image/png',body:png})
  if(/\/(get_my_profile|get_public_profile)$/.test(url.pathname))return send(profile)
  if(url.pathname==='/rest/v1/profiles')return send(req.headers().accept?.includes('vnd.pgrst.object')?profile:[profile])
  if(url.pathname==='/rest/v1/items'){
   if(['POST','PATCH'].includes(req.method()))return send({...base,...body,updated_at:'2026-09-05T11:00:00Z'})
   let found=rows
   for(const field of ['id','user_id','category','condition','listing_type']){const v=url.searchParams.get(field);if(v?.startsWith('eq.'))found=found.filter(i=>String(i[field as keyof typeof base])===v.slice(3));if(v?.startsWith('neq.'))found=found.filter(i=>String(i[field as keyof typeof base])!==v.slice(4))}
   for(const v of url.searchParams.getAll('price'))if(v.startsWith('lte.'))found=found.filter(i=>i.price<=Number(v.slice(4)))
   const loc=url.searchParams.get('location');if(loc)found=found.filter(i=>i.location.toLowerCase().includes(loc.slice(6).replaceAll('%','').toLowerCase()))
   if(url.searchParams.getAll('or').some(v=>v.includes('location.ilike')))found=found.filter(i=>matchesListingLocation(i.location,'UIUC'))
   return send(req.headers().accept?.includes('vnd.pgrst.object')?found[0]??null:found)
  }
  if(/\/search_items_fuzzy(?:_v2)?$/.test(url.pathname))return send(rows.filter(i=>(!body.listing_type_in||i.listing_type===body.listing_type_in)&&(body.price_max_in==null||i.price<=body.price_max_in)))
  return send([])
 });return requests
}

test('publishing reload restores the latest edits and discarded drafts stay discarded', async ({ page }) => {
 await fixture(page);await page.goto('/#/pages/publish/index')
 const title=page.getByRole('textbox',{name:'Title (required)',exact:true})
 const price=page.getByRole('spinbutton',{name:'Price',exact:true})
 await title.fill('Fall sublease near campus');await price.fill('700')
 await page.locator('.image-tip').click()
 await page.getByRole('button',{name:'Home',exact:true}).click()
 await page.getByText('Save',{exact:true}).click()
 await page.getByRole('button',{name:'Post',exact:true}).click()
 await page.getByText('Keep',{exact:true}).click()
 await expect(title).toHaveValue('Fall sublease near campus')
 await title.fill('Updated rent and move-in dates after class');await price.fill('650')
 await page.reload()
 await page.getByText('Keep',{exact:true}).click()
 await expect(title).toHaveValue('Updated rent and move-in dates after class')
 await expect(price).toHaveValue('650')
 await page.locator('.image-tip').click()
 await page.getByRole('button',{name:'Home',exact:true}).click()
 await page.getByText('Drop',{exact:true}).click()
 await page.getByRole('button',{name:'Post',exact:true}).click()
 await expect(title).toHaveValue('')
 await page.reload()
 await expect(title).toHaveValue('')
 await expect(page.getByText('Restore draft?',{exact:true})).toHaveCount(0)
})
for(const [name,width,height] of [['mac',1440,900],['ipad',820,1180],['phone',390,844],['small-phone',360,800]] as const){
 test(`${name}: publishing preview distinguishes missing price, free and wanted`,async({page})=>{
  await page.setViewportSize({width,height});const requests=await fixture(page);await page.goto('/#/pages/publish/index')
  await page.getByRole('button',{name:'Preview listing',exact:true}).click();await expect(page.locator('.preview-card')).toContainText('Add a price')
  await page.getByRole('textbox',{name:'Title (required)',exact:true}).fill('Desk lamp for a small dorm room')
  await page.getByRole('spinbutton',{name:'Price',exact:true}).fill('0')
  await page.getByRole('button',{name:'Category',exact:true}).click();await page.getByRole('button',{name:'Furniture',exact:true}).click()
  await expect(page.locator('.field-guidance')).toContainText('dimensions');await expect(page.locator('.preview-card')).toContainText('Free')
  await page.getByRole('button',{name:'Wanted',exact:true}).click();await expect(page.locator('.preview-card')).toContainText('Open budget')
  await expect(page.getByRole('button',{name:'Condition',exact:true})).toHaveCount(0);await expect(page.locator('.field-guidance')).toContainText('when you need it')
  expect(requests.filter(r=>r.url.searchParams.get('select')==='price')).toHaveLength(0)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true)
  if(process.env.PRODUCT_AUDIT_CAPTURE)await page.screenshot({path:`../output/product-experience-20260905/${name}-publish-preview.png`,fullPage:true})
 })
}
test('edit cover keeps dimensions aligned and makes no upload',async({page})=>{
 const requests=await fixture(page);await page.goto(`/#/pages/publish/edit?id=${base.id}`)
 await page.getByRole('button',{name:'Use photo 2 as cover',exact:true}).click();await page.getByRole('button',{name:'Preview listing',exact:true}).click()
 await expect(page.locator('.preview-cover img')).toHaveAttribute('src',photos[1])
 await page.getByRole('button',{name:'Save Changes',exact:true}).click()
 await expect.poll(()=>requests.filter(r=>r.method==='PATCH'&&r.url.pathname==='/rest/v1/items').length).toBe(1)
 const edit=requests.find(r=>r.method==='PATCH'&&r.url.pathname==='/rest/v1/items')!.body
 expect(edit.images).toEqual([photos[1],photos[0]]);expect(edit.image_dimensions).toEqual([dims[1],dims[0]])
 expect(requests.filter(r=>r.method==='POST'&&r.url.pathname.startsWith('/storage/'))).toHaveLength(0)
})
test('new listing can choose a cover without deleting other photos',async({page})=>{
 await fixture(page);await page.goto('/#/pages/publish/index');const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Add Photo',exact:true}).click()
 await(await chooser).setFiles([{name:'front.png',mimeType:'image/png',buffer:png},{name:'back.png',mimeType:'image/png',buffer:png}]);await expect(page.locator('.image-item')).toHaveCount(2)
 await expect(page.locator('.preview-image img')).toHaveCount(2)
 const sources=await page.locator('.preview-image img').evaluateAll(els=>els.map(el=>(el as HTMLImageElement).src))
 await page.getByRole('button',{name:'Use photo 2 as cover',exact:true}).click()
 await expect.poll(()=>page.locator('.preview-image img').evaluateAll(els=>els.map(el=>(el as HTMLImageElement).src))).toEqual([sources[1],sources[0]])
})
test('reopened photo drafts explain reattachment instead of showing broken thumbnails',async({page})=>{
 await fixture(page);await page.goto('/#/pages/publish/index')
 const title=page.getByRole('textbox',{name:'Title (required)',exact:true})
 await title.fill('Desk lamp with photos')
 const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Add Photo',exact:true}).click()
 await(await chooser).setFiles([{name:'front.png',mimeType:'image/png',buffer:png}])
 await expect(page.locator('.image-item')).toHaveCount(1)
 await page.reload();await page.getByText('Keep',{exact:true}).click()
 await expect(title).toHaveValue('Desk lamp with photos')
 await expect(page.locator('.image-item')).toHaveCount(0)
 await expect(page.locator('uni-toast')).toContainText('add your photos again')
})
test('zero ceiling reaches browse and search; ignored search sorts are not offered',async({page})=>{
 const requests=await fixture(page);await page.goto('/#/pages/index/index');await expect(page.locator('.waterfall .card').first()).toBeVisible()
 await page.getByRole('button',{name:'Open filters',exact:true}).click();await page.getByRole('spinbutton',{name:'Max',exact:true}).fill('0');await page.getByRole('button',{name:'Apply',exact:true}).click()
 await expect.poll(()=>requests.some(r=>r.url.searchParams.getAll('price').includes('lte.0'))).toBe(true);await expect(page.locator('.afb-chip-label').first()).toHaveText('$0–$0')
 await page.getByRole('button',{name:'Search',exact:true}).click();await page.getByRole('searchbox').fill('desk');await page.getByRole('searchbox').press('Enter')
 await expect.poll(()=>requests.some(r=>r.body?.price_max_in===0)).toBe(true)
 await page.getByRole('button',{name:'Open filters',exact:true}).click();await expect(page.locator('.search-sort-note')).toContainText('Most relevant');await expect(page.getByRole('button',{name:'Price ↑',exact:true})).toHaveCount(0)
})
test('campus filter is bilingual and wanted clears an impossible condition',async({page})=>{
 const requests=await fixture(page);await page.goto('/#/pages/index/index');await page.getByRole('button',{name:'Open filters',exact:true}).click();await page.getByRole('button',{name:'UIUC',exact:true}).click();await page.getByRole('button',{name:'Apply',exact:true}).click()
 await expect.poll(()=>requests.some(r=>r.url.searchParams.getAll('or').some(v=>v.includes('伊利尼学生中心')))).toBe(true)
 const campus=requests.find(r=>r.url.searchParams.getAll('or').some(v=>v.includes('伊利尼学生中心')))!
 for(const term of CAMPUS_LOCATION_TERMS)expect(campus.url.searchParams.get('or')).toContain(term)
 await expect(page.locator('.card-pickup-label').first()).toContainText('Illini Union')
 await page.getByRole('button',{name:'Open filters',exact:true}).click();await page.getByRole('button',{name:'Brand New',exact:true}).click();await page.getByRole('button',{name:'Apply',exact:true}).click()
 await expect(page.locator('.empty-title')).toContainText('No matches');await expect(page.locator('.empty-btn')).toContainText('Clear')
 await page.getByRole('tab',{name:'Wanted',exact:true}).click()
 await expect.poll(()=>requests.filter(r=>r.url.pathname==='/rest/v1/items').at(-1)?.url.searchParams.get('listing_type')).toBe('eq.wanted')
 expect(requests.filter(r=>r.url.pathname==='/rest/v1/items').at(-1)!.url.searchParams.has('condition')).toBe(false)
 await page.getByRole('button',{name:'Open filters',exact:true}).click();await expect(page.getByRole('button',{name:'Brand New',exact:true})).toHaveCount(0)
})

for (const [width,height] of [[390,844],[820,1180],[1440,900],[1440,1400]]) {
 test(`text-only detail at ${width}x${height} keeps title and description near the top`,async({page})=>{
  await page.setViewportSize({width,height});await fixture(page)
  await page.goto('/#/pages/detail/index?id=22222222-2222-4222-8222-000000000002')
  await expect(page.locator('.page.text-only')).toBeVisible()
  expect((await page.locator('.img-swiper').boundingBox())!.height).toBeLessThanOrEqual(130)
  expect((await page.locator('.info-card').boundingBox())!.y).toBeLessThan(170)
  await expect(page.getByRole('region',{name:'Preview image'})).toHaveCount(0)
 })
}

const housing={kind:'housing',available_from:'2026-09-15',available_to:'2026-12-31',price_unit:'month',room_type:'private'}
const ride={kind:'rideshare',origin:'Illini Union',destination:'Chicago ORD',departure_date:'2026-09-15',departure_time:'14:30',seats:3,price_unit:'person',time_zone:'America/Chicago'}
async function chooseDate(page:Page,label:string,date:string){
 const control=page.getByRole('button',{name:label,exact:true})
 const native=page.locator('uni-picker').filter({has:control}).locator('input[type="date"]')
 if(await native.count()){await native.fill(date);return date}
 await control.click()
 await page.locator('.uni-picker-toggle .uni-picker-action-confirm').click()
 return (await page.getByRole('button',{name:label,exact:true}).innerText()).trim()
}
for(const [name,width,height,mobile] of [['mac',1440,900,false],['ipad',820,1180,true],['phone',390,844,true]] as const){
 test.describe(`category details ${name}`,()=>{
  test.use({viewport:{width,height},isMobile:mobile,hasTouch:mobile,userAgent:mobile?'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15'})
  test('new housing validates, previews and sends explicit details',async({page})=>{
   await page.clock.setFixedTime(new Date('2026-09-15T17:00:00Z'))
   const requests=await fixture(page);await page.goto('/#/pages/publish/index')
   await page.getByRole('textbox',{name:'Title (required)',exact:true}).fill('Private room near campus')
   await page.getByRole('spinbutton',{name:'Price',exact:true}).fill('700')
   await page.getByRole('button',{name:'Category',exact:true}).click();await page.getByRole('button',{name:'Housing',exact:true}).click()
   await expect(page.getByRole('button',{name:'Condition',exact:true})).toHaveCount(0)
   await page.getByRole('button',{name:'Post Item',exact:true}).click()
   await expect(page.locator('uni-toast')).toContainText('dates')
   expect(requests.filter(r=>r.method==='POST'&&r.url.pathname==='/rest/v1/items')).toHaveLength(0)
   const start=await chooseDate(page,'Available from','2026-09-15'),end=await chooseDate(page,'Available until','2026-12-31')
   await page.getByRole('button',{name:'Per month',exact:true}).press('Enter');await page.getByRole('button',{name:'Private room',exact:true}).click()
   await page.getByRole('button',{name:'Preview listing',exact:true}).click()
   await expect(page.locator('.preview-price')).toHaveText('$700/month');await expect(page.locator('.listing-details-summary')).toContainText(start)
   await page.getByRole('button',{name:'Post Item',exact:true}).click()
   await expect.poll(()=>requests.filter(r=>r.method==='POST'&&r.url.pathname==='/rest/v1/items').length).toBe(1)
   expect(requests.find(r=>r.method==='POST'&&r.url.pathname==='/rest/v1/items')!.body.listing_details).toEqual({...housing,available_from:start,available_to:end})
  })
  test('ride editing preserves route facts and rejects invalid seats',async({page})=>{
   const requests=await fixture(page,{category:'rideshare',price:35,listing_details:ride});await page.goto(`/#/pages/publish/edit?id=${base.id}`)
   await expect(page.getByRole('textbox',{name:'From',exact:true})).toHaveValue('Illini Union')
   await page.getByRole('button',{name:'Preview listing',exact:true}).click();await expect(page.locator('.preview-price')).toHaveText('$35/person')
   await expect(page.locator('.listing-details-summary')).toContainText('Chicago ORD')
   await page.getByRole('spinbutton',{name:'Available seats',exact:true}).fill('9');await page.getByRole('heading',{name:'Edit Item',exact:true}).click();await page.getByRole('button',{name:'Save Changes',exact:true}).click()
   await expect(page.locator('uni-toast')).toContainText('1');expect(requests.filter(r=>r.method==='PATCH')).toHaveLength(0)
   await page.getByRole('spinbutton',{name:'Available seats',exact:true}).fill('2');await page.getByRole('heading',{name:'Edit Item',exact:true}).click();await page.getByRole('button',{name:'Save Changes',exact:true}).click()
   await expect.poll(()=>requests.filter(r=>r.method==='PATCH').length).toBe(1)
   expect(requests.find(r=>r.method==='PATCH')!.body.listing_details).toEqual({...ride,seats:2})
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
  })
  test('legacy housing price edit never invents dates or a price unit',async({page})=>{
   const requests=await fixture(page,{category:'housing',price:700,listing_details:null});await page.goto(`/#/pages/publish/edit?id=${base.id}`)
   await expect(page.locator('.category-note')).toContainText('older listing')
   await page.getByRole('spinbutton',{name:'Price',exact:true}).fill('650');await page.getByRole('heading',{name:'Edit Item',exact:true}).click();await page.getByRole('button',{name:'Save Changes',exact:true}).click()
   await expect.poll(()=>requests.filter(r=>r.method==='PATCH').length).toBe(1);expect(requests.find(r=>r.method==='PATCH')!.body.listing_details).toBeNull()
  })
 test('sold rides keep a readable status and do not advertise available seats',async({page})=>{
   await fixture(page,{category:'rideshare',title:'Campus to Chicago ORD',title_i18n:null,price:35,status:'sold',images:[],listing_details:ride});await page.goto(`/#/pages/detail/index?id=${base.id}`)
   await expect(page.locator('.listing-details-summary')).toContainText('Seats: 3')
   await expect(page.locator('.listing-details-summary')).not.toContainText('Available seats')
   await expect(page.locator('.sold-stamp')).toHaveText('Sold')
   const colors=await page.locator('.sold-stamp').evaluate(el=>{const s=getComputedStyle(el);return {fg:s.color,bg:s.backgroundColor}})
   const rgba=(s:string)=>s.match(/[\d.]+/g)!.map(Number)
   const fg=rgba(colors.fg), bg=rgba(colors.bg), alpha=bg[3]??1
   // A white photo is the lightest possible backdrop; the stamp must still read.
   const backdrop=bg.slice(0,3).map(c=>c*alpha+255*(1-alpha))
   const luminance=(cs:number[])=>cs.slice(0,3).map(c=>{const v=c/255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4}).reduce((sum,c,i)=>sum+c*[0.2126,0.7152,0.0722][i],0)
   const a=luminance(fg),b=luminance(backdrop)
   expect((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)).toBeGreaterThanOrEqual(4.5)
   if(process.env.PRODUCT_AUDIT_CAPTURE)await page.screenshot({path:`../output/release-candidate-20260905/${name}-sold-ride-${auditTheme}.png`,fullPage:true})
  })
  test('housing and ride details remain readable without horizontal overflow',async({page})=>{
   await fixture(page,{category:'rideshare',price:35,images:[],listing_details:ride});await page.goto(`/#/pages/detail/index?id=${base.id}`)
   await expect(page.locator('.listing-details-summary')).toContainText('Illini Union → Chicago ORD');await expect(page.locator('.price-row .price')).toContainText('/person')
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
   const box=await page.locator('.listing-details-summary').boundingBox();expect(box!.width).toBeGreaterThan(150)
   if(process.env.PRODUCT_AUDIT_CAPTURE)await page.screenshot({path:`../output/release-candidate-20260905/${name}-ride-detail-${auditTheme}.png`,fullPage:true})
  })
 })
}

test.describe('category search controls',()=>{
 test.use({viewport:{width:1440,height:900},isMobile:false,hasTouch:false})
 test('date and rent unit reach browse/search and clear on category change',async({page})=>{
  const requests=await fixture(page,{category:'housing',price:700,listing_details:housing});await page.goto('/#/pages/index/index')
  await page.getByRole('button',{name:'转租 · Housing',exact:true}).click()
  await page.getByRole('button',{name:'Open filters',exact:true}).click()
  const date=await chooseDate(page,'Date needed','2026-09-15')
  await page.getByRole('button',{name:'Per month',exact:true}).click();await page.getByRole('button',{name:'Apply',exact:true}).click()
  await expect.poll(()=>requests.some(r=>r.url.searchParams.get('listing_details->>available_from')===`lte.${date}`&&r.url.searchParams.get('listing_details->>price_unit')==='eq.month')).toBe(true)
  await page.getByRole('button',{name:'Search',exact:true}).click();await page.getByRole('searchbox').fill('room');await page.getByRole('searchbox').press('Enter')
  await expect.poll(()=>requests.some(r=>r.body?.detail_date_in===date&&r.body?.price_unit_in==='month')).toBe(true)
  await page.getByRole('button',{name:'家具 · Furniture',exact:true}).click()
  await expect.poll(()=>requests.filter(r=>r.url.pathname.endsWith('search_items_fuzzy_v2')).at(-1)?.body.category_in).toBe('furniture')
  const query=requests.filter(r=>r.url.pathname.endsWith('search_items_fuzzy_v2')).at(-1)!.body;expect(query.detail_date_in).toBeNull();expect(query.price_unit_in).toBeNull()
 })
})
