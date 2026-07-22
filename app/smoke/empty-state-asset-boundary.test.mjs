import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { basename, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const appRoot = resolve(fileURLToPath(new URL('../', import.meta.url)))
const source = relative => readFileSync(resolve(appRoot, relative), 'utf8')

function vueFiles(dir) {
  return readdirSync(resolve(appRoot, dir), { withFileTypes: true }).flatMap(entry => {
    const relative = `${dir}/${entry.name}`
    if (entry.isDirectory()) return vueFiles(relative)
    return entry.name.endsWith('.vue') ? [relative] : []
  })
}

test('every empty-state theme maps to a checked-in raster illustration', () => {
  const component = source('src/components/UEmptyArt.vue')
  const declared = new Set(component.match(/const PNG_SET = new Set\(\[([^\]]+)\]\)/)?.[1]
    ?.match(/'([^']+)'/g)?.map(value => value.slice(1, -1)) || [])
  const assetDir = resolve(appRoot, 'src/static/empty')
  const files = readdirSync(assetDir).filter(name => extname(name) === '.png')
  const assets = new Set(files.map(name => basename(name, '.png')))
  assert.deepEqual([...declared].sort(), [...assets].sort())
  assert.ok(declared.size > 0)

  for (const file of files) {
    const png = readFileSync(resolve(assetDir, file))
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], file)
    assert.ok(png.readUInt32BE(16) >= 256, `${file} is too narrow`)
    assert.ok(png.readUInt32BE(20) >= 256, `${file} is too short`)
  }
})

test('all literal empty-state names resolve and the component avoids injected artwork', () => {
  const component = source('src/components/UEmptyArt.vue')
  const declared = new Set(component.match(/const PNG_SET = new Set\(\[([^\]]+)\]\)/)?.[1]
    ?.match(/'([^']+)'/g)?.map(value => value.slice(1, -1)) || [])
  const used = new Set()
  for (const file of vueFiles('src')) {
    const text = source(file)
    for (const [tag] of text.matchAll(/<UEmptyArt\b(?:[^>"']|"[^"]*"|'[^']*')*>/gs)) {
      for (const [, name] of tag.matchAll(/['"](bag|search|messages|favorites|posts|following|history)['"]/g)) {
        used.add(name)
      }
    }
  }
  assert.ok(used.size > 0)
  for (const name of used) assert.ok(declared.has(name), `missing empty-state asset: ${name}`)
  assert.doesNotMatch(component, /v-html|<svg|data:image\/svg|<text[^>]*>[\s\S]*[\u{1F300}-\u{1FAFF}]/u)
  assert.match(component, /<image v-if="hasImg" :src="imgSrc"/)
})
