// Validates an existing-session browser observation supplied by the host.
// This module does not connect to Chrome, inspect cookies/tokens, create bypass
// links, or establish that the host's observation is authentic. The capture
// callback is a trust boundary: today it represents ordinary browser navigation
// and human/screen confirmation, not an implemented automatic DOM bridge.
import { performance } from 'node:perf_hooks'

const PATH = '/api/deployment-identity'
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const CAPTURE_MODE = 'existing-session-screen-confirmation'
const CODES = new Set([
  'invalid_options', 'invalid_target', 'capture_unavailable', 'nonce_reused',
  'capture_failed', 'capture_timeout', 'invalid_clock', 'invalid_receipt',
  'url_mismatch', 'stale_observation', 'future_observation', 'observation_predates_request',
  'evidence_reused', 'identity_invalid',
])

export class BrowserIdentityError extends Error {
  constructor(code) {
    // Even an injected callback throwing this class cannot smuggle an arbitrary
    // message through the reader's error boundary.
    const safeCode = CODES.has(code) ? code : 'capture_failed'
    super(`release_browser_${safeCode}`)
    this.name = 'BrowserIdentityError'
    this.code = `release_browser_${safeCode}`
  }
}

function requireValue(condition, code) {
  if (!condition) throw new BrowserIdentityError(code)
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactOrigin(value) {
  if (typeof value !== 'string' || value.length > 253) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && value === url.origin && url.hostname.length > 0
  } catch { return false }
}

function timestamp(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function identityValue(value, nonce) {
  requireValue(record(value) && value.schema === 1 && value.environment === 'production'
    && typeof value.deploymentId === 'string' && value.deploymentId.length <= 132
    && /^dpl_[A-Za-z0-9]+$/.test(value.deploymentId) && !/[^A-Za-z0-9_]/.test(value.deploymentId)
    && typeof value.commit === 'string' && value.commit.length === 40 && /^[0-9a-f]+$/.test(value.commit)
    && typeof value.projectRef === 'string' && value.projectRef.length === 20 && /^[a-z0-9]+$/.test(value.projectRef)
    && ['https://illinimarket.com', 'https://www.illinimarket.com'].includes(value.appOrigin)
    && value.nonce === nonce, 'identity_invalid')
  // Deployment/SHA/projectRef equality with the prepared release is still the
  // runner's responsibility. A browser receipt never replaces those guards.
  return { schema: 1, environment: 'production', deploymentId: value.deploymentId,
    commit: value.commit, projectRef: value.projectRef, appOrigin: value.appOrigin, nonce }
}

function boundedCapture(capture, input, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = performance.now() + timeoutMs
    const timer = setTimeout(() => reject(new BrowserIdentityError('capture_timeout')), timeoutMs)
    Promise.resolve().then(() => {
      if (performance.now() >= deadline) throw new BrowserIdentityError('capture_timeout')
      return capture(input)
    }).then(
      value => {
        clearTimeout(timer)
        // A synchronous host callback may block the event loop past the timer.
        if (performance.now() >= deadline) reject(new BrowserIdentityError('capture_timeout'))
        else resolve(value)
      },
      () => {
        clearTimeout(timer)
        reject(new BrowserIdentityError(performance.now() >= deadline ? 'capture_timeout' : 'capture_failed'))
      },
    )
  })
}

export function createBrowserIdentityReader(options = {}) {
  requireValue(record(options), 'invalid_options')
  const { capture, allowedOrigins, now = Date.now, maxAgeMs = 60_000, timeoutMs = 120_000 } = options
  requireValue((capture === undefined || typeof capture === 'function') && typeof now === 'function'
    && Array.isArray(allowedOrigins) && allowedOrigins.length > 0 && allowedOrigins.length <= 100
    && allowedOrigins.every(exactOrigin) && new Set(allowedOrigins).size === allowedOrigins.length
    && Number.isSafeInteger(maxAgeMs) && maxAgeMs > 0 && maxAgeMs <= 300_000
    && Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 300_000, 'invalid_options')
  // Copy the fixed metadata-derived allowlist. No wildcard or mutable callback
  // can extend access while an observation is in flight.
  const origins = new Set(allowedOrigins)
  const usedNonces = new Set()
  const usedEvidence = new Set()

  return async function readIdentity(input = {}) {
    try {
      requireValue(record(input), 'invalid_target')
      const { origin, nonce } = input
      requireValue(exactOrigin(origin) && origins.has(origin) && typeof nonce === 'string'
        && nonce.length === 36 && UUID_V4.test(nonce), 'invalid_target')
      requireValue(typeof capture === 'function', 'capture_unavailable')
      requireValue(!usedNonces.has(nonce), 'nonce_reused')
      // Consume before the first await, including failures and timeouts. This is
      // per-reader replay resistance, not persistent/cross-session replay storage.
      usedNonces.add(nonce)
      const requestedAt = now()
      requireValue(timestamp(requestedAt), 'invalid_clock')
      const requestedUrl = `${origin}${PATH}?nonce=${nonce}`
      const receipt = await boundedCapture(capture, Object.freeze({ requestedUrl, origin, nonce, requestedAt }), timeoutMs)
      const completedAt = now()
      requireValue(timestamp(completedAt) && completedAt >= requestedAt, 'invalid_clock')
      requireValue(record(receipt) && receipt.captureMode === CAPTURE_MODE
        && timestamp(receipt.observedAt) && typeof receipt.evidenceRef === 'string'
        && receipt.evidenceRef.length > 0 && receipt.evidenceRef.length <= 256
        && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(receipt.evidenceRef)
        && !/[^A-Za-z0-9._:/-]/.test(receipt.evidenceRef), 'invalid_receipt')
      // Full strings must match: even an otherwise benign redirect, fragment,
      // encoded query, or extra query parameter cannot satisfy this challenge.
      requireValue(receipt.requestedUrl === requestedUrl && receipt.observedUrl === requestedUrl, 'url_mismatch')
      requireValue(receipt.observedAt >= requestedAt, 'observation_predates_request')
      requireValue(receipt.observedAt <= completedAt, 'future_observation')
      requireValue(completedAt - receipt.observedAt <= maxAgeMs, 'stale_observation')
      requireValue(!usedEvidence.has(receipt.evidenceRef), 'evidence_reused')
      const identity = identityValue(receipt.identity, nonce)
      usedEvidence.add(receipt.evidenceRef)
      return Object.freeze({ ...identity, browserEvidence: Object.freeze({ requestedUrl,
        observedUrl: requestedUrl, requestedAt, observedAt: receipt.observedAt, completedAt,
        evidenceRef: receipt.evidenceRef, captureMode: CAPTURE_MODE }) })
    } catch (error) {
      // Do not attach causes, raw callback errors, page bodies, or receipt fields.
      const code = error instanceof BrowserIdentityError
        ? error.code.replace(/^release_browser_/, '') : 'capture_failed'
      throw new BrowserIdentityError(code)
    }
  }
}
