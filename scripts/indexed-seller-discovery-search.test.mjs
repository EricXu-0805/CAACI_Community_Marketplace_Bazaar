import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const bin = ['/opt/homebrew/opt/postgresql@17/bin', '/usr/lib/postgresql/17/bin'].find(p => existsSync(join(p, 'initdb')))
const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222'
test('indexed seller discovery search keeps exact ranking, feedback visibility and live updates', { skip: !bin && 'local PostgreSQL unavailable' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'discovery-')), data = join(dir, 'data'), port = String(50000 + Math.floor(Math.random() * 10000))
  const run = (name, args, input) => execFileSync(join(bin, name), args, { input, encoding: 'utf8', stdio: ['pipe','pipe','pipe'], timeout: 60000 })
  const sql = input => run('psql', ['-X','-h',dir,'-p',port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-qtA'], input).trim()
  const as = (uid, query) => sql(`BEGIN; SET LOCAL ROLE ${uid ? 'authenticated' : 'anon'}; SET LOCAL request.jwt.claim.sub='${uid || ''}'; ${query}; COMMIT;`)
  run('initdb', ['-D',data,'-A','trust','-U','postgres','--locale=en_US.UTF-8','-E','UTF8'])
  let started = false
  try {
    run('pg_ctl', ['-D',data,'-o',`-p ${port} -k ${dir} -c listen_addresses=''`,'-l',join(dir,'pg.log'),'-w','start']); started = true
    sql(read('./listing-details.test.mjs').split('const setup=`')[1].split('\n`')[0])
    sql(`DELETE FROM items; ALTER TABLE profiles ADD PRIMARY KEY(id);
      CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon,authenticated;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE TABLE blocks(blocker_id uuid,blocked_id uuid);
      INSERT INTO profiles(id,nickname) VALUES('${a}','MMT'),('${b}','Alexandra');
      INSERT INTO items(user_id,title,category,price,location,created_at) SELECT
       CASE WHEN n<=80 THEN '${a}'::uuid ELSE '${b}'::uuid END, 'campus desk '||n,
       CASE WHEN n%2=0 THEN 'electronics'::item_category ELSE 'furniture'::item_category END,
       n,'Illini Union',now()-n*interval '1 hour' FROM generate_series(1,100) n;`)
    const old = read('../supabase/migrations/20260903030000_search_items_fuzzy_matches_translations.sql')
    sql(old.slice(old.indexOf('CREATE OR REPLACE FUNCTION')))
    for (const name of ['20260905184951_campus_location_search_alignment.sql','20260905194646_structured_housing_rideshare_details.sql','20260906091453_bounded_listing_search.sql','20260914214912_cached_listing_search.sql']) sql('BEGIN;' + read('../supabase/migrations/' + name) + 'COMMIT;')
    // Reproduce the actual production prerequisite, which was deployed through
    // the reviewed ops bundle rather than the timestamped migration directory.
    sql('BEGIN;'+read('../supabase/_ops/indexed_search_candidate/fields.sql')+read('../supabase/_ops/indexed_search_candidate/query.sql')+'COMMIT;')
    const baselineQuery = sql("SELECT pg_get_functiondef('public.search_items_fuzzy_v2(text[],item_category,item_condition,numeric,numeric,uuid,text,integer,integer,text,boolean,date,text)'::regprocedure)")
    for (const name of ['20260916195036_seller_name_search.sql','20260916195510_discovery_preferences.sql','20260916224000_keep_listing_profile_embed_unambiguous.sql']) sql('BEGIN;' + read('../supabase/migrations/' + name) + 'COMMIT;')
    sql('BEGIN;' + read('../supabase/migrations/20260916224000_keep_listing_profile_embed_unambiguous.sql') + 'COMMIT;')
    assert.equal(sql("SELECT string_agg(a.attname,',') FROM pg_constraint c CROSS JOIN LATERAL unnest(c.conkey) k(n) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.n WHERE c.conrelid='public.hidden_items'::regclass AND c.contype='p'"),'id')
    const oracle=read('../supabase/migrations/20260916195510_discovery_preferences.sql').split('CREATE OR REPLACE FUNCTION public.search_items_fuzzy_v2')[1].split('CREATE OR REPLACE FUNCTION public.search_items_fuzzy(')[0];
    sql('CREATE OR REPLACE FUNCTION public.feedback_search_oracle_v2'+oracle);
    sql('BEGIN;' + read('../supabase/migrations/20260916230000_preserve_indexed_seller_discovery_search.sql') + 'COMMIT;')
    for(const query of ["ARRAY['desk']","ARRAY['camra']","ARRAY['MMT']","ARRAY['campus','desk']","ARRAY['%']","ARRAY['desk'],price_max_in=>10"]){
      const rows=rpc=>as(b,`SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM ${rpc}(${query}) r`);
      assert.equal(rows('search_items_fuzzy_v2'),rows('feedback_search_oracle_v2'));
    }
    const integrationSql=read('../supabase/migrations/20260916230000_preserve_indexed_seller_discovery_search.sql');
    sql('BEGIN;'+integrationSql+'COMMIT;'); // existing production-index path
    sql("UPDATE profiles SET nickname='DistinctRenameProbe' WHERE id='"+a+"'");
    assert.equal(as(b,"SELECT count(*) FROM search_items_fuzzy_v2(ARRAY['DistinctRenameProbe'],limit_in=>100)"),'80');
    assert.equal(as(b,"SELECT count(*) FROM search_items_fuzzy_v2(ARRAY['MMT'],limit_in=>100)"),'0');
    sql("UPDATE items SET description='new description' WHERE user_id='"+a+"'");
    assert.equal(as(b,"SELECT count(*) FROM search_items_fuzzy_v2(ARRAY['DistinctRenameProbe'],limit_in=>100)"),'80');
    sql("UPDATE profiles SET nickname='MMT' WHERE id='"+a+"'");
    const result=as(b,"SELECT jsonb_agg(to_jsonb(r)) FROM search_items_fuzzy_v2(ARRAY['MMT']) r");
    sql('BEGIN;'+read('../supabase/_ops/ROLLBACK_20260916_preserve_indexed_seller_discovery_search.sql')+'COMMIT;');
    sql('BEGIN;'+integrationSql+'COMMIT;');
    assert.equal(as(b,"SELECT jsonb_agg(to_jsonb(r)) FROM search_items_fuzzy_v2(ARRAY['MMT']) r"),result);
    const first = sql("SELECT id FROM items ORDER BY created_at DESC LIMIT 1")
    assert.throws(() => as(a, `INSERT INTO hidden_items(user_id,item_id) VALUES('${b}','${first}')`), /account_changed|row-level security/)
    assert.throws(() => as(a, `INSERT INTO hidden_items(user_id,item_id) VALUES('${a}','${first}')`), /row-level security/, 'cannot hide own listings')
    as(b, `INSERT INTO hidden_items(user_id,item_id) VALUES('${b}','${first}')`)
    assert.throws(() => as(b, `INSERT INTO hidden_items(user_id,item_id) VALUES('${b}','${first}')`), /duplicate key/)
    assert.equal(as(a, 'SELECT count(*) FROM hidden_items'), '0')
    assert.equal(as(null, 'SELECT count(*) FROM hidden_items'), '0')
    assert.equal(as(b, 'SELECT count(*) FROM hidden_items'), '1')
    assert.equal(as(b, `SELECT count(*) FROM browse_listing_ids() WHERE id='${first}'`), '0')
    assert.equal(as(b, 'SELECT count(*) FROM browse_listing_ids(limit_in=>20)'), '20', 'hidden exclusion precedes page limit')
    assert.equal(as(b, `SELECT count(*) FROM search_items_fuzzy_v2(ARRAY['MMT'],limit_in=>100) WHERE id='${first}'`), '0')
    assert.equal(as(a, `SELECT count(*) FROM search_items_fuzzy_v2(ARRAY['MMT'],limit_in=>100) WHERE id='${first}'`), '1', 'feedback does not alter other viewers')
    assert.equal(as(b, `SELECT count(*) FROM items WHERE id='${first}'`), '1', 'hidden is a feed preference, not a direct-link access rule')
    const suggestions = JSON.parse(as(b, "SELECT jsonb_agg(to_jsonb(r)) FROM browse_listing_ids(sort_in=>'recommended',categories_in=>ARRAY['furniture']::item_category[]) r"))
    assert.equal(suggestions.length, 99)
    assert.equal(suggestions[0].reason, 'interest')
    const sellers = suggestions.slice(0,2).map(row => sql(`SELECT user_id FROM items WHERE id='${row.id}'`))
    assert.notEqual(sellers[0], sellers[1], 'one prolific seller cannot occupy both first slots')
    assert.deepEqual(JSON.parse(as(b, "SELECT jsonb_agg(to_jsonb(r)) FROM browse_listing_ids(sort_in=>'recommended',categories_in=>ARRAY['furniture']::item_category[]) r")), suggestions)
    assert.equal(as(b, "SELECT count(*) FROM browse_listing_ids(location_in=>'UIUC',price_max_in=>10)"), '9')
    assert.equal(as(b, "SELECT count(*) FROM browse_listing_ids(location_in=>'Urbana')"), '0')
    assert.throws(() => as(b, "SELECT * FROM browse_listing_ids(categories_in=>ARRAY['furniture','furniture','furniture','furniture']::item_category[])"), /invalid_discovery_input/)
    sql(`INSERT INTO blocks VALUES('${a}','${b}')`)
    assert.equal(as(b, `SELECT count(*) FROM browse_listing_ids(user_id_in=>'${a}')`), '0', 'both block directions apply before retrieval')
    assert.equal(as(b, "SELECT count(*) FROM search_items_fuzzy_v2(ARRAY['MMT'])"), '0')
    sql('DELETE FROM blocks')
    as(b, `DELETE FROM hidden_items WHERE item_id='${first}'`)
    assert.equal(as(b, `SELECT count(*) FROM browse_listing_ids() WHERE id='${first}'`), '1')
    sql(`INSERT INTO items(user_id,title,category) SELECT '${a}','capacity desk '||n,'furniture' FROM generate_series(1,1001) n`)
    as(b, `INSERT INTO hidden_items(user_id,item_id) SELECT '${b}',id FROM items WHERE title LIKE 'capacity desk %' ORDER BY id LIMIT 1000`)
    assert.throws(() => as(b, `INSERT INTO hidden_items(user_id,item_id) SELECT '${b}',id FROM items WHERE title LIKE 'capacity desk %' AND id NOT IN(SELECT item_id FROM hidden_items) LIMIT 1`), /hidden_item_limit/)
    assert.equal(as(b, "SELECT count(*) FROM browse_listing_ids(sort_in=>'recommended',categories_in=>ARRAY['furniture']::item_category[])"), '101', 'candidate bounds exclude hidden rows before limiting')
    sql('BEGIN;' + read('../supabase/_ops/ROLLBACK_20260916_discovery_preferences.sql') + 'COMMIT;')
    assert.equal(sql('SELECT count(*) FROM hidden_items'), '1000', 'rollback retains private choices')
    assert.throws(() => as(b, 'SELECT * FROM hidden_items'), /permission denied/)
    sql('BEGIN;' + read('../supabase/migrations/20260916195510_discovery_preferences.sql') + 'COMMIT;')
    assert.equal(as(b, 'SELECT count(*) FROM hidden_items'), '1000', 'forward reinstall retains choices and restores access')
    sql('BEGIN;'+integrationSql+'COMMIT;')
    const rollbackPaths = ['ROLLBACK_20260916_preserve_indexed_seller_discovery_search.sql','ROLLBACK_20260916_discovery_preferences.sql','ROLLBACK_20260916_seller_name_search.sql','indexed_search_candidate/query.sql']
    sql('BEGIN;'+rollbackPaths.map(path=>read('../supabase/_ops/'+path)).join('\n')+'COMMIT;')
    assert.equal(sql("SELECT pg_get_functiondef('public.search_items_fuzzy_v2(text[],item_category,item_condition,numeric,numeric,uuid,text,integer,integer,text,boolean,date,text)'::regprocedure)"),baselineQuery,'ordered rollback restores exact previously deployed indexed query')
    assert.equal(as(null,"SELECT count(*) FROM search_items_fuzzy_v2(ARRAY['desk'])"),'20')
    assert.equal(sql("SELECT to_regclass('search_private.knn_fields') IS NOT NULL"),'t','baseline index survives rollback')
    assert.equal(sql('SELECT count(*) FROM hidden_items'),'1000','private user choices are retained')
  } finally {
    try { if (started) run('pg_ctl',['-D',data,'-m','immediate','-w','stop']) }
    finally { rmSync(dir,{recursive:true,force:true}) }
  }
})
