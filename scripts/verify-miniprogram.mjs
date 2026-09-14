import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { verifyMpRuntime } from './verify-mp-runtime.mjs'

const PACKAGE_LIMIT = 2 * 1024 * 1024

export async function verifyMiniProgram(root, files) {
  const app = JSON.parse(await readFile(path.join(root, 'app.json'), 'utf8'))
  const project = JSON.parse(await readFile(path.join(root, 'project.config.json'), 'utf8'))
  if (!/^wx[0-9a-f]{16}$/.test(project.appid || '') || project.setting?.urlCheck !== true) {
    throw new Error('build_artifact_invalid: mini-program requires an AppID and domain validation enabled')
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
  }
  const pages = [...(app.pages || []), ...subpackages.flatMap(pkg => pkg.pages.map(page => `${pkg.root}/${page}`))]
  if (!pages.length) throw new Error('build_artifact_invalid: no mini-program pages')
  for (const page of pages) {
    if (!files.includes(`${page}.js`) || !files.includes(`${page}.wxml`) || !files.includes(`${page}.json`)) {
      throw new Error(`build_artifact_invalid: missing mini-program page entry ${page}`)
    }
  }
  if (pages.includes('pages/admin/index')) throw new Error('build_artifact_invalid: H5 admin route included in mini-program')
  const entry = await readFile(path.join(root, 'app.js'), 'utf8')
  if (entry.includes('rescueUnknownHashRoute')) throw new Error('build_artifact_invalid: H5 hash route recovery included in mini-program')
  await verifyMpRuntime(root)
  return { pages: pages.length, packageBytes: Object.fromEntries(sizes) }
}
