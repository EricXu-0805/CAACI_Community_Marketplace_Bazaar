import { test, expect, type Page } from '@playwright/test'

test.use({ browserName: process.env.UI_AUDIT_BROWSER === 'chromium' ? 'chromium' : 'webkit' })
const home = /#\/(pages\/index\/index)?$/

async function anonymous(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', 'en')
  })
  await page.routeWebSocket(/supabase\.co/, socket => socket.close())
  await page.route('**/*.supabase.co/**', route => route.fulfill({ contentType:'application/json', body:'[]' }))
  await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({ contentType:'application/json', body:'{}' }))
}

test('cancel publishing login returns to browsing without a loop', async ({ page }) => {
  await anonymous(page)
  await page.goto('/#/pages/index/index')
  await page.getByRole('button', {name:'Post', exact:true}).click()
  await expect(page.getByRole('textbox',{name:'Email',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Go back',exact:true}).click()
  await expect(page).toHaveURL(home, {timeout:5000})
  await expect(page.getByRole('button',{name:'Search',exact:true})).toBeVisible()
  // Reopening a protected tab must require login again, rather than expose it.
  await page.getByRole('button',{name:'Post',exact:true}).click()
  await expect(page.getByRole('textbox',{name:'Email',exact:true})).toBeVisible()
})

for (const cancel of ['button','browser'] as const) for (const [name,target] of [
  ['listing edit','/pages/publish/edit?id=22222222-2222-4222-8222-222222222222'],
  ['profile edit','/pages/profile/edit'],
] as const) test(`cancel ${name} login by ${cancel} returns to the preceding public page`,async({page})=>{
  await anonymous(page)
  await page.goto('/#/pages/index/index')
  await expect(page.getByRole('button',{name:'Search',exact:true})).toBeVisible()
  // Use the browser route entry: compiled builds do not expose window.uni.
  await page.evaluate(url=>{ window.location.hash = url },target)
  await expect(page.getByRole('textbox',{name:'Email',exact:true})).toBeVisible()
  if(cancel==='button') await page.getByRole('button',{name:'Go back',exact:true}).click()
  else await page.goBack()
  await expect(page).toHaveURL(home,{timeout:5000})
  await expect(page.getByRole('button',{name:'Search',exact:true})).toBeVisible()
})

test('cancel login from a public account tab preserves that tab',async({page})=>{
  await anonymous(page)
  await page.goto('/#/pages/profile/index')
  await page.getByRole('button',{name:'Sign In',exact:true}).click()
  await expect(page.getByRole('textbox',{name:'Email',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Go back',exact:true}).click()
  await expect(page).toHaveURL(/pages\/profile\/index$/)
  await expect(page.getByRole('button',{name:'Sign In',exact:true})).toBeVisible()
})
