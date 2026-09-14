import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const bin = ['/opt/homebrew/opt/postgresql@17/bin', '/usr/lib/postgresql/17/bin'].find(p => existsSync(join(p, 'initdb')))
const migration = read('../supabase/migrations/20260914200143_statement_scoped_listing_search.sql')
const quote = value => "'" + value.replaceAll("'", "''") + "'"
const id = n => 'caac0914-2026-4000-8000-' + String(n).padStart(12, '0')

test('statement-scoped search preserves deployed SQL results and live moderation under real PostgreSQL RLS', { skip: !bin && 'local PostgreSQL unavailable' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'statement-search-')), data = join(dir, 'data')
  const port = String(50000 + Math.floor(Math.random() * 10000))
  const run = (name, args, input) => execFileSync(join(bin, name), args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000, maxBuffer: 16 * 1024 * 1024 })
  const sql = input => run('psql', ['-X', '-h', dir, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qtA'], input).trim()
  const asUser = (input, uid = null, threshold = 0.3) => sql(`BEGIN; SET LOCAL ROLE ${uid ? 'authenticated' : 'anon'};
    SET LOCAL request.jwt.claims=${quote(JSON.stringify({ role: uid ? 'authenticated' : 'anon', ...(uid && { sub: uid }) }))};
    SET LOCAL pg_trgm.similarity_threshold=${threshold}; ${input}; ROLLBACK;`)
  let started = false
  try {
    run('initdb', ['-D', data, '-A', 'trust', '-U', 'postgres', '--locale=en_US.UTF-8', '-E', 'UTF8'])
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
      for (const uid of identities) for (const threshold of [0, 0.3, 1]) {
        const queries = []
        for (const name of ['search_items_fuzzy', 'search_items_fuzzy_v2']) for (const args of cases) queries.push(`SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM ${name}(${args}) r`)
        queries.push("SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM search_items_fuzzy_v2(ARRAY['room'],detail_date_in=>'2026-09-15',price_unit_in=>'month') r")
        queries.push("SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM search_items_fuzzy_v2(ARRAY['ORD'],category_in=>'rideshare',detail_date_in=>'2026-09-13') r")
        queries.push('SELECT jsonb_agg(id ORDER BY id) FROM items')
        values.push(asUser(queries.join(';'), uid, threshold))
      }
      return values
    }
    const before = snapshot()
    const access = sql("SELECT proname,proacl,prosecdef FROM pg_proc WHERE proname IN ('search_items_fuzzy','search_items_fuzzy_v2') ORDER BY proname")
    sql('BEGIN;' + migration + 'COMMIT;')
    sql('BEGIN;' + migration + 'COMMIT;')
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
    // Restore the prior policy and prove rollback keeps every search result.
    sql("UPDATE suspensions SET ends_at=null,lifted_at=null WHERE profile_id='" + id(2) + "'")
    sql('BEGIN;' + read('../supabase/_ops/ROLLBACK_20260914_statement_scoped_listing_search.sql') + 'COMMIT;')
    assert.deepEqual(snapshot(), before)
  } finally {
    try { if (started) run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']) }
    finally { rmSync(dir, { recursive: true, force: true }) }
  }
})
