import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, lstatSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import '../app/build-compat/glob/compat.test.cjs';
import '../app/build-compat/watch/watcher.test.cjs';

const app = fileURLToPath(new URL('../app/', import.meta.url));
const requireApp = createRequire(path.join(app, 'package.json'));
const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex');

test('build consumers install the reviewed compatibility packages with matching source bytes', () => {
  for (const [installed, source, identity] of [
    ['fast-glob', 'glob', '@illini-market/glob-compat'],
    ['chokidar', 'watch', '@illini-market/watch-compat'],
  ]) {
    const entry = requireApp.resolve(installed);
    const directory = path.dirname(entry);
    const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'));
    assert.equal(manifest.name, identity);
    assert.equal(lstatSync(directory).isSymbolicLink(), false, 'audit must see an ordinary installed package');
    assert.equal(digest(entry), digest(path.join(app, 'build-compat', source, 'index.cjs')), 'run clean npm ci after changing local package source');
  }
  for (const consumer of [
    '@dcloudio/uni-app-uts', '@dcloudio/uni-cli-shared', '@dcloudio/uni-cloud',
    '@dcloudio/vite-plugin-uni', 'unimport',
  ]) {
    const fromConsumer = createRequire(path.join(app, 'node_modules', consumer, 'package.json'));
    assert.equal(fromConsumer.resolve('fast-glob'), requireApp.resolve('fast-glob'), consumer);
  }
  const shared = createRequire(path.join(app, 'node_modules/@dcloudio/uni-cli-shared/package.json'));
  assert.equal(shared.resolve('chokidar'), requireApp.resolve('chokidar'));
  const runtime = createRequire(requireApp.resolve('chokidar')).resolve('chokidar-runtime');
  const runtimeManifest = JSON.parse(readFileSync(path.join(path.dirname(runtime), 'package.json'), 'utf8'));
  assert.equal(runtimeManifest.name, 'chokidar');
  assert.equal(runtimeManifest.version, '4.0.3');
});

test('the resolved lock has no independent braces, micromatch, fast-glob or Chokidar 3 package', () => {
  const lock = JSON.parse(readFileSync(path.join(app, 'package-lock.json'), 'utf8'));
  for (const [location, metadata] of Object.entries(lock.packages)) {
    if (!location) continue;
    const inferredName = location.split('node_modules/').at(-1);
    const name = metadata.name || inferredName;
    assert.ok(!['braces', 'micromatch', 'fast-glob'].includes(name), `${location}: ${name}`);
    assert.ok(name !== 'chokidar' || !metadata.version.startsWith('3.'), location);
  }
});
