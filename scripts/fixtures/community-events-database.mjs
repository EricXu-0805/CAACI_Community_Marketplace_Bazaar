import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  bin, functionSql, id, readMigration, startCommunityDatabase, TOKENS, OFFICIAL,
} from './community-p3-database.mjs'

/*
 * The throwaway PostgreSQL 17 cluster of the P3 tests, with the P3 migration
 * applied, plus what the events migration reads from the rest of the chain:
 * the D-49 posting assertion and the generic updated_at trigger function, both
 * as their real stored text, and stand-ins for the two topic triggers a retry
 * meets (the per-author lock and the repeated-text limit). The whole events
 * migration then runs on top. The full-chain behaviour is
 * REGRESSION_20261120122054 under L-SQL.
 */
export const MIGRATION = '20261120122054_community_events.sql'
export { SKIP, id, TOKENS, OFFICIAL, STATES, setState, pinned, readOps } from './community-p3-database.mjs'

export const MEMBER_A = id(31) // campus email verified
export const MEMBER_B = id(32) // campus email verified
export const UNVERIFIED = id(33)
export const RESTRICTED = id(34) // verified; the D-49 tests give it its state
export const PARTNER = id(41)
export const PARTNER_REVOKED = id(42)
export const EVENT_CAACI = id(51)
export const EVENT_PARTNER = id(52)
export const EVENT_CAMPUS = id(53)
export const EVENT_REVOKED = id(54)
export const EVENT_UNAVAILABLE = id(55)

export const DISPATCHER = 'public.admin_execute_mutation(text,uuid,text,text,jsonb)'
export const PREDECESSOR = 'public.admin_execute_mutation_pre_community_events(text,uuid,text,text,jsonb)'
// What the migration wraps or calls and leaves as it is.
export const READ = [
  DISPATCHER,
  'public.admin_assert_mutation_capability(uuid,text)',
  'public.record_audit(text,uuid,uuid,jsonb)',
  'public.admin_moderation_reason_valid(text)',
  'moderation_private.profile_content_visible(uuid)',
  'moderation_private.assert_posting_allowed(uuid)',
  'public.update_updated_at()',
  'public.trg_enforce_actor()',
]
export const CREATED = [
  'private.community_events_schedule_change()',
  'private.community_events_member_guard()',
  'private.community_events_post_link()',
  'private.community_events_follow_topic()',
  'public.create_member_event(uuid,text,text,jsonb)',
  'public.list_community_events(text,text,text,integer)',
  'public.admin_execute_community_events(text,uuid,text,text,jsonb)',
]

// The three shapes an organization's row may have, as their writers will produce them.
export const organizationRows = `
  INSERT INTO public.community_event_partners (id, slug, name_zh, name_en, consent_ref, consent_recorded_on, contact_role, allowed_link_hosts)
  VALUES ('${PARTNER}', 'chess-club', '国际象棋社', 'Chess Club', 'CONSENT-001', '2026-11-01', 'President', ARRAY['chess.example.test']);
  INSERT INTO public.community_event_partners (id, slug, name_zh, name_en, status, revoked_at, consent_ref, consent_recorded_on, contact_role)
  VALUES ('${PARTNER_REVOKED}', 'old-club', '旧社团', 'Old Club', 'revoked', now(), 'CONSENT-002', '2026-10-01', 'President');
  INSERT INTO public.community_events (id, source_type, source_key, title, title_en, starts_at, ends_at, page_url, register_url, registration_mode, location)
  VALUES ('${EVENT_CAACI}', 'caaci', '${id(9001)}', '迎新晚会', 'Welcome night', now() + interval '3 days', now() + interval '3 days 2 hours',
    'https://caaciorg.com/events/#welcome-night', 'https://caaciorg.com/events/welcome-night/register/', 'caaci_site', 'Illini Union');
  INSERT INTO public.community_events (id, source_type, source_key, partner_id, consent_ref, title, summary, starts_at, page_url, registration_mode, location)
  VALUES ('${EVENT_PARTNER}', 'partner', 'chess-club|https://chess.example.test/open', '${PARTNER}', 'CONSENT-001', '公开赛', 'Open tournament.',
    now() + interval '3 days', 'https://chess.example.test/open', 'info_only', 'ARC');
  INSERT INTO public.community_events (id, source_type, source_key, organizer_name, title_en, starts_at, page_url, registration_mode, location)
  VALUES ('${EVENT_CAMPUS}', 'campus', '7/123456', 'University Library', 'Research workshop', now() + interval '3 days',
    'https://calendars.illinois.edu/detail/7/123456', 'calendar_page', 'Main Library');
  INSERT INTO public.community_events (id, source_type, source_key, partner_id, consent_ref, title, summary, starts_at, page_url, registration_mode)
  VALUES ('${EVENT_REVOKED}', 'partner', 'old-club|https://old.example.test/meet', '${PARTNER_REVOKED}', 'CONSENT-002', '旧活动', 'Old meetup.',
    now() + interval '4 days', 'https://old.example.test/meet', 'info_only');
  INSERT INTO public.community_events (id, source_type, source_key, title, starts_at, page_url, registration_mode, availability)
  VALUES ('${EVENT_UNAVAILABLE}', 'caaci', '${id(9002)}', '已撤下', now() + interval '5 days', 'https://caaciorg.com/events/#gone', 'info_only', 'unavailable');`

/** @param {{ migrate?: boolean }} options */
export function startEventsDatabase({ migrate = true } = {}) {
  const db = startCommunityDatabase()
  let readBefore = null
  try {
    db.sql(functionSql(readMigration('20261114015420_restricted_account_writes.sql'), 'moderation_private.assert_posting_allowed'))
    db.sql(functionSql(readMigration('001_initial_schema.sql'), 'update_updated_at'))
    db.sql(`ALTER FUNCTION public.update_updated_at() SET search_path = public;
      REVOKE ALL ON FUNCTION moderation_private.assert_posting_allowed(uuid) FROM PUBLIC, anon, authenticated, service_role;
      INSERT INTO public.profiles (id, nickname, is_illini_verified) VALUES
        ('${MEMBER_A}', 'Member A', true), ('${MEMBER_B}', 'Member B', true),
        ('${UNVERIFIED}', 'Unverified', false), ('${RESTRICTED}', 'Restricted', true);
      -- Stand-ins named like the real topic triggers, so they fire in the real order: one author's
      -- topic inserts run one at a time, and a text the author posted within the last minute is refused.
      CREATE FUNCTION public.fixture_post_serialize() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN PERFORM pg_advisory_xact_lock(hashtextextended('public-write:posts:' || NEW.user_id::text, 0)); RETURN NEW; END $$;
      CREATE FUNCTION public.fixture_post_duplicate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
        BEGIN
          IF NOT NEW.is_official AND EXISTS (SELECT 1 FROM public.posts WHERE user_id = NEW.user_id AND content = NEW.content
              AND created_at > now() - interval '60 seconds') THEN
            RAISE EXCEPTION 'duplicate_post';
          END IF;
          RETURN NEW;
        END $$;
      CREATE TRIGGER serialize_public_write_actor BEFORE INSERT ON public.posts
        FOR EACH ROW EXECUTE FUNCTION public.fixture_post_serialize();
      CREATE TRIGGER trg_rl_posts_before_insert BEFORE INSERT ON public.posts
        FOR EACH ROW EXECUTE FUNCTION public.fixture_post_duplicate();`)
    readBefore = db.bodyMd5(READ)
    if (migrate) {
      db.sql(readMigration(MIGRATION))
      db.sql(organizationRows)
    }
  } catch (error) {
    db.stop()
    throw error
  }

  // One member event through the function. Each topic id gets its own text, as two different events would.
  const eventJson = (starts = "now() + interval '2 days'", location = 'ARC court 3') =>
    `jsonb_build_object('starts_at', ${starts}, 'location', '${location}')`
  const createEvent = (uid, postId, { title = 'Badminton on Saturday', content = `Three of us, three more welcome (${postId.slice(-4)}).`, starts, location } = {}) =>
    `SELECT public.create_member_event('${postId}', '${title}', '${content}', ${eventJson(starts, location)})`

  // Statements on separate real connections at once; each resolves to its last output line, or 'refused:<message>'.
  const connection = db.sql("SELECT current_setting('unix_socket_directories') || ' ' || current_setting('port')").split(' ')
  const run = promisify(execFile)
  const together = (statements, { role = 'service_role', uid = '' } = {}) => Promise.all(statements.map(statement => run(join(bin, 'psql'),
    ['-X', '-h', connection[0], '-p', connection[1], '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qtA',
      '-c', `BEGIN; SET LOCAL ROLE ${role}; SET LOCAL request.jwt.claim.sub = '${uid}'; ${statement}; COMMIT;`])
    .then(result => result.stdout.trim().split('\n').pop(), error => `refused:${/ERROR:\s+(.*)/.exec(String(error.stderr))?.[1] || 'unknown'}`)))

  return { ...db, readBefore, createEvent, together }
}
