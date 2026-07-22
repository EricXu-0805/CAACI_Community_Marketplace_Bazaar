import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const ROOT = new URL('./', import.meta.url)
const ADMIN_BEARER_SCRIPTS = [
  'admin-token-mint.mjs',
  'admin-token-revoke.mjs',
]
const DATABASE_MAINTENANCE_SCRIPTS = [
  'backfill-image-dimensions.mjs',
  'retire-wechat-passwords.mjs',
]

test('admin credential lifecycle scripts cannot bypass the audited bearer API', async () => {
  for (const file of ADMIN_BEARER_SCRIPTS) {
    const source = await readFile(new URL(file, ROOT), 'utf8')
    assert.match(source, /ADMIN_TOKEN/, `${file} lacks the per-administrator bearer boundary`)
    assert.doesNotMatch(source, /SUPABASE_SECRET_KEY/, `${file} regained direct secret-key access`)
    assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY/, `${file} regained direct service-role access`)
  }
})

test('database maintenance scripts prefer named secret keys and keep legacy fallback explicit', async () => {
  for (const file of DATABASE_MAINTENANCE_SCRIPTS) {
    const source = await readFile(new URL(file, ROOT), 'utf8')
    assert.match(source, /SUPABASE_SECRET_KEY/, `${file} lacks named secret-key support`)
    assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/, `${file} lost the rolling legacy fallback`)
    assert.ok(
      source.indexOf('SUPABASE_SECRET_KEY') < source.indexOf('SUPABASE_SERVICE_ROLE_KEY'),
      `${file} does not prefer the named secret key`,
    )
    assert.match(
      source,
      /!\/\^sb_secret_\/\.test\(/,
      `${file} does not suppress opaque-key Authorization fallback`,
    )
  }
})
