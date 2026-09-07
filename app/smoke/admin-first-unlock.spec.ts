import { test, expect, type Page } from '@playwright/test'

const token = `iam_admin_${'a'.repeat(43)}`
async function mockAdmin(page: Page, failure: false | 'storage' | 'lock' = false) {
  await page.addInitScript(fail => {
    localStorage.setItem('welcomed','1')
    localStorage.setItem('lang','en')
    if (fail === 'storage') {
      const original = Storage.prototype.getItem
      let failNextJournalRead = true
      Storage.prototype.getItem = function(key) {
        if(key === 'caaci.admin-idempotency-journal.v1' && failNextJournalRead) {
          failNextJournalRead = false
          throw new Error('storage temporarily unavailable')
        }
        return original.call(this,key)
      }
    }
    if (fail === 'lock') {
      const original = navigator.locks.request.bind(navigator.locks)
      let failNextLock = true
      Object.defineProperty(navigator,'locks',{value:{request(...args: any[]) {
        if(failNextLock && args[0] === 'caaci.admin-idempotency-journal.v1.request-lock') {
          failNextLock=false
          return Promise.reject(new Error('lock unavailable'))
        }
        return (original as any)(...args)
      }}})
    }
  }, failure)
  await page.routeWebSocket(/supabase\.co/, socket => socket.close())
  await page.route('**/*.supabase.co/**', route => route.fulfill({contentType:'application/json',body:'[]'}))
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const resource = new URL(route.request().url()).searchParams.get('resource')
    let data: unknown = []
    if(resource === 'whoami') data = {
      admin_id:'11111111-1111-4111-8111-111111111111',
      token_id:'22222222-2222-4222-8222-222222222222',
      admin_name:'Test moderator',admin_email:'moderator@example.invalid',role:'operator',
      source:'token',expires_at:null,server_now:new Date().toISOString(),
      capabilities:['apply_ban','decide_appeal','lift_suspension','resolve_target_reports','takedown_content','update_report_status'],
    }
    if(resource === 'stats') data={active_suspensions:0,pending_reports:0,pending_appeals:0,shadow_banned:0,oldest_pending_hours:null}
    await route.fulfill({contentType:'application/json',body:JSON.stringify({data})})
  })
  await page.goto('/#/pages/admin/index')
  await page.getByRole('textbox',{name:'Enter personal admin token'}).fill(token)
  await page.getByRole('button',{name:'Unlock',exact:true}).click()
  if(failure !== 'storage') {
    await expect(page.getByRole('tab',{name:'Reports',exact:true})).toBeVisible()
    await expect(page.getByText('No reports to show.',{exact:true})).toBeVisible()
  }
}

test('first moderator unlock has no false recovery barrier and reload clears the token',async({page})=>{
  await mockAdmin(page)
  await expect(page.getByText('Admin writes are safely paused',{exact:true})).toHaveCount(0)
  await expect(page.getByRole('tab',{name:'Tokens',exact:true})).toHaveCount(0)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
  await page.getByRole('tab',{name:'Audit log',exact:true}).click()
  await expect(page.getByRole('tab',{name:'Audit log',exact:true})).toHaveAttribute('aria-selected','true')
  await page.reload()
  await expect(page.getByRole('textbox',{name:'Enter personal admin token'})).toHaveValue('')
  await expect(page.getByRole('button',{name:'Unlock',exact:true})).toBeDisabled()
})

test('temporary lock failure keeps writes blocked and exposes a working recovery action',async({page})=>{
  await mockAdmin(page,'lock')
  await expect(page.getByText('Admin writes are safely paused',{exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Check outcomes again',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Check outcomes again',exact:true}).click()
  await expect(page.getByText('Admin writes are safely paused',{exact:true})).toHaveCount(0)
})

test('unreadable journal signs out rather than treating failed storage as an empty history',async({page})=>{
  await mockAdmin(page,'storage')
  // Wait for the failed read and mandatory sign-out, not the transient gate.
  await expect(page.locator('uni-toast')).toBeVisible()
  await expect(page.getByRole('textbox',{name:'Enter personal admin token'})).toHaveValue('')
  await expect(page.getByRole('tab',{name:'Reports',exact:true})).toHaveCount(0)
  await page.getByRole('textbox',{name:'Enter personal admin token'}).fill(token)
  await page.getByRole('button',{name:'Unlock',exact:true}).click()
  await expect(page.getByText('No reports to show.',{exact:true})).toBeVisible()
  await expect(page.getByText('Admin writes are safely paused',{exact:true})).toHaveCount(0)
})
