// A single HTTP attempt, not an exactly-once remote effect guarantee. The
// release runner must durably persist intent before calling promote() and must
// retain unknown outcomes for read-only reconciliation. No secrets are read
// at import, construction, or capability inspection.
import https from 'node:https'
import { debuglog } from 'node:util'
import { performance } from 'node:perf_hooks'
import { RELEASE_PROJECT } from './check-ci-first-release.mjs'

const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]{1,128}$/
const TEAM_ID = /^team_[A-Za-z0-9]{1,128}$/
const PATH_TEMPLATE = '/v10/projects/{projectId}/promote/{deploymentId}'
const MAX_BODY_BYTES = 4096
const MAX_HEADER_BYTES = 16 * 1024
const DEBUG_NAMES = ['http', 'https', 'http2', 'net', 'tls']
const initialDebug = DEBUG_NAMES.map(name => debuglog(name))
const traceTls = value => /(?:^|\s|["'])--trace-tls(?:$|\s|["'])/.test(value)
const initialTlsTrace = process.execArgv.includes('--trace-tls') || traceTls(process.env.NODE_OPTIONS || '')

export class HttpsPromotionError extends Error {
  constructor(code) {
    super(code)
    this.name = 'HttpsPromotionError'
    this.code = code
  }
}
const error = code => new HttpsPromotionError(`release_https_${code}`)
function requireValue(condition, code) { if (!condition) throw error(code) }

function unsafeTrace() {
  // Node initializes debuglog's enabled set before user code. Check that set
  // even if NODE_DEBUG was subsequently cleared, and also reject a newly set
  // unsafe configuration before constructing any credential-bearing request.
  if (initialDebug.some(logger => logger.enabled)) return true
  if (initialTlsTrace || traceTls(process.env.NODE_OPTIONS || '')) return true
  const configured = process.env.NODE_DEBUG || ''
  const escaped = configured.replace(/[|\\{}()[\]^$+?.]/g, '\\$&').replaceAll('*', '.*').replaceAll(',', '$|^')
  const matcher = new RegExp(`^${escaped}$`, 'i')
  return DEBUG_NAMES.some(name => matcher.test(name))
}

export function createHttpsPromotionTransport(options = {}) {
  requireValue(options !== null && typeof options === 'object' && !Array.isArray(options), 'invalid_options')
  const { teamId, getToken, execute = false, timeoutMs = 10_000, requestImpl = https.request, signal } = options
  requireValue(typeof teamId === 'string' && TEAM_ID.test(teamId) && typeof getToken === 'function'
    && typeof execute === 'boolean' && Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60_000
    && typeof requestImpl === 'function' && (signal === undefined || signal instanceof AbortSignal), 'invalid_options')
  let attempted = false

  async function verifyPromotionSupport() {
    return { method: 'POST', pathTemplate: PATH_TEMPLATE, force: false, singleAttempt: true,
      transport: 'native-https', credentialsVerified: false, permissionsVerified: false }
  }

  async function promote(input = {}) {
    requireValue(execute === true, 'execute_required')
    requireValue(input !== null && typeof input === 'object' && !Array.isArray(input), 'invalid_deployment')
    const { deploymentId } = input
    requireValue(typeof deploymentId === 'string' && DEPLOYMENT_ID.test(deploymentId), 'invalid_deployment')
    requireValue(!attempted, 'attempt_already_consumed')
    requireValue(!signal?.aborted, 'aborted')
    requireValue(!unsafeTrace(), 'unsafe_debug_configuration')
    // Set synchronously before the first await, including token acquisition.
    // A failed accessor or an uncertain request still consumes this instance.
    attempted = true

    return new Promise((resolve, reject) => {
      let request, response, timer
      let settled = false
      const deadline = performance.now() + timeoutMs
      const cleanup = () => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
      }
      const destroy = () => {
        // Never expose an injected transport exception or response contents.
        try { response?.destroy() } catch { /* Already unavailable. */ }
        try { request?.destroy() } catch { /* Already unavailable. */ }
      }
      const fail = code => {
        if (settled) return
        settled = true
        cleanup()
        destroy()
        reject(error(code))
      }
      const abort = () => fail('aborted')
      const expired = () => {
        if (performance.now() < deadline) return false
        fail('deadline_exceeded')
        return true
      }
      // This referenced timer also bounds a stalled credential accessor. A
      // pending Promise alone must not allow a CLI process to exit successfully.
      timer = setTimeout(() => fail('deadline_exceeded'), timeoutMs)
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) { fail('aborted'); return }

      Promise.resolve().then(() => {
        if (settled || expired()) return undefined
        return getToken()
      }).then(token => {
        if (settled) return // Late credential resolution must never send.
        if (expired()) return // A blocking accessor can delay timer callbacks.
        if (signal?.aborted) { fail('aborted'); return }
        if (unsafeTrace()) { fail('unsafe_debug_configuration'); return }
        if (typeof token !== 'string' || !token.length || token.length > 8192 || !/^[\x21-\x7e]+$/.test(token)) {
          fail('credential_unavailable'); return
        }
        const options = {
          protocol: 'https:', hostname: 'api.vercel.com', port: 443, servername: 'api.vercel.com',
          method: 'POST', path: `/v10/projects/${RELEASE_PROJECT}/promote/${deploymentId}?${new URLSearchParams({ teamId })}`,
          // A fresh agent avoids socket reuse and the global agent's optional
          // environment-proxy configuration. Certificate verification remains on.
          agent: false, rejectUnauthorized: true, maxHeaderSize: MAX_HEADER_BYTES,
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Length': '0', Connection: 'close' },
        }
        if (expired()) return
        request = requestImpl(options, incoming => {
          if (settled) { incoming.destroy(); return }
          response = incoming
          // Do not follow Location, honor Retry-After, refresh credentials, or
          // issue another request for any status, transport error, or timeout.
          response.once('error', () => fail('response_failed'))
          response.once('aborted', () => fail('response_incomplete'))
          response.once('close', () => { if (!settled) fail('response_incomplete') })
          if (expired()) return
          if (![201, 202].includes(response.statusCode)) { fail('status_rejected'); return }
          const declared = response.headers['content-length']
          if (declared !== undefined && (typeof declared !== 'string' || !/^[0-9]+$/.test(declared)
            || Number(declared) > MAX_BODY_BYTES)) { fail('response_too_large'); return }
          let size = 0
          response.on('data', chunk => {
            if (settled || expired()) return
            size += chunk.byteLength
            if (size > MAX_BODY_BYTES) fail('response_too_large')
          })
          response.once('end', () => {
            if (settled) return
            if (expired()) return
            if (!response.complete) { fail('response_incomplete'); return }
            settled = true
            cleanup()
            destroy()
            resolve({ accepted: true })
          })
        })
        request.once('error', () => fail('request_failed'))
        request.once('close', () => { if (!response && !settled) fail('request_closed') })
        request.once('upgrade', (_incoming, socket) => { socket.destroy(); fail('status_rejected') })
        if (settled || signal?.aborted) { destroy(); if (!settled) fail('aborted'); return }
        if (expired()) return
        request.end() // One request and no request body. Never retry.
      }).catch(() => fail('credential_or_request_failed'))
    })
  }

  return Object.freeze({ verifyPromotionSupport, promote })
}
