#!/usr/bin/env node
'use strict';

/*
 * Run: node verify.js
 * Dependency-free state/render verification, NOT a real-browser test.
 * The app runs in Node's VM with small document, location and storage doubles.
 * This checks handlers, state transitions and escaped HTML strings only.
 * It does not verify mouse clicks, native form validation, layout or accessibility.
 * Product files and real browser storage are never written.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const iconSource = fs.readFileSync(path.join(__dirname, 'assets/feather.min.js'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const markup = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const stylesheet = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
const counts = { assertions: 0, coreFlows: 0, supportingGroups: 0, routeRenders: 0 };
const results = [];
const onlyGroup = process.argv.includes('--search-ui') ? '收尾：空态操作与搜索框同步' : null;

function check(value, message) {
  counts.assertions += 1;
  assert.ok(value, message);
}
function equal(actual, expected, message) {
  counts.assertions += 1;
  assert.deepStrictEqual(actual, expected, message);
}
function group(name, kind, run) {
  if (onlyGroup && name !== onlyGroup) return;
  const before = counts.assertions;
  run();
  if (kind === 'core') counts.coreFlows += 1;
  else counts.supportingGroups += 1;
  results.push({ name, assertions: counts.assertions - before });
}

function harness(initialStorage = {}, storageFailures = {}) {
  const storage = new Map(Object.entries(initialStorage));
  const elements = new Map();
  const listeners = { document: {}, window: {} };
  let hash = '#home';
  let hashPending = false;
  let clock = 1900000000000;
  let externalCalls = 0;
  const element = selector => {
    if (selector === '#main h1') return null;
    if (!elements.has(selector)) {
      const classes = new Set();
      elements.set(selector, {
        hidden: selector === '#reset-confirmation',
        innerHTML: '', textContent: '', value: '', focused: false, open: false,
        classList: { add: c => classes.add(c), remove: c => classes.delete(c) },
        addEventListener() {},
        focus() { this.focused = true; },
        blur() { this.focused = false; },
        reset() { this.value = ''; },
        showModal() { this.open = true; },
        close() { this.open = false; }
      });
    }
    return elements.get(selector);
  };
  const location = {
    get hash() { return hash; },
    set hash(value) {
      const next = String(value).startsWith('#') ? String(value) : '#' + value;
      if (next !== hash) { hash = next; hashPending = true; }
    }
  };
  const context = {
    URLSearchParams,
    Date: { now: () => ++clock },
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
      addEventListener(type, callback) { listeners.window[type] = callback; },
      scrollTo() {}
    },
    location,
    localStorage: {
      getItem(key) {
        if (storageFailures.read) throw new Error('Storage access denied');
        return storage.get(key) ?? null;
      },
      setItem(key, value) {
        if (storageFailures.write) throw new Error('Storage quota exceeded');
        storage.set(key, String(value));
      }
    },
    fetch() { externalCalls += 1; throw new Error('Unexpected network request'); },
    XMLHttpRequest: class { constructor() { externalCalls += 1; throw new Error('Unexpected network request'); } },
    WebSocket: class { constructor() { externalCalls += 1; throw new Error('Unexpected network request'); } }
  };
  vm.createContext(context);
  vm.runInContext(iconSource, context, { filename: 'feather.min.js' });
  vm.runInContext(source, context, { filename: 'app.js' });
  function flush() {
    if (hashPending) {
      hashPending = false;
      listeners.window.hashchange?.();
    }
  }
  return {
    go(route) { location.hash = route; flush(); },
    click(action, data = {}) {
      listeners.document.click({ target: { closest() { return { dataset: { action, ...data } }; } } });
      flush();
    },
    submit(kind, values, data = {}) {
      const id = kind === 'report' ? 'report-form' : kind === 'search' ? 'global-search' : '';
      const form = { id, dataset: { form: kind, ...data }, values, classList: { remove() {} } };
      listeners.document.submit({ target: form, preventDefault() {} });
      flush();
    },
    state() { return JSON.parse(vm.runInContext('JSON.stringify(state)', context)); },
    html() { return element('#main').innerHTML; },
    location() { return location.hash; },
    element,
    storage() { return Object.fromEntries(storage); },
    externalCalls() { return externalCalls; }
  };
}

try {
  const app = harness();

  group('收尾：空态操作与搜索框同步', 'support', () => {
    const test = harness();
    equal(test.element('#search-input').value, '', 'Initial homepage search is empty');
    test.go('community?q=no-match-xyz');
    equal((test.html().match(/href="#compose"/g) || []).length, 1, 'Empty search has only the page-heading publish action');
    check(test.html().includes('换一个关键词试试。'), 'Empty search keeps a useful retry hint');
    equal(test.element('#search-input').value, 'no-match-xyz', 'Query navigation updates the search input');
    test.go('community?q=' + encodeURIComponent('显示器 & 书桌'));
    equal(test.element('#search-input').value, '显示器 & 书桌', 'Encoded query is decoded in the input');
    test.element('#search-input').value = '还没提交的搜索';
    test.click('save', { id: 'p1' });
    equal(test.element('#search-input').value, '还没提交的搜索', 'Saving preserves an unsubmitted search on the same route');
    test.click('follow', { id: 'p1' });
    equal(test.element('#search-input').value, '还没提交的搜索', 'Following also preserves an unsubmitted search');
    test.go('post/p1');
    equal(test.element('#search-input').value, '', 'Navigation to a route without q clears the old search');
    test.go('community?q=' + encodeURIComponent('显示器'));
    equal(test.element('#search-input').value, '显示器', 'Returning to a query route restores its query');
    test.click('reset');
    test.click('reset-cancel');
    equal(test.element('#search-input').value, '显示器', 'Cancelling reset preserves the current search');
    test.click('reset');
    test.click('reset-confirm');
    equal(test.element('#search-input').value, '', 'Confirming reset clears search and returns home');
    test.element('#search-input').value = '首页未提交';
    test.click('reset');
    test.click('reset-confirm');
    equal(test.element('#search-input').value, '', 'Reset also clears an unsubmitted search when already home');
  });

  group('核心 1：帖子 → 商品 → 演示消息', 'core', () => {
    app.go('post/p1');
    check(app.html().includes('href="#product/m1"'), 'Post references the original product ID');
    app.go('product/m1');
    check(app.html().includes('联系示例卖家'), 'Available product offers contact');
    app.click('contact', { id: 'm1' });
    equal(app.location(), '#messages?product=m1', 'Contact retains product context');
    check(app.html().includes('href="#product/m1"'), 'Conversation references the same product');
    app.submit('message', { body: '想了解一下显示器尺寸。' }, { id: 'm1' });
    equal(app.state().messages.length, 1, 'One local message is saved');
    equal(app.state().messages[0].productId, 'm1', 'Message uses the same product ID');
    check(app.html().includes('想了解一下显示器尺寸。'), 'Saved message is rendered');
    equal(app.state().messages.length, 1, 'No fabricated seller reply is added');
  });

  group('核心 2：发布 → 本人在售商品关联 → 列表与个人页', 'core', () => {
    app.go('compose');
    check(app.html().includes('value="product:m2"'), 'Own available product can be selected');
    check(!app.html().includes('value="product:m1"'), 'Another owner’s product is not selectable');
    app.submit('compose', { title: '验收：我的教材如何转让？', body: '说明版本与保存情况。', category: '二手与安顿', reference: 'product:m2' });
    const post = app.state().posts[0];
    check(app.location().startsWith('#post/'), 'Publishing navigates to the created post');
    equal(post.productId, 'm2', 'New post references the selected product');
    equal(post.category, '二手与安顿', 'Selected category is preserved');
    check(app.html().includes('href="#product/m2"'), 'Post renders the linked product card');
    app.go('community');
    check(app.html().includes('验收：我的教材如何转让？'), 'Post appears in community');
    app.go('profile');
    check(app.html().includes('验收：我的教材如何转让？'), 'Post appears under own publications');
  });

  group('核心 3：活动 → 唯一讨论 → 同一活动', 'core', () => {
    app.go('events');
    check(app.html().includes('href="#event/ev1"'), 'List links to the event object');
    app.go('event/ev1');
    check(app.html().includes('href="#post/p4"'), 'Detail links to the unique discussion');
    check(app.html().includes('尚未开放，无真实报名或收费'), 'No real registration is implied');
    app.go('post/p4');
    check(app.html().includes('href="#event/ev1"'), 'Discussion links back to the original event');
    equal(app.state().events[0].discussion, 'p4', 'Canonical discussion ID remains unchanged');
  });

  group('核心 4：校友机会 → 发布演示回复', 'core', () => {
    app.go('community?category=' + encodeURIComponent('校友求职'));
    check(app.html().includes('准备第一份实习简历，项目经历写多长？'), 'Career category contains the opportunity discussion');
    app.go('post/p2');
    app.submit('comment', { body: '验收：准备第一份简历时，如何整理项目经历？' }, { id: 'p2' });
    const post = app.state().posts.find(item => item.id === 'p2');
    equal(post.comments.length, 1, 'Reply is appended to the selected post');
    equal(post.comments[0].author, '你（演示）', 'Reply is clearly attributed to a demo identity');
    check(app.html().includes('如何整理项目经历？'), 'Reply is rendered in the discussion');
  });

  group('核心 5：举报 → 审核 → 用户状态 → 恢复', 'core', () => {
    app.go('post/p5');
    app.click('report', { id: 'p5' });
    check(app.element('#report-dialog').open, 'Page-level report dialog opens');
    equal(app.element('#report-form [name="postId"]').value, 'p5', 'Report retains post ID');
    app.submit('report', { postId: 'p5', reason: '内容不实或已失效', detail: '验收：来源待核实。' });
    const report = app.state().reports[0];
    equal(report.status, 'pending', 'New report enters pending state');
    check(!app.element('#report-dialog').open, 'Report dialog closes after submit');
    app.go('admin');
    check(app.html().includes('待处理'), 'Pending report appears in review queue');
    app.click('moderate', { id: report.id, result: 'hidden' });
    check(app.state().posts.find(item => item.id === 'p5').hidden, 'Review hides the referenced post');
    app.go('community');
    check(!app.html().includes('有人确认过这家咖啡店的学生优惠吗？'), 'Hidden post is excluded from public list');
    app.go('post/p5');
    check(app.html().includes('这条内容已在演示审核中隐藏'), 'Direct link shows hidden state');
    app.go('profile');
    check(app.html().includes('已隐藏内容'), 'User sees report outcome');
    app.go('admin');
    app.click('moderate', { id: report.id, result: 'resolved' });
    equal(app.state().reports[0].status, 'resolved', 'Review result updates on restore');
    app.go('post/p5');
    check(app.html().includes('有人确认过这家咖啡店的学生优惠吗？'), 'Restored post is readable again');
  });

  group('补充：本人在售限制与伪造关联', 'support', () => {
    const test = harness();
    test.click('sold', { id: 'm2' });
    test.go('compose');
    check(!test.html().includes('value="product:m2"'), 'Own sold item is excluded from selector');
    test.submit('compose', { title: '陈旧选项测试', body: '商品已售出。', category: '二手与安顿', reference: 'product:m2' });
    check(!test.state().posts[0].productId, 'Stale sold-product reference is not attached');
    test.go('compose');
    test.submit('compose', { title: '他人物品测试', body: '仅验证不能绑定。', category: '二手与安顿', reference: 'product:m1' });
    check(!test.state().posts[0].productId, 'Forged other-owner product reference is not attached');
    test.click('sold', { id: 'm2' });
    test.go('compose');
    check(test.html().includes('value="product:m2"'), 'Restored own active item is selectable again');
    test.go('product/m2');
    check(test.html().includes('这是我的示例商品'), 'Own product does not invite self-contact');
  });

  group('补充：文字转义与空白校验', 'support', () => {
    const test = harness();
    const payload = '<img src=x onerror=alert(1)>';
    test.go('compose');
    test.submit('compose', { title: payload, body: payload, category: '校园生活', reference: '' });
    equal(test.state().posts[0].body, payload, 'Payload is preserved as user text');
    check(test.html().includes('&lt;img src=x onerror=alert(1)&gt;'), 'Rendered text escapes markup');
    check(!test.html().includes(payload), 'No executable image markup enters the generated HTML');
    const before = test.state().posts.length;
    test.go('compose');
    test.submit('compose', { title: '   ', body: '正文', category: '校园生活', reference: '' });
    equal(test.state().posts.length, before, 'Whitespace-only title is rejected by the handler');
    test.submit('compose', { title: '标题', body: '\n  ', category: '校园生活', reference: '' });
    equal(test.state().posts.length, before, 'Whitespace-only body is rejected by the handler');
  });

  group('补充：商品售出在帖子和消息中同步', 'support', () => {
    const test = harness();
    test.click('sold', { id: 'm1' });
    test.go('post/p1');
    check(test.html().includes('已售出'), 'Post reference shows sold state');
    test.go('product/m1');
    check(/data-action="contact"[^>]*disabled/.test(test.html()), 'Sold product contact control is disabled in markup');
    test.go('messages?product=m1');
    check(test.html().includes('演示发送入口已关闭'), 'Conversation explains closed sender');
    check(!test.html().includes('data-form="message"'), 'Sold product has no message form');
    test.submit('message', { body: '陈旧表单提交' }, { id: 'm1' });
    equal(test.state().messages.length, 0, 'Handler rejects sending through a stale form');
    test.click('sold', { id: 'm1' });
    test.go('messages?product=m1');
    check(test.html().includes('data-form="message"'), 'Restored availability reopens the demo sender');
  });

  group('补充：搜索、收藏、关注与本地持久化', 'support', () => {
    app.go('post/p1');
    app.click('save', { id: 'p1' });
    app.click('follow', { id: 'p1' });
    app.go('profile');
    check(app.html().includes('刚搬到 Urbana，书桌怎么配比较实用？'), 'Saved post appears in profile');
    app.go('home');
    app.click('home-tab', { tab: '已关注' });
    check(app.html().includes('刚搬到 Urbana，书桌怎么配比较实用？'), 'Followed tab contains followed post');
    check(!app.html().includes('href="#post/p6"'), 'Unfollowed post is excluded from followed feed');
    app.element('#search-input').value = '显示器';
    app.submit('search', {});
    check(app.location().includes('q='), 'Search creates a query route');
    check(app.html().includes('搜索「显示器」'), 'Search query is rendered');
    const restored = harness(app.storage());
    equal(restored.state().saved, ['p1'], 'Saved IDs survive state reloading');
    equal(restored.state().followed, ['p1'], 'Followed IDs survive state reloading');
    equal(restored.state().messages.length, 1, 'Messages survive state reloading');
  });

  group('补充：页内重置取消 / 确认', 'support', () => {
    const snapshot = JSON.stringify(app.state());
    app.click('reset');
    check(!app.element('#reset-confirmation').hidden, 'First step reveals in-page confirmation');
    equal(JSON.stringify(app.state()), snapshot, 'First step preserves all data');
    app.click('reset-cancel');
    check(app.element('#reset-confirmation').hidden, 'Cancel closes confirmation');
    equal(JSON.stringify(app.state()), snapshot, 'Cancel preserves all data');
    app.click('reset');
    app.click('reset-confirm');
    equal(app.state().posts.length, 6, 'Confirm restores the six seed posts');
    equal(app.state().messages.length, 0, 'Confirm clears local demo messages');
    equal(app.state().reports.length, 0, 'Confirm clears local demo reports');
    equal(app.state().saved.length, 0, 'Confirm clears saved IDs');
    equal(app.state().followed.length, 0, 'Confirm clears followed IDs');
    check(!app.element('#reset-start').hidden && app.element('#reset-confirmation').hidden, 'Reset control returns to its initial state');
    equal(app.location(), '#home', 'Confirm returns to homepage');
  });

  group('补充：存储异常与旧记录恢复', 'support', () => {
    const key = 'illini-community-prototype-v1';
    const unreadable = harness({}, { read: true, write: true });
    equal(unreadable.state().posts.length, 6, 'Blocked storage read still loads seed content');
    check(!unreadable.element('#storage-notice').hidden, 'Blocked storage is explained visibly');
    unreadable.go('post/p1');
    unreadable.click('save', { id: 'p1' });
    equal(unreadable.state().saved, ['p1'], 'In-memory actions still work when storage is blocked');
    check(unreadable.element('#toast').textContent.includes('仅本次打开有效'), 'Success toast qualifies volatile changes');
    equal(Object.keys(unreadable.storage()).length, 0, 'Failed write is not claimed as persistent');
    const full = harness({}, { write: true });
    full.go('compose');
    full.submit('compose', { title: '本次打开可见', body: '测试存储已满。', category: '校园生活', reference: '' });
    equal(full.state().posts.length, 7, 'Quota failure does not prevent the current session from working');
    check(!full.element('#storage-notice').hidden, 'Quota failure produces persistent visible notice');
    const corrupt = harness({ [key]: '{not json' });
    equal(corrupt.state().posts.length, 6, 'Corrupt JSON restores initial content');
    check(corrupt.element('#storage-notice').textContent.includes('无法读取'), 'Corruption is reported accurately');
    const malformed = harness({ [key]: JSON.stringify({ version: 3, posts: [null] }) });
    equal(malformed.state().posts.length, 6, 'Malformed same-version content does not crash');
    const old = harness({ [key]: JSON.stringify({ version: 2 }) });
    equal(old.state().version, 3, 'Old-version data is migrated by loading the new demonstration seed');
    check(old.element('#storage-notice').textContent.includes('新一版示例'), 'Old-version reset is disclosed');
  });

  group('补充：稳定编号与发布时间', 'support', () => {
    const test = harness();
    for (let n = 1; n <= 3; n += 1) {
      test.go('compose');
      test.submit('compose', { title: '快速发布 ' + n, body: '稳定编号测试', category: '校园生活', reference: '' });
    }
    equal(test.state().posts.slice(0, 3).map(p => p.id), ['p-demo-3', 'p-demo-2', 'p-demo-1'], 'Rapid submissions receive unique deterministic IDs');
    const restored = harness(test.storage());
    restored.go('compose');
    restored.submit('compose', { title: '重新载入后发布', body: '不复用已存在编号', category: '校园生活', reference: '' });
    equal(restored.state().posts[0].id, 'p-demo-4', 'Reloaded state avoids existing IDs');
    equal(restored.state().posts[0].time, '本次演示发布', 'Saved post is not permanently labeled just now');
    check(!/Date\.now\(|new Date\(/.test(source), 'App does not depend on wall-clock dates for sample state');
  });

  group('补充：页面与空状态渲染', 'support', () => {
    const routes = ['home', 'community', 'community?category=' + encodeURIComponent('校友求职'), 'community?q=no-match-xyz', 'post/p1', 'post/p2', 'compose', 'market', 'product/m1', 'product/m2', 'events', 'event/ev1', 'offer/o1', 'offer/o2', 'profile', 'admin', 'messages', 'messages?product=m1', 'guide', 'about'];
    for (const route of routes) {
      app.go(route);
      check(app.html().length > 50, 'Route renders without an exception: ' + route);
      counts.routeRenders += 1;
    }
    app.go('offer/o1');
    check(app.html().includes('待核实') && app.html().includes('核实后才可领取'), 'Unverified offer is unavailable');
    app.go('offer/o2');
    check(app.html().includes('已失效') && app.html().includes('优惠已结束'), 'Expired offer is unavailable');
    app.go('profile');
    check(!app.html().includes('Local Pass'), 'Future paid product is absent from ordinary profile');
    app.go('about');
    check(['社区账户', 'CAACI 会员', 'Local Pass'].every(label => app.html().includes(label)), 'Future identity boundaries are explained only in demo notes');
  });

  group('补充：静态边界与外部调用', 'support', () => {
    check(!/\b(?:confirm|alert|prompt)\s*\(/.test(source), 'Application source has no native JS dialogs');
    check(!/(?:src|href)=["']https?:\/\//.test(markup), 'Shell loads no remote resource');
    check(!/@import\s|url\(["']?https?:\/\//.test(stylesheet), 'Stylesheet loads no remote resource');
    check(!/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/.test(source), 'Application has no network call sites');
    equal(app.externalCalls(), 0, 'No network request was attempted in the state run');
    for (const file of ['assets/feather.min.js', 'assets/feather-LICENSE.txt', 'assets/monitor.jpg', 'assets/books.jpg', 'assets/lamp.jpg', 'assets/SOURCES.md']) {
      check(fs.statSync(path.join(__dirname, file)).size > 0, 'Offline asset or attribution exists: ' + file);
    }
  });

  console.log('PASS — Node VM 状态/HTML 字符串检查（非真实浏览器）');
  for (const result of results) console.log(`  ✓ ${result.name}：${result.assertions} 项`);
  console.log(`总计：${counts.coreFlows} 条核心流程，${counts.supportingGroups} 组补充检查，${counts.routeRenders} 种页面状态，${counts.assertions} 项断言全部通过。`);
  console.log('限制：未验证真实鼠标点击、原生表单校验、视觉布局、浏览器焦点或实际用户使用；不能替代浏览器验收。');
} catch (error) {
  console.error(`FAIL after ${counts.assertions} assertions: ${error.message}`);
  console.error(error.stack);
  process.exitCode = 1;
}
