import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { postgresBinDir } from '../_postgres-bin.mjs'

/*
 * One throwaway PostgreSQL 17 cluster for the P3 migration tests.
 *
 * The whole migration file runs against a narrow schema. Tables, grants,
 * policies and two decoy functions are stand-ins shaped like the replayed
 * database; every function the migration reissues, wraps or calls is the real
 * stored text, cut from the migration that holds its latest definition. The
 * full-chain behaviour (real ACLs, real triggers, real admin dispatcher) is
 * REGRESSION_20261120100354 under L-SQL.
 */

export const MIGRATION = '20261120100354_community_watch_save_activity.sql'
export const bin = postgresBinDir()
export const SKIP = !bin && 'local PostgreSQL unavailable'
export const readMigration = name => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8')
export const readOps = name => readFileSync(new URL(`../../supabase/_ops/${name}`, import.meta.url), 'utf8')

// One complete CREATE [OR REPLACE] FUNCTION statement, body included.
export function functionSql(source, name) {
  const start = new RegExp(`CREATE (?:OR REPLACE )?FUNCTION ${name.replace('.', '\\.')}\\(`, 'i').exec(source)
  assert.ok(start, `${name} is not defined in the named migration`)
  const tag = /\bAS (\$[a-z_]*\$)/i.exec(source.slice(start.index))
  const open = start.index + tag.index + tag[0].length
  const close = source.indexOf(tag[1], open)
  return source.slice(start.index, source.indexOf(';', close) + 1)
}

export const id = n => `caac1120-2026-4000-8000-${String(n).padStart(12, '0')}`
export const AUTHOR = id(1) // writes the topics
export const FOLLOWER = id(2)
export const REPLIER = id(3)
export const OTHER = id(4)
export const OFFICIAL = id(5) // the account E6 will name
export const ADMIN = id(6)
export const TOPIC = id(21)
export const TOPIC_OTHER = id(22)
export const UPDATE = id(23) // a legacy update: no title, no board
export const TOKENS = { owner: 'a'.repeat(64), operator: 'b'.repeat(64), security_admin: 'c'.repeat(64) }

export const PRE_P3_CAPABILITIES = {
  operator: ['apply_ban', 'decide_appeal', 'lift_suspension', 'resolve_target_reports', 'takedown_content', 'update_report_status'],
  owner: ['apply_ban', 'decide_appeal', 'delete_banner', 'issue_token', 'lift_suspension', 'resolve_target_reports',
    'revoke_admin_tokens', 'revoke_token', 'set_post_pinned', 'takedown_content', 'update_report_status', 'upload_banner', 'upsert_banner'],
  security_admin: ['revoke_admin_tokens', 'revoke_token'],
}
const CAPABILITY_ACTIONS = ['apply_ban', 'lift_suspension', 'update_report_status', 'resolve_target_reports', 'takedown_content',
  'set_post_pinned', 'upsert_banner', 'delete_banner', 'revoke_token', 'upload_banner', 'issue_token', 'revoke_admin_tokens', 'decide_appeal']
const REQUEST_ACTIONS = CAPABILITY_ACTIONS.filter(action => action !== 'upload_banner')
const AUDIT_KINDS = ['ban_applied', 'suspension_lifted', 'report_status_changed', 'actor_blocked', 'admin_login', 'admin_unauthorized',
  'content_takedown', 'token_revoked', 'post_pin_changed', 'banner_changed', 'token_issued', 'appeal_decided', 'appeal_more_information_requested']
const list = values => values.map(value => `'${value}'`).join(',')

// Functions the migration reissues or renames, and the helpers its new code calls.
export const REISSUED = [
  'public.update_post_comment_count()',
  'public.admin_token_authorization(text)',
  'public.admin_token_authorization_v2(text)',
  'public.admin_list_moderation_audit_log(integer,integer,text)',
]
export const SEARCH = 'public.search_community_posts(text[],text,integer,integer,text,text)'
export const DISPATCHER = 'public.admin_execute_mutation(text,uuid,text,text,jsonb)'
export const PREDECESSOR = 'public.admin_execute_mutation_pre_community_governance(text,uuid,text,text,jsonb)'
export const HELPERS = [
  'private.enqueue_activity_notification(uuid,uuid,text,text,text,uuid,text)',
  'moderation_private.current_profile_state(uuid)',
  'moderation_private.profile_content_visible(uuid)',
  'private.current_user_can_access_pair(uuid,uuid)',
  'public.admin_assert_mutation_capability(uuid,text)',
  'public.record_audit(text,uuid,uuid,jsonb)',
  'public.admin_moderation_reason_valid(text)',
  'public.notify_post_comment()',
]
export const CREATED = [
  'private.reject_reply_to_locked_post()',
  'private.validate_comment_reply_target()',
  'private.notify_topic_reply()',
  'public.admin_execute_community_governance(text,uuid,text,text,jsonb)',
  'public.admin_list_community_posts(integer,integer,text)',
  'public.admin_list_report_queue(integer,integer)',
  'public.community_post_state(uuid)',
  'public.list_own_hidden_posts(uuid)',
]
// (signature, md5) pairs as the ops files list them.
export const pinned = source => new Map([...source.matchAll(/\('([a-z0-9_.]+\([a-z,\[\]]*\))', '([0-9a-f]{32})'/g)].map(m => [m[1], m[2]]))

/**
 * @param {{ legacy?: string, migrate?: boolean }} options
 *   legacy: SQL run as the owner right before the migration (rows the backfill must handle).
 */
export function startCommunityDatabase({ legacy = '', migrate = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'community-p3-'))
  const data = join(dir, 'data'), port = String(50000 + Math.floor(Math.random() * 10000))
  const run = (name, args, input) => execFileSync(join(bin, name), args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  const sql = input => run('psql', ['-X', '-h', dir, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qtA'], input).trim()
  // A committed statement as one API role and user.
  const as = (input, role = 'authenticated', uid = AUTHOR) =>
    sql(`BEGIN; SET LOCAL ROLE ${role}; SET LOCAL request.jwt.claim.sub = '${uid}'; ${input}; COMMIT;`)
  // One rolled-back attempt: 'ok:<rows>', 'value:<answer>' or '<SQLSTATE>:<message>'.
  const attempt = (action, { role = 'authenticated', uid = AUTHOR, ask = false } = {}) =>
    sql(`SELECT harness.attempt('${role}', '${uid}', $attempt$${action}$attempt$, ${ask})`)
  const bodyMd5 = names => new Map(sql(`SELECT s || ' ' || md5(p.prosrc) FROM unnest(ARRAY[${list(names)}]) AS s
    JOIN pg_proc AS p ON p.oid = to_regprocedure(s)`).split('\n').filter(Boolean).map(line => line.split(' ')))
  // Signature, arguments, result, security, volatility, settings, owner and grants of the named functions.
  const contract = names => sql(`SELECT string_agg(p.oid::regprocedure::text || '|' || pg_get_function_arguments(p.oid) || '|'
      || pg_get_function_result(p.oid) || '|' || p.prosecdef::text || '|' || p.provolatile::text || '|' || coalesce(p.proconfig::text, '')
      || '|' || p.proowner::regrole::text || '|' || coalesce(p.proacl::text, ''), E'\\n' ORDER BY p.oid::regprocedure::text)
    FROM pg_proc AS p WHERE p.oid = ANY (ARRAY[${names.map(name => `to_regprocedure('${name}')`).join(',')}])`)
  // Which API roles may execute each function: 'name:anon,authenticated' lines.
  const grants = names => sql(`SELECT string_agg(s || ':' || coalesce((SELECT string_agg(r, ',' ORDER BY r)
        FROM unnest(ARRAY['anon','authenticated','service_role']) AS r WHERE has_function_privilege(r, s, 'EXECUTE')), ''), E'\\n' ORDER BY s)
    FROM unnest(ARRAY[${list(names)}]) AS s`).split('\n')
  let started = false
  // Stored bodies and contracts as they are right before the migration runs.
  let before = null
  const stop = () => {
    if (started) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'])
    started = false
    rmSync(dir, { recursive: true, force: true })
  }
  try {
    run('initdb', ['-D', data, '-A', 'trust', '-U', 'postgres', '-E', 'UTF8', '--no-locale'])
    run('pg_ctl', ['-D', data, '-o', `-p ${port} -k ${dir} -c listen_addresses=''`, '-l', join(dir, 'pg.log'), '-w', 'start'])
    started = true
    sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth; CREATE SCHEMA private; CREATE SCHEMA moderation_private; CREATE SCHEMA extensions; CREATE SCHEMA harness;
      CREATE EXTENSION pg_trgm WITH SCHEMA extensions;
      GRANT USAGE ON SCHEMA public, auth, extensions TO anon, authenticated, service_role;
      GRANT USAGE ON SCHEMA private TO authenticated;
      GRANT USAGE ON SCHEMA moderation_private TO anon, authenticated, service_role;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE TABLE public.profiles(id uuid PRIMARY KEY, nickname text NOT NULL DEFAULT '', email text, avatar_url text DEFAULT '',
        location text, is_illini_verified boolean NOT NULL DEFAULT false, uid text, status_text text, status_emoji text,
        suspension_level smallint NOT NULL DEFAULT 0, suspended_until timestamptz);
      CREATE TABLE public.suspensions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE, level smallint NOT NULL, reason text,
        started_at timestamptz NOT NULL DEFAULT now(), ends_at timestamptz, lifted_at timestamptz, appeal_note text);
      CREATE TABLE public.blocks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), blocker_id uuid NOT NULL, blocked_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (blocker_id, blocked_id));
      CREATE TABLE public.posts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE, content text NOT NULL,
        images text[] NOT NULL DEFAULT '{}', is_official boolean NOT NULL DEFAULT false, is_pinned boolean NOT NULL DEFAULT false,
        like_count integer NOT NULL DEFAULT 0, comment_count integer NOT NULL DEFAULT 0,
        status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','deleted','hidden')),
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        image_dimensions jsonb NOT NULL DEFAULT '[]', content_i18n jsonb, source_lang text, title text, category text,
        region text NOT NULL DEFAULT 'cu',
        CONSTRAINT posts_topic_metadata_check CHECK ((title IS NULL AND category IS NULL) OR (title IS NOT NULL
          AND category IN ('campus-life','settling-market','alumni-career','events-social','local-deals'))));
      CREATE TABLE public.post_comments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE, content text NOT NULL,
        parent_comment_id uuid REFERENCES public.post_comments(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(), like_count integer NOT NULL DEFAULT 0,
        status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','hidden')), content_i18n jsonb);
      CREATE TABLE public.notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE, type text NOT NULL, title text NOT NULL,
        body text NOT NULL DEFAULT '', item_id uuid, is_read boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(), emailed_at timestamptz, conversation_id uuid, source_event_key text);
      CREATE UNIQUE INDEX notifications_source_event_key_uidx ON public.notifications (source_event_key) WHERE source_event_key IS NOT NULL;
      CREATE TABLE public.reports(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reporter_id uuid NOT NULL REFERENCES public.profiles(id),
        target_type text NOT NULL, target_id uuid NOT NULL, reason text NOT NULL, note text DEFAULT '',
        status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now(), target_snapshot jsonb);
      CREATE TABLE public.admin_tokens(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), token_hash text NOT NULL UNIQUE,
        admin_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL, admin_name text NOT NULL, admin_email text NOT NULL,
        role text NOT NULL CHECK (role IN ('operator','security_admin','owner')), created_at timestamptz NOT NULL DEFAULT now(),
        last_used_at timestamptz, expires_at timestamptz, revoked_at timestamptz);
      CREATE TABLE public.admin_role_action_capabilities(admin_role text NOT NULL, action text NOT NULL, PRIMARY KEY (admin_role, action),
        CONSTRAINT admin_role_action_capabilities_admin_role_check CHECK (admin_role IN ('operator','security_admin','owner')),
        CONSTRAINT admin_role_action_capabilities_action_check CHECK (action IN (${list(CAPABILITY_ACTIONS)})));
      CREATE TABLE public.admin_mutation_requests(admin_token_id uuid NOT NULL, idempotency_key uuid NOT NULL, actor_id uuid NOT NULL,
        action text NOT NULL, payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
        status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed')), result jsonb,
        created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, PRIMARY KEY (admin_token_id, idempotency_key),
        CONSTRAINT admin_mutation_requests_action_check CHECK (action IN (${list(REQUEST_ACTIONS)})),
        CHECK ((status = 'running' AND result IS NULL AND completed_at IS NULL)
          OR (status = 'completed' AND result IS NOT NULL AND completed_at IS NOT NULL)));
      CREATE TABLE public.admin_audit_log(id bigserial PRIMARY KEY, event_kind text NOT NULL, actor_id uuid, target_id uuid,
        details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), admin_token_id uuid, idempotency_key uuid,
        CONSTRAINT admin_audit_log_event_kind_check CHECK ((event_kind IN (${list(AUDIT_KINDS)})) OR event_kind = 'support_email_claimed'));
      CREATE UNIQUE INDEX admin_audit_log_admin_mutation_uidx ON public.admin_audit_log (admin_token_id, idempotency_key)
        WHERE admin_token_id IS NOT NULL AND idempotency_key IS NOT NULL;
      INSERT INTO public.admin_role_action_capabilities(admin_role, action) VALUES
        ${Object.entries(PRE_P3_CAPABILITIES).flatMap(([role, actions]) => actions.map(action => `('${role}','${action}')`)).join(',')};`)

    // The real stored text of everything the migration reissues, wraps or calls.
    const visibility = readMigration('20260718160000_reconcile_expired_suspension_visibility.sql')
    const activity = readMigration('20260903070000_in_app_activity_notifications.sql')
    const appeals = readMigration('20260720035037_harden_admin_appeal_decisions_and_session_metadata.sql')
    const topics = readMigration('20261112120000_community_post_topics.sql')
    sql(functionSql(visibility, 'moderation_private.current_profile_state'))
    sql(functionSql(visibility, 'moderation_private.profile_content_visible'))
    sql(functionSql(visibility, 'public.trg_enforce_actor'))
    sql(functionSql(readMigration('20260717141822_enforce_symmetric_chat_block_boundary.sql'), 'private.current_user_can_access_pair'))
    sql(functionSql(activity, 'private.enqueue_activity_notification'))
    sql(functionSql(activity, 'public.notify_post_comment'))
    sql(functionSql(readMigration('085_meetup_state_and_comment_count.sql'), 'public.update_post_comment_count'))
    sql(functionSql(topics, 'public.search_community_posts'))
    sql(functionSql(appeals, 'public.admin_moderation_reason_valid'))
    const owners = readMigration('20260722145042_harden_last_active_owner_revoke.sql')
    sql(functionSql(owners, 'public.admin_token_identity_safe'))
    sql(functionSql(owners, 'public.admin_token_authorization'))
    sql(functionSql(readMigration('20260718190000_admin_token_capabilities.sql'), 'public.admin_assert_mutation_capability'))
    sql(functionSql(appeals, 'public.record_audit'))
    sql(functionSql(appeals, 'public.admin_execute_mutation'))
    sql(functionSql(readMigration('20260722152000_harden_admin_invalid_auth_amplification.sql'), 'public.admin_token_authorization_v2'))
    sql(functionSql(appeals, 'public.admin_list_moderation_audit_log'))

    sql(`-- Decoys for the two functions the stored dispatcher delegates to.
      CREATE FUNCTION public.admin_execute_mutation_pre_appeal_lifecycle(text, uuid, text, text, jsonb) RETURNS jsonb
        LANGUAGE sql AS $$ SELECT jsonb_build_object('delegated', $4, 'payload', $5) $$;
      CREATE FUNCTION public.admin_execute_appeal_decision(text, uuid, text, jsonb) RETURNS jsonb
        LANGUAGE sql AS $$ SELECT jsonb_build_object('delegated', 'decide_appeal', 'payload', $4) $$;
      -- A stand-in for the rate limiter, which must keep sorting after the lock refusal.
      CREATE FUNCTION public.fixture_comment_rate_limit() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.content = 'RATE' THEN RAISE EXCEPTION 'rate_limit_comments_hour'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER enforce_actor_post_comments BEFORE INSERT ON public.post_comments
        FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_actor();
      CREATE TRIGGER trg_rl_post_comments_before_insert BEFORE INSERT ON public.post_comments
        FOR EACH ROW EXECUTE FUNCTION public.fixture_comment_rate_limit();
      CREATE TRIGGER trg_post_comments_count AFTER INSERT OR DELETE ON public.post_comments
        FOR EACH ROW EXECUTE FUNCTION public.update_post_comment_count();
      CREATE TRIGGER trg_notify_post_comment AFTER INSERT ON public.post_comments
        FOR EACH ROW EXECUTE FUNCTION public.notify_post_comment();

      ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "Anyone can view active posts" ON public.posts FOR SELECT TO anon, authenticated
        USING (status = 'active' AND moderation_private.profile_content_visible(user_id));
      CREATE POLICY "Authenticated users can create posts" ON public.posts FOR INSERT TO authenticated
        WITH CHECK ((SELECT auth.uid()) = user_id AND NOT is_official);
      CREATE POLICY "Users can delete own posts" ON public.posts FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);
      GRANT SELECT (id, user_id, content, images, is_official, is_pinned, like_count, comment_count, status, created_at, updated_at,
        image_dimensions, content_i18n, source_lang, title, category, region) ON public.posts TO anon, authenticated;
      GRANT INSERT (id, user_id, content, images, image_dimensions, content_i18n, source_lang, title, category) ON public.posts TO authenticated;
      GRANT UPDATE (content_i18n) ON public.posts TO authenticated;
      GRANT DELETE ON public.posts TO authenticated;
      ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "Anyone can view comments" ON public.post_comments FOR SELECT USING (status = 'active');
      CREATE POLICY "Authenticated users can comment" ON public.post_comments FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);
      CREATE POLICY "Users can delete own comments" ON public.post_comments FOR DELETE USING ((SELECT auth.uid()) = user_id);
      GRANT SELECT (id, post_id, user_id, content, parent_comment_id, created_at, like_count, status, content_i18n)
        ON public.post_comments TO anon, authenticated;
      GRANT INSERT (post_id, user_id, content, parent_comment_id) ON public.post_comments TO authenticated;
      GRANT DELETE ON public.post_comments TO authenticated;
      ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "Blockers can view own blocks" ON public.blocks FOR SELECT TO authenticated USING ((SELECT auth.uid()) = blocker_id);
      GRANT SELECT ON public.blocks TO authenticated;
      ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "Users read own notifications" ON public.notifications FOR SELECT USING ((SELECT auth.uid()) = user_id);
      GRANT SELECT (id, user_id, type, title, body, item_id, is_read, created_at, conversation_id) ON public.notifications TO authenticated;
      GRANT SELECT (id, nickname, avatar_url, location, is_illini_verified, uid, status_text, status_emoji) ON public.profiles TO anon, authenticated;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;

      REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public, private, moderation_private FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION moderation_private.profile_content_visible(uuid) TO anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION private.current_user_can_access_pair(uuid,uuid) TO authenticated;
      GRANT EXECUTE ON FUNCTION ${SEARCH} TO anon, authenticated;
      ALTER FUNCTION ${SEARCH} SET statement_timeout = '3s';
      GRANT EXECUTE ON FUNCTION ${DISPATCHER}, public.admin_token_authorization(text), public.admin_token_authorization_v2(text),
        public.admin_list_moderation_audit_log(integer,integer,text), public.record_audit(text,uuid,uuid,jsonb),
        public.update_post_comment_count() TO service_role;

      -- One attempt as a role and user. It is always rolled back, so attempts
      -- never see each other. ask=true returns the statement's single value.
      CREATE FUNCTION harness.attempt(as_role text, as_uid text, action text, ask boolean) RETURNS text LANGUAGE plpgsql AS $$
        DECLARE affected bigint; answer text;
        BEGIN
          BEGIN
            PERFORM set_config('request.jwt.claim.sub', as_uid, true);
            EXECUTE format('SET LOCAL ROLE %I', as_role);
            IF ask THEN
              EXECUTE action INTO answer;
              answer := 'value:' || coalesce(answer, 'null');
            ELSE
              EXECUTE action;
              GET DIAGNOSTICS affected = ROW_COUNT;
              answer := 'ok:' || affected;
            END IF;
            RAISE EXCEPTION USING ERRCODE = 'Z4949', MESSAGE = answer;
          EXCEPTION
            WHEN SQLSTATE 'Z4949' THEN RETURN SQLERRM;
            WHEN OTHERS THEN RETURN SQLSTATE || ':' || SQLERRM;
          END;
        END $$;

      INSERT INTO public.profiles(id, nickname) VALUES ('${AUTHOR}','Topic author'), ('${FOLLOWER}','Follower'),
        ('${REPLIER}','Replier'), ('${OTHER}','Other member'), ('${OFFICIAL}','Site team'), ('${ADMIN}','Admin');
      INSERT INTO public.admin_tokens(token_hash, admin_id, admin_name, admin_email, role) VALUES
        ('${TOKENS.owner}','${ADMIN}','Owner','owner@example.test','owner'),
        ('${TOKENS.operator}','${ADMIN}','Operator','operator@example.test','operator'),
        ('${TOKENS.security_admin}','${ADMIN}','Security','security@example.test','security_admin');
      INSERT INTO public.posts(id, user_id, content, title, category, created_at) VALUES
        ('${TOPIC}','${AUTHOR}','Where can I find a cheap desk?','Cheap desk in Urbana','settling-market', now() - interval '3 days'),
        ('${TOPIC_OTHER}','${OTHER}','Looking for a study group.','Study group','campus-life', now() - interval '2 days');
      INSERT INTO public.posts(id, user_id, content, created_at) VALUES ('${UPDATE}','${AUTHOR}','A legacy update', now() - interval '1 day');`)
    if (legacy) sql(legacy)
    before = { md5: bodyMd5([...REISSUED, SEARCH, DISPATCHER, ...HELPERS]), contract: contract(REISSUED) }
    if (migrate) sql(readMigration(MIGRATION))
  } catch (error) {
    stop()
    throw error
  }

  // Run one administrator action through the public dispatcher as the Edge function does.
  // Each call gets its own idempotency key unless the test names one.
  let keys = 0
  const mutate = (role, action, payload, key = id(800000 + ++keys), hash = 'f'.repeat(64)) =>
    attemptCommitted(`SELECT public.admin_execute_mutation('${TOKENS[role]}', '${key}', '${hash}', '${action}', $payload$${JSON.stringify(payload)}$payload$::jsonb)`)
  // A committed service-role call: the JSON answer, or '<SQLSTATE>:<message>' when refused.
  function attemptCommitted(statement) {
    try {
      return JSON.parse(sql(`BEGIN; SET LOCAL ROLE service_role; ${statement}; COMMIT;`))
    } catch (error) {
      const message = /ERROR:\s+(.*)/.exec(String(error.stderr || error.message))
      return `refused:${message ? message[1].trim() : 'unknown'}`
    }
  }
  return { sql, as, attempt, stop, before, bodyMd5, contract, grants, mutate }
}

// The moderation states D-49 names: who may still write, and the refusal the rest get.
export const STARTED = '2020-01-01 00:00:00+00'
export const ENDS = '2099-01-02 03:04:05+00'
export const ENDS_LABEL = '2099-01-02T03:04:05Z'
export const EXPIRED = '2021-01-01 00:00:00+00'
export const STATES = [
  { name: 'L0', rows: [], refusal: null },
  { name: 'L1', rows: [[1, STARTED, ENDS]], refusal: null },
  ...[2, 3, 4, 5].flatMap(level => [
    { name: `L${level} expired`, rows: [[level, STARTED, EXPIRED]], refusal: null },
    { name: `L${level} active`, rows: [[level, STARTED, ENDS]], refusal: `P0001:suspension_active:${level}:${ENDS_LABEL}` },
    { name: `L${level} open-ended`, rows: [[level, STARTED, null]], refusal: `P0001:suspension_active:${level}:permanent` },
  ]),
]
export const setState = (db, profile, state) => db.sql(`BEGIN;
  DELETE FROM public.suspensions WHERE profile_id = '${profile}';
  ${state.rows.length ? `INSERT INTO public.suspensions(profile_id, level, started_at, ends_at) VALUES ${state.rows.map(([level, startedAt, endsAt]) =>
    `('${profile}', ${level}, '${startedAt}', ${endsAt ? `'${endsAt}'` : 'NULL'})`).join(',')};` : ''}
  COMMIT;`)
