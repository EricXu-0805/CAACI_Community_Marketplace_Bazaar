'use strict';

// DCloud build compatibility: directory watching plus explicit file selection.
// This intentionally does not implement the complete Chokidar 3 glob API.
const { EventEmitter } = require('node:events');
const path = require('node:path');
const picomatch = require('picomatch');
const runtime = require('chokidar-runtime');

const slash = value => value.split(path.sep).join('/');
const inside = (file, directory) => file === directory || file.startsWith(directory + '/');
const escapeDirectory = value => value.replace(/[\\*?[\]{}()!]/g, '[$&]');
function ordinaryPattern(input) {
  if (input.length > 4096) throw new Error('DCloud watch patterns must be at most 4096 characters');
  const scan = picomatch.scan(input, { tokens: true, parts: true });
  if (scan.isExtglob) throw new Error('Extglobs are outside the DCloud watch compatibility contract');
  const tokens = picomatch.parse(input, {
    expandRange() { throw new Error('Brace ranges are outside the DCloud watch compatibility contract'); },
  }).tokens;
  const braces = tokens.filter(token => token.type === 'brace');
  const openings = braces.filter(token => token.value.endsWith('{')).length;
  if (openings > 1 ||
      tokens.filter(token => token.type === 'comma').length > 31) {
    throw new Error('DCloud watch supports only one non-nested brace alternative group of at most 32 items');
  }
  if (tokens.some((token, index) => token.type === 'comma' &&
      ['brace', 'comma'].some(type => tokens[index - 1]?.type === type || tokens[index + 1]?.type === type))) {
    throw new Error('Empty brace alternatives are outside the DCloud watch compatibility contract');
  }
  let segmentStars = 0;
  let globstars = 0;
  for (const token of tokens) {
    if (token.type === 'slash') segmentStars = 0;
    if (token.type === 'globstar') globstars++;
    if (['star', 'globstar'].includes(token.type) && ++segmentStars > 1 || globstars > 2) {
      throw new Error('DCloud watch supports one wildcard per path segment and at most two globstars');
    }
  }
  return scan;
}
const paths = value => (Array.isArray(value) ? value.flat() : [value]).map(item => {
  if (typeof item !== 'string' || !item) throw new TypeError('Watch paths must be nonempty strings');
  return item;
});

class FSWatcher extends EventEmitter {
  constructor(options = {}) {
    super();
    this.closed = false;
    this.cwd = path.resolve(options.cwd || process.cwd());
    this.relative = options.cwd !== undefined;
    this.options = { ...options, cwd: options.cwd, useFsEvents: false };
    this.selectors = new Map();
    this.exclusions = new Map();
    this.known = new Map();
    this.delivered = new Set();
    this.roots = new Set();
    this.ready = false;
    const ignores = options.ignored == null ? [] : (Array.isArray(options.ignored) ? options.ignored : [options.ignored]);
    this.ignored = ignores.map(ignore => {
      if (typeof ignore === 'function') return ignore;
      if (ignore instanceof RegExp) return file => { ignore.lastIndex = 0; return ignore.test(file); };
      if (typeof ignore !== 'string') throw new TypeError('Unsupported DCloud ignored matcher');
      if (!ordinaryPattern(ignore).isGlob) return file => inside(file, slash(path.resolve(this.cwd, ignore)));
      const matches = picomatch(slash(ignore), { dot: true });
      return file => matches(this.relative && !path.isAbsolute(ignore) ? slash(path.relative(this.cwd, file)) : file);
    });
    const backendOptions = { ...options, cwd: undefined, ignored: (file, stats) => this.isIgnored(slash(file), stats) };
    delete backendOptions.disableGlobbing;
    delete backendOptions.readyTimeout;
    delete backendOptions.useFsEvents;
    this.backend = runtime.watch([], backendOptions);
    this.options.usePolling = this.backend.options.usePolling;
    this.backend.on('all', (event, file, stats) => this.receive(event, slash(file), stats));
    this.backend.on('error', error => this.emit('error', error));
    this.backend.on('raw', (...args) => this.emit('raw', ...args));
    this.backend.on('ready', () => {
      if (!this.ready && !this.closed) { this.ready = true; this.emit('ready'); }
    });
  }

  matcher(input, literal = this.options.disableGlobbing) {
    const absolute = slash(path.resolve(this.cwd, input));
    const glob = !literal && ordinaryPattern(input).isGlob;
    if (glob && !this.relative) {
      throw new Error('DCloud watch compatibility requires cwd for glob inputs; use disableGlobbing for literal directories');
    }
    if (glob && !inside(absolute, slash(this.cwd)) && !inside(absolute, escapeDirectory(slash(this.cwd)))) {
      throw new Error('DCloud watch glob inputs must stay within cwd');
    }
    // Literal directory selectors also match descendants, including directories
    // which do not exist when the watcher is created.
    const matches = glob && picomatch(slash(input), { dot: true });
    const test = glob ? file => matches(path.isAbsolute(input) ? file : slash(path.relative(this.cwd, file))) : file => inside(file, absolute);
    return { absolute, glob, test, root: glob ? slash(this.cwd) : absolute };
  }

  isIgnored(file, stats) {
    return this.ignored.some(test => test(file, stats));
  }

  selected(file, stats) {
    return !this.isIgnored(file, stats) &&
      ![...this.exclusions.values()].some(selector => selector.test(file)) &&
      [...this.selectors.values()].some(selector => selector.test(file));
  }

  emitFile(event, file, stats) {
    const emitted = this.relative ? slash(path.relative(this.cwd, file)) : file;
    this.emit(event, emitted, stats);
    this.emit('all', event, emitted, stats);
  }

  receive(event, file, stats) {
    if (this.closed) return;
    if (event === 'unlink' || event === 'unlinkDir') {
      this.known.delete(file);
      if (event === 'unlinkDir') {
        for (const child of this.known.keys()) if (inside(child, file)) this.known.delete(child);
      }
      const wasDelivered = this.delivered.delete(file);
      if ((wasDelivered || this.options.ignoreInitial) && this.selected(file, stats)) this.emitFile(event, file, stats);
      return;
    }
    const directory = event === 'addDir' || Boolean(stats && stats.isDirectory());
    this.known.set(file, { directory, stats });
    if (!this.selected(file, stats)) return;
    if (event === 'add' || event === 'addDir') {
      if (this.delivered.has(file)) return;
      this.delivered.add(file);
    }
    // ignoreInitial watchers still need to report unlink of preexisting files.
    if (event === 'change') this.delivered.add(file);
    this.emitFile(event, file, stats);
  }

  add(input) {
    if (this.closed) return this;
    const roots = [];
    for (const item of paths(input)) {
      if (item.startsWith('!(')) ordinaryPattern(item);
      const negative = item.startsWith('!');
      const selector = this.matcher(negative ? item.slice(1) : item);
      if (negative) { this.exclusions.set(selector.absolute, selector); continue; }
      this.exclusions.delete(selector.absolute);
      this.selectors.set(selector.absolute, selector);
      if (!this.roots.has(selector.root)) { this.roots.add(selector.root); roots.push(selector.root); }
    }
    // A new selector may target files already observed by a broader directory
    // backend. Reuse those real scan results instead of restarting the watcher.
    if (this.ready && !this.options.ignoreInitial) {
      for (const [file, entry] of this.known) {
        if (!this.delivered.has(file) && this.selected(file, entry.stats)) {
          this.delivered.add(file);
          this.emitFile(entry.directory ? 'addDir' : 'add', file, entry.stats);
        }
      }
    }
    if (roots.length) this.backend.add(roots);
    return this;
  }

  unwatch(input) {
    if (this.closed) return this;
    for (const item of paths(input)) {
      const selector = this.matcher(item);
      this.selectors.delete(selector.absolute);
      this.exclusions.set(selector.absolute, selector);
      for (const file of this.delivered) if (selector.test(file)) this.delivered.delete(file);
    }
    // Roots can serve overlapping selectors. Keep the shared backend alive and
    // remove delivery eligibility, including existing descendant file handles.
    return this;
  }

  getWatched() {
    const watched = {};
    for (const [file, entry] of this.known) {
      if (!this.selected(file, entry.stats)) continue;
      const directory = this.relative ? slash(path.relative(this.cwd, path.dirname(file))) || '.' : slash(path.dirname(file));
      (watched[directory] ||= []).push(path.basename(file));
    }
    for (const children of Object.values(watched)) children.sort();
    return watched;
  }

  close() {
    if (!this.closePromise) {
      this.closed = true;
      this.closePromise = this.backend.close().then(() => {
        this.known.clear(); this.delivered.clear(); this.removeAllListeners();
      });
    }
    return this.closePromise;
  }
}

function watch(input, options) { return new FSWatcher(options).add(input); }
module.exports = { watch, FSWatcher };
