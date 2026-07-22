import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from '../node_modules/typescript/lib/typescript.js'

const PAGE_URL = new URL('../src/pages/admin/index.vue', import.meta.url)

test('admin read failures remain visible and never masquerade as empty data', async () => {
  const source = await readFile(PAGE_URL, 'utf8')

  assert.match(source, /type AdminReadPhase = 'idle' \| 'ready' \| 'error'/)
  assert.match(source, /function failTabRead\(tab: TabId\)/)
  assert.match(source, /stale: previous\.phase === 'ready'/)
  assert.match(source, /activeReadState\.phase === 'error' \|\| activeReadState\.stale/)
  assert.match(source, /activeReadState\.phase === 'ready' && reportGroups\.length === 0/)
  assert.match(source, /activeReadState\.phase === 'ready' && adminTokens\.length === 0/)
  assert.match(source, /if \(!tabReadIsAuthoritative\(activeTab\.value\)\) throw new Error\('admin_read_stale'\)/)
})

test('admin search, detail, and token governance fail closed with retryable UI', async () => {
  const source = await readFile(PAGE_URL, 'utf8')

  assert.match(source, /@input="onUserQueryInput"/)
  assert.match(source, /function onUserQueryInput\(\)[\s\S]*?invalidateAdminRequest\('search-users'\)[\s\S]*?userSearching\.value = false[\s\S]*?userResults\.value = \[\][\s\S]*?userSearched\.value = false/)
  assert.match(source, /userSearchError\.value = true/)
  assert.match(source, /v-else-if="detailError"[\s\S]*?@click="retryDetail"/)
  assert.match(source, /v-if="canReadTokens && tokenInventoryUnavailable"/)
  assert.match(source, /tokenMutationIds\.includes\(token\.id\) \|\| !tokenActionsReady/)
  assert.match(source, /:aria-expanded="tokenRevokeTarget\?\.id === token\.id \? 'true' : 'false'"/)
  assert.match(source, /function restoreTokenRevokeFocus\(opener: HTMLElement \| null\)/)
  assert.match(source, /@click="openTokenRevoke\(token, \$event\)"/)
  assert.match(source, /if \(!row \|\| typeof row !== 'object'\) throw new Error\('admin_detail_not_found'\)/)
})

test('malformed 2xx reads cannot become authoritative or clear recovery tombstones', async () => {
  const source = await readFile(PAGE_URL, 'utf8')
  const get = source.slice(
    source.indexOf('function isStrictAdminDataEnvelope'),
    source.indexOf('\ntype AdminMutationJournalHandle'),
  )
  const tokens = source.slice(
    source.indexOf('async function loadTokens'),
    source.indexOf('\nfunction isSafeAuditEvidence'),
  )
  const strict = source.slice(
    source.indexOf('async function strictReloadAdminState'),
    source.indexOf('\nasync function finishAdminRecovery'),
  )
  const finish = source.slice(
    source.indexOf('async function finishAdminRecovery'),
    source.indexOf('\nasync function retryAdminOutcomeRecovery'),
  )

  assert.match(get, /hasExactAdminKeys\(value, \['data'\]\)/)
  assert.match(get, /value\.data !== null[\s\S]*?value\.data !== undefined/)
  assert.match(get, /if \(!isStrictAdminDataEnvelope\(json\)\) throw new Error\('admin_response_invalid'\)/)
  assert.match(source, /function isStrictAdminTokenInventory[\s\S]*?value\.tokens\.every\(isStrictAdminTokenRow\)[\s\S]*?isStrictOwnerRecoveryHealth/)
  assert.match(tokens, /if \(!isStrictAdminTokenInventory\(inventory\)\) throw new Error\('admin_response_invalid'\)/)
  assert.doesNotMatch(tokens, /Array\.isArray\(inventory\?\.tokens\) \? inventory\.tokens : \[\]/)
  for (const guard of [
    'isStrictReportGroup', 'isStrictSuspensionRow', 'isStrictAppealRow',
    'isStrictWarningRow', 'isStrictAuditRow', 'isStrictPlazaPostRow',
    'isStrictBannerRow',
  ]) assert.match(strict, new RegExp(`isStrictAdminRows\\([^,]+, ${guard}\\)`))
  assert.match(strict, /!isStrictAdminStats\(nextStats\)[\s\S]*?!isStrictAdminTokenInventory\(nextInventory\)[\s\S]*?throw new Error\('admin_response_invalid'\)/)
  assert.ok(finish.indexOf('await strictReloadAdminState(owner)') < finish.indexOf('clearResolvedAdminIdempotencyEntries()'))
})

test('admin success-envelope and resource guards reject malformed runtime payloads', async () => {
  const source = await readFile(PAGE_URL, 'utf8')
  const constant = name => {
    const match = source.match(new RegExp(`const ${name} = [^\\n]+`))
    assert.ok(match, `${name} exists`)
    return match[0]
  }
  const iso = source.slice(
    source.indexOf('function isAdminIsoTimestamp'),
    source.indexOf('\nfunction adminClockNow'),
  )
  const role = source.slice(
    source.indexOf('function isAdminRole'),
    source.indexOf('\nfunction roleLabel'),
  )
  const whoami = source.slice(
    source.indexOf('function isStrictWhoAmI'),
    source.indexOf('\nfunction isAdminRole'),
  )
  const inventory = source.slice(
    source.indexOf('function hasExactAdminKeys'),
    source.indexOf('\ntype AdminTokenStatus'),
  )
  const envelope = source.slice(
    source.indexOf('function isStrictAdminDataEnvelope'),
    source.indexOf('\nasync function apiGet<T>'),
  )
  const javascript = ts.transpileModule([
    constant('ADMIN_TOKEN_ID_PATTERN'),
    constant('ADMIN_UUID_PATTERN'),
    constant('ADMIN_ISO_TIMESTAMP_PATTERN'),
    constant('ADMIN_CONTROL_OR_BIDI_PATTERN'),
    iso,
    whoami,
    role,
    inventory,
    envelope,
  ].join('\n'), {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const guards = Function(
    `${javascript}; return {
      isStrictAdminDataEnvelope, isStrictAdminTokenInventory, isStrictWhoAmI,
      isStrictAdminStats, isStrictAdminRows, isStrictReportGroup,
      isStrictSuspensionRow, isStrictAppealRow, isStrictWarningRow,
      isStrictAuditRow, isStrictPlazaPostRow, isStrictBannerRow,
      isStrictUserRow, isStrictLinkedRow,
    }`,
  )()
  const id = '11111111-1111-4111-8111-111111111111'
  const otherId = '22222222-2222-4222-8222-222222222222'
  const at = '2026-07-22T00:00:00Z'
  const validInventory = {
    tokens: [{
      id: '11111111-1111-4111-8111-111111111111',
      admin_id: '22222222-2222-4222-8222-222222222222',
      admin_name: 'Owner',
      admin_email: 'owner@example.com',
      role: 'owner',
      created_at: '2026-07-22T00:00:00Z',
      last_used_at: '2026-07-22T00:01:00Z',
      expires_at: null,
      revoked_at: null,
    }],
    owner_recovery: {
      active_owner_tokens: 1,
      unverified_owner_tokens: 0,
      expiring_owner_tokens: 0,
      non_expiring_owner_tokens: 1,
      nearest_owner_expiry: null,
      status: 'warning',
    },
  }

  assert.equal(guards.isStrictAdminDataEnvelope({ data: [] }), true)
  assert.equal(guards.isStrictAdminDataEnvelope({}), false)
  assert.equal(guards.isStrictAdminDataEnvelope({ data: null }), false)
  assert.equal(guards.isStrictAdminDataEnvelope({ data: [], extra: true }), false)
  assert.equal(guards.isStrictAdminTokenInventory(validInventory), true)
  assert.equal(guards.isStrictAdminTokenInventory({}), false)
  assert.equal(guards.isStrictAdminTokenInventory({ data: validInventory }), false)
  assert.equal(guards.isStrictAdminTokenInventory({ ...validInventory, tokens: null }), false)
  assert.equal(guards.isStrictAdminTokenInventory({
    ...validInventory,
    tokens: [{ ...validInventory.tokens[0], admin_name: null }],
  }), false)

  const validWhoAmI = {
    admin_id: otherId,
    admin_name: 'Owner',
    admin_email: 'owner@example.com',
    role: 'owner',
    capabilities: ['issue_token'],
    source: 'token',
    token_id: id,
    expires_at: null,
    server_now: at,
  }
  assert.equal(guards.isStrictWhoAmI(validWhoAmI), true)
  assert.equal(guards.isStrictWhoAmI({ ...validWhoAmI, admin_name: null }), false)
  assert.equal(guards.isStrictWhoAmI({ ...validWhoAmI, admin_email: null }), false)

  const validReportGroup = {
    target_type: 'item', target_id: id, report_count: 1, pending_count: 1,
    reporter_count: 1, last_reason: 'spam', last_note: null,
    last_reporter_nickname: 'Reporter', last_status: 'pending',
    first_created_at: at, last_created_at: at, last_report_id: otherId,
  }
  const validPlazaPost = {
    id, content: 'post', author_nickname: 'User', author_id: otherId,
    is_pinned: false, is_official: false, like_count: 0, comment_count: 0,
    thumbnail: null, created_at: at,
  }
  const validLinkedRow = {
    id, nickname: 'Linked', email: null, avatar_url: null, suspension_level: 0,
    shadow_banned: false, shared_devices: 1, last_seen: at,
  }
  const fixtures = [
    [guards.isStrictAdminStats, {
      active_suspensions: 1, pending_reports: 2, pending_appeals: 3,
      shadow_banned: 4, oldest_pending_hours: 5,
    }],
    [guards.isStrictReportGroup, validReportGroup],
    [guards.isStrictSuspensionRow, {
      id, profile_id: otherId, profile_nickname: 'User', profile_avatar_url: null,
      level: 2, reason: 'reason', category: 'abuse', started_at: at, ends_at: null,
      lifted_at: null, appeal_note: null, has_appeal: false, created_at: at,
      issued_by: id, issued_by_nickname: 'Owner', lifted_by: null,
      lifted_by_nickname: null,
    }],
    [guards.isStrictAppealRow, {
      id, profile_id: otherId, profile_nickname: 'User', profile_avatar_url: null,
      level: 2, reason: 'reason', ends_at: null, appeal_note: 'please review',
      appeal_submitted_at: at, created_at: at, issued_by: id,
      issued_by_nickname: 'Owner', lifted_at: null, lifted_by: null,
      lifted_by_nickname: null, review_status: 'pending', reviewed_at: null,
    }],
    [guards.isStrictWarningRow, {
      profile_id: id, nickname: 'User', avatar_url: null, trust_score: 80,
      warning_count: 1, shadow_banned: false, suspension_level: 0,
      suspended_until: null,
    }],
    [guards.isStrictAuditRow, {
      id: 1, event_kind: 'admin_login', actor_id: id, actor_nickname: 'Owner',
      target_id: null, target_nickname: null, details: {}, created_at: at,
    }],
    [guards.isStrictPlazaPostRow, validPlazaPost],
    [guards.isStrictBannerRow, {
      id: '00000000-0000-0000-0000-000000000001', image_url: '/banner.png',
      target_url: null, title: null, title_en: 'Welcome', title_zh: null,
      priority: 100, active: true, is_default: true, start_at: null,
      end_at: null, created_at: at,
    }],
    [guards.isStrictUserRow, {
      id, nickname: 'User', email: null, avatar_url: null, trust_score: 90,
      warning_count: 0, suspension_level: 0, suspended_until: null,
      shadow_banned: false, created_at: at,
    }],
    [guards.isStrictLinkedRow, validLinkedRow],
  ]
  for (const [guard, fixture] of fixtures) {
    assert.equal(guard(fixture), true)
    assert.equal(guard({}), false)
    assert.equal(guard({ ...fixture, unexpected: true }), false)
    assert.equal(guards.isStrictAdminRows([fixture], guard), true)
    assert.equal(guards.isStrictAdminRows([{}], guard), false)
  }
  assert.equal(guards.isStrictReportGroup({ ...validReportGroup, report_count: 0 }), false)
  assert.equal(guards.isStrictReportGroup({ ...validReportGroup, reporter_count: 0 }), false)
  assert.equal(guards.isStrictPlazaPostRow({ ...validPlazaPost, author_nickname: null }), false)
  assert.equal(guards.isStrictLinkedRow({ ...validLinkedRow, last_seen: null }), false)
})

test('long admin collections expose deterministic pagination instead of silent caps', async () => {
  const source = await readFile(PAGE_URL, 'utf8')

  assert.match(source, /const ADMIN_LIST_PAGE = 50/)
  assert.match(source, /limit: String\(ADMIN_LIST_PAGE \+ 1\)/)
  assert.match(source, /offset: String\(reset \? 0 : listOffsets\.value\[tab\]\)/)
  assert.match(source, /appendUniqueBy\(current, visible, row => adminListKey\(tab, row\)\)/)
  assert.match(source, /const busyEpoch = \+\+listLoadingMoreEpoch/)
  assert.match(source, /if \(listLoadingMoreEpoch === busyEpoch\) listLoadingMore\.value = false/)
  for (const tab of ['suspensions', 'appeals', 'warnings', 'audit']) {
    assert.match(source, new RegExp(`loadMoreAdminList\\('${tab}'\\)`))
  }
  assert.match(source, /const PLAZA_PAGE = 20/)
  assert.match(source, /loadMorePlaza\('banners'\)/)
  assert.match(source, /loadMorePlaza\('posts'\)/)
  assert.match(source, /offset: String\(plazaOffsets\.value\.banners\)/)
  assert.match(source, /appendUniqueBy\(banners\.value, visible, row => row\.id\)/)
  assert.match(source, /const busyEpoch = \+\+plazaLoadingMoreEpoch/)
  assert.match(source, /if \(plazaLoadingMoreEpoch === busyEpoch\) plazaLoadingMore\.value = false/)
  assert.match(source, /reportOffset\.value = offset \+ visible\.length/)
  assert.match(source, /appendUniqueBy\(reportGroups\.value, visible, row => `\$\{row\.target_type\}:\$\{row\.target_id\}`\)/)
})
