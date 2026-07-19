import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import ts from 'typescript'

const appSource = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
const authSource = await readFile(
  new URL('../src/composables/useAuth.ts', import.meta.url),
  'utf8',
)
const pageSource = await readFile(
  new URL('../src/pages/suspended/index.vue', import.meta.url),
  'utf8',
)
const utilitySource = await readFile(
  new URL('../src/utils/suspension.ts', import.meta.url),
  'utf8',
)

const utilityJs = ts.transpileModule(utilitySource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText
const utility = await import(
  `data:text/javascript;base64,${Buffer.from(utilityJs).toString('base64')}`
)

test('suspension activity and timeout helpers cover expiry, permanent, invalid and long actions', () => {
  const now = Date.parse('2026-07-18T08:00:00.000Z')
  assert.equal(utility.isSuspensionActive({ suspension_level: 1 }, now), false)
  assert.equal(utility.isSuspensionActive({
    suspension_level: 2,
    suspended_until: '2026-07-18T08:00:01.000Z',
  }, now), true)
  assert.equal(utility.isSuspensionActive({
    suspension_level: 2,
    suspended_until: '2026-07-18T07:59:59.000Z',
  }, now), false)
  assert.equal(utility.isSuspensionActive({ suspension_level: 5, suspended_until: null }, now), true)
  assert.equal(utility.isSuspensionActive({ suspension_level: 5, suspended_until: 'infinity' }, now), true)
  assert.equal(utility.isSuspensionActive({ suspension_level: 3, suspended_until: 'bad-date' }, now), true)

  assert.equal(utility.nextSuspensionExpiryDelayMs('2026-07-18T07:59:59.000Z', now), 0)
  assert.equal(utility.nextSuspensionExpiryDelayMs('infinity', now), null)
  assert.equal(utility.nextSuspensionExpiryDelayMs(null, now), null)
  assert.equal(
    utility.nextSuspensionExpiryDelayMs('2026-08-18T08:00:00.000Z', now),
    utility.MAX_SUSPENSION_TIMER_MS,
  )
  assert.equal(utility.SUSPENSION_REFRESH_INTERVAL_MS, 60_000)
})

test('foreground profile refresh stays authoritative without a transient recovery redirect', () => {
  assert.match(appSource, /if \(authState\.value === 'authenticated'\) \{[\s\S]*refreshProfile\(\)/)
  assert.match(authSource, /preserveCurrent: options\.preserveCurrent/)
  assert.match(authSource, /refreshProfile\(\)[\s\S]*force: true, preserveCurrent: true/)
  assert.match(authSource, /if \(!preserveCurrent\) \{[\s\S]*profileLoadState\.value = 'loading'/)
  assert.match(authSource, /currentUser\.value = null[\s\S]*profileLoadState\.value = 'error'/)
  assert.match(
    authSource,
    /withAuthInitTimeout\([\s\S]*supabase\.rpc\('get_my_profile'\)\.abortSignal\(controller\.signal\),[\s\S]*6000/,
  )
  assert.doesNotMatch(authSource, /withAuthInitTimeout\(fetchProfile\(/)
})

test('suspended page queries only current actions and recovers on show, expiry or early lift', () => {
  assert.match(pageSource, /onShow\(\(\) => \{[\s\S]*reconcileSuspensionGate\('show'\)/)
  assert.match(pageSource, /onHide\(\(\) => \{[\s\S]*clearRecoveryTimers\(\)/)
  assert.match(pageSource, /ensureProfileReady\(\{[\s\S]*force: true,[\s\S]*preserveCurrent: true/)
  assert.match(pageSource, /if \(!isSuspensionActive\(currentUser\.value\)\)[\s\S]*reLaunch\(\{ url: '\/pages\/index\/index' \}\)/)
  assert.match(pageSource, /setTimeout\([\s\S]*SUSPENSION_REFRESH_INTERVAL_MS/)
  assert.match(pageSource, /nextSuspensionExpiryDelayMs\(endsAt\)/)
  assert.match(pageSource, /requestEpoch === gateRefreshEpoch/)
  assert.match(pageSource, /isAccountRequestCurrent\(accountToken\)/)

  assert.match(pageSource, /\.gte\('level', 2\)/)
  assert.match(pageSource, /\.lte\('started_at', queryNow\)/)
  assert.match(pageSource, /\.is\('lifted_at', null\)/)
  assert.match(pageSource, /\.or\(`ends_at\.is\.null,ends_at\.gt\.\$\{queryNow\}`\)/)
  assert.match(pageSource, /\.order\('level', \{ ascending: false \}\)/)
  assert.match(pageSource, /activeSuspension && !appealSubmitted/)
  assert.match(pageSource, /activeSuspension && appealSubmitted/)
})
