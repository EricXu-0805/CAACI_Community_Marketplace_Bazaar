import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync, execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
const bin = ['/opt/homebrew/opt/postgresql@17/bin','/usr/lib/postgresql/17/bin'].find(p => existsSync(join(p,'initdb')))
const id = n => `caac0916-2026-4000-8000-${String(n).padStart(12,'0')}`
const code = n => String(n).repeat(64)
const app = 'wx1234567890abcdef'
const oid = n => `verified_openid_${n}`

test('WeChat account linking: actual SQL protects both identities, confirmation, replay and concurrent consumption', {skip: !bin && 'local PostgreSQL required'}, async () => {
 const dir=mkdtempSync(join(tmpdir(),'wechat-link-')),data=join(dir,'data'),port=String(50000+Math.floor(Math.random()*10000))
 const run=(name,args,input)=>execFileSync(join(bin,name),args,{input,encoding:'utf8',timeout:60000,stdio:['pipe','pipe','pipe']})
 const args=['-X','-h',dir,'-p',port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-qtA']
 const sql=input=>run('psql',args,input).trim()
 const rpc=(name,params)=>`SET ROLE service_role; SELECT public.wechat_link_${name}(${params}); RESET ROLE;`
 const issue=(u=1,s=101,h=code(1))=>rpc('issue',`'${id(u)}','${id(s)}','${h}','${app}'`)
 const preview=(h=code(1),o=oid(1),proof=code(2))=>rpc('preview',`'${h}','${app}','${o}',NULL,'${proof}'`)
 const confirm=(h=code(1),o=oid(1),proof=code(2))=>rpc('confirm',`'${h}','${app}','${o}',NULL,'${proof}'`)
 const result=q=>JSON.parse(sql(q))
 let started=false
 try {
  run('initdb',['-D',data,'-A','trust','-U','postgres','--locale=C','-E','UTF8'])
  run('pg_ctl',['-D',data,'-o',`-p ${port} -k ${dir} -c listen_addresses=''`,'-l',join(dir,'pg.log'),'-w','start']);started=true
  sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE SCHEMA private;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz DEFAULT now(),banned_until timestamptz,deleted_at timestamptz);
    CREATE TABLE auth.mfa_factors(user_id uuid,status text);
    CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id),created_at timestamptz DEFAULT now(),not_after timestamptz);
    CREATE TABLE profiles(id uuid PRIMARY KEY REFERENCES auth.users(id),wechat_openid text UNIQUE,wechat_unionid text,nickname text,suspension_level int DEFAULT 0,suspended_until timestamptz);
    CREATE TABLE account_deletion_jobs(user_id uuid PRIMARY KEY);
    CREATE TABLE items(user_id uuid REFERENCES profiles(id),title text);
    INSERT INTO auth.users(id,email) SELECT ('caac0916-2026-4000-8000-'||lpad(n::text,12,'0'))::uuid,'member'||n||'@example.test' FROM generate_series(1,9)n;
    INSERT INTO profiles(id,nickname) SELECT id,'Existing member' FROM auth.users;
    INSERT INTO auth.sessions(id,user_id) SELECT ('caac0916-2026-4000-8000-'||lpad((n+100)::text,12,'0'))::uuid,('caac0916-2026-4000-8000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(1,9)n;
    INSERT INTO items VALUES('${id(1)}','My original listing');`)
  sql(readFileSync(new URL('../supabase/migrations/20260916073035_wechat_account_link_tickets.sql',import.meta.url),'utf8'))
  for(const role of ['anon','authenticated']) {
    assert.throws(()=>sql(`SET ROLE ${role}; SELECT public.wechat_link_issue('${id(1)}','${id(101)}','${code(1)}','${app}');`),/permission denied/)
    assert.equal(sql(`SELECT has_table_privilege('${role}','private.wechat_link_requests','SELECT')`),'f')
  }
  assert.equal(sql(`SELECT has_table_privilege('service_role','private.wechat_link_requests','SELECT')`),'f')
  assert.equal(result(issue(1,102)).error,'reauth_required','a session from another account is not proof')
  sql(`UPDATE auth.sessions SET created_at=now()-interval '31 minutes' WHERE id='${id(102)}'`)
  assert.equal(result(issue(2,102)).error,'reauth_required')
  assert.ok(result(issue()).expires_at)
  assert.equal(sql(`SELECT wechat_openid IS NULL FROM profiles WHERE id='${id(1)}'`),'t')
  const shown=result(preview())
  assert.equal(shown.nickname,'Existing member')
  assert.equal(shown.email_label,'m***@example.test')
  assert.equal(shown.user_id,undefined)
  assert.equal(sql(`SELECT wechat_openid IS NULL FROM profiles WHERE id='${id(1)}'`),'t','preview must not bind')
  assert.equal(result(confirm(code(1),oid(1),code(3))).error,'link_expired')
  assert.equal(result(confirm(code(1),oid(2))).error,'link_expired','proof cannot be used by another WeChat identity')
  assert.equal(result(confirm()).user_id,id(1))
  assert.equal(result(confirm()).error,'link_expired','one-time proof cannot replay')
  assert.equal(sql(`SELECT user_id FROM items WHERE title='My original listing'`),id(1))
  assert.equal(result(issue()).error,'already_linked')
  assert.equal(sql(`SELECT proof_hash IS NULL AND pending_openid IS NULL FROM private.wechat_link_requests WHERE user_id='${id(1)}'`),'t')

  // Two confirmed accounts must never silently merge or transfer ownership.
  assert.ok(result(issue(3,103,code(3))).expires_at)
  assert.equal(result(preview(code(3),oid(1))).error,'link_conflict')
  assert.equal(sql(`SELECT id FROM profiles WHERE wechat_openid='${oid(1)}'`),id(1))
  result(preview(code(3),oid(3)))
  assert.equal(result(preview(code(3),oid(4))).error,'link_expired','a reserved code cannot switch identity')
  // Separate database sessions race the same confirm. Exactly one can consume.
  const concurrent=await Promise.all([1,2].map(()=>promisify(execFile)(join(bin,'psql'),[...args,'-c',confirm(code(3),oid(3))],{encoding:'utf8'})))
  const outcomes=concurrent.map(r=>JSON.parse(r.stdout.trim()))
  assert.equal(outcomes.filter(r=>r.user_id===id(3)).length,1)
  assert.equal(outcomes.filter(r=>r.error==='link_expired').length,1)

  sql(`INSERT INTO auth.mfa_factors VALUES('${id(4)}','verified')`)
  assert.equal(result(issue(4,104,code(4))).error,'reauth_required','MFA enrollment cannot be bypassed by adding a weaker provider')
  sql(`DELETE FROM auth.mfa_factors WHERE user_id='${id(4)}'`)
  result(issue(4,104,code(4)))
  sql(`DELETE FROM auth.sessions WHERE id='${id(104)}'`)
  assert.equal(result(preview(code(4),oid(4))).error,'link_expired','logout invalidates issued codes')
  result(issue(5,105,code(5)))
  result(preview(code(5),oid(5)))
  sql(`UPDATE auth.sessions SET not_after=now()-interval '1 second' WHERE id='${id(105)}'`)
  assert.equal(result(confirm(code(5),oid(5))).error,'link_expired','expiry between preview and confirmation closes the flow')
  result(issue(6,106,code(6)))
  sql(`UPDATE private.wechat_link_requests SET created_at=now()-interval '6 minutes',expires_at=now()-interval '1 minute' WHERE user_id='${id(6)}'`)
  assert.equal(result(preview(code(6),oid(6))).error,'link_expired')
  result(issue(6,106,code(7)))
  assert.equal(result(preview(code(6),oid(6))).error,'link_expired','regeneration invalidates the old code')
  result(preview(code(7),oid(6)))
  sql(`INSERT INTO account_deletion_jobs VALUES('${id(6)}')`)
  assert.equal(result(confirm(code(7),oid(6))).error,'link_expired','deletion begun after preview cannot be bypassed')
  sql(`UPDATE profiles SET suspension_level=2 WHERE id='${id(7)}'; UPDATE auth.users SET email_confirmed_at=NULL WHERE id='${id(8)}'; UPDATE auth.users SET email='wx_placeholder@wechat.placeholder' WHERE id='${id(9)}'`)
  for(const u of [7,8,9])assert.equal(result(issue(u,u+100,code(8))).error,'reauth_required')
  const before=Number(sql('SELECT count(*) FROM private.wechat_link_requests'))
  sql(`UPDATE private.wechat_link_requests SET created_at=now()-interval '6 minutes',expires_at=now()-interval '1 minute' WHERE user_id='${id(1)}'`)
  const pruned=result('SET ROLE service_role; SELECT public.prune_wechat_link_requests(); RESET ROLE;')
  assert.equal(pruned.deleted,1);assert.equal(pruned.has_more,false)
  assert.equal(Number(sql('SELECT count(*) FROM private.wechat_link_requests')),before-1)
  assert.equal(sql(`SELECT id FROM profiles WHERE wechat_openid='${oid(1)}'`),id(1),'retention never deletes a binding or user')
 } finally {
  if(started)run('pg_ctl',['-D',data,'-m','fast','-w','stop'])
  rmSync(dir,{recursive:true,force:true})
 }
})
