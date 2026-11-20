import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/*
 * P4.9: the console's events tab. It lists every event, hidden ones included,
 * and its three buttons send exactly the action the API accepts, each with a
 * reason. Opening a discussion is offered only where the database would accept it.
 */
const page = readFileSync(new URL('../src/pages/admin/index.vue', import.meta.url), 'utf8')

test('the events list is read strictly in both loaders', () => {
  // The owner's full reload names the resource; the tab's own loader asks for its tab by name.
  assert.equal(page.split("resource: 'community_events'").length - 1, 1)
  assert.match(page, /\|\| !isStrictAdminRows\(nextEvents, isStrictCommunityEventRow\)/)
  assert.match(page, /if \(tab === 'community_events'\) return isStrictAdminRows\(value, isStrictCommunityEventRow\)/)
  assert.match(page, /tab === 'community_posts' \|\| tab === 'community_events'\) \{\n\s+await loadPagedAdminTab\(tab, true, tabRequest\)/)
  const validator = page.slice(page.indexOf('function isStrictCommunityEventRow'), page.indexOf('function isStrictPagedAdminRows'))
  // Exactly the columns the API selects, the two embedded rows included: nothing private is expected or accepted.
  assert.match(validator, /'availability', 'hidden_reason', 'cancelled_at', 'duplicate_of', 'discussion_post_id', 'partner', 'topic',/)
  assert.match(validator, /hasExactAdminKeys\(value\.partner, \['name_zh', 'name_en', 'status'\]\)/)
  assert.match(validator, /hasExactAdminKeys\(value\.topic, \['title', 'status'\]\)/)
  assert.doesNotMatch(validator, /consent_ref|content_hash|created_by/)
})

test('each event button sends its own action with a reason', () => {
  const block = page.slice(page.indexOf('function governEvent('), page.indexOf('function onRestoreTopic('))
  assert.match(block, /showModerationReason\(/)
  assert.match(block, /const reason = moderationReasonOrNotify\(r\.content\)/)
  assert.match(block, /await apiPost\(\{ action, event_id: e\.id, reason \}, owner,/)
  assert.match(block, /await loadTab\('community_events', owner, true\)/)
  for (const [handler, action] of [['onEventDiscussion', 'create_event_discussion'], ['onHideEvent', 'hide_event'], ['onUnhideEvent', 'unhide_event']]) {
    assert.match(block, new RegExp(`function ${handler}\\(e: CommunityEventRow\\) \\{ governEvent\\(e, [^)]+\\), '${action}'\\) \\}`), handler)
  }
})

test('a discussion is offered to the owner for a visible organization event that has none yet', () => {
  assert.match(page, /const canOpenDiscussion = \(e: CommunityEventRow\) => canMarkOfficial\.value && e\.source_type !== 'member'\n\s+&& !e\.discussion_post_id && e\.availability === 'visible' && !e\.duplicate_of/)
  const panel = page.slice(page.indexOf(`activeTab === 'community_events'`), page.indexOf(`listHasMore.community_events`))
  assert.match(panel, /v-if="canOpenDiscussion\(e\)"[^>]+data-action="create_event_discussion"/)
  // Only a takedown by an administrator is undone here; an event hidden with its topic comes back with the topic.
  assert.match(panel, /v-if="e\.availability === 'hidden' && e\.hidden_reason === 'admin'"[^>]+data-action="unhide_event"/)
  assert.match(panel, /v-else [^>]+data-action="hide_event"/)
})

test('the two refusals the API names before anything is written release the request key', () => {
  const start = page.indexOf('const DEFINITIVE_ADMIN_NO_COMMIT_ERRORS')
  const allowlist = page.slice(start, page.indexOf('\n])', start))
  for (const name of ['official_profile_not_configured', 'event_discussion_closed']) {
    assert.match(allowlist, new RegExp(`'${name}'`), name)
  }
  assert.match(page, /message === 'event_discussion_closed' \? t\('events\.err\.discussionClosed'\)/)
})
