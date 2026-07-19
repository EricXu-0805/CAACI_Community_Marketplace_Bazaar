import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const APP_SRC = path.join(ROOT, 'app/src')
const migrationUrl = new URL(
  '../supabase/migrations/20260718280000_reconcile_app_table_acl_boundaries.sql',
  import.meta.url,
)
const precheckUrl = new URL(
  '../supabase/_ops/PRECHECK_20260718_reconcile_app_table_acl_boundaries.sql',
  import.meta.url,
)
const verifyUrl = new URL(
  '../supabase/_ops/VERIFY_20260718_reconcile_app_table_acl_boundaries.sql',
  import.meta.url,
)
const regressionUrl = new URL(
  '../supabase/_ops/REGRESSION_20260718_reconcile_app_table_acl_boundaries.sql',
  import.meta.url,
)

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(absolute)
    return /\.(?:ts|vue)$/.test(entry.name) ? [absolute] : []
  }))
  return nested.flat()
}

test('migration inventory covers every shipped direct relation plus view dependencies', async () => {
  const files = await sourceFiles(APP_SRC)
  const relations = new Set()
  for (const file of files) {
    const source = await readFile(file, 'utf8')
    for (const match of source.matchAll(/\.from\(['"]([^'"]+)['"]\)/g)) {
      relations.add(match[1])
    }
  }

  // item-images is the Storage bucket, whose object-table contract belongs to
  // migration 230. Everything else is a direct public-schema Data API path.
  assert.equal(relations.delete('item-images'), true)
  assert.deepEqual([...relations].sort(), [
    'banners_live',
    'blocks',
    'conversation_archives',
    'conversations',
    'favorites',
    'follows',
    'items',
    'meetups',
    'messages',
    'notifications',
    'offers',
    'post_comment_likes',
    'post_comments',
    'post_items',
    'post_likes',
    'posts',
    'profiles',
    'ratings',
    'reports',
    'saved_searches',
    'suspensions',
  ])

  const migration = await readFile(migrationUrl, 'utf8')
  for (const relation of relations) {
    assert.match(migration, new RegExp(`public\\.${relation}\\b`), relation)
  }
  assert.match(migration, /public\.banners\b/)
  assert.match(migration, /security_invoker=true/)
})

test('ACL reset removes table and column drift before exact role grants', async () => {
  const [migration, verify] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(verifyUrl, 'utf8'),
  ])

  assert.match(migration, /REVOKE SELECT \(%1\$s\), INSERT \(%1\$s\), UPDATE \(%1\$s\), REFERENCES \(%1\$s\)/)
  assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE public\.%I FROM PUBLIC, anon, authenticated, service_role/)
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE[\s\S]*TO service_role/)
  assert.match(
    migration,
    /GRANT INSERT \(id, nickname, avatar_url, bio, location, status_text, status_emoji\)\s+ON TABLE public\.profiles TO authenticated/,
  )
  assert.match(
    verify,
    /'profiles', 'INSERT', ARRAY\[\s*'id','nickname','avatar_url','bio','location','status_text','status_emoji'/,
  )
  assert.match(verify, /aclexplode\(relation\.relacl\)/)
  assert.match(verify, /aclexplode\(attribute\.attacl\)/)
  assert.match(verify, /SELECT \* FROM expected EXCEPT SELECT \* FROM actual/)
  assert.match(verify, /SELECT \* FROM actual EXCEPT SELECT \* FROM expected/)
  assert.match(verify, /permissive RLS policy inventory drift/)
})

test('public profile projection excludes identity, contact and moderation state', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const match = migration.match(
    /GRANT SELECT \(\s*id, nickname,[\s\S]*?\) ON TABLE public\.profiles TO anon, authenticated;/,
  )
  assert.ok(match, 'explicit public profiles column grant missing')
  for (const privateColumn of [
    'phone',
    'email',
    'wechat_openid',
    'wechat_unionid',
    'trust_score',
    'shadow_banned',
    'suspension_level',
    'suspended_until',
    'last_fp_hash',
    'last_fp_seen_at',
    'warning_count',
    'verified_illini_email',
    'unsubscribe_token',
  ]) {
    assert.doesNotMatch(match[0], new RegExp(`\\b${privateColumn}\\b`), privateColumn)
  }
})

test('count and suspension filters use explicitly granted columns', async () => {
  const [follow, notifications, suspended, migration] = await Promise.all([
    readFile(new URL('../app/src/composables/useFollow.ts', import.meta.url), 'utf8'),
    readFile(new URL('../app/src/composables/useNotifications.ts', import.meta.url), 'utf8'),
    readFile(new URL('../app/src/pages/suspended/index.vue', import.meta.url), 'utf8'),
    readFile(migrationUrl, 'utf8'),
  ])
  const allClientSource = `${follow}\n${notifications}\n${suspended}`

  assert.doesNotMatch(allClientSource, /\.select\(['"]\*['"]\s*,\s*\{\s*count:/)
  assert.match(follow, /\.select\('followee_id', \{ count: 'estimated', head: true \}\)/)
  assert.match(notifications, /\.select\('id', \{ count: 'exact', head: true \}\)/)
  assert.match(suspended, /\.eq\('profile_id', userId\)/)
  assert.match(suspended, /\.is\('lifted_at', null\)/)
  assert.match(migration, /id, profile_id, level, reason, category, started_at, ends_at, lifted_at,[\s\S]*appeal_note[\s\S]*ON TABLE public\.suspensions TO authenticated/)
})

test('comment status remains selectable only through active-row RLS for report snapshots', async () => {
  const [migration, precheck, verify, regression] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(precheckUrl, 'utf8'),
    readFile(verifyUrl, 'utf8'),
    readFile(regressionUrl, 'utf8'),
  ])

  assert.match(migration, /id, post_id, user_id, content, parent_comment_id, created_at, like_count,\s+status\s+\) ON TABLE public\.post_comments TO anon, authenticated/)
  assert.match(precheck, /\('post_comments', 'status'\)/)
  assert.match(verify, /'post_comments', 'SELECT',[\s\S]*?'like_count','status'/)
  assert.match(regression, /\$comment_report_contract\$/)
  assert.match(regression, /authenticated saw hidden comment/)
  assert.match(regression, /ACL active comment report/)
  assert.match(regression, /hidden comment was reportable/)
})

test('ops cover read-only precheck, exact verify and real multi-role behavior', async () => {
  const [precheck, verify, regression] = await Promise.all([
    readFile(precheckUrl, 'utf8'),
    readFile(verifyUrl, 'utf8'),
    readFile(regressionUrl, 'utf8'),
  ])

  assert.match(precheck, /SET TRANSACTION READ ONLY/)
  assert.match(precheck, /anon_profiles_email_before/)
  assert.match(verify, /profile private-column ACL reopened/)
  assert.match(verify, /RLS disabled on app relation/)
  for (const marker of [
    'anon_contract',
    'account_a_contract',
    'account_b_private_columns',
    'comment_report_contract',
    'nonparticipant_contract',
    'suspended_write_denied',
    'suspension_filter_columns',
    'service_contract',
  ]) {
    assert.match(regression, new RegExp(`\\$${marker}\\$`), marker)
  }
  assert.match(regression, /ALTER ROLE service_role BYPASSRLS/)
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
    const bodies = [...source.matchAll(/\$([a-z_]+)\$([\s\S]*?)\$\1\$;/g)]
    assert.ok(bodies.length > 0)
    for (const [, , body] of bodies) assert.match(body.trim(), /END;$/)
  }
})
