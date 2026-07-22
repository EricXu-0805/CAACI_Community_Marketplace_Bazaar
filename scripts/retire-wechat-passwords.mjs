#!/usr/bin/env node
/*
 * Retire the legacy plaintext WeChat password map.
 *
 * Safe default: inventory only. The mutating path requires BOTH:
 *   --apply --confirm RETIRE_WECHAT_PASSWORDS
 *
 * The operation is deliberately ordered:
 *   1. inventory every legacy map row and every Auth user;
 *   2. prove case-insensitive placeholder emails are unambiguous;
 *   3. rotate every matching Auth password to an unrecoverable random value;
 *   4. only after every rotation succeeds, delete the legacy map rows;
 *   5. verify the map is empty.
 *
 * It never reads the plaintext password column and never prints openids,
 * emails, passwords, service keys, or response bodies.
 */

import { randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { fetchBounded, normalizeSupabaseOrigin } from './http-boundary.mjs'

export { normalizeSupabaseOrigin } from './http-boundary.mjs'

const PAGE_SIZE = 500
const TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const OPENID_RE = /^[A-Za-z0-9_-]{4,128}$/

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

async function fetchMapRows(fetchImpl, origin, serviceKey) {
  const result = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const url = new URL(`${origin}/rest/v1/wechat_password_map`)
    url.searchParams.set('select', 'openid')
    url.searchParams.set('order', 'openid.asc')
    url.searchParams.set('limit', String(PAGE_SIZE))
    url.searchParams.set('offset', String(offset))
    const body = await jsonOrThrow(
      await request(fetchImpl, url, { headers: headers(serviceKey) }),
      'map_inventory_failed',
    )
    if (!Array.isArray(body)) throw new Error('map_inventory_invalid')
    for (const row of body) {
      if (!OPENID_RE.test(row?.openid || '')) throw new Error('map_contains_invalid_openid')
      result.push({ openid: row.openid })
    }
    if (body.length < PAGE_SIZE) break
  }
  return result
}

async function fetchProfiles(fetchImpl, origin, serviceKey) {
  const byOpenid = new Map()
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const url = new URL(`${origin}/rest/v1/profiles`)
    url.searchParams.set('select', 'id,wechat_openid')
    url.searchParams.set('wechat_openid', 'not.is.null')
    url.searchParams.set('order', 'id.asc')
    url.searchParams.set('limit', String(PAGE_SIZE))
    url.searchParams.set('offset', String(offset))
    const body = await jsonOrThrow(
      await request(fetchImpl, url, { headers: headers(serviceKey) }),
      'profile_inventory_failed',
    )
    if (!Array.isArray(body)) throw new Error('profile_inventory_invalid')
    for (const row of body) {
      if (!UUID_RE.test(row?.id || '') || !OPENID_RE.test(row?.wechat_openid || '')) {
        throw new Error('profile_wechat_identity_invalid')
      }
      if (byOpenid.has(row.wechat_openid) && byOpenid.get(row.wechat_openid) !== row.id) {
        throw new Error('profile_openid_not_unique')
      }
      byOpenid.set(row.wechat_openid, row.id)
    }
    if (body.length < PAGE_SIZE) break
  }
  return byOpenid
}

async function fetchAuthUsers(fetchImpl, origin, serviceKey) {
  const users = []
  for (let page = 1; ; page += 1) {
    const url = new URL(`${origin}/auth/v1/admin/users`)
    url.searchParams.set('page', String(page))
    url.searchParams.set('per_page', String(PAGE_SIZE))
    const body = await jsonOrThrow(
      await request(fetchImpl, url, { headers: headers(serviceKey) }),
      'auth_inventory_failed',
    )
    if (!body || !Array.isArray(body.users)) throw new Error('auth_inventory_invalid')
    for (const user of body.users) {
      if (!UUID_RE.test(user?.id || '')) throw new Error('auth_user_invalid')
      // Phone-only/non-email users cannot match a WeChat placeholder email.
      if (user.email == null) continue
      if (typeof user.email !== 'string' || !user.email.trim()) throw new Error('auth_user_invalid')
      users.push({ id: user.id, email: user.email })
    }
    if (body.users.length < PAGE_SIZE) break
  }
  return users
}

export function buildRetirementPlan(mapRows, profilesByOpenid, authUsers) {
  const authByEmail = new Map()
  for (const user of authUsers) {
    const key = user.email.trim().toLowerCase()
    if (authByEmail.has(key) && authByEmail.get(key).id !== user.id) {
      throw new Error('auth_email_not_unique')
    }
    authByEmail.set(key, user)
  }

  const expectedEmails = new Map()
  const targets = []
  let orphanRows = 0
  for (const { openid } of mapRows) {
    const expectedEmail = `wx_${openid}@wechat.placeholder`.toLowerCase()
    if (expectedEmails.has(expectedEmail) && expectedEmails.get(expectedEmail) !== openid) {
      // Auth normalizes email case, so two case-distinct openids would alias.
      throw new Error('placeholder_email_case_collision')
    }
    expectedEmails.set(expectedEmail, openid)

    const authUser = authByEmail.get(expectedEmail)
    const profileId = profilesByOpenid.get(openid)
    if (!authUser) {
      orphanRows += 1
      continue
    }
    if (profileId && profileId !== authUser.id) throw new Error('wechat_identity_user_mismatch')
    targets.push({ userId: authUser.id, openid })
  }
  return { targets, orphanRows }
}

function retirementPassword() {
  // Guaranteed upper/lower/digit/symbol prefix/suffix plus 384 random bits.
  return `Wx!${randomBytes(48).toString('base64url')}9a`
}

async function rotateAuthPassword(fetchImpl, origin, serviceKey, userId) {
  const response = await request(fetchImpl, `${origin}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    headers: headers(serviceKey),
    body: JSON.stringify({ password: retirementPassword() }),
  })
  const body = await jsonOrThrow(response, 'auth_rotation_failed')
  const returnedId = body?.user?.id || body?.id
  if (returnedId !== userId) throw new Error('auth_rotation_identity_mismatch')
}

async function deleteMapRow(fetchImpl, origin, serviceKey, openid) {
  const url = new URL(`${origin}/rest/v1/wechat_password_map`)
  url.searchParams.set('openid', `eq.${openid}`)
  const response = await request(fetchImpl, url, {
    method: 'DELETE',
    headers: headers(serviceKey, { Prefer: 'return=minimal' }),
  })
  if (!response.ok) throw new Error(`map_delete_failed:http_${response.status}`)
}

export async function retireWechatCredentials({
  fetchImpl = fetch,
  supabaseUrl,
  serviceKey,
  apply = false,
  logger = console,
}) {
  const origin = normalizeSupabaseOrigin(supabaseUrl)
  if (!origin || !serviceKey) throw new Error('invalid_configuration')

  const [mapRows, profilesByOpenid, authUsers] = await Promise.all([
    fetchMapRows(fetchImpl, origin, serviceKey),
    fetchProfiles(fetchImpl, origin, serviceKey),
    fetchAuthUsers(fetchImpl, origin, serviceKey),
  ])
  const plan = buildRetirementPlan(mapRows, profilesByOpenid, authUsers)
  logger.log(`Legacy map rows: ${mapRows.length}`)
  logger.log(`Auth passwords requiring rotation: ${plan.targets.length}`)
  logger.log(`Orphan map rows without a matching Auth user: ${plan.orphanRows}`)

  if (!apply) {
    logger.log('DRY RUN: no passwords or database rows were changed.')
    return {
      applied: false,
      mapRows: mapRows.length,
      rotationCount: plan.targets.length,
      orphanRows: plan.orphanRows,
    }
  }

  // Do not begin destructive cleanup until the entire inventory is proven
  // internally consistent. After this point, rotation is safe to retry.
  for (const target of plan.targets) {
    await rotateAuthPassword(fetchImpl, origin, serviceKey, target.userId)
  }
  for (const row of mapRows) {
    await deleteMapRow(fetchImpl, origin, serviceKey, row.openid)
  }

  const remaining = await fetchMapRows(fetchImpl, origin, serviceKey)
  if (remaining.length !== 0) throw new Error('map_cleanup_incomplete')
  logger.log(`APPLIED: rotated ${plan.targets.length} Auth passwords and removed ${mapRows.length} legacy map rows.`)
  return {
    applied: true,
    mapRows: mapRows.length,
    rotationCount: plan.targets.length,
    orphanRows: plan.orphanRows,
  }
}

async function main() {
  const apply = process.argv.includes('--apply')
  const confirmIndex = process.argv.indexOf('--confirm')
  const confirmation = confirmIndex >= 0 ? process.argv[confirmIndex + 1] : ''
  if (apply && confirmation !== 'RETIRE_WECHAT_PASSWORDS') {
    throw new Error('Apply requires: --apply --confirm RETIRE_WECHAT_PASSWORDS')
  }
  await retireWechatCredentials({
    supabaseUrl: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
    apply,
  })
  if (!apply) {
    console.log('To execute after a reviewed dry run: --apply --confirm RETIRE_WECHAT_PASSWORDS')
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
