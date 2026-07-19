import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const migrationUrl = new URL(
  '../supabase/migrations/20260718190000_admin_token_capabilities.sql',
  import.meta.url,
)
const capabilitySqlUrls = [
  migrationUrl,
  new URL('../supabase/_ops/PRECHECK_20260718_admin_token_capabilities.sql', import.meta.url),
  new URL('../supabase/_ops/VERIFY_20260718_admin_token_capabilities.sql', import.meta.url),
  new URL('../supabase/_ops/REGRESSION_20260718_admin_token_capabilities.sql', import.meta.url),
]

const expectedMappings = new Set([
  'operator:apply_ban',
  'operator:lift_suspension',
  'operator:update_report_status',
  'operator:resolve_target_reports',
  'operator:takedown_content',
  'security_admin:revoke_token',
  'owner:apply_ban',
  'owner:lift_suspension',
  'owner:update_report_status',
  'owner:resolve_target_reports',
  'owner:takedown_content',
  'owner:set_post_pinned',
  'owner:upsert_banner',
  'owner:delete_banner',
  'owner:revoke_token',
  'owner:upload_banner',
])

test('administrator role/action mapping is exact and least privileged', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const insert = migration.match(
    /INSERT INTO public\.admin_role_action_capabilities[^]*?VALUES([^]*?);/,
  )
  assert.ok(insert)

  const actual = new Set(
    [...insert[1].matchAll(/\('([^']+)', '([^']+)'\)/g)]
      .map(([, role, action]) => `${role}:${action}`),
  )
  assert.deepEqual(actual, expectedMappings)
})

test('role-aware audit keeps required rollback and redacted fallback logging', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  assert.doesNotMatch(migration, /\bSQLERRM\b/)
  assert.match(migration, /current_setting\('admin\.role'/)
  assert.match(migration, /'admin_role', context_role/)
  assert.match(migration, /admin_audit_required_failed/)
  assert.match(migration, /event_kind=% sqlstate=%/)
})

test('service authorization, inventory, and direct recovery guard stay present', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  assert.match(migration, /FUNCTION public\.admin_token_authorization\(p_token_hash text\)/)
  assert.match(migration, /FUNCTION public\.admin_token_inventory\(\)/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.admin_token_authorization\(text\)[^]*?TO service_role/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.admin_token_inventory\(\)[^]*?TO service_role/)
  assert.match(migration, /CREATE TRIGGER admin_tokens_protect_recovery/)
  assert.match(migration, /last_active_owner_token/)
  assert.match(migration, /last_active_admin_token/)
})

test('every 190000 PL/pgSQL and DO block has an explicit END semicolon', async () => {
  for (const url of capabilitySqlUrls) {
    const sql = await readFile(url, 'utf8')
    assert.doesNotMatch(sql, /\bEND\n\$[^$]+\$;/)
    assert.match(sql, /\bEND;\n\$[^$]+\$;/)
  }
})
