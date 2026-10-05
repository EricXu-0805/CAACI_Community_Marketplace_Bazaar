'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const glob = require('./index.cjs');

function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'illini-glob-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = name => {
    const full = path.join(root, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, 'synthetic fixture\n');
    return full;
  };
  files.forEach(write);
  return { root, write, absolute: name => path.join(root, name) };
}
const escapePath = value => value.replace(/[\\*?\[\]{}()!]/g, '\\$&');
async function both(patterns, options, expected) {
  assert.deepEqual(glob.sync(patterns, options).sort(), [...expected].sort());
  assert.deepEqual((await glob(patterns, options)).sort(), [...expected].sort());
}

test('escaped literal braces and brackets select exact filenames', async t => {
  const { root, absolute } = fixture(t, ['{a,b}.ts','a.ts','b.ts','[group]/{one,two}/Card.vue','[group]/one/Other.vue']);
  await both(escapePath(absolute('{a,b}.ts')), { cwd: root, absolute: true }, [absolute('{a,b}.ts')]);
  await both(escapePath(absolute('[group]/{one,two}')) + '/**/*.vue', { cwd: root }, [absolute('[group]/{one,two}/Card.vue')]);
});

test('Unicode range excludes its literal spelling and quoted braces preserve caller behavior', async t => {
  const { root } = fixture(t, ['é.ts','ê.ts','{é..ê}.ts','a.ts','b.ts','{a,b}.ts','"a".ts']);
  await both('{é..ê}.ts', { cwd: root }, ['é.ts','ê.ts']);
  await both('"{a,b}".ts', { cwd: root }, ['a.ts','b.ts']);
});

test('padded, descending, multidigit and stepped ranges retain exact values', async t => {
  const { root } = fixture(t, ['x-02.ts','x-01.ts','x00.ts','x01.ts','x02.ts','x-002.ts','x000.ts','x001.ts','x002.ts','x1.ts','x2.ts','x3.ts','x4.ts','x5.ts','x9.ts','x10.ts','x11.ts']);
  // Baseline fill-range includes the negative sign when determining width.
  await both('x{-02..2}.ts', { cwd: root }, ['x-02.ts','x-01.ts','x000.ts','x001.ts','x002.ts']);
  await both('x{5..1..2}.ts', { cwd: root }, ['x1.ts','x3.ts','x5.ts']);
  await both('x{9..11}.ts', { cwd: root }, ['x9.ts','x10.ts','x11.ts']);
});

test('absolute CSS dependencies honor ignore and return absolute paths', async t => {
  const { root, absolute } = fixture(t, ['main.css','nested/card.scss','node_modules/vendor/skip.css','.hidden.css']);
  await both(absolute('**/*.{css,scss}'), { ignore: ['**/node_modules/**'] }, [absolute('main.css'),absolute('nested/card.scss')]);
});

test('directory results omit trailing slash and onlyDirectories overrides onlyFiles', async t => {
  const { root, absolute } = fixture(t, ['alpha/utssdk/index.uts','beta/utssdk/index.uts','.hidden/utssdk/index.uts']);
  await both('*/utssdk', { cwd: root, absolute: true, onlyDirectories: true, onlyFiles: true }, [absolute('alpha/utssdk'),absolute('beta/utssdk')]);
});

test('ignores prune only depth-affecting patterns and explicit dot files remain selectable', async t => {
  const { root } = fixture(t, ['main.ts','skipdir/inside.ts','.hidden/inside.ts','.dot.ts']);
  await both('**/*.ts', { cwd: root, ignore: ['**/skip*'] }, ['main.ts','skipdir/inside.ts']);
  await both('**/*.ts', { cwd: root, ignore: ['skipdir'] }, ['main.ts']);
  await both('.dot.ts', { cwd: root }, ['.dot.ts']);
});

test('broken symlinks never discard unrelated files; follow false excludes symlinks', async t => {
  const { root, absolute } = fixture(t, ['main.ts','nested/inside.ts']);
  fs.symlinkSync('missing-target', absolute('broken.ts'));
  fs.symlinkSync('main.ts', absolute('alias.ts'));
  await both('**/*.ts', { cwd: root, followSymbolicLinks: true }, ['main.ts','nested/inside.ts','alias.ts']);
  await both('**/*.ts', { cwd: root, followSymbolicLinks: false }, ['main.ts','nested/inside.ts']);
});

test('new and deleted files and symlink targets appear on the next scan', async t => {
  const { root, write, absolute } = fixture(t, ['target/first.ts']);
  fs.symlinkSync('target', absolute('linked'));
  const options = { cwd: root, followSymbolicLinks: true };
  await both('*', { ...options, onlyDirectories: true }, ['target','linked']);
  await both('linked/*.ts', options, ['linked/first.ts']);
  write('target/second.ts');
  await both('linked/*.ts', options, ['linked/first.ts','linked/second.ts']);
  fs.unlinkSync(absolute('target/first.ts'));
  await both('linked/*.ts', options, ['linked/second.ts']);
});

test('missing roots return empty while non-directory and permission errors propagate', async t => {
  const { root, absolute } = fixture(t, ['main.ts','blocked/hidden.ts']);
  await both('**/*.ts', { cwd: absolute('missing') }, []);
  assert.throws(() => glob.sync('**/*.ts', { cwd: absolute('main.ts') }), { code: 'ENOTDIR' });
  await assert.rejects(glob('**/*.ts', { cwd: absolute('main.ts') }), { code: 'ENOTDIR' });
  if (process.getuid?.() === 0) return;
  fs.chmodSync(absolute('blocked'), 0);
  try {
    assert.throws(() => glob.sync('**/*.ts', { cwd: root }), { code: 'EACCES' });
    await assert.rejects(glob('**/*.ts', { cwd: root }), { code: 'EACCES' });
  } finally { fs.chmodSync(absolute('blocked'), 0o700); }
});

test('shallow locale and literal patterns do not read unrelated inaccessible children', async t => {
  const { root, absolute } = fixture(t, ['main.ts','en.json','blocked/hidden.ts']);
  fs.chmodSync(absolute('blocked'), 0);
  try {
    await both('main.ts', { cwd: root }, ['main.ts']);
    await both('*.ts', { cwd: root }, ['main.ts']);
    await both('*.json', { cwd: root, absolute: true }, [absolute('en.json')]);
    await both('*', { cwd: root, onlyDirectories: true }, ['blocked']);
  } finally { fs.chmodSync(absolute('blocked'), 0o700); }
});

test('unsupported syntax and options fail explicitly', async t => {
  const { root, absolute } = fixture(t, ['a.ts']);
  for (const pattern of ['x{+1..+3}.ts','x{A..a}.ts','{"a,b",c}.ts','+(a|aa).ts','foo/{bar,}/file.ts','{,a}.ts']) {
    assert.throws(() => glob.sync(pattern, { cwd: root }), TypeError);
    await assert.rejects(glob(pattern, { cwd: root }), TypeError);
  }
  assert.throws(() => glob.sync(['*.ts', absolute('*.ts')], { cwd: root }), /mixed absolute/);
  assert.throws(() => glob.sync('*.ts', { cwd: root, unique: false }), /unique:false/);
  assert.throws(() => glob.sync('*.ts', { cwd: root, objectMode: true }), /unsupported option/);
});

test('resource guards reject formerly expensive expressions before filesystem traversal', () => {
  for (const pattern of ['{a,aa}'.repeat(30)+'X','*a'.repeat(30)+'X','**/a/'.repeat(30)+'X','{1..1000000000}','x'.repeat(10001),'{'.repeat(2000)+'x'+'}'.repeat(2000)]) {
    assert.throws(() => glob.compilePatterns(pattern), /limit|not supported/);
  }
});
