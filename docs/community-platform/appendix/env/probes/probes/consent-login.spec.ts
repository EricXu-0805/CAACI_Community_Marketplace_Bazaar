import { test, expect } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { CURRENT_CONSENT_VERSION } from '../src/legal/index'
import { identity, requireResult, signOutIdentities } from './probe-data.mjs'
import { AppDefect, acceptConsent, ensureScreenshotSafe, errorKind, homeStable, login, moderateOnly, routeGates, uiLogout } from './probe-ui'

for (const account of ['A', 'B', 'C']) {
  test(`synthetic ${account} login and consent`, async ({ page }) => {
    const { attempt } = JSON.parse(await readFile(`${process.env.EV}/run-context.json`, 'utf8'))
    let phase = 'consent_state_rpc'
    let loggedIn = false
    let enteredReconsent = false
    const navigation = () => {
      if (new URL(page.url()).hash.includes('/pages/reconsent/index')) enteredReconsent = true
    }
    const result: any = { account, attempt, result: 'pass' }
    try {
      const user = await identity(account)
      const profile = requireResult(await user.db.rpc('get_my_profile'), 'consent_state_rpc')
      const v = profile.tos_version
      const consentCurrent = !!v && v >= CURRENT_CONSENT_VERSION
      result.consentCurrent = consentCurrent
      console.log(JSON.stringify({ phase, account, consentCurrent }))
      await moderateOnly(page)
      page.on('framenavigated', navigation)
      phase = 'goto'
      await page.goto('/#/pages/login/index')
      phase = 'login'
      await login(page, account)
      loggedIn = true
      phase = 'consent_decision'
      await expect.poll(async () => {
        const gates = await routeGates(page)
        return gates.home || gates.reconsent || gates.recovery || gates.suspended
      }).toBe(true)
      const gates = await routeGates(page)
      if (consentCurrent) {
        if (gates.reconsent || enteredReconsent) throw new AppDefect('consent_mismatch', 2)
        result.consentAction = 'already_recorded'
      } else {
        if (gates.home) throw new AppDefect('consent_mismatch', 2)
        phase = 'consent_accept'
        await acceptConsent(page, account)
        result.consentAction = 'accepted'
      }
      phase = 'home'
      await homeStable(page)
      if (consentCurrent && enteredReconsent) throw new AppDefect('consent_mismatch', 2)
      phase = 'screenshot_safety'
      await ensureScreenshotSafe(page)
      phase = 'screenshot'
      await page.screenshot({ path: `${process.env.EV}/attempt-${attempt}-consent-${account}.png` })
      console.log(JSON.stringify({ phase: 'consent_complete', account, consentCurrent, action: result.consentAction, screenshotCount: 1 }))
    } catch (error) {
      if (error instanceof AppDefect) phase = error.phase
      Object.assign(result, {
        result: error instanceof AppDefect ? 'app_defect' : 'probe_or_environment',
        phase, errorKind: errorKind(error),
        appDefectRule: error instanceof AppDefect ? error.rule : null,
        gates: await routeGates(page),
      })
      console.log(JSON.stringify(result))
      throw new Error(`synthetic_${account}_failed_at_${phase}`)
    } finally {
      page.off('framenavigated', navigation)
      if (loggedIn) await uiLogout(page, account)
      if (result.result !== 'pass') await page.setContent('<p>Acceptance failed; credential fields removed.</p>')
      await signOutIdentities()
      const path = `${process.env.EV}/attempt-${attempt}-results.json`
      const results = existsSync(path) ? JSON.parse(await readFile(path, 'utf8')) : []
      results.push(result)
      await writeFile(path, JSON.stringify(results, null, 2))
    }
  })
}
