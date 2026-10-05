'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { watch, FSWatcher } = require('./index.cjs');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(predicate, label) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await pause(20);
  }
  assert.fail('Timed out: ' + label);
}
function write(cwd, file, content) {
  const target = path.join(cwd, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dcloud-watch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('real polling events cover initial scan, future paths, edits, unlink, add/unwatch and close', { timeout: 15000 }, async t => {
  const root = fixture(t);
  const cwd = path.join(root, 'source {a,b} [literal] 雪');
  write(cwd, 'initial/start.txt', 'initial');
  write(cwd, 'ignored/never.txt', 'ignored');
  const watcher = watch('**/*.{txt,json}', { cwd, usePolling: true, interval: 20, binaryInterval: 20, ignored: ['**/ignored/**'] });
  t.after(() => watcher.close());
  const events = [];
  const errors = [];
  watcher.on('all', (event, file) => events.push([event, file]));
  watcher.on('error', error => errors.push(error));
  const occurred = (event, file) => events.some(entry => entry[0] === event && entry[1] === file);
  await once(watcher, 'ready');
  assert.ok(occurred('add', 'initial/start.txt'));
  assert.ok(!events.some(([, file]) => file.startsWith('ignored/')));

  write(cwd, 'missing/nested/new.txt', 'added');
  await eventually(() => occurred('add', 'missing/nested/new.txt'), 'new nested file');
  write(cwd, 'missing/nested/new.txt', 'edited contents');
  await eventually(() => occurred('change', 'missing/nested/new.txt'), 'file edit');
  fs.unlinkSync(path.join(cwd, 'missing/nested/new.txt'));
  await eventually(() => occurred('unlink', 'missing/nested/new.txt'), 'file unlink');

  write(cwd, 'dynamic/start.txt', 'before unwatch');
  await eventually(() => occurred('add', 'dynamic/start.txt'), 'dynamic file');
  assert.equal(watcher.unwatch('dynamic'), watcher);
  const count = events.length;
  write(cwd, 'dynamic/start.txt', 'after unwatch');
  write(cwd, 'dynamic/later.txt', 'after unwatch');
  await pause(250);
  assert.equal(events.length, count, 'unwatch must suppress existing and new descendants');
  assert.equal(watcher.add('dynamic'), watcher);
  await eventually(() => occurred('add', 'dynamic/later.txt'), 're-add discovers existing real file');
  write(cwd, 'dynamic/future.txt', 'after re-add');
  await eventually(() => occurred('add', 'dynamic/future.txt'), 're-add observes future file');

  const closing = watcher.close();
  assert.equal(typeof closing.then, 'function');
  await closing;
  assert.equal(watcher.close(), closing);
  assert.equal(watcher.closed, true);
  const closedCount = events.length;
  write(cwd, 'after-close.txt', 'closed');
  await pause(100);
  assert.equal(events.length, closedCount);
  assert.deepEqual(errors, []);
});

test('ignoreInitial still emits unlink for an unchanged preexisting file', { timeout: 6000 }, async t => {
  const cwd = fixture(t);
  write(cwd, 'existing.vue', 'component');
  const watcher = watch(cwd, { disableGlobbing: true, ignoreInitial: true, usePolling: true, interval: 20 });
  t.after(() => watcher.close());
  const events = [];
  watcher.on('all', (event, file) => events.push([event, file]));
  await once(watcher, 'ready');
  assert.deepEqual(events, []);
  fs.unlinkSync(path.join(cwd, 'existing.vue'));
  await eventually(() => events.some(([event, file]) => event === 'unlink' && file === path.join(cwd, 'existing.vue')), 'preexisting unlink');
});

test('unsupported and ambiguous glob inputs are rejected before watching', async t => {
  const cwd = fixture(t);
  const inputs = [
    'static/{1..9}/**/*.txt',
    'x{1..1000000000}.ts',
    'static/{é..ê}/*.txt',
    '{a,aa}'.repeat(30) + 'X',
    'static/{a,{b,c}}/*.txt',
    '{'.repeat(2000) + 'a,b' + '}'.repeat(2000),
    'foo/{bar,}/file.ts',
    '*a'.repeat(30) + 'X',
    '@(a|aa)'.repeat(30) + 'X',
    path.join(path.dirname(cwd), 'outside', '**', '*.txt'),
  ];
  for (const input of inputs) {
    const watcher = new FSWatcher({ cwd, usePolling: true });
    try { assert.throws(() => watcher.add(input), /DCloud|outside/); }
    finally { await watcher.close(); }
  }
  assert.throws(() => new FSWatcher({ cwd, ignored: '*a'.repeat(30) + 'X' }), /DCloud/);
});
