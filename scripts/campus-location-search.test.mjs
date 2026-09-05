import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const bin = ['/opt/homebrew/opt/postgresql@17/bin', '/opt/homebrew/opt/postgresql@16/bin', '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin'].find(dir => existsSync(join(dir, 'initdb')))
const old = readFileSync(new URL('../supabase/migrations/20260903030000_search_items_fuzzy_matches_translations.sql', import.meta.url), 'utf8')
const candidate = readFileSync(new URL('../supabase/migrations/20260905184951_campus_location_search_alignment.sql', import.meta.url), 'utf8')
const verify = readFileSync(new URL('../supabase/_ops/VERIFY_20260905_campus_location_search_alignment.sql', import.meta.url), 'utf8')
const setup = `
create schema extensions; create extension pg_trgm with schema extensions;
create role anon; create role authenticated;
create type item_category as enum ('electronics','furniture');
create type item_condition as enum ('good','defective');
create type item_status as enum ('active','deleted');
create table profiles(id uuid, nickname text, avatar_url text, location text, is_illini_verified boolean, status_text text, status_emoji text);
create table items(id uuid primary key, user_id uuid, title text, title_i18n jsonb, description text, description_i18n jsonb, source_lang text, price numeric, category item_category default 'electronics', condition item_condition default 'good', status item_status default 'active', listing_type text default 'sell', location text, location_verified boolean default false, images text[] default '{}', image_dimensions jsonb default '[]', view_count int default 0, favorite_count int default 0, negotiable boolean default false, created_at timestamptz default '2026-09-05');
alter table items enable row level security;
create policy visible on items for select using (status='active' and title <> 'hidden desk lamp');
grant usage on schema public,extensions to anon,authenticated;
grant select on items,profiles to anon,authenticated;
insert into items(id,title,price,location) values
('22222222-2222-4222-8222-000000000001','desk lamp',20,'Illini Union'),
('22222222-2222-4222-8222-000000000002','desk lamp',0,'伊利尼学生中心'),
('22222222-2222-4222-8222-000000000003','desk lamp',30,'Grainger 图书馆'),
('22222222-2222-4222-8222-000000000004','desk lamp',15,'UIUC'),
('22222222-2222-4222-8222-000000000005','desk lamp',5,'Champaign'),
('22222222-2222-4222-8222-000000000006','desk lamp',50,'Green Street'),
('22222222-2222-4222-8222-000000000007','hidden desk lamp',60,'Illini Union');
`
test('campus search matches publisher labels before pagination and preserves RLS', {skip:!bin && 'local PostgreSQL unavailable'}, () => {
 const dir=mkdtempSync(join(tmpdir(),'campus-search-')),data=join(dir,'data'),port=String(50000+Math.floor(Math.random()*10000));
 const sql=input=>execFileSync(join(bin,'psql'),['-h',dir,'-p',port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-qtA'],{input,encoding:'utf8'}).trim();
 const asUser=input=>sql(`begin; set local role authenticated; ${input} commit;`);
 execFileSync(join(bin,'initdb'),['-D',data,'-A','trust','-U','postgres'],{stdio:'ignore'});
 try {
  execFileSync(join(bin,'pg_ctl'),['-D',data,'-o',`-p ${port} -k ${dir} -c listen_addresses=''`,'-l',join(dir,'pg.log'),'-w','start'],{stdio:'ignore'});
  sql(setup);
  sql(old.slice(old.indexOf('CREATE OR REPLACE FUNCTION')));
  assert.equal(asUser("select count(*) from search_items_fuzzy(ARRAY['desk'],location_in=>'UIUC');"),'1','shipped predicate misses public campus spot labels');
  const acl=sql("select coalesce(proacl::text,'default') from pg_proc where oid='search_items_fuzzy'::regproc;");
  sql(candidate); sql(candidate); sql(verify);
  assert.equal(asUser("select count(*) from search_items_fuzzy(ARRAY['desk'],location_in=>' UIUC ');"),'4');
  assert.equal(asUser("select count(*) from search_items_fuzzy(ARRAY['desk'],location_in=>'UIUC',price_max_in=>0);"),'1');
  assert.equal(asUser("select count(*) from search_items_fuzzy(ARRAY['desk'],location_in=>'Champaign');"),'1');
  assert.equal(asUser("select count(*) from search_items_fuzzy(ARRAY['desk'],location_in=>'Green Street');"),'1');
  assert.equal(asUser("select count(*) from search_items_fuzzy(ARRAY['desk'],location_in=>'UIUC',verified_only_in=>true);"),'0','campus matching must not imply GPS verification');
  assert.equal(asUser("select count(*) from search_items_fuzzy(ARRAY['hidden'],location_in=>'UIUC');"),'0','INVOKER must retain RLS');
  const page=n=>asUser(`select id from search_items_fuzzy(ARRAY['desk'],location_in=>'UIUC',limit_in=>2,offset_in=>${n});`).split('\n');
  assert.equal(new Set([...page(0),...page(2)]).size,4);
  assert.deepEqual(page(0),page(0),'equal-rank equal-time results need a stable ID tie-break');
  assert.equal(sql("select prosecdef from pg_proc where oid='search_items_fuzzy'::regproc;"),'f');
  assert.equal(sql("select coalesce(proacl::text,'default') from pg_proc where oid='search_items_fuzzy'::regproc;"),acl);
 } finally {try{execFileSync(join(bin,'pg_ctl'),['-D',data,'-m','immediate','-w','stop'],{stdio:'ignore'})}finally{rmSync(dir,{recursive:true,force:true})}}
});
