import { deploymentBoundaryResponse, evaluateDeploymentBoundary } from './_deployment-boundary.js'
import { cronDeploymentIdentity, CRON_RELEASE_NONCE_RE } from './_cron-release.js'

export const config = { runtime: 'edge' }

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'CDN-Cache-Control': 'no-store',
      'Vercel-CDN-Cache-Control': 'no-store',
      ...extraHeaders,
    },
  })
}

// Public, read-only runtime metadata. No database query, credential, or monitor
// event is needed to prove which deployment the canonical domain is serving.
export default async function handler(request) {
  const boundary = evaluateDeploymentBoundary({ supabaseUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL })
  const deploymentError = deploymentBoundaryResponse(boundary)
  if (deploymentError) return deploymentError
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' })
  const params = new URL(request.url).searchParams
  const nonce = params.get('nonce') || ''
  if (params.getAll('nonce').length !== 1 || !CRON_RELEASE_NONCE_RE.test(nonce)) {
    return json({ error: 'invalid_nonce' }, 400)
  }
  const identity = cronDeploymentIdentity(boundary)
  if (!identity) return json({ error: 'deployment_identity_unavailable' }, 503)
  return json({ ...identity, nonce })
}
