import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

/*
 * P3.6 ③: the moderation queue is read by longest wait, and a target that has
 * waited more than 24 hours, or more than 48, is coloured. P3.5: the console's
 * five governance buttons send exactly the action the API accepts.
 */
const source = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const { reportWaitLevel } = await import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(source('utils/reportWait.ts'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText).toString('base64')}`)
const page = source('pages/admin/index.vue')
const HOUR = 3_600_000
const NOW = Date.parse('2026-11-20T12:00:00Z')
const waited = ms => new Date(NOW - ms).toISOString()

test('a target is marked after more than 24 hours and again after more than 48', () => {
  assert.equal(reportWaitLevel(waited(0), NOW), 0)
  assert.equal(reportWaitLevel(waited(24 * HOUR), NOW), 0)
  assert.equal(reportWaitLevel(waited(24 * HOUR + 1), NOW), 24)
  assert.equal(reportWaitLevel(waited(48 * HOUR), NOW), 24)
  assert.equal(reportWaitLevel(waited(48 * HOUR + 1), NOW), 48)
  assert.equal(reportWaitLevel(waited(30 * 24 * HOUR), NOW), 48)
  // Nothing pending, or a time that cannot be read, is not a wait.
  for (const value of [null, undefined, '', 'yesterday']) assert.equal(reportWaitLevel(value, NOW), 0)
  // A report dated after the console's clock has not waited either.
  assert.equal(reportWaitLevel(waited(-HOUR), NOW), 0)
})

test('the pending queue is read by longest wait and its rows must say since when', () => {
  // Both reads of the pending view: the strict reload and the tab's own loader.
  assert.equal(page.split("resource: 'report_queue'").length - 1, 2)
  const validator = page.slice(page.indexOf('function isStrictReportQueueRow'), page.indexOf('function isStrictSuspensionRow'))
  assert.match(validator, /'oldest_pending_at'/)
  assert.match(validator, /isAdminIsoTimestamp\(oldest\)/)
  assert.match(validator, /isStrictReportGroup\(group\)/)
})

test('the two wait marks use the warning and danger surfaces and carry their own label', () => {
  assert.match(page, /\.card\.wait-24 \{ background: var\(--warning-soft\); \}/)
  assert.match(page, /\.card\.wait-48 \{ background: var\(--danger-soft\); \}/)
  const card = page.slice(page.indexOf('v-for="g in reportGroups"'), page.indexOf("t('admin.reportGroupCount'"))
  assert.match(card, /reportWait\(g\) \? 'wait-' \+ reportWait\(g\) : ''/)
  assert.match(card, /t\(reportWait\(g\) === 48 \? 'admin\.waitOver48' : 'admin\.waitOver24'\)/)
})

test('each governance button sends its own action, and a named refusal does not lock the console', () => {
  const block = page.slice(page.indexOf('function governTopic('), page.indexOf('function onMoveTopic('))
  for (const [action, fields] of [
    ['restore_content', /target_type: 'post', target_id: p\.id/],
    ['set_post_locked', /post_id: p\.id, locked: !p\.locked_at/],
    ['set_post_official', /post_id: p\.id, official: !p\.is_official/],
    ['set_post_featured', /post_id: p\.id, featured: !p\.is_featured/],
  ]) {
    const call = block.slice(block.indexOf(`action: '${action}'`))
    assert.ok(block.includes(`action: '${action}'`), action)
    assert.match(call.slice(0, 160), fields, action)
  }
  assert.match(page.slice(page.indexOf('function onMoveTopic('), page.indexOf('function onMoveTopic(') + 900),
    /action: 'set_post_category', post_id: p\.id, category/)
  // Every one asks for a reason and goes through the journaled POST.
  assert.match(block, /showModerationReason\(/)
  assert.match(block, /const reason = moderationReasonOrNotify\(r\.content\)/)
  assert.match(block, /await apiPost</)
  // The API answers these four by name before anything is written, so the request key is released.
  const allowlist = page.slice(page.indexOf('const DEFINITIVE_ADMIN_NO_COMMIT_ERRORS'), page.indexOf('\n])', page.indexOf('const DEFINITIVE_ADMIN_NO_COMMIT_ERRORS')))
  for (const name of ['official_profile_not_configured', 'post_not_official_account', 'post_not_official', 'post_not_topic']) {
    assert.match(allowlist, new RegExp(`'${name}'`), name)
  }
})
