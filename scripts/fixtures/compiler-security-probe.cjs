'use strict';
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const requireApp = createRequire(path.join(process.argv[3] || path.resolve(__dirname, '../../app'), 'package.json'));
const adapter = requireApp('./build-compat/compiler/adapter.cjs');
const mode = process.argv[2];
if (mode === 'vapor') process.env.UNI_VUE_VAPOR = 'true';
const state = adapter.install();

let parserCalls = 0;
const parserPath = requireApp.resolve('postcss-selector-parser');
const parser = requireApp('postcss-selector-parser');
require.cache[parserPath].exports = new Proxy(parser, {
  apply(target, receiver, args) { parserCalls++; return Reflect.apply(target, receiver, args); },
});
const maps = requireApp('source-map-js');
let mapConsumers = 0;
maps.SourceMapConsumer = new Proxy(maps.SourceMapConsumer, {
  construct(target, args) { mapConsumers++; return Reflect.construct(target, args); },
});
if (mode !== 'official') requireApp('@dcloudio/uni-cli-shared/dist/alias');
const compiler = requireApp('@vue/compiler-sfc');

(async () => {
  const styled = compiler.compileStyle({
    source: '.host :deep(.child > view), .host :slotted(.slot) { color:red }\n:global(.global) { color:blue }',
    id: 'data-v-compat', filename: 'fixture.vue', scoped: true,
  });
  assert.deepEqual(styled.errors, []);
  assert.match(styled.code, /\.host\[data-v-compat\] \.child > view/);
  assert.match(styled.code, /\.slot\[data-v-compat-s\]/);
  assert.match(styled.code, /\.global/);
  const scopedParserCalls = parserCalls;
  assert.ok(scopedParserCalls > 0, 'scoped styles must call the fixed external parser');

  const modules = await compiler.compileStyleAsync({
    source: '.base {color:red}.card {composes:base}.card:hover > :global(.outside) {color:blue}',
    id: 'data-v-compat', filename: 'fixture.module.css', modules: true,
    modulesOptions: { generateScopedName: name => `compat_${name}` },
  });
  assert.deepEqual(modules.errors, []);
  assert.deepEqual(modules.modules, { base: 'compat_base', card: 'compat_card compat_base' });
  assert.match(modules.code, /\.compat_card:hover > \.outside/);
  // Three rules pass through local-by-default and scope, the two embedded parser clients.
  assert.ok(parserCalls >= scopedParserCalls + 6, 'both CSS Modules parser clients must use the fixed parser');

  const basic = { version: 3, file: 'fixture.scss', sources: ['fixture.scss'], names: [], mappings: 'AAAA', sourcesContent: ['.mapped{color:red}'] };
  const preprocess = map => compiler.compileStyle({
    source: '.mapped{color:red}', id: 'data-v-compat', filename: 'fixture.scss', map: basic,
    preprocessLang: 'scss',
    preprocessCustomRequire: name => {
      assert.equal(name, 'sass');
      return { renderSync: () => ({ css: Buffer.from('.mapped{color:red}'), map: Buffer.from(JSON.stringify(map)), stats: { includedFiles: [] } }) };
    },
  });
  const ordinary = preprocess(basic);
  assert.deepEqual(ordinary.errors, []);
  assert.match(ordinary.code, /color:red/);
  assert.ok(ordinary.map.sources.some(source => source.endsWith('fixture.scss')));
  assert.ok(mapConsumers >= 2, 'preprocessor merger must use the fixed external map consumers');
  const indexed = (line, map = basic) => ({ version: 3, sections: [{ offset: { line, column: 0 }, map }] });
  for (const map of [indexed(1_000_000_000), indexed(6_000_000, indexed(6_000_000))]) {
    const rejected = preprocess(map);
    assert.ok(rejected.errors.some(error => /offset/i.test(String(error))), 'compiler must report excessive offsets before mapping expansion');
  }
  const long = compiler.compileStyle({ source: '.a#b'.repeat(25000) + '{color:red}', id: 'data-v-compat', filename: 'large.vue', scoped: true });
  assert.deepEqual(long.errors, []);
  assert.ok(long.code.includes('[data-v-compat]'));
  console.log(JSON.stringify({ mode, parserCalls, mapConsumers, loaded: [...state.loaded] }));
})().catch(error => { console.error(error); process.exitCode = 1; });
