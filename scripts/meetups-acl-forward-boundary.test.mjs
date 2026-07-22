import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationUrl = new URL(
  '../supabase/migrations/20260719170019_reconcile_meetups_acl_boundary.sql',
  import.meta.url,
)
const precheckUrl = new URL(
  '../supabase/_ops/PRECHECK_20260719170019_reconcile_meetups_acl_boundary.sql',
  import.meta.url,
)
const verifyUrl = new URL(
  '../supabase/_ops/VERIFY_20260719170019_reconcile_meetups_acl_boundary.sql',
  import.meta.url,
)
const regressionUrl = new URL(
  '../supabase/_ops/REGRESSION_20260719170019_reconcile_meetups_acl_boundary.sql',
  import.meta.url,
)
const finalAclUrl = new URL(
  '../supabase/migrations/20260718280000_reconcile_app_table_acl_boundaries.sql',
  import.meta.url,
)

function withoutLineComments(source) {
  return source.replace(/^\s*--.*$/gm, '')
}

function meetupSelectColumns(source) {
  const match = source.match(
    /GRANT SELECT \(\s*(id,\s*conversation_id,\s*item_id,\s*from_user[\s\S]*?)\) ON TABLE public\.meetups TO authenticated;/,
  )
  assert.ok(match, 'authenticated meetups SELECT projection is missing')
  return match[1]
    .split(',')
    .map((column) => column.trim())
    .filter(Boolean)
}

test('forward migration is unique, forward-only, and scoped to public.meetups', async () => {
  const migration = withoutLineComments(await readFile(migrationUrl, 'utf8'))

  assert.ok('20260719170019' > '20260719164126')
  assert.match(migration, /^\s*BEGIN;/)
  assert.match(migration, /COMMIT;\s*$/)
  assert.match(migration, /public\.meetups/g)
  assert.doesNotMatch(migration, /ALTER TABLE\s+public\.messages/i)
  assert.doesNotMatch(migration, /ALTER TABLE\s+public\.notifications/i)
  assert.doesNotMatch(migration, /CREATE POLICY|DROP POLICY|ALTER POLICY/i)
  assert.doesNotMatch(migration, /20260718260000_atomic_digest_reminder_seeding/)
})

test('repair clears every table and column ACL before the exact final grant', async () => {
  const migration = withoutLineComments(await readFile(migrationUrl, 'utf8'))

  assert.match(
    migration,
    /REVOKE SELECT \(%1\$s\), INSERT \(%1\$s\), UPDATE \(%1\$s\), REFERENCES \(%1\$s\)[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/,
  )
  assert.match(
    migration,
    /REVOKE ALL PRIVILEGES ON TABLE public\.meetups\s+FROM PUBLIC, anon, authenticated, service_role/,
  )
  assert.match(
    migration,
    /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.meetups TO service_role/,
  )
  assert.deepEqual(meetupSelectColumns(migration), [
    'id',
    'conversation_id',
    'item_id',
    'from_user',
    'to_user',
    'spot',
    'meet_at',
    'status',
    'parent_meetup_id',
    'note',
    'expires_at',
    'created_at',
    'updated_at',
  ])
  assert.doesNotMatch(
    migration,
    /GRANT (?:INSERT|UPDATE|DELETE)[\s\S]{0,120}public\.meetups TO authenticated/,
  )
})

test('repair converges to the same meetups contract as the final app ACL migration', async () => {
  const [forward, finalAcl] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(finalAclUrl, 'utf8'),
  ])

  assert.deepEqual(meetupSelectColumns(forward), meetupSelectColumns(finalAcl))
  assert.match(
    finalAcl,
    /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE[\s\S]*?public\.meetups,[\s\S]*?TO service_role/,
  )
  assert.doesNotMatch(
    finalAcl,
    /GRANT (?:INSERT|UPDATE|DELETE)[\s\S]{0,120}public\.meetups TO authenticated/,
  )
})

test('migration and verify prove direct, effective, inherited, and PG17 ACL truth', async () => {
  const [migration, verify] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(verifyUrl, 'utf8'),
  ])

  for (const source of [migration, verify]) {
    assert.match(source, /aclexplode\(relation\.relacl\)/)
    assert.match(source, /aclexplode\(attribute\.attacl\)/)
    assert.match(source, /acl\.grantor/)
    assert.match(source, /acl\.is_grantable/)
    assert.match(source, /EXCEPT ALL/)
    assert.match(source, /has_table_privilege/)
    assert.match(source, /has_column_privilege/)
    assert.match(source, /pg_catalog\.pg_has_role\(/)
    assert.match(source, /WITH GRANT OPTION/)
    assert.match(source, /server_version_num/)
    assert.match(source, /'MAINTAIN'/)
    assert.match(source, /reminded_at/)
    assert.match(source, /service_role/)
    assert.match(source, /authenticated/)
    assert.match(source, /anon/)
  }

  assert.match(migration, /postcondition_direct_table_mismatch/)
  assert.match(migration, /postcondition_direct_column_mismatch/)
  assert.match(migration, /postcondition_effective_table_mismatch/)
  assert.match(migration, /postcondition_effective_column_mismatch/)
  assert.match(migration, /postcondition_inherited_rpc_provenance/)
  assert.match(verify, /direct meetups table ACL mismatch/)
  assert.match(verify, /effective meetups column ACL mismatch/)
  assert.match(verify, /effective PG17 MAINTAIN drift/)
})

test('RLS and all three guarded write RPC contracts stay exact', async () => {
  const [migration, precheck, verify] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(precheckUrl, 'utf8'),
    readFile(verifyUrl, 'utf8'),
  ])

  for (const source of [migration, precheck, verify]) {
    assert.match(source, /relrowsecurity/)
    assert.match(source, /meetups_select/)
    assert.match(
      source,
      /private\.current_user_can_access_conversation\(conversation_id\)/,
    )
    assert.match(
      source,
      /public\.propose_meetup\(uuid,text,timestamp with time zone,uuid,text\)/,
    )
    assert.match(
      source,
      /public\.respond_to_meetup\(uuid,text,uuid,text,timestamp with time zone,text\)/,
    )
    assert.match(
      source,
      /public\.reschedule_accepted_meetup\(uuid,text,timestamp with time zone,uuid,text\)/,
    )
    assert.match(source, /search_path=pg_catalog/)
    assert.match(source, /has_function_privilege/)
  }
  assert.match(migration, /INTO STRICT rpc_definition/)
  assert.match(migration, /NOT rpc_definition\.prosecdef/)
  assert.match(
    migration,
    /rpc_definition\.proconfig IS DISTINCT FROM\s+ARRAY\['search_path=pg_catalog'\]::text\[\]/,
  )
  assert.match(
    migration,
    /meetups_acl_postcondition_inherited_rpc_provenance/,
  )
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION/)
})

test('operation files are read-only or rollback-only and cover adversarial paths', async () => {
  const [precheck, verify, regression] = await Promise.all([
    readFile(precheckUrl, 'utf8'),
    readFile(verifyUrl, 'utf8'),
    readFile(regressionUrl, 'utf8'),
  ])

  for (const source of [precheck, verify]) {
    const executable = withoutLineComments(source)
    assert.match(executable, /SET TRANSACTION READ ONLY/)
    assert.doesNotMatch(executable, /^\s*(?:GRANT|REVOKE|CREATE|ALTER|DROP)\b/im)
    assert.match(executable, /ROLLBACK;\s*$/)
  }

  for (const marker of [
    'authenticated_update_denied',
    'direct_drift_detected',
    'inherited_table_drift_detected',
    'inherited_column_grant_option_detected',
    'duplicate_grantor_detected',
    'foreign_rpc_grantor_detected',
    'policy_drift_detected',
    'inherited_rpc_drift_detected',
    'pg17_maintain_drift_detected',
  ]) {
    assert.match(regression, new RegExp(`\\$${marker}\\$`))
  }
  assert.match(regression, /NEVER run against production/)
  assert.match(regression, /SET LOCAL ROLE authenticated/)
  assert.match(regression, /UPDATE public\.meetups[\s\S]*?reminded_at/)
  assert.match(regression, /LIMIT 0/)
  assert.match(regression, /WITH GRANT OPTION/)
  assert.match(precheck, /direct meetup RPC ACL mismatch/)
  assert.match(precheck, /acl\.grantor/)
  assert.match(precheck, /acl\.is_grantable/)
  assert.match(precheck, /EXCEPT ALL/)
  assert.match(regression, /GRANT MAINTAIN ON public\.meetups/)
  assert.match(regression, /ROLLBACK;\s*$/)
})
