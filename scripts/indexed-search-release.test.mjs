import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import { postgresBinDir } from './_postgres-bin.mjs'
const postgresBin=postgresBinDir();
test('indexed search review package rejects version drift, restores exact data and rolls back', {skip:!postgresBin&&'PostgreSQL 17 unavailable'}, t=>{
const bin=postgresBin;
const root=fileURLToPath(new URL('..',import.meta.url));
const temp=mkdtempSync(join(tmpdir(),'illini-rank-probe-')),data=join(temp,'data'),port='54023';
const conn=['-h',temp,'-p',port,'-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'];
const run=(name,args,input)=>execFileSync(join(bin,name),args,{input,encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024,stdio:['pipe','pipe','pipe']});
const sql=s=>run('psql',conn,s).trim();
const role=(s,r='anon')=>`BEGIN; SET LOCAL ROLE ${r}; SET LOCAL request.jwt.claims='{"role":"anon","iss":"supabase","ref":"local-capacity-probe"}'; SET LOCAL search_path=pg_catalog,public,extensions; ${s}; ROLLBACK;`;
const terms={single:"ARRAY['desk']",bilingual:"ARRAY['desk','书桌','table']",broad:"ARRAY['campus']",absent:"ARRAY['zzqrare123']",twelve:"ARRAY['desk','书桌','table','chair','椅子','campus','pickup','monitor','storage','lamp','灯','room']"};
const query=(name,t)=>`SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM ${name}(${t},listing_type_in=>'sell') r`;
const report={scope:'local PG17, en_US.UTF-8, 14 synthetic items; exact review install/rollback scripts, copied hosted item visibility policy and suspension helper; logical pg_dump/pg_restore into a second database on the same local PG17 instance (shared role bootstrap), not production/Auth/Storage/full-cluster recovery',samples:[]};let started=false;
try {
 run('initdb',['-D',data,'-A','trust','-U','postgres','--locale=en_US.UTF-8','--locale-provider=icu','--icu-locale=en-US','-E','UTF8']);
 run('pg_ctl',['-D',data,'-o',`-p ${port} -k ${temp} -c listen_addresses=''`,'-l',join(temp,'pg.log'),'-w','start']);started=true;
 const read=p=>readFileSync(join(root,p),'utf8');
 let fixture=read('scripts/listing-details.test.mjs').split('const setup=`')[1].split('\n`')[0];
 fixture=fixture.replace("'housing','rideshare'","'housing','rideshare','books','other'").replace("ENUM ('active','deleted')","ENUM ('active','deleted','sold')");
 sql(fixture);
 const old=read('supabase/migrations/20260903030000_search_items_fuzzy_matches_translations.sql');sql(old.slice(old.indexOf('CREATE OR REPLACE FUNCTION')));
 for(const name of ['20260905184951_campus_location_search_alignment.sql','20260905194646_structured_housing_rideshare_details.sql','20260906091453_bounded_listing_search.sql'])sql(read('supabase/migrations/'+name));
 sql(`DELETE FROM items;
 CREATE SCHEMA auth; CREATE SCHEMA moderation_private;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub'))::uuid $$;
 GRANT USAGE ON SCHEMA auth,moderation_private TO anon,authenticated;
 CREATE TABLE auth.users(id uuid,aud text,role text,email text,created_at timestamptz,updated_at timestamptz,raw_app_meta_data jsonb,raw_user_meta_data jsonb);
 ALTER TABLE profiles ADD COLUMN uid text,ADD COLUMN tos_version text,ADD COLUMN consented_at timestamptz,ADD COLUMN onboarded_at timestamptz,ADD COLUMN email_digest_opt_out boolean,ADD COLUMN shadow_banned boolean;
 ALTER TABLE items ADD COLUMN updated_at timestamptz;
 CREATE TABLE suspensions(profile_id uuid,level int,started_at timestamptz,lifted_at timestamptz,ends_at timestamptz);
 CREATE FUNCTION moderation_private.profile_content_visible(profile_id_in uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT profile_id_in=(SELECT auth.uid()) OR NOT EXISTS (SELECT 1 FROM public.suspensions s WHERE s.profile_id=profile_id_in AND s.level>=3 AND s.started_at<=statement_timestamp() AND s.lifted_at IS NULL AND(s.ends_at IS NULL OR s.ends_at>statement_timestamp())) $$;
 DROP POLICY visible ON items; CREATE POLICY visible ON items FOR SELECT TO anon,authenticated USING(status<>'deleted' AND moderation_private.profile_content_visible(user_id));`);
 sql(`INSERT INTO profiles(id,nickname) SELECT ('caac0911-2026-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic seller '||n FROM generate_series(1,3)n;
 INSERT INTO items(id,user_id,title,description,title_i18n,description_i18n,price,category,status,listing_type,created_at)
 SELECT ('caac0911-2026-4001-8000-'||lpad(n::text,12,'0'))::uuid,
 ('caac0911-2026-4000-8000-'||lpad((n%3+1)::text,12,'0'))::uuid,
 'Campus desk '||n,'Synthetic campus pickup for study table '||n,
 jsonb_build_object('en','Study desk '||n,'zh','校园书桌'||n),jsonb_build_object('en','Campus pickup','zh','校园自取'),n,'furniture','active','sell','2026-09-01'::timestamptz+n*interval '1 minute'
 FROM generate_series(1,14)n;`);
 sql(`UPDATE items SET description=description||' Item '||id||' '||repeat(md5(id::text)||' ',12), description_i18n=jsonb_build_object('en','Pickup notes for '||id||' '||repeat(md5(id::text)||' ',5),'zh','校园物品说明 '||id||' '||repeat(md5(id::text)||' ',5));`);
 sql(`INSERT INTO suspensions VALUES('caac0911-2026-4000-8000-000000000101',3,now()-interval '1 day',null,null);
 CREATE INDEX title_trgm ON items USING gin(title extensions.gin_trgm_ops);
 CREATE INDEX description_trgm ON items USING gin(description extensions.gin_trgm_ops);
 CREATE INDEX susp_profile ON suspensions(profile_id);
 ANALYZE items; ANALYZE profiles; ANALYZE suspensions;`);
 sql('ALTER POLICY visible ON public.items RENAME TO "Anyone can view active items";');
 sql(read('supabase/migrations/20260914200143_statement_scoped_listing_search.sql'));
 const native=read('supabase/migrations/20260906091453_bounded_listing_search.sql');
 sql(native.slice(native.indexOf('CREATE OR REPLACE FUNCTION')).replaceAll('public.search_items_fuzzy','public.native_search_items_fuzzy'));

 sql("DELETE FROM items WHERE id NOT IN(SELECT id FROM items ORDER BY id LIMIT 14)");
 assert.equal(sql('SELECT count(*) FROM items'),'14');
 const expected={}; for(const [key,t] of Object.entries(terms))expected[key]=sql(role(query('native_search_items_fuzzy_v2',t)));
 const install=read('supabase/_ops/indexed_search_candidate/INSTALL.sql');
 // Inspect the effective settings inside the exact release transaction.
 const withTimeoutCheck=text=>text.replace(/\nCOMMIT;\s*$/, `
 DO $timeout_check$ BEGIN
   IF current_setting('statement_timeout') <> '15s' OR current_setting('lock_timeout') <> '2s'
   THEN RAISE EXCEPTION 'release_timeout_drift'; END IF;
 END $timeout_check$;
 COMMIT;`);
 sql(`INSERT INTO items(id,title,category,status)
 SELECT ('caac0916-2026-4009-8000-'||lpad(n::text,12,'0'))::uuid,'Bound guard fixture','furniture','active'
 FROM generate_series(1,87)n;`);
 assert.equal(sql('SELECT count(*) FROM items'),'101');
 assert.throws(()=>sql(install),/reviewed_small_release_limit_exceeded/);
 assert.equal(sql("SELECT to_regnamespace('search_private') IS NULL"),'t');
 assert.equal(sql('SELECT count(*) FROM items'),'101');
 sql("DELETE FROM items WHERE id::text LIKE 'caac0916-2026-4009-8000-%'");
 report.samples.push({label:'oversized-target-rejected-without-data-change',pass:true});
 assert.throws(()=>sql(install.replace("e.extversion = '1.5'","e.extversion = 'unverified-version'")),/cached_listing_search_extension_version_drift/);
 assert.equal(sql("SELECT to_regnamespace('search_private') IS NULL"),'t');
 assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname='intarray'"),'0');
 assert.equal(sql('SELECT count(*) FROM items'),'14');
 report.samples.push({label:'unverified-extension-version-rolls-back-before-cache',pass:true});
 const start=performance.now();sql(withTimeoutCheck(install));
 report.installMs=Math.round(performance.now()-start);
 for(const [key,t] of Object.entries(terms))assert.equal(sql(role(query('search_items_fuzzy_v2',t))),expected[key],key);
 sql(read('supabase/_ops/VERIFY_20260914_cached_listing_search.sql'));
 const verify=label=>{for(const t of Object.values(terms))assert.equal(sql(role(query('search_items_fuzzy_v2',t))),sql(role(query('native_search_items_fuzzy_v2',t))),label);report.samples.push({label,pass:true});};
 verify('bundled-install');
 sql("UPDATE items SET description='desk',description_i18n=null,created_at=null WHERE id=(SELECT id FROM items ORDER BY id LIMIT 1)");verify('live-edit');
 sql("DELETE FROM items WHERE id=(SELECT id FROM items ORDER BY id LIMIT 1)");verify('live-delete');

 const dump=join(temp,'cached-search.dump');
 run('pg_dump',['-h',temp,'-p',port,'-U','postgres','-d','postgres','-Fc','-f',dump]);
 run('createdb',['-h',temp,'-p',port,'-U','postgres','restored']);
 run('pg_restore',['-h',temp,'-p',port,'-U','postgres','-d','restored','--exit-on-error',dump]);
 const restoredConn=[...conn];restoredConn[restoredConn.indexOf('-d')+1]='restored';
 const restoredSql=input=>run('psql',restoredConn,input).trim();
 assert.equal(restoredSql("SELECT extname||':'||extversion FROM pg_extension WHERE extname IN('intarray','pg_trgm') ORDER BY extname"),'intarray:1.5\npg_trgm:1.6');
 for(const t of Object.values(terms))assert.equal(restoredSql(role(query('search_items_fuzzy_v2',t))),sql(role(query('native_search_items_fuzzy_v2',t))));
 restoredSql(read('supabase/_ops/VERIFY_20260914_cached_listing_search.sql'));
 report.samples.push({label:'logical-backup-restored-cache-native-results-and-permissions',pass:true});
 restoredSql("UPDATE items SET title='restored desk',description='desk',description_i18n=null WHERE id=(SELECT id FROM items ORDER BY id LIMIT 1)");
 for(const t of Object.values(terms))assert.equal(restoredSql(role(query('search_items_fuzzy_v2',t))),restoredSql(role(query('native_search_items_fuzzy_v2',t))));
 restoredSql(read('supabase/_ops/VERIFY_20260914_cached_listing_search.sql'));
 report.samples.push({label:'restored-cache-maintains-subsequent-edit',pass:true});
 sql(withTimeoutCheck(read('supabase/_ops/indexed_search_candidate/ROLLBACK.sql')));
 verify('bundled-rollback');
 assert.equal(sql("SELECT to_regnamespace('search_private') IS NULL"),'t');
 assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname='intarray'"),'0');
 report.pass=true;
} finally {if(started)run('pg_ctl',['-D',data,'-m','immediate','-w','stop']);rmSync(temp,{recursive:true,force:true});}
assert.equal(report.pass,true);
assert.equal(report.samples.length,8);
t.diagnostic('Eight install/restore/rollback scenarios passed');
});
