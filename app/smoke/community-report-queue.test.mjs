import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

/*
 * P3.6 ③: when a target counts as having waited more than 24 hours, or more than 48. P3.5: which
 * refusals release the request key. What the console shows and sends (the queue's order and colours,
 * the five governance actions) is checked in the running page: community-report-queue.spec.ts.
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

test('a refusal the API names before anything is written does not lock the console', () => {
  // The API answers these four by name before anything is written, so the request key is released.
  const allowlist = page.slice(page.indexOf('const DEFINITIVE_ADMIN_NO_COMMIT_ERRORS'), page.indexOf('\n])', page.indexOf('const DEFINITIVE_ADMIN_NO_COMMIT_ERRORS')))
  for (const name of ['official_profile_not_configured', 'post_not_official_account', 'post_not_official', 'post_not_topic']) {
    assert.match(allowlist, new RegExp(`'${name}'`), name)
  }
})
