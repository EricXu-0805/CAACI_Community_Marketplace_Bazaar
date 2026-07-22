import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const migrationName = '20260720035037_harden_admin_appeal_decisions_and_session_metadata.sql'
const migrationUrl = new URL(`../supabase/migrations/${migrationName}`, import.meta.url)
const apiUrl = new URL('../api/admin/index.js', import.meta.url)
const precheckUrl = new URL(
  '../supabase/_ops/PRECHECK_20260720035037_harden_admin_appeal_decisions_and_session_metadata.sql',
  import.meta.url,
)
const verifyUrl = new URL(
  '../supabase/_ops/VERIFY_20260720035037_harden_admin_appeal_decisions_and_session_metadata.sql',
  import.meta.url,
)
const regressionUrl = new URL(
  '../supabase/_ops/REGRESSION_20260720035037_harden_admin_appeal_decisions_and_session_metadata.sql',
  import.meta.url,
)
const manifestUrl = new URL('../supabase/migrations/manifest.sha256', import.meta.url)

function functionBody(source, signatureStart, nextMarker) {
  const start = source.indexOf(signatureStart)
  const end = source.indexOf(nextMarker, start + signatureStart.length)
  assert.ok(start >= 0, `missing ${signatureStart}`)
  assert.ok(end > start, `missing boundary after ${signatureStart}`)
  return source.slice(start, end)
}

test('appeal lifecycle migration preserves the atomic bridge and versioned auth contract', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const authV1 = functionBody(
    migration,
    'CREATE OR REPLACE FUNCTION public.admin_token_authorization(p_token_hash text)',
    'CREATE FUNCTION public.admin_token_authorization_v2',
  )
  const authV2 = functionBody(
    migration,
    'CREATE FUNCTION public.admin_token_authorization_v2',
    '-- Literal search:',
  )
  const appeal = functionBody(
    migration,
    'CREATE FUNCTION public.admin_execute_appeal_decision(',
    'CREATE FUNCTION public.admin_execute_mutation(',
  )
  const wrapper = functionBody(
    migration,
    'CREATE FUNCTION public.admin_execute_mutation(',
    'COMMENT ON INDEX',
  )
  const submitLegacy = functionBody(
    migration,
    'CREATE OR REPLACE FUNCTION public.submit_appeal(note_in text)',
    'CREATE OR REPLACE FUNCTION public.submit_appeal(\n  note_in text,',
  )
  const submitIntent = functionBody(
    migration,
    'CREATE OR REPLACE FUNCTION public.submit_appeal(\n  note_in text,',
    '-- Extend only the migration-owned role/action vocabulary.',
  )
  const appealsV1 = functionBody(
    migration,
    'CREATE OR REPLACE FUNCTION public.admin_list_appeals(',
    'CREATE FUNCTION public.admin_list_appeals_v2(',
  )
  const appealsV2 = functionBody(
    migration,
    'CREATE FUNCTION public.admin_list_appeals_v2(',
    'CREATE OR REPLACE FUNCTION public.admin_dashboard_stats()',
  )

  assert.match(authV1, /RETURNS TABLE \(\s*admin_id uuid,[\s\S]*capabilities text\[\]\s*\)/)
  assert.match(authV1, /capability\.action <> 'decide_appeal'/)
  assert.doesNotMatch(authV1, /RETURNS TABLE \([\s\S]*token_id uuid/)
  assert.match(authV2, /token_id uuid[\s\S]*expires_at timestamptz[\s\S]*server_now timestamptz/)
  assert.match(authV2, /capabilities text\[\]/)
  const authV2Return = authV2.slice(0, authV2.indexOf('LANGUAGE'))
  assert.doesNotMatch(authV2Return, /\btoken_hash\b/)

  for (const body of [authV1, authV2, appeal]) {
    const firstLock = body.indexOf('20260718180000')
    const secondLock = body.indexOf('20260718190000')
    const clock = body.indexOf('clock_timestamp()')
    assert.ok(firstLock >= 0 && firstLock < secondLock && secondLock < clock)
  }

  assert.match(wrapper, /IF p_action = 'decide_appeal'/)
  assert.match(wrapper, /admin_execute_mutation_pre_appeal_lifecycle/)
  assert.match(wrapper, /p_action IN \('apply_ban', 'lift_suspension', 'takedown_content'\)/)
  assert.match(wrapper, /admin_moderation_reason_valid/)
  assert.match(migration, /\\0001-\\001F\\007F-\\009F/)
  const firstCutoverLock = migration.indexOf(
    'SELECT pg_catalog.pg_advisory_xact_lock(20260718180000::bigint);',
  )
  const secondCutoverLock = migration.indexOf(
    'SELECT pg_catalog.pg_advisory_xact_lock(20260718190000::bigint);',
  )
  const firstCatalogMutation = migration.indexOf('CREATE FUNCTION public.admin_moderation_reason_valid')
  assert.ok(
    firstCutoverLock >= 0
      && firstCutoverLock < secondCutoverLock
      && secondCutoverLock < firstCatalogMutation,
  )
  assert.match(migration, /suspension\.level DESC,[\s\S]*suspension\.ends_at DESC NULLS FIRST/)
  for (const submit of [submitLegacy, submitIntent]) {
    assert.match(submit, /SET appeal_note = cleaned_note,[\s\S]*appeal_submitted_at = pg_catalog\.clock_timestamp\(\)/)
    assert.match(submit, /suspension\.appeal_note IS NULL[\s\S]*suspension\.appeal_submitted_at IS NULL/)
  }
  assert.doesNotMatch(
    appealsV1.slice(appealsV1.indexOf('RETURNS TABLE'), appealsV1.indexOf('LANGUAGE')),
    /appeal_submitted_at/,
  )
  assert.match(appealsV1, /appeal_submitted_at ASC NULLS FIRST/)
  assert.match(appealsV2, /appeal_submitted_at timestamptz/)
  assert.match(appealsV2, /appeal_submitted_at ASC NULLS FIRST/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.apply_ban_level\([\s\S]*service_role/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.lift_suspension\(uuid, text\)[\s\S]*service_role/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.admin_takedown_content\(text, uuid, text\)[\s\S]*service_role/)
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.notify_suspension_change\(\)/)
  assert.match(migration, /another_restriction_active[\s\S]*suspension\.level >= 2/)
  assert.match(migration, /Another account restriction remains active/)
  assert.match(migration, /OLD\.ends_at > notification_time/)
  assert.match(migration, /DROP TRIGGER IF EXISTS trg_notify_suspension_change/)
  assert.match(migration, /AFTER INSERT OR UPDATE ON public\.suspensions\s+FOR EACH ROW EXECUTE FUNCTION public\.notify_suspension_change\(\)/)
})

test('terminal appeal state is serialized, idempotent, self-review safe and audited once', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const appeal = functionBody(
    migration,
    'CREATE FUNCTION public.admin_execute_appeal_decision(',
    'CREATE FUNCTION public.admin_execute_mutation(',
  )

  assert.match(migration, /CREATE UNIQUE INDEX admin_audit_log_terminal_appeal_suspension_uidx\s+ON public\.admin_audit_log \(target_id\)\s+WHERE event_kind = 'appeal_decided'/)
  assert.match(migration, /appeal_more_information_requested/)
  assert.match(appeal, /FROM public\.admin_tokens[\s\S]*FOR UPDATE/)
  assert.match(appeal, /FROM public\.admin_mutation_requests[\s\S]*FOR UPDATE/)
  assert.match(appeal, /FROM public\.suspensions[\s\S]*FOR UPDATE/)
  assert.match(appeal, /existing_status = 'completed'[\s\S]*RETURN existing_result/)
  assert.match(appeal, /appeal_already_decided/)
  assert.match(appeal, /self_appeal_decision_forbidden/)
  assert.equal((appeal.match(/PERFORM public\.record_audit\(/g) || []).length, 1)
  assert.match(appeal, /decision_value = 'accepted' AND suspension_active/)
  assert.match(appeal, /remains_active := suspension_active AND NOT lifted_now/)
  assert.match(migration, /details - ARRAY\[[\s\S]*'remains_active'[\s\S]*\]::text\[\] = '\{\}'::jsonb/)
  assert.match(migration, /details ->> 'lifted_now'[\s\S]*details ->> 'decision' = 'accepted'/)
  assert.match(migration, /details ->> 'remains_active'[\s\S]*details ->> 'decision' <> 'accepted'/)
  assert.match(
    migration,
    /event_kind_in IN \([\s\S]*'appeal_decided', 'appeal_more_information_requested'[\s\S]*AND NOT audit_required THEN\s+RAISE;/,
  )

  const lift = functionBody(
    migration,
    'CREATE OR REPLACE FUNCTION public.lift_suspension(',
    'CREATE OR REPLACE FUNCTION public.admin_takedown_content(',
  )
  assert.match(lift, /target = admin_actor_id[\s\S]*self_appeal_decision_forbidden/)
})

test('operator audit projection and literal search fail closed before pagination', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const moderationAudit = functionBody(
    migration,
    'CREATE FUNCTION public.admin_list_moderation_audit_log(',
    '-- The legacy RPC becomes safe-by-default',
  )
  const legacyAudit = functionBody(
    migration,
    'CREATE OR REPLACE FUNCTION public.admin_list_audit_log(',
    'CREATE FUNCTION public.admin_list_owner_audit_log(',
  )
  const search = functionBody(
    migration,
    'CREATE OR REPLACE FUNCTION public.admin_search_users(',
    'CREATE OR REPLACE FUNCTION public.admin_list_appeals(',
  )

  assert.doesNotMatch(moderationAudit, /audit\.admin_token_id|audit\.idempotency_key/)
  assert.doesNotMatch(moderationAudit, /token_revoked|token_issued/)
  assert.match(moderationAudit, /WHERE audit\.event_kind IN[\s\S]*LIMIT GREATEST/)
  assert.match(legacyAudit, /admin_list_moderation_audit_log/)
  assert.match(search, /pg_catalog\.chr\(92\)/)
  assert.match(search, /normalized\.escaped_query/)
  assert.match(search, /ESCAPE '\\'/)
  assert.match(search, /pg_catalog\.length\(normalized\.query\) BETWEEN 2 AND 200/)
})

test('Edge API consumes only v2 projections and validates appeal/provider invariants', async () => {
  const api = await readFile(apiUrl, 'utf8')
  assert.match(api, /rpc\/admin_token_authorization_v2/)
  assert.match(api, /'token_id', 'admin_id'[\s\S]*'expires_at', 'server_now', 'capabilities'/)
  assert.match(api, /Date\.parse\(row\.expires_at\) > Date\.parse\(row\.server_now\)/)
  assert.match(api, /admin_list_appeals_v2/)
  assert.match(api, /admin_list_owner_audit_log/)
  assert.match(api, /admin_list_moderation_audit_log/)
  assert.match(api, /payload\.decision !== 'accepted' \|\| data\.remains_active === false/)
  assert.match(api, /payload\.decision === 'accepted' \|\| data\.lifted_now === false/)
  assert.match(api, /UNSAFE_ADMIN_TEXT_PATTERN/)
  assert.match(api, /\\u061c\\u200e\\u200f/)
})

test('appeal lifecycle ships fail-fast ops gates, rollback-only behavior, and a frozen hash', async () => {
  const [migration, precheck, verify, regression, manifest] = await Promise.all([
    readFile(migrationUrl),
    readFile(precheckUrl, 'utf8'),
    readFile(verifyUrl, 'utf8'),
    readFile(regressionUrl, 'utf8'),
    readFile(manifestUrl, 'utf8'),
  ])
  for (const source of [precheck, verify]) {
    assert.match(source, /^\\set ON_ERROR_STOP on$/m)
    assert.match(source, /^SET TRANSACTION READ ONLY;$/m)
    assert.match(source, /^SET LOCAL lock_timeout = '5s';$/m)
    assert.match(source, /^SET LOCAL statement_timeout = '2min';$/m)
    assert.equal(source.trimEnd().endsWith('ROLLBACK;'), true)
  }
  assert.doesNotMatch(regression, /^COMMIT;$/m)
  assert.equal(regression.trimEnd().endsWith('ROLLBACK;'), true)
  assert.match(regression, /more_info_second_key/)
  assert.match(regression, /bridge_apply_ban_replay/)
  assert.match(regression, /overlapping_apply_state/)
  assert.match(regression, /single_restriction_lift_notification/)
  assert.match(regression, /Another account restriction remains active/)
  assert.match(regression, /future restriction must not notify early/)
  assert.match(regression, /inconsistent_appeal_audit_fails_closed/)
  assert.match(regression, /authoritative_appeal_filing_time/)
  assert.match(regression, /direct_helpers_remain_private/)
  assert.match(regression, /CASE-PRIVATE-205/)
  assert.match(regression, /admin_search_users\('%m', 50\)/)

  const digest = createHash('sha256').update(migration).digest('hex')
  assert.match(manifest, new RegExp(`^${digest}  ${migrationName}$`, 'm'))
})
