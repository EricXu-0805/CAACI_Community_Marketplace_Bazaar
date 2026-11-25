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

test('WeChat event header cascade preserves the native capsule inset', () => {
  function headerSubject(selector) {
    const nodes = []
    selector.each(node => nodes.push(node))
    const last = nodes.slice(nodes.map(node => node.type).lastIndexOf('combinator') + 1)
    if (!last.some(node => node.type === 'class' && node.value === 'header')) return null
    const spec = [0, 0, 0]
    selector.walk(node => {
      if (node.type === 'id') spec[0]++
      else if (node.type === 'class' || node.type === 'attribute' || (node.type === 'pseudo' && !node.value.startsWith('::'))) spec[1]++
      else if (node.type === 'tag' || (node.type === 'pseudo' && node.value.startsWith('::'))) spec[2]++
    })
    return spec
  }

  for (const page of ['pages/events/index.vue', 'pages/event/detail/index.vue']) {
    const css = scopedStyleBlocks(fs.readFileSync(path.join(sourceRoot, page), 'utf8')).map(block => {
      const mpSource = keepForMpWeixin(block.body)
      return block.isScss ? sass.compileString(mpSource).css : mpSource
    }).join('\n')
    const candidates = []
    let order = 0
    postcss.parse(css).walkRules(rule => {
      for (let ancestor = rule.parent; ancestor; ancestor = ancestor.parent) {
        if (ancestor.type === 'atrule' && ancestor.name !== 'media') return
      }
      const specificities = []
      selectorParser(selectors => {
        selectors.each(selector => {
          const spec = headerSubject(selector)
          if (spec) specificities.push(spec)
        })
      }).processSync(rule.selector)
      const spec = specificities.sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2])[0]
      if (!spec) return
      rule.walkDecls(/^(padding|padding-right|padding-inline|padding-inline-end)$/, declaration => {
        candidates.push({ spec, important: Boolean(declaration.important), order: order++,
          prop: declaration.prop, value: declaration.value })
      })
    })
    const winner = candidates.sort((a, b) => Number(b.important) - Number(a.important)
      || b.spec[0] - a.spec[0] || b.spec[1] - a.spec[1] || b.spec[2] - a.spec[2] || b.order - a.order)[0]
    assert.ok(winner, `${page}: the header must have a padding declaration`)
    assert.equal(`${winner.prop}: ${winner.value}`, 'padding-right: var(--mp-navbar-right-pad, 0px)',
      `${page}: the winning header padding must reserve the native capsule`)
  }
})
