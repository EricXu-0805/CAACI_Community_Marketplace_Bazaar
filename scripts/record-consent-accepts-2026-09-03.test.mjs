import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The consent gate has no bypass: App.vue routes every account whose
 * tos_version is older than CURRENT_CONSENT_VERSION to /pages/reconsent, and
 * that screen clears only through record_consent, which validates the version
 * against a hardcoded CASE. On 2026-08-06 the frontend shipped a version the
 * deployed function did not accept and the whole signed-in app was unreachable
 * for hours.
 *
 * scripts/consent-version-deploy-order-boundary.test.mjs pins the constant
 * against the migration's *text*. This runs the migration instead: it builds
 * the production shape (the 2026-08-01 function, the release allowlist
 * constraint, the three Supabase roles), applies
 * 20260903080037_accept_contact_policy_consent_version.sql verbatim including
 * its own precheck and verify blocks, and then calls the function. A CASE arm
 * that reads correctly but does not commit an acceptance would pass the static
 * guard and still lock everyone out.
 *
 * Needs a local initdb; skips where there is none (CI). The proof is the run.
 */

const REPO = new URL('../', import.meta.url)
const MIGRATION = fileURLToPath(
  new URL('supabase/migrations/20260903080037_accept_contact_policy_consent_version.sql', REPO),
)
const PRIOR_MIGRATION = new URL(
  'supabase/migrations/20260801082650_advance_privacy_consent_for_first_release_auth_matrix.sql',
  REPO,
)

const NEW_VERSION = '2026-09-03'
const PRIOR_VERSION = '2026-08-01'
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OLDER_USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function pgBin() {
  const candidates = ['/opt/homebrew/opt/postgresql@17/bin', '/opt/homebrew/opt/postgresql@16/bin', '/usr/local/opt/postgresql@17/bin', '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin']
  for (const dir of candidates) if (existsSync(join(dir, 'initdb'))) return dir
  try { return execFileSync('sh', ['-c', 'dirname "$(command -v initdb)"'], { encoding: 'utf8' }).trim() } catch { return null }
}

/* The slice of production the migration's precheck actually inspects: the three
   Supabase roles it tests EXECUTE against, a stand-in for auth.uid() driven by a
   session GUC, the columns record_consent writes, and the validated allowlist
   constraint as it stands in production today. */
const SETUP = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
create table public.profiles (
  id uuid primary key,
  tos_version text,
  consented_at timestamptz,
  constraint profiles_tos_version_release_allowlist
    check (tos_version in ('0', '2026-04-20', '2026-07-18', '2026-08-01')));
insert into public.profiles (id, tos_version) values
  ('${USER}', '${PRIOR_VERSION}'),
  ('${OLDER_USER}', '2026-07-18');
`

/* The prior definition, read out of its own migration rather than retyped, so
   this starts from the function production is really running. */
async function priorFunction() {
  const source = await readFile(PRIOR_MIGRATION, 'utf8')
  const start = source.indexOf('CREATE OR REPLACE FUNCTION public.record_consent(')
  const end = source.indexOf('TO authenticated;', start)
  assert.ok(start > 0 && end > start, 'could not locate the 2026-08-01 record_consent definition')
  const slice = source.slice(start, end + 'TO authenticated;'.length)
  assert.match(slice, /WHEN '2026-08-01' THEN/, 'the 2026-08-01 slice is not the consent function')
  assert.doesNotMatch(slice, new RegExp(NEW_VERSION), 'the prior function already knows the new version')
  return slice
}

const bin = pgBin()
const skip = bin ? false : 'no local initdb'

test('the migration teaches record_consent 2026-09-03 and still refuses unknown versions', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'record-consent-'))
  const data = join(dir, 'data')
  const port = String(50000 + Math.floor(Math.random() * 10000))
  const args = ['-h', dir, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qtA']
  const psql = (sql, { caller = USER } = {}) => execFileSync(join(bin, 'psql'), args, {
    input: `set app.uid = '${caller}';\n${sql}`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  })
  const psqlFile = (path) => execFileSync(join(bin, 'psql'), [...args, '-f', path], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  const refuses = (sql, code, opts) => {
    let err = ''
    try { psql(sql, opts) } catch (e) { err = String(e.stderr || e.message) }
    assert.match(err, new RegExp(code), `expected '${code}' from: ${sql.trim()}\n${err}`)
  }

  execFileSync(join(bin, 'initdb'), ['-D', data, '-A', 'trust', '-U', 'postgres'], { stdio: 'ignore' })
  execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-o', `-p ${port} -k ${dir} -c listen_addresses=''`, '-l', join(dir, 'pg.log'), '-w', 'start'], { stdio: 'ignore' })
  try {
    psql(SETUP + (await priorFunction()))

    // Control: before the migration the new version is exactly the 08-06
    // outage — every acceptance raises invalid_version.
    refuses(`select public.record_consent('${NEW_VERSION}', '${USER}');`, 'invalid_version')

    // The migration's own precheck and verify blocks run here. A failure of
    // either aborts the transaction and fails this call.
    psqlFile(MIGRATION)

    assert.equal(psql(`select public.record_consent('${NEW_VERSION}', '${USER}');`).trim(), '')
    assert.equal(
      psql(`select tos_version from public.profiles where id = '${USER}';`).trim(),
      NEW_VERSION,
      'record_consent returned cleanly without committing the acceptance',
    )
    assert.match(
      psql(`select consented_at is not null from public.profiles where id = '${USER}';`).trim(),
      /^t$/,
      'the acceptance did not stamp consented_at',
    )

    // The rolling window: the bundle still being served must keep working.
    assert.equal(psql(`select public.record_consent('${PRIOR_VERSION}', '${OLDER_USER}');`, { caller: OLDER_USER }).trim(), '')
    assert.equal(
      psql(`select tos_version from public.profiles where id = '${OLDER_USER}';`).trim(),
      PRIOR_VERSION,
    )

    // Widening the CASE must not turn the function into an arbitrary writer,
    // and must not let the new version be walked back.
    refuses(`select public.record_consent('2026-10-01', '${USER}');`, 'invalid_version')
    refuses(`select public.record_consent('not-a-version', '${USER}');`, 'invalid_version')
    assert.equal(psql(`select public.record_consent('${PRIOR_VERSION}', '${USER}');`).trim(), '')
    assert.equal(
      psql(`select tos_version from public.profiles where id = '${USER}';`).trim(),
      NEW_VERSION,
      'an older version downgraded an account that had already accepted the new one',
    )

    // The allowlist constraint has to have grown with the CASE, or the UPDATE
    // above would have been rejected by the check rather than committed.
    assert.match(
      psql("select pg_get_constraintdef(oid) from pg_constraint where conname = 'profiles_tos_version_release_allowlist';").trim(),
      new RegExp(NEW_VERSION),
    )

    // Applying twice is how a re-run of the release script behaves; the
    // precheck's "already at target" branch must accept that.
    psqlFile(MIGRATION)
  } finally {
    try { execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], { stdio: 'ignore' }) } catch {}
    rmSync(dir, { recursive: true, force: true })
  }
})
