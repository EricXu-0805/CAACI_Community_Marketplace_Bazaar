import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { verifyMpRuntime } from './verify-mp-runtime.mjs'

const PACKAGE_LIMIT = 2 * 1024 * 1024
// The emitted source is smaller than WeChat's final compiler/upload package.
// A 1.82 MiB local package was rejected as 2137 KB on 2026-09-17. Reserve
// compiler headroom here; only a real upload can certify the final size.
const SOURCE_BUDGET = Math.floor(1.6 * 1024 * 1024)
// Keep the startup package below the DevTools performance recommendation.
const MAIN_SOURCE_BUDGET = 1.5 * 1024 * 1024
// A share card's imageUrl is a path inside the code package, and WeChat takes a
// PNG or JPEG there, not an SVG. The card for a hidden topic (SPEC 6.10,
// app/src/utils/communityPost.ts) uses this file; without it the card has no
// image of its own.
export const MINI_SHARE_IMAGES = Object.freeze(['static/app-icon-192.png'])

export async function verifyMiniProgram(root, files) {
  const app = JSON.parse(await readFile(path.join(root, 'app.json'), 'utf8'))
  const project = JSON.parse(await readFile(path.join(root, 'project.config.json'), 'utf8'))
  if (!/^wx[0-9a-f]{16}$/.test(project.appid || '') || project.setting?.urlCheck !== true) {
    throw new Error('build_artifact_invalid: mini-program requires an AppID and domain validation enabled')
  }
  if (app.lazyCodeLoading !== 'requiredComponents') {
    throw new Error('build_artifact_invalid: mini-program requires component lazy loading')
  }
  const subpackages = app.subPackages || app.subpackages || []
  const packageRoots = subpackages.map(pkg => `${pkg.root.replace(/\/$/, '')}/`)
  const sizes = new Map([['main', 0], ...packageRoots.map(prefix => [prefix, 0])])
  for (const file of files) {
    const pkg = packageRoots.find(prefix => file.startsWith(prefix)) || 'main'
    sizes.set(pkg, sizes.get(pkg) + (await stat(path.join(root, file))).size)
    if (!file.endsWith('.wxss')) continue
    const css = (await readFile(path.join(root, file), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '')
    for (const match of css.matchAll(/([^{}]+)\{/g)) {
      if (/(?:^|[\s>+~,])\*(?=[\s.#:[>+~,]|$)/.test(match[1])) {
        throw new Error(`build_artifact_invalid: WXSS does not support universal selectors in ${file}`)
      }
    }
  }
  for (const [pkg, bytes] of sizes) {
    if (bytes > PACKAGE_LIMIT) throw new Error(`build_artifact_invalid: mini-program ${pkg} exceeds 2 MiB (${bytes} bytes)`)
    if (bytes > SOURCE_BUDGET) throw new Error(`build_artifact_invalid: mini-program ${pkg} exceeds 1.6 MiB source budget; leave room for WeChat compilation (${bytes} bytes)`)
    if (pkg === 'main' && bytes > MAIN_SOURCE_BUDGET) throw new Error(`build_artifact_invalid: mini-program main exceeds 1.5 MiB startup source budget (${bytes} bytes)`)
  }
  for (const tab of app.tabBar?.list || []) {
    if (!app.pages?.includes(tab.pagePath)) throw new Error(`build_artifact_invalid: mini-program tab page must remain in main package ${tab.pagePath}`)
  }
  const pages = [...(app.pages || []), ...subpackages.flatMap(pkg => pkg.pages.map(page => `${pkg.root}/${page}`))]
  if (!pages.length) throw new Error('build_artifact_invalid: no mini-program pages')
  for (const page of pages) {
    if (!files.includes(`${page}.js`) || !files.includes(`${page}.wxml`) || !files.includes(`${page}.json`)) {
      throw new Error(`build_artifact_invalid: missing mini-program page entry ${page}`)
    }
  }
  if (pages.includes('pages/admin/index')) throw new Error('build_artifact_invalid: H5 admin route included in mini-program')
  for (const image of MINI_SHARE_IMAGES) {
    if (!files.includes(image)) throw new Error(`build_artifact_invalid: mini-program share image ${image} is missing`)
  }
  const entry = await readFile(path.join(root, 'app.js'), 'utf8')
  if (entry.includes('rescueUnknownHashRoute')) throw new Error('build_artifact_invalid: H5 hash route recovery included in mini-program')
  await verifyMpRuntime(root)
  return { pages: pages.length, packageBytes: Object.fromEntries(sizes) }
}
