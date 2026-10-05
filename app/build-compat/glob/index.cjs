'use strict';

// Bounded compatibility for the observed DCloud and unimport glob callers.
// This package is not the fast-glob public API. Unsupported contracts throw.
const path = require('node:path');
const fs = require('node:fs');
const { fdir } = require('fdir');
const picomatch = require('picomatch');
const globParent = require('glob-parent');
const fillRange = require('fill-range');
const supportedOptions = new Set(['cwd', 'absolute', 'onlyFiles', 'onlyDirectories', 'followSymbolicLinks', 'ignore', 'unique', 'dot']);
const slash = value => value.split(path.sep).join('/');
const trimSlash = value => value.length > 1 ? value.replace(/\/$/, '') : value;
const escapeRe = value => String(value).replace(/[|\\{}()[\]^$+*?.-]/g, '\\$&');
const negative = value => value.startsWith('!') && !value.startsWith('!(');
function unsupported(message) { throw new TypeError('@illini-market/glob-compat: ' + message); }

function rangeRegex(budget, ...args) {
  args.pop(); // picomatch appends compiler options to the range endpoints.
  if (args.length < 2 || args.length > 3) unsupported('unsupported brace range');
  const [start, end, step = 1] = args;
  const numeric = /^-?\d+$/.test(start) && /^-?\d+$/.test(end);
  if (!numeric && (start.length !== 1 || end.length !== 1)) unsupported('unsupported brace range endpoints');
  const first = numeric ? Number(start) : start.charCodeAt(0);
  const last = numeric ? Number(end) : end.charCodeAt(0);
  const stride = Math.abs(Number(step)) || 1;
  if (![first, last, stride].every(Number.isSafeInteger)) unsupported('brace range must use safe integers');
  if (Math.floor(Math.abs(last - first) / stride) + 1 > 1000) throw new RangeError('Brace range exceeds the supported limit of 1000');
  const values = fillRange(start, end, step);
  if (!Array.isArray(values) || values.length === 0) unsupported('invalid brace range');
  if (!numeric && values.some(value => /[\\/*?{}()!"'`]|\[|\]/.test(value))) unsupported('alphabetic range crosses glob syntax');
  budget.cost *= values.length;
  if (budget.cost > 1000) unsupported('combined alternatives exceed the limit of 1000');
  return '(?:' + values.map(escapeRe).join('|') + ')';
}

function normalizePattern(pattern) {
  if (pattern.length > 10000) unsupported('pattern exceeds the limit of 10000 characters');
  if (!pattern.includes('{') || !pattern.includes('}')) return pattern;
  let output = '', depth = 0, bracket = false, quote = '';
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index];
    if (character === '\\') { output += character + (pattern[++index] || ''); continue; }
    if (quote) {
      if (character === quote) quote = '';
      else output += character;
      continue;
    }
    if (character === '[') bracket = true;
    if (character === ']') bracket = false;
    if (!bracket && ['"', "'", '`'].includes(character)) {
      if (depth) unsupported('quoted text inside a brace group is not supported');
      quote = character;
      continue;
    }
    if (!bracket && character === '{') depth++;
    if (!bracket && character === '}') depth--;
    output += character;
  }
  if (quote || depth !== 0) unsupported('unbalanced quote or brace');
  return output;
}

function compileRegex(pattern, options) {
  // Brace expansion previously materialized alternatives. Bound their product
  // before compiling them together, which can otherwise cause backtracking.
  const groups = [], budget = { cost: 1 };
  let bracket = false, segmentStart = 0, ordinaryStars = 0, globstars = 0, escapedEnd = -1;
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index];
    if (character === '\\') { escapedEnd = ++index; continue; }
    if (character === '[') bracket = true;
    if (character === ']') bracket = false;
    if (bracket) continue;
    if (character === '/') { segmentStart = index + 1; ordinaryStars = 0; continue; }
    if (character === '(' || character === ')') unsupported('unescaped groups and extglobs are not supported');
    if (character === '*') {
      const end = pattern.indexOf('/', index), segment = pattern.slice(segmentStart, end === -1 ? undefined : end);
      if (segment === '**') {
        if (index === segmentStart && ++globstars > 2) unsupported('more than two globstars are not supported');
      } else if (++ordinaryStars > 1) unsupported('more than one wildcard per path segment is not supported');
    }
    if (character === '{' || character === '(') groups.push({ type: character, count: 1 });
    if (groups.length > 16) unsupported('pattern nesting exceeds the limit of 16');
    const group = groups[groups.length - 1];
    if (group && character === ',' && group.type === '{' && escapedEnd !== index - 1 && ['{', ','].includes(pattern[index - 1])) unsupported('empty brace alternatives are not supported');
    if (group && ((character === ',' && group.type === '{') || (character === '|' && group.type === '('))) group.count++;
    if (group && ((character === '}' && group.type === '{') || (character === ')' && group.type === '('))) {
      if (group.type === '{' && escapedEnd !== index - 1 && pattern[index - 1] === ',') unsupported('empty brace alternatives are not supported');
      groups.pop(); budget.cost *= group.count;
      if (budget.cost > 1000) unsupported('combined alternatives exceed the limit of 1000');
    }
  }
  return picomatch.makeRe(pattern, { ...options, debug: true, maxLength: 10000, expandRange: (...args) => rangeRegex(budget, ...args) });
}

function compilePatterns(input, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) unsupported('options must be an object');
  for (const key of Object.keys(options)) if (!supportedOptions.has(key)) unsupported('unsupported option ' + key);
  for (const key of ['absolute','onlyFiles','onlyDirectories','followSymbolicLinks','unique','dot']) {
    if (options[key] !== undefined && typeof options[key] !== 'boolean') unsupported(key + ' must be boolean');
  }
  if (options.unique === false) unsupported('unique:false is not supported');
  const list = typeof input === 'string' ? [input] : input;
  if (!Array.isArray(list) || list.some(item => typeof item !== 'string' || !item)) unsupported('patterns must be nonempty strings');
  if (options.ignore !== undefined && (!Array.isArray(options.ignore) || options.ignore.some(item => typeof item !== 'string' || !item))) unsupported('ignore must be an array of nonempty strings');
  if (options.cwd !== undefined && typeof options.cwd !== 'string') unsupported('cwd must be a path string');
  const cwd = path.resolve(options.cwd || process.cwd());
  const positives = list.filter(item => !negative(item)).map(normalizePattern);
  const negatives = [...list.filter(negative), ...(options.ignore || [])].map(item => normalizePattern(negative(item) ? item.slice(1) : item));
  const absolutePatterns = positives.some(item => path.isAbsolute(item));
  if (absolutePatterns && positives.some(item => !path.isAbsolute(item))) unsupported('mixed absolute and relative positive patterns are not supported');
  const compilerOptions = { dot: !!options.dot, posix: true, strictSlashes: false };
  // Use makeRe, not picomatch(pattern): its exact-input shortcut accepts literal
  // range syntax as a filename even when the range expression excludes it.
  const positiveRegex = positives.map(item => compileRegex(item, compilerOptions));
  function affectsDepth(pattern) {
    const basename = path.posix.basename(pattern);
    const dynamic = /[\\*?]|^!|\[[^[]*]|(?:^|[^!*+?@])\([^(]*\|[^|]*\)|[!*+?@]\([^(]*\)|\{[^}]*[,]|\{[^}]*\.\./.test(basename);
    return pattern.endsWith('/**') || !dynamic;
  }
  const negativeRegex = negatives.map(item => ({ absolute: path.isAbsolute(item), regex: compileRegex(item, { ...compilerOptions, dot: true }), deep: affectsDepth(item) ? compileRegex(item, compilerOptions) : null }));
  const depths = new Map();
  for (const item of positives) {
    const root = path.resolve(cwd, globParent(item, { flipBackslashes: false }));
    const depth = item.split('/').includes('**') ? Infinity : Math.max(0, slash(path.resolve(cwd, item)).split('/').length - slash(root).split('/').length - 1);
    depths.set(root, Math.max(depths.get(root) || 0, depth));
  }
  const roots = [...depths.keys()];
  const coordinate = full => absolutePatterns ? slash(full) : slash(path.relative(cwd, full));
  const test = (regex, value, directory) => regex.test(value) || (directory && regex.test(value + '/'));
  function isPruned(full) {
    // Only depth-affecting negative patterns prune a directory's descendants.
    for (let current = full; ; current = path.dirname(current)) {
      if (negativeRegex.some(({absolute, deep}) => deep && test(deep, absolute ? slash(current) : coordinate(current), true))) return true;
      if (current === cwd || current === path.dirname(current)) return false;
    }
  }
  const isIgnored = (full, directory) => negativeRegex.some(({absolute, regex}) => test(regex, absolute ? slash(full) : coordinate(full), directory)) || isPruned(path.dirname(full));
  return {
    cwd, roots, depths, absolute: !!options.absolute || absolutePatterns, isIgnored, isPruned,
    matches: (full, directory = false) => positiveRegex.some(regex => test(regex, coordinate(full), directory)) && !isIgnored(full, directory)
  };
}

function prepare(patterns, options = {}) {
  if (process.platform === 'win32') unsupported('Windows traversal is not yet verified');
  const contract = compilePatterns(patterns, options);
  const onlyDirectories = options.onlyDirectories === true;
  const onlyFiles = !onlyDirectories && options.onlyFiles !== false;
  // fdir must skip a missing entry without discarding its entire crawl. Retain
  // non-missing errors and rethrow them after traversal instead of hiding them.
  const errors = [], filesystem = { ...fs }, pendingLinks = new Map(), directoryLinks = [];
  const recordError = error => { if (error && error.code !== 'ENOENT') errors.push(error); };
  const takeLink = (method, filename) => method === 'stat' ? pendingLinks.get(filename)?.shift() : undefined;
  function recordResult(method, filename, result, link) {
    if (method === 'realpath' && result) {
      if (!pendingLinks.has(result)) pendingLinks.set(result, []);
      pendingLinks.get(result).push(filename);
    }
    // fdir visits a symlink directory's children but omits the directory entry.
    if (link && result?.isDirectory() && contract.matches(link, true)) directoryLinks.push(link);
  }
  for (const method of ['readdir', 'realpath', 'stat']) {
    filesystem[method] = (...args) => {
      const callback = args.pop(), link = takeLink(method, args[0]);
      fs[method](...args, (error, result) => { recordError(error); recordResult(method, args[0], result, link); callback(error, result); });
    };
    filesystem[method + 'Sync'] = (...args) => {
      const link = takeLink(method, args[0]);
      try { const result = fs[method + 'Sync'](...args); recordResult(method, args[0], result, link); return result; }
      catch (error) { recordError(error); throw error; }
    };
  }
  const crawlers = contract.roots.map(root => {
    const crawler = new fdir({ fs: filesystem, excludeSymlinks: options.followSymbolicLinks === false && (onlyFiles || onlyDirectories) }).withFullPaths().withDirs().withMaxDepth(contract.depths.get(root));
    if (options.followSymbolicLinks !== false) crawler.withSymlinks({ resolvePaths: false });
    crawler.exclude((name, full) => contract.isPruned(trimSlash(full)));
    crawler.filter((full, directory) => {
      const clean = trimSlash(full);
      return clean !== root && !(onlyFiles && directory) && !(onlyDirectories && !directory) && contract.matches(clean, directory);
    });
    return crawler.crawl(root);
  });
  const finish = groups => {
    if (errors.length) throw errors[0];
    return [...new Set([...groups.flat(), ...(onlyFiles ? [] : directoryLinks)].map(trimSlash))].map(full => contract.absolute ? slash(full) : slash(path.relative(contract.cwd, full)));
  };
  return { crawlers, finish };
}
async function glob(patterns, options) {
  const { crawlers, finish } = prepare(patterns, options);
  return finish(await Promise.all(crawlers.map(crawler => crawler.withPromise())));
}
glob.sync = (patterns, options) => {
  const { crawlers, finish } = prepare(patterns, options);
  return finish(crawlers.map(crawler => crawler.sync()));
};
glob.compilePatterns = compilePatterns;
module.exports = glob;
