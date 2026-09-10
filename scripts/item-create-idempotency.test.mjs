import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const bin = ['/opt/homebrew/opt/postgresql@17/bin', '/usr/lib/postgresql/17/bin'].find(p => existsSync(join(p, 'initdb')))
test('item retry ids retain ownership RLS, uniqueness and protected-column restrictions', { skip: !bin }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'item-retry-')), data = join(dir, 'data'), port = String(50000 + Math.floor(Math.random() * 10000))
  const sql = input => execFileSync(join(bin, 'psql'), ['-h', dir, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qtA'], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  const asUser = input => sql(`BEGIN; SET LOCAL ROLE authenticated; ${input} COMMIT;`)
  execFileSync(join(bin, 'initdb'), ['-D', data, '-A', 'trust', '-U', 'postgres'], { stdio: 'ignore' })
  try {
    execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-o', `-p ${port} -k ${dir} -c listen_addresses=''`, '-l', join(dir, 'pg.log'), '-w', 'start'], { stdio: 'ignore' })
    sql(`CREATE ROLE authenticated; CREATE ROLE anon;
      CREATE TABLE items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, status text DEFAULT 'active');
      ALTER TABLE items ENABLE ROW LEVEL SECURITY;
      CREATE POLICY owner ON items TO authenticated USING(user_id='11111111-1111-4111-8111-111111111111') WITH CHECK(user_id='11111111-1111-4111-8111-111111111111');
      GRANT SELECT ON items TO authenticated; GRANT INSERT(user_id,title), UPDATE(title) ON items TO authenticated;`)
    const migration = readFileSync(new URL('../supabase/migrations/20260909201600_idempotent_item_create.sql', import.meta.url), 'utf8')
    sql(migration); sql(migration)
    const id = '33333333-3333-4333-8333-333333333333'
    const insert = `INSERT INTO items(id,user_id,title) VALUES('${id}','11111111-1111-4111-8111-111111111111','Campus desk');`
    asUser(insert)
    assert.throws(() => asUser(insert), /duplicate key/)
    assert.equal(sql('SELECT count(*) FROM items;'), '1')
    assert.throws(() => asUser("INSERT INTO items(id,user_id,title) VALUES(gen_random_uuid(),'22222222-2222-4222-8222-222222222222','Wrong owner');"), /row-level security/)
    assert.throws(() => asUser('UPDATE items SET id=gen_random_uuid();'), /permission denied/)
    assert.throws(() => asUser("INSERT INTO items(user_id,title,status) VALUES('11111111-1111-4111-8111-111111111111','Bad status','sold');"), /permission denied/)
    assert.equal(sql("SELECT has_column_privilege('anon','items','id','INSERT');"), 'f')
  } finally {
    try { execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', 'stop'], { stdio: 'ignore' }) } catch {}
    rmSync(dir, { recursive: true, force: true })
  }
})
