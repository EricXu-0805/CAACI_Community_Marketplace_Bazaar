import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync, execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { postgresBinDir } from './_postgres-bin.mjs'
const bin = postgresBinDir()
const read = name => readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8')
const legacy = read('20260717141822_enforce_symmetric_chat_block_boundary.sql')
const migration = read('20260916050227_direct_profile_conversations.sql')
const id = n => 'caac0916-2026-4000-8000-'+String(n).padStart(12,'0')

test('direct conversations: actual migration preserves RLS, bilateral blocks, listing evidence, rate limits and concurrent uniqueness', {skip: !bin && 'local PostgreSQL required'}, async () => {
 const dir=mkdtempSync(join(tmpdir(),'direct-conversation-')),data=join(dir,'data'),port=String(50000+Math.floor(Math.random()*10000))
 const run=(name,args,input)=>execFileSync(join(bin,name),args,{input,encoding:'utf8',timeout:60000,stdio:['pipe','pipe','pipe']})
 const args=['-X','-h',dir,'-p',port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-qtA']
 const sql=input=>run('psql',args,input).trim()
 const asUser=(uid,body)=>`BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='${uid}'; ${body}; COMMIT;`
 const dm=(a,b)=>`INSERT INTO conversations(buyer_id,seller_id,is_direct) VALUES('${a}','${b}',true) RETURNING id`
 const rejected=(uid,statement,pattern)=>assert.throws(()=>sql(asUser(uid,statement)),error=>pattern.test(String(error.stderr)),statement)
 let started=false
 try {
  run('initdb',['-D',data,'-A','trust','-U','postgres','--locale=C','-E','UTF8'])
  run('pg_ctl',['-D',data,'-o',`-p ${port} -k ${dir} -c listen_addresses=''`,'-l',join(dir,'pg.log'),'-w','start']);started=true
  sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO authenticated,anon;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TYPE item_status AS ENUM('active','sold','deleted');
    CREATE TABLE profiles(id uuid PRIMARY KEY,suspension_level int DEFAULT 0,suspended_until timestamptz);
    CREATE TABLE items(id uuid PRIMARY KEY,user_id uuid REFERENCES profiles(id),status item_status DEFAULT 'active');
    CREATE TABLE conversations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),item_id uuid REFERENCES items(id) ON DELETE SET NULL,buyer_id uuid NOT NULL REFERENCES profiles(id),seller_id uuid NOT NULL REFERENCES profiles(id),created_at timestamptz DEFAULT now(),last_message_at timestamptz DEFAULT now(),is_pinned_buyer boolean DEFAULT false,is_pinned_seller boolean DEFAULT false,is_muted_buyer boolean DEFAULT false,is_muted_seller boolean DEFAULT false,UNIQUE(item_id,buyer_id,seller_id));
    CREATE TABLE blocks(blocker_id uuid,blocked_id uuid,UNIQUE(blocker_id,blocked_id));
    CREATE TABLE messages(id uuid DEFAULT gen_random_uuid(),conversation_id uuid REFERENCES conversations(id),sender_id uuid,content text);
    CREATE TABLE offers(conversation_id uuid); CREATE TABLE meetups(conversation_id uuid);
    INSERT INTO profiles(id) SELECT ('caac0916-2026-4000-8000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(1,120) n;
    INSERT INTO items(id,user_id) VALUES('${id(200)}','${id(2)}');
    GRANT SELECT ON profiles,items,conversations,messages TO authenticated;
    GRANT INSERT(item_id,buyer_id,seller_id) ON conversations TO authenticated;
    GRANT UPDATE(is_muted_buyer,is_muted_seller) ON conversations TO authenticated;
    GRANT INSERT(conversation_id,sender_id,content) ON messages TO authenticated;
    GRANT INSERT,DELETE,SELECT ON blocks TO authenticated;`)
  // Reuse the real pair predicates, locking/validation triggers and policies.
  sql(legacy.slice(legacy.indexOf('CREATE SCHEMA IF NOT EXISTS private'),legacy.indexOf('-- ---------------------------------------------------------------------------\n-- Symmetric read/write RLS')))
  sql(legacy.slice(legacy.indexOf('CREATE POLICY "Unblocked participants can view conversations"'),legacy.indexOf('DO $conversation_delete_policy$')))
  sql(legacy.slice(legacy.indexOf('CREATE POLICY "Unblocked participants can view messages"'),legacy.indexOf('CREATE POLICY "Unblocked recipients can mark messages read"')))
  sql('ALTER TABLE messages ENABLE ROW LEVEL SECURITY; ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;')
  sql(read('20260903013000_conversation_item_delete_cascade.sql'))
  sql('CREATE TRIGGER trg_conv_flag_ownership BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION enforce_conversation_flag_ownership();')
  const old=sql(asUser(id(1),`INSERT INTO conversations(item_id,buyer_id,seller_id) VALUES('${id(200)}','${id(1)}','${id(2)}') RETURNING id`))
  sql(migration)
  const direct=sql(asUser(id(1),dm(id(1),id(2))))
  assert.notEqual(direct,old)
  assert.equal(sql(asUser(id(1),`SELECT count(*) FROM conversations`)),'2')
  rejected(id(2),dm(id(2),id(1)),/duplicate key/)
  rejected(id(1),dm(id(1),id(1)),/conversation_unavailable/)
  rejected(id(3),dm(id(1),id(2)),/conversation_unavailable|row-level security/)
  rejected(id(1),`INSERT INTO conversations(item_id,buyer_id,seller_id,is_direct) VALUES('${id(200)}','${id(1)}','${id(2)}',true)`,/conversation_unavailable/)
  rejected(id(1),`INSERT INTO conversations(buyer_id,seller_id) VALUES('${id(1)}','${id(2)}')`,/invalid_conversation_item/)
  rejected(id(1),`INSERT INTO conversations(item_id,buyer_id,seller_id) VALUES('${id(200)}','${id(1)}','${id(3)}')`,/invalid_conversation_item/)
  assert.equal(sql(asUser(id(3),'SELECT count(*) FROM conversations')),'0')
  rejected(id(3),`INSERT INTO messages(conversation_id,sender_id,content) VALUES('${direct}','${id(3)}','intruder')`,/conversation_unavailable|row-level security/)
  sql(asUser(id(2),`INSERT INTO messages(conversation_id,sender_id,content) VALUES('${direct}','${id(2)}','hello')`))
  sql(asUser(id(2),`INSERT INTO blocks VALUES('${id(2)}','${id(1)}')`))
  for(const uid of [id(1),id(2)]) {
    assert.equal(sql(asUser(uid,'SELECT count(*) FROM conversations')),'0')
    assert.equal(sql(asUser(uid,'SELECT count(*) FROM messages')),'0')
    rejected(uid,`INSERT INTO messages(conversation_id,sender_id,content) VALUES('${direct}','${uid}','blocked')`,/conversation_unavailable/)
  }
  sql(asUser(id(2),`DELETE FROM blocks WHERE blocker_id='${id(2)}'`))
  assert.equal(sql(asUser(id(1),'SELECT count(*) FROM messages')),'1')
  rejected(id(1),`UPDATE conversations SET is_direct=false WHERE id='${direct}'`,/permission denied/)
  // Also exercise the trigger if a future definer function bypasses column ACL.
  sql('GRANT UPDATE(is_direct) ON conversations TO authenticated;')
  rejected(id(1),`UPDATE conversations SET is_direct=false WHERE id='${direct}'`,/immutable_participant_fields/)
  sql('REVOKE UPDATE(is_direct) ON conversations FROM authenticated;')
  sql(`DELETE FROM items WHERE id='${id(200)}'`)
  assert.equal(sql(`SELECT count(*) FROM conversations WHERE item_id IS NULL AND NOT is_direct`),'1')
  sql(`UPDATE profiles SET suspension_level=2 WHERE id='${id(4)}'`)
  rejected(id(1),dm(id(1),id(4)),/conversation_unavailable/)
  rejected(id(4),dm(id(4),id(5)),/conversation_unavailable/)
  sql(`UPDATE profiles SET suspended_until=now()-interval '1 hour' WHERE id='${id(4)}'`)
  sql(asUser(id(4),dm(id(4),id(5))))
  // Truly simultaneous unordered-pair attempts, separate backend sessions.
  const results=await Promise.allSettled([ [id(6),id(7)], [id(7),id(6)] ].map(([a,b])=>promisify(execFile)(join(bin,'psql'),[...args,'-c',asUser(a,dm(a,b))],{encoding:'utf8'})))
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
  assert.match(String(results.find(r=>r.status==='rejected').reason.stderr),/duplicate key/)
  for(let n=20;n<30;n++)sql(asUser(id(10),dm(id(10),id(n))))
  rejected(id(10),dm(id(10),id(30)),/rate_limit_conversations/)
  assert.equal(sql(`SELECT has_column_privilege('anon','conversations','is_direct','SELECT') OR has_column_privilege('anon','conversations','is_direct','INSERT')`),'f')
  assert.equal(sql(`SELECT has_function_privilege('authenticated','public.enforce_chat_block_boundary()','EXECUTE')`),'f')
 } finally {
  if(started)run('pg_ctl',['-D',data,'-m','fast','-w','stop'])
  rmSync(dir,{recursive:true,force:true})
 }
})
