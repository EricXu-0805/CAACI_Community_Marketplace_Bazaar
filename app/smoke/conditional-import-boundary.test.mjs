import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/*
 * A conditional-compile block deletes source. An identifier imported inside
 * `#ifdef MP-WEIXIN` does not exist in the H5 bundle, so using it outside that
 * block is a ReferenceError on H5 — and because it throws in `setup()`, Vue
 * discards the whole component and renders nothing where it should have been.
 * Neither build fails, neither type-check fails, and the dev console stays
 * clean because the app's own errorHandler swallows it. The only visible
 * symptom is an absent component.
 *
 * That is exactly how the bottom tab bar left the H5 app: `computed` was
 * imported under `#ifdef MP-WEIXIN` and then used by two unconditional
 * computeds, so illinimarket.com shipped with no primary navigation on
 * phones while the mini program was fine.
 *
 * The check is per build target rather than per literal condition, because
 * `#ifdef MP-WEIXIN` and `#ifndef H5` are different strings that select the
 * same platform here. A binding may be used only on targets where its import
 * survives.
 */

const TARGETS = ['H5', 'MP-WEIXIN']
const SRC = new URL('../src/', import.meta.url).pathname

function vueFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...vueFiles(path))
    else if (entry.endsWith('.vue') || entry.endsWith('.ts')) out.push(path)
  }
  return out
}

// Which build targets a stack of conditions is active on.
function activeTargets(stack) {
  return TARGETS.filter(target => stack.every(({ negated, platform }) =>
    negated ? platform !== target : platform === target))
}

const DIRECTIVE = /^\s*(?:\/\/|<!--)\s*#(ifdef|ifndef|endif)(?:\s+([A-Z0-9-]+))?/

/**
 * Walks the file line by line tracking the conditional-compile stack, and
 * returns for each line the set of build targets that keep it.
 */
function targetsByLine(source) {
  const stack = []
  return source.split('\n').map(line => {
    const directive = DIRECTIVE.exec(line)
    if (directive) {
      const [, kind, platform] = directive
      if (kind === 'endif') stack.pop()
      else stack.push({ negated: kind === 'ifndef', platform })
      return null                                   // the directive itself is not code
    }
    return activeTargets(stack)
  })
}

// Comments and string literals are not usages. Blanking rather than deleting
// keeps line numbers true so a failure points at the right line.
function blankNonCode(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length))
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, m => m.replace(/[^\n]/g, ' '))
}

// The module specifier is deliberately not matched: `blankNonCode` has already
// blanked every string literal, so requiring it here would match nothing.
const IMPORT = /^\s*import\s+\{([^}]+)\}\s+from\s/

test('an identifier imported under a conditional-compile block is only used where that import survives', () => {
  const violations = []

  for (const file of vueFiles(SRC)) {
    const raw = readFileSync(file, 'utf8')
    if (!/#(ifdef|ifndef)/.test(raw)) continue

    const lineTargets = targetsByLine(raw)
    const code = blankNonCode(raw).split('\n')

    // Bindings whose import does not survive on every build target.
    const guarded = new Map()
    code.forEach((line, index) => {
      const match = IMPORT.exec(line)
      if (!match) return
      const targets = lineTargets[index]
      if (!targets || targets.length === TARGETS.length) return
      for (const spec of match[1].split(',')) {
        const name = spec.trim().split(/\s+as\s+/).pop()?.trim()
        if (!name || name === 'type') continue
        guarded.set(name.replace(/^type\s+/, ''), { targets, line: index + 1 })
      }
    })
    if (!guarded.size) continue

    code.forEach((line, index) => {
      if (IMPORT.test(line)) return
      const usedOn = lineTargets[index]
      if (!usedOn) return
      for (const [name, imported] of guarded) {
        if (!new RegExp(`\\b${name}\\b`).test(line)) continue
        const unsupported = usedOn.filter(t => !imported.targets.includes(t))
        if (!unsupported.length) continue
        violations.push(
          `${file.slice(SRC.length)}:${index + 1} uses "${name}" on ${unsupported.join('+')}, `
          + `but its import (line ${imported.line}) only survives on ${imported.targets.join('+') || 'no target'}`)
      }
    })
  }

  assert.deepEqual(violations, [], `conditionally imported bindings used where they do not exist:\n${violations.join('\n')}`)
})
