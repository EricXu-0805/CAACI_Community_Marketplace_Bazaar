import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await sourceFiles(absolute))
    else if (/\.(?:ts|vue|js|mjs)$/.test(entry.name)) files.push(absolute)
  }
  return files
}

function consoleCalls(source) {
  const calls = []
  const pattern = /console\.(?:warn|error)\s*\(/g
  let match
  while ((match = pattern.exec(source))) {
    const start = pattern.lastIndex
    let depth = 1
    let quote = ''
    let escaped = false
    let index = start
    for (; index < source.length && depth > 0; index += 1) {
      const char = source[index]
      if (quote) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === quote) quote = ''
        continue
      }
      if (char === "'" || char === '"' || char === '`') quote = char
      else if (char === '(') depth += 1
      else if (char === ')') depth -= 1
    }
    calls.push(source.slice(start, index - 1).trim())
    pattern.lastIndex = index
  }
  return calls
}

test('production warn/error calls never print provider errors or user-authored text', async () => {
  for (const file of await sourceFiles(sourceRoot)) {
    const relative = path.relative(sourceRoot, file)
    const source = await readFile(file, 'utf8')
    for (const args of consoleCalls(source)) {
      const normalizedArgs = args.replace(/,\s*$/u, '')
      if (relative === path.join('utils', 'sentry.ts')) {
        const safeFallback = /^'\[error\]'\s*,\s*safeErrorSummary\(err\)$/
        if (safeFallback.test(normalizedArgs)) continue
      }
      assert.match(
        normalizedArgs,
        /^(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`)$/s,
        `${relative} must log one fixed event code, got: ${args}`,
      )
      assert.doesNotMatch(normalizedArgs, /\$\{/u, `${relative} must not interpolate console payloads`)
    }
  }
})
