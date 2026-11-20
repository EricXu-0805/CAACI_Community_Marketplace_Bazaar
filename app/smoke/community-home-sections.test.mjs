import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import twenty from './fixtures/community-home/20-posts.mjs'
import sixty from './fixtures/community-home/60-posts.mjs'
import emptyBoard from './fixtures/community-home/empty-board.mjs'
import oneAuthor from './fixtures/community-home/one-author-five-posts.mjs'
import official from './fixtures/community-home/official-five-posts.mjs'
import { now, day, categories, makePost, makePosts, items } from './fixtures/community-home/helpers.mjs'

const source = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const compile = input => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(input, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText).toString('base64')}`
const input = source('utils/communityHome.ts')
  .replace("'./communityPost'", `'${compile(source('utils/communityPost.ts'))}'`)
  .replace("'./campusTime'", `'${compile(source('utils/campusTime.ts'))}'`)
const { boardFiller, buildHomeSections } = await import(compile(input))

const messages = {}
for (const language of ['zh', 'en']) {
  messages[language] = (await import(compile(source(`composables/i18n/messages/${language}.ts`)))).default
}
const translate = (language = 'zh') => (key, params = {}) => {
  let text = messages[language][key]
  assert.equal(typeof text, 'string', `missing ${language}:${key}`)
  for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value))
  return text
}
const label = (message, language = 'zh') => translate(language)(message.key, message.params)

const build = (posts = [], viewport = 'desktop', stock = items, events = [], clock = now) =>
  buildHomeSections(posts, stock, events, clock, viewport)
const boards = result => result.cards.filter(card => card.kind === 'board')
const postRows = card => card.rows.filter(row => row.kind === 'post')
const allRows = result => [
  ...boards(result).flatMap(postRows), ...result.latest.rows,
  ...(result.newHere || []), ...(result.hot?.rows || []),
]
const ids = rows => rows.map(row => row.post.id)
const atAge = age => new Date(now - age).toISOString()
const hotPost = (id, overrides = {}) => makePost(id, {
  comment_count: 3, reply_user_ids: ['reply-a', 'reply-a', 'reply-b'], ...overrides,
})

test('20-post fixture fills six desktop cards in fixed board order and collapses latest', () => {
  assert.equal(twenty.length, 20)
  const result = build(twenty)
  assert.deepEqual(boards(result).map(card => card.category), categories)
  assert.deepEqual(result.cards.map(card => label(card.title)),
    ['校园日常', '落脚香槟', '学长学姐说', '找搭子', '吃喝好店', '二手好物'])
  assert.deepEqual(result.cards.map(card => label(card.title, 'en')),
    ['Campus life', 'Settling in', 'Ask alumni', 'Find a buddy', 'Around town', 'Market'])
  assert.ok(boards(result).every(card => postRows(card).length === 4 && card.rows.length === 4))
  assert.equal(result.cards[5].items.length, 3)
  assert.equal(result.latest.mode, 'link')
  assert.equal(result.latest.rows.length, 0)
  assert.equal(label(result.latest.link), '查看全部 20 个讨论 ›')
})

test('60-post fixture caps board and latest rows separately on desktop and phone', () => {
  assert.equal(sixty.length, 60)
  for (const [viewport, limit, latestLimit] of [['desktop', 4, 15], ['phone', 3, 10]]) {
    const result = build(sixty, viewport)
    assert.deepEqual(boards(result).map(card => card.category), categories)
    assert.ok(boards(result).every(card => card.rows.length === limit))
    assert.equal(result.latest.mode, 'list')
    assert.equal(result.latest.rows.length, latestLimit)
    assert.equal(result.cards[5].items.length, viewport === 'desktop' ? 3 : 6)
    assert.equal(result.showAbout, viewport === 'desktop')
  }
})

test('empty-board fixture retains the card with exactly one mandated filler', () => {
  assert.equal(emptyBoard.filter(post => post.category === 'local-deals').length, 0)
  const expected = [
    '选课、考试、图书馆座位', '租房合同、银行开户、驾照', '实习、简历、读研选择',
    '拼车、饭搭子、一起自习', '火锅、超市、生日蛋糕',
  ]
  for (const viewport of ['desktop', 'phone']) {
    const result = build(emptyBoard, viewport)
    assert.equal(result.cards.length, 6)
    assert.equal(result.cards[4].rows.length, 1)
    assert.equal(result.cards[4].rows[0].kind, 'filler')
    assert.equal(boardFiller(result.cards[4].category, translate(), 'zh'), '适合在这里问：火锅、超市、生日蛋糕 发第一帖 ›')
    boards(build([], viewport)).forEach((card, i) => {
      assert.equal(card.rows.length, 1, 'one filler reserves the rest of the fixed card height')
      assert.equal(boardFiller(card.category, translate(), 'zh'), `适合在这里问：${expected[i]} 发第一帖 ›`)
    })
    const short = build([makePost('only')], viewport).cards[0]
    assert.equal(short.rows.filter(row => row.kind === 'filler').length, 1)
    assert.equal(short.rows.at(-1).kind, 'filler')
  }
})

test('one-author-five-posts fixture limits an author to two rows including a pin', () => {
  assert.equal(oneAuthor.length, 5)
  for (const viewport of ['desktop', 'phone']) {
    const fixture = oneAuthor.map((post, i) => ({ ...post, is_pinned: i === 4 }))
    const card = build(fixture, viewport).cards[0]
    assert.equal(postRows(card).length, 2, 'same author must have at most two card rows including the pin')
    assert.equal(card.rows[0].post.id, oneAuthor[4].id)
    assert.equal(card.rows.at(-1).kind, 'filler')
  }
})

test('each board has at most one pinned row, always before newer normal rows', () => {
  const fixture = makePosts(30).map((post, i) => ({
    ...post, is_pinned: i >= 20, created_at: atAge((i + 1) * 60_000),
  }))
  for (const viewport of ['desktop', 'phone']) {
    for (const card of boards(build(fixture, viewport))) {
      assert.equal(postRows(card).filter(row => row.post.is_pinned).length, 1)
      assert.equal(card.rows[0].post.is_pinned, true)
      const expected = fixture.filter(p => p.category === card.category && p.is_pinned)[0]
      assert.equal(card.rows[0].post.id, expected.id)
      assert.ok(card.rows.length <= (viewport === 'desktop' ? 4 : 3))
    }
  }
})

test('official-five-posts fixture admits only the newest three on the entire page', () => {
  assert.equal(official.length, 5)
  for (const viewport of ['desktop', 'phone']) {
    const fixture = official.map((post, i) => ({ ...post, is_pinned: i === 4, is_featured: i === 1 }))
    const result = build(fixture, viewport)
    const shown = allRows(result).filter(row => row.post.is_official)
    assert.equal(shown.length, 3)
    assert.deepEqual(ids(shown).sort(), official.slice(0, 3).map(p => p.id).sort())
    assert.ok(!ids(shown).includes(official[4].id), 'an older pin cannot bypass the newest-three official cap')
    assert.equal(result.newHere.length, 1)
  }
})

test('priority is pinned, board, latest, then hot with no duplicate ids across any block', () => {
  const fixture = sixty.map((post, i) => hotPost(post.id, {
    ...post, comment_count: 10 + i, reply_user_ids: ['reply-a', 'reply-b', 'reply-b'],
    is_pinned: i === 59,
  }))
  for (const viewport of ['desktop', 'phone']) {
    const result = build([...fixture, fixture[0], fixture[59]], viewport)
    assert.equal(result.cards[4].rows[0].post.id, fixture[59].id, 'pin wins its board slot despite its age')
    const boardIds = ids(boards(result).flatMap(postRows))
    assert.ok(boardIds.includes(fixture[0].id), 'the newest board post stays in its board instead of latest')
    assert.equal(result.latest.rows[0].post.id, viewport === 'desktop' ? fixture[19].id : fixture[14].id)
    assert.ok(result.hot && result.hot.rows.length === 5)
    assert.equal(result.hot.presentation, viewport === 'desktop' ? 'sidebar' : 'tab')
    const rows = allRows(result)
    assert.equal(new Set(ids(rows)).size, rows.length)
    assert.ok(result.hot.rows.every(row => !boardIds.includes(row.post.id)
      && !ids(result.latest.rows).includes(row.post.id)))
    assert.ok(result.hot.rows.every((row, i, rows) => !i || rows[i - 1].post.comment_count >= row.post.comment_count))
  }
})

test('latest switches exactly at five rows AFTER board dedupe', () => {
  const fourLeft = makePosts(8, ['campus-life'])
  assert.equal(build(fourLeft).latest.mode, 'link')
  assert.equal(build(fourLeft).latest.rows.length, 0)
  const fiveLeft = build(makePosts(9, ['campus-life']))
  assert.equal(fiveLeft.latest.mode, 'list')
  assert.equal(fiveLeft.latest.rows.length, 5)
  assert.equal(build(makePosts(7, ['campus-life']), 'phone').latest.mode, 'link')
  assert.equal(build(makePosts(8, ['campus-life']), 'phone').latest.rows.length, 5)
})

test('weekly labels require three recent topics, include day seven, and exclude future/legacy/hidden rows', () => {
  const fixture = [
    makePost('a', { created_at: atAge(7 * day) }),
    makePost('b', { created_at: atAge(3 * day) }),
    makePost('old', { created_at: atAge(7 * day + 1) }),
    makePost('future', { created_at: atAge(-1) }),
    makePost('legacy', { title: null }),
    makePost('hidden', { status: 'hidden' }),
  ]
  assert.equal(build(fixture).cards[0].weeklyCount, undefined)
  const result = build([...fixture, makePost('c')])
  assert.equal(result.cards[0].weeklyCount, 3)
  assert.equal(label(result.cards[0].weeklyLabel), '本周 3 新帖')
  assert.equal(result.cards[1].weeklyLabel, undefined)
})

test('separate weekly and visible-total projections do not count duplicate feed candidates', () => {
  const result = build({
    candidates: [twenty[0], twenty[0]],
    weeklyCategories: [{ category: 'campus-life' }, { category: 'campus-life' }, { category: 'campus-life' }],
    totalDiscussionCount: 74,
  })
  assert.equal(postRows(result.cards[0]).length, 1)
  assert.equal(result.cards[0].weeklyCount, 3)
  assert.equal(label(result.latest.link), '查看全部 74 个讨论 ›')
})

test('hot needs five seven-day topics, three replies each and two distinct non-author users', () => {
  // Four board rows consume four of five qualifying posts; the fifth can occupy hot.
  const eligible = Array.from({ length: 5 }, (_, i) => hotPost(`hot-${i}`))
  assert.equal(build(eligible.slice(0, 4)).hot, null)
  assert.equal(build(eligible).hot.rows.length, 1, 'threshold is evaluated before placement dedupe')
  const invalid = [
    { comment_count: 2 },
    { reply_user_ids: ['one', 'one', 'one'] },
    { reply_user_ids: ['one', 'one', eligible[0].user_id] },
    { reply_user_ids: undefined },
    { created_at: atAge(7 * day + 1) },
    { created_at: atAge(-1) },
    { status: 'hidden' },
    { status: 'deleted' },
    { title: null },
  ]
  for (const change of invalid) {
    assert.equal(build([{ ...eligible[0], ...change }, ...eligible.slice(1)]).hot, null, JSON.stringify(change))
  }
  assert.ok(build([{ ...eligible[0], created_at: atAge(7 * day) }, ...eligible.slice(1)]).hot)
  assert.equal(build(eligible.map((post, i) => ({ ...post, category: categories[i] }))).hot, null,
    'hide a hot block with no rows left after higher priority placements')
})

test('official placement cap does not change the site-wide hot eligibility threshold', () => {
  const ordinary = Array.from({ length: 7 }, (_, i) => makePost(`ordinary-${i}`, {
    created_at: atAge((i + 10) * 60_000), comment_count: i === 6 ? 3 : 0,
    reply_user_ids: ['reply-a', 'reply-b'],
  }))
  const fixture = [
    ...official.map(post => hotPost(post.id, { ...post, category: 'events-social', comment_count: 3 })),
    ...ordinary,
  ]
  const result = build(fixture)
  assert.equal(result.latest.mode, 'link')
  assert.ok(result.hot, 'hot threshold counts eligible topics before the official placement cap')
  assert.ok(ids(result.hot.rows).includes('ordinary-6'))
  assert.equal(allRows(result).filter(row => row.post.is_official).length, 3)
})

test('recent times are relative in campus time, older dates are absolute and cross-year dates include year', () => {
  const cases = [
    [atAge(0), '刚刚'],
    [atAge(59_999), '刚刚'],
    [atAge(5 * 60_000), '5 分钟前'],
    [atAge(3 * 3_600_000), '3 小时前'],
    ['2026-11-12T20:20:00Z', '昨天 14:20'],
    [atAge(3 * day), '3 天前'],
    [atAge(7 * day), '7 天前'],
    ['2026-11-03T20:00:00Z', '11月3日'],
    ['2025-11-03T20:00:00Z', '2025年11月3日'],
  ]
  for (const [created_at, expected] of cases) {
    assert.equal(build([makePost('clock', { created_at })]).cards[0].rows[0].time.zh, expected)
  }
  assert.equal(build([makePost('clock', { created_at: '2026-11-04T02:00:00Z' })]).cards[0].rows[0].time.zh, '11月3日',
    'absolute date uses campus day instead of UTC or host timezone')
  assert.equal(build([makePost('clock')], 'desktop', [], [], new Date(now)).cards[0].rows[0].time.zh, '1 小时前')
})

test('zero counts are absent, unanswered has a 30-day cutoff, and empty sections are hidden', () => {
  const empty = build([], 'desktop', [])
  assert.equal(empty.newHere, null)
  assert.equal(empty.events, null)
  assert.equal(empty.hot, null)
  assert.ok(!JSON.stringify(empty).includes('0'), 'empty homepage must not render a zero count')
  assert.equal(label(empty.cards[5].filler), '发布第一件 ›')
  const card = build([
    makePost('zero'), makePost('positive', { comment_count: 2, answered_at: atAge(60_000) }),
    makePost('thirty', { created_at: atAge(30 * day) }),
    makePost('older', { created_at: atAge(30 * day + 1) }),
  ]).cards[0]
  const rows = new Map(postRows(card).map(row => [row.post.id, row]))
  assert.equal(rows.get('zero').replyCount, undefined)
  assert.equal(rows.get('zero').unanswered, true)
  assert.equal(rows.get('positive').replyCount, 2)
  assert.equal(rows.get('positive').unanswered, false)
  assert.equal(rows.get('thirty').unanswered, true)
  assert.equal(rows.get('older').unanswered, false)
})

// P3.4 (SPEC 5.2 ④): the latest list has three orders, chosen by its tabs.
test('latest follows the chosen order: last activity, newest first, or unanswered only', () => {
  // One board: its card takes the four newest, the other eight are left for the latest list.
  const posts = makePosts(12, ['campus-life']).map((post, index) => ({
    ...post,
    // The oldest topic was answered a moment ago.
    ...(index === 11 ? { comment_count: 2, last_activity_at: atAge(1000), answered_at: atAge(2000) } : {}),
    // Another old one has a reply, but only from its own author.
    ...(index === 9 ? { comment_count: 1, last_activity_at: atAge(30_000) } : {}),
  }))
  const latest = sort => buildHomeSections(posts, items, [], now, 'desktop', sort).latest
  const rest = ['post-004', 'post-005', 'post-006', 'post-007', 'post-008', 'post-009', 'post-010', 'post-011']
  assert.deepEqual(ids(latest('recent').rows), rest)
  assert.deepEqual(ids(latest(undefined).rows), rest, 'a caller that names no order keeps newest first')
  assert.deepEqual(ids(latest('active').rows),
    ['post-011', 'post-009', 'post-004', 'post-005', 'post-006', 'post-007', 'post-008', 'post-010'])
  assert.deepEqual(ids(latest('unanswered').rows), rest.filter(id => id !== 'post-011'))
  // The board card is the same four rows whichever order the list below it uses.
  for (const sort of ['active', 'recent', 'unanswered']) {
    const card = buildHomeSections(posts, items, [], now, 'desktop', sort).cards[0]
    assert.deepEqual(ids(postRows(card)), ['post-000', 'post-001', 'post-002', 'post-003'])
  }
  // SPEC 5.5 from P3.4: unanswered means nobody but the author has replied.
  const rows = new Map(latest('recent').rows.map(row => [row.post.id, row]))
  assert.deepEqual([rows.get('post-009').unanswered, rows.get('post-009').replyCount], [true, 1])
  assert.deepEqual([rows.get('post-011').unanswered, rows.get('post-011').replyCount], [false, 2])
})

test('an unanswered list with nothing in it keeps the block, so its tabs stay reachable', () => {
  const answered = makePosts(12, ['campus-life']).map(post => ({ ...post, comment_count: 1, answered_at: post.created_at }))
  const result = buildHomeSections(answered, items, [], now, 'desktop', 'unanswered')
  assert.equal(result.latest.mode, 'list')
  assert.deepEqual(result.latest.rows, [])
  // Fewer than five left after the cards is still one link, whichever order was asked for.
  assert.equal(buildHomeSections(makePosts(8, ['campus-life']), items, [], now, 'desktop', 'unanswered').latest.mode, 'link')
})

test('hot never repeats a row of the latest list, whichever order that list is in', () => {
  // Twenty busy topics from this week in one board; the oldest got its replies last.
  const busy = makePosts(20, ['campus-life']).map((post, index) => hotPost(post.id, {
    ...post, comment_count: 3 + index, answered_at: post.created_at,
    last_activity_at: atAge((20 - index) * 1000),
  }))
  for (const sort of ['active', 'recent', 'unanswered']) {
    const result = buildHomeSections(busy, items, [], now, 'desktop', sort)
    const shown = new Set(ids(result.latest.rows))
    assert.ok(result.hot && result.hot.rows.length > 0, `${sort}: hot has rows`)
    assert.ok(result.hot.rows.every(row => !shown.has(row.post.id)), `${sort}: a hot row repeats the latest list`)
  }
})

test('home shows topics only; collapsed total includes visible legacy updates', () => {
  const result = build([
    makePost('topic'), makePost('legacy', { title: null, category: null }),
    makePost('hidden', { status: 'hidden' }), makePost('deleted', { status: 'deleted' }),
  ])
  assert.deepEqual(ids(allRows(result)), ['topic'])
  assert.equal(label(result.latest.link), '查看全部 2 个讨论 ›')
})

test('featured official posts use newHere once, while pinned featured posts keep their board priority', () => {
  const result = build([
    makePost('featured', { is_official: true, is_featured: true }),
    makePost('pinned-featured', { is_official: true, is_featured: true, is_pinned: true }),
    makePost('not-official', { is_featured: true }),
  ])
  assert.deepEqual(ids(result.newHere), ['featured'])
  assert.equal(result.cards[0].rows[0].post.id, 'pinned-featured')
  assert.equal(new Set(ids(allRows(result))).size, allRows(result).length)
})

test('start-here rows name their kind: 守则 for the community guidelines, 指南 for any other post', () => {
  const featured = (id, title, age) => makePost(id, {
    title, is_official: true, is_featured: true, created_at: atAge(age),
  })
  const kinds = (viewport, posts) => build(posts, viewport).newHere
    .map(row => [row.post.id, label(row.type), label(row.type, 'en')])
  for (const viewport of ['desktop', 'phone']) {
    assert.deepEqual(kinds(viewport, [
      featured('checklist', '新生落脚清单：第一周要办的 8 件事', day),
      featured('rules-zh', '社区守则（2026 年 11 月版）', 2 * day),
      featured('rules-en', 'Community Guidelines, November 2026', 3 * day),
    ]), [['checklist', '指南', 'Guide'], ['rules-zh', '守则', 'Rules'], ['rules-en', '守则', 'Rules']])
    // Only the glossary's own name for the rules counts; a guide may have 守则 in its title.
    assert.deepEqual(kinds(viewport, [featured('safety', '二手交易安全守则：当面验货再付款', day)]),
      [['safety', '指南', 'Guide']])
  }
})

test('market filters inactive items, sorts by time/id, caps each viewport and adds one filler when short', () => {
  const fixture = [
    ...items, ...['sold', 'reserved', 'deleted'].map(status => ({ ...items[0], id: status, status })),
    items[0],
  ]
  assert.deepEqual(build([], 'desktop', fixture).cards[5].items.map(i => i.id), items.slice(0, 3).map(i => i.id))
  assert.equal(build([], 'desktop', fixture).cards[5].filler, undefined)
  assert.equal(build([], 'phone', fixture).cards[5].items.length, 6)
  assert.equal(label(build([], 'desktop', items.slice(0, 2)).cards[5].filler), '发布第一件 ›')
})

test('upcoming events include only visible organization sources in the next 30 days and cap at three', () => {
  const event = (id, overrides = {}) => ({
    id, source_type: 'caaci', starts_at: new Date(now + day).toISOString(), availability: 'visible', ...overrides,
  })
  const valid = [
    event('now', { starts_at: new Date(now).toISOString() }),
    event('partner', { source_type: 'partner' }), event('campus', { source_type: 'campus' }),
    event('last-day', { starts_at: new Date(now + 30 * day).toISOString() }),
  ]
  const invalid = [
    event('member', { source_type: 'member' }), event('hidden', { availability: 'hidden' }),
    event('unavailable', { availability: 'unavailable' }), event('duplicate', { duplicate_of: 'campus' }),
    event('past', { starts_at: atAge(1) }), event('far', { starts_at: new Date(now + 30 * day + 1).toISOString() }),
  ]
  assert.equal(build([], 'desktop', [], invalid).events, null)
  for (const viewport of ['desktop', 'phone']) {
    assert.deepEqual(build([], viewport, [], [...invalid, ...valid, valid[0]]).events.map(e => e.id),
      ['now', 'partner', 'campus'])
    assert.deepEqual(build([], viewport, [], [valid[3]]).events.map(e => e.id), ['last-day'])
  }
})

test('selection has explicit id tie-breakers and never mutates frozen inputs or depends on the clock', () => {
  const fixture = makePosts(60).map(post => ({ ...post, created_at: atAge(60_000) }))
  const freeze = value => {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
    return value
  }
  const posts = freeze(fixture)
  const stock = freeze(items.map(item => ({ ...item, images: [] })))
  const before = JSON.stringify([posts, stock])
  const realNow = Date.now
  Date.now = () => { throw new Error('ambient clock must not be read') }
  try {
    const result = build(posts, 'desktop', stock)
    assert.equal(result.cards[0].rows[0].post.id, 'post-055')
    assert.deepEqual(result, build([...posts].reverse(), 'desktop', [...stock].reverse()))
    assert.equal(JSON.stringify([posts, stock]), before)
  } finally {
    Date.now = realNow
  }
})

test('home labels and both board fillers render the SPEC catalog copy through translation keys', () => {
  const result = build(makePosts(3, ['campus-life']), 'desktop', [])
  assert.equal(label(result.cards[0].title, 'en'), 'Campus life')
  assert.equal(label(result.cards[0].description, 'en'), 'Classes, exams, campus life')
  assert.equal(label(result.cards[0].weeklyLabel, 'en'), '3 new this week')
  assert.equal(label(result.latest.link, 'en'), 'See all 3 discussions ›')
  assert.equal(label(result.cards[5].title, 'en'), 'Market')
  assert.equal(label(build([], 'phone', []).cards[5].title, 'en'), 'New in Market')
  assert.equal(label(result.cards[5].filler, 'en'), 'List the first item ›')
  // SPEC 7: "Good for: {topics} · Post the first one ›", with the dot between the two halves.
  assert.equal(boardFiller('campus-life', translate('en'), 'en'),
    'Good for: course loads, exams, library seats · Post the first one ›')
  assert.equal(boardFiller('campus-life', translate('zh'), 'zh'),
    '适合在这里问：选课、考试、图书馆座位 发第一帖 ›')
  const calls = []
  boardFiller('local-deals', key => { calls.push(key); return key }, 'en')
  assert.deepEqual(calls, ['home.fillPrefix', 'plaza.boardAsk.local-deals', 'home.firstPost'])
})
