import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Reporting something and appealing a suspension were both one-way. The admin
 * RPCs move reports.status and write an audit row; a denied appeal writes only
 * the audit row. Neither reached the person waiting for the answer — an
 * accepted appeal did, but only as a side effect of the suspension being
 * lifted (notify_suspension_change).
 *
 * Migration 20260903090000 hangs the answer off the row transitions instead of
 * copying two deployed SECURITY DEFINER bodies forward, so this loads it over
 * the smallest slice of schema those transitions touch and drives them.
 *
 * Needs a local initdb; skips where there is none (CI). The proof is the run.
 */

const REPO = new URL('../', import.meta.url)
const MIGRATION = new URL(
  'supabase/migrations/20260903090000_notify_report_and_appeal_outcomes.sql',
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

const REPORTER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OFFENDER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ADMIN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const REPORT = '11111111-1111-4111-8111-111111111111'
const OTHER_REPORT = '22222222-2222-4222-8222-222222222222'
const SUSPENSION = '33333333-3333-4333-8333-333333333333'
const OTHER_SUSPENSION = '44444444-4444-4444-8444-444444444444'

const SETUP = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;

create table public.profiles (id uuid primary key);
create table public.reports (
  id uuid primary key,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null, target_id uuid not null,
  reason text not null default 'spam',
  status text not null default 'pending'
    check (status in ('pending','reviewed','resolved','dismissed')));
create table public.suspensions (
  id uuid primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  level smallint not null default 2,
  appeal_note text);
create table public.admin_audit_log (
  id bigserial primary key,
  event_kind text not null,
  actor_id uuid, target_id uuid,
  details jsonb not null default '{}',
  created_at timestamptz not null default now());
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in (
    'price_drop','system','sold','offer','meetup','unread_message',
    'rating','follow','post_comment','post_like')),
  title text not null, body text not null default '',
  item_id uuid, conversation_id uuid,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  source_event_key text);
create unique index notifications_source_event_key_uidx
  on public.notifications (source_event_key) where source_event_key is not null;

insert into public.profiles values ('${REPORTER}'),('${OFFENDER}'),('${ADMIN}');
insert into public.reports (id, reporter_id, target_type, target_id)
  values ('${REPORT}','${REPORTER}','item','${OFFENDER}'),
         ('${OTHER_REPORT}','${REPORTER}','user','${OFFENDER}');
insert into public.suspensions (id, profile_id, appeal_note)
  values ('${SUSPENSION}','${OFFENDER}','please reconsider'),
         ('${OTHER_SUSPENSION}','${OFFENDER}','again');
`

/* What the deployed admin path does: move the status, record the decision. */
const decide = (suspension, decision) => `
insert into admin_audit_log (event_kind, actor_id, target_id, details)
values ('appeal_decided','${ADMIN}','${suspension}',
        jsonb_build_object('decision','${decision}','terminal',true,'reason','no'));`

const bin = pgBin()
const skip = bin ? false : 'no local initdb'

test('a report outcome and a denied appeal reach the person waiting for them', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'report-appeal-notif-'))
  const data = join(dir, 'data')
  const port = String(50000 + Math.floor(Math.random() * 10000))
  const psql = sql => execFileSync(
    join(bin, 'psql'),
    ['-h', dir, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qtA'],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  )
  const rows = where => psql(
    `select coalesce(string_agg(title || '|' || body, ',' order by created_at, id), '')
       from notifications where ${where};`,
  ).trim()
  const count = where => Number(psql(`select count(*) from notifications where ${where};`).trim())

  execFileSync(join(bin, 'initdb'), ['-D', data, '-A', 'trust', '-U', 'postgres'], { stdio: 'ignore' })
  execFileSync(join(bin, 'pg_ctl'), [
    '-D', data, '-o', `-p ${port} -k ${dir} -c listen_addresses=''`,
    '-l', join(dir, 'pg.log'), '-w', 'start',
  ], { stdio: 'ignore' })
  try {
    psql(SETUP)

    // Control: before the migration, both answers go nowhere.
    psql(`update reports set status='resolved' where id='${REPORT}';`)
    psql(decide(SUSPENSION, 'denied'))
    assert.equal(count('true'), 0, 'the harness is not modelling production: something already notified')
    psql(`update reports set status='pending' where id='${REPORT}';
          delete from admin_audit_log;`)

    psql(await readFile(MIGRATION, 'utf8'))

    // 1. A report that was acted on, and one that was dismissed. Both say so,
    // and neither carries the admin's reason.
    psql(`update reports set status='resolved' where id='${REPORT}';
          update reports set status='dismissed' where id='${OTHER_REPORT}';`)
    assert.equal(
      rows(`user_id='${REPORTER}'`),
      'report_resolved|report_outcome_resolved,report_dismissed|report_outcome_dismissed',
      'the reporter was not told how their report ended',
    )
    assert.equal(count(`user_id='${OFFENDER}'`), 0, 'the reported person was told about the report')

    // 2. Triage is not an answer, and reaching the same outcome twice is not a
    // second answer.
    const afterOutcomes = count('true')
    psql(`update reports set status='pending' where id='${REPORT}';
          update reports set status='reviewed' where id='${REPORT}';`)
    assert.equal(count('true'), afterOutcomes, "'reviewed' notified the reporter")
    psql(`update reports set status='resolved' where id='${REPORT}';`)
    assert.equal(count('true'), afterOutcomes, 'the same report announced its outcome twice')

    // 3. A denied appeal. The appellant hears; the admin does not.
    psql(decide(SUSPENSION, 'denied'))
    assert.equal(
      rows(`user_id='${OFFENDER}'`), 'appeal_denied|appeal_outcome_denied',
      'the appellant was not told their appeal was denied',
    )
    assert.equal(count(`user_id='${ADMIN}'`), 0, 'the admin notified themselves')
    psql(decide(SUSPENSION, 'denied'))
    assert.equal(
      count(`user_id='${OFFENDER}' and title='appeal_denied'`), 1,
      'a replayed decision rang a second time',
    )

    // 4. An accepted appeal stays with notify_suspension_change, which speaks
    // for the lift itself — a second row here would be the same news twice.
    const beforeAccepted = count('true')
    psql(decide(OTHER_SUSPENSION, 'accepted'))
    assert.equal(count('true'), beforeAccepted, 'an accepted appeal was announced twice')

    // 5. Nothing else in the audit log speaks. It is written on every admin
    // action, so a trigger that fired on all of them would be a megaphone.
    psql(`insert into admin_audit_log (event_kind, actor_id, target_id, details)
          values ('ban_applied','${ADMIN}','${SUSPENSION}',
                  jsonb_build_object('decision','denied'));`)
    assert.equal(count('true'), beforeAccepted, 'an unrelated audit event notified someone')
  } finally {
    try { execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', 'stop'], { stdio: 'ignore' }) } catch {}
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the copy these triggers write is a key the app can translate', async () => {
  // Static half, for the environments that skip the run above: a sentence
  // written here instead of a key is the bug 20260903090000 exists not to
  // repeat, and a key with no entry in a lookup renders as itself.
  const [sql, api, composable] = await Promise.all([
    readFile(MIGRATION, 'utf8'),
    readFile(new URL('app/src/api/notifications.ts', REPO), 'utf8'),
    readFile(new URL('app/src/composables/useNotifications.ts', REPO), 'utf8'),
  ])
  // The copy positions: a VALUES entry or a CASE result, alone on its line.
  const sentinels = [...new Set(
    [...sql.matchAll(/^\s*(?:THEN\s+|ELSE\s+)?'([a-z_]+)',?$/gm)]
      .map(match => match[1])
      .filter(value => /^(report|appeal)_/.test(value)),
  )]
  assert.ok(sentinels.length >= 6, `parsed ${sentinels.length} sentinels out of the migration`)
  for (const sentinel of sentinels) {
    const declared = new RegExp(`\\b${sentinel}: 'notif\\.`)
    assert.ok(
      declared.test(api) || declared.test(composable),
      `${sentinel} is in neither NOTIFICATION_TITLE_KEYS nor BODY_SENTINEL_KEYS, `
      + 'so the reader is shown the key itself',
    )
  }
  assert.ok(
    !/'[^'\n]*[\u4e00-\u9fff][^'\n]*·/.test(sql.split('\n').map(line => line.replace(/--.*$/, '')).join('\n')),
    'this migration writes a bilingual sentence into the row; write a sentinel key instead',
  )
})
