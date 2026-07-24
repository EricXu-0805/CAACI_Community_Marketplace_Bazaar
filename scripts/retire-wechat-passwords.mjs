#!/usr/bin/env node
/*
 * Retire the legacy plaintext WeChat password map.
 *
 * Safe default: inventory only. The mutating path requires BOTH:
 *   --apply --confirm RETIRE_WECHAT_PASSWORDS
 *
 * The operation is deliberately ordered:
 *   1. inventory every legacy map row, WeChat-bound profile, and Auth user;
 *   2. prove case-insensitive placeholder emails are unambiguous;
 *   3. rotate every matched placeholder Auth password, including users who
 *      never acquired a legacy map row, to an unrecoverable random value;
 *   4. only after every rotation succeeds, delete the legacy map rows;
 *   5. verify the map is empty.
 *
 * It never reads the plaintext password column and never prints openids,
 * emails, passwords, service keys, or response bodies.
 */

import { createHash, randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { fetchBounded, normalizeSupabaseOrigin } from './http-boundary.mjs'

export { normalizeSupabaseOrigin } from './http-boundary.mjs'

const PAGE_SIZE = 500
const MAX_INVENTORY_PAGES = 100
const TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const OPENID_RE = /^[A-Za-z0-9_-]{4,128}$/
const PRODUCTION_SUPABASE_ORIGIN =
  'https://lfhvgprfphyfvhidegum.supabase.co'
const PRODUCTION_PROJECT_REF = 'lfhvgprfphyfvhidegum'
const NAMED_SECRET_RE = /^sb_secret_[A-Za-z0-9._-]{8,512}$/
const APPLY_CONFIRMATION = 'RETIRE_WECHAT_PASSWORDS'
const PRIVILEGED_TLS_OVERRIDE_VARS = Object.freeze([
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'SSLKEYLOGFILE',
  'GLOBAL_AGENT_HTTP_PROXY',
  'GLOBAL_AGENT_HTTPS_PROXY',
])
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0)

export function assertSafePrivilegedNetworkEnvironment(environment = process.env) {
  const unsafe = PRIVILEGED_TLS_OVERRIDE_VARS.filter(name => (
    typeof environment?.[name] === 'string' && environment[name].trim()
  ))
  const rejectUnauthorized = String(environment?.NODE_TLS_REJECT_UNAUTHORIZED || '').trim()
  if (rejectUnauthorized && rejectUnauthorized !== '1') {
    unsafe.push('NODE_TLS_REJECT_UNAUTHORIZED')
  }
  // This process handles a Production secret. NODE_OPTIONS has too many
  // security-sensitive switches to maintain a safe negative list (proxy,
  // preload/import, TLS key logging, trust-store and OpenSSL configuration
  // can all be changed there), so require a clean operator shell.
  if (String(environment?.NODE_OPTIONS || '').trim()) {
    unsafe.push('NODE_OPTIONS')
  }
  if (/^(?:1|true)$/i.test(String(environment?.NODE_USE_ENV_PROXY || '').trim())) {
    unsafe.push('NODE_USE_ENV_PROXY')
  }
  if (/\b(?:http|https|tls|net)\b/i.test(String(environment?.NODE_DEBUG || ''))) {
    unsafe.push('NODE_DEBUG')
  }
  if (unsafe.length > 0) {
    throw new Error(`unsafe_privileged_network_environment:${[...new Set(unsafe)].sort().join(',')}`)
  }
}

function headers(serviceKey, extra = {}) {
  return {
    apikey: serviceKey,
    ...(!/^sb_secret_/.test(serviceKey)
      ? { Authorization: `Bearer ${serviceKey}` }
      : {}),
    'Content-Type': 'application/json',
    ...extra,
  }
}

async function request(fetchImpl, url, init = {}) {
  // Keep the deadline alive through body consumption. These requests carry a
  // privileged key, so redirects, stalled bodies and unbounded responses must
  // fail before inventory or credential-rotation logic sees them.
  return fetchBounded(fetchImpl, url, init, {
    timeoutMs: TIMEOUT_MS,
    maxBytes: MAX_RESPONSE_BYTES,
  })
}

async function jsonOrThrow(response, code) {
  if (!response.ok) throw new Error(`${code}:http_${response.status}`)
  try {
    return await response.json()
  } catch {
    throw new Error(`${code}:invalid_json`)
  }
}

function exactRemainingCount(response, code) {
  const raw = response.headers.get('content-range') || ''
  const match = raw.match(/^(?:\*|[0-9]+-[0-9]+)\/(0|[1-9][0-9]*)$/)
  if (!match) throw new Error(`${code}_exact_count_missing`)
  const count = Number(match[1])
  if (!Number.isSafeInteger(count) || count > PAGE_SIZE * MAX_INVENTORY_PAGES) {
    throw new Error(`${code}_exact_count_invalid`)
  }
  return count
}

async function fetchMapRows(fetchImpl, origin, serviceKey, signal) {
  const result = []
  const seenOpenids = new Set()
  let lastOpenid = ''
  let expectedTotal = null
  for (let pageIndex = 0; pageIndex < MAX_INVENTORY_PAGES; pageIndex += 1) {
    const url = new URL(`${origin}/rest/v1/wechat_password_map`)
    url.searchParams.set('select', 'openid')
    url.searchParams.set('order', 'openid.asc')
    url.searchParams.set('limit', String(PAGE_SIZE))
    if (lastOpenid) url.searchParams.set('openid', `gt.${lastOpenid}`)
    const response = await request(fetchImpl, url, {
      headers: headers(serviceKey, { Prefer: 'count=exact' }),
      signal,
    })
    const remainingCount = exactRemainingCount(response, 'map_inventory')
    if (expectedTotal === null) expectedTotal = remainingCount
    else if (remainingCount !== expectedTotal - result.length) {
      throw new Error('map_inventory_exact_count_changed')
    }
    const body = await jsonOrThrow(response, 'map_inventory_failed')
    if (!Array.isArray(body) || body.length > PAGE_SIZE) {
      throw new Error('map_inventory_invalid')
    }
    for (const row of body) {
      if (!OPENID_RE.test(row?.openid || '')) throw new Error('map_contains_invalid_openid')
      if (seenOpenids.has(row.openid)) throw new Error('map_inventory_not_progressing')
      seenOpenids.add(row.openid)
      result.push({ openid: row.openid })
    }
    if (result.length === expectedTotal) return result
    if (result.length > expectedTotal || body.length === 0) {
      throw new Error('map_inventory_exact_count_mismatch')
    }
    lastOpenid = body.at(-1).openid
  }
  throw new Error('map_inventory_page_budget_exceeded')
}

async function fetchProfiles(fetchImpl, origin, serviceKey, signal) {
  const byOpenid = new Map()
  const seenProfileIds = new Set()
  let lastProfileId = ''
  let expectedTotal = null
  for (let pageIndex = 0; pageIndex < MAX_INVENTORY_PAGES; pageIndex += 1) {
    const url = new URL(`${origin}/rest/v1/profiles`)
    url.searchParams.set('select', 'id,wechat_openid')
    url.searchParams.set('wechat_openid', 'not.is.null')
    url.searchParams.set('order', 'id.asc')
    url.searchParams.set('limit', String(PAGE_SIZE))
    if (lastProfileId) url.searchParams.set('id', `gt.${lastProfileId}`)
    const response = await request(fetchImpl, url, {
      headers: headers(serviceKey, { Prefer: 'count=exact' }),
      signal,
    })
    const remainingCount = exactRemainingCount(response, 'profile_inventory')
    if (expectedTotal === null) expectedTotal = remainingCount
    else if (remainingCount !== expectedTotal - seenProfileIds.size) {
      throw new Error('profile_inventory_exact_count_changed')
    }
    const body = await jsonOrThrow(response, 'profile_inventory_failed')
    if (!Array.isArray(body) || body.length > PAGE_SIZE) {
      throw new Error('profile_inventory_invalid')
    }
    for (const row of body) {
      if (!UUID_RE.test(row?.id || '') || !OPENID_RE.test(row?.wechat_openid || '')) {
        throw new Error('profile_wechat_identity_invalid')
      }
      if (seenProfileIds.has(row.id)) throw new Error('profile_inventory_not_progressing')
      seenProfileIds.add(row.id)
      if (byOpenid.has(row.wechat_openid) && byOpenid.get(row.wechat_openid) !== row.id) {
        throw new Error('profile_openid_not_unique')
      }
      byOpenid.set(row.wechat_openid, row.id)
    }
    if (seenProfileIds.size === expectedTotal) return byOpenid
    if (seenProfileIds.size > expectedTotal || body.length === 0) {
      throw new Error('profile_inventory_exact_count_mismatch')
    }
    lastProfileId = body.at(-1).id
  }
  throw new Error('profile_inventory_page_budget_exceeded')
}

async function fetchAuthUsersOnce(fetchImpl, origin, serviceKey, signal) {
  const users = []
  const seenUserIds = new Set()
  let expectedTotal = null
  for (let page = 1; page <= MAX_INVENTORY_PAGES; page += 1) {
    const url = new URL(`${origin}/auth/v1/admin/users`)
    url.searchParams.set('page', String(page))
    url.searchParams.set('per_page', String(PAGE_SIZE))
    const response = await request(
      fetchImpl,
      url,
      { headers: headers(serviceKey), signal },
    )
    const totalHeader = response.headers.get('x-total-count') || ''
    if (!/^(?:0|[1-9][0-9]*)$/.test(totalHeader)) {
      throw new Error('auth_inventory_total_missing')
    }
    const pageTotal = Number(totalHeader)
    if (
      !Number.isSafeInteger(pageTotal) ||
      pageTotal > PAGE_SIZE * MAX_INVENTORY_PAGES ||
      (expectedTotal !== null && pageTotal !== expectedTotal)
    ) {
      throw new Error('auth_inventory_total_changed')
    }
    expectedTotal = pageTotal
    const body = await jsonOrThrow(response, 'auth_inventory_failed')
    if (!body || !Array.isArray(body.users)) throw new Error('auth_inventory_invalid')
    if (body.users.length > PAGE_SIZE) throw new Error('auth_inventory_invalid')
    for (const user of body.users) {
      if (!UUID_RE.test(user?.id || '')) throw new Error('auth_user_invalid')
      if (seenUserIds.has(user.id)) throw new Error('auth_inventory_not_progressing')
      seenUserIds.add(user.id)
      let email = null
      if (user.email != null) {
        if (typeof user.email !== 'string') throw new Error('auth_user_invalid')
        // GoTrue represents phone-only accounts with an empty email string.
        // Canonicalize that wire value to null so unrelated phone accounts
        // remain in the whole-Auth digest without becoming false blockers.
        email = user.email.trim() || null
      }
      users.push({ id: user.id, email })
    }
    if (seenUserIds.size === expectedTotal) return users
    if (seenUserIds.size > expectedTotal || body.users.length === 0) {
      throw new Error('auth_inventory_total_mismatch')
    }
  }
  throw new Error('auth_inventory_page_budget_exceeded')
}

function authInventorySnapshot(users) {
  return JSON.stringify(users
    .map(user => [user.id, user.email == null ? null : user.email.trim().toLowerCase()])
    .sort((left, right) => compareText(left[0], right[0])))
}

async function fetchAuthUsers(fetchImpl, origin, serviceKey, signal) {
  const first = await fetchAuthUsersOnce(fetchImpl, origin, serviceKey, signal)
  const second = await fetchAuthUsersOnce(fetchImpl, origin, serviceKey, signal)
  if (authInventorySnapshot(first) !== authInventorySnapshot(second)) {
    throw new Error('auth_inventory_not_stable')
  }
  return second
}

export function buildRetirementPlan(mapRows, profilesByOpenid, authUsers) {
  const placeholderAuthByOpenid = new Map()
  for (const user of authUsers) {
    // Phone-only/non-email users cannot match a WeChat placeholder email, but
    // they remain part of the reviewed whole-Auth inventory digest.
    if (user.email == null) continue
    const key = user.email.trim().toLowerCase()
    const placeholderLike = key.startsWith('wx_') && key.endsWith('@wechat.placeholder')
    const placeholder = key.match(/^wx_([a-z0-9_-]{4,128})@wechat\.placeholder$/)
    if (placeholderLike && !placeholder) throw new Error('placeholder_auth_email_invalid')
    if (!placeholder) continue
    const openidKey = placeholder[1]
    if (
      placeholderAuthByOpenid.has(openidKey) &&
      placeholderAuthByOpenid.get(openidKey).id !== user.id
    ) {
      throw new Error('placeholder_auth_identity_not_unique')
    }
    placeholderAuthByOpenid.set(openidKey, user)
  }

  const identities = new Map()
  const identityFor = openid => {
    if (!OPENID_RE.test(openid || '')) throw new Error('wechat_identity_invalid')
    const key = openid.toLowerCase()
    const identity = identities.get(key) || {
      key,
      canonicalOpenid: openid,
      mapOpenid: null,
      profile: null,
      authUser: null,
    }
    if (identity.canonicalOpenid !== openid) {
      throw new Error('placeholder_email_case_collision')
    }
    identities.set(key, identity)
    return identity
  }

  for (const { openid } of mapRows) {
    const identity = identityFor(openid)
    if (identity.mapOpenid) throw new Error('map_openid_not_unique')
    identity.mapOpenid = openid
  }
  for (const [openid, userId] of profilesByOpenid) {
    if (!UUID_RE.test(userId || '')) throw new Error('profile_wechat_identity_invalid')
    const identity = identityFor(openid)
    if (identity.profile && identity.profile.userId !== userId) {
      throw new Error('profile_openid_not_unique')
    }
    identity.profile = { openid, userId }
  }
  for (const [openidKey, authUser] of placeholderAuthByOpenid) {
    const identity = identities.get(openidKey) || {
      key: openidKey,
      canonicalOpenid: null,
      mapOpenid: null,
      profile: null,
      authUser: null,
    }
    identity.authUser = authUser
    identities.set(openidKey, identity)
  }

  const targets = []
  let orphanIdentities = 0
  let orphanMapRows = 0
  let orphanProfiles = 0
  let orphanAuthUsers = 0
  let maplessRotationCount = 0
  const targetUserIds = new Set()
  for (const identity of identities.values()) {
    if (!identity.profile || !identity.authUser) {
      orphanIdentities += 1
      if (identity.mapOpenid) orphanMapRows += 1
      if (identity.profile && !identity.authUser) orphanProfiles += 1
      if (identity.authUser && !identity.profile) orphanAuthUsers += 1
      continue
    }
    if (identity.profile.userId !== identity.authUser.id) {
      throw new Error('wechat_identity_user_mismatch')
    }
    if (targetUserIds.has(identity.authUser.id)) {
      throw new Error('wechat_identity_user_not_unique')
    }
    targetUserIds.add(identity.authUser.id)
    if (!identity.mapOpenid) maplessRotationCount += 1
    targets.push({
      userId: identity.authUser.id,
      openid: identity.profile.openid,
    })
  }
  const accountIdentities = {
    profiles: [...profilesByOpenid]
      .map(([openid, userId]) => [openid, userId])
      .sort((left, right) => (
        compareText(left[0], right[0]) || compareText(left[1], right[1])
      )),
    auth: authUsers
      .map(user => [
        user.id,
        user.email == null ? null : user.email.trim().toLowerCase(),
      ])
      .sort((left, right) => compareText(left[0], right[0])),
  }
  const accountIdentitySha256 = createHash('sha256')
    .update(JSON.stringify(accountIdentities))
    .digest('hex')
  const inventorySha256 = createHash('sha256').update(JSON.stringify({
    map: mapRows.map(row => row.openid).sort(),
    ...accountIdentities,
  })).digest('hex')
  return {
    targets,
    accountIdentitySha256,
    inventorySha256,
    maplessRotationCount,
    orphanRows: orphanIdentities,
    orphanMapRows,
    orphanProfiles,
    orphanAuthUsers,
  }
}

function targetIdentitySnapshot(plan) {
  return JSON.stringify(plan.targets
    .map(({ userId, openid }) => `${userId}|${openid}`)
    .sort())
}

function mapIdentitySnapshot(mapRows) {
  return JSON.stringify(mapRows.map(({ openid }) => openid).sort())
}

async function inventoryWechatCredentials(fetchImpl, origin, serviceKey, controller) {
  const inventoryTask = promise => promise.catch(error => {
    controller.abort(error)
    throw error
  })
  const [mapRows, profilesByOpenid, authUsers] = await Promise.all([
    inventoryTask(fetchMapRows(fetchImpl, origin, serviceKey, controller.signal)),
    inventoryTask(fetchProfiles(fetchImpl, origin, serviceKey, controller.signal)),
    inventoryTask(fetchAuthUsers(fetchImpl, origin, serviceKey, controller.signal)),
  ])
  return {
    mapRows,
    plan: buildRetirementPlan(mapRows, profilesByOpenid, authUsers),
  }
}

function retirementPassword() {
  // Guaranteed upper/lower/digit/symbol prefix/suffix plus 384 random bits.
  return `Wx!${randomBytes(48).toString('base64url')}9a`
}

async function rotateAuthPassword(fetchImpl, origin, serviceKey, userId, signal) {
  const response = await request(fetchImpl, `${origin}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    headers: headers(serviceKey),
    body: JSON.stringify({ password: retirementPassword() }),
    signal,
  })
  const body = await jsonOrThrow(response, 'auth_rotation_failed')
  const returnedId = body?.user?.id || body?.id
  if (returnedId !== userId) throw new Error('auth_rotation_identity_mismatch')
}

async function deleteMapRow(fetchImpl, origin, serviceKey, openid, signal) {
  const url = new URL(`${origin}/rest/v1/wechat_password_map`)
  url.searchParams.set('openid', `eq.${openid}`)
  const response = await request(fetchImpl, url, {
    method: 'DELETE',
    headers: headers(serviceKey, { Prefer: 'return=minimal' }),
    signal,
  })
  if (!response.ok) throw new Error(`map_delete_failed:http_${response.status}`)
}

export async function retireWechatCredentials({
  fetchImpl = fetch,
  supabaseUrl,
  serviceKey,
  apply = false,
  expectedInventorySha256 = '',
  logger = console,
  environment = process.env,
}) {
  assertSafePrivilegedNetworkEnvironment(environment)
  const origin = normalizeSupabaseOrigin(supabaseUrl)
  if (
    origin !== PRODUCTION_SUPABASE_ORIGIN ||
    !NAMED_SECRET_RE.test(serviceKey || '')
  ) {
    throw new Error('invalid_configuration')
  }

  const controller = new AbortController()
  const initial = await inventoryWechatCredentials(
    fetchImpl,
    origin,
    serviceKey,
    controller,
  )
  const { mapRows, plan } = initial
  logger.log(`Legacy map rows: ${mapRows.length}`)
  logger.log(`Conservative matching accounts requiring password rotation: ${plan.targets.length}`)
  logger.log(`Matching accounts without a legacy map row: ${plan.maplessRotationCount}`)
  logger.log(`Orphan WeChat identities requiring investigation: ${plan.orphanRows}`)
  logger.log(`Orphan legacy map rows: ${plan.orphanMapRows}`)
  logger.log(`WeChat profiles without placeholder Auth users: ${plan.orphanProfiles}`)
  logger.log(`Placeholder Auth users without WeChat profiles: ${plan.orphanAuthUsers}`)

  if (!apply) {
    logger.log(`Inventory SHA-256: ${plan.inventorySha256}`)
    logger.log('DRY RUN: no passwords or database rows were changed.')
    return {
      applied: false,
      mapRows: mapRows.length,
      rotationCount: plan.targets.length,
      maplessRotationCount: plan.maplessRotationCount,
      inventorySha256: plan.inventorySha256,
      orphanRows: plan.orphanRows,
    }
  }

  // Do not begin destructive cleanup until the entire inventory is proven
  // internally consistent. After this point, rotation is safe to retry.
  if (
    !/^[0-9a-f]{64}$/.test(expectedInventorySha256) ||
    expectedInventorySha256 !== plan.inventorySha256
  ) {
    throw new Error('reviewed_inventory_digest_mismatch')
  }
  if (plan.orphanRows !== 0) {
    throw new Error('orphan_wechat_identities_require_investigation')
  }
  for (const target of plan.targets) {
    await rotateAuthPassword(fetchImpl, origin, serviceKey, target.userId, controller.signal)
  }

  // A drained password-era fleet is still an external release gate. This
  // second complete snapshot additionally catches an in-flight legacy login
  // that completed after the first inventory, before any map row is deleted.
  const afterRotation = await inventoryWechatCredentials(
    fetchImpl,
    origin,
    serviceKey,
    controller,
  )
  if (
    afterRotation.plan.orphanRows !== 0 ||
    afterRotation.plan.inventorySha256 !== plan.inventorySha256 ||
    targetIdentitySnapshot(afterRotation.plan) !== targetIdentitySnapshot(plan) ||
    mapIdentitySnapshot(afterRotation.mapRows) !== mapIdentitySnapshot(mapRows)
  ) {
    throw new Error('wechat_inventory_changed_after_rotation')
  }
  logger.log('Post-rotation WeChat identity inventory is stable.')

  for (const row of afterRotation.mapRows) {
    await deleteMapRow(fetchImpl, origin, serviceKey, row.openid, controller.signal)
  }

  // Reconcile all three identity sets again, not only the map. This makes the
  // receipt fail visibly if another placeholder identity appeared or vanished
  // during cleanup. The release window must still proceed immediately to the
  // read-only PRECHECK and guarded migration while the old fleet stays drained.
  const afterCleanup = await inventoryWechatCredentials(
    fetchImpl,
    origin,
    serviceKey,
    controller,
  )
  if (afterCleanup.mapRows.length !== 0) throw new Error('map_cleanup_incomplete')
  if (
    afterCleanup.plan.orphanRows !== 0 ||
    afterCleanup.plan.accountIdentitySha256 !== plan.accountIdentitySha256 ||
    targetIdentitySnapshot(afterCleanup.plan) !== targetIdentitySnapshot(plan)
  ) {
    throw new Error('wechat_inventory_changed_after_cleanup')
  }
  logger.log('Post-cleanup WeChat identity inventory is stable and the map is empty.')
  logger.log(`APPLIED: rotated ${plan.targets.length} Auth passwords and removed ${mapRows.length} legacy map rows.`)
  return {
    applied: true,
    mapRows: mapRows.length,
    rotationCount: plan.targets.length,
    maplessRotationCount: plan.maplessRotationCount,
    inventorySha256: plan.inventorySha256,
    orphanRows: plan.orphanRows,
  }
}

export function parseRetirementArguments(argv) {
  let apply = false
  let confirmation = ''
  let projectRef = ''
  let expectedInventorySha256 = ''
  const seen = new Set()
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (![
      '--apply',
      '--confirm',
      '--project-ref',
      '--expected-inventory-sha256',
    ].includes(argument)) {
      // Never reflect an unknown token: operators sometimes paste a secret in
      // the wrong command position, and the top-level error is printed.
      throw new Error('unknown_argument')
    }
    if (seen.has(argument)) throw new Error(`duplicate_argument:${argument}`)
    seen.add(argument)
    if (argument === '--apply') {
      apply = true
      continue
    }
    const value = argv[++index]
    if (!value || value.startsWith('--')) {
      throw new Error(`missing_argument_value:${argument}`)
    }
    if (argument === '--confirm') confirmation = value
    else if (argument === '--project-ref') projectRef = value
    else expectedInventorySha256 = value
  }
  if (projectRef !== PRODUCTION_PROJECT_REF) {
    throw new Error('exact_production_project_ref_required')
  }
  if (apply && confirmation !== APPLY_CONFIRMATION) {
    throw new Error(`apply_requires_confirmation:${APPLY_CONFIRMATION}`)
  }
  if (apply && !/^[0-9a-f]{64}$/.test(expectedInventorySha256)) {
    throw new Error('apply_requires_reviewed_inventory_sha256')
  }
  if (!apply && confirmation) throw new Error('confirmation_without_apply')
  if (!apply && expectedInventorySha256) {
    throw new Error('inventory_sha256_without_apply')
  }
  return { apply, projectRef, expectedInventorySha256 }
}

async function main(argv = process.argv.slice(2)) {
  const { apply, expectedInventorySha256 } = parseRetirementArguments(argv)
  await retireWechatCredentials({
    supabaseUrl: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SECRET_KEY,
    apply,
    expectedInventorySha256,
  })
  if (!apply) {
    console.log(`To execute after a reviewed dry run: --project-ref ${PRODUCTION_PROJECT_REF} --apply --confirm ${APPLY_CONFIRMATION} --expected-inventory-sha256 <dry-run-sha256>`)
  } else {
    console.log('Next: apply the retire_wechat_password_credentials migration and run its VERIFY script.')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`WeChat credential retirement failed: ${error?.message || 'unknown_error'}`)
    process.exitCode = 1
  })
}
