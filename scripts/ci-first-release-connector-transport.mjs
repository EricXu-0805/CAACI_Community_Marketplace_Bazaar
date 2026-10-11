// Uses a host-injected, already authorized connector. This module never reads
// credentials, creates a connection, or falls back to a CLI/HTTP transport.
// One host tool invocation is NOT a guarantee of one underlying HTTP attempt.
// The host must persist intent before promote(), retain it across restarts, and
// reconcile deployment identity and aliases using fresh read-only observations.
import { performance } from 'node:perf_hooks'
import { RELEASE_PROJECT } from './check-ci-first-release.mjs'

const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]{1,128}$/
const TEAM_ID = /^team_[A-Za-z0-9]{1,128}$/
const PATH_TEMPLATE = '/v10/projects/{projectId}/promote/{deploymentId}'

export class ConnectorPromotionError extends Error {
  constructor(code, invoked = false) {
    super(`release_connector_${code}`)
    this.name = 'ConnectorPromotionError'
    this.code = this.message
    if (invoked) {
      this.invoked = true
      this.outcome = 'unknown'
    }
  }
}
const error = (code, invoked = false) => new ConnectorPromotionError(code, invoked)
function requireValue(condition, code) { if (!condition) throw error(code) }

// Accept data properties only: option/input accessors must not accidentally
// obtain credentials or expose their own exception text during validation.
function dataFields(value, allowed, code) {
  try {
    requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), code)
    const fields = Object.getOwnPropertyDescriptors(value)
    requireValue(Reflect.ownKeys(fields).every(key => allowed.includes(key)
      && Object.hasOwn(fields[key], 'value')), code)
    return fields
  } catch { throw error(code) }
}

function receiptReturned(value) {
  // Inspect only envelope shape and explicit error markers; never parse, copy,
  // stringify, log, or return a provider's content or credential-bearing body.
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
    if (Object.hasOwn(value, 'error')) return false
    const fields = {}
    for (const key of ['isError', 'content', 'structuredContent']) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor && !Object.hasOwn(descriptor, 'value')) return false
      if (descriptor) fields[key] = descriptor
    }
    if (Object.hasOwn(fields, 'isError') && fields.isError.value !== false) return false
    if (Object.hasOwn(fields, 'content') && !Array.isArray(fields.content.value)) return false
    if (Object.hasOwn(fields, 'structuredContent')) {
      const structured = fields.structuredContent.value
      if (structured === null || typeof structured !== 'object' || Array.isArray(structured)) return false
      if (Object.hasOwn(structured, 'error')) return false
      // Some connector hosts wrap their structured response under result.
      const wrapped = Object.getOwnPropertyDescriptor(structured, 'result')
      if (wrapped) {
        if (!Object.hasOwn(wrapped, 'value')) return false
        const result = wrapped.value
        if (result !== null && typeof result === 'object'
          && Object.hasOwn(result, 'error')) return false
      }
      return true
    }
    return fields.isError?.value === false && Array.isArray(fields.content?.value)
  } catch { return false }
}

export function createConnectorPromotionTransport(options = {}) {
  const fields = dataFields(options, ['teamId', 'execute', 'requestPromote', 'timeoutMs'], 'invalid_options')
  const teamId = fields.teamId?.value
  const requestPromote = fields.requestPromote?.value
  const execute = fields.execute?.value === undefined ? false : fields.execute.value
  const timeoutMs = fields.timeoutMs?.value === undefined ? 10_000 : fields.timeoutMs.value
  requireValue(typeof teamId === 'string' && TEAM_ID.test(teamId)
    && typeof requestPromote === 'function' && typeof execute === 'boolean'
    && Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60_000, 'invalid_options')
  let attempted = false

  async function verifyPromotionSupport() {
    return { method: 'POST', pathTemplate: PATH_TEMPLATE, force: false,
      singleAttempt: false, singleToolInvocation: true, transport: 'connector', internalHttpAttempts: 'unknown',
      credentialsVerified: false, permissionsVerified: false }
  }

  async function promote(input = {}) {
    requireValue(execute === true, 'execute_required')
    const fields = dataFields(input, ['deploymentId'], 'invalid_deployment')
    const deploymentId = fields.deploymentId?.value
    requireValue(typeof deploymentId === 'string' && DEPLOYMENT_ID.test(deploymentId), 'invalid_deployment')
    requireValue(!attempted, 'attempt_already_consumed')
    // Synchronous latch, before any await or injected callback. It is scoped
    // to this object, not the process or remote system; durable intent belongs
    // to the host. All invoked outcomes consume the object, including timeout.
    attempted = true

    return new Promise((resolve, reject) => {
      let settled = false
      const deadline = performance.now() + timeoutMs
      const fail = code => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error(code, true))
      }
      // This timer bounds local waiting only. The remote operation is not
      // cancelled and may finish later; there is no retry or fallback here.
      const timer = setTimeout(() => fail('deadline_exceeded'), timeoutMs)
      try {
        const pending = requestPromote(Object.freeze({
          projectId: RELEASE_PROJECT, teamId, deploymentId,
        }))
        Promise.resolve(pending).then(receipt => {
          if (settled) return
          if (performance.now() >= deadline) { fail('deadline_exceeded'); return }
          if (!receiptReturned(receipt)) { fail('receipt_unknown'); return }
          if (performance.now() >= deadline) { fail('deadline_exceeded'); return }
          settled = true
          clearTimeout(timer)
          // No assertion about provider acceptance, aliases, or completion.
          resolve({ invoked: true, receipt: 'tool_returned' })
        }, () => fail('tool_failed'))
      } catch { fail('tool_failed') }
    })
  }

  return Object.freeze({ verifyPromotionSupport, promote })
}
