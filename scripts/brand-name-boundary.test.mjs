// BRAND.1-3 renamed the product to 玉米地 / Cornfield and the campus badge to
// 校园邮箱已验证 / Campus email verified. These are the two searches from the
// BACKLOG (BRAND.2 and BRAND.3) run as a test so an old name cannot creep back
// into user-facing source. Comment lines are skipped, and so is the
// transitional `app.formerly` copy (原 Illini Market / formerly Illini Market).
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const COMMENT_LINE = /^[^:]+:[0-9]+:[ \t\n\r\f\v]*([*]|\/\/|\/[*]|<!--)/

function gitGrep(args) {
  try {
    return execFileSync('git', ['grep', '-nI', ...args], { cwd: repoRoot, encoding: 'utf8' })
      .split('\n').filter(Boolean)
  } catch (error) {
    // git grep exits 1 when nothing matches; anything else is a real failure.
    if (error.status === 1) return []
    throw error
  }
}

test('the old product name only survives in the formerly-known-as line', () => {
  const hits = gitGrep([
    '-E', 'Illini Market|Illini 集市|Illini集市', '--',
    'app/src', 'app/index.html', 'app/public-brand-pages.ts', 'api',
    ':!*.test.mjs', ':!app/src/legal',
  ])
    .filter(line => !COMMENT_LINE.test(line))
    .filter(line => !/原 Illini Market|formerly Illini Market/.test(line))
  assert.deepEqual(hits, [])
})

test('the campus email badge is never named after Illini', () => {
  const hits = gitGrep([
    '-iE', '伊利诺伊认证|Illini ?认证|Illini ?徽章|Illini ?身份|Verified Illini|Illini badge|Illini verification|Illini-verified|Illini verified', '--',
    'app/src', 'api', ':!*.test.mjs',
  ])
    .filter(line => !/^[^:]+:[0-9]+:[ \t\n\r\f\v]*([*]|\/\/|\/[*])/.test(line))
  assert.deepEqual(hits, [])
})

// BRAND.4 replaced the 集 seal on photo placeholders with 玉. A page that kept
// 集 would show the old mark wherever a listing or topic has no photo, and a
// branch that adds a new placeholder (CommunityHome.vue in #374) brings it back.
test('photo placeholder seals use 玉, never the old 集', () => {
  const seals = gitGrep(['-E', 'u-thumb-ph-seal[^"]*"[^>]*>[^<]*<', '--', 'app/src'])
  assert.ok(seals.some(line => /u-thumb-ph-seal[^"]*"[^>]*>玉</.test(line)),
    'no placeholder seal found: the search no longer matches the markup')
  assert.deepEqual(seals.filter(line => /u-thumb-ph-seal[^"]*"[^>]*>[^<]*集/.test(line)), [])
})
