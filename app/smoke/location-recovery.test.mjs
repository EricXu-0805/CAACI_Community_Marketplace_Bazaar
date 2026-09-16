import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

let fixtureId = 0
async function locationFixture(t, uni, permissions) {
  const previousUni = Object.getOwnPropertyDescriptor(globalThis, 'uni')
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'uni', { configurable: true, writable: true, value: uni })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: permissions ? { permissions } : {} })
  t.after(() => {
    for (const [key, descriptor] of [['uni', previousUni], ['navigator', previousNavigator]]) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  const input = readFileSync(new URL('../src/composables/useLocation.ts', import.meta.url), 'utf8')
    .replace("import { ref } from 'vue'", 'const ref = value => ({ value })')
    .replace("import { BASE_URL } from '../config/runtime'", "const BASE_URL = 'https://app.test'")
    .replace("import { onAccountTransition } from './accountScope'", 'const onAccountTransition = () => {}')
  const output = ts.transpileModule(input, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
  const module = await import(`data:text/javascript;base64,${Buffer.from(`${output}\n// fixture ${++fixtureId}`).toString('base64')}`)
  return module.useLocation()
}
const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve() }
const fix = options => options.success({ latitude: 40.110123, longitude: -88.230456 })

test('a geocoder with no callback recovers, aborts, ignores a late result, and permits retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const requests = []
  let aborted = 0
  const location = await locationFixture(t, {
    getLocation: fix,
    request(options) { requests.push(options); return { abort() { aborted += 1 } } },
  })
  const pending = location.detectLocation()
  await flush()
  assert.equal(requests.length, 1)
  assert.equal(location.detecting.value, true)
  t.mock.timers.tick(8000)
  assert.deepEqual(await pending, { ok: false, reason: 'geocode_failed' })
  assert.equal(aborted, 1)
  assert.equal(location.detecting.value, false)
  requests[0].success({ statusCode: 200, data: { address: { city: 'Stale city' } } })
  assert.equal(location.cachedLocation.value, '')
  const retry = location.detectLocation()
  await flush()
  requests[1].success({ statusCode: 200, data: { address: { road: 'Green Street', city: 'Champaign' } } })
  assert.deepEqual(await retry, { ok: true, location: 'Green Street, Champaign' })
})

test('permission introspection cannot hang the location flow', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let starts = 0
  const location = await locationFixture(t, {
    getLocation(options) { starts += 1; options.fail({ code: 2 }) },
  }, { query: () => new Promise(() => {}) })
  const pending = location.detectLocation()
  assert.equal(location.detecting.value, true)
  t.mock.timers.tick(1000)
  assert.deepEqual(await pending, { ok: false, reason: 'position_unavailable' })
  assert.equal(starts, 1)
  assert.equal(location.detecting.value, false)
})

test('a denied permission does not request a device fix and clears loading', async t => {
  let starts = 0
  const location = await locationFixture(t, { getLocation() { starts += 1 } }, {
    query: async () => ({ state: 'denied' }),
  })
  assert.deepEqual(await location.detectLocation(), { ok: false, reason: 'permission_denied' })
  assert.equal(starts, 0)
  assert.equal(location.detecting.value, false)
})

test('public location autofill omits house numbers even from an older geocode server', async t => {
  const location = await locationFixture(t, {
    getLocation: fix,
    request(options) {
      const url = new URL(options.url)
      assert.equal(url.searchParams.get('lat'), '40.110')
      assert.equal(url.searchParams.get('lon'), '-88.230')
      options.success({ statusCode: 200, data: {
        address: { house_number: '123', road: 'Green Street', city: 'Champaign' },
        display_name: '123 Green Street, Apartment 4B',
      } })
    },
  })
  assert.deepEqual(await location.detectLocation(), { ok: true, location: 'Green Street, Champaign' })
})

for (const coordinates of [[NaN, 0], [0, Infinity], [91, 0], [0, -181]]) {
  test(`invalid device coordinates ${coordinates} never leave the device`, async t => {
    let requests = 0
    const location = await locationFixture(t, {
      getLocation(options) { options.success({ latitude: coordinates[0], longitude: coordinates[1] }) },
      request() { requests += 1 },
    })
    assert.deepEqual(await location.detectLocation(), { ok: false, reason: 'position_unavailable' })
    assert.equal(requests, 0)
  })
}
