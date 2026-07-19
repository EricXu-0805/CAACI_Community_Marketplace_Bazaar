import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const migrationUrl = new URL(
  '../supabase/migrations/20260719010000_admin_token_lifecycle_rpc.sql',
  import.meta.url,
)
const forwardMigrationUrl = new URL(
  '../supabase/migrations/20260719020000_admin_owner_recovery_concurrency.sql',
  import.meta.url,
)
const precheckUrl = new URL(
  '../supabase/_ops/PRECHECK_20260719_admin_token_lifecycle_rpc.sql',
  import.meta.url,
)
const verifyUrl = new URL(
  '../supabase/_ops/VERIFY_20260719_admin_token_lifecycle_rpc.sql',
  import.meta.url,
)
const regressionUrl = new URL(
  '../supabase/_ops/REGRESSION_20260719_admin_token_lifecycle_rpc.sql',
  import.meta.url,
)

test('token issue is owner-only while security administrators retain revocation', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  assert.match(migration, /\('owner', 'issue_token'\)/)
  assert.match(migration, /\('owner', 'revoke_admin_tokens'\)/)
  assert.match(migration, /\('security_admin', 'revoke_admin_tokens'\)/)
  assert.doesNotMatch(migration, /\('security_admin', 'issue_token'\)/)
  assert.match(migration, /PERFORM public\.admin_assert_mutation_capability\(actor_token_id, p_action\)/)
})

test('issue accepts only a hash, derives identity, and returns no credential material', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const issueStart = migration.indexOf("IF p_action = 'issue_token'")
  const revokeStart = migration.indexOf("ELSIF p_action = 'revoke_token'")
  assert.ok(issueStart >= 0 && revokeStart > issueStart)
  const issue = migration.slice(issueStart, revokeStart)

  assert.match(issue, /token_hash_value !~ '\^\[0-9a-f\]\{64\}\$'/)
  assert.match(issue, /FROM public\.profiles AS profile/)
  assert.match(issue, /profile\.nickname/)
  assert.match(issue, /profile\.email/)
  assert.match(issue, /created_by/)
  assert.match(issue, /'token_issued'/)
  assert.match(issue, /'case_id'/)
  assert.match(issue, /'approval_ref'/)
  assert.match(
    issue,
    /target_role = 'owner'[^]*target_expires_at[^]*clock_timestamp\(\) \+ interval '24 hours'/,
  )

  const result = issue.slice(issue.lastIndexOf('result_value :='))
  assert.doesNotMatch(result, /token_hash/)
  assert.doesNotMatch(result, /admin_email|admin_name/)
})

test('lifecycle uses the shared lock, actor ledger, required audit, and private helpers', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const lock = migration.indexOf('pg_advisory_xact_lock(20260718180000')
  const actorRow = migration.indexOf('FOR UPDATE;', lock)
  const capability = migration.indexOf('admin_assert_mutation_capability', actorRow)
  const ledger = migration.indexOf('INSERT INTO public.admin_mutation_requests', capability)

  assert.ok(lock >= 0 && actorRow > lock && capability > actorRow && ledger > capability)
  assert.match(migration, /admin_audit_required_missing/)
  assert.match(migration, /idempotency_conflict/)
  assert.match(migration, /idempotency_incomplete/)
  assert.match(migration, /admin_lifecycle_evidence_valid/)
  assert.match(migration, /U&'\\202E'/)
  assert.match(migration, /U&'\\2069'/)
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.admin_execute_token_lifecycle[^]*?FROM PUBLIC, anon, authenticated, service_role/,
  )
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.admin_execute_mutation_pre_token_lifecycle[^]*?FROM PUBLIC, anon, authenticated, service_role/,
  )
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.admin_execute_mutation[^]*?TO service_role/,
  )
})

test('profile deletion retains revoked redacted evidence and cannot bypass recovery', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  assert.match(migration, /ON DELETE SET NULL/)
  assert.match(migration, /ALTER TABLE public\.admin_banner_uploads[^]*?ALTER COLUMN actor_id DROP NOT NULL/)
  assert.match(migration, /admin_banner_uploads_actor_id_profiles_fkey_v2/)
  assert.match(migration, /CHECK \(admin_id IS NOT NULL OR revoked_at IS NOT NULL\)/)
  const profileDeleteLockStart = migration.indexOf(
    'CREATE FUNCTION public.admin_lock_profile_deletion_recovery()',
  )
  const profileDeleteTrigger = migration.indexOf(
    'CREATE TRIGGER profiles_00_lock_admin_recovery_before_delete',
    profileDeleteLockStart,
  )
  const profileDeleteLock = migration.slice(profileDeleteLockStart, profileDeleteTrigger)
  const lifecycleLock = profileDeleteLock.indexOf(
    'pg_advisory_xact_lock(20260718180000',
  )
  const recoveryLock = profileDeleteLock.indexOf(
    'pg_advisory_xact_lock(20260718190000',
  )
  assert.ok(
    profileDeleteLockStart >= 0
      && profileDeleteTrigger > profileDeleteLockStart
      && lifecycleLock >= 0
      && recoveryLock > lifecycleLock,
  )
  assert.match(
    migration,
    /CREATE TRIGGER profiles_00_lock_admin_recovery_before_delete\s+BEFORE DELETE\s+ON public\.profiles\s+FOR EACH STATEMENT/,
  )
  assert.match(migration, /CREATE TRIGGER admin_tokens_00_detach_profile/)
  assert.match(
    migration,
    /CREATE TRIGGER admin_tokens_protect_recovery\s+BEFORE UPDATE OF admin_id, revoked_at, expires_at, role OR DELETE/,
  )
  assert.match(
    migration,
    /CREATE TRIGGER admin_tokens_00_lock_recovery_mutation\s+BEFORE UPDATE OR DELETE\s+ON public\.admin_tokens\s+FOR EACH STATEMENT/,
  )
  const tokenLockStart = migration.indexOf(
    'CREATE OR REPLACE FUNCTION public.admin_lock_token_recovery_mutation()',
  )
  const tokenLockEnd = migration.indexOf('REVOKE ALL ON FUNCTION', tokenLockStart)
  const tokenLock = migration.slice(tokenLockStart, tokenLockEnd)
  assert.ok(
    tokenLockStart >= 0
      && tokenLock.indexOf('pg_advisory_xact_lock(20260718180000') >= 0
      && tokenLock.indexOf('pg_advisory_xact_lock(20260718190000')
        > tokenLock.indexOf('pg_advisory_xact_lock(20260718180000'),
  )
  assert.match(migration, /NEW\.revoked_at := COALESCE/)
  assert.match(migration, /NEW\.admin_name := '\[detached\]'/)
  assert.match(migration, /NEW\.admin_email := 'detached@invalid\.local'/)
  assert.match(migration, /IF OLD\.revoked_at IS NULL THEN/)
  assert.match(migration, /INSERT INTO public\.admin_audit_log/)
  assert.match(migration, /'profile_deleted'/)
  assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE public\.admin_tokens FROM service_role/)
  assert.match(migration, /REVOKE SELECT \([^]*token_hash[^]*ON TABLE public\.admin_tokens FROM service_role/)
  assert.match(
    migration,
    /admin_owner_token_recoverable[^]*clock_timestamp\(\) \+ interval '24 hours'[^]*p_last_used_at IS NOT NULL/,
  )
})

test('account deletion preparation atomically tombstones, revokes and audits under ordered locks', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const prepareStart = migration.indexOf(
    'CREATE FUNCTION public.admin_prepare_account_deletion',
  )
  const prepareEnd = migration.indexOf(
    'REVOKE ALL ON FUNCTION public.admin_prepare_account_deletion',
    prepareStart,
  )
  assert.ok(prepareStart >= 0 && prepareEnd > prepareStart)
  const prepare = migration.slice(prepareStart, prepareEnd)

  const lifecycleLock = prepare.indexOf('pg_advisory_xact_lock(20260718180000')
  const recoveryLock = prepare.indexOf('pg_advisory_xact_lock(20260718190000')
  const rowLock = prepare.indexOf('FOR UPDATE;', recoveryLock)
  const profileSnapshot = prepare.indexOf('profile_exists := FOUND', rowLock)
  const corruptTokenGuard = prepare.indexOf(
    'admin_active_token_profile_missing',
    profileSnapshot,
  )
  const readiness = prepare.indexOf('IF target_active_token_count > 0', rowLock)
  const authIdentity = prepare.indexOf('FROM auth.users AS auth_user', readiness)
  const tombstone = prepare.indexOf('INSERT INTO public.account_deletion_jobs', readiness)
  const revoke = prepare.indexOf('WITH revoked AS', tombstone)
  const audit = prepare.indexOf('INSERT INTO public.admin_audit_log', revoke)
  assert.ok(
    lifecycleLock >= 0
      && recoveryLock > lifecycleLock
      && rowLock > recoveryLock
      && profileSnapshot > rowLock
      && corruptTokenGuard > profileSnapshot
      && readiness > corruptTokenGuard
      && authIdentity > readiness
      && tombstone > authIdentity
      && revoke > tombstone
      && audit > revoke,
  )
  assert.match(prepare, /profile\.wechat_openid/)
  assert.match(prepare, /account_auth_user_not_found/)
  assert.doesNotMatch(prepare, /account_profile_not_found/)
  assert.match(prepare, /admin_recovery_transfer_required/)
  assert.match(prepare, /admin_owner_token_recoverable/)
  assert.match(prepare, /token\.last_used_at/)
  assert.match(prepare, /owner_profile\.id = token\.admin_id/)
  assert.match(prepare, /remaining_recoverable_owner_token_count/)
  assert.match(prepare, /'account_deletion_prepared'/)
  assert.match(prepare, /pg_catalog\.to_jsonb\(job_row\)/)
  assert.match(migration, /REVOKE INSERT ON TABLE public\.account_deletion_jobs FROM service_role/)
  assert.match(
    migration,
    /GRANT INSERT \(id, nickname, avatar_url, bio, location, status_text, status_emoji\)\s+ON TABLE public\.profiles TO authenticated/,
  )
  assert.match(migration, /admin_account_deletion_in_progress/)
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.admin_prepare_account_deletion\(uuid\)[^]*TO service_role/,
  )
})

test('lost-response token reconciliation is service-only and returns no secret or PII', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const start = migration.indexOf(
    'CREATE FUNCTION public.admin_reconcile_issued_token',
  )
  const end = migration.indexOf(
    'REVOKE ALL ON FUNCTION public.admin_reconcile_issued_token',
    start,
  )
  assert.ok(start >= 0 && end > start)
  const reconcile = migration.slice(start, end)

  assert.match(
    reconcile,
    /RETURNS TABLE \(\s*id uuid,\s*admin_id uuid,\s*role text,\s*expires_at timestamptz,\s*revoked_at timestamptz\s*\)/,
  )
  assert.match(reconcile, /SECURITY DEFINER/)
  assert.match(reconcile, /SET search_path = pg_catalog/)
  assert.match(reconcile, /p_token_hash !~ '\^\[0-9a-f\]\{64\}\$'/)
  assert.match(reconcile, /token\.token_hash = p_token_hash/)
  assert.doesNotMatch(reconcile, /token\.admin_name|token\.admin_email|token\.created_by/)
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.admin_reconcile_issued_token\(text\)[^]*?FROM PUBLIC, anon, authenticated, service_role[^]*?GRANT EXECUTE ON FUNCTION public\.admin_reconcile_issued_token\(text\)[^]*?TO service_role/,
  )
})

test('old-token idempotency reconciliation is owner-only, opaque, fenced, and deadlock ordered', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  assert.match(
    migration,
    /CREATE TABLE public\.admin_idempotency_reconciliation_fences \(\s*idempotency_key uuid PRIMARY KEY,\s*reconciled_by uuid NOT NULL[^]*reconciled_at timestamptz NOT NULL DEFAULT pg_catalog\.now\(\)\s*\)/,
  )
  assert.match(migration, /CREATE INDEX admin_mutation_requests_idempotency_key_idx\s+ON public\.admin_mutation_requests \(idempotency_key\)/)
  assert.match(migration, /CREATE INDEX admin_banner_uploads_idempotency_key_idx\s+ON public\.admin_banner_uploads \(idempotency_key\)/)
  assert.match(
    migration,
    /CREATE TRIGGER admin_mutation_requests_01_reject_fenced_idempotency_key\s+BEFORE INSERT OR UPDATE OF idempotency_key/,
  )
  assert.match(
    migration,
    /CREATE TRIGGER admin_banner_uploads_01_reject_fenced_idempotency_key\s+BEFORE INSERT OR UPDATE OF idempotency_key/,
  )
  assert.match(migration, /MESSAGE = 'admin_idempotency_reconciled'/)

  for (const functionName of [
    'admin_prepare_banner_upload',
    'admin_complete_banner_upload',
  ]) {
    const start = migration.indexOf(`CREATE FUNCTION public.${functionName}`)
    const end = migration.indexOf('REVOKE ALL ON FUNCTION', start)
    assert.ok(start >= 0 && end > start)
    const wrapper = migration.slice(start, end)
    const lifecycleLock = wrapper.indexOf('pg_advisory_xact_lock(20260718180000')
    const fenceLock = wrapper.indexOf('pg_advisory_xact_lock(20260718200000')
    const legacyCall = wrapper.indexOf(`${functionName}_pre_idempotency_fence`)
    assert.ok(lifecycleLock >= 0 && fenceLock > lifecycleLock && legacyCall > fenceLock)
  }

  const start = migration.indexOf(
    'CREATE FUNCTION public.admin_reconcile_idempotency_outcome',
  )
  const end = migration.indexOf(
    'REVOKE ALL ON FUNCTION public.admin_reconcile_idempotency_outcome',
    start,
  )
  assert.ok(start >= 0 && end > start)
  const reconcile = migration.slice(start, end)
  const lifecycleLock = reconcile.indexOf('pg_advisory_xact_lock(20260718180000')
  const fenceLock = reconcile.indexOf('pg_advisory_xact_lock(20260718200000')
  const evidence = reconcile.indexOf('WITH evidence AS', fenceLock)
  const claim = reconcile.indexOf(
    'INSERT INTO public.admin_idempotency_reconciliation_fences',
    evidence,
  )
  assert.ok(lifecycleLock >= 0 && fenceLock > lifecycleLock && evidence > fenceLock && claim > evidence)
  assert.match(reconcile, /RETURNS jsonb/)
  assert.match(reconcile, /token\.role = 'owner'/)
  assert.match(reconcile, /owner_profile\.id = token\.admin_id/)
  assert.match(reconcile, /FROM public\.admin_mutation_requests/)
  assert.match(reconcile, /FROM public\.admin_banner_uploads/)
  assert.match(reconcile, /'status', 'completed'/)
  assert.match(reconcile, /'status', 'running'/)
  assert.match(reconcile, /'status', 'not_dispatched'/)
  assert.match(reconcile, /admin_idempotency_reconcile_collision/)
  assert.match(reconcile, /admin_idempotency_reconcile_uncertain/)
  assert.match(reconcile, /admin_idempotency_reconcile_fence_conflict/)
  assert.doesNotMatch(reconcile, /admin_name|admin_email|FOR UPDATE/)
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.admin_reconcile_idempotency_outcome\(text, uuid\)[^]*?FROM PUBLIC, anon, authenticated, service_role[^]*?GRANT EXECUTE ON FUNCTION public\.admin_reconcile_idempotency_outcome\(text, uuid\)[^]*?TO service_role/,
  )
})

test('ops cover inactive actors, owner-only issue, replay, atomic account deletion and detach', async () => {
  const [precheck, verify, regression] = await Promise.all([
    readFile(precheckUrl, 'utf8'),
    readFile(verifyUrl, 'utf8'),
    readFile(regressionUrl, 'utf8'),
  ])
  assert.match(precheck, /partial\/previous token lifecycle migration exists/)
  assert.match(verify, /security_admin can issue persistent credentials/)
  assert.match(verify, /raw admin token table privilege remains/)
  assert.match(verify, /atomic account deletion prepare\/order\/audit contract missing/)
  assert.match(regression, /security_admin issue was accepted/)
  assert.match(regression, /revoked actor token was accepted/)
  assert.match(regression, /expired actor token was accepted/)
  assert.match(regression, /cached-email variants/)
  assert.match(regression, /different-key duplicate batch revoke was accepted/)
  assert.match(regression, /same-key different payload hash was accepted/)
  assert.match(
    regression,
    /pg_catalog\.sha256\(\s*pg_catalog\.convert_to\(fixed_issue\.payload::text, 'UTF8'\)\s*\)/,
  )
  assert.doesNotMatch(regression, /public\.digest\(/)
  assert.match(regression, /exact revoke without case\/approval evidence was accepted/)
  assert.match(regression, /bidi-controlled lifecycle evidence was accepted/)
  assert.match(regression, /last owner profile deletion was accepted/)
  assert.match(regression, /last active admin account deletion was accepted/)
  assert.match(regression, /active admin token with missing profile was accepted/)
  assert.match(regression, /corrupted missing-profile token authenticated/)
  assert.match(regression, /valid Auth identity without profile did not get a null-WeChat deletion job/)
  assert.match(regression, /nonexistent Auth identity received a deletion job/)
  assert.match(regression, /exact own-profile recovery INSERT ACL\/RLS behavior drifted/)
  assert.match(regression, /service_role raw token SELECT was accepted/)
  assert.match(regression, /service_role raw deletion-job INSERT was accepted/)
  assert.match(regression, /last-owner refusal left a job\/audit side effect/)
  assert.match(regression, /existing-job token revoke\/replay\/audit drifted/)
  assert.match(regression, /token issue after deletion tombstone was accepted/)
  assert.match(regression, /prepared token emitted a duplicate profile-delete revoke audit/)
  assert.match(regression, /direct profile deletion revoke\/redaction\/audit missing/)
  assert.match(regression, /prepared\/available\/attached banner saga evidence/)
  assert.match(regression, /service_role token reconciliation exposed the wrong projection/)
  assert.match(regression, /missing token hash reconciliation returned a row/)
  assert.match(regression, /invalid token hash reconciliation was accepted/)
  assert.match(regression, /detached token reconciliation did not retain safe lifecycle metadata/)
  assert.match(regression, /cross-token completed mutation reconciliation drifted/)
  assert.match(regression, /same UUID across historical tokens was accepted/)
  assert.match(regression, /same UUID across mutation\/banner ledgers was accepted/)
  assert.match(regression, /zero-evidence authoritative fence result drifted/)
  assert.match(regression, /fence accepted a late mutation ledger INSERT/)
  assert.match(regression, /fence accepted a late banner ledger INSERT/)
  assert.match(regression, /mutation idempotency UPDATE bypassed reconciliation fence/)
  assert.match(regression, /banner idempotency UPDATE bypassed reconciliation fence/)
  assert.match(regression, /available\/attached\/gc_pending\/deleted banner reconciliation matrix drifted/)
  assert.match(regression, /authoritative fence was not retained after reconciler profile detachment/)
  assert.match(regression, /fresh owner replacement allowed lifecycle revoke/)
  assert.match(regression, /fresh owner replacement allowed direct table revoke/)
  assert.match(regression, /fresh owner replacement allowed account deletion/)
  assert.match(regression, /first successful owner authorization did not publish verification signal/)
  assert.match(regression, /verified owner replacement did not allow lifecycle revoke/)
  assert.match(regression, /verified owner replacement did not allow account deletion/)
  assert.match(regression, /owner issue below 24 hours was accepted/)
  assert.match(regression, /verified owner below 24 hours allowed lifecycle revoke/)
  assert.match(regression, /verified owner below 24 hours allowed direct table revoke/)
  assert.match(regression, /verified owner below 24 hours allowed account deletion/)
  assert.match(regression, /batch revoked the only two verified owner tokens/)
  assert.match(regression, /authenticated idempotency reconciliation was accepted/)
  assert.match(verify, /authoritative idempotency fence trigger topology/)
  assert.match(verify, /banner upload token\/fence deadlock order not repaired/)
  assert.match(verify, /opaque owner idempotency reconciliation\/fence contract/)
  assert.match(precheck, /partial idempotency reconciliation fence exists/)
  assert.match(precheck, /cross_ledger_collisions/)
  assert.match(verify, /token reconciliation signature\/projection shape/)
  assert.match(verify, /exact non-secret token reconciliation contract/)
  assert.match(verify, /retained banner upload actor FK boundary missing/)
  assert.match(verify, /profile deletion advisory lock order drifted/)
  assert.match(verify, /exact authenticated profile recovery INSERT ACL drifted/)
  assert.match(verify, /authorization verification\/profile\/lock order drifted/)
  assert.match(verify, /verified\/live-profile owner recovery guards drifted/)
  assert.match(verify, /statement-level token lock-order fence/)
  assert.match(verify, /owner 24-hour issue\/set-wise batch recovery boundary drifted/)
  assert.match(precheck, /verified_recoverable_owner_tokens/)
  assert.match(precheck, /banner upload actor FK predecessor shape drifted/)
  assert.match(precheck, /advanced account deletion jobs require reconciliation/)
})

test('forward tail repairs already-recorded lifecycle schemas without weakening recovery', async () => {
  const migration = await readFile(forwardMigrationUrl, 'utf8')
  const lifecycleLock = migration.indexOf(
    'pg_advisory_xact_lock(20260718180000',
  )
  const recoveryLock = migration.indexOf(
    'pg_advisory_xact_lock(20260718190000',
  )
  const tableLock = migration.indexOf(
    'LOCK TABLE public.admin_tokens IN SHARE ROW EXCLUSIVE MODE',
  )

  assert.ok(
    lifecycleLock >= 0
      && recoveryLock > lifecycleLock
      && tableLock > recoveryLock,
  )
  assert.match(
    migration,
    /admin_owner_token_recoverable[^]*clock_timestamp\(\) \+ interval '24 hours'[^]*p_last_used_at IS NOT NULL/,
  )
  assert.match(
    migration,
    /target_owner\.id = ANY\(target_token_ids\)[^]*NOT \(remaining_owner\.id = ANY\(target_token_ids\)\)/,
  )
  assert.match(
    migration,
    /CREATE TRIGGER admin_tokens_00_lock_recovery_mutation\s+BEFORE UPDATE OR DELETE\s+ON public\.admin_tokens\s+FOR EACH STATEMENT/,
  )
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.admin_execute_token_lifecycle[^]*FROM PUBLIC, anon, authenticated, service_role/,
  )
})
