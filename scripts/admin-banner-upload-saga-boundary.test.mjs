import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationUrl = new URL(
  '../supabase/migrations/20260718200000_recoverable_banner_uploads.sql',
  import.meta.url,
)
const precheckUrl = new URL(
  '../supabase/_ops/PRECHECK_20260718_recoverable_banner_uploads.sql',
  import.meta.url,
)
const verifyUrl = new URL(
  '../supabase/_ops/VERIFY_20260718_recoverable_banner_uploads.sql',
  import.meta.url,
)
const regressionUrl = new URL(
  '../supabase/_ops/REGRESSION_20260718_recoverable_banner_uploads.sql',
  import.meta.url,
)
const apiUrl = new URL('../api/admin/index.js', import.meta.url)
const uiUrl = new URL('../app/src/pages/admin/index.vue', import.meta.url)
const gcUrl = new URL('../api/banner-upload-gc.js', import.meta.url)

test('saga schema fixes one object per token/key/file and keeps direct access closed', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  assert.match(migration, /UNIQUE \(admin_token_id, idempotency_key\)/)
  assert.match(migration, /content_hash ~ '\^\[0-9a-f\]\{64\}\$'/)
  assert.match(migration, /mime_type IN \('image\/png', 'image\/jpeg', 'image\/webp'\)/)
  assert.doesNotMatch(migration, /image\/gif|webp\|gif/)
  assert.match(migration, /'managed\/' \|\| token_id::text \|\| '\/' \|\| p_idempotency_key::text/)
  assert.match(migration, /status IN \('prepared', 'available', 'attached', 'gc_pending', 'deleted'\)/)
  assert.match(migration, /ALTER TABLE public\.admin_banner_uploads ENABLE ROW LEVEL SECURITY/)
  assert.match(migration, /REVOKE ALL ON TABLE public\.admin_banner_uploads[\s\S]*service_role/)
  assert.doesNotMatch(migration, /GRANT (?:SELECT|INSERT|UPDATE|DELETE)[\s\S]*admin_banner_uploads/i)
})

test('prepare and complete enforce mutation-time owner capability and required audit', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const prepare = migration.slice(
    migration.indexOf('CREATE FUNCTION public.admin_prepare_banner_upload'),
    migration.indexOf('CREATE FUNCTION public.admin_complete_banner_upload'),
  )
  const complete = migration.slice(
    migration.indexOf('CREATE FUNCTION public.admin_complete_banner_upload'),
    migration.indexOf('CREATE FUNCTION public.admin_reconcile_banner_upload_reference'),
  )
  for (const source of [prepare, complete]) {
    assert.match(source, /revoked_at IS NULL/)
    assert.match(source, /expires_at > pg_catalog\.now\(\)/)
    assert.match(source, /FOR UPDATE/)
    assert.match(source, /admin_assert_mutation_capability\(token_id, 'upload_banner'\)/)
  }
  assert.match(complete, /set_config\('admin\.audit_required', 'on', true\)/)
  assert.match(complete, /public\.record_audit\([\s\S]*?'banner_changed'/)
  assert.match(complete, /'op', 'image_uploaded'/)
  assert.match(complete, /'admin_role', token_role/)
})

test('attachment and leased GC protect referenced objects and recover abandoned work', async () => {
  const [migration, gc] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(gcUrl, 'utf8'),
  ])
  assert.match(migration, /CREATE TRIGGER banners_require_managed_upload/)
  assert.match(migration, /CREATE FUNCTION public\.admin_validate_banner_managed_upload/)
  assert.match(migration, /NEW\.image_url IS NOT DISTINCT FROM OLD\.image_url/)
  assert.match(migration, /upload\.completed_at IS NOT NULL/)
  assert.match(migration, /upload\.status <> 'deleted'/)
  assert.match(migration, /MESSAGE = 'admin_upload_required'/)
  assert.match(migration, /CREATE TRIGGER banners_reconcile_managed_upload/)
  assert.match(migration, /MESSAGE = 'admin_upload_gc_in_progress'/)
  assert.match(migration, /FOR UPDATE OF upload SKIP LOCKED/)
  assert.match(migration, /gc_claim_expires_at = pg_catalog\.now\(\) \+ interval '15 minutes'/)
  assert.match(migration, /NOT EXISTS \([\s\S]*?FROM public\.banners/)
  assert.match(gc, /\/storage\/v1\/object\/banners/)
  assert.match(gc, /body: JSON\.stringify\(\{ prefixes: names \}\)/)
  assert.match(gc, /admin_complete_banner_upload_gc/)
  assert.match(gc, /MAX_GC_BATCHES = 3/)
})

test('edge and UI retry the same key/path across lost responses', async () => {
  const [api, ui] = await Promise.all([readFile(apiUrl, 'utf8'), readFile(uiUrl, 'utf8')])
  const uploadHandler = api.slice(
    api.indexOf('async function handleBannerUpload'),
    api.indexOf('async function handlePost'),
  )
  assert.match(uploadHandler, /request\.headers\.get\('idempotency-key'\)/)
  assert.match(uploadHandler, /admin_prepare_banner_upload/)
  assert.match(uploadHandler, /prepared\.object_name/)
  assert.match(uploadHandler, /expectedObjectSuffix/)
  assert.match(uploadHandler, /\.endsWith\(expectedObjectSuffix\)/)
  assert.match(uploadHandler, /'x-upsert': 'true'/)
  assert.match(uploadHandler, /admin_complete_banner_upload/)
  assert.doesNotMatch(uploadHandler, /crypto\.randomUUID\(\)/)

  const clientUpload = ui.slice(
    ui.indexOf('async function uploadBannerFile'),
    ui.indexOf('\nasync function loadPlaza'),
  )
  assert.match(clientUpload, /reserveAdminIdempotencyKey\(\s*'banner-upload',\s*request\.key,\s*await file\.arrayBuffer\(\)/)
  assert.match(clientUpload, /releaseAdminIdempotencyKey\(journalHandle\)/)
  assert.match(clientUpload, /'Idempotency-Key': idempotencyKey/)
  assert.match(clientUpload, /attempt < 2/)
  assert.match(ui, /original_image_url: b\.image_url/)
  assert.match(ui, /f\.image_url !== f\.original_image_url/)
})

test('ops prove denial rollback, replay, audit rollback, attach/detach, and terminal GC', async () => {
  const [precheck, verify, regression] = await Promise.all([
    readFile(precheckUrl, 'utf8'),
    readFile(verifyUrl, 'utf8'),
    readFile(regressionUrl, 'utf8'),
  ])
  assert.match(precheck, /SET TRANSACTION READ ONLY/)
  assert.match(precheck, /owner'[\s\S]*upload_banner/)
  assert.match(verify, /admin\.audit_required/)
  assert.match(verify, /SKIP LOCKED/)
  for (const marker of [
    'operator_denied',
    'prepare_replay',
    'prepare_conflict',
    'required_audit_once',
    'legacy_change_and_unmanaged_insert_denied',
    'incomplete_upload_cannot_attach',
    'claim_blocks_reattach',
    'complete_gc',
    'deleted_upload_cannot_attach',
    'audit_failure_rollback',
    'revoked_before_complete',
  ]) {
    assert.match(regression, new RegExp(marker))
  }
  assert.match(regression, /ROLLBACK;\s*$/)
})

test('every selected PL/pgSQL or DO body closes with an explicit END semicolon', async () => {
  const sources = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(precheckUrl, 'utf8'),
    readFile(verifyUrl, 'utf8'),
    readFile(regressionUrl, 'utf8'),
  ])
  for (const source of sources) {
    const taggedBodies = [...source.matchAll(/\$([a-z_]+)\$([\s\S]*?)\$\1\$;/g)]
    assert.ok(taggedBodies.length > 0)
    for (const [, , body] of taggedBodies) {
      assert.match(body.trim(), /END;$/)
    }
  }
})
