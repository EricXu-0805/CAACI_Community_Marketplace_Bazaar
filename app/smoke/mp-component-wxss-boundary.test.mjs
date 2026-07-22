import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import selectorParser from 'postcss-selector-parser'
import * as sass from 'sass'

const here = path.dirname(fileURLToPath(import.meta.url))
const sourceRoot = path.join(here, '../src')

function vueFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name)
    return entry.isDirectory() ? vueFiles(target) : entry.name.endsWith('.vue') ? [target] : []
  })
}

function keepForMpWeixin(source) {
  const activeSymbols = new Set(['MP-WEIXIN'])
  const stack = [true]

  return source.split('\n').filter((line) => {
    const marker = line.match(/\/\*\s*#(ifdef|ifndef|endif)\s*([^*]*)\*\//)
    if (!marker) return stack.every(Boolean)

    const [, directive, rawSymbols] = marker
    if (directive === 'endif') {
      assert.ok(stack.length > 1, 'unbalanced CSS conditional compilation marker')
      stack.pop()
      return false
    }

    const symbols = rawSymbols.trim().split(/\s*\|\|\s*/).filter(Boolean)
    const symbolMatches = symbols.some((symbol) => activeSymbols.has(symbol))
    stack.push(directive === 'ifdef' ? symbolMatches : !symbolMatches)
    return false
  }).join('\n')
}

function scopedStyleBlocks(source) {
  return [...source.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi)]
    .filter(([, attrs]) => /\bscoped\b/i.test(attrs))
    .map(([, attrs, body]) => ({
      body,
      isScss: /\blang=["']scss["']/i.test(attrs),
    }))
}

function isNumericNthArgument(node) {
  return node.type === 'tag'
    && node.parent?.type === 'pseudo'
    && /^:nth-(?:child|last-child|of-type|last-of-type)$/i.test(node.parent.value)
    && /^(?:[+-]?\d|even$|odd$)/i.test(node.value)
}

test('mp-weixin component WXSS avoids unsupported tag, ID, and attribute selectors', () => {
  const violations = []
  let checkedBlocks = 0

  for (const filename of vueFiles(sourceRoot)) {
    const source = fs.readFileSync(filename, 'utf8')
    for (const block of scopedStyleBlocks(source)) {
      checkedBlocks += 1
      const mpSource = keepForMpWeixin(block.body)
      const css = block.isScss
        ? sass.compileString(mpSource, { style: 'expanded' }).css
        : mpSource
      const root = postcss.parse(css)

      root.walkRules((rule) => {
        if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return

        selectorParser((selectors) => {
          selectors.walk((node) => {
            if (isNumericNthArgument(node)) return
            if (!['tag', 'id', 'attribute'].includes(node.type)) return
            violations.push(
              `${path.relative(sourceRoot, filename)} :: ${rule.selector} :: ${node.toString()}`,
            )
          })
        }).processSync(rule.selector)
      })
    }
  }

  assert.ok(checkedBlocks >= 40, `expected broad scoped-style coverage, got ${checkedBlocks}`)
  assert.deepEqual(violations, [])
})
