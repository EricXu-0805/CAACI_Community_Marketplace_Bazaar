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

test('WeChat tablet keeps primary navigation and page headers without an H5 sidebar', () => {
  const cssFor = relative => postcss.parse(scopedStyleBlocks(fs.readFileSync(path.join(sourceRoot, relative), 'utf8'))
    .map(block => block.isScss ? sass.compileString(keepForMpWeixin(block.body)).css : keepForMpWeixin(block.body)).join('\n'))
  const tab = cssFor('components/CustomTabBar.vue')
  let unconditionalDisplay = ''
  tab.walkRules(rule => {
    if (rule.selector === '.tabbar' && rule.parent.type === 'root') {
      rule.walkDecls('display', decl => { unconditionalDisplay = decl.value })
    }
  })
  assert.equal(unconditionalDisplay, 'flex', 'tablet needs tabs even above 767px')
  for (const page of ['index', 'plaza', 'messages', 'profile', 'publish']) {
    cssFor(`pages/${page}/index.vue`).walkRules(rule => {
      if (!['.mobile-header', '.page-header'].includes(rule.selector)) return
      rule.walkDecls('display', decl => assert.notEqual(decl.value, 'none', `${page}: no sidebar may replace this header in mp`))
    })
  }
  // The community tab's header is a component: its phone bar and board chips are
  // the mini program's, and the desktop header that replaces the H5 sidebar is not.
  const communityHeader = []
  cssFor('components/CommunityHeader.vue').walkRules(rule => {
    communityHeader.push(rule.selector)
    if (!['.cx-m', '.cx-top', '.cx-chips'].includes(rule.selector)) return
    rule.walkDecls('display', decl => assert.notEqual(decl.value, 'none', 'plaza: no sidebar may replace this header in mp'))
  })
  for (const selector of ['.cx-m', '.cx-top', '.cx-chips']) {
    assert.ok(communityHeader.includes(selector), `plaza: ${selector} must be styled in mp`)
  }
  assert.deepEqual(communityHeader.filter(selector => selector.includes('.cx-hdr')), [], 'plaza: the desktop header is H5 only')
  for (const page of ['detail/index', 'publish/edit']) {
    cssFor(`pages/${page}.vue`).walkDecls(decl => {
      assert.doesNotMatch(decl.value, /var\(--sidebar-w/, `${page}: mini-program actions must not reserve an absent sidebar`)
    })
  }
})

test('WeChat event headers reserve the native capsule before compilation', () => {
  for (const page of ['pages/events/index.vue', 'pages/event/detail/index.vue']) {
    const source = fs.readFileSync(path.join(sourceRoot, page), 'utf8')
    const css = scopedStyleBlocks(source).map(block => {
      const mpSource = keepForMpWeixin(block.body)
      return block.isScss ? sass.compileString(mpSource).css : mpSource
    }).join('\n')
    const insets = []
    postcss.parse(css).walkRules('.header', rule => {
      rule.walkDecls(/^(padding|padding-right)$/, declaration => {
        insets.push([declaration.prop, declaration.value])
      })
    })
    assert.deepEqual(
      insets.at(-1), ['padding-right', 'var(--mp-navbar-right-pad, 0px)'],
      `${page}: the last right-padding declaration must reserve the native capsule`,
    )
  }
})
