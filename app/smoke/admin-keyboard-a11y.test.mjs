import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from '../node_modules/typescript/lib/typescript.js'

const adminUrl = new URL('../src/pages/admin/index.vue', import.meta.url)
const registryUrl = new URL('../src/components/icons/registry.ts', import.meta.url)
const source = await readFile(adminUrl, 'utf8')

function functionSource(name) {
  const start = source.indexOf(`function ${name}`)
  assert.notEqual(start, -1, `${name} must exist`)
  const brace = source.indexOf('{', start)
  let depth = 0
  let quote = ''
  let escaped = false
  for (let index = brace; index < source.length; index += 1) {
    const char = source[index]
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = ''
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
      continue
    }
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  throw new Error(`unterminated ${name}`)
}

function compileFunction(name, dependencies = {}) {
  const javascript = ts.transpileModule(functionSource(name), {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const names = Object.keys(dependencies)
  return Function(...names, `${javascript}; return ${name}`)(...Object.values(dependencies))
}

test('every custom admin button is focusable, while busy actions leave the tab order', () => {
  const literalButtons = [...source.matchAll(/<(?:view|text|image|picker)\b[^>]*\brole="button"[^>]*>/gs)]
  assert.ok(literalButtons.length >= 40)
  for (const [markup] of literalButtons) {
    assert.match(markup, /(?:\btabindex="0"|:tabindex="[^"]+")/, markup)
    if (markup.includes(':aria-disabled=')) assert.match(markup, /:tabindex=/, markup)
  }
  assert.match(source, /:role="selectMode && g\.pending_count > 0 \? 'button' : undefined"[\s\S]*?:tabindex="selectMode && g\.pending_count > 0 \? 0 : undefined"/)
  assert.match(source, /\.admin \[role='button'\]:focus-visible/)
})

test('delegated Enter and Space activation fires exactly once and ignores disabled/repeat events', () => {
  const activate = compileFunction('onAdminKeyboardAction')
  const button = {
    disabled: false,
    clicks: 0,
    getAttribute(name) {
      if (name === 'aria-disabled') return this.disabled ? 'true' : 'false'
      if (name === 'tabindex') return this.disabled ? '-1' : '0'
      return null
    },
    click() { this.clicks += 1 },
  }
  const root = { contains: candidate => candidate === button }
  const origin = { closest: selector => selector === '[role="button"]' ? button : null }
  const event = (key, extra = {}) => ({
    key,
    target: origin,
    currentTarget: root,
    defaultPrevented: false,
    repeat: false,
    prevented: 0,
    stopped: 0,
    preventDefault() { this.prevented += 1 },
    stopPropagation() { this.stopped += 1 },
    ...extra,
  })

  const enter = event('Enter')
  activate(enter)
  assert.equal(button.clicks, 1)
  assert.equal(enter.prevented, 1)
  assert.equal(enter.stopped, 1)

  activate(event(' ', { repeat: true }))
  assert.equal(button.clicks, 1)
  button.disabled = true
  activate(event(' '))
  assert.equal(button.clicks, 1)
  button.disabled = false
  activate(event('Escape'))
  assert.equal(button.clicks, 1)
})

test('admin tabs support arrows, Home/End, Enter and Space with focus movement', () => {
  const selected = []
  const focused = []
  const tabs = [{ id: 'reports' }, { id: 'users' }, { id: 'audit' }]
  const tabHandler = compileFunction('onAdminTabKeydown', {
    tabList: { value: tabs },
    setTab: id => { selected.push(id) },
    nextTick: callback => callback(),
    setTimeout: callback => callback(),
    document: {
      getElementById: id => {
        const index = tabs.findIndex(tab => `admin-tab-${tab.id}` === id)
        return index < 0 ? null : { focus: () => focused.push(index) }
      },
    },
  })
  const parentElement = {
    querySelectorAll: () => tabs.map((_, index) => ({ focus: () => focused.push(index) })),
  }
  const event = key => ({
    key,
    repeat: false,
    currentTarget: { parentElement },
    preventDefault() {},
    stopPropagation() {},
  })

  tabHandler(event('ArrowRight'), 'reports')
  tabHandler(event('ArrowLeft'), 'reports')
  tabHandler(event('Home'), 'audit')
  tabHandler(event('End'), 'reports')
  tabHandler(event('Enter'), 'users')
  tabHandler(event(' '), 'audit')

  assert.deepEqual(selected, ['users', 'audit', 'reports', 'audit', 'users', 'audit'])
  assert.deepEqual(focused, [1, 2, 0, 2])
  assert.match(source, /:id="`admin-tab-\$\{tab\.id\}`"/)
  assert.match(source, /document\.getElementById\(targetId\)[\s\S]*typeof target\?\.focus === 'function'[\s\S]*target\.focus\(\)/)
  assert.doesNotMatch(source, /requestAnimationFrame\(focusTarget\)/)
  assert.match(source, /role="tab"[\s\S]*?:tabindex="activeTab === tab\.id \? 0 : -1"/)
  assert.match(source, /:aria-selected="activeTab === tab\.id \? 'true' : 'false'"/)
})

test('admin image actions are named, keyboard reachable, and chrome uses registry icons', async () => {
  const registry = await readFile(registryUrl, 'utf8')
  assert.match(source, /:src="p\.thumbnail" :alt="t\('a11y\.previewImage'\)"/)
  assert.match(source, /:src="bannerForm\.image_url" :alt="t\('a11y\.previewImage'\)"/)
  assert.match(source, /class="d-thumb"[^>]*role="button" tabindex="0"/)
  assert.match(source, /<UIcon name="refresh"/)
  assert.match(source, /<UIcon name="close"/)
  assert.doesNotMatch(source, /<text>↻<\/text>|<text>×<\/text>/)
  assert.match(registry, /'refresh-regular'/)
  assert.match(registry, /'close-regular'/)
})

test('owner warning is global and token health refreshes outside the token tab', () => {
  assert.match(source, /ownerRecovery && ownerRecovery\.status !== 'healthy'/)
  assert.match(source, /owner-recovery-compact/)
  const unlock = functionSource('onUnlock')
  const refresh = functionSource('refreshAll')
  for (const handler of [unlock, refresh]) {
    assert.match(handler, /canReadTokens\.value && activeTab\.value !== 'tokens'/)
    assert.match(handler, /loadTokens\(owner\)/)
  }
})

test('invalid token-revocation evidence is announced and focuses the first invalid field', () => {
  assert.match(source, /id="admin-token-revoke-case"[\s\S]*?:aria-invalid="tokenRevokeErrorVisible && !isSafeAuditEvidence\(tokenRevokeCaseId\)/)
  assert.match(source, /id="admin-token-revoke-approval"[\s\S]*?:aria-invalid="tokenRevokeErrorVisible && !isSafeAuditEvidence\(tokenRevokeApprovalRef\)/)
  assert.match(source, /id="admin-token-revoke-error"[\s\S]*?role="alert"/)
  const focus = functionSource('focusInvalidTokenRevokeEvidence')
  assert.match(focus, /tokenRevokeFocusField\.value = field/)
  assert.match(focus, /document\.getElementById\(`admin-token-revoke-\$\{field\}`\)[\s\S]*?target\?\.focus\(\)/)
  const confirm = functionSource('confirmTokenRevoke')
  assert.match(confirm, /tokenRevokeErrorVisible\.value = true[\s\S]*?focusInvalidTokenRevokeEvidence\(isSafeAuditEvidence\(caseId\) \? 'approval' : 'case'\)/)
})
