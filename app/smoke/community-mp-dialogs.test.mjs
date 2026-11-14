import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import ts from 'typescript'
import { initScopedPreContext } from '../node_modules/@dcloudio/uni-cli-shared/dist/preprocess/context.js'

const source = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const compile = input => ts.transpileModule(input, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
// D-50: supervisor inspected WAServiceMainContext.js in base libraries
// 3.15.0, 3.15.1 and 3.15.2. Non-Latin-1 UTF-16 units count twice; max is 8.
// Older base libraries were not verified.
const modalUnits = text => text.replace(/[^\x00-\xff]/g, '##').length
// Exercise the pinned uni-app adapter, not a mock that preserves alertText.
const adapterSource = readFileSync(new URL('../node_modules/@dcloudio/uni-mp-weixin/dist/uni.api.esm.js', import.meta.url), 'utf8')
const adapterAst = ts.createSourceFile('uni.api.esm.js', adapterSource, ts.ScriptTarget.Latest, true)
const sheetAdapter = adapterAst.statements.filter(ts.isVariableStatement)
  .flatMap(statement => [...statement.declarationList.declarations])
  .find(declaration => declaration.name.getText(adapterAst) === 'showActionSheet')
assert.ok(sheetAdapter?.initializer, 'the pinned MP runtime exposes its action-sheet adapter')
const nativeSheetAdapter = new Function(`return (${sheetAdapter.initializer.getText(adapterAst)})`)()

function messages(lang) {
  const module = { exports: {} }
  new Function('module', 'exports', compile(source(`composables/i18n/messages/${lang}.ts`)))(module, module.exports)
  return module.exports.default
}

// Follow the platform-stack helpers in wechat-moderation-recovery.test.mjs.
function platformSource(input, platform) {
  const { preVueContext } = initScopedPreContext(platform.toLowerCase())
  const enabled = [true]
  return input.split('\n').filter(line => {
    const directive = line.match(/^\s*\/\/\s*#(ifdef|ifndef)\s+(.+)$/)
    if (directive) {
      const matches = directive[2].split(/\s*\|\|\s*/)
        .some(flag => preVueContext[flag.replace(/-/g, '_')])
      enabled.push(enabled.at(-1) && (directive[1] === 'ifdef' ? matches : !matches))
      return false
    }
    if (/^\s*\/\/\s*#endif/.test(line)) { enabled.pop(); return false }
    return enabled.at(-1)
  }).join('\n')
}

function cancelFixture(platform, lang) {
  const page = source('pages/plaza/index.vue')
  const input = page.slice(page.indexOf('function onComposerCancel()'), page.indexOf('\nfunction resetComposer()'))
  const dictionary = messages(lang)
  const state = { dialogs: [], saves: 0, removes: 0, resets: 0, current: true }
  const token = { userId: 'user-a', generation: 1 }
  const record = kind => options => {
    if (platform === 'MP-WEIXIN' && kind === 'modal') {
      for (const key of ['confirmText', 'cancelText']) {
        if (options[key]) assert.ok(modalUnits(options[key]) <= 8,
          `wx.showModal ${key} exceeds 8 units in ${lang}: ${options[key]}`)
      }
    }
    if (kind === 'sheet') assert.ok(options.itemList.length <= 6)
    const nativeOptions = { ...options }
    if (platform === 'MP-WEIXIN' && kind === 'sheet') nativeSheetAdapter.args(options, nativeOptions)
    state.dialogs.push({ kind, ...nativeOptions })
  }
  const scope = {
    submitting: { value: false },
    composerTitle: { value: 'Unsent topic' },
    composerText: { value: 'Unsent text' },
    composerImages: { value: [] },
    composerAttachedItems: { value: [] },
    outcomeUncertain: { value: false },
    composerAccountToken: token,
    composerSessionId: 1,
    COMPOSER_DRAFT_KEY: 'draft',
    isAccountRequestCurrent: candidate => state.current && candidate === token,
    saveComposerDraft: () => { state.saves++; return true },
    removeAccountPrivateStorage: () => { state.removes++ },
    resetComposer: () => { state.resets++ },
    t: key => { assert.ok(key in dictionary, key); return dictionary[key] },
    uni: { showModal: record('modal'), showActionSheet: record('sheet'), showToast() {} },
  }
  state.cancel = new Function(...Object.keys(scope),
    `${compile(platformSource(input, platform))}\nreturn onComposerCancel`)(...Object.values(scope))
  return state
}

for (const lang of ['en', 'zh']) {
  test(`MP-WEIXIN draft-close choices obey native dialog limits in ${lang}`, () => {
    const h = cancelFixture('MP-WEIXIN', lang)
    h.cancel()
    assert.equal(h.dialogs.length, 1)
  })

  test(`MP-WEIXIN draft-close title reaches the native action sheet in ${lang}`, () => {
    const h = cancelFixture('MP-WEIXIN', lang)
    h.cancel()
    assert.equal(h.dialogs[0].alertText, messages(lang)['plaza.draftCloseTitle'])
  })

  test(`MP-WEIXIN draft choices keep, discard, and ignore cancellation in ${lang}`, () => {
    const keep = cancelFixture('MP-WEIXIN', lang)
    keep.cancel()
    assert.equal(keep.dialogs[0].kind, 'sheet')
    assert.deepEqual(keep.dialogs[0].itemList, [messages(lang)['plaza.draftKeep'], messages(lang)['plaza.draftDiscard']])
    keep.dialogs[0].success({ tapIndex: 0 })
    assert.deepEqual([keep.saves, keep.removes, keep.resets], [1, 0, 1])
    const discard = cancelFixture('MP-WEIXIN', lang)
    discard.cancel()
    discard.dialogs[0].success({ tapIndex: 1 })
    assert.deepEqual([discard.saves, discard.removes, discard.resets], [0, 1, 1])
    const cancelled = cancelFixture('MP-WEIXIN', lang)
    cancelled.cancel()
    cancelled.dialogs[0].fail?.({ errMsg: 'showActionSheet:fail cancel' })
    assert.deepEqual([cancelled.saves, cancelled.removes, cancelled.resets], [0, 0, 0])
    cancelled.current = false
    cancelled.dialogs[0].success({ tapIndex: 1 })
    assert.equal(cancelled.resets, 0, 'an old account cannot close the current composer')
  })

  test(`H5 retains the SPEC draft-close modal and full wording in ${lang}`, () => {
    const h = cancelFixture('H5', lang)
    h.cancel()
    const dialog = h.dialogs[0]
    assert.equal(dialog.kind, 'modal')
    assert.equal(dialog.title, messages(lang)['plaza.draftCloseTitle'])
    assert.equal(dialog.confirmText, messages(lang)['plaza.draftKeep'])
    assert.equal(dialog.cancelText, messages(lang)['plaza.draftDiscard'])
    dialog.success({ confirm: true })
    assert.deepEqual([h.saves, h.removes, h.resets], [1, 0, 1])
  })

  test(`all MP-reachable app modal button labels fit the base-library rule in ${lang}`, () => {
    const dictionary = messages(lang)
    const [allPages, pages] = [source('pages.json'), platformSource(source('pages.json'), 'MP-WEIXIN')]
      .map(input => {
        const { config, error } = ts.parseConfigFileTextToJson('pages.json', input)
        assert.equal(error, undefined)
        return new Set([
          ...config.pages.map(page => `${page.path}.vue`),
          ...(config.subPackages || []).flatMap(pack => pack.pages.map(page => `${pack.root}/${page.path}.vue`)),
        ])
      })
    const visited = new Set()
    function files(directory = '') {
      return readdirSync(new URL(`../src/${directory}`, import.meta.url), { withFileTypes: true })
        .flatMap(entry => entry.isDirectory() ? files(`${directory}${entry.name}/`)
          : /\.(vue|ts|js)$/.test(entry.name) ? [`${directory}${entry.name}`] : [])
    }
    for (const path of files()) {
      if (allPages.has(path) && !pages.has(path)) continue
      const raw = platformSource(source(path), 'MP-WEIXIN')
      const script = path.endsWith('.vue')
        ? [...raw.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]).join('\n')
        : raw
      const ast = ts.createSourceFile(path, script, ts.ScriptTarget.Latest, true)
      function labels(expression) {
        if (ts.isStringLiteral(expression)) return [expression.text]
        if (ts.isConditionalExpression(expression)) return [...labels(expression.whenTrue), ...labels(expression.whenFalse)]
        assert.ok(ts.isCallExpression(expression) && expression.expression.getText(ast) === 't',
          `${path}: unhandled modal button expression ${expression.getText(ast)}`)
        const key = expression.arguments[0].text
        assert.ok(key in dictionary, `${path}: missing ${lang}:${key}`)
        return [dictionary[key]]
      }
      function visit(node) {
        if (ts.isCallExpression(node) && node.expression.getText(ast) === 'uni.showModal') {
          visited.add(path)
          assert.ok(ts.isObjectLiteralExpression(node.arguments[0]), `${path}: resolve this modal options object`)
          for (const property of node.arguments[0].properties) {
            assert.equal(ts.isSpreadAssignment(property), false, `${path}: resolve spread modal options`)
            if (!['confirmText', 'cancelText'].includes(property.name?.getText(ast))) continue
            for (const label of labels(property.initializer)) {
              assert.ok(modalUnits(label) <= 8, `${path}: ${label} = ${modalUnits(label)} units`)
            }
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(ast)
    }
    assert.ok(visited.has('pages/index/index.vue'), 'scan reaches the production discovery modals')
    assert.ok(visited.has('components/ChatThread.vue'), 'scan reaches modal calls in shared components')
    assert.equal(visited.has('pages/admin/index.vue'), false, 'H5-only admin routes are excluded')
  })
}

test('base-library modal units accept eight Latin units or four Chinese characters', () => {
  for (const text of ['Got it', 'Restore', 'Cancel', 'Messages', '一二三四']) {
    assert.ok(modalUnits(text) <= 8, text)
  }
  for (const text of ['Keep draft', '123456789', '一二三四五']) {
    assert.ok(modalUnits(text) > 8, text)
  }
})
