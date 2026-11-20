import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'

/*
 * P4.8 boundaries (ENGINEERING 9.10, 9.11). Events come from this project's
 * own database and from outbound links the reader opens: the app and the API
 * never name the CAACI website's database, an events page never opens a web
 * view, and no image of any source is rendered.
 */
const root = new URL('../', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')
const filesUnder = directory => readdirSync(new URL(directory, root), { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile())
  .map(entry => `${entry.parentPath.slice(new URL('.', root).pathname.length)}/${entry.name}`)

// The website's project reference is recognised by its digest, so that this
// public repository does not carry the reference itself.
const WEBSITE_PROJECT_DIGEST = 'cd907d5f61d9aac240478f0dcc41f2eac8d0fbf31246bb9f68d87287442a223a'
const projectReferences = (source, wanted) => [...source.matchAll(/(?<![a-z0-9])[a-z]{20}(?![a-z0-9])/g)]
  .filter(match => createHash('sha256').update(match[0]).digest('hex') === wanted)

test('neither the app nor the API names the CAACI website database', () => {
  const files = [...filesUnder('app/src'), ...filesUnder('api')]
    .filter(path => /\.(?:vue|ts|js|mjs|cjs|json|scss|css|html)$/.test(path))
  assert.ok(files.length > 150, `only ${files.length} files scanned`)
  const offenders = files.filter(path => projectReferences(read(path), WEBSITE_PROJECT_DIGEST).length > 0)
  assert.deepEqual(offenders, [])
  // Control: the detector finds a reference of the same shape inside a URL.
  assert.equal(projectReferences('fetch("https://abcdefghijklmnopqrst.supabase.co/rest/v1/events")',
    'dd65eea0329dcb94b17187af9dff28c31a1d78026737a16af75979a1fa4618e5').length, 1)
})

const EVENT_VIEWS = ['app/src/pages/events/index.vue', 'app/src/pages/event/detail/index.vue', 'app/src/components/EventCard.vue']

test('an events page opens no web view, renders no image, and sends every outbound link through the allowlist', () => {
  for (const path of EVENT_VIEWS) {
    const source = read(path)
    assert.doesNotMatch(source, /<web-view/i, path)
    assert.doesNotMatch(source, /<(?:image|img)\b|background-image|cover_url|image_url/i, path)
    // The only way out of the app is openExternalLink, which checks the host first.
    assert.doesNotMatch(source, /window\.open\(|location\.assign\(|\.href\s*=(?!\s*`mailto:)/, path)
  }
  for (const path of ['app/src/utils/communityEvents.ts', 'app/src/composables/useCommunityEvents.ts']) {
    assert.doesNotMatch(read(path), /cover_url|image_url/, path)
  }
  const detail = read('app/src/pages/event/detail/index.vue')
  // The fourth argument is only what the mini program says after it copied the link.
  assert.match(detail, /openExternalLink\(action\.url, row\.allowed_link_hosts \|\| \[\], language\.value, t\('events\.linkCopied'\)\)/)
  assert.match(read('app/src/utils/communityEvents.ts'), /isAllowedEventLink\(url, hosts\)/)
  // The pages read one function and one allowlisted projection; neither composable writes anything.
  const reads = read('app/src/composables/useCommunityEvents.ts')
  assert.match(reads, /supabase\.rpc\('list_community_events'/)
  assert.doesNotMatch(reads, /\.(?:insert|update|upsert|delete)\(/)
})

// pages.json as one build target sees it: uni-app drops the other target's blocks and allows trailing commas.
function pagesFor(target) {
  const kept = [true]
  const lines = read('app/src/pages.json').split('\n').filter(line => {
    const marker = /^\s*\/\/\s*#(ifdef|ifndef|endif)(?:\s+([A-Z0-9-]+))?\s*$/.exec(line)
    if (!marker) return kept.every(Boolean) && !/^\s*\/\//.test(line)
    if (marker[1] === 'endif') kept.pop()
    else kept.push((marker[2] === target) === (marker[1] === 'ifdef'))
    return false
  })
  return JSON.parse(lines.join('\n').replace(/,(\s*[\]}])/g, '$1'))
}

test('the list is in the main package and the detail page in its own subpackage', () => {
  const mp = pagesFor('MP-WEIXIN')
  const main = mp.pages.map(page => page.path)
  const packaged = mp.subPackages.flatMap(pack => pack.pages.map(page => `${pack.root}/${page.path}`))
  // P4.10 makes the list a tab, and a tab page must be in the main package (ENGINEERING 8).
  assert.ok(main.includes('pages/events/index'))
  assert.ok(!main.includes('pages/event/detail/index'))
  assert.ok(packaged.includes('pages/event/detail/index'))
  // A subpackage owns everything under its root, so the list must not sit under the detail page's root.
  assert.ok(mp.subPackages.every(pack => !'pages/events/index'.startsWith(`${pack.root}/`)))
  const web = pagesFor('H5').pages.map(page => page.path)
  assert.ok(web.includes('pages/events/index') && web.includes('pages/event/detail/index'))
})
