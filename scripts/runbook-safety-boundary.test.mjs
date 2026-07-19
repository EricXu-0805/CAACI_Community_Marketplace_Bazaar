import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const RUNBOOK = new URL('../RUNBOOK.md', import.meta.url)
const GITIGNORE = new URL('../.gitignore', import.meta.url)
const ENV_CHECKLIST = new URL('../ENV_CHECKLIST.md', import.meta.url)
const WECHAT_RUNBOOK = new URL('../docs/WECHAT_MP_SETUP.md', import.meta.url)

function githubSlug(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-')
}

test('runbook does not prescribe destructive or ledger-blind production recovery', async () => {
  const [source, gitignore] = await Promise.all([
    readFile(RUNBOOK, 'utf8'),
    readFile(GITIGNORE, 'utf8'),
  ])

  assert.doesNotMatch(source, /^\s*(?:npx\s+)?supabase db push\b/gm)
  assert.doesNotMatch(source, /^\s*psql\b[^\n]*DROP SCHEMA public CASCADE/gm)
  assert.doesNotMatch(source, /^\s*pg_dump\b/gm)
  assert.doesNotMatch(source, /starts with `sbp_`/)
  assert.doesNotMatch(source, /leaked-password \(HIBP\) OFF/)

  assert.match(source, /Do \*\*not\*\* run a blind `supabase db push`/)
  assert.match(source, /Never `DROP SCHEMA public CASCADE`/)
  assert.match(source, /Storage metadata, \*\*not the object\s+bytes/)
  assert.match(source, /unique 14-digit UTC timestamp migration/)
  assert.match(source, /enable leaked-password \(HIBP\)/)
  assert.match(gitignore, /^backups\/$/m)
  assert.match(gitignore, /^\*\.dump$/m)
  assert.match(gitignore, /^\.env\*$/m)
  assert.match(gitignore, /^app\/\.env\*$/m)
  assert.match(gitignore, /^!app\/\.env\.example$/m)
  assert.match(gitignore, /^app\/test-results\/$/m)
  assert.match(gitignore, /^app\/playwright-report\/$/m)
})

test('runbook reflects the deployed account and admin-token fields', async () => {
  const source = await readFile(RUNBOOK, 'utf8')
  assert.match(source, /p\.suspension_level/)
  assert.match(source, /p\.suspended_until/)
  assert.match(source, /p\.shadow_banned/)
  assert.doesNotMatch(source, /SELECT id, email, status, ban_level/)
  assert.match(source, /dashboard keeps it only in page memory/)
  assert.doesNotMatch(source, /admin_token.*localStorage/)
})

test('environment and WeChat docs do not treat new Supabase keys as drop-in JWTs', async () => {
  const [environment, wechat] = await Promise.all([
    readFile(ENV_CHECKLIST, 'utf8'),
    readFile(WECHAT_RUNBOOK, 'utf8'),
  ])
  for (const source of [environment, wechat]) {
    assert.doesNotMatch(source, /^\s*(?:npx\s+)?supabase db push\b/gm)
    assert.match(source, /sb_(?:publishable|secret)_/)
    assert.match(source, /not (?:a )?drop-in replacement|Do not substitute|Do not paste/i)
  }
  assert.match(environment, /leaked-password protection enabled/)
})

test('runbook internal heading links resolve', async () => {
  const source = await readFile(RUNBOOK, 'utf8')
  const headings = new Set()
  for (const match of source.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    headings.add(githubSlug(match[1]))
  }

  const missing = []
  for (const match of source.matchAll(/\]\(#([^)]+)\)/g)) {
    if (!headings.has(match[1])) missing.push(match[1])
  }
  assert.deepEqual(missing, [])
})
