#!/usr/bin/env node
'use strict';

/*
 * Run: node verify.js
 * Dependency-free Node VM checks for state, handlers and rendered HTML.
 * Real browser input, layout, contrast and screenshots are separate evidence.
 * This script never writes product files, browser storage or network data.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const markup = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const stylesheet = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
const icons = fs.readFileSync(path.join(__dirname, 'assets/feather.min.js'), 'utf8');
const notice = '演示站：内容均为虚构，操作只保存在这个浏览器';
const boards = ['校园日常', '落脚香槟', '学长学姐说', '找搭子', '吃喝好店'];
const retired = ['Illini Market', 'Illini 集市', '校园广场', 'Campus Plaza', '示例'];
const routes = [
  'home', 'community', 'community?category=' + encodeURIComponent('校友求职'),
  'community?q=no-match-xyz', 'post/p1', 'post/p2', 'compose', 'market',
  'product/m1', 'product/m2', 'events', 'event/ev1', 'offer/o1', 'offer/o2',
  'profile', 'admin', 'messages', 'messages?product=m1', 'guide', 'about'
];
let assertions = 0, routeRenders = 0;
const results = [];
function check(value, message) { assertions++; assert.ok(value, message); }
function equal(actual, expected, message) { assertions++; assert.deepStrictEqual(actual, expected, message); }
function group(name, run) {
  const before = assertions;
  run();
  results.push(`${name}: ${assertions - before} assertions`);
}

function harness(initialStorage = {}, failures = {}) {
  const storage = new Map(Object.entries(initialStorage)), elements = new Map();
  const listeners = { document: {}, window: {} };
  let hash = '#home', pending = false, externalCalls = 0, clock = 1794691800000;
  function element(selector) {
    if (!elements.has(selector)) {
      const classes = new Set();
      elements.set(selector, {
        hidden: selector === '#reset-confirmation', open: false, focused: false,
        innerHTML: '', textContent: '', value: '',
        classList: { add(c) { classes.add(c); }, remove(c) { classes.delete(c); } },
        focus() { this.focused = true; }, blur() { this.focused = false; },
        reset() { this.value = ''; }, showModal() { this.open = true; },
        close() { this.open = false; }
      });
    }
    return elements.get(selector);
  }
  const location = {
    get hash() { return hash; },
    set hash(value) {
      const next = String(value).startsWith('#') ? String(value) : '#' + value;
      if (hash !== next) { hash = next; pending = true; }
    }
  };
  const context = {
    URLSearchParams,
    Date: class extends Date { static now() { return ++clock; } },
    setTimeout() { return 0; }, clearTimeout() {},
    matchMedia() { return { matches: false }; },
    FormData: class {
      constructor(form) { this.values = form.values || {}; }
      get(key) { return this.values[key] ?? ''; }
    },
    document: {
      title: '', querySelector: element,
      addEventListener(type, callback) { listeners.document[type] = callback; }
    },
    window: {
      scrollTo() {},
      addEventListener(type, callback) { listeners.window[type] = callback; }
    },
    location,
    localStorage: {
      getItem(key) {
        if (failures.read) throw new Error('Storage denied');
        return storage.get(key) ?? null;
      },
      setItem(key, value) {
        if (failures.write) throw new Error('Storage full');
        storage.set(key, String(value));
      }
    },
    fetch() { externalCalls++; throw new Error('Unexpected network request'); },
    XMLHttpRequest: class { constructor() { externalCalls++; throw new Error('Unexpected network request'); } },
    WebSocket: class { constructor() { externalCalls++; throw new Error('Unexpected network request'); } }
  };
  vm.createContext(context);
  vm.runInContext(icons, context, { filename: 'feather.min.js' });
  vm.runInContext(source, context, { filename: 'app.js' });
  const flush = () => { if (pending) { pending = false; listeners.window.hashchange(); } };
  return {
    go(route) { location.hash = route; flush(); },
    click(action, data = {}) {
      listeners.document.click({
        preventDefault() {},
        target: { closest() { return { dataset: { action, ...data } }; } }
      });
      flush();
    },
    submit(kind, values, data = {}) {
      listeners.document.submit({
        preventDefault() {},
        target: {
          id: kind === 'report' ? 'report-form' : kind === 'search' ? 'global-search' : '',
          dataset: { form: kind, ...data }, values
        }
      });
      flush();
    },
    evaluate(expression) { return JSON.parse(vm.runInContext(`JSON.stringify(${expression})`, context)); },
    state() { return this.evaluate('state'); },
    html() { return element('#main').innerHTML; },
    location() { return hash; },
    title() { return context.document.title; },
    element,
    storage() { return Object.fromEntries(storage); },
    externalCalls() { return externalCalls; }
  };
}

try {
  group('BRAND.7 name, boards and single notice', () => {
    check(markup.includes('玉米地'), 'BRAND.7 shell must use 玉米地');
    check(markup.includes('Cornfield'), 'Shell must include the English brand name');
    equal(markup.split(notice).length - 1, 1, 'Exactly one top notice in the shell');
    check(/class="demo-note"/.test(markup), 'Notice has a dedicated top paragraph');
    for (const word of retired) {
      check(!markup.includes(word) && !source.includes(word), `Retired UI text absent: ${word}`);
    }
    const app = harness();
    equal(app.evaluate('BOARDS.map(b => b.name)'), boards, 'All five D-01 board names, in order');
    check(app.title().endsWith(' · 玉米地'), 'Rendered document title uses the new name');
    check(stylesheet.includes('--brand: #B9452C'), 'Direction A uses the agreed brand token');
    for (const file of ['seal.svg', 'seal-dark.svg']) {
      check(fs.statSync(path.join(__dirname, 'assets', file)).size > 0, `Seal exists: ${file}`);
    }
  });

  group('Title/body limits in HTML and submit handlers', () => {
    const app = harness();
    app.go('compose');
    check(/id="post-title"[^>]*maxlength="120"/.test(app.html()), 'Title HTML maxlength is 120');
    check(/id="post-body"[^>]*maxlength="2000"/.test(app.html()), 'Body HTML maxlength is 2000');
    const before = app.state().posts.length;
    const submit = (title, body, board = 'campus-life') => app.submit('compose', { title, body, board });
    submit('题'.repeat(121), '文'.repeat(2000));
    equal(app.state().posts.length, before, 'Handler rejects 121 title characters');
    equal(app.element('#err-title').textContent, '标题最多 120 字', 'Title error explains the exact limit');
    check(app.element('#post-title').focused, 'Title error focuses its field');
    submit('题'.repeat(120), '文'.repeat(2001));
    equal(app.state().posts.length, before, 'Handler rejects 2001 body characters');
    equal(app.element('#err-body').textContent, '正文最多 2000 字', 'Body error explains the exact limit');
    check(app.element('#post-body').focused, 'Body error focuses its field');
    submit(' ', '正文');
    equal(app.state().posts.length, before, 'Blank title is rejected');
    submit('标题', '\n ');
    equal(app.state().posts.length, before, 'Blank body is rejected');
    submit('标题', '正文', 'unknown');
    equal(app.state().posts.length, before, 'Unknown board is rejected');
    submit('题'.repeat(120), '文'.repeat(2000));
    equal(app.state().posts.length, before + 1, '120/2000 boundary is accepted');
    equal(app.state().posts[0].title.length, 120, 'Accepted title retains all 120 characters');
    equal(app.state().posts[0].body.length, 2000, 'Accepted body retains all 2000 characters');
    check(app.location().startsWith('#post/u'), 'Accepted submission opens the topic');
    equal(app.state().draft, null, 'Publishing clears the saved draft');
  });

  group('D-24 home structure and activity metadata', () => {
    const app = harness();
    for (const desktop of [false, true]) {
      const sections = app.evaluate(`homeSections(${desktop}, '最新回复')`);
      equal(sections.cards.length, 5, 'Five discussion sections');
      const ids = sections.cards.flatMap(c => c.rows.map(p => p.id))
        .concat(sections.newHere.map(p => p.id), sections.latest.map(p => p.id), sections.hot.map(p => p.id));
      equal(new Set(ids).size, ids.length, 'Homepage sections have no duplicate topics');
      for (const card of sections.cards) {
        check(card.rows.length <= (desktop ? 4 : 3), 'Card row limit follows viewport');
        check(card.rows.filter(p => p.pinned).length <= 1, 'At most one pinned topic per board');
        const authors = card.rows.map(p => p.by);
        check(authors.every(by => authors.filter(x => x === by).length <= 2), 'At most two rows per author');
      }
      check(sections.items.every(p => p.status === 'available'), 'Home market excludes sold items');
      equal(sections.items.length, desktop ? 3 : 6, 'Home market row limit follows viewport');
      const html = app.evaluate(`homeView(${desktop}).html`);
      equal((html.match(/data-board="/g) || []).length, 6, 'Six home sections include market');
      check(html.includes('全站最新'), 'Full latest section appears above the five-row threshold');
    }
    const p = app.state().posts.find(p => p.id === 'p1');
    const last = app.evaluate('when(lastTouch(getPost("p1")))');
    const published = app.evaluate('when(getPost("p1"))');
    check(last !== published && p.comments.length > 0, 'Fixture distinguishes activity from publication');
    check(app.evaluate('cardRow(getPost("p1"), true)').includes(last), 'Board card shows last activity time');
    const active = app.evaluate('latestRow(getPost("p1"), true)');
    check(active.includes(last) && active.includes('最后回复 yuki_uiuc'), 'Active list shows matching time and last replier');
    const fresh = app.evaluate('latestRow(getPost("p1"), false)');
    check(fresh.includes(published) && !fresh.includes('最后回复'), 'Newly published list keeps publication metadata');
  });

  group('Core 1: topic to item to local message', () => {
    const app = harness();
    app.go('post/p1');
    check(app.html().includes('href="#product/m1"'), 'Topic links the same item');
    app.go('product/m1');
    check(app.html().includes('私信卖家'), 'Available item offers contact');
    app.click('contact', { id: 'm1' });
    equal(app.location(), '#messages?product=m1', 'Contact preserves item context');
    app.submit('message', { body: '显示器接口是什么？' }, { id: 'm1' });
    equal(app.state().messages, [{ productId: 'm1', body: '显示器接口是什么？' }], 'Only the local outgoing message is added');
    check(app.element('#toast').textContent.includes('对方收不到'), 'Message toast discloses delivery boundary');
    app.click('sold', { id: 'm1' });
    check(!app.html().includes('data-form="message"'), 'Sold item closes sender');
    app.submit('message', { body: '陈旧表单' }, { id: 'm1' });
    equal(app.state().messages.length, 1, 'Stale sender cannot append a message');
    app.go('post/p1');
    check(app.html().includes('已售出'), 'Linked topic reflects sold state');
  });

  group('Core 2: publish and link only own available items', () => {
    const app = harness();
    app.go('compose');
    check(app.html().includes('name="item:m2"'), 'Own item can be selected');
    check(!app.html().includes('name="item:m1"'), 'Other seller item cannot be selected');
    check(!app.html().includes('name="reference"') && !app.html().includes('value="event:'), 'Composer has no event association');
    app.submit('compose', { board: 'settling-market', title: '教材如何转让？', body: '说明版本与保存情况。', 'item:m2': '1', 'item:m1': '1' });
    equal(app.state().posts[0].items, ['m2'], 'Forged other-owner link is excluded');
    equal(app.state().posts[0].board, 'settling-market', 'Board slug is preserved');
    app.go('profile');
    check(app.html().includes('教材如何转让？'), 'Own topic appears in profile');
    app.click('sold', { id: 'm2' });
    app.go('compose');
    check(!app.html().includes('name="item:m2"'), 'Sold own item leaves composer');
    app.submit('compose', { board: 'campus-life', title: '陈旧商品选项', body: '在售状态已变。', 'item:m2': '1' });
    check(!app.state().posts[0].items, 'Stale sold-item link is excluded');
  });

  group('Core 3: event and canonical discussion', () => {
    const app = harness();
    equal(app.state().events.map(ev => ev.source).sort(), ['caaci', 'campus', 'member', 'partner'], 'One fixture per event source');
    app.go('event/ev1');
    check(app.html().includes('href="#post/p4"'), 'Member event links canonical discussion');
    app.go('post/p4');
    check(app.html().includes('href="#event/ev1"'), 'Discussion links original event');
    app.go('events');
    for (const tag of ['CAACI 主办', '转发 · CSSA', '学校活动', '网友发起']) check(app.html().includes(tag), `Source is labelled: ${tag}`);
    app.go('offer/o1');
    check(app.html().includes('吃喝好店') && !app.html().includes('领取'), 'Old offer URL opens the board without a coupon');
    app.go('about');
    check(app.html().includes('href="#admin"'), 'Review entry is in demo notes');
  });

  group('Core 4: reply, save, watch and persistence', () => {
    const app = harness(), before = app.state().posts.find(p => p.id === 'p2').comments.length;
    app.go('post/p2');
    app.submit('comment', { body: '项目经历需要写成果吗？' }, { id: 'p2' });
    const comments = app.state().posts.find(p => p.id === 'p2').comments;
    equal(comments.length, before + 1, 'Reply belongs to selected topic');
    equal(comments.at(-1).by, 'viewer', 'Reply uses the local viewer');
    app.click('save', { id: 'p2' });
    app.click('follow', { id: 'p2' });
    const restored = harness(app.storage());
    equal(restored.state().saved, ['p2'], 'Saved topic survives reload');
    equal(restored.state().followed, ['p2'], 'Watched topic survives reload');
    equal(restored.state().posts.find(p => p.id === 'p2').comments.length, before + 1, 'Reply survives reload');
  });

  group('Core 5: report, hide and restore', () => {
    const app = harness();
    app.go('post/p5');
    app.click('report', { id: 'p5' });
    check(app.element('#report-dialog').open, 'Report dialog opens');
    equal(app.element('#report-form [name="postId"]').value, 'p5', 'Report keeps topic ID');
    app.submit('report', { postId: 'p5', reason: '信息虚假', detail: '来源待核实。' });
    const report = app.state().reports[0];
    equal(report.status, 'pending', 'Report enters pending state');
    app.click('moderate', { id: report.id, result: 'hidden' });
    app.go('post/p5');
    check(app.html().includes('这条内容已被隐藏'), 'Hidden topic is unavailable');
    app.go('community');
    check(!app.html().includes('Campustown 现在哪家火锅还开着？'), 'Hidden topic leaves lists');
    app.click('moderate', { id: report.id, result: 'resolved' });
    app.go('post/p5');
    check(app.html().includes('Campustown 现在哪家火锅还开着？'), 'Restored topic is readable');
  });

  group('Escaping, search, reset and storage failures', () => {
    const app = harness(), payload = '<img src=x onerror=alert(1)>';
    app.go('compose');
    app.submit('compose', { board: 'campus-life', title: payload, body: payload });
    check(app.html().includes('&lt;img src=x onerror=alert(1)&gt;'), 'User markup is escaped');
    check(!app.html().includes(payload), 'User markup cannot become executable HTML');
    app.go('community?q=' + encodeURIComponent('显示器 & 书桌'));
    equal(app.element('#search-input').value, '显示器 & 书桌', 'Search route restores decoded query');
    app.go('post/p1');
    equal(app.element('#search-input').value, '', 'Unrelated route clears query');
    const snapshot = app.state();
    app.click('reset');
    app.click('reset-cancel');
    equal(app.state(), snapshot, 'Cancelling reset preserves state');
    app.click('reset');
    app.click('reset-confirm');
    equal(app.state().posts.length, 43, 'Confirming reset restores the complete fixture');
    equal(app.location(), '#home', 'Reset returns home');
    const key = 'illini-community-prototype-v1';
    const old = harness({ [key]: JSON.stringify({ version: 3 }) });
    equal(old.state().version, 4, 'Old structure is replaced by the current fixture');
    check(old.element('#storage-notice').textContent.includes('之前的操作记录已清空'), 'Version reset is disclosed');
    const corrupt = harness({ [key]: '{invalid' });
    check(corrupt.element('#storage-notice').textContent.includes('无法读取'), 'Corrupt storage is disclosed');
    const blocked = harness({}, { read: true, write: true });
    blocked.click('save', { id: 'p1' });
    equal(blocked.state().saved, ['p1'], 'Blocked storage permits in-memory actions');
    check(!blocked.element('#storage-notice').hidden, 'Blocked storage has a visible notice');
    check(blocked.element('#toast').textContent.includes('仅本次打开有效'), 'Volatile success is qualified');
  });

  group('All 20 retained route states and offline boundary', () => {
    const app = harness();
    for (const route of routes) {
      app.go(route);
      check(app.html().length > 50, `Route renders: ${route}`);
      check(app.title().endsWith(' · 玉米地'), `New title on route: ${route}`);
      for (const word of retired) check(!app.html().includes(word), `Retired text absent on ${route}: ${word}`);
      routeRenders++;
    }
    check(!/\b(?:confirm|alert|prompt)\s*\(/.test(source), 'No native JavaScript dialogs');
    check(!/(?:src|href)=["']https?:\/\//.test(markup), 'Shell loads no remote resource');
    check(!/@import\s|url\(["']?https?:\/\//.test(stylesheet), 'CSS loads no remote resource');
    check(!/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/.test(source), 'Application has no network call sites');
    equal(app.externalCalls(), 0, 'No network request was attempted');
    equal((markup.match(/<option>/g) || []).length, 5, 'Report form has five reasons');
  });

  console.log('PASS: BRAND.7 Node VM state/HTML checks (not a real browser)');
  results.forEach(result => console.log('  ' + result));
  console.log(`TOTAL: ${results.length} groups, ${routeRenders} route states, ${assertions} assertions passed.`);
  console.log('Real input, focus, overflow, font size and contrast require the separate browser evidence.');
} catch (error) {
  console.error(`FAIL after ${assertions} assertions: ${error.message}`);
  console.error(error.stack);
  process.exitCode = 1;
}
