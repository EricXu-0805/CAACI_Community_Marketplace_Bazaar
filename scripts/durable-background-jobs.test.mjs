import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const bin = ['/opt/homebrew/opt/postgresql@17/bin', '/opt/homebrew/opt/postgresql@16/bin',
  '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin'].find(dir => existsSync(join(dir, 'initdb')))
const root = new URL('../supabase/migrations/', import.meta.url)
const read = name => readFileSync(new URL(name, root), 'utf8')
const ops = name => readFileSync(new URL(`../_ops/${name}_20260905_block_safe_listing_notifications.sql`, root), 'utf8')
const SELLER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const READER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const OTHER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const setup = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema moderation_private;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema public, auth to authenticated;
create table profiles(id uuid primary key);
create table suspensions(profile_id uuid, shadow_banned boolean default true);
create function moderation_private.current_profile_state(profile_id_in uuid)
returns table(shadow_banned boolean) language sql stable security definer set search_path=pg_catalog as $$
  select coalesce(bool_or(s.shadow_banned),false) from public.suspensions s where s.profile_id=profile_id_in $$;
create table blocks(blocker_id uuid, blocked_id uuid, primary key(blocker_id,blocked_id));
create table items(id uuid primary key default gen_random_uuid(), user_id uuid not null,
  title text default 'desk', description text default '', status text default 'active',
  images text[] default '{}', category text default 'other', price numeric default 10, listing_type text default 'sell');
create table follows(follower_id uuid, followee_id uuid, created_at timestamptz default clock_timestamp(), primary key(follower_id,followee_id));
create table saved_searches(id uuid primary key default gen_random_uuid(), user_id uuid,
  keyword text, category text, price_min numeric, price_max numeric,
  listing_type text default 'both', last_notified_at timestamptz, created_at timestamptz default clock_timestamp());
create table notifications(id uuid primary key default gen_random_uuid(), user_id uuid,
  type text, title text, body text, item_id uuid, is_read boolean default false,
  created_at timestamptz default clock_timestamp(), emailed_at timestamptz);
create table posts(id uuid primary key default gen_random_uuid(),user_id uuid not null,status text default 'active',images text[] default '{}');
create unique index notifications_saved_search_unique_per_item on notifications(user_id,item_id)
  where type='system' and body='saved_search_match' and item_id is not null;
alter table notifications enable row level security;
create policy "Users read own notifications" on notifications for select to authenticated
  using(user_id=(select auth.uid()));
alter table items enable row level security;
create policy items_visible on items for select to authenticated using (
  status <> 'deleted' and not exists(select 1 from blocks b
    where (b.blocker_id=auth.uid() and b.blocked_id=items.user_id)
       or (b.blocked_id=auth.uid() and b.blocker_id=items.user_id)));
grant select on notifications, items, blocks to authenticated;
insert into profiles values ('${SELLER}'),('${READER}'),('${OTHER}');
`

test('durable background jobs: actual PostgreSQL privacy, contention and recovery', { skip: !bin && 'local PostgreSQL unavailable' }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'durable-jobs-'))
  const data = join(dir, 'data')
  const port = String(50000 + Math.floor(Math.random() * 10000))
  const args = ['-h', dir, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qtA']
  const sql = input => execFileSync(join(bin, 'psql'), args, { input, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }).trim()
  const concurrent = input => exec(join(bin, 'psql'), [...args, '-c', input], { timeout: 15_000 })
  const reset = () => sql('truncate items, posts, notifications, saved_searches, follows, blocks, suspensions, private.moderation_media_jobs, private.listing_notification_jobs cascade;')
  const count = () => Number(sql('select count(*) from notifications;'))
  const publish = `insert into items(user_id) values('${SELLER}') returning id;`
  const processOne = size => JSON.parse(sql(`select process_listing_notification_job(${size ?? 100});`))
  const drain = () => { for (let i=0; i<1000; i++) { if (!processOne().worked) return }; assert.fail('outbox did not drain') }
  const follow = `insert into follows(follower_id,followee_id) values('${READER}','${SELLER}');`
  const search = `insert into saved_searches(user_id,keyword) values('${READER}','desk');`
  const photo = `https://supabase.test/storage/v1/object/public/item-images/items/${SELLER}/test.png`
  const hidden = () => sql(`insert into items(user_id,images,status) values('${SELLER}',ARRAY['${photo}'],'deleted') returning id;`)
  const claim = () => JSON.parse(sql('select claim_moderation_media_job();') || 'null')
  const finish = (job, outcome) => sql(`select finish_moderation_media_job('${job.id}','${job.lease_token}','${outcome}');`)
  execFileSync(join(bin, 'initdb'), ['-D', data, '-A', 'trust', '-U', 'postgres'], { stdio: 'ignore' })
  try {
    execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-o', `-p ${port} -k ${dir} -c listen_addresses=''`, '-l', join(dir, 'pg.log'), '-w', 'start'], { stdio: 'ignore' })
    sql(setup)
    sql(read('20260905081748_block_safe_listing_notifications.sql'))
    sql(read('20260905212134_durable_background_jobs.sql'))
    sql(`create trigger followers after insert on items for each row execute function notify_followers_on_new_item();
      create trigger searches after insert on items for each row execute function notify_saved_search_matches();`)
    await t.test('publishing commits one event and no fanout, including 10,000 followers', () => {
      reset()
      sql(`insert into follows(follower_id,followee_id) select gen_random_uuid(),'${SELLER}' from generate_series(1,10000);`)
      const id = sql(publish)
      assert.equal(count(),0)
      assert.equal(sql('select count(*) from private.listing_notification_jobs;'),'1')
      assert.equal(processOne(100).scanned,100)
      assert.equal(count(),100)
      assert.equal(sql(`select count(*) from private.listing_notification_jobs where item_id='${id}' and completed_at is null;`),'1')
      const timings=[]
      for(let i=0;i<5;i++) timings.push(JSON.parse(sql(`explain(analyze,format json) insert into items(user_id) values('${SELLER}');`))[0]['Execution Time'])
      t.diagnostic(JSON.stringify({kind:'local-publish-outbox',followers:10000,notificationsInPublish:0,publish_ms:timings}))
    })
    await t.test('rollbacks do not create orphan events or spend notification slots', () => {
      reset();sql(`${follow}${search}begin;${publish}rollback;`)
      assert.equal(sql('select count(*) from private.listing_notification_jobs;'),'0')
      assert.equal(count(),0)
      sql(publish)
      sql('begin;select process_listing_notification_job();rollback;')
      assert.equal(count(),0)
      drain();assert.equal(count(),2)
    })
    await t.test('late blocks in both directions suppress queued work and preserve search throttle', () => {
      for (const [a,b] of [[SELLER,READER],[READER,SELLER]]) {
        reset();sql(follow+search+publish)
        sql(`insert into blocks values('${a}','${b}');`)
        drain();assert.equal(count(),0)
        assert.equal(sql('select last_notified_at is null from saved_searches;'),'t')
        sql('delete from blocks;'+publish);drain();assert.equal(count(),2)
      }
    })
    await t.test('new subscriptions after publication and hidden sellers/items receive no old alerts', () => {
      reset();sql(publish+follow+search);drain();assert.equal(count(),0)
      for(const update of ["update items set status='sold';",`insert into suspensions(profile_id) values('${SELLER}');`]) {
        reset();sql(follow+search+publish+update);drain();assert.equal(count(),0)
      }
    })
    await t.test('8 overlapping workers produce exactly one alert per follower and one daily search match', async () => {
      reset();sql(follow+search)
      for(let i=0;i<8;i++) sql(publish)
      for(let round=0;round<5;round++) await Promise.all(Array.from({length:8},()=>concurrent('select process_listing_notification_job(1);')))
      drain();assert.equal(count(),9)
      assert.equal(sql("select count(*) from notifications where body='saved_search_match';"),'1')
    })
    await t.test('late visibility filtering still hides historical reminders from the recipient', () => {
      reset();sql(follow+search+publish);drain()
      const reader = () => sql(`begin;set local role authenticated;set local request.jwt.claim.sub='${READER}';select count(*) from notifications;commit;`)
      assert.equal(reader(),'2')
      sql(`insert into blocks values('${SELLER}','${READER}');`);assert.equal(reader(),'0')
    })
    await t.test('media capture commits with hide and rolls back with hide', () => {
      reset()
      const id=sql(`insert into items(user_id,images) values('${SELLER}',ARRAY['${photo}','${photo}']) returning id;`)
      sql(`begin;update items set status='deleted' where id='${id}';rollback;`)
      assert.equal(claim(),null)
      sql(`update items set status='deleted' where id='${id}';`)
      const job=claim();assert.equal(job.image_url,photo);assert.equal(job.owner_id,SELLER)
      assert.equal(claim(),null)
      assert.equal(finish(job,'complete'),'t');assert.equal(finish(job,'complete'),'f')
      assert.equal(claim(),null)
    })
    await t.test('crash recovery and re-hide reject obsolete lease acknowledgements', () => {
      reset();const id=hidden();const first=claim()
      sql("update private.moderation_media_jobs set lease_until=clock_timestamp()-interval '1 second';")
      const second=claim();assert.notEqual(first.lease_token,second.lease_token)
      assert.equal(finish(first,'complete'),'f')
      sql(`update items set status='active' where id='${id}';update items set status='deleted' where id='${id}';`)
      assert.equal(finish(second,'complete'),'f')
      assert.equal(finish(claim(),'complete'),'t')
    })
    await t.test('storage failures back off and stop after ten failures without dropping evidence', () => {
      reset();hidden()
      for(let attempt=1;attempt<=10;attempt++) {
        const job=claim();assert.ok(job)
        assert.equal(finish(job,'storage_unavailable'),'t');assert.equal(claim(),null)
        assert.equal(sql('select attempts from private.moderation_media_jobs;'),String(attempt))
        sql("update private.moderation_media_jobs set due_at=clock_timestamp()-interval '1 second';")
      }
      assert.equal(claim(),null)
      assert.equal(JSON.parse(sql('select background_job_status();')).media_failed,1)
      assert.equal(sql('select image_url from private.moderation_media_jobs;'),photo)
    })
    await t.test('restored posts cancel cleanup; deleted rows retain their evidence task', () => {
      reset()
      const id=sql(`insert into posts(user_id,images,status) values('${SELLER}',ARRAY['${photo}'],'hidden') returning id;`)
      sql(`update posts set status='active' where id='${id}';`)
      assert.deepEqual(claim(),{cancelled:true})
      const item=hidden();sql(`delete from items where id='${item}';`)
      assert.equal(claim().image_url,photo)
    })
    await t.test('concurrent claims never share the same object', async () => {
      reset();hidden()
      const claims=await Promise.all(Array.from({length:8},()=>concurrent('select claim_moderation_media_job();')))
      assert.equal(claims.filter(result=>result.stdout.trim()).length,1)
    })
    await t.test('digest progress is durable, conditional, and wraps without marking rows emailed', () => {
      reset()
      assert.deepEqual(JSON.parse(sql('select get_notification_digest_cursor();')),{after_user_id:null})
      assert.equal(sql(`select advance_notification_digest_cursor(null,'${READER}');`),'t')
      assert.equal(sql(`select advance_notification_digest_cursor(null,'${OTHER}');`),'f')
      assert.equal(JSON.parse(sql('select get_notification_digest_cursor();')).after_user_id,READER)
      assert.equal(sql(`select advance_notification_digest_cursor('${READER}',null);`),'t')
    })
    await t.test('anonymous and authenticated clients cannot read jobs or execute workers', () => {
      for(const role of ['anon','authenticated']) for(const signature of [
        'process_listing_notification_job(integer)','get_notification_digest_cursor()',
        'advance_notification_digest_cursor(uuid,uuid)','claim_moderation_media_job()',
        'finish_moderation_media_job(uuid,uuid,text)','background_job_status()','purge_completed_background_jobs(integer)',
      ]) assert.equal(sql(`select has_function_privilege('${role}','public.${signature}','EXECUTE');`),'f')
      for(const table of ['listing_notification_jobs','moderation_media_jobs','notification_digest_cursor']) {
        assert.equal(sql(`select has_table_privilege('authenticated','private.${table}','SELECT');`),'f')
        assert.equal(sql(`select relrowsecurity from pg_class where oid='private.${table}'::regclass;`),'t')
      }
      assert.throws(()=>processOne(201),/invalid_batch_size/)
    })
    await t.test('retention purges only old completed work in bounded batches', () => {
      reset();hidden();finish(claim(),'complete');hidden()
      sql("update private.moderation_media_jobs set completed_at=clock_timestamp()-interval '31 days' where state='complete';")
      assert.equal(sql('select purge_completed_background_jobs(1);'),'1')
      assert.equal(JSON.parse(sql('select background_job_status();')).media_pending,1)
    })
  } finally {
    try { execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], { stdio: 'ignore' }) } catch {}
    rmSync(dir, { recursive: true, force: true })
  }
})
