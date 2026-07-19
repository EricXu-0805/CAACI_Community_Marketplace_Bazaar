import { readFile } from 'node:fs/promises'

const boundarySource = await readFile(new URL('./_deployment-boundary.js', import.meta.url), 'utf8')
export const deploymentBoundaryModuleUrl = `data:text/javascript;base64,${Buffer.from(boundarySource).toString('base64')}`

export function inlineDeploymentBoundaryImport(source) {
  return source.replace(
    /from\s+(['"])(?:\.\.\/|\.\/)_deployment-boundary\.js\1/g,
    `from '${deploymentBoundaryModuleUrl}'`,
  )
}
