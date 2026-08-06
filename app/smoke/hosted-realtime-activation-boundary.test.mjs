import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = resolve(APP_ROOT, '..')
const OPS_ROOT = resolve(
  REPO_ROOT,
  'supabase/_ops/hosted_realtime_canary',
)

function source(relativePath) {
  return readFileSync(resolve(REPO_ROOT, relativePath), 'utf8')
}

function activationSource(name) {
  return readFileSync(resolve(OPS_ROOT, name), 'utf8')
}

function sqlFunctionBody(sql, functionName) {
  const declaration = `CREATE FUNCTION\n  private.${functionName}`
  const declarationIndex = sql.indexOf(declaration)
  assert.ok(declarationIndex >= 0, `missing ${functionName} declaration`)
  const bodyMarker = 'AS $function$'
  const bodyIndex = sql.indexOf(bodyMarker, declarationIndex)
  assert.ok(bodyIndex >= 0, `missing ${functionName} body`)
  const endIndex = sql.indexOf('$function$;', bodyIndex + bodyMarker.length)
  assert.ok(endIndex >= 0, `missing ${functionName} body terminator`)
  return sql.slice(bodyIndex + bodyMarker.length, endIndex)
}

test('hosted activation remains staging-only and outside migration history', () => {
  const targets = source('app/e2e/hosted/approved-targets.ts')
  const harnessReadme = source('app/e2e/hosted/README.md')
  const readme = activationSource('README.md')
  const activation = activationSource('ACTIVATE.sql')

  assert.match(
    targets,
    /APPROVED_HOSTED_REALTIME_TARGETS[\s\S]*Object\.freeze\(\[\]\)/,
  )
  assert.match(readme, /staging-only/i)
  assert.match(readme, /must not be copied into `?supabase\/migrations/i)
  assert.match(
    readme,
    /VERIFY_20260719164126_reconcile_managed_realtime_authorization_contract\.sql/,
  )
  assert.match(readme, /first real five-minute cron execution/i)
  assert.match(readme, /cron\.job_run_details/)
  assert.match(readme, /heartbeat alone is insufficient worker attribution/i)
  assert.match(harnessReadme, /local draft/i)
  assert.match(harnessReadme, /Local green tests do not prove hosted/i)
  assert.doesNotMatch(
    harnessReadme,
    /does \*\*not\*\* yet contain an approved staging activation unit/i,
  )
  assert.match(targets, /providerDisableProofSha256/)
  assert.match(targets, /providerProofExpiresAt/)
  assert.match(activation, /lfhvgprfphyfvhidegum/)
  assert.match(activation, /activation_refused_known_production_project/)
  // Migration history deploys to production, so no part of the staging-only
  // package may live there. Matching only `hosted_realtime_canary` was too
  // narrow: `20260801082937_enable_pg_cron_for_hosted_realtime_activation.sql`
  // carried the canary's pg_cron prerequisite into migration history and
  // passed this guard on the strength of one different word.
  assert.doesNotMatch(
    source('supabase/migrations/manifest.sha256'),
    /hosted_realtime/i,
  )
})

test('activation SQL installs a least-privilege run and write ledger', () => {
  const activation = activationSource('ACTIVATE.sql')

  for (const table of [
    'hosted_realtime_canary_environment_config',
    'hosted_realtime_canary_runs',
    'hosted_realtime_canary_writes',
    'hosted_realtime_canary_profile_baselines',
  ]) {
    assert.match(activation, new RegExp(`private\\.${table}`))
  }
  assert.match(
    activation,
    /CREATE UNIQUE INDEX hosted_realtime_canary_one_active_run[\s\S]*WHERE status = 'active'/i,
  )
  assert.match(activation, /p_run_id uuid/)
  assert.match(activation, /pg_advisory_xact_lock/)
  assert.match(activation, /LOCK TABLE public\.conversations IN SHARE MODE/)
  assert.match(activation, /auth\.jwt\(\)[\s\S]*session_id/)
  assert.match(activation, /caaci_hosted_canary/)
  assert.match(activation, /caaci_dataset_lineage/)
  assert.match(activation, /caaci_canary_role/)
  assert.match(activation, /SET search_path = pg_catalog/g)
  assert.doesNotMatch(activation, /SET search_path = public/i)
  assert.doesNotMatch(
    activation,
    /FROM auth\.users[\s\S]{0,300}FOR UPDATE/i,
  )
})

test('managed Auth access is confined to postgres-owned scalar helpers', () => {
  const activation = activationSource('ACTIVATE.sql')
  const verifyBody = activationSource('VERIFY_BODY.sql')
  const rollback = activationSource('ROLLBACK.sql')
  const bootstrap = activationSource('LOCAL_BOOTSTRAP.sql')
  const regression = activationSource('LOCAL_REGRESSION.sql')
  const runner = activationSource('run-local-regression.sh')

  assert.doesNotMatch(activation, /CREATE OR REPLACE FUNCTION/)
  assert.match(
    activationSource('PRECHECK.sql'),
    /procedure\.proname LIKE 'hosted_realtime_canary_%'/,
  )
  assert.match(
    activation,
    /hosted_realtime_canary_auth_context[\s\S]*RETURNS TABLE\(actor_id uuid, session_id uuid, canary_role text\)[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = pg_catalog/,
  )
  assert.match(
    activation,
    /hosted_realtime_canary_fixture_session_count[\s\S]*RETURNS integer[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = pg_catalog/,
  )
  for (const signature of [
    'private.hosted_realtime_canary_auth_context(text, text)',
    'private.hosted_realtime_canary_fixture_session_count(uuid, uuid, uuid, text)',
  ]) {
    const escaped = signature.replace(/[().]/g, '\\$&')
    assert.match(
      activation,
      new RegExp(`ALTER FUNCTION\\s+${escaped}[\\s\\S]*OWNER TO postgres`),
    )
    assert.match(rollback, new RegExp(`DROP FUNCTION\\s+${escaped}`))
  }
  assert.doesNotMatch(
    activation,
    /GRANT USAGE ON SCHEMA auth[\s\S]{0,120}caaci_hosted_realtime_executor/i,
  )
  assert.doesNotMatch(
    activation,
    /GRANT SELECT ON (?:TABLE )?auth\.(?:users|sessions|identities)[\s\S]{0,180}caaci_hosted_realtime_executor/i,
  )
  assert.match(verifyBody, /verify_managed_auth_acl_failed/)
  assert.match(verifyBody, /verify_auth_helper_acl_failed/)
  assert.match(verifyBody, /verify_auth_helper_definition_failed/)
  assert.match(verifyBody, /aclexplode\(procedure\.proacl\)/)
  for (const helper of [
    'hosted_realtime_canary_auth_context',
    'hosted_realtime_canary_fixture_session_count',
  ]) {
    const bodyMd5 = createHash('md5')
      .update(sqlFunctionBody(activation, helper))
      .digest('hex')
    assert.match(verifyBody, new RegExp(bodyMd5))
  }

  assert.match(bootstrap, /ALTER SCHEMA auth OWNER TO supabase_admin/)
  assert.match(
    bootstrap,
    /GRANT SELECT ON TABLE auth\.users, auth\.sessions, auth\.identities[\s\S]*TO postgres;/,
  )
  assert.match(runner, /REVOKE supabase_admin FROM postgres/)
  assert.match(regression, /local_hosted_auth_owner_boundary_failed/)
  assert.match(regression, /local_auth_helper_boundary_failed/)
  assert.match(regression, /local_unbound_fixture_set_was_not_denied/)
  assert.match(activation, /fixture_session_binding_sha256_base64url/)
  assert.match(activation, /SET application_name FROM CURRENT/)
  assert.match(activation, /caaci-hosted-session-fixture-v1/)
  for (const actor of ['a', 'b', 'c']) {
    assert.match(
      activation,
      new RegExp(`:'actor_${actor}_id'::uuid::text`),
    )
  }
  assert.match(regression, /\\set actor_a_id AAAAAAAA-/)
  assert.match(verifyBody, /application_name=/)
  assert.match(verifyBody, /fixture_session_binding_sha256_base64url/)
})

test('activation pins the hosted operator and role-switch contract', () => {
  const activation = activationSource('ACTIVATE.sql')
  const precheck = activationSource('PRECHECK.sql')
  const verify = activationSource('VERIFY.sql')
  const verifyBody = activationSource('VERIFY_BODY.sql')
  const verifyCronBody = activationSource('VERIFY_CRON_BODY.sql')
  const recovery = activationSource('RECOVER.sql')
  const rollback = activationSource('ROLLBACK.sql')

  const canonicalVerifyIndex = activation.indexOf(
    '\\ir ../VERIFY_20260719164126_reconcile_managed_realtime_authorization_contract.sql',
  )
  const precheckIndex = activation.indexOf('\\ir PRECHECK.sql')
  const transactionIndex = activation.indexOf('BEGIN;')

  assert.ok(canonicalVerifyIndex >= 0)
  assert.ok(canonicalVerifyIndex < precheckIndex)
  assert.ok(precheckIndex < transactionIndex)
  assert.match(precheck, /server_version_num[\s\S]*160000/)
  assert.match(
    precheck,
    /CURRENT_USER <> 'postgres'[\s\S]*SESSION_USER <> 'postgres'/,
  )
  assert.match(
    precheck,
    /operator\.rolcanlogin[\s\S]*NOT operator\.rolsuper[\s\S]*operator\.rolcreaterole/,
  )
  for (const relation of [
    'profiles',
    'conversations',
    'messages',
    'conversation_archives',
    'notifications',
  ]) {
    assert.match(precheck, new RegExp(`\\('${relation}'\\)`))
  }
  assert.match(precheck, /NOT relation\.relrowsecurity/)

  assert.match(
    activation,
    /GRANT caaci_hosted_realtime_executor TO postgres[\s\S]*WITH INHERIT FALSE, SET TRUE/,
  )
  assert.match(activation, /WHERE bootstrap\.rolsuper/)
  for (const sql of [activation, verify, recovery, rollback]) {
    assert.match(sql, /SET LOCAL ROLE caaci_hosted_realtime_executor/)
    assert.match(sql, /RESET ROLE/)
    assert.doesNotMatch(sql, /membership\.grantor\s*=\s*10/)
  }
  assert.match(
    verifyBody,
    /pg_has_role\([\s\S]*'postgres', 'caaci_hosted_realtime_executor', 'USAGE'[\s\S]*pg_has_role\([\s\S]*'postgres', 'caaci_hosted_realtime_executor', 'SET'/,
  )
  assert.match(
    verifyBody,
    /has_schema_privilege\([\s\S]*'caaci_hosted_realtime_executor', 'public', 'CREATE'[\s\S]*has_schema_privilege\([\s\S]*'caaci_hosted_realtime_executor', 'private', 'CREATE'/,
  )
  assert.match(verifyBody, /verify_executor_schema_boundary_failed/)
  assert.match(verifyBody, /verify_private_table_acl_provenance_failed/)
  assert.match(
    verifyBody,
    /pg_attribute AS attribute[\s\S]*attribute\.attacl IS NOT NULL/,
  )
  assert.match(verifyBody, /has_any_column_privilege/)
  assert.match(
    verifyBody,
    /aclexplode\([\s\S]*COALESCE\([\s\S]*relation\.relacl,[\s\S]*acldefault\('r', relation\.relowner\)[\s\S]*EXCEPT[\s\S]*acldefault\([\s\S]*'r',[\s\S]*to_regrole\('caaci_hosted_realtime_executor'\)/,
  )
  assert.match(
    verifyBody,
    /CROSS JOIN LATERAL \([\s\S]*aclexplode\([\s\S]*acldefault\('r', relation\.relowner\)[\s\S]*privilege_type AS privilege_name/,
  )
  assert.doesNotMatch(
    verifyBody,
    /has_table_privilege\(\s*'postgres',[\s\S]{0,240}hosted_realtime_canary_/,
  )
  assert.match(verifyBody, /verify_public_rls_boundary_failed/)
  assert.match(verifyBody, /NOT relation\.relrowsecurity/)
  assert.match(verifyBody, /verify_private_api_acl_failed/)
  assert.match(
    verifyBody,
    /private\.hosted_realtime_canary_cleanup_run\(uuid,text\)/,
  )
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.match(verifyBody, new RegExp(`\\('${role}'\\)`))
  }
  assert.match(verify, /\\ir VERIFY_CRON_BODY\.sql/)
  assert.match(verifyCronBody, /job\.username = 'postgres'/)
  assert.match(
    verifyCronBody,
    /private\.hosted_realtime_canary_ttl_cleanup\(\)'[\s\S]*'EXECUTE'/,
  )
})

test('local managed Realtime fixture preserves canonical ACL and policy gates', () => {
  const bootstrap = activationSource('LOCAL_BOOTSTRAP.sql')
  const regression = activationSource('LOCAL_REGRESSION.sql')
  const activation = activationSource('ACTIVATE.sql')

  assert.match(
    bootstrap,
    /GRANT SELECT, INSERT, UPDATE ON realtime\.messages[\s\S]*TO anon, authenticated, service_role/,
  )
  assert.match(
    bootstrap,
    /CREATE POLICY "Conversation participants can receive private realtime"/,
  )
  assert.match(
    bootstrap,
    /CREATE POLICY "Conversation participants can send private realtime"/,
  )
  assert.match(
    activation,
    /\\ir \.\.\/VERIFY_20260719164126_reconcile_managed_realtime_authorization_contract\.sql/,
  )
  assert.match(regression, /\\ir ACTIVATE\.sql/)
  assert.match(regression, /request\.jwt\.claims/)
  assert.match(regression, /local-member-positive/)
  assert.match(regression, /local-nonmember-negative/)
  assert.match(regression, /WHEN insufficient_privilege THEN NULL/)
})

test('local SQL runner is isolated, non-superuser, and self-cleaning', () => {
  const runner = activationSource('run-local-regression.sh')
  const packageJson = JSON.parse(source('app/package.json'))

  assert.equal(
    packageJson.scripts['smoke:hosted-realtime-sql-local'],
    'bash ../supabase/_ops/hosted_realtime_canary/run-local-regression.sh',
  )
  assert.match(runner, /if \(\( \$# != 0 \)\)/)
  assert.match(runner, /PGHOST PGHOSTADDR PGPORT/)
  assert.match(runner, /unset "\$ambient_name"/)
  assert.match(runner, /requires PostgreSQL 16\.x or 17\.x/)
  assert.match(
    runner,
    /mktemp -d \/private\/tmp\/caaci-hosted-pg-local\.XXXXXX/,
  )
  assert.match(runner, /listen_addresses=/)
  assert.match(runner, /createrole_self_grant=/)
  assert.match(runner, /inet_server_addr\(\) IS NULL/)
  assert.match(runner, /CREATE ROLE service_role NOLOGIN BYPASSRLS/)
  assert.match(
    runner,
    /CREATE ROLE postgres LOGIN NOSUPERUSER CREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS INHERIT/,
  )
  assert.match(
    runner,
    /GRANT pg_read_all_data TO postgres WITH INHERIT TRUE, SET TRUE/,
  )
  assert.match(
    runner,
    /pg_has_role\(\s*'postgres', 'pg_read_all_data', 'USAGE'/,
  )
  assert.match(runner, /GRANT pg_maintain TO postgres WITH ADMIN TRUE/)
  assert.match(
    activationSource('LOCAL_REGRESSION.sql'),
    /GRANT SELECT \(provider_disable_proof_sha256\)[\s\S]*TO authenticated/,
  )
  assert.match(
    activationSource('LOCAL_REGRESSION.sql'),
    /GRANT pg_maintain TO authenticated[\s\S]*verify_private_api_acl_failed/,
  )
  assert.match(
    activationSource('LOCAL_EXPECT_VERIFY_FAILURE.sql'),
    /local_verify_current_sqlstate[\s\S]*SQLSTATE[\s\S]*LAST_ERROR_SQLSTATE[\s\S]*LAST_ERROR_MESSAGE[\s\S]*expected_verify_failure_message/,
  )
  assert.match(runner, /-U postgres/)
  assert.match(runner, /-f "\$script_dir\/LOCAL_REGRESSION\.sql"/)
  assert.match(
    runner,
    /\.\.\/VERIFY_20260719164126_reconcile_managed_realtime_authorization_contract\.sql/,
  )
  assert.match(runner, /source_manifest_before=/)
  assert.match(runner, /source_manifest_after=/)
  assert.match(runner, /SQL sources changed during the regression/)
  assert.match(runner, /source_manifest_sha256=/)
  assert.match(runner, /evidence_log=/)
  assert.match(runner, /PostgreSQL did not stop; preserved/)
  assert.match(runner, /Temporary cluster cleanup failed/)
  assert.match(
    runner,
    /SELECT pg_catalog\.count\(\*\)::integer\s+FROM cron\.job\s+\)/,
  )
  assert.doesNotMatch(
    runner,
    /WHERE job\.jobname = 'caaci-hosted-realtime-canary-ttl'/,
  )
  assert.ok(
    runner.lastIndexOf('if ! stop_and_remove_cluster') <
      runner.lastIndexOf(
        'echo "[LOCAL-PG] PASS PostgreSQL $postgres_major isolated non-superuser regression"',
      ),
  )
  assert.match(
    runner,
    /\/private\/tmp\/caaci-hosted-pg-local\.\*\)[\s\S]*rm -rf -- "\$cluster_root"/,
  )
  assert.doesNotMatch(runner, /https?:\/\/|supabase\.co|DATABASE_URL/)
})

test('public activation RPCs expose only the reviewed identities', () => {
  const activation = activationSource('ACTIVATE.sql')
  const normalized = activation
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),])\s*/g, '$1')

  for (const signature of [
    'public.hosted_realtime_canary_environment()',
    'public.hosted_realtime_canary_begin_run(uuid)',
    'public.hosted_realtime_canary_insert_message(uuid,uuid,uuid,text)',
    'public.hosted_realtime_canary_cleanup(uuid,uuid[])',
  ]) {
    assert.ok(
      normalized.includes(
        `REVOKE ALL ON FUNCTION ${signature}FROM PUBLIC,anon,authenticated,service_role`,
      ),
    )
  }
  assert.ok(
    normalized.includes(
      'GRANT EXECUTE ON FUNCTION public.hosted_realtime_canary_environment()TO anon;',
    ),
  )
  for (const signature of [
    'public.hosted_realtime_canary_begin_run(uuid)',
    'public.hosted_realtime_canary_insert_message(uuid,uuid,uuid,text)',
    'public.hosted_realtime_canary_cleanup(uuid,uuid[])',
  ]) {
    assert.ok(
      normalized.includes(
        `GRANT EXECUTE ON FUNCTION ${signature}TO authenticated;`,
      ),
    )
  }
  assert.doesNotMatch(
    activation,
    /GRANT EXECUTE ON FUNCTION public\.hosted_realtime_canary_(?:begin_run|insert_message|cleanup)[\s\S]*TO (?:anon|service_role)/i,
  )
})

test('insert and cleanup are exact, actor-bound, and restore derived state', () => {
  const activation = activationSource('ACTIVATE.sql')

  assert.match(activation, /caaci-hosted-canary-/)
  assert.match(
    activation,
    /p_content IS DISTINCT FROM[\s\S]*'caaci-hosted-canary-' \|\| p_id::text/i,
  )
  assert.match(activation, /public\.conversation_archives/)
  assert.match(activation, /last_message_at/)
  assert.match(activation, /response_rate/)
  assert.match(activation, /response_sample/)
  assert.match(activation, /profile\.updated_at IS DISTINCT FROM baseline\.updated_at/)
  assert.match(activation, /zz_hosted_realtime_canary_restore_profile_timestamp/)
  assert.match(activation, /public\.recompute_seller_response/)
  assert.match(activation, /array_agg\(write\.message_id ORDER BY write\.message_id\)/i)
  assert.match(
    activation,
    /LEFT JOIN public\.messages AS message ON message\.id = write\.message_id/i,
  )
  assert.match(activation, /message\.id IS NULL/)
  assert.match(activation, /p_message_ids[\s\S]*ORDER BY/i)
  assert.match(activation, /deleted_count/)
  assert.match(activation, /residue_count/)
  assert.doesNotMatch(activation, /DELETE FROM public\.messages[\s\S]*LIKE/i)
  assert.doesNotMatch(activation, /\bTRUNCATE\b/i)
})

test('abnormal termination has a bounded server-owned recovery path', () => {
  const activation = activationSource('ACTIVATE.sql')
  const verify = `${activationSource('VERIFY.sql')}\n${activationSource('VERIFY_BODY.sql')}`
  const recovery = activationSource('RECOVER.sql')
  const rollback = activationSource('ROLLBACK.sql')

  assert.match(activation, /private\.hosted_realtime_canary_ttl_cleanup/)
  assert.match(activation, /cron\.schedule/)
  assert.match(activation, /lease_expires_at/)
  assert.match(activation, /provider_disable_proof_sha256/)
  assert.match(activation, /provider_proof_expires_at/)
  assert.match(activation, /lifecycle_state text/)
  assert.match(activation, /auth\.sessions/)
  assert.match(verify, /provider_side_effects_disabled/)
  assert.match(verify, /residue_count/)
  assert.match(activation, /recovery_required/)
  assert.match(recovery, /management_recovery_proof_sha256/)
  assert.match(recovery, /max_access_token_lifetime_seconds/)
  for (const sql of [activation, recovery, rollback]) {
    assert.doesNotMatch(sql, /(?:INSERT INTO|UPDATE|DELETE FROM) auth\./i)
  }
  assert.match(rollback, /cron\.unschedule/)
  assert.match(rollback, /DROP FUNCTION public\.hosted_realtime_canary_/)
  assert.doesNotMatch(rollback, /\bCASCADE\b/i)
})

test('hosted harness binds every write and final cleanup to one server run', () => {
  const fixtures = source('app/e2e/hosted/fixtures.ts')
  const sdkBoundary = source('app/e2e/hosted/sdk-boundary.ts')
  const normalizedSdkBoundary = sdkBoundary
    .replace(/\s+/g, ' ')
    .replace(/\s*([()[\],])\s*/g, '$1')

  assert.match(fixtures, /hosted_realtime_canary_begin_run/)
  assert.match(fixtures, /p_run_id:\s*hostedContract\.runId/)
  assert.match(fixtures, /hosted_realtime_canary_cleanup/)
  assert.match(fixtures, /registry\.allIds\(\)/)
  assert.match(fixtures, /registry\.completedRunShapeMatches\(hostedContract\)/)
  assert.match(fixtures, /revokeExactHostedSession/)
  assert.match(sdkBoundary, /hosted_realtime_canary_begin_run/)
  assert.match(
    sdkBoundary,
    /exactKeys\(payload,\s*\['p_run_id'\]\)/,
  )
  assert.ok(
    normalizedSdkBoundary.includes(
      "exactKeys(payload,['p_content','p_conversation_id','p_id','p_run_id'],)",
    ),
  )
  assert.match(
    sdkBoundary,
    /exactKeys\(payload,\s*\['p_message_ids', 'p_run_id'\]\)/,
  )
})
