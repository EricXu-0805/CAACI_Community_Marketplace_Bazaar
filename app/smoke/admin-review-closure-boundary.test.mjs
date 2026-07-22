import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(
  new URL('../src/pages/admin/index.vue', import.meta.url),
  'utf8',
)

function functionBlock(name, nextName) {
  const start = source.indexOf(`function ${name}`)
  const end = nextName ? source.indexOf(`\nfunction ${nextName}`, start) : -1
  assert.notEqual(start, -1, `${name} exists`)
  return source.slice(start, end === -1 ? undefined : end)
}

test('appeal cards expose three reasoned decisions and keep information requests pending', () => {
  assert.match(source, /type AppealDecision = 'accepted' \| 'denied' \| 'more_information_required'/)
  for (const decision of ['accepted', 'denied', 'more_information_required']) {
    assert.match(source, new RegExp(`@click="onDecideAppeal\\(a, '${decision}'\\)"`))
  }
  assert.match(source, /appealDecisionIds\.includes\(a\.id\)/)
  assert.match(source, /type AppealReviewStatus = 'pending' \| 'more_information_required'/)
  assert.match(source, /appeal_submitted_at: string \| null/)
  assert.match(source, /review_status\?: AppealReviewStatus \| null/)
  assert.match(source, /appealMoreInfoRequestedAt\(a\)/)
  assert.match(source, /admin\.appealManualContact/)
  assert.match(source, /filed: a\.appeal_submitted_at \? fmtTime\(a\.appeal_submitted_at\) : t\('admin\.appealFiledTimeUnknown'\)/)
  assert.doesNotMatch(source, /filed: fmtTime\(a\.created_at\)/)

  const decide = functionBlock('onDecideAppeal', 'canOpenTarget')
  assert.match(decide, /const reason = moderationReasonOrNotify\(r\.content\)/)
  assert.match(decide, /if \(reason === null\) return/)
  assert.match(decide, /action: 'decide_appeal'[\s\S]*?suspension_id: a\.id[\s\S]*?decision[\s\S]*?reason/)
  assert.match(decide, /refreshAppealDecisionState\(owner\)/)
  assert.doesNotMatch(decide, /decision:\s*'rejected'/)

  const refresh = functionBlock('refreshAppealDecisionState', 'onDecideAppeal')
  assert.match(refresh, /loadTab\('appeals', owner, true\)/)
  assert.match(refresh, /loadPagedAdminTab\('suspensions', true, suspensionsRequest\)/)
  assert.match(refresh, /loadPagedAdminTab\('audit', true, auditRequest\)/)
  assert.match(refresh, /loadStats\(owner, true\)/)
})

test('whoami rejects missing, null, or extra session metadata and uses database time', () => {
  assert.match(source, /interface WhoAmI[\s\S]*?token_id: string[\s\S]*?expires_at: string \| null[\s\S]*?server_now: string/)
  const validator = functionBlock('isStrictWhoAmI', 'isAdminRole')
  assert.match(validator, /ADMIN_TOKEN_ID_PATTERN\.test\(row\.token_id\)/)
  assert.match(validator, /Object\.keys\(row\)\.sort\(\)/)
  assert.match(validator, /actual\.length !== expected\.length/)
  assert.match(validator, /actual\.some\(\(key, index\) => key !== expected\[index\]\)/)
  assert.match(validator, /row\.source !== 'token'/)
  assert.match(validator, /!isAdminIsoTimestamp\(row\.server_now\)/)
  assert.match(validator, /!isAdminIsoTimestamp\(row\.expires_at\)/)
  assert.match(validator, /expiresAt > serverNow/)
  assert.doesNotMatch(validator, /row\.server_now === undefined|row\.server_now === null/)

  const fallbackClock = functionBlock('updateAdminServerClock', 'useAuthoritativeAdminClock')
  assert.match(fallbackClock, /adminServerClockSource === 'database'/)
  assert.match(fallbackClock, /seedAdminServerClock\(serverNow, 'http'\)/)
  assert.match(source, /useAuthoritativeAdminClock\(identity\.server_now\)/)
  assert.match(source, /seedAdminServerClock\(Date\.parse\(serverNow\), 'database'\)/)
  assert.match(source, /function isExpired[\s\S]*?t <= adminClockNow\(\)/)
  assert.match(source, /const MAX_ADMIN_TIMER_DELAY_MS = 2_147_000_000/)

  const schedule = functionBlock('scheduleAdminTokenExpiry', 'isStrictWhoAmI')
  assert.match(schedule, /isAdminSessionOwnerCurrent\(owner\)/)
  assert.match(schedule, /whoami\.value\?\.token_id !== tokenId/)
  assert.match(schedule, /Math\.min\(remaining, MAX_ADMIN_TIMER_DELAY_MS\)/)
  assert.match(schedule, /if \(remaining <= 0\)/)
  assert.match(schedule, /onLogout\(owner\)/)

  const reset = functionBlock('resetAdminPrivateState', 'onLogout')
  assert.match(reset, /clearAdminTokenExpiryTimer\(\)/)
  assert.match(reset, /adminServerClockBaseMs = null/)
  assert.match(reset, /adminWallClockBaseMs = null/)
  assert.match(reset, /adminMonotonicClockBaseMs = null/)
  assert.match(reset, /adminServerClockSource = 'none'/)
  for (const snapshot of ['whoami', 'reports', 'suspensions', 'appeals', 'auditLog', 'adminTokens', 'userResults', 'linkedAccounts', 'banners', 'detailRow']) {
    assert.match(reset, new RegExp(`${snapshot}\\.value = (?:\\[\\]|null)`), `${snapshot} is cleared`)
  }
  assert.match(source, /onHide\(lockAdminSessionOnLeave\)/)
  assert.match(source, /onUnload\(lockAdminSessionOnLeave\)/)
  assert.match(source, /onUnmounted\(\(\) => \{[\s\S]*?lockAdminSessionOnLeave\(\)/)
})

test('server clock cannot be extended by a wall-clock rollback and fails closed on a jump forward', () => {
  const clock = functionBlock('adminClockNow', 'clearAdminTokenExpiryTimer')
  assert.match(clock, /wallElapsed = Math\.max\(0, Date\.now\(\) - adminWallClockBaseMs\)/)
  assert.match(clock, /monotonicElapsed = monotonicNow !== null && adminMonotonicClockBaseMs !== null/)
  assert.match(clock, /Math\.max\(0, monotonicNow - adminMonotonicClockBaseMs\)/)
  assert.match(clock, /adminServerClockBaseMs \+ Math\.max\(wallElapsed, monotonicElapsed\)/)

  const projectedNow = ({ serverBase, wallBase, monotonicBase, wallNow, monotonicNow }) => {
    const wallElapsed = Math.max(0, wallNow - wallBase)
    const monotonicElapsed = monotonicNow === null || monotonicBase === null
      ? 0
      : Math.max(0, monotonicNow - monotonicBase)
    return serverBase + Math.max(wallElapsed, monotonicElapsed)
  }
  const baseline = { serverBase: 1_000_000, wallBase: 50_000, monotonicBase: 5_000 }
  const rollbackAtExpiry = projectedNow({ ...baseline, wallNow: 40_000, monotonicNow: 10_000 })
  assert.equal(rollbackAtExpiry, 1_005_000)
  assert.equal(projectedNow({ ...baseline, wallNow: 60_000, monotonicNow: 10_000 }), 1_010_000)
  assert.equal(rollbackAtExpiry >= 1_005_000, true, 'expiry timer still closes after wall-clock rollback')
})

test('audit rendering is event-specific and only exposes bounded allowlisted fields', () => {
  const audit = source.slice(
    source.indexOf('type SafeAuditField'),
    source.indexOf('\nasync function setTab'),
  )
  assert.match(audit, /MAX_AUDIT_FIELD_CHARS/)
  assert.match(audit, /replace\(\/\[\\u0000-\\u001F\\u007F-\\u009F\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069\]/)
  assert.match(audit, /Object\.prototype\.hasOwnProperty\.call\(details, field\)/)
  for (const kind of ['token_issued', 'token_revoked', 'post_pin_changed', 'banner_changed', 'appeal_decided', 'appeal_more_information_requested']) {
    assert.match(audit, new RegExp(`case '${kind}'`))
  }
  for (const field of ['token_id', 'case_id', 'approval_ref', 'op', 'decision', 'reason']) {
    assert.match(audit, new RegExp(`['"]${field}['"]`))
  }
  assert.doesNotMatch(audit, /JSON\.stringify\(r\.details|JSON\.stringify\(details/)
})

test('destructive confirmations sanitize display names and always retain immutable ids', () => {
  const boundedSource = functionBlock('boundedAuditField', 'moderationReasonOrNotify')
    .replace('value: unknown', 'value')
    .replace('): string | null', ')')
  const bounded = Function(
    'MAX_AUDIT_FIELD_CHARS',
    `"use strict"; ${boundedSource}; return boundedAuditField`,
  )(160)
  assert.equal(bounded('safe\u202Ename\u0007\u061C\u200F'), 'safe name')
  assert.equal(bounded(null), null)

  const profile = functionBlock('adminProfileTarget', 'adminTokenTarget')
  assert.match(profile, /name: boundedAuditField\(nickname\) \|\| '—'/)
  assert.match(profile, /profileId: boundedAuditField\(profileId\) \|\| '—'/)
  const token = functionBlock('adminTokenTarget', 'adminBannerTarget')
  assert.match(token, /name: boundedAuditField\(token\.admin_name \|\| token\.admin_email\) \|\| '—'/)
  assert.match(token, /tokenId: boundedAuditField\(token\.id\) \|\| '—'/)
  assert.match(token, /adminId: boundedAuditField\(token\.admin_id\)/)
  const banner = functionBlock('adminBannerTarget', 'adminPostTarget')
  assert.match(banner, /title: boundedAuditField\(banner\.title_zh \|\| banner\.title_en \|\| banner\.title\)/)
  assert.match(banner, /bannerId: boundedAuditField\(banner\.id\) \|\| '—'/)
  const post = functionBlock('adminPostTarget', 'adminReportTarget')
  assert.match(post, /excerpt: boundedAuditField\(post\.content\) \|\| '—'/)
  assert.match(post, /postId: boundedAuditField\(post\.id\) \|\| '—'/)
  const report = functionBlock('adminReportTarget', 'adminSuspensionTarget')
  assert.match(report, /type: boundedAuditField\(report\.target_type\) \|\| '—'/)
  assert.match(report, /targetId: boundedAuditField\(report\.target_id\) \|\| '—'/)
  const suspension = functionBlock('adminSuspensionTarget', 'appealDecisionTarget')
  assert.match(suspension, /profile: adminProfileTarget\(nickname, profileId\)/)
  assert.match(suspension, /suspensionId: boundedAuditField\(suspensionId\) \|\| '—'/)
  assert.match(source, /return adminSuspensionTarget\(a\.profile_nickname, a\.profile_id, a\.id\)/)
  assert.match(source, /const target = adminSuspensionTarget\(s\.profile_nickname, s\.profile_id \|\| '—', s\.id\)/)
  assert.match(source, /revokeTokenBody'[\s\S]*?adminTokenTarget\(token\)/)
  assert.doesNotMatch(source, /revokeTokenBody'[\s\S]{0,100}?token\.admin_name/)

  const pin = functionBlock('togglePin', 'editBanner')
  assert.match(pin, /const target = adminPostTarget\(p\)/)
  assert.match(pin, /plazaChangeConfirmBody/)
  assert.match(pin, /post_id: postId/)
  const toggleBanner = functionBlock('toggleBannerActive', 'deleteBanner')
  assert.match(toggleBanner, /const target = adminBannerTarget\(b\)/)
  assert.match(toggleBanner, /plazaChangeConfirmBody/)
  assert.match(toggleBanner, /id: bannerId, active: desiredActive/)
  const removeBanner = functionBlock('deleteBanner', 'loadLinked')
  assert.match(removeBanner, /const target = adminBannerTarget\(b\)/)
  assert.match(removeBanner, /bannerDeleteBody', \{ target \}/)
  assert.match(removeBanner, /action: 'delete_banner', id: bannerId/)
  const bulk = functionBlock('bulkResolve', 'resolveTargetReports')
  assert.match(bulk, /previewGroups\.map\(adminReportTarget\)/)
  assert.match(bulk, /bulkConfirmBody'[\s\S]*?targets, more/)
  const resolve = functionBlock('resolveTargetReports', 'adminProfileTarget')
  assert.match(resolve, /resolveAllConfirmBody'[\s\S]*?target: adminReportTarget\(g\)/)
  const ban = functionBlock('onBanPrompt', 'fmtTime')
  assert.match(ban, /const target = adminProfileTarget\(nickname, targetId\)/)
  assert.match(ban, /banConfirmBody'[\s\S]*?target,[\s\S]*?impact:/)
})

test('all moderation reasons trim, bound, and reject control or bidi formatting characters locally', () => {
  const validatorSource = functionBlock('moderationReasonOrNotify', 'auditDetails')
    .replace('value: unknown', 'value')
    .replace('): string | null', ')')
  const notices = []
  const validate = Function(
    'MAX_ADMIN_REASON_CHARS',
    'ADMIN_CONTROL_OR_BIDI_PATTERN',
    'uni',
    't',
    `"use strict"; ${validatorSource}; return moderationReasonOrNotify`,
  )(
    1000,
    /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u,
    { showToast: notice => notices.push(notice) },
    key => key,
  )

  assert.equal(validate('  documented reason  '), 'documented reason')
  assert.equal(validate(''), null)
  assert.equal(validate('x'.repeat(1001)), null)
  for (const unsafe of ['line\nbreak', 'bad\u061Ctext', 'bad\u200Etext', 'bad\u200Ftext', 'bad\u202Etext', 'bad\u2067text']) {
    assert.equal(validate(unsafe), null, JSON.stringify(unsafe))
  }
  assert.ok(notices.some(notice => notice.title === 'admin.reasonRequired'))
  assert.ok(notices.some(notice => notice.title === 'admin.reasonTooLong'))
  assert.ok(notices.some(notice => notice.title === 'admin.reasonUnsafeCharacters'))

  for (const [name, nextName] of [
    ['onDecideAppeal', 'canOpenTarget'],
    ['onTakedownContent', 'openUser'],
    ['onLiftSuspension', 'onBanPrompt'],
    ['onBanPrompt', 'fmtTime'],
  ]) {
    const block = functionBlock(name, nextName)
    assert.match(block, /const reason = moderationReasonOrNotify\(r\.content\)/, name)
    assert.match(block, /if \(reason === null\) return/, name)
  }
})

test('user search rejects one-character enumeration and labels the 50-row display boundary', () => {
  assert.match(source, /const USER_SEARCH_LIMIT = 50/)
  assert.match(source, /ADMIN_TOKEN_ID_PATTERN\.test\(query\) \|\| Array\.from\(query\)\.length >= 2/)
  assert.match(source, /if \(!userQueryValid\.value\) return/)
  assert.match(source, /userResults\.value = rows\.slice\(0, USER_SEARCH_LIMIT\)/)
  assert.match(source, /v-if="userResults\.length >= USER_SEARCH_LIMIT"/)
  assert.match(source, /admin\.userSearchLimit/)
  assert.match(source, /admin\.userSearchTooShort/)
})

test('lift and content removal require bounded operator reasons and name the target impact', () => {
  const takedown = functionBlock('onTakedownContent', 'openUser')
  assert.match(takedown, /admin\.takedownConfirmBody[\s\S]*?type: boundedAuditField\(row\.target_type\)[\s\S]*?id: boundedAuditField\(row\.target_id\)/)
  assert.match(takedown, /editable: true/)
  assert.match(takedown, /const reason = moderationReasonOrNotify\(r\.content\)/)
  assert.match(takedown, /action: 'takedown_content'[\s\S]*?reason/)
  assert.doesNotMatch(takedown, /reason: 'admin takedown'/)

  const lift = functionBlock('onLiftSuspension', 'onBanPrompt')
  assert.match(lift, /admin\.liftConfirmBody[\s\S]*?\{ target \}/)
  assert.match(lift, /editable: true/)
  assert.match(lift, /const reason = moderationReasonOrNotify\(r\.content\)/)
  assert.match(lift, /action: 'lift_suspension'[\s\S]*?reason/)
  assert.doesNotMatch(lift, /\|\| t\('admin\.adminReview'\)/)
})

test('appeal pre-dispatch validation errors release the durable mutation key', () => {
  const start = source.indexOf('const DEFINITIVE_ADMIN_NO_COMMIT_ERRORS')
  const end = source.indexOf('\n])', start)
  const errors = source.slice(start, end)
  assert.match(errors, /'invalid_args'/)
  assert.match(errors, /'invalid_decision'/)
})
