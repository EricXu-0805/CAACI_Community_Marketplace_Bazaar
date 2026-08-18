import assert from 'node:assert/strict'
import test from 'node:test'
import { readdir, readFile } from 'node:fs/promises'

/**
 * A backdrop has to be declared in the file that uses it.
 *
 * Every page here writes its styles in `<style scoped>`, so a class declared in
 * one page is invisible to another. plaza/index.vue's attach-item picker
 * carried `class="sheet-mask ..."` while `.sheet-mask` existed only inside
 * detail/index.vue and saved-searches/index.vue — it resolved to nothing, and
 * the backdrop was a transparent 390x0 strip that dimmed nothing and swallowed
 * no taps, behind a dialog marked aria-modal="true".
 *
 * A backdrop is the one element whose whole job is invisible-but-covering, so
 * a missing rule leaves no trace on screen until someone taps through it.
 */

const PAGES = new URL('../src/pages/', import.meta.url)
const COMPONENTS = new URL('../src/components/', import.meta.url)
// The global stylesheet: a class declared here IS available to every page.
const GLOBAL = new URL('../src/App.vue', import.meta.url)

const BACKDROP_CLASS_RE = /^[a-z][a-z0-9-]*(?:mask|backdrop|overlay|scrim)[a-z0-9-]*$/

async function vueFiles(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir)
    if (entry.isDirectory()) out.push(...await vueFiles(url))
    else if (entry.name.endsWith('.vue')) out.push(url)
  }
  return out
}

function classAttributes(source) {
  const template = source.slice(0, source.indexOf('<style') === -1 ? undefined : source.indexOf('<style'))
  const names = new Set()
  for (const [, value] of template.matchAll(/\bclass="([^"]*)"/g)) {
    for (const name of value.split(/\s+/)) if (name) names.add(name)
  }
  // :class="['a', { 'b': cond }]" — take every quoted literal inside.
  for (const [, value] of template.matchAll(/:class="([^"]*)"/g)) {
    for (const [, name] of value.matchAll(/'([^']+)'/g)) names.add(name)
  }
  return names
}

function stripCssComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
}

test('every backdrop class a page uses is declared where it can reach it', async () => {
  const globalSource = stripCssComments(await readFile(GLOBAL, 'utf8'))
  const files = [...await vueFiles(PAGES), ...await vueFiles(COMPONENTS)]
  const undeclared = []

  for (const file of files) {
    const source = await readFile(file, 'utf8')
    const styleStart = source.indexOf('<style')
    // Comments out: a comment that names the class satisfies a text search
    // while declaring nothing, and the comment explaining this very bug sits
    // right beside the rule it is about.
    const styles = styleStart === -1 ? '' : stripCssComments(source.slice(styleStart))
    for (const name of classAttributes(source)) {
      // Only backdrop-ish names: this is about the one element whose absence
      // of styling is invisible, not about every unstyled class in the app.
      if (!BACKDROP_CLASS_RE.test(name)) continue
      // u-* is the global-primitive prefix and lives in App.vue by convention.
      if (name.startsWith('u-')) continue
      // A class name is only declared if the selector ENDS there. Substring
      // matching says `.sheet-mask` is declared by `.sheet-mask-over-composer`,
      // which is exactly the pair that shipped this bug.
      const selector = new RegExp(`\\.${name.replace(/[.*+?^$()|[\]\\]/g, '\\$&')}(?![\\w-])`)
      const declared = selector.test(styles) || selector.test(globalSource)
      if (!declared) {
        undeclared.push(`${file.pathname.split('/src/')[1]}: .${name}`)
      }
    }
  }

  assert.deepEqual(undeclared, [], 'a backdrop class resolves to nothing where it is used '
    + '(styles are scoped per file):\n  ' + undeclared.join('\n  '))
})

/*
 * The control. If the scan stops finding backdrop classes at all — a rename,
 * a template refactor, a regex that no longer matches — the test above passes
 * while checking nothing.
 */
test('the scan still finds the backdrops it is meant to check', async () => {
  const files = [...await vueFiles(PAGES), ...await vueFiles(COMPONENTS)]
  const found = []
  for (const file of files) {
    const source = await readFile(file, 'utf8')
    for (const name of classAttributes(source)) {
      if (BACKDROP_CLASS_RE.test(name) && !name.startsWith('u-')) found.push(name)
    }
  }
  assert.ok(found.length >= 4, `only found ${found.length} backdrop classes: ${found.join(', ')}`)
})
