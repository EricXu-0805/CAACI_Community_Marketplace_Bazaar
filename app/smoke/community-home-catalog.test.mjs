import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

// SPEC §11 HOME.3, including the catalog-only copy gated on LEGAL.1.
const homeRows = [
  ['home.latest', '全站最新', 'Latest across boards'],
  ['home.seeAll', '全部 ›', 'All ›'],
  ['home.more', '更多 ›', 'More ›'],
  ['home.weekNew', '本周 {n} 新帖', '{n} new this week'],
  ['home.viewMore', '查看更多 ›', 'See more ›'],
  ['home.allDiscussions', '全部讨论 ›', 'All discussions ›'],
  ['home.allDiscussionsBtn', '查看全部讨论', 'See all discussions'],
  ['home.collapsed', '查看全部 {n} 个讨论 ›', 'See all {n} discussions ›'],
  ['home.fillPrefix', '适合在这里问：', 'Good for:'],
  ['home.firstPost', '发第一帖 ›', 'Post the first one ›'],
  ['home.startHere', '新来先看', 'Start here'],
  ['home.startHereFold', '新来先看 · {n} 篇 ›', 'Start here · {n} guides ›'],
  ['home.typeGuide', '指南', 'Guide'],
  ['home.typeRules', '守则', 'Rules'],
  ['home.events', '近期活动', 'Upcoming events'],
  ['home.allEvents', '全部活动 ›', 'All events ›'],
  ['home.hotWeek', '本周热议', 'Hot this week'],
  ['home.market', '二手好物', 'Market'],
  ['home.allMarket', '全部二手 ›', 'All listings ›'],
  ['home.marketNew', '二手新上架', 'New in Market'],
  ['home.marketAll', '看全部二手', 'See all listings'],
  ['home.marketFill', '发布第一件 ›', 'List the first item ›'],
  ['home.about', '关于本站', 'About'],
  ['home.aboutBody', '玉米地是服务 UIUC 及香槟地区华人的论坛，由 Guoyi (Eric) Xu 运营，志愿者协助维护。',
    'Cornfield is a forum for the Chinese community around UIUC and Champaign-Urbana, run by Guoyi (Eric) Xu with help from volunteers.'],
  ['home.aboutBodyCaaci', '玉米地由 CAACI 志愿者维护，免费使用。',
    'Cornfield is maintained by CAACI volunteers and free to use.'],
  ['home.feedback', '意见反馈', 'Feedback'],
  ['home.join', '用校园邮箱加入', 'Join with your campus email'],
  ['home.signIn', '登录', 'Sign in'],
  ['home.dismiss', '关闭', 'Dismiss'],
]

// SPEC §3: home-card descriptions and example asks, referenced from §11.
const boardRows = [
  ['plaza.boardDesc.campus-life', '课程、考试、校园里的事', 'Classes, exams, campus life'],
  ['plaza.boardDesc.settling-market', '租房、银行卡、驾照、公交', 'Housing, banks, licenses, buses'],
  ['plaza.boardDesc.alumni-career', '选课、实习、读研，问过来人', 'Courses, internships, grad school'],
  ['plaza.boardDesc.events-social', '拼车、饭搭子、自习、看球', 'Rides, meals, study, games'],
  ['plaza.boardDesc.local-deals', '香槟附近吃喝和小店', 'Food and shops nearby'],
  ['plaza.boardAsk.campus-life', '选课、考试、图书馆座位', 'course loads, exams, library seats'],
  ['plaza.boardAsk.settling-market', '租房合同、银行开户、驾照', 'leases, bank accounts, licenses'],
  ['plaza.boardAsk.alumni-career', '实习、简历、读研选择', 'internships, résumés, grad school'],
  ['plaza.boardAsk.events-social', '拼车、饭搭子、一起自习', 'rides, meal buddies, study partners'],
  ['plaza.boardAsk.local-deals', '火锅、超市、生日蛋糕', 'hot pot, grocery stores, birthday cakes'],
]

function catalog(lang) {
  const input = readFileSync(new URL(`../src/composables/i18n/messages/${lang}.ts`, import.meta.url), 'utf8')
  const js = ts.transpileModule(input, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const exports = {}
  new Function('exports', js)(exports)
  return exports.default
}

const catalogs = { zh: catalog('zh'), en: catalog('en') }
const mismatches = (rows, messages, column) => rows.flatMap(row =>
  messages[row[0]] === row[column] ? [] : [{ key: row[0], expected: row[column], actual: messages[row[0]] }])

test('every SPEC §11 HOME.3 key has the exact specified value in both catalogs', () => {
  assert.equal(homeRows.length, 29)
  assert.deepEqual(mismatches(homeRows, catalogs.zh, 1), [])
  assert.deepEqual(mismatches(homeRows, catalogs.en, 2), [])
})

test('all five board descriptions and asks match SPEC §3 in both catalogs', () => {
  assert.equal(boardRows.length, 10)
  assert.deepEqual(mismatches(boardRows, catalogs.zh, 1), [])
  assert.deepEqual(mismatches(boardRows, catalogs.en, 2), [])
})

test('control: parity detects both a missing key and altered copy, while existing copy matches', () => {
  const row = homeRows.filter(([key]) => key === 'home.latest')
  assert.deepEqual(mismatches(row, catalogs.zh, 1), [])
  assert.deepEqual(mismatches(row, catalogs.en, 2), [])
  assert.equal(mismatches(row, {}, 2).length, 1)
  assert.equal(mismatches(row, { 'home.latest': 'Latest' }, 2).length, 1)
})
