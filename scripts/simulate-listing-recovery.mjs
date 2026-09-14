#!/usr/bin/env node
// Local, synthetic recovery drill. No hosted credentials or production data.
// This proves the listing fixture can be restored with its privileges; it is
// deliberately not a full Supabase/auth/storage disaster-recovery acceptance.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'

const bin = ['/opt/homebrew/opt/postgresql@17/bin', '/usr/lib/postgresql/17/bin'].find(p => existsSync(join(p, 'initdb')))
assert.ok(bin, 'PostgreSQL 17 is required; no silent skip')
const dir = mkdtempSync(join(tmpdir(), 'illini-recovery-'))
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8')
const hash = text => createHash('sha256').update(text).digest('hex')
const run = (name, args, input) => execFileSync(join(bin, name), args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 })
const clusters = ['source', 'restored'].map((name, index) => ({ name, data: join(dir, name), port: String(54001 + index) }))
const connection = c => ['-h', dir, '-p', c.port, '-U', 'postgres', '-d', 'postgres']
const sql = (c, input) => run('psql', [...connection(c), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], input).trim()
const asUser = (c, input) => sql(c, `BEGIN; SET LOCAL ROLE authenticated; ${input}; ROLLBACK;`)
const started = []
const receipt = { scope: 'local synthetic listing schema, real repository migrations including private search cache, logical dump/restore', production: false, rows: 10001 }
try {
  for (const c of clusters) {
    run('initdb', ['-D', c.data, '-A', 'trust', '-U', 'postgres', '--locale=en_US.UTF-8', '--locale-provider=icu', '--icu-locale=en-US', '-E', 'UTF8'])
    run('pg_ctl', ['-D', c.data, '-o', `-p ${c.port} -k ${dir} -c listen_addresses=''`, '-l', join(dir, `${c.name}.log`), '-w', 'start'])
    started.push(c)
  }
  const [source, restored] = clusters
  sql(source, read('./listing-details.test.mjs').split('const setup=`')[1].split('\n`')[0])
  const old = read('../supabase/migrations/20260903030000_search_items_fuzzy_matches_translations.sql')
  sql(source, old.slice(old.indexOf('CREATE OR REPLACE FUNCTION')))
  for (const migration of ['20260905184951_campus_location_search_alignment.sql', '20260905194646_structured_housing_rideshare_details.sql', '20260906091453_bounded_listing_search.sql']) {
    sql(source, read(`../supabase/migrations/${migration}`))
  }
  sql(source, `INSERT INTO items(title,description,category,price,user_id,location)
    SELECT CASE WHEN n%10=0 THEN 'hidden listing' ELSE 'desk '||n END,
      'Synthetic desk for recovery testing', 'furniture', n,
      '11111111-1111-4111-8111-111111111111', 'Illini Union'
    FROM generate_series(1,10000) n; ANALYZE items;`)
  sql(source, 'BEGIN;' + read('../supabase/migrations/20260914214912_cached_listing_search.sql') + 'COMMIT;')
  const snapshot = c => ({
    rows: sql(c, "SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(i) ORDER BY id),'[]')::text,'UTF8')),'hex') FROM items i"),
    policies: hash(sql(c, "SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE schemaname IN ('public','search_private')")),
    privileges: hash(sql(c, "SELECT jsonb_agg(to_jsonb(t) ORDER BY grantee,table_name,privilege_type) FROM information_schema.role_table_grants t WHERE table_schema IN ('public','search_private')")),
    functions: hash(sql(c, "SELECT jsonb_agg(jsonb_build_object('name',p.oid::regprocedure::text,'def',pg_get_functiondef(p.oid),'acl',p.proacl) ORDER BY p.oid::regprocedure::text) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private','search_private')")),
    cache: sql(c, "SELECT md5(string_agg(to_jsonb(f)::text,'|' ORDER BY item_id)) FROM search_private.item_fields f"),
    ranked: hash(asUser(c, "SELECT jsonb_agg(to_jsonb(r)) FROM search_items_fuzzy_v2(ARRAY['desk','书桌'],limit_in=>20) r")),
    visible: Number(asUser(c, 'SELECT count(*) FROM items')),
  })
  const before = snapshot(source)
  const archive = join(dir, 'listing.dump')
  run('pg_dump', [...connection(source), '-Fc', '-f', archive])
  // Roles are cluster-level and do not travel in a database dump. Provision
  // the same non-login roles explicitly before restoring their object ACLs.
  sql(restored, 'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;')
  const begin = performance.now()
  run('pg_restore', [...connection(restored), '--exit-on-error', archive])
  receipt.restoreMs = Math.round(performance.now() - begin)
  assert.deepEqual(snapshot(restored), before, 'data, policies, ACLs and function definitions survive restore')
  sql(restored, read('../supabase/_ops/VERIFY_20260914_cached_listing_search.sql'))
  assert.equal(before.visible, 9001)
  assert.equal(asUser(restored, "SELECT count(*) FROM search_items_fuzzy_v2(ARRAY['hidden'])"), '0')
  assert.throws(() => asUser(restored, "INSERT INTO items(title,user_id,category,price) VALUES('intruder','22222222-2222-4222-8222-222222222222','furniture',5)"), /row-level security/)
  assert.throws(() => sql(restored, 'SET ROLE anon; DELETE FROM items;'), /permission denied/)
  assert.throws(() => asUser(restored, 'DELETE FROM search_private.item_fields'), /permission denied/)
  assert.equal(asUser(restored, 'SELECT count(*) FROM search_private.item_fields'), '9001')
  receipt.checks = { matchingSnapshot: before, hiddenRowsExcluded: true, foreignOwnerInsertDenied: true, anonymousDeleteDenied: true }
  receipt.dumpSha256 = hash(readFileSync(archive))
  receipt.dumpBytes = readFileSync(archive).length
  receipt.passed = true
} finally {
  for (const c of started.reverse()) run('pg_ctl', ['-D', c.data, '-m', 'immediate', '-w', 'stop'])
  rmSync(dir, { recursive: true, force: true })
}
receipt.cleanup = 'both disposable PostgreSQL clusters stopped; synthetic files removed'
console.log(JSON.stringify(receipt, null, 2))
