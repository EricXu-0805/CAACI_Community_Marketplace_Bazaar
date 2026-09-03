import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

/**
 * A listing's text is stored in an i18n map keyed by the language it was
 * written in, and `source_lang` records that language.
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
 * will ever get one.
 *
 * The first fix deferred to `detectsAsForeign`, whose English-UI branch wants
 * CJK with no Latin run of three letters or more. Almost nothing real clears
 * that bar: measured 2026-09-02, 6 of 6 CJK listings created after it shipped
 * were still filed 'en', because 'AirPods', 'Bose' and 'ISR' were sitting in
 * the title. So the cases below are brand names beside Chinese, which is what
 * this marketplace's listings actually look like.
 */

const APP = new URL('../', import.meta.url)

async function loadTs(relativePath) {
  const compiled = ts.transpileModule(await readFile(new URL(relativePath, APP), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
}

const { authoredLang } = await loadTs('src/composables/i18n/format.ts')

test('a listing is filed under the language it is written in, not the one being browsed in', () => {
  // The production row, exactly as it was typed.
  assert.equal(authoredLang('宠物航空箱 XL', 'en'), 'zh')
  assert.equal(authoredLang('宠物航空箱 32.225‘’', 'en'), 'zh')

  // And the same mistake in the other direction: browsing in Chinese, typing
  // English. Nobody has hit this one yet; it is the same bug.
  assert.equal(authoredLang('Pet travel crate, barely used', 'zh'), 'en')
})

test('a brand name does not make a Chinese listing English', () => {
  // Every one of these was filed 'en' on production after the first fix.
  for (const text of [
    'Dyson V8 吸尘器 九成新',
    'AirPods Pro 2 全新未拆封',
    'Bose QC45 降噪耳机 八成新',
    'JBL Flip 6 蓝牙音箱 九成新',
    '求购二手自行车，ISR 附近交易，价格面议。',
    '内测帖子：谁有多余的宿舍冰箱？Illini Union 附近可自取，价格好商量。',
  ]) {
    assert.equal(authoredLang(text, 'en'), 'zh', text)
    assert.equal(authoredLang(text, 'zh'), 'zh', text)
  }
})

test('text that agrees with the toggle is left alone', () => {
  assert.equal(authoredLang('宠物航空箱 XL', 'zh'), 'zh')
  assert.equal(authoredLang('Pet travel crate, barely used', 'en'), 'en')
})

test('text with no script signal keeps the UI language', () => {
  // Control: without these the helper could pass everything above by returning
  // a constant, or by keying off "is there any non-ASCII byte".
  for (const uiLang of ['en', 'zh']) {
    assert.equal(authoredLang('$120', uiLang), uiLang, 'a price has no language')
    assert.equal(authoredLang('', uiLang), uiLang, 'empty text has no language')
    assert.equal(authoredLang('🎉🎉', uiLang), uiLang, 'emoji have no language')
    assert.equal(authoredLang('Café résumé', uiLang), 'en', 'accented Latin is still Latin')
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

/**
 * An inverted rendering must never reach the database.
 *
 * Production carries description_i18n {"en": "用了一年…", "zh": "Used for a
 * year…"} — the author's Chinese under the English key, and the English
 * translation filed as the Chinese one. Both readers get the language they did
 * not ask for, and no later fill can repair it, because both keys are full.
 *
 * The fix above stops new rows being labelled wrongly, but the endpoint is
 * remote and will still hand back whatever it hands back, so the store side
 * checks the script of what it got before it keeps it.
 */
const translateSource = await readFile(new URL('src/composables/useTranslate.ts', APP), 'utf8')

function extractRegion(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  assert.ok(start >= 0 && end > start, `could not locate ${label} in useTranslate.ts`)
  return source.slice(start, end)
}

async function loadFillHarness() {
  const region = extractRegion(
    translateSource,
    '  function scriptMatchesTarget(',
    '\n  /*\n   * Translate both title and description',
    'the publish-time fill',
  )
  assert.match(region, /async function translateContentToAll\(/)
  const harness = `
    const TRANSLATABLE = ['zh', 'en']
    export function makeFill(renderings) {
      const translateResult = async (text, target) =>
        ({ text: renderings[target] ?? text, verified: true })
      ${region}
      return translateContentToAll
    }
  `
  const compiled = ts.transpileModule(harness, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
}

const { makeFill } = await loadFillHarness()

test('the publish-time fill refuses a rendering written in the wrong script', async () => {
  const chinese = '用了一年，音质很好，配件齐全。'

  // The production failure: labelled 'en', so an English rendering comes back
  // for target 'zh'. Storing it is what put English under the zh key.
  const inverted = await makeFill({ zh: 'Used for a year, sound quality is great.' })(chinese, 'en')
  assert.deepEqual(inverted, { en: chinese }, 'an English rendering must not be filed as Chinese')

  // Same shape the other way: Chinese offered as the English rendering.
  const backwards = await makeFill({ en: '用了一年，音质很好。' })('Used for a year.', 'en')
  assert.deepEqual(backwards, { en: 'Used for a year.' })

  // Control: a correct rendering is still stored, or the guard above could be
  // "store nothing" and pass.
  const good = await makeFill({ en: 'Used for a year, sound quality is great.' })(chinese, 'zh')
  assert.deepEqual(good, { zh: chinese, en: 'Used for a year, sound quality is great.' })

  // Control: an English rendering may carry a brand or a place name in CJK, so
  // the guard is a majority test, not a purity test.
  const mixed = await makeFill({ en: 'Bose QC45 headphones, 八成新 condition' })('Bose QC45 降噪耳机 八成新', 'zh')
  assert.deepEqual(mixed, {
    zh: 'Bose QC45 降噪耳机 八成新',
    en: 'Bose QC45 headphones, 八成新 condition',
  })
})

/**
 * A price edit must not touch the translations.
 *
 * edit.vue used to recompute source_lang and re-seed both i18n maps on every
 * save. Seeding a one-key map is how a translation gets requested, so a Chinese
 * listing that had grown a proper {en, zh} title map lost its English title the
 * moment its owner changed the price under an English UI — the row went back to
 * a single key, and the fill was asked for the wrong direction again.
 */
const editSource = await readFile(new URL('src/pages/publish/edit.vue', APP), 'utf8')

async function loadEditPayloadHarness() {
  const start = editSource.indexOf('    const trimmedTitle = form.title.trim()')
  const end = editSource.indexOf('    const updatedItem = await commitEditWithCompatibleRetry(')
  assert.ok(start >= 0 && end > start, 'could not locate the edit payload build in edit.vue')
  const region = editSource.slice(start, end)
  // Control: the region must be the one that decides the i18n columns.
  assert.match(region, /title_i18n/)
  assert.match(region, /source_lang/)

  const harness = `
    export function buildEditPayload(input, authoredLang) {
      const form = {
        title: input.title, description: input.description,
        category: 'other', condition: 'good', location: '', negotiable: false,
      }
      const lang = { value: input.uiLang }
      const loadedTitle = { value: input.loadedTitle }
      const loadedDescription = { value: input.loadedDescription }
      const price = input.price
      const images = []
      const finalDims = []
      ${region}
      return { payload, textChanged, sourceLang }
    }
  `
  const compiled = ts.transpileModule(harness, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
}

const editPayloadHarness = await loadEditPayloadHarness()
// The real helper, not a copy of it: relaxing authoredLang must show up here.
const buildEditPayload = input => editPayloadHarness.buildEditPayload(input, authoredLang)

const LOADED = {
  loadedTitle: 'Bose QC45 降噪耳机 八成新',
  loadedDescription: '用了一年，音质很好，配件齐全。',
}

test('a price-only edit leaves source_lang and the i18n maps alone', () => {
  const { payload, textChanged } = buildEditPayload({
    ...LOADED,
    title: LOADED.loadedTitle,
    description: LOADED.loadedDescription,
    uiLang: 'en',
    price: 45,
  })

  assert.equal(payload.price, 45, 'the price edit itself must still be written')
  assert.equal(textChanged, false)
  assert.ok(!('source_lang' in payload), 'source_lang must not be rewritten by a price edit')
  assert.ok(!('title_i18n' in payload), 'title_i18n must not be re-seeded by a price edit')
  assert.ok(!('description_i18n' in payload), 'description_i18n must not be re-seeded by a price edit')
})

test('editing one field re-seeds that field only', () => {
  const { payload, textChanged, sourceLang } = buildEditPayload({
    ...LOADED,
    title: LOADED.loadedTitle,
    description: '用了一年，音质很好，配件齐全，可小刀。',
    uiLang: 'en',
    price: 45,
  })

  assert.equal(textChanged, true)
  assert.equal(sourceLang, 'zh', 'the new text is Chinese whatever the toggle says')
  assert.ok(!('title_i18n' in payload), 'an untouched title keeps the map it already has')
  assert.deepEqual(payload.description_i18n, { zh: '用了一年，音质很好，配件齐全，可小刀。' })
  assert.equal(payload.source_lang, 'zh')
})

test('changed text is re-seeded under the language it is written in', () => {
  const { payload } = buildEditPayload({
    ...LOADED,
    title: 'AirPods Pro 2 全新未拆封',
    description: LOADED.loadedDescription,
    uiLang: 'en',
    price: 45,
  })

  assert.deepEqual(payload.title_i18n, { zh: 'AirPods Pro 2 全新未拆封' })
  assert.equal(payload.source_lang, 'zh')
})

test('the background translation fill runs only when text changed', () => {
  const start = editSource.indexOf('scheduleBilingualFill(\n      editId.value')
  assert.ok(start >= 0, 'could not locate the bilingual fill call in edit.vue')
  const guard = editSource.slice(Math.max(0, start - 120), start)
  assert.match(
    guard,
    /textChanged/,
    'the fill must be gated on a textual change; a price edit would otherwise rewrite both maps',
  )
})
