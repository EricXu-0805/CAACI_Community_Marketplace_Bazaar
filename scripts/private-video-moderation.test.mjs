import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { postgresBinDir } from './_postgres-bin.mjs'

const bin = postgresBinDir()
test('video SQL denies unreviewed delivery, stale leases, other users and replacement reuse', { skip: !bin && 'PostgreSQL required' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'video-review-')), data = join(dir, 'data')
  const port = String(50000 + Math.floor(Math.random() * 10000))
  const run = (name, args, input) => execFileSync(join(bin, name), args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  const sql = input => run('psql', ['-X', '-h', dir, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qtA'], input).trim()
  let started = false
  try {
    run('initdb', ['-D', data, '-A', 'trust', '-U', 'postgres', '--locale=C', '-E', 'UTF8'])
    run('pg_ctl', ['-D', data, '-o', `-p ${port} -k ${dir} -c listen_addresses=''`, '-l', join(dir, 'pg.log'), '-w', 'start']); started = true
    sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth; CREATE SCHEMA private; CREATE SCHEMA storage;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb);
      CREATE TABLE public.conversations(id uuid PRIMARY KEY,buyer_id uuid,seller_id uuid,is_direct boolean);
      CREATE TABLE public.messages(id uuid PRIMARY KEY,conversation_id uuid,sender_id uuid,content text,message_type text);
      CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,version text,metadata jsonb);
      CREATE FUNCTION private.chat_media_access(p text,writing boolean) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT auth.uid()::text=split_part(p,'/',2) $$;`)
    sql('BEGIN;' + readFileSync(new URL('../supabase/migrations/20260919064706_private_video_moderation_jobs.sql', import.meta.url), 'utf8') + 'COMMIT;')
    sql(readFileSync(new URL('../supabase/_ops/REGRESSION_20260919_video_moderation.sql', import.meta.url), 'utf8'))
    assert.equal(sql('SELECT count(*) FROM private.video_moderation_jobs'), '0', 'fixture rolls back')
  } finally {
    if (started) run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop'])
    rmSync(dir, { recursive: true, force: true })
  }
})
