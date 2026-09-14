import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync, execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const bin = ['/opt/homebrew/opt/postgresql@17/bin', '/usr/lib/postgresql/17/bin'].find(p => existsSync(join(p, 'initdb')))
const migration = read('../supabase/migrations/20260914200143_statement_scoped_listing_search.sql')
const quote = value => "'" + value.replaceAll("'", "''") + "'"
const id = n => 'caac0914-2026-4000-8000-' + String(n).padStart(12, '0')

for (const locale of ['libc', 'icu']) test(`cached search preserves native results, live writes and RLS under ${locale}`, { skip: !bin && 'local PostgreSQL unavailable' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'statement-search-')), data = join(dir, 'data')
  const port = String(50000 + Math.floor(Math.random() * 10000))
  const run = (name, args, input) => execFileSync(join(bin, name), args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000, maxBuffer: 16 * 1024 * 1024 })
  const sql = input => run('psql', ['-X', '-h', dir, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qtA'], input).trim()
  const sqlAsync = async input => (await promisify(execFile)(join(bin, 'psql'), ['-X','-h',dir,'-p',port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-qtA','-c',input], { encoding:'utf8', timeout:60000, maxBuffer:16*1024*1024 })).stdout.trim()
  const waitForSleep = async name => {
    const deadline = Date.now()+5000
    while (Date.now()<deadline) {
      if (sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND wait_event='PgSleep')`) === 't') return
      await new Promise(resolve => setTimeout(resolve,10))
    }
    assert.fail('concurrency barrier was not reached')
  }
  const asUser = (input, uid = null, threshold = 0.3) => sql(`BEGIN; SET LOCAL ROLE ${uid ? 'authenticated' : 'anon'};
    SET LOCAL request.jwt.claims=${quote(JSON.stringify({ role: uid ? 'authenticated' : 'anon', ...(uid && { sub: uid }) }))};
    SET LOCAL pg_trgm.similarity_threshold=${threshold}; ${input}; ROLLBACK;`)
  let started = false
  try {
    run('initdb', ['-D', data, '-A', 'trust', '-U', 'postgres', '--locale=en_US.UTF-8', '-E', 'UTF8', ...(locale === 'icu' ? ['--locale-provider=icu', '--icu-locale=en-US'] : [])])
    run('pg_ctl', ['-D', data, '-o', `-p ${port} -k ${dir} -c listen_addresses=''`, '-l', join(dir, 'pg.log'), '-w', 'start']); started = true
    let fixture = read('./listing-details.test.mjs').split('const setup=`')[1].split('\n`')[0]
    fixture = fixture.replace("ENUM ('active','deleted')", "ENUM ('active','deleted','sold')")
    sql(fixture)
    const old = read('../supabase/migrations/20260903030000_search_items_fuzzy_matches_translations.sql')
    sql(old.slice(old.indexOf('CREATE OR REPLACE FUNCTION')))
    for (const name of ['20260905184951_campus_location_search_alignment.sql', '20260905194646_structured_housing_rideshare_details.sql', '20260906091453_bounded_listing_search.sql']) sql(read('../supabase/migrations/' + name))
    sql(`DELETE FROM items;
      CREATE SCHEMA auth; CREATE SCHEMA moderation_private;
      GRANT USAGE ON SCHEMA auth,moderation_private TO anon,authenticated,service_role;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub'))::uuid $$;
      CREATE TABLE suspensions(profile_id uuid,level int,started_at timestamptz,lifted_at timestamptz,ends_at timestamptz);
      ALTER TABLE suspensions ENABLE ROW LEVEL SECURITY;
      CREATE FUNCTION moderation_private.profile_content_visible(profile_id_in uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
        SELECT profile_id_in=(SELECT auth.uid()) OR NOT EXISTS (SELECT 1 FROM public.suspensions s WHERE s.profile_id=profile_id_in AND s.level>=3 AND s.started_at<=statement_timestamp() AND s.lifted_at IS NULL AND (s.ends_at IS NULL OR s.ends_at>statement_timestamp())) $$;
      DROP POLICY visible ON items;
      CREATE POLICY "Anyone can view active items" ON items FOR SELECT TO anon,authenticated USING(status<>'deleted' AND moderation_private.profile_content_visible(user_id));
      DROP POLICY owner_insert ON items; DROP POLICY owner_update ON items;
      CREATE POLICY owner_insert ON items FOR INSERT TO authenticated WITH CHECK(user_id=(SELECT auth.uid()));
      CREATE POLICY owner_update ON items FOR UPDATE TO authenticated USING(user_id=(SELECT auth.uid())) WITH CHECK(user_id=(SELECT auth.uid()));
      CREATE POLICY owner_delete ON items FOR DELETE TO authenticated USING(user_id=(SELECT auth.uid()));
      GRANT DELETE ON items TO authenticated;
      INSERT INTO profiles(id,nickname) SELECT ('caac0914-2026-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Seller '||n FROM generate_series(1,10) n;
      INSERT INTO items(id,user_id,title,title_i18n,description,description_i18n,category,price,condition,status,location,location_verified)
        SELECT ('caac0914-2026-4001-8000-'||lpad(n::text,12,'0'))::uuid,
          CASE WHEN n=1 THEN NULL ELSE ('caac0914-2026-4000-8000-'||lpad((n%10+1)::text,12,'0'))::uuid END,
          CASE WHEN n%4=0 THEN '书桌 desk '||n ELSE 'camera '||n END,
          CASE WHEN n%5=0 THEN NULL ELSE jsonb_build_object('en','DESK'||n,'zh','校园书桌'||n) END,
          CASE WHEN n%7=0 THEN NULL ELSE repeat(md5(n::text)||' ',20)||' campus pickup '||n END,
          jsonb_build_object('en','A different note '||n,'zh','商品描述'||n), 'furniture',n,
          CASE WHEN n%4=0 THEN 'defective'::item_condition ELSE 'good'::item_condition END,
          CASE WHEN n%13=0 THEN 'deleted'::item_status WHEN n%11=0 THEN 'sold'::item_status ELSE 'active'::item_status END,
          CASE WHEN n%2=0 THEN 'Illini Union' ELSE 'Champaign' END,n%2=0 FROM generate_series(1,90) n;
      INSERT INTO items(title,description,category,price,listing_details) VALUES
        ('unicode İ i I ı ß SS Σ σ ς K K café 😀','100% _ literal backslash \\ text','electronics',10,NULL),
        ('campus room','large room','housing',700,'{"kind":"housing","available_from":"2026-09-10","available_to":"2026-12-20","price_unit":"month","room_type":"private"}'),
        ('airport trip','ride','rideshare',30,'{"kind":"rideshare","origin":"UIUC","destination":"Chicago ORD","departure_date":"2026-09-12","departure_time":"15:30","seats":2,"price_unit":"person","time_zone":"America/Chicago"}');
      INSERT INTO items(title,description,title_i18n,description_i18n,category,price,listing_details) VALUES
        ('',null,null,null,'electronics',10,null),
        (null,null,null,null,'electronics',10,null),
        ('blank legacy','','{}','{}','electronics',10,null),
        ('route','Chicago ORD','{"en":"route"}','{"en":"Chicago ORD"}','rideshare',10,'{"kind":"rideshare","origin":"Chicago ORD","destination":"route","departure_date":"2026-09-12","departure_time":"15:30","seats":2,"price_unit":"person","time_zone":"America/Chicago"}');
      INSERT INTO suspensions VALUES
        ('${id(2)}',3,now()-interval '1 day',null,null),
        ('${id(2)}',3,now()-interval '1 day',null,null),
        ('${id(3)}',3,now()-interval '1 day',null,now()-interval '1 second'),
        ('${id(4)}',3,now()+interval '1 day',null,null),
        ('${id(5)}',3,now()-interval '1 day',now(),null),
        ('${id(6)}',2,now()-interval '1 day',null,null),
        (null,3,now()-interval '1 day',null,null);`)
    const cases = ["ARRAY['desk']", "ARRAY['书桌','table','desk']", "ARRAY['camra']", "ARRAY['nomatch']", "ARRAY['%']", "ARRAY['_']", "ARRAY['\\']", "ARRAY['100%']", "ARRAY['İ','ß','Σ','ς','K','café','😀']", "array_fill('desk'::text,ARRAY[12])", "'[0:1]={desk,camera}'::text[]", "ARRAY['campus'],location_in=>' UIUC '", "ARRAY['desk'],price_min_in=>10,price_max_in=>30,condition_in=>'defective'", "ARRAY['desk'],category_in=>'furniture',verified_only_in=>true", "ARRAY['desk'],limit_in=>7,offset_in=>7", "ARRAY['desk'],limit_in=>0,offset_in=>-1", "ARRAY['desk'],limit_in=>NULL,offset_in=>NULL", `ARRAY['desk'],user_id_in=>'${id(2)}'`, "ARRAY['desk'],listing_type_in=>'buy'", "ARRAY['ORD']", "NULL::text[]", "ARRAY[]::text[]"]
    const identities = [null, id(1), id(2)]
    const snapshot = () => {
      const values = []
      for (const uid of identities) for (const threshold of [0, 0.3, 0.30000001, 0.33333333, 0.33333334326744080, 0.49999999, 0.50000001, 0.99999999, 1]) {
        const queries = []
        for (const name of ['search_items_fuzzy', 'search_items_fuzzy_v2']) for (const args of cases) queries.push(`SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM ${name}(${args}) r`)
        queries.push("SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM search_items_fuzzy_v2(ARRAY['room'],detail_date_in=>'2026-09-15',price_unit_in=>'month') r")
        queries.push("SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM search_items_fuzzy_v2(ARRAY['ORD'],category_in=>'rideshare',detail_date_in=>'2026-09-13') r")
        queries.push('SELECT jsonb_agg(id ORDER BY id) FROM items')
        values.push(asUser(queries.join(';'), uid, threshold))
      }
      return values
    }
    sql(migration)
    const before = snapshot()
    const access = sql("SELECT proname,proacl,prosecdef FROM pg_proc WHERE proname IN ('search_items_fuzzy','search_items_fuzzy_v2') ORDER BY proname")
    const cachedMigration = read('../supabase/migrations/20260914214912_cached_listing_search.sql')
    const native = read('../supabase/migrations/20260906091453_bounded_listing_search.sql')
    sql(native.slice(native.indexOf('CREATE OR REPLACE FUNCTION')).replaceAll('public.search_items_fuzzy','public.oracle_search_items_fuzzy'))
    sql('BEGIN;' + cachedMigration + 'COMMIT;')
    sql(read('./fixtures/cached-search-token-oracle.sql'))
    sql(read('../supabase/_ops/VERIFY_20260914_cached_listing_search.sql'))
    assert.deepEqual(snapshot(), before, 'same complete ordered rows, rank, translations, detail filters and visibility at all thresholds')
    assert.equal(sql("SELECT proname,proacl,prosecdef FROM pg_proc WHERE proname IN ('search_items_fuzzy','search_items_fuzzy_v2') ORDER BY proname"), access)
    assert.equal(asUser(`SELECT count(*) FROM items WHERE user_id='${id(2)}'`), '0')
    assert.ok(Number(asUser(`SELECT count(*) FROM items WHERE user_id='${id(2)}'`, id(2))) > 0, 'suspended owner still sees own non-deleted rows')
    assert.equal(asUser("SELECT count(*) FROM items WHERE status='deleted'", id(2)), '0')
    assert.throws(() => asUser('SELECT * FROM suspensions'), /permission denied/)
    assert.equal(asUser(`WITH changed AS (UPDATE items SET price=0 WHERE user_id='${id(2)}' RETURNING id) SELECT count(*) FROM changed`, id(1)), '0')
    assert.throws(() => asUser(`UPDATE items SET user_id='${id(2)}' WHERE user_id='${id(1)}'`, id(1)), /row-level security/)
    assert.equal(asUser(`WITH changed AS (DELETE FROM items WHERE user_id='${id(1)}' RETURNING id) SELECT count(*) FROM changed`, id(2)), '0')
    assert.ok(Number(asUser(`WITH changed AS (UPDATE items SET price=price+1 WHERE user_id='${id(2)}' RETURNING id) SELECT count(*) FROM changed`, id(2))) > 0)
    assert.equal(asUser(`INSERT INTO items(title,user_id,category) VALUES('my listing','${id(1)}','furniture') RETURNING title`, id(1)), 'my listing')
    assert.throws(() => asUser(`INSERT INTO items(title,user_id,category) VALUES('foreign listing','${id(2)}','furniture')`, id(1)), /row-level security/)
    for (const name of ['search_items_fuzzy', 'search_items_fuzzy_v2']) for (const args of ["array_fill('desk'::text,ARRAY[13])", "ARRAY[repeat('x',201)]", "ARRAY['']", "ARRAY['   ']", "ARRAY[NULL::text]", "ARRAY[['desk'],['camera']]"]) assert.throws(() => asUser(`SELECT * FROM ${name}(${args})`), /invalid_search_terms/)
    const live = sql(`SET plan_cache_mode='force_generic_plan'; SET ROLE anon;
      PREPARE visible_owner AS SELECT count(*)>0 FROM items WHERE user_id='${id(2)}';
      EXECUTE visible_owner;
      RESET ROLE; UPDATE suspensions SET lifted_at=now() WHERE profile_id='${id(2)}'; SET ROLE anon; EXECUTE visible_owner;
      RESET ROLE; UPDATE suspensions SET lifted_at=null,ends_at=clock_timestamp()+interval '0.2 seconds' WHERE profile_id='${id(2)}'; SET ROLE anon; EXECUTE visible_owner;
      SELECT pg_sleep(0.25); EXECUTE visible_owner;
      RESET ROLE; UPDATE suspensions SET ends_at=null WHERE profile_id='${id(2)}'; SET ROLE authenticated; SET request.jwt.claim.sub='${id(2)}'; EXECUTE visible_owner;
      SET request.jwt.claim.sub='${id(1)}'; EXECUTE visible_owner; RESET ROLE;`)
    assert.deepEqual(live.split('\n').filter(Boolean), ['f', 't', 'f', 't', 't', 'f'], 'prepared plans cannot cache expiry, lift or account identity across statements')
    assert.equal(sql("SELECT count(*) FROM pg_proc p, LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid IN ('moderation_private.hidden_content_profile_ids'::regproc) AND a.grantee=0"), '0')
    // A large moderation history must neither poison NOT IN with nulls nor
    // turn the independent lookup back into one function call for every item.
    sql(`INSERT INTO suspensions SELECT ('caac0914-2026-4009-8000-'||lpad(n::text,12,'0'))::uuid,3,now()-interval '1 day',null,null FROM generate_series(1,30000) n`)
    const plan = JSON.parse(asUser("SET LOCAL work_mem='3500kB'; EXPLAIN (ANALYZE,VERBOSE,FORMAT JSON) SELECT count(*) FROM items"))
    const scans = []
    const visit = node => { if (node['Function Name'] === 'hidden_content_profile_ids' || (node['Node Type'] === 'ProjectSet' && node.Output?.some(value => value.includes('hidden_content_profile_ids')))) scans.push(node); for (const child of node.Plans || []) visit(child) }
    visit(plan[0].Plan)
    assert.equal(scans.length, 1)
    assert.equal(scans[0]['Actual Loops'], 1)
    assert.equal(asUser(`SELECT count(*) FROM items WHERE user_id='${id(2)}'`), '0')
    sql("DELETE FROM suspensions WHERE profile_id::text LIKE 'caac0914-2026-4009-8000-%'")
    // Compare real mutations against the uncached native query, not a copy of
    // the cache builder. This catches stale publish/translation/route data.
    const liveId = 'caac0914-2026-4008-8000-000000000001'
    const nativeComparison = () => {
      for (const who of identities) for (const name of ['search_items_fuzzy','search_items_fuzzy_v2']) {
        const args = "ARRAY['新标题','camera','ORD','newtranslation','鮮花','%'],limit_in=>100"
        assert.equal(asUser(`SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM ${name}(${args}) r`, who),
          asUser(`SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM oracle_${name}(${args}) r`, who))
      }
      assert.equal(sql(`SELECT count(*) FROM items i FULL JOIN search_private.item_fields f ON f.item_id=i.id
        WHERE i.id IS NULL OR f.item_id IS NULL OR f.fields IS DISTINCT FROM search_private.build_fields(i.title,i.title_i18n,i.description,i.description_i18n,i.listing_details)`), '0')
    }
    const committed = input => sql(`BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims='{"sub":"${id(1)}","role":"authenticated"}'; ${input}; COMMIT;`)
    committed(`INSERT INTO items(id,user_id,title,description,category) VALUES('${liveId}','${id(1)}','新标题 camera','publish note','electronics')`)
    nativeComparison()
    committed(`UPDATE items SET title='鮮花',description='new description',title_i18n='{"en":"newtranslation"}',description_i18n='{"zh":"新描述"}' WHERE id='${liveId}'`)
    nativeComparison()
    committed(`UPDATE items SET category='rideshare',listing_details='{"kind":"rideshare","origin":"UIUC","destination":"Chicago ORD","departure_date":"2026-09-12","departure_time":"15:30","seats":2,"price_unit":"person","time_zone":"America/Chicago"}' WHERE id='${liveId}'`)
    nativeComparison()
    committed(`UPDATE items SET listing_details=jsonb_set(listing_details,'{destination}','"O Hare ORD"') WHERE id='${liveId}'`)
    nativeComparison()
    const unchanged = sql(`SELECT xmin::text FROM search_private.item_fields WHERE item_id='${liveId}'`)
    committed(`UPDATE items SET price=price+1 WHERE id='${liveId}'`)
    assert.equal(sql(`SELECT xmin::text FROM search_private.item_fields WHERE item_id='${liveId}'`), unchanged, 'price edits do not rebuild text')
    for (const status of ['sold','deleted','active']) { sql(`UPDATE items SET status='${status}' WHERE id='${liveId}'`); nativeComparison() }
    assert.throws(() => asUser(`DELETE FROM search_private.item_fields WHERE item_id='${liveId}'`, id(1)), /permission denied/)
    assert.throws(() => asUser(`UPDATE search_private.item_fields SET fields='{}' WHERE item_id='${liveId}'`, id(1)), /permission denied/)
    assert.throws(() => asUser("SELECT search_private.build_fields('x',null,null,null,null)", id(1)), /permission denied/)
    assert.throws(() => asUser('SELECT search_private.sync_item_fields()', id(1)), /permission denied/)
    for (const who of identities) assert.equal(asUser('SELECT count(*) FROM search_private.item_fields', who), asUser('SELECT count(*) FROM items', who))
    const current = sql(`SELECT fields::text FROM search_private.item_fields WHERE item_id='${liveId}'`)
    asUser(`UPDATE items SET title='rolled back' WHERE id='${liveId}'`, id(1))
    assert.equal(sql(`SELECT fields::text FROM search_private.item_fields WHERE item_id='${liveId}'`), current, 'item and cache rollback atomically')
    const first = sqlAsync(`BEGIN; SET application_name='cached-search-writer'; UPDATE items SET title='first update' WHERE id='${liveId}'; SELECT pg_sleep(0.4); COMMIT;`)
    await waitForSleep('cached-search-writer')
    await Promise.all([first, sqlAsync(`UPDATE items SET title='second update' WHERE id='${liveId}'`)])
    assert.equal(sql(`SELECT title FROM items WHERE id='${liveId}'`), 'second update')
    nativeComparison()
    committed(`DELETE FROM items WHERE id='${liveId}'`)
    assert.equal(sql(`SELECT count(*) FROM search_private.item_fields WHERE item_id='${liveId}'`), '0', 'hard deletion cascades')
    nativeComparison()
    // Restore the exact native RPC bodies and remove only owned objects.
    sql("UPDATE suspensions SET ends_at=null,lifted_at=null WHERE profile_id='" + id(2) + "'")
    sql('BEGIN;' + read('../supabase/_ops/ROLLBACK_20260914_cached_listing_search.sql') + 'COMMIT;')
    assert.equal(sql("SELECT to_regnamespace('search_private') IS NULL AND NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='intarray')"), 't')
    assert.deepEqual(snapshot(), before)
    // Make an actual concurrent publisher wait behind the migration's item
    // lock. It must see the installed trigger when the backfill commits.
    const pausedMigration = cachedMigration.replace('INSERT INTO search_private.item_fields(item_id,fields)\nSELECT', 'SELECT pg_sleep(0.4);\nINSERT INTO search_private.item_fields(item_id,fields)\nSELECT')
    const backfill = sqlAsync("BEGIN; SET application_name='cached-search-backfill';" + pausedMigration + 'COMMIT;')
    await waitForSleep('cached-search-backfill')
    await Promise.all([backfill, sqlAsync(`INSERT INTO items(id,user_id,title,category) VALUES('${liveId}','${id(1)}','published during backfill','electronics')`)])
    nativeComparison()
    committed(`DELETE FROM items WHERE id='${liveId}'`)
    sql(read('../supabase/_ops/VERIFY_20260914_cached_listing_search.sql'))
    assert.deepEqual(snapshot(), before, 'reapply and concurrent publication rebuild exactly')
  } finally {
    try { if (started) run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']) }
    finally { rmSync(dir, { recursive: true, force: true }) }
  }
})
