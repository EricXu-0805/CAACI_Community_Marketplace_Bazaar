import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * conversations.item_id is ON DELETE SET NULL, and enforce_conversation_flag_
 * ownership refused any change to item_id. The referential action is an
 * UPDATE that runs in the seller's own session, so a seller deleting a listing
 * anyone had chatted about got `immutable_participant_fields` and the app said
 * "Something went wrong" — measured on production 2026-09-02.
 *
 * Migration 20260903013000 lets item_id go to NULL only while the listing it
 * pointed at no longer exists. This runs the old body and the migration's body
 * against a throwaway Postgres: the old one must reproduce the failure (or the
 * harness is not modelling the cascade), the new one must let the delete
 * through, and the three things the guard still exists for must still refuse.
 *
 * Needs a local initdb; skips where there is none (CI). The proof is the run.
 */

const REPO = new URL('../', import.meta.url)
const MIGRATION = new URL('supabase/migrations/20260903013000_conversation_item_delete_cascade.sql', REPO)

function pgBin() {
  const candidates = ['/opt/homebrew/opt/postgresql@17/bin', '/opt/homebrew/opt/postgresql@16/bin', '/usr/local/opt/postgresql@17/bin', '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin']
  for (const dir of candidates) if (existsSync(join(dir, 'initdb'))) return dir
  try { return execFileSync('sh', ['-c', 'dirname "$(command -v initdb)"'], { encoding: 'utf8' }).trim() } catch { return null }
}

const SELLER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const BUYER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const STRANGER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const ITEM = '11111111-1111-4111-8111-111111111111'
const OTHER_ITEM = '22222222-2222-4222-8222-222222222222'
const CONV = '33333333-3333-4333-8333-333333333333'

/* The smallest slice of the schema the trigger touches, plus a stand-in for
   auth.uid() driven by a session GUC so each statement can pick its caller. */
const SETUP = `
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
create table public.items (id uuid primary key, user_id uuid not null, status text not null default 'active');
create table public.conversations (
  id uuid primary key, item_id uuid references public.items(id) on delete set null,
  buyer_id uuid not null, seller_id uuid not null,
  is_pinned_buyer bool default false, is_muted_buyer bool default false,
  is_pinned_seller bool default false, is_muted_seller bool default false);
insert into items values ('${ITEM}','${SELLER}'),('${OTHER_ITEM}','${SELLER}');
insert into conversations (id,item_id,buyer_id,seller_id) values ('${CONV}','${ITEM}','${BUYER}','${SELLER}');
`

/* The 013 body, verbatim in the parts that matter. */
const OLD_FUNCTION = `
CREATE OR REPLACE FUNCTION public.enforce_conversation_flag_ownership() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN RETURN NEW; END IF;
  IF uid <> OLD.buyer_id AND uid <> OLD.seller_id THEN RAISE EXCEPTION 'not_a_participant'; END IF;
  IF NEW.buyer_id IS DISTINCT FROM OLD.buyer_id OR NEW.seller_id IS DISTINCT FROM OLD.seller_id OR NEW.item_id IS DISTINCT FROM OLD.item_id THEN
    RAISE EXCEPTION 'immutable_participant_fields'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_conv_flag_ownership ON public.conversations;
CREATE TRIGGER trg_conv_flag_ownership BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION enforce_conversation_flag_ownership();
`

const bin = pgBin()
const skip = bin ? false : 'no local initdb'

test('the cascade fix lets a seller delete a listing that has a conversation, and nothing else', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'conv-cascade-'))
  const data = join(dir, 'data')
  const port = String(50000 + Math.floor(Math.random() * 10000))
  const psql = (sql, { caller = SELLER } = {}) => execFileSync(join(bin, 'psql'), ['-h', dir, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qtA'], {
    input: `set app.uid = '${caller}';\n${sql}`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  })
  const refuses = (sql, code, opts) => {
    let err = ''
    try { psql(sql, opts) } catch (e) { err = String(e.stderr || e.message) }
    assert.match(err, new RegExp(code), `expected '${code}' from: ${sql.trim()}\n${err}`)
  }
  execFileSync(join(bin, 'initdb'), ['-D', data, '-A', 'trust', '-U', 'postgres'], { stdio: 'ignore' })
  execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-o', `-p ${port} -k ${dir} -c listen_addresses=''`, '-l', join(dir, 'pg.log'), '-w', 'start'], { stdio: 'ignore' })
  try {
    psql(SETUP + OLD_FUNCTION)

    // Control: the harness must reproduce the production failure first.
    refuses(`delete from items where id='${ITEM}';`, 'immutable_participant_fields')

    psql(await readFile(MIGRATION, 'utf8'))

    psql(`delete from items where id='${ITEM}';`)
    assert.equal(psql(`select coalesce(item_id::text,'NULL') from conversations where id='${CONV}';`).trim(), 'NULL',
      'the cascade did not clear item_id')
    assert.equal(psql(`select count(*) from items;`).trim(), '1')

    // What the guard is still for.
    refuses(`update conversations set item_id='${OTHER_ITEM}' where id='${CONV}';`, 'immutable_participant_fields')
    psql(`insert into conversations (id,item_id,buyer_id,seller_id) values ('44444444-4444-4444-8444-444444444444','${OTHER_ITEM}','${BUYER}','${SELLER}');`)
    refuses(`update conversations set item_id=null where id='44444444-4444-4444-8444-444444444444';`, 'immutable_participant_fields')
    refuses(`delete from items where id='${OTHER_ITEM}';`, 'not_a_participant', { caller: STRANGER })
  } finally {
    try { execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', 'stop'], { stdio: 'ignore' }) } catch {}
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the migration keeps the one condition that makes the exception safe', async () => {
  // Static control for the environments that skip the run above: item_id may
  // change only to NULL, and only when the listing it pointed at is gone.
  const sql = await readFile(MIGRATION, 'utf8')
  assert.match(sql, /NEW\.item_id IS NOT NULL\s+OR EXISTS \(SELECT 1 FROM public\.items WHERE id = OLD\.item_id\)/)
  assert.match(sql, /RAISE EXCEPTION 'not_a_participant'/)
  assert.match(sql, /NEW\.buyer_id\s+IS DISTINCT FROM OLD\.buyer_id/)
})
