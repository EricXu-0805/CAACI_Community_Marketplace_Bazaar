import { readFile } from 'node:fs/promises'

// A handler is loaded as a data: URL, so any relative import it still carries
// cannot resolve. Every shared api/_*.js helper must therefore be inlined here;
// adding one to a handler without adding it to this map breaks every suite that
// loads that handler.
const SHARED_MODULES = ['_http-boundary.js', '_video-moderation.js', '_cron-monitor.js', '_cron-release.js', '_deployment-boundary.js', '_sentry-report.js', '_moderation-media.js', '_listing-translation.js', '_street-location.js', '_public-content-translation.js', '_wechat-media-path.js', '_community-events.js', '_community-events-sync.js']

const sources = new Map(await Promise.all(SHARED_MODULES.map(async name => {
  const source = await readFile(new URL(`./${name}`, import.meta.url), 'utf8')
  return [name, source]
})))
const inlined = new Map()
const resolving = new Set()

function inlineModule(name) {
  if (inlined.has(name)) return inlined.get(name)
  if (resolving.has(name)) throw new Error(`shared_api_module_cycle: ${name}`)
  resolving.add(name)
  const source = inlineSharedApiImports(sources.get(name))
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
  resolving.delete(name)
  inlined.set(name, url)
  return url
}
for (const name of SHARED_MODULES) inlineModule(name)

export const deploymentBoundaryModuleUrl = inlined.get('_deployment-boundary.js')
export const sentryReportModuleUrl = inlined.get('_sentry-report.js')

export function inlineSharedApiImports(source) {
  let result = source
  result = result.replace(/from\s+(['"])(?:\.\.\/|\.\/)(_[\w-]+\.js)\1/g, (match, _quote, name) =>
    sources.has(name) ? `from '${inlineModule(name)}'` : match)
  return result
}
