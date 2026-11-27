import { test, expect } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { CURRENT_CONSENT_VERSION } from '../src/legal/index'
import { identity, recordSessionLogout, requireResult, signOutIdentities } from './probe-data.mjs'
import { AppDefect, errorKind, login, moderateOnly, navigate, routeGates, uiLogout } from './probe-ui'

test('account switch removes previous account private message', async ({ page, baseURL }) => {
  const { attempt } = JSON.parse(await readFile(`${process.env.EV}/run-context.json`, 'utf8'))
  const residualPath = `${process.env.EV}/residuals.json`
  const residuals = existsSync(residualPath)
    ? JSON.parse(await readFile(residualPath, 'utf8'))
    : { messages: [], posts: [] }
  const counts: any[] = []
  const result: any = { attempt, result: 'pass', counts }
  let phase = 'setup'
  let bSession = false
  let bArmed = false
  let aPaintAt = 0
  const postCard = page.locator('.secondary-page--post .post-card')
  const moreButton = page.locator('.secondary-page--post .more-btn')
  const bodyControl = '[SYN-P1.12] account switch public detail'

  await page.addInitScript(() => {
    try { localStorage.setItem('welcomed', '1') } catch {}
  })
  await page.addInitScript(() => {
    const w = window as any
    w.__leakArmed = w.__leakArmed === true
    const zero = () => ({ innerText: 0, textContent: 0, localStorage: 0, sessionStorage: 0 })
    w.__leakState = { callbacks: 0, max: zero(), controlMax: zero() }
    const sample = () => {
      const values = {
        innerText: document.body?.innerText || '',
        textContent: document.body?.textContent || '',
        localStorage: Object.values(localStorage).join(''),
        sessionStorage: Object.values(sessionStorage).join(''),
      }
      for (const [key, value] of Object.entries(values)) {
        w.__leakState.max[key] = Math.max(w.__leakState.max[key], (value.match(/SYN-P1-LEAK-\d{8}/g) || []).length)
        w.__leakState.controlMax[key] = Math.max(w.__leakState.controlMax[key], (value.match(/\[SYN-P1\.12\]/g) || []).length)
      }
    }
    w.__leakReset = (armed: boolean) => {
      w.__leakState = { callbacks: 0, max: zero(), controlMax: zero() }
      w.__leakArmed = armed
    }
    new MutationObserver(() => {
      if (!w.__leakArmed) return
      w.__leakState.callbacks += 1
      sample()
    }).observe(document, { subtree: true, childList: true, characterData: true })
  })

  const observerReading = async (surface: string) => {
    const row = await page.evaluate(() => {
      const w = window as any
      return w.__leakState ? { armed: w.__leakArmed === true, ...w.__leakState } : null
    })
    if (row) {
      const reading = { phase: surface, observer: row }
      counts.push(reading)
      console.log(JSON.stringify(reading))
    }
    return row
  }
  const checkLeak = (row: any, surface: string) => {
    if (Object.values(row).some(value => Number(value) > 0)) {
      const hiddenOnly = row.textContent > 0 && row.innerText === 0 && row.localStorage === 0 && row.sessionStorage === 0
      throw new AppDefect(hiddenOnly ? 'hidden_dom_hit' : surface, 1)
    }
    expect(Object.values(row).reduce((sum: number, value) => sum + Number(value), 0)).toBe(0)
  }

  try {
    const a = await identity('A')
    const b = await identity('B')
    const c = await identity('C')
    for (const [account, user] of [['A', a], ['B', b]] as const) {
      const profile = requireResult(await user.db.rpc('get_my_profile'), 'consent_state_rpc')
      const consentCurrent = !!profile.tos_version && profile.tos_version >= CURRENT_CONSENT_VERSION
      console.log(JSON.stringify({ phase: 'consent_state_rpc', account, consentCurrent }))
      if (!consentCurrent) throw new Error('account_switch_requires_current_consent')
    }
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date()).replaceAll('-', '')
    const marker = `SYN-P1-LEAK-${day} attempt-${attempt}`
    let conversation = requireResult(await c.db.from('conversations').select('id')
      .eq('is_direct', true)
      .or(`and(buyer_id.eq.${c.id},seller_id.eq.${a.id}),and(buyer_id.eq.${a.id},seller_id.eq.${c.id})`), 'find_conversation')[0]
    if (!conversation) {
      conversation = requireResult(await c.db.from('conversations').insert({
        item_id: null, buyer_id: c.id, seller_id: a.id, is_direct: true,
      }).select('id').single(), 'create_conversation')
    }
    const message = requireResult(await c.db.from('messages').insert({
      conversation_id: conversation.id, sender_id: c.id, content: marker, message_type: 'text',
    }).select('id').single(), 'create_probe_message')
    residuals.messages.push({
      id: message.id, conversationId: conversation.id, owner: 'C', attempt,
      reason: 'No product message deletion entry; retained per RUNBOOK 5.2.',
    })
    await writeFile(residualPath, JSON.stringify(residuals, null, 2))
    const postId = residuals.posts[0]?.id || requireResult(await b.db.from('posts').insert({
      user_id: b.id, content: bodyControl, images: [],
    }).select('id').single(), 'create_public_detail').id
    if (!residuals.posts.some(post => post.id === postId)) residuals.posts.push({ id: postId, owner: 'B', cleanup: 'pending' })
    await writeFile(residualPath, JSON.stringify(residuals, null, 2))
    const expectedPostUrl = new URL(`/#/pages/post/index?id=${postId}`, baseURL).href
    const inspect = async (surface: string) => {
      const row = await page.evaluate(() => {
        const count = (text: string, pattern: RegExp) => (text.match(pattern) || []).length
        const values = {
          innerText: document.body.innerText,
          textContent: document.body.textContent || '',
          localStorage: Object.values(localStorage).join(''),
          sessionStorage: Object.values(sessionStorage).join(''),
        }
        const leak: any = {}
        const control: any = {}
        for (const [key, value] of Object.entries(values)) {
          leak[key] = count(value, /SYN-P1-LEAK-\d{8}/g)
          control[key] = count(value, /\[SYN-P1\.12\]/g)
        }
        let userId: string | null = null
        try {
          const envelope = JSON.parse(localStorage.getItem('sb-hygkwxugskijadgfisji-auth-token') || 'null')
          const session = typeof envelope?.value === 'string' ? JSON.parse(envelope.value) : envelope
          userId = session?.user?.id ?? null
        } catch {}
        return { leak, control, userId }
      })
      const reading = { phase: surface, ...row }
      counts.push(reading)
      console.log(JSON.stringify(reading))
      if (surface === 'control_A') {
        expect(row.leak.innerText).toBeGreaterThanOrEqual(1)
        expect(row.leak.textContent).toBeGreaterThanOrEqual(1)
        expect(row.userId).toBe(a.id)
      } else {
        if (row.userId !== b.id) throw new AppDefect(row.userId ? 'identity_mismatch' : 'identity_missing', 6)
        checkLeak(row.leak, surface)
        expect(row.userId).toBe(b.id)
        if (surface.startsWith('plaza') || surface.startsWith('post')) {
          expect(row.control.innerText).toBeGreaterThanOrEqual(1)
          expect(row.control.textContent).toBeGreaterThanOrEqual(1)
        }
      }
      return row
    }
    await moderateOnly(page)
    phase = 'goto'
    await page.goto('/#/pages/login/index')
    phase = 'login_A'
    await login(page, 'A')
    phase = 'control_A'
    await page.evaluate(() => (window as any).__leakReset(true))
    await navigate(page, '/pages/messages/index', true)
    await expect(page).toHaveURL(/#\/pages\/messages\/index$/)
    await expect(page.locator('.conv-preview').filter({ hasText: marker })).toBeVisible()
    aPaintAt = Date.now()
    await inspect('control_A')
    await expect.poll(() => page.evaluate(() => (window as any).__leakState.max.innerText)).toBeGreaterThanOrEqual(1)
    const controlA = await observerReading('control_A')
    expect(controlA.max.innerText).toBeGreaterThanOrEqual(1)
    expect(controlA.max.textContent).toBeGreaterThanOrEqual(1)
    await navigate(page, `/pages/chat/index?id=${conversation.id}`)
    await expect(page.locator('.chat-page-wrap')).toContainText(marker)
    phase = 'logout_A'
    const logoutStatuses: number[] = []
    const observeLogout = (response: any) => {
      if (response.url().includes('/auth/v1/logout')) logoutStatuses.push(response.status())
    }
    page.on('response', observeLogout)
    try {
      await navigate(page, '/pages/settings/index')
      await page.getByRole('button', { name: /^(Sign Out|退出登录)$/ }).click()
      await page.locator('.uni-modal__btn_primary').click()
      await expect.poll(() => page.evaluate(() => localStorage.getItem('sb-hygkwxugskijadgfisji-auth-token'))).toBeNull()
      await expect(page).toHaveURL(/#\/(?:pages\/index\/index)?$/)
      await expect(page.getByRole('heading', { name: /^(Home|首页)$/ })).toBeVisible()
    } finally {
      page.off('response', observeLogout)
      await recordSessionLogout('A', 'ui', logoutStatuses)
    }
    await page.evaluate(() => (window as any).__leakReset(true))
    bArmed = true
    phase = 'login_B_no_refresh'
    await navigate(page, '/pages/login/index')
    await login(page, 'B')
    bSession = true
    checkLeak((await observerReading('login_B')).max, 'login_B_no_refresh')
    phase = 'messages'
    await navigate(page, '/pages/messages/index', true)
    await expect(page).toHaveURL(/#\/pages\/messages\/index$/)
    await expect(page.locator('.conv-skel')).toHaveCount(0)
    if (await page.locator('.empty[role]').count()) phase = 'messages_load_failed'
    await expect(page.locator('.empty[role]')).toHaveCount(0)
    await expect(page.locator('.conv-item').first()).toBeVisible()
    result.cacheWindowMs = Date.now() - aPaintAt
    result.cacheWindowTested = result.cacheWindowMs <= 30_000
    console.log(JSON.stringify({ phase: 'cache_window', elapsedMs: result.cacheWindowMs, tested: result.cacheWindowTested }))
    expect(result.cacheWindowMs).toBeLessThanOrEqual(30_000)
    await inspect('messages')
    phase = 'plaza'
    await navigate(page, '/pages/plaza/index', true)
    await expect(page).toHaveURL(/#\/pages\/plaza\/index$/)
    const communityHomeEntry = page.locator('.ch-more, .ch-state[role=alert]').first()
    await expect(communityHomeEntry).toBeVisible()
    if (await communityHomeEntry.evaluate(node => node.matches('.ch-state[role=alert]'))) {
      phase = 'community_home_failed'
      throw new Error('community_home_failed')
    }
    await page.locator('.ch-more').click()
    await expect(page).toHaveURL(/#\/pages\/plaza\/index\?view=all$/)
    await expect(page.getByText(bodyControl, { exact: true })).toBeVisible()
    await inspect('plaza_pre_reload')
    const plazaObserver = await observerReading('plaza_pre_reload')
    checkLeak(plazaObserver.max, 'plaza_pre_reload')
    expect(plazaObserver.controlMax.innerText).toBeGreaterThanOrEqual(1)
    expect(plazaObserver.controlMax.textContent).toBeGreaterThanOrEqual(1)
    phase = 'post'
    await navigate(page, `/pages/post/index?id=${postId}`)
    await expect(page).toHaveURL(expectedPostUrl)
    await expect(postCard).toBeVisible()
    await expect(postCard).toContainText(bodyControl)
    await inspect('post_pre_reload')
    const postObserver = await observerReading('post_pre_reload')
    checkLeak(postObserver.max, 'post_pre_reload')
    expect(postObserver.controlMax.innerText).toBeGreaterThanOrEqual(1)
    expect(postObserver.controlMax.textContent).toBeGreaterThanOrEqual(1)
    await expect(moreButton).toBeVisible()
    const preReload = await observerReading('pre_reload')
    checkLeak(preReload.max, 'pre_reload')
    expect(preReload.callbacks).toBeGreaterThan(0)
    expect(preReload.controlMax.innerText).toBeGreaterThanOrEqual(1)
    expect(preReload.controlMax.textContent).toBeGreaterThanOrEqual(1)
    await page.addInitScript(() => { (window as any).__leakArmed = true })
    phase = 'reload'
    await page.reload({ waitUntil: 'networkidle' })
    const welcomedSeeded = await page.evaluate(() => localStorage.getItem('welcomed') === '1')
    if (welcomedSeeded && page.url() !== expectedPostUrl) throw new AppDefect('post_route_after_reload', 4)
    await expect(page).toHaveURL(expectedPostUrl)
    await expect(postCard).toBeVisible()
    await expect(postCard).toContainText(bodyControl)
    phase = 'post_reload_first_inspect'
    await inspect('post_reload_first')
    phase = 'author_control_after_reload'
    try { await expect(moreButton).toBeVisible() } catch (error) {
      if (welcomedSeeded && page.url() !== expectedPostUrl) throw new AppDefect('post_route_after_reload', 4)
      const current = await inspect('post_reload_author_control_missing')
      if (page.url() === expectedPostUrl && await postCard.isVisible() && current.userId === b.id) {
        throw new AppDefect('author_control_after_reload', 5)
      }
      throw error
    }
    await inspect('post_reload_author_control')
    const postReload = await observerReading('post_reload')
    checkLeak(postReload.max, 'post_reload')
    expect(postReload.callbacks).toBeGreaterThan(0)
    expect(postReload.controlMax.innerText).toBeGreaterThanOrEqual(1)
    expect(postReload.controlMax.textContent).toBeGreaterThanOrEqual(1)
    result.reload = 'page.reload (ordinary reload, WebKit)'
    phase = 'cleanup_post'
    const deletion = page.waitForResponse(response => response.request().method() === 'DELETE' && response.url().includes('/rest/v1/posts'))
    await moreButton.click()
    await page.locator('.uni-modal__btn_primary').click()
    const response = await deletion
    expect(response.ok()).toBe(true)
    const remaining = requireResult(await b.db.from('posts').select('id').eq('id', postId), 'cleanup_verify')
    expect(remaining).toHaveLength(0)
    residuals.posts = residuals.posts.filter(post => post.id !== postId)
    await writeFile(residualPath, JSON.stringify(residuals, null, 2))
    await expect(page).toHaveURL(/#\/pages\/plaza\/index$/)
  } catch (caught) {
    let error = caught
    if (bArmed) {
      const observed = await observerReading('failure_observer')
      if (observed && Object.values(observed.max).some(value => Number(value) > 0)) {
        const hiddenOnly = observed.max.textContent > 0 && observed.max.innerText === 0 && observed.max.localStorage === 0 && observed.max.sessionStorage === 0
        error = new AppDefect(hiddenOnly ? 'hidden_dom_hit' : phase, 1)
      }
    }
    if (error instanceof AppDefect) phase = error.phase
    const gates = {
      ...await routeGates(page),
      post: new URL(page.url()).hash.startsWith('#/pages/post/index?'),
      postCardVisible: await postCard.isVisible(),
      moreBtnVisible: await moreButton.isVisible(),
      welcomedSeeded: await page.evaluate(() => localStorage.getItem('welcomed') === '1'),
    }
    Object.assign(result, {
      result: error instanceof AppDefect ? 'app_defect' : 'probe_or_environment',
      phase, errorKind: errorKind(error),
      appDefectRule: error instanceof AppDefect ? error.rule : null, gates,
    })
    console.log(JSON.stringify({ phase, errorKind: result.errorKind, appDefectRule: result.appDefectRule, gates }))
    throw new Error(`account_switch_failed_at_${phase}`)
  } finally {
    if (bSession) await uiLogout(page, 'B')
    if (result.result !== 'pass') await page.setContent('<p>Acceptance failed; credential fields removed.</p>')
    await signOutIdentities()
    await writeFile(`${process.env.EV}/attempt-${attempt}-results.json`, JSON.stringify(result, null, 2))
    await writeFile(`${process.env.EV}/attempt-${attempt}-counts.json`, JSON.stringify(counts, null, 2))
  }
})
