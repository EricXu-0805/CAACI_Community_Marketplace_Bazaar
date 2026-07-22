import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const MIGRATION = new URL(
  '../supabase/migrations/20260719082600_deterministic_admin_pagination_order.sql',
  import.meta.url,
)

const authoritativeSources = new Map([
  [
    'admin_list_reports_grouped',
    new URL('../supabase/migrations/074_report_dedup_and_grouping.sql', import.meta.url),
  ],
  [
    'admin_list_suspensions',
    new URL(
      '../supabase/migrations/20260718160000_reconcile_expired_suspension_visibility.sql',
      import.meta.url,
    ),
  ],
  [
    'admin_list_appeals',
    new URL(
      '../supabase/migrations/20260718160000_reconcile_expired_suspension_visibility.sql',
      import.meta.url,
    ),
  ],
  [
    'admin_list_audit_log',
    new URL('../supabase/migrations/031_admin_audit_log_table.sql', import.meta.url),
  ],
  [
    'admin_list_plaza_posts',
    new URL('../supabase/migrations/083_admin_plaza_controls.sql', import.meta.url),
  ],
])

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function functionDefinition(source, name) {
  const startNeedle = `CREATE OR REPLACE FUNCTION public.${name}(`
  const start = source.indexOf(startNeedle)
  assert.notEqual(start, -1, `${name}: definition missing`)
  const tail = source.slice(start)
  const delimiterMatch = /\bAS\s+(\$[a-zA-Z0-9_]*\$)/.exec(tail)
  assert.ok(delimiterMatch, `${name}: SQL body delimiter missing`)
  const delimiter = delimiterMatch[1]
  const bodyStart = delimiterMatch.index + delimiterMatch[0].length
  const bodyEnd = tail.indexOf(`${delimiter};`, bodyStart)
  assert.notEqual(bodyEnd, -1, `${name}: SQL body terminator missing`)
  return tail.slice(0, bodyEnd + delimiter.length + 1)
}

function normalizedSql(source) {
  return source.replace(/\s+/g, ' ').trim()
}

function removeOnlyExpectedTieBreakers(name, source) {
  const replacements = {
    admin_list_reports_grouped: [
      [
        /array_agg\(r\.id\s+ORDER BY\s+r\.created_at\s+DESC,\s*r\.id\s+DESC\)/,
        'array_agg(r.id ORDER BY r.created_at DESC)',
      ],
      [
        /ORDER BY\s+g\.pending_count\s+DESC,\s*g\.first_created_at\s+ASC,\s*g\.target_type\s+ASC,\s*g\.target_id\s+ASC/,
        'ORDER BY g.pending_count DESC, g.first_created_at ASC',
      ],
    ],
    admin_list_suspensions: [[
      /ORDER BY\s+suspension\.created_at\s+DESC,\s*suspension\.id\s+DESC/,
      'ORDER BY suspension.created_at DESC',
    ]],
    admin_list_appeals: [[
      /ORDER BY\s+suspension\.created_at\s+DESC,\s*suspension\.id\s+DESC/,
      'ORDER BY suspension.created_at DESC',
    ]],
    admin_list_audit_log: [[
      /ORDER BY\s+l\.created_at\s+DESC,\s*l\.id\s+DESC/,
      'ORDER BY l.created_at DESC',
    ]],
    admin_list_plaza_posts: [[
      /ORDER BY\s+p\.is_pinned\s+DESC,\s*p\.created_at\s+DESC,\s*p\.id\s+DESC/,
      'ORDER BY p.is_pinned DESC, p.created_at DESC',
    ]],
  }

  let downgraded = source
  for (const [pattern, replacement] of replacements[name]) {
    assert.match(downgraded, pattern, `${name}: expected tie-breaker missing`)
    downgraded = downgraded.replace(pattern, replacement)
  }
  return downgraded
}

test('admin pagination tail changes only the five intended function order clauses', async () => {
  const migration = await readFile(MIGRATION, 'utf8')

  for (const [name, sourceUrl] of authoritativeSources) {
    const authoritative = await readFile(sourceUrl, 'utf8')
    const currentDefinition = functionDefinition(migration, name)
    const previousDefinition = functionDefinition(authoritative, name)
    assert.equal(
      normalizedSql(removeOnlyExpectedTieBreakers(name, currentDefinition)),
      normalizedSql(previousDefinition),
      `${name}: projection, filter, limit, signature or execution contract drifted`,
    )
  }

  assert.equal(
    [...migration.matchAll(/CREATE OR REPLACE FUNCTION public\.admin_list_/g)].length,
    authoritativeSources.size,
  )
  assert.doesNotMatch(migration, /CREATE\s+(?:UNIQUE\s+)?INDEX|ALTER\s+TABLE|DROP\s+FUNCTION/i)
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.admin_list_warnings\b/)
})

test('all replaced pagination functions remain service-role-only and transactional', async () => {
  const migration = await readFile(MIGRATION, 'utf8')
  assert.match(migration, /^BEGIN;$/m)
  assert.match(migration, /^SET LOCAL lock_timeout = '5s';$/m)
  assert.match(migration, /^SET LOCAL statement_timeout = '2min';$/m)
  assert.equal(migration.trimEnd().split(/\r?\n/).at(-1), 'COMMIT;')

  for (const name of authoritativeSources.keys()) {
    const escapedName = escapeRegExp(name)
    assert.match(
      migration,
      new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${escapedName}\\([^;]+?\\)\\s+FROM PUBLIC, anon, authenticated, service_role;`,
      ),
      `${name}: explicit deny boundary missing`,
    )
    assert.match(
      migration,
      new RegExp(
        `GRANT EXECUTE ON FUNCTION public\\.${escapedName}\\([^;]+?\\)\\s+TO service_role;`,
      ),
      `${name}: service-role grant missing`,
    )
  }
})

test('read-only operational gates verify both total order and exact ACLs', async () => {
  const [precheck, verify] = await Promise.all([
    readFile(
      new URL(
        '../supabase/_ops/PRECHECK_20260719082600_deterministic_admin_pagination_order.sql',
        import.meta.url,
      ),
      'utf8',
    ),
    readFile(
      new URL(
        '../supabase/_ops/VERIFY_20260719082600_deterministic_admin_pagination_order.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  ])

  assert.match(precheck, /20260719030000 release-tail indexes are missing/)
  assert.match(precheck, /pagination unique key drifted/)
  assert.match(verify, /array_agg\(r\.id order by r\.created_at desc, r\.id desc\)/)
  assert.match(
    verify,
    /order by g\.pending_count desc, g\.first_created_at asc, g\.target_type asc, g\.target_id asc/,
  )
  for (const order of [
    'order by suspension.created_at desc, suspension.id desc',
    'order by l.created_at desc, l.id desc',
    'order by p.is_pinned desc, p.created_at desc, p.id desc',
  ]) {
    assert.match(verify, new RegExp(escapeRegExp(order)))
  }
  assert.match(verify, /expanded_acl\.grantee = 0/)
  assert.match(verify, /expanded_acl\.grantee = service_role_oid/)
})
