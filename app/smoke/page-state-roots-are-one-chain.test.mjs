import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'

/**
 * A page's full-screen states — loaded, load-failed, not-found, loading — are
 * meant to be mutually exclusive. In the template they are spelled as one
 * v-if / v-else-if / v-else chain, and Vue builds that chain from *adjacent*
 * siblings only.
 *
 * On the detail page a modal (the rating sheet) had been written between the
 * `v-if="item"` root and the `v-else-if="loadError"` root. Vue therefore
 * chained the error, not-found and loading roots onto the modal's own
 * `v-if="item && showRating"`. On a listing that loaded fine with the sheet
 * closed, the chain fell through to the `v-else` and the page painted a second
 * full screen of spinner underneath the content — measured on production
 * 2026-08-31, still there after 15s, plus a duplicate `<h1>Loading</h1>` in the
 * accessibility tree.
 *
 * Nothing caught it: both builds pass, vue-tsc passes, and the compiler is
 * silent because the `v-else` does have an adjacent `v-if` — just the wrong
 * one. So the guard has to look at which chain each root actually landed in.
 */

const require = createRequire(import.meta.url)
const compiler = require('@vue/compiler-sfc')
const Vue = require('vue')

const PAGES = new URL('../src/pages/', import.meta.url)
const FULL_SCREEN = 'has-sidebar'

async function pageFiles(dir = PAGES) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...await pageFiles(new URL(`${entry.name}/`, dir)))
    else if (entry.name.endsWith('.vue')) out.push(new URL(entry.name, dir))
  }
  return out
}

function templateOf(source, filename) {
  const { descriptor } = compiler.parse(source, { filename })
  return descriptor.template?.content ?? ''
}

/** Root-level elements, in order, with their conditional directive. */
function rootElements(template, filename) {
  const ast = compiler.parse(`<template>${template}</template>`, { filename }).descriptor.template.ast
  return ast.children
    .filter(node => node.type === 1)
    .map(node => ({
      tag: node.tag,
      staticClass: node.props.find(p => p.type === 6 && p.name === 'class')?.value?.content ?? '',
      branch: node.props.find(p => p.type === 7 && ['if', 'else-if', 'else'].includes(p.name))?.name ?? null,
    }))
}

/**
 * Vue's own rule: v-else / v-else-if joins the chain of the element sibling
 * before it. Anything with v-if — or with no condition at all — starts fresh.
 */
function chainIds(roots) {
  let current = -1
  return roots.map((root, index) => {
    if (root.branch === 'else-if' || root.branch === 'else') return current
    current = index
    return root.branch === 'if' ? index : index
  })
}

test('a page never has two full-screen roots in different conditional chains', async () => {
  const offenders = []
  for (const file of await pageFiles()) {
    const name = file.pathname.slice(file.pathname.indexOf('/pages/') + 1)
    const roots = rootElements(templateOf(await readFile(file, 'utf8'), name), name)
    const ids = chainIds(roots)
    const chains = new Set(roots.map((r, i) => r.staticClass.includes(FULL_SCREEN) ? ids[i] : null).filter(id => id !== null))
    if (chains.size > 1) offenders.push(`${name}: ${chains.size} separate chains render '${FULL_SCREEN}' roots`)
  }
  assert.deepEqual(offenders, [])
})

test('the scan actually reads the pages it claims to cover', async () => {
  // Control: without this the test above passes by finding no pages, or by
  // finding pages whose roots it failed to parse.
  const files = await pageFiles()
  assert.ok(files.length > 15, `only ${files.length} page components found`)

  const detail = files.find(f => f.pathname.endsWith('/detail/index.vue'))
  const roots = rootElements(templateOf(await readFile(detail, 'utf8'), 'detail'), 'detail')
  const fullScreen = roots.filter(r => r.staticClass.includes(FULL_SCREEN))
  assert.equal(fullScreen.length, 4,
    'the detail page should still carry loaded / load-failed / not-found / loading roots')
  assert.deepEqual(fullScreen.map(r => r.branch), ['if', 'else-if', 'else-if', 'else'])
})

/** Render the template for one state and collect every static class it emits. */
function renderClasses(template, filename, state) {
  const { code, errors } = compiler.compileTemplate({
    source: template, id: 'guard', filename,
    compilerOptions: { mode: 'function', prefixIdentifiers: true },
  })
  assert.deepEqual(errors, [], `${filename} failed to compile`)

  const anything = new Proxy(function () { return '' }, { get: () => anything, apply: () => '' })
  const ctx = new Proxy({}, {
    has: () => true,
    get: (_, key) => (key in state ? state[key] : anything),
  })

  const classes = []
  const walk = node => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(walk)
    const cls = node.props?.class
    if (typeof cls === 'string') classes.push(cls)
    else if (Array.isArray(cls)) cls.forEach(part => typeof part === 'string' && classes.push(part))
    if (Array.isArray(node.children)) node.children.forEach(walk)
  }
  // Components resolve to nothing outside a real instance; that is fine here
  // and the warning would otherwise repeat for every node on the page.
  const warn = console.warn
  console.warn = () => {}
  try { walk(new Function('Vue', code)(Vue)(ctx, [])) } finally { console.warn = warn }
  return classes.join(' ')
}

async function detailTemplate() {
  const file = new URL('detail/index.vue', PAGES)
  return templateOf(await readFile(file, 'utf8'), 'detail/index.vue')
}

const LOADED = { item: { id: 'i' }, imgs: [], showRating: false, loadError: false, notFound: false }

test('a listing that loaded does not also paint the loading screen', async () => {
  const painted = renderClasses(await detailTemplate(), 'detail/index.vue', LOADED)
  assert.match(painted, /page has-sidebar/)
  assert.doesNotMatch(painted, /loading-page/, 'a loaded listing painted a second screen of spinner')
  assert.doesNotMatch(painted, /not-found-page/)
})

test('opening the rating sheet does not knock the page out of its own chain', async () => {
  const painted = renderClasses(await detailTemplate(), 'detail/index.vue', { ...LOADED, showRating: true })
  assert.match(painted, /page has-sidebar/)
  assert.match(painted, /sheet-mask/, 'the rating sheet stopped rendering')
  assert.match(painted, /rating-sheet/)
  assert.doesNotMatch(painted, /loading-page/)
})

test('each failure state still reaches the screen on its own', async () => {
  const template = await detailTemplate()
  const empty = { item: null, imgs: [], showRating: false, loadError: false, notFound: false }

  const failed = renderClasses(template, 'detail/index.vue', { ...empty, loadError: true })
  assert.match(failed, /not-found-page/)
  assert.doesNotMatch(failed, /loading-page/)

  const missing = renderClasses(template, 'detail/index.vue', { ...empty, notFound: true })
  assert.match(missing, /not-found-page/)
  assert.doesNotMatch(missing, /loading-page/)

  const pending = renderClasses(template, 'detail/index.vue', empty)
  assert.match(pending, /loading-page/, 'the loading screen no longer reaches a page that is still loading')
  assert.doesNotMatch(pending, /not-found-page/)
})
