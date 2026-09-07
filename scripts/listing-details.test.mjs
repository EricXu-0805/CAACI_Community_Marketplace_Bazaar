import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const require=createRequire(new URL('../app/package.json',import.meta.url)),ts=require('typescript')
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8')
const js=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const url=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64')
const campus=url(js(read('../app/src/utils/campusTime.ts')))
const helpers=await import(url(js(read('../app/src/utils/listingDetails.ts')).replace("'./campusTime'",JSON.stringify(campus))))
const housing={kind:'housing',available_from:'2026-09-10',available_to:'2026-12-20',price_unit:'month',room_type:'private'}
const trip={kind:'rideshare',origin:'UIUC campus',destination:'Chicago ORD',departure_date:'2026-09-12',departure_time:'15:30',seats:3,price_unit:'person',time_zone:'America/Chicago'}
test('category details preserve explicit facts and reject invalid dates, units and routes',()=>{
 assert.equal(helpers.listingDetailsError('housing',housing),'')
 assert.equal(helpers.listingDetailsError('rideshare',trip),'')
 assert.deepEqual(helpers.listingDetailsFromForm('rideshare',helpers.listingDetailFormFromValue('rideshare',trip)),trip)
 assert.equal(helpers.readListingDetails('housing',null),null)
 assert.equal(helpers.readListingDetails('electronics',housing),null)
 for(const detail of [{...housing,available_to:'2026-09-01'},{...housing,available_from:'2026-02-30'},{...housing,price_unit:'day'},{...housing,room_type:null},{...housing,extra:'not allowed'}])assert.ok(helpers.listingDetailsError('housing',detail))
 for(const detail of [{...trip,seats:1.5},{...trip,seats:9},{...trip,origin:' Chicago ORD '},{...trip,departure_time:'25:00'},{...trip,departure_date:'2026-03-08',departure_time:'02:30'},{...trip,time_zone:'UTC'}])assert.ok(helpers.listingDetailsError('rideshare',detail))
 assert.equal(helpers.listingDetailsError('rideshare',{...trip,departure_date:'2026-11-01',departure_time:'01:30'}),'')
})
const bin=['/opt/homebrew/opt/postgresql@17/bin','/usr/lib/postgresql/17/bin'].find(p=>existsSync(join(p,'initdb')))
const migration=read('../supabase/migrations/20260905194646_structured_housing_rideshare_details.sql')
const old=read('../supabase/migrations/20260903030000_search_items_fuzzy_matches_translations.sql')
const setup=`
CREATE SCHEMA extensions; CREATE EXTENSION pg_trgm WITH SCHEMA extensions; CREATE SCHEMA private;
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TYPE item_category AS ENUM ('electronics','furniture','housing','rideshare'); CREATE TYPE item_condition AS ENUM ('good','defective'); CREATE TYPE item_status AS ENUM ('active','deleted');
CREATE TABLE profiles(id uuid,nickname text,avatar_url text,location text,is_illini_verified boolean,status_text text,status_emoji text);
CREATE TABLE items(id uuid primary key DEFAULT gen_random_uuid(),user_id uuid,title text,description text,title_i18n jsonb,description_i18n jsonb,source_lang text,price numeric,category item_category,condition item_condition DEFAULT 'good',status item_status DEFAULT 'active',listing_type text DEFAULT 'sell',location text,location_verified boolean DEFAULT false,images text[] DEFAULT '{}',image_dimensions jsonb DEFAULT '[]',view_count int DEFAULT 0,favorite_count int DEFAULT 0,negotiable boolean DEFAULT false,created_at timestamptz DEFAULT '2026-09-05');
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
CREATE POLICY visible ON items FOR SELECT USING(status='active' AND title<>'hidden listing');
CREATE POLICY owner_insert ON items FOR INSERT TO authenticated WITH CHECK(user_id='11111111-1111-4111-8111-111111111111');
CREATE POLICY owner_update ON items FOR UPDATE TO authenticated USING(user_id='11111111-1111-4111-8111-111111111111') WITH CHECK(user_id='11111111-1111-4111-8111-111111111111');
GRANT USAGE ON SCHEMA public,extensions TO anon,authenticated; GRANT SELECT ON profiles,items TO anon,authenticated; GRANT INSERT,UPDATE ON items TO authenticated;
CREATE FUNCTION private.assert_text_boundary(text,text,int,int,int,boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF length($1)>$4 THEN RAISE EXCEPTION 'text boundary'; END IF; END $$;
CREATE FUNCTION private.assert_moderated_text(text,text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF $1 LIKE '%SAFETY_BLOCK%' THEN RAISE EXCEPTION 'moderation blocked'; END IF; END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO items(title,user_id,price,category,location) VALUES('legacy room','11111111-1111-4111-8111-111111111111',500,'housing','Illini Union');
`
const quote=s=>"'"+s.replaceAll("'","''")+"'"
test('real PostgreSQL enforces details and filters public search before pagination', {skip:!bin&&'local PostgreSQL unavailable'},()=>{
 const dir=mkdtempSync(join(tmpdir(),'listing-details-')),data=join(dir,'data'),port=String(50000+Math.floor(Math.random()*10000))
 const sql=input=>execFileSync(join(bin,'psql'),['-h',dir,'-p',port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-qtA'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()
 const user=input=>sql(`BEGIN; SET LOCAL ROLE authenticated; ${input} COMMIT;`)
 execFileSync(join(bin,'initdb'),['-D',data,'-A','trust','-U','postgres'],{stdio:'ignore'})
 try{
  execFileSync(join(bin,'pg_ctl'),['-D',data,'-o',`-p ${port} -k ${dir} -c listen_addresses=''`,'-l',join(dir,'pg.log'),'-w','start'],{stdio:'ignore'})
  sql(setup);sql(old.slice(old.indexOf('CREATE OR REPLACE FUNCTION')));sql(migration);sql(migration)
  const insert=(category,details,title='student room')=>user(`INSERT INTO items(title,user_id,price,category,location,listing_details) VALUES(${quote(title)},'11111111-1111-4111-8111-111111111111',500,${quote(category)},'Illini Union',${quote(JSON.stringify(details))}::jsonb);`)
  insert('housing',housing);insert('housing',{...housing,price_unit:'week'});insert('housing',{...housing,available_from:'2027-01-01',available_to:'2027-02-01'});insert('rideshare',trip,'airport ride');insert('rideshare',trip,'hidden listing')
  assert.equal(sql("SELECT count(*) FROM items WHERE title='legacy room' AND listing_details IS NULL;"),'1')
  const search=extra=>user(`SELECT count(*) FROM search_items_fuzzy_v2(ARRAY['room'],${extra});`)
  assert.equal(search("detail_date_in=>'2026-09-15',price_unit_in=>'month'"),'1')
  assert.equal(search("detail_date_in=>'2026-09-15'"),'2')
  assert.equal(user("SELECT count(*) FROM search_items_fuzzy_v2(ARRAY['ORD'],category_in=>'rideshare',detail_date_in=>'2026-09-12');"),'1','route is searchable while hidden rows stay hidden')
  assert.equal(user("SELECT count(*) FROM search_items_fuzzy_v2(ARRAY['ORD'],detail_date_in=>'2026-09-13');"),'0')
  assert.equal(user("SELECT listing_details->>'price_unit' FROM search_items_fuzzy_v2(ARRAY['room'],detail_date_in=>'2026-09-15',price_unit_in=>'month',limit_in=>1,offset_in=>0);"),'month')
  assert.equal(user("SELECT count(*) FROM search_items_fuzzy_v2(ARRAY['room'],detail_date_in=>'2026-09-15',price_unit_in=>'month',limit_in=>1,offset_in=>1);"),'0')
  for(const detail of [{...housing,available_from:'2026-02-30'},{...housing,available_to:'2026-01-01'},{...housing,price_unit:null},{...housing,unexpected:1}])assert.throws(()=>insert('housing',detail),/invalid_listing_details/)
  for(const detail of [{...trip,seats:0},{...trip,seats:2.5},{...trip,departure_time:'25:00'},{...trip,departure_date:'2026-03-08',departure_time:'02:30'},{...trip,origin:trip.destination}])assert.throws(()=>insert('rideshare',detail),/invalid_listing_details/)
  assert.throws(()=>insert('electronics',housing),/invalid_listing_details/)
  assert.throws(()=>insert('rideshare',{...trip,origin:'SAFETY_BLOCK origin'}),/moderation blocked/)
  assert.throws(()=>user("UPDATE items SET listing_details='{}'::jsonb WHERE title='student room';"),/invalid_listing_details/)
  assert.throws(()=>user("UPDATE items SET user_id='22222222-2222-4222-8222-222222222222' WHERE title='student room';"),/row-level security/)
  assert.equal(sql("SELECT prosecdef FROM pg_proc WHERE oid='public.search_items_fuzzy_v2'::regproc;"),'f')
  assert.equal(sql("SELECT has_function_privilege('anon','private.guard_listing_details()','execute');"),'f')
 }finally{try{execFileSync(join(bin,'pg_ctl'),['-D',data,'-m','immediate','-w','stop'],{stdio:'ignore'})}finally{rmSync(dir,{recursive:true,force:true})}}
})
