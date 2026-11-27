import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { bin, functionSql, readMigration } from './community-p3-database.mjs'
import { MEMBER_A, startEventsDatabase } from './community-events-database.mjs'

export const MIGRATION = '20261122035253_community_member_events.sql'
export const VERIFY = 'VERIFY_20261122035253_community_member_events.sql'
export const PRECHECK = 'PRECHECK_20261122035253_community_member_events.sql'
export { MEMBER_A, MEMBER_B, SKIP, id, pinned, readOps } from './community-events-database.mjs'

// Keep the old fixture's closed-channel contract intact. This fixture applies
// the next migration and never borrows the old helpers' temporary grants.
export function startMemberEventsDatabase() {
  const db = startEventsDatabase()
  try {
    db.sql(readMigration(MIGRATION))
    // Use the real posting limit for these cases, over the fixture's posts.
    db.sql(functionSql(readMigration('044_rate_limit_window_buffer.sql'), 'public.rl_posts_before_insert'))
    db.sql(`DROP TRIGGER trg_rl_posts_before_insert ON public.posts;
      CREATE TRIGGER trg_rl_posts_before_insert BEFORE INSERT ON public.posts
        FOR EACH ROW EXECUTE FUNCTION public.rl_posts_before_insert();`)
  } catch (error) {
    db.stop()
    throw error
  }
  const as = (statement, role = 'authenticated', uid = MEMBER_A) =>
    db.as(statement, role, uid, { channel: false })
  const attempt = (statement, options = {}) => db.attempt(statement, { ...options, channel: false })
  const connection = db.sql("SELECT current_setting('unix_socket_directories') || ' ' || current_setting('port')").split(' ')
  const run = promisify(execFile)
  // Each statement gets a real connection. No GRANT or REVOKE is issued.
  const together = async (statements, { role = 'authenticated', uid = MEMBER_A } = {}) =>
    Promise.all(statements.map(statement => run(join(bin, 'psql'),
      ['-X', '-h', connection[0], '-p', connection[1], '-U', 'postgres', '-d', 'postgres',
        '-v', 'ON_ERROR_STOP=1', '-qtA', '-c',
        `SELECT pg_backend_pid(); BEGIN; SET LOCAL ROLE ${role}; SET LOCAL request.jwt.claim.sub = '${uid}'; ${statement}; COMMIT;`])
      .then(result => {
        const lines = result.stdout.trim().split('\n')
        return { pid: Number(lines[0]), answer: lines.at(-1) }
      }, error => ({
        pid: Number(String(error.stdout).trim().split('\n')[0]),
        answer: `refused:${/ERROR:\s+(.*)/.exec(String(error.stderr))?.[1] || 'unknown'}`,
      }))))
  const assertGrants = () => {
    assert.equal(db.sql(`SELECT
      has_function_privilege('authenticated', 'public.create_member_event(uuid,text,text,jsonb)', 'EXECUTE')::text || ':' ||
      (SELECT count(*) FROM unnest(ARRAY['source_type','source_key','organizer_user_id','discussion_post_id','starts_at','ends_at','location','registration_mode']) AS c
        WHERE has_column_privilege('authenticated', 'public.community_events', c, 'INSERT')) || ':' ||
      (SELECT count(*) FROM unnest(ARRAY['cancelled_at','status_note']) AS c
        WHERE has_column_privilege('authenticated', 'public.community_events', c, 'UPDATE'))`), 'true:8:2')
  }
  const stop = () => {
    try { assertGrants() } finally { db.stop() }
  }
  return { ...db, as, attempt, together, assertGrants, stop }
}

// The sync tests inherit the real member migration and its unchanged grants.
export function startEventSyncDatabase() {
  const db = startMemberEventsDatabase()
  try {
    db.sql(readMigration('20261123201501_community_event_sync.sql'))
    return db
  } catch (error) {
    db.stop()
    throw error
  }
}

// Keep the A-only fixture available for the overflow control.
export function startEventSyncCapDatabase() {
  const db = startEventSyncDatabase()
  try {
    db.sql(readMigration('20261125004742_community_event_sync_cap.sql'))
    return db
  } catch (error) {
    db.stop()
    throw error
  }
}
