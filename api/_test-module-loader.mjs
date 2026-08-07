import { readFile } from 'node:fs/promises'

// A handler is loaded as a data: URL, so any relative import it still carries
// cannot resolve. Every shared api/_*.js helper must therefore be inlined here;
// adding one to a handler without adding it to this map breaks every suite that
// loads that handler.
const SHARED_MODULES = ['_deployment-boundary.js', '_sentry-report.js']

const inlined = new Map(await Promise.all(SHARED_MODULES.map(async name => {
  const source = await readFile(new URL(`./${name}`, import.meta.url), 'utf8')
  return [name, `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`]
})))

export const deploymentBoundaryModuleUrl = inlined.get('_deployment-boundary.js')
export const sentryReportModuleUrl = inlined.get('_sentry-report.js')

export function inlineSharedApiImports(source) {
  let result = source
  for (const [name, url] of inlined) {
    const escaped = name.replace(/\./g, '\\.')
    result = result.replace(
      new RegExp(String.raw`from\s+(['"])(?:\.\.\/|\.\/)${escaped}\1`, 'g'),
      `from '${url}'`,
    )
  }
  return result
}
