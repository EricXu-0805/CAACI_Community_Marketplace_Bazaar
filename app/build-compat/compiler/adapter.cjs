'use strict';

const { createHash } = require('node:crypto');
const { readFileSync, realpathSync } = require('node:fs');
const { createRequire, registerHooks } = require('node:module');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const provenance = require('./provenance.json');

const digest = source => createHash('sha256').update(source).digest('hex');
const fail = message => { throw new Error(`[compiler-security] ${message}`); };
// Vite bundles local config dependencies into a second module instance. Share the
// registration across those copies without loading either compiler before Uni's aliases.
const registrationKey = Symbol.for('illini.compiler-security.registration.v1');
const provenanceDigest = digest(JSON.stringify(provenance));

function adaptSource(source, entry) {
  if (digest(source) !== entry.sha256) fail(`Unreviewed compiler bytes: ${entry.path}`);
  let adapted = source;
  for (const { before, after, count } of entry.replacements) {
    if (adapted.split(before).length - 1 !== count) fail(`Compiler binding changed: ${entry.path}`);
    adapted = adapted.replaceAll(before, after);
  }
  if (digest(adapted) !== entry.adaptedSha256) fail(`Adapted compiler digest mismatch: ${entry.path}`);
  return adapted;
}

function inspectInstall(appRoot) {
  const lock = JSON.parse(readFileSync(path.join(appRoot, 'package-lock.json'), 'utf8'));
  for (const [name, expected] of Object.entries(provenance.packages)) {
    const actual = JSON.parse(readFileSync(path.join(appRoot, 'node_modules', name, 'package.json'), 'utf8'));
    if (actual.name !== name || actual.version !== expected.version) fail(`Unreviewed compiler package: ${name}`);
    const row = lock.packages[`node_modules/${name}`];
    if (!row || ['version', 'resolved', 'integrity'].some(key => row[key] !== expected[key])) {
      fail(`Compiler provenance changed: ${name}`);
    }
  }
  const requireApp = createRequire(path.join(appRoot, 'package.json'));
  const dependencies = new Map();
  for (const [name, version] of Object.entries(provenance.dependencies)) {
    const actual = requireApp(`${name}/package.json`);
    if (actual.name !== name || actual.version !== version) fail(`Unreviewed dependency: ${name}; expected ${version}`);
    dependencies.set(name, requireApp.resolve(name));
  }
  const modules = new Map();
  for (const entry of provenance.modules) {
    const filename = realpathSync(path.join(appRoot, 'node_modules', entry.path));
    // Verify eagerly, execute lazily: DCloud must establish its Vue aliases before compilation.
    adaptSource(readFileSync(filename, 'utf8'), entry);
    const fromCompiler = createRequire(filename);
    for (const [name, expected] of dependencies) {
      if (fromCompiler.resolve(name) !== expected) fail(`Unexpected nested dependency: ${entry.path} -> ${name}`);
    }
    modules.set(pathToFileURL(filename).href, { filename, entry });
  }
  return modules;
}

function install() {
  const appRoot = realpathSync(path.resolve(__dirname, '../..'));
  const existing = globalThis[registrationKey];
  if (existing) {
    if (existing.provenanceDigest !== provenanceDigest) fail('Conflicting compiler adapter provenance');
    if (existing.appRoot !== appRoot) fail('Compiler adapter already registered for a different application root');
    return existing;
  }
  if (typeof registerHooks !== 'function') fail('Node 22.15 or newer is required for synchronous module hooks');
  const modules = inspectInstall(appRoot);
  const basenames = new Set([...modules.values()].map(({ filename }) => path.basename(filename)));
  const matchModule = filename => {
    if (!basenames.has(path.basename(filename))) return undefined;
    return modules.get(pathToFileURL(realpathSync(filename)).href);
  };
  for (const filename of Object.keys(require.cache)) {
    if (matchModule(filename)) fail(`Compiler loaded before the security adapter: ${filename}`);
  }
  const loaded = new Set();
  const hook = registerHooks({
    load(url, context, nextLoad) {
      // --preserve-symlinks may retain /tmp while the same macOS file canonicalizes
      // to /private/tmp. Match the file identity rather than silently missing it.
      const match = modules.get(url) || (url.startsWith('file:') && matchModule(fileURLToPath(url)));
      if (!match) return nextLoad(url, context);
      const source = adaptSource(readFileSync(match.filename, 'utf8'), match.entry);
      loaded.add(match.entry.path);
      return { format: 'commonjs', source, shortCircuit: true };
    },
  });
  const registration = { loaded, hook, provenanceDigest, appRoot };
  Object.defineProperty(globalThis, registrationKey, { value: registration });
  return registration;
}

module.exports = { install, inspectInstall, adaptSource };
