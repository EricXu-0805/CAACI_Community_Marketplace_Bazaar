const PROJECT_REF_RE = /^[a-z0-9]{20}$/
const VERCEL_ENVIRONMENTS = new Set(['production', 'preview', 'development'])

function value(env, name) {
  return String(env?.[name] || '').trim()
}

function normalizeOrigin(raw, { allowLoopbackHttp = false } = {}) {
  try {
    const url = new URL(String(raw || '').trim())
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (url.protocol !== 'https:' && !(allowLoopbackHttp && loopback && url.protocol === 'http:')) return ''
    if (url.username || url.password || url.search || url.hash) return ''
    if (url.pathname !== '/' && url.pathname !== '') return ''
    return url.origin
  } catch {
    return ''
  }
}

function vercelPreviewOrigin(raw) {
  const host = String(raw || '').trim().toLowerCase()
  if (!host) return ''
  const origin = normalizeOrigin(`https://${host}`)
  if (!origin) return ''
  try {
    return new URL(origin).host.toLowerCase() === host ? origin : ''
  } catch {
    return ''
  }
}

function supabaseProject(raw) {
  const origin = normalizeOrigin(raw)
  if (!origin) return null
  const url = new URL(origin)
  const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname)
  if (!match || url.port) return null
  return { origin, projectRef: match[1] }
}

function localResult(env, appOriginRaw) {
  return Object.freeze({
    ok: true,
    code: 'local_or_test',
    environment: value(env, 'NODE_TEST_CONTEXT') ? 'test' : 'development',
    appOrigin: normalizeOrigin(appOriginRaw, { allowLoopbackHttp: true }),
    supabaseOrigin: '',
    projectRef: '',
  })
}

/**
 * Bind every server-side Supabase request to one reviewed deployment identity.
 *
 * A Vercel environment name by itself is not an authorization boundary: a
 * production secret can be accidentally scoped to Preview. The expected tier
 * and exact Supabase project ref are therefore separate operator-owned
 * assertions. Production also requires an explicit canonical origin; Preview
 * binds to the unique current origin supplied by VERCEL_URL. Every value must
 * agree before a handler performs any upstream work.
 */
export function evaluateDeploymentBoundary({
  supabaseUrl,
  env = process.env,
} = {}) {
  const enforceInTests = value(env, 'CAACI_ENFORCE_DEPLOYMENT_BOUNDARY') === 'true'
  // Node's test-runner marker is only a local harness shortcut. Never allow a
  // user-configurable variable with that name to bypass the boundary inside a
  // real Vercel deployment identity.
  const detachedNodeTest = value(env, 'NODE_TEST_CONTEXT')
    && value(env, 'VERCEL') !== '1'
    && !value(env, 'VERCEL_ENV')
    && !value(env, 'VERCEL_URL')
  if (detachedNodeTest && !enforceInTests) {
    return localResult(env, value(env, 'DEPLOYMENT_APP_ORIGIN'))
  }

  const explicitLocal = value(env, 'CAACI_LOCAL_DEV') === 'true'
    && value(env, 'NODE_ENV') !== 'production'
    && value(env, 'VERCEL') !== '1'
    && !value(env, 'VERCEL_ENV')
    && !value(env, 'VERCEL_URL')
  if (explicitLocal && !enforceInTests) {
    return localResult(env, value(env, 'DEPLOYMENT_APP_ORIGIN'))
  }

  const actualEnvironment = value(env, 'VERCEL_ENV').toLowerCase()
  const expectedEnvironment = value(env, 'DEPLOYMENT_EXPECTED_VERCEL_ENV').toLowerCase()
  if (!VERCEL_ENVIRONMENTS.has(actualEnvironment)) {
    return Object.freeze({ ok: false, code: 'vercel_environment_missing' })
  }
  if (!VERCEL_ENVIRONMENTS.has(expectedEnvironment) || expectedEnvironment !== actualEnvironment) {
    return Object.freeze({ ok: false, code: 'vercel_environment_mismatch' })
  }
  if (value(env, 'VERCEL') !== '1' && actualEnvironment !== 'development') {
    return Object.freeze({ ok: false, code: 'vercel_identity_missing' })
  }

  const expectedProjectRef = value(env, 'SUPABASE_EXPECTED_PROJECT_REF').toLowerCase()
  if (!PROJECT_REF_RE.test(expectedProjectRef)) {
    return Object.freeze({ ok: false, code: 'supabase_project_ref_missing' })
  }
  const project = supabaseProject(supabaseUrl)
  if (!project || project.projectRef !== expectedProjectRef) {
    return Object.freeze({ ok: false, code: 'supabase_project_mismatch' })
  }

  const allowLoopbackHttp = actualEnvironment === 'development'
  const appOriginRaw = value(env, 'DEPLOYMENT_APP_ORIGIN')
  const explicitAppOrigin = normalizeOrigin(appOriginRaw, { allowLoopbackHttp })
  const previewOrigin = actualEnvironment === 'preview'
    ? vercelPreviewOrigin(value(env, 'VERCEL_URL'))
    : ''
  const appOrigin = explicitAppOrigin || (!appOriginRaw ? previewOrigin : '')
  if (!appOrigin) {
    return Object.freeze({ ok: false, code: 'app_origin_missing' })
  }

  if (actualEnvironment === 'preview') {
    if (!previewOrigin || appOrigin !== previewOrigin) {
      return Object.freeze({ ok: false, code: 'preview_origin_mismatch' })
    }
  }

  return Object.freeze({
    ok: true,
    code: 'ok',
    environment: actualEnvironment,
    appOrigin,
    supabaseOrigin: project.origin,
    projectRef: project.projectRef,
  })
}

export function deploymentBoundaryResponse(boundary) {
  if (boundary?.ok) return null
  return new Response(JSON.stringify({ error: 'deployment_configuration_invalid' }), {
    status: 503,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
    },
  })
}

export function isNonProductionDeployment(boundary) {
  return boundary?.environment === 'preview' || boundary?.environment === 'development'
}

export const deploymentBoundaryInternals = Object.freeze({
  normalizeOrigin,
  supabaseProject,
})
