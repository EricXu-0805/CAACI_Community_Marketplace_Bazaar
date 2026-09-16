import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const bin=['/opt/homebrew/opt/postgresql@17/bin','/usr/lib/postgresql/17/bin'].find(p=>existsSync(join(p,'initdb')))
const migration=readFileSync(new URL('../supabase/migrations/20260916190808_conversation_manual_unread.sql',import.meta.url),'utf8')
const buyer='11111111-1111-4111-8111-111111111111',seller='22222222-2222-4222-8222-222222222222',stranger='33333333-3333-4333-8333-333333333333',conv='44444444-4444-4444-8444-444444444444'
test('manual unread is per participant, works without messages, and never reverses read receipts',{skip:!bin&&'local PostgreSQL unavailable'},()=>{
 const dir=mkdtempSync(join(tmpdir(),'conversation-unread-')),data=join(dir,'data'),port=String(50000+Math.floor(Math.random()*10000))
 const run=(name,args,input)=>execFileSync(join(bin,name),args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe']})
 const sql=input=>run('psql',['-X','-h',dir,'-p',port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-qtA'],input).trim()
 const as=(uid,input)=>sql(`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${uid}',true); ${input}; COMMIT;`).split('\n').slice(1).join('\n')
 const set=(uid,unread,expected=uid)=>as(uid,`SELECT public.set_conversation_read_state('${conv}','${expected}',${unread});`)
 run('initdb',['-D',data,'-A','trust','-U','postgres'])
 try{
  run('pg_ctl',['-D',data,'-o',`-p ${port} -k ${dir} -c listen_addresses=''`,'-l',join(dir,'pg.log'),'-w','start'])
  sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA private; CREATE SCHEMA auth;
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   GRANT USAGE ON SCHEMA public,auth TO authenticated;
   CREATE TABLE conversations(id uuid PRIMARY KEY,buyer_id uuid,seller_id uuid,blocked boolean DEFAULT false);
   CREATE TABLE messages(id uuid PRIMARY KEY,conversation_id uuid REFERENCES conversations,sender_id uuid,is_read boolean DEFAULT false);
   ALTER TABLE conversations ENABLE ROW LEVEL SECURITY; ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
   CREATE POLICY participant ON conversations TO authenticated USING(NOT blocked AND auth.uid() IN(buyer_id,seller_id)) WITH CHECK(NOT blocked AND auth.uid() IN(buyer_id,seller_id));
   CREATE POLICY recipient ON messages TO authenticated USING(sender_id<>auth.uid() AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=conversation_id)) WITH CHECK(sender_id<>auth.uid());
   GRANT SELECT,UPDATE ON conversations,messages TO authenticated;
   INSERT INTO conversations VALUES('${conv}','${buyer}','${seller}',false);`)
  sql(migration)
  assert.equal(sql("SELECT prosecdef FROM pg_proc WHERE oid='public.set_conversation_read_state'::regproc"),'f')
  assert.equal(sql("SELECT has_function_privilege('anon','public.set_conversation_read_state(uuid,uuid,boolean)','execute')"),'f')
  set(buyer,true)
  assert.equal(sql(`SELECT is_unread_buyer||','||is_unread_seller FROM conversations`),'true,false')
  set(seller,true);set(buyer,false)
  assert.equal(sql(`SELECT is_unread_buyer||','||is_unread_seller FROM conversations`),'false,true')
  assert.throws(()=>as(buyer,`UPDATE conversations SET is_unread_seller=false WHERE id='${conv}'`),/cross_party_flag_update/)
  assert.throws(()=>set(stranger,true),/conversation_unavailable/)
  assert.throws(()=>set(buyer,true,seller),/account_changed/)
  sql(`INSERT INTO messages VALUES(gen_random_uuid(),'${conv}','${seller}',false),(gen_random_uuid(),'${conv}','${buyer}',false);`)
  set(buyer,false)
  assert.equal(sql(`SELECT is_read FROM messages WHERE sender_id='${seller}'`),'t')
  assert.equal(sql(`SELECT is_read FROM messages WHERE sender_id='${buyer}'`),'f')
  set(buyer,true)
  assert.equal(sql(`SELECT is_read FROM messages WHERE sender_id='${seller}'`),'t','a reminder cannot un-read the sellers delivered message')
  sql(`UPDATE conversations SET blocked=true;`)
  assert.throws(()=>set(buyer,false),/conversation_unavailable/)
 }finally{try{run('pg_ctl',['-D',data,'-m','immediate','-w','stop'])}finally{rmSync(dir,{recursive:true,force:true})}}
})
