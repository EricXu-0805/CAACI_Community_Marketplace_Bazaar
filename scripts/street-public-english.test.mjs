import test from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import { postgresBinDir } from './_postgres-bin.mjs'
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8')
const bin=postgresBinDir()
test('street receipts and public English use actual SQL: no client forgery, replay, stale source or private queue access',{skip:!bin&&'PostgreSQL17 unavailable'},()=>{
 const dir=mkdtempSync(join(tmpdir(),'street-public-')),data=join(dir,'data'),port=String(50000+Math.floor(Math.random()*10000))
 const run=(n,args,input)=>execFileSync(join(bin,n),args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:60000})
 const sql=s=>run('psql',['-X','-h',dir,'-p',port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-qtA'],s).trim()
 let started=false
 try {
  run('initdb',['-D',data,'-A','trust','-U','postgres','--locale=en_US.UTF-8','-E','UTF8'])
  run('pg_ctl',['-D',data,'-o',`-p ${port} -k ${dir} -c listen_addresses=''`,'-l',join(dir,'log'),'-w','start']);started=true
  sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
   CREATE SCHEMA auth; CREATE SCHEMA private; CREATE SCHEMA moderation_private;
   CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT (auth.jwt()->>'sub')::uuid $$;
   GRANT USAGE ON SCHEMA auth,public TO anon,authenticated,service_role;
   CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb,deleted_at timestamptz,banned_until timestamptz);
   CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users,created_at timestamptz,updated_at timestamptz,not_after timestamptz);
   CREATE TABLE public.profiles(id uuid PRIMARY KEY,nickname text,suspension_level int DEFAULT 0,suspended_until timestamptz);
   CREATE TABLE public.account_deletion_jobs(user_id uuid);
   CREATE TABLE public.items(id uuid PRIMARY KEY,user_id uuid,title text,description text,title_i18n jsonb,description_i18n jsonb,price numeric,category text,condition text,location text,status text DEFAULT 'active',location_verified boolean DEFAULT false);
   ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
   CREATE POLICY read_item ON public.items FOR SELECT USING(status='active');
   CREATE POLICY own_item ON public.items FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
   GRANT SELECT ON public.items TO anon,authenticated;
   GRANT INSERT(id,user_id,title,description,price,category,condition,location),UPDATE(title,description,location) ON public.items TO authenticated;
   CREATE TABLE public.posts(id uuid PRIMARY KEY,user_id uuid,content text,content_i18n jsonb,status text DEFAULT 'active');
   CREATE TABLE public.post_comments(id uuid PRIMARY KEY,post_id uuid REFERENCES public.posts ON DELETE CASCADE,user_id uuid,content text,status text DEFAULT 'active');
   GRANT SELECT ON public.posts,public.post_comments TO anon,authenticated;
   GRANT SELECT,UPDATE ON public.items,public.posts,public.post_comments TO service_role;
   GRANT USAGE ON SCHEMA moderation_private TO service_role;
   CREATE FUNCTION moderation_private.profile_content_visible(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT $1 <> '22222222-2222-4222-8222-222222222222'::uuid $$;
  `)
  sql('BEGIN;'+read('../supabase/migrations/20260916202229_durable_listing_english.sql')+'COMMIT;')
  sql(read('../supabase/migrations/20260917033744_street_location_checks.sql'))
  sql(read('../supabase/migrations/20260917034051_public_content_english.sql'))
  sql(read('../supabase/_ops/REGRESSION_20260917_street_location_checks.sql'))
  sql(read('../supabase/_ops/REGRESSION_20260917_public_content_english.sql'))
  for(const role of ['anon','authenticated']) {
   assert.throws(()=>sql(`SET ROLE ${role}; SELECT * FROM private.street_location_checks`),/permission denied/)
   assert.throws(()=>sql(`SET ROLE ${role}; SELECT * FROM translation_private.public_content_jobs`),/permission denied/)
   assert.throws(()=>sql(`SET ROLE ${role}; SELECT public.claim_public_content_translation()`),/permission denied/)
  }
  sql(read('../supabase/_ops/ROLLBACK_20260917_street_public_english.sql'))
  assert.equal(sql('SET ROLE service_role; SELECT public.claim_public_content_translation()'),'')
  assert.equal(sql("SET ROLE service_role; SELECT public.issue_street_location_check(NULL,NULL,NULL,NULL)"),'')
  assert.equal(sql("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='items' AND column_name='location_checked_at'"),'1','rollback preserves stored data structure')
  // Restore only the claim body for the visibility check below.
  const forward=read('../supabase/migrations/20260917034051_public_content_english.sql')
  sql(forward.slice(forward.indexOf('CREATE FUNCTION public.claim_public_content_translation()'),forward.indexOf('CREATE FUNCTION public.finish_public_content_translation')).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION'))
  sql(`INSERT INTO public.posts(id,user_id,content) VALUES('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','隐藏的文章')`)
  assert.equal(sql('SET ROLE service_role; SELECT public.claim_public_content_translation()'),'','hidden account is never sent to translation')
 } finally {try{if(started)run('pg_ctl',['-D',data,'-m','immediate','-w','stop'])}finally{rmSync(dir,{recursive:true,force:true})}}
})
