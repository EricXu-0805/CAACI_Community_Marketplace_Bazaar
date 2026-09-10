import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'

const bin = ['/opt/homebrew/opt/postgresql@17/bin', '/usr/lib/postgresql/17/bin'].find(p => existsSync(join(p, 'initdb')))
const asyncExec = promisify(execFile)
const owner = '11111111-1111-4111-8111-111111111111'
const cases = [
  ['items', 'user_id', 10, 'title', '', '', 'items_hour'],
  ['posts', 'user_id', 10, 'content', ', is_official boolean DEFAULT false', '', 'posts_hour'],
  ['post_comments', 'user_id', 30, 'content', ', post_id uuid', ", post_id='22222222-2222-4222-8222-222222222222'", 'comments_hour'],
  ['messages', 'sender_id', 30, 'content', ', conversation_id uuid, message_type text', ", conversation_id='22222222-2222-4222-8222-222222222222', message_type='text'", 'messages_minute'],
  ['reports', 'reporter_id', 10, 'content', '', '', 'reports_hour'],
]

test('concurrent public writes cannot spend the same final quota slot', { skip: !bin, timeout: 60_000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'public-write-concurrency-')), data = join(dir, 'data')
  const args = ['-X', '-h', dir, '-p', '5432', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qtA']
  const sql = input => execFileSync(join(bin, 'psql'), args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  execFileSync(join(bin, 'initdb'), ['-D', data, '-A', 'trust', '-U', 'postgres'], { stdio: 'ignore' })
  try {
    execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-o', `-k ${dir} -c listen_addresses=''`, '-l', join(dir, 'pg.log'), '-w', 'start'], { stdio: 'ignore' })
    sql('CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA private;')
    const source = readFileSync(new URL('../supabase/migrations/044_rate_limit_window_buffer.sql', import.meta.url), 'utf8')
    for (const [table, actor, , text, extra] of cases) {
      sql(`CREATE TABLE public.${table}(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ${actor} uuid, ${text} text, created_at timestamptz DEFAULT clock_timestamp() ${extra});
        GRANT INSERT,SELECT ON public.${table} TO authenticated;`)
      const definition = source.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.rl_${table}_before_insert\\(\\)[\\s\\S]*?\\$\\$;`))?.[0]
      assert.ok(definition, `missing actual rate-limit definition for ${table}`)
      sql(definition)
      sql(`CREATE TRIGGER trg_rl_${table}_before_insert BEFORE INSERT ON public.${table} FOR EACH ROW EXECUTE FUNCTION public.rl_${table}_before_insert();`)
    }
    // Baseline is only for a failing-before receipt in this disposable local DB.
    if (process.env.RATE_LIMIT_BASELINE !== '1') {
      const migrations = new URL('../supabase/migrations/', import.meta.url)
      const migration = readdirSync(migrations).find(name => name.endsWith('_serialize_public_write_limits.sql'))
      assert.ok(migration)
      sql('BEGIN;\n' + readFileSync(new URL(migration, migrations), 'utf8') + '\nCOMMIT;')
      assert.equal(sql("SELECT prosecdef FROM pg_proc WHERE oid='private.serialize_public_write_actor()'::regprocedure"), 'f')
      assert.equal(sql("SELECT has_function_privilege('authenticated', 'private.serialize_public_write_actor()', 'EXECUTE') OR has_function_privilege('anon', 'private.serialize_public_write_actor()', 'EXECUTE')"), 'f')
    }
    for (const [table, actor, , text, , related] of cases.filter(c => c[0] !== 'reports')) {
      await t.test(`${table}: parallel duplicate content commits once`, async () => {
        sql(`TRUNCATE public.${table};`)
        const assignments = related ? related.slice(2).split(', ').map(s => s.split('=')) : []
        const columns = [actor, text, ...assignments.map(([column]) => column)].join(',')
        const values = [`'${owner}'`, "'same content'", ...assignments.map(([, value]) => value)].join(',')
        const results = await Promise.allSettled(Array.from({ length: 8 }, () => asyncExec(join(bin, 'psql'), [...args, '-c',
          `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL statement_timeout='5s'; INSERT INTO public.${table}(${columns}) VALUES(${values}); SELECT pg_sleep(0.2); COMMIT;`], { timeout: 10_000 })))
        for (const result of results) if (result.status === 'rejected') assert.match(String(result.reason.stderr), /duplicate_(item|post|comment|message)/)
        assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
        assert.equal(sql(`SELECT count(*) FROM public.${table};`), '1')
      })
    }
    if (process.env.RATE_LIMIT_BASELINE !== '1') await t.test('an in-flight actor cannot block another actor or table; rollback releases locks', async () => {
      sql('TRUNCATE public.items, public.reports;')
      const holding = asyncExec(join(bin, 'psql'), [...args, '-c',
        `BEGIN; SET LOCAL ROLE authenticated; INSERT INTO public.items(user_id,title) VALUES('${owner}','held'); SELECT pg_sleep(2); ROLLBACK;`], { timeout: 10_000 })
      try {
        let locked = false
        for (let i = 0; i < 40; i++) {
          if (sql("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND granted)") === 't') { locked = true; break }
          await delay(25)
        }
        assert.ok(locked, 'first writer must hold its actor lock before the check')
        // A global/per-table lock would make these time out behind the first writer.
        await asyncExec(join(bin, 'psql'), [...args, '-c', `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL statement_timeout='500ms';
          INSERT INTO public.items(user_id,title) VALUES('44444444-4444-4444-8444-444444444444','independent');
          INSERT INTO public.reports(reporter_id,content) VALUES('${owner}','independent table'); COMMIT;`], { timeout: 5_000 })
      } finally { await holding }
      assert.equal(sql("SELECT count(*) FROM pg_locks WHERE locktype='advisory'"), '0')
      sql(`SET ROLE authenticated; INSERT INTO public.items(user_id,title) VALUES('${owner}','held'); RESET ROLE;`)
      assert.equal(sql(`SELECT count(*) FROM public.items WHERE user_id='${owner}';`), '1')
    })
    for (const [table, actor, cap, text, , related, limit] of cases) {
      await t.test(table, async () => {
        // Seed without the trigger so this measures one remaining slot, not
        // setup traffic. Each later INSERT runs the real production limiter.
        sql(`TRUNCATE public.${table}; ALTER TABLE public.${table} DISABLE TRIGGER USER;
          INSERT INTO public.${table}(${actor},${text}) SELECT '${owner}', 'seed '||i FROM generate_series(1,${cap-1}) i;
          ALTER TABLE public.${table} ENABLE TRIGGER USER;`)
        if (related) sql(`UPDATE public.${table} SET ${related.slice(2)};`)
        const results = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => asyncExec(join(bin, 'psql'), [...args, '-c',
          `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL statement_timeout='5s'; INSERT INTO public.${table}(${actor},${text}) VALUES('${owner}','parallel ${index}'); SELECT pg_sleep(0.2); COMMIT;`], { timeout: 10_000 })))
        const accepted = results.filter(r => r.status === 'fulfilled').length
        for (const result of results) if (result.status === 'rejected') assert.match(String(result.reason.stderr), new RegExp(`rate_limit_${limit}`))
        assert.equal(accepted, 1, `${table}: ${accepted} parallel writes spent one remaining slot`)
        assert.equal(Number(sql(`SELECT count(*) FROM public.${table};`)), cap)
      })
    }
  } finally {
    try { execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], { stdio: 'ignore' }) } catch {}
    rmSync(dir, { recursive: true, force: true })
  }
})
