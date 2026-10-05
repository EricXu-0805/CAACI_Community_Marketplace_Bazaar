import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, lstatSync } from 'node:fs'
import { createRequire } from 'node:module'

const source = new URL('../app/build-compat/braces-source/', import.meta.url)
const require = createRequire(new URL('package.json', source))
const braces = require('./index.js')
const internal = {
  compile: require('./lib/compile.js'),
  expand: require('./lib/expand.js'),
  stringify: require('./lib/stringify.js'),
}

test('installed toolchain packages match the source-built archives without stale distributed code', () => {
  const app = new URL('../app/', import.meta.url)
  const manifest = JSON.parse(readFileSync(new URL('vendor/source-builds/manifest.json', app)))
  const lock = JSON.parse(readFileSync(new URL('package-lock.json', app)))
  assert.deepEqual(manifest.artifacts.map(a => a.name).sort(), ['rollup', 'vite'])
  for (const artifact of manifest.artifacts) {
    const archive = readFileSync(new URL(`vendor/source-builds/${artifact.filename}`, app))
    assert.equal(createHash('sha256').update(archive).digest('hex'), artifact.sha256)
    const integrity = 'sha512-' + createHash('sha512').update(archive).digest('base64')
    assert.equal(integrity, artifact.integrity)
    const row = lock.packages[`node_modules/${artifact.name}`]
    assert.equal(row.version, artifact.version)
    assert.equal(row.resolved, `file:vendor/source-builds/${artifact.filename}`)
    assert.equal(row.integrity, integrity)
    const installed = new URL(`node_modules/${artifact.name}/`, app)
    assert.equal(lstatSync(installed).isSymbolicLink(), false)
    const identity = JSON.parse(readFileSync(new URL('package.json', installed)))
    assert.equal(identity.name, artifact.name)
    assert.equal(identity.version, artifact.version)
    for (const [name, expected] of Object.entries(artifact.fileHashes)) {
      const file = new URL(name, installed)
      assert.equal(lstatSync(file).isFile(), true, name)
      assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), expected.sha256, `${artifact.name}/${name}`)
    }
    const distFiles = []
    const walk = relative => {
      for (const entry of readdirSync(new URL(relative, installed), { withFileTypes: true })) {
        const name = relative + entry.name
        assert.equal(entry.isSymbolicLink(), false, name)
        if (entry.isDirectory()) walk(name + '/')
        else distFiles.push(name)
      }
    }
    walk('dist/')
    assert.deepEqual(distFiles.sort(), Object.keys(artifact.fileHashes).filter(name => name.startsWith('dist/')).sort())
  }
  const native = Object.entries(lock.packages).filter(([name]) => name.startsWith('node_modules/@rollup/rollup-'))
  assert.equal(native.length, 25)
  for (const [name, row] of native) assert.equal(row.version, '4.60.2', name)
})

test('the reviewed braces source inputs retain their exact provenance and license', () => {
  const manifest = JSON.parse(readFileSync(new URL('../app/build-compat/source-builds/source-manifest.json', import.meta.url)))
  for (const file of manifest.files) {
    const actual = createHash('sha256').update(readFileSync(new URL(file.path, source))).digest('hex')
    assert.equal(actual, file.sha256, file.path)
  }
  assert.equal(require('./package.json').name, 'braces')
  assert.equal(require('./package.json').version, '3.0.3')
  assert.match(readFileSync(new URL('LICENSE', source), 'utf8'), /Copyright.*Jon Schlinkert/)
})

test('source safety backport preserves released escaping, quotes, ranges, and ordinary AST behavior', () => {
  assert.deepEqual(braces.expand('foo/{a,b}'), ['foo/a', 'foo/b'])
  assert.deepEqual(braces.expand('{01..03}'), ['01', '02', '03'])
  assert.deepEqual(braces.expand("'{a,b}"), ['{a,b}'])
  assert.deepEqual(braces.expand('${HOME}/x', { escapeInvalid: true }), ['${HOME}/x'])
  assert.deepEqual(braces.expand('{a,${b,c}}', { escapeInvalid: true }), ['a', '${b,c}'])
  assert.equal(braces.stringify('{01..04}', { escapeInvalid: true }), '{01..04}')
  assert.equal(braces.compile('foo/{a,b}'), 'foo/(a|b)')
  const ast = braces.parse('foo/{a,b}')
  assert.equal(internal.stringify(ast), 'foo/{a,b}')
  assert.equal(internal.compile(ast), 'foo/(a|b)')
  assert.deepEqual(internal.expand(ast), ['foo/a', 'foo/b'])
})

test('all string entry points enforce the source depth budget without an option bypass', () => {
  const accepted = '{'.repeat(100) + 'a,b' + '}'.repeat(100)
  const rejected = '{'.repeat(101) + 'a,b' + '}'.repeat(101)
  const entryPoints = [braces, braces.create, braces.parse, braces.compile, braces.expand, braces.stringify]
  for (const entry of entryPoints) {
    assert.doesNotThrow(() => entry(accepted))
    for (const maxDepth of [undefined, Infinity, NaN, 1000]) {
      assert.throws(() => entry(rejected, { maxDepth }), /Input depth \(101\), exceeds max depth \(100\)/)
    }
  }
  assert.doesNotThrow(() => braces.parse('{a,b}', { maxDepth: 1.5 }))
  assert.throws(() => braces.parse('{{a,b}}', { maxDepth: 1.5 }), /Input depth/)
})

test('each source operation reads a maxDepth option once', () => {
  for (const operation of [braces.parse, ...Object.values(internal)]) {
    let reads = 0
    const options = { get maxDepth() { reads++; return reads === 1 ? 2 : NaN } }
    const input = operation === braces.parse ? '{a,b}' : braces.parse('{a,b}')
    operation(input, options)
    assert.equal(reads, 1)
  }
})

test('array-valued ASTs keep ordinary shared values and reject excessive depth in every traversal', () => {
  const shared = ['a', 'b']
  for (const operation of [braces.compile, braces.stringify, internal.compile, internal.stringify]) {
    const ast = { type: 'root', nodes: [{ type: 'text', value: [shared, shared] }] }
    assert.equal(operation(ast), 'a,b,a,b')
    assert.deepEqual(shared, ['a', 'b'])
  }
  for (const operation of [braces.compile, braces.expand, braces.stringify, ...Object.values(internal)]) {
    let value = ['a']
    for (let depth = 0; depth < 102; depth++) value = [value]
    assert.throws(() => operation({ type: 'root', nodes: [{ type: 'text', value }] }), /Array depth \(101\), exceeds max depth \(100\)/)
  }
})
