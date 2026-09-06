import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const bin = ['/opt/homebrew/opt/postgresql@17/bin', '/usr/lib/postgresql/17/bin'].find(p => existsSync(join(p, 'initdb')))
// Reuse only the established synthetic schema fixture; the oracle is the
// previously deployed SQL, never a second JavaScript copy of the new formula.
const fixture = read('./listing-details.test.mjs').split('const setup=`')[1].split('\n`')[0]
const old = read('../supabase/migrations/20260903030000_search_items_fuzzy_matches_translations.sql')
const candidate = read('../supabase/migrations/20260906091453_bounded_listing_search.sql')
test('optimized searches preserve ranked results, RLS and category filters while bounding hostile input', { skip: !bin && 'local PostgreSQL unavailable' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'bounded-search-')), data = join(dir, 'data')
  const port = String(50000 + Math.floor(Math.random() * 10000))
  const sql = input => execFileSync(join(bin, 'psql'), ['-X', '-h', dir, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qtA'], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15000 }).trim()
  const asUser = input => sql(`BEGIN; SET LOCAL ROLE authenticated; ${input}; ROLLBACK;`)
  execFileSync(join(bin, 'initdb'), ['-D', data, '-A', 'trust', '-U', 'postgres'], { stdio: 'ignore' })
  try {
    execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-o', `-p ${port} -k ${dir} -c listen_addresses=''`, '-l', join(dir, 'pg.log'), '-w', 'start'], { stdio: 'ignore' })
    sql(fixture); sql(old.slice(old.indexOf('CREATE OR REPLACE FUNCTION')))
    sql(read('../supabase/migrations/20260905184951_campus_location_search_alignment.sql'))
    sql(read('../supabase/migrations/20260905194646_structured_housing_rideshare_details.sql'))
    sql(`INSERT INTO items(title,description,title_i18n,description_i18n,category,price,location)
      SELECT CASE WHEN n%9=0 THEN 'hidden listing' WHEN n%3=0 THEN 'standing desk'||n ELSE 'camera'||n END,
        CASE WHEN n%7=0 THEN NULL ELSE 'campus pickup desk camera'||n END,
        CASE WHEN n%5=0 THEN NULL ELSE jsonb_build_object('zh','书桌' || n,'en','desk') END,
        jsonb_build_object('zh','校园交接相机','en','campus desk'), 'furniture', n,
        CASE WHEN n%2=0 THEN 'Illini Union' ELSE 'Champaign' END
      FROM generate_series(1,80) n;
      INSERT INTO items(title,category,price,location,listing_details) VALUES
        ('shared campus room','housing',700,'Illini Union','{"kind":"housing","available_from":"2026-09-10","available_to":"2026-12-20","price_unit":"month","room_type":"private"}'),
        ('trip','rideshare',30,'Illini Union','{"kind":"rideshare","origin":"UIUC","destination":"Chicago ORD","departure_date":"2026-09-12","departure_time":"15:30","seats":2,"price_unit":"person","time_zone":"America/Chicago"}');`)
    const cases = ["ARRAY['desk']", "ARRAY['书桌']", "ARRAY['camera','校园','desk']", "ARRAY['ORD']", "ARRAY['camra']", "ARRAY['nomatch']", "ARRAY['desk','desk']", "ARRAY['%']", "ARRAY['campus'],location_in=>'UIUC'", "ARRAY['desk'],price_max_in=>20", "ARRAY['desk'],limit_in=>7,offset_in=>7"]
    const readResult = (name, args) => asUser(`SELECT coalesce(jsonb_agg(to_jsonb(result)),'[]') FROM (SELECT * FROM ${name}(${args})) result`)
    const before = new Map()
    for (const name of ['search_items_fuzzy','search_items_fuzzy_v2']) {
      for (const args of cases) before.set(name+args,readResult(name,args))
    }
    const detailArgs = "ARRAY['room'],detail_date_in=>'2026-09-15',price_unit_in=>'month'"
    before.set('detail',readResult('search_items_fuzzy_v2',detailArgs))
    const grants = sql("SELECT proname,proacl,prosecdef FROM pg_proc WHERE proname IN ('search_items_fuzzy','search_items_fuzzy_v2') ORDER BY proname")
    sql(read('../supabase/_ops/PRECHECK_20260906_bounded_listing_search.sql'))
    sql('BEGIN;'+candidate+'COMMIT;')
    for (const name of ['search_items_fuzzy','search_items_fuzzy_v2']) {
      for (const args of cases) assert.equal(readResult(name,args),before.get(name+args),name+args)
      for (const args of ["array_fill('desk'::text,ARRAY[13])", "ARRAY[repeat('x',201)]", "ARRAY['']", "ARRAY['   ']", "ARRAY[NULL::text]", "ARRAY[['desk'],['camera']]"]) {
        assert.throws(()=>readResult(name,args),/invalid_search_terms/,name+args)
      }
      assert.equal(readResult(name,'NULL::text[]'),'[]')
      assert.equal(readResult(name,"ARRAY[]::text[]"),'[]')
      assert.equal(readResult(name,"array_fill('nomatch'::text,ARRAY[12])"),'[]')
      assert.equal(asUser(`SELECT count(*) FROM ${name}(ARRAY['hidden']) WHERE title='hidden listing'`),'0')
    }
    assert.equal(readResult('search_items_fuzzy_v2',detailArgs),before.get('detail'))
    assert.equal(sql("SELECT proname,proacl,prosecdef FROM pg_proc WHERE proname IN ('search_items_fuzzy','search_items_fuzzy_v2') ORDER BY proname"),grants)
    sql(read('../supabase/_ops/VERIFY_20260906_bounded_listing_search.sql'))
  } finally {
    try { execFileSync(join(bin,'pg_ctl'),['-D',data,'-m','immediate','-w','stop'],{stdio:'ignore'}) }
    finally { rmSync(dir,{recursive:true,force:true}) }
  }
})
