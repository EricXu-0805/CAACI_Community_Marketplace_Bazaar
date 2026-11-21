import { test, expect } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { identity, requireResult, signOutIdentities } from './probe-data.mjs'
import { login, moderateOnly, navigate, uiLogout } from './probe-ui'

test('remove remaining P1.12 public fixture through its owner delete entry', async ({ page }) => {
  const path = `${process.env.EV}/residuals.json`
  const residuals = JSON.parse(await readFile(path, 'utf8'))
  let loggedIn = false
  let failed = false
  try {
    const b = await identity('B')
    const pending = requireResult(await b.db.from('posts').select('id').eq('user_id', b.id)
      .like('content', '[SYN-P1.12]%'), 'cleanup_post_inventory')
    for (const post of pending) {
      if (!residuals.posts.some(row => row.id === post.id)) residuals.posts.push({ id: post.id, owner: 'B', cleanup: 'pending' })
    }
    await page.addInitScript(() => { try { localStorage.setItem('welcomed', '1') } catch {} })
    await moderateOnly(page)
    await page.goto('/#/pages/login/index')
    await login(page, 'B')
    loggedIn = true
    for (const post of residuals.posts) {
      await navigate(page, `/pages/post/index?id=${post.id}`)
      await expect(page.locator('.more-btn')).toBeVisible()
      const deletion = page.waitForResponse(r => r.request().method() === 'DELETE' && r.url().includes('/rest/v1/posts'), { timeout: 15_000 })
      await page.locator('.more-btn').click()
      await page.locator('.uni-modal__btn_primary').click()
      const response = await deletion
      console.log(JSON.stringify({ action: 'cleanup_post_delete', status: response.status() }))
      expect(response.ok()).toBe(true)
      const remaining = requireResult(await b.db.from('posts').select('id').eq('id', post.id), 'cleanup_post_remaining')
      expect(remaining).toHaveLength(0)
      await expect(page).toHaveURL(/#\/(?:pages\/index\/index)?$/)
    }
    const remaining = requireResult(await b.db.from('posts').select('id').eq('user_id', b.id)
      .like('content', '[SYN-P1.12]%'), 'cleanup_all_posts_remaining')
    expect(remaining).toHaveLength(0)
    const deleted = residuals.posts.map(post => post.id)
    residuals.posts = []
    await writeFile(path, JSON.stringify(residuals, null, 2))
    await writeFile(`${process.env.EV}/cleanup.json`, JSON.stringify({
      deletedPosts: deleted, retainedMessages: residuals.messages, reason: 'No product message deletion entry.',
    }, null, 2))
  } catch {
    failed = true
    throw new Error('P1_12_owner_cleanup_failed')
  } finally {
    if (loggedIn) await uiLogout(page, 'B')
    if (failed) await page.setContent('<p>Cleanup failed; credential fields removed.</p>')
    await signOutIdentities()
  }
})
