import test from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import { postgresBinDir } from './_postgres-bin.mjs'
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8')
const bin=postgresBinDir()
const q=s=>"'"+String(s).replaceAll("'","''")+"'"
test('durable English jobs retain originals, exclude private rows, reject stale leases and retry safely',{skip:!bin&&'PostgreSQL17 unavailable'},()=>{
 const dir=mkdtempSync(join(tmpdir(),'listing-english-')),data=join(dir,'data'),port=String(50000+Math.floor(Math.random()*10000))
 const run=(n,args,input)=>execFileSync(join(bin,n),args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:60000})
 const sql=s=>run('psql',['-X','-h',dir,'-p',port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-qtA'],s).trim()
 const service=s=>sql('BEGIN; SET LOCAL ROLE service_role; '+s+';COMMIT;')
 let started=false
 try{
  run('initdb',['-D',data,'-A','trust','-U','postgres','--locale=en_US.UTF-8','-E','UTF8'])
  run('pg_ctl',['-D',data,'-o',`-p ${port} -k ${dir} -c listen_addresses=''`,'-l',join(dir,'log'),'-w','start']);started=true
  sql(read('./listing-details.test.mjs').split('const setup=`')[1].split('\n`')[0])
  sql(`ALTER ROLE service_role BYPASSRLS; GRANT SELECT,UPDATE ON items TO service_role;
   CREATE SCHEMA moderation_private; GRANT USAGE ON SCHEMA moderation_private TO service_role;
   CREATE FUNCTION moderation_private.profile_content_visible(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT $1<>'22222222-2222-4222-8222-222222222222'::uuid $$;
   INSERT INTO items(title,description,user_id,title_i18n) VALUES('宠物航空箱 XL','尺寸 32.225 英寸','11111111-1111-4111-8111-111111111111','{"en":"宠物航空箱 XL"}');`)
  sql('BEGIN;'+read('../supabase/migrations/20260916202229_durable_listing_english.sql')+'COMMIT;')
  assert.throws(()=>sql('SET ROLE anon; SELECT public.claim_listing_translation();'),/permission denied/)
  assert.throws(()=>sql('SET ROLE authenticated; SELECT * FROM translation_private.listing_jobs;'),/permission denied/)
  const claim=()=>JSON.parse(service('SELECT claim_listing_translation()') || 'null')
  const finish=(j,title,desc,failure=null)=>service(`SELECT finish_listing_translation(${q(j.id)},${j.revision},${q(j.lease)},${q(j.title)},${q(j.description)},${title==null?'NULL':q(title)},${desc==null?'NULL':q(desc)},${failure==null?'NULL':q(failure)})`)
  let job=claim();assert.equal(job.title_needed,true);assert.equal(job.description_needed,true)
  assert.equal(claim(),null,'live lease cannot be double claimed')
  assert.throws(()=>finish(job,'宠物航空箱','32 inches'),/invalid_english_title/)
  assert.equal(finish(job,'Pet airline crate XL','Size: 32.225 inches'), 't')
  let row=JSON.parse(sql(`SELECT row_to_json(i) FROM items i WHERE id=${q(job.id)}`))
  assert.equal(row.title,'宠物航空箱 XL');assert.equal(row.description,'尺寸 32.225 英寸')
  assert.equal(row.title_i18n.en,'Pet airline crate XL');assert.equal(claim(),null)
  sql(`UPDATE items SET title='升降桌',title_i18n='{"zh":"升降桌"}' WHERE id=${q(job.id)}`)
  const old=claim();sql(`UPDATE items SET title='电动升降桌',title_i18n='{"zh":"电动升降桌"}' WHERE id=${q(job.id)}`)
  assert.equal(finish(old,'Desk','Old description'),'f','edit invalidates in-flight work')
  job=claim();assert.equal(job.title,'电动升降桌');assert.equal(job.description_needed,false)
  assert.equal(finish(job,null,null,'provider_unavailable'),'t');assert.equal(claim(),null,'retry has backoff')
  sql(`UPDATE translation_private.listing_jobs SET available_at=now()-interval '1 second'`)
  job=claim();assert.equal(finish(job,'Electric standing desk',null),'t')
  row=JSON.parse(sql(`SELECT row_to_json(i) FROM items i WHERE id=${q(job.id)}`));assert.equal(row.description_i18n.en,'Size: 32.225 inches','unrequested field preserved')
  sql(`INSERT INTO items(title,user_id) VALUES('隐藏物品','22222222-2222-4222-8222-222222222222')`)
  assert.equal(claim(),null,'hidden seller content never leaves for translation')
  sql(`UPDATE items SET description='新的说明',description_i18n=NULL WHERE id=${q(job.id)}`)
  job=claim();sql(`UPDATE items SET status='deleted' WHERE id=${q(job.id)}`)
  assert.equal(finish(job,null,'New description'),'f','deleted listing cannot be revived by translation')
  assert.equal(service("SELECT listing_translation_status()->>'failed'"),'0')
  sql('BEGIN;'+read('../supabase/_ops/ROLLBACK_20260916_durable_listing_english.sql')+'COMMIT;')
  assert.throws(()=>claim(),/permission denied/)
  sql('BEGIN;'+read('../supabase/migrations/20260916202229_durable_listing_english.sql')+'COMMIT;')
  assert.equal(claim(),null,'rollback and reapply do not revive deleted or hidden content')
 }finally{try{if(started)run('pg_ctl',['-D',data,'-m','immediate','-w','stop'])}finally{rmSync(dir,{recursive:true,force:true})}}
})
