import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const bin=['/opt/homebrew/opt/postgresql@17/bin','/usr/lib/postgresql/17/bin'].find(p=>existsSync(join(p,'initdb')))
const migration=readFileSync(new URL('../supabase/migrations/20260916192738_private_conversation_media.sql',import.meta.url),'utf8')
const buyer='11111111-1111-4111-8111-111111111111',seller='22222222-2222-4222-8222-222222222222',stranger='33333333-3333-4333-8333-333333333333',conv='44444444-4444-4444-8444-444444444444',msg='55555555-5555-4555-8555-555555555555'
const path=`items/${buyer}/${conv}/${msg}.jpg`
test('private chat attachments enforce participant, owner, immutable content and resource boundaries',{skip:!bin&&'local PostgreSQL unavailable'},()=>{
 const dir=mkdtempSync(join(tmpdir(),'chat-media-')),data=join(dir,'data'),port=String(50000+Math.floor(Math.random()*10000))
 const run=(name,args,input)=>execFileSync(join(bin,name),args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe']})
 const sql=input=>run('psql',['-X','-h',dir,'-p',port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-qtA'],input).trim()
 const as=(uid,input,role='authenticated')=>sql(`BEGIN; SET LOCAL ROLE ${role}; SELECT set_config('request.jwt.claim.sub','${uid}',true); ${input}; COMMIT;`).split('\n').slice(uid ? 1 : 0).join('\n')
 const upload=(uid,name=path,mime='image/jpeg',size=100)=>as(uid,`INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('chat-media','${name}','{"mimetype":"${mime}","size":${size}}')`)
 const send=(uid,content=path,id=msg,type='image')=>as(uid,`INSERT INTO messages VALUES('${id}','${conv}','${uid}','${content}','${type}')`)
 run('initdb',['-D',data,'-A','trust','-U','postgres'])
 try{
  run('pg_ctl',['-D',data,'-o',`-p ${port} -k ${dir} -c listen_addresses=''`,'-l',join(dir,'pg.log'),'-w','start'])
  sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA private; CREATE SCHEMA auth; CREATE SCHEMA storage;
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   CREATE TABLE conversations(id uuid PRIMARY KEY,buyer_id uuid,seller_id uuid,blocked boolean DEFAULT false);
   CREATE TABLE messages(id uuid PRIMARY KEY,conversation_id uuid REFERENCES conversations,sender_id uuid,content text,message_type text);
   CREATE TABLE suspended(id uuid); CREATE TABLE deleted_accounts(id uuid);
   CREATE FUNCTION private.current_user_can_access_pair(a uuid,b uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT auth.uid() IN(a,b) AND NOT EXISTS(SELECT 1 FROM public.conversations WHERE blocked AND buyer_id=a AND seller_id=b) $$;
   CREATE FUNCTION private.current_account_storage_writes_allowed() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT NOT EXISTS(SELECT 1 FROM public.deleted_accounts WHERE id=auth.uid()) $$;
   CREATE FUNCTION public.is_posting_allowed(id_in uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT NOT EXISTS(SELECT 1 FROM public.suspended WHERE id=id_in) $$;
   CREATE FUNCTION private.assert_text_boundary(text,text,integer,integer,integer,boolean) RETURNS void LANGUAGE sql AS $$ SELECT $$;
   CREATE FUNCTION private.assert_moderated_text(text,text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
   CREATE FUNCTION private.old_boundary() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
   CREATE TRIGGER authoritative_public_write_boundary BEFORE INSERT ON messages FOR EACH ROW EXECUTE FUNCTION private.old_boundary();
   CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text UNIQUE,metadata jsonb,version text,created_at timestamptz DEFAULT now());
   ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
   GRANT USAGE ON SCHEMA public,auth,private,storage TO authenticated,anon;
   GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated,anon;
   GRANT SELECT,INSERT ON messages TO authenticated;
   INSERT INTO conversations VALUES('${conv}','${buyer}','${seller}',false);`)
  sql(migration)
  sql(readFileSync(new URL('../supabase/migrations/20260916211900_chat_media_storage_preflight.sql', import.meta.url),'utf8'))
  assert.equal(sql("SELECT public FROM storage.buckets WHERE id='chat-media'"),'f')
  assert.throws(()=>upload(stranger),/row-level security|access_denied/)
  assert.throws(()=>upload(seller),/row-level security|access_denied/)
  assert.throws(()=>upload(buyer,path,'image/svg+xml'),/invalid_file/)
  assert.throws(()=>upload(buyer,path,'image/jpeg',5242881),/invalid_file/)
  // Real Storage's permission check has declared contentLength only, then
  // rolls back. Such a provisional object can never authorize a message.
  as(buyer,`INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES('chat-media','${path}','1','{"mimetype":"image/jpeg","contentLength":100}')`)
  assert.throws(()=>send(buyer),/invalid_reference/)
  sql(`DELETE FROM storage.objects WHERE name='${path}'`)
  assert.throws(()=>as(buyer,`INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES('chat-media','${path}','real-version','{"mimetype":"image/jpeg","contentLength":100}')`),/invalid_size/)
  upload(buyer)
  assert.equal(as(seller,'SELECT count(*) FROM storage.objects'),'0','unsent attachment remains private to sender')
  assert.throws(()=>send(seller),/invalid_reference/)
  assert.throws(()=>send(buyer,'https://public.example/photo.jpg'),/invalid_reference/)
  send(buyer)
  assert.equal(as(seller,'SELECT count(*) FROM storage.objects'),'1')
  assert.equal(as(stranger,'SELECT count(*) FROM storage.objects'),'0')
  assert.equal(as('','SELECT count(*) FROM storage.objects','anon'),'0')
  as(buyer,`DELETE FROM storage.objects WHERE name='${path}'`)
  assert.equal(sql('SELECT count(*) FROM storage.objects'),'1','cannot delete delivered attachment')
  as(buyer,`UPDATE storage.objects SET metadata='{"mimetype":"image/jpeg","size":5}' WHERE name='${path}'`)
  assert.equal(sql("SELECT metadata->>'size' FROM storage.objects"),'100','no replacement policy')
  sql(`UPDATE conversations SET blocked=true`)
  assert.equal(as(buyer,'SELECT count(*) FROM storage.objects'),'0');assert.equal(as(seller,'SELECT count(*) FROM storage.objects'),'0')
  sql(`UPDATE conversations SET blocked=false; INSERT INTO suspended VALUES('${buyer}');`)
  assert.equal(as(buyer,'SELECT count(*) FROM storage.objects'),'0')
  sql(`DELETE FROM suspended; INSERT INTO deleted_accounts VALUES('${buyer}');`)
  assert.equal(as(buyer,'SELECT count(*) FROM storage.objects'),'0')
  sql('DELETE FROM deleted_accounts')
  const orphanId='66666666-6666-4666-8666-666666666666',orphan=path.replace(msg,orphanId)
  upload(buyer,orphan)
  sql("UPDATE storage.objects SET created_at=now()-interval '2 days'")
  const claimed=JSON.parse(sql('SELECT public.claim_chat_media_orphan()'))
  assert.equal(claimed.name,orphan,'collector must never claim a delivered attachment')
  assert.throws(()=>send(buyer,orphan,orphanId),/invalid_reference/)
  assert.equal(sql(`SELECT public.finish_chat_media_orphan('${orphan}')`),'f')
  sql(`DELETE FROM storage.objects WHERE name='${orphan}'`)
  assert.equal(sql(`SELECT public.finish_chat_media_orphan('${orphan}')`),'t')
  assert.equal(sql('SELECT public.claim_chat_media_orphan()'),'')
  assert.equal(sql("SELECT has_function_privilege('authenticated','public.claim_chat_media_orphan()','execute')"),'f')
 }finally{try{run('pg_ctl',['-D',data,'-m','immediate','-w','stop'])}finally{rmSync(dir,{recursive:true,force:true})}}
})
