import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const migrationName = '20260722080918_optimize_auth_rls_initplans.sql'
const root = new URL('../', import.meta.url)
const source = path => readFile(new URL(path, root), 'utf8')

const expectedPolicies = [
  ['items', 'Authenticated users can create items', 1, 'user_id'],
  ['items', 'Users can update own items', 2, 'user_id'],
  ['items', 'Users can delete own items', 1, 'user_id'],
  ['favorites', 'Users can view own favorites', 1, 'user_id'],
  ['favorites', 'Users can add favorites', 1, 'user_id'],
  ['favorites', 'Users can remove favorites', 1, 'user_id'],
  ['reports', 'Users can create reports', 1, 'reporter_id'],
  ['reports', 'Users can view own reports', 1, 'reporter_id'],
  ['notifications', 'Users read own notifications', 1, 'user_id'],
  ['notifications', 'Users update own notifications', 2, 'user_id'],
  ['notifications', 'Users delete own notifications', 1, 'user_id'],
  ['profiles', 'Users can update own profile', 2, 'id'],
  ['post_comments', 'Authenticated users can comment', 1, 'user_id'],
  ['post_comments', 'Users can update own comments', 2, 'user_id'],
  ['post_comments', 'Users can delete own comments', 1, 'user_id'],
  ['post_likes', 'Users can like', 1, 'user_id'],
  ['post_likes', 'Users can unlike', 1, 'user_id'],
  ['follows', 'Users can follow', 1, 'follower_id'],
  ['follows', 'Users can unfollow', 1, 'follower_id'],
  ['saved_searches', 'Users read own saved searches', 1, 'user_id'],
  ['saved_searches', 'Users create own saved searches', 1, 'user_id'],
  ['saved_searches', 'Users delete own saved searches', 1, 'user_id'],
  ['suspensions', 'suspensions_self_read', 1, 'profile_id'],
  ['device_fingerprints', 'dfp_self_read', 1, 'profile_id'],
  ['post_comment_likes', 'Users can like comments', 1, 'user_id'],
  ['post_comment_likes', 'Users can unlike comments', 1, 'user_id'],
  ['posts', 'Authenticated users can create posts', 1, 'user_id'],
  ['posts', 'Users can update own posts', 2, 'user_id'],
  ['posts', 'Users can delete own posts', 1, 'user_id'],
  ['post_items', 'Post owner can attach own items', 3, null],
  ['post_items', 'Post owner can detach items', 2, null],
]

function alterPolicyBlocks(migration) {
  const starts = [...migration.matchAll(/^ALTER POLICY /gm)]
    .map(match => match.index)
  return starts.map(start => {
    const end = migration.indexOf(';', start)
    assert.ok(end > start, `unterminated ALTER POLICY at byte ${start}`)
    return migration.slice(start, end + 1)
  })
}

function parsedTarget(block) {
  const match = /^ALTER POLICY "([^"]+)"\s+ON public\.([a-z_]+)/m.exec(block)
  assert.ok(match, `unparseable ALTER POLICY block: ${block.slice(0, 100)}`)
  return { policy: match[1], table: match[2] }
}

test('forward migration alters the exact advisor inventory without widening roles or commands', async () => {
  const migration = await source(`supabase/migrations/${migrationName}`)
  const blocks = alterPolicyBlocks(migration)

  assert.match(migration, /^BEGIN;$/m)
  assert.match(migration, /^SET LOCAL lock_timeout = '5s';$/m)
  assert.match(migration, /^SET LOCAL statement_timeout = '2min';$/m)
  assert.equal(migration.trimEnd().endsWith('COMMIT;'), true)
  assert.equal(blocks.length, 31)
  assert.doesNotMatch(migration, /^\s*(?:DROP|CREATE) POLICY\b/im)
  assert.doesNotMatch(migration, /SECURITY DEFINER|pg_trgm/i)

  const actualTargets = blocks
    .map(parsedTarget)
    .map(({ table, policy }) => `${table}\u0000${policy}`)
    .sort()
  const expectedTargets = expectedPolicies
    .map(([table, policy]) => `${table}\u0000${policy}`)
    .sort()
  assert.deepEqual(actualTargets, expectedTargets)
  assert.equal(new Set(actualTargets).size, 31)

  for (const block of blocks) {
    assert.doesNotMatch(
      block,
      /\bTO\b/i,
      `${parsedTarget(block).table}.${parsedTarget(block).policy}: ALTER POLICY must preserve roles`,
    )
  }
})

test('all 39 row-independent auth calls are wrapped and retain ownership predicates', async () => {
  const migration = await source(`supabase/migrations/${migrationName}`)
  const blocks = alterPolicyBlocks(migration)
  const byTarget = new Map(blocks.map(block => {
    const { table, policy } = parsedTarget(block)
    return [`${table}\u0000${policy}`, block]
  }))

  let totalUidCalls = 0
  for (const [table, policy, expectedCalls, ownerColumn] of expectedPolicies) {
    const block = byTarget.get(`${table}\u0000${policy}`)
    assert.ok(block, `missing ${table}.${policy}`)
    const wrapped = block.match(/\(SELECT auth\.uid\(\)\)/g) || []
    assert.equal(wrapped.length, expectedCalls, `${table}.${policy}: uid call count`)
    totalUidCalls += wrapped.length

    const withoutWrapped = block.replaceAll('(SELECT auth.uid())', '')
    assert.doesNotMatch(
      withoutWrapped,
      /auth\.uid\(\)/,
      `${table}.${policy}: row-by-row auth.uid() remains`,
    )

    if (ownerColumn) {
      const ownerComparisons = block.match(
        new RegExp(`\\(SELECT auth\\.uid\\(\\)\\) = ${ownerColumn}\\b`, 'g'),
      ) || []
      assert.equal(
        ownerComparisons.length,
        expectedCalls,
        `${table}.${policy}: ownership column drift`,
      )
    }
  }
  assert.equal(totalUidCalls, 39)

  const createPost = byTarget.get('posts\u0000Authenticated users can create posts')
  const updatePost = byTarget.get('posts\u0000Users can update own posts')
  assert.match(createPost, /AND NOT is_official/)
  assert.match(updatePost, /AND NOT is_official[\s\S]*AND NOT is_pinned/)

  const attach = byTarget.get('post_items\u0000Post owner can attach own items')
  assert.match(attach, /\(SELECT auth\.uid\(\)\) IS NOT NULL/)
  assert.match(attach, /parent_post\.user_id = \(SELECT auth\.uid\(\)\)/)
  assert.match(attach, /parent_post\.status = 'active'/)
  assert.match(attach, /attached_item\.user_id = \(SELECT auth\.uid\(\)\)/)
  assert.match(attach, /attached_item\.status = 'active'::public\.item_status/)
  assert.match(attach, /COALESCE\([\s\S]*profile\.suspension_level[\s\S]*, 5\) < 2/)

  const detach = byTarget.get('post_items\u0000Post owner can detach items')
  assert.match(detach, /\(SELECT auth\.uid\(\)\) IS NOT NULL/)
  assert.match(detach, /parent_post\.user_id = \(SELECT auth\.uid\(\)\)/)
})

test('ops companions fail closed, preserve semantic fingerprints, and remain rollback-only', async () => {
  const [precheck, verify, regression] = await Promise.all([
    source('supabase/_ops/PRECHECK_20260722080918_optimize_auth_rls_initplans.sql'),
    source('supabase/_ops/VERIFY_20260722080918_optimize_auth_rls_initplans.sql'),
    source('supabase/_ops/REGRESSION_20260722080918_optimize_auth_rls_initplans.sql'),
  ])

  for (const operation of [precheck, verify]) {
    assert.match(operation, /^\\set ON_ERROR_STOP on$/m)
    assert.match(operation, /^BEGIN;$/m)
    assert.match(operation, /^SET TRANSACTION READ ONLY;$/m)
    assert.match(operation, /^SET LOCAL lock_timeout = '2s';$/m)
    assert.match(operation, /^SET LOCAL statement_timeout = '30s';$/m)
    assert.equal(operation.trimEnd().endsWith('ROLLBACK;'), true)
  }

  for (const operation of [precheck, verify]) {
    assert.match(operation, /target policy drift/)
    assert.match(
      operation,
      /(?:actual|measured)\.command IS DISTINCT FROM expected\.command/,
    )
    assert.match(
      operation,
      /(?:actual|measured)\.role_names IS DISTINCT FROM expected\.role_names/,
    )
    assert.match(operation, /get_my_profile\\\(\\\)profile/)
    assert.match(operation, /31 policies\/14 tables\/26 PUBLIC\/5 authenticated/)
  }
  assert.match(precheck, /39 raw uid\/0 InitPlan/)
  assert.match(verify, /39 uid\/39 InitPlan/)
  assert.match(verify, /using_expression IS DISTINCT FROM/)
  assert.match(verify, /check_expression IS DISTINCT FROM/)

  assert.match(regression, /^BEGIN;$/m)
  assert.doesNotMatch(regression, /^COMMIT;$/m)
  assert.equal(regression.trimEnd().endsWith('ROLLBACK;'), true)
  assert.match(regression, /raw_equality IS DISTINCT FROM cached_equality/)
  assert.match(regression, /raw_presence IS DISTINCT FROM cached_presence/)
  assert.match(regression, /EXPLAIN \(FORMAT JSON, COSTS OFF\)/)
  assert.match(regression, /pg_catalog\.strpos\(plan::text, 'InitPlan'\) = 0/)
  assert.match(regression, /SET LOCAL ROLE authenticated/)
  assert.match(regression, /RESET ROLE/)
})

test('migration manifest freezes the exact forward migration bytes', async () => {
  const [migration, manifest] = await Promise.all([
    source(`supabase/migrations/${migrationName}`),
    source('supabase/migrations/manifest.sha256'),
  ])
  const hash = createHash('sha256').update(migration).digest('hex')
  assert.match(manifest, new RegExp(`^${hash}  ${migrationName}$`, 'm'))
})
