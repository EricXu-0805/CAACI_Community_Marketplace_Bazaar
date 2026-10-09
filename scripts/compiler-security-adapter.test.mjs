import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const requireApp = createRequire(new URL('../app/package.json', import.meta.url));
const { adaptSource, inspectInstall } = requireApp('./build-compat/compiler/adapter.cjs');
const provenance = requireApp('./build-compat/compiler/provenance.json');
const app = fileURLToPath(new URL('../app/', import.meta.url));

test('reviewed compiler inputs adapt reproducibly and reject even one unknown source byte', () => {
  assert.equal(inspectInstall(app).size, 4);
  for (const entry of provenance.modules) {
    const source = readFileSync(path.join(app, 'node_modules', entry.path), 'utf8');
    assert.notEqual(adaptSource(source, entry), source);
    assert.throws(() => adaptSource(source + '\n', entry), /Unreviewed compiler bytes/);
    assert.throws(() => adaptSource(source, { ...entry, adaptedSha256: '0'.repeat(64) }), /Adapted compiler digest/);
    assert.throws(() => adaptSource(source, { ...entry, replacements: [{ before: 'absent binding', after: '', count: 1 }] }), /Compiler binding changed/);
  }
});

test('unreviewed dependency versions fail installation checks before any compiler executes', () => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'compiler-version-'));
  const put = (relative, content) => { const file = path.join(fixture, relative); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, content); };
  try {
    put('package.json', '{}');
    put('package-lock.json', JSON.stringify({ packages: Object.fromEntries(Object.entries(provenance.packages).map(([name, row]) => [`node_modules/${name}`, row])) }));
    for (const [name, row] of Object.entries(provenance.packages)) put(`node_modules/${name}/package.json`, JSON.stringify({ name, version: row.version }));
    put('node_modules/postcss-selector-parser/package.json', JSON.stringify({ name: 'postcss-selector-parser', version: '6.1.3' }));
    assert.throws(() => inspectInstall(fixture), /Unreviewed dependency: postcss-selector-parser/);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});

for (const mode of ['normal', 'vapor', 'official']) {
  test(`${mode} real compiler routes scoped styles, both CSS Modules clients, and map merging through fixed packages`, () => {
    const result = spawnSync(process.execPath, ['--max-old-space-size=256', fileURLToPath(new URL('./fixtures/compiler-security-probe.cjs', import.meta.url)), mode], {
      encoding: 'utf8', timeout: 15_000,
      env: { PATH: process.env.PATH, HOME: os.tmpdir(), TMPDIR: os.tmpdir(), CI: 'local-verification' },
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    const evidence = JSON.parse(result.stdout.trim());
    assert.equal(evidence.loaded.length, mode === 'official' ? 1 : 2, result.stdout);
    assert.ok(evidence.parserCalls >= 6);
    assert.ok(evidence.mapConsumers >= 2);
  });
}

test('registering after an unadapted compiler was loaded fails closed', () => {
  const result = spawnSync(process.execPath, ['-e', `
    const {createRequire} = require('node:module');
    const r = createRequire(${JSON.stringify(path.join(app, 'package.json'))});
    r('@vue/compiler-sfc');
    require('node:assert/strict').throws(() => r('./build-compat/compiler/adapter.cjs').install(), /loaded before the security adapter/);
  `], { encoding: 'utf8', timeout: 10_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});

test('duplicate config modules reuse the same application hook but another application root fails closed', () => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'compiler-second-app-'));
  const directory = path.join(fixture, 'build-compat/compiler');
  mkdirSync(directory, { recursive: true });
  for (const file of ['adapter.cjs', 'provenance.json']) {
    writeFileSync(path.join(directory, file), readFileSync(path.join(app, 'build-compat/compiler', file)));
  }
  try {
    const result = spawnSync(process.execPath, ['-e', `
      const assert = require('node:assert/strict');
      const filename = ${JSON.stringify(path.join(app, 'build-compat/compiler/adapter.cjs'))};
      const first = require(filename).install();
      delete require.cache[require.resolve(filename)];
      assert.equal(require(filename).install(), first);
      assert.throws(() => require(${JSON.stringify(path.join(directory, 'adapter.cjs'))}).install(), /different application root/);
    `], { encoding: 'utf8', timeout: 10_000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});

test('symlink-preserving Node loads are adapted and cannot bypass the early-load guard', () => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'compiler-linked-app-'));
  const linkedApp = path.join(fixture, 'app');
  symlinkSync(app, linkedApp, 'dir');
  try {
    const result = spawnSync(process.execPath, ['--preserve-symlinks', '--max-old-space-size=256', fileURLToPath(new URL('./fixtures/compiler-security-probe.cjs', import.meta.url)), 'normal', linkedApp], {
      encoding: 'utf8', timeout: 15_000,
      env: { PATH: process.env.PATH, HOME: os.tmpdir(), TMPDIR: os.tmpdir(), CI: 'local-verification' },
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout.trim()).loaded.length, 2);
    const late = spawnSync(process.execPath, ['--preserve-symlinks', '-e', `
      const {createRequire} = require('node:module');
      const r = createRequire(${JSON.stringify(path.join(linkedApp, 'package.json'))});
      r('@vue/compiler-sfc');
      require('node:assert/strict').throws(() => r('./build-compat/compiler/adapter.cjs').install(), /loaded before the security adapter/);
    `], { encoding: 'utf8', timeout: 10_000 });
    assert.ifError(late.error);
    assert.equal(late.status, 0, late.stderr);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});

test('every normal Uni script and direct Vite configuration bootstraps the adapter', () => {
  const manifest = JSON.parse(readFileSync(path.join(app, 'package.json')));
  const commands = Object.entries(manifest.scripts).filter(([name]) => /^(dev|build):/.test(name) && name !== 'dev:vercel');
  assert.equal(commands.length, 30);
  for (const [name, command] of commands) assert.ok(command.startsWith('node ./build-compat/compiler/uni.cjs'), name);
  assert.ok(readFileSync(path.join(app, 'vite.config.ts'), 'utf8').startsWith('import "./build-compat/compiler/bootstrap.cjs";'));
});
