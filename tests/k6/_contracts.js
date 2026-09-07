// Pure contracts shared by k6 and the deterministic Node regression suite.
const PRODUCTION_PROJECTS = new Set(['lfhvgprfphyfvhidegum'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function origin(value) {
  const normalized = String(value || '').trim().replace(/\/+$/, '').toLowerCase()
  if (!/^https?:\/\/(?:[a-z0-9.-]+|\[::1\])(?::\d{1,5})?$/.test(normalized)) {
    throw new Error('Load-test targets must be exact HTTP(S) origins without credentials, paths, or queries.')
  }
  return normalized
}

export function assertLoadTarget(env) {
  const db = origin(env.SUPABASE_URL)
  const app = origin(env.APP_ORIGIN)
  const kind = (env.K6_TARGET_ENV || '').trim().toLowerCase()
  if (!['local', 'staging', 'production'].includes(kind)) throw new Error('K6_TARGET_ENV is required.')
  if (db !== origin(env.K6_EXPECTED_SUPABASE_URL) || app !== origin(env.K6_EXPECTED_APP_ORIGIN)) {
    throw new Error('Targets do not match the separately reviewed expected origins.')
  }
  const production = PRODUCTION_PROJECTS.has(db.match(/^https:\/\/([a-z0-9]+)\.supabase\.co$/)?.[1])
    || /^https:\/\/(?:www\.)?illinimarket\.com$/.test(app)
    || /caaci-community-marketplace.*\.vercel\.app$/.test(app)
  if (production && kind !== 'production') throw new Error('A known production target cannot be labelled staging/local.')
  if (kind === 'production' && env.K6_ALLOW_PRODUCTION_LOAD_TESTS !== 'I_UNDERSTAND_THIS_WILL_LOAD_PRODUCTION') {
    throw new Error('Production load tests require an approved maintenance plan.')
  }
  if (env.K6_DATASET_IS_SYNTHETIC !== 'true') throw new Error('K6_DATASET_IS_SYNTHETIC=true is required.')
  if (kind === 'local' && ![db, app].every(url => /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(url))) {
    throw new Error('Local load tests must use loopback targets.')
  }
  if (kind !== 'local' && ![db, app].every(url => url.startsWith('https://'))) {
    throw new Error('Hosted load tests must use HTTPS.')
  }
  return { db, app }
}

export function parseAccounts(raw) {
  const lines = String(raw || '').split(/\r?\n/).filter(line => line.trim())
  if (!lines.length) throw new Error('At least one synthetic account is required; an empty run is not a pass.')
  return lines.map((line, index) => {
    const colon = line.indexOf(':')
    const email = line.slice(0, colon).trim()
    const password = line.slice(colon + 1)
    if (colon < 1 || !email.includes('@') || !password) throw new Error(`Malformed account on line ${index + 1}.`)
    return { email, password }
  })
}

export function databaseOutcome(response) {
  if (response.status === 201 || response.status === 204) return 'accepted'
  let body
  try { body = typeof response.body === 'string' ? JSON.parse(response.body) : response.body } catch { return 'unexpected' }
  if (![400, 409, 429].includes(response.status) || !body) return 'unexpected'
  if (body.code === 'P0001' && /^rate_limit_[a-z_]+$/.test(body.message || '')) return 'limited'
  if (body.code === 'P0001' && /^moderation_block:/.test(body.message || '')) return 'moderated'
  if (body.code === '23505' && /uq_reports_pending_per_reporter_target/.test(body.message || '')) return 'duplicate_report'
  return 'unexpected'
}

export function assertUuid(value, name) {
  if (!UUID.test(value || '')) throw new Error(`${name} must be a UUID from the synthetic dataset.`)
  return value
}
