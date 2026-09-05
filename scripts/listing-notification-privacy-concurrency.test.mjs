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
const functionFrom = (source, name) => {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION ${name}()`)
  assert.ok(start >= 0)
  return source.slice(start, source.indexOf('$$;', start) + 3)
}
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
  category text default 'other', price numeric default 10, listing_type text default 'sell');
create table follows(follower_id uuid, followee_id uuid, primary key(follower_id,followee_id));
create table saved_searches(id uuid primary key default gen_random_uuid(), user_id uuid,
  keyword text, category text, price_min numeric, price_max numeric,
  listing_type text default 'both', last_notified_at timestamptz);
create table notifications(id uuid primary key default gen_random_uuid(), user_id uuid,
  type text, title text, body text, item_id uuid, is_read boolean default false);
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

test('listing reminders obey blocks, late blocks, and concurrent search throttles', { skip: !bin && 'local PostgreSQL unavailable' }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'listing-notif-'))
  const data = join(dir, 'data')
  const port = String(50000 + Math.floor(Math.random() * 10000))
  const args = ['-h', dir, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qtA']
  const sql = input => execFileSync(join(bin, 'psql'), args, { input, encoding: 'utf8' }).trim()
  const concurrent = (input, name) => exec(join(bin, 'psql'), [...args, '-c', input], {
    env: { ...process.env, PGAPPNAME: name }, timeout: 10_000,
  })
  const reset = () => sql(`truncate items, notifications, saved_searches, follows, blocks, suspensions;
    insert into saved_searches(user_id,keyword) values('${READER}','desk');`)
  const insert = `insert into items(user_id) values('${SELLER}');`
  const count = () => Number(sql('select count(*) from notifications;'))
  async function overlap({ rollback = false, publishers = 1 } = {}) {
    const first = concurrent(`begin; ${insert} select pg_sleep(1); ${rollback ? 'rollback' : 'commit'};`, 'listing-notif-first')
    const deadline = Date.now() + 5000
    while (sql("select count(*) from pg_stat_activity where application_name='listing-notif-first' and wait_event='PgSleep';") !== '1') {
      assert.ok(Date.now() < deadline, 'first publisher did not enter the overlap window')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    await Promise.all([first, ...Array.from({ length: publishers }, (_, i) => concurrent(insert, `listing-notif-${i}`))])
  }
  execFileSync(join(bin, 'initdb'), ['-D', data, '-A', 'trust', '-U', 'postgres'], { stdio: 'ignore' })
  try {
    execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-o', `-p ${port} -k ${dir} -c listen_addresses=''`,
      '-l', join(dir, 'pg.log'), '-w', 'start'], { stdio: 'ignore' })
    sql(setup)
    sql(functionFrom(read('016_follows.sql'), 'public.notify_followers_on_new_item'))
    sql(functionFrom(read('20260717143223_harden_saved_search_boundaries.sql'), 'public.notify_saved_search_matches'))
    sql(`create trigger followers after insert on items for each row execute function notify_followers_on_new_item();
      create trigger searches after insert on items for each row execute function notify_saved_search_matches();`)
    sql(ops('PRECHECK'))
    await t.test('reproduces both shipped bugs before applying the migration', async () => {
      reset()
      sql(`insert into follows values('${READER}','${SELLER}');
        insert into blocks values('${READER}','${SELLER}'); ${insert}`)
      assert.equal(count(), 2, 'control must reproduce reminders crossing a block')
      reset()
      await overlap()
      assert.equal(count(), 2, 'control must reproduce duplicate daily search reminders')
    })
    sql(read('20260905081748_block_safe_listing_notifications.sql'))
    sql(ops('VERIFY'))
    // Reapplying the candidate must retain the same restrictive policy/ACLs.
    sql(read('20260905081748_block_safe_listing_notifications.sql'))
    sql(ops('VERIFY'))
    await t.test('prevents both block directions without spending the search throttle', () => {
      for (const pair of [[READER, SELLER], [SELLER, READER]]) {
        reset()
        sql(`insert into follows values('${READER}','${SELLER}');
          insert into blocks values('${pair[0]}','${pair[1]}'); ${insert}`)
        assert.equal(count(), 0)
        assert.equal(sql('select last_notified_at is null from saved_searches;'), 't')
        sql(`delete from blocks; ${insert}`)
        assert.equal(count(), 2, 'unblocked eligible reminders still work')
      }
    })
    await t.test('suspended publishers do not fan out their hidden listing titles', () => {
      reset()
      sql(`insert into follows values('${READER}','${SELLER}');
        insert into suspensions(profile_id) values('${SELLER}'); ${insert}`)
      assert.equal(count(), 0)
    })
    await t.test('existing reminders disappear through authenticated SELECT after a later block', () => {
      reset(); sql(insert)
      const asReader = statement => sql(`begin; set local role authenticated;
        set local request.jwt.claim.sub='${READER}'; ${statement} commit;`)
      assert.equal(asReader('select count(*) from notifications;'), '1')
      sql(`insert into blocks values('${SELLER}','${READER}');`)
      assert.equal(asReader('select count(*) from notifications;'), '0')
      assert.equal(count(), 1, 'the existing record is preserved, not destructively erased')
      sql(`delete from blocks; update items set status='deleted';`)
      assert.equal(asReader('select count(*) from notifications;'), '0')
    })
    await t.test('17 overlapping publishers consume a saved-search daily slot once', async () => {
      reset(); await overlap({ publishers: 16 }); assert.equal(count(), 1)
      assert.equal(sql('select count(*) from items;'), '17')
    })
    await t.test('a rolled-back publisher cannot consume the successful publisher reminder', async () => {
      reset(); await overlap({ rollback: true }); assert.equal(count(), 1)
      assert.equal(sql('select count(*) from items;'), '1')
    })
    await t.test('non-item system notices remain readable and other recipients remain private', () => {
      reset()
      sql(`insert into notifications(user_id,type,title,body) values
        ('${READER}','system','Report resolved','report_outcome_resolved'),
        ('${OTHER}','system','Private','appeal_outcome_denied'),
        ('${READER}','system','Unattributed listing','saved_search_match');`)
      assert.equal(sql(`begin; set local role authenticated;
        set local request.jwt.claim.sub='${READER}'; select title from notifications; commit;`), 'Report resolved')
      assert.equal(sql("select has_function_privilege('authenticated','notify_saved_search_matches()','EXECUTE');"), 'f')
    })
    if (process.env.CAACI_LOCAL_FANOUT_BENCHMARK === 'true') {
      await t.test('optional synthetic fanout timing (local fixture, not hosted capacity)', () => {
        sql(`create index idx_follows_followee on follows(followee_id);
          create index idx_saved_searches_user on saved_searches(user_id);`)
        for (const size of [0, 100, 1000, 10000]) {
          reset()
          sql(`truncate saved_searches;
            insert into follows select gen_random_uuid(),'${SELLER}' from generate_series(1,${size});
            insert into saved_searches(user_id,keyword) select follower_id,'desk' from follows;
            analyze follows; analyze saved_searches;`)
          const timings = []
          for (let i = 0; i < 5; i++) {
            sql('truncate notifications; update saved_searches set last_notified_at=null;')
            const plan = JSON.parse(sql(`explain (analyze, format json) ${insert}`))[0]
            timings.push(plan['Execution Time'])
            assert.equal(count(), size * 2)
          }
          timings.sort((a, b) => a - b)
          t.diagnostic(JSON.stringify({ kind: 'local-fanout', followers: size, matching_searches: size,
            notifications_per_publish: size * 2, median_ms: timings[2], max_ms: timings[4] }))
        }
      })
    }
  } finally {
    try { execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], { stdio: 'ignore' }) } catch {}
    rmSync(dir, { recursive: true, force: true })
  }
})
