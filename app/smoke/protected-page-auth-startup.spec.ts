import { test, expect } from '@playwright/test'
import { supabaseRefForBuild } from './supabase-ref'

test.use({ browserName: process.env.UI_AUDIT_BROWSER === 'chromium' ? 'chromium' : 'webkit' })

for(const [journey,path] of [
  ['publishing','/#/pages/publish/index'],
  ['editing','/#/pages/publish/edit?id=22222222-2222-4222-8222-222222222222'],
  ['profile editing','/#/pages/profile/edit'],
] as const) test(`${journey} redirects to login when an expired session settles after the page opens`, async ({ page }) => {
  let refreshStarted=false
  let listingReads=0
  let release!:()=>void
  const refreshGate=new Promise<void>(resolve=>{release=resolve})
  await page.addInitScript(ref=>{
    localStorage.setItem('welcomed','1');localStorage.setItem('lang','en')
    const generation='publish-expired-startup-fixture'
    localStorage.setItem(`sb-${ref}-auth-token`,JSON.stringify({tag:'caaci-auth-value-v2',generation,
      value:JSON.stringify({access_token:'expired-fixture',refresh_token:'expired-fixture',token_type:'bearer',
        expires_at:Math.floor(Date.now()/1000)-3600,user:{id:'11111111-1111-4111-8111-111111111111',role:'authenticated',email:'fixture@example.invalid'}})}))
    localStorage.setItem(`sb-${ref}-auth-token-auth-boundary-v2`,JSON.stringify({v:2,mode:'allowed',generation}))
  },supabaseRefForBuild())
  await page.routeWebSocket(/supabase\.co/,socket=>socket.close())
  await page.route(url=>url.pathname.startsWith('/api/'),route=>route.fulfill({contentType:'application/json',body:'{}'}))
  await page.route('**/*.supabase.co/**',async route=>{
    if(new URL(route.request().url()).pathname.endsWith('/items')) listingReads++
    if(new URL(route.request().url()).pathname.endsWith('/auth/v1/token')){
      refreshStarted=true
      await refreshGate
      return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'invalid_grant',error_code:'refresh_token_not_found',msg:'Refresh token not found'})})
    }
    return route.fulfill({contentType:'application/json',body:'[]'})
  })
  try{
    await page.goto(path)
    await expect.poll(()=>refreshStarted).toBe(true)
    await expect(page.getByText('Please wait...', {exact:true})).toBeVisible()
    release()
    await expect(page.getByRole('textbox',{name:'Email',exact:true})).toBeVisible({timeout:5000})
    await expect(page).toHaveURL(/pages\/login\/index/)
    if(journey!=='profile editing') await expect(page).toHaveURL(/pages\/login\/index\?intent=/)
    await expect(page.getByText('Please wait...', {exact:true})).toHaveCount(0)
    await expect(page.getByRole('textbox',{name:'Title (required)',exact:true})).toHaveCount(0)
    expect(listingReads).toBe(0)
  }finally{release()}
})
