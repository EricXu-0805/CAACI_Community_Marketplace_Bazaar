import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const viteConfig = readFileSync(resolve(appRoot, 'vite.config.ts'), 'utf8')
const pages = JSON.parse(readFileSync(resolve(appRoot, 'src/pages.json'), 'utf8'))
const blockedUrl = 'https://cdn.dcloud.net.cn/img/shadow-grey.png'

test('H5 build removes uni remote shadow preload instead of weakening CSP', () => {
  assert.match(viteConfig, /function removeUniH5RemoteShadowPreload\(\): Plugin/)
  assert.match(viteConfig, /source\.replaceAll\(remotePreload, 'none'\)/)
  assert.match(
    viteConfig,
    /uni\(\),\s*removeUniH5RemoteShadowPreload\(\),\s*chunkFileNamesForNodeModules\(\)/s,
  )

  const vercel = JSON.parse(readFileSync(resolve(appRoot, '../vercel.json'), 'utf8'))
  const csp = vercel.headers[0].headers.find(header => header.key === 'Content-Security-Policy').value
  assert.doesNotMatch(csp, /cdn\.dcloud\.net\.cn/)
  assert.ok(pages.pages.length > 0)
  assert.equal(
    pages.pages.every(page => page.style?.navigationStyle === 'custom'),
    true,
    'removing the unused preload assumes every route renders its own navigation',
  )
})

test('present H5 artifact contains no CSP-blocked DCloud preload', () => {
  const assets = resolve(appRoot, 'dist/build/h5/assets')
  if (!existsSync(assets)) return
  const offenders = readdirSync(assets)
    .filter(file => file.endsWith('.css'))
    .filter(file => readFileSync(resolve(assets, file), 'utf8').includes(blockedUrl))
  assert.deepEqual(offenders, [])
})
