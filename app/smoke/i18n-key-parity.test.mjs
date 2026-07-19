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
