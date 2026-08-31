import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

/**
 * A listing's text is stored in an i18n map keyed by the language it was
 * written in, and `source_lang` records that language. Both used to be taken
 * from the UI toggle.
 *
 * Production 2026-08-31, the first real listing on the site:
 *
 *   title            宠物航空箱 XL
 *   source_lang      en
 *   title_i18n       {"en": "宠物航空箱 XL"}      ← no zh entry at all
 *
 * The seller was browsing in English and typed Chinese. Because the fill
 * translates into every language except the source, calling the listing
 * English asked for a Chinese rendering of Chinese, got the same string back,
 * and stored nothing. English was never requested — so no reader who needs it
 * will ever get one, for this listing or any other written this way.
 */

const APP = new URL('../', import.meta.url)

const { authoredLang } = await import(
  `data:text/javascript;base64,${Buffer.from(
    ts.transpileModule(await readFile(new URL('src/composables/i18n/format.ts', APP), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    }).outputText,
  ).toString('base64')}`
)

test('a listing is filed under the language it is written in, not the one being browsed in', () => {
  // The production row, exactly as it was typed. "XL" is two letters, under
  // the detector's 3-letter Latin threshold, so this is unambiguously Chinese.
  assert.equal(authoredLang('宠物航空箱 XL', 'en'), 'zh')
  assert.equal(authoredLang('宠物航空箱 32.225‘’', 'en'), 'zh')

  // And the same mistake in the other direction: browsing in Chinese, typing
  // English. Nobody has hit this one yet; it is the same bug.
  assert.equal(authoredLang('Pet travel crate, barely used', 'zh'), 'en')
})

test('text that agrees with the toggle is left alone', () => {
  assert.equal(authoredLang('宠物航空箱 XL', 'zh'), 'zh')
  assert.equal(authoredLang('Pet travel crate, barely used', 'en'), 'en')
})

test('text with no signal, or signal both ways, keeps the UI language', () => {
  // Control: without these the helper could pass the tests above by keying off
  // "contains any CJK" and flipping every listing a Chinese speaker writes in
  // English on a Chinese UI.
  for (const uiLang of ['en', 'zh']) {
    assert.equal(authoredLang('$120', uiLang), uiLang, 'a price has no language')
    assert.equal(authoredLang('', uiLang), uiLang, 'empty text has no language')
    assert.equal(authoredLang('宠物航空箱 XL for sale', uiLang), uiLang, 'mixed text is not a guess to make')
  }
})

test('no write path takes the UI language as the authored language', async () => {
  const WRITE_PATHS = [
    'src/pages/publish/index.vue',
    'src/pages/publish/edit.vue',
    'src/pages/plaza/index.vue',
  ]
  const offenders = []
  let assignments = 0
  for (const path of WRITE_PATHS) {
    const source = await readFile(new URL(path, APP), 'utf8')
    for (const match of source.matchAll(/const sourceLang = (.+)/g)) {
      assignments += 1
      // The forbidden form, not the current one: any future spelling that
      // derives the language from the text is fine, the toggle is not.
      if (/^lang\.value/.test(match[1].trim())) offenders.push(`${path}: ${match[1].trim()}`)
    }
  }
  // Control: the scan must have found the sites it is judging.
  assert.equal(assignments, WRITE_PATHS.length, `found ${assignments} sourceLang assignments across ${WRITE_PATHS.length} write paths`)
  assert.deepEqual(offenders, [])
})
