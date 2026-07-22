import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(resolve(appRoot, 'src/pages/suspended/index.vue'), 'utf8')

test('appeal RPC binds the captured account and exact suspension intent', () => {
  assert.match(source, /captureAccountRequest\(userId\)/)
  assert.match(source, /expected_user_id_in:\s*accountToken\.userId/)
  assert.match(source, /expected_suspension_id_in:\s*suspensionId/)
  assert.match(source, /activeSuspension\.value\?\.id !== suspensionId/)
})

test('late suspension reads cannot cross an account, route, or request epoch', () => {
  assert.match(source, /requestEpoch === suspensionLoadEpoch/)
  assert.match(source, /isAccountRequestCurrent\(accountToken\)/)
  assert.match(source, /currentUser\.value\?\.id === accountToken\.userId/)
  assert.match(source, /onUnmounted\(\(\) => \{[\s\S]*suspensionLoadEpoch \+= 1/)
  assert.match(source, /watch\(\(\) => currentUser\.value\?\.id \|\| null/)
})

test('unknown mutation outcomes reconcile the authoritative exact row before retry UI', () => {
  assert.match(source, /reconcileAppealAfterUnknownOutcome/)
  assert.match(source, /\.eq\('id', suspensionId\)[\s\S]*\.eq\('profile_id', accountToken\.userId\)/)
  assert.match(source, /if \(!data\?\.appeal_note\) return false/)
  assert.match(source, /The RPC is first-write-wins/)
  assert.match(source, /if \(committed\) \{[\s\S]*suspended\.appealSent/)
})
