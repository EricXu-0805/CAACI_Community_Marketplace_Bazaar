import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from '../node_modules/typescript/lib/typescript.js'

const source = await readFile(
  new URL('../src/pages/admin/index.vue', import.meta.url),
  'utf8',
)

function functionBlock(name, nextName) {
  const start = source.indexOf(`function ${name}`)
  const end = source.indexOf(`function ${nextName}`, start)
  assert.notEqual(start, -1, `${name} exists`)
  assert.notEqual(end, -1, `${nextName} follows ${name}`)
  return source.slice(start, end)
}

test('the current session token is visibly protected before revocation evidence can open', () => {
  assert.match(source, /function isCurrentAdminToken\(token: AdminTokenRow\): boolean[\s\S]*?whoami\.value\?\.token_id === token\.id/)
  assert.match(source, /v-if="isCurrentAdminToken\(token\)"[\s\S]*?admin\.currentToken/)
  assert.match(source, /disabled: isCurrentAdminToken\(token\) \|\| tokenMutationIds\.includes\(token\.id\) \|\| !tokenActionsReady/)
  assert.match(source, /isCurrentAdminToken\(token\) \? t\('admin\.currentTokenProtected'\) : t\('admin\.revokeToken'\)/)

  const open = functionBlock('openTokenRevoke', 'focusInvalidTokenRevokeEvidence')
  const confirm = functionBlock('confirmTokenRevoke', 'togglePin')
  assert.match(open, /isCurrentAdminToken\(token\)/)
  assert.match(confirm, /isCurrentAdminToken\(token\)/)
})

test('token inventory expiry uses the authoritative admin clock', () => {
  const status = functionBlock('tokenStatus', 'isCurrentAdminToken')
  assert.match(status, /Date\.parse\(token\.expires_at\) <= adminClockNow\(\)/)
  assert.doesNotMatch(status, /Date\.now\(\)/)
})

test('moderation writes are single-flight per action target and expose disabled controls', () => {
  assert.match(source, /const moderationMutationKeys = ref<string\[\]>\(\[\]\)/)
  assert.match(source, /function beginModerationMutation\(key: string\): boolean[\s\S]*?if \(moderationMutationBusy\(key\)\) return false[\s\S]*?moderationMutationKeys\.value = \[\.\.\.moderationMutationKeys\.value, key\]/)
  assert.match(source, /moderationMutationKeys\.value = \[\]/)

  for (const [name, nextName, keyHelper] of [
    ['resolveTargetReports', 'adminProfileTarget', 'reportMutationKey'],
    ['onTakedownContent', 'openUser', 'takedownMutationKey'],
    ['onLiftSuspension', 'onBanPrompt', 'liftMutationKey'],
    ['onBanPrompt', 'fmtTime', 'banMutationKey'],
  ]) {
    const block = functionBlock(name, nextName)
    assert.match(block, new RegExp(`const mutationKey = ${keyHelper}\\(`), name)
    assert.match(block, /beginModerationMutation\(mutationKey\)/, name)
    assert.match(block, /finally[\s\S]*?endModerationMutation\(mutationKey\)/, name)
  }

  assert.match(source, /disabled: reportMutationBusy\(g\)/)
  assert.match(source, /disabled: takedownMutationBusy\(detailRow\)/)
  assert.match(source, /disabled: liftMutationBusy\((?:s|detailRow)\)/)
  assert.match(source, /disabled: banMutationBusy\((?:u\.id|la\.id|w\.profile_id|detailRow\.target_user_id)\)/)
})

test('the action-target lock rejects a second dispatch until the first releases', () => {
  const start = source.indexOf('const moderationMutationKeys')
  const end = source.indexOf('\nconst warnings', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const javascript = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const locks = Function(
    'ref',
    `${javascript}; return { moderationMutationBusy, beginModerationMutation, endModerationMutation, reportMutationKey, banMutationKey }`,
  )(value => ({ value }))

  const report = { target_type: 'item', target_id: 'target-a' }
  const reportKey = locks.reportMutationKey(report)
  assert.equal(locks.beginModerationMutation(reportKey), true)
  assert.equal(locks.moderationMutationBusy(reportKey), true)
  assert.equal(locks.beginModerationMutation(reportKey), false)
  assert.equal(locks.beginModerationMutation(locks.banMutationKey('target-a')), true)
  locks.endModerationMutation(reportKey)
  assert.equal(locks.moderationMutationBusy(reportKey), false)
  assert.equal(locks.beginModerationMutation(reportKey), true)
})
