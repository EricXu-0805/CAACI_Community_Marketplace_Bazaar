import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const bin = ['/opt/homebrew/opt/postgresql@17/bin', '/usr/lib/postgresql/17/bin'].find(p => existsSync(join(p, 'initdb')))
const owner = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
test('seller search follows public nickname changes, profile/item RLS and pagination; rollback restores product search', { skip: !bin && 'local PostgreSQL unavailable' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'seller-search-')), data = join(dir, 'data')
  const port = String(50000 + Math.floor(Math.random() * 10000))
  const run = (name, args, input) => execFileSync(join(bin, name), args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 })
  const sql = input => run('psql', ['-X', '-h', dir, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qtA'], input).trim()
  const anon = input => sql(`BEGIN; SET LOCAL ROLE anon; ${input}; ROLLBACK;`)
  run('initdb', ['-D', data, '-A', 'trust', '-U', 'postgres', '--locale=en_US.UTF-8', '-E', 'UTF8'])
  let started = false
  try {
    run('pg_ctl', ['-D', data, '-o', `-p ${port} -k ${dir} -c listen_addresses=''`, '-l', join(dir, 'pg.log'), '-w', 'start']); started = true
    sql(read('./listing-details.test.mjs').split('const setup=`')[1].split('\n`')[0])
    sql(`DELETE FROM items;
      ALTER TABLE profiles ADD PRIMARY KEY(id); ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
      CREATE POLICY public_profile ON profiles FOR SELECT USING(location IS DISTINCT FROM 'hidden');
      INSERT INTO profiles(id,nickname) VALUES('${owner}','MMT'),('${other}','Alexandra');
      INSERT INTO items(user_id,title,category,price,created_at) VALUES
      ('${owner}','pet carrier','electronics',120,'2026-09-16T12:00Z'),
      ('${owner}','standing desk','furniture',80,'2026-09-16T11:00Z'),
      ('${owner}','hidden listing','furniture',50,'2026-09-16T10:00Z'),
      ('${other}','coffee table','furniture',40,'2026-09-16T09:00Z');`)
    const old = read('../supabase/migrations/20260903030000_search_items_fuzzy_matches_translations.sql')
    sql(old.slice(old.indexOf('CREATE OR REPLACE FUNCTION')))
    for (const name of ['20260905184951_campus_location_search_alignment.sql', '20260905194646_structured_housing_rideshare_details.sql', '20260906091453_bounded_listing_search.sql', '20260914214912_cached_listing_search.sql']) {
      sql('BEGIN;' + read('../supabase/migrations/' + name) + 'COMMIT;')
    }
    const productResults = anon("SELECT jsonb_agg(to_jsonb(r)) FROM search_items_fuzzy_v2(ARRAY['desk']) r")
    const migration = read('../supabase/migrations/20260916195036_seller_name_search.sql')
    sql('BEGIN;' + migration + 'COMMIT;')
    for (const fn of ['search_items_fuzzy', 'search_items_fuzzy_v2']) {
      assert.equal(anon(`SELECT count(*) FROM ${fn}(ARRAY['MMT'])`), '2')
      assert.equal(anon(`SELECT title FROM ${fn}(ARRAY['mmt'],limit_in=>1,offset_in=>1)`), 'standing desk')
      assert.equal(anon(`SELECT title FROM ${fn}(ARRAY['Alexndra'])`), 'coffee table', 'nickname typos use native pg_trgm')
      assert.equal(anon(`SELECT count(*) FROM ${fn}(ARRAY['MMT'],price_max_in=>100)`), '1', 'filters apply before pagination')
      assert.equal(sql(`SELECT prosecdef FROM pg_proc WHERE oid='public.${fn}'::regproc`), 'f')
    }
    assert.equal(anon("SELECT jsonb_agg(to_jsonb(r)) FROM search_items_fuzzy_v2(ARRAY['desk']) r"), productResults)
    sql(`UPDATE profiles SET nickname='小林 campus' WHERE id='${owner}'`)
    assert.equal(anon("SELECT count(*) FROM search_items_fuzzy_v2(ARRAY['MMT'])"), '0', 'old nickname removed atomically')
    assert.equal(anon("SELECT count(*) FROM search_items_fuzzy_v2(ARRAY['小林'])"), '2')
    sql(`UPDATE profiles SET location='hidden' WHERE id='${owner}'`)
    assert.equal(anon("SELECT count(*) FROM search_items_fuzzy_v2(ARRAY['小林'])"), '0', 'cache cannot expose a hidden profile nickname')
    assert.equal(anon("SELECT count(*) FROM search_items_fuzzy_v2(ARRAY['carrier'])"), '1', 'independently visible product still searchable')
    assert.equal(anon("SELECT count(*) FROM search_private.seller_fields"), '1')
    assert.throws(() => anon("UPDATE search_private.seller_fields SET fields='{}'"), /permission denied/)
    assert.throws(() => anon("SELECT search_private.build_seller_fields('spoof')"), /permission denied/)
    sql(`UPDATE profiles SET location=null WHERE id='${owner}'; BEGIN; UPDATE profiles SET nickname='temporary' WHERE id='${owner}'; ROLLBACK;`)
    assert.equal(anon("SELECT count(*) FROM search_items_fuzzy_v2(ARRAY['temporary'])"), '0')
    assert.equal(anon("SELECT count(*) FROM search_items_fuzzy_v2(ARRAY['小林'])"), '2')
    sql(`INSERT INTO items(user_id,title,category,price) VALUES('${owner}','lamp','electronics',5)`)
    assert.equal(anon("SELECT count(*) FROM search_items_fuzzy_v2(ARRAY['小林'])"), '3', 'new listing needs no nickname fanout')
    const currentProductResults = anon("SELECT jsonb_agg(to_jsonb(r)) FROM search_items_fuzzy_v2(ARRAY['desk']) r")
    sql('BEGIN;' + read('../supabase/_ops/ROLLBACK_20260916_seller_name_search.sql') + 'COMMIT;')
    assert.equal(anon("SELECT count(*) FROM search_items_fuzzy_v2(ARRAY['小林'])"), '0')
    assert.equal(anon("SELECT jsonb_agg(to_jsonb(r)) FROM search_items_fuzzy_v2(ARRAY['desk']) r"), currentProductResults)
    sql('BEGIN;' + migration + 'COMMIT;')
    assert.equal(anon("SELECT count(*) FROM search_items_fuzzy_v2(ARRAY['小林'])"), '3')
    sql(`DELETE FROM profiles WHERE id='${owner}'`)
    assert.equal(sql(`SELECT count(*) FROM search_private.seller_fields WHERE profile_id='${owner}'`), '0')
  } finally {
    try { if (started) run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']) }
    finally { rmSync(dir, { recursive: true, force: true }) }
  }
})
