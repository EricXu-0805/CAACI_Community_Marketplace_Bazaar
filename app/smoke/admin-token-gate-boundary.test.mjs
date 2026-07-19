import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const adminPage = readFileSync(resolve(appRoot, 'src/pages/admin/index.vue'), 'utf8')

test('admin gate rejects malformed tokens before issuing a request', () => {
  assert.match(adminPage, /const ADMIN_TOKEN_PATTERN = \/\^iam_admin_\[A-Za-z0-9_-\]\{43\}\$\//)
  assert.match(adminPage, /const adminTokenFormatValid = computed\(\(\) => ADMIN_TOKEN_PATTERN\.test\(keyInput\.value\.trim\(\)\)\)/)
  assert.match(adminPage, /:aria-disabled="!adminTokenFormatValid \|\| checking \? 'true' : 'false'"/)
  assert.match(adminPage, /const candidate = keyInput\.value\.trim\(\)\s+if \(!ADMIN_TOKEN_PATTERN\.test\(candidate\)\) \{\s+gateError\.value = t\('admin\.errWrongKey'\)\s+return/)
  assert.ok(
    adminPage.indexOf('if (!ADMIN_TOKEN_PATTERN.test(candidate))') < adminPage.indexOf('adminKey.value = candidate'),
    'format validation must happen before the token can reach apiGet',
  )
})

test('admin gate supports both H5 Enter and mini-program confirm without duplicate requests', () => {
  assert.match(adminPage, /@confirm="onUnlock"/)
  assert.match(adminPage, /@keyup\.enter\.stop\.prevent="onUnlock"/)
  assert.match(adminPage, /async function onUnlock\(\) \{\s+if \(checking\.value\) return/)
  assert.ok(
    adminPage.indexOf('if (checking.value) return') < adminPage.indexOf('checking.value = true'),
    'the synchronous busy guard must run before a request starts',
  )
})

test('switching locale clears a previously translated gate error', () => {
  assert.match(adminPage, /watch\(lang, \(\) => \{\s+gateError\.value = ''\s+\}\)/)
})
