import {test,expect,type Page} from '@playwright/test'
import {supabaseRefForBuild} from './supabase-ref'
test.use({browserName:'webkit'})
const owner='11111111-1111-4111-8111-111111111111',person='22222222-2222-4222-8222-222222222222',postId='33333333-3333-4333-8333-333333333333',reportId='44444444-4444-4444-8444-444444444444'
const time='2026-09-16T12:00:00Z'
async function setup(page:Page){
 await page.addInitScript(()=>{localStorage.setItem('welcomed','1');localStorage.setItem('lang','en')})
 await page.routeWebSocket(/supabase\.co/,s=>s.close())
 await page.route('**/*.supabase.co/**',r=>r.fulfill({json:[]}))
 const writes:any[]=[]
 let groups:any[]=[{target_type:'post',target_id:postId,report_count:2,pending_count:2,reporter_count:2,last_reason:'Spam',last_note:'Synthetic report',last_reporter_nickname:'Test reporter',last_status:'pending',first_created_at:time,last_created_at:time,last_report_id:reportId}]
 let post={id:postId,content:'Synthetic campus update',author_nickname:'Test publisher',author_id:person,is_pinned:false,is_official:false,like_count:2,comment_count:1,thumbnail:null,created_at:time}
 let banner={id:reportId,image_url:`https://${supabaseRefForBuild()}.supabase.co/storage/v1/object/public/item-images/banners/test.png`,target_url:null,title:null,title_en:'Campus',title_zh:null,priority:1,active:true,is_default:false,start_at:null,end_at:null,created_at:time}
 await page.route(url=>url.pathname.startsWith('/api/'),r=>{
  const req=r.request(),resource=new URL(req.url()).searchParams.get('resource')
  if(req.method()==='POST'){
   const body=req.postDataJSON();writes.push({...body,key:req.headers()['idempotency-key']})
   if(body.action==='resolve_target_reports')groups=[]
   if(body.action==='set_post_pinned')post={...post,is_pinned:body.pinned}
   if(body.action==='upsert_banner'){const {action,...fields}=body;banner={...banner,...fields}}
   return r.fulfill({json:{ok:true,data:person}})
  }
  const data=resource==='whoami'?{admin_id:owner,token_id:person,admin_name:'Test owner',admin_email:'owner@example.invalid',role:'owner',source:'token',expires_at:null,server_now:new Date().toISOString(),capabilities:['apply_ban','resolve_target_reports','set_post_pinned','upsert_banner','delete_banner']}
   :resource==='stats'?{active_suspensions:0,pending_reports:groups.length?2:0,pending_appeals:0,shadow_banned:0,oldest_pending_hours:null}
   :resource==='reports_grouped'?groups:resource==='plaza_posts'?[post]:resource==='banners'?[banner]
   :resource==='search_users'?[{id:person,nickname:'Synthetic user',email:'synthetic@example.invalid',avatar_url:null,trust_score:90,warning_count:0,suspension_level:0,suspended_until:null,shadow_banned:false,created_at:time}]:[]
  return r.fulfill({json:{data}})
 })
 await page.goto('/#/pages/admin/index');await page.getByRole('textbox',{name:'Enter personal admin token'}).fill(`iam_admin_${'a'.repeat(43)}`);await page.getByRole('button',{name:'Unlock',exact:true}).click()
 await expect(page.getByRole('tab',{name:'Reports',exact:true})).toBeVisible()
 return writes
}
test('owner resolves synthetic reports, pins/unpins a post and edits a banner with durable request IDs',async({page})=>{
 const writes=await setup(page)
 await page.getByRole('button',{name:'Resolve all',exact:true}).click();await page.locator('.uni-modal__btn_primary').click()
 await expect(page.getByText('No reports to show.',{exact:true})).toBeVisible()
 expect(writes[0]).toMatchObject({action:'resolve_target_reports',target_type:'post',target_id:postId,status:'resolved'})
 await page.getByRole('tab',{name:'Community',exact:true}).click()
 await page.getByRole('button',{name:'Pin',exact:true}).click();await page.locator('.uni-modal__btn_primary').click()
 await expect(page.getByRole('button',{name:'Unpin',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Unpin',exact:true}).click();await page.locator('.uni-modal__btn_primary').click()
 await expect(page.getByRole('button',{name:'Pin',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Edit',exact:true}).click()
 await page.getByRole('textbox',{name:'Title (English, optional)',exact:true}).fill('A new campus update')
 await page.getByRole('button',{name:'Save',exact:true}).click()
 await expect(page.locator('.banner-head-info .card-title').filter({hasText:'A new campus update'})).toBeVisible()
 expect(writes.filter(w=>w.action==='set_post_pinned').map(w=>w.pinned)).toEqual([true,false])
 expect(writes.every(w=>typeof w.key==='string'&&w.key.length>10)).toBe(true)
})
test('moderation confirms exact synthetic user, level and reason before applying a suspension',async({page})=>{
 const writes=await setup(page);await page.getByRole('tab',{name:'Users',exact:true}).click()
 await page.getByRole('searchbox',{name:'Search by nickname, email, or user ID'}).fill('Synthetic')
 await page.getByRole('button',{name:'Search',exact:true}).click()
 await page.getByRole('button',{name:'Apply ban',exact:true}).click()
 await page.locator('.uni-actionsheet__cell').filter({hasText:'L2: 72 hour suspension'}).click()
 await expect(page.getByRole('dialog',{name:'Ban this user?'})).toContainText(person)
 await expect(page.getByRole('dialog',{name:'Ban this user?'})).toContainText('L2: 72 hour suspension')
 await expect(page.locator('#admin-reason-input textarea')).toHaveValue('')
 await page.getByRole('button',{name:'Confirm action',exact:true}).click()
 expect(writes.filter(w=>w.action==='apply_ban')).toHaveLength(0)
 await page.locator('#admin-reason-input textarea').fill('Synthetic moderation acceptance test')
 await page.getByRole('button',{name:'Confirm action',exact:true}).click()
 await expect.poll(()=>writes.filter(w=>w.action==='apply_ban').length).toBe(1)
 expect(writes.find(w=>w.action==='apply_ban')).toMatchObject({target_id:person,level:2,reason:'Synthetic moderation acceptance test',category:'admin'})
 await expect(page.locator('.uni-toast__content')).toHaveText('Ban applied')
})
test('cancelled moderation preserves the account and clears the previous reason',async({page})=>{
 const writes=await setup(page);await page.getByRole('tab',{name:'Users',exact:true}).click()
 await page.getByRole('searchbox',{name:'Search by nickname, email, or user ID'}).fill('Synthetic')
 await page.getByRole('button',{name:'Search',exact:true}).click()
 await page.getByRole('button',{name:'Apply ban',exact:true}).click()
 await page.locator('.uni-actionsheet__cell').filter({hasText:'L2: 72 hour suspension'}).click()
 const dialog=page.getByRole('dialog',{name:'Ban this user?'})
 await expect(dialog).toBeFocused()
 await page.keyboard.press('Tab');await expect(page.locator('#admin-reason-input textarea')).toBeFocused()
 await page.locator('#admin-reason-input textarea').fill('Unsubmitted draft reason')
 await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible()
 expect(writes).toHaveLength(0)
 await page.getByRole('button',{name:'Apply ban',exact:true}).click()
 await page.locator('.uni-actionsheet__cell').filter({hasText:'L2: 72 hour suspension'}).click()
 await expect(page.locator('#admin-reason-input textarea')).toHaveValue('')
 await page.getByRole('button',{name:'Cancel',exact:true}).click()
 expect(writes).toHaveLength(0)
})
