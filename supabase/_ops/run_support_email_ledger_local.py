#!/usr/bin/env python3
"""Exercise the support ledger in a fresh local PostgreSQL 16/17 cluster.

Requires initdb, pg_ctl, and psql (override their directory using PG_BIN).
Run: python3 supabase/_ops/run_support_email_ledger_local.py
Never reads .env files, Supabase credentials, or a hosted database address.
The fixture models only required existing tables; authorization/identity/lock
functions are extracted unchanged from their real historical migrations.
This is focused integration coverage, not a complete Supabase migration replay.
"""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / 'supabase/migrations'
OPS = ROOT / 'supabase/_ops'
VERSION = '20261003175231_admin_support_email_ledger'
DATABASE = 'support_email_ledger_regression'
PG_BIN = Path(os.environ.get('PG_BIN', Path(shutil.which('initdb') or '/missing/initdb').parent))
PORT = '55437'


def existing_function(filename, name):
    source = (MIGRATIONS / filename).read_text()
    match = re.search(r'CREATE OR REPLACE FUNCTION public\.' + name
                      + r'\([\s\S]*?\$function\$;', source)
    if not match:
        raise RuntimeError(f'Missing historical function: {name}')
    return match.group(0)


def run():
    for tool in ('initdb', 'pg_ctl', 'psql'):
        if not (PG_BIN / tool).exists():
            raise RuntimeError(f'Set PG_BIN to PostgreSQL 16/17 binaries; missing {tool}')
    with tempfile.TemporaryDirectory(prefix='support-email-ledger-') as temporary:
        cluster = Path(temporary) / 'data'
        env = {**os.environ, 'PGHOST': temporary, 'PGPORT': PORT,
               'PGUSER': 'postgres', 'PGDATABASE': DATABASE}
        # An inherited external connection string/service must never override
        # this disposable Unix-socket-only cluster.
        for key in ('PGSERVICE', 'PGSERVICEFILE', 'PGPASSWORD', 'PGPASSFILE', 'PGOPTIONS',
                    'PGHOSTADDR', 'PGSSLMODE', 'PGTARGETSESSIONATTRS'):
            env.pop(key, None)
        started = False

        def psql(sql=None, file=None, database=DATABASE, app=None, check=True):
            args = [str(PG_BIN / 'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-d', database]
            if file:
                args.extend(['-f', str(file)])
            process = subprocess.run(args, input=sql, text=True, capture_output=True,
                                     env={**env, **({'PGAPPNAME': app} if app else {})})
            if check and process.returncode:
                raise RuntimeError(process.stderr.strip())
            return process

        def parallel_query(sql, app):
            process = subprocess.Popen(
                [str(PG_BIN / 'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                text=True, env={**env, 'PGAPPNAME': app})
            process.stdin.write(sql)
            process.stdin.close()
            process.stdin = None
            return process

        try:
            subprocess.run([str(PG_BIN / 'initdb'), '-D', str(cluster), '-U', 'postgres',
                            '-A', 'trust', '--no-locale', '--encoding=UTF8'],
                           check=True, capture_output=True, text=True)
            subprocess.run([str(PG_BIN / 'pg_ctl'), '-D', str(cluster),
                            '-l', str(Path(temporary) / 'postgres.log'),
                            '-o', f"-k {temporary} -p {PORT} -h ''", 'start'],
                           check=True, capture_output=True, text=True)
            started = True
            psql(f'CREATE DATABASE {DATABASE};', database='postgres')
            baseline = """
              CREATE ROLE anon NOLOGIN;
              CREATE ROLE authenticated NOLOGIN;
              CREATE ROLE service_role NOLOGIN BYPASSRLS;
              CREATE TABLE public.profiles(id uuid PRIMARY KEY, nickname text, email text);
              CREATE TABLE public.admin_tokens(
                id uuid PRIMARY KEY, token_hash text UNIQUE NOT NULL,
                admin_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
                admin_name text NOT NULL, admin_email text NOT NULL,
                role text NOT NULL, expires_at timestamptz, revoked_at timestamptz,
                last_used_at timestamptz, created_at timestamptz DEFAULT now(), created_by uuid);
              CREATE TABLE public.admin_role_action_capabilities(admin_role text, action text);
              INSERT INTO public.admin_role_action_capabilities VALUES ('owner','issue_token');
              CREATE TABLE public.admin_audit_log(
                id bigserial PRIMARY KEY, event_kind text NOT NULL, actor_id uuid,
                target_id uuid, details jsonb NOT NULL DEFAULT '{}',
                admin_token_id uuid, idempotency_key uuid, created_at timestamptz DEFAULT now(),
                CONSTRAINT admin_audit_log_event_kind_check CHECK (event_kind IN (
                  'ban_applied','suspension_lifted','report_status_changed','actor_blocked',
                  'admin_login','admin_unauthorized','content_takedown','token_revoked',
                  'post_pin_changed','banner_changed','token_issued','appeal_decided',
                  'appeal_more_information_requested','fixture_future_event')));
              CREATE UNIQUE INDEX admin_audit_log_admin_mutation_uidx
                ON public.admin_audit_log(admin_token_id,idempotency_key)
                WHERE admin_token_id IS NOT NULL AND idempotency_key IS NOT NULL;
            """
            baseline += existing_function('20260722145042_harden_last_active_owner_revoke.sql',
                                          'admin_token_identity_safe')
            baseline += existing_function('20260722152000_harden_admin_invalid_auth_amplification.sql',
                                          'admin_token_authorization_v2')
            baseline += existing_function('20260719020000_admin_owner_recovery_concurrency.sql',
                                          'admin_lock_token_recovery_mutation')
            baseline += """
              CREATE TRIGGER admin_tokens_00_lock_recovery_mutation BEFORE UPDATE OR DELETE
                ON public.admin_tokens FOR EACH STATEMENT
                EXECUTE FUNCTION public.admin_lock_token_recovery_mutation();
              CREATE TRIGGER profiles_00_lock_admin_recovery_before_delete BEFORE DELETE
                ON public.profiles FOR EACH STATEMENT
                EXECUTE FUNCTION public.admin_lock_token_recovery_mutation();
            """
            psql(baseline)
            psql(file=OPS / f'PRECHECK_{VERSION}.sql')
            psql(file=MIGRATIONS / f'{VERSION}.sql')
            psql("INSERT INTO public.admin_audit_log(event_kind) VALUES ('fixture_future_event');")
            psql(file=OPS / f'VERIFY_{VERSION}.sql')
            psql(file=OPS / f'REGRESSION_{VERSION}.sql')
            print('PASS: migration, prior audit vocabulary, RLS/ACL, rollback regressions', flush=True)

            psql("""
              INSERT INTO public.profiles VALUES
                ('ea220000-0000-4000-8000-000000000001','Concurrent owner','race@example.test');
              INSERT INTO public.admin_tokens(id,token_hash,admin_id,admin_name,admin_email,role,expires_at)
                VALUES ('ea220000-0000-4000-8000-000000000011',repeat('a',64),
                  'ea220000-0000-4000-8000-000000000001','Concurrent owner','race@example.test',
                  'owner',now()+interval '1 day');
            """)
            claim = """SET ROLE service_role; SELECT public.admin_support_email_claim(
                repeat('a',64),'ea220000-0000-4000-8000-000000000021',repeat('1',64),
                'recipient@example.test','Concurrent send');"""
            processes = [parallel_query(claim, f'support_duplicate_{i}') for i in range(8)]
            results = []
            for process in processes:
                stdout, stderr = process.communicate(timeout=10)
                assert process.returncode == 0, stderr
                results.append(json.loads(stdout.strip()))
            assert sum(result['claimed'] for result in results) == 1, results
            assert psql("SELECT count(*) FROM public.admin_audit_log WHERE event_kind='support_email_claimed';").stdout.strip() == '1'
            print('PASS: 8 simultaneous identical claims authorize exactly one send/audit', flush=True)

            # Give the actor a fresh hour bucket before the independent rate race.
            psql("UPDATE public.admin_support_email_requests SET created_at=now()-interval '2 hours';")
            processes = [parallel_query(claim.replace('000000000021', f'{100+i:012d}'),
                                        f'support_rate_{i}') for i in range(12)]
            successful = limited = 0
            for process in processes:
                stdout, stderr = process.communicate(timeout=10)
                if process.returncode == 0:
                    assert json.loads(stdout.strip())['claimed'] is True
                    successful += 1
                else:
                    assert 'support_email_rate_limited' in stderr, stderr
                    limited += 1
            assert (successful, limited) == (10, 2), (successful, limited)
            print('PASS: 12 simultaneous new claims enforce the 10/hour actor limit', flush=True)

            # API authorization succeeds first. A concurrent revoker owns the
            # shared lock while a claimant passes its unlocked positive probe.
            assert psql("SELECT count(*) FROM public.admin_token_authorization_v2(repeat('a',64));").stdout.strip() == '1'
            holder = subprocess.Popen(
                [str(PG_BIN / 'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                text=True, bufsize=1, env=env)
            holder.stdin.write("BEGIN; SELECT pg_advisory_xact_lock(20260718180000::bigint); SELECT 'LOCK_HELD';\n")
            holder.stdin.flush()
            while holder.stdout.readline().strip() != 'LOCK_HELD':
                assert holder.poll() is None, 'lock holder failed'
            claimant = parallel_query(claim.replace('000000000021','000000000222'), 'support_revoke_race')
            waiting = False
            for _ in range(100):
                waiting = psql("SELECT count(*) FROM pg_stat_activity WHERE application_name='support_revoke_race' AND wait_event_type='Lock';").stdout.strip() == '1'
                if waiting:
                    break
                time.sleep(0.03)
            assert waiting, 'claim did not enter shared authorization lock domain'
            holder.stdin.write("UPDATE public.admin_tokens SET revoked_at=now() WHERE token_hash=repeat('a',64); COMMIT;\n\\q\n")
            holder.stdin.close()
            holder.stdin = None
            _, holder_error = holder.communicate(timeout=10)
            assert holder.returncode == 0, holder_error
            _, claimant_error = claimant.communicate(timeout=10)
            assert claimant.returncode != 0 and 'support_email_invalid_token' in claimant_error, claimant_error
            assert psql("SELECT count(*) FROM public.admin_support_email_requests WHERE request_id='ea220000-0000-4000-8000-000000000222';").stdout.strip() == '0'
            print('PASS: revoke after API authorization/positive probe prevents claim under lock', flush=True)

            # Status must fail closed if the deployment loses a required RPC.
            psql("UPDATE public.admin_tokens SET revoked_at=NULL WHERE token_hash=repeat('a',64);")
            psql('REVOKE EXECUTE ON FUNCTION public.admin_support_email_finish(text,uuid,text,text,text) FROM service_role;')
            readiness = json.loads(psql("SET ROLE service_role; SELECT public.admin_support_email_status(repeat('a',64));").stdout.strip())
            assert readiness == {'available': False}, readiness
            print('PASS: lost completion RPC privilege disables availability', flush=True)
            psql('DROP FUNCTION public.admin_support_email_finish(text,uuid,text,text,text);')
            readiness = json.loads(psql("SET ROLE service_role; SELECT public.admin_support_email_status(repeat('a',64));").stdout.strip())
            assert readiness == {'available': False}, readiness
            print('PASS: missing completion RPC disables availability', flush=True)
        finally:
            if started:
                subprocess.run([str(PG_BIN / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', 'stop'],
                               check=True, capture_output=True, text=True)


if __name__ == '__main__':
    run()
