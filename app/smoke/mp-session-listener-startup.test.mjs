import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import ts from 'typescript'

const SRC = new URL('../src/', import.meta.url)
const LISTENERS = ['useUnread', 'useNotifications']

// Match uni-app's source removal before inspecting executable script setup.
// A call inside a deleted H5 block must not satisfy the MP startup contract.
function preprocess(source, platform) {
  const enabled = [true]
  return source.split('\n').filter(line => {
    const directive = line.match(/^\s*(?:\/\/|<!--|\/\*)\s*#(ifdef|ifndef|endif)(?:\s+([A-Z0-9-]+))?/)
    if (!directive) return enabled.at(-1)
    if (directive[1] === 'endif') {
      assert.ok(enabled.length > 1, 'unmatched conditional end')
      enabled.pop()
    } else {
      const matches = directive[2] === platform
      enabled.push(enabled.at(-1) && (directive[1] === 'ifdef' ? matches : !matches))
    }
    return false
  }).join('\n')
}

function source(path, platform) {
  return preprocess(readFileSync(new URL(path, SRC), 'utf8'), platform)
}

function scriptSetup(path, platform) {
  const script = source(path, platform).match(/<script setup[^>]*>([\s\S]*?)<\/script>/)
  assert.ok(script, `${path} has script setup`)
  return ts.createSourceFile(path + '.ts', script[1], ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function startupCalls(file, name) {
  const calls = []
  function visit(node) {
    // A declaration or lifecycle callback is not an unconditional setup call.
    if (ts.isFunctionLike(node)) return
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) {
      calls.push(node)
    }
    ts.forEachChild(node, visit)
  }
  for (const statement of file.statements) {
    if (ts.isExpressionStatement(statement) || ts.isVariableStatement(statement)) visit(statement)
  }
  return calls
}

function assertListenerStartup(file, name) {
  const imported = file.statements.some(statement =>
    ts.isImportDeclaration(statement)
    && statement.moduleSpecifier.text.endsWith(`/composables/${name}`)
    && statement.importClause?.namedBindings
    && ts.isNamedImports(statement.importClause.namedBindings)
    && statement.importClause.namedBindings.elements.some(binding => binding.name.text === name))
  assert.ok(imported, `${file.fileName} imports ${name} on this platform`)
  assert.equal(startupCalls(file, name).length, 1, `${file.fileName} starts ${name} exactly once in setup`)
}

test('MP app setup starts both session listeners once before any page is mounted', () => {
  const app = scriptSetup('App.vue', 'MP-WEIXIN')
  for (const listener of LISTENERS) assertListenerStartup(app, listener)
})

test('H5 control keeps both listener startups in AppSidebar and out of App setup', () => {
  const app = scriptSetup('App.vue', 'H5')
  const sidebar = scriptSetup('components/AppSidebar.vue', 'H5')
  for (const listener of LISTENERS) {
    assert.equal(startupCalls(app, listener).length, 0)
    assertListenerStartup(sidebar, listener)
  }
  assert.match(source('pages/detail/index.vue', 'H5'), /<AppSidebar\b/)
  assert.match(source('pages/detail/index.vue', 'H5'), /import AppSidebar from/)
})

test('MP pages and App keep AppSidebar out of their compiled source', () => {
  const sidebarReference = /<AppSidebar\b|import\s+AppSidebar\b/
  function check(path) {
    for (const entry of readdirSync(new URL(path, SRC), { withFileTypes: true })) {
      const next = `${path}/${entry.name}`
      if (entry.isDirectory()) check(next)
      else if (entry.name.endsWith('.vue')) {
        assert.doesNotMatch(source(next, 'MP-WEIXIN'), sidebarReference, next)
      }
    }
  }
  assert.doesNotMatch(source('App.vue', 'MP-WEIXIN'), sidebarReference)
  check('pages')
})
