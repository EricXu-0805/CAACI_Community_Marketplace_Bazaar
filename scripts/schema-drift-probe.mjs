#!/usr/bin/env node
/*
 * Emit a read-only SQL probe that answers "is every object this repository
 * declares actually present in a target database?"
 *
 * Why not just compare supabase_migrations.schema_migrations against the
 * filenames: because on this project that ledger is incomplete. Several
 * migrations were applied through the Management API `/database/query`
 * endpoint, which executes the SQL but writes no ledger row — 2026-08-06
 * spot checks found guard_moderation_status, admin_search_users and
 * admin_takedown_content all live in production while migrations 073/077/088
 * are absent from its ledger. A ledger diff therefore reports drift that does
 * not exist and would hide drift that does.
 *
 * So this walks the migrations in order and simulates the declared end state:
 * a CREATE adds an object, a matching DROP removes it. What survives is what
 * the repository claims the database should contain right now. The generated
 * query returns only the rows that are MISSING, so an empty result is the
 * pass condition.
 *
 * The probe is pure SELECT against pg_catalog. It reads no application data
 * and takes no credential — pipe it into the Supabase SQL editor, psql, or an
 * MCP execute_sql call:
 *
 *   node scripts/schema-drift-probe.mjs > /tmp/probe.sql
 *
 * Limits worth knowing before trusting a clean run: this matches object names
 * with regexes, not a SQL parser. It sees CREATE/DROP of functions, triggers,
 * tables, views, indexes, policies and named constraints. It does not compare
 * function bodies, column sets, grants or RLS predicates, so an object that
 * exists but has drifted internally still reads as present.
 */
import { readdir, readFile } from 'node:fs/promises'

const MIGRATIONS_DIR = new URL('../supabase/migrations/', import.meta.url)

/*
 * [kind, create pattern, drop pattern]. Each pattern captures an optional
 * schema in group 1 and the object name in group 2; an absent schema means
 * `public`. Carrying the schema matters: `private.item_deals` is a real table
 * in production that a public-only probe reports as missing, which is how this
 * bug was found. Quoted identifiers keep their inner text, so
 * `CREATE POLICY "x y"` matches the policy named `x y`.
 *
 * Triggers, policies and constraints are named per parent relation rather than
 * per schema, so their schema group stays empty and the SQL matches on name
 * across schemas. That is deliberately loose: it can only produce false
 * passes, never false alarms.
 */
const SCHEMA = '(?:"?([A-Za-z0-9_]+)"?\\.)?'
const rule = (kind, create, drop) => [kind, new RegExp(create, 'gi'), new RegExp(drop, 'gi')]

const RULES = [
  rule(
    'function',
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+${SCHEMA}"?([A-Za-z0-9_]+)"?\\s*\\(`,
    `DROP\\s+FUNCTION\\s+(?:IF\\s+EXISTS\\s+)?${SCHEMA}"?([A-Za-z0-9_]+)"?`,
  ),
  rule(
    'trigger',
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:CONSTRAINT\\s+)?TRIGGER\\s+()"?([A-Za-z0-9_]+)"?`,
    `DROP\\s+TRIGGER\\s+(?:IF\\s+EXISTS\\s+)?()"?([A-Za-z0-9_]+)"?`,
  ),
  rule(
    'table',
    `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${SCHEMA}"?([A-Za-z0-9_]+)"?`,
    `DROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?${SCHEMA}"?([A-Za-z0-9_]+)"?`,
  ),
  rule(
    'view',
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:MATERIALIZED\\s+)?VIEW\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${SCHEMA}"?([A-Za-z0-9_]+)"?`,
    `DROP\\s+(?:MATERIALIZED\\s+)?VIEW\\s+(?:IF\\s+EXISTS\\s+)?${SCHEMA}"?([A-Za-z0-9_]+)"?`,
  ),
  rule(
    'index',
    `CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?${SCHEMA}"?([A-Za-z0-9_]+)"?\\s+ON`,
    `DROP\\s+INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+EXISTS\\s+)?${SCHEMA}"?([A-Za-z0-9_]+)"?`,
  ),
  rule('policy', `CREATE\\s+POLICY\\s+()"?([^"\\n]+?)"?\\s+ON`, `DROP\\s+POLICY\\s+(?:IF\\s+EXISTS\\s+)?()"?([^"\\n]+?)"?\\s+ON`),
  rule('constraint', `ADD\\s+CONSTRAINT\\s+()"?([A-Za-z0-9_]+)"?`, `DROP\\s+CONSTRAINT\\s+(?:IF\\s+EXISTS\\s+)?()"?([A-Za-z0-9_]+)"?`),
]

/*
 * Objects the repository declares but a healthy database is expected NOT to
 * have yet. Every entry needs a reason and an exit condition, because this is
 * the only place a real gap can hide.
 */
const IGNORED = new Map([
  [
    JSON.stringify(['function', 'public', 'delete_wechat_password_credential']),
    'Created only by 20260718140000_retire_wechat_password_credentials.sql, ' +
      'which is deliberately unapplied (master doc P2-03: the retirement needs a ' +
      'real passwordless canary first). api/auth/delete-account.js sweepWechatPassword ' +
      'handles its absence explicitly — a 404 with PGRST202/42883 falls back to the ' +
      'legacy table DELETE and nothing else downgrades. Drop this entry once that ' +
      'migration is applied.',
  ],
])

const keyOf = (kind, m) => JSON.stringify([kind, (m[1] || '').trim(), m[2].trim()])

/*
 * Comments are prose and routinely contain DDL fragments. Two real examples
 * from this repository: "CREATE TABLE IF NOT EXISTS must not silently accept"
 * yielded a table named `must`, and "If CREATE TRIGGER ON storage.objects
 * raises" yielded a trigger named `ON`. Both would be reported as permanently
 * missing. Strip comments before matching rather than blocklisting the
 * keywords that happen to have leaked so far.
 */
function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}

function collect(rawSql, declared) {
  const sql = stripComments(rawSql)
  for (const [kind, createRe, dropRe] of RULES) {
    for (const m of sql.matchAll(createRe)) declared.add(keyOf(kind, m))
    for (const m of sql.matchAll(dropRe)) {
      // A DROP followed by a CREATE in the same file is a replace, not a
      // removal; creates are collected first for exactly that reason, so only
      // honour the drop when the file never recreated the object.
      const name = m[2].trim()
      const recreated = new RegExp(
        `${kind === 'constraint' ? 'ADD\\s+CONSTRAINT' : `CREATE[^;]*?\\b${kind}\\b`}[^;]*?${name}`,
        'is',
      ).test(sql)
      if (!recreated) declared.delete(keyOf(kind, m))
    }
  }
}

const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()
const declared = new Set()
for (const file of files) {
  collect(await readFile(new URL(file, MIGRATIONS_DIR), 'utf8'), declared)
}

const rows = [...declared]
  .filter((key) => !IGNORED.has(key))
  .sort()
  .map((key) => {
    const [kind, schema, rawName] = JSON.parse(key)
    const name = rawName.replace(/'/g, "''")
    return `('${kind}','${schema || 'public'}','${name}')`
  })

process.stdout.write(`-- Generated by scripts/schema-drift-probe.mjs from ${files.length} migrations.
-- Read-only. Returns one row per object the repository declares but the target
-- database does not have. An empty result is the pass condition.
--
-- Relation kinds accept partitioned forms ('p' beside 'r', 'I' beside 'i') and
-- a view matches either an ordinary or a materialized view: the repository does
-- not record which one it asked for, and either satisfies "the object is there".
with declared(kind, schema, name) as (values
  ${rows.join(',\n  ')}
)
select d.kind, d.schema, d.name
from declared d
where not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where d.kind = 'function' and n.nspname = d.schema and p.proname = d.name
) and not exists (
  select 1 from pg_trigger t where d.kind = 'trigger' and not t.tgisinternal and t.tgname = d.name
) and not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where d.kind in ('table','view','index') and n.nspname = d.schema and c.relname = d.name
    and c.relkind = any(case d.kind
      when 'table' then array['r','p']
      when 'view' then array['v','m']
      else array['i','I'] end)
) and not exists (
  select 1 from pg_policies where d.kind = 'policy' and policyname = d.name
) and not exists (
  select 1 from pg_constraint where d.kind = 'constraint' and conname = d.name
)
order by d.kind, d.schema, d.name;
`)
