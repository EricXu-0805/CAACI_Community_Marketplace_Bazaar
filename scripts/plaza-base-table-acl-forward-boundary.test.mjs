import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationUrl = new URL(
  '../supabase/migrations/20260719151729_reconcile_plaza_base_table_acl.sql',
  import.meta.url,
)
const precheckUrl = new URL(
  '../supabase/_ops/PRECHECK_20260719151729_reconcile_plaza_base_table_acl.sql',
  import.meta.url,
)
const verifyUrl = new URL(
  '../supabase/_ops/VERIFY_20260719151729_reconcile_plaza_base_table_acl.sql',
  import.meta.url,
)
const regressionUrl = new URL(
  '../supabase/_ops/REGRESSION_20260719151729_reconcile_plaza_base_table_acl.sql',
  import.meta.url,
)
const manifestUrl = new URL(
  '../supabase/migrations/manifest.sha256',
  import.meta.url,
)

function withoutLineComments(source) {
  return source.replace(/^\s*--.*$/gm, '')
}

const pg17ProfileAlias =
  'get_my_profile()profile(id,phone,email,wechat_openid,nickname,avatar_url,bio,location,created_at,updated_at,is_illini_verified,uid,avg_rating,rating_count,status_text,status_emoji,trust_score,shadow_banned,suspension_level,suspended_until,last_fp_hash,last_fp_seen_at,warning_count,tos_version,consented_at,onboarded_at,campus_area,wechat_unionid,response_rate,response_sample,email_digest_opt_out,unsubscribe_token,verified_illini_email)'

test('forward repair is standalone and scoped to the two Plaza relations', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(
    migration,
    /FOREACH relation_name IN ARRAY ARRAY\['posts', 'post_items'\]::text\[\]/,
  )
  assert.doesNotMatch(migration, /public\.notifications\b|source_event_key/)
  assert.doesNotMatch(migration, /ALTER TABLE\s+realtime\.|public\.messages\b/)
  assert.match(migration, /plaza_acl_rls_prerequisite_missing/)
  assert.match(migration, /plaza_acl_permissive_policy_drift/)
  assert.match(migration, /plaza_acl_policy_contract_mismatch/)
  assert.match(migration, /plaza_acl_column_prerequisite_missing/)
  assert.match(
    migration,
    /\('anon'\), \('authenticated'\), \('service_role'\)/,
  )
})

test('repair clears table and column drift before exact application grants', async () => {
  const migration = withoutLineComments(await readFile(migrationUrl, 'utf8'))

  assert.match(
    migration,
    /REVOKE SELECT \(%1\$s\), INSERT \(%1\$s\), UPDATE \(%1\$s\), REFERENCES \(%1\$s\)[^']+FROM PUBLIC, anon, authenticated, service_role/,
  )
  assert.match(
    migration,
    /REVOKE ALL PRIVILEGES ON TABLE public\.%I FROM PUBLIC, anon, authenticated, service_role/,
  )
  assert.match(
    migration,
    /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE\s+public\.posts,\s+public\.post_items\s+TO service_role/,
  )

  assert.match(
    migration,
    /GRANT SELECT \([\s\S]*?source_lang\s*\) ON TABLE public\.posts TO anon, authenticated/,
  )
  assert.match(
    migration,
    /GRANT SELECT \(post_id, item_id, display_order, created_at\)\s+ON TABLE public\.post_items TO anon, authenticated/,
  )
  assert.match(
    migration,
    /GRANT INSERT \([\s\S]*?source_lang\s*\) ON TABLE public\.posts TO authenticated/,
  )
  assert.match(
    migration,
    /GRANT UPDATE \(content_i18n\) ON TABLE public\.posts TO authenticated/,
  )
  assert.match(
    migration,
    /GRANT INSERT \(post_id, item_id, display_order\)\s+ON TABLE public\.post_items TO authenticated/,
  )
  assert.match(migration, /GRANT DELETE ON TABLE public\.post_items TO authenticated/)
})

test('all eight permissive policies use an exact NULL-safe contract', async () => {
  const [migration, precheck, verify] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(precheckUrl, 'utf8'),
    readFile(verifyUrl, 'utf8'),
  ])

  assert.equal((migration.match(/CREATE POLICY /g) || []).length, 8)
  for (const policyName of [
    'Anyone can view active posts',
    'Authenticated users can create posts',
    'Users can update own posts',
    'Users can delete own posts',
    'Anyone can view visible post items',
    'Post owner can attach own items',
    'Post owner can detach items',
    'No updates to post_items',
  ]) {
    for (const source of [migration, precheck, verify]) {
      assert.match(source, new RegExp(policyName))
    }
  }
  for (const source of [migration, precheck, verify]) {
    assert.match(source, /using_expression IS DISTINCT FROM/)
    assert.match(source, /check_expression IS DISTINCT FROM/)
    assert.doesNotMatch(source, /policy_expression NOT ILIKE/)
  }
  assert.match(migration, /legacy_public_allowed/)
  assert.match(verify, /exact Plaza policy contract drift/)

  for (const source of [migration, precheck, verify]) {
    assert.match(
      source,
      /\(\(auth\.uid\(\)=user_id\)and\(notis_official\)and\(notis_pinned\)\)/,
    )
    assert.match(source, /get_my_profile\(\)profile\(suspension_level\)/)
    assert.ok(source.includes(pg17ProfileAlias))
    assert.match(source, /profile_canonical_alias/)
    assert.match(source, /pg_catalog\.replace\(/)
    assert.match(source, /fromget_my_profile\(\)profile\)\)::integer/)
    assert.doesNotMatch(
      source,
      /regexp_replace\([\s\S]{0,120}get_my_profile\(\)profile/,
    )
  }
  assert.match(
    migration,
    /CREATE POLICY "Users can update own posts"[\s\S]*?AND NOT is_official[\s\S]*?AND NOT is_pinned[\s\S]*?;/,
  )
})

test('ops verify direct ACL provenance, effective inheritance, and service CRUD', async () => {
  const [migration, precheck, verify, regression] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(precheckUrl, 'utf8'),
    readFile(verifyUrl, 'utf8'),
    readFile(regressionUrl, 'utf8'),
  ])

  assert.match(precheck, /SET TRANSACTION READ ONLY/)
  assert.match(precheck, /anon_post_items_insert_before/)
  assert.match(precheck, /Plaza permissive policy drift/)
  assert.match(precheck, /inherited Plaza table ACL excess/)
  assert.match(precheck, /inherited Plaza column ACL excess/)
  assert.match(precheck, /including PG17 MAINTAIN/)
  assert.doesNotMatch(withoutLineComments(precheck), /'MAINTAIN'/)

  assert.match(verify, /SET TRANSACTION READ ONLY/)
  assert.match(verify, /aclexplode\(relation\.relacl\)/)
  assert.match(verify, /aclexplode\(attribute\.attacl\)/)
  assert.match(verify, /acl\.grantor/)
  assert.match(verify, /acl\.is_grantable/)
  assert.match(verify, /EXCEPT ALL/)
  assert.match(verify, /18160000 Plaza ACL contract unsatisfied/)
  assert.match(verify, /has_table_privilege/)
  assert.match(verify, /has_column_privilege/)
  assert.match(verify, /service_role/)
  assert.match(verify, /inherited\/effective Plaza table ACL drift/)
  assert.match(verify, /inherited\/effective Plaza column ACL drift/)
  assert.match(verify, /inherited Plaza table ACL provenance drift/)
  assert.match(verify, /inherited Plaza column ACL provenance drift/)
  assert.match(verify, /acl\.grantee <> 0/)
  assert.match(verify, /pg_catalog\.pg_has_role\(/)
  assert.match(verify, /inherited\.is_grantable/)
  assert.match(verify, /server_version_num/)
  assert.match(verify, /'MAINTAIN'/)
  assert.match(verify, /effective Plaza MAINTAIN drift/)

  assert.match(migration, /plaza_acl_postcondition_direct_table_acl_mismatch/)
  assert.match(migration, /plaza_acl_postcondition_direct_column_acl_mismatch/)
  assert.match(migration, /plaza_acl_inherited_table_privilege_drift/)
  assert.match(migration, /plaza_acl_inherited_column_privilege_drift/)
  assert.match(migration, /plaza_acl_inherited_table_acl_provenance_drift/)
  assert.match(migration, /plaza_acl_inherited_column_acl_provenance_drift/)
  assert.match(migration, /acl\.grantee <> 0/)
  assert.match(migration, /pg_catalog\.pg_has_role\(/)
  assert.match(migration, /inherited\.is_grantable/)
  assert.match(migration, /server_version_num/)
  assert.match(migration, /'MAINTAIN'/)
  assert.match(migration, /plaza_acl_inherited_maintain_privilege_drift/)
  assert.ok(
    migration.indexOf('REVOKE ALL PRIVILEGES ON TABLE') <
      migration.indexOf("'MAINTAIN'"),
  )
  assert.ok(migration.lastIndexOf('$postcondition$;') < migration.lastIndexOf('COMMIT;'))

  for (const marker of [
    'public_true_detected',
    'null_predicate_detected',
    'pg17_alias_signature_detected',
    'inherited_privilege_detected',
    'inherited_grant_option_detected',
    'inherited_maintain_privilege_detected',
    'grant_option_detected',
    'duplicate_grantor_detected',
  ]) {
    assert.match(regression, new RegExp(`\\$${marker}\\$`))
  }
  assert.match(regression, /NEVER run against production/)
  assert.ok(regression.includes(pg17ProfileAlias))
  assert.match(regression, /GRANT MAINTAIN ON TABLE public\.posts/)
  assert.match(regression, /SELECT WITH GRANT OPTION/)
  assert.match(regression, /inherited grant option escaped ACL provenance detection/)
  assert.match(regression, /mutated profile alias signature escaped exact detection/)
  assert.match(regression, /ROLLBACK;\s*$/)

  for (const source of [precheck, verify]) {
    const executable = withoutLineComments(source)
    assert.doesNotMatch(
      executable,
      /^\s*(?:GRANT|REVOKE|CREATE|ALTER|DROP)\b/im,
    )
    assert.match(executable, /ROLLBACK;\s*$/)
  }
})

test('forward migration has a reviewed manifest entry after the frozen boundary', async () => {
  const [migration, manifest] = await Promise.all([
    readFile(migrationUrl),
    readFile(manifestUrl, 'utf8'),
  ])
  const hash = createHash('sha256').update(migration).digest('hex')
  assert.match(
    manifest,
    new RegExp(`^${hash}  20260719151729_reconcile_plaza_base_table_acl\\.sql$`, 'm'),
  )
  assert.ok('20260719151729' > '20260719083511')
})

test('every PL/pgSQL and DO body closes with an explicit END semicolon', async () => {
  const sources = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(precheckUrl, 'utf8'),
    readFile(verifyUrl, 'utf8'),
    readFile(regressionUrl, 'utf8'),
  ])
  for (const source of sources) {
    const bodies = [...source.matchAll(/\$([a-z_]+)\$([\s\S]*?)\$\1\$;/g)]
    assert.ok(bodies.length > 0)
    for (const [, , body] of bodies) assert.match(body.trim(), /END;$/)
  }
})
