import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

/** Exercise emitted modules with WeChat's separate globalThis namespace.
 * This is a narrow runtime contract; it does not emulate wx permissions/UI. */
export async function verifyMpRuntime(root) {
  const globals = {}
  const sandbox = vm.createContext({ globalThis: globals, console: { warn() {} }, setTimeout, clearTimeout })
  const cache = new Map()
  function load(relative) {
    const file = path.resolve(root, relative)
    assert.ok(file.startsWith(path.resolve(root) + path.sep), 'module leaves mini-program artifact')
    if (cache.has(file)) return cache.get(file).exports
    const module = { exports: {} }; cache.set(file, module)
    const source = readFileSync(file, 'utf8')
    const fn = vm.runInContext(`(function(require,module,exports){${source}\n})`, sandbox, { filename: relative })
    fn(specifier => {
      assert.ok(specifier.startsWith('.'), 'unexpected external runtime dependency')
      return load(path.relative(root, path.resolve(path.dirname(file), specifier.endsWith('.js') ? specifier : `${specifier}.js`)))
    }, module, module.exports)
    return module.exports
  }
  // The real entry must install shims before evaluating validators. Older
  // builds only installed them inside useSupabase's body, after its imports.
  if (existsSync(path.join(root, 'utils/platformGlobals.js'))) load('utils/platformGlobals.js')
  else load('utils/urlShim.js').installUrlShim()
  const resource = load('utils/publicResource.js')
  // The origin constant is intentionally tree-shaken out of module exports;
  // use the emitted public configuration to exercise the real URL validator.
  const origin = readFileSync(path.join(root, 'utils/publicResource.js'), 'utf8').match(/https?:\/\/[a-zA-Z0-9.-]+(?::\d+)?(?=["'])/)?.[0]
  assert.ok(origin, 'compiled media origin is missing')
  const owner = '11111111-1111-4111-8111-111111111111'
  const url = `${origin}/storage/v1/object/public/item-images/items/${owner}/photo.jpg`
  assert.equal(resource.safeItemMediaUrl(url, owner), url, 'own-project photo must remain visible')
  for (const bad of [url.replace(owner, '22222222-2222-4222-8222-222222222222'), url.replace('/photo.jpg', '/../other.jpg'), url + '?tracking=1', url.replace('://', '://untrusted.invalid@')]) {
    assert.equal(resource.safeItemMediaUrl(bad, owner), '', 'MP compatibility must preserve media boundaries')
  }
  const storage = load('utils/itemStorage.js')
  assert.deepEqual(Array.from(storage.ownedItemImagePaths([url], owner, origin)), [`items/${owner}/photo.jpg`])
  const transport = load('api/transportBoundary.js')
  const fetcher = transport.withTransportDeadlines(async () => ({ ok: true, status: 200, json: async () => ({ verified: true }) }))
  const response = await fetcher(`${origin}/rest/v1/items`)
  assert.equal((await response.json()).verified, true, 'MP requests must use the installed AbortController')
  return { media: 'passed', ownership: 'passed', transport: 'passed', scope: 'emitted modules with isolated Web API globals' }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await verifyMpRuntime(path.resolve(process.argv[2])))) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
