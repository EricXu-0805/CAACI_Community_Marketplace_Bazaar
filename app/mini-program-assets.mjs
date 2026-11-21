import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'

// Uni copies every shared static asset, even those only used by the web/PWA
// entry or old banner examples. Keep their web URLs intact, but do not ship
// them in the WeChat package. Runtime logos, empty states and onboarding
// illustrations are deliberately not on this list. Neither is
// app-icon-192.png: the share card of a hidden topic points at it
// (src/utils/communityPost.ts).
export const MINI_UNUSED_WEB_ASSETS = Object.freeze([
  'static/app-icon-512.png',
  'static/banner-publish.png',
  'static/banner-safety.png',
  'static/banner-welcome.png',
  'static/manifest.webmanifest',
  'static/robots.txt',
])

export async function pruneMiniProgramWebAssets(outputDir) {
  // Refuse a source directory or an H5 output: only generated WeChat builds
  // contain both of these manifests with a concrete WeChat AppID.
  const app = JSON.parse(await readFile(path.join(outputDir, 'app.json'), 'utf8'))
  const project = JSON.parse(await readFile(path.join(outputDir, 'project.config.json'), 'utf8'))
  if (!Array.isArray(app.pages) || !/^wx[0-9a-f]{16}$/.test(project.appid || '')) {
    throw new Error('mini-assets: expected a generated WeChat package')
  }
  await Promise.all(MINI_UNUSED_WEB_ASSETS.map(file => rm(path.join(outputDir, file), { force: true })))
}

export function miniProgramAssets(platform) {
  let outputDir
  return {
    name: 'mini-program-web-asset-boundary',
    apply: 'build',
    configResolved(config) {
      outputDir = path.resolve(config.root, config.build.outDir)
    },
    async closeBundle() {
      // Uni's awaited writeBundle copies static files before closeBundle.
      if (platform === 'mp-weixin') await pruneMiniProgramWebAssets(outputDir)
    },
  }
}
