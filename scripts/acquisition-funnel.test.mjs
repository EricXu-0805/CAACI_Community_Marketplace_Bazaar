import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const bin=['/opt/homebrew/opt/postgresql@17/bin','/usr/lib/postgresql/17/bin'].find(p=>existsSync(join(p,'initdb')))
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8')
const visit='11111111-1111-4111-8111-111111111111', user='22222222-2222-4222-8222-222222222222'
test('campaign cohorts require verified new users, consent, real actions and service-only access; expire and delete safely', {skip:!bin&&'PostgreSQL unavailable'},()=>{
 const dir=mkdtempSync(join(tmpdir(),'acquisition-')),data=join(dir,'data'),port=String(50000+Math.floor(Math.random()*10000))
 const run=(name,args,input)=>execFileSync(join(bin,name),args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:60000})
 const sql=input=>run('psql',['-X','-h',dir,'-p',port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-qtA'],input).trim()
 let started=false
 try {
  run('initdb',['-D',data,'-A','trust','-U','postgres','--locale=en_US.UTF-8','-E','UTF8'])
  run('pg_ctl',['-D',data,'-o',`-p ${port} -k ${dir} -c listen_addresses=''`,'-l',join(dir,'pg.log'),'-w','start']);started=true
  sql(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;
   CREATE TABLE auth.users(id uuid PRIMARY KEY,created_at timestamptz,email_confirmed_at timestamptz);
   CREATE TABLE public.profiles(id uuid PRIMARY KEY,tos_version text);
   CREATE TABLE public.items(user_id uuid,created_at timestamptz,status text);
   CREATE TABLE public.messages(sender_id uuid,created_at timestamptz);
   CREATE FUNCTION public.run_ephemeral_data_retention() RETURNS TABLE(edge_rate_limits_deleted integer,illini_verifications_deleted integer,wechat_media_checks_deleted integer,has_more boolean) LANGUAGE sql AS $$SELECT 1,2,3,false$$;`)
  sql(read('../supabase/migrations/20260919090000_first_party_acquisition.sql'))
  for(const role of ['anon','authenticated']){
   assert.throws(()=>sql(`SET ROLE ${role};SELECT public.record_acquisition('${visit}','reddit');`),/permission denied/)
   assert.throws(()=>sql(`SET ROLE ${role};SELECT * FROM acquisition_visits;`),/permission denied/)
   assert.throws(()=>sql(`SET ROLE ${role};SELECT * FROM acquisition_report();`),/permission denied/)
  }
  sql(`SET ROLE service_role;SELECT public.record_acquisition('${visit}','reddit');SELECT public.record_acquisition('${visit}','reddit');`)
  assert.equal(sql('SELECT count(*) FROM acquisition_visits'),'1')
  sql(`INSERT INTO auth.users VALUES('${user}',now()-interval '3 days',now());INSERT INTO profiles VALUES('${user}','2026-09-19');SELECT record_acquisition('${visit}','reddit','${user}');`)
  assert.equal(sql('SELECT count(*) FROM acquisition_accounts'),'0','returning accounts are not new acquisition')
  sql(`UPDATE auth.users SET created_at=now(),email_confirmed_at=NULL;SELECT record_acquisition('${visit}','reddit','${user}');`)
  assert.equal(sql('SELECT count(*) FROM acquisition_accounts'),'0','unconfirmed is not registered')
  sql(`UPDATE auth.users SET email_confirmed_at=now();UPDATE profiles SET tos_version='2026-09-17';SELECT record_acquisition('${visit}','reddit','${user}');`)
  assert.equal(sql('SELECT count(*) FROM acquisition_accounts'),'0','old consent cannot authorize attribution')
  sql(`UPDATE profiles SET tos_version='2026-09-19';SELECT record_acquisition('${visit}','facebook','${user}');`)
  assert.equal(sql('SELECT count(*) FROM acquisition_accounts'),'0','channel must match the session')
  sql(`SELECT record_acquisition('${visit}','reddit','${user}');SELECT record_acquisition('${visit}','reddit','${user}');`)
  assert.equal(sql('SELECT count(*) FROM acquisition_accounts'),'1')
  assert.equal(sql("SELECT source||':'||visits||':'||registrations||':'||publishers||':'||contacts FROM acquisition_report()"),'reddit:1:1:0:0')
  sql(`INSERT INTO items VALUES('${user}',now(),'active'),('${user}',now(),'active');INSERT INTO messages VALUES('${user}',now()),('${user}',now());`)
  assert.equal(sql("SELECT publishers||':'||contacts FROM acquisition_report()"),'1:1','actual actors, not repeated clicks or event counts')
  sql('UPDATE acquisition_accounts SET excluded=true')
  assert.equal(sql('SELECT count(*) FROM acquisition_report()'),'0','test cohort excluded')
  sql(`DELETE FROM auth.users WHERE id='${user}'`)
  assert.equal(sql('SELECT count(*) FROM acquisition_accounts'),'0','account deletion removes linkage')
  sql("UPDATE acquisition_visits SET created_at=now()-interval '31 days'")
  assert.equal(sql('SELECT count(*) FROM acquisition_report(30)'),'0')
  assert.equal(sql('SELECT * FROM run_ephemeral_data_retention()'),'1|2|3|f')
  assert.equal(sql('SELECT count(*) FROM acquisition_visits'),'0','existing hourly cleanup removes expired sessions')
  assert.throws(()=>sql('SELECT * FROM acquisition_report(31)'),/invalid_report_window/)
 }finally{try{if(started)run('pg_ctl',['-D',data,'-m','immediate','-w','stop'])}finally{rmSync(dir,{recursive:true,force:true})}}
})
