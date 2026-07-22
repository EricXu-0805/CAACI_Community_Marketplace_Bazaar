import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const migrationUrl = new URL(
  '../supabase/migrations/20260722033904_reconcile_legacy_migration_versions.sql',
  import.meta.url,
)
const precheckUrl = new URL(
  '../supabase/_ops/PRECHECK_20260722033904_reconcile_legacy_migration_versions.sql',
  import.meta.url,
)
const verifyUrl = new URL(
  '../supabase/_ops/VERIFY_20260722033904_reconcile_legacy_migration_versions.sql',
  import.meta.url,
)
const runbookUrl = new URL('../RUNBOOK.md', import.meta.url)
const operationsUrl = new URL('../supabase/_ops/README.md', import.meta.url)

const [migration, precheck, verify, runbook, operations] = await Promise.all([
  readFile(migrationUrl, 'utf8'),
  readFile(precheckUrl, 'utf8'),
  readFile(verifyUrl, 'utf8'),
  readFile(runbookUrl, 'utf8'),
  readFile(operationsUrl, 'utf8'),
])

test('legacy Plaza pairs are validated, migrated, and proved before destructive cleanup', () => {
  assert.match(migration, /LOCK TABLE public\.post_items IN SHARE ROW EXCLUSIVE MODE/)
  assert.match(migration, /constraint_row\.conkey::smallint\[\]/)
  assert.match(migration, /constraint_row\.confdeltype = 'c'/)
  assert.match(migration, /attribute\.attname = 'display_order'[\s\S]*?'pg_catalog\.int4'::pg_catalog\.regtype[\s\S]*?attribute\.attnotnull/)
  assert.match(migration, /trigger_row\.tgtype = 7/)
  assert.match(migration, /post_items_display_order_check[\s\S]*?CHECK \(display_order >= 0\) NOT VALID/)
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.enforce_post_items_cap\(\)[\s\S]*?WHERE post\.id = NEW\.post_id[\s\S]*?FOR UPDATE[\s\S]*?current_count >= 3/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.enforce_post_items_cap\(\)[\s\S]*?PUBLIC, anon, authenticated, service_role/)
  assert.match(migration, /item\.user_id IS DISTINCT FROM post\.user_id/)
  assert.match(migration, /INSERT INTO public\.post_items \(post_id, item_id, display_order\)/)
  assert.match(migration, /NOT EXISTS \([\s\S]*?post_item\.post_id = post\.id[\s\S]*?post_item\.item_id = post\.attached_item_id/)
  assert.match(migration, /inserted_count IS DISTINCT FROM missing_before_count/)
  assert.match(migration, /legacy attachment equivalence proof failed/)
  assert.match(migration, /post_items already exceeds cap/)
  assert.match(migration, /legacy attachment display_order would overflow/)
  assert.doesNotMatch(migration, /ON CONFLICT[\s\S]*?DO NOTHING/)

  const validate = migration.indexOf('invalid_owner_or_fk_count')
  const insert = migration.indexOf('INSERT INTO public.post_items')
  const proof = migration.indexOf('missing_after_count <> 0')
  const drop = migration.indexOf('ALTER TABLE public.posts DROP COLUMN IF EXISTS attached_item_id')
  assert.ok(validate >= 0 && validate < insert && insert < proof && proof < drop)
})

test('legacy collision companions expose read-only data, size, cap, and postcondition gates', () => {
  for (const source of [precheck, verify]) {
    assert.match(source, /^\\set ON_ERROR_STOP on$/m)
    assert.match(source, /^SET TRANSACTION READ ONLY;$/m)
    assert.equal(source.trimEnd().endsWith('ROLLBACK;'), true)
    assert.match(source, /pg_total_relation_size/)
    assert.doesNotMatch(source, /GROUP BY true/i)
  }
  assert.match(precheck, /image_dimensions NULL rows/)
  assert.match(precheck, /invalid items\.title_i18n rows/)
  assert.match(precheck, /legacy missing-item\/cross-owner rows/)
  assert.match(precheck, /legacy pairs would violate cap/)
  assert.match(precheck, /legacy pairs would overflow display_order/)
  assert.match(precheck, /trigger_row\.tgtype = 7/)
  assert.match(precheck, /has_table_privilege\(current_user, items_oid, 'SELECT'\)/)
  assert.match(precheck, /has_table_privilege\(current_user, items_oid, 'UPDATE'\)/)
  assert.doesNotMatch(precheck, /has_table_privilege\([^\n]*'[^']*,[^']*'\)/)
  assert.match(precheck, /migration object ownership missing/)
  assert.match(precheck, /pg_has_role\(current_user, relation\.relowner, 'USAGE'\)/)
  assert.match(precheck, /migration ledger already contains 20260722033904/)

  assert.match(verify, /canonical 014\/015 column contract missing/)
  assert.match(verify, /obsolete legacy attachment object remains/)
  assert.match(verify, /serialized post_items cap contract drifted/)
  assert.match(verify, /exact post_items PK\/FK\/display contract missing/)
  assert.match(verify, /post_items_display_order_check/)
  assert.match(verify, /routine\.proconfig = ARRAY\['search_path=pg_catalog'\]::text\[\]/)
  assert.match(verify, /pg_catalog\.strpos\(routine\.prosrc, 'FOR UPDATE'\) > 0/)
  assert.match(verify, /migration ledger lacks 20260722033904/)
  assert.match(runbook, /PRECHECK_20260722033904_reconcile_legacy_migration_versions\.sql/)
  assert.match(runbook, /VERIFY_20260722033904_reconcile_legacy_migration_versions\.sql/)
  assert.match(operations, /missing-item, cross-owner, or cap conflict/)
})
