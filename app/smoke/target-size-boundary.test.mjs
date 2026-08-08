import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = relativePath => readFileSync(resolve(appRoot, relativePath), 'utf8')

/*
 * WCAG 2.5.8 targets that are smaller than 24px and cannot use the spacing
 * exception, because each one is nested inside a larger target with a
 * different action — miss the small one and you fire the big one instead.
 * Measured in a browser, not inferred: getBoundingClientRect cannot see the
 * ::after that carries the hit region, so the check that matters is
 * document.elementFromPoint on a 24px ring (0/8 before, 8/8 after).
 */
const UNDERSIZED_TARGETS = [
  { file: 'src/pages/search/index.vue', selector: 'chip-x', wrongAction: 'runs the search instead of deleting the entry' },
  { file: 'src/pages/search/index.vue', selector: 'sf-clear', wrongAction: 'submits instead of clearing the field' },
  { file: 'src/pages/index/index.vue', selector: 'sf-clear', wrongAction: 'navigates instead of clearing the field' },
  { file: 'src/pages/plaza/index.vue', selector: 'post-more', wrongAction: 'opens the post instead of its menu' },
  { file: 'src/pages/plaza/index.vue', selector: 'pc-translate', wrongAction: 'opens the post instead of translating it' },
  { file: 'src/pages/plaza/index.vue', selector: 'cs-like-btn', wrongAction: 'long-presses the comment instead of liking it' },
  { file: 'src/pages/plaza/index.vue', selector: 'cs-reply-btn', wrongAction: 'long-presses the comment instead of replying' },
  { file: 'src/pages/post/index.vue', selector: 'cs-like-btn', wrongAction: 'long-presses the comment instead of liking it' },
  { file: 'src/pages/post/index.vue', selector: 'cs-reply-btn', wrongAction: 'long-presses the comment instead of replying' },
]

test('every undersized target still carries its hit region', () => {
  for (const { file, selector, wrongAction } of UNDERSIZED_TARGETS) {
    // Line-based: some of these carry a static class attribute and some an
    // array :class binding, and both put the whole class list on one line.
    const asToken = new RegExp(`(?:class="|')${selector}[ '"]`)
    const lines = source(file).split('\n').filter(line => asToken.test(line))
    assert.ok(lines.length > 0, `${selector} no longer exists in ${file}`)
    for (const line of lines) {
      assert.match(
        line,
        /hit-target/,
        `${file}: ${selector} lost .hit-target — a near miss now ${wrongAction}`,
      )
    }
  }
})

test('the hit region grows without moving anything', () => {
  const app = source('src/App.vue')
  const utility = app.slice(app.indexOf('.hit-target {'), app.indexOf('.sr-only {'))

  // Absolutely positioned so it never enters layout, and centred rather than
  // inset from one corner: an inset grows only right and down, which leaves
  // the enlarged region offset from the glyph the user is aiming at.
  assert.match(utility, /position: absolute;/)
  assert.match(utility, /top: 50%;\n\s*left: 50%;\n\s*transform: translate\(-50%, -50%\);/)
  assert.match(utility, /min-width: 24px;/)
  assert.match(utility, /min-height: 24px;/)
  // 100% keeps an already-large target exactly as large as it was.
  assert.match(utility, /width: 100%;\n\s*height: 100%;/)
})
