import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Four things happened on this app and told nobody: being rated, being
 * followed, a comment or a like on your plaza post, and the seller marking
 * the item you bought as sold. Migration 20260903070000 gives each one a
 * notifications row.
 *
 * The rules are the interesting part, so they are what this runs: the right
 * person and only the right person gets a row, never for their own action,
 * never across a block, and an unlike/relike loop cannot produce a second
 * one. It loads the migration into a throwaway Postgres over the smallest
 * slice of schema the triggers touch, with the pre-migration favoriter
 * trigger (065) installed first so the sold case is a real before/after.
 *
 * Needs a local initdb; skips where there is none (CI). The proof is the run.
 */

const REPO = new URL('../', import.meta.url)
const MIGRATION = new URL(
  'supabase/migrations/20260903070000_in_app_activity_notifications.sql',
  REPO,
)

function pgBin() {
  const candidates = [
    '/opt/homebrew/opt/postgresql@17/bin',
    '/opt/homebrew/opt/postgresql@16/bin',
    '/usr/local/opt/postgresql@17/bin',
    '/usr/lib/postgresql/17/bin',
    '/usr/lib/postgresql/16/bin',
  ]
  for (const dir of candidates) if (existsSync(join(dir, 'initdb'))) return dir
  try {
    return execFileSync('sh', ['-c', 'dirname "$(command -v initdb)"'], { encoding: 'utf8' }).trim()
  } catch { return null }
}

const SELLER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const BUYER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const FAN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const ENEMY = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const ITEM = '11111111-1111-4111-8111-111111111111'
const POST = '22222222-2222-4222-8222-222222222222'
const COMMENT = '33333333-3333-4333-8333-333333333333'

/*
 * The smallest slice of the schema these triggers touch. auth.uid() exists
 * because the production database has it, not because the triggers consult
 * it: every recipient below is derived from the row being written, so a
 * session identity cannot redirect a notification.
 */
const SETUP = `
create schema if not exists auth;
create schema if not exists private;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;

create table public.profiles (id uuid primary key);
create table public.items (
  id uuid primary key, user_id uuid not null references public.profiles(id),
  title text not null default 'IKEA desk', price numeric(10,2) not null default 25,
  status text not null default 'active');
create table public.posts (id uuid primary key, user_id uuid not null references public.profiles(id));
create table public.post_comments (
  id uuid primary key, post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id), content text not null default 'hi');
create table public.post_likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id), primary key (post_id, user_id));
create table public.post_comment_likes (
  comment_id uuid not null references public.post_comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id), primary key (comment_id, user_id));
create table public.follows (
  follower_id uuid not null references public.profiles(id),
  followee_id uuid not null references public.profiles(id),
  primary key (follower_id, followee_id), check (follower_id <> followee_id));
create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references public.profiles(id),
  blocked_id uuid not null references public.profiles(id));
create table public.favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  item_id uuid not null references public.items(id) on delete cascade);
create table public.ratings (
  id uuid primary key default gen_random_uuid(),
  rater_id uuid not null references public.profiles(id),
  ratee_id uuid not null references public.profiles(id),
  item_id uuid not null references public.items(id) on delete cascade,
  stars int not null, comment text);
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null, body text not null default '',
  item_id uuid references public.items(id) on delete cascade,
  conversation_id uuid,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  source_event_key text);
alter table public.notifications add constraint notifications_type_check
  check (type in ('price_drop','system','sold','offer','meetup','unread_message'));
create unique index notifications_source_event_key_uidx
  on public.notifications (source_event_key) where source_event_key is not null;
create table private.item_deals (
  item_id uuid primary key references public.items(id) on delete cascade,
  owner_id uuid references public.profiles(id),
  counterparty_id uuid references public.profiles(id));

insert into public.profiles values ('${SELLER}'),('${BUYER}'),('${FAN}'),('${ENEMY}');
insert into public.items (id, user_id) values ('${ITEM}','${SELLER}');
insert into public.posts values ('${POST}','${SELLER}');
insert into public.post_comments (id, post_id, user_id) values ('${COMMENT}','${POST}','${SELLER}');
insert into private.item_deals values ('${ITEM}','${SELLER}','${BUYER}');
`

/* The deployed 065 body and its trigger, so the sold case starts where
   production is: favoriters hear about it, the buyer does not. */
const DEPLOYED_SOLD_FANOUT = `
CREATE OR REPLACE FUNCTION public.notify_item_sold()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status IN ('active', 'reserved') AND NEW.status = 'sold' THEN
    INSERT INTO public.notifications (user_id, type, title, body, item_id)
    SELECT f.user_id, 'sold', NEW.title, '$' || NEW.price::text, NEW.id
    FROM public.favorites f
    WHERE f.item_id = NEW.id AND f.user_id <> NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_item_sold ON public.items;
CREATE TRIGGER on_item_sold AFTER UPDATE OF status ON public.items FOR EACH ROW
  WHEN (OLD.status IN ('active','reserved') AND NEW.status = 'sold')
  EXECUTE FUNCTION public.notify_item_sold();
`

const bin = pgBin()
const skip = bin ? false : 'no local initdb'

test('each silent event now reaches exactly the right person, once', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'activity-notif-'))
  const data = join(dir, 'data')
  const port = String(50000 + Math.floor(Math.random() * 10000))
  const psql = sql => execFileSync(
    join(bin, 'psql'),
    ['-h', dir, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qtA'],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  )
  const rows = (where) => psql(
    `select coalesce(string_agg(type || '|' || body, ',' order by created_at, id), '') from notifications where ${where};`,
  ).trim()
  const count = where => Number(psql(`select count(*) from notifications where ${where};`).trim())

  execFileSync(join(bin, 'initdb'), ['-D', data, '-A', 'trust', '-U', 'postgres'], { stdio: 'ignore' })
  execFileSync(join(bin, 'pg_ctl'), [
    '-D', data, '-o', `-p ${port} -k ${dir} -c listen_addresses=''`,
    '-l', join(dir, 'pg.log'), '-w', 'start',
  ], { stdio: 'ignore' })
  try {
    psql(SETUP + DEPLOYED_SOLD_FANOUT)

    // Control: before the migration every one of these events is silent.
    psql(`insert into follows values ('${FAN}','${SELLER}');
          insert into post_likes values ('${POST}','${FAN}');
          insert into post_comments (id, post_id, user_id) values (gen_random_uuid(),'${POST}','${FAN}');
          insert into ratings (rater_id, ratee_id, item_id, stars) values ('${BUYER}','${SELLER}',
            '${ITEM}', 5);`)
    assert.equal(count('true'), 0, 'the harness is not modelling production: something already notified')
    psql(`delete from follows; delete from post_likes; delete from post_comments where user_id='${FAN}';
          delete from ratings;`)

    psql(await readFile(MIGRATION, 'utf8'))

    // 1. Being rated. The ratee hears; the rater does not.
    psql(`insert into ratings (rater_id, ratee_id, item_id, stars) values ('${BUYER}','${SELLER}','${ITEM}',5);`)
    assert.equal(rows(`user_id='${SELLER}'`), 'rating|transaction_rating_received')
    assert.equal(count(`user_id='${BUYER}'`), 0, 'the rater was notified of their own rating')
    assert.equal(
      psql(`select item_id from notifications where type='rating';`).trim(), ITEM,
      'the rating notification cannot open the item it is about',
    )

    // 2. Being followed — and the follower id is in the body, because that is
    // what the tap target is built from.
    psql(`insert into follows values ('${FAN}','${SELLER}');`)
    assert.equal(count(`user_id='${SELLER}' and type='follow'`), 1)
    assert.equal(
      psql(`select body from notifications where type='follow';`).trim(),
      `new_follower:${FAN}`,
    )

    // Unfollow and follow again: still one row, not a doorbell.
    psql(`delete from follows; insert into follows values ('${FAN}','${SELLER}');`)
    assert.equal(count(`user_id='${SELLER}' and type='follow'`), 1, 'refollowing rang again')

    // 3. Plaza. A comment and a like on my post, and a like on my comment.
    psql(`insert into post_likes values ('${POST}','${FAN}');
          insert into post_comments (id, post_id, user_id) values (gen_random_uuid(),'${POST}','${FAN}');
          insert into post_comment_likes values ('${COMMENT}','${FAN}');`)
    assert.equal(count(`user_id='${SELLER}' and type='post_like'`), 2, 'post like + comment like')
    assert.equal(count(`user_id='${SELLER}' and type='post_comment'`), 1)
    assert.equal(
      psql(`select distinct body from notifications where type='post_comment';`).trim(),
      `post_comment:${POST}`,
    )
    assert.equal(
      psql(`select body from notifications where body like 'post_comment_like:%';`).trim(),
      `post_comment_like:${POST}`,
      'a comment like must route to the post the comment lives on',
    )

    // Unlike and like again: no second row for the same (post, actor).
    psql(`delete from post_likes; insert into post_likes values ('${POST}','${FAN}');
          delete from post_comment_likes; insert into post_comment_likes values ('${COMMENT}','${FAN}');`)
    assert.equal(count(`user_id='${SELLER}' and type='post_like'`), 2, 'relike produced a second row')

    // 4. Nothing for your own actions.
    const before = count('true')
    psql(`insert into post_likes values ('${POST}','${SELLER}');
          insert into post_comments (id, post_id, user_id) values (gen_random_uuid(),'${POST}','${SELLER}');
          insert into post_comment_likes values ('${COMMENT}','${SELLER}');`)
    assert.equal(count('true'), before, 'liking and commenting on your own post notified you')

    // 5. A block silences the notification in either direction.
    psql(`insert into blocks (blocker_id, blocked_id) values ('${SELLER}','${ENEMY}');
          insert into post_likes values ('${POST}','${ENEMY}');
          insert into follows values ('${ENEMY}','${SELLER}');`)
    assert.equal(count(`user_id='${SELLER}' and type='post_like'`), 2, 'a blocked user got through')
    assert.equal(count(`user_id='${SELLER}' and type='follow'`), 1, 'a blocked user got through')

    psql(`delete from blocks; insert into blocks (blocker_id, blocked_id) values ('${ENEMY}','${SELLER}');
          delete from post_likes where user_id='${ENEMY}';
          insert into post_likes values ('${POST}','${ENEMY}');`)
    assert.equal(
      count(`user_id='${SELLER}' and type='post_like'`), 2,
      'being blocked by the actor still delivered',
    )
    psql(`delete from blocks;`)

    // 6. Sold. The buyer of record hears about their own purchase, a favoriter
    // still hears about the listing, and the seller hears nothing.
    psql(`insert into favorites (user_id, item_id) values ('${FAN}','${ITEM}'),('${BUYER}','${ITEM}');
          update items set status='sold' where id='${ITEM}';`)
    assert.equal(rows(`user_id='${BUYER}' and type='sold'`), 'sold|deal_marked_sold',
      'the buyer of record was not told, or was told twice')
    assert.equal(rows(`user_id='${FAN}' and type='sold'`), 'sold|$25.00',
      'the favoriter fan-out was broken by the buyer row')
    assert.equal(count(`user_id='${SELLER}' and type='sold'`), 0, 'the seller notified themselves')
  } finally {
    try { execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', 'stop'], { stdio: 'ignore' }) } catch {}
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the migration keeps every new type inside the CHECK it widens', async () => {
  // Static control for environments that skip the run above: a trigger that
  // writes a type the constraint does not list would fail at the INSERT.
  const sql = await readFile(MIGRATION, 'utf8')
  const allowed = /CHECK \(type IN \(([\s\S]*?)\)\)/.exec(sql)
  assert.ok(allowed, 'the type constraint is no longer declared here')
  const listed = [...allowed[1].matchAll(/'([a-z_]+)'/g)].map(match => match[1])
  const emitted = [...sql.matchAll(/^\s+'([a-z_]+)',\n\s+'[^']*·[^']*',$/gm)].map(match => match[1])
  assert.ok(emitted.length >= 6, `expected the six activity writers, parsed ${emitted.length}`)
  for (const type of emitted) assert.ok(listed.includes(type), `${type} is not in the CHECK`)
})
