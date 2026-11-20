import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'

// The mini-program main package has a hard source budget
// (scripts/verify-miniprogram.mjs). Secondary pages leave it by becoming
// subpackages whose root is the page's own directory, so the route a share
// card, an email link or a `uni.navigateTo` call names never changes. This
// file pins both halves: no route moved, and the pages that left stay out.

const SRC = new URL('../src/', import.meta.url)
const PAGES_JSON = new URL('pages.json', SRC)

// Every route registered before the split, in its H5 order.
const ROUTES = [
  'pages/index/index',
  'pages/account-link/index',
  'pages/plaza/index',
  'pages/post/index',
  'pages/publish/index',
  'pages/publish/edit',
  'pages/messages/index',
  'pages/profile/index',
  'pages/detail/index',
  'pages/chat/index',
  'pages/history/index',
  'pages/my-items/index',
  'pages/legal/index',
  'pages/welcome/index',
  'pages/settings/index',
  'pages/seller/index',
  'pages/profile/edit',
  'pages/notifications/index',
  'pages/blocked/index',
  'pages/reset-password/index',
  'pages/illini-verify/index',
  'pages/login/index',
  'pages/following/index',
  'pages/saved-searches/index',
  'pages/search/index',
  'pages/onboarding/index',
  'pages/reconsent/index',
  'pages/profile-recovery/index',
  'pages/suspended/index',
]
// The moderation console is compiled for H5 only.
const H5_ONLY_ROUTES = ['pages/admin/index']

const TAB_PAGES = [
  'pages/index/index',
  'pages/plaza/index',
  'pages/publish/index',
  'pages/messages/index',
  'pages/profile/index',
]

// Pages the app opens by itself, or that cannot leave without a new route.
const MAIN_PACKAGE_PAGES = [
  ...TAB_PAGES,
  // Share a directory with a tab page; a subpackage root takes the whole
  // directory, and tab pages must stay in the main package.
  'pages/publish/edit',
  'pages/profile/edit',
  // First-run launch destination: App.onLaunch relaunches there.
  'pages/welcome/index',
  // Gates: App.vue relaunches there and rewrites every other navigation to
  // them, so they must render without a further download.
  'pages/reconsent/index',
  'pages/profile-recovery/index',
  'pages/suspended/index',
  // A 2 KB shell around ChatThread, which the messages tab keeps in main.
  'pages/chat/index',
]

const SUBPACKAGE_PAGES = [
  'pages/detail/index',
  'pages/post/index',
  'pages/seller/index',
  'pages/account-link/index',
  'pages/blocked/index',
  'pages/following/index',
  'pages/history/index',
  'pages/illini-verify/index',
  'pages/legal/index',
  'pages/login/index',
  'pages/my-items/index',
  'pages/notifications/index',
  'pages/onboarding/index',
  'pages/reset-password/index',
  'pages/saved-searches/index',
  'pages/search/index',
  'pages/settings/index',
]

const PLATFORMS = {
  h5: new Set(['H5', 'WEB', 'VUE3']),
  'mp-weixin': new Set(['MP-WEIXIN', 'MP', 'VUE3']),
}

// pages.json is JSON with uni-app conditional-compilation comments. Resolve
// the `// #ifdef` blocks the way the compiler does for one platform, then drop
// the remaining comments and the trailing commas a removed block leaves behind.
function compilePagesJson(source, platform) {
  const defined = PLATFORMS[platform]
  const kept = []
  const open = []
  for (const line of source.split('\n')) {
    const directive = line.match(/^\s*\/\/\s*#(ifdef|ifndef|endif)\b(.*)$/)
    if (!directive) {
      if (open.every(Boolean)) kept.push(line)
      continue
    }
    if (directive[1] === 'endif') {
      assert.ok(open.length > 0, 'pages.json has an #endif with no open block')
      open.pop()
      continue
    }
    const matches = directive[2].split('||').some(name => defined.has(name.trim()))
    open.push(directive[1] === 'ifdef' ? matches : !matches)
  }
  assert.equal(open.length, 0, 'pages.json leaves a conditional block open')
  return JSON.parse(
    kept.join('\n').replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[\]}])/g, '$1'),
  )
}

async function readRoutes(platform) {
  const config = compilePagesJson(await readFile(PAGES_JSON, 'utf8'), platform)
  const main = config.pages.map(page => page.path)
  const packages = (config.subPackages || []).map(pkg => ({
    root: pkg.root,
    pages: pkg.pages.map(page => `${pkg.root}/${page.path}`),
  }))
  return { config, main, packages, all: [...main, ...packages.flatMap(pkg => pkg.pages)] }
}

test('every route registered before the subpackage split still resolves to the same path', async () => {
  for (const [platform, expected] of [
    ['h5', [...ROUTES, ...H5_ONLY_ROUTES]],
    ['mp-weixin', ROUTES],
  ]) {
    const { all } = await readRoutes(platform)
    assert.equal(new Set(all).size, all.length, `${platform} registers a route twice`)
    assert.deepEqual(
      expected.filter(route => !all.includes(route)),
      [],
      `${platform} lost routes that links, share cards and emails still name`,
    )
  }
  const { all } = await readRoutes('mp-weixin')
  assert.deepEqual(all.filter(route => H5_ONLY_ROUTES.includes(route)), [])
})

test('H5 keeps one flat page list in its original order', async () => {
  const { config, main } = await readRoutes('h5')
  assert.equal(config.subPackages, undefined)
  assert.deepEqual(main.filter(route => ROUTES.includes(route)), ROUTES)
})

test('tab pages, the launch page and app-driven pages stay in the mini-program main package', async () => {
  for (const platform of Object.keys(PLATFORMS)) {
    const { config, main } = await readRoutes(platform)
    assert.equal(main[0], 'pages/index/index', `${platform} must launch on the home page`)
    assert.deepEqual(config.tabBar.list.map(tab => tab.pagePath), TAB_PAGES)
  }
  const { main } = await readRoutes('mp-weixin')
  assert.deepEqual(MAIN_PACKAGE_PAGES.filter(route => !main.includes(route)), [])
})

test('secondary pages load as subpackages rooted at their own directory', async () => {
  const { main, packages } = await readRoutes('mp-weixin')
  const missing = SUBPACKAGE_PAGES.filter((route) => {
    const root = route.slice(0, route.lastIndexOf('/'))
    return !packages.some(pkg => pkg.root === root && pkg.pages.includes(route))
  })
  assert.deepEqual(missing, [], 'these pages must be subpackages whose root is their directory')
  assert.deepEqual(
    SUBPACKAGE_PAGES.filter(route => main.includes(route)),
    [],
    'these pages are still compiled into the main package',
  )
})

test('no main-package page sits under a subpackage root', async () => {
  // WeChat packs everything under a declared root into that subpackage, so a
  // main page there (a tab page above all) would be pulled out of the main
  // package, and one root inside another is rejected outright.
  const { main, packages } = await readRoutes('mp-weixin')
  const roots = packages.map(pkg => pkg.root)
  for (const root of roots) {
    assert.deepEqual(main.filter(route => route.startsWith(`${root}/`)), [], `${root} contains a main-package page`)
    assert.deepEqual(roots.filter(other => other.startsWith(`${root}/`)), [], `${root} contains another subpackage root`)
  }
})

async function sourceFiles(dir = SRC) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...await sourceFiles(new URL(`${entry.name}/`, dir)))
    else if (/\.(?:vue|ts|js)$/.test(entry.name)) out.push(new URL(entry.name, dir))
  }
  return out
}

test('code under a subpackage root is imported only from inside that root', async () => {
  // A module below a root is emitted into that subpackage. The main package
  // and the other subpackages cannot require it in WeChat, while vue-tsc and
  // the H5 build accept the import, so only this scan can refuse it.
  const { packages } = await readRoutes('mp-weixin')
  const roots = packages.map(pkg => new URL(`${pkg.root}/`, SRC).pathname)
  const rootOf = pathname => roots.find(root => pathname.startsWith(root))
  const offenders = []
  let inside = 0
  for (const file of await sourceFiles()) {
    const source = await readFile(file, 'utf8')
    for (const [, , specifier] of source.matchAll(/\b(?:from|import|require)\s*\(?\s*(['"])([^'"\n]+)\1/g)) {
      if (!/^(?:\.{1,2}\/|@\/)/.test(specifier)) continue
      const target = specifier.startsWith('@/') ? new URL(specifier.slice(2), SRC) : new URL(specifier, file)
      const root = rootOf(target.pathname)
      if (!root) continue
      if (rootOf(file.pathname) === root) inside += 1
      else offenders.push(`${file.pathname.slice(SRC.pathname.length)} imports ${specifier}`)
    }
  }
  // Control: a scan that matched nothing would pass without having looked.
  assert.ok(inside > 0, 'the scan found no import inside any subpackage root')
  assert.deepEqual(offenders, [])
})
