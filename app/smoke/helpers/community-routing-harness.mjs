import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ref } from 'vue'
import ts from 'typescript'

// Runs the community page's own routing. The statements are cut from
// pages/plaza/index.vue as one build target compiles them, so nothing of the
// routing is copied here; a test supplies only what the routing calls out to.
const source = path => readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8')
const compile = input => ts.transpileModule(input, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText
const moduleUrl = input => `data:text/javascript;base64,${Buffer.from(compile(input)).toString('base64')}`

export const { communityNavigation, openCommunityBoard } = await import(moduleUrl(source('api/communityNavigation.ts')))
export const { POST_CATEGORIES } = await import(moduleUrl(source('utils/communityPost.ts')))

/** The script lines one build target keeps: uni-app drops the rest before compiling. */
export function compiledFor(target, script) {
  const kept = [true]
  const lines = script.split('\n').filter(line => {
    const marker = /^\s*\/\/\s*#(ifdef|ifndef|endif)(?:\s+([A-Z0-9-]+))?\s*$/.exec(line)
    if (!marker) return kept.every(Boolean)
    if (marker[1] === 'endif') {
      assert.ok(kept.length > 1, 'an #endif closes no block')
      kept.pop()
    } else {
      kept.push((marker[2] === target) === (marker[1] === 'ifdef'))
    }
    return false
  })
  assert.equal(kept.length, 1, 'a conditional block is left open')
  return lines.join('\n')
}

/**
 * The page's views and lifecycle for `target` ('MP-WEIXIN' or 'H5'), signed out.
 * `window` stands in for the browser's, and `uni` receives what the page asks of the platform.
 */
export function communityRouting(target, { window, uni = {} } = {}) {
  const page = source('pages/plaza/index.vue')
  const script = compiledFor(target, page.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1])
  const ast = ts.createSourceFile('page.ts', script, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  const text = (node, name) => {
    assert.ok(node, `${name} must exist in the ${target} build of the page`)
    return node.getText(ast)
  }
  const fn = name => text(ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name), name)
  const variable = name => text(ast.statements.find(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(declaration => declaration.name.getText(ast) === name)), name)
  // The callback of the first top-level registration of a lifecycle hook.
  const hook = name => {
    const statement = ast.statements.find(node => ts.isExpressionStatement(node)
      && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === name)
    assert.ok(statement, `${name} must be registered by the ${target} build of the page`)
    return statement.expression.arguments[0].getText(ast)
  }

  // The board each list read asked for, and each read of the home.
  const feedReads = []
  const homeReads = []
  const ticks = []
  const state = {
    selectedCategory: ref(null), searchText: ref(''), activeTab: ref('recent'),
    searchFocused: ref(false), pageIdx: ref(0), homeData: ref(null),
  }
  // openCommunityBoard is its own module and reaches the platform through the global.
  globalThis.uni = uni
  const dependencies = {
    ref, window, uni, communityNavigation, POST_CATEGORIES, ...state,
    loadFeed: () => { feedReads.push(state.selectedCategory.value) },
    loadHome: () => { homeReads.push(state.homeData.value) },
    nextTick: callback => ticks.push(callback),
    awaitAuthReady: async () => {}, currentUser: ref(null),
    composerMode: ref('topic'), COMPOSER_DRAFT_KEY: 'plaza_composer_draft_v1',
    removeAccountPrivateStorage() {}, resetComposer() {}, t: key => key,
  }
  const body = [
    variable('view'), variable('homeStale'), variable('plazaAccountEpoch'),
    ...['selectCategory', 'routeOf', 'syncAddress', 'followAddress', 'refreshStaleHome', 'showHome', 'showBoard',
      'showAll', 'openSearch', 'reloadPlazaForCurrentAccount', 'finishComposerPublication'].map(fn),
    `const onLoad = ${hook('onLoad')}`,
    `const onShow = ${hook('onShow')}`,
    `return {
      view, onLoad, onShow, showHome, showBoard, showAll, openSearch,
      mounted: reloadPlazaForCurrentAccount, publish: finishComposerPublication,
    }`,
  ].join('\n')
  const runtime = new Function(...Object.keys(dependencies), compile(body))(...Object.values(dependencies))
  return {
    ...runtime, ...state, feedReads, homeReads, ticks,
    /** A first visit: the query the page was opened with, the show that follows, then the mounted read. */
    async open(query) {
      runtime.onLoad(query)
      runtime.onShow()
      await runtime.mounted()
    },
  }
}
