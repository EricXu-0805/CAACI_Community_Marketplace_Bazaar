import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const appManifest = new URL('../app/package.json', import.meta.url);
const requireApp = createRequire(appManifest);
const postcss = requireApp('postcss');
const scoped = requireApp('@dcloudio/uni-cli-shared/dist/postcss/plugins/stylePluginScoped').default;
const uniapp = requireApp('@dcloudio/uni-cli-shared/dist/postcss/plugins/uniapp').default;
const { SourceMapGenerator, SourceMapConsumer, SourceNode } = requireApp('source-map-js');

test('every lock location and actual consumer resolves the reviewed security fixes', () => {
  const fixed = { 'proxy-addr': '2.0.8', 'source-map-js': '1.2.2', 'postcss-selector-parser': '7.1.6' };
  const lock = JSON.parse(readFileSync(new URL('../app/package-lock.json', import.meta.url)));
  for (const [name, version] of Object.entries(fixed)) {
    const locations = Object.entries(lock.packages).filter(([location]) => location.endsWith(`node_modules/${name}`));
    assert.ok(locations.length > 0, name);
    for (const [location, row] of locations) {
      assert.equal(row.version, version, location);
      assert.equal(JSON.parse(readFileSync(new URL(`../app/${location}/package.json`, import.meta.url))).version, version, location);
    }
  }
  for (const consumer of ['@dcloudio/uni-cli-shared', '@dcloudio/uni-app-harmony', '@dcloudio/uni-app-plus', '@dcloudio/uni-h5-vite', 'postcss-modules-local-by-default', 'postcss-modules-scope']) {
    const manifest = new URL(`node_modules/${consumer}/package.json`, appManifest);
    assert.equal(JSON.parse(readFileSync(manifest)).name, consumer);
    const fromConsumer = createRequire(manifest);
    assert.equal(fromConsumer.resolve('postcss-selector-parser'), requireApp.resolve('postcss-selector-parser'), consumer);
  }
  for (const consumer of ['postcss', 'sass', '@vue/compiler-core', '@vue/compiler-sfc', '@dcloudio/uni-cli-shared']) {
    const manifest = new URL(`node_modules/${consumer}/package.json`, appManifest);
    assert.equal(JSON.parse(readFileSync(manifest)).name, consumer);
    const fromConsumer = createRequire(manifest);
    assert.equal(fromConsumer.resolve('source-map-js'), requireApp.resolve('source-map-js'), consumer);
  }
  assert.equal(createRequire(requireApp.resolve('express/package.json')).resolve('proxy-addr'), requireApp.resolve('proxy-addr'));
});

test('Express ignores forwarded client claims from untrusted IPv4 sockets under IPv6 trust ranges', () => {
  const express = requireApp('express');
  const request = (trust, remoteAddress, forwarded) => {
    const app = express();
    app.set('trust proxy', trust);
    return Object.assign(Object.create(express.request), {
      app, headers: { 'x-forwarded-for': forwarded }, socket: { remoteAddress },
    });
  };
  for (const trust of ['::ffff:10.0.0.0/8', '::/1']) {
    const req = request(trust, '203.0.113.10', '198.51.100.9');
    assert.equal(req.ip, '203.0.113.10');
    assert.deepEqual(req.ips, []);
  }
  for (const trust of ['10.0.0.0/8', '::ffff:10.0.0.0/104']) {
    const req = request(trust, '10.1.2.3', '198.51.100.9, 10.2.3.4');
    assert.equal(req.ip, '198.51.100.9');
    assert.deepEqual(req.ips, ['198.51.100.9', '10.2.3.4']);
  }
  assert.equal(request('loopback', '::1', '198.51.100.9').ip, '198.51.100.9');
});

test('PostCSS maps retain original source locations through the upgraded source-map implementation', async () => {
  const source = '.card {\n  color: red;\n}\n';
  const output = await postcss([{
    postcssPlugin: 'compat-color',
    Declaration(decl) { if (decl.prop === 'color') decl.value = 'blue'; },
  }]).process(source, { from: 'original.css', to: 'built.css', map: { inline: false, annotation: false } });
  const consumer = new SourceMapConsumer(output.map.toJSON());
  assert.deepEqual(consumer.originalPositionFor({ line: 2, column: 2 }), {
    source: 'original.css', line: 2, column: 2, name: null,
  });
  assert.equal(consumer.sourceContentFor('original.css'), source);
  assert.equal(SourceNode.fromStringWithSourceMap(output.css, consumer).toString(), output.css);
  const indexed = new SourceMapConsumer({ version: 3, sections: [{ offset: { line: 3, column: 0 }, map: output.map.toJSON() }] });
  assert.deepEqual(indexed.originalPositionFor({ line: 5, column: 2 }), {
    source: 'original.css', line: 2, column: 2, name: null,
  });
  assert.equal(SourceMapGenerator.fromSourceMap(consumer).toJSON().sourcesContent[0], source);
});

test('indexed sourcemaps reject excessive or invalid offsets, including summed nested offsets', () => {
  const basic = { version: 3, sources: ['source.css'], names: [], mappings: 'AAAA', sourcesContent: ['a{}'] };
  const indexed = (line, column = 0, map = basic) => ({ version: 3, sections: [{ offset: { line, column }, map }] });
  for (const invalid of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1']) {
    assert.throws(() => new SourceMapConsumer(indexed(invalid)), /offset/i);
    assert.throws(() => new SourceMapConsumer(indexed(0, invalid)), /offset/i);
  }
  assert.throws(() => new SourceMapConsumer(indexed(1_000_000_000)), /offset/i);
  assert.throws(() => new SourceMapConsumer(indexed(6_000_000, 0, indexed(6_000_000))), /offset/i);
});

test('DCloud scoped CSS keeps deep, slotted, global, deprecated and keyframe output compatible', async () => {
  const input = [
    '.page.kb-up :deep(.input-bar) { padding-bottom:9px }',
    '.u-icon-svg :deep(svg) { width:100% }',
    '.message-list :deep(.uni-scroll-view)::-webkit-scrollbar {display:none}',
    '.host :slotted(.slot > view) { color:red }',
    '.host :global(.external) { color:blue }',
    '.a >>> .b { color:red }',
    '.a /deep/ .b { color:blue }',
    '.a ::v-deep .b { color:green }',
    '@keyframes fade { from { opacity:0 } to { opacity:1 } }',
  ].join('\n');
  const output = await postcss([scoped()]).process(input, { from: undefined });
  assert.equal(output.css, [
    '.page.kb-up .input-bar { padding-bottom:9px }',
    '.u-icon-svg svg { width:100% }',
    '.message-list .uni-scroll-view::-webkit-scrollbar {display:none}',
    '.host .slot > view { color:red }',
    '.external { color:blue }',
    '.a .b { color:red }',
    '.a .b { color:blue }',
    '.a .b { color:green }',
    '@keyframes fade { from { opacity:0 } to { opacity:1 } }',
  ].join('\n'));
  const deprecated = await postcss([scoped(), { postcssPlugin: 'vue-sfc-scoped' }])
    .process('.a >>> .b {color:red}\n.a /deep/ .b {color:blue}\n.a ::v-deep .b {color:green}', { from: undefined });
  assert.equal(deprecated.css, '.a :deep(.b) {color:red}\n.a :deep(.b) {color:blue}\n.a :deep(.b) {color:green}');
});

test('DCloud H5 CSS preserves tag rewriting, page backgrounds, and responsive units', async () => {
  const previous = process.env.UNI_PLATFORM;
  process.env.UNI_PLATFORM = 'h5';
  try {
    const output = await postcss([uniapp()]).process('page { background-color:red; padding:20rpx }\nview.card > text:not(.muted) {width:40rpx}', { from: undefined });
    assert.equal(output.css, 'uni-page-body { background-color:red; padding:0.625rem }\nbody { background-color:red }\nuni-view.card > uni-text:not(.muted) {width:1.25rem}');
  } finally {
    if (previous === undefined) delete process.env.UNI_PLATFORM;
    else process.env.UNI_PLATFORM = previous;
  }
});

test('CSS Modules preserves local exports and global selectors with one shared parser', async () => {
  const output = await postcss([
    requireApp('postcss-modules-local-by-default')(),
    requireApp('postcss-modules-scope')({ generateScopedName: name => `test_${name}` }),
  ]).process('.card {color:red}.card:hover > :global(.external), .title::before {color:blue}', { from: undefined });
  const selectors = [];
  output.root.walkRules(rule => selectors.push(rule.selector));
  assert.deepEqual(selectors, ['.test_card', '.test_card:hover > .external, .test_title::before', ':export']);
  const exported = {};
  output.root.nodes.at(-1).walkDecls(decl => { exported[decl.prop] = decl.value; });
  assert.deepEqual(exported, { card: 'test_card', title: 'test_title' });
});

test('long flat selectors complete within a bounded worker and retain their full output', () => {
  // Isolate the performance regression so a vulnerable future dependency cannot hang the suite.
  const run = spawnSync(process.execPath, ['--max-old-space-size=256', '-e', `
    const assert = require('node:assert/strict');
    const { createRequire } = require('node:module');
    const parser = createRequire(${JSON.stringify(fileURLToPath(appManifest))})('postcss-selector-parser');
    const selector = '.a#b'.repeat(25000);
    assert.equal(parser().processSync(selector), selector);
    const mixed = String.raw\`svg|a[href^="https://"] > .hover\\:text-blue:is(.one, :not(.two))\`;
    assert.equal(parser().processSync(mixed), mixed);
  `], { encoding: 'utf8', timeout: 10_000, env: { PATH: process.env.PATH } });
  assert.ifError(run.error);
  assert.equal(run.status, 0, run.stderr);
});
