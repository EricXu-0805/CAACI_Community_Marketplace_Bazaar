#!/usr/bin/env node
/*
 * Issue a per-admin bearer token through the audited admin lifecycle API.
 *
 * Plaintext is never printed. A new issuance writes a mode-0600 JSON recovery
 * manifest to an absolute --output-file using exclusive-create semantics.
 * The manifest is the only copy of the one-time credential and also carries
 * the immutable request/idempotency fields needed to reconcile a lost API
 * response with --resume-file.
 *
 * Required environment:
 *   ADMIN_API_ORIGIN=https://staging.example.edu
 *   ADMIN_TOKEN=iam_admin_<existing owner credential>
 *
 * New issuance:
 *   node scripts/admin-token-mint.mjs \
 *     --admin-id 11111111-1111-4111-8111-111111111111 \
 *     --role operator --expires-days 90 \
 *     --case-id SEC-2026-001 --approval-ref change-1234 \
 *     --output-file /absolute/private/path/token-recovery.json --apply
 *
 * Outcome-unknown recovery:
 *   node scripts/admin-token-mint.mjs \
 *     --resume-file /absolute/private/path/token-recovery.json --apply
 *
 * If the exact original issuer token is no longer usable, a replacement owner
 * can perform a read-only authoritative hash reconciliation:
 *   node scripts/admin-token-mint.mjs \
 *     --reconcile-file /absolute/private/path/token-recovery.json
 *
 * A definitive non-conflict 4xx rejection removes the manifest. Transport
 * errors, 409/5xx responses and malformed/unknown outcomes retain it for an
 * identical retry with the exact original issuer token. Reconciliation never
 * prints plaintext and never deletes the manifest automatically.
 */

import crypto from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, realpath, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import process, { argv, env, exit, stdout } from 'node:process'
import { fileURLToPath } from 'node:url'
import { fetchBounded, normalizeSupabaseOrigin } from './http-boundary.mjs'

const API_ORIGIN_RAW = env.ADMIN_API_ORIGIN
const ADMIN_TOKEN = env.ADMIN_TOKEN
const TOKEN_PATTERN = /^iam_admin_[A-Za-z0-9_-]{43}$/
const HASH_PATTERN = /^[0-9a-f]{64}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/
const ROLES = new Set(['operator', 'security_admin', 'owner'])
const MANIFEST_KIND = 'iam_admin_token_issue_recovery'
const MANIFEST_VERSION = 2
const MAX_MANIFEST_BYTES = 64 * 1024

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
    '--output-file', '--resume-file', '--reconcile-file', '--admin-id', '--role',
    '--confirm-privileged-role', '--case-id', '--approval-ref',
    '--idempotency-key', '--expires-days', '--name', '--email',
  ])
  const boolean = new Set(['--apply'])
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

function boundedReference(name, value) {
  if (
    typeof value !== 'string'
    || value.trim().length < 1
    || value.length > 160
    || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value)
  ) {
    fail(`${name} is required and must be 1-160 characters`)
  }
  return value.trim()
}

function parseStrictTimestamp(value) {
  if (
    typeof value !== 'string'
    || value.length > 64
    || !ISO_TIMESTAMP_PATTERN.test(value)
  ) return Number.NaN
  return Date.parse(value)
}

if (!API_ORIGIN_RAW || !ADMIN_TOKEN) fail('Missing env: ADMIN_API_ORIGIN or ADMIN_TOKEN')
const API_ORIGIN = normalizeSupabaseOrigin(API_ORIGIN_RAW)
if (!API_ORIGIN) {
  fail('ADMIN_API_ORIGIN must be an HTTPS origin (loopback HTTP is allowed for local rehearsal)')
}
if (!TOKEN_PATTERN.test(ADMIN_TOKEN)) fail('ADMIN_TOKEN must be a complete iam_admin_ bearer token')
const ADMIN_TOKEN_HASH = crypto.createHash('sha256').update(ADMIN_TOKEN).digest('hex')
validateArguments()

const APPLY = argv.includes('--apply')
const OUTPUT_FILE = flag('--output-file')
const RESUME_FILE = flag('--resume-file')
const RECONCILE_FILE = flag('--reconcile-file')
const ADMIN_ID_RAW = flag('--admin-id')
const ROLE_RAW = flag('--role')
const CONFIRMED_PRIVILEGED_ROLE = flag('--confirm-privileged-role')
const CASE_ID_RAW = flag('--case-id')
const APPROVAL_REF_RAW = flag('--approval-ref')
const IDEMPOTENCY_KEY_RAW = flag('--idempotency-key')
const EXPIRES_DAYS_RAW = flag('--expires-days')
const RESUME = RESUME_FILE !== null
const RECONCILE = RECONCILE_FILE !== null

if (argv.includes('--name') || argv.includes('--email')) {
  fail('--name/--email are not accepted; the server derives the identity snapshot from --admin-id')
}
if (OUTPUT_FILE !== null && !isAbsolute(OUTPUT_FILE)) fail('--output-file must be an absolute path')
if (RESUME_FILE !== null && !isAbsolute(RESUME_FILE)) fail('--resume-file must be an absolute path')
if (RECONCILE_FILE !== null && !isAbsolute(RECONCILE_FILE)) fail('--reconcile-file must be an absolute path')
if ([OUTPUT_FILE !== null, RESUME, RECONCILE].filter(Boolean).length > 1) {
  fail('--output-file, --resume-file and --reconcile-file are mutually exclusive')
}
if (RESUME && !APPLY) fail('--resume-file requires --apply')
if (RECONCILE && APPLY) fail('--reconcile-file is read-only and cannot be combined with --apply')
if (!APPLY && OUTPUT_FILE !== null) {
  fail('--output-file is only valid with --apply; dry-run never creates a credential')
}
if (APPLY && !OUTPUT_FILE && !RESUME) {
  const context = stdout.isTTY ? 'interactive' : 'non-TTY'
  fail(`--apply in ${context} mode requires an absolute --output-file or --resume-file; plaintext is never printed`)
}

let newRequest = null
if (RESUME || RECONCILE) {
  const conflictingFlags = [
    ['--admin-id', ADMIN_ID_RAW],
    ['--role', ROLE_RAW],
    ['--confirm-privileged-role', CONFIRMED_PRIVILEGED_ROLE],
    ['--case-id', CASE_ID_RAW],
    ['--approval-ref', APPROVAL_REF_RAW],
    ['--idempotency-key', IDEMPOTENCY_KEY_RAW],
    ['--expires-days', EXPIRES_DAYS_RAW],
  ].filter(([, value]) => value !== null)
  if (conflictingFlags.length) {
    fail(`${RESUME ? '--resume-file' : '--reconcile-file'} owns the immutable request; remove ${conflictingFlags.map(([name]) => name).join(', ')}`)
  }
} else {
  if (!ADMIN_ID_RAW || !UUID_PATTERN.test(ADMIN_ID_RAW)) {
    fail('--admin-id must be an existing public.profiles UUID')
  }
  const role = ROLE_RAW || 'operator'
  if (!ROLES.has(role)) fail('--role must be operator, security_admin, or owner')
  if (role !== 'operator' && CONFIRMED_PRIVILEGED_ROLE !== role) {
    fail(`--role ${role} is privileged; repeat it with --confirm-privileged-role ${role}`)
  }
  const caseId = boundedReference('--case-id', CASE_ID_RAW)
  const approvalRef = boundedReference('--approval-ref', APPROVAL_REF_RAW)
  if (IDEMPOTENCY_KEY_RAW !== null && !UUID_PATTERN.test(IDEMPOTENCY_KEY_RAW)) {
    fail('--idempotency-key must be a UUID')
  }
  const expiresDays = EXPIRES_DAYS_RAW === null ? 90 : Number(EXPIRES_DAYS_RAW)
  if (!Number.isInteger(expiresDays) || expiresDays < 1 || expiresDays > 365) {
    fail('--expires-days must be an integer 1-365')
  }
  if (role === 'owner' && expiresDays < 2) {
    fail('--expires-days must be an integer 2-365 for owner recovery tokens')
  }
  newRequest = {
    adminId: ADMIN_ID_RAW.toLowerCase(),
    role,
    expiresDays,
    caseId,
    approvalRef,
    idempotencyKey: (IDEMPOTENCY_KEY_RAW || crypto.randomUUID()).toLowerCase(),
  }
}

const HEADERS = { Authorization: `Bearer ${ADMIN_TOKEN}`, Accept: 'application/json' }

class LifecycleError extends Error {
  constructor(message, { outcomeUnknown = false } = {}) {
    super(message)
    this.outcomeUnknown = outcomeUnknown
  }
}

function stableApiError(body, fallback) {
  const candidate = typeof body?.error === 'string' ? body.error : ''
  return /^[a-z0-9_:-]{1,100}$/i.test(candidate) ? candidate : fallback
}

async function parseJson(response, fallback, outcomeUnknown = false) {
  try {
    return await response.json()
  } catch {
    throw new LifecycleError(fallback, { outcomeUnknown })
  }
}

async function preflight() {
  let response
  try {
    response = await fetchBounded(fetch, `${API_ORIGIN}/api/admin?resource=whoami`, {
      headers: HEADERS,
    }, { timeoutMs: 15_000, maxBytes: 128 * 1024 })
  } catch {
    throw new LifecycleError('admin_api_unavailable')
  }
  const body = await parseJson(response, 'admin_api_malformed')
  if (!response.ok) throw new LifecycleError(stableApiError(body, `admin_api_http_${response.status}`))
  if (
    !body?.data
    || body.data.role !== 'owner'
    || !Array.isArray(body.data.capabilities)
    || !body.data.capabilities.includes('issue_token')
  ) {
    throw new LifecycleError('admin_token_lifecycle_capability_required')
  }
  return body.data
}

function serializeManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

function manifestIdentity(metadata) {
  return { dev: metadata.dev, ino: metadata.ino }
}

function sameIdentity(left, right) {
  return left && right && left.dev === right.dev && left.ino === right.ino
}

function filesystemError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

async function syncParentDirectory(path) {
  let directoryHandle
  try {
    directoryHandle = await open(dirname(path), constants.O_RDONLY)
    await directoryHandle.sync()
  } finally {
    try { await directoryHandle?.close() } catch {}
  }
}

async function validatePrivateParent(path) {
  const parent = dirname(path)
  const metadata = await lstat(parent)
  if (!metadata.isDirectory()) throw filesystemError('manifest_parent_not_directory')
  if ((metadata.mode & 0o022) !== 0) throw filesystemError('manifest_parent_writable_by_others')
  if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) {
    throw filesystemError('manifest_parent_not_owned')
  }

  // A mode-0600 file is still dangerous in a checkout: it can be staged,
  // copied into a deployment source archive, or exposed by another tool that
  // treats the worktree as publishable input. Resolve symlinked ancestors and
  // reject both this source tree and every Git worktree before any network or
  // plaintext generation occurs.
  const [canonicalParent, sourceRoot] = await Promise.all([
    realpath(parent),
    realpath(fileURLToPath(new URL('../', import.meta.url))),
  ])
  if (isPathWithin(sourceRoot, canonicalParent)) {
    throw filesystemError('manifest_path_inside_source_tree')
  }
  let cursor = canonicalParent
  while (true) {
    try {
      await lstat(join(cursor, '.git'))
      throw filesystemError('manifest_path_inside_git_worktree')
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    const ancestor = dirname(cursor)
    if (ancestor === cursor) break
    cursor = ancestor
  }
}

function isPathWithin(root, candidate) {
  const path = relative(root, candidate)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

async function unlinkKnownManifest(path, identity) {
  let current
  try {
    current = await lstat(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  if (current.isSymbolicLink() || !sameIdentity(manifestIdentity(current), identity)) {
    throw filesystemError('manifest_identity_changed')
  }
  await unlink(path)
  await syncParentDirectory(path)
}

async function writeManifest(path, manifest) {
  let handle = null
  let created = false
  let identity = null
  try {
    handle = await open(path, 'wx', 0o600)
    created = true
    const metadata = await handle.stat()
    identity = manifestIdentity(metadata)
    await handle.chmod(0o600)
    await handle.writeFile(serializeManifest(manifest), { encoding: 'utf8' })
    await handle.sync()
    // fsync(file) alone does not make the new directory entry crash-durable.
    // The parent must be synced before any request can mint the server row.
    await syncParentDirectory(path)
    return identity
  } catch (error) {
    if (created) {
      try {
        await handle?.truncate(0)
        await handle?.sync()
      } catch {}
    }
    try { await handle?.close() } catch {}
    handle = null
    if (created && identity) {
      try { await unlinkKnownManifest(path, identity) } catch {}
    }
    throw error
  } finally {
    try { await handle?.close() } catch {}
  }
}

function validateManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('manifest_malformed')
  if (value.kind !== MANIFEST_KIND || value.version !== MANIFEST_VERSION) throw new Error('manifest_version_invalid')
  if (!TOKEN_PATTERN.test(value.token || '')) throw new Error('manifest_token_invalid')
  if (!HASH_PATTERN.test(value.token_hash || '')) throw new Error('manifest_hash_invalid')
  const computedHash = crypto.createHash('sha256').update(value.token).digest('hex')
  if (computedHash !== value.token_hash) throw new Error('manifest_hash_mismatch')
  if (!UUID_PATTERN.test(value.idempotency_key || '')) throw new Error('manifest_idempotency_key_invalid')
  if (!HASH_PATTERN.test(value.issuer_token_hash || '')) throw new Error('manifest_issuer_token_hash_invalid')
  if (!UUID_PATTERN.test(value.issuer_admin_id || '')) throw new Error('manifest_issuer_admin_id_invalid')
  if (!UUID_PATTERN.test(value.admin_id || '')) throw new Error('manifest_admin_id_invalid')
  if (!ROLES.has(value.role)) throw new Error('manifest_role_invalid')
  if (
    typeof value.case_id !== 'string'
    || value.case_id.trim().length < 1
    || value.case_id.length > 160
    || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value.case_id)
  ) {
    throw new Error('manifest_case_id_invalid')
  }
  if (
    typeof value.approval_ref !== 'string'
    || value.approval_ref.trim().length < 1
    || value.approval_ref.length > 160
    || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value.approval_ref)
  ) {
    throw new Error('manifest_approval_ref_invalid')
  }
  const createdAt = Date.parse(value.created_at)
  const expiresAt = Date.parse(value.expires_at)
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt)) throw new Error('manifest_timestamp_invalid')
  const lifetime = expiresAt - createdAt
  if (lifetime < 86_400_000 || lifetime > 366 * 86_400_000) throw new Error('manifest_expiry_invalid')
  return {
    ...value,
    issuer_admin_id: value.issuer_admin_id.toLowerCase(),
    admin_id: value.admin_id.toLowerCase(),
    idempotency_key: value.idempotency_key.toLowerCase(),
    case_id: value.case_id.trim(),
    approval_ref: value.approval_ref.trim(),
  }
}

async function readManifest(path) {
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const metadata = await handle.stat()
    if (!metadata.isFile()) throw new Error('manifest_not_regular_file')
    if (metadata.nlink !== 1) throw new Error('manifest_link_count_invalid')
    if ((metadata.mode & 0o077) !== 0) throw new Error('manifest_permissions_too_broad')
    if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) {
      throw new Error('manifest_not_owned')
    }
    if (metadata.size < 1 || metadata.size > MAX_MANIFEST_BYTES) throw new Error('manifest_size_invalid')
    const raw = await handle.readFile({ encoding: 'utf8' })
    let value
    try { value = JSON.parse(raw) } catch { throw new Error('manifest_malformed') }
    return { manifest: validateManifest(value), identity: manifestIdentity(metadata) }
  } finally {
    try { await handle?.close() } catch {}
  }
}

function requestBody(manifest) {
  return {
    action: 'issue_token',
    token_hash: manifest.token_hash,
    admin_id: manifest.admin_id,
    role: manifest.role,
    expires_at: manifest.expires_at,
    case_id: manifest.case_id,
    approval_ref: manifest.approval_ref,
  }
}

async function issueToken(manifest) {
  let response
  try {
    response = await fetchBounded(fetch, `${API_ORIGIN}/api/admin`, {
      method: 'POST',
      headers: {
        ...HEADERS,
        'Content-Type': 'application/json',
        'Idempotency-Key': manifest.idempotency_key,
      },
      body: JSON.stringify(requestBody(manifest)),
    }, { timeoutMs: 15_000, maxBytes: 256 * 1024 })
  } catch {
    throw new LifecycleError('admin_outcome_unknown', { outcomeUnknown: true })
  }

  const outcomeUnknownStatus = response.status >= 500
  const body = await parseJson(response, 'admin_outcome_unknown', outcomeUnknownStatus || response.ok)
  if (!response.ok) {
    const code = stableApiError(body, `admin_api_http_${response.status}`)
    throw new LifecycleError(code, {
      // A conflict can mean the token hash already committed before its HTTP
      // response was lost. Never destroy the only plaintext copy on a 409.
      outcomeUnknown: response.status === 409
        || response.status >= 500
        || code === 'admin_outcome_unknown',
    })
  }
  if (!body || typeof body !== 'object' || typeof body.error === 'string') {
    throw new LifecycleError('admin_outcome_unknown', { outcomeUnknown: true })
  }
  return body
}

function validateIssueResult(result, manifest) {
  const row = result?.data
  if (
    !row
    || typeof row !== 'object'
    || !UUID_PATTERN.test(row.token_id || '')
    || String(row.admin_id || '').toLowerCase() !== manifest.admin_id
    || row.role !== manifest.role
    || !Number.isFinite(Date.parse(row.expires_at))
    || Date.parse(row.expires_at) !== Date.parse(manifest.expires_at)
  ) {
    throw new LifecycleError('admin_outcome_unknown', { outcomeUnknown: true })
  }
  return row.token_id.toLowerCase()
}

async function reconcileIssuedToken(manifest) {
  let response
  try {
    response = await fetchBounded(fetch, `${API_ORIGIN}/api/admin?resource=token_reconciliation`, {
      headers: {
        ...HEADERS,
        'X-Admin-Token-Hash': manifest.token_hash,
      },
    }, { timeoutMs: 15_000, maxBytes: 128 * 1024 })
  } catch {
    throw new LifecycleError('admin_reconciliation_unavailable')
  }
  const body = await parseJson(response, 'admin_reconciliation_malformed')
  if (!response.ok) {
    throw new LifecycleError(stableApiError(body, `admin_api_http_${response.status}`))
  }
  const data = body?.data
  if (
    !body
    || typeof body !== 'object'
    || Array.isArray(body)
    || Object.keys(body).join(',') !== 'data'
    || !data
    || typeof data !== 'object'
    || Array.isArray(data)
  ) throw new LifecycleError('admin_reconciliation_malformed')
  const serverNow = parseStrictTimestamp(data.server_now)
  if (
    data.found === false
    && Object.keys(data).sort().join(',') === 'found,server_now'
    && Number.isFinite(serverNow)
  ) return null
  const revokedAtValid = data.revoked_at !== null
    && Number.isFinite(parseStrictTimestamp(data.revoked_at))
  const detached = data.admin_id === null
  const expiresAt = parseStrictTimestamp(data.expires_at)
  if (
    Object.keys(data).sort().join(',') !== 'admin_id,expires_at,found,revoked_at,role,server_now,token_id'
    || data.found !== true
    || !UUID_PATTERN.test(data.token_id || '')
    || !(
      String(data.admin_id || '').toLowerCase() === manifest.admin_id
      || (detached && revokedAtValid)
    )
    || data.role !== manifest.role
    || !Number.isFinite(expiresAt)
    || expiresAt !== Date.parse(manifest.expires_at)
    || !Number.isFinite(serverNow)
    || (data.revoked_at !== null && !Number.isFinite(parseStrictTimestamp(data.revoked_at)))
  ) throw new LifecycleError('admin_reconciliation_malformed')
  return {
    tokenId: data.token_id.toLowerCase(),
    adminId: data.admin_id === null ? null : data.admin_id.toLowerCase(),
    detached,
    expiresAt: data.expires_at,
    revokedAt: data.revoked_at,
    serverNow: data.server_now,
  }
}

function reconciledLifecycleState(reconciled) {
  const expired = Date.parse(reconciled.expiresAt) <= Date.parse(reconciled.serverNow)
  return {
    unusable: reconciled.detached || !!reconciled.revokedAt || expired,
    label: reconciled.detached
      ? 'detached and revoked after target-account deletion'
      : reconciled.revokedAt
        ? 'revoked'
        : expired
          ? 'expired'
          : 'active',
  }
}

let manifest
let manifestPath
let manifestFileIdentity
try {
  if (APPLY || RECONCILE) {
    await validatePrivateParent(RECONCILE ? RECONCILE_FILE : RESUME ? RESUME_FILE : OUTPUT_FILE)
  }
} catch (error) {
  fail(`Recovery manifest parent rejected: ${error?.code || 'unsafe_parent'}`, 2)
}
if (RESUME || RECONCILE) {
  manifestPath = RESUME ? RESUME_FILE : RECONCILE_FILE
  try {
    const loaded = await readManifest(manifestPath)
    manifest = loaded.manifest
    manifestFileIdentity = loaded.identity
  } catch (error) {
    fail(`${RESUME ? 'Resume' : 'Reconciliation'} manifest rejected: ${error?.code || error.message || 'read_failed'}`, 2)
  }
  if (RESUME && manifest.issuer_token_hash !== ADMIN_TOKEN_HASH) {
    fail('Resume manifest issuer mismatch; use the exact original owner token. Manifest retained for controlled reconciliation.', 2)
  }
}

let identity
try {
  identity = await preflight()
} catch (error) {
  fail(`Preflight failed: ${error.message}`, 2)
}
if (RESUME && String(identity.admin_id || '').toLowerCase() !== manifest.issuer_admin_id) {
  fail('Resume manifest issuer identity mismatch; manifest retained for controlled reconciliation.', 2)
}

if (!RESUME && !RECONCILE) {
  if (!UUID_PATTERN.test(identity.admin_id || '')) {
    fail('Preflight failed: owner identity is incomplete', 2)
  }
  const createdAt = new Date().toISOString()
  const expiresAt = new Date(Date.parse(createdAt) + newRequest.expiresDays * 86_400_000).toISOString()
  manifest = {
    kind: MANIFEST_KIND,
    version: MANIFEST_VERSION,
    created_at: createdAt,
    issuer_token_hash: ADMIN_TOKEN_HASH,
    issuer_admin_id: identity.admin_id.toLowerCase(),
    idempotency_key: newRequest.idempotencyKey,
    admin_id: newRequest.adminId,
    role: newRequest.role,
    expires_at: expiresAt,
    case_id: newRequest.caseId,
    approval_ref: newRequest.approvalRef,
  }
  manifestPath = OUTPUT_FILE
}

console.log('')
console.log('═'.repeat(60))
console.log(RESUME
  ? 'RESUME mode - replaying the immutable audited issuance request'
  : RECONCILE
    ? 'RECONCILE mode - proving the manifest token hash against authoritative state'
  : APPLY
    ? 'APPLY mode - audited token issuance will be requested'
    : 'DRY-RUN - caller and inputs validated; no credential generated')
console.log('═'.repeat(60))
console.log(`  Caller role: ${identity.role}`)
console.log(`  Admin id:    ${manifest.admin_id}`)
console.log(`  Role:        ${manifest.role}`)
console.log(`  Expires:     ${manifest.expires_at}`)
console.log(`  Case id:     ${manifest.case_id}`)
console.log(`  Approval:    ${manifest.approval_ref}`)

if (RECONCILE) {
  try {
    const reconciled = await reconcileIssuedToken(manifest)
    if (!reconciled) {
      console.error('No authoritative token row matches this manifest. Manifest retained; do not guess, delete it, or mint a replacement without case review.')
      exit(3)
    }
    console.log(`  Reconciled token id: ${reconciled.tokenId}`)
    const lifecycle = reconciledLifecycleState(reconciled)
    console.log(`  Lifecycle state: ${lifecycle.label}`)
    if (lifecycle.unusable) {
      console.log('Authoritative hash reconciliation succeeded: issuance committed, but this credential is unusable. Do not import this credential into a vault. Record the token id under the case, then securely remove the local manifest after evidence review.')
    } else {
      console.log('Authoritative hash reconciliation succeeded. Import the manifest token into the approved vault, then securely remove the local manifest under the case record.')
    }
    exit(0)
  } catch (error) {
    fail(`Reconciliation failed; manifest retained: ${error.message}`, 3)
  }
}

if (!APPLY) {
  console.log('Preflight passed. Re-run with --apply and an absolute --output-file.')
  exit(0)
}

if (!RESUME) {
  manifest.token = `iam_admin_${crypto.randomBytes(32).toString('base64url')}`
  manifest.token_hash = crypto.createHash('sha256').update(manifest.token).digest('hex')
  try {
    await validatePrivateParent(manifestPath)
    manifestFileIdentity = await writeManifest(manifestPath, manifest)
  } catch (error) {
    manifest.token = null
    fail(`Recovery manifest was not created: ${error?.code || 'write_failed'}`, 3)
  }
}

console.log(`  Idempotency key: ${manifest.idempotency_key}`)
console.log('  Recovery manifest is mode 0600; plaintext was not written to stdout.')

let result
let issuanceError
let issuedId
let sawOutcomeUnknown = false
for (let attempt = 1; attempt <= 2; attempt++) {
  try {
    result = await issueToken(manifest)
    issuedId = validateIssueResult(result, manifest)
    issuanceError = null
    break
  } catch (error) {
    if (error.outcomeUnknown) sawOutcomeUnknown = true
    // Once any dispatched attempt could have committed, a later 4xx only
    // proves that the retry was rejected. It cannot disprove the earlier
    // commit and must never authorize deletion of the only plaintext token.
    issuanceError = sawOutcomeUnknown
      ? new LifecycleError('admin_outcome_unknown', { outcomeUnknown: true })
      : error
    if (!issuanceError.outcomeUnknown || attempt === 2) break
    console.log('  Outcome unknown; retrying once with the identical payload and Idempotency-Key.')
  }
}

if (issuanceError) {
  if (issuanceError.outcomeUnknown) {
    console.error(`Issuance outcome unknown; recovery manifest retained: ${issuanceError.message}`)
    console.error(`Reconcile only with the same Idempotency-Key: ${manifest.idempotency_key}`)
    console.error('Resume by rerunning this CLI with --resume-file pointing to the same absolute manifest and --apply.')
    exit(3)
  }
  try {
    await unlinkKnownManifest(manifestPath, manifestFileIdentity)
  } catch (cleanupError) {
    console.error(`CRITICAL: issuance was rejected and manifest cleanup failed: ${cleanupError?.code || 'unlink_failed'}`)
    exit(4)
  }
  fail(`Issuance rejected; recovery manifest removed: ${issuanceError.message}`, 3)
}

if (RESUME) {
  let reconciled
  try {
    reconciled = await reconcileIssuedToken(manifest)
  } catch (error) {
    fail(`Resume replay succeeded, but authoritative reconciliation failed; manifest retained and must not be vaulted: ${error.message}`, 3)
  }
  if (!reconciled) {
    fail('Resume replay succeeded, but no authoritative token row matches the manifest; manifest retained and must not be vaulted.', 3)
  }
  if (reconciled.tokenId !== issuedId) {
    fail('Resume replay and authoritative reconciliation returned different token ids; manifest retained and must not be vaulted.', 3)
  }
  const lifecycle = reconciledLifecycleState(reconciled)
  if (lifecycle.unusable) {
    fail(`Resume replay confirmed a ${lifecycle.label} credential; manifest retained for case evidence and must not be vaulted.`, 3)
  }
  console.log('  Resume reconciliation: active token state confirmed by authoritative hash lookup.')
}

console.log(`Issued admin token id: ${issuedId}`)
console.log('Import the manifest token into the approved vault, then securely remove the manifest.')
