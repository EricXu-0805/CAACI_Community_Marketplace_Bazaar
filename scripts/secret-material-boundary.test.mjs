import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function reviewableFiles() {
  return execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: projectRoot, encoding: 'utf8' },
  ).split('\0').filter(Boolean)
}

test('reviewable source contains no literal administrator bearer token', () => {
  const leakedPaths = []
  for (const relative of reviewableFiles()) {
    let bytes
    try { bytes = readFileSync(path.join(projectRoot, relative)) } catch { continue }
    if (bytes.includes(0)) continue
    const source = bytes.toString('utf8')
    // Report paths only. Never echo a matching credential into CI output.
    if (/iam_admin_[A-Za-z0-9_-]{43}/.test(source)) leakedPaths.push(relative)
  }
  assert.deepEqual(
    leakedPaths,
    [],
    `literal administrator credential detected in: ${leakedPaths.join(', ')}`,
  )
})
