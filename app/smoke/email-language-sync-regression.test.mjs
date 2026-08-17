import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = relativePath => readFileSync(resolve(appRoot, relativePath), 'utf8')

function moduleDataUrl(input) {
  return `data:text/javascript;base64,${Buffer.from(input).toString('base64')}`
}

function compiledDataUrl(input, suffix = '') {
  const output = ts.transpileModule(input, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText
  return `${moduleDataUrl(output)}#${suffix}`
}

let moduleSequence = 0
async function loadEmailLanguageHarness({ storedLang = '', systemLang = 'zh', responses = [] } = {}) {
  moduleSequence += 1
  const suffix = String(moduleSequence)
  const calls = []
  const storage = new Map(storedLang ? [['lang', storedLang]] : [])
  const responseQueue = [...responses]

  globalThis.uni = {
    getStorageSync: key => storage.get(key) ?? '',
    setStorageSync: (key, value) => storage.set(key, value),
    setLocale: () => {},
  }
  globalThis.__emailLanguageTestSupabase = {
    async rpc(name, args) {
      calls.push({ name, args })
      const response = responseQueue.shift()
      if (response instanceof Error) throw response
      return response ?? { data: null, error: null }
    },
  }

  const mocks = {
    vue: `
      export const ref = value => ({ value })
      export const computed = getter => ({ get value(){ return getter() } })
    `,
    './i18n/types': `
      export const DEFAULT_LANG = 'zh'
      export const SUPPORTED_LANGS = [{ code: 'zh' }, { code: 'en' }]
      export const coerceLang = value => value === 'zh' || value === 'en' ? value : null
    `,
    './i18n/detect': `export const detectSystemLang = () => '${systemLang}'`,
    './i18n/messages': `export const messages = { zh: {}, en: {} }`,
    './i18n/translate': `
      export const getAutoLocalized = () => undefined
      export const scheduleAutoTranslate = () => {}
    `,
    './i18n/format': `
      export const detectsAsForeign = () => false
      export const interpolate = value => value
    `,
  }
  const mockUrls = Object.fromEntries(
    Object.entries(mocks).map(([specifier, input]) => [specifier, moduleDataUrl(input)]),
  )
  const accountScopeUrl = compiledDataUrl(source('src/composables/accountScope.ts'), `scope-${suffix}`)
  const supabaseUrl = moduleDataUrl(`
    export function useSupabase(){
      return { supabase: globalThis.__emailLanguageTestSupabase }
    }
  `)

  let i18nInput = source('src/composables/useI18n.ts')
  for (const [specifier, url] of Object.entries(mockUrls)) {
    i18nInput = i18nInput.replaceAll(`'${specifier}'`, `'${url}'`)
  }
  i18nInput = i18nInput
    .replaceAll("'./accountScope'", `'${accountScopeUrl}'`)
    .replaceAll("'./useSupabase'", `'${supabaseUrl}'`)

  const accountScope = await import(accountScopeUrl)
  const i18n = await import(compiledDataUrl(i18nInput, `i18n-${suffix}`))
  return { accountScope, calls, i18n, storage }
}

test('the language resolved before login is persisted after the account becomes active', async () => {
  const { accountScope, calls, i18n } = await loadEmailLanguageHarness({
    systemLang: 'en',
    responses: [{ data: null, error: null }],
  })

  const api = i18n.useI18n()
  assert.equal(api.lang.value, 'en')
  assert.equal(calls.length, 0, 'signed-out initialization has no account row to write')

  accountScope.transitionAccount('account-a')
  await i18n.syncActiveAccountEmailLanguage()

  assert.deepEqual(calls, [{
    name: 'set_my_email_language',
    args: { p_lang: 'en' },
  }])
})

test('a resolved or thrown RPC failure is retryable on later auth transitions', async () => {
  for (const failure of [
    { data: null, error: new Error('temporary database failure') },
    new TypeError('temporary network failure'),
  ]) {
    const { accountScope, calls, i18n } = await loadEmailLanguageHarness({
      storedLang: 'en',
      responses: [failure, { data: null, error: null }],
    })
    i18n.useI18n()
    accountScope.transitionAccount('account-a')

    await i18n.syncActiveAccountEmailLanguage()
    assert.equal(calls.length, 1)

    accountScope.transitionAccount(null)
    accountScope.transitionAccount('account-a')
    await i18n.syncActiveAccountEmailLanguage()
    assert.equal(calls.length, 2, 'the failed attempt must not poison the success cache')

    await i18n.syncActiveAccountEmailLanguage()
    assert.equal(calls.length, 2, 'a confirmed write for this account/language is one-shot')
  }
})

test('a language action retries an unconfirmed write without duplicating confirmed writes', async () => {
  const { accountScope, calls, i18n } = await loadEmailLanguageHarness({
    storedLang: 'en',
    responses: [
      { data: null, error: new Error('temporary database failure') },
      { data: null, error: null },
    ],
  })
  const api = i18n.useI18n()
  accountScope.transitionAccount('account-a')

  await i18n.syncActiveAccountEmailLanguage()
  api.setLang('en')
  // This helper is also the queue barrier for setLang's fire-and-forget write.
  await i18n.syncActiveAccountEmailLanguage()
  assert.equal(calls.length, 2)

  api.setLang('en')
  await i18n.syncActiveAccountEmailLanguage()
  assert.equal(calls.length, 2)
})

test('authenticated session application dynamically schedules the language sync on every retry opportunity', () => {
  const auth = source('src/composables/useAuth.ts')
  const applyStart = auth.indexOf('  async function applySession(')
  const applyEnd = auth.indexOf('\n  async function initializeAuth()', applyStart)
  assert.ok(applyStart >= 0 && applyEnd > applyStart)
  const applySession = auth.slice(applyStart, applyEnd)

  assert.match(applySession, /transitionAccount\(userId\)[^]*?import\('\.\/useI18n'\)/)
  assert.match(applySession, /syncActiveAccountEmailLanguage\(\)/)
  assert.match(applySession, /captureAccountRequest\(userId\)[^]*?isAccountRequestCurrent/)
})
