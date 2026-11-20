import { test, expect } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { client, identity, requireResult, signOutIdentities } from './probe-data.mjs'
import { login, moderateOnly, navigate, uiLogout } from './probe-ui'

for (const owner of ['A', 'B']) {
  test(`cleanup synthetic ${owner} content through owner UI`, async ({ page }) => {
    const path = `${process.env.EV}/fixtures.json`
    const fixtures = JSON.parse(await readFile(path, 'utf8'))
    const residuals: unknown[] = []
    let cleanupPhase = 'login'
    let loggedIn = false
    let failed = false
    try {
      const user = await identity(owner)
      await moderateOnly(page)
      await page.goto('/#/pages/login/index')
      await login(page, owner)
      loggedIn = true
      for (const post of fixtures.posts.filter(p => p.owner === owner && !p.deleted)) {
        await navigate(page, `/pages/post/index?id=${post.id}`)
        await expect(page.locator('.more-btn')).toBeVisible()
        const deletion = page.waitForResponse(r => r.request().method() === 'DELETE' && r.url().includes('/rest/v1/posts'))
        await page.locator('.more-btn').click()
        await page.locator('.uni-modal__btn_primary').click()
        expect((await deletion).ok()).toBe(true)
        const anon = client()
        const list = requireResult(await anon.from('posts').select('id').eq('id', post.id), 'anonymous_list_after_delete')
        const search = requireResult(await anon.rpc('search_community_posts', { terms_in: [post.title], limit_in: 100 }), 'anonymous_search_after_delete')
        expect(list).toHaveLength(0)
        expect(search.some(p => p.id === post.id)).toBe(false)
        post.deleted = true
        await writeFile(path, JSON.stringify(fixtures, null, 2))
        console.log(JSON.stringify({ action: 'deleted_post_anonymous_hits', list: list.length, search: search.filter(p => p.id === post.id).length }))
        // The product schedules goBack after its deletion toast. Let it
        // finish before opening the next owner cleanup surface.
        await expect(page).toHaveURL(/#\/(?:pages\/index\/index)?$/)
      }
      const notifications = (fixtures.notifications || []).filter(row => row.owner === owner && !row.deleted)
      if (notifications.length) {
        cleanupPhase = 'notifications'
        await navigate(page, '/pages/notifications/index')
        for (const notification of notifications) {
          const ordered = requireResult(await user.db.from('notifications').select('id')
            .eq('user_id', user.id).order('created_at', { ascending: false })
            .order('id', { ascending: false }).limit(50), 'owner_notification_order')
          await expect(page.locator('.notif-item')).toHaveCount(ordered.length)
          const index = ordered.findIndex(row => row.id === notification.id)
          expect(index).toBeGreaterThanOrEqual(0)
          await page.locator('.notif-item').nth(index).press('Delete')
          const deletion = page.waitForResponse(r => r.request().method() === 'DELETE'
            && r.url().includes('/rest/v1/notifications')
            && new URL(r.url()).searchParams.get('id') === `eq.${notification.id}`, { timeout: 15_000 })
          await page.locator('.uni-actionsheet__cell').filter({ hasText: /^(Delete|删除)$/ }).click()
          expect((await deletion).ok()).toBe(true)
          notification.deleted = true
          await writeFile(path, JSON.stringify(fixtures, null, 2))
          await expect(page.locator('.notif-item')).toHaveCount(ordered.length - 1)
        }
      }
      cleanupPhase = 'items'
      await navigate(page, '/pages/profile/index', true)
      for (const item of fixtures.items.filter(p => p.owner === owner && !p.deleted)) {
        if (item.sold) {
          residuals.push({ id: item.id, owner, reason: 'Sold listings have no product deletion entry and are terminal; retained per RUNBOOK 5.2.' })
          continue
        }
        await expect(page.locator('.horz-card').filter({ hasText: item.title })).toBeVisible()
        const card = page.locator('.horz-card').filter({ hasText: item.title })
        await card.locator('.horz-more').click()
        await page.locator('.uni-actionsheet__cell').filter({ hasText: /^(Delete|删除)$/ }).click()
        const deletion = page.waitForResponse(r => r.request().method() === 'DELETE' && r.url().includes('/rest/v1/items'))
        await page.locator('.uni-modal__btn_primary').click()
        expect((await deletion).ok()).toBe(true)
        item.deleted = true
        await writeFile(path, JSON.stringify(fixtures, null, 2))
        await expect(card).toHaveCount(0)
      }
      await writeFile(`${process.env.EV}/residuals-${owner}.json`, JSON.stringify(residuals, null, 2))
    } catch (error: any) {
      failed = true
      console.log(JSON.stringify({ action: 'cleanup_failure_counts', owner, phase: cleanupPhase,
        notificationRows: await page.locator('.notif-item').count(),
        strictSelector: Number(String(error?.message).includes('strict mode violation')),
        ...await page.evaluate(() => ({ notificationRoute: Number(location.hash.includes('/pages/notifications/index')) })) }))
      throw new Error(`synthetic_${owner}_cleanup_failed`)
    } finally {
      if (loggedIn) await uiLogout(page, owner)
      if (failed) await page.setContent('<p>Acceptance failed; credential fields removed.</p>')
      await signOutIdentities()
    }
  })
}
