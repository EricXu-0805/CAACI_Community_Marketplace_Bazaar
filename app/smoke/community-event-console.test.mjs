import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

/*
 * P4.9: the console's events tab. It lists every event, hidden ones included,
 * and its three buttons send exactly the action the API accepts, each with a
 * reason. A button is offered only where the database would accept it: that
 * decision is run here as code, and community-event-console.spec.ts clicks the
 * buttons in a browser.
 */
const page = readFileSync(new URL('../src/pages/admin/index.vue', import.meta.url), 'utf8')
const source = path => readFileSync(new URL(`../src/utils/${path}`, import.meta.url), 'utf8')
const compile = input => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(input, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText).toString('base64')}`
// The console words a start with the same Champaign arithmetic as the events pages.
const { eventConsoleActions, eventConsoleMeta, eventConsoleOrganizer, eventConsoleTitle } = await import(
  compile(source('eventConsole.ts').replace("'./eventTime'", `'${compile(source('eventTime.ts'))}'`)))
const row = (source_type, extra = {}) => ({
  id: 'event-1', source_type, title: source_type === 'campus' ? null : '迎新晚会', title_en: 'Welcome night', organizer_name: null,
  starts_at: '2026-11-21T16:00:00Z',
  availability: 'visible', hidden_reason: null, duplicate_of: null, discussion_post_id: null,
  partner: source_type === 'partner' ? { name_zh: '国际象棋社', name_en: 'Chess Club', status: 'active' } : null,
  topic: source_type === 'member' ? { title: '周六羽毛球', status: 'active' } : null,
  ...extra,
})

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

test('a discussion is offered to the owner, for an organization event the database would open one for', () => {
  const offered = (item, owner = true) => eventConsoleActions(item, owner).includes('create_event_discussion')
  for (const source of ['caaci', 'partner', 'campus']) {
    assert.equal(offered(row(source)), true, source)
    assert.equal(offered(row(source), false), false, `${source}, not the owner`)
  }
  // A member's event has its own topic.
  assert.equal(offered(row('member')), false)
  // What create_event_discussion refuses as closed: a row readers are not shown, a duplicate, a partner that is
  // not active, and a row with no title to give the topic. One that has its discussion already is not asked again.
  for (const refused of [
    { availability: 'hidden', hidden_reason: 'admin' }, { availability: 'hidden', hidden_reason: 'post_removed' }, { availability: 'unavailable' },
    { duplicate_of: 'event-0' }, { discussion_post_id: 'topic-1' }, { title: null, title_en: null }, { title: '  ', title_en: ' \n ' },
  ]) assert.equal(offered(row('caaci', refused)), false, JSON.stringify(refused))
  for (const status of ['paused', 'revoked']) {
    assert.equal(offered(row('partner', { partner: { name_zh: '国际象棋社', name_en: 'Chess Club', status } })), false, status)
  }
  // An English-only event takes its English title.
  assert.equal(offered(row('campus', { title: ' ', title_en: 'Research workshop' })), true)
})

test('a takedown is offered for a row readers are shown, and its undo only for an administrator\'s own takedown', () => {
  const moderation = item => eventConsoleActions(item, false)
  for (const source of ['caaci', 'partner', 'campus', 'member']) assert.deepEqual(moderation(row(source)), ['hide_event'], source)
  assert.deepEqual(moderation(row('campus', { availability: 'hidden', hidden_reason: 'admin' })), ['unhide_event'])
  // An event hidden with its topic comes back with the topic.
  assert.deepEqual(moderation(row('member', { availability: 'hidden', hidden_reason: 'post_removed' })), [])
  // What its source withdrew is not shown to readers, so there is nothing to take down.
  for (const source of ['caaci', 'campus']) assert.deepEqual(moderation(row(source, { availability: 'unavailable' })), [], source)
  // The owner's row carries both buttons, the discussion first.
  assert.deepEqual(eventConsoleActions(row('caaci'), true), ['create_event_discussion', 'hide_event'])
  assert.deepEqual(eventConsoleActions(row('caaci', { availability: 'hidden', hidden_reason: 'admin' }), true), ['unhide_event'])
})

test('a row is named by its title and its organizer, in the language of the console', () => {
  assert.equal(eventConsoleTitle(row('caaci')), '迎新晚会')
  assert.equal(eventConsoleTitle(row('campus')), 'Welcome night')
  assert.equal(eventConsoleTitle(row('member', { title: null, title_en: null })), '周六羽毛球')
  assert.equal(eventConsoleTitle(row('member', { topic: null })), '')
  assert.equal(eventConsoleTitle(row('campus', { title: '  ', title_en: '  ' })), '')
  assert.equal(eventConsoleOrganizer(row('partner'), 'zh'), '国际象棋社')
  assert.equal(eventConsoleOrganizer(row('partner'), 'en'), 'Chess Club')
  assert.equal(eventConsoleOrganizer(row('partner', { partner: { name_zh: '国际象棋社', name_en: '', status: 'active' } }), 'en'), '国际象棋社')
  assert.equal(eventConsoleOrganizer(row('campus', { organizer_name: 'University Library' }), 'zh'), 'University Library')
  assert.equal(eventConsoleOrganizer(row('caaci'), 'en'), '')
})

test('a title of line breaks or tabs alone is still a title to the database, and the English one is not taken for it', () => {
  // btrim takes spaces only. create_event_discussion reads such a title as one, makes a single line of it, is left
  // with nothing to give the topic and refuses: no button here, and no title borrowed from the English.
  for (const title of ['\n', '\t', ' \n ', '\r\n']) {
    const item = row('campus', { title, title_en: 'Research workshop' })
    assert.equal(eventConsoleTitle(item), '', JSON.stringify(title))
    assert.equal(eventConsoleActions(item, true).includes('create_event_discussion'), false, JSON.stringify(title))
  }
  // Spaces alone are no title, to the database either: the English one is taken.
  assert.equal(eventConsoleTitle(row('campus', { title: '   ', title_en: 'Research workshop' })), 'Research workshop')
})

test('the line under a title gives the source, the organizer and the start in Champaign time, without a part the row lacks', () => {
  // 16:00 UTC is 10:00 on Saturday in Champaign. The administrator's device is not asked (SPEC 6.7.8).
  // Both languages name the year: the list is not limited to the coming months.
  assert.equal(eventConsoleMeta(row('partner'), 'zh', '合作组织'), '合作组织 · 国际象棋社 · 2026年11月21日 周六 10:00 CT')
  assert.equal(eventConsoleMeta(row('partner'), 'en', 'Partners'), 'Partners · Chess Club · Sat, Nov 21, 2026 10:00 AM CT')
  assert.equal(eventConsoleMeta(row('campus', { organizer_name: 'University Library' }), 'en', 'Campus'),
    'Campus · University Library · Sat, Nov 21, 2026 10:00 AM CT')
  // A member's event names no organizer, and a CAACI row need not: the separator goes with the part.
  assert.equal(eventConsoleMeta(row('member'), 'zh', '网友发起'), '网友发起 · 2026年11月21日 周六 10:00 CT')
  assert.equal(eventConsoleMeta(row('caaci'), 'en', 'CAACI'), 'CAACI · Sat, Nov 21, 2026 10:00 AM CT')
  // In daylight time 15:00 UTC is 10:00 there.
  assert.equal(eventConsoleMeta(row('caaci', { starts_at: '2027-07-10T15:00:00Z' }), 'en', 'CAACI'), 'CAACI · Sat, Jul 10, 2027 10:00 AM CT')
  // The year is Champaign's too: 03:00 UTC on New Year's Day is still the evening of the 31st there.
  assert.equal(eventConsoleMeta(row('caaci', { starts_at: '2027-01-01T03:00:00Z' }), 'zh', 'CAACI 主办'), 'CAACI 主办 · 2026年12月31日 周四 21:00 CT')
})

test('no time in the events tab is worded by the clock of the device', () => {
  const tab = page.slice(page.indexOf("activeTab === 'community_events'"), page.indexOf("activeTab === 'users'"))
  // Control: this is the tab, with the line under each title.
  assert.match(tab, /class="card-meta"/)
  assert.doesNotMatch(tab, /fmtTime|toLocale/)
})

test('the two refusals the API names before anything is written release the request key', () => {
  const start = page.indexOf('const DEFINITIVE_ADMIN_NO_COMMIT_ERRORS')
  const allowlist = page.slice(start, page.indexOf('\n])', start))
  for (const name of ['official_profile_not_configured', 'event_discussion_closed']) {
    assert.match(allowlist, new RegExp(`'${name}'`), name)
  }
  assert.match(page, /message === 'event_discussion_closed' \? t\('events\.err\.discussionClosed'\)/)
})
