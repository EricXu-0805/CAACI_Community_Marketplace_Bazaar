import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/*
 * Two ways a label reached a reader in the wrong words.
 *
 * 1. Un-favoriting a listing toasted 'Save' / '收藏' — the favorite button's
 *    own call to action — so the confirmation of a removal read as an
 *    invitation to do the thing that had just been undone.
 *
 * 2. A campus spot is persisted as whatever label the editor's UI language
 *    produced ('Illini Union' or '伊利尼学生中心'; the column is free-form and
 *    also holds typed values like 'UIUC'), which is why useCampusSpots exports
 *    localizeLocation to resolve it back at render time. The item detail page
 *    called it. The two pages that show a *profile's* location did not, so a
 *    profile edited in English printed English at Chinese readers, and the
 *    editor's own chip row lost the selection whenever the language changed.
 */

const APP = new URL('../', import.meta.url)

function read(relative) {
  return readFileSync(new URL(relative, APP), 'utf8')
}

function templateOf(source) {
  const start = source.indexOf('<template>')
  const end = source.lastIndexOf('</template>')
  assert.ok(start !== -1 && end > start, 'no <template> block')
  return source.slice(start, end)
}

/* Brace-matched so a nested block inside the function cannot end the slice early. */
function functionBody(source, signature) {
  const start = source.indexOf(signature)
  assert.ok(start !== -1, `${signature} is gone`)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}' && --depth === 0) return source.slice(open, i + 1)
  }
  assert.fail(`${signature} has unbalanced braces`)
}

async function loadTs(relative) {
  const { transformSync } = await import('esbuild')
  const { code } = transformSync(read(relative), { loader: 'ts', format: 'cjs' })
  const module = { exports: {} }
  new Function('module', 'exports', code)(module, module.exports)
  return module.exports.default ?? module.exports
}

const DETAIL = 'src/pages/detail/index.vue'

test('the favorite toggle never reports what happened using the button’s call to action', async () => {
  const source = read(DETAIL)

  /*
   * The favorite control renders `isFav ? <saved> : <call to action>`. The
   * second branch is the word that invites a save; it can never be a true
   * statement about a toggle that already happened.
   */
  const callsToAction = new Set(
    [...templateOf(source).matchAll(/isFav\s*\?\s*t\('([^']+)'\)\s*:\s*t\('([^']+)'\)/g)]
      .map(match => match[2])
  )
  assert.equal(callsToAction.size, 1, 'the favorite button no longer labels itself off isFav — reread this test')

  const spoken = new Set(
    [...functionBody(source, 'async function toggleFavorite()').matchAll(/\bt\('([^']+)'\)/g)]
      .map(match => match[1])
  )
  assert.ok(spoken.size >= 2, 'toggleFavorite no longer says anything about either outcome')

  const [en, zh] = await Promise.all([
    loadTs('src/composables/i18n/messages/en.ts'),
    loadTs('src/composables/i18n/messages/zh.ts'),
  ])

  for (const cta of callsToAction) {
    assert.ok(!spoken.has(cta), `toggleFavorite speaks the button label '${cta}' instead of naming the outcome`)
    for (const key of spoken) {
      assert.ok(en[key] && zh[key], `${key} is missing from a catalog`)
      assert.notEqual(en[key], en[cta], `the English toast repeats the button label '${en[cta]}'`)
      assert.notEqual(zh[key], zh[cta], `the Chinese toast repeats the button label '${zh[cta]}'`)
    }
  }
})

/*
 * Forbidden shape, not the current one: a stored `.location` read that reaches
 * the screen without going through anything. Reading it as an argument is
 * fine — that is what localizing looks like — so the test walks the
 * interpolation and only objects when the read sits at paren depth zero.
 */
function rawLocationRenders(source) {
  const offenders = []
  for (const match of templateOf(source).matchAll(/\{\{[^}]*\}\}/g)) {
    const expression = match[0]
    let depth = 0
    let quote = ''
    for (let i = 0; i < expression.length; i++) {
      const char = expression[i]
      if (quote) { if (char === quote) quote = '' ; continue }
      if (char === '"' || char === "'" || char === '`') { quote = char; continue }
      if (char === '(') depth++
      else if (char === ')') depth--
      else if (depth === 0 && char === '.' && /^\.location\b(?!_)/.test(expression.slice(i))) {
        offenders.push(expression.trim())
        break
      }
    }
  }
  return offenders
}

/* Every name whose definition calls the localizer, however it is wrapped. */
function localizingNames(source) {
  const names = new Set()
  for (const call of source.matchAll(/localizeLocation\(/g)) {
    const declaration = [...source.slice(0, call.index).matchAll(/(?:const|function)\s+(\w+)\s*[=(]/g)].pop()
    if (declaration) names.add(declaration[1])
  }
  return names
}

test('no page prints a stored location string straight from the record', () => {
  const files = readdirSync(fileURLToPath(new URL('src/', APP)), { recursive: true })
    .filter(name => String(name).endsWith('.vue'))
  assert.ok(files.length > 20, 'the .vue sweep found almost nothing')

  let interpolations = 0
  let scanned = 0
  const offenders = []
  for (const file of files) {
    const source = read(`src/${file}`)
    if (!source.includes('</template>')) continue // App.vue has no template block
    scanned++
    interpolations += [...templateOf(source).matchAll(/\{\{[^}]*\}\}/g)].length
    for (const raw of rawLocationRenders(source)) offenders.push(`src/${file}: ${raw}`)
  }
  assert.ok(scanned > 20, `only ${scanned} templates scanned`)
  assert.ok(interpolations > 200, `only ${interpolations} interpolations scanned — the template slicing is wrong`)
  assert.deepEqual(offenders, [])

  // Control: the detector still fires on the shape it is meant to catch,
  assert.deepEqual(
    rawLocationRenders(`<template><text>{{ seller.location || 'UIUC' }}</text></template>`),
    ["{{ seller.location || 'UIUC' }}"]
  )
  // stays quiet once the same read is handed to something,
  assert.deepEqual(
    rawLocationRenders('<template><text>{{ localizedLocation(p.location) }}</text></template>'),
    []
  )
  // and never confuses a translation key or the verified flag for a place.
  assert.deepEqual(
    rawLocationRenders(`<template><text>{{ t('publish.location') }}{{ item.location_verified }}</text></template>`),
    []
  )
})

test('every surface showing a profile location shows the localized one', () => {
  const pages = [
    'src/pages/profile/index.vue',
    'src/pages/seller/index.vue',
    'src/pages/following/index.vue',
    'src/pages/plaza/index.vue',
  ]
  for (const page of pages) {
    const source = read(page)
    const localizing = localizingNames(source)
    assert.ok(localizing.size > 0, `${page} derives nothing from localizeLocation`)
    const template = templateOf(source)
    const shown = [...template.matchAll(/\{\{([^}]*)\}\}/g)].map(match => match[1])
    assert.ok(
      shown.some(expression => [...localizing].some(name => new RegExp(`\\b${name}\\b`).test(expression))),
      `${page} localizes a location but renders something else`
    )
  }
})

test('the profile editor keeps a saved spot selected across a language switch', async () => {
  const source = read('src/pages/profile/edit.vue')
  const template = templateOf(source)

  assert.equal(
    [...template.matchAll(/location\s*===\s*spotLabel\(/g)].length,
    0,
    'the chip row decides selection by comparing the stored value to a label in the current language'
  )

  const { matchSpot } = await loadTs('src/composables/useCampusSpots.ts')
  const spot = matchSpot('伊利尼学生中心')
  assert.ok(spot, 'matchSpot no longer resolves a Chinese label')
  assert.equal(matchSpot('Illini Union').id, spot.id)
  assert.equal(matchSpot('UIUC'), null, 'a typed free-form location must not claim a chip')
})

test('localizeLocation crosses languages and leaves free-form text alone', async () => {
  const { localizeLocation } = await loadTs('src/composables/useCampusSpots.ts')
  assert.equal(localizeLocation('Illini Union', 'zh'), '伊利尼学生中心')
  assert.equal(localizeLocation('伊利尼学生中心', 'en'), 'Illini Union')
  assert.equal(localizeLocation('Greg Hall', 'zh'), 'Greg Hall')
  assert.equal(localizeLocation('', 'en'), '')
})
