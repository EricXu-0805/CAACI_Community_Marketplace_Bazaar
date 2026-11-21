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
 * as their real stored text, the keyword filter's assertion as its real stored
 * text over a stand-in word list, and stand-ins for the two topic triggers a
 * retry meets (the per-author lock and the repeated-text limit). The whole
 * events migration then runs on top. The full-chain behaviour is
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
// The moderation role's audit list, which the migration reissues with the two kinds that role produces here (D-55 3b).
export const AUDIT_LIST = 'public.admin_list_moderation_audit_log(integer,integer,text)'
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
  'private.assert_moderated_text(text,text)',
]
export const CREATED = [
  'private.community_events_schedule_change()',
  'private.community_events_member_guard()',
  'private.community_events_moderate_text()',
  'private.community_events_post_link()',
  'private.community_events_follow_topic()',
  'public.create_member_event(uuid,text,text,jsonb)',
  'public.list_community_events(text,text,text,integer)',
  'public.admin_execute_community_events(text,uuid,text,text,jsonb)',
]

// The one word the stand-in keyword filter refuses.
export const BLOCKED_WORD = 'fixtureblockedword'

// The three grants that open the member write channel. The events migration withholds them (D-54 2l); the
// migration of P4.6 makes them. A test that writes as a member makes them inside its own transaction, which
// rolls back or takes them back before it commits. One case is the exception (D-55 3e): members writing at once
// on separate connections cannot see a grant that was never committed, so `together` below commits the three
// grants for the length of that call and takes them back in `finally`. The cluster is this test's own and is
// thrown away with it, and the last case of the test file reads from the catalog that the channel is closed.
const CHANNEL = [
  'EXECUTE ON FUNCTION public.create_member_event(uuid, text, text, jsonb)',
  `INSERT (source_type, source_key, organizer_user_id, discussion_post_id, starts_at, ends_at, location, registration_mode)
    ON TABLE public.community_events`,
  'UPDATE (cancelled_at, status_note) ON TABLE public.community_events',
]
export const OPEN_CHANNEL = CHANNEL.map(grant => `GRANT ${grant} TO authenticated;`).join(' ')
export const CLOSE_CHANNEL = CHANNEL.map(grant => `REVOKE ${grant} FROM authenticated;`).join(' ')

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
  INSERT INTO public.community_events (id, source_type, source_key, title, starts_at, page_url, registration_mode, availability, missing_checks, missing_since)
  VALUES ('${EVENT_UNAVAILABLE}', 'caaci', '${id(9002)}', '已撤下', now() + interval '5 days', 'https://caaciorg.com/events/#gone', 'info_only', 'unavailable',
    2, now() - interval '1 day');`

/** @param {{ migrate?: boolean }} options */
export function startEventsDatabase({ migrate = true } = {}) {
  const db = startCommunityDatabase()
  let readBefore = null
  try {
    db.sql(functionSql(readMigration('20261114015420_restricted_account_writes.sql'), 'moderation_private.assert_posting_allowed'))
    db.sql(functionSql(readMigration('001_initial_schema.sql'), 'update_updated_at'))
    // The keyword filter: the assertion a topic's title passes, as stored, over a stand-in list of one word.
    db.sql(`CREATE FUNCTION public.content_moderation_check(raw text) RETURNS text LANGUAGE sql STABLE AS
      $$ SELECT CASE WHEN lower(raw) LIKE '%${BLOCKED_WORD}%' THEN 'sensitive_word' END $$;`)
    db.sql(functionSql(readMigration('20260718230000_authoritative_public_write_resource_boundaries.sql'), 'private.assert_moderated_text'))
    db.sql(`REVOKE ALL ON FUNCTION private.assert_moderated_text(text, text) FROM PUBLIC;
      ALTER FUNCTION public.update_updated_at() SET search_path = public;
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
    readBefore = db.bodyMd5([...READ, AUDIT_LIST])
    if (migrate) {
      db.sql(readMigration(MIGRATION))
      db.sql(organizationRows)
    }
  } catch (error) {
    db.stop()
    throw error
  }

  // One member event through the function. Each topic id gets its own text, as two different events would.
  const eventJson = (starts = "now() + interval '2 days'", location = 'ARC court 3', ends = null) =>
    `jsonb_build_object('starts_at', ${starts}, 'location', '${location}'${ends ? `, 'ends_at', ${ends}` : ''})`
  const createEvent = (uid, postId, { title = 'Badminton on Saturday', content = `Three of us, three more welcome (${postId.slice(-4)}).`, starts, location, ends } = {}) =>
    `SELECT public.create_member_event('${postId}', '${title}', '${content}', ${eventJson(starts, location, ends)})`

  // One rolled-back attempt. A signed-in member's is made with the write channel open, unless channel is false:
  // the grants are made in the transaction the attempt runs in, and go with it.
  const attempt = (action, { role = 'authenticated', uid = MEMBER_A, ask = false, channel = role === 'authenticated' } = {}) => channel
    ? db.sql(`BEGIN; ${OPEN_CHANNEL} SELECT harness.attempt('${role}', '${uid}', $attempt$${action}$attempt$, ${ask}); ROLLBACK;`)
    : db.attempt(action, { role, uid, ask })
  // A committed statement. A signed-in member's is made with the write channel open for that transaction only:
  // the grants are taken back before it commits, and what the statement wrote stays.
  const as = (input, role = 'authenticated', uid = MEMBER_A, { channel = role === 'authenticated' } = {}) => channel
    ? db.sql(`BEGIN; ${OPEN_CHANNEL} SET LOCAL ROLE ${role}; SET LOCAL request.jwt.claim.sub = '${uid}'; ${input}; RESET ROLE; ${CLOSE_CHANNEL} COMMIT;`)
    : db.as(input, role, uid)

  // Statements on separate real connections at once; each resolves to its last output line, or 'refused:<message>'.
  const connection = db.sql("SELECT current_setting('unix_socket_directories') || ' ' || current_setting('port')").split(' ')
  const run = promisify(execFile)
  // Two connections cannot both see a grant that is never committed. So when members write at once, and only
  // then, the channel is opened for the length of the call and closed again whatever the outcome.
  const together = async (statements, { role = 'service_role', uid = '' } = {}) => {
    if (role === 'authenticated') db.sql(OPEN_CHANNEL)
    try {
      return await Promise.all(statements.map(statement => run(join(bin, 'psql'),
        ['-X', '-h', connection[0], '-p', connection[1], '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qtA',
          '-c', `BEGIN; SET LOCAL ROLE ${role}; SET LOCAL request.jwt.claim.sub = '${uid}'; ${statement}; COMMIT;`])
        .then(result => result.stdout.trim().split('\n').pop(), error => `refused:${/ERROR:\s+(.*)/.exec(String(error.stderr))?.[1] || 'unknown'}`)))
    } finally {
      if (role === 'authenticated') db.sql(CLOSE_CHANNEL)
    }
  }

  return { ...db, readBefore, createEvent, together, attempt, as }
}
