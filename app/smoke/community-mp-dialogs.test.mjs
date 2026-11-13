import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const compile = input => ts.transpileModule(input, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
function messages(lang) {
  const module = { exports: {} }
  new Function('module', 'exports', compile(source(`composables/i18n/messages/${lang}.ts`)))(module, module.exports)
  return module.exports.default
}

// Follow the platform-stack helpers in wechat-moderation-recovery.test.mjs.
function platformSource(input, platform) {
  const enabled = [true]
  return input.split('\n').filter(line => {
    const directive = line.match(/\/\/ #(ifdef|ifndef) (H5|MP-WEIXIN)/)
    if (directive) {
      enabled.push(enabled.at(-1) && (directive[1] === 'ifdef' ? directive[2] === platform : directive[2] !== platform))
      return false
    }
    if (line.includes('// #endif')) { enabled.pop(); return false }
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
        if (options[key]) assert.ok(Array.from(options[key]).length <= 4,
          `wx.showModal ${key} exceeds 4 characters in ${lang}: ${options[key]}`)
      }
    }
    if (kind === 'sheet') assert.ok(options.itemList.length <= 6)
    state.dialogs.push({ kind, ...options })
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

  test(`all explicit community MP-WEIXIN modal button labels fit in ${lang}`, () => {
    const dictionary = messages(lang)
    let modals = 0
    for (const path of ['pages/plaza/index.vue', 'pages/post/index.vue']) {
      const script = platformSource(source(path).match(/<script setup lang="ts">([^]*?)<\/script>/)[1], 'MP-WEIXIN')
      const ast = ts.createSourceFile(path, script, ts.ScriptTarget.Latest, true)
      function visit(node) {
        if (ts.isCallExpression(node) && node.expression.getText(ast) === 'uni.showModal') {
          modals++
          for (const property of node.arguments[0].properties) {
            if (!['confirmText', 'cancelText'].includes(property.name?.getText(ast))) continue
            const key = property.initializer.arguments[0].text
            assert.ok(key in dictionary, key)
            assert.ok(Array.from(dictionary[key]).length <= 4, `${path}: ${key} = ${dictionary[key]}`)
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(ast)
    }
    assert.ok(modals >= 5, 'control: retain the compliant moderation and deletion confirmations')
  })
}
