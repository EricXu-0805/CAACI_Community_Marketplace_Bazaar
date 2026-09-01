import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_ROOT = fileURLToPath(new URL('../', import.meta.url))
const SRC_ROOT = join(APP_ROOT, 'src')

function messageKeys(source) {
  return new Set([...source.matchAll(/^\s*'([^']+)'\s*:/gm)].map(match => match[1]))
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return ['.ts', '.vue'].includes(extname(entry.name)) ? [path] : []
  }))
  return nested.flat()
}

test('English and Chinese message catalogs have exact key parity', async () => {
  const [english, chinese] = await Promise.all([
    readFile(join(SRC_ROOT, 'composables/i18n/messages/en.ts'), 'utf8'),
    readFile(join(SRC_ROOT, 'composables/i18n/messages/zh.ts'), 'utf8'),
  ])
  const enKeys = messageKeys(english)
  const zhKeys = messageKeys(chinese)

  assert.deepEqual([...enKeys].sort(), [...zhKeys].sort())
})

test('literal translation lookups in application source resolve in both catalogs', async () => {
  const [english, chinese, files] = await Promise.all([
    readFile(join(SRC_ROOT, 'composables/i18n/messages/en.ts'), 'utf8'),
    readFile(join(SRC_ROOT, 'composables/i18n/messages/zh.ts'), 'utf8'),
    sourceFiles(SRC_ROOT),
  ])
  const enKeys = messageKeys(english)
  const zhKeys = messageKeys(chinese)
  const missing = []

  for (const file of files) {
    const source = await readFile(file, 'utf8')
    const executableSource = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    for (const match of executableSource.matchAll(/\b(?:t|tc|i18nT)\(\s*['"]([^'"]+)['"]\s*(?=[,)])/g)) {
      const key = match[1]
      if (!enKeys.has(key) || !zhKeys.has(key)) {
        missing.push(`${file.slice(APP_ROOT.length)}:${key}`)
      }
    }
  }

  assert.deepEqual(missing, [])
})

/*
 * The other direction: a key can exist in both catalogs and still never be
 * reached. `publish.obo` did — the publish toggle used it, but the two badges
 * that actually show on every negotiable listing wrote the word OBO straight
 * into the template, so a reader in Chinese got an English abbreviation with
 * no hint next to it to explain it.
 *
 * Asserts the forbidden shape, not the current one: bare Latin words as
 * element text. The exceptions are named, because each is a word that should
 * stay untranslated wherever it appears.
 */
const UNTRANSLATED = new Set([
  'EN',     // the language switch, which names the language it switches to
  'Illini', // the verification badge; a proper noun in both languages
])

test('user-visible words come from the catalogs, not from the template', async () => {
  const files = await sourceFiles(SRC_ROOT)
  const literals = []
  let elements = 0

  for (const file of files) {
    if (!file.endsWith('.vue')) continue
    const template = (await readFile(file, 'utf8')).split('</template>')[0]
    elements += [...template.matchAll(/<text\b/g)].length
    for (const match of template.matchAll(/<text\b[^>]*>([^<{}]+)<\/text>/g)) {
      const text = match[1].trim()
      if (text.length < 2 || UNTRANSLATED.has(text)) continue
      if (!/^[A-Za-z][A-Za-z0-9 .,'’!?&/:-]*$/.test(text)) continue
      literals.push(`${file.slice(APP_ROOT.length)}:${template.slice(0, match.index).split('\n').length}  ${JSON.stringify(text)}`)
    }
  }

  // Control: the scan must have read real templates, not zero of them.
  assert.ok(elements > 200, `only ${elements} <text> elements scanned`)
  assert.deepEqual(literals, [])
})
