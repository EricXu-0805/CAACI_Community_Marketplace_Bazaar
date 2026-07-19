#!/usr/bin/env node
/*
 * Revoke admin credentials only through the authenticated, idempotent and
 * audited /api/admin lifecycle boundary. This script deliberately has no
 * Supabase service key and performs no direct table PATCH.
 *
 * Required environment:
 *   ADMIN_API_ORIGIN=https://staging.example.edu
 *   ADMIN_TOKEN=iam_admin_<security-admin-or-owner credential>
 *
 * Inventory/dry-run:
 *   node scripts/admin-token-revoke.mjs --list [--show-inactive]
 *   node scripts/admin-token-revoke.mjs --id <token-row-uuid>
 *   node scripts/admin-token-revoke.mjs --admin-id <profiles-uuid>
 *   node scripts/admin-token-revoke.mjs --email <snapshot-email>
 *
 * Apply (email is intentionally forbidden because it is a cached snapshot):
 *   node scripts/admin-token-revoke.mjs --id <token-row-uuid> \
 *     --case-id SEC-2026-001 --approval-ref change-1234 --apply
 *   node scripts/admin-token-revoke.mjs --admin-id <profiles-uuid> \
 *     --case-id SEC-2026-001 --approval-ref change-1234 --apply
 */

import crypto from 'node:crypto'
import { argv, env, exit } from 'node:process'
import { fetchBounded, normalizeSupabaseOrigin } from './http-boundary.mjs'

const TOKEN_PATTERN = /^iam_admin_[A-Za-z0-9_-]{43}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function fail(message, code = 1) {
  console.error(message)
  exit(code)
}

function flag(name) {
  const index = argv.indexOf(name)
  if (index === -1) return null
  return argv[index + 1] ?? null
}

function validateArguments() {
  const valued = new Set([
    '--id', '--admin-id', '--email', '--case-id', '--approval-ref', '--idempotency-key',
  ])
  const boolean = new Set(['--apply', '--list', '--show-inactive', '--show-revoked'])
  const seen = new Set()
  for (let index = 2; index < argv.length; index++) {
    const argument = argv[index]
    if (!valued.has(argument) && !boolean.has(argument)) fail(`Unknown argument: ${argument}`)
    if (seen.has(argument)) fail(`Duplicate argument: ${argument}`)
    seen.add(argument)
    if (valued.has(argument)) {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) fail(`${argument} requires a value`)
      index++
    }
  }
}

const API_ORIGIN_RAW = env.ADMIN_API_ORIGIN
const ADMIN_TOKEN = env.ADMIN_TOKEN
if (!API_ORIGIN_RAW || !ADMIN_TOKEN) fail('Missing env: ADMIN_API_ORIGIN or ADMIN_TOKEN')

const API_ORIGIN = normalizeSupabaseOrigin(API_ORIGIN_RAW)
if (!API_ORIGIN) {
  fail('ADMIN_API_ORIGIN must be an HTTPS origin (loopback HTTP is allowed for local rehearsal)')
}
if (!TOKEN_PATTERN.test(ADMIN_TOKEN)) {
  fail('ADMIN_TOKEN must be a complete iam_admin_ bearer token')
}
validateArguments()

const APPLY = argv.includes('--apply')
const LIST = argv.includes('--list')
const SHOW_INACTIVE = argv.includes('--show-inactive') || argv.includes('--show-revoked')
const ID_RAW = flag('--id')
const ADMIN_ID_RAW = flag('--admin-id')
const EMAIL = flag('--email')
const CASE_ID = flag('--case-id')
const APPROVAL_REF = flag('--approval-ref')
const IDEMPOTENCY_KEY_RAW = flag('--idempotency-key')

const selectors = [LIST, Boolean(ID_RAW), Boolean(ADMIN_ID_RAW), Boolean(EMAIL)].filter(Boolean).length
if (selectors !== 1) {
  fail('Choose exactly one selector: --list, --id, --admin-id, or --email')
}
if (ID_RAW && !UUID_PATTERN.test(ID_RAW)) fail('--id must be a UUID')
if (ADMIN_ID_RAW && !UUID_PATTERN.test(ADMIN_ID_RAW)) fail('--admin-id must be a UUID')
if (
  EMAIL
  && (
    EMAIL.trim().length < 3
    || EMAIL.length > 200
    || !EMAIL.includes('@')
    || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(EMAIL)
  )
) {
  fail('--email must look like an email (3-200 chars, contain @)')
}
if (LIST && APPLY) fail('--list cannot be combined with --apply')
if (EMAIL && APPLY) {
  fail('--email is a non-authoritative snapshot and is dry-run only; apply with --admin-id')
}
if (IDEMPOTENCY_KEY_RAW !== null && !UUID_PATTERN.test(IDEMPOTENCY_KEY_RAW)) {
  fail('--idempotency-key must be a UUID')
}
if (APPLY) {
  for (const [name, value] of [['--case-id', CASE_ID], ['--approval-ref', APPROVAL_REF]]) {
    if (
      typeof value !== 'string'
      || value.trim().length < 1
      || value.length > 160
      || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value)
    ) {
      fail(`${name} is required for --apply and must be 1-160 characters`)
    }
  }
}

const ID = ID_RAW?.toLowerCase() || null
const ADMIN_ID = ADMIN_ID_RAW?.toLowerCase() || null
const EMAIL_NORMALIZED = EMAIL?.trim().toLocaleLowerCase('en-US') || null
const HEADERS = {
  Authorization: `Bearer ${ADMIN_TOKEN}`,
  Accept: 'application/json',
}

function stableApiError(body, fallback) {
  const candidate = typeof body?.error === 'string' ? body.error : ''
  return /^[a-z0-9_:-]{1,100}$/i.test(candidate) ? candidate : fallback
}

async function parseJson(response, fallback) {
  try {
    return await response.json()
  } catch {
    throw new Error(fallback)
  }
}

async function fetchTokens() {
  const response = await fetchBounded(fetch, `${API_ORIGIN}/api/admin?resource=tokens`, {
    headers: HEADERS,
  }, { timeoutMs: 15_000, maxBytes: 2 * 1024 * 1024 })
  const body = await parseJson(response, 'admin_api_malformed')
  if (!response.ok) throw new Error(stableApiError(body, `admin_api_http_${response.status}`))
  const rows = body?.data?.tokens
  if (!Array.isArray(rows)) throw new Error('admin_api_malformed')
  return rows
}

function lifecycleState(row, now = Date.now()) {
  if (row?.revoked_at) return 'revoked'
  if (!row?.expires_at) return 'active'
  const expiry = Date.parse(row.expires_at)
  return Number.isFinite(expiry) && expiry > now ? 'active' : 'expired'
}

function formatTimestamp(value) {
  if (!value) return '-'
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return 'invalid'
  return new Date(timestamp).toISOString().replace('T', ' ').slice(0, 16) + 'Z'
}

function terminalText(value, maxLength = 200) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, '?')
    .slice(0, maxLength)
}

function printToken(row) {
  const state = lifecycleState(row)
  console.log(`  ${state.toUpperCase()}  ${terminalText(row.admin_name || '(unnamed snapshot)', 100)}  <${terminalText(row.admin_email || 'unknown')}>`)
  console.log(`         id: ${terminalText(row.id, 80)}`)
  console.log(`         admin_id: ${terminalText(row.admin_id || '(missing)', 80)}`)
  console.log(`         role: ${terminalText(row.role || '(missing)', 40)}   expires: ${formatTimestamp(row.expires_at)}`)
  console.log(`         created: ${formatTimestamp(row.created_at)}   last_used: ${formatTimestamp(row.last_used_at)}`
    + (row.revoked_at ? `   revoked: ${formatTimestamp(row.revoked_at)}` : ''))
  console.log('')
}

function printRoster(rows, includeInactive) {
  const visible = includeInactive ? rows : rows.filter(row => lifecycleState(row) === 'active')
  if (!visible.length) {
    console.log(includeInactive ? '(no tokens)' : '(no active tokens)')
  } else {
    console.log('')
    for (const row of visible) printToken(row)
  }
  const counts = { active: 0, expired: 0, revoked: 0 }
  for (const row of rows) counts[lifecycleState(row)]++
  console.log(`  Summary: ${counts.active} active, ${counts.expired} expired, ${counts.revoked} revoked, ${rows.length} total`)
}

async function revoke(body, idempotencyKey) {
  let response
  try {
    response = await fetchBounded(fetch, `${API_ORIGIN}/api/admin`, {
      method: 'POST',
      headers: {
        ...HEADERS,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(body),
    }, { timeoutMs: 15_000, maxBytes: 256 * 1024 })
  } catch {
    throw new Error('admin_outcome_unknown')
  }
  const responseBody = await parseJson(response, 'admin_api_malformed')
  if (!response.ok) {
    throw new Error(stableApiError(responseBody, `admin_api_http_${response.status}`))
  }
  if (!responseBody || typeof responseBody !== 'object' || typeof responseBody.error === 'string') {
    throw new Error('admin_api_malformed')
  }
  return responseBody
}

let rows
try {
  rows = await fetchTokens()
} catch (error) {
  fail(`Inventory failed: ${error.message}`, 2)
}

if (LIST) {
  console.log(SHOW_INACTIVE
    ? 'admin_tokens - all lifecycle states'
    : 'admin_tokens - active only (use --show-inactive for full inventory)')
  printRoster(rows, SHOW_INACTIVE)
  exit(0)
}

let targets
if (ID) {
  targets = rows.filter(row => String(row?.id || '').toLowerCase() === ID)
} else if (ADMIN_ID) {
  targets = rows.filter(row => String(row?.admin_id || '').toLowerCase() === ADMIN_ID)
} else {
  targets = rows.filter(row => String(row?.admin_email || '').trim().toLocaleLowerCase('en-US') === EMAIL_NORMALIZED)
}

if (!targets.length) {
  fail('No token matches the requested selector', 2)
}

const activeTargets = targets.filter(row => lifecycleState(row) === 'active')
const revocableTargets = targets.filter(row => !row?.revoked_at)
console.log(APPLY ? 'APPLY mode - audited revocation requested' : 'DRY-RUN - no revocation requested')
for (const row of targets) printToken(row)

if (EMAIL) {
  const adminIds = [...new Set(targets.map(row => row?.admin_id).filter(id => UUID_PATTERN.test(id || '')))]
  console.log(`Email snapshot matched ${targets.length} token row(s), ${activeTargets.length} active.`)
  if (adminIds.length) {
    console.log('Authoritative admin_id value(s) to review:')
    for (const adminId of adminIds) console.log(`  ${adminId}`)
  }
  if (adminIds.length > 1) {
    console.log('WARNING: this cached email maps to multiple admin_id values; review and handle each admin_id separately.')
  }
  console.log('Apply is intentionally unavailable by email; repeat with one reviewed --admin-id.')
  exit(0)
}

if (!revocableTargets.length) {
  if (APPLY && !IDEMPOTENCY_KEY_RAW) {
    fail('Matched token(s) are already revoked; replay requires the original explicit --idempotency-key', 2)
  }
  if (APPLY) {
    console.log('Inventory shows no unrevoked row; replaying only to reconcile the explicit Idempotency-Key.')
  }
}
if (!APPLY) {
  console.log('Re-run with --apply, --case-id and --approval-ref after reviewing the target.')
  exit(0)
}

const idempotencyKey = (IDEMPOTENCY_KEY_RAW || crypto.randomUUID()).toLowerCase()
const body = ID
  ? {
      action: 'revoke_token',
      token_id: ID,
      case_id: CASE_ID.trim(),
      approval_ref: APPROVAL_REF.trim(),
    }
  : {
      action: 'revoke_admin_tokens',
      admin_id: ADMIN_ID,
      case_id: CASE_ID.trim(),
      approval_ref: APPROVAL_REF.trim(),
    }

console.log(`Idempotency key: ${idempotencyKey}`)
try {
  const result = await revoke(body, idempotencyKey)
  if (ID) {
    if (
      !result
      || typeof result !== 'object'
      || Array.isArray(result)
      || Object.keys(result).join(',') !== 'success'
      || result.success !== true
    ) throw new Error('admin_outcome_unknown')
    console.log('Revocation completed.')
  } else {
    const data = result?.data
    const tokenIds = data?.token_ids
    const count = data?.revoked_count
    if (
      !result
      || typeof result !== 'object'
      || Array.isArray(result)
      || Object.keys(result).join(',') !== 'data'
      || !data
      || typeof data !== 'object'
      || Array.isArray(data)
      || Object.keys(data).sort().join(',') !== 'admin_id,revoked_count,token_ids'
      || String(data.admin_id || '').toLowerCase() !== ADMIN_ID
      || !Array.isArray(tokenIds)
      || tokenIds.some(id => !UUID_PATTERN.test(id || ''))
      || new Set(tokenIds.map(id => id.toLowerCase())).size !== tokenIds.length
      || !Number.isSafeInteger(count)
      || count !== tokenIds.length
      || (revocableTargets.length > 0 && count === 0)
    ) throw new Error('admin_outcome_unknown')
    console.log(`Revocation completed: ${count} token(s) revoked.`)
  }
} catch (error) {
  console.error(`Revocation failed: ${error.message}`)
  console.error(`Retry/reconcile only with the same Idempotency-Key: ${idempotencyKey}`)
  exit(3)
}
